"""Dashboard KPI API — reads from tables that ACTUALLY have imported data."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


@router.get("/kpis")
async def dashboard_kpis(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """KPIs from real imported data."""

    # Revenue from revenue_invoices (all time, not just this month — data is historical)
    total_revenue = await conn.fetchval(
        "SELECT COALESCE(SUM(total_amount), 0) FROM revenue_invoices"
    )

    # BQMS RFQ count (real data)
    total_rfq = await conn.fetchval("SELECT COUNT(*) FROM bqms_rfq")

    # BQMS deliveries count
    total_deliveries = await conn.fetchval("SELECT COUNT(*) FROM bqms_deliveries")

    # BQMS won quotations
    total_won = await conn.fetchval("SELECT COUNT(*) FROM bqms_won_quotations")

    # BQMS win rate
    total_with_result = await conn.fetchval(
        "SELECT COUNT(*) FROM bqms_rfq WHERE result IN ('won', 'lost')"
    )
    won_count = await conn.fetchval(
        "SELECT COUNT(*) FROM bqms_rfq WHERE result = 'won'"
    )
    win_rate = round(won_count * 100.0 / total_with_result, 1) if total_with_result > 0 else 0

    # Samsung PO
    total_samsung_po = await conn.fetchval("SELECT COUNT(*) FROM bqms_samsung_po")

    # IMV inquiries
    total_imv = await conn.fetchval("SELECT COUNT(*) FROM imv_inquiries")

    # Import/export tracking
    total_xnk = await conn.fetchval("SELECT COUNT(*) FROM import_export_tracking")

    # Exchange rates
    latest_rate = await conn.fetchrow(
        "SELECT rate, rate_date FROM exchange_rates WHERE from_currency = 'USD' AND to_currency = 'VND' ORDER BY rate_date DESC LIMIT 1"
    )

    # PO from internal purchase_orders (may be 0)
    po_count = await conn.fetchval("SELECT COUNT(*) FROM purchase_orders")

    # Pending approvals
    pending = await conn.fetchval(
        "SELECT COUNT(*) FROM workflow_instances WHERE current_status IN ('pending_l1', 'pending_l2')"
    )

    # Low stock
    low_stock = await conn.fetchval(
        "SELECT COUNT(*) FROM inventory WHERE min_stock IS NOT NULL AND quantity <= min_stock"
    )

    return {
        "data": {
            "total_revenue": float(total_revenue),
            "total_revenue_mtd": float(total_revenue),
            "total_rfq": total_rfq,
            "total_deliveries": total_deliveries,
            "total_won": total_won,
            "bqms_win_rate": win_rate,
            "total_samsung_po": total_samsung_po,
            "total_imv": total_imv,
            "total_xnk": total_xnk,
            "usd_vnd_rate": float(latest_rate["rate"]) if latest_rate else None,
            "usd_vnd_date": str(latest_rate["rate_date"]) if latest_rate else None,
            "po_count_month": po_count,
            "so_count_month": 0,
            "pending_approvals": pending,
            "low_stock_count": low_stock,
            "ap_outstanding": 0,
            "ar_outstanding": 0,
        }
    }


@router.get("/kpis-v2")
async def dashboard_kpis_v2(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "warehouse", "sales", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """BA/DA Dashboard — ALL data from bqms_rfq in 1 call. Cached 60s in Redis."""

    # Try cache first
    from app.core.cache import cache
    cache_key = "dashboard:kpis-v2"
    cached_data = await cache.get(cache_key)
    if cached_data:
        return cached_data


    # ── Card 1: RFQ This Month vs Last Month vs YoY ──
    rfq_cards = await conn.fetchrow("""
        SELECT
            COUNT(*) FILTER (WHERE DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date)) = DATE_TRUNC('month', NOW())) AS rfq_this_month,
            COUNT(*) FILTER (WHERE DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date)) = DATE_TRUNC('month', NOW()) - interval '1 month') AS rfq_last_month,
            COUNT(*) FILTER (WHERE DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date)) = DATE_TRUNC('month', NOW()) - interval '12 months') AS rfq_same_month_ly,
            COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%' AND DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date)) = DATE_TRUNC('month', NOW())) AS won_this_month,
            COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%' AND DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date)) = DATE_TRUNC('month', NOW()) - interval '1 month') AS won_last_month,
            COALESCE(SUM(quoted_price_bqms_v1) FILTER (WHERE result::text ILIKE '%%won%%' AND DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date)) = DATE_TRUNC('month', NOW())), 0) AS revenue_this_month,
            COALESCE(SUM(quoted_price_bqms_v1) FILTER (WHERE result::text ILIKE '%%won%%' AND DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date)) = DATE_TRUNC('month', NOW()) - interval '1 month'), 0) AS revenue_last_month,
            COUNT(*) FILTER (WHERE (result IS NULL OR result::text = '' OR result::text = 'pending')) AS rfq_pending,
            COUNT(*) FILTER (WHERE (result IS NULL OR result::text = '' OR result::text = 'pending') AND COALESCE(inquiry_date, created_at::date) < NOW() - interval '7 days') AS rfq_overdue
        FROM bqms_rfq WHERE COALESCE(inquiry_date, created_at::date) IS NOT NULL
    """)

    # ── Card 2: Win Rate 3-month rolling ──
    win_rate = await conn.fetchrow("""
        SELECT
            ROUND(COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%' AND COALESCE(inquiry_date, created_at::date) >= NOW() - interval '3 months')::numeric
                / NULLIF(COUNT(*) FILTER (WHERE (result::text ILIKE '%%won%%' OR result::text ILIKE '%%lost%%') AND COALESCE(inquiry_date, created_at::date) >= NOW() - interval '3 months'), 0) * 100, 1) AS win_rate_3m,
            ROUND(COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%' AND COALESCE(inquiry_date, created_at::date) BETWEEN NOW() - interval '6 months' AND NOW() - interval '3 months')::numeric
                / NULLIF(COUNT(*) FILTER (WHERE (result::text ILIKE '%%won%%' OR result::text ILIKE '%%lost%%') AND COALESCE(inquiry_date, created_at::date) BETWEEN NOW() - interval '6 months' AND NOW() - interval '3 months'), 0) * 100, 1) AS win_rate_prev_3m,
            COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%' AND COALESCE(inquiry_date, created_at::date) >= NOW() - interval '3 months') AS won_3m,
            COUNT(*) FILTER (WHERE (result::text ILIKE '%%won%%' OR result::text ILIKE '%%lost%%') AND COALESCE(inquiry_date, created_at::date) >= NOW() - interval '3 months') AS decided_3m
        FROM bqms_rfq WHERE COALESCE(inquiry_date, created_at::date) IS NOT NULL
    """)

    # ── Section 2A: Monthly Revenue (12 months) ──
    monthly = await conn.fetch("""
        SELECT DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date))::date AS month,
               COUNT(*) AS total_rfq,
               COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%') AS won_count,
               COALESCE(SUM(quoted_price_bqms_v1), 0) AS total_quoted,
               COALESCE(SUM(quoted_price_bqms_v1) FILTER (WHERE result::text ILIKE '%%won%%'), 0) AS won_revenue
        FROM bqms_rfq
        WHERE COALESCE(inquiry_date, created_at::date) >= DATE_TRUNC('month', NOW()) - interval '11 months' AND COALESCE(inquiry_date, created_at::date) IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """)

    # ── Section 2B: YoY Comparison ──
    yoy = await conn.fetch("""
        WITH this_year AS (
            SELECT EXTRACT(MONTH FROM COALESCE(inquiry_date, created_at::date))::int AS m, COUNT(*) AS cnt,
                   COALESCE(SUM(quoted_price_bqms_v1) FILTER (WHERE result::text ILIKE '%%won%%'), 0) AS rev
            FROM bqms_rfq WHERE EXTRACT(YEAR FROM COALESCE(inquiry_date, created_at::date)) = EXTRACT(YEAR FROM NOW()) AND COALESCE(inquiry_date, created_at::date) IS NOT NULL GROUP BY 1
        ), last_year AS (
            SELECT EXTRACT(MONTH FROM COALESCE(inquiry_date, created_at::date))::int AS m, COUNT(*) AS cnt,
                   COALESCE(SUM(quoted_price_bqms_v1) FILTER (WHERE result::text ILIKE '%%won%%'), 0) AS rev
            FROM bqms_rfq WHERE EXTRACT(YEAR FROM COALESCE(inquiry_date, created_at::date)) = EXTRACT(YEAR FROM NOW()) - 1 AND COALESCE(inquiry_date, created_at::date) IS NOT NULL GROUP BY 1
        )
        SELECT g.m AS month_num,
               COALESCE(ty.cnt, 0) AS rfq_this_year, COALESCE(ly.cnt, 0) AS rfq_last_year,
               COALESCE(ty.rev, 0) AS revenue_this_year, COALESCE(ly.rev, 0) AS revenue_last_year
        FROM generate_series(1,12) g(m)
        LEFT JOIN this_year ty ON ty.m = g.m LEFT JOIN last_year ly ON ly.m = g.m ORDER BY g.m
    """)

    # ── Section 3A: Funnel ──
    funnel = await conn.fetchrow("""
        SELECT
            (SELECT COUNT(*) FROM bqms_rfq) AS rfq_received,
            (SELECT COUNT(*) FROM bqms_rfq WHERE quoted_price_bqms_v1 IS NOT NULL AND quoted_price_bqms_v1 > 0) AS quoted,
            (SELECT COUNT(*) FROM bqms_rfq WHERE result::text ILIKE '%%won%%') AS won,
            (SELECT COUNT(*) FROM bqms_deliveries) AS delivered,
            (SELECT COUNT(*) FROM revenue_invoices) AS invoiced
    """)

    # ── Section 3B: Win Rate Trend (12 months) ──
    win_trend = await conn.fetch("""
        SELECT DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date))::date AS month,
               COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%') AS won,
               COUNT(*) FILTER (WHERE result::text ILIKE '%%lost%%' OR result::text ILIKE '%%lose%%') AS lost,
               ROUND(COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%')::numeric
                   / NULLIF(COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%' OR result::text ILIKE '%%lost%%'), 0) * 100, 1) AS win_rate
        FROM bqms_rfq WHERE COALESCE(inquiry_date, created_at::date) >= DATE_TRUNC('month', NOW()) - interval '11 months' AND COALESCE(inquiry_date, created_at::date) IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """)

    # ── Section 4A: Maker Distribution (top 8) ──
    makers = await conn.fetch("""
        SELECT COALESCE(maker, 'Không rõ') AS maker, COUNT(*) AS total,
               COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%') AS won,
               ROUND(COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS win_rate
        FROM bqms_rfq WHERE COALESCE(inquiry_date, created_at::date) >= NOW() - interval '12 months' AND COALESCE(inquiry_date, created_at::date) IS NOT NULL
        GROUP BY maker ORDER BY total DESC LIMIT 8
    """)

    # ── Section 4B: Owner Performance ──
    owners = await conn.fetch("""
        SELECT COALESCE(person_in_charge_name, 'Chưa rõ') AS owner, COUNT(*) AS total,
               COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%') AS won,
               ROUND(COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS win_rate
        FROM bqms_rfq WHERE COALESCE(inquiry_date, created_at::date) >= NOW() - interval '6 months' AND COALESCE(inquiry_date, created_at::date) IS NOT NULL
        GROUP BY person_in_charge_name ORDER BY win_rate DESC NULLS LAST LIMIT 5
    """)

    # ── Section 5A: RFQ sắp hết hạn (pending, newest inquiry) ──
    urgent_rfqs = await conn.fetch("""
        SELECT id, rfq_number, bqms_code, specification, maker, inquiry_date, person_in_charge_name
        FROM bqms_rfq
        WHERE (result IS NULL OR result::text = '' OR result::text = 'pending')
          AND COALESCE(inquiry_date, created_at::date) >= NOW() - interval '14 days' AND COALESCE(inquiry_date, created_at::date) IS NOT NULL
        ORDER BY inquiry_date DESC LIMIT 5
    """)

    # ── Sparkline: RFQ count last 12 months ──
    spark = await conn.fetch("""
        SELECT DATE_TRUNC('month', COALESCE(inquiry_date, created_at::date))::date AS month, COUNT(*) AS cnt
        FROM bqms_rfq WHERE COALESCE(inquiry_date, created_at::date) >= DATE_TRUNC('month', NOW()) - interval '11 months' AND COALESCE(inquiry_date, created_at::date) IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """)

    # ── NEW: Delivery Tracking Stats ──
    delivery_stats = await conn.fetchrow("""
        SELECT
            COUNT(*)::int AS total_deliveries,
            COUNT(*) FILTER (WHERE delivery_status::text IN ('da_giao','delivered','completed','hoan_tat'))::int AS delivered,
            COUNT(*) FILTER (WHERE delivery_status::text IN ('chua_giao','pending'))::int AS pending,
            COUNT(*) FILTER (WHERE delivery_status::text IN ('dang_giao','in_transit','picked_up','customs_clearance'))::int AS in_transit,
            COUNT(*) FILTER (
                WHERE delivery_status::text IN ('chua_giao','pending','dang_giao','in_transit')
                AND delivery_date < CURRENT_DATE
            )::int AS overdue,
            COALESCE(SUM(total_delivered_value_vnd) FILTER (
                WHERE delivery_status::text IN ('da_giao','delivered','completed','hoan_tat')
                AND EXTRACT(MONTH FROM COALESCE(po_date, delivery_date)) = EXTRACT(MONTH FROM NOW())
                AND EXTRACT(YEAR FROM COALESCE(po_date, delivery_date)) = EXTRACT(YEAR FROM NOW())
            ), 0)::bigint AS delivered_value_this_month
        FROM bqms_deliveries
    """)

    delivery_overdue = await conn.fetch("""
        SELECT po_number, bqms_code, LEFT(specification, 50) AS spec,
               delivery_date, delivery_status::text, recipient_name
        FROM bqms_deliveries
        WHERE delivery_status::text IN ('chua_giao','pending','dang_giao','in_transit')
          AND delivery_date < CURRENT_DATE
        ORDER BY delivery_date ASC LIMIT 10
    """)

    # ── NEW: Samsung PO Stats ──
    po_stats = await conn.fetchrow("""
        SELECT
            COUNT(*)::int AS total_pos,
            COUNT(*) FILTER (WHERE po_date >= DATE_TRUNC('month', NOW()))::int AS pos_this_month,
            COALESCE(SUM(amount), 0)::bigint AS total_amount,
            COALESCE(SUM(amount) FILTER (WHERE po_date >= DATE_TRUNC('month', NOW())), 0)::bigint AS amount_this_month,
            MAX(po_date) AS latest_po_date
        FROM bqms_samsung_po
    """)

    recent_pos = await conn.fetch("""
        SELECT po_number, bqms_code, LEFT(specification, 50) AS spec,
               po_date, order_qty, amount
        FROM bqms_samsung_po
        ORDER BY po_date DESC NULLS LAST LIMIT 5
    """)

    # ── NEW: Vendor Portal Stats ──
    vendor_stats = await conn.fetchrow("""
        SELECT
            (SELECT COUNT(*) FROM vendor_accounts WHERE is_approved = true)::int AS approved_vendors,
            (SELECT COUNT(*) FROM vendor_accounts WHERE is_approved = false)::int AS pending_vendors,
            (SELECT COUNT(*) FROM procurement_rfq_batches WHERE status = 'published')::int AS open_batches,
            (SELECT COUNT(*) FROM procurement_rfq_batches WHERE status = 'awarded')::int AS awarded_batches,
            (SELECT COUNT(*) FROM vendor_quotes WHERE status = 'submitted')::int AS total_quotes
    """)

    # Compute deltas
    rfq_tm = int(rfq_cards["rfq_this_month"] or 0)
    rfq_lm = int(rfq_cards["rfq_last_month"] or 0)
    rfq_ly = int(rfq_cards["rfq_same_month_ly"] or 0)
    rev_tm = float(rfq_cards["revenue_this_month"] or 0)
    rev_lm = float(rfq_cards["revenue_last_month"] or 0)

    result = {"data": {
        # Cards
        "rfq_this_month": rfq_tm,
        "rfq_last_month": rfq_lm,
        "rfq_mom_pct": round((rfq_tm - rfq_lm) / rfq_lm * 100, 1) if rfq_lm > 0 else 0,
        "rfq_yoy_pct": round((rfq_tm - rfq_ly) / rfq_ly * 100, 1) if rfq_ly > 0 else 0,
        "rfq_spark": [int(r["cnt"]) for r in spark],
        "win_rate_3m": float(win_rate["win_rate_3m"] or 0),
        "win_rate_prev_3m": float(win_rate["win_rate_prev_3m"] or 0),
        "win_rate_delta": round(float(win_rate["win_rate_3m"] or 0) - float(win_rate["win_rate_prev_3m"] or 0), 1),
        "won_3m": int(win_rate["won_3m"] or 0),
        "decided_3m": int(win_rate["decided_3m"] or 0),
        "revenue_this_month": rev_tm,
        "revenue_last_month": rev_lm,
        "revenue_mom_pct": round((rev_tm - rev_lm) / rev_lm * 100, 1) if rev_lm > 0 else 0,
        "rfq_pending": int(rfq_cards["rfq_pending"] or 0),
        "rfq_overdue": int(rfq_cards["rfq_overdue"] or 0),
        # Monthly revenue
        "monthly_revenue": [{"month": str(r["month"]), "total_rfq": r["total_rfq"], "won_count": r["won_count"],
                             "total_quoted": float(r["total_quoted"]), "won_revenue": float(r["won_revenue"])} for r in monthly],
        # YoY
        "yoy": [{"month_num": r["month_num"], "rfq_this_year": r["rfq_this_year"], "rfq_last_year": r["rfq_last_year"],
                 "revenue_this_year": float(r["revenue_this_year"]), "revenue_last_year": float(r["revenue_last_year"])} for r in yoy],
        # Funnel
        "funnel": dict(funnel) if funnel else {},
        # Win rate trend
        "win_rate_trend": [{"month": str(r["month"]), "won": r["won"], "lost": r["lost"],
                            "win_rate": float(r["win_rate"] or 0)} for r in win_trend],
        # Makers
        "makers": [dict(r) for r in makers],
        # Owners
        "owners": [dict(r) for r in owners],
        # Urgent RFQs
        "urgent_rfqs": [dict(r) for r in urgent_rfqs],

        # ── NEW: Delivery Tracking ──
        "delivery": dict(delivery_stats) if delivery_stats else {},
        "delivery_overdue": [dict(r) for r in delivery_overdue],

        # ── NEW: Samsung PO ──
        "samsung_po": dict(po_stats) if po_stats else {},
        "recent_pos": [dict(r) for r in recent_pos],

        # ── NEW: Vendor Portal ──
        "vendor_portal": dict(vendor_stats) if vendor_stats else {},
    }}

    # Cache 60s
    await cache.set(cache_key, result, ttl=60)
    return result


@router.get("/recent-activity")
async def recent_activity(
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Recent imported data as activity feed."""
    # Show recent bqms_rfq entries as activity
    rows = await conn.fetch(
        """
        SELECT id, rfq_number AS reference, bqms_code, specification AS detail,
               maker, result, inquiry_date AS created_at,
               'bqms_rfq' AS source
        FROM bqms_rfq
        ORDER BY created_at DESC NULLS LAST
        LIMIT $1
        """,
        limit,
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/stock-alerts")
async def stock_alerts(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Stock alerts — items below min stock OR recent BQMS deliveries pending."""
    # Show pending BQMS deliveries as alerts (since inventory table is empty)
    rows = await conn.fetch(
        """
        SELECT id, po_number, bqms_code, specification AS product_name,
               quantity, delivery_status, delivery_date
        FROM bqms_deliveries
        WHERE delivery_status != 'da_giao'
        ORDER BY po_date DESC NULLS LAST
        LIMIT 20
        """
    )
    return {"data": [dict(r) for r in rows]}
