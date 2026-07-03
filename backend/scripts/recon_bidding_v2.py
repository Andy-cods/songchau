"""Recon round 8: Bidding · Quotation Submit — handle IBSheet locale popup.

User confirmed: when navigating to Bidding, an IBSheet [locale] popup appears.
Click OK + wait 5s -> data renders (977 rows seen in screenshot).

Output: /tmp/recon_bidding_v2/{list.html, list.png, summary.json, headers.json}
"""
from __future__ import annotations
import asyncio, json, logging, os, sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/tmp/recon_bidding_v2"); OUT.mkdir(parents=True, exist_ok=True)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("rb2")

USER = os.environ.get("BQMS_USERNAME") or ""
PASS = os.environ.get("BQMS_PASSWORD") or ""
BASE = os.environ.get("BQMS_BASE_URL") or "https://www.sec-bqms.com"
if not USER or not PASS:
    sys.path.insert(0, "/app")
    from app.core.config import settings
    USER = USER or settings.BQMS_USERNAME or ""
    PASS = PASS or settings.BQMS_PASSWORD or ""
    BASE = BASE or settings.BQMS_BASE_URL or "https://www.sec-bqms.com"


async def dismiss_ibsheet_popup(page) -> bool:
    """Click OK on the IBSheet [locale missing] popup if it appears.
    Returns True if a popup was actually clicked."""
    # IBSheet renders its messages via .SheetMessage / .SheetErrorMessage divs
    # with a button child. Try a few selectors in order.
    candidates = [
        ".SheetMessage button",
        ".SheetErrorMessage button",
        "button:has-text('OK')",
        "button:has-text('Ok')",
    ]
    for sel in candidates:
        try:
            btn = await page.query_selector(sel)
            if btn:
                txt = (await btn.text_content() or "").strip()
                if txt.upper() == "OK":
                    log.info("dismissing popup via %s", sel)
                    await btn.click()
                    return True
        except Exception:
            continue
    # Last resort: hit Enter (default focus on dialog OK)
    try:
        await page.keyboard.press("Enter")
        log.info("pressed Enter as fallback to dismiss popup")
        return True
    except Exception:
        return False


async def main() -> None:
    from playwright.async_api import async_playwright
    summary: dict = {"started_at": datetime.now(timezone.utc).isoformat()}

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True, args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1440, "height": 900}, locale="en-US",
        )
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

        await page.evaluate("selectLeftMenu(10, 10, true)")
        await asyncio.sleep(5)

        # First wait for popup, then dismiss + wait for data
        clicked = await dismiss_ibsheet_popup(page)
        summary["popup_dismissed"] = clicked
        await asyncio.sleep(6)  # User said ~5s after OK to load

        log.info("URL after popup: %s", page.url)
        summary["list_url"] = page.url

        list_html = await page.content()
        (OUT / "list.html").write_text(list_html, encoding="utf-8")
        await page.screenshot(path=str(OUT / "list.png"), full_page=True)

        # IBSheet 8 keeps instances on window.IBSheet (an array). Probe that.
        probe = await page.evaluate(
            """() => {
                const result = { ibsheet_array_len: -1, instance_methods: null };
                if (window.IBSheet && typeof window.IBSheet.length === 'number') {
                    result.ibsheet_array_len = window.IBSheet.length;
                    if (window.IBSheet[0]) {
                        const inst = window.IBSheet[0];
                        const methods = [];
                        for (const k in inst) {
                            if (typeof inst[k] === 'function' &&
                                /total|row|cell|value|count|col/i.test(k)) {
                                methods.push(k);
                            }
                        }
                        result.instance_methods = methods.slice(0, 40);
                    }
                }
                return result;
            }"""
        )
        summary["probe"] = probe
        log.info("probe: %s", json.dumps(probe))

        # IBSheet 8: split probe into safe small calls (no full row-object dump)
        # Probe BOTH IBSheet[0] and IBSheet[1] — first is usually search form, second the list
        target_idx = await page.evaluate(
            """() => {
                // Pick the sheet with the most data rows (the actual list)
                let bestIdx = 0, bestCount = -1;
                for (let i = 0; i < window.IBSheet.length; i++) {
                    try {
                        const len = (window.IBSheet[i].getDataRows() || []).length;
                        if (len > bestCount) { bestCount = len; bestIdx = i; }
                    } catch (e) {}
                }
                return { idx: bestIdx, len: bestCount };
            }"""
        )
        log.info("target IBSheet selection: %s", target_idx)
        summary["target_sheet"] = target_idx
        idx = target_idx.get("idx", 0)

        if probe.get("ibsheet_array_len", 0) >= 1:
            # Step 1: method availability + row counts
            meta = await page.evaluate(
                """(idx) => {
                    const s = window.IBSheet[idx];
                    const safe = (fn) => { try { return fn(); } catch (e) { return '_err:'+String(e).slice(0,40); } };
                    const methods = {};
                    for (const m of ['GetTotalRows', 'getTotalRows', 'getRowCount',
                                     'getDataRows', 'getRowsNum', 'getValue', 'GetCellValue',
                                     'getColumnList', 'getColumnInfo', 'getHeader']) {
                        methods[m] = typeof s[m] === 'function' ? 'fn' : 'no';
                    }
                    return {
                        methods,
                        row_count: {
                            getRowCount: safe(() => s.getRowCount && s.getRowCount()),
                            getTotalRows: safe(() => s.getTotalRows && s.getTotalRows()),
                            getDataRows_len: safe(() => s.getDataRows && s.getDataRows().length),
                        }
                    };
                }""",
                idx,
            )
            summary["meta"] = meta
            log.info("meta: %s", json.dumps(meta))

            # Step 2: discover column save names via different IBSheet 8 methods
            col_names = await page.evaluate(
                """(idx) => {
                    const s = window.IBSheet[idx];
                    const safe = (fn) => { try { return fn(); } catch (e) { return '_err:'+String(e).slice(0,40); } };
                    // Try several method conventions
                    const out = {};
                    out.getCols = safe(() => typeof s.getCols === 'function' ? s.getCols().map(c => c && (c.SaveName || c.Name || c.Id)) : 'no_method');
                    out.getColumns = safe(() => typeof s.getColumns === 'function' ? s.getColumns().map(c => c && (c.SaveName || c.Name || c.Id)) : 'no_method');
                    out.lastCol = safe(() => typeof s.LastCol === 'function' ? s.LastCol() : (typeof s.getLastCol === 'function' ? s.getLastCol() : 'no_method'));
                    // Walk SaveName function with index
                    const walk = [];
                    if (typeof s.ColSaveName === 'function') {
                        for (let i = 0; i < 50; i++) {
                            try {
                                const n = s.ColSaveName(i);
                                if (n === null || n === undefined || n === '') break;
                                walk.push(String(n));
                            } catch (e) { break; }
                        }
                    }
                    out.colSaveName_walk = walk;
                    // Try getDataRows()[0] keys (just keys, no values — keys are primitives)
                    out.row0_keys = safe(() => {
                        const all = s.getDataRows();
                        if (!all || !all[0]) return null;
                        // Filter to plausible BQMS data field names: skip DOM noise
                        return Object.keys(all[0]).filter(k =>
                            /^[A-Z_][A-Z0-9_]*$/.test(k) ||  // SCREAMING_SNAKE
                            (/^[a-z][a-zA-Z0-9]*$/.test(k) &&
                             !['childNodes','tagName','nodeName','previousSibling','nextSibling',
                               'parentNode','active','title','startDate','endDate','docType','userId',
                               'orderBy','deleted','firstRegPsId','firstRegDt','fnlUpdatePsId','fnlUpdateDt',
                               'gridKey','rowstatus','rowcheck','sortColName','sortOption',
                               'pageSize','pageUnit','startRowNm','endRowNm',
                               'searchCondition','searchKeyword','pageIndex','docStatus',
                               'userLanguage','userSiteCode','userCorpCode','userCompCode','userBaCode',
                               'userPltCode','userCategoryCode','userCurrencyCode','userAreaCd',
                               'srchReqNo','srchReqSeq','srchCtrChangeSeq'].includes(k))
                        ).slice(0, 80);
                    });
                    return out;
                }""",
                idx,
            )
            summary["column_probe"] = col_names
            log.info("col_probe: %s", json.dumps(col_names, ensure_ascii=False)[:800])

            # Step 3: dump real data — keys discovered are camelCase: reqNo, reqName, etc
            # We extract via direct property access on getDataRows()[i] (filtering primitives)
            sample = await page.evaluate(
                """(idx) => {
                    const s = window.IBSheet[idx];
                    const all = s.getDataRows();
                    const total = Math.min(3, all.length);
                    const rows = [];
                    const safeKeys = [
                        'reqNo','reqNoView','reqName','reqSeq','ctrChangeSeq','valutSeq',
                        'submitGb','resYn','regDt','deadlineDt','submitDt',
                        'progressStatus','progressStatusName','areaName','eprCode','eprNo',
                        'ctrType','ctrTypeNm','rndSysCode','psinchargeId','psinchargeName',
                        'plant','totalCnt','criteriaCurrency','itemCnt','dday',
                        'openStatusCode','rsltNotiDt','outbidNum'
                    ];
                    for (let i = 0; i < total; i++) {
                        const r = all[i];
                        const out = { _i: i };
                        for (const k of safeKeys) {
                            try {
                                const v = r[k];
                                if (v !== null && v !== undefined && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
                                    out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
                                }
                            } catch (e) {}
                        }
                        rows.push(out);
                    }
                    return rows;
                }""",
                idx,
            )
            summary["sample"] = sample
            (OUT / "headers.json").write_text(json.dumps({"col_names": col_names, "sample": sample}, ensure_ascii=False, indent=2))
            if sample:
                log.info("row[0]: %s", json.dumps(sample[0], ensure_ascii=False)[:700])
                log.info("row[1]: %s", json.dumps(sample[1] if len(sample) > 1 else {}, ensure_ascii=False)[:700])

        # Fallback: also dump rendered text from IBSheet table rows
        try:
            rendered = await page.evaluate(
                """() => {
                    const tables = document.querySelectorAll('.SheetMain, [class*="sheet"]');
                    return { sheet_div_count: tables.length };
                }"""
            )
            summary["rendered"] = rendered
        except Exception:
            pass

        await browser.close()

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    log.info("DONE")
    for f in sorted(OUT.iterdir()):
        log.info("  - %s (%d bytes)", f.name, f.stat().st_size)


if __name__ == "__main__":
    asyncio.run(main())
