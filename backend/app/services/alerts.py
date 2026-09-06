"""Alert engine: evaluate thresholds, create/dedupe/resolve alerts."""

from datetime import datetime, timezone
from typing import Optional

from app.database import models as db
from app.database.connection import new_id
from app.realtime import emit
from app.config.settings import settings
from app.services import app_settings, notifier
from app.services.logging_setup import get_logger

logger = get_logger(__name__)


def now() -> datetime:
    return datetime.now(timezone.utc)


def _active_alert(
    alert_type: str, server_id, service_name: Optional[str] = None
) -> Optional[dict]:
    query: dict = {
        "type": alert_type,
        "server_id": server_id,
        "status": "active",
        "service_name": service_name,
    }
    return db.alerts().find_one(query)


def _open_alert(
    alert_type: str,
    server_id,
    severity: str,
    message: str,
    service_name: Optional[str] = None,
    value: Optional[float] = None,
    threshold: Optional[float] = None,
    hostname: Optional[str] = None,
    machine: Optional[str] = None,
    site_id=None,
) -> None:
    existing = _active_alert(alert_type, server_id, service_name)
    timestamp = now()
    if existing:
        db.alerts().update_one(
            {"_id": existing["_id"]},
            {"$set": {"last_seen_at": timestamp, "value": value, "message": message}},
        )
        return
    db.alerts().insert_one(
        {
            "_id": new_id(),
            "type": alert_type,
            "server_id": server_id,
            "service_name": service_name,
            "severity": severity,
            "message": message,
            "value": value,
            "threshold": threshold,
            "status": "active",
            "created_at": timestamp,
            "last_seen_at": timestamp,
            "resolved_at": None,
        }
    )
    emit(
        "alert_opened",
        {
            "server_id": str(server_id),
            "type": alert_type,
            "severity": severity,
            "message": message,
            "hostname": hostname,
            "machine": machine,
        },
    )
    notifier.notify_alert(
        severity=severity,
        hostname=hostname,
        machine=machine,
        message=message,
        site_id=site_id,
    )
    logger.warning(
        "alert opened",
        extra={
            "extra_fields": {
                "type": alert_type,
                "severity": severity,
                "message": message,
                "server_id": str(server_id),
            }
        },
    )


def _resolve_alert(
    alert_type: str,
    server_id,
    service_name: Optional[str] = None,
    hostname: Optional[str] = None,
    machine: Optional[str] = None,
    site_id=None,
    current_value: Optional[float] = None,
) -> None:
    """Resolve an active alert, log the recovery/online event log, and send notifications."""
    existing = _active_alert(alert_type, server_id, service_name)
    if existing is None:
        return
    timestamp = now()
    db.alerts().update_one(
        {"_id": existing["_id"]},
        {"$set": {"status": "resolved", "resolved_at": timestamp}},
    )

    if alert_type == "server_offline":
        msg = f"Server {hostname or machine or server_id} is back ONLINE (heartbeat restored)"
    elif alert_type == "service_stopped":
        msg = f"Service {service_name or ''} on {hostname or machine or server_id} is back ONLINE"
    elif alert_type == "cpu_high":
        val_str = f" ({current_value:.1f}%)" if current_value is not None else ""
        msg = f"CPU usage on {hostname or machine or server_id} recovered to normal{val_str}"
    elif alert_type == "ram_high":
        val_str = f" ({current_value:.1f}%)" if current_value is not None else ""
        msg = f"Memory usage on {hostname or machine or server_id} recovered to normal{val_str}"
    elif alert_type == "disk_high":
        val_str = f" ({current_value:.1f}%)" if current_value is not None else ""
        msg = f"Disk usage on {hostname or machine or server_id} recovered to normal{val_str}"
    elif alert_type == "api_error_spike":
        val_str = f" ({current_value:.1f}%)" if current_value is not None else ""
        msg = f"API Error Rate on {hostname or machine or server_id} recovered to normal{val_str}"
    else:
        msg = f"Alert {alert_type} on {hostname or machine or server_id} resolved"

    # Insert an event log entry into db.alerts() so log history displays BOTH Offline and Online events
    db.alerts().insert_one(
        {
            "_id": new_id(),
            "type": f"{alert_type}_resolved",
            "server_id": server_id,
            "service_name": service_name,
            "severity": "info",
            "message": msg,
            "value": current_value,
            "threshold": existing.get("threshold"),
            "status": "resolved",
            "created_at": timestamp,
            "last_seen_at": timestamp,
            "resolved_at": timestamp,
        }
    )

    emit(
        "alert_resolved",
        {
            "server_id": str(server_id),
            "type": alert_type,
            "severity": "info",
            "message": msg,
            "hostname": hostname,
            "machine": machine,
        },
    )
    notifier.notify_alert(
        severity="info",
        hostname=hostname,
        machine=machine,
        message=msg,
        site_id=site_id,
    )
    logger.info(
        "alert resolved",
        extra={"extra_fields": {"type": alert_type, "server_id": str(server_id), "message": msg}},
    )


def evaluate_server(server: dict, cfg: Optional[dict] = None) -> None:
    """Evaluate one server: health status + metric/service thresholds.

    ``cfg`` is the effective alert config (fetched once per sweep by
    :func:`evaluate_all_alerts`); fetched on demand when omitted.
    """
    from app.services.monitoring import compute_status

    if cfg is None:
        cfg = app_settings.get_alert_config()

    offline_timeout = int(cfg.get("offline_threshold_seconds", settings.health_warning_max_seconds))
    last_seen = server.get("last_seen_at")
    status = compute_status(last_seen, warning_max_seconds=offline_timeout)
    server_id = server["_id"]
    hostname = server.get("hostname")
    machine = server.get("name")
    site_id = server.get("site_id")

    if status == "offline":
        _open_alert(
            "server_offline",
            server_id,
            "critical",
            f"Server {hostname or machine or server_id} is offline "
            f"(no heartbeat for >{offline_timeout}s)",
            hostname=hostname,
            machine=machine,
            site_id=site_id,
        )
    else:
        _resolve_alert("server_offline", server_id, hostname=hostname, machine=machine, site_id=site_id)

    if status == "unknown":
        return

    from datetime import timedelta

    cutoff = now() - timedelta(seconds=cfg["cpu_duration_seconds"])
    samples = list(
        db.metrics()
        .find({"server_id": server_id, "recorded_at": {"$gte": cutoff}})
        .sort("recorded_at", -1)
    )
    if not samples:
        return

    latest = samples[0]

    # CPU high: sustained (>=3 samples) above threshold within the window
    sustained = [s for s in samples if s["cpu_percent"] >= cfg["cpu_threshold_percent"]]
    if len(sustained) >= 3 and len(samples) >= 3:
        _open_alert(
            "cpu_high",
            server_id,
            "warning",
            f"CPU at {latest['cpu_percent']:.1f}% for {cfg['cpu_duration_seconds']}s",
            value=latest["cpu_percent"],
            threshold=cfg["cpu_threshold_percent"],
            hostname=hostname,
            machine=machine,
            site_id=site_id,
        )
    else:
        _resolve_alert("cpu_high", server_id, hostname=hostname, machine=machine, site_id=site_id, current_value=latest["cpu_percent"])

    # RAM high
    if latest["memory_percent"] >= cfg["ram_threshold_percent"]:
        _open_alert(
            "ram_high",
            server_id,
            "warning",
            f"Memory at {latest['memory_percent']:.1f}%",
            value=latest["memory_percent"],
            threshold=cfg["ram_threshold_percent"],
            hostname=hostname,
            machine=machine,
            site_id=site_id,
        )
    else:
        _resolve_alert("ram_high", server_id, hostname=hostname, machine=machine, site_id=site_id, current_value=latest["memory_percent"])

    # Disk high
    if latest["disk_percent"] >= cfg["disk_threshold_percent"]:
        _open_alert(
            "disk_high",
            server_id,
            "warning",
            f"Disk at {latest['disk_percent']:.1f}%",
            value=latest["disk_percent"],
            threshold=cfg["disk_threshold_percent"],
            hostname=hostname,
            machine=machine,
            site_id=site_id,
        )
    else:
        _resolve_alert("disk_high", server_id, hostname=hostname, machine=machine, site_id=site_id, current_value=latest["disk_percent"])

    # Service stopped/error
    for service in db.services().find({"server_id": server_id}):
        if service["status"] in ("stopped", "error"):
            _open_alert(
                "service_stopped",
                server_id,
                "critical",
                f"Service {service['name']} is {service['status']}",
                service_name=service["name"],
                hostname=hostname,
                machine=machine,
                site_id=site_id,
            )
        else:
            _resolve_alert("service_stopped", server_id, service_name=service["name"], hostname=hostname, machine=machine, site_id=site_id)

    # API / Inter-service Error Monitoring (Status 400-599)
    api_5xx = latest.get("api_requests_5xx", 0) or 0
    api_4xx = latest.get("api_requests_4xx", 0) or 0
    api_err_rate = float(latest.get("api_error_rate_percent", 0.0) or 0.0)
    thresh = float(cfg.get("api_error_threshold_percent", 5.0) or 5.0)

    if api_5xx > 0 or (api_err_rate >= thresh and (api_5xx + api_4xx) > 0):
        severity = "critical" if api_5xx > 0 or api_err_rate >= 10.0 else "warning"
        msg = f"API Error Spike: {api_err_rate:.1f}% errors (5xx: {api_5xx}, 4xx: {api_4xx})"
        _open_alert(
            "api_error_spike",
            server_id,
            severity,
            msg,
            value=api_err_rate,
            threshold=thresh,
            hostname=hostname,
            machine=machine,
            site_id=site_id,
        )
    else:
        _resolve_alert("api_error_spike", server_id, hostname=hostname, machine=machine, site_id=site_id, current_value=api_err_rate)