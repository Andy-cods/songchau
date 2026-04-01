"""
Exchange Rates API — Manage CNY/VND and USD/VND daily rates.
Supports manual entry, rate history for charts, and latest rate lookup.
"""

from __future__ import annotations

from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()

SUPPORTED_CURRENCIES = ("CNY", "USD", "EUR", "JPY", "KRW")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ExchangeRateCreateRequest(BaseModel):
    rate_date: date
    from_currency: str
    to_currency: str = "VND"
    rate: float
    source: str = "manual"

    @field_validator("from_currency")
    @classmethod
    def validate_currency(cls, v: str) -> str:
        v = v.upper()
        if v not in SUPPORTED_CURRENCIES:
            raise ValueError(f"Đồng tiền không được hỗ trợ. Chấp nhận: {SUPPORTED_CURRENCIES}")
        return v

    @field_validator("rate")
    @classmethod
    def validate_rate(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Tỷ giá phải lớn hơn 0")
        return v


class BulkRateRequest(BaseModel):
    rate_date: date
    cny_vnd: float | None = None
    usd_vnd: float | None = None
    eur_vnd: float | None = None
    source: str = "manual"

    @field_validator("cny_vnd", "usd_vnd", "eur_vnd")
    @classmethod
    def validate_positive(cls, v: float | None) -> float | None:
        if v is not None and v <= 0:
            raise ValueError("Tỷ giá phải lớn hơn 0")
        return v


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/latest")
async def get_latest_rates(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Get the latest exchange rates for all supported currency pairs."""
    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (from_currency, to_currency)
            id, rate_date, from_currency, to_currency, rate, source, created_at
        FROM exchange_rates
        WHERE to_currency = 'VND'
        ORDER BY from_currency, to_currency, rate_date DESC, created_at DESC
        """
    )

    rates = {row["from_currency"]: dict(row) for row in rows}

    # Build a user-friendly response
    return {
        "data": {
            "rates": rates,
            "cny_vnd": rates.get("CNY", {}).get("rate"),
            "usd_vnd": rates.get("USD", {}).get("rate"),
            "eur_vnd": rates.get("EUR", {}).get("rate"),
            "as_of": rates.get("CNY", {}).get("rate_date") or rates.get("USD", {}).get("rate_date"),
        },
        "message": "Tỷ giá hiện tại",
    }


@router.get("/history")
async def get_rate_history(
    from_currency: str = Query("CNY", description="Đồng tiền nguồn (CNY, USD, EUR, ...)"),
    to_currency: str = Query("VND"),
    days: int = Query(90, ge=7, le=365, description="Số ngày lịch sử"),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Get rate history for charts — ordered by date ascending."""
    from_currency = from_currency.upper()
    to_currency = to_currency.upper()

    date_from = date.today() - timedelta(days=days)

    rows = await conn.fetch(
        """
        SELECT rate_date, from_currency, to_currency, rate, source, created_at
        FROM exchange_rates
        WHERE from_currency = $1
          AND to_currency   = $2
          AND rate_date     >= $3
        ORDER BY rate_date ASC
        """,
        from_currency, to_currency, date_from,
    )

    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"Không có dữ liệu tỷ giá {from_currency}/{to_currency} trong {days} ngày qua",
        )

    data_points = [dict(r) for r in rows]

    # Calculate summary stats
    rates_only = [float(r["rate"]) for r in rows]
    summary = {
        "min": min(rates_only),
        "max": max(rates_only),
        "avg": round(sum(rates_only) / len(rates_only), 4),
        "latest": rates_only[-1],
        "oldest": rates_only[0],
        "change_pct": round((rates_only[-1] - rates_only[0]) / rates_only[0] * 100, 2) if rates_only[0] > 0 else 0,
    }

    return {
        "data": data_points,
        "summary": summary,
        "total": len(data_points),
        "pair": f"{from_currency}/{to_currency}",
        "period_days": days,
    }


@router.post("", status_code=201)
async def create_exchange_rate(
    body: ExchangeRateCreateRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Manual rate entry by accountant — upsert for idempotency."""
    if body.rate_date > date.today():
        raise HTTPException(
            status_code=400,
            detail="Không thể nhập tỷ giá cho ngày trong tương lai",
        )

    row = await conn.fetchrow(
        """
        INSERT INTO exchange_rates (rate_date, from_currency, to_currency, rate, source, created_by)
        VALUES ($1, $2, $3, $4, $5, $6::uuid)
        ON CONFLICT (rate_date, from_currency, to_currency) DO UPDATE
            SET rate       = EXCLUDED.rate,
                source     = EXCLUDED.source,
                created_by = EXCLUDED.created_by,
                created_at = NOW()
        RETURNING *
        """,
        body.rate_date,
        body.from_currency,
        body.to_currency,
        body.rate,
        body.source,
        token_data.user_id,
    )
    return {
        "data": dict(row),
        "message": f"Đã cập nhật tỷ giá {body.from_currency}/{body.to_currency} ngày {body.rate_date}: {body.rate:,.4f}",
    }


@router.post("/bulk", status_code=201)
async def bulk_create_rates(
    body: BulkRateRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Create multiple rates for one date in a single request."""
    if body.rate_date > date.today():
        raise HTTPException(
            status_code=400,
            detail="Không thể nhập tỷ giá cho ngày trong tương lai",
        )

    entries = []
    if body.cny_vnd:
        entries.append(("CNY", body.cny_vnd))
    if body.usd_vnd:
        entries.append(("USD", body.usd_vnd))
    if body.eur_vnd:
        entries.append(("EUR", body.eur_vnd))

    if not entries:
        raise HTTPException(status_code=400, detail="Phải nhập ít nhất một tỷ giá")

    created = []
    async with conn.transaction():
        for currency, rate_val in entries:
            row = await conn.fetchrow(
                """
                INSERT INTO exchange_rates (rate_date, from_currency, to_currency, rate, source, created_by)
                VALUES ($1, $2, 'VND', $3, $4, $5::uuid)
                ON CONFLICT (rate_date, from_currency, to_currency) DO UPDATE
                    SET rate       = EXCLUDED.rate,
                        source     = EXCLUDED.source,
                        created_at = NOW()
                RETURNING *
                """,
                body.rate_date, currency, rate_val, body.source, token_data.user_id,
            )
            created.append(dict(row))

    return {
        "data": created,
        "total": len(created),
        "message": f"Đã cập nhật {len(created)} tỷ giá ngày {body.rate_date}",
    }
