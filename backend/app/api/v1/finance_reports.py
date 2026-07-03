"""
Finance Reports API (M36) — P&L, Balance Overview, Cash Flow Statement,
Top Customers/Suppliers, Monthly Comparison.

Endpoints:
  GET /profit-loss           — P&L statement for a period
  GET /balance-overview      — Current financial position
  GET /cash-flow-statement   — Cash flow statement (operating/investing/financing)
  GET /top-customers         — Top customers by revenue with trend
  GET /top-suppliers         — Top suppliers by spend with trend
  GET /monthly-comparison    — Month-over-month comparison
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from calendar import monthrange
from typing import Optional

from fastapi import APIRouter, Depends, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _rows_to_list(rows: list[asyncpg.Record]) -> list[dict]:
    return [dict(r) for r in rows]


def _row_to_dict(row: asyncpg.Record | None) -> dict | None:
    if row is None:
        return None
    return dict(row)


def _period_dates(
    year: int,
    month: int,
) -> tuple[date, date]:
    """Return first and last day of the given month."""
    _, last_day = monthrange(year, month)
    return date(year, month, 1), date(year, month, last_day)


def _prev_month(year: int, month: int) -> tuple[int, int]:
    if month == 1:
        return year - 1, 12
    return year, month - 1


# ---------------------------------------------------------------------------
# GET /profit-loss
# ---------------------------------------------------------------------------

@router.get("/profit-loss")
async def profit_loss_statement(
    year: Optional[int] = Query(None, ge=2020, le=2099),
    month: Optional[int] = Query(None, ge=1, le=12),
    months: Optional[int] = Query(None, ge=1, le=36, description="Số tháng nhìn lại (dùng thay cho year+month)"),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Báo cáo lãi/lỗ cho kỳ (tháng/năm):
    Doanh thu, COGS, lợi nhuận gộp, chi phí vận hành, lợi nhuận thuần.
    Có thể truyền year+month hoặc chỉ months (lấy tháng hiện tại).
    """
    today = date.today()
    if year is None or month is None:
        # When months param is provided or no params at all, use current month
        year = today.year
        month = today.month
    period_start, period_end = _period_dates(year, month)

    # Revenue & COGS from deal_margins (linked via sales_orders)
    pl_from_deals = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(dm.revenue_vnd), 0)        AS revenue_vnd,
            COALESCE(SUM(dm.cogs_vnd), 0)           AS cogs_vnd,
            COALESCE(SUM(dm.freight_vnd), 0)        AS freight_vnd,
            COALESCE(SUM(dm.customs_duty_vnd), 0)   AS customs_duty_vnd,
            COALESCE(SUM(dm.total_cost_vnd), 0)     AS total_cost_vnd,
            COALESCE(SUM(dm.gross_profit_vnd), 0)   AS gross_profit_vnd,
            COALESCE(AVG(dm.margin_pct), 0)         AS avg_margin_pct,
            COUNT(dm.id)                            AS deal_count
        FROM deal_margins dm
        JOIN sales_orders so ON so.id = dm.chain_code::BIGINT
        WHERE so.created_at::DATE BETWEEN $1 AND $2
        """,
        period_start, period_end,
    )

    # Operating expenses from cash_book.
    # Convention THẬT: direction 'chi' = TIỀN RA (chi phí). Chấp nhận thêm
    # 'expense' để tương thích ngược (CHECK constraint vẫn cho phép giá trị này).
    # JOIN cash_book_categories để trả kèm category_code/category_name.
    operating_expenses = await conn.fetch(
        """
        SELECT
            cb.category_id,
            cat.category_code,
            cat.category_name,
            COALESCE(SUM(cb.amount), 0) AS amount
        FROM cash_book cb
        LEFT JOIN cash_book_categories cat ON cat.id = cb.category_id
        WHERE cb.direction IN ('chi', 'expense')
          AND cb.entry_date BETWEEN $1 AND $2
        GROUP BY cb.category_id, cat.category_code, cat.category_name
        ORDER BY amount DESC
        """,
        period_start, period_end,
    )

    # float() bắt buộc: r["amount"] là Decimal (asyncpg numeric); trước fix
    # direction, filter 'expense' luôn rỗng nên sum([])=0 (int) che lỗi — nay có
    # dòng 'chi' thật, gross_profit(float) - total_opex(Decimal) sẽ TypeError→500.
    total_opex = float(sum((r["amount"] for r in operating_expenses), 0))
    gross_profit = float(pl_from_deals["gross_profit_vnd"] or 0)
    net_profit = gross_profit - total_opex

    # Revenue also from invoices (for cross-check)
    invoice_revenue = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(total_amount), 0) AS total_invoiced,
            COALESCE(SUM(paid_amount), 0)  AS total_collected,
            COUNT(*)                       AS invoice_count
        FROM invoices
        WHERE invoice_date BETWEEN $1 AND $2
          AND status != 'cancelled'
        """,
        period_start, period_end,
    )

    return {
        "data": {
            "period": {"year": year, "month": month, "start": period_start, "end": period_end},
            "revenue": {
                "from_deals_vnd": float(pl_from_deals["revenue_vnd"] or 0),
                "from_invoices": float(invoice_revenue["total_invoiced"] or 0),
                "collected": float(invoice_revenue["total_collected"] or 0),
                "invoice_count": invoice_revenue["invoice_count"],
                "deal_count": pl_from_deals["deal_count"],
            },
            "cogs": {
                "cogs_vnd": float(pl_from_deals["cogs_vnd"] or 0),
                "freight_vnd": float(pl_from_deals["freight_vnd"] or 0),
                "customs_duty_vnd": float(pl_from_deals["customs_duty_vnd"] or 0),
                "total_cost_vnd": float(pl_from_deals["total_cost_vnd"] or 0),
            },
            "gross_profit_vnd": gross_profit,
            "avg_margin_pct": float(pl_from_deals["avg_margin_pct"] or 0),
            "operating_expenses": _rows_to_list(operating_expenses),
            "total_opex_vnd": total_opex,
            "net_profit_vnd": net_profit,
        },
        "message": f"Báo cáo lãi/lỗ tháng {month}/{year}",
    }


# ---------------------------------------------------------------------------
# GET /balance-overview
# ---------------------------------------------------------------------------

@router.get("/balance-overview")
async def balance_overview(
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Tổng quan tài chính hiện tại:
    - Tài sản: tiền mặt + phải thu + hàng tồn kho
    - Nợ phải trả: phải trả NCC
    - Vốn chủ sở hữu (tài sản - nợ)
    """
    # Cash position
    cash_balance = await conn.fetchval(
        "SELECT balance_after FROM cash_book ORDER BY entry_date DESC, id DESC LIMIT 1"
    )

    # Accounts receivable (total outstanding)
    ar = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(amount - paid_amount), 0)              AS total_outstanding,
            COUNT(*)                                            AS open_invoices,
            COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE
                              THEN amount - paid_amount ELSE 0 END), 0) AS overdue
        FROM accounts_receivable
        WHERE status != 'paid'
        """
    )

    # Accounts payable (total outstanding)
    ap = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(amount - paid_amount), 0)          AS total_outstanding_vnd,
            COUNT(*)                                            AS open_invoices,
            COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE
                              THEN amount - paid_amount ELSE 0 END), 0) AS overdue_vnd
        FROM accounts_payable
        WHERE status != 'paid'
        """
    )

    # Inventory value
    inventory = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(quantity * unit_cost), 0) AS total_value,
            COUNT(DISTINCT id)                     AS sku_count
        FROM inventory
        WHERE quantity > 0
        """
    )

    cash_vnd = float(cash_balance or 0)
    ar_outstanding = float(ar["total_outstanding"] or 0)
    inventory_value = float(inventory["total_value"] or 0)
    total_assets = cash_vnd + ar_outstanding + inventory_value
    total_liabilities = float(ap["total_outstanding_vnd"] or 0)
    equity = total_assets - total_liabilities

    return {
        "data": {
            "assets": {
                "cash_vnd": cash_vnd,
                "accounts_receivable": ar_outstanding,
                "ar_overdue": float(ar["overdue"] or 0),
                "ar_open_invoices": ar["open_invoices"],
                "inventory_value": inventory_value,
                "inventory_sku_count": inventory["sku_count"],
                "total_assets": total_assets,
            },
            "liabilities": {
                "accounts_payable_vnd": total_liabilities,
                "ap_overdue_vnd": float(ap["overdue_vnd"] or 0),
                "ap_open_invoices": ap["open_invoices"],
                "total_liabilities": total_liabilities,
            },
            "equity": equity,
            "as_of": date.today().isoformat(),
        },
        "message": "Tổng quan tài chính hiện tại",
    }


# ---------------------------------------------------------------------------
# GET /cash-flow-statement
# ---------------------------------------------------------------------------

@router.get("/cash-flow-statement")
async def cash_flow_statement(
    year: int = Query(..., ge=2020, le=2099),
    month: int = Query(..., ge=1, le=12),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Báo cáo lưu chuyển tiền tệ theo tháng:
    - Hoạt động kinh doanh (operating)
    - Hoạt động đầu tư (investing)
    - Hoạt động tài chính (financing)
    """
    period_start, period_end = _period_dates(year, month)

    # Operating: customer receipts and supplier payments
    operating_in = await conn.fetchrow(
        """
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payment_transactions
        WHERE direction = 'inbound'
          AND payment_date BETWEEN $1 AND $2
        """,
        period_start, period_end,
    )

    operating_out = await conn.fetchrow(
        """
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payment_transactions
        WHERE direction = 'outbound'
          AND payment_date BETWEEN $1 AND $2
        """,
        period_start, period_end,
    )

    # Cash book breakdown by category — JOIN cash_book_categories để lấy
    # category_code + category_name THẬT (cash_book chỉ có category_id, KHÔNG có
    # cột 'category'). Đọc r["category"] như code cũ → KeyError → 500.
    cb_breakdown = await conn.fetch(
        """
        SELECT
            cb.direction,
            cb.category_id,
            cat.category_code,
            cat.category_name,
            COALESCE(SUM(cb.amount), 0) AS amount,
            COUNT(*) AS entry_count
        FROM cash_book cb
        LEFT JOIN cash_book_categories cat ON cat.id = cb.category_id
        WHERE cb.entry_date BETWEEN $1 AND $2
        GROUP BY cb.direction, cb.category_id, cat.category_code, cat.category_name
        ORDER BY cb.direction, amount DESC
        """,
        period_start, period_end,
    )

    # Phân loại operating / investing / financing.
    # Taxonomy THẬT (cash_book_categories) hiện CHỈ có nhóm HOẠT ĐỘNG KINH DOANH:
    # mọi category thu/chi đều là operating. CHƯA có category đầu tư (investing)
    # hay tài chính (financing), nên 2 nhóm đó để RỖNG (giữ khung 3 nhóm để FE
    # không vỡ; mở rộng khi taxonomy bổ sung nhóm). Bỏ set cứng
    # 'customer_receipt'/'supplier_payment'/... của code cũ — KHÔNG có thật.
    operating_items = list(cb_breakdown)
    investing_items: list = []   # chưa có category đầu tư trong cash_book_categories
    financing_items: list = []   # chưa có category tài chính trong cash_book_categories
    unclassified_items: list = []

    def _net(items: list) -> float:
        # cash_book convention THẬT: direction 'thu' = TIỀN VÀO (inflow),
        # 'chi' = TIỀN RA (outflow). Chấp nhận thêm 'income'/'expense' để tương
        # thích ngược (CHECK constraint vẫn cho phép). 'transfer' bỏ qua (không
        # tính vào lưu chuyển thuần).
        inflow = sum(r["amount"] for r in items if r["direction"] in ("thu", "income"))
        outflow = sum(r["amount"] for r in items if r["direction"] in ("chi", "expense"))
        return float(inflow) - float(outflow)

    net_operating = _net(operating_items)
    net_investing = _net(investing_items)
    net_financing = _net(financing_items)

    # Opening balance (last entry before period)
    opening_balance = await conn.fetchval(
        """
        SELECT balance_after FROM cash_book
        WHERE entry_date < $1
        ORDER BY entry_date DESC, id DESC
        LIMIT 1
        """,
        period_start,
    )

    closing_balance = await conn.fetchval(
        """
        SELECT balance_after FROM cash_book
        WHERE entry_date <= $1
        ORDER BY entry_date DESC, id DESC
        LIMIT 1
        """,
        period_end,
    )

    return {
        "data": {
            "period": {"year": year, "month": month, "start": period_start, "end": period_end},
            "opening_balance_vnd": float(opening_balance or 0),
            "closing_balance_vnd": float(closing_balance or 0),
            "operating": {
                "items": _rows_to_list(operating_items),
                "inbound_payments": float(operating_in["total"] or 0),
                "outbound_payments": float(operating_out["total"] or 0),
                "net_vnd": net_operating,
            },
            "investing": {
                "items": _rows_to_list(investing_items),
                "net_vnd": net_investing,
            },
            "financing": {
                "items": _rows_to_list(financing_items),
                "net_vnd": net_financing,
            },
            "unclassified": {
                "items": _rows_to_list(unclassified_items),
                "net_vnd": _net(unclassified_items),
            },
            "net_change_vnd": net_operating + net_investing + net_financing,
        },
        "message": f"Lưu chuyển tiền tệ tháng {month}/{year}",
    }


# ---------------------------------------------------------------------------
# GET /top-customers
# ---------------------------------------------------------------------------

@router.get("/top-customers")
async def top_customers(
    months: int = Query(12, ge=1, le=36, description="Số tháng nhìn lại"),
    limit: int = Query(10, ge=1, le=50),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Top khách hàng theo doanh thu với xu hướng so với kỳ trước."""
    cutoff = date.today() - timedelta(days=months * 30)
    prev_cutoff = cutoff - timedelta(days=months * 30)

    top = await conn.fetch(
        """
        SELECT
            c.id AS customer_id,
            c.company_name,
            c.short_name,
            c.customer_type,
            COUNT(DISTINCT so.id)                           AS order_count,
            COALESCE(SUM(so.total_amount), 0)              AS total_revenue,
            MAX(so.created_at)::DATE                        AS last_order_date,
            COUNT(DISTINCT inv.id)                         AS invoice_count,
            COALESCE(SUM(inv.total_amount), 0)             AS total_invoiced
        FROM customers c
        JOIN sales_orders so ON so.customer_id = c.id
        LEFT JOIN invoices inv ON inv.customer_id = c.id
            AND inv.invoice_date >= $1
        WHERE so.created_at::DATE >= $1
        GROUP BY c.id, c.company_name, c.short_name, c.customer_type
        ORDER BY total_revenue DESC
        LIMIT $2
        """,
        cutoff, limit,
    )

    customer_ids = [r["customer_id"] for r in top]

    # Previous period revenue for trend
    prev_revenue: dict[int, float] = {}
    if customer_ids:
        prev_rows = await conn.fetch(
            """
            SELECT
                customer_id,
                COALESCE(SUM(total_amount), 0) AS total_revenue
            FROM sales_orders
            WHERE customer_id = ANY($1::BIGINT[])
              AND created_at::DATE BETWEEN $2 AND $3
            GROUP BY customer_id
            """,
            customer_ids, prev_cutoff, cutoff,
        )
        prev_revenue = {r["customer_id"]: float(r["total_revenue"]) for r in prev_rows}

    result = []
    for r in top:
        d = dict(r)
        prev = prev_revenue.get(d["customer_id"], 0.0)
        current = float(d["total_revenue"])
        if prev > 0:
            d["trend_pct"] = round((current - prev) / prev * 100, 2)
        elif current > 0:
            d["trend_pct"] = 100.0
        else:
            d["trend_pct"] = 0.0
        d["prev_period_revenue"] = prev
        result.append(d)

    return {
        "data": {
            "customers": result,
            "period_months": months,
            "cutoff_date": cutoff.isoformat(),
        },
        "message": f"Top {limit} khách hàng {months} tháng gần nhất",
    }


# ---------------------------------------------------------------------------
# GET /top-suppliers
# ---------------------------------------------------------------------------

@router.get("/top-suppliers")
async def top_suppliers(
    months: int = Query(12, ge=1, le=36, description="Số tháng nhìn lại"),
    limit: int = Query(10, ge=1, le=50),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Top nhà cung cấp theo chi tiêu với xu hướng so với kỳ trước."""
    cutoff = date.today() - timedelta(days=months * 30)
    prev_cutoff = cutoff - timedelta(days=months * 30)

    top = await conn.fetch(
        """
        SELECT
            s.id AS supplier_id,
            s.name AS supplier_name,
            s.country,
            s.rating,
            COUNT(DISTINCT po.id)                               AS order_count,
            COALESCE(SUM(po.total_amount), 0)                  AS total_spend,
            MAX(po.created_at)::DATE                           AS last_order_date,
            COUNT(DISTINCT ap.id)                              AS ap_invoice_count,
            COALESCE(SUM(ap.amount), 0)                   AS total_ap_vnd
        FROM suppliers s
        JOIN purchase_orders po ON po.supplier_id = s.id
        LEFT JOIN accounts_payable ap ON ap.supplier_id = s.id
            AND ap.invoice_date >= $1
        WHERE po.created_at::DATE >= $1
        GROUP BY s.id, s.name, s.country, s.rating
        ORDER BY total_spend DESC
        LIMIT $2
        """,
        cutoff, limit,
    )

    supplier_ids = [r["supplier_id"] for r in top]

    prev_spend: dict[int, float] = {}
    if supplier_ids:
        prev_rows = await conn.fetch(
            """
            SELECT
                supplier_id,
                COALESCE(SUM(total_amount), 0) AS total_spend
            FROM purchase_orders
            WHERE supplier_id = ANY($1::BIGINT[])
              AND created_at::DATE BETWEEN $2 AND $3
            GROUP BY supplier_id
            """,
            supplier_ids, prev_cutoff, cutoff,
        )
        prev_spend = {r["supplier_id"]: float(r["total_spend"]) for r in prev_rows}

    result = []
    for r in top:
        d = dict(r)
        prev = prev_spend.get(d["supplier_id"], 0.0)
        current = float(d["total_spend"])
        if prev > 0:
            d["trend_pct"] = round((current - prev) / prev * 100, 2)
        elif current > 0:
            d["trend_pct"] = 100.0
        else:
            d["trend_pct"] = 0.0
        d["prev_period_spend"] = prev
        result.append(d)

    return {
        "data": {
            "suppliers": result,
            "period_months": months,
            "cutoff_date": cutoff.isoformat(),
        },
        "message": f"Top {limit} nhà cung cấp {months} tháng gần nhất",
    }


# ---------------------------------------------------------------------------
# GET /monthly-comparison
# ---------------------------------------------------------------------------

@router.get("/monthly-comparison")
async def monthly_comparison(
    months: int = Query(12, ge=2, le=24, description="Số tháng so sánh"),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """So sánh tháng-qua-tháng: doanh thu, chi phí, lợi nhuận, biên lợi nhuận."""
    # Revenue and P&L from deal_margins
    margin_rows = await conn.fetch(
        """
        SELECT
            DATE_TRUNC('month', so.created_at)::DATE    AS month,
            COALESCE(SUM(dm.revenue_vnd), 0)            AS revenue_vnd,
            COALESCE(SUM(dm.total_cost_vnd), 0)         AS cost_vnd,
            COALESCE(SUM(dm.gross_profit_vnd), 0)       AS gross_profit_vnd,
            COALESCE(AVG(dm.margin_pct), 0)             AS avg_margin_pct,
            COUNT(dm.id)                                AS deal_count
        FROM deal_margins dm
        JOIN sales_orders so ON so.id = dm.chain_code::BIGINT
        WHERE so.created_at >= DATE_TRUNC('month', NOW()) - ($1 - 1) * INTERVAL '1 month'
        GROUP BY 1
        ORDER BY 1
        """,
        months,
    )

    # Operating expenses from cash_book — direction 'chi' = TIỀN RA (chi phí).
    # Chấp nhận thêm 'expense' để tương thích ngược với dữ liệu cũ.
    expense_rows = await conn.fetch(
        """
        SELECT
            DATE_TRUNC('month', entry_date)::DATE       AS month,
            COALESCE(SUM(amount), 0)               AS total_expense_vnd
        FROM cash_book
        WHERE direction IN ('chi', 'expense')
          AND entry_date >= DATE_TRUNC('month', NOW()) - ($1 - 1) * INTERVAL '1 month'
        GROUP BY 1
        ORDER BY 1
        """,
        months,
    )

    # Cash book income — direction 'thu' = TIỀN VÀO. Chấp nhận thêm 'income'.
    income_rows = await conn.fetch(
        """
        SELECT
            DATE_TRUNC('month', entry_date)::DATE       AS month,
            COALESCE(SUM(amount), 0)               AS total_income_vnd
        FROM cash_book
        WHERE direction IN ('thu', 'income')
          AND entry_date >= DATE_TRUNC('month', NOW()) - ($1 - 1) * INTERVAL '1 month'
        GROUP BY 1
        ORDER BY 1
        """,
        months,
    )

    # New orders count per month
    order_rows = await conn.fetch(
        """
        SELECT
            DATE_TRUNC('month', created_at)::DATE   AS month,
            COUNT(*)                                AS order_count,
            COALESCE(SUM(total_amount), 0)          AS order_value
        FROM sales_orders
        WHERE created_at >= DATE_TRUNC('month', NOW()) - ($1 - 1) * INTERVAL '1 month'
        GROUP BY 1
        ORDER BY 1
        """,
        months,
    )

    # Build month-keyed lookup maps
    expense_map = {r["month"]: float(r["total_expense_vnd"]) for r in expense_rows}
    income_map  = {r["month"]: float(r["total_income_vnd"])  for r in income_rows}
    order_map   = {r["month"]: dict(r)                       for r in order_rows}

    merged: list[dict] = []
    for r in margin_rows:
        month_key = r["month"]
        gross_profit = float(r["gross_profit_vnd"])
        opex = expense_map.get(month_key, 0.0)
        net_profit = gross_profit - opex
        orders = order_map.get(month_key, {})

        row = {
            "month": month_key.isoformat(),
            "revenue_vnd": float(r["revenue_vnd"]),
            "cost_vnd": float(r["cost_vnd"]),
            "gross_profit_vnd": gross_profit,
            "avg_margin_pct": round(float(r["avg_margin_pct"]), 2),
            "operating_expense_vnd": opex,
            "net_profit_vnd": round(net_profit, 2),
            "cash_income_vnd": income_map.get(month_key, 0.0),
            "cash_expense_vnd": opex,
            "deal_count": r["deal_count"],
            "order_count": orders.get("order_count", 0),
            "order_value": float(orders.get("order_value", 0)),
        }
        merged.append(row)

    # Add MoM growth columns
    for i, row in enumerate(merged):
        if i == 0:
            row["revenue_growth_pct"] = None
            row["profit_growth_pct"] = None
        else:
            prev = merged[i - 1]
            prev_rev = prev["revenue_vnd"]
            prev_profit = prev["net_profit_vnd"]
            row["revenue_growth_pct"] = (
                round((row["revenue_vnd"] - prev_rev) / prev_rev * 100, 2)
                if prev_rev else None
            )
            row["profit_growth_pct"] = (
                round((row["net_profit_vnd"] - prev_profit) / abs(prev_profit) * 100, 2)
                if prev_profit else None
            )

    return {
        "data": {
            "monthly": merged,
            "period_months": months,
        },
        "message": f"So sánh {months} tháng",
    }
