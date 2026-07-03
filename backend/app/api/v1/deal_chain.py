"""
Deal Chain API — Full revenue chain visibility: trace a deal from RFQ to cash.
Provides end-to-end tracing: RFQ → SO → Supplier Quote → PO → Shipment → Invoice → Payment → Margin.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_chain(conn: asyncpg.Connection, chain_code: str) -> dict:
    row = await conn.fetchrow(
        "SELECT * FROM revenue_chain WHERE chain_code = $1", chain_code
    )
    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Chuỗi giao dịch '{chain_code}' không tồn tại",
        )
    return dict(row)


STAGE_ORDER = [
    "rfq", "quotation", "so", "supplier_quote", "po",
    "shipment", "invoice", "payment", "completed",
]


def _stage_pct(stage: str) -> int:
    """Map stage to approximate % completion."""
    pct_map = {
        "rfq": 10,
        "quotation": 20,
        "so": 30,
        "supplier_quote": 45,
        "po": 55,
        "shipment": 70,
        "invoice": 85,
        "payment": 95,
        "completed": 100,
    }
    return pct_map.get(stage, 0)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_deal_chains(
    current_stage: str | None = Query(None),
    is_complete: bool | None = Query(None),
    needs_review: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List all deal chains with summary status."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if current_stage:
        conditions.append(f"rc.current_stage = ${idx}")
        params.append(current_stage)
        idx += 1
    if is_complete is not None:
        conditions.append(f"rc.is_complete = ${idx}")
        params.append(is_complete)
        idx += 1
    if needs_review is not None:
        # Join purchase_orders to check needs_review
        conditions.append(
            f"EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = rc.po_id AND po.needs_review = ${idx})"
        )
        params.append(needs_review)
        idx += 1

    where = " AND ".join(conditions)
    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM revenue_chain rc WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT
            rc.*,
            rfq.rfq_number,
            rfq.bqms_code        AS rfq_bqms_code,
            rfq.result           AS rfq_result,
            so.order_number      AS so_number,
            so.status            AS so_status_live,
            sq.quote_number,
            sq.status            AS sq_status_live,
            sq.total_amount_vnd  AS sq_total_vnd,
            po.po_number,
            po.status            AS po_status_live,
            po.needs_review,
            sh.shipment_number,
            sh.status            AS sh_status_live,
            sh.eta,
            sh.ata,
            inv.invoice_number,
            inv.status           AS inv_status_live,
            inv.total_amount     AS inv_total_amount,
            inv.paid_amount      AS inv_paid_amount,
            inv.due_date         AS inv_due_date,
            c.company_name       AS customer_name
        FROM revenue_chain rc
        LEFT JOIN bqms_rfq rfq  ON rfq.id  = rc.rfq_id
        LEFT JOIN sales_orders so ON so.id  = rc.sales_order_id
        LEFT JOIN supplier_quotes sq ON sq.id = rc.supplier_quote_id
        LEFT JOIN purchase_orders po ON po.id = rc.po_id
        LEFT JOIN shipments sh ON sh.id = rc.shipment_id
        LEFT JOIN invoices inv ON inv.id = rc.invoice_id
        LEFT JOIN customers c ON c.id = so.customer_id
        WHERE {where}
        ORDER BY rc.updated_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    data = []
    for r in rows:
        row_dict = dict(r)
        row_dict["completion_pct"] = _stage_pct(row_dict.get("current_stage", "rfq"))
        data.append(row_dict)

    return {"data": data, "total": total}


@router.get("/{chain_code}")
async def get_deal_chain_detail(
    chain_code: str,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Full chain detail: RFQ → Quotation → SO → Supplier Quote → PO → Shipment → Invoice → Payment → Margin.
    """
    chain = await _get_chain(conn, chain_code)

    # Fetch each entity in the chain
    result: dict = {
        "chain": chain,
        "completion_pct": _stage_pct(chain.get("current_stage", "rfq")),
        "rfq": None,
        "sales_order": None,
        "supplier_quote": None,
        "purchase_order": None,
        "shipment": None,
        "invoice": None,
        "payments": [],
        "events": [],
    }

    # RFQ
    if chain.get("rfq_id"):
        rfq = await conn.fetchrow("SELECT * FROM bqms_rfq WHERE id = $1", chain["rfq_id"])
        result["rfq"] = dict(rfq) if rfq else None

    # Sales Order + line items
    if chain.get("sales_order_id"):
        so = await conn.fetchrow(
            """
            SELECT so.*, c.company_name AS customer_name
            FROM sales_orders so
            LEFT JOIN customers c ON c.id = so.customer_id
            WHERE so.id = $1
            """,
            chain["sales_order_id"],
        )
        if so:
            so_dict = dict(so)
            so_lines = await conn.fetch(
                "SELECT * FROM so_line_items WHERE so_id = $1 ORDER BY line_number ASC",
                chain["sales_order_id"],
            )
            so_dict["line_items"] = [dict(r) for r in so_lines]
            result["sales_order"] = so_dict

    # Supplier Quote + items
    if chain.get("supplier_quote_id"):
        sq = await conn.fetchrow(
            """
            SELECT sq.*, s.name AS supplier_name
            FROM supplier_quotes sq
            LEFT JOIN suppliers s ON s.id = sq.supplier_id
            WHERE sq.id = $1
            """,
            chain["supplier_quote_id"],
        )
        if sq:
            sq_dict = dict(sq)
            sq_items = await conn.fetch(
                "SELECT * FROM supplier_quote_items WHERE quote_id = $1 ORDER BY line_number ASC",
                chain["supplier_quote_id"],
            )
            sq_dict["items"] = [dict(r) for r in sq_items]
            result["supplier_quote"] = sq_dict

    # Purchase Order + line items
    if chain.get("po_id"):
        po = await conn.fetchrow(
            """
            SELECT po.*, s.name AS supplier_name
            FROM purchase_orders po
            LEFT JOIN suppliers s ON s.id = po.supplier_id
            WHERE po.id = $1
            """,
            chain["po_id"],
        )
        if po:
            po_dict = dict(po)
            po_lines = await conn.fetch(
                """
                SELECT pol.*, p.product_name FROM po_line_items pol
                LEFT JOIN products p ON p.id = pol.product_id
                WHERE pol.po_id = $1 ORDER BY pol.line_number ASC
                """,
                chain["po_id"],
            )
            po_dict["line_items"] = [dict(r) for r in po_lines]
            result["purchase_order"] = po_dict

    # Shipment + items + timeline
    if chain.get("shipment_id"):
        sh = await conn.fetchrow(
            """
            SELECT sh.*, s.name AS supplier_name
            FROM shipments sh
            LEFT JOIN suppliers s ON s.id = sh.supplier_id
            WHERE sh.id = $1
            """,
            chain["shipment_id"],
        )
        if sh:
            sh_dict = dict(sh)
            sh_items = await conn.fetch(
                """
                SELECT shi.*, p.product_name FROM shipment_items shi
                LEFT JOIN products p ON p.id = shi.product_id
                WHERE shi.shipment_id = $1 ORDER BY shi.id ASC
                """,
                chain["shipment_id"],
            )
            sh_dict["items"] = [dict(r) for r in sh_items]
            result["shipment"] = sh_dict

    # Invoice + items
    if chain.get("invoice_id"):
        inv = await conn.fetchrow(
            """
            SELECT inv.*, c.company_name AS customer_name
            FROM invoices inv
            LEFT JOIN customers c ON c.id = inv.customer_id
            WHERE inv.id = $1
            """,
            chain["invoice_id"],
        )
        if inv:
            inv_dict = dict(inv)
            inv_items = await conn.fetch(
                "SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY line_number ASC",
                chain["invoice_id"],
            )
            inv_dict["items"] = [dict(r) for r in inv_items]
            result["invoice"] = inv_dict

    # Payment transactions
    if chain.get("ar_id"):
        payments = await conn.fetch(
            """
            SELECT * FROM payment_transactions
            WHERE ar_id = $1
            ORDER BY created_at DESC
            """,
            chain["ar_id"],
        )
        result["payments"] = [dict(r) for r in payments]

    # Domain events (audit trail)
    events = await conn.fetch(
        """
        SELECT event_type, aggregate_type, aggregate_id, payload, created_at
        FROM domain_events
        WHERE chain_code = $1
        ORDER BY created_at ASC
        """,
        chain_code,
    )
    result["events"] = [dict(r) for r in events]

    # Deal margin summary if available
    margin = await conn.fetchrow(
        "SELECT * FROM deal_margins WHERE chain_code = $1", chain_code
    )
    result["margin"] = dict(margin) if margin else None

    return {"data": result}


@router.get("/{chain_code}/margin")
async def get_chain_margin(
    chain_code: str,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Margin breakdown for a deal chain: revenue vs all costs.
    Calculates live from linked entities if deal_margins row not present.
    """
    chain = await _get_chain(conn, chain_code)

    # Try pre-calculated first
    margin_row = await conn.fetchrow(
        "SELECT * FROM deal_margins WHERE chain_code = $1", chain_code
    )

    if margin_row:
        row_data = dict(margin_row)
        row_data.setdefault("rate_missing", False)
        return {"data": row_data, "source": "pre_calculated"}

    # Live calculation
    revenue_vnd = 0.0
    cogs_vnd = 0.0
    freight_vnd: float | None = 0.0
    customs_duty_vnd = 0.0
    other_costs_vnd = 0.0
    rate_missing = False  # W0-15: true khi cần quy đổi USD->VND mà exchange_rates rỗng

    # Revenue: from invoice
    if chain.get("invoice_id"):
        inv = await conn.fetchrow(
            "SELECT total_amount, currency FROM invoices WHERE id = $1",
            chain["invoice_id"],
        )
        if inv:
            revenue_vnd = float(inv["total_amount"] or 0)

    # COGS: from purchase_order (amount_vnd)
    if chain.get("po_id"):
        po = await conn.fetchrow(
            "SELECT amount_vnd, total_amount FROM purchase_orders WHERE id = $1",
            chain["po_id"],
        )
        if po:
            cogs_vnd = float(po.get("amount_vnd") or po.get("total_amount") or 0)

    # Freight + customs: from shipment
    if chain.get("shipment_id"):
        sh = await conn.fetchrow(
            """
            SELECT freight_cost_usd, customs_duty_vnd, other_costs_vnd
            FROM shipments WHERE id = $1
            """,
            chain["shipment_id"],
        )
        if sh:
            # Convert freight USD to VND using latest rate
            usd_rate = await conn.fetchval(
                """
                SELECT rate FROM exchange_rates
                WHERE from_currency = 'USD' AND to_currency = 'VND'
                ORDER BY rate_date DESC LIMIT 1
                """
            )
            freight_usd = float(sh.get("freight_cost_usd") or 0)
            if usd_rate:
                freight_vnd = round(freight_usd * float(usd_rate), 2)
            elif freight_usd > 0:
                # Không có tỷ giá thật -> KHÔNG bịa hằng cứng (W0-15). Để null.
                rate_missing = True
                freight_vnd = None
                logger.warning(
                    "deal_chain margin(%s): exchange_rates rỗng (USD->VND) — "
                    "freight_usd=%.2f không quy đổi được, freight_vnd=null.",
                    chain_code, freight_usd,
                )
            else:
                freight_vnd = 0.0
            customs_duty_vnd = float(sh.get("customs_duty_vnd") or 0)
            other_costs_vnd = float(sh.get("other_costs_vnd") or 0)

    if freight_vnd is None:
        # Chi phí phụ thuộc rate không tính được -> để null thay vì số bịa.
        total_cost_vnd = None
        gross_profit_vnd = None
        margin_pct = None
        is_profitable = None
        meets_threshold = None
    else:
        total_cost_vnd = cogs_vnd + freight_vnd + customs_duty_vnd + other_costs_vnd
        gross_profit_vnd = revenue_vnd - total_cost_vnd
        margin_pct = (gross_profit_vnd / revenue_vnd * 100) if revenue_vnd > 0 else 0.0
        is_profitable = gross_profit_vnd > 0
        meets_threshold = margin_pct >= 15.0

    breakdown = {
        "chain_code": chain_code,
        "revenue_vnd": round(revenue_vnd, 2),
        "costs": {
            "cogs_vnd": round(cogs_vnd, 2),
            "freight_vnd": round(freight_vnd, 2) if freight_vnd is not None else None,
            "customs_duty_vnd": round(customs_duty_vnd, 2),
            "other_costs_vnd": round(other_costs_vnd, 2),
            "total_cost_vnd": round(total_cost_vnd, 2) if total_cost_vnd is not None else None,
        },
        "gross_profit_vnd": round(gross_profit_vnd, 2) if gross_profit_vnd is not None else None,
        "margin_pct": round(margin_pct, 2) if margin_pct is not None else None,
        "is_profitable": is_profitable,
        "meets_threshold": meets_threshold,
        "rate_missing": rate_missing,
    }

    # Persist the calculated margin — bỏ qua khi rate_missing để KHÔNG ghi số bịa
    # vào deal_margins (freight_vnd NOT NULL DEFAULT 0, generated cols phụ thuộc nó).
    if not rate_missing:
        await conn.execute(
            """
            INSERT INTO deal_margins
                (chain_code, sales_order_id, invoice_id,
                 revenue_vnd, cogs_vnd, freight_vnd, customs_duty_vnd, other_costs_vnd)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (chain_code) DO UPDATE SET
                revenue_vnd       = EXCLUDED.revenue_vnd,
                cogs_vnd          = EXCLUDED.cogs_vnd,
                freight_vnd       = EXCLUDED.freight_vnd,
                customs_duty_vnd  = EXCLUDED.customs_duty_vnd,
                other_costs_vnd   = EXCLUDED.other_costs_vnd,
                calculated_at     = NOW(),
                updated_at        = NOW()
            """,
            chain_code,
            chain.get("sales_order_id"),
            chain.get("invoice_id"),
            round(revenue_vnd, 2),
            round(cogs_vnd, 2),
            round(freight_vnd, 2),
            round(customs_duty_vnd, 2),
            round(other_costs_vnd, 2),
        )

    return {"data": breakdown, "source": "live_calculated"}
