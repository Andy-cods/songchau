"""Recon v9: drill into popup AFTER form submit to find Delivery Note button + Qty col."""
from __future__ import annotations
import asyncio, json, logging, sys
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

    DUMP_JS = """
    () => {
        const inputs = Array.from(document.querySelectorAll('input,select,textarea'))
            .filter(el => el.offsetParent !== null && (el.id || el.name))
            .map(el => ({id: el.id, name: el.name, type: el.type, value: (el.value||'').slice(0,40), readonly: el.readOnly}));
        const clickables = Array.from(document.querySelectorAll('a, button, [class*="btn"]'))
            .filter(el => el.offsetParent !== null)
            .map(el => ({tag: el.tagName, id: el.id, text: (el.textContent||el.value||'').trim().slice(0,60), cls: (el.className||'').slice(0,80), onclick: el.getAttribute('onclick')}));
        // Find all grids in this page
        const grids = [];
        for (const k of Object.keys(window)) {
            try {
                const v = window[k];
                if (v && typeof v.getColumnsNum === 'function' && typeof v.getRowsNum === 'function') {
                    const cols = v.getColumnsNum();
                    const colInfo = [];
                    for (let i = 0; i < cols; i++) {
                        try { colInfo.push({i, id: v.getColumnId(i), label: v.getColLabel ? v.getColLabel(i) : null}); } catch(e) {}
                    }
                    grids.push({name: k, rows: v.getRowsNum(), cols: cols, columns: colInfo});
                }
            } catch(e) {}
        }
        return {url: location.href, inputs, clickables, grids};
    }
    """

    recon = {"errors": []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-popup-blocking"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
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

            from_dt = (datetime.now() - timedelta(days=120)).strftime("%m/%d/%Y")
            to_dt = datetime.now().strftime("%m/%d/%Y")
            await page.evaluate(f"""
                () => {{
                    document.getElementById('srchFromDate').value = '{from_dt}';
                    document.getElementById('srchToDate').value = '{to_dt}';
                }}
            """)
            await page.fill("#srchPoNos", TEST_PO)
            await page.click("a.btn_search")
            await page.wait_for_timeout(6000)

            # Tick
            await page.evaluate("""
                () => {
                    const g = window.grid;
                    const chkIdx = g.getColumnIndex('chk');
                    const cell = g.cells(1, chkIdx);
                    const img = cell.cell.querySelector('img');
                    img.scrollIntoView({block: 'center'});
                    return img.getBoundingClientRect();
                }
            """)
            bbox = await page.evaluate("""
                () => {
                    const g = window.grid;
                    const chkIdx = g.getColumnIndex('chk');
                    const img = g.cells(1, chkIdx).cell.querySelector('img');
                    const r = img.getBoundingClientRect();
                    return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            """)
            await page.mouse.click(bbox["x"], bbox["y"])
            await page.wait_for_timeout(1000)
            logging.info("Tick done")

            # Open popup
            async with ctx.expect_page(timeout=15000) as pop_info:
                await page.evaluate("window.jQuery('#btnCreate').trigger('click')")
            popup = await pop_info.value
            await popup.wait_for_load_state("domcontentloaded", timeout=20000)
            await popup.wait_for_timeout(4000)
            logging.info("Popup opened: %s", popup.url)

            # === STAGE A: Popup INITIAL state ===
            recon["popup_initial"] = await popup.evaluate(DUMP_JS)
            await popup.screenshot(path="/tmp/v9_popup_initial.png", full_page=True)
            logging.info("Popup initial — %d inputs, %d clickables, %d grids",
                         len(recon["popup_initial"]["inputs"]),
                         len(recon["popup_initial"]["clickables"]),
                         len(recon["popup_initial"]["grids"]))

            # Fill popup form
            await popup.evaluate(f"""
                () => {{
                    document.getElementById('civNo').value = '{datetime.now().strftime("%d%m%Y")}-X9';
                    document.getElementById('civNo').dispatchEvent(new Event('change',{{bubbles:true}}));
                    document.getElementById('packingQty').value = '1';
                    document.getElementById('volume').value = '0.001';
                    document.getElementById('grossWeight').value = '1.0';
                    document.getElementById('remark').value = 'recon v9';
                }}
            """)
            await popup.wait_for_timeout(1000)

            # Fill Shipping Qty in popup grid via dhtmlxGrid
            qty_dump = await popup.evaluate(f"""
                (po_qty) => {{
                    const grids = [];
                    for (const k of Object.keys(window)) {{
                        try {{
                            const v = window[k];
                            if (v && typeof v.getColumnsNum === 'function' && typeof v.getRowsNum === 'function' && v.getRowsNum() > 0) {{
                                const cols = v.getColumnsNum();
                                const colInfo = [];
                                for (let i = 0; i < cols; i++) {{
                                    try {{ colInfo.push({{i, id: v.getColumnId(i), label: v.getColLabel ? v.getColLabel(i) : null}}); }} catch(e) {{}}
                                }}
                                grids.push({{name: k, rows: v.getRowsNum(), cols: cols, columns: colInfo}});
                            }}
                        }} catch(e) {{}}
                    }}
                    // Try to find shipping qty col
                    let result = {{grids, attempts: []}};
                    for (const gi of grids) {{
                        const g = window[gi.name];
                        if (!g) continue;
                        const shipIdx = g.getColumnIndex('shippingQty');
                        if (shipIdx >= 0) {{
                            try {{
                                const rid = g.getRowId(0);
                                g.cells(rid, shipIdx).setValue('{1}');
                                result.attempts.push({{grid: gi.name, shipIdx, ok: true}});
                            }} catch(e) {{ result.attempts.push({{grid: gi.name, err: String(e)}}); }}
                        }}
                    }}
                    return result;
                }}
            """, 1)
            recon["qty_fill"] = qty_dump
            logging.info("Qty fill: %s", qty_dump)

            await popup.screenshot(path="/tmp/v9_popup_filled.png", full_page=True)

            # === STAGE B: Submit Create Delivery ===
            logging.info("Submitting...")
            # Find the Create Delivery button in popup (avoid Close button)
            submit_btn = await popup.evaluate("""
                () => {
                    const btns = Array.from(document.querySelectorAll('a, button, [class*="btn"]'));
                    for (const b of btns) {
                        const txt = (b.textContent || b.value || '').trim();
                        if (txt === 'Create Delivery' && b.offsetParent !== null) {
                            return {id: b.id, cls: b.className, text: txt, onclick: b.getAttribute('onclick')};
                        }
                    }
                    return null;
                }
            """)
            logging.info("Submit btn: %s", submit_btn)

            await popup.evaluate("""
                () => {
                    const btns = Array.from(document.querySelectorAll('a, button, [class*="btn"]'));
                    for (const b of btns) {
                        const txt = (b.textContent || b.value || '').trim();
                        if (txt === 'Create Delivery' && b.offsetParent !== null) {
                            if (typeof window.jQuery !== 'undefined') {
                                window.jQuery(b).trigger('click');
                            } else {
                                b.click();
                            }
                            return true;
                        }
                    }
                    return false;
                }
            """)
            await popup.wait_for_timeout(8000)  # wait for submit response + UI update

            # === STAGE C: Popup AFTER submit ===
            recon["popup_after_submit"] = await popup.evaluate(DUMP_JS)
            await popup.screenshot(path="/tmp/v9_popup_after_submit.png", full_page=True)
            logging.info("After submit — %d inputs, %d clickables",
                         len(recon["popup_after_submit"]["inputs"]),
                         len(recon["popup_after_submit"]["clickables"]))

            # Find "Delivery Note" anything
            dn_search = await popup.evaluate("""
                () => {
                    const out = [];
                    document.querySelectorAll('*').forEach(el => {
                        const txt = (el.textContent || '').trim();
                        const oc = el.getAttribute('onclick') || '';
                        if ((txt.includes('Delivery Note') || oc.toLowerCase().includes('deliverynote') ||
                             oc.toLowerCase().includes('delivnote') || oc.toLowerCase().includes('printdelivery'))
                            && el.children.length < 5) {
                            out.push({
                                tag: el.tagName, id: el.id, cls: (el.className||'').slice(0,80),
                                text: txt.slice(0, 60), onclick: oc.slice(0, 200),
                                visible: el.offsetParent !== null,
                            });
                        }
                    });
                    return out;
                }
            """)
            recon["delivery_note_candidates"] = dn_search
            logging.info("Delivery Note candidates: %s", dn_search)

        except Exception as exc:
            logging.exception("recon fail")
            recon["errors"].append(str(exc))
        finally:
            await browser.close()

    Path("/tmp/recon_v9.json").write_text(json.dumps(recon, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("\n=== Recon v9 done ===")
    print(f"Errors: {recon['errors']}")


if __name__ == "__main__":
    asyncio.run(main())
