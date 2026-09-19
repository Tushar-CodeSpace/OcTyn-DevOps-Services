# OcTyn DevOps Services — AI Agent Guidance & Project Reference (`AGENTS.md`)

This file is the primary guidance document for AI Agents (Antigravity, Cursor, Windsurf, Claude Code, Copilot, etc.) working on **OcTyn DevOps Services**.

For the detailed complete guide, see [AGENT.md](file:///d:/octyn_watcher/AGENT.md), [docs/HOW_IT_WORKS.md](file:///d:/octyn_watcher/docs/HOW_IT_WORKS.md), and [docs/ARCHITECTURE.md](file:///d:/octyn_watcher/docs/ARCHITECTURE.md).

---

## Quick Navigation & Architecture Map

- **Project Name**: OcTyn DevOps Services (Sidebar display: `OcTyn DevOps`)
- **Backend**: FastAPI + Socket.IO + PyMongo (`backend/app/`)
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS 4 (`frontend/src/`)
- **Agent**: Modular Python package (`agent/agent/`) & single-file (`agent/agent_lite.py`)

---

## Critical Execution & Architectural Rules

1. **Agent `.env` Minimal Configuration**:
   The agent `.env` file (`agent/.env`) strictly contains only:
   ```env
   SERVER_ID=server_<id>
   API_URL=http://<central-server-ip>:8000
   API_KEY=octyn_agent_<key>
   ```
   All monitoring settings (intervals, monitored services, ICMP targets) are fetched dynamically from central hub on boot.

2. **Monitored Services Default**:
   If `monitored_services` is blank or empty (`[]`), **no default TCP services are monitored**.

3. **Terminal / Web SSH**:
   - Prompt format: `root@<hostname> $ ` in green (`text-emerald-400`). Notice the trailing space after `$`.
   - Maintain working directory (`_TERMINAL_CWD`) state across execution requests (`cd /`, `cd /home`, `cd ..`).
   - Single <kbd>Tab</kbd> press handles autocompletion and outputs suggestions directly to the output stream.

4. **Device Connectivity**:
   - Device connectivity status pills on Server Detail are compact, responsive cards (`grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6`).

5. **Agent CI/CD Auto-Updates**:
   - Remote site agents check `GET /api/v1/agent/release` on the Central Server. When code is pushed to GitHub `main`, central deployment triggers an update notification (`POST /api/v1/agent/trigger-update`), causing remote site agents to self-download the new release, compile-check (`py_compile`), replace themselves, and exit cleanly so systemd auto-restarts them.

6. **MongoDB URI Percent-Encoding**:
   - Connection strings containing special characters in username/password (such as `@` in `nido@123`) must be percent-encoded to `nido%40123` using `_encode_uri_password()` before passing to PyMongo to prevent `pymongo.errors.InvalidURI`.

7. **Instant Config Backup Triggering (`trigger_sync_id`)**:
   - Clicking **"Test Connection & Run Backup Now"** calls `POST /api/v1/configs/servers/{server_id}/test-backup`, which sets `trigger_sync_id` and `force_update`. Site agents receive `trigger_sync_id` via their 5s config poller, log `[TRIGGER] Hub requested immediate config backup`, and execute `sync_configs()` in a background thread. Frontend polls for 25s with an animated spinner until snapshot arrival.

8. **7-Day Memory & Disk Space Retention**:
   - Memory and disk space retention default is **7 days** (`metrics_retention_days = 7`).
   - Native 7-day TTL indexes (`expireAfterSeconds = 604800`) are active on `metrics` (`recorded_at`), `site_configs` (`received_at`), and `terminal_commands` (`created_at`).
   - Run manual disk space reclamation on server via:
     ```bash
     uv run --project backend scripts/cleanup.py --days 7
     ```
     This prunes 7-day old records and executes MongoDB collection compaction (`compact`).

9. **Per-Client & Per-Site Alert Controls**:
   - Admin and Super Admin users can toggle alerts at Client level (`PATCH /api/v1/sites/clients/{client_name}/alerts`) or Site level (`PATCH /api/v1/sites/{site_id}`). Evaluator (`alerts.py`) and Notifier (`notifier.py`) enforce both settings.

10. **Widget-Specific Integration Failure Alerts & Deploy Grace Periods**:
    - Integration failure threshold (`alert_threshold_percent: 50%`) and window (`alert_window_minutes: 15m`) are configured **per-widget** under Custom Data Widgets on Server Detail, not globally.
    - Central server CI/CD deployments and agent auto-updates enforce a **180s grace period** (`master_deploy_grace_seconds` & `is_agent_update_in_progress`) to eliminate false-positive "Server is offline" alerts.

11. **Site MongoDB Config Backup Resiliency**:
    - Agent tests candidate hosts (`localhost`, `127.0.0.1`, `host.docker.internal`, `172.17.0.1`), tries `directConnection=True` and fallback, with a 4s timeout.
    - If custom site databases do not match the default 10 OcTyn names, the agent auto-discovers all non-system databases (`user_dbs`) and backs up all collections.

12. **API Prefix Auto-Normalization**:
    - Backend middleware automatically rewrites redundant `/api/v1/api/v1/` prefixes to `/api/v1/` to prevent 404s when tools or users include `/api/v1` in their base domain.

13. **Software Deployments & 3-Team Approval Governance Gate**:
    - Software deployments start in `pending_approval` status with `approval_required_groups: ["devops", "developer", "product"]`.
    - Edge site agents poll for `status: "pending"`, ensuring remote servers are strictly blocked from claiming or running unapproved code.
    - Exactly **3 distinct team approvals** are mandatory before execution:
      1. One **DevOps Team** user (`user_group: devops`)
      2. One **Developer Team** user (`user_group: developer`)
      3. One **Product Team** user (`user_group: product`)
    - Duplicate team approvals are rejected with HTTP 400. Once all 3 teams approve, status automatically transitions to `pending`, unlocking the job for edge agent execution.
    - Endpoints support single deployment approval (`POST /api/v1/deployments/{id}/approve`), fleet-wide batch approval (`POST /api/v1/deployments/batch/{batch_id}/approve`), and rejection (`/reject`).
    - User accounts support `user_group: devops | developer | product | management` managed under `/users`.

14. **Template Library Management (`/templates`) & Automated Fleet Propagation**:
    - Dedicated management interface accessible strictly to Admin and Super Admin accounts to create, edit, duplicate, and delete reusable **Agent Runtime Templates** and **Custom Widget Templates**.
    - Modifying any template automatically updates all linked site servers in `db.server_configs()` and emits realtime sync events so agents pick up changes dynamically without manual site-by-site intervention.
    - Supports 1-click fleet synchronization ("Sync All") to deploy or update templates across all servers simultaneously.

15. **Server Agent Execution Logs (`/servers/:id` Logs Tab)**:
    - Dedicated **Logs** tab on Server Detail alongside Overview, Services, Widgets, Backups, and Keys.
    - Site agents buffer runtime logs in a thread-safe ring buffer and stream them during 10s metric heartbeats.
    - Features live streaming (5s auto-refresh), severity filtering (All, Info, Warning, Error), text search, and on-demand host systemd journal inspection (`POST /api/v1/servers/{server_id}/logs/journal` running `journalctl -u octyn.service`).

16. **Master Logs & Automatic Alert Resolution**:
    - Main navigation displays **Master Logs** (`/alerts`).
    - Alerts automatically resolve in real time when underlying system conditions recover (heartbeats resume, CPU/RAM/Disk/error metrics fall below thresholds, services restart, or stale conditions clear). No manual resolution action is required.


---

## How to Run Services

```bash
# 1. Start MongoDB
docker compose up -d mongodb

# 2. Seed Database
uv run --project backend scripts/seed.py

# 3. Start Backend API & Realtime Server
cd backend && uv run uvicorn app.main:socket_app --host 0.0.0.0 --port 8000

# 4. Start Frontend SPA
cd frontend && npm run dev

# 5. Start Agent (uv entrypoint)
cd agent && uv run agent

# 6. Run Disk Space Retention Cleanup & MongoDB Compaction
uv run --project backend scripts/cleanup.py --days 7
```

Refer to [AGENT.md](file:///d:/octyn_watcher/AGENT.md) and [docs/HOW_IT_WORKS.md](file:///d:/octyn_watcher/docs/HOW_IT_WORKS.md) for complete details.
