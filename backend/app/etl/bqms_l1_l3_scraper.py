"""Phase L scrapers — Bidding · Quotation Announcement (L1, menu 5)
+ Selection Result (L3, menu 18). Both reuse the IBSheet pattern from
the bidding scraper (camelCase row keys, dismiss popup, etc.).

L3 has a HIGH-VALUE side effect: when selectionResultName='Selected' or
'Unselected', auto-update bqms_rfq.result to 'won' / 'lost'. This eliminates
manual data entry for "RFQ trúng/trượt".
"""
from __future__ import annotations
import asyncio, json, logging, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
OUT_DIR = Path("/tmp/scrape_runs")

# Reuse helpers from bidding scraper
from app.etl.bqms_bidding_scraper import (
    _dismiss_ibsheet_popup,
    _set_page_and_size,
    BIDDING_KEYS,
)

# L3 has these extra fields
L3_KEYS = BIDDING_KEYS + ["selectionResult", "selectionResultName"]


async def _login_and_navigate(page, base, user, pwd, menu_id, page_size, page_num):
    """Shared login + navigate to a menu_id list page."""
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

    await page.evaluate(f"selectLeftMenu({menu_id}, {menu_id}, true)")
    await asyncio.sleep(5)
    await _dismiss_ibsheet_popup(page)
    await asyncio.sleep(6)

    if page_size != 10 or page_num > 1:
        await _set_page_and_size(page, page_size, page_num)
        await asyncio.sleep(5)
        await _dismiss_ibsheet_popup(page)
        await asyncio.sleep(2)


async def _extract_rows(page, keys, limit):
    return await page.evaluate(
        """({ keys, limit }) => {
            let bestIdx = 0, bestCount = -1;
            for (let i = 0; i < (window.IBSheet || []).length; i++) {
                try {
                    const len = (window.IBSheet[i].getDataRows() || []).length;
                    if (len > bestCount) { bestCount = len; bestIdx = i; }
                } catch (e) {}
            }
            const s = window.IBSheet?.[bestIdx];
            if (!s || typeof s.getDataRows !== 'function') return { items: [], totalCnt: 0 };
            const all = s.getDataRows();
            const total = all.length;
            const max = limit > 0 ? Math.min(limit, total) : total;
            const items = [];
            let totalCnt = 0;
            for (let i = 0; i < max; i++) {
                const r = all[i];
                const out = { _row_idx: i };
                for (const k of keys) {
                    try {
                        const v = r[k];
                        if (v !== null && v !== undefined && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
                            out[k] = typeof v === 'string' ? v.slice(0, 1000) : v;
                        }
                    } catch (e) {}
                }
                items.push(out);
                if (i === 0 && typeof out.totalCnt === 'number') totalCnt = out.totalCnt;
            }
            return { items, totalCnt };
        }""",
        {"keys": keys, "limit": limit},
    )


async def scrape_announcement(
    limit: int = 0, save_raw_json: bool = True, db_pool=None,
    page_size: int = 100, page_num: int = 1,
) -> dict[str, Any]:
    """L1: Bidding · Quotation Announcement (menu 5).

    REQUEST-level list of bidding INVITATIONS. Insert staging with
    module='announcement' for visibility tracking — does not auto-merge
    anywhere.
    """
    from playwright.async_api import async_playwright
    from app.core.config import settings
    from app.services.bqms_credentials import get_bqms_credentials
    user, pwd = get_bqms_credentials()
    base = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"
    if not user or not pwd:
        raise RuntimeError("BQMS credentials missing")

    run_id = str(uuid.uuid4())
    started = datetime.now(timezone.utc)
    items: list[dict] = []
    total_avail = 0

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, locale="en-US")
        page = await ctx.new_page()
        await _login_and_navigate(page, base, user, pwd, 5, page_size, page_num)
        result = await _extract_rows(page, BIDDING_KEYS, limit)
        items = result.get("items", [])
        total_avail = int(result.get("totalCnt") or 0)
        await browser.close()

    finished = datetime.now(timezone.utc)
    payload = {
        "run_id": run_id, "module": "announcement",
        "started_at": started.isoformat(), "finished_at": finished.isoformat(),
        "duration_seconds": (finished - started).total_seconds(),
        "list_count": len(items), "total_available": total_avail, "items": items,
    }
    if save_raw_json:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        jp = OUT_DIR / f"announcement_run_{run_id}.json"
        jp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        payload["json_path"] = str(jp)

    if db_pool is not None:
        n = await _insert_staging_announcement(db_pool, run_id, items)
        payload["staging_inserts"] = n

    return payload


async def scrape_selection_result(
    limit: int = 0, save_raw_json: bool = True, db_pool=None,
    auto_mark_result: bool = True,
    page_size: int = 100, page_num: int = 1,
) -> dict[str, Any]:
    """L3: Selection Result (menu 18).

    Each row has selectionResult ('RES01'/'RES02') + selectionResultName
    ('Selected'/'Unselected'). When auto_mark_result=True and db_pool given,
    UPDATE bqms_rfq.result for ANY rfq_number found:
      Selected   → result='won'
      Unselected → result='lost'

    Returns counts including won_marked / lost_marked.
    """
    from playwright.async_api import async_playwright
    from app.core.config import settings
    from app.services.bqms_credentials import get_bqms_credentials
    user, pwd = get_bqms_credentials()
    base = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"
    if not user or not pwd:
        raise RuntimeError("BQMS credentials missing")

    run_id = str(uuid.uuid4())
    started = datetime.now(timezone.utc)
    items: list[dict] = []
    total_avail = 0

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, locale="en-US")
        page = await ctx.new_page()
        await _login_and_navigate(page, base, user, pwd, 18, page_size, page_num)
        result = await _extract_rows(page, L3_KEYS, limit)
        items = result.get("items", [])
        total_avail = int(result.get("totalCnt") or 0)
        await browser.close()

    finished = datetime.now(timezone.utc)
    payload = {
        "run_id": run_id, "module": "selection_result",
        "started_at": started.isoformat(), "finished_at": finished.isoformat(),
        "duration_seconds": (finished - started).total_seconds(),
        "list_count": len(items), "total_available": total_avail, "items": items,
    }
    if save_raw_json:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        jp = OUT_DIR / f"selection_run_{run_id}.json"
        jp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        payload["json_path"] = str(jp)

    if db_pool is not None:
        n_stage = await _insert_staging_selection(db_pool, run_id, items)
        payload["staging_inserts"] = n_stage
        if auto_mark_result:
            won, lost = await _auto_mark_bqms_rfq_result(db_pool, items)
            payload["won_marked"] = won
            payload["lost_marked"] = lost

    return payload


async def _insert_staging_announcement(db_pool, run_id, items):
    if not items: return 0
    n = 0
    async with db_pool.acquire() as conn:
        for r in items:
            await conn.execute(
                """
                INSERT INTO bqms_vendor_portal_staging
                    (scrape_run_id, module, rfq_number, contract_period,
                     description, raw_json, status)
                VALUES ($1, 'announcement', $2, $3, $4, $5::jsonb, 'pending_review')
                """,
                run_id,
                (r.get("reqNo") or "").strip() or None,
                (r.get("deadlineDt") or "").strip() or None,
                (r.get("reqName") or "").strip() or None,
                json.dumps(r, ensure_ascii=False, default=str),
            )
            n += 1
    return n


async def _insert_staging_selection(db_pool, run_id, items):
    if not items: return 0
    n = 0
    async with db_pool.acquire() as conn:
        for r in items:
            await conn.execute(
                """
                INSERT INTO bqms_vendor_portal_staging
                    (scrape_run_id, module, rfq_number, contract_period,
                     description, raw_json, status, review_notes)
                VALUES ($1, 'selection_result', $2, $3, $4, $5::jsonb, 'pending_review', $6)
                """,
                run_id,
                (r.get("reqNo") or "").strip() or None,
                (r.get("deadlineDt") or "").strip() or None,
                (r.get("reqName") or "").strip() or None,
                json.dumps(r, ensure_ascii=False, default=str),
                f"selectionResult={r.get('selectionResultName') or '?'}",
            )
            n += 1
    return n


async def _auto_mark_bqms_rfq_result(db_pool, items) -> tuple[int, int]:
    """For each selection-result row, UPDATE bqms_rfq.result for matching
    rfq_number. Returns (won_count, lost_count)."""
    won = 0; lost = 0
    async with db_pool.acquire() as conn:
        for r in items:
            rfq = (r.get("reqNo") or "").strip()
            if not rfq:
                continue
            name = (r.get("selectionResultName") or "").strip().lower()
            if name in ("selected", "selection", "win", "won"):
                target = "won"
            elif name in ("unselected", "not selected", "loss", "lost"):
                target = "lost"
            else:
                continue
            res = await conn.execute(
                """
                UPDATE bqms_rfq
                SET result = $1::rfq_result,
                    result_date = COALESCE(result_date, NOW()::date),
                    updated_at = NOW(),
                    notes = COALESCE(notes, '') ||
                            ' | [auto-mark from Selection Result @ ' ||
                            to_char(NOW(),'YYYY-MM-DD') || ']'
                WHERE rfq_number = $2
                  AND (result IS NULL OR result::text = 'pending')
                """,
                target, rfq,
            )
            # res = 'UPDATE N' where N = affected rows
            try:
                n = int(res.split()[-1])
            except Exception:
                n = 0
            if target == "won": won += n
            else: lost += n
    return won, lost
