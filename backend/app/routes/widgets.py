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


from app.schemas.agent_config import TemplateSiteAssignRequest
from app.services.template_usage import (
    assign_widget_template_sites,
    get_all_widget_template_usages,
)


def template_doc_to_read(doc: dict, usage_resolver=None) -> WidgetTemplateRead:
    wid = str(doc["_id"])
    wname = doc["name"]
    if usage_resolver is not None:
        used_sites, used_servers, applied_count = usage_resolver(wid, wname)
    else:
        resolver = get_all_widget_template_usages()
        used_sites, used_servers, applied_count = resolver(wid, wname)

    return WidgetTemplateRead(
        id=wid,
        name=wname,
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
        include_values=doc.get("include_values", []),
        exclude_values=doc.get("exclude_values", []),
        target_site_ids=doc.get("target_site_ids"),
        created_at=doc.get("created_at", now()),
        updated_at=doc.get("updated_at", now()),
        used_by_sites=used_sites,
        used_by_servers=used_servers,
        applied_servers_count=applied_count,
    )


@router.get("/templates", response_model=list[WidgetTemplateRead])
async def list_widget_templates(
    _: dict = Depends(auth.get_current_user),
) -> list[WidgetTemplateRead]:
    """Dashboard endpoint: reusable widget definitions shared across servers."""
    docs = list(db.widget_templates().find({}).sort("name", 1).limit(100))
    resolver = get_all_widget_template_usages()
    return [template_doc_to_read(d, usage_resolver=resolver) for d in docs]


def propagate_widget_template(template_id: str, data: dict, old_name: str | None = None) -> int:
    """Propagate updated widget template to all servers currently configuring this widget."""
    server_configs = list(db.server_configs().find({
        "$or": [
            {"custom_widgets": {"$exists": True, "$ne": []}},
            {"widgets": {"$exists": True, "$ne": []}},
        ]
    }))
    count = 0
    names_to_match = {data["name"]}
    if old_name:
        names_to_match.add(old_name)

    for sc in server_configs:
        widgets = sc.get("custom_widgets") or sc.get("widgets") or []
        modified = False
        for w in widgets:
            if not isinstance(w, dict):
                continue
            is_match = (w.get("template_id") == template_id) or (w.get("name") in names_to_match)
            if is_match:
                w["name"] = data["name"]
                w["database"] = data["database"]
                w["collection"] = data["collection"]
                w["poll_interval_seconds"] = int(data.get("poll_interval_seconds", 60))
                w["window_minutes"] = int(data.get("window_minutes", 60))
                w["group_by_field"] = data.get("group_by_field", "upload_status")
                w["time_field"] = data.get("time_field", "created_at")
                w["max_groups"] = int(data.get("max_groups", 10))
                w["alert_threshold_percent"] = float(data.get("alert_threshold_percent", 50.0))
                w["alert_window_minutes"] = int(data.get("alert_window_minutes", 15))
                w["include_values"] = data.get("include_values", [])
                w["exclude_values"] = data.get("exclude_values", [])
                w["template_id"] = template_id
                w["template_name"] = data["name"]
                modified = True

        if modified:
            db.server_configs().update_one(
                {"_id": sc["_id"]},
                {"$set": {"custom_widgets": widgets, "widgets": widgets, "updated_at": now()}},
            )
            sid = str(sc.get("server_id"))
            emit("agent_config_updated", {"server_id": sid}, room=f"server:{sid}")
            count += 1

    return count


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
    target_site_ids = data.pop("target_site_ids", None)
    audit_trail.record(
        current, "template_save", request,
        {"kind": "widget", "name": data["name"], "database": data.get("database"), "collection": data.get("collection")},
    )
    existing = db.widget_templates().find_one({"name": data["name"]})
    if existing:
        tid = str(existing["_id"])
        db.widget_templates().update_one(
            {"_id": existing["_id"]},
            {"$set": {**data, "updated_at": now()}},
        )
        if target_site_ids is not None:
            assign_widget_template_sites(tid, target_site_ids)
        else:
            propagate_widget_template(tid, data, old_name=existing.get("name"))
        doc = db.widget_templates().find_one({"_id": existing["_id"]})
        assert doc is not None
        return template_doc_to_read(doc)
    
    tid = new_id()
    doc = {
        "_id": tid,
        **data,
        "created_at": now(),
        "updated_at": now(),
    }
    db.widget_templates().insert_one(doc)
    if target_site_ids is not None:
        assign_widget_template_sites(str(tid), target_site_ids)
    return template_doc_to_read(doc)


@router.put(
    "/templates/{template_id}",
    response_model=WidgetTemplateRead,
    dependencies=[Depends(auth.require_admin)],
)
async def update_widget_template(
    template_id: str,
    payload: WidgetTemplateUpsert,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> WidgetTemplateRead:
    """Dashboard endpoint (admin): update a widget template by ID and auto-sync linked servers."""
    doc = db.widget_templates().find_one({"_id": template_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    data = payload.model_dump()
    target_site_ids = data.pop("target_site_ids", None)
    old_name = doc.get("name")
    db.widget_templates().update_one(
        {"_id": template_id},
        {"$set": {**data, "updated_at": now()}},
    )
    if target_site_ids is not None:
        assign_widget_template_sites(template_id, target_site_ids)
    else:
        propagate_widget_template(template_id, data, old_name=old_name)

    audit_trail.record(
        current, "template_save", request,
        {"kind": "widget", "id": template_id, "name": data["name"], "database": data.get("database"), "collection": data.get("collection")},
    )
    updated = db.widget_templates().find_one({"_id": template_id})
    assert updated is not None
    return template_doc_to_read(updated)


@router.post(
    "/templates/{template_id}/assign-sites",
    response_model=WidgetTemplateRead,
    dependencies=[Depends(auth.require_admin)],
)
async def assign_widget_template_to_sites_endpoint(
    template_id: str,
    payload: TemplateSiteAssignRequest,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> WidgetTemplateRead:
    """Dashboard endpoint (admin): assign this widget template to specific sites only."""
    doc = db.widget_templates().find_one({"_id": template_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    count = assign_widget_template_sites(template_id, payload.site_ids)
    db.widget_templates().update_one(
        {"_id": template_id},
        {"$set": {"target_site_ids": payload.site_ids, "updated_at": now()}},
    )
    audit_trail.record(
        current, "template_assign_sites", request,
        {"kind": "widget", "id": template_id, "name": doc["name"], "site_ids": payload.site_ids, "servers_updated": count},
    )
    updated = db.widget_templates().find_one({"_id": template_id})
    assert updated is not None
    return template_doc_to_read(updated)


@router.post(
    "/templates/{template_id}/apply-all",
    response_model=dict,
    dependencies=[Depends(auth.require_admin)],
)
async def apply_widget_template_to_all(
    template_id: str,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> dict:
    """Dashboard endpoint (admin): add or update this widget across ALL site servers."""
    doc = db.widget_templates().find_one({"_id": template_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    widget_spec = {
        "name": doc["name"],
        "database": doc["database"],
        "collection": doc["collection"],
        "enabled": bool(doc.get("enabled", True)),
        "poll_interval_seconds": int(doc.get("poll_interval_seconds", 60)),
        "window_minutes": int(doc.get("window_minutes", 60)),
        "group_by_field": doc.get("group_by_field", "upload_status"),
        "time_field": doc.get("time_field", "created_at"),
        "max_groups": int(doc.get("max_groups", 10)),
        "alert_threshold_percent": float(doc.get("alert_threshold_percent", 50.0)),
        "alert_window_minutes": int(doc.get("alert_window_minutes", 15)),
        "include_values": doc.get("include_values", []),
        "exclude_values": doc.get("exclude_values", []),
        "template_id": template_id,
        "template_name": doc["name"],
    }

    servers = list(db.servers().find({}))
    count = 0
    for s in servers:
        sid = s["_id"]
        sc = db.server_configs().find_one({"server_id": sid}) or {}
        existing_widgets = list(sc.get("custom_widgets", []))
        idx = next((i for i, w in enumerate(existing_widgets) if w.get("template_id") == template_id or w.get("name") == doc["name"]), -1)
        if idx >= 0:
            existing_enabled = existing_widgets[idx].get("enabled", True)
            existing_widgets[idx] = {**widget_spec, "enabled": existing_enabled}
        else:
            existing_widgets.append(dict(widget_spec))

        db.server_configs().update_one(
            {"server_id": sid},
            {"$set": {"custom_widgets": existing_widgets, "updated_at": now()}},
            upsert=True,
        )
        emit("agent_config_updated", {"server_id": str(sid)}, room=f"server:{sid}")
        count += 1

    audit_trail.record(
        current, "template_apply_all", request,
        {"kind": "widget", "id": template_id, "name": doc["name"], "servers_updated": count},
    )
    return {"success": True, "applied_servers_count": count}


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
    configured widget_name is returned, newest first.
    """
    sid = parse_id(server_id)
    if sid is None or db.servers().find_one({"_id": sid}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    # Filter strictly to widgets currently configured on this server
    agent_cfg = app_settings.get_agent_config(str(sid))
    active_widgets = agent_cfg.get("custom_widgets") or []
    active_names = {w["name"].strip() for w in active_widgets if isinstance(w, dict) and w.get("name")}
    if not active_names:
        return []

    docs = list(
        db.widget_data()
        .find({"server_id": sid, "widget_name": {"$in": list(active_names)}})
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


@router.delete("/servers/{server_id}", response_model=dict)
async def clear_server_widgets(
    server_id: str,
    _: dict = Depends(auth.require_admin),
) -> dict:
    """Delete all historical widget samples for a server."""
    sid = parse_id(server_id)
    if sid is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    res = db.widget_data().delete_many({"server_id": sid})
    return {"deleted_count": res.deleted_count}


@router.delete("/servers/{server_id}/{widget_name}", response_model=dict)
async def delete_server_widget_sample(
    server_id: str,
    widget_name: str,
    _: dict = Depends(auth.require_admin),
) -> dict:
    """Delete historical samples of a specific widget for a server."""
    sid = parse_id(server_id)
    if sid is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    res = db.widget_data().delete_many({"server_id": sid, "widget_name": widget_name.strip()})
    return {"deleted_count": res.deleted_count}


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
