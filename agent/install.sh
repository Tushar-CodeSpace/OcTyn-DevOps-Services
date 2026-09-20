#!/usr/bin/env bash
# ==============================================================================
# OcTyn DevOps Services — Automated Site Agent Installer
# ==============================================================================
set -e

# Configuration (defaults can be passed via environment or command-line arguments)
SERVER_ID="${SERVER_ID:-}"
API_KEY="${API_KEY:-}"
API_URL="${API_URL:-http://localhost:8000/api/v1}"

# Allow command-line overrides: curl ... | sudo bash -s -- <server_id> <api_key> [api_url]
if [ -n "$1" ]; then SERVER_ID="$1"; fi
if [ -n "$2" ]; then API_KEY="$2"; fi
if [ -n "$3" ]; then API_URL="$3"; fi

# ANSI Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "============================================================"
echo "      OcTyn DevOps Services — Agent Auto-Installer"
echo "============================================================"
echo -e "${NC}"

# 1. Verify root privileges
if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}[ERROR]${NC} This installer must be executed as root or with sudo:"
  echo -e "  ${BOLD}curl -sSL ... | sudo bash${NC}\n"
  exit 1
fi

# 2. Validate configuration
if [ -z "$SERVER_ID" ] || [ "$SERVER_ID" = "None" ]; then
  echo -e "${RED}[ERROR]${NC} SERVER_ID is missing."
  echo "Usage: curl -sSL '<INSTALL_URL>' | sudo bash -s -- <server_id> <api_key> [api_url]"
  exit 1
fi

if [ -z "$API_KEY" ] || [ "$API_KEY" = "None" ]; then
  echo -e "${RED}[ERROR]${NC} API_KEY is missing."
  echo "Usage: curl -sSL '<INSTALL_URL>' | sudo bash -s -- <server_id> <api_key> [api_url]"
  exit 1
fi

API_URL="${API_URL%/}"
if [[ "$API_URL" != *"/api/v1" ]]; then
  API_URL="${API_URL}/api/v1"
fi

echo -e "${BLUE}==>${NC} Target Server ID  : ${BOLD}${SERVER_ID}${NC}"
echo -e "${BLUE}==>${NC} Central API Hub   : ${BOLD}${API_URL}${NC}"

# 3. Detect OS & Ensure Python 3
echo -e "\n${BLUE}==>${NC} Checking Python 3 & system dependencies..."
if ! command -v python3 >/dev/null 2>&1; then
  echo -e "${YELLOW}[!]${NC} Python 3 not found. Installing..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y --no-install-recommends python3 python3-pip curl
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 python3-pip curl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y python3 python3-pip curl
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm python python-pip curl
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache python3 py3-pip curl
  else
    echo -e "${RED}[ERROR]${NC} Could not install Python 3 automatically. Please install python3 and re-run."
    exit 1
  fi
fi

# Attempt installing python3-pymongo if apt/dnf is available (for MongoDB database backups)
if command -v apt-get >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends python3-pymongo >/dev/null 2>&1 || true
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y python3-pymongo >/dev/null 2>&1 || true
fi

# 4. Create directory /opt/octyn-agent
INSTALL_DIR="/opt/octyn-agent"
echo -e "${BLUE}==>${NC} Creating installation directory: ${INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"
chmod 755 "$INSTALL_DIR"

# 5. Write .env configuration (strictly SERVER_ID, API_URL, API_KEY)
ENV_FILE="$INSTALL_DIR/.env"
echo -e "${BLUE}==>${NC} Writing agent configuration to ${ENV_FILE}"
cat <<EOF > "$ENV_FILE"
SERVER_ID=$SERVER_ID
API_URL=$API_URL
API_KEY=$API_KEY
EOF
chmod 600 "$ENV_FILE"

# 6. Download single-file agent_lite.py
AGENT_FILE="$INSTALL_DIR/agent_lite.py"
DOWNLOAD_URL="${API_URL}/agent/download/lite"
echo -e "${BLUE}==>${NC} Downloading latest agent runtime from ${DOWNLOAD_URL}..."

DOWNLOAD_OK=0
if command -v curl >/dev/null 2>&1; then
  if curl -sSL -f -H "User-Agent: OcTyn-Agent-Installer" "${DOWNLOAD_URL}" -o "$AGENT_FILE"; then
    DOWNLOAD_OK=1
  fi
elif command -v wget >/dev/null 2>&1; then
  if wget -q -O "$AGENT_FILE" "${DOWNLOAD_URL}"; then
    DOWNLOAD_OK=1
  fi
fi

if [ "$DOWNLOAD_OK" -ne 1 ]; then
  python3 -c "import urllib.request; urllib.request.urlretrieve('${DOWNLOAD_URL}', '${AGENT_FILE}')" || true
fi

if [ ! -s "$AGENT_FILE" ]; then
  echo -e "${RED}[ERROR]${NC} Failed to download agent_lite.py from ${DOWNLOAD_URL}"
  exit 1
fi
chmod 755 "$AGENT_FILE"

# Verify python syntax
python3 -m py_compile "$AGENT_FILE" || {
  echo -e "${RED}[ERROR]${NC} Downloaded agent_lite.py failed syntax verification."
  exit 1
}
echo -e "${GREEN}[OK]${NC} Agent runtime verified successfully."

# 7. Configure and start systemd service
SERVICE_FILE="/etc/systemd/system/octyn.service"
if [ -d "/etc/systemd/system" ] && command -v systemctl >/dev/null 2>&1; then
  echo -e "${BLUE}==>${NC} Configuring systemd service (${SERVICE_FILE})..."
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
    SERVICE_STATUS="${GREEN}ACTIVE (running)${NC}"
  else
    SERVICE_STATUS="${YELLOW}STARTING (check: journalctl -u octyn.service)${NC}"
  fi
else
  SERVICE_STATUS="${YELLOW}systemd not detected (run manually: cd ${INSTALL_DIR} && python3 agent_lite.py)${NC}"
fi

# 8. Success Report
echo -e "\n${GREEN}${BOLD}============================================================${NC}"
echo -e "${GREEN}${BOLD}      OcTyn Agent Installed Successfully!${NC}"
echo -e "${GREEN}${BOLD}============================================================${NC}"
echo -e "  Directory   : ${BOLD}${INSTALL_DIR}${NC}"
echo -e "  Config      : ${BOLD}${ENV_FILE}${NC}"
echo -e "  Service     : ${BOLD}octyn.service${NC} -> ${SERVICE_STATUS}"
echo -e "  Live Logs   : ${CYAN}sudo journalctl -u octyn.service -f${NC}"
echo -e "  Restart     : ${CYAN}sudo systemctl restart octyn.service${NC}"
echo -e "${GREEN}${BOLD}============================================================${NC}\n"
