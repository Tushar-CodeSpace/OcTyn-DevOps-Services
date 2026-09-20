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


def prompt(text: str, default: str = "") -> str:
    """Safe input prompt that handles EOF/pipes gracefully."""
    try:
        val = input(text).strip()
        return val if val else default
    except (EOFError, KeyboardInterrupt):
        print()
        return default


def ensure_pymongo() -> None:
    """Ensure python3-pymongo / pymongo is installed for site MongoDB configuration backups."""
    try:
        import pymongo
        print_step("pymongo is already installed.")
        return
    except ImportError:
        pass

    print_step("pymongo is required for database config backups. Checking package manager...")

    # 1. Try apt-get (Debian / Ubuntu / Mint)
    if shutil.which("apt-get"):
        print_step("Installing python3-pymongo via apt-get...")
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
                print_step("Successfully installed python3-pymongo via apt.")
                return
            else:
                print_warn(f"apt-get install python3-pymongo returned code {res.returncode}")
        except Exception as exc:
            print_warn(f"apt-get install python3-pymongo failed: {exc}")

    # 2. Try dnf/yum (RHEL / CentOS / Alma / Rocky / Fedora)
    for pkg_mgr in ["dnf", "yum"]:
        if shutil.which(pkg_mgr):
            print_step(f"Installing python3-pymongo via {pkg_mgr}...")
            try:
                res = subprocess.run(
                    [pkg_mgr, "install", "-y", "python3-pymongo"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=120,
                )
                if res.returncode == 0:
                    print_step(f"Successfully installed python3-pymongo via {pkg_mgr}.")
                    return
            except Exception as exc:
                print_warn(f"{pkg_mgr} install python3-pymongo failed: {exc}")

    # 3. Try python3 -m pip
    print_step("Attempting pymongo installation via pip...")
    for pip_args in [["--break-system-packages"], []]:
        try:
            cmd = [sys.executable, "-m", "pip", "install", "pymongo"] + pip_args
            res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
            if res.returncode == 0:
                print_step("Successfully installed pymongo via pip.")
                return
        except Exception:
            pass

    # Final verification
    try:
        import pymongo
        print_step("pymongo verified successfully.")
    except ImportError:
        print_warn("Could not install python3-pymongo automatically. If you plan to back up MongoDB, run: sudo apt install -y python3-pymongo")


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="OcTyn DevOps Services — Agent Installer")
    parser.add_argument("--server-id", dest="server_id", default=os.environ.get("SERVER_ID", ""))
    parser.add_argument("--api-key", dest="api_key", default=os.environ.get("API_KEY", ""))
    parser.add_argument("--api-url", dest="api_url", default=os.environ.get("API_URL", "http://localhost:8000/api/v1"))
    parser.add_argument("--non-interactive", action="store_true", default=os.environ.get("NON_INTERACTIVE") == "1")
    args, _ = parser.parse_known_args()

    default_api_url = args.api_url or os.environ.get("API_URL", "http://localhost:8000/api/v1")
    default_server_id = args.server_id or os.environ.get("SERVER_ID", "")
    default_api_key = args.api_key or os.environ.get("API_KEY", "")
    is_non_interactive = bool(args.non_interactive or (default_server_id and default_api_key))

    # If piped via `curl ... | sudo python3 -`, re-open sys.stdin from /dev/tty for interactive input
    if not is_non_interactive and not sys.stdin.isatty():
        try:
            sys.stdin = open("/dev/tty", "r")
        except Exception:
            pass

    print("\n" + "=" * 60)
    print("      OcTyn DevOps Services — Agent Installer")
    print("=" * 60 + "\n")

    # 1. Directory creation
    if not os.path.exists(INSTALL_DIR):
        print_step(f"Creating installation directory: {INSTALL_DIR}")
        try:
            os.makedirs(INSTALL_DIR, exist_ok=True)
        except PermissionError:
            print_err("Permission denied: please run installer with sudo/root privileges!")
            sys.exit(1)
    else:
        print_step(f"Installation directory exists: {INSTALL_DIR}")

    # 2. Ensure python3-pymongo is installed
    ensure_pymongo()

    # 3. Collect configuration inputs
    if is_non_interactive:
        api_url = default_api_url.rstrip("/")
        if "/api/v1" not in api_url:
            api_url += "/api/v1"
        server_id = default_server_id
        api_key = default_api_key
    else:
        api_url = prompt(f"Enter Central API URL [{default_api_url}]: ", default_api_url)
        api_url = api_url.rstrip("/")
        if "/api/v1" not in api_url:
            api_url += "/api/v1"

        server_id = prompt(f"Enter SERVER_ID (from dashboard) [{default_server_id}]: ", default_server_id)
        api_key = prompt(f"Enter API_KEY (starts with cm-) [{default_api_key}]: ", default_api_key)


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
