"""Main monitoring cycle execution and dynamic config poller."""

import threading
import time
from agent.collectors import collect_metrics, collect_services
from agent.config import _RUNTIME_CONFIG, apply_agent_config, log
from agent.transport import fetch_agent_config, push, push_return


def cycle() -> bool:
    """Run one monitoring collection cycle (metrics + services) and push to hub."""
    m = collect_metrics()
    resp = push_return("/metrics", m)
    ok = bool(resp is not None)
    if isinstance(resp, dict):
        apply_agent_config(resp)
    reports = collect_services()
    if reports:
        push("/services", reports)
    if ok:
        log(
            "pushed cpu=%.1f%% mem=%.1f%% disk=%.1f%% services=%d"
            % (m["cpu_percent"], m["memory_percent"], m["disk_percent"], len(reports))
        )
    return ok


def start_config_poller() -> None:
    """Start background thread polling central hub for live config changes."""

    def _poll() -> None:
        last = None
        while True:
            try:
                new_cfg = fetch_agent_config()
                if new_cfg and new_cfg != last:
                    last = new_cfg
                    apply_agent_config(new_cfg)
                    log("agent config updated from hub")
            except Exception as exc:
                log(f"config poll error: {exc!r}")
            time.sleep(max(1, int(_RUNTIME_CONFIG.get("config_poll_interval_seconds", 5))))

    threading.Thread(target=_poll, name="config-poller", daemon=True).start()
