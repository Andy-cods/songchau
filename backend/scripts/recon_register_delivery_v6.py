"""Recon v6: find dhtmlxGrid instance variable + tick API + popup window.

Key learnings from v1-v5:
  - Grid = dhtmlxGrid (id="dhtmlxGridVendorPortal", class "gridbox isModern")
  - Grid populated AFTER search click
  - Checkboxes in row are rendered via dhtmlxGrid widget, not <input>
  - Popup not opening via ctx.expect_page → may be modal overlay div

v6 strategy:
  1. After search, scan window.* for objects matching dhtmlxGrid interface
     (has getRowsNum + getRowId + cells methods)
  2. Dump grid columns + rows via dhtmlxGrid API
  3. Tick row 0 via mygrid.cells(rid, 0).setValue(1) and mygrid.checkRow(rid)
  4. Click #btnCreate then WAIT for either:
     - New window (expect_page)
     - New iframe in DOM
     - Modal dialog (div with class containing 'modal'/'popup'/'layer')
     - URL change (in same page)
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

    recon: dict = {"errors": []}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = await browser.new_context(viewport={"width": 1600, "height": 900}, accept_downloads=True)
        page = await ctx.new_page()
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))
        # Track all page events for popup detection
        all_pages_seen = []
        ctx.on("page", lambda pg: all_pages_seen.append({"url": pg.url, "time": datetime.now().isoformat()}))

        try:
            # Login
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
                    const f = document.getElementById('srchFromDate');
                    const t = document.getElementById('srchToDate');
                    if (f) {{ f.value = '{from_dt}'; f.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                    if (t) {{ t.value = '{to_dt}'; t.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                }}
            """)
            await page.fill("#srchPoNos", TEST_PO)
            await page.click("a.btn_search")
            await page.wait_for_timeout(6000)

            # ===== Find dhtmlxGrid instance =====
            grid_probe = await page.evaluate("""
                () => {
                    const out = {grid_candidates: [], iframes_in_dom: [], all_globals_with_rows: []};
                    // Scan all window properties for dhtmlxGrid-like objects
                    for (const k of Object.keys(window)) {
                        try {
                            const v = window[k];
                            if (v && typeof v === 'object' && typeof v.getRowsNum === 'function') {
                                out.grid_candidates.push({
                                    name: k,
                                    rowsNum: v.getRowsNum(),
                                    cols: (typeof v.getColumnsNum === 'function') ? v.getColumnsNum() : null,
                                });
                            }
                            // also scan for objects with .rows or .data
                            if (v && typeof v === 'object' && v.constructor && v.constructor.name && v.constructor.name.toLowerCase().includes('grid')) {
                                out.all_globals_with_rows.push({name: k, ctor: v.constructor.name});
                            }
                        } catch(e) {}
                    }
                    // Iframes in DOM
                    document.querySelectorAll('iframe').forEach(f => {
                        out.iframes_in_dom.push({id: f.id, name: f.name, src: f.src.slice(0,200), visible: f.offsetParent !== null});
                    });
                    return out;
                }
            """)
            recon["grid_probe"] = grid_probe
            logger.info("Grid candidates: %s", grid_probe["grid_candidates"])
            logger.info("Constructor scan: %s", grid_probe["all_globals_with_rows"])

            # ===== If found grid var, dump rows =====
            if grid_probe["grid_candidates"]:
                grid_name = grid_probe["grid_candidates"][0]["name"]
                grid_data = await page.evaluate(f"""
                    () => {{
                        const g = window['{grid_name}'];
                        const out = {{
                            grid_name: '{grid_name}',
                            rows: g.getRowsNum(),
                            cols: g.getColumnsNum(),
                            column_ids: [],
                            column_labels: [],
                            sample_rows: [],
                        }};
                        for (let c = 0; c < out.cols; c++) {{
                            try {{ out.column_ids.push(g.getColumnId(c)); }} catch(e) {{ out.column_ids.push(null); }}
                            try {{ out.column_labels.push(g.getColLabel(c)); }} catch(e) {{ out.column_labels.push(null); }}
                        }}
                        for (let r = 0; r < Math.min(3, out.rows); r++) {{
                            const rid = g.getRowId(r);
                            const row = {{row_id: rid, cells: {{}}}};
                            for (let c = 0; c < out.cols; c++) {{
                                try {{
                                    const colId = g.getColumnId(c) || `col${{c}}`;
                                    row.cells[colId] = g.cells(rid, c).getValue();
                                }} catch(e) {{}}
                            }}
                            out.sample_rows.push(row);
                        }}
                        return out;
                    }}
                """)
                recon["grid_data"] = grid_data
                logger.info("Grid '%s' rows=%d cols=%d", grid_data["grid_name"], grid_data["rows"], grid_data["cols"])
                logger.info("Column IDs: %s", grid_data["column_ids"])
                for r in grid_data["sample_rows"]:
                    logger.info("  Row %s: %s", r["row_id"], {k: v for k, v in r["cells"].items() if v not in (None, "", 0, "0")})

                # ===== Tick row 0 via dhtmlxGrid API =====
                tick = await page.evaluate(f"""
                    () => {{
                        const g = window['{grid_name}'];
                        if (!g.getRowsNum() || g.getRowsNum() < 1) return {{err: 'no rows'}};
                        const rid = g.getRowId(0);
                        const out = {{row_id: rid, tries: []}};
                        // Try various API
                        try {{
                            g.cells(rid, 0).setValue(1);
                            out.tries.push({{api: 'cells(rid,0).setValue(1)', ok: true}});
                        }} catch(e) {{ out.tries.push({{api: 'cells(rid,0).setValue(1)', err: String(e)}}); }}
                        try {{
                            g.checkRow(rid);
                            out.tries.push({{api: 'checkRow', ok: true}});
                        }} catch(e) {{ out.tries.push({{api: 'checkRow', err: String(e)}}); }}
                        try {{
                            g.selectRowById(rid);
                            out.tries.push({{api: 'selectRowById', ok: true}});
                        }} catch(e) {{ out.tries.push({{api: 'selectRowById', err: String(e)}}); }}
                        // Verify cell value
                        try {{
                            out.cell0_after = g.cells(rid, 0).getValue();
                        }} catch(e) {{}}
                        return out;
                    }}
                """)
                recon["tick_via_api"] = tick
                logger.info("Tick via dhtmlxGrid API: %s", tick)

            await page.screenshot(path="/tmp/recon_v6_ticked.png", full_page=True)

            # ===== Click #btnCreate, wait for any DOM change =====
            popup_state_before = await page.evaluate("""
                () => ({
                    iframes: document.querySelectorAll('iframe').length,
                    modals_visible: document.querySelectorAll('.modal[style*="block" i], [class*="popup"][style*="block" i], [class*="layer"][style*="block" i]').length,
                    pages: window.dialog_open || null,
                })
            """)
            logger.info("Pre-click state: %s", popup_state_before)
            n_pages_before = len(ctx.pages)

            # Click without expecting popup (since modal might be in-page)
            click_result = await page.evaluate("""
                () => {
                    const btn = document.getElementById('btnCreate');
                    if (!btn) return {err: 'no btnCreate'};
                    btn.click();
                    return {clicked: true, onclick: btn.getAttribute('onclick')};
                }
            """)
            logger.info("btnCreate click: %s", click_result)
            await page.wait_for_timeout(5000)

            # Check what changed
            popup_state_after = await page.evaluate("""
                () => {
                    const out = {
                        iframes: [],
                        modals: [],
                        layers: [],
                        all_pages_count: 1,
                        body_excerpt: document.body.innerText.slice(0, 1500),
                    };
                    document.querySelectorAll('iframe').forEach(f => {
                        out.iframes.push({id: f.id, name: f.name, src: f.src.slice(0,150), visible: f.offsetParent !== null});
                    });
                    document.querySelectorAll('[class*="modal" i], [class*="popup" i], [class*="layer" i], [class*="dialog" i]').forEach(el => {
                        if (el.offsetParent !== null) {
                            out.modals.push({
                                tag: el.tagName, id: el.id, cls: (el.className||'').slice(0,80),
                                text_preview: (el.textContent||'').trim().slice(0, 150),
                            });
                        }
                    });
                    return out;
                }
            """)
            recon["after_create_click"] = popup_state_after
            logger.info("After btnCreate: iframes=%d visible_modals=%d new_pages=%d",
                        len(popup_state_after["iframes"]), len(popup_state_after["modals"]),
                        len(ctx.pages) - n_pages_before)
            await page.screenshot(path="/tmp/recon_v6_after_create.png", full_page=True)

            # If new page opened
            if len(ctx.pages) > n_pages_before:
                popup_pg = ctx.pages[-1]
                await popup_pg.wait_for_load_state("domcontentloaded", timeout=10000)
                await popup_pg.wait_for_timeout(3000)
                popup_dump = await popup_pg.evaluate("""
                    () => ({
                        url: location.href, title: document.title,
                        inputs: Array.from(document.querySelectorAll('input,select,textarea')).map(el => ({
                            tag: el.tagName, id: el.id, name: el.name, type: el.type,
                            readonly: el.readOnly, placeholder: el.placeholder, value: (el.value||'').slice(0,50),
                            visible: el.offsetParent !== null,
                        })),
                        clickables: Array.from(document.querySelectorAll('a, button, [class*="btn"]')).map(el => ({
                            tag: el.tagName, id: el.id, text: (el.textContent||el.value||'').trim().slice(0,60),
                            cls: (el.className||'').slice(0,80), visible: el.offsetParent !== null,
                        })),
                    })
                """)
                recon["popup"] = popup_dump
                await popup_pg.screenshot(path="/tmp/recon_v6_popup_window.png", full_page=True)
                logger.info("Popup new page! url=%s inputs=%d", popup_dump["url"], len(popup_dump["inputs"]))

        except Exception as exc:
            logger.exception("recon fail")
            recon["errors"].append(str(exc))
        finally:
            recon["all_pages_seen"] = all_pages_seen
            await browser.close()

    Path("/tmp/recon_v6.json").write_text(json.dumps(recon, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("\n=== Recon v6 done ===")
    print(f"Grid found: {bool(recon.get('grid_probe', {}).get('grid_candidates'))}")
    print(f"Popup window: {bool(recon.get('popup'))}")
    print(f"Errors: {recon['errors']}")


if __name__ == "__main__":
    asyncio.run(main())
