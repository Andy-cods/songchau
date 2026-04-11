"""M05 — Tra cứu giá thị trường (TT XNK lookup)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()

EXCEL_ROW_ORDER_SQL = """
CASE
    WHEN COALESCE(raw_data->>'_excel_row_number', '') ~ '^[0-9]+$'
        THEN (raw_data->>'_excel_row_number')::int
    ELSE id
END
""".strip()

SEARCH_SORT_SQL: dict[str, str] = {
    "rfq_desc": f"rfq_date DESC NULLS LAST, {EXCEL_ROW_ORDER_SQL} DESC, id DESC",
    "rfq_asc": f"rfq_date ASC NULLS FIRST, {EXCEL_ROW_ORDER_SQL} ASC, id ASC",
    "excel_desc": f"{EXCEL_ROW_ORDER_SQL} DESC, rfq_date DESC NULLS LAST, id DESC",
    "excel_asc": f"{EXCEL_ROW_ORDER_SQL} ASC, rfq_date ASC NULLS FIRST, id ASC",
    "price_desc": f"price_usd DESC NULLS LAST, rfq_date DESC NULLS LAST, {EXCEL_ROW_ORDER_SQL} DESC",
    "seller": f"seller_name ASC NULLS LAST, rfq_date DESC NULLS LAST, {EXCEL_ROW_ORDER_SQL} DESC",
}

NORMALIZED_SELLER_SQL = "NULLIF(REGEXP_REPLACE(BTRIM(seller_name), '\\s+', ' ', 'g'), '')"
NON_EMPTY_HS_SQL = "NULLIF(BTRIM(hs_code), '')"
NON_EMPTY_BQMS_SQL = "NULLIF(BTRIM(bqms_code), '')"
DASHBOARD_PRICE_MIN_SAMPLE = 12
DASHBOARD_SELLER_MIN_SAMPLE = 12
DASHBOARD_TREND_MIN_POINTS = 2


def build_lookup_filters(
    *,
    q: str = "",
    bqms: str = "",
    hs: str = "",
    seller: str = "",
    year: int | None = None,
) -> tuple[str, list[Any]]:
    conditions = ["1=1"]
    params: list[Any] = []
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

    return " AND ".join(conditions), params


def widget_state(sample_size: int, minimum: int, *, empty_reason: str, limited_reason: str) -> dict[str, Any]:
    if sample_size <= 0:
        return {"status": "empty", "reason": empty_reason}
    if sample_size < minimum:
        return {"status": "limited", "reason": limited_reason}
    return {"status": "ready", "reason": None}


@router.get("/search")
async def search_xnk(
    q: str = Query("", description="Tìm theo BQMS code, tên hàng, mã HS, bên bán"),
    bqms: str = Query("", description="Filter theo BQMS code chính xác"),
    hs: str = Query("", description="Filter theo mã HS"),
    seller: str = Query("", description="Filter theo bên bán"),
    year: int | None = Query(None, ge=2020, le=2030),
    sort: Literal["rfq_desc", "rfq_asc", "excel_desc", "excel_asc", "price_desc", "seller"] = Query(
        "rfq_desc",
        description="Server-side sort before pagination",
    ),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tìm kiếm dữ liệu giá XNK."""
    where, params = build_lookup_filters(q=q, bqms=bqms, hs=hs, seller=seller, year=year)
    idx = len(params) + 1

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM xnk_price_lookup WHERE {where}", *params
    )

    order_by = SEARCH_SORT_SQL[sort]
    params.extend([limit, (page - 1) * limit])
    rows = await conn.fetch(f"""
        SELECT id, rfq_date, quotation_no, bqms_code, item_name, item_explain,
               item_type, maker, notes, notes2, unit, quantity, quote_deadline,
               quoted_date, bqms_code3, hs_code, price_usd, price_vnd, total_usd,
               buyer_name, seller_name, source, raw_data
        FROM xnk_price_lookup
        WHERE {where}
        ORDER BY {order_by}
        LIMIT ${idx} OFFSET ${idx + 1}
    """, *params)

    return {
        "data": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "limit": limit,
        "sort": sort,
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
        ORDER BY rfq_date DESC NULLS LAST,
                 CASE
                     WHEN COALESCE(raw_data->>'_excel_row_number', '') ~ '^[0-9]+$'
                         THEN (raw_data->>'_excel_row_number')::int
                     ELSE id
                 END DESC,
                 id DESC
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


@router.get("/dashboard")
async def xnk_dashboard(
    q: str = Query("", description="Tìm theo BQMS code, tên hàng, mã HS, bên bán"),
    bqms: str = Query("", description="Filter theo BQMS code chính xác"),
    hs: str = Query("", description="Filter theo mã HS"),
    seller: str = Query("", description="Filter theo bên bán"),
    year: int | None = Query(None, ge=2020, le=2030),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Dữ liệu dashboard cho 6 widget phân tích XNK, dùng dữ liệu thật từ bảng lookup."""
    where, params = build_lookup_filters(q=q, bqms=bqms, hs=hs, seller=seller, year=year)

    overview = await conn.fetchrow(
        f"""
        SELECT
            COUNT(*)::int AS total_records,
            COUNT(*) FILTER (WHERE price_usd > 0)::int AS priced_records,
            COUNT(*) FILTER (WHERE {NORMALIZED_SELLER_SQL} IS NOT NULL)::int AS seller_records,
            COUNT(*) FILTER (WHERE {NON_EMPTY_HS_SQL} IS NOT NULL)::int AS hs_records,
            COUNT(DISTINCT {NON_EMPTY_BQMS_SQL})::int AS unique_products,
            MAX(rfq_date) AS latest_rfq_date
        FROM xnk_price_lookup
        WHERE {where}
        """,
        *params,
    )

    year_rows = await conn.fetch(
        f"""
        SELECT
            EXTRACT(YEAR FROM rfq_date)::int AS year,
            COUNT(*)::int AS count,
            COUNT(*) FILTER (WHERE price_usd > 0)::int AS price_rows,
            COUNT(*) FILTER (WHERE {NORMALIZED_SELLER_SQL} IS NOT NULL)::int AS seller_rows,
            COUNT(*) FILTER (WHERE {NON_EMPTY_HS_SQL} IS NOT NULL)::int AS hs_rows
        FROM xnk_price_lookup
        WHERE {where} AND rfq_date IS NOT NULL
        GROUP BY 1
        ORDER BY 1 DESC
        """,
        *params,
    )

    price_snapshot = await conn.fetchrow(
        f"""
        SELECT
            COUNT(*)::int AS sample_size,
            AVG(price_usd) AS avg_usd,
            MIN(price_usd) AS min_usd,
            MAX(price_usd) AS max_usd,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY price_usd) AS median_usd,
            percentile_cont(0.1) WITHIN GROUP (ORDER BY price_usd) AS p10_usd,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY price_usd) AS p90_usd
        FROM xnk_price_lookup
        WHERE {where} AND price_usd > 0
        """,
        *params,
    )

    trend_rows = await conn.fetch(
        f"""
        SELECT
            date_trunc('month', rfq_date)::date AS period_date,
            TO_CHAR(date_trunc('month', rfq_date), 'MM/YYYY') AS period_label,
            COUNT(*)::int AS count,
            COUNT(*) FILTER (WHERE price_usd > 0)::int AS price_rows,
            AVG(price_usd) FILTER (WHERE price_usd > 0) AS avg_usd,
            COALESCE(SUM(total_usd) FILTER (WHERE total_usd > 0), 0) AS total_usd
        FROM xnk_price_lookup
        WHERE {where} AND rfq_date IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1 DESC
        LIMIT 12
        """,
        *params,
    )

    top_sellers = await conn.fetch(
        f"""
        SELECT
            {NORMALIZED_SELLER_SQL} AS seller_name,
            COUNT(*)::int AS deal_count,
            COUNT(DISTINCT {NON_EMPTY_BQMS_SQL})::int AS product_count,
            COALESCE(SUM(total_usd) FILTER (WHERE total_usd > 0), 0) AS total_usd,
            MAX(rfq_date) AS latest_deal
        FROM xnk_price_lookup
        WHERE {where} AND {NORMALIZED_SELLER_SQL} IS NOT NULL
        GROUP BY 1
        ORDER BY deal_count DESC, total_usd DESC, seller_name ASC
        LIMIT 6
        """,
        *params,
    )

    recent_rows = await conn.fetch(
        f"""
        SELECT
            id, rfq_date, quotation_no, bqms_code, item_name, hs_code,
            seller_name, price_usd, total_usd, raw_data
        FROM xnk_price_lookup
        WHERE {where}
        ORDER BY rfq_date DESC NULLS LAST, {EXCEL_ROW_ORDER_SQL} DESC, id DESC
        LIMIT 8
        """,
        *params,
    )

    overview_data = dict(overview) if overview else {}
    total_records = overview_data.get("total_records", 0) or 0
    priced_records = overview_data.get("priced_records", 0) or 0
    seller_records = overview_data.get("seller_records", 0) or 0
    hs_records = overview_data.get("hs_records", 0) or 0

    fill_rates = {
        "gia_usd": round((priced_records / total_records) * 100, 1) if total_records else 0,
        "doi_thu": round((seller_records / total_records) * 100, 1) if total_records else 0,
        "ma_hs": round((hs_records / total_records) * 100, 1) if total_records else 0,
    }

    price_data = dict(price_snapshot) if price_snapshot else {}
    price_state = widget_state(
        int(price_data.get("sample_size") or 0),
        DASHBOARD_PRICE_MIN_SAMPLE,
        empty_reason="Không có dòng nào có giá USD hợp lệ theo bộ lọc hiện tại.",
        limited_reason="Số dòng có giá USD còn ít, nên xem như tín hiệu tham khảo chứ chưa đủ mạnh.",
    )
    seller_state = widget_state(
        seller_records,
        DASHBOARD_SELLER_MIN_SAMPLE,
        empty_reason="Không có bên bán hợp lệ theo bộ lọc hiện tại.",
        limited_reason="Dữ liệu bên bán còn mỏng, bảng xếp hạng đối thủ chỉ mang tính định hướng.",
    )
    trend_state = widget_state(
        len(trend_rows),
        DASHBOARD_TREND_MIN_POINTS,
        empty_reason="Không có đủ ngày RFQ để dựng xu hướng.",
        limited_reason="Xu hướng hiện chỉ có rất ít mốc thời gian, nên cần đọc thận trọng.",
    )
    recent_state = widget_state(
        len(recent_rows),
        1,
        empty_reason="Không có bản ghi nào khớp bộ lọc hiện tại.",
        limited_reason="",
    )

    return {
        "data": {
            "filters": {
                "q": q,
                "bqms": bqms,
                "hs": hs,
                "seller": seller,
                "year": year,
            },
            "overview": {
                **overview_data,
                "fill_rates": fill_rates,
            },
            "coverage": {
                "years": [dict(row) for row in year_rows],
                "fill_rates": fill_rates,
                "status": "ready" if total_records else "empty",
                "reason": None if total_records else "Không có dữ liệu để tính độ phủ.",
            },
            "price_snapshot": {
                **price_data,
                **price_state,
            },
            "trend": {
                "points": [dict(row) for row in reversed(trend_rows)],
                **trend_state,
            },
            "top_sellers": {
                "rows": [dict(row) for row in top_sellers],
                **seller_state,
            },
            "recent_records": {
                "rows": [dict(row) for row in recent_rows],
                **recent_state,
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
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
