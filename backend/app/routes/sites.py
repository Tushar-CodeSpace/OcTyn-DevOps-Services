"""Site CRUD routes (dashboard users only)."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.schemas.site import SiteCreate, SiteRead, SiteUpdate
from app.services import authentication as auth
from app.services import audit as audit_trail

router = APIRouter(
    prefix="/api/v1/sites",
    tags=["sites"],
    dependencies=[Depends(auth.get_current_user)],
)


def now() -> datetime:
    return datetime.now(timezone.utc)


def site_doc_to_read(doc: dict, server_names_by_site: dict[str, list[str]] | None = None) -> SiteRead:
    sid = str(doc["_id"])
    equip_names: list[str] = []
    if server_names_by_site and sid in server_names_by_site:
        equip_names.extend(server_names_by_site[sid])
    explicit_equip = doc.get("equipment_name") or doc.get("equipment")
    if explicit_equip and str(explicit_equip) not in equip_names:
        equip_names.append(str(explicit_equip))

    client = str(doc.get("client") or doc.get("client_name") or "Unknown Client")
    code = str(doc.get("code") or doc.get("site_code") or doc.get("name") or sid).lower()
    # Normalize code to alphanumeric and underscore
    clean_code = "".join(c if c.isalnum() or c == "_" else "_" for c in code).strip("_") or "site"
    location = str(doc.get("location") or doc.get("city") or "Unknown")
    status_val = doc.get("status") if doc.get("status") in ("active", "inactive") else "active"

    return SiteRead(
        id=sid,
        client=client,
        code=clean_code,
        location=location,
        status=status_val,
        alerts_enabled=doc.get("alerts_enabled", True),
        equipment_name=doc.get("equipment_name") or (equip_names[0] if equip_names else None),
        equipment_names=equip_names,
        created_at=doc.get("created_at") or now(),
        updated_at=doc.get("updated_at") or now(),
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
    server_names_by_site: dict[str, list[str]] = {}
    for srv in db.servers().find({}, {"site_id": 1, "name": 1}):
        sid = str(srv.get("site_id") or "")
        name = str(srv.get("name") or "").strip()
        if sid and name:
            lst = server_names_by_site.setdefault(sid, [])
            if name not in lst:
                lst.append(name)
    return [site_doc_to_read(d, server_names_by_site) for d in docs]


@router.post(
    "",
    response_model=SiteRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_site(
    body: SiteCreate,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> SiteRead:
    if db.sites().find_one({"code": body.code}):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Site code already exists")
    doc = body.model_dump() | {"_id": new_id(), "created_at": now(), "updated_at": now()}
    db.sites().insert_one(doc)
    audit_trail.record(
        current, "site_create", request,
        {"client": doc["client"], "code": doc["code"], "location": doc["location"]},
    )
    return site_doc_to_read(doc)


@router.get("/{site_id}", response_model=SiteRead)
async def get_site(site_id: str) -> SiteRead:
    doc = find_site_or_404(site_id)
    server_names_by_site: dict[str, list[str]] = {}
    for srv in db.servers().find({"site_id": site_id}, {"name": 1}):
        name = str(srv.get("name") or "").strip()
        if name:
            lst = server_names_by_site.setdefault(site_id, [])
            if name not in lst:
                lst.append(name)
    return site_doc_to_read(doc, server_names_by_site)


@router.patch(
    "/{site_id}",
    response_model=SiteRead,
)
async def update_site(
    site_id: str,
    body: SiteUpdate,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> SiteRead:
    doc = find_site_or_404(site_id)
    updates: dict = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "code" in updates and updates["code"] != doc["code"]:
        if db.sites().find_one({"code": updates["code"]}):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Site code already exists")
    if updates:
        updates["updated_at"] = now()
        db.sites().update_one({"_id": doc["_id"]}, {"$set": updates})
        audit_trail.record(
            current, "site_update", request,
            {"client": doc["client"], "code": doc["code"], "keys": sorted(updates.keys()), "values": updates},
        )
    return site_doc_to_read(db.sites().find_one({"_id": doc["_id"]}))


@router.delete(
    "/{site_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_site(
    site_id: str,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> None:
    doc = find_site_or_404(site_id)
    if db.servers().count_documents({"site_id": doc["_id"]}) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Site has servers; delete or move them first",
        )
    db.sites().delete_one({"_id": doc["_id"]})
    audit_trail.record(
        current, "site_delete", request,
        {"client": doc["client"], "code": doc["code"], "location": doc["location"]},
    )


from pydantic import BaseModel
from app.services import app_settings


class ClientAlertPatch(BaseModel):
    enabled: bool


@router.get("/clients/alerts", response_model=list[str])
async def get_disabled_clients() -> list[str]:
    """Return list of client names where alerts are disabled at the client level."""
    return app_settings.get_disabled_clients()


@router.patch(
    "/clients/{client_name}/alerts",
)
async def toggle_client_alerts(
    client_name: str,
    body: ClientAlertPatch,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> dict:
    """Enable or disable alerts for an entire client (all its sites)."""
    result = app_settings.set_client_alerts_enabled(client_name, body.enabled)
    audit_trail.record(
        current, "config_update", request,
        {"area": "client-alerts", "target": client_name, "enabled": body.enabled},
    )
    return result