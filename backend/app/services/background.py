import asyncio
from collections import deque
from datetime import datetime, timedelta, timezone
import os
import psutil

from app.config.settings import settings
from app.database import models as db
from app.realtime import emit
from app.services import alerts, app_settings
from app.services.logging_setup import get_logger
from app.services.monitoring import compute_status, effective_status

logger = get_logger(__name__)

_retention_days = settings.metrics_retention_days

_MASTER_METRICS_HISTORY: deque = deque(maxlen=60)


def record_master_metrics_snapshot() -> None:
    """Sample current master server host metrics and keep last 60 data points (10 minutes)."""
    try:
        mem = psutil.virtual_memory()
        try:
            disk = psutil.disk_usage("/")
        except Exception:
            disk = psutil.disk_usage(".")
        _MASTER_METRICS_HISTORY.append({
            "timestamp": now().isoformat(),
            "cpu_percent": float(psutil.cpu_percent(interval=None)),
            "memory_percent": float(mem.percent),
            "memory_used_mb": round(mem.used / (1024 * 1024), 1),
            "memory_total_mb": round(mem.total / (1024 * 1024), 1),
            "disk_percent": float(disk.percent),
            "disk_used_gb": round(disk.used / (1024 * 1024 * 1024), 2),
            "disk_total_gb": round(disk.total / (1024 * 1024 * 1024), 2),
        })
    except Exception:
        pass


def get_master_metrics_history() -> list[dict]:
    return list(_MASTER_METRICS_HISTORY)


def now() -> datetime:
    return datetime.now(timezone.utc)


def sweep_server_health() -> int:
    """Recompute status for every server from heartbeat age + active warning/critical alerts."""
    changed = 0
    alert_servers = {
        a["server_id"]
        for a in db.alerts().find(
            {"status": "active", "severity": {"$in": ["warning", "critical"]}}, {"server_id": 1}
        )
    }
    cfg = app_settings.get_alert_config()
    offline_timeout = int(cfg.get("offline_threshold_seconds", settings.health_warning_max_seconds))
    grace = int(cfg.get("alert_offline_grace_seconds", settings.alert_offline_grace_seconds))
    max_warn = offline_timeout + grace
    for server in db.servers().find({}):
        status = compute_status(server.get("last_seen_at"), warning_max_seconds=max_warn)
        status = effective_status(status, server["_id"] in alert_servers)
        if status != server.get("status"):
            db.servers().update_one(
                {"_id": server["_id"]},
                {"$set": {"status": status, "updated_at": now()}},
            )
            logger.info(
                "server status changed",
                extra={"extra_fields": {"server_id": str(server["_id"]), "status": status}},
            )
            emit(
                "server_status",
                {
                    "server_id": str(server["_id"]),
                    "status": status,
                    "hostname": server.get("hostname"),
                },
            )
            changed += 1
    return changed


def evaluate_all_alerts() -> int:
    cfg = app_settings.get_alert_config()
    for server in db.servers().find({}):
        alerts.evaluate_server(server, cfg)
    alerts.sweep_and_auto_resolve_alerts(cfg)
    return db.alerts().count_documents({"status": "active"})


def cleanup_expired_data() -> dict:
    """Delete raw metrics, site configs, terminal logs, agent logs, and resolved alerts older than retention period (default 7 days)."""
    retention_days = app_settings.get_retention_days()
    cutoff = now() - timedelta(days=retention_days)

    deleted_metrics = db.metrics().delete_many({"recorded_at": {"$lt": cutoff}}).deleted_count
    deleted_configs = db.site_configs().delete_many({"received_at": {"$lt": cutoff}}).deleted_count
    deleted_commands = db.terminal_commands().delete_many({"created_at": {"$lt": cutoff}}).deleted_count
    deleted_agent_logs = db.agent_logs().delete_many({"created_at": {"$lt": cutoff}}).deleted_count
    deleted_alerts = db.alerts().delete_many(
        {
            "$or": [
                {"status": "resolved", "resolved_at": {"$lt": cutoff}},
                {"created_at": {"$lt": cutoff}, "status": {"$ne": "active"}},
            ]
        }
    ).deleted_count

    logger.info(
        "retention cleanup complete",
        extra={
            "extra_fields": {
                "retention_days": retention_days,
                "metrics": deleted_metrics,
                "site_configs": deleted_configs,
                "terminal_commands": deleted_commands,
                "agent_logs": deleted_agent_logs,
                "alerts": deleted_alerts,
            }
        },
    )
    return {
        "retention_days": retention_days,
        "metrics": deleted_metrics,
        "site_configs": deleted_configs,
        "terminal_commands": deleted_commands,
        "agent_logs": deleted_agent_logs,
        "alerts": deleted_alerts,
    }


async def run_background_loop() -> None:
    """Periodic evaluator: health sweep + alert evaluation + daily cleanup."""
    interval = settings.evaluator_interval_seconds
    logger.info("background loop started", extra={"extra_fields": {"interval_s": interval}})
    # Take immediate initial snapshot on loop startup
    record_master_metrics_snapshot()
    while True:
        try:
            await asyncio.sleep(interval)
            sweep_server_health()
            active = evaluate_all_alerts()
            record_master_metrics_snapshot()
            if now().date() != last_cleanup:
                cleanup_expired_data()
                last_cleanup = now().date()
            logger.debug(
                "evaluation cycle complete",
                extra={"extra_fields": {"active_alerts": active}},
            )
        except asyncio.CancelledError:
            logger.info("background loop stopped")
            raise
        except Exception:
            logger.exception("background loop iteration failed")