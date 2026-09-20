"""QA & Testing Environment routes.

Allows QA testers and developers to:
1. Designate and manage remote site servers exclusively as QA / Test Runners.
2. Fast-track software deployments from any Git branch directly to QA agents (bypassing production 3-team sign-offs).
3. Inspect live deployment logs and execution status.
4. Record QA test results, bug counts, and testing sign-offs.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.database import models as db
from app.database.connection import new_id, parse_id
from app.realtime import emit
from app.routes.deployments import _deployment_doc_to_read
from app.routes.servers import server_doc_to_read
from app.schemas.deployments import (
    DeploymentRead,
    QATestResultEntry,
    QATestResultUpdate,
)
from app.schemas.server import ServerRead
from app.services import audit as audit_trail
from app.services import authentication as auth

router = APIRouter(prefix="/api/v1/qa", tags=["qa-testing"])


def now() -> datetime:
    return datetime.now(timezone.utc)


class QAServerDesignateRequest(BaseModel):
    is_qa: bool = True
    qa_role: Optional[str] = Field(default=None, max_length=100)
    qa_test_url: Optional[str] = Field(default=None, max_length=300)


class QADeploymentTriggerRequest(BaseModel):
    software_id: str = Field(min_length=1, max_length=100)
    server_ids: List[str] = Field(min_length=1)
    branch: str = Field(default="main", max_length=100)
    components_selected: List[str] = Field(default_factory=list)
    client_name: Optional[str] = Field(default="", max_length=100)
    machine_type: Optional[str] = Field(default="", max_length=100)
    notes: Optional[str] = Field(default="", max_length=500)


class QAServerTelemetry(BaseModel):
    server: ServerRead
    site_name: str
    latest_cpu: Optional[float] = None
    latest_ram: Optional[float] = None
    active_software: Optional[str] = None
    active_branch: Optional[str] = None
    last_deployed_at: Optional[datetime] = None
    latest_qa_verdict: Optional[str] = None


class QAOverviewResponse(BaseModel):
    qa_servers: List[QAServerTelemetry]
    recent_deployments: List[DeploymentRead]
    stats: Dict[str, Any]


@router.get("/overview", response_model=QAOverviewResponse)
async def get_qa_overview(_: dict = Depends(auth.get_current_user)) -> QAOverviewResponse:
    """Returns real-time QA environment health, runners, recent test runs, and metrics."""
    qa_server_docs = list(db.servers().find({"environment": "qa"}).sort("name", 1))
    all_server_ids = [s["_id"] for s in qa_server_docs]

    # Map sites for display
    site_ids = [s.get("site_id") for s in qa_server_docs if s.get("site_id")]
    sites_map = {
        str(site["_id"]): site
        for site in db.sites().find({"_id": {"$in": site_ids}})
    }

    # Fetch latest metrics for QA servers
    latest_metrics_map: dict[str, dict] = {}
    if all_server_ids:
        raw_metrics = list(
            db.metrics().aggregate([
                {"$match": {"server_id": {"$in": all_server_ids}}},
                {"$sort": {"recorded_at": -1}},
                {"$group": {"_id": "$server_id", "doc": {"$first": "$$ROOT"}}},
            ])
        )
        for rm in raw_metrics:
            latest_metrics_map[str(rm["_id"])] = rm.get("doc", {})

    # Fetch latest deployment per QA server
    last_dep_map: dict[str, dict] = {}
    if all_server_ids:
        raw_deps = list(
            db.deployments().aggregate([
                {"$match": {"server_id": {"$in": [str(s) for s in all_server_ids]}}},
                {"$sort": {"created_at": -1}},
                {"$group": {"_id": "$server_id", "doc": {"$first": "$$ROOT"}}},
            ])
        )
        for rd in raw_deps:
            last_dep_map[str(rd["_id"])] = rd.get("doc", {})

    telemetry_list: List[QAServerTelemetry] = []
    for s in qa_server_docs:
        sid_str = str(s["_id"])
        site = sites_map.get(str(s.get("site_id") or "")) or {}
        client = site.get("client") or site.get("client_name") or ""
        loc = site.get("location") or ""
        site_display = f"{client} ({loc})" if loc else (client or "QA Lab")

        metric = latest_metrics_map.get(sid_str) or {}
        last_dep = last_dep_map.get(sid_str) or {}

        # Branch extraction
        branches = last_dep.get("branches", {})
        active_branch = None
        if branches:
            active_branch = list(branches.values())[0] if isinstance(branches, dict) else str(branches)

        qa_result = last_dep.get("qa_test_result") or {}
        verdict = qa_result.get("verdict") if isinstance(qa_result, dict) else None

        telemetry_list.append(
            QAServerTelemetry(
                server=server_doc_to_read(s),
                site_name=site_display,
                latest_cpu=metric.get("cpu_percent"),
                latest_ram=metric.get("ram_percent"),
                active_software=last_dep.get("software_name"),
                active_branch=active_branch,
                last_deployed_at=last_dep.get("created_at"),
                latest_qa_verdict=verdict,
            )
        )

    # Fetch recent QA deployments (tagged environment="qa" or on QA servers)
    qa_dep_query: dict = {
        "$or": [
            {"environment": "qa"},
            {"server_id": {"$in": [str(s) for s in all_server_ids]}},
        ]
    }
    recent_dep_docs = list(db.deployments().find(qa_dep_query).sort("created_at", -1).limit(50))
    recent_deployments = [_deployment_doc_to_read(d) for d in recent_dep_docs]

    # Calculate statistics
    online_count = sum(1 for t in telemetry_list if t.server.status == "online")
    passed_count = sum(1 for d in recent_deployments if d.qa_test_result and d.qa_test_result.verdict == "passed")
    failed_count = sum(1 for d in recent_deployments if d.qa_test_result and d.qa_test_result.verdict == "failed")
    in_progress_count = sum(1 for d in recent_deployments if d.qa_test_result and d.qa_test_result.verdict == "in_progress")
    active_deploying = sum(1 for d in recent_deployments if d.status in ("running", "pending"))

    return QAOverviewResponse(
        qa_servers=telemetry_list,
        recent_deployments=recent_deployments,
        stats={
            "total_qa_servers": len(telemetry_list),
            "online_qa_servers": online_count,
            "offline_qa_servers": len(telemetry_list) - online_count,
            "active_deploying": active_deploying,
            "total_qa_tests": len(recent_deployments),
            "passed_tests": passed_count,
            "failed_tests": failed_count,
            "in_progress_tests": in_progress_count,
        },
    )


@router.get("/servers", response_model=List[ServerRead])
async def list_qa_servers(_: dict = Depends(auth.get_current_user)) -> List[ServerRead]:
    """List all servers designated as QA / Testing Runners."""
    docs = list(db.servers().find({"environment": "qa"}).sort("name", 1))
    return [server_doc_to_read(d) for d in docs]


@router.post("/servers/{server_id}/designate", response_model=ServerRead)
async def designate_qa_server(
    server_id: str,
    body: QAServerDesignateRequest,
    request: Request,
    current: dict = Depends(auth.require_admin),
) -> ServerRead:
    """Designate or un-designate a site server as a QA / Test Runner."""
    pid = parse_id(server_id) or server_id
    doc = db.servers().find_one({"$or": [{"_id": pid}, {"_id": server_id}]})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    new_env = "qa" if body.is_qa else "production"
    updates: dict = {
        "environment": new_env,
        "qa_role": body.qa_role if body.is_qa else None,
        "qa_test_url": body.qa_test_url if body.is_qa else None,
        "updated_at": now(),
    }

    db.servers().update_one({"_id": doc["_id"]}, {"$set": updates})
    audit_trail.record(
        current,
        "qa_server_designate",
        request,
        {
            "server_id": str(doc["_id"]),
            "hostname": doc.get("hostname"),
            "environment": new_env,
            "qa_role": body.qa_role,
        },
    )

    updated = server_doc_to_read(db.servers().find_one({"_id": doc["_id"]}))
    emit("server_updated", updated.model_dump(mode="json"))
    emit("qa_environment_updated", {"server_id": str(doc["_id"]), "environment": new_env})
    return updated


@router.post("/deployments", response_model=List[DeploymentRead], status_code=status.HTTP_201_CREATED)
async def trigger_qa_deployment(
    payload: QADeploymentTriggerRequest,
    request: Request,
    current: dict = Depends(auth.get_current_user),
) -> List[DeploymentRead]:
    """Trigger a fast-track QA deployment from any Git branch directly to QA agents.
    
    Bypasses production 3-team governance gate: starts immediately in 'pending' status
    so the remote QA agent picks up the job within 5 seconds, clones/pulls Git,
    and runs the software for QA testing.
    """
    sw_id = parse_id(payload.software_id) or payload.software_id
    software = db.softwares().find_one({"$or": [{"_id": sw_id}, {"_id": payload.software_id}]})
    if not software:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Software definition not found")

    batch_id = new_id() if len(payload.server_ids) > 1 else None
    created: List[DeploymentRead] = []

    for sid in payload.server_ids:
        pid = parse_id(sid) or sid
        server = db.servers().find_one({"$or": [{"_id": pid}, {"_id": sid}]})
        if not server:
            continue

        dep_id = new_id()
        components = payload.components_selected or [c["name"] for c in software.get("components", [])]

        # Branch map: apply specified branch to all selected components
        branches = {c: payload.branch for c in components}

        doc = {
            "_id": dep_id,
            "batch_id": batch_id,
            "server_id": str(sid),
            "software_id": str(software["_id"]),
            "software_name": software["name"],
            "status": "pending",  # Unlocked immediately for QA agent poller!
            "environment": "qa",
            "components_selected": components,
            "branches": branches,
            "client_name": payload.client_name or server.get("qa_role") or "QA Testing",
            "machine_type": payload.machine_type or "QA Runner",
            "triggered_by": current.get("email", "qa_tester"),
            "approvals": [],
            "approval_required_groups": [],
            "rejection": None,
            "qa_test_result": {
                "verdict": "in_progress",
                "tester_id": str(current.get("_id", "")),
                "tester_email": current.get("email", ""),
                "tested_at": now(),
                "test_notes": f"Deployed branch '{payload.branch}' to QA test node. Testing in progress.",
                "test_cases_run": 0,
                "bugs_found": 0,
            },
            "logs": [
                {
                    "ts": now(),
                    "stage": "QA_TRIGGERED",
                    "line": f"QA Fast-Track build queued by {current.get('email')}. Target branch: '{payload.branch}'. Remote QA agent will pull Git and build immediately.",
                    "level": "info",
                }
            ],
            "created_at": now(),
            "started_at": now(),
            "finished_at": None,
            "duration_seconds": None,
            "exit_code": None,
        }

        db.deployments().insert_one(doc)
        read_obj = _deployment_doc_to_read(doc)
        created.append(read_obj)

        emit(
            "deployment_created",
            {
                "id": str(dep_id),
                "batch_id": batch_id,
                "server_id": str(sid),
                "software_name": software["name"],
                "environment": "qa",
                "branch": payload.branch,
            },
        )
        emit("deployment_status", {"id": str(dep_id), "status": "pending"})

    if not created:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No valid target QA servers found")

    audit_trail.record(
        current,
        "qa_deployment_trigger",
        request,
        {
            "batch_id": batch_id,
            "count": len(created),
            "software": software["name"],
            "branch": payload.branch,
            "server_ids": payload.server_ids,
        },
    )
    return created


@router.patch("/deployments/{deployment_id}/verdict", response_model=DeploymentRead)
async def record_qa_test_verdict(
    deployment_id: str,
    payload: QATestResultUpdate,
    request: Request,
    current: dict = Depends(auth.get_current_user),
) -> DeploymentRead:
    """Record QA testing verification result (passed, failed, in_progress, blocked) with tester notes."""
    did = parse_id(deployment_id) or deployment_id
    doc = db.deployments().find_one({"$or": [{"_id": did}, {"_id": deployment_id}]})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deployment not found")

    test_result = {
        "verdict": payload.verdict,
        "tester_id": str(current.get("_id", "")),
        "tester_email": current.get("email", "qa_tester"),
        "tested_at": now(),
        "test_notes": payload.test_notes or "",
        "test_cases_run": payload.test_cases_run,
        "bugs_found": payload.bugs_found,
    }

    db.deployments().update_one(
        {"_id": did},
        {"$set": {"qa_test_result": test_result, "updated_at": now()}},
    )

    audit_trail.record(
        current,
        "qa_test_verdict",
        request,
        {
            "deployment_id": str(did),
            "verdict": payload.verdict,
            "bugs_found": payload.bugs_found,
            "notes": payload.test_notes,
        },
    )

    updated = db.deployments().find_one({"_id": did})
    read_obj = _deployment_doc_to_read(updated)
    emit("qa_verdict_updated", {"id": str(did), "verdict": payload.verdict, "test_result": test_result})
    return read_obj
