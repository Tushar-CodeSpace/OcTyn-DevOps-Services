"""Socket.IO realtime event bus.

Clients connect with `{auth: {token: <dashboard JWT>}}` and receive live
events. Server detail pages join the room `server:<server_id>` to get
metric samples and service updates.
"""

import asyncio
from typing import Optional

import socketio

from app.services.authentication import decode_access_token

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)

_main_loop: Optional[asyncio.AbstractEventLoop] = None


def init_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Capture the running event loop (called from the FastAPI lifespan)."""
    global _main_loop
    _main_loop = loop


def emit(event: str, data: dict, room: Optional[str] = None) -> None:
    """Fire-and-forget emit, safe from sync (threadpool) and async contexts."""
    if _main_loop is None:
        return
    asyncio.run_coroutine_threadsafe(
        sio.emit(event, data, room=room), _main_loop
    )


@sio.event
async def connect(sid, environ, auth_data) -> bool:
    token = auth_data.get("token") if isinstance(auth_data, dict) else None
    if not token:
        return False
    try:
        payload = decode_access_token(token)
    except Exception:
        return False
    if payload is None:
        return False
    await sio.save_session(sid, {"user_id": payload})
    return True


@sio.event
async def disconnect(sid) -> None:
    pass


@sio.event
async def join(sid, server_id: str) -> None:
    await sio.enter_room(sid, f"server:{server_id}")


@sio.event
async def leave(sid, server_id: str) -> None:
    await sio.leave_room(sid, f"server:{server_id}")