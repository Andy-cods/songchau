"""Recon v4: precise selectors based on v3 findings.

Search button: a.btn_search
Create Delivery: a#btnCreate
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def main():
    sys.path.insert(0, "/app")
    from playwright.async_api import async_playwright
    from app.core.config import settings

    base = (settings.BQMS_BASE_URL or "https://www.sec-bqms.com").rstrip("/")
    user, pwd = settings.BQMS_USERNAME, settings.BQMS_PASSWORD
    TEST_PO = "2112666093"

    recon: dict = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "test_po": TEST_PO,
        "errors": [],
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = await browser.new_context(viewport={"width": 1600, "height": 900})
        page = await ctx.new_page()
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))

        try:
            # Login
            await page.goto(f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true", timeout=30000)
            await page.fill("input#id", user)
            await page.fill("input#pass", pwd)
            await page.evaluate("login()")
            await page.wait_for_url(lambda u: "anonymous" not in u and "login" not in u.lower(), timeout=30000)
            logger.info("Login OK")

            await page.goto(f"{base}/bqms/mro/forward/vendor/grCreateDelivery.do?target=vendor", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(3000)
            logger.info("Page loaded")

            # Fill date + PO via JS (readonly)
            from_dt = (datetime.now() - timedelta(days=120)).strftime("%m/%d/%Y")
            to_dt = datetime.now().strftime("%m/%d/%Y")
            await page.evaluate(f"""
                () => {{
                    const f = document.getElementById('srchFromDate');
                    const t = document.getElementById('srchToDate');
                    if (f) {{ f.value = '{from_dt}'; f.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                    if (t) {{ t.value = '{to_dt}'; t.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                }}
            """)
            await page.fill("#srchPoNos", TEST_PO)
            logger.info("Filled %s-%s PO=%s", from_dt, to_dt, TEST_PO)

            # Click PRECISE Search button
            await page.click("a.btn_search", timeout=10000)
            logger.info("Clicked a.btn_search")
            await page.wait_for_timeout(6000)
            await page.screenshot(path="/tmp/recon_v4_after_search.png", full_page=True)

            # Dump grid (IBSheet, table, etc.)
            grid_dump = await page.evaluate("""
                () => {
                    const out = {
                        ibsheets: [],
                        tables: [],
                        body_excerpt: document.body.innerText.slice(0, 1500),
                    };
                    if (typeof window.IBS_GetSheetCount === 'function') {
                        try {
                            const cnt = window.IBS_GetSheetCount();
                            for (let i = 0; i < cnt; i++) {
                                const sh = window.IBS_GetSheetByIndex(i);
                                if (!sh) continue;
                                const info = {idx: i, id: (sh.id || sh.getAttribute('id'))};
                                try { info.rows = sh.RowCount(); info.cols = sh.LastCol(); } catch(e) {}
                                try { info.header_rows = sh.HeaderRows ? sh.HeaderRows() : null; } catch(e) {}
                                try {
                                    info.headers = [];
                                    for (let c = 1; c <= info.cols; c++) {
                                        try { info.headers.push(sh.ColSaveName(c)); } catch(e) {}
                                    }
                                } catch(e) {}
                                try {
                                    info.samples = [];
                                    const start = info.header_rows || 1;
                                    for (let r = start; r < Math.min(start + 3, info.rows); r++) {
                                        const row = {};
                                        for (let c = 1; c <= info.cols; c++) {
                                            try {
                                                const v = sh.GetCellValue(r, c);
                                                if (v !== null && v !== '') row[`c${c}`] = String(v).slice(0,50);
                                            } catch(e) {}
                                        }
                                        info.samples.push({row_idx: r, data: row});
                                    }
                                } catch(e) { info.sample_err = String(e); }
                                out.ibsheets.push(info);
                            }
                        } catch(e) { out.ibs_err = String(e); }
                    }
                    document.querySelectorAll('table[id]:not([id=""])').forEach(t => {
                        if (t.offsetParent === null) return;
                        out.tables.push({
                            id: t.id, cls: t.className.slice(0,80),
                            rows: t.querySelectorAll('tr').length,
                            first_row_html: t.querySelector('tr') ? t.querySelector('tr').outerHTML.slice(0, 500) : null,
                        });
                    });
                    // Body text
                    return out;
                }
            """)
            recon["after_search"] = grid_dump
            logger.info("After-search: ibsheets=%d, tables=%d", len(grid_dump["ibsheets"]), len(grid_dump["tables"]))
            for ib in grid_dump["ibsheets"]:
                logger.info("  IBSheet %s: rows=%s cols=%s headers=%s", ib.get("id"), ib.get("rows"), ib.get("cols"), ib.get("headers"))
                if ib.get("samples"):
                    logger.info("  Samples: %s", ib["samples"][:2])

            # Tick first data row checkbox
            tick = await page.evaluate("""
                () => {
                    if (typeof window.IBS_GetSheetCount === 'function') {
                        const cnt = window.IBS_GetSheetCount();
                        for (let i = 0; i < cnt; i++) {
                            const sh = window.IBS_GetSheetByIndex(i);
                            if (!sh || !sh.RowCount || sh.RowCount() < 2) continue;
                            const hdr = sh.HeaderRows ? sh.HeaderRows() : 1;
                            // Tick row hdr (first data row)
                            try {
                                sh.SetCellValue(hdr, 1, 1);  // assume col 1 is checkbox
                                return {sheet_idx: i, row: hdr, ok: true, rows: sh.RowCount()};
                            } catch(e) { return {err: String(e)}; }
                        }
                    }
                    return {no_ibsheet: true};
                }
            """)
            recon["tick"] = tick
            logger.info("Tick: %s", tick)

            # Click Create Delivery button
            popup = None
            try:
                async with ctx.expect_page(timeout=15000) as pop_info:
                    await page.click("a#btnCreate", timeout=5000)
                popup = await pop_info.value
                logger.info("Popup opened: %s", popup.url)
                await popup.wait_for_load_state("domcontentloaded", timeout=15000)
                await popup.wait_for_timeout(3000)

                popup_dump = await popup.evaluate("""
                    () => {
                        const out = {url: location.href, title: document.title};
                        // ALL input/select/textarea
                        out.inputs = Array.from(document.querySelectorAll('input,select,textarea')).map(el => ({
                            tag: el.tagName, id: el.id, name: el.name, type: el.type,
                            readonly: el.readOnly, placeholder: el.placeholder,
                            value: (el.value||'').slice(0, 50),
                            visible: el.offsetParent !== null,
                            cls: (el.className||'').slice(0,60),
                        }));
                        // Clickables
                        out.clickables = Array.from(document.querySelectorAll('a, button, [class*="btn"]')).map(el => ({
                            tag: el.tagName,
                            id: el.id,
                            text: (el.textContent||el.value||'').trim().slice(0,40),
                            cls: (el.className||'').slice(0,60),
                            onclick: el.getAttribute('onclick'),
                            visible: el.offsetParent !== null,
                        }));
                        // IBSheets in popup
                        out.ibsheets = [];
                        if (typeof window.IBS_GetSheetCount === 'function') {
                            try {
                                const cnt = window.IBS_GetSheetCount();
                                for (let i = 0; i < cnt; i++) {
                                    const sh = window.IBS_GetSheetByIndex(i);
                                    if (!sh) continue;
                                    const info = {idx: i, id: sh.id || sh.getAttribute('id'), rows: 0, cols: 0, headers: []};
                                    try { info.rows = sh.RowCount(); info.cols = sh.LastCol(); } catch(e) {}
                                    try {
                                        for (let c = 1; c <= info.cols; c++) {
                                            info.headers.push(sh.ColSaveName(c));
                                        }
                                    } catch(e) {}
                                    out.ibsheets.push(info);
                                }
                            } catch(e) {}
                        }
                        return out;
                    }
                """)
                recon["popup"] = popup_dump
                logger.info("Popup: %d inputs, %d clickables, %d ibsheets", len(popup_dump["inputs"]), len(popup_dump["clickables"]), len(popup_dump["ibsheets"]))
                await popup.screenshot(path="/tmp/recon_v4_popup.png", full_page=True)
            except Exception as e:
                recon["errors"].append(f"popup: {str(e)[:200]}")
                logger.warning("popup err: %s", e)

        except Exception as exc:
            logger.exception("recon failed")
            recon["errors"].append(str(exc))
        finally:
            await browser.close()

    Path("/tmp/recon_v4.json").write_text(
        json.dumps(recon, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    print("\n=== Recon v4 done ===")
    print(f"After-search ibsheets={len(recon.get('after_search', {}).get('ibsheets', []))}")
    print(f"Popup found: {bool(recon.get('popup'))}")
    print(f"Errors: {recon.get('errors')}")


if __name__ == "__main__":
    asyncio.run(main())
