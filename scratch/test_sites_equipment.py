import asyncio
from httpx import AsyncClient, ASGITransport
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.main import app
from app.database import models as db
from app.services import authentication

async def test_sites_equipment():
    admin = db.users().find_one({"role": "admin"})
    token, _ = authentication.create_access_token(admin["_id"])
    headers = {"Authorization": f"Bearer {token}"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        res = await client.get("/api/v1/sites", headers=headers)
        assert res.status_code == 200, res.text
        sites = res.json()
        print(f"Retrieved {len(sites)} sites from API.")
        for s in sites:
            print(f"Site: {s['client']} ({s['location']}) -> equipment: {s.get('equipment_names')}")
            assert "equipment_names" in s
            assert isinstance(s["equipment_names"], list)
        print("Sites equipment validation passed successfully!")

if __name__ == "__main__":
    asyncio.run(test_sites_equipment())
