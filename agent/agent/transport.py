"""HTTP Transport client for communicating with the central monitoring server."""

import json
import time
from typing import Any, Dict, Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    httpx = None
    HAS_HTTPX = False

from agent.config import API_KEY, API_URL, http_timeout, log, retry_count


def push(path: str, payload: Dict[str, Any]) -> bool:
    """POST a JSON payload to the central API. Returns True on success."""
    url = f"{API_URL}/{path.lstrip('/')}"
    headers = {"Content-Type": "application/json", "X-API-Key": API_KEY}
    retries = retry_count()
    timeout = http_timeout()
    last_err = None

    if HAS_HTTPX:
        data = payload
        for attempt in range(1, retries + 1):
            try:
                with httpx.Client(timeout=timeout) as client:
                    resp = client.post(url, json=data, headers=headers)
                    if resp.status_code in (200, 201):
                        return True
                    last_err = f"HTTP {resp.status_code}"
            except Exception as exc:
                last_err = str(exc)
            if attempt < retries:
                time.sleep(2 * attempt)
    else:
        body = json.dumps(payload).encode("utf-8")
        req = Request(url, data=body, headers=headers, method="POST")
        for attempt in range(1, retries + 1):
            try:
                with urlopen(req, timeout=timeout) as resp:
                    if resp.status in (200, 201):
                        return True
                    last_err = f"HTTP {resp.status}"
            except (URLError, OSError) as exc:
                last_err = str(exc.reason) if isinstance(exc, URLError) else str(exc)
            except Exception as exc:
                last_err = str(exc)
            if attempt < retries:
                time.sleep(2 * attempt)

    log(f"push failed ({path}): {last_err}")
    return False


def push_return(path: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """POST a JSON payload and return parsed response JSON (or None on failure)."""
    url = f"{API_URL}/{path.lstrip('/')}"
    headers = {"Content-Type": "application/json", "X-API-Key": API_KEY}
    retries = retry_count()
    timeout = http_timeout()
    last_err = None

    if HAS_HTTPX:
        for attempt in range(1, retries + 1):
            try:
                with httpx.Client(timeout=timeout) as client:
                    resp = client.post(url, json=payload, headers=headers)
                    if resp.status_code in (200, 201):
                        try:
                            return resp.json()
                        except Exception:
                            return {}
                    last_err = f"HTTP {resp.status_code}"
            except Exception as exc:
                last_err = str(exc)
            if attempt < retries:
                time.sleep(2 * attempt)
    else:
        body = json.dumps(payload).encode("utf-8")
        req = Request(url, data=body, headers=headers, method="POST")
        for attempt in range(1, retries + 1):
            try:
                with urlopen(req, timeout=timeout) as resp:
                    if resp.status in (200, 201):
                        try:
                            return json.loads(resp.read(1000) or b"{}")
                        except Exception:
                            return {}
                        return None
            except (URLError, OSError) as exc:
                last_err = str(exc.reason) if isinstance(exc, URLError) else str(exc)
            except Exception as exc:
                last_err = str(exc)
            if attempt < retries:
                time.sleep(2 * attempt)

    log(f"push failed ({path}): {last_err}")
    return None


def fetch_agent_config() -> Optional[Dict[str, Any]]:
    """Fetch live agent configuration from the central hub."""
    url = f"{API_URL}/agent/config"
    headers = {"X-API-Key": API_KEY}
    retries = retry_count()
    timeout = http_timeout()

    if HAS_HTTPX:
        for attempt in range(1, retries + 1):
            try:
                with httpx.Client(timeout=timeout) as client:
                    resp = client.get(url, headers=headers)
                    if resp.status_code == 200:
                        try:
                            return resp.json()
                        except Exception:
                            return {}
                    return None
            except Exception:
                if attempt < retries:
                    time.sleep(min(2 * attempt, 5))
    else:
        req = Request(url, headers=headers)
        for attempt in range(1, retries + 1):
            try:
                with urlopen(req, timeout=timeout) as resp:
                    if resp.status == 200:
                        try:
                            return json.loads(resp.read(4000) or b"{}")
                        except Exception:
                            return {}
                    return None
            except Exception:
                if attempt < retries:
                    time.sleep(min(2 * attempt, 5))

    log("config fetch failed")
    return None


def is_command_cancelled(command_id: str) -> bool:
    """Check with central server if a running terminal command was cancelled (Ctrl+C requested)."""
    url = f"{API_URL}/terminal/commands/{command_id}/status"
    headers = {"X-API-Key": API_KEY}

    if HAS_HTTPX:
        try:
            with httpx.Client(timeout=min(http_timeout(), 5)) as client:
                resp = client.get(url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    return isinstance(data, dict) and data.get("status") == "cancelling"
        except Exception:
            pass
    else:
        req = Request(url, headers=headers)
        try:
            with urlopen(req, timeout=min(http_timeout(), 5)) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read(4000) or b"{}")
                    return isinstance(data, dict) and data.get("status") == "cancelling"
        except Exception:
            pass
    return False
