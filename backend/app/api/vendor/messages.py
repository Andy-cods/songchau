"""Vendor Portal — Q&A (HỎI ĐÁP / LÀM RÕ RFQ) — login-scoped, per-thread.

Đợt 2a #12. NCC đặt câu hỏi làm rõ cho 1 đợt báo giá ĐÃ ĐƯỢC MỜI; admin trả
lời RIÊNG. Mỗi NCC chỉ thấy thread của CHÍNH MÌNH + các phụ lục (addendum) công
khai của batch. KHÔNG bao giờ thấy câu hỏi / giá / tên của NCC khác.

CÔ LẬP NCC (3 tầng phòng thủ):
  1. `resolve_vendor` (JWT chokepoint) → vendor_id; KHÔNG đọc vendor_id từ
     path/query/body ⇒ không có mặt IDOR.
  2. `_require_invitation` → 404 (KHÔNG 403) nếu (batch, vendor) không có lời
     mời ⇒ NCC đổi batch_id thủ công cũng chỉ thấy 404, không lộ tồn tại batch.
  3. CHECK constraint DB (`chk_rfq_msg_vendor_self`, `chk_rfq_msg_scope`): NCC
     không thể tạo addendum, không thể ghi vào thread NCC khác — kể cả nếu tầng
     app sai. GET thread luôn `WHERE vendor_id = $me`.

Response KHÔNG bao giờ trả `author_admin_id` (UUID), không cột giá/tên đối thủ.

Endpoints:
  - GET  /api/vendor/rfq/{batch_id}/messages   (thread của mình + addendum batch)
  - POST /api/vendor/rfq/{batch_id}/messages   (kind='question', scope vendor_id)
"""
from __future__ import annotations

import json as _json
import logging
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.api.vendor.deps import resolve_vendor
from app.api.vendor.quotes import _sanitize_attachment_paths
from app.core.database import get_db
from app.services.procurement_notifications import dispatch_procurement_event

# DRY: dùng CHUNG _audit canonical (single source ở procurement.py).
from app.api.v1.procurement import _audit

logger = logging.getLogger(__name__)
router = APIRouter()

_MAX_BODY = 4000


async def _require_invitation(
    conn: asyncpg.Connection, batch_id: int, vendor_id: int
) -> asyncpg.Record:
    """Gate: (batch, vendor) phải có lời mời. 404 (KHÔNG 403) nếu không → không
    lộ sự tồn tại của đợt NCC chưa được mời. Trả batch row (có batch_code cho notif).
    """
    inv = await conn.fetchrow(
        "SELECT 1 FROM procurement_rfq_invitations "
        "WHERE batch_id = $1 AND vendor_id = $2 LIMIT 1",
        batch_id, vendor_id,
    )
    if inv is None:
        raise HTTPException(404, "Không tìm thấy đợt báo giá")
    batch = await conn.fetchrow(
        "SELECT batch_code FROM procurement_rfq_batches WHERE id = $1", batch_id
    )
    if batch is None:
        raise HTTPException(404, "Không tìm thấy đợt báo giá")
    return batch


def _serialize(row: asyncpg.Record) -> dict[str, Any]:
    """Row → dict an toàn cho NCC. KHÔNG trả author_admin_id (UUID), không giá/tên.

    `author` = 'vendor' nếu NCC viết (question), ngược lại 'admin' (answer/addendum).
    """
    atts = row["attachments"]
    if isinstance(atts, str):
        try:
            atts = _json.loads(atts)
        except (TypeError, ValueError):
            atts = []
    return {
        "id": row["id"],
        "kind": row["kind"],
        "author": "vendor" if row["is_vendor_author"] else "admin",
        "body": row["body"],
        "attachments": atts or [],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


@router.get("/{batch_id}/messages")
async def list_messages(
    batch_id: int,
    vendor_id: int = Depends(resolve_vendor),  # IDOR-SAFE: id từ JWT, KHÔNG path/query/body
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Thread Q&A của CHÍNH NCC (question + answer) + phụ lục (addendum) của batch.

    Cô lập: chỉ row `vendor_id = $me` (thread) HOẶC kind='addendum' (broadcast).
    Tuyệt đối KHÔNG thấy thread / câu hỏi của NCC khác.
    """
    await _require_invitation(conn, batch_id, vendor_id)

    rows = await conn.fetch(
        """
        SELECT id, kind, body, attachments, created_at,
               (author_vendor_id IS NOT NULL) AS is_vendor_author
          FROM procurement_rfq_messages
         WHERE batch_id = $1
           AND ( (vendor_id = $2 AND kind IN ('question','answer'))
                 OR kind = 'addendum' )
         ORDER BY created_at ASC
        """,
        batch_id, vendor_id,
    )

    # Side-effect: đánh dấu các câu trả lời (answer) trong thread của mình là đã đọc.
    # (Addendum KHÔNG track read ở DB — badge tính ở FE qua localStorage last_seen.)
    await conn.execute(
        """
        UPDATE procurement_rfq_messages SET read_by_vendor_at = NOW()
         WHERE batch_id = $1 AND vendor_id = $2
           AND kind = 'answer' AND read_by_vendor_at IS NULL
        """,
        batch_id, vendor_id,
    )

    return {"messages": [_serialize(r) for r in rows]}


@router.post("/{batch_id}/messages")
async def create_message(
    batch_id: int,
    body: dict[str, Any],
    vendor_id: int = Depends(resolve_vendor),  # IDOR-SAFE: id từ JWT
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """NCC đặt câu hỏi làm rõ (kind='question') vào thread của CHÍNH MÌNH.

    `kind` ép cứng 'question', `author_vendor_id = vendor_id` (KHÔNG nhận từ
    client). Attachment qua `_sanitize_attachment_paths` (chỉ giữ path trong
    sandbox NCC). Notif fan-out INTERNAL team (KHÔNG kèm body/tên NCC).
    """
    batch = await _require_invitation(conn, batch_id, vendor_id)

    text = str(body.get("body") or "").strip()
    if not text:
        raise HTTPException(400, "Nội dung câu hỏi không được để trống")
    if len(text) > _MAX_BODY:
        raise HTTPException(400, f"Nội dung quá dài (tối đa {_MAX_BODY} ký tự)")

    clean_atts = _sanitize_attachment_paths(body.get("attachments"), vendor_id)

    async with conn.transaction():
        msg_id = await conn.fetchval(
            """
            INSERT INTO procurement_rfq_messages
                (batch_id, vendor_id, kind, author_vendor_id, body, attachments)
            VALUES ($1, $2, 'question', $2, $3, $4::jsonb)
            RETURNING id
            """,
            batch_id, vendor_id, text, _json.dumps(clean_atts),
        )
        await _audit(
            conn, "rfq_message", msg_id, "question",
            actor_vendor_id=vendor_id,
            detail={"batch_id": batch_id},
        )
        # CHỈ fan-out internal team (KHÔNG awarded_vendor_id). NCC không phải user
        # nội bộ → actor_id=None (không loại trừ ai khỏi danh sách nhận).
        await dispatch_procurement_event(
            conn, "rfq_message", msg_id, "question",
            actor_id=None,
            detail={"batch_id": batch_id, "batch_code": batch["batch_code"]},
        )

    logger.info("[RFQ_QA] dispatched question batch=%s vendor=%s msg=%s",
                batch_id, vendor_id, msg_id)
    return {"id": msg_id, "ok": True}
