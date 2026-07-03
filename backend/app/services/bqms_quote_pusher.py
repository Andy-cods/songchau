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
            #
            # Thang 2026-05-22: track validation alerts so saveDcu() can
            # report Samsung rejected the save. Without this, push reports
            # SUCCESS even when validation aborted save — user sees fields
            # missing on Samsung side and rightly complains.
            self._last_validation_alert: str | None = None
            async def _on_dialog(dialog):
                try:
                    msg = dialog.message
                    logger.info("Dialog auto-accept: type=%s message=%s",
                                dialog.type, msg[:200])
                    # Detect Samsung validation rejection patterns
                    msg_low = msg.lower()
                    if any(kw in msg_low for kw in (
                        "mandatory", "required", "is required",
                        "phải", "không được trống", "bắt buộc",
                        "필수", "is empty", "must be",
                    )):
                        self._last_validation_alert = msg[:300]
                        logger.warning(
                            "Samsung validation alert detected: %s", msg[:200]
                        )
                    await dialog.accept()
                except Exception as exc:
                    logger.warning("Dialog accept failed: %s", exc)
            self._page.on("dialog", _on_dialog)

    async def _login(self):
        """Login sec-bqms — reuse pattern từ bqms_bidding_scraper."""
        from app.core.config import settings
        await self._start_browser()
        from app.services.bqms_credentials import get_bqms_credentials
        base = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"
        user, pwd = get_bqms_credentials()
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
        """Đảm bảo session active + page về vendor portal MAIN.

        Thang 2026-05-22: bug fix — sau khi 1 push trước đó success, page
        ở edit URL. Push tiếp theo gọi `selectLeftMenu(10)` nhưng global JS
        function đó chỉ load trên main portal layout. Liveness check trước
        đây gọi bdEprSubmitList.do (sub-page) → session valid nhưng page sai
        state → selectLeftMenu undefined. Fix: ALWAYS navigate về
        vendorPortalMain.do sau liveness check để mọi push start từ cùng
        starting point.
        """
        await self._start_browser()
        if self._logged_in_at is None or (datetime.now() - self._logged_in_at) > self._session_max_age:
            logger.info("Session expired or new — logging in")
            await self._login()
            return
        # Quick liveness check + reset page về main portal
        try:
            from app.core.config import settings
            base = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"
            await self._page.goto(
                f"{base}/bqms/vendorPortal/vendorPortalMain.do?_mainLayOut=vendorPortalLayout",
                wait_until="domcontentloaded", timeout=15_000,
            )
            if "anonymous" in self._page.url or "login" in self._page.url.lower():
                logger.warning("Cookie expired during liveness check, re-login")
                await self._login()
                return
            # Verify selectLeftMenu is loaded (the global function we need)
            try:
                has_menu = await self._page.evaluate(
                    "typeof selectLeftMenu === 'function'"
                )
                if not has_menu:
                    logger.warning(
                        "selectLeftMenu missing after liveness check — re-login"
                    )
                    await self._login()
            except Exception as exc:
                logger.warning("selectLeftMenu probe failed (%s) — re-login", exc)
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

        Thang 2026-05-22: payload có thể chứa `_is_repush` (bool, default False).
        Khi True (push trước đã saved_temp, user click push lần nữa) → pusher
        chuyển sang OVERRIDE mode: bỏ qua idempotent skip cho ảnh + xóa file
        đính kèm cũ trước khi upload mới. Price/lead vẫn dùng idempotent
        check (đã sẵn handle case user_value khác Samsung_value → overwrite).
        """
        async with self._global_lock:
            start = datetime.now()
            rfq_number = payload["rfq_number"]
            # Re-push flag — set in task wrapper after reading prev_status
            self._is_repush = bool(payload.get("_is_repush", False))
            if self._is_repush:
                logger.info(
                    "[%s] PUSH MODE = OVERRIDE (re-push, previous status=saved_temp)",
                    rfq_number,
                )
            else:
                logger.info(
                    "[%s] PUSH MODE = NORMAL (first push or after failure)",
                    rfq_number,
                )
            # Store payload on self so _click_save_temporarily can re-apply
            # grid model values right before saveDcu (workaround for grid
            # values being wiped between _fill_one_item and save).
            self._current_payload = payload

            async def _p(pct, step, step_index=None, step_key=None):
                """Helper an toàn — callback có thể None.

                Thang 2026-06-22: forward optional step_index (1..8) + step_key
                to progress_cb so the popup renders the canonical 8-step
                checklist. Nested nav helpers still call _p with only (pct, step)
                → step_index/step_key default None → checklist keeps last value.
                """
                logger.info("[%s] %d%% — %s", rfq_number, pct, step)
                if progress_cb:
                    try:
                        await progress_cb(pct, step, step_index=step_index, step_key=step_key)
                    except TypeError:
                        # Tolerate a legacy progress_cb accepting only (pct, step)
                        try:
                            await progress_cb(pct, step)
                        except Exception as exc:
                            logger.warning("progress_cb failed: %s", exc)
                    except Exception as exc:
                        logger.warning("progress_cb failed: %s", exc)

            n_items = len(payload.get("items", []))
            # Canonical 8-step checklist (Thang 2026-06-22). label · cumulative %
            # when the step COMPLETES — IDENTICAL for every round V1..Vn:
            #   1 login       Đăng nhập sec-bqms     10
            #   2 session     Mở phiên & kiểm tra    18
            #   3 navigate    Điều hướng tới QT      32
            #   4 edit        Vào chế độ chỉnh sửa   42
            #   5 fill_items  Nhập giá & lead time   72  (interpolate 42→72 / N)
            #   6 fill_global Hạn báo giá + ý kiến   82
            #   7 attachments Tải file đính kèm      90
            #   8 save_temp   Lưu tạm & xác nhận     100
            # Per-item band (42→72) is the SAME band for V1 (image) and V2+
            # (price only) — bar moves consistently across rounds (removed the
            # old 55%/N vs 25%/N asymmetry).
            FILL_START, FILL_END = 42.0, 72.0
            per_item_pct = (FILL_END - FILL_START) / max(n_items, 1)

            try:
                await _p(2, "Đăng nhập sec-bqms", 1, "login")
                await self.ensure_session()
                await _p(10, "Đăng nhập sec-bqms", 1, "login")

                await _p(14, "Mở phiên & kiểm tra", 2, "session")
                # Pass _p so _ensure_on_bidding_list can update progress during
                # the 3 attempts (each ~15-20s wait loop). It calls _p with only
                # (pct, step) → step_index/key stay at last value (3 navigate).
                await _p(18, "Điều hướng tới QT", 3, "navigate")
                await self._goto_qt_detail(rfq_number, progress_cb=_p)
                await _p(32, "Điều hướng tới QT", 3, "navigate")

                # Thang 2026-05-22: if direct-form-submit fallback already put
                # us on EditU URL (re-push workaround), skip Edit click — page
                # is already in edit mode. CRITICAL: must locate the frame
                # containing `itemGridBox` (dhtmlxGrid global) — Samsung renders
                # content in nested frame structure.
                cur_url = (self._page.url or "").lower()
                if "qtsquoteditu" in cur_url:
                    logger.info(
                        "[%s] Already on EditU after navigation — skip Edit click",
                        rfq_number,
                    )
                    # Wait extra for grid + IBSheet to fully initialize
                    await asyncio.sleep(5)
                    # Find the frame that has itemGridBox (the items grid)
                    # OR submitContents (the opinion textarea) — both live
                    # in the content frame.
                    self._edit_frame = None
                    for attempt in range(15):
                        for fr in [self._page.main_frame] + list(self._page.frames):
                            fu = (fr.url or "").lower()
                            if "vendorlogin" in fu or "anonymous" in fu:
                                continue
                            try:
                                has_grid = await fr.evaluate(
                                    "typeof itemGridBox !== 'undefined'"
                                )
                            except Exception:
                                has_grid = False
                            if has_grid:
                                self._edit_frame = fr
                                logger.info(
                                    "[%s] Located EditU frame with itemGridBox: %s",
                                    rfq_number, (fr.url or 'main')[:80],
                                )
                                break
                        if self._edit_frame is not None:
                            break
                        await asyncio.sleep(1)
                    if self._edit_frame is None:
                        # Fallback to main frame; downstream may still fail but
                        # we tried our best.
                        logger.warning(
                            "[%s] itemGridBox not found in any frame after 15s — "
                            "falling back to main_frame (downstream may fail)",
                            rfq_number,
                        )
                        self._edit_frame = self._page.main_frame
                    await _p(42, "Vào chế độ chỉnh sửa", 4, "edit")
                else:
                    await _p(36, "Vào chế độ chỉnh sửa", 4, "edit")
                    await self._click_edit()
                    await _p(42, "Vào chế độ chỉnh sửa", 4, "edit")

                # CRITICAL FIX (Thang 2026-06-19): sau khi Edit mode active,
                # Samsung hiển thị 1 notification popup IBSheet ("Most Used
                # Pieces share the VAT include in pcs..." hoặc locale missing).
                # Popup này KHÔNG phải lỗi — chỉ là thông báo cần click OK.
                # Nếu không dismiss, IBSheet API call (getRowsNum, cells2,
                # setCellValueById) bị block → _fill_one_item fail với
                # "row not found for code" mặc dù row TỒN TẠI trong grid.
                # Test case: QT26075907 V2 (Z0000000-794221) — push fail 5 lần
                # cùng error, dismiss popup → push thành công.
                await _p(42, "Vào chế độ chỉnh sửa", 4, "edit")
                await self._dismiss_popups()
                await asyncio.sleep(1.5)  # cho IBSheet stabilize sau khi popup mất

                # Round 2/3/4: skip image upload + skip FREE_CHARGE/SUBMIT_GIVEUP
                # per Thang 2026-05-15 spec. Only fill price + lead_time per item.
                # Step 5 fill_items — interpolate across the SAME 42→72 band for
                # ALL rounds (per_item_pct computed above, independent of round).
                round_n = int(payload.get("round", 1))
                for idx, item in enumerate(payload["items"]):
                    base_pct = FILL_START + idx * per_item_pct
                    await _p(int(base_pct),
                             f"Nhập giá & lead time ({idx+1}/{n_items})",
                             5, "fill_items")
                    await self._fill_one_item(item, round_n=round_n)
                    await _p(int(base_pct + per_item_pct),
                             f"Nhập giá & lead time ({idx+1}/{n_items})",
                             5, "fill_items")

                await _p(76, "Hạn báo giá + ý kiến", 6, "fill_global")
                await self._fill_quote_valid_date(payload["quote_valid_date"])

                await _p(82, "Hạn báo giá + ý kiến", 6, "fill_global")
                await self._fill_submission_opinion(payload["submission_opinion"])

                if payload.get("attachment_paths"):
                    await _p(86, f"Tải file đính kèm ({len(payload['attachment_paths'])})",
                             7, "attachments")
                    await self._upload_attachments(payload["attachment_paths"])
                await _p(90, "Tải file đính kèm", 7, "attachments")

                await _p(94, "Lưu tạm & xác nhận", 8, "save_temp")
                await self._click_save_temporarily()
                await _p(98, "Lưu tạm & xác nhận", 8, "save_temp")

                screenshot_path = await self._save_screenshot(rfq_number)
                await _p(100, "Lưu tạm & xác nhận", 8, "save_temp")

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

    async def _ensure_on_bidding_list(self, progress_cb=None) -> bool:
        """Reuse pattern từ scraper bqms_bidding_scraper._ensure_on_bidding_list.

        Strategy (Thang 2026-05-22):
          1. Quick check — bdEprSubmitList đã trong scope?
          2. selectLeftMenu(10, 10, true) (preserves session)
          3. Fallback page.goto list URL
          4. NEW: force re-login + retry navigation (handles silent session kill)

        progress_cb(pct, step): optional callback so frontend nhìn được
        từng giây trong các vòng wait dài (15s mỗi attempt).
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

        async def _wait_for_js(label: str, total_secs: int, base_pct: int):
            """Wait + update progress every 3s so user sees activity."""
            for i in range(total_secs):
                await asyncio.sleep(1)
                try:
                    if await self._page.evaluate(js_check):
                        logger.info("→ recovered via %s after %ds", label, i+1)
                        return True
                except Exception:
                    pass
                # Push step text every 3s — keeps modal feeling responsive
                if progress_cb and (i + 1) % 3 == 0:
                    try:
                        await progress_cb(
                            base_pct,
                            f"Đợi Samsung Bidding list load ({label}, {i+1}/{total_secs}s)",
                        )
                    except Exception:
                        pass
            return False

        # Attempt 1: selectLeftMenu (in-app nav, preserves session)
        if progress_cb:
            try:
                await progress_cb(13, "Attempt 1/3: selectLeftMenu(10)")
            except Exception:
                pass
        try:
            await self._page.evaluate("selectLeftMenu(10, 10, true)")
            await asyncio.sleep(7)
            await self._dismiss_popups()
            if await _wait_for_js("selectLeftMenu", 15, 13):
                return True
        except Exception as exc:
            logger.warning("selectLeftMenu failed: %s", exc)

        # Attempt 2: full page.goto fallback
        if progress_cb:
            try:
                await progress_cb(14, "Attempt 2/3: page.goto bdEprSubmitListR")
            except Exception:
                pass
        list_url = (
            f"{base}/bqms/gbd/eprPotal/sbid/sbid/bdEprSubmitListR.do"
            f"?_menuId=AZib43qsAJIV-QNs&_menuF=true"
        )
        try:
            await self._page.goto(list_url, wait_until="domcontentloaded", timeout=20_000)
            await asyncio.sleep(4)
            await self._dismiss_popups()
            if await _wait_for_js("page.goto", 15, 14):
                return True
        except Exception as exc:
            logger.warning("page.goto fallback failed: %s", exc)

        # Attempt 3 (NEW): force re-login then retry page.goto
        # Handles case Samsung silently kills session (cookie still in browser
        # but server-side session invalidated → page renders but `bdEprSubmitList`
        # JS never loads because the page redirects internally or shows login).
        if progress_cb:
            try:
                await progress_cb(
                    15, "Attempt 3/3: force re-login Samsung (session có thể đã expire)",
                )
            except Exception:
                pass
        try:
            logger.warning("Both attempts failed — forcing full re-login + retry")
            self._logged_in_at = None  # invalidate so _login fires fresh
            await self._login()
            await self._page.goto(list_url, wait_until="domcontentloaded", timeout=20_000)
            await asyncio.sleep(4)
            await self._dismiss_popups()
            if await _wait_for_js("re-login+goto", 20, 15):
                return True
        except Exception as exc:
            logger.warning("re-login retry failed: %s", exc)

        # Capture diagnostic info BEFORE returning False so error includes
        # what we saw (page title, current URL, snippet of HTML).
        try:
            url = self._page.url
            title = await self._page.title()
            html_snippet = (await self._page.content())[:500]
            logger.error(
                "All 3 attempts failed to reach Bidding list.\n"
                "  Final URL: %s\n  Title: %s\n  HTML[:500]: %s",
                url, title, html_snippet,
            )
        except Exception:
            pass

        return False

    async def _dismiss_popups(self):
        """Đóng IBSheet locale popup hay confirm dialog nếu hiện.

        Thang 2026-05-22: mirror scraper's `_dismiss_ibsheet_popup` pattern —
        prioritize `.SheetMessage button` / `.SheetErrorMessage button` (the
        actual IBSheet popup widget Samsung shows after navigation, không
        phải confirm dialog thường), fallback to Enter key (works for native
        alert + IBSheet's HTML popup). User confirmed: popup chỉ là thông
        báo locale missing — click OK / press Enter là xong.

        Thang 2026-06-19: extend to check BOTH main page AND edit frame.
        Edit-mode popup ("Most Used Pieces share the VAT...") sometimes lives
        inside the edit iframe, not main page. Previously _dismiss_popups
        only checked main page → missed the V2/V3/V4 fill-blocking popup.
        """
        ibsheet_clicked = False
        # Strategy 1: try IBSheet popup selectors on BOTH main page + edit frame
        # (popup can render in either, depending on Samsung's frame routing)
        scopes_to_try = [self._page]
        if getattr(self, "_edit_frame", None) is not None:
            scopes_to_try.append(self._edit_frame)
        for scope in scopes_to_try:
            for sel in [
                '.SheetMessage button',
                '.SheetErrorMessage button',
            ]:
                try:
                    btn = await scope.query_selector(sel)
                    if btn:
                        txt = (await btn.text_content() or "").strip()
                        if txt.upper() == "OK":
                            await btn.click()
                            ibsheet_clicked = True
                            scope_name = "edit_frame" if scope is getattr(self, "_edit_frame", None) else "main_page"
                            logger.info("IBSheet popup dismissed via %s in %s", sel, scope_name)
                            await asyncio.sleep(0.5)
                            break
                except Exception:
                    continue
            if ibsheet_clicked:
                break

        # Strategy 2: generic confirm/OK buttons (Page locators handle frame chain)
        if not ibsheet_clicked:
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
                        break
                except Exception:
                    continue

        # Strategy 3: Enter key fallback — clears native alert + IBSheet popup
        # if buttons not clickable. Works because both popups have focus
        # bound to OK/Enter.
        try:
            await self._page.keyboard.press("Enter")
            await asyncio.sleep(0.3)
        except Exception:
            pass

        # Strategy 4 (Thang 2026-06-19): one more shot per scope via Enter key
        # inside the edit frame — some IBSheet popups capture focus inside
        # the iframe and main-page Enter doesn't reach them.
        if getattr(self, "_edit_frame", None) is not None:
            try:
                await self._edit_frame.evaluate(
                    """() => {
                        const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
                        document.dispatchEvent(ev);
                    }"""
                )
                await asyncio.sleep(0.3)
            except Exception:
                pass

    async def _goto_qt_detail(self, rfq_number: str, progress_cb=None):
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
        # 1. Ensure on bidding list page (with progress updates during wait loops)
        on_list = await self._ensure_on_bidding_list(progress_cb=progress_cb)
        if not on_list:
            # Capture screenshot AT failure point so user can see what page was shown
            try:
                fail_shot = await self._save_screenshot(rfq_number, suffix="NAV_FAIL")
                shot_hint = f" Screenshot: {fail_shot.name}"
            except Exception:
                shot_hint = ""
            try:
                page_title = await self._page.title()
            except Exception:
                page_title = "?"
            raise RuntimeError(
                f"Không vào được trang Bidding list sau 3 lần thử "
                f"(selectLeftMenu, page.goto, re-login+goto). "
                f"URL hiện tại: {self._page.url} | Title: {page_title}.{shot_hint} "
                f"Khả năng: Samsung session bị block tạm thời, "
                f"thử lại sau 5-10 phút hoặc liên hệ admin."
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
        # Thang 2026-05-22: mirror scraper pattern — Samsung shows IBSheet
        # locale popup AFTER moveQtSQuotContent, then 6-7s data loads.
        # Need to dismiss popup BEFORE polling for content.
        await asyncio.sleep(4)
        await self._dismiss_popups()  # IBSheet popup after nav
        await asyncio.sleep(5)
        try:
            await self._page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:
            pass
        # Final popup sweep + extra wait — sometimes IBSheet popup fires
        # in delayed waves after networkidle
        await self._dismiss_popups()
        await asyncio.sleep(2)
        final_url = self._page.url
        logger.info("After nav URL: %s", final_url)
        # Sanity check — detail URL không nên còn "bdEprSubmitListR" path
        if "bdEprSubmitListR" in final_url or "submitList" in final_url.lower():
            raise RuntimeError(
                f"Navigation appears stuck on list page: {final_url}. "
                f"Samsung's moveQtSQuotContent() may have been blocked."
            )

        # Thang 2026-05-22: detect "empty content" page — nav function ran but
        # didn't load QT detail. Happens for QTs in saved_temp status where
        # moveQtSQuotContent() doesn't render content (chỉ load chrome).
        #
        # Probe THE ACTUAL detail content: ContentR page should have either
        # an Edit/Modify action button OR show the items grid. If neither
        # exists after 10s of polling, page is empty → fallback POST.
        try:
            page_title = await self._page.title()
        except Exception:
            page_title = ""
        # Poll up to 10s for either Edit/Modify button OR itemGrid → page ready
        has_content = False
        for _ in range(10):
            try:
                probe = await self._page.evaluate(
                    """() => {
                        // Check 1: Edit / Modify button visible
                        const btns = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
                        for (const b of btns) {
                            const t = (b.textContent || b.value || '').trim().toLowerCase();
                            if (t === 'edit' || t === 'modify' || t === '수정') {
                                const r = b.getBoundingClientRect();
                                if (r.width > 0 && r.height > 0) return {has: true, why: 'edit_btn'};
                            }
                        }
                        // Check 2: items grid present (any frame has itemGridBox)
                        if (typeof itemGridBox !== 'undefined') return {has: true, why: 'itemGridBox'};
                        // Check 3: Look for QT-specific basic info markers
                        const body = (document.body && document.body.textContent || '').toLowerCase();
                        if (body.includes('basic information') || body.includes('quotation amount')) {
                            return {has: true, why: 'basic_info_text'};
                        }
                        return {has: false};
                    }"""
                )
                if probe.get("has"):
                    has_content = True
                    logger.info(
                        "QT detail content detected: %s", probe.get("why")
                    )
                    break
            except Exception:
                pass
            await asyncio.sleep(1)

        # Trigger staging-form fallback ONLY when no detail content found
        # after extended polling — saved_temp QT silently rejecting moveQt.
        if (not has_content
            and "search" in (page_title or "").lower()
            and "qtsquotcontentr" in final_url.lower()):
            logger.warning(
                "Detected stuck-on-search after nav (title=%r) — retrying via "
                "staging-based form POST to EditU (re-push workaround)",
                page_title,
            )
            # Fetch staging row to build form data with all required keys
            try:
                staging = await self._fetch_staging_row(rfq_number)
                logger.info(
                    "Staging row for QT %s: reqNo=%s reqSeq=%s secureKey=%s...",
                    rfq_number, staging.get("reqNo"), staging.get("reqSeq"),
                    str(staging.get("secureKey", ""))[:20],
                )
            except Exception as exc:
                logger.warning("Staging fetch failed: %s", exc)
                staging = None
            if staging:
                retry_ok = await self._page.evaluate(
                    """(s) => {
                        try {
                            // Create fresh form (existing submitContentForm
                            // was consumed by previous nav call)
                            const form = document.createElement('form');
                            form.method = 'post';
                            form.action = '/bqms/eprPotal/quot/qtSQuotEditUVendor.do';
                            form.style.display = 'none';
                            const add = (name, val) => {
                                const i = document.createElement('input');
                                i.type = 'hidden';
                                i.name = name;
                                i.value = val == null ? '' : String(val);
                                form.appendChild(i);
                            };
                            add('reqNo', s.reqNo);
                            add('reqSeq', s.reqSeq);
                            add('ctrChangeSeq', s.ctrChangeSeq || '');
                            add('valutSeq', s.valutSeq || '');
                            add('rndSysCode', s.rndSysCode || '');
                            add('secureKey', s.secureKey);
                            add('secureKeyBid', s.secureKeyBid || '');
                            add('eprCode', s.eprCode || '');
                            add('eprNo', s.eprNo || '');
                            // Common Samsung menuId for Bidding Quotation Submit
                            add('_menuId', 'AZib43qsAJIV-QNs');
                            add('_menuF', 'true');
                            document.body.appendChild(form);
                            form.submit();
                            return {ok: true, action: form.action};
                        } catch (e) {
                            return {ok: false, why: String(e).slice(0,300)};
                        }
                    }""",
                    staging,
                )
                logger.info("Staging-form POST retry: %s", retry_ok)
                if retry_ok.get("ok"):
                    await asyncio.sleep(8)
                    try:
                        await self._page.wait_for_load_state("networkidle", timeout=15_000)
                    except Exception:
                        pass
                    final_url = self._page.url
                    new_title = ""
                    try:
                        new_title = await self._page.title()
                    except Exception:
                        pass
                    logger.info(
                        "After staging-form POST: url=%s title=%s",
                        final_url, new_title,
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

        Thang 2026-05-22: CRITICAL bug — search trước đây pick frame ĐẦU
        TIÊN có "Edit" button. Samsung embed anonymous login iframe ở footer
        (vendorLogin.do?_frameF=true) — frame này có cả "Edit" button trong
        leftover HTML từ login page. Pusher pick login frame → click thành
        công nhưng self._edit_frame = login frame → mọi op tiếp theo (find
        item row, fill grid, save) đều fail vì frame login KHÔNG có item table.
        Fix: SKIP frame URL chứa 'anonymous', 'login', '/vendorLogin'.
        """
        # Reset stale frame from previous push first
        self._edit_frame = None

        await self._dismiss_popups()
        # Wait detail content settle
        await asyncio.sleep(3)

        # Take pre-click screenshot for debug
        try:
            await self._page.screenshot(path="/tmp/before_edit.png", full_page=True)
        except Exception:
            pass

        # Thang 2026-05-22: after `Save Temporarily`, Samsung's View page shows
        # "Modify" button instead of "Edit" (QT is in draft-submitted state).
        # Accept both Edit + Modify (+ Korean 수정) as the "enter edit mode" trigger.
        selectors = [
            'button:has-text("Edit"):not([disabled])',
            'a:has-text("Edit")',
            'input[type="button"][value="Edit"]',
            'input[type="submit"][value="Edit"]',
            # Modify variants — appear after saved_temp
            'button:has-text("Modify"):not([disabled])',
            'a:has-text("Modify")',
            'input[type="button"][value="Modify"]',
            'input[type="submit"][value="Modify"]',
            'button.btnEdit, button.btnModify',
            'a.btnEdit, a.btnModify',
            'button:text-is("Edit")',
            'a:text-is("Edit")',
            'button:text-is("Modify")',
            'a:text-is("Modify")',
            # Korean
            'button:has-text("수정")',
            'a:has-text("수정")',
            # Samsung pattern — onclick contains "edit" or "modify" or edit functions
            'button[onclick*="edit" i]',
            'a[onclick*="edit" i]',
            'button[onclick*="modify" i]',
            'a[onclick*="modify" i]',
        ]

        def _is_login_frame(url: str) -> bool:
            """Filter out Samsung's auth iframe — it CAN contain stale Edit
            buttons but it's NOT the QT detail content frame."""
            u = (url or "").lower()
            return ("anonymous" in u
                    or "vendorlogin" in u
                    or "/login" in u)

        # Search across all frames — main first, then NON-AUTH children
        frames = []
        try:
            all_frames = list(self._page.frames)
        except Exception:
            all_frames = [self._page.main_frame]
        # Reorder: main first, then non-login frames, then login frames LAST
        main = self._page.main_frame
        non_login = [f for f in all_frames if f is not main and not _is_login_frame(f.url)]
        login_only = [f for f in all_frames if f is not main and _is_login_frame(f.url)]
        frames = [main] + non_login + login_only

        for frame in frames:
            # Skip auth/login frames unless they're the only option left
            if _is_login_frame(frame.url) and frame is not main:
                logger.info("Skipping auth frame for Edit click: %s", frame.url[:100])
                continue
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

        # Last resort: eval JS to find Edit button by text — skip auth frames
        for frame in frames:
            if _is_login_frame(frame.url) and frame is not main:
                continue
            try:
                clicked = await frame.evaluate(
                    """() => {
                        const targets = ['edit', 'modify', '수정'];
                        const all = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
                        for (const el of all) {
                            const t = (el.textContent || el.value || '').trim();
                            const tl = t.toLowerCase();
                            if (targets.includes(tl) || targets.includes(t)) {
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

        # Diagnostic: capture page state + screenshot when no Edit/Modify found
        deadline_passed = False
        try:
            from datetime import datetime as _dt
            ts = _dt.now().strftime("%Y%m%d_%H%M%S")
            shot_path = f"/data/bqms-push-evidence/_no_edit_btn_{ts}.png"
            await self._page.screenshot(path=shot_path, full_page=True)
            page_title = await self._page.title()
            # Check for "Submission deadline has passed" — Samsung blocks edit
            # after deadline. This is a USER issue, not a code bug.
            deadline_passed = await self._page.evaluate(
                """() => {
                    const body = (document.body && document.body.textContent || '').toLowerCase();
                    return body.includes('submission deadline has passed')
                        || body.includes('deadline has passed')
                        || body.includes('hạn nộp đã qua')
                        || body.includes('hết hạn nộp');
                }"""
            )
            # List ALL buttons/links visible to give clue about what page shows
            visible_btns = await self._page.evaluate(
                """() => {
                    const out = [];
                    for (const el of document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')) {
                        const t = (el.textContent || el.value || '').trim();
                        const r = el.getBoundingClientRect();
                        if (t && r.width > 0 && r.height > 0) {
                            out.push(t.slice(0, 40));
                            if (out.length >= 20) break;
                        }
                    }
                    return out;
                }"""
            )
            logger.error(
                "Edit button not found. URL=%s, Title=%s, deadline_passed=%s, "
                "Visible buttons=%s, Screenshot=%s",
                self._page.url, page_title, deadline_passed, visible_btns, shot_path,
            )
        except Exception as exc:
            logger.warning("Diagnostic capture failed: %s", exc)

        # User-friendly error message based on detected state
        if deadline_passed:
            raise RuntimeError(
                "Hạn nộp báo giá của QT đã qua (Samsung hiển thị 'Submission "
                "deadline has passed') → không thể edit nữa. Liên hệ Samsung "
                "purchaser nếu cần extend deadline, hoặc QT này đã closed."
            )
        raise RuntimeError(
            "Không tìm thấy nút Edit/Modify trong main page và non-auth iframes "
            "(QT có thể đang ở trạng thái không cho edit — check screenshot evidence)"
        )

    def _scope(self):
        """Return frame để dùng cho operation sau Edit. Fallback main page."""
        return self._edit_frame or self._page

    # ─── Step C: Fill 1 item ──────────────────────────────────

    async def _fill_one_item(self, item: dict[str, Any], round_n: int = 1):
        """Per row trong table Quotation amount.

        Round 1: upload image → fill price/lead → set FREE_CHARGE='N' (+SUBMIT_GIVEUP if Y).
        Round 2/3/4: SKIP image upload (Samsung reuses V1 image) + SKIP FREE_CHARGE +
                     SKIP SUBMIT_GIVEUP (preserve Samsung default per Thang 2026-05-15).
                     ONLY fill price + lead_time.

        Thang 2026-05-22:
        - SKIP image upload entirely khi abandonment='Y' (mã không báo giá →
          không cần ảnh sản phẩm)
        - IDEMPOTENT mode: trước khi set value, đọc current Samsung value.
          Nếu Samsung đã có giá trị hợp lệ (price > 0, lead > 0) → skip set
          để re-push lần thứ N chỉ bổ sung field thiếu.
        """
        code = item["bqms_code"]
        scope = self._scope()
        # Normalize abandonment flag (Y/N) — drives "không báo giá" skip logic
        abandoned = (item.get("abandonment") or "N").strip().upper() == "Y"

        # Thang 2026-06-03: log when we push placeholder=0 for "không báo giá"
        # items (was 1; Samsung sums line price into grand total even when
        # SUBMIT_GIVEUP='Y' so placeholder must be 0 to avoid inflating totals).
        if abandoned and (not item.get("quotation_price") or int(item.get("quotation_price") or 0) <= 0):
            logger.info(
                "BQMS push: bqms_code=%s status=khongbaogia -> price=0 (was defaulting to 1)",
                code,
            )

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

        # ── C2. Upload image (round 1 only, non-abandoned) ──
        # Skip conditions (in priority order):
        #   1. round_n != 1 → Samsung tự reuse V1 image cho V2/V3/V4
        #   2. abandonment='Y' → mã không báo giá, không cần ảnh
        #   3. (not re-push) AND Samsung row đã có IMG_FILE_NM → idempotent skip
        # Re-push mode (Thang 2026-05-22): ALWAYS upload mới, bỏ qua idempotent
        # vì user click "Đẩy lên SEC" lần 2 sau saved_temp = ý đồ thay ảnh.
        is_repush = getattr(self, "_is_repush", False)
        if round_n != 1:
            logger.info(
                "Skip image upload for %s (round=%d, Samsung reuses V1 image)",
                code, round_n,
            )
        elif abandoned:
            # User-spec (2026-05-22): mã abandonment='Y' (không báo giá) →
            # KHÔNG đẩy ảnh lên Samsung. Tránh polluting form với ảnh không
            # cần cho item bị bỏ qua.
            logger.info("Skip image upload for %s (abandonment=Y, không báo giá)", code)
        elif is_repush:
            # Re-push override: always replace existing image
            logger.info(
                "RE-PUSH override for %s — bypassing idempotent skip, uploading new image",
                code,
            )
            await self._upload_item_image(row, code, item["image_path"])
        else:
            # Idempotent probe: check if Samsung grid row already has an image
            # filename. If yes (re-push case), skip the upload to save ~30s.
            #
            # FIX (Thang 2026-05-22): chỉ match cột FILE_NM/FILE_PATH thật chứa
            # tên ảnh, KHÔNG match `CIS_CODE` (item identifier, luôn non-empty
            # → trước đây gây false positive → skip upload sai trên FIRST push
            # khi Samsung chưa có ảnh).
            try:
                has_img = await scope.evaluate(
                    """(target) => {
                        if (typeof itemGridBox === 'undefined') return false;
                        const g = itemGridBox;
                        const numRows = g.getRowsNum();
                        const numCols = (g.getColumnsNum && g.getColumnsNum()) || 30;
                        // Thang 2026-06-19: adaptive code col detection.
                        // V2 page uses ITEM_ID (col 20), V1 uses col 15. Scan.
                        let bqmsColIdx = -1;
                        for (let c = 0; c < numCols; c++) {
                            if ((g.getColumnId(c) || '').toUpperCase() === 'ITEM_ID') {
                                bqmsColIdx = c; break;
                            }
                        }
                        if (bqmsColIdx === -1) {
                            const codeRe = /^(ITEM_ID|BQMS.*CODE|ITEM.*CODE|CIS.*CODE)$/i;
                            for (let c = 0; c < numCols; c++) {
                                if (codeRe.test(g.getColumnId(c) || '')) { bqmsColIdx = c; break; }
                            }
                        }
                        if (bqmsColIdx === -1) bqmsColIdx = 15;
                        let rowId = null;
                        for (let i = 0; i < numRows; i++) {
                            try {
                                if (g.cells2(i, bqmsColIdx).getValue() === target) {
                                    rowId = g.getRowId(i); break;
                                }
                            } catch(e) {}
                        }
                        if (!rowId) return false;
                        // STRICT image-column matcher — must look like an image
                        // FILENAME / FILE_NM / FILE_PATH column, AND value must
                        // look like an image filename (ends with .png/.jpg/.jpeg/etc).
                        // Excludes CIS_CODE / ITEM_CODE etc. which are identifiers,
                        // not image data.
                        const imageColRe = /(^|_)(IMG|IMAGE|CIS_IMG|ITEM_IMG)_?(FILE|FILE_NM|FILE_PATH|NM|PATH|URL)?$/i;
                        const imageValRe = /\\.(png|jpg|jpeg|gif|bmp|webp)$/i;
                        for (let i = 0; i < numCols; i++) {
                            const cid = (g.getColumnId(i) || '').toUpperCase();
                            // Require both column-id pattern + value looks like image filename
                            const looksImageCol = imageColRe.test(cid);
                            // Quick exclusion: never match these even by accident
                            if (cid.endsWith('_CODE') || cid === 'CIS_CODE' || cid === 'ITEM_CODE') continue;
                            if (!looksImageCol) continue;
                            try {
                                const v = g.getCellValueById(g.getColumnId(i), rowId);
                                const s = (v == null) ? '' : String(v).trim();
                                if (s && imageValRe.test(s)) {
                                    return {colId: g.getColumnId(i), value: s.slice(0,80)};
                                }
                            } catch(e) {}
                        }
                        return false;
                    }""",
                    code,
                )
            except Exception as exc:
                logger.warning("Image-existence probe failed (%s) — defaulting to upload", exc)
                has_img = False

            if has_img:
                logger.info(
                    "Skip image upload for %s (idempotent: Samsung already has %s)",
                    code, has_img,
                )
            else:
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
                const numRows = g.getRowsNum();
                // numCols defined later in this function for price-col scan,
                // reuse via outer-scope `var` to avoid duplicate declaration.
                var numCols = g.getColumnsNum();

                // Thang 2026-06-19: ADAPTIVE bqms_code column discovery.
                // V1 page: col 15 = BQMS code. V2 page: col index may differ.
                // Strategy: scan ALL columns to find one matching the target
                // code value. If exact match found → that's the code column.
                // If multiple columns match, prefer one whose column-id
                // contains CODE/ITEM/CIS.
                //
                // Also dump debug info so we can diagnose if 0 rows found.
                let rowId = null;
                let bqmsColIdx = -1;
                const colIds = [];
                const sampleRow = [];
                for (let c = 0; c < numCols; c++) {
                    try { colIds.push(g.getColumnId(c) || ''); } catch(e) { colIds.push('?'); }
                }
                // Sample first row across all columns for diagnostics
                if (numRows > 0) {
                    for (let c = 0; c < numCols; c++) {
                        try {
                            const v = g.cells2(0, c).getValue();
                            sampleRow.push((v == null ? '' : String(v)).slice(0, 40));
                        } catch(e) { sampleRow.push('ERR'); }
                    }
                }
                // Strategy 1: priority try columns whose ID looks like a code col.
                // Thang 2026-06-19: V2 page exposes BQMS code as ITEM_ID (col 20),
                // V1 page exposes it via different cell layout. Match both.
                // Prefer ITEM_ID first since that's the Samsung-internal canonical
                // identifier. CIS_CODE on V2 holds a different value (Q240-XXX).
                const codeColCandidates = [];
                const codeIdRe = /^(ITEM_ID|BQMS.*CODE|ITEM.*CODE|CIS.*CODE)$/i;
                // Priority order: ITEM_ID first, then code variants
                const priorityIds = ['ITEM_ID', 'BQMS_CODE', 'ITEM_CODE'];
                for (const pid of priorityIds) {
                    for (let c = 0; c < numCols; c++) {
                        if ((colIds[c] || '').toUpperCase() === pid) {
                            codeColCandidates.push(c);
                        }
                    }
                }
                // Then add other CODE-ish columns
                for (let c = 0; c < numCols; c++) {
                    if (codeColCandidates.includes(c)) continue;
                    if (codeIdRe.test(colIds[c])) codeColCandidates.push(c);
                }
                // Fallback: scan every column
                if (codeColCandidates.length === 0) {
                    for (let c = 0; c < numCols; c++) codeColCandidates.push(c);
                }
                for (const c of codeColCandidates) {
                    for (let i = 0; i < numRows; i++) {
                        try {
                            const v = g.cells2(i, c).getValue();
                            if (v === args.code) {
                                rowId = g.getRowId(i);
                                bqmsColIdx = c;
                                break;
                            }
                        } catch(e) {}
                    }
                    if (rowId) break;
                }
                if (!rowId) {
                    return {
                        ok: false,
                        why: 'row not found for code',
                        code: args.code,
                        debug: {
                            numRows,
                            numCols,
                            colIds,
                            sampleRow,
                            candidateCols: codeColCandidates,
                        },
                    };
                }

                // Auto-discover price column id.
                // Thang 2026-06-19: V2 grid has 4 price-like cols:
                //   FIR_SUBMISSION_UNIT_PRICE   (V1 first quote — historical, read-only)
                //   BEFORE_SUBMISSION_UNIT_PRICE (prev round — historical)
                //   SUBMISSION_UNIT_PRICE        (current round target — WRITE HERE)
                //   SUBMISSION_AMOUNT            (total = unit_price × qty)
                // Old logic took FIR_SUBMISSION_UNIT_PRICE because it matches
                // /PRICE/ first → V2 price landed in V1 historical column.
                // Fix: PRIORITY MATCH `SUBMISSION_UNIT_PRICE` exactly first,
                // then fall back to other price-like cols. Exclude FIR_/BEFORE_
                // prefix so historical cols never get picked.
                let priceColId = null;
                // numCols already declared at function top with var.
                const labelOf = (i) => {
                    if (g.getColumnLabel) return (g.getColumnLabel(i) || '').replace(/<[^>]+>/g,'');
                    return '';
                };
                // Strategy A: exact id match for the canonical current-round col
                for (let i = 0; i < numCols; i++) {
                    const cid = (g.getColumnId(i) || '').toUpperCase();
                    if (cid === 'SUBMISSION_UNIT_PRICE' || cid === 'QUOT_AMT'
                        || cid === 'QUOTATION_PRICE') {
                        priceColId = g.getColumnId(i);
                        break;
                    }
                }
                // Strategy B: fuzzy match, BUT skip historical FIR_/BEFORE_ cols
                if (!priceColId) {
                    for (let i = 0; i < numCols; i++) {
                        const cid = (g.getColumnId(i) || '').toUpperCase();
                        const lbl = labelOf(i).toLowerCase();
                        if (cid.startsWith('FIR_') || cid.startsWith('BEFORE_')) continue;
                        if (cid.includes('PRICE') || cid.includes('AMOUNT') || cid.includes('QUOT_AMT')
                            || lbl.includes('quotation price')) {
                            priceColId = g.getColumnId(i);
                            break;
                        }
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
                //
                // IDEMPOTENT mode (Thang 2026-05-22): if Samsung already has a
                // non-empty value AND it matches what we'd push, skip the set.
                // For numeric fields (price, lead), "has value" = parseFloat > 0.
                // For string fields (FREE_CHARGE, SUBMIT_GIVEUP), "has value"
                // = non-empty string. Re-push lần thứ N chỉ bổ sung field thiếu.
                //
                // OVERRIDE mode (Thang 2026-05-22): if args.is_repush=true,
                // disable idempotent — ALWAYS write user's new value to replace
                // Samsung's stored value. Triggered when previous push was
                // saved_temp + user pushes again (intent: thay đổi data).
                const out = { ok: true, rowId: rowId, priceColId: priceColId, sets: {} };
                const setCell = (colId, value, opts) => {
                    opts = opts || {};
                    // Re-push: force overwrite, disable idempotent check
                    if (args.is_repush) {
                        opts = Object.assign({}, opts, {idempotent: false});
                    }
                    const before = g.getCellValueById(colId, rowId);
                    // Idempotent: skip if Samsung already has the same value or
                    // a "valid" non-empty value (for numeric, > 0)
                    if (opts.idempotent) {
                        if (opts.numeric) {
                            const beforeNum = parseFloat(before);
                            const valueNum = parseFloat(value);
                            if (!isNaN(beforeNum) && beforeNum > 0) {
                                // Samsung has a positive number; if user's value differs we still push.
                                // If user passes 0 (placeholder), skip to preserve Samsung's value.
                                if (valueNum === 0 || valueNum === beforeNum) {
                                    return {method: 'idempotent_skip', ok: true, value: before, kept: true};
                                }
                            }
                        } else {
                            if (before != null && String(before).trim() !== '') {
                                if (String(before) === String(value)) {
                                    return {method: 'idempotent_skip', ok: true, value: before, kept: true};
                                }
                            }
                        }
                    }
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
                // For abandoned items (SUBMIT_GIVEUP='Y'), Samsung's saveDcu()
                // STILL validates "Submitted Unit Price is mandatory" — won't
                // accept empty price. Thang 2026-06-03: placeholder=0 (was 1)
                // because Samsung's grand total SUMS the line price even when
                // SUBMIT_GIVEUP='Y' — "không báo giá" items must contribute 0
                // to the total, not 1.
                const effectivePrice = (args.abandonment === 'Y' && (!args.price || args.price <= 0))
                    ? 0
                    : args.price;
                out.sets.price = setCell(priceColId, effectivePrice, {idempotent: true, numeric: true});
                out.sets.lead = setCell('LEAD_TIME', args.lead, {idempotent: true, numeric: true});
                // Round 1: always write FREE_CHARGE + SUBMIT_GIVEUP.
                // Round 2-4: skip BY DEFAULT (preserve Samsung values from V1).
                // Round 2-4 RE-PUSH (Thang 2026-06-19): if user changed abandon
                // status between rounds (e.g., V1 báo 2/6 mã → V2 muốn báo 5/6
                // mã, 3 mã đổi abandon Y→N), MUST flip SUBMIT_GIVEUP/FREE_CHARGE
                // to match new state. Without this, Samsung keeps SUBMIT_GIVEUP='Y'
                // from V1 → 3 mã mới remain abandoned on Samsung side.
                // Bypass idempotent for both fields so the write goes through.
                const shouldWriteFlags = (args.round_n === 1) || args.is_repush;
                const isAbandoned = (args.abandonment === 'Y');
                if (shouldWriteFlags) {
                    // FREE_CHARGE = 'N' always (Samsung default for paid quote)
                    out.sets.free_charge = setCell(
                        'FREE_CHARGE', 'N',
                        {idempotent: !args.is_repush}
                    );
                    // SUBMIT_GIVEUP: 'Y' khi abandon, 'N' khi báo giá.
                    // Quan trọng: V2+ re-push phải gửi cả 'N' để FLIP từ 'Y'
                    // (mã trước abandon, giờ user báo giá lại). V1 logic cũ
                    // chỉ set 'Y' khi abandon → never un-flip.
                    out.sets.giveup = setCell(
                        'SUBMIT_GIVEUP', isAbandoned ? 'Y' : 'N',
                        {idempotent: !args.is_repush}
                    );
                } else {
                    out.skipped_for_round = ['FREE_CHARGE', 'SUBMIT_GIVEUP'];
                }
                return out;
            }""",
            {
                "code": code,
                "price": int(item["quotation_price"]),
                "lead": int(item.get("lead_time_days", 30)),
                "abandonment": item.get("abandonment", "N"),
                "round_n": round_n,
                "is_repush": getattr(self, "_is_repush", False),
            },
        )
        logger.info("Grid model set for %s: %s", code, grid_result)
        if not grid_result.get("ok"):
            # Thang 2026-06-19: surface debug info into error message so log
            # captures IBSheet state (numRows, colIds, first-row values) for
            # diagnosis when V2 page layout differs from V1.
            debug = grid_result.get("debug", {})
            debug_summary = ""
            if debug:
                debug_summary = (
                    f" | numRows={debug.get('numRows')} "
                    f"numCols={debug.get('numCols')} "
                    f"colIds={debug.get('colIds', [])[:30]} "
                    f"sampleRow0={debug.get('sampleRow', [])[:30]}"
                )
                logger.error("Grid debug: %s", debug)
            raise RuntimeError(
                f"Failed to write to grid model for {code}: "
                f"{grid_result.get('why')}{debug_summary}"
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

    @staticmethod
    def _prepare_upload_filename(src_path: str, bqms_code: str) -> str:
        """Copy image to /tmp with filename = `{bqms_code}.{ext}` (Thang 2026-05-22).

        Samsung lưu image với tên file y nguyên `set_input_files()` gửi lên.
        Trước đây ta upload nguyên cache file (vd `cropped_1779424729_9b20d5e9.png`)
        → Samsung hiển thị random hash → khó nhận diện. Fix: copy bytes sang
        `/tmp/bqms_upload_{bqms_code}.{ext}` rồi upload từ đó.

        Returns: absolute path of the renamed file.
        Falls back to original path nếu copy fail (log warning).
        """
        import shutil, re
        try:
            src = Path(src_path)
            if not src.exists():
                return src_path
            # Sanitize bqms code: keep alphanum + dash + underscore only
            safe_code = re.sub(r"[^A-Za-z0-9_\-]", "_", (bqms_code or "unknown").strip())
            ext = src.suffix.lower() or ".png"  # fallback .png if no extension
            # Whitelist allowed image extensions
            if ext not in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"):
                ext = ".png"
            dst = Path("/tmp") / f"{safe_code}{ext}"
            # Re-copy each push so stale renamed files don't persist between pushes
            shutil.copy2(str(src), str(dst))
            logger.info(
                "Renamed upload file: %s → %s",
                src.name, dst.name,
            )
            return str(dst)
        except Exception as exc:
            logger.warning(
                "Failed to rename upload file %s (%s) — using original path",
                src_path, exc,
            )
            return src_path

    async def _upload_item_image(self, row, code: str, image_path: str):
        """Upload image cho 1 item qua Samsung's flow.

        Discovery (Thang 2026-05-15 inspect script):
        - Items table render bằng dhtmlxGrid với global var `itemGridBox`
        - Method gọi popup: `imageViewerOpen()` đọc selected row + open new window
          tới `/bqms/mro/common/CropImage/openViewer.do?itemCode=X&reqNo=Y&...`
        - Popup window mới chứa Edit button → mở Item Image Uploader
        - Uploader có `<input type="file">` để set_input_files()

        Thang 2026-05-22: rename uploaded file to `{bqms_code}.{ext}` BEFORE
        set_input_files so Samsung lưu tên có nghĩa thay vì random hash.
        """
        if not Path(image_path).exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        # Copy file → /tmp/{bqms_code}.{ext} for clean filename on Samsung
        upload_path = self._prepare_upload_filename(image_path, code)

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
        # Thang 2026-05-22: locate scope where imageViewerOpen is defined.
        # Poll all frames for up to 8s — Samsung's JS bundle may load async.
        # Also dump frame inventory + window function names for diagnostic.
        invoke_scope = None
        for poll_attempt in range(8):
            for fr in [self._page.main_frame] + list(self._page.frames):
                fu = (fr.url or "").lower()
                if "vendorlogin" in fu or "anonymous" in fu:
                    continue
                try:
                    if await fr.evaluate("typeof imageViewerOpen === 'function'"):
                        invoke_scope = fr
                        logger.info(
                            "imageViewerOpen located in frame (poll=%ds): %s",
                            poll_attempt, (fr.url or "main")[:100],
                        )
                        break
                except Exception:
                    continue
            if invoke_scope is not None:
                break
            await asyncio.sleep(1)

        if invoke_scope is None:
            # Likely Samsung is still on ContentR view (Edit click no-op'd due
            # to deadline-passed silently). Check for deadline message before
            # raising generic error.
            try:
                deadline_msg = await self._page.evaluate(
                    """() => {
                        const body = (document.body && document.body.textContent || '').toLowerCase();
                        return body.includes('submission deadline has passed')
                            || body.includes('deadline has passed')
                            || body.includes('hạn nộp đã qua')
                            || body.includes('hết hạn nộp');
                    }"""
                )
            except Exception:
                deadline_msg = False
            # Also check frame URLs — if still on ContentR (not EditU), Edit
            # click silently failed (likely deadline passed or Samsung-blocked)
            still_on_content = any(
                "qtsquotcontentr" in (f.url or "").lower()
                for f in self._page.frames
            )
            # Diagnostic dump
            frame_info = []
            for fr in [self._page.main_frame] + list(self._page.frames):
                try:
                    fns = await fr.evaluate(
                        """() => {
                            const out = [];
                            for (const k in window) {
                                try {
                                    if (typeof window[k] === 'function'
                                        && /image|viewer|crop|popup/i.test(k)) {
                                        out.push(k);
                                    }
                                } catch(e) {}
                                if (out.length >= 12) break;
                            }
                            return out;
                        }"""
                    )
                except Exception:
                    fns = []
                frame_info.append({
                    "url": (fr.url or "main")[:100],
                    "img_fns": fns,
                })
            logger.error(
                "imageViewerOpen not found. deadline_msg=%s, still_on_content=%s, "
                "Frame inventory: %s",
                deadline_msg, still_on_content, frame_info,
            )
            if deadline_msg or still_on_content:
                raise RuntimeError(
                    "Không thể edit QT — hạn nộp báo giá đã qua. Samsung từ "
                    "chối chuyển qua Edit mode (Edit click no-op). Liên hệ "
                    "Samsung purchaser để extend deadline, hoặc QT đã closed."
                )
            raise RuntimeError(
                "imageViewerOpen() không có trong scope của bất kỳ frame nào — "
                "Samsung's Image Viewer JS chưa load. Có thể QT này dùng "
                "image-upload flow khác (kiểm tra log Frame inventory)."
            )

        async with self._context.expect_page(timeout=15_000) as new_page_info:
            await invoke_scope.evaluate("imageViewerOpen()")
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

        await file_input.set_input_files(upload_path)
        await asyncio.sleep(3)
        logger.info(
            "set_input_files done for %s: %s (renamed from %s)",
            code, Path(upload_path).name, Path(image_path).name,
        )

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

    async def _clear_existing_attachments(self) -> dict:
        """Xóa toàn bộ file đính kèm cũ trong DextUpload5 widget (re-push mode).

        Thang 2026-05-22: khi user push lần 2 sau saved_temp, file cũ đã có
        trên Samsung. Nếu chỉ inject file mới thì widget sẽ ADD vào list →
        Samsung lưu cả 2 file → trùng lặp + sai version. Phải clear trước.

        Strategy (multi-attempt, all silent failures fine — clear là best-effort):
        1. Tìm global DEXTX5_* instance objects + call .RemoveAll() / .Clear()
        2. Tìm SDK helper functions: dx5RemoveAllFiles, Dext5RemoveAll, v.v.
        3. Trong main-grid frame: select all rows + click Delete button
        4. Fallback: dispatch click event lên row checkboxes + Delete button

        Returns: dict with diagnostic info about what worked.
        """
        out = {"strategies_tried": [], "rows_removed": 0, "errors": []}

        # ── Strategy A: probe global DEXTX5_* instance objects in MAIN frame ──
        try:
            main_result = await self._page.evaluate(
                """() => {
                    const out = {found_instances: [], removeAll_called: []};
                    // Scan window for DEXTX5_* globals (instance objects)
                    for (const key in window) {
                        if (!key.startsWith('DEXTX5_')) continue;
                        const obj = window[key];
                        if (!obj || typeof obj !== 'object') continue;
                        out.found_instances.push(key);
                        // Try known removal methods
                        for (const meth of ['RemoveAll', 'removeAll', 'Clear', 'clear',
                                            'RemoveAllFiles', 'removeAllFiles',
                                            'DeleteAll', 'deleteAll']) {
                            if (typeof obj[meth] === 'function') {
                                try {
                                    obj[meth]();
                                    out.removeAll_called.push(`${key}.${meth}()`);
                                    break;
                                } catch (e) {
                                    out.errors = out.errors || [];
                                    out.errors.push(`${key}.${meth}: ${String(e).slice(0,80)}`);
                                }
                            }
                        }
                    }
                    return out;
                }"""
            )
            out["strategies_tried"].append({"strategy": "main_DEXTX5_globals", "result": main_result})
            if main_result.get("removeAll_called"):
                logger.info("Re-push clear: called %s",
                            main_result["removeAll_called"])
        except Exception as exc:
            out["errors"].append(f"strategy_A: {str(exc)[:150]}")

        # ── Strategy B: probe DextUpload5 instances inside ALL frames ──
        # Each DEXTX5 widget has 6 sub-frames (icons + main-grid + main-list);
        # the instance object may be in any of them.
        for frame in self._page.frames:
            u = (frame.url or "").lower()
            # Skip auth/login frames; targets are dextuploadx5 SDK frames
            if "vendorlogin" in u or "anonymous" in u:
                continue
            try:
                fr_result = await frame.evaluate(
                    """() => {
                        const out = {found: [], called: []};
                        // Look for any object with removeAll-style method that mentions File
                        for (const key in window) {
                            const v = window[key];
                            if (!v || typeof v !== 'object') continue;
                            // Heuristic: dextupload SDK instance has properties like
                            // getFileList / removeFile / addFile
                            const hints = ['getFileList', 'removeFile', 'addFile',
                                          'getFileCount', 'RemoveAll', 'clearFiles'];
                            const hasHint = hints.some(h => typeof v[h] === 'function');
                            if (!hasHint) continue;
                            out.found.push(key);
                            // Try removal methods
                            for (const meth of ['RemoveAll', 'removeAll', 'clearFiles',
                                               'ClearAll', 'clearAll',
                                               'RemoveAllFiles', 'removeAllFiles']) {
                                if (typeof v[meth] === 'function') {
                                    try {
                                        v[meth]();
                                        out.called.push(`${key}.${meth}()`);
                                        break;
                                    } catch (e) {
                                        out.errors = out.errors || [];
                                        out.errors.push(`${key}.${meth}: ${String(e).slice(0,80)}`);
                                    }
                                }
                            }
                        }
                        return out;
                    }"""
                )
                if fr_result.get("called"):
                    logger.info(
                        "Re-push clear via frame %s: %s",
                        u[-60:], fr_result["called"],
                    )
                    out["strategies_tried"].append({
                        "strategy": "frame_dx5_instance",
                        "frame": u[-60:], "result": fr_result,
                    })
            except Exception:
                continue

        # ── Strategy C: select all rows + click Delete in toolbar frame ──
        # Find the frame containing both file rows + Delete button.
        try:
            for frame in self._page.frames:
                u = (frame.url or "").lower()
                if "vendorlogin" in u or "anonymous" in u:
                    continue
                try:
                    has_toolbar = await frame.evaluate(
                        """() => {
                            const t = (document.body && document.body.textContent) || '';
                            return t.includes('Delete') && t.includes('Add')
                                && (t.includes('Upper') || t.includes('Move'));
                        }"""
                    )
                except Exception:
                    has_toolbar = False
                if not has_toolbar:
                    continue
                # Select all + click Delete in this frame
                try:
                    res_c = await frame.evaluate(
                        """() => {
                            const out = {checked: 0, clicked: false};
                            // Find file row checkboxes (DextUpload5 grid renders <input type=checkbox>
                            // for row selection). Click header checkbox if present, else each row.
                            const headerCb = document.querySelector('thead input[type="checkbox"], .grid-header input[type="checkbox"]');
                            if (headerCb && !headerCb.checked) {
                                headerCb.click();
                                out.checked = 1;
                            } else {
                                const rowCbs = document.querySelectorAll('tbody input[type="checkbox"], tr input[type="checkbox"]');
                                for (const cb of rowCbs) {
                                    if (!cb.checked) { cb.click(); out.checked++; }
                                }
                            }
                            // Then click Delete button
                            const all = document.querySelectorAll('button, a, input[type="button"]');
                            for (const el of all) {
                                const t = (el.textContent || el.value || '').trim().toLowerCase();
                                if (t === 'delete') {
                                    el.click();
                                    out.clicked = true;
                                    out.clicked_text = el.tagName + ':' + (el.textContent || el.value || '');
                                    break;
                                }
                            }
                            return out;
                        }"""
                    )
                    if res_c.get("clicked"):
                        logger.info(
                            "Re-push clear via Delete button (frame %s): %s",
                            u[-60:], res_c,
                        )
                        out["rows_removed"] = int(res_c.get("checked", 0))
                        out["strategies_tried"].append({
                            "strategy": "delete_button_click",
                            "result": res_c,
                        })
                        break
                except Exception as exc:
                    out["errors"].append(f"strategy_C: {str(exc)[:120]}")
                    continue
        except Exception as exc:
            out["errors"].append(f"strategy_C_outer: {str(exc)[:120]}")

        # Brief wait for SDK to process removal before subsequent upload
        await asyncio.sleep(2)
        logger.info("Re-push: clear_existing_attachments done — %s", out)
        return out

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

        Thang 2026-05-22: re-push mode → xóa toàn bộ file đính kèm cũ trước
        khi upload mới (tránh duplicate khi user đẩy hồ sơ V1 lần 2).
        """
        scope = self._scope()
        existing = [p for p in paths if Path(p).exists()]
        if not existing:
            logger.warning("No valid attachment paths — skipping")
            return

        # ── Re-push: clear existing files in DextUpload5 trước khi upload mới ──
        # Without this, the new PDF appears as SECOND file → Samsung saves both
        # → confusion + invalid quote attachments.
        is_repush = getattr(self, "_is_repush", False)
        if is_repush:
            await self._clear_existing_attachments()

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

        # Reset validation alert tracker — only alerts fired AFTER this point
        # belong to THIS save attempt. Without reset, a stale alert from a
        # previous step (e.g. validDt change triggering early validation)
        # would mis-attribute the failure.
        self._last_validation_alert = None

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
                    """(args) => {
                        const items = args.items || [];
                        const round_n = args.round_n || 1;
                        const g = itemGridBox;
                        if (!g) return {err: 'no grid'};
                        const out = [];

                        // Thang 2026-06-19: V2 page has different col layout.
                        // Adaptive price col detection: prefer SUBMISSION_UNIT_PRICE
                        // (current round), skip FIR_/BEFORE_ historical cols.
                        let priceColId = null;
                        const numColsP = g.getColumnsNum();
                        // Strategy A: exact match canonical id
                        for (let i = 0; i < numColsP; i++) {
                            const cid = (g.getColumnId(i) || '').toUpperCase();
                            if (cid === 'SUBMISSION_UNIT_PRICE' || cid === 'QUOT_AMT'
                                || cid === 'QUOTATION_PRICE') {
                                priceColId = g.getColumnId(i); break;
                            }
                        }
                        // Strategy B: fuzzy + skip historical
                        if (!priceColId) {
                            for (let i = 0; i < numColsP; i++) {
                                const cid = (g.getColumnId(i) || '').toUpperCase();
                                if (cid.startsWith('FIR_') || cid.startsWith('BEFORE_')) continue;
                                if (cid.includes('PRICE') || cid.includes('SUBMISSION_UNIT')) {
                                    priceColId = g.getColumnId(i); break;
                                }
                            }
                        }

                        // Adaptive code col detection: V2 uses ITEM_ID at col 20.
                        // V1 uses col 15 (a different layout). Prior code hardcoded
                        // col 15 → V2 row lookup always failed → re-apply skipped
                        // → grid model values from earlier _fill_one_item got
                        // wiped by Samsung's pre-save reset → saveDcu rejected.
                        let bqmsColIdx = -1;
                        const numColsC = g.getColumnsNum();
                        // Priority: exact ITEM_ID
                        for (let c = 0; c < numColsC; c++) {
                            if ((g.getColumnId(c) || '').toUpperCase() === 'ITEM_ID') {
                                bqmsColIdx = c; break;
                            }
                        }
                        // Fallback: scan any column containing code/item/cis ID-like pattern
                        if (bqmsColIdx === -1) {
                            const codeRe = /^(ITEM_ID|BQMS.*CODE|ITEM.*CODE|CIS.*CODE)$/i;
                            for (let c = 0; c < numColsC; c++) {
                                if (codeRe.test(g.getColumnId(c) || '')) { bqmsColIdx = c; break; }
                            }
                        }
                        // Last resort: legacy col 15 (V1 layout)
                        if (bqmsColIdx === -1) bqmsColIdx = 15;

                        const numRows = g.getRowsNum();
                        for (const item of items) {
                            let rowId = null;
                            for (let i = 0; i < numRows; i++) {
                                try {
                                    if (g.cells2(i, bqmsColIdx).getValue() === item.bqms_code) {
                                        rowId = g.getRowId(i); break;
                                    }
                                } catch(e) {}
                            }
                            if (!rowId) {
                                out.push({code: item.bqms_code, err: 'row not found'});
                                continue;
                            }
                            try {
                                // For abandoned items: placeholder price=0
                                // (Thang 2026-06-03, was 1) to pass Samsung's
                                // "Submitted Unit Price is mandatory" validation
                                // WITHOUT inflating the grand total. Samsung
                                // sums the line price into totals even when
                                // SUBMIT_GIVEUP='Y', so placeholder must be 0.
                                const isAbandoned = ((item.abandonment || 'N') === 'Y');
                                // BUG FIX (Thang 2026-06-17): Samsung's grid stores a NUMERIC 0 as
                                // EMPTY (getCellValueById → ''), which then fails saveDcu's
                                // "Submitted Unit Price is mandatory" for abandoned rows — so the
                                // whole push was rejected (price + attachments never saved, only the
                                // pre-uploaded image stuck). Use the STRING '0': the cell stays
                                // non-empty AND Samsung still sums it as 0 (no grand-total inflation).
                                const effPrice = (isAbandoned && (!item.quotation_price || item.quotation_price <= 0))
                                    ? '0'
                                    : item.quotation_price;
                                g.setCellValueById(priceColId, rowId, effPrice);
                                g.setCellValueById('LEAD_TIME', rowId, item.lead_time_days || 30);
                                // Round 1: always flip flags.
                                // Round 2-4 + re-push (Thang 2026-06-19): also flip
                                // so user can change abandon state between rounds.
                                // E.g., V1 báo 2/6 mã → V2 báo 5/6 mã, 3 mã đổi
                                // Y→N. Without flip here, Samsung keeps stale 'Y'.
                                const shouldWriteFlags = (round_n === 1) || args.is_repush;
                                if (shouldWriteFlags) {
                                    g.setCellValueById('FREE_CHARGE', rowId, 'N');
                                    // Always write SUBMIT_GIVEUP — 'Y' if abandon,
                                    // 'N' if báo giá (allows un-flip from V1 'Y').
                                    g.setCellValueById('SUBMIT_GIVEUP', rowId, isAbandoned ? 'Y' : 'N');
                                }
                                out.push({
                                    code: item.bqms_code, rid: rowId,
                                    price_after: g.getCellValueById(priceColId, rowId),
                                    lead_after: g.getCellValueById('LEAD_TIME', rowId),
                                    giveup_after: g.getCellValueById('SUBMIT_GIVEUP', rowId),
                                    free_after: g.getCellValueById('FREE_CHARGE', rowId),
                                    flags_written: shouldWriteFlags,
                                });
                            } catch(e) {
                                out.push({code: item.bqms_code, err: String(e).slice(0,150)});
                            }
                        }
                        return out;
                    }""",
                    {
                        "items": payload.get("items", []),
                        "round_n": int(payload.get("round", 1)),
                        "is_repush": getattr(self, "_is_repush", False),
                    },
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
                    // CSS `[attr*="x" i]` (case-insensitive flag) is non-standard
                    // and silently fails on some browsers. Use multiple selectors
                    // + fallback to scanning all textareas for one matching "opinion"
                    // (case-insensitive via lower()) or the first VISIBLE textarea
                    // on the form.
                    let op = (
                        document.querySelector('textarea[name*="opinion"]')
                        || document.querySelector('textarea[id*="opinion"]')
                        || document.querySelector('textarea[name*="Opinion"]')
                        || document.querySelector('textarea[id*="Opinion"]')
                        || document.querySelector('textarea[placeholder*="enter it"]')
                        || document.querySelector('textarea[placeholder*="Please enter"]')
                    );
                    if (!op) {
                        // Last resort — scan ALL textareas, pick first visible one
                        // whose name/id/placeholder/aria-label hints at "opinion"
                        const allTas = document.querySelectorAll('textarea');
                        for (const t of allTas) {
                            if (!t.offsetParent) continue;  // invisible
                            const hints = (
                                (t.name || '') + '|' +
                                (t.id || '') + '|' +
                                (t.placeholder || '') + '|' +
                                (t.getAttribute('aria-label') || '')
                            ).toLowerCase();
                            if (hints.includes('opinion') || hints.includes('comment')
                                || hints.includes('remark')) {
                                op = t; break;
                            }
                        }
                    }
                    if (!op) {
                        // Final fallback — first visible textarea on the page
                        for (const t of document.querySelectorAll('textarea')) {
                            if (t.offsetParent) { op = t; break; }
                        }
                    }
                    if (op) {
                        op.value = args.opinion;
                        op.dispatchEvent(new Event('change', {bubbles: true}));
                        op.dispatchEvent(new Event('input', {bubbles: true}));
                        op.dispatchEvent(new Event('blur', {bubbles: true}));
                        if (typeof $ === 'function') $(op).val(args.opinion).trigger('change');
                        out.opinion_set = (op.value || '').slice(0, 50);
                        out.opinion_selector_hint = (op.name || op.id || op.placeholder || 'fallback').slice(0, 50);
                    } else {
                        out.opinion_err = 'textarea not found (no opinion textarea + no visible textarea)';
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
        url_changed = url_before != url_after
        logger.info(
            "Post-saveDcu: url_before=%s url_after=%s changed=%s",
            url_before[-80:], url_after[-80:],
            "YES" if url_changed else "NO",
        )

        # Thang 2026-05-22: detect silent save failure.
        # Samsung's saveDcu() validates required fields BEFORE persisting. If
        # a field is missing (e.g. "Submitted Unit Price is mandatory"), it
        # fires native alert() → our dialog handler auto-accepts → saveDcu
        # returns without persisting → URL does NOT change. Push reports
        # SUCCESS in the old code; user opens Samsung and sees fields blank.
        # NEW: if URL didn't change AND a "mandatory/required" alert fired
        # during this save, raise RuntimeError → push correctly reports
        # FAILED with Samsung's exact validation message.
        if not url_changed and self._last_validation_alert:
            err_msg = self._last_validation_alert
            self._last_validation_alert = None
            raise RuntimeError(
                f"Samsung từ chối save: '{err_msg}'. "
                f"URL không đổi sau saveDcu → form chưa được lưu. "
                f"Kiểm tra field còn thiếu (price, lead, opinion...) rồi thử lại."
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
