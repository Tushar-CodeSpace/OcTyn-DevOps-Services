"""Agent API key management (dashboard users only).

The raw key is returned exactly once at creation; only its sha256 hash is
stored. Revoking sets status=revoked (keeps history).
"""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.schemas.api_key import ApiKeyCreate, ApiKeyCreateResponse, ApiKeyRead
from app.services import authentication as auth
from app.services.monitoring import hash_api_key, now

router = APIRouter(
    prefix="/api/v1",
    tags=["api-keys"],
    dependencies=[Depends(auth.get_current_user)],
)


def find_server_or_404(server_id: str) -> dict:
    sid = parse_id(server_id)
    doc = db.servers().find_one({"_id": sid}) if sid else None
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    return doc


def key_doc_to_read(doc: dict) -> ApiKeyRead:
    return ApiKeyRead(
        id=doc["_id"],
        server_id=doc["server_id"],
        name=doc["name"],
        status=doc.get("status", "active"),
        created_at=doc["created_at"],
        last_used_at=doc.get("last_used_at"),
    )


@router.post(
    "/servers/{server_id}/api-keys",
    response_model=ApiKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth.require_admin)],
)
async def create_api_key(server_id: str, body: ApiKeyCreate) -> ApiKeyCreateResponse:
    server = find_server_or_404(server_id)
    raw_key = "cm-" + secrets.token_urlsafe(32)
    doc = {
        "_id": new_id(),
        "server_id": server["_id"],
        "key_hash": hash_api_key(raw_key),
        "name": body.name,
        "status": "active",
        "created_at": now(),
        "last_used_at": None,
    }
    db.api_keys().insert_one(doc)
    read = key_doc_to_read(doc)
    return ApiKeyCreateResponse(**read.model_dump(), raw_key=raw_key)


@router.get("/api-keys", response_model=list[ApiKeyRead])
async def list_all_api_keys() -> list[ApiKeyRead]:
    docs = list(db.api_keys().find().sort("created_at", 1))
    return [key_doc_to_read(d) for d in docs]


@router.get("/servers/{server_id}/api-keys", response_model=list[ApiKeyRead])
async def list_api_keys(server_id: str) -> list[ApiKeyRead]:
    server = find_server_or_404(server_id)
    docs = list(db.api_keys().find({"server_id": server["_id"]}).sort("created_at", 1))
    return [key_doc_to_read(d) for d in docs]


@router.delete(
    "/api-keys/{key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(auth.require_admin)],
)
async def revoke_or_delete_api_key(key_id: str, force: bool = False) -> None:
    oid = parse_id(key_id)
    doc = db.api_keys().find_one({"_id": oid}) if oid else None
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")

    if force or doc.get("status") == "revoked":
        db.api_keys().delete_one({"_id": doc["_id"]})
    else:
        db.api_keys().update_one({"_id": doc["_id"]}, {"$set": {"status": "revoked"}})