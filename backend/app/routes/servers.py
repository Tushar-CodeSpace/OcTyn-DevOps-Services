"""Server CRUD routes (dashboard users only)."""

import platform
import re
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.schemas.server import ServerCreate, ServerRead, ServerUpdate
from app.services import authentication as auth

router = APIRouter(
    prefix="/api/v1/servers",
    tags=["servers"],
    dependencies=[Depends(auth.get_current_user)],
)


def now() -> datetime:
    return datetime.now(timezone.utc)


def server_doc_to_read(doc: dict) -> ServerRead:
    return ServerRead(
        id=doc["_id"],
        site_id=doc["site_id"],
        name=doc["name"],
        hostname=doc["hostname"],
        ip_address=doc.get("ip_address"),
        status=doc.get("status", "unknown"),
        last_seen_at=doc.get("last_seen_at"),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


def find_server_or_404(server_id: str) -> dict:
    sid = parse_id(server_id)
    doc = db.servers().find_one({"_id": sid}) if sid else None
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    return doc


def verify_site_exists(site_id: str) -> None:
    sid = parse_id(site_id)
    if sid is None or db.sites().find_one({"_id": sid}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")


@router.get("", response_model=list[ServerRead])
async def list_servers(
    site_id: Optional[str] = Query(default=None, description="Filter by site"),
) -> list[ServerRead]:
    query: dict = {}
    if site_id:
        sid = parse_id(site_id)
        if sid is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
        query["site_id"] = sid
    docs = list(db.servers().find(query).sort("created_at", 1))
    return [server_doc_to_read(d) for d in docs]


@router.post(
    "",
    response_model=ServerRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth.require_admin)],
)
async def create_server(body: ServerCreate) -> ServerRead:
    verify_site_exists(body.site_id)
    if db.servers().find_one({"hostname": body.hostname}):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Hostname already exists"
        )
    sid = parse_id(body.site_id)
    doc = (
        body.model_dump(exclude={"site_id"})
        | {"_id": new_id(), "site_id": sid, "status": "unknown", "last_seen_at": None, "created_at": now(), "updated_at": now()}
    )
    db.servers().insert_one(doc)
    created = server_doc_to_read(doc)
    emit("server_created", created.model_dump(mode="json"))
    return created


@router.get("/{server_id}", response_model=ServerRead)
async def get_server(server_id: str) -> ServerRead:
    return server_doc_to_read(find_server_or_404(server_id))


@router.patch(
    "/{server_id}",
    response_model=ServerRead,
    dependencies=[Depends(auth.require_admin)],
)
async def update_server(server_id: str, body: ServerUpdate) -> ServerRead:
    doc = find_server_or_404(server_id)
    updates: dict = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "site_id" in updates:
        verify_site_exists(updates["site_id"])
        updates["site_id"] = parse_id(updates["site_id"])
    if "hostname" in updates and updates["hostname"] != doc["hostname"]:
        if db.servers().find_one({"hostname": updates["hostname"]}):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Hostname already exists"
            )
    if updates:
        updates["updated_at"] = now()
        db.servers().update_one({"_id": doc["_id"]}, {"$set": updates})
    updated = server_doc_to_read(db.servers().find_one({"_id": doc["_id"]}))
    emit("server_updated", updated.model_dump(mode="json"))
    return updated


@router.delete(
    "/{server_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(auth.require_admin)],
)
async def delete_server(server_id: str) -> None:
    doc = find_server_or_404(server_id)
    # Cascade: agent credentials, services, metrics, config overrides and alerts
    db.api_keys().delete_many({"server_id": doc["_id"]})
    db.services().delete_many({"server_id": doc["_id"]})
    db.metrics().delete_many({"server_id": doc["_id"]})
    db.alerts().delete_many({"server_id": doc["_id"]})
    db.server_configs().delete_many({"server_id": doc["_id"]})
    db.servers().delete_one({"_id": doc["_id"]})
    emit("server_deleted", {"server_id": str(doc["_id"])})


class PingRequest(BaseModel):
    """Optional target override for a connectivity ping."""

    target: Optional[str] = None


def _run_ping(target: str, timeout: float = 15.0) -> dict:
    """Run an OS ICMP ping to `target` and parse latency / packet-loss.

    Uses the platform `ping` binary so it works without raw-socket privileges.
    """
    is_windows = platform.system().lower() == "windows"
    ping_bin = shutil.which("ping")
    if not ping_bin:
        return {
            "target": target,
            "reachable": False,
            "loss_pct": 100,
            "avg_latency_ms": None,
            "output": "",
            "error": "ping binary not available on this host",
        }
    if is_windows:
        cmd = [ping_bin, "-n", "4", "-w", "3000", target]
    else:
        cmd = [ping_bin, "-c", "4", "-W", "3", target]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
        output = (proc.stdout or "") + (proc.stderr or "")
        ok = proc.returncode == 0
    except FileNotFoundError as exc:
        return {
            "target": target,
            "reachable": False,
            "loss_pct": 100,
            "avg_latency_ms": None,
            "output": "",
            "error": f"ping failed: {exc}",
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "target": target,
            "reachable": False,
            "loss_pct": 100,
            "avg_latency_ms": None,
            "output": "",
            "error": "ping timed out",
        }

    loss_pct = 100.0
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", output)
    if m:
        try:
            loss_pct = float(m.group(1))
        except ValueError:
            pass

    avg_latency_ms = None
    if is_windows:
        m = re.search(r"Average\s*=\s*(\d+)\s*ms", output, re.IGNORECASE)
        if m:
            avg_latency_ms = float(m.group(1))
    else:
        m = re.search(r"=\s*([\d.]+)\s*/\s*([\d.]+)\s*/\s*([\d.]+)", output)
        if m:
            avg_latency_ms = float(m.group(2))  # avg is the 2nd rtt value

    return {
        "target": target,
        "reachable": bool(ok),
        "loss_pct": loss_pct,
        "avg_latency_ms": avg_latency_ms,
        "output": (output or "").strip()[:2000],
        "error": None if ok else "host unreachable",
    }


@router.post(
    "/{server_id}/ping",
    response_model=None,
    dependencies=[Depends(auth.require_admin)],
)
async def ping_server(server_id: str, body: PingRequest) -> dict:
    """Ping a site server from the central host to verify connectivity.

    Targets the server's stored IP address by default; pass `target` to
    override (e.g. when the stored IP is stale or you want to probe a
    specific host/port address).
    """
    doc = find_server_or_404(server_id)
    target = (body.target or "").strip()
    if not target:
        target = (doc.get("ip_address") or "").strip()
    if not target:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No IP address set for this server; provide a target",
        )
    return _run_ping(target)