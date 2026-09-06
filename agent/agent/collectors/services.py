"""Service status monitoring collector."""

import socket
from typing import Any, Dict, List

from agent.config import SERVER_ID, config_services


def port_open(port: int, timeout: float = 2.0) -> bool:
    """Check if a TCP port is accepting connections on localhost."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def collect_services() -> List[Dict[str, Any]]:
    """Collect running/stopped service reports for all configured services."""
    reports = []
    for entry in config_services():
        name, _, p = entry.rpartition(":")
        port = int(p) if p.isdigit() and name else None
        if not name:
            name, port = entry, None
        reports.append({
            "server_id": SERVER_ID,
            "name": name,
            "status": "running" if (port is None or port_open(port)) else "stopped",
            "port": port,
        })
    return reports
