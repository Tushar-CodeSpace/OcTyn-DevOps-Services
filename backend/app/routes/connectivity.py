"""Realtime connectivity routes.

The site agent pings the configured on-site devices (PLCs, cameras, ...) on a
realtime schedule and POSTs the results here; the dashboard reads the latest
results and receives live updates over the ``connectivity`` socket event.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.services import app_settings
from app.services import authentication as auth
from app.services.monitoring import authenticate_agent

router = APIRouter(prefix="/api/v1", tags=["connectivity"])


def now() -> datetime:
    return datetime.now(timezone.utc)


class ConnectivityResultIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    ip: str = Field(min_length=1, max_length=64)
    reachable: bool
    latency_ms: Optional[float] = Field(default=None, ge=0)
    checked_at: Optional[datetime] = None


class ConnectivityBatchIn(BaseModel):
    server_id: str
    results: list[ConnectivityResultIn] = Field(max_length=200)


def _server_id_or_404(server_id: str) -> str:
    sid = parse_id(server_id)
    if sid is None or db.servers().find_one({"_id": sid}) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Server not found"
        )
    return str(sid)


def _configured_map(server_id: str) -> dict[str, str]:
    cfg = app_settings.get_agent_config(server_id)
    return {
        str(t["name"]): str(t["ip"])
        for t in cfg.get("connectivity_targets", [])
        if t.get("name") and t.get("ip")
    }


def _server_connectivity(server_id: str) -> list[dict]:
    """Latest connectivity results for a server, in configured-target order.

    Targets that have not been reported yet appear with ``reachable=None`` so
    the UI can show a "pending" state.
    """
    configured = _configured_map(server_id)
    docs = list(db.connectivity().find({"server_id": parse_id(server_id)}))
    by_name: dict[str, dict] = {}
    for d in docs:
        name = str(d.get("target_name", ""))
        if not name:
            continue
        cur = by_name.get(name)
        if cur is None or d.get("updated_at", now()) > cur.get("updated_at", now()):
            by_name[name] = d

    out: list[dict] = []
    for name, ip in configured.items():
        d = by_name.get(name)
        if d is not None:
            out.append(
                {
                    "name": name,
                    "ip": ip,
                    "reachable": bool(d.get("reachable", False)),
                    "latency_ms": d.get("latency_ms"),
                    "checked_at": d.get("checked_at"),
                }
            )
        else:
            out.append(
                {
                    "name": name,
                    "ip": ip,
                    "reachable": None,
                    "latency_ms": None,
                    "checked_at": None,
                }
            )
    return out


def _emit_ready(results: list[dict]) -> list[dict]:
    """Serialize datetimes for the socket emit / JSON payload."""
    ready: list[dict] = []
    for r in results:
        item = dict(r)
        if isinstance(item.get("checked_at"), datetime):
            item["checked_at"] = item["checked_at"].isoformat()
        ready.append(item)
    return ready


@router.post("/connectivity")
async def ingest_connectivity(
    payload: ConnectivityBatchIn,
    agent: dict = Depends(authenticate_agent),
) -> dict:
    """Agent endpoint: receive realtime ping results for a server's targets."""
    server = agent["server"]
    if payload.server_id != str(server["_id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API key does not match server_id",
        )
    ts = now()
    endpoint = (
        server.get("hostname")
        or server.get("name")
        or f"server-{str(server['_id'])}"
    )
    for r in payload.results:
        prev = db.connectivity().find_one(
            {"server_id": server["_id"], "target_name": r.name}
        )
        prev_reachable = bool(prev.get("reachable")) if prev else None
        db.connectivity().update_one(
            {"server_id": server["_id"], "target_name": r.name},
            {
                "$set": {
                    "server_id": server["_id"],
                    "target_name": r.name,
                    "ip": r.ip,
                    "reachable": bool(r.reachable),
                    "latency_ms": r.latency_ms,
                    "checked_at": r.checked_at or ts,
                    "updated_at": ts,
                }
            },
            upsert=True,
        )

        new_reachable = bool(r.reachable)
        if prev is not None and prev_reachable != new_reachable:
            action = (
                "connectivity_restored" if new_reachable else "connectivity_lost"
            )
            db.audit_logs().insert_one(
                {
                    "_id": new_id(),
                    "user_id": str(server["_id"]),
                    "email": endpoint,
                    "action": action,
                    "ip_address": r.ip,
                    "user_agent": "connectivity agent",
                    "details": {
                        "target": r.name,
                        "ip": r.ip,
                        "latency_ms": r.latency_ms,
                    },
                    "timestamp": ts,
                }
            )

    server_id = str(server["_id"])
    results = _server_connectivity(server_id)
    emit(
        "connectivity",
        {"server_id": server_id, "targets": _emit_ready(results)},
    )
    return {"success": True, "targets": _emit_ready(results)}


@router.get(
    "/servers/{server_id}/connectivity",
    dependencies=[Depends(auth.get_current_user)],
)
async def get_server_connectivity(server_id: str) -> list[dict]:
    """Dashboard endpoint: latest connectivity results for a server."""
    sid = _server_id_or_404(server_id)
    return _server_connectivity(sid)
