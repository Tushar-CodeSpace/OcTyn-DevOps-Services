# OcTyn DevOps Services — AI Agent Guidance & Project Reference (`AGENTS.md`)

This file is a copy and primary reference for AI Agents (Antigravity, Cursor, Windsurf, Claude Code, Copilot, etc.) working on **OcTyn DevOps Services**.

For the detailed complete guide, also see [AGENT.md](file:///d:/octyn_watcher/AGENT.md) and [docs/ARCHITECTURE.md](file:///d:/octyn_watcher/docs/ARCHITECTURE.md).

---

## Quick Navigation & Architecture Map

- **Project Name**: OcTyn DevOps Services (Sidebar display: `OcTyn DevOps`)
- **Backend**: FastAPI + Socket.IO + PyMongo (`backend/app/`)
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS 4 (`frontend/src/`)
- **Agent**: Modular Python package (`agent/agent/`) & single-file (`agent/agent_lite.py`)

---

## Critical Execution & Configuration Rules

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
```

Refer to [AGENT.md](file:///d:/octyn_watcher/AGENT.md) for complete details.
