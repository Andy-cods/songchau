"""Recon round 9: drill ONE Bidding RFQ subject to find Quotation Amount IBSheet
+ Basic Information field locations.

Output: /tmp/recon_bidding_detail/{detail.html, detail.png, summary.json}
"""
from __future__ import annotations
import asyncio, json, logging, os, sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/tmp/recon_bidding_detail"); OUT.mkdir(parents=True, exist_ok=True)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("rb_d")

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
    summary: dict = {"started_at": datetime.now(timezone.utc).isoformat()}

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

        await page.evaluate("selectLeftMenu(10, 10, true)")
        await asyncio.sleep(5)
        # Dismiss popup
        try:
            btn = await page.query_selector(".SheetMessage button, .SheetErrorMessage button, button:has-text('OK')")
            if btn: await btn.click()
        except Exception: pass
        await asyncio.sleep(6)

        # IBSheet doesn't use real <a> tags — it intercepts clicks via SheetClick.
        # Use the same JS the page uses on cell click: set hidden form fields,
        # then call bdEprSubmitList.moveQtSQuotContent() (for QT submitGb).
        nav_result = await page.evaluate(
            """() => {
                if (!window.IBSheet || !window.IBSheet[0]) return { error: 'no IBSheet[0]' };
                // Pick the sheet with the most rows
                let bestIdx = 0, bestCount = -1;
                for (let i = 0; i < window.IBSheet.length; i++) {
                    try {
                        const len = (window.IBSheet[i].getDataRows() || []).length;
                        if (len > bestCount) { bestCount = len; bestIdx = i; }
                    } catch(e) {}
                }
                const all = window.IBSheet[bestIdx].getDataRows();
                if (!all || !all.length) return { error: 'no rows' };
                const r = all[0];
                const out = {
                    sheet_idx: bestIdx,
                    reqNo: r.reqNo,
                    reqName: r.reqName,
                    submitGb: r.submitGb,
                    ctrType: r.ctrType,
                };
                try {
                    $("#submitContentForm #reqNo").val(r.reqNo);
                    $("#submitContentForm #reqSeq").val(r.reqSeq);
                    $("#submitContentForm #ctrChangeSeq").val(r.ctrChangeSeq);
                    $("#submitContentForm #valutSeq").val(r.valutSeq);
                    $("#submitContentForm #rndSysCode").val(r.rndSysCode);
                    $("#submitContentForm #secureKey").val(r.secureKey);
                    $("#submitContentForm #secureKeyBid").val(r.secureKeyBid);
                    $("#submitContentForm #eprCode").val(r.eprCode);
                    $("#submitContentForm #eprNo").val(r.eprNo);
                    if (r.submitGb === 'BD') {
                        const ctrType = r.ctrType;
                        const method = (ctrType === 'Y' || ctrType === 'Q' || ctrType === 'U') ? 'get' : 'post';
                        const baseUrl = ctrType === 'Y' ? '/intgd' :
                                        (ctrType === 'Q' || ctrType === 'U') ? '/dva' : '/gbd';
                        bdEprSubmitList.moveEprBdContent(method, baseUrl);
                    } else {
                        bdEprSubmitList.moveQtSQuotContent();
                    }
                    out.navigated = true;
                } catch (e) { out.nav_error = String(e).slice(0, 200); }
                return out;
            }"""
        )
        log.info("nav_result: %s", json.dumps(nav_result, ensure_ascii=False)[:300])
        summary["nav_result"] = nav_result

        if nav_result.get("navigated"):
            await asyncio.sleep(7)
            log.info("after click URL: %s", page.url)
            summary["detail_url"] = page.url

            html = await page.content()
            (OUT / "detail.html").write_text(html, encoding="utf-8")
            await page.screenshot(path=str(OUT / "detail.png"), full_page=True)

            # Probe IBSheet array
            probe = await page.evaluate(
                """() => {
                    const out = { instances: [] };
                    if (!window.IBSheet) return out;
                    out.length = window.IBSheet.length;
                    for (let i = 0; i < Math.min(8, out.length); i++) {
                        const s = window.IBSheet[i];
                        const safe = (fn) => { try { return fn(); } catch(e) { return '_err'; } };
                        const total = safe(() => (s.getDataRows() || []).length);
                        // Sample row 0 keys (filter to plausible BQMS fields)
                        const sampleKeys = safe(() => {
                            const all = s.getDataRows();
                            if (!all || !all[0]) return [];
                            return Object.keys(all[0]).filter(k =>
                                /^(item|spec|maker|qty|moq|description|partNo|price|currency|cisCode)/i.test(k) ||
                                /Code$|Name$|No$/i.test(k)
                            ).slice(0, 25);
                        });
                        // Sample first row, primitive values only
                        const sampleVals = safe(() => {
                            const all = s.getDataRows();
                            if (!all || !all[0]) return {};
                            const out = {};
                            for (const k of sampleKeys) {
                                try {
                                    const v = all[0][k];
                                    if (v !== null && v !== undefined &&
                                        (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
                                        out[k] = typeof v === 'string' ? v.slice(0, 100) : v;
                                    }
                                } catch(e) {}
                            }
                            return out;
                        });
                        out.instances.push({ idx: i, total, sample_keys: sampleKeys, sample_vals: sampleVals });
                    }
                    return out;
                }"""
            )
            summary["ibsheet_probe"] = probe
            log.info("IBSheet probe: %s", json.dumps(probe, ensure_ascii=False)[:1500])

            # Probe Basic Info section: find the "Basic information" table
            basic = await page.evaluate(
                """() => {
                    const out = {};
                    // Find h3/h4 with text "Basic information"
                    const heads = Array.from(document.querySelectorAll('h2, h3, h4')).filter(h =>
                        /basic\\s+information/i.test(h.textContent || ''));
                    if (!heads.length) return { _error: 'no heading' };
                    out.heading = heads[0].tagName + ': ' + heads[0].textContent.trim();
                    // Walk siblings to find the table
                    let n = heads[0];
                    for (let hop = 0; hop < 6; hop++) {
                        n = n.nextElementSibling;
                        if (!n) break;
                        const tbl = n.querySelector?.('table') || (n.tagName === 'TABLE' ? n : null);
                        if (tbl) {
                            // Walk td pairs (label/value)
                            const cells = Array.from(tbl.querySelectorAll('th, td')).map(c => (c.textContent || '').trim().slice(0, 200));
                            out.cells = cells.slice(0, 60);
                            break;
                        }
                    }
                    return out;
                }"""
            )
            summary["basic_info_dom"] = basic
            log.info("basic info DOM: %s", json.dumps(basic, ensure_ascii=False)[:600])

            # Probe attachments: look for file links
            atts = await page.evaluate(
                """() => {
                    // Attachments are typically <a href...> with file extensions
                    const out = [];
                    const links = document.querySelectorAll('a');
                    for (const a of links) {
                        const t = (a.textContent || '').trim();
                        const h = a.getAttribute('href') || '';
                        const oc = a.getAttribute('onclick') || '';
                        if (/\\.(pdf|xlsx?|zip|stp|step|dwg|x_t|jpg|png)$/i.test(t)) {
                            out.push({ text: t, href: h.slice(0, 120), onclick: oc.slice(0, 120) });
                        }
                    }
                    return out.slice(0, 30);
                }"""
            )
            summary["attachments"] = atts
            log.info("attachments found: %d", len(atts))

        else:
            summary["nav_skipped"] = True
            log.warning("navigation skipped — could not move to detail page")

        await browser.close()

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    log.info("DONE")


if __name__ == "__main__":
    asyncio.run(main())
