# OcTyn DevOps Services — Full Project Map

This document provides a comprehensive component-by-component file map of **OcTyn DevOps Services** to help AI agents and developers quickly locate files and understand module responsibilities.

---

## 1. Project Directory Overview

```
octyn_watcher/
├── AGENT.md                 # Primary AI agent instructions & architecture overview
├── AGENTS.md                # Alias AI agent reference file
├── README.md                # General project documentation & setup instructions
├── docker-compose.yml       # Docker orchestrator for MongoDB, Backend, Frontend, Agent
├── docker-compose.prod.yml  # Production Docker orchestrator
├── agent/                   # Agent codebase (modular package & agent_lite single file)
├── backend/                 # FastAPI REST API & Socket.IO backend service
├── frontend/                # React SPA dashboard with Tailwind CSS 4 & Recharts
├── database/                # Database initialization scripts (Mongo 7.0 init JS)
├── docs/                    # Architecture, deployment, and project map documentation
├── scripts/                 # Maintenance and seed scripts
└── nginx/                   # Nginx web server configuration templates
```

---

## 2. Component File Breakdown

### Root Directory
- [`AGENT.md`](file:///d:/octyn_watcher/AGENT.md): Detailed AI agent reference guide, data models, and API surface.
- [`AGENTS.md`](file:///d:/octyn_watcher/AGENTS.md): Quick AI agent onboarding summary.
- [`README.md`](file:///d:/octyn_watcher/README.md): Project overview, features, quickstart, and environment setup.
- [`docker-compose.yml`](file:///d:/octyn_watcher/docker-compose.yml): Local development stack launcher.

---

### Backend (`backend/`)
- [`backend/pyproject.toml`](file:///d:/octyn_watcher/backend/pyproject.toml): Dependencies and `uv` project metadata.
- [`backend/Dockerfile`](file:///d:/octyn_watcher/backend/Dockerfile): Container build definition for backend service.
- [`backend/app/main.py`](file:///d:/octyn_watcher/backend/app/main.py): FastAPI application initialization & Socket.IO event handler integration.
- [`backend/app/config/settings.py`](file:///d:/octyn_watcher/backend/app/config/settings.py): Pydantic settings loading from `.env`.
- [`backend/app/database/connection.py`](file:///d:/octyn_watcher/backend/app/database/connection.py): PyMongo database pool connection & MongoDB index builder.
- [`backend/app/database/models.py`](file:///d:/octyn_watcher/backend/app/database/models.py): BSON / Pydantic document representations.
- [`backend/app/routes/auth.py`](file:///d:/octyn_watcher/backend/app/routes/auth.py): User login (`POST /api/v1/auth/login`) & JWT token generation.
- [`backend/app/routes/sites.py`](file:///d:/octyn_watcher/backend/app/routes/sites.py): Site CRUD operations.
- [`backend/app/routes/servers.py`](file:///d:/octyn_watcher/backend/app/routes/servers.py): Server registration, details, & configuration endpoints.
- [`backend/app/routes/metrics.py`](file:///d:/octyn_watcher/backend/app/routes/metrics.py): Agent metric submission & historical metric fetching.
- [`backend/app/routes/services.py`](file:///d:/octyn_watcher/backend/app/routes/services.py): Service monitoring report ingestion.
- [`backend/app/routes/terminal.py`](file:///d:/octyn_watcher/backend/app/routes/terminal.py): Super-admin terminal command queueing (`POST /commands`), polling (`GET /poll`), & result streaming (`POST /result`).
- [`backend/app/services/background.py`](file:///d:/octyn_watcher/backend/app/services/background.py): Alert evaluator loop & server heartbeat status checker.
- [`backend/app/services/notifier.py`](file:///d:/octyn_watcher/backend/app/services/notifier.py): WhatsApp notification dispatcher via UltraMsg API.

---

### Agent (`agent/`)
- [`agent/pyproject.toml`](file:///d:/octyn_watcher/agent/pyproject.toml): `uv` dependency file & `agent` executable console script mapping.
- [`agent/octyn.service`](file:///d:/octyn_watcher/agent/octyn.service): Sample `systemd` service unit file for background daemon deployment.
- [`agent/agent_lite.py`](file:///d:/octyn_watcher/agent/agent_lite.py): Standalone, zero-dependency Python monitoring script for restricted environments.
- [`agent/agent/config.py`](file:///d:/octyn_watcher/agent/agent/config.py): Dynamic configuration container & hub setting synchronizer.
- [`agent/agent/transport.py`](file:///d:/octyn_watcher/agent/agent/transport.py): Resilient HTTP client (`httpx` with `urllib` fallback).
- [`agent/agent/collectors/metrics.py`](file:///d:/octyn_watcher/agent/agent/collectors/metrics.py): CPU, Memory, Disk, Network rate, Disk I/O, Uptime, & IP collector.
- [`agent/agent/collectors/services.py`](file:///d:/octyn_watcher/agent/agent/collectors/services.py): TCP service port status tester.
- [`agent/agent/connectivity.py`](file:///d:/octyn_watcher/agent/agent/connectivity.py): Realtime ICMP ping targets tester.
- [`agent/agent/terminal.py`](file:///d:/octyn_watcher/agent/agent/terminal.py): Shell command runner with stateful CWD (`_TERMINAL_CWD`), single-tab autocompletion, & signal process group handling.
- [`agent/agent/mongo_backup.py`](file:///d:/octyn_watcher/agent/agent/mongo_backup.py): Automated local site MongoDB snapshot generator & BSON backup encoder.
- [`agent/agent/runner.py`](file:///d:/octyn_watcher/agent/agent/runner.py): Agent monitoring loop coordinator.
- [`agent/agent/app.py`](file:///d:/octyn_watcher/agent/agent/app.py): CLI entrypoint for `uv run agent`.

---

### Frontend (`frontend/`)
- [`frontend/package.json`](file:///d:/octyn_watcher/frontend/package.json): Vite + React 19 dependencies.
- [`frontend/src/App.tsx`](file:///d:/octyn_watcher/frontend/src/App.tsx): Application route provider & authentication wrapper.
- [`frontend/src/index.css`](file:///d:/octyn_watcher/frontend/src/index.css): Global Tailwind CSS 4 styles and dark mode color scheme.
- [`frontend/src/components/Layout.tsx`](file:///d:/octyn_watcher/frontend/src/components/Layout.tsx): Sidebar navigation with `OcTyn DevOps` branding, search, & header user state.
- [`frontend/src/components/StatusBadge.tsx`](file:///d:/octyn_watcher/frontend/src/components/StatusBadge.tsx): Status indicators (online, warning, offline, critical).
- [`frontend/src/pages/Dashboard.tsx`](file:///d:/octyn_watcher/frontend/src/pages/Dashboard.tsx): Global continuous monitoring dashboard.
- [`frontend/src/pages/ServerDetail.tsx`](file:///d:/octyn_watcher/frontend/src/pages/ServerDetail.tsx): Server detail metrics, compact Device Connectivity grid pills, and service statuses.
- [`frontend/src/pages/Terminal.tsx`](file:///d:/octyn_watcher/frontend/src/pages/Terminal.tsx): Super-admin interactive web SSH terminal interface with tab autocompletion & green prompt `root@<hostname> $ `.
- [`frontend/src/lib/api.ts`](file:///d:/octyn_watcher/frontend/src/lib/api.ts): Axios API client wrapper with JWT header interceptors.
- [`frontend/src/lib/socket.ts`](file:///d:/octyn_watcher/frontend/src/lib/socket.ts): Socket.IO realtime connection listener.

---

### Database & Scripts
- [`database/init/mongo/001-init.js`](file:///d:/octyn_watcher/database/init/mongo/001-init.js): MongoDB initial collection schema & indexing script.
- [`scripts/seed.py`](file:///d:/octyn_watcher/scripts/seed.py): Python seed script to initialize site, server, user, and alert collections.

---

### Documentation (`docs/`)
- [`docs/ARCHITECTURE.md`](file:///d:/octyn_watcher/docs/ARCHITECTURE.md): System architecture, data flow diagrams, background loops.
- [`docs/DEPLOYMENT.md`](file:///d:/octyn_watcher/docs/DEPLOYMENT.md): Production deployment guide (Docker, Nginx, Systemd).
- [`docs/PROJECT_MAP.md`](file:///d:/octyn_watcher/docs/PROJECT_MAP.md): File registry & component breakdown (this document).
