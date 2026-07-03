"""Procurement Analytics — Đợt 6 (read-only insight layer over vendor bidding).

A SEPARATE APIRouter from procurement.py (which is left untouched). Mounted under
the SAME `/procurement` prefix by app/api/v1/__init__.py, so route paths here are
RELATIVE to that prefix (e.g. `@router.get("/analytics")` → `/procurement/analytics`).

Endpoints (ALL read-only, require_role(*_READ_ROLES); NEVER writes/awards):
  GET /analytics                       — one batched dashboard payload.
  GET /vendor-scorecard                — ranked vendor scorecard (all accounts).
  GET /vendor-scorecard/{vendor_id}    — single-vendor scorecard + raw counts.
  GET /batches/{batch_id}/smart-award  — deterministic ranked vendors per currency
                                         group (decision-support only, never awards).

CROSS-CUTTING INVARIANTS (enforced in every query below):
  * PER-CURRENCY ONLY by default. We NEVER SUM across USD/RMB/VND in the default
    (convert_vnd=False) path. Spend / award / savings are returned as PER-CURRENCY
    arrays; smart-award ranks strictly WITHIN a currency group and flags
    mixed-currency batches.
  * convert_vnd=True (#13) is a CONTROLLED escape hatch on GET /analytics ONLY: it
    ADDITIVELY emits VND-rolled-up figures (vnd_rollup + award_by_vendor_vnd)
    ALONGSIDE the per-currency arrays — it NEVER mutates/removes the per-currency
    output. Conversion is READ-TIME via LEFT JOIN LATERAL exchange_rates at the
    AS-OF date of each row (awarded_at / po_date / contract_date). A foreign-currency
    row MISSING a rate at that date is EXCLUDED from the VND sum (CASE→NULL drops it
    from SUM) and COUNTED as missing — we NEVER fall back to rate=1, NEVER use the
    latest rate. The `currency` filter param and `convert_vnd` are INDEPENDENT.
  * procurement_awards: EVERY query filters `superseded_by IS NULL` (the re-award
    chain) — otherwise superseded rows double-count win/spend.
  * Postgres NUMERIC serialises as a STRING in JSON. We coerce to float at the
    boundary via `_f()` so the FE never has to guess; the FE STILL must use
    toNum()/safeFixed() before .toFixed(), but we hand back real numbers.
  * Divide-by-zero: NULLIF(denom,0) on every rate; sparse vendors → null score +
    '–' grade (never punished to 0), weights renormalised over PRESENT factors.
  * On-time delivery is PO-grain: actual_delivery_date <= requested_delivery_date
    over procurement_pos WHERE status IN ('delivered','closed'). We deliberately do
    NOT use batches.evaluating_at (never stamped) nor per-delivery delivered_at
    (NULL for admin rows).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData
from app.services.sourcing_pricing_engine import fetch_fx_to_vnd  # Đợt 4 — VND-equiv hiển thị

logger = logging.getLogger(__name__)
router = APIRouter()

# Read-only role gate — mirrors procurement._READ_ROLES (admin, manager,
# procurement, staff). Kept local to avoid importing private state from
# procurement.py (which this module must not perturb).
_READ_ROLES = ("admin", "manager", "procurement", "staff")

# Scorecard weights (sum to 1.0). Renormalised over PRESENT factors per vendor so a
# sparse vendor with missing factors is scored fairly on what data exists, never 0.
_SCORE_WEIGHTS: dict[str, float] = {
    "response": 0.15,   # responded to invitations (submitted / invited)
    "win": 0.15,        # award win-rate (distinct awarded batches / submitted batches)
    "on_time": 0.25,    # PO actual <= requested delivery
    "quality": 0.15,    # delivery_items quality_status = 'ok'
    "lead": 0.10,       # quoted lead time vs cohort (min-max, lower is better)
    "price": 0.20,      # avg(unit_price / per-item min) → clamp(2 - r, 0, 1)
}
_FACTOR_KEYS = tuple(_SCORE_WEIGHTS.keys())


def _f(v: Any) -> float | None:
    """Coerce a Postgres NUMERIC/Decimal (serialised as str) to float, else None."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _grade(score: float | None) -> str:
    """A >= 80, B >= 60, C < 60; '–' (en-dash) when score is null (Chưa đủ dữ liệu)."""
    if score is None:
        return "–"
    if score >= 80:
        return "A"
    if score >= 60:
        return "B"
    return "C"


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


def _fx_lateral(ccy_col: str, asof_expr: str, alias: str = "fx") -> str:
    """Reusable LATERAL fragment (#13) resolving a row's currency→VND rate AS-OF date.

    Picks the most-recent exchange_rates row effective ON OR BEFORE `asof_expr`.
    exchange_rates HAS a `rate_type` column (init_v3.sql:381 — cash_buy/transfer/sell,
    part of UNIQUE uq_exchange_rate), so a single (rate_date, from, to) can carry up to
    3 rows. We tie-break `(er.rate_type='transfer') DESC` to DETERMINISTICALLY prefer the
    transfer rate for rollup — matching kpi_aggregator.py:87 + m40/m41 (without it the
    row picked depends on created_at order, i.e. an arbitrary rate_type). LEFT JOIN ⇒
    `{alias}.rate` is NULL when no rate exists at that date; callers MUST treat NULL as
    "exclude + count missing" (NEVER rate=1, NEVER latest).

    Args:
      ccy_col   — SQL expr for the row's currency (e.g. "a.currency").
      asof_expr — SQL expr for the as-of DATE (e.g. "a.awarded_at::date", "p.po_date").
      alias     — output alias (default "fx"); use distinct aliases if joined twice.
    """
    return (
        # exchange_rates.from_currency is the `currency_code` ENUM; procurement currency
        # columns ({ccy_col}) are plain TEXT (USD/RMB/VND...), so we MUST cast the enum
        # side to text — `currency_code = text` has no operator (m40 worked only because
        # sales_orders.currency is itself the enum). to_currency='VND' coerces fine.
        f"LEFT JOIN LATERAL (SELECT er.rate FROM exchange_rates er "
        f"WHERE er.from_currency::text = {ccy_col} AND er.to_currency = 'VND' "
        f"AND er.rate_date <= {asof_expr} "
        f"ORDER BY er.rate_date DESC, (er.rate_type = 'transfer') DESC, er.created_at DESC "
        f"LIMIT 1) {alias} ON TRUE"
    )


# ===========================================================================
# GET /analytics — one batched dashboard payload
# ===========================================================================

@router.get("/analytics")
async def procurement_analytics(
    months: int = Query(12, ge=1, le=36, description="Cửa sổ thời gian (tháng)"),
    currency: str | None = Query(None, description="Lọc 1 loại tiền (USD/RMB/VND)"),
    convert_vnd: bool = Query(
        False,
        description=(
            "Quy đổi mọi nhóm tiền về VND để gộp 1 con số (read-time, theo tỷ giá "
            "hiệu lực tại ngày mốc award/PO/contract). Mặc định False ⇒ response "
            "byte-for-byte như cũ. Dòng ngoại tệ thiếu tỷ giá ở ngày đó bị LOẠI + đếm "
            "missing (KHÔNG bịa rate=1, KHÔNG dùng tỷ giá mới nhất)."
        ),
    ),
    token_data: TokenData = Depends(require_role(*_READ_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Một payload gộp cho dashboard phân tích đấu thầu (PER-CURRENCY).

    Trả về:
      spend_trend       — chuỗi chi tiêu theo tháng × loại tiền (awards + po + contract).
      batches_by_status — đếm batch theo status.
      quote_funnel      — invited → viewed → submitted → awarded.
      award_by_vendor   — COUNT + SUM award theo (NCC, loại tiền).
      cycle_time        — AVG ngày giữa các mốc (+ sample_sizes).
      on_time_delivery  — tỉ lệ giao đúng hạn (PO-grain).
      savings           — tiết kiệm so target_price, theo loại tiền (+ coverage).
      delivery_due      — (#17, INTERNAL) PO mở sắp/đã quá hạn giao trong 14 ngày
                          (overdue_count/due_soon_count + items). KHÔNG SUM tiền
                          (chỉ progress % theo SL) — giữ invariant per-currency.

    convert_vnd=True (#13, lối thoát CÓ KIỂM SOÁT — KHÔNG sửa array per-currency):
      THÊM khối `vnd_rollup` + `award_by_vendor_vnd` GỘP về VND read-time. Quy đổi
      theo tỷ giá hiệu lực tại NGÀY MỐC từng dòng (LATERAL exchange_rates,
      rate_date<=as-of). Dòng ngoại tệ THIẾU tỷ giá tại ngày đó bị LOẠI khỏi tổng VND
      (CASE→NULL ⇒ rớt khỏi SUM) và được ĐẾM (missing_rate). TUYỆT ĐỐI KHÔNG fallback
      rate=1, KHÔNG dùng latest. `currency` và `convert_vnd` ĐỘC LẬP.
    """
    cur = (currency or "").strip().upper() or None
    mwin = str(int(months))  # bound into a ($1 || ' months')::interval

    # ── spend_trend ────────────────────────────────────────────────────────
    # awarded_value: SUM(awarded_price * COALESCE(quantity,1)) from ACTIVE awards,
    # GROUP BY currency, month. Per-currency — NEVER summed across currencies.
    award_spend = await conn.fetch(
        """
        SELECT a.currency,
               TO_CHAR(DATE_TRUNC('month', a.awarded_at), 'YYYY-MM') AS month_key,
               COALESCE(SUM(a.awarded_price * COALESCE(a.quantity, 1)), 0)::numeric AS awarded_value,
               COUNT(*)::int AS award_count
        FROM procurement_awards a
        WHERE a.superseded_by IS NULL
          AND a.awarded_at >= NOW() - ($1 || ' months')::interval
          AND ($2::text IS NULL OR a.currency = $2)
        GROUP BY a.currency, DATE_TRUNC('month', a.awarded_at)
        ORDER BY a.currency, month_key
        """,
        mwin, cur,
    )
    # po_value: realised PO spend per currency/month (status <> cancelled).
    po_spend = await conn.fetch(
        """
        SELECT p.currency,
               TO_CHAR(DATE_TRUNC('month', p.po_date), 'YYYY-MM') AS month_key,
               COALESCE(SUM(p.total_amount), 0)::numeric AS po_value,
               COUNT(*)::int AS po_count
        FROM procurement_pos p
        WHERE p.status <> 'cancelled'
          AND p.po_date >= (NOW() - ($1 || ' months')::interval)::date
          AND ($2::text IS NULL OR p.currency = $2)
        GROUP BY p.currency, DATE_TRUNC('month', p.po_date)
        ORDER BY p.currency, month_key
        """,
        mwin, cur,
    )
    # contract_value: committed contract spend per currency/month (status <> cancelled).
    contract_spend = await conn.fetch(
        """
        SELECT c.currency,
               TO_CHAR(DATE_TRUNC('month', COALESCE(c.contract_date, c.created_at::date)), 'YYYY-MM') AS month_key,
               COALESCE(SUM(c.total_amount), 0)::numeric AS contract_value,
               COUNT(*)::int AS contract_count
        FROM procurement_contracts c
        WHERE c.status <> 'cancelled'
          AND COALESCE(c.contract_date, c.created_at::date) >= (NOW() - ($1 || ' months')::interval)::date
          AND ($2::text IS NULL OR c.currency = $2)
        GROUP BY c.currency, DATE_TRUNC('month', COALESCE(c.contract_date, c.created_at::date))
        ORDER BY c.currency, month_key
        """,
        mwin, cur,
    )
    # Merge the 3 series into one per-(currency, month) grid keyed in Python.
    spend_grid: dict[tuple[str, str], dict[str, Any]] = {}

    def _cell(ccy: str | None, mk: str | None) -> dict[str, Any]:
        key = (ccy or "VND", mk or "")
        cell = spend_grid.get(key)
        if cell is None:
            cell = {
                "currency": key[0], "month_key": key[1],
                "awarded_value": 0.0, "award_count": 0,
                "po_value": 0.0, "po_count": 0,
                "contract_value": 0.0, "contract_count": 0,
            }
            spend_grid[key] = cell
        return cell

    for r in award_spend:
        c = _cell(r["currency"], r["month_key"])
        c["awarded_value"] = _f(r["awarded_value"]) or 0.0
        c["award_count"] = r["award_count"]
    for r in po_spend:
        c = _cell(r["currency"], r["month_key"])
        c["po_value"] = _f(r["po_value"]) or 0.0
        c["po_count"] = r["po_count"]
    for r in contract_spend:
        c = _cell(r["currency"], r["month_key"])
        c["contract_value"] = _f(r["contract_value"]) or 0.0
        c["contract_count"] = r["contract_count"]

    # Emit GROUPED-by-currency for the FE: [{currency, points:[{month, spend}]}].
    # `spend` is the awarded_value (primary chart series). po_value/contract_value are
    # still computed above (kept for future overlays) but the FE only plots awarded.
    flat_cells = sorted(
        spend_grid.values(), key=lambda d: (d["currency"], d["month_key"])
    )
    spend_by_ccy: dict[str, list[dict[str, Any]]] = {}
    for cell in flat_cells:
        spend_by_ccy.setdefault(cell["currency"], []).append({
            "month": cell["month_key"],
            "spend": cell["awarded_value"],
        })
    spend_trend = [
        {"currency": ccy, "points": spend_by_ccy[ccy]}
        for ccy in sorted(spend_by_ccy.keys())
    ]

    # ── batches_by_status ──────────────────────────────────────────────────
    batch_rows = await conn.fetch(
        """
        SELECT status, COUNT(*)::int AS count
        FROM procurement_rfq_batches
        GROUP BY status
        ORDER BY status
        """
    )
    batches_by_status = [{"status": r["status"], "count": r["count"]} for r in batch_rows]

    # ── quote_funnel ───────────────────────────────────────────────────────
    # invited/viewed/submitted are DISTINCT (batch_id, vendor_id) over invitations
    # (collapses multi-round duplicates). awarded = DISTINCT vendor_id over ACTIVE
    # awards. Per-currency does not apply to a count funnel.
    funnel = await conn.fetchrow(
        """
        WITH inv AS (
            SELECT DISTINCT ON (batch_id, vendor_id) batch_id, vendor_id, status, viewed_at
            FROM procurement_rfq_invitations
            ORDER BY batch_id, vendor_id, round_number DESC
        )
        SELECT
            COUNT(*)::int AS invited,
            COUNT(*) FILTER (WHERE viewed_at IS NOT NULL OR status IN ('viewed','submitted'))::int AS viewed,
            COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted
        FROM inv
        """
    )
    awarded_vendors = await conn.fetchval(
        """
        SELECT COUNT(DISTINCT vendor_id)::int
        FROM procurement_awards
        WHERE superseded_by IS NULL
        """
    )
    quote_funnel = {
        "invited": (funnel["invited"] if funnel else 0) or 0,
        "viewed": (funnel["viewed"] if funnel else 0) or 0,
        "submitted": (funnel["submitted"] if funnel else 0) or 0,
        "awarded": awarded_vendors or 0,
    }

    # ── award_by_vendor (per vendor × currency) ────────────────────────────
    abv_rows = await conn.fetch(
        """
        SELECT a.vendor_id, va.company_name, a.currency,
               COUNT(*)::int AS award_count,
               COALESCE(SUM(a.awarded_price * COALESCE(a.quantity, 1)), 0)::numeric AS awarded_value
        FROM procurement_awards a
        JOIN vendor_accounts va ON va.id = a.vendor_id
        WHERE a.superseded_by IS NULL
          AND ($1::text IS NULL OR a.currency = $1)
        GROUP BY a.vendor_id, va.company_name, a.currency
        ORDER BY awarded_value DESC
        """,
        cur,
    )
    # Emit GROUPED-by-currency for the FE: [{currency, vendors:[{vendor_id,
    # vendor_name, amount}]}]. Per-currency only — never summed across currencies.
    award_by_ccy: dict[str, list[dict[str, Any]]] = {}
    for r in abv_rows:
        ccy = r["currency"] or "VND"
        award_by_ccy.setdefault(ccy, []).append({
            "vendor_id": r["vendor_id"],
            "vendor_name": r["company_name"],
            "amount": _f(r["awarded_value"]),
            "award_count": r["award_count"],
        })
    award_by_vendor = [
        {"currency": ccy, "vendors": award_by_ccy[ccy]}
        for ccy in sorted(award_by_ccy.keys())
    ]

    # ── cycle_time (+ sample_sizes) ────────────────────────────────────────
    # AVG day-diffs across lifecycle hops. Each AVG carries its own COUNT (sample
    # size) so the FE can hide thin samples. publish→award uses batch timestamps;
    # award→contract / contract→po / po→delivered chain the entity timestamps.
    cyc = await conn.fetchrow(
        """
        WITH pub_award AS (
            SELECT EXTRACT(EPOCH FROM (b.awarded_at - b.published_at)) / 86400.0 AS d
            FROM procurement_rfq_batches b
            WHERE b.published_at IS NOT NULL AND b.awarded_at IS NOT NULL
              AND b.awarded_at >= b.published_at
        ),
        award_contract AS (
            SELECT EXTRACT(EPOCH FROM (c.created_at - b.awarded_at)) / 86400.0 AS d
            FROM procurement_contracts c
            JOIN procurement_rfq_batches b ON b.id = c.batch_id
            WHERE b.awarded_at IS NOT NULL AND c.status <> 'cancelled'
              AND c.created_at >= b.awarded_at
        ),
        contract_po AS (
            SELECT (p.po_date - c.contract_date) AS d
            FROM procurement_pos p
            JOIN procurement_contracts c ON c.id = p.contract_id
            WHERE c.contract_date IS NOT NULL AND p.po_date IS NOT NULL
              AND p.status <> 'cancelled' AND p.po_date >= c.contract_date
        ),
        po_delivered AS (
            SELECT (p.actual_delivery_date - p.po_date) AS d
            FROM procurement_pos p
            WHERE p.actual_delivery_date IS NOT NULL AND p.po_date IS NOT NULL
              AND p.actual_delivery_date >= p.po_date
        )
        SELECT
            (SELECT AVG(d) FROM pub_award)         AS publish_to_award,
            (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d) FROM pub_award) AS pa_median,
            (SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY d) FROM pub_award) AS pa_p90,
            (SELECT MIN(d) FROM pub_award)         AS pa_min,
            (SELECT COUNT(*) FROM pub_award)::int  AS publish_to_award_n,
            (SELECT AVG(d) FROM award_contract)   AS award_to_contract,
            (SELECT COUNT(*) FROM award_contract)::int AS award_to_contract_n,
            (SELECT AVG(d) FROM contract_po)      AS contract_to_po,
            (SELECT COUNT(*) FROM contract_po)::int AS contract_to_po_n,
            (SELECT AVG(d) FROM po_delivered)     AS po_to_delivered,
            (SELECT COUNT(*) FROM po_delivered)::int AS po_to_delivered_n
        """
    )
    # FE renders the publish→award cycle: {avg_days, median_days, p90_days, min_days, n}.
    # The award→contract / contract→po / po→delivered hops (same SQL, unchanged
    # semantics) are still exposed under `lifecycle` for future drill-downs.
    cycle_time = {
        "avg_days": _f(cyc["publish_to_award"]),
        "median_days": _f(cyc["pa_median"]),
        "p90_days": _f(cyc["pa_p90"]),
        "min_days": _f(cyc["pa_min"]),
        "n": cyc["publish_to_award_n"],
        "lifecycle": {
            "publish_to_award": _f(cyc["publish_to_award"]),
            "award_to_contract": _f(cyc["award_to_contract"]),
            "contract_to_po": _f(cyc["contract_to_po"]),
            "po_to_delivered": _f(cyc["po_to_delivered"]),
            "sample_sizes": {
                "publish_to_award": cyc["publish_to_award_n"],
                "award_to_contract": cyc["award_to_contract_n"],
                "contract_to_po": cyc["contract_to_po_n"],
                "po_to_delivered": cyc["po_to_delivered_n"],
            },
        },
    }

    # ── on_time_delivery (PO-grain) ────────────────────────────────────────
    # Closed/delivered POs that had a requested date; on-time = actual <= requested.
    otd = await conn.fetchrow(
        """
        SELECT
            COUNT(*)::int AS total_pos,
            COUNT(*) FILTER (
                WHERE p.actual_delivery_date IS NOT NULL
                  AND p.actual_delivery_date <= p.requested_delivery_date
            )::int AS on_time,
            COUNT(*) FILTER (
                WHERE p.actual_delivery_date IS NOT NULL
                  AND p.actual_delivery_date > p.requested_delivery_date
            )::int AS late,
            ROUND(
                COUNT(*) FILTER (
                    WHERE p.actual_delivery_date IS NOT NULL
                      AND p.actual_delivery_date <= p.requested_delivery_date
                )::numeric * 100.0
                / NULLIF(COUNT(*) FILTER (WHERE p.actual_delivery_date IS NOT NULL), 0)
            , 1) AS on_time_pct
        FROM procurement_pos p
        WHERE p.status IN ('delivered', 'closed')
          AND p.requested_delivery_date IS NOT NULL
        """
    )
    # Monthly on-time % trend for the Sparkline (same population/semantics as the
    # totals above — just GROUP BY po_date month, ordered chronologically).
    otd_trend = await conn.fetch(
        """
        SELECT TO_CHAR(DATE_TRUNC('month', p.po_date), 'YYYY-MM') AS month_key,
               ROUND(
                   COUNT(*) FILTER (
                       WHERE p.actual_delivery_date IS NOT NULL
                         AND p.actual_delivery_date <= p.requested_delivery_date
                   )::numeric * 100.0
                   / NULLIF(COUNT(*) FILTER (WHERE p.actual_delivery_date IS NOT NULL), 0)
               , 1) AS pct
        FROM procurement_pos p
        WHERE p.status IN ('delivered', 'closed')
          AND p.requested_delivery_date IS NOT NULL
          AND p.po_date IS NOT NULL
          AND p.po_date >= (NOW() - ($1 || ' months')::interval)::date
        GROUP BY DATE_TRUNC('month', p.po_date)
        ORDER BY DATE_TRUNC('month', p.po_date)
        """,
        mwin,
    )
    on_time_delivery = {
        "on_time": (otd["on_time"] if otd else 0) or 0,
        "late": (otd["late"] if otd else 0) or 0,
        "total": (otd["total_pos"] if otd else 0) or 0,
        "rate_pct": _f(otd["on_time_pct"]) if otd else None,
        "trend": [_f(r["pct"]) for r in otd_trend if r["pct"] is not None],
    }

    # ── savings (per currency, + coverage) ─────────────────────────────────
    # SUM((target_price - awarded_price) * qty) over ACTIVE per_item awards JOIN
    # rfq_items (which carries target_price). Per-currency. coverage = items that
    # had BOTH a target and an award price vs all awarded items.
    sav_rows = await conn.fetch(
        """
        SELECT a.currency,
               COALESCE(SUM(
                   (i.target_price - a.awarded_price)
                   * COALESCE(a.quantity, i.quantity, 1)
               ), 0)::numeric AS savings_value,
               COALESCE(SUM(i.target_price * COALESCE(a.quantity, i.quantity, 1)), 0)::numeric AS target_value,
               COUNT(*) FILTER (WHERE i.target_price IS NOT NULL AND a.awarded_price IS NOT NULL)::int AS items_with_target,
               COUNT(*)::int AS items_awarded
        FROM procurement_awards a
        JOIN procurement_rfq_items i ON i.id = a.item_id
        WHERE a.superseded_by IS NULL
          AND a.item_id IS NOT NULL
          AND i.target_price IS NOT NULL
          AND a.awarded_price IS NOT NULL
          AND ($1::text IS NULL OR a.currency = $1)
        GROUP BY a.currency
        ORDER BY a.currency
        """,
        cur,
    )
    # coverage denominator = all ACTIVE per_item awards (with or without target),
    # GROUPED BY currency so each savings group carries its own covered/total.
    cov_rows = await conn.fetch(
        """
        SELECT a.currency,
            COUNT(*)::int AS total_awarded_items,
            COUNT(*) FILTER (WHERE i.target_price IS NOT NULL)::int AS items_with_target
        FROM procurement_awards a
        JOIN procurement_rfq_items i ON i.id = a.item_id
        WHERE a.superseded_by IS NULL AND a.item_id IS NOT NULL
          AND ($1::text IS NULL OR a.currency = $1)
        GROUP BY a.currency
        """,
        cur,
    )
    cov_by_ccy = {r["currency"]: r for r in cov_rows}
    # Emit a FLAT per-currency array for the FE:
    #   [{currency, baseline, awarded, savings, covered, total_awards}]
    #   baseline = Σ target_value; awarded = baseline - savings; savings = Σ savings_value
    #   covered  = # awarded items that HAD a target; total_awards = all awarded items.
    # Per-currency only — never summed across currencies.
    savings = []
    for r in sav_rows:
        ccy = r["currency"]
        baseline = _f(r["target_value"]) or 0.0
        sv = _f(r["savings_value"]) or 0.0
        cov = cov_by_ccy.get(ccy)
        savings.append({
            "currency": ccy,
            "baseline": baseline,
            "awarded": baseline - sv,
            "savings": sv,
            "covered": (cov["items_with_target"] if cov else r["items_with_target"]) or 0,
            "total_awards": (cov["total_awarded_items"] if cov else 0) or 0,
        })

    # ── #13 VND rollup (ADDITIVE; emitted ONLY when convert_vnd=True) ────────
    # Read-time conversion of award/po/contract/savings to a SINGLE VND figure via
    # _fx_lateral() at each row's AS-OF date. Foreign rows missing a rate at that date
    # are DROPPED from the SUM (CASE→NULL) and COUNTED (missing_rate_rows). The
    # per-currency arrays above are NOT touched. None when convert_vnd=False ⇒ the rest
    # of the payload is byte-for-byte identical to the legacy response.
    vnd_rollup: dict[str, Any] | None = None
    award_by_vendor_vnd: list[dict[str, Any]] | None = None
    if convert_vnd:
        # awarded_vnd: SUM over ACTIVE awards in window, VND passthrough else fx.rate.
        award_vnd_row = await conn.fetchrow(
            f"""
            SELECT
                COALESCE(SUM(
                    a.awarded_price * COALESCE(a.quantity, 1)
                    * CASE WHEN a.currency = 'VND' THEN 1 ELSE fx.rate END
                ), 0)::numeric AS awarded_vnd,
                COUNT(*) FILTER (WHERE a.currency <> 'VND' AND fx.rate IS NULL)::int AS missing_rate_rows
            FROM procurement_awards a
            {_fx_lateral("a.currency", "a.awarded_at::date")}
            WHERE a.superseded_by IS NULL
              AND a.awarded_at >= NOW() - ($1 || ' months')::interval
              AND ($2::text IS NULL OR a.currency = $2)
            """,
            mwin, cur,
        )
        # po_vnd: realised PO spend (status <> cancelled), po_date is already DATE.
        po_vnd_row = await conn.fetchrow(
            f"""
            SELECT
                COALESCE(SUM(
                    p.total_amount * CASE WHEN p.currency = 'VND' THEN 1 ELSE fx.rate END
                ), 0)::numeric AS po_vnd,
                COUNT(*) FILTER (WHERE p.currency <> 'VND' AND fx.rate IS NULL)::int AS missing_rate_rows
            FROM procurement_pos p
            {_fx_lateral("p.currency", "p.po_date")}
            WHERE p.status <> 'cancelled'
              AND p.po_date >= (NOW() - ($1 || ' months')::interval)::date
              AND ($2::text IS NULL OR p.currency = $2)
            """,
            mwin, cur,
        )
        # contract_vnd: committed contract spend, as-of COALESCE(contract_date, created_at::date).
        contract_vnd_row = await conn.fetchrow(
            f"""
            SELECT
                COALESCE(SUM(
                    c.total_amount * CASE WHEN c.currency = 'VND' THEN 1 ELSE fx.rate END
                ), 0)::numeric AS contract_vnd,
                COUNT(*) FILTER (WHERE c.currency <> 'VND' AND fx.rate IS NULL)::int AS missing_rate_rows
            FROM procurement_contracts c
            {_fx_lateral("c.currency", "COALESCE(c.contract_date, c.created_at::date)")}
            WHERE c.status <> 'cancelled'
              AND COALESCE(c.contract_date, c.created_at::date) >= (NOW() - ($1 || ' months')::interval)::date
              AND ($2::text IS NULL OR c.currency = $2)
            """,
            mwin, cur,
        )
        # savings_vnd / baseline_vnd: CRITICAL — multiply BOTH target_price and
        # awarded_price by the SAME fx.rate of that award (same unit), as-of awarded_at.
        # awarded_vnd_total = baseline_vnd_total - savings_vnd_total (consistent by
        # construction). Same filter as the per-currency savings query.
        sav_vnd_row = await conn.fetchrow(
            f"""
            SELECT
                COALESCE(SUM(
                    (i.target_price - a.awarded_price) * COALESCE(a.quantity, i.quantity, 1)
                    * CASE WHEN a.currency = 'VND' THEN 1 ELSE fx.rate END
                ), 0)::numeric AS savings_vnd,
                COALESCE(SUM(
                    i.target_price * COALESCE(a.quantity, i.quantity, 1)
                    * CASE WHEN a.currency = 'VND' THEN 1 ELSE fx.rate END
                ), 0)::numeric AS baseline_vnd,
                COUNT(*) FILTER (WHERE a.currency <> 'VND' AND fx.rate IS NULL)::int AS missing_rate_rows
            FROM procurement_awards a
            JOIN procurement_rfq_items i ON i.id = a.item_id
            {_fx_lateral("a.currency", "a.awarded_at::date")}
            WHERE a.superseded_by IS NULL
              AND a.item_id IS NOT NULL
              AND i.target_price IS NOT NULL
              AND a.awarded_price IS NOT NULL
              AND ($1::text IS NULL OR a.currency = $1)
            """,
            cur,
        )
        baseline_vnd = _f(sav_vnd_row["baseline_vnd"]) or 0.0
        savings_vnd = _f(sav_vnd_row["savings_vnd"]) or 0.0
        vnd_rollup = {
            "awarded_vnd": _f(award_vnd_row["awarded_vnd"]),
            "po_vnd": _f(po_vnd_row["po_vnd"]),
            "contract_vnd": _f(contract_vnd_row["contract_vnd"]),
            "savings_vnd": savings_vnd,
            "baseline_vnd": baseline_vnd,
            "awarded_vnd_from_savings": baseline_vnd - savings_vnd,
            "missing_rate": {
                "award": award_vnd_row["missing_rate_rows"] or 0,
                "po": po_vnd_row["missing_rate_rows"] or 0,
                "contract": contract_vnd_row["missing_rate_rows"] or 0,
                "savings": sav_vnd_row["missing_rate_rows"] or 0,
            },
            "as_of": "read-time",
            "rate_source": "exchange_rates",
        }

        # award_by_vendor_vnd: SUM award per vendor rolled up to VND (as-of awarded_at),
        # sorted DESC. Foreign rows missing a rate at their date contribute NULL ⇒ rows
        # with NO rated lines sink via NULLS LAST. Per-vendor per-currency array stays.
        abv_vnd_rows = await conn.fetch(
            f"""
            SELECT a.vendor_id, va.company_name,
                   SUM(
                       a.awarded_price * COALESCE(a.quantity, 1)
                       * CASE WHEN a.currency = 'VND' THEN 1 ELSE fx.rate END
                   )::numeric AS amount_vnd,
                   COUNT(*)::int AS award_count,
                   COUNT(*) FILTER (WHERE a.currency <> 'VND' AND fx.rate IS NULL)::int AS missing_rate_rows
            FROM procurement_awards a
            JOIN vendor_accounts va ON va.id = a.vendor_id
            {_fx_lateral("a.currency", "a.awarded_at::date")}
            WHERE a.superseded_by IS NULL
              AND ($1::text IS NULL OR a.currency = $1)
            GROUP BY a.vendor_id, va.company_name
            ORDER BY amount_vnd DESC NULLS LAST
            """,
            cur,
        )
        award_by_vendor_vnd = [
            {
                "vendor_id": r["vendor_id"],
                "vendor_name": r["company_name"],
                "amount": _f(r["amount_vnd"]),
                "award_count": r["award_count"],
                "missing_rate_rows": r["missing_rate_rows"] or 0,
            }
            for r in abv_vnd_rows
        ]

    # ── #17 delivery-due cockpit (INTERNAL-ONLY, PER-CURRENCY — no money sum) ─
    # Open POs (status open / partially_delivered) whose requested_delivery_date
    # is within DUE_SOON_WINDOW_DAYS days (covers overdue, which are <= today).
    # The cockpit window (14d) is DELIBERATELY WIDER than the notification threshold
    # (app_config 'procurement_delivery_due_alert_days', default 3) so the team can
    # plan proactively (C3). NO money is summed here (per-currency invariant intact);
    # we only show delivery progress (% qty) which is currency-free.
    DUE_SOON_WINDOW_DAYS = 14
    due_rows = await conn.fetch(
        """
        SELECT
            p.id                                            AS po_id,
            p.po_no                                         AS po_no,
            p.batch_id                                      AS batch_id,
            p.vendor_name                                   AS vendor_name,
            p.requested_delivery_date                       AS req_date,
            (p.requested_delivery_date - CURRENT_DATE)::int AS days_remaining,
            COALESCE(SUM(it.delivered_qty), 0)::numeric     AS delivered,
            COALESCE(SUM(it.ordered_qty), 0)::numeric       AS ordered
        FROM procurement_pos p
        LEFT JOIN procurement_po_items it ON it.po_id = p.id
        WHERE p.status IN ('open', 'partially_delivered')
          AND p.requested_delivery_date IS NOT NULL
          AND p.requested_delivery_date <= CURRENT_DATE + ($1 || ' days')::interval
        GROUP BY p.id
        ORDER BY p.requested_delivery_date ASC, p.id ASC
        LIMIT 50
        """,
        str(DUE_SOON_WINDOW_DAYS),
    )
    due_items: list[dict[str, Any]] = []
    overdue_count = 0
    due_soon_count = 0
    for r in due_rows:
        dr = r["days_remaining"]
        severity = "overdue" if (dr is not None and dr < 0) else "due_soon"
        if severity == "overdue":
            overdue_count += 1
        else:
            due_soon_count += 1
        ordered = _f(r["ordered"]) or 0.0
        delivered = _f(r["delivered"]) or 0.0
        progress_pct = (delivered / ordered * 100.0) if ordered > 0 else None
        due_items.append({
            "po_id": r["po_id"],
            "po_no": r["po_no"],
            "batch_id": r["batch_id"],
            "vendor_name": r["vendor_name"],
            "days_remaining": dr,
            "requested_delivery_date": r["req_date"].isoformat() if r["req_date"] else None,
            "progress_pct": progress_pct,
            "severity": severity,
        })
    delivery_due = {
        "window_days": DUE_SOON_WINDOW_DAYS,
        "overdue_count": overdue_count,
        "due_soon_count": due_soon_count,
        "items": due_items,
    }

    return {
        "data": {
            "window_months": months,
            "currency_filter": cur,
            "convert_vnd": convert_vnd,
            "spend_trend": spend_trend,
            "batches_by_status": batches_by_status,
            "quote_funnel": quote_funnel,
            "award_by_vendor": award_by_vendor,
            "award_by_vendor_vnd": award_by_vendor_vnd,
            "cycle_time": cycle_time,
            "on_time_delivery": on_time_delivery,
            "savings": savings,
            "vnd_rollup": vnd_rollup,
            "delivery_due": delivery_due,
        }
    }


# ===========================================================================
# Scorecard factor computation (shared by ranking + single-vendor endpoints)
# ===========================================================================

async def _scorecard_factors(
    conn: asyncpg.Connection, months: int, min_invites: int,
    offset_months: int = 0,
) -> dict[int, dict[str, Any]]:
    """Compute per-vendor sub-scores (0..1) for every vendor_accounts row.

    Returns {vendor_id: {factors:{...}, raw:{...}, company_name, sufficient}}.
    Each factor is its OWN CTE; missing factors stay None (renormalised later).
    Per-currency rule is respected: price_score normalises unit_price against the
    PER-ITEM min (same item ⇒ same currency), never across currencies.

    TIME WINDOW (`months`) — applied CONSISTENTLY to EVERY factor (decision):
      invitation/response/win → invited_at / awarded_at;
      on_time → procurement_pos.po_date;
      quality → COALESCE(received_at, delivered_at) on procurement_deliveries;
      lead/price → v_latest_vendor_quote.submitted_at.
    Previously only the invitation CTE was windowed (inconsistent); now all factors
    share the same NOW() - ($1 months) cutoff so the score reflects ONE period.

    `offset_months` (additive, default 0 ⇒ current behaviour BYTE-FOR-BYTE): when
    > 0 the window is SHIFTED BACK by that many months, i.e. each factor is bounded
    BELOW by NOW() - ($1 = offset+months) AND ABOVE by NOW() - ($2 = offset). Used to
    re-run the SAME aggregation over the immediately-preceding period for prev_rank.
    With offset 0 NO upper bound is added (the `$2` predicate is omitted entirely),
    so the live scorecard query is unchanged.
    """
    # Lower-bound cutoff in months: total lookback = offset + months. Upper bound (if
    # offset>0) is NOW() - (offset months). Both passed as the SAME params to EVERY
    # query so the shift is consistent across all factors.
    lo_mwin = str(int(offset_months) + int(months))   # $1 — lower bound months
    hi_mwin = str(int(offset_months))                 # $2 — upper bound months (0 ⇒ none)
    # Upper-bound predicate fragment per column; empty string when offset==0 so the
    # current-period path is identical to before (single-sided window).
    def _ub(col: str, cast: str = "") -> str:
        if int(offset_months) <= 0:
            return ""
        return f"          AND {col} < (NOW() - ($2 || ' months')::interval){cast}\n"
    # Param tuple shared by every query. When offset==0 the `_ub` fragments are empty,
    # so `$2` is NEVER referenced and MUST NOT be passed (asyncpg rejects unused params)
    # — fall back to the single-param call exactly as before.
    _args: tuple[str, ...] = (lo_mwin, hi_mwin) if int(offset_months) > 0 else (lo_mwin,)

    # response + win + invite counts (invitation/quote/award grained, per vendor).
    base_rows = await conn.fetch(
        f"""
        WITH inv AS (
            SELECT DISTINCT ON (batch_id, vendor_id) batch_id, vendor_id, status
            FROM procurement_rfq_invitations
            WHERE invited_at >= NOW() - ($1 || ' months')::interval
{_ub("invited_at")}            ORDER BY batch_id, vendor_id, round_number DESC
        ),
        inv_agg AS (
            SELECT vendor_id,
                   COUNT(*)::int AS invited_batches,
                   COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted_batches
            FROM inv GROUP BY vendor_id
        ),
        win_agg AS (
            SELECT vendor_id, COUNT(DISTINCT batch_id)::int AS won_batches
            FROM procurement_awards
            WHERE superseded_by IS NULL
              AND awarded_at >= NOW() - ($1 || ' months')::interval
{_ub("awarded_at")}            GROUP BY vendor_id
        )
        SELECT va.id AS vendor_id, va.company_name, va.status AS account_status,
               COALESCE(i.invited_batches, 0)   AS invited_batches,
               COALESCE(i.submitted_batches, 0) AS submitted_batches,
               COALESCE(w.won_batches, 0)       AS won_batches
        FROM vendor_accounts va
        LEFT JOIN inv_agg i ON i.vendor_id = va.id
        LEFT JOIN win_agg w ON w.vendor_id = va.id
        ORDER BY va.id
        """,
        *_args,
    )

    # on_time + quality (PO + delivery grain, per vendor) — windowed.
    po_rows = await conn.fetch(
        f"""
        SELECT p.vendor_id,
               COUNT(*) FILTER (WHERE p.status IN ('delivered','closed')
                                  AND p.requested_delivery_date IS NOT NULL
                                  AND p.actual_delivery_date IS NOT NULL)::int AS rated_pos,
               COUNT(*) FILTER (WHERE p.status IN ('delivered','closed')
                                  AND p.actual_delivery_date IS NOT NULL
                                  AND p.requested_delivery_date IS NOT NULL
                                  AND p.actual_delivery_date <= p.requested_delivery_date)::int AS on_time_pos
        FROM procurement_pos p
        WHERE p.vendor_id IS NOT NULL
          AND p.po_date >= (NOW() - ($1 || ' months')::interval)::date
{_ub("p.po_date", "::date")}        GROUP BY p.vendor_id
        """,
        *_args,
    )
    qual_rows = await conn.fetch(
        f"""
        SELECT d.vendor_id,
               COUNT(*)::int AS rated_items,
               COUNT(*) FILTER (WHERE di.quality_status = 'ok')::int AS ok_items
        FROM procurement_delivery_items di
        JOIN procurement_deliveries d ON d.id = di.delivery_id
        WHERE d.vendor_id IS NOT NULL
          AND COALESCE(d.received_at, d.delivered_at) >= NOW() - ($1 || ' months')::interval
{_ub("COALESCE(d.received_at, d.delivered_at)")}        GROUP BY d.vendor_id
        """,
        *_args,
    )

    # lead: avg quoted lead_time_days per vendor (latest-round submitted quotes) — windowed.
    lead_rows = await conn.fetch(
        f"""
        SELECT vq.vendor_id, AVG(vq.lead_time_days)::numeric AS avg_lead, COUNT(*)::int AS n_quotes
        FROM v_latest_vendor_quote vq
        WHERE vq.lead_time_days IS NOT NULL
          AND vq.submitted_at >= NOW() - ($1 || ' months')::interval
{_ub("vq.submitted_at")}        GROUP BY vq.vendor_id
        """,
        *_args,
    )

    # price: avg(unit_price / per-item-min unit_price) over latest-round quote lines.
    # The per-item min is computed across all vendors quoting THAT item (same item =
    # same currency, so no cross-currency mixing). ratio>=1; 1.0 ⇒ cheapest. Windowed
    # on the quote's submitted_at so the per-item min cohort is from the SAME period.
    price_rows = await conn.fetch(
        f"""
        WITH latest AS (
            SELECT quote_id, vendor_id FROM v_latest_vendor_quote
            WHERE submitted_at >= NOW() - ($1 || ' months')::interval
{_ub("submitted_at")}        ),
        lines AS (
            SELECT l.vendor_id, vqi.item_id, vqi.unit_price
            FROM vendor_quote_items vqi
            JOIN latest l ON l.quote_id = vqi.quote_id
            WHERE vqi.unit_price IS NOT NULL AND vqi.unit_price > 0
              AND vqi.can_do IS NOT FALSE AND vqi.free_charge IS NOT TRUE
        ),
        item_min AS (
            SELECT item_id, MIN(unit_price) AS min_price FROM lines GROUP BY item_id
        )
        SELECT ln.vendor_id,
               AVG(ln.unit_price / NULLIF(im.min_price, 0))::numeric AS avg_ratio,
               COUNT(*)::int AS n_lines
        FROM lines ln
        JOIN item_min im ON im.item_id = ln.item_id
        GROUP BY ln.vendor_id
        """,
        *_args,
    )

    po_map = {r["vendor_id"]: r for r in po_rows}
    qual_map = {r["vendor_id"]: r for r in qual_rows}
    lead_map = {r["vendor_id"]: r for r in lead_rows}
    price_map = {r["vendor_id"]: r for r in price_rows}

    # lead_score needs a cohort min-max across vendors that HAVE a lead value.
    lead_vals = [
        _f(r["avg_lead"]) for r in lead_rows if _f(r["avg_lead"]) is not None
    ]
    lead_min = min(lead_vals) if lead_vals else None
    lead_max = max(lead_vals) if lead_vals else None

    out: dict[int, dict[str, Any]] = {}
    for b in base_rows:
        vid = b["vendor_id"]
        invited = b["invited_batches"] or 0
        submitted = b["submitted_batches"] or 0
        won = b["won_batches"] or 0

        # response: submitted / invited
        response_score = (submitted / invited) if invited else None

        # win: distinct won batches / submitted batches
        win_score = (won / submitted) if submitted else None

        # on_time: on_time_pos / rated_pos
        po = po_map.get(vid)
        rated_pos = (po["rated_pos"] if po else 0) or 0
        on_time_pos = (po["on_time_pos"] if po else 0) or 0
        on_time_score = (on_time_pos / rated_pos) if rated_pos else None

        # quality: ok_items / rated_items
        ql = qual_map.get(vid)
        rated_items = (ql["rated_items"] if ql else 0) or 0
        ok_items = (ql["ok_items"] if ql else 0) or 0
        quality_score = (ok_items / rated_items) if rated_items else None

        # lead: min-max across cohort (lower lead ⇒ higher score). Single-member
        # cohort (min == max) ⇒ neutral 1.0 (best available, no spread to punish).
        ld = lead_map.get(vid)
        avg_lead = _f(ld["avg_lead"]) if ld else None
        if avg_lead is None or lead_min is None or lead_max is None:
            lead_score = None
        elif lead_max == lead_min:
            lead_score = 1.0
        else:
            lead_score = _clamp01((lead_max - avg_lead) / (lead_max - lead_min))

        # price: clamp(2 - avg_ratio, 0, 1). ratio 1.0 ⇒ 1.0; ratio>=2 ⇒ 0.
        pr = price_map.get(vid)
        avg_ratio = _f(pr["avg_ratio"]) if pr else None
        price_score = _clamp01(2.0 - avg_ratio) if avg_ratio is not None else None

        factors = {
            "response": response_score,
            "win": win_score,
            "on_time": on_time_score,
            "quality": quality_score,
            "lead": lead_score,
            "price": price_score,
        }
        sufficient = invited >= int(min_invites) and submitted > 0

        out[vid] = {
            "vendor_id": vid,
            "company_name": b["company_name"],
            "account_status": str(b["account_status"]) if b["account_status"] is not None else None,
            "factors": factors,
            "sufficient": sufficient,
            "raw": {
                "invited_batches": invited,
                "submitted_batches": submitted,
                "won_batches": won,
                "rated_pos": rated_pos,
                "on_time_pos": on_time_pos,
                "rated_quality_items": rated_items,
                "ok_quality_items": ok_items,
                "avg_lead_days": avg_lead,
                "lead_quotes_n": (ld["n_quotes"] if ld else 0) or 0,
                "avg_price_ratio": avg_ratio,
                "price_lines_n": (pr["n_lines"] if pr else 0) or 0,
            },
        }
    return out


def _score_from_factors(factors: dict[str, float | None]) -> tuple[float | None, dict[str, float]]:
    """Weighted 0..100 score over PRESENT factors only (weights renormalised).

    Returns (score_100 | None, applied_weights). Missing factors are excluded and
    the remaining weights are renormalised to sum to 1 — a sparse vendor is never
    punished to 0 for absent data. If NO factor is present ⇒ (None, {}).
    """
    present = {k: v for k, v in factors.items() if v is not None}
    if not present:
        return None, {}
    w_present = {k: _SCORE_WEIGHTS[k] for k in present}
    w_sum = sum(w_present.values())
    if w_sum <= 0:
        return None, {}
    applied = {k: w / w_sum for k, w in w_present.items()}
    score01 = sum(present[k] * applied[k] for k in present)
    return round(_clamp01(score01) * 100.0, 1), {k: round(v, 4) for k, v in applied.items()}


def _ranks_from_factors(factors_by_vendor: dict[int, dict[str, Any]]) -> dict[int, int]:
    """{vendor_id: rank} for SUFFICIENT+SCORED vendors over one window.

    Mirrors the live list ranking EXACTLY: only vendors with sufficient data AND a
    non-null score are ranked; ordering is score DESC then vendor_name (lower) as the
    deterministic tie-break — the SAME key the endpoint sorts the visible rows by.
    Ranks are competition-style `RANK()`: equal (score, name) share a rank and the
    next rank skips (1,2,2,4…). Unscored / insufficient vendors are absent ⇒ caller
    treats a missing vendor as null. Pure/sync (no I/O) so it is trivially reusable
    for both the current and the prior (shifted) window.
    """
    scored: list[tuple[int, float, str]] = []
    for vid, v in factors_by_vendor.items():
        if not v.get("sufficient"):
            continue
        score, _ = _score_from_factors(v["factors"])
        if score is None:
            continue
        scored.append((vid, score, (v.get("company_name") or "").lower()))
    # Same ordering as the endpoint's row sort (score DESC, name ASC).
    scored.sort(key=lambda t: (-t[1], t[2]))
    ranks: dict[int, int] = {}
    prev_key: tuple[float, str] | None = None
    prev_rank = 0
    for i, (vid, score, name) in enumerate(scored, start=1):
        key = (score, name)
        if key == prev_key:          # tie ⇒ same rank as the previous vendor
            ranks[vid] = prev_rank
        else:
            ranks[vid] = i
            prev_key, prev_rank = key, i
    return ranks


async def _compute_prev_ranks(
    conn: asyncpg.Connection, months: int, min_invites: int,
) -> dict[int, int]:
    """{vendor_id: rank} over the immediately-PRECEDING window of the SAME length —
    current = [now-months, now]; prior = [now-2*months, now-months]. Re-runs the
    IDENTICAL scoring aggregation with the window shifted back by `months`
    (offset_months=months) and ranks it with the SAME ordering/tie-break as the
    live list (_ranks_from_factors). A vendor absent from the prior window is
    simply absent from the returned dict ⇒ caller treats it as null (no prior rank).

    SHARED by both `vendor_scorecard` (list) and `vendor_scorecard_detail` (single
    vendor) so the two surfaces can never disagree on a vendor's Δ hạng.

    FULLY GUARDED: any failure in the prior-window path degrades to {} (prev_rank
    null for every vendor) rather than failing the caller's already-computed
    live scorecard.
    """
    try:
        prior_factors = await _scorecard_factors(
            conn, months, min_invites, offset_months=months,
        )
        return _ranks_from_factors(prior_factors)
    except Exception:  # noqa: BLE001 — never let prev_rank break the endpoint
        logger.warning("scorecard: prev_rank computation failed; degrading to null", exc_info=True)
        return {}


# ===========================================================================
# GET /vendor-scorecard — ranked scorecard of all vendors
# ===========================================================================

@router.get("/vendor-scorecard")
async def vendor_scorecard(
    months: int = Query(12, ge=1, le=36),
    min_invites: int = Query(3, ge=1, le=50),
    token_data: TokenData = Depends(require_role(*_READ_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Bảng xếp hạng NCC — score_100 + grade(A/B/C) + sub-scores từng yếu tố.

    Trọng số: response 0.15, win 0.15, on_time 0.25, quality 0.15, lead 0.10,
    price 0.20. Renormalise trên các yếu tố CÓ dữ liệu. NCC thiếu dữ liệu
    (invited < min_invites HOẶC submitted_batches = 0) ⇒ score null, grade '–'
    (Chưa đủ dữ liệu) — KHÔNG bị ép về 0.
    """
    factors_by_vendor = await _scorecard_factors(conn, months, min_invites)

    # prev_rank (ADDITIVE) — see _compute_prev_ranks docstring. LEFT-JOINed onto the
    # current rows by vendor_id below; a vendor absent from the prior window ⇒ null.
    prev_ranks = await _compute_prev_ranks(conn, months, min_invites)

    # Build FLAT per-vendor rows in the FE VendorRow shape. The FE table reads each
    # field directly: vendor_name, score (0..100|null), grade ('A'|'B'|'C'|null),
    # response_rate/win_rate/on_time_rate (0..100), avg_lead_days, price_score (0..100),
    # insufficient, prev_rank (int|null — rank in the prior window, for Δ movement).
    # Factors (0..1 internally) are scaled to 0..100 for display rates.
    rows: list[dict[str, Any]] = []
    for vid, v in factors_by_vendor.items():
        if v["sufficient"]:
            score, _applied = _score_from_factors(v["factors"])
        else:
            score = None
        f = v["factors"]
        g = _grade(score)
        rows.append({
            "vendor_id": vid,
            "vendor_name": v["company_name"],
            "score": score,
            "grade": g if g in ("A", "B", "C") else None,
            "response_rate": (f["response"] * 100.0) if f["response"] is not None else None,
            "win_rate": (f["win"] * 100.0) if f["win"] is not None else None,
            "on_time_rate": (f["on_time"] * 100.0) if f["on_time"] is not None else None,
            "avg_lead_days": v["raw"].get("avg_lead_days"),
            "price_score": (f["price"] * 100.0) if f["price"] is not None else None,
            "insufficient": not v["sufficient"],
            "prev_rank": prev_ranks.get(vid),  # int | None (None ⇒ FE shows "—")
        })

    # Rank: scored vendors by score DESC; insufficient (null) sink to the bottom,
    # ordered by vendor_name for stable display.
    rows.sort(
        key=lambda r: (
            0 if r["score"] is not None else 1,
            -(r["score"] or 0.0),
            (r["vendor_name"] or "").lower(),
        )
    )
    scored_count = sum(1 for r in rows if r["score"] is not None)

    # FE expects `data` to be the VendorRow[] array directly + a sibling `months`.
    return {
        "months": months,
        "min_invites": min_invites,
        "scored_count": scored_count,
        "total_count": len(rows),
        "data": rows,
    }


# ===========================================================================
# GET /vendor-scorecard/{vendor_id} — single-vendor detail
# ===========================================================================

@router.get("/vendor-scorecard/{vendor_id}")
async def vendor_scorecard_detail(
    vendor_id: int,
    months: int = Query(12, ge=1, le=36),
    min_invites: int = Query(3, ge=1, le=50),
    token_data: TokenData = Depends(require_role(*_READ_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Chi tiết scorecard 1 NCC — cùng yếu tố + số liệu thô (n=) + award gần đây."""
    exists = await conn.fetchval("SELECT 1 FROM vendor_accounts WHERE id = $1", vendor_id)
    if not exists:
        raise HTTPException(404, "Nhà cung cấp không tồn tại")

    factors_by_vendor = await _scorecard_factors(conn, months, min_invites)
    v = factors_by_vendor.get(vendor_id)
    if v is None:  # account exists but produced no row (shouldn't happen) — neutral.
        v = {
            "vendor_id": vendor_id, "company_name": None, "account_status": None,
            "factors": {k: None for k in _FACTOR_KEYS}, "sufficient": False,
            "raw": {},
        }

    # rank / prev_rank (ADDITIVE, W3-05 close-out): mirrors the list endpoint EXACTLY
    # (same _ranks_from_factors ordering/tie-break, same _compute_prev_ranks window
    # shift) so the "Δ hạng" mini-stat in the detail drawer never disagrees with the
    # list row it was opened from. Both null when the vendor is unscored/unranked
    # (insufficient data or absent from the window) — FE already degrades to "—".
    rank = _ranks_from_factors(factors_by_vendor).get(vendor_id)
    prev_rank = (await _compute_prev_ranks(conn, months, min_invites)).get(vendor_id)

    if v["sufficient"]:
        score, applied = _score_from_factors(v["factors"])
    else:
        score, applied = None, {}

    g = _grade(score)
    f = v["factors"]
    raw = v["raw"]
    # Build the FE ScoreFactor[] shape. FE factor keys: response, win, on_time,
    # price, lead_time (internal 'lead'), quality. `score` is 0..100 (internal 0..1
    # ×100); `raw` is the human display value; `n` the sample size; `weight` the
    # renormalised weight (0..1) actually applied (0/absent for missing factors).
    def _factor(fe_key: str, internal_key: str, raw_val: Any, n_val: Any) -> dict[str, Any]:
        sub = f.get(internal_key)
        return {
            "key": fe_key,
            "score": (round(sub * 100.0, 1) if sub is not None else None),
            "raw": raw_val,
            "n": n_val,
            "weight": applied.get(internal_key),
        }

    factors_list = [
        _factor("response", "response",
                (f["response"] * 100.0) if f["response"] is not None else None,
                raw.get("invited_batches")),
        _factor("win", "win",
                (f["win"] * 100.0) if f["win"] is not None else None,
                raw.get("submitted_batches")),
        _factor("on_time", "on_time",
                (f["on_time"] * 100.0) if f["on_time"] is not None else None,
                raw.get("rated_pos")),
        _factor("price", "price",
                (f["price"] * 100.0) if f["price"] is not None else None,
                raw.get("price_lines_n")),
        _factor("lead_time", "lead",
                raw.get("avg_lead_days"),
                raw.get("lead_quotes_n")),
        _factor("quality", "quality",
                (f["quality"] * 100.0) if f["quality"] is not None else None,
                raw.get("rated_quality_items")),
    ]

    # Recent ACTIVE awards (per-currency rows, never summed across currencies).
    recent_awards = await conn.fetch(
        """
        SELECT a.id AS award_id, a.batch_id, b.batch_code, b.title AS batch_title,
               a.item_id, i.bqms_code, i.specification,
               a.awarded_price, a.currency, a.quantity, a.awarded_at
        FROM procurement_awards a
        JOIN procurement_rfq_batches b ON b.id = a.batch_id
        LEFT JOIN procurement_rfq_items i ON i.id = a.item_id
        WHERE a.vendor_id = $1 AND a.superseded_by IS NULL
        ORDER BY a.awarded_at DESC
        LIMIT 20
        """,
        vendor_id,
    )

    # FE VendorDetail: vendor_name, score, grade('A'|'B'|'C'|null), insufficient,
    # factors[] (FE ScoreFactor shape), recent_awards[] (batch_code/title/bqms_code/
    # awarded_price/currency/quantity/awarded_at).
    return {
        "data": {
            "vendor_id": vendor_id,
            "vendor_name": v["company_name"],
            "score": score,
            "grade": g if g in ("A", "B", "C") else None,
            "insufficient": not v["sufficient"],
            "rank": rank,            # int | None — current-window rank (list ordering)
            "prev_rank": prev_rank,  # int | None — prior-window rank, for Δ hạng
            "factors": factors_list,
            "recent_awards": [
                {
                    "award_id": r["award_id"],
                    "batch_code": r["batch_code"],
                    "batch_title": r["batch_title"],
                    "bqms_code": r["bqms_code"],
                    "awarded_price": _f(r["awarded_price"]),
                    "currency": r["currency"],
                    "quantity": _f(r["quantity"]),
                    "awarded_at": r["awarded_at"],
                }
                for r in recent_awards
            ],
        }
    }


# ===========================================================================
# GET /vendor-scorecard/{vendor_id}/profile — Tab1 "Hồ sơ DN" (Đợt 10 #14)
# ===========================================================================
# LIGHT, single-query lookup of the vendor's company profile. SEPARATE from
# vendor_scorecard_detail (which runs the expensive _scorecard_factors engine)
# so Tab1 stays a sub-millisecond read. ADMIN-side: admin IS the buyer. NEVER
# selects target_price / notes_internal (vendor-confidential columns live on
# OTHER tables anyway; the explicit column list here is the guarantee).

@router.get("/vendor-scorecard/{vendor_id}/profile")
async def vendor_profile(
    vendor_id: int,
    token_data: TokenData = Depends(require_role(*_READ_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Tab1 — hồ sơ doanh nghiệp 1 NCC (1 query nhẹ, KHÔNG gọi scorecard engine)."""
    row = await conn.fetchrow(
        """
        SELECT va.id, va.company_name, va.contact_name, va.phone, va.address,
               va.tax_code, va.product_categories,
               va.status AS account_status, va.is_approved, va.approved_at,
               va.last_login_at, va.created_at, u.email
        FROM vendor_accounts va
        JOIN users u ON u.id = va.user_id
        WHERE va.id = $1
        """,
        vendor_id,
    )
    if row is None:
        raise HTTPException(404, "Nhà cung cấp không tồn tại")

    cats = row["product_categories"]
    return {
        "data": {
            "vendor_id": row["id"],
            "company_name": row["company_name"],
            "contact_name": row["contact_name"],
            "email": row["email"],
            "phone": row["phone"],
            "address": row["address"],
            "tax_code": row["tax_code"],
            # TEXT[] kept as a JSON array (FE renders slate chips); never SUM/flatten.
            "product_categories": list(cats) if cats else [],
            "account_status": str(row["account_status"]) if row["account_status"] is not None else None,
            "is_approved": row["is_approved"],
            "approved_at": row["approved_at"],
            "last_login_at": row["last_login_at"],
            "created_at": row["created_at"],
        }
    }


# ===========================================================================
# GET /vendor-scorecard/{vendor_id}/timeline — Tab3 "Lịch sử" (Đợt 10 #14)
# ===========================================================================
# FOUR INDEPENDENT paginated streams (batches / contracts / pos / deliveries).
# Pagination is PER-KIND (own limit/offset + total_count) — NEVER a UNION, so a
# busy contract history can't starve the delivery list. PER-CURRENCY: every
# money value carries its own `currency`; we NEVER SUM across currencies. ADMIN-
# side (admin = buyer ⇒ may see won/award). EVERY award sub-query filters
# `superseded_by IS NULL` (re-award chain ⇒ otherwise win double-counts).

@router.get("/vendor-scorecard/{vendor_id}/timeline")
async def vendor_timeline(
    vendor_id: int,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    kind: str = Query("all"),
    token_data: TokenData = Depends(require_role(*_READ_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Tab3 — lịch sử 1 NCC: 4 mảng RIÊNG (phiên/hợp đồng/PO/giao hàng), mỗi mảng
    pagination độc lập (KHÔNG UNION). PER-CURRENCY. `kind` ∈ all|batches|
    contracts|pos|deliveries (lazy-load từng tab phụ). KHÔNG gọi scorecard engine."""
    exists = await conn.fetchval("SELECT 1 FROM vendor_accounts WHERE id = $1", vendor_id)
    if not exists:
        raise HTTPException(404, "Nhà cung cấp không tồn tại")

    want = lambda k: kind in ("all", k)  # noqa: E731 — tiny local predicate
    batches: list[dict[str, Any]] = []
    contracts: list[dict[str, Any]] = []
    pos: list[dict[str, Any]] = []
    deliveries: list[dict[str, Any]] = []
    counts = {"batches": 0, "contracts": 0, "pos": 0, "deliveries": 0}

    # (1) PHIÊN — latest-round invitation per (batch,vendor) LEFT JOIN its latest
    # quote (v_latest_vendor_quote). won = EXISTS an ACTIVE award to this vendor
    # in that batch. Per-currency: quote_currency is carried, never summed.
    if want("batches"):
        counts["batches"] = await conn.fetchval(
            """
            SELECT COUNT(*) FROM (
                SELECT DISTINCT ON (inv.batch_id) inv.batch_id
                FROM procurement_rfq_invitations inv
                WHERE inv.vendor_id = $1
                ORDER BY inv.batch_id, inv.round_number DESC
            ) t
            """,
            vendor_id,
        ) or 0
        brows = await conn.fetch(
            """
            WITH inv AS (
                SELECT DISTINCT ON (i.batch_id)
                       i.batch_id, i.vendor_id, i.round_number, i.status,
                       i.invited_at, i.viewed_at
                FROM procurement_rfq_invitations i
                WHERE i.vendor_id = $1
                ORDER BY i.batch_id, i.round_number DESC
            )
            SELECT inv.batch_id, b.batch_code, b.title AS batch_title,
                   inv.invited_at, inv.viewed_at, inv.status AS quote_status,
                   inv.round_number,
                   q.total_amount AS quote_total, q.currency AS quote_currency,
                   EXISTS (
                       SELECT 1 FROM procurement_awards a
                       WHERE a.batch_id = inv.batch_id AND a.vendor_id = inv.vendor_id
                         AND a.superseded_by IS NULL
                   ) AS won
            FROM inv
            JOIN procurement_rfq_batches b ON b.id = inv.batch_id
            LEFT JOIN v_latest_vendor_quote q
                   ON q.batch_id = inv.batch_id AND q.vendor_id = inv.vendor_id
            ORDER BY inv.invited_at DESC NULLS LAST, inv.batch_id DESC
            LIMIT $2 OFFSET $3
            """,
            vendor_id, limit, offset,
        )
        batches = [
            {
                "kind": "batch",
                "batch_id": r["batch_id"],
                "batch_code": r["batch_code"],
                "batch_title": r["batch_title"],
                "invited_at": r["invited_at"],
                "viewed_at": r["viewed_at"],
                "quote_status": r["quote_status"],
                "round_number": r["round_number"],
                "quote_total": _f(r["quote_total"]),
                "quote_currency": r["quote_currency"],
                "won": bool(r["won"]),
            }
            for r in brows
        ]

    # (2) HỢP ĐỒNG — procurement_contracts WHERE vendor_id. Per-currency total.
    if want("contracts"):
        counts["contracts"] = await conn.fetchval(
            "SELECT COUNT(*) FROM procurement_contracts WHERE vendor_id = $1", vendor_id,
        ) or 0
        crows = await conn.fetch(
            """
            SELECT c.id, c.contract_no, c.batch_id, b.batch_code,
                   c.total_amount, c.currency, c.status,
                   c.contract_date, c.signed_at, c.created_at
            FROM procurement_contracts c
            LEFT JOIN procurement_rfq_batches b ON b.id = c.batch_id
            WHERE c.vendor_id = $1
            ORDER BY COALESCE(c.contract_date, c.created_at::date) DESC, c.id DESC
            LIMIT $2 OFFSET $3
            """,
            vendor_id, limit, offset,
        )
        contracts = [
            {
                "kind": "contract",
                "contract_id": r["id"],
                "contract_no": r["contract_no"],
                "batch_id": r["batch_id"],
                "batch_code": r["batch_code"],
                "total_amount": _f(r["total_amount"]),
                "currency": r["currency"],
                "status": r["status"],
                "contract_date": r["contract_date"],
                "signed_at": r["signed_at"],
                "created_at": r["created_at"],
            }
            for r in crows
        ]

    # (3) PO — procurement_pos WHERE vendor_id. on_time = actual <= requested
    # (NULL when either date missing). Per-currency total.
    if want("pos"):
        counts["pos"] = await conn.fetchval(
            "SELECT COUNT(*) FROM procurement_pos WHERE vendor_id = $1", vendor_id,
        ) or 0
        prows = await conn.fetch(
            """
            SELECT p.id, p.po_no, p.batch_id, b.batch_code,
                   p.total_amount, p.currency, p.status,
                   p.po_date, p.requested_delivery_date, p.actual_delivery_date,
                   CASE
                       WHEN p.actual_delivery_date IS NULL
                            OR p.requested_delivery_date IS NULL THEN NULL
                       ELSE (p.actual_delivery_date <= p.requested_delivery_date)
                   END AS on_time
            FROM procurement_pos p
            LEFT JOIN procurement_rfq_batches b ON b.id = p.batch_id
            WHERE p.vendor_id = $1
            ORDER BY p.po_date DESC NULLS LAST, p.id DESC
            LIMIT $2 OFFSET $3
            """,
            vendor_id, limit, offset,
        )
        pos = [
            {
                "kind": "po",
                "po_id": r["id"],
                "po_no": r["po_no"],
                "batch_id": r["batch_id"],
                "batch_code": r["batch_code"],
                "total_amount": _f(r["total_amount"]),
                "currency": r["currency"],
                "status": r["status"],
                "po_date": r["po_date"],
                "requested_delivery_date": r["requested_delivery_date"],
                "actual_delivery_date": r["actual_delivery_date"],
                "on_time": (None if r["on_time"] is None else bool(r["on_time"])),
            }
            for r in prows
        ]

    # (4) GIAO HÀNG — procurement_deliveries WHERE vendor_id (+ PO no for ctx).
    if want("deliveries"):
        counts["deliveries"] = await conn.fetchval(
            "SELECT COUNT(*) FROM procurement_deliveries WHERE vendor_id = $1", vendor_id,
        ) or 0
        drows = await conn.fetch(
            """
            SELECT d.id, d.delivery_no, d.po_id, p.po_no, d.status,
                   d.delivery_method, d.tracking_no,
                   d.delivered_at, d.received_at, d.created_at
            FROM procurement_deliveries d
            LEFT JOIN procurement_pos p ON p.id = d.po_id
            WHERE d.vendor_id = $1
            ORDER BY COALESCE(d.delivered_at, d.created_at) DESC, d.id DESC
            LIMIT $2 OFFSET $3
            """,
            vendor_id, limit, offset,
        )
        deliveries = [
            {
                "kind": "delivery",
                "delivery_id": r["id"],
                "delivery_no": r["delivery_no"],
                "po_id": r["po_id"],
                "po_no": r["po_no"],
                "status": r["status"],
                "delivery_method": r["delivery_method"],
                "tracking_no": r["tracking_no"],
                "delivered_at": r["delivered_at"],
                "received_at": r["received_at"],
                "created_at": r["created_at"],
            }
            for r in drows
        ]

    return {
        "data": {
            "batches": batches,
            "contracts": contracts,
            "pos": pos,
            "deliveries": deliveries,
        },
        "counts": counts,
    }


# ===========================================================================
# GET /items/history — popover "Lịch sử mã hàng" (Đợt 10 #14)
# ===========================================================================
# For ONE item (by item_code OR bqms_code): which vendors EVER quoted it, and
# who WON it. CROSS-batch (same code reused across RFQs). NEVER returns
# target_price (explicit confidentiality guard — this payload could be reused on
# the vendor portal someday). PER-CURRENCY. Every award filters superseded_by
# IS NULL.

@router.get("/items/history")
async def item_history(
    item_code: str | None = Query(None),
    bqms_code: str | None = Query(None),
    token_data: TokenData = Depends(require_role(*_READ_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Lịch sử 1 mã hàng (cross-batch): AI ĐÃ BÁO GIÁ + AI TRÚNG. Cần ≥1 mã.
    KHÔNG trả target_price (cấm lộ — phòng reuse cổng NCC). PER-CURRENCY."""
    item_code = (item_code or "").strip() or None
    bqms_code = (bqms_code or "").strip() or None
    if not (item_code or bqms_code):
        raise HTTPException(422, "Cần ít nhất item_code hoặc bqms_code")

    # (a) AI TỪNG BÁO GIÁ — every vendor's latest-round line for this item, across
    # ALL batches that carry the code. Join the rfq item → latest quote (view) →
    # its line → vendor. unit_price + per-line currency only (no target_price).
    quotes = await conn.fetch(
        """
        SELECT va.id AS vendor_id, va.company_name,
               i.batch_id, b.batch_code,
               vqi.unit_price, q.currency, vqi.lead_time_days,
               q.submitted_at, vqi.quantity
        FROM procurement_rfq_items i
        JOIN procurement_rfq_batches b ON b.id = i.batch_id
        JOIN v_latest_vendor_quote q ON q.batch_id = i.batch_id
        JOIN vendor_quote_items vqi ON vqi.quote_id = q.quote_id AND vqi.item_id = i.id
        JOIN vendor_accounts va ON va.id = q.vendor_id
        WHERE ( (i.item_code = $1 AND $1 IS NOT NULL)
             OR (i.bqms_code = $2 AND $2 IS NOT NULL) )
          AND (i.item_code IS NOT NULL OR i.bqms_code IS NOT NULL)
          AND vqi.unit_price IS NOT NULL
        ORDER BY q.submitted_at DESC NULLS LAST, vqi.unit_price ASC
        LIMIT 100
        """,
        item_code, bqms_code,
    )

    # (b) AI TRÚNG — ACTIVE awards (superseded_by IS NULL) for items carrying the
    # code. Per-currency awarded_price; no target_price.
    awards = await conn.fetch(
        """
        SELECT va.id AS vendor_id, va.company_name,
               a.batch_id, b.batch_code,
               a.awarded_price, a.currency, a.quantity, a.awarded_at
        FROM procurement_awards a
        JOIN procurement_rfq_items i ON i.id = a.item_id
        JOIN procurement_rfq_batches b ON b.id = a.batch_id
        JOIN vendor_accounts va ON va.id = a.vendor_id
        WHERE a.superseded_by IS NULL
          AND ( (i.item_code = $1 AND $1 IS NOT NULL)
             OR (i.bqms_code = $2 AND $2 IS NOT NULL) )
          AND (i.item_code IS NOT NULL OR i.bqms_code IS NOT NULL)
        ORDER BY a.awarded_at DESC NULLS LAST
        LIMIT 100
        """,
        item_code, bqms_code,
    )

    return {
        "data": {
            "item_code": item_code,
            "bqms_code": bqms_code,
            "quotes": [
                {
                    "vendor_id": r["vendor_id"],
                    "company_name": r["company_name"],
                    "batch_id": r["batch_id"],
                    "batch_code": r["batch_code"],
                    "unit_price": _f(r["unit_price"]),
                    "currency": r["currency"],
                    "lead_time_days": r["lead_time_days"],
                    "quantity": _f(r["quantity"]),
                    "submitted_at": r["submitted_at"],
                }
                for r in quotes
            ],
            "awards": [
                {
                    "vendor_id": r["vendor_id"],
                    "company_name": r["company_name"],
                    "batch_id": r["batch_id"],
                    "batch_code": r["batch_code"],
                    "awarded_price": _f(r["awarded_price"]),
                    "currency": r["currency"],
                    "quantity": _f(r["quantity"]),
                    "awarded_at": r["awarded_at"],
                }
                for r in awards
            ],
        }
    }


# ===========================================================================
# GET /batches/{batch_id}/smart-award — deterministic ranking (NO write)
# ===========================================================================

@router.get("/batches/{batch_id}/smart-award")
async def smart_award(
    batch_id: int,
    w_price: float = Query(0.5, ge=0.0, le=1.0),
    w_lead: float = Query(0.2, ge=0.0, le=1.0),
    w_score: float = Query(0.3, ge=0.0, le=1.0),
    item_id: int | None = Query(None, description="Chỉ xếp hạng 1 item (per_item)"),
    token_data: TokenData = Depends(require_role(*_READ_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Gợi ý xếp hạng NCC trúng thầu — DETERMINISTIC, KHÔNG GHI, KHÔNG award.

    Xếp hạng TRONG TỪNG NHÓM LOẠI TIỀN (per-currency; cờ mixed_currency nếu batch
    có nhiều loại). Mỗi NCC:
      price_score = giá thấp nhất nhóm / giá NCC này  (1.0 = rẻ nhất)
      lead_score  = lead nhỏ nhất nhóm / lead NCC này (1.0 = nhanh nhất)
      score_factor= scorecard/100 (thiếu ⇒ trung tính 0.5)
      final       = (w_price·price + w_lead·lead + w_score·score) / Σw
    Hoà ⇒ ưu tiên giá thấp hơn, rồi lead ngắn hơn (tie-break tất định).
    why = tiếng Việt.
    """
    batch = await conn.fetchrow(
        "SELECT id, batch_code, title, status, award_mode, "
        "sealed_until_deadline, bid_deadline FROM procurement_rfq_batches WHERE id = $1",
        batch_id,
    )
    if not batch:
        raise HTTPException(404, "Đợt báo giá không tồn tại")

    # Đợt 2b [SB] — anti-leak: smart-award trả giá + xếp hạng từng NCC. Khi phiên
    # NIÊM PHONG giá VÀ chưa tới hạn → chặn (kể cả admin gọi thẳng API, không chỉ
    # ẩn nút FE). Inline check để tránh import chéo _sealed_active (circular).
    if batch["sealed_until_deadline"] and (
        batch["bid_deadline"] is None
        or datetime.now(timezone.utc) < batch["bid_deadline"]
    ):
        raise HTTPException(
            409,
            "Phiên đang niêm phong giá tới hạn — chưa gợi ý xếp hạng được cho tới khi qua hạn.",
        )

    wsum = w_price + w_lead + w_score
    if wsum <= 0:
        raise HTTPException(400, "Tổng trọng số phải > 0")
    nw_price, nw_lead, nw_score = w_price / wsum, w_lead / wsum, w_score / wsum

    # Scorecard (0..100) for the score_factor; missing ⇒ neutral 0.5 below.
    scorecards = await _scorecard_factors(conn, 12, 1)
    score_of = {
        vid: _score_from_factors(v["factors"])[0]
        for vid, v in scorecards.items()
    }

    award_mode = batch["award_mode"]

    # Pull latest-round submitted quote lines for this batch, per vendor + item.
    # currency comes from the vendor's quote (per-line currency == quote currency).
    line_rows = await conn.fetch(
        """
        SELECT lq.vendor_id, va.company_name, lq.currency,
               vqi.item_id, i.item_no, i.specification, i.bqms_code,
               vqi.unit_price, vqi.lead_time_days AS line_lead, lq.lead_time_days AS quote_lead
        FROM v_latest_vendor_quote lq
        JOIN vendor_accounts va ON va.id = lq.vendor_id
        JOIN vendor_quote_items vqi ON vqi.quote_id = lq.quote_id
        JOIN procurement_rfq_items i ON i.id = vqi.item_id
        WHERE lq.batch_id = $1
          AND vqi.unit_price IS NOT NULL AND vqi.unit_price > 0
          AND vqi.can_do IS NOT FALSE AND vqi.free_charge IS NOT TRUE
          AND ($2::bigint IS NULL OR vqi.item_id = $2)
        ORDER BY vqi.item_id, lq.currency, vqi.unit_price
        """,
        batch_id, item_id,
    )

    currencies_present = sorted({r["currency"] for r in line_rows if r["currency"]})
    mixed_currency = len(currencies_present) > 1

    # Đợt 4 — FX normalize (ADDITIVE, HIỂN THỊ): VND-equiv as-of bid_deadline để FE
    # show "≈ x ₫" cạnh giá. RANK GIỮ NGUYÊN per-currency (KHÔNG sort theo VND —
    # tránh award sai do tỷ giá). Thiếu rate → vnd_equiv=None + fx_missing. 1 rate/
    # loại tiền (cache trong helper). Build cho mọi ccy gặp; per_batch bổ sung dưới.
    as_of = batch["bid_deadline"].date() if batch["bid_deadline"] else None
    fx_map: dict[str, Decimal | None] = {}
    # "VND" luôn có (helper short-circuit → 1) để cover line/total có currency NULL
    # mà nhóm fallback về "VND" — tránh nhầm "thiếu key" thành fx_missing.
    for ccy in [*currencies_present, "VND"]:
        if ccy not in fx_map:
            fx_map[ccy] = await fetch_fx_to_vnd(conn, ccy, as_of)

    def _rank_candidates(cands: list[dict[str, Any]], ccy: str) -> list[dict[str, Any]]:
        """Deterministic rank within ONE currency group (already same currency).

        Emits the FE SaRankedVendor shape: vendor_id, company_name, rank, score
        (composite 0..1), grade, price, currency, lead_time_days, factors (FE SaFactor
        objects {norm, raw, weight, missing}), why, insufficient.
        """
        prices = [c["unit_price"] for c in cands if c["unit_price"] is not None]
        leads = [c["lead_time_days"] for c in cands if c["lead_time_days"] is not None]
        min_price = min(prices) if prices else None
        min_lead = min(leads) if leads else None

        scored: list[dict[str, Any]] = []
        for c in cands:
            up = c["unit_price"]
            price_score = (min_price / up) if (up and min_price is not None and up > 0) else None
            ld = c["lead_time_days"]
            lead_score = (min_lead / ld) if (ld and min_lead is not None and ld > 0) else None
            sc = c["scorecard_100"]
            score_factor = (sc / 100.0) if sc is not None else 0.5  # neutral when missing

            # Final over present price/lead (+ always score_factor); renormalise the
            # weights that actually apply so a vendor missing a lead value isn't
            # penalised by a dead weight slot.
            parts: list[tuple[float, float]] = [(nw_score, score_factor)]
            if price_score is not None:
                parts.append((nw_price, price_score))
            if lead_score is not None:
                parts.append((nw_lead, lead_score))
            wtot = sum(w for w, _ in parts)
            final = (sum(w * s for w, s in parts) / wtot) if wtot > 0 else None

            why_bits: list[str] = []
            if price_score is not None:
                if price_score >= 0.999:
                    why_bits.append("giá thấp nhất nhóm")
                else:
                    why_bits.append(f"giá cao hơn mức thấp nhất {round((1/price_score - 1) * 100)}%")
            if lead_score is not None:
                if lead_score >= 0.999:
                    why_bits.append("lead-time ngắn nhất")
                else:
                    why_bits.append(f"lead-time {c['lead_time_days']} ngày")
            if sc is not None:
                why_bits.append(f"điểm năng lực {round(sc)}/100")
            else:
                why_bits.append("chưa đủ dữ liệu năng lực (trung tính)")

            # FE SaFactor objects: norm = normalized 0..1, raw = display value,
            # weight = applied weight, missing = no data for that factor.
            factors = {
                "price": {
                    "norm": round(price_score, 4) if price_score is not None else None,
                    "raw": up,
                    "weight": round(nw_price, 4),
                    "missing": price_score is None,
                },
                "lead": {
                    "norm": round(lead_score, 4) if lead_score is not None else None,
                    "raw": ld,
                    "weight": round(nw_lead, 4),
                    "missing": lead_score is None,
                },
                "scorecard": {
                    "norm": round(score_factor, 4),
                    "raw": round(sc, 1) if sc is not None else None,
                    "weight": round(nw_score, 4),
                    "missing": sc is None,
                },
            }

            # Đợt 4 — VND-equiv để FE hiển thị "≈ x ₫" cạnh price. KHÔNG dùng cho
            # rank/sort (xem note bên dưới). Thiếu rate → None + fx_missing=True.
            # VND-bid: rate=1 → vnd_equiv == price (vô hại).
            _rate = fx_map.get(ccy)
            _vnd_equiv = (up * float(_rate)) if (up is not None and _rate is not None) else None
            _fx_missing = up is not None and _rate is None
            scored.append({
                "vendor_id": c["vendor_id"],
                "company_name": c["company_name"],
                "score": round(final, 4) if final is not None else None,
                "grade": _grade(final * 100.0) if final is not None else "–",
                "price": up,
                "currency": ccy,
                # Đợt 4 — chỉ HIỂN THỊ; rank/sort KHÔNG đụng (giữ per-currency).
                "vnd_equiv": _vnd_equiv,
                "fx_missing": _fx_missing,
                "lead_time_days": ld,
                "factors": factors,
                "why": "; ".join(why_bits),
                "insufficient": final is None,
                # internal-only sort keys (popped before return).
                "_final": final,
            })

        # Sort: final DESC, then tie-break lower price, then lower lead (deterministic).
        scored.sort(
            key=lambda s: (
                -(s["_final"] if s["_final"] is not None else -1.0),
                s["price"] if s["price"] is not None else float("inf"),
                s["lead_time_days"] if s["lead_time_days"] is not None else float("inf"),
                s["vendor_id"],
            )
        )
        for idx, s in enumerate(scored, start=1):
            s["rank"] = idx
            s.pop("_final", None)
        return scored

    # FE SaCurrencyGroup[]: per_item → {currency, items:[{...,vendors[]}]};
    # per_batch → {currency, batch:[...]}.
    groups: list[dict[str, Any]] = []

    if award_mode == "per_item":
        # Group by (currency, item) → ranked vendors per item within each currency.
        by_cur_item: dict[str, dict[int, list[dict[str, Any]]]] = {}
        item_meta: dict[int, dict[str, Any]] = {}
        for r in line_rows:
            ccy = r["currency"] or "VND"
            iid = r["item_id"]
            item_meta.setdefault(iid, {
                "item_id": iid, "item_no": r["item_no"],
                "specification": r["specification"], "bqms_code": r["bqms_code"],
            })
            lead = r["line_lead"] if r["line_lead"] is not None else r["quote_lead"]
            by_cur_item.setdefault(ccy, {}).setdefault(iid, []).append({
                "vendor_id": r["vendor_id"],
                "company_name": r["company_name"],
                "unit_price": _f(r["unit_price"]),
                "lead_time_days": lead,
                "scorecard_100": score_of.get(r["vendor_id"]),
            })
        for ccy in sorted(by_cur_item.keys()):
            items_out = []
            # None-safe item ordering: item_no when present, else item_id (item_no=0
            # is a valid number and must NOT fall through to item_id).
            for iid in sorted(
                by_cur_item[ccy].keys(),
                key=lambda x: item_meta[x]["item_no"] if item_meta[x]["item_no"] is not None else x,
            ):
                items_out.append({
                    **item_meta[iid],
                    "vendors": _rank_candidates(by_cur_item[ccy][iid], ccy),
                })
            groups.append({"currency": ccy, "items": items_out})

    else:  # per_batch — collapse to one quote-total per vendor within a currency.
        by_cur_vendor: dict[str, dict[int, dict[str, Any]]] = {}
        totals = await conn.fetch(
            """
            SELECT lq.vendor_id, va.company_name, lq.currency,
                   lq.total_amount, lq.lead_time_days
            FROM v_latest_vendor_quote lq
            JOIN vendor_accounts va ON va.id = lq.vendor_id
            WHERE lq.batch_id = $1 AND lq.total_amount IS NOT NULL AND lq.total_amount > 0
            """,
            batch_id,
        )
        cur_set = sorted({r["currency"] for r in totals if r["currency"]})
        mixed_currency = mixed_currency or len(cur_set) > 1
        # Đợt 4 — per_batch lấy currency từ total_amount (có thể khác line_rows ở
        # currencies_present). Bổ sung rate cho ccy chưa có trong fx_map (gồm cả
        # fallback "VND" → helper short-circuit về 1) để _rank_candidates không
        # nhầm "thiếu key" thành fx_missing.
        for ccy in cur_set + ["VND"]:
            if ccy not in fx_map:
                fx_map[ccy] = await fetch_fx_to_vnd(conn, ccy, as_of)
        for r in totals:
            ccy = r["currency"] or "VND"
            by_cur_vendor.setdefault(ccy, {})[r["vendor_id"]] = {
                "vendor_id": r["vendor_id"],
                "company_name": r["company_name"],
                "unit_price": _f(r["total_amount"]),  # batch-total stands in for "price"
                "lead_time_days": r["lead_time_days"],
                "scorecard_100": score_of.get(r["vendor_id"]),
            }
        for ccy in sorted(by_cur_vendor.keys()):
            groups.append({
                "currency": ccy,
                "batch": _rank_candidates(list(by_cur_vendor[ccy].values()), ccy),
            })

    note = (
        "NCC báo giá ở nhiều loại tiền tệ — xếp hạng riêng từng nhóm, không quy đổi."
        if mixed_currency else None
    )

    # FE SaData shape: groups[], award_mode, weights{price,lead,scorecard},
    # mixed_currency, note. (batch_id/batch_code/currencies_present kept for context.)
    return {
        "data": {
            "batch_id": batch_id,
            "batch_code": batch["batch_code"],
            "award_mode": award_mode,
            "mixed_currency": mixed_currency,
            "currencies_present": currencies_present,
            "groups": groups,
            "weights": {
                "price": round(nw_price, 4),
                "lead": round(nw_lead, 4),
                "scorecard": round(nw_score, 4),
            },
            "note": note,
        }
    }
