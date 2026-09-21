from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, loaded from environment variables / backend/.env."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # MongoDB
    mongo_url: str = (
        "mongodb://monitoring_app:change-me@localhost:27017/central_monitoring"
    )
    mongo_db: str = "central_monitoring"

    # Dashboard authentication (JWT issued by the backend)
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440
    jwt_refresh_expire_days: int = 7

    # Agent authentication
    api_key_header: str = "X-API-Key"

    # Server health thresholds (seconds since last_seen_at)
    # Tuned for agent heartbeat: online within 15s, warning up to 30s.
    health_online_max_seconds: int = 15
    health_warning_max_seconds: int = 30

    # Alert thresholds (defaults; runtime-overridable via Settings UI / DB)
    alert_cpu_threshold_percent: float = 90.0
    alert_cpu_duration_seconds: int = 300
    alert_ram_threshold_percent: float = 80.0
    alert_disk_threshold_percent: float = 85.0
    alert_offline_grace_seconds: int = 60
    master_deploy_grace_seconds: int = 180

    # Background evaluator
    evaluator_interval_seconds: int = 5

    # Raw metric retention (days)
    metrics_retention_days: int = 7

    # Site MongoDB config backup (defaults; runtime-overridable via Settings UI)
    config_sync_enabled: bool = True
    config_sync_hour: int = 0  # hour of day (0-23, local agent time) for the daily backup

    # Agent runtime defaults (global; per-server overridden via Agent config card)
    agent_monitoring_interval_seconds: int = 60
    agent_http_timeout_seconds: int = 10
    agent_http_retry_count: int = 3
    agent_config_poll_interval_seconds: int = 5
    agent_connectivity_poll_interval_seconds: int = 15
    agent_mongo_config_enabled: bool = True
    agent_mongo_uri: str = ""
    agent_mongo_auth_source: str = "admin"

    # CORS (comma-separated origins; * for local dev only)
    cors_origins: str = "*"

    # Logging
    log_level: str = "INFO"
    log_dir: str = "logs"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()