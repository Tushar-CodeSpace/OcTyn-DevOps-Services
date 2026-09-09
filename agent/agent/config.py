"""Configuration management for OcTyn DevOps Services Agent.

Only SERVER_ID, API_URL, and API_KEY are read from .env / environment.
All other runtime configurations are pulled dynamically from the central server.
"""

import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict

    class _Settings(BaseSettings):
        model_config = SettingsConfigDict(
            env_file=".env", env_file_encoding="utf-8", extra="ignore"
        )
        server_id: str = ""
        api_url: str = ""
        api_key: str = ""

    _env_settings = _Settings()
except Exception:
    _env_settings = None


def _get_env_val(key: str) -> str:
    val = os.environ.get(key)
    if val and val.strip():
        return val.strip()
    if _env_settings and hasattr(_env_settings, key.lower()):
        attr_val = str(getattr(_env_settings, key.lower()) or "").strip()
        if attr_val:
            return attr_val
    return ""


# Required credentials read from .env / environment
SERVER_ID: str = _get_env_val("SERVER_ID")
_raw_api_url: str = _get_env_val("API_URL").rstrip("/")
if _raw_api_url and not _raw_api_url.endswith("/api/v1"):
    API_URL: str = _raw_api_url + "/api/v1"
else:
    API_URL: str = _raw_api_url
API_KEY: str = _get_env_val("API_KEY")

DEFAULT_BOOTSTRAP = {
    "MONITORING_INTERVAL": 60,
    "HTTP_TIMEOUT_SECONDS": 10,
    "HTTP_RETRY_COUNT": 3,
    "CONFIG_POLL_INTERVAL_SECONDS": 5,
    "CONNECTIVITY_POLL_INTERVAL_SECONDS": 15,
}

# Live dynamic runtime configuration state, pulled from central server
_RUNTIME_CONFIG: Dict[str, Any] = {
    "config_sync_enabled": True,
    "config_sync_hour": 0,
    "monitored_services": [],
    "config_collections": None,
    "connectivity_targets": [],
    "monitoring_interval_seconds": 60,
    "http_timeout_seconds": 10,
    "http_retry_count": 3,
    "config_poll_interval_seconds": 5,
    "connectivity_poll_interval_seconds": 15,
    "mongo_config_enabled": True,
    "mongo_uri": "mongodb://localhost:27017",
    "mongo_auth_source": "admin",
}

_RUNTIME_FIELDS = (
    "monitoring_interval_seconds",
    "http_timeout_seconds",
    "http_retry_count",
    "config_poll_interval_seconds",
    "connectivity_poll_interval_seconds",
    "connectivity_targets",
    "mongo_config_enabled",
    "mongo_uri",
    "mongo_auth_source",
)

CONFIG_COLLECTION_MAP: Dict[str, List[str]] = {
    "analytic_service": ["analytic_config"],
    "data_uploader_service": ["integration_config"],
    "identity_service": [
        "UIControls",
        "client_setup",
        "features_code",
        "formcode_mappings",
        "monitoring_configurations",
        "notifiers",
        "pages_code",
        "products",
        "products_category",
        "roles",
        "users",
    ],
    "incoming_service": ["incoming_config"],
    "machine_configurations": ["machines"],
    "sorting_service": ["business_logic", "rejection_codes", "sorting_config"],
    "bagging": ["active_bags", "bagging_config", "ptl_users"],
    "calibration_service": ["calibration_boxes", "calibration_process", "calibration_results"],
    "cyclic_data_service": ["active_location_statuses", "alarms"],
    "notification_service": ["notifiers"],
}


def log(msg: str) -> None:
    """Timestamped log writer to stderr."""
    sys.stderr.write("%s %s\n" % (datetime.now(timezone.utc).strftime("%H:%M:%S"), msg))
    sys.stderr.flush()


_LAST_TRIGGER_SYNC_ID = None


def apply_agent_config(body: Dict[str, Any]) -> None:
    """Merge dynamic configuration payload from hub into agent's live settings."""
    global _RUNTIME_CONFIG, _LAST_TRIGGER_SYNC_ID
    if not isinstance(body, dict):
        return
    merged = dict(_RUNTIME_CONFIG)
    if isinstance(body.get("config_sync_enabled"), bool):
        merged["config_sync_enabled"] = body["config_sync_enabled"]
    if isinstance(body.get("config_sync_hour"), int) and 0 <= body["config_sync_hour"] <= 23:
        merged["config_sync_hour"] = body["config_sync_hour"]
    if isinstance(body.get("monitored_services"), list):
        merged["monitored_services"] = [
            s.strip() for s in body["monitored_services"] if isinstance(s, str) and s.strip()
        ]
    if isinstance(body.get("config_collections"), list):
        merged["config_collections"] = body["config_collections"]
    for key in _RUNTIME_FIELDS:
        if key in body:
            merged[key] = body[key]
    _RUNTIME_CONFIG = merged

    trigger_id = body.get("trigger_sync_id")
    if trigger_id and str(trigger_id).strip() and trigger_id != _LAST_TRIGGER_SYNC_ID:
        _LAST_TRIGGER_SYNC_ID = trigger_id
        log(f"[TRIGGER] Hub requested immediate config backup (trigger_id={trigger_id})")
        import threading
        try:
            from agent.mongo_backup import sync_configs
            threading.Thread(target=sync_configs, daemon=True).start()
        except ImportError:
            pass


def _runtime_int(key: str, default: int) -> int:
    raw = _RUNTIME_CONFIG.get(key)
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return default


def _runtime_bool(key: str, default: bool) -> bool:
    raw = _RUNTIME_CONFIG.get(key)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.lower() in {"1", "true", "yes", "on"}
    return default


def _runtime_str(key: str, default: str) -> str:
    raw = _RUNTIME_CONFIG.get(key)
    return str(raw).strip() if isinstance(raw, str) and raw.strip() else default


def monitoring_interval() -> int:
    return _runtime_int("monitoring_interval_seconds", DEFAULT_BOOTSTRAP["MONITORING_INTERVAL"])


def http_timeout() -> int:
    return _runtime_int("http_timeout_seconds", DEFAULT_BOOTSTRAP["HTTP_TIMEOUT_SECONDS"])


def retry_count() -> int:
    return _runtime_int("http_retry_count", DEFAULT_BOOTSTRAP["HTTP_RETRY_COUNT"])


def mongo_config_enabled() -> bool:
    return _runtime_bool("mongo_config_enabled", True)


def mongo_uri() -> str:
    return _runtime_str("mongo_uri", "mongodb://localhost:27017")


def mongo_auth_source() -> str:
    return _runtime_str("mongo_auth_source", "admin")


def connectivity_poll_interval() -> int:
    return _runtime_int("connectivity_poll_interval_seconds", DEFAULT_BOOTSTRAP["CONNECTIVITY_POLL_INTERVAL_SECONDS"])


def connectivity_targets() -> List[Dict[str, str]]:
    raw = _RUNTIME_CONFIG.get("connectivity_targets")
    if not isinstance(raw, list):
        return []
    out = []
    for t in raw:
        if isinstance(t, dict) and t.get("name") and t.get("ip"):
            out.append({"name": str(t["name"]), "ip": str(t["ip"])})
    return out


def config_services() -> List[str]:
    services = _RUNTIME_CONFIG.get("monitored_services")
    if isinstance(services, list):
        return list(services)
    return []


def config_collections() -> Dict[str, List[str]]:
    raw = _RUNTIME_CONFIG.get("config_collections")
    if not isinstance(raw, list):
        return dict(CONFIG_COLLECTION_MAP)
    out = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        database = str(item.get("database", "")).strip()
        collections = item.get("collections", [])
        if not database or not isinstance(collections, list):
            continue
        out[database] = [str(c).strip() for c in collections if str(c).strip()]
    return out or dict(CONFIG_COLLECTION_MAP)
