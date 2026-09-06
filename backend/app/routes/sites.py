"""Site CRUD routes (dashboard users only)."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.schemas.site import SiteCreate, SiteRead, SiteUpdate
from app.services import authentication as auth

router = APIRouter(
    prefix="/api/v1/sites",
    tags=["sites"],
    dependencies=[Depends(auth.get_current_user)],
)


def now() -> datetime:
    return datetime.now(timezone.utc)


def site_doc_to_read(doc: dict) -> SiteRead:
    return SiteRead(
        id=doc["_id"],
        client=doc["client"],
        code=doc["code"],
        location=doc["location"],
        status=doc["status"],
        alerts_enabled=doc.get("alerts_enabled", True),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


def find_site_or_404(site_id: str) -> dict:
    sid = parse_id(site_id)
    doc = db.sites().find_one({"_id": sid}) if sid else None
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return doc


@router.get("", response_model=list[SiteRead])
async def list_sites() -> list[SiteRead]:
    docs = list(db.sites().find().sort("created_at", 1))
    return [site_doc_to_read(d) for d in docs]


@router.post(
    "",
    response_model=SiteRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth.require_admin)],
)
async def create_site(body: SiteCreate) -> SiteRead:
    if db.sites().find_one({"code": body.code}):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Site code already exists")
    doc = body.model_dump() | {"_id": new_id(), "created_at": now(), "updated_at": now()}
    db.sites().insert_one(doc)
    return site_doc_to_read(doc)


@router.get("/{site_id}", response_model=SiteRead)
async def get_site(site_id: str) -> SiteRead:
    return site_doc_to_read(find_site_or_404(site_id))


@router.patch(
    "/{site_id}",
    response_model=SiteRead,
    dependencies=[Depends(auth.require_admin)],
)
async def update_site(site_id: str, body: SiteUpdate) -> SiteRead:
    doc = find_site_or_404(site_id)
    updates: dict = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "code" in updates and updates["code"] != doc["code"]:
        if db.sites().find_one({"code": updates["code"]}):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Site code already exists")
    if updates:
        updates["updated_at"] = now()
        db.sites().update_one({"_id": doc["_id"]}, {"$set": updates})
    return site_doc_to_read(db.sites().find_one({"_id": doc["_id"]}))


@router.delete(
    "/{site_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(auth.require_admin)],
)
async def delete_site(site_id: str) -> None:
    doc = find_site_or_404(site_id)
    if db.servers().count_documents({"site_id": doc["_id"]}) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Site has servers; delete or move them first",
        )
    db.sites().delete_one({"_id": doc["_id"]})