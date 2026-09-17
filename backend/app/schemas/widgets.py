"""Custom data-widget schemas.

Site agents periodically count documents in a site MongoDB collection
(e.g. ``data_uploader_service.integration_logs`` grouped by
``upload_status``) and push the tallies here. The dashboard renders one
card per widget.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class WidgetSampleCreate(BaseModel):
    """One widget tally pushed by an agent (agent-authenticated)."""

    model_config = {"extra": "forbid"}

    server_id: str = Field(min_length=1, max_length=64)
    widget_name: str = Field(min_length=1, max_length=100)
    database: str = Field(min_length=1, max_length=100)
    collection: str = Field(min_length=1, max_length=100)
    window_minutes: int = Field(ge=1, le=10080)
    total: int = Field(ge=0)
    groups: dict[str, int] = Field(default_factory=dict)
    collected_at: datetime
    error: Optional[str] = Field(default=None, max_length=500)


class WidgetSampleRead(BaseModel):
    """Latest tally of one widget for dashboard display."""

    id: str
    server_id: str
    widget_name: str
    database: str
    collection: str
    window_minutes: int
    total: int
    groups: dict[str, int]
    collected_at: datetime
    received_at: datetime
    error: Optional[str] = None


class WidgetHistoryPoint(BaseModel):
    """One downsampled trend point of a widget (last sample per bucket)."""

    received_at: datetime
    total: int
    groups: dict[str, int]
