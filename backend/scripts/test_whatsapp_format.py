"""Verify WhatsApp message formatting carries full site details."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.notifier import format_alert_text, _site_details

text = format_alert_text(
    severity="warning",
    message="Memory at 85.5%",
    machine="Conveyor Line 01",
    client="samsonite",
    location="Nashik",
    hostname="nido-server",
)
print("--- sample WhatsApp body ---")
print(text)
print("----------------------------")
for part in ("WARNING", "Location: samsonite · Nashik", "Equipment: Conveyor Line 01 · nido-server", "Memory at 85.5%"):
    assert part in text, f"missing: {part}"

# site lookup against real DB (samsonite-nashik-c1 was seeded under ci_plant)
from app.database import models as db

srv = db.servers().find_one({"hostname": "samsonite-nashik-c1"})
if srv:
    client, location = _site_details(srv.get("site_id"))
    print("site lookup:", client, "|", location)
    assert client == "ci" and location == "CI"

# graceful when no site_id
assert _site_details(None) == (None, None)
print("ALL WHATSAPP FORMAT TESTS PASSED")
