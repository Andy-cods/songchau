"""Recon round 6: drill ONE row on MRO P/O Confirmation list to lock detail DOM.

Output: /tmp/recon_mro/mro_list.html, mro_list.png, mro_detail.html, mro_detail.png, summary.json
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/tmp/recon_mro")
OUT.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("recon_mro")

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
        browser = await p.chromium.launch(
            headless=True, args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1440, "height": 900}, locale="en-US",
        )
        page = await context.new_page()

        # Login
        await page.goto(
            f"{BASE}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
            wait_until="domcontentloaded", timeout=30_000,
        )
        await page.fill("input#id", USER)
        await page.fill("input#pass", PASS)
        await page.evaluate("login()")
        try:
            await page.wait_for_url(
                lambda u: "anonymous" not in u and "login" not in u.lower(), timeout=30_000,
            )
        except Exception:
            pass
        log.info("login OK: %s", page.url)

        # Navigate to MRO list (menu 20)
        await page.evaluate("selectLeftMenu(20, 20, true)")
        await asyncio.sleep(8)
        log.info("MRO list URL: %s", page.url)
        summary["list_url"] = page.url

        list_html = await page.content()
        (OUT / "mro_list.html").write_text(list_html, encoding="utf-8")
        await page.screenshot(path=str(OUT / "mro_list.png"), full_page=True)

        # Inspect grid columns + anchor pattern
        grid_inspect = await page.evaluate(
            """() => {
                const rs = document.querySelectorAll('.gridbox .objbox table tbody tr');
                const out = { row_count: rs.length, sample_rows: [] };
                rs.forEach((tr, idx) => {
                    if (idx >= 3) return;
                    const tds = tr.querySelectorAll('td');
                    const cells = [];
                    tds.forEach((td, i) => {
                        cells.push({
                            i: i,
                            text: (td.textContent || '').trim().slice(0, 60),
                            has_anchor: !!td.querySelector('a'),
                            anchor_text: ((td.querySelector('a') || {}).textContent || '').trim().slice(0, 40),
                            anchor_onclick: (td.querySelector('a') || {}).getAttribute?.('onclick') || '',
                            anchor_href: (td.querySelector('a') || {}).getAttribute?.('href') || '',
                        });
                    });
                    out.sample_rows.push({ idx, cells });
                });
                return out;
            }"""
        )
        summary["grid_inspect"] = grid_inspect
        log.info("grid: %d rows, sample: %s", grid_inspect.get("row_count"), json.dumps(grid_inspect.get("sample_rows", []))[:300])

        # Try the javascript:; pattern first; if no anchors found that way,
        # try clicking the first anchor with text in column 5 or 6 (likely the PO subject)
        anchors = await page.query_selector_all(".gridbox .objbox table tbody td a[href='javascript: ;']")
        if not anchors:
            anchors = await page.query_selector_all(".gridbox .objbox table tbody td a")
            log.info("falling back to .objbox td a (any anchor): %d", len(anchors))

        if not anchors:
            log.error("NO anchors found on MRO list — aborting drill")
            summary["error"] = "no anchors"
            await browser.close()
            (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
            return

        # Click the first non-empty-text anchor
        first_real = None
        for a in anchors:
            t = (await a.text_content() or "").strip()
            if t:
                first_real = a
                summary["click_text"] = t[:80]
                break

        if first_real is None:
            first_real = anchors[0]
            summary["click_text"] = "(empty)"

        log.info("clicking anchor: %r", summary.get("click_text"))
        await first_real.click()
        await asyncio.sleep(5)

        log.info("after-click URL: %s", page.url)
        summary["detail_url"] = page.url

        detail_html = await page.content()
        (OUT / "mro_detail.html").write_text(detail_html, encoding="utf-8")
        await page.screenshot(path=str(OUT / "mro_detail.png"), full_page=True)

        # Probe text counts
        for label in ("Basic information", "Item Information", "Item Info",
                      "PO No", "PO Number", "Subject", "Quantity", "Unit",
                      "Sub Item", "itemGridbox", "Receipt"):
            summary[f"text_count_{label.replace(' ', '_').lower()}"] = detail_html.count(label)

        # Discover headers/sections in detail
        section_dump = await page.evaluate(
            """() => {
                const out = { h4s: [], h3s: [], gridboxes: [] };
                document.querySelectorAll('h3').forEach(h => out.h3s.push(h.textContent.trim().slice(0,80)));
                document.querySelectorAll('h4').forEach(h => out.h4s.push(h.textContent.trim().slice(0,80)));
                document.querySelectorAll('[id*="ridbox"]').forEach(g => out.gridboxes.push({id: g.id, rows: g.querySelectorAll('tbody tr').length}));
                return out;
            }"""
        )
        summary["section_dump"] = section_dump
        log.info("h4s: %s", section_dump.get("h4s"))
        log.info("h3s: %s", section_dump.get("h3s"))
        log.info("gridboxes: %s", section_dump.get("gridboxes"))

        await browser.close()

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    log.info("DONE — %s", OUT)
    for f in sorted(OUT.iterdir()):
        log.info("  - %s (%d bytes)", f.name, f.stat().st_size)


if __name__ == "__main__":
    asyncio.run(main())
