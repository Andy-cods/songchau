"""
Supplier Quotes API — Request, receive, accept/reject supplier price quotes.
Critical gap between "won RFQ" and "create PO".
"""

from __future__ import annotations

from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class QuoteLineItemIn(BaseModel):
    bqms_code: str
    product_id: int | None = None
    description: str | None = None
    specification: str | None = None
    maker: str | None = None
    quantity: float
    unit: str = "EA"
    samsung_sell_price_vnd: float | None = None  # from SO to calculate margin


class SupplierQuoteCreateRequest(BaseModel):
    supplier_id: int
    rfq_id: int | None = None
    sales_order_id: int | None = None
    chain_code: str | None = None
    currency: str = "CNY"
    valid_until: date | None = None
    incoterm: str = "FOB"
    notes: str | None = None
    items: list[QuoteLineItemIn]


class QuoteReceiveLineItem(BaseModel):
    line_number: int
    unit_price_cny: float
    lead_time_days: int | None = None


class QuoteReceiveRequest(BaseModel):
    received_items: list[QuoteReceiveLineItem]
    lead_time_days: int | None = None
    payment_terms: str | None = None
    notes: str | None = None


class QuoteAcceptRequest(BaseModel):
    expected_delivery_date: date | None = None
    notes: str | None = None


class QuoteRejectRequest(BaseModel):
    reason: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_quote(conn: asyncpg.Connection, quote_id: int) -> dict:
    row = await conn.fetchrow(
        """
        SELECT sq.*, s.name AS supplier_name, s.rating AS supplier_rating,
               s.contact_wechat, s.contact_email
        FROM supplier_quotes sq
        LEFT JOIN suppliers s ON s.id = sq.supplier_id
        WHERE sq.id = $1
        """,
        quote_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Báo giá nhà cung cấp không tồn tại")
    return dict(row)


async def _get_quote_items(conn: asyncpg.Connection, quote_id: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT sqi.*, p.product_name, p.bqms_code AS product_bqms_code
        FROM supplier_quote_items sqi
        LEFT JOIN products p ON p.id = sqi.product_id
        WHERE sqi.quote_id = $1
        ORDER BY sqi.line_number ASC
        """,
        quote_id,
    )
    return [dict(r) for r in rows]


async def _latest_cny_rate(conn: asyncpg.Connection) -> float:
    rate = await conn.fetchval(
        """
        SELECT rate FROM exchange_rates
        WHERE from_currency = 'CNY' AND to_currency = 'VND'
        ORDER BY rate_date DESC LIMIT 1
        """
    )
    return float(rate) if rate else 3450.0


async def _get_po_number_seq(conn: asyncpg.Connection) -> str:
    prefix = f"PO-{date.today().strftime('%Y%m')}-"
    seq = await conn.fetchval(
        "SELECT COALESCE(MAX(SUBSTRING(po_number FROM '\\d+$')::INT), 0) + 1 "
        "FROM purchase_orders WHERE po_number LIKE $1",
        prefix + "%",
    )
    return f"{prefix}{seq:06d}"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_supplier_quotes(
    status: str | None = Query(None),
    supplier_id: int | None = Query(None),
    rfq_id: int | None = Query(None),
    chain_code: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List supplier quotes with optional filters."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if status:
        conditions.append(f"sq.status = ${idx}")
        params.append(status)
        idx += 1
    if supplier_id:
        conditions.append(f"sq.supplier_id = ${idx}")
        params.append(supplier_id)
        idx += 1
    if rfq_id:
        conditions.append(f"sq.rfq_id = ${idx}")
        params.append(rfq_id)
        idx += 1
    if chain_code:
        conditions.append(f"sq.chain_code = ${idx}")
        params.append(chain_code)
        idx += 1

    where = " AND ".join(conditions)
    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM supplier_quotes sq WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT sq.*, s.name AS supplier_name, s.rating AS supplier_rating,
               s.contact_wechat,
               (SELECT COUNT(*) FROM supplier_quote_items WHERE quote_id = sq.id) AS item_count
        FROM supplier_quotes sq
        LEFT JOIN suppliers s ON s.id = sq.supplier_id
        WHERE {where}
        ORDER BY sq.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("", status_code=201)
async def create_supplier_quote(
    body: SupplierQuoteCreateRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Create a new quote request to send to a Chinese supplier."""
    if not body.items:
        raise HTTPException(status_code=400, detail="Yêu cầu báo giá phải có ít nhất 1 sản phẩm")

    # Verify supplier exists
    supplier = await conn.fetchrow(
        "SELECT id, name, rating FROM suppliers WHERE id = $1 AND deleted_at IS NULL",
        body.supplier_id,
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Nhà cung cấp không tồn tại")

    exchange_rate = await _latest_cny_rate(conn)

    async with conn.transaction():
        quote = await conn.fetchrow(
            """
            INSERT INTO supplier_quotes
                (supplier_id, rfq_id, sales_order_id, chain_code, currency,
                 exchange_rate, valid_until, incoterm, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)
            RETURNING *
            """,
            body.supplier_id,
            body.rfq_id,
            body.sales_order_id,
            body.chain_code,
            body.currency,
            exchange_rate,
            body.valid_until,
            body.incoterm,
            body.notes,
            token_data.user_id,
        )
        quote_id = quote["id"]

        for i, item in enumerate(body.items, start=1):
            await conn.execute(
                """
                INSERT INTO supplier_quote_items
                    (quote_id, line_number, bqms_code, product_id, description,
                     specification, maker, quantity, unit, samsung_sell_price_vnd)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """,
                quote_id, i, item.bqms_code, item.product_id, item.description,
                item.specification, item.maker, item.quantity, item.unit,
                item.samsung_sell_price_vnd,
            )

        # Update revenue_chain if chain_code provided
        if body.chain_code:
            await conn.execute(
                """
                INSERT INTO revenue_chain (chain_code, rfq_id, sales_order_id, supplier_quote_id, current_stage, created_by)
                VALUES ($1, $2, $3, $4, 'supplier_quote', $5::uuid)
                ON CONFLICT (chain_code) DO UPDATE
                    SET supplier_quote_id = EXCLUDED.supplier_quote_id,
                        current_stage = 'supplier_quote',
                        updated_at = NOW()
                """,
                body.chain_code, body.rfq_id, body.sales_order_id, quote_id, token_data.user_id,
            )

        # Emit domain event
        await conn.execute(
            """
            INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
            VALUES ('supplier_quote.requested', 'supplier_quote', $1, $2, $3, $4::uuid)
            """,
            str(quote_id),
            f'{{"supplier_id": {body.supplier_id}, "item_count": {len(body.items)}}}',
            body.chain_code,
            token_data.user_id,
        )

    return {
        "data": dict(quote),
        "message": f"Đã tạo yêu cầu báo giá {quote['quote_number']} gửi đến {supplier['name']}",
    }


@router.get("/suggest")
async def suggest_suppliers(
    bqms_code: str = Query(..., description="BQMS code cần tìm nhà cung cấp phù hợp"),
    limit: int = Query(10, ge=1, le=50),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Find best suppliers for a given BQMS code from supplier_product_map."""
    rows = await conn.fetch(
        """
        SELECT spm.*, s.name AS supplier_name, s.rating AS supplier_rating,
               s.contact_wechat, s.contact_email, s.country, s.lead_time_days AS supplier_default_lead_time,
               s.is_active
        FROM supplier_product_map spm
        JOIN suppliers s ON s.id = spm.supplier_id
        WHERE spm.bqms_code = $1
          AND s.is_active = true
          AND s.deleted_at IS NULL
        ORDER BY spm.is_preferred DESC, s.rating DESC NULLS LAST, spm.quality_score DESC NULLS LAST
        LIMIT $2
        """,
        bqms_code, limit,
    )

    if not rows:
        # Fuzzy fallback: find suppliers who handle similar codes
        rows = await conn.fetch(
            """
            SELECT spm.*, s.name AS supplier_name, s.rating AS supplier_rating,
                   s.contact_wechat, s.contact_email, s.country, s.is_active
            FROM supplier_product_map spm
            JOIN suppliers s ON s.id = spm.supplier_id
            WHERE spm.bqms_code ILIKE $1
              AND s.is_active = true
              AND s.deleted_at IS NULL
            ORDER BY s.rating DESC NULLS LAST
            LIMIT $2
            """,
            f"{bqms_code[:4]}%", limit,
        )

    return {
        "data": [dict(r) for r in rows],
        "total": len(rows),
        "message": f"Tìm thấy {len(rows)} nhà cung cấp cho mã {bqms_code}",
    }


@router.get("/{quote_id}")
async def get_supplier_quote(
    quote_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Get quote detail with items and margin calculation."""
    quote = await _get_quote(conn, quote_id)
    items = await _get_quote_items(conn, quote_id)

    # Calculate overall margin if prices are available
    margin_summary = None
    if items:
        total_sell_vnd = sum(
            (i.get("samsung_sell_price_vnd") or 0) * i["quantity"] for i in items
        )
        total_buy_vnd = sum((i.get("line_total_vnd") or 0) for i in items)
        if total_sell_vnd > 0:
            margin_pct = (total_sell_vnd - total_buy_vnd) / total_sell_vnd * 100
            margin_summary = {
                "total_sell_vnd": total_sell_vnd,
                "total_buy_vnd": total_buy_vnd,
                "gross_profit_vnd": total_sell_vnd - total_buy_vnd,
                "margin_pct": round(margin_pct, 2),
                "meets_threshold": margin_pct >= 15,
            }

    quote["items"] = items
    quote["margin_summary"] = margin_summary
    return {"data": quote}


@router.post("/{quote_id}/receive")
async def receive_supplier_quote(
    quote_id: int,
    body: QuoteReceiveRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Record supplier's price response — update items with prices."""
    quote = await _get_quote(conn, quote_id)
    if quote["status"] not in ("requested", "received"):
        raise HTTPException(
            status_code=400,
            detail="Chỉ có thể cập nhật giá cho báo giá đang ở trạng thái 'requested' hoặc 'received'",
        )

    exchange_rate = float(quote.get("exchange_rate") or 0) or await _latest_cny_rate(conn)

    line_map = {item["line_number"]: item["unit_price_cny"] for item in body.received_items}
    lead_map = {item["line_number"]: item.get("lead_time_days") for item in body.received_items}

    async with conn.transaction():
        # Update each line item with received price
        total_cny = 0.0
        total_vnd = 0.0

        items = await _get_quote_items(conn, quote_id)
        for item in items:
            ln = item["line_number"]
            if ln in line_map:
                price_cny = line_map[ln]
                price_vnd = round(price_cny * exchange_rate, 2)
                line_total_cny = round(price_cny * float(item["quantity"]), 2)
                line_total_vnd = round(price_vnd * float(item["quantity"]), 2)
                sell_price = float(item.get("samsung_sell_price_vnd") or 0)
                margin_pct = None
                if sell_price > 0 and line_total_vnd > 0:
                    margin_pct = round(
                        (sell_price * float(item["quantity"]) - line_total_vnd)
                        / (sell_price * float(item["quantity"])) * 100, 2
                    )

                await conn.execute(
                    """
                    UPDATE supplier_quote_items SET
                        unit_price_cny = $1,
                        unit_price_vnd = $2,
                        line_total_cny = $3,
                        line_total_vnd = $4,
                        margin_pct     = $5,
                        lead_time_days = COALESCE($6, lead_time_days)
                    WHERE quote_id = $7 AND line_number = $8
                    """,
                    price_cny, price_vnd, line_total_cny, line_total_vnd,
                    margin_pct, lead_map.get(ln), quote_id, ln,
                )
                total_cny += line_total_cny
                total_vnd += line_total_vnd

        # Update quote header
        updated = await conn.fetchrow(
            """
            UPDATE supplier_quotes SET
                status           = 'received',
                received_at      = NOW(),
                total_amount_cny = $1,
                total_amount_vnd = $2,
                lead_time_days   = COALESCE($3, lead_time_days),
                payment_terms    = COALESCE($4, payment_terms),
                notes            = COALESCE($5, notes),
                updated_at       = NOW()
            WHERE id = $6
            RETURNING *
            """,
            round(total_cny, 2),
            round(total_vnd, 2),
            body.lead_time_days,
            body.payment_terms,
            body.notes,
            quote_id,
        )

        await conn.execute(
            """
            INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
            VALUES ('supplier_quote.received', 'supplier_quote', $1, $2, $3, $4::uuid)
            """,
            str(quote_id),
            f'{{"total_cny": {round(total_cny, 2)}, "total_vnd": {round(total_vnd, 2)}}}',
            quote.get("chain_code"),
            token_data.user_id,
        )

    return {
        "data": dict(updated),
        "message": f"Đã cập nhật giá báo giá {updated['quote_number']}",
    }


@router.post("/{quote_id}/accept")
async def accept_supplier_quote(
    quote_id: int,
    body: QuoteAcceptRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Accept a supplier quote.
    - Calculate margin.
    - If margin >= 15% and supplier.rating >= 3.5 → auto-create PO.
    - If margin < 15% → create PO but flag needs_review=true.
    - Links chain entities.
    """
    quote = await _get_quote(conn, quote_id)
    if quote["status"] != "received":
        raise HTTPException(
            status_code=400,
            detail="Chỉ có thể chấp nhận báo giá đã nhận giá từ nhà cung cấp (status='received')",
        )

    items = await _get_quote_items(conn, quote_id)
    if not items:
        raise HTTPException(status_code=400, detail="Báo giá không có sản phẩm nào")

    # Calculate overall margin
    total_sell_vnd = sum(
        (float(i.get("samsung_sell_price_vnd") or 0)) * float(i["quantity"]) for i in items
    )
    total_buy_vnd = sum(float(i.get("line_total_vnd") or 0) for i in items)

    if total_sell_vnd > 0:
        margin_pct = (total_sell_vnd - total_buy_vnd) / total_sell_vnd * 100
    else:
        margin_pct = 0.0

    needs_review = margin_pct < 15.0
    supplier_rating = float(quote.get("supplier_rating") or 0)

    # Determine needs_review based on both conditions
    if supplier_rating < 3.5:
        needs_review = True

    po_number = await _get_po_number_seq(conn)

    async with conn.transaction():
        # Create the PO
        po = await conn.fetchrow(
            """
            INSERT INTO purchase_orders
                (supplier_id, supplier_quote_id, sales_order_id, chain_code,
                 po_number, expected_date, notes, total_amount, currency,
                 exchange_rate, amount_vnd, needs_review, status, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13::uuid)
            RETURNING *
            """,
            quote["supplier_id"],
            quote_id,
            quote.get("sales_order_id"),
            quote.get("chain_code"),
            po_number,
            body.expected_delivery_date,
            body.notes or quote.get("notes"),
            float(quote.get("total_amount_cny") or 0),
            quote.get("currency", "CNY"),
            float(quote.get("exchange_rate") or 0),
            round(total_buy_vnd, 2),
            needs_review,
            token_data.user_id,
        )
        po_id = po["id"]

        # Insert PO line items from quote items
        for i, item in enumerate(items, start=1):
            # Find or resolve product_id
            product_id = item.get("product_id")
            if not product_id and item.get("bqms_code"):
                product_id = await conn.fetchval(
                    "SELECT id FROM products WHERE bqms_code = $1 LIMIT 1",
                    item["bqms_code"],
                )

            await conn.execute(
                """
                INSERT INTO po_line_items
                    (po_id, product_id, product_code, quantity, unit,
                     unit_price, line_total, line_number, note)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                po_id,
                product_id,
                item.get("bqms_code"),
                float(item["quantity"]),
                item.get("unit", "EA"),
                float(item.get("unit_price_cny") or 0),
                float(item.get("line_total_cny") or 0),
                i,
                item.get("notes"),
            )

        # Accept the quote and store margin
        await conn.execute(
            """
            UPDATE supplier_quotes SET
                status      = 'accepted',
                margin_pct  = $1,
                updated_at  = NOW()
            WHERE id = $2
            """,
            round(margin_pct, 2),
            quote_id,
        )

        # Update supplier_product_map with latest pricing
        for item in items:
            if item.get("unit_price_cny"):
                await conn.execute(
                    """
                    INSERT INTO supplier_product_map
                        (supplier_id, bqms_code, product_id, typical_price_cny, last_quoted_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (supplier_id, bqms_code) DO UPDATE
                        SET typical_price_cny = EXCLUDED.typical_price_cny,
                            last_quoted_at    = NOW(),
                            updated_at        = NOW()
                    """,
                    quote["supplier_id"],
                    item["bqms_code"],
                    item.get("product_id"),
                    float(item.get("unit_price_cny") or 0),
                )

        # Update revenue_chain if linked
        if quote.get("chain_code"):
            await conn.execute(
                """
                INSERT INTO revenue_chain
                    (chain_code, supplier_quote_id, po_id, current_stage, revenue_vnd, cogs_vnd, margin_pct, created_by)
                VALUES ($1, $2, $3, 'po', $4, $5, $6, $7::uuid)
                ON CONFLICT (chain_code) DO UPDATE
                    SET supplier_quote_id = EXCLUDED.supplier_quote_id,
                        po_id             = EXCLUDED.po_id,
                        current_stage     = 'po',
                        revenue_vnd       = EXCLUDED.revenue_vnd,
                        cogs_vnd          = EXCLUDED.cogs_vnd,
                        margin_pct        = EXCLUDED.margin_pct,
                        updated_at        = NOW()
                """,
                quote.get("chain_code"),
                quote_id,
                po_id,
                round(total_sell_vnd, 2),
                round(total_buy_vnd, 2),
                round(margin_pct, 2),
                token_data.user_id,
            )

        # Emit domain event
        await conn.execute(
            """
            INSERT INTO domain_events
                (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
            VALUES ('supplier_quote.accepted', 'supplier_quote', $1, $2, $3, $4::uuid)
            """,
            str(quote_id),
            f'{{"po_id": {po_id}, "margin_pct": {round(margin_pct, 2)}, "needs_review": {str(needs_review).lower()}}}',
            quote.get("chain_code"),
            token_data.user_id,
        )

    review_msg = " — Cần xem xét thêm (margin thấp hoặc NCC rating thấp)" if needs_review else ""
    return {
        "data": {
            "quote_id": quote_id,
            "po_id": po_id,
            "po_number": po_number,
            "margin_pct": round(margin_pct, 2),
            "needs_review": needs_review,
            "total_buy_vnd": round(total_buy_vnd, 2),
            "total_sell_vnd": round(total_sell_vnd, 2),
        },
        "message": f"Đã chấp nhận báo giá và tạo PO {po_number}{review_msg}",
    }


@router.post("/{quote_id}/reject")
async def reject_supplier_quote(
    quote_id: int,
    body: QuoteRejectRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Reject a supplier quote with a reason."""
    quote = await _get_quote(conn, quote_id)
    if quote["status"] not in ("requested", "received"):
        raise HTTPException(
            status_code=400,
            detail="Chỉ có thể từ chối báo giá đang ở trạng thái 'requested' hoặc 'received'",
        )

    updated = await conn.fetchrow(
        """
        UPDATE supplier_quotes SET
            status           = 'rejected',
            rejection_reason = $1,
            updated_at       = NOW()
        WHERE id = $2
        RETURNING *
        """,
        body.reason,
        quote_id,
    )

    await conn.execute(
        """
        INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
        VALUES ('supplier_quote.rejected', 'supplier_quote', $1, $2, $3, $4::uuid)
        """,
        str(quote_id),
        f'{{"reason": "{body.reason[:200]}"}}',
        quote.get("chain_code"),
        token_data.user_id,
    )

    return {
        "data": dict(updated),
        "message": f"Đã từ chối báo giá {updated['quote_number']}",
    }
