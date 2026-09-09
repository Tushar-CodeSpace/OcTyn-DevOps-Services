"""Agent runtime configuration schemas (centrally managed, pushed to agents).

Agents are deployed with only SERVER_ID / API_URL / API_KEY; every other
runtime knob lives here and is pulled from the hub on boot and whenever it
changes in the dashboard.
"""

from typing import Optional

from pydantic import BaseModel, Field, field_validator


class ConfigCollectionSpec(BaseModel):
    model_config = {"extra": "forbid"}

    database: str = Field(min_length=1, max_length=100)
    collections: list[str] = Field(default_factory=list)


class ConnectivityTarget(BaseModel):
    """A named host the agent pings in realtime (e.g. PLC device, camera)."""

    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=100)
    ip: str = Field(min_length=1, max_length=64)


class AgentConfig(BaseModel):
    # config backup
    config_sync_enabled: bool = True
    config_sync_hour: int = Field(default=0, ge=0, le=23)
    monitored_services: list[str] = Field(default_factory=list)
    config_collections: list[ConfigCollectionSpec] = Field(default_factory=list)
    connectivity_targets: list[ConnectivityTarget] = Field(default_factory=list)

    # core runtime
    monitoring_interval_seconds: int = Field(default=60, ge=1, le=3600)
    http_timeout_seconds: int = Field(default=10, ge=1, le=120)
    http_retry_count: int = Field(default=3, ge=0, le=10)
    config_poll_interval_seconds: int = Field(default=5, ge=1, le=300)
    connectivity_poll_interval_seconds: int = Field(default=15, ge=1, le=3600)

    # site MongoDB config backup connection
    mongo_config_enabled: bool = True
    mongo_uri: str = ""
    mongo_auth_source: str = "admin"
    trigger_sync_id: Optional[str] = ""


class AgentConfigOverrideUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    config_sync_enabled: Optional[bool] = None
    config_sync_hour: Optional[int] = Field(default=None, ge=0, le=23)
    monitored_services: Optional[list[str]] = None
    config_collections: Optional[list[ConfigCollectionSpec]] = None
    connectivity_targets: Optional[list[ConnectivityTarget]] = None
    monitoring_interval_seconds: Optional[int] = Field(default=None, ge=1, le=3600)
    http_timeout_seconds: Optional[int] = Field(default=None, ge=1, le=120)
    http_retry_count: Optional[int] = Field(default=None, ge=0, le=10)
    config_poll_interval_seconds: Optional[int] = Field(default=None, ge=1, le=300)
    connectivity_poll_interval_seconds: Optional[int] = Field(default=None, ge=1, le=3600)
    mongo_config_enabled: Optional[bool] = None
    mongo_uri: Optional[str] = None
    mongo_auth_source: Optional[str] = None
    trigger_sync_id: Optional[str] = None

    @field_validator("config_sync_hour")
    @classmethod
    def _check_hour(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (0 <= v <= 23):
            raise ValueError("config_sync_hour must be between 0 and 23")
        return v
