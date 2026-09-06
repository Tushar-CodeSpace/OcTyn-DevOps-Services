"""Super-admin terminal sessions for the lite monitoring agent."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.services import authentication as auth
from app.services.monitoring import authenticate_agent

router = APIRouter(prefix="/api/v1/terminal", tags=["terminal"])

MAX_OUTPUT = 64 * 1024


def now() -> datetime:
    return datetime.now(timezone.utc)


class CommandCreate(BaseModel):
    command: str = Field(min_length=1, max_length=2000)
    timeout_seconds: int = Field(default=300, ge=1, le=600)


class AgentCommandResult(BaseModel):
    command_id: str
    output: str = Field(default="", max_length=MAX_OUTPUT)
    exit_code: Optional[int] = Field(default=None, ge=-1, le=255)
    timed_out: bool = False
    complete: bool = False
    cancelled: bool = False


@router.post("/{server_id}/commands")
async def queue_command(
    server_id: str,
    body: CommandCreate,
    user: dict = Depends(auth.require_super_admin),
) -> dict:
    sid = parse_id(server_id)
    server = db.servers().find_one({"_id": sid}) if sid else None
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    command_id = new_id()
    doc = {
        "_id": command_id,
        "server_id": server["_id"],
        "command": body.command,
        "timeout_seconds": body.timeout_seconds,
        "status": "queued",
        "output": "",
        "exit_code": None,
        "timed_out": False,
        "created_at": now(),
        "created_by": user["_id"],
    }
    db.terminal_commands().insert_one(doc)
    emit(
        "terminal_queued",
        {"server_id": server_id, "command_id": command_id},
        room=f"server:{server_id}",
    )
    return {"command_id": command_id, "status": "queued"}


@router.get("/commands/{command_id}/status")
async def command_status(
    command_id: str,
    agent: dict = Depends(authenticate_agent),
) -> dict:
    """Agent polls a command's status while it is running (to detect cancellation)."""
    cid = parse_id(command_id)
    if cid is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")
    command = db.terminal_commands().find_one(
        {"_id": cid, "server_id": agent["server"]["_id"]}
    )
    if command is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")
    return {"status": command["status"]}


@router.post("/{server_id}/commands/{command_id}/cancel", status_code=status.HTTP_200_OK)
async def cancel_command(
    server_id: str,
    command_id: str,
    user: dict = Depends(auth.require_super_admin),
) -> dict:
    """Super-admin requests cancellation (Ctrl+C) of an in-flight command."""
    sid = parse_id(server_id)
    cid = parse_id(command_id)
    if sid is None or cid is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")
    command = db.terminal_commands().find_one({"_id": cid, "server_id": sid})
    if command is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")
    server_id_str = str(sid)
    finished = now()
    current_status = command["status"]
    if current_status == "queued":
        new_status = "cancelled"
        db.terminal_commands().update_one(
            {"_id": cid},
            {
                "$set": {
                    "status": "cancelled",
                    "exit_code": None,
                    "timed_out": False,
                    "cancelled": True,
                    "cancelled_at": finished,
                    "finished_at": finished,
                }
            },
        )
        emit(
            "terminal_output",
            {
                "server_id": server_id_str,
                "command_id": str(cid),
                "command": command["command"],
                "output": "",
                "exit_code": None,
                "timed_out": False,
                "cancelled": True,
                "complete": True,
                "finished_at": finished.isoformat(),
            },
            room=f"server:{server_id_str}",
        )
    elif current_status == "running":
        new_status = "cancelling"
        db.terminal_commands().update_one(
            {"_id": cid},
            {"$set": {"status": "cancelling", "cancelled_at": finished}},
        )
        emit(
            "terminal_cancelled",
            {"server_id": server_id_str, "command_id": str(cid)},
            room=f"server:{server_id_str}",
        )
    else:
        new_status = current_status
    db.audit_logs().insert_one(
        {
            "_id": new_id(),
            "user_id": user["_id"],
            "email": user.get("email", ""),
            "action": "terminal_command",
            "ip_address": None,
            "user_agent": None,
            "details": {
                "server_id": server_id_str,
                "command_id": str(cid),
                "command": command["command"],
                "cancelled": True,
            },
            "timestamp": finished,
        }
    )
    return {"status": new_status}


@router.get("/poll")
async def poll_command(agent: dict = Depends(authenticate_agent)) -> dict:
    server_id = agent["server"]["_id"]
    doc = db.terminal_commands().find_one_and_update(
        {"server_id": server_id, "status": "queued"},
        {"$set": {"status": "running", "started_at": now()}},
        sort=[("created_at", 1)],
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        return {"command": None}
    return {
        "command": {
            "id": doc["_id"],
            "command": doc["command"],
            "timeout_seconds": doc["timeout_seconds"],
        }
    }


@router.post("/result")
async def command_result(
    body: AgentCommandResult,
    agent: dict = Depends(authenticate_agent),
) -> dict:
    server_id = agent["server"]["_id"]
    command = db.terminal_commands().find_one(
        {"_id": body.command_id, "server_id": server_id, "status": {"$in": ["running", "cancelling"]}}
    )
    if command is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")
    output = body.output[-MAX_OUTPUT:]
    finished = now()
    accumulated = (command.get("output", "") + output)[-MAX_OUTPUT:]
    updates = {"output": accumulated}
    if body.complete:
        final_status = "cancelled" if body.cancelled else "completed"
        updates.update(
            {
                "status": final_status,
                "exit_code": body.exit_code,
                "timed_out": body.timed_out,
                "cancelled": body.cancelled,
                "finished_at": finished,
            }
        )
    db.terminal_commands().update_one(
        {"_id": body.command_id},
        {"$set": updates},
    )
    server_id_str = str(server_id)
    if body.complete:
        db.audit_logs().insert_one(
            {
                "_id": new_id(),
                "user_id": None,
                "email": "terminal agent",
                "action": "terminal_command",
                "ip_address": None,
                "user_agent": "lite agent",
                "details": {
                    "server_id": server_id_str,
                    "command_id": body.command_id,
                    "command": command["command"],
                    "exit_code": body.exit_code,
                    "timed_out": body.timed_out,
                    "cancelled": body.cancelled,
                },
                "timestamp": finished,
            }
        )
    emit(
        "terminal_output",
        {
            "server_id": server_id_str,
            "command_id": body.command_id,
            "command": command["command"],
            "output": output,
            "exit_code": body.exit_code if body.complete else None,
            "timed_out": body.timed_out,
            "cancelled": body.cancelled,
            "complete": body.complete,
            "finished_at": finished.isoformat(),
        },
        room=f"server:{server_id_str}",
    )
    return {"success": True}
