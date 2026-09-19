# How OcTyn DevOps Services Works

This document provides an overview of how **OcTyn DevOps Services** works under the hood.

> [!NOTE]
> For complete technical references, see:
> - [API Contract & REST Specifications](API_CONTRACT.md)
> - [Master Server & Agent Features Guide](MASTER_SERVER_AND_AGENT_FEATURES.md)
> - [Architecture Deep Dive](ARCHITECTURE.md)

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

1. **Instant Backup Testing & Auto-Discovery**:
   - In the **Server Detail** page, click **"Backup settings"** $\rightarrow$ **"Test Connection & Run Backup Now"**.
   - If your password has special characters like `@` (e.g. `nido@123`), OcTyn automatically URL-encodes it (`nido%40123`) to avoid connection errors.
   - **Multi-Host Resolution**: The agent tests candidate endpoints (`localhost`, `127.0.0.1`, `host.docker.internal`, `172.17.0.1`) and tries both `directConnection=True` and fallback without direct connection.
   - **Database Auto-Discovery**: If your site uses custom databases that do not match the default OcTyn names, the agent automatically discovers all non-system databases (`user_dbs`) and backs up all collections.
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

---

## 8. How Widget-Specific Integration Failure Thresholds Work

Rather than a one-size-fits-all global threshold, each integration widget configures its own sensitivity:

1. **Site & Widget-Specific Controls**:
   - Under **Server Detail** $\rightarrow$ **Custom Data Widgets**, each widget card has individual settings:
     - **Integration Failure Alert Threshold (%)**: Default `50%`.
     - **Integration Failure Window (minutes)**: Default `15` minutes.
2. **Targeted Failure Rate Evaluation**:
   - The evaluator queries `db.widget_data()` within that widget's specified lookback window and tallies failure status groups (`FAILED`, `ERROR`, `EXPIRED`, `INVALID`, `REJECT`).
   - If the failure percentage exceeds the widget's threshold, a warning alert `integration_error_spike:<widget_name>` is raised for that site, and auto-resolves when health returns to normal.

---

## 9. How Master Deploy Grace Periods Prevent False Offline Alarms

When pushing new code to the central server or deploying agent auto-updates, temporary reconnections would previously trigger false "Server is offline" alerts:

1. **Master Startup Grace Period (180s)**:
   - When the central backend boots, it enforces a 180-second startup window (`master_deploy_grace_seconds`) during which new `server_offline` alerts are suppressed while remote agents re-establish connections.
2. **Agent Auto-Update Grace Period (180s)**:
   - When `POST /api/v1/agent/trigger-update` broadcasts an update, an active 180s `updating_until` window protects agents from being falsely flagged as offline while they self-update and restart under `systemd`.

---

## 10. How Software Deployments & Orchestration Work

OcTyn DevOps Services features an automated software release and orchestration engine designed to deploy multi-component applications across remote site servers:

1. **Multi-Component Stacks & Git Repositories**:
   - Software definitions configure multiple repositories under a unified deployment profile:
     - **Backend Monorepo**: Node.js v24 PM2 services, automated dependencies installation (`npm ci`), and build steps.
     - **Frontend Web**: PHP 8.4+ applications, Composer package installation, and Nginx / PHP-FPM service reloads.
     - **Client & Machine Config Repo**: Dynamically clones site-specific profiles (`configs/{client}/{machine_type}`) and imports configuration documents directly into local MongoDB databases.
   - Built-in default template for **`nidoworkz`** auto-seeds on initial database creation.

2. **Single-Site vs Multi-Site Fleet Deployments**:
   - **Single-Site**: Target an individual server node with immediate feedback.
   - **Multi-Site**: Filter site nodes by client name, select all online machines, and dispatch concurrent deployment jobs bound by a shared `batch_id`.

3. **Live Terminal Streaming & Multi-Node Console**:
   - As edge agents execute deployment stages (`precheck`, `git_fetch`, `config_import`, `build`, `start_services`), every line of stdout and stderr streams back chunk-by-chunk to `POST /api/v1/deployments/{id}/stream`.
   - The central server broadcasts log lines over Socket.IO directly to the web dashboard's terminal drawer.
   - For multi-site batches, the console features a **Fleet Nodes Tab Bar**, allowing administrators to switch between live node output streams seamlessly.

---

## 11. How the 3-Team Approval Governance Gate Works

To ensure safe, compliant production releases, deployments enforce an enterprise **3-Team Governance Gate**:

```
                       ┌─────────────────────────┐
                       │  Deployment Triggered   │
                       │ (status: pending_appr)  │
                       └────────────┬────────────┘
                                    │
                                    ▼
       ┌────────────────────────────┼────────────────────────────┐
       │                            │                            │
       ▼                            ▼                            ▼
┌──────────────┐             ┌──────────────┐             ┌──────────────┐
│ DevOps Team  │             │Developer Team│             │ Product Team │
│   Sign-Off   │             │   Sign-Off   │             │   Sign-Off   │
└──────┬───────┘             └──────┬───────┘             └──────┬───────┘
       │                            │                            │
       └────────────────────────────┼────────────────────────────┘
                                    │
                         (3 of 3 Approvals Met)
                                    ▼
                       ┌─────────────────────────┐
                       │   Status: "pending"     │
                       └────────────┬────────────┘
                                    │
                       (Edge Agent Polls & Claims)
                                    ▼
                       ┌─────────────────────────┐
                       │   Status: "running"     │
                       └─────────────────────────┘
```

1. **User Groups & Role-Based Segregation**:
   - Users are assigned to distinct operational groups under `/users`:
     - `devops`: Infrastructure, environment, and CI/CD verification.
     - `developer`: Code review, logic validation, and schema compatibility.
     - `product`: Feature sign-off, release notes, and customer notification.
     - `management`: High-level oversight.

2. **Agent Isolation (Zero-Execution Before Approval)**:
   - When triggered, deployments are created in `status: "pending_approval"`.
   - Edge site agents poll for jobs with `status: "pending"`.
   - **Result**: Remote servers cannot claim or execute any code until all mandatory approvals are locked in.

3. **Step-by-Step Approval Protocol**:
   - Each team submits sign-off via `POST /api/v1/deployments/{id}/approve` (or 1-click fleet batch approval via `/batch/{batch_id}/approve`).
   - Duplicate approvals from the same team are rejected with HTTP 400.
   - Approver email, user ID, timestamp, and optional sign-off notes are permanently recorded in the deployment record.
   - When the 3rd distinct team approves (3/3), status automatically transitions to `pending` and emits `deployment_status`, immediately unlocking the job for edge site agents.

4. **Rejection Handling**:
   - Any authorized team member can reject a deployment via `POST /api/v1/deployments/{id}/reject` with a mandatory reason.
   - The deployment transitions to `status: "rejected"`, alerting all teams and completely terminating execution.

---

## 12. How the Template Library & Automated Propagation Work

Located under `/templates` (restricted to Administrators and Super Admins), the **Template Library** allows teams to standardize infrastructure and telemetry definitions with zero manual site-by-site maintenance:

1. **Agent Runtime Templates**:
   - Define reusable configurations for remote site agents, including monitoring intervals, timeout limits, retry policies, config polling frequencies, and ICMP ping target device lists.
   - **Automated Fleet Propagation**: When any runtime template is edited, the central hub automatically identifies all servers linked to that template and updates their runtime configurations in `server_configs`, emitting realtime events. Remote site agents automatically receive the updated intervals and targets on their next 5s poll without requiring manual site-by-site re-application.
   - **Fleet Sync ("Sync All")**: A 1-click action pushes any runtime template across the entire fleet (`POST /api/v1/agent-config-templates/{id}/apply-all`).

2. **Custom Widget Templates**:
   - Define standardized MongoDB telemetry widgets: database name, collection, timestamp field, group-by keys, polling intervals, and widget-specific integration failure alert thresholds.
   - **Automated In-Place Updates**: When a custom widget template is modified, all servers currently configured with that widget have their database, collection, query grouping, poll frequencies, and alert thresholds updated in-place automatically.
   - **Fleet Sync ("Sync All")**: A 1-click action deploys or updates any widget template across all active site servers in the fleet (`POST /api/v1/widgets/templates/{id}/apply-all`).

---

## 13. How the Master Server Monitoring Works

Located under `/master-server` on the main navigation bar, the **Master Server** dashboard provides complete operational visibility and maintenance controls for the central infrastructure hosting OcTyn DevOps Services:

1. **Host & Operating System Resources**:
   - Live host CPU utilization percentage, 1m/5m/15m load averages, and per-core CPU load bars.
   - Physical memory (RAM) allocation, available memory, and swap space.
   - Root disk and mounted partition storage tables.
   - Network I/O counters (bytes sent / received) and active network interface IPs.

2. **FastAPI Application Process Telemetry**:
   - Monitors the primary backend process: PID, memory RSS, active thread count, and uptime.
   - Tracks live Socket.IO connection sessions and room counts.
   - Inspects the local agent release distribution file (`agent_lite.py` / `agent.tar.gz`).

3. **MongoDB Storage & 7-Day Retention Telemetry**:
   - Measures live database ping latency in milliseconds.
   - Visualizes database data size, allocated disk storage, and index size.
   - Features a comprehensive collection breakdown table detailing document counts, data sizes, storage sizes, index counts, and active 7-day TTL expiration policies (`recorded_at`, `received_at`, `created_at`).

4. **On-Demand Disk Space Reclamation**:
   - Administrators can trigger an on-demand retention sweep and collection compaction (`POST /api/v1/master-server/cleanup`) directly from the UI.
   - Prunes metrics, configs, and logs older than the retention period (default 7 days) and runs MongoDB collection compaction (`compact`) to return filesystem space back to disk.


