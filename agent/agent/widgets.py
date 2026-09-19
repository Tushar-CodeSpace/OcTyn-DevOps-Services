"""Custom data-widget poller.

Executes user-configured MongoDB count aggregations on the site database
(e.g. count ``data_uploader_service.integration_logs`` over the last N
minutes grouped by ``upload_status`` -> {SUCCESS: n, FAILED: m}) and pushes
each tally to the central hub, where the dashboard renders one card per
widget.
"""

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from agent.config import (
    SERVER_ID,
    custom_widgets,
    log,
    mongo_auth_source,
    mongo_config_enabled,
    mongo_uri,
)
from agent.mongo_backup import (
    HAS_PYMONGO,
    MongoClient,
    _encode_uri_password,
    _extract_auth_sources,
    _parse_mongo_credentials,
    _sanitize_uri,
)
from agent.transport import push

# widget name -> monotonic timestamp of last successful scheduling
_LAST_RUN: Dict[str, float] = {}


def _connect():
    """Connect to the site MongoDB (same fallback strategy as config backup)."""
    raw_uri = mongo_uri()
    primary_uri = _encode_uri_password(raw_uri)
    if not primary_uri:
        return None
    uri_candidates = [primary_uri]
    if "localhost" in primary_uri:
        uri_candidates.append(primary_uri.replace("localhost", "127.0.0.1"))
        uri_candidates.append(primary_uri.replace("localhost", "host.docker.internal"))
        uri_candidates.append(primary_uri.replace("localhost", "172.17.0.1"))
    elif "127.0.0.1" in primary_uri:
        uri_candidates.append(primary_uri.replace("127.0.0.1", "localhost"))
        uri_candidates.append(primary_uri.replace("127.0.0.1", "host.docker.internal"))
        uri_candidates.append(primary_uri.replace("127.0.0.1", "172.17.0.1"))
    auth_candidates = _extract_auth_sources(raw_uri, mongo_auth_source())
    creds = _parse_mongo_credentials(raw_uri)

    for target_uri in uri_candidates:
        for attempt in _connect_attempts(target_uri, auth_candidates, creds):
            if attempt is not None:
                return attempt
    return None


def _connect_attempts(target_uri: str, auth_candidates: List[str], creds: Optional[Dict[str, str]]):
    """Yield a connected client (single yield) or nothing."""
    for dc in (True, False):
        temp_client = None
        try:
            temp_client = MongoClient(target_uri, serverSelectionTimeoutMS=4000, directConnection=dc)
            temp_client.admin.command("ping")
            yield temp_client
            return
        except Exception:
            if temp_client:
                try:
                    temp_client.close()
                except Exception:
                    pass
    for src in auth_candidates:
        for dc in (True, False):
            temp_client = None
            try:
                temp_client = MongoClient(
                    target_uri, authSource=src, serverSelectionTimeoutMS=4000, directConnection=dc
                )
                temp_client.admin.command("ping")
                yield temp_client
                return
            except Exception:
                if temp_client:
                    try:
                        temp_client.close()
                    except Exception:
                        pass
    if creds:
        host_candidates = [creds["host_uri"]]
        if "localhost" in creds["host_uri"]:
            host_candidates.append(creds["host_uri"].replace("localhost", "127.0.0.1"))
            host_candidates.append(creds["host_uri"].replace("localhost", "host.docker.internal"))
            host_candidates.append(creds["host_uri"].replace("localhost", "172.17.0.1"))
        pass_candidates = []
        if creds["password"]:
            pass_candidates.append(creds["password"])
        if creds["raw_password"] and creds["raw_password"] != creds["password"]:
            pass_candidates.append(creds["raw_password"])
        for h_uri in host_candidates:
            for p_val in pass_candidates:
                for src in auth_candidates:
                    for dc in (True, False):
                        temp_client = None
                        try:
                            temp_client = MongoClient(
                                h_uri,
                                username=creds["username"],
                                password=p_val,
                                authSource=src,
                                serverSelectionTimeoutMS=4000,
                                directConnection=dc,
                            )
                            temp_client.admin.command("ping")
                            yield temp_client
                            return
                        except Exception:
                            if temp_client:
                                try:
                                    temp_client.close()
                                except Exception:
                                    pass


def _lookup(doc: Any, dotted: str) -> Any:
    """Walk a dotted field path inside a document; None if missing."""
    cur = doc
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _detect_cutoff(coll, time_field: str, cutoff: datetime) -> Any:
    """Return a cutoff value matching the stored type of the time field.

    Log collections may store datetimes (``created_at``) or ISO strings
    (``timestamps.requested_at``); probe one doc so the window filter matches.
    """
    try:
        sample = coll.find_one(
            {time_field: {"$exists": True}}, projection={time_field: 1}, sort=[("_id", -1)]
        )
    except Exception:
        return cutoff
    val = _lookup(sample, time_field) if sample else None
    if isinstance(val, str):
        try:
            # naive ISO strings compare lexicographically in chronological order
            return cutoff.replace(tzinfo=None).isoformat()
        except Exception:
            return cutoff
    return cutoff


def _coerce_val_candidates(vals: List[Any]) -> List[Any]:
    candidates = []
    for v in vals:
        if v == "":
            candidates.append("")
            continue
        if v is None:
            candidates.append(None)
            continue
        s = str(v).strip()
        if not s:
            continue
        candidates.append(s)
        try:
            if s.isdigit():
                candidates.append(int(s))
            else:
                candidates.append(float(s))
        except ValueError:
            pass
        if s.lower() == "true":
            candidates.append(True)
        elif s.lower() == "false":
            candidates.append(False)
        elif s.lower() in ("null", "none"):
            candidates.append(None)
    out = []
    for c in candidates:
        if c not in out:
            out.append(c)
    return out


def _parse_field_conditions(entries: List[Any], default_field: str) -> Dict[str, List[Any]]:
    """Parse include/exclude entries into mapping of field -> list of values.
    Supports plain values ('SKIPPED'), 'field: value' ('rejection_data.display_rejection: PSTR'),
    empty string ('rejection_data.display_rejection: ""' or '""'), 'where field: value',
    'field = value', and bracketed lists 'field: [A, B]'.
    """
    res: Dict[str, List[Any]] = {}
    for item in entries:
        if item is None:
            continue
        s = str(item).strip()
        if s.lower().startswith("where "):
            s = s[6:].strip()
        has_delim = False
        field = default_field
        val_str = s
        if ":" in s:
            parts = s.split(":", 1)
            field = parts[0].strip()
            val_str = parts[1].strip()
            has_delim = True
        elif "=" in s:
            parts = s.split("=", 1)
            field = parts[0].strip()
            val_str = parts[1].strip()
            has_delim = True
        if not field:
            field = default_field

        vals = []
        if val_str.startswith("[") and val_str.endswith("]"):
            inner = val_str[1:-1]
            for x in inner.split(","):
                xs = x.strip()
                if xs in ('""', "''"):
                    vals.append("")
                else:
                    c = xs.strip("'\"")
                    if c or xs in ('""', "''"):
                        vals.append(c)
        elif val_str in ('""', "''"):
            vals = [""]
        elif has_delim and val_str == "":
            vals = [""]
        else:
            cleaned = val_str.strip("'\"")
            if cleaned or val_str in ('""', "''"):
                vals = [cleaned]
            elif not has_delim and not s:
                continue

        if field not in res:
            res[field] = []
        for v in vals:
            if v not in res[field]:
                res[field].append(v)
    return res


def collect_widget(client, widget: Dict[str, Any]) -> Dict[str, Any]:
    """Run one widget aggregation; always returns a hub-ready payload."""
    database = widget["database"]
    collection = widget["collection"]
    window = widget["window_minutes"]
    group_by = widget["group_by_field"]
    time_field = widget["time_field"]
    max_groups = widget["max_groups"]
    include_vals = widget.get("include_values") or []
    exclude_vals = widget.get("exclude_values") or []
    collected_at = datetime.now(timezone.utc)
    cutoff = collected_at - timedelta(minutes=window)

    def _error(msg: str) -> Dict[str, Any]:
        return _payload(widget, collected_at, window, 0, {}, error=msg)

    try:
        if database not in client.list_database_names():
            return _error(f"database '{database}' not found")
        coll = client[database][collection]
        try:
            if collection not in coll.database.list_collection_names():
                return _error(f"collection '{database}.{collection}' not found")
        except Exception:
            pass
        cutoff_value = _detect_cutoff(coll, time_field, cutoff)
        match: Dict[str, Any] = {time_field: {"$gte": cutoff_value}}
        inc_by_field = _parse_field_conditions(include_vals, group_by)
        exc_by_field = _parse_field_conditions(exclude_vals, group_by)

        all_filter_fields = set(inc_by_field.keys()) | set(exc_by_field.keys())
        for f in all_filter_fields:
            f_filter = {}
            if f in inc_by_field:
                inc_c = _coerce_val_candidates(inc_by_field[f])
                if inc_c:
                    f_filter["$in"] = inc_c
            if f in exc_by_field:
                exc_c = _coerce_val_candidates(exc_by_field[f])
                if exc_c:
                    f_filter["$nin"] = exc_c
            if f_filter:
                if f in match and isinstance(match[f], dict):
                    match[f].update(f_filter)
                else:
                    match[f] = f_filter

        try:
            total = coll.count_documents(match, maxTimeMS=20000)
        except Exception as exc:
            return _error(f"count failed: {exc}")
        groups: Dict[str, int] = {}
        try:
            pipeline = [
                {"$match": match},
                {"$group": {"_id": "$" + group_by, "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},
                {"$limit": max(1, max_groups)},
            ]
            for row in coll.aggregate(pipeline, maxTimeMS=20000):
                key = row.get("_id")
                label = "UNKNOWN" if key is None else str(key)[:100]
                try:
                    groups[label] = int(row.get("count", 0))
                except (TypeError, ValueError):
                    continue
        except Exception as exc:
            return _error(f"group-by failed: {exc}")

        # Post-filter groups for group_by field conditions if specified
        if group_by in inc_by_field:
            inc_set = {str(x).strip().lower() for x in inc_by_field[group_by] if str(x).strip()}
            groups = {k: v for k, v in groups.items() if str(k).strip().lower() in inc_set}
        if group_by in exc_by_field:
            exc_set = {str(x).strip().lower() for x in exc_by_field[group_by] if str(x).strip()}
            groups = {k: v for k, v in groups.items() if str(k).strip().lower() not in exc_set}
        if total < sum(groups.values()):
            total = sum(groups.values())

        return _payload(widget, collected_at, window, total, groups)
    except Exception as exc:
        return _payload(widget, collected_at, window, 0, {}, error=str(exc)[:300])


def _payload(
    widget: Dict[str, Any],
    collected_at: datetime,
    window: int,
    total: int,
    groups: Dict[str, int],
    error: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "server_id": SERVER_ID,
        "widget_name": widget["name"],
        "database": widget["database"],
        "collection": widget["collection"],
        "window_minutes": window,
        "total": max(0, int(total)),
        "groups": {str(k)[:100]: max(0, int(v)) for k, v in groups.items()},
        "collected_at": collected_at.isoformat(),
        "error": (error or "")[:500] or None,
    }


def push_widgets() -> None:
    """Collect and push every due (interval-elapsed) enabled widget."""
    widgets = [w for w in custom_widgets() if w.get("enabled", True)]
    if not widgets:
        return
    if not mongo_config_enabled():
        log("[WIDGETS] Skipped: site MongoDB access is disabled in agent config")
        return
    if not HAS_PYMONGO:
        log("[WIDGETS] Skipped: pymongo not installed")
        return

    now_mono = time.monotonic()
    due = []
    for w in widgets:
        last = _LAST_RUN.get(w["name"], 0.0)
        if now_mono - last >= w["poll_interval_seconds"]:
            due.append(w)
    if not due:
        return

    try:
        client = _connect()
    except Exception as exc:
        log(f"[WIDGETS] Connect error: {exc!r}")
        return
    if client is None:
        log(f"[WIDGETS] FAILED: cannot reach site MongoDB at {_sanitize_uri(mongo_uri())}")
        return
    try:
        for w in due:
            try:
                payload = collect_widget(client, w)
                if push("/widgets", payload):
                    _LAST_RUN[w["name"]] = time.monotonic()
                    if payload.get("error"):
                        log(f"[WIDGETS] '{w['name']}': reported error: {payload['error']}")
                    else:
                        log(
                            "[WIDGETS] '%s': total=%d groups=%s"
                            % (w["name"], payload["total"], payload["groups"])
                        )
                else:
                    log(f"[WIDGETS] '{w['name']}': push failed, will retry next tick")
            except Exception as exc:
                log(f"[WIDGETS] '{w.get('name', '?')}' error: {exc!r}")
    finally:
        try:
            client.close()
        except Exception:
            pass


def start_widget_poller() -> None:
    """Start background thread ticking due custom-widget collections."""

    def _poll() -> None:
        while True:
            try:
                push_widgets()
            except Exception as exc:
                log(f"[WIDGETS] poll error: {exc!r}")
            time.sleep(10)

    threading.Thread(target=_poll, name="widget-poller", daemon=True).start()
