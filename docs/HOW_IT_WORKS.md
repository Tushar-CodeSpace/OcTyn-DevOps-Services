# How OcTyn DevOps Services Works (Basic Guide)

This document provides a simple, easy-to-understand guide to how **OcTyn DevOps Services** works under the hood.

---

## 1. High-Level Architecture Overview

Think of OcTyn DevOps Services like a central control room monitoring multiple remote client servers:

```
┌────────────────────────────────┐                 ┌────────────────────────────────┐
│   Remote Client Server         │                 │    Central Hub (VPS Server)     │
│                                │                 │                                │
│  ┌──────────────────────────┐  │   HTTP Requests │  ┌───────────────┐             │
│  │ OcTyn Agent (Python)     │──┼─────────────────┼─►│ FastAPI       │─► MongoDB   │
│  │ - Collects CPU/RAM/Disk  │  │ (Metrics, Logs, │  │ Backend       │   Database  │
│  │ - Executes Web SSH Cmds  │◄─┼─────────────────┼──│               │             │
│  └──────────────────────────┘  │    Poll Tasks)  │  └───────┬───────┘             │
└────────────────────────────────┘                 └───────┼────────────────────────┘
                                                           │ WebSockets (Socket.IO)
                                                           ▼
                                                   ┌────────────────────────────────┐
                                                   │ React Web Dashboard (Browser)  │
                                                   └────────────────────────────────┘
```

---

## 2. How the Agent Works (The Remote Helper)

The **Agent** is a lightweight Python program (`agent_lite.py` or modular `agent/`) installed on every client server you want to monitor.

### Key Jobs of the Agent:
1. **Metrics Collection**:
   - Uses `psutil` and system tools to measure CPU usage %, RAM %, Disk space %, Network traffic, system uptime, and disk I/O.
2. **Service & Device Health**:
   - Periodically checks if specified TCP ports (e.g. `80` for Nginx, `27017` for MongoDB) are running.
   - Pings local network hardware (e.g. IP cameras, PLCs) to check if they are online.
3. **Pulling Configuration Changes**:
   - Every few seconds, the agent calls `GET /api/v1/agent/config` on the Central Server.
   - If you update settings on the central dashboard (such as changing push intervals or monitored ports), the agent automatically updates itself without requiring you to SSH into the remote machine.
4. **Pushing Metrics**:
   - Sends collected metrics to `POST /api/v1/metrics` using its assigned `X-API-Key`.
5. **Auto-Updating**:
   - Checks `GET /api/v1/agent/release` on the Central Server.
   - When new code is pushed to GitHub `main`, remote agents automatically download the update, verify python syntax, replace themselves, and cleanly exit so `systemd` auto-restarts them on the new version.

---

## 3. How the Backend Works (The Central Engine)

The **Backend** runs on your central server powered by **FastAPI (Python)**, **Socket.IO (WebSockets)**, and **MongoDB**.

### Key Jobs of the Backend:
1. **Data Ingestion & Storage**:
   - Receives metric and service reports from agents and stores historical data in MongoDB collections (`metrics`, `services`, `servers`, `sites`, `alerts`).
2. **Heartbeat & Health Evaluation**:
   - A background loop runs every 30 seconds. If an agent hasn't pushed metrics in over 2 minutes, the backend automatically flags the server as `warning` or `offline`.
3. **Alert Engine**:
   - Continuously monitors thresholds (CPU > 90%, RAM > 90%, Disk > 85%, stopped services).
   - Raises alerts on the dashboard and optionally triggers external notifications (e.g. WhatsApp messages via Evolution API).
4. **Realtime WebSockets**:
   - Broadcasts live terminal output streams, system alerts, and server health updates to connected browser clients using Socket.IO.

---

## 4. How Web SSH / Remote Terminal Works

Since remote servers are usually behind firewalls or NATs, direct SSH incoming connections to them are often impossible. OcTyn solves this using an outbound polling mechanism:

### Step-by-Step Execution Flow:

1. **User Enters a Command**:
   - You type a command (e.g., `uptime`, `ls -la`, `pm2 logs`) in the Web SSH page of the frontend.
   - The browser sends `POST /api/v1/terminal/{server_id}/commands` to the backend.

2. **Command Queuing**:
   - The backend stores the command with state `"pending"`.

3. **Agent Polling**:
   - The remote agent continuously calls `GET /api/v1/terminal/poll`.
   - When it detects a pending command for its `SERVER_ID`, it claims the task.

4. **Command Execution**:
   - **Standard Commands**: The agent executes the command in `/bin/bash`, preserving the current working directory (`_TERMINAL_CWD`) across commands so `cd /path` works seamlessly.
   - **Interactive Editors (`nano` / `vim`)**: When you type `nano filename`, the agent reads `filename` directly from disk and sends back a special payload `OCTYN_NANO_EDIT:{...}`. The web dashboard catches this and pops up the custom Web Nano Editor modal! When saved, the browser sends a `cat << 'EOF' > filename` command to update the file on the remote server.

5. **Real-time Output Streaming**:
   - As the process outputs lines of text, the agent streams them back chunk-by-chunk to `POST /api/v1/terminal/result`.
   - The central server immediately emits the output over Socket.IO to your browser terminal.

6. **Process Cancellation (<kbd>Ctrl</kbd> + <kbd>C</kbd>)**:
   - Pressing <kbd>Ctrl</kbd> + <kbd>C</kbd> in the browser terminal calls `POST /api/v1/terminal/{server_id}/commands/{command_id}/cancel`.
   - The agent detects the cancellation request while streaming and sends `SIGINT` (Ctrl+C signal) to the process group, cleanly interrupting the running command.

---

## 5. How Site MongoDB Config Backups Work

OcTyn allows you to back up MongoDB database collection configurations across your remote client sites:

1. **Instant Backup Testing**:
   - In the **Server Detail** page, click **"Backup settings"** $\rightarrow$ **"Test Connection & Run Backup Now"**.
   - If your password has special characters like `@` (e.g. `nido@123`), OcTyn automatically URL-encodes it (`nido%40123`) to avoid connection errors.
2. **Instant Agent Trigger (`trigger_sync_id`)**:
   - The central server sends a `trigger_sync_id` signal to the remote site agent.
   - The agent immediately runs `sync_configs()` in a background thread and POSTs MongoDB collection snapshots back to the central hub.
3. **Live UI Verification**:
   - The dashboard displays an animated loading spinner (`Loader2`) and actively polls for up to 25 seconds until the snapshot arrives, displaying success or an explicit timeout notification.

---

## 6. How Data Retention & Disk Space Management Works

To keep disk space usage low on the central server (`/dev/sda4`), OcTyn enforces a **7-Day Retention Policy**:

1. **7-Day Auto-Expiration (MongoDB TTL)**:
   - Native MongoDB TTL indexes automatically expire and delete telemetry metrics, config snapshots, and terminal logs older than **7 days** (604,800 seconds).
2. **Daily Cleanup Loop**:
   - The central backend runs a daily background loop that purges historical metrics, old snapshots, and resolved alerts older than 7 days.
3. **Instant Manual Reclamation**:
   - You can run the disk space reclamation script from the command line:
     ```bash
     uv run --project backend scripts/cleanup.py --days 7
     ```
     This deletes old data and runs MongoDB collection compaction (`compact`) to immediately compress database files on disk.
   - You can also click **"Prune Data Older Than 7 Days"** directly from the **Settings** page in the web dashboard.

---

## 7. How Alert Controls Work (Per-Client & Per-Site)

You can customize alert delivery so specific client sites don't trigger unnecessary notifications:

1. **Client & Site Sub-Tiles**:
   - On the **Settings** page, the right column features interactive **Client Sub-Tiles** and **Site Sub-Tiles** with real-time search filtering.
2. **Alert Enable/Disable Toggles**:
   - Admins and Super Admins can disable alerts for an entire client (e.g. `Samsonite`) or a specific site (e.g. `Nashik Plant`).
3. **Alert Engine Enforcement**:
   - When alerts are disabled for a site or client, the alert evaluator (`alerts.py`) and notifier (`notifier.py`) suppress notification popups and external alerts (e.g. WhatsApp messages).

