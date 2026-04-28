"""IMV portal scraper — login via Playwright, fetch RFQ list via XHR.

Pattern (analog to bqms_playwright):
  1. Headless Chromium opens https://www.imvmall.com/
  2. Fill P_USER_ID + P_USER_PW_TEMP, submit
  3. Wait for /mro/main.jsp, dismiss popups
  4. Open RFQ list page (action.S10.S1020010L), capture XHR XML response
  5. Parse XML rows into structured dicts and return

Uses page.request (Playwright APIRequestContext) for follow-up XHR calls
so we share session cookies / TLS fingerprint with the browser.
"""

from __future__ import annotations

import asyncio
import logging
import re
from html import unescape
from typing import Any
from xml.etree import ElementTree as ET

from playwright.async_api import async_playwright, Browser, BrowserContext

from app.core.config import settings

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────

IMV_BASE = 'https://www.imvmall.com'
LOGIN_URL = f'{IMV_BASE}/'
RFQ_LIST_URL = (
    f'{IMV_BASE}/mro/main_blank.jsp?'
    'FILE_ID=action.S10.S1020010L&ACTION_ID=FORWARD&'
    'LOV_PARAMETER_INF_ID=&KEYWORD_ITEM=&ROWS_PER_PAGE=200&CURRENT_PAGE=1'
)
RFQ_SEARCH_URL = (
    f'{IMV_BASE}/mro/do?FILE_ID=action.S10.S1020010L&ACTION_ID=SEARCH&'
    'SELECTED_ROW=&SELECTED_GRIDNUM=&PK_MERGE_ID=&LOV_PARAMETER_INF_ID=&'
    'GROUP_MARKER=&TARGET_GRID_ID=tab1Grid&'
    'ROWS_PER_PAGE={rows}&CURRENT_PAGE={page}'
)


# ─── Cell parsing helpers ─────────────────────────────────────

_HREF_TEXT_RE = re.compile(r'<A[^>]*>([^<]*)</A>', re.IGNORECASE)


def _decode_cell(raw: str) -> str:
    """Strip HTML wrapper from a cell value, decode entities."""
    if raw is None:
        return ''
    s = unescape(raw).strip()
    # Cell wraps content in <A>...</A> for clickable items — extract inner text
    m = _HREF_TEXT_RE.search(s)
    if m:
        return m.group(1).strip()
    return s


def _parse_int(s: str) -> int | None:
    s = (s or '').replace(',', '').strip()
    if not s:
        return None
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return None


def _parse_decimal(s: str) -> float | None:
    s = (s or '').replace(',', '').strip()
    if not s:
        return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _parse_date(s: str) -> str | None:
    """Validate YYYY-MM-DD; return None otherwise."""
    s = (s or '').strip()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s):
        return s
    return None


# Cell index → field name (mapped from S1020010L SEARCH XML, 26 cells per row)
CELL_MAP = [
    ('row_num',            False),  # 0
    ('action_link',        False),  # 1 — checkbox/send button
    ('status_text',        True),   # 2 — "Yêu cầu báo giá"
    ('handler_name',       True),   # 3
    ('customer_name',      True),   # 4
    ('customer_facility',  True),   # 5
    ('customer_item_code', True),   # 6
    ('item_code',          True),   # 7
    ('rfq_number',         True),   # 8
    ('product_name',       True),   # 9
    ('model',              True),   # 10
    ('spec',               True),   # 11
    ('maker',              True),   # 12
    ('unit',               True),   # 13
    ('quantity',           True),   # 14 — numeric
    ('offered_qty',        True),   # 15 — numeric
    ('request_date',       True),   # 16 — YYYY-MM-DD
    ('due_date',           True),   # 17 — YYYY-MM-DD
    ('due_time',           True),   # 18 — HH:MM:SS
    ('extra_19',           False),  # 19 — empty
    ('extra_20',           False),  # 20 — empty
    ('doc_type',           True),   # 21 — "QR"
    ('flow_status',        True),   # 22 — "P03"
    ('request_id',         True),   # 23 — "RE..."
    ('item_code_internal', True),   # 24
    ('requester_id',       True),   # 25
    ('handler_login',      True),   # 26 — eg "HAODANG"
]


def _row_to_dict(row_el: ET.Element) -> dict[str, Any]:
    cells = row_el.findall('cell')
    out: dict[str, Any] = {}
    for idx, (key, keep) in enumerate(CELL_MAP):
        if not keep:
            continue
        if idx >= len(cells):
            out[key] = None
            continue
        val = _decode_cell(cells[idx].text or '')
        out[key] = val if val else None

    # Type coercion
    if out.get('quantity') is not None:
        out['quantity'] = _parse_decimal(out['quantity'])
    if out.get('offered_qty') is not None:
        out['offered_qty'] = _parse_decimal(out['offered_qty'])
    if out.get('request_date'):
        out['request_date'] = _parse_date(out['request_date'])
    if out.get('due_date'):
        out['due_date'] = _parse_date(out['due_date'])

    return out


# ─── Scraper ──────────────────────────────────────────────────


async def fetch_imv_rfqs(rows_per_page: int = 200, max_pages: int = 5) -> list[dict[str, Any]]:
    """Login + fetch all RFQ rows from IMV S1020010L. Returns list of dicts."""

    user_id = getattr(settings, 'IMV_USER_ID', '') or ''
    password = getattr(settings, 'IMV_PASSWORD', '') or ''
    if not user_id or not password:
        raise RuntimeError('IMV_USER_ID / IMV_PASSWORD not configured in env')

    rows: list[dict[str, Any]] = []

    async with async_playwright() as p:
        browser: Browser = await p.chromium.launch(
            headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'],
        )
        ctx: BrowserContext = await browser.new_context(
            ignore_https_errors=True,
            viewport={'width': 1600, 'height': 900},
        )
        page = await ctx.new_page()

        try:
            logger.info('imv_sync: login as %s', user_id)
            await page.goto(LOGIN_URL, wait_until='networkidle', timeout=30_000)
            await page.locator('input[type=text]').first.fill(user_id)
            await page.locator('input[type=password]').first.fill(password)
            await page.keyboard.press('Enter')
            try:
                await page.wait_for_load_state('networkidle', timeout=20_000)
            except Exception:
                pass
            await page.wait_for_timeout(2000)

            if 'main.jsp' not in page.url and 'login' in page.url.lower():
                raise RuntimeError(f'IMV login failed — still on {page.url}')

            # Close any popup tabs
            for popup in list(ctx.pages):
                if popup is not page:
                    try:
                        await popup.close()
                    except Exception:
                        pass

            # Capture XHR XML response
            captured: dict[str, str] = {}

            async def on_resp(resp):
                try:
                    if 'imvmall.com' in resp.url and 'S1020010L' in resp.url and 'SEARCH' in resp.url:
                        body = await resp.text()
                        if len(body) > 200:
                            captured[resp.url] = body
                except Exception as exc:
                    logger.debug('imv: response capture failed: %s', exc)

            page.on('response', lambda r: asyncio.create_task(on_resp(r)))

            url = RFQ_LIST_URL.replace('ROWS_PER_PAGE=200', f'ROWS_PER_PAGE={rows_per_page}')
            logger.info('imv_sync: open RFQ list page')
            await page.goto(url, wait_until='networkidle', timeout=30_000)
            await page.wait_for_timeout(5000)

            # Parse first response
            if not captured:
                logger.warning('imv_sync: no SEARCH XML captured on initial load — trying click')
                try:
                    await page.click('text=Tìm kiếm', timeout=3000)
                    await page.wait_for_timeout(5000)
                except Exception:
                    pass

            for url_key, body in list(captured.items()):
                logger.info('imv_sync: parsing %d bytes from %s', len(body), url_key[:120])
                try:
                    root = ET.fromstring(body)
                except ET.ParseError as exc:
                    logger.error('imv_sync: XML parse failed: %s', exc)
                    continue
                total = int(root.get('totalRecord', '0') or '0')
                # IMV server enforces its own page size — read what it actually returned
                server_page_size = int(root.get('ROWS_PER_PAGE', str(rows_per_page)) or rows_per_page)
                logger.info(
                    'imv_sync: total=%d, server_page_size=%d (requested=%d)',
                    total, server_page_size, rows_per_page,
                )

                for r in root.findall('row'):
                    d = _row_to_dict(r)
                    if d.get('rfq_number') and d.get('item_code'):
                        d['raw_xml'] = ET.tostring(r, encoding='unicode')
                        rows.append(d)

                # Use the server's actual page size for follow-up pagination
                pages_total = max(1, (total + server_page_size - 1) // server_page_size)
                logger.info('imv_sync: need %d pages total, fetched 1', pages_total)
                if pages_total > 1:
                    for pg in range(2, min(pages_total, max_pages) + 1):
                        next_url = RFQ_SEARCH_URL.format(rows=server_page_size, page=pg)
                        try:
                            resp = await page.request.get(
                                next_url,
                                headers={'X-Requested-With': 'XMLHttpRequest'},
                            )
                            if resp.ok:
                                body2 = await resp.text()
                                root2 = ET.fromstring(body2)
                                added = 0
                                for r2 in root2.findall('row'):
                                    d2 = _row_to_dict(r2)
                                    if d2.get('rfq_number') and d2.get('item_code'):
                                        d2['raw_xml'] = ET.tostring(r2, encoding='unicode')
                                        rows.append(d2)
                                        added += 1
                                logger.info('imv_sync: page %d fetched +%d rows', pg, added)
                        except Exception as exc:
                            logger.warning('imv_sync: page %d fetch failed: %s', pg, exc)
                break  # only process first capture (the rest are duplicates)

        finally:
            try:
                await ctx.close()
            except Exception:
                pass
            await browser.close()

    logger.info('imv_sync: fetched %d RFQ rows', len(rows))
    return rows
