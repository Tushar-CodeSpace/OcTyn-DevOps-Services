"""Dashboard authentication: bcrypt password hashing + JWT (PyJWT).

Monitoring agents do NOT use these credentials — they authenticate with
per-server API keys (see app/services/monitoring.py).
"""

from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config.settings import settings
from app.database import models as db
from app.database.connection import parse_id

Role = Literal["admin", "viewer", "super_admin"]
ROLES: tuple[Role, ...] = ("admin", "viewer", "super_admin")

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_access_token(user_id: str) -> tuple[str, datetime]:
    """Issue a short-lived JWT for the given user id; returns (token, expires_at)."""
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": user_id, "exp": expires_at}
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_at


def create_refresh_token(user_id: str) -> tuple[str, datetime]:
    """Issue an opaque refresh token; returns (token, expires_at)."""
    import secrets
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_expire_days)
    token = secrets.token_urlsafe(64)
    db.refresh_tokens().insert_one({
        "user_id": user_id,
        "token_hash": token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc),
        "revoked": False,
    })
    return token, expires_at


def decode_access_token(token: str) -> str:
    """Return the user id (sub) from a valid access token, or raise 401."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return sub
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def decode_refresh_token(token: str) -> str | None:
    """Validate a refresh token; return user_id if valid, None if invalid/revoked/expired."""
    doc = db.refresh_tokens().find_one({"token_hash": token})
    if not doc:
        return None
    if doc.get("revoked") or doc.get("expires_at") < datetime.now(timezone.utc):
        return None
    return doc["user_id"]


def revoke_refresh_tokens(user_id: str) -> None:
    """Revoke all refresh tokens for a user."""
    db.refresh_tokens().update_many(
        {"user_id": user_id},
        {"$set": {"revoked": True}},
    )


def rotate_refresh_token(old_token: str) -> tuple[str, datetime] | None:
    """Revoke old refresh token, issue a new one for the same user. Returns (token, expires_at) or None."""
    doc = db.refresh_tokens().find_one({"token_hash": old_token})
    if not doc or doc.get("revoked") or doc.get("expires_at") < datetime.now(timezone.utc):
        return None
    user_id = doc["user_id"]
    db.refresh_tokens().update_one({"_id": doc["_id"]}, {"$set": {"revoked": True}})
    return create_refresh_token(user_id)


def effective_role(user: dict) -> str:
    """Map stored role to admin | viewer | super_admin."""
    role = user.get("role")
    if role in ("admin", "viewer", "super_admin"):
        return role
    return "viewer"


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """FastAPI dependency: returns the authenticated dashboard user document."""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    sub = decode_access_token(credentials.credentials)
    user_id = parse_id(sub)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.users().find_one({"_id": user_id})
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def get_current_user_flexible(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """FastAPI dependency: accept access token or refresh token."""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    creds = credentials.credentials
    try:
        sub = decode_access_token(creds)
    except HTTPException:
        user_id = decode_refresh_token(creds)
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
        sub = user_id
    user_id = parse_id(sub)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.users().find_one({"_id": user_id})
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Dependency for admin-only endpoints (writes, user management, settings)."""
    if effective_role(user) not in ("admin", "super_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


def require_super_admin(user: dict = Depends(get_current_user)) -> dict:
    """Dependency for platform-wide controls reserved for super admins."""
    if effective_role(user) != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin role required")
    return user