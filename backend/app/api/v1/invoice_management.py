"""
Invoice Management API — Create, send, and track invoices to Samsung/customers.
Auto-generates from delivered sales orders, integrates with AR, and sends via email.
"""

from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
import asyncpg
import httpx

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()

# Configuration
GOTENBERG_URL = os.getenv("GOTENBERG_URL", "http://gotenberg:3000")
GRAPH_API_URL = "https://graph.microsoft.com/v1.0"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class InvoiceAutoGenerateRequest(BaseModel):
    sales_order_id: int
    invoice_date: date | None = None       # defaults to today
    due_date: date | None = None           # defaults to invoice_date + 30 days
    payment_terms: str = "NET30"
    bank_account: str | None = None
    notes: str | None = None


class InvoiceSendRequest(BaseModel):
    recipient_email: str
    cc_emails: list[str] = []
    subject: str | None = None
    body_message: str | None = None


class RecordPaymentRequest(BaseModel):
    payment_date: date
    amount: float
    currency: str = "VND"
    payment_method: str | None = None
    bank_ref: str | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_invoice(conn: asyncpg.Connection, invoice_id: int) -> dict:
    row = await conn.fetchrow(
        """
        SELECT inv.*, c.company_name AS customer_name, c.short_name AS customer_short_name,
               so.order_number AS so_number
        FROM invoices inv
        LEFT JOIN customers c ON c.id = inv.customer_id
        LEFT JOIN sales_orders so ON so.id = inv.sales_order_id
        WHERE inv.id = $1
        """,
        invoice_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Hóa đơn không tồn tại")
    return dict(row)


async def _get_next_invoice_number(conn: asyncpg.Connection) -> str:
    """Generate invoice number: INV-YYYYMM-NNNNNN."""
    prefix = f"INV-{date.today().strftime('%Y%m')}-"
    seq = await conn.fetchval(
        "SELECT COALESCE(MAX(SUBSTRING(invoice_number FROM '\\d+$')::INT), 0) + 1 "
        "FROM invoices WHERE invoice_number LIKE $1",
        prefix + "%",
    )
    return f"{prefix}{seq:06d}"


async def _generate_pdf_background(invoice_id: int, invoice_number: str) -> None:
    """Generate PDF via Gotenberg (called as background task)."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {
                "url": f"{os.getenv('FRONTEND_URL', 'http://frontend:3000')}"
                       f"/print/invoice/{invoice_id}",
                "paperWidth": "210mm",
                "paperHeight": "297mm",
                "marginTop": "10mm",
                "marginBottom": "10mm",
                "marginLeft": "10mm",
                "marginRight": "10mm",
            }
            resp = await client.post(
                f"{GOTENBERG_URL}/forms/chromium/convert/url",
                data=payload,
            )
            if resp.status_code == 200:
                pdf_dir = os.getenv("INVOICE_PDF_DIR", "/app/files/invoices")
                os.makedirs(pdf_dir, exist_ok=True)
                pdf_path = f"{pdf_dir}/{invoice_number}.pdf"
                with open(pdf_path, "wb") as f:
                    f.write(resp.content)
                logger.info("PDF generated for invoice %s at %s", invoice_number, pdf_path)
    except Exception as exc:
        logger.error("PDF generation failed for invoice %s: %s", invoice_number, exc)


async def _send_email_graph(
    invoice: dict,
    items: list[dict],
    send_req: InvoiceSendRequest,
) -> bool:
    """Send invoice via Microsoft Graph API."""
    graph_token = os.getenv("GRAPH_API_ACCESS_TOKEN")
    sender_email = os.getenv("GRAPH_SENDER_EMAIL", "accounting@songchau.com.vn")
    if not graph_token:
        logger.warning("GRAPH_API_ACCESS_TOKEN not configured — skipping email send")
        return False

    subject = send_req.subject or f"Hóa đơn {invoice['invoice_number']} — Song Chau Co., Ltd"
    body_html = f"""
    <p>Kính gửi Quý Khách hàng,</p>
    <p>Song Chau Co., Ltd xin gửi hóa đơn <strong>{invoice['invoice_number']}</strong>
    với tổng giá trị <strong>{invoice['total_amount']:,.0f} {invoice['currency']}</strong>.</p>
    <p>Hạn thanh toán: <strong>{invoice['due_date']}</strong></p>
    {f'<p>{send_req.body_message}</p>' if send_req.body_message else ''}
    <p>Trân trọng,<br>Phòng Kế Toán — Song Chau Co., Ltd</p>
    """

    to_recipients = [{"emailAddress": {"address": send_req.recipient_email}}]
    cc_recipients = [{"emailAddress": {"address": e}} for e in send_req.cc_emails]

    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": body_html},
            "toRecipients": to_recipients,
            "ccRecipients": cc_recipients,
        },
        "saveToSentItems": True,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{GRAPH_API_URL}/users/{sender_email}/sendMail",
                json=payload,
                headers={
                    "Authorization": f"Bearer {graph_token}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            return True
    except httpx.HTTPStatusError as exc:
        logger.error("Graph API email send failed: %s", exc.response.text)
        return False
    except Exception as exc:
        logger.error("Email send error: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_invoices(
    status: str | None = Query(None),
    customer_id: int | None = Query(None),
    chain_code: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List invoices with optional filters."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if status:
        conditions.append(f"inv.status = ${idx}")
        params.append(status)
        idx += 1
    if customer_id:
        conditions.append(f"inv.customer_id = ${idx}")
        params.append(customer_id)
        idx += 1
    if chain_code:
        conditions.append(f"inv.chain_code = ${idx}")
        params.append(chain_code)
        idx += 1

    where = " AND ".join(conditions)
    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM invoices inv WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT inv.*, c.company_name AS customer_name,
               so.order_number AS so_number
        FROM invoices inv
        LEFT JOIN customers c ON c.id = inv.customer_id
        LEFT JOIN sales_orders so ON so.id = inv.sales_order_id
        WHERE {where}
        ORDER BY inv.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("/auto-generate", status_code=201)
async def auto_generate_invoice(
    body: InvoiceAutoGenerateRequest,
    background_tasks: BackgroundTasks,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Auto-create invoice from a delivered sales order.
    - Generates invoice_number INV-YYYYMM-NNNNNN.
    - Creates invoice_items from SO line items.
    - Creates accounts_receivable entry.
    - Triggers PDF generation via Gotenberg.
    """
    # Fetch SO with line items
    so = await conn.fetchrow(
        """
        SELECT so.*, c.company_name AS customer_name, c.short_name AS customer_short_name
        FROM sales_orders so
        LEFT JOIN customers c ON c.id = so.customer_id
        WHERE so.id = $1
        """,
        body.sales_order_id,
    )
    if not so:
        raise HTTPException(status_code=404, detail="Đơn bán hàng không tồn tại")

    if so["status"] not in ("delivered", "approved", "completed", "shipped"):
        raise HTTPException(
            status_code=400,
            detail=f"Chỉ tạo hóa đơn cho đơn hàng đã giao. Trạng thái hiện tại: {so['status']}",
        )

    # Check if invoice already exists for this SO
    existing = await conn.fetchval(
        "SELECT id FROM invoices WHERE sales_order_id = $1 AND status != 'cancelled'",
        body.sales_order_id,
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Hóa đơn cho đơn hàng này đã tồn tại (ID: {existing})",
        )

    # Fetch SO line items
    so_lines = await conn.fetch(
        """
        SELECT * FROM so_line_items
        WHERE so_id = $1
        ORDER BY line_number ASC
        """,
        body.sales_order_id,
    )
    if not so_lines:
        raise HTTPException(
            status_code=400,
            detail="Đơn hàng không có sản phẩm nào",
        )

    invoice_date = body.invoice_date or date.today()
    due_date = body.due_date or (invoice_date + timedelta(days=30))

    # Calculate totals from SO lines
    subtotal = float(so.get("subtotal_amount") or so.get("total_amount") or 0)
    vat_amount = 0.0
    invoice_items_data = []

    for line in so_lines:
        qty = float(line.get("quantity") or 0)
        price = float(line.get("unit_price") or 0)
        vat_rate = float(line.get("vat_rate") or 10)
        line_subtotal = qty * price
        line_vat = round(line_subtotal * vat_rate / 100, 2)
        vat_amount += line_vat
        invoice_items_data.append({
            "so_line_id": line["id"],
            "product_id": line.get("product_id"),
            "bqms_code": line.get("product_code") or line.get("bqms_code"),
            "description": line.get("product_name") or line.get("description") or "Hàng hóa",
            "specification": line.get("specification"),
            "unit": line.get("unit", "EA"),
            "quantity": qty,
            "unit_price": price,
            "vat_rate": vat_rate,
            "line_number": int(line.get("line_number") or 0),
        })

    vat_amount = round(vat_amount, 2)
    total_amount = round(subtotal + vat_amount, 2)

    async with conn.transaction():
        invoice_number = await _get_next_invoice_number(conn)

        invoice = await conn.fetchrow(
            """
            INSERT INTO invoices
                (invoice_number, customer_id, sales_order_id, chain_code,
                 status, invoice_date, due_date, currency,
                 subtotal, vat_amount, total_amount, paid_amount,
                 payment_terms, bank_account, notes, created_by)
            VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, 0, $11, $12, $13, $14::uuid)
            RETURNING *
            """,
            invoice_number,
            so["customer_id"],
            body.sales_order_id,
            so.get("chain_code"),
            invoice_date,
            due_date,
            so.get("currency", "VND"),
            subtotal,
            vat_amount,
            total_amount,
            body.payment_terms,
            body.bank_account,
            body.notes,
            token_data.user_id,
        )
        invoice_id = invoice["id"]

        for i, item in enumerate(invoice_items_data, start=1):
            await conn.execute(
                """
                INSERT INTO invoice_items
                    (invoice_id, line_number, so_line_id, product_id, bqms_code,
                     description, specification, unit, quantity, unit_price, vat_rate)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                """,
                invoice_id,
                item.get("line_number") or i,
                item.get("so_line_id"),
                item.get("product_id"),
                item.get("bqms_code"),
                item["description"],
                item.get("specification"),
                item["unit"],
                item["quantity"],
                item["unit_price"],
                item["vat_rate"],
            )

        # Create accounts_receivable entry
        ar = await conn.fetchrow(
            """
            INSERT INTO accounts_receivable
                (customer_id, sales_order_id,
                 invoice_date, due_date, amount, currency,
                 paid_amount, status, created_by)
            VALUES ($1, $2, $3, $4, $5, $6::currency_code, 0, 'pending', $7::uuid)
            ON CONFLICT DO NOTHING
            RETURNING *
            """,
            # QC fix 2026-06-17: dropped invoice_id/invoice_number — accounts_receivable.invoice_id
            # FK targets revenue_invoices(id), NOT this module's `invoices` table, so writing
            # invoices.id here raised 23503 and aborted invoice creation. AR↔invoice link is kept
            # via the reverse `UPDATE invoices SET ar_id` below. Enum 'pending' + NOT NULL cols stay.
            so["customer_id"],
            body.sales_order_id,
            invoice_date,
            due_date,
            total_amount,
            so.get("currency", "VND"),
            token_data.user_id,
        )

        if ar:
            # Link AR to invoice
            await conn.execute(
                "UPDATE invoices SET ar_id = $1 WHERE id = $2",
                ar["id"], invoice_id,
            )

        # Update revenue_chain
        if so.get("chain_code"):
            await conn.execute(
                """
                UPDATE revenue_chain SET
                    invoice_id    = $1,
                    ar_id         = $2,
                    current_stage = 'invoice',
                    revenue_vnd   = $3,
                    updated_at    = NOW()
                WHERE chain_code = $4
                """,
                invoice_id,
                ar["id"] if ar else None,
                total_amount,
                so["chain_code"],
            )

        await conn.execute(
            """
            INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
            VALUES ('invoice.created', 'invoice', $1, $2, $3, $4::uuid)
            """,
            str(invoice_id),
            f'{{"invoice_number": "{invoice_number}", "total_amount": {total_amount}}}',
            so.get("chain_code"),
            token_data.user_id,
        )

    # Kick off PDF generation in background
    background_tasks.add_task(_generate_pdf_background, invoice_id, invoice_number)

    return {
        "data": dict(invoice),
        "message": f"Đã tạo hóa đơn {invoice_number} — {total_amount:,.0f} {so.get('currency', 'VND')}",
    }


@router.get("/overdue")
async def list_overdue_invoices(
    days_overdue: int = Query(0, ge=0, description="Lọc hóa đơn quá hạn ít nhất N ngày"),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List overdue invoices sorted by overdue days descending."""
    rows = await conn.fetch(
        """
        SELECT inv.*,
               c.company_name AS customer_name,
               so.order_number AS so_number,
               CURRENT_DATE - inv.due_date AS days_overdue
        FROM invoices inv
        LEFT JOIN customers c ON c.id = inv.customer_id
        LEFT JOIN sales_orders so ON so.id = inv.sales_order_id
        WHERE inv.status NOT IN ('paid', 'cancelled')
          AND inv.due_date < CURRENT_DATE - $1
        ORDER BY days_overdue DESC
        LIMIT $2
        """,
        days_overdue,
        limit,
    )

    # Auto-update status to 'overdue' for newly discovered overdue invoices
    overdue_ids = [r["id"] for r in rows if r["status"] not in ("overdue", "disputed", "partially_paid")]
    if overdue_ids:
        await conn.execute(
            "UPDATE invoices SET status = 'overdue', updated_at = NOW() WHERE id = ANY($1::bigint[])",
            overdue_ids,
        )

    return {
        "data": [dict(r) for r in rows],
        "total": len(rows),
        "message": f"Có {len(rows)} hóa đơn quá hạn",
    }


@router.get("/{invoice_id}")
async def get_invoice(
    invoice_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Get invoice detail with line items."""
    invoice = await _get_invoice(conn, invoice_id)
    items = await conn.fetch(
        """
        SELECT ii.*, p.product_name
        FROM invoice_items ii
        LEFT JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = $1
        ORDER BY ii.line_number ASC
        """,
        invoice_id,
    )
    invoice["items"] = [dict(r) for r in items]
    return {"data": invoice}


@router.post("/{invoice_id}/send")
async def send_invoice(
    invoice_id: int,
    body: InvoiceSendRequest,
    background_tasks: BackgroundTasks,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Send invoice via Microsoft Graph API email."""
    invoice = await _get_invoice(conn, invoice_id)
    if invoice["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Không thể gửi hóa đơn đã hủy")

    items = await conn.fetch(
        "SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY line_number ASC",
        invoice_id,
    )

    email_sent = await _send_email_graph(invoice, [dict(r) for r in items], body)

    if email_sent:
        updated = await conn.fetchrow(
            """
            UPDATE invoices SET
                status   = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
                sent_at  = NOW(),
                sent_via = 'graph_api',
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            """,
            invoice_id,
        )
        await conn.execute(
            """
            INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
            VALUES ('invoice.sent', 'invoice', $1, $2, $3, $4::uuid)
            """,
            str(invoice_id),
            f'{{"recipient": "{body.recipient_email}"}}',
            invoice.get("chain_code"),
            token_data.user_id,
        )
        return {
            "data": dict(updated),
            "message": f"Đã gửi hóa đơn {invoice['invoice_number']} đến {body.recipient_email}",
        }
    else:
        raise HTTPException(
            status_code=502,
            detail="Không thể gửi email qua Microsoft Graph API. Kiểm tra cấu hình GRAPH_API_ACCESS_TOKEN.",
        )


@router.post("/{invoice_id}/record-payment")
async def record_payment(
    invoice_id: int,
    body: RecordPaymentRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Record a payment from Samsung — updates invoice and AR balance."""
    invoice = await _get_invoice(conn, invoice_id)
    if invoice["status"] in ("cancelled",):
        raise HTTPException(status_code=400, detail="Không thể ghi nhận thanh toán cho hóa đơn đã hủy")
    if invoice["status"] == "paid":
        raise HTTPException(status_code=400, detail="Hóa đơn đã được thanh toán đầy đủ")

    current_paid = float(invoice.get("paid_amount") or 0)
    total = float(invoice.get("total_amount") or 0)
    new_paid = current_paid + body.amount

    if new_paid > total * 1.001:  # small tolerance for rounding
        raise HTTPException(
            status_code=400,
            detail=f"Số tiền thanh toán ({new_paid:,.0f}) vượt quá tổng hóa đơn ({total:,.0f})",
        )

    new_status = "paid" if new_paid >= total * 0.999 else "partially_paid"

    async with conn.transaction():
        updated = await conn.fetchrow(
            """
            UPDATE invoices SET
                paid_amount = paid_amount + $1,
                status      = $2,
                updated_at  = NOW()
            WHERE id = $3
            RETURNING *
            """,
            body.amount,
            new_status,
            invoice_id,
        )

        # Update accounts_receivable if linked
        if invoice.get("ar_id"):
            await conn.execute(
                """
                UPDATE accounts_receivable SET
                    paid_amount = COALESCE(paid_amount, 0) + $1,
                    status      = CASE WHEN (COALESCE(paid_amount, 0) + $1) >= amount * 0.999
                                       THEN 'paid' ELSE 'partial' END,
                    updated_at  = NOW()
                WHERE id = $2
                """,
                body.amount,
                invoice.get("ar_id"),
            )

        # Insert payment transaction record
        await conn.execute(
            """
            INSERT INTO payment_transactions
                (direction, ar_id, amount, currency, payment_method, bank_ref)
            VALUES ('inbound', $1, $2, $3, $4, $5)
            """,
            invoice.get("ar_id"),
            body.amount,
            body.currency,
            body.payment_method,
            body.bank_ref,
        )

        # Update deal_margins if chain linked
        if invoice.get("chain_code"):
            await conn.execute(
                """
                UPDATE revenue_chain SET
                    current_stage  = CASE WHEN $1 = 'paid' THEN 'completed' ELSE current_stage END,
                    is_complete    = CASE WHEN $1 = 'paid' THEN true ELSE false END,
                    completed_at   = CASE WHEN $1 = 'paid' THEN NOW() ELSE NULL END,
                    payment_status = $1,
                    updated_at     = NOW()
                WHERE chain_code = $2
                """,
                new_status,
                invoice["chain_code"],
            )

        await conn.execute(
            """
            INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
            VALUES ('invoice.payment_received', 'invoice', $1, $2, $3, $4::uuid)
            """,
            str(invoice_id),
            f'{{"amount": {body.amount}, "new_status": "{new_status}"}}',
            invoice.get("chain_code"),
            token_data.user_id,
        )

    return {
        "data": dict(updated),
        "message": (
            f"Đã ghi nhận thanh toán {body.amount:,.0f} {body.currency}. "
            f"{'Hóa đơn đã thanh toán đầy đủ.' if new_status == 'paid' else f'Còn lại {total - new_paid:,.0f} {body.currency}.'}"
        ),
    }
