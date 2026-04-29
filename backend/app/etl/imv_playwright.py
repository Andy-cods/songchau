"""IMV portal scraper — login via Playwright, fetch grid data via XHR.

Pattern (analog to bqms_playwright):
  1. Headless Chromium opens https://www.imvmall.com/
  2. Fill P_USER_ID + P_USER_PW_TEMP, submit
  3. Wait for /mro/main.jsp, dismiss popups
  4. For each grid (RFQ/Orders/Deliveries/Payments/Contracts/Rejections):
     navigate to action.SXX.SXXXXXXXL, capture XHR XML response, paginate.
  5. Parse XML rows into structured dicts and return

Public functions:
  - fetch_imv_rfqs() — backward-compat wrapper
  - fetch_imv_grid(file_id, cell_map) — generic
  - fetch_all_imv_grids() — orchestrates login once + all 5 entity types
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


# Cell index → field name maps. Each map = list of (field_name, type)
# type: 'str', 'int', 'dec', 'date', 'skip'

RFQ_MAP = [
    ('row_num',            'skip'),   # 0
    ('action_link',        'skip'),   # 1
    ('status_text',        'str'),    # 2
    ('handler_name',       'str'),    # 3
    ('customer_name',      'str'),    # 4
    ('customer_facility',  'str'),    # 5
    ('customer_item_code', 'str'),    # 6
    ('item_code',          'str'),    # 7
    ('rfq_number',         'str'),    # 8
    ('product_name',       'str'),    # 9
    ('model',              'str'),    # 10
    ('spec',               'str'),    # 11
    ('maker',              'str'),    # 12
    ('unit',               'str'),    # 13
    ('quantity',           'dec'),    # 14
    ('offered_qty',        'dec'),    # 15
    ('request_date',       'date'),   # 16
    ('due_date',           'date'),   # 17
    ('due_time',           'str'),    # 18
    ('_19',                'skip'),
    ('_20',                'skip'),
    ('doc_type',           'str'),    # 21
    ('flow_status',        'str'),    # 22
    ('request_id',         'str'),    # 23
    ('item_code_internal', 'str'),    # 24
    ('requester_id',       'str'),    # 25
    ('handler_login',      'str'),    # 26
]

# S20.S2010010L Orders (67 cells)
ORDERS_MAP = [
    ('row_num',            'skip'),   # 0
    ('status_text',        'str'),    # 1
    ('order_type',         'str'),    # 2
    ('order_date',         'date'),   # 3
    ('_4',                 'skip'),   # 4
    ('delivery_due',       'date'),   # 5
    ('_6',                 'skip'),   # 6
    ('po_number',          'str'),    # 7
    ('_8',                 'skip'),
    ('_9',                 'skip'),
    ('_10',                'skip'),
    ('_11',                'skip'),
    ('handler_name',       'str'),    # 12
    ('_13',                'skip'),
    ('_14',                'skip'),
    ('handler_login',      'str'),    # 15
    ('_16',                'skip'),
    ('customer_facility',  'str'),    # 17
    ('_18',                'skip'),
    ('requester_name',     'str'),    # 19
    ('_20',                'skip'),
    ('_21',                'skip'),
    ('_22',                'skip'),
    ('customer_name',      'str'),    # 23
    ('item_code',          'str'),    # 24
    ('_25',                'skip'),
    ('product_name',       'str'),    # 26
    ('spec',               'str'),    # 27
    ('model',              'str'),    # 28
    ('maker',              'str'),    # 29
    ('_30',                'skip'),
    ('unit',               'str'),    # 31
    ('origin_country',     'str'),    # 32
    ('tax_label',          'str'),    # 33
    ('quantity',           'dec'),    # 34
    ('currency',           'str'),    # 35
    ('unit_price',         'dec'),    # 36
    ('amount',             'dec'),    # 37
    ('delivery_address',   'str'),    # 38
    ('_39',                'skip'),
    ('_40',                'skip'),
    ('order_method',       'str'),    # 41
    *[(f'_{i}', 'skip') for i in range(42, 62)],
    ('po_internal_number', 'str'),    # 62
    *[(f'_{i}', 'skip') for i in range(63, 67)],
]

# S20.S2020020L Deliveries (63 cells)
DELIVERIES_MAP = [
    ('row_num',            'skip'),   # 0
    ('delivery_type',      'str'),    # 1
    ('ship_to',            'str'),    # 2
    ('_3',                 'skip'),
    ('_4',                 'skip'),
    ('order_no_internal',  'str'),    # 5
    ('_6',                 'skip'),
    ('product_name',       'str'),    # 7
    ('spec',               'str'),    # 8
    ('_9',                 'skip'),
    ('_10',                'skip'),
    ('due_date',           'date'),   # 11
    ('shipped_date',       'date'),   # 12
    ('_13',                'skip'),
    ('quantity',           'dec'),    # 14
    ('confirmed_date',     'date'),   # 15
    ('confirmed_qty',      'dec'),    # 16
    ('origin_country',     'str'),    # 17
    ('unit',               'str'),    # 18
    ('_19',                'skip'),
    ('_20',                'skip'),
    ('item_code',          'str'),    # 21
    ('customer_name',      'str'),    # 22
    ('customer_facility',  'str'),    # 23
    ('customer_dept',      'str'),    # 24
    ('po_number',          'str'),    # 25
    ('_26',                'skip'),
    ('_27',                'skip'),
    ('_28',                'skip'),
    ('_29',                'skip'),
    ('delivery_address',   'str'),    # 30
    *[(f'_{i}', 'skip') for i in range(31, 38)],
    ('status',             'str'),    # 38
    ('_39',                'skip'),
    ('_40',                'skip'),
    ('stage',              'str'),    # 41 (was status2)
    *[(f'_{i}', 'skip') for i in range(42, 55)],
    ('supplier_name',      'str'),    # 55
    ('stage2',             'str'),    # 56 (was stage)
    *[(f'_{i}', 'skip') for i in range(57, 58)],
    ('shipment_id',        'str'),    # 58
    *[(f'_{i}', 'skip') for i in range(59, 63)],
]

# S30.S3020010L Payments (55 cells)
PAYMENTS_MAP = [
    ('row_num',            'skip'),   # 0
    ('payment_target',     'str'),    # 1
    ('_2',                 'skip'),
    ('_3',                 'skip'),
    ('paying_entity',      'str'),    # 4
    ('payment_method',     'str'),    # 5
    ('_6',                 'skip'),
    ('_7',                 'skip'),
    ('_8',                 'skip'),
    ('invoice_id',         'str'),    # 9
    ('invoice_date',       'date'),   # 10
    ('order_no',           'str'),    # 11
    ('po_no',              'str'),    # 12
    ('amount_id',          'str'),    # 13
    ('shipment_id',        'str'),    # 14
    ('item_code',          'str'),    # 15
    ('product_name',       'str'),    # 16
    ('model',              'str'),    # 17
    *[(f'_{i}', 'skip') for i in range(18, 21)],
    ('quantity',           'dec'),    # 21
    ('unit',               'str'),    # 22
    ('currency',           'str'),    # 23
    ('unit_price',         'dec'),    # 24
    ('total_amount',       'dec'),    # 25
    ('tax_label',          'str'),    # 26
    ('_27',                'skip'),
    ('customer_code',      'str'),    # 28
    ('customer_name',      'str'),    # 29
    ('customer_dept',      'str'),    # 30
    *[(f'_{i}', 'skip') for i in range(31, 47)],
    ('payment_type',       'str'),    # 47
    *[(f'_{i}', 'skip') for i in range(48, 55)],
]

# Stub maps for empty-for-us tables — generic enough that if data appears we capture it
CONTRACTS_MAP = [
    ('row_num',            'skip'),
    ('status_text',        'str'),
    *[(f'_{i}', 'skip') for i in range(2, 60)],
]

REJECTIONS_MAP = [
    ('row_num',            'skip'),
    ('status_text',        'str'),
    *[(f'_{i}', 'skip') for i in range(2, 60)],
]

# Backward-compat alias
CELL_MAP = RFQ_MAP


def _row_to_dict(row_el: ET.Element, cell_map: list[tuple[str, str]] | None = None) -> dict[str, Any]:
    """Map cells to a typed dict using cell_map. Default = legacy RFQ_MAP."""
    cmap = cell_map or RFQ_MAP
    cells = row_el.findall('cell')
    out: dict[str, Any] = {}
    for idx, entry in enumerate(cmap):
        if entry[1] == 'skip':
            continue
        key, kind = entry[0], entry[1]
        if idx >= len(cells):
            out[key] = None
            continue
        raw = _decode_cell(cells[idx].text or '')
        if not raw:
            out[key] = None
            continue
        if kind == 'int':
            out[key] = _parse_int(raw)
        elif kind == 'dec':
            out[key] = _parse_decimal(raw)
        elif kind == 'date':
            out[key] = _parse_date(raw)
        else:
            out[key] = raw
    return out


# ─── Scraper ──────────────────────────────────────────────────

# Entity registry — name → (file_id_short, cell_map, unique_keys)
GRID_REGISTRY = {
    'rfq':         ('S10.S1020010L', RFQ_MAP,        ('rfq_number', 'item_code')),
    'orders':      ('S20.S2010010L', ORDERS_MAP,     ('po_internal_number', 'item_code')),
    'deliveries':  ('S20.S2020020L', DELIVERIES_MAP, ('shipment_id', 'item_code')),
    'payments':    ('S30.S3020010L', PAYMENTS_MAP,   ('invoice_id', 'item_code')),
    'contracts':   ('S10.S1020020L', CONTRACTS_MAP,  ('contract_id', 'item_code')),
    'rejections':  ('S40.S4010010L', REJECTIONS_MAP, ('rejection_id', 'item_code')),
}


async def _do_login(page) -> None:
    user_id = getattr(settings, 'IMV_USER_ID', '') or ''
    password = getattr(settings, 'IMV_PASSWORD', '') or ''
    if not user_id or not password:
        raise RuntimeError('IMV_USER_ID / IMV_PASSWORD not configured')
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


async def _close_popups(ctx, main_page) -> None:
    for popup in list(ctx.pages):
        if popup is not main_page:
            try:
                await popup.close()
            except Exception:
                pass


async def _fetch_grid(page, file_id_short: str, cell_map: list, rows_per_page: int = 200, max_pages: int = 10) -> list[dict[str, Any]]:
    """Visit a grid page, capture XHR XML, paginate, return parsed rows."""
    file_id = f'action.{file_id_short}'
    captured: dict[str, str] = {}

    async def on_resp(resp):
        try:
            if 'imvmall.com' in resp.url and file_id_short in resp.url and 'SEARCH' in resp.url:
                body = await resp.text()
                if len(body) > 200:
                    captured[resp.url] = body
        except Exception as exc:
            logger.debug('imv: response capture failed: %s', exc)

    page.on('response', lambda r: asyncio.create_task(on_resp(r)))

    url = (f'{IMV_BASE}/mro/main_blank.jsp?'
           f'FILE_ID={file_id}&ACTION_ID=FORWARD&'
           f'LOV_PARAMETER_INF_ID=&KEYWORD_ITEM=&'
           f'ROWS_PER_PAGE={rows_per_page}&CURRENT_PAGE=1')
    logger.info('imv: visit %s', file_id_short)
    try:
        await page.goto(url, wait_until='networkidle', timeout=30_000)
    except Exception as exc:
        logger.warning('imv: goto failed for %s: %s', file_id_short, exc)
    await page.wait_for_timeout(5000)

    # Always try click "Tìm kiếm" — some grids don't auto-load on FORWARD
    if not captured:
        for sel in ['text=Tìm kiếm', 'button:has-text("Search")', 'input[value="Tìm kiếm"]']:
            try:
                await page.click(sel, timeout=2500)
                logger.info('imv: %s — clicked search button (%s)', file_id_short, sel)
                break
            except Exception:
                pass
        await page.wait_for_timeout(5000)

    # Direct XHR fallback if listener still empty
    if not captured:
        xhr_url = (f'{IMV_BASE}/mro/do?FILE_ID={file_id}&ACTION_ID=SEARCH&'
                   'SELECTED_ROW=&SELECTED_GRIDNUM=&PK_MERGE_ID=&'
                   'LOV_PARAMETER_INF_ID=&GROUP_MARKER=&TARGET_GRID_ID=tab1Grid&'
                   f'ROWS_PER_PAGE={rows_per_page}&CURRENT_PAGE=1')
        try:
            resp = await page.request.get(xhr_url, headers={'X-Requested-With': 'XMLHttpRequest'})
            if resp.ok:
                body = await resp.text()
                if len(body) > 200:
                    captured[xhr_url] = body
                    logger.info('imv: %s — direct XHR fallback ok %d bytes', file_id_short, len(body))
        except Exception as exc:
            logger.warning('imv: %s direct XHR failed: %s', file_id_short, exc)

    rows: list[dict[str, Any]] = []
    if not captured:
        logger.info('imv: %s — no XML captured (likely empty grid)', file_id_short)
        return rows

    for url_key, body in list(captured.items()):
        try:
            root = ET.fromstring(body)
        except ET.ParseError as exc:
            logger.error('imv: XML parse failed for %s: %s', file_id_short, exc)
            continue
        total = int(root.get('totalRecord', '0') or '0')
        server_page_size = int(root.get('ROWS_PER_PAGE', str(rows_per_page)) or rows_per_page)
        logger.info('imv: %s total=%d page_size=%d', file_id_short, total, server_page_size)

        for r in root.findall('row'):
            d = _row_to_dict(r, cell_map)
            d['raw_xml'] = ET.tostring(r, encoding='unicode')
            rows.append(d)

        pages_total = max(1, (total + server_page_size - 1) // server_page_size)
        if pages_total > 1:
            for pg in range(2, min(pages_total, max_pages) + 1):
                next_url = (f'{IMV_BASE}/mro/do?FILE_ID={file_id}&ACTION_ID=SEARCH&'
                            'SELECTED_ROW=&SELECTED_GRIDNUM=&PK_MERGE_ID=&'
                            'LOV_PARAMETER_INF_ID=&GROUP_MARKER=&TARGET_GRID_ID=tab1Grid&'
                            f'ROWS_PER_PAGE={server_page_size}&CURRENT_PAGE={pg}')
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
                            d2 = _row_to_dict(r2, cell_map)
                            d2['raw_xml'] = ET.tostring(r2, encoding='unicode')
                            rows.append(d2)
                            added += 1
                        logger.info('imv: %s page %d +%d rows', file_id_short, pg, added)
                except Exception as exc:
                    logger.warning('imv: %s page %d fetch failed: %s', file_id_short, pg, exc)
        break  # only process first capture (rest are likely duplicates)

    return rows


async def fetch_all_imv_grids(entities: list[str] | None = None) -> dict[str, list[dict[str, Any]]]:
    """Login once, fetch all (or specified) grid types in one session."""
    target_entities = entities or list(GRID_REGISTRY.keys())
    out: dict[str, list[dict[str, Any]]] = {}

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
            await _do_login(page)
            await _close_popups(ctx, page)
            for entity_idx, entity in enumerate(target_entities):
                if entity not in GRID_REGISTRY:
                    logger.warning('imv: unknown entity %s', entity)
                    continue
                file_id_short, cell_map, _ = GRID_REGISTRY[entity]
                # Small breather between entities so the IMV server doesn't rate-limit
                if entity_idx > 0:
                    await page.wait_for_timeout(2000)
                try:
                    rows = await _fetch_grid(page, file_id_short, cell_map)
                    # Filter out rows missing both keys
                    _, _, key_pair = GRID_REGISTRY[entity]
                    valid = [r for r in rows if any(r.get(k) for k in key_pair)]
                    out[entity] = valid
                    logger.info('imv: %s = %d valid rows', entity, len(valid))
                except Exception as exc:
                    logger.exception('imv: %s fetch failed: %s', entity, exc)
                    out[entity] = []
        finally:
            try:
                await ctx.close()
            except Exception:
                pass
            await browser.close()

    return out


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
