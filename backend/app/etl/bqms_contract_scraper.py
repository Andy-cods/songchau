"""Samsung BQMS Vendor Portal — Contract Mgmt scraper.

Scrapes the Contract Mgmt list + per-contract detail pages and stages
the result in `bqms_vendor_portal_staging` for human review BEFORE
merging into `bqms_won_quotations`.

Per user 2026-05-08:
  - Single login per run (rate limit; will be 30 min/run when stable).
  - Don't enable auto periodic yet — manual trigger only.
  - Fields needed:
      Basic Information: Request Number, Contract Period
      Item Information:  Item Code, Description, Specification,
                         Quantity, Unit
  - Save raw output to file for review before any merge.

DOM structure verified by recon round 4 (2026-05-08):
  List page: dhtmlx Grid at .gridbox
    Per row td index:
      4=Contract No, 5=Subject<a>, 6=Request Number,
      10=Contract Amount, 13=Contract Period
  Detail page: <h4>Basic information</h4> followed by .w_box.bid_info
    with rows of <label>+<div.col-10>
    Item Information at #itemGridbox td index:
      3=ItemCode, 4=Description, 5=Spec, 6=Qty, 7=Unit
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

OUT_DIR = Path("/tmp/scrape_runs")
OUT_DIR.mkdir(parents=True, exist_ok=True)


async def scrape_contracts(
    limit: int = 10,
    drill_items: bool = True,
    save_raw_json: bool = True,
    db_pool=None,
) -> dict[str, Any]:
    """Run a single Vendor Portal contract scrape.

    Args:
        limit: max contracts to drill (None or 0 = all on first page).
        drill_items: if False, only extract list-level fields (faster, no
            detail click per row).
        save_raw_json: dump raw output to /tmp/scrape_runs/<uuid>.json.
        db_pool: asyncpg pool — when provided, INSERT staging rows.

    Returns:
        { run_id, list_count, drilled_count, json_path, items: [...] }
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
            wait_until="domcontentloaded",
            timeout=30_000,
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
        logger.info("scraper login OK: %s", page.url)

        # Navigate to Contract Mgmt
        await page.evaluate("selectLeftMenu(6, 6, true)")
        await asyncio.sleep(8)
        logger.info("scraper at contract list: %s", page.url)

        # Parse list rows
        list_rows = await _extract_list_rows(page)
        logger.info("list page found %d rows", len(list_rows))

        if not drill_items:
            for r in list_rows:
                items.append({**r, "items": []})
        else:
            target = list_rows if not limit else list_rows[:limit]
            for idx, row in enumerate(target):
                try:
                    detail = await _drill_contract_detail(page, idx)
                    items.append({**row, "items": detail.get("items", []), "basic_info": detail.get("basic_info", {})})
                    # Polite delay between drills
                    await asyncio.sleep(2.5)
                except Exception as exc:
                    logger.warning("drill #%d (%s) failed: %s", idx, row.get("contract_no"), exc)
                    items.append({**row, "items": [], "error": str(exc)[:300]})

        await browser.close()

    finished_at = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "run_id": run_id,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_seconds": (finished_at - started_at).total_seconds(),
        "list_count": len(list_rows) if 'list_rows' in locals() else 0,
        "drilled_count": sum(1 for it in items if it.get("items")),
        "items": items,
    }

    json_path = None
    if save_raw_json:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        json_path = OUT_DIR / f"contract_run_{run_id}.json"
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        payload["json_path"] = str(json_path)
        logger.info("raw scrape saved: %s", json_path)

    if db_pool is not None:
        await _insert_staging(db_pool, run_id, items)

    return payload


async def _extract_list_rows(page) -> list[dict[str, Any]]:
    """Extract per-row fields from the Contract Mgmt list dhtmlx grid."""
    rows = await page.evaluate(
        """() => {
            const out = [];
            const rs = document.querySelectorAll('.gridbox .objbox table tbody tr');
            for (const tr of rs) {
                const tds = tr.querySelectorAll('td');
                if (tds.length < 14) continue;
                // Skip the header-spacer row (heights 0)
                const heightSentinel = tds[2]?.style?.height;
                if (heightSentinel === '0px') continue;
                out.push({
                    contract_type: (tds[2]?.textContent || '').trim(),
                    status:        (tds[3]?.textContent || '').trim(),
                    contract_no:   (tds[4]?.textContent || '').trim(),
                    subject:       (tds[5]?.textContent || '').trim(),
                    request_no:    (tds[6]?.textContent || '').trim(),
                    contract_kind: (tds[8]?.textContent || '').trim(),
                    amount:        (tds[10]?.textContent || '').trim(),
                    currency:      (tds[11]?.textContent || '').trim(),
                    created_by:    (tds[12]?.textContent || '').trim(),
                    period:        (tds[13]?.textContent || '').trim(),
                });
            }
            return out;
        }"""
    )
    return rows


async def _drill_contract_detail(page, row_index: int) -> dict[str, Any]:
    """Click the Subject anchor at row_index and parse detail page."""
    anchors = await page.query_selector_all(".gridbox .objbox table tbody td a[href='javascript: ;']")
    if row_index >= len(anchors):
        raise RuntimeError(f"row_index {row_index} out of range (have {len(anchors)})")

    # Capture the click target before navigation
    anchor = anchors[row_index]
    text = (await anchor.text_content() or "").strip()
    logger.debug("drilling row %d: %s", row_index, text[:60])

    await anchor.click()
    # User-confirmed: 5s after click for full render
    await asyncio.sleep(5)

    # Extract Basic Information section
    basic_info = await page.evaluate(
        """() => {
            const out = {};
            // Find <h4>Basic information</h4>, then walk to its .row siblings
            const hs = Array.from(document.querySelectorAll('h4')).filter(h => h.textContent.trim().toLowerCase() === 'basic information');
            if (!hs.length) return { _error: 'no Basic information h4' };
            // The next .w_box.bid_info contains the rows
            let next = hs[0].closest('div')?.nextElementSibling;
            while (next && !next.matches?.('.w_box, .bid_info')) next = next.nextElementSibling;
            const root = next?.querySelector?.('.grid_wrap') || hs[0].parentElement?.parentElement?.querySelector?.('.grid_wrap.grid_col_4');
            if (!root) return { _error: 'no .grid_wrap found' };
            for (const row of root.querySelectorAll('.row')) {
                const label = row.querySelector('.form-label')?.textContent?.trim();
                const value = row.querySelector('.col-10')?.textContent?.trim();
                if (label && value !== undefined) {
                    out[label] = value;
                }
            }
            return out;
        }"""
    )

    # Extract Item Information rows
    items = await page.evaluate(
        """() => {
            const out = [];
            const grid = document.querySelector('#itemGridbox');
            if (!grid) return out;
            const rs = grid.querySelectorAll('.objbox table tbody tr');
            for (const tr of rs) {
                const tds = tr.querySelectorAll('td');
                if (tds.length < 8) continue;
                const heightSentinel = tds[2]?.style?.height;
                if (heightSentinel === '0px') continue;
                const item_code = (tds[3]?.textContent || '').trim();
                if (!item_code) continue;
                out.push({
                    no:            (tds[2]?.textContent || '').trim(),
                    item_code:     item_code,
                    description:   (tds[4]?.textContent || '').trim(),
                    specification: (tds[5]?.textContent || '').trim(),
                    quantity:      (tds[6]?.textContent || '').trim(),
                    unit:          (tds[7]?.textContent || '').trim(),
                    unit_price:    (tds[8]?.textContent || '').trim(),
                    amount:        (tds[9]?.textContent || '').trim(),
                    currency:      (tds[10]?.textContent || '').trim(),
                });
            }
            return out;
        }"""
    )

    # Capture detail URL for traceability + return to list via goList()
    detail_url = page.url
    try:
        await page.evaluate("goList()")
        await asyncio.sleep(3)
    except Exception:
        # Fallback: just go back
        try:
            await page.go_back()
            await asyncio.sleep(3)
        except Exception:
            pass

    return {
        "basic_info": basic_info,
        "items": items,
        "detail_url": detail_url,
    }


_QTY_RE = re.compile(r"[^\d\.\-]")


def _to_number(s: str) -> float | None:
    """Parse Vietnamese number string ('1,000' or '1.000,00') to float."""
    if not s:
        return None
    raw = s.strip()
    if not raw:
        return None
    # Heuristic: if both ',' and '.' present and ',' is decimal — else strip ','
    cleaned = _QTY_RE.sub("", raw.replace(",", ""))
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


async def _insert_staging(db_pool, run_id: str, items: list[dict[str, Any]]) -> int:
    """INSERT one staging row per (contract, item). Header rows without
    items get a single row with NULL item fields so the contract is still
    visible for review."""
    if not items:
        return 0
    n = 0
    async with db_pool.acquire() as conn:
        for c in items:
            basic = c.get("basic_info") or {}
            rfq_number = basic.get("Request Number") or c.get("request_no")
            contract_period = basic.get("Contract Period") or c.get("period")
            contract_no = basic.get("Contract No") or c.get("contract_no")
            sub_items = c.get("items") or []
            if not sub_items:
                await conn.execute(
                    """
                    INSERT INTO bqms_vendor_portal_staging
                        (scrape_run_id, module, rfq_number, contract_no,
                         contract_period, raw_json, status)
                    VALUES ($1, 'contract', $2, $3, $4, $5::jsonb, 'pending_review')
                    """,
                    run_id, rfq_number, contract_no, contract_period,
                    json.dumps(c, ensure_ascii=False, default=str),
                )
                n += 1
                continue
            for it in sub_items:
                await conn.execute(
                    """
                    INSERT INTO bqms_vendor_portal_staging
                        (scrape_run_id, module, rfq_number, contract_no,
                         contract_period, item_code, description, specification,
                         quantity, unit, raw_json, status)
                    VALUES ($1, 'contract', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'pending_review')
                    """,
                    run_id, rfq_number, contract_no, contract_period,
                    it.get("item_code"), it.get("description"), it.get("specification"),
                    _to_number(it.get("quantity") or ""), it.get("unit"),
                    json.dumps({"contract": c, "item": it}, ensure_ascii=False, default=str),
                )
                n += 1
    return n
