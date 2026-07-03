"""Recon v3: full flow with Thang's test PO 2112666093.

Improvements over v2:
  - JS `.value=` + dispatchEvent('change') to bypass readonly date inputs
  - Try MULTIPLE search triggers: form submit, button click via text, JS func
  - After search: dump IBSheet / dhtmlxGrid / DOM table thoroughly
  - Tick first row checkbox via JS
  - Click Create Delivery + wait for popup window
  - Dump popup DOM (inputs, buttons, grids)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


DEEP_DUMP_JS = """
() => {
    const out = { url: location.href, title: document.title };
    // Clickables (everything clickable)
    out.clickables = [];
    document.querySelectorAll('button, input[type=button], input[type=submit], a, span[onclick], div[onclick], li[onclick], [class*="btn"]:not([class*="btn-group"]), [role="button"]').forEach(el => {
        const text = (el.textContent || el.value || '').trim().slice(0, 60);
        if (text || el.id || el.getAttribute('onclick')) {
            out.clickables.push({
                tag: el.tagName,
                id: el.id || null,
                cls: el.className ? String(el.className).slice(0, 100) : null,
                text: text.slice(0, 50),
                onclick: el.getAttribute('onclick'),
                visible: el.offsetParent !== null,
            });
        }
    });
    // Window functions
    out.win_funcs = [];
    for (const k of Object.keys(window)) {
        try {
            if (typeof window[k] === 'function' && k.length < 40) {
                const l = k.toLowerCase();
                if (l.match(/search|create|save|deliv|submit|register|grcreate|fnsearch/)) out.win_funcs.push(k);
            }
        } catch(e) {}
    }
    // IBSheet probe (best guess for Samsung BQMS grids)
    out.ibsheets = [];
    if (typeof window.IBS_GetSheetCount === 'function') {
        try {
            const cnt = window.IBS_GetSheetCount();
            for (let i = 0; i < cnt; i++) {
                const sh = window.IBS_GetSheetByIndex(i);
                if (!sh) continue;
                const info = {
                    idx: i,
                    id: sh.getAttribute ? sh.getAttribute('id') : (sh.id || null),
                };
                try { info.rows = sh.RowCount ? sh.RowCount() : (sh.LastRow ? sh.LastRow() : null); } catch(e) {}
                try { info.cols = sh.LastCol ? sh.LastCol() : null; } catch(e) {}
                // Sample first 2 rows
                try {
                    if (info.rows && info.rows > 0) {
                        info.sample = [];
                        const start = sh.HeaderRows ? sh.HeaderRows() : 1;
                        for (let r = start; r < Math.min(start + 2, sh.RowCount()); r++) {
                            const row = {};
                            for (let c = 1; c <= info.cols; c++) {
                                try {
                                    const v = sh.GetCellValue ? sh.GetCellValue(r, c) : null;
                                    if (v !== null && v !== '') row[`c${c}`] = String(v).slice(0, 40);
                                } catch(e) {}
                            }
                            info.sample.push(row);
                        }
                    }
                } catch(e) { info.sample_err = String(e); }
                out.ibsheets.push(info);
            }
        } catch(e) { out.ibsheets_error = String(e); }
    }
    // Tables (plain HTML fallback)
    out.tables = [];
    document.querySelectorAll('table.ibsheet, table.grid, table[id*="grid" i], table[id*="sheet" i], div[class*="ibsheet"]').forEach(t => {
        out.tables.push({
            tag: t.tagName,
            id: t.id,
            cls: t.className.slice(0, 80),
            rows: t.querySelectorAll('tr').length,
        });
    });
    // Visible text in possible result area
    out.body_excerpt = document.body.innerText.slice(0, 600);
    return out;
}
"""


async def main():
    sys.path.insert(0, "/app")
    from playwright.async_api import async_playwright
    from app.core.config import settings

    base = (settings.BQMS_BASE_URL or "https://www.sec-bqms.com").rstrip("/")
    user = settings.BQMS_USERNAME
    pwd = settings.BQMS_PASSWORD

    TEST_PO = "2112666093"
    TEST_BQMS = "Z0000002-385323"

    recon: dict = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "test_po": TEST_PO,
        "test_bqms": TEST_BQMS,
        "pre_search": None,
        "post_search": None,
        "popup": None,
        "errors": [],
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = await browser.new_context(viewport={"width": 1600, "height": 900})
        page = await ctx.new_page()
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))
        page.on("console", lambda m: None)

        try:
            # Login
            logger.info("Login...")
            await page.goto(f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true", timeout=30000)
            await page.fill("input#id", user)
            await page.fill("input#pass", pwd)
            await page.evaluate("login()")
            await page.wait_for_url(lambda u: "anonymous" not in u and "login" not in u.lower(), timeout=30000)
            logger.info("Login OK")

            # Goto Register Delivery
            await page.goto(f"{base}/bqms/mro/forward/vendor/grCreateDelivery.do?target=vendor", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(3000)

            recon["pre_search"] = await page.evaluate(DEEP_DUMP_JS)
            logger.info("Pre-search: clickables=%d, win_funcs=%s, ibsheets=%d",
                        len(recon["pre_search"]["clickables"]),
                        recon["pre_search"]["win_funcs"][:8],
                        len(recon["pre_search"].get("ibsheets", [])))

            # Fill date via JS (readonly inputs)
            from_dt = (datetime.now() - timedelta(days=90)).strftime("%m/%d/%Y")
            to_dt = datetime.now().strftime("%m/%d/%Y")
            await page.evaluate(f"""
                () => {{
                    const f = document.getElementById('srchFromDate');
                    const t = document.getElementById('srchToDate');
                    if (f) {{ f.value = '{from_dt}'; f.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                    if (t) {{ t.value = '{to_dt}'; t.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                }}
            """)
            # PO No
            await page.fill("#srchPoNos", TEST_PO)
            logger.info("Filled dates %s-%s, PO=%s", from_dt, to_dt, TEST_PO)

            # Try search triggers in order of likelihood
            search_attempts = []
            searched = False

            # 1) Try button by text "Search"
            try:
                btn = page.locator('button:has-text("Search"), a:has-text("Search"), span:has-text("Search")').first
                cnt = await btn.count()
                if cnt:
                    await btn.click(timeout=5000)
                    search_attempts.append({"method": "click button:has-text('Search')", "ok": True})
                    searched = True
            except Exception as e:
                search_attempts.append({"method": "click Search", "err": str(e)[:100]})

            # 2) JS function fallback
            if not searched:
                for fn in recon["pre_search"]["win_funcs"]:
                    if "search" in fn.lower() and "result" not in fn.lower():
                        try:
                            await page.evaluate(f"{fn}()")
                            search_attempts.append({"method": f"win.{fn}()", "ok": True})
                            searched = True
                            break
                        except Exception as e:
                            search_attempts.append({"method": f"win.{fn}()", "err": str(e)[:100]})

            # 3) Submit form
            if not searched:
                try:
                    await page.evaluate("document.querySelector('form').submit()")
                    search_attempts.append({"method": "form.submit()", "ok": True})
                    searched = True
                except Exception as e:
                    search_attempts.append({"method": "form.submit()", "err": str(e)[:100]})

            recon["search_attempts"] = search_attempts
            logger.info("Search attempts: %s", search_attempts)

            await page.wait_for_timeout(5000)

            recon["post_search"] = await page.evaluate(DEEP_DUMP_JS)
            logger.info("Post-search ibsheets=%d, body_excerpt[:200]=%s",
                        len(recon["post_search"].get("ibsheets", [])),
                        recon["post_search"]["body_excerpt"][:200])

            await page.screenshot(path="/tmp/recon_v3_after_search.png", full_page=True)

            # Try tick first checkbox + Create Delivery
            # Look for any checkbox in the result table that's not the "select all"
            tick_result = await page.evaluate("""
                () => {
                    const out = {checkboxes_found: 0, ticked: null};
                    const cbs = document.querySelectorAll('input[type=checkbox]');
                    out.checkboxes_found = cbs.length;
                    for (let i = 0; i < cbs.length; i++) {
                        const cb = cbs[i];
                        if (cb.offsetParent === null) continue;  // skip hidden
                        if (i === 0) continue;  // usually "select all" header
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change', {bubbles: true}));
                        out.ticked = i;
                        break;
                    }
                    return out;
                }
            """)
            recon["tick_result"] = tick_result
            logger.info("Tick: %s", tick_result)

            # Click Create Delivery button
            popup_page = None
            try:
                async with ctx.expect_page(timeout=10000) as pop_info:
                    # Try clicking "Create Delivery" button
                    btn = page.locator('button:has-text("Create Delivery"), a:has-text("Create Delivery"), span:has-text("Create Delivery"), [onclick*="grCreateDelivery"]').first
                    await btn.click(timeout=5000)
                popup_page = await pop_info.value
                logger.info("Popup opened: %s", popup_page.url)
                await popup_page.wait_for_load_state("domcontentloaded", timeout=15000)
                await popup_page.wait_for_timeout(3000)
                recon["popup"] = await popup_page.evaluate(DEEP_DUMP_JS)
                # Also dump all input IDs in popup
                recon["popup"]["all_inputs"] = await popup_page.evaluate("""
                    () => Array.from(document.querySelectorAll('input,select,textarea')).map(el => ({
                        tag: el.tagName,
                        id: el.id, name: el.name, type: el.type,
                        readonly: el.readOnly, value_preview: (el.value||'').slice(0,40),
                        visible: el.offsetParent !== null,
                    }))
                """)
                await popup_page.screenshot(path="/tmp/recon_v3_popup.png", full_page=True)
            except Exception as e:
                recon["errors"].append(f"popup failed: {str(e)[:200]}")
                logger.warning("popup failed: %s", e)

        except Exception as exc:
            logger.exception("recon failed")
            recon["errors"].append(f"top: {str(exc)[:300]}")
        finally:
            await browser.close()

    Path("/tmp/recon_v3.json").write_text(
        json.dumps(recon, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    print("\n=== Recon v3 done ===")
    print(f"Search: {recon.get('search_attempts')}")
    print(f"IBSheets pre={len(recon.get('pre_search', {}).get('ibsheets', []))} post={len(recon.get('post_search', {}).get('ibsheets', []))}")
    print(f"Popup found: {bool(recon.get('popup'))}")
    print(f"Errors: {recon['errors']}")


if __name__ == "__main__":
    asyncio.run(main())
