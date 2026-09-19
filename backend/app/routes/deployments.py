"""Software deployment routes: Software definitions, deployment triggers, and agent polling/streaming."""

from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.schemas.deployments import (
    DeploymentFinishPayload,
    DeploymentLogEntry,
    DeploymentLogStream,
    DeploymentRead,
    DeploymentTriggerRequest,
    SoftwareCreate,
    SoftwareRead,
)
from app.services import audit as audit_trail
from app.services import authentication as auth
from app.services.monitoring import authenticate_agent

router = APIRouter(prefix="/api/v1/deployments", tags=["deployments"])


def now() -> datetime:
    return datetime.now(timezone.utc)


def _software_doc_to_read(doc: dict) -> SoftwareRead:
    return SoftwareRead(
        id=str(doc["_id"]),
        name=doc["name"],
        description=doc.get("description", ""),
        components=doc.get("components", []),
        config_repo=doc.get("config_repo"),
        created_at=doc.get("created_at", now()),
        updated_at=doc.get("updated_at", now()),
        created_by=doc.get("created_by"),
    )


def _deployment_doc_to_read(doc: dict) -> DeploymentRead:
    sid = doc.get("server_id")
    server = db.servers().find_one({"_id": parse_id(sid)}) if sid else None
    server_name = server["name"] if server else "Unknown Server"
    site = db.sites().find_one({"_id": server["site_id"]}) if server and server.get("site_id") else None
    site_name = f"{site['client']} - {site['location']}" if site else "Unknown Site"

    logs = [
        DeploymentLogEntry(
            ts=l.get("ts", now()),
            stage=l.get("stage", "STAGE"),
            line=l.get("line", ""),
            level=l.get("level", "info"),
        )
        for l in doc.get("logs", [])
    ]

    return DeploymentRead(
        id=str(doc["_id"]),
        batch_id=str(doc["batch_id"]) if doc.get("batch_id") else None,
        server_id=str(sid),
        server_name=server_name,
        site_name=site_name,
        software_id=str(doc.get("software_id", "")),
        software_name=doc.get("software_name", "Software"),
        status=doc.get("status", "pending"),
        components_selected=doc.get("components_selected", []),
        branches=doc.get("branches", {}),
        client_name=doc.get("client_name"),
        machine_type=doc.get("machine_type"),
        triggered_by=doc.get("triggered_by", "system"),
        started_at=doc.get("started_at", now()),
        finished_at=doc.get("finished_at"),
        duration_seconds=doc.get("duration_seconds"),
        exit_code=doc.get("exit_code"),
        logs=logs,
    )


# Seed default 'nidoworkz' template if no software exists
def _ensure_default_nidoworkz():
    if db.softwares().count_documents({}) == 0:
        doc = {
            "_id": new_id(),
            "name": "nidoworkz",
            "description": "Nidoworkz Monorepo Node.js v24 (PM2) Backend + PHP 8.4 (Nginx) Frontend + Client Configs",
            "components": [
                {
                    "name": "Backend Monorepo",
                    "type": "nodejs_monorepo",
                    "repo_url": "git@github.com:nidoworkz/backend.git",
                    "default_branch": "main",
                    "target_dir": "/opt/nidoworkz/backend",
                    "runtime_version": "24",
                    "build_command": "npm install && npm run build",
                    "start_command": "pm2 startOrRestart ecosystem.config.js || pm2 restart all",
                    "env_vars": {"NODE_ENV": "production", "PORT": "3000"},
                },
                {
                    "name": "Frontend PHP",
                    "type": "php_nginx",
                    "repo_url": "git@github.com:nidoworkz/frontend.git",
                    "default_branch": "main",
                    "target_dir": "/var/www/nidoworkz-frontend",
                    "runtime_version": "8.4",
                    "build_command": "composer install --no-dev --optimize-autoloader || true",
                    "start_command": "sudo systemctl reload nginx && sudo systemctl restart php8.4-fpm || sudo systemctl restart php-fpm || true",
                    "env_vars": {"APP_ENV": "production"},
                },
            ],
            "config_repo": {
                "name": "Client Machine Configs",
                "repo_url": "git@github.com:nidoworkz/configs.git",
                "default_branch": "main",
                "target_dir": "/opt/nidoworkz/configs",
                "profile_pattern": "configs/{client}/{machine_type}",
                "import_to_mongo": True,
                "mongo_database": "identity_service",
                "import_script": "python3 /opt/nidoworkz/configs/import_configs.py --client {client} --machine {machine_type} || true",
            },
            "created_at": now(),
            "updated_at": now(),
            "created_by": "system",
        }
        db.softwares().insert_one(doc)


# ============================== Softwares CRUD ==============================

@router.get("/softwares", response_model=List[SoftwareRead])
async def list_softwares(_: dict = Depends(auth.get_current_user)):
    """List all configured software definitions."""
    _ensure_default_nidoworkz()
    docs = list(db.softwares().find({}).sort("name", 1))
    return [_software_doc_to_read(d) for d in docs]


@router.post("/softwares", response_model=SoftwareRead, dependencies=[Depends(auth.require_admin)])
async def create_software(
    payload: SoftwareCreate,
    request: Request,
    current: dict = Depends(auth.require_admin),
):
    """Create a new software definition (Admin/SuperAdmin)."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Software name is required")

    existing = db.softwares().find_one({"name": name})
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Software '{name}' already exists")

    doc = {
        "_id": new_id(),
        **payload.model_dump(),
        "created_at": now(),
        "updated_at": now(),
        "created_by": current.get("email"),
    }
    db.softwares().insert_one(doc)
    audit_trail.record(current, "software_create", request, {"software_name": name})
    return _software_doc_to_read(doc)


@router.put("/softwares/{software_id}", response_model=SoftwareRead, dependencies=[Depends(auth.require_admin)])
async def update_software(
    software_id: str,
    payload: SoftwareCreate,
    request: Request,
    current: dict = Depends(auth.require_admin),
):
    """Update a software definition by ID (Admin/SuperAdmin)."""
    sid = parse_id(software_id)
    doc = db.softwares().find_one({"_id": sid})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Software not found")

    data = payload.model_dump()
    data["updated_at"] = now()
    db.softwares().update_one({"_id": sid}, {"$set": data})
    audit_trail.record(current, "software_update", request, {"software_id": software_id, "name": payload.name})

    updated = db.softwares().find_one({"_id": sid})
    assert updated is not None
    return _software_doc_to_read(updated)


@router.delete("/softwares/{software_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(auth.require_admin)])
async def delete_software(
    software_id: str,
    request: Request,
    current: dict = Depends(auth.require_admin),
):
    """Delete a software definition (Admin/SuperAdmin)."""
    sid = parse_id(software_id)
    doc = db.softwares().find_one({"_id": sid})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Software not found")

    db.softwares().delete_one({"_id": sid})
    audit_trail.record(current, "software_delete", request, {"software_id": software_id, "name": doc.get("name")})


# ============================== Deployment Runs ==============================
 
@router.get("", response_model=List[DeploymentRead])
async def list_deployments(
    server_id: Optional[str] = None,
    software_id: Optional[str] = None,
    batch_id: Optional[str] = None,
    limit: int = 100,
    _: dict = Depends(auth.get_current_user),
):
    """List deployment execution history."""
    query = {}
    if server_id:
        sid = parse_id(server_id)
        if sid:
            query["server_id"] = sid
    if software_id:
        query["software_id"] = software_id
    if batch_id:
        query["batch_id"] = batch_id

    docs = list(db.deployments().find(query).sort("created_at", -1).limit(min(200, max(1, limit))))
    return [_deployment_doc_to_read(d) for d in docs]


@router.get("/{deployment_id}", response_model=DeploymentRead)
async def get_deployment(deployment_id: str, _: dict = Depends(auth.get_current_user)):
    """Get full deployment status with execution logs."""
    did = parse_id(deployment_id)
    doc = db.deployments().find_one({"_id": did})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deployment not found")
    return _deployment_doc_to_read(doc)


@router.post("/run", dependencies=[Depends(auth.require_admin)])
async def trigger_deployment(
    payload: DeploymentTriggerRequest,
    request: Request,
    current: dict = Depends(auth.require_admin),
):
    """Trigger and queue a software deployment to a single site or multiple sites (Admin/SuperAdmin)."""
    target_server_ids = []
    if payload.server_ids:
        target_server_ids = [s for s in payload.server_ids if s]
    elif payload.server_id:
        target_server_ids = [payload.server_id]

    if not target_server_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one target server must be selected"
        )

    sw_id = parse_id(payload.software_id)
    software = db.softwares().find_one({"_id": sw_id})
    if not software:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Software definition not found")

    batch_id = new_id() if len(target_server_ids) > 1 else None
    created = []

    for sid_raw in target_server_ids:
        sid = parse_id(sid_raw)
        server = db.servers().find_one({"_id": sid})
        if not server:
            continue

        # Resolve client name and machine type if not supplied
        client_name = payload.client_name or ""
        machine_type = payload.machine_type or server.get("hostname", "")
        if not client_name and server.get("site_id"):
            site = db.sites().find_one({"_id": server["site_id"]})
            if site:
                client_name = site.get("client", "")

        components = payload.components_selected or [c["name"] for c in software.get("components", [])]
        dep_id = new_id()

        doc = {
            "_id": dep_id,
            "batch_id": batch_id,
            "server_id": sid,
            "software_id": str(software["_id"]),
            "software_name": software["name"],
            "status": "pending",
            "components_selected": components,
            "branches": payload.branches or {},
            "client_name": client_name,
            "machine_type": machine_type,
            "triggered_by": current.get("email", "admin"),
            "logs": [
                {
                    "ts": now(),
                    "stage": "QUEUE",
                    "line": f"Deployment queued by {current.get('email')} for software '{software['name']}'" + (f" (Batch #{batch_id[:8]})" if batch_id else ""),
                    "level": "info",
                }
            ],
            "created_at": now(),
            "started_at": now(),
            "finished_at": None,
            "duration_seconds": None,
            "exit_code": None,
        }
        db.deployments().insert_one(doc)
        read_obj = _deployment_doc_to_read(doc)
        created.append(read_obj)

        emit(
            "deployment_created",
            {
                "id": str(dep_id),
                "batch_id": batch_id,
                "server_id": str(sid),
                "software_name": software["name"],
            },
        )

    if not created:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No valid target servers found")

    audit_trail.record(
        current,
        "deployment_trigger",
        request,
        {
            "batch_id": batch_id,
            "count": len(created),
            "software": software["name"],
            "server_ids": [str(d.server_id) for d in created],
        },
    )

    if len(created) == 1:
        return created[0]
    return {
        "batch_id": batch_id,
        "deployments": created,
        "count": len(created),
    }


@router.post("/{deployment_id}/cancel", dependencies=[Depends(auth.require_admin)])
async def cancel_deployment(
    deployment_id: str,
    request: Request,
    current: dict = Depends(auth.require_admin),
):
    """Cancel an active or pending deployment."""
    did = parse_id(deployment_id)
    doc = db.deployments().find_one({"_id": did})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deployment not found")

    db.deployments().update_one(
        {"_id": did},
        {
            "$set": {
                "status": "cancelled",
                "finished_at": now(),
            },
            "$push": {
                "logs": {
                    "ts": now(),
                    "stage": "CANCEL",
                    "line": f"Deployment cancelled by {current.get('email')}",
                    "level": "warn",
                }
            },
        },
    )
    emit("deployment_status", {"id": str(did), "status": "cancelled"})
    return {"success": True}


# ============================== Agent Endpoints ==============================

@router.get("/poll")
async def agent_poll_deployment(agent: dict = Depends(authenticate_agent)):
    """Site agent polls for any queued deployment job."""
    server = agent["server"]
    sid = server["_id"]
    doc = db.deployments().find_one({"server_id": sid, "status": "pending"}, sort=[("created_at", 1)])
    if not doc:
        return {"job": None}

    did = doc["_id"]
    db.deployments().update_one(
        {"_id": did},
        {"$set": {"status": "running", "started_at": now()}},
    )

    # Fetch full software spec to send to agent
    sw_id = parse_id(doc.get("software_id"))
    software = db.softwares().find_one({"_id": sw_id}) if sw_id else None
    if not software:
        db.deployments().update_one(
            {"_id": did},
            {"$set": {"status": "failed", "exit_code": 1, "finished_at": now()}},
        )
        return {"job": None}

    emit("deployment_status", {"id": str(did), "status": "running"})

    return {
        "job": {
            "deployment_id": str(did),
            "software_name": software["name"],
            "components": [
                c for c in software.get("components", [])
                if not doc.get("components_selected") or c["name"] in doc["components_selected"]
            ],
            "config_repo": software.get("config_repo"),
            "branches": doc.get("branches", {}),
            "client_name": doc.get("client_name", ""),
            "machine_type": doc.get("machine_type", ""),
        }
    }


@router.post("/{deployment_id}/stream")
async def agent_stream_deployment_log(
    deployment_id: str,
    payload: DeploymentLogStream,
    agent: dict = Depends(authenticate_agent),
):
    """Site agent streams live execution stdout/stderr line."""
    server = agent["server"]
    did = parse_id(deployment_id)
    entry = {
        "ts": now(),
        "stage": payload.stage,
        "line": payload.line,
        "level": payload.level,
    }
    db.deployments().update_one(
        {"_id": did},
        {"$push": {"logs": entry}},
    )
    emit(
        "deployment_log",
        {
            "deployment_id": str(did),
            "server_id": str(server["_id"]),
            "entry": {
                "ts": entry["ts"].isoformat(),
                "stage": entry["stage"],
                "line": entry["line"],
                "level": entry["level"],
            },
        },
    )
    return {"received": True}


@router.post("/{deployment_id}/finish")
async def agent_finish_deployment(
    deployment_id: str,
    payload: DeploymentFinishPayload,
    agent: dict = Depends(authenticate_agent),
):
    """Site agent reports deployment completion status."""
    server = agent["server"]
    did = parse_id(deployment_id)
    update_data = {
        "status": payload.status,
        "exit_code": payload.exit_code,
        "duration_seconds": payload.duration_seconds,
        "finished_at": now(),
    }
    db.deployments().update_one({"_id": did}, {"$set": update_data})
    emit("deployment_status", {"id": str(did), "status": payload.status, "exit_code": payload.exit_code})
    return {"success": True}
