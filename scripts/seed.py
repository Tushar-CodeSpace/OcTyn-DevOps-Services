"""Seed the OcTyn DevOps Services database with demo data.

Usage (from repo root):
    uv run --project backend scripts/seed.py

Idempotent: safe to run multiple times.
"""

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

import bcrypt
from dotenv import load_dotenv
from pymongo import MongoClient

BACKEND_ENV = Path(__file__).resolve().parent.parent / "backend" / ".env"
load_dotenv(BACKEND_ENV)

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB = os.environ.get("MONGO_DB", "central_monitoring")

SITES = [
    {
        "client": "samsonite",
        "code": "samsonite_nashik_conveyor_01",
        "location": "Nashik",
        "status": "active",
    },
    {
        "client": "meesho",
        "code": "meesho_faridhabad",
        "location": "Faridhabad",
        "status": "active",
    },
]

DEMO_USER_EMAIL = "admin@monitoring.com"
DEMO_USER_PASSWORD = "admin123"

DEMO_SERVER = {
    "name": "Nashik Conveyor 01",
    "hostname": "samsonite-nashik-c1",
    "ip_address": "10.0.1.10",
    "status": "unknown",
}

DEMO_API_KEY_NAME = "demo-agent"


def now() -> datetime:
    return datetime.now(timezone.utc)


def main() -> None:
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    db = client[MONGO_DB]
    try:
        # --- Sites ---
        for site in SITES:
            existing = db.sites.find_one({"code": site["code"]})
            doc = {
                "client": site["client"],
                "location": site["location"],
                "status": site["status"],
                "updated_at": now(),
            }
            if existing:
                db.sites.update_one({"_id": existing["_id"]}, {"$set": doc, "$unset": {"name": ""}})
                print(f"site {site['code']}: updated")
            else:
                doc.update({"code": site["code"], "_id": str(uuid.uuid4()), "created_at": now()})
                db.sites.insert_one(doc)
                print(f"site {site['code']}: created")

        # --- Demo server (attached to samsonite_nashik_conveyor_01) ---
        nashik = db.sites.find_one({"code": "samsonite_nashik_conveyor_01"})
        existing = db.servers.find_one({"hostname": DEMO_SERVER["hostname"]})
        doc = {
            "site_id": nashik["_id"],
            "name": DEMO_SERVER["name"],
            "ip_address": DEMO_SERVER["ip_address"],
            "status": DEMO_SERVER["status"],
            "last_seen_at": None,
            "updated_at": now(),
        }
        if existing:
            db.servers.update_one({"_id": existing["_id"]}, {"$set": doc})
            server_id = existing["_id"]
            print(f"server {DEMO_SERVER['hostname']}: updated")
        else:
            doc.update(
                {
                    "hostname": DEMO_SERVER["hostname"],
                    "_id": str(uuid.uuid4()),
                    "created_at": now(),
                }
            )
            server_id = db.servers.insert_one(doc).inserted_id
            print(f"server {DEMO_SERVER['hostname']}: created")

        # --- Demo dashboard user (bcrypt hash only) ---
        existing = db.users.find_one({"email": DEMO_USER_EMAIL})
        if existing:
            print(f"user {DEMO_USER_EMAIL}: exists")
        else:
            db.users.insert_one(
                {
                    "_id": str(uuid.uuid4()),
                    "email": DEMO_USER_EMAIL,
                    "password_hash": bcrypt.hashpw(
                        DEMO_USER_PASSWORD.encode(), bcrypt.gensalt()
                    ).decode(),
                    "name": "Demo Admin",
                    "role": "super_admin",
                    "created_at": now(),
                }
            )
            print(f"user {DEMO_USER_EMAIL}: created (password: {DEMO_USER_PASSWORD})")

        # --- Demo agent API key (hash only; raw key printed once) ---
        existing = db.api_keys.find_one(
            {"server_id": server_id, "name": DEMO_API_KEY_NAME}
        )
        if existing:
            print(f"api_key {DEMO_API_KEY_NAME}: exists (raw key not re-printed)")
        else:
            raw_key = "demo-" + secrets.token_urlsafe(24)
            db.api_keys.insert_one(
                {
                    "_id": str(uuid.uuid4()),
                    "server_id": server_id,
                    "key_hash": hashlib.sha256(raw_key.encode()).hexdigest(),
                    "name": DEMO_API_KEY_NAME,
                    "status": "active",
                    "created_at": now(),
                    "last_used_at": None,
                }
            )
            print(f"api_key {DEMO_API_KEY_NAME}: created")
            print(f"  >>> RAW API KEY (save it now): {raw_key}")
    finally:
        client.close()


if __name__ == "__main__":
    main()