"""Vendor Portal — Submit and manage quotes."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from app.core.database import get_db
from app.core.rbac import get_current_user
from app.core.security import TokenData
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


def _require_vendor(token: TokenData = Depends(get_current_user)) -> TokenData:
    if token.role != "vendor":
        raise HTTPException(403, "Chỉ nhà cung cấp mới truy cập được")
    return token


@router.post("/submit")
async def submit_quote(
    body: dict[str, Any],
    token: TokenData = Depends(_require_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Gửi báo giá cho một đợt.

    Body:
    {
        "batch_id": 1,
        "currency": "USD",
        "lead_time_days": 14,
        "moq_notes": "MOQ 100 pcs",
        "notes": "...",
        "items": [
            {"item_id": 1, "unit_price": 12.50, "quantity": 100, "lead_time_days": 14, "notes": "..."},
            ...
        ]
    }
    """
    batch_id = body.get("batch_id")
    if not batch_id:
        raise HTTPException(400, "batch_id là bắt buộc")

    # Verify batch is published
    batch = await conn.fetchrow(
        "SELECT id, status FROM procurement_rfq_batches WHERE id = $1", batch_id
    )
    if not batch:
        raise HTTPException(404, "Đợt báo giá không tồn tại")
    if batch["status"] != "published":
        raise HTTPException(400, "Đợt báo giá đã đóng hoặc chưa công bố")

    vendor = await conn.fetchrow(
        "SELECT id FROM vendor_accounts WHERE user_id = $1", token.user_id
    )
    if not vendor:
        raise HTTPException(403, "Tài khoản nhà cung cấp không hợp lệ")
    vendor_id = vendor["id"]

    # Check if already submitted
    existing = await conn.fetchrow(
        "SELECT id, status FROM vendor_quotes WHERE batch_id = $1 AND vendor_id = $2",
        batch_id, vendor_id,
    )
    if existing and existing["status"] == "submitted":
        raise HTTPException(400, "Bạn đã gửi báo giá cho đợt này rồi")

    currency = body.get("currency", "USD")
    if currency not in ("USD", "RMB"):
        raise HTTPException(400, "Tiền tệ phải là USD hoặc RMB")

    items = body.get("items", [])
    if not items:
        raise HTTPException(400, "Cần ít nhất 1 item trong báo giá")

    # Create or update quote
    async with conn.transaction():
        if existing:
            quote_id = existing["id"]
            await conn.execute(
                """UPDATE vendor_quotes SET currency = $1, lead_time_days = $2,
                   moq_notes = $3, notes = $4, status = 'submitted',
                   submitted_at = NOW(), updated_at = NOW()
                WHERE id = $5""",
                currency, body.get("lead_time_days"),
                body.get("moq_notes"), body.get("notes"), quote_id,
            )
            await conn.execute("DELETE FROM vendor_quote_items WHERE quote_id = $1", quote_id)
        else:
            quote_id = await conn.fetchval(
                """INSERT INTO vendor_quotes (batch_id, vendor_id, currency, lead_time_days,
                   moq_notes, notes, status, submitted_at)
                VALUES ($1, $2, $3, $4, $5, $6, 'submitted', NOW())
                RETURNING id""",
                batch_id, vendor_id, currency, body.get("lead_time_days"),
                body.get("moq_notes"), body.get("notes"),
            )

        # Insert quote items
        total = 0
        for item in items:
            item_id = item.get("item_id")
            unit_price = item.get("unit_price", 0)
            qty = item.get("quantity")
            if not item_id or unit_price is None:
                continue

            await conn.execute(
                """INSERT INTO vendor_quote_items (quote_id, item_id, unit_price, quantity, lead_time_days, notes)
                VALUES ($1, $2, $3, $4, $5, $6)""",
                quote_id, item_id, unit_price, qty,
                item.get("lead_time_days"), item.get("notes"),
            )
            if qty and unit_price:
                total += float(unit_price) * float(qty)

        # Update total
        await conn.execute(
            "UPDATE vendor_quotes SET total_amount = $1 WHERE id = $2", total, quote_id
        )

        # Update batch quote count
        await conn.execute(
            """UPDATE procurement_rfq_batches SET quote_count = (
                SELECT COUNT(*) FROM vendor_quotes WHERE batch_id = $1 AND status = 'submitted'
            ) WHERE id = $1""",
            batch_id,
        )

        # Update invitation
        await conn.execute(
            "UPDATE procurement_rfq_invitations SET quoted_at = NOW() WHERE batch_id = $1 AND vendor_id = $2",
            batch_id, vendor_id,
        )

    logger.info("Vendor %d submitted quote for batch %d (%d items)", vendor_id, batch_id, len(items))

    return {
        "message": "Báo giá đã được gửi thành công!",
        "quote_id": quote_id,
        "total_amount": total,
    }


@router.get("/my")
async def my_quotes(
    page: int = 1,
    limit: int = 20,
    token: TokenData = Depends(_require_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Lịch sử báo giá của tôi."""
    vendor = await conn.fetchrow(
        "SELECT id FROM vendor_accounts WHERE user_id = $1", token.user_id
    )
    if not vendor:
        raise HTTPException(403, "Tài khoản không hợp lệ")

    rows = await conn.fetch(
        """
        SELECT vq.id, vq.batch_id, vq.currency, vq.total_amount, vq.status,
               vq.submitted_at, vq.lead_time_days,
               b.batch_code, b.title, b.status AS batch_status, b.item_count
        FROM vendor_quotes vq
        JOIN procurement_rfq_batches b ON b.id = vq.batch_id
        WHERE vq.vendor_id = $1
        ORDER BY vq.submitted_at DESC NULLS LAST
        LIMIT $2 OFFSET $3
        """,
        vendor["id"], limit, (page - 1) * limit,
    )

    return {"data": [dict(r) for r in rows]}


@router.post("/upload-file")
async def upload_quote_file(
    batch_id: int = Form(...),
    file: UploadFile = File(...),
    token: TokenData = Depends(_require_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Upload Excel/PDF đính kèm cho báo giá."""
    # Validate file type
    allowed = (".xlsx", ".xls", ".pdf")
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in allowed):
        raise HTTPException(400, "Chỉ chấp nhận file Excel (.xlsx, .xls) hoặc PDF (.pdf)")

    # Max 10MB
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "File quá lớn (tối đa 10MB)")

    vendor = await conn.fetchrow(
        "SELECT id FROM vendor_accounts WHERE user_id = $1", token.user_id
    )
    if not vendor:
        raise HTTPException(403, "Tài khoản không hợp lệ")

    # Save file
    from pathlib import Path
    upload_dir = Path(settings.FILES_BASE_PATH) / "vendor_uploads" / str(vendor["id"])
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / f"batch_{batch_id}_{file.filename}"
    dest.write_bytes(content)

    # Update quote attachment
    await conn.execute(
        "UPDATE vendor_quotes SET attachment_path = $1 WHERE batch_id = $2 AND vendor_id = $3",
        str(dest), batch_id, vendor["id"],
    )

    return {"message": "File đã tải lên", "path": str(dest), "size": len(content)}
