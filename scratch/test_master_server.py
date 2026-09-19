"""Test Master Server status, history, and retention cleanup endpoints."""
import sys
import os

# Add backend to path
sys.path.insert(0, r"d:\octyn_watcher\backend")

from app.routes.master_server import get_master_server_status, get_master_metrics_timeseries
from app.services.background import cleanup_expired_data, record_master_metrics_snapshot, get_master_metrics_history
from app.database import models as db

async def test_master_server():
    print("--- 1. Testing Master Server Status ---")
    status = await get_master_server_status(_={"_id": "test_admin", "role": "admin"})
    
    assert status.hostname != "", "Hostname is empty"
    assert status.platform_name != "", "Platform name is empty"
    assert status.cpu_percent >= 0.0, f"Invalid CPU percent: {status.cpu_percent}"
    assert status.memory_total > 0, f"Invalid memory total: {status.memory_total}"
    assert status.disk_total > 0, f"Invalid disk total: {status.disk_total}"
    assert status.process_pid > 0, f"Invalid process PID: {status.process_pid}"
    assert status.mongodb_status in ("healthy", "degraded"), f"Invalid mongodb status: {status.mongodb_status}"
    assert len(status.collections) > 0, "No MongoDB collections returned"
    
    print(f"Hostname:         {status.hostname}")
    print(f"Platform:         {status.platform_name} {status.platform_release} ({status.architecture})")
    print(f"CPU Load:         {status.cpu_percent}% ({status.cpu_count_logical} cores)")
    print(f"RAM Usage:        {status.memory_percent}% ({status.memory_used / (1024**2):.1f} MB used)")
    print(f"Root Disk:        {status.disk_percent}% ({status.disk_used / (1024**3):.1f} GB used)")
    print(f"Backend PID:      {status.process_pid} ({status.process_threads} threads)")
    print(f"MongoDB Ping:     {status.mongodb_ping_ms} ms (db: {status.database_name})")
    print(f"Collections:      {len(status.collections)} inspected")
    for col in status.collections[:5]:
        ttl_badge = f" [TTL: {col.ttl_info}]" if col.ttl_info else ""
        print(f"  - {col.name}: {col.document_count} docs, {col.storage_size_bytes / 1024:.1f} KB{ttl_badge}")
    print(f"Managed Fleet:    {status.fleet_total_servers} servers across {status.fleet_total_sites} sites")
    print("[PASS] Master server status endpoint returned valid telemetry!")

    print("\n--- 2. Testing Master Metrics History ---")
    record_master_metrics_snapshot()
    history = await get_master_metrics_timeseries(_={"_id": "test_admin", "role": "admin"})
    assert len(history) > 0, "Expected at least 1 history sample"
    latest_pt = history[-1]
    assert "cpu_percent" in latest_pt
    assert "memory_percent" in latest_pt
    assert "disk_percent" in latest_pt
    print(f"History points:   {len(history)} recorded")
    print(f"Latest sample:    CPU={latest_pt['cpu_percent']}%, RAM={latest_pt['memory_percent']}%, Disk={latest_pt['disk_percent']}%")
    print("[PASS] Master metrics history returned valid time-series data!")

    print("\n--- 3. Testing Retention Cleanup & Compaction ---")
    res = cleanup_expired_data()
    assert "retention_days" in res
    print(f"Retention limit:  {res['retention_days']} days")
    print(f"Pruned metrics:   {res['metrics']}")
    print(f"Pruned configs:   {res['site_configs']}")
    print(f"Pruned commands:  {res['terminal_commands']}")
    print(f"Pruned logs:      {res['agent_logs']}")
    print("[PASS] Retention cleanup executed successfully!")

if __name__ == "__main__":
    import asyncio
    asyncio.run(test_master_server())
