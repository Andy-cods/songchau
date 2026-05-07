"""
BQMS PO API client — direct REST calls after a single Playwright login.

Replaces Playwright XHR scraping with direct httpx POST calls. Saves ~10s
per request and supports any pageSize (up to 99999 = "All").

Endpoints exposed:
  - fetch_all_pos(date_from, date_to, status, page_size)
        → POST /bqms/mro/vendor/selectPOAcceptList.do
        → returns flat list of PO records (already paginated through)

  - confirm_pos(po_info_list)
        → POST /bqms/mro/vendor/updatePoStatusVedorConfirm.do
        → marks listed POs as Vendor-Confirmed
        → ⚠️ PRODUCTION WRITE: actually changes status on Samsung side

  - cancel_confirm_pos(po_info_list)
        → POST /bqms/mro/vendor/updatePoStatusVedorConfirmCancel.do
        → reverses a previous confirm (admin / mistake recovery)

Usage:
    from app.etl.bqms_po_api import fetch_all_pos, confirm_pos

    # Read-only — safe to run any time
    pos = await fetch_all_pos(date_from="20260101", date_to="20261231")

    # Production write — only call on user action
    await confirm_pos([
        {"poNo": "2112669549", "poSeq": "000040",
         "poStatus": "PO2", "secureKey": "..."}
    ])

Sitemap reference: BQMS_SITEMAP/BQMS_SITEMAP.md §2.2 / §2.3
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.etl.bqms_playwright import playwright_bqms_login

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _yyyymmdd(d: date | datetime | str | None) -> str:
    """Coerce a date / datetime / 'YYYY-MM-DD' string into 'YYYYMMDD'."""
    if d is None:
        return ""
    if isinstance(d, str):
        # Tolerate 2026-05-07 / 20260507 / 7/5/2026
        s = d.replace("-", "").replace("/", "").strip()
        return s[:8]
    if isinstance(d, datetime):
        d = d.date()
    return d.strftime("%Y%m%d")


def _default_date_range_30d() -> tuple[str, str]:
    today = date.today()
    return _yyyymmdd(today - timedelta(days=30)), _yyyymmdd(today)


async def _login_session() -> tuple[dict[str, str], str]:
    """Login once via Playwright and return (cookies, base_url)."""
    cookies = await playwright_bqms_login()
    base = (settings.BQMS_BASE_URL or "https://www.sec-bqms.com").rstrip("/")
    return cookies, base


def _httpx_kwargs(cookies: dict[str, str], base: str) -> dict[str, Any]:
    """Headers + cookies that mimic a logged-in browser session."""
    return {
        "cookies": cookies,
        "headers": {
            "Origin": base,
            "Referer": f"{base}/bqms/mro/forward/vendor/vendorPoConfirm.do",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
        },
        "timeout": httpx.Timeout(30.0, connect=10.0),
        "follow_redirects": True,
    }


# ---------------------------------------------------------------------------
# 1. fetch_all_pos — paginated PO list
# ---------------------------------------------------------------------------

async def fetch_all_pos(
    date_from: str | date | None = None,
    date_to: str | date | None = None,
    status_codes: list[str] | None = None,
    company_code: str = "",
    po_no: str = "",
    page_size: int = 99999,
) -> list[dict[str, Any]]:
    """Return ALL PO records matching the given filter as a flat list.

    Args:
        date_from / date_to: PO date window. Defaults to last 30 days.
        status_codes: list like ['N'] (not confirmed), ['Y'] (confirmed),
            or None / [] for ALL.
        company_code: Samsung buyer entity (e.g. 'C5H2' = SEVT). Empty = all.
        po_no: filter by exact PO number. Empty = all.
        page_size: rows per page. 99999 = portal's "All" sentinel.

    Returns:
        List of PO dicts — same fields as scrape (PO_NO, PO_SEQ, ITEM_CODE,
        BUYING_PRICE, BUYING_AMOUNT, PO_QTY, GR_QTY, secureKey, ...).
    """
    if date_from is None or date_to is None:
        df, dt = _default_date_range_30d()
        date_from = date_from or df
        date_to = date_to or dt

    body = {
        "srchStDate": _yyyymmdd(date_from),
        "srchEdDate": _yyyymmdd(date_to),
        "srchStatusCode": status_codes or [],
        "srchPoNo": po_no,
        "srchCompanySelect": company_code,
        "mroPageVO": {
            "pageInfos": [{
                "id": "page1",
                "pageIndex": 1,
                "location": ".paginate",
                "pageScript": "search()",
                "pageSize": str(page_size),
                "originalPageSize": None,
            }],
        },
    }

    cookies, base = await _login_session()
    url = f"{base}/bqms/mro/vendor/selectPOAcceptList.do"
    logger.info("BQMS fetch_all_pos: %s → %s, status=%s, pageSize=%d",
                body["srchStDate"], body["srchEdDate"], status_codes, page_size)

    async with httpx.AsyncClient(**_httpx_kwargs(cookies, base)) as client:
        r = await client.post(url, json=body)
        r.raise_for_status()
        payload = r.json()

    # Response shape: {"page1_result": {"totalCnt": "...", "data": [...]}}
    result_block = payload.get("page1_result") or {}
    rows = result_block.get("data") or []
    if not isinstance(rows, list):
        # Some BQMS endpoints wrap data inside another key — best-effort dig
        for k, v in (result_block or {}).items():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                rows = v
                break

    total = result_block.get("totalCnt", "?")
    logger.info("BQMS fetch_all_pos: got %d rows (totalCnt=%s)", len(rows), total)

    # If pageSize was 99999 we should have everything in one shot. If totalCnt
    # > len(rows), paginate the rest. (Defensive — shouldn't trigger with 99999.)
    try:
        total_int = int(total)
    except (TypeError, ValueError):
        total_int = len(rows)

    if total_int > len(rows) and page_size < 99999:
        async with httpx.AsyncClient(**_httpx_kwargs(cookies, base)) as client:
            page = 2
            while len(rows) < total_int and page <= 200:
                body["mroPageVO"]["pageInfos"][0]["pageIndex"] = page
                r = await client.post(url, json=body)
                r.raise_for_status()
                more = (r.json().get("page1_result") or {}).get("data") or []
                if not more:
                    break
                rows.extend(more)
                page += 1
        logger.info("BQMS fetch_all_pos: paginated total %d rows", len(rows))

    return rows


# ---------------------------------------------------------------------------
# 2. confirm_pos — production write
# ---------------------------------------------------------------------------

async def confirm_pos(
    po_info_list: list[dict[str, str]],
    *,
    cookies: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """Mark a batch of POs as Vendor-Confirmed on Samsung BQMS.

    Args:
        po_info_list: each item must have keys
            - poNo:      PO number, e.g. "2112669549"
            - poSeq:     line sequence, e.g. "000040"
            - poStatus:  current PO_STATUS, e.g. "PO2"
            - secureKey: anti-tampering token from the latest fetch
        cookies: pass-in cookies if already logged in. Otherwise login fresh.

    Returns:
        Raw response dict from Samsung (typically {"result":"SUCCESS"}).

    Raises:
        ValueError on validation, httpx.HTTPStatusError on HTTP failure.
    """
    if not po_info_list:
        raise ValueError("po_info_list is empty")

    required = {"poNo", "poSeq", "poStatus", "secureKey"}
    for i, info in enumerate(po_info_list):
        missing = required - set(info.keys())
        if missing:
            raise ValueError(f"po_info_list[{i}] missing keys: {missing}")

    if cookies is None:
        cookies, base = await _login_session()
    else:
        base = (settings.BQMS_BASE_URL or "https://www.sec-bqms.com").rstrip("/")

    url = f"{base}/bqms/mro/vendor/updatePoStatusVedorConfirm.do"
    logger.info("BQMS confirm_pos: %d POs (first=%s)",
                len(po_info_list), po_info_list[0]["poNo"])

    async with httpx.AsyncClient(**_httpx_kwargs(cookies, base)) as client:
        r = await client.post(url, json={"poInfoList": po_info_list})
        r.raise_for_status()
        return r.json()


async def cancel_confirm_pos(
    po_info_list: list[dict[str, str]],
    *,
    cookies: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """Reverse a Vendor-Confirm. `poInfoList` items need poNo / poSeq / secureKey
    only (no poStatus required by the cancel endpoint)."""
    if not po_info_list:
        raise ValueError("po_info_list is empty")
    for i, info in enumerate(po_info_list):
        for k in ("poNo", "poSeq", "secureKey"):
            if k not in info:
                raise ValueError(f"po_info_list[{i}] missing key: {k}")

    if cookies is None:
        cookies, base = await _login_session()
    else:
        base = (settings.BQMS_BASE_URL or "https://www.sec-bqms.com").rstrip("/")

    url = f"{base}/bqms/mro/vendor/updatePoStatusVedorConfirmCancel.do"
    logger.info("BQMS cancel_confirm_pos: %d POs", len(po_info_list))

    async with httpx.AsyncClient(**_httpx_kwargs(cookies, base)) as client:
        r = await client.post(url, json={"poInfoList": po_info_list})
        r.raise_for_status()
        return r.json()
