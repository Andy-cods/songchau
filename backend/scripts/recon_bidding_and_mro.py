"""Recon round 5: dump Bidding Quotation Submit list/detail AND
Execution -> MRO -> P/O Receipt list/detail in a SINGLE login session.

Per user 2026-05-08: don't burn extra logins. One run = one login.

Output:
    /tmp/recon_b_mro/bidding_list.html
    /tmp/recon_b_mro/bidding_list.png
    /tmp/recon_b_mro/bidding_detail.html
    /tmp/recon_b_mro/bidding_detail.png
    /tmp/recon_b_mro/mro_list.html  (or po_receipt_list.html if MRO is just a parent)
    /tmp/recon_b_mro/mro_list.png
    /tmp/recon_b_mro/mro_detail.html
    /tmp/recon_b_mro/mro_detail.png
    /tmp/recon_b_mro/summary.json

Menu IDs (verified round 1):
    5  Bidding · Quotation Announcement
    10 Bidding · Quotation Submit  ← target 1
    20 MRO  (parent? — need to inspect submenu)
    33 P/O Receipt (General)         ← may be the target 2
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/tmp/recon_b_mro")
OUT.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("recon5")

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


async def dump_list(page, label: str) -> dict:
    """Dump list HTML, screenshot, and inspect grid + anchors."""
    html = await page.content()
    (OUT / f"{label}_list.html").write_text(html, encoding="utf-8")
    await page.screenshot(path=str(OUT / f"{label}_list.png"), full_page=True)

    info = {"url": page.url, "html_size": len(html)}
    info["text_appears"] = {
        kw: html.count(kw)
        for kw in (
            "Basic information", "Basic Information",
            "Item Information", "Request Number",
            "Contract Period", "Quotation No",
            "Bid", "PO", "Receipt", "Subject",
            "gridbox", "objbox",
        )
    }
    # Count grid rows
    info["grid_row_count"] = await page.evaluate(
        """() => document.querySelectorAll('.gridbox .objbox table tbody tr').length"""
    )
    # Sample anchors with javascript:; href (drill links)
    info["anchors_sample"] = await page.evaluate(
        """() => Array.from(
            document.querySelectorAll(".gridbox .objbox table tbody td a[href='javascript: ;']"),
        ).slice(0, 5).map(a => ({
            text: (a.textContent || '').trim().slice(0, 80),
            row_index: Array.from(a.closest('tbody').children).indexOf(a.closest('tr')),
        }))"""
    )
    log.info("%s list: %d rows, %d anchors", label, info["grid_row_count"], len(info["anchors_sample"]))
    return info


async def drill_first(page, label: str) -> dict:
    anchors = await page.query_selector_all(".gridbox .objbox table tbody td a[href='javascript: ;']")
    if not anchors:
        return {"_error": "no anchors found"}
    a = anchors[0]
    text = (await a.text_content() or "").strip()
    log.info("%s drill: clicking %r", label, text[:60])
    await a.click()
    await asyncio.sleep(5)

    detail_html = await page.content()
    (OUT / f"{label}_detail.html").write_text(detail_html, encoding="utf-8")
    await page.screenshot(path=str(OUT / f"{label}_detail.png"), full_page=True)

    info = {
        "click_text": text[:80],
        "after_click_url": page.url,
        "detail_size": len(detail_html),
        "text_appears": {
            kw: detail_html.count(kw)
            for kw in (
                "Basic information", "Basic Information",
                "Item Information", "Request Number",
                "Contract Period", "Quotation No",
                "PO No", "Receipt No", "Sub-Item",
                "itemGridbox", "subitemGridbox",
            )
        },
    }
    # Try to come back to list — sites usually use goList() but bidding/po may differ
    for fn in ("goList()", "goPrev()", "history.back()"):
        try:
            await page.evaluate(fn)
            await asyncio.sleep(3)
            log.info("%s back via %s -> %s", label, fn, page.url)
            break
        except Exception:
            continue
    info["back_url"] = page.url
    return info


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

        # ── Login ──────────────────────────────────────────────────
        await page.goto(
            f"{BASE}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
            wait_until="domcontentloaded", timeout=30_000,
        )
        await page.fill("input#id", USER)
        await page.fill("input#pass", PASS)
        await page.evaluate("login()")
        try:
            await page.wait_for_url(
                lambda u: "anonymous" not in u and "login" not in u.lower(),
                timeout=30_000,
            )
        except Exception:
            pass
        log.info("login OK: %s", page.url)
        summary["login_url"] = page.url

        # Capture top-level menu structure once for reference
        try:
            menu_dump = await page.evaluate(
                """() => {
                    const out = [];
                    document.querySelectorAll('a[onclick*="selectLeftMenu"]').forEach(a => {
                        const m = (a.getAttribute('onclick') || '').match(/selectLeftMenu\\((\\d+)/);
                        if (m) out.push({ id: m[1], label: (a.textContent || '').trim().slice(0, 60) });
                    });
                    return out;
                }"""
            )
            summary["menu_dump"] = menu_dump[:50]
            (OUT / "menu_structure.json").write_text(
                json.dumps(menu_dump, ensure_ascii=False, indent=2)
            )
        except Exception as exc:
            summary["menu_dump_error"] = str(exc)[:200]

        # ── 1. Bidding · Quotation Submit (selectLeftMenu(10)) ─────
        log.info("=== Bidding Quotation Submit ===")
        try:
            await page.evaluate("selectLeftMenu(10, 10, true)")
            await asyncio.sleep(8)
            summary["bidding"] = await dump_list(page, "bidding")
            summary["bidding_drill"] = await drill_first(page, "bidding")
        except Exception as exc:
            log.exception("bidding recon failed")
            summary["bidding_error"] = str(exc)[:300]

        # Sleep between drills (heartbeat-friendly)
        await asyncio.sleep(3)

        # ── 2. P/O Receipt (selectLeftMenu(33)) — Execution > MRO > P/O Receipt ───
        # The user said "Execution cột MRO" — but BQMS top-level has both "MRO" (20)
        # and "P/O Receipt (General)" (33). Try 33 first as it's "P/O Receipt".
        log.info("=== P/O Receipt (selectLeftMenu(33)) ===")
        try:
            await page.evaluate("selectLeftMenu(33, 33, true)")
            await asyncio.sleep(8)
            summary["po_receipt"] = await dump_list(page, "po_receipt")
            summary["po_receipt_drill"] = await drill_first(page, "po_receipt")
        except Exception as exc:
            log.exception("po_receipt recon failed")
            summary["po_receipt_error"] = str(exc)[:300]

        # ── 3. MRO (selectLeftMenu(20)) for completeness ─────────
        log.info("=== MRO menu (selectLeftMenu(20)) ===")
        try:
            await page.evaluate("selectLeftMenu(20, 20, true)")
            await asyncio.sleep(8)
            summary["mro"] = await dump_list(page, "mro")
            # Don't drill MRO yet — just dump list to inspect what its sub-pages look like
        except Exception as exc:
            log.exception("mro recon failed")
            summary["mro_error"] = str(exc)[:300]

        await browser.close()

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    log.info("DONE — summary.json + dump files in %s", OUT)
    for f in sorted(OUT.iterdir()):
        log.info("  - %s (%d bytes)", f.name, f.stat().st_size)


if __name__ == "__main__":
    asyncio.run(main())
