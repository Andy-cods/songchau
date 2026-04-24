"""Procurement Management — ERP admin endpoints for managing vendor bidding."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Vendor Account Management
# ---------------------------------------------------------------------------

@router.get("/vendors")
async def list_vendor_accounts(
    status: str = Query("all"),
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách tài khoản nhà cung cấp."""
    where = "1=1"
    if status == "pending":
        where = "va.is_approved = false"
    elif status == "approved":
        where = "va.is_approved = true"

    rows = await conn.fetch(
        f"""
        SELECT va.id, va.company_name, va.contact_name, va.phone, va.tax_code,
               va.product_categories, va.is_approved, va.approved_at, va.created_at,
               u.email,
               (SELECT COUNT(*) FROM vendor_quotes vq WHERE vq.vendor_id = va.id) AS quote_count
        FROM vendor_accounts va
        JOIN users u ON u.id = va.user_id
        WHERE {where}
        ORDER BY va.created_at DESC
        """
    )
    return {"data": [dict(r) for r in rows], "total": len(rows)}


@router.patch("/vendors/{vendor_id}/approve")
async def approve_vendor(
    vendor_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Duyệt tài khoản nhà cung cấp."""
    va = await conn.fetchrow("SELECT id, user_id FROM vendor_accounts WHERE id = $1", vendor_id)
    if not va:
        raise HTTPException(404, "Nhà cung cấp không tồn tại")

    await conn.execute(
        "UPDATE vendor_accounts SET is_approved = true, approved_by = $1, approved_at = NOW() WHERE id = $2",
        token_data.user_id, vendor_id,
    )
    await conn.execute("UPDATE users SET is_active = true WHERE id = $1", va["user_id"])

    return {"message": "Đã duyệt nhà cung cấp"}


@router.patch("/vendors/{vendor_id}/reject")
async def reject_vendor(
    vendor_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Từ chối tài khoản nhà cung cấp."""
    await conn.execute(
        "UPDATE vendor_accounts SET is_approved = false, notes = 'Từ chối bởi admin' WHERE id = $1",
        vendor_id,
    )
    return {"message": "Đã từ chối nhà cung cấp"}


# ---------------------------------------------------------------------------
# RFQ Batch Management
# ---------------------------------------------------------------------------

@router.get("/batches")
async def list_batches(
    status: str = Query("all"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách đợt báo giá."""
    where = "1=1"
    if status != "all":
        where = f"b.status = '{status}'"

    total = await conn.fetchval(f"SELECT COUNT(*) FROM procurement_rfq_batches b WHERE {where}")
    rows = await conn.fetch(
        f"""
        SELECT b.*, u.full_name AS created_by_name
        FROM procurement_rfq_batches b
        LEFT JOIN users u ON u.id = b.created_by
        WHERE {where}
        ORDER BY b.created_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit, (page - 1) * limit,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("/batches")
async def create_batch(
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo đợt báo giá mới."""
    title = body.get("title")
    if not title:
        raise HTTPException(400, "Tiêu đề đợt báo giá là bắt buộc")

    # Generate batch code
    count = await conn.fetchval("SELECT COUNT(*) FROM procurement_rfq_batches") or 0
    batch_code = f"BATCH-2026-{count + 1:04d}"

    batch_id = await conn.fetchval(
        """
        INSERT INTO procurement_rfq_batches (batch_code, title, description, award_mode, created_by, notes_internal)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        """,
        batch_code, title.strip(),
        body.get("description", "").strip() or None,
        body.get("award_mode", "per_item"),
        token_data.user_id,
        body.get("notes_internal", "").strip() or None,
    )

    return {"data": {"id": batch_id, "batch_code": batch_code}, "message": "Đã tạo đợt báo giá"}


@router.post("/batches/{batch_id}/items")
async def add_items_to_batch(
    batch_id: int,
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Thêm items vào đợt báo giá."""
    items = body.get("items", [])
    if not items:
        raise HTTPException(400, "Cần ít nhất 1 item")

    # Get next item_no
    max_no = await conn.fetchval(
        "SELECT COALESCE(MAX(item_no), 0) FROM procurement_rfq_items WHERE batch_id = $1", batch_id
    ) or 0

    added = 0
    for item in items:
        max_no += 1
        await conn.execute(
            """
            INSERT INTO procurement_rfq_items
                (batch_id, item_no, specification, bqms_code, quantity, unit,
                 required_material, notes, target_price, source_bqms_rfq_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """,
            batch_id, max_no,
            item.get("specification", "").strip(),
            item.get("bqms_code", "").strip() or None,
            item.get("quantity", 0),
            item.get("unit", "EA"),
            item.get("required_material", "").strip() or None,
            item.get("notes", "").strip() or None,
            item.get("target_price"),
            item.get("source_bqms_rfq_id"),
        )
        added += 1

    # Update item count
    await conn.execute(
        "UPDATE procurement_rfq_batches SET item_count = (SELECT COUNT(*) FROM procurement_rfq_items WHERE batch_id = $1) WHERE id = $1",
        batch_id,
    )

    return {"message": f"Đã thêm {added} items", "added": added}


@router.patch("/batches/{batch_id}/publish")
async def publish_batch(
    batch_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Công bố đợt báo giá cho nhà cung cấp."""
    batch = await conn.fetchrow(
        "SELECT id, status, item_count FROM procurement_rfq_batches WHERE id = $1", batch_id
    )
    if not batch:
        raise HTTPException(404, "Đợt báo giá không tồn tại")
    if batch["status"] != "draft":
        raise HTTPException(400, "Chỉ có thể công bố đợt ở trạng thái nháp")
    if (batch["item_count"] or 0) == 0:
        raise HTTPException(400, "Cần thêm ít nhất 1 item trước khi công bố")

    await conn.execute(
        "UPDATE procurement_rfq_batches SET status = 'published', published_at = NOW() WHERE id = $1",
        batch_id,
    )

    return {"message": "Đã công bố đợt báo giá. Nhà cung cấp có thể xem và báo giá."}


@router.get("/batches/{batch_id}")
async def get_batch_admin(
    batch_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Chi tiết đợt báo giá (admin view — bao gồm target_price, so sánh giá)."""
    batch = await conn.fetchrow("SELECT * FROM procurement_rfq_batches WHERE id = $1", batch_id)
    if not batch:
        raise HTTPException(404, "Đợt báo giá không tồn tại")

    items = await conn.fetch(
        "SELECT * FROM procurement_rfq_items WHERE batch_id = $1 ORDER BY item_no", batch_id
    )

    # Get all submitted quotes with vendor info
    quotes = await conn.fetch(
        """
        SELECT vq.id, vq.vendor_id, vq.currency, vq.total_amount, vq.status,
               vq.lead_time_days, vq.moq_notes, vq.notes, vq.submitted_at,
               va.company_name AS vendor_name
        FROM vendor_quotes vq
        JOIN vendor_accounts va ON va.id = vq.vendor_id
        WHERE vq.batch_id = $1 AND vq.status = 'submitted'
        ORDER BY vq.total_amount ASC NULLS LAST
        """,
        batch_id,
    )

    # Get per-item quotes for comparison table
    comparison = []
    for item in items:
        item_quotes = await conn.fetch(
            """
            SELECT vqi.unit_price, vqi.quantity, vqi.lead_time_days, vqi.notes,
                   vq.vendor_id, vq.currency, va.company_name AS vendor_name
            FROM vendor_quote_items vqi
            JOIN vendor_quotes vq ON vq.id = vqi.quote_id
            JOIN vendor_accounts va ON va.id = vq.vendor_id
            WHERE vqi.item_id = $1 AND vq.status = 'submitted'
            ORDER BY vqi.unit_price ASC
            """,
            item["id"],
        )
        comparison.append({
            "item": dict(item),
            "quotes": [dict(q) for q in item_quotes],
        })

    return {
        "data": {
            **dict(batch),
            "items": [dict(i) for i in items],
            "quotes": [dict(q) for q in quotes],
            "comparison": comparison,
        }
    }


@router.post("/batches/{batch_id}/award")
async def award_batch(
    batch_id: int,
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Chọn nhà cung cấp trúng thầu.

    Body for per_item: {"awards": [{"item_id": 1, "vendor_id": 5, "price": 12.50, "currency": "USD"}, ...]}
    Body for per_batch: {"vendor_id": 5}
    """
    batch = await conn.fetchrow(
        "SELECT id, status, award_mode FROM procurement_rfq_batches WHERE id = $1", batch_id
    )
    if not batch:
        raise HTTPException(404)
    if batch["status"] not in ("published", "closed"):
        raise HTTPException(400, "Đợt báo giá chưa công bố hoặc đã chọn xong")

    async with conn.transaction():
        if batch["award_mode"] == "per_batch":
            vendor_id = body.get("vendor_id")
            if not vendor_id:
                raise HTTPException(400, "vendor_id là bắt buộc")
            # Award all items to this vendor
            quote = await conn.fetchrow(
                "SELECT id FROM vendor_quotes WHERE batch_id = $1 AND vendor_id = $2 AND status = 'submitted'",
                batch_id, vendor_id,
            )
            if not quote:
                raise HTTPException(400, "Nhà cung cấp chưa gửi báo giá")

            # Get item prices from vendor's quote
            vq_items = await conn.fetch(
                "SELECT item_id, unit_price FROM vendor_quote_items WHERE quote_id = $1", quote["id"]
            )
            for vqi in vq_items:
                await conn.execute(
                    "UPDATE procurement_rfq_items SET awarded_vendor_id = $1, awarded_price = $2 WHERE id = $3",
                    vendor_id, vqi["unit_price"], vqi["item_id"],
                )

            await conn.execute(
                "UPDATE vendor_quotes SET status = 'awarded' WHERE id = $1", quote["id"]
            )
            # Reject others
            await conn.execute(
                "UPDATE vendor_quotes SET status = 'rejected' WHERE batch_id = $1 AND vendor_id != $2 AND status = 'submitted'",
                batch_id, vendor_id,
            )

        else:  # per_item
            awards = body.get("awards", [])
            for award in awards:
                await conn.execute(
                    """UPDATE procurement_rfq_items
                       SET awarded_vendor_id = $1, awarded_price = $2, awarded_currency = $3
                       WHERE id = $4 AND batch_id = $5""",
                    award["vendor_id"], award["price"], award.get("currency", "USD"),
                    award["item_id"], batch_id,
                )
                # Mark that vendor's quote as awarded
                await conn.execute(
                    """UPDATE vendor_quotes SET status = 'awarded'
                       WHERE batch_id = $1 AND vendor_id = $2 AND status = 'submitted'""",
                    batch_id, award["vendor_id"],
                )

        # Close batch
        await conn.execute(
            "UPDATE procurement_rfq_batches SET status = 'awarded', closed_at = NOW() WHERE id = $1",
            batch_id,
        )

    return {"message": "Đã chọn nhà cung cấp trúng thầu"}
