"""Agent runtime configuration routes.

- GET /api/v1/agent/config       (agent-authenticated) effective config for an agent.
- GET/PATCH /api/v1/agent-config/{server_id}  (dashboard, admin for writes) per-server overrides.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.database import models as db
from app.database.connection import parse_id
from app.schemas.agent_config import AgentConfig, AgentConfigOverrideUpdate
from app.services import app_settings
from app.services import authentication as auth
from app.services import audit as audit_trail
from app.services.monitoring import authenticate_agent

router = APIRouter(prefix="/api/v1", tags=["agent-config"])


def find_server_or_404(server_id: str) -> dict:
    sid = parse_id(server_id)
    doc = db.servers().find_one({"_id": sid}) if sid else None
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    return doc


@router.get("/agent/config", response_model=AgentConfig)
async def get_agent_config(agent: dict = Depends(authenticate_agent)) -> AgentConfig:
    """Agent endpoint: return the effective runtime config for this agent's server."""
    return AgentConfig(**app_settings.get_agent_config(str(agent["server"]["_id"])))


@router.get("/agent-config/{server_id}", response_model=AgentConfig)
async def get_server_agent_config(
    server_id: str,
    _: dict = Depends(auth.get_current_user),
) -> AgentConfig:
    """Dashboard endpoint: effective agent config for a server (defaults + overrides)."""
    find_server_or_404(server_id)
    return AgentConfig(**app_settings.get_agent_config(server_id))


@router.patch(
    "/agent-config/{server_id}",
    response_model=AgentConfig,
)
async def update_server_agent_config(
    server_id: str,
    body: AgentConfigOverrideUpdate,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> AgentConfig:
    """Dashboard endpoint: upsert per-server agent-config overrides."""
    server = find_server_or_404(server_id)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        result = app_settings.update_agent_config(server_id, patch)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    audit_trail.record(
        current,
        "config_update",
        request,
        {
            "area": "agent-config",
            "target": server.get("hostname") or server.get("name"),
            "server_id": str(server["_id"]),
            "keys": sorted(patch.keys()),
            "values": patch,
        },
    )
    return AgentConfig(**result)
