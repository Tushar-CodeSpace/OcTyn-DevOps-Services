"""Custom data-widget routes: agent ingestion + dashboard queries."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.services import audit as audit_trail, app_settings
from app.schemas.widgets import (
    WidgetHistoryPoint,
    WidgetSampleCreate,
    WidgetSampleRead,
    WidgetTemplateRead,
    WidgetTemplateUpsert,
)
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
        alert_threshold_percent=float(doc.get("alert_threshold_percent", 50.0)),
        alert_window_minutes=int(doc.get("alert_window_minutes", 15)),
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
        groups = dict(sorted(groups.items(), key=lambda kv: kv[1], reverse=True)[:MAX_GROUPS_PER_SAMPLE])
    total = max(0, int(payload.total))
    if total < sum(groups.values()):
        total = sum(groups.values())

    try:
        agent_cfg = app_settings.get_agent_config(server["_id"])
        custom_widgets = agent_cfg.get("custom_widgets", [])
        matched_widget = next(
            (w for w in custom_widgets
             if w.get("name") == payload.widget_name.strip()
             and w.get("database") == payload.database.strip()
             and w.get("collection") == payload.collection.strip()),
            {},
        )
    except Exception:
        matched_widget = {}

    alert_threshold = float(matched_widget.get("alert_threshold_percent", 50.0))
    alert_window = int(matched_widget.get("alert_window_minutes", 15))

    doc = {
        "_id": new_id(),
        "server_id": server["_id"],
        "widget_name": payload.widget_name.strip(),
        "database": payload.database.strip(),
        "collection": payload.collection.strip(),
        "window_minutes": int(payload.window_minutes),
        "total": total,
        "groups": groups,
        "alert_threshold_percent": alert_threshold,
        "alert_window_minutes": alert_window,
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
            "alert_threshold_percent": doc["alert_threshold_percent"],
            "alert_window_minutes": doc["alert_window_minutes"],
            "collected_at": doc["collected_at"].isoformat(),
            "received_at": doc["received_at"].isoformat(),
            "error": doc["error"],
        },
        room=f"server:{server['_id']}",
    )
    return {"success": True}


def template_doc_to_read(doc: dict) -> WidgetTemplateRead:
    return WidgetTemplateRead(
        id=str(doc["_id"]),
        name=doc["name"],
        description=doc.get("description", ""),
        database=doc["database"],
        collection=doc["collection"],
        enabled=bool(doc.get("enabled", True)),
        poll_interval_seconds=int(doc.get("poll_interval_seconds", 60)),
        window_minutes=int(doc.get("window_minutes", 60)),
        group_by_field=doc.get("group_by_field", "upload_status"),
        time_field=doc.get("time_field", "created_at"),
        max_groups=int(doc.get("max_groups", 10)),
        alert_threshold_percent=float(doc.get("alert_threshold_percent", 50.0)),
        alert_window_minutes=int(doc.get("alert_window_minutes", 15)),
        created_at=doc.get("created_at", now()),
        updated_at=doc.get("updated_at", now()),
    )


@router.get("/templates", response_model=list[WidgetTemplateRead])
async def list_widget_templates(
    _: dict = Depends(auth.get_current_user),
) -> list[WidgetTemplateRead]:
    """Dashboard endpoint: reusable widget definitions shared across servers."""
    docs = list(db.widget_templates().find({}).sort("name", 1).limit(100))
    return [template_doc_to_read(d) for d in docs]


@router.post(
    "/templates",
    response_model=WidgetTemplateRead,
    dependencies=[Depends(auth.require_admin)],
)
async def upsert_widget_template(
    payload: WidgetTemplateUpsert,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> WidgetTemplateRead:
    """Dashboard endpoint (admin): create or replace a template by name."""
    data = payload.model_dump()
    audit_trail.record(
        current, "template_save", request,
        {"kind": "widget", "name": data["name"], "database": data.get("database"), "collection": data.get("collection")},
    )
    existing = db.widget_templates().find_one({"name": data["name"]})
    if existing:
        db.widget_templates().update_one(
            {"_id": existing["_id"]},
            {"$set": {**data, "updated_at": now()}},
        )
        doc = db.widget_templates().find_one({"_id": existing["_id"]})
        assert doc is not None
        return template_doc_to_read(doc)
    doc = {
        "_id": new_id(),
        **data,
        "created_at": now(),
        "updated_at": now(),
    }
    db.widget_templates().insert_one(doc)
    return template_doc_to_read(doc)


@router.delete(
    "/templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(auth.require_admin)],
)
async def delete_widget_template(
    template_id: str,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> None:
    """Dashboard endpoint (admin): delete a reusable widget template."""
    doc = db.widget_templates().find_one({"_id": template_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    db.widget_templates().delete_one({"_id": template_id})
    audit_trail.record(
        current, "template_delete", request,
        {"kind": "widget", "name": doc.get("name")},
    )


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
