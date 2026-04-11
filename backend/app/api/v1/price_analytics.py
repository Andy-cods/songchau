"""
M02: Price Analytics & Win/Loss Tracking API.

5 endpoints for analyzing quotation performance:
  - /overview — Summary KPIs
  - /by-maker — Win/loss breakdown by maker
  - /by-owner — Performance by quotation owner
  - /price-trends — Price versioning trends (v1→v4)
  - /loss-reasons — Analyze loss reasons
"""

from __future__ import annotations

from datetime import datetime, timezone
from statistics import median
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.core.database import get_db
from app.core.rbac import require_role, TokenData

router = APIRouter()

RFQ_DATE_SQL = "COALESCE(inquiry_date, created_at::date)"
XNK_DATE_SQL = "COALESCE(rfq_date, quoted_date)"
NORMALIZED_MAKER_SQL = "NULLIF(REGEXP_REPLACE(BTRIM(maker), '\\s+', ' ', 'g'), '')"


def build_rfq_filters(
    *,
    months: int,
    bqms_code: str | None,
    maker: str | None,
) -> tuple[str, list[Any]]:
    conditions = [f"{RFQ_DATE_SQL} >= CURRENT_DATE - ($1 || ' months')::interval"]
    params: list[Any] = [str(months)]

    if bqms_code:
        params.append(bqms_code)
        conditions.append(f"bqms_code = ${len(params)}")

    if maker:
        params.append(f"%{maker}%")
        conditions.append(f"maker ILIKE ${len(params)}")

    return " AND ".join(conditions), params


def build_xnk_filters(
    *,
    months: int,
    bqms_code: str | None,
    maker: str | None,
) -> tuple[str, list[Any]]:
    conditions = [f"{XNK_DATE_SQL} >= CURRENT_DATE - ($1 || ' months')::interval"]
    params: list[Any] = [str(months)]

    if bqms_code:
        params.append(bqms_code)
        conditions.append(f"bqms_code = ${len(params)}")

    if maker:
        params.append(f"%{maker}%")
        conditions.append(f"maker ILIKE ${len(params)}")

    return " AND ".join(conditions), params


def confidence_state(sample_size: int, coverage: float) -> tuple[str, str]:
    if sample_size < 10:
        return ("low", "Mẫu còn mỏng, chỉ nên xem để định hướng.")
    if coverage < 0.35:
        return ("medium", "Độ phủ dữ liệu còn hạn chế, cần đọc thận trọng.")
    return ("high", "Đủ mẫu và độ phủ để dùng cho phân tích vận hành.")


def safe_pct(numerator: int | float, denominator: int | float) -> float:
    if not denominator:
        return 0.0
    return round((float(numerator) / float(denominator)) * 100, 1)


def median_or_none(values: list[float]) -> float | None:
    if not values:
        return None
    return float(median(values))


# ─── Overview ─────────────────────────────────────────────────

@router.get("/overview")
async def price_overview(
    months: int = Query(6, ge=1, le=24),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "director")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Get price analytics overview KPIs."""
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) as total_rfq,
            COUNT(*) FILTER (WHERE result::text ILIKE '%won%') as won_count,
            COUNT(*) FILTER (WHERE result::text ILIKE '%lost%' OR result::text ILIKE '%lose%') as lost_count,
            COUNT(*) FILTER (WHERE result IS NULL OR result::text = '') as pending_count,
            ROUND(
                COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::numeric
                / NULLIF(COUNT(*) FILTER (WHERE result::text ILIKE '%won%' OR result::text ILIKE '%lost%' OR result::text ILIKE '%lose%'), 0)
                * 100, 1
            ) as win_rate,
            ROUND(AVG(COALESCE(quoted_price_bqms_v1, 0))::numeric, 0) as avg_price_v1,
            COUNT(DISTINCT maker) as unique_makers,
            COUNT(DISTINCT bqms_code) as unique_parts
        FROM bqms_rfq
        WHERE created_at >= NOW() - ($1 || ' months')::interval
        """,
        str(months),
    )
    return {"data": dict(row) if row else {}}


# ─── By Maker ────────────────────────────────────────────────

@router.get("/by-maker")
async def price_by_maker(
    months: int = Query(6, ge=1, le=24),
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "director")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Win/loss breakdown by maker/manufacturer."""
    rows = await conn.fetch(
        """
        SELECT
            COALESCE(maker, 'Không rõ') as maker,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE result::text ILIKE '%won%') as won,
            COUNT(*) FILTER (WHERE result::text ILIKE '%lost%' OR result::text ILIKE '%lose%') as lost,
            ROUND(
                COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::numeric
                / NULLIF(COUNT(*), 0) * 100, 1
            ) as win_rate,
            ROUND(AVG(COALESCE(quoted_price_bqms_v1, 0))::numeric, 0) as avg_price
        FROM bqms_rfq
        WHERE created_at >= NOW() - ($1 || ' months')::interval
        GROUP BY maker
        ORDER BY total DESC
        LIMIT $2
        """,
        str(months), limit,
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/intelligence")
async def price_intelligence(
    bqms_code: str | None = None,
    maker: str | None = None,
    months: int = Query(12, ge=3, le=36),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "director")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Read-only price intelligence hub backed by trusted RFQ and XNK sources."""
    rfq_where, rfq_params = build_rfq_filters(months=months, bqms_code=bqms_code, maker=maker)
    xnk_where, xnk_params = build_xnk_filters(months=months, bqms_code=bqms_code, maker=maker)

    rfq_stats = await conn.fetchrow(
        f"""
        SELECT
            COUNT(*)::int AS total_rows,
            COUNT(*) FILTER (WHERE quoted_price_bqms_v1 > 0)::int AS priced_v1_rows,
            COUNT(*) FILTER (WHERE quoted_price_bqms_v4 > 0)::int AS priced_v4_rows,
            COUNT(*) FILTER (WHERE purchase_price_vnd > 0)::int AS purchase_rows,
            COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::int AS won_rows,
            COUNT(DISTINCT bqms_code)::int AS unique_codes,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS median_v1,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v4) FILTER (WHERE quoted_price_bqms_v4 > 0))::numeric, 0) AS median_v4,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY purchase_price_vnd) FILTER (WHERE purchase_price_vnd > 0))::numeric, 0) AS median_purchase_vnd,
            MAX({RFQ_DATE_SQL}) AS latest_date
        FROM bqms_rfq
        WHERE {rfq_where}
        """,
        *rfq_params,
    )

    xnk_stats = await conn.fetchrow(
        f"""
        SELECT
            COUNT(*)::int AS total_rows,
            COUNT(*) FILTER (WHERE price_vnd > 0)::int AS priced_vnd_rows,
            COUNT(*) FILTER (WHERE price_usd > 0)::int AS priced_usd_rows,
            COUNT(DISTINCT bqms_code)::int AS unique_codes,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) FILTER (WHERE price_vnd > 0))::numeric, 0) AS median_vnd,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_usd) FILTER (WHERE price_usd > 0))::numeric, 2) AS median_usd,
            MAX({XNK_DATE_SQL}) AS latest_date
        FROM xnk_price_lookup
        WHERE {xnk_where}
        """,
        *xnk_params,
    )

    rfq_month_rows = await conn.fetch(
        f"""
        SELECT
            TO_CHAR(DATE_TRUNC('month', {RFQ_DATE_SQL}), 'YYYY-MM') AS month_key,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS internal_median_v1,
            COUNT(*) FILTER (WHERE quoted_price_bqms_v1 > 0)::int AS internal_priced_rows
        FROM bqms_rfq
        WHERE {rfq_where}
        GROUP BY 1
        ORDER BY 1
        """,
        *rfq_params,
    )

    xnk_month_rows = await conn.fetch(
        f"""
        SELECT
            TO_CHAR(DATE_TRUNC('month', {XNK_DATE_SQL}), 'YYYY-MM') AS month_key,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) FILTER (WHERE price_vnd > 0))::numeric, 0) AS market_median_vnd,
            COUNT(*) FILTER (WHERE price_vnd > 0)::int AS market_priced_rows
        FROM xnk_price_lookup
        WHERE {xnk_where}
        GROUP BY 1
        ORDER BY 1
        """,
        *xnk_params,
    )

    rfq_maker_rows = await conn.fetch(
        f"""
        SELECT
            {NORMALIZED_MAKER_SQL} AS maker_name,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS internal_median_v1,
            COUNT(*) FILTER (WHERE quoted_price_bqms_v1 > 0)::int AS internal_rows
        FROM bqms_rfq
        WHERE {rfq_where}
        GROUP BY 1
        HAVING {NORMALIZED_MAKER_SQL} IS NOT NULL
           AND COUNT(*) FILTER (WHERE quoted_price_bqms_v1 > 0) >= 3
        """,
        *rfq_params,
    )

    xnk_maker_rows = await conn.fetch(
        f"""
        SELECT
            {NORMALIZED_MAKER_SQL} AS maker_name,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) FILTER (WHERE price_vnd > 0))::numeric, 0) AS market_median_vnd,
            COUNT(*) FILTER (WHERE price_vnd > 0)::int AS market_rows
        FROM xnk_price_lookup
        WHERE {xnk_where}
        GROUP BY 1
        HAVING {NORMALIZED_MAKER_SQL} IS NOT NULL
           AND COUNT(*) FILTER (WHERE price_vnd > 0) >= 3
        """,
        *xnk_params,
    )

    rfq_code_rows = await conn.fetch(
        f"""
        SELECT
            bqms_code,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS internal_median_v1,
            COUNT(*) FILTER (WHERE quoted_price_bqms_v1 > 0)::int AS internal_rows,
            MAX({RFQ_DATE_SQL}) AS latest_rfq_date
        FROM bqms_rfq
        WHERE {rfq_where}
          AND bqms_code IS NOT NULL
          AND BTRIM(bqms_code) != ''
        GROUP BY bqms_code
        HAVING COUNT(*) FILTER (WHERE quoted_price_bqms_v1 > 0) > 0
        """,
        *rfq_params,
    )

    xnk_code_rows = await conn.fetch(
        f"""
        SELECT
            bqms_code,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) FILTER (WHERE price_vnd > 0))::numeric, 0) AS market_median_vnd,
            COUNT(*) FILTER (WHERE price_vnd > 0)::int AS market_rows,
            MAX({XNK_DATE_SQL}) AS latest_market_date
        FROM xnk_price_lookup
        WHERE {xnk_where}
          AND bqms_code IS NOT NULL
          AND BTRIM(bqms_code) != ''
        GROUP BY bqms_code
        HAVING COUNT(*) FILTER (WHERE price_vnd > 0) > 0
        """,
        *xnk_params,
    )

    won_stats = dict(
        await conn.fetchrow(
            """
            SELECT
                COUNT(*)::int AS row_count,
                COUNT(*) FILTER (WHERE po_price > 0)::int AS priced_rows,
                MAX(po_deadline) AS latest_date
            FROM bqms_won_quotations
            """
        )
        or {}
    )

    delivery_stats = dict(
        await conn.fetchrow(
            """
            SELECT
                COUNT(*)::int AS row_count,
                COUNT(*) FILTER (WHERE unit_price > 0)::int AS priced_rows,
                MAX(delivery_date) AS latest_date
            FROM bqms_deliveries
            """
        )
        or {}
    )

    rfq_stats_dict = dict(rfq_stats or {})
    xnk_stats_dict = dict(xnk_stats or {})

    month_map: dict[str, dict[str, Any]] = {}
    for row in rfq_month_rows:
        month_map[row["month_key"]] = {
            "month": row["month_key"],
            "internal_median_v1": float(row["internal_median_v1"]) if row["internal_median_v1"] is not None else None,
            "market_median_vnd": None,
            "internal_priced_rows": row["internal_priced_rows"],
            "market_priced_rows": 0,
        }
    for row in xnk_month_rows:
        month_entry = month_map.setdefault(
            row["month_key"],
            {
                "month": row["month_key"],
                "internal_median_v1": None,
                "market_median_vnd": None,
                "internal_priced_rows": 0,
                "market_priced_rows": 0,
            },
        )
        month_entry["market_median_vnd"] = float(row["market_median_vnd"]) if row["market_median_vnd"] is not None else None
        month_entry["market_priced_rows"] = row["market_priced_rows"]

    rfq_maker_map = {row["maker_name"]: row for row in rfq_maker_rows if row["maker_name"]}
    xnk_maker_map = {row["maker_name"]: row for row in xnk_maker_rows if row["maker_name"]}
    shared_makers = sorted(
        set(rfq_maker_map.keys()) & set(xnk_maker_map.keys()),
        key=lambda name: (
            -(
                (rfq_maker_map[name]["internal_rows"] or 0)
                + (xnk_maker_map[name]["market_rows"] or 0)
            ),
            name,
        ),
    )[:8]

    maker_compare = []
    for maker_name in shared_makers:
        rfq_row = rfq_maker_map[maker_name]
        xnk_row = xnk_maker_map[maker_name]
        internal_price = float(rfq_row["internal_median_v1"]) if rfq_row["internal_median_v1"] is not None else None
        market_price = float(xnk_row["market_median_vnd"]) if xnk_row["market_median_vnd"] is not None else None
        gap_pct = None
        if internal_price and market_price:
            gap_pct = round(((internal_price - market_price) / market_price) * 100, 1)
        maker_compare.append(
            {
                "maker_name": maker_name,
                "internal_median_v1": internal_price,
                "market_median_vnd": market_price,
                "internal_rows": rfq_row["internal_rows"],
                "market_rows": xnk_row["market_rows"],
                "gap_pct": gap_pct,
            }
        )

    rfq_code_map = {row["bqms_code"]: row for row in rfq_code_rows if row["bqms_code"]}
    xnk_code_map = {row["bqms_code"]: row for row in xnk_code_rows if row["bqms_code"]}
    shared_codes = sorted(
        set(rfq_code_map.keys()) & set(xnk_code_map.keys()),
        key=lambda code: (
            -(max(
                rfq_code_map[code]["latest_rfq_date"] or datetime.min.date(),
                xnk_code_map[code]["latest_market_date"] or datetime.min.date(),
            ).toordinal()),
            code,
        ),
    )[:12]

    matched_bqms = []
    gap_samples: list[float] = []
    for code in shared_codes:
        rfq_row = rfq_code_map[code]
        xnk_row = xnk_code_map[code]
        internal_price = float(rfq_row["internal_median_v1"]) if rfq_row["internal_median_v1"] is not None else None
        market_price = float(xnk_row["market_median_vnd"]) if xnk_row["market_median_vnd"] is not None else None
        gap_pct = None
        if internal_price and market_price:
            gap_pct = round(((internal_price - market_price) / market_price) * 100, 1)
            gap_samples.append(gap_pct)
        matched_bqms.append(
            {
                "bqms_code": code,
                "internal_median_v1": internal_price,
                "market_median_vnd": market_price,
                "internal_rows": rfq_row["internal_rows"],
                "market_rows": xnk_row["market_rows"],
                "latest_rfq_date": rfq_row["latest_rfq_date"],
                "latest_market_date": xnk_row["latest_market_date"],
                "gap_pct": gap_pct,
            }
        )

    rfq_priced_rows = rfq_stats_dict.get("priced_v1_rows", 0) or 0
    xnk_priced_rows = xnk_stats_dict.get("priced_vnd_rows", 0) or 0
    matched_codes = len(matched_bqms)
    rfq_coverage = safe_pct(rfq_priced_rows, rfq_stats_dict.get("total_rows", 0) or 0)
    xnk_coverage = safe_pct(xnk_priced_rows, xnk_stats_dict.get("total_rows", 0) or 0)
    match_rate = safe_pct(
        matched_codes,
        min(rfq_stats_dict.get("unique_codes", 0) or 0, xnk_stats_dict.get("unique_codes", 0) or 0),
    )
    benchmark_confidence, benchmark_reason = confidence_state(matched_codes, min(rfq_coverage, xnk_coverage) / 100)

    sources = [
        {
            "key": "bqms_rfq",
            "name": "Báo giá BQMS",
            "status": "active",
            "reliability": "high",
            "reason": "Có mã BQMS, ngày hỏi hàng và giá báo V1 rõ ràng để làm chuẩn nội bộ.",
            "row_count": rfq_stats_dict.get("total_rows", 0) or 0,
            "priced_rows": rfq_priced_rows,
            "coverage_pct": rfq_coverage,
            "latest_date": rfq_stats_dict.get("latest_date"),
        },
        {
            "key": "xnk_lookup",
            "name": "TT XNK / giá thị trường",
            "status": "active",
            "reliability": "high",
            "reason": "Là nguồn benchmark thị trường theo mã BQMS với giá VND/USD và ngày RFQ thật.",
            "row_count": xnk_stats_dict.get("total_rows", 0) or 0,
            "priced_rows": xnk_priced_rows,
            "coverage_pct": xnk_coverage,
            "latest_date": xnk_stats_dict.get("latest_date"),
        },
        {
            "key": "won_quotations",
            "name": "Báo giá trúng",
            "status": "held_out",
            "reliability": "medium",
            "reason": "Có giá PO và số lượng nhưng chưa đủ chắc để trộn trực tiếp vào benchmark giá chung.",
            "row_count": won_stats.get("row_count", 0),
            "priced_rows": won_stats.get("priced_rows", 0),
            "latest_date": won_stats.get("latest_date"),
        },
        {
            "key": "deliveries",
            "name": "Giao hàng BQMS",
            "status": "held_out",
            "reliability": "medium",
            "reason": "Phù hợp cho phân tích thực thi đơn hàng, chưa nên gộp vào mặt bằng giá chào.",
            "row_count": delivery_stats.get("row_count", 0),
            "priced_rows": delivery_stats.get("priced_rows", 0),
            "latest_date": delivery_stats.get("latest_date"),
        },
    ]

    return {
        "filters": {
            "bqms_code": bqms_code,
            "maker": maker,
            "months": months,
            "time_axis": {
                "rfq": RFQ_DATE_SQL,
                "xnk": XNK_DATE_SQL,
            },
        },
        "overview": {
            "internal_median_v1": float(rfq_stats_dict["median_v1"]) if rfq_stats_dict.get("median_v1") is not None else None,
            "internal_median_v4": float(rfq_stats_dict["median_v4"]) if rfq_stats_dict.get("median_v4") is not None else None,
            "internal_purchase_median_vnd": float(rfq_stats_dict["median_purchase_vnd"]) if rfq_stats_dict.get("median_purchase_vnd") is not None else None,
            "market_median_vnd": float(xnk_stats_dict["median_vnd"]) if xnk_stats_dict.get("median_vnd") is not None else None,
            "market_median_usd": float(xnk_stats_dict["median_usd"]) if xnk_stats_dict.get("median_usd") is not None else None,
            "matched_codes": matched_codes,
            "benchmark_match_rate_pct": match_rate,
            "median_gap_pct": median_or_none(gap_samples),
            "latest_internal_date": rfq_stats_dict.get("latest_date"),
            "latest_market_date": xnk_stats_dict.get("latest_date"),
        },
        "data_quality": {
            "rfq_coverage_pct": rfq_coverage,
            "xnk_coverage_pct": xnk_coverage,
            "benchmark_confidence": benchmark_confidence,
            "benchmark_reason": benchmark_reason,
            "matched_code_count": matched_codes,
            "internal_code_count": rfq_stats_dict.get("unique_codes", 0) or 0,
            "market_code_count": xnk_stats_dict.get("unique_codes", 0) or 0,
        },
        "sources": sources,
        "monthly_compare": sorted(month_map.values(), key=lambda item: item["month"]),
        "maker_compare": maker_compare,
        "matched_bqms": matched_bqms,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ─── By Owner ────────────────────────────────────────────────

@router.get("/by-owner")
async def price_by_owner(
    months: int = Query(6, ge=1, le=24),
    token_data: TokenData = Depends(require_role("admin", "manager", "director")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Performance breakdown by quotation owner (person_in_charge)."""
    rows = await conn.fetch(
        """
        SELECT
            COALESCE(person_in_charge_name, 'Không rõ') as owner,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE result::text ILIKE '%won%') as won,
            COUNT(*) FILTER (WHERE result::text ILIKE '%lost%' OR result::text ILIKE '%lose%') as lost,
            ROUND(
                COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::numeric
                / NULLIF(COUNT(*) FILTER (WHERE result IS NOT NULL AND result::text != ''), 0) * 100, 1
            ) as win_rate,
            ROUND(AVG(COALESCE(quoted_price_bqms_v1, 0))::numeric, 0) as avg_v1,
            ROUND(AVG(COALESCE(quoted_price_bqms_v4, 0))::numeric, 0) as avg_v4
        FROM bqms_rfq
        WHERE created_at >= NOW() - ($1 || ' months')::interval
        GROUP BY person_in_charge_name
        ORDER BY total DESC
        """,
        str(months),
    )
    return {"data": [dict(r) for r in rows]}


# ─── Price Trends ─────────────────────────────────────────────

@router.get("/price-trends")
async def price_trends(
    bqms_code: str | None = None,
    maker: str | None = None,
    months: int = Query(12, ge=1, le=36),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "director")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Price versioning trends v1→v4 over time, filterable by code or maker."""
    conditions = ["created_at >= NOW() - ($1 || ' months')::interval"]
    params: list[Any] = [str(months)]

    if bqms_code:
        params.append(bqms_code)
        conditions.append(f"bqms_code = ${len(params)}")
    if maker:
        params.append(f"%{maker}%")
        conditions.append(f"maker ILIKE ${len(params)}")

    where = " AND ".join(conditions)

    rows = await conn.fetch(
        f"""
        SELECT
            bqms_code,
            specification,
            maker,
            quoted_price_bqms_v1,
            quoted_price_bqms_v2,
            quoted_price_bqms_v3,
            quoted_price_bqms_v4,
            result::text as result,
            created_at
        FROM bqms_rfq
        WHERE {where}
        ORDER BY created_at DESC
        LIMIT 500
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows]}


# ─── Loss Reasons ─────────────────────────────────────────────

@router.get("/loss-reasons")
async def loss_reasons(
    months: int = Query(6, ge=1, le=24),
    token_data: TokenData = Depends(require_role("admin", "manager", "director")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Analyze loss reasons from lost quotations."""
    rows = await conn.fetch(
        """
        SELECT
            COALESCE(notes, 'Không có ghi chú') as reason,
            COUNT(*) as count,
            ROUND(AVG(COALESCE(quoted_price_bqms_v1, 0))::numeric, 0) as avg_our_price
        FROM bqms_rfq
        WHERE (result::text ILIKE '%lost%' OR result::text ILIKE '%lose%')
          AND created_at >= NOW() - ($1 || ' months')::interval
        GROUP BY notes
        ORDER BY count DESC
        LIMIT 20
        """,
        str(months),
    )
    return {"data": [dict(r) for r in rows]}
