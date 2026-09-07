"""Manual 7-day retention cleanup & disk space reclamation script.

Run from repo root:
  uv run --project backend scripts/cleanup.py [--days 7]
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.database import models as db
from app.services.background import cleanup_expired_data

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prune old monitoring data and reclaim disk space.")
    parser.add_argument("--days", type=int, default=7, help="Retention period in days (default: 7)")
    args = parser.parse_args()

    if args.days:
        from app.services import app_settings
        app_settings.update_config_sync_config({"metrics_retention_days": args.days})

    print(f"--- Starting Data Pruning (Retention: {args.days} Days) ---")
    result = cleanup_expired_data()
    print(f"Pruned metrics:           {result['metrics']}")
    print(f"Pruned config snapshots:  {result['site_configs']}")
    print(f"Pruned terminal commands: {result['terminal_commands']}")
    print(f"Pruned resolved alerts:   {result['alerts']}")

    print("\n--- Reclaiming MongoDB Disk Space (Compacting Collections) ---")
    collections_to_compact = ["metrics", "site_configs", "terminal_commands", "alerts"]
    for col_name in collections_to_compact:
        try:
            print(f"Compacting {col_name}...")
            db.db().command("compact", col_name)
            print(f"Compacted {col_name} successfully.")
        except Exception as exc:
            print(f"Compact on {col_name} skipped/failed: {exc}")

    print("\nCleanup and disk space reclamation complete!")