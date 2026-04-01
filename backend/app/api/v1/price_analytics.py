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

from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.core.database import get_db
from app.core.rbac import require_role, TokenData

router = APIRouter()


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
