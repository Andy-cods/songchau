"""
Socket.IO server — async ASGI mode.

The sio_app is mounted in app/main.py at /ws, making the full
Socket.IO endpoint available at /ws/socket.io.

Usage from elsewhere in the app:
    from app.websocket import sio
    await sio.emit('event_name', data, room='user_123')
"""

import socketio

# ---------------------------------------------------------------------------
# Server instance
# ---------------------------------------------------------------------------

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    # Keep server-side logs quiet; application-level events log themselves.
    logger=False,
    engineio_logger=False,
    # Enable rooms (default) and namespaces (default namespace only).
)

# ---------------------------------------------------------------------------
# ASGI wrapper — mounted at /ws in main.py
# ---------------------------------------------------------------------------

sio_app = socketio.ASGIApp(sio, socketio_path="/ws/socket.io")

# ---------------------------------------------------------------------------
# Import handlers so their @sio.event decorators are registered at startup.
# The import must happen AFTER `sio` is defined to avoid circular imports.
# ---------------------------------------------------------------------------

from app.websocket import auth      # noqa: E402, F401  — registers connect / disconnect
from app.websocket import handlers  # noqa: E402, F401  — registers room/message events
