"""
Playwright-based Samsung BQMS session extractor.

Strategy: Use headless Chromium to perform the full login flow (including JS),
then extract authenticated cookies and inject them into httpx for API calls.
This avoids keeping a browser open for the entire sync.

SAFETY: Samsung BQMS blocks accounts after too many failed logins.
- Circuit breaker: exponential backoff (30min → 2h → 24h) after failures
- No login retry: if password wrong → stop immediately, don't try again
- Pre-check: detect CAPTCHA/block page before submitting credentials
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Circuit Breaker — prevent Samsung account lockout
# ---------------------------------------------------------------------------

_CIRCUIT_FILE = "/tmp/bqms_circuit_breaker.json"

# Backoff: 1st fail → 30 min, 2nd → 2 hours, 3rd+ → 24 hours
_BACKOFF_SECONDS = [
    30 * 60,      # 30 minutes
    2 * 60 * 60,  # 2 hours
    24 * 60 * 60, # 24 hours
]


def _load_circuit() -> dict:
    try:
        with open(_CIRCUIT_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"failures": 0, "last_failure_at": 0, "last_error": ""}


def _save_circuit(data: dict) -> None:
    with open(_CIRCUIT_FILE, "w") as f:
        json.dump(data, f)


def _record_failure(error_msg: str) -> None:
    """Ghi nhận login fail — tăng backoff."""
    circuit = _load_circuit()
    circuit["failures"] = circuit.get("failures", 0) + 1
    circuit["last_failure_at"] = time.time()
    circuit["last_error"] = error_msg[:200]
    _save_circuit(circuit)
    logger.warning(
        "BQMS circuit breaker: failure #%d recorded — %s",
        circuit["failures"], error_msg[:100],
    )


def _record_success() -> None:
    """Login thành công → reset circuit."""
    _save_circuit({"failures": 0, "last_failure_at": 0, "last_error": ""})
    logger.info("BQMS circuit breaker: reset (login success)")


def _check_circuit() -> None:
    """
    Kiểm tra circuit breaker TRƯỚC khi login.
    Raise RuntimeError nếu đang trong thời gian chờ.
    """
    circuit = _load_circuit()
    failures = circuit.get("failures", 0)
    if failures == 0:
        return  # OK

    last_fail = circuit.get("last_failure_at", 0)
    elapsed = time.time() - last_fail

    # Chọn backoff phù hợp
    idx = min(failures - 1, len(_BACKOFF_SECONDS) - 1)
    wait_seconds = _BACKOFF_SECONDS[idx]

    if elapsed < wait_seconds:
        remaining = int(wait_seconds - elapsed)
        remaining_min = remaining // 60
        raise RuntimeError(
            f"BQMS circuit breaker OPEN: {failures} lần login thất bại. "
            f"Chờ thêm {remaining_min} phút trước khi thử lại. "
            f"Lỗi trước: {circuit.get('last_error', '?')}"
        )

    # Đã chờ đủ → cho phép thử lại (half-open)
    logger.info(
        "BQMS circuit breaker: half-open — cho phép thử lại sau %d phút chờ",
        int(elapsed // 60),
    )


async def playwright_bqms_login(
    username: str | None = None,
    password: str | None = None,
    base_url: str | None = None,
) -> dict[str, str]:
    """
    Login to Samsung BQMS via Playwright headless Chromium.

    Navigates to the login page, fills credentials, waits for redirect
    to authenticated portal, then extracts all cookies.

    Returns:
        Dict of cookie name → value, ready to inject into httpx.

    Raises:
        RuntimeError: If login fails or times out.
    """
    from playwright.async_api import async_playwright

    if username and password:
        uname, pwd = username, password
    else:
        # Resolve from runtime override (app_config) with env fallback. An
        # explicit username/password param still wins when both are provided.
        from app.services.bqms_credentials import get_bqms_credentials
        res_user, res_pwd = get_bqms_credentials()
        uname = username or res_user
        pwd = password or res_pwd
    base = base_url or settings.BQMS_BASE_URL or "https://www.sec-bqms.com"

    if not uname or not pwd:
        raise RuntimeError("BQMS credentials not configured")

    # Circuit breaker check — TRƯỚC khi mở browser
    _check_circuit()

    logger.info("Playwright BQMS login: starting (user=%s)", uname)

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--single-process",
            ],
        )

        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="en-US",
        )

        page = await context.new_page()

        try:
            # ── Step 0: Mở trang login + kiểm tra CAPTCHA/block
            login_url = f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true"
            await page.goto(login_url, wait_until="networkidle", timeout=30000)

            # Pre-check: detect CAPTCHA, block message, maintenance
            page_text = await page.text_content("body") or ""
            block_keywords = ["captcha", "blocked", "locked", "suspended", "too many", "try again later"]
            for kw in block_keywords:
                if kw in page_text.lower():
                    error_msg = f"Samsung BQMS trang login phát hiện block/CAPTCHA: '{kw}' — DỪNG login"
                    _record_failure(error_msg)
                    raise RuntimeError(error_msg)

            # Check login form exists
            login_input = await page.query_selector("input#id")
            if not login_input:
                error_msg = "Trang login Samsung không tìm thấy form đăng nhập — có thể đang bảo trì"
                _record_failure(error_msg)
                raise RuntimeError(error_msg)

            logger.debug("Playwright: login page OK, no CAPTCHA detected")

            # ── Step 1+2: Điền credentials + login (1 lần duy nhất, KHÔNG retry)
            await page.fill("input#id", uname)
            await page.fill("input#pass", pwd)
            await page.evaluate("login()")
            logger.debug("Playwright: login() called")

            # Chờ kết quả — 30s timeout
            try:
                await page.wait_for_url(
                    lambda url: "anonymous" not in url and "login" not in url.lower(),
                    timeout=30000,
                )
                logger.info("Playwright: login redirect → authenticated")
            except Exception:
                await page.wait_for_load_state("networkidle", timeout=10000)
                current_url = page.url

                # Kiểm tra lỗi trên trang
                error_text = await page.text_content("body") or ""
                if any(kw in error_text.lower() for kw in ["password", "incorrect", "failed", "sai", "locked", "block"]):
                    error_msg = f"Login thất bại — Samsung có thể đã block. URL: {current_url[:60]}"
                    _record_failure(error_msg)
                    raise RuntimeError(error_msg)

                if "anonymous" in current_url or "login" in current_url.lower():
                    error_msg = f"Login thất bại — vẫn ở trang login: {current_url[:60]}"
                    _record_failure(error_msg)
                    raise RuntimeError(error_msg)

            # Login thành công → reset circuit breaker
            _record_success()

            # Navigate to PO page to ensure full session setup
            po_url = f"{base}/bqms/mro/forward/vendor/vendorPoConfirm.do?target=vendor&_menuId=AZknkggsAB8V-Qhq&_menuF=true"
            await page.goto(po_url, wait_until="networkidle", timeout=30000)
            logger.debug("Playwright: PO page loaded")

            # Extract all cookies
            raw_cookies = await context.cookies()
            cookies = {c["name"]: c["value"] for c in raw_cookies}

            logger.info(
                "Playwright: extracted %d cookies (JSESSIONID=%s)",
                len(cookies),
                cookies.get("JSESSIONID", "?")[:12] + "...",
            )

            return cookies

        finally:
            await browser.close()
            logger.debug("Playwright: browser closed")


SYNC_STEPS_FILE = "/tmp/bqms_sync_steps.json"

STEP_DEFINITIONS = [
    {"step": 1, "label": "Mở trang đăng nhập"},
    {"step": 2, "label": "Điền tài khoản"},
    {"step": 3, "label": "Đăng nhập & xác thực"},
    {"step": 4, "label": "Mở trang P/O Receipt"},
    {"step": 5, "label": "Tải danh sách PO"},
    {"step": 6, "label": "Lưu vào database"},
]


def _update_step(step: int, status: str, message: str) -> None:
    """Ghi trạng thái bước hiện tại ra file JSON để frontend poll."""
    import json
    from datetime import datetime, timezone

    try:
        with open(SYNC_STEPS_FILE, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {"steps": [], "current_step": 0, "started_at": datetime.now(timezone.utc).isoformat()}

    # Update or append step
    found = False
    for s in data.get("steps", []):
        if s["step"] == step:
            s["status"] = status
            s["message"] = message
            s["updated_at"] = datetime.now(timezone.utc).isoformat()
            found = True
            break
    if not found:
        data.setdefault("steps", []).append({
            "step": step,
            "status": status,
            "message": message,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    data["current_step"] = step
    data["current_status"] = status

    with open(SYNC_STEPS_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False)

    logger.info("Step %d [%s]: %s", step, status, message)


def get_sync_steps() -> dict[str, Any]:
    """Đọc trạng thái các bước sync — gọi từ API."""
    import json
    try:
        with open(SYNC_STEPS_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"steps": [], "current_step": 0}


def reset_sync_steps() -> None:
    """Reset steps khi bắt đầu sync mới."""
    import json
    from datetime import datetime, timezone
    data = {
        "steps": [],
        "current_step": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(SYNC_STEPS_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False)


async def playwright_fetch_pos(
    username: str | None = None,
    password: str | None = None,
    base_url: str | None = None,
) -> list[dict[str, Any]]:
    """
    Login to Samsung BQMS via Playwright and intercept PO list API response.

    Samsung's JS sets session tokens internally before calling the API,
    so we navigate the page and capture the automatic XHR response.

    Returns:
        List of PO dicts directly from Samsung API.
    """
    from playwright.async_api import async_playwright

    if username and password:
        uname, pwd = username, password
    else:
        # Resolve from runtime override (app_config) with env fallback. An
        # explicit username/password param still wins when both are provided.
        from app.services.bqms_credentials import get_bqms_credentials
        res_user, res_pwd = get_bqms_credentials()
        uname = username or res_user
        pwd = password or res_pwd
    base = base_url or settings.BQMS_BASE_URL or "https://www.sec-bqms.com"

    if not uname or not pwd:
        raise RuntimeError("BQMS credentials not configured")

    # Circuit breaker — TRƯỚC khi mở browser
    _check_circuit()

    logger.info("Playwright PO fetch: starting")
    reset_sync_steps()

    all_pos: list[dict[str, Any]] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--single-process",
            ],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="en-US",
        )
        page = await context.new_page()

        # Intercept API response
        import asyncio
        api_data: dict[str, Any] | None = None
        api_event = asyncio.Event()

        async def capture_response(response):
            nonlocal api_data
            if "selectPOAcceptList" in response.url:
                try:
                    api_data = await response.json()
                    api_event.set()
                except Exception:
                    pass

        page.on("response", capture_response)

        try:
            # ── Step 1: Mở trang đăng nhập Samsung BQMS
            _update_step(1, "running", "Đang mở trang đăng nhập sec-bqms.com...")
            await page.goto(
                f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
                wait_until="networkidle", timeout=30000,
            )
            _update_step(1, "done", "Trang đăng nhập Samsung BQMS đã mở")

            # ── Step 2: Điền tài khoản + mật khẩu
            _update_step(2, "running", f"Đang điền tài khoản {uname}...")
            await page.fill("input#id", uname)
            await page.fill("input#pass", pwd)
            _update_step(2, "done", f"Đã điền tài khoản {uname} + mật khẩu")

            # ── Step 3: Bấm đăng nhập → chờ redirect
            _update_step(3, "running", "Đang đăng nhập, chờ xác thực MFA...")
            await page.evaluate("login()")
            await page.wait_for_url(
                lambda url: "anonymous" not in url and "login" not in url.lower(),
                timeout=30000,
            )
            _update_step(3, "done", "Đăng nhập thành công → Samsung Vendor Portal")

            # ── Step 4: Mở trang P/O Receipt
            _update_step(4, "running", "Đang mở trang P/O Receipt...")
            po_url = (
                f"{base}/bqms/mro/forward/vendor/vendorPoConfirm.do"
                "?target=vendor&_menuId=AZknkggsAB8V-Qhq&_menuF=true"
            )
            await page.goto(po_url, wait_until="networkidle", timeout=30000)

            try:
                await asyncio.wait_for(api_event.wait(), timeout=15)
            except asyncio.TimeoutError:
                raise RuntimeError("Timeout waiting for Samsung PO API response")

            if not api_data or not isinstance(api_data, dict):
                raise RuntimeError("No valid API response captured")

            _update_step(4, "done", "Trang P/O Receipt đã tải — dữ liệu nhận được")

            po_list = api_data.get("poList", [])
            total_cnt = int(api_data.get("page1_result", {}).get("totalCnt", 0))
            logger.info("Playwright: page 1 captured %d POs, total=%d", len(po_list), total_cnt)

            # ── Step 5: Nếu > 10 PO, chuyển sang 100 dòng/trang và tìm lại
            if total_cnt > 10:
                _update_step(5, "running", f"Tổng {total_cnt} PO — đang tải toàn bộ (100/trang)...")
                api_data = None
                api_event.clear()

                await page.select_option("select#pageSize", "100")
                await page.evaluate("search()")

                try:
                    await asyncio.wait_for(api_event.wait(), timeout=30)
                    if api_data and isinstance(api_data, dict):
                        po_list = api_data.get("poList", [])
                        _update_step(5, "done", f"Đã tải {len(po_list)}/{total_cnt} PO")
                except asyncio.TimeoutError:
                    _update_step(5, "done", f"Timeout — dùng {len(po_list)} PO trang đầu")
            else:
                _update_step(5, "done", f"Tổng {total_cnt} PO — không cần phân trang")

            all_pos.extend(po_list)

            # Step 4: If still more pages (total > 100), paginate
            if total_cnt > 100 and len(all_pos) < total_cnt:
                total_pages = (total_cnt + 99) // 100
                for pg in range(2, total_pages + 1):
                    api_data = None
                    api_event.clear()
                    try:
                        await page.evaluate(f"goPage({pg})")
                        await asyncio.wait_for(api_event.wait(), timeout=20)
                        if api_data and isinstance(api_data, dict):
                            extra = api_data.get("poList", [])
                            all_pos.extend(extra)
                            logger.debug("Playwright: page %d: +%d POs", pg, len(extra))
                    except Exception as e:
                        logger.warning("Playwright: page %d failed: %s", pg, e)
                        break

        finally:
            await browser.close()

    _update_step(6, "running", f"Đang lưu {len(all_pos)} PO vào database + trang Giao Hàng...")
    logger.info("Playwright PO fetch: %d POs total", len(all_pos))
    return all_pos
