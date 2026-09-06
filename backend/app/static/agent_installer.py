#!/usr/bin/env python3
"""agent_installer.py — Interactive & automated installer for OcTyn DevOps Services Agent.

Usage:
    sudo python3 agent_installer.py
    # or curl & run directly from Central Hub:
    curl -sSL "http://<CENTRAL_SERVER_URL>/api/v1/agent/download/installer" | sudo python3 -
"""

import os
import shutil
import subprocess
import sys
import urllib.request

INSTALL_DIR = "/opt/octyn-agent"
SERVICE_PATH = "/etc/systemd/system/octyn.service"


def print_step(msg: str) -> None:
    print(f"\033[1;32m==>\033[0m \033[1m{msg}\033[0m")


def print_warn(msg: str) -> None:
    print(f"\033[1;33m[!] {msg}\033[0m")


def print_err(msg: str) -> None:
    print(f"\033[1;31m[X] {msg}\033[0m")


def main() -> None:
    print("\n" + "=" * 60)
    print("      OcTyn DevOps Services — Agent Installer")
    print("=" * 60 + "\n")

    # 1. Directory creation
    if not os.path.exists(INSTALL_DIR):
        print_step(f"Creating installation directory: {INSTALL_DIR}")
        try:
            os.makedirs(INSTALL_DIR, exist_ok=True)
        except PermissionError:
            print_err(f"Permission denied: please run installer with sudo/root privileges!")
            sys.exit(1)
    else:
        print_step(f"Installation directory exists: {INSTALL_DIR}")

    # 2. Collect configuration inputs
    default_api_url = os.environ.get("API_URL", "http://localhost:8000/api/v1")
    default_server_id = os.environ.get("SERVER_ID", "")
    default_api_key = os.environ.get("API_KEY", "")

    # Non-interactive mode support (if env vars are passed)
    if os.environ.get("NON_INTERACTIVE") == "1" or (default_server_id and default_api_key):
        api_url = default_api_url
        server_id = default_server_id
        api_key = default_api_key
    else:
        api_url = input(f"Enter Central API URL [{default_api_url}]: ").strip() or default_api_url
        api_url = api_url.rstrip("/")
        if "/api/v1" not in api_url:
            api_url += "/api/v1"

        server_id = input(f"Enter SERVER_ID (from dashboard) [{default_server_id}]: ").strip() or default_server_id
        api_key = input(f"Enter API_KEY (starts with cm-) [{default_api_key}]: ").strip() or default_api_key

    # 3. Write .env file
    env_file = os.path.join(INSTALL_DIR, ".env")
    print_step(f"Writing configuration to {env_file}")
    with open(env_file, "w", encoding="utf-8") as f:
        f.write(f"SERVER_ID={server_id}\n")
        f.write(f"API_URL={api_url}\n")
        f.write(f"API_KEY={api_key}\n")
    try:
        os.chmod(env_file, 0o600)
    except Exception:
        pass

    # 4. Download or copy agent_lite.py
    script_path = os.path.join(INSTALL_DIR, "agent_lite.py")
    download_url = f"{api_url}/agent/download/lite"
    print_step(f"Downloading latest agent_lite.py from {download_url}...")
    
    download_success = False
    try:
        req = urllib.request.Request(download_url, headers={"User-Agent": "OcTyn-Agent-Installer/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read()
            if len(content) > 1000 and b"agent_lite" in content:
                with open(script_path, "wb") as sf:
                    sf.write(content)
                os.chmod(script_path, 0o755)
                download_success = True
                print_step("Downloaded agent_lite.py successfully.")
    except Exception as exc:
        print_warn(f"Could not download from {download_url}: {exc}")

    # Fallback to local agent_lite.py if script is in current folder
    if not download_success:
        local_agent = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_lite.py")
        if os.path.exists(local_agent) and local_agent != script_path:
            shutil.copy(local_agent, script_path)
            os.chmod(script_path, 0o755)
            print_step("Copied local agent_lite.py into place.")
        elif os.path.exists(script_path):
            print_step("Using existing agent_lite.py file.")
        else:
            print_err(f"Failed to download agent_lite.py! Place agent_lite.py manually in {INSTALL_DIR}")

    # 5. Install systemd service
    if os.path.isdir("/etc/systemd/system"):
        print_step("Configuring systemd service (/etc/systemd/system/octyn.service)...")
        service_content = f"""[Unit]
Description=OcTyn DevOps Monitoring Agent
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory={INSTALL_DIR}
ExecStart=/usr/bin/python3 {INSTALL_DIR}/agent_lite.py
Restart=always
RestartSec=5s
EnvironmentFile=-{INSTALL_DIR}/.env

[Install]
WantedBy=multi-user.target
"""
        try:
            with open(SERVICE_PATH, "w", encoding="utf-8") as f:
                f.write(service_content)
            subprocess.run(["systemctl", "daemon-reload"], check=False)
            subprocess.run(["systemctl", "enable", "--now", "octyn.service"], check=False)
            print_step("systemd service 'octyn.service' installed and started!")
        except Exception as exc:
            print_warn(f"Could not install systemd service automatically: {exc}")

    print("\n" + "=" * 60)
    print("      Agent Installation Completed Successfully!")
    print("=" * 60)
    print(f" Installation Directory : {INSTALL_DIR}")
    print(f" Configuration File    : {INSTALL_DIR}/.env")
    print(f" Edit Configuration    : nano {INSTALL_DIR}/.env")
    print(f" Restart Service       : sudo systemctl restart octyn.service")
    print(f" View Logs             : sudo journalctl -u octyn.service -f")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
