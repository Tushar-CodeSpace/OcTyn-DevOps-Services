"""Agent self-updater for remote site deployments."""

import hashlib
import json
import os
import py_compile
import sys
from urllib.request import Request, urlopen

from agent.config import _RUNTIME_CONFIG, API_KEY, API_URL, http_timeout, log


def check_and_apply_update() -> None:
    """Fetch release info from central hub. If checksum differs or force_update flag is set, auto-update self."""
    try:
        req = Request(
            f"{API_URL}/agent/release",
            headers={"X-API-Key": API_KEY},
            method="GET",
        )
        with urlopen(req, timeout=http_timeout()) as resp:
            if resp.status in (200, 201):
                data = json.loads(resp.read().decode("utf-8"))
                remote_sha = data.get("sha256")
                download_path = data.get("download_lite_url", "/agent/download/lite")

                script_path = os.path.abspath(sys.argv[0])
                if not os.path.exists(script_path):
                    return
                with open(script_path, "rb") as f:
                    local_sha = hashlib.sha256(f.read()).hexdigest()[:12]

                force_upd = bool(_RUNTIME_CONFIG.get("force_update", False))
                if force_upd or (remote_sha and remote_sha != local_sha):
                    log(f"[AUTO-UPDATE] Agent release mismatch (remote sha: {remote_sha}, local sha: {local_sha}). Downloading update...")

                    if download_path.startswith(("http://", "https://")):
                        full_download_url = download_path
                    elif download_path.startswith("/api/v1/"):
                        rel_path = download_path[len("/api/v1/"):]
                        full_download_url = f"{API_URL}/{rel_path}"
                    else:
                        full_download_url = f"{API_URL}/{download_path.lstrip('/')}"

                    down_req = Request(
                        full_download_url,
                        headers={"X-API-Key": API_KEY},
                        method="GET",
                    )
                    tmp_path = script_path + ".tmp"
                    with urlopen(down_req, timeout=30) as down_resp:
                        if down_resp.status in (200, 201):
                            content = down_resp.read()
                            with open(tmp_path, "wb") as tf:
                                tf.write(content)
                            py_compile.compile(tmp_path, doraise=True)
                            os.replace(tmp_path, script_path)
                            log("[AUTO-UPDATE] Successfully updated agent. Exiting cleanly for systemd auto-restart.")
                            sys.exit(0)
    except SystemExit:
        raise
    except Exception as exc:
        log(f"[AUTO-UPDATE] Agent update check error: {exc!r}")
