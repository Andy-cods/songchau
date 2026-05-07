"""
Samsung BQMS Portal Sitemap Crawler.

Single-shot crawler that logs into sec-bqms.com once and walks the menu
structure to capture URL → title → buttons → forms → table headers.

SAFETY:
  - Reuses the existing circuit-breaker from bqms_playwright.py (no double-login)
  - 2-second delay between page navigations (rate-limit politeness)
  - Hard cap on total pages crawled (default 80)
  - Stop on first navigation error to avoid cascading failures
  - Idempotent: the resulting JSON is just a snapshot; safe to re-run

Output: JSON dict written to ``output_path``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

from app.core.config import settings
from app.etl.bqms_playwright import _check_circuit, _record_failure, _record_success

logger = logging.getLogger(__name__)


# Hyperlinks containing these substrings are skipped — they navigate
# away from the authenticated portal or trigger logout / external sites.
_SKIP_LINK_SUBSTR = (
    "logout",
    "signout",
    "javascript:void",
    "mailto:",
    "tel:",
    ".pdf",
    ".xlsx",
    ".xls",
    "#",
)

# Page navigation timeout
_PAGE_TIMEOUT_MS = 25000
# Inter-page politeness delay
_INTER_PAGE_DELAY_S = 2.0


async def _safe_inner_text(page, selector: str, *, limit: int = 30) -> list[str]:
    """Return de-duplicated visible text contents for a CSS selector."""
    out: list[str] = []
    seen: set[str] = set()
    try:
        elements = await page.locator(selector).all()
    except Exception:
        return out
    for el in elements[:200]:  # hard cap to avoid runaway DOMs
        try:
            t = await el.text_content()
            if not t:
                continue
            t = " ".join(t.split())
            if not t or t in seen:
                continue
            seen.add(t)
            out.append(t)
            if len(out) >= limit:
                break
        except Exception:
            continue
    return out


async def _capture_page(page) -> dict[str, Any]:
    """Snapshot key landmarks of the currently-loaded page."""
    info: dict[str, Any] = {
        "url": page.url,
        "title": "",
        "h1_h3": [],
        "buttons": [],
        "links": [],
        "form_fields": [],
        "table_headers": [],
    }
    try:
        info["title"] = await page.title()
    except Exception:
        pass

    info["h1_h3"] = await _safe_inner_text(page, "h1, h2, h3", limit=15)
    info["buttons"] = await _safe_inner_text(
        page,
        "button:visible, input[type='button']:visible, input[type='submit']:visible, a.btn:visible",
        limit=40,
    )
    info["table_headers"] = await _safe_inner_text(page, "th", limit=30)

    # Anchor links: capture (text, href) pairs — useful for understanding nav
    try:
        anchors = await page.locator("a[href]:visible").all()
        link_pairs: list[dict[str, str]] = []
        seen_hrefs: set[str] = set()
        for a in anchors[:300]:
            try:
                href = await a.get_attribute("href") or ""
                if not href or any(s in href.lower() for s in _SKIP_LINK_SUBSTR):
                    continue
                if href in seen_hrefs:
                    continue
                seen_hrefs.add(href)
                txt = (await a.text_content()) or ""
                txt = " ".join(txt.split())[:80]
                link_pairs.append({"text": txt, "href": href})
                if len(link_pairs) >= 50:
                    break
            except Exception:
                continue
        info["links"] = link_pairs
    except Exception:
        pass

    # Form fields: name + placeholder + type
    try:
        fields = await page.locator(
            "input:visible, select:visible, textarea:visible"
        ).all()
        form_items: list[dict[str, str]] = []
        for f in fields[:50]:
            try:
                tag = await f.evaluate("el => el.tagName.toLowerCase()")
                ftype = (await f.get_attribute("type")) or ""
                name = (await f.get_attribute("name")) or ""
                placeholder = (await f.get_attribute("placeholder")) or ""
                fid = (await f.get_attribute("id")) or ""
                # Skip hidden / pure styling inputs
                if ftype.lower() in ("hidden",):
                    continue
                form_items.append({
                    "tag": tag, "type": ftype, "name": name,
                    "id": fid, "placeholder": placeholder[:60],
                })
                if len(form_items) >= 30:
                    break
            except Exception:
                continue
        info["form_fields"] = form_items
    except Exception:
        pass

    return info


async def _login_and_get_page(p, base_url: str, username: str, password: str):
    """Mirror of playwright_bqms_login but returns the live page object."""
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

    login_url = f"{base_url}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true"
    await page.goto(login_url, wait_until="networkidle", timeout=_PAGE_TIMEOUT_MS)
    body_text = (await page.text_content("body")) or ""
    for kw in ("captcha", "blocked", "locked", "suspended", "too many"):
        if kw in body_text.lower():
            await browser.close()
            raise RuntimeError(f"Pre-check phát hiện block: '{kw}'")

    await page.fill("input#id", username)
    await page.fill("input#pass", password)
    await page.evaluate("login()")
    try:
        await page.wait_for_url(
            lambda u: "anonymous" not in u and "login" not in u.lower(),
            timeout=_PAGE_TIMEOUT_MS,
        )
    except Exception:
        await page.wait_for_load_state("networkidle", timeout=8000)
        if "anonymous" in page.url or "login" in page.url.lower():
            await browser.close()
            raise RuntimeError(f"Login thất bại — vẫn ở: {page.url[:80]}")

    return browser, context, page


async def _extract_menu_items(page) -> list[dict[str, str]]:
    """Pull the left-sidebar / top-nav links once after login.

    BQMS uses standard `<a href="...do?...">` anchors, sometimes wrapped
    inside menu LIs. We grab every visible authenticated anchor and let
    the caller dedupe by URL.
    """
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    try:
        anchors = await page.locator("a[href*='.do']:visible").all()
        for a in anchors[:500]:
            try:
                href = (await a.get_attribute("href")) or ""
                if not href or any(s in href.lower() for s in _SKIP_LINK_SUBSTR):
                    continue
                if "anonymous" in href.lower():
                    continue
                if href in seen:
                    continue
                seen.add(href)
                txt = (await a.text_content()) or ""
                txt = " ".join(txt.split())[:80]
                items.append({"text": txt, "href": href})
            except Exception:
                continue
    except Exception:
        pass
    return items


async def crawl_bqms_sitemap(
    output_path: str,
    *,
    max_pages: int = 80,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Crawl Samsung BQMS portal once, snapshot menu structure to JSON.

    Returns the same dict that gets written to ``output_path``.
    """
    from playwright.async_api import async_playwright

    uname = settings.BQMS_USERNAME
    pwd = settings.BQMS_PASSWORD
    base = base_url or settings.BQMS_BASE_URL or "https://www.sec-bqms.com"

    if not uname or not pwd:
        raise RuntimeError("BQMS_USERNAME / BQMS_PASSWORD chưa cấu hình")

    _check_circuit()

    started = time.time()
    result: dict[str, Any] = {
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "base_url": base,
        "max_pages": max_pages,
        "menu_items": [],
        "pages": [],
        "errors": [],
        "stats": {},
    }

    async with async_playwright() as p:
        browser, context, page = await _login_and_get_page(p, base, uname, pwd)
        _record_success()

        try:
            # Always start at the PO Confirm landing page (the default after login)
            po_url = (
                f"{base}/bqms/mro/forward/vendor/vendorPoConfirm.do"
                "?target=vendor&_menuId=AZknkggsAB8V-Qhq&_menuF=true"
            )
            await page.goto(po_url, wait_until="networkidle", timeout=_PAGE_TIMEOUT_MS)
            logger.info("Sitemap: landed on PO Confirm page, extracting menu...")

            menu = await _extract_menu_items(page)
            result["menu_items"] = menu
            logger.info("Sitemap: %d unique menu links discovered", len(menu))

            # Always include the landing page itself as page #0
            await asyncio.sleep(0.5)
            landing = await _capture_page(page)
            landing["source"] = "landing"
            result["pages"].append(landing)

            for idx, item in enumerate(menu[:max_pages], start=1):
                href = item["href"]
                # Resolve relative URLs
                target = href if href.startswith("http") else urljoin(base + "/", href.lstrip("/"))
                # Stay on sec-bqms domain
                if "sec-bqms" not in urlparse(target).netloc:
                    continue

                logger.info("Sitemap: [%d/%d] %s -> %s", idx, len(menu), item["text"][:30], target[:80])
                try:
                    await page.goto(target, wait_until="networkidle", timeout=_PAGE_TIMEOUT_MS)
                except Exception as exc:
                    err = f"goto failed [{idx}] {target[:80]}: {exc}"
                    result["errors"].append(err)
                    logger.warning(err)
                    # Don't `break` — try next; only abort if many in a row
                    if len(result["errors"]) > 5:
                        logger.error("Sitemap: too many nav errors, aborting")
                        break
                    continue

                try:
                    snap = await _capture_page(page)
                    snap["menu_text"] = item["text"]
                    snap["source"] = "menu"
                    result["pages"].append(snap)
                except Exception as exc:
                    result["errors"].append(f"capture failed [{idx}]: {exc}")

                await asyncio.sleep(_INTER_PAGE_DELAY_S)

            result["stats"] = {
                "menu_items_found": len(menu),
                "pages_captured": len(result["pages"]),
                "errors_count": len(result["errors"]),
                "elapsed_seconds": round(time.time() - started, 1),
            }

        except Exception as exc:
            err_msg = f"crawl crashed: {exc}"
            result["errors"].append(err_msg)
            _record_failure(err_msg)
            raise
        finally:
            await browser.close()

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    logger.info("Sitemap saved: %s (%d pages, %d errors)",
                output_path, len(result["pages"]), len(result["errors"]))
    return result
