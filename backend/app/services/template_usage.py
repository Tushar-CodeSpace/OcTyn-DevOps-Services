"""Template usage calculation and site-specific assignment service."""

from datetime import datetime, timezone
from typing import Optional

from app.database import models as db
from app.database.connection import parse_id
from app.realtime import emit
from app.schemas.agent_config import TemplateServerUsage, TemplateSiteUsage


def now() -> datetime:
    return datetime.now(timezone.utc)


def _build_site_server_maps() -> tuple[dict[str, dict], dict[str, dict]]:
    sites = list(db.sites().find({}))
    sites_map = {str(s["_id"]): s for s in sites}
    servers = list(db.servers().find({}))
    servers_map = {str(s["_id"]): s for s in servers}
    return sites_map, servers_map


def get_all_runtime_template_usages():
    """Builds a cached resolver for runtime template site/server usage."""
    sites_map, servers_map = _build_site_server_maps()
    usage_by_template: dict[str, set[str]] = {}

    for sc in db.server_configs().find({}):
        sid = str(sc.get("server_id") or "")
        if not sid or sid not in servers_map:
            continue
        rt_id = str(sc.get("runtime_template_id") or "").strip()
        rt_name = str(sc.get("runtime_template_name") or "").strip()
        if rt_id:
            usage_by_template.setdefault(rt_id, set()).add(sid)
        if rt_name:
            usage_by_template.setdefault(rt_name, set()).add(sid)

    def for_template(t_id: str, t_name: str) -> tuple[list[TemplateSiteUsage], list[TemplateServerUsage], int]:
        server_ids = usage_by_template.get(t_id, set()) | usage_by_template.get(t_name, set())
        sites_grouped: dict[str, dict] = {}
        server_usages: list[TemplateServerUsage] = []

        for sid in sorted(server_ids):
            srv = servers_map[sid]
            site_id = str(srv.get("site_id") or "")
            site = sites_map.get(site_id)
            client_name = site.get("client", "Unknown Site") if site else "Unknown Site"
            location = site.get("location", "") if site else ""
            code = site.get("code", "") if site else ""
            site_display = f"{client_name} ({location})" if location else client_name

            server_usages.append(
                TemplateServerUsage(
                    server_id=sid,
                    server_name=srv.get("name", sid),
                    site_id=site_id,
                    site_name=site_display,
                )
            )

            if site_id not in sites_grouped:
                sites_grouped[site_id] = {
                    "site_id": site_id,
                    "client": client_name,
                    "location": location,
                    "code": code,
                    "servers": [],
                }
            sites_grouped[site_id]["servers"].append(srv.get("name", sid))

        site_usages = [
            TemplateSiteUsage(
                site_id=info["site_id"],
                client=info["client"],
                location=info["location"],
                code=info["code"],
                server_count=len(info["servers"]),
                servers=info["servers"],
            )
            for info in sorted(sites_grouped.values(), key=lambda x: x["client"])
        ]
        return site_usages, server_usages, len(server_ids)

    return for_template


def get_all_widget_template_usages():
    """Builds a cached resolver for custom widget template site/server usage."""
    sites_map, servers_map = _build_site_server_maps()
    usage_by_template: dict[str, set[str]] = {}

    configs = list(db.server_configs().find({
        "$or": [
            {"custom_widgets": {"$exists": True, "$ne": []}},
            {"widgets": {"$exists": True, "$ne": []}},
        ]
    }))
    for sc in configs:
        sid = str(sc.get("server_id") or "")
        if not sid or sid not in servers_map:
            continue
        all_widgets = sc.get("custom_widgets") or sc.get("widgets") or []
        for w in all_widgets:
            if not isinstance(w, dict):
                continue
            w_id = str(w.get("template_id") or "").strip()
            w_name = str(w.get("template_name") or w.get("name") or "").strip()
            if w_id:
                usage_by_template.setdefault(w_id, set()).add(sid)
            if w_name:
                usage_by_template.setdefault(w_name, set()).add(sid)

    def for_widget(w_id: str, w_name: str) -> tuple[list[TemplateSiteUsage], list[TemplateServerUsage], int]:
        server_ids = usage_by_template.get(w_id, set()) | usage_by_template.get(w_name, set())
        sites_grouped: dict[str, dict] = {}
        server_usages: list[TemplateServerUsage] = []

        for sid in sorted(server_ids):
            srv = servers_map[sid]
            site_id = str(srv.get("site_id") or "")
            site = sites_map.get(site_id)
            client_name = site.get("client", "Unknown Site") if site else "Unknown Site"
            location = site.get("location", "") if site else ""
            code = site.get("code", "") if site else ""
            site_display = f"{client_name} ({location})" if location else client_name

            server_usages.append(
                TemplateServerUsage(
                    server_id=sid,
                    server_name=srv.get("name", sid),
                    site_id=site_id,
                    site_name=site_display,
                )
            )

            if site_id not in sites_grouped:
                sites_grouped[site_id] = {
                    "site_id": site_id,
                    "client": client_name,
                    "location": location,
                    "code": code,
                    "servers": [],
                }
            sites_grouped[site_id]["servers"].append(srv.get("name", sid))

        site_usages = [
            TemplateSiteUsage(
                site_id=info["site_id"],
                client=info["client"],
                location=info["location"],
                code=info["code"],
                server_count=len(info["servers"]),
                servers=info["servers"],
            )
            for info in sorted(sites_grouped.values(), key=lambda x: x["client"])
        ]
        return site_usages, server_usages, len(server_ids)

    return for_widget


def assign_runtime_template_sites(template_id: str, site_ids: list[str]) -> int:
    """Assigns a runtime template strictly to servers in the specified sites.
    
    Unassigns servers in any other sites that previously used this template.
    """
    template = db.agent_config_templates().find_one({"_id": template_id})
    if not template:
        return 0

    site_id_objs = []
    for s in site_ids:
        pid = parse_id(s)
        if pid is not None:
            site_id_objs.append(pid)
        site_id_objs.append(s)

    target_servers = list(db.servers().find({"site_id": {"$in": site_id_objs}})) if site_id_objs else []
    target_server_ids = {str(s["_id"]) for s in target_servers}

    update_payload = {
        "monitoring_interval_seconds": int(template.get("monitoring_interval_seconds", 60)),
        "http_timeout_seconds": int(template.get("http_timeout_seconds", 10)),
        "http_retry_count": int(template.get("http_retry_count", 3)),
        "config_poll_interval_seconds": int(template.get("config_poll_interval_seconds", 5)),
        "connectivity_poll_interval_seconds": int(template.get("connectivity_poll_interval_seconds", 15)),
        "connectivity_targets": template.get("connectivity_targets", []),
        "runtime_template_id": template_id,
        "runtime_template_name": template["name"],
        "updated_at": now(),
    }

    count = 0
    # Apply to all servers in target sites
    for sid in target_server_ids:
        pid = parse_id(sid) or sid
        db.server_configs().update_one(
            {"server_id": pid},
            {"$set": update_payload},
            upsert=True,
        )
        emit("agent_config_updated", {"server_id": sid}, room=f"server:{sid}")
        count += 1

    # Unassign from servers in other sites
    previously_assigned = list(db.server_configs().find({
        "$or": [
            {"runtime_template_id": template_id},
            {"runtime_template_name": template["name"]},
        ]
    }))
    for sc in previously_assigned:
        sc_sid = str(sc.get("server_id") or "")
        if sc_sid and sc_sid not in target_server_ids:
            db.server_configs().update_one(
                {"_id": sc["_id"]},
                {"$set": {"runtime_template_id": None, "runtime_template_name": None, "updated_at": now()}},
            )
            emit("agent_config_updated", {"server_id": sc_sid}, room=f"server:{sc_sid}")

    return count


def assign_widget_template_sites(template_id: str, site_ids: list[str]) -> int:
    """Assigns a custom widget template strictly to servers in the specified sites.
    
    Removes or detaches widget from servers in any other sites.
    """
    template = db.widget_templates().find_one({"_id": template_id})
    if not template:
        return 0

    site_id_objs = []
    for s in site_ids:
        pid = parse_id(s)
        if pid is not None:
            site_id_objs.append(pid)
        site_id_objs.append(s)

    target_servers = list(db.servers().find({"site_id": {"$in": site_id_objs}})) if site_id_objs else []
    target_server_ids = {str(s["_id"]) for s in target_servers}

    spec = {
        "name": template["name"],
        "description": template.get("description", ""),
        "database": template["database"],
        "collection": template["collection"],
        "enabled": bool(template.get("enabled", True)),
        "poll_interval_seconds": int(template.get("poll_interval_seconds", 60)),
        "window_minutes": int(template.get("window_minutes", 60)),
        "group_by_field": template.get("group_by_field", "upload_status"),
        "time_field": template.get("time_field", "created_at"),
        "max_groups": int(template.get("max_groups", 10)),
        "alert_threshold_percent": float(template.get("alert_threshold_percent", 50.0)),
        "alert_window_minutes": int(template.get("alert_window_minutes", 15)),
        "include_values": template.get("include_values", []),
        "exclude_values": template.get("exclude_values", []),
        "template_id": template_id,
        "template_name": template["name"],
    }

    count = 0
    # Apply to all servers in target sites
    for sid in target_server_ids:
        pid = parse_id(sid) or sid
        sc = db.server_configs().find_one({"server_id": pid})
        existing_widgets = (sc.get("custom_widgets") or sc.get("widgets") or []) if sc else []
        idx = next((i for i, w in enumerate(existing_widgets) if w.get("template_id") == template_id or w.get("name") == template["name"]), -1)
        if idx >= 0:
            existing_widgets[idx] = spec
        else:
            existing_widgets.append(spec)
        db.server_configs().update_one(
            {"server_id": pid},
            {"$set": {"custom_widgets": existing_widgets, "widgets": existing_widgets, "updated_at": now()}},
            upsert=True,
        )
        emit("agent_config_updated", {"server_id": sid}, room=f"server:{sid}")
        count += 1

    # Unassign / remove from servers in other sites
    all_with_widget = list(db.server_configs().find({
        "$or": [
            {"custom_widgets": {"$exists": True, "$ne": []}},
            {"widgets": {"$exists": True, "$ne": []}},
        ]
    }))
    for sc in all_with_widget:
        sc_sid = str(sc.get("server_id") or "")
        if sc_sid and sc_sid not in target_server_ids:
            widgets = sc.get("custom_widgets") or sc.get("widgets") or []
            new_widgets = [w for w in widgets if w.get("template_id") != template_id and w.get("name") != template["name"]]
            if len(new_widgets) != len(widgets):
                db.server_configs().update_one(
                    {"_id": sc["_id"]},
                    {"$set": {"custom_widgets": new_widgets, "widgets": new_widgets, "updated_at": now()}},
                )
                from app.database.connection import parse_id
                db.widget_data().delete_many({"server_id": parse_id(sc_sid), "widget_name": template["name"]})
                emit("agent_config_updated", {"server_id": sc_sid}, room=f"server:{sc_sid}")

    return count
