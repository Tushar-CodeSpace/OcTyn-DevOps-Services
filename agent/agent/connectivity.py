"""Realtime connectivity target ICMP ping poller."""

import platform
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from typing import Optional, Tuple

from agent.config import SERVER_ID, connectivity_poll_interval, connectivity_targets, log
from agent.transport import push


def ping_host(ip: str, count: int = 2, timeout_sec: int = 6) -> Tuple[bool, Optional[float]]:
    """ICMP ping a host via the OS `ping` binary; returns (reachable, avg_latency_ms)."""
    ping_bin = shutil.which("ping")
    if not ping_bin:
        return False, None
    is_windows = platform.system().lower() == "windows"
    if is_windows:
        cmd = [ping_bin, "-n", str(count), "-w", "2000", ip]
    else:
        cmd = [ping_bin, "-c", str(count), "-W", "2", ip]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec)
        output = proc.stdout or ""
        ok = proc.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False, None

    latency = None
    if ok:
        if is_windows:
            m = re.search(r"Average\s*=\s*(\d+)", output, re.IGNORECASE)
        else:
            m = re.search(r"=\s*[\d.]+\s*/\s*([\d.]+)", output)
        if m:
            try:
                latency = round(float(m.group(1)), 1)
            except ValueError:
                latency = None
    return ok, latency


def push_connectivity() -> None:
    """Ping each configured target device and send report to central hub."""
    targets = connectivity_targets()
    if not targets:
        return
    results = []
    for t in targets:
        reachable, latency = ping_host(t["ip"])
        results.append(
            {
                "name": t["name"],
                "ip": t["ip"],
                "reachable": reachable,
                "latency_ms": latency,
                "checked_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    if results:
        push("/connectivity", {"server_id": SERVER_ID, "results": results})


def start_connectivity_poller() -> None:
    """Start background thread for checking device connectivity."""

    def _poll() -> None:
        while True:
            try:
                push_connectivity()
            except Exception as exc:
                log("connectivity poll error: %r" % (exc,))
            time.sleep(max(1, connectivity_poll_interval()))

    threading.Thread(target=_poll, name="connectivity-poller", daemon=True).start()
