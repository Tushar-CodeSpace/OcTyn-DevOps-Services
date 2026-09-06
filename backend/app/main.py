import asyncio
from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.settings import settings
from app.database.connection import close_client
from app.database.indexes import ensure_indexes
from app.realtime import init_loop, sio
from app.routes import (
    agent_config,
    agent_update,
    alerts,
    api_keys,
    auth,
    connectivity,
    dashboard,
    health,
    metrics,
    servers,
    services,
    sites,
    terminal,
    users,
)
from app.routes import configs as configs_routes
from app.routes import settings as settings_routes
from app.services.background import run_background_loop
from app.services.logging_setup import get_logger, setup_logging

setup_logging(level=settings.log_level, log_dir=settings.log_dir)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_loop(asyncio.get_running_loop())
    ensure_indexes()
    task = asyncio.create_task(run_background_loop())
    logger.info("backend started", extra={"extra_fields": {"version": "0.1.0"}})
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    close_client()


app = FastAPI(
    title="OcTyn DevOps Services API",
    description="Centralized continuous monitoring platform - API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(sites.router)
app.include_router(servers.router)
app.include_router(metrics.router)
app.include_router(configs_routes.router)
app.include_router(api_keys.router)
app.include_router(services.router)
app.include_router(alerts.router)
app.include_router(settings_routes.router)
app.include_router(dashboard.router)
app.include_router(agent_config.router)
app.include_router(agent_update.router)
app.include_router(connectivity.router)
app.include_router(terminal.router)

# Entrypoint for uvicorn: app.main:socket_app
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)