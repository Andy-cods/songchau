"""M05 — Tra cứu giá thị trường (TT XNK lookup)."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/search")
async def search_xnk(
    q: str = Query("", description="Tìm theo BQMS code, tên hàng, mã HS, bên bán"),
    bqms: str = Query("", description="Filter theo BQMS code chính xác"),
    hs: str = Query("", description="Filter theo mã HS"),
    seller: str = Query("", description="Filter theo bên bán"),
    year: int | None = Query(None, ge=2020, le=2030),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tìm kiếm dữ liệu giá XNK."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if q:
        conditions.append(
            f"(bqms_code ILIKE ${idx} OR item_name ILIKE ${idx} OR hs_code ILIKE ${idx} "
            f"OR seller_name ILIKE ${idx} OR item_explain ILIKE ${idx})"
        )
        params.append(f"%{q}%")
        idx += 1

    if bqms:
        conditions.append(f"bqms_code = ${idx}")
        params.append(bqms)
        idx += 1

    if hs:
        conditions.append(f"hs_code = ${idx}")
        params.append(hs)
        idx += 1

    if seller:
        conditions.append(f"seller_name ILIKE ${idx}")
        params.append(f"%{seller}%")
        idx += 1

    if year:
        conditions.append(f"EXTRACT(YEAR FROM rfq_date) = ${idx}")
        params.append(year)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM xnk_price_lookup WHERE {where}", *params
    )

    params.extend([limit, (page - 1) * limit])
    rows = await conn.fetch(f"""
        SELECT id, rfq_date, quotation_no, bqms_code, item_name, item_explain,
               item_type, maker, notes, notes2, unit, quantity, quote_deadline,
               quoted_date, bqms_code3, hs_code, price_usd, price_vnd, total_usd,
               buyer_name, seller_name, source, raw_data
        FROM xnk_price_lookup
        WHERE {where}
        ORDER BY id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
    """, *params)

    return {
        "data": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.get("/by-bqms/{bqms_code}")
async def get_by_bqms(
    bqms_code: str,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Lấy lịch sử giá theo mã BQMS — dùng khi báo giá để tham khảo."""
    rows = await conn.fetch("""
        SELECT id, rfq_date, quotation_no, bqms_code, item_name, item_explain,
               item_type, maker, notes, notes2, unit, quantity, quote_deadline,
               quoted_date, bqms_code3, hs_code, price_usd, price_vnd, total_usd,
               buyer_name, seller_name, source, raw_data
        FROM xnk_price_lookup
        WHERE bqms_code = $1
        ORDER BY id DESC
        LIMIT 50
    """, bqms_code)

    # Stats
    stats = await conn.fetchrow("""
        SELECT COUNT(*)::int AS count,
               COUNT(DISTINCT seller_name) FILTER (WHERE seller_name IS NOT NULL)::int AS sellers,
               AVG(price_usd) FILTER (WHERE price_usd > 0) AS avg_usd,
               MIN(price_usd) FILTER (WHERE price_usd > 0) AS min_usd,
               MAX(price_usd) FILTER (WHERE price_usd > 0) AS max_usd,
               MAX(rfq_date) AS latest_rfq
        FROM xnk_price_lookup
        WHERE bqms_code = $1
    """, bqms_code)

    return {
        "data": [dict(r) for r in rows],
        "stats": dict(stats) if stats else {},
    }


@router.get("/sellers")
async def list_sellers(
    q: str = Query("", description="Search bên bán"),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách bên bán (đối thủ) + số lần giao dịch."""
    where = "seller_name IS NOT NULL AND seller_name != ''"
    params: list = []
    if q:
        where += " AND seller_name ILIKE $1"
        params.append(f"%{q}%")

    rows = await conn.fetch(f"""
        SELECT seller_name,
               COUNT(*)::int AS deal_count,
               COUNT(DISTINCT bqms_code)::int AS product_count,
               COALESCE(SUM(total_usd), 0) AS total_usd,
               MAX(rfq_date) AS latest_deal
        FROM xnk_price_lookup
        WHERE {where}
        GROUP BY seller_name
        ORDER BY deal_count DESC
        LIMIT {limit}
    """, *params)

    return {"data": [dict(r) for r in rows]}


@router.get("/stats")
async def xnk_stats(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Thống kê tổng quan."""
    stats = await conn.fetchrow("""
        SELECT
            COUNT(*)::int AS total_records,
            COUNT(DISTINCT bqms_code)::int AS unique_products,
            COUNT(DISTINCT seller_name) FILTER (WHERE seller_name IS NOT NULL)::int AS unique_sellers,
            COUNT(DISTINCT EXTRACT(YEAR FROM rfq_date))::int AS years_covered,
            MAX(rfq_date) AS latest_record
        FROM xnk_price_lookup
    """)
    return {"data": dict(stats) if stats else {}}
