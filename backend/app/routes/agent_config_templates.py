"""Reusable agent-runtime settings templates (define once, apply per server)."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.database import models as db
from app.database.connection import new_id
from app.realtime import emit
from app.schemas.agent_config import RuntimeTemplateRead, RuntimeTemplateUpsert
from app.services import authentication as auth
from app.services import audit as audit_trail

router = APIRouter(prefix="/api/v1/agent-config-templates", tags=["agent-config-templates"])


def now() -> datetime:
    return datetime.now(timezone.utc)


def propagate_runtime_template(template_id: str, data: dict, old_name: str | None = None) -> int:
    """Propagate updated runtime template to all servers currently configured with it."""
    filter_criteria = [
        {"runtime_template_id": template_id},
        {"runtime_template_name": data["name"]},
    ]
    if old_name and old_name != data["name"]:
        filter_criteria.append({"runtime_template_name": old_name})

    matching_configs = list(db.server_configs().find({"$or": filter_criteria}))
    update_payload = {
        "monitoring_interval_seconds": int(data.get("monitoring_interval_seconds", 60)),
        "http_timeout_seconds": int(data.get("http_timeout_seconds", 10)),
        "http_retry_count": int(data.get("http_retry_count", 3)),
        "config_poll_interval_seconds": int(data.get("config_poll_interval_seconds", 5)),
        "connectivity_poll_interval_seconds": int(data.get("connectivity_poll_interval_seconds", 15)),
        "connectivity_targets": data.get("connectivity_targets", []),
        "runtime_template_id": template_id,
        "runtime_template_name": data["name"],
        "updated_at": now(),
    }
    count = 0
    for sc in matching_configs:
        db.server_configs().update_one({"_id": sc["_id"]}, {"$set": update_payload})
        sid = str(sc.get("server_id"))
        emit("agent_config_updated", {"server_id": sid}, room=f"server:{sid}")
        count += 1
    return count


def template_doc_to_read(doc: dict) -> RuntimeTemplateRead:
    return RuntimeTemplateRead(
        id=str(doc["_id"]),
        name=doc["name"],
        description=doc.get("description", ""),
        monitoring_interval_seconds=int(doc.get("monitoring_interval_seconds", 60)),
        http_timeout_seconds=int(doc.get("http_timeout_seconds", 10)),
        http_retry_count=int(doc.get("http_retry_count", 3)),
        config_poll_interval_seconds=int(doc.get("config_poll_interval_seconds", 5)),
        connectivity_poll_interval_seconds=int(doc.get("connectivity_poll_interval_seconds", 15)),
        connectivity_targets=[
            {"name": str(t.get("name", "")), "ip": str(t.get("ip", ""))}
            for t in doc.get("connectivity_targets", [])
            if isinstance(t, dict)
        ],
        created_at=doc.get("created_at", now()),
        updated_at=doc.get("updated_at", now()),
    )


@router.get("", response_model=list[RuntimeTemplateRead])
async def list_runtime_templates(
    _: dict = Depends(auth.get_current_user),
) -> list[RuntimeTemplateRead]:
    """Dashboard endpoint: reusable runtime settings shared across servers."""
    docs = list(db.agent_config_templates().find({}).sort("name", 1).limit(100))
    return [template_doc_to_read(d) for d in docs]


@router.post(
    "",
    response_model=RuntimeTemplateRead,
    dependencies=[Depends(auth.require_admin)],
)
async def upsert_runtime_template(
    payload: RuntimeTemplateUpsert,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> RuntimeTemplateRead:
    """Dashboard endpoint (admin): create or replace a template by name."""
    data = payload.model_dump()
    audit_trail.record(
        current, "template_save", request,
        {"kind": "runtime", "name": data["name"]},
    )
    existing = db.agent_config_templates().find_one({"name": data["name"]})
    if existing:
        db.agent_config_templates().update_one(
            {"_id": existing["_id"]},
            {"$set": {**data, "updated_at": now()}},
        )
        propagate_runtime_template(str(existing["_id"]), data, old_name=existing.get("name"))
        doc = db.agent_config_templates().find_one({"_id": existing["_id"]})
        assert doc is not None
        return template_doc_to_read(doc)
    doc = {
        "_id": new_id(),
        **data,
        "created_at": now(),
        "updated_at": now(),
    }
    db.agent_config_templates().insert_one(doc)
    return template_doc_to_read(doc)


@router.put(
    "/{template_id}",
    response_model=RuntimeTemplateRead,
    dependencies=[Depends(auth.require_admin)],
)
async def update_runtime_template(
    template_id: str,
    payload: RuntimeTemplateUpsert,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> RuntimeTemplateRead:
    """Dashboard endpoint (admin): update a runtime template by ID and auto-sync all linked servers."""
    doc = db.agent_config_templates().find_one({"_id": template_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    data = payload.model_dump()
    old_name = doc.get("name")
    db.agent_config_templates().update_one(
        {"_id": template_id},
        {"$set": {**data, "updated_at": now()}},
    )
    # Auto-propagate changes to all servers utilizing this template
    propagate_runtime_template(template_id, data, old_name=old_name)

    audit_trail.record(
        current, "template_save", request,
        {"kind": "runtime", "id": template_id, "name": data["name"]},
    )
    updated = db.agent_config_templates().find_one({"_id": template_id})
    assert updated is not None
    return template_doc_to_read(updated)


@router.post(
    "/{template_id}/apply-all",
    response_model=dict,
    dependencies=[Depends(auth.require_admin)],
)
async def apply_runtime_template_to_all(
    template_id: str,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> dict:
    """Dashboard endpoint (admin): apply this runtime template to ALL site servers."""
    doc = db.agent_config_templates().find_one({"_id": template_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    
    servers = list(db.servers().find({}))
    update_payload = {
        "monitoring_interval_seconds": int(doc.get("monitoring_interval_seconds", 60)),
        "http_timeout_seconds": int(doc.get("http_timeout_seconds", 10)),
        "http_retry_count": int(doc.get("http_retry_count", 3)),
        "config_poll_interval_seconds": int(doc.get("config_poll_interval_seconds", 5)),
        "connectivity_poll_interval_seconds": int(doc.get("connectivity_poll_interval_seconds", 15)),
        "connectivity_targets": doc.get("connectivity_targets", []),
        "runtime_template_id": template_id,
        "runtime_template_name": doc["name"],
        "updated_at": now(),
    }
    count = 0
    for s in servers:
        sid = s["_id"]
        db.server_configs().update_one(
            {"server_id": sid},
            {"$set": update_payload},
            upsert=True,
        )
        emit("agent_config_updated", {"server_id": str(sid)}, room=f"server:{sid}")
        count += 1

    audit_trail.record(
        current, "template_apply_all", request,
        {"kind": "runtime", "id": template_id, "name": doc["name"], "servers_updated": count},
    )
    return {"success": True, "applied_servers_count": count}


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(auth.require_admin)],
)
async def delete_runtime_template(
    template_id: str,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> None:
    """Dashboard endpoint (admin): delete a runtime template."""
    doc = db.agent_config_templates().find_one({"_id": template_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    db.agent_config_templates().delete_one({"_id": template_id})
    audit_trail.record(
        current, "template_delete", request,
        {"kind": "runtime", "name": doc.get("name")},
    )
