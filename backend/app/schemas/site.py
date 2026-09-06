"""Site schemas.

A site is a client + location environment, e.g.:
    client=samsonite, code=samsonite_nashik_conveyor_01, location=Nashik
"""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

SiteStatus = Literal["active", "inactive"]


class SiteBase(BaseModel):
    client: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9_]+$")
    location: str = Field(min_length=1, max_length=200)
    status: SiteStatus = "active"
    alerts_enabled: bool = True


class SiteCreate(SiteBase):
    pass


class SiteUpdate(BaseModel):
    client: Optional[str] = Field(default=None, min_length=1, max_length=100)
    location: Optional[str] = Field(default=None, min_length=1, max_length=200)
    status: Optional[SiteStatus] = None
    alerts_enabled: Optional[bool] = None


class SiteRead(SiteBase):
    id: str
    created_at: datetime
    updated_at: datetime