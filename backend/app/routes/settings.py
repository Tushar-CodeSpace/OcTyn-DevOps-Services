"""Platform settings routes (dashboard users; writes admin-only)."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.services import app_settings
from app.services import authentication as auth
from app.services import notifier

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class AlertSettingsRead(BaseModel):
    ram_threshold_percent: float
    cpu_threshold_percent: float
    cpu_duration_seconds: float
    disk_threshold_percent: float
    api_error_threshold_percent: float = 5.0
    offline_threshold_seconds: int = 60
    config_sync_enabled: bool = True
    config_sync_hour: int = 0
    metrics_retention_days: int = 7


class AlertSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ram_threshold_percent: Optional[float] = Field(default=None, ge=0, le=100)
    cpu_threshold_percent: Optional[float] = Field(default=None, ge=0, le=100)
    cpu_duration_seconds: Optional[int] = Field(default=None, ge=30)
    disk_threshold_percent: Optional[float] = Field(default=None, ge=0, le=100)
    api_error_threshold_percent: Optional[float] = Field(default=None, ge=0, le=100)
    offline_threshold_seconds: Optional[int] = Field(default=None, ge=15)
    config_sync_enabled: Optional[bool] = None
    config_sync_hour: Optional[int] = Field(default=None, ge=0, le=23)
    metrics_retention_days: Optional[int] = Field(default=None, ge=1, le=365)


@router.get("", response_model=AlertSettingsRead)
async def get_settings(_: dict = Depends(auth.get_current_user)) -> AlertSettingsRead:
    """Effective platform settings (defaults merged with runtime overrides)."""
    merged = {**app_settings.get_alert_config(), **app_settings.get_config_sync_config()}
    return AlertSettingsRead(**merged)


@router.patch("", response_model=AlertSettingsRead)
async def update_settings(
    body: AlertSettingsUpdate,
    _: dict = Depends(auth.require_admin),
) -> AlertSettingsRead:
    """Persist settings overrides. Admin role required."""
    alert_patch: dict[str, object] = {}
    sync_patch: dict[str, object] = {}
    for key, value in body.model_dump().items():
        if value is None:
            continue
        if key.startswith("config_sync_") or key == "metrics_retention_days":
            sync_patch[key] = value
        else:
            alert_patch[key] = value

    try:
        if alert_patch:
            app_settings.update_alert_config(alert_patch)
        if sync_patch:
            app_settings.update_config_sync_config(sync_patch)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    merged = {**app_settings.get_alert_config(), **app_settings.get_config_sync_config()}
    return AlertSettingsRead(**merged)


@router.post("/prune")
async def trigger_data_pruning(_: dict = Depends(auth.require_admin)) -> dict:
    """Manually trigger instant data pruning of telemetry & logs older than retention period (7 days)."""
    from app.services.background import cleanup_expired_data
    result = cleanup_expired_data()
    return {
        "status": "success",
        "message": f"Successfully pruned data older than {result['retention_days']} days.",
        "details": result,
    }


# ------------------------------------------------------------- whatsapp ---

class WhatsAppSettingsRead(BaseModel):
    whatsapp_enabled: bool
    whatsapp_base_url: str
    whatsapp_instance: str
    # api_key intentionally never returned to the client
    whatsapp_api_key_set: bool
    whatsapp_recipients: str


class WhatsAppSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")  # reject unknown/typo'd keys

    whatsapp_enabled: Optional[bool] = None
    whatsapp_base_url: Optional[str] = None
    whatsapp_instance: Optional[str] = None
    whatsapp_api_key: Optional[str] = None  # empty/omitted = keep current
    whatsapp_recipients: Optional[str] = None


class WhatsAppTestResult(BaseModel):
    number: str
    ok: bool
    detail: str


def _wa_read_model(cfg: dict) -> WhatsAppSettingsRead:
    cfg.pop("whatsapp_api_key", None)
    return WhatsAppSettingsRead(
        **cfg,
        whatsapp_api_key_set=bool(app_settings.get_notification_config()["whatsapp_api_key"]),
    )


@router.get("/whatsapp", response_model=WhatsAppSettingsRead)
async def get_whatsapp(_: dict = Depends(auth.get_current_user)) -> WhatsAppSettingsRead:
    return _wa_read_model(dict(app_settings.get_notification_config()))


@router.patch("/whatsapp", response_model=WhatsAppSettingsRead)
async def update_whatsapp(
    body: WhatsAppSettingsUpdate,
    _: dict = Depends(auth.require_admin),
) -> WhatsAppSettingsRead:
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if "whatsapp_api_key" in patch and not patch["whatsapp_api_key"].strip():
        del patch["whatsapp_api_key"]  # empty string = keep existing key
    if not patch:  # nothing to change (e.g. only a blank key was sent)
        return _wa_read_model(dict(app_settings.get_notification_config()))
    try:
        app_settings.update_notification_config(patch)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return _wa_read_model(dict(app_settings.get_notification_config()))


@router.post("/whatsapp/test", response_model=list[WhatsAppTestResult])
async def test_whatsapp(_: dict = Depends(auth.require_admin)) -> list[WhatsAppTestResult]:
    """Send a test message now using the stored configuration."""
    return [WhatsAppTestResult(**r) for r in notifier.send_test()]
