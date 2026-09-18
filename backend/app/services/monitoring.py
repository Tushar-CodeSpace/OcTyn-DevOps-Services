"""Monitoring services: agent authentication and server health status.

Agents authenticate with per-server API keys (never dashboard credentials).
Only the sha256 hash of a key is stored; the raw key is shown once at creation.
"""

import hashlib
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader

from app.config.settings import settings
from app.database import models as db

api_key_header_scheme = APIKeyHeader(name=settings.api_key_header, auto_error=False)


def hash_api_key(raw_key: str) -> str:
    """Hash a raw API key for storage/lookup (never store the raw key)."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


def now() -> datetime:
    return datetime.now(timezone.utc)


def compute_status(
    last_seen_at: Optional[datetime],
    reference: Optional[datetime] = None,
    warning_max_seconds: Optional[float] = None,
) -> str:
    """Derive server health from heartbeat age (configurable thresholds)."""
    reference = reference or now()
    if last_seen_at is None:
        return "unknown"
    max_warn = warning_max_seconds if warning_max_seconds is not None else settings.health_warning_max_seconds
    age_seconds = (reference - last_seen_at).total_seconds()
    if age_seconds <= settings.health_online_max_seconds:
        return "online"
    if age_seconds <= max_warn:
        return "warning"
    return "offline"


def effective_status(heartbeat_status: str, has_active_alert: bool) -> str:
    """Display status: heartbeat liveness upgraded by active warning/critical alerts.

    Priority: offline > unknown > warning(alerts) > online. A dead server never
    looks healthier because of a lingering alert, and vice versa.
    """
    if heartbeat_status in ("offline", "unknown"):
        return heartbeat_status
    return "warning" if has_active_alert else heartbeat_status


def has_active_alert(server_id) -> bool:
    """True when the server has at least one active warning/critical alert."""
    doc = db.alerts().find_one(
        {"server_id": server_id, "status": "active", "severity": {"$in": ["warning", "critical"]}},
        {"_id": 1},
    )
    return doc is not None


def authenticate_agent(
    api_key: Optional[str] = Depends(api_key_header_scheme),
) -> dict:
    """FastAPI dependency: authenticate a monitoring agent via its API key.

    Returns {"api_key": key_doc, "server": server_doc}.
    """
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Missing {settings.api_key_header} header",
        )
    key_doc = db.api_keys().find_one(
        {"key_hash": hash_api_key(api_key), "status": "active"}
    )
    if key_doc is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    server = db.servers().find_one({"_id": key_doc["server_id"]})
    if server is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Server not found")
    db.api_keys().update_one({"_id": key_doc["_id"]}, {"$set": {"last_used_at": now()}})
    return {"api_key": key_doc, "server": server}