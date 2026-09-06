"""Runtime-configurable application settings, stored in MongoDB.

A single document per group (e.g. ``_id: "alerts"``) overrides the static
defaults from ``app.config.settings``. Missing values fall back to defaults,
so a fresh deployment behaves exactly like the env-var configuration until
someone edits values from the Settings UI.
"""

from datetime import datetime, timezone
from typing import Optional

from app.config.settings import settings
from app.database import models as db

_ALERT_DOC = "alerts"

# field -> (type, default, min, max)
_ALERT_FIELDS: dict[str, tuple[type, float, Optional[float], Optional[float]]] = {
    "ram_threshold_percent": (float, settings.alert_ram_threshold_percent, 0.0, 100.0),
    "cpu_threshold_percent": (float, settings.alert_cpu_threshold_percent, 0.0, 100.0),
    "cpu_duration_seconds": (int, settings.alert_cpu_duration_seconds, 30.0, None),
    "disk_threshold_percent": (float, settings.alert_disk_threshold_percent, 0.0, 100.0),
    "api_error_threshold_percent": (float, 5.0, 0.0, 100.0),
    "offline_threshold_seconds": (int, float(settings.health_warning_max_seconds), 15.0, 3600.0),
}

_NOTIF_DOC = "notifications"

# field -> (type, default)
_NOTIFICATION_FIELDS: dict[str, tuple[type, object]] = {
    "whatsapp_enabled": (bool, False),
    "whatsapp_base_url": (str, "http://evolution-api:8080"),
    "whatsapp_instance": (str, "central-monitoring"),
    "whatsapp_api_key": (str, ""),
    "whatsapp_recipients": (str, ""),
}

_SYNC_DOC = "sync"

# field -> (type, default, min)
_SYNC_FIELDS: dict[str, tuple[type, object, Optional[float]]] = {
    "config_sync_enabled": (bool, True, None),
    "config_sync_hour": (int, settings.config_sync_hour, 0.0),
}

# Default agent config (global defaults; per-server overrides stored separately).
_AGENT_DEFAULT_COLLECTIONS: dict[str, list[str]] = {
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

_AGENT_DEFAULT_SERVICES: list[str] = []

# Named realtime-connectivity targets (default: none — admins add per site).
_AGENT_DEFAULT_TARGETS: list[dict] = []

# Scalar runtime defaults for agents (global; per-server overrides can replace).
_AGENT_SCALAR_DEFAULTS: dict[str, object] = {
    "monitoring_interval_seconds": settings.agent_monitoring_interval_seconds,
    "http_timeout_seconds": settings.agent_http_timeout_seconds,
    "http_retry_count": settings.agent_http_retry_count,
    "config_poll_interval_seconds": settings.agent_config_poll_interval_seconds,
    "connectivity_poll_interval_seconds": settings.agent_connectivity_poll_interval_seconds,
    "mongo_config_enabled": settings.agent_mongo_config_enabled,
    "mongo_uri": settings.agent_mongo_uri,
    "mongo_auth_source": settings.agent_mongo_auth_source,
}


def _doc():
    return db.settings().find_one({"_id": _ALERT_DOC}) or {}


def get_alert_config() -> dict:
    """Effective alert thresholds (DB overrides merged over defaults)."""
    stored = _doc()
    out: dict[str, float | int] = {}
    for name, (typ, default, lo, hi) in _ALERT_FIELDS.items():
        raw = stored.get(name, default)
        try:
            value = typ(raw)
        except (TypeError, ValueError):
            value = typ(default)
        if lo is not None:
            value = max(lo, value)
        if hi is not None:
            value = min(hi, value)
        out[name] = value
    return out


def update_alert_config(patch: dict) -> dict:
    """Validate and persist a partial alert-threshold update. Returns effective config."""
    clean: dict[str, float | int] = {}
    for key, raw in patch.items():
        if key not in _ALERT_FIELDS:
            raise ValueError(f"unknown setting: {key}")
        typ, _, lo, hi = _ALERT_FIELDS[key]
        try:
            value = typ(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{key}: invalid number {raw!r}") from exc
        if lo is not None and value < lo:
            raise ValueError(f"{key}: must be >= {lo:g}")
        if hi is not None and value > hi:
            raise ValueError(f"{key}: must be <= {hi:g}")
        clean[key] = value

    if clean:
        db.settings().update_one(
            {"_id": _ALERT_DOC},
            {"$set": {**clean, "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    return get_alert_config()


def _coerce_bool(raw) -> bool:
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def get_notification_config() -> dict:
    """Effective WhatsApp notification config (DB overrides over defaults)."""
    stored = db.settings().find_one({"_id": _NOTIF_DOC}) or {}
    out: dict[str, object] = {}
    for name, (typ, default) in _NOTIFICATION_FIELDS.items():
        raw = stored.get(name)
        if raw is None or (typ is str and str(raw).strip() == "" and default == ""):
            value = default
        elif typ is bool:
            value = _coerce_bool(raw if raw != "" else default)
        else:
            value = str(raw).strip()
        out[name] = value
    return out


def update_notification_config(patch: dict) -> dict:
    """Validate and persist a partial WhatsApp config update."""
    clean: dict[str, object] = {}
    for key, raw in patch.items():
        if key not in _NOTIFICATION_FIELDS:
            raise ValueError(f"unknown setting: {key}")
        typ, _ = _NOTIFICATION_FIELDS[key]
        if typ is bool:
            clean[key] = _coerce_bool(raw)
        else:
            value = str(raw).strip()
            if key == "whatsapp_base_url" and not value.startswith(("http://", "https://")):
                raise ValueError("whatsapp_base_url must start with http:// or https://")
            clean[key] = value

    if clean:
        db.settings().update_one(
            {"_id": _NOTIF_DOC},
            {"$set": {**clean, "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    return get_notification_config()


def get_config_sync_config() -> dict:
    """Effective site-config-backup settings (DB overrides over defaults)."""
    stored = db.settings().find_one({"_id": _SYNC_DOC}) or {}
    out: dict[str, object] = {}
    for name, (typ, default, lo) in _SYNC_FIELDS.items():
        raw = stored.get(name)
        if typ is bool:
            value = default if raw is None else _coerce_bool(raw)
        else:
            try:
                value = typ(default if raw is None else raw)
            except (TypeError, ValueError):
                value = typ(default)
            if lo is not None:
                value = max(lo, value)
        if name == "config_sync_hour":
            value = min(23, int(value))
        out[name] = value
    return out


def update_config_sync_config(patch: dict) -> dict:
    """Validate and persist a partial config-sync update."""
    clean: dict[str, object] = {}
    for key, raw in patch.items():
        if key not in _SYNC_FIELDS:
            raise ValueError(f"unknown setting: {key}")
        typ, _, lo = _SYNC_FIELDS[key]
        if typ is bool:
            clean[key] = _coerce_bool(raw)
        else:
            try:
                value = int(raw)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{key}: invalid number {raw!r}") from exc
            if lo is not None and value < lo:
                raise ValueError(f"{key}: must be >= {lo:g}")
            clean[key] = value
    if "config_sync_hour" in clean and clean["config_sync_hour"] > 23:
        raise ValueError("config_sync_hour: must be <= 23")

    if clean:
        db.settings().update_one(
            {"_id": _SYNC_DOC},
            {"$set": {**clean, "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    return get_config_sync_config()


def get_agent_config(server_id: str) -> dict:
    """Effective agent runtime config for a server (global defaults + overrides)."""
    from app.database.connection import parse_id
    sync_cfg = get_config_sync_config()
    sid = parse_id(server_id) or server_id
    override = (
        db.server_configs().find_one({"$or": [{"server_id": sid}, {"server_id": server_id}]})
        or {}
    )

    col_raw = override.get("config_collections")
    formatted_collections: list[dict] = []

    if isinstance(col_raw, dict):
        formatted_collections = [
            {"database": str(d), "collections": [str(x) for x in c]}
            for d, c in col_raw.items()
        ]
    elif isinstance(col_raw, list):
        for item in col_raw:
            if isinstance(item, dict) and item.get("database"):
                cols = item.get("collections", [])
                cols_list = [str(x) for x in cols] if isinstance(cols, (list, tuple)) else []
                formatted_collections.append({
                    "database": str(item["database"]),
                    "collections": cols_list,
                })
    else:
        formatted_collections = [
            {"database": d, "collections": list(c)}
            for d, c in _AGENT_DEFAULT_COLLECTIONS.items()
        ]

    monitored_services = override.get("monitored_services")
    if not isinstance(monitored_services, list):
        monitored_services = list(_AGENT_DEFAULT_SERVICES)

    targets = override.get("connectivity_targets")
    if not isinstance(targets, list):
        targets = _AGENT_DEFAULT_TARGETS

    enabled = override.get("config_sync_enabled", sync_cfg["config_sync_enabled"])
    hour = int(override.get("config_sync_hour", sync_cfg["config_sync_hour"]))

    scalars: dict[str, object] = {}
    for key, default in _AGENT_SCALAR_DEFAULTS.items():
        scalars[key] = override.get(key, default)

    return {
        "config_sync_enabled": bool(enabled),
        "config_sync_hour": max(0, min(23, hour)),
        "monitored_services": [str(s) for s in monitored_services],
        "config_collections": formatted_collections,
        "connectivity_targets": [
            {"name": str(t.get("name", "")), "ip": str(t.get("ip", ""))}
            for t in targets
            if isinstance(t, dict) and t.get("name") and t.get("ip")
        ],
        "trigger_sync_id": str(override.get("trigger_sync_id", "")),
        **scalars,
    }



def _coerce_clamped_int(raw, key: str, lo: float, hi: float) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key}: invalid number {raw!r}") from exc
    if value < lo or value > hi:
        raise ValueError(f"{key}: must be between {lo:g} and {hi:g}")
    return value


def update_agent_config(server_id: str, patch: dict) -> dict:
    """Validate and persist a partial per-server agent-config override."""
    clean: dict[str, object] = {}
    bool_keys = {"config_sync_enabled", "mongo_config_enabled"}
    int_keys = {
        "config_sync_hour": (0, 23),
        "monitoring_interval_seconds": (1, 3600),
        "http_timeout_seconds": (1, 120),
        "http_retry_count": (0, 10),
        "config_poll_interval_seconds": (1, 300),
        "connectivity_poll_interval_seconds": (1, 3600),
    }
    list_keys = {"monitored_services", "config_collections", "connectivity_targets"}
    str_keys = {"mongo_uri", "mongo_auth_source"}
    allowed = bool_keys | set(int_keys) | list_keys | str_keys

    for key, raw in patch.items():
        if key not in allowed:
            raise ValueError(f"unknown setting: {key}")
        if key in bool_keys:
            clean[key] = _coerce_bool(raw)
        elif key in int_keys:
            lo, hi = int_keys[key]
            clean[key] = _coerce_clamped_int(raw, key, lo, hi)
        elif key == "monitored_services":
            if not isinstance(raw, (list, tuple)):
                raise ValueError("monitored_services: must be a list")
            clean[key] = [str(s).strip() for s in raw if str(s).strip()]
        elif key == "config_collections":
            if not isinstance(raw, (list, tuple)):
                raise ValueError("config_collections: must be a list")
            clean[key] = _normalize_collections(raw)
        elif key == "connectivity_targets":
            if not isinstance(raw, (list, tuple)):
                raise ValueError("connectivity_targets: must be a list")
            clean[key] = _normalize_targets(raw)
        else:  # mongo_uri / mongo_auth_source
            clean[key] = str(raw).strip()

    if clean:
        db.server_configs().update_one(
            {"server_id": server_id},
            {"$set": {**clean, "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    return get_agent_config(server_id)


def _normalize_collections(raw) -> dict[str, list[str]]:
    normalized: dict[str, list[str]] = {}
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("config_collections: each entry must be an object")
        database = str(item.get("database", "")).strip()
        collections = item.get("collections", [])
        if not database:
            raise ValueError("config_collections: database is required")
        if not isinstance(collections, (list, tuple)):
            raise ValueError(f"config_collections[{database}]: collections must be a list")
        normalized[database] = [str(c).strip() for c in collections if str(c).strip()]
    return normalized


def _normalize_targets(raw) -> list[dict]:
    normalized: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("connectivity_targets: each entry must be an object")
        name = str(item.get("name", "")).strip()
        ip = str(item.get("ip", "")).strip()
        if not name or not ip:
            raise ValueError("connectivity_targets: name and ip are required")
        normalized.append({"name": name, "ip": ip})
    return normalized


_CLIENT_ALERTS_DOC = "client_alerts"


def get_disabled_clients() -> list[str]:
    doc = db.settings().find_one({"_id": _CLIENT_ALERTS_DOC}) or {}
    return doc.get("disabled_clients", [])


def is_client_alerts_enabled(client_name: str) -> bool:
    disabled = get_disabled_clients()
    return client_name not in disabled


def set_client_alerts_enabled(client_name: str, enabled: bool) -> dict:
    doc = db.settings().find_one({"_id": _CLIENT_ALERTS_DOC}) or {}
    disabled = set(doc.get("disabled_clients", []))
    if enabled:
        disabled.discard(client_name)
    else:
        disabled.add(client_name)
    dis_list = list(disabled)
    db.settings().update_one(
        {"_id": _CLIENT_ALERTS_DOC},
        {"$set": {"disabled_clients": dis_list, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"disabled_clients": dis_list}

