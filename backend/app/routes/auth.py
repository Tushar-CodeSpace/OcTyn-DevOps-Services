from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.database import models as db
from app.database.connection import new_id
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshTokenRequest,
    RefreshTokenResponse,
    TokenResponse,
    UserRead,
)
from app.services import authentication as auth
from app.services import audit as audit_trail

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def record_audit_log(user_id: str, email: str, action: str, req: Request):
    client_ip = req.client.host if req.client else "unknown"
    forwarded = req.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    user_agent = req.headers.get("user-agent", "unknown")
    doc = {
        "_id": new_id(),
        "user_id": str(user_id),
        "email": email.lower(),
        "action": action,
        "ip_address": client_ip,
        "user_agent": user_agent,
        "timestamp": datetime.now(timezone.utc),
    }
    db.audit_logs().insert_one(doc)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request) -> TokenResponse:
    user = db.users().find_one({"email": body.email.lower()})
    if user is None or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )
    token, expires_at = auth.create_access_token(user["_id"])
    refresh_token, refresh_expires_at = auth.create_refresh_token(user["_id"])
    record_audit_log(user["_id"], user["email"], "login", request)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_at=expires_at,
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=RefreshTokenResponse)
async def refresh(body: RefreshTokenRequest, request: Request) -> RefreshTokenResponse:
    user_id = auth.decode_refresh_token(body.refresh_token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    new_token, expires_at = auth.create_access_token(user_id)
    new_refresh, refresh_expires_at = auth.rotate_refresh_token(body.refresh_token)
    if new_refresh is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not rotate refresh token")
    user = db.users().find_one({"_id": user_id})
    if user:
        record_audit_log(str(user_id), user.get("email", ""), "token_refresh", request)
    return RefreshTokenResponse(
        access_token=new_token,
        token_type="bearer",
        expires_at=expires_at,
        refresh_token=new_refresh,
    )


@router.post("/logout")
async def logout(
    request: Request,
    user: dict = Depends(auth.get_current_user),
) -> dict:
    auth.revoke_refresh_tokens(user["_id"])
    record_audit_log(user["_id"], user["email"], "logout", request)
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserRead)
async def me(user: dict = Depends(auth.get_current_user)) -> UserRead:
    return UserRead(
        id=str(user["_id"]),
        email=user["email"],
        name=user.get("name"),
        role=auth.effective_role(user),
        user_group=user.get("user_group") or "developer",
        created_at=user.get("created_at"),
    )


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    current_user: dict = Depends(auth.get_current_user),
) -> dict:
    if not auth.verify_password(body.current_password, current_user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
        )
    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be at least 8 characters long"
        )

    new_hash = auth.hash_password(body.new_password)
    db.users().update_one({"_id": current_user["_id"]}, {"$set": {"password_hash": new_hash}})
    auth.revoke_refresh_tokens(current_user["_id"])
    audit_trail.record(current_user, "password_change", request, None)
    return {"message": "Password changed successfully"}