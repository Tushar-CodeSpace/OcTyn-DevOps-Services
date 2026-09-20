"""Server schemas. A server belongs to a site."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

ServerStatus = Literal["unknown", "online", "warning", "offline"]
ServerEnvironment = Literal["production", "qa", "staging"]


class ServerBase(BaseModel):
    site_id: str
    name: str = Field(min_length=1, max_length=200)
    hostname: str = Field(min_length=1, max_length=200)
    ip_address: Optional[str] = Field(default=None, max_length=64)
    environment: str = Field(default="production", max_length=50)
    qa_role: Optional[str] = Field(default=None, max_length=100)
    qa_test_url: Optional[str] = Field(default=None, max_length=300)


class ServerCreate(ServerBase):
    pass


class ServerUpdate(BaseModel):
    site_id: Optional[str] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    hostname: Optional[str] = Field(default=None, min_length=1, max_length=200)
    ip_address: Optional[str] = Field(default=None, max_length=64)
    environment: Optional[str] = Field(default=None, max_length=50)
    qa_role: Optional[str] = Field(default=None, max_length=100)
    qa_test_url: Optional[str] = Field(default=None, max_length=300)


class ServerRead(ServerBase):
    id: str
    status: ServerStatus = "unknown"
    last_seen_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime