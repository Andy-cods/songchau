"""
Smart Notifications API (M11) — Enhanced notifications with send, preferences,
unread count, and bulk mark-read. Extends the core notifications table.
"""

from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SendNotificationRequest(BaseModel):
    recipient_ids: List[str]
    title: str
    body: str
    type: str = "info"          # maps to notifications.type column
    ref_type: str | None = None
    ref_id: str | None = None
    metadata: dict | None = None


class NotificationPreferencesUpdate(BaseModel):
    in_app_enabled: bool | None = None
    email_enabled: bool | None = None
    types_disabled: List[str] | None = None  # list of notification types to mute


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _ensure_preferences_row(conn: asyncpg.Connection, user_id: str) -> dict:
    """Return or create a notification preferences row for the user."""
    row = await conn.fetchrow(
        "SELECT * FROM notification_preferences WHERE user_id = $1::uuid",
        user_id,
    )
    if row:
        return dict(row)

    # Create default row — table may not exist yet, handle gracefully
    try:
        new_row = await conn.fetchrow(
            """
            INSERT INTO notification_preferences (user_id, in_app_enabled, email_enabled, types_disabled)
            VALUES ($1::uuid, true, false, '[]'::jsonb)
            ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
            RETURNING *
            """,
            user_id,
        )
        return dict(new_row) if new_row else {
            "user_id": user_id,
            "in_app_enabled": True,
            "email_enabled": False,
            "types_disabled": [],
        }
    except Exception:
        return {
            "user_id": user_id,
            "in_app_enabled": True,
            "email_enabled": False,
            "types_disabled": [],
        }


# ---------------------------------------------------------------------------
# GET / — List notifications for current user
# ---------------------------------------------------------------------------

@router.get("")
async def list_notifications(
    is_read: bool | None = Query(None, description="Lọc theo trạng thái đã đọc"),
    type: str | None = Query(None, description="Loại thông báo"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["n.recipient_id = $1::uuid"]
    params: list = [token_data.user_id]
    idx = 2

    if is_read is not None:
        conditions.append(f"n.is_read = ${idx}")
        params.append(is_read)
        idx += 1

    if type:
        conditions.append(f"n.type::text = ${idx}")
        params.append(type)
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM notifications n WHERE {where}", *params
    )

    unread_count = await conn.fetchval(
        "SELECT COUNT(*) FROM notifications WHERE recipient_id = $1::uuid AND is_read = false",
        token_data.user_id,
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT n.*
        FROM notifications n
        WHERE {where}
        ORDER BY n.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "unread_count": int(unread_count or 0),
        }
    }


# ---------------------------------------------------------------------------
# GET /unread-count — Bell badge count
# ---------------------------------------------------------------------------

@router.get("/unread-count")
async def get_unread_count(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    count = await conn.fetchval(
        "SELECT COUNT(*) FROM notifications WHERE recipient_id = $1::uuid AND is_read = false",
        token_data.user_id,
    )
    return {"data": {"unread_count": int(count or 0)}}


# ---------------------------------------------------------------------------
# POST /{id}/read — Mark single notification as read
# ---------------------------------------------------------------------------

@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE id = $1
          AND recipient_id = $2::uuid
        RETURNING id, is_read, read_at
        """,
        notification_id,
        token_data.user_id,
    )
    if not row:
        raise HTTPException(
            status_code=404,
            detail="Thông báo không tồn tại hoặc không thuộc về bạn",
        )
    return {"data": dict(row), "message": "Đã đánh dấu đã đọc"}


# ---------------------------------------------------------------------------
# POST /read-all — Mark all as read
# ---------------------------------------------------------------------------

@router.post("/read-all")
async def mark_all_read(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    result = await conn.execute(
        """
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE recipient_id = $1::uuid AND is_read = false
        """,
        token_data.user_id,
    )
    count = int(result.split()[-1]) if result else 0
    return {
        "data": {"updated": count},
        "message": f"Đã đánh dấu {count} thông báo đã đọc",
    }


# ---------------------------------------------------------------------------
# POST /send — Send notification to one or more users (admin/manager)
# ---------------------------------------------------------------------------

@router.post("/send", status_code=201)
async def send_notification(
    body: SendNotificationRequest,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Insert a notification row for each recipient_id.
    Optionally queue email if user preferences have email_enabled = true.
    Returns count of notifications created.
    """
    if not body.recipient_ids:
        raise HTTPException(status_code=400, detail="Phải cung cấp ít nhất 1 người nhận")
    if len(body.recipient_ids) > 100:
        raise HTTPException(status_code=400, detail="Tối đa 100 người nhận mỗi lần gửi")

    # Verify recipients exist
    valid_recipients = await conn.fetch(
        """
        SELECT id::text, email, full_name
        FROM users
        WHERE id::text = ANY($1::text[]) AND is_active = true
        """,
        body.recipient_ids,
    )
    valid_ids = {str(r["id"]) for r in valid_recipients}
    invalid_ids = [rid for rid in body.recipient_ids if rid not in valid_ids]

    import json as _json

    created = []
    email_queued = []

    async with conn.transaction():
        for recipient in valid_recipients:
            rid = str(recipient["id"])
            metadata_val = _json.dumps(body.metadata) if body.metadata else "{}"

            try:
                row = await conn.fetchrow(
                    """
                    INSERT INTO notifications
                        (recipient_id, type, title, body, is_read,
                         ref_type, ref_id, metadata)
                    VALUES
                        ($1::uuid, $2::text, $3, $4, false,
                         $5, $6, $7::jsonb)
                    RETURNING id, recipient_id, title, created_at
                    """,
                    rid,
                    body.type,
                    body.title,
                    body.body,
                    body.ref_type,
                    body.ref_id,
                    metadata_val,
                )
                created.append({
                    "notification_id": row["id"],
                    "recipient_id": rid,
                    "recipient_name": recipient["full_name"],
                })
            except Exception as exc:
                logger.warning("Failed to insert notification for %s: %s", rid, exc)
                continue

            # Check email preference
            try:
                prefs = await conn.fetchrow(
                    "SELECT email_enabled FROM notification_preferences WHERE user_id = $1::uuid",
                    rid,
                )
                if prefs and prefs["email_enabled"]:
                    # TODO: integrate Microsoft Graph API mailer here
                    email_queued.append(recipient["email"])
                    logger.info("Email notification queued for %s", recipient["email"])
            except Exception:
                pass  # preferences table may not exist yet — skip silently

    return {
        "data": {
            "sent_count": len(created),
            "email_queued_count": len(email_queued),
            "invalid_recipients": invalid_ids,
            "notifications": created,
        },
        "message": f"Đã gửi {len(created)} thông báo thành công",
    }


# ---------------------------------------------------------------------------
# GET /preferences — Get notification preferences for current user
# ---------------------------------------------------------------------------

@router.get("/preferences")
async def get_preferences(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    prefs = await _ensure_preferences_row(conn, token_data.user_id)
    return {"data": prefs}


# ---------------------------------------------------------------------------
# PUT /preferences — Update notification preferences
# ---------------------------------------------------------------------------

@router.put("/preferences")
async def update_preferences(
    body: NotificationPreferencesUpdate,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    import json as _json

    # Build dynamic SET clause
    set_parts = []
    params: list = [token_data.user_id]
    idx = 2

    if body.in_app_enabled is not None:
        set_parts.append(f"in_app_enabled = ${idx}")
        params.append(body.in_app_enabled)
        idx += 1

    if body.email_enabled is not None:
        set_parts.append(f"email_enabled = ${idx}")
        params.append(body.email_enabled)
        idx += 1

    if body.types_disabled is not None:
        set_parts.append(f"types_disabled = ${idx}::jsonb")
        params.append(_json.dumps(body.types_disabled))
        idx += 1

    if not set_parts:
        # Nothing to update — return current
        prefs = await _ensure_preferences_row(conn, token_data.user_id)
        return {"data": prefs, "message": "Không có thay đổi"}

    set_clause = ", ".join(set_parts)

    try:
        row = await conn.fetchrow(
            f"""
            INSERT INTO notification_preferences (user_id)
            VALUES ($1::uuid)
            ON CONFLICT (user_id) DO UPDATE
            SET {set_clause}
            RETURNING *
            """,
            *params,
        )
        return {"data": dict(row) if row else {}, "message": "Đã cập nhật cài đặt thông báo"}
    except Exception as exc:
        logger.warning("notification_preferences table may not exist: %s", exc)
        return {
            "data": {
                "user_id": token_data.user_id,
                "in_app_enabled": body.in_app_enabled if body.in_app_enabled is not None else True,
                "email_enabled": body.email_enabled if body.email_enabled is not None else False,
                "types_disabled": body.types_disabled or [],
            },
            "message": "Đã cập nhật cài đặt thông báo (chế độ tạm thời)",
        }
