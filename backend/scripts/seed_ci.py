"""CI seed: create the data the smoke-test scripts expect.

Idempotent - safe to run on every workflow run. Seeds:
  - admin dashboard user   admin@monitoring.com / admin123
  - sites                  ci_plant, samsonite_nashik_conveyor_01, meesho_faridhabad
  - a server               hostname=samsonite-nashik-c1

Also removes fixtures the CRUD test creates for itself, so a previously
crashed run cannot break the next one (duplicate 409s).

Run: MONGO_URL=mongodb://... python scripts/seed_ci.py
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import models as db
from app.database.connection import new_id
from app.services.authentication import hash_password

SEED_SITES = [
    {"client": "ci", "code": "ci_plant", "location": "CI"},
    {"client": "samsonite", "code": "samsonite_nashik_conveyor_01", "location": "Nashik"},
    {"client": "meesho", "code": "meesho_faridhabad", "location": "Faridhabad"},
]


def now() -> datetime:
    return datetime.now(timezone.utc)


def seed_user() -> None:
    db.users().update_one(
        {"email": "admin@monitoring.com"},
        {
            "$set": {
                "name": "CI Admin",
                "role": "admin",
                "password_hash": hash_password("admin123"),
            },
            "$setOnInsert": {
                "_id": new_id(),
                "email": "admin@monitoring.com",
            },
        },
        upsert=True,
    )
    print("seeded user admin@monitoring.com")


def seed_sites() -> None:
    for spec in SEED_SITES:
        if db.sites().find_one({"code": spec["code"]}) is None:
            db.sites().insert_one(
                spec | {"_id": new_id(), "status": "active", "created_at": now(), "updated_at": now()}
            )
            print("seeded site", spec["code"])
        else:
            print("site exists:", spec["code"])


def clean_test_fixtures() -> None:
    """Remove self-created fixtures from a previously crashed test run."""
    deleted = db.servers().delete_many({"hostname": "meesho-fbd-01"}).deleted_count
    if deleted:
        print("removed stale server meesho-fbd-01 x%d" % deleted)
    deleted = db.sites().delete_many({"code": "samsonite_kolkata_conveyor_01"}).deleted_count
    if deleted:
        print("removed stale site samsonite_kolkata_conveyor_01 x%d" % deleted)


def seed_server() -> None:
    if db.servers().find_one({"hostname": "samsonite-nashik-c1"}) is not None:
        print("server exists")
        return

    site = db.sites().find_one({"code": "ci_plant"})
    if site is None:  # defensive; seed_sites() runs first
        site = {
            "_id": new_id(),
            "client": "ci",
            "code": "ci_plant",
            "location": "CI",
            "status": "active",
            "created_at": now(),
            "updated_at": now(),
        }
        db.sites().insert_one(site)

    db.servers().insert_one(
        {
            "_id": new_id(),
            "site_id": site["_id"],
            "name": "Samsonite Nashik C1",
            "hostname": "samsonite-nashik-c1",
            "ip_address": None,
            "status": "unknown",
            "last_seen_at": None,
            "created_at": now(),
            "updated_at": now(),
        }
    )
    print("seeded server samsonite-nashik-c1")


if __name__ == "__main__":
    seed_user()
    seed_sites()
    clean_test_fixtures()
    seed_server()
    print("SEED OK")

