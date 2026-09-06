#!/usr/bin/env python3
"""agent_lite.py - zero-dependency monitoring agent (Python 3.8+, Linux).

Single-file alternative to the Docker agent. Collects metrics from /proc
(no psutil) and pushes them to the central API with urllib (no httpx).
Run it on any monitored server with the system python3 - nothing to install.

Usage:
    python3 agent_lite.py          # loop
    python3 agent_lite.py --once   # single push (cron/timer)

Configure either by filling the CONFIG dict below, or via environment
variables (env vars win if both are set).
"""

import hashlib
import json
import os
import platform
import py_compile
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone

# ============================== CONFIGURATION ================================
# Fill in your server's values here and run the script directly - no env vars
# needed. Environment variables take precedence when they are set.
#
# Only SERVER_ID / API_URL / API_KEY are required. Every other knob below is a
# bootstrap default that is pulled from the central server (per-server Agent
# config) on boot and whenever it changes in the dashboard.
CONFIG = {
    # --- required (leave blank if using .env file or environment variables) ---
    "SERVER_ID": "",            # UUID shown in the dashboard / add-agent dialog
    "API_URL": "",              # e.g. https://your-domain.com/api/v1
    "API_KEY": "",              # per-agent key, starts with "cm-"
    # --- optional bootstrap defaults (overridden by the pulled agent config) ---
    "MONITORING_INTERVAL": 10,          # seconds between pushes
    "MONITORED_SERVICES": "",           # comma list name[:port], e.g. nginx:80,postgresql:5432
    "HTTP_TIMEOUT_SECONDS": 10,
    "HTTP_RETRY_COUNT": 3,

    # --- optional: site MongoDB config backup (needs pymongo on the host) ---
    "MONGO_CONFIG_ENABLED": False,       # requires pymongo
    "MONGO_URI": "",                     # e.g. mongodb://nido:nido%40123@localhost:27017
    "MONGO_AUTH_SOURCE": "admin",
}
# =============================================================================


def _load_env_file():
    """Load key=value lines from .env file into os.environ if not already set."""
    candidates = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
    ]
    for env_path in candidates:
        if os.path.isfile(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'\"")
                            if k and k not in os.environ:
                                os.environ[k] = v
                break
            except Exception:
                pass


_load_env_file()


def _cfg(key):
    """Value from the environment if set, else from the CONFIG dict above."""
    return os.environ.get(key) or str(CONFIG.get(key, ""))


INTERVAL = int(_cfg("MONITORING_INTERVAL") or 10)
TIMEOUT = int(_cfg("HTTP_TIMEOUT_SECONDS") or 10)
RETRIES = int(_cfg("HTTP_RETRY_COUNT") or 3)
SERVICES = [s.strip() for s in _cfg("MONITORED_SERVICES").split(",") if s.strip()]

SERVER_ID = _cfg("SERVER_ID")
API_URL = _cfg("API_URL").rstrip("/")
API_KEY = _cfg("API_KEY")

MONGO_CONFIG_ENABLED = _cfg("MONGO_CONFIG_ENABLED").lower() in {"1", "true", "yes", "on"}
MONGO_URI = _cfg("MONGO_URI")
MONGO_AUTH_SOURCE = _cfg("MONGO_AUTH_SOURCE") or "admin"

# Agent runtime config, dictated by the central server on every metrics beat.
_CONFIG = {
    "config_sync_enabled": True,
    "config_sync_hour": 0,
    "monitored_services": None,   # None -> fall back to SERVICES from local config
    "config_collections": None,   # None -> fall back to CONFIG_COLLECTION_MAP
}


_LAST_TRIGGER_SYNC_ID = None


def apply_agent_config(body):
    """Merge a config payload from the hub into the agent's live settings.

    Reassigns a fresh dict (copy-on-write) so a background config poller can
    update config while the main metrics loop reads it without locking.
    """
    global _CONFIG, _LAST_TRIGGER_SYNC_ID
    if not isinstance(body, dict):
        return
    merged = dict(_CONFIG)
    if isinstance(body.get("config_sync_enabled"), bool):
        merged["config_sync_enabled"] = body["config_sync_enabled"]
    if isinstance(body.get("config_sync_hour"), int) and 0 <= body["config_sync_hour"] <= 23:
        merged["config_sync_hour"] = body["config_sync_hour"]
    if isinstance(body.get("monitored_services"), list):
        merged["monitored_services"] = [
            s.strip() for s in body["monitored_services"] if isinstance(s, str) and s.strip()
        ]
    if isinstance(body.get("config_collections"), list):
        merged["config_collections"] = body["config_collections"]
    for key in _RUNTIME_FIELDS:
        if key in body:
            merged[key] = body[key]
    _CONFIG = merged

    trigger_id = body.get("trigger_sync_id")
    if trigger_id and str(trigger_id).strip() and trigger_id != _LAST_TRIGGER_SYNC_ID:
        _LAST_TRIGGER_SYNC_ID = trigger_id
        log("[TRIGGER] Hub requested immediate config backup (trigger_id=%s)" % trigger_id)
        threading.Thread(target=sync_configs, daemon=True).start()


_RUNTIME_FIELDS = (
    "monitoring_interval_seconds",
    "http_timeout_seconds",
    "http_retry_count",
    "config_poll_interval_seconds",
    "connectivity_poll_interval_seconds",
    "connectivity_targets",
    "mongo_config_enabled",
    "mongo_uri",
    "mongo_auth_source",
)


def _runtime_int(key, default):
    raw = _CONFIG.get(key)
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return default


def _runtime_bool(key, default):
    raw = _CONFIG.get(key)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.lower() in {"1", "true", "yes", "on"}
    return default


def _runtime_str(key, default):
    raw = _CONFIG.get(key)
    return str(raw).strip() if isinstance(raw, str) and raw.strip() else default


def monitoring_interval():
    return _runtime_int("monitoring_interval_seconds", INTERVAL)


def http_timeout():
    return _runtime_int("http_timeout_seconds", TIMEOUT)


def retry_count():
    raw = _CONFIG.get("http_retry_count")
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return RETRIES


def mongo_config_enabled():
    return _runtime_bool("mongo_config_enabled", MONGO_CONFIG_ENABLED)


def mongo_uri():
    return _runtime_str("mongo_uri", MONGO_URI)


def mongo_auth_source():
    return _runtime_str("mongo_auth_source", MONGO_AUTH_SOURCE)


def connectivity_poll_interval():
    return _runtime_int("connectivity_poll_interval_seconds", 15)


def connectivity_targets():
    raw = _CONFIG.get("connectivity_targets")
    if not isinstance(raw, list):
        return []
    out = []
    for t in raw:
        if isinstance(t, dict) and t.get("name") and t.get("ip"):
            out.append({"name": str(t["name"]), "ip": str(t["ip"])})
    return out


def ping_host(ip, count=2, timeout_sec=6):
    """ICMP ping a host via the OS ``ping`` binary; returns (reachable, avg ms)."""
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


def push_connectivity():
    """Ping each configured device and report results to the hub."""
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


def start_connectivity_poller():
    """Ping configured on-site devices on a realtime schedule."""

    def _poll():
        while True:
            try:
                push_connectivity()
            except Exception as exc:
                log("connectivity poll error: %r" % (exc,))
            time.sleep(max(1, connectivity_poll_interval()))

    threading.Thread(target=_poll, name="connectivity-poller", daemon=True).start()


def _kill_process_group(process):
    """SIGKILL the whole process group so child processes (e.g. ping) are reaped."""
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except Exception:
        try:
            process.kill()
        except Exception:
            pass
    try:
        process.wait()
    except Exception:
        pass


def _interrupt_process(process):
    """Send Ctrl+C (SIGINT) to the process group, then SIGKILL if it won't die."""
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGINT)
    except Exception:
        try:
            process.send_signal(signal.SIGINT)
        except Exception:
            pass
    try:
        process.wait(timeout=2)
    except Exception:
        _kill_process_group(process)


def _is_cancelled(command_id):
    """Ask the hub whether a command was cancelled (Ctrl+C requested)."""
    req = urllib.request.Request(
        "%s/terminal/commands/%s/status" % (API_URL, command_id),
        headers={"X-API-Key": API_KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=min(http_timeout(), 5)) as resp:
            if resp.status == 200:
                data = json.loads(resp.read(4000) or b"{}")
                return isinstance(data, dict) and data.get("status") == "cancelling"
    except Exception:
        pass
    return False


_TERMINAL_CWD = os.path.expanduser("~")


def poll_terminal_command():
    """Claim and execute one super-admin terminal command, if queued."""
    global _TERMINAL_CWD
    import selectors
    import tempfile
    from urllib.error import URLError
    from urllib.request import Request, urlopen

    req = Request(
        "%s/terminal/poll" % API_URL,
        headers={"X-API-Key": API_KEY},
    )
    try:
        with urlopen(req, timeout=min(http_timeout(), 5)) as resp:
            payload = json.loads(resp.read(5000) or b"{}")
    except (URLError, OSError, ValueError):
        return

    command = payload.get("command") if isinstance(payload, dict) else None
    if not isinstance(command, dict):
        return
    command_id = str(command.get("id", ""))
    text = str(command.get("command", ""))
    try:
        timeout = max(1, min(600, int(command.get("timeout_seconds", 300))))
    except (TypeError, ValueError):
        timeout = 30
    if not command_id or not text:
        return

    if not _TERMINAL_CWD or not os.path.isdir(_TERMINAL_CWD):
        _TERMINAL_CWD = os.path.expanduser("~")

    parts = text.strip().split()
    first_word = parts[0].lower() if parts else ""

    if first_word in ("nano", "vim", "vi", "micro", "emacs"):
        target_path = parts[1] if len(parts) > 1 else "untitled.txt"
        full_path = os.path.abspath(os.path.join(_TERMINAL_CWD, target_path)) if not os.path.isabs(target_path) else target_path
        
        file_content = ""
        if os.path.exists(full_path) and os.path.isfile(full_path):
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    file_content = f.read(500000)  # Max 500KB
            except Exception as exc:
                file_content = "# Error reading file: %s" % exc
        
        payload_data = json.dumps({"filepath": full_path, "content": file_content})
        push("/terminal/result", {
            "command_id": command_id,
            "output": "OCTYN_NANO_EDIT:%s\n" % payload_data,
            "exit_code": 0,
            "complete": True,
        })
        return

    if first_word in ("htop", "top", "less"):
        push("/terminal/result", {
            "command_id": command_id,
            "output": "Interactive tool '%s' requires full PTY session.\n" % first_word,
            "exit_code": 1,
            "complete": True,
        })
        return

    cwd_file = os.path.join(tempfile.gettempdir(), "term_cwd_%s.txt" % command_id)
    cmd_to_run = "%s\n__RET=$?\npwd > %s 2>/dev/null\nexit $__RET" % (text, cwd_file)

    process = None
    selector = None
    try:
        process = subprocess.Popen(
            cmd_to_run,
            cwd=_TERMINAL_CWD,
            shell=True,
            executable="/bin/bash",
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + timeout
        last_cancel_check = 0.0
        while process.poll() is None:
            now_mono = time.monotonic()
            if now_mono >= deadline:
                _kill_process_group(process)
                push("/terminal/result", {
                    "command_id": command_id,
                    "output": "\nCommand timed out.\n",
                    "exit_code": None,
                    "timed_out": True,
                    "complete": True,
                })
                if os.path.exists(cwd_file):
                    try:
                        os.remove(cwd_file)
                    except Exception:
                        pass
                return
            if now_mono - last_cancel_check >= 1.0:
                last_cancel_check = now_mono
                if _is_cancelled(command_id):
                    _interrupt_process(process)
                    push("/terminal/result", {
                        "command_id": command_id,
                        "output": "\nCommand interrupted (Ctrl+C).\n",
                        "exit_code": None,
                        "timed_out": False,
                        "cancelled": True,
                        "complete": True,
                    })
                    if os.path.exists(cwd_file):
                        try:
                            os.remove(cwd_file)
                        except Exception:
                            pass
                    return
            for key, _ in selector.select(timeout=0.25):
                chunk = key.fileobj.readline()
                if chunk:
                    push("/terminal/result", {
                        "command_id": command_id,
                        "output": chunk[-65536:],
                        "complete": False,
                    })
        remaining = process.stdout.read() or ""
        if remaining:
            push("/terminal/result", {
                "command_id": command_id,
                "output": remaining[-65536:],
                "complete": False,
            })

        if os.path.exists(cwd_file):
            try:
                with open(cwd_file, "r") as f:
                    new_cwd = f.read().strip()
                    if new_cwd and os.path.isdir(new_cwd):
                        _TERMINAL_CWD = new_cwd
                os.remove(cwd_file)
            except Exception:
                pass

        push("/terminal/result", {
            "command_id": command_id,
            "output": "",
            "exit_code": process.returncode,
            "timed_out": False,
            "complete": True,
        })
    except Exception as exc:
        if process is not None and process.poll() is None:
            _kill_process_group(process)
        push("/terminal/result", {
            "command_id": command_id,
            "output": "Command execution failed: %s\n" % exc,
            "exit_code": None,
            "timed_out": False,
            "complete": True,
        })
    finally:
        if selector is not None:
            selector.close()

def start_terminal_poller():
    """Poll for one queued terminal command at a time."""

    def _poll():
        while True:
            try:
                poll_terminal_command()
            except Exception as exc:
                log("terminal poll error: %r" % (exc,))
            time.sleep(1)

    threading.Thread(target=_poll, name="terminal-poller", daemon=True).start()

def fetch_agent_config():
    """GET the effective agent config from the hub (None on failure)."""
    retries = retry_count()
    timeout = http_timeout()
    req = urllib.request.Request(
        "%s/agent/config" % API_URL,
        headers={"X-API-Key": API_KEY},
    )
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    try:
                        return json.loads(resp.read(4000) or b"{}")
                    except Exception:
                        return {}
                return None
        except Exception:
            if attempt < retries:
                time.sleep(min(2 * attempt, 5))
    log("config fetch failed")
    return None


def start_config_poller():
    """Poll the hub for config changes in a background thread so the agent
    reflects dashboard changes immediately — no per-site redeploy needed."""

    def _poll():
        last = None
        while True:
            try:
                new_cfg = fetch_agent_config()
                if new_cfg and new_cfg != last:
                    last = new_cfg
                    apply_agent_config(new_cfg)
                    log("agent config updated from hub")
            except Exception as exc:
                log("config poll error: %r" % (exc,))
            time.sleep(max(1, _runtime_int("config_poll_interval_seconds", 5)))

    threading.Thread(target=_poll, name="config-poller", daemon=True).start()


def config_collections():
    raw = _CONFIG.get("config_collections")
    if not isinstance(raw, list):
        return dict(CONFIG_COLLECTION_MAP)
    out = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        database = str(item.get("database", "")).strip()
        collections = item.get("collections", [])
        if not database or not isinstance(collections, list):
            continue
        out[database] = [str(c).strip() for c in collections if str(c).strip()]
    return out or dict(CONFIG_COLLECTION_MAP)


def config_services():
    services = _CONFIG.get("monitored_services")
    if isinstance(services, list):
        return list(services)
    return SERVICES


def log(msg):
    sys.stderr.write("%s %s\n" % (datetime.now(timezone.utc).strftime("%H:%M:%S"), msg))
    sys.stderr.flush()


def _encode_uri_password(uri: str) -> str:
    """Safely URL-encode password in MongoDB connection URI if it contains special chars like '@'."""
    if not uri or "://" not in uri:
        return uri
    try:
        from pymongo.uri_parser import parse_uri
        parse_uri(uri)
        return uri  # URI is already valid and properly percent-encoded!
    except Exception:
        pass

    try:
        import urllib.parse
        prefix, rest = uri.split("://", 1)
        if "@" in rest:
            user_info, host_info = rest.rsplit("@", 1)
            if ":" in user_info:
                user, password = user_info.split(":", 1)
                encoded_pass = urllib.parse.quote(password, safe="")
                return f"{prefix}://{user}:{encoded_pass}@{host_info}"
    except Exception:
        pass
    return uri


def read_proc(path):
    with open(path) as f:
        return f.read()


# --- collectors (Linux /proc) -------------------------------------------------

_cpu_prev = None  # (total, idle) snapshot for delta computation


# --- optional: site MongoDB config backup (needs `pip3 install pymongo`) ---
try:
    from pymongo import MongoClient

    HAS_PYMONGO = True
except ImportError:
    MongoClient = None
    HAS_PYMONGO = False

CONFIG_COLLECTION_MAP: dict[str, list[str]] = {
    "analytic_service": ["analytic_config"],
    "data_uploader_service": ["integration_config"],
    "identity_service": [
        "UIControls",
        "client_setup",
        "features_code",
        "formcode_mappings",
        "monitoring_configurations",
        "notifiers",
        "pages_code",
        "products",
        "products_category",
        "roles",
        "users",
    ],
    "incoming_service": ["incoming_config"],
    "machine_configurations": ["machines"],
    "sorting_service": ["business_logic", "rejection_codes", "sorting_config"],
    "bagging": ["active_bags", "bagging_config", "ptl_users"],
    "calibration_service": ["calibration_boxes", "calibration_process", "calibration_results"],
    "cyclic_data_service": ["active_location_statuses", "alarms"],
    "notification_service": ["notifiers"],
}

MAX_DOCS_PER_SNAPSHOT = 50_000


def _jsonable(value):
    """Recursively convert BSON-only types into JSON-safe equivalents."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "binary"):
        return value.binary.hex()
    return str(value)


def _encode_uri_password(uri: str) -> str:
    """Percent-encode the password in a mongodb URI when needed."""
    try:
        parts = uri.split("://", 1)
        scheme, rest = parts[0], parts[1]
        if "@" not in rest:
            return uri
        userinfo, tail = rest.rsplit("@", 1)
        user, _, pwd = userinfo.partition(":")
        from urllib.parse import quote

        return f"{scheme}://{quote(user, safe='')}:{quote(pwd, safe='')}@{tail}"
    except Exception:
        return uri


def _proc_stat():
    """(total, idle) jiffies from the aggregate CPU line of /proc/stat."""
    parts = read_proc("/proc/stat").splitlines()[0].split()[1:]
    vals = [float(v) for v in parts]
    return sum(vals), vals[3] + (vals[4] if len(vals) > 4 else 0.0)


def cpu_percent():
    """CPU utilisation % from /proc/stat deltas."""
    global _cpu_prev
    if _cpu_prev is None:
        cpu_snapshot()
        time.sleep(0.5)  # brief window so the first delta is meaningful
    total, idle = _proc_stat()
    d_total, d_idle = total - _cpu_prev[0], idle - _cpu_prev[1]
    pct = 100.0 * (d_total - d_idle) / d_total if d_total > 0 else 0.0
    return round(min(max(pct, 0.0), 100.0), 2)


def cpu_snapshot():
    """Record the /proc/stat baseline used by the next cpu_percent() call."""
    global _cpu_prev
    _cpu_prev = _proc_stat()


def memory():
    info = {}
    for line in read_proc("/proc/meminfo").splitlines():
        k, v = line.split(":", 1)
        info[k] = float(v.split()[0]) * 1024.0  # kB -> bytes
    total = info["MemTotal"]
    avail = info.get("MemAvailable", info.get("MemFree", 0.0))
    return {
        "memory_percent": round(100.0 * (total - avail) / total, 2),
        "memory_total": total,
        "memory_available": avail,
    }


def disk(path="/"):
    st = os.statvfs(path)
    total = float(st.f_blocks * st.f_frsize)
    free = float(st.f_bavail * st.f_frsize)
    return {
        "disk_percent": round(100.0 * (total - free) / total, 2),
        "disk_total": total,
        "disk_free": free,
    }


def network():
    sent = recv = 0.0
    for line in read_proc("/proc/net/dev").splitlines()[2:]:
        iface, data = line.split(":", 1)
        if iface.strip() == "lo":
            continue
        fields = data.split()
        recv += float(fields[0])
        sent += float(fields[8])
    return {"network_bytes_sent": sent, "network_bytes_received": recv}


def uptime():
    try:
        return int(float(read_proc("/proc/uptime").split()[0]))
    except Exception:
        return 0


_io_prev = None  # (timestamp, read_bytes, write_bytes, reads_count, writes_count)


def disk_io():
    """Reads disk I/O metrics from /proc/diskstats (Linux) or returns defaults."""
    global _io_prev
    read_bytes = 0.0
    write_bytes = 0.0
    reads_cnt = 0.0
    writes_cnt = 0.0
    now_ts = time.time()

    if os.path.exists("/proc/diskstats"):
        try:
            with open("/proc/diskstats") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 14:
                        dev = parts[2]
                        if dev.startswith(("loop", "ram", "sr")):
                            continue
                        if dev.startswith(("sd", "vd", "xvd", "nvme", "mmcblk")):
                            r_completed = float(parts[3])
                            r_sectors = float(parts[5])
                            w_completed = float(parts[7])
                            w_sectors = float(parts[9])
                            reads_cnt += r_completed
                            writes_cnt += w_completed
                            read_bytes += r_sectors * 512.0
                            write_bytes += w_sectors * 512.0
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

    status_str = "normal"
    if r_rate > 50.0 or w_rate > 50.0:
        status_str = "heavy_io"

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


def primary_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # no packets sent; just picks a route
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


def port_open(port, timeout=2.0):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def collect_services():
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


def collect_metrics():
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
    cpu_snapshot()  # baseline for the next cycle
    return sample


# --- transport (urllib) -------------------------------------------------------

def push(path, payload):
    from urllib.error import URLError
    from urllib.request import Request, urlopen

    retries = retry_count()
    timeout = http_timeout()
    req = Request(
        "%s/%s" % (API_URL, path.lstrip("/")),
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
        method="POST",
    )
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            with urlopen(req, timeout=timeout) as resp:
                if resp.status in (200, 201):
                    return True
                last_err = "HTTP %s" % resp.status
        except (URLError, OSError) as exc:
            last_err = str(exc.reason) if isinstance(exc, URLError) else str(exc)
        except Exception as exc:  # unexpected but keep the agent alive
            last_err = str(exc)
        if attempt < retries:
            time.sleep(2 * attempt)
    log("push failed (%s): %s" % (path, last_err))
    return False


def _push_return(path, payload):
    """POST and return parsed JSON body (or None on failure)."""
    from urllib.error import URLError
    from urllib.request import Request, urlopen

    retries = retry_count()
    timeout = http_timeout()
    req = Request(
        "%s/%s" % (API_URL, path.lstrip("/")),
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
        method="POST",
    )
    for attempt in range(1, retries + 1):
        try:
            with urlopen(req, timeout=timeout) as resp:
                if resp.status in (200, 201):
                    try:
                        return json.loads(resp.read(1000) or b"{}")
                    except Exception:
                        return {}
                return None
        except (URLError, OSError) as exc:
            last_err = str(exc.reason) if isinstance(exc, URLError) else str(exc)
        except Exception as exc:  # unexpected but keep the agent alive
            last_err = str(exc)
        if attempt < retries:
            time.sleep(2 * attempt)
    log("push failed (%s): %s" % (path, last_err))
    return None


def cycle():
    m = collect_metrics()
    resp = _push_return("/metrics", m)
    ok = bool(resp is not None)
    if isinstance(resp, dict):
        apply_agent_config(resp)
    reports = collect_services()
    if reports:
        push("/services", reports)
    if ok:
        log("pushed cpu=%.1f%% mem=%.1f%% disk=%.1f%% services=%d"
            % (m["cpu_percent"], m["memory_percent"], m["disk_percent"], len(reports)))
    return ok


def sync_configs():
    """Snapshot mapped collections from the site MongoDB and push changes."""
    if not HAS_PYMONGO:
        log("config sync skipped: pymongo not installed (pip3 install pymongo)")
        return
    from pymongo import MongoClient

    uri = _encode_uri_password(mongo_uri())
    if not uri:
        return
    auth_source = mongo_auth_source()

    client = None
    connected = False
    # Attempt ping using configured authSource, then fallback to test/default
    for src in filter(None, [auth_source, "admin", "test"]):
        try:
            temp_client = MongoClient(uri, authSource=src, serverSelectionTimeoutMS=5000)
            temp_client[src].command("ping")
            client = temp_client
            connected = True
            break
        except Exception:
            try:
                temp_client.close()
            except Exception:
                pass

    if not connected or not client:
        try:
            client = MongoClient(uri, serverSelectionTimeoutMS=5000)
            client.admin.command("ping")
            connected = True
        except Exception as exc:
            log("config sync skipped: cannot reach site mongodb: %r" % (exc,))
            if client:
                client.close()
            return

    captured_at = datetime.now(timezone.utc).isoformat()
    db_names = set()
    try:
        db_names = set(client.list_database_names())
    except Exception:
        pass

    sent = skipped = missing = 0
    for database, collections in config_collections().items():
        if db_names and database not in db_names:
            missing += len(collections)
            continue
        try:
            coll_names = set(client[database].list_collection_names())
        except Exception:
            missing += len(collections)
            continue

        for name in collections:
            if name not in coll_names:
                missing += 1
                continue
            docs = [_jsonable(d) for d in client[database][name].find({}).limit(MAX_DOCS_PER_SNAPSHOT + 1)]
            truncated = len(docs) > MAX_DOCS_PER_SNAPSHOT
            docs = docs[:MAX_DOCS_PER_SNAPSHOT]
            payload_hash = hashlib.sha256(repr(sorted(docs, key=repr)).encode()).hexdigest()[:32]
            req = urllib.request.Request(
                "%s/configs/ingest" % API_URL,
                data=json.dumps({
                    "database": database,
                    "collection": name,
                    "captured_at": captured_at,
                    "count": len(docs),
                    "content_hash": payload_hash,
                    "documents": docs,
                    "truncated": truncated,
                }).encode(),
                headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=http_timeout()) as resp:
                    body = json.loads(resp.read(500) or b"{}")
                    if body.get("stored"):
                        sent += 1
                    else:
                        skipped += 1
            except Exception as exc:
                log("config upload %s.%s failed: %r" % (database, name, exc))
    client.close()
    log("config sync done: pushed=%d unchanged=%d missing=%d" % (sent, skipped, missing))


def check_and_apply_update():
    """Fetch release info from central hub. If checksum differs or force_update flag is set, auto-update self."""
    from urllib.request import Request, urlopen
    try:
        req = Request(
            "%s/agent/release" % API_URL,
            headers={"X-API-Key": API_KEY},
            method="GET",
        )
        with urlopen(req, timeout=http_timeout()) as resp:
            if resp.status in (200, 201):
                data = json.loads(resp.read().decode("utf-8"))
                remote_sha = data.get("sha256")
                download_path = data.get("download_lite_url", "/agent/download/lite")

                script_path = os.path.abspath(sys.argv[0])
                if not os.path.exists(script_path):
                    return
                with open(script_path, "rb") as f:
                    local_sha = hashlib.sha256(f.read()).hexdigest()[:12]

                force_upd = bool(_CONFIG.get("force_update", False))
                if force_upd or (remote_sha and remote_sha != local_sha):
                    log("[AUTO-UPDATE] Agent release mismatch (remote sha: %s, local sha: %s). Downloading update..." % (remote_sha, local_sha))
                    
                    if download_path.startswith(("http://", "https://")):
                        full_download_url = download_path
                    elif download_path.startswith("/api/v1/"):
                        rel_path = download_path[len("/api/v1/"):]
                        full_download_url = "%s/%s" % (API_URL, rel_path)
                    else:
                        full_download_url = "%s/%s" % (API_URL, download_path.lstrip("/"))

                    down_req = Request(
                        full_download_url,
                        headers={"X-API-Key": API_KEY},
                        method="GET",
                    )
                    tmp_path = script_path + ".tmp"
                    with urlopen(down_req, timeout=30) as down_resp:
                        if down_resp.status in (200, 201):
                            content = down_resp.read()
                            with open(tmp_path, "wb") as tf:
                                tf.write(content)
                            py_compile.compile(tmp_path, doraise=True)
                            os.replace(tmp_path, script_path)
                            log("[AUTO-UPDATE] Successfully updated agent. Exiting cleanly for systemd auto-restart.")
                            sys.exit(0)
    except SystemExit:
        raise
    except Exception as exc:
        log("[AUTO-UPDATE] Agent update check error: %r" % (exc,))


def main():
    if not (SERVER_ID and API_URL and API_KEY):
        sys.exit(
            "error: SERVER_ID, API_URL and API_KEY are not set - "
            "fill the CONFIG dict at the top of this file or export them as env vars"
        )
    log("lite agent starting host=%s server_id=%s api_url=%s"
        % (socket.gethostname(), SERVER_ID, API_URL))
    if "--once" in sys.argv:
        sys.exit(0 if cycle() else 1)
    if "--sync-configs" in sys.argv:
        sync_configs()
        sys.exit(0)

    start_config_poller()
    start_connectivity_poller()
    start_terminal_poller()

    # Config backup runs once daily at the centrally-configured hour
    # (default 12:00 AM local time of this host).
    last_config_sync_day = None
    update_check_counter = 0
    while True:
        try:
            cycle()
        except Exception as exc:  # never die mid-cycle
            log("cycle error: %r" % exc)

        # Check for updates every 6 cycles or when force_update flag is set
        update_check_counter += 1
        if update_check_counter >= 6 or bool(_CONFIG.get("force_update", False)):
            update_check_counter = 0
            check_and_apply_update()

        now_local = datetime.now()
        if (
            mongo_config_enabled()
            and bool(_CONFIG.get("config_sync_enabled", True))
            and HAS_PYMONGO
            and now_local.date() != last_config_sync_day
            and now_local.hour == int(_CONFIG.get("config_sync_hour", 0))
        ):
            try:
                sync_configs()
            except Exception as exc:
                log("config sync error: %r" % exc)
            last_config_sync_day = now_local.date()

        try:
            time.sleep(max(1, monitoring_interval()))
        except KeyboardInterrupt:
            break


if __name__ == "__main__":
    main()
