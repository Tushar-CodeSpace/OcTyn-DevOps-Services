import pymongo
from datetime import datetime, timezone, timedelta

def _coerce_val_candidates(vals):
    candidates = []
    for v in vals:
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

def _parse_field_conditions(entries, default_field):
    res = {}
    for item in entries:
        if not item:
            continue
        s = str(item).strip()
        if not s:
            continue
        if s.lower().startswith("where "):
            s = s[6:].strip()
        field = default_field
        val_str = s
        if ":" in s:
            parts = s.split(":", 1)
            field = parts[0].strip()
            val_str = parts[1].strip()
        elif "=" in s:
            parts = s.split("=", 1)
            field = parts[0].strip()
            val_str = parts[1].strip()
        if not field:
            field = default_field

        vals = []
        if val_str.startswith("[") and val_str.endswith("]"):
            inner = val_str[1:-1]
            vals = [x.strip().strip("'\"") for x in inner.split(",") if x.strip()]
        else:
            cleaned = val_str.strip("'\"")
            if cleaned:
                vals = [cleaned]
        if field not in res:
            res[field] = []
        for v in vals:
            if v not in res[field]:
                res[field].append(v)
    return res

client = pymongo.MongoClient("mongodb://127.0.0.1:27017")
coll = client["sorting_service"]["primary_sortings"]

# Test case 1: user input exclude_values = ["rejection_data.display_rejection: ZLRR"]
group_by = "status"
exclude_vals = ["rejection_data.display_rejection: ZLRR"]
include_vals = []

inc_by_field = _parse_field_conditions(include_vals, group_by)
exc_by_field = _parse_field_conditions(exclude_vals, group_by)

match = {}
all_fields = set(inc_by_field.keys()) | set(exc_by_field.keys())
for f in all_fields:
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

print("Generated match query:", match)

total = coll.count_documents(match)
pipeline = [
    {"$match": match},
    {"$group": {"_id": "$" + group_by, "count": {"$sum": 1}}},
    {"$sort": {"count": -1}},
    {"$limit": 10},
]
groups = {row["_id"]: row["count"] for row in coll.aggregate(pipeline)}

if group_by in inc_by_field:
    inc_set = {str(x).strip().lower() for x in inc_by_field[group_by] if str(x).strip()}
    groups = {k: v for k, v in groups.items() if str(k).strip().lower() in inc_set}
if group_by in exc_by_field:
    exc_set = {str(x).strip().lower() for x in exc_by_field[group_by] if str(x).strip()}
    groups = {k: v for k, v in groups.items() if str(k).strip().lower() not in exc_set}

print("Result total:", total, "groups:", groups)
assert total == 48
assert groups["Rejected"] == 45
assert groups["Accepted"] == 3
print("Test 1 passed successfully!")

# Test case 2: user input with 'where rejection_data.display_rejection: ZLRR'
exclude_vals_2 = ["where rejection_data.display_rejection: ZLRR", "Accepted"]
inc_by_field_2 = _parse_field_conditions([], group_by)
exc_by_field_2 = _parse_field_conditions(exclude_vals_2, group_by)
assert "rejection_data.display_rejection" in exc_by_field_2
assert "status" in exc_by_field_2
print("Parsed fields for test 2:", exc_by_field_2)
print("Test 2 parsing passed successfully!")
