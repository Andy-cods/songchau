"""Samsung BQMS Vendor Portal — Execution > MRO > P/O Receipt scraper.

The MRO P/O Receipt list page is INLINE-RICH: the list grid contains all
fields we need (PO No, BQMS Item Code, Specification, Order Qty, Unit Price,
Vendor, Delivery Date) — no per-row drill required. This is much simpler
than the Contract Mgmt scraper.

DOM structure (from recon round 6+7, 2026-05-08):
  - URL: /bqms/mro/forward/vendor/vendorPoConfirm.do (selectLeftMenu(20))
  - Global JS variable: window.Grid (dhtmlXGridObject)
  - Column IDs (from addHeader calls):
      PO_NO, PO_SEQ, REQ_NO, REQ_SEQ, PO_CONFIRM_DT
      SP_NAME (Vendor), PURCHASER_NAME, PLANT_NAME, COMPANY_NAME
      SPECIFICATION, MANUFACTURER, MODEL_NO
      ITEM_CODE (= BQMS Code), OLD_ITEM_CODE, CIS_CODE, ITEM_CATE
      PO_QTY, BUYING_PRICE, BUYING_AMOUNT, BUYING_CURRENCY
      RECEIVER_NAME, DELIVERY_ADDRESS, REQ_DELIVERY_DATE

Per user 2026-05-08:
  - Single login per run (rate limit; eventually 30 min/run)
  - Data lands in bqms_vendor_portal_staging with module='po'
  - Manual trigger only — no auto cron yet
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

OUT_DIR = Path("/tmp/scrape_runs")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Columns to extract from the MRO P/O Receipt grid
MRO_COLUMNS = [
    "PO_NO", "PO_SEQ", "REQ_NO", "REQ_SEQ", "PO_CONFIRM_DT",
    "PO_STATUS_NAME",
    "SP_NAME", "PURCHASER_NAME", "PLANT_NAME", "COMPANY_NAME",
    "SPECIFICATION", "MANUFACTURER", "MODEL_NO",
    "ITEM_CODE", "OLD_ITEM_CODE", "CIS_CODE", "ITEM_CATE",
    "PO_QTY", "BUYING_PRICE", "BUYING_AMOUNT", "BUYING_CURRENCY",
    "RECEIVER_NAME", "DELIVERY_ADDRESS", "REQ_DELIVERY_DATE",
]


async def scrape_mro_po(
    limit: int = 0,
    save_raw_json: bool = True,
    db_pool=None,
) -> dict[str, Any]:
    """Run a single MRO P/O Receipt scrape.

    Args:
        limit: max rows to extract (0 = all visible on first page).
        save_raw_json: dump raw output to /tmp/scrape_runs/<uuid>.json.
        db_pool: asyncpg pool — when provided, INSERT staging rows.

    Returns:
        { run_id, list_count, items: [...], json_path }
    """
    from playwright.async_api import async_playwright
    from app.core.config import settings
    from app.services.bqms_credentials import get_bqms_credentials

    user, pwd = get_bqms_credentials()
    base = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"
    if not user or not pwd:
        raise RuntimeError("BQMS credentials missing in settings")

    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    items: list[dict[str, Any]] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1440, "height": 900},
            locale="en-US",
        )
        page = await context.new_page()

        # Login
        await page.goto(
            f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
            wait_until="domcontentloaded", timeout=30_000,
        )
        await page.fill("input#id", user)
        await page.fill("input#pass", pwd)
        await page.evaluate("login()")
        try:
            await page.wait_for_url(
                lambda u: "anonymous" not in u and "login" not in u.lower(),
                timeout=30_000,
            )
        except Exception:
            pass
        logger.info("MRO scraper login OK: %s", page.url)

        # Navigate to MRO P/O Receipt
        await page.evaluate("selectLeftMenu(20, 20, true)")
        await asyncio.sleep(8)
        logger.info("MRO list URL: %s", page.url)

        # Extract rows via Grid (dhtmlXGridObject) JS API
        items = await _extract_mro_rows(page, MRO_COLUMNS, limit)
        logger.info("MRO list extracted: %d rows", len(items))

        await browser.close()

    finished_at = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "run_id": run_id,
        "module": "po",
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_seconds": (finished_at - started_at).total_seconds(),
        "list_count": len(items),
        "items": items,
    }

    json_path = None
    if save_raw_json:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        json_path = OUT_DIR / f"mro_run_{run_id}.json"
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        payload["json_path"] = str(json_path)
        logger.info("MRO raw scrape saved: %s", json_path)

    if db_pool is not None:
        await _insert_staging_po(db_pool, run_id, items)

    return payload


async def _extract_mro_rows(page, columns: list[str], limit: int) -> list[dict[str, Any]]:
    """Extract MRO P/O list rows by walking the dhtmlXGridObject `Grid` API."""
    rows = await page.evaluate(
        """({ columns, limit }) => {
            const g = window.Grid;
            if (!g || typeof g.getRowsNum !== 'function') {
                return { _error: 'window.Grid not a dhtmlXGridObject' };
            }
            const total = g.getRowsNum();
            const out = [];
            // Pre-compute column indices once
            const colIdx = {};
            for (const c of columns) {
                try { colIdx[c] = g.getColIndexById(c); }
                catch (e) { colIdx[c] = -1; }
            }
            const max = limit > 0 ? Math.min(limit, total) : total;
            for (let i = 0; i < max; i++) {
                let rowId = null;
                try { rowId = g.getRowId(i); } catch (e) {}
                if (rowId === null || rowId === undefined) continue;
                const row = { _row_id: rowId, _row_idx: i };
                for (const c of columns) {
                    const idx = colIdx[c];
                    if (idx < 0) { row[c] = null; continue; }
                    try {
                        row[c] = g.cells(rowId, idx).getValue();
                    } catch (e) {
                        row[c] = null;
                    }
                }
                out.push(row);
            }
            return out;
        }""",
        {"columns": columns, "limit": limit},
    )
    if isinstance(rows, dict) and rows.get("_error"):
        logger.error("MRO grid extract error: %s", rows.get("_error"))
        return []
    return rows or []


async def _insert_staging_po(db_pool, run_id: str, items: list[dict[str, Any]]) -> int:
    """INSERT one staging row per MRO PO line. Maps the rich list columns
    onto bqms_vendor_portal_staging with module='po'."""
    if not items:
        return 0
    n = 0
    async with db_pool.acquire() as conn:
        for r in items:
            rfq_number = (r.get("REQ_NO") or "").strip() or None
            contract_no = (r.get("PO_NO") or "").strip() or None
            item_code = (r.get("ITEM_CODE") or "").strip() or None
            # MODEL_NO is often empty on MRO lines; fall back to category breadcrumb
            description = (
                (r.get("MODEL_NO") or "").strip()
                or (r.get("ITEM_CATE") or "").replace("&gt;", ">").strip()
                or None
            )
            specification = (r.get("SPECIFICATION") or "").strip() or None
            unit = None  # MRO list doesn't have a unit column inline
            qty_raw = r.get("PO_QTY")
            try:
                quantity = float(str(qty_raw).replace(",", "")) if qty_raw not in (None, "", "0") else None
            except (TypeError, ValueError):
                quantity = None
            contract_period = r.get("REQ_DELIVERY_DATE") or None

            await conn.execute(
                """
                INSERT INTO bqms_vendor_portal_staging
                    (scrape_run_id, module, rfq_number, contract_no,
                     contract_period, item_code, description, specification,
                     quantity, unit, raw_json, status)
                VALUES ($1, 'po', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'pending_review')
                """,
                run_id, rfq_number, contract_no, contract_period,
                item_code, description, specification,
                quantity, unit,
                json.dumps(r, ensure_ascii=False, default=str),
            )
            n += 1
    return n
