"""Service routes: agent reports services, dashboard views, manages, enables/disables, and deletes them."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.schemas.service import ServiceCreate, ServiceRead, ServiceReport, ServiceUpdate
from app.services import authentication as auth
from app.services.monitoring import authenticate_agent

router = APIRouter(prefix="/api/v1", tags=["services"])


def now() -> datetime:
    return datetime.now(timezone.utc)


def _sync_monitored_services_to_config(server_id):
    """Sync active enabled services to server_configs so agent dynamically gets monitored list."""
    sid = parse_id(server_id) or server_id
    services = list(db.services().find({"server_id": sid, "enabled": {"$ne": False}}))
    specs = []
    for s in services:
        if s.get("port"):
            specs.append(f"{s['name']}:{s['port']}")
        else:
            specs.append(s["name"])
    db.server_configs().update_one(
        {"server_id": sid},
        {"$set": {"monitored_services": specs, "updated_at": now()}},
        upsert=True,
    )


def service_doc_to_read(doc: dict) -> ServiceRead:
    return ServiceRead(
        id=str(doc["_id"]),
        server_id=str(doc["server_id"]),
        name=doc["name"],
        status=doc.get("status", "unknown") if doc.get("enabled", True) else "disabled",
        port=doc.get("port"),
        enabled=doc.get("enabled", True),
        last_checked_at=doc.get("last_checked_at", now()),
    )


@router.post("/services", status_code=status.HTTP_200_OK)
async def report_services(
    reports: list[ServiceReport],
    agent: dict = Depends(authenticate_agent),
) -> dict:
    """Agent endpoint: upsert the reported service statuses for its server."""
    server = agent["server"]
    timestamp = now()
    for report in reports:
        if report.server_id != server["_id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API key does not match server_id",
            )
        db.services().update_one(
            {"server_id": server["_id"], "name": report.name},
            {
                "$set": {
                    "status": report.status,
                    "port": report.port,
                    "last_checked_at": timestamp,
                },
                "$setOnInsert": {
                    "_id": new_id(),
                    "server_id": server["_id"],
                    "name": report.name,
                    "enabled": True,
                },
            },
            upsert=True,
        )
    emit("service_update", {"server_id": server["_id"]}, room=f"server:{server['_id']}")
    return {"success": True, "reported": len(reports)}


@router.get("/servers/{server_id}/services", response_model=list[ServiceRead])
async def list_services(
    server_id: str,
    _: dict = Depends(auth.get_current_user),
) -> list[ServiceRead]:
    """Dashboard endpoint: current service statuses for a server."""
    sid = parse_id(server_id)
    if sid is None or db.servers().find_one({"_id": sid}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    docs = list(db.services().find({"server_id": sid}).sort("name", 1))
    return [service_doc_to_read(d) for d in docs]


@router.post(
    "/servers/{server_id}/services",
    response_model=ServiceRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth.require_admin)],
)
async def add_service_to_monitor(server_id: str, body: ServiceCreate) -> ServiceRead:
    """Admin endpoint: Add a new service to monitor for a server."""
    sid = parse_id(server_id)
    if sid is None or db.servers().find_one({"_id": sid}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    raw_name = body.name.strip()
    port = body.port

    if ":" in raw_name and port is None:
        parts = raw_name.rsplit(":", 1)
        if parts[1].isdigit():
            raw_name = parts[0]
            port = int(parts[1])

    doc_id = new_id()
    doc = {
        "_id": doc_id,
        "server_id": sid,
        "name": raw_name,
        "port": port,
        "status": "unknown" if body.enabled else "disabled",
        "enabled": body.enabled,
        "last_checked_at": now(),
    }

    db.services().update_one(
        {"server_id": sid, "name": raw_name},
        {"$set": doc},
        upsert=True,
    )
    saved = db.services().find_one({"server_id": sid, "name": raw_name}) or doc

    _sync_monitored_services_to_config(server_id)
    emit("service_update", {"server_id": str(sid)}, room=f"server:{sid}")
    return service_doc_to_read(saved)


@router.patch(
    "/services/{service_id}",
    response_model=ServiceRead,
    dependencies=[Depends(auth.require_admin)],
)
async def update_service_monitoring(service_id: str, body: ServiceUpdate) -> ServiceRead:
    """Admin endpoint: Enable/disable monitoring or update port for a service."""
    oid = parse_id(service_id)
    doc = db.services().find_one({"_id": oid}) if oid else None
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    updates = {}
    if body.enabled is not None:
        updates["enabled"] = body.enabled
        if not body.enabled:
            updates["status"] = "disabled"
        elif doc.get("status") == "disabled":
            updates["status"] = "unknown"
    if body.port is not None:
        updates["port"] = body.port

    if updates:
        db.services().update_one({"_id": doc["_id"]}, {"$set": updates})

    updated = db.services().find_one({"_id": doc["_id"]}) or doc
    _sync_monitored_services_to_config(str(doc["server_id"]))
    emit("service_update", {"server_id": str(doc["server_id"])}, room=f"server:{doc['server_id']}")
    return service_doc_to_read(updated)


@router.delete(
    "/services/{service_id}",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(auth.require_admin)],
)
async def delete_service_from_monitoring(service_id: str) -> dict:
    """Admin endpoint: Delete a service from the monitoring list."""
    oid = parse_id(service_id)
    doc = db.services().find_one({"_id": oid}) if oid else None
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    db.services().delete_one({"_id": doc["_id"]})
    _sync_monitored_services_to_config(str(doc["server_id"]))
    emit("service_update", {"server_id": str(doc["server_id"])}, room=f"server:{doc['server_id']}")
    return {"success": True}