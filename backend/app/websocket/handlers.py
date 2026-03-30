"""
WebSocket event handlers and emit helpers.

All functions are async and safe to call from anywhere in the application
(API routes, background tasks, etc.).

Room conventions
----------------
user_{user_id}     — personal room, one per authenticated user
role_{role}        — role-based room, e.g. role_admin / role_manager / role_staff
role_warehouse     — warehouse team (stock alerts)
role_procurement   — procurement team (BQMS sync, stock alerts)

Emitting from HTTP handlers
----------------------------
    from app.websocket.handlers import emit_workflow_update
    await emit_workflow_update(workflow_id, new_status, assigned_to_user_id)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.websocket import sio  # the AsyncServer instance

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    """Current UTC timestamp as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


async def _emit(event: str, data: dict[str, Any], room: str) -> None:
    """Thin wrapper for uniform error-handling around sio.emit."""
    try:
        await sio.emit(event, data, room=room)
        logger.debug("WS emit: event=%s room=%s", event, room)
    except Exception as exc:
        logger.error("WS emit failed: event=%s room=%s err=%s", event, room, exc)


# ---------------------------------------------------------------------------
# Public emit helpers
# ---------------------------------------------------------------------------

async def emit_workflow_update(
    workflow_id: str,
    status: str,
    assigned_to: str | None,
    *,
    title: str | None = None,
    actor_name: str | None = None,
    comment: str | None = None,
) -> None:
    """
    Emit a workflow status-change event to all relevant parties.

    Sends to:
    - The assigned user's personal room (if provided).
    - Managers and admins (role rooms) so approval queues update live.
    """
    payload: dict[str, Any] = {
        "workflow_id": workflow_id,
        "status":      status,
        "title":       title,
        "actor_name":  actor_name,
        "comment":     comment,
        "timestamp":   _now_iso(),
    }

    # Notify the directly assigned approver / creator
    if assigned_to:
        await _emit("workflow_update", payload, room=f"user_{assigned_to}")

    # Broadcast to managers and admins so their queues can refresh
    for role_room in ("role_manager", "role_admin"):
        await _emit("workflow_update", payload, room=role_room)


async def emit_notification(
    user_id: str,
    notification_data: dict[str, Any],
) -> None:
    """
    Send a notification to a specific user's personal room.

    Parameters
    ----------
    user_id           : UUID string of the target user.
    notification_data : Dict with at minimum 'id', 'type', 'title', 'body'.
                        Typically the row returned after INSERT INTO notifications.
    """
    payload: dict[str, Any] = {
        **notification_data,
        "timestamp": notification_data.get("created_at") or _now_iso(),
    }
    await _emit("notification", payload, room=f"user_{user_id}")


async def emit_stock_alert(
    product_code: str,
    quantity: float | int,
    min_stock: float | int,
    *,
    product_name: str | None = None,
    warehouse_location: str | None = None,
) -> None:
    """
    Broadcast a low-stock alert to warehouse staff and procurement team.

    Both role_warehouse and role_procurement rooms receive the event so
    the right teams see it regardless of which role is logged in.
    """
    payload: dict[str, Any] = {
        "product_code":       product_code,
        "product_name":       product_name,
        "current_quantity":   quantity,
        "min_stock":          min_stock,
        "shortage":           max(0, min_stock - quantity),
        "warehouse_location": warehouse_location,
        "timestamp":          _now_iso(),
    }

    for role_room in ("role_warehouse", "role_procurement", "role_manager", "role_admin"):
        await _emit("stock_alert", payload, room=role_room)


async def emit_bqms_sync_done(
    result: dict[str, Any],
) -> None:
    """
    Broadcast BQMS nightly-sync completion to the procurement team.

    Parameters
    ----------
    result : Summary dict produced by the bqms_nightly_sync task, e.g.:
             {
               "new_pos": 12,
               "pdfs_downloaded": 12,
               "errors": 0,
               "duration_seconds": 34.2,
               "synced_at": "2026-03-29T23:30:00+00:00",
             }
    """
    payload: dict[str, Any] = {
        **result,
        "timestamp": result.get("synced_at") or _now_iso(),
    }

    for role_room in ("role_procurement", "role_manager", "role_admin"):
        await _emit("bqms_sync_done", payload, room=role_room)


async def emit_report_ready(
    report_type: str,
    *,
    target_role: str = "manager",
    details: dict[str, Any] | None = None,
) -> None:
    """
    Notify users that a scheduled report is ready to view.

    Parameters
    ----------
    report_type : Short identifier, e.g. 'daily_summary', 'stock_aging'.
    target_role : Role room to broadcast to (default 'manager').
    details     : Optional extra metadata (url, generated_at, etc.).
    """
    payload: dict[str, Any] = {
        "report_type": report_type,
        "details":     details or {},
        "timestamp":   _now_iso(),
    }

    await _emit("report_ready", payload, room=f"role_{target_role}")
    # Admins always get report notifications too
    if target_role != "admin":
        await _emit("report_ready", payload, room="role_admin")


# ---------------------------------------------------------------------------
# Socket.IO message events (client → server)
# ---------------------------------------------------------------------------

@sio.event
async def ping(sid: str, data: Any = None) -> dict[str, str]:
    """Simple ping/pong for connection health checks from the frontend."""
    return {"pong": _now_iso()}


@sio.event
async def subscribe_room(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """
    Allow authenticated clients to join additional rooms (e.g. a specific
    workflow room) after the initial connection.

    The client sends: { "room": "workflow_<id>" }
    Only permitted prefixes are allowed to prevent abuse.
    """
    ALLOWED_PREFIXES = ("workflow_", "po_", "inventory_")

    room: str = (data or {}).get("room", "")
    if not room or not any(room.startswith(p) for p in ALLOWED_PREFIXES):
        return {"error": "Room not permitted", "room": room}

    await sio.enter_room(sid, room)
    logger.debug("WS subscribe_room: sid=%s room=%s", sid, room)
    return {"joined": room}


@sio.event
async def unsubscribe_room(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Leave a previously joined supplementary room."""
    room: str = (data or {}).get("room", "")
    if room:
        await sio.leave_room(sid, room)
        logger.debug("WS unsubscribe_room: sid=%s room=%s", sid, room)
    return {"left": room}
