"""Vendor Portal — MY scorecard (login-scoped, SELF-METRICS ONLY).

Đợt 7 (Wave D): the supplier-facing "Năng lực" page. It surfaces a NCC's own
ABSOLUTE performance — grade (A/B/C), on-time %, quality %, response %, and the
NCC's own recently-approved awards. Scoped EXCLUSIVELY to
`resolve_vendor()` (the active vendor_accounts.id derived from the JWT), so a
supplier can NEVER see another vendor's data.

SECURITY (BLOCKER if violated): this endpoint exposes ONLY the caller's OWN
absolute indicators. It NEVER returns any competitive / cohort-relative signal:
  - NO price_score / factors['price'] / avg_price_ratio (price position vs cohort)
  - NO lead_score / avg_lead_days (lead position vs cohort)
  - NO win_score / win_rate / won_batches (win ratio)
  - NO numeric `score` (0..100) — only the LETTER grade (the number folds in
    price/lead/win so it would leak indirectly)
  - NO rank / prev_rank / scored_count / total_count (cohort position)
  - NO ranked-list / multi-vendor array — we only ever read `.get(vendor_id)`,
    the caller's OWN row, NEVER iterate factors_by_vendor
  - NO target_price, NO competitor name/price/spec

`vendor_id` comes from `resolve_vendor` (JWT) — it is NEVER read from a path /
query / body param, so there is no IDOR surface. resolve_vendor already enforces
role == 'vendor', an active account, and password_version revocation, so this
endpoint inherits those guards for free.

Endpoint:
  - GET /api/vendor/scorecard?months=12 → {data: {grade, insufficient, *_rate,
    *_ok, *_n, months, recent_awards[]}}  (200 even when insufficient — never 404)
"""
from __future__ import annotations

import logging
import time as _time
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.v1.procurement_analytics import (
    _f,
    _grade,
    _score_from_factors,
    _scorecard_factors,
)
from app.api.vendor.deps import resolve_vendor
from app.core.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# Module-level cache keyed BY months. `_scorecard_factors` scans the WHOLE cohort
# (6 CTEs) for EVERY vendor on each call; without a shared TTL cache every NCC
# request would trigger a full-cohort scan. Mirrors procurement._GRADE_CACHE.
# Per-process (one copy per uvicorn worker) — accepted, like _GRADE_CACHE. Grades
# are global (not per-tenant) so there is no cross-tenant leak: the route filters
# `.get(vendor_id)` to the caller's OWN row only.
_MY_SC_CACHE: dict[int, dict[str, Any]] = {}  # months -> {'at': float, 'data': {vid: {...}}}
_MY_SC_TTL = 600.0  # 10 phút, khớp _GRADE_CACHE_TTL
_MY_SC_MIN_INVITES = 3  # cố định (giống _get_vendor_grades + smart-award)


async def _factors_cached(conn: asyncpg.Connection, months: int) -> dict[int, dict[str, Any]]:
    """Return per-vendor factors for `months`, computing at most once / TTL.

    DEGRADE-SAFE: if the engine raises, return the stale cache if present, else {}
    → the route sees v=None → insufficient=True (200, never 500). offset_months=0
    fixed (NO prev-window — that is the competitive prev_rank mechanism, unused).
    """
    now = _time.monotonic()
    ent = _MY_SC_CACHE.get(months)
    # Cache on FRESHNESS alone — store {} too so a genuinely-empty/degraded cohort is
    # debounced for the TTL instead of re-running the full-cohort 6-CTE scan per request.
    if ent and (now - ent["at"] < _MY_SC_TTL):
        return ent["data"]
    try:
        data = await _scorecard_factors(conn, months, _MY_SC_MIN_INVITES)
        _MY_SC_CACHE[months] = {"at": now, "data": data}
        return data
    except Exception:
        logger.warning("my_scorecard factors cache compute failed; degrading", exc_info=True)
        return ent["data"] if ent else {}


@router.get("")
async def my_scorecard(
    months: int = Query(12, ge=1, le=36),
    vendor_id: int = Depends(resolve_vendor),  # IDOR-SAFE: id từ JWT, KHÔNG path/query/body
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Bảng năng lực CỦA TÔI — chỉ số TUYỆT ĐỐI của chính NCC đang đăng nhập.

    Trả về hạng (A/B/C/null), tỉ lệ giao đúng hạn / đạt chất lượng / phản hồi mời
    thầu (kèm số thô n=), và các đơn được duyệt gần đây CỦA CHÍNH NCC. KHÔNG bao
    giờ trả ra điểm số, thứ hạng, hay bất kỳ chỉ số cạnh tranh nào so với NCC khác.

    Tài khoản hợp lệ nhưng thiếu dữ liệu → 200 với insufficient=True (KHÔNG 404),
    tránh FE hiểu nhầm là lỗi xác thực.
    """
    factors = await _factors_cached(conn, months)
    v = factors.get(vendor_id)

    if v and v["sufficient"]:
        score, _applied = _score_from_factors(v["factors"])
        g = _grade(score)
    else:
        g = "–"
    grade = g if g in ("A", "B", "C") else None  # loại '–' → null

    f = v["factors"] if v else {}
    raw = v["raw"] if v else {}

    def _rate(key: str) -> float | None:
        val = f.get(key)
        return (val * 100.0) if val is not None else None

    # Recent ACTIVE awards của CHÍNH NCC (scope CỨNG WHERE vendor_id=$1). KHÔNG
    # SELECT target_price, KHÔNG JOIN/lộ vendor khác. LEFT JOIN items: per_batch
    # award có item_id NULL.
    award_rows = await conn.fetch(
        """
        SELECT a.id            AS award_id,
               b.batch_code,
               b.title         AS batch_title,
               i.bqms_code,
               a.awarded_price,
               a.currency,
               a.quantity,
               a.awarded_at
          FROM procurement_awards a
          JOIN procurement_rfq_batches b ON b.id = a.batch_id
          LEFT JOIN procurement_rfq_items i ON i.id = a.item_id
         WHERE a.vendor_id = $1
           AND a.superseded_by IS NULL
         ORDER BY a.awarded_at DESC
         LIMIT 10
        """,
        vendor_id,
    )
    recent_awards = [
        {
            "award_id": r["award_id"],
            "batch_code": r["batch_code"],
            "batch_title": r["batch_title"],
            "bqms_code": r["bqms_code"],
            "awarded_price": _f(r["awarded_price"]),
            "currency": r["currency"],
            "quantity": _f(r["quantity"]),
            "awarded_at": r["awarded_at"],  # timestamptz → FastAPI ISO
        }
        for r in award_rows
    ]

    return {
        "data": {
            "grade": grade,
            "insufficient": (v is None) or (not v["sufficient"]),
            "on_time_rate": _rate("on_time"),
            "on_time_ok": raw.get("on_time_pos", 0),
            "on_time_n": raw.get("rated_pos", 0),
            "quality_rate": _rate("quality"),
            "quality_ok": raw.get("ok_quality_items", 0),
            "quality_n": raw.get("rated_quality_items", 0),
            "response_rate": _rate("response"),
            "response_submitted": raw.get("submitted_batches", 0),
            "response_n": raw.get("invited_batches", 0),
            "months": months,
            "recent_awards": recent_awards,
        }
    }
