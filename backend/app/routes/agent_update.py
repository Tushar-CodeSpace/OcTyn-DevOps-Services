"""Agent Release & Auto-Update Endpoints.

- GET /api/v1/agent/release          (agent/public) - Get active agent version & release info.
- GET /api/v1/agent/download/lite    (agent/public) - Download latest agent_lite.py.
- POST /api/v1/agent/trigger-update   (admin/JWT)    - Broadcast agent update signal to all site servers.
"""

import hashlib
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.database import models as db
from app.services import authentication as auth

router = APIRouter(prefix="/api/v1/agent", tags=["agent-update"])

# Root workspace path resolution
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
AGENT_LITE_PATH = BASE_DIR / "agent" / "agent_lite.py"


class AgentReleaseInfo(BaseModel):
    version: str
    sha256: str
    download_lite_url: str
    release_notes: str = "Latest CI/CD build release"


class TriggerUpdatePayload(BaseModel):
    server_ids: Optional[list[str]] = None  # None = update all active servers


def get_agent_file_sha256(file_path: Path) -> str:
    """Compute sha256 checksum of an agent file."""
    if not file_path.exists():
        return "sha256-unknown"
    return hashlib.sha256(file_path.read_bytes()).hexdigest()[:12]


@router.get("/release", response_model=AgentReleaseInfo)
async def get_agent_release():
    """Return active agent version & checksum info for auto-updating agents."""
    sha = get_agent_file_sha256(AGENT_LITE_PATH)
    
    # Check if a custom version entry exists in app settings/database
    setting_doc = db.settings().find_one({"key": "agent_release"})
    version = setting_doc.get("version", f"1.0.0-sha.{sha}") if setting_doc else f"1.0.0-sha.{sha}"
    notes = setting_doc.get("release_notes", "Automated deployment build") if setting_doc else "Automated deployment build"

    return AgentReleaseInfo(
        version=version,
        sha256=sha,
        download_lite_url="/api/v1/agent/download/lite",
        release_notes=notes,
    )


@router.get("/download/lite")
async def download_agent_lite():
    """Serve the latest single-file agent_lite.py for remote site installation & updating."""
    if not AGENT_LITE_PATH.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent script file not found on central server",
        )
    return FileResponse(
        path=AGENT_LITE_PATH,
        filename="agent_lite.py",
        media_type="text/x-python",
    )


@router.post("/trigger-update", dependencies=[Depends(auth.require_admin)])
async def trigger_agent_update(payload: Optional[TriggerUpdatePayload] = None):
    """Admin endpoint: trigger an agent update check across all sites or specified servers."""
    target_servers = payload.server_ids if payload and payload.server_ids else None
    
    query = {}
    if target_servers:
        from app.database.connection import parse_id
        valid_ids = [parse_id(sid) for sid in target_servers if parse_id(sid)]
        query["_id"] = {"$in": valid_ids}
        
    servers = list(db.servers().find(query, {"_id": 1, "hostname": 1}))
    
    # Queue a terminal command for agents to execute self-update or flag update state
    updated_count = 0
    from datetime import datetime, timezone
    now_utc = datetime.now(timezone.utc)
    
    for server in servers:
        sid = server["_id"]
        # Set agent config force_update flag
        db.settings().update_one(
            {"key": f"agent_config:{sid}"},
            {"$set": {"force_update": True, "updated_at": now_utc}},
            upsert=True,
        )
        updated_count += 1
        
    return {
        "status": "success",
        "message": f"Triggered update check for {updated_count} server(s)",
        "targeted_servers": [str(s["_id"]) for s in servers],
    }
