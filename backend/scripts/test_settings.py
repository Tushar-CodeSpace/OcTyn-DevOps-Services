"""Smoke test for the settings API (run: python scripts/test_settings.py)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

from app.database import models as db
from app.main import app
from app.services import app_settings

# start from defaults regardless of earlier crashed runs
db.settings().delete_one({"_id": "alerts"})
db.settings().delete_one({"_id": "sync"})

client = TestClient(app)

# --- login ---
r = client.post("/api/v1/auth/login", json={"email": "admin@monitoring.com", "password": "admin123"})
assert r.status_code == 200, r.text
H = {"Authorization": f"Bearer {r.json()['access_token']}"}

# --- defaults readable ---
r = client.get("/api/v1/settings", headers=H)
assert r.status_code == 200, r.text
base = r.json()
from app.config.settings import settings
assert base["ram_threshold_percent"] == settings.alert_ram_threshold_percent, base  # env/settings default
default_hour = base["config_sync_hour"]
print("defaults ok:", base)

# --- unauthenticated read -> 401 ---
assert client.get("/api/v1/settings").status_code == 401
print("401 without token ok")

# --- admin patch works ---
r = client.patch("/api/v1/settings", json={"ram_threshold_percent": 75}, headers=H)
assert r.status_code == 200 and r.json()["ram_threshold_percent"] == 75.0, r.text
assert app_settings.get_alert_config()["ram_threshold_percent"] == 75.0
print("patch ok ->", r.json())

# --- validation: out of range / unknown key / below minimum ---
for bad in ({"ram_threshold_percent": 150}, {"cpu_duration_seconds": 5}, {"nope": 1}, {"config_sync_hour": 24}):
    assert client.patch("/api/v1/settings", json=bad, headers=H).status_code == 422, bad
print("validation 422 ok")

# --- empty patch is an accepted no-op returning current values ---
assert client.patch("/api/v1/settings", json={}, headers=H).status_code == 200
print("empty patch no-op ok")

# --- persistence survives a fresh fetch (DB doc) ---
r2 = client.get("/api/v1/settings", headers=H)
assert r2.json()["ram_threshold_percent"] == 75.0
print("persisted across reads")

# --- explicit hour override round-trips regardless of env default ---
r = client.patch(
    "/api/v1/settings",
    json={"config_sync_hour": 2},
    headers=H,
)
assert r.status_code == 200 and r.json()["config_sync_hour"] == 2, r.text
r2 = client.get("/api/v1/settings", headers=H)
assert r2.json()["config_sync_hour"] == 2
print("hour override persisted")

# --- restore default by deleting override ---
from app.database import models as db

db.settings().delete_one({"_id": "alerts"})
db.settings().delete_one({"_id": "sync"})
r3 = client.get("/api/v1/settings", headers=H)
assert r3.json()["ram_threshold_percent"] == settings.alert_ram_threshold_percent
assert r3.json()["config_sync_hour"] == default_hour
print("override removed -> back to defaults")

print("ALL SETTINGS TESTS PASSED")
