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

import statistics
from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

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


def _inter_arrival_stats(dates: list[date]) -> dict[str, Any]:
    if len(dates) < 2:
        return {"avg_days": None, "stddev_days": None, "cv_pct": None, "confidence": "low"}
    diffs = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
    avg = sum(diffs) / len(diffs)
    stddev = statistics.stdev(diffs) if len(diffs) >= 2 else 0.0
    cv = (stddev / avg) if avg > 0 else float("inf")
    if cv < 0.3:
        confidence = "high"
    elif cv < 0.6:
        confidence = "medium"
    else:
        confidence = "low"
    return {
        "avg_days": round(avg, 1),
        "stddev_days": round(stddev, 1),
        "cv_pct": round(cv * 100, 1) if cv != float("inf") else None,
        "confidence": confidence,
    }


def _linear_regression(series: list[float]) -> dict[str, float]:
    n = len(series)
    if n < 2:
        return {"slope": 0.0, "intercept": float(series[0]) if series else 0.0, "r_squared": 0.0}
    x = list(range(n))
    mean_x = sum(x) / n
    mean_y = sum(series) / n
    num = sum((x[i] - mean_x) * (series[i] - mean_y) for i in range(n))
    den = sum((x[i] - mean_x) ** 2 for i in range(n))
    slope = num / den if den > 0 else 0.0
    intercept = mean_y - slope * mean_x
    ss_res = sum((series[i] - (intercept + slope * x[i])) ** 2 for i in range(n))
    ss_tot = sum((series[i] - mean_y) ** 2 for i in range(n))
    r2 = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    return {"slope": slope, "intercept": intercept, "r_squared": max(0.0, min(1.0, r2))}


def _ewma(series: list[float], alpha: float = 0.3) -> list[float]:
    if not series:
        return []
    smoothed = [float(series[0])]
    for value in series[1:]:
        smoothed.append(alpha * float(value) + (1 - alpha) * smoothed[-1])
    return smoothed


def _forecast_confidence(score: float, *, high: float = 0.5, medium: float = 0.2) -> str:
    if score > high:
        return "high"
    if score > medium:
        return "medium"
    return "low"


def _next_month(base: date, n: int) -> date:
    month_idx = base.month + n
    year = base.year + (month_idx - 1) // 12
    month = ((month_idx - 1) % 12) + 1
    return date(year, month, 1)


def _seasonal_skeleton() -> list[dict[str, Any]]:
    return [
        {"month": m, "rfq_count": 0, "won_count": 0, "median_v1": None}
        for m in range(1, 13)
    ]


def _build_monthly_skeleton(months: int, today: date) -> list[str]:
    base = date(today.year, today.month, 1)
    labels: list[str] = []
    for i in range(months - 1, -1, -1):
        d = _next_month(base, -i)
        labels.append(f"{d.year}-{d.month:02d}")
    return labels


# ─── Overview ─────────────────────────────────────────────────

@router.get("/overview")
async def price_overview(
    months: int = Query(6, ge=1, le=24),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "director", allow_viewer=False)),
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
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "director", allow_viewer=False)),
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
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "director", allow_viewer=False)),
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
    token_data: TokenData = Depends(require_role("admin", "manager", "director", allow_viewer=False)),
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
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "director", allow_viewer=False)),
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


# ─── Business Pulse (Manager/Director dashboard) ─────────────

@router.get("/business-pulse")
async def business_pulse(
    months: int = Query(12, ge=3, le=24),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "director", allow_viewer=False)),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Compact dashboard data: current month vs prev + 12M trend.

    Trả lời: "Tháng này kinh doanh đánh giá thế nào?"
    """
    pulse_rows = await conn.fetch(
        f"""
        SELECT
            TO_CHAR(DATE_TRUNC('month', {RFQ_DATE_SQL}), 'YYYY-MM') AS month_key,
            COUNT(*)::int AS rfq_count,
            COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::int AS won_count,
            COUNT(*) FILTER (WHERE result::text ILIKE '%lost%' OR result::text ILIKE '%lose%')::int AS lost_count,
            COUNT(DISTINCT bqms_code) FILTER (WHERE bqms_code IS NOT NULL)::int AS unique_codes,
            COUNT(DISTINCT maker) FILTER (WHERE maker IS NOT NULL)::int AS unique_makers,
            COALESCE(SUM(quoted_price_bqms_v1 * COALESCE(expected_qty, 1)) FILTER (WHERE quoted_price_bqms_v1 > 0), 0)::numeric AS gmv_v1,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS median_v1
        FROM bqms_rfq
        WHERE {RFQ_DATE_SQL} >= CURRENT_DATE - ($1 || ' months')::interval
        GROUP BY 1
        ORDER BY 1
        """,
        str(months),
    )
    market_rows = await conn.fetch(
        f"""
        SELECT
            TO_CHAR(DATE_TRUNC('month', {XNK_DATE_SQL}), 'YYYY-MM') AS month_key,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) FILTER (WHERE price_vnd > 0))::numeric, 0) AS market_median_vnd
        FROM xnk_price_lookup
        WHERE {XNK_DATE_SQL} >= CURRENT_DATE - ($1 || ' months')::interval
        GROUP BY 1
        """,
        str(months),
    )
    market_map = {row["month_key"]: row["market_median_vnd"] for row in market_rows}

    today = date.today()
    base = date(today.year, today.month, 1)
    series: list[dict[str, Any]] = []
    pulse_map = {row["month_key"]: row for row in pulse_rows}
    for i in range(months - 1, -1, -1):
        d = _next_month(base, -i)
        key = f"{d.year}-{d.month:02d}"
        row = pulse_map.get(key)
        rfq_count = row["rfq_count"] if row else 0
        won = row["won_count"] if row else 0
        lost = row["lost_count"] if row else 0
        decided = won + lost
        win_rate = safe_pct(won, decided) if decided else 0.0
        market_median = market_map.get(key)
        median_v1 = float(row["median_v1"]) if row and row["median_v1"] is not None else None
        gap_pct = None
        if median_v1 and market_median:
            gap_pct = round(((median_v1 - float(market_median)) / float(market_median)) * 100, 1)
        series.append({
            "month_key": key,
            "rfq_count": rfq_count,
            "won_count": won,
            "lost_count": lost,
            "pending_count": max(0, rfq_count - won - lost),
            "win_rate_pct": win_rate,
            "unique_codes": row["unique_codes"] if row else 0,
            "unique_makers": row["unique_makers"] if row else 0,
            "gmv_v1_vnd": float(row["gmv_v1"]) if row and row["gmv_v1"] else 0.0,
            "median_v1_vnd": median_v1,
            "market_median_vnd": float(market_median) if market_median is not None else None,
            "gap_pct": gap_pct,
        })

    def _delta_pct(curr: float | None, prev: float | None) -> float | None:
        if curr is None or prev is None or prev == 0:
            return None
        return round(((curr - prev) / prev) * 100, 1)

    current = series[-1] if series else None
    previous = series[-2] if len(series) >= 2 else None
    deltas: dict[str, float | None] = {}
    if current and previous:
        for key in ("rfq_count", "won_count", "win_rate_pct", "gmv_v1_vnd", "unique_codes", "unique_makers"):
            deltas[f"{key}_delta_pct"] = _delta_pct(current.get(key), previous.get(key))

    top_makers = await conn.fetch(
        f"""
        SELECT
            {NORMALIZED_MAKER_SQL} AS maker_name,
            COUNT(*)::int AS rfq_count,
            COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::int AS won_count,
            COUNT(*) FILTER (WHERE result::text ILIKE '%lost%' OR result::text ILIKE '%lose%')::int AS lost_count,
            COALESCE(SUM(quoted_price_bqms_v1 * COALESCE(expected_qty, 1)) FILTER (WHERE quoted_price_bqms_v1 > 0), 0)::numeric AS gmv_v1,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS median_v1
        FROM bqms_rfq
        WHERE {RFQ_DATE_SQL} >= CURRENT_DATE - INTERVAL '1 month'
          AND maker IS NOT NULL
        GROUP BY 1
        HAVING COUNT(*) >= 2 AND {NORMALIZED_MAKER_SQL} IS NOT NULL
        ORDER BY gmv_v1 DESC NULLS LAST
        LIMIT 6
        """,
    )
    top_makers_out = []
    for row in top_makers:
        decided = (row["won_count"] or 0) + (row["lost_count"] or 0)
        top_makers_out.append({
            "maker_name": row["maker_name"],
            "rfq_count": row["rfq_count"],
            "won_count": row["won_count"],
            "lost_count": row["lost_count"],
            "win_rate_pct": safe_pct(row["won_count"], decided) if decided else 0.0,
            "gmv_v1_vnd": float(row["gmv_v1"]) if row["gmv_v1"] else 0.0,
            "median_v1_vnd": float(row["median_v1"]) if row["median_v1"] is not None else None,
        })

    # Attention list: codes where V1 > market by 20%+ in last 3 months
    attention = await conn.fetch(
        f"""
        WITH internal AS (
            SELECT bqms_code,
                ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS v1_median,
                COUNT(*)::int AS rfq_count,
                MAX({RFQ_DATE_SQL}) AS last_seen
            FROM bqms_rfq
            WHERE {RFQ_DATE_SQL} >= CURRENT_DATE - INTERVAL '3 months'
              AND bqms_code IS NOT NULL
              AND quoted_price_bqms_v1 > 0
            GROUP BY bqms_code
        ),
        market AS (
            SELECT bqms_code,
                ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) FILTER (WHERE price_vnd > 0))::numeric, 0) AS market_median
            FROM xnk_price_lookup
            WHERE bqms_code IS NOT NULL AND price_vnd > 0
            GROUP BY bqms_code
        )
        SELECT
            i.bqms_code,
            i.v1_median,
            m.market_median,
            i.rfq_count,
            i.last_seen,
            ROUND(((i.v1_median - m.market_median) / NULLIF(m.market_median, 0) * 100)::numeric, 1) AS gap_pct
        FROM internal i
        JOIN market m USING (bqms_code)
        WHERE m.market_median > 0
          AND ((i.v1_median - m.market_median) / m.market_median) >= 0.20
        ORDER BY gap_pct DESC
        LIMIT 12
        """,
    )
    attention_out = [
        {
            "bqms_code": row["bqms_code"],
            "v1_median": float(row["v1_median"]) if row["v1_median"] is not None else None,
            "market_median": float(row["market_median"]) if row["market_median"] is not None else None,
            "rfq_count": row["rfq_count"],
            "last_seen": row["last_seen"],
            "gap_pct": float(row["gap_pct"]) if row["gap_pct"] is not None else None,
        }
        for row in attention
    ]

    # Fresh codes: codes inquired in last 14 days
    fresh = await conn.fetch(
        f"""
        SELECT
            bqms_code,
            MAX(specification) FILTER (WHERE specification IS NOT NULL) AS specification,
            MAX(maker) FILTER (WHERE maker IS NOT NULL) AS maker,
            COUNT(*)::int AS rfq_count,
            MAX({RFQ_DATE_SQL}) AS last_seen,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS v1_median
        FROM bqms_rfq
        WHERE {RFQ_DATE_SQL} >= CURRENT_DATE - INTERVAL '14 days'
          AND bqms_code IS NOT NULL
        GROUP BY bqms_code
        ORDER BY last_seen DESC NULLS LAST
        LIMIT 12
        """,
    )
    fresh_out = [
        {
            "bqms_code": row["bqms_code"],
            "specification": row["specification"],
            "maker": row["maker"],
            "rfq_count": row["rfq_count"],
            "last_seen": row["last_seen"],
            "v1_median": float(row["v1_median"]) if row["v1_median"] is not None else None,
        }
        for row in fresh
    ]

    return {
        "data": {
            "months": months,
            "current": current,
            "previous": previous,
            "deltas": deltas,
            "trend_12m": series,
            "top_makers_30d": top_makers_out,
            "attention_codes": attention_out,
            "fresh_codes_14d": fresh_out,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    }


# ─── Code History (single BQMS code deep dive) ──────────────

@router.get("/code-history/{bqms_code}")
async def code_history(
    bqms_code: str,
    months: int = Query(12, ge=3, le=36),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "director", allow_viewer=False)),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Full statistics + forecast for a single BQMS code.

    Joins bqms_rfq + staging.raw_json + bqms_samsung_po + bqms_deliveries + xnk_price_lookup.
    """
    summary_row = await conn.fetchrow(
        f"""
        SELECT
            MAX(specification) FILTER (WHERE specification IS NOT NULL) AS specification,
            MAX(maker) FILTER (WHERE maker IS NOT NULL) AS maker,
            MIN({RFQ_DATE_SQL}) AS first_seen,
            MAX({RFQ_DATE_SQL}) AS last_seen,
            COUNT(*)::int AS total_rfq_count,
            COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::int AS total_won_count,
            COUNT(*) FILTER (WHERE result::text ILIKE '%lost%' OR result::text ILIKE '%lose%')::int AS total_lost_count
        FROM bqms_rfq
        WHERE bqms_code = $1
        """,
        bqms_code,
    )

    if not summary_row or (summary_row["total_rfq_count"] or 0) == 0:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy RFQ nào cho mã {bqms_code}")

    total = summary_row["total_rfq_count"] or 0
    won = summary_row["total_won_count"] or 0
    lost = summary_row["total_lost_count"] or 0
    pending = max(0, total - won - lost)
    win_rate = safe_pct(won, won + lost) if (won + lost) > 0 else 0.0

    ctr_type = await conn.fetchval(
        """
        SELECT mode() WITHIN GROUP (ORDER BY ctr)
        FROM (
            SELECT DISTINCT ON (s.rfq_number) s.raw_json->>'ctrTypeNm' AS ctr
            FROM bqms_vendor_portal_staging s
            WHERE s.rfq_number IN (SELECT rfq_number FROM bqms_rfq WHERE bqms_code = $1)
              AND s.raw_json->>'ctrTypeNm' IS NOT NULL
            ORDER BY s.rfq_number, s.id DESC
        ) t
        """,
        bqms_code,
    )

    summary = {
        "specification": summary_row["specification"],
        "maker": summary_row["maker"],
        "ctr_type": ctr_type,
        "first_seen": summary_row["first_seen"],
        "last_seen": summary_row["last_seen"],
        "total_rfq_count": total,
        "total_won_count": won,
        "total_lost_count": lost,
        "total_pending_count": pending,
        "win_rate_pct": win_rate,
    }

    arrival_rows = await conn.fetch(
        f"""
        SELECT {RFQ_DATE_SQL} AS d
        FROM bqms_rfq
        WHERE bqms_code = $1 AND {RFQ_DATE_SQL} IS NOT NULL
        ORDER BY d
        """,
        bqms_code,
    )
    arrival_dates = [r["d"] for r in arrival_rows]

    today = date.today()
    cutoff_12 = today - timedelta(days=365)
    cutoff_6 = today - timedelta(days=182)
    cutoff_3 = today - timedelta(days=91)

    inter_arrival = _inter_arrival_stats(arrival_dates)
    next_expected_date = None
    if arrival_dates and inter_arrival["avg_days"]:
        next_expected_date = arrival_dates[-1] + timedelta(days=int(inter_arrival["avg_days"]))

    frequency = {
        "rfq_count_12m": sum(1 for d in arrival_dates if d >= cutoff_12),
        "rfq_count_6m": sum(1 for d in arrival_dates if d >= cutoff_6),
        "rfq_count_3m": sum(1 for d in arrival_dates if d >= cutoff_3),
        "inter_arrival_days_avg": inter_arrival["avg_days"],
        "inter_arrival_days_stddev": inter_arrival["stddev_days"],
        "cv_pct": inter_arrival["cv_pct"],
        "next_expected_date": next_expected_date,
        "next_expected_confidence": inter_arrival["confidence"],
    }

    pricing_row = await conn.fetchrow(
        """
        SELECT
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS v1_median,
            MIN(quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0) AS v1_min,
            MAX(quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0) AS v1_max,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v4) FILTER (WHERE quoted_price_bqms_v4 > 0))::numeric, 0) AS v4_median,
            MIN(quoted_price_bqms_v4) FILTER (WHERE quoted_price_bqms_v4 > 0) AS v4_min,
            MAX(quoted_price_bqms_v4) FILTER (WHERE quoted_price_bqms_v4 > 0) AS v4_max,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY expected_qty) FILTER (WHERE expected_qty > 0))::numeric, 0) AS qty_median,
            MIN(expected_qty) FILTER (WHERE expected_qty > 0) AS qty_min,
            MAX(expected_qty) FILTER (WHERE expected_qty > 0) AS qty_max
        FROM bqms_rfq
        WHERE bqms_code = $1
        """,
        bqms_code,
    )

    won_pricing_row = await conn.fetchrow(
        """
        SELECT
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE unit_price > 0))::numeric, 0) AS won_median,
            MIN(unit_price) FILTER (WHERE unit_price > 0) AS won_min,
            MAX(unit_price) FILTER (WHERE unit_price > 0) AS won_max,
            COUNT(*) FILTER (WHERE unit_price > 0)::int AS won_count
        FROM bqms_samsung_po
        WHERE bqms_code = $1
        """,
        bqms_code,
    )

    market_row = await conn.fetchrow(
        """
        SELECT
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) FILTER (WHERE price_vnd > 0))::numeric, 0) AS market_median_vnd,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_usd) FILTER (WHERE price_usd > 0))::numeric, 2) AS market_median_usd,
            COUNT(*) FILTER (WHERE price_vnd > 0)::int AS market_rows
        FROM xnk_price_lookup
        WHERE bqms_code = $1
        """,
        bqms_code,
    )

    delivery_row = await conn.fetchrow(
        """
        SELECT
            SUM(COALESCE(actual_delivered_qty, quantity))::numeric AS delivered_qty_total,
            SUM(COALESCE(total_delivered_value_vnd, amount))::numeric AS delivered_value_total
        FROM bqms_deliveries
        WHERE bqms_code = $1
        """,
        bqms_code,
    )

    v1_med = float(pricing_row["v1_median"]) if pricing_row and pricing_row["v1_median"] is not None else None
    v4_med = float(pricing_row["v4_median"]) if pricing_row and pricing_row["v4_median"] is not None else None
    won_med = float(won_pricing_row["won_median"]) if won_pricing_row and won_pricing_row["won_median"] is not None else None
    market_med = float(market_row["market_median_vnd"]) if market_row and market_row["market_median_vnd"] is not None else None

    v1_vs_won = None
    if v1_med and won_med:
        v1_vs_won = round(((won_med - v1_med) / v1_med) * 100, 1)
    won_vs_market = None
    if won_med and market_med:
        won_vs_market = round(((won_med - market_med) / market_med) * 100, 1)

    pricing = {
        "v1_median": v1_med,
        "v1_min": float(pricing_row["v1_min"]) if pricing_row and pricing_row["v1_min"] is not None else None,
        "v1_max": float(pricing_row["v1_max"]) if pricing_row and pricing_row["v1_max"] is not None else None,
        "v4_median": v4_med,
        "v4_min": float(pricing_row["v4_min"]) if pricing_row and pricing_row["v4_min"] is not None else None,
        "v4_max": float(pricing_row["v4_max"]) if pricing_row and pricing_row["v4_max"] is not None else None,
        "won_price_median": won_med,
        "won_price_min": float(won_pricing_row["won_min"]) if won_pricing_row and won_pricing_row["won_min"] is not None else None,
        "won_price_max": float(won_pricing_row["won_max"]) if won_pricing_row and won_pricing_row["won_max"] is not None else None,
        "won_price_count": won_pricing_row["won_count"] if won_pricing_row else 0,
        "market_median_vnd": market_med,
        "market_median_usd": float(market_row["market_median_usd"]) if market_row and market_row["market_median_usd"] is not None else None,
        "market_rows": market_row["market_rows"] if market_row else 0,
        "v1_vs_won_drop_pct": v1_vs_won,
        "won_vs_market_gap_pct": won_vs_market,
    }

    quantity = {
        "expected_qty_median": float(pricing_row["qty_median"]) if pricing_row and pricing_row["qty_median"] is not None else None,
        "expected_qty_min": float(pricing_row["qty_min"]) if pricing_row and pricing_row["qty_min"] is not None else None,
        "expected_qty_max": float(pricing_row["qty_max"]) if pricing_row and pricing_row["qty_max"] is not None else None,
        "delivered_qty_total": float(delivery_row["delivered_qty_total"]) if delivery_row and delivery_row["delivered_qty_total"] is not None else None,
        "delivered_value_vnd_total": float(delivery_row["delivered_value_total"]) if delivery_row and delivery_row["delivered_value_total"] is not None else None,
    }

    dept_rows = await conn.fetch(
        """
        SELECT
            COALESCE(NULLIF(BTRIM(split_part(s.raw_json->>'psinchargeName', '/', 2)), ''), 'Không rõ') AS department,
            COUNT(*)::int AS rfq_count,
            COUNT(*) FILTER (WHERE r.result::text ILIKE '%won%')::int AS won_count,
            COUNT(*) FILTER (WHERE r.result::text ILIKE '%won%' OR r.result::text ILIKE '%lost%' OR r.result::text ILIKE '%lose%')::int AS decided_count,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.quoted_price_bqms_v1) FILTER (WHERE r.quoted_price_bqms_v1 > 0))::numeric, 0) AS median_v1
        FROM bqms_rfq r
        LEFT JOIN LATERAL (
            SELECT raw_json FROM bqms_vendor_portal_staging
            WHERE rfq_number = r.rfq_number
            ORDER BY id DESC LIMIT 1
        ) s ON true
        WHERE r.bqms_code = $1
        GROUP BY 1
        ORDER BY rfq_count DESC
        """,
        bqms_code,
    )
    departments = [
        {
            "department": row["department"],
            "rfq_count": row["rfq_count"],
            "won_count": row["won_count"],
            "win_rate_pct": safe_pct(row["won_count"], row["decided_count"]) if row["decided_count"] else 0.0,
            "median_v1_price": float(row["median_v1"]) if row["median_v1"] is not None else None,
        }
        for row in dept_rows
    ]

    buyer_rows = await conn.fetch(
        """
        SELECT
            COALESCE(NULLIF(BTRIM(buyer_name), ''), 'Không rõ') AS buyer_name,
            COALESCE(NULLIF(BTRIM(plant), ''), '—') AS plant,
            COALESCE(NULLIF(BTRIM(company), ''), '—') AS company,
            COUNT(*)::int AS po_count,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE unit_price > 0))::numeric, 0) AS median_unit_price,
            MAX(po_date) AS last_po_date
        FROM bqms_samsung_po
        WHERE bqms_code = $1
        GROUP BY 1, 2, 3
        ORDER BY po_count DESC
        LIMIT 10
        """,
        bqms_code,
    )
    buyers = [
        {
            "buyer_name": row["buyer_name"],
            "plant": row["plant"],
            "company": row["company"],
            "po_count": row["po_count"],
            "median_unit_price": float(row["median_unit_price"]) if row["median_unit_price"] is not None else None,
            "last_po_date": row["last_po_date"],
        }
        for row in buyer_rows
    ]

    seasonal_rows = await conn.fetch(
        f"""
        SELECT
            EXTRACT(MONTH FROM {RFQ_DATE_SQL})::int AS month,
            COUNT(*)::int AS rfq_count,
            COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::int AS won_count,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS median_v1
        FROM bqms_rfq
        WHERE bqms_code = $1 AND {RFQ_DATE_SQL} IS NOT NULL
        GROUP BY 1
        ORDER BY 1
        """,
        bqms_code,
    )
    seasonal = _seasonal_skeleton()
    for row in seasonal_rows:
        idx = (row["month"] or 1) - 1
        if 0 <= idx < 12:
            seasonal[idx] = {
                "month": row["month"],
                "rfq_count": row["rfq_count"],
                "won_count": row["won_count"],
                "median_v1": float(row["median_v1"]) if row["median_v1"] is not None else None,
            }

    monthly_rows = await conn.fetch(
        f"""
        SELECT
            TO_CHAR(DATE_TRUNC('month', {RFQ_DATE_SQL}), 'YYYY-MM') AS month_key,
            COUNT(*)::int AS rfq_count,
            COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::int AS won_count,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) FILTER (WHERE quoted_price_bqms_v1 > 0))::numeric, 0) AS median_v1
        FROM bqms_rfq
        WHERE bqms_code = $1
          AND {RFQ_DATE_SQL} >= CURRENT_DATE - ($2 || ' months')::interval
        GROUP BY 1
        ORDER BY 1
        """,
        bqms_code, str(months),
    )
    market_monthly_rows = await conn.fetch(
        f"""
        SELECT
            TO_CHAR(DATE_TRUNC('month', {XNK_DATE_SQL}), 'YYYY-MM') AS month_key,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) FILTER (WHERE price_vnd > 0))::numeric, 0) AS market_median_vnd
        FROM xnk_price_lookup
        WHERE bqms_code = $1
          AND {XNK_DATE_SQL} >= CURRENT_DATE - ($2 || ' months')::interval
        GROUP BY 1
        ORDER BY 1
        """,
        bqms_code, str(months),
    )
    market_map = {row["month_key"]: row["market_median_vnd"] for row in market_monthly_rows}

    month_labels = _build_monthly_skeleton(months, today)
    rfq_count_map = {row["month_key"]: row["rfq_count"] for row in monthly_rows}
    won_count_map = {row["month_key"]: row["won_count"] for row in monthly_rows}
    median_v1_map = {row["month_key"]: row["median_v1"] for row in monthly_rows}

    monthly_trend = []
    for label in month_labels:
        market_val = market_map.get(label)
        monthly_trend.append({
            "month_key": label,
            "rfq_count": rfq_count_map.get(label, 0),
            "won_count": won_count_map.get(label, 0),
            "median_v1": float(median_v1_map[label]) if median_v1_map.get(label) is not None else None,
            "market_median_vnd": float(market_val) if market_val is not None else None,
        })

    count_series = [float(item["rfq_count"]) for item in monthly_trend]
    linear = _linear_regression(count_series)
    ewma_series = _ewma(count_series, alpha=0.3)

    linear_next: list[dict[str, Any]] = []
    ewma_next: list[dict[str, Any]] = []
    base_month = date(today.year, today.month, 1)
    for i in range(1, 4):
        future = _next_month(base_month, i)
        label = f"{future.year}-{future.month:02d}"
        idx_future = len(count_series) + i - 1
        predicted_linear = max(0.0, linear["intercept"] + linear["slope"] * idx_future)
        linear_next.append({
            "month_key": label,
            "predicted_count": round(predicted_linear, 2),
            "predicted_count_rounded": int(round(predicted_linear)),
        })
        last_smooth = ewma_series[-1] if ewma_series else 0.0
        ewma_next.append({
            "month_key": label,
            "predicted_count": round(last_smooth, 2),
            "predicted_count_rounded": int(round(last_smooth)),
        })

    ewma_residuals = [count_series[i] - ewma_series[i] for i in range(len(count_series))] if count_series else []
    ewma_score = 0.0
    if len(count_series) >= 3:
        mean_count = sum(count_series) / len(count_series)
        if mean_count > 0:
            res_var = sum(r * r for r in ewma_residuals) / len(ewma_residuals)
            ewma_score = max(0.0, 1.0 - (res_var ** 0.5) / mean_count)

    trend_forecast = {
        "linear": {
            "method": "linear_regression",
            "slope_per_month": round(linear["slope"], 4),
            "intercept": round(linear["intercept"], 4),
            "r_squared": round(linear["r_squared"], 4),
            "confidence": _forecast_confidence(linear["r_squared"]),
            "next_3_months": linear_next,
        },
        "ewma": {
            "method": "ewma",
            "alpha": 0.3,
            "last_smooth": round(ewma_series[-1], 4) if ewma_series else 0.0,
            "fit_score": round(ewma_score, 4),
            "confidence": _forecast_confidence(ewma_score, high=0.7, medium=0.4),
            "next_3_months": ewma_next,
        },
    }

    history_rows = await conn.fetch(
        """
        SELECT
            r.rfq_number,
            COALESCE(r.inquiry_date, r.created_at::date) AS inquiry_date,
            r.quoted_price_bqms_v1,
            r.quoted_price_bqms_v4,
            r.expected_qty,
            r.result::text AS result,
            r.person_in_charge_name,
            COALESCE(NULLIF(BTRIM(split_part(s.raw_json->>'psinchargeName', '/', 2)), ''), 'Không rõ') AS department
        FROM bqms_rfq r
        LEFT JOIN LATERAL (
            SELECT raw_json FROM bqms_vendor_portal_staging
            WHERE rfq_number = r.rfq_number
            ORDER BY id DESC LIMIT 1
        ) s ON true
        WHERE r.bqms_code = $1
        ORDER BY COALESCE(r.inquiry_date, r.created_at::date) DESC NULLS LAST, r.id DESC
        LIMIT 20
        """,
        bqms_code,
    )
    rfq_history = [
        {
            "rfq_number": row["rfq_number"],
            "inquiry_date": row["inquiry_date"],
            "quoted_v1": float(row["quoted_price_bqms_v1"]) if row["quoted_price_bqms_v1"] is not None else None,
            "quoted_v4": float(row["quoted_price_bqms_v4"]) if row["quoted_price_bqms_v4"] is not None else None,
            "expected_qty": float(row["expected_qty"]) if row["expected_qty"] is not None else None,
            "result": row["result"],
            "person_in_charge": row["person_in_charge_name"],
            "department": row["department"],
        }
        for row in history_rows
    ]

    return {
        "data": {
            "code": bqms_code,
            "summary": summary,
            "frequency": frequency,
            "pricing": pricing,
            "quantity": quantity,
            "departments": departments,
            "buyers": buyers,
            "seasonal_heatmap": seasonal,
            "monthly_trend": monthly_trend,
            "trend_forecast": trend_forecast,
            "rfq_history": rfq_history,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    }


# ─── Loss Reasons ─────────────────────────────────────────────

@router.get("/loss-reasons")
async def loss_reasons(
    months: int = Query(6, ge=1, le=24),
    token_data: TokenData = Depends(require_role("admin", "manager", "director", allow_viewer=False)),
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
