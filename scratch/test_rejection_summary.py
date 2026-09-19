import pymongo

client = pymongo.MongoClient("mongodb://127.0.0.1:27017")
coll = client["sorting_service"]["primary_sortings"]

# Insert user's confirmed doc
confirmed_doc = {
    "_id": "1bf51013-931e-4b77-abd6-dac936bc9bcf",
    "status": "Confirmed",
    "is_rejected": False,
    "barcode_data": {"scan_timestamp": "2026-08-20T16:02:19.423"},
    "rejection_data": {
        "code": "",
        "display_rejection": "",
        "name": ""
    }
}
coll.replace_one({"_id": confirmed_doc["_id"]}, confirmed_doc, upsert=True)

# Insert user's PSTR doc
pstr_doc = {
    "_id": "1e50b102-8a95-42b6-9399-66250b061bc3",
    "status": "Rejected",
    "is_rejected": True,
    "barcode_data": {"scan_timestamp": "2026-08-20T16:02:19.678"},
    "rejection_data": {
        "code": "DNFR",
        "display_rejection": "PSTR",
        "name": "Data Not Found Rejection"
    }
}
coll.replace_one({"_id": pstr_doc["_id"]}, pstr_doc, upsert=True)

# Query: group by rejection_data.display_rejection excluding PSTR and ''
match = {
    "rejection_data.display_rejection": {"$nin": ["PSTR", ""]}
}
total = coll.count_documents(match)
pipeline = [
    {"$match": match},
    {"$group": {"_id": "$rejection_data.display_rejection", "count": {"$sum": 1}}},
    {"$sort": {"count": -1}}
]
groups = {r["_id"]: r["count"] for r in coll.aggregate(pipeline)}

print("Total rejections excluding PSTR and empty string:", total)
print("Rejection summary breakdown:", groups)

assert "PSTR" not in groups
assert "" not in groups
assert None not in groups
print("Assertion passed! Grouping by rejection_data.display_rejection excluding PSTR and '' is exactly what is needed!")
