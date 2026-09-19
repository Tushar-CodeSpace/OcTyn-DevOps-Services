import pymongo

client = pymongo.MongoClient("mongodb://127.0.0.1:27017")
coll = client["sorting_service"]["primary_sortings"]

# Insert or test user sample document
sample_pstr = {
    "_id": "1e50b102-8a95-42b6-9399-66250b061bc3",
    "status": "Rejected",
    "is_rejected": True,
    "rejection_data": {
        "code": "DNFR",
        "display_rejection": "PSTR",
        "name": "Data Not Found Rejection"
    }
}
coll.replace_one({"_id": sample_pstr["_id"]}, sample_pstr, upsert=True)

# 1. Total rejected
total_rejected = coll.count_documents({"status": "Rejected"})

# 2. Rejected excluding PSTR
query_exclude_pstr = {
    "status": "Rejected",
    "rejection_data.display_rejection": {"$nin": ["PSTR"]}
}
non_pstr_count = coll.count_documents(query_exclude_pstr)
pstr_count = coll.count_documents({"status": "Rejected", "rejection_data.display_rejection": "PSTR"})

print(f"Total Rejected: {total_rejected}")
print(f"PSTR Rejected: {pstr_count}")
print(f"Non-PSTR Rejected: {non_pstr_count}")
assert non_pstr_count == total_rejected - pstr_count

# Now test via our agent collect_widget logic:
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "agent"))
import agent_lite

widget_conf = {
    "name": "True Rejections (Excluding PSTR)",
    "database": "sorting_service",
    "collection": "primary_sortings",
    "window_minutes": 10000000,
    "group_by_field": "status",
    "time_field": "barcode_data.scan_timestamp",
    "max_groups": 10,
    "include_values": ["Rejected"],
    "exclude_values": ["rejection_data.display_rejection: PSTR"]
}
res = agent_lite.collect_widget(client, widget_conf)
print("\nWidget Result with group_by='status':", res)
assert res["total"] == non_pstr_count
assert res["groups"] == {"Rejected": non_pstr_count}

# Also test with group_by='rejection_data.code'
widget_conf_by_code = {
    "name": "Rejection Codes (Excluding PSTR)",
    "database": "sorting_service",
    "collection": "primary_sortings",
    "window_minutes": 10000000,
    "group_by_field": "rejection_data.code",
    "time_field": "barcode_data.scan_timestamp",
    "max_groups": 10,
    "include_values": ["status: Rejected"],
    "exclude_values": ["rejection_data.display_rejection: PSTR"]
}
res_code = agent_lite.collect_widget(client, widget_conf_by_code)
print("\nWidget Result with group_by='rejection_data.code':", res_code)
assert res_code["total"] == non_pstr_count
assert "PSTR" not in res_code["groups"]

print("\nALL CHECKS PASSED PERFECTLY!")
