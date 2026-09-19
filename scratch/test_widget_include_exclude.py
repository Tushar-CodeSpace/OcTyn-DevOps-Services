import sys
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

# Ensure agent can be imported
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir / "agent"))
from agent.widgets import collect_widget, _coerce_val_candidates

def run_tests():
    print("Testing _coerce_val_candidates...")
    c1 = _coerce_val_candidates(["SUCCESS", "200", "true", "null", "none"])
    print(f"Candidates: {c1}")
    assert "SUCCESS" in c1
    assert 200 in c1
    assert "200" in c1
    assert True in c1
    assert None in c1
    print("Coerce candidates passed!")

    # Connect to local test MongoDB
    mongo_uri = "mongodb://localhost:27017"
    try:
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
        client.admin.command("ping")
    except Exception as e:
        print(f"Skipping live DB tests (mongo not reachable): {e}")
        return

    test_db = client["test_widget_db"]
    coll = test_db["test_items"]
    coll.delete_many({})

    now = datetime.now(timezone.utc)
    docs = [
        {"scan_status": "SUCCESS", "created_at": now - timedelta(minutes=5)},
        {"scan_status": "SUCCESS", "created_at": now - timedelta(minutes=10)},
        {"scan_status": "FAILED", "created_at": now - timedelta(minutes=15)},
        {"scan_status": "SKIPPED", "created_at": now - timedelta(minutes=20)},
        {"scan_status": "CANCELLED", "created_at": now - timedelta(minutes=25)},
        {"scan_status": 200, "created_at": now - timedelta(minutes=2)},
    ]
    coll.insert_many(docs)

    # 1. Base without include/exclude
    w_spec_all = {
        "name": "All Items",
        "database": "test_widget_db",
        "collection": "test_items",
        "group_by_field": "scan_status",
        "time_field": "created_at",
        "window_minutes": 60,
        "max_groups": 10,
        "enabled": True,
    }
    sample_all = collect_widget(client, w_spec_all)
    print("Sample All:", sample_all)
    assert sample_all["total"] == 6
    assert len(sample_all["groups"]) == 5

    # 2. With include_values: ["SUCCESS", "200"]
    w_spec_inc = dict(w_spec_all)
    w_spec_inc["include_values"] = ["SUCCESS", "200"]
    sample_inc = collect_widget(client, w_spec_inc)
    print("Sample Inc (SUCCESS, 200):", sample_inc)
    assert sample_inc["total"] == 3
    assert set(sample_inc["groups"].keys()) == {"SUCCESS", "200"}
    assert sample_inc["groups"]["SUCCESS"] == 2
    assert sample_inc["groups"]["200"] == 1

    # 3. With exclude_values: ["SKIPPED", "CANCELLED"]
    w_spec_exc = dict(w_spec_all)
    w_spec_exc["exclude_values"] = ["SKIPPED", "CANCELLED"]
    sample_exc = collect_widget(client, w_spec_exc)
    print("Sample Exc (SKIPPED, CANCELLED):", sample_exc)
    assert sample_exc["total"] == 4
    assert "SKIPPED" not in sample_exc["groups"]
    assert "CANCELLED" not in sample_exc["groups"]
    assert sample_exc["groups"]["SUCCESS"] == 2
    assert sample_exc["groups"]["FAILED"] == 1
    assert sample_exc["groups"]["200"] == 1

    # 4. Both include and exclude
    w_spec_both = dict(w_spec_all)
    w_spec_both["include_values"] = ["SUCCESS", "SKIPPED"]
    w_spec_both["exclude_values"] = ["SKIPPED"]
    sample_both = collect_widget(client, w_spec_both)
    print("Sample Both:", sample_both)
    assert sample_both["total"] == 2
    assert "SKIPPED" not in sample_both["groups"]
    assert sample_both["groups"]["SUCCESS"] == 2

    print("All live MongoDB widget tests passed successfully!")
    coll.delete_many({})

if __name__ == "__main__":
    run_tests()
