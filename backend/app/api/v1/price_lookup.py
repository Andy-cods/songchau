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


@router.get("/search/global")
async def search_global(
    q: str = Query(..., min_length=2, max_length=64),
    limit: int = Query(8, ge=1, le=20,
                       description="Max results per category"),
    token_data: TokenData = Depends(
        require_role("staff", "manager", "admin", "accountant",
                     "procurement", "warehouse", "sales",
                     allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Unified search across BQMS tables (Thang 2026-05-22).

    Searches `bqms_rfq`, `bqms_deliveries`, `bqms_won_quotations`,
    `bqms_samsung_po` for the query string. Returns categorized results so
    the Ctrl+K palette can show "Mã trong RFQ", "Mã trong Giao hàng", etc.

    Performance:
      - Uses `bqms_code_norm` (generated col) + B-tree index for prefix match.
      - Uses pg_trgm GIN indexes for fuzzy contains.
      - Each category limited to `limit` rows so total response stays small.

    Query handling:
      - User can paste `Z0000002-385323` (with dash) — normalized to
        `Z0000002385323` for indexed prefix match.
      - Substring match also runs against raw bqms_code for non-normalized
        codes (e.g. SEV's `5512-MO` style with mixed separators).
    """
    norm = _normalize(q)
    raw = q.strip()
    raw_upper = raw.upper()

    # ── bqms_rfq ────────────────────────────────────────────────
    # Rank: exact > prefix > contains
    rfq_rows = await conn.fetch(
        """
        SELECT DISTINCT ON (bqms_code)
               id, bqms_code, rfq_number, specification, maker,
               inquiry_date, result, quote_unlocked,
               classification_override AS classification,
               CASE
                 WHEN bqms_code_norm = $1 THEN 1
                 WHEN bqms_code_norm LIKE $1 || '%' THEN 2
                 WHEN bqms_code ILIKE '%' || $2 || '%' THEN 3
                 WHEN rfq_number ILIKE '%' || $2 || '%' THEN 4
                 ELSE 5
               END AS rank
        FROM bqms_rfq
        WHERE bqms_code IS NOT NULL
          AND (
              bqms_code_norm LIKE $1 || '%'
              OR bqms_code_norm LIKE '%' || $1 || '%'
              OR bqms_code ILIKE '%' || $2 || '%'
              OR rfq_number ILIKE '%' || $2 || '%'
              OR specification ILIKE '%' || $2 || '%'
          )
        ORDER BY bqms_code,
                 CASE
                   WHEN bqms_code_norm = $1 THEN 1
                   WHEN bqms_code_norm LIKE $1 || '%' THEN 2
                   WHEN bqms_code ILIKE '%' || $2 || '%' THEN 3
                   WHEN rfq_number ILIKE '%' || $2 || '%' THEN 4
                   ELSE 5
                 END,
                 inquiry_date DESC NULLS LAST
        LIMIT $3
        """,
        norm, raw, limit,
    )

    # ── bqms_deliveries ────────────────────────────────────────
    delivery_rows = await conn.fetch(
        """
        SELECT id, po_number, bqms_code, shipping_no,
               quantity, actual_delivered_qty, delivery_status,
               delivery_date
        FROM bqms_deliveries
        WHERE bqms_code ILIKE '%' || $1 || '%'
           OR po_number ILIKE '%' || $1 || '%'
           OR (shipping_no IS NOT NULL AND shipping_no ILIKE '%' || $1 || '%')
        ORDER BY
            CASE WHEN bqms_code = $2 THEN 1
                 WHEN bqms_code ILIKE $1 || '%' THEN 2
                 ELSE 3 END,
            updated_at DESC NULLS LAST
        LIMIT $3
        """,
        raw, raw_upper, limit,
    )

    # ── bqms_won_quotations (may not exist on older installs) ──
    won_rows: list[Any] = []
    try:
        won_rows = await conn.fetch(
            """
            SELECT id, bqms_code, rfq_number, won_price, won_at
              FROM bqms_won_quotations
             WHERE bqms_code ILIKE '%' || $1 || '%'
                OR rfq_number ILIKE '%' || $1 || '%'
             ORDER BY won_at DESC NULLS LAST
             LIMIT $2
            """,
            raw, limit,
        )
    except Exception:
        pass

    # ── bqms_samsung_po ────────────────────────────────────────
    po_rows: list[Any] = []
    try:
        po_rows = await conn.fetch(
            """
            SELECT id, po_number, bqms_code, order_qty, shipping_qty,
                   process_status, po_date
              FROM bqms_samsung_po
             WHERE bqms_code ILIKE '%' || $1 || '%'
                OR po_number ILIKE '%' || $1 || '%'
             ORDER BY
                CASE WHEN bqms_code = $2 THEN 1
                     WHEN bqms_code ILIKE $1 || '%' THEN 2
                     ELSE 3 END,
                po_date DESC NULLS LAST
             LIMIT $3
            """,
            raw, raw_upper, limit,
        )
    except Exception:
        pass

    # ── suppliers ──────────────────────────────────────────────
    supplier_rows: list[Any] = []
    try:
        supplier_rows = await conn.fetch(
            """
            SELECT id, name, tax_code, address
              FROM suppliers
             WHERE name ILIKE '%' || $1 || '%'
                OR tax_code ILIKE '%' || $1 || '%'
             ORDER BY name
             LIMIT $2
            """,
            raw, limit,
        )
    except Exception:
        pass

    # ── RFQ (grouped by rfq_number) ─────────────────────────────
    # Thang 2026-06-04 (BUG A): Ctrl+K should return a top-level "RFQ" group
    # when the query matches an rfq_number — distinct from BQMS code matches.
    # Schema notes:
    #   • bqms_rfq has NO `subject` column → use the longest/most descriptive
    #     `specification` as the human label.
    #   • bqms_rfq has NO `year_month` → derive from `inquiry_date`.
    #   • Quote status: `quoted_price_bqms_v1 IS NOT NULL` ≈ "đã có giá";
    #     `result` enum doubles as outcome (won/lost/pending).
    rfq_group_rows: list[Any] = []
    try:
        rfq_group_rows = await conn.fetch(
            """
            SELECT rfq_number,
                   -- pick longest specification as the label (most descriptive)
                   (ARRAY_AGG(specification ORDER BY length(coalesce(specification, '')) DESC)
                       FILTER (WHERE specification IS NOT NULL))[1] AS subject,
                   COUNT(*)                                                AS item_count,
                   COUNT(*) FILTER (WHERE quoted_price_bqms_v1 IS NOT NULL) AS quoted_count,
                   MAX(inquiry_date)                                       AS inquiry_date,
                   BOOL_OR(quoted_price_bqms_v1 IS NOT NULL)               AS has_quote,
                   BOOL_OR(result::text = 'won')                           AS has_won,
                   BOOL_OR(result::text = 'pending' OR result IS NULL)     AS any_pending,
                   MAX(updated_at)                                         AS last_activity
              FROM bqms_rfq
             WHERE rfq_number ILIKE '%' || $1 || '%'
             GROUP BY rfq_number
             ORDER BY (CASE WHEN rfq_number = $1 THEN 0
                            WHEN rfq_number ILIKE $1 || '%' THEN 1
                            ELSE 2 END),
                      MAX(inquiry_date) DESC NULLS LAST
             LIMIT $2
            """,
            raw, limit,
        )
    except Exception:
        pass

    def _iso(d):
        return d.isoformat() if d else None

    return {
        "query": q,
        "normalized": norm,
        "rfqs": [
            {
                "id": r["id"],
                "bqms_code": r["bqms_code"],
                "rfq_number": r["rfq_number"],
                "specification": r["specification"],
                "maker": r["maker"],
                "inquiry_date": _iso(r["inquiry_date"]),
                "result": r["result"],
                "quote_unlocked": r["quote_unlocked"],
                "classification": r["classification"],
            }
            for r in rfq_rows
        ],
        "deliveries": [
            {
                "id": r["id"],
                "po_number": r["po_number"],
                "bqms_code": r["bqms_code"],
                "shipping_no": r["shipping_no"],
                "quantity": float(r["quantity"] or 0),
                "actual_delivered_qty": float(r["actual_delivered_qty"] or 0),
                "delivery_status": r["delivery_status"],
                "delivery_date": _iso(r["delivery_date"]),
            }
            for r in delivery_rows
        ],
        "won_quotations": [
            {
                "id": r["id"],
                "bqms_code": r["bqms_code"],
                "rfq_number": r["rfq_number"],
                "won_price": float(r["won_price"] or 0) if r["won_price"] is not None else None,
                "won_at": _iso(r["won_at"]),
            }
            for r in won_rows
        ],
        "samsung_po": [
            {
                "id": r["id"],
                "po_number": r["po_number"],
                "bqms_code": r["bqms_code"],
                "order_qty": float(r["order_qty"] or 0) if r["order_qty"] is not None else None,
                "shipping_qty": float(r["shipping_qty"] or 0) if r["shipping_qty"] is not None else None,
                "process_status": r["process_status"],
                "po_date": _iso(r["po_date"]),
            }
            for r in po_rows
        ],
        "suppliers": [
            {
                "id": r["id"],
                "name": r["name"],
                "tax_code": r["tax_code"],
                "address": r["address"],
            }
            for r in supplier_rows
        ],
        # Thang 2026-06-04 (BUG A): grouped RFQ matches by rfq_number.
        # Separate from `rfqs` (per-bqms_code rows) — this surfaces a
        # single entry per RFQ for the Ctrl+K "Đơn hàng (RFQ)" section.
        "rfq": [
            {
                "rfq_number": r["rfq_number"],
                "subject": r["subject"],
                "item_count": int(r["item_count"] or 0),
                "quoted_count": int(r["quoted_count"] or 0),
                "inquiry_date": _iso(r["inquiry_date"]),
                "has_quote": bool(r["has_quote"]),
                "has_won": bool(r["has_won"]),
                "any_pending": bool(r["any_pending"]),
                "last_activity": _iso(r["last_activity"]),
            }
            for r in rfq_group_rows
        ],
    }


@router.get("/search")
async def search_codes(
    q: str = Query(..., min_length=2, max_length=64),
    limit: int = Query(10, ge=1, le=50),
    token_data: TokenData = Depends(
        require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse",
                     allow_viewer=False)
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Autocomplete — suggest codes starting/containing query."""

    norm = _normalize(q)
    # Thang 2026-05-22: use indexed `bqms_code_norm` (generated column) +
    # B-tree index instead of REGEXP_REPLACE() in the WHERE clause. Falls
    # back to GIN trigram match for substring.
    rows = await conn.fetch(
        """
        SELECT bqms_code,
               MAX(specification) AS specification,
               MAX(maker) AS maker,
               COUNT(*) AS rfq_count,
               MAX(inquiry_date) AS last_inquiry
        FROM bqms_rfq
        WHERE bqms_code IS NOT NULL
          AND bqms_code_norm LIKE $1 || '%'
        GROUP BY bqms_code
        ORDER BY MAX(inquiry_date) DESC NULLS LAST
        LIMIT $2
        """,
        norm, limit,
    )

    if not rows:
        # fallback: contains — uses GIN trigram index
        rows = await conn.fetch(
            """
            SELECT bqms_code,
                   MAX(specification) AS specification,
                   MAX(maker) AS maker,
                   COUNT(*) AS rfq_count,
                   MAX(inquiry_date) AS last_inquiry
            FROM bqms_rfq
            WHERE bqms_code IS NOT NULL
              AND bqms_code_norm LIKE '%' || $1 || '%'
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
        require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse",
                     allow_viewer=False)
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
