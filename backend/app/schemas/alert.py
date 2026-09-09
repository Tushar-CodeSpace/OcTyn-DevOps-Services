"""Alert schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AlertRead(BaseModel):
    id: str
    server_id: str
    type: str
    severity: str
    message: str
    value: Optional[float] = None
    threshold: Optional[float] = None
    status: str = "active"
    created_at: datetime
    resolved_at: Optional[datetime] = None