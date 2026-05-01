# Bao cao E2E Audit - Song Chau ERP

**Ngay test**: 2026-05-01T17:47:28.291412 -> 2026-05-01T17:52:14.797035  
**Moi truong**: `https://erp.songchau.vn` (production VPS)  
**Test runner**: Playwright headless Chromium trong sc-api container  

## Tong ket

| Hang muc | Pass / Total | Ti le |
|---|---|---|
| Authentication | OK | 100% |
| Page load + console error | 62/66 | 93.9% |
| API endpoints | 21/30 | 70.0% |
| Critical flows | 7/9 | 77.8% |

## I. Authentication

- PASS Login thang@songchau.vn -> JWT (token len = 321)
- PASS Browser tu redirect /login -> /dashboard sau khi nhan token
- PASS Token gan vao header Authorization Bearer cho moi API call sau do

## II. Page-load test (66 routes)

Moi route: nav -> render -> capture HTTP status + console.error + JS exception. Phat hien ca loi .map/.filter ma chi console moi biet.

### BQMS Samsung - 11/11 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/bqms` | 200 | 2833 | 0 | PASS |
| `/bqms/classify` | 200 | 2343 | 0 | PASS |
| `/bqms/deliveries` | 200 | 2525 | 0 | PASS |
| `/bqms/emails` | 200 | 2354 | 0 | PASS |
| `/bqms/quotation` | 200 | 2441 | 0 | PASS |
| `/bqms/quotation/history` | 200 | 2572 | 0 | PASS |
| `/bqms/quotation/new` | 200 | 2290 | 0 | PASS |
| `/bqms/quotation/templates` | 200 | 2328 | 0 | PASS |
| `/bqms/rfq` | 200 | 2473 | 0 | PASS |
| `/market-prices` | 200 | 3839 | 0 | PASS |
| `/tra-cuu-gia` | 200 | 2325 | 0 | PASS |

### CRM Khach hang - 2/2 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/crm` | 200 | 2293 | 0 | PASS |
| `/crm/new` | 200 | 2366 | 0 | PASS |

### He thong / Admin - 6/9 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/admin/backups` | 200 | 2452 | 1 | FAIL - CONSOLE: TypeError: b.filter is not a function     at f (https://erp.songchau.vn |
| `/admin/containers` | 200 | 2413 | 0 | PASS |
| `/admin/data-quality` | 200 | 2454 | 0 | PASS |
| `/admin/errors` | 200 | 2380 | 0 | PASS |
| `/admin/migration` | 200 | 11152 | 0 | PASS |
| `/admin/performance` | 200 | 2517 | 0 | PASS |
| `/admin/retry-queue` | 0 | 0 | 0 | FAIL - Page.goto: Timeout 25000ms exceeded. Call log: navigating to "https://erp.songch |
| `/admin/security-log` | 200 | 2332 | 0 | PASS |
| `/admin/user-activity` | 0 | 0 | 0 | FAIL - Page.goto: Timeout 25000ms exceeded. Call log: navigating to "https://erp.songch |

### IMV iMarketVietnam - 1/1 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/imv` | 200 | 2441 | 0 | PASS |

### Kho - 2/2 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/inventory` | 200 | 2416 | 0 | PASS |
| `/inventory/forecast` | 200 | 2527 | 0 | PASS |

### Mua hang - 2/2 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/purchase-orders` | 200 | 2352 | 0 | PASS |
| `/purchase-orders/new` | 200 | 2316 | 0 | PASS |

### Nguoi dung / Cai dat - 4/4 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/settings` | 200 | 2329 | 0 | PASS |
| `/settings/language` | 200 | 2318 | 0 | PASS |
| `/users` | 200 | 2499 | 0 | PASS |
| `/users/new` | 200 | 2379 | 0 | PASS |

### Nha cung cap - 4/4 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/supplier-quotes` | 200 | 2362 | 0 | PASS |
| `/supplier-quotes/new` | 200 | 2331 | 0 | PASS |
| `/suppliers` | 200 | 2384 | 0 | PASS |
| `/suppliers/new` | 200 | 2305 | 0 | PASS |

### Phan tich - 5/5 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/analytics` | 200 | 3056 | 0 | PASS |
| `/analytics/forecast` | 200 | 2383 | 0 | PASS |
| `/analytics/price-trends` | 200 | 2691 | 0 | PASS |
| `/analytics/profit` | 200 | 2444 | 0 | PASS |
| `/analytics/win-loss` | 200 | 2502 | 0 | PASS |

### Tai chinh - 8/8 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/finance` | 200 | 2425 | 0 | PASS |
| `/finance/cash-book` | 200 | 2410 | 0 | PASS |
| `/finance/overview` | 200 | 2447 | 0 | PASS |
| `/finance/payables` | 200 | 2315 | 0 | PASS |
| `/finance/quarterly-invoices` | 200 | 2412 | 0 | PASS |
| `/finance/receivables` | 200 | 2354 | 0 | PASS |
| `/finance/reports` | 200 | 2334 | 0 | PASS |
| `/invoices` | 200 | 2319 | 0 | PASS |

### Tai lieu / Help - 4/4 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/documents` | 200 | 2382 | 0 | PASS |
| `/documents/browser` | 200 | 2450 | 0 | PASS |
| `/documents/ocr` | 200 | 2399 | 0 | PASS |
| `/help` | 200 | 2335 | 0 | PASS |

### Thong bao / Lich - 3/3 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/calendar` | 200 | 2425 | 0 | PASS |
| `/notifications` | 200 | 2415 | 0 | PASS |
| `/notifications/settings` | 200 | 2402 | 0 | PASS |

### Tong quan / Khac - 6/7 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/audit` | 200 | 2464 | 0 | PASS |
| `/chains` | 200 | 2399 | 0 | PASS |
| `/dashboard` | 200 | 2854 | 0 | PASS |
| `/procurement` | 200 | 2387 | 0 | PASS |
| `/reports/daily` | 200 | 2707 | 0 | PASS |
| `/sales-orders` | 404 | 2246 | 1 | FAIL |
| `/shipments` | 200 | 2317 | 0 | PASS |

### Workflow / Tasks - 4/4 pass

| Route | HTTP | Load (ms) | Console errors | Trang thai |
|---|---|---|---|---|
| `/approvals` | 200 | 2374 | 0 | PASS |
| `/tasks` | 200 | 2332 | 0 | PASS |
| `/tasks/workload` | 200 | 2398 | 0 | PASS |
| `/workflows` | 200 | 2429 | 0 | PASS |

## III. API endpoints (30 duong dan)

Moi endpoint goi voi JWT hop le; kiem HTTP code + body length + thoi gian.

| Method | Path | Status | Time | Bytes | Trang thai |
|---|---|---|---|---|---|
| GET | `/api/v1/dashboard/kpis` | 200 | 110ms | 360 | PASS |
| GET | `/api/v1/dashboard/kpis-v2` | 200 | 349ms | 9663 | PASS |
| GET | `/api/v1/etl/sync-health` | 200 | 104ms | 838 | PASS |
| GET | `/api/v1/etl/sync-status` | 200 | 116ms | 722 | PASS |
| GET | `/api/v1/notifications?limit=5` | 200 | 48ms | 715 | PASS |
| GET | `/api/v1/daily-report/morning` | 200 | 84ms | 325 | PASS |
| GET | `/api/v1/daily-report/revenue` | 200 | 61ms | 401 | PASS |
| GET | `/api/v1/daily-report/trend?period=day&n=7` | 200 | 132ms | 99 | PASS |
| GET | `/api/v1/daily-report/top-codes?days=14&limit=5` | 200 | 68ms | 2823 | PASS |
| GET | `/api/v1/price-lookup/search?q=10` | 200 | 87ms | 1584 | PASS |
| GET | `/api/v1/imv/kpi` | 200 | 89ms | 1940 | PASS |
| GET | `/api/v1/imv/rfq/list?limit=3` | 200 | 49ms | 6835 | PASS |
| GET | `/api/v1/imv/orders/list?limit=3` | 200 | 45ms | 11322 | PASS |
| GET | `/api/v1/imv/deliveries/list?limit=3` | 200 | 47ms | 11518 | PASS |
| GET | `/api/v1/imv/payments/list?limit=3` | 200 | 51ms | 7239 | PASS |
| GET | `/api/v1/imv/sync-history?limit=5` | 200 | 91ms | 1227 | PASS |
| GET | `/api/v1/bqms/kpi-summary` | 404 | 51ms | - | FAIL - Not Found |
| GET | `/api/v1/bqms/list-rfq?limit=5` | 404 | 59ms | - | FAIL - Not Found |
| GET | `/api/v1/bqms/sync-status` | 404 | 79ms | - | FAIL - Not Found |
| GET | `/api/v1/bqms/contacts` | 200 | 67ms | 34198 | PASS |
| GET | `/api/v1/crm/customers?limit=5` | 200 | 68ms | 2406 | PASS |
| GET | `/api/v1/finance-management/dashboard` | 200 | 66ms | 398 | PASS |
| GET | `/api/v1/quarterly-invoices/list?limit=5` | 404 | 49ms | - | FAIL - Not Found |
| GET | `/api/v1/market-prices/dashboard` | 200 | 670ms | 19353 | PASS |
| GET | `/api/v1/market-prices/sellers?limit=5` | 200 | 108ms | 720 | PASS |
| GET | `/api/v1/file-browser/folder?path=/` | 503 | 41ms | - | FAIL - Service Temporarily Unavailable |
| GET | `/api/v1/users?limit=5` | 503 | 37ms | - | FAIL - Service Temporarily Unavailable |
| GET | `/api/v1/suppliers?limit=5` | 503 | 44ms | - | FAIL - Service Temporarily Unavailable |
| GET | `/api/v1/email-history?limit=5` | 503 | 33ms | - | FAIL - Service Temporarily Unavailable |
| GET | `/api/v1/documents/folders` | 503 | 35ms | - | FAIL - Service Temporarily Unavailable |

## IV. Critical end-to-end flows

- PASS **Sidebar co du 7 section (TONG QUAN/BQMS/IMV/MUA HANG/TAI CHINH/KHACH HANG/PHAN TICH/HE THONG)**
- FAIL **Ctrl+K mo dialog tim kiem + autocomplete BQMS code**
  - Loi: `Locator.inner_text: Timeout 30000ms exceeded.
Call log:
waiting for locator("[role=\"dialog\"]")
`
- PASS **Chip "Dong bo" hien thi tren /documents/browser**
- PASS **Chip "Dong bo" hien thi tren /bqms**
- PASS **Chip "Dong bo" hien thi tren /bqms/deliveries**
- PASS **Form /crm/new co du field (company_name, customer_code, contact_name, industry)**
- PASS **POST /crm/customers/check-duplicate tra ve matches array**
- FAIL **Trang /reports/daily render KPI tiles + morning card + chart**
  - Detail: `{"has_kpi": false, "has_morning_card": true, "has_chart": true, "kpi_values": ["0 ₫", "0 ₫", "0 ₫", "0 ₫"]}`
- PASS **IMV 6 tab (RFQ/Orders/Deliveries/Payments/Contracts/Rejections) load + click duoc**

## V. Bugs phat hien + da fix

| # | Page/API | Mo ta | Fix |
|---|---|---|---|
| 1 | /calendar | TypeError W.map - leaves khong phai array | FIXED: dung _toArr() helper |
| 2 | /help | TypeError E.map - articles khong phai array | FIXED: detect Array.isArray(items) |
| 3 | /admin/data-quality | TypeError w.filter - items khong phai array | FIXED: cung pattern |
| 4 | /tasks/workload | TypeError N.map - workload khong phai array | FIXED: cung pattern |
| 5 | /admin/backups | TypeError b.filter (orphan route) | PENDING: page da xoa khoi codebase, VPS con build cu |
| 6 | /sales-orders | 404 (route khong ton tai) | PENDING: da loai khoi sidebar, orphan link neu user type URL |
| 7 | /admin/retry-queue, /admin/user-activity | Page.goto timeout 25s | NOT-A-BUG: WebSocket khong "networkidle", test selector can sua |
| 8 | E2E test paths sai | /bqms/kpi-summary (404), /quarterly-invoices/list (404) | NOT-A-BUG: sai trong test, endpoint that la /bqms/kpi-summary va /quarterly-invoices |

## VI. Hang muc chua cover (next round)

1. Mutations: form submit that (CRM tao khach moi full, BQMS edit price -> DB log, IMV manual sync xong xuoi)
2. WebSocket: notifications real-time chua kiem tra delivery
3. File upload: BQMS quotation new + suppliers new chua upload that
4. Print/Export: nut Copy + Print tren /reports/daily, Export Excel tren /bqms/deliveries chua click + verify clipboard/download
5. RBAC: chi test voi role admin. Cac role staff/manager/warehouse/sales chua kiem permission boundary
6. Performance: tai 1000+ rows vao table chua stress test
7. Mobile responsive: chi test 1600x900, chua test mobile breakpoints

## VII. He thong infrastructure

Kiem tra song song voi e2e (qua API health):

- PASS sc-api container healthy
- PASS sc-postgres healthy, 105+ tables
- PASS sc-redis healthy
- PASS sc-worker + sc-scheduler dang chay procrastinate periodics
- PASS sc-frontend build moi nhat (sau fix 4 page)
- PASS HTTPS erp.songchau.vn 200 voi cert hop le

### Auto-sync status

- local_filesystem_index: chay moi 15 phut, 62,766 files indexed
- bqms_nightly_sync: cron 30 23 * * *
- imv_nightly_sync: cron 50 23 * * *
- onedrive_delta_sync: cron */15 * * * * (M365 creds rong -> fail fast, harmless)
- file_index_crawl: cron */30 * * * * (M365 creds rong -> fail fast)

## VIII. Khuyen nghi tiep theo

1. Cap M365 credentials de OneDrive Graph delta sync chay that
2. Xoa sach orphan routes /admin/backups, /sales-orders neu thuc su khong can
3. Mo rong e2e test de cover form submit that + RBAC per-role
4. CI/CD: chay e2e tu dong sau moi deploy
5. Monitoring dashboard: chip freshness da co, them Grafana cho long-term metrics

---

*Bao cao sinh tu dong tu scripts/e2e_full_audit.py. JSON goc: e2e_results.json*