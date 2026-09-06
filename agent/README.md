# Monitoring Agent

Two flavors, same API contract — both push metrics to `POST /api/v1/metrics`
and service reports to `/api/v1/services` using a per-agent `X-API-Key`.

## 1. Docker agent (`agent/`, deployed via docker-compose)

Full-featured agent (psutil + httpx + pydantic-settings) that runs as the
`agent` service in `docker-compose.yml`. Configure it through `agent/.env`
(see `.env.example`). Prefer this wherever Docker is already available.

## 2. Lite agent (`agent_lite.py`) - zero dependencies, single file

For bare servers where you want nothing installed: one ~200-line Python file,
pure stdlib, reads metrics from `/proc`. **Linux only** (Python 3.8+).

### Step 1 — Register the site

Dashboard → **Add agent** → note the printed `SERVER_ID` and `API_KEY`.

### Step 2 — Copy the agent & configure

```bash
sudo mkdir -p /opt/monitoring
sudo cp agent_lite.py /opt/monitoring/
```

Fill the `CONFIG` dict at the top of the script (needs `sudo` if root-owned):

```bash
sudo nano /opt/monitoring/agent_lite.py
```

```python
CONFIG = {
    "SERVER_ID": "6961e46c-...",                 # from Add-agent dialog
    "API_URL": "http://<CENTRAL_SERVER_IP_OR_DOMAIN>/api/v1",
    "API_KEY": "cm-...",
    # Optional — other knobs (monitoring interval, services, mongo backup,
    # timeouts) are pulled from the central "Agent config" dashboard, so you
    # only set them here as local bootstrap defaults if you want to.
}
```

Alternatively keep the dict empty and export the same keys as environment
variables — env vars take precedence.

### Step 3 — Test run manually first

```bash
python3 /opt/monitoring/agent_lite.py
# expect: "lite agent starting ..." then "pushed cpu=… mem=…" every ~60s
# Ctrl-C to stop; the dashboard should already show the server online
```

### Step 4 — systemd service

```bash
sudo tee /etc/systemd/system/agent-lite.service >/dev/null <<'EOF'
[Unit]
Description=OcTyn DevOps Services lite agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=REPLACE_WITH_LOCAL_USER
ExecStart=/usr/bin/python3 /opt/monitoring/agent_lite.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

- `User=` must be an account that **exists on this machine** (e.g. the user
  you're logged in as). Copy-pasting a unit from another site with its user is
  the #1 setup mistake — see troubleshooting below.
- If you kept secrets out of the script, add
  `EnvironmentFile=/opt/monitoring/agent.env` with the same key=value lines.
- `which python3` must return an absolute path (≥ 3.8) — use it in `ExecStart`.
- `ExecStart` must match your **actual deployed filename** — some sites save
  the script as `agent-lite.py`; keep file name, unit and path consistent.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agent-lite
systemctl status agent-lite --no-pager     # active (running)
journalctl -u agent-lite -n 10 --no-pager  # live push log
```

The server flips **online** in the dashboard within seconds; config lives in
the env file/script, so future script updates only need a re-copy +
`systemctl restart agent-lite`.

### systemd troubleshooting

| Log / status | Cause | Fix |
|---|---|---|
| `status=203/EXEC` | `ExecStart` uses a relative or wrong path (e.g. bare `python3`) | systemd needs absolute paths: `ExecStart=/usr/bin/python3 /opt/monitoring/agent_lite.py`. Confirm with `which python3` |
| `status=203/EXEC` persists after editing | unit still points at a stale location from another setup (e.g. `/opt/monitoring-agent/agent/.venv/...`) — `systemctl cat cm-agent` shows what systemd actually runs | Overwrite the whole unit with the tee template above so every path matches **your** deployed filename/location (`agent_lite.py` vs `agent-lite.py`), then `daemon-reload` + restart |
| `status=217/USER` — *Failed to determine user credentials* | `User=` names an account that doesn't exist on this machine (units copied between sites carry the old username) | Set `User=` to a real local user (`whoami`) and `daemon-reload` |
| Unit edited but old behavior persists | systemd still has the old definition cached | `sudo systemctl daemon-reload && sudo systemctl restart agent-lite` |
| `ModuleNotFoundError: No module named 'pymongo'` | config backup needs the driver | Ubuntu 24.04: `sudo apt install python3-pymongo`; pip fallback: `pip3 install pymongo --break-system-packages` |
| `config sync skipped: pymongo not installed` | driver missing — metrics still work, only config backup is off | install pymongo as above |
| `config sync skipped: cannot reach site mongodb: Connection refused / ServerSelectionTimeoutError` | nothing listening at the configured mongo URI — MongoDB isn't installed or isn't running on this host | Check: `systemctl status mongod` and `ss -tlnp \| grep 27017`. Install/start it and create the configured user. If this box intentionally has no DB, switch it off via the dashboard **Config backup** popup (`mongo_config_enabled` = off) to silence the skip (metrics/alerts unaffected) |

### cron alternative

```cron
* * * * * python3 /opt/monitoring/agent_lite.py --once
```

(`--once` pushes a single sample and exits 0/1; use a systemd timer for
tighter cadence.)

## How the pull-config mechanism works

Both the Docker and lite agents are deliberately **thin** — they only need
three values to talk to the hub (`SERVER_ID`, `API_URL`, `API_KEY`). Every
other knob is **pulled from the central backend** and applied live, so you
never SSH to a site to change a timeout or a collection list again.

```
┌────────────────────┐    GET /api/v1/agent/config      ┌───────────────────────┐
│   Site agent        │  ────────────────────────────►  │  Central backend       │
│  SERVER_ID/API_URL  │  (X-API-Key auth)               │  effective config =    │
│  API_KEY only       │  ◄────────────────────────────   │  global defaults       │
│                     │  {monitored_services, …}        │  + per-server override │
└────────────────────┘    config poller thread           └───────────────────────┘
                               every N seconds                   ▲
                                                     dashboard "Agent runtime"
                                                     / "Config backup" edits
```

**What happens:**

1. **On boot** the agent fetches `/api/v1/agent/config` once and applies it
   before the first metric push.
2. A **background config-poller thread** re-fetches the same endpoint every
   `config_poll_interval_seconds` (default **5s**). When the returned JSON
   differs from what the agent has cached, it is applied immediately and
   logged (`agent config updated from hub`).
3. Because the poller runs in the background, a dashboard edit takes effect
   **within a few seconds** — there is no waiting for the next monitoring
   cycle and no per-site redeploy.

**What the agent gets** is the **effective** config: the hub merges global
defaults (from `backend/app/config/settings.py`) with any **per-server
overrides** stored in the `server_configs` collection (edited from the
dashboard UI), then servers it to the agent. Overrides use `$set` on only the
keys you change, so editing your backup settings never clobbers your runtime
(or connectivity) settings, and vice-versa.

**Failure handling:** if the fetch fails (network hiccup, hub restart) the
poller silently retries and keeps the last known-good config — the agent keeps
running metrics on its current settings and falls back to env-var/local
defaults for anything the hub has never delivered.

## Agent config field reference

Fields are grouped by where you edit them in the dashboard (**Server detail →
Agent runtime** modal and **Config backup** popup). All values below are the
**global defaults**; per-server overrides take precedence.

### Runtime fields — "Agent runtime" modal

| Field | Default | Meaning |
| --- | --- | --- |
| `monitoring_interval_seconds` | `60` | Seconds between metric/service collection + push cycles. Min `1`, max `3600`. |
| `http_timeout_seconds` | `10` | HTTP timeout (s) for every request the agent makes to the hub. Min `1`, max `120`. |
| `http_retry_count` | `3` | Number of retries for failed pushes/config fetches (linear backoff). Min `0`, max `10`. |
| `config_poll_interval_seconds` | `5` | Seconds between config-poller fetches. Min `1`, max `300`. Lower = snappier config updates, higher = fewer requests. |
| `connectivity_poll_interval_seconds` | `15` | Seconds between realtime ping rounds of the configured device targets. Min `1`, max `3600`. |
| `connectivity_targets` | `[]` (none) | Ordered list of on-site devices to ping in realtime. Each entry is `{name, ip}` — e.g. `PLC-1 → 10.0.3.20`, `Cam-2 → 10.0.3.25`. IP can be a host/IPv4/IPv6. Results are POSTed to the hub immediately and shown live on the server's **Device connectivity** card. |
| `monitored_services` | `[]` (none) | Service/Watch list as `name:port` entries (e.g. `api:8080`, `mongodb:27017`). A TCP-connect check against `127.0.0.1:port` decides `running` vs `stopped`/`error`; entries without a port always report `running`. If no entries are configured here the agent does **not** watch/fail anything (no `service_stopped` alert spam). |

### Backup fields — "Config backup" popup

| Field | Default | Meaning |
| --- | --- | --- |
| `config_sync_enabled` | `true` | Master switch for the daily site **MongoDB config backup**. When off, the agent skips the config-sync routine entirely (silences "pymongo not installed" / "cannot reach mongodb" skips). |
| `config_sync_hour` | `0` | Hour of day (0–23, local agent time) at which the daily config backup runs. `0` = 12:00 AM. Min `0`, max `23`. |
| `mongo_config_enabled` | `true` | Enables reading the site's local config collections out of its MongoDB. Independent of `config_sync_enabled`'s scheduling — this switch governs the MongoDB connection/driver step. |
| `mongo_uri` | `""` (empty) | MongoDB connection URI of the **site's own** database (e.g. `mongodb://user:pass@127.0.0.1:27017/`). Empty = not configured, so the driver step is skipped. |
| `mongo_auth_source` | `admin` | Auth database used for the `mongo_uri` credentials. |
| `config_collections` | built-in map (below) | Which databases/collections to snapshot. `[{database, collections:[…]}]`. Falls back to the built-in list when the hub sends none. The default map is: `analytic_service:[analytic_config]`, `data_uploader_service:[integration_config]`, `identity_service:[UIControls, client_setup, features_code, formcode_mappings, monitoring_configurations, notifiers, pages_code, products, products_category, roles, users]`, `incoming_service:[incoming_config]`, `machine_configurations:[machines]`, `sorting_service:[business_logic, rejection_codes, sorting_config]`, `bagging:[active_bags, bagging_config, ptl_users]`, `calibration_service:[calibration_boxes, calibration_process, calibration_results]`, `cyclic_data_service:[active_location_statuses, alarms]`, `notification_service:[notifiers]`. |

> **DB engine selector:** the "Config backup" popup includes a Mongo /
> Postgres selector. **Mongo** is active now; **Postgres** is shown disabled
> ("soon") — the backup layer currently targets site MongoDB collections only.

### Notes

- Agent needs **outbound HTTPS only** — no inbound firewall rules.
- **Agent behavior is centrally managed.** See
  [How the pull-config mechanism works](#how-the-pull-config-mechanism-works)
  and the [Agent config field reference](#agent-config-field-reference)
  below.
- CPU% comes from `/proc/stat` deltas between cycles - no blocking sampling.
- Service entries without a port always report `running`; with `name:port`
  the status is a TCP connect check against 127.0.0.1 (`services=N` in logs).
- Failed pushes retry up to `HTTP_RETRY_COUNT` times with linear backoff;
  the process never exits mid-cycle.
