import os
import sys
sys.path.insert(0, os.path.abspath("."))

from app.database import models as db
from app.database.connection import new_id
from app.services.template_usage import (
    assign_runtime_template_sites,
    assign_widget_template_sites,
    get_all_runtime_template_usages,
    get_all_widget_template_usages,
)
from app.routes.agent_config_templates import propagate_runtime_template
from app.routes.widgets import propagate_widget_template


def run_tests():
    print("=== Starting Site-Scoped Template Synchronization Tests ===")

    # 1. Setup mock test sites
    site_b_id = f"site_b_{new_id()[:8]}"
    site_y_id = f"site_y_{new_id()[:8]}"
    site_other_id = f"site_other_{new_id()[:8]}"

    db.sites().insert_many([
        {"_id": site_b_id, "client": "Client Beta", "location": "Mumbai", "code": "BOM"},
        {"_id": site_y_id, "client": "Client Yankee", "location": "Pune", "code": "PNQ"},
        {"_id": site_other_id, "client": "Client Other", "location": "Delhi", "code": "DEL"},
    ])

    # 2. Setup mock servers
    srv_b1 = f"srv_b1_{new_id()[:8]}"
    srv_b2 = f"srv_b2_{new_id()[:8]}"
    srv_y1 = f"srv_y1_{new_id()[:8]}"
    srv_other = f"srv_other_{new_id()[:8]}"

    db.servers().insert_many([
        {"_id": srv_b1, "name": "beta-app-1", "site_id": site_b_id, "hostname": "beta-1"},
        {"_id": srv_b2, "name": "beta-app-2", "site_id": site_b_id, "hostname": "beta-2"},
        {"_id": srv_y1, "name": "yankee-db-1", "site_id": site_y_id, "hostname": "yankee-1"},
        {"_id": srv_other, "name": "other-node-1", "site_id": site_other_id, "hostname": "other-1"},
    ])

    # 3. Create Runtime Template A
    tpl_a_id = f"tpl_a_{new_id()[:8]}"
    tpl_a_name = f"Profile Alpha {new_id()[:6]}"
    db.agent_config_templates().insert_one({
        "_id": tpl_a_id,
        "name": tpl_a_name,
        "description": "Template A test",
        "monitoring_interval_seconds": 30,
        "http_timeout_seconds": 8,
        "http_retry_count": 2,
        "config_poll_interval_seconds": 5,
        "connectivity_poll_interval_seconds": 12,
        "connectivity_targets": [{"name": "PLC-B", "ip": "10.0.1.5"}],
    })

    # 4. Assign Template A to Site B and Site Y ONLY
    assigned_count = assign_runtime_template_sites(tpl_a_id, [site_b_id, site_y_id])
    print(f"[TEST 1] Assigned Template A to Site B & Y -> {assigned_count} servers updated")
    assert assigned_count == 3, f"Expected 3 servers (2 in B, 1 in Y), got {assigned_count}"

    # Verify usage resolver
    resolver = get_all_runtime_template_usages()
    used_sites, used_servers, count = resolver(tpl_a_id, tpl_a_name)
    used_site_ids = {s.site_id for s in used_sites}
    print(f"[TEST 2] Template A linked sites: {used_site_ids}")
    assert site_b_id in used_site_ids, "Site B must be linked"
    assert site_y_id in used_site_ids, "Site Y must be linked"
    assert site_other_id not in used_site_ids, "Site Other must NOT be linked"
    assert count == 3, f"Expected 3 total servers, got {count}"

    # 5. Modify Template A settings (e.g. interval = 10s)
    new_template_data = {
        "name": tpl_a_name,
        "monitoring_interval_seconds": 10,  # Changed from 30 to 10
        "http_timeout_seconds": 5,
        "http_retry_count": 3,
        "config_poll_interval_seconds": 3,
        "connectivity_poll_interval_seconds": 8,
        "connectivity_targets": [{"name": "PLC-B", "ip": "10.0.1.5"}],
    }

    # Propagate changes
    prop_count = propagate_runtime_template(tpl_a_id, new_template_data)
    print(f"[TEST 3] Propagating Template A changes -> {prop_count} servers updated")
    assert prop_count == 3, f"Expected changes to propagate to 3 servers only, got {prop_count}"

    # Verify that Site B and Site Y servers got interval 10, while other server is untouched
    sc_b1 = db.server_configs().find_one({"server_id": srv_b1})
    sc_y1 = db.server_configs().find_one({"server_id": srv_y1})
    sc_other = db.server_configs().find_one({"server_id": srv_other})

    assert sc_b1["monitoring_interval_seconds"] == 10, "Server B1 must be updated to 10s"
    assert sc_y1["monitoring_interval_seconds"] == 10, "Server Y1 must be updated to 10s"
    assert sc_other is None or sc_other.get("runtime_template_id") != tpl_a_id, "Other server must NOT have Template A"

    # 6. Test Widget Template Site Assignment
    w_a_id = f"w_a_{new_id()[:8]}"
    w_a_name = f"Widget Alpha {new_id()[:6]}"
    db.widget_templates().insert_one({
        "_id": w_a_id,
        "name": w_a_name,
        "database": "analytic_service",
        "collection": "integration_logs",
        "enabled": True,
        "poll_interval_seconds": 45,
        "window_minutes": 30,
        "group_by_field": "upload_status",
        "time_field": "created_at",
        "max_groups": 5,
        "alert_threshold_percent": 40.0,
        "alert_window_minutes": 10,
    })

    w_assigned_count = assign_widget_template_sites(w_a_id, [site_b_id, site_y_id])
    print(f"[TEST 4] Assigned Widget A to Site B & Y -> {w_assigned_count} servers updated")
    assert w_assigned_count == 3, f"Expected 3 servers for widget, got {w_assigned_count}"

    w_resolver = get_all_widget_template_usages()
    w_sites, w_servers, w_count = w_resolver(w_a_id, w_a_name)
    w_site_ids = {s.site_id for s in w_sites}
    print(f"[TEST 5] Widget A linked sites: {w_site_ids}")
    assert site_b_id in w_site_ids, "Site B must have Widget A"
    assert site_y_id in w_site_ids, "Site Y must have Widget A"
    assert site_other_id not in w_site_ids, "Site Other must NOT have Widget A"

    # Propagate Widget changes
    updated_w_data = {
        "name": w_a_name,
        "database": "analytic_service",
        "collection": "integration_logs",
        "poll_interval_seconds": 15,  # Changed from 45 to 15
        "window_minutes": 20,
        "group_by_field": "upload_status",
        "time_field": "created_at",
        "max_groups": 8,
        "alert_threshold_percent": 35.0,
        "alert_window_minutes": 10,
    }
    w_prop_count = propagate_widget_template(w_a_id, updated_w_data)
    print(f"[TEST 6] Propagating Widget A changes -> {w_prop_count} servers updated")
    assert w_prop_count == 3, f"Expected widget changes to propagate to 3 servers only, got {w_prop_count}"

    # Verify widget updated on B1 and Y1 only
    sc_b1_w = db.server_configs().find_one({"server_id": srv_b1})
    widgets_b1 = sc_b1_w.get("custom_widgets") or sc_b1_w.get("widgets") or []
    matching_w = next((w for w in widgets_b1 if w.get("template_id") == w_a_id), None)
    assert matching_w is not None, "Widget must exist on B1"
    assert matching_w["poll_interval_seconds"] == 15, "Poll interval must be updated to 15s"

    print("=== All Site-Scoped Template Synchronization Tests Passed! ===")

    # Cleanup test data
    db.sites().delete_many({"_id": {"$in": [site_b_id, site_y_id, site_other_id]}})
    db.servers().delete_many({"_id": {"$in": [srv_b1, srv_b2, srv_y1, srv_other]}})
    db.server_configs().delete_many({"server_id": {"$in": [srv_b1, srv_b2, srv_y1, srv_other]}})
    db.agent_config_templates().delete_one({"_id": tpl_a_id})
    db.widget_templates().delete_one({"_id": w_a_id})


if __name__ == "__main__":
    run_tests()
