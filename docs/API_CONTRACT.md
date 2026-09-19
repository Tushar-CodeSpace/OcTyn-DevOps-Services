# OcTyn DevOps Services — API Documentation & Contract Specification

Version: **v1.0.0**  
Base URL: `http://<central-server>:8000/api/v1` (or HTTPS via reverse proxy)  
OpenAPI Interactive Docs: `http://<central-server>:8000/docs`

---

## 1. Architectural Conventions & Global Standards

### 1.1 Base URL & Prefix Auto-Normalization
- All REST endpoints are prefixed with `/api/v1`.
- **Duplicate Prefix Middleware**: The backend automatically rewrites redundant `/api/v1/api/v1/` request paths to `/api/v1/` to eliminate 404 errors when external tools or reverse proxies append a redundant prefix.

### 1.2 Date & Timestamp Formats
- All timestamps sent or returned are in **ISO 8601 UTC** with `Z` or `+00:00` suffix (e.g. `2026-09-20T03:00:00.000000Z`).
- MongoDB stores timestamps as native BSON `Date` objects.

### 1.3 Standard Response Envelope & Error Format
When an error occurs, the API returns standard HTTP error status codes (400, 401, 403, 404, 409, 422, 500) with a JSON body:
```json
{
  "detail": "Descriptive error message or validation failure details"
}
```

### 1.4 Authentication Mechanisms
The platform enforces two distinct authentication schemes depending on the caller:

1. **Dashboard User Authentication (JWT Bearer Token)**:
   - Header: `Authorization: Bearer <access_token>`
   - Generated via `POST /api/v1/auth/login`.
   - Access tokens are HMAC-SHA256 signed JWTs with expiration (default 24h).
   - Roles:
     - `admin`: Full system administrative access.
     - `super_admin`: Includes system-wide interactive terminal and audit trails.
     - `viewer`: Read-only access to metrics, dashboards, and templates.
   - User Groups (for deployment governance):
     - `devops`, `developer`, `product`, `management`.

2. **Edge Agent Authentication (Per-Server API Key)**:
   - Header: `X-API-Key: cm-<random-hex>`
   - Edge monitoring agents authenticate using dedicated per-server API keys.
   - Keys are managed under `POST /api/v1/servers/{server_id}/keys`.

---

## 2. Authentication & User Management API

### `POST /api/v1/auth/login`
Authenticate a dashboard user and issue JWT access and refresh tokens.
- **Auth**: Public
- **Request Body**:
  ```json
  {
    "username": "admin",
    "password": "password123"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "access_token": "eyJhbGciOiJIUzI1NiIsIn...",
    "token_type": "bearer",
    "expires_at": "2026-09-21T03:00:00Z",
    "user": {
      "id": "61242149-3439-43fc-a25c-20eee65d4e83",
      "email": "admin@octyn.internal",
      "name": "Central Administrator",
      "role": "super_admin",
      "user_group": "devops"
    }
  }
  ```

### `POST /api/v1/auth/refresh`
Exchange an opaque refresh token for a new short-lived access token.
- **Auth**: Public
- **Request Body**: `{"refresh_token": "<token>"}`
- **Response `200 OK`**: `{"access_token": "...", "expires_at": "..."}`

### `GET /api/v1/auth/me`
Retrieve profile and role information for the currently authenticated user.
- **Auth**: JWT Bearer (`viewer`, `admin`, `super_admin`)
- **Response `200 OK`**: User profile object.

### `POST /api/v1/auth/change-password`
Change authenticated user's password.
- **Auth**: JWT Bearer
- **Request Body**: `{"current_password": "old", "new_password": "new"}`
- **Response `200 OK`**: `{"status": "password_updated"}`

### `GET /api/v1/users`
List all registered user accounts.
- **Auth**: JWT Bearer (`admin`, `super_admin`)
- **Response `200 OK`**: List of users with roles and `user_group`.

### `POST /api/v1/users`
Create a new user account with role and group designation.
- **Auth**: JWT Bearer (`admin`, `super_admin`)
- **Request Body**:
  ```json
  {
    "email": "devops.lead@octyn.com",
    "password": "TemporarySecret2026!",
    "name": "DevOps Engineer",
    "role": "admin",
    "user_group": "devops"
  }
  ```
- **Response `201 Created`**: Created user object.

### `PATCH /api/v1/users/{user_id}`
Update user profile, role, group, or reset password.
- **Auth**: JWT Bearer (`admin`, `super_admin`)

### `DELETE /api/v1/users/{user_id}`
Delete user account.
- **Auth**: JWT Bearer (`admin`, `super_admin`)

---

## 3. Slaves / Servers Fleet Management API

### `GET /api/v1/servers`
List all monitored server edge nodes across all sites.
- **Auth**: JWT Bearer
- **Query Parameters**:
  - `site_id` (optional): Filter by site UUID.
  - `status` (optional): Filter by `online | warning | offline | unknown`.
- **Response `200 OK`**:
  ```json
  [
    {
      "id": "server_40594ba7a94d4d60",
      "site_id": "cd6d2254-59e2-4cab-9e3e-c1b43c8f30fd",
      "name": "Nashik Conveyor 01",
      "hostname": "nido-server-nashik",
      "ip_address": "192.168.1.100",
      "status": "online",
      "last_seen_at": "2026-09-20T03:00:10Z",
      "created_at": "2026-09-06T08:49:39Z",
      "updated_at": "2026-09-20T03:00:10Z"
    }
  ]
  ```

### `POST /api/v1/servers`
Register a new server and generate an initial agent API key.
- **Auth**: JWT Bearer (`admin`, `super_admin`)
- **Request Body**:
  ```json
  {
    "site_id": "cd6d2254-59e2-4cab-9e3e-c1b43c8f30fd",
    "name": "Nashik Conveyor 02",
    "hostname": "auto",
    "ip_address": null
  }
  ```
- **Response `201 Created`**: Server object including initial `agent_api_key`.

### `GET /api/v1/servers/{server_id}`
Get full server details, effective status, and hardware telemetry snapshot.
- **Auth**: JWT Bearer

### `PATCH /api/v1/servers/{server_id}`
Update server attributes (name, site assignment).
- **Auth**: JWT Bearer (`admin`, `super_admin`)

### `DELETE /api/v1/servers/{server_id}`
Decommission and delete server from fleet.
- **Auth**: JWT Bearer (`admin`, `super_admin`)

### `GET /api/v1/servers/{server_id}/keys`
List active API keys for this server agent.
- **Auth**: JWT Bearer (`admin`, `super_admin`)

### `POST /api/v1/servers/{server_id}/keys`
Create an additional API key for the agent.
- **Auth**: JWT Bearer (`admin`, `super_admin`)

### `DELETE /api/v1/servers/{server_id}/keys/{key_id}`
Revoke and delete an agent API key.
- **Auth**: JWT Bearer (`admin`, `super_admin`)

### `GET /api/v1/servers/{server_id}/logs`
Retrieve execution logs streamed by the edge agent during 10s metric heartbeats.
- **Auth**: JWT Bearer
- **Query Parameters**:
  - `limit`: Default 200 (max 1000).
  - `level`: Optional filter (`info | warning | error`).
  - `search`: Optional text search substring.
- **Response `200 OK`**:
  ```json
  [
    {
      "timestamp": "2026-09-20T03:00:00Z",
      "level": "info",
      "message": "[TRIGGER] Hub requested immediate config backup",
      "source": "agent"
    }
  ]
  ```

### `POST /api/v1/servers/{server_id}/logs/journal`
Trigger on-demand host systemd journal inspection (`journalctl -u octyn.service`).
- **Auth**: JWT Bearer (`super_admin`)
- **Request Body**: `{"lines": 100}`
- **Response `200 OK`**: `{"output": "..."}`

---

## 4. Agent Configuration & Live Runtime API

### `GET /api/v1/agent-config/servers/{server_id}`
Get effective runtime configuration for a specific server (including custom widgets and ping targets).
- **Auth**: JWT Bearer

### `PUT /api/v1/agent-config/servers/{server_id}`
Update server runtime configuration. Automatically bumps config version and notifies agent via 5s config poller.
- **Auth**: JWT Bearer (`admin`, `super_admin`)
- **Request Body**:
  ```json
  {
    "monitoring_interval_seconds": 10,
    "http_timeout_seconds": 10,
    "http_retry_count": 3,
    "config_poll_interval_seconds": 5,
    "connectivity_poll_interval_seconds": 15,
    "monitored_services": ["nginx:80", "postgresql:5432"],
    "connectivity_targets": [
      {"name": "PLC-Main", "ip": "192.168.1.50"}
    ],
    "mongo_config_enabled": true,
    "mongo_uri": "mongodb://localhost:27017",
    "mongo_auth_source": "admin",
    "config_sync_enabled": true,
    "config_sync_hour": 0,
    "custom_widgets": [
      {
        "name": "Sorting Status",
        "database": "sorting_service",
        "collection": "primary_sortings",
        "enabled": true,
        "poll_interval_seconds": 10,
        "window_minutes": 1440,
        "group_by_field": "status",
        "time_field": "created_at",
        "max_groups": 10,
        "alert_threshold_percent": 50.0,
        "alert_window_minutes": 15,
        "include_values": ["SUCCESS", "DELIVERED"],
        "exclude_values": ["SKIPPED"]
      }
    ]
  }
  ```

### `GET /api/v1/agent/config`
**Primary Agent Pull Endpoint**: Polled by edge agents every 5 seconds to receive dynamic settings, `force_update`, and instant backup signals (`trigger_sync_id`).
- **Auth**: Agent API Key (`X-API-Key`)
- **Response `200 OK`**: Merged agent configuration JSON.

---

## 5. Metrics Telemetry & Telemetry Query API

### `POST /api/v1/metrics`
**Agent Heartbeat Ingestion**: Pushed every 10 seconds by edge agents. Ingests hardware telemetry and flushes buffered execution logs.
- **Auth**: Agent API Key (`X-API-Key`)
- **Request Body**:
  ```json
  {
    "cpu_percent": 24.5,
    "cpu_cores": 8,
    "memory_percent": 62.1,
    "memory_used_mb": 4968,
    "memory_total_mb": 8000,
    "disk_percent": 45.2,
    "disk_used_gb": 45.2,
    "disk_total_gb": 100.0,
    "net_rx_rate_kbps": 124.5,
    "net_tx_rate_kbps": 88.2,
    "disk_read_rate_kbps": 12.0,
    "disk_write_rate_kbps": 34.0,
    "process_count": 142,
    "uptime_seconds": 864000,
    "agent_version": "1.0.0",
    "hostname": "nido-server-nashik",
    "ip_address": "192.168.1.100",
    "logs": [
      {"timestamp": "2026-09-20T03:00:00Z", "level": "info", "message": "Heartbeat ok"}
    ]
  }
  ```
- **Response `200 OK`**: Returns live config dictionary so agent receives immediate config updates without waiting for next 5s config poll.

### `GET /api/v1/metrics/servers/{server_id}/latest`
Get latest metric document for a server.
- **Auth**: JWT Bearer

### `GET /api/v1/metrics/servers/{server_id}/history`
Retrieve time-series metric datapoints for charts and analytics.
- **Auth**: JWT Bearer
- **Query Parameters**:
  - `range`: `1h | 6h | 24h | 7d | 30d` (default `1h`).
- **Response `200 OK`**: Time-series array with sampled CPU, RAM, Disk, and IO stats.

---

## 6. Monitored Services & Device Connectivity API

### `POST /api/v1/services`
Report TCP port connection health for monitored services.
- **Auth**: Agent API Key (`X-API-Key`)
- **Request Body**:
  ```json
  [
    {"name": "nginx", "port": 80, "status": "up", "latency_ms": 1.2},
    {"name": "postgresql", "port": 5432, "status": "down", "latency_ms": null}
  ]
  ```

### `POST /api/v1/connectivity`
Report ICMP ping results for on-site hardware targets (PLCs, scanners, scales).
- **Auth**: Agent API Key (`X-API-Key`)
- **Request Body**:
  ```json
  [
    {"name": "PLC-Main", "ip": "192.168.1.50", "reachable": true, "latency_ms": 2.4},
    {"name": "Scanner-01", "ip": "192.168.1.51", "reachable": false, "latency_ms": null}
  ]
  ```
- **Behavior**: If `reachable: false`, the central hub immediately triggers warning alert `device_unreachable:<name>`, elevates server status to `warning`, and emits realtime socket events. When `reachable: true` returns, the alert is automatically resolved.

### `GET /api/v1/connectivity/servers/{server_id}/latest`
Get latest connectivity status across all configured targets.
- **Auth**: JWT Bearer

---

## 7. Custom Data Widgets API

### `POST /api/v1/widgets`
Ingest custom periodic MongoDB count aggregation result.
- **Auth**: Agent API Key (`X-API-Key`)
- **Request Body**:
  ```json
  {
    "server_id": "server_40594ba7a94d4d60",
    "widget_name": "Sorting Status",
    "database": "sorting_service",
    "collection": "primary_sortings",
    "window_minutes": 1440,
    "total": 1250,
    "groups": {
      "SUCCESS": 1200,
      "DELIVERED": 50
    },
    "collected_at": "2026-09-20T03:00:00Z",
    "error": null
  }
  ```

### `GET /api/v1/widgets/servers/{server_id}`
Retrieve latest tally and groups for each configured widget on this server.
- **Auth**: JWT Bearer

### `GET /api/v1/widgets/servers/{server_id}/history`
Historical timeline datapoints for a custom widget.
- **Auth**: JWT Bearer
- **Query Parameters**: `widget_name`, `window_minutes`.

---

## 8. Template Library & Site-Scoped Synchronization API

### `GET /api/v1/agent-config-templates`
List all reusable Agent Runtime Templates.
- **Auth**: JWT Bearer (`admin`, `super_admin`)
- **Response**: List of templates with `used_by_sites`, `used_by_servers`, and `applied_servers_count`.

### `POST /api/v1/agent-config-templates`
Create a new Agent Runtime Template.
- **Auth**: JWT Bearer (`admin`, `super_admin`)
- **Request Body**: Includes `name`, `description`, `monitored_services`, `connectivity_targets`, `metrics_interval_seconds`, `target_site_ids`.

### `PUT /api/v1/agent-config-templates/{template_id}`
Update an Agent Runtime Template.
- **Behavior**: Automatically synchronizes modifications **only** to servers located within the sites assigned to this template (`used_by_sites`). Servers in other sites remain completely untouched.

### `POST /api/v1/agent-config-templates/{template_id}/assign-sites`
Assign or reassign template to specific client sites with 1 click.
- **Auth**: JWT Bearer (`admin`, `super_admin`)
- **Request Body**: `{"site_ids": ["cd6d2254...", "d7d9065f..."]}`

### `POST /api/v1/agent-config-templates/{template_id}/apply-all`
Synchronize this template to all active servers fleet-wide ("Sync All").
- **Auth**: JWT Bearer (`admin`, `super_admin`)

### `DELETE /api/v1/agent-config-templates/{template_id}`
Delete runtime template.
- **Auth**: JWT Bearer (`admin`, `super_admin`)

### `GET /api/v1/widgets/templates`
List all reusable Custom Widget Templates with `used_by_sites` and `include_values` / `exclude_values`.

### `POST /api/v1/widgets/templates`
Create new Widget Template.

### `PUT /api/v1/widgets/templates/{template_id}`
Update Widget Template (syncs strictly to assigned sites).

### `POST /api/v1/widgets/templates/{template_id}/assign-sites`
Assign or reassign widget template to specific client sites.

### `DELETE /api/v1/widgets/templates/{template_id}`
Delete widget template.

---

## 9. Sites & Equipment Registry API

### `GET /api/v1/sites`
List all client sites with their code, location, and discovered equipment names.
- **Auth**: JWT Bearer
- **Response `200 OK`**:
  ```json
  [
    {
      "id": "cd6d2254-59e2-4cab-9e3e-c1b43c8f30fd",
      "client": "samsonite",
      "code": "samsonite_nashik_conveyor_01",
      "location": "Nashik",
      "status": "active",
      "alerts_enabled": true,
      "equipment_name": "Nashik Conveyor 01",
      "equipment_names": ["Nashik Conveyor 01"],
      "created_at": "2026-09-06T08:49:39Z",
      "updated_at": "2026-09-06T08:49:39Z"
    }
  ]
  ```

### `POST /api/v1/sites`
Create a new client site.
- **Auth**: JWT Bearer (`admin`, `super_admin`)

### `PATCH /api/v1/sites/{site_id}`
Update site properties or toggle site-wide alert emission (`alerts_enabled: false`).
- **Auth**: JWT Bearer (`admin`, `super_admin`)

### `PATCH /api/v1/sites/clients/{client_name}/alerts`
Toggle alerts for all sites belonging to a client in bulk.
- **Auth**: JWT Bearer (`admin`, `super_admin`)
- **Request Body**: `{"alerts_enabled": true}`

---

## 10. Software Deployments & 3-Team Approval Governance API

### `GET /api/v1/deployments/stacks`
List reusable multi-software stack definitions (components, repos, PM2 names).

### `POST /api/v1/deployments/stacks`
Create new software stack definition.

### `GET /api/v1/deployments`
List software deployments across fleet.
- **Query Parameters**: `server_id`, `status` (`pending_approval | pending | running | success | failed`).

### `POST /api/v1/deployments`
Initiate software deployment for a target server or fleet-wide batch.
- **Behavior**: Deployment starts with `status: "pending_approval"`. Remote site agents poll only for `status: "pending"` and are strictly locked from claiming the job until all 3 team approvals are received.

### `POST /api/v1/deployments/{id}/approve`
**3-Team Approval Governance Gate**: Submit approval from an authenticated team member.
- **Rule**: Requires exactly one approval from each mandatory team group:
  1. `devops`
  2. `developer`
  3. `product`
- **Validation**: Duplicate approvals from the same group are rejected with HTTP 400. Once all 3 distinct team approvals are logged, status automatically transitions to `"pending"`, unlocking execution for edge agents.

### `POST /api/v1/deployments/{id}/reject`
Reject deployment with reason.
- **Request Body**: `{"reason": "Regression detected in staging"}`

### `POST /api/v1/deployments/batch/{batch_id}/approve`
Approve all pending deployments in a fleet-wide deployment batch for the caller's team group.

### `GET /api/v1/deployments/poll`
**Agent Polling Endpoint**: Polled every 5s by remote site agents. Atomically claims the next pending approved deployment (`status -> running`).
- **Auth**: Agent API Key (`X-API-Key`)
- **Response `200 OK`**: `{"job": { ... }}` or `{"job": null}`.

### `POST /api/v1/deployments/{id}/stream`
**Agent Streaming Log**: Push a line of stdout/stderr from executing deployment stages.
- **Auth**: Agent API Key (`X-API-Key`)
- **Request Body**: `{"stage": "GIT", "line": "Cloning repository...", "level": "info"}`
- **Behavior**: Hub broadcasts line to `server:{id}` and `deployments` Socket.IO rooms for real-time terminal rendering.

### `POST /api/v1/deployments/{id}/finish`
**Agent Finish Signal**: Report completion of deployment run.
- **Auth**: Agent API Key (`X-API-Key`)
- **Request Body**:
  ```json
  {
    "status": "success",
    "exit_code": 0,
    "duration_seconds": 45.2,
    "error_summary": null
  }
  ```

---

## 11. Interactive Web SSH / Terminal API

### `POST /api/v1/terminal/{server_id}/commands`
Queue an interactive shell command for execution on the server.
- **Auth**: JWT Bearer (`super_admin`)
- **Request Body**: `{"command": "ls -la", "timeout_seconds": 300}`
- **Response `200 OK`**: `{"command_id": "...", "status": "queued"}`

### `GET /api/v1/terminal/poll`
**Agent Terminal Polling**: Polled every 1s by site agents to claim queued commands.
- **Auth**: Agent API Key (`X-API-Key`)

### `POST /api/v1/terminal/result`
**Agent Output Streaming**: Stream stdout chunks, nano file payload, and final exit code.
- **Auth**: Agent API Key (`X-API-Key`)
- **Request Body**:
  ```json
  {
    "command_id": "61242149...",
    "output": "total 64\ndrwxr-xr-x...",
    "exit_code": 0,
    "complete": true,
    "cancelled": false,
    "timed_out": false
  }
  ```

### `POST /api/v1/terminal/{server_id}/cancel`
Send Ctrl+C interrupt signal to a running command on the server.
- **Auth**: JWT Bearer (`super_admin`)

### `GET /api/v1/terminal/commands/{command_id}/status`
Polled by agent during command execution to detect cancellation requests.
- **Auth**: Agent API Key (`X-API-Key`)

---

## 12. Site MongoDB Config Snapshots & Instant Backup API

### `POST /api/v1/configs/snapshot`
**Agent Backup Ingestion**: Ingests JSON snapshot of site configuration collections.
- **Auth**: Agent API Key (`X-API-Key`)
- **Request Body**: Contains `server_id`, `collections`, `checksum`, `documents_count`.

### `GET /api/v1/configs/servers/{server_id}/latest`
Retrieve latest configuration snapshot metadata and collections.
- **Auth**: JWT Bearer

### `POST /api/v1/configs/servers/{server_id}/test-backup`
**Instant Config Backup Trigger**: Sets `trigger_sync_id` on the server's runtime config.
- **Behavior**: Edge agent picks up `trigger_sync_id` on its 5s config poll, runs `sync_configs()` immediately in a background thread, and pushes the snapshot back to the hub. Frontend polls for arrival with animated spinner.

---

## 13. Master Server Telemetry & Database Compaction API

### `GET /api/v1/master-server/telemetry`
Inspect central master host health, FastAPI runtime process stats, and MongoDB collection storage telemetry.
- **Auth**: JWT Bearer (`super_admin`)
- **Response `200 OK`**:
  ```json
  {
    "system": {
      "cpu_percent": 18.2,
      "cpu_cores": 16,
      "cpu_per_core": [12.0, 24.1, 15.2],
      "memory_used_gb": 12.4,
      "memory_total_gb": 32.0,
      "memory_percent": 38.8,
      "disk_used_gb": 120.5,
      "disk_total_gb": 500.0,
      "disk_percent": 24.1
    },
    "fastapi": {
      "pid": 10452,
      "threads": 18,
      "memory_rss_mb": 245.8,
      "active_socket_clients": 4
    },
    "database": {
      "ping_ms": 0.8,
      "data_size_mb": 450.2,
      "storage_size_mb": 780.5,
      "index_size_mb": 42.1,
      "collections": [
        {
          "name": "metrics",
          "count": 52400,
          "size_mb": 142.1,
          "has_ttl": true,
          "ttl_field": "recorded_at",
          "ttl_days": 7
        }
      ]
    }
  }
  ```

### `POST /api/v1/master-server/cleanup-retention`
**1-Click On-Demand Compaction**: Prunes 7-day old documents from `metrics`, `site_configs`, `terminal_commands`, and executes MongoDB collection compaction (`compact`).
- **Auth**: JWT Bearer (`super_admin`)
- **Request Body**: `{"retention_days": 7}`

---

## 14. Real-Time Socket.IO Protocol Specification

The central hub broadcasts real-time system events over Socket.IO (`/socket.io`):

| Event Name | Room / Scope | Payload Schema | Description |
| :--- | :--- | :--- | :--- |
| `server_status` | Global broadcast | `{"server_id": str, "status": str}` | Emitted when server transitions between online, warning, offline |
| `server_updated` | Global broadcast | `{"server_id": str, "server": dict}` | Server hardware or configuration changes |
| `metrics_updated` | `server:{server_id}` | `{"server_id": str, "metric": dict}` | 10s live hardware metric beat |
| `alert_opened` | Global broadcast | `{"alert": dict, "server_id": str}` | New incident opened (critical or warning) |
| `alert_resolved` | Global broadcast | `{"alert": dict, "server_id": str}` | Incident automatically resolved |
| `deployment_stream`| `deployments` | `{"deployment_id": str, "line": str, "stage": str, "level": str}` | Live streaming deployment log line |
| `deployment_status`| `deployments` | `{"deployment_id": str, "status": str}` | Deployment transitioned (approval, run, finish) |
| `terminal_output` | `server:{server_id}` | `{"command_id": str, "output": str, "complete": bool}` | Live terminal stdout streaming chunk |
| `config_synced` | `server:{server_id}` | `{"server_id": str, "snapshot_id": str}` | Config backup snapshot received |

---

## 15. Agent-Hub Communication Protocol Reference

```
  Edge Agent (Single-File or Docker)            Central Master Hub (FastAPI)
          |                                                   |
          | ----- 1. POST /api/v1/metrics (10s beat) --------> | Ingests telemetry, stores in DB
          | <---- 2. Returns live runtime config ------------- | Emits 'metrics_updated' to sockets
          |                                                   |
          | ----- 3. GET /api/v1/agent/config (5s poll) -----> | Returns trigger_sync_id, force_update
          |                                                   |
          | ----- 4. GET /api/v1/deployments/poll (5s) ------> | Claims approved deployment job
          | ----- 5. POST /deployments/{id}/stream ----------> | Broadcasts live log to dashboard
          | ----- 6. POST /deployments/{id}/finish ----------> | Marks deployment finished
          |                                                   |
          | ----- 7. GET /api/v1/terminal/poll (1s) ---------> | Claims queued Web SSH command
          | ----- 8. POST /api/v1/terminal/result -----------> | Streams output chunks & exit code
          |                                                   |
          | ----- 9. POST /api/v1/connectivity --------------> | Reports ICMP ping targets
          | ----- 10. POST /api/v1/widgets ------------------> | Reports custom MongoDB counts
          | ----- 11. POST /api/v1/configs/snapshot ---------> | Ingests site config backup
          |                                                   |
```
