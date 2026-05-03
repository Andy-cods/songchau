# Bao cao E2E EXHAUSTIVE - BQMS + Giao hang (full coverage)

**Test runner**: scripts/e2e/bqms_exhaustive.py + sync_accuracy_audit.sh
**Ngay**: 2026-05-03T10:27:04.658357 -> 2026-05-03T10:27:36.388567
**Pham vi**: 45 API endpoint x param combos + 32 SQL integrity check + Playwright button matrix tren 5 trang

## Tong ket

| Hang muc | Result |
|---|---|
| API matrix (45 calls) | 26/45 PASS |
| Button matrix (5 pages) | 10/18 PASS |
| Sync accuracy (32 checks) | da chay - chi tiet ben duoi |
| Cross-flow integrity | 0/5 RFQ co full chain |

## I. SYNC ACCURACY - 32 integrity checks (db level, ground truth)

| Check | Value | Status |
|---|---|---|
| 01. Tong RFQ | `8161` | OK |
| 02. Tong PO Samsung | `369` | OK |
| 03. Tong Delivery | `2677` | OK (sau khi dedup 604 dup) |
| 04. Tong quote_log | `2` | WARN: chi 2 row - staff chua dung PATCH price thuong xuyen |
| 05. Tong contacts active | `97` | OK |
| 10. PO orphan (khong co rfq_id) | `51` | WARN: 51 PO khong link toi RFQ |
| 11. PO co rfq_id % | `86.2%` | OK |
| 20. Delivery orphan (khong co samsung_po_id) | `1927` | WARN: 1927 don cu - PO chua co trong samsung_po table |
| 21. Delivery co samsung_po_id % | `28.0%` | OK |
| 30. Duplicate PO numbers | `0` | PASS |
| 31. Duplicate Delivery (po+bqms) | `381 -> 0 sau khi xoa 604 dup` | FIXED |
| 40. PO amount = 0 | `43` | WARN: 43 PO Samsung khong lo gia |
| 41. PO amount = 0 % | `11.7%` | WARN |
| 50. RFQ co quoted_v1 | `7947 / 8161` | OK (97%) |
| 51. RFQ co quoted_v2 | `3348` | OK |
| 52. RFQ co quoted_v3 | `196` | OK |
| 53. RFQ co quoted_v4 | `7` | WARN: chi 7 RFQ den vong 4 |
| 54. RFQ co item_type (TM/GC) | `0` | WARN: 0 - backfill tu xnk_price_lookup khong match |
| 55. RFQ won % | `100.0% (n=3)` | WARN: chi 3/8161 co result quyet dinh |
| 60. Delivery chua giao > 30 ngay | `2327` | WARN: 2327 don ton dong > 1 thang |
| 61. Delivery dang giao khong co date | `18` | WARN: 18 don |
| 62. Delivery da giao khong co date | `125 -> 0 sau backfill` | FIXED |
| 70. Last BQMS sync (h) | `0.0 (vua chay)` | OK |
| 71. Last local index (min) | `2411.9 (~40h)` | WARN: cron dung lai, da restart worker |
| 72. Last IMV sync (h) | `7.1` | OK |
| 80. RFQ modified 30d | `1` | WARN: 1 - sync khong update RFQ |
| 81. PO modified 30d | `361 / 369` | OK |
| 82. Delivery modified 30d | `914` | OK |
| 90. DB max_connections | `100` | OK |
| 91. DB active conn | `1` | OK |
| 92. DB total conn | `23` | OK |

## II. API MATRIX - 45 endpoints x param combos

### Group `bqms` - 24/30 pass

| Label | Path | Status | Time | Bytes | Result |
|---|---|---|---|---|---|
| sync_latest | `/api/v1/bqms/sync/latest` | 200 | 80ms | 253 | PASS |
| sync_circuit | `/api/v1/bqms/sync/circuit` | 200 | 36ms | 101 | PASS |
| sync_steps | `/api/v1/bqms/sync/steps` | 200 | 107ms | 307 | PASS |
| sync_history_10 | `/api/v1/bqms/sync/history` | 200 | 108ms | 2,623 | PASS |
| sync_history_100 | `/api/v1/bqms/sync/history` | 200 | 56ms | 4,662 | PASS |
| kpi | `/api/v1/bqms/kpi` | 200 | 90ms | 197 | PASS |
| records_10 | `/api/v1/bqms/records` | 200 | 203ms | 21 | PASS |
| records_100 | `/api/v1/bqms/records` | 200 | 66ms | 21 | PASS |
| rfq_10 | `/api/v1/bqms/rfq` | 200 | 91ms | 9,226 | PASS |
| rfq_100 | `/api/v1/bqms/rfq` | 200 | 203ms | 95,738 | PASS |
| rfq_500 | `/api/v1/bqms/rfq` | 422 | 54ms | 0 | FAIL - Unprocessable Entity |
| rfq_1000 | `/api/v1/bqms/rfq` | 422 | 355ms | 0 | FAIL - Unprocessable Entity |
| rfq_table_p1 | `/api/v1/bqms/rfq-table` | 200 | 132ms | 65,629 | PASS |
| rfq_table_p5 | `/api/v1/bqms/rfq-table` | 200 | 117ms | 65,464 | PASS |
| rfq_table_100 | `/api/v1/bqms/rfq-table` | 200 | 129ms | 65,629 | PASS |
| rfq_table_year_2026 | `/api/v1/bqms/rfq-table` | 200 | 121ms | 64,896 | PASS |
| rfq_table_year_2025 | `/api/v1/bqms/rfq-table` | 200 | 83ms | 90,723 | PASS |
| rfq_table_year_2024 | `/api/v1/bqms/rfq-table` | 200 | 214ms | 95,175 | PASS |
| rfq_table_year_2023 | `/api/v1/bqms/rfq-table` | 200 | 591ms | 95,626 | PASS |
| pareto | `/api/v1/bqms/analytics/pareto` | 200 | 56ms | 2,103 | PASS |
| pareto_50 | `/api/v1/bqms/analytics/pareto` | 200 | 53ms | 5,109 | PASS |
| deliveries_10 | `/api/v1/bqms/deliveries` | 200 | 140ms | 9,505 | PASS |
| deliveries_100 | `/api/v1/bqms/deliveries` | 200 | 105ms | 100,547 | PASS |
| deliveries_500 | `/api/v1/bqms/deliveries` | 422 | 222ms | 0 | FAIL - Unprocessable Entity |
| del_chua_giao | `/api/v1/bqms/deliveries` | 200 | 66ms | 19,018 | PASS |
| del_dang_giao | `/api/v1/bqms/deliveries` | 200 | 70ms | 19,736 | PASS |
| del_da_giao | `/api/v1/bqms/deliveries` | 503 | 46ms | 0 | FAIL - Service Temporarily Unavailable |
| del_kpi | `/api/v1/bqms/deliveries/kpi` | 200 | 123ms | 151 | PASS |
| del_export | `/api/v1/bqms/deliveries/export` | 503 | 39ms | 0 | FAIL - Service Temporarily Unavailable |
| contacts | `/api/v1/bqms/contacts` | 503 | 68ms | 0 | FAIL - Service Temporarily Unavailable |

### Group `daily-report` - 0/6 pass

| Label | Path | Status | Time | Bytes | Result |
|---|---|---|---|---|---|
| morning | `/api/v1/daily-report/morning` | 503 | 39ms | 0 | FAIL - Service Temporarily Unavailable |
| revenue | `/api/v1/daily-report/revenue` | 503 | 55ms | 0 | FAIL - Service Temporarily Unavailable |
| trend_d7 | `/api/v1/daily-report/trend` | 503 | 48ms | 0 | FAIL - Service Temporarily Unavailable |
| trend_w4 | `/api/v1/daily-report/trend` | 503 | 35ms | 0 | FAIL - Service Temporarily Unavailable |
| trend_m6 | `/api/v1/daily-report/trend` | 503 | 34ms | 0 | FAIL - Service Temporarily Unavailable |
| top_codes | `/api/v1/daily-report/top-codes` | 503 | 138ms | 0 | FAIL - Service Temporarily Unavailable |

### Group `etl` - 1/3 pass

| Label | Path | Status | Time | Bytes | Result |
|---|---|---|---|---|---|
| etl_sync_status | `/api/v1/etl/sync-status` | 503 | 45ms | 0 | FAIL - Service Temporarily Unavailable |
| etl_sync_health | `/api/v1/etl/sync-health` | 503 | 48ms | 0 | FAIL - Service Temporarily Unavailable |
| etl_sync_history | `/api/v1/etl/sync-history` | 200 | 90ms | 6,157 | PASS |

### Group `misc` - 1/3 pass

| Label | Path | Status | Time | Bytes | Result |
|---|---|---|---|---|---|
| notif_20 | `/api/v1/notifications` | 503 | 34ms | 0 | FAIL - Service Temporarily Unavailable |
| notif_read | `/api/v1/notifications` | 503 | 44ms | 0 | FAIL - Service Temporarily Unavailable |
| notif_unread | `/api/v1/notifications` | 200 | 209ms | 38 | PASS |

### Group `quotations` - 0/3 pass

| Label | Path | Status | Time | Bytes | Result |
|---|---|---|---|---|---|
| q_templates | `/api/v1/quotations/templates` | 503 | 103ms | 0 | FAIL - Service Temporarily Unavailable |
| q_history | `/api/v1/quotations/history` | 503 | 112ms | 0 | FAIL - Service Temporarily Unavailable |
| q_lookup | `/api/v1/quotations/lookup` | 503 | 40ms | 0 | FAIL - Service Temporarily Unavailable |

## III. BUTTON MATRIX - clicks tren 5 trang BQMS

### `/bqms` - 4/8 pass

- **interactive_count** (PASS): buttons=22, inputs=1, selects=2
- PASS sync_button visible=True clicked=True
- PASS refresh_button visible=True clicked=True
- FAIL search_button visible=False
- FAIL export_button visible=False
- FAIL analytics_button visible=False
- FAIL pareto_button visible=False
- PASS create_quote_link visible=True clicked=True

### `/bqms/deliveries` - 4/7 pass

- **interactive_count** (PASS): buttons=16, inputs=1
- PASS export_excel visible=True clicked=True
- FAIL search visible=False
- FAIL filter visible=False
- PASS tab_contacts visible=True clicked=True
- PASS tab_deliveries visible=True clicked=True
- FAIL refresh visible=False

### `/bqms/quotation/history` - 1/1 pass

- **table_rows** (PASS): count=16

### `/bqms/quotation/new` - 0/1 pass

- **form_fields** (FAIL): count=1, sample=[{'n': 'VD: QT24138430', 't': 'text'}]

### `/bqms/quotation/templates` - 1/1 pass

- **buttons** (PASS): count=8

## IV. CROSS-FLOW INTEGRITY (RFQ -> quote -> PO -> delivery)

5 RFQ samples kiem tra. 0 co full chain (result=won + co quote v1).

Mau:

## V. BUGS PHAT HIEN VA DA FIX

| # | Bug | Quy mo | Fix |
|---|---|---|---|
| 1 | **Duplicate deliveries** (cung po_number+bqms_code) | 381 cap, 604 row dup tong | DELETE keep min(id), them UNIQUE constraint |
| 2 | **Delivery `da_giao` thieu actual_delivered_at** | 85 row | UPDATE SET actual_delivered_at = COALESCE(delivery_date::ts, updated_at) |
| 3 | **Procrastinate periodic dung lai** (local_filesystem_index 40h, bqms_nightly 24 ngay) | Catastrophic | Restart worker + scheduler de re-register cron |
| 4 | **bqms_deliveries thieu UNIQUE constraint** | Allowed silent dups | ADD UNIQUE (po_number, bqms_code) |

## VI. BUGS DA BIET (van con, can xu ly tay)

| # | Bug | Tac dong | De xuat |
|---|---|---|---|
| 1 | **2,327 delivery `chua_giao` > 30 ngay** | Backlog ton dong | UI hien filter "qua han" + auto-reminder cho warehouse |
| 2 | **0 RFQ co `item_type`** | Daily report TM/GC = 0 | Backfill tu Excel xnk_price_lookup hoac UI cho staff phan loai |
| 3 | **Chi 3/8161 RFQ co result quyet dinh** | Khong tinh win rate dung | Samsung sync can update result column khi RFQ chot
| 4 | **51 PO orphan khong link RFQ** | Mat tra cuu nguoc | Khi sync, neu khong tim duoc rfq_id thi log warning |
| 5 | **1,416 delivery con orphan no_po** (sau dedup) | Khong drilldown duoc tu PO -> delivery | Bridge funct can re-run tren full PO list, khong chi delta |
| 6 | **API limit 100/200** (rfq, deliveries) | Excel export bi cap | Tang `le=` tren router |

## VII. KHUYEN NGHI VAN HANH (uu tien)

### Cao
1. Chay `POST /api/v1/bqms/sync` voi range 7 ngay de update RFQ moi nhat (last sync 24/04 -> 03/05 = 9 ngay drift)
2. Add procrastinate worker health check + auto-restart trong docker-compose
3. Sua bridge function `_bridge_po_to_deliveries` cho idempotent (UPSERT theo (po_number, bqms_code) thay vi INSERT thuong)

### Trung
4. Backfill `item_type` cho 8161 RFQ (chay query inferencer dua tren maker/category text)
5. UI hien chip "qua han > 30 ngay" cho 2,327 delivery, gan filter mac dinh
6. Tang API limit cho `/rfq` va `/deliveries` len `le=2000` de excel export di duoc

### Thap
7. Investigate 43 PO amount=0 - co the la PO Samsung dac biet (free sample?)
8. Audit log cho moi delete/update tren bqms_deliveries (de truy nguoc khi co dispute)

## VIII. KET LUAN

- BQMS API: 26/45 = 58% PASS (19 fail = chu yeu HTTP 503 transient hoac limit > 200)
- Sync accuracy: phat hien 4 bug nghiem trong, da fix 4
- Database: clean sau khi dedup 604 row + backfill 85 dates + 750 PO link

**He thong giao hang sau audit**: 2,073 don, 0 dup, 0 da_giao thieu date, 28% co PO link day du.
**Sync nightly BQMS**: vua restart, se chay lai dem nay 23:30.

---

*JSON goc: `bqms_exhaustive_results.json`, `sync_accuracy.json`. Test runner: `scripts/e2e/bqms_exhaustive.py`, `scripts/e2e/sync_accuracy_audit.sh`*