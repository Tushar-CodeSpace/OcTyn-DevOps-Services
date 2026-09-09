"""Site MongoDB config snapshot routes (agent ingest + dashboard queries)."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.schemas.configs import ConfigIngest, ConfigSnapshotFull, ConfigSnapshotMeta
from app.services import authentication as auth
from app.services.monitoring import authenticate_agent

router = APIRouter(prefix="/api/v1/configs", tags=["configs"])

MAX_DOCUMENTS = 50_000


def _meta(doc: dict) -> ConfigSnapshotMeta:
    return ConfigSnapshotMeta(
        id=str(doc["_id"]),
        server_id=str(doc["server_id"]),
        database=doc["database"],
        collection=doc["collection"],
        captured_at=doc["captured_at"],
        received_at=doc["received_at"],
        count=doc["count"],
        content_hash=doc["content_hash"],
        truncated=doc.get("truncated", False),
    )


@router.post("/ingest")
async def ingest_config_snapshot(
    payload: ConfigIngest,
    agent: dict = Depends(authenticate_agent),
) -> dict:
    """Agent endpoint: store one config-collection snapshot (history on change)."""
    server = agent["server"]
    documents = payload.documents[:MAX_DOCUMENTS]
    truncated = payload.truncated or len(payload.documents) > MAX_DOCUMENTS

    latest = (
        db.site_configs()
        .find_one(
            {
                "server_id": server["_id"],
                "database": payload.database,
                "collection": payload.collection,
            },
            sort=[("received_at", -1)],
        )
    )
    now = datetime.now(timezone.utc)
    if latest and latest["content_hash"] == payload.content_hash:
        db.site_configs().update_one({"_id": latest["_id"]}, {"$set": {"received_at": now}})
        emit(
            "config_snapshot",
            {
                "id": str(latest["_id"]),
                "server_id": str(server["_id"]),
                "database": latest["database"],
                "collection": latest["collection"],
                "captured_at": payload.captured_at,
                "received_at": now.isoformat(),
                "count": latest["count"],
                "content_hash": latest["content_hash"],
                "truncated": latest.get("truncated", False),
            },
            room=f"server:{server['_id']}",
        )
        return {"success": True, "stored": False, "reason": "unchanged"}

    now = datetime.now(timezone.utc)
    snapshot = {
        "_id": new_id(),
        "server_id": server["_id"],
        "database": payload.database,
        "collection": payload.collection,
        "captured_at": payload.captured_at,
        "received_at": now,
        "count": len(documents),
        "content_hash": payload.content_hash,
        "truncated": truncated,
        "documents": documents,
    }
    db.site_configs().insert_one(snapshot)
    emit(
        "config_snapshot",
        {
            "id": str(snapshot["_id"]),
            "server_id": str(server["_id"]),
            "database": snapshot["database"],
            "collection": snapshot["collection"],
            "captured_at": snapshot["captured_at"].isoformat(),
            "received_at": snapshot["received_at"].isoformat(),
            "count": snapshot["count"],
            "content_hash": snapshot["content_hash"],
            "truncated": snapshot["truncated"],
        },
        room=f"server:{server['_id']}",
    )
    return {"success": True, "stored": True}


@router.get("/servers/{server_id}", response_model=list[ConfigSnapshotMeta])
async def list_latest_snapshots(
    server_id: str,
    _: dict = Depends(auth.get_current_user),
) -> list[ConfigSnapshotMeta]:
    """Latest stored snapshot metadata per (database, collection) for a server."""
    sid = parse_id(server_id)
    if sid is None or db.servers().find_one({"_id": sid}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    seen: set[tuple[str, str]] = set()
    out: list[ConfigSnapshotMeta] = []
    for doc in db.site_configs().find(
        {"server_id": sid}, {"documents": 0}
    ).sort("received_at", -1):
        key = (doc["database"], doc["collection"])
        if key in seen:
            continue
        seen.add(key)
        out.append(_meta(doc))
    return out


@router.get("/servers/{server_id}/history", response_model=list[ConfigSnapshotMeta])
async def list_snapshot_history(
    server_id: str,
    database: str = Query(min_length=1),
    collection: str = Query(min_length=1),
    _: dict = Depends(auth.get_current_user),
) -> list[ConfigSnapshotMeta]:
    """All stored versions of one config collection, newest first."""
    sid = parse_id(server_id)
    if sid is None or db.servers().find_one({"_id": sid}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    docs = db.site_configs().find(
        {"server_id": sid, "database": database, "collection": collection},
        {"documents": 0},
    ).sort("received_at", -1)
    return [_meta(d) for d in docs]


from typing import Optional
from pydantic import BaseModel


class TestBackupRequest(BaseModel):
    mongo_uri: str
    mongo_auth_source: Optional[str] = "admin"
    mongo_config_enabled: Optional[bool] = True
    config_collections: Optional[list[dict]] = None


@router.get("/snapshots/{snapshot_id}", response_model=ConfigSnapshotFull)
async def get_snapshot(
    snapshot_id: str,
    _: dict = Depends(auth.get_current_user),
) -> ConfigSnapshotFull:
    snap_id = parse_id(snapshot_id)
    doc = db.site_configs().find_one({"_id": snap_id}) if snap_id else None
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    meta = _meta(doc)
    return ConfigSnapshotFull(**meta.model_dump(), documents=doc.get("documents", []))


def _encode_uri_password(uri: str) -> str:
    """Safely percent-encode username and password in MongoDB URI if they contain unescaped characters like '@'."""
    if not uri or "://" not in uri:
        return uri
    try:
        import urllib.parse
        prefix, rest = uri.split("://", 1)
        if "@" in rest:
            userinfo, host_and_options = rest.rsplit("@", 1)
            if ":" in userinfo:
                user, password = userinfo.split(":", 1)
                clean_user = urllib.parse.unquote(user)
                clean_pass = urllib.parse.unquote(password)
                enc_user = urllib.parse.quote(clean_user, safe="")
                enc_pass = urllib.parse.quote(clean_pass, safe="")
                return f"{prefix}://{enc_user}:{enc_pass}@{host_and_options}"
    except Exception:
        pass
    return uri


@router.post("/servers/{server_id}/test-backup")
async def test_and_trigger_backup(
    server_id: str,
    payload: TestBackupRequest,
    user: dict = Depends(auth.require_admin),
) -> dict:
    """Test connection string, save backup config overrides, and execute backup immediately."""
    sid = parse_id(server_id)
    server = db.servers().find_one({"_id": sid}) if sid else None
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    raw_uri = payload.mongo_uri.strip()
    if not raw_uri:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mongo URI connection string is required")

    uri = _encode_uri_password(raw_uri)
    trigger_id = str(new_id())
    overrides: dict = {
        "mongo_uri": uri,
        "mongo_auth_source": payload.mongo_auth_source or "admin",
        "mongo_config_enabled": True,
        "trigger_sync_id": trigger_id,
        "force_update": True,
        "updated_at": datetime.now(timezone.utc),
    }
    if payload.config_collections is not None:
        overrides["config_collections"] = payload.config_collections

    db.server_configs().update_one(
        {"server_id": sid},
        {"$set": overrides},
        upsert=True,
    )

    cmd_id = new_id()
    db.terminal_commands().insert_one({
        "_id": cmd_id,
        "server_id": sid,
        "command": "cd /opt/octyn-agent 2>/dev/null || cd /opt/agent 2>/dev/null || cd \"$HOME\" || true; python3 agent_lite.py --sync-configs || python3 agent.py --sync-configs || uv run agent --sync-configs || python3 -c 'from agent.mongo_backup import sync_configs; sync_configs()'",
        "created_by": user["_id"],
        "user_email": user["email"],
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
        "timeout_seconds": 60,
    })

    synced_from_hub = False
    synced_count = 0
    is_site_local = "localhost" in uri or "127.0.0.1" in uri
    if not is_site_local:
        try:
            import hashlib
            from pymongo import MongoClient

            auth_src = payload.mongo_auth_source or "admin"
            temp_client = MongoClient(uri, authSource=auth_src, serverSelectionTimeoutMS=1500, directConnection=True)
            try:
                temp_client[auth_src].command("ping")
            except Exception:
                temp_client.admin.command("ping")

            collections_map = payload.config_collections or []
            db_names = set()
            try:
                db_names = set(temp_client.list_database_names())
            except Exception:
                pass

            if not collections_map and db_names:
                collections_map = [
                    {"database": dbname, "collections": ["*"]}
                    for dbname in db_names
                    if dbname not in {"admin", "config", "local"}
                ]

            if not collections_map:
                collections_map = [
                    {"database": "site_db", "collections": ["orders", "settings", "users"]}
                ]

            now = datetime.now(timezone.utc)
            captured_at = now.isoformat()

            for spec in collections_map:
                dbname = spec.get("database")
                cols = spec.get("collections", [])
                if not dbname:
                    continue
                try:
                    available_cols = set(temp_client[dbname].list_collection_names())
                except Exception:
                    continue

                target_cols = [c for c in cols if c] if isinstance(cols, list) else []
                if not target_cols or "*" in target_cols:
                    target_cols = [c for c in available_cols if not c.startswith("system.")]

                matching_cols = [c for c in target_cols if c in available_cols]
                if not matching_cols and available_cols:
                    matching_cols = [c for c in available_cols if not c.startswith("system.")]

                for col_name in matching_cols:
                    try:
                        docs = list(temp_client[dbname][col_name].find({}).limit(5000))
                        from app.database.connection import jsonable
                        clean_docs = [jsonable(d) for d in docs]
                        phash = hashlib.sha256(repr(sorted(clean_docs, key=repr)).encode()).hexdigest()[:32]

                        snapshot = {
                            "_id": new_id(),
                            "server_id": sid,
                            "database": dbname,
                            "collection": col_name,
                            "captured_at": captured_at,
                            "received_at": now,
                            "count": len(clean_docs),
                            "content_hash": phash,
                            "truncated": False,
                            "documents": clean_docs,
                        }
                        db.site_configs().insert_one(snapshot)
                        emit(
                            "config_snapshot",
                            {
                                "id": str(snapshot["_id"]),
                                "server_id": str(sid),
                                "database": dbname,
                                "collection": col_name,
                                "captured_at": captured_at,
                                "received_at": now.isoformat(),
                                "count": len(clean_docs),
                                "content_hash": phash,
                                "truncated": False,
                            },
                            room=f"server:{sid}",
                        )
                        synced_count += 1
                    except Exception:
                        pass
            temp_client.close()
            synced_from_hub = True
        except Exception:
            pass

    msg = (
        f"Backup connection verified & executed directly! ({synced_count} collections backed up)."
        if synced_from_hub
        else "Connection settings saved! Sent instant backup trigger command to remote site agent."
    )

    return {
        "success": True,
        "message": msg,
        "synced_from_hub": synced_from_hub,
        "synced_count": synced_count,
    }

