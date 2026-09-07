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
