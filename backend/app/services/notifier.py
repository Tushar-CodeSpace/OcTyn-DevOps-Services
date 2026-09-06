import json
import threading
from typing import Optional

import urllib.request

from app.services.logging_setup import get_logger

logger = get_logger(__name__)

TIMEOUT_S = 10


def _post_send(cfg: dict, number: str, text: str) -> tuple[bool, str]:
    """Blocking POST to Evolution API. Returns (ok, detail)."""
    url = f"{cfg['whatsapp_base_url'].rstrip('/')}/message/sendText/{cfg['whatsapp_instance']}"
    req = urllib.request.Request(
        url,
        data=json.dumps({"number": number, "text": text}).encode(),
        headers={
            "Content-Type": "application/json",
            "apikey": cfg["whatsapp_api_key"],
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            body = resp.read(200).decode(errors="replace")
            ok = 200 <= resp.status < 300
            return ok, f"HTTP {resp.status}" if ok else f"HTTP {resp.status}: {body}"
    except Exception as exc:  # noqa: BLE001 - report any gateway failure
        return False, repr(exc)


def format_alert_text(
    severity: str,
    message: str,
    machine: Optional[str] = None,
    client: Optional[str] = None,
    location: Optional[str] = None,
    hostname: Optional[str] = None,
) -> str:
    """Multi-line WhatsApp body carrying full site context."""
    lines = [f"🔔 OcTyn DevOps Services — {severity.upper()}"]

    place = " · ".join(p for p in (client, location) if p)
    if place:
        lines.append(f"📍 {place}")

    equip = " · ".join(p for p in (machine, hostname) if p)
    if equip:
        lines.append(f"🔧 {equip}")

    if message:
        lines.append(message)

    return "\n".join(lines)


def _recipients(cfg: dict) -> list[str]:
    return [n.strip() for n in cfg.get("whatsapp_recipients", "").split(",") if n.strip()]


def _site_details(site_id) -> tuple[Optional[str], Optional[str]]:
    """(client, location) for a server's site; tolerant to missing/bad ids."""
    if not site_id:
        return None, None
    try:
        from app.database import models as db

        site = db.sites().find_one({"_id": site_id}, {"client": 1, "location": 1})
        if not site:
            return None, None
        return site.get("client"), site.get("location")
    except Exception as exc:  # noqa: BLE001 - never block notifying on lookup issues
        logger.warning("site lookup failed for %s: %r", site_id, exc)
        return None, None


def notify_alert(
    severity: str,
    message: str,
    hostname: Optional[str] = None,
    machine: Optional[str] = None,
    site_id=None,
) -> None:
    """Queue a WhatsApp message for every recipient. Non-blocking."""
    from app.services import app_settings

    cfg = app_settings.get_notification_config()
    if not cfg["whatsapp_enabled"]:
        return
    numbers = _recipients(cfg)
    if not numbers:
        logger.warning("whatsapp enabled but no recipients configured")
        return

    if site_id:
        try:
            from app.database import models as db
            s_doc = db.sites().find_one({"_id": site_id}, {"alerts_enabled": 1})
            if s_doc and not s_doc.get("alerts_enabled", True):
                return
        except Exception:
            pass

    client, location = _site_details(site_id)
    text = format_alert_text(
        severity=severity,
        message=message,
        machine=machine,
        client=client,
        location=location,
        hostname=hostname,
    )
    for number in numbers:
        threading.Thread(
            target=_deliver,
            args=(dict(cfg), number, text),
            daemon=True,
            name=f"wa-{number}",
        ).start()


def _deliver(cfg: dict, number: str, text: str) -> None:
    ok, detail = _post_send(cfg, number, text)
    if ok:
        logger.info("whatsapp sent to %s (%s)", number, detail)
    else:
        logger.warning("whatsapp send to %s failed: %s", number, detail)


def send_test(number: Optional[str] = None) -> list[dict]:
    """Synchronously send a sample structured message; returns per-recipient results."""
    from app.services import app_settings

    cfg = app_settings.get_notification_config()
    numbers = [number.strip()] if number else _recipients(cfg)
    if not numbers:
        return [{"number": "-", "ok": False, "detail": "no recipients configured"}]

    text = format_alert_text(
        severity="warning",
        message="Memory at 85.5%",
        machine="Conveyor Line 01",
        client="sample-client",
        location="Sample Location",
        hostname="sample-host",
    )
    results = []
    for n in numbers:
        ok, detail = _post_send(cfg, n, text)
        results.append({"number": n, "ok": ok, "detail": detail})
    return results
