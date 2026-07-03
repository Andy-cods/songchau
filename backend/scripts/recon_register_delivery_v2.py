"""Recon v2: deeper DOM dump for Register Delivery + Create Delivery popup.

Improvements over v1:
  - Wait for grid render (sometimes lazy-loaded)
  - Search for buttons via multiple selectors (a/span/div with click-like attrs)
  - Enumerate all `window.*` function names (heuristic for search/create JS API)
  - Dump full HTML of suspected toolbar/header region
  - After search: dump grid via multiple framework probes (window.Grid, IBSheet, ag-grid)
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


async def main(test_po_no: str | None = None):
    sys.path.insert(0, "/app")
    from playwright.async_api import async_playwright
    from app.core.config import settings

    base = (settings.BQMS_BASE_URL or "https://www.sec-bqms.com").rstrip("/")
    user = settings.BQMS_USERNAME
    pwd = settings.BQMS_PASSWORD

    if not test_po_no:
        import asyncpg
        db_url = str(settings.DATABASE_URL).replace("postgresql+asyncpg", "postgresql").replace("+asyncpg", "")
        c = await asyncpg.connect(db_url)
        row = await c.fetchrow("SELECT po_number FROM bqms_samsung_po WHERE po_number IS NOT NULL ORDER BY po_date DESC NULLS LAST LIMIT 1")
        await c.close()
        test_po_no = row["po_number"] if row else None

    recon: dict = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "test_po_no": test_po_no,
        "list_page_pre_search": {},
        "list_page_post_search": {},
        "popup_page": {},
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

            # Goto Register Delivery
            await page.goto(f"{base}/bqms/mro/forward/vendor/grCreateDelivery.do?target=vendor", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(3000)

            # ---- Deep DOM dump
            DUMP_JS = """
            () => {
                const out = {
                    title: document.title,
                    url: location.href,
                    body_text_preview: document.body.innerText.slice(0, 2000),
                };
                // ALL buttons, links, clickable spans
                out.clickables = [];
                document.querySelectorAll('button, input[type=button], input[type=submit], a, span[onclick], div[onclick], li[onclick]').forEach(el => {
                    const text = (el.textContent || el.value || '').trim().slice(0, 60);
                    if (text || el.id || el.getAttribute('onclick')) {
                        out.clickables.push({
                            tag: el.tagName,
                            id: el.id || null,
                            cls: el.className ? String(el.className).slice(0, 80) : null,
                            text: text,
                            type: el.type || null,
                            onclick: el.getAttribute('onclick'),
                            href: el.tagName === 'A' ? el.getAttribute('href') : null,
                        });
                    }
                });
                // Window-level functions (likely search/create entry points)
                out.window_functions = [];
                for (const k of Object.keys(window)) {
                    try {
                        if (typeof window[k] === 'function' && k.length < 40) {
                            const lower = k.toLowerCase();
                            if (lower.includes('search') || lower.includes('create') || lower.includes('save') || lower.includes('delivery') || lower.includes('submit') || lower.includes('register')) {
                                out.window_functions.push(k);
                            }
                        }
                    } catch(e) {}
                }
                // IBSheet probe (Samsung BQMS uses IBSheet for many grids)
                out.ibsheets = [];
                if (typeof window.IBS_GetSheetCount === 'function') {
                    try {
                        const count = window.IBS_GetSheetCount();
                        for (let i = 0; i < count; i++) {
                            const sheet = window.IBS_GetSheetByIndex(i);
                            out.ibsheets.push({
                                idx: i,
                                id: sheet.getAttribute('id') || sheet.id,
                                rows: sheet.RowCount ? sheet.RowCount() : null,
                                cols: sheet.LastCol ? sheet.LastCol() : null,
                            });
                        }
                    } catch(e) { out.ibsheets_error = e.toString(); }
                }
                // dhtmlXGrid probe
                out.dhtmlx_grid = null;
                ['Grid', 'gridObj', 'mygrid', 'gridMain', 'mainGrid', 'srchGrid'].forEach(name => {
                    if (typeof window[name] !== 'undefined' && window[name] && window[name].getRowsNum) {
                        try {
                            out.dhtmlx_grid = {
                                var_name: name,
                                rows: window[name].getRowsNum(),
                                cols: window[name].getColumnsNum ? window[name].getColumnsNum() : null,
                            };
                        } catch(e) {}
                    }
                });
                // Iframes (Samsung often uses iframe for sub-pages)
                out.iframes = [];
                document.querySelectorAll('iframe').forEach(f => {
                    out.iframes.push({
                        id: f.id, name: f.name, src: f.src.slice(0, 200),
                    });
                });
                // Toolbar/header HTML snippet
                const tbar = document.querySelector('.btn-group, .toolbar, .header-toolbar, .ibtm-btn-group, [class*="btn"]');
                out.toolbar_snippet = tbar ? tbar.outerHTML.slice(0, 800) : null;
                return out;
            }
            """
            recon["list_page_pre_search"] = await page.evaluate(DUMP_JS)
            logger.info("Pre-search: %d clickables, %d funcs, ibsheets=%d, dhtmlx=%s",
                        len(recon["list_page_pre_search"]["clickables"]),
                        len(recon["list_page_pre_search"]["window_functions"]),
                        len(recon["list_page_pre_search"].get("ibsheets", [])),
                        recon["list_page_pre_search"].get("dhtmlx_grid"))

            # ---- Try search ----
            if test_po_no:
                # Set 60-day date range
                from_dt = (datetime.now() - timedelta(days=60)).strftime("%m/%d/%Y")
                to_dt = datetime.now().strftime("%m/%d/%Y")
                await page.fill("#srchFromDate", from_dt)
                await page.fill("#srchToDate", to_dt)
                await page.fill("#srchPoNos", test_po_no)
                logger.info("Filled date %s-%s, PO=%s", from_dt, to_dt, test_po_no)

                # Try multiple search triggers
                tried = []
                for func in recon["list_page_pre_search"]["window_functions"]:
                    if "search" in func.lower():
                        try:
                            await page.evaluate(f"{func}()")
                            tried.append(f"win.{func}()")
                            recon["list_page_pre_search"]["search_via"] = func
                            break
                        except Exception:
                            tried.append(f"FAIL win.{func}()")
                # If no window func, click button by text
                if "search_via" not in recon["list_page_pre_search"]:
                    for sel in ['button:has-text("Search")', 'a:has-text("Search")', 'span:has-text("Search")',
                                'input[type=button][value*="Search" i]', 'input[type=submit]']:
                        try:
                            cnt = await page.locator(sel).count()
                            if cnt:
                                await page.locator(sel).first.click()
                                tried.append(f"click {sel}")
                                recon["list_page_pre_search"]["search_via"] = sel
                                break
                        except Exception:
                            tried.append(f"FAIL {sel}")
                recon["list_page_pre_search"]["search_attempts"] = tried

                await page.wait_for_timeout(5000)
                recon["list_page_post_search"] = await page.evaluate(DUMP_JS)
                logger.info("Post-search: ibsheets=%d, dhtmlx=%s",
                            len(recon["list_page_post_search"].get("ibsheets", [])),
                            recon["list_page_post_search"].get("dhtmlx_grid"))

            await page.screenshot(path="/tmp/recon_v2_list.png", full_page=True)
        except Exception as exc:
            logger.exception("recon fail")
            recon["errors"].append(str(exc))
        finally:
            await browser.close()

    Path("/tmp/recon_v2.json").write_text(
        json.dumps(recon, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    print("\n=== Recon v2 done ===")
    print(f"errors: {recon['errors']}")
    print(f"search_via: {recon.get('list_page_pre_search', {}).get('search_via')}")
    print(f"window_functions: {recon.get('list_page_pre_search', {}).get('window_functions', [])[:15]}")


if __name__ == "__main__":
    test_po = os.environ.get("TEST_PO_NO") or (sys.argv[1] if len(sys.argv) > 1 else None)
    asyncio.run(main(test_po))
