import pymongo
from datetime import datetime, timezone
import sys
from pathlib import Path

# Add agent directory to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent / "agent"))

import agent_lite
from agent import widgets as modular_widgets

client = pymongo.MongoClient("mongodb://127.0.0.1:27017")

# Verify database and collection exist
coll = client["sorting_service"]["primary_sortings"]
total_baseline = coll.count_documents({})
print(f"Baseline total docs in sorting_service.primary_sortings: {total_baseline}")

time_field = "barcode_data.scan_timestamp"

widget_spec_base = {
    "name": "Sorting status",
    "database": "sorting_service",
    "collection": "primary_sortings",
    "window_minutes": 10000000,  # wide window to include historical sample data
    "group_by_field": "status",
    "time_field": time_field,
    "max_groups": 10,
    "include_values": [],
    "exclude_values": [],
}

print("\n--- Testing agent_lite.collect_widget ---")
# 1. Unfiltered
res1 = agent_lite.collect_widget(client, widget_spec_base)
print("Unfiltered:", res1["total"], res1["groups"])
assert res1["total"] == total_baseline

# 2. Exclude rejection_data.display_rejection: ZLRR
spec_exclude = dict(widget_spec_base)
spec_exclude["exclude_values"] = ["rejection_data.display_rejection: ZLRR"]
res2 = agent_lite.collect_widget(client, spec_exclude)
print("Exclude ZLRR:", res2["total"], res2["groups"])
assert res2["total"] == total_baseline - 2
assert res2["groups"]["Rejected"] == res1["groups"]["Rejected"] - 2
assert res2["groups"]["Accepted"] == res1["groups"]["Accepted"]

# 3. Exclude with 'where ' prefix
spec_where = dict(widget_spec_base)
spec_where["exclude_values"] = ["where rejection_data.display_rejection: ZLRR"]
res3 = agent_lite.collect_widget(client, spec_where)
assert res3["total"] == res2["total"]
assert res3["groups"] == res2["groups"]
print("Exclude with 'where ' passed!")

# 4. Exclude with '=' syntax
spec_eq = dict(widget_spec_base)
spec_eq["exclude_values"] = ["rejection_data.display_rejection = ZLRR"]
res4 = agent_lite.collect_widget(client, spec_eq)
assert res4["total"] == res2["total"]
assert res4["groups"] == res2["groups"]
print("Exclude with '=' passed!")

# 5. Include only ZLRR
spec_inc = dict(widget_spec_base)
spec_inc["include_values"] = ["rejection_data.display_rejection: ZLRR"]
res5 = agent_lite.collect_widget(client, spec_inc)
print("Include only ZLRR:", res5["total"], res5["groups"])
assert res5["total"] == 2
assert res5["groups"] == {"Rejected": 2}
print("Include with field: value passed!")

print("\n--- Testing modular agent widgets.collect_widget ---")
res_mod_unfiltered = modular_widgets.collect_widget(client, widget_spec_base)
assert res_mod_unfiltered["total"] == res1["total"]
assert res_mod_unfiltered["groups"] == res1["groups"]

res_mod_exclude = modular_widgets.collect_widget(client, spec_exclude)
assert res_mod_exclude["total"] == res2["total"]
assert res_mod_exclude["groups"] == res2["groups"]
print("Modular agent exclude passed!")

res_mod_inc = modular_widgets.collect_widget(client, spec_inc)
assert res_mod_inc["total"] == res5["total"]
assert res_mod_inc["groups"] == res5["groups"]
print("Modular agent include passed!")

print("\nALL WIDGET FIELD:VALUE TESTS PASSED 100%!")
