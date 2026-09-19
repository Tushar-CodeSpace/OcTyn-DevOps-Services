"""OcTyn DevOps Services Modular Agent entrypoint."""

import socket
import sys
import time
from datetime import datetime

from agent.config import (
    _RUNTIME_CONFIG,
    API_KEY,
    API_URL,
    SERVER_ID,
    apply_agent_config,
    log,
    mongo_config_enabled,
    monitoring_interval,
)
from agent.connectivity import start_connectivity_poller
from agent.mongo_backup import HAS_PYMONGO, sync_configs
from agent.runner import cycle, start_config_poller
from agent.terminal import start_terminal_poller
from agent.transport import fetch_agent_config
from agent.updater import check_and_apply_update
from agent.widgets import start_widget_poller
from agent.deployer import start_deployment_poller


def main() -> None:
    """Main CLI entry point for running the agent."""
    if not (SERVER_ID and API_URL and API_KEY):
        sys.exit(
            "error: SERVER_ID, API_URL and API_KEY are required in agent/.env or environment"
        )

    log(f"modular agent starting host={socket.gethostname()} server_id={SERVER_ID} api_url={API_URL}")

    # Immediately pull initial per-server configuration from central hub
    initial_config = fetch_agent_config()
    if initial_config:
        apply_agent_config(initial_config)
        log("initial agent config pulled from hub")

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

    last_config_sync_day = None
    update_check_counter = 0
    while True:
        try:
            cycle()
        except Exception as exc:
            log(f"cycle error: {exc!r}")

        # Check for updates every 6 cycles or when force_update flag is set
        update_check_counter += 1
        if update_check_counter >= 6 or bool(_RUNTIME_CONFIG.get("force_update", False)):
            update_check_counter = 0
            check_and_apply_update()

        now_local = datetime.now()
        if (
            mongo_config_enabled()
            and bool(_RUNTIME_CONFIG.get("config_sync_enabled", True))
            and HAS_PYMONGO
            and now_local.date() != last_config_sync_day
            and now_local.hour == int(_RUNTIME_CONFIG.get("config_sync_hour", 0))
        ):
            try:
                sync_configs()
            except Exception as exc:
                log(f"config sync error: {exc!r}")
            last_config_sync_day = now_local.date()

        try:
            time.sleep(max(1, monitoring_interval()))
        except KeyboardInterrupt:
            break


if __name__ == "__main__":
    main()