"""
Demand Forecast API (M37) — AI Demand Forecasting.

Endpoints:
  GET  /products                  — List products with latest forecast data
  POST /generate/{product_id}     — Generate forecast from historical bqms_rfq data
  GET  /results                   — List all generated forecasts (paginated)
  GET  /results/{product_id}      — Forecast history for a specific product
"""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()

# Number of months of history to look back when building forecast
HISTORY_MONTHS = 12
# Moving average window
MA_WINDOW = 3
# Forecast horizon
FORECAST_MONTHS = 3


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _moving_average(series: list[float], window: int) -> list[float]:
    """Simple moving average over a list of values."""
    result: list[float] = []
    for i in range(len(series)):
        start = max(0, i - window + 1)
        result.append(sum(series[start : i + 1]) / (i - start + 1))
    return result


def _predict_next(series: list[float], window: int, horizon: int) -> tuple[list[float], float]:
    """
    Predict next `horizon` values using moving average.
    Returns (predictions, confidence_pct).
    Confidence is higher when variance is low relative to mean.
    """
    if not series:
        return [0.0] * horizon, 0.0

    predictions: list[float] = []
    working = list(series)
    for _ in range(horizon):
        tail = working[-window:]
        pred = sum(tail) / len(tail)
        predictions.append(round(pred, 2))
        working.append(pred)

    # Confidence: 1 - (stddev / mean) capped [0, 100]
    mean = sum(series) / len(series)
    if mean == 0:
        confidence = 0.0
    else:
        variance = sum((x - mean) ** 2 for x in series) / len(series)
        stddev = variance ** 0.5
        cv = stddev / mean  # coefficient of variation
        confidence = round(max(0.0, min(100.0, (1 - cv) * 100)), 2)

    return predictions, confidence


# ---------------------------------------------------------------------------
# GET /products  — Products with forecast data
# ---------------------------------------------------------------------------

@router.get("/products")
async def list_products_with_forecast(
    search: Optional[str] = Query(None, description="Tìm theo tên sản phẩm / BQMS code"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=500),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách sản phẩm kèm thông tin dự báo mới nhất."""
    offset = (page - 1) * page_size

    search_clause = ""
    params: list = []
    idx = 1

    if search:
        search_clause = f"WHERE p.product_name ILIKE ${idx} OR p.bqms_code ILIKE ${idx}"
        params.append(f"%{search}%")
        idx += 1

    count_row = await conn.fetchrow(
        f"SELECT COUNT(*) AS total FROM products p {search_clause}",
        *params,
    )
    total = count_row["total"]

    # demand_forecasts table may not exist — tolerate missing gracefully
    try:
        rows = await conn.fetch(
            f"""
            SELECT
                p.id AS product_id,
                p.product_name AS name,
                p.bqms_code AS sku,
                p.unit,
                df.predicted_qty,
                df.confidence,
                df.method,
                df.forecast_date,
                df.period_months
            FROM products p
            LEFT JOIN LATERAL (
                SELECT predicted_qty, confidence, method, forecast_date, period_months
                FROM demand_forecasts
                WHERE product_id = p.id
                ORDER BY created_at DESC
                LIMIT 1
            ) df ON true
            {search_clause}
            ORDER BY p.product_name NULLS LAST
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *(params + [page_size, offset]),
        )
    except asyncpg.UndefinedTableError:
        rows = await conn.fetch(
            f"""
            SELECT
                p.id AS product_id,
                p.product_name AS name,
                p.bqms_code AS sku,
                p.unit,
                NULL::numeric AS predicted_qty,
                NULL::numeric AS confidence,
                NULL::text    AS method,
                NULL::date    AS forecast_date,
                NULL::int     AS period_months
            FROM products p
            {search_clause}
            ORDER BY p.product_name NULLS LAST
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *(params + [page_size, offset]),
        )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
        },
        "message": "Lấy danh sách sản phẩm và dự báo thành công",
    }


# ---------------------------------------------------------------------------
# POST /generate/{product_id}  — Generate forecast
# ---------------------------------------------------------------------------

@router.post("/generate/{product_id}")
async def generate_forecast(
    product_id: int,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Tạo dự báo nhu cầu cho sản phẩm dựa trên lịch sử BQMS RFQ (12 tháng).
    Thuật toán: Moving Average 3 tháng → dự báo 3 tháng tới.
    """
    # 1. Verify product exists
    product = await conn.fetchrow(
        "SELECT id, name, sku FROM products WHERE id = $1",
        product_id,
    )
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")

    bqms_code = product["sku"]  # use SKU as BQMS code matcher

    # 2. Query monthly demand from bqms_rfq (last 12 months)
    # Each RFQ row has a quantity field; aggregate by month
    monthly_rows = await conn.fetch(
        """
        SELECT
            TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
            COALESCE(SUM(quantity), COUNT(*)) AS total_qty
        FROM bqms_rfq
        WHERE
            (bqms_code = $1 OR product_name ILIKE $2)
            AND created_at >= NOW() - INTERVAL '12 months'
        GROUP BY 1
        ORDER BY 1
        """,
        bqms_code,
        f"%{bqms_code}%",
    )

    # 3. Build ordered 12-slot series (fill missing months with 0)
    month_map: dict[str, float] = {r["month"]: float(r["total_qty"]) for r in monthly_rows}

    today = date.today()
    series: list[float] = []
    month_labels: list[str] = []
    for i in range(HISTORY_MONTHS, 0, -1):
        # Walk backwards: HISTORY_MONTHS months ago → last month
        d = date(today.year, today.month, 1) - timedelta(days=i * 28)
        # Normalize to first day of that month
        label = f"{d.year}-{d.month:02d}"
        series.append(month_map.get(label, 0.0))
        month_labels.append(label)

    # 4. Predict next FORECAST_MONTHS months
    predictions, confidence = _predict_next(series, MA_WINDOW, FORECAST_MONTHS)

    forecast_labels: list[str] = []
    base = date(today.year, today.month, 1)
    for i in range(1, FORECAST_MONTHS + 1):
        month_offset = base.month + i
        year_offset = base.year + (month_offset - 1) // 12
        month_val = ((month_offset - 1) % 12) + 1
        forecast_labels.append(f"{year_offset}-{month_val:02d}")

    # 5. Save to demand_forecasts
    input_data = {
        "history_months": HISTORY_MONTHS,
        "ma_window": MA_WINDOW,
        "month_labels": month_labels,
        "series": series,
        "forecast_labels": forecast_labels,
        "predictions": predictions,
    }

    total_predicted = round(sum(predictions), 2)

    record = await conn.fetchrow(
        """
        INSERT INTO demand_forecasts (
            product_id, bqms_code, forecast_date, period_months,
            predicted_qty, confidence, method, input_data
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, forecast_date, predicted_qty, confidence, method, created_at
        """,
        product_id,
        bqms_code,
        today,
        FORECAST_MONTHS,
        total_predicted,
        confidence,
        "moving_avg",
        json.dumps(input_data),
    )

    return {
        "data": {
            "forecast_id": record["id"],
            "product_id": product_id,
            "product_name": product["name"],
            "bqms_code": bqms_code,
            "forecast_date": record["forecast_date"].isoformat(),
            "period_months": FORECAST_MONTHS,
            "predicted_qty": float(record["predicted_qty"]),
            "confidence": float(record["confidence"]),
            "method": record["method"],
            "monthly_predictions": dict(zip(forecast_labels, predictions)),
            "history": dict(zip(month_labels, series)),
            "created_at": record["created_at"].isoformat(),
        },
        "message": f"Dự báo nhu cầu cho '{product['name']}' đã tạo thành công",
    }


# ---------------------------------------------------------------------------
# GET /results  — List all forecasts
# ---------------------------------------------------------------------------

@router.get("/results")
async def list_forecasts(
    product_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách tất cả các dự báo đã tạo."""
    offset = (page - 1) * page_size

    where = "WHERE 1=1"
    params: list = []
    idx = 1

    if product_id:
        where += f" AND df.product_id = ${idx}"
        params.append(product_id)
        idx += 1

    count_row = await conn.fetchrow(
        f"SELECT COUNT(*) AS total FROM demand_forecasts df {where}",
        *params,
    )
    total = count_row["total"]

    rows = await conn.fetch(
        f"""
        SELECT
            df.id,
            df.product_id,
            p.name AS product_name,
            p.sku,
            df.bqms_code,
            df.forecast_date,
            df.period_months,
            df.predicted_qty,
            df.confidence,
            df.method,
            df.created_at
        FROM demand_forecasts df
        LEFT JOIN products p ON p.id = df.product_id
        {where}
        ORDER BY df.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *(params + [page_size, offset]),
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
        },
        "message": "Lấy danh sách dự báo thành công",
    }


# ---------------------------------------------------------------------------
# GET /results/{product_id}  — Forecast detail for a product
# ---------------------------------------------------------------------------

@router.get("/results/{product_id}")
async def get_product_forecasts(
    product_id: int,
    limit: int = Query(10, ge=1, le=50),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Lịch sử dự báo cho một sản phẩm cụ thể."""
    product = await conn.fetchrow(
        "SELECT id, name, sku FROM products WHERE id = $1",
        product_id,
    )
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")

    rows = await conn.fetch(
        """
        SELECT
            id, forecast_date, period_months,
            predicted_qty, confidence, method,
            input_data, created_at
        FROM demand_forecasts
        WHERE product_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        """,
        product_id,
        limit,
    )

    items = []
    for r in rows:
        row_dict = dict(r)
        # Parse input_data JSON string if needed
        if isinstance(row_dict.get("input_data"), str):
            try:
                row_dict["input_data"] = json.loads(row_dict["input_data"])
            except (json.JSONDecodeError, TypeError):
                pass
        items.append(row_dict)

    return {
        "data": {
            "product_id": product_id,
            "product_name": product["name"],
            "sku": product["sku"],
            "forecasts": items,
        },
        "message": "Lấy dự báo sản phẩm thành công",
    }
