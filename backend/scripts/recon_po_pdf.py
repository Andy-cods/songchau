"""Recon for Phase H — PO PDF download.

Independent test: login → P/O Receipt page → search → pick FIRST PO in grid →
click anchor → wait for attachFilePop popup → inspect DOM + try download.

Run inside sc-worker container:
  docker exec -w /app sc-worker python /app/recon_po_pdf.py
"""
from __future__ import annotations
import asyncio
import json
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


async def main():
    sys.path.insert(0, "/app")
    from playwright.async_api import async_playwright
    from app.core.config import settings

    base = (settings.BQMS_BASE_URL or "https://www.sec-bqms.com").rstrip("/")
    user, pwd = settings.BQMS_USERNAME, settings.BQMS_PASSWORD

    work_dir = Path("/tmp/recon_po_pdf")
    work_dir.mkdir(parents=True, exist_ok=True)

    recon = {"errors": [], "screenshots": []}

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-popup-blocking"],
        )
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)

        # Auto-accept dialogs
        ctx.on("page", lambda p: p.on("dialog", lambda d: asyncio.create_task(d.accept())))

        page = await ctx.new_page()
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))

        try:
            # Login
            await page.goto(f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true", timeout=30000)
            await page.fill("input#id", user)
            await page.fill("input#pass", pwd)
            await page.evaluate("login()")
            await page.wait_for_url(lambda u: "anonymous" not in u and "login" not in u.lower(), timeout=30000)
            logging.info("Login OK")

            # Goto P/O Receipt page
            await page.goto(
                f"{base}/bqms/mro/forward/vendor/vendorPoConfirm.do?target=vendor",
                wait_until="networkidle", timeout=45000,
            )
            await page.wait_for_timeout(3000)
            await page.screenshot(path=str(work_dir / "01_po_receipt_loaded.png"), full_page=True)

            # === STAGE A: Dump filter DOM ===
            filter_dom = await page.evaluate("""
                () => {
                    const inputs = Array.from(document.querySelectorAll('input,select,textarea'))
                        .filter(el => el.offsetParent !== null && (el.id || el.name))
                        .map(el => ({
                            id: el.id, name: el.name, type: el.type, tag: el.tagName,
                            value: (el.value||'').slice(0,40), readonly: el.readOnly,
                            options: el.tagName === 'SELECT'
                                ? Array.from(el.options).map(o => ({val: o.value, txt: (o.textContent||'').trim()}))
                                : null,
                        }));
                    return inputs;
                }
            """)
            recon["filter_dom"] = filter_dom
            logging.info("Filter DOM: %s", json.dumps(filter_dom, ensure_ascii=False, indent=2)[:2000])

            # === STAGE B: Set wide date range + reset Status to ALL ===
            from_dt = (datetime.now() - timedelta(days=365)).strftime("%m/%d/%Y")
            to_dt = datetime.now().strftime("%m/%d/%Y")
            await page.evaluate(f"""
                () => {{
                    const f = document.getElementById('srchFromDate') || document.getElementById('srchFromDt');
                    const t = document.getElementById('srchToDate') || document.getElementById('srchToDt');
                    if (f) {{ f.value = '{from_dt}'; f.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                    if (t) {{ t.value = '{to_dt}'; t.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                }}
            """)
            # Reset Status — find select with "Not Confirm"-like default
            reset_result = await page.evaluate("""
                () => {
                    const selects = document.querySelectorAll('select');
                    const out = [];
                    for (const sel of selects) {
                        if (sel.offsetParent === null) continue;
                        const opts = Array.from(sel.options).map(o => ({val: o.value, txt: (o.textContent||'').trim()}));
                        out.push({id: sel.id, name: sel.name, current: sel.value, options: opts});
                        // If this select has "ALL" / empty option, switch to it
                        const allOpt = opts.find(o => /all/i.test(o.txt) || o.val === '');
                        if (allOpt && opts.some(o => /confirm/i.test(o.txt))) {
                            sel.value = allOpt.val;
                            sel.dispatchEvent(new Event('change', {bubbles: true}));
                            out[out.length - 1].changed_to = allOpt.val;
                        }
                    }
                    return out;
                }
            """)
            recon["selects"] = reset_result
            logging.info("Selects: %s", json.dumps(reset_result, ensure_ascii=False, indent=2)[:2000])

            # === STAGE C: Click search (no PO filter — show all) ===
            await page.locator("a.btn_search").first.click()
            await page.wait_for_timeout(6000)
            await page.screenshot(path=str(work_dir / "02_search_all_pos.png"), full_page=True)

            # === STAGE D: Dump grid state ===
            grid_state = await page.evaluate("""
                () => {
                    let result = {grids: []};
                    for (const k of Object.keys(window)) {
                        try {
                            const v = window[k];
                            if (v && typeof v.getColumnsNum === 'function' &&
                                typeof v.getRowsNum === 'function' && v.getRowsNum() > 0) {
                                const cols = v.getColumnsNum();
                                const colInfo = [];
                                for (let i = 0; i < cols; i++) {
                                    try { colInfo.push({i, id: v.getColumnId(i), label: v.getColLabel ? v.getColLabel(i) : null}); } catch(e) {}
                                }
                                // Sample first 3 rows
                                const sample = [];
                                const total = v.getRowsNum();
                                for (let r = 0; r < Math.min(3, total); r++) {
                                    const rid = v.getRowId(r);
                                    const row = {rid};
                                    for (const ci of colInfo) {
                                        try { row[ci.id] = String(v.cells(rid, ci.i).getValue() || '').slice(0, 60); } catch(e) {}
                                    }
                                    sample.push(row);
                                }
                                result.grids.push({name: k, rows: total, cols: cols, columns: colInfo, sample});
                            }
                        } catch(e) {}
                    }
                    return result;
                }
            """)
            recon["grid_state"] = grid_state
            logging.info("Grid state: %s", json.dumps(grid_state, ensure_ascii=False, indent=2)[:3000])

            if not grid_state["grids"]:
                recon["errors"].append("No grid with rows found")
                Path("/tmp/recon_po_pdf.json").write_text(
                    json.dumps(recon, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
                )
                return

            # === STAGE E: Click first PO's P/O No anchor → expect popup ===
            grid = grid_state["grids"][0]
            grid_var = grid["name"]
            sample_rid = grid["sample"][0]["rid"]
            # Column ID is PO_NO (uppercase) on vendorPoConfirm.do (different from Register Delivery)
            po_col = next((c["i"] for c in grid["columns"]
                           if c["id"] in ("PO_NO", "poNo", "PoNo", "poNumber")), -1)
            sample_po = grid["sample"][0].get("PO_NO") or grid["sample"][0].get("poNo") or "?"
            logging.info("Will click PO=%s rid=%s grid=%s po_col=%d", sample_po, sample_rid, grid_var, po_col)
            if po_col < 0:
                recon["errors"].append(f"No PO_NO column found in grid (cols: {[c['id'] for c in grid['columns'][:30]]})")
                Path("/tmp/recon_po_pdf.json").write_text(
                    json.dumps(recon, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
                )
                return

            po_popup = None
            try:
                async with ctx.expect_page(timeout=20000) as pop_info:
                    click_result = await page.evaluate(f"""
                        () => {{
                            const g = window['{grid_var}'];
                            const cell = g.cells({sample_rid}, {po_col});
                            if (!cell || !cell.cell) return null;
                            const a = cell.cell.querySelector('a');
                            const tgt = a || cell.cell;
                            tgt.scrollIntoView({{block: 'center'}});
                            if (typeof window.jQuery !== 'undefined') {{
                                window.jQuery(tgt).trigger('click');
                            }} else {{ tgt.click(); }}
                            return {{tag: tgt.tagName, hasAnchor: !!a, text: (tgt.textContent||'').slice(0,40)}};
                        }}
                    """)
                    logging.info("Click result: %s", click_result)
                    recon["click_first_po"] = click_result
                po_popup = await pop_info.value
                await po_popup.wait_for_load_state("domcontentloaded", timeout=15000)
                await po_popup.wait_for_timeout(3000)
                recon["popup_url"] = po_popup.url
                logging.info("Popup opened: %s", po_popup.url)
                await po_popup.screenshot(path=str(work_dir / "03_attachfile_popup.png"), full_page=True)
            except Exception as exc:
                recon["errors"].append(f"Popup not open: {exc}")
                logging.exception("popup fail")

            if po_popup:
                # Wait for DEXTX5 download button
                try:
                    await po_popup.wait_for_selector(
                        "a[id^='downloadDEXTX5_']", state="visible", timeout=20000,
                    )
                except Exception as exc:
                    logging.warning("DEXTX5 btn not ready: %s", exc)

                await po_popup.screenshot(path=str(work_dir / "04_attachfile_rendered.png"), full_page=True)

                # === Strategy V2: register response listener BEFORE click ===
                captured = {"pdf_bytes": None, "url": None}
                pdf_event = asyncio.Event()

                async def _on_resp(resp):
                    if captured["pdf_bytes"]:
                        return
                    try:
                        url = resp.url
                        ct = (resp.headers.get("content-type") or "").lower()
                        cd = (resp.headers.get("content-disposition") or "").lower()
                        if "pdf" in ct or ".pdf" in cd or url.lower().endswith(".pdf"):
                            logging.info("Candidate PDF response: %s (ct=%s, cd=%s)", url[:120], ct, cd)
                            try:
                                body = await resp.body()
                                if body and len(body) > 1024 and body[:4] == b"%PDF":
                                    captured["pdf_bytes"] = body
                                    captured["url"] = url
                                    pdf_event.set()
                            except Exception as exc:
                                logging.warning("read body fail: %s", exc)
                    except Exception:
                        pass

                # Also log ALL response URLs after click for debug
                all_urls = []
                def _log_url(resp):
                    try:
                        all_urls.append({
                            "url": resp.url[:200],
                            "status": resp.status,
                            "ct": resp.headers.get("content-type", "")[:80],
                            "cd": resp.headers.get("content-disposition", "")[:100],
                        })
                    except Exception:
                        pass

                po_popup.on("response", lambda r: asyncio.create_task(_on_resp(r)))
                po_popup.on("response", _log_url)

                # Click Download All button
                try:
                    click_result = await po_popup.evaluate("""
                        () => {
                            const btn = document.querySelector("a[id^='downloadDEXTX5_']");
                            if (!btn) return {err: 'no btn'};
                            if (typeof window.jQuery !== 'undefined') {
                                window.jQuery(btn).trigger('click');
                            } else { btn.click(); }
                            return {id: btn.id, onclick: btn.getAttribute('onclick')};
                        }
                    """)
                    logging.info("Click Download All: %s", click_result)
                except Exception as exc:
                    logging.warning("click failed: %s", exc)

                # Wait for PDF response
                try:
                    await asyncio.wait_for(pdf_event.wait(), timeout=25.0)
                except asyncio.TimeoutError:
                    logging.warning("No PDF in 25s")

                # Dump all URLs seen for debug
                recon["responses_after_click"] = all_urls[-20:]
                logging.info("Last 10 response URLs: %s", json.dumps(all_urls[-10:], indent=2)[:3000])

                if captured["pdf_bytes"]:
                    save_path = work_dir / "downloaded_po.pdf"
                    save_path.write_bytes(captured["pdf_bytes"])
                    recon["download_success"] = {
                        "url": captured["url"][:200], "size": len(captured["pdf_bytes"]),
                        "path": str(save_path),
                    }
                    logging.info("✓ PDF saved: %d bytes from %s", len(captured["pdf_bytes"]), captured["url"])
                else:
                    recon["errors"].append("No PDF response captured after click")

        except Exception as exc:
            logging.exception("recon top fail")
            recon["errors"].append(f"top: {exc}")
        finally:
            await browser.close()

    Path("/tmp/recon_po_pdf.json").write_text(
        json.dumps(recon, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    print("\n=== Recon done. Output: /tmp/recon_po_pdf.json ===")
    print(f"Errors: {recon.get('errors', [])}")
    print(f"Popup URL: {recon.get('popup_url')}")
    print(f"Download: {recon.get('download_success')}")


if __name__ == "__main__":
    asyncio.run(main())
