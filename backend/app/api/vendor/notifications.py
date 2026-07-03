"""Vendor Portal — MY notifications (login-scoped).

Đợt 6 (Thang 2026-06-19): the supplier-facing notification feed. The admin/staff
side lives in `app/api/v1/notifications.py` and is scoped by `recipient_id`
(a user uuid). The VENDOR side here is scoped EXCLUSIVELY by the NEW column
`notifications.recipient_vendor_id = resolve_vendor()` (active vendor_accounts.id).

A vendor can ONLY ever see / mutate rows addressed to their own vendor account.
Admin-recipient rows (recipient_vendor_id IS NULL, addressed via recipient_id)
are NEVER exposed here — every query carries the
`recipient_vendor_id = $vendor_id` predicate, so an admin notification can never
leak to a supplier even by id. Cross-tenant / non-mine ids return 404 (never 403)
on mutation, so we don't leak the existence of another vendor's notification.

Endpoints:
  - GET  /api/vendor/notifications?limit=20  → {data:[...], unread_count}
  - PUT  /api/vendor/notifications/{id}/read → mark one read (404 if not mine).
  - PUT  /api/vendor/notifications/read-all  → mark all my unread read.
"""
from __future__ import annotations

import json as _json
import logging

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.vendor.deps import resolve_vendor
from app.core.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
async def list_my_notifications(
    limit: int = Query(20, ge=1, le=100),
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách THÔNG BÁO của tôi (chỉ thông báo gửi cho tài khoản NCC của tôi).

    Scoped to `notifications.recipient_vendor_id = resolve_vendor()`. Admin-recipient
    rows (recipient_vendor_id IS NULL) are NEVER returned. Newest first, capped by
    ?limit (default 20). `unread_count` counts ALL my unread rows (not just the
    page) so the bell badge stays accurate.
    """
    rows = await conn.fetch(
        """
        SELECT id, type, title, body, ref_type, ref_id, metadata, is_read,
               read_at, created_at
          FROM notifications
         WHERE recipient_vendor_id = $1
         ORDER BY created_at DESC
         LIMIT $2
        """,
        vendor_id, limit,
    )

    unread_count = await conn.fetchval(
        """
        SELECT COUNT(*)
          FROM notifications
         WHERE recipient_vendor_id = $1 AND is_read = false
        """,
        vendor_id,
    )

    # `metadata` jsonb → asyncpg trả về `str`. Parse sẵn ở BE để FE đọc thẳng
    # metadata.entity_id (contract_id / po_id / batch_id) build deep-link — khỏi
    # JSON.parse rời rạc bên FE. Lỗi parse → None (an toàn, không vỡ feed).
    out: list[dict] = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("metadata"), str):
            try:
                d["metadata"] = _json.loads(d["metadata"])
            except (ValueError, TypeError):
                d["metadata"] = None
        out.append(d)

    return {
        "data": out,
        "unread_count": unread_count or 0,
    }


@router.put("/{notification_id}/read")
async def mark_my_notification_read(
    notification_id: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Đánh dấu 1 thông báo CỦA TÔI là đã đọc.

    GUARD: the row must be addressed to my vendor account
    (recipient_vendor_id = resolve_vendor()) — else 404 (never 403), so we don't
    leak the existence of another vendor's / an admin's notification. Idempotent:
    re-marking an already-read row still returns 200.
    """
    row = await conn.fetchrow(
        """
        UPDATE notifications
           SET is_read = true, read_at = NOW()
         WHERE id = $1 AND recipient_vendor_id = $2
        RETURNING id, is_read
        """,
        notification_id, vendor_id,
    )
    if not row:
        raise HTTPException(404, "Không tìm thấy thông báo")
    return {"data": dict(row), "message": "Đã đánh dấu đã đọc"}


@router.put("/read-all")
async def mark_all_my_notifications_read(
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Đánh dấu TẤT CẢ thông báo chưa đọc CỦA TÔI là đã đọc.

    Scoped to `recipient_vendor_id = resolve_vendor()` AND is_read = false — admin
    rows are never touched. Returns how many rows were updated.
    """
    result = await conn.execute(
        """
        UPDATE notifications
           SET is_read = true, read_at = NOW()
         WHERE recipient_vendor_id = $1 AND is_read = false
        """,
        vendor_id,
    )
    # result is like "UPDATE N"
    count = int(result.split()[-1]) if result else 0
    return {"data": {"updated": count}, "message": f"Đã đánh dấu {count} thông báo đã đọc"}
