"""Samsung BQMS Vendor Portal — Bidding · Quotation Submit scraper.

The bidding list is a REQUEST-LEVEL view (1 request = 1 row, may have N items
inside that aren't expanded on the list). Useful for visibility into open RFQs
and submission deadlines BEFORE they become contracts.

DOM/JS structure (from recon round 8, 2026-05-08):
  - URL: /bqms/gbd/eprPotal/sbid/sbid/bdEprSubmitListR.do (selectLeftMenu(10))
  - Loads ibsheet8 + locale ko.js + en.js but NOT vi.js → pops up an
    [IBSheet locale missing] dialog. User confirmed: pressing OK + waiting
    ~5s lets data render. Total rows in account: 978.
  - Global: window.IBSheet[idx] (idx is the sheet with the most data rows;
    typically 0 for Bidding · Quotation Submit). API differs from MRO/Contract:
      getDataRows()    -> array of row objects (camelCase keys)
      getValue(i, k)   -> per-cell value (alternative)
  - Row keys (camelCase): reqNo, reqName (=Subject), reqSeq, regDt,
    deadlineDt, submitDt, progressStatus, progressStatusName, ctrType,
    ctrTypeNm (Equipment MRO etc), psinchargeName (Procurement Manager),
    plant, totalCnt, criteriaCurrency, itemCnt, dday, openStatusCode

Per user 2026-05-08:
  - Bidding doesn't merge directly into bqms_won_quotations (those are
    "won" rows; bidding is "asked to quote"). Lands in staging with
    module='bidding' for visibility only.
  - Manual trigger only — no auto cron yet.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Batch 2C: V-round / D-N deadline tracking. parse_deadline lives in the
# auto-skip service (single source of truth for Samsung deadline parsing).
# Imported lazily-safe at module level; if the service is unavailable the
# instrumentation below degrades to a no-op (guarded with try/except).
try:
    from app.services.bqms_auto_skip_expired import parse_deadline as _parse_deadline_2c
except Exception:  # pragma: no cover - defensive
    _parse_deadline_2c = None  # type: ignore[assignment]

OUT_DIR = Path("/tmp/scrape_runs")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Storage root for per-RFQ folders (mounted from /data/onedrive-staging on host).
# Defined at module level (used by smart_skip + Phase 2 download functions).
RFQ_ROOT = Path("/data/onedrive-staging/Puplic/BQMS/RFQ")

BIDDING_KEYS = [
    "reqNo", "reqNoView", "reqName", "reqSeq", "ctrChangeSeq", "valutSeq",
    "submitGb", "resYn", "regDt", "deadlineDt", "submitDt",
    "progressStatus", "progressStatusName", "areaName", "eprCode", "eprNo",
    "ctrType", "ctrTypeNm", "rndSysCode", "psinchargeId", "psinchargeName",
    "plant", "totalCnt", "criteriaCurrency", "itemCnt", "dday",
    "openStatusCode", "rsltNotiDt", "outbidNum",
    # Hidden fields needed to navigate to detail page (form submitContentForm)
    "secureKey", "secureKeyBid",
]

# Quotation Amount item grid (dhtmlx itemGridBox on detail page)
# Map column-id -> staging field. Skipping NO (SEQ) and IMAGE per user instruction.
QUOT_AMOUNT_COLS = [
    ("ITEM_NAME", "description"),
    ("QTY", "qty"),
    ("SPECIFICATION_VALUE", "specification"),
    ("UNIT_ISO_STD_CODE", "unit"),
    ("SUBMISSION_UNIT_PRICE", "submission_unit_price"),
    ("SUBMISSION_AMOUNT", "submission_amount"),
    ("CRITERIA_CURRENCY", "currency"),
    ("MOQ", "moq"),
    ("ITEM_ID", "item_code"),
    ("SUBMIT_GIVEUP", "abandonment"),
    ("FREE_CHARGE", "free_charge"),
    ("CIS_CODE", "cis_code"),
    ("MANUFACTURER", "maker"),
    ("MANUFACTURER_PART_NUMBER", "part_no"),
    ("LEAD_TIME", "lead_time"),
]


async def _get_already_processed_rfqs(db_pool) -> set[str]:
    """Smart-skip helper: return set of rfq_numbers we should NOT re-process.

    A RFQ counts as "fully processed" when:
      - It exists in bqms_rfq (any data_source) AND
      - Its per-RFQ folder exists AND folder/images/ contains at least 1 image

    These QTs are skipped during drill (don't wast a click) and during staging
    insert (don't pollute the staging UI). RFQs in bqms_rfq but WITHOUT images
    are NOT skipped — we still drill them so we can extract images.
    """
    if db_pool is None:
        return set()
    rfq_in_db: set[str] = set()
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT rfq_number FROM bqms_rfq WHERE rfq_number IS NOT NULL"
        )
        rfq_in_db = {r["rfq_number"].strip() for r in rows if r["rfq_number"]}

    # Filter: only those with non-empty images folder are "fully done"
    fully_done: set[str] = set()
    now = datetime.now()
    # Probe current + previous month/year for folder existence
    candidates = []
    for y in (now.year, now.year - 1):
        for m in range(12, 0, -1):
            candidates.append((y, m))
    for rfq in rfq_in_db:
        for y, m in candidates:
            folder = RFQ_ROOT / f"RFQ {y}" / f"THANG {m}" / rfq
            if not folder.exists():
                continue
            images_dir = folder / "images"
            if images_dir.exists() and any(images_dir.iterdir()):
                fully_done.add(rfq)
                break
    return fully_done


async def scrape_bidding(
    limit: int = 0,
    save_raw_json: bool = True,
    db_pool=None,
    drill_details: bool = False,
    page_size: int = 100,
    page_num: int = 1,
    smart_skip: bool = True,
) -> dict[str, Any]:
    """Run a single Bidding · Quotation Submit list scrape.

    Args:
        limit: max rows to extract (0 = all rows on the chosen page).
        save_raw_json: dump raw output to /tmp/scrape_runs/<uuid>.json.
        db_pool: asyncpg pool — when provided, INSERT staging rows.
        drill_details: when True, click each subject and pull detail data
            (Basic Info, Quotation Amount items, Attachments, version).
            With architectural change 2026-05-09, drill no longer auto-UPSERTs
            into bqms_rfq — that happens via /vendor-staging/{id}/quote when
            admin clicks "Báo giá" per row.
        page_size: rows per page (10/30/50/100; default 100 for max throughput).
        page: which page to fetch (1-based). Bidding has up to ~978 RFQ.

    Returns:
        { run_id, list_count, total_available, items: [...], json_path }
    """
    from playwright.async_api import async_playwright
    from app.core.config import settings
    from app.services.bqms_credentials import get_bqms_credentials

    user, pwd = get_bqms_credentials()
    base = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"
    if not user or not pwd:
        raise RuntimeError("BQMS credentials missing in settings")

    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    items: list[dict[str, Any]] = []
    total_available = 0

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1440, "height": 900},
            locale="en-US",
        )
        page = await context.new_page()

        # Login
        await page.goto(
            f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
            wait_until="domcontentloaded", timeout=30_000,
        )
        await page.fill("input#id", user)
        await page.fill("input#pass", pwd)
        await page.evaluate("login()")
        try:
            await page.wait_for_url(
                lambda u: "anonymous" not in u and "login" not in u.lower(),
                timeout=30_000,
            )
        except Exception:
            pass
        logger.info("bidding scraper login OK: %s", page.url)

        # Navigate to Bidding · Quotation Submit (menu 10)
        await page.evaluate("selectLeftMenu(10, 10, true)")
        await asyncio.sleep(5)

        # Dismiss the IBSheet [locale missing] popup if present
        await _dismiss_ibsheet_popup(page)
        await asyncio.sleep(6)  # data load after dismissal

        # Set page size + jump to target page (if not page 1 / not 10 default)
        if page_size != 10 or page_num > 1:
            await _set_page_and_size(page, page_size, page_num)
            await asyncio.sleep(5)
            # In case popup re-appears after page change
            await _dismiss_ibsheet_popup(page)
            await asyncio.sleep(2)

        logger.info("bidding list URL: %s (page=%d size=%d)", page.url, page_num, page_size)

        # Extract: pick the IBSheet instance with the most data rows
        items, total_available = await _extract_bidding_rows(page, limit)
        logger.info(
            "bidding list extracted: %d rows (totalCnt=%d)",
            len(items), total_available,
        )

        # Batch 2C: snapshot the FULL extracted list BEFORE smart_skip filters
        # it. The presence ledger needs the true "what is active on the list
        # right now" view — otherwise smart-skipped (already-processed but still
        # active) RFQs would be mis-detected as "dropped off the list".
        all_list_items = list(items)

        # Smart-skip: filter out RFQs already in DB AND have images extracted.
        # Those RFQs don't need re-drilling — they're "fully processed".
        # RFQs in DB but WITHOUT images are kept (we'll drill to get images).
        skipped_rfqs: list[str] = []
        if smart_skip and db_pool is not None and items:
            already = await _get_already_processed_rfqs(db_pool)
            kept = []
            for r in items:
                rfq = (r.get("reqNo") or "").strip()
                if rfq and rfq in already:
                    skipped_rfqs.append(rfq)
                else:
                    kept.append(r)
            items = kept
            logger.info(
                "smart_skip: %d RFQs already-fully-processed → skipped; %d to drill",
                len(skipped_rfqs), len(items),
            )

        # Optional: drill into each row to get detail (Basic Info + Items + Attachments)
        if drill_details and items:
            for i, row in enumerate(items):
                try:
                    # Pass base URL → drill ensures we're on list page first
                    detail = await _drill_bidding_detail(page, row, base=base)
                    items[i]["_detail"] = detail
                    if detail.get("error"):
                        logger.warning(
                            "drill #%d %s ERROR: %s",
                            i, row.get("reqNo"), detail.get("error"),
                        )
                    else:
                        logger.info(
                            "drill #%d %s: %d items, %d attachments, ver=%s, gc=%s",
                            i, row.get("reqNo"),
                            len(detail.get("items", [])),
                            len(detail.get("attachments", [])),
                            detail.get("version"),
                            detail.get("classification"),
                        )
                    # Polite delay between drills — Samsung session can drop
                    # if we click too fast.
                    await asyncio.sleep(4)
                except Exception as exc:
                    logger.warning("drill failed for %s: %s", row.get("reqNo"), exc)
                    items[i]["_detail"] = {"error": str(exc)[:300]}
                    # Try to recover by going back to list
                    try:
                        await page.evaluate("if (typeof goList === 'function') goList(); else history.back();")
                        await asyncio.sleep(5)
                    except Exception:
                        pass

        await browser.close()

    finished_at = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "run_id": run_id,
        "module": "bidding",
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_seconds": (finished_at - started_at).total_seconds(),
        "list_count": len(items),
        "skipped_already_processed": len(skipped_rfqs),
        "skipped_rfqs": skipped_rfqs[:50],  # first 50 only (avoid huge payload)
        "total_available": total_available,
        "items": items,
    }

    json_path = None
    if save_raw_json:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        json_path = OUT_DIR / f"bidding_run_{run_id}.json"
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        payload["json_path"] = str(json_path)
        logger.info("bidding raw scrape saved: %s", json_path)

    if db_pool is not None:
        await _insert_staging_bidding(db_pool, run_id, items)
        # NOTE: 2026-05-09 architectural change — drill no longer auto-UPSERTs
        # into bqms_rfq. The full detail (basic_info, items, attachments) is
        # stored in staging.raw_json under key '_detail'. UPSERT into bqms_rfq
        # happens later, only when admin clicks "Báo giá" per row, via the
        # POST /vendor-staging/{id}/quote endpoint. This skips the
        # employee-decided "thấy báo được" Excel filter step.
        if drill_details:
            payload["drill_summary"] = {
                "drilled_count": sum(1 for it in items if (it.get("_detail") or {}).get("items")),
                "total_items_extracted": sum(
                    len((it.get("_detail") or {}).get("items") or []) for it in items
                ),
            }
        # Batch 2C (Thang 2026-06-17): persist a presence snapshot from the
        # LIST-only path too. The periodic cron calls scrape_bidding(
        # drill_details=False), so without this the bqms_scrape_presence ledger
        # would stay empty and re-invite detection (reappear-after-absence)
        # could never fire. Guarded — degrades to a no-op if the migration has
        # not run; NEVER aborts the scrape.
        try:
            # Use the FULL pre-smart-skip list so the "dropped off the list"
            # detection is computed against the true active set, not the
            # post-filter subset. Only run the inactive-marking pass when we
            # scraped the COMPLETE list (limit==0) — a truncated scrape would
            # otherwise mis-mark unseen-but-still-active RFQs as dropped.
            pres = await _persist_list_presence(
                db_pool, run_id, all_list_items, full_list=(limit == 0),
            )
            payload["presence_summary"] = pres
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("list presence snapshot skipped: %s", exc)

    return payload


async def _set_page_and_size(page, page_size: int, page_num: int) -> bool:
    """Set the bidding list page size + navigate to a specific page.

    BQMS list page has:
      - <select id="pageSize"> (or similar) with values 10/30/50/100
      - Hidden form submitContentForm with `pageIndex` field
      - Page navigator at bottom calls `bdEprSubmitList.goPage(N)` or similar

    Strategy: change pageSize via JS + call the search function directly.
    Falls back gracefully if selectors are missing.
    """
    result = await page.evaluate(
        """({ size, num }) => {
            try {
                // Update page-size dropdown if present
                const ps = document.querySelector('#pageSize, select[name="pageSize"], #pageUnit, select[name="pageUnit"]');
                if (ps) {
                    ps.value = String(size);
                    if (typeof $(ps).trigger === 'function') $(ps).trigger('change');
                }
                // Update hidden form pageIndex + pageSize
                const form = document.querySelector('#searchForm, form[name="searchForm"]');
                if (form) {
                    const setHidden = (name, val) => {
                        let el = form.querySelector(`[name="${name}"]`);
                        if (!el) {
                            el = document.createElement('input');
                            el.type = 'hidden'; el.name = name;
                            form.appendChild(el);
                        }
                        el.value = String(val);
                    };
                    setHidden('pageSize', size);
                    setHidden('pageUnit', size);
                    setHidden('pageIndex', num);
                }
                // Trigger search/refresh — call the page's own search function
                if (typeof bdEprSubmitList === 'object' && bdEprSubmitList.searchList) {
                    bdEprSubmitList.searchList();
                    return { method: 'bdEprSubmitList.searchList' };
                }
                if (typeof searchList === 'function') {
                    searchList();
                    return { method: 'global searchList' };
                }
                if (form) {
                    form.submit();
                    return { method: 'form.submit' };
                }
                return { method: 'no_op' };
            } catch (e) {
                return { error: String(e).slice(0, 200) };
            }
        }""",
        {"size": page_size, "num": page_num},
    )
    return not (isinstance(result, dict) and result.get("error"))


async def _dismiss_ibsheet_popup(page) -> bool:
    """Click OK on the IBSheet [locale missing] dialog. Returns True if clicked."""
    candidates = [
        ".SheetMessage button",
        ".SheetErrorMessage button",
        "button:has-text('OK')",
    ]
    for sel in candidates:
        try:
            btn = await page.query_selector(sel)
            if btn:
                txt = (await btn.text_content() or "").strip()
                if txt.upper() == "OK":
                    await btn.click()
                    return True
        except Exception:
            continue
    # Fallback: Enter
    try:
        await page.keyboard.press("Enter")
        return True
    except Exception:
        return False


async def _extract_bidding_rows(page, limit: int) -> tuple[list[dict[str, Any]], int]:
    """Walk window.IBSheet[idx].getDataRows() — pick the sheet with most rows."""
    result = await page.evaluate(
        """({ keys, limit }) => {
            // Pick the IBSheet instance with the most data rows
            let bestIdx = 0, bestCount = -1;
            for (let i = 0; i < (window.IBSheet || []).length; i++) {
                try {
                    const len = (window.IBSheet[i].getDataRows() || []).length;
                    if (len > bestCount) { bestCount = len; bestIdx = i; }
                } catch (e) {}
            }
            const s = window.IBSheet?.[bestIdx];
            if (!s || typeof s.getDataRows !== 'function') {
                return { _error: 'IBSheet not ready', items: [], totalCnt: 0 };
            }
            const all = s.getDataRows();
            const total = all.length;
            const max = limit > 0 ? Math.min(limit, total) : total;
            const items = [];
            let totalCnt = 0;
            for (let i = 0; i < max; i++) {
                const r = all[i];
                const out = { _row_idx: i };
                for (const k of keys) {
                    try {
                        const v = r[k];
                        if (v !== null && v !== undefined && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
                            out[k] = typeof v === 'string' ? v.slice(0, 1000) : v;
                        }
                    } catch (e) {}
                }
                items.push(out);
                if (i === 0 && typeof out.totalCnt === 'number') totalCnt = out.totalCnt;
            }
            return { items, totalCnt, picked_idx: bestIdx };
        }""",
        {"keys": BIDDING_KEYS, "limit": limit},
    )
    if isinstance(result, dict) and result.get("_error"):
        logger.error("bidding extract: %s", result["_error"])
        return [], 0
    items = result.get("items", []) if isinstance(result, dict) else []
    total = int(result.get("totalCnt") or 0) if isinstance(result, dict) else 0
    return items, total


_VERSION_RE = __import__("re").compile(r"(\d+)\s*th", __import__("re").IGNORECASE)


def _parse_rfq_version(rfq_no_text: str | None) -> tuple[str | None, int]:
    """Parse `[New] QT26061295 / 1 th` → ('QT26061295', 1)."""
    if not rfq_no_text:
        return None, 1
    s = str(rfq_no_text)
    qt = None
    for tok in s.replace("[", " ").replace("]", " ").split():
        if tok.upper().startswith("QT"):
            qt = tok.strip()
            break
    m = _VERSION_RE.search(s)
    ver = int(m.group(1)) if m else 1
    return qt, ver


def _classify_drawing(filenames: list[str]) -> str:
    """If any filename contains 'Drawing' (case-insensitive) → Gia công, else Thương mại."""
    for f in filenames:
        if "drawing" in (f or "").lower():
            return "GC"
    return "TM"


async def _ensure_on_bidding_list(page, base: str) -> bool:
    """Make sure we're on the Bidding Quotation Submit LIST page so that
    bdEprSubmitList JS object is in scope.

    Strategy (battle-tested through multiple bug fixes):
      1. Quick check — if bdEprSubmitList already in scope, return True
      2. Try selectLeftMenu(10, 10, true) — preserves the menu portal context
      3. If that fails, fallback to full page.goto with the list URL
      4. After each attempt: wait + dismiss IBSheet popup + poll bdEprSubmitList up to 15s
      5. Log current URL on failure so we can debug session/redirect issues
    """
    js_check = (
        "typeof bdEprSubmitList !== 'undefined' "
        "&& typeof bdEprSubmitList.moveQtSQuotContent === 'function'"
    )
    if await page.evaluate(js_check):
        return True

    logger.info("not on bidding list — current URL: %s", page.url)

    # Attempt 1: selectLeftMenu (preserves session context — works for in-app nav)
    try:
        await page.evaluate("selectLeftMenu(10, 10, true)")
        await asyncio.sleep(6)
        await _dismiss_ibsheet_popup(page)
        for _ in range(15):
            await asyncio.sleep(1)
            if await page.evaluate(js_check):
                logger.info("→ recovered via selectLeftMenu(10)")
                return True
    except Exception as exc:
        logger.warning("selectLeftMenu failed: %s", exc)

    # Attempt 2: full page.goto (fallback)
    list_url = (
        f"{base}/bqms/gbd/eprPotal/sbid/sbid/bdEprSubmitListR.do"
        f"?_menuId=AZib43qsAJIV-QNs&_menuF=true"
    )
    try:
        logger.info("attempt 2: page.goto %s", list_url)
        await page.goto(list_url, wait_until="domcontentloaded", timeout=20_000)
        await asyncio.sleep(4)
        await _dismiss_ibsheet_popup(page)
        for _ in range(15):
            await asyncio.sleep(1)
            if await page.evaluate(js_check):
                logger.info("→ recovered via page.goto")
                return True
    except Exception as exc:
        logger.warning("page.goto failed: %s", exc)

    logger.warning(
        "could not return to bidding list — final URL=%s, title=%s",
        page.url, await page.title(),
    )
    return False


async def _drill_bidding_detail(page, row: dict, base: str = "") -> dict:
    """Navigate to one bidding RFQ's detail page, extract Basic Info,
    Quotation Amount items, Attachments. Return to list when done.

    Robust against batch-drill state drift: ensures bdEprSubmitList JS
    object is loaded before attempting form-fill + moveQt call.
    """
    if base:
        on_list = await _ensure_on_bidding_list(page, base)
        if not on_list:
            return {"error": "could not return to bidding list page"}

    nav_result = await page.evaluate(
        """(r) => {
            try {
                if (typeof bdEprSubmitList === 'undefined') {
                    return { ok: false, why: 'bdEprSubmitList undefined' };
                }
                $('#submitContentForm #reqNo').val(r.reqNo);
                $('#submitContentForm #reqSeq').val(r.reqSeq);
                $('#submitContentForm #ctrChangeSeq').val(r.ctrChangeSeq);
                $('#submitContentForm #valutSeq').val(r.valutSeq);
                $('#submitContentForm #rndSysCode').val(r.rndSysCode);
                $('#submitContentForm #secureKey').val(r.secureKey);
                $('#submitContentForm #secureKeyBid').val(r.secureKeyBid);
                $('#submitContentForm #eprCode').val(r.eprCode);
                $('#submitContentForm #eprNo').val(r.eprNo);
                if (r.submitGb === 'BD') {
                    const ct = r.ctrType;
                    const m = (ct === 'Y' || ct === 'Q' || ct === 'U') ? 'get' : 'post';
                    const b = ct === 'Y' ? '/intgd' : (ct === 'Q' || ct === 'U') ? '/dva' : '/gbd';
                    bdEprSubmitList.moveEprBdContent(m, b);
                } else {
                    bdEprSubmitList.moveQtSQuotContent();
                }
                return { ok: true };
            } catch (e) { return { ok: false, why: String(e).slice(0, 200) }; }
        }""",
        row,
    )
    if not nav_result.get("ok"):
        return {"error": f"navigation failed: {nav_result.get('why', 'unknown')}"}

    await asyncio.sleep(7)

    # Basic Info — Per Thang 2026-05-12 audit: cũ scan h2/h3/h4 "basic information"
    # quá strict, Samsung portal đôi khi không match → empty {}. Đổi thành scan
    # ALL <table> trong document, collect mọi label-value pair (th/td pair).
    # Sau đó lookup keys cần (RFQ No, Requester, Department, ...).
    basic = await page.evaluate(
        """() => {
            const out = {};
            // Strategy 1: try original — h2/h3/h4 "Basic Information" header
            const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,div.title,span.title')).filter(h => {
                const t = (h.textContent || '').trim();
                return t.length < 80 && /basic\\s+information/i.test(t);
            });
            if (heads.length) {
                let n = heads[0];
                for (let hop = 0; hop < 8; hop++) {
                    n = n.nextElementSibling;
                    if (!n) break;
                    const tbl = n.querySelector?.('table') || (n.tagName === 'TABLE' ? n : null);
                    if (tbl) {
                        const rows = tbl.querySelectorAll('tr');
                        for (const tr of rows) {
                            const cells = Array.from(tr.querySelectorAll('th, td'));
                            for (let i = 0; i + 1 < cells.length; i += 2) {
                                const k = (cells[i].textContent || '').trim();
                                const v = (cells[i + 1].textContent || '').trim();
                                if (k && k.length < 50 && k.length >= 2) out[k] = v.slice(0, 500);
                            }
                        }
                        break;
                    }
                }
            }
            // Strategy 2: fallback — scan ALL tables on page for label-value pairs.
            // Many Samsung pages render basic info inside a generic info table
            // without an explicit "Basic Information" heading.
            if (Object.keys(out).length < 3) {
                for (const tbl of document.querySelectorAll('table')) {
                    const rows = tbl.querySelectorAll('tr');
                    for (const tr of rows) {
                        const cells = Array.from(tr.querySelectorAll('th, td'));
                        for (let i = 0; i + 1 < cells.length; i += 2) {
                            const k = (cells[i].textContent || '').trim();
                            const v = (cells[i + 1].textContent || '').trim();
                            // Only capture short labels that look like field names
                            if (k && k.length >= 2 && k.length < 50 && !out[k]) {
                                if (/^[A-Z\\u00C0-\\u1EF9 .\\-_/]+$/i.test(k) && !/\\d{3,}/.test(k)) {
                                    out[k] = v.slice(0, 500);
                                }
                            }
                        }
                    }
                }
            }
            return out;
        }"""
    )

    # Quotation Amount items via dhtmlx itemGridBox API
    qa_items = await page.evaluate(
        """({ cols }) => {
            const g = window.itemGridBox;
            if (!g || typeof g.getRowsNum !== 'function') return [];
            const total = g.getRowsNum();
            const items = [];
            const colIdx = {};
            for (const [colId, _] of cols) {
                try { colIdx[colId] = g.getColIndexById(colId); }
                catch (e) { colIdx[colId] = -1; }
            }
            for (let i = 0; i < total; i++) {
                let rowId = null;
                try { rowId = g.getRowId(i); } catch (e) {}
                if (rowId === null || rowId === undefined) continue;
                const row = {};
                for (const [colId, fieldName] of cols) {
                    const idx = colIdx[colId];
                    if (idx < 0) { row[fieldName] = null; continue; }
                    try {
                        let v = g.cells(rowId, idx).getValue();
                        if (v === null || v === undefined) v = null;
                        row[fieldName] = v;
                    } catch (e) { row[fieldName] = null; }
                }
                items.push(row);
            }
            return items;
        }""",
        {"cols": QUOT_AMOUNT_COLS},
    )

    # Attachments — list of file names with extension
    attachments = await page.evaluate(
        """() => {
            const out = [];
            for (const a of document.querySelectorAll('a')) {
                const t = (a.textContent || '').trim();
                if (/\\.(pdf|xlsx?|zip|stp|step|dwg|x_t|jpe?g|png|tiff?)$/i.test(t)) {
                    if (out.indexOf(t) < 0) out.push(t);
                }
            }
            return out;
        }"""
    )

    rfq_text = basic.get("RFQ No") or basic.get("RFQ no") or basic.get("RFQ")
    qt, version = _parse_rfq_version(rfq_text)
    classification = _classify_drawing(attachments)

    detail = {
        "rfq_text": rfq_text,
        "rfq_no_parsed": qt,
        "version": version,
        "basic_info": basic,
        "items": qa_items,
        "attachments": attachments,
        "classification": classification,
        "detail_url": page.url,
    }

    # Return to list — try goList(), then history.back()
    try:
        await page.evaluate("if (typeof goList === 'function') goList(); else history.back();")
        await asyncio.sleep(5)
        # Re-dismiss popup if it pops again on list re-load
        try:
            btn = await page.query_selector(".SheetMessage button, button:has-text('OK')")
            if btn:
                await btn.click()
                await asyncio.sleep(3)
        except Exception:
            pass
    except Exception:
        pass

    return detail


# ---------------------------------------------------------------------------
# Batch 2C — V-round / D-N tracking instrumentation (ADDITIVE, GUARDED).
# These helpers persist deadline_dt/deadline_raw/last_seen_scrape_at/current_round
# on bqms_rfq and append rows to the append-only ledgers bqms_scrape_presence +
# bqms_qt_events. They are guarded so the live scraper NEVER breaks if the
# bqms_vround_tracking.sql migration has not been applied yet.
# ---------------------------------------------------------------------------
async def _vround_schema_present(conn) -> bool:
    """Cheap probe: do the Batch-2C columns/tables exist on this DB?

    Cached on the connection object so we probe at most once per scrape run.
    """
    cached = getattr(conn, "_vround_2c_present", None)
    if cached is not None:
        return bool(cached)
    present = False
    try:
        ok_col = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name='bqms_rfq' AND column_name='deadline_dt')"
        )
        ok_pres = await conn.fetchval(
            "SELECT to_regclass('public.bqms_scrape_presence') IS NOT NULL"
        )
        ok_evt = await conn.fetchval(
            "SELECT to_regclass('public.bqms_qt_events') IS NOT NULL"
        )
        present = bool(ok_col and ok_pres and ok_evt)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("_vround_schema_present probe failed: %s", exc)
        present = False
    try:
        setattr(conn, "_vround_2c_present", present)
    except Exception:
        pass
    return present


async def _persist_vround_for_rfq(
    conn,
    *,
    rfq_number: str,
    bqms_code: str | None,
    deadline_raw: str | None,
    deadline_dt,
    samsung_round: int,
    raw_status: str | None,
    scrape_run_id: str | None,
    existing_round,
) -> None:
    """Persist deadline + presence + scraped-event for ONE (rfq, code).

    SAFE-ADDITIVE: only sets deadline_* / last_seen_scrape_at (never touches
    user-action columns); bumps current_round monotonically; appends one
    presence row + one 'qt.scraped' event. Best-effort — swallows errors so a
    tracking failure never aborts the main UPSERT.
    """
    try:
        # 1. Update tracking columns on bqms_rfq. The scraper persists ONLY the
        #    deadline + last_seen marker; current_round (the ERP round) is owned
        #    by the state engine on actual quote/push, so we never set/lower it
        #    here. When `existing_round` is provided it only ratchets UP (GREATEST).
        if existing_round:
            await conn.execute(
                """
                UPDATE bqms_rfq
                   SET deadline_dt = COALESCE($1, deadline_dt),
                       deadline_raw = COALESCE($2, deadline_raw),
                       last_seen_scrape_at = NOW(),
                       current_round = GREATEST(COALESCE(current_round, 0), $3),
                       result = CASE
                           WHEN result = 'closed'::rfq_result AND result_updated_by IS NULL
                                AND $1 IS NOT NULL AND $1 > NOW()
                           THEN 'pending'::rfq_result ELSE result END,
                       result_date = CASE
                           WHEN result = 'closed'::rfq_result AND result_updated_by IS NULL
                                AND $1 IS NOT NULL AND $1 > NOW()
                           THEN NULL ELSE result_date END
                 WHERE rfq_number = $4 AND bqms_code IS NOT DISTINCT FROM $5
                """,
                deadline_dt, deadline_raw, int(existing_round),
                rfq_number, bqms_code,
            )
        else:
            await conn.execute(
                """
                UPDATE bqms_rfq
                   SET deadline_dt = COALESCE($1, deadline_dt),
                       deadline_raw = COALESCE($2, deadline_raw),
                       last_seen_scrape_at = NOW(),
                       result = CASE
                           WHEN result = 'closed'::rfq_result AND result_updated_by IS NULL
                                AND $1 IS NOT NULL AND $1 > NOW()
                           THEN 'pending'::rfq_result ELSE result END,
                       result_date = CASE
                           WHEN result = 'closed'::rfq_result AND result_updated_by IS NULL
                                AND $1 IS NOT NULL AND $1 > NOW()
                           THEN NULL ELSE result_date END
                 WHERE rfq_number = $3 AND bqms_code IS NOT DISTINCT FROM $4
                """,
                deadline_dt, deadline_raw, rfq_number, bqms_code,
            )
        # 2. Append presence row (append-only ledger).
        await conn.execute(
            """
            INSERT INTO bqms_scrape_presence
                (scrape_run_id, rfq_number, bqms_code, is_active,
                 samsung_round, deadline_dt, raw_status)
            VALUES ($1, $2, $3, TRUE, $4, $5, $6)
            """,
            scrape_run_id, rfq_number, bqms_code, samsung_round,
            deadline_dt, raw_status,
        )
        # 3. Append a 'qt.scraped' event (timeline source of truth).
        await conn.execute(
            """
            INSERT INTO bqms_qt_events
                (rfq_number, bqms_code, event_type, round_no, deadline_dt,
                 actor, evidence)
            VALUES ($1, $2, 'qt.scraped', $3, $4, 'scraper', $5::jsonb)
            """,
            rfq_number, bqms_code, samsung_round, deadline_dt,
            json.dumps({
                "deadline_raw": deadline_raw,
                "raw_status": raw_status,
                "scrape_run_id": scrape_run_id,
            }),
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("_persist_vround_for_rfq(%s/%s) skipped: %s",
                     rfq_number, bqms_code, exc)


async def _persist_list_presence(
    db_pool,
    scrape_run_id: str | None,
    items: list[dict[str, Any]],
    *,
    full_list: bool = True,
) -> dict[str, Any]:
    """LIST-only presence snapshot (Batch 2C — Thang 2026-06-17).

    Called from the periodic cron path (drill_details=False) so the
    bqms_scrape_presence ledger is populated even without a per-RFQ drill.
    Without this, `prior_absent` is always False and the deterministic
    re-invite detector (reappear-after-absence) can never fire.

    For each REQUEST-level row seen ACTIVE this cycle we:
      * write a presence row (is_active=TRUE) with the parsed deadline +
        samsung_round (from `[New] QT.. / 2 th`) + raw status;
      * refresh bqms_rfq.deadline_dt / deadline_raw / last_seen_scrape_at.
    For every RFQ that was ACTIVE in the PREVIOUS snapshot but is NOT in this
    cycle's seen-set, we write ONE presence row with is_active=FALSE so the
    "dropped off the list → reappeared" signal becomes detectable.

    GUARDED + best-effort: probes the schema once; on ANY error it logs at
    debug and returns — it must NEVER abort a scrape. Returns a small summary.
    """
    out: dict[str, Any] = {
        "seen_active": 0, "marked_inactive": 0, "skipped_no_schema": False,
    }
    if db_pool is None or not items:
        return out

    async with db_pool.acquire() as conn:
        if not await _vround_schema_present(conn):
            out["skipped_no_schema"] = True
            return out

        # 1. Seen-active rows this cycle. One presence row per (rfq, NULL code)
        #    at the request level (the list view is request-level).
        seen: set[str] = set()
        for r in items:
            try:
                rfq_number = (r.get("reqNo") or "").strip()
                if not rfq_number:
                    continue
                # Skip Closed rows — they are not active candidates.
                if _is_closed_status(r):
                    continue
                if rfq_number in seen:
                    continue
                seen.add(rfq_number)

                deadline_raw = (r.get("deadlineDt") or "").strip() or None
                deadline_dt = None
                if deadline_raw and _parse_deadline_2c is not None:
                    try:
                        deadline_dt = _parse_deadline_2c(deadline_raw)
                    except Exception:
                        deadline_dt = None
                _, samsung_round = _parse_rfq_version(
                    r.get("reqName") or r.get("reqNo")
                )
                raw_status = (
                    r.get("progressStatusName") or r.get("submitGb") or ""
                ).strip() or None

                # 1a. Refresh deadline + last-seen marker on bqms_rfq (additive;
                #     never touches user-action columns). NULL code → all item
                #     rows of this request share the request-level deadline.
                await conn.execute(
                    """
                    UPDATE bqms_rfq
                       SET deadline_dt = COALESCE($1, deadline_dt),
                           deadline_raw = COALESCE($2, deadline_raw),
                           last_seen_scrape_at = NOW()
                     WHERE rfq_number = $3
                    """,
                    deadline_dt, deadline_raw, rfq_number,
                )
                # 1b. Append presence row (append-only ledger).
                await conn.execute(
                    """
                    INSERT INTO bqms_scrape_presence
                        (scrape_run_id, rfq_number, bqms_code, is_active,
                         samsung_round, deadline_dt, raw_status)
                    VALUES ($1, $2, NULL, TRUE, $3, $4, $5)
                    """,
                    scrape_run_id, rfq_number, samsung_round,
                    deadline_dt, raw_status,
                )
                out["seen_active"] += 1
            except Exception as exc:  # pragma: no cover - defensive
                logger.debug("list presence (active) skipped for %s: %s",
                             r.get("reqNo"), exc)

        # 2. Mark RFQs that DROPPED off the list inactive. "Previously active"
        #    = the latest presence row per RFQ has is_active=TRUE. Anything in
        #    that set but NOT seen this cycle gets ONE is_active=FALSE row.
        #    Idempotent: skip RFQs whose latest row is already inactive.
        #    ONLY when the full list was scraped — a truncated scrape would
        #    falsely mark unseen-but-still-active RFQs as dropped.
        if not full_list:
            return out
        try:
            prev_active = await conn.fetch(
                """
                SELECT DISTINCT ON (rfq_number) rfq_number, is_active
                  FROM bqms_scrape_presence
                 WHERE bqms_code IS NULL
                 ORDER BY rfq_number, seen_at DESC, id DESC
                """
            )
            for pr in prev_active:
                rfq = pr["rfq_number"]
                if not pr["is_active"]:
                    continue  # already inactive — don't spam duplicate rows
                if rfq in seen:
                    continue  # still active this cycle
                try:
                    await conn.execute(
                        """
                        INSERT INTO bqms_scrape_presence
                            (scrape_run_id, rfq_number, bqms_code, is_active,
                             samsung_round, deadline_dt, raw_status)
                        VALUES ($1, $2, NULL, FALSE, NULL, NULL, 'dropped_off_list')
                        """,
                        scrape_run_id, rfq,
                    )
                    out["marked_inactive"] += 1
                except Exception as exc:  # pragma: no cover - defensive
                    logger.debug("list presence (inactive) skipped for %s: %s", rfq, exc)
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("list presence dropped-off pass skipped: %s", exc)

    return out


async def _upsert_bqms_rfq(db_pool, items: list[dict[str, Any]]) -> int:
    """For each drilled bidding row's items, UPSERT into bqms_rfq.
    Match key: (rfq_number, bqms_code). Updates existing or inserts new.
    Sets data_source='etl' (existing CHECK constraint allows that).

    Batch 2C: also persists deadline_dt/current_round + appends scrape-presence
    and 'qt.scraped' events when the V-round tracking schema is present (guarded).
    """
    n = 0
    async with db_pool.acquire() as conn:
        # Probe once per run whether Batch-2C tracking schema exists.
        _track_2c = await _vround_schema_present(conn)
        _scrape_run_id = uuid.uuid4().hex
        for r in items:
            detail = r.get("_detail") or {}
            if detail.get("error"):
                continue
            rfq_number = detail.get("rfq_no_parsed") or (r.get("reqNo") or "").strip()
            if not rfq_number:
                continue
            version = int(detail.get("version") or 1)
            classification = detail.get("classification")
            attachments = detail.get("attachments") or []
            psincharge_name = (r.get("psinchargeName") or "").strip() or None
            # Phase 2 per Thang 2026-05-12: extract Requester + Department from
            # Basic Information section so we can show on BQMS table + use for
            # department analytics. Samsung uses different labels in different
            # portal versions — try EN + KO keys.
            basic_info = detail.get("basic_info") or {}
            # Per Thang 2026-05-12 audit: try MANY variants — Samsung labels
            # change across portal versions + the "Created by" field from
            # the user who posted the request often contains both requester
            # name and department in slash-separated format.
            def _pick(d: dict, *keys: str) -> str | None:
                for k in keys:
                    v = d.get(k)
                    if v and isinstance(v, str) and v.strip():
                        return v.strip()
                return None

            requester = _pick(
                basic_info,
                "Requester", "Request User", "Request user", "Inquiry user",
                "요청자", "Created by", "Created By", "creator",
                "Request Person", "PIC", "Person in Charge",
            )
            # If created_by/PIC has format "Vu Thi Hai/Strategy Procurement P /Samsung Vietnam",
            # split into name + department on first slash.
            if requester and "/" in requester:
                parts = [p.strip() for p in requester.split("/") if p.strip()]
                if len(parts) >= 2 and not basic_info.get("Department"):
                    # Override department detection if not found below
                    basic_info["__pic_dept_fallback__"] = parts[1]
                requester = parts[0]  # name only

            department = _pick(
                basic_info,
                "Department", "Request Dept", "Dept", "Request Department",
                "부서", "부서명", "Division", "Group",
            ) or basic_info.get("__pic_dept_fallback__")

            # Final fallback per Thang 2026-05-12: psincharge_name từ list row
            # đã có format "Name/Dept/Company" — dùng nó nếu basic_info trống.
            if (not requester or not department) and psincharge_name and "/" in psincharge_name:
                parts = [p.strip() for p in psincharge_name.split("/") if p.strip()]
                if not requester and parts:
                    requester = parts[0]
                if not department and len(parts) >= 2:
                    department = parts[1]
            inquiry_dt_text = r.get("regDt") or ""
            try:
                inquiry_date = (
                    __import__("datetime").date.fromisoformat(inquiry_dt_text[:10])
                    if inquiry_dt_text else None
                )
            except Exception:
                inquiry_date = None

            notes_lines = [
                f"[bidding scrape] classification={classification}",
                f"version={version}",
                f"attachments={len(attachments)}",
                f"deadline={r.get('deadlineDt') or ''}",
                f"manager={psincharge_name or ''}",
            ]
            notes = " | ".join(notes_lines)

            # Batch 2C: parse the Samsung deadline ONCE per row (reuse the
            # canonical parser). deadline_raw kept verbatim for audit.
            _deadline_raw = (r.get("deadlineDt") or "").strip() or None
            _deadline_dt = None
            if _track_2c and _deadline_raw and _parse_deadline_2c is not None:
                try:
                    _deadline_dt = _parse_deadline_2c(_deadline_raw)
                except Exception:
                    _deadline_dt = None
            _raw_status = (r.get("progressStatusName") or r.get("submitGb") or "").strip() or None

            for it in detail.get("items") or []:
                bqms_code = (it.get("item_code") or "").strip() or None
                if not bqms_code:
                    continue
                spec = (it.get("specification") or "").strip() or None
                maker = (it.get("maker") or "").strip() or None
                qty_raw = it.get("qty")
                try:
                    expected_qty = float(str(qty_raw).replace(",", "")) if qty_raw not in (None, "", "0") else None
                except (TypeError, ValueError):
                    expected_qty = None
                unit = (it.get("unit") or "").strip() or "EA"

                # SELECT-then-INSERT-or-UPDATE (no unique index on rfq_number,bqms_code)
                existing = await conn.fetchrow(
                    """
                    SELECT id, version, notes FROM bqms_rfq
                    WHERE rfq_number = $1 AND bqms_code = $2
                    LIMIT 1
                    """,
                    rfq_number, bqms_code,
                )
                if existing:
                    # Phase H: round-aware UPSERT.
                    # If incoming version > existing → log the bump event in
                    # notes so admin sees "Vòng 1 → 2 ngày X" history. Existing
                    # quoted_price_bqms_v1..v4 columns are NEVER touched here —
                    # admin keeps the price they entered for previous round.
                    old_version = existing["version"] or 1
                    is_bump = bool(existing["version"]) and version > existing["version"]
                    bumped_notes = notes
                    if is_bump:
                        bump_marker = (
                            f" | [round-bump v{existing['version']}→v{version} "
                            f"@ {datetime.now().strftime('%Y-%m-%d')}]"
                        )
                        bumped_notes = (notes or "") + bump_marker
                    await conn.execute(
                        """
                        UPDATE bqms_rfq
                        SET specification = COALESCE($1, specification),
                            maker = COALESCE($2, maker),
                            expected_qty = COALESCE($3, expected_qty),
                            unit = COALESCE($4, unit),
                            person_in_charge_name = COALESCE($5, person_in_charge_name),
                            inquiry_date = COALESCE($6, inquiry_date),
                            version = GREATEST(version, $7),
                            notes = $8,
                            requester = COALESCE($10, requester),
                            department = COALESCE($11, department),
                            updated_at = NOW()
                        WHERE id = $9
                        """,
                        spec, maker, expected_qty, unit,
                        psincharge_name, inquiry_date, version, bumped_notes, existing["id"],
                        requester, department,
                    )
                    # Notify person-in-charge on round bump V1→V2/V3 (per Thang 2026-05-12).
                    # Best-effort: failures are logged inside dispatch_rfq_version_bump.
                    if is_bump:
                        try:
                            from app.services.event_notifications import dispatch_rfq_version_bump
                            await dispatch_rfq_version_bump(
                                conn,
                                rfq_id=str(existing["id"]),
                                rfq_number=rfq_number,
                                bqms_code=bqms_code,
                                old_version=old_version,
                                new_version=version,
                                assigned_to=None,  # Phase 2: read existing.assigned_to once column lands
                                person_in_charge_name=psincharge_name,
                            )
                        except Exception as _exc:
                            pass
                else:
                    await conn.execute(
                        """
                        INSERT INTO bqms_rfq
                            (rfq_number, bqms_code, specification, maker,
                             expected_qty, unit, person_in_charge_name,
                             inquiry_date, version, data_source, notes,
                             customer_source, requester, department)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'etl', $10, 'samsung', $11, $12)
                        """,
                        rfq_number, bqms_code, spec, maker,
                        expected_qty, unit, psincharge_name,
                        inquiry_date, version, notes,
                        requester, department,
                    )

                # Batch 2C: persist deadline + presence + scraped-event
                # (guarded — no-op if tracking schema absent). Additive only;
                # does NOT touch user-action columns. current_round here mirrors
                # the Samsung round as the floor; the state engine raises it on
                # actual ERP quote/push.
                if _track_2c:
                    await _persist_vround_for_rfq(
                        conn,
                        rfq_number=rfq_number,
                        bqms_code=bqms_code,
                        deadline_raw=_deadline_raw,
                        deadline_dt=_deadline_dt,
                        samsung_round=version,
                        raw_status=_raw_status,
                        scrape_run_id=_scrape_run_id,
                        existing_round=None,
                    )

                n += 1
    return n


async def upsert_bqms_rfq_for_one_staging_row(db_pool, staging_raw_json: dict) -> int:
    """UPSERT bqms_rfq from ONE staging row's raw_json (must include _detail).

    Used by /vendor-staging/{id}/quote endpoint when admin clicks "Báo giá"
    on a single bidding RFQ. Same field mapping as _upsert_bqms_rfq but
    takes only one row's worth of data.
    """
    if not isinstance(staging_raw_json, dict):
        return 0
    return await _upsert_bqms_rfq(db_pool, [staging_raw_json])


# ─── Phase 2: per-RFQ file download + image extraction ─────────────────
# RFQ_ROOT is defined at top of module (used by smart_skip too).


def _rfq_folder_path(rfq_number: str, when: datetime | None = None) -> Path:
    """LEGACY (kept for backward-compat with smart_skip + old quote calls):
    `/data/.../Puplic/BQMS/RFQ/RFQ 2026/THANG 5/QT26061295/` — bare rfq_number.

    For NEW folders (per Thang 2026-05-10), use `_pretty_rfq_folder_path()`
    which encodes [QT]_[item]_[qty]_[deadline] in the folder name.
    """
    when = when or datetime.now()
    return RFQ_ROOT / f"RFQ {when.year}" / f"THANG {when.month}" / rfq_number


def _parse_deadline_for_folder(deadline_dt: str | None) -> tuple[str, str]:
    """Extract (`dd-MM`, `HHhMM`) from BQMS deadline string.

    BQMS deadlineDt comes in formats like:
      "(GMT+07:00) 5/15/2026 17:00"  → ("15-05", "17h00")
      "5/15/2026"                     → ("15-05", "")
      "" / None                       → ("", "")
    """
    if not deadline_dt:
        return "", ""
    import re
    m = re.search(r"(\d{1,2})/(\d{1,2})/\d{4}(?:\s+(\d{1,2}):(\d{2}))?", deadline_dt)
    if not m:
        return "", ""
    mm = m.group(1).zfill(2)  # month
    dd = m.group(2).zfill(2)  # day
    hh = (m.group(3) or "").zfill(2) if m.group(3) else ""
    mn = m.group(4) or ""
    date_part = f"{dd}-{mm}"
    time_part = f"{hh}h{mn}" if hh else ""
    return date_part, time_part


def _safe_folder_token(s: str | None) -> str:
    """Sanitize a string for use inside a folder name."""
    if not s:
        return ""
    import re
    s = str(s).strip()
    # Replace path/forbidden chars with -
    s = re.sub(r'[\\/:*?"<>|\n\r\t]+', "-", s)
    # Collapse repeated whitespace + trim
    s = re.sub(r"\s+", " ", s).strip()
    return s[:60]


def _build_pretty_folder_name(
    rfq_number: str,
    raw_row: dict | None,
) -> str:
    """Compose folder name for RFQ.

    NAMING (Thang 2026-05-19): `{Mã QT} {Số lượng tổng} {Deadline} {Giờ}`
        vd "QT26064572 500 19-05 2330"
    Spaces separator. Previously underscore + first_item code (kept logic
    for safe fallback if qty/deadline missing).

    Falls back gracefully — empty fields just collapse, never inject "None".
    """
    rfq = (rfq_number or "").strip() or "UNKNOWN"
    detail = (raw_row or {}).get("_detail") or {}
    items = detail.get("items") or []
    qty_total = 0
    for it in items:
        try:
            qty_total += int(float(it.get("qty") or it.get("quantity") or 0))
        except (TypeError, ValueError):
            pass
    deadline = (raw_row or {}).get("deadlineDt") or ""
    date_part, time_part = _parse_deadline_for_folder(deadline)

    # NEW format (Thang 2026-05-19): space-separator, no first_item code
    parts = [rfq]
    if qty_total > 0:
        parts.append(str(qty_total))
    if date_part:
        parts.append(date_part)
    if time_part:
        parts.append(time_part)
    return " ".join(parts)


def _pretty_rfq_folder_path(
    rfq_number: str,
    raw_row: dict | None,
    when: datetime | None = None,
) -> Path:
    """Per-RFQ folder using the pretty naming convention.
    Falls back to bare rfq_number if no extra metadata available."""
    when = when or datetime.now()
    name = _build_pretty_folder_name(rfq_number, raw_row)
    return RFQ_ROOT / f"RFQ {when.year}" / f"THANG {when.month}" / name


def find_existing_rfq_folder(
    rfq_number: str,
    when: datetime | None = None,
) -> Path | None:
    """Find an existing folder for a RFQ, regardless of naming convention.

    Searches the month dir for any folder starting with `<rfq_number>_` (new
    pretty format) OR exactly named `<rfq_number>` (legacy). Returns the first
    match by name (most recent if multiple) or None if not found.
    """
    when = when or datetime.now()
    month_dir = RFQ_ROOT / f"RFQ {when.year}" / f"THANG {when.month}"
    if not month_dir.exists():
        return None
    candidates: list[Path] = []
    for p in month_dir.iterdir():
        if not p.is_dir():
            continue
        # Match: bare RFQ, RFQ_<extra> (old pattern), or RFQ <extra> (new pattern with space)
        if (p.name == rfq_number
                or p.name.startswith(f"{rfq_number}_")
                or p.name.startswith(f"{rfq_number} ")):
            candidates.append(p)
    if not candidates:
        return None
    # Prefer pretty (longer) names; if tied, latest mtime
    candidates.sort(key=lambda x: (len(x.name), x.stat().st_mtime), reverse=True)
    return candidates[0]


def ensure_rfq_folder_on_scrape(
    rfq_number: str,
    raw_row: dict | None,
    when: datetime | None = None,
) -> Path | None:
    """Create the pretty folder at scrape time (status=pending_review).
    Per Thang 2026-05-10: kể cả chưa duyệt cũng có folder.

    Idempotent: returns existing folder if one is found by `find_existing_rfq_folder`.
    Otherwise creates a fresh pretty-named folder + empty `raw/` and `images/`
    subdirs so the path is immediately browsable from the UI.
    """
    if not rfq_number:
        return None
    existing = find_existing_rfq_folder(rfq_number, when)
    if existing:
        return existing
    target = _pretty_rfq_folder_path(rfq_number, raw_row, when)
    try:
        target.mkdir(parents=True, exist_ok=True)
        (target / "raw").mkdir(exist_ok=True)
        (target / "images").mkdir(exist_ok=True)
        logger.info("scrape: pre-created folder %s", target)
    except OSError as exc:
        logger.warning("scrape: failed to create folder %s: %s", target, exc)
        return None
    return target


def quote_round_subfolder(parent_folder: Path, rfq_number: str, round_n: int = 1) -> Path:
    """Create + return the per-round quotation subfolder.

    NAMING (Thang 2026-05-19): `{rfq_number}_AMABACNINH_L{round}` (no spaces).
    Previous pattern `{rfq_number}_AMA BAC NINH_L{round}` (with spaces) kept
    for backward-compat lookup in `_find_round_folder_bqms` — file cũ giữ nguyên.

    Used by both TM (Thương Mại) and GC (Gia Công) quote flows.

    HISTORY PRESERVATION (Thang 2026-05-21):
    If the L{round_n} folder already exists with files inside (i.e. user is
    REGENERATING the same round), the old folder is renamed to
    `{rfq}_AMABACNINH_L{n}.archived_YYYYMMDD_HHMMSS/` before a fresh empty
    folder is created. This way:
      - The "live" round folder always has the latest báo giá (clean name
        → push-preview / attachments / find_round_folder all keep working)
      - Previous generations preserved as siblings → user can browse history
        in /documents/browser, and a cron can purge archives > N days later
    """
    from datetime import datetime as _dt
    name = f"{rfq_number}_AMABACNINH_L{round_n}"
    sub = parent_folder / name

    # If folder exists AND has any file inside → archive before reuse.
    # (Empty folder = previous generation crashed early; safe to reuse.)
    if sub.exists() and sub.is_dir():
        try:
            has_content = any(sub.iterdir())
        except OSError:
            has_content = False
        if has_content:
            ts = _dt.now().strftime("%Y%m%d_%H%M%S")
            archive = parent_folder / f"{name}.archived_{ts}"
            # Defensive: if archive name collides (same second), append counter
            counter = 1
            while archive.exists():
                archive = parent_folder / f"{name}.archived_{ts}_{counter}"
                counter += 1
            try:
                sub.rename(archive)
                logger.info(
                    "quote_round_subfolder: archived previous L%d → %s",
                    round_n, archive.name,
                )
            except OSError as exc:
                # Archive rename failed (e.g. cross-device, permission) — fall
                # back to old behavior (folder reused, files may overwrite).
                # Better than blocking the user.
                logger.warning(
                    "quote_round_subfolder: archive of %s failed (%s) — "
                    "falling back to in-place reuse",
                    sub, exc,
                )

    sub.mkdir(parents=True, exist_ok=True)
    return sub


_IMG_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff")
# Skip .emf/.wmf entirely — Samsung's RFQ template embeds two ~2.4KB EMF
# watermark icons in EVERY file; they pollute the output and aren't real
# product photos. If a real vector ever shows up, raise this back to include emf.
_MIN_IMAGE_SIZE_BYTES = 3072  # Real product photos are 5KB+; placeholders are ≤ 3KB


def _item_code_from_xlsx_filename(name: str) -> str | None:
    """Find a Samsung BQMS item code anywhere in an xlsx filename.

    Item codes have a stable shape:
      <1-3 letters><2-8 alnum>-<4-8 digits>
    Real-world examples scraped from production:
      Z0000002-010845, RC01H00I-000413, RG00H008-001592,
      RJ001001-243470, RC01E003-000311

    Filename patterns observed (Samsung is messy — handles all of these):
      RFQ_Z0000002-010845_Gripper.xlsx          ← canonical
      RFQ_RG00H008-001592.xlsx                  ← no _<rest>
      0506_RFQ_Z0000002-544158_Bracket.xlsx     ← date prefix
      RFQ FORM Z0000002-535751-BRACKET.xlsx     ← space-separated, dashes in name
      Form RFQ Request-Z0000002-542172_FRAME.xlsx
      70. RFQ local Z0000002-456721_tool.xlsx
      From RFQ_SMD_Z0000002-541855.xlsx         ← prefix tokens before code
      RFQ RC01E003-000311.xlsx                  ← space after RFQ
      MICPRESS Z0000002-365398.xlsx             ← maker prefix
      Z0000001-362569 (2).xlsx                  ← bare code with version

    Also handles tail-noise filenames (List, From RFQ_SMD_...) that have NO
    valid item code → returns None → caller skips.
    """
    import re
    # Find FIRST occurrence of pattern <letters><alnum>-<digits>.
    # IMPORTANT: don't use \b — Python regex considers "_" a word char, so
    # \b doesn't match between "_" and a code start (e.g. "0506_RFQ_Z0000002-...")
    # which is a common Samsung filename pattern. Use lookbehind/lookahead with
    # explicit alphanumeric class instead — recognizes "_", " ", ".", "-" as
    # separators correctly.
    matches = re.findall(
        r"(?<![A-Za-z0-9])([A-Z]{1,3}[0-9A-Z]{4,8}-[0-9]{4,8})(?![A-Za-z0-9])",
        name,
        re.IGNORECASE,
    )
    if not matches:
        return None
    return matches[0].upper()


def _sanitized_xlsx_stem(name: str) -> str:
    """Make a filesystem-safe prefix from xlsx filename when no item code
    can be parsed. Falls back so we never silently lose a real image."""
    import re
    stem = name.rsplit(".", 1)[0]
    # Strip "(N)" version, common prefixes/suffixes for cleanliness
    stem = re.sub(r"\s*\(\d+\)\s*$", "", stem)
    # Replace whitespace and unsafe chars with underscore, collapse runs
    stem = re.sub(r"[^A-Za-z0-9\-_.]+", "_", stem)
    stem = re.sub(r"_+", "_", stem).strip("_")
    return stem[:80] or "unknown"


def _extract_images_from_xlsx(xlsx_path: Path, image_dir: Path) -> int:
    """[Legacy] Per-file extraction without cross-file dedup.

    Kept for backward compatibility. New code should use
    `_extract_images_for_rfq_folder` which dedups across all xlsx files
    in the folder — needed because Samsung's RFQ_<code>.xlsx files often
    share the same template/header/footer images across multiple item codes.
    Per Thang 2026-05-11: extracting all images per file caused multiple
    item codes to display IDENTICAL images.
    """
    import zipfile

    item_code = _item_code_from_xlsx_filename(xlsx_path.name)
    if item_code:
        prefix = item_code
        is_fallback = False
    else:
        prefix = _sanitized_xlsx_stem(xlsx_path.name)
        is_fallback = True

    image_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    try:
        with zipfile.ZipFile(xlsx_path, "r") as zf:
            for entry_info in zf.infolist():
                entry = entry_info.filename
                if not entry.startswith("xl/media/image"):
                    continue
                if not any(entry.lower().endswith(ext) for ext in _IMG_EXTS):
                    continue
                if entry_info.file_size < _MIN_IMAGE_SIZE_BYTES:
                    continue
                n += 1
                ext = Path(entry).suffix.lower()
                marker = "_unmapped" if is_fallback else ""
                out = image_dir / f"{prefix}{marker}_{n}{ext}"
                with zf.open(entry) as src, open(out, "wb") as dst:
                    dst.write(src.read())
    except (zipfile.BadZipFile, OSError) as exc:
        logger.warning("xlsx image extract failed for %s: %s", xlsx_path.name, exc)
    return n


# Backward-compat alias
_extract_images_from_rfq_xlsx = _extract_images_from_xlsx


def _xlsx_content_codes(zf) -> set[str]:
    """Extract ALL Samsung item codes referenced inside an xlsx file.

    Reads `xl/sharedStrings.xml` (where Excel stores all unique text values
    used in cells) + sheet names from `xl/workbook.xml`. Returns the SET of
    Samsung-pattern codes found.

    Used to VERIFY that the item code parsed from the filename actually
    appears in the file's content — protects against:
      - Filename typos / Samsung accidentally renamed files
      - Generic template files (no real item code in content) attributed
        to whatever stem the filename has
    """
    import re as _re
    codes: set[str] = set()
    pattern = _re.compile(
        r"(?<![A-Za-z0-9])([A-Z]{1,3}[0-9A-Z]{4,8}-[0-9]{4,8})(?![A-Za-z0-9])"
    )
    # 1) Shared strings (most text content lives here)
    try:
        if "xl/sharedStrings.xml" in zf.namelist():
            ss = zf.read("xl/sharedStrings.xml").decode("utf-8", "replace")
            codes.update(pattern.findall(ss))
    except Exception:
        pass
    # 2) Sheet names (some Samsung templates use the code as sheet name)
    try:
        if "xl/workbook.xml" in zf.namelist():
            wb_xml = zf.read("xl/workbook.xml").decode("utf-8", "replace")
            codes.update(pattern.findall(wb_xml))
    except Exception:
        pass
    return {c.upper() for c in codes}


def _attribute_workbook_images(zf, content_codes: set[str], xlsx_name: str) -> dict[str, str]:
    """For a multi-code Samsung workbook, map each xl/media/imageK.<ext> entry
    to the bqms_code of the sheet it lives on.

    Returns a dict {media_entry_name: bqms_code} containing ONLY the images for
    which a confident sheet→code attribution was found. Callers fall back to the
    existing `_shared_/_unverified_/_unmapped_` rules for any image NOT present
    in the returned map.

    The chain is workbook.xml → workbook.xml.rels → sheetN.xml (cells +
    sharedStrings) → sheetN.xml.rels → drawingM.xml → drawingM.xml.rels →
    imageK. Anything unexpected (missing rels, malformed XML, etc.) is
    swallowed — callers see an empty map and the legacy code path takes over.
    """
    import re as _re
    import xml.etree.ElementTree as ET
    from posixpath import normpath as _pnorm

    # XML namespaces used across the OOXML parts we touch
    NS = {
        "m":   "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "r":   "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "pr":  "http://schemas.openxmlformats.org/package/2006/relationships",
        "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
        "a":   "http://schemas.openxmlformats.org/drawingml/2006/main",
    }
    SAMSUNG_RE = _re.compile(
        r"(?<![A-Za-z0-9])([A-Z]{1,3}[0-9A-Z]{4,8}-[0-9]{4,8})(?![A-Za-z0-9])"
    )

    names = set(zf.namelist())

    def _read(path: str) -> str | None:
        try:
            return zf.read(path).decode("utf-8", "replace")
        except Exception:
            return None

    def _resolve(base_dir: str, target: str) -> str:
        # OOXML rels Targets are relative to the .rels file's directory.
        # Normalize "../media/image1.png" against "xl/worksheets" → "xl/media/image1.png".
        return _pnorm(f"{base_dir}/{target}").lstrip("/")

    try:
        # ---- 1) Shared strings (for resolving <c t='s'><v>idx</v></c>) ----
        shared_strings: list[str] = []
        ss_xml = _read("xl/sharedStrings.xml")
        if ss_xml:
            try:
                ss_root = ET.fromstring(ss_xml)
                for si in ss_root.findall("m:si", NS):
                    # Concatenate all <t> descendants (handles rich-text runs)
                    txt = "".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t"))
                    shared_strings.append(txt)
            except ET.ParseError:
                shared_strings = []

        # ---- 2) workbook.xml → ordered sheet list (name, rId) ----
        wb_xml = _read("xl/workbook.xml")
        if not wb_xml:
            return {}
        wb_root = ET.fromstring(wb_xml)
        sheets: list[tuple[str, str]] = []  # [(display_name, rId), ...]
        for s in wb_root.findall("m:sheets/m:sheet", NS):
            sheets.append((s.get("name") or "", s.get(f"{{{NS['r']}}}id") or ""))
        if not sheets:
            return {}

        # ---- 3) workbook.xml.rels → rId → worksheet path ----
        wb_rels_xml = _read("xl/_rels/workbook.xml.rels")
        if not wb_rels_xml:
            return {}
        wb_rels_root = ET.fromstring(wb_rels_xml)
        rid_to_target: dict[str, str] = {}
        for rel in wb_rels_root.findall("pr:Relationship", NS):
            rid_to_target[rel.get("Id") or ""] = rel.get("Target") or ""

        # sheet_path (e.g. "xl/worksheets/sheet1.xml") → display name
        sheet_path_to_name: dict[str, str] = {}
        # Preserve declaration order for later ordered-fallback logic.
        ordered_sheet_paths: list[str] = []
        for name, rid in sheets:
            tgt = rid_to_target.get(rid, "")
            if not tgt:
                continue
            sp = _resolve("xl", tgt)
            sheet_path_to_name[sp] = name
            ordered_sheet_paths.append(sp)

        # ---- 4) Per-sheet: build row→code map AND a sheet-level fallback ----
        # row→code is needed for single-sheet multi-row workbooks (Samsung's
        # newer template puts every item on its own row of Sheet1 with the
        # BQMS Code in a fixed column). sheet_code is the legacy fallback for
        # multi-sheet workbooks where each tab is one item.
        sheet_code: dict[str, str] = {}
        sheet_row_code: dict[str, dict[int, str]] = {}  # sp -> {row_index_1based: code}
        sheet_ordered_codes: dict[str, list[str]] = {}  # sp -> codes in row order
        for sp in ordered_sheet_paths:
            if sp not in names:
                continue
            sx = _read(sp)
            if not sx:
                continue
            try:
                sroot = ET.fromstring(sx)
            except ET.ParseError:
                sroot = None

            row_map: dict[int, str] = {}
            ordered: list[str] = []
            if sroot is not None:
                rows = sroot.findall("m:sheetData/m:row", NS)
                for row in rows:
                    try:
                        rnum = int(row.get("r") or "0")
                    except ValueError:
                        rnum = 0
                    if rnum <= 0:
                        continue
                    for c in row.findall("m:c", NS):
                        v = c.find("m:v", NS)
                        text_val: str | None = None
                        if v is not None and v.text is not None:
                            if c.get("t") == "s":
                                try:
                                    text_val = shared_strings[int(v.text)]
                                except (ValueError, IndexError):
                                    text_val = None
                            else:
                                text_val = v.text
                        else:
                            is_el = c.find("m:is", NS)
                            if is_el is not None:
                                text_val = "".join(
                                    t.text or "" for t in is_el.iter(f"{{{NS['m']}}}t")
                                )
                        if not text_val:
                            continue
                        m = SAMSUNG_RE.search(text_val)
                        if not m:
                            continue
                        cand = m.group(1).upper()
                        if cand not in content_codes:
                            continue
                        # Record only the FIRST code-bearing cell for this row.
                        if rnum not in row_map:
                            row_map[rnum] = cand
                            ordered.append(cand)
                        # Don't break — keep scanning cells to be safe, but a
                        # single hit per row is the common Samsung layout.
            sheet_row_code[sp] = row_map
            sheet_ordered_codes[sp] = ordered

            # Sheet-level legacy fallback: prefer first header-row code (1-8),
            # else first code anywhere, else sheet name.
            found: str | None = None
            if row_map:
                for rnum in sorted(row_map):
                    if 1 <= rnum <= 8:
                        found = row_map[rnum]
                        break
                if not found:
                    found = row_map[sorted(row_map)[0]]
            if not found:
                m = SAMSUNG_RE.search(sheet_path_to_name.get(sp, ""))
                if m and m.group(1).upper() in content_codes:
                    found = m.group(1).upper()
            if found:
                sheet_code[sp] = found

        # ---- 5) sheetN.xml.rels → drawingM.xml ----
        sheet_to_drawing: dict[str, str] = {}
        for sp in ordered_sheet_paths:
            sheet_dir = sp.rsplit("/", 1)[0]
            rels_path = f"{sheet_dir}/_rels/{sp.rsplit('/', 1)[1]}.rels"
            if rels_path not in names:
                continue
            rx = _read(rels_path)
            if not rx:
                continue
            try:
                rroot = ET.fromstring(rx)
            except ET.ParseError:
                continue
            for rel in rroot.findall("pr:Relationship", NS):
                typ = rel.get("Type") or ""
                if typ.endswith("/drawing"):
                    sheet_to_drawing[sp] = _resolve(sheet_dir, rel.get("Target") or "")
                    break

        # ---- 6) drawingM.xml + rels → per-anchor row → row→code ----
        # Two phases:
        #   6a (preferred): parse <xdr:twoCellAnchor>/<xdr:oneCellAnchor> in
        #       drawing1.xml. Each anchor carries <xdr:from><xdr:row> (the row
        #       index, 0-based) and an embedded <xdr:blipFill><a:blip r:embed=
        #       "rIdN"/> pointing to the image rel. Map row → BQMS code via
        #       sheet_row_code (walking upward to handle merged header rows).
        #       This is the ONLY correct strategy for single-sheet, multi-row
        #       Samsung workbooks (probed 2026-06-02 — drawing1 holds N images
        #       for N item rows on Sheet1).
        #   6b (fallback): if anchor parsing yields no result, fall back to the
        #       legacy per-sheet single-code strategy.
        media_to_code: dict[str, str] = {}
        debug_chain: list[str] = []

        for sp, drawing_path in sheet_to_drawing.items():
            row_map = sheet_row_code.get(sp, {})
            ordered_codes = sheet_ordered_codes.get(sp, [])
            sheet_fallback_code = sheet_code.get(sp)

            drawing_dir = drawing_path.rsplit("/", 1)[0]
            d_rels_path = f"{drawing_dir}/_rels/{drawing_path.rsplit('/', 1)[1]}.rels"

            # Build rId → media_path from drawing rels
            rid_to_media: dict[str, str] = {}
            if d_rels_path in names:
                drx = _read(d_rels_path)
                if drx:
                    try:
                        droot = ET.fromstring(drx)
                        for rel in droot.findall("pr:Relationship", NS):
                            typ = rel.get("Type") or ""
                            if typ.endswith("/image"):
                                tgt = rel.get("Target") or ""
                                rid_to_media[rel.get("Id") or ""] = _resolve(
                                    drawing_dir, tgt,
                                )
                    except ET.ParseError:
                        pass

            # ---- 6a: parse anchors for per-image row index ----
            anchor_resolutions: list[tuple[str, int, str | None]] = []
            # list of (media_path, anchor_row_1based, resolved_code_or_None)
            if drawing_path in names:
                dxml = _read(drawing_path)
                if dxml:
                    try:
                        dgroot = ET.fromstring(dxml)
                        anchors: list = []
                        anchors.extend(dgroot.findall("xdr:twoCellAnchor", NS))
                        anchors.extend(dgroot.findall("xdr:oneCellAnchor", NS))
                        # absoluteAnchor has no <from><row>; skip (row-less anchors
                        # are extremely rare in Samsung workbooks).
                        for anc in anchors:
                            from_el = anc.find("xdr:from", NS)
                            if from_el is None:
                                continue
                            row_el = from_el.find("xdr:row", NS)
                            if row_el is None or row_el.text is None:
                                continue
                            try:
                                # xdr:row is 0-based; sheetData rows are 1-based.
                                anchor_row0 = int(row_el.text.strip())
                            except ValueError:
                                continue
                            anchor_row = anchor_row0 + 1

                            blip = anc.find(
                                "xdr:pic/xdr:blipFill/a:blip", NS,
                            )
                            if blip is None:
                                continue
                            embed = blip.get(f"{{{NS['r']}}}embed") or ""
                            media_path = rid_to_media.get(embed, "")
                            if not media_path or not media_path.startswith("xl/media/"):
                                continue
                            if media_path not in names:
                                continue

                            # Resolve row → code. Try exact row first, then walk
                            # UP to the nearest preceding row with a code (Samsung
                            # often anchors images a few rows below the data row
                            # holding the code, especially when row height is
                            # split for image display).
                            resolved: str | None = row_map.get(anchor_row)
                            if not resolved and row_map:
                                # Walk upward
                                for r in sorted(
                                    [r for r in row_map if r <= anchor_row],
                                    reverse=True,
                                ):
                                    resolved = row_map[r]
                                    break
                            # If still nothing, try walking DOWN (image anchored
                            # above its row, less common but possible).
                            if not resolved and row_map:
                                for r in sorted(
                                    [r for r in row_map if r > anchor_row]
                                ):
                                    resolved = row_map[r]
                                    break
                            anchor_resolutions.append((media_path, anchor_row, resolved))
                    except ET.ParseError:
                        pass

            # ---- 6b: decide attribution per image ----
            # Prefer anchor-resolved codes. If anchors yielded nothing usable,
            # fall back to Phase B-style ordered mapping (image order vs.
            # ordered_codes). Last resort: sheet-level single code (legacy).
            anchor_resolved_any = any(c for _, _, c in anchor_resolutions)

            if anchor_resolved_any:
                # Group resolutions per media (dedup; same media may appear in
                # multiple anchors theoretically — mark ambiguous if codes differ).
                per_media: dict[str, set[str]] = {}
                for mpath, _arow, c in anchor_resolutions:
                    if c:
                        per_media.setdefault(mpath, set()).add(c)
                for mpath, code_set in per_media.items():
                    if len(code_set) == 1:
                        code = next(iter(code_set))
                        prev = media_to_code.get(mpath)
                        if prev and prev != code:
                            media_to_code[mpath] = ""  # ambiguous sentinel
                        elif prev != "":
                            media_to_code[mpath] = code
                debug_chain.append(
                    f"sheet={sp} mode=anchor-row "
                    f"row_map_rows={sorted(row_map)} "
                    f"anchors=[" + ", ".join(
                        f"({m.rsplit('/',1)[1]}@row{ar}->{c or '?'})"
                        for m, ar, c in anchor_resolutions
                    ) + "]"
                )
            else:
                # Phase B fallback: ordered pairing of images to codes by
                # insertion order. Only safe when image count == code count.
                anchor_media_in_order = [
                    m for m, _r, _c in anchor_resolutions if m
                ]
                # If no anchor parsing succeeded, fall back to rid order
                ordered_media: list[str] = anchor_media_in_order or [
                    rid_to_media[k]
                    for k in sorted(rid_to_media)
                    if rid_to_media[k].startswith("xl/media/")
                    and rid_to_media[k] in names
                ]
                if ordered_codes and len(ordered_media) == len(ordered_codes):
                    for mpath, code in zip(ordered_media, ordered_codes):
                        prev = media_to_code.get(mpath)
                        if prev and prev != code:
                            media_to_code[mpath] = ""
                        elif prev != "":
                            media_to_code[mpath] = code
                    debug_chain.append(
                        f"sheet={sp} mode=ordered-fallback "
                        f"codes={ordered_codes} "
                        f"media_count={len(ordered_media)}"
                    )
                elif sheet_fallback_code:
                    # Legacy: all images on this sheet get the same code.
                    # This is the OLD behavior that caused the bug for
                    # single-sheet multi-row workbooks; we only land here when
                    # neither anchor nor ordered mapping is viable.
                    for mpath in (rid_to_media.values()):
                        if not mpath.startswith("xl/media/") or mpath not in names:
                            continue
                        prev = media_to_code.get(mpath)
                        if prev and prev != sheet_fallback_code:
                            media_to_code[mpath] = ""
                        elif prev != "":
                            media_to_code[mpath] = sheet_fallback_code
                    debug_chain.append(
                        f"sheet={sp} mode=sheet-legacy code={sheet_fallback_code}"
                    )
                else:
                    debug_chain.append(
                        f"sheet={sp} mode=unresolved "
                        f"(no anchor row, no ordered match, no sheet code)"
                    )

        if debug_chain:
            logger.info(
                "multi-code attr resolution chain (xlsx=%s): %s",
                xlsx_name, " | ".join(debug_chain),
            )

        # Strip ambiguous sentinels
        return {k: v for k, v in media_to_code.items() if v}
    except Exception as exc:  # noqa: BLE001 — never raise from attribution
        logger.warning(
            "multi-code attribution parse failed for %s: %s", xlsx_name, exc,
        )
        return {}


def _extract_images_for_rfq_folder(raw_dir: Path, image_dir: Path) -> int:
    """Smart cross-file image extraction with content verification + hash dedup.

    Per Thang 2026-05-11 (round 2): the item code parsed from the xlsx
    FILENAME must ALSO appear in the xlsx CONTENT (sharedStrings + sheet
    names). This prevents attributing images to wrong codes when:
      - Filename has a typo'd code
      - Samsung renamed the file with a wrong code
      - File is a generic template with no real code in content

    Flow:
      1. For each xlsx, parse filename code AND scan content for all codes
      2. VERIFY filename code is in content. If not verified:
         - If content has exactly 1 Samsung code → use that (filename was wrong)
         - Else → mark as `_unverified_<stem>` (no per-code attribution)
      3. Hash images cross-file:
         - Unique to 1 verified code → save as `<code>_<seq>.<ext>`
         - Shared across N codes → save as `_shared_<hash8>_<seq>.<ext>`
         (per-code glob `<code>_*` ignores `_shared_*` and `_unverified_*`)

    Returns total count of images written.
    """
    import zipfile, hashlib
    from collections import defaultdict

    image_dir.mkdir(parents=True, exist_ok=True)

    # Pass 1: hash + verify per xlsx
    # hash → list of {code, ext, data, xlsx_name}
    by_hash: dict[str, list[dict]] = defaultdict(list)
    verification_log: list[str] = []

    for xlsx_path in sorted(raw_dir.glob("*.xlsx")):
        filename_code = _item_code_from_xlsx_filename(xlsx_path.name)
        try:
            with zipfile.ZipFile(xlsx_path, "r") as zf:
                content_codes = _xlsx_content_codes(zf)

                # Verification: is filename code in xlsx content?
                if filename_code and filename_code in content_codes:
                    item_code = filename_code
                    verification_log.append(
                        f"{xlsx_path.name}: ✓ filename code {filename_code} verified in content"
                    )
                elif filename_code:
                    # Filename had a code but it's NOT in content.
                    # If content has exactly 1 Samsung code → use that.
                    if len(content_codes) == 1:
                        item_code = next(iter(content_codes))
                        verification_log.append(
                            f"{xlsx_path.name}: filename code {filename_code} NOT in content; "
                            f"using sole content code {item_code} instead"
                        )
                    else:
                        item_code = f"_unverified_{filename_code}"
                        verification_log.append(
                            f"{xlsx_path.name}: ✗ filename code {filename_code} NOT in content "
                            f"(content has {len(content_codes)} codes: {sorted(content_codes)[:3]}...); "
                            f"marking unverified"
                        )
                else:
                    # No code in filename — if content has exactly 1 → use it.
                    if len(content_codes) == 1:
                        item_code = next(iter(content_codes))
                        verification_log.append(
                            f"{xlsx_path.name}: no filename code, using sole content code {item_code}"
                        )
                    else:
                        item_code = _sanitized_xlsx_stem(xlsx_path.name) + "_unmapped"
                        verification_log.append(
                            f"{xlsx_path.name}: no filename code, "
                            f"{len(content_codes)} content codes — unmapped"
                        )

                # Phase 0 — Pre-flight: only run the multi-code sheet→code
                # attribution chain when the workbook contains 2+ Samsung
                # codes. Single-code workbooks (95% of cases) skip this and
                # use the legacy attribution above unchanged → zero regression.
                multi_code_map: dict[str, str] = {}
                images_seen = 0
                images_mapped_via_sheet = 0
                if len(content_codes) >= 2:
                    multi_code_map = _attribute_workbook_images(
                        zf, content_codes, xlsx_path.name,
                    )

                # Now hash all images
                for entry_info in zf.infolist():
                    entry = entry_info.filename
                    if not entry.startswith("xl/media/image"):
                        continue
                    if not any(entry.lower().endswith(ext) for ext in _IMG_EXTS):
                        continue
                    if entry_info.file_size < _MIN_IMAGE_SIZE_BYTES:
                        continue
                    data = zf.read(entry)
                    h = hashlib.md5(data).hexdigest()
                    ext = Path(entry).suffix.lower()
                    sheet_code_for_entry = multi_code_map.get(entry)
                    # When a sheet→code attribution is available, prefer it
                    # over the workbook-level item_code (which is `_unmapped_`
                    # for multi-code books). Cross-file `_shared_` dedup in
                    # pass 2 still wins when the same hash appears under
                    # different codes — header/footer images repeat legit.
                    effective_code = sheet_code_for_entry or item_code
                    images_seen += 1
                    if sheet_code_for_entry:
                        images_mapped_via_sheet += 1
                    by_hash[h].append({
                        "code": effective_code,
                        "ext": ext,
                        "data": data,
                        "xlsx_name": xlsx_path.name,
                        "sheet_code": sheet_code_for_entry or "",
                        "attribution_mode": (
                            "deterministic" if sheet_code_for_entry else "legacy"
                        ),
                    })

                # Phase C — structured log per multi-code workbook
                if len(content_codes) >= 2:
                    mode = (
                        "deterministic" if images_mapped_via_sheet == images_seen and images_seen > 0
                        else "partial" if images_mapped_via_sheet > 0
                        else "unmapped"
                    )
                    msg = (
                        f"multi-code attr: xlsx={xlsx_path.name} "
                        f"codes={sorted(content_codes)} "
                        f"images={images_seen} mapped={images_mapped_via_sheet} "
                        f"mode={mode}"
                    )
                    logger.info(msg)
                    verification_log.append(msg)
        except (zipfile.BadZipFile, OSError) as exc:
            logger.warning("hash scan failed for %s: %s", xlsx_path.name, exc)

    # Log verification results
    for entry in verification_log[:30]:
        logger.info("  verify: %s", entry)

    # Pass 2: write images
    # Per-code sequence counters so filenames are deterministic
    seq_per_code: dict[str, int] = defaultdict(int)
    shared_seq = 0
    total_written = 0
    n_unique = 0
    n_shared = 0
    for h, occurrences in by_hash.items():
        # Distinct codes that contain this image
        codes = {o["code"] for o in occurrences}
        ext = occurrences[0]["ext"]
        data = occurrences[0]["data"]
        if len(codes) == 1:
            # UNIQUE to one code → save under that code
            code = next(iter(codes))
            seq_per_code[code] += 1
            seq = seq_per_code[code]
            out = image_dir / f"{code}_{seq}{ext}"
            out.write_bytes(data)
            n_unique += 1
            total_written += 1
        else:
            # SHARED across multiple codes (template/header/footer)
            # → save under `_shared_<hash8>` so per-code glob skips it
            shared_seq += 1
            out = image_dir / f"_shared_{h[:8]}_{shared_seq}{ext}"
            out.write_bytes(data)
            n_shared += 1
            total_written += 1
            logger.info(
                "shared image (in %d codes: %s) → %s",
                len(codes), ", ".join(sorted(codes))[:120], out.name,
            )

    logger.info(
        "smart image extract: %d unique + %d shared = %d total from %d xlsx",
        n_unique, n_shared, total_written,
        len(list(raw_dir.glob("*.xlsx"))),
    )
    return total_written


async def _index_rfq_images_inline(db_pool, rfq_number: str, images_dir: Path) -> int:
    """Immediately upsert just-extracted code-attributed images into
    `bqms_image_index` so the BQMS list shows them on the very next render.

    Without this, the periodic crawler (`bqms_image_index_crawl`) only runs
    every 6 hours, leaving up to a 6h window where the column shows the
    no-image placeholder despite the file being on disk. The lookup endpoint
    falls back to filesystem-scan in that window, but the scan is slower
    and prone to misses (case sensitivity, year/month range, etc.).

    Skips `_unverified_*` and `_shared_*` filenames — those don't have a
    reliable per-code mapping, and the lookup endpoint already filters them.

    Best-effort: any DB error is logged and swallowed; the periodic crawler
    will eventually pick the same files up. Never blocks the scrape.
    """
    if not images_dir.exists() or not images_dir.is_dir() or db_pool is None:
        return 0

    import re as _re_local
    rows: list[tuple] = []
    for p in images_dir.iterdir():
        if not p.is_file():
            continue
        nl = p.name.lower()
        if not nl.endswith((".png", ".jpg", ".jpeg", ".gif")):
            continue
        if nl.startswith("_unverified_") or nl.startswith("_shared_"):
            continue
        stem = p.stem
        # `<code>__product_photo` (override) → code is left of `__`
        if "__" in stem:
            stem = stem.split("__", 1)[0]
        # `<code>_<seq>` → code is left of first `_`
        code = stem.split("_", 1)[0]
        if not _re_local.search(r"\d", code) or not (6 <= len(code) <= 40):
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        rows.append((
            code, str(p), "rfq", rfq_number, st.st_size,
            datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
        ))

    if not rows:
        return 0

    try:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                await conn.executemany(
                    """
                    INSERT INTO bqms_image_index
                        (bqms_code, image_path, source, rfq_number, file_size, mtime, indexed_at)
                    VALUES ($1, $2, $3, $4, $5, $6, NOW())
                    ON CONFLICT (bqms_code, image_path) DO UPDATE SET
                        source     = EXCLUDED.source,
                        rfq_number = EXCLUDED.rfq_number,
                        file_size  = EXCLUDED.file_size,
                        mtime      = EXCLUDED.mtime,
                        indexed_at = NOW()
                    """,
                    rows,
                )
        logger.info("inline indexed %d images for RFQ %s", len(rows), rfq_number)
    except Exception as exc:
        logger.warning("inline image-index update failed (rfq=%s): %s", rfq_number, exc)
        return 0
    return len(rows)


async def download_files_for_rfq(
    rfq_number: str,
    raw_row: dict,
    db_pool=None,
    force_drill_detail: bool = False,
) -> dict[str, Any]:
    """Login fresh, navigate to one specific RFQ detail, download all
    attachments + extract images from RFQ_*.xlsx files. Local-VPS only —
    no OneDrive upload (per user 2026-05-08).

    Idempotency: folder created only when version=1 OR when not yet exists.
    Re-running will overwrite files in raw/ but keep the folder.
    """
    from playwright.async_api import async_playwright
    from app.core.config import settings
    from app.services.bqms_credentials import get_bqms_credentials

    user, pwd = get_bqms_credentials()
    base = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"
    if not user or not pwd:
        raise RuntimeError("BQMS credentials missing in settings")

    started_at = datetime.now(timezone.utc)
    # Per Thang 2026-05-10: prefer pretty folder name [QT]_[Item]_[Qty]_[date]_[time]
    # if it already exists from scrape-time creation, otherwise create one now.
    # Fall back to legacy bare-rfq folder for old data.
    folder = find_existing_rfq_folder(rfq_number, datetime.now())
    if folder is None:
        folder = _pretty_rfq_folder_path(rfq_number, raw_row, datetime.now())
    folder_pre_existed = folder.exists()
    raw_dir = folder / "raw"
    images_dir = folder / "images"
    raw_dir.mkdir(parents=True, exist_ok=True)
    images_dir.mkdir(parents=True, exist_ok=True)

    # Per Thang 2026-05-11: PRESERVE existing images. After we report a quote
    # on BQMS, the portal DELETES the original attachments — re-scraping
    # would then find nothing and could overwrite our local cached images
    # with empty results. So: if `images_dir` already has files, treat the
    # download step as a no-op and use existing data.
    existing_images = [
        p for p in images_dir.glob("*.png") if p.is_file() and p.stat().st_size > 100
    ]
    existing_raws = [
        p for p in raw_dir.glob("*") if p.is_file() and p.stat().st_size > 100
    ]
    preserve_mode = len(existing_images) > 0
    # Phase F (Thang 2026-05-13): preserve_mode chỉ short-circuit khi NOT
    # force_drill_detail. Trước đây luôn return None → auto_drill task không
    # bao giờ extract items cho RFQ đã có ảnh trong folder → cột BQMS/maker/
    # CIS/Part NO ở bảng vẫn rỗng. Giờ: force_drill_detail=True sẽ drill grid
    # detail (browser session mới) NHƯNG vẫn skip download files & image extract.
    if preserve_mode and not force_drill_detail:
        logger.info(
            "PRESERVE images: %s already has %d image(s) + %d raw file(s) — skipping re-scrape",
            folder, len(existing_images), len(existing_raws),
        )
        return {
            "rfq_number": rfq_number,
            "folder": str(folder),
            "folder_pre_existed": True,
            "preserved": True,
            "downloaded_count": len(existing_raws),
            "downloaded_total_bytes": sum(p.stat().st_size for p in existing_raws),
            "images_extracted": len(existing_images),
            "errors": [],
            "duration_seconds": 0.0,
            "fresh_detail": None,
        }
    if preserve_mode and force_drill_detail:
        logger.info(
            "PRESERVE images + force_drill_detail: %s — will drill grid items only "
            "(skip downloads + image extract)",
            folder,
        )

    downloaded: list[dict[str, Any]] = []
    images_extracted = 0
    errors: list[str] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1440, "height": 900}, locale="en-US",
            accept_downloads=True,
        )
        page = await context.new_page()

        # Login
        await page.goto(
            f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
            wait_until="domcontentloaded", timeout=30_000,
        )
        await page.fill("input#id", user)
        await page.fill("input#pass", pwd)
        await page.evaluate("login()")
        try:
            await page.wait_for_url(
                lambda u: "anonymous" not in u and "login" not in u.lower(),
                timeout=30_000,
            )
        except Exception:
            pass

        # Navigate to bidding list (need it for the form ctx)
        await page.evaluate("selectLeftMenu(10, 10, true)")
        await asyncio.sleep(5)
        await _dismiss_ibsheet_popup(page)
        await asyncio.sleep(6)

        # Use saved raw_json fields to navigate to this RFQ's detail
        nav_ok = await page.evaluate(
            """(r) => {
                try {
                    $('#submitContentForm #reqNo').val(r.reqNo);
                    $('#submitContentForm #reqSeq').val(r.reqSeq);
                    $('#submitContentForm #ctrChangeSeq').val(r.ctrChangeSeq);
                    $('#submitContentForm #valutSeq').val(r.valutSeq);
                    $('#submitContentForm #rndSysCode').val(r.rndSysCode);
                    $('#submitContentForm #secureKey').val(r.secureKey);
                    $('#submitContentForm #secureKeyBid').val(r.secureKeyBid);
                    $('#submitContentForm #eprCode').val(r.eprCode);
                    $('#submitContentForm #eprNo').val(r.eprNo);
                    if (r.submitGb === 'BD') {
                        const ct = r.ctrType;
                        const m = (ct === 'Y' || ct === 'Q' || ct === 'U') ? 'get' : 'post';
                        const b = ct === 'Y' ? '/intgd' : (ct === 'Q' || ct === 'U') ? '/dva' : '/gbd';
                        bdEprSubmitList.moveEprBdContent(m, b);
                    } else {
                        bdEprSubmitList.moveQtSQuotContent();
                    }
                    return true;
                } catch (e) { return false; }
            }""",
            raw_row,
        )
        if not nav_ok:
            await browser.close()
            return {"error": "could not navigate to detail page", "folder": str(folder)}

        await asyncio.sleep(7)

        # Phase F (Thang 2026-05-13): poll for window.itemGridBox.getRowsNum() to
        # return > 0 (with timeout) — DHTMLX grid loads asynchronously and 7s
        # static sleep often misses multi-item RFQs → drill returns items=[].
        # Cap total wait at +15s extra (max ~22s for grid).
        for _wait_i in range(15):
            grid_ready = await page.evaluate(
                """() => {
                    const g = window.itemGridBox;
                    if (!g || typeof g.getRowsNum !== 'function') return -1;
                    try { return g.getRowsNum(); } catch (e) { return -2; }
                }"""
            )
            if isinstance(grid_ready, int) and grid_ready > 0:
                logger.info("RFQ %s: itemGridBox ready with %d rows after %ds extra wait",
                            rfq_number, grid_ready, _wait_i + 1)
                break
            await asyncio.sleep(1)

        # ── Re-extract Basic Info + Quotation Amount items here too ──
        # This is the SAME drill that scrape_bidding does, but called fresh
        # while we're already on the detail page. Solves: stale `_detail` from
        # a previous batch scrape that failed.
        fresh_basic = await page.evaluate(
            """() => {
                const out = {};
                const heads = Array.from(document.querySelectorAll('h2,h3,h4')).filter(h =>
                    /basic\\s+information/i.test(h.textContent || ''));
                if (!heads.length) return out;
                let n = heads[0];
                for (let hop = 0; hop < 6; hop++) {
                    n = n.nextElementSibling;
                    if (!n) break;
                    const tbl = n.querySelector?.('table') || (n.tagName === 'TABLE' ? n : null);
                    if (tbl) {
                        const rows = tbl.querySelectorAll('tr');
                        for (const tr of rows) {
                            const cells = Array.from(tr.querySelectorAll('th, td'));
                            for (let i = 0; i + 1 < cells.length; i += 2) {
                                const k = (cells[i].textContent || '').trim();
                                const v = (cells[i + 1].textContent || '').trim();
                                if (k && k.length < 50) out[k] = v.slice(0, 500);
                            }
                        }
                        break;
                    }
                }
                return out;
            }"""
        )
        fresh_items = await page.evaluate(
            """({ cols }) => {
                const g = window.itemGridBox;
                if (!g || typeof g.getRowsNum !== 'function') return [];
                const total = g.getRowsNum();
                const items = [];
                const colIdx = {};
                for (const [colId, _] of cols) {
                    try { colIdx[colId] = g.getColIndexById(colId); }
                    catch (e) { colIdx[colId] = -1; }
                }
                for (let i = 0; i < total; i++) {
                    let rowId = null;
                    try { rowId = g.getRowId(i); } catch (e) {}
                    if (rowId === null || rowId === undefined) continue;
                    const row = {};
                    for (const [colId, fieldName] of cols) {
                        const idx = colIdx[colId];
                        if (idx < 0) { row[fieldName] = null; continue; }
                        try {
                            let v = g.cells(rowId, idx).getValue();
                            if (v === null || v === undefined) v = null;
                            row[fieldName] = v;
                        } catch (e) { row[fieldName] = null; }
                    }
                    items.push(row);
                }
                return items;
            }""",
            {"cols": QUOT_AMOUNT_COLS},
        )
        # Phase F (Thang 2026-05-13): preserve_mode skip downloads + image extract
        if preserve_mode:
            logger.info("RFQ %s: preserve_mode → skip attachment download + image extract", rfq_number)
            # Use existing files for the attachments list
            downloaded = [
                {"name": p.name, "size": p.stat().st_size, "path": str(p)}
                for p in existing_raws
            ]
            await browser.close()
        else:
            # Find attachment links — they typically look like <a> with file extension in text
            # Build list of {text, locator} pairs
            all_attachments = await page.evaluate(
                """() => {
                    const out = [];
                    document.querySelectorAll('a').forEach((a, idx) => {
                        const t = (a.textContent || '').trim();
                        if (/\\.(pdf|xlsx?|zip|stp|step|dwg|x_t|jpe?g|png|tiff?)$/i.test(t)) {
                            out.push({ idx: idx, text: t });
                        }
                    });
                    return out;
                }"""
            )
            logger.info("RFQ %s: found %d attachments", rfq_number, len(all_attachments))

            # Click each attachment link → capture download.
            # BQMS link text includes the CSS class prefix `attach_file` — strip it.
            anchors = await page.query_selector_all("a")
            for att in all_attachments:
                idx = att["idx"]
                fname = att["text"]
                if fname.startswith("attach_file"):
                    fname = fname[len("attach_file"):]
                if idx >= len(anchors):
                    continue
                target_path = raw_dir / fname
                try:
                    async with page.expect_download(timeout=30_000) as dl_info:
                        await anchors[idx].click()
                    dl = await dl_info.value
                    await dl.save_as(str(target_path))
                    size = target_path.stat().st_size if target_path.exists() else 0
                    downloaded.append({"name": fname, "size": size, "path": str(target_path)})
                    logger.info("  ↓ %s (%d bytes)", fname, size)
                except Exception as exc:
                    msg = f"{fname}: {str(exc)[:120]}"
                    errors.append(msg)
                    logger.warning("download failed %s", msg)
                await asyncio.sleep(0.5)

            await browser.close()

    # Image extraction — smart cross-file deduplication per Thang 2026-05-11.
    # Old per-file extraction caused 3 item-codes to share identical images
    # because Samsung's RFQ_<code>.xlsx files often carry the SAME template
    # header/footer/blueprint embeds. New logic hashes across all xlsx files
    # in raw_dir and saves only images UNIQUE to each item-code's xlsx.
    # Phase F: skip in preserve_mode — use existing images count.
    if preserve_mode:
        images_extracted = len(existing_images)
    else:
        try:
            images_extracted = _extract_images_for_rfq_folder(raw_dir, images_dir)
        except Exception as exc:
            errors.append(f"image extract folder: {str(exc)[:200]}")
            logger.warning("smart image extract failed: %s", exc)

    # Phase Q (Thang 2026-05-19): immediately populate bqms_image_index so the
    # BQMS list column shows the image on the very next API call. Was waiting
    # up to 6h for the periodic crawler — root cause of "ảnh column hay lỗi
    # mất ảnh hoặc không hiển thị" right after a fresh scrape.
    if images_extracted and images_extracted > 0 and db_pool is not None:
        try:
            await _index_rfq_images_inline(db_pool, rfq_number, images_dir)
        except Exception as exc:
            logger.warning("inline indexer call failed (rfq=%s): %s", rfq_number, exc)

    finished_at = datetime.now(timezone.utc)
    # Build a fresh _detail to be merged back into staging.raw_json
    rfq_text = fresh_basic.get("RFQ No") or fresh_basic.get("RFQ no") or fresh_basic.get("RFQ")
    qt, version = _parse_rfq_version(rfq_text)
    classification = _classify_drawing([d["name"] for d in downloaded])
    fresh_detail = {
        "rfq_text": rfq_text,
        "rfq_no_parsed": qt,
        "version": version,
        "basic_info": fresh_basic,
        "items": fresh_items,
        "attachments": [d["name"] for d in downloaded],
        "classification": classification,
        "extracted_at": finished_at.isoformat(),
    }
    summary = {
        "rfq_number": rfq_number,
        "folder": str(folder),
        "folder_pre_existed": folder_pre_existed,
        "downloaded_count": len(downloaded),
        "downloaded_total_bytes": sum(d.get("size", 0) for d in downloaded),
        "images_extracted": images_extracted,
        "errors": errors,
        "duration_seconds": (finished_at - started_at).total_seconds(),
        "fresh_detail": fresh_detail,  # ← caller can merge this into staging.raw_json + UPSERT bqms_rfq
    }

    # Update bqms_rfq.notes for this RFQ to record folder path
    if db_pool is not None:
        try:
            async with db_pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE bqms_rfq
                    SET notes = COALESCE(notes, '') ||
                                $1::text,
                        updated_at = NOW()
                    WHERE rfq_number = $2 AND data_source = 'etl'
                    """,
                    f" | folder={folder} files={len(downloaded)} images={images_extracted}",
                    rfq_number,
                )
        except Exception as exc:
            logger.warning("notes update failed: %s", exc)

    return summary


def _is_closed_status(r: dict[str, Any]) -> bool:
    """Detect 'Closed' bidding status from raw row.

    Per Thang 2026-05-11: skip Closed RFQs entirely — they are past their
    submit deadline + cannot be quoted anymore. Detection signals:
      - progressStatusName / progressStatus contains 'closed' (any case)
      - dday field is the literal string 'Closed' (BQMS renders this when
        the deadline has passed)
      - submitGb status indicates closed state
    Active RFQs show D-Day / D-1 / D-2 / D-N etc. in the dday cell.
    """
    pn = (r.get("progressStatusName") or "").lower()
    ps = (r.get("progressStatus") or "").lower()
    dd = (r.get("dday") or "").lower()
    sg = (r.get("submitGb") or "").lower()
    # Strip HTML tags from dday (raw HTML wrapper)
    import re as _re
    dd_text = _re.sub(r"<[^>]+>", "", dd).strip()
    if "closed" in pn or "closed" in ps or "closed" in dd_text or "closed" in sg:
        return True
    return False


# ───────────────────────────────────────────────────────────────────
# Phase I (Thang 2026-05-14): Round-bump detection — 3-condition check
# ───────────────────────────────────────────────────────────────────

async def detect_is_round_bump(
    db_pool, rfq_number: str, raw_row: dict[str, Any],
) -> int | None:
    """Phase I (Thang 2026-05-14): detect if a freshly-scraped Bidding row is
    a ROUND-BUMP (Samsung pushing QT back to the top for vòng 2/3/4) rather
    than a brand-new RFQ.

    Critical safety: when Samsung pushes a QT to round 2, the V1 attachments
    on the portal are DELETED. If we blindly re-scrape, we'd overwrite the
    existing V1 files with 0 attachments. Detect first, then SKIP scrape.

    Returns:
        int (1-4): the new round number to update in `bqms_rfq.version`.
        None: not a round-bump (either new RFQ or genuinely closed).

    All 3 conditions must hold simultaneously:
      1. rfq_number ALREADY exists in bqms_rfq
      2. raw_row's current portal status is NOT 'Closed'
      3. rfq_number does NOT appear as 'Unselected' in Selection Result staging

    Once all 3 pass, callers should:
      - UPDATE only the `version` column (and req_name/subject if changed)
      - DO NOT touch spec/maker/qty/files/folder
    """
    if not rfq_number or not isinstance(raw_row, dict):
        return None

    # Condition 2: cheap pre-check first (filter out closed rows immediately)
    if _is_closed_status(raw_row):
        return None

    async with db_pool.acquire() as conn:
        # Condition 1: row exists in bqms_rfq (from earlier scrape)
        existing = await conn.fetchrow(
            "SELECT MAX(version) AS cur_ver FROM bqms_rfq WHERE rfq_number = $1",
            rfq_number,
        )
        if not existing or existing["cur_ver"] is None:
            return None
        cur_ver = int(existing["cur_ver"] or 1)

        # Condition 3: not marked Unselected in Selection Result staging
        unselected = await conn.fetchval(
            """
            SELECT 1 FROM bqms_vendor_portal_staging
            WHERE module = 'selection_result'
              AND rfq_number = $1
              AND (raw_json->>'selectionResult' = 'Unselected'
                   OR raw_json->>'selectionResultName' ILIKE '%unselected%')
            LIMIT 1
            """,
            rfq_number,
        )
        if unselected:
            return None

    # Parse new version from the "RFQ No" cell in Basic Information.
    # When Samsung pushes V2, the cell value becomes e.g. "[New] QT26061295 / 2 th".
    # If Basic Info not available yet (list-level scrape), peek at raw_row's
    # title/reqName/subject for "(2nd)" or "2 th" markers.
    new_ver = cur_ver  # default — assume same round
    candidates: list[str] = []
    detail = raw_row.get("_detail") or {}
    basic = detail.get("basic_info") or {}
    for k in ("RFQ No", "RFQ no", "RFQ", "rfq_no"):
        if basic.get(k):
            candidates.append(str(basic[k]))
            break
    for k in ("reqName", "subject", "title", "ctrTypeNm"):
        if raw_row.get(k):
            candidates.append(str(raw_row[k]))

    for txt in candidates:
        _, ver = _parse_rfq_version(txt)
        if ver > new_ver:
            new_ver = ver
            break
        # Also catch (2nd), 2nd Round, V2 markers
        import re as _re_local
        m = _re_local.search(r"\b([2-4])(?:nd|rd|th)\b|\bv([2-4])\b|\(([2-4])(?:nd|rd|th)\)", txt, _re_local.IGNORECASE)
        if m:
            n = int(next(g for g in m.groups() if g))
            if n > new_ver:
                new_ver = n
                break

    if new_ver <= cur_ver:
        # Same round → not a bump. Could be a re-scrape of an active V1.
        # Still return None so caller does normal flow (preserve_mode in
        # download_files_for_rfq will handle existing files safely).
        return None

    logger.info(
        "ROUND-BUMP detected for %s: cur_ver=%d → new_ver=%d (raw=%s)",
        rfq_number, cur_ver, new_ver,
        ", ".join(c[:60] for c in candidates[:2]),
    )
    return new_ver


async def apply_round_bump(
    db_pool, rfq_number: str, new_version: int, raw_row: dict[str, Any],
) -> dict[str, Any]:
    """Phase I: write the round-bump to DB WITHOUT touching files.

    Idempotent. Returns a summary dict:
      {rfq_number, old_version, new_version, rows_updated, subject_changed, notification_sent}

    Safety guarantees:
      - Updates ONLY: version, req_name (if changed), notes (append bump tag)
      - Does NOT touch: specification, maker, expected_qty, unit, folder, files
      - Triggers notification to assigned_to user
    """
    summary: dict[str, Any] = {
        "rfq_number": rfq_number,
        "new_version": new_version,
        "old_version": None,
        "rows_updated": 0,
        "subject_changed": False,
        "notification_sent": 0,
    }

    new_subject = (raw_row.get("reqName") or "").strip() or None
    bump_marker = (
        f" | [round-bump v{{old}}→v{new_version} @ {datetime.now().strftime('%Y-%m-%d')}]"
    )

    async with db_pool.acquire() as conn:
        # Fetch existing rows for this RFQ
        # Note: bqms_rfq doesn't have req_name/subject column — subject lives
        # in staging.raw_json.reqName. We only update version + notes here.
        rows = await conn.fetch(
            "SELECT id, version, notes, assigned_to FROM bqms_rfq "
            "WHERE rfq_number = $1",
            rfq_number,
        )
        if not rows:
            return summary

        old_version = max((r["version"] or 1) for r in rows)
        summary["old_version"] = old_version

        bump_text = bump_marker.format(old=old_version)

        for r in rows:
            new_notes = (r["notes"] or "")
            if bump_text.strip() not in new_notes:
                new_notes = (new_notes + bump_text).strip()
            await conn.execute(
                """
                UPDATE bqms_rfq
                SET version = GREATEST(version, $1),
                    notes = $2,
                    updated_at = NOW()
                WHERE id = $3
                """,
                new_version, new_notes, r["id"],
            )
            summary["rows_updated"] += 1

        # Subject change tracked via staging.raw_json.reqName (where it actually lives)
        if new_subject:
            staging_row = await conn.fetchrow(
                "SELECT id, raw_json->>'reqName' AS cur_subj FROM bqms_vendor_portal_staging "
                "WHERE module='bidding' AND rfq_number=$1 ORDER BY id DESC LIMIT 1",
                rfq_number,
            )
            if staging_row and staging_row["cur_subj"] != new_subject:
                summary["subject_changed"] = True
                # patch the JSONB field
                await conn.execute(
                    """
                    UPDATE bqms_vendor_portal_staging
                    SET raw_json = jsonb_set(raw_json, '{reqName}', to_jsonb($1::text), true)
                    WHERE id = $2
                    """,
                    new_subject, staging_row["id"],
                )

        # Notification — best-effort, don't crash on failure
        try:
            from app.services.event_notifications import dispatch_rfq_version_bump
            for r in rows:
                try:
                    await dispatch_rfq_version_bump(
                        conn,
                        rfq_id=str(r["id"]),
                        rfq_number=rfq_number,
                        bqms_code="",  # multi-row; aggregate per RFQ
                        old_version=old_version,
                        new_version=new_version,
                        assigned_to=str(r["assigned_to"]) if r["assigned_to"] else None,
                        person_in_charge_name=None,
                    )
                    summary["notification_sent"] += 1
                    break  # one notification per RFQ is enough
                except Exception:
                    pass
        except Exception as exc:
            logger.warning("apply_round_bump: dispatch failed: %s", exc)

    logger.info(
        "ROUND-BUMP applied: %s v%d → v%d (rows=%d subject_changed=%s)",
        rfq_number, summary["old_version"], new_version,
        summary["rows_updated"], summary["subject_changed"],
    )
    return summary


async def _insert_staging_bidding(db_pool, run_id: str, items: list[dict[str, Any]]) -> int:
    """INSERT one staging row per bidding REQUEST (request-level, not item-level).

    Bidding rows aren't direct merge targets for bqms_won_quotations
    (those are 'won' items, bidding is 'invited to quote'). They land in
    staging with module='bidding' for visibility / approval flow only.

    Per Thang 2026-05-11:
      - SKIP Closed rows entirely (no DB INSERT, no folder).
      - DUPLICATE GUARD: if rfq_number already exists in staging, just refresh
        raw_json (keeps the FIRST folder/scrape_id, prevents multiple folders
        for the same QT).
    """
    if not items:
        return 0
    n = 0
    skipped_closed = 0
    skipped_old_date = 0
    refreshed_dup = 0
    # Phase E4 (Thang 2026-05-12): chỉ keep QT từ 2026-05-12 trở lên — bỏ
    # những đơn cũ Samsung vẫn để active trong list (vd regDt=2026-05-06).
    # Hardcoded cutoff per user request. Có thể bỏ filter này nếu cần lấy tất.
    import os
    from datetime import date as _date_cls
    _RAW_CUTOFF = os.environ.get("BQMS_SCRAPE_MIN_REG_DT", "2026-05-12")
    try:
        _CUTOFF_DT = _date_cls.fromisoformat(_RAW_CUTOFF)
    except Exception:
        _CUTOFF_DT = None
    async with db_pool.acquire() as conn:
        for r in items:
            rfq_number = (r.get("reqNo") or "").strip() or None
            if _is_closed_status(r):
                skipped_closed += 1
                logger.debug("skip Closed rfq=%s dday=%r progress=%r",
                             rfq_number, r.get("dday"), r.get("progressStatusName"))
                continue
            # Date cutoff filter
            if _CUTOFF_DT is not None:
                reg_dt_text = (r.get("regDt") or "").strip()[:10]
                if reg_dt_text:
                    try:
                        reg_dt = _date_cls.fromisoformat(reg_dt_text)
                        if reg_dt < _CUTOFF_DT:
                            skipped_old_date += 1
                            logger.debug("skip too-old rfq=%s regDt=%s < cutoff=%s",
                                         rfq_number, reg_dt_text, _CUTOFF_DT)
                            continue
                    except ValueError:
                        pass

            description = (r.get("reqName") or "").strip() or None
            contract_period = (r.get("deadlineDt") or "").strip() or None

            # Dup guard — UPSERT instead of blind INSERT
            existing_id = None
            if rfq_number:
                existing_id = await conn.fetchval(
                    "SELECT id FROM bqms_vendor_portal_staging "
                    "WHERE module = 'bidding' AND rfq_number = $1 "
                    "ORDER BY id ASC LIMIT 1",
                    rfq_number,
                )

            if existing_id:
                # Same QT already scraped — refresh raw_json + deadline only,
                # keep status (don't reset 'approved' back to 'pending_review')
                # and keep the original folder.
                await conn.execute(
                    """
                    UPDATE bqms_vendor_portal_staging
                    SET raw_json = $1::jsonb,
                        contract_period = COALESCE($2, contract_period),
                        description = COALESCE($3, description),
                        scrape_run_id = $4
                    WHERE id = $5
                    """,
                    json.dumps(r, ensure_ascii=False, default=str),
                    contract_period, description, run_id, existing_id,
                )
                refreshed_dup += 1
            else:
                await conn.execute(
                    """
                    INSERT INTO bqms_vendor_portal_staging
                        (scrape_run_id, module, rfq_number, contract_no,
                         contract_period, item_code, description, specification,
                         quantity, unit, raw_json, status)
                    VALUES ($1, 'bidding', $2, NULL, $3, NULL, $4, NULL, NULL, NULL,
                            $5::jsonb, 'pending_review')
                    """,
                    run_id, rfq_number, contract_period, description,
                    json.dumps(r, ensure_ascii=False, default=str),
                )
                # Folder creation — only for genuinely new rows (idempotent
                # internally via find_existing_rfq_folder).
                try:
                    if rfq_number:
                        ensure_rfq_folder_on_scrape(rfq_number, r)
                except Exception as exc:
                    logger.warning("ensure_rfq_folder_on_scrape failed for %s: %s",
                                   rfq_number, exc)
                n += 1
    if skipped_closed or refreshed_dup:
        logger.info(
            "_insert_staging_bidding: %d new, %d refreshed (dup), %d skipped (Closed)",
            n, refreshed_dup, skipped_closed,
        )
    return n
