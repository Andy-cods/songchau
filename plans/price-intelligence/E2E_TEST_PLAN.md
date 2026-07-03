# TRUNG TÂM THÔNG TIN GIÁ — E2E TEST PLAN

> QA Architect agent · 2026-07-02 · Song Chau ERP.
> Phạm vi: toàn bộ tính năng "Trung tâm thông tin giá đa nguồn" đã build + deploy prod (Deploy 1, Deploy 2, Tính năng A/B/C, Bảo mật viewer-block).
> Nguyên tắc: mỗi khẳng định về code kèm `file:line`. Test case bám 100% code thật.
> **Đây là plan CHỈ-ĐỌC** — không sửa code sản phẩm, không deploy. QA chạy tay + SQL cross-check.

---

## 0. MÔI TRƯỜNG & QUY ƯỚC

| Mục | Giá trị |
|---|---|
| Base API | `https://<prod>/api/v1` |
| DB | Postgres prod (chạy SQL cross-check ở §Data cross-check SQL) |
| Token nội bộ | admin / manager / staff / sales / director / procurement (mỗi role 1 JWT) |
| Token viewer | role='viewer' (read-only toàn hệ) |
| Token role-lạ | role='warehouse' hoặc 'accountant' (KHÔNG nằm trong allowed_roles của các endpoint giá nội bộ) |
| Token vendor | JWT cổng NCC (nếu có) — dùng để chứng minh KHÔNG truy cập được |
| Công cụ | curl / Postman cho API; trình duyệt cho UI (mô tả thao tác kiểu Sec-BQMS) |

**Quy ước kết quả kỳ vọng**: HTTP code + shape JSON + con số đối chiếu SQL. Mỗi TC "PASS" khi tất cả điều kiện đúng.

### ⚠️ 3 phát hiện quan trọng khi soạn plan (đọc trước)

1. **`price_analytics.py` KHÔNG có `allow_viewer=False`** — yêu cầu ghi rằng các endpoint `price_analytics.py` phải chặn viewer (403), nhưng `grep allow_viewer` trên `backend/app/api/v1/price_analytics.py` = **0 match**. Tất cả endpoint ở đó dùng `require_role(...)` mặc định `allow_viewer=True` (`rbac.py:46`). → **viewer HIỆN VẪN GET được** `/price-analytics/overview`, `/code-history/{code}`, v.v. Đây là **rủi ro cao #1** — TC-SEC-014..017 đánh dấu EXPECTED-FAIL để Thang xác nhận có phải chủ đích không. (analytics_trends.py + market_prices `/multi-source` ĐÃ có `allow_viewer=False` đúng.)
2. **`demand_forecast_router` + `forecast_router` VẪN mount** — `__init__.py:164` và `:259` không bị comment. Menu FE đã bỏ "Dự báo" (`constants.ts:155`) + trang redirect (`analytics/forecast/page.tsx:9`), nhưng backend forecast endpoint vẫn sống. Regression: KHÔNG được coi là lỗi (Deploy 1 chỉ ẩn menu + redirect, DESIGN §Đợt 0 nói "KISS: chỉ ẩn menu, không xóa backend vội").
3. **PATCH `/rfq/{id}/result` KHÔNG đặt `allow_viewer=False`** (`bqms.py:1606`) nhưng viewer vẫn bị chặn PATCH vì nhánh `allow_viewer=True` từ chối mọi method ≠ GET/HEAD/OPTIONS (`rbac.py:65-73`). → viewer PATCH result = 403 "VIEWER_READ_ONLY" (không phải INSUFFICIENT_PERMISSIONS). TC-SEC-018 kiểm đúng mã lỗi này.

---

## MỤC LỤC

- [Nhóm Deploy 1](#nhóm-deploy-1--menu--redirect--xu-hướng-giá--radar) — Menu/redirect + KPI + Volatility + Radar (TC-D1-xxx)
- [Nhóm Deploy 2](#nhóm-deploy-2--view-gộp--multi-source) — VIEW gộp + multi-source (TC-D2-xxx)
- [Nhóm A](#nhóm-a--nút-thắngthua) — Nút Thắng/Thua (TC-A-xxx)
- [Nhóm B](#nhóm-b--badge-giá-thị-trường-trong-form-nguồn-cung) — Badge form Nguồn cung (TC-B-xxx)
- [Nhóm C](#nhóm-c--chart-theo-vai-trò) — Chart theo vai trò (TC-C-xxx)
- [Nhóm Security](#nhóm-security) — Auth/role/viewer/vendor/leak (TC-SEC-xxx)
- [Nhóm Regression](#nhóm-regression) — Endpoint & trang cũ (TC-REG-xxx)
- [Nhóm UI thủ công](#nhóm-ui-thủ-công-kiểu-sec-bqms) — Thao tác bấm (TC-UI-xxx)
- [Data cross-check SQL](#data-cross-check-sql)
- [Checklist UI thủ công cho Thang](#checklist-ui-thủ-công-cho-thang)

---

## NHÓM DEPLOY 1 — MENU / REDIRECT / XU HƯỚNG GIÁ / RADAR

Code: `constants.ts`, `analytics/forecast/page.tsx`, `analytics/xnk/page.tsx`, `analytics_trends.py` (`/price-trends/kpi`, `/volatility`, `/repeat-rfq-radar`).

| ID | Nhóm | Loại | Tiền điều kiện | Bước | Kết quả kỳ vọng | Verify |
|---|---|---|---|---|---|---|
| **TC-D1-001** | Menu | UI | Login admin | Vào bất kỳ trang, mở sidebar mục "Phân tích" | KHÔNG còn item "Dự báo nhu cầu"; chỉ có "Tra cứu giá XNK" + "Xu hướng giá" | `constants.ts:151-153` NAV_ANALYTICS chỉ 2 item; dòng forecast đã xóa |
| **TC-D1-002** | Menu | UI | Login manager, sales, director | Lặp TC-D1-001 với mỗi role | Đều không thấy "Dự báo nhu cầu" | NAV_ANALYTICS dùng chung cho các role |
| **TC-D1-003** | Redirect | UI/Regression | Login bất kỳ | Gõ URL trực tiếp `/analytics/forecast` | Redirect 307→ `/analytics/price-trends`, không crash/404 | `analytics/forecast/page.tsx:9` `redirect('/analytics/price-trends')` |
| **TC-D1-004** | Redirect | UI/Regression | Login bất kỳ | Gõ URL `/analytics/xnk` | Redirect → `/market-prices` | `analytics/xnk/page.tsx:7` `redirect('/market-prices')` |
| **TC-D1-005** | KPI | API happy | Token admin | `GET /analytics/price-trends/kpi?months=12` | 200; `data` có đủ 10 field: gmv_quote_month_vnd, gmv_quote_delta_pct, win_rate_pct, win_rate_delta_pct, volatile_code_count, margin_squeeze_customer_count, avg_margin_pct, median_sale_vnd, top_customer_name, top_customer_gmv_vnd | `analytics_trends.py:242-254` khớp FE `KpiPayload` `page.tsx:61-73` |
| **TC-D1-006** | KPI | Edge | Token admin | `GET /analytics/price-trends/kpi?months=0` | **422** (Query ge=1) | `analytics_trends.py:69` `ge=1, le=36` |
| **TC-D1-007** | KPI | Edge | Token admin | `GET /analytics/price-trends/kpi?months=40` | **422** (le=36) | `analytics_trends.py:69` |
| **TC-D1-008** | KPI | Edge | Token admin | `GET /analytics/price-trends/kpi` (không param) | 200; dùng range_months mặc định 12 | `analytics_trends.py:68,83` window=12 |
| **TC-D1-009** | KPI | Data-correctness | Có dữ liệu sourcing tháng này | So `gmv_quote_month_vnd` với SQL Q1 | `gmv_quote_month_vnd == SUM(sale_vnd) sourcing tháng hiện tại (theo inquiry_date)`; nếu SUM=0 → field=null | `analytics_trends.py:89-111`; SQL Q1 |
| **TC-D1-010** | KPI | Data-correctness | ≥1 RFQ won+lost trong window | So `win_rate_pct` với SQL Q2 (dedup twins, ILIKE '%won%'/'%lost%', KHÔNG gồm 'closed') | `win_rate_pct == round(won/(won+lost)*100,1)`; win_rate_delta_pct luôn null | `analytics_trends.py:118-141`; **quan trọng**: `:133` chỉ `%lost%` (không `%lose%`) nên 'closed' KHÔNG bị đếm; SQL Q2 |
| **TC-D1-011** | KPI | Data-correctness (win_rate bug) | Có RFQ result='closed' trong window | Chạy SQL Q2b (đếm '%lose%') vs Q2 (đếm '%lost%') | Nếu tồn tại 'closed': Q2b > Q2 (bug cũ đếm dư); endpoint dùng Q2 → **KHÔNG gồm closed vào decided** | `analytics_trends.py:132-134` comment giải thích; SQL Q2b chứng minh 'closed' chứa 'lose' |
| **TC-D1-012** | KPI | Data-correctness | ≥3 RFQ/mã distinct | So `volatile_code_count` với SQL Q3 (cv=sd/mean>0.3, HAVING count≥3, dedup) | Khớp COUNT | `analytics_trends.py:144-170`; SQL Q3 |
| **TC-D1-013** | KPI | Data-correctness | Có sourcing cost_vnd>0 | So `avg_margin_pct`, `median_sale_vnd`, `top_customer_*` với SQL Q4 | `avg_margin_pct == round(median((sale-cost)/sale)*100,1)`; top_customer = khách có SUM(sale) lớn nhất tháng này | `analytics_trends.py:181-238`; SQL Q4 |
| **TC-D1-014** | KPI | Edge (bảng thiếu) | (mô phỏng) sourcing_entries không tồn tại | GET kpi | 200; các field sourcing = null/0 (bắt UndefinedTableError) | `analytics_trends.py:108-109, 239-240` |
| **TC-D1-015** | Volatility | API happy | Token admin | `GET /analytics/price-trends/volatility?months=12&limit=20&min_samples=3` | 200; `data` = mảng, mỗi phần tử có: bqms_code, rfq_count, median_v1, min_v1, max_v1, stddev_pct, last_seen | `analytics_trends.py:759-777` khớp FE `VolatilityRow` `page.tsx:131-140` |
| **TC-D1-016** | Volatility | Edge | Token admin | `?min_samples=1` | **422** (ge=2) | `analytics_trends.py:715` `ge=2, le=20` |
| **TC-D1-017** | Volatility | Edge | Token admin | `?limit=200` | **422** (le=100) | `analytics_trends.py:714` `le=100` |
| **TC-D1-018** | Volatility | Data-correctness | Có mã ≥3 RFQ distinct | Với 1 bqms_code trong data, so với SQL Q5 | `rfq_count == COUNT(DISTINCT rfq_number)` (dedup ON (rfq_number,bqms_code)); `stddev_pct == round(sd/mean*100,1)`; median_v1 = PERCENTILE_CONT(0.5) | `analytics_trends.py:729-765`; SQL Q5 |
| **TC-D1-019** | Volatility | Data-correctness | — | Kiểm sort | Kết quả sort theo CV (sd/mean) DESC; ≤ limit dòng | `analytics_trends.py:753-755` |
| **TC-D1-020** | Radar | API happy | Token admin | `GET /analytics/price-trends/repeat-rfq-radar?limit=100&min_asks=3` | 200; `data.rows[]` có: bqms_code, ask_count, cadence_days, days_since_last, due_ratio, status, next_expected_date, has_cost, has_sourcing, last_v1_vnd; `data.count`=len(rows) | `analytics_trends.py:1111-1140` khớp FE `RadarRow` `page.tsx:147-162` |
| **TC-D1-021** | Radar | Edge | Token admin | `?min_asks=0` | **422** (ge=1) | `analytics_trends.py:1010` `ge=1, le=50` |
| **TC-D1-022** | Radar | Edge | Token admin | `?limit=600` | **422** (le=500) | `analytics_trends.py:1009` `le=500` |
| **TC-D1-023** | Radar | Data-correctness (cadence) | Mã có ≥3 rfq_number distinct | Với 1 mã trong rows, tính lại cadence bằng SQL Q6 | `cadence_days == round((last-first)/(distinct_days-1),1)`; chỉ mã có `COUNT(DISTINCT rfq_number)>=min_asks` mới xuất hiện | `analytics_trends.py:1042-1074`; SQL Q6 |
| **TC-D1-024** | Radar | Data-correctness (status) | — | Với mỗi row tính lại status từ due_ratio | `due_ratio>1.1→'overdue'`; `0.8≤r≤1.1→'due_soon'`; `<0.8→'on_track'`; cadence null→'unknown' | `analytics_trends.py:1088-1101` |
| **TC-D1-025** | Radar | Data-correctness (next_expected) | Row có cadence>0 | Kiểm next_expected_date | `next_expected_date == last_inquiry + round(cadence) ngày`; cadence null → null | `analytics_trends.py:1105-1107` |
| **TC-D1-026** | Radar | Data-correctness (readiness) | — | Với 1 mã: kiểm has_cost/has_sourcing bằng SQL Q7 | `has_cost = (purchase_price_vnd>0 OR rmb>0) OR sourcing cost_vnd>0`; `has_sourcing = EXISTS sourcing_entries (deleted_at IS NULL)` | `analytics_trends.py:1049-1070, 1109`; SQL Q7 |
| **TC-D1-027** | Radar | Data-correctness (sort) | — | Kiểm thứ tự rows | overdue trước → due_soon → on_track → unknown; trong nhóm sort due_ratio DESC | `analytics_trends.py:1129-1133` |
| **TC-D1-028** | Radar | Edge (rỗng) | min_asks cao (vd 999 — nhưng le=50) → dùng 50 | `?min_asks=50` | 200; rows có thể rỗng (mã đạt ≥50 lần hỏi hiếm); count=0 không lỗi | `analytics_trends.py:1057` HAVING |

---

## NHÓM DEPLOY 2 — VIEW GỘP + MULTI-SOURCE

Code: `migrations/price_intel_v1.sql` (fn_to_vnd, v_price_observations, v_price_observations_clean, price_intel_config), `market_prices.py:/multi-source/{bqms_code}`.

| ID | Nhóm | Loại | Tiền điều kiện | Bước | Kết quả kỳ vọng | Verify |
|---|---|---|---|---|---|---|
| **TC-D2-001** | Migration | Data | DB prod | Chạy SQL Q8 (kiểm object tồn tại) | Có bảng `price_intel_config` (5 hàng seed), function `fn_to_vnd`, view `v_price_observations`, view `v_price_observations_clean` | `price_intel_v1.sql:11-23,26,45,109` |
| **TC-D2-002** | Migration | Data | — | `SELECT src, COUNT(*) FROM v_price_observations GROUP BY 1` | Ra tối đa 4 nguồn: bqms, sourcing, xnk, imv | `price_intel_v1.sql:57,66,78,92,98` |
| **TC-D2-003** | fn_to_vnd | Data | — | `SELECT fn_to_vnd(100,'VND',CURRENT_DATE)`, `fn_to_vnd(100,NULL,...)`, `fn_to_vnd(100,'',...)` | Đều trả 100 (VND/NULL/'' → nguyên) | `price_intel_v1.sql:31` |
| **TC-D2-004** | fn_to_vnd | Data | — | `SELECT fn_to_vnd(10,'RMB',CURRENT_DATE)` | Nếu có rate RMB→VND ≤ hôm nay: trả 10*rate; nếu KHÔNG có rate → **NULL** (không lỗi) | `price_intel_v1.sql:32-40` |
| **TC-D2-005** | fn_to_vnd | Data | — | `SELECT fn_to_vnd(NULL,'USD',CURRENT_DATE)` | NULL | `price_intel_v1.sql:30` |
| **TC-D2-006** | VIEW clean L2 | Data-correctness | — | So COUNT rows `v_price_observations` (price_goc>0) vs `v_price_observations_clean` | clean ≤ raw; chênh lệch = số dòng bị loại (stale + outlier_mad) | `price_intel_v1.sql:123,163` |
| **TC-D2-007** | VIEW clean L1 dedup | Data-correctness | Có twins (rfq_number,bqms_code) | Chạy SQL Q9 — kiểm nhánh bqms không nhân đôi | Mỗi (rfq_number,bqms_code) chỉ 1 dòng quote_v1 (DISTINCT ON) | `price_intel_v1.sql:47-56` |
| **TC-D2-008** | VIEW clean L4 MAD | Data-correctness | Mã có ≥1 ngoại lai | Chạy SQL Q10 (robust_z per mã) | Dòng có `robust_z > mad_k(3.5)` bị loại khỏi clean (dropped_reason='outlier_mad'); loại tính PER product_key_canon | `price_intel_v1.sql:135-156` |
| **TC-D2-009** | VIEW clean L5 recency | Data-correctness | Có obs > 24 tháng | Chạy SQL Q11 | Dòng `obs_date < CURRENT_DATE - 24 months` bị loại (stale) | `price_intel_v1.sql:148-150` (recency_months=24) |
| **TC-D2-010** | VIEW clean L6 canon | Data-correctness | product_key có khoảng trắng/thường | Kiểm product_key_canon | `= UPPER(BTRIM(product_key))`; multi-source lọc theo product_key hoặc bqms_code gốc (không canon) | `price_intel_v1.sql:119`; `market_prices.py:306` |
| **TC-D2-011** | multi-source | API happy | Token admin, bqms_code có dữ liệu | `GET /market-prices/multi-source/{code}` | 200; `data.sources` = dict key `{src}_{role}` với n/median_vnd/min_vnd/max_vnd/last_date; `data.observations` ≤40 dòng | `market_prices.py:325-352` |
| **TC-D2-012** | multi-source | Data-correctness | Mã có ≥2 nguồn | So median_vnd 1 nhóm với SQL Q12 | `median_vnd == PERCENTILE_CONT(0.5) trên v_price_observations_clean WHERE (product_key=$1 OR bqms_code=$1) AND price_vnd>0 GROUP BY src,price_role` | `market_prices.py:297-310`; SQL Q12 |
| **TC-D2-013** | multi-source | Edge (mã lạ) | Token admin | `GET /market-prices/multi-source/KHONGTONTAI999` | 200; `sources={}`, `observations=[]` (KHÔNG 404) | `market_prices.py:325,336-351` — luôn trả shape rỗng |
| **TC-D2-014** | multi-source | Edge (obs limit) | Mã có >40 quan sát | GET multi-source | `observations` ≤ 40, sort obs_date DESC | `market_prices.py:317` LIMIT 40 |
| **TC-D2-015** | multi-source | Data-correctness | — | Kiểm price trả về | Chỉ price_vnd (đã VND); KHÔNG lộ price_goc/currency_goc/ref_id trong `observations` (chỉ src, price_role, price_vnd, obs_date, party_name, party_role) | `market_prices.py:340-349` |

---

## NHÓM A — NÚT THẮNG/THUA

Code: `bqms.py:1602-1649` (PATCH `/rfq/{rfq_id}/result`), FE `bqms/page.tsx:4066-4110` (ResultMarkControl) + `:4397-4402` (trong DetailDrawer).

| ID | Nhóm | Loại | Tiền điều kiện | Bước | Kết quả kỳ vọng | Verify |
|---|---|---|---|---|---|---|
| **TC-A-001** | Result | API validate | Token admin, rfq_id KHÔNG tồn tại (vd 999999999) | `PATCH /bqms/rfq/999999999/result` body `{"result":"won"}` | **404** "RFQ #… không tồn tại"; **KHÔNG mutate** (UPDATE...WHERE id RETURNING trả rỗng) | `bqms.py:1627-1628` |
| **TC-A-002** | Result | API validate | Token admin | body `{"result":"invalid"}` | **400** "result phải là 'won','lost', hoặc 'pending'" | `bqms.py:1617-1618` |
| **TC-A-003** | Result | API validate | Token admin | body `{"result":123}` (không phải string) | **400** "result phải là string" | `bqms.py:1614-1615` |
| **TC-A-004** | Result | API validate | Token admin | body `{}` (thiếu result) | **400** "result phải là string" (body.get→None) | `bqms.py:1613-1615` |
| **TC-A-005** | Result | API validate (normalize) | Token admin, rfq_id thật | body `{"result":"WON"}` (hoa) | 200; lưu 'won' (strip().lower()) | `bqms.py:1616` |
| **TC-A-006** | Result | Data-correctness (GHI THẬT — hoàn tác thủ công) | Token admin, chọn 1 rfq_id thật, GHI LẠI result cũ | 1) `PATCH .../result {"result":"won"}` → 200 · 2) SQL Q13 kiểm `result='won', result_updated_by=<user>, result_date=CURRENT_DATE` · 3) **HOÀN TÁC**: PATCH lại về result cũ | Bước 2 khớp; audit_log có 1 dòng action='bqms.result_mark'; sau hoàn tác DB về nguyên trạng | `bqms.py:1620-1638`; SQL Q13, Q14 (audit) |
| **TC-A-007** | Result | Security (viewer) | Token viewer, rfq_id thật | `PATCH .../result {"result":"won"}` | **403** error='VIEWER_READ_ONLY' (không mutate) | `rbac.py:65-73` (viewer + non-GET) |
| **TC-A-008** | Result | Security (role lạ) | Token vai trò ngoài danh sách (vd 'director' KHÔNG trong list) | PATCH result | **403** INSUFFICIENT_PERMISSIONS | `bqms.py:1606-1609` allowed = admin,manager,staff,sales,procurement,warehouse,accountant (director KHÔNG có) |
| **TC-A-009** | Result | Security (no token) | — | PATCH result không Authorization | **401** "Token missing" | `rbac.py:25-26` |
| **TC-A-010** | Result | UI | Login admin, mở DetailDrawer 1 RFQ approved (item.id>0, không pending) | Thấy cụm nút "Kết quả:" [Thắng][Thua][Đang chờ]; click "Thắng" | Toast "Đã đánh dấu Thắng"; nút Thắng highlight emerald; bảng invalidate/refresh | `bqms/page.tsx:4085-4108, 4397-4400` |
| **TC-A-011** | Result | UI (idempotent) | current='won' | Click lại "Thắng" | Không gọi API (val===cur → return); không đổi | `bqms/page.tsx:4072` |
| **TC-A-012** | Result | UI (ẩn cho pending) | RFQ pending (isPending) hoặc item.id≤0 | Mở drawer | KHÔNG hiện cụm nút Kết quả | `bqms/page.tsx:4397` `!isPending && item.id>0` |

---

## NHÓM B — BADGE GIÁ THỊ TRƯỜNG TRONG FORM NGUỒN CUNG

Code: `SourcingFormDrawer.tsx:474-483, 592-626` (Tính năng B, gọi `/market-prices/multi-source/{code}` khi có bqms_code, debounce 400ms).

| ID | Nhóm | Loại | Tiền điều kiện | Bước | Kết quả kỳ vọng | Verify |
|---|---|---|---|---|---|---|
| **TC-B-001** | Badge | UI happy | Login admin, mở form Nguồn cung (tạo/sửa), có mã BQMS có dữ liệu multi-source | Nhập `bqms_code` = mã có XNK/PO | Sau ~400ms badge hiện median VND theo price_role (TT XNK / Won / Sourcing sale...) | `SourcingFormDrawer.tsx:595-626` |
| **TC-B-002** | Badge | UI edge (rỗng) | Mã không có dữ liệu | Nhập mã lạ | Badge rỗng/không hiện (sources={}) — form không lỗi | `market_prices.py:325`; `SourcingFormDrawer.tsx:613` filter |
| **TC-B-003** | Badge | Data-correctness | — | So số median badge hiện với SQL Q12 (cùng mã) | Số median VND badge == median_vnd từ endpoint == SQL | `SourcingFormDrawer.tsx:619-626`; SQL Q12 |
| **TC-B-004** | Badge | API (đọc-only) | — | Xác nhận badge chỉ GET | Không có POST/PATCH nào khi nhập mã (chỉ GET multi-source); form data không đổi vì badge | `SourcingFormDrawer.tsx:600-608` (chỉ api.get) |
| **TC-B-005** | Badge | Security | Login viewer (nếu viewer mở được form) | — | multi-source trả 403 (allow_viewer=False) → badge không hiện, form vẫn dùng được các phần khác | `market_prices.py:289` allow_viewer=False |
| **TC-B-006** | Badge | UI debounce | — | Gõ nhanh nhiều ký tự mã | Chỉ gọi API sau khi ngừng gõ 400ms (không spam) | `SourcingFormDrawer.tsx:592-598` |

---

## NHÓM C — CHART THEO VAI TRÒ

Code: `analytics_trends.py:261-334` (`/price-trends/by-role`, đọc `v_price_observations_clean`), FE `price-trends/page.tsx:359-374, 773-845` (LineChart + toggle role).

| ID | Nhóm | Loại | Tiền điều kiện | Bước | Kết quả kỳ vọng | Verify |
|---|---|---|---|---|---|---|
| **TC-C-001** | by-role | API happy | Token admin, codes có dữ liệu | `GET /analytics/price-trends/by-role?codes=CODE1&months=12` | 200; `data.months` (skeleton N tháng), `data.roles`=[quote_v1,market_xnk,cost_ncc,sale_sourcing,imv_buy], `data.series[]` mỗi phần tử {month_key, +role median} | `analytics_trends.py:327-333`; ROLE_KEYS `:36` |
| **TC-C-002** | by-role | Edge (codes rỗng) | Token admin | `GET .../by-role?codes=` | **200** (KHÔNG 422); `data.series=[]`, codes=[] | `analytics_trends.py:283-291` empty payload |
| **TC-C-003** | by-role | Edge (no codes param) | Token admin | `GET .../by-role` | 200; series=[] | `analytics_trends.py:263,279,283` |
| **TC-C-004** | by-role | Edge (months) | Token admin | `?codes=X&months=0` → 422; `&months=40` → 422 | 422 cả hai | `analytics_trends.py:264` `ge=1, le=36` |
| **TC-C-005** | by-role | Edge (mã lạ) | Token admin | `?codes=KHONGCO999&months=12` | 200; series có N tháng skeleton nhưng mọi role = null | `analytics_trends.py:308-325` |
| **TC-C-006** | by-role | Edge (>6 codes) | Token admin | `?codes=a,b,c,d,e,f,g,h` | 200; chỉ dùng 6 mã đầu | `analytics_trends.py:279` `[:6]` |
| **TC-C-007** | by-role | Data-correctness | Mã có nhiều role/tháng | Với 1 (month,role) so với SQL Q15 | `series[month][role] == PERCENTILE_CONT(0.5) price_vnd trên v_price_observations_clean GROUP BY tháng,role`, khớp code_list qua product_key OR bqms_code | `analytics_trends.py:295-306`; SQL Q15 |
| **TC-C-008** | by-role | Data-correctness (clean) | Mã có dòng bị loại L4/L5 | So by-role vs tính thẳng trên v_price_observations (raw) | by-role đọc **_clean** → khác raw nếu có outlier/stale bị loại | `analytics_trends.py:300` FROM v_price_observations_clean |
| **TC-C-009** | by-role | UI happy | Login admin, chọn ≥1 mã có dữ liệu | Trang Xu hướng giá → section "Giá theo vai trò"; chart LineChart hiện | ≥1 đường theo role; ≥3 đường khi mã đủ dữ liệu | `page.tsx:773-845` |
| **TC-C-010** | by-role | UI toggle | Chart đang hiện | Click tắt 1 role (vd "Giá vốn (NCC)") | Đường đó biến mất; các đường khác giữ; click lại → hiện | `page.tsx:379-380` toggleRole; `:833` filter activeRoles |
| **TC-C-011** | by-role | UI edge | Tắt hết role | Toggle off toàn bộ | Chart hiện empty state (activeRoles.length===0) | `page.tsx:814` |

---

## NHÓM SECURITY

require_role: `rbac.py:46-114`. Endpoint có `allow_viewer=False`: analytics_trends.py (TẤT CẢ, `:71,266,347,482,608,717,788,890,1012`), market_prices `/multi-source` (`:289`). Endpoint XNK market lookup khác (`/by-bqms`, `/dashboard`, `/search`) KHÔNG có allow_viewer → viewer xem được.

| ID | Nhóm | Loại | Tiền điều kiện | Bước | Kết quả kỳ vọng | Verify |
|---|---|---|---|---|---|---|
| **TC-SEC-001** | Auth | Security | — | `GET /analytics/price-trends/kpi` KHÔNG token | **401** "Token missing" | `rbac.py:25-26` |
| **TC-SEC-002** | Auth | Security | — | GET kpi với token hết hạn/rác | **401** "Token expired or invalid" | `rbac.py:42-43` |
| **TC-SEC-003** | Auth | Security | — | GET `/market-prices/multi-source/X` không token | 401 | `rbac.py:25-26` |
| **TC-SEC-004** | Role | Security | Token role='warehouse' (ngoài list) | GET `/analytics/price-trends/kpi` | **403** INSUFFICIENT_PERMISSIONS, required_roles liệt kê | `analytics_trends.py:71`; `rbac.py:75-83` |
| **TC-SEC-005** | Role | Security | Token 'accountant' | GET `/analytics/price-trends/by-role?codes=X` | 403 | `analytics_trends.py:266` |
| **TC-SEC-006** | Role | Security | Token 'warehouse' | GET `/analytics/price-trends/repeat-rfq-radar` | 403 | `analytics_trends.py:1012` |
| **TC-SEC-007** | Role | Security | Token 'warehouse'/'accountant' | GET `/market-prices/multi-source/X` | 403 (allowed=staff,manager,admin,procurement,sales,director) | `market_prices.py:289` |
| **TC-SEC-008** | Viewer-block | Security ⭐ | Token viewer | GET `/analytics/price-trends/kpi` | **403** (allow_viewer=False → viewer rơi xuống elif, 'viewer' ∉ allowed → INSUFFICIENT_PERMISSIONS) | `analytics_trends.py:71`; `rbac.py:65,75-83` |
| **TC-SEC-009** | Viewer-block | Security ⭐ | Token viewer | GET `/analytics/price-trends/by-role?codes=X` | **403** | `analytics_trends.py:266` |
| **TC-SEC-010** | Viewer-block | Security ⭐ | Token viewer | GET `/analytics/price-trends/volatility` | **403** | `analytics_trends.py:717` |
| **TC-SEC-011** | Viewer-block | Security ⭐ | Token viewer | GET `/analytics/price-trends/repeat-rfq-radar` | **403** | `analytics_trends.py:1012` |
| **TC-SEC-012** | Viewer-block | Security ⭐ | Token viewer | GET các endpoint cũ analytics_trends: `/multi-series`, `/by-customer`, `/by-supplier`, `/fresh-codes-14d`, `/matched-bqms` | **403** tất cả (đều allow_viewer=False) | `analytics_trends.py:347,482,608,788,890` |
| **TC-SEC-013** | Viewer-block | Security ⭐ | Token viewer | GET `/market-prices/multi-source/X` | **403** | `market_prices.py:289` |
| **TC-SEC-014** | Viewer-block | Security ⚠️EXPECTED-FAIL | Token viewer | GET `/price-analytics/overview?months=6` | Yêu cầu = 403; **THỰC TẾ có thể 200** vì `price_analytics.py:175` KHÔNG có allow_viewer=False | `price_analytics.py:175` (grep allow_viewer=0 match). **Rủi ro cao #1 — Thang xác nhận** |
| **TC-SEC-015** | Viewer-block | Security ⚠️EXPECTED-FAIL | Token viewer | GET `/price-analytics/code-history/{code}` | Yêu cầu 403; thực tế có thể 200 (lộ giá v1/v4/won/cost 1 mã) | `price_analytics.py:886` |
| **TC-SEC-016** | Viewer-block | Security ⚠️EXPECTED-FAIL | Token viewer | GET `/price-analytics/price-trends`, `/business-pulse`, `/intelligence` | Yêu cầu 403; thực tế có thể 200 | `price_analytics.py:630,673,240` |
| **TC-SEC-017** | Viewer-block | Security ⚠️EXPECTED-FAIL | Token viewer | GET `/price-analytics/by-owner`, `/loss-reasons` | Yêu cầu 403; thực tế có thể 200 | `price_analytics.py:596,1311` |
| **TC-SEC-018** | Viewer-block | Security | Token viewer | PATCH `/bqms/rfq/{id}/result` | **403** error='VIEWER_READ_ONLY' (không phải INSUFFICIENT — vì endpoint allow_viewer=True mặc định + non-GET) | `bqms.py:1606`; `rbac.py:65-73` |
| **TC-SEC-019** | Viewer-allowed | Security | Token viewer | GET `/market-prices/by-bqms/{code}` | **200** (endpoint XNK market data, allow_viewer mặc định True) | `market_prices.py:246` (không allow_viewer=False) |
| **TC-SEC-020** | Viewer-allowed | Security | Token viewer | GET `/market-prices/dashboard`, `/search`, `/stats`, `/sellers` | **200** cả 4 (market data công khai nội bộ) | `market_prices.py:363,109,658,630` |
| **TC-SEC-021** | Vendor-isolation | Security ⭐ | Token vendor (cổng NCC) | GET `/analytics/price-trends/kpi`, `/market-prices/multi-source/X` | **401/403** — router vendor riêng, không mount các endpoint này; vendor JWT không hợp lệ ở /api/v1 nội bộ | grep vendor router: 0 tham chiếu v_price_observations/multi-source/analytics_trends |
| **TC-SEC-022** | Leak-check | Security ⭐ | — | Kiểm response `/market-prices/multi-source/X` (bất kỳ mã) | KHÔNG lộ field giá nội bộ thô: không có quote_v1 raw-per-row, cost_ncc raw, price_goc, currency_goc, ref_id trong observations — chỉ median tổng hợp + price_vnd | `market_prices.py:340-349` (observations chỉ 6 field) |
| **TC-SEC-023** | Leak-check | Security | — | Kiểm `/price-trends/by-role` response | Chỉ trả median price_vnd/tháng/role (đã tổng hợp) — không dòng giá gốc | `analytics_trends.py:297-333` |
| **TC-SEC-024** | RLS | Security | — | GET bất kỳ endpoint giá sau khi qua require_role | set_config RLS chạy (app.current_user_id/role/email/ip) | `rbac.py:102-111` |
| **TC-SEC-025** | Token-revoke | Security | Đổi mật khẩu user → bump password_version | Dùng JWT cũ GET kpi | **401** TOKEN_REVOKED | `rbac.py:89-99` |

---

## NHÓM REGRESSION

| ID | Nhóm | Loại | Tiền điều kiện | Bước | Kết quả kỳ vọng | Verify |
|---|---|---|---|---|---|---|
| **TC-REG-001** | Endpoint cũ | Regression | Token admin | `GET /analytics/price-trends/multi-series?codes=X&months=12` | 200; shape {months,codes,series,market_median,series_detail} | `analytics_trends.py:459-467` |
| **TC-REG-002** | Endpoint cũ | Regression | Token admin | `GET .../by-customer?codes=X` | 200; {months,customers[],customer_details,codes,series} | `analytics_trends.py:584-594` |
| **TC-REG-003** | Endpoint cũ | Regression | Token admin | `GET .../by-supplier?codes=X` | 200; {months,suppliers[],supplier_details,codes,series} | `analytics_trends.py:695-704` |
| **TC-REG-004** | Endpoint cũ | Regression | Token admin | `GET .../fresh-codes-14d` | 200; data[] với urgency tiers | `analytics_trends.py:857-879` |
| **TC-REG-005** | Endpoint cũ | Regression | Token admin | `GET .../matched-bqms` | 200; data[] có gap_pct, result normalize ('won'/'lost'/'pending', KHÔNG 'closed'→lose) | `analytics_trends.py:960-966` (`:963` chỉ 'lost') |
| **TC-REG-006** | Endpoint cũ | Regression | Token admin/staff | `GET /market-prices/by-bqms/{code}` | 200; {data[], stats} XNK cũ không đổi | `market_prices.py:279-282` |
| **TC-REG-007** | Endpoint cũ | Regression | Token admin | `GET /market-prices/dashboard`, `/search`, `/stats` | 200 cả 3 (6 widget XNK) | `market_prices.py:580,133,671` |
| **TC-REG-008** | Endpoint cũ | Regression | Token admin | `GET /xnk/analytics/monthly-trend` | 200; trả median_v1_vnd + market_median_vnd (overlay chart chạy) | `xnk_analytics.py:280-286` |
| **TC-REG-009** | Endpoint cũ | Regression | Token admin | `GET /price-analytics/code-history/{code}` | 200; CodeHistoryDrawer contract không đổi | `price_analytics.py:882-886` |
| **TC-REG-010** | Forecast BE | Regression | Token admin | `GET /forecast/...` và `/demand-forecast/...` | **VẪN 200** (router chưa gỡ, Deploy 1 chỉ ẩn menu) — KHÔNG coi là lỗi | `__init__.py:164,259` (mount còn) |
| **TC-REG-011** | Trang cũ | Regression | Login admin | Mở `/market-prices`, `/analytics/price-trends`, `/bqms` | Render OK, không lỗi console; section mới không phá layout cũ | FE pages |
| **TC-REG-012** | App boot | Regression | — | App backend khởi động | Import mọi router OK (fn_to_vnd/view không chặn boot; view là runtime) | `__init__.py` |
| **TC-REG-013** | CodeHistoryDrawer | Regression | Login admin, mở drawer 1 mã | Section "Sourcing đã lưu" vẫn hiện | `/sourcing/by-code` không đụng | DESIGN §4.2 |

---

## NHÓM UI THỦ CÔNG (kiểu Sec-BQMS)

| ID | Nhóm | Loại | Bước bấm | Kết quả kỳ vọng |
|---|---|---|---|---|
| **TC-UI-001** | Menu | UI | Login admin → sidebar → mục "Phân tích" | Chỉ 2 item: "Tra cứu giá XNK", "Xu hướng giá". KHÔNG có "Dự báo nhu cầu" |
| **TC-UI-002** | Redirect | UI | Thanh địa chỉ → `/analytics/forecast` → Enter | Nhảy sang `/analytics/price-trends` |
| **TC-UI-003** | Redirect | UI | `/analytics/xnk` → Enter | Nhảy sang `/market-prices` |
| **TC-UI-004** | Radar | UI | Trang "Xu hướng giá" → cuộn tới bảng "Radar mã sắp bị hỏi lại" | Bảng hiện; hàng overdue lên trên; cột cadence/status/next_expected/has_cost/has_sourcing |
| **TC-UI-005** | KPI | UI | Trang "Xu hướng giá" → xem hàng KPI | 10 ô KPI có số (không còn "—" đại trà); win-rate hiển thị % |
| **TC-UI-006** | Volatility | UI | Trang "Xu hướng giá" → bảng biến động → click header sort | Sắp theo rfq_count/median_v1/stddev_pct; cột đủ (không lỗi undefined) |
| **TC-UI-007** | Chart role | UI | Chọn 1+ mã → section "Giá theo vai trò" | LineChart hiện ≥3 đường (mã đủ data); legend theo màu ROLE_META |
| **TC-UI-008** | Chart role toggle | UI | Click tắt/bật từng chip role | Đường tương ứng ẩn/hiện tức thì |
| **TC-UI-009** | Multi-source | UI | Trang "Tra cứu giá XNK" → nhập/chọn 1 mã → section "Giá đa nguồn (VND)" | Hiện median theo nguồn (thị trường→mình chào→giá vốn→sourcing→imv) + ≤8 quan sát gần nhất |
| **TC-UI-010** | Badge form | UI | Mở form Nguồn cung → nhập bqms_code có dữ liệu | Sau ~400ms badge "giá tham chiếu" hiện median (TT XNK/Won/Sourcing) |
| **TC-UI-011** | Nút Thắng/Thua | UI | Trang BQMS → mở DetailDrawer 1 RFQ approved → cụm "Kết quả:" → click "Thắng" | Toast "Đã đánh dấu Thắng"; nút highlight; bảng cập nhật |
| **TC-UI-012** | Nút ẩn pending | UI | Mở drawer 1 RFQ pending | KHÔNG có cụm nút Kết quả |

---

## DATA CROSS-CHECK SQL

> Chạy trên Postgres prod. Thay `:code`, `:rfq_id`, `:months` theo case. So kết quả với response API.

```sql
-- Q1 — KPI gmv_quote_month_vnd (TC-D1-009)
SELECT COALESCE(SUM(sale_vnd),0) AS gmv_this_month
FROM sourcing_entries
WHERE deleted_at IS NULL AND sale_vnd > 0 AND inquiry_date IS NOT NULL
  AND DATE_TRUNC('month', inquiry_date) = DATE_TRUNC('month', CURRENT_DATE);
-- Kỳ vọng: == gmv_quote_month_vnd (null nếu =0)

-- Q2 — win_rate ĐÚNG (TC-D1-010): dedup twins, chỉ '%lost%' (KHÔNG gồm closed)
WITH dedup AS (
  SELECT DISTINCT ON (rfq_number, bqms_code) rfq_number, result::text AS rt
  FROM bqms_rfq
  WHERE COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - (:months || ' months')::interval
  ORDER BY rfq_number, bqms_code, (result IS NOT NULL)::int DESC,
           COALESCE(result_date, COALESCE(inquiry_date, created_at::date)) DESC NULLS LAST)
SELECT COUNT(*) FILTER (WHERE rt ILIKE '%won%') AS won,
       COUNT(*) FILTER (WHERE rt ILIKE '%won%' OR rt ILIKE '%lost%') AS decided,
       ROUND(COUNT(*) FILTER (WHERE rt ILIKE '%won%')::numeric
             / NULLIF(COUNT(*) FILTER (WHERE rt ILIKE '%won%' OR rt ILIKE '%lost%'),0)*100,1) AS win_rate_pct
FROM dedup;

-- Q2b — CHỨNG MINH bug cũ (TC-D1-011): '%lose%' đếm nhầm 'closed'
SELECT result::text, COUNT(*), (result::text ILIKE '%lose%') AS matches_lose_bug,
       (result::text ILIKE '%lost%') AS matches_lost_correct
FROM bqms_rfq GROUP BY 1 ORDER BY 2 DESC;
-- Kỳ vọng: dòng result='closed' có matches_lose_bug=TRUE, matches_lost_correct=FALSE
--          → endpoint dùng '%lost%' nên KHÔNG đếm 'closed' vào decided.

-- Q3 — volatile_code_count (TC-D1-012)
WITH dedup AS (
  SELECT DISTINCT ON (rfq_number, bqms_code) bqms_code, quoted_price_bqms_v1
  FROM bqms_rfq
  WHERE quoted_price_bqms_v1 > 0 AND bqms_code IS NOT NULL
    AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - (:months || ' months')::interval
  ORDER BY rfq_number, bqms_code, id DESC),
per_code AS (
  SELECT bqms_code, COUNT(*) n, AVG(quoted_price_bqms_v1) mean, STDDEV_SAMP(quoted_price_bqms_v1) sd
  FROM dedup GROUP BY bqms_code HAVING COUNT(*) >= 3)
SELECT COUNT(*) FROM per_code WHERE mean > 0 AND (sd/mean) > 0.3;

-- Q4 — avg_margin_pct + median_sale + top_customer (TC-D1-013)
SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (sale_vnd-cost_vnd)::float/NULLIF(sale_vnd,0))
         FILTER (WHERE cost_vnd>0 AND sale_vnd>0) AS med_margin,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sale_vnd)
         FILTER (WHERE sale_vnd>0 AND DATE_TRUNC('month',inquiry_date)=DATE_TRUNC('month',CURRENT_DATE)) AS med_sale
FROM sourcing_entries WHERE deleted_at IS NULL;
SELECT customer_name, SUM(sale_vnd) gmv FROM sourcing_entries
WHERE deleted_at IS NULL AND sale_vnd>0 AND TRIM(COALESCE(customer_name,''))<>''
  AND DATE_TRUNC('month',inquiry_date)=DATE_TRUNC('month',CURRENT_DATE)
GROUP BY 1 ORDER BY gmv DESC LIMIT 1;

-- Q5 — Volatility 1 mã (TC-D1-018)
WITH dedup AS (
  SELECT DISTINCT ON (rfq_number, bqms_code) bqms_code, quoted_price_bqms_v1
  FROM bqms_rfq
  WHERE quoted_price_bqms_v1>0 AND bqms_code=:code
    AND COALESCE(inquiry_date, created_at::date) >= CURRENT_DATE - (:months || ' months')::interval
  ORDER BY rfq_number, bqms_code, id DESC)
SELECT COUNT(*) rfq_count,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_price_bqms_v1) median_v1,
       ROUND(STDDEV_SAMP(quoted_price_bqms_v1)/NULLIF(AVG(quoted_price_bqms_v1),0)*100,1) stddev_pct,
       MIN(quoted_price_bqms_v1) min_v1, MAX(quoted_price_bqms_v1) max_v1
FROM dedup;

-- Q6 — Radar cadence 1 mã (TC-D1-023)
WITH base AS (
  SELECT bqms_code, rfq_number, COALESCE(inquiry_date, created_at::date) d
  FROM bqms_rfq WHERE bqms_code=:code AND TRIM(bqms_code)<>''
    AND COALESCE(inquiry_date, created_at::date) IS NOT NULL)
SELECT COUNT(DISTINCT rfq_number) ask_count, COUNT(DISTINCT d) distinct_days,
       MIN(d) first_inq, MAX(d) last_inq,
       ROUND(CASE WHEN COUNT(DISTINCT d)>1
              THEN (MAX(d)-MIN(d))::numeric/(COUNT(DISTINCT d)-1) END,1) cadence_days,
       (CURRENT_DATE-MAX(d)) days_since_last
FROM base;

-- Q7 — Radar readiness 1 mã (TC-D1-026)
SELECT
  EXISTS(SELECT 1 FROM bqms_rfq WHERE bqms_code=:code
         AND (COALESCE(purchase_price_vnd,0)>0 OR COALESCE(purchase_price_rmb,0)>0)) AS has_cost_bqms,
  EXISTS(SELECT 1 FROM sourcing_entries WHERE deleted_at IS NULL AND bqms_code=:code AND COALESCE(cost_vnd,0)>0) AS has_cost_sourcing,
  EXISTS(SELECT 1 FROM sourcing_entries WHERE deleted_at IS NULL AND bqms_code=:code) AS has_sourcing;

-- Q8 — Migration objects (TC-D2-001)
SELECT 'config' t, COUNT(*) FROM price_intel_config
UNION ALL SELECT 'fn', COUNT(*) FROM pg_proc WHERE proname='fn_to_vnd'
UNION ALL SELECT 'view_raw', COUNT(*) FROM pg_views WHERE viewname='v_price_observations'
UNION ALL SELECT 'view_clean', COUNT(*) FROM pg_views WHERE viewname='v_price_observations_clean';
-- config=5, fn=1, view_raw=1, view_clean=1

-- Q9 — Dedup nhánh bqms không nhân đôi (TC-D2-007)
SELECT product_key, COUNT(*) FROM v_price_observations
WHERE src='bqms' AND price_role='quote_v1' GROUP BY 1 HAVING COUNT(*) > (
  SELECT COUNT(DISTINCT rfq_number) FROM bqms_rfq b WHERE b.bqms_code = v_price_observations.product_key);
-- Kỳ vọng: 0 dòng (không nhân đôi quá số rfq distinct)

-- Q10 — L4 MAD outlier bị loại (TC-D2-008): so raw vs clean 1 mã
SELECT (SELECT COUNT(*) FROM v_price_observations o WHERE UPPER(BTRIM(o.product_key))=UPPER(BTRIM(:code)) AND o.price_goc>0) raw_n,
       (SELECT COUNT(*) FROM v_price_observations_clean c WHERE c.product_key_canon=UPPER(BTRIM(:code))) clean_n;
-- raw_n >= clean_n; chênh = số outlier+stale bị loại

-- Q11 — L5 recency (TC-D2-009)
SELECT COUNT(*) stale_rows FROM v_price_observations
WHERE price_goc>0 AND obs_date < CURRENT_DATE - '24 months'::interval;
-- Các dòng này KHÔNG có trong v_price_observations_clean (nếu enable_L5=1)

-- Q12 — multi-source median 1 nhóm (TC-D2-012, TC-B-003)
SELECT src, price_role, COUNT(*) n,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) median_vnd,
       MIN(price_vnd) min_vnd, MAX(price_vnd) max_vnd
FROM v_price_observations_clean
WHERE (product_key=:code OR bqms_code=:code) AND price_vnd>0
GROUP BY src, price_role;

-- Q13 — Kiểm PATCH result ghi đúng (TC-A-006)
SELECT id, rfq_number, result::text, result_updated_by, result_date
FROM bqms_rfq WHERE id = :rfq_id;

-- Q14 — Audit log result_mark (TC-A-006)
SELECT action, table_name, record_id, new_data, created_at
FROM audit_log WHERE action='bqms.result_mark' AND record_id = :rfq_id::text
ORDER BY created_at DESC LIMIT 1;

-- Q15 — by-role median 1 (month,role) (TC-C-007)
SELECT TO_CHAR(DATE_TRUNC('month', obs_date),'YYYY-MM') ym, price_role,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_vnd) median_vnd
FROM v_price_observations_clean
WHERE (product_key = ANY(ARRAY[:code]) OR bqms_code = ANY(ARRAY[:code]))
  AND price_vnd>0 AND obs_date >= CURRENT_DATE - (:months || ' months')::interval
GROUP BY 1,2 ORDER BY 1,2;

-- Q16 — Coverage IMV map (tham khảo, DESIGN Đợt 1.5)
SELECT COUNT(*) total,
       COUNT(*) FILTER (WHERE p.imv_code IS NOT NULL) matched,
       ROUND(COUNT(*) FILTER (WHERE p.imv_code IS NOT NULL)::numeric/NULLIF(COUNT(*),0)*100,1) pct
FROM imv_orders o LEFT JOIN products p ON p.imv_code = o.item_code;
```

---

## CHECKLIST UI THỦ CÔNG CHO THANG

Đăng nhập admin trên trình duyệt, làm tuần tự (đánh dấu ✅/❌):

**Deploy 1 — Menu & Xu hướng giá**
- [ ] Sidebar "Phân tích" chỉ còn 2 mục, KHÔNG có "Dự báo nhu cầu"
- [ ] Gõ `/analytics/forecast` → tự nhảy về "Xu hướng giá"
- [ ] Gõ `/analytics/xnk` → tự nhảy về "Tra cứu giá XNK"
- [ ] Trang "Xu hướng giá": 10 ô KPI có số (không "—" hàng loạt)
- [ ] Bảng "Biến động giá" đủ cột (rfq_count, median, min, max, %std, lần cuối), click sort chạy
- [ ] Bảng/panel "Radar mã sắp bị hỏi lại" hiện; mã overdue lên đầu; cột "đã có giá vốn?/sourcing?" đúng

**Deploy 2 — Tra cứu giá đa nguồn**
- [ ] Trang "Tra cứu giá XNK": chọn 1 mã đã biết có PO/sourcing → section "Giá đa nguồn (VND)" hiện median theo nguồn + list quan sát

**Tính năng A — Thắng/Thua**
- [ ] Trang BQMS → mở 1 RFQ đã duyệt → cụm nút "Kết quả: [Thắng][Thua][Đang chờ]"
- [ ] Click Thắng → toast xanh, nút sáng emerald, bảng cập nhật
- [ ] (Test ghi thật + hoàn tác) đánh dấu 1 mã rồi trả về trạng thái cũ — xác nhận DB đúng qua Q13/Q14
- [ ] Mở 1 RFQ pending → KHÔNG có cụm nút Kết quả

**Tính năng B — Badge form Nguồn cung**
- [ ] Form Nguồn cung → nhập bqms_code có dữ liệu → badge "giá tham chiếu" hiện sau ~0.4s

**Tính năng C — Chart theo vai trò**
- [ ] Chọn ≥1 mã → chart "Giá theo vai trò" hiện ≥3 đường
- [ ] Tắt/bật từng chip role → đường ẩn/hiện đúng
- [ ] Tắt hết role → chart báo "chọn ≥1 vai trò" (empty state)

**Bảo mật (nếu có tài khoản viewer để test)**
- [ ] Đăng nhập viewer → mở "Xu hướng giá" / gọi KPI → **403** (bị chặn) ⭐
- [ ] Viewer vẫn xem được "Tra cứu giá XNK" (bảng XNK by-bqms/dashboard) → 200
- [ ] ⚠️ Kiểm `/price-analytics/*` với viewer: nếu **200** → BÁO Thang (thiếu allow_viewer=False, rủi ro lộ giá nội bộ)

---

## TỔNG KẾT SỐ LƯỢNG

| Nhóm | Số case |
|---|---|
| Deploy 1 (menu/redirect/KPI/volatility/radar) | 28 (TC-D1-001..028) |
| Deploy 2 (VIEW + multi-source) | 15 (TC-D2-001..015) |
| A (Thắng/Thua) | 12 (TC-A-001..012) |
| B (Badge form) | 6 (TC-B-001..006) |
| C (Chart vai trò) | 11 (TC-C-001..011) |
| Security | 25 (TC-SEC-001..025) |
| Regression | 13 (TC-REG-001..013) |
| UI thủ công | 12 (TC-UI-001..012) |
| **TỔNG** | **122** |
