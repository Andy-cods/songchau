"""Recon round 4: click ONE Subject anchor on Contract Mgmt list, dump
the detail page DOM so we can lock in selectors for Basic Information
and Item Information tables.

Single login, single drill — gentle on the rate limit.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

OUT_DIR = Path("/tmp/recon_detail")
OUT_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("recon_detail")

USER = os.environ.get("BQMS_USERNAME") or ""
PASS = os.environ.get("BQMS_PASSWORD") or ""
BASE = os.environ.get("BQMS_BASE_URL") or "https://www.sec-bqms.com"

if not USER or not PASS:
    sys.path.insert(0, "/app")
    from app.core.config import settings
    USER = USER or settings.BQMS_USERNAME or ""
    PASS = PASS or settings.BQMS_PASSWORD or ""
    BASE = BASE or settings.BQMS_BASE_URL or "https://www.sec-bqms.com"

if not USER or not PASS:
    raise RuntimeError("BQMS credentials missing")


async def main() -> None:
    from playwright.async_api import async_playwright

    summary: dict = {"started_at": datetime.utcnow().isoformat() + "Z"}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1440, "height": 900},
            locale="en-US",
        )
        page = await context.new_page()

        # Login
        await page.goto(f"{BASE}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
                        wait_until="domcontentloaded", timeout=30_000)
        await page.fill("input#id", USER)
        await page.fill("input#pass", PASS)
        await page.evaluate("login()")
        try:
            await page.wait_for_url(lambda u: "anonymous" not in u and "login" not in u.lower(), timeout=30_000)
        except Exception:
            pass
        logger.info("login: %s", page.url)

        # Navigate to Contract Mgmt
        await page.evaluate("selectLeftMenu(6, 6, true)")
        await asyncio.sleep(8)
        logger.info("contract list: %s", page.url)

        # Find first Subject anchor (col 6) — only those inside the grid body
        anchors = await page.query_selector_all(".gridbox .objbox table tbody td a[href='javascript: ;']")
        logger.info("found %d Subject anchors", len(anchors))

        if not anchors:
            await browser.close()
            summary["error"] = "no anchors found"
            (OUT_DIR / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
            return

        # Capture row data BEFORE click for verification
        first_row_text = await anchors[0].evaluate(
            "a => a.closest('tr')?.innerText"
        )
        summary["first_row_text"] = (first_row_text or "")[:600]
        logger.info("first row text: %s", (first_row_text or "")[:200])

        # Click first Subject
        anchor_text = await anchors[0].text_content()
        logger.info("clicking subject: %r", (anchor_text or "")[:60])
        await anchors[0].click()

        # User said wait 5s for full load
        await asyncio.sleep(5)
        logger.info("after click URL: %s", page.url)
        summary["after_click_url"] = page.url

        # Dump detail
        detail_html = await page.content()
        (OUT_DIR / "contract_detail.html").write_text(detail_html, encoding="utf-8")
        await page.screenshot(path=str(OUT_DIR / "contract_detail.png"), full_page=True)

        # Probe key text in DOM
        for label in ("Basic information", "Item Information", "Request Number", "Contract Period"):
            count = detail_html.count(label)
            summary[f"text_count_{label.replace(' ', '_').lower()}"] = count
            logger.info("text '%s' appears %d times", label, count)

        await browser.close()

    summary["finished_at"] = datetime.utcnow().isoformat() + "Z"
    (OUT_DIR / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("DONE. Files in /tmp/recon_detail:")
    for f in sorted(OUT_DIR.iterdir()):
        logger.info("  - %s (%d bytes)", f.name, f.stat().st_size)


if __name__ == "__main__":
    asyncio.run(main())
