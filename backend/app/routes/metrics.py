"""Metrics routes: agent ingestion + dashboard queries."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.schemas.metrics import MetricCreate, MetricIngestResponse, MetricRead
from app.services import app_settings
from app.services import authentication as auth
from app.services import monitoring
from app.services.monitoring import authenticate_agent

router = APIRouter(prefix="/api/v1/metrics", tags=["metrics"])


def now() -> datetime:
    return datetime.now(timezone.utc)


def metric_doc_to_read(doc: dict) -> MetricRead:
    return MetricRead(
        id=doc["_id"],
        server_id=str(doc["server_id"]),
        timestamp=doc["timestamp"],
        cpu_percent=doc["cpu_percent"],
        memory_percent=doc["memory_percent"],
        memory_total=doc["memory_total"],
        memory_available=doc["memory_available"],
        disk_percent=doc["disk_percent"],
        disk_total=doc["disk_total"],
        disk_free=doc["disk_free"],
        network_bytes_sent=doc["network_bytes_sent"],
        network_bytes_received=doc["network_bytes_received"],
        disk_read_bytes=doc.get("disk_read_bytes", 0.0),
        disk_write_bytes=doc.get("disk_write_bytes", 0.0),
        disk_read_rate_mb=doc.get("disk_read_rate_mb", 0.0),
        disk_write_rate_mb=doc.get("disk_write_rate_mb", 0.0),
        disk_iops=doc.get("disk_iops", 0.0),
        io_status=doc.get("io_status"),
        api_requests_total=doc.get("api_requests_total", 0),
        api_requests_4xx=doc.get("api_requests_4xx", 0),
        api_requests_5xx=doc.get("api_requests_5xx", 0),
        api_error_rate_percent=doc.get("api_error_rate_percent", 0.0),
        api_recent_errors=doc.get("api_recent_errors"),
        uptime_seconds=doc["uptime_seconds"],
        recorded_at=doc["recorded_at"],
    )


@router.post("", response_model=MetricIngestResponse)
async def ingest_metric(
    payload: MetricCreate,
    agent: dict = Depends(authenticate_agent),
) -> MetricIngestResponse:
    """Agent endpoint: receive one metric sample for an authenticated server."""
    server = agent["server"]

    if payload.server_id != server["_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API key does not match server_id",
        )

    updates: dict = {}
    if getattr(payload, "hostname", None):
        updates["hostname"] = payload.hostname
    if getattr(payload, "ip_address", None):
        updates["ip_address"] = payload.ip_address
    if updates:
        updates["updated_at"] = now()
        db.servers().update_one({"_id": server["_id"]}, {"$set": updates})

    doc = payload.model_dump(exclude={"server_id"}) | {
        "_id": new_id(),
        "server_id": server["_id"],
        "recorded_at": now(),
    }
    db.metrics().insert_one(doc)

    emit(
        "metric",
        {
            "id": doc["_id"],
            "server_id": server["_id"],
            "timestamp": doc["timestamp"].isoformat(),
            "recorded_at": doc["recorded_at"].isoformat(),
            "cpu_percent": doc["cpu_percent"],
            "memory_percent": doc["memory_percent"],
            "memory_total": doc["memory_total"],
            "memory_available": doc["memory_available"],
            "disk_percent": doc["disk_percent"],
            "disk_total": doc["disk_total"],
            "disk_free": doc["disk_free"],
            "network_bytes_sent": doc["network_bytes_sent"],
            "network_bytes_received": doc["network_bytes_received"],
            "disk_read_bytes": doc.get("disk_read_bytes", 0.0),
            "disk_write_bytes": doc.get("disk_write_bytes", 0.0),
            "disk_read_rate_mb": doc.get("disk_read_rate_mb", 0.0),
            "disk_write_rate_mb": doc.get("disk_write_rate_mb", 0.0),
            "disk_iops": doc.get("disk_iops", 0.0),
            "io_status": doc.get("io_status"),
            "api_requests_total": doc.get("api_requests_total", 0),
            "api_requests_4xx": doc.get("api_requests_4xx", 0),
            "api_requests_5xx": doc.get("api_requests_5xx", 0),
            "api_error_rate_percent": doc.get("api_error_rate_percent", 0.0),
            "api_recent_errors": doc.get("api_recent_errors"),
            "uptime_seconds": doc["uptime_seconds"],
        },
        room=f"server:{server['_id']}",
    )

    db.servers().update_one(
        {"_id": server["_id"]},
        {
            "$set": {
                "last_seen_at": doc["recorded_at"],
                "status": monitoring.effective_status(
                    monitoring.compute_status(doc["recorded_at"], doc["recorded_at"]),
                    monitoring.has_active_warning(server["_id"]),
                ),
                "updated_at": doc["recorded_at"],
            }
        },
    )
    server_id = str(server["_id"])
    updated_server = db.servers().find_one({"_id": server["_id"]})
    if updated_server is not None:
        server_payload = {
            "id": str(updated_server["_id"]),
            "site_id": str(updated_server["site_id"]),
            "name": updated_server["name"],
            "hostname": updated_server["hostname"],
            "ip_address": updated_server.get("ip_address"),
            "status": updated_server.get("status", "unknown"),
            "last_seen_at": updated_server.get("last_seen_at").isoformat()
            if updated_server.get("last_seen_at")
            else None,
            "created_at": updated_server["created_at"].isoformat(),
            "updated_at": updated_server["updated_at"].isoformat(),
        }
        emit("server_updated", server_payload, room=f"server:{server_id}")
        emit(
            "server_status",
            {"server_id": server_id, "status": server_payload["status"]},
        )
    agent_cfg = app_settings.get_agent_config(server_id)
    return MetricIngestResponse(
        success=True,
        config_sync_enabled=bool(agent_cfg["config_sync_enabled"]),
        config_sync_hour=int(agent_cfg["config_sync_hour"]),
        monitored_services=agent_cfg["monitored_services"],
        config_collections=agent_cfg["config_collections"],
        connectivity_targets=agent_cfg["connectivity_targets"],
        connectivity_poll_interval_seconds=int(
            agent_cfg["connectivity_poll_interval_seconds"]
        ),
        trigger_sync_id=str(agent_cfg.get("trigger_sync_id", "")),
    )


@router.get("/servers/{server_id}", response_model=list[MetricRead])
async def list_metrics(
    server_id: str,
    minutes: int = Query(default=60, ge=1, le=43200),
    limit: int = Query(default=1000, ge=1, le=10000),
    _: dict = Depends(auth.get_current_user),
) -> list[MetricRead]:
    """Dashboard endpoint: recent metrics for a server (time-series data).

    Windows up to 2h return raw samples (newest-first under ``limit``,
    re-sorted chronologically). Wider windows are downsampled into fixed-size
    time buckets so charts always cover the full requested range.
    """
    sid = parse_id(server_id)
    if sid is None or db.servers().find_one({"_id": sid}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    since = now() - timedelta(minutes=minutes)

    if minutes <= 120:
        docs = list(
            db.metrics()
            .find({"server_id": sid, "recorded_at": {"$gte": since}})
            .sort("recorded_at", -1)
            .limit(limit)
        )
        return [metric_doc_to_read(d) for d in reversed(docs)]

    # Downsampled path for wide windows.
    if minutes <= 360:
        bucket_seconds = 30
    elif minutes <= 1440:
        bucket_seconds = 120
    elif minutes <= 10_080:
        bucket_seconds = 1200
    else:
        bucket_seconds = 5400

    bucket_ms = bucket_seconds * 1000
    pipeline = [
        {"$match": {"server_id": sid, "recorded_at": {"$gte": since}}},
        {"$sort": {"recorded_at": 1}},
        {
            "$group": {
                "_id": {
                    "$subtract": [
                        {"$toLong": "$recorded_at"},
                        {"$mod": [{"$toLong": "$recorded_at"}, bucket_ms]},
                    ]
                },
                "cpu_percent": {"$avg": "$cpu_percent"},
                "memory_percent": {"$avg": "$memory_percent"},
                "memory_total": {"$avg": "$memory_total"},
                "memory_available": {"$avg": "$memory_available"},
                "disk_percent": {"$avg": "$disk_percent"},
                "disk_total": {"$avg": "$disk_total"},
                "disk_free": {"$avg": "$disk_free"},
                "network_bytes_sent": {"$last": "$network_bytes_sent"},
                "network_bytes_received": {"$last": "$network_bytes_received"},
                "uptime_seconds": {"$avg": "$uptime_seconds"},
            }
        },
        {"$sort": {"_id": 1}},
    ]
    out: list[MetricRead] = []
    for b in db.metrics().aggregate(pipeline):
        ts = datetime.fromtimestamp(b["_id"] / 1000.0, tz=timezone.utc)
        out.append(
            MetricRead(
                id=f"{sid}-{b['_id']}",
                server_id=str(sid),
                timestamp=ts,
                cpu_percent=round(b["cpu_percent"], 2),
                memory_percent=round(b["memory_percent"], 2),
                memory_total=float(b["memory_total"]),
                memory_available=float(b["memory_available"]),
                disk_percent=round(b["disk_percent"], 2),
                disk_total=float(b["disk_total"]),
                disk_free=float(b["disk_free"]),
                network_bytes_sent=float(b["network_bytes_sent"]),
                network_bytes_received=float(b["network_bytes_received"]),
                uptime_seconds=float(b["uptime_seconds"]),
                recorded_at=ts,
            )
        )
    return out