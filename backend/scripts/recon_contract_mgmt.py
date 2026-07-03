"""Reconnaissance: login to Samsung BQMS Vendor Portal, navigate to
Contract Mgmt, dump page HTML + screenshot for DOM inspection.

Run inside sc-api container:
    docker exec -e BQMS_USERNAME=... -e BQMS_PASSWORD=... sc-api \\
        python /app/scripts/recon_contract_mgmt.py

Output:
    /tmp/recon/contract_list.html          — Contract Mgmt list page
    /tmp/recon/contract_list.png           — Full-page screenshot
    /tmp/recon/contract_detail_<n>.html    — first 3 contract detail pages
    /tmp/recon/contract_detail_<n>.png     — screenshots
    /tmp/recon/recon_summary.json          — counts + selectors guessed

Per user 2026-05-08: human reviews these files BEFORE we lock in
selectors and build the production scraper. NO database writes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

OUT_DIR = Path("/tmp/recon")
OUT_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("recon")

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
    raise RuntimeError("BQMS credentials missing — set BQMS_USERNAME / BQMS_PASSWORD")


async def main() -> None:
    from playwright.async_api import async_playwright

    summary: dict = {
        "started_at": datetime.utcnow().isoformat() + "Z",
        "user": USER,
        "base_url": BASE,
        "outputs": {},
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
            locale="en-US",
        )
        page = await context.new_page()

        # ── Login ──────────────────────────────────────────────────
        login_url = f"{BASE}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true"
        logger.info("login: GET %s", login_url)
        await page.goto(login_url, wait_until="networkidle", timeout=30_000)

        await page.fill("input#id", USER)
        await page.fill("input#pass", PASS)
        # site uses inline JS function login() — match production scraper
        await page.evaluate("login()")
        try:
            await page.wait_for_url(
                lambda url: "anonymous" not in url and "login" not in url.lower(),
                timeout=30_000,
            )
        except Exception:
            await page.wait_for_load_state("networkidle", timeout=10_000)
        logger.info("login: ok, current URL = %s", page.url)
        summary["after_login_url"] = page.url

        # ── Navigate to Contract Mgmt via the site's own JS function ──
        # Menu items use selectLeftMenu(N, N, true) — Contract Mgmt is N=6.
        # Map of all top-level items found in recon round 1:
        #   5  Bidding · Quotation Announcement
        #   10 Bidding · Quotation Submit
        #   18 Selection Result
        #   6  Contract Mgmt.    ← TARGET
        #   20 MRO
        #   21 B2B
        #   33 P/O Receipt (General)
        logger.info("calling selectLeftMenu(6, 6, true) ...")
        try:
            await page.evaluate("selectLeftMenu(6, 6, true)")
        except Exception as exc:
            logger.warning("selectLeftMenu eval failed: %s", exc)
        # Site has a heartbeat XHR that prevents networkidle ever firing.
        # Just sleep enough for the menu's main XHR to land.
        await asyncio.sleep(8)

        logger.info("contract list URL = %s", page.url)
        summary["contract_list_url"] = page.url

        # Dump main page
        list_html = await page.content()
        (OUT_DIR / "contract_list.html").write_text(list_html, encoding="utf-8")
        await page.screenshot(path=str(OUT_DIR / "contract_list.png"), full_page=True)
        summary["outputs"]["contract_list_html"] = "/tmp/recon/contract_list.html"
        summary["outputs"]["contract_list_png"] = "/tmp/recon/contract_list.png"

        # Many BQMS portals load tabs into iframes — dump each iframe
        iframes_info = []
        for fi, frame in enumerate(page.frames):
            if frame == page.main_frame:
                continue
            try:
                furl = frame.url
                fhtml = await frame.content()
                fname = OUT_DIR / f"contract_list_iframe_{fi}.html"
                fname.write_text(fhtml, encoding="utf-8")
                iframes_info.append({"index": fi, "url": furl, "size": len(fhtml), "file": str(fname)})
            except Exception as exc:
                iframes_info.append({"index": fi, "error": str(exc)[:200]})
        summary["iframes"] = iframes_info

        # Best-effort: find all clickable contract subjects in the list
        # Try several link patterns; record what works.
        link_candidates: list[dict] = []
        for sel in [
            "table a[href*='contractDetail']",
            "table a[href*='ContractDetail']",
            "table a[href*='detail']",
            "table tbody td a",
            ".content table tbody td:nth-child(2) a",
            ".list-table a",
        ]:
            anchors = await page.query_selector_all(sel)
            if anchors:
                hrefs: list[str] = []
                for a in anchors[:5]:
                    href = await a.get_attribute("href") or ""
                    text = (await a.text_content() or "").strip()
                    hrefs.append(f"{text[:30]} -> {href[:80]}")
                link_candidates.append({"selector": sel, "match_count": len(anchors), "samples": hrefs})
                if len(anchors) >= 1 and not summary.get("first_working_selector"):
                    summary["first_working_selector"] = sel
        summary["link_candidates"] = link_candidates

        # NOTE: Skipping drill-into-detail in this recon round.
        # We need to inspect the list page first to identify how Subject
        # links open (likely another JS function or iframe form submit),
        # before we can reliably click them. Round 2 will drill once we
        # confirm the list selector + click pattern.

        await context.close()
        await browser.close()

    summary["finished_at"] = datetime.utcnow().isoformat() + "Z"
    (OUT_DIR / "recon_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("DONE — summary at /tmp/recon/recon_summary.json")
    logger.info("Files in /tmp/recon:")
    for f in sorted(OUT_DIR.iterdir()):
        logger.info("  - %s (%d bytes)", f.name, f.stat().st_size)


if __name__ == "__main__":
    asyncio.run(main())
