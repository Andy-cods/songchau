"""Vendor Portal — RANK-HINT (band-mờ, login-scoped, SELF-POSITION ONLY).

Đợt 11 #15: endpoint vendor ĐẦU TIÊN cố ý lộ MỘT tín hiệu cạnh tranh. Mức lộ đã
được Thang chốt ở BĂNG MỜ NHẤT — chỉ trả về 1 BAND CHỮ cho NCC ĐANG GỌI:
    {available, band, label}
  band ∈ {'leading','middle','improve'} · label = câu tiếng Việt tương ứng.

NEVER (vi phạm = BLOCKER bảo mật):
  1. NEVER trả ordinal rank ('#2/4'), NEVER trả %, NEVER trả số tuyệt đối.
  2. NEVER trả giá / tên / quote_id / vendor_id của BẤT KỲ NCC nào (kể cả mình).
  3. NEVER iterate cohort ra response — chỉ đọc RANK của DÒNG CHÍNH MÌNH.
  4. NEVER đọc procurement_rfq_items.target_price — rank tính TỪ giá NCC tự nộp.
  5. NEVER trả cohort_size / total_vendors — số NCC chỉ dùng nội bộ để suppress.
  6. NEVER lộ gì khi cờ TẮT — `rank_hint_enabled=FALSE` ⇒ 404 (KHÔNG 403, KHÔNG body).

HARD-SUPPRESS (trả {available:false}, KHÔNG band):
  * cohort < 6 NCC đã nộp cùng tiền tệ — chỉ n≥6 thì ceil-thirds mới cho MỖI band ≥2
    rank (thật sự "mờ"); n=3..5 band thu về ĐÚNG 1 rank = lộ thứ hạng chính xác.
  * vendor CHƯA nộp vòng hiện tại, HOẶC total_amount NULL/0 (chống gaming pre-submit + FOC).

`vendor_id` đến TỪ `resolve_vendor` (JWT chokepoint: role=='vendor', account active,
password_version revoke) — KHÔNG bao giờ đọc từ path/query/body ⇒ không có mặt IDOR.

Endpoint:
  - GET /api/vendor/quotes/batches/{batch_id}/rank-hint
"""
from __future__ import annotations

import logging
from math import ceil
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.api.vendor.deps import resolve_vendor
from app.core.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# Nhãn tiếng Việt cho từng band — band-mờ, KHÔNG số/ordinal/%.
_BAND_LABEL = {
    "leading": "Bạn đang trong nhóm dẫn đầu",
    "middle": "Bạn đang ở nhóm giữa",
    "improve": "Cần cải thiện để cạnh tranh tốt hơn",
}


@router.get("/batches/{batch_id}/rank-hint")
async def my_rank_hint(
    batch_id: int,
    vendor_id: int = Depends(resolve_vendor),  # IDOR-SAFE: id từ JWT, KHÔNG path/query/body
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Gợi ý vị thế cạnh tranh CỦA CHÍNH NCC đang đăng nhập — chỉ BAND CHỮ.

    Cờ TẮT (mặc định) → 404, KHÔNG lộ gì. Cờ BẬT + đã nộp vòng hiện tại + cohort
    cùng tiền tệ ≥ 6 NCC → trả {available:true, band, label}. Các trường hợp khác
    (chưa nộp / total=0 / cohort<6) → {available:false}. KHÔNG bao giờ trả rank,
    cohort_size, %, giá, hay tên/giá đối thủ.
    """
    # (1) Batch tồn tại? — đọc CỜ + vòng hiện tại trong CÙNG 1 query.
    batch = await conn.fetchrow(
        """
        SELECT id, current_round, rank_hint_enabled, rank_hint_round_from
          FROM procurement_rfq_batches
         WHERE id = $1
        """,
        batch_id,
    )
    if not batch:
        raise HTTPException(404, "Đợt báo giá không tồn tại")

    round_number = int(batch["current_round"] or 1)

    # (2) Lời mời cho VÒNG HIỆN TẠI — không mời ⇒ 404 (NCC không liên quan đợt này).
    inv = await conn.fetchrow(
        """
        SELECT 1 FROM procurement_rfq_invitations
         WHERE batch_id = $1 AND vendor_id = $2 AND round_number = $3
         LIMIT 1
        """,
        batch_id, vendor_id, round_number,
    )
    if not inv:
        raise HTTPException(404, "Không tìm thấy lời mời báo giá cho vòng hiện tại")

    # (3) CỜ TẮT (mặc định) → 404, KHÔNG 403, KHÔNG body. OFF = không lộ gì.
    #     Cũng yêu cầu round_from ≤ vòng hiện tại (default 9999 = chưa vòng nào).
    if (not batch["rank_hint_enabled"]) or round_number < int(batch["rank_hint_round_from"]):
        raise HTTPException(404, "Không khả dụng")

    # (4) Báo giá CỦA MÌNH ở vòng hiện tại — phải ĐÃ NỘP + total_amount>0.
    #     Chưa nộp / total NULL hoặc 0 (FOC toàn bộ) → available:false (chống gaming).
    my = await conn.fetchrow(
        """
        SELECT currency, total_amount
          FROM vendor_quotes
         WHERE batch_id = $1 AND vendor_id = $2
           AND COALESCE(round_number, 1) = $3
           AND status = 'submitted'
         LIMIT 1
        """,
        batch_id, vendor_id, round_number,
    )
    if (my is None) or (my["total_amount"] in (None, 0)):
        return {"data": {"available": False}}

    my_currency = my["currency"]

    # (5) Rank CHỈ trong cohort CÙNG tiền tệ + cùng vòng + đã nộp + total>0.
    #     Đọc DUY NHẤT dòng của CHÍNH MÌNH (vendor_id=$2 trong sub-select) cùng tổng
    #     số NCC (n) qua COUNT(*) OVER (). KHÔNG SELECT vendor khác, KHÔNG iterate
    #     mảng ra response — me.r/me.n là 2 con số nội bộ, không bao giờ trả ra ngoài.
    me = await conn.fetchrow(
        """
        SELECT r, n FROM (
            SELECT vendor_id,
                   RANK()  OVER (ORDER BY total_amount ASC) AS r,
                   COUNT(*) OVER ()                         AS n
              FROM vendor_quotes
             WHERE batch_id = $1
               AND COALESCE(round_number, 1) = $3
               AND status = 'submitted'
               AND total_amount > 0
               AND currency = $4
        ) ranked
        WHERE vendor_id = $2
        LIMIT 1
        """,
        batch_id, vendor_id, round_number, my_currency,
    )

    # An toàn: nếu vì lý do nào đó không tìm thấy dòng của mình trong cohort → suppress.
    if me is None:
        return {"data": {"available": False}}

    n = int(me["n"])
    rank = int(me["r"])

    # (6) HARD-SUPPRESS cohort < 6 — với ceil-thirds, CHỈ n≥6 mỗi band mới gộp ≥2 rank
    #     (thật sự "mờ"). n=3..5: band thu về ĐÚNG 1 rank (vd n=3 → leading=#1/middle=#2/
    #     improve=#3) = lộ thứ hạng chính xác → vi phạm băng-mờ → ẩn cứng (extraction review).
    if n < 6:
        return {"data": {"available": False}}

    # (7) Map rank → band-mờ (chia 3 nhóm đều theo ngưỡng ceil).
    #     leading: top 1/3 · middle: giữa · improve: nhóm cuối.
    if rank <= ceil(n / 3):
        band = "leading"
    elif rank <= ceil(n * 2 / 3):
        band = "middle"
    else:
        band = "improve"

    # CHỈ trả band + label. TUYỆT ĐỐI KHÔNG rank / n / % / giá / tên đối thủ.
    return {"data": {"available": True, "band": band, "label": _BAND_LABEL[band]}}
