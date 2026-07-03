"""Recon v7: precise dhtmlxGrid tick + inspect modals after btnCreate."""
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
        ctx.on("page", lambda pg: logger.info("New page opened: %s", pg.url))

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
                    const f = document.getElementById('srchFromDate');
                    const t = document.getElementById('srchToDate');
                    if (f) {{ f.value = '{from_dt}'; f.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                    if (t) {{ t.value = '{to_dt}'; t.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                }}
            """)
            await page.fill("#srchPoNos", TEST_PO)
            await page.click("a.btn_search")
            await page.wait_for_timeout(6000)

            # === Tick row 0 with all dhtmlxGrid methods + DOM click ===
            tick_result = await page.evaluate("""
                () => {
                    const g = window.globalActiveDHTMLGridObject;
                    if (!g) return {err: 'no grid'};
                    const rid = g.getRowId(0);
                    const out = {row_id: rid, attempts: [], cell_value_history: []};

                    // Attempt 1: dhtmlxGrid setValue
                    try {
                        g.cells(rid, 0).setValue(1);
                        out.cell_value_history.push({step: 'setValue(1)', val: g.cells(rid, 0).getValue()});
                    } catch(e) { out.attempts.push({api: 'setValue', err: String(e)}); }

                    // Attempt 2: setCellValue with chk-style cType
                    try {
                        if (g.cellMatrix && g.cellMatrix[rid]) {
                            const cellObj = g.cellMatrix[rid][0];
                            if (cellObj && cellObj.cell && cellObj.cell.querySelector) {
                                const cb = cellObj.cell.querySelector('input[type=checkbox]');
                                if (cb) {
                                    cb.checked = true;
                                    cb.click();
                                    out.attempts.push({api: 'cell-checkbox-click', ok: true});
                                }
                            }
                        }
                    } catch(e) { out.attempts.push({api: 'cell-checkbox', err: String(e)}); }

                    // Attempt 3: programmatic dhtmlxGrid event
                    try {
                        if (g.callEvent) {
                            g.callEvent('onCheck', [rid, 0, true]);
                            out.attempts.push({api: 'callEvent onCheck', ok: true});
                        }
                    } catch(e) { out.attempts.push({api: 'callEvent', err: String(e)}); }

                    // Attempt 4: find ACTUAL checkbox in cell DOM
                    try {
                        const row = g.getRowAttribute ? g.getRowAttribute(rid, '_obj') : null;
                        // Or via DOM: find TR with rid attribute
                        const tr = document.querySelector(`tr[idd="${rid}"]`);
                        if (tr) {
                            // First TD usually contains checkbox
                            const td0 = tr.querySelector('td');
                            out.tr_first_td_html = td0 ? td0.outerHTML.slice(0, 500) : null;
                            if (td0) {
                                // Look for span/div with check-like styling
                                const chk = td0.querySelector('input[type=checkbox], span.dhx_chk, span.dhx_chk_no');
                                if (chk) {
                                    chk.click();
                                    out.attempts.push({api: 'tr-td-chk-click', ok: true, chk_tag: chk.tagName, chk_cls: chk.className});
                                }
                            }
                        }
                    } catch(e) { out.attempts.push({api: 'tr-td-search', err: String(e)}); }

                    // Final cell value
                    try {
                        out.cell_value_history.push({step: 'final', val: g.cells(rid, 0).getValue()});
                    } catch(e) {}
                    return out;
                }
            """)
            recon["tick_result"] = tick_result
            logger.info("Tick result: %s", json.dumps(tick_result, default=str)[:1000])

            await page.screenshot(path="/tmp/recon_v7_ticked.png", full_page=True)

            # Click btnCreate
            n_before = len(ctx.pages)
            await page.click("a#btnCreate")
            await page.wait_for_timeout(7000)
            logger.info("After click: pages=%d→%d", n_before, len(ctx.pages))

            # If new page opened
            if len(ctx.pages) > n_before:
                pop_pg = ctx.pages[-1]
                await pop_pg.wait_for_load_state("domcontentloaded", timeout=10000)
                await pop_pg.wait_for_timeout(3000)
                popup_dump = await pop_pg.evaluate("""
                    () => {
                        const out = {url: location.href, title: document.title, inputs: [], clickables: [], grid_candidates: []};
                        document.querySelectorAll('input,select,textarea').forEach(el => {
                            if (el.type === 'hidden') return;
                            out.inputs.push({
                                tag: el.tagName, id: el.id, name: el.name, type: el.type,
                                readonly: el.readOnly, placeholder: el.placeholder,
                                value: (el.value||'').slice(0,50),
                                visible: el.offsetParent !== null,
                            });
                        });
                        document.querySelectorAll('a, button, [class*="btn"]').forEach(el => {
                            const txt = (el.textContent||el.value||'').trim().slice(0,60);
                            if (txt || el.id) out.clickables.push({
                                tag: el.tagName, id: el.id, text: txt,
                                cls: (el.className||'').slice(0,80),
                                onclick: el.getAttribute('onclick'),
                                visible: el.offsetParent !== null,
                            });
                        });
                        // Grid probe
                        for (const k of Object.keys(window)) {
                            try {
                                const v = window[k];
                                if (v && typeof v === 'object' && typeof v.getRowsNum === 'function') {
                                    out.grid_candidates.push({name: k, rows: v.getRowsNum(), cols: v.getColumnsNum ? v.getColumnsNum() : null});
                                }
                            } catch(e) {}
                        }
                        return out;
                    }
                """)
                recon["popup"] = popup_dump
                logger.info("POPUP url=%s inputs=%d clickables=%d grids=%d",
                            popup_dump["url"], len(popup_dump["inputs"]), len(popup_dump["clickables"]), len(popup_dump["grid_candidates"]))
                # Print visible clickables
                for c in popup_dump["clickables"][:30]:
                    if c.get("visible") and c.get("text"):
                        logger.info("  click: %s id=%s text=%s", c["tag"], c["id"], c["text"][:50])
                await pop_pg.screenshot(path="/tmp/recon_v7_popup.png", full_page=True)
            else:
                # In-page modal? dump visible modals/layers
                modal_dump = await page.evaluate("""
                    () => {
                        const out = {visible_layers: [], inputs_after_create: []};
                        document.querySelectorAll('[class*="layer"], [class*="modal"], [class*="popup"], [class*="dialog"]').forEach(el => {
                            if (el.offsetParent === null) return;
                            out.visible_layers.push({
                                tag: el.tagName, id: el.id,
                                cls: (el.className||'').slice(0,80),
                                text: (el.textContent||'').trim().slice(0,400),
                                inputs_inside: el.querySelectorAll('input,select,textarea').length,
                            });
                        });
                        document.querySelectorAll('input,select,textarea').forEach(el => {
                            if (el.offsetParent === null) return;
                            out.inputs_after_create.push({
                                id: el.id, name: el.name, type: el.type,
                                placeholder: el.placeholder, value: (el.value||'').slice(0,50),
                            });
                        });
                        return out;
                    }
                """)
                recon["in_page_modal"] = modal_dump
                logger.info("In-page modal: visible_layers=%d, inputs_visible=%d",
                            len(modal_dump["visible_layers"]), len(modal_dump["inputs_after_create"]))
                for L in modal_dump["visible_layers"]:
                    if L["inputs_inside"] > 0 or L["text"]:
                        logger.info("  layer %s cls=%s inputs=%d text=%s",
                                    L["tag"], L["cls"][:50], L["inputs_inside"], L["text"][:200])

            await page.screenshot(path="/tmp/recon_v7_after_create.png", full_page=True)

        except Exception as exc:
            logger.exception("recon fail")
            recon["errors"].append(str(exc))
        finally:
            await browser.close()

    Path("/tmp/recon_v7.json").write_text(json.dumps(recon, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("\n=== Recon v7 done ===")
    print(f"Errors: {recon['errors']}")


if __name__ == "__main__":
    asyncio.run(main())
