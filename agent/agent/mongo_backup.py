"""Site MongoDB configuration collections snapshot and backup sync."""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, List
from urllib.request import Request, urlopen

try:
    from pymongo import MongoClient
    HAS_PYMONGO = True
except ImportError:
    MongoClient = None
    HAS_PYMONGO = False

from agent.config import (
    API_KEY,
    API_URL,
    config_collections,
    http_timeout,
    log,
    mongo_auth_source,
    mongo_uri,
)

MAX_DOCS_PER_SNAPSHOT = 50_000


def _jsonable(value: Any) -> Any:
    """Recursively convert BSON and non-JSON-serializable types into JSON-safe values."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if hasattr(value, "binary"):
        return value.binary.hex()
    return str(value)


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


def sync_configs() -> None:
    """Snapshot mapped collections from the site MongoDB and push changes to hub."""
    if not HAS_PYMONGO:
        log("config sync skipped: pymongo not installed")
        return

    try:
        from agent.config import apply_agent_config
        from agent.transport import fetch_agent_config
        hub_cfg = fetch_agent_config()
        if hub_cfg:
            apply_agent_config(hub_cfg)
    except Exception:
        pass

    uri = _encode_uri_password(mongo_uri())
    if not uri:
        log("config sync skipped: mongo_uri is empty")
        return
    auth_source = mongo_auth_source()

    client = None
    connected = False

    # 1. Try URI natively first (respects authSource or database embedded in URI)
    temp_client = None
    try:
        temp_client = MongoClient(uri, serverSelectionTimeoutMS=5000, directConnection=True)
        temp_client.admin.command("ping")
        client = temp_client
        connected = True
    except Exception:
        if temp_client:
            try:
                temp_client.close()
            except Exception:
                pass

    # 2. Try configured authSource and fallbacks
    if not connected:
        for src in filter(None, [auth_source, "admin", "test"]):
            temp_client = None
            try:
                temp_client = MongoClient(uri, authSource=src, serverSelectionTimeoutMS=5000, directConnection=True)
                temp_client[src].command("ping")
                client = temp_client
                connected = True
                break
            except Exception:
                if temp_client:
                    try:
                        temp_client.close()
                    except Exception:
                        pass
    if not connected or not client:
        log("config sync skipped: cannot reach site mongodb (auth/connection failed)")
        if client:
            try:
                client.close()
            except Exception:
                pass
        return

    captured_at = datetime.now(timezone.utc).isoformat()
    db_names = set()
    try:
        db_names = set(client.list_database_names())
    except Exception:
        pass

    cfg_map = dict(config_collections())
    if not cfg_map and db_names:
        for dbname in db_names:
            if dbname not in {"admin", "config", "local"}:
                cfg_map[dbname] = ["*"]

    sent = skipped = missing = 0
    for database, collections in cfg_map.items():
        if db_names and database not in db_names:
            missing += len(collections) if collections else 1
            continue
        try:
            coll_names = set(client[database].list_collection_names())
        except Exception:
            missing += len(collections) if collections else 1
            continue

        target_cols = [c for c in collections if c] if isinstance(collections, list) else []
        if not target_cols or "*" in target_cols:
            target_cols = [c for c in coll_names if not c.startswith("system.")]

        matching_cols = [c for c in target_cols if c in coll_names]
        if not matching_cols and coll_names:
            matching_cols = [c for c in coll_names if not c.startswith("system.")]

        if not matching_cols:
            missing += len(target_cols) or 1
            continue

        for name in matching_cols:
            docs = [_jsonable(d) for d in client[database][name].find({}).limit(MAX_DOCS_PER_SNAPSHOT + 1)]
            truncated = len(docs) > MAX_DOCS_PER_SNAPSHOT
            docs = docs[:MAX_DOCS_PER_SNAPSHOT]
            payload_hash = hashlib.sha256(repr(sorted(docs, key=repr)).encode()).hexdigest()[:32]
            req = Request(
                f"{API_URL}/configs/ingest",
                data=json.dumps({
                    "database": database,
                    "collection": name,
                    "captured_at": captured_at,
                    "count": len(docs),
                    "content_hash": payload_hash,
                    "documents": docs,
                    "truncated": truncated,
                }).encode(),
                headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
                method="POST",
            )
            try:
                with urlopen(req, timeout=http_timeout()) as resp:
                    body = json.loads(resp.read(500) or b"{}")
                    if body.get("stored"):
                        sent += 1
                    else:
                        skipped += 1
            except Exception as exc:
                log(f"config upload {database}.{name} failed: {exc!r}")

    client.close()
    log(f"config sync done: pushed={sent} unchanged={skipped} missing={missing}")
