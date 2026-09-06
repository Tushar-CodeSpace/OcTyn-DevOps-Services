# OcTyn DevOps Services — Agent Guidance & Project Reference (`AGENT.md`)

Welcome! This document provides complete architectural context, directory structures, data models, command references, and development guidelines for AI coding agents and human developers working on **OcTyn DevOps Services**.

---

## 1. Project Overview & Core Architecture

**OcTyn DevOps Services** is a centralized continuous monitoring (CM) and site infrastructure management platform designed for tracking multiple client sites, servers, services, device connectivity, and alerts from a single unified dashboard.

```
┌─────────────────────┐        ┌──────────────────────────────────────────┐
│ Monitored server(s) │        │            Central server                │
│                     │  HTTP  │ ┌────────┐   ┌──────────┐   ┌─────────┐  │
│  ┌──────────────┐   │ ─────► │ │  nginx │──►│  FastAPI │──►│ MongoDB │  │
│  │ cm-agent     │──┼─X-API-Key│ │ (SPA)  │   │  backend │   │   7.0   │  │
│  │ (Python)     │   │        │ └────────┘   │ /api/v1  │   └─────────┘  │
│  └──────────────┘   │        │  React SPA   │          │   JSON logs   │
│                     │        │  (Recharts)  └──────────┘   └─────────┘  │
└─────────────────────┘        └──────────────────────────────────────────┘
```

### Key Concepts
- **Sites**: Physical or customer locations (e.g. `samsonite_nashik`, `meesho_faridhabad`).
- **Servers**: Monitored machines associated with a site.
- **Agents**: Lightweight Python agents running on monitored servers (`agent/` modular package or `agent_lite.py` single file).
- **Backend**: FastAPI web server with Socket.IO realtime events and MongoDB storage.
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS 4 single page application.

---

## 2. Workspace Directory Structure

```
octyn_watcher/
├── agent/                      # Monitoring agent implementation
│   ├── pyproject.toml          # Package config & uv dependencies
│   ├── main.py                 # Entrypoint script
│   ├── octyn.service           # Sample systemd unit file
│   ├── Dockerfile              # Agent Docker build file
│   ├── agent_lite.py           # Zero-dependency single-file agent
│   └── agent/                  # Modular Python package
│       ├── __init__.py         # Package init
│       ├── config.py           # Settings & dynamic hub configuration state
│       ├── transport.py        # HTTP client (httpx + urllib fallback)
│       ├── collectors/         # Metrics & service status collectors
│       │   ├── metrics.py      # System metrics (CPU, Memory, Disk, Network, Disk I/O, Uptime, IP)
│       │   └── services.py     # TCP port service checker
│       ├── connectivity.py     # Realtime ICMP ping target poller
│       ├── terminal.py         # Super-admin terminal runner with stateful CWD tracking
│       ├── mongo_backup.py     # Site MongoDB snapshot backup & BSON serializer
│       ├── runner.py           # Main monitoring loop & background config poller
│       └── app.py              # Application CLI entrypoint
├── backend/                    # FastAPI backend service
│   ├── app/
│   │   ├── config/             # Pydantic settings & environment configuration
│   │   ├── database/           # PyMongo client, models, index creation
│   │   ├── routes/             # API endpoints (health, auth, sites, servers, metrics, terminal, etc.)
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── services/           # Background loop, alert evaluator, notifications, monitoring
│   │   └── main.py             # FastAPI & Socket.IO app instance
├── frontend/                   # React SPA
│   ├── src/
│   │   ├── components/         # Layout, StatusBadge, GlobalSearch, UI components
│   │   ├── pages/              # Dashboard, ServerDetail, Terminal, Users, AuditLogs, etc.
│   │   ├── lib/                # API client, Socket.IO client, Auth hook, Types
│   │   ├── App.tsx             # Main router & page routes
│   │   └── index.css           # Tailwind 4 styling system
├── database/
│   └── init/mongo/001-init.js  # First-boot Mongo initialization & index creation
├── docs/                       # Project documentation
│   └── DEPLOYMENT.md           # Production deployment guide
├── scripts/                    # Utility scripts
│   └── seed.py                 # Database seed script
├── docker-compose.yml          # Full stack Docker orchestrator
└── README.md                   # Project README
```

---

## 3. Core Data Models & API Surface

### Authentication Rules
1. **Dashboard Users**: Authenticate with email/password to receive a JWT Bearer token (`POST /api/v1/auth/login`). Passed in `Authorization: Bearer <token>`.
2. **Agents**: Authenticate using per-server API Keys passed in the `X-API-Key` header. Only SHA-256 hashes are stored in the database.

### API Endpoints
| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `/health` | None | Liveness check |
| `POST` | `/api/v1/auth/login` | None | Dashboard user login -> JWT |
| `GET` | `/api/v1/auth/me` | JWT | Current user profile |
| `GET/POST` | `/api/v1/sites` | JWT | Site CRUD |
| `GET/POST` | `/api/v1/servers` | JWT | Server CRUD |
| `POST` | `/api/v1/metrics` | API Key | Agent metric ingestion |
| `GET` | `/api/v1/metrics/servers/{id}` | JWT | Historical metrics |
| `POST` | `/api/v1/services` | API Key | Service status reports |
| `GET` | `/api/v1/servers/{id}/services` | JWT | Service status overview |
| `GET` | `/api/v1/alerts` | JWT | Active & resolved alerts |
| `POST` | `/api/v1/terminal/{id}/commands` | JWT (SuperAdmin) | Queue terminal command |
| `GET` | `/api/v1/terminal/poll` | API Key | Agent claims queued command |
| `POST` | `/api/v1/terminal/result` | API Key | Agent streams command output |

---

## 4. How to Run Services Locally

### Prerequisites
- Python 3.10+ with `uv`
- Node.js 20+
- MongoDB 7.0 (via Docker)

### Step-by-Step Commands
```bash
# 1. Start MongoDB database
docker compose up -d mongodb

# 2. Seed initial demo data
uv run --project backend scripts/seed.py

# 3. Start Backend Server (runs on http://0.0.0.0:8000)
cd backend
uv run uvicorn app.main:socket_app --host 0.0.0.0 --port 8000

# 4. Start Frontend Dev Server (runs on http://localhost:5173)
cd frontend
npm run dev

# 5. Run Modular Agent (from agent/ directory)
cd agent
uv run agent
```

---

## 5. Technical Guidelines & Feature Specifics

### Terminal & Interactive Web SSH
- The terminal prompt is rendered in green (`text-emerald-400`) as `root@<hostname> $ `.
- Trailing space is required after `$`.
- Working directory state (`_TERMINAL_CWD`) is preserved across commands (`cd /`, `cd /home`, `cd ..`).
- Single <kbd>Tab</kbd> press performs command/path autocompletion and outputs available options directly to the terminal output stream when multiple matches exist.
- Signal group handling handles `Ctrl+C` cancellation (`SIGINT`/`SIGKILL`).

### Agent Configuration & Monitored Services
- Only `SERVER_ID`, `API_URL`, and `API_KEY` are placed in `agent/.env`.
- All other monitoring settings (intervals, monitored services, ICMP ping targets) are dynamically pulled from the hub on boot (`fetch_agent_config()`).
- If `monitored_services` is blank/empty, **no services are monitored by default** (returns empty list `[]`).

### UI & Styling Standards
- Primary styling uses Tailwind CSS 4 with custom dark mode theme (`bg-black`, `text-emerald-300`, `text-slate-200`).
- **Device Connectivity**: Device status tiles are formatted as small, space-efficient, responsive grid cards showing glowing status indicators, host name, latency, IP, and timestamp.

---

## 6. Automated Agent CI/CD & Remote Update System

For step-by-step agent deployment on remote site servers, see the [Remote Site Agent Deployment Guide](file:///d:/octyn_watcher/docs/AGENT_DEPLOYMENT.md).

When changes are pushed to GitHub (`main`), the CI/CD pipeline ([`.github/workflows/cicd.yml`](file:///d:/octyn_watcher/.github/workflows/cicd.yml)) automatically updates both the Central Hub and remote site agents:

1. **GitHub Action Deploy**: Builds and deploys the backend server, storing the new release SHA.
2. **Release Endpoints**:
   - `GET /api/v1/agent/release`: Returns active release SHA256 checksum and download URLs.
   - `GET /api/v1/agent/download/lite`: Serves the updated [`agent_lite.py`](file:///d:/octyn_watcher/agent/agent_lite.py) script.
   - `POST /api/v1/agent/trigger-update`: Triggers an instant update check for remote agents.
3. **Remote Agent Auto-Update**:
   - Remote site agents query `GET /api/v1/agent/release` during their execution loop.
   - If a checksum mismatch is detected, the agent safely downloads the new version, verifies Python syntax (`py_compile`), replaces itself, and exits cleanly (`sys.exit(0)`).
   - Systemd ([`octyn.service`](file:///d:/octyn_watcher/agent/octyn.service) with `Restart=always`) automatically restarts the agent running the updated code.
