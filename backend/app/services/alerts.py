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
_BOOT_TIME: datetime = datetime.now(timezone.utc)


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
    elif alert_type.startswith("integration_error_spike"):
        widget_label = alert_type.split(":", 1)[1] if ":" in alert_type else "Integration"
        val_str = f" ({current_value:.1f}%)" if current_value is not None else ""
        msg = f"Integration '{widget_label}' failure rate recovered to normal{val_str}"
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
    if site_id:
        site_doc = db.sites().find_one({"_id": site_id})
        if site_doc:
            client_name = site_doc.get("client")
            if client_name and not app_settings.is_client_alerts_enabled(client_name):
                return
            if not site_doc.get("alerts_enabled", True):
                return

    if status == "offline":
        # Master deploy / backend startup grace period (allow agents to reconnect after central deploy)
        boot_elapsed = (now() - _BOOT_TIME).total_seconds()
        startup_grace = int(getattr(settings, "master_deploy_grace_seconds", 180))
        if boot_elapsed < startup_grace:
            logger.debug(
                "suppressing server_offline alert during backend startup grace",
                extra={"extra_fields": {"server_id": str(server_id), "boot_elapsed": boot_elapsed, "grace": startup_grace}},
            )
            return

        # Agent self-update grace period (allow remote agents to download release and restart systemd cleanly)
        from app.routes.agent_update import is_agent_update_in_progress
        if is_agent_update_in_progress(server_id):
            logger.debug(
                "suppressing server_offline alert during agent update grace window",
                extra={"extra_fields": {"server_id": str(server_id)}},
            )
            return

        last_seen = server.get("last_seen_at")
        grace = int(cfg.get("alert_offline_grace_seconds", settings.alert_offline_grace_seconds))
        effective_offline_limit = offline_timeout + grace
        if last_seen:
            offline_duration = (now() - last_seen).total_seconds()
            if offline_duration >= effective_offline_limit:
                _open_alert(
                    "server_offline",
                    server_id,
                    "critical",
                    f"Server {hostname or machine or server_id} is offline "
                    f"(no heartbeat for >{effective_offline_limit}s)",
                    hostname=hostname,
                    machine=machine,
                    site_id=site_id,
                )
            else:
                _resolve_alert("server_offline", server_id, hostname=hostname, machine=machine, site_id=site_id)
        else:
            _open_alert(
                "server_offline",
                server_id,
                "critical",
                f"Server {hostname or machine or server_id} is offline "
                f"(no heartbeat for >{effective_offline_limit}s)",
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

    # Integration Logs Failure Rate Monitoring
    _check_integration_failure_rate(server_id, cfg, hostname, machine, site_id)


def _check_integration_failure_rate(
    server_id: str,
    cfg: dict,
    hostname: Optional[str],
    machine: Optional[str],
    site_id: Optional[str],
) -> None:
    """Check if integration failure rate exceeds widget-specific thresholds."""
    from app.database.connection import parse_id

    agent_cfg = app_settings.get_agent_config(str(server_id))
    widgets = agent_cfg.get("custom_widgets", [])
    if not widgets:
        sid_filter = {"$in": [server_id, parse_id(server_id)]} if parse_id(server_id) else server_id
        for active in db.alerts().find(
            {"server_id": sid_filter, "type": {"$regex": "^integration_error_spike:"}, "status": "active"}
        ):
            _resolve_alert(active["type"], server_id, hostname=hostname, machine=machine, site_id=site_id)
        return

    for w in widgets:
        w_name = w.get("name")
        if not w_name:
            continue
        alert_key = f"integration_error_spike:{w_name}"
        if not w.get("enabled", True):
            _resolve_alert(alert_key, server_id, hostname=hostname, machine=machine, site_id=site_id)
            continue

        threshold = float(w.get("alert_threshold_percent", 50.0))
        window_min = int(w.get("alert_window_minutes", 15))

        sid_val = parse_id(server_id) or server_id
        sample = db.widget_data().find_one(
            {"$or": [{"server_id": sid_val}, {"server_id": str(server_id)}], "widget_name": w_name},
            sort=[("received_at", -1)],
        )
        if not sample:
            _resolve_alert(alert_key, server_id, hostname=hostname, machine=machine, site_id=site_id)
            continue

        sample_time = sample.get("received_at") or sample.get("collected_at")
        if sample_time and (now() - sample_time).total_seconds() > window_min * 60 * 2:
            _resolve_alert(alert_key, server_id, hostname=hostname, machine=machine, site_id=site_id)
            continue

        total = int(sample.get("total", 0))
        groups = sample.get("groups", {})
        if total == 0:
            _resolve_alert(alert_key, server_id, hostname=hostname, machine=machine, site_id=site_id)
            continue

        failed = sum(
            int(count) for k, count in groups.items()
            if any(term in str(k).upper() for term in ("FAIL", "ERR", "EXPIRE", "INVALID", "REJECT"))
        )

        failure_rate = (failed / total) * 100.0 if total > 0 else 0.0

        if failure_rate >= threshold:
            _open_alert(
                alert_key,
                server_id,
                "warning",
                f"Integration '{w_name}' failure rate at {failure_rate:.1f}% ({failed}/{total} failed in {window_min}min)",
                value=failure_rate,
                threshold=threshold,
                hostname=hostname,
                machine=machine,
                site_id=site_id,
            )
        else:
            _resolve_alert(
                alert_key,
                server_id,
                hostname=hostname,
                machine=machine,
                site_id=site_id,
                current_value=failure_rate,
            )