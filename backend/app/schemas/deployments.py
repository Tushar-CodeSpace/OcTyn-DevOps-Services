"""Software Deployment schemas.

Supports multi-component applications (Node monorepos with PM2, PHP with Nginx,
and client/machine-specific config repositories).
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class SoftwareComponent(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str = Field(default="nodejs_monorepo")  # nodejs_monorepo | php_nginx | custom_script | docker
    repo_url: str = Field(min_length=1, max_length=500)
    default_branch: str = Field(default="main", max_length=100)
    target_dir: str = Field(min_length=1, max_length=300)
    runtime_version: Optional[str] = Field(default="24", max_length=50)  # e.g. "24" for Node, "8.4" for PHP
    build_command: Optional[str] = Field(default="npm ci && npm run build", max_length=1000)
    start_command: Optional[str] = Field(default="pm2 startOrRestart ecosystem.config.js", max_length=1000)
    env_vars: Dict[str, str] = Field(default_factory=dict)


class SoftwareConfigRepo(BaseModel):
    name: str = Field(default="Client Machine Configs", max_length=100)
    repo_url: str = Field(min_length=1, max_length=500)
    default_branch: str = Field(default="main", max_length=100)
    target_dir: str = Field(default="/opt/nidoworkz/configs", max_length=300)
    profile_pattern: str = Field(default="configs/{client}/{machine_type}", max_length=200)
    import_to_mongo: bool = True
    mongo_database: Optional[str] = Field(default="", max_length=100)
    import_script: Optional[str] = Field(default="", max_length=1000)


class SoftwareCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    components: List[SoftwareComponent] = Field(default_factory=list)
    config_repo: Optional[SoftwareConfigRepo] = None


class SoftwareRead(SoftwareCreate):
    id: str
    created_at: datetime
    updated_at: datetime
    created_by: Optional[str] = None


class DeploymentTriggerRequest(BaseModel):
    server_id: Optional[str] = None
    server_ids: Optional[List[str]] = Field(default_factory=list)
    software_id: str = Field(min_length=1, max_length=100)
    components_selected: List[str] = Field(default_factory=list)  # Empty means all components
    branches: Dict[str, str] = Field(default_factory=dict)         # component_name -> branch override
    client_name: Optional[str] = Field(default="", max_length=100)
    machine_type: Optional[str] = Field(default="", max_length=100)


class DeploymentLogEntry(BaseModel):
    ts: datetime
    stage: str
    line: str
    level: str = "info"  # info, warn, error, success


class DeploymentApprovalEntry(BaseModel):
    user_id: str
    email: str
    user_group: str  # devops | developer | product
    approved_at: datetime
    notes: Optional[str] = ""


class DeploymentApprovalRequest(BaseModel):
    user_group: Optional[str] = None  # Defaults to user's assigned group
    notes: Optional[str] = Field(default="", max_length=500)


class DeploymentRejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class DeploymentRead(BaseModel):
    id: str
    batch_id: Optional[str] = None
    server_id: str
    server_name: str
    site_name: str
    software_id: str
    software_name: str
    status: str  # pending_approval, pending, running, success, failed, cancelled, rejected
    components_selected: List[str]
    branches: Dict[str, str]
    client_name: Optional[str] = None
    machine_type: Optional[str] = None
    triggered_by: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    exit_code: Optional[int] = None
    logs: List[DeploymentLogEntry] = Field(default_factory=list)
    approvals: List[DeploymentApprovalEntry] = Field(default_factory=list)
    approval_required_groups: List[str] = Field(default_factory=lambda: ["devops", "developer", "product"])
    rejection: Optional[Dict[str, Any]] = None


class DeploymentLogStream(BaseModel):
    stage: str
    line: str
    level: str = "info"


class DeploymentFinishPayload(BaseModel):
    status: str  # success, failed, cancelled
    exit_code: int
    duration_seconds: float
    error_summary: Optional[str] = None
