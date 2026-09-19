#!/usr/bin/env python3
from __future__ import annotations
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
_raw_api_url = _cfg("API_URL").rstrip("/")
if _raw_api_url and not _raw_api_url.endswith("/api/v1"):
    API_URL = _raw_api_url + "/api/v1"
else:
    API_URL = _raw_api_url
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
    "custom_widgets": [],         # user-defined periodic MongoDB count widgets
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
    if isinstance(body.get("custom_widgets"), list):
        merged["custom_widgets"] = body["custom_widgets"]
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
    return _runtime_str("mongo_uri", MONGO_URI or "mongodb://localhost:27017")


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


# --- custom data widgets: periodic MongoDB count aggregations (needs pymongo) ---
_WIDGET_LAST_RUN = {}


def custom_widgets():
    """Sanitized custom data-widget specs from hub config."""
    raw = _CONFIG.get("custom_widgets")
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        database = str(item.get("database", "")).strip()
        collection = str(item.get("collection", "")).strip()
        if not name or not database or not collection:
            continue
        try:
            poll = max(1, min(3600, int(item.get("poll_interval_seconds", 60))))
        except (TypeError, ValueError):
            poll = 60
        try:
            window = max(1, min(10080, int(item.get("window_minutes", 60))))
        except (TypeError, ValueError):
            window = 60
        try:
            max_groups = max(1, min(50, int(item.get("max_groups", 10))))
        except (TypeError, ValueError):
            max_groups = 10
        group_by = str(item.get("group_by_field", "upload_status")).strip() or "upload_status"
        time_field = str(item.get("time_field", "created_at")).strip() or "created_at"
        if group_by.startswith("$") or time_field.startswith("$"):
            continue
        enabled = item.get("enabled", True)
        if not isinstance(enabled, bool):
            enabled = str(enabled).lower() in {"1", "true", "yes", "on"}
        out.append({
            "name": name[:100],
            "database": database[:100],
            "collection": collection[:100],
            "enabled": enabled,
            "poll_interval_seconds": poll,
            "window_minutes": window,
            "group_by_field": group_by[:200],
            "time_field": time_field[:200],
            "max_groups": max_groups,
        })
    return out


def _widget_lookup(doc, dotted):
    cur = doc
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _widget_connect():
    """Connect to the site MongoDB (same fallbacks as config backup)."""
    raw_uri = mongo_uri()
    primary_uri = _encode_uri_password(raw_uri)
    if not primary_uri:
        return None
    uri_candidates = [primary_uri]
    if "localhost" in primary_uri:
        uri_candidates.append(primary_uri.replace("localhost", "127.0.0.1"))
        uri_candidates.append(primary_uri.replace("localhost", "host.docker.internal"))
        uri_candidates.append(primary_uri.replace("localhost", "172.17.0.1"))
    elif "127.0.0.1" in primary_uri:
        uri_candidates.append(primary_uri.replace("127.0.0.1", "localhost"))
        uri_candidates.append(primary_uri.replace("127.0.0.1", "host.docker.internal"))
        uri_candidates.append(primary_uri.replace("127.0.0.1", "172.17.0.1"))
    auth_candidates = _extract_auth_sources(raw_uri, mongo_auth_source())
    creds = _parse_mongo_credentials(raw_uri)

    def _try(client_factory):
        try:
            c = client_factory()
            c.admin.command("ping")
            return c
        except Exception:
            return None

    for target_uri in uri_candidates:
        for dc in (True, False):
            client = _try(lambda: MongoClient(target_uri, serverSelectionTimeoutMS=4000, directConnection=dc))
            if client is not None:
                return client
        for src in auth_candidates:
            for dc in (True, False):
                client = _try(lambda: MongoClient(target_uri, authSource=src, serverSelectionTimeoutMS=4000, directConnection=dc))
                if client is not None:
                    return client
        if creds:
            host_candidates = [creds["host_uri"]]
            if "localhost" in creds["host_uri"]:
                host_candidates.append(creds["host_uri"].replace("localhost", "127.0.0.1"))
                host_candidates.append(creds["host_uri"].replace("localhost", "host.docker.internal"))
                host_candidates.append(creds["host_uri"].replace("localhost", "172.17.0.1"))
            elif "127.0.0.1" in creds["host_uri"]:
                host_candidates.append(creds["host_uri"].replace("127.0.0.1", "localhost"))
                host_candidates.append(creds["host_uri"].replace("127.0.0.1", "host.docker.internal"))
                host_candidates.append(creds["host_uri"].replace("127.0.0.1", "172.17.0.1"))
            pass_candidates = []
            if creds["password"]:
                pass_candidates.append(creds["password"])
            if creds["raw_password"] and creds["raw_password"] != creds["password"]:
                pass_candidates.append(creds["raw_password"])
            for h_uri in host_candidates:
                for p_val in pass_candidates:
                    for src in auth_candidates:
                        for dc in (True, False):
                            client = _try(lambda: MongoClient(h_uri, username=creds["username"], password=p_val, authSource=src, serverSelectionTimeoutMS=4000, directConnection=dc))
                            if client is not None:
                                return client
    return None


def _widget_cutoff(coll, time_field, cutoff):
    """Match the stored type of the time field (datetime vs ISO string)."""
    try:
        sample = coll.find_one({time_field: {"$exists": True}}, projection={time_field: 1}, sort=[("_id", -1)])
    except Exception:
        return cutoff
    val = _widget_lookup(sample, time_field) if sample else None
    if isinstance(val, str):
        try:
            return cutoff.replace(tzinfo=None).isoformat()
        except Exception:
            return cutoff
    return cutoff


def _widget_payload(widget, collected_at, window, total, groups, error=None):
    return {
        "server_id": SERVER_ID,
        "widget_name": widget["name"],
        "database": widget["database"],
        "collection": widget["collection"],
        "window_minutes": window,
        "total": max(0, int(total)),
        "groups": {str(k)[:100]: max(0, int(v)) for k, v in groups.items()},
        "collected_at": collected_at.isoformat(),
        "error": (error or "")[:500] or None,
    }


def _coerce_val_candidates_lite(vals):
    candidates = []
    for v in vals:
        s = str(v).strip()
        if not s:
            continue
        candidates.append(s)
        try:
            if s.isdigit():
                candidates.append(int(s))
            else:
                candidates.append(float(s))
        except ValueError:
            pass
        if s.lower() == "true":
            candidates.append(True)
        elif s.lower() == "false":
            candidates.append(False)
        elif s.lower() in ("null", "none"):
            candidates.append(None)
    out = []
    for c in candidates:
        if c not in out:
            out.append(c)
    return out


def _parse_field_conditions(entries, default_field):
    """Parse include/exclude entries into mapping of field -> list of values.
    Supports plain values ('SKIPPED'), 'field: value' ('rejection_data.display_rejection: PSTR'),
    'where field: value', 'field = value', and bracketed lists 'field: [A, B]'.
    """
    res = {}
    for item in entries:
        if not item:
            continue
        s = str(item).strip()
        if not s:
            continue
        if s.lower().startswith("where "):
            s = s[6:].strip()
        field = default_field
        val_str = s
        if ":" in s:
            parts = s.split(":", 1)
            field = parts[0].strip()
            val_str = parts[1].strip()
        elif "=" in s:
            parts = s.split("=", 1)
            field = parts[0].strip()
            val_str = parts[1].strip()
        if not field:
            field = default_field

        vals = []
        if val_str.startswith("[") and val_str.endswith("]"):
            inner = val_str[1:-1]
            vals = [x.strip().strip("'\"") for x in inner.split(",") if x.strip()]
        else:
            cleaned = val_str.strip("'\"")
            if cleaned:
                vals = [cleaned]
        if field not in res:
            res[field] = []
        for v in vals:
            if v not in res[field]:
                res[field].append(v)
    return res


def collect_widget(client, widget):
    """Run one widget aggregation; always returns a hub-ready payload."""
    from datetime import timedelta
    database = widget["database"]
    collection = widget["collection"]
    window = widget["window_minutes"]
    group_by = widget["group_by_field"]
    time_field = widget["time_field"]
    max_groups = widget["max_groups"]
    include_vals = widget.get("include_values") or []
    exclude_vals = widget.get("exclude_values") or []
    collected_at = datetime.now(timezone.utc)
    cutoff = collected_at - timedelta(minutes=window)
    try:
        if database not in client.list_database_names():
            return _widget_payload(widget, collected_at, window, 0, {}, error="database '%s' not found" % database)
        coll = client[database][collection]
        try:
            if collection not in coll.database.list_collection_names():
                return _widget_payload(widget, collected_at, window, 0, {}, error="collection '%s.%s' not found" % (database, collection))
        except Exception:
            pass
        match = {time_field: {"$gte": _widget_cutoff(coll, time_field, cutoff)}}
        inc_by_field = _parse_field_conditions(include_vals, group_by)
        exc_by_field = _parse_field_conditions(exclude_vals, group_by)

        all_filter_fields = set(inc_by_field.keys()) | set(exc_by_field.keys())
        for f in all_filter_fields:
            f_filter = {}
            if f in inc_by_field:
                inc_c = _coerce_val_candidates_lite(inc_by_field[f])
                if inc_c:
                    f_filter["$in"] = inc_c
            if f in exc_by_field:
                exc_c = _coerce_val_candidates_lite(exc_by_field[f])
                if exc_c:
                    f_filter["$nin"] = exc_c
            if f_filter:
                if f in match and isinstance(match[f], dict):
                    match[f].update(f_filter)
                else:
                    match[f] = f_filter

        try:
            total = coll.count_documents(match, maxTimeMS=20000)
        except Exception as exc:
            return _widget_payload(widget, collected_at, window, 0, {}, error="count failed: %s" % exc)
        groups = {}
        try:
            pipeline = [
                {"$match": match},
                {"$group": {"_id": "$" + group_by, "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},
                {"$limit": max(1, max_groups)},
            ]
            for row in coll.aggregate(pipeline, maxTimeMS=20000):
                key = row.get("_id")
                label = "UNKNOWN" if key is None else str(key)[:100]
                try:
                    groups[label] = int(row.get("count", 0))
                except (TypeError, ValueError):
                    continue
        except Exception as exc:
            return _widget_payload(widget, collected_at, window, 0, {}, error="group-by failed: %s" % exc)

        # Post-filter groups for group_by field conditions if specified
        if group_by in inc_by_field:
            inc_set = {str(x).strip().lower() for x in inc_by_field[group_by] if str(x).strip()}
            groups = {k: v for k, v in groups.items() if str(k).strip().lower() in inc_set}
        if group_by in exc_by_field:
            exc_set = {str(x).strip().lower() for x in exc_by_field[group_by] if str(x).strip()}
            groups = {k: v for k, v in groups.items() if str(k).strip().lower() not in exc_set}
        if total < sum(groups.values()):
            total = sum(groups.values())

        return _widget_payload(widget, collected_at, window, total, groups)
    except Exception as exc:
        return _widget_payload(widget, collected_at, window, 0, {}, error=str(exc)[:300])


def push_widgets():
    """Collect and push every due (interval-elapsed) enabled widget."""
    widgets = [w for w in custom_widgets() if w.get("enabled", True)]
    if not widgets:
        return
    if not mongo_config_enabled():
        log("[WIDGETS] Skipped: site MongoDB access is disabled in agent config")
        return
    if not HAS_PYMONGO:
        if not _ensure_pymongo():
            log("[WIDGETS] Skipped: pymongo not installed (run: sudo apt install -y python3-pymongo)")
            return
    now_mono = time.monotonic()
    due = [w for w in widgets if now_mono - _WIDGET_LAST_RUN.get(w["name"], 0.0) >= w["poll_interval_seconds"]]
    if not due:
        return
    try:
        client = _widget_connect()
    except Exception as exc:
        log("[WIDGETS] Connect error: %r" % (exc,))
        return
    if client is None:
        log("[WIDGETS] FAILED: cannot reach site MongoDB at %s" % _sanitize_uri(mongo_uri()))
        return
    try:
        for w in due:
            try:
                payload = collect_widget(client, w)
                if push("/widgets", payload):
                    _WIDGET_LAST_RUN[w["name"]] = time.monotonic()
                    if payload.get("error"):
                        log("[WIDGETS] '%s': reported error: %s" % (w["name"], payload["error"]))
                    else:
                        log("[WIDGETS] '%s': total=%d groups=%s" % (w["name"], payload["total"], payload["groups"]))
                else:
                    log("[WIDGETS] '%s': push failed, will retry next tick" % w["name"])
            except Exception as exc:
                log("[WIDGETS] '%s' error: %r" % (w.get("name", "?"), exc))
    finally:
        try:
            client.close()
        except Exception:
            pass


def start_widget_poller():
    """Tick due custom-widget collections in the background."""

    def _poll():
        while True:
            try:
                push_widgets()
            except Exception as exc:
                log("[WIDGETS] poll error: %r" % (exc,))
            time.sleep(10)

    threading.Thread(target=_poll, name="widget-poller", daemon=True).start()


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


_ACTIVE_DEPLOYMENT = None


def _stream_deployment_log(deployment_id, stage, line, level="info"):
    try:
        req = urllib.request.Request(
            "%s/deployments/%s/stream" % (API_URL, deployment_id),
            data=json.dumps({"stage": stage, "line": str(line).strip(), "level": level}).encode(),
            headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            pass
    except Exception:
        pass


def _finish_deployment(deployment_id, status, exit_code, duration_seconds, error_summary=None):
    try:
        req = urllib.request.Request(
            "%s/deployments/%s/finish" % (API_URL, deployment_id),
            data=json.dumps({
                "status": status,
                "exit_code": exit_code,
                "duration_seconds": round(duration_seconds, 2),
                "error_summary": error_summary,
            }).encode(),
            headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            pass
    except Exception as exc:
        log("[DEPLOY] Error reporting finish status: %r" % (exc,))


def _run_deployment_command(cmd, cwd, deployment_id, stage, env=None):
    _stream_deployment_log(deployment_id, stage, "$ %s (cwd: %s)" % (cmd, cwd or os.getcwd()), level="info")
    full_env = os.environ.copy()
    if env:
        full_env.update(env)
    try:
        process = subprocess.Popen(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=cwd,
            env=full_env,
        )
        for raw_line in process.stdout:
            line = raw_line.rstrip()
            if line:
                level = "error" if "error" in line.lower() or "fatal" in line.lower() else "info"
                _stream_deployment_log(deployment_id, stage, line, level=level)
        process.wait()
        rc = process.returncode
        if rc == 0:
            _stream_deployment_log(deployment_id, stage, "Command completed successfully (code 0)", level="success")
        else:
            _stream_deployment_log(deployment_id, stage, "Command failed with exit code %d" % rc, level="error")
        return rc
    except Exception as exc:
        _stream_deployment_log(deployment_id, stage, "Command execution exception: %s" % exc, level="error")
        return 1


def _execute_deployment(job):
    global _ACTIVE_DEPLOYMENT
    deployment_id = job.get("deployment_id", "")
    _ACTIVE_DEPLOYMENT = deployment_id
    start_time = time.time()

    sw_name = job.get("software_name", "Software")
    components = job.get("components", [])
    config_repo = job.get("config_repo")
    branches = job.get("branches", {})
    client_name = job.get("client_name", "")
    machine_type = job.get("machine_type", "")

    log("[DEPLOY] Starting deployment for '%s' (ID: %s)" % (sw_name, deployment_id))
    _stream_deployment_log(deployment_id, "INIT", "=== Starting Deployment: %s ===" % sw_name, level="info")
    _stream_deployment_log(deployment_id, "INIT", "Target client: '%s' | Machine: '%s'" % (client_name, machine_type), level="info")

    try:
        # Stage 1: Environment & Dependency Pre-Checks
        _stream_deployment_log(deployment_id, "PRECHECK", "Checking system tools and runtime environments...", level="info")

        if not shutil.which("git"):
            _stream_deployment_log(deployment_id, "PRECHECK", "git is missing! Attempting installation...", level="warn")
            if shutil.which("apt-get"):
                _run_deployment_command("sudo apt-get update -qq && sudo apt-get install -y git", None, deployment_id, "PRECHECK")

        needs_node = any(c.get("type") == "nodejs_monorepo" for c in components)
        if needs_node:
            _stream_deployment_log(deployment_id, "PRECHECK", "Checking Node.js v24 and PM2...", level="info")
            node_ver_cmd = "node -v"
            rc = subprocess.run(node_ver_cmd, shell=True, capture_output=True, text=True)
            cur_ver = rc.stdout.strip()
            _stream_deployment_log(deployment_id, "PRECHECK", "Current Node.js version: %s" % (cur_ver or "None"), level="info")

            if not cur_ver.startswith("v24"):
                _stream_deployment_log(deployment_id, "PRECHECK", "Node.js v24 required. Attempting installation via NodeSource...", level="warn")
                setup_node = "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs"
                _run_deployment_command(setup_node, None, deployment_id, "PRECHECK")

            if not shutil.which("pm2"):
                _stream_deployment_log(deployment_id, "PRECHECK", "PM2 not found globally. Installing PM2...", level="warn")
                _run_deployment_command("sudo npm install -g pm2", None, deployment_id, "PRECHECK")

        needs_php = any(c.get("type") == "php_nginx" for c in components)
        if needs_php:
            _stream_deployment_log(deployment_id, "PRECHECK", "Checking PHP and Nginx...", level="info")
            if not shutil.which("nginx"):
                _stream_deployment_log(deployment_id, "PRECHECK", "nginx missing. Installing nginx...", level="warn")
                _run_deployment_command("sudo apt-get update -qq && sudo apt-get install -y nginx", None, deployment_id, "PRECHECK")
            if not shutil.which("php"):
                _stream_deployment_log(deployment_id, "PRECHECK", "php missing. Installing php-fpm...", level="warn")
                _run_deployment_command("sudo apt-get install -y php-fpm php-cli composer", None, deployment_id, "PRECHECK")

        # Stage 2: Git Repository Cloning & Updating
        for c in components:
            c_name = c.get("name", "Component")
            repo_url = c.get("repo_url", "")
            target_dir = c.get("target_dir", "/opt/%s/%s" % (sw_name, c_name.lower().replace(" ", "_")))
            branch = branches.get(c_name) or c.get("default_branch", "main")

            _stream_deployment_log(deployment_id, "GIT", "Syncing repository for '%s' -> %s (branch: %s)" % (c_name, target_dir, branch), level="info")

            parent_dir = os.path.dirname(target_dir)
            os.makedirs(parent_dir, exist_ok=True)

            if os.path.exists(os.path.join(target_dir, ".git")):
                _stream_deployment_log(deployment_id, "GIT", "Existing Git repository found in %s. Pulling latest..." % target_dir, level="info")
                git_pull = "git fetch origin && git checkout %s && git pull origin %s" % (branch, branch)
                rc = _run_deployment_command(git_pull, target_dir, deployment_id, "GIT")
                if rc != 0:
                    raise RuntimeError("Git pull failed for '%s'" % c_name)
            else:
                _stream_deployment_log(deployment_id, "GIT", "Cloning %s into %s..." % (repo_url, target_dir), level="info")
                git_clone = "git clone --branch %s %s %s" % (branch, repo_url, target_dir)
                rc = _run_deployment_command(git_clone, None, deployment_id, "GIT")
                if rc != 0:
                    raise RuntimeError("Git clone failed for '%s'" % c_name)

        # Stage 3: Client & Machine-Specific Config Import
        if config_repo and config_repo.get("repo_url"):
            cfg_target = config_repo.get("target_dir", "/opt/%s/configs" % sw_name)
            cfg_branch = branches.get("Config") or config_repo.get("default_branch", "main")
            _stream_deployment_log(deployment_id, "CONFIG", "Syncing configs repo -> %s (branch: %s)" % (cfg_target, cfg_branch), level="info")

            os.makedirs(os.path.dirname(cfg_target), exist_ok=True)
            if os.path.exists(os.path.join(cfg_target, ".git")):
                _run_deployment_command("git fetch origin && git checkout %s && git pull origin %s" % (cfg_branch, cfg_branch), cfg_target, deployment_id, "CONFIG")
            else:
                _run_deployment_command("git clone --branch %s %s %s" % (cfg_branch, config_repo["repo_url"], cfg_target), None, deployment_id, "CONFIG")

            import_script = config_repo.get("import_script", "")
            if import_script:
                formatted_script = import_script.replace("{client}", client_name).replace("{machine_type}", machine_type)
                _stream_deployment_log(deployment_id, "CONFIG", "Applying machine configs: %s" % formatted_script, level="info")
                rc = _run_deployment_command(formatted_script, cfg_target, deployment_id, "CONFIG")
                if rc != 0:
                    _stream_deployment_log(deployment_id, "CONFIG", "Warning: Config import script returned non-zero code", level="warn")

        # Stage 4: Component Builds & Service Execution
        for c in components:
            c_name = c.get("name", "Component")
            target_dir = c.get("target_dir")
            build_cmd = c.get("build_command")
            start_cmd = c.get("start_command")
            env_vars = c.get("env_vars", {})

            if build_cmd:
                _stream_deployment_log(deployment_id, "BUILD", "Running build for '%s'..." % c_name, level="info")
                rc = _run_deployment_command(build_cmd, target_dir, deployment_id, "BUILD", env=env_vars)
                if rc != 0:
                    raise RuntimeError("Build command failed for '%s'" % c_name)

            if start_cmd:
                _stream_deployment_log(deployment_id, "START", "Starting/Reloading service for '%s'..." % c_name, level="info")
                rc = _run_deployment_command(start_cmd, target_dir, deployment_id, "START", env=env_vars)
                if rc != 0:
                    raise RuntimeError("Service start/reload failed for '%s'" % c_name)

        duration = time.time() - start_time
        _stream_deployment_log(deployment_id, "VERIFY", "=== Deployment Successful in %.1fs ===" % duration, level="success")
        _finish_deployment(deployment_id, "success", 0, duration)
        log("[DEPLOY] Deployment '%s' SUCCESS (%.1fs)" % (deployment_id, duration))

    except Exception as exc:
        duration = time.time() - start_time
        err_msg = str(exc)
        log("[DEPLOY] Deployment '%s' FAILED: %s" % (deployment_id, err_msg))
        _stream_deployment_log(deployment_id, "ERROR", "=== Deployment Failed: %s ===" % err_msg, level="error")
        _finish_deployment(deployment_id, "failed", 1, duration, error_summary=err_msg)

    finally:
        _ACTIVE_DEPLOYMENT = None


def poll_deployment_job():
    global _ACTIVE_DEPLOYMENT
    if _ACTIVE_DEPLOYMENT:
        return

    req = urllib.request.Request(
        "%s/deployments/poll" % API_URL,
        headers={"X-API-Key": API_KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=min(http_timeout(), 6)) as resp:
            data = json.loads(resp.read(50000) or b"{}")
    except (urllib.error.URLError, OSError, ValueError):
        return

    job = data.get("job")
    if job and isinstance(job, dict):
        t = threading.Thread(
            target=_execute_deployment,
            args=(job,),
            name="deploy-%s" % job.get("deployment_id", "job"),
            daemon=True,
        )
        t.start()


def start_deployment_poller():
    def _poll():
        while True:
            try:
                poll_deployment_job()
            except Exception as exc:
                log("[DEPLOY] Poller exception: %r" % (exc,))
            time.sleep(5)

    threading.Thread(target=_poll, name="deploy-poller", daemon=True).start()


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


_PENDING_LOGS = []
_LOG_LOCK = threading.Lock()


def log(msg, level="info"):
    sys.stderr.write("%s %s\n" % (datetime.now(timezone.utc).strftime("%H:%M:%S"), msg))
    sys.stderr.flush()
    msg_str = str(msg)
    if level == "info":
        upper = msg_str.upper()
        if any(term in upper for term in ("ERROR", "FAIL", "CRITICAL", "EXCEPTION")):
            level = "error"
        elif any(term in upper for term in ("WARN", "RETRY", "TIMEOUT")):
            level = "warning"
    try:
        with _LOG_LOCK:
            if len(_PENDING_LOGS) >= 500:
                _PENDING_LOGS.pop(0)
            _PENDING_LOGS.append({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": level,
                "message": msg_str,
                "source": "agent",
            })
    except Exception:
        pass


def _encode_uri_password(uri: str) -> str:
    """Safely percent-encode username and password in MongoDB URI if they contain unescaped characters like '@'."""
    if not uri or "://" not in uri:
        return uri
    try:
        import urllib.parse
        prefix, rest = uri.split("://", 1)
        if "@" in rest:
            userinfo, host_and_options = rest.rsplit("@", 1)
            if ":" in userinfo:
                user, password = userinfo.split(":", 1)
                clean_user = urllib.parse.unquote(user)
                clean_pass = urllib.parse.unquote(password)
                enc_user = urllib.parse.quote(clean_user, safe="")
                enc_pass = urllib.parse.quote(clean_pass, safe="")
                return f"{prefix}://{enc_user}:{enc_pass}@{host_and_options}"
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


def _ensure_pymongo():
    """Attempt on-the-fly installation of python3-pymongo if missing."""
    global HAS_PYMONGO, MongoClient
    if HAS_PYMONGO:
        return True
    try:
        from pymongo import MongoClient as _MC
        MongoClient = _MC
        HAS_PYMONGO = True
        return True
    except ImportError:
        pass

    log("[PYMONGO] pymongo missing. Attempting automatic installation of python3-pymongo...")
    if shutil.which("apt-get"):
        try:
            subprocess.run(["apt-get", "update", "-qq"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45)
            res = subprocess.run(
                ["apt-get", "install", "-y", "--no-install-recommends", "python3-pymongo"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                timeout=120,
            )
            if res.returncode == 0:
                from pymongo import MongoClient as _MC
                MongoClient = _MC
                HAS_PYMONGO = True
                log("[PYMONGO] Successfully auto-installed python3-pymongo via apt.")
                return True
        except Exception:
            pass

    for pip_args in [["--break-system-packages"], []]:
        try:
            cmd = [sys.executable, "-m", "pip", "install", "pymongo"] + pip_args
            res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=120)
            if res.returncode == 0:
                from pymongo import MongoClient as _MC
                MongoClient = _MC
                HAS_PYMONGO = True
                log("[PYMONGO] Successfully auto-installed pymongo via pip.")
                return True
        except Exception:
            pass

    return False


CONFIG_COLLECTION_MAP = {
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
    logs_to_send = []
    try:
        with _LOG_LOCK:
            logs_to_send = list(_PENDING_LOGS)
            _PENDING_LOGS.clear()
    except Exception:
        pass
    if logs_to_send:
        sample["logs"] = logs_to_send
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


def _sanitize_uri(uri):
    """Mask password in MongoDB URI string for safe logging."""
    if not uri or "://" not in uri:
        return uri
    try:
        prefix, rest = uri.split("://", 1)
        if "@" in rest:
            userinfo, host = rest.rsplit("@", 1)
            if ":" in userinfo:
                user, _ = userinfo.split(":", 1)
                return "%s://%s:*****@%s" % (prefix, user, host)
    except Exception:
        pass
    return uri


def _extract_auth_sources(raw_uri, configured_auth):
    """Build prioritized list of potential authentication databases to try."""
    sources = []
    if configured_auth:
        sources.append(str(configured_auth).strip())
    try:
        import urllib.parse
        parsed = urllib.parse.urlparse(raw_uri)
        if parsed.path and parsed.path.strip("/"):
            sources.append(parsed.path.strip("/").split("/")[0])
        qp = urllib.parse.parse_qs(parsed.query)
        if "authSource" in qp:
            sources.extend(qp["authSource"])
    except Exception:
        pass

    try:
        cmap = config_collections()
        if isinstance(cmap, dict):
            sources.extend(list(cmap.keys()))
    except Exception:
        pass

    sources.extend(["admin", "identity_service", "auth_api", "Master", "bagging", "sorting_service", "test"])
    seen = set()
    out = []
    for s in sources:
        sc = str(s).strip()
        if sc and sc not in seen:
            seen.add(sc)
            out.append(sc)
    return out


def _parse_mongo_credentials(uri):
    """Extract host_uri, username, and unquoted/raw passwords from URI."""
    if not uri or "://" not in uri:
        return None
    try:
        import urllib.parse
        prefix, rest = uri.split("://", 1)
        if "@" in rest:
            userinfo, host_part = rest.rsplit("@", 1)
            if ":" in userinfo:
                user, password = userinfo.split(":", 1)
                clean_user = urllib.parse.unquote(user)
                clean_pass = urllib.parse.unquote(password)
                host_clean = host_part.split("/")[0] if "/" in host_part else host_part
                return {
                    "username": clean_user,
                    "password": clean_pass,
                    "raw_password": password,
                    "host_uri": "%s://%s" % (prefix, host_clean),
                }
    except Exception:
        pass
    return None


def sync_configs():
    """Snapshot mapped collections from the site MongoDB and push changes."""
    if not HAS_PYMONGO:
        if not _ensure_pymongo():
            log("[CONFIG-SYNC] Skipped: pymongo not installed (run: sudo apt install -y python3-pymongo)")
            return
    from pymongo import MongoClient

    log("[CONFIG-SYNC] Backup trigger initiated. Pulling live config from central hub...")
    try:
        hub_cfg = fetch_agent_config()
        if hub_cfg:
            apply_agent_config(hub_cfg)
            log("[CONFIG-SYNC] Latest hub config applied successfully.")
    except Exception as exc:
        log("[CONFIG-SYNC] Hub config fetch warning: %r" % (exc,))

    raw_uri = mongo_uri()
    auth_source = mongo_auth_source()
    log("[CONFIG-SYNC] Effective settings -> mongo_uri=%s auth_source=%s" % (_sanitize_uri(raw_uri), auth_source))

    primary_uri = _encode_uri_password(raw_uri)
    if not primary_uri:
        log("[CONFIG-SYNC] Skipped: mongo_uri is empty")
        return

    uri_candidates = [primary_uri]
    if "localhost" in primary_uri:
        uri_candidates.append(primary_uri.replace("localhost", "127.0.0.1"))
        uri_candidates.append(primary_uri.replace("localhost", "host.docker.internal"))
        uri_candidates.append(primary_uri.replace("localhost", "172.17.0.1"))
    elif "127.0.0.1" in primary_uri:
        uri_candidates.append(primary_uri.replace("127.0.0.1", "localhost"))
        uri_candidates.append(primary_uri.replace("127.0.0.1", "host.docker.internal"))
        uri_candidates.append(primary_uri.replace("127.0.0.1", "172.17.0.1"))

    auth_candidates = _extract_auth_sources(raw_uri, auth_source)
    creds = _parse_mongo_credentials(raw_uri)

    client = None
    connected = False
    last_err = None

    for target_uri in uri_candidates:
        if connected:
            break

        log("[CONFIG-SYNC] Connecting to MongoDB at %s..." % _sanitize_uri(target_uri))

        # 1. Try native URI ping first (with and without directConnection)
        for dc_val in (True, False):
            temp_client = None
            try:
                temp_client = MongoClient(target_uri, serverSelectionTimeoutMS=4000, directConnection=dc_val)
                temp_client.admin.command("ping")
                client = temp_client
                connected = True
                log("[CONFIG-SYNC] Native URI ping succeeded (directConnection=%s)." % dc_val)
                break
            except Exception as exc:
                last_err = exc
                if temp_client:
                    try:
                        temp_client.close()
                    except Exception:
                        pass

        if connected:
            break

        # 2. Try candidate authSource databases with URI
        for src in auth_candidates:
            if connected:
                break
            for dc_val in (True, False):
                temp_client = None
                try:
                    temp_client = MongoClient(target_uri, authSource=src, serverSelectionTimeoutMS=4000, directConnection=dc_val)
                    temp_client.admin.command("ping")
                    client = temp_client
                    connected = True
                    log("[CONFIG-SYNC] Auth ping succeeded with authSource='%s' (directConnection=%s)." % (src, dc_val))
                    break
                except Exception as exc:
                    last_err = exc
                    if temp_client:
                        try:
                            temp_client.close()
                        except Exception:
                            pass

        # 3. Try explicit username/password kwargs if URI contained credentials
        if not connected and creds:
            host_candidates = [creds["host_uri"]]
            if "localhost" in creds["host_uri"]:
                host_candidates.append(creds["host_uri"].replace("localhost", "127.0.0.1"))
                host_candidates.append(creds["host_uri"].replace("localhost", "host.docker.internal"))
                host_candidates.append(creds["host_uri"].replace("localhost", "172.17.0.1"))
            elif "127.0.0.1" in creds["host_uri"]:
                host_candidates.append(creds["host_uri"].replace("127.0.0.1", "localhost"))
                host_candidates.append(creds["host_uri"].replace("127.0.0.1", "host.docker.internal"))
                host_candidates.append(creds["host_uri"].replace("127.0.0.1", "172.17.0.1"))

            pass_candidates = []
            if creds["password"]:
                pass_candidates.append(creds["password"])
            if creds["raw_password"] and creds["raw_password"] != creds["password"]:
                pass_candidates.append(creds["raw_password"])

            for h_uri in host_candidates:
                if connected:
                    break
                for p_val in pass_candidates:
                    if connected:
                        break
                    for src in auth_candidates:
                        for dc_val in (True, False):
                            temp_client = None
                            try:
                                temp_client = MongoClient(
                                    h_uri,
                                    username=creds["username"],
                                    password=p_val,
                                    authSource=src,
                                    serverSelectionTimeoutMS=4000,
                                    directConnection=dc_val,
                                )
                                temp_client.admin.command("ping")
                                client = temp_client
                                connected = True
                                log("[CONFIG-SYNC] Explicit kwargs Auth ping succeeded (user='%s', authSource='%s', directConnection=%s)." % (creds["username"], src, dc_val))
                                break
                            except Exception as exc:
                                last_err = exc
                                if temp_client:
                                    try:
                                        temp_client.close()
                                    except Exception:
                                        pass

    if not connected or not client:
        log("[CONFIG-SYNC] FAILED: Cannot connect to site MongoDB (%r)" % (last_err,))
        if client:
            try:
                client.close()
            except Exception:
                pass
        return

    captured_at = datetime.now(timezone.utc).isoformat()
    db_names = set()
    try:
        db_names = set(client.list_database_names())
        log("[CONFIG-SYNC] Connected! Discovered databases: %r" % sorted(list(db_names)))
    except Exception as exc:
        log("[CONFIG-SYNC] Warning listing database names: %r" % (exc,))
        if any(w in str(exc).lower() for w in ("require", "auth", "unauthorized")):
            log("[CONFIG-SYNC] AUTHENTICATION REQUIRED: MongoDB at %s requires credentials! Please configure mongo_uri with username & password (e.g. mongodb://user:pass@localhost:27027/?authSource=admin)." % _sanitize_uri(raw_uri))

    cfg_map = dict(config_collections())
    user_dbs = [d for d in db_names if d not in {"admin", "config", "local"}]
    matching_configured = [d for d in cfg_map.keys() if d in db_names]
    if not matching_configured and user_dbs:
        log("[CONFIG-SYNC] None of standard configured databases %r found in instance. Auto-discovering all databases: %r" % (list(cfg_map.keys()), sorted(user_dbs)))
        cfg_map = {dbname: ["*"] for dbname in user_dbs}

    log("[CONFIG-SYNC] Mapped collections to backup: %r" % cfg_map)

    sent = skipped = missing = 0
    for database, collections in cfg_map.items():
        if db_names and database not in db_names:
            missing += len(collections) if collections else 1
            log("[CONFIG-SYNC] Database '%s' not found in MongoDB instance." % database)
            continue
        try:
            coll_names = set(client[database].list_collection_names())
        except Exception as exc:
            log("[CONFIG-SYNC] Cannot list collections in '%s': %r" % (database, exc))
            if any(w in str(exc).lower() for w in ("require", "auth", "unauthorized")):
                log("[CONFIG-SYNC] AUTHENTICATION REQUIRED: Cannot access database '%s'. Please check username and permissions in mongo_uri." % database)
            missing += len(collections) if collections else 1
            continue

        target_cols = [c for c in collections if c] if isinstance(collections, list) else []
        if not target_cols or "*" in target_cols:
            target_cols = [c for c in coll_names if not c.startswith("system.")]

        matching_cols = [c for c in target_cols if c in coll_names]
        if not matching_cols and coll_names:
            matching_cols = [c for c in coll_names if not c.startswith("system.")]

        if not matching_cols:
            log("[CONFIG-SYNC] No matching collections found in '%s' for target list %r" % (database, collections))
            missing += len(target_cols) or 1
            continue

        for name in matching_cols:
            docs = [_jsonable(d) for d in client[database][name].find({}).limit(MAX_DOCS_PER_SNAPSHOT + 1)]
            truncated = len(docs) > MAX_DOCS_PER_SNAPSHOT
            docs = docs[:MAX_DOCS_PER_SNAPSHOT]
            payload_hash = hashlib.sha256(repr(sorted(docs, key=repr)).encode()).hexdigest()[:32]
            log("[CONFIG-SYNC] Uploading %s.%s (%d documents, hash=%s)..." % (database, name, len(docs), payload_hash))
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
                        log("[CONFIG-SYNC] Upload %s.%s SUCCESS: stored new version." % (database, name))
                    else:
                        skipped += 1
                        log("[CONFIG-SYNC] Upload %s.%s SUCCESS: content unchanged (hash match)." % (database, name))
            except Exception as exc:
                log("[CONFIG-SYNC] Upload %s.%s FAILED: %r" % (database, name, exc))

    client.close()
    log("[CONFIG-SYNC] Finished backup! Pushed=%d, Unchanged=%d, Missing=%d" % (sent, skipped, missing))


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

    initial_config = fetch_agent_config()
    if initial_config:
        apply_agent_config(initial_config)

    if "--once" in sys.argv:
        sys.exit(0 if cycle() else 1)
    if "--sync-configs" in sys.argv:
        sync_configs()
        sys.exit(0)

    start_config_poller()
    start_connectivity_poller()
    start_terminal_poller()
    start_widget_poller()
    start_deployment_poller()

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
