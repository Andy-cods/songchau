"""
Price Trends Analytics API.

Endpoints (mount under /api/v1/analytics):
  GET /price-trends/kpi                  — GMV tháng + win-rate + volatile/shrinking-margin counts
  GET /price-trends/multi-series         — So sánh nhiều BQMS code (≤6), median V1 + xnk overlay
  GET /price-trends/by-customer          — Xu hướng giá theo khách hàng (buyer_name)
  GET /price-trends/by-supplier          — Xu hướng giá theo nhà cung cấp (supplier_name)
  GET /price-trends/volatility           — Std-dev / mean per code (top volatile)
  GET /price-trends/fresh-codes-14d      — Code mới: lần đầu hỏi giá trong 14d qua (90d trước chưa thấy)
  GET /price-trends/matched-bqms         — Code có đủ V1 nội bộ + XNK market + kết quả (gap analysis)

Data sources:
  - bqms_rfq.quoted_price_bqms_v1 (giá báo round 1)
  - sourcing_entries.sale_vnd (giá bán đã chốt nội bộ)
  - xnk_price_lookup.price_usd (giá thị trường — overlay)
"""

from __future__ import annotations

import logging
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()

RFQ_DATE_SQL = "COALESCE(inquiry_date, created_at::date)"

# Quy tắc dedup twin (rfq_number,bqms_code) DÙNG CHUNG mọi query price-V1 để số liệu
# giữa các endpoint nhất quán (giữ dòng có result + mới cập nhật nhất). (chuẩn hoá 02/07)
DEDUP_TIEBREAK = "(result IS NOT NULL)::int DESC, updated_at DESC NULLS LAST, id DESC"

ROLE_KEYS = ("quote_v1", "market_xnk", "cost_ncc", "sale_sourcing", "imv_buy")


def _f(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _build_months_skeleton(months: int) -> list[str]:
    today = date.today()
    base_y, base_m = today.year, today.month
    labels: list[str] = []
    for i in range(months - 1, -1, -1):
        m = base_m - i
        y = base_y
        while m <= 0:
            m += 12
            y -= 1
        labels.append(f"{y:04d}-{m:02d}")
    return labels


# ---------------------------------------------------------------------------
# GET /price-trends/kpi
# ---------------------------------------------------------------------------

@router.get("/price-trends/kpi")
async def price_trends_kpi(
    range_months: int = Query(12, ge=1, le=36),
    months: int = Query(None, ge=1, le=36, description="Alias of range_months (frontend sends ?months=)"),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement", allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    KPI tổng quan cho trang Trends.

    Field names khớp CHÍNH XÁC interface `KpiPayload` ở frontend
    (price-trends/page.tsx ~L61-74). Nguồn tiền = sourcing_entries.sale_vnd (VND).
    GMV theo inquiry_date của sourcing (giá đã chào nội bộ).
    """
    # Frontend truyền ?months=; giữ range_months làm mặc định/back-compat.
    window_months = int(months) if months is not None else range_months

    # ── GMV chào tháng này + tháng trước (sourcing_entries.sale_vnd, VND) ──
    # gmv_quote_month_vnd = tổng sale_vnd tháng hiện tại (theo inquiry_date).
    # gmv_quote_delta_pct = % (tháng này vs tháng trước).
    try:
        gmv_row = await conn.fetchrow(
            """
            SELECT
                COALESCE(SUM(sale_vnd) FILTER (
                    WHERE DATE_TRUNC('month', inquiry_date) = DATE_TRUNC('month', CURRENT_DATE)
                ), 0) AS gmv_this,
                COALESCE(SUM(sale_vnd) FILTER (
                    WHERE DATE_TRUNC('month', inquiry_date)
                          = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
                ), 0) AS gmv_prev
            FROM sourcing_entries
            WHERE deleted_at IS NULL
              AND sale_vnd > 0
              AND inquiry_date IS NOT NULL
              AND inquiry_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
            """
        )
        gmv_this = _f(gmv_row["gmv_this"]) or 0.0
        gmv_prev = _f(gmv_row["gmv_prev"]) or 0.0
    except asyncpg.UndefinedTableError:
        gmv_this = gmv_prev = 0.0

    gmv_quote_month_vnd: float | None = gmv_this if gmv_this > 0 else None
    gmv_quote_delta_pct: float | None = (
        round((gmv_this - gmv_prev) / gmv_prev * 100, 1) if gmv_prev > 0 else None
    )

    # ── Win rate (bqms_rfq, dedup twins theo rfq_number) ──
    # won/(won+lost); result là enum → ILIKE '%won%' / '%lost%'.
    win_row = await conn.fetchrow(
        f"""
        WITH dedup AS (
            SELECT DISTINCT ON (rfq_number, bqms_code)
                   rfq_number, result::text AS result_txt
              FROM bqms_rfq
             WHERE {RFQ_DATE_SQL} >= CURRENT_DATE - ($1 || ' months')::interval
             ORDER BY rfq_number, bqms_code, {DEDUP_TIEBREAK}
        )
        SELECT
            COUNT(*) FILTER (WHERE result_txt ILIKE '%won%')::int AS won,
            COUNT(*) FILTER (
                -- CHỈ '%lost%' — KHÔNG dùng '%lose%' vì 'cLOSEd' chứa 'lose' → đếm nhầm RFQ closed
                WHERE result_txt ILIKE '%won%' OR result_txt ILIKE '%lost%'
            )::int AS decided
        FROM dedup
        """,
        str(window_months),
    )
    decided = int(win_row["decided"] or 0)
    won = int(win_row["won"] or 0)
    win_rate_pct: float | None = round(won / decided * 100, 1) if decided > 0 else None

    # ── Volatile codes: cv (stddev/mean) > 0.3 trên >= 3 RFQ distinct ──
    volatile_count = await conn.fetchval(
        f"""
        WITH dedup AS (
            SELECT DISTINCT ON (rfq_number, bqms_code)
                   bqms_code, quoted_price_bqms_v1
              FROM bqms_rfq
             WHERE quoted_price_bqms_v1 > 0
               AND bqms_code IS NOT NULL
               AND {RFQ_DATE_SQL} >= CURRENT_DATE - ($1 || ' months')::interval
             ORDER BY rfq_number, bqms_code, {DEDUP_TIEBREAK}
        ),
        per_code AS (
            SELECT
                bqms_code,
                COUNT(*) AS n,
                AVG(quoted_price_bqms_v1) AS mean,
                STDDEV_SAMP(quoted_price_bqms_v1) AS sd
            FROM dedup
            GROUP BY bqms_code
            HAVING COUNT(*) >= 3
        )
        SELECT COUNT(*)::bigint
        FROM per_code
        WHERE mean > 0 AND (sd / mean) > 0.3
        """,
        str(window_months),
    )

    # ── Sourcing-based KPIs: margin trung vị, sale trung vị, top customer,
    #    khách co biên (margin thu hẹp so với 3 tháng trước) ──
    avg_margin_pct: float | None = None
    median_sale_vnd: float | None = None
    top_customer_name: str | None = None
    top_customer_gmv_vnd: float | None = None
    margin_squeeze_customer_count = 0
    try:
        # Median margin % (chỉ dòng cost_vnd>0) + median sale tháng này.
        stat_row = await conn.fetchrow(
            """
            SELECT
                PERCENTILE_CONT(0.5) WITHIN GROUP (
                    ORDER BY (sale_vnd - cost_vnd)::float / NULLIF(sale_vnd, 0)
                ) FILTER (WHERE cost_vnd > 0 AND sale_vnd > 0) AS med_margin,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sale_vnd) FILTER (
                    WHERE sale_vnd > 0
                      AND DATE_TRUNC('month', inquiry_date) = DATE_TRUNC('month', CURRENT_DATE)
                ) AS med_sale_month
            FROM sourcing_entries
            WHERE deleted_at IS NULL
            """
        )
        med_margin = _f(stat_row["med_margin"])
        avg_margin_pct = round(med_margin * 100, 1) if med_margin is not None else None
        median_sale_vnd = _f(stat_row["med_sale_month"])

        # Top customer tháng này theo tổng sale_vnd.
        top_row = await conn.fetchrow(
            """
            SELECT customer_name, SUM(sale_vnd) AS gmv
            FROM sourcing_entries
            WHERE deleted_at IS NULL
              AND sale_vnd > 0
              AND customer_name IS NOT NULL AND TRIM(customer_name) <> ''
              AND DATE_TRUNC('month', inquiry_date) = DATE_TRUNC('month', CURRENT_DATE)
            GROUP BY customer_name
            ORDER BY gmv DESC
            LIMIT 1
            """
        )
        if top_row is not None:
            top_customer_name = top_row["customer_name"]
            top_customer_gmv_vnd = _f(top_row["gmv"])

        # Khách co biên: margin gần đây (<=3m) < margin trước đó (3m..window).
        margin_squeeze_customer_count = int(await conn.fetchval(
            """
            WITH per_cust AS (
                SELECT
                    customer_name,
                    AVG(CASE WHEN inquiry_date >= CURRENT_DATE - INTERVAL '3 months'
                             THEN (sale_vnd - cost_vnd)::float / NULLIF(sale_vnd, 0) END) AS m_recent,
                    AVG(CASE WHEN inquiry_date < CURRENT_DATE - INTERVAL '3 months'
                              AND inquiry_date >= CURRENT_DATE - ($1 || ' months')::interval
                             THEN (sale_vnd - cost_vnd)::float / NULLIF(sale_vnd, 0) END) AS m_prev
                FROM sourcing_entries
                WHERE deleted_at IS NULL
                  AND customer_name IS NOT NULL
                  AND sale_vnd > 0 AND cost_vnd > 0
                GROUP BY customer_name
            )
            SELECT COUNT(*)::bigint FROM per_cust
            WHERE m_recent IS NOT NULL AND m_prev IS NOT NULL AND m_recent < m_prev
            """,
            str(window_months),
        ) or 0)
    except asyncpg.UndefinedTableError:
        pass

    return {"data": {
        "gmv_quote_month_vnd": gmv_quote_month_vnd,
        "gmv_quote_delta_pct": gmv_quote_delta_pct,
        "win_rate_pct": win_rate_pct,
        # Chưa có baseline win-rate kỳ trước đáng tin → null (FE hiện "—").
        "win_rate_delta_pct": None,
        "volatile_code_count": int(volatile_count or 0),
        "margin_squeeze_customer_count": margin_squeeze_customer_count,
        "avg_margin_pct": avg_margin_pct,
        "median_sale_vnd": median_sale_vnd,
        "top_customer_name": top_customer_name,
        "top_customer_gmv_vnd": top_customer_gmv_vnd,
    }}


# ---------------------------------------------------------------------------
# GET /price-trends/by-role
# ---------------------------------------------------------------------------

@router.get("/price-trends/by-role")
async def price_trends_by_role(
    codes: str | None = Query(None, description="Comma-separated product keys / BQMS codes"),
    months: int = Query(12, ge=1, le=36),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement", allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Xu hướng giá theo VAI TRÒ (price_role) cho các mã đã chọn, đọc
    v_price_observations_clean. Mỗi role (quote_v1 / market_xnk / cost_ncc /
    sale_sourcing / imv_buy) → 1 đường, median price_vnd theo tháng.

    Trả series PHẲNG (recharts-friendly): mỗi phần tử = 1 tháng
      {month_key, quote_v1, market_xnk, cost_ncc, sale_sourcing, imv_buy}
    (role thiếu trong tháng → null). VND. Nhất quán pattern /multi-series.
    """
    code_list = [c.strip() for c in (codes or "").split(",") if c.strip()][:6]
    month_labels = _build_months_skeleton(months)

    # Empty codes → empty payload (NOT 422). FE gates với enabled.
    if not code_list:
        return {
            "data": {
                "months": month_labels,
                "codes": [],
                "roles": list(ROLE_KEYS),
                "series": [],
            }
        }

    try:
        rows = await conn.fetch(
            """
            SELECT
                TO_CHAR(DATE_TRUNC('month', obs_date), 'YYYY-MM') AS ym,
                price_role,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) AS median_vnd
            FROM v_price_observations_clean
            WHERE (product_key = ANY($1::text[]) OR bqms_code = ANY($1::text[]))
              AND price_vnd > 0
              AND obs_date >= CURRENT_DATE - ($2 || ' months')::interval
            GROUP BY 1, 2
            """,
            code_list, str(months),
        )
    except asyncpg.UndefinedTableError:
        rows = []

    # month_key → {role: median}
    by_month: dict[str, dict[str, Any]] = {ym: {"month_key": ym} for ym in month_labels}
    for r in rows:
        ym = r["ym"]
        role = r["price_role"]
        if ym in by_month and role in ROLE_KEYS:
            by_month[ym][role] = _f(r["median_vnd"])

    # Fill missing roles với null để FE null-safe.
    series = []
    for ym in month_labels:
        row = by_month[ym]
        for role in ROLE_KEYS:
            row.setdefault(role, None)
        series.append(row)

    return {
        "data": {
            "months": month_labels,
            "codes": code_list,
            "roles": list(ROLE_KEYS),
            "series": series,
        }
    }


# ---------------------------------------------------------------------------
# GET /price-trends/multi-series
# ---------------------------------------------------------------------------

@router.get("/price-trends/multi-series")
async def price_trends_multi_series(
    codes: str | None = Query(None, description="Comma-separated BQMS codes, max 6"),
    months: int = Query(12, ge=1, le=36),
    normalize: bool = Query(False),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement", allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """So sánh xu hướng giá theo tháng cho ≤6 BQMS code, có xnk overlay."""
    code_list = [c.strip() for c in (codes or "").split(",") if c.strip()][:6]
    month_labels = _build_months_skeleton(months)

    # Empty codes → empty payload (NOT 422). Frontend gates with enabled but
    # be defensive for direct API consumers.
    if not code_list:
        return {
            "data": {
                "months": month_labels,
                "codes": [],
                "series": [],
                "market_median": [],
                # Legacy detail kept for any older consumer
                "series_detail": [],
            }
        }

    series_out: list[dict[str, Any]] = []
    for code in code_list:
        # Internal v1 median by month
        rows = await conn.fetch(
            f"""
            SELECT
                TO_CHAR(DATE_TRUNC('month', {RFQ_DATE_SQL}), 'YYYY-MM') AS ym,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) AS median_v1,
                COUNT(*)::int AS n
            FROM bqms_rfq
            WHERE bqms_code = $1
              AND quoted_price_bqms_v1 > 0
              AND {RFQ_DATE_SQL} >= CURRENT_DATE - ($2 || ' months')::interval
            GROUP BY 1
            ORDER BY 1
            """,
            code, str(months),
        )
        by_month = {r["ym"]: r for r in rows}
        points = [
            {
                "ym": ym,
                "median_v1_vnd": _f(by_month[ym]["median_v1"]) if ym in by_month else None,
                "n": int(by_month[ym]["n"]) if ym in by_month else 0,
            }
            for ym in month_labels
        ]

        # Normalize each series to first non-null point = 100
        if normalize:
            base_v: float | None = None
            for p in points:
                if p["median_v1_vnd"] is not None and p["median_v1_vnd"] > 0:
                    base_v = float(p["median_v1_vnd"])
                    break
            if base_v:
                for p in points:
                    if p["median_v1_vnd"] is not None:
                        p["median_v1_vnd"] = round(float(p["median_v1_vnd"]) / base_v * 100, 2)

        # XNK overlay (market median USD)
        try:
            xnk_rows = await conn.fetch(
                """
                SELECT
                    TO_CHAR(DATE_TRUNC('month', rfq_date), 'YYYY-MM') AS ym,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_usd) AS median_usd
                FROM xnk_price_lookup
                WHERE bqms_code = $1
                  AND price_usd > 0
                  AND rfq_date >= CURRENT_DATE - ($2 || ' months')::interval
                GROUP BY 1
                ORDER BY 1
                """,
                code, str(months),
            )
            xnk_by_month = {r["ym"]: _f(r["median_usd"]) for r in xnk_rows}
            xnk_overlay = [
                {"ym": ym, "median_usd": xnk_by_month.get(ym)} for ym in month_labels
            ]
        except asyncpg.UndefinedTableError:
            xnk_overlay = []

        series_out.append({
            "bqms_code": code,
            "points": points,
            "xnk_overlay": xnk_overlay,
        })

    # Build FLAT recharts series: one row per month with {month_key, <code>: number,...}
    flat_by_month: dict[str, dict[str, Any]] = {ym: {"month_key": ym} for ym in month_labels}
    for s in series_out:
        for p in s["points"]:
            flat_by_month[p["ym"]][s["bqms_code"]] = p["median_v1_vnd"]

    flat_series = [flat_by_month[ym] for ym in month_labels]

    # Aggregate market_median across all codes per month (mean of available codes).
    market_median: list[dict[str, Any]] = []
    for ym in month_labels:
        vals: list[float] = []
        for s in series_out:
            for p in s["xnk_overlay"]:
                if p["ym"] == ym and p.get("median_usd") is not None:
                    vals.append(float(p["median_usd"]))
        market_median.append({
            "month_key": ym,
            "value": (sum(vals) / len(vals)) if vals else None,
        })

    return {
        "data": {
            "months": month_labels,
            "codes": code_list,
            "series": flat_series,
            "market_median": market_median,
            "series_detail": series_out,
        }
    }


# ---------------------------------------------------------------------------
# GET /price-trends/by-customer
# ---------------------------------------------------------------------------

@router.get("/price-trends/by-customer")
async def price_trends_by_customer(
    code: str | None = Query(None, description="Single BQMS code (legacy)"),
    codes: str | None = Query(None, description="Comma-separated BQMS codes (preferred)"),
    customers: str | None = Query(None, description="Optional CSV filter of customer names"),
    months: int = Query(12, ge=1, le=36),
    limit_customers: int = Query(10, ge=1, le=50),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement", allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Xu hướng giá theo buyer_name từ sourcing_entries.

    Accepts EITHER `code` (singular) OR `codes` (CSV, preferred by frontend).
    Empty codes → returns empty customers array (not 422).

    Returns BOTH the legacy nested shape (`customers: [{buyer_name, points}]`)
    AND the flat recharts-friendly shape (`series: [{month_key, <customer>: number}]`,
    `codes: [...]`) so the frontend's `.map()` calls don't crash.
    """
    # Normalize code list — accept either singular `code` or plural `codes`.
    code_list: list[str] = []
    if codes:
        code_list.extend(c.strip() for c in codes.split(",") if c.strip())
    if code and code.strip():
        if code.strip() not in code_list:
            code_list.append(code.strip())
    code_list = code_list[:6]

    customer_filter = (
        [c.strip() for c in customers.split(",") if c.strip()] if customers else []
    )

    month_labels = _build_months_skeleton(months)

    # Empty codes → return empty payload (NOT 422).
    if not code_list:
        return {
            "data": {
                "months": month_labels,
                "customers": [],
                "codes": [],
                "series": [],
            }
        }

    # Aggregate top customers across ALL requested codes
    try:
        top_cust = await conn.fetch(
            """
            SELECT customer_name, COUNT(*) AS n
            FROM sourcing_entries
            WHERE bqms_code = ANY($1::text[])
              AND customer_name IS NOT NULL
              AND inquiry_date >= CURRENT_DATE - ($2 || ' months')::interval
            GROUP BY customer_name
            ORDER BY n DESC
            LIMIT $3
            """,
            code_list, str(months), limit_customers,
        )
    except asyncpg.UndefinedTableError:
        top_cust = []

    customers_out: list[dict[str, Any]] = []
    # Build flat series rows for recharts: one entry per month, keyed by customer.
    flat_by_month: dict[str, dict[str, Any]] = {ym: {"month_key": ym} for ym in month_labels}

    for tc in top_cust:
        cust_name = tc["customer_name"]
        if customer_filter and cust_name not in customer_filter:
            continue
        rows = await conn.fetch(
            """
            SELECT
                TO_CHAR(DATE_TRUNC('month', inquiry_date), 'YYYY-MM') AS ym,
                AVG(sale_vnd) AS avg_unit_price,
                SUM(quantity) AS qty
            FROM sourcing_entries
            WHERE bqms_code = ANY($1::text[])
              AND customer_name = $2
              AND sale_vnd > 0
              AND inquiry_date >= CURRENT_DATE - ($3 || ' months')::interval
            GROUP BY 1
            ORDER BY 1
            """,
            code_list, cust_name, str(months),
        )
        by_month = {r["ym"]: r for r in rows}
        points = [
            {
                "ym": ym,
                "avg_unit_price": _f(by_month[ym]["avg_unit_price"]) if ym in by_month else None,
                "qty": _f(by_month[ym]["qty"]) if ym in by_month else 0.0,
            }
            for ym in month_labels
        ]
        customers_out.append({"buyer_name": cust_name, "points": points})

        # Flat series for recharts
        for ym in month_labels:
            flat_by_month[ym][cust_name] = (
                _f(by_month[ym]["avg_unit_price"]) if ym in by_month else None
            )

    flat_series = [flat_by_month[ym] for ym in month_labels]
    customer_names = [c["buyer_name"] for c in customers_out]

    return {
        "data": {
            "months": month_labels,
            # Frontend reads `.customers` as `string[]` for recharts dataKey.
            "customers": customer_names,
            # Detail nested array kept under a different key for any legacy consumer.
            "customer_details": customers_out,
            "codes": code_list,
            "series": flat_series,
        }
    }


# ---------------------------------------------------------------------------
# GET /price-trends/by-supplier
# ---------------------------------------------------------------------------

@router.get("/price-trends/by-supplier")
async def price_trends_by_supplier(
    code: str | None = Query(None, description="Single BQMS code (legacy)"),
    codes: str | None = Query(None, description="Comma-separated BQMS codes (preferred)"),
    months: int = Query(12, ge=1, le=36),
    limit_suppliers: int = Query(10, ge=1, le=50),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement", allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Xu hướng giá nhập theo nhà cung cấp.

    Accepts EITHER `code` (singular) OR `codes` (CSV, preferred). Empty codes
    → empty payload, NOT 422. Returns flat recharts shape + suppliers as
    `string[]` to match the frontend.
    """
    code_list: list[str] = []
    if codes:
        code_list.extend(c.strip() for c in codes.split(",") if c.strip())
    if code and code.strip():
        if code.strip() not in code_list:
            code_list.append(code.strip())
    code_list = code_list[:6]

    month_labels = _build_months_skeleton(months)

    if not code_list:
        return {
            "data": {
                "months": month_labels,
                "suppliers": [],
                "codes": [],
                "series": [],
            }
        }

    try:
        top_sup = await conn.fetch(
            """
            SELECT supplier_name, COUNT(*) AS n
            FROM sourcing_entries
            WHERE bqms_code = ANY($1::text[])
              AND supplier_name IS NOT NULL
              AND inquiry_date >= CURRENT_DATE - ($2 || ' months')::interval
            GROUP BY supplier_name
            ORDER BY n DESC
            LIMIT $3
            """,
            code_list, str(months), limit_suppliers,
        )
    except asyncpg.UndefinedTableError:
        top_sup = []

    suppliers_out: list[dict[str, Any]] = []
    flat_by_month: dict[str, dict[str, Any]] = {ym: {"month_key": ym} for ym in month_labels}

    for ts in top_sup:
        sup_name = ts["supplier_name"]
        rows = await conn.fetch(
            """
            SELECT
                TO_CHAR(DATE_TRUNC('month', inquiry_date), 'YYYY-MM') AS ym,
                AVG(COALESCE(cost_vnd,
                             fn_to_vnd(cost_usd, 'USD', inquiry_date),
                             fn_to_vnd(cost_jpy, 'JPY', inquiry_date),
                             fn_to_vnd(cost_krw, 'KRW', inquiry_date),
                             fn_to_vnd(cost_rmb, 'RMB', inquiry_date))) AS avg_cost,
                SUM(quantity) AS qty
            FROM sourcing_entries
            WHERE bqms_code = ANY($1::text[])
              AND supplier_name = $2
              AND inquiry_date >= CURRENT_DATE - ($3 || ' months')::interval
            GROUP BY 1
            ORDER BY 1
            """,
            code_list, sup_name, str(months),
        )
        by_month = {r["ym"]: r for r in rows}
        points = [
            {
                "ym": ym,
                "avg_cost_vnd": _f(by_month[ym]["avg_cost"]) if ym in by_month else None,
                "qty": _f(by_month[ym]["qty"]) if ym in by_month else 0.0,
            }
            for ym in month_labels
        ]
        suppliers_out.append({"supplier_name": sup_name, "points": points})

        for ym in month_labels:
            flat_by_month[ym][sup_name] = (
                _f(by_month[ym]["avg_cost"]) if ym in by_month else None
            )

    flat_series = [flat_by_month[ym] for ym in month_labels]
    supplier_names = [s["supplier_name"] for s in suppliers_out]

    return {
        "data": {
            "months": month_labels,
            # Frontend reads `.suppliers` as `string[]` for recharts dataKey.
            "suppliers": supplier_names,
            "supplier_details": suppliers_out,
            "codes": code_list,
            "series": flat_series,
        }
    }


# ---------------------------------------------------------------------------
# GET /price-trends/volatility
# ---------------------------------------------------------------------------

@router.get("/price-trends/volatility")
async def price_trends_volatility(
    months: int = Query(12, ge=1, le=36),
    limit: int = Query(20, ge=1, le=100),
    min_samples: int = Query(3, ge=2, le=20),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement", allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Top volatile BQMS codes: coefficient of variation CV = stddev/mean cao nhất.

    Field names khớp interface `VolatilityRow` ở frontend (page.tsx ~L105-115):
    rfq_count / median_v1 / min_v1 / max_v1 / stddev_pct / last_seen.
    (zscore_max, spike_count BỎ theo yêu cầu — FE gỡ 2 cột này.)
    Giá V1 = VND. Dedup twins qua DISTINCT ON (rfq_number, bqms_code).
    """
    rows = await conn.fetch(
        f"""
        WITH dedup AS (
            SELECT DISTINCT ON (rfq_number, bqms_code)
                   bqms_code, quoted_price_bqms_v1,
                   {RFQ_DATE_SQL} AS d
              FROM bqms_rfq
             WHERE quoted_price_bqms_v1 > 0
               AND bqms_code IS NOT NULL
               AND {RFQ_DATE_SQL} >= CURRENT_DATE - ($1 || ' months')::interval
             ORDER BY rfq_number, bqms_code, {DEDUP_TIEBREAK}
        )
        SELECT
            bqms_code,
            COUNT(*)::int AS rfq_count,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) AS median_v1,
            AVG(quoted_price_bqms_v1) AS mean_v1,
            STDDEV_SAMP(quoted_price_bqms_v1) AS sd,
            MIN(quoted_price_bqms_v1) AS min_v1,
            MAX(quoted_price_bqms_v1) AS max_v1,
            MAX(d) AS last_seen
        FROM dedup
        GROUP BY bqms_code
        HAVING COUNT(*) >= $2 AND AVG(quoted_price_bqms_v1) > 0
        ORDER BY (STDDEV_SAMP(quoted_price_bqms_v1) / NULLIF(AVG(quoted_price_bqms_v1), 0)) DESC NULLS LAST
        LIMIT $3
        """,
        str(months), min_samples, limit,
    )

    out: list[dict[str, Any]] = []
    for r in rows:
        median_v1 = _f(r["median_v1"])
        mean_v1 = _f(r["mean_v1"]) or 0.0
        sd = _f(r["sd"]) or 0.0
        # stddev_pct dựa trên MEAN (định nghĩa CV chuẩn); mean>0 do HAVING.
        stddev_pct = round(sd / mean_v1 * 100, 1) if mean_v1 > 0 else None
        last_seen = r["last_seen"]
        out.append({
            "bqms_code": r["bqms_code"],
            "rfq_count": int(r["rfq_count"] or 0),
            "median_v1": median_v1,
            "min_v1": _f(r["min_v1"]),
            "max_v1": _f(r["max_v1"]),
            "stddev_pct": stddev_pct,
            "last_seen": last_seen.isoformat() if last_seen else None,
        })

    return {"data": out}


# ---------------------------------------------------------------------------
# GET /price-trends/fresh-codes-14d
# ---------------------------------------------------------------------------

@router.get("/price-trends/fresh-codes-14d")
async def price_trends_fresh_codes_14d(
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement", allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    BQMS codes có inquiry MỚI trong 14 ngày qua, mà 90 ngày trước đó CHƯA TỪNG được hỏi.

    Urgency tiers:
      - high   : first_inquiry_date trong 3 ngày gần nhất
      - medium : 4-7 ngày
      - low    : 8-14 ngày
    """
    # Anchor windows once so the SQL is readable and indexes hit cleanly.
    # Fresh window  : [today-14d, today]
    # History window: [today-104d, today-14d)
    rows = await conn.fetch(
        f"""
        WITH fresh AS (
            SELECT
                bqms_code,
                MIN({RFQ_DATE_SQL}) AS first_inquiry_date,
                -- Pick the most-recent specification + source as canonical display values.
                (ARRAY_AGG(specification ORDER BY {RFQ_DATE_SQL} DESC NULLS LAST))[1] AS product_name,
                (ARRAY_AGG(COALESCE(customer_source, 'samsung')
                           ORDER BY {RFQ_DATE_SQL} DESC NULLS LAST))[1] AS customer
            FROM bqms_rfq
            WHERE bqms_code IS NOT NULL
              AND TRIM(bqms_code) <> ''
              AND {RFQ_DATE_SQL} >= CURRENT_DATE - INTERVAL '14 days'
              AND {RFQ_DATE_SQL} <= CURRENT_DATE
            GROUP BY bqms_code
        ),
        history AS (
            SELECT DISTINCT bqms_code
            FROM bqms_rfq
            WHERE bqms_code IS NOT NULL
              AND {RFQ_DATE_SQL} >= CURRENT_DATE - INTERVAL '104 days'
              AND {RFQ_DATE_SQL} <  CURRENT_DATE - INTERVAL '14 days'
        ),
        new_codes AS (
            SELECT f.*
            FROM fresh f
            LEFT JOIN history h ON h.bqms_code = f.bqms_code
            WHERE h.bqms_code IS NULL
        ),
        market AS (
            SELECT
                bqms_code,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_usd) AS median_usd
            FROM xnk_price_lookup
            WHERE price_usd > 0
              AND bqms_code IS NOT NULL
            GROUP BY bqms_code
        )
        SELECT
            n.bqms_code,
            n.first_inquiry_date,
            n.product_name,
            n.customer,
            m.median_usd AS suggested_market_median_usd
        FROM new_codes n
        LEFT JOIN market m ON m.bqms_code = n.bqms_code
        ORDER BY n.first_inquiry_date DESC NULLS LAST, n.bqms_code
        LIMIT $1
        """,
        limit,
    )

    today = date.today()
    out: list[dict[str, Any]] = []
    for r in rows:
        first_dt = r["first_inquiry_date"]
        if first_dt is None:
            urgency = "low"
        else:
            days_ago = (today - first_dt).days
            if days_ago <= 3:
                urgency = "high"
            elif days_ago <= 7:
                urgency = "medium"
            else:
                urgency = "low"
        out.append({
            "bqms_code": r["bqms_code"],
            "first_inquiry_date": first_dt.isoformat() if first_dt else None,
            "customer": r["customer"] or "samsung",
            "product_name": r["product_name"],
            "suggested_market_median_usd": _f(r["suggested_market_median_usd"]),
            "urgency": urgency,
        })

    return {"data": out}


# ---------------------------------------------------------------------------
# GET /price-trends/matched-bqms
# ---------------------------------------------------------------------------

@router.get("/price-trends/matched-bqms")
async def price_trends_matched_bqms(
    months: int = Query(12, ge=1, le=36),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement", allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    BQMS codes có FULL match:
      - V1 nội bộ (bqms_rfq.quoted_price_bqms_v1 > 0)
      - Market XNK (xnk_price_lookup.price_usd > 0)
      - Kết quả (won/lost/pending)

    Trả về gap_pct = (our_v1_usd - market_median_usd) / market_median_usd * 100.
    Sort theo |gap_pct| DESC — chênh lệch lớn nhất hiện lên trước (insight actionable).

    USD/VND lấy tỷ giá THẬT gần nhất từ exchange_rates. Nếu bảng rỗng KHÔNG bịa số —
    trả rate_missing=true và các field phụ thuộc rate = null (W0-15).
    V1 lưu VND → chia rate để so sánh với market price_usd.
    """
    # Tỷ giá USD→VND THẬT gần nhất thay vì hằng cứng (finding review Data/SQL 02/07).
    _usd_rate = await conn.fetchval(
        "SELECT rate FROM exchange_rates WHERE from_currency::text = 'USD' "
        "AND to_currency::text = 'VND' ORDER BY rate_date DESC LIMIT 1"
    )
    USD_VND = float(_usd_rate) if _usd_rate and float(_usd_rate) > 0 else None  # noqa: N806
    rate_missing = USD_VND is None
    if rate_missing:
        logger.warning(
            "price_trends_matched_bqms: exchange_rates rỗng (USD->VND) — "
            "không có fallback hằng cứng, our_v1_usd/gap_pct sẽ trả null."
        )

    rows = await conn.fetch(
        f"""
        -- Khử twin (rfq_number,bqms_code) TRƯỚC khi AVG/ARRAY_AGG để n_quotes +
        -- avg_v1 tính trên quan sát đã dedup (chuẩn hoá 02/07).
        WITH deduped AS (
            SELECT DISTINCT ON (rfq_number, bqms_code)
                   bqms_code, quoted_price_bqms_v1, result::text AS result_txt,
                   result_date, customer_source, {RFQ_DATE_SQL} AS rdate
              FROM bqms_rfq
             WHERE bqms_code IS NOT NULL
               AND quoted_price_bqms_v1 > 0
               AND {RFQ_DATE_SQL} >= CURRENT_DATE - ($1 || ' months')::interval
             ORDER BY rfq_number, bqms_code, {DEDUP_TIEBREAK}
        ),
        per_code AS (
            SELECT
                bqms_code,
                AVG(quoted_price_bqms_v1) AS avg_v1_vnd,
                (ARRAY_AGG(result_txt
                           ORDER BY COALESCE(result_date, rdate) DESC NULLS LAST))[1] AS result,
                (ARRAY_AGG(COALESCE(customer_source, 'samsung')
                           ORDER BY rdate DESC NULLS LAST))[1] AS customer,
                COUNT(*)::int AS n_quotes
            FROM deduped
            GROUP BY bqms_code
        ),
        market AS (
            SELECT
                bqms_code,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_usd) AS median_usd,
                COUNT(*)::int AS n_market
            FROM xnk_price_lookup
            WHERE bqms_code IS NOT NULL
              AND price_usd > 0
            GROUP BY bqms_code
        )
        SELECT
            p.bqms_code,
            p.avg_v1_vnd,
            p.result,
            p.customer,
            p.n_quotes,
            m.median_usd AS market_median_usd,
            m.n_market
        FROM per_code p
        INNER JOIN market m ON m.bqms_code = p.bqms_code
        WHERE m.median_usd > 0
        """,
        str(months),
    )

    enriched: list[dict[str, Any]] = []
    for r in rows:
        v1_vnd = _f(r["avg_v1_vnd"]) or 0.0
        market_usd = _f(r["market_median_usd"]) or 0.0
        if v1_vnd <= 0 or market_usd <= 0:
            continue
        our_v1_usd = (v1_vnd / USD_VND) if USD_VND else None
        gap_pct = (
            (our_v1_usd - market_usd) / market_usd * 100.0
            if our_v1_usd is not None
            else None
        )

        result_raw = (r["result"] or "pending").lower()
        if "won" in result_raw:
            result_norm = "won"
        elif "lost" in result_raw:  # KHÔNG "lose" — 'closed' chứa 'lose' → phân loại nhầm
            result_norm = "lost"
        else:
            result_norm = "pending"

        # Action heuristic — Vietnamese suggestion based on gap + result.
        if gap_pct is None:
            action = "Thiếu tỷ giá USD/VND (exchange_rates rỗng) — không tính được gap, cần nhập tỷ giá."
        elif gap_pct >= 15:
            if result_norm == "lost":
                action = "Giá V1 cao hơn thị trường nhiều — xem lại cost & maker, cân nhắc hạ V2."
            elif result_norm == "won":
                action = "Đã thắng dù cao hơn thị trường — giữ tier giá, ưu tiên up-sell cùng khách."
            else:
                action = "V1 cao hơn thị trường — chuẩn bị V2 hạ giá hoặc thêm value-add."
        elif gap_pct <= -15:
            if result_norm == "won":
                action = "Thắng nhưng giá thấp hơn thị trường — kiểm tra margin, có thể tăng V2 cho lô sau."
            elif result_norm == "lost":
                action = "Giá đã rẻ hơn thị trường mà vẫn lost — vấn đề ngoài giá (chất lượng, lead-time)."
            else:
                action = "Giá thấp hơn thị trường — có biên để nâng giá nếu khách bám sát V1."
        else:
            action = "Giá nội bộ sát thị trường — duy trì chiến lược hiện tại, theo dõi kết quả."

        enriched.append({
            "bqms_code": r["bqms_code"],
            "our_v1_usd": round(our_v1_usd, 4) if our_v1_usd is not None else None,
            "market_median_usd": round(market_usd, 4),
            "gap_pct": round(gap_pct, 2) if gap_pct is not None else None,
            "result": result_norm,
            "customer": r["customer"] or "samsung",
            "suggested_action_vi": action,
            "n_quotes": int(r["n_quotes"] or 0),
            "n_market": int(r["n_market"] or 0),
        })

    # Sort by |gap_pct| DESC — biggest mismatches first (None gap_pct sorts last)
    enriched.sort(
        key=lambda x: abs(x["gap_pct"]) if x["gap_pct"] is not None else -1,
        reverse=True,
    )
    return {"data": enriched[:limit], "rate_missing": rate_missing}


# ---------------------------------------------------------------------------
# GET /price-trends/repeat-rfq-radar
# ---------------------------------------------------------------------------

@router.get("/price-trends/repeat-rfq-radar")
async def repeat_rfq_radar(
    limit: int = Query(100, ge=1, le=500),
    min_asks: int = Query(3, ge=1, le=50),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement", allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Radar "mã sắp bị hỏi lại" — gom bqms_rfq theo bqms_code, ước tính nhịp hỏi
    (cadence) và mã nào đang tới/quá hạn được hỏi lại.

    DEDUP twins bằng COUNT(DISTINCT rfq_number). Chỉ lấy mã có ask_count >= min_asks.
    Giá V1 = VND (không quy đổi).
    """
    rows = await conn.fetch(
        f"""
        WITH base AS (
            SELECT
                bqms_code,
                rfq_number,
                {RFQ_DATE_SQL} AS d,
                specification,
                customer_source,
                quoted_price_bqms_v1,
                purchase_price_vnd,
                purchase_price_rmb,
                id
            FROM bqms_rfq
            WHERE bqms_code IS NOT NULL
              AND TRIM(bqms_code) <> ''
              AND {RFQ_DATE_SQL} IS NOT NULL
        ),
        agg AS (
            SELECT
                bqms_code,
                COUNT(DISTINCT rfq_number)::int AS ask_count,
                COUNT(DISTINCT d)::int AS distinct_days,
                MIN(d) AS first_inquiry,
                MAX(d) AS last_inquiry,
                -- Chi phí đã biết (bqms side)
                BOOL_OR(COALESCE(purchase_price_vnd, 0) > 0
                        OR COALESCE(purchase_price_rmb, 0) > 0) AS has_cost_bqms,
                -- Giá trị hiển thị của dòng inquiry MỚI NHẤT
                (ARRAY_AGG(specification ORDER BY d DESC NULLS LAST, id DESC))[1] AS product_name,
                (ARRAY_AGG(customer_source ORDER BY d DESC NULLS LAST, id DESC))[1] AS customer,
                (ARRAY_AGG(quoted_price_bqms_v1 ORDER BY d DESC NULLS LAST, id DESC))[1] AS last_v1_vnd
            FROM base
            GROUP BY bqms_code
            HAVING COUNT(DISTINCT rfq_number) >= $1
        )
        SELECT
            a.*,
            -- Sourcing enrich (khớp bqms_code)
            EXISTS (
                SELECT 1 FROM sourcing_entries s
                WHERE s.deleted_at IS NULL AND s.bqms_code = a.bqms_code
            ) AS has_sourcing,
            EXISTS (
                SELECT 1 FROM sourcing_entries s
                WHERE s.deleted_at IS NULL AND s.bqms_code = a.bqms_code
                  AND COALESCE(s.cost_vnd, 0) > 0
            ) AS has_cost_sourcing,
            -- cadence = (last - first) / (distinct_days - 1)
            CASE WHEN a.distinct_days > 1
                 THEN (a.last_inquiry - a.first_inquiry)::float / (a.distinct_days - 1)
                 ELSE NULL END AS cadence_days,
            (CURRENT_DATE - a.last_inquiry)::int AS days_since_last
        FROM agg a
        """,
        # $1 = min_asks (limit applied Python-side after sort)
        min_asks,
    )

    out: list[dict[str, Any]] = []
    for r in rows:
        cadence = _f(r["cadence_days"])
        days_since = r["days_since_last"]
        days_since_i = int(days_since) if days_since is not None else None

        due_ratio: float | None = None
        if cadence and cadence > 0 and days_since_i is not None:
            due_ratio = round(days_since_i / cadence, 3)

        if cadence is None:
            status = "unknown"
        elif due_ratio is None:
            status = "unknown"
        elif due_ratio > 1.1:
            status = "overdue"
        elif due_ratio >= 0.8:
            status = "due_soon"
        else:
            status = "on_track"

        first_inq = r["first_inquiry"]
        last_inq = r["last_inquiry"]
        next_expected = None
        if last_inq is not None and cadence and cadence > 0:
            next_expected = (last_inq + timedelta(days=round(cadence))).isoformat()

        has_cost = bool(r["has_cost_bqms"]) or bool(r["has_cost_sourcing"])

        out.append({
            "bqms_code": r["bqms_code"],
            "ask_count": int(r["ask_count"] or 0),
            "first_inquiry": first_inq.isoformat() if first_inq else None,
            "last_inquiry": last_inq.isoformat() if last_inq else None,
            "cadence_days": round(cadence, 1) if cadence is not None else None,
            "days_since_last": days_since_i,
            "due_ratio": due_ratio,
            "status": status,
            "next_expected_date": next_expected,
            "product_name": r["product_name"],
            "customer": r["customer"],
            "has_cost": has_cost,
            "has_sourcing": bool(r["has_sourcing"]),
            "last_v1_vnd": _f(r["last_v1_vnd"]),
        })

    # Sort: overdue trước, rồi due_ratio DESC (None cuối).
    status_rank = {"overdue": 0, "due_soon": 1, "on_track": 2, "unknown": 3}
    out.sort(key=lambda x: (
        status_rank.get(x["status"], 9),
        -(x["due_ratio"] if x["due_ratio"] is not None else -1.0),
    ))
    out = out[:limit]

    return {"data": {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(out),
        "rows": out,
    }}
