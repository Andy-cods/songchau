"""Vendor Portal — Browse published RFQ batches and items."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import get_current_user
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


def _require_vendor(token: TokenData = Depends(get_current_user)) -> TokenData:
    if token.role != "vendor":
        raise HTTPException(403, "Chỉ nhà cung cấp mới truy cập được")
    return token


@router.get("")
async def list_published_batches(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    token: TokenData = Depends(_require_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách đợt báo giá đang mở (published)."""
    vendor = await conn.fetchrow(
        "SELECT id FROM vendor_accounts WHERE user_id = $1", token.user_id
    )
    if not vendor:
        raise HTTPException(403, "Tài khoản nhà cung cấp không tồn tại")
    vendor_id = vendor["id"]

    total = await conn.fetchval(
        "SELECT COUNT(*) FROM procurement_rfq_batches WHERE status = 'published'"
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        """
        SELECT b.id, b.batch_code, b.title, b.description, b.status,
               b.item_count, b.published_at, b.created_at,
               (SELECT COUNT(*) FROM vendor_quotes vq WHERE vq.batch_id = b.id AND vq.vendor_id = $1) AS my_quote_count
        FROM procurement_rfq_batches b
        WHERE b.status = 'published'
        ORDER BY b.published_at DESC NULLS LAST
        LIMIT $2 OFFSET $3
        """,
        vendor_id, limit, offset,
    )

    return {"data": [dict(r) for r in rows], "total": total}


@router.get("/{batch_id}")
async def get_batch_detail(
    batch_id: int,
    token: TokenData = Depends(_require_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Chi tiết đợt báo giá + danh sách items (KHÔNG hiện target_price, source_bqms_rfq_id)."""
    batch = await conn.fetchrow(
        """
        SELECT id, batch_code, title, description, status, award_mode,
               item_count, published_at, created_at
        FROM procurement_rfq_batches WHERE id = $1
        """,
        batch_id,
    )
    if not batch:
        raise HTTPException(404, "Đợt báo giá không tồn tại")
    if batch["status"] not in ("published", "closed", "awarded"):
        raise HTTPException(403, "Đợt báo giá chưa được công bố")

    # Items — exclude sensitive fields
    items = await conn.fetch(
        """
        SELECT id, item_no, specification, bqms_code, quantity, unit,
               required_material, drawing_url, notes
        FROM procurement_rfq_items
        WHERE batch_id = $1
        ORDER BY item_no
        """,
        batch_id,
    )

    # Vendor's existing quote for this batch (if any)
    vendor = await conn.fetchrow(
        "SELECT id FROM vendor_accounts WHERE user_id = $1", token.user_id
    )
    my_quote = None
    if vendor:
        q = await conn.fetchrow(
            "SELECT id, currency, total_amount, status, submitted_at FROM vendor_quotes WHERE batch_id = $1 AND vendor_id = $2",
            batch_id, vendor["id"],
        )
        if q:
            q_items = await conn.fetch(
                "SELECT item_id, unit_price, quantity, lead_time_days, notes FROM vendor_quote_items WHERE quote_id = $1 ORDER BY item_id",
                q["id"],
            )
            my_quote = {**dict(q), "items": [dict(qi) for qi in q_items]}

    return {
        "data": {
            **dict(batch),
            "items": [dict(i) for i in items],
            "my_quote": my_quote,
        }
    }
