"""Reusable agent-runtime settings templates (define once, apply per server)."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.database import models as db
from app.database.connection import new_id
from app.schemas.agent_config import RuntimeTemplateRead, RuntimeTemplateUpsert
from app.services import authentication as auth
from app.services import audit as audit_trail

router = APIRouter(prefix="/api/v1/agent-config-templates", tags=["agent-config-templates"])


def now() -> datetime:
    return datetime.now(timezone.utc)


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
