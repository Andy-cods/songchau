"""Daily Report API — morning summary + revenue trend + YoY.

Matches the canonical morning report format (ảnh 24/04/2026 from Thang):
  Báo cáo DD/MM/YYYY
  - Tổng số yêu cầu: N mã (TM=x, GC=y)
  - SL báo giá được: M mã
    + báo giá ngày d: k mã (a TM - b GC)   (round 1)
    + báo giá v2: p mã (type)
    + báo giá v3: q mã (type)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, conint

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


# ─── Pydantic models ────────────────────────────────────────────────

class QuoteLogEntry(BaseModel):
    rfq_id: int
    round: conint(ge=1, le=4)
    quoted_price: float | None = None
    quoted_currency: str = "USD"
    item_type: str | None = Field(default=None, pattern=r"^(TM|GC)$")
    notes: str | None = None


# ─── Helpers ────────────────────────────────────────────────────────

async def _get_cutoff(conn: asyncpg.Connection) -> date:
    """Revenue tracking cutoff (default 2026-05-01)."""
    row = await conn.fetchval(
        "SELECT value FROM system_config WHERE key = 'revenue_tracking_start_date'"
    )
    try:
        return datetime.strptime(row, "%Y-%m-%d").date() if row else date(2026, 5, 1)
    except Exception:
        return date(2026, 5, 1)


def _format_vn_date(d: date) -> str:
    return f"{d.day}/{d.month}/{d.year}"


# ─── Endpoints ──────────────────────────────────────────────────────

@router.get("/morning")
async def morning_report(
    report_date: date | None = Query(None, description="Default today"),
    token_data: TokenData = Depends(
        require_role("staff", "manager", "admin", "accountant", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Morning summary matching the canonical text-report format."""

    today = report_date or date.today()

    # 1. Tổng số yêu cầu (RFQ received today)
    requests_row = await conn.fetchrow(
        """
        SELECT
          COUNT(DISTINCT bqms_code) AS total,
          COUNT(DISTINCT bqms_code) FILTER (WHERE item_type = 'TM') AS tm,
          COUNT(DISTINCT bqms_code) FILTER (WHERE item_type = 'GC') AS gc,
          COUNT(DISTINCT bqms_code) FILTER (WHERE item_type IS NULL) AS unclassified
        FROM bqms_rfq
        WHERE inquiry_date = $1
        """,
        today,
    )

    # 2. SL báo giá được (quote actions today, from bqms_quote_log)
    quoted_rows = await conn.fetch(
        """
        SELECT
          ql.round,
          r.inquiry_date AS rfq_inquiry_date,
          COUNT(DISTINCT ql.rfq_id) AS total,
          COUNT(DISTINCT ql.rfq_id) FILTER (WHERE COALESCE(ql.item_type, r.item_type) = 'TM') AS tm,
          COUNT(DISTINCT ql.rfq_id) FILTER (WHERE COALESCE(ql.item_type, r.item_type) = 'GC') AS gc
        FROM bqms_quote_log ql
        JOIN bqms_rfq r ON r.id = ql.rfq_id
        WHERE DATE(ql.quoted_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = $1
        GROUP BY ql.round, r.inquiry_date
        ORDER BY ql.round, r.inquiry_date DESC
        """,
        today,
    )

    # Group by round; round 1 keeps per-inquiry-date detail, round 2+ aggregated
    breakdown: list[dict[str, Any]] = []
    round1_by_date: dict[date, dict[str, int]] = {}
    round_other: dict[int, dict[str, int]] = {}

    for row in quoted_rows:
        r = row["round"]
        if r == 1 and row["rfq_inquiry_date"]:
            d = row["rfq_inquiry_date"]
            round1_by_date.setdefault(d, {"total": 0, "tm": 0, "gc": 0})
            round1_by_date[d]["total"] += row["total"]
            round1_by_date[d]["tm"] += row["tm"]
            round1_by_date[d]["gc"] += row["gc"]
        else:
            round_other.setdefault(r, {"total": 0, "tm": 0, "gc": 0})
            round_other[r]["total"] += row["total"]
            round_other[r]["tm"] += row["tm"]
            round_other[r]["gc"] += row["gc"]

    for d, v in sorted(round1_by_date.items(), key=lambda x: x[0], reverse=True):
        breakdown.append({
            "round": 1,
            "rfq_inquiry_date": d.isoformat(),
            "label": f"báo giá ngày {_format_vn_date(d)}",
            "total": v["total"], "tm": v["tm"], "gc": v["gc"],
        })
    for r in sorted(round_other.keys()):
        v = round_other[r]
        type_tag = "GC" if v["gc"] and not v["tm"] else ("TM" if v["tm"] and not v["gc"] else f"{v['tm']}TM-{v['gc']}GC")
        breakdown.append({
            "round": r,
            "rfq_inquiry_date": None,
            "label": f"báo giá v{r}",
            "total": v["total"], "tm": v["tm"], "gc": v["gc"], "type_tag": type_tag,
        })

    total_quoted = sum(x["total"] for x in breakdown)

    # 3. Text version (for 1-click copy)
    lines = [f"Báo cáo {today.day:02d}/{today.month:02d}/{today.year}"]
    lines.append(f"- Tổng số yêu cầu: {requests_row['total']} mã")
    lines.append(f"  + hàng thương mại: {requests_row['tm']} mã")
    lines.append(f"  + hàng gia công: {requests_row['gc']} mã")
    if requests_row["unclassified"]:
        lines.append(f"  (chưa phân loại: {requests_row['unclassified']} mã)")
    lines.append(f"- SL báo giá được: {total_quoted} mã")
    for b in breakdown:
        if b["round"] == 1:
            lines.append(f"  + {b['label']}: {b['total']} mã ({b['tm']}TM-{b['gc']}GC)")
        else:
            lines.append(f"  + {b['label']}: {b['total']} mã ({b.get('type_tag','')})")
    lines.append("*GC: Gia công")
    lines.append("*TM: Thương mại")
    text_version = "\n".join(lines)

    return {
        "report_date": today.isoformat(),
        "requests": {
            "total": requests_row["total"],
            "tm": requests_row["tm"],
            "gc": requests_row["gc"],
            "unclassified": requests_row["unclassified"],
        },
        "quoted_today": {
            "total": total_quoted,
            "breakdown": breakdown,
        },
        "text_version": text_version,
    }


@router.get("/revenue")
async def revenue_summary(
    report_date: date | None = Query(None),
    token_data: TokenData = Depends(
        require_role("staff", "manager", "admin", "accountant", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Revenue KPIs: today / this week / this month + YoY (solar calendar)."""

    today = report_date or date.today()
    cutoff = await _get_cutoff(conn)

    async def sum_po(d1: date, d2: date) -> dict[str, float | int]:
        row = await conn.fetchrow(
            """
            SELECT
              COALESCE(SUM(amount), 0) AS total_amount,
              COUNT(*) AS po_count
            FROM bqms_samsung_po
            WHERE po_date BETWEEN $1 AND $2
              AND po_date >= $3
            """,
            d1, d2, cutoff,
        )
        return {"amount": float(row["total_amount"] or 0), "count": row["po_count"]}

    async def sum_delivery(d1: date, d2: date) -> dict[str, float | int]:
        row = await conn.fetchrow(
            """
            SELECT
              COALESCE(SUM(total_delivered_value_vnd), 0) AS total_vnd,
              COUNT(*) AS deliveries
            FROM bqms_deliveries
            WHERE actual_delivered_at IS NOT NULL
              AND DATE(actual_delivered_at) BETWEEN $1 AND $2
              AND DATE(actual_delivered_at) >= $3
            """,
            d1, d2, cutoff,
        )
        return {"amount_vnd": float(row["total_vnd"] or 0), "count": row["deliveries"]}

    # Week = ISO Mon-Sun
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    month_start = today.replace(day=1)

    today_po = await sum_po(today, today)
    week_po = await sum_po(week_start, week_end)
    month_po = await sum_po(month_start, today)

    # YoY: same day last year + MTD last year (up to same day-of-month)
    try:
        same_day_ly = today.replace(year=today.year - 1)
    except ValueError:
        same_day_ly = today - timedelta(days=365)
    mtd_ly_start = same_day_ly.replace(day=1)

    yoy_today = await sum_po(same_day_ly, same_day_ly)
    yoy_mtd = await sum_po(mtd_ly_start, same_day_ly)

    delivery_week = await sum_delivery(week_start, week_end)
    delivery_month = await sum_delivery(month_start, today)

    def delta_pct(cur: float, prev: float) -> float | None:
        if prev <= 0:
            return None
        return round((cur - prev) / prev * 100, 1)

    return {
        "report_date": today.isoformat(),
        "cutoff": cutoff.isoformat(),
        "currency": "USD",
        "po_revenue": {
            "today": today_po,
            "week": week_po,
            "month": month_po,
            "yoy_same_day": yoy_today,
            "yoy_mtd": yoy_mtd,
            "delta_yoy_today_pct": delta_pct(today_po["amount"], yoy_today["amount"]),
            "delta_yoy_mtd_pct": delta_pct(month_po["amount"], yoy_mtd["amount"]),
        },
        "delivery_revenue": {
            "week": delivery_week,
            "month": delivery_month,
        },
    }


@router.get("/trend")
async def revenue_trend(
    period: str = Query("day", pattern="^(day|week|month)$"),
    n: int = Query(30, ge=1, le=400),
    token_data: TokenData = Depends(
        require_role("staff", "manager", "admin", "accountant", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Time-bucketed revenue + YoY overlay (365 days shifted)."""

    cutoff = await _get_cutoff(conn)
    trunc = {"day": "day", "week": "week", "month": "month"}[period]

    sql = f"""
        SELECT
          date_trunc('{trunc}', po_date)::date AS bucket,
          COALESCE(SUM(amount), 0) AS amount,
          COUNT(*) AS po_count
        FROM bqms_samsung_po
        WHERE po_date >= $1
          AND po_date >= (CURRENT_DATE - ($2 || ' {trunc}')::interval)
        GROUP BY bucket
        ORDER BY bucket
    """
    rows = await conn.fetch(sql, cutoff, n)

    # YoY series: same period shifted -365 days
    sql_ly = f"""
        SELECT
          (date_trunc('{trunc}', po_date) + INTERVAL '365 days')::date AS bucket,
          COALESCE(SUM(amount), 0) AS amount,
          COUNT(*) AS po_count
        FROM bqms_samsung_po
        WHERE po_date >= (CURRENT_DATE - INTERVAL '365 days' - ($1 || ' {trunc}')::interval)
          AND po_date <  CURRENT_DATE - INTERVAL '300 days'
        GROUP BY date_trunc('{trunc}', po_date)
        ORDER BY bucket
    """
    rows_ly = await conn.fetch(sql_ly, n)
    ly_map = {r["bucket"]: float(r["amount"]) for r in rows_ly}

    series = [
        {
            "bucket": r["bucket"].isoformat(),
            "amount": float(r["amount"]),
            "po_count": r["po_count"],
            "amount_ly": ly_map.get(r["bucket"], 0.0),
        }
        for r in rows
    ]

    return {"period": period, "n": n, "series": series}


@router.get("/top-codes")
async def top_codes_heatmap(
    days: int = Query(28, ge=7, le=90),
    limit: int = Query(20, ge=5, le=100),
    token_data: TokenData = Depends(
        require_role("staff", "manager", "admin", "accountant", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Top N codes × last M days heatmap — revenue per code per day."""

    cutoff = await _get_cutoff(conn)
    start = date.today() - timedelta(days=days - 1)
    start = max(start, cutoff)

    # Top codes by total amount in range
    top_codes = await conn.fetch(
        """
        SELECT bqms_code, COALESCE(SUM(amount),0) AS total
        FROM bqms_samsung_po
        WHERE po_date BETWEEN $1 AND CURRENT_DATE AND bqms_code IS NOT NULL
        GROUP BY bqms_code
        ORDER BY total DESC
        LIMIT $2
        """,
        start, limit,
    )
    codes = [r["bqms_code"] for r in top_codes]

    if not codes:
        return {"start": start.isoformat(), "days": days, "codes": [], "matrix": []}

    cells = await conn.fetch(
        """
        SELECT bqms_code, po_date::date AS d, COALESCE(SUM(amount),0) AS amount
        FROM bqms_samsung_po
        WHERE bqms_code = ANY($1::text[]) AND po_date BETWEEN $2 AND CURRENT_DATE
        GROUP BY bqms_code, po_date
        """,
        codes, start,
    )

    cell_map: dict[tuple[str, str], float] = {
        (c["bqms_code"], c["d"].isoformat()): float(c["amount"]) for c in cells
    }

    matrix = []
    for code in codes:
        row = {
            "bqms_code": code,
            "total": float(next(r["total"] for r in top_codes if r["bqms_code"] == code)),
            "cells": [
                {
                    "date": (start + timedelta(days=i)).isoformat(),
                    "amount": cell_map.get((code, (start + timedelta(days=i)).isoformat()), 0.0),
                }
                for i in range(days)
            ],
        }
        matrix.append(row)

    return {"start": start.isoformat(), "days": days, "codes": codes, "matrix": matrix}


@router.post("/log-quote")
async def log_quote_action(
    entry: QuoteLogEntry,
    token_data: TokenData = Depends(
        require_role("staff", "manager", "admin", "procurement")
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Log a quote submission (vòng 1/2/3/4) for audit + daily report counts."""

    # Verify RFQ exists
    rfq = await conn.fetchrow(
        "SELECT id, bqms_code, item_type FROM bqms_rfq WHERE id = $1", entry.rfq_id
    )
    if not rfq:
        raise HTTPException(status_code=404, detail=f"RFQ {entry.rfq_id} not found")

    effective_type = entry.item_type or rfq["item_type"]

    log_id = await conn.fetchval(
        """
        INSERT INTO bqms_quote_log
          (rfq_id, round, quoted_price, quoted_currency, item_type, quoted_by, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id
        """,
        entry.rfq_id, entry.round, entry.quoted_price, entry.quoted_currency,
        effective_type, token_data.user_id, entry.notes,
    )

    # Also update the corresponding price column on bqms_rfq for backwards compat
    col = f"quoted_price_bqms_v{entry.round}"
    if entry.quoted_price is not None:
        await conn.execute(
            f"UPDATE bqms_rfq SET {col} = $1, updated_at = NOW() WHERE id = $2",
            entry.quoted_price, entry.rfq_id,
        )

    # Keep item_type in sync if user specified
    if entry.item_type and not rfq["item_type"]:
        await conn.execute(
            "UPDATE bqms_rfq SET item_type = $1 WHERE id = $2",
            entry.item_type, entry.rfq_id,
        )

    return {"log_id": log_id, "status": "ok"}
