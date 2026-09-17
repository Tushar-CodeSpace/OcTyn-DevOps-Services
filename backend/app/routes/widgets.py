"""Custom data-widget routes: agent ingestion + dashboard queries."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.schemas.widgets import WidgetHistoryPoint, WidgetSampleCreate, WidgetSampleRead
from app.services import authentication as auth
from app.services.monitoring import authenticate_agent

router = APIRouter(prefix="/api/v1/widgets", tags=["widgets"])

MAX_GROUPS_PER_SAMPLE = 50


def now() -> datetime:
    return datetime.now(timezone.utc)


def widget_doc_to_read(doc: dict) -> WidgetSampleRead:
    return WidgetSampleRead(
        id=str(doc["_id"]),
        server_id=str(doc["server_id"]),
        widget_name=doc["widget_name"],
        database=doc["database"],
        collection=doc["collection"],
        window_minutes=int(doc["window_minutes"]),
        total=int(doc["total"]),
        groups={str(k): int(v) for k, v in (doc.get("groups") or {}).items()},
        collected_at=doc["collected_at"],
        received_at=doc["received_at"],
        error=doc.get("error"),
    )


@router.post("", response_model=dict)
async def ingest_widget_sample(
    payload: WidgetSampleCreate,
    agent: dict = Depends(authenticate_agent),
) -> dict:
    """Agent endpoint: receive one custom-widget tally for an authenticated server."""
    server = agent["server"]

    if payload.server_id != server["_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API key does not match server_id",
        )

    groups = {str(k)[:100]: max(0, int(v)) for k, v in (payload.groups or {}).items()}
    if len(groups) > MAX_GROUPS_PER_SAMPLE:
        # Keep the largest buckets so a runaway group-by can't bloat the doc.
        groups = dict(sorted(groups.items(), key=lambda kv: kv[1], reverse=True)[:MAX_GROUPS_PER_SAMPLE])
    total = max(0, int(payload.total))
    if total < sum(groups.values()):
        total = sum(groups.values())

    doc = {
        "_id": new_id(),
        "server_id": server["_id"],
        "widget_name": payload.widget_name.strip(),
        "database": payload.database.strip(),
        "collection": payload.collection.strip(),
        "window_minutes": int(payload.window_minutes),
        "total": total,
        "groups": groups,
        "collected_at": payload.collected_at,
        "received_at": now(),
        "error": (payload.error or "").strip()[:500] or None,
    }
    db.widget_data().insert_one(doc)

    emit(
        "widget_update",
        {
            "id": str(doc["_id"]),
            "server_id": str(server["_id"]),
            "widget_name": doc["widget_name"],
            "database": doc["database"],
            "collection": doc["collection"],
            "window_minutes": doc["window_minutes"],
            "total": doc["total"],
            "groups": doc["groups"],
            "collected_at": doc["collected_at"].isoformat(),
            "received_at": doc["received_at"].isoformat(),
            "error": doc["error"],
        },
        room=f"server:{server['_id']}",
    )
    return {"success": True}


@router.get("/servers/{server_id}", response_model=list[WidgetSampleRead])
async def list_latest_widgets(
    server_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    _: dict = Depends(auth.get_current_user),
) -> list[WidgetSampleRead]:
    """Dashboard endpoint: newest sample per widget for a server.

    Samples expire via TTL (7 days); only the latest sample of each
    ``widget_name`` is returned, newest first.
    """
    sid = parse_id(server_id)
    if sid is None or db.servers().find_one({"_id": sid}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    docs = list(
        db.widget_data()
        .find({"server_id": sid})
        .sort("received_at", -1)
        .limit(limit * 5)
    )
    seen: set[str] = set()
    out: list[WidgetSampleRead] = []
    for doc in docs:
        name = str(doc.get("widget_name", ""))
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(widget_doc_to_read(doc))
        if len(out) >= limit:
            break
    return out


@router.get("/servers/{server_id}/history", response_model=list[WidgetHistoryPoint])
async def widget_history(
    server_id: str,
    widget_name: str = Query(min_length=1, max_length=100),
    hours: int = Query(default=24, ge=1, le=168),
    _: dict = Depends(auth.get_current_user),
) -> list[WidgetHistoryPoint]:
    """Dashboard endpoint: downsampled trend of one widget (<=120 points).

    Each sample is a rolling-window count, so consecutive points show how the
    tally evolves over time. Buckets keep the last sample in each window.
    """
    from datetime import timedelta

    sid = parse_id(server_id)
    if sid is None or db.servers().find_one({"_id": sid}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    since = now() - timedelta(hours=hours)
    docs = list(
        db.widget_data()
        .find({"server_id": sid, "widget_name": widget_name, "received_at": {"$gte": since}})
        .sort("received_at", 1)
        .limit(5000)
    )
    if not docs:
        return []
    bucket_seconds = max(60, (hours * 3600) // 120)
    buckets: dict[int, dict] = {}
    for doc in docs:
        received = doc.get("received_at")
        epoch = int(received.timestamp()) if isinstance(received, datetime) else 0
        buckets[epoch // bucket_seconds] = doc
    out: list[WidgetHistoryPoint] = []
    for key in sorted(buckets):
        doc = buckets[key]
        out.append(
            WidgetHistoryPoint(
                received_at=doc["received_at"],
                total=int(doc.get("total", 0)),
                groups={str(k): int(v) for k, v in (doc.get("groups") or {}).items()},
            )
        )
    return out
