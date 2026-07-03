"""Recon v5: precise tick checkbox + create delivery popup dump."""
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

    recon: dict = {"errors": []}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = await browser.new_context(viewport={"width": 1600, "height": 900}, accept_downloads=True)
        page = await ctx.new_page()
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))

        try:
            # Login
            await page.goto(f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true", timeout=30000)
            await page.fill("input#id", user)
            await page.fill("input#pass", pwd)
            await page.evaluate("login()")
            await page.wait_for_url(lambda u: "anonymous" not in u and "login" not in u.lower(), timeout=30000)

            await page.goto(f"{base}/bqms/mro/forward/vendor/grCreateDelivery.do?target=vendor", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(3000)

            # Set date + PO via JS
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
            await page.click("a.btn_search")
            await page.wait_for_timeout(6000)

            # Deep dump of grid area
            grid_struct = await page.evaluate("""
                () => {
                    const out = {checkboxes: [], rows_with_po: [], dataGrid_structures: []};
                    // Find any element containing the test PO number
                    const candidates = [];
                    document.querySelectorAll('*').forEach(el => {
                        const txt = (el.textContent || '').trim();
                        if (txt === '2112666093' && el.children.length === 0) {
                            candidates.push({
                                tag: el.tagName, cls: (el.className||'').slice(0,60),
                                parent_chain: (() => {
                                    let chain = []; let cur = el;
                                    for (let i = 0; i < 6 && cur; i++) {
                                        chain.push({tag: cur.tagName, id: cur.id, cls: (cur.className||'').slice(0,60)});
                                        cur = cur.parentElement;
                                    }
                                    return chain;
                                })(),
                            });
                        }
                    });
                    out.rows_with_po = candidates;
                    // All visible checkboxes
                    document.querySelectorAll('input[type=checkbox]').forEach(cb => {
                        if (cb.offsetParent === null) return;
                        const tr = cb.closest('tr');
                        out.checkboxes.push({
                            id: cb.id, name: cb.name, cls: (cb.className||'').slice(0,60),
                            checked: cb.checked,
                            row_text: tr ? tr.innerText.slice(0, 200) : null,
                        });
                    });
                    // Look for `gridView`, `dataGrid` style elements
                    document.querySelectorAll('[class*="grid"], [class*="Grid"], [id*="grid"], [id*="Grid"]').forEach(el => {
                        if (el.offsetParent === null) return;
                        out.dataGrid_structures.push({
                            tag: el.tagName, id: el.id, cls: (el.className||'').slice(0,80),
                            children_count: el.children.length,
                        });
                    });
                    return out;
                }
            """)
            recon["grid_struct"] = grid_struct
            logger.info("Found %d rows_with_po, %d checkboxes, %d grid structures",
                        len(grid_struct["rows_with_po"]),
                        len(grid_struct["checkboxes"]),
                        len(grid_struct["dataGrid_structures"]))
            for c in grid_struct["checkboxes"][:5]:
                logger.info("  Checkbox: id=%s cls=%s row=%s", c.get("id"), c.get("cls"), (c.get("row_text") or "")[:100])

            # Try tick: find checkbox in the row that contains "2112666093"
            tick = await page.evaluate(f"""
                () => {{
                    const PO = '{TEST_PO}';
                    let ticked = null;
                    // find all rows containing PO
                    document.querySelectorAll('tr, [role="row"], div[class*="row"]').forEach(tr => {{
                        if (tr.innerText.includes(PO) && !ticked) {{
                            const cb = tr.querySelector('input[type=checkbox]');
                            if (cb && cb.offsetParent !== null) {{
                                cb.checked = true;
                                cb.dispatchEvent(new Event('change', {{bubbles: true}}));
                                cb.dispatchEvent(new Event('click', {{bubbles: true}}));
                                ticked = {{tag: tr.tagName, cls: (tr.className||'').slice(0,60), cb_id: cb.id, cb_cls: (cb.className||'').slice(0,60)}};
                            }}
                        }}
                    }});
                    return ticked;
                }}
            """)
            recon["tick_result"] = tick
            logger.info("Tick: %s", tick)
            await page.screenshot(path="/tmp/recon_v5_ticked.png", full_page=True)

            # Click Create Delivery and wait for popup
            popup = None
            try:
                async with ctx.expect_page(timeout=15000) as pop_info:
                    await page.click("a#btnCreate", timeout=5000)
                popup = await pop_info.value
                logger.info("Popup URL: %s", popup.url)
                await popup.wait_for_load_state("domcontentloaded", timeout=15000)
                await popup.wait_for_timeout(4000)

                popup_dump = await popup.evaluate("""
                    () => {
                        const out = {
                            url: location.href,
                            title: document.title,
                            inputs: [],
                            clickables: [],
                            ibsheets: [],
                        };
                        document.querySelectorAll('input,select,textarea').forEach(el => {
                            if (el.type === 'hidden') return;
                            out.inputs.push({
                                tag: el.tagName, id: el.id, name: el.name, type: el.type,
                                readonly: el.readOnly,
                                placeholder: el.placeholder,
                                value: (el.value||'').slice(0,50),
                                visible: el.offsetParent !== null,
                            });
                        });
                        document.querySelectorAll('a, button, [class*="btn"]').forEach(el => {
                            const txt = (el.textContent||el.value||'').trim().slice(0,50);
                            if (txt || el.id) {
                                out.clickables.push({
                                    tag: el.tagName, id: el.id,
                                    text: txt,
                                    cls: (el.className||'').slice(0,60),
                                    onclick: el.getAttribute('onclick'),
                                    visible: el.offsetParent !== null,
                                });
                            }
                        });
                        if (typeof window.IBS_GetSheetCount === 'function') {
                            try {
                                const cnt = window.IBS_GetSheetCount();
                                for (let i = 0; i < cnt; i++) {
                                    const sh = window.IBS_GetSheetByIndex(i);
                                    if (!sh) continue;
                                    const info = {idx: i, id: sh.id || sh.getAttribute('id')};
                                    try { info.rows = sh.RowCount(); info.cols = sh.LastCol(); } catch(e) {}
                                    try {
                                        info.headers = [];
                                        for (let c = 1; c <= info.cols; c++) info.headers.push(sh.ColSaveName(c));
                                    } catch(e) {}
                                    out.ibsheets.push(info);
                                }
                            } catch(e) { out.ibs_err = String(e); }
                        }
                        return out;
                    }
                """)
                recon["popup"] = popup_dump
                logger.info("Popup: %d inputs / %d clickables / %d ibsheets", len(popup_dump["inputs"]), len(popup_dump["clickables"]), len(popup_dump["ibsheets"]))
                await popup.screenshot(path="/tmp/recon_v5_popup.png", full_page=True)
            except Exception as e:
                recon["errors"].append(f"popup: {str(e)[:200]}")
                logger.warning("popup err: %s", e)
                # Save screenshot of main page state when popup failed
                await page.screenshot(path="/tmp/recon_v5_popup_fail.png", full_page=True)

        except Exception as exc:
            logger.exception("recon fail")
            recon["errors"].append(str(exc))
        finally:
            await browser.close()

    Path("/tmp/recon_v5.json").write_text(json.dumps(recon, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("\n=== Recon v5 done ===")
    print(f"Errors: {recon['errors']}")
    print(f"Popup found: {bool(recon.get('popup'))}")


if __name__ == "__main__":
    asyncio.run(main())
