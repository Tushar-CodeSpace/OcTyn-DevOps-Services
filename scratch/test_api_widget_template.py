import asyncio
from httpx import AsyncClient, ASGITransport
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.main import app
from app.services import authentication
from app.database import models as db

async def test_api():
    admin = db.users().find_one({"role": "admin"})
    if not admin:
        print("Admin user not found in DB")
        return
    token, _ = authentication.create_access_token(admin["_id"])
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # 1. Create widget template with include_values and exclude_values
        widget_payload = {
            "name": "Test Include Exclude Template",
            "description": "Template testing key value filter",
            "database": "sorting_service",
            "collection": "primary_sortings",
            "enabled": True,
            "poll_interval_seconds": 30,
            "window_minutes": 120,
            "group_by_field": "status",
            "time_field": "created_at",
            "max_groups": 10,
            "alert_threshold_percent": 40.0,
            "alert_window_minutes": 20,
            "include_values": ["SUCCESS", "DELIVERED"],
            "exclude_values": ["SKIPPED"],
        }
        create_res = await client.post("/api/v1/widgets/templates", json=widget_payload, headers=headers)
        print("Create template status:", create_res.status_code)
        assert create_res.status_code == 200, create_res.text
        tmpl = create_res.json()
        print("Created template:", tmpl)
        assert tmpl["include_values"] == ["SUCCESS", "DELIVERED"]
        assert tmpl["exclude_values"] == ["SKIPPED"]
        tmpl_id = tmpl["id"]

        # 2. Read templates list
        list_res = await client.get("/api/v1/widgets/templates", headers=headers)
        assert list_res.status_code == 200
        found = next((x for x in list_res.json() if x["id"] == tmpl_id), None)
        assert found is not None
        assert found["include_values"] == ["SUCCESS", "DELIVERED"]
        assert found["exclude_values"] == ["SKIPPED"]
        print("Found template in list with filters preserved!")

        # 3. Clean up template
        del_res = await client.delete(f"/api/v1/widgets/templates/{tmpl_id}", headers=headers)
        assert del_res.status_code in (200, 204)
        print("Deleted template successfully!")

if __name__ == "__main__":
    asyncio.run(test_api())
