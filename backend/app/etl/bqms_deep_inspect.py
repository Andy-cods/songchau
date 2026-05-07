"""
Samsung BQMS deep page inspector — captures XHR/fetch traffic on the P/O
Receipt + Register Delivery pages so we can:
  (1) reverse-engineer pagination beyond the first 20 rows
  (2) identify the Confirm-PO endpoint (URL + payload shape)

Approach:
  - Login via existing playwright_bqms_login flow
  - Navigate to P/O Receipt
  - Attach `page.on('request')` and `page.on('response')` listeners
  - Trigger search() via JS (with pageSize=100, page 1) → capture the AJAX
  - Click pagination link page 2 → capture
  - Try to invoke Confirm flow on the first selectable PO (DRY: just observe
    the request payload, then immediately abort by closing the modal/page)

SAFETY:
  - DRY mode by default — never actually submit Confirm. We capture the
    request that *would* be sent, but cancel it via route interception.
  - Single login, no retry, normal circuit-breaker pre-check.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.etl.bqms_playwright import _check_circuit, _record_failure, _record_success

logger = logging.getLogger(__name__)

_PAGE_TIMEOUT_MS = 30000
_INTERESTING_PATH_KEYWORDS = (
    ".do", "selectPo", "selectIv", "Confirm", "search", "list",
    "delivery", "Delivery", "vendor",
)


async def deep_inspect_bqms(
    output_path: str,
    *,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Run the deep inspection. Returns the result dict written to file."""
    from playwright.async_api import async_playwright

    uname = settings.BQMS_USERNAME
    pwd = settings.BQMS_PASSWORD
    base = base_url or settings.BQMS_BASE_URL or "https://www.sec-bqms.com"

    if not uname or not pwd:
        raise RuntimeError("BQMS_USERNAME / BQMS_PASSWORD chưa cấu hình")

    _check_circuit()

    started = time.time()
    captures: list[dict[str, Any]] = []
    result: dict[str, Any] = {
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "base_url": base,
        "captures": captures,
        "errors": [],
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox", "--disable-setuid-sandbox",
                "--disable-dev-shm-usage", "--disable-gpu", "--single-process",
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

        # ── Wire request/response listeners ─────────────────────────────
        responses_seen: dict[str, dict[str, Any]] = {}

        async def on_response(resp):
            try:
                url = resp.url
                if not any(kw in url for kw in _INTERESTING_PATH_KEYWORDS):
                    return
                # Skip JS / CSS / image asset fetches
                ct = resp.headers.get("content-type", "")
                if "html" in ct or "javascript" in ct or "image" in ct or "css" in ct or "font" in ct:
                    return
                req = resp.request
                body_text = ""
                try:
                    body_text = (await resp.text())[:8000]
                except Exception:
                    pass
                post_data = ""
                try:
                    post_data = (req.post_data or "")[:2000]
                except Exception:
                    pass
                key = f"{req.method} {url}"
                if key not in responses_seen:
                    responses_seen[key] = {
                        "method": req.method,
                        "url": url,
                        "status": resp.status,
                        "request_headers": dict(req.headers),
                        "post_data": post_data,
                        "response_content_type": ct,
                        "response_preview": body_text,
                    }
            except Exception as exc:
                logger.debug("listener err: %s", exc)

        page.on("response", lambda r: asyncio.create_task(on_response(r)))

        try:
            # ── Login ────────────────────────────────────────────────
            login_url = f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true"
            await page.goto(login_url, wait_until="networkidle", timeout=_PAGE_TIMEOUT_MS)
            await page.fill("input#id", uname)
            await page.fill("input#pass", pwd)
            await page.evaluate("login()")
            try:
                await page.wait_for_url(
                    lambda u: "anonymous" not in u and "login" not in u.lower(),
                    timeout=_PAGE_TIMEOUT_MS,
                )
            except Exception:
                await page.wait_for_load_state("networkidle", timeout=8000)
            _record_success()

            # ── P/O Receipt: page 1 with pageSize=100 ───────────────
            po_url = (
                f"{base}/bqms/mro/forward/vendor/vendorPoConfirm.do"
                "?target=vendor&_menuId=AZknkggsAB8V-Qhq&_menuF=true"
            )
            await page.goto(po_url, wait_until="networkidle", timeout=_PAGE_TIMEOUT_MS)
            logger.info("Deep: on P/O Receipt page")
            await asyncio.sleep(2)  # let initial XHR settle

            # Try to bump pageSize to 100 and trigger search again
            try:
                await page.evaluate("""
                    var ps = document.getElementById('pageSize');
                    if (ps) { ps.value = '100'; }
                    if (typeof search === 'function') { search(); }
                """)
                await asyncio.sleep(3)
                logger.info("Deep: triggered search() with pageSize=100")
            except Exception as exc:
                result["errors"].append(f"PO pageSize trigger: {exc}")

            # Try page 2
            try:
                await page.evaluate("""
                    var p = document.querySelector('.paginate [name=pageIndex]');
                    if (p) { p.value = 2; }
                    if (typeof search === 'function') { search(); }
                """)
                await asyncio.sleep(3)
                logger.info("Deep: triggered search() with pageIndex=2")
            except Exception as exc:
                result["errors"].append(f"PO page 2 trigger: {exc}")

            # ── Capture Confirm-PO flow (DRY observation only) ─────
            # Look at the page HTML for the JS function that confirms a PO,
            # and capture its source.
            try:
                confirm_fn_src = await page.evaluate("""() => {
                    const all = [];
                    for (const k of Object.keys(window)) {
                        try {
                            const v = window[k];
                            if (typeof v === 'function') {
                                const s = v.toString();
                                if (/confirm/i.test(k) || /Confirm/.test(s) ||
                                    /selectPoAcceptList|poConfirm|insertPo/i.test(s)) {
                                    all.push({ name: k, source: s.substring(0, 600) });
                                }
                            }
                        } catch(e){}
                    }
                    return all.slice(0, 30);
                }""")
                result["confirm_functions"] = confirm_fn_src
            except Exception as exc:
                result["errors"].append(f"confirm fn extract: {exc}")

            # Also extract the entire page's inline script blob (truncated)
            try:
                inline_scripts = await page.evaluate("""() => {
                    return Array.from(document.scripts)
                        .filter(s => !s.src && s.textContent.length > 100 && s.textContent.length < 30000)
                        .map(s => s.textContent.substring(0, 4000))
                        .slice(0, 6);
                }""")
                result["inline_scripts_preview"] = inline_scripts
            except Exception as exc:
                result["errors"].append(f"inline scripts: {exc}")

            # ── Register Delivery page ───────────────────────────────
            del_url = (
                f"{base}/bqms/mro/forward/vendor/grCreateDelivery.do"
                "?target=vendor&_menuId=AZknksd8ACIV-Qhq&_menuF=true"
            )
            await page.goto(del_url, wait_until="networkidle", timeout=_PAGE_TIMEOUT_MS)
            logger.info("Deep: on Register Delivery page")
            await asyncio.sleep(3)
            try:
                await page.evaluate("if (typeof search === 'function') search();")
                await asyncio.sleep(3)
            except Exception:
                pass

            # ── Done. Drain captured responses. ──────────────────────
            captures.extend(list(responses_seen.values()))
            result["stats"] = {
                "captures_count": len(captures),
                "elapsed_seconds": round(time.time() - started, 1),
            }

        except Exception as exc:
            err_msg = f"deep inspect crashed: {exc}"
            result["errors"].append(err_msg)
            _record_failure(err_msg)
            raise
        finally:
            await browser.close()

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    return result
