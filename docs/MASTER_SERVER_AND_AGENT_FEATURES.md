# OcTyn DevOps Services — Master Server & Agent Features Guide

A complete, in-depth architectural and operational guide covering all features of the **OcTyn DevOps Services** central infrastructure and edge monitoring agents.

---

## 1. Executive Summary & Core Topology

OcTyn DevOps Services is an enterprise-grade IoT & infrastructure observability, automated configuration backup, and software deployment platform designed for distributed industrial facilities (conveyor systems, sortation hubs, dimensioning/weighing stations).

### The Topology:
- **Central Master Hub**: FastAPI + Socket.IO + PyMongo, running on central infrastructure.
- **Frontend SPA**: React 19 + TypeScript + Tailwind CSS 4, delivering live streaming dashboards, Web SSH, and deployment governance.
- **Edge Site Agents**: Dual-mode agents deployed at remote industrial locations:
  1. **Single-File Agent (`agent_lite.py`)**: Standalone script with zero external dependencies, running under Linux `systemd` (`octyn.service`).
  2. **Modular Docker Agent (`agent/agent/` & `Dockerfile`)**: Containerized packaging running via `python -m agent.app`.
  Both agents operate at the **exact same capability level**, sharing identical telemetry, backup, widget, deployment, and terminal protocols.

---

## 2. Master Server Hub Features

### 2.1 Slaves (Fleet Dashboard)
- **Fleet-Wide Status Matrix**: Live overview of all connected edge nodes across sites, categorizing servers into `Online`, `Warning`, `Offline`, or `Unknown`.
- **Client & Site Filtering**: Filter servers by client organization, location, or health status.
- **Auto-Calculated Summary Counters**: Total edge nodes, active sites, online percentages, active alerts, and offline warning states.

### 2.2 Server Detail Workspace (`/servers/:id`)
Comprehensive management interface with 6 specialized tabs:
1. **Overview**: Real-time gauge cards for CPU, Memory, Disk space, Network transfer rates, and System load averages. Includes interactive historical time-series charts (1h, 6h, 24h, 7d, 30d).
2. **Services & Connectivity**:
   - Monitored TCP services with latency and live up/down pills.
   - On-site device connectivity targets (PLCs, barcode scanners, digital scales) with automated warning alerts and recovery resolution.
3. **Widgets**: Custom Data Widgets displaying live periodic MongoDB count aggregations, breakdown tables, failure thresholds, and Include/Exclude key filters.
4. **Backups**: Historical timeline of site MongoDB configuration snapshots, document counts, collection breakdown, and 1-click **"Test Connection & Run Backup Now"** trigger.
5. **Keys**: Active per-server agent API keys management (`X-API-Key`) with creation, revocation, and last used timestamps.
6. **Logs**: Real-time buffered execution logs streamed from the agent, text search, severity filter pills, and on-demand host systemd journal inspection (`journalctl -u octyn.service`).

### 2.3 Master Server Hub Telemetry (`/master-server`)
Dedicated management interface for central infrastructure operations:
- **Host Infrastructure Telemetry**: Real-time CPU (total and per-core breakdown), RAM (used/total/swap), and Root Disk usage.
- **FastAPI Process Health**: Process PID, active OS threads, memory RSS utilization, and connected Socket.IO client connections.
- **MongoDB Telemetry & Collection Breakdown**:
  - Live ping latency.
  - Total allocated database storage vs index size.
  - Interactive collection breakdown table displaying document counts, collection sizes, and active 7-day TTL index policies.
- **1-Click Retention Compaction**: "Run Retention Cleanup & Compact" executes automated pruning of records older than 7 days and invokes native MongoDB collection compaction (`compact`).

### 2.4 All Slave Logs & Automatic Incident Resolution (`/alerts`)
- **Central Incident Log**: Aggregates all system warnings, critical alerts, service disruptions, and connectivity failures across all edge nodes in real time.
- **Zero-Touch Auto-Resolution**: When the underlying condition recovers (e.g. agent heartbeats resume, RAM usage falls below 90%, ping test succeeds, or service restarts), alerts are **automatically resolved** and recorded as recovery events without manual user intervention.

### 2.5 Software Deployments & 3-Team Governance Gate (`/deployments`)
- **Multi-Component Software Stacks**: Define deployment targets consisting of:
  - Node.js v24 Monorepos running under PM2.
  - PHP 8.4 Nginx web services.
  - Client & machine-specific MongoDB configuration repositories.
- **Strict 3-Team Approval Governance**:
  - Deployments start in `pending_approval` status.
  - Remote site agents poll only for `pending` status and are strictly locked from claiming jobs.
  - Mandatory approvals required from **3 distinct team groups**:
    1. One **DevOps Team** member (`user_group: devops`)
    2. One **Developer Team** member (`user_group: developer`)
    3. One **Product Team** member (`user_group: product`)
  - Duplicate team approvals are rejected with HTTP 400. Once all 3 teams approve, status transitions to `pending`, unlocking the job for edge execution.
- **Live Terminal Log Streaming**: Site agents stream execution output line-by-line via Socket.IO, displaying colorized terminal output in real time.

### 2.6 Template Library & Site-Scoped Synchronization (`/templates`)
- **Reusable Templates**: Create and maintain standardized **Agent Runtime Templates** (monitoring intervals, ping targets, TCP services) and **Custom Widget Templates** (database, collection, group-by, include/exclude filters).
- **Used-by-Sites Tracking**: Templates automatically display the exact client sites, location codes, and edge nodes currently using them.
- **Site-Scoped Propagation**: When a template is linked to specific sites (e.g. Site B and Site Y), modifications synchronize strictly to servers located within those sites. Other servers remain untouched.
- **Equipment Names Visibility**: Site selection checklists display the discovered equipment name(s) (e.g. `Nashik Conveyor 01`) with `<Cpu>` badges for instant recognition.

### 2.7 Multi-Channel Notifications (`/whatsapp`)
- Centralized WhatsApp alerting integration via Twilio / UltraMsg / Meta Cloud API.
- Multi-line alerts providing full context: Site organization, location, equipment name, severity, and exact metric or ping failure reason.
- Per-client and per-site alert silencing controls.

---

## 3. Edge Agent Features & Operational Subsystems

Both `agent_lite.py` and the modular agent container (`agent/agent/`) possess identical feature sets:

### 3.1 Bootstrap Configuration & Hub Dynamic Polling
- **Minimal `.env`**: Remote agents strictly require only 3 bootstrap parameters:
  ```env
  SERVER_ID=server_<id>
  API_URL=http://<central-server>:8000
  API_KEY=cm_<key>
  ```
- **5-Second Dynamic Poller**: Edge agents run a background thread polling `GET /api/v1/agent/config` every 5 seconds. All operational settings (monitoring intervals, ICMP targets, services, custom widgets) are pulled dynamically from the central hub. Changes in the dashboard take effect on edge machines within 5 seconds without restarting the agent.

### 3.2 System Telemetry Ingestion (10s Beat)
- Runs every 10 seconds, gathering:
  - CPU total percentage and core counts.
  - RAM utilization (used, available, total, swap).
  - Root Disk capacity and utilization percentage.
  - Network throughput (RX/TX KB/s rates).
  - Disk IO read/write rates.
  - Active process count and host uptime.
- In `agent_lite.py`, metrics are read directly from Linux `/proc` filesystem (`/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, `/proc/diskstats`), guaranteeing zero external dependencies.

### 3.3 Thread-Safe Execution Log Streaming
- In-memory ring buffer capturing up to 500 lines of agent execution logs.
- Classifies log entries into `info`, `warning`, and `error`.
- Attaches pending logs to the 10-second metric heartbeat payload, where the hub ingests and indexes them for real-time dashboard inspection.

### 3.4 Monitored TCP Services Probe
- Conducts non-blocking TCP socket connection probes against user-configured `monitored_services` (`<name>:<port>`).
- Measures connect latency in milliseconds.
- **Default Policy**: If `monitored_services` is empty (`[]`), no default ports are probed.

### 3.5 Hardware Device Connectivity (ICMP Ping Targets)
- Pulls `connectivity_targets` (`[{"name": "PLC-1", "ip": "192.168.1.50"}]`) from the hub.
- Executes native OS ping commands in a background thread every 15 seconds.
- Pushes results to `POST /api/v1/connectivity`.
- Automatically escalates unreachable devices to `warning` alerts and resolves them upon recovery.

### 3.6 Custom Data Widgets with Plain Key & Arbitrary Field Path Filtering
- Periodically runs user-configured MongoDB count aggregations on the site database.
- **Dual Include / Exclude Filter Syntax**:
  - **Plain Values**: (e.g. `SKIPPED, PENDING`) targets the configured `group_by_field`.
  - **Arbitrary Field Conditions**: (e.g. `rejection_data.display_rejection: PSTR`, `where rejection_data.display_rejection: PSTR`, or `rejection_data.display_rejection = PSTR`) allows excluding or including counts based on any nested document path.
- **Candidate Type Coercion**: Automatically coerces user input strings into typed candidates (e.g. `"200"` expands to `"200"` and `200`; `"true"` expands to `True`; `"null"` expands to `None`), preventing count drops due to MongoDB data type mismatches.
- Constructs MongoDB query `$match` with `$in` for include conditions and `$nin` for exclude conditions, followed by strict post-filtering on `groups` for conditions targeting the `group_by_field`.
- Pushes results to `POST /api/v1/widgets`.

### 3.7 Site MongoDB Config Backup & Instant Trigger Sync
- **Resilient MongoDB Connection**: Tests candidate connection URIs (`localhost`, `127.0.0.1`, `host.docker.internal`, `172.17.0.1`), percent-encodes URI passwords containing special characters (`@`), and tries both direct and replica connection modes with a 4s timeout.
- **Automatic DB Discovery**: If site collections do not match standard default names, the agent auto-discovers all non-system databases (`user_dbs`) and backs up all collections up to 50,000 documents per collection.
- **Instant Backup Trigger (`trigger_sync_id`)**: On the 5s config poll, if `trigger_sync_id` is detected, the agent immediately logs `[TRIGGER] Hub requested immediate config backup`, starts `sync_configs()` in a background thread, and uploads the snapshot to the hub.

### 3.8 Software Deployment Execution Engine
- Background thread polls `GET /api/v1/deployments/poll` every 5 seconds.
- When an approved deployment is claimed, executes sequential stages:
  1. **PRECHECK**: Validates Git, Node.js v24, PM2, PHP, Nginx availability, auto-installing missing packages if needed.
  2. **GIT**: Clones or updates Git repositories on configured branches.
  3. **CONFIG**: Clones client and machine-specific configurations and executes import scripts.
  4. **BUILD_RUN**: Runs build scripts and restarts PM2 or systemd services.
- Streams each output line to `POST /api/v1/deployments/{id}/stream` and reports completion to `/finish`.

### 3.9 Interactive Web SSH Terminal & Nano Editor Bridge
- Polls `GET /api/v1/terminal/poll` every 1 second.
- **Stateful Directory Tracking**: Maintains working directory state (`_TERMINAL_CWD`) across commands using temporary file evaluation (`pwd > {cwd_file}`).
- **Nano File Editor Bridge**: When `nano`, `vim`, `vi`, or `micro` commands are issued, the agent reads the target file and returns an `OCTYN_NANO_EDIT` payload, enabling the browser to display a full graphical code editor modal. Saving in the browser writes the file back via the terminal.
- **Ctrl+C Interruption**: Periodically checks `GET /api/v1/terminal/commands/{id}/status` during long-running commands, terminating process groups immediately if cancelled by the user.

### 3.10 CI/CD Self-Updating Engine
- Polls `GET /api/v1/agent/release` on the Central Server.
- When code is pushed to GitHub `main` or an update is triggered via `POST /api/v1/agent/trigger-update`, remote agents detect the checksum mismatch, download the release to `.tmp`, verify bytecode compilation (`py_compile`), replace their own executable file, and exit with code 0.
- Systemd automatically restarts the service (`Restart=always`), bringing the agent up on the new version with zero downtime.

---

## 4. Agent Parity Checklist

Both `agent_lite.py` and the modular agent container (`agent/agent/`) are verified at identical capability levels:

| Capability | Single-File (`agent_lite.py`) | Modular Agent Container (`agent/agent/`) |
| :--- | :---: | :---: |
| Native Metrics Telemetry (10s Beat) | Supported | Supported |
| Log Ring Buffer Streaming | Supported | Supported |
| TCP Services Probing | Supported | Supported |
| Hardware Ping Connectivity | Supported | Supported |
| 5s Dynamic Config Poller | Supported | Supported |
| Instant Config Backup Trigger | Supported | Supported |
| Site MongoDB Snapshots & User DB Discovery | Supported | Supported |
| Custom Widgets with `$in`/`$nin` Coercion | Supported | Supported |
| Software Deployment Engine & Streaming | Supported | Supported |
| Web SSH Terminal & Nano Editor Bridge | Supported | Supported |
| CI/CD Auto-Updater Check | Supported | Supported |
| Default Monitoring Interval | **10 seconds** | **10 seconds** |
