"""Metric schemas (time-series measurements per server)."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class MetricCreate(BaseModel):
    server_id: str
    timestamp: datetime

    hostname: Optional[str] = Field(default=None, max_length=200)
    ip_address: Optional[str] = Field(default=None, max_length=64)

    cpu_percent: float = Field(ge=0, le=100)
    memory_percent: float = Field(ge=0, le=100)
    memory_total: float = Field(ge=0)
    memory_available: float = Field(ge=0)

    disk_percent: float = Field(ge=0, le=100)
    disk_total: float = Field(ge=0)
    disk_free: float = Field(ge=0)

    network_bytes_sent: float = Field(ge=0)
    network_bytes_received: float = Field(ge=0)

    disk_read_bytes: Optional[float] = Field(default=0.0, ge=0)
    disk_write_bytes: Optional[float] = Field(default=0.0, ge=0)
    disk_read_rate_mb: Optional[float] = Field(default=0.0, ge=0)
    disk_write_rate_mb: Optional[float] = Field(default=0.0, ge=0)
    disk_iops: Optional[float] = Field(default=0.0, ge=0)
    io_status: Optional[dict] = Field(default=None)

    api_requests_total: Optional[int] = Field(default=0, ge=0)
    api_requests_4xx: Optional[int] = Field(default=0, ge=0)
    api_requests_5xx: Optional[int] = Field(default=0, ge=0)
    api_error_rate_percent: Optional[float] = Field(default=0.0, ge=0, le=100)
    api_recent_errors: Optional[list[dict]] = Field(default=None)

    uptime_seconds: float = Field(ge=0)


class MetricRead(MetricCreate):
    id: str
    recorded_at: datetime


class MetricIngestResponse(BaseModel):
    success: bool = True
    # Agent runtime config pushed on every heartbeat so agents pick up changes.
    config_sync_enabled: bool = True
    config_sync_hour: Optional[int] = None
    monitored_services: Optional[list[str]] = None
    config_collections: Optional[list[dict]] = None
    connectivity_targets: Optional[list[dict]] = None
    connectivity_poll_interval_seconds: Optional[int] = None
    trigger_sync_id: Optional[str] = None