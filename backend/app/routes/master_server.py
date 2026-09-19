"""Master Server monitoring routes: host metrics, process health, and MongoDB telemetry."""

import os
import platform
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import psutil
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.config.settings import settings
from app.database import models as db
from app.database.connection import get_db
from app.realtime import sio
from app.services import app_settings, audit as audit_trail, authentication as auth
from app.services.background import cleanup_expired_data, get_master_metrics_history

router = APIRouter(prefix="/api/v1/master-server", tags=["master-server"])

_BOOT_TIME = datetime.fromtimestamp(psutil.boot_time(), tz=timezone.utc)
_PROC = psutil.Process()


def now() -> datetime:
    return datetime.now(timezone.utc)


class DiskPartitionInfo(BaseModel):
    device: str
    mountpoint: str
    fstype: str
    total_bytes: int
    used_bytes: int
    free_bytes: int
    percent: float


class MongoCollectionStat(BaseModel):
    name: str
    document_count: int
    size_bytes: int
    storage_size_bytes: int
    indexes_count: int
    ttl_info: Optional[str] = None


class MasterServerStatusResponse(BaseModel):
    # Host & Operating System
    hostname: str
    platform_name: str
    platform_release: str
    platform_version: str
    architecture: str
    processor: str
    python_version: str
    boot_time: datetime
    uptime_seconds: int
    load_average: list[float]

    # CPU & Memory
    cpu_count_logical: int
    cpu_count_physical: int
    cpu_percent: float
    cpu_per_core: list[float]
    memory_total: int
    memory_used: int
    memory_available: int
    memory_percent: float
    swap_total: int
    swap_used: int
    swap_percent: float

    # Storage & Disks
    disk_total: int
    disk_used: int
    disk_free: int
    disk_percent: float
    partitions: list[DiskPartitionInfo]

    # Network I/O
    network_bytes_sent: int
    network_bytes_received: int
    network_interfaces: dict[str, list[str]]

    # Backend Application Process
    process_pid: int
    process_uptime_seconds: int
    process_memory_rss: int
    process_cpu_percent: float
    process_threads: int
    socketio_clients_count: int
    socketio_rooms_count: int
    environment: str
    api_port: int
    retention_days: int
    evaluator_interval_seconds: int

    # MongoDB Health & Telemetry
    mongodb_status: str
    mongodb_ping_ms: float
    mongodb_version: str
    database_name: str
    data_size_bytes: int
    storage_size_bytes: int
    index_size_bytes: int
    collections_count: int
    objects_count: int
    collections: list[MongoCollectionStat]

    # Fleet Status Summary
    fleet_total_servers: int
    fleet_online_servers: int
    fleet_warning_servers: int
    fleet_offline_servers: int
    fleet_total_sites: int
    active_alerts_count: int

    # Agent Release Telemetry
    agent_release_version: str
    agent_release_exists: bool
    agent_release_size_bytes: int


def get_network_interfaces() -> dict[str, list[str]]:
    interfaces: dict[str, list[str]] = {}
    try:
        addrs = psutil.net_if_addrs()
        for iface_name, iface_addrs in addrs.items():
            ips = []
            for addr in iface_addrs:
                if addr.family == socket.AF_INET:
                    ips.append(addr.address)
            if ips:
                interfaces[iface_name] = ips
    except Exception:
        pass
    return interfaces


def get_disk_partitions_info() -> list[DiskPartitionInfo]:
    partitions: list[DiskPartitionInfo] = []
    seen_mounts: set[str] = set()
    try:
        for part in psutil.disk_partitions(all=False):
            if part.mountpoint in seen_mounts:
                continue
            seen_mounts.add(part.mountpoint)
            try:
                usage = psutil.disk_usage(part.mountpoint)
                partitions.append(
                    DiskPartitionInfo(
                        device=part.device,
                        mountpoint=part.mountpoint,
                        fstype=part.fstype,
                        total_bytes=usage.total,
                        used_bytes=usage.used,
                        free_bytes=usage.free,
                        percent=float(usage.percent),
                    )
                )
            except Exception:
                continue
    except Exception:
        pass
    return partitions


def inspect_mongodb() -> dict[str, Any]:
    t0 = time.perf_counter()
    status = "healthy"
    ping_ms = 0.0
    version = ""
    db_name = ""
    data_size = 0
    storage_size = 0
    index_size = 0
    collections_count = 0
    objects_count = 0
    collections_detail: list[MongoCollectionStat] = []

    try:
        database = get_db()
        database.command("ping")
        ping_ms = round((time.perf_counter() - t0) * 1000, 2)
        db_name = database.name

        try:
            build_info = database.command("buildInfo")
            version = str(build_info.get("version", ""))
        except Exception:
            version = "unknown"

        try:
            db_stats = database.command("dbStats")
            data_size = int(db_stats.get("dataSize", 0))
            storage_size = int(db_stats.get("storageSize", 0))
            index_size = int(db_stats.get("indexSize", 0))
            collections_count = int(db_stats.get("collections", 0))
            objects_count = int(db_stats.get("objects", 0))
        except Exception:
            pass

        # Inspect all collections
        for col_name in sorted(database.list_collection_names()):
            if col_name.startswith("system."):
                continue
            col = database[col_name]
            doc_count = col.estimated_document_count()
            col_size = 0
            col_storage = 0
            indexes_count = 0
            ttl_info: Optional[str] = None

            try:
                indexes = list(col.list_indexes())
                indexes_count = len(indexes)
                for idx in indexes:
                    if "expireAfterSeconds" in idx:
                        ttl_sec = int(idx["expireAfterSeconds"])
                        days = ttl_sec / 86400
                        key_name = list(idx.get("key", {}).keys())[0] if idx.get("key") else "date"
                        ttl_info = f"{key_name}: {days:.1f}d ({ttl_sec}s)"
                        break
            except Exception:
                pass

            try:
                c_stats = database.command("collStats", col_name)
                col_size = int(c_stats.get("size", 0))
                col_storage = int(c_stats.get("storageSize", 0))
            except Exception:
                pass

            collections_detail.append(
                MongoCollectionStat(
                    name=col_name,
                    document_count=doc_count,
                    size_bytes=col_size,
                    storage_size_bytes=col_storage,
                    indexes_count=indexes_count,
                    ttl_info=ttl_info,
                )
            )

    except Exception:
        status = "degraded"

    return {
        "status": status,
        "ping_ms": ping_ms,
        "version": version,
        "database_name": db_name,
        "data_size": data_size,
        "storage_size": storage_size,
        "index_size": index_size,
        "collections_count": collections_count,
        "objects_count": objects_count,
        "collections": collections_detail,
    }


@router.get("/status", response_model=MasterServerStatusResponse)
async def get_master_server_status(
    _: dict = Depends(auth.get_current_user),
) -> MasterServerStatusResponse:
    """Master Hub telemetry: system resources, backend process health, and MongoDB storage."""
    # Host metrics
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    try:
        root_disk = psutil.disk_usage("/")
    except Exception:
        root_disk = psutil.disk_usage(".")

    net_io = psutil.net_io_counters()

    # Load avg (Linux) or zeroes (Windows)
    try:
        load_avg = [round(x, 2) for x in os.getloadavg()]
    except Exception:
        load_avg = [0.0, 0.0, 0.0]

    # Backend Process stats
    try:
        proc_mem = _PROC.memory_info().rss
        proc_cpu = float(_PROC.cpu_percent(interval=None))
        proc_threads = _PROC.num_threads()
        proc_uptime = int(time.time() - _PROC.create_time())
    except Exception:
        proc_mem = 0
        proc_cpu = 0.0
        proc_threads = 1
        proc_uptime = 0

    # Socket.IO stats
    socket_clients = 0
    socket_rooms = 0
    try:
        if hasattr(sio, "eio") and hasattr(sio.eio, "sockets"):
            socket_clients = len(sio.eio.sockets)
        if hasattr(sio, "manager") and hasattr(sio.manager, "rooms"):
            socket_rooms = len(sio.manager.rooms.get("/", {}))
    except Exception:
        pass

    # MongoDB telemetry
    mongo = inspect_mongodb()

    # Fleet overview
    servers = list(db.servers().find({}, {"status": 1}))
    total_servers = len(servers)
    online_servers = sum(1 for s in servers if s.get("status") == "online")
    warning_servers = sum(1 for s in servers if s.get("status") == "warning")
    offline_servers = sum(1 for s in servers if s.get("status") == "offline")
    total_sites = db.sites().count_documents({})
    active_alerts = db.alerts().count_documents({"status": "active"})

    # Agent release info
    agent_path = Path(__file__).resolve().parent.parent.parent.parent / "agent" / "agent_lite.py"
    if not agent_path.exists():
        agent_path = Path(__file__).resolve().parent.parent / "static" / "agent_lite.py"
    release_exists = agent_path.exists()
    release_size = agent_path.stat().st_size if release_exists else 0
    setting_doc = db.settings().find_one({"key": "agent_release"}) or {}
    release_ver = str(setting_doc.get("version", "1.0.0"))

    return MasterServerStatusResponse(
        hostname=socket.gethostname(),
        platform_name=platform.system(),
        platform_release=platform.release(),
        platform_version=platform.version(),
        architecture=platform.machine(),
        processor=platform.processor() or platform.machine(),
        python_version=platform.python_version(),
        boot_time=_BOOT_TIME,
        uptime_seconds=int(time.time() - psutil.boot_time()),
        load_average=load_avg,
        cpu_count_logical=psutil.cpu_count(logical=True) or 1,
        cpu_count_physical=psutil.cpu_count(logical=False) or psutil.cpu_count(logical=True) or 1,
        cpu_percent=float(psutil.cpu_percent(interval=None)),
        cpu_per_core=[float(x) for x in psutil.cpu_percent(interval=None, percpu=True)],
        memory_total=mem.total,
        memory_used=mem.used,
        memory_available=mem.available,
        memory_percent=float(mem.percent),
        swap_total=swap.total,
        swap_used=swap.used,
        swap_percent=float(swap.percent),
        disk_total=root_disk.total,
        disk_used=root_disk.used,
        disk_free=root_disk.free,
        disk_percent=float(root_disk.percent),
        partitions=get_disk_partitions_info(),
        network_bytes_sent=net_io.bytes_sent,
        network_bytes_received=net_io.bytes_recv,
        network_interfaces=get_network_interfaces(),
        process_pid=os.getpid(),
        process_uptime_seconds=proc_uptime,
        process_memory_rss=proc_mem,
        process_cpu_percent=proc_cpu,
        process_threads=proc_threads,
        socketio_clients_count=socket_clients,
        socketio_rooms_count=socket_rooms,
        environment=os.getenv("ENVIRONMENT", "production"),
        api_port=int(os.getenv("PORT", 8000)),
        retention_days=app_settings.get_retention_days(),
        evaluator_interval_seconds=settings.evaluator_interval_seconds,
        mongodb_status=mongo["status"],
        mongodb_ping_ms=mongo["ping_ms"],
        mongodb_version=mongo["version"],
        database_name=mongo["database_name"],
        data_size_bytes=mongo["data_size"],
        storage_size_bytes=mongo["storage_size"],
        index_size_bytes=mongo["index_size"],
        collections_count=mongo["collections_count"],
        objects_count=mongo["objects_count"],
        collections=mongo["collections"],
        fleet_total_servers=total_servers,
        fleet_online_servers=online_servers,
        fleet_warning_servers=warning_servers,
        fleet_offline_servers=offline_servers,
        fleet_total_sites=total_sites,
        active_alerts_count=active_alerts,
        agent_release_version=release_ver,
        agent_release_exists=release_exists,
        agent_release_size_bytes=release_size,
    )


@router.get("/history", response_model=list[dict])
async def get_master_metrics_timeseries(
    _: dict = Depends(auth.get_current_user),
) -> list[dict]:
    """Historical time-series points of master server CPU, memory, and disk."""
    return get_master_metrics_history()


@router.post(
    "/cleanup",
    response_model=dict,
    dependencies=[Depends(auth.require_admin)],
)
async def trigger_retention_cleanup(
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> dict:
    """Dashboard endpoint (admin): manually prune data older than retention limit and compact collections."""
    result = cleanup_expired_data()
    compacted_collections = []
    compaction_errors = []

    # Compact standard retention collections
    collections_to_compact = ["metrics", "site_configs", "terminal_commands", "agent_logs", "alerts"]
    for col_name in collections_to_compact:
        try:
            get_db().command("compact", col_name)
            compacted_collections.append(col_name)
        except Exception as exc:
            compaction_errors.append(f"{col_name}: {exc}")

    audit_trail.record(
        current,
        "retention_cleanup",
        request,
        {
            "retention_days": result["retention_days"],
            "pruned": result,
            "compacted": compacted_collections,
        },
    )

    return {
        "success": True,
        "retention_days": result["retention_days"],
        "pruned": result,
        "compacted": compacted_collections,
        "compaction_errors": compaction_errors,
        "executed_at": now().isoformat(),
    }
