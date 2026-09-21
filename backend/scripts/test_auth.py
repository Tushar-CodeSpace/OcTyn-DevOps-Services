"""Quick smoke test for the auth flow (run: uv run python scripts/test_auth.py)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

print("--- login ok ---")
r = client.post(
    "/api/v1/auth/login",
    json={"email": "admin@monitoring.com", "password": "admin123"},
)
assert r.status_code == 200, r.text
token = r.json()["access_token"]
print("token:", token[:30] + "...")

print("--- me with token ---")
r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
assert r.status_code == 200, r.text
print("me:", r.json())

print("--- me without token ---")
r = client.get("/api/v1/auth/me")
assert r.status_code == 401, r.status_code
print("401 ok")

print("--- wrong password ---")
r = client.post(
    "/api/v1/auth/login",
    json={"email": "admin@monitoring.com", "password": "wrong"},
)
assert r.status_code == 401, r.status_code
print("401 ok")

print("--- garbage token ---")
r = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage"})
assert r.status_code == 401, r.status_code
print("401 ok")

print("--- refresh token rotation ---")
r_login = client.post(
    "/api/v1/auth/login",
    json={"email": "admin@monitoring.com", "password": "admin123"},
)
assert r_login.status_code == 200, r_login.text
initial_refresh = r_login.json().get("refresh_token")
assert initial_refresh, "Missing refresh_token in login response"

r_refresh = client.post(
    "/api/v1/auth/refresh",
    json={"refresh_token": initial_refresh},
)
assert r_refresh.status_code == 200, r_refresh.text
refresh_data = r_refresh.json()
assert "access_token" in refresh_data, "Missing access_token in refresh response"
assert "refresh_token" in refresh_data, "Missing refresh_token in refresh response"
new_access = refresh_data["access_token"]
second_refresh = refresh_data["refresh_token"]
assert second_refresh != initial_refresh, "Rotated refresh token should differ from initial"

# New access token works
r_me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_access}"})
assert r_me.status_code == 200, r_me.text

# Old refresh token is revoked
r_old = client.post(
    "/api/v1/auth/refresh",
    json={"refresh_token": initial_refresh},
)
assert r_old.status_code == 401, "Old refresh token must be rejected"

# Second refresh token works
r_refresh2 = client.post(
    "/api/v1/auth/refresh",
    json={"refresh_token": second_refresh},
)
assert r_refresh2.status_code == 200, r_refresh2.text
assert "refresh_token" in r_refresh2.json()
print("refresh token rotation ok")

print("ALL AUTH TESTS PASSED")