"""Recon round 7: probe IBSheet variable name + data extraction approach.

Output: /tmp/recon_mro_ib/probe.json
"""
from __future__ import annotations
import asyncio, json, logging, os, sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/tmp/recon_mro_ib"); OUT.mkdir(parents=True, exist_ok=True)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("recon_mro_ib")

USER = os.environ.get("BQMS_USERNAME") or ""
PASS = os.environ.get("BQMS_PASSWORD") or ""
BASE = os.environ.get("BQMS_BASE_URL") or "https://www.sec-bqms.com"
if not USER or not PASS:
    sys.path.insert(0, "/app")
    from app.core.config import settings
    USER = USER or settings.BQMS_USERNAME or ""
    PASS = PASS or settings.BQMS_PASSWORD or ""
    BASE = BASE or settings.BQMS_BASE_URL or "https://www.sec-bqms.com"


async def main() -> None:
    from playwright.async_api import async_playwright
    out: dict = {"started_at": datetime.now(timezone.utc).isoformat()}

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True, args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, locale="en-US")
        page = await ctx.new_page()

        await page.goto(f"{BASE}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
                        wait_until="domcontentloaded", timeout=30_000)
        await page.fill("input#id", USER)
        await page.fill("input#pass", PASS)
        await page.evaluate("login()")
        try:
            await page.wait_for_url(lambda u: "anonymous" not in u and "login" not in u.lower(), timeout=30_000)
        except Exception: pass
        log.info("login OK")

        await page.evaluate("selectLeftMenu(20, 20, true)")
        await asyncio.sleep(8)
        log.info("MRO list URL: %s", page.url)
        out["list_url"] = page.url

        # Probe global variable names
        probe = await page.evaluate(
            """() => {
                const result = { globals: [], window_keys_with_sheet: [] };
                // IBSheet usually exposes the sheet on window — common names
                const candidates = ['mySheet', 'oSheet', 'sheet1', 'sheet', 'IBS_Sheet1', 'sheetMain'];
                for (const name of candidates) {
                    if (typeof window[name] !== 'undefined') {
                        const obj = window[name];
                        result.globals.push({
                            name,
                            type: typeof obj,
                            has_GetTotalRows: typeof obj.GetTotalRows === 'function',
                            has_getRowCount: typeof obj.getRowCount === 'function',
                            has_GetCellValue: typeof obj.GetCellValue === 'function',
                            has_cells: typeof obj.cells === 'function',
                        });
                    }
                }
                // List all top-level keys whose name contains 'sheet' or 'Sheet' or 'IBS'
                for (const k of Object.keys(window)) {
                    if (/sheet|Sheet|IBS/i.test(k) && !/Object|String|Number|JSON/.test(k)) {
                        try {
                            const v = window[k];
                            const t = typeof v;
                            if (t === 'object' && v !== null) {
                                result.window_keys_with_sheet.push({
                                    name: k,
                                    has_GetTotalRows: typeof v.GetTotalRows === 'function',
                                    has_GetCellValue: typeof v.GetCellValue === 'function',
                                    has_cells: typeof v.cells === 'function',
                                });
                            }
                        } catch (e) {}
                    }
                }
                return result;
            }"""
        )
        out["probe"] = probe
        log.info("probe: %s", json.dumps(probe))

        # If we found a sheet with GetTotalRows, try extracting first 3 rows
        for cand in (probe.get("globals", []) + probe.get("window_keys_with_sheet", [])):
            if cand.get("has_GetTotalRows") and cand.get("has_GetCellValue"):
                name = cand["name"]
                log.info("trying GetTotalRows on %s", name)
                rows = await page.evaluate(
                    """(name) => {
                        const s = window[name];
                        const total = s.GetTotalRows();
                        const cols = ['PO_NO','PO_SEQ','REQ_NO','REQ_SEQ','PO_CONFIRM_DT',
                                      'SP_NAME','PURCHASER_NAME','SPECIFICATION','MANUFACTURER',
                                      'MODEL_NO','ITEM_CODE','OLD_ITEM_CODE','PO_QTY',
                                      'BUYING_PRICE','BUYING_AMOUNT','BUYING_CURRENCY'];
                        const out = { total, sample: [] };
                        for (let i = 1; i <= Math.min(3, total); i++) {
                            const row = {};
                            for (const c of cols) {
                                try { row[c] = s.GetCellValue(i, c); } catch (e) { row[c] = '_err'; }
                            }
                            out.sample.push(row);
                        }
                        return out;
                    }""",
                    name,
                )
                out[f"sample_via_{name}"] = rows
                log.info("rows via %s: total=%d, sample=%s", name, rows.get("total"), json.dumps(rows.get("sample"))[:500])
                break
            if cand.get("has_cells"):
                # Try old IBSheet API: cells(row, colIndex).getValue()
                name = cand["name"]
                log.info("trying cells() API on %s", name)
                rows = await page.evaluate(
                    """(name) => {
                        const s = window[name];
                        const colByName = (n) => {
                            try { return s.getColIndexById ? s.getColIndexById(n) : -1; } catch (e) { return -2; }
                        };
                        const total = (typeof s.getRowCount === 'function') ? s.getRowCount() :
                                      (typeof s.getRowsCount === 'function') ? s.getRowsCount() : -1;
                        const cols = ['PO_NO','REQ_NO','SP_NAME','SPECIFICATION','ITEM_CODE','PO_QTY','BUYING_PRICE'];
                        const out = { total, sample: [], col_indices: {} };
                        cols.forEach(c => out.col_indices[c] = colByName(c));
                        return out;
                    }""",
                    name,
                )
                out[f"sample_via_{name}_cells"] = rows
                log.info("via cells %s: %s", name, json.dumps(rows)[:400])

        # Also dump a screenshot to verify rows are visible
        await page.screenshot(path=str(OUT / "mro_list.png"), full_page=True)
        await browser.close()

    out["finished_at"] = datetime.now(timezone.utc).isoformat()
    (OUT / "probe.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
    log.info("DONE")


if __name__ == "__main__":
    asyncio.run(main())
