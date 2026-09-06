"""MongoDB document collections for the monitoring platform."""

from pymongo.collection import Collection

from app.database.connection import get_db


def sites() -> Collection:
    return get_db()["sites"]


def servers() -> Collection:
    return get_db()["servers"]


def metrics() -> Collection:
    return get_db()["metrics"]


def services() -> Collection:
    return get_db()["services"]


def alerts() -> Collection:
    return get_db()["alerts"]


def users() -> Collection:
    return get_db()["users"]


def api_keys() -> Collection:
    return get_db()["api_keys"]


def settings() -> Collection:
    return get_db()["settings"]


def site_configs() -> Collection:
    return get_db()["site_configs"]


def server_configs() -> Collection:
    return get_db()["server_configs"]


def connectivity() -> Collection:
    return get_db()["connectivity"]


def audit_logs() -> Collection:
    return get_db()["audit_logs"]


def terminal_commands() -> Collection:
    return get_db()["terminal_commands"]
