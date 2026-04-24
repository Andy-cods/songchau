"""Quick Price Lookup — Ctrl+K widget backend.

Given a bqms_code, return:
  - internal_quotes: last 3 from bqms_rfq (v1-v4)
  - market: median/min/max/p25/p75 from xnk_price_lookup (last 90 days)
  - recent_wins: last 5 PO from bqms_samsung_po
"""

from __future__ import annotations

import re
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


def _normalize(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", code.upper())


@router.get("/search")
async def search_codes(
    q: str = Query(..., min_length=2, max_length=64),
    limit: int = Query(10, ge=1, le=50),
    token_data: TokenData = Depends(
        require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Autocomplete — suggest codes starting/containing query."""

    norm = _normalize(q)
    # Try prefix match first on normalized bqms_code
    rows = await conn.fetch(
        """
        SELECT bqms_code,
               MAX(specification) AS specification,
               MAX(maker) AS maker,
               COUNT(*) AS rfq_count,
               MAX(inquiry_date) AS last_inquiry
        FROM bqms_rfq
        WHERE bqms_code IS NOT NULL
          AND REGEXP_REPLACE(UPPER(bqms_code), '[^A-Z0-9]', '', 'g') LIKE $1 || '%'
        GROUP BY bqms_code
        ORDER BY MAX(inquiry_date) DESC NULLS LAST
        LIMIT $2
        """,
        norm, limit,
    )

    if not rows:
        # fallback: contains
        rows = await conn.fetch(
            """
            SELECT bqms_code,
                   MAX(specification) AS specification,
                   MAX(maker) AS maker,
                   COUNT(*) AS rfq_count,
                   MAX(inquiry_date) AS last_inquiry
            FROM bqms_rfq
            WHERE bqms_code IS NOT NULL
              AND REGEXP_REPLACE(UPPER(bqms_code), '[^A-Z0-9]', '', 'g') LIKE '%' || $1 || '%'
            GROUP BY bqms_code
            ORDER BY MAX(inquiry_date) DESC NULLS LAST
            LIMIT $2
            """,
            norm, limit,
        )

    return {
        "query": q,
        "items": [
            {
                "bqms_code": r["bqms_code"],
                "specification": r["specification"],
                "maker": r["maker"],
                "rfq_count": r["rfq_count"],
                "last_inquiry": r["last_inquiry"].isoformat() if r["last_inquiry"] else None,
            }
            for r in rows
        ],
    }


@router.get("/{bqms_code}")
async def lookup_price(
    bqms_code: str,
    token_data: TokenData = Depends(
        require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Aggregate view for a single code."""

    # Internal quotes — last 3 RFQ rows
    internal = await conn.fetch(
        """
        SELECT id, rfq_number, inquiry_date, expected_qty, unit,
               quoted_price_bqms_v1, quoted_price_bqms_v2,
               quoted_price_bqms_v3, quoted_price_bqms_v4,
               quoted_price_ama, purchase_price_rmb, purchase_price_vnd,
               result, item_type, maker, specification
        FROM bqms_rfq
        WHERE bqms_code = $1
        ORDER BY inquiry_date DESC NULLS LAST, id DESC
        LIMIT 3
        """,
        bqms_code,
    )

    # Market — xnk_price_lookup last 90 days
    market = await conn.fetchrow(
        """
        SELECT
          COUNT(*) AS n,
          MIN(price_usd) AS min_usd,
          MAX(price_usd) AS max_usd,
          AVG(price_usd) AS avg_usd,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price_usd) AS median_usd,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY price_usd) AS p25_usd,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY price_usd) AS p75_usd,
          MAX(rfq_date) AS latest_date
        FROM xnk_price_lookup
        WHERE bqms_code = $1
          AND price_usd > 0
          AND rfq_date >= CURRENT_DATE - INTERVAL '90 days'
        """,
        bqms_code,
    )

    # Market all-time (fallback if 90d empty)
    market_all_time = await conn.fetchrow(
        """
        SELECT
          COUNT(*) AS n,
          AVG(price_usd) AS avg_usd,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price_usd) AS median_usd,
          MIN(rfq_date) AS first_date,
          MAX(rfq_date) AS latest_date
        FROM xnk_price_lookup
        WHERE bqms_code = $1 AND price_usd > 0
        """,
        bqms_code,
    )

    # Top competitors (sellers)
    competitors = await conn.fetch(
        """
        SELECT seller_name, COUNT(*) AS n, AVG(price_usd) AS avg_usd,
               MAX(rfq_date) AS latest_date
        FROM xnk_price_lookup
        WHERE bqms_code = $1 AND price_usd > 0 AND seller_name IS NOT NULL
        GROUP BY seller_name
        ORDER BY n DESC, latest_date DESC
        LIMIT 5
        """,
        bqms_code,
    )

    # Recent wins from Samsung POs
    wins = await conn.fetch(
        """
        SELECT po_number, po_date, order_qty, unit_price, amount, currency,
               process_status, confirm_status, preferred_delivery_date
        FROM bqms_samsung_po
        WHERE bqms_code = $1
        ORDER BY po_date DESC NULLS LAST
        LIMIT 5
        """,
        bqms_code,
    )

    return {
        "bqms_code": bqms_code,
        "internal_quotes": [
            {
                "id": r["id"],
                "rfq_number": r["rfq_number"],
                "inquiry_date": r["inquiry_date"].isoformat() if r["inquiry_date"] else None,
                "qty": float(r["expected_qty"]) if r["expected_qty"] else None,
                "unit": r["unit"],
                "v1": float(r["quoted_price_bqms_v1"]) if r["quoted_price_bqms_v1"] else None,
                "v2": float(r["quoted_price_bqms_v2"]) if r["quoted_price_bqms_v2"] else None,
                "v3": float(r["quoted_price_bqms_v3"]) if r["quoted_price_bqms_v3"] else None,
                "v4": float(r["quoted_price_bqms_v4"]) if r["quoted_price_bqms_v4"] else None,
                "ama": float(r["quoted_price_ama"]) if r["quoted_price_ama"] else None,
                "purchase_rmb": float(r["purchase_price_rmb"]) if r["purchase_price_rmb"] else None,
                "purchase_vnd": float(r["purchase_price_vnd"]) if r["purchase_price_vnd"] else None,
                "result": r["result"],
                "item_type": r["item_type"],
                "maker": r["maker"],
                "specification": r["specification"],
            }
            for r in internal
        ],
        "market_90d": {
            "n": market["n"] if market else 0,
            "min_usd": float(market["min_usd"]) if market and market["min_usd"] else None,
            "max_usd": float(market["max_usd"]) if market and market["max_usd"] else None,
            "avg_usd": float(market["avg_usd"]) if market and market["avg_usd"] else None,
            "median_usd": float(market["median_usd"]) if market and market["median_usd"] else None,
            "p25_usd": float(market["p25_usd"]) if market and market["p25_usd"] else None,
            "p75_usd": float(market["p75_usd"]) if market and market["p75_usd"] else None,
            "latest_date": market["latest_date"].isoformat() if market and market["latest_date"] else None,
        },
        "market_all_time": {
            "n": market_all_time["n"] if market_all_time else 0,
            "avg_usd": float(market_all_time["avg_usd"]) if market_all_time and market_all_time["avg_usd"] else None,
            "median_usd": float(market_all_time["median_usd"]) if market_all_time and market_all_time["median_usd"] else None,
            "first_date": market_all_time["first_date"].isoformat() if market_all_time and market_all_time["first_date"] else None,
            "latest_date": market_all_time["latest_date"].isoformat() if market_all_time and market_all_time["latest_date"] else None,
        },
        "competitors": [
            {
                "seller_name": c["seller_name"],
                "n": c["n"],
                "avg_usd": float(c["avg_usd"]) if c["avg_usd"] else None,
                "latest_date": c["latest_date"].isoformat() if c["latest_date"] else None,
            }
            for c in competitors
        ],
        "recent_wins": [
            {
                "po_number": w["po_number"],
                "po_date": w["po_date"].isoformat() if w["po_date"] else None,
                "qty": float(w["order_qty"]) if w["order_qty"] else None,
                "unit_price": float(w["unit_price"]) if w["unit_price"] else None,
                "amount": float(w["amount"]) if w["amount"] else None,
                "currency": w["currency"],
                "status": w["process_status"],
                "delivery_date": w["preferred_delivery_date"].isoformat() if w["preferred_delivery_date"] else None,
            }
            for w in wins
        ],
    }
