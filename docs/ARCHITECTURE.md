# OcTyn DevOps Services — Architecture Documentation

This document describes the high-level architecture, data flows, background processes, and component interactions of **OcTyn DevOps Services**.

---

## High-Level System Architecture

```
                       ┌─────────────────────────────────────────┐
                       │          OcTyn DevOps Services          │
                       │             Central Server              │
                       │                                         │
┌──────────────────┐   │   ┌───────────┐         ┌───────────┐   │
│ Monitored Host A │   │   │           │────────►│  FastAPI  │   │
│ ┌──────────────┐ │   │   │   Nginx   │         │  Backend  │   │
│ │ cm-agent     │─┼───┼──►│ Reverse   │◄───────►│ Socket.IO │   │
│ └──────────────┘ │   │   │   Proxy   │         └─────┬─────┘   │
└──────────────────┘   │   └─────┬─────┘               │         │
                       │         │                     ▼         │
┌──────────────────┐   │         ▼               ┌───────────┐   │
│ Monitored Host B │   │   ┌───────────┐         │  MongoDB  │   │
│ ┌──────────────┐ │   │   │ React SPA │         │    7.0    │   │
│ │ agent_lite   │─┼───┼──►│ Dashboard │         └───────────┘   │
│ └──────────────┘ │   │   └───────────┘                     │
└──────────────────┘   └─────────────────────────────────────────┘
```

---

## Component Overview

### 1. Central Backend (FastAPI + Socket.IO)
- **Framework**: Python 3.10+, FastAPI, Socket.IO (`python-socketio`), PyMongo.
- **Role**: Ingests metrics & service status reports from agents, manages sites and servers, evaluates health alerts in the background, serves Socket.IO realtime channels (`server:<id>`), and handles terminal command dispatching.
- **Entry point**: `backend/app/main.py` (`socket_app`).

### 2. Frontend Dashboard (React + TypeScript)
- **Framework**: React 19, Vite, TypeScript, Tailwind CSS 4, Recharts, Lucide Icons.
- **Role**: Provides continuous monitoring dashboards, historical metric charts, server management, interactive web SSH/terminal, security audit logs, and runtime agent settings editing.
- **Entry point**: `frontend/src/App.tsx`.

### 3. Monitoring Agent (`agent/` & `agent_lite.py`)
- **Modular Package**: `agent/` subpackage managed with `uv` (`agent/agent/`).
- **Single-File Option**: `agent_lite.py` (zero-dependency Linux stdlib collector).
- **Functions**:
  - Collects system metrics (CPU %, Memory %, Disk %, Network B/s, Disk I/O rate/IOPS, Uptime, Primary IP).
  - Checks TCP port availability for monitored services.
  - Performs realtime ICMP ping checks on on-site device targets.
  - Pulls dynamic configuration overrides from central server on boot and runtime.
  - Polls and streams super-admin web SSH/terminal commands with stateful working directory (`_TERMINAL_CWD`) tracking and Ctrl+C process group signal control.
  - Conducts automated daily site MongoDB configuration snapshot backups.

---

## Realtime & Background Data Loops

1. **Heartbeat & Metric Ingestion**:
   - Agent collects metrics every `monitoring_interval` seconds -> `POST /api/v1/metrics`.
   - Backend updates server `last_seen_at`, updates health status (`online` < 120s, `warning` < 300s, `offline` >= 300s), and broadcasts update over Socket.IO.

2. **Background Alert Evaluator**:
   - Runs every 30 seconds (`backend/app/services/background.py`).
   - Checks CPU/RAM/Disk thresholds, server offline states, and stopped services.
   - Raises/resolves alerts idempotently and triggers optional WhatsApp notifications.

3. **Super-Admin Web SSH / Terminal Session**:
   - SuperAdmin queues command in dashboard -> `POST /api/v1/terminal/{server_id}/commands`.
   - Agent polls `GET /api/v1/terminal/poll`, claims command, and executes in `/bin/bash` with `cwd=_TERMINAL_CWD`.
   - Output chunks stream back via `POST /api/v1/terminal/result` and are broadcast to dashboard over Socket.IO.

4. **Software Deployments & Microservices Orchestration**:
   - Admin configures multi-component software templates (Node.js v24 PM2 monorepos, PHP 8.4 Nginx apps, client/machine config repos) under `/deployments`.
   - Admin triggers deployment selecting target server, components, branch overrides, client name, and machine type (`POST /api/v1/deployments/run`).
   - The deployment initializes in `pending_approval` state.
   - **3-Team Governance Gate**: Deployments require 3 distinct approvals from DevOps (`user_group: devops`), Developer (`user_group: developer`), and Product (`user_group: product`) teams before status transitions to `pending`. Site agents are strictly isolated and will not claim unapproved runs.
   - Site agent poller checks `GET /api/v1/deployments/poll`, executes environment pre-checks (Node v24 via NodeSource, PM2, PHP 8.4, Nginx), clones/pulls Git repos, imports client/machine configurations into local MongoDB, runs build scripts, and reloads PM2/Nginx.
   - Realtime stdout/stderr lines are streamed back to `POST /api/v1/deployments/{id}/stream` and broadcast live over Socket.IO to the web console drawer.

5. **Template Library Management**:
   - Centralized repository under `/templates` for reusable Agent Runtime configurations and Custom Widget definitions.
   - Admins can create, edit, duplicate, and delete templates to enforce standardization across newly registered edge nodes.

