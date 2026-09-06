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


class UserRead(BaseModel):
    id: str
    email: EmailStr
    name: Optional[str] = None
    role: Role
    created_at: Optional[datetime] = None


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: Optional[str] = Field(default=None, max_length=120)
    role: Role = "viewer"


class UserUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    role: Optional[Role] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class AuditLogRead(BaseModel):
    id: str
    user_id: Optional[str] = None
    email: str
    action: Literal[
        "login", "logout", "connectivity_lost", "connectivity_restored", "terminal_command"
    ]
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    details: Optional[dict] = None
    timestamp: datetime

