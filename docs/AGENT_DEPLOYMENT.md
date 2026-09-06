# Remote Site Agent Deployment & Auto-Update Guide (`AGENT_DEPLOYMENT.md`)

This guide explains how to **deploy the latest monitoring agent** on any remote site server and how **automated CI/CD updates** keep all remote site agents up to date whenever changes are pushed to GitHub.

---

## 1. Quick 2-Minute Remote Site Deployment

### Option A: 1-Liner Automated Installer (Recommended)

Run this single command on the remote site server (it creates `/opt/octyn-agent`, downloads `agent_lite.py`, generates `.env`, and sets up `octyn.service` automatically):

```bash
curl -sSL "http://<CENTRAL_SERVER_IP_OR_DOMAIN>/api/v1/agent/download/installer" | sudo python3 -
```

---

### Option B: Manual Step-by-Step Installation

#### Step 1: Create Installation Directory
```bash
sudo mkdir -p /opt/octyn-agent
sudo chown -R $USER:$USER /opt/octyn-agent
cd /opt/octyn-agent
```

#### Step 2: Download the Latest Agent Script
```bash
curl -sSL "http://<CENTRAL_SERVER_IP_OR_DOMAIN>/api/v1/agent/download/lite" -o agent_lite.py
chmod +x agent_lite.py
```

---

### Step 3: Configure Minimal `.env` Credentials

Create `agent/.env` or `.env` inside `/opt/octyn-agent/.env`:
```env
SERVER_ID=your_server_uuid_from_dashboard
API_URL=http://<CENTRAL_SERVER_IP_OR_DOMAIN>/api/v1
API_KEY=cm-your_generated_agent_api_key
```

> **Note**: Only `SERVER_ID`, `API_URL`, and `API_KEY` are required in `.env`. All other configuration settings (intervals, monitored services, ping targets) are automatically pulled from the Central Hub.

---

### Step 4: Install Systemd Background Service

Create `/etc/systemd/system/octyn.service`:
```ini
[Unit]
Description=OcTyn DevOps Monitoring Agent
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/octyn-agent
ExecStart=/usr/bin/python3 /opt/octyn-agent/agent_lite.py
Restart=always
RestartSec=5s
EnvironmentFile=-/opt/octyn-agent/.env

[Install]
WantedBy=multi-user.target
```

Enable and start the agent service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now octyn.service
```

Check agent status & logs:
```bash
sudo systemctl status octyn.service
sudo journalctl -u octyn.service -f
```

---

## 2. Upgrading Existing Site Agents to the Latest Release

If a site server is running an older agent version, upgrade it in **one step**:

```bash
cd /opt/octyn-agent

# 1. Download latest agent code from Central Hub
curl -sSL "http://<CENTRAL_SERVER_IP_OR_DOMAIN>:8000/api/v1/agent/download/lite" -o agent_lite.py.tmp

# 2. Verify syntax
python3 -m py_compile agent_lite.py.tmp

# 3. Replace script & restart service
mv agent_lite.py.tmp agent_lite.py
sudo systemctl restart octyn.service
```

---

## 3. How Automated CI/CD Agent Updates Work

Going forward, **no manual intervention is required** to update remote agents when code changes are pushed to GitHub!

```
┌─────────────────┐       ┌─────────────────┐       ┌────────────────────────┐
│  git push main  │ ────► │  GitHub Action  │ ────► │  Central Server (VPS)  │
└─────────────────┘       │    CI/CD Job    │       │  Deploys & Updates SHA │
                          └─────────────────┘       └───────────┬────────────┘
                                                                │
                                            ┌───────────────────┴───────────────────┐
                                            ▼                                       ▼
                                ┌──────────────────────┐                ┌──────────────────────┐
                                │   Site Agent 1       │                │     Site Agent N     │
                                │  Auto-downloads      │                │  Auto-downloads      │
                                │  & systemd restarts  │                │  & systemd restarts  │
                                └──────────────────────┘                └──────────────────────┘
```

1. **GitHub Push**: Developer pushes code changes to `main`.
2. **Central Hub Deployment**: GitHub Action deploys the updated code to the VPS backend.
3. **Release Broadcast**: GitHub Action triggers `POST /api/v1/agent/trigger-update`.
4. **Agent Check & Self-Update**:
   - Remote site agents check `GET /api/v1/agent/release` during their monitoring loop.
   - When the agent detects a checksum mismatch between local `agent_lite.py` and central `sha256`:
     1. Agent downloads the latest `agent_lite.py` to `agent_lite.py.tmp`.
     2. Validates Python syntax using `py_compile`.
     3. Atomically replaces `agent_lite.py`.
     4. Exits cleanly with status code `0`.
     5. Systemd (`Restart=always` in `octyn.service`) automatically restarts the process running the fresh code!

---

## 4. Triggering Manual On-Demand Agent Updates

To force an immediate update across all site agents without waiting for the next poll cycle:

### Via API (Curl / Postman):
```bash
curl -X POST "http://<CENTRAL_SERVER_IP_OR_DOMAIN>:8000/api/v1/agent/trigger-update" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

---

## 5. Summary of Agent Release Endpoints

| Method | Route | Description |
| ------ | ----- | ----------- |
| `GET` | `/api/v1/agent/release` | Check active agent version & SHA256 checksum |
| `GET` | `/api/v1/agent/download/lite` | Download latest single-file `agent_lite.py` |
| `POST` | `/api/v1/agent/trigger-update` | Broadcast update check notification to all agents |
