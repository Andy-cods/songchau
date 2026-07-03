"""Reconnaissance: dump DOM of Samsung BQMS Register Delivery + Create Delivery popup.

Goal: identify EXACT selector IDs / JS function names needed for the dossier
scraper. Output saved to `/tmp/recon_register_delivery.json`.

Steps:
  1. Login (reuse pattern from bqms_mro_scraper)
  2. Navigate to Register Delivery (/bqms/mro/forward/vendor/grCreateDelivery.do)
  3. Dump:
     - All input/select/button IDs + names
     - Visible JS functions (window.search, window.createDelivery, etc.)
     - Grid column structure (dhtmlXGrid API)
  4. Search with a known-recent PO (auto-pick from bqms_samsung_po), tick row,
     trigger Create Delivery → wait for popup
  5. Dump popup DOM (inputs, grids, submit anchor)
  6. Wait for `Delivery Note` button visibility (after submit) — dump its href/onclick

Run on VPS:
    docker exec sc-api python /app/scripts/recon_register_delivery.py
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Setup minimal logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def main(test_po_no: str | None = None):
    sys.path.insert(0, "/app")
    from playwright.async_api import async_playwright
    from app.core.config import settings

    base = (settings.BQMS_BASE_URL or "https://www.sec-bqms.com").rstrip("/")
    user = settings.BQMS_USERNAME
    pwd = settings.BQMS_PASSWORD
    if not user or not pwd:
        raise RuntimeError("BQMS_USERNAME / BQMS_PASSWORD missing in settings")

    # Look up 1 recent PO from DB if not provided
    if not test_po_no:
        import asyncpg
        db_url = str(settings.DATABASE_URL).replace("postgresql+asyncpg", "postgresql").replace("+asyncpg", "")
        c = await asyncpg.connect(db_url)
        row = await c.fetchrow(
            "SELECT po_number FROM bqms_samsung_po WHERE po_number IS NOT NULL "
            "ORDER BY po_date DESC NULLS LAST LIMIT 1"
        )
        await c.close()
        test_po_no = row["po_number"] if row else None
    if not test_po_no:
        logger.warning("No test PO provided — will only recon list page (skip popup)")

    logger.info("Test PO No: %s", test_po_no)

    recon: dict = {
        "started_at": datetime.utcnow().isoformat(),
        "base": base,
        "test_po_no": test_po_no,
        "list_page": {},
        "popup_page": {},
        "errors": [],
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        page.on("console", lambda m: logger.debug("PAGE %s: %s", m.type, m.text))
        # Auto-accept dialogs (in case any confirm() pops)
        page.on("dialog", lambda d: asyncio.create_task(d.accept()))

        try:
            # ---- LOGIN
            logger.info("Login...")
            await page.goto(
                f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
                wait_until="domcontentloaded",
                timeout=30000,
            )
            await page.fill("input#id", user)
            await page.fill("input#pass", pwd)
            await page.evaluate("login()")
            await page.wait_for_url(
                lambda u: "anonymous" not in u and "login" not in u.lower(),
                timeout=30000,
            )
            logger.info("Login OK, url=%s", page.url)

            # ---- NAVIGATE TO REGISTER DELIVERY
            logger.info("Navigate to Register Delivery...")
            target_url = f"{base}/bqms/mro/forward/vendor/grCreateDelivery.do?target=vendor"
            await page.goto(target_url, wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(2000)
            logger.info("List page loaded: %s", page.url)

            # Dump all input/select/button visible elements with id + name + placeholder
            list_dump = await page.evaluate("""
            () => {
                const out = {
                    title: document.title,
                    url: location.href,
                    inputs: [],
                    selects: [],
                    buttons: [],
                    anchors_with_onclick: [],
                    grid_info: null,
                };
                document.querySelectorAll('input').forEach(el => {
                    if (el.offsetParent !== null || el.type === 'hidden') {
                        out.inputs.push({
                            id: el.id, name: el.name, type: el.type,
                            placeholder: el.placeholder,
                            value_preview: (el.value||'').slice(0,40),
                            visible: el.offsetParent !== null,
                        });
                    }
                });
                document.querySelectorAll('select').forEach(el => {
                    out.selects.push({
                        id: el.id, name: el.name,
                        options: Array.from(el.options).slice(0,8).map(o => ({v: o.value, t: o.text}))
                    });
                });
                document.querySelectorAll('button, input[type=button], input[type=submit]').forEach(el => {
                    out.buttons.push({
                        id: el.id, type: el.type, text: (el.textContent||el.value||'').trim().slice(0,40),
                        onclick: el.getAttribute('onclick'),
                    });
                });
                document.querySelectorAll('a[onclick]').forEach(a => {
                    out.anchors_with_onclick.push({
                        text: (a.textContent||'').trim().slice(0,40),
                        onclick: a.getAttribute('onclick'),
                        href: a.href.slice(0, 200),
                    });
                });
                // dhtmlXGridObject probe
                if (typeof window.Grid !== 'undefined' || typeof window.gridObj !== 'undefined') {
                    const g = window.Grid || window.gridObj;
                    try {
                        const colCount = g.getColumnsNum ? g.getColumnsNum() : null;
                        const cols = [];
                        if (colCount) {
                            for (let i = 0; i < colCount; i++) {
                                cols.push({
                                    idx: i,
                                    id: g.getColumnId ? g.getColumnId(i) : null,
                                    label: g.getColLabel ? g.getColLabel(i) : null,
                                });
                            }
                        }
                        out.grid_info = {
                            grid_var: window.Grid ? 'Grid' : 'gridObj',
                            colCount: colCount,
                            rowsNum: g.getRowsNum ? g.getRowsNum() : null,
                            columns: cols,
                        };
                    } catch (e) { out.grid_info = {error: e.toString()}; }
                }
                return out;
            }
            """)
            recon["list_page"] = list_dump
            logger.info("List page dumped: %d inputs / %d buttons / grid=%s",
                        len(list_dump["inputs"]), len(list_dump["buttons"]),
                        bool(list_dump.get("grid_info")))

            # ---- SEARCH WITH TEST PO
            if test_po_no:
                logger.info("Searching with PO No: %s", test_po_no)
                # Try filling the PO No input (heuristic: input with id/name containing 'po')
                # Use the first match
                po_input_selectors = [
                    "input#poNo", "input#poNoSrch", "input[name='poNo']",
                    "input[id*='poNo' i]", "input[placeholder*='PO' i]",
                ]
                filled = False
                for sel in po_input_selectors:
                    try:
                        if await page.locator(sel).count() > 0:
                            await page.fill(sel, test_po_no)
                            filled = True
                            recon["list_page"]["po_input_used"] = sel
                            break
                    except Exception:
                        pass
                if not filled:
                    recon["errors"].append("Could not find PO No input — see list_page.inputs")

                # Set date range — 60 days back
                from_dt = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")
                date_set_attempts = await page.evaluate(f"""
                () => {{
                    const out = [];
                    document.querySelectorAll('input').forEach(el => {{
                        const id = (el.id||'').toLowerCase();
                        const name = (el.name||'').toLowerCase();
                        if (id.includes('from') || id.includes('srchfrom') || name.includes('from')) {{
                            el.value = '{from_dt}';
                            out.push({{set: el.id || el.name, to: '{from_dt}'}});
                        }}
                    }});
                    return out;
                }}
                """)
                recon["list_page"]["date_set"] = date_set_attempts

                # Trigger search
                searched = False
                for trigger in ["search()", "fnSearch()", "doSearch()", "btnSearch()"]:
                    try:
                        await page.evaluate(trigger)
                        searched = True
                        recon["list_page"]["search_trigger"] = trigger
                        break
                    except Exception as e:
                        continue
                if not searched:
                    # Fallback: click button containing "Search"
                    try:
                        await page.click("button:has-text('Search'), input[type=button][value*='Search' i]")
                        searched = True
                        recon["list_page"]["search_trigger"] = "button:has-text"
                    except Exception:
                        recon["errors"].append("No search trigger worked")

                await page.wait_for_timeout(3000)

                # Re-dump grid after search
                grid_after = await page.evaluate("""
                () => {
                    if (typeof window.Grid === 'undefined' && typeof window.gridObj === 'undefined') {
                        return {error: 'no grid global'};
                    }
                    const g = window.Grid || window.gridObj;
                    const out = {
                        rowsNum: g.getRowsNum ? g.getRowsNum() : null,
                        sample_rows: [],
                    };
                    if (g.getRowsNum) {
                        for (let i = 0; i < Math.min(3, g.getRowsNum()); i++) {
                            const id = g.getRowId(i);
                            const row = {row_id: id, cells: {}};
                            for (let c = 0; c < (g.getColumnsNum ? g.getColumnsNum() : 0); c++) {
                                try {
                                    const colId = g.getColumnId(c);
                                    row.cells[colId || c] = g.cells(id, c).getValue();
                                } catch (e) {}
                            }
                            out.sample_rows.push(row);
                        }
                    }
                    return out;
                }
                """)
                recon["list_page"]["grid_after_search"] = grid_after
                logger.info("After search rows=%s", grid_after.get("rowsNum"))

            # Take screenshot
            await page.screenshot(path="/tmp/recon_list_page.png", full_page=True)

        except Exception as exc:
            logger.exception("recon failed")
            recon["errors"].append(f"top-level: {exc}")
        finally:
            await browser.close()

    out_path = Path("/tmp/recon_register_delivery.json")
    out_path.write_text(json.dumps(recon, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"\n=== Recon JSON saved: {out_path} ===")
    print(f"Inputs: {len(recon.get('list_page', {}).get('inputs', []))}")
    print(f"Buttons: {len(recon.get('list_page', {}).get('buttons', []))}")
    print(f"Errors: {len(recon.get('errors', []))}")
    if recon.get("errors"):
        for e in recon["errors"]:
            print(f"  ! {e}")


if __name__ == "__main__":
    test_po = os.environ.get("TEST_PO_NO") or (sys.argv[1] if len(sys.argv) > 1 else None)
    asyncio.run(main(test_po))
