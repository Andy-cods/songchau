"""
WebSocket authentication — JWT verification on every connect.

The client must pass an auth dict containing a valid access token:

    socket = io('http://...', { auth: { token: '<jwt>' } });

On success the session stores { user_id, role, email } and the client
is automatically added to their personal room (user_{user_id}) and their
role room (role_{role}) so targeted emits work with a single call.

On failure the connection is rejected with an AuthError, which
python-socketio surfaces to the client as a standard error event.
"""

from __future__ import annotations

import logging
from jose import JWTError

from app.websocket import sio          # the AsyncServer instance
from app.core.security import decode_token

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Connect / disconnect
# ---------------------------------------------------------------------------

@sio.event
async def connect(sid: str, environ: dict, auth: dict | None) -> bool:
    """
    Called automatically when a client sends the Socket.IO handshake.

    Parameters
    ----------
    sid      : unique socket session ID assigned by python-socketio.
    environ  : WSGI/ASGI environ dict (headers, query string, …).
    auth     : dict sent by the client, expected to contain 'token'.

    Returns True to allow the connection, raises ConnectionRefusedError
    (or returns False) to deny it.
    """
    # --- 1. Extract token -------------------------------------------------
    if not auth or not isinstance(auth, dict):
        logger.warning("WS connect rejected: no auth dict (sid=%s)", sid)
        raise ConnectionRefusedError("Authentication required")

    token: str | None = auth.get("token")
    if not token:
        logger.warning("WS connect rejected: missing token (sid=%s)", sid)
        raise ConnectionRefusedError("Token is required")

    # --- 2. Decode & verify JWT -------------------------------------------
    try:
        payload = decode_token(token)
    except JWTError as exc:
        logger.warning("WS connect rejected: invalid/expired token (sid=%s): %s", sid, exc)
        raise ConnectionRefusedError("Token expired or invalid") from exc

    # Require an access token, not a refresh token
    if payload.get("type") != "access":
        logger.warning("WS connect rejected: wrong token type (sid=%s)", sid)
        raise ConnectionRefusedError("Access token required")

    user_id: str = payload["sub"]
    role: str    = payload["role"]
    email: str   = payload.get("email", "")

    # --- 3. Store identity in the session ----------------------------------
    await sio.save_session(sid, {
        "user_id": user_id,
        "role":    role,
        "email":   email,
    })

    # --- 4. Join personal and role-based rooms -----------------------------
    # Personal room: only messages directed at this user arrive here.
    await sio.enter_room(sid, f"user_{user_id}")
    # Role room: broadcast to every online user with the same role.
    await sio.enter_room(sid, f"role_{role}")

    logger.info(
        "WS connected: user=%s role=%s sid=%s",
        user_id, role, sid,
    )

    # Acknowledge connection to the client with minimal info
    await sio.emit(
        "connected",
        {
            "user_id": user_id,
            "role":    role,
            "rooms":   [f"user_{user_id}", f"role_{role}"],
        },
        to=sid,
    )

    return True


@sio.event
async def disconnect(sid: str) -> None:
    """Called when a client disconnects (intentional or network drop)."""
    try:
        session = await sio.get_session(sid)
        user_id = session.get("user_id", "unknown")
        logger.info("WS disconnected: user=%s sid=%s", user_id, sid)
    except Exception:
        logger.info("WS disconnected: sid=%s (no session)", sid)
