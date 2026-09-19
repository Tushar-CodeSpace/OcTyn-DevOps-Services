import pymongo
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "agent"))
import agent_lite
from agent import widgets as modular_widgets

client = pymongo.MongoClient("mongodb://127.0.0.1:27017")
coll = client["sorting_service"]["primary_sortings"]

# Ensure confirmed doc has display_rejection: ''
coll.replace_one({"_id": "1bf51013-931e-4b77-abd6-dac936bc9bcf"}, {
    "_id": "1bf51013-931e-4b77-abd6-dac936bc9bcf",
    "status": "Confirmed",
    "is_rejected": False,
    "barcode_data": {"scan_timestamp": "2026-08-20T16:02:19.423"},
    "rejection_data": {"display_rejection": ""}
}, upsert=True)

# Ensure rejected doc with PSTR
coll.replace_one({"_id": "1e50b102-8a95-42b6-9399-66250b061bc3"}, {
    "_id": "1e50b102-8a95-42b6-9399-66250b061bc3",
    "status": "Rejected",
    "is_rejected": True,
    "barcode_data": {"scan_timestamp": "2026-08-20T16:02:19.678"},
    "rejection_data": {"code": "DNFR", "display_rejection": "PSTR"}
}, upsert=True)

# Ensure another rejected doc with DNFR
coll.replace_one({"_id": "test_dnfr_doc"}, {
    "_id": "test_dnfr_doc",
    "status": "Rejected",
    "is_rejected": True,
    "barcode_data": {"scan_timestamp": "2026-08-20T16:02:19.678"},
    "rejection_data": {"code": "DNFR", "display_rejection": "DNFR"}
}, upsert=True)

# Configuration: Summary of display rejections excluding PSTR and empty string
widget_conf = {
    "name": "Rejection Summary",
    "database": "sorting_service",
    "collection": "primary_sortings",
    "window_minutes": 10000000,
    "group_by_field": "rejection_data.display_rejection",
    "time_field": "barcode_data.scan_timestamp",
    "max_groups": 10,
    "include_values": [],
    "exclude_values": ["PSTR", '""']
}

print("\n--- Testing agent_lite ---")
res = agent_lite.collect_widget(client, widget_conf)
print("Total:", res["total"])
print("Groups (Display Rejections):", res["groups"])

assert "PSTR" not in res["groups"]
assert "" not in res["groups"]
assert "Confirmed" not in res["groups"]
assert "DNFR" in res["groups"]

# Also test with full field path in exclude_values: ['rejection_data.display_rejection: PSTR', 'rejection_data.display_rejection: ""']
widget_conf_full = dict(widget_conf)
widget_conf_full["exclude_values"] = ["rejection_data.display_rejection: PSTR", 'rejection_data.display_rejection: ""']
res_full = agent_lite.collect_widget(client, widget_conf_full)
print("\nWith full field syntax:", res_full["groups"])
assert res_full["groups"] == res["groups"]

print("\n--- Testing modular agent widgets ---")
res_mod = modular_widgets.collect_widget(client, widget_conf)
assert res_mod["groups"] == res["groups"]

print("\nALL REJECTION SUMMARY TESTS PASSED 100%!")
