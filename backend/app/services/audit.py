"""Central audit trail: who changed what, when, from where.

Every dashboard-initiated mutation (config changes, user/key management,
template edits, terminal command execution) records who/when/what here.
The trail is readable by super admins only.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Request

from app.database import models as db
from app.database.connection import new_id

# Any detail key containing one of these fragments is stored as "***".
_SENSITIVE_FRAGMENTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "auth",
    "uri",
    "connection_string",
    "private",
)

_MAX_STR = 500


def _safe_value(key: str, value: Any) -> Any:
    lowered = str(key).lower()
    if any(frag in lowered for frag in _SENSITIVE_FRAGMENTS):
        return "***"
    if isinstance(value, str):
        return value[:_MAX_STR]
    if isinstance(value, (list, tuple)):
        return [_safe_value(key, v) for v in list(value)[:20]]
    if isinstance(value, dict):
        return {str(k)[:100]: _safe_value(f"{key}.{k}", v) for k, v in list(value.items())[:20]}
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    try:
        return str(value)[:_MAX_STR]
    except Exception:
        return "?"


def safe_details(raw: Optional[dict]) -> Optional[dict]:
    """Redact secrets and truncate oversized values in an audit details dict."""
    if not isinstance(raw, dict):
        return None
    return {str(k)[:100]: _safe_value(k, v) for k, v in raw.items()}


def client_ip(req: Optional[Request]) -> str:
    if req is None:
        return "unknown"
    ip = req.client.host if req.client else "unknown"
    forwarded = req.headers.get("x-forwarded-for")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    return ip or "unknown"


def user_agent(req: Optional[Request]) -> str:
    if req is None:
        return "unknown"
    return req.headers.get("user-agent", "unknown")


def record(
    user: Optional[dict],
    action: str,
    req: Optional[Request] = None,
    details: Optional[dict] = None,
) -> None:
    """Persist one audit entry. Never raises (audit must not break the request)."""
    try:
        email = ""
        user_id = ""
        if isinstance(user, dict):
            email = str(user.get("email", "") or "").lower()
            user_id = str(user.get("_id", "") or "")
        db.audit_logs().insert_one(
            {
                "_id": new_id(),
                "user_id": user_id,
                "email": email or "unknown",
                "action": action,
                "ip_address": client_ip(req),
                "user_agent": user_agent(req),
                "details": safe_details(details),
                "timestamp": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
