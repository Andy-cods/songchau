"""Recon round 9: Bidding · Quotation Announcement (menu 5) +
Selection Result (menu 18) — both in 1 login.

Output: /tmp/recon_l1_l3/{l1_list.html, l1_summary.json, l3_list.html, l3_summary.json}

Uses the same dismiss-popup + IBSheet[idx].getDataRows() pattern as the
existing Bidding · Quotation Submit scraper (menu 10).
"""
from __future__ import annotations
import asyncio, json, logging, os, sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/tmp/recon_l1_l3"); OUT.mkdir(parents=True, exist_ok=True)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("rl13")

USER = os.environ.get("BQMS_USERNAME") or ""
PASS = os.environ.get("BQMS_PASSWORD") or ""
BASE = os.environ.get("BQMS_BASE_URL") or "https://www.sec-bqms.com"
if not USER or not PASS:
    sys.path.insert(0, "/app")
    from app.core.config import settings
    USER = USER or settings.BQMS_USERNAME or ""
    PASS = PASS or settings.BQMS_PASSWORD or ""
    BASE = BASE or settings.BQMS_BASE_URL or "https://www.sec-bqms.com"


async def dismiss_popup(page):
    for sel in (".SheetMessage button", "button:has-text('OK')"):
        try:
            btn = await page.query_selector(sel)
            if btn:
                t = (await btn.text_content() or "").strip()
                if t.upper() == "OK":
                    await btn.click()
                    return True
        except Exception: pass
    try:
        await page.keyboard.press("Enter")
        return True
    except Exception: return False


async def probe_module(page, label, menu_id):
    log.info(f"=== {label} (selectLeftMenu({menu_id})) ===")
    await page.evaluate(f"selectLeftMenu({menu_id}, {menu_id}, true)")
    await asyncio.sleep(5)
    await dismiss_popup(page)
    await asyncio.sleep(6)
    log.info("URL: %s", page.url)

    html = await page.content()
    (OUT / f"{label}_list.html").write_text(html, encoding="utf-8")
    await page.screenshot(path=str(OUT / f"{label}_list.png"), full_page=True)

    # Pick IBSheet with most rows
    target = await page.evaluate(
        """() => {
            if (!window.IBSheet || !window.IBSheet.length) return { len: 0 };
            let bestIdx = 0, bestCount = -1;
            for (let i = 0; i < window.IBSheet.length; i++) {
                try {
                    const len = (window.IBSheet[i].getDataRows() || []).length;
                    if (len > bestCount) { bestCount = len; bestIdx = i; }
                } catch (e) {}
            }
            return { len: window.IBSheet.length, idx: bestIdx, rows: bestCount };
        }"""
    )
    log.info("IBSheet: %s", target)

    if target.get("rows", 0) < 1:
        return {"label": label, "menu_id": menu_id, "url": page.url, "ibsheet": target,
                "rows": [], "_note": "no rows"}

    idx = target["idx"]
    sample = await page.evaluate(
        """(idx) => {
            const s = window.IBSheet[idx];
            const all = s.getDataRows();
            const total = Math.min(3, all.length);
            const rows = [];
            for (let i = 0; i < total; i++) {
                const r = all[i];
                const out = { _i: i };
                for (const k of Object.keys(r)) {
                    // Skip DOM-noise keys
                    if (/^(childNodes|tagName|nodeName|previousSibling|nextSibling|parentNode|active|title|docStatus|userId|orderBy|deleted|gridKey|rowstatus|rowcheck|sortColName|sortOption|pageSize|pageUnit|startRowNm|endRowNm|searchCondition|searchKeyword|pageIndex|userLanguage|userSiteCode|userCorpCode|userCompCode|userBaCode|userPltCode|userCategoryCode|userCurrencyCode|userAreaCd|firstRegPsId|firstRegDt|fnlUpdatePsId|fnlUpdateDt|srch.*)$/.test(k)) continue;
                    try {
                        const v = r[k];
                        if (v !== null && v !== undefined && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
                            out[k] = typeof v === 'string' ? v.slice(0, 100) : v;
                        }
                    } catch (e) {}
                }
                rows.push(out);
            }
            return rows;
        }""",
        idx,
    )
    log.info("sample row 0: %s", json.dumps(sample[0] if sample else {}, ensure_ascii=False)[:600])
    return {
        "label": label, "menu_id": menu_id, "url": page.url,
        "ibsheet": target, "rows": sample,
    }


async def main():
    from playwright.async_api import async_playwright
    summary = {"started_at": datetime.now(timezone.utc).isoformat()}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, locale="en-US")
        page = await ctx.new_page()

        await page.goto(f"{BASE}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
                        wait_until="domcontentloaded", timeout=30_000)
        await page.fill("input#id", USER); await page.fill("input#pass", PASS)
        await page.evaluate("login()")
        try:
            await page.wait_for_url(lambda u: "anonymous" not in u and "login" not in u.lower(), timeout=30_000)
        except Exception: pass
        log.info("login OK")

        summary["l1_announcement"] = await probe_module(page, "l1", 5)
        await asyncio.sleep(3)
        summary["l3_selection"]    = await probe_module(page, "l3", 18)

        await browser.close()
    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    log.info("DONE")


if __name__ == "__main__":
    asyncio.run(main())
