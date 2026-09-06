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
    """Safely percent-encode password in MongoDB URI if needed."""
    if not uri or "://" not in uri:
        return uri
    try:
        from pymongo.uri_parser import parse_uri
        parse_uri(uri)
        return uri
    except Exception:
        pass

    try:
        import urllib.parse
        prefix, rest = uri.split("://", 1)
        if "@" in rest:
            user_info, host_info = rest.rsplit("@", 1)
            if ":" in user_info:
                user, password = user_info.split(":", 1)
                encoded_pass = urllib.parse.quote(password, safe="")
                return f"{prefix}://{user}:{encoded_pass}@{host_info}"
    except Exception:
        pass
    return uri


def sync_configs() -> None:
    """Snapshot mapped collections from the site MongoDB and push changes to hub."""
    if not HAS_PYMONGO:
        log("config sync skipped: pymongo not installed")
        return

    uri = _encode_uri_password(mongo_uri())
    if not uri:
        return
    auth_source = mongo_auth_source()

    client = None
    connected = False

    for src in filter(None, [auth_source, "admin", "test"]):
        try:
            temp_client = MongoClient(uri, authSource=src, serverSelectionTimeoutMS=5000)
            temp_client[src].command("ping")
            client = temp_client
            connected = True
            break
        except Exception:
            try:
                if temp_client:
                    temp_client.close()
            except Exception:
                pass

    if not connected or not client:
        try:
            client = MongoClient(uri, serverSelectionTimeoutMS=5000)
            client.admin.command("ping")
            connected = True
        except Exception as exc:
            log(f"config sync skipped: cannot reach site mongodb: {exc!r}")
            if client:
                client.close()
            return

    captured_at = datetime.now(timezone.utc).isoformat()
    db_names = set()
    try:
        db_names = set(client.list_database_names())
    except Exception:
        pass

    sent = skipped = missing = 0
    for database, collections in config_collections().items():
        if db_names and database not in db_names:
            missing += len(collections)
            continue
        try:
            coll_names = set(client[database].list_collection_names())
        except Exception:
            missing += len(collections)
            continue

        for name in collections:
            if name not in coll_names:
                missing += 1
                continue
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
