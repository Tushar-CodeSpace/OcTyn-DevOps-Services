"""Background jobs: health sweep, alert evaluation, retention cleanup."""

import asyncio
from datetime import datetime, timedelta, timezone

from app.config.settings import settings
from app.database import models as db
from app.realtime import emit
from app.services import alerts, app_settings
from app.services.logging_setup import get_logger
from app.services.monitoring import compute_status, effective_status

logger = get_logger(__name__)

_retention_days = settings.metrics_retention_days


def now() -> datetime:
    return datetime.now(timezone.utc)


def sweep_server_health() -> int:
    """Recompute status for every server from heartbeat age + active warnings."""
    changed = 0
    warning_servers = {
        a["server_id"]
        for a in db.alerts().find(
            {"status": "active", "severity": "warning"}, {"server_id": 1}
        )
    }
    for server in db.servers().find({}):
        status = compute_status(server.get("last_seen_at"))
        status = effective_status(status, server["_id"] in warning_servers)
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
    return db.alerts().count_documents({"status": "active"})


def cleanup_expired_data() -> dict:
    """Delete raw metrics, site configs, terminal logs, and resolved alerts older than retention period (default 7 days)."""
    retention_days = app_settings.get_retention_days()
    cutoff = now() - timedelta(days=retention_days)

    deleted_metrics = db.metrics().delete_many({"recorded_at": {"$lt": cutoff}}).deleted_count
    deleted_configs = db.site_configs().delete_many({"received_at": {"$lt": cutoff}}).deleted_count
    deleted_commands = db.terminal_commands().delete_many({"created_at": {"$lt": cutoff}}).deleted_count
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
                "alerts": deleted_alerts,
            }
        },
    )
    return {
        "retention_days": retention_days,
        "metrics": deleted_metrics,
        "site_configs": deleted_configs,
        "terminal_commands": deleted_commands,
        "alerts": deleted_alerts,
    }


async def run_background_loop() -> None:
    """Periodic evaluator: health sweep + alert evaluation + daily cleanup."""
    interval = settings.evaluator_interval_seconds
    logger.info("background loop started", extra={"extra_fields": {"interval_s": interval}})
    last_cleanup = now().date()
    while True:
        try:
            await asyncio.sleep(interval)
            sweep_server_health()
            active = evaluate_all_alerts()
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