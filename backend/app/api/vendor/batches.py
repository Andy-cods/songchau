"""Vendor Portal — Browse INVITED RFQ batches and items (login-scoped).

Đợt 1 rebuild: a supplier only ever sees batches they were explicitly INVITED to
(via procurement_rfq_invitations), NOT every published batch. Scoping goes through
`resolve_vendor` (active account) so a vendor can never read another vendor's data
or an uninvited batch. Sensitive admin fields (target_price, source_bqms_rfq_id,
notes_internal) are NEVER selected.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.api.vendor.deps import resolve_vendor
from app.api.v1.bqms_images import resolve_rfq_file_path
from app.core.database import get_db
from app.services.procurement_notifications import dispatch_procurement_event

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
async def list_invited_batches(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách đợt báo giá NCC ĐƯỢC MỜI (đã công bố).

    JOIN procurement_rfq_invitations on vendor_id — a vendor only sees batches
    they were invited to. If a vendor was invited across multiple rounds we keep
    the latest invitation row per batch (DISTINCT ON ... round_number DESC) so the
    list shows one row per batch with the most recent invitation state.
    """
    total = await conn.fetchval(
        """
        SELECT COUNT(DISTINCT b.id)
          FROM procurement_rfq_batches b
          JOIN procurement_rfq_invitations inv
            ON inv.batch_id = b.id AND inv.vendor_id = $1
         WHERE b.status IN ('published', 'closed', 'awarded')
        """,
        vendor_id,
    )
    offset = (page - 1) * limit
    rows = await conn.fetch(
        """
        SELECT b.id, b.batch_code, b.title, b.description, b.status,
               b.item_count, b.published_at, b.created_at,
               b.bid_deadline, b.current_round, b.award_mode,
               inv.invited_at, inv.viewed_at, inv.quoted_at,
               inv.status AS inv_status, inv.round_number,
               (SELECT COUNT(*) FROM vendor_quotes vq
                 WHERE vq.batch_id = b.id AND vq.vendor_id = $1) AS my_quote_count
          FROM procurement_rfq_batches b
          JOIN LATERAL (
                SELECT i.invited_at, i.viewed_at, i.quoted_at, i.status, i.round_number
                  FROM procurement_rfq_invitations i
                 WHERE i.batch_id = b.id AND i.vendor_id = $1
                 ORDER BY i.round_number DESC NULLS LAST, i.invited_at DESC NULLS LAST
                 LIMIT 1
               ) inv ON TRUE
         WHERE b.status IN ('published', 'closed', 'awarded')
         ORDER BY b.published_at DESC NULLS LAST
         LIMIT $2 OFFSET $3
        """,
        vendor_id, limit, offset,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.get("/{batch_id}")
async def get_invited_batch_detail(
    batch_id: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Chi tiết đợt báo giá NCC được mời + items (ẩn target_price / nguồn BQMS).

    SANITIZED: never selects target_price / notes_internal / source_bqms_rfq_id /
    awarded_* — those are admin-only. 404 (not 403) when no invitation exists so we
    don't leak the existence of uninvited batches. Marks first view: sets viewed_at
    and bumps invitation status 'invited' -> 'viewed' (never downgrades a 'submitted'
    or 'declined' invitation).
    """
    inv = await conn.fetchrow(
        """
        SELECT id, round_number, status
          FROM procurement_rfq_invitations
         WHERE batch_id = $1 AND vendor_id = $2
         ORDER BY round_number DESC NULLS LAST, invited_at DESC NULLS LAST
         LIMIT 1
        """,
        batch_id, vendor_id,
    )
    if not inv:
        # 404 (not 403) to avoid leaking the existence of batches not invited to.
        raise HTTPException(404, "Không tìm thấy đợt báo giá")

    batch = await conn.fetchrow(
        """
        SELECT id, batch_code, title, description, status, award_mode,
               item_count, published_at, created_at,
               bid_deadline, deadline_round1, deadline_round2, deadline_round3,
               current_round, req_name, requester, department
          FROM procurement_rfq_batches WHERE id = $1
        """,
        batch_id,
    )
    if not batch:
        raise HTTPException(404, "Không tìm thấy đợt báo giá")
    if batch["status"] not in ("published", "closed", "awarded"):
        raise HTTPException(403, "Đợt báo giá chưa được công bố")

    # Mark first view: set viewed_at + promote 'invited' -> 'viewed' only.
    await conn.execute(
        """
        UPDATE procurement_rfq_invitations
           SET viewed_at = COALESCE(viewed_at, NOW()),
               status = CASE WHEN status = 'invited' THEN 'viewed' ELSE status END
         WHERE id = $1
        """,
        inv["id"],
    )

    items = await conn.fetch(
        """
        -- SECURITY: target_price (giá mục tiêu của BÊN MUA) TUYỆT ĐỐI không trả
        -- ra cổng NCC — lộ là phá tính công bằng đấu thầu (vendor thấy giá đích
        -- qua DevTools). Docstring đã cam kết "never select target_price".
        SELECT id, item_no, specification, bqms_code, quantity, unit,
               required_material, drawing_url, drawing_filename, notes,
               dimension, maker, part_no, moq,
               product_name, model
          FROM procurement_rfq_items
         WHERE batch_id = $1
         ORDER BY item_no
        """,
        batch_id,
    )

    # The vendor's own latest quote for this batch (round-aware).
    q = await conn.fetchrow(
        """
        SELECT id, currency, total_amount, status, round_number, submitted_at,
               lead_time_days, moq_notes, notes, valid_until,
               attachment_path, external_url
          FROM vendor_quotes
         WHERE batch_id = $1 AND vendor_id = $2
         ORDER BY round_number DESC NULLS LAST, submitted_at DESC NULLS LAST
         LIMIT 1
        """,
        batch_id, vendor_id,
    )
    my_quote = None
    if q:
        q_items = await conn.fetch(
            "SELECT item_id, unit_price, quantity, offered_qty, moq, "
            "lead_time_days, notes, can_do, attachment_paths, free_charge, currency "
            "FROM vendor_quote_items WHERE quote_id = $1 ORDER BY item_id",
            q["id"],
        )
        # Read-back của file cấp-phiếu: chỉ trả TÊN file (basename) + cờ has_attachment,
        # KHÔNG lộ đường dẫn server thô (FILES_BASE_PATH/vendor_uploads/...).
        _q = dict(q)
        _att = _q.pop("attachment_path", None)
        my_quote = {
            **_q,
            "has_attachment": bool(_att),
            "attachment_filename": os.path.basename(_att) if _att else None,
            "items": [dict(qi) for qi in q_items],
        }

    # File Song Châu CHIA SẺ cho từng mã (chỉ tên + kind, KHÔNG rfq_number). NCC
    # tải qua /batches/{id}/items/{item_id}/files/download. Mặc định rỗng nếu admin
    # chưa tick chia sẻ gì → cổng NCC không thấy file nào (an toàn).
    shared_rows = await conn.fetch(
        "SELECT item_id, kind, file_name FROM procurement_rfq_shared_files WHERE batch_id = $1",
        batch_id,
    )
    shared_by_item: dict[int, list[dict[str, Any]]] = {}
    for r in shared_rows:
        shared_by_item.setdefault(r["item_id"], []).append(
            {"kind": r["kind"], "file_name": r["file_name"]}
        )

    return {
        "data": {
            **dict(batch),
            "items": [{**dict(i), "shared_files": shared_by_item.get(i["id"], [])} for i in items],
            "my_quote": my_quote,
        }
    }


@router.post("/{batch_id}/decline")
async def decline_invitation(
    batch_id: int,
    body: dict[str, Any] | None = None,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Đợt-1 NEW — NCC từ chối lời mời báo giá (sẽ không báo giá đợt này).

    Sets invitation.status='declined', declined_at, decline_reason. Scoped via
    resolve_vendor. 404 if no invitation; 400 if already submitted or declined
    (cannot decline after submitting; re-decline returns 400).
    """
    reason = (body or {}).get("reason")

    inv = await conn.fetchrow(
        """
        SELECT i.id, i.status, i.round_number, b.batch_code
          FROM procurement_rfq_invitations i
          JOIN procurement_rfq_batches b ON b.id = i.batch_id
         WHERE i.batch_id = $1 AND i.vendor_id = $2
         ORDER BY i.round_number DESC NULLS LAST, i.invited_at DESC NULLS LAST
         LIMIT 1
        """,
        batch_id, vendor_id,
    )
    if not inv:
        raise HTTPException(404, "Không tìm thấy lời mời báo giá")
    if inv["status"] in ("submitted", "declined"):
        raise HTTPException(400, "Không thể từ chối sau khi đã báo giá hoặc đã từ chối")

    # UPDATE + notification dispatch are atomic — wrap in a txn so the in-portal
    # notification (best-effort) and the status write commit together.
    async with conn.transaction():
        await conn.execute(
            """
            UPDATE procurement_rfq_invitations
               SET status = 'declined', declined_at = NOW(), decline_reason = $2
             WHERE id = $1
            """,
            inv["id"], reason,
        )

        # In-portal notification to the internal team (no awarded_vendor_id).
        await dispatch_procurement_event(
            conn, "quote", inv["id"], "decline",
            actor_id=None,
            detail={
                "batch_id": batch_id,
                "batch_code": inv["batch_code"],
                "round": inv["round_number"],
            },
        )

    logger.info("Vendor %d declined invitation for batch %d", vendor_id, batch_id)
    return {"message": "Đã từ chối lời mời báo giá"}


# ---------------------------------------------------------------------------
# Shared files — NCC tải file Song Châu CHIA SẺ cho 1 mã (chỉ đợt được mời).
# Bảo mật: chỉ phục vụ file nằm trong procurement_rfq_shared_files (admin đã tick)
# + (batch, vendor) phải có lời mời. KHÔNG bao giờ lộ rfq_number (resolve nội bộ).
# ---------------------------------------------------------------------------

@router.get("/{batch_id}/items/{item_id}/files")
async def list_shared_files(
    batch_id: int,
    item_id: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách file Song Châu chia sẻ cho 1 mã (đợt được mời). KHÔNG rfq_number."""
    inv = await conn.fetchval(
        "SELECT 1 FROM procurement_rfq_invitations WHERE batch_id = $1 AND vendor_id = $2 LIMIT 1",
        batch_id, vendor_id,
    )
    if not inv:
        raise HTTPException(404, "Không tìm thấy đợt báo giá")
    rows = await conn.fetch(
        "SELECT kind, file_name FROM procurement_rfq_shared_files "
        "WHERE batch_id = $1 AND item_id = $2 ORDER BY kind, file_name",
        batch_id, item_id,
    )
    return {"files": [{"kind": r["kind"], "file_name": r["file_name"]} for r in rows]}


@router.get("/{batch_id}/items/{item_id}/files/download")
async def download_shared_file(
    batch_id: int,
    item_id: int,
    kind: str = Query("raw", regex="^(raw|images)$"),
    name: str = Query(..., min_length=1),
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tải 1 file ĐÃ chia sẻ cho mã (đợt được mời). Chỉ phục vụ file trong tập chia
    sẻ → NCC không tải được file admin chưa tick. rfq_number resolve nội bộ."""
    inv = await conn.fetchval(
        "SELECT 1 FROM procurement_rfq_invitations WHERE batch_id = $1 AND vendor_id = $2 LIMIT 1",
        batch_id, vendor_id,
    )
    if not inv:
        raise HTTPException(404, "Không tìm thấy đợt báo giá")
    row = await conn.fetchrow(
        "SELECT rfq_number FROM procurement_rfq_shared_files "
        "WHERE batch_id = $1 AND item_id = $2 AND kind = $3 AND file_name = $4",
        batch_id, item_id, kind, name,
    )
    if not row:
        raise HTTPException(404, "File không được chia sẻ")
    target = resolve_rfq_file_path(row["rfq_number"], kind, name)
    if target is None:
        raise HTTPException(404, "File không tồn tại")
    return FileResponse(target, filename=name)
