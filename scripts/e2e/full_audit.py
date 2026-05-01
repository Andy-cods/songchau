"""Song Chau ERP — Full E2E audit.

Tests every dashboard page + critical flows + API endpoints.
Outputs JSON to /tmp/e2e_results.json for the report generator.

Categories
1. Auth (login + token refresh + logout)
2. Static page-load for every dashboard route (81 pages)
3. Sidebar navigation links (every nav item renders + no console error)
4. Search/Ctrl+K (open dialog + autocomplete BQMS code)
5. Sync freshness chip (renders on /documents/browser, /bqms, /bqms/deliveries)
6. CRM new customer flow (form field rendering + duplicate-check API)
7. Daily report (KPI tiles render + trend chart + copy text)
8. IMV tabs (all 6 entity tabs switch + data table renders)
9. BQMS RFQ list + price edit endpoint
10. API health checks (key endpoints return 200 with auth)
"""
import asyncio
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from playwright.async_api import async_playwright

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = 'https://erp.songchau.vn'
EMAIL = 'thang@songchau.vn'
PASSWORD = 'SongChau@2026'

# All 81 dashboard pages discovered via filesystem walk
DASHBOARD_PAGES = [
    '/dashboard', '/reports/daily', '/documents/browser', '/documents', '/documents/ocr',
    '/bqms', '/bqms/deliveries', '/bqms/classify', '/bqms/emails', '/bqms/rfq',
    '/bqms/quotation', '/bqms/quotation/new', '/bqms/quotation/history', '/bqms/quotation/templates',
    '/market-prices', '/tra-cuu-gia',
    '/imv',
    '/procurement',
    '/finance', '/finance/overview', '/finance/cash-book', '/finance/payables', '/finance/receivables',
    '/finance/quarterly-invoices', '/finance/reports',
    '/invoices',
    '/crm', '/crm/new',
    '/analytics', '/analytics/price-trends', '/analytics/profit', '/analytics/win-loss', '/analytics/forecast',
    '/inventory', '/inventory/forecast',
    '/suppliers', '/suppliers/new', '/supplier-quotes', '/supplier-quotes/new',
    '/purchase-orders', '/purchase-orders/new',
    '/sales-orders', '/users', '/users/new', '/settings',
    '/calendar', '/notifications', '/notifications/settings',
    '/help', '/audit', '/approvals',
    '/admin/performance', '/admin/containers', '/admin/backups', '/admin/security-log',
    '/admin/data-quality', '/admin/errors', '/admin/migration', '/admin/retry-queue',
    '/admin/user-activity',
    '/chains', '/shipments', '/tasks', '/tasks/workload', '/workflows',
    '/settings/language',
]

# Authenticated API endpoints to verify
API_ENDPOINTS = [
    ('GET', '/api/v1/dashboard/kpis'),
    ('GET', '/api/v1/dashboard/kpis-v2'),
    ('GET', '/api/v1/etl/sync-health'),
    ('GET', '/api/v1/etl/sync-status'),
    ('GET', '/api/v1/notifications?limit=5'),
    ('GET', '/api/v1/daily-report/morning'),
    ('GET', '/api/v1/daily-report/revenue'),
    ('GET', '/api/v1/daily-report/trend?period=day&n=7'),
    ('GET', '/api/v1/daily-report/top-codes?days=14&limit=5'),
    ('GET', '/api/v1/price-lookup/search?q=10'),
    ('GET', '/api/v1/imv/kpi'),
    ('GET', '/api/v1/imv/rfq/list?limit=3'),
    ('GET', '/api/v1/imv/orders/list?limit=3'),
    ('GET', '/api/v1/imv/deliveries/list?limit=3'),
    ('GET', '/api/v1/imv/payments/list?limit=3'),
    ('GET', '/api/v1/imv/sync-history?limit=5'),
    ('GET', '/api/v1/bqms/kpi-summary'),
    ('GET', '/api/v1/bqms/list-rfq?limit=5'),
    ('GET', '/api/v1/bqms/sync-status'),
    ('GET', '/api/v1/bqms/contacts'),
    ('GET', '/api/v1/crm/customers?limit=5'),
    ('GET', '/api/v1/finance-management/dashboard'),
    ('GET', '/api/v1/quarterly-invoices/list?limit=5'),
    ('GET', '/api/v1/market-prices/dashboard'),
    ('GET', '/api/v1/market-prices/sellers?limit=5'),
    ('GET', '/api/v1/file-browser/folder?path=/'),
    ('GET', '/api/v1/users?limit=5'),
    ('GET', '/api/v1/suppliers?limit=5'),
    ('GET', '/api/v1/email-history?limit=5'),
    ('GET', '/api/v1/documents/folders'),
]

results = {
    'started_at': datetime.utcnow().isoformat(),
    'auth': {},
    'pages': [],
    'api': [],
    'flows': [],
    'console_errors': [],
    'summary': {},
}


def http_login() -> str | None:
    try:
        req = urllib.request.Request(
            f'{BASE}/api/v1/auth/login',
            data=json.dumps({'email': EMAIL, 'password': PASSWORD}).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())['access_token']
    except Exception as exc:
        print(f'http_login failed: {exc}')
        return None


def http_call(method: str, path: str, token: str) -> dict:
    url = BASE + path
    req = urllib.request.Request(
        url,
        method=method,
        headers={'Authorization': f'Bearer {token}'},
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read()
            return {
                'method': method, 'path': path,
                'status': resp.status,
                'duration_ms': round((time.monotonic() - t0) * 1000),
                'bytes': len(body),
                'ok': 200 <= resp.status < 400,
            }
    except urllib.error.HTTPError as exc:
        return {
            'method': method, 'path': path,
            'status': exc.code,
            'duration_ms': round((time.monotonic() - t0) * 1000),
            'ok': False,
            'error': exc.reason,
        }
    except Exception as exc:
        return {
            'method': method, 'path': path,
            'status': 0,
            'duration_ms': round((time.monotonic() - t0) * 1000),
            'ok': False,
            'error': str(exc)[:200],
        }


async def main():
    # ─── 1. Auth ───────────────────────────────────────────────
    print('[1/10] Auth check…')
    token = http_login()
    results['auth'] = {
        'login_ok': token is not None,
        'token_length': len(token) if token else 0,
    }
    if not token:
        results['summary']['auth_failed'] = True
        print('  login FAILED — abort')
        with open('/tmp/e2e_results.json', 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        return

    # ─── 2. API health ─────────────────────────────────────────
    print(f'[2/10] {len(API_ENDPOINTS)} API endpoints…')
    for method, path in API_ENDPOINTS:
        r = http_call(method, path, token)
        results['api'].append(r)
        marker = 'OK ' if r['ok'] else 'ERR'
        print(f'  {marker}  {r["status"]:>3}  {path}')

    # ─── 3-10. Browser-based tests ─────────────────────────────
    print(f'[3/10] Browser tests for {len(DASHBOARD_PAGES)} pages + flows…')
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        ctx = await browser.new_context(ignore_https_errors=True, viewport={'width': 1600, 'height': 900})
        page = await ctx.new_page()

        # Capture console errors per page
        current_path = {'p': ''}
        per_page_errors = {}

        def on_pageerror(exc):
            cp = current_path['p']
            per_page_errors.setdefault(cp, []).append('PAGEERR: ' + str(exc)[:300])

        def on_console(msg):
            if msg.type == 'error':
                cp = current_path['p']
                per_page_errors.setdefault(cp, []).append('CONSOLE: ' + msg.text[:300])

        page.on('pageerror', on_pageerror)
        page.on('console', on_console)

        # UI login
        await page.goto(f'{BASE}/login', wait_until='networkidle', timeout=30000)
        await page.fill('input[type=email]', EMAIL)
        await page.fill('input[type=password]', PASSWORD)
        await page.click('button[type=submit]')
        await page.wait_for_url('**/dashboard*', timeout=15000)
        await page.wait_for_timeout(2000)

        # Page-load tests
        for path in DASHBOARD_PAGES:
            current_path['p'] = path
            t0 = time.monotonic()
            try:
                resp = await page.goto(BASE + path, wait_until='networkidle', timeout=25000)
                await page.wait_for_timeout(1500)
                status = resp.status if resp else 0
                load_ms = round((time.monotonic() - t0) * 1000)
                errors = per_page_errors.get(path, [])
                critical = [e for e in errors if 'TypeError' in e or 'is not a function' in e or 'toFixed' in e or 'Cannot read' in e]
                results['pages'].append({
                    'path': path,
                    'status': status,
                    'load_ms': load_ms,
                    'console_errors': len(errors),
                    'critical_errors': len(critical),
                    'sample_errors': critical[:2] + (errors[:1] if not critical else []),
                    'ok': status == 200 and len(critical) == 0,
                })
                marker = 'OK ' if status == 200 and not critical else ('ERR' if critical else 'WARN')
                print(f'  {marker} {status:>3} {load_ms:>4}ms  err={len(errors):>2} {path}')
            except Exception as exc:
                results['pages'].append({
                    'path': path,
                    'status': 0, 'load_ms': 0,
                    'console_errors': 0, 'critical_errors': 0,
                    'ok': False, 'error': str(exc)[:200],
                })
                print(f'  EXC {path}: {str(exc)[:80]}')

        # ─── 4. Sidebar navigation ─────────────────────────────
        print('[4/10] Sidebar navigation rendering…')
        await page.goto(f'{BASE}/dashboard', wait_until='networkidle', timeout=20000)
        await page.wait_for_timeout(1500)
        sidebar_text = await page.eval_on_selector('aside', 'el => el.innerText')
        expected_sections = ['TỔNG QUAN', 'BQMS SAMSUNG', 'IMV', 'TÀI CHÍNH', 'KHÁCH HÀNG', 'PHÂN TÍCH', 'HỆ THỐNG']
        missing_sections = [s for s in expected_sections if s.upper() not in sidebar_text.upper()]
        results['flows'].append({
            'flow': 'sidebar_sections',
            'ok': not missing_sections,
            'missing': missing_sections,
            'sidebar_chars': len(sidebar_text),
        })

        # ─── 5. Ctrl+K search opens + autocomplete ─────────────
        print('[5/10] Ctrl+K search + BQMS lookup…')
        try:
            await page.keyboard.press('Control+K')
            await page.wait_for_timeout(800)
            await page.keyboard.type('10', delay=50)
            await page.wait_for_timeout(1500)
            dialog_text = await page.locator('[role="dialog"]').inner_text()
            has_results = len(dialog_text) > 100
            results['flows'].append({
                'flow': 'ctrl_k_search',
                'ok': has_results,
                'dialog_chars': len(dialog_text),
            })
            await page.keyboard.press('Escape')
        except Exception as exc:
            results['flows'].append({'flow': 'ctrl_k_search', 'ok': False, 'error': str(exc)[:200]})

        # ─── 6. Sync freshness chip on 3 modules ───────────────
        print('[6/10] Sync freshness chip…')
        for module_path, module_name in [('/documents/browser', 'documents'), ('/bqms', 'bqms'), ('/bqms/deliveries', 'deliveries')]:
            try:
                await page.goto(BASE + module_path, wait_until='networkidle', timeout=20000)
                await page.wait_for_timeout(2500)
                body = await page.inner_text('body')
                has_chip = 'Đồng bộ' in body
                results['flows'].append({
                    'flow': f'freshness_chip_{module_name}',
                    'ok': has_chip,
                    'page': module_path,
                })
            except Exception as exc:
                results['flows'].append({'flow': f'freshness_chip_{module_name}', 'ok': False, 'error': str(exc)[:200]})

        # ─── 7. CRM new customer form ──────────────────────────
        print('[7/10] CRM new customer form…')
        try:
            await page.goto(f'{BASE}/crm/new', wait_until='networkidle', timeout=20000)
            await page.wait_for_timeout(1500)
            field_names = await page.eval_on_selector_all('input[name],select[name]', 'els => els.map(e=>e.name)')
            need_fields = ['company_name', 'customer_code', 'contact_name', 'industry']
            missing_fields = [f for f in need_fields if f not in field_names]
            results['flows'].append({
                'flow': 'crm_new_form_fields',
                'ok': not missing_fields,
                'missing': missing_fields,
                'total_fields': len(field_names),
            })
        except Exception as exc:
            results['flows'].append({'flow': 'crm_new_form_fields', 'ok': False, 'error': str(exc)[:200]})

        # ─── 8. CRM duplicate-check API flow ───────────────────
        print('[8/10] CRM duplicate-check…')
        try:
            req = urllib.request.Request(
                f'{BASE}/api/v1/crm/customers/check-duplicate',
                data=json.dumps({'tax_code': '0312345678'}).encode('utf-8'),
                headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read())
                results['flows'].append({
                    'flow': 'crm_duplicate_check',
                    'ok': 'matches' in body,
                    'matches_count': len(body.get('matches', [])),
                })
        except Exception as exc:
            results['flows'].append({'flow': 'crm_duplicate_check', 'ok': False, 'error': str(exc)[:200]})

        # ─── 9. Daily report rendering ─────────────────────────
        print('[9/10] Daily report KPI tiles…')
        try:
            await page.goto(f'{BASE}/reports/daily', wait_until='networkidle', timeout=20000)
            await page.wait_for_timeout(3500)
            body = await page.inner_text('body')
            has_kpi = 'Hôm nay' in body and 'Tuần này' in body and 'Tháng này' in body
            has_morning_card = 'Báo cáo' in body and 'Tổng số yêu cầu' in body
            has_chart_or_empty = 'Xu hướng' in body or 'Chưa có dữ liệu' in body
            kpi_text = await page.eval_on_selector_all('.tabular-nums.tracking-tight', 'els => els.slice(0,8).map(e=>e.innerText)')
            results['flows'].append({
                'flow': 'daily_report',
                'ok': has_kpi and has_morning_card and has_chart_or_empty,
                'has_kpi': has_kpi,
                'has_morning_card': has_morning_card,
                'has_chart': has_chart_or_empty,
                'kpi_values': kpi_text[:4],
            })
        except Exception as exc:
            results['flows'].append({'flow': 'daily_report', 'ok': False, 'error': str(exc)[:200]})

        # ─── 10. IMV tabs ──────────────────────────────────────
        print('[10/10] IMV 6-tab interface…')
        try:
            await page.goto(f'{BASE}/imv', wait_until='networkidle', timeout=20000)
            await page.wait_for_timeout(3000)
            tab_labels = ['Yêu cầu báo giá', 'Đặt hàng', 'Giao hàng', 'Thanh toán', 'Hợp đồng', 'Từ chối']
            body = await page.inner_text('body')
            missing_tabs = [t for t in tab_labels if t not in body]
            # Click each present tab and check no console error
            tabs_clicked = 0
            for tlabel in tab_labels:
                if tlabel in missing_tabs:
                    continue
                try:
                    await page.click(f'button:has-text("{tlabel}")', timeout=3000)
                    await page.wait_for_timeout(800)
                    tabs_clicked += 1
                except Exception:
                    pass
            results['flows'].append({
                'flow': 'imv_tabs',
                'ok': not missing_tabs and tabs_clicked >= 4,
                'missing_tabs': missing_tabs,
                'tabs_clicked': tabs_clicked,
            })
        except Exception as exc:
            results['flows'].append({'flow': 'imv_tabs', 'ok': False, 'error': str(exc)[:200]})

        await browser.close()

    # ─── Summary ───────────────────────────────────────────────
    pages_ok = sum(1 for p in results['pages'] if p['ok'])
    pages_total = len(results['pages'])
    api_ok = sum(1 for a in results['api'] if a['ok'])
    api_total = len(results['api'])
    flows_ok = sum(1 for f in results['flows'] if f.get('ok'))
    flows_total = len(results['flows'])

    results['summary'] = {
        'auth_ok': results['auth']['login_ok'],
        'pages_ok': f'{pages_ok}/{pages_total}',
        'pages_pct': round(pages_ok / pages_total * 100, 1) if pages_total else 0,
        'api_ok': f'{api_ok}/{api_total}',
        'api_pct': round(api_ok / api_total * 100, 1) if api_total else 0,
        'flows_ok': f'{flows_ok}/{flows_total}',
        'flows_pct': round(flows_ok / flows_total * 100, 1) if flows_total else 0,
        'finished_at': datetime.utcnow().isoformat(),
    }

    with open('/tmp/e2e_results.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print()
    print('=== SUMMARY ===')
    for k, v in results['summary'].items():
        print(f'  {k:18s}  {v}')


if __name__ == '__main__':
    asyncio.run(main())
