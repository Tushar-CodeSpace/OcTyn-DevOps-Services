"""Agent Release & Auto-Update Endpoints.

- GET /api/v1/agent/release          (agent/public) - Get active agent version & release info.
- GET /api/v1/agent/download/lite    (agent/public) - Download latest agent_lite.py.
- POST /api/v1/agent/trigger-update   (admin/JWT)    - Broadcast agent update signal to all site servers.
"""

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.database import models as db
from app.services import authentication as auth

router = APIRouter(prefix="/api/v1/agent", tags=["agent-update"])

# Root workspace path resolution
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent


def get_agent_lite_path() -> Path:
    """Find agent_lite.py across candidate locations (local dev, static app bundle, container)."""
    candidates = [
        BASE_DIR / "agent" / "agent_lite.py",
        Path("/app/agent/agent_lite.py"),
        Path(__file__).resolve().parent.parent / "static" / "agent_lite.py",
        Path(__file__).resolve().parent.parent / "agent_lite.py",
        Path("/app/app/static/agent_lite.py"),
        Path("/app/agent_lite.py"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


class AgentReleaseInfo(BaseModel):
    version: str
    sha256: str
    download_lite_url: str
    release_notes: str = "Latest CI/CD build release"


class TriggerUpdatePayload(BaseModel):
    server_ids: Optional[list[str]] = None  # None = update all active servers


def get_agent_file_sha256(file_path: Path) -> str:
    """Compute sha256 checksum of an agent file."""
    if not file_path.exists():
        return "sha256-unknown"
    return hashlib.sha256(file_path.read_bytes()).hexdigest()[:12]


@router.get("/release", response_model=AgentReleaseInfo)
async def get_agent_release():
    """Return active agent version & checksum info for auto-updating agents."""
    agent_path = get_agent_lite_path()
    sha = get_agent_file_sha256(agent_path)
    
    # Check if a custom version entry exists in app settings/database
    setting_doc = db.settings().find_one({"key": "agent_release"})
    version = setting_doc.get("version", f"1.0.0-sha.{sha}") if setting_doc else f"1.0.0-sha.{sha}"
    notes = setting_doc.get("release_notes", "Automated deployment build") if setting_doc else "Automated deployment build"

    return AgentReleaseInfo(
        version=version,
        sha256=sha,
        download_lite_url="/api/v1/agent/download/lite",
        release_notes=notes,
    )


@router.get("/download/lite")
async def download_agent_lite():
    """Serve the latest single-file agent_lite.py for remote site installation & updating."""
    agent_path = get_agent_lite_path()
    if not agent_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent script file not found on central server",
        )
    return FileResponse(
        path=agent_path,
        filename="agent_lite.py",
        media_type="text/x-python",
    )


def get_installer_path() -> Path:
    """Find agent_installer.py across candidate locations."""
    candidates = [
        BASE_DIR / "agent" / "agent_installer.py",
        Path("/app/agent/agent_installer.py"),
        Path(__file__).resolve().parent.parent / "static" / "agent_installer.py",
        Path(__file__).resolve().parent.parent / "agent_installer.py",
        Path("/app/app/static/agent_installer.py"),
        Path("/app/agent_installer.py"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


@router.get("/download/installer")
async def download_agent_installer():
    """Serve the automated agent_installer.py script for remote site setup."""
    installer_path = get_installer_path()
    if not installer_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent installer script file not found on central server",
        )
    return FileResponse(
        path=installer_path,
        filename="agent_installer.py",
        media_type="text/x-python",
    )


@router.get("/install.sh")
async def get_agent_install_script(
    request: Request,
    server_id: Optional[str] = None,
    api_key: Optional[str] = None,
    api_url: Optional[str] = None,
):
    """Serve dynamically configured bash one-liner agent installation script."""
    # Determine base Central API Hub URL
    if not api_url:
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
        forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
        forwarded_ssl = request.headers.get("x-forwarded-ssl", "").strip().lower()
        referer = request.headers.get("referer", "")

        if forwarded_proto in ("https", "http"):
            proto = forwarded_proto
        elif forwarded_ssl in ("on", "1"):
            proto = "https"
        elif referer.startswith("https://"):
            proto = "https"
        elif host and not (":" in host and not host.endswith(":443") and not host.endswith(":80")):
            # Standard domain without custom port usually terminates on HTTPS in production
            proto = "https" if "." in host and not host.startswith("localhost") and not host.startswith("127.") else (request.url.scheme or "http")
        else:
            proto = request.url.scheme or "http"

        effective_api_url = f"{proto}://{host}/api/v1"
    else:
        effective_api_url = api_url.rstrip("/")
        if not effective_api_url.endswith("/api/v1"):
            effective_api_url += "/api/v1"

    safe_server_id = server_id.strip() if server_id else ""
    safe_api_key = api_key.strip() if api_key else ""

    script_template = f"""#!/usr/bin/env bash
# ==============================================================================
# OcTyn DevOps Services — Automated Site Agent Installer
# ==============================================================================
set -e
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# Configuration
SERVER_ID="{safe_server_id}"
API_KEY="{safe_api_key}"
API_URL="{effective_api_url}"

# Allow command-line overrides: curl ... | sudo bash -s -- <server_id> <api_key> [api_url]
if [ -n "$1" ]; then SERVER_ID="$1"; fi
if [ -n "$2" ]; then API_KEY="$2"; fi
if [ -n "$3" ]; then API_URL="$3"; fi

# ANSI Colors
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
CYAN='\\033[0;36m'
BOLD='\\033[1m'
NC='\\033[0m'

echo -e "${{CYAN}}${{BOLD}}"
echo "============================================================"
echo "      OcTyn DevOps Services — Agent Auto-Installer"
echo "============================================================"
echo -e "${{NC}}"

# 1. Verify root privileges
if [ "$(id -u)" -ne 0 ]; then
  echo -e "${{RED}}[ERROR]${{NC}} This installer must be executed as root or with sudo:"
  echo -e "  ${{BOLD}}curl -sSL ... | sudo bash${{NC}}\\n"
  exit 1
fi

# 2. Validate configuration
if [ -z "$SERVER_ID" ] || [ "$SERVER_ID" = "None" ]; then
  echo -e "${{RED}}[ERROR]${{NC}} SERVER_ID is missing."
  echo "Usage: curl -sSL '<INSTALL_URL>' | sudo bash -s -- <server_id> <api_key> [api_url]"
  exit 1
fi

if [ -z "$API_KEY" ] || [ "$API_KEY" = "None" ]; then
  echo -e "${{RED}}[ERROR]${{NC}} API_KEY is missing."
  echo "Usage: curl -sSL '<INSTALL_URL>' | sudo bash -s -- <server_id> <api_key> [api_url]"
  exit 1
fi

API_URL="${{API_URL%/}}"
if [[ "$API_URL" != *"/api/v1" ]]; then
  API_URL="${{API_URL}}/api/v1"
fi

# Auto-detect if HTTPS is available if API_URL was set to http on a remote domain
if [[ "$API_URL" == http://* ]] && [[ "$API_URL" != http://localhost* ]] && [[ "$API_URL" != http://127.0.0.1* ]]; then
  HTTPS_CANDIDATE="https://${{API_URL#http://}}"
  if curl -sSL -k -f --connect-timeout 3 --max-time 5 "${{HTTPS_CANDIDATE}}/agent/release" >/dev/null 2>&1; then
    API_URL="$HTTPS_CANDIDATE"
  fi
fi

echo -e "${{BLUE}}==>${{NC}} Target Server ID  : ${{BOLD}}${{SERVER_ID}}${{NC}}"
echo -e "${{BLUE}}==>${{NC}} Central API Hub   : ${{BOLD}}${{API_URL}}${{NC}}"

# 3. Detect OS & Ensure Python 3
echo -e "\\n${{BLUE}}==>${{NC}} Checking Python 3 & system dependencies..."
if command -v python3 >/dev/null 2>&1; then
  PY_VER=$(python3 --version 2>&1)
  echo -e "${{GREEN}}[OK]${{NC}} ${{PY_VER}} detected."
else
  echo -e "${{YELLOW}}[!]${{NC}} Python 3 not found. Installing..."
  if command -v apt-get >/dev/null 2>&1; then
    timeout 60 apt-get update -qq || true
    timeout 120 apt-get install -y --no-install-recommends python3 curl || {{
      echo -e "${{RED}}[ERROR]${{NC}} Failed to install python3 automatically."
      exit 1
    }}
  elif command -v dnf >/dev/null 2>&1; then
    timeout 120 dnf install -y python3 curl || true
  elif command -v yum >/dev/null 2>&1; then
    timeout 120 yum install -y python3 curl || true
  elif command -v pacman >/dev/null 2>&1; then
    timeout 120 pacman -Sy --noconfirm python curl || true
  elif command -v apk >/dev/null 2>&1; then
    timeout 60 apk add --no-cache python3 curl || true
  else
    echo -e "${{RED}}[ERROR]${{NC}} Could not install Python 3 automatically. Please install python3 and re-run."
    exit 1
  fi
fi

# Ensure curl is installed (usually present since curl was used to fetch this script)
if ! command -v curl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    timeout 30 apt-get install -y --no-install-recommends curl >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then
    timeout 30 dnf install -y curl >/dev/null 2>&1 || true
  fi
fi

# Optional: ensure python3-pymongo for MongoDB database config backups (non-blocking)
if python3 -c "import pymongo" >/dev/null 2>&1; then
  echo -e "${{GREEN}}[OK]${{NC}} pymongo driver detected."
else
  echo -e "${{BLUE}}==>${{NC}} Checking pymongo driver (optional for MongoDB backup)..."
  if command -v apt-get >/dev/null 2>&1; then
    timeout 20 apt-get install -y --no-install-recommends python3-pymongo >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then
    timeout 20 dnf install -y python3-pymongo >/dev/null 2>&1 || true
  fi
fi

# 4. Create directory /opt/octyn-agent
INSTALL_DIR="/opt/octyn-agent"
echo -e "${{BLUE}}==>${{NC}} Creating installation directory: ${{INSTALL_DIR}}"
mkdir -p "$INSTALL_DIR"
chmod 755 "$INSTALL_DIR"


# 5. Write .env configuration (strictly SERVER_ID, API_URL, API_KEY)
ENV_FILE="$INSTALL_DIR/.env"
echo -e "${{BLUE}}==>${{NC}} Writing agent configuration to ${{ENV_FILE}}"
cat <<EOF > "$ENV_FILE"
SERVER_ID=$SERVER_ID
API_URL=$API_URL
API_KEY=$API_KEY
EOF
chmod 600 "$ENV_FILE"

# 6. Download single-file agent_lite.py
AGENT_FILE="$INSTALL_DIR/agent_lite.py"
DOWNLOAD_URL="${{API_URL}}/agent/download/lite"
echo -e "${{BLUE}}==>${{NC}} Downloading latest agent runtime from ${{DOWNLOAD_URL}}..."

DOWNLOAD_OK=0
if command -v curl >/dev/null 2>&1; then
  if curl -sSL -f --connect-timeout 10 --max-time 45 -H "User-Agent: OcTyn-Agent-Installer" "${{DOWNLOAD_URL}}" -o "$AGENT_FILE"; then
    DOWNLOAD_OK=1
  fi
elif command -v wget >/dev/null 2>&1; then
  if wget -q --timeout=30 -O "$AGENT_FILE" "${{DOWNLOAD_URL}}"; then
    DOWNLOAD_OK=1
  fi
fi


if [ "$DOWNLOAD_OK" -ne 1 ]; then
  python3 -c "import urllib.request; urllib.request.urlretrieve('${{DOWNLOAD_URL}}', '${{AGENT_FILE}}')" || true
fi

if [ ! -s "$AGENT_FILE" ]; then
  echo -e "${{RED}}[ERROR]${{NC}} Failed to download agent_lite.py from ${{DOWNLOAD_URL}}"
  exit 1
fi
chmod 755 "$AGENT_FILE"

# Verify python syntax
python3 -m py_compile "$AGENT_FILE" || {{
  echo -e "${{RED}}[ERROR]${{NC}} Downloaded agent_lite.py failed syntax verification."
  exit 1
}}
echo -e "${{GREEN}}[OK]${{NC}} Agent runtime verified successfully."

# 7. Configure and start systemd service
SERVICE_FILE="/etc/systemd/system/octyn.service"
if [ -d "/etc/systemd/system" ] && command -v systemctl >/dev/null 2>&1; then
  echo -e "${{BLUE}}==>${{NC}} Configuring systemd service (${{SERVICE_FILE}})..."
  cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=OcTyn DevOps Monitoring Agent
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/python3 $AGENT_FILE
Restart=always
RestartSec=5s
EnvironmentFile=-$ENV_FILE

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable octyn.service >/dev/null 2>&1 || true
  systemctl restart octyn.service

  sleep 1.5
  if systemctl is-active --quiet octyn.service; then
    SERVICE_STATUS="${{GREEN}}ACTIVE (running)${{NC}}"
  else
    SERVICE_STATUS="${{YELLOW}}STARTING (check: journalctl -u octyn.service)${{NC}}"
  fi
else
  SERVICE_STATUS="${{YELLOW}}systemd not detected (run manually: cd ${{INSTALL_DIR}} && python3 agent_lite.py)${{NC}}"
fi

# 8. Success Report
echo -e "\\n${{GREEN}}${{BOLD}}============================================================${{NC}}"
echo -e "${{GREEN}}${{BOLD}}      OcTyn Agent Installed Successfully!${{NC}}"
echo -e "${{GREEN}}${{BOLD}}============================================================${{NC}}"
echo -e "  Directory   : ${{BOLD}}${{INSTALL_DIR}}${{NC}}"
echo -e "  Config      : ${{BOLD}}${{ENV_FILE}}${{NC}}"
echo -e "  Service     : ${{BOLD}}octyn.service${{NC}} -> ${{SERVICE_STATUS}}"
echo -e "  Live Logs   : ${{CYAN}}sudo journalctl -u octyn.service -f${{NC}}"
echo -e "  Restart     : ${{CYAN}}sudo systemctl restart octyn.service${{NC}}"
echo -e "${{GREEN}}${{BOLD}}============================================================${{NC}}\\n"
"""
    return Response(
        content=script_template,
        media_type="text/x-shellscript",
        headers={"Content-Disposition": "inline; filename=\"install.sh\""},
    )



@router.post("/trigger-update", dependencies=[Depends(auth.require_admin)])
async def trigger_agent_update(payload: Optional[TriggerUpdatePayload] = None):
    """Admin endpoint: trigger an agent update check across all sites or specified servers."""
    target_servers = payload.server_ids if payload and payload.server_ids else None
    
    query = {}
    if target_servers:
        from app.database.connection import parse_id
        valid_ids = [parse_id(sid) for sid in target_servers if parse_id(sid)]
        query["_id"] = {"$in": valid_ids}
        
    servers = list(db.servers().find(query, {"_id": 1, "hostname": 1}))
    
    # Queue a terminal command for agents to execute self-update or flag update state
    updated_count = 0
    from datetime import datetime, timedelta, timezone
    now_utc = datetime.now(timezone.utc)
    updating_until = now_utc + timedelta(seconds=180)
    
    # Record global update broadcast window so alert evaluator suppresses false offline alerts
    db.settings().update_one(
        {"_id": "agent_update_broadcast"},
        {"$set": {"broadcast_at": now_utc, "updating_until": updating_until}},
        upsert=True,
    )
    
    for server in servers:
        sid = server["_id"]
        # Set agent config force_update flag in both settings and server_configs
        db.settings().update_one(
            {"key": f"agent_config:{sid}"},
            {"$set": {"force_update": True, "updating_until": updating_until, "updated_at": now_utc}},
            upsert=True,
        )
        db.server_configs().update_one(
            {"server_id": sid},
            {"$set": {"force_update": True, "updating_until": updating_until, "updated_at": now_utc}},
            upsert=True,
        )
        updated_count += 1
        
    return {
        "status": "success",
        "message": f"Triggered update check for {updated_count} server(s) with 3-minute grace period",
        "targeted_servers": [str(s["_id"]) for s in servers],
    }


def is_agent_update_in_progress(server_id=None) -> bool:
    """True if central broadcast or per-server update was triggered within grace period (180s)."""
    now_utc = datetime.now(timezone.utc)
    doc = db.settings().find_one({"_id": "agent_update_broadcast"})
    if doc and doc.get("updating_until") and doc["updating_until"] > now_utc:
        return True
    if server_id is not None:
        from app.database.connection import parse_id
        sid = parse_id(server_id) or server_id
        cfg = db.server_configs().find_one({"server_id": sid})
        if cfg and cfg.get("updating_until") and cfg["updating_until"] > now_utc:
            return True
    return False

