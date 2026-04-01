"""
Revenue Chain background tasks.

- detect_rfq_wins: check bqms_rfq for new won results, auto-create Sales Order
- check_shipment_eta: alert approaching/overdue shipments
- check_overdue_invoices: remind overdue payments
- sync_exchange_rates: fetch daily CNY/VND rates
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, date
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import SYNC_DSN

logger = logging.getLogger(__name__)

# Can't use @app.periodic until procrastinate connector is fixed
# These functions are called manually via API trigger or will be
# registered when connector issue is resolved


def detect_rfq_wins() -> dict[str, Any]:
    """Check bqms_rfq for newly won RFQs and auto-create Sales Orders.

    Query: bqms_rfq WHERE result::text ILIKE '%won%' AND sales_order_id IS NULL
    For each: INSERT INTO sales_orders, link back, create revenue_chain entry.
    """
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Find won RFQs without a Sales Order yet
            cur.execute("""
                SELECT id, rfq_number, bqms_code, specification, maker, unit,
                       expected_qty, quoted_price_bqms_v1, quoted_price_bqms_v4,
                       person_in_charge_name
                FROM bqms_rfq
                WHERE result::text ILIKE '%%won%%'
                  AND id NOT IN (
                      SELECT COALESCE(rfq_id, 0) FROM sales_orders WHERE rfq_id IS NOT NULL
                  )
                ORDER BY created_at DESC
                LIMIT 50
            """)
            won_rfqs = cur.fetchall()

            if not won_rfqs:
                return {"new_wins": 0, "message": "Không có RFQ won mới"}

            # Group by rfq_number
            groups: dict[str, list] = {}
            for row in won_rfqs:
                rfq_num = row["rfq_number"]
                if rfq_num not in groups:
                    groups[rfq_num] = []
                groups[rfq_num].append(row)

            created_sos = []
            for rfq_number, items in groups.items():
                # Calculate total from latest quoted prices
                total = sum(
                    float(item.get("quoted_price_bqms_v4") or item.get("quoted_price_bqms_v1") or 0)
                    * float(item.get("expected_qty") or 1)
                    for item in items
                )

                # Generate SO number
                cur.execute("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM sales_orders")
                next_id = cur.fetchone()["next_id"]
                so_number = f"SO-{datetime.now().strftime('%Y%m')}-{next_id:06d}"

                # Generate chain code
                chain_code = f"RC-{datetime.now().strftime('%Y%m')}-{next_id:06d}"

                # Find Samsung customer
                cur.execute("SELECT id FROM customers WHERE company_name ILIKE '%%samsung%%' LIMIT 1")
                customer_row = cur.fetchone()
                customer_id = customer_row["id"] if customer_row else None

                # Create Sales Order
                cur.execute("""
                    INSERT INTO sales_orders (
                        order_number, customer_id, order_date, status,
                        total_amount, currency, rfq_id, chain_code,
                        notes, created_by
                    ) VALUES (
                        %s, %s, CURRENT_DATE, 'confirmed',
                        %s, 'VND'::currency_code, %s, %s,
                        %s, (SELECT id FROM users WHERE role::text = 'admin' LIMIT 1)
                    )
                    ON CONFLICT (order_number) DO NOTHING
                    RETURNING id, order_number
                """, (
                    so_number, customer_id, total,
                    items[0]["id"], chain_code,
                    f"Auto-created from won RFQ {rfq_number}",
                ))
                so_row = cur.fetchone()
                if not so_row:
                    continue

                # Link RFQ back to SO
                rfq_ids = [item["id"] for item in items]
                for rfq_id in rfq_ids:
                    cur.execute(
                        "UPDATE bqms_rfq SET chain_code = %s WHERE id = %s",
                        (chain_code, rfq_id),
                    )

                # Create revenue_chain entry (single row per deal)
                cur.execute("""
                    INSERT INTO revenue_chain (
                        chain_code, rfq_id, sales_order_id,
                        rfq_status, so_status, current_stage,
                        created_by
                    ) VALUES (
                        %s, %s, %s,
                        'won', 'confirmed', 'supplier_quote',
                        (SELECT id FROM users WHERE role::text = 'admin' LIMIT 1)
                    )
                    ON CONFLICT (chain_code) DO UPDATE SET
                        sales_order_id = EXCLUDED.sales_order_id,
                        so_status = 'confirmed',
                        current_stage = 'supplier_quote',
                        updated_at = NOW()
                """, (chain_code, items[0]["id"], so_row["id"]))

                created_sos.append({
                    "rfq_number": rfq_number,
                    "so_number": so_row["order_number"],
                    "so_id": so_row["id"],
                    "chain_code": chain_code,
                    "items_count": len(items),
                    "total_amount": float(total),
                })

            conn.commit()
            return {
                "new_wins": len(created_sos),
                "sales_orders": created_sos,
                "message": f"Đã tạo {len(created_sos)} Sales Order từ RFQ won",
            }
    finally:
        conn.close()


def check_shipment_eta() -> dict[str, Any]:
    """Check shipments with approaching or past ETA."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Approaching ETA (within 3 days)
            cur.execute("""
                SELECT s.id, s.shipment_number, s.po_id, s.eta, s.status,
                       s.carrier, s.tracking_number,
                       po.po_number, sup.name as supplier_name
                FROM shipments s
                LEFT JOIN purchase_orders po ON po.id = s.po_id
                LEFT JOIN suppliers sup ON sup.id = s.supplier_id
                WHERE s.status IN ('departed', 'in_transit')
                  AND s.eta <= CURRENT_DATE + INTERVAL '3 days'
                ORDER BY s.eta ASC
            """)
            approaching = cur.fetchall()

            # Overdue (past ETA, not received)
            cur.execute("""
                SELECT s.id, s.shipment_number, s.eta, s.status,
                       (CURRENT_DATE - s.eta) as days_late,
                       po.po_number, sup.name as supplier_name
                FROM shipments s
                LEFT JOIN purchase_orders po ON po.id = s.po_id
                LEFT JOIN suppliers sup ON sup.id = s.supplier_id
                WHERE s.status IN ('departed', 'in_transit', 'arrived_port')
                  AND s.eta < CURRENT_DATE
                ORDER BY s.eta ASC
            """)
            overdue = cur.fetchall()

            return {
                "approaching": [dict(r) for r in approaching],
                "overdue": [dict(r) for r in overdue],
                "approaching_count": len(approaching),
                "overdue_count": len(overdue),
            }
    finally:
        conn.close()


def check_overdue_invoices() -> dict[str, Any]:
    """Check invoices past due date."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT i.id, i.invoice_number, i.total_amount, i.paid_amount,
                       i.due_date, (CURRENT_DATE - i.due_date) as days_overdue,
                       i.balance_due, c.company_name as customer_name
                FROM invoices i
                LEFT JOIN customers c ON c.id = i.customer_id
                WHERE i.status NOT IN ('paid', 'cancelled', 'voided')
                  AND i.due_date < CURRENT_DATE
                ORDER BY i.due_date ASC
            """)
            overdue = cur.fetchall()

            # Update status to overdue
            for inv in overdue:
                cur.execute(
                    "UPDATE invoices SET status = 'overdue', updated_at = NOW() WHERE id = %s AND status != 'overdue'",
                    (inv["id"],),
                )

            conn.commit()
            return {
                "overdue_count": len(overdue),
                "overdue_invoices": [dict(r) for r in overdue],
                "total_overdue_amount": sum(float(r.get("balance_due", 0) or 0) for r in overdue),
            }
    finally:
        conn.close()


def sync_exchange_rates() -> dict[str, Any]:
    """Fetch latest exchange rates and store in DB.

    Uses a simple approach: try VCB API, fallback to manual.
    """
    import httpx

    conn = psycopg2.connect(SYNC_DSN)
    try:
        rates = {}
        today = date.today()

        # Try fetching from VCB (free, no auth)
        try:
            resp = httpx.get(
                "https://portal.vietcombank.com.vn/Usercontrols/TV498/ExchangeStages.ashx",
                params={"kv": "VCB", "txnum": ""},
                timeout=10,
            )
            if resp.status_code == 200:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(resp.text)
                for item in root.findall(".//Exrate"):
                    code = item.get("CurrencyCode", "")
                    sell = item.get("Sell", "0").replace(",", "")
                    if code == "CNY" and sell:
                        rates["CNY_VND"] = float(sell)
                    elif code == "USD" and sell:
                        rates["USD_VND"] = float(sell)
        except Exception as exc:
            logger.warning("VCB rate fetch failed: %s", exc)

        if not rates:
            return {"success": False, "message": "Không lấy được tỷ giá. Nhập thủ công."}

        with conn, conn.cursor() as cur:
            for pair, rate in rates.items():
                from_cur, to_cur = pair.split("_")
                cur.execute("""
                    INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_date, source)
                    VALUES (%s, %s, %s, %s, 'vcb')
                    ON CONFLICT (from_currency, to_currency, rate_date) DO UPDATE
                    SET rate = EXCLUDED.rate, source = 'vcb'
                """, (from_cur, to_cur, rate, today))

        conn.commit()
        return {"success": True, "rates": rates, "date": str(today)}
    finally:
        conn.close()
