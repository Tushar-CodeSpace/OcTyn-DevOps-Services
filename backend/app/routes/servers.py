"""Server CRUD routes (dashboard users only)."""

import platform
import re
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.schemas.server import ServerCreate, ServerRead, ServerUpdate
from app.services import authentication as auth
from app.services import audit as audit_trail

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
        site_id=str(doc.get("site_id") or ""),
        name=str(doc.get("name") or doc.get("hostname") or doc["_id"]),
        hostname=str(doc.get("hostname") or doc.get("name") or doc["_id"]),
        ip_address=doc.get("ip_address"),
        status=doc.get("status", "unknown"),
        last_seen_at=doc.get("last_seen_at"),
        created_at=doc.get("created_at") or now(),
        updated_at=doc.get("updated_at") or now(),
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
)
async def create_server(
    body: ServerCreate,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> ServerRead:
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
    audit_trail.record(
        current, "server_create", request,
        {"server": doc.get("hostname"), "name": doc.get("name"), "server_id": str(doc["_id"])},
    )
    created = server_doc_to_read(doc)
    emit("server_created", created.model_dump(mode="json"))
    return created


@router.get("/{server_id}", response_model=ServerRead)
async def get_server(server_id: str) -> ServerRead:
    return server_doc_to_read(find_server_or_404(server_id))


@router.patch(
    "/{server_id}",
    response_model=ServerRead,
)
async def update_server(
    server_id: str,
    body: ServerUpdate,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> ServerRead:
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
        audit_trail.record(
            current, "server_update", request,
            {
                "server": doc.get("hostname"),
                "server_id": str(doc["_id"]),
                "keys": sorted(k for k in updates.keys() if k != "updated_at"),
                "values": updates,
            },
        )
    updated = server_doc_to_read(db.servers().find_one({"_id": doc["_id"]}))
    emit("server_updated", updated.model_dump(mode="json"))
    return updated


@router.delete(
    "/{server_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_server(
    server_id: str,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> None:
    doc = find_server_or_404(server_id)
    # Cascade: agent credentials, services, metrics, config overrides and alerts
    db.api_keys().delete_many({"server_id": doc["_id"]})
    db.services().delete_many({"server_id": doc["_id"]})
    db.metrics().delete_many({"server_id": doc["_id"]})
    db.alerts().delete_many({"server_id": doc["_id"]})
    db.server_configs().delete_many({"server_id": doc["_id"]})
    db.servers().delete_one({"_id": doc["_id"]})
    audit_trail.record(
        current, "server_delete", request,
        {"server": doc.get("hostname"), "name": doc.get("name"), "server_id": str(doc["_id"])},
    )
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
    return _run_ping(target)


@router.get(
    "/{server_id}/logs",
    dependencies=[Depends(auth.get_current_user)],
)
async def get_server_agent_logs(
    server_id: str,
    level: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=300, ge=1, le=1000),
) -> dict:
    """Fetch stored agent logs for a specific server."""
    doc = find_server_or_404(server_id)
    sid = doc["_id"]

    query: dict = {"$or": [{"server_id": sid}, {"server_id": str(sid)}]}
    if level and level.lower() != "all":
        query["level"] = level.lower()
    if search and search.strip():
        query["message"] = {"$regex": re.escape(search.strip()), "$options": "i"}

    logs = list(
        db.agent_logs()
        .find(query)
        .sort("timestamp", -1)
        .limit(limit)
    )

    formatted = [
        {
            "id": str(l["_id"]),
            "server_id": str(l["server_id"]),
            "timestamp": l["timestamp"].isoformat() if hasattr(l["timestamp"], "isoformat") else str(l.get("timestamp", "")),
            "level": str(l.get("level", "info")),
            "source": str(l.get("source", "agent")),
            "message": str(l.get("message", "")),
            "created_at": l["created_at"].isoformat() if hasattr(l.get("created_at"), "isoformat") else str(l.get("created_at", "")),
        }
        for l in logs
    ]

    total_count = db.agent_logs().count_documents({"$or": [{"server_id": sid}, {"server_id": str(sid)}]})

    return {
        "server_id": str(sid),
        "total": total_count,
        "logs": formatted,
    }


@router.delete(
    "/{server_id}/logs",
    dependencies=[Depends(auth.require_admin)],
)
async def clear_server_agent_logs(server_id: str) -> dict:
    """Clear stored agent logs for a specific server."""
    doc = find_server_or_404(server_id)
    sid = doc["_id"]
    res = db.agent_logs().delete_many({"$or": [{"server_id": sid}, {"server_id": str(sid)}]})
    return {"deleted": res.deleted_count}


@router.post(
    "/{server_id}/logs/journal",
    dependencies=[Depends(auth.require_admin)],
)
async def fetch_server_journal_logs(
    server_id: str,
    request: Request,
    user: dict = Depends(auth.require_admin),
) -> dict:
    """Trigger an on-demand systemd journal fetch via agent terminal command."""
    from app.database.connection import new_id
    from app.realtime import emit
    from app.services import audit as audit_trail

    doc = find_server_or_404(server_id)
    sid = doc["_id"]

    command_id = new_id()
    journal_cmd = "journalctl -u octyn.service -n 100 --no-pager 2>&1 || journalctl -u agent-lite -n 100 --no-pager 2>&1 || journalctl -u cm-agent -n 100 --no-pager 2>&1"

    cmd_doc = {
        "_id": command_id,
        "server_id": sid,
        "command": journal_cmd,
        "timeout_seconds": 30,
        "status": "queued",
        "output": "",
        "exit_code": None,
        "timed_out": False,
        "created_at": now(),
        "created_by": user["_id"],
    }
    db.terminal_commands().insert_one(cmd_doc)

    audit_trail.record(
        user,
        "fetch_agent_journal",
        request,
        {
            "server": doc.get("hostname") or doc.get("name"),
            "server_id": str(sid),
            "command_id": command_id,
        },
    )

    emit(
        "terminal_queued",
        {"server_id": str(sid), "command_id": command_id},
        room=f"server:{sid}",
    )

    return {"command_id": command_id, "status": "queued"}