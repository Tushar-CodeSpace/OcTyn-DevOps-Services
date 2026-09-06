# OcTyn DevOps Services - Backend (FastAPI)

FastAPI API for the OcTyn DevOps Services platform.

## Run locally (dev)

```bash
cp .env.example .env   # fill real values
uv run uvicorn app.main:socket_app --reload --port 8000
```

Open http://localhost:8000/docs for the interactive API docs.

## Structure

```
app/
├── main.py          # FastAPI app entrypoint
├── config/          # settings (pydantic-settings)
├── database/        # MongoDB connection + document helpers
├── schemas/         # request/response models
├── routes/          # API routes (health, sites, servers, metrics, ...)
└── services/        # business logic (monitoring, authentication, alerts)
```

## Health check

`GET /health` → `{"status": "ok"}`

## Agent configuration endpoints

Agents are thin: they `GET /api/v1/agent/config` (agent-authenticated) on boot
and then every `config_poll_interval_seconds` via a background poller. The
backend returns the **effective** config — global defaults from
`app/config/settings.py` merged with per-server overrides stored in the
`server_configs` collection (`app/services/app_settings.py`).

Dashboard (JWT) endpoints manage those per-server overrides:

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/api/v1/agent-config/{server_id}` | effective config for a server |
| PATCH | `/api/v1/agent-config/{server_id}` | upsert partial overrides (`$set`) |
