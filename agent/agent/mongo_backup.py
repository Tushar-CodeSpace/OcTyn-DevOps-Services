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


def _sanitize_uri(uri: str) -> str:
    """Mask password in MongoDB URI string for safe logging."""
    if not uri or "://" not in uri:
        return uri
    try:
        prefix, rest = uri.split("://", 1)
        if "@" in rest:
            userinfo, host = rest.rsplit("@", 1)
            if ":" in userinfo:
                user, _ = userinfo.split(":", 1)
                return f"{prefix}://{user}:*****@{host}"
    except Exception:
        pass
    return uri


def _extract_auth_sources(raw_uri: str, configured_auth: str) -> List[str]:
    """Build prioritized list of potential authentication databases to try."""
    sources = []
    if configured_auth:
        sources.append(str(configured_auth).strip())
    try:
        import urllib.parse
        parsed = urllib.parse.urlparse(raw_uri)
        if parsed.path and parsed.path.strip("/"):
            sources.append(parsed.path.strip("/").split("/")[0])
        qp = urllib.parse.parse_qs(parsed.query)
        if "authSource" in qp:
            sources.extend(qp["authSource"])
    except Exception:
        pass

    try:
        from agent.config import config_collections
        cmap = config_collections()
        if isinstance(cmap, dict):
            sources.extend(list(cmap.keys()))
    except Exception:
        pass

    sources.extend(["admin", "identity_service", "auth_api", "Master", "bagging", "sorting_service", "test"])
    seen = set()
    out = []
    for s in sources:
        sc = str(s).strip()
        if sc and sc not in seen:
            seen.add(sc)
            out.append(sc)
    return out


def sync_configs() -> None:
    """Snapshot mapped collections from the site MongoDB and push changes to hub."""
    if not HAS_PYMONGO:
        log("[CONFIG-SYNC] Skipped: pymongo not installed")
        return

    log("[CONFIG-SYNC] Backup trigger initiated. Pulling live config from central hub...")
    try:
        from agent.config import apply_agent_config
        from agent.transport import fetch_agent_config
        hub_cfg = fetch_agent_config()
        if hub_cfg:
            apply_agent_config(hub_cfg)
            log("[CONFIG-SYNC] Latest hub config applied successfully.")
    except Exception as exc:
        log(f"[CONFIG-SYNC] Hub config fetch warning: {exc!r}")

    raw_uri = mongo_uri()
    auth_source = mongo_auth_source()
    log(f"[CONFIG-SYNC] Effective settings -> mongo_uri={_sanitize_uri(raw_uri)} auth_source={auth_source}")

    primary_uri = _encode_uri_password(raw_uri)
    if not primary_uri:
        log("[CONFIG-SYNC] Skipped: mongo_uri is empty")
        return

    # Prepare URI variations (original URI and 127.0.0.1 variant if localhost)
    uri_candidates = [primary_uri]
    if "localhost" in primary_uri:
        uri_candidates.append(primary_uri.replace("localhost", "127.0.0.1"))

    auth_candidates = _extract_auth_sources(raw_uri, auth_source)
    client = None
    connected = False
    last_err = None

    for target_uri in uri_candidates:
        if connected:
            break

        log(f"[CONFIG-SYNC] Connecting to MongoDB at {_sanitize_uri(target_uri)}...")

        # 1. Try native URI first
        temp_client = None
        try:
            temp_client = MongoClient(target_uri, serverSelectionTimeoutMS=5000, directConnection=True)
            temp_client.admin.command("ping")
            client = temp_client
            connected = True
            log("[CONFIG-SYNC] Native URI ping succeeded.")
            break
        except Exception as exc:
            last_err = exc
            if temp_client:
                try:
                    temp_client.close()
                except Exception:
                    pass

        # 2. Try candidate authSource databases
        for src in auth_candidates:
            temp_client = None
            try:
                log(f"[CONFIG-SYNC] Trying MongoClient with authSource='{src}'...")
                temp_client = MongoClient(target_uri, authSource=src, serverSelectionTimeoutMS=5000, directConnection=True)
                temp_client[src].command("ping")
                client = temp_client
                connected = True
                log(f"[CONFIG-SYNC] Auth ping succeeded with authSource='{src}'.")
                break
            except Exception as exc:
                last_err = exc
                if temp_client:
                    try:
                        temp_client.close()
                    except Exception:
                        pass

    if not connected or not client:
        log(f"[CONFIG-SYNC] FAILED: Cannot connect to site MongoDB ({last_err!r})")
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
        log(f"[CONFIG-SYNC] Connected! Discovered databases: {sorted(list(db_names))}")
    except Exception as exc:
        log(f"[CONFIG-SYNC] Warning listing database names: {exc!r}")

    cfg_map = dict(config_collections())
    if not cfg_map and db_names:
        for dbname in db_names:
            if dbname not in {"admin", "config", "local"}:
                cfg_map[dbname] = ["*"]

    log(f"[CONFIG-SYNC] Mapped collections to backup: {cfg_map}")

    sent = skipped = missing = 0
    for database, collections in cfg_map.items():
        if db_names and database not in db_names:
            missing += len(collections) if collections else 1
            log(f"[CONFIG-SYNC] Database '{database}' not found in MongoDB instance.")
            continue
        try:
            coll_names = set(client[database].list_collection_names())
        except Exception as exc:
            log(f"[CONFIG-SYNC] Cannot list collections in '{database}': {exc!r}")
            missing += len(collections) if collections else 1
            continue

        target_cols = [c for c in collections if c] if isinstance(collections, list) else []
        if not target_cols or "*" in target_cols:
            target_cols = [c for c in coll_names if not c.startswith("system.")]

        matching_cols = [c for c in target_cols if c in coll_names]
        if not matching_cols and coll_names:
            matching_cols = [c for c in coll_names if not c.startswith("system.")]

        if not matching_cols:
            log(f"[CONFIG-SYNC] No matching collections found in '{database}' for target list {collections}")
            missing += len(target_cols) or 1
            continue

        for name in matching_cols:
            docs = [_jsonable(d) for d in client[database][name].find({}).limit(MAX_DOCS_PER_SNAPSHOT + 1)]
            truncated = len(docs) > MAX_DOCS_PER_SNAPSHOT
            docs = docs[:MAX_DOCS_PER_SNAPSHOT]
            payload_hash = hashlib.sha256(repr(sorted(docs, key=repr)).encode()).hexdigest()[:32]
            log(f"[CONFIG-SYNC] Uploading {database}.{name} ({len(docs)} documents, hash={payload_hash})...")
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
                        log(f"[CONFIG-SYNC] Upload {database}.{name} SUCCESS: stored new version.")
                    else:
                        skipped += 1
                        log(f"[CONFIG-SYNC] Upload {database}.{name} SUCCESS: content unchanged (hash match).")
            except Exception as exc:
                log(f"[CONFIG-SYNC] Upload {database}.{name} FAILED: {exc!r}")

    client.close()
    log(f"[CONFIG-SYNC] Finished backup! Pushed={sent}, Unchanged={skipped}, Missing={missing}")
