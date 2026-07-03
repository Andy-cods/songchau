"""
XNK Analytics API — phân tích dữ liệu hải quan / tra cứu giá XNK.

Endpoints (mount under /api/v1/xnk):
  GET /analytics/kpi                              — KPI tổng quan
  GET /analytics/hs-distribution                  — Phân phối giá theo HS code (histogram)
  GET /analytics/monthly-trend                    — Xu hướng theo tháng (count, median, p10/p90)
  GET /analytics/top-sellers                      — Top NCC theo HS code / năm
  GET /analytics/seller/{seller_name}             — Drill-down chi tiết 1 NCC (aggregate)
  GET /analytics/seller/{seller_name}/declarations — Raw declarations của 1 NCC (paginated)

Data source: `xnk_price_lookup` (35K+ rows, columns: rfq_date, bqms_code, hs_code,
price_usd, price_vnd, total_usd, buyer_name, seller_name, ...).

TODO (Thang 2026-06-04):
  - Khi có bảng `customs_import_records` chính thức (từ hải quan), thay
    `xnk_price_lookup` ở các CTE bên dưới — schema tương thích.
  - Outlier detection hiện dùng IQR; có thể thay bằng MAD nếu cần robust hơn.
"""

from __future__ import annotations

from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _f(value: Any) -> float | None:
    """Cast Decimal/None to JSON-serializable float."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _build_where(
    *,
    year: int | None,
    hs_code: str | None,
    seller: str | None,
    exclude_outliers: bool,
) -> tuple[str, list[Any]]:
    """Build WHERE clause + params. Outlier exclusion uses IQR on price_usd."""
    conditions = ["price_usd IS NOT NULL", "price_usd > 0"]
    params: list[Any] = []

    if year:
        params.append(year)
        conditions.append(f"EXTRACT(YEAR FROM rfq_date) = ${len(params)}")
    if hs_code:
        params.append(hs_code)
        conditions.append(f"hs_code = ${len(params)}")
    if seller:
        params.append(f"%{seller}%")
        conditions.append(f"seller_name ILIKE ${len(params)}")

    where = " AND ".join(conditions)

    if exclude_outliers:
        # Wrap with IQR outlier filter (within current filter scope)
        where = f"""{where} AND price_usd BETWEEN (
            SELECT PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY price_usd) - 1.5 *
                   (PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY price_usd) -
                    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY price_usd))
            FROM xnk_price_lookup WHERE {' AND '.join(conditions)}
        ) AND (
            SELECT PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY price_usd) + 1.5 *
                   (PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY price_usd) -
                    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY price_usd))
            FROM xnk_price_lookup WHERE {' AND '.join(conditions)}
        )"""

    return where, params


# ---------------------------------------------------------------------------
# GET /analytics/kpi
# ---------------------------------------------------------------------------

@router.get("/analytics/kpi")
async def xnk_analytics_kpi(
    year: int | None = Query(None),
    hs_code: str | None = Query(None),
    seller: str | None = Query(None),
    exclude_outliers: bool = Query(False),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tổng quan KPI XNK: số records, tổng USD, số HS, số NCC, outliers, so với năm trước."""
    where, params = _build_where(
        year=year, hs_code=hs_code, seller=seller, exclude_outliers=exclude_outliers
    )

    try:
        row = await conn.fetchrow(
            f"""
            SELECT
                COUNT(*)::bigint AS total_records,
                COALESCE(SUM(total_usd), 0) AS total_usd,
                COUNT(DISTINCT hs_code) FILTER (WHERE hs_code IS NOT NULL) AS hs_codes_count,
                COUNT(DISTINCT seller_name) FILTER (WHERE seller_name IS NOT NULL) AS unique_sellers
            FROM xnk_price_lookup
            WHERE {where}
            """,
            *params,
        )
    except asyncpg.UndefinedTableError:
        return {"data": {
            "total_records": 0, "total_usd": 0.0, "hs_codes_count": 0,
            "unique_sellers": 0, "outlier_count": 0, "vs_prev_year_pct": None,
        }}

    # Outlier count (always computed against unfiltered-outlier set)
    where_no_outlier, params_no = _build_where(
        year=year, hs_code=hs_code, seller=seller, exclude_outliers=False
    )
    outlier_row = await conn.fetchrow(
        f"""
        WITH q AS (
            SELECT
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY price_usd) AS q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY price_usd) AS q3
            FROM xnk_price_lookup WHERE {where_no_outlier}
        )
        SELECT COUNT(*)::bigint AS outlier_count
        FROM xnk_price_lookup, q
        WHERE {where_no_outlier}
          AND (price_usd < q.q1 - 1.5*(q.q3-q.q1) OR price_usd > q.q3 + 1.5*(q.q3-q.q1))
        """,
        *params_no,
    )

    # YoY comparison
    vs_prev_pct: float | None = None
    if year:
        prev_total = await conn.fetchval(
            f"""
            SELECT COALESCE(SUM(total_usd), 0)
            FROM xnk_price_lookup
            WHERE price_usd > 0
              AND EXTRACT(YEAR FROM rfq_date) = $1
              {('AND hs_code = $2' if hs_code else '')}
            """,
            year - 1, *([hs_code] if hs_code else []),
        )
        prev_f = _f(prev_total) or 0.0
        curr_f = _f(row["total_usd"]) or 0.0
        if prev_f > 0:
            vs_prev_pct = round((curr_f - prev_f) / prev_f * 100, 1)

    return {"data": {
        "total_records": int(row["total_records"] or 0),
        "total_usd": _f(row["total_usd"]) or 0.0,
        "hs_codes_count": int(row["hs_codes_count"] or 0),
        "unique_sellers": int(row["unique_sellers"] or 0),
        "outlier_count": int(outlier_row["outlier_count"] or 0) if outlier_row else 0,
        "vs_prev_year_pct": vs_prev_pct,
    }}


# ---------------------------------------------------------------------------
# GET /analytics/hs-distribution
# ---------------------------------------------------------------------------

@router.get("/analytics/hs-distribution")
async def xnk_hs_distribution(
    hs_code: str = Query(..., min_length=2),
    year: int | None = Query(None),
    bins: int = Query(20, ge=5, le=100),
    exclude_outliers: bool = Query(False),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Phân phối giá USD theo HS code — histogram + percentiles."""
    where, params = _build_where(
        year=year, hs_code=hs_code, seller=None, exclude_outliers=exclude_outliers
    )

    try:
        # Min/max + percentiles
        stats = await conn.fetchrow(
            f"""
            SELECT
                MIN(price_usd) AS lo,
                MAX(price_usd) AS hi,
                AVG(price_usd) AS mean,
                STDDEV_SAMP(price_usd) AS stddev,
                COUNT(*)::bigint AS n,
                PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY price_usd) AS p10,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY price_usd) AS p50,
                PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY price_usd) AS p90
            FROM xnk_price_lookup
            WHERE {where}
            """,
            *params,
        )
    except asyncpg.UndefinedTableError:
        return {"data": {
            "hs_code": hs_code, "bins": [], "p10": None, "p50": None,
            "p90": None, "mean": None, "stddev": None, "n": 0,
        }}

    n = int(stats["n"] or 0)
    if n == 0 or stats["lo"] is None or stats["hi"] is None:
        return {"data": {
            "hs_code": hs_code, "bins": [], "p10": None, "p50": None,
            "p90": None, "mean": None, "stddev": None, "n": 0,
        }}

    lo = float(stats["lo"])
    hi = float(stats["hi"])
    if hi == lo:
        hi = lo + 1.0  # avoid zero-width

    # Append lo/hi/bins to filter params for WIDTH_BUCKET — they come AFTER
    # the existing $1..$N filter placeholders in `where`.
    bucket_params = [*params, lo, hi, bins]
    p_lo = len(params) + 1
    p_hi = len(params) + 2
    p_bins = len(params) + 3
    bucket_rows = await conn.fetch(
        f"""
        SELECT
            WIDTH_BUCKET(price_usd, ${p_lo}::float8, ${p_hi}::float8, ${p_bins}) AS bucket,
            COUNT(*)::bigint AS cnt
        FROM xnk_price_lookup
        WHERE {where}
        GROUP BY 1
        ORDER BY 1
        """,
        *bucket_params,
    )

    # Build bin list
    width = (hi - lo) / bins
    bin_counts = {int(r["bucket"]): int(r["cnt"]) for r in bucket_rows if r["bucket"] is not None}
    bins_out: list[dict[str, float | int]] = []
    for i in range(1, bins + 1):
        lower = lo + (i - 1) * width
        upper = lo + i * width
        bins_out.append({
            "lower": round(lower, 4),
            "upper": round(upper, 4),
            "count": bin_counts.get(i, 0),
        })

    return {"data": {
        "hs_code": hs_code,
        "bins": bins_out,
        "p10": _f(stats["p10"]),
        "p50": _f(stats["p50"]),
        "p90": _f(stats["p90"]),
        "mean": _f(stats["mean"]),
        "stddev": _f(stats["stddev"]),
        "n": n,
    }}


# ---------------------------------------------------------------------------
# GET /analytics/monthly-trend
# ---------------------------------------------------------------------------

@router.get("/analytics/monthly-trend")
async def xnk_monthly_trend(
    hs_code: str | None = Query(None),
    year: int | None = Query(None),
    seller: str | None = Query(None),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Xu hướng theo tháng: count + p10/p50/p90 USD + median_usd."""
    where, params = _build_where(
        year=year, hs_code=hs_code, seller=seller, exclude_outliers=False
    )
    # rfq_date can be null — guard
    where += " AND rfq_date IS NOT NULL"

    try:
        rows = await conn.fetch(
            f"""
            SELECT
                TO_CHAR(DATE_TRUNC('month', rfq_date), 'YYYY-MM') AS ym,
                COUNT(*)::bigint AS count,
                PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY price_usd) AS p10,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY price_usd) AS p50,
                PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY price_usd) AS p90,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY price_usd) AS median_usd
            FROM xnk_price_lookup
            WHERE {where}
            GROUP BY 1
            ORDER BY 1
            """,
            *params,
        )
    except asyncpg.UndefinedTableError:
        return {"data": {"months": []}}

    months = [
        {
            "ym": r["ym"],
            "count": int(r["count"] or 0),
            "p10": _f(r["p10"]),
            "p50": _f(r["p50"]),
            "p90": _f(r["p90"]),
            "median_usd": _f(r["median_usd"]),
        }
        for r in rows
    ]
    return {"data": {"months": months}}


# ---------------------------------------------------------------------------
# GET /analytics/top-sellers
# ---------------------------------------------------------------------------

@router.get("/analytics/top-sellers")
async def xnk_top_sellers(
    hs_code: str | None = Query(None),
    year: int | None = Query(None),
    limit: int = Query(10, ge=1, le=100),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Top sellers theo total USD, kèm số records + giá median."""
    where, params = _build_where(
        year=year, hs_code=hs_code, seller=None, exclude_outliers=False
    )
    where += " AND seller_name IS NOT NULL AND BTRIM(seller_name) <> ''"

    try:
        params.append(limit)
        rows = await conn.fetch(
            f"""
            SELECT
                seller_name,
                COUNT(*)::bigint AS records,
                COALESCE(SUM(total_usd), 0) AS total_usd,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY price_usd) AS median_usd,
                COUNT(DISTINCT hs_code) FILTER (WHERE hs_code IS NOT NULL) AS hs_codes
            FROM xnk_price_lookup
            WHERE {where}
            GROUP BY seller_name
            ORDER BY total_usd DESC
            LIMIT ${len(params)}
            """,
            *params,
        )
    except asyncpg.UndefinedTableError:
        return {"data": []}

    return {"data": [
        {
            "seller_name": r["seller_name"],
            "records": int(r["records"] or 0),
            "total_usd": _f(r["total_usd"]) or 0.0,
            "median_usd": _f(r["median_usd"]),
            "hs_codes": int(r["hs_codes"] or 0),
        }
        for r in rows
    ]}


# ---------------------------------------------------------------------------
# GET /analytics/seller/{seller_name}
# ---------------------------------------------------------------------------

@router.get("/analytics/seller/{seller_name}")
async def xnk_seller_drill(
    seller_name: str,
    year: int | None = Query(None, description="Lọc theo năm (optional)"),
    hs_code: str | None = Query(None, description="Lọc thêm theo HS code (optional)"),
    top_n: int = Query(10, ge=1, le=50, description="Top N cho HS/codes/buyers"),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Drill-down 1 NCC — aggregate KPI + breakdowns + monthly trend.

    Matching seller_name dùng so khớp EXACT (case-sensitive) để tránh
    nhập nhằng giữa các NCC có tên gần giống. Frontend lấy seller_name
    từ /analytics/top-sellers nên không cần ILIKE ở đây.
    """
    # Base WHERE — exact seller match + valid price
    conditions = [
        "price_usd IS NOT NULL",
        "price_usd > 0",
        "seller_name = $1",
    ]
    params: list[Any] = [seller_name]

    if year:
        params.append(year)
        conditions.append(f"EXTRACT(YEAR FROM rfq_date) = ${len(params)}")
    if hs_code:
        params.append(hs_code)
        conditions.append(f"hs_code = ${len(params)}")

    where = " AND ".join(conditions)

    try:
        # ---- Aggregate KPI + percentiles ----------------------------------
        agg = await conn.fetchrow(
            f"""
            SELECT
                COUNT(*)::bigint AS total_records,
                COALESCE(SUM(total_usd), 0) AS total_usd,
                PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY price_usd) AS p10,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY price_usd) AS p50,
                PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY price_usd) AS p90,
                MIN(rfq_date) AS first_seen,
                MAX(rfq_date) AS last_seen,
                COUNT(DISTINCT hs_code) FILTER (WHERE hs_code IS NOT NULL) AS hs_codes_count,
                COUNT(DISTINCT bqms_code) FILTER (WHERE bqms_code IS NOT NULL) AS codes_count,
                COUNT(DISTINCT buyer_name) FILTER (WHERE buyer_name IS NOT NULL) AS buyers_count
            FROM xnk_price_lookup
            WHERE {where}
            """,
            *params,
        )
    except asyncpg.UndefinedTableError:
        raise HTTPException(status_code=503, detail="xnk_price_lookup table not available")

    total_records = int(agg["total_records"] or 0)
    if total_records == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Không có dữ liệu cho seller '{seller_name}'"
            + (f" (year={year})" if year else "")
            + (f" (hs_code={hs_code})" if hs_code else ""),
        )

    # ---- Year breakdown ---------------------------------------------------
    year_rows = await conn.fetch(
        f"""
        SELECT
            EXTRACT(YEAR FROM rfq_date)::int AS year,
            COUNT(*)::bigint AS records,
            COALESCE(SUM(total_usd), 0) AS total_usd,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY price_usd) AS median_usd
        FROM xnk_price_lookup
        WHERE {where} AND rfq_date IS NOT NULL
        GROUP BY 1
        ORDER BY 1
        """,
        *params,
    )

    # ---- Top HS codes -----------------------------------------------------
    params_top = [*params, top_n]
    pn = len(params_top)
    top_hs_rows = await conn.fetch(
        f"""
        SELECT
            hs_code,
            COUNT(*)::bigint AS records,
            COALESCE(SUM(total_usd), 0) AS total_usd,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY price_usd) AS median_usd
        FROM xnk_price_lookup
        WHERE {where} AND hs_code IS NOT NULL AND BTRIM(hs_code) <> ''
        GROUP BY hs_code
        ORDER BY total_usd DESC
        LIMIT ${pn}
        """,
        *params_top,
    )

    # ---- Top BQMS codes (items) ------------------------------------------
    top_codes_rows = await conn.fetch(
        f"""
        SELECT
            bqms_code,
            MAX(item_name) AS item_name,
            COUNT(*)::bigint AS records,
            COALESCE(SUM(total_usd), 0) AS total_usd,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY price_usd) AS median_usd
        FROM xnk_price_lookup
        WHERE {where} AND bqms_code IS NOT NULL AND BTRIM(bqms_code) <> ''
        GROUP BY bqms_code
        ORDER BY total_usd DESC
        LIMIT ${pn}
        """,
        *params_top,
    )

    # ---- Top buyers -------------------------------------------------------
    top_buyers_rows = await conn.fetch(
        f"""
        SELECT
            buyer_name,
            COUNT(*)::bigint AS records,
            COALESCE(SUM(total_usd), 0) AS total_usd
        FROM xnk_price_lookup
        WHERE {where} AND buyer_name IS NOT NULL AND BTRIM(buyer_name) <> ''
        GROUP BY buyer_name
        ORDER BY total_usd DESC
        LIMIT ${pn}
        """,
        *params_top,
    )

    # ---- Monthly trend (count + median) ----------------------------------
    monthly_rows = await conn.fetch(
        f"""
        SELECT
            TO_CHAR(DATE_TRUNC('month', rfq_date), 'YYYY-MM') AS ym,
            COUNT(*)::bigint AS records,
            COALESCE(SUM(total_usd), 0) AS total_usd,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY price_usd) AS median_usd
        FROM xnk_price_lookup
        WHERE {where} AND rfq_date IS NOT NULL
        GROUP BY 1
        ORDER BY 1
        """,
        *params,
    )

    avg_unit_usd = await conn.fetchval(
        f"SELECT AVG(price_usd) FROM xnk_price_lookup WHERE {where}",
        *params,
    )

    return {"data": {
        "seller_name": seller_name,
        "filters": {"year": year, "hs_code": hs_code},
        "total_records": total_records,
        "total_usd": _f(agg["total_usd"]) or 0.0,
        "avg_unit_usd": _f(avg_unit_usd),
        "avg_unit_usd_p10": _f(agg["p10"]),
        "avg_unit_usd_p50": _f(agg["p50"]),
        "avg_unit_usd_p90": _f(agg["p90"]),
        "first_seen": agg["first_seen"].isoformat() if agg["first_seen"] else None,
        "last_seen": agg["last_seen"].isoformat() if agg["last_seen"] else None,
        "hs_codes_count": int(agg["hs_codes_count"] or 0),
        "codes_count": int(agg["codes_count"] or 0),
        "buyers_count": int(agg["buyers_count"] or 0),
        "year_breakdown": [
            {
                "year": int(r["year"]),
                "records": int(r["records"] or 0),
                "total_usd": _f(r["total_usd"]) or 0.0,
                "median_usd": _f(r["median_usd"]),
            }
            for r in year_rows
        ],
        "top_hs": [
            {
                "hs_code": r["hs_code"],
                "records": int(r["records"] or 0),
                "total_usd": _f(r["total_usd"]) or 0.0,
                "median_usd": _f(r["median_usd"]),
            }
            for r in top_hs_rows
        ],
        "top_codes": [
            {
                "bqms_code": r["bqms_code"],
                "item_name": r["item_name"],
                "records": int(r["records"] or 0),
                "total_usd": _f(r["total_usd"]) or 0.0,
                "median_usd": _f(r["median_usd"]),
            }
            for r in top_codes_rows
        ],
        "top_buyers": [
            {
                "buyer_name": r["buyer_name"],
                "records": int(r["records"] or 0),
                "total_usd": _f(r["total_usd"]) or 0.0,
            }
            for r in top_buyers_rows
        ],
        "monthly_trend": [
            {
                "ym": r["ym"],
                "records": int(r["records"] or 0),
                "total_usd": _f(r["total_usd"]) or 0.0,
                "median_usd": _f(r["median_usd"]),
            }
            for r in monthly_rows
        ],
    }}


# ---------------------------------------------------------------------------
# GET /analytics/seller/{seller_name}/declarations
# ---------------------------------------------------------------------------

@router.get("/analytics/seller/{seller_name}/declarations")
async def xnk_seller_declarations(
    seller_name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    year: int | None = Query(None),
    hs_code: str | None = Query(None),
    bqms_code: str | None = Query(None),
    sort: str = Query(
        "rfq_date_desc",
        pattern="^(rfq_date_asc|rfq_date_desc|price_usd_asc|price_usd_desc|total_usd_desc)$",
    ),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Raw declarations của 1 NCC — paginated, sortable.

    Trả về items đã phân trang + total để FE render bảng chi tiết.
    """
    conditions = ["seller_name = $1"]
    params: list[Any] = [seller_name]

    if year:
        params.append(year)
        conditions.append(f"EXTRACT(YEAR FROM rfq_date) = ${len(params)}")
    if hs_code:
        params.append(hs_code)
        conditions.append(f"hs_code = ${len(params)}")
    if bqms_code:
        params.append(bqms_code)
        conditions.append(f"bqms_code = ${len(params)}")

    where = " AND ".join(conditions)

    sort_map = {
        "rfq_date_asc": "rfq_date ASC NULLS LAST",
        "rfq_date_desc": "rfq_date DESC NULLS LAST",
        "price_usd_asc": "price_usd ASC NULLS LAST",
        "price_usd_desc": "price_usd DESC NULLS LAST",
        "total_usd_desc": "total_usd DESC NULLS LAST",
    }
    order_by = sort_map[sort]

    try:
        total = await conn.fetchval(
            f"SELECT COUNT(*)::bigint FROM xnk_price_lookup WHERE {where}",
            *params,
        )
    except asyncpg.UndefinedTableError:
        raise HTTPException(status_code=503, detail="xnk_price_lookup table not available")

    total = int(total or 0)
    offset = (page - 1) * page_size

    params_page = [*params, page_size, offset]
    p_limit = len(params_page) - 1
    p_offset = len(params_page)

    rows = await conn.fetch(
        f"""
        SELECT
            id,
            rfq_date,
            quotation_no,
            bqms_code,
            item_name,
            item_explain,
            maker,
            unit,
            quantity,
            hs_code,
            price_usd,
            price_vnd,
            total_usd,
            buyer_name,
            seller_name,
            source
        FROM xnk_price_lookup
        WHERE {where}
        ORDER BY {order_by}, id DESC
        LIMIT ${p_limit} OFFSET ${p_offset}
        """,
        *params_page,
    )

    items = [
        {
            "id": int(r["id"]),
            "rfq_date": r["rfq_date"].isoformat() if r["rfq_date"] else None,
            "quotation_no": r["quotation_no"],
            "bqms_code": r["bqms_code"],
            "item_name": r["item_name"],
            "item_explain": r["item_explain"],
            "maker": r["maker"],
            "unit": r["unit"],
            "quantity": _f(r["quantity"]),
            "hs_code": r["hs_code"],
            "price_usd": _f(r["price_usd"]),
            "price_vnd": _f(r["price_vnd"]),
            "total_usd": _f(r["total_usd"]),
            "buyer_name": r["buyer_name"],
            "seller_name": r["seller_name"],
            "source": r["source"],
        }
        for r in rows
    ]

    total_pages = (total + page_size - 1) // page_size if page_size else 0

    return {"data": {
        "seller_name": seller_name,
        "filters": {"year": year, "hs_code": hs_code, "bqms_code": bqms_code},
        "sort": sort,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "items": items,
    }}
