"""
Forecast API — dự báo nhu cầu 3 tháng + funnel + tái đặt hàng + back-test MAPE.

Endpoints (mount under /api/v1/forecast):
  GET /products                 — Danh sách SP + dự báo mới nhất (search/sort/paginate)
  GET /kpi                      — KPI tổng quan dự báo
  GET /top-predicted            — Top SKU theo predicted_qty + confidence band
  GET /confidence-distribution  — Phân bổ confidence (cao/TB/thấp/chưa có)
  GET /funnel                   — Tỷ lệ inquiry → quote → won
  GET /reorder-suggestions      — Gợi ý tái đặt hàng
  GET /back-test                — Back-test MAPE cho 1 mã (predicted vs actual theo tháng)
  GET /accuracy-summary         — MAPE tổng quan toàn bộ codes đã forecast

Thuật toán:
  - 3-month moving average + linear regression slope
  - Confidence = 1 - CV (capped 0-100); seasonality multiplier (so với cùng tháng năm trước)
  - MAPE = mean(|predicted - actual| / max(actual,1) × 100) — calibration: tốt <20, TB 20-50, kém >50

Tolerant: nếu bảng demand_forecasts chưa tồn tại → trả empty an toàn.
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()

HISTORY_MONTHS = 12
MA_WINDOW = 3
FORECAST_MONTHS = 3


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def _f(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _linear_slope(series: list[float]) -> float:
    """OLS slope of series vs time index. 0 if degenerate."""
    n = len(series)
    if n < 2:
        return 0.0
    mean_x = (n - 1) / 2
    mean_y = sum(series) / n
    num = sum((i - mean_x) * (series[i] - mean_y) for i in range(n))
    den = sum((i - mean_x) ** 2 for i in range(n))
    return num / den if den > 0 else 0.0


def _predict_with_trend(
    series: list[float], window: int, horizon: int
) -> tuple[list[float], float]:
    """3-month MA + linear trend + simple year-over-year seasonality multiplier.

    Returns (predictions, confidence_pct).
    """
    if not series:
        return [0.0] * horizon, 0.0

    n = len(series)
    mean = sum(series) / n if n > 0 else 0.0
    variance = sum((x - mean) ** 2 for x in series) / n if n > 0 else 0.0
    stddev = math.sqrt(variance)
    cv = stddev / mean if mean > 0 else float("inf")
    confidence = round(max(0.0, min(100.0, (1 - cv) * 100)), 1) if cv != float("inf") else 0.0

    # MA baseline
    tail = series[-window:] if len(series) >= window else series
    ma_base = sum(tail) / len(tail)

    # Trend slope
    slope = _linear_slope(series)

    # Seasonal multiplier: avg of same-month-last-year vs overall mean
    season_mult = 1.0
    if n >= 12 and mean > 0:
        prior_avg = sum(series[-12 - window: -12]) / max(1, len(series[-12 - window: -12]))
        recent_avg = sum(series[-window:]) / max(1, len(series[-window:]))
        if prior_avg > 0:
            season_mult = max(0.5, min(2.0, recent_avg / prior_avg))

    predictions: list[float] = []
    for h in range(1, horizon + 1):
        raw = (ma_base + slope * h) * season_mult
        predictions.append(round(max(0.0, raw), 2))

    return predictions, confidence


def _confidence_band(pct: float | None) -> str:
    if pct is None:
        return "none"
    if pct >= 70:
        return "high"
    if pct >= 40:
        return "mid"
    return "low"


def _confidence_label_vi(pct: float | None) -> str:
    band = _confidence_band(pct)
    return {
        "high": "Cao ≥70%",
        "mid": "TB 40-70%",
        "low": "Thấp <40%",
        "none": "Chưa có",
    }[band]


# ---------------------------------------------------------------------------
# GET /products
# ---------------------------------------------------------------------------

@router.get("/products")
async def list_forecast_products(
    q: str | None = Query(None),
    sort: str = Query("predicted_qty_desc"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách SP kèm dự báo mới nhất."""
    sort_map = {
        "predicted_qty_desc": "predicted_qty DESC NULLS LAST",
        "predicted_qty_asc": "predicted_qty ASC NULLS LAST",
        "confidence_desc": "confidence_pct DESC NULLS LAST",
        "confidence_asc": "confidence_pct ASC NULLS LAST",
        "name_asc": "name ASC NULLS LAST",
    }
    sort_sql = sort_map.get(sort, "predicted_qty DESC NULLS LAST")

    search_clause = ""
    params: list[Any] = []
    if q:
        params.append(f"%{q}%")
        search_clause = f"WHERE (p.product_name ILIKE ${len(params)} OR p.bqms_code ILIKE ${len(params)})"

    # Tolerant: if demand_forecasts missing, return products with NULL forecast.
    try:
        count_total = await conn.fetchval(
            f"SELECT COUNT(*) FROM products p {search_clause}", *params
        )
    except asyncpg.UndefinedTableError:
        return {"data": {"rows": [], "total": 0}}

    params.extend([limit, offset])
    p_limit = len(params) - 1
    p_offset = len(params)

    try:
        rows = await conn.fetch(
            f"""
            SELECT
                p.bqms_code,
                p.product_name AS name,
                df.predicted_qty,
                df.confidence AS confidence_pct,
                df.forecast_date,
                (df.predicted_qty IS NOT NULL) AS has_forecast
            FROM products p
            LEFT JOIN LATERAL (
                SELECT predicted_qty, confidence, forecast_date
                FROM demand_forecasts
                WHERE product_id = p.id
                ORDER BY created_at DESC
                LIMIT 1
            ) df ON true
            {search_clause}
            ORDER BY {sort_sql}
            LIMIT ${p_limit} OFFSET ${p_offset}
            """,
            *params,
        )
    except asyncpg.UndefinedTableError:
        rows = await conn.fetch(
            f"""
            SELECT
                p.bqms_code,
                p.product_name AS name,
                NULL::numeric AS predicted_qty,
                NULL::numeric AS confidence_pct,
                NULL::date AS forecast_date,
                false AS has_forecast
            FROM products p
            {search_clause}
            ORDER BY p.product_name ASC NULLS LAST
            LIMIT ${p_limit} OFFSET ${p_offset}
            """,
            *params,
        )

    out_rows: list[dict[str, Any]] = []
    for r in rows:
        confidence_pct = _f(r["confidence_pct"])
        out_rows.append({
            "bqms_code": r["bqms_code"],
            "name": r["name"],
            "predicted_qty": _f(r["predicted_qty"]),
            "confidence_pct": confidence_pct,
            "reason_vi": _confidence_label_vi(confidence_pct),
            "forecast_date": r["forecast_date"].isoformat() if r["forecast_date"] else None,
            "has_forecast": bool(r["has_forecast"]),
        })

    return {"data": {"rows": out_rows, "total": int(count_total or 0)}}


# ---------------------------------------------------------------------------
# GET /kpi
# ---------------------------------------------------------------------------

@router.get("/kpi")
async def forecast_kpi(
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """KPI tổng quan dự báo."""
    total_products = await conn.fetchval("SELECT COUNT(*) FROM products")

    try:
        stats = await conn.fetchrow(
            """
            WITH latest AS (
                SELECT DISTINCT ON (product_id)
                    product_id, predicted_qty, confidence
                FROM demand_forecasts
                ORDER BY product_id, created_at DESC
            )
            SELECT
                COALESCE(SUM(predicted_qty), 0) AS total_predicted_3m,
                COUNT(*)::int AS covered,
                AVG(confidence) AS avg_confidence
            FROM latest
            """,
        )

        top = await conn.fetchrow(
            """
            WITH latest AS (
                SELECT DISTINCT ON (product_id)
                    product_id, predicted_qty
                FROM demand_forecasts
                ORDER BY product_id, created_at DESC
            )
            SELECT p.bqms_code, p.product_name AS name, l.predicted_qty AS qty
            FROM latest l
            JOIN products p ON p.id = l.product_id
            ORDER BY l.predicted_qty DESC NULLS LAST
            LIMIT 1
            """
        )
    except asyncpg.UndefinedTableError:
        return {"data": {
            "total_predicted_3m": 0.0,
            "covered": 0,
            "total": int(total_products or 0),
            "avg_confidence": None,
            "top_sku": None,
        }}

    return {"data": {
        "total_predicted_3m": _f(stats["total_predicted_3m"]) or 0.0,
        "covered": int(stats["covered"] or 0),
        "total": int(total_products or 0),
        "avg_confidence": _f(stats["avg_confidence"]),
        "top_sku": {
            "bqms_code": top["bqms_code"],
            "name": top["name"],
            "qty": _f(top["qty"]) or 0.0,
        } if top else None,
    }}


# ---------------------------------------------------------------------------
# GET /top-predicted
# ---------------------------------------------------------------------------

@router.get("/top-predicted")
async def forecast_top_predicted(
    limit: int = Query(8, ge=1, le=50),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Top SKU theo predicted_qty, với confidence band."""
    try:
        rows = await conn.fetch(
            """
            WITH latest AS (
                SELECT DISTINCT ON (product_id)
                    product_id, predicted_qty, confidence
                FROM demand_forecasts
                ORDER BY product_id, created_at DESC
            )
            SELECT
                p.bqms_code,
                p.product_name AS name,
                l.predicted_qty,
                l.confidence
            FROM latest l
            JOIN products p ON p.id = l.product_id
            WHERE l.predicted_qty IS NOT NULL
            ORDER BY l.predicted_qty DESC NULLS LAST
            LIMIT $1
            """,
            limit,
        )
    except asyncpg.UndefinedTableError:
        return {"data": {"rows": []}}

    out = [
        {
            "bqms_code": r["bqms_code"],
            "name": r["name"],
            "predicted_qty": _f(r["predicted_qty"]) or 0.0,
            "confidence_band": _confidence_band(_f(r["confidence"])),
        }
        for r in rows
    ]
    return {"data": {"rows": out}}


# ---------------------------------------------------------------------------
# GET /confidence-distribution
# ---------------------------------------------------------------------------

@router.get("/confidence-distribution")
async def forecast_confidence_distribution(
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Phân bổ confidence: Cao / TB / Thấp / Chưa có."""
    total_products = await conn.fetchval("SELECT COUNT(*) FROM products") or 0

    try:
        row = await conn.fetchrow(
            """
            WITH latest AS (
                SELECT DISTINCT ON (product_id)
                    product_id, confidence
                FROM demand_forecasts
                ORDER BY product_id, created_at DESC
            )
            SELECT
                COUNT(*) FILTER (WHERE confidence >= 70)::int AS high,
                COUNT(*) FILTER (WHERE confidence >= 40 AND confidence < 70)::int AS mid,
                COUNT(*) FILTER (WHERE confidence < 40)::int AS low,
                COUNT(*)::int AS covered
            FROM latest
            """
        )
        covered = int(row["covered"] or 0)
        none_count = max(0, int(total_products) - covered)
        buckets = [
            {"label": "Cao ≥70%", "count": int(row["high"] or 0)},
            {"label": "TB 40-70%", "count": int(row["mid"] or 0)},
            {"label": "Thấp <40%", "count": int(row["low"] or 0)},
            {"label": "Chưa có", "count": none_count},
        ]
    except asyncpg.UndefinedTableError:
        buckets = [
            {"label": "Cao ≥70%", "count": 0},
            {"label": "TB 40-70%", "count": 0},
            {"label": "Thấp <40%", "count": 0},
            {"label": "Chưa có", "count": int(total_products)},
        ]

    return {"data": {"buckets": buckets}}


# ---------------------------------------------------------------------------
# GET /funnel
# ---------------------------------------------------------------------------

@router.get("/funnel")
async def forecast_funnel(
    months: int = Query(12, ge=1, le=36),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tỷ lệ inquiry → quote → won trong N tháng."""
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*)::int AS inquiries,
            COUNT(*) FILTER (WHERE quoted_price_bqms_v1 > 0)::int AS quoted,
            COUNT(*) FILTER (WHERE result::text ILIKE '%won%')::int AS won
        FROM bqms_rfq
        WHERE COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - ($1 || ' months')::interval
        """,
        str(months),
    )

    inq = int(row["inquiries"] or 0)
    quoted = int(row["quoted"] or 0)
    won = int(row["won"] or 0)

    quote_rate = round(quoted / inq * 100, 1) if inq > 0 else 0.0
    win_rate = round(won / quoted * 100, 1) if quoted > 0 else 0.0
    overall = round(won / inq * 100, 1) if inq > 0 else 0.0

    return {"data": {
        "inquiries": inq,
        "quoted": quoted,
        "won": won,
        "quote_rate_pct": quote_rate,
        "win_rate_pct": win_rate,
        "overall_pct": overall,
    }}


# ---------------------------------------------------------------------------
# GET /reorder-suggestions
# ---------------------------------------------------------------------------

@router.get("/reorder-suggestions")
async def forecast_reorder_suggestions(
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Gợi ý tái đặt hàng: SP có predicted_qty > tồn kho hiện tại + lịch sử nhập đều."""
    # Tolerant query — checks for inventory_levels + demand_forecasts; falls back if missing.
    try:
        rows = await conn.fetch(
            """
            WITH latest_forecast AS (
                SELECT DISTINCT ON (product_id)
                    product_id, predicted_qty, confidence
                FROM demand_forecasts
                ORDER BY product_id, created_at DESC
            ),
            inv AS (
                SELECT product_id, COALESCE(SUM(quantity), 0) AS on_hand
                FROM inventory_levels
                GROUP BY product_id
            )
            SELECT
                p.bqms_code,
                p.product_name AS name,
                COALESCE(i.on_hand, 0) AS on_hand,
                f.predicted_qty,
                f.confidence,
                GREATEST(f.predicted_qty - COALESCE(i.on_hand, 0), 0) AS suggested_qty
            FROM latest_forecast f
            JOIN products p ON p.id = f.product_id
            LEFT JOIN inv i ON i.product_id = p.id
            WHERE f.predicted_qty > COALESCE(i.on_hand, 0)
            ORDER BY suggested_qty DESC NULLS LAST
            LIMIT $1
            """,
            limit,
        )
    except asyncpg.UndefinedTableError:
        return {"data": {"rows": []}}

    out: list[dict[str, Any]] = []
    for r in rows:
        confidence = _f(r["confidence"])
        out.append({
            "bqms_code": r["bqms_code"],
            "name": r["name"],
            "on_hand": _f(r["on_hand"]) or 0.0,
            "predicted_qty": _f(r["predicted_qty"]) or 0.0,
            "suggested_qty": _f(r["suggested_qty"]) or 0.0,
            "confidence_pct": confidence,
            "confidence_band": _confidence_band(confidence),
            "reason_vi": _confidence_label_vi(confidence),
        })
    return {"data": {"rows": out}}


# ---------------------------------------------------------------------------
# Back-test helpers
# ---------------------------------------------------------------------------

def _calibration_label(mape: float | None) -> str:
    """MAPE → calibration band (Vietnamese).

    < 20%  → tốt
    20-50% → trung bình
    > 50%  → kém
    None   → chưa có
    """
    if mape is None:
        return "chưa có"
    if mape < 20:
        return "tốt"
    if mape <= 50:
        return "trung bình"
    return "kém"


def _calibration_reason_vi(mape: float | None, sample_size: int) -> str:
    if mape is None or sample_size == 0:
        return "Chưa đủ dữ liệu lịch sử"
    label = _calibration_label(mape)
    if label == "tốt":
        return f"MAPE {mape:.1f}% trên {sample_size} tháng — mô hình bám sát thực tế"
    if label == "trung bình":
        return f"MAPE {mape:.1f}% trên {sample_size} tháng — dự báo lệch vừa phải"
    return f"MAPE {mape:.1f}% trên {sample_size} tháng — dự báo lệch lớn, cần thêm dữ liệu hoặc đổi phương pháp"


async def _compute_actual_by_month(
    conn: asyncpg.Connection,
    bqms_code: str,
    months_back: int,
) -> dict[str, float]:
    """Tổng actual qty theo tháng = SUM(bqms_rfq.quantity) + SUM(sourcing_entries.quantity).

    Returns dict { 'YYYY-MM': float }.
    """
    actuals: dict[str, float] = {}

    # bqms_rfq: dùng inquiry_date (fallback created_at) — spec yêu cầu inquiry_date
    rfq_rows = await conn.fetch(
        """
        SELECT TO_CHAR(DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date)), 'YYYY-MM') AS ym,
               COALESCE(SUM(quantity), 0)::float AS total_qty
        FROM bqms_rfq
        WHERE bqms_code = $1
          AND COALESCE(inquiry_date, created_at::date) >= (CURRENT_DATE - ($2 || ' months')::interval)::date
        GROUP BY 1
        """,
        bqms_code, str(months_back),
    )
    for r in rfq_rows:
        if r["ym"]:
            actuals[r["ym"]] = actuals.get(r["ym"], 0.0) + float(r["total_qty"] or 0)

    # sourcing_entries: cộng thêm — tolerant nếu bảng chưa có
    try:
        src_rows = await conn.fetch(
            """
            SELECT TO_CHAR(DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date)), 'YYYY-MM') AS ym,
                   COALESCE(SUM(quantity), 0)::float AS total_qty
            FROM sourcing_entries
            WHERE bqms_code = $1
              AND COALESCE(inquiry_date, created_at::date) >= (CURRENT_DATE - ($2 || ' months')::interval)::date
            GROUP BY 1
            """,
            bqms_code, str(months_back),
        )
        for r in src_rows:
            if r["ym"]:
                actuals[r["ym"]] = actuals.get(r["ym"], 0.0) + float(r["total_qty"] or 0)
    except asyncpg.UndefinedTableError:
        pass

    return actuals


# ---------------------------------------------------------------------------
# GET /back-test
# ---------------------------------------------------------------------------

@router.get("/back-test")
async def forecast_back_test(
    bqms_code: str = Query(..., description="BQMS code cần back-test"),
    months: int = Query(12, ge=1, le=36),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Back-test: so sánh predicted (lưu trong demand_forecasts) vs actual theo từng tháng → MAPE.

    Với mỗi tháng trong N tháng gần nhất:
      - predicted = bản dự báo lưu sớm nhất phủ tháng đó (forecast_date <= tháng < forecast_date + period_months)
      - actual    = SUM(bqms_rfq.quantity) + SUM(sourcing_entries.quantity) WHERE bqms_code = $1
                    AND inquiry_date trong tháng đó
      - APE       = |predicted - actual| / max(actual, 1) × 100

    Trả về: { entries:[{month, predicted, actual, ape, ape_pct}], mape, confidence_calibration, reason_vi }.
    """
    # 1. Lấy forecast history — predicted_qty / period_months / forecast_date
    try:
        forecast_rows = await conn.fetch(
            """
            SELECT forecast_date, period_months, predicted_qty
            FROM demand_forecasts
            WHERE bqms_code = $1
              AND forecast_date >= (CURRENT_DATE - ($2 || ' months')::interval)::date
            ORDER BY forecast_date ASC, created_at ASC
            """,
            bqms_code, str(months + 6),  # query buffer: dự báo trước đó có thể vẫn cover tháng đầu
        )
    except asyncpg.UndefinedTableError:
        return {"data": {
            "bqms_code": bqms_code,
            "months_requested": months,
            "entries": [],
            "mape": None,
            "confidence_calibration": "chưa có",
            "reason_vi": "Chưa đủ dữ liệu lịch sử",
        }}

    if not forecast_rows:
        return {"data": {
            "bqms_code": bqms_code,
            "months_requested": months,
            "entries": [],
            "mape": None,
            "confidence_calibration": "chưa có",
            "reason_vi": "Chưa đủ dữ liệu lịch sử",
        }}

    # 2. Build per-month predicted: forecast_date + period_months phủ những tháng nào,
    # chia đều predicted_qty / period_months cho từng tháng.
    # Nếu nhiều bản dự báo cùng phủ 1 tháng → lấy bản gần nhất (trước hoặc bằng đầu tháng).
    predicted_by_month: dict[str, tuple[float, date]] = {}
    for fr in forecast_rows:
        fdate: date = fr["forecast_date"]
        period = int(fr["period_months"] or FORECAST_MONTHS) or FORECAST_MONTHS
        total_pred = _f(fr["predicted_qty"]) or 0.0
        per_month_pred = total_pred / period if period > 0 else total_pred
        # Tháng bắt đầu phủ = forecast_date (tháng của nó)
        anchor = fdate.replace(day=1)
        for k in range(period):
            # advance k tháng từ anchor
            year = anchor.year + (anchor.month - 1 + k) // 12
            month = (anchor.month - 1 + k) % 12 + 1
            ym = f"{year:04d}-{month:02d}"
            existing = predicted_by_month.get(ym)
            # Ưu tiên forecast mới nhất (forecast_date lớn hơn) làm prediction cho tháng đó
            if existing is None or fdate > existing[1]:
                predicted_by_month[ym] = (round(per_month_pred, 2), fdate)

    # 3. Lấy actual theo tháng
    actuals = await _compute_actual_by_month(conn, bqms_code, months)

    # 4. Build entries cho N tháng gần nhất (trừ tháng hiện tại — chưa kết thúc)
    today = date.today()
    entries: list[dict[str, Any]] = []
    apes: list[float] = []
    for back in range(months, 0, -1):
        # back=1 = tháng trước; bỏ tháng hiện tại vì chưa hoàn tất
        year = today.year
        month = today.month - back
        while month <= 0:
            month += 12
            year -= 1
        ym = f"{year:04d}-{month:02d}"

        pred_tuple = predicted_by_month.get(ym)
        predicted_val = pred_tuple[0] if pred_tuple else None
        actual_val = round(actuals.get(ym, 0.0), 2)

        # APE chỉ tính nếu có predicted (không có predicted = không có data dự báo cho tháng đó)
        ape_pct: float | None = None
        if predicted_val is not None:
            denom = max(actual_val, 1.0)
            ape_pct = round(abs(predicted_val - actual_val) / denom * 100, 1)
            apes.append(ape_pct)

        entries.append({
            "month": ym,
            "predicted": predicted_val,
            "actual": actual_val,
            "ape": ape_pct,           # alias gọn theo spec
            "ape_pct": ape_pct,       # alias đầy đủ
        })

    mape = round(sum(apes) / len(apes), 1) if apes else None
    calibration = _calibration_label(mape)
    reason_vi = _calibration_reason_vi(mape, len(apes))

    if not apes:
        # Có forecast history nhưng không tháng nào match — vẫn coi là chưa đủ dữ liệu
        reason_vi = "Chưa đủ dữ liệu lịch sử"
        calibration = "chưa có"

    return {"data": {
        "bqms_code": bqms_code,
        "months_requested": months,
        "entries": entries,
        "mape": mape,
        "confidence_calibration": calibration,
        "reason_vi": reason_vi,
        "sample_size": len(apes),
    }}


# ---------------------------------------------------------------------------
# GET /accuracy-summary
# ---------------------------------------------------------------------------

@router.get("/accuracy-summary")
async def forecast_accuracy_summary(
    months: int = Query(12, ge=1, le=36),
    top_codes: int = Query(50, ge=1, le=500, description="Số lượng mã forecast lấy ra để tính"),
    token_data: TokenData = Depends(
        require_role("admin", "manager", "staff", "sales", "director", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """MAPE tổng quan: trung bình MAPE qua tất cả codes có forecast history.

    Chiến lược: lấy top N bqms_code có forecast trong demand_forecasts → back-test từng cái → average MAPE.
    Top_codes giới hạn để tránh query nặng (default 50 mã gần nhất có forecast).
    """
    try:
        code_rows = await conn.fetch(
            """
            SELECT bqms_code, MAX(forecast_date) AS last_forecast
            FROM demand_forecasts
            WHERE bqms_code IS NOT NULL
              AND forecast_date >= (CURRENT_DATE - ($1 || ' months')::interval)::date
            GROUP BY bqms_code
            ORDER BY MAX(forecast_date) DESC
            LIMIT $2
            """,
            str(months + 6), top_codes,
        )
    except asyncpg.UndefinedTableError:
        return {"data": {
            "mape": None,
            "confidence_calibration": "chưa có",
            "reason_vi": "Chưa đủ dữ liệu lịch sử",
            "codes_evaluated": 0,
            "total_month_samples": 0,
            "per_code_mape": [],
        }}

    if not code_rows:
        return {"data": {
            "mape": None,
            "confidence_calibration": "chưa có",
            "reason_vi": "Chưa đủ dữ liệu lịch sử",
            "codes_evaluated": 0,
            "total_month_samples": 0,
            "per_code_mape": [],
        }}

    per_code: list[dict[str, Any]] = []
    all_apes: list[float] = []

    for cr in code_rows:
        bqms_code = cr["bqms_code"]

        # Reuse forecast history fetch — same logic as back-test
        forecast_rows = await conn.fetch(
            """
            SELECT forecast_date, period_months, predicted_qty
            FROM demand_forecasts
            WHERE bqms_code = $1
              AND forecast_date >= (CURRENT_DATE - ($2 || ' months')::interval)::date
            ORDER BY forecast_date ASC, created_at ASC
            """,
            bqms_code, str(months + 6),
        )
        if not forecast_rows:
            continue

        predicted_by_month: dict[str, tuple[float, date]] = {}
        for fr in forecast_rows:
            fdate: date = fr["forecast_date"]
            period = int(fr["period_months"] or FORECAST_MONTHS) or FORECAST_MONTHS
            total_pred = _f(fr["predicted_qty"]) or 0.0
            per_month_pred = total_pred / period if period > 0 else total_pred
            anchor = fdate.replace(day=1)
            for k in range(period):
                year = anchor.year + (anchor.month - 1 + k) // 12
                month_n = (anchor.month - 1 + k) % 12 + 1
                ym = f"{year:04d}-{month_n:02d}"
                existing = predicted_by_month.get(ym)
                if existing is None or fdate > existing[1]:
                    predicted_by_month[ym] = (round(per_month_pred, 2), fdate)

        actuals = await _compute_actual_by_month(conn, bqms_code, months)

        today = date.today()
        code_apes: list[float] = []
        for back in range(months, 0, -1):
            year = today.year
            month_n = today.month - back
            while month_n <= 0:
                month_n += 12
                year -= 1
            ym = f"{year:04d}-{month_n:02d}"
            pred_tuple = predicted_by_month.get(ym)
            if pred_tuple is None:
                continue
            actual_val = actuals.get(ym, 0.0)
            denom = max(actual_val, 1.0)
            ape = abs(pred_tuple[0] - actual_val) / denom * 100
            code_apes.append(ape)

        if code_apes:
            code_mape = round(sum(code_apes) / len(code_apes), 1)
            per_code.append({
                "bqms_code": bqms_code,
                "mape": code_mape,
                "sample_size": len(code_apes),
                "confidence_calibration": _calibration_label(code_mape),
            })
            all_apes.extend(code_apes)

    overall_mape = round(sum(all_apes) / len(all_apes), 1) if all_apes else None
    calibration = _calibration_label(overall_mape)
    if not all_apes:
        reason = "Chưa đủ dữ liệu lịch sử"
        calibration = "chưa có"
    else:
        reason = _calibration_reason_vi(overall_mape, len(all_apes))

    # Sort per_code by mape ascending (best first) for UI
    per_code.sort(key=lambda x: x["mape"])

    return {"data": {
        "mape": overall_mape,
        "confidence_calibration": calibration,
        "reason_vi": reason,
        "codes_evaluated": len(per_code),
        "total_month_samples": len(all_apes),
        "per_code_mape": per_code,
    }}
