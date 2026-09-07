"""Service schemas (services tracked per server, reported by the agent)."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

ServiceStatus = Literal["running", "stopped", "disabled", "unknown"]


class ServiceReport(BaseModel):
    server_id: str
    name: str = Field(min_length=1, max_length=100)
    status: ServiceStatus = "unknown"
    port: Optional[int] = Field(default=None, ge=1, le=65535)


class ServiceRead(ServiceReport):
    id: str
    enabled: bool = True
    last_checked_at: datetime


class ServiceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    enabled: bool = True


class ServiceUpdate(BaseModel):
    enabled: Optional[bool] = None
    port: Optional[int] = Field(default=None, ge=1, le=65535)