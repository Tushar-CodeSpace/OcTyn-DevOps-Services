"""System metrics collection (CPU, Memory, Disk, Network, Disk I/O, Uptime, Primary IP)."""

import os
import socket
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    psutil = None
    HAS_PSUTIL = False

from agent.config import SERVER_ID

_cpu_prev: Optional[Tuple[float, float]] = None
_io_prev: Optional[Tuple[float, float, float, float, float]] = None


def read_proc(path: str) -> str:
    with open(path) as f:
        return f.read()


def _proc_stat() -> Tuple[float, float]:
    parts = read_proc("/proc/stat").splitlines()[0].split()[1:]
    vals = [float(v) for v in parts]
    return sum(vals), vals[3] + (vals[4] if len(vals) > 4 else 0.0)


def cpu_snapshot() -> None:
    global _cpu_prev
    if HAS_PSUTIL:
        psutil.cpu_percent(interval=None)
    elif os.path.exists("/proc/stat"):
        _cpu_prev = _proc_stat()


def cpu_percent() -> float:
    global _cpu_prev
    if HAS_PSUTIL:
        return round(float(psutil.cpu_percent(interval=None)), 2)

    if os.path.exists("/proc/stat"):
        if _cpu_prev is None:
            cpu_snapshot()
            time.sleep(0.5)
        total, idle = _proc_stat()
        if _cpu_prev is None:
            return 0.0
        d_total, d_idle = total - _cpu_prev[0], idle - _cpu_prev[1]
        pct = 100.0 * (d_total - d_idle) / d_total if d_total > 0 else 0.0
        return round(min(max(pct, 0.0), 100.0), 2)

    return 0.0


def memory() -> Dict[str, float]:
    if HAS_PSUTIL:
        mem = psutil.virtual_memory()
        return {
            "memory_percent": round(float(mem.percent), 2),
            "memory_total": float(mem.total),
            "memory_available": float(mem.available),
        }

    if os.path.exists("/proc/meminfo"):
        info = {}
        for line in read_proc("/proc/meminfo").splitlines():
            k, v = line.split(":", 1)
            info[k] = float(v.split()[0]) * 1024.0
        total = info["MemTotal"]
        avail = info.get("MemAvailable", info.get("MemFree", 0.0))
        return {
            "memory_percent": round(100.0 * (total - avail) / total, 2),
            "memory_total": total,
            "memory_available": avail,
        }

    return {"memory_percent": 0.0, "memory_total": 0.0, "memory_available": 0.0}


def disk(path: str = "/") -> Dict[str, float]:
    if HAS_PSUTIL:
        try:
            d = psutil.disk_usage(path)
            return {
                "disk_percent": round(float(d.percent), 2),
                "disk_total": float(d.total),
                "disk_free": float(d.free),
            }
        except Exception:
            pass

    if hasattr(os, "statvfs"):
        try:
            st = os.statvfs(path)
            total = float(st.f_blocks * st.f_frsize)
            free = float(st.f_bavail * st.f_frsize)
            return {
                "disk_percent": round(100.0 * (total - free) / total, 2) if total > 0 else 0.0,
                "disk_total": total,
                "disk_free": free,
            }
        except Exception:
            pass

    return {"disk_percent": 0.0, "disk_total": 0.0, "disk_free": 0.0}


def network() -> Dict[str, float]:
    if HAS_PSUTIL:
        try:
            counters = psutil.net_io_counters()
            return {
                "network_bytes_sent": float(counters.bytes_sent),
                "network_bytes_received": float(counters.bytes_recv),
            }
        except Exception:
            pass

    if os.path.exists("/proc/net/dev"):
        sent = recv = 0.0
        for line in read_proc("/proc/net/dev").splitlines()[2:]:
            iface, data = line.split(":", 1)
            if iface.strip() == "lo":
                continue
            fields = data.split()
            recv += float(fields[0])
            sent += float(fields[8])
        return {"network_bytes_sent": sent, "network_bytes_received": recv}

    return {"network_bytes_sent": 0.0, "network_bytes_received": 0.0}


def uptime() -> int:
    if HAS_PSUTIL:
        try:
            return int(time.time() - psutil.boot_time())
        except Exception:
            pass

    if os.path.exists("/proc/uptime"):
        try:
            return int(float(read_proc("/proc/uptime").split()[0]))
        except Exception:
            pass

    return 0


def disk_io() -> Dict[str, Any]:
    global _io_prev
    read_bytes = 0.0
    write_bytes = 0.0
    reads_cnt = 0.0
    writes_cnt = 0.0
    now_ts = time.time()

    if HAS_PSUTIL:
        try:
            counters = psutil.disk_io_counters()
            if counters:
                read_bytes = float(counters.read_bytes)
                write_bytes = float(counters.write_bytes)
                reads_cnt = float(counters.read_count)
                writes_cnt = float(counters.write_count)
        except Exception:
            pass
    elif os.path.exists("/proc/diskstats"):
        try:
            with open("/proc/diskstats") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 14:
                        dev = parts[2]
                        if dev.startswith(("loop", "ram", "sr")):
                            continue
                        if dev.startswith(("sd", "vd", "xvd", "nvme", "mmcblk")):
                            reads_cnt += float(parts[3])
                            read_bytes += float(parts[5]) * 512.0
                            writes_cnt += float(parts[7])
                            write_bytes += float(parts[9]) * 512.0
        except Exception:
            pass

    r_rate = 0.0
    w_rate = 0.0
    iops = 0.0

    if _io_prev is not None:
        prev_ts, prev_r_b, prev_w_b, prev_r_c, prev_w_c = _io_prev
        dt = max(now_ts - prev_ts, 0.001)
        r_rate = round(max(read_bytes - prev_r_b, 0.0) / (1024.0 * 1024.0 * dt), 2)
        w_rate = round(max(write_bytes - prev_w_b, 0.0) / (1024.0 * 1024.0 * dt), 2)
        iops = round(max((reads_cnt - prev_r_c) + (writes_cnt - prev_w_c), 0.0) / dt, 1)

    _io_prev = (now_ts, read_bytes, write_bytes, reads_cnt, writes_cnt)

    status_str = "heavy_io" if (r_rate > 50.0 or w_rate > 50.0) else "normal"

    return {
        "disk_read_bytes": read_bytes,
        "disk_write_bytes": write_bytes,
        "disk_read_rate_mb": r_rate,
        "disk_write_rate_mb": w_rate,
        "disk_iops": iops,
        "io_status": {
            "status": status_str,
            "read_rate_mb": r_rate,
            "write_rate_mb": w_rate,
            "iops": iops,
            "read_bytes": read_bytes,
            "write_bytes": write_bytes,
        },
    }


def primary_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


def collect_metrics() -> Dict[str, Any]:
    sample = {
        "server_id": SERVER_ID,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hostname": socket.gethostname(),
        "ip_address": primary_ip(),
        "cpu_percent": cpu_percent(),
        "network_bytes_sent": 0.0,
        "network_bytes_received": 0.0,
        "uptime_seconds": uptime(),
    }
    sample.update(memory())
    sample.update(disk())
    sample.update(network())
    sample.update(disk_io())
    cpu_snapshot()
    return sample
