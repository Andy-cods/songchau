"""Recon v8 — focused inspect of dhtmlxGrid checkbox cell HTML structure."""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


async def main():
    sys.path.insert(0, "/app")
    from playwright.async_api import async_playwright
    from app.core.config import settings
    base = (settings.BQMS_BASE_URL or "https://www.sec-bqms.com").rstrip("/")
    user, pwd = settings.BQMS_USERNAME, settings.BQMS_PASSWORD
    TEST_PO = "2112666093"
    out: dict = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = await browser.new_context(viewport={"width": 1600, "height": 900})
        page = await ctx.new_page()
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))

        # Track all network requests for clues
        requests = []
        page.on("request", lambda req: requests.append({"url": req.url, "method": req.method, "time": datetime.now().isoformat()}))

        try:
            await page.goto(f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true", timeout=30000)
            await page.fill("input#id", user)
            await page.fill("input#pass", pwd)
            await page.evaluate("login()")
            await page.wait_for_url(lambda u: "anonymous" not in u and "login" not in u.lower(), timeout=30000)
            await page.goto(f"{base}/bqms/mro/forward/vendor/grCreateDelivery.do?target=vendor", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(3000)

            from_dt = (datetime.now() - timedelta(days=120)).strftime("%m/%d/%Y")
            to_dt = datetime.now().strftime("%m/%d/%Y")
            await page.evaluate(f"""
                () => {{
                    document.getElementById('srchFromDate').value = '{from_dt}';
                    document.getElementById('srchFromDate').dispatchEvent(new Event('change',{{bubbles:true}}));
                    document.getElementById('srchToDate').value = '{to_dt}';
                    document.getElementById('srchToDate').dispatchEvent(new Event('change',{{bubbles:true}}));
                }}
            """)
            await page.fill("#srchPoNos", TEST_PO)
            await page.click("a.btn_search")
            await page.wait_for_timeout(6000)

            # Inspect grid + row HTML
            inspect = await page.evaluate("""
                () => {
                    const g = window.globalActiveDHTMLGridObject;
                    if (!g) return {err: 'no grid'};
                    const out = {grid_keys: Object.keys(g).slice(0, 100), row_html: null, cell_objects: null};
                    try {
                        const rid = g.getRowId(0);
                        out.row_id = rid;
                        // Get row DOM element from grid
                        if (typeof g.getRowById === 'function') {
                            const rowEl = g.getRowById(rid);
                            out.row_html = rowEl ? rowEl.outerHTML.slice(0, 2000) : null;
                        }
                        // Iterate cells
                        out.cell_inspection = [];
                        for (let c = 0; c < g.getColumnsNum(); c++) {
                            const cell = g.cells(rid, c);
                            const info = {col: c, value: null, type: null, cellHTML: null};
                            try { info.value = cell.getValue(); } catch(e) {}
                            try { info.type = cell.cellType || cell.cell ? cell.cell.className : null; } catch(e) {}
                            try { info.cellHTML = cell.cell ? cell.cell.outerHTML.slice(0, 400) : null; } catch(e) {}
                            out.cell_inspection.push(info);
                        }
                        // Find checkbox using QuerySelector on row HTML
                        if (typeof g.getRowById === 'function') {
                            const rowEl = g.getRowById(rid);
                            if (rowEl) {
                                const all_inputs = rowEl.querySelectorAll('input');
                                out.input_count_in_row = all_inputs.length;
                                out.inputs_in_row = Array.from(all_inputs).map(el => ({
                                    type: el.type, name: el.name, id: el.id, checked: el.checked,
                                    cls: (el.className||'').slice(0,80),
                                }));
                                const checkboxes = rowEl.querySelectorAll('input[type=checkbox]');
                                out.row_checkboxes = Array.from(checkboxes).map(el => ({checked: el.checked}));
                            }
                        }
                    } catch(e) { out.error = String(e); }
                    return out;
                }
            """)
            out["inspect"] = inspect

            # Try clicking checkbox if found
            if inspect.get("input_count_in_row", 0) > 0:
                click_result = await page.evaluate(f"""
                    () => {{
                        const g = window.globalActiveDHTMLGridObject;
                        const rid = g.getRowId(0);
                        const rowEl = g.getRowById(rid);
                        const cbs = rowEl ? rowEl.querySelectorAll('input[type=checkbox]') : [];
                        if (cbs.length > 0) {{
                            const cb = cbs[0];
                            cb.checked = true;
                            cb.click();
                            return {{clicked: true, checked_after: cb.checked, cb_outer: cb.outerHTML.slice(0,200)}};
                        }}
                        return {{no_checkbox: true}};
                    }}
                """)
                out["click_checkbox"] = click_result

            await page.screenshot(path="/tmp/recon_v8_state.png", full_page=True)

            # Try btnCreate
            n_before = len(ctx.pages)
            req_count_before = len(requests)
            await page.click("a#btnCreate")
            await page.wait_for_timeout(6000)
            out["after_create"] = {
                "new_pages": len(ctx.pages) - n_before,
                "new_requests_count": len(requests) - req_count_before,
                "new_requests": [
                    r for r in requests[req_count_before:]
                    if "bqms" in r["url"].lower() and "static" not in r["url"]
                ][:20],
            }

        except Exception as exc:
            logging.exception("fail")
            out["error"] = str(exc)
        finally:
            await browser.close()

    Path("/tmp/recon_v8.json").write_text(json.dumps(out, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("=== Recon v8 done ===")


if __name__ == "__main__":
    asyncio.run(main())
