"""Ensure all required MongoDB indexes exist (idempotent, run at startup).

An index is only created when no existing index shares the same key pattern,
so this is safe against indexes created by the init script or earlier runs.
"""

from pymongo.collection import Collection

from app.database import models as db


def _ensure_index(collection: Collection, keys, **options) -> None:
    """Create the index if missing; upgrade to the requested options otherwise."""
    for name, info in list(collection.index_information().items()):
        if list(info["key"]) != list(keys):
            continue
        # Existing index matches the key pattern but lacks requested options
        # (e.g. a legacy non-unique index where unique is required): rebuild it.
        if options.get("unique") and not info.get("unique"):
            collection.drop_index(name)
            break
        return
    collection.create_index(keys, **options)


def ensure_indexes() -> None:
    # 7 days retention in seconds (7 * 86400 = 604,800s)
    ttl_seconds = 604_800

    _ensure_index(db.metrics(), [("server_id", 1), ("recorded_at", 1)])
    _ensure_index(db.metrics(), [("recorded_at", 1)], expireAfterSeconds=ttl_seconds)
    _ensure_index(db.site_configs(), [("received_at", 1)], expireAfterSeconds=ttl_seconds)
    _ensure_index(db.terminal_commands(), [("created_at", 1)], expireAfterSeconds=ttl_seconds)
    _ensure_index(db.api_keys(), [("key_hash", 1)], unique=True)
    _ensure_index(db.api_keys(), [("server_id", 1)])
    _ensure_index(db.users(), [("email", 1)], unique=True)
    _ensure_index(db.services(), [("server_id", 1), ("name", 1)], unique=True)
    _ensure_index(db.alerts(), [("status", 1), ("created_at", -1)])
    _ensure_index(db.alerts(), [("server_id", 1), ("status", 1)])
    _ensure_index(
        db.alerts(),
        [("type", 1), ("server_id", 1), ("service_name", 1)],
        partialFilterExpression={"status": "active"},
        unique=True,
    )
    _ensure_index(
        db.site_configs(),
        [("server_id", 1), ("database", 1), ("collection", 1), ("received_at", -1)]
    )