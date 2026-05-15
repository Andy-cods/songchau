"""BQMS Quote Pusher (Thang 2026-05-14)

Headless Playwright submitter cho sec-bqms.com. Singleton instance trong worker —
giữ Playwright context + cookie reuse xuyên jobs.

Flow:
1. ensure_session() — lazy login, re-login khi cookie expire
2. push_one_rfq(payload) — navigate QT → Edit → fill items → fill global → upload files
   → Save Temporarily. KHÔNG click final Submit (admin tự làm).

Concurrency: asyncio.Lock global đảm bảo 1 push/lần trong cùng worker process.
Cross-worker: dùng pg_advisory_xact_lock trong task wrapper.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

EVIDENCE_DIR = Path("/data/bqms-push-evidence")
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)


class BqmsQuotePusher:
    """Singleton Playwright session manager. Reuse cookie xuyên jobs."""

    _instance: "BqmsQuotePusher | None" = None
    _global_lock: asyncio.Lock = asyncio.Lock()

    @classmethod
    def instance(cls) -> "BqmsQuotePusher":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None
        self._edit_frame = None  # Active frame after click Edit (Samsung loads UI in iframe)
        self._logged_in_at: datetime | None = None
        self._session_max_age = timedelta(minutes=45)  # Re-login sau 45 phút

    async def _start_browser(self):
        from playwright.async_api import async_playwright
        if self._playwright is None:
            self._playwright = await async_playwright().start()
        if self._browser is None:
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            )
        if self._context is None:
            self._context = await self._browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1440, "height": 900},
                locale="en-US",
                accept_downloads=True,
            )
            self._page = await self._context.new_page()
            # CRITICAL (Thang 2026-05-15): Samsung BQMS dùng native browser
            # alert() cho IBSheet locale popup. Playwright KHÔNG auto-accept
            # dialog — sẽ block page nếu không có handler. Register handler
            # ngay sau khi tạo page, accept TẤT CẢ dialogs xuyên suốt session.
            async def _on_dialog(dialog):
                try:
                    logger.info("Dialog auto-accept: type=%s message=%s",
                                dialog.type, dialog.message[:100])
                    await dialog.accept()
                except Exception as exc:
                    logger.warning("Dialog accept failed: %s", exc)
            self._page.on("dialog", _on_dialog)

    async def _login(self):
        """Login sec-bqms — reuse pattern từ bqms_bidding_scraper."""
        from app.core.config import settings
        await self._start_browser()
        base = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"
        user = settings.BQMS_USERNAME
        pwd = settings.BQMS_PASSWORD
        if not user or not pwd:
            raise RuntimeError("BQMS credentials missing in settings")

        await self._page.goto(
            f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
            wait_until="domcontentloaded", timeout=30_000,
        )
        await self._page.fill("input#id", user)
        await self._page.fill("input#pass", pwd)
        await self._page.evaluate("login()")
        try:
            await self._page.wait_for_url(
                lambda u: "anonymous" not in u and "login" not in u.lower(),
                timeout=30_000,
            )
        except Exception:
            pass
        self._logged_in_at = datetime.now()
        logger.info("BqmsQuotePusher login OK: %s", self._page.url)

    async def ensure_session(self):
        """Đảm bảo session active. Re-login nếu hết hạn hoặc chưa từng login."""
        await self._start_browser()
        if self._logged_in_at is None or (datetime.now() - self._logged_in_at) > self._session_max_age:
            logger.info("Session expired or new — logging in")
            await self._login()
            return
        # Quick liveness check — GET main page, expect không redirect về login
        try:
            from app.core.config import settings
            base = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"
            await self._page.goto(
                f"{base}/bqms/vendorPortal/bdEprSubmitList.do",
                wait_until="domcontentloaded", timeout=15_000,
            )
            if "anonymous" in self._page.url or "login" in self._page.url.lower():
                logger.warning("Cookie expired during liveness check, re-login")
                await self._login()
        except Exception as exc:
            logger.warning("Liveness check failed (%s), re-login", exc)
            await self._login()

    async def close(self):
        if self._context:
            await self._context.close()
            self._context = None
            self._page = None
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
        self._logged_in_at = None

    # ─── Main push ─────────────────────────────────────────────

    async def push_one_rfq(self, payload: dict[str, Any], progress_cb=None) -> dict[str, Any]:
        """Push 1 RFQ → Save Temporarily lên sec-bqms.

        progress_cb(pct: int, step: str): callback async để cập nhật progress vào DB.
        """
        async with self._global_lock:
            start = datetime.now()
            rfq_number = payload["rfq_number"]
            # Store payload on self so _click_save_temporarily can re-apply
            # grid model values right before saveDcu (workaround for grid
            # values being wiped between _fill_one_item and save).
            self._current_payload = payload

            async def _p(pct, step):
                """Helper an toàn — callback có thể None."""
                logger.info("[%s] %d%% — %s", rfq_number, pct, step)
                if progress_cb:
                    try:
                        await progress_cb(pct, step)
                    except Exception as exc:
                        logger.warning("progress_cb failed: %s", exc)

            n_items = len(payload.get("items", []))
            # Plan progress weights:
            # 0-10%: login/session
            # 10-15%: navigate
            # 15-20%: edit click
            # 20-75%: per-item (55% chia đều cho N items)
            # 75-85%: valid_date + opinion
            # 85-92%: attachments
            # 92-98%: save_temp
            # 98-100%: screenshot

            try:
                await _p(2, "Khởi tạo Playwright session")
                await self.ensure_session()
                await _p(10, "Session sec-bqms OK")

                await _p(12, f"Mở trang detail QT {rfq_number}")
                await self._goto_qt_detail(rfq_number)
                await _p(15, "Đã vào detail page")

                await _p(17, "Click Edit để chuyển edit mode")
                await self._click_edit()
                await _p(20, "Edit mode active")

                per_item_pct = 55.0 / max(n_items, 1)
                for idx, item in enumerate(payload["items"]):
                    base_pct = 20 + idx * per_item_pct
                    await _p(int(base_pct), f"Item {idx+1}/{n_items} — {item.get('bqms_code', '?')}: upload ảnh")
                    await self._fill_one_item(item)
                    await _p(int(base_pct + per_item_pct), f"Item {idx+1}/{n_items}: xong (price + abandon + lead)")

                await _p(76, "Điền Quote Valid Date")
                await self._fill_quote_valid_date(payload["quote_valid_date"])

                await _p(80, "Điền Submission Opinion")
                await self._fill_submission_opinion(payload["submission_opinion"])

                if payload.get("attachment_paths"):
                    await _p(86, f"Upload {len(payload['attachment_paths'])} file đính kèm")
                    await self._upload_attachments(payload["attachment_paths"])
                    await _p(92, "Đã upload file")

                await _p(94, "Click Save Temporarily")
                await self._click_save_temporarily()
                await _p(98, "Đã save temp — đang chụp screenshot")

                screenshot_path = await self._save_screenshot(rfq_number)
                await _p(100, "Hoàn tất ✓")

                duration = (datetime.now() - start).total_seconds()
                logger.info(
                    "push_one_rfq SUCCESS: %s in %.1fs, screenshot=%s",
                    rfq_number, duration, screenshot_path,
                )
                return {
                    "status": "saved_temp",
                    "screenshot_path": str(screenshot_path),
                    "duration_seconds": duration,
                }
            except Exception as exc:
                try:
                    err_shot = await self._save_screenshot(rfq_number, suffix="ERROR")
                except Exception:
                    err_shot = None
                logger.exception("push_one_rfq FAILED: %s", rfq_number)
                if progress_cb:
                    try:
                        await progress_cb(0, f"LỖI: {str(exc)[:200]}")
                    except Exception:
                        pass
                return {
                    "status": "failed",
                    "error": str(exc)[:1000],
                    "screenshot_path": str(err_shot) if err_shot else None,
                }

    # ─── Step A: Navigate ─────────────────────────────────────

    async def _fetch_staging_row(self, rfq_number: str) -> dict:
        """Lấy raw_json từ bqms_vendor_portal_staging để có row keys (reqSeq,
        secureKey, ...) cần cho moveQtSQuotContent / moveEprBdContent.

        Pattern này nhanh hơn search trên BQMS list page (vì list paginate +
        có thể QT không ở page 1) và đáng tin cậy hơn.
        """
        import asyncpg
        from app.core.config import settings
        db_url = (
            str(settings.DATABASE_URL)
            .replace("+asyncpg", "")
            .replace("postgresql+asyncpg", "postgresql")
        )
        conn = await asyncpg.connect(db_url)
        try:
            row = await conn.fetchrow(
                """SELECT raw_json FROM bqms_vendor_portal_staging
                   WHERE rfq_number=$1 AND module='bidding'
                   ORDER BY id DESC LIMIT 1""",
                rfq_number,
            )
            if not row:
                raise RuntimeError(
                    f"Không tìm thấy staging cho QT {rfq_number}. "
                    f"Đợi cron scrape (30p) hoặc trigger scrape manual."
                )
            raw = row["raw_json"]
            if isinstance(raw, str):
                raw = json.loads(raw)
            # Validate required keys
            required = ["reqNo", "reqSeq", "secureKey"]
            missing = [k for k in required if not raw.get(k)]
            if missing:
                raise RuntimeError(
                    f"Staging raw_json thiếu keys {missing} cho QT {rfq_number}"
                )
            return {
                "reqNo": raw.get("reqNo"),
                "reqSeq": raw.get("reqSeq"),
                "ctrChangeSeq": raw.get("ctrChangeSeq", ""),
                "valutSeq": raw.get("valutSeq", ""),
                "rndSysCode": raw.get("rndSysCode", ""),
                "secureKey": raw.get("secureKey"),
                "secureKeyBid": raw.get("secureKeyBid", ""),
                "eprCode": raw.get("eprCode", ""),
                "eprNo": raw.get("eprNo", ""),
                "submitGb": raw.get("submitGb", "QT"),
                "ctrType": raw.get("ctrType", "R"),
            }
        finally:
            await conn.close()

    async def _ensure_on_bidding_list(self) -> bool:
        """Reuse pattern từ scraper bqms_bidding_scraper._ensure_on_bidding_list.

        Strategy:
          1. Quick check — bdEprSubmitList đã trong scope?
          2. selectLeftMenu(10, 10, true) (preserves session)
          3. Fallback page.goto list URL
        """
        from app.core.config import settings
        base = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"

        js_check = (
            "typeof bdEprSubmitList !== 'undefined' "
            "&& typeof bdEprSubmitList.moveQtSQuotContent === 'function'"
        )
        try:
            if await self._page.evaluate(js_check):
                return True
        except Exception:
            pass

        # Attempt 1: selectLeftMenu (in-app nav, preserves session)
        try:
            await self._page.evaluate("selectLeftMenu(10, 10, true)")
            # Native locale dialog appears + auto-accepted by _on_dialog handler.
            # Wait 7s như anh chỉ — IBSheet load list sau dialog dismiss.
            await asyncio.sleep(7)
            await self._dismiss_popups()
            for _ in range(15):
                await asyncio.sleep(1)
                try:
                    if await self._page.evaluate(js_check):
                        logger.info("→ recovered via selectLeftMenu(10)")
                        return True
                except Exception:
                    continue
        except Exception as exc:
            logger.warning("selectLeftMenu failed: %s", exc)

        # Attempt 2: full page.goto fallback
        list_url = (
            f"{base}/bqms/gbd/eprPotal/sbid/sbid/bdEprSubmitListR.do"
            f"?_menuId=AZib43qsAJIV-QNs&_menuF=true"
        )
        try:
            await self._page.goto(list_url, wait_until="domcontentloaded", timeout=20_000)
            await asyncio.sleep(4)
            await self._dismiss_popups()
            for _ in range(15):
                await asyncio.sleep(1)
                try:
                    if await self._page.evaluate(js_check):
                        logger.info("→ recovered via page.goto")
                        return True
                except Exception:
                    continue
        except Exception as exc:
            logger.warning("page.goto fallback failed: %s", exc)

        return False

    async def _dismiss_popups(self):
        """Đóng IBSheet locale popup hay confirm dialog nếu hiện."""
        for sel in [
            'button:has-text("Confirm")',
            'button:has-text("OK")',
            'button:has-text("Yes")',
            '.alert-dismiss',
        ]:
            try:
                btn = self._page.locator(sel).first
                if await btn.is_visible(timeout=1000):
                    await btn.click()
                    await asyncio.sleep(0.5)
            except Exception:
                continue

    async def _goto_qt_detail(self, rfq_number: str):
        """Navigate đến detail page của QT cụ thể.

        Refactor (Thang 2026-05-15 v2): theo flow user yêu cầu — filter UI thay
        vì eval JS internals. Human-like, resilient hơn:
        1. selectLeftMenu(10) → vào trang Bidding list
        2. Dismiss IBSheet locale popup
        3. Fill input "Request Number" với rfq_number
        4. Click button "Search"
        5. Wait IBSheet refresh
        6. Click first row's Subject link → Samsung tự navigate to detail
        """
        # 1. Ensure on bidding list page
        on_list = await self._ensure_on_bidding_list()
        if not on_list:
            raise RuntimeError(
                f"Không thể vào trang Bidding list. URL: {self._page.url}"
            )

        # 2. Fill Request Number input field
        filled = await self._fill_request_number_filter(rfq_number)
        if not filled:
            raise RuntimeError(
                "Không tìm thấy ô input 'Request Number' trên trang list"
            )

        # 3. Click Search button
        clicked = await self._click_search_button()
        if not clicked:
            raise RuntimeError("Không tìm thấy nút 'Search'")

        # 4. Wait for filter to apply + IBSheet refresh
        await asyncio.sleep(4)
        await self._dismiss_popups()

        # 5. Click first row in results
        navigated = await self._click_first_result_row(rfq_number)
        if not navigated:
            raise RuntimeError(
                f"Không tìm thấy row nào sau khi search QT={rfq_number}. "
                f"Có thể QT đã closed/skipped hoặc không thuộc account này."
            )

        # 6. Wait detail page load + verify URL change
        await asyncio.sleep(7)
        try:
            await self._page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:
            pass
        final_url = self._page.url
        logger.info("After nav URL: %s", final_url)
        # Sanity check — detail URL không nên còn "bdEprSubmitListR" path
        if "bdEprSubmitListR" in final_url or "submitList" in final_url.lower():
            raise RuntimeError(
                f"Navigation appears stuck on list page: {final_url}. "
                f"Samsung's moveQtSQuotContent() may have been blocked."
            )

    async def _fill_request_number_filter(self, rfq_number: str) -> bool:
        """Fill ô input Request Number trên trang list filter."""
        # Multiple selector candidates — Samsung dùng IBSheet form
        candidates = [
            'input[id="reqNo"]',
            'input[name="reqNo"]',
            'input[id*="reqNo"]',
            'input[name*="reqNo"]',
            'input[id*="ReqNo"]',
            'input[name*="ReqNo"]',
            'input[id*="reqNum"]',
            # Fallback: text input gần label "Request Number"
            'th:has-text("Request Number") + td input[type="text"]',
            'label:has-text("Request Number") + input',
            'td:has-text("Request Number") + td input',
        ]
        for sel in candidates:
            try:
                inp = self._page.locator(sel).first
                if await inp.count() and await inp.is_visible(timeout=2000):
                    await inp.fill("")
                    await inp.fill(rfq_number)
                    logger.info("Filled Request Number filter via: %s", sel)
                    return True
            except Exception:
                continue

        # Last resort: eval JS to find input by surrounding label text
        try:
            filled = await self._page.evaluate(
                """(target) => {
                    // Find label/th containing "Request Number" then locate nearby input
                    const candidates = document.querySelectorAll('th, td, label');
                    for (const lbl of candidates) {
                        const txt = (lbl.textContent || '').trim().toLowerCase();
                        if (txt === 'request number' || txt.startsWith('request number')) {
                            // Look in next sibling cell or parent row
                            let scope = lbl.nextElementSibling || lbl.parentElement;
                            if (scope) {
                                const inp = scope.querySelector('input[type="text"]') ||
                                            scope.querySelector('input:not([type])');
                                if (inp) {
                                    inp.value = target;
                                    inp.dispatchEvent(new Event('input', {bubbles: true}));
                                    inp.dispatchEvent(new Event('change', {bubbles: true}));
                                    return true;
                                }
                            }
                        }
                    }
                    return false;
                }""",
                rfq_number,
            )
            if filled:
                logger.info("Filled Request Number via JS label lookup")
                return True
        except Exception as exc:
            logger.warning("JS label lookup failed: %s", exc)

        return False

    async def _click_search_button(self) -> bool:
        """Click nút Search trên trang list."""
        candidates = [
            'button:has-text("Search"):visible',
            'a:has-text("Search"):visible',
            'input[type="button"][value="Search"]',
            'input[type="submit"][value="Search"]',
            # Samsung form-frame buttons
            'button.btnSearch',
            'button#btnSearch',
        ]
        for sel in candidates:
            try:
                btn = self._page.locator(sel).first
                if await btn.count() and await btn.is_visible(timeout=2000):
                    await btn.click()
                    logger.info("Clicked Search via: %s", sel)
                    return True
            except Exception:
                continue
        # Fallback: try Samsung's JS search function
        try:
            ok = await self._page.evaluate(
                "typeof bdEprSubmitList !== 'undefined' && bdEprSubmitList.search "
                "? (bdEprSubmitList.search(), true) : false"
            )
            if ok:
                logger.info("Triggered search via bdEprSubmitList.search()")
                return True
        except Exception:
            pass
        return False

    async def _click_first_result_row(self, rfq_number: str) -> bool:
        """Build first row data via IBSheet API + trigger Samsung's nav function.

        IMPORTANT: Samsung uses `window.IBSheet[idx]` array (capital, array index),
        NOT `window.sheet0/sheet1` (the old wrong selector tried before).
        Each row dict from getDataRows() has keys directly: row.reqNo, row.secureKey, ...
        """
        # 0. Press Escape to close any calendar popup blocking the page
        try:
            await self._page.keyboard.press("Escape")
            await asyncio.sleep(0.5)
            # Click in a neutral area to defocus
            await self._page.click("body", position={"x": 10, "y": 10}, timeout=2000)
            await asyncio.sleep(0.5)
        except Exception:
            pass

        # 1. Wait for IBSheet to populate
        for attempt in range(15):
            row_count = await self._page.evaluate(
                """() => {
                    if (!window.IBSheet || !Array.isArray(window.IBSheet)) return -1;
                    let best = 0;
                    for (let i = 0; i < window.IBSheet.length; i++) {
                        try {
                            const len = (window.IBSheet[i].getDataRows() || []).length;
                            if (len > best) best = len;
                        } catch (e) {}
                    }
                    return best;
                }"""
            )
            if isinstance(row_count, int) and row_count >= 1:
                logger.info("IBSheet ready with %d rows after %ds", row_count, attempt)
                break
            await asyncio.sleep(1)
        else:
            logger.warning("IBSheet has no rows after 15s — filter returned empty?")
            return False

        # 2. Build row dict from IBSheet[idx].getDataRows() + trigger Samsung's nav
        clicked = await self._page.evaluate(
            """(target) => {
                try {
                    // Pick the IBSheet instance with the most data rows
                    let bestIdx = 0, bestCount = 0;
                    for (let i = 0; i < (window.IBSheet || []).length; i++) {
                        try {
                            const len = (window.IBSheet[i].getDataRows() || []).length;
                            if (len > bestCount) { bestCount = len; bestIdx = i; }
                        } catch (e) {}
                    }
                    const s = window.IBSheet[bestIdx];
                    const rows = s.getDataRows();
                    if (!rows.length) return { ok: false, why: 'getDataRows empty' };
                    const r = rows[0];

                    // Sanity check — first row reqNo SHOULD match target after filter
                    const rn = String(r.reqNo || '').trim();
                    if (rn !== target) {
                        return { ok: false, why: 'first row reqNo=' + rn + ' != ' + target };
                    }

                    if (typeof bdEprSubmitList === 'undefined') {
                        return { ok: false, why: 'bdEprSubmitList undefined' };
                    }
                    // Fill submitContentForm
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
                    return { ok: true, rfq: r.reqNo, submitGb: r.submitGb, ctrType: r.ctrType };
                } catch (e) { return { ok: false, why: String(e).slice(0, 300) }; }
            }""",
            rfq_number,
        )
        if clicked.get("ok"):
            logger.info(
                "Triggered Samsung nav for QT %s (submitGb=%s ctrType=%s)",
                clicked.get("rfq"), clicked.get("submitGb"), clicked.get("ctrType"),
            )
            return True
        logger.warning("IBSheet nav failed: %s", clicked.get("why"))
        return False

    # ─── Step B: Click Edit ───────────────────────────────────

    def _all_frames(self):
        """Return [page] + tất cả nested iframes — Samsung BQMS load nội dung vào frames."""
        frames = [self._page]
        try:
            for f in self._page.frames:
                if f != self._page.main_frame:
                    frames.append(f)
        except Exception:
            pass
        return frames

    async def _click_edit(self):
        """Click nút Edit ở góc trên phải. Search cả main page + tất cả iframes
        vì Samsung BQMS thường load detail content vào child frame.
        """
        await self._dismiss_popups()
        # Wait detail content settle
        await asyncio.sleep(3)

        # Take pre-click screenshot for debug
        try:
            await self._page.screenshot(path="/tmp/before_edit.png", full_page=True)
        except Exception:
            pass

        selectors = [
            'button:has-text("Edit"):not([disabled])',
            'a:has-text("Edit")',
            'input[type="button"][value="Edit"]',
            'input[type="submit"][value="Edit"]',
            'button.btnEdit',
            'a.btnEdit',
            'button:text-is("Edit")',
            'a:text-is("Edit")',
            # Samsung pattern — onclick contains "Edit" or edit functions
            'button[onclick*="edit" i]',
            'a[onclick*="edit" i]',
        ]

        # Search across all frames
        frames = []
        try:
            frames = list(self._page.frames)
        except Exception:
            frames = [self._page.main_frame]

        for frame in frames:
            for sel in selectors:
                try:
                    btn = frame.locator(sel).first
                    if await btn.count() == 0:
                        continue
                    if await btn.is_visible(timeout=1500):
                        await btn.click()
                        await asyncio.sleep(2)
                        # SAVE the frame — subsequent operations (fill item, click save_temp)
                        # MUST use this frame, not main page.
                        self._edit_frame = frame
                        logger.info("Clicked Edit via %s (frame=%s)", sel, frame.url[:80])
                        return
                except Exception:
                    continue

        # Last resort: eval JS to find Edit button by text
        for frame in frames:
            try:
                clicked = await frame.evaluate(
                    """() => {
                        const all = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
                        for (const el of all) {
                            const t = (el.textContent || el.value || '').trim();
                            if (t === 'Edit' || t.toLowerCase() === 'edit') {
                                const rect = el.getBoundingClientRect();
                                if (rect.width > 0 && rect.height > 0) {
                                    el.click();
                                    return { ok: true, text: t, tag: el.tagName };
                                }
                            }
                        }
                        return { ok: false };
                    }"""
                )
                if clicked.get("ok"):
                    self._edit_frame = frame
                    logger.info("Clicked Edit via JS evaluate (frame=%s): %s/%s",
                                frame.url[:80], clicked.get("tag"), clicked.get("text"))
                    await asyncio.sleep(2)
                    return
            except Exception:
                continue

        raise RuntimeError("Không tìm thấy nút Edit trong main page và tất cả iframes")

    def _scope(self):
        """Return frame để dùng cho operation sau Edit. Fallback main page."""
        return self._edit_frame or self._page

    # ─── Step C: Fill 1 item ──────────────────────────────────

    async def _fill_one_item(self, item: dict[str, Any]):
        """Per row trong table Quotation amount: upload image → fill price/abandon/lead.

        Use _scope() (edit frame). Take screenshot khi fail để debug.
        """
        code = item["bqms_code"]
        scope = self._scope()

        # Debug screenshot at start of item fill
        try:
            ts = datetime.now().strftime("%H%M%S")
            await self._page.screenshot(path=f"/data/bqms-push-evidence/_debug_{code}_{ts}_before_item.png", full_page=True)
        except Exception:
            pass

        # Find row via JS in edit frame to verify table exists
        row_info = await scope.evaluate(
            """(target) => {
                // Look for cell containing the bqms_code text in any IBSheet table
                const cells = document.querySelectorAll('td, div');
                for (const c of cells) {
                    const txt = (c.textContent || '').trim();
                    if (txt === target || txt.includes(target)) {
                        const r = c.closest('tr');
                        return {
                            found: true,
                            tr_html_preview: r ? r.outerHTML.slice(0, 500) : null,
                            cell_text: txt.slice(0, 100),
                        };
                    }
                }
                // Also check IBSheet getDataRows
                if (window.IBSheet && window.IBSheet.length) {
                    for (let i = 0; i < window.IBSheet.length; i++) {
                        try {
                            const rows = window.IBSheet[i].getDataRows();
                            for (let j = 0; j < rows.length; j++) {
                                const r = rows[j];
                                const code = r.itemCode || r.bqmsCode || r.cisCode || '';
                                if (String(code).includes(target)) {
                                    return {
                                        found: true,
                                        ibsheet_idx: i,
                                        ibsheet_row_idx: j,
                                        ibsheet_data: r,
                                    };
                                }
                            }
                        } catch (e) {}
                    }
                }
                return { found: false, page_title: document.title };
            }""",
            code,
        )
        logger.info("Row lookup for %s: %s", code, str(row_info)[:300])
        if not row_info.get("found"):
            raise RuntimeError(
                f"Row {code} not found. Page title: {row_info.get('page_title')}. "
                f"Edit frame URL: {scope.url if hasattr(scope, 'url') else 'main'}"
            )

        # Locate row via Playwright now that em verify nó tồn tại
        row = scope.locator(f'tr:has(td:has-text("{code}"))').first

        # ── C2. Upload image (mandatory first) ──
        await self._upload_item_image(row, code, item["image_path"])

        # ── C3+C5. Set price + lead_time DIRECTLY into dhtmlxGrid model ──
        # CRITICAL discovery (Thang 2026-05-15): Samsung's saveDcu() reads from
        # itemGridBox internal model via getCellValueById("LEAD_TIME", rowId),
        # NOT from DOM inputs. Playwright fill() updates DOM but NOT the grid
        # model → saveDcu sees empty values → validation fires alert "Lead Time
        # is required" → save aborts silently. Fix: use g.setCellValueById()
        # to write directly into model. Auto-discover price column ID.
        scope_for_grid = self._scope()
        grid_result = await scope_for_grid.evaluate(
            """(args) => {
                const g = itemGridBox;
                if (!g) return { ok: false, why: 'itemGridBox missing' };
                // Find row by bqms_code — known to be col 15 from earlier discovery
                const numRows = g.getRowsNum();
                let rowId = null;
                for (let i = 0; i < numRows; i++) {
                    const rid = g.getRowId(i);
                    try {
                        const v = g.cells2(i, 15).getValue();
                        if (v === args.code) { rowId = rid; break; }
                    } catch(e) {}
                }
                if (!rowId) return { ok: false, why: 'row not found for code', code: args.code };

                // Auto-discover price column id: scan columns whose label/id
                // suggests price/amount, or fallback to col 7 (known position from sample).
                let priceColId = null;
                const numCols = g.getColumnsNum();
                const labelOf = (i) => {
                    if (g.getColumnLabel) return (g.getColumnLabel(i) || '').replace(/<[^>]+>/g,'');
                    return '';
                };
                for (let i = 0; i < numCols; i++) {
                    const cid = (g.getColumnId(i) || '').toUpperCase();
                    const lbl = labelOf(i).toLowerCase();
                    if (cid.includes('PRICE') || cid.includes('AMOUNT') || cid.includes('QUOT_AMT')
                        || lbl.includes('quotation price')) {
                        priceColId = g.getColumnId(i);
                        break;
                    }
                }
                if (!priceColId) {
                    // Fallback: column index 7 (verified from sample_row0 in discovery)
                    priceColId = g.getColumnId(7);
                }

                // Now set values via the grid API.
                // CRITICAL (Thang 2026-05-15): Samsung's getCellValueById uses
                // signature `(colId, rowId)` — column first. setCellValueById
                // must match. Try multiple methods/orderings + verify via get.
                const out = { ok: true, rowId: rowId, priceColId: priceColId, sets: {} };
                const setCell = (colId, value) => {
                    const before = g.getCellValueById(colId, rowId);
                    let after = before;
                    // Method 1: setCellValueById(colId, rowId, val) — matches getCellValueById signature
                    try { g.setCellValueById(colId, rowId, value); after = g.getCellValueById(colId, rowId); } catch(e){}
                    if (String(after) === String(value)) return {method: 'set_colId_rowId', ok: true, value: after};
                    // Method 2: setCellValueById(rowId, colId, val) — reverse order
                    try { g.setCellValueById(rowId, colId, value); after = g.getCellValueById(colId, rowId); } catch(e){}
                    if (String(after) === String(value)) return {method: 'set_rowId_colId', ok: true, value: after};
                    // Method 3: cells(rowId, colIdx).setValue(value)
                    try {
                        const numCols = g.getColumnsNum();
                        let cIdx = -1;
                        for (let i = 0; i < numCols; i++) if (g.getColumnId(i) === colId) { cIdx = i; break; }
                        if (cIdx >= 0) {
                            g.cells(rowId, cIdx).setValue(value);
                            after = g.getCellValueById(colId, rowId);
                        }
                    } catch(e){}
                    if (String(after) === String(value)) return {method: 'cells.setValue', ok: true, value: after};
                    return {method: 'all_failed', ok: false, before: before, after: after};
                };
                out.sets.price = setCell(priceColId, args.price);
                out.sets.lead = setCell('LEAD_TIME', args.lead);
                out.sets.free_charge = setCell('FREE_CHARGE', 'N');
                if (args.abandonment === 'Y') {
                    out.sets.giveup = setCell('SUBMIT_GIVEUP', 'Y');
                }
                return out;
            }""",
            {
                "code": code,
                "price": int(item["quotation_price"]),
                "lead": int(item.get("lead_time_days", 30)),
                "abandonment": item.get("abandonment", "N"),
            },
        )
        logger.info("Grid model set for %s: %s", code, grid_result)
        if not grid_result.get("ok"):
            raise RuntimeError(
                f"Failed to write to grid model for {code}: {grid_result.get('why')}"
            )
        await asyncio.sleep(0.3)

        # Note: C4 abandonment + C5 lead_time đã handle ở grid_result block
        # phía trên qua setCellValueById('LEAD_TIME', 'SUBMIT_GIVEUP').
        # Không cần touch DOM input nữa — grid model là source of truth.
        logger.info(
            "Filled item %s via grid model: price=%s lead=%s abandonment=%s (priceColId=%s)",
            code, item["quotation_price"], item.get("lead_time_days", 30),
            item.get("abandonment", "N"), grid_result.get("priceColId"),
        )

    async def _upload_item_image(self, row, code: str, image_path: str):
        """Upload image cho 1 item qua Samsung's flow.

        Discovery (Thang 2026-05-15 inspect script):
        - Items table render bằng dhtmlxGrid với global var `itemGridBox`
        - Method gọi popup: `imageViewerOpen()` đọc selected row + open new window
          tới `/bqms/mro/common/CropImage/openViewer.do?itemCode=X&reqNo=Y&...`
        - Popup window mới chứa Edit button → mở Item Image Uploader
        - Uploader có `<input type="file">` để set_input_files()
        """
        if not Path(image_path).exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        scope = self._scope()

        # Step 1: Select row by bqms_code. Diagnostic version (Thang 2026-05-15):
        # search ALL columns (column name 'ITEM_ID' might not exist in this grid),
        # try multiple dhtmlx selection APIs, dump imageViewerOpen source to know
        # what state it reads.
        select_result = await scope.evaluate(
            """(target) => {
                if (typeof itemGridBox === 'undefined') {
                    return { ok: false, why: 'itemGridBox not found' };
                }
                const g = itemGridBox;
                const numRows = g.getRowsNum();
                const numCols = (g.getColumnsNum && g.getColumnsNum()) || 30;

                // Search target across all columns of all rows
                let foundIdx = -1, foundCol = -1, foundValue = null;
                const all_rows = [];
                for (let i = 0; i < numRows; i++) {
                    const rowId = g.getRowId(i);
                    const cells = {};
                    for (let c = 0; c < numCols; c++) {
                        try {
                            const v = g.cells2(i, c).getValue();
                            cells[c] = (v == null) ? null : String(v).slice(0, 80);
                            if (v === target && foundIdx === -1) {
                                foundIdx = i;
                                foundCol = c;
                                foundValue = v;
                            }
                        } catch (e) {}
                    }
                    all_rows.push({ rowId: rowId, cells: cells });
                }

                if (foundIdx < 0) {
                    return { ok: false, why: 'item not in grid', target: target, all_rows: all_rows };
                }

                const rowId = g.getRowId(foundIdx);

                // Multi-method selection — different dhtmlx versions react to different APIs
                try { g.selectRowById(rowId, false, true, true); } catch(e) {}
                try { g.selectRow && g.selectRow(foundIdx, false, false, true); } catch(e) {}
                try { g.setActive && g.setActive(rowId); } catch(e) {}
                try { g.selectCell && g.selectCell(foundIdx, foundCol, false, false, true); } catch(e) {}
                try { g.callEvent && g.callEvent("onRowSelect", [rowId, 0, null]); } catch(e) {}
                // Force native click on cell to trigger UI listeners
                try {
                    const cellObj = g.cells2(foundIdx, 0);
                    if (cellObj && cellObj.cell) {
                        cellObj.cell.click();
                        const ev = new MouseEvent('mousedown', { bubbles: true });
                        cellObj.cell.dispatchEvent(ev);
                    }
                } catch(e) {}

                // Inspect imageViewerOpen source — short snippet for debug
                let ivOpenSrc = null;
                try {
                    if (typeof imageViewerOpen === 'function') {
                        ivOpenSrc = imageViewerOpen.toString().slice(0, 1000);
                    }
                } catch(e) {}

                return {
                    ok: true,
                    foundIdx: foundIdx,
                    foundCol: foundCol,
                    foundValue: foundValue,
                    rowId: rowId,
                    sel_after: (g.getSelectedRowId && g.getSelectedRowId()) || null,
                    sel_idx_after: (g.getSelectedRowIndex && g.getSelectedRowIndex && g.getSelectedRowIndex()) || null,
                    ivOpenSrc: ivOpenSrc,
                    all_rows: all_rows,
                };
            }""",
            code,
        )
        if not select_result.get("ok"):
            raise RuntimeError(
                f"selectRow failed for {code}: {select_result.get('why')}. "
                f"all_rows={select_result.get('all_rows')}"
            )
        logger.info(
            "Selected dhtmlx row for %s: idx=%s col=%s id=%s sel_after=%s sel_idx_after=%s",
            code,
            select_result.get('foundIdx'),
            select_result.get('foundCol'),
            select_result.get('rowId'),
            select_result.get('sel_after'),
            select_result.get('sel_idx_after'),
        )
        iv_src = select_result.get('ivOpenSrc')
        if iv_src:
            logger.info("imageViewerOpen source (first 800 chars): %s", iv_src[:800])
        # Log full grid dump only for item 1 (diagnostic for first push after fix)
        if code.endswith("0-565933"):  # Item 1 only — avoid log spam
            logger.info("Grid dump for diagnostics: %s",
                        str(select_result.get('all_rows'))[:2000])
        await asyncio.sleep(0.5)

        # Step 2: Trigger imageViewerOpen — opens new popup window
        async with self._context.expect_page(timeout=15_000) as new_page_info:
            await scope.evaluate("imageViewerOpen()")
        uploader_window = await new_page_info.value
        popup_url = uploader_window.url
        logger.info("Opened image viewer popup: %s", popup_url[:160])
        await uploader_window.wait_for_load_state("domcontentloaded", timeout=15_000)
        await asyncio.sleep(2)
        # Re-read URL after load — Samsung sometimes navigates inside popup
        popup_url = uploader_window.url

        # Validate popup truly targets THIS bqms_code (Bug fix Thang 2026-05-15).
        # imageViewerOpen() builds URL từ currently-selected row của itemGridBox.
        # Nếu selectRowById ở Step 1 không thực sự switch active row → URL sẽ
        # giữ itemCode của item TRƯỚC → ta sẽ upload ảnh sai item.
        if f"itemCode={code}" not in popup_url:
            try:
                await uploader_window.screenshot(
                    path=f"/data/bqms-push-evidence/_popup_mismatch_{code}.png"
                )
            except Exception:
                pass
            try:
                if not uploader_window.is_closed():
                    await uploader_window.close()
            except Exception:
                pass
            raise RuntimeError(
                f"Image popup mismatch: expected itemCode={code}, "
                f"got URL={popup_url[:200]}. dhtmlxGrid row selection didn't switch."
            )

        # Register dialog handler on new window too
        async def _on_uploader_dialog(d):
            try:
                await d.accept()
            except Exception:
                pass
        uploader_window.on("dialog", _on_uploader_dialog)

        # Step 3: Click Edit button in popup — navigates SAME window to Uploader page
        # (NOT a new tab — Samsung loads Uploader URL into same popup window)
        edit_clicked = False
        for sel in [
            'button:text-is("Edit")',
            'a:text-is("Edit")',
            'input[type="button"][value="Edit"]',
            'button:has-text("Edit")',
        ]:
            try:
                btn = uploader_window.locator(sel).first
                if await btn.count() and await btn.is_visible(timeout=2000):
                    await btn.click()
                    edit_clicked = True
                    logger.info("Clicked Edit in image popup via %s", sel)
                    break
            except Exception:
                continue
        if not edit_clicked:
            await uploader_window.screenshot(path=f"/data/bqms-push-evidence/_imgpopup_{code}_no_edit.png")
            raise RuntimeError("Edit button not found in image popup")

        # Wait for navigation to Uploader page (same window, URL changes)
        try:
            await uploader_window.wait_for_load_state("domcontentloaded", timeout=10_000)
        except Exception:
            pass
        await asyncio.sleep(3)
        logger.info("After Edit click, uploader URL: %s", uploader_window.url[:120])

        # Step 4: set_input_files on hidden file input (now in same window)
        # Item Image Uploader page has "Add Image" button → hidden <input type=file>
        # Need to find the file input — may need to wait for it
        for _ in range(10):
            try:
                file_input = uploader_window.locator('input[type="file"]').first
                if await file_input.count():
                    break
            except Exception:
                pass
            await asyncio.sleep(1)
        else:
            await uploader_window.screenshot(path=f"/data/bqms-push-evidence/_uploader_{code}_no_input.png")
            raise RuntimeError("No file input in Item Image Uploader")

        await file_input.set_input_files(image_path)
        await asyncio.sleep(3)
        logger.info("set_input_files done for %s: %s", code, image_path)

        # Step 5: Click Save in Item Image Uploader
        save_clicked = False
        for sel in [
            'button:has-text("Save")',
            'a:has-text("Save")',
            'input[type="button"][value="Save"]',
            'a:text-is("Save")',
        ]:
            try:
                btn = uploader_window.locator(sel).first
                if await btn.count() and await btn.is_visible(timeout=2000):
                    await btn.click()
                    save_clicked = True
                    logger.info("Clicked Save in uploader via %s", sel)
                    break
            except Exception:
                continue
        await asyncio.sleep(3)
        if not save_clicked:
            logger.warning("Save button not found in uploader — may have auto-saved")

        # Close popup window
        try:
            if uploader_window and not uploader_window.is_closed():
                await uploader_window.close()
        except Exception:
            pass
        logger.info("Image upload complete for %s", code)

    # ─── Step D: Quote Valid Date ────────────────────────────

    async def _fill_quote_valid_date(self, date_str: str):
        """Fill Quote Valid Date input (format YYYY-MM-DD). Use edit frame scope.

        CRITICAL: same commit issue as price — fill + Enter + blur or Samsung's
        form model doesn't update → save_temp persists empty date.
        """
        scope = self._scope()
        for sel in [
            'input[name*="quoteValid"], input[id*="quoteValid"]',
            'input[name*="QuoteValid"], input[id*="QuoteValid"]',
            'input[name*="validDt"], input[id*="validDt"]',
            'input[placeholder*="valid"], input[placeholder*="Valid"]',
        ]:
            inp = scope.locator(sel).first
            if await inp.count():
                await inp.fill(date_str)
                try:
                    await inp.press("Enter")
                except Exception:
                    pass
                try:
                    await inp.dispatch_event("change")
                    await inp.dispatch_event("blur")
                except Exception:
                    pass
                await asyncio.sleep(0.5)
                logger.info("Filled Quote Valid Date: %s (committed)", date_str)
                return
        logger.warning("Quote Valid Date input not found")

    # ─── Step E: Submission Opinion ──────────────────────────

    async def _fill_submission_opinion(self, opinion: str):
        """Fill textarea Submission Opinion. Commit via change+blur."""
        scope = self._scope()
        for sel in [
            'textarea[name*="opinion"], textarea[id*="opinion"]',
            'textarea[name*="Opinion"], textarea[id*="Opinion"]',
            'textarea[placeholder*="enter it"], textarea[placeholder*="Please enter"]',
        ]:
            ta = scope.locator(sel).first
            if await ta.count():
                await ta.fill(opinion)
                try:
                    await ta.dispatch_event("change")
                    await ta.dispatch_event("blur")
                except Exception:
                    pass
                await asyncio.sleep(0.3)
                logger.info("Filled Submission Opinion: %s chars (committed)", len(opinion))
                return
        logger.warning("Submission Opinion textarea not found")

    # ─── Step F: File Attachments ────────────────────────────

    async def _set_attachment_types(self, target: str = "Quotation") -> dict:
        """After PDF upload, set each file row's "type" dropdown to `target`.

        Discovery (Thang 2026-05-15 user note): file row has a "type" `<select>`
        with options Quotation/Proposal/License/.../Others. Default empty →
        Samsung validates non-empty before save → empty causes silent reject.

        Try in: scope (edit frame) + dext-grid iframes (where file list renders).
        """
        scope = self._scope()
        results = {"frames_tried": 0, "selects_changed": 0, "errors": []}
        # Targets: scope (edit frame) + main-grid svg iframes (file list lives there)
        target_frames = [scope]
        for f in self._page.frames:
            u = (f.url or "").lower()
            if "dextuploadx5-main-grid" in u or "dextuploadx5-main-list" in u:
                if f not in target_frames:
                    target_frames.append(f)
        for frame in target_frames:
            results["frames_tried"] += 1
            try:
                changed = await frame.evaluate(
                    """(target) => {
                        let count = 0;
                        const selects = document.querySelectorAll('select');
                        for (const sel of selects) {
                            // Skip selects that don't have the target as an option
                            const opts = Array.from(sel.options).map(o => o.text || o.value);
                            if (!opts.some(o => (o || '').trim() === target)) continue;
                            // Skip selects that already have a non-empty value
                            const cur = (sel.value || '').trim();
                            if (cur && cur !== '') continue;
                            // Set
                            for (const opt of sel.options) {
                                if ((opt.text || '').trim() === target ||
                                    (opt.value || '').trim() === target) {
                                    sel.value = opt.value;
                                    sel.dispatchEvent(new Event('change', {bubbles: true}));
                                    sel.dispatchEvent(new Event('input', {bubbles: true}));
                                    count++;
                                    break;
                                }
                            }
                        }
                        return count;
                    }""",
                    target,
                )
                results["selects_changed"] += int(changed or 0)
            except Exception as exc:
                results["errors"].append(str(exc)[:150])
        return results

    async def _upload_attachments(self, paths: list[str]):
        """Upload file attachments — Samsung dùng DextUpload5 widget.

        Strategy (Thang 2026-05-15 multi-attempt):
        1. Find ANY input[type=file] (even hidden via display:none/opacity:0).
           DextUpload5 often has hidden HTML input dùng cho native browser picker.
           Set files directly even if hidden.
        2. Discover DextUpload5 JS API: list `dx5*` functions + DOM elements.
        3. Use Playwright Page.expect_file_chooser() to intercept native file
           picker khi gọi dx5AddFile() — works if widget opens browser picker.
        4. Fallback: SKIP với warning, user upload manual.
        """
        scope = self._scope()
        existing = [p for p in paths if Path(p).exists()]
        if not existing:
            logger.warning("No valid attachment paths — skipping")
            return

        # ── Strategy 0a (Thang 2026-05-15 v4 — DataTransfer JS injection) ──
        # Discovery from v14: DextUpload5 mỗi instance có 1 input
        # id="XHTML-INPUT-FILES" trong SVG iframe `dextuploadx5-main-*.svg`.
        # Input đó nằm trong SVG namespace (rect_w=h=0) → Playwright
        # `set_input_files` raise "Node is not an HTMLInputElement". Bypass
        # bằng JS DataTransfer API: decode file → Blob → File → input.files,
        # rồi dispatch 'change' event để SDK handler pickup.
        import base64
        files_b64 = []
        for p in existing:
            with open(p, "rb") as fh:
                files_b64.append({
                    "b64": base64.b64encode(fh.read()).decode("ascii"),
                    "filename": Path(p).name,
                    "mime": ("application/pdf" if p.lower().endswith(".pdf")
                             else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                  if p.lower().endswith((".xlsx", ".xls"))
                             else "application/octet-stream"),
                })

        # Identify DextUpload5 main-grid / main-list iframes (where the input lives)
        dext_input_frames = []
        for f in self._page.frames:
            u = (f.url or "").lower()
            if "dextuploadx5-main-grid" in u or "dextuploadx5-main-list" in u:
                dext_input_frames.append(f)

        # Prefer the qtEprEditU instance frame (the actual File Attachment area)
        dext_input_frames.sort(
            key=lambda f: 0 if "qteprEditU".lower() in (f.url or "").lower() else 1
        )

        for frame in dext_input_frames:
            try:
                result = await frame.evaluate(
                    """(files) => {
                        const inp = document.querySelector('input[type="file"]#XHTML-INPUT-FILES');
                        if (!inp) return {ok: false, why: 'XHTML-INPUT-FILES not found'};
                        try {
                            const dt = new DataTransfer();
                            for (const f of files) {
                                const binary = atob(f.b64);
                                const bytes = new Uint8Array(binary.length);
                                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                                const blob = new Blob([bytes], {type: f.mime});
                                const file = new File([blob], f.filename, {type: f.mime, lastModified: Date.now()});
                                dt.items.add(file);
                            }
                            inp.files = dt.files;
                            // Fire BOTH change and input events; some SDKs listen on either
                            inp.dispatchEvent(new Event('change', {bubbles: true, cancelable: true}));
                            inp.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
                            return {ok: true, count: dt.files.length, names: Array.from(dt.files).map(f => f.name)};
                        } catch (e) {
                            return {ok: false, why: String(e).slice(0, 300)};
                        }
                    }""",
                    files_b64,
                )
                logger.info(
                    "DataTransfer inject (frame=%s): %s",
                    (frame.url or "")[-80:], result,
                )
                if isinstance(result, dict) and result.get("ok"):
                    # Give SDK time to process the change event + add to internal list
                    await asyncio.sleep(4)
                    logger.info(
                        "Uploaded %d attachments via DataTransfer JS injection (%s)",
                        len(existing), (frame.url or "")[-60:],
                    )
                    # CRITICAL (Thang 2026-05-15): Samsung requires file "type"
                    # dropdown set per row — default empty → save validation fail.
                    # Set ALL uploaded file rows to type="Quotation".
                    try:
                        type_set = await self._set_attachment_types(target="Quotation")
                        logger.info("Set attachment type='Quotation': %s", type_set)
                    except Exception as exc:
                        logger.warning("Set attachment type failed: %s", str(exc)[:200])
                    return
            except Exception as exc:
                logger.warning(
                    "DataTransfer inject failed on frame %s: %s",
                    (frame.url or "")[-60:], str(exc)[:200],
                )

        # ── Strategy 0 (Thang 2026-05-15 v2): scan ALL frames for toolbar.
        # Discovery from v10: 6 dextupload iframes đều là .svg modules (Upper/
        # Down icons + main-grid). Nút Add KHÔNG nằm trong SVG iframes — phải
        # nằm trong HTML frame nào đó chứa cả 4 text "Upper/Move Down/Add/Delete".
        # Strategy: scan toàn bộ frames tìm frame có đủ 4 text → đó là frame
        # chứa toolbar → click Add bên trong + intercept file_chooser.
        try:
            all_frames = [self._page.main_frame]
            for f in self._page.frames:
                if f != self._page.main_frame:
                    all_frames.append(f)
            logger.info(
                "Scanning %d frames for toolbar (Upper+Move Down+Add+Delete)",
                len(all_frames),
            )

            toolbar_frame = None
            for frame in all_frames:
                try:
                    has_all = await frame.evaluate(
                        """() => {
                            const t = (document.body && document.body.textContent) || '';
                            return ['Upper', 'Move Down', 'Add', 'Delete'].every(s => t.includes(s));
                        }"""
                    )
                    if has_all:
                        toolbar_frame = frame
                        logger.info(
                            "Toolbar frame located: %s",
                            (frame.url or "main_frame")[:160],
                        )
                        break
                except Exception:
                    continue

            if toolbar_frame is not None:
                # First dump toolbar HTML so we know what to target (diagnostic)
                try:
                    dump = await toolbar_frame.evaluate(
                        """() => {
                            // XPath: find ANY element whose text contains "Move Down"
                            // (any nesting, not just leaf nodes)
                            const xp = "//*[contains(normalize-space(.), 'Move Down') and not(self::script) and not(self::style)]";
                            const res = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                            // Pick smallest (deepest) match — that's the actual button or its label
                            let best = null, minLen = Infinity;
                            for (let i = 0; i < res.snapshotLength; i++) {
                                const n = res.snapshotItem(i);
                                const t = (n.textContent || '').length;
                                if (t < minLen) { minLen = t; best = n; }
                            }
                            if (!best) return {found: false};
                            // Walk up until we find element containing all 4 button texts (toolbar parent)
                            let p = best;
                            while (p && p.parentElement) {
                                const txt = (p.textContent || '');
                                if (['Upper','Move Down','Add','Delete'].every(s => txt.includes(s))) {
                                    return {
                                        found: true,
                                        toolbar_tag: p.tagName,
                                        toolbar_id: p.id || '',
                                        toolbar_cls: (p.className || '').slice(0, 100),
                                        toolbar_html: p.outerHTML.slice(0, 3500),
                                        leaf_tag: best.tagName,
                                        leaf_outerHTML: best.outerHTML.slice(0, 500),
                                    };
                                }
                                p = p.parentElement;
                            }
                            return {found: false, why: 'no ancestor has all 4 texts'};
                        }"""
                    )
                    logger.info("Toolbar deep dump: %s", str(dump)[:3500])
                except Exception as exc:
                    logger.debug("Toolbar dump failed: %s", exc)

                # Found button via dump: <a id="addFile" onclick="dx5AddFile(...)">.
                # Strategy 0a (Thang 2026-05-15 v3): click #addFile → wait for
                # DextUpload5 CUSTOM modal to render → find newly-appeared
                # input[type=file] inside modal → set_input_files.
                #
                # Why: openFileDialog() doesn't open NATIVE picker. It renders
                # a DextUpload5-styled HTML modal with hidden <input type=file>.
                # The custom modal IS rendered as actual DOM (not real OS dialog).
                # Playwright can still set files via the hidden input.
                try:
                    add_btn = toolbar_frame.locator('#addFile').first
                    if await add_btn.count():
                        # Count file inputs BEFORE click (baseline)
                        n_inputs_before = 0
                        for f in self._page.frames:
                            try:
                                n_inputs_before += await f.locator('input[type="file"]').count()
                            except Exception:
                                pass
                        logger.info("Pre-click file inputs total: %d", n_inputs_before)

                        # Click Add — fire dx5AddFile → render modal
                        await add_btn.click(force=True)
                        await asyncio.sleep(2.5)  # let DextUpload5 modal render

                        # Search all frames POST-click for newly-appeared file inputs
                        post_frames = [self._page.main_frame] + [
                            f for f in self._page.frames if f != self._page.main_frame
                        ]
                        for f in post_frames:
                            try:
                                inps = f.locator('input[type="file"]')
                                n = await inps.count()
                                if n == 0:
                                    continue
                                logger.info(
                                    "Post-click: frame %s has %d input[type=file]",
                                    (f.url or "main")[:80], n,
                                )
                                # Try each (some may be wrong instance)
                                for i in range(n):
                                    try:
                                        # Inspect input properties first
                                        info = await inps.nth(i).evaluate(
                                            """el => ({
                                                name: el.name||'', id: el.id||'',
                                                accept: el.accept||'',
                                                multiple: !!el.multiple,
                                                disabled: !!el.disabled,
                                                ptag: el.parentElement && el.parentElement.tagName,
                                                pid: el.parentElement && el.parentElement.id,
                                                rect_w: el.getBoundingClientRect().width,
                                                rect_h: el.getBoundingClientRect().height,
                                            })"""
                                        )
                                        logger.info("input #%d info: %s", i, info)
                                        await inps.nth(i).set_input_files(existing, timeout=5000)
                                        await asyncio.sleep(3)
                                        logger.info(
                                            "Uploaded %d attachments via post-click input "
                                            "(frame=%s, idx=%d)",
                                            len(existing), (f.url or "main")[:60], i,
                                        )
                                        await asyncio.sleep(2)
                                        return
                                    except Exception as exc:
                                        logger.info(
                                            "post-click input #%d set_input_files FAIL: %s",
                                            i, str(exc)[:300],
                                        )
                                        continue
                            except Exception as exc:
                                logger.debug(
                                    "post-click frame scan failed: %s", str(exc)[:120],
                                )
                                continue
                        logger.info(
                            "Post-click search found no file input to use",
                        )
                except Exception as exc:
                    logger.warning("Add#addFile + post-click strategy failed: %s", str(exc)[:200])
        except Exception as exc:
            logger.warning("Toolbar scan strategy failed: %s", str(exc)[:200])

        # ── Strategy 1: ANY input[type=file] including hidden ──────────────
        try:
            inputs_locator = scope.locator('input[type="file"]')
            n_inputs = await inputs_locator.count()
            logger.info(
                "DextUpload probe: found %d input[type=file] (hidden or visible)",
                n_inputs,
            )
            for idx in range(n_inputs):
                inp = inputs_locator.nth(idx)
                try:
                    # set_input_files works even on hidden inputs
                    await inp.set_input_files(existing, timeout=6000)
                    await asyncio.sleep(3)
                    logger.info(
                        "Uploaded %d attachments via hidden input #%d",
                        len(existing), idx,
                    )
                    return
                except Exception as exc:
                    logger.debug("Hidden input #%d set failed: %s", idx, str(exc)[:120])
                    continue
        except Exception as exc:
            logger.warning("input[type=file] strategy failed: %s", str(exc)[:200])

        # ── Strategy 2: Deep DextUpload5 introspection + multi-call attempts ──
        try:
            discover = await scope.evaluate(
                """() => {
                    const out = {dx_funcs: [], dext_elements: [], dext_globals: []};
                    for (const k of Object.keys(window)) {
                        try {
                            if (typeof window[k] === 'function' &&
                                (k.toLowerCase().startsWith('dx5') ||
                                 k.toLowerCase().startsWith('dext'))) {
                                out.dx_funcs.push(k);
                            }
                            if (typeof window[k] === 'object' && window[k] != null) {
                                const lk = k.toLowerCase();
                                if (lk.includes('dext') || lk.includes('dx5')) {
                                    out.dext_globals.push(k);
                                }
                            }
                        } catch(e) {}
                    }
                    const sel = '[id*="DextUpload"], [id*="dext5"], [id*="Dext5"], ' +
                                '[class*="DextUpload"], [class*="dext5"], [class*="Dext5"], ' +
                                '[id*="dx5"]';
                    document.querySelectorAll(sel).forEach(d => {
                        out.dext_elements.push({
                            tag: d.tagName, id: d.id, cls: (d.className||'').slice(0,80),
                        });
                    });
                    // Inspect dx5AddFile source
                    try {
                        if (typeof dx5AddFile === 'function') {
                            out.dx5AddFile_src = dx5AddFile.toString().slice(0, 600);
                        }
                    } catch(e) {}
                    // Inspect dextuploadx5Configuration if present
                    try {
                        if (window.dextuploadx5Configuration) {
                            out.config_keys = Object.keys(window.dextuploadx5Configuration).slice(0, 30);
                        }
                        if (window.dx5) {
                            out.dx5_keys = Object.keys(window.dx5).slice(0, 30);
                        }
                    } catch(e) {}
                    return out;
                }""",
            )
            logger.info("DextUpload5 deep discovery: %s", str(discover)[:1500])

            # Inspect dx5AddFile source to know what arg it expects
            dx_funcs = discover.get("dx_funcs", []) if isinstance(discover, dict) else []

            # ── 2.0: Try dx5.instances → openFileDialog via discovered instance IDs ──
            # Discovery from v8: dx5AddFile_src = "function(id){ dx5.get(id).openFileDialog(); }"
            # The id is a DextUpload5 instance ID stored in dx5.instances.
            try:
                instance_probe = await scope.evaluate(
                    """() => {
                        try {
                            if (!window.dx5 || !window.dx5.instances) return null;
                            return Object.keys(window.dx5.instances);
                        } catch(e) { return null; }
                    }"""
                )
                logger.info("dx5.instances keys: %s", instance_probe)
                if isinstance(instance_probe, list) and instance_probe:
                    for inst_id in instance_probe:
                        try:
                            async with self._page.expect_file_chooser(timeout=5000) as fc_info:
                                await scope.evaluate(
                                    f"dx5.get({inst_id!r}).openFileDialog()"
                                )
                            chooser = await fc_info.value
                            await chooser.set_files(existing)
                            await asyncio.sleep(4)
                            logger.info(
                                "Uploaded %d attachments via dx5.get('%s').openFileDialog() + chooser",
                                len(existing), inst_id,
                            )
                            return
                        except Exception as exc:
                            logger.debug(
                                "openFileDialog for instance '%s' failed: %s",
                                inst_id, str(exc)[:120],
                            )
            except Exception as exc:
                logger.warning("dx5.instances probe failed: %s", str(exc)[:200])

            # Try multiple call patterns + interception strategies
            if "dx5AddFile" in dx_funcs:
                # Try clicking the visible "Add" button via DOM hit-test
                # (Strategy 2a: find by text near attachment area)
                for sel in [
                    'button:has-text("Add")',
                    'a:has-text("Add")',
                    'input[type="button"][value="Add"]',
                    '[onclick*="dx5AddFile"]',
                    'img[onclick*="dx5AddFile"]',
                ]:
                    try:
                        btn = scope.locator(sel).first
                        if await btn.count() and await btn.is_visible(timeout=1500):
                            async with self._page.expect_file_chooser(timeout=4000) as fc_info:
                                await btn.click()
                            chooser = await fc_info.value
                            await chooser.set_files(existing)
                            await asyncio.sleep(3)
                            logger.info(
                                "Uploaded %d attachments via Add-button click + file chooser (sel=%s)",
                                len(existing), sel,
                            )
                            return
                    except Exception as exc:
                        logger.debug("Add-button %s failed: %s", sel, str(exc)[:120])

                # Strategy 2b: call dx5AddFile with various arg patterns
                for js_call in [
                    "dx5AddFile()",
                    "dx5AddFile(0)",
                    "dx5AddFile('qtEprEditU')",
                    "dx5AddFile('qtSQuotInc')",
                ]:
                    try:
                        async with self._page.expect_file_chooser(timeout=3000) as fc_info:
                            await scope.evaluate(js_call)
                        chooser = await fc_info.value
                        await chooser.set_files(existing)
                        await asyncio.sleep(3)
                        logger.info("Uploaded via JS %s + file chooser", js_call)
                        return
                    except Exception as exc:
                        logger.debug("JS %s failed: %s", js_call, str(exc)[:120])
        except Exception as exc:
            logger.warning("DextUpload5 strategy 2 failed: %s", str(exc)[:200])

        # ── Strategy 3: SKIP gracefully ─────────────────────────────────────
        logger.warning(
            "Attachment upload SKIPPED — DextUpload5 auto-upload couldn't bind. "
            "Anh upload %d file thủ công trên sec-bqms.com trước khi click Submit Final. "
            "Files: %s",
            len(existing), [Path(p).name for p in existing],
        )

    # ─── Step G: Save Temporarily ────────────────────────────

    async def _click_save_temporarily(self):
        """Trigger Samsung's saveDcu() to persist quote.

        Discovery (Thang 2026-05-15): button HTML is
            <a class="btn_action" href="javascript:saveDcu();">Save Temporarily</a>
        Playwright `click()` on `<a href="javascript:...">` does NOT always
        execute the javascript: URL because Playwright treats it as a no-op
        navigation. Bypass: call `saveDcu()` directly via scope.evaluate().

        Native validation alerts are auto-accepted by self._on_dialog handler
        (registered in _start_browser) — their messages appear in logs.
        """
        scope = self._scope()

        # Verify saveDcu exists in scope
        save_check = await scope.evaluate(
            """() => ({
                hasSaveDcu: typeof saveDcu === 'function',
                hasSaveBtn: !!document.querySelector('a[href*="saveDcu"], a.btn_action'),
            })"""
        )
        logger.info("Save Temp check: %s", save_check)

        if not save_check.get("hasSaveDcu"):
            raise RuntimeError(
                "saveDcu() not defined in edit frame — page state unexpected"
            )

        url_before = self._page.url
        # Pre-save diagnostic: dump current LEAD_TIME / price values from
        # grid model for EVERY row. If these are empty here, the values we
        # set earlier got reset somewhere (re-render / row update).
        pre_save_dump = await scope.evaluate(
            """() => {
                if (typeof itemGridBox === 'undefined') return {err: 'no grid'};
                const g = itemGridBox;
                const rows = [];
                for (let i = 0; i < g.getRowsNum(); i++) {
                    const rid = g.getRowId(i);
                    rows.push({
                        idx: i, rid: rid,
                        lead: g.getCellValueById('LEAD_TIME', rid),
                        price: g.getCellValueById('SUBMISSION_UNIT_PRICE', rid),
                        giveup: g.getCellValueById('SUBMIT_GIVEUP', rid),
                        free: g.getCellValueById('FREE_CHARGE', rid),
                    });
                }
                return {rows: rows};
            }"""
        )
        logger.info("PRE-SAVE grid state: %s", pre_save_dump)

        # If values are missing (reset between fill and save), RE-APPLY now.
        # This is workaround for unknown reset trigger (likely re-render after
        # attachment upload or _set_attachment_types iterating selects).
        if isinstance(pre_save_dump, dict) and pre_save_dump.get("rows"):
            needs_reset = any(
                str(r.get("lead", "")).strip() in ("", "0") or
                str(r.get("price", "")).strip() in ("", "0")
                for r in pre_save_dump["rows"]
            )
            payload = getattr(self, "_current_payload", None)
            if needs_reset and payload:
                logger.warning(
                    "Pre-save reset detected — re-applying %d items via grid model",
                    len(payload.get("items", [])),
                )
                reapply = await scope.evaluate(
                    """(items) => {
                        const g = itemGridBox;
                        if (!g) return {err: 'no grid'};
                        const out = [];
                        // For each item: find row by bqms_code (col 15), set price + lead + free_charge
                        let priceColId = null;
                        for (let i = 0; i < g.getColumnsNum(); i++) {
                            const cid = (g.getColumnId(i) || '').toUpperCase();
                            if (cid.includes('PRICE') || cid.includes('SUBMISSION_UNIT')) {
                                priceColId = g.getColumnId(i); break;
                            }
                        }
                        const numRows = g.getRowsNum();
                        for (const item of items) {
                            let rowId = null;
                            for (let i = 0; i < numRows; i++) {
                                try {
                                    if (g.cells2(i, 15).getValue() === item.bqms_code) {
                                        rowId = g.getRowId(i); break;
                                    }
                                } catch(e) {}
                            }
                            if (!rowId) {
                                out.push({code: item.bqms_code, err: 'row not found'});
                                continue;
                            }
                            try {
                                g.setCellValueById(priceColId, rowId, item.quotation_price);
                                g.setCellValueById('LEAD_TIME', rowId, item.lead_time_days || 30);
                                g.setCellValueById('FREE_CHARGE', rowId, 'N');
                                if ((item.abandonment || 'N') === 'Y') {
                                    g.setCellValueById('SUBMIT_GIVEUP', rowId, 'Y');
                                }
                                out.push({
                                    code: item.bqms_code, rid: rowId,
                                    price_after: g.getCellValueById(priceColId, rowId),
                                    lead_after: g.getCellValueById('LEAD_TIME', rowId),
                                });
                            } catch(e) {
                                out.push({code: item.bqms_code, err: String(e).slice(0,150)});
                            }
                        }
                        return out;
                    }""",
                    payload.get("items", []),
                )
                logger.info("Re-apply result: %s", reapply)

        # Also re-apply Quote Valid Date + Submission Opinion right before save
        # (these inputs also get reset like the grid cells).
        if payload:
            reapply_form = await scope.evaluate(
                """(args) => {
                    const out = {};
                    // Quote Valid Date — input id=validDt name=validDt
                    let dt = document.getElementById('validDt');
                    if (!dt) dt = document.querySelector('input[name="validDt"]');
                    if (dt) {
                        dt.value = args.valid_date;
                        dt.dispatchEvent(new Event('change', {bubbles: true}));
                        dt.dispatchEvent(new Event('input', {bubbles: true}));
                        dt.dispatchEvent(new Event('blur', {bubbles: true}));
                        // Also use jQuery if present
                        if (typeof $ === 'function') {
                            $(dt).val(args.valid_date).trigger('change');
                        }
                        out.valid_date_set = dt.value;
                    } else {
                        out.valid_date_err = 'input not found';
                    }
                    // Submission Opinion — textarea
                    let op = document.querySelector('textarea[name*="opinion" i], textarea[id*="opinion" i], textarea[name*="Opinion"], textarea[id*="Opinion"]');
                    if (op) {
                        op.value = args.opinion;
                        op.dispatchEvent(new Event('change', {bubbles: true}));
                        op.dispatchEvent(new Event('input', {bubbles: true}));
                        if (typeof $ === 'function') $(op).val(args.opinion).trigger('change');
                        out.opinion_set = (op.value || '').slice(0, 50);
                    } else {
                        out.opinion_err = 'textarea not found';
                    }
                    return out;
                }""",
                {
                    "valid_date": payload.get("quote_valid_date", ""),
                    "opinion": payload.get("submission_opinion", ""),
                },
            )
            logger.info("Form re-apply (valid_date + opinion): %s", reapply_form)

        # Direct invocation. Wrap in try/catch JS so we capture sync exception.
        # Native `alert()` and `confirm()` are auto-handled by self._on_dialog
        # (accepts everything). For confirm() that ASKS to proceed, accept=true
        # = OK = proceed with save.
        invoke_result = await scope.evaluate(
            """() => {
                try {
                    const ret = saveDcu();
                    return { ok: true, returned: typeof ret + ':' + String(ret).slice(0,200) };
                } catch (e) {
                    return { ok: false, err: String(e).slice(0, 300) };
                }
            }"""
        )
        logger.info("saveDcu() invoked: %s", invoke_result)

        # Wait 2s, then look for HTML confirmation modal (NOT native alert)
        # User note: "Save Temp sẽ hiện popup xác nhận upload"
        await asyncio.sleep(2)
        for confirm_attempt in range(3):
            try:
                clicked = await scope.evaluate(
                    """() => {
                        const out = {clicked: false, modals: []};
                        // Find any visible modal/dialog
                        const sel = '.modal:not([style*="display: none"]), .popup:not([style*="display: none"]), [role="dialog"]:not([style*="display: none"]), [class*="layerPopup"]:not([style*="display: none"])';
                        const modals = document.querySelectorAll(sel);
                        for (const m of modals) {
                            if (m.offsetParent === null) continue;
                            out.modals.push({
                                cls: (m.className||'').slice(0,60),
                                txt: (m.textContent||'').trim().slice(0,200),
                            });
                            // Find primary action button (OK/Yes/Confirm/Save)
                            const buttons = m.querySelectorAll('button, a, input[type=button], input[type=submit]');
                            for (const b of buttons) {
                                const t = (b.textContent || b.value || '').trim().toLowerCase();
                                if (['ok','yes','confirm','save','proceed','확인','예'].includes(t)) {
                                    b.click();
                                    out.clicked = true;
                                    out.clicked_text = t;
                                    return out;
                                }
                            }
                        }
                        return out;
                    }"""
                )
                if clicked.get("modals"):
                    logger.info("Post-save modal (try %d): %s", confirm_attempt+1, clicked)
                if clicked.get("clicked"):
                    logger.info("Clicked save-confirm button '%s'", clicked.get("clicked_text"))
                    await asyncio.sleep(4)
                    break
                await asyncio.sleep(2)
            except Exception as exc:
                logger.debug("modal probe try %d failed: %s", confirm_attempt+1, str(exc)[:100])

        # Final wait for server response
        await asyncio.sleep(4)
        url_after = self._page.url
        logger.info(
            "Post-saveDcu: url_before=%s url_after=%s changed=%s",
            url_before[-80:], url_after[-80:],
            "YES" if url_before != url_after else "NO",
        )

        logger.info("Save Temporarily completed via direct saveDcu() call")
        return

    # ─── Step H: Screenshot ──────────────────────────────────

    async def _save_screenshot(self, rfq_number: str, suffix: str = "") -> Path:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        name = f"{rfq_number}_{timestamp}"
        if suffix:
            name += f"_{suffix}"
        path = EVIDENCE_DIR / f"{name}.png"
        await self._page.screenshot(path=str(path), full_page=True)
        return path


# ─── Module-level singleton getter ─────────────────────────────

def get_pusher() -> BqmsQuotePusher:
    return BqmsQuotePusher.instance()
