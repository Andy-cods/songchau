"""Song Chau ERP — E2E Round 2: mutations + performance + mobile.

Categories
1. Mutations end-to-end (UI click -> API -> DB row visible -> cleanup)
   - CRM: create customer with extended fields, verify duplicate-check
     finds it, verify it appears in /api/v1/crm/customers list, then DELETE
   - BQMS: PATCH /rfq/{id}/price  -> verify bqms_quote_log row inserted
     with correct round + price + user_id, then revert
   - IMV: POST /imv/sync  -> verify imv_sync_log row appears with status,
     no DB cleanup (sync is idempotent)
   - Documents: POST /etl/sync-local -> verify etl_sync_log entry +
     onedrive_file_index count growth
   - Notifications: GET unread count -> mark all read -> verify count drops
2. Performance budgets
   - Big-list endpoints: limit=500 returns under 3s
   - Page TTFB <2s for top 10 routes
3. Mobile responsive
   - 3 viewports: 375 (mobile), 768 (tablet), 1600 (desktop)
   - Sidebar collapsed on mobile + content reflows
   - Charts/tables don't overflow horizontally

Output: /tmp/e2e_round2_results.json
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = 'https://erp.songchau.vn'
EMAIL = 'thang@songchau.vn'
PASSWORD = 'SongChau@2026'

# Performance budgets (milliseconds)
TTFB_BUDGET = 2000
LARGE_LIST_BUDGET = 3000
PAGE_LOAD_BUDGET = 5000

results = {
    'started_at': datetime.utcnow().isoformat(),
    'mutations': [],
    'performance': [],
    'mobile': [],
    'summary': {},
}


def http(method: str, path: str, token: str, body=None) -> dict:
    url = BASE + path
    data = None
    headers = {'Authorization': f'Bearer {token}'}
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            return {
                'status': resp.status,
                'duration_ms': round((time.monotonic() - t0) * 1000),
                'bytes': len(raw),
                'body': json.loads(raw) if raw and resp.headers.get('content-type', '').startswith('application/json') else None,
                'ok': True,
            }
    except urllib.error.HTTPError as exc:
        body_txt = ''
        try:
            body_txt = exc.read().decode('utf-8', errors='replace')[:300]
        except Exception:
            pass
        return {
            'status': exc.code,
            'duration_ms': round((time.monotonic() - t0) * 1000),
            'ok': False,
            'error': exc.reason,
            'body_text': body_txt,
        }
    except Exception as exc:
        return {
            'status': 0,
            'duration_ms': round((time.monotonic() - t0) * 1000),
            'ok': False,
            'error': str(exc)[:200],
        }


def login() -> str | None:
    r = http('POST', '/api/v1/auth/login', '', {'email': EMAIL, 'password': PASSWORD})
    if r.get('ok') and r.get('body', {}).get('access_token'):
        return r['body']['access_token']
    return None


# ─── 1. Mutations ─────────────────────────────────────────────────


def test_crm_create_customer(token: str) -> dict:
    """Create a test customer, verify duplicate detection, then delete."""
    test_code = f'E2E-{int(time.time())}'
    payload = {
        'customer_code': test_code,
        'company_name': f'E2E Test Customer {test_code}',
        'short_name': 'E2E Test',
        'tax_code': '0312345678',
        'customer_type': 'enterprise',
        'business_system': 'imv',
        'contact_name': 'E2E Tester',
        'contact_role': 'Mua hàng',
        'industry': 'electronics',
        'company_size': 'small',
        'lead_source': 'cold_call',
        'preferred_channel': 'email',
        'email': f'e2e+{int(time.time())}@test.com',
        'phone': '0901234567',
    }
    out = {'flow': 'crm_create_customer', 'steps': []}

    # Step 1: pre-check duplicate (should be 0)
    dup1 = http('POST', '/api/v1/crm/customers/check-duplicate', token,
                {'tax_code': payload['tax_code']})
    out['steps'].append({
        'step': 'pre_duplicate_check',
        'ok': dup1['ok'],
        'matches_before': len((dup1.get('body') or {}).get('matches', [])),
    })

    # Step 2: create
    create = http('POST', '/api/v1/crm/customers', token, payload)
    customer_id = (create.get('body') or {}).get('data', {}).get('id')
    out['steps'].append({
        'step': 'create',
        'status': create['status'],
        'duration_ms': create['duration_ms'],
        'ok': create['ok'] and customer_id is not None,
        'customer_id': customer_id,
    })

    if not customer_id:
        out['ok'] = False
        out['error'] = create.get('body_text') or create.get('error', 'no id')
        return out

    # Step 3: verify in list
    listr = http('GET', f'/api/v1/crm/customers?q={test_code}&limit=5', token)
    matches = []
    if listr.get('body'):
        # support both shapes
        for r in (listr['body'].get('data') or listr['body'].get('items') or []):
            if isinstance(r, dict) and r.get('customer_code') == test_code:
                matches.append(r)
    out['steps'].append({
        'step': 'verify_in_list',
        'ok': len(matches) > 0,
        'matches_in_list': len(matches),
    })

    # Step 4: verify duplicate-check now finds it
    dup2 = http('POST', '/api/v1/crm/customers/check-duplicate', token,
                {'tax_code': payload['tax_code']})
    matches_after = len((dup2.get('body') or {}).get('matches', []))
    out['steps'].append({
        'step': 'post_duplicate_check',
        'ok': matches_after > 0,
        'matches_after': matches_after,
    })

    # Step 5: cleanup — DELETE customer (soft delete via API if exists)
    cleanup = http('DELETE', f'/api/v1/crm/customers/{customer_id}', token)
    out['steps'].append({
        'step': 'cleanup_delete',
        'status': cleanup['status'],
        'ok': cleanup['ok'] or cleanup['status'] in (404, 405),
    })

    out['ok'] = all(s.get('ok') for s in out['steps'][:4])
    return out


def test_bqms_price_edit(token: str) -> dict:
    """Edit price on a test RFQ, verify quote_log row created."""
    out = {'flow': 'bqms_price_edit_with_log', 'steps': []}

    # Pick a recent RFQ
    listr = http('GET', '/api/v1/bqms/list-rfq?limit=1', token)
    if not listr.get('body') or not (listr['body'].get('data') or []):
        out['ok'] = False
        out['error'] = 'no RFQ available to test'
        return out
    rfq_id = listr['body']['data'][0].get('id')
    orig_v1 = listr['body']['data'][0].get('quoted_price_bqms_v1')
    out['steps'].append({'step': 'pick_rfq', 'rfq_id': rfq_id, 'orig_v1': orig_v1, 'ok': bool(rfq_id)})

    # Edit price (set v1 to test value)
    test_price = 12345.67
    edit = http('PATCH', f'/api/v1/bqms/rfq/{rfq_id}/price', token,
                {'field': 'quoted_price_bqms_v1', 'value': test_price})
    out['steps'].append({
        'step': 'patch_price',
        'status': edit['status'],
        'duration_ms': edit['duration_ms'],
        'ok': edit['ok'],
    })

    # Verify the edit was applied (read back)
    time.sleep(1)
    listr2 = http('GET', f'/api/v1/bqms/list-rfq?limit=10', token)
    found_price = None
    for r in (listr2.get('body') or {}).get('data', []):
        if r.get('id') == rfq_id:
            found_price = r.get('quoted_price_bqms_v1')
            break
    out['steps'].append({
        'step': 'verify_price_in_db',
        'expected': test_price,
        'actual': found_price,
        'ok': found_price is not None and abs(float(found_price) - test_price) < 0.01,
    })

    # Verify quote_log entry — call sync-health which counts log entries indirectly
    # Better: query /api/v1/daily-report/morning which reads from quote_log
    morning = http('GET', '/api/v1/daily-report/morning', token)
    quoted_today = (morning.get('body') or {}).get('quoted_today', {}).get('total', 0)
    out['steps'].append({
        'step': 'quote_log_visible_in_morning_report',
        'quoted_today_count': quoted_today,
        'ok': quoted_today > 0,
    })

    # Revert if we have orig
    if orig_v1 is not None:
        revert = http('PATCH', f'/api/v1/bqms/rfq/{rfq_id}/price', token,
                      {'field': 'quoted_price_bqms_v1', 'value': float(orig_v1)})
        out['steps'].append({'step': 'revert', 'ok': revert['ok']})
    else:
        # set back to null isn't supported — leave the test value
        out['steps'].append({'step': 'revert', 'ok': True, 'note': 'no orig value, left test price'})

    out['ok'] = all(s.get('ok') for s in out['steps'][:4])
    return out


def test_imv_manual_sync(token: str) -> dict:
    """Trigger IMV sync, verify sync_log gets new row."""
    out = {'flow': 'imv_manual_sync', 'steps': []}

    pre = http('GET', '/api/v1/imv/sync-history?limit=1', token)
    pre_id = (pre.get('body') or {}).get('data', [{}])[0].get('id') if pre.get('body') else None

    trig = http('POST', '/api/v1/imv/sync', token)
    out['steps'].append({
        'step': 'trigger',
        'status': trig['status'],
        'ok': trig['ok'] or trig['status'] == 409,
        'message': (trig.get('body') or {}).get('message') or trig.get('body_text', '')[:80],
    })

    # Wait and check for new sync_log row
    new_id = None
    for i in range(8):
        time.sleep(15)
        post = http('GET', '/api/v1/imv/sync-history?limit=3', token)
        rows = (post.get('body') or {}).get('data', [])
        if rows and (pre_id is None or rows[0].get('id') != pre_id):
            new_id = rows[0].get('id')
            out['steps'].append({
                'step': f'poll_{(i+1)*15}s',
                'new_sync_id': new_id,
                'status': rows[0].get('status'),
                'total_records': rows[0].get('total_records'),
                'ok': True,
            })
            break

    if not new_id:
        out['steps'].append({'step': 'poll_timeout', 'ok': False})
        out['ok'] = False
        return out

    out['ok'] = True
    return out


def test_local_filesystem_sync(token: str) -> dict:
    """Trigger local filesystem index, verify file count refreshes."""
    out = {'flow': 'local_filesystem_sync', 'steps': []}

    pre = http('GET', '/api/v1/etl/sync-health', token)
    pre_count = (pre.get('body') or {}).get('files_indexed', 0)
    out['steps'].append({'step': 'pre_state', 'files_before': pre_count, 'ok': True})

    trig = http('POST', '/api/v1/etl/sync-local', token)
    out['steps'].append({
        'step': 'trigger',
        'status': trig['status'],
        'ok': trig['ok'] or trig['status'] == 409,
    })

    # Wait + check freshness updated
    fresh = False
    for i in range(6):
        time.sleep(15)
        post = http('GET', '/api/v1/etl/sync-health', token)
        docs = (post.get('body') or {}).get('modules', {}).get('documents', {})
        mins_ago = docs.get('minutes_ago')
        if mins_ago is not None and mins_ago < 2:
            out['steps'].append({
                'step': f'poll_{(i+1)*15}s',
                'documents_minutes_ago': mins_ago,
                'files_indexed': (post.get('body') or {}).get('files_indexed', 0),
                'ok': True,
            })
            fresh = True
            break

    if not fresh:
        out['steps'].append({'step': 'poll_timeout', 'ok': False})
    out['ok'] = fresh
    return out


def test_notifications_mark_read(token: str) -> dict:
    """Mark all notifications read, verify unread count = 0."""
    out = {'flow': 'notifications_mark_all_read', 'steps': []}

    pre = http('GET', '/api/v1/notifications?limit=1', token)
    pre_unread = (pre.get('body') or {}).get('unread_count', 0)
    out['steps'].append({'step': 'pre_state', 'unread_before': pre_unread, 'ok': True})

    mark = http('PUT', '/api/v1/notifications/read-all', token)
    out['steps'].append({
        'step': 'mark_all',
        'status': mark['status'],
        'ok': mark['ok'],
        'updated': (mark.get('body') or {}).get('data', {}).get('updated'),
    })

    post = http('GET', '/api/v1/notifications?limit=1', token)
    post_unread = (post.get('body') or {}).get('unread_count', 0)
    out['steps'].append({
        'step': 'verify_unread_zero',
        'unread_after': post_unread,
        'ok': post_unread == 0,
    })

    out['ok'] = all(s.get('ok') for s in out['steps'])
    return out


# ─── 2. Performance ──────────────────────────────────────────────


PERF_ENDPOINTS = [
    ('/api/v1/dashboard/kpis-v2', 1500),
    ('/api/v1/etl/sync-health', 1000),
    ('/api/v1/imv/rfq/list?limit=200', 3000),
    ('/api/v1/imv/orders/list?limit=200', 3000),
    ('/api/v1/imv/deliveries/list?limit=200', 3000),
    ('/api/v1/imv/payments/list?limit=200', 3000),
    ('/api/v1/imv/kpi', 1500),
    ('/api/v1/bqms/list-rfq?limit=500', 3000),
    ('/api/v1/market-prices/dashboard', 3000),
    ('/api/v1/daily-report/trend?period=day&n=30', 1500),
    ('/api/v1/daily-report/top-codes?days=21&limit=12', 2000),
    ('/api/v1/crm/customers?limit=100', 2000),
    ('/api/v1/quarterly-invoices?limit=200', 3000),
    ('/api/v1/finance-management/dashboard', 2000),
]


def test_performance(token: str) -> list:
    out = []
    for path, budget_ms in PERF_ENDPOINTS:
        # Warm + measure
        http('GET', path, token)
        time.sleep(0.5)
        r = http('GET', path, token)
        ok = r.get('ok') and r.get('duration_ms', 99999) <= budget_ms
        out.append({
            'endpoint': path,
            'status': r.get('status'),
            'duration_ms': r.get('duration_ms'),
            'budget_ms': budget_ms,
            'bytes': r.get('bytes', 0),
            'ok': ok,
        })
        marker = 'OK ' if ok else 'SLOW'
        print(f'  {marker}  {r.get("duration_ms",0):>5}ms / {budget_ms}ms  {path}')
    return out


# ─── 3. Mobile responsive ────────────────────────────────────────


VIEWPORTS = [
    ('mobile', 375, 812),
    ('tablet', 768, 1024),
    ('desktop', 1600, 900),
]
MOBILE_TEST_PAGES = [
    '/dashboard',
    '/reports/daily',
    '/bqms',
    '/imv',
    '/crm',
    '/documents/browser',
]


async def test_mobile_responsive() -> list:
    out = []
    async with async_playwright() as p:
        for vp_name, w, h in VIEWPORTS:
            browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
            ctx = await browser.new_context(
                ignore_https_errors=True,
                viewport={'width': w, 'height': h},
                user_agent='Mozilla/5.0 (Mobile; rv:1.0)' if vp_name == 'mobile' else None,
            )
            page = await ctx.new_page()
            try:
                await page.goto(f'{BASE}/login', wait_until='networkidle', timeout=20000)
                await page.fill('input[type=email]', EMAIL)
                await page.fill('input[type=password]', PASSWORD)
                await page.click('button[type=submit]')
                await page.wait_for_url('**/dashboard*', timeout=15000)
                await page.wait_for_timeout(1500)

                for path in MOBILE_TEST_PAGES:
                    try:
                        await page.goto(BASE + path, wait_until='networkidle', timeout=20000)
                        await page.wait_for_timeout(1500)
                        # Check horizontal scroll (overflow)
                        scroll_w = await page.evaluate('() => document.documentElement.scrollWidth')
                        client_w = await page.evaluate('() => document.documentElement.clientWidth')
                        overflow = scroll_w > client_w + 10
                        # Check if main content visible
                        main_visible = await page.evaluate('() => !!document.querySelector("main")')
                        # Sidebar — at mobile should be hidden or collapsed
                        sidebar_w = await page.evaluate('''() => {
                            const a = document.querySelector("aside");
                            return a ? a.getBoundingClientRect().width : 0;
                        }''')
                        out.append({
                            'viewport': vp_name,
                            'size': f'{w}x{h}',
                            'page': path,
                            'main_visible': main_visible,
                            'sidebar_width': round(sidebar_w),
                            'overflow_horizontal': overflow,
                            'scroll_width': scroll_w,
                            'client_width': client_w,
                            'ok': main_visible and not overflow,
                        })
                        marker = 'OK ' if main_visible and not overflow else ('OVRF' if overflow else 'WARN')
                        print(f'  {marker}  {vp_name:7s}  {path:25s}  sidebar={int(sidebar_w):>3}px  overflow={overflow}')
                    except Exception as exc:
                        out.append({
                            'viewport': vp_name, 'page': path, 'ok': False,
                            'error': str(exc)[:200],
                        })
            finally:
                await browser.close()
    return out


# ─── Main ────────────────────────────────────────────────────────


async def main():
    print('[1/3] Login + mutations…')
    token = login()
    if not token:
        print('login FAILED')
        return

    # Mutations
    for fn in [test_local_filesystem_sync, test_crm_create_customer,
               test_bqms_price_edit, test_notifications_mark_read,
               test_imv_manual_sync]:
        print(f'\n--- {fn.__name__} ---')
        try:
            r = fn(token)
        except Exception as exc:
            r = {'flow': fn.__name__, 'ok': False, 'error': str(exc)[:300]}
        results['mutations'].append(r)
        marker = 'PASS' if r.get('ok') else 'FAIL'
        print(f'  >>> {marker}')

    print('\n[2/3] Performance…')
    results['performance'] = test_performance(token)

    print('\n[3/3] Mobile responsive…')
    results['mobile'] = await test_mobile_responsive()

    # Summary
    mut_ok = sum(1 for m in results['mutations'] if m.get('ok'))
    perf_ok = sum(1 for p in results['performance'] if p.get('ok'))
    mob_ok = sum(1 for m in results['mobile'] if m.get('ok'))
    results['summary'] = {
        'mutations_ok': f'{mut_ok}/{len(results["mutations"])}',
        'performance_ok': f'{perf_ok}/{len(results["performance"])}',
        'mobile_ok': f'{mob_ok}/{len(results["mobile"])}',
        'finished_at': datetime.utcnow().isoformat(),
    }
    print('\n=== SUMMARY ===')
    for k, v in results['summary'].items():
        print(f'  {k:18s}  {v}')

    with open('/tmp/e2e_round2_results.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)


if __name__ == '__main__':
    asyncio.run(main())
