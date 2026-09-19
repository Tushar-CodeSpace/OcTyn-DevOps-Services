"""Dashboard authentication schemas (JWT issued by the backend)."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field

Role = Literal["admin", "viewer", "super_admin"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    refresh_token: str


class RefreshTokenResponse(BaseModel):
    access_token: str
    expires_at: datetime


class UserRead(BaseModel):
    id: str
    email: EmailStr
    name: Optional[str] = None
    role: Role
    user_group: Optional[str] = "developer"  # devops | developer | product | management | other
    created_at: Optional[datetime] = None


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: Optional[str] = Field(default=None, max_length=120)
    role: Role = "viewer"
    user_group: Optional[str] = Field(default="developer", max_length=50)


class UserUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    role: Optional[Role] = None
    user_group: Optional[str] = Field(default=None, max_length=50)
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class AuditLogRead(BaseModel):
    id: str
    user_id: Optional[str] = None
    email: str
    action: Literal[
        "login",
        "logout",
        "password_change",
        "connectivity_lost",
        "connectivity_restored",
        "terminal_command",
        "config_update",
        "data_prune",
        "template_save",
        "template_delete",
        "service_add",
        "service_update",
        "service_remove",
        "server_create",
        "server_update",
        "server_delete",
        "site_create",
        "site_update",
        "site_delete",
        "user_create",
        "user_update",
        "user_delete",
        "api_key_create",
        "api_key_revoke",
        "api_key_delete",
    ]
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    details: Optional[dict] = None
    timestamp: datetime

