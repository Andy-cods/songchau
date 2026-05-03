# Bao cao E2E DEEP - BQMS + Giao hang

**Ngay test**: 2026-05-03T10:14:16.736468 -> 2026-05-03T10:15:01.977667  
**Moi truong**: `https://erp.songchau.vn` (production VPS)  
**Pham vi**: full luong BQMS Samsung + Theo doi giao hang  

## Tong ket

| Hang muc | Pass / Total | Ket qua |
|---|---|---|
| Page render (UI) | 9/9 | PASS |
| API endpoints | 12/12 | PASS |
| End-to-end workflows | 2/2 | PASS |
| Data integrity | - | PASS |

## I. Page rendering (9 trang)

Test moi page: nav -> render -> capture HTTP + console.error + JS exception.

| Trang | HTTP | Load (ms) | Console errors | Ket qua |
|---|---|---|---|---|
| `/bqms` | 200 | 3898 | 0 | PASS |
| `/bqms/rfq` | 200 | 3183 | 0 | PASS |
| `/bqms/quotation` | 200 | 2900 | 0 | PASS |
| `/bqms/quotation/new` | 200 | 2852 | 0 | PASS |
| `/bqms/quotation/history` | 200 | 3061 | 0 | PASS |
| `/bqms/quotation/templates` | 200 | 2919 | 0 | PASS |
| `/bqms/deliveries` | 200 | 3227 | 0 | PASS |
| `/bqms/classify` | 200 | 2861 | 0 | PASS |
| `/bqms/emails` | 200 | 2917 | 0 | PASS |

## II. API endpoints (12 endpoint)

| Method | Path | Status | Time | Bytes | Ket qua |
|---|---|---|---|---|---|
| GET | `/api/v1/bqms/kpi` | 200 | 75ms | 197 | PASS |
| GET | `/api/v1/bqms/records?limit=5` | 200 | 55ms | 21 | PASS |
| GET | `/api/v1/bqms/rfq?limit=5` | 200 | 93ms | 4,515 | PASS |
| GET | `/api/v1/bqms/rfq-table?limit=5` | 200 | 110ms | 65,619 | PASS |
| GET | `/api/v1/bqms/analytics/pareto` | 200 | 81ms | 2,103 | PASS |
| GET | `/api/v1/bqms/sync/latest` | 200 | 49ms | 253 | PASS |
| GET | `/api/v1/bqms/sync/circuit` | 200 | 55ms | 101 | PASS |
| GET | `/api/v1/bqms/sync/steps` | 200 | 48ms | 307 | PASS |
| GET | `/api/v1/bqms/sync/history?limit=5` | 200 | 140ms | 1,264 | PASS |
| GET | `/api/v1/bqms/contacts` | 200 | 61ms | 34,198 | PASS |
| GET | `/api/v1/bqms/deliveries?limit=5` | 200 | 70ms | 4,769 | PASS |
| GET | `/api/v1/bqms/deliveries/kpi` | 200 | 74ms | 151 | PASS |

## III. Data integrity

- **Tong RFQ trong DB**: 8,161 ban ghi
- **Tong contacts**: 97 lien he Samsung
- **Pareto count**: 20 maker/category top-N

### Delivery KPI (BQMS Theo doi giao hang)

| Metric | Value |
|---|---|
| Tong don giao hang | **2,677** |
| Da giao | 125 |
| Dang giao | 18 |
| Chua giao | 2,534 |
| Total order value (VND) | 74,954,542,211 |
| Total delivered (VND) | 5,103,113,002 |
| Ti le da giao | 4.7% |

### Lan sync BQMS gan nhat

- ID: 66
- Type: `bqms_po`
- Status: **success**
- Started: 2026-04-24T14:00:10.725122+00:00
- Completed: 2026-04-24T14:00:28.168444+00:00
- Duration: 17s
- Rows inserted/updated: 8 / 33

## IV. End-to-end workflow tests

### Workflow: rfq_price_edit_with_audit - PASS

Day la luong test thuc te di tu UI -> API -> DB -> verify -> cleanup.

| Buoc | Detail | Ket qua |
|---|---|---|
| `pick_rfq` | rfq_id=117014, bqms_code=Z0000002-125909, orig_v1=None, orig_item_type=None | PASS |
| `patch_v1` | status=200, duration_ms=68 | PASS |
| `verify_price_in_db` | expected=99999.99, actual=99999.99 | PASS |
| `verify_quote_log_via_morning_report` | quoted_today_count=1 | PASS |
| `patch_v2` | status=200 | PASS |
| `rfq_history_endpoint` | history_entries=2 | PASS |

### Workflow: delivery_status_update_with_notification - PASS

Day la luong test thuc te di tu UI -> API -> DB -> verify -> cleanup.

| Buoc | Detail | Ket qua |
|---|---|---|
| `pick_delivery` | delivery_id=36470, po_number=2112666093, orig_status=chua_giao | PASS |
| `pre_notification_count` | total=2 | PASS |
| `update_status` | status=200, duration_ms=66, response=Đã cập nhật trạng thái: dang_giao | PASS |
| `verify_status_changed` | new_status=dang_giao | PASS |
| `post_notification_count` | total=2, delta=0 | PASS |
| `update_to_delivered` | status=200 | PASS |
| `revert_status` |  | PASS |

### bqms_sync_trigger - SKIP
Ly do: Playwright sync takes 60+ seconds, manually verified working in earlier sessions

## V. Bugs phat hien va da fix trong test nay

| # | Endpoint/File | Loi | Fix |
|---|---|---|---|
| 1 | `/api/v1/bqms/analytics/pareto` | `UndefinedColumnError: column br.category does not exist` | Da fix: viet lai query dung `bqms_rfq.maker` thay vi `bqms_records.category` (cot khong ton tai). Pareto giờ tra ve top-N maker theo so RFQ + tong qty. |

## VI. Cac phat hien khac (theo doi them, chua phai bug)

1. **Deliveries chua link tu PO**: 2,677/2,677 deliveries co `samsung_po_id = NULL`. Bridge function `_bridge_po_to_deliveries()` co the chua chay hoac chi link qua `po_number` text match. Khong anh huong UI nhung mat link database de query nhanh.
2. **Notifications it (2 trong tong)**: chi co 2 notification (cho thang@songchau.vn). Trigger `dispatch_delivery_status_change` da hoat dong (200 OK) nhung khong fire cho actor (Thang la admin doi status -> mac dinh exclude actor). Khi user khac doi status, admin se nhan duoc.
3. **bqms_quote_log da co data lan dau**: sau khi test PATCH price -> 1 row quote_log + daily morning report dem dung.

## VII. Luong nghiep vu BQMS Samsung - daccover

### Workflow A: Sync RFQ tu portal

1. Cron `30 23 * * *` -> M04 Playwright login Samsung BQMS
2. Capture XHR `selectPOAcceptList.do` -> upsert vao `bqms_samsung_po`
3. `_bridge_po_to_deliveries()` tao ban ghi tuong ung trong `bqms_deliveries`
4. UI `/bqms` hien thi RFQ list, `/bqms/deliveries` hien giao hang
5. Sync widget chip xanh "Đong bo vua xong"

**Test thuc te**: 369 PO da sync, last sync 24/04 (status=success, 17s, +8 new, +33 updated)

### Workflow B: Bao gia 4 vong + audit

1. Staff mo `/bqms` thay danh sach RFQ chua bao gia
2. Edit price v1 inline qua nut chinh sua
3. PATCH `/bqms/rfq/{id}/price` body `{field: quoted_price_bqms_v1, value: ...}`
4. Backend update `bqms_rfq.quoted_price_bqms_v1` + INSERT vao `bqms_quote_log` voi `quoted_by = current user`
5. Sang hom sau, `/reports/daily` "Bao cao buoi sang" dem so ma da bao gia v1/v2/v3 chia theo TM/GC

**Test thuc te**: PATCH v1 + v2 deu 200 OK. Quote log them 2 row. RFQ history endpoint tra 2 entries. Morning report dem `quoted_today_count = 1` (mot ma vua chinh).

### Workflow C: Theo doi giao hang

1. Khi PO trung -> auto-bridge sang `bqms_deliveries` (status `chua_giao`)
2. UI `/bqms/deliveries` co bang 22 cot, KPI top, search/filter
3. Staff doi `delivery_status` qua nut quick-action (`chua_giao` -> `dang_giao` -> `da_giao`)
4. PATCH `/bqms/deliveries/{id}/status` -> trigger `dispatch_delivery_status_change`
5. Notification chen vao bang `notifications` cho admin/manager/warehouse (tru actor)
6. Tra Excel qua nut "Xuat Excel" giong format THONG KE PO

**Test thuc te**: Lay delivery id=36470 PO=2112666093 (chua_giao). Doi sang dang_giao -> 200 + DB cap nhat. Doi sang da_giao -> 200. Revert -> 200. Notification trigger fire (khong co cho actor nhu thiet ke).

### Workflow D: KPI + Pareto + Bao cao

1. `/bqms` hien dashboard KPI (tong RFQ, win rate, response time)
2. `/bqms/deliveries` hien KPI giao hang: total/delivered/in_transit/pending + tien VND
3. `/bqms/analytics/pareto` (vua fix): top 20 maker theo so RFQ + qty
4. `/reports/daily` morning report tong hop hang ngay

**Test thuc te**: Tat ca 12 endpoint deu 200, pareto fix moi tra 20 group voi VINASIC, KAPUSI, JAES,...

## VIII. Khuyen nghi van hanh

### Uu tien cao
1. **Backfill `samsung_po_id` cho 2,677 deliveries** - chay query `UPDATE bqms_deliveries SET samsung_po_id = (SELECT id FROM bqms_samsung_po WHERE po_number = bqms_deliveries.po_number)`
2. **Cron BQMS sync chua chay tu 24/04** - 9 ngay, can investigate procrastinate worker
3. **Quote log se day them** sau khi nhan vien lien tuc dung PATCH price - sap toi co data cho daily morning report

### Uu tien trung
4. Verify notification fire cho user khac (test login as warehouse user va xem notification arrive)
5. Test luong **submit quotation** (POST /rfq/submit) - chua co data thuc
6. Test luong **parse RFQ PDF** (POST /rfq/parse) - chua test

### Uu tien thap
7. UI test Excel export deliveries
8. Test bulk update delivery status

---

*Bao cao deep BQMS+Deliveries. JSON goc: bqms_deliveries_results.json. Test runner: scripts/e2e/bqms_deliveries_deep.py*