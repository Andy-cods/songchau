# TRUNG TÂM THÔNG TIN GIÁ ĐA NGUỒN — DESIGN

> Bản thiết kế (chưa code). Hợp nhất giá **BQMS + Sourcing + IMV + XNK** phục vụ 2 màn giữ lại: **Xu hướng giá** (`/analytics/price-trends`) và **Tra cứu giá** (`/market-prices`).
> Nguyên tắc: KISS / YAGNI / DRY. Ưu tiên **VIEW** thay vì ETL sao chép dữ liệu.
> Ngày: 2026-07-02. Tác giả: System Architect + Solution Brainstormer agent.
> Mọi khẳng định về code hiện tại đều kèm `file:line` để chủ dự án (Thang) đối chiếu.

---

## 0. TÓM TẮT ĐIỀU HÀNH (đọc phần này trước)

- **IMV chốt xong**: nguồn giá IMV SỐNG THẬT là bộ scraper `imv_orders / imv_contracts / imv_payments` (giá ở `unit_price` + `currency` + `amount`). Bộ `imv_inquiries/imv_consolidated/imv_purchase_orders` (Agent 2) là **seed cũ chết**, không endpoint/task nào đọc để lấy giá. **IMV nối product bằng `item_code` (text), KHÔNG có FK tới `products`** → xử lý như "kênh riêng" hiển thị song song, có thể best-effort map `item_code → products.imv_code` để suy ra `bqms_code`.
- **Mô hình hợp nhất chọn: VIEW `v_price_observations` (UNION ALL 6 nhánh)**, KHÔNG ETL bảng vật lý. Lý do: KISS + không nhân đôi dữ liệu + luôn tươi + rollback = `DROP VIEW`. Nếu chậm → nâng cấp `MATERIALIZED VIEW` refresh đêm ở Đợt sau (chỉ khi đo được chậm — YAGNI).
- **Điểm gãy đã xác minh (bug thật, không phải giả định)**: FE `/analytics/price-trends` đọc field KPI + Volatility mà backend trả **khác tên hoàn toàn** → các ô "—". Chi tiết ở §4.1. Đây là việc rẻ, làm ngay ở Đợt 1.
- **4 đợt**: Đợt 0 dọn menu (bỏ Dự báo + ẩn customs/xnk) → Đợt 1 sửa lệch contract + dựng VIEW → Đợt 2 nhồi IMV vào trend + tra cứu đa nguồn → Đợt 3 UX hội tụ (CodeHistoryDrawer làm hub + badge form báo giá).

### 3 điểm CẦN THANG QUYẾT
1. **IMV map như thế nào?** (A) Chỉ hiển thị IMV như "kênh riêng" theo `item_code` (đơn giản, an toàn, KHÔNG trộn vào biểu đồ theo `bqms_code`); hay (B) cố map `item_code → products.imv_code → products.bqms_code` để IMV lên chung biểu đồ mã BQMS (mạnh hơn nhưng phụ thuộc chất lượng `products.imv_code`, cần đo tỷ lệ khớp trước). **Khuyến nghị: bắt đầu (A), mở (B) sau khi đo coverage.**
2. **IMV quy đổi VND**: `imv_orders.currency` là chuỗi tự do từ scraper (VARCHAR) — có thể là 'VND','USD','JPY'... Chấp nhận **quy đổi best-effort qua `exchange_rates`** (rate gần ngày `order_date`), thiếu rate thì để `price_vnd = NULL` và vẫn hiện giá gốc? (Khuyến nghị: có, đừng chặn.)
3. **Giá "won" thật của BQMS**: lấy từ `bqms_samsung_po.unit_price` (đơn giá Samsung mua, currency chuẩn ENUM) làm `price_role = won_po`. Xác nhận đây là "giá trúng" chuẩn muốn vẽ (không phải `quoted_price_bqms_v4`).

---

## 1. XÁC MINH IMV (giải mâu thuẫn 2 agent)

### 1.1 Kết luận: bộ scraper là nguồn SỐNG

| Bằng chứng | File:line |
|---|---|
| API IMV chỉ đọc 6 bảng scraper: `imv_rfq, imv_orders, imv_deliveries, imv_payments, imv_contracts, imv_rejections` | `backend/app/api/v1/imv.py:23-60` (ENTITY_TABLES) |
| KPI giá trị PO lấy từ `imv_orders.amount` | `backend/app/api/v1/imv.py:79-89` |
| Task đồng bộ đêm (cron `50 23 * * *`) upsert đúng 6 bảng scraper qua Playwright | `backend/app/tasks/imv_sync.py:111-134`, `21-106` |
| Bảng `imv_orders` có cột giá `unit_price, amount, currency` | `imv_sync.py:37-52` (cols); schema `imv_module_v2.sql:16-48` |
| Bảng `imv_contracts` / `imv_payments` có `unit_price, currency` | `imv_sync.py:69-105`; `imv_module_v2.sql:96-152` |
| `imv_rfq` KHÔNG có cột giá (chỉ `offered_qty, quantity`) | `imv_sync.py:22-36`; `imv_module.sql:10-41` |

### 1.2 Bộ `imv_inquiries/imv_consolidated/imv_purchase_orders` (Agent 2) = CHẾT

- Chỉ xuất hiện trong `backend/init_v3.sql` (seed cũ) + scripts import (`import_all_data.py`, `import_precise.py`, `seed_sample_data_v2.py`) + whitelist migration `etl.py:167`. **KHÔNG có endpoint đọc giá, KHÔNG có task sync đêm.** → bỏ khỏi phạm vi giá.

### 1.3 Khóa nối IMV → product/bqms_code

- `imv_orders` khóa nghiệp vụ = `UNIQUE(po_internal_number, item_code)` (`imv_module_v2.sql:48`). **Không có FK tới `products`.**
- Cầu nối khả dĩ: `products.imv_code` là **UNIQUE** (`init_v3.sql:613`) và `products.bqms_code` UNIQUE (`init_v3.sql:612`). Vậy `imv_orders.item_code === products.imv_code` → suy ra `products.bqms_code`.
- **Rủi ro**: `item_code` IMV chưa chắc trùng `products.imv_code` (khác không gian mã, scraper trim/format khác). **Phải đo `COUNT(*) khớp` trước khi tin.** → Vì thế mặc định IMV là **kênh riêng** (`product_key = item_code`, `source='imv'`), map sang `bqms_code` chỉ là cột phụ `bqms_code_mapped` (LEFT JOIN `products ON products.imv_code = imv_orders.item_code`), NULL nếu không khớp.

---

## 2. MÔ HÌNH DỮ LIỆU HỢP NHẤT (canonical)

### 2.1 "Một quan sát giá" — cột chuẩn hoá

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `source` | text | `bqms` / `sourcing` / `xnk` / `imv` |
| `price_role` | text | vai trò giá (bảng §2.2) |
| `product_key` | text | khóa hiển thị: `bqms_code` (BQMS/Sourcing/XNK) hoặc `item_code` (IMV) |
| `bqms_code` | text | `bqms_code` nếu có (IMV: qua map, có thể NULL) |
| `product_name` | text | tên/spec để hiển thị |
| `party_name` | text | đối tác (supplier_name / seller_name / customer_name / buyer_name) |
| `party_role` | text | `supplier` / `competitor` / `customer` / `samsung_buyer` |
| `obs_date` | date | ngày quan sát (đã COALESCE) |
| `currency_goc` | text | tiền tệ gốc |
| `price_goc` | numeric | đơn giá theo tiền gốc |
| `price_vnd` | numeric | đơn giá quy đổi VND (NULL nếu không quy đổi được) |
| `qty` | numeric | số lượng (nếu có) |
| `ref_id` | bigint | id dòng gốc (để drill-down) |
| `ref_table` | text | bảng gốc |

### 2.2 Bảng `price_role` (nguồn ↔ cột thật ↔ tiền tệ)

| price_role | source | Cột đơn giá thật | Tiền tệ | obs_date | party |
|---|---|---|---|---|---|
| `quote_v1` | bqms | `bqms_rfq.quoted_price_bqms_v1` | **USD** (không có cột currency)¹ | `COALESCE(inquiry_date, created_at::date)` | — |
| `quote_final` | bqms | `bqms_rfq.quoted_price_bqms_v4` | **USD**¹ | nt | — |
| `cost_ncc_bqms` | bqms | `bqms_rfq.purchase_price_vnd` (và `purchase_price_rmb`) | VND / RMB² | nt | `supplier_name` (supplier) |
| `won_po` | bqms | `bqms_samsung_po.unit_price` | `currency` ENUM (DEFAULT VND)³ | `po_date` | `buyer_name` (samsung_buyer) |
| `sale_sourcing` | sourcing | `sourcing_entries.sale_vnd` | **VND** | `inquiry_date` | `customer_name` (customer) |
| `cost_ncc_sourcing` | sourcing | `sourcing_supplier_prices.cost_vnd_equiv` (primary) hoặc `sourcing_entries.cost_vnd` | VND (đã snap)⁴ | nt | `supplier_name` (supplier) |
| `market_xnk` | xnk | `xnk_price_lookup.price_vnd` (và `price_usd`) | VND / USD⁵ | `COALESCE(rfq_date, quoted_date)` | `seller_name` (competitor) |
| `imv_buy` | imv | `imv_orders.unit_price` | `imv_orders.currency` (text)⁶ | `order_date` | `customer_name` (customer) |
| `imv_contract` | imv | `imv_contracts.unit_price` | `imv_contracts.currency` | `contract_date` | `customer_name` |

**Chú thích tiền tệ (đã xác minh schema — điểm dễ sai):**
1. `quoted_price_bqms_v1..v4` **KHÔNG có cột currency** trong `bqms_rfq` (`init_v3.sql:687-690`). Toàn hệ hiện xử lý như **USD** (xem `analytics_trends.py:704-706` USD_VND=24500 để so XNK). **CẦN XÁC MINH khi implement**: có đúng V1 là USD không, hay VND? → đọc lại luồng nhập/ETL `bqms_rfq` trước khi khóa quy đổi.
2. `purchase_price_vnd` = VND (tên cột rõ), `purchase_price_rmb` = RMB (`init_v3.sql:684-685`). Không có cột currency chung.
3. `bqms_samsung_po.currency` = ENUM `currency_code` DEFAULT 'VND' (`init_v3.sql:856`) — **có currency chuẩn**, tin được.
4. Sourcing lưu multi-currency tách cột `cost_vnd/usd/jpy/krw/rmb` + `fx_rate_snapshot`+`fx_rate_date` (`sourcing_fx_snapshot.sql:23-24`); `sourcing_supplier_prices` có `currency` + `cost_vnd_equiv` cache (`sourcing_multi_supplier.sql:16-20`). **Ưu tiên `cost_vnd_equiv` primary** (đã quy đổi lúc save, DRY).
5. `xnk_price_lookup` có `price_usd` + `price_vnd` tách cột (`xnk_lookup.sql:23-24`), không currency chung.
6. `imv_orders.currency` = VARCHAR do scraper điền (`imv_module_v2.sql:37`) — **không chuẩn hoá**, phải map best-effort.

### 2.3 Quy đổi VND — dùng `exchange_rates`

- Bảng `exchange_rates`: `rate_date, from_currency, to_currency, rate, rate_type` — UNIQUE `(rate_date, from_currency, to_currency, rate_type)` (`init_v3.sql:375-386`).
- Quy tắc chuẩn hoá trong VIEW: viết **1 hàm SQL** `fn_to_vnd(amount numeric, cur text, on_date date) RETURNS numeric` — pick rate `to_currency='VND'`, `rate_type='transfer'`, `rate_date <= on_date` gần nhất; nếu `cur='VND'` trả nguyên; nếu không tìm rate → NULL. DRY: mọi nhánh UNION gọi cùng hàm.
- Với nhánh đã có sẵn VND (`sale_sourcing`, `cost_ncc_sourcing`, `won_po` khi currency=VND, `market_xnk.price_vnd`): dùng thẳng, KHÔNG gọi hàm (tránh double-convert). Chỉ gọi `fn_to_vnd` cho nhánh chỉ có tiền ngoại (`quote_v1/v4` USD, `imv_*`).

### 2.4 QUYẾT ĐỊNH: VIEW vs ETL

| Tiêu chí | VIEW `UNION ALL` (CHỌN) | MATERIALIZED VIEW | Bảng vật lý ETL |
|---|---|---|---|
| Nhân đôi dữ liệu | Không | Có (bản chụp) | Có |
| Độ tươi | Realtime | Theo lịch refresh | Theo job |
| Rollback | `DROP VIEW` (0 rủi ro) | `DROP MATVIEW` | migration + backfill |
| Công sức | Thấp nhất | Trung bình | Cao nhất |
| Rủi ro sai lệch nguồn | 0 (đọc bảng gốc) | Thấp | Cao (drift) |
| Hiệu năng khi data lớn | Có thể chậm (xnk ~35K + bqms) | Nhanh | Nhanh |

**Khuyến nghị: VIEW `v_price_observations`.** Data hiện tại (xnk ~35K, bqms/sourcing/imv nhỏ hơn) hoàn toàn kham được với index sẵn có trên `bqms_code`. **YAGNI**: chỉ nâng MATERIALIZED VIEW khi đo thực tế query > ~1.5s. Không đụng ETL vật lý.

```sql
-- Phác thảo (Đợt 1). Tên hàm/cột có thể tinh chỉnh khi implement.
CREATE OR REPLACE VIEW v_price_observations AS
  -- BQMS quote V1
  SELECT 'bqms' src, 'quote_v1' role, bqms_code product_key, bqms_code,
         specification product_name, NULL party_name, NULL party_role,
         COALESCE(inquiry_date, created_at::date) obs_date,
         'USD' cur, quoted_price_bqms_v1 price_goc,
         fn_to_vnd(quoted_price_bqms_v1,'USD',COALESCE(inquiry_date,created_at::date)) price_vnd,
         expected_qty qty, id ref_id, 'bqms_rfq' ref_table
  FROM bqms_rfq WHERE quoted_price_bqms_v1 > 0
  UNION ALL
  -- BQMS won (Samsung PO) — currency chuẩn
  SELECT 'bqms','won_po', bqms_code, bqms_code, specification,
         buyer_name,'samsung_buyer', po_date, currency::text, unit_price,
         CASE WHEN currency='VND' THEN unit_price ELSE fn_to_vnd(unit_price, currency::text, po_date) END,
         order_qty, id, 'bqms_samsung_po'
  FROM bqms_samsung_po WHERE unit_price > 0
  UNION ALL
  -- Sourcing sale (VND sẵn)
  SELECT 'sourcing','sale_sourcing', bqms_code, bqms_code, product_name,
         customer_name,'customer', inquiry_date,'VND', sale_vnd, sale_vnd,
         quantity, id, 'sourcing_entries'
  FROM sourcing_entries WHERE sale_vnd > 0 AND deleted_at IS NULL
  UNION ALL
  -- XNK market (VND sẵn)
  SELECT 'xnk','market_xnk', bqms_code, bqms_code, item_name,
         seller_name,'competitor', COALESCE(rfq_date,quoted_date),'VND', price_vnd, price_vnd,
         quantity, id, 'xnk_price_lookup'
  FROM xnk_price_lookup WHERE price_vnd > 0
  UNION ALL
  -- IMV buy (kênh riêng, item_code làm key; bqms_code map best-effort)
  SELECT 'imv','imv_buy', o.item_code, p.bqms_code, o.product_name,
         o.customer_name,'customer', o.order_date, o.currency, o.unit_price,
         CASE WHEN o.currency='VND' THEN o.unit_price ELSE fn_to_vnd(o.unit_price,o.currency,o.order_date) END,
         o.quantity, o.id, 'imv_orders'
  FROM imv_orders o LEFT JOIN products p ON p.imv_code = o.item_code
  WHERE o.unit_price > 0;
  -- (thêm nhánh cost_ncc_bqms / cost_ncc_sourcing / imv_contract tương tự)
```

### 2.5 Sơ đồ luồng dữ liệu (ASCII)

```
  bqms_rfq ──┐  (quote_v1/v4 USD, cost_ncc VND/RMB)
bqms_samsung_po ┤ (won_po, currency ENUM)
sourcing_entries ┤ (sale VND)                    ┌──────────────────────┐
sourcing_supplier_prices ┤ (cost_vnd_equiv)      │  fn_to_vnd(cur,date) │
xnk_price_lookup ┤ (market VND/USD)              │  ← exchange_rates    │
imv_orders/contracts ┘ (currency text, map imv_code→bqms_code)         │
        │                                        └──────────┬───────────┘
        ▼                                                   │
   ╔══════════════════════════════════════════════════════════════╗
   ║  VIEW v_price_observations  (UNION ALL, chuẩn hoá 14 cột)     ║
   ║  key = bqms_code | item_code · price_role · price_vnd · date  ║
   ╚══════════════════════════════════════════════════════════════╝
        │                         │                         │
        ▼                         ▼                         ▼
  Xu hướng giá            Tra cứu giá             CodeHistoryDrawer
 /analytics/price-trends  /market-prices          (hub drill-down 1 mã)
  (nhiều price_role        (multi-nguồn 1 mã)      + badge form Báo giá/Sourcing
   trên 1 chart)
```

---

## 3. HAI CHỨC NĂNG DÙNG CHUNG TẦNG NÀY

### 3.1 Xu hướng giá (`/analytics/price-trends`)

- **Mục tiêu mới**: 1 biểu đồ theo mã hiển thị nhiều đường theo `price_role`: giá chào mình (`quote_v1`) vs giá NCC (`cost_ncc_*`) vs giá trúng (`won_po`) vs thị trường (`market_xnk`) vs IMV (`imv_buy`).
- **Cách làm KISS**: thêm 1 endpoint `GET /analytics/price-trends/by-role?codes=&months=` đọc `v_price_observations` GROUP BY `(TO_CHAR(obs_date,'YYYY-MM'), price_role)` → median `price_vnd`. Trả flat series `{month_key, quote_v1, won_po, market_xnk, imv_buy, cost_ncc}` khớp recharts (đúng pattern flat_series hiện có ở `analytics_trends.py:257-263`).
- **Sửa lệch contract trước** (§4.1) để các panel cũ hết "—".

### 3.2 Tra cứu giá (`/market-prices`)

- Hiện chỉ tra `xnk_price_lookup` (`market_prices.py:96-282`). `/by-bqms/{code}` trả `{data, stats}` từ XNK (`market_prices.py:243-282`).
- **Mở rộng KISS**: thêm endpoint `GET /market-prices/multi-source/{bqms_code}` đọc `v_price_observations WHERE product_key=$1 OR bqms_code=$1` → nhóm theo `source/price_role`, trả:
  ```
  { xnk:{...stats cũ}, bqms_quote:{median,min,max,n}, bqms_won:{...}, sourcing_sale:{...},
    sourcing_cost:{...}, imv:{...}, observations:[...] }
  ```
- Giữ nguyên `/by-bqms` cũ (không phá FE), thêm section mới "Giá nội bộ (BQMS/Sourcing/IMV)" bên cạnh bảng XNK.

---

## 4. UX HỘI TỤ

### 4.1 SỬA LỆCH CONTRACT (bug đã xác minh — làm trước mọi thứ)

**KPI** — FE `KpiPayload` (`price-trends/page.tsx:61-74`) đọc:
`gmv_quote_month_vnd, gmv_quote_delta_pct, win_rate_pct, win_rate_delta_pct, volatile_code_count, margin_squeeze_customer_count, avg_margin_pct, median_sale_vnd, top_customer_name, top_customer_gmv_vnd`
BE `price_trends_kpi` (`analytics_trends.py:148-153`) trả:
`gmv_month, win_rate_pct, volatile_codes_count, shrinking_margin_customers_count`
→ **chỉ `win_rate_pct` khớp**; 8 ô còn lại "—". **Fix**: đổi tên field BE + thêm delta/avg_margin/median_sale/top_customer.

**Volatility** — FE `VolatilityRow` (`page.tsx:105-115`) đọc:
`rfq_count, median_v1, min_v1, max_v1, stddev_pct, zscore_max, spike_count, last_seen`
BE `price_trends_volatility` (`analytics_trends.py:562-576`) trả:
`n, mean_v1, stddev_v1, cv, min, max` → **0 field khớp**. **Fix**: đổi tên (`n→rfq_count`, `mean_v1→median_v1`, `min→min_v1`, `max→max_v1`, `cv→stddev_pct`, thêm `zscore_max/spike_count/last_seen`).

**XNK overlay** — FE gọi `/api/v1/xnk/analytics/monthly-trend` (`page.tsx:341`) đọc `median_v1_vnd, market_median_vnd` (`MonthlyTrendRow` `page.tsx:120-125`). → xác minh `xnk_analytics.py` trả đúng 2 field này khi implement.

> Lưu ý: `price_analytics.py /code-history` (`price_analytics.py:882-1303`) contract của CodeHistoryDrawer đang chạy thật — **không đụng**, đây là hub tốt.

### 4.2 CodeHistoryDrawer = HUB

- Đã hội tụ sẵn: summary/pricing (v1/v4/won/market)/departments/buyers/seasonal/forecast (`price_analytics.py:1288-1303`) + section "Sourcing đã lưu" gọi `/sourcing/by-code/{code}` (`sourcing.py:749`, FE `CodeHistoryDrawer.tsx:605`).
- **Thêm (Đợt 3)**: 1 section "IMV" gọi endpoint mới `/imv/by-item/{code}` (đọc `imv_orders/contracts` theo `item_code`), hiện khi mã có map IMV. Mở drawer từ mọi bảng của trang trends đã có (`page.tsx:853,891,898,912`).
- **Nút điều hướng chéo theo `bqms_code`**: trong drawer thêm 2 nút "Mở Tra cứu giá" (`/market-prices?bqms={code}`) và "Xem Xu hướng" (`/analytics/price-trends?codes={code}`).

### 4.3 Badge giá tham chiếu trong form

- Form Sourcing (`SourcingFormDrawer.tsx`) và form Báo giá BQMS: khi có `bqms_code`, gọi `/market-prices/multi-source/{code}` (Đợt 2) → hiện badge nhỏ: "TT XNK median: X · Won gần nhất: Y · Sourcing sale: Z". Chỉ đọc, không sửa dữ liệu.

---

## 5. KẾ HOẠCH THEO ĐỢT

### Đợt 0 — DỌN (gỡ Dự báo + ẩn customs/xnk mồ côi)

| # | File đụng | Sửa | Verify |
|---|---|---|---|
| 0.1 | `frontend/src/lib/constants.ts:154` | Xóa dòng `{ key:'forecast', ... '/analytics/forecast' }` khỏi `NAV_ANALYTICS` | Menu Phân tích không còn "Dự báo nhu cầu" (admin/manager/sales) |
| 0.2 | `frontend/src/app/(dashboard)/analytics/forecast/` + `/analytics/xnk/` | Xóa/redirect trang (hoặc để 404 tự nhiên) | Vào URL trực tiếp không crash |
| 0.3 | `backend/app/api/v1/__init__.py:159,164,251,259` | Comment mount `demand_forecast_router` + `forecast_router` (hoặc để lại nhưng menu ẩn — KISS: chỉ ẩn menu, không xóa backend vội) | App khởi động OK |
| 0.4 | `frontend` menu | Xác nhận **customs KHÔNG có trong menu** (đã đúng — chỉ dùng ở status badge `constants.ts:84`); nếu có route `/customs` thì ẩn link | Không có link "Khai hải quan" |
| 0.5 | `backend/app/api/v1/analytics_exports.py:203-216` | `forecast` scope trong EXPORT_REGISTRY sẽ mồ côi nếu gỡ router — để nguyên hoặc bỏ 4 dòng `("forecast",...)` | Export panel khác vẫn chạy |

> YAGNI: KHÔNG xóa `forecast.py/demand_forecast.py` + bảng `demand_forecasts` ở Đợt 0 (chỉ ẩn menu). Xóa mã nguồn dời sang task dọn riêng nếu Thang muốn (tránh phá `analytics_exports.py` import).

### Đợt 1 — TẦNG DỮ LIỆU HỢP NHẤT + SỬA CONTRACT

| # | File đụng | Sửa | Verify |
|---|---|---|---|
| 1.1 | migration mới `price_intel_view.sql` | Tạo `fn_to_vnd()` + VIEW `v_price_observations` (§2.4) | `SELECT source, count(*) FROM v_price_observations GROUP BY 1` ra 4 nguồn |
| 1.2 | `analytics_trends.py:148-153` | Đổi tên field KPI khớp FE (§4.1) + thêm `gmv_quote_delta_pct, win_rate_delta_pct, avg_margin_pct, median_sale_vnd, top_customer_*` | 10 ô KPI FE hết "—" |
| 1.3 | `analytics_trends.py:562-576` | Đổi tên field Volatility khớp FE (`n→rfq_count`...) + thêm `zscore_max/spike_count/last_seen` | Bảng biến động hiện đủ cột |
| 1.4 | `xnk_analytics.py` (endpoint monthly-trend) | Xác minh trả `median_v1_vnd + market_median_vnd`; sửa nếu lệch | Đường market overlay hiện trên chart |
| 1.5 | — | Đo coverage IMV map: `SELECT count(*) FILTER(WHERE p.imv_code IS NOT NULL)/count(*) FROM imv_orders o LEFT JOIN products p ON p.imv_code=o.item_code` | Có số % để Thang quyết điểm §0.1 |

### Đợt 2 — IMV VÀO TREND + TRA CỨU ĐA NGUỒN

| # | File đụng | Sửa | Verify |
|---|---|---|---|
| 2.1 | `analytics_trends.py` (endpoint mới) | `GET /price-trends/by-role` đọc `v_price_observations`, GROUP theo tháng×role, median price_vnd | Trả series có `quote_v1/won_po/market_xnk/imv_buy` |
| 2.2 | `price-trends/page.tsx` | Thêm chart "Giá theo vai trò" đọc endpoint 2.1; toggle bật/tắt từng role | Chart hiện ≥3 đường khi mã có dữ liệu |
| 2.3 | `market_prices.py` (endpoint mới) | `GET /market-prices/multi-source/{bqms_code}` đọc VIEW, nhóm theo source | Trả block xnk+bqms+sourcing+imv |
| 2.4 | `market-prices/page.tsx` | Thêm section "Giá nội bộ (BQMS/Sourcing/IMV)" cạnh bảng XNK | 1 mã có PO/sourcing hiện giá nội bộ |
| 2.5 | `imv.py` (endpoint mới) | `GET /imv/by-item/{item_code}` trả orders+contracts theo item_code | Trả list khi item_code có PO |

### Đợt 3 — UX HỘI TỤ + BADGE FORM

| # | File đụng | Sửa | Verify |
|---|---|---|---|
| 3.1 | `CodeHistoryDrawer.tsx` | Thêm section "IMV" (gọi 2.5) khi mã có map; ẩn nếu rỗng | Mã có IMV thấy section |
| 3.2 | `CodeHistoryDrawer.tsx` | 2 nút chéo → `/market-prices?bqms=` + `/analytics/price-trends?codes=` | Click điều hướng đúng |
| 3.3 | `SourcingFormDrawer.tsx` + form Báo giá BQMS | Badge tham chiếu gọi 2.3 khi có bqms_code | Nhập mã có XNK → badge hiện median |
| 3.4 | `market-prices/page.tsx` + `price-trends/page.tsx` | Đọc query param `?bqms=`/`?codes=` để prefill (điều hướng chéo từ 3.2) | Link mở đúng mã |

---

## 6. RỦI RO & YAGNI

- **Làm quá tay cần tránh**: (a) đừng dựng ETL vật lý — VIEW đủ; (b) đừng "chuẩn hoá currency IMV" cầu kỳ — best-effort + NULL fallback; (c) đừng vẽ cả 9 `price_role` cùng lúc — mặc định 3-4 đường (quote_v1, won_po, market_xnk, +imv nếu có), còn lại toggle; (d) đừng xóa mã forecast vội (Đợt 0 chỉ ẩn menu).
- **Giả định CẦN XÁC MINH khi implement** (ghi rõ, không bịa):
  - Tiền tệ `quoted_price_bqms_v1..v4` là **USD hay VND**? (không có cột currency — §2.2 nốt 1). Đọc luồng nhập `bqms_rfq` trước khi khóa `fn_to_vnd`.
  - Tỷ lệ khớp `imv_orders.item_code = products.imv_code` (đo ở task 1.5). Nếu ~0% → IMV chỉ là kênh riêng theo item_code, KHÔNG lên chart bqms_code.
  - `exchange_rates` có đủ rate lịch sử theo ngày cho USD/JPY/RMB/KRW không (MEMORY ghi Thang "chưa nhập exchange_rates" ở vài mốc) — thiếu thì `price_vnd=NULL`, vẫn hiện `price_goc`.
- **Bảo mật / phạm vi quyền xem**: cả 2 màn là **nội bộ admin/manager/sales/director/procurement** (`require_role` ở `analytics_trends.py`, `market_prices.py`, `price_analytics.py`). `target_price`/giá nội bộ (quote_v1, cost_ncc, won_po) **KHÔNG bao giờ đi qua cổng NCC** — cổng NCC dùng router `vendor_router` riêng (`app/api/vendor/`), không mount VIEW này. → an toàn. **Chỉ cần đảm bảo endpoint mới (2.1/2.3/2.5) giữ đúng `require_role` nội bộ, tuyệt đối không thêm vào `vendor_router`.**

---

## 7. PHỤ LỤC — Bằng chứng mount & schema chính

- Mount routers: `backend/app/api/v1/__init__.py` — `price-analytics:93`, `market-prices:201`, `analytics(trends):257`, `forecast:259`, `demand-forecast:164`, `customs:86`, `xnk:255`.
- Schema giá (file:line ở §1, §2.2 nốt): `init_v3.sql` (bqms_rfq:672, samsung_po:829, won_quotations:711, products:610, exchange_rates:375), `imv_module_v2.sql` (orders:16, payments:96, contracts:132), `sourcing_entries.sql:5`, `sourcing_multi_supplier.sql:6`, `sourcing_fx_snapshot.sql`, `sourcing_quote_snapshot.sql`, `xnk_lookup.sql:5`.
- FE contract: `price-trends/page.tsx` (KpiPayload:61, VolatilityRow:105, endpoints:255/263/297/312/328/341/349/358), `market-prices/page.tsx`, `CodeHistoryDrawer.tsx` (code-history:210, sourcing by-code:605), `constants.ts` (NAV_ANALYTICS:151).

---

## 8. TẦNG DỰ ĐOÁN & HỖ TRỢ QUYẾT ĐỊNH GIÁ (Pricing Decision Support)

> Thêm 2026-07-02. Trả lời câu hỏi của Thang: thiết kế §0–§7 **mô tả lịch sử**; phần này thêm **tầng dự đoán/hỗ trợ quyết định THẬT** chồng lên `v_price_observations` + các bảng gốc.
> Nguyên tắc: **thống kê minh bạch, KHÔNG ML giả** (không sklearn/không random). Mọi con số truy được về SQL. **Dưới ngưỡng dữ liệu → trả `insufficient_data: true` + hiện "chưa đủ dữ liệu", KHÔNG bịa số.**
> **Tái dùng tối đa**: `code_history` (`price_analytics.py:883`) đã fetch sẵn per-code: `pricing` (v1/v4 median+min+max), `won_pricing_row` (`bqms_samsung_po.unit_price` median/min/max/count — `price_analytics.py:995`), `market_row` (XNK `price_vnd/usd` — `:1008`), `purchase_price_vnd` median (`:258`), `departments`/`buyers` win-rate, `frequency` (inter-arrival ngày + `next_expected_date` — `:966`), helper `_linear_regression` (`:113`), `_ewma` (`:130`), `_inter_arrival_stats` (`:90`). → F1/F2/F3 phần lớn là **thêm 1 khối tính trên rows đã có**, không query mới nặng.

### 8.0 SỰ THẬT DỮ LIỆU phải biết trước (đọc kỹ — quyết định cái gì khả thi)

| # | Sự thật (file:line) | Hệ quả cho prediction |
|---|---|---|
| D1 | `bqms_rfq.result` là ENUM `rfq_result{pending,won,lost,cancelled}` (`init_v3.sql:122-127`) NHƯNG toàn bộ code prod match bằng `result::text ILIKE '%won%'/'%lost%'` (`price_analytics.py:183-188, 605, 1074`; `analytics_trends.py:87-90`) | Dữ liệu thực **có thể chứa chuỗi result KHÔNG chuẩn** (vd 'Won'/'WON'/'won thau'). **Mọi công thức F1 PHẢI dùng cùng pattern ILIKE**, không so `= 'won'`. **Cần đo**: `SELECT result::text, count(*) FROM bqms_rfq GROUP BY 1` để biết phân bố thật. |
| D2 | Giá chào **và** kết quả nằm CÙNG 1 dòng `bqms_rfq` (`quoted_price_bqms_v1..v4` + `result` — `init_v3.sql:687-693`) | **F1 win-zone khả thi KHÔNG cần join chéo**: mỗi dòng đã có (giá mình chào, thắng/thua). Đây là điểm mấu chốt khiến F1 làm được thật. |
| D3 | `quoted_price_bqms_v1..v4` **KHÔNG có cột currency** — hệ coi **USD**, `USD_VND=24500` (`price_analytics.py:706`, `analytics_trends.py:706`) | **Win-zone và win-prob tính THUẦN trên giá chào (cùng đơn vị USD, không cần quy đổi)** → an toàn. **Chỉ khi tính BIÊN LÃI** mới phải quy đổi để so với `cost_ncc` (VND/RMB) — chỗ này là **điểm dễ sai**, phải verify V1=USD trước (đã ghi §2.2 nốt 1, §6). Nếu chưa chắc → F1 trả win-zone + win-prob (đáng tin) nhưng **để `margin_at_suggested = null` + disclaimer "chưa quy đổi tiền tệ"**. |
| D4 | Giá TRÚNG thật = `bqms_samsung_po.unit_price` nối theo `bqms_code` (`price_analytics.py:1002-1003`), currency ENUM chuẩn (`init_v3.sql:856`) | `won_po` **đáng tin về tiền tệ** nhưng **đơn vị có thể khác giá chào** (PO thường VND, quote USD). → dùng `won_po` làm **mốc tham chiếu hiển thị**, KHÔNG trộn thẳng vào win-zone của giá chào trừ khi cùng currency. |
| D5 | Sourcing mới live 2026-05-23 (`sourcing_entries.sql:3`); IMV scraper live ~2026-04-29 | **cost_ncc_sourcing / imv_* mẫu MỎNG** → F1 dùng `cost_ncc` từ đây phải kiểm N; thiếu thì bỏ qua nhánh lãi, vẫn tính win-zone. |
| D6 | `frequency.next_expected_date` + `inter_arrival` **ĐÃ TỒN TẠI** (`price_analytics.py:960-974`) | **F3 gần như FREE** — chỉ cần thêm cột "độ sẵn sàng" (đã có giá NCC/sourcing chưa) + xếp hạng nhiều mã. |

> **Ngưỡng chung** (áp cho cả 3 F): mỗi thống kê kèm `sample_size (n)` + cờ `insufficient_data`. FE **luôn hiện n** cạnh mọi con số dự đoán + disclaimer "Gợi ý tham khảo, dựa trên N quan sát". Đây là **bắt buộc** (§8.5 rủi ro).

---

### 8.1 F1 — Giá chào đề xuất + Xác suất thắng (Suggested Quote + Win-Probability)

**Mục tiêu**: với 1 `bqms_code`, trả "vùng thắng", giá đề xuất, xác suất thắng ở giá X, và biên lãi (nếu quy đổi được).

**INPUT (cột/bảng thật)**

| Đại lượng | Nguồn thật (file:line) |
|---|---|
| Giá mình chào từng lần + kết quả | `bqms_rfq.quoted_price_bqms_v4` (giá chốt; fallback v1 nếu v4 null) + `result` cùng dòng (`init_v3.sql:687-693`) |
| Giá trúng thật (mốc) | `bqms_samsung_po.unit_price` median/min/max (đã có: `price_analytics.py:995-1006` → `won_price_*`) |
| Giá thị trường (trần đối thủ) | `xnk_price_lookup.price_vnd/usd` median (đã có: `:1008-1018` → `market_median_*`) |
| Giá vốn NCC | `bqms_rfq.purchase_price_vnd` median (`:258`) HOẶC `sourcing_supplier_prices.cost_vnd_equiv` / `sourcing_entries.cost_vnd` |

**CÔNG THỨC / QUY TẮC (thống kê, không ML)**

Gọi tập giá chào đã-có-kết-quả của mã: `WON = {giá chào của dòng result~won}`, `LOST = {giá chào của dòng result~lost}` (dùng `COALESCE(quoted_price_bqms_v4, quoted_price_bqms_v1)`, `>0`).

1. **Win zone (vùng thắng)** — percentile giá thắng:
   - `win_ceiling = PERCENTILE_CONT(0.75) trên WON` (giá cao mà vẫn thắng được 75% lần).
   - `win_floor   = PERCENTILE_CONT(0.25) trên WON`.
   - `loss_floor  = PERCENTILE_CONT(0.25) trên LOST` (giá thấp nhất mà vẫn thua — nếu có).
   - "Vùng an toàn" = `[win_floor, min(win_ceiling, loss_floor)]`. Nếu `LOST` rỗng → dùng `[win_floor, win_ceiling]`.
2. **Xác suất thắng ở giá X** (KISS, tần suất — KHÔNG logistic/sklearn):
   `win_prob(X) = COUNT(WON ≤ X) / COUNT(WON ≤ X ∪ LOST ≤ X)`
   = "trong các lần mình chào ≤ X, tỷ lệ thắng". Tính sẵn 3 điểm mốc: `win_prob(win_floor)`, `win_prob(median_won)`, `win_prob(win_ceiling)` để FE vẽ đường bậc thang. (Nếu muốn 1 đường mượt: logistic thô `1/(1+e^(k(X−x50)))` với `x50 = median toàn bộ decided`, `k` chuẩn hoá theo IQR — **chỉ làm nếu Thang muốn, YAGNI, mặc định dùng tần suất**.)
3. **Giá đề xuất**:
   `suggested = min( cost_ncc_vnd * (1 + target_margin), win_ceiling )`
   - `target_margin` = tham số (mặc định 0.15 = giữ lãi 15%; cho Thang chỉnh qua query `?target_margin=`).
   - Nếu `cost_ncc` thiếu (D5) → `suggested = win_ceiling` + cờ `margin_unknown=true`.
   - **Đơn vị**: nếu `cost_ncc` là VND mà giá chào là USD (D3) → KHÔNG so trực tiếp; quy `cost_ncc` sang USD bằng `USD_VND` **hoặc** để `suggested` theo giá-chào-unit + trả `margin_at_suggested=null` + `currency_note`.
4. **Biên lãi tại giá đề xuất**:
   `margin_pct = (suggested_vnd − cost_ncc_vnd) / suggested_vnd`  (cả 2 đã cùng VND). Chỉ trả khi cả 2 quy đổi được.

**NGƯỠNG DỮ LIỆU (đáng tin)**

- Cần `|WON| + |LOST| ≥ 5` **và** `|WON| ≥ 2` → mới trả win-zone + win-prob. Dưới ngưỡng: `insufficient_data:true`, chỉ hiện `won_price_median` (mốc PO) + market median làm tham khảo.
- **CẦN ĐO THẬT** (không hứa): bao nhiêu `bqms_code` đạt ≥5 dòng decided? Chạy:
  `SELECT count(*) FROM (SELECT bqms_code FROM bqms_rfq WHERE (result::text ILIKE '%won%' OR result::text ILIKE '%lost%') AND COALESCE(quoted_price_bqms_v4,quoted_price_bqms_v1)>0 GROUP BY bqms_code HAVING count(*)>=5) t;`
  → nếu số này nhỏ (vài chục mã), F1 **chỉ bật cho mã đủ mẫu**, còn lại fallback mốc PO. **Đây là rào lớn nhất của F1.**

**OUTPUT** — nhúng vào `code_history` block mới `pricing_suggestion` (KHÔNG endpoint mới):
```json
"pricing_suggestion": {
  "insufficient_data": false,
  "sample": { "won": 6, "lost": 4, "decided": 10, "unit": "USD" },
  "win_zone": { "floor": 12.5, "ceiling": 15.8, "unit": "USD" },
  "win_prob_curve": [
    {"price": 12.5, "prob": 0.83}, {"price": 14.0, "prob": 0.71}, {"price": 15.8, "prob": 0.55}
  ],
  "suggested_price": 15.2,
  "suggested_unit": "USD",
  "target_margin_pct": 0.15,
  "cost_ncc_vnd": 280000,
  "margin_at_suggested_pct": 0.18,
  "margin_unknown": false,
  "currency_note": null,
  "reference": { "won_po_median": 372000, "won_po_unit": "VND", "market_median_vnd": 350000 },
  "disclaimer": "Gợi ý tham khảo dựa trên 10 lần chào có kết quả của mã này."
}
```

---

### 8.2 F2 — Hướng/Đà giá (Price momentum)

**Mục tiêu**: với 1 mã, đo xu hướng giá vốn + giá thị trường N tháng gần nhất → nhãn tăng/giảm/ổn định + cảnh báo.

**INPUT (cột/bảng thật)**
- Giá vốn theo tháng: `v_price_observations WHERE product_key=$1 AND price_role IN ('cost_ncc_bqms','cost_ncc_sourcing')` → median `price_vnd`/tháng.
- Giá thị trường theo tháng: `price_role='market_xnk'` → median `price_vnd`/tháng (đã có `monthly_trend` cho v1 ở `code_history`, mở rộng thêm role cost/market).
- Có thể tính thẳng trên `code_history.monthly_trend` (đã group theo tháng) nếu chỉ cần trend giá chào; muốn cost/market thì thêm 2 series từ VIEW.

**CÔNG THỨC / QUY TẮC** — **tái dùng `_linear_regression` (`price_analytics.py:113`)**, KHÔNG viết mới:
1. Series median VND theo tháng (fill tháng trống = bỏ, không nội suy). Với mỗi role (cost, market):
   `reg = _linear_regression(series)` → `slope` (VND/tháng), `r_squared`.
2. `pct_change = (last − first) / first * 100` trên khoảng N tháng.
3. Nhãn: `slope > 0 và pct_change ≥ +5% → "tăng"`; `≤ −5% → "giảm"`; giữa → "ổn định". (Ngưỡng 5% chỉnh được.)
4. Cảnh báo (rule, không ML): nếu `cost` label='tăng' **và** `market` label∈{tăng,ổn định} → `"Giá vốn đang tăng ~X%/N tháng — cân nhắc chào cao hơn"`. Nếu `cost` tăng nhưng `market` giảm → `"Giá vốn tăng nhưng thị trường giảm — biên lãi bị ép, xem lại NCC"`.

**NGƯỠNG DỮ LIỆU**
- Cần **≥ 3 tháng có dữ liệu** cho 1 role mới tính slope (khớp ngưỡng forecast hiện có: `count_series >= 3` ở `price_analytics.py:1226`). Dưới ngưỡng → `insufficient_data:true`, chỉ hiện điểm giá gần nhất.
- **Realistic**: giá vốn BQMS (`purchase_price_vnd`) có bề dày lịch sử; **market XNK dày nhất (~35K dòng, §0)** → F2 trên market **đáng tin ngay**. cost_ncc_sourcing mỏng (D5) → thường dưới ngưỡng vài tháng đầu, để fallback.

**OUTPUT** — nhúng `code_history` block `price_momentum`:
```json
"price_momentum": {
  "window_months": 6,
  "cost_ncc": { "insufficient_data": false, "n_months": 5, "slope_vnd_per_month": 4200,
                "pct_change": 9.1, "label": "tăng", "r_squared": 0.62 },
  "market_xnk": { "insufficient_data": false, "n_months": 6, "slope_vnd_per_month": 1500,
                  "pct_change": 3.0, "label": "ổn định", "r_squared": 0.41 },
  "alert": "Giá vốn đang tăng ~9%/6 tháng — cân nhắc chào cao hơn."
}
```

---

### 8.3 F3 — Radar mã sắp bị hỏi lại (Repeat-RFQ radar)

**Mục tiêu**: dự đoán forward-looking — mã nào sắp được Samsung/IMV hỏi lại + đã sẵn sàng chào chưa. **100% data thật, không random.**

**INPUT (cột/bảng thật)** — phần lớn **ĐÃ TÍNH SẴN**:
- Cadence hỏi lại: `bqms_rfq.inquiry_date` theo `bqms_code` → inter-arrival đã có ở `frequency` (`price_analytics.py:966-974`: `inter_arrival_days_avg/stddev`, `next_expected_date`, `next_expected_confidence`).
- Độ sẵn sàng: có giá NCC? (`bqms_rfq.purchase_price_vnd IS NOT NULL` hoặc `sourcing_entries` theo code) · có sourcing? (`sourcing.py /by-code`) · có giá trúng cũ? (`bqms_samsung_po`).

**CÔNG THỨC / QUY TẮC (thống kê)** — cho **danh sách nhiều mã** (radar toàn cục), 1 query:
```sql
WITH per_code AS (
  SELECT bqms_code,
         COUNT(*) AS ask_count,
         MAX(COALESCE(inquiry_date, created_at::date)) AS last_ask,
         -- cadence = trung bình khoảng cách giữa các lần hỏi (ngày)
         (MAX(COALESCE(inquiry_date,created_at::date)) - MIN(COALESCE(inquiry_date,created_at::date)))::numeric
           / NULLIF(COUNT(*)-1,0) AS cadence_days
  FROM bqms_rfq
  WHERE bqms_code IS NOT NULL
  GROUP BY bqms_code
  HAVING COUNT(*) >= 3            -- ngưỡng: ≥3 lần hỏi mới có cadence
)
SELECT bqms_code, ask_count, last_ask, ROUND(cadence_days,0) AS cadence_days,
       (CURRENT_DATE - last_ask) AS days_since_last,
       -- điểm "đến hạn": >1 nghĩa là đã quá cadence
       ROUND((CURRENT_DATE - last_ask) / NULLIF(cadence_days,0), 2) AS due_ratio
FROM per_code
WHERE cadence_days > 0
ORDER BY due_ratio DESC;   -- mã quá hạn hỏi nhất lên đầu
```
- **Nhãn**: `due_ratio ≥ 0.8 → "sắp hỏi lại"`; `≥ 1.2 → "đã quá kỳ (có thể đã hỏi nơi khác)"`; `< 0.8 → "chưa tới"`.
- **Xếp hạng độ sẵn sàng** (0–3): +1 có `purchase_price_vnd`, +1 có sourcing entry, +1 có `won_po` cũ. Kết hợp: **ưu tiên mã `due_ratio` cao NHƯNG readiness thấp** = "sắp bị hỏi mà chưa có giá vốn — chuẩn bị ngay".

**NGƯỠNG DỮ LIỆU**
- Cần **≥ 3 lần hỏi** cho 1 mã mới có cadence (đủ 2 khoảng cách). Dưới ngưỡng → không đưa vào radar (không đoán từ 1 điểm).
- **Realistic**: BQMS RFQ có nhiều mã lặp lại nhiều lần (bản chất báo giá định kỳ Samsung) → **F3 khả thi NGAY, dữ liệu dày nhất trong 3 F.** IMV cadence (`imv_orders.order_date` theo `item_code`) tính tương tự nếu muốn (Đợt sau).

**OUTPUT** — endpoint MỚI (vì là danh sách nhiều mã, không thuộc 1 code): `GET /analytics/repeat-rfq-radar?limit=30&min_asks=3`
```json
{ "data": { "generated_at": "...", "items": [
  { "bqms_code": "ABC123", "ask_count": 7, "cadence_days": 42, "days_since_last": 50,
    "due_ratio": 1.19, "label": "đã quá kỳ", "last_ask": "2026-05-13",
    "readiness_score": 1, "has_cost": false, "has_sourcing": true, "has_won_po": false,
    "hint": "Sắp/đã tới kỳ hỏi lại nhưng chưa có giá vốn — chuẩn bị NCC." }
] } }
```

---

### 8.4 NƠI HIỂN THỊ (KISS — tái dùng, KHÔNG trang mới)

| Tính năng | Nơi nhúng | Lý do |
|---|---|---|
| **F1 pricing_suggestion** | Block mới trong **CodeHistoryDrawer** (drawer đã có section giá v1/v4/won/market — `CodeHistoryDrawer.tsx`, data từ `code_history`) + **badge trong form Báo giá BQMS / SourcingFormDrawer** (khi có `bqms_code`, hiện "Giá đề xuất: X · Win-prob ~Y% · Lãi ~Z%") | Drawer là hub đã có mọi mốc giá; form là nơi người ta THỰC SỰ quyết giá → gợi ý đúng chỗ. |
| **F2 price_momentum** | Cùng CodeHistoryDrawer, ngay dưới chart monthly_trend (1 dòng badge "Giá vốn: ↑9% · Thị trường: →3%") | Chart đã ở đó; chỉ thêm nhãn xu hướng. |
| **F3 repeat-rfq-radar** | **1 panel mới "Sắp phải báo giá lại" trên trang `/analytics/price-trends`** (đã là trang phân tích, không tạo route mới) — bảng top-30 `due_ratio`, click mở CodeHistoryDrawer | Forward-looking → hợp trang phân tích; click-through về hub đã có. |

- **Endpoint**: F1+F2 **KHÔNG thêm endpoint** — chèn 2 block vào response `code_history` (`price_analytics.py:1288`). F3 = 1 endpoint mới `GET /analytics/repeat-rfq-radar` (list nhiều mã). Tất cả giữ `require_role` nội bộ, **KHÔNG mount vào `vendor_router`** (§6 bảo mật).

### 8.5 RỦI RO & YAGNI (đọc trước khi code)

- **Dữ liệu mỏng hại hơn không có**: gợi ý giá sai (vd win-zone từ 2 mẫu) khiến chào hớ → **mất tiền thật**. Bắt buộc: (a) ngưỡng cứng (F1 ≥5 decided, F2 ≥3 tháng, F3 ≥3 lần hỏi); (b) **luôn hiện `n` + disclaimer** cạnh mọi số; (c) dưới ngưỡng hiện "chưa đủ dữ liệu", tuyệt đối không suy từ 1–2 điểm.
- **Currency trap (D3)**: đừng tính biên lãi khi chưa chắc V1/V4 là USD hay VND. Verify luồng nhập `bqms_rfq` trước. Chưa chắc → F1 vẫn ra win-zone/win-prob (thuần giá chào, an toàn) nhưng `margin=null`.
- **result không chuẩn (D1)**: dùng cùng `ILIKE '%won%'/'%lost%'` như code hiện tại; đo phân bố `result` thật trước.
- **KHÔNG làm quá tay**: (a) không logistic regression/sklearn — tần suất đủ; (b) không dự báo giá tuyệt đối tương lai (chỉ nhãn xu hướng + vùng thắng); (c) không tự-động-điều-chỉnh-giá — chỉ GỢI Ý, người quyết; (d) không radar IMV vội (Đợt sau, sau khi BQMS radar chạy).

### 8.6 GẮN VÀO KẾ HOẠCH ĐỢT

Chèn **"Đợt 2.5 — TẦNG DỰ ĐOÁN"** giữa Đợt 2 (đã có VIEW + tra cứu đa nguồn) và Đợt 3 (UX badge). Lý do: F1/F2 tái dùng dữ liệu VIEW + `code_history` của Đợt 1–2; F3 độc lập (chỉ cần `bqms_rfq`) nên **có thể làm SỚM, song song Đợt 1**.

| # | File đụng | Sửa | Verify | Phụ thuộc |
|---|---|---|---|---|
| 2.5.0 | — (đo trước) | Chạy 3 query đo: phân bố `result`; số mã ≥5 decided (F1); số mã ≥3 lần hỏi (F3) | Có số thật để quyết bật/tắt F1 | Không |
| 2.5.1 | `analytics_trends.py` (endpoint mới) | `GET /repeat-rfq-radar` (§8.3) | Trả top-30 mã `due_ratio` | Chỉ `bqms_rfq` → **làm sớm** |
| 2.5.2 | `price-trends/page.tsx` | Panel "Sắp phải báo giá lại" (bảng radar, click → drawer) | Panel hiện danh sách, click mở đúng mã | 2.5.1 |
| 2.5.3 | `price_analytics.py:1288` (code_history) | Thêm block `pricing_suggestion` (§8.1) + `price_momentum` (§8.2) — tái dùng rows đã fetch + `_linear_regression` | code_history trả 2 block mới, mã đủ mẫu ra số, mã thiếu ra `insufficient_data` | Đợt 1 (VIEW cho cost/market series của F2) |
| 2.5.4 | `CodeHistoryDrawer.tsx` | Render block gợi ý giá + nhãn momentum (kèm `n` + disclaimer) | Mã đủ mẫu thấy win-zone/win-prob/momentum; mã thiếu thấy "chưa đủ dữ liệu" | 2.5.3 |
| 2.5.5 | form Báo giá BQMS + `SourcingFormDrawer.tsx` | Badge "Giá đề xuất X · Win-prob Y% · Lãi Z%" gọi code_history khi có bqms_code | Nhập mã đủ mẫu → badge hiện gợi ý | 2.5.3 |

> **Thứ tự thực dụng**: 2.5.0 (đo) → 2.5.1/2.5.2 (F3, làm ngay, không chờ VIEW) → 2.5.3–2.5.5 (F1+F2, sau Đợt 1–2).

---

## 9. TẦNG LÀM SẠCH DATA + TINH CHỈNH TỰ ĐỘNG (Cleaning & Auto-Tuning Layer)

> Thêm 2026-07-02. Trả lời yêu cầu của Thang: **chèn 1 tầng LÀM SẠCH + TINH CHỈNH TỰ ĐỘNG đặt GIỮA** VIEW thô `v_price_observations` (§2) và tầng hiển thị/dự đoán (§3, §8). Data phải qua bộ lọc trước khi tới biểu đồ + gợi ý giá.
> **Lý do**: median, win-zone (F1), momentum (F2) **cực nhạy với data bẩn** — 1 dòng VND bị coi USD làm median lệch 24.500 lần; 1 dòng FOC giá 0 kéo `win_floor` về 0; 2 dòng sinh-đôi làm `n` phồng gấp đôi.
> **Nguyên tắc**: thống kê ROBUST thuần SQL (median + MAD + percentile + window) — **KHÔNG sklearn/ML**. **Minh bạch tuyệt đối**: mọi bộ lọc đếm được đã loại gì (`dropped_reason`), chỉnh được (`price_intel_config`), KHÔNG âm thầm. Lọc quá tay = mất data thật → mọi ngưỡng tự-thích-nghi hoặc config, KHÔNG hardcode.

### 9.0 SỰ THẬT DATA BẨN — ĐÃ XÁC MINH bằng đọc code (không tin mù)

| # | Vấn đề | Bằng chứng (file:line) | Cột thật liên quan | Xử lý ở tầng |
|---|---|---|---|---|
| C1 | **Dòng sinh đôi** `bqms_rfq` ~116 cặp `(rfq_number, bqms_code)` do `data_source='etl'` vs `'onedrive_sync'` | Quy tắc dedup đã có: `bqms.py:800-846` (comment 116 cặp + `dedup_cte`); migration `bqms_rfq_dedup_collapse.sql:19-21,56-60`; `import_all_data.py:55`/`import_precise.py:48` set `DATA_SOURCE='onedrive_sync'` | `rfq_number, bqms_code, data_source, quote_unlocked, quoted_price_bqms_v1..v4, bqms_push_status, updated_at, id` | **L1** (tái dùng đúng `DISTINCT ON` của `bqms.py:832-846`) |
| C2 | **Giá 0 / FOC** — Samsung bỏ thầu/abandon đẩy 0; cổng NCC có cột `free_charge` ép `unit_price=0` | `bqms_quote_pusher.py:1274` ("SUBMIT_GIVEUP='Y' so placeholder must be 0"); ETL map `("FREE_CHARGE","free_charge")`, `("SUBMIT_GIVEUP","abandonment")` `bqms_bidding_scraper.py:78-79`; vendor `quotes.py:360-361` (`free_charge → unit_price=0`); analytics loại FOC: `procurement.py:1698` (`vqi.free_charge IS NOT TRUE`) | `bqms_rfq.quoted_price_bqms_v*`, `vendor_quote_items.free_charge/can_do`, `bqms_samsung_po.unit_price` | **L2** (`> 0` + loại `free_charge=TRUE`) |
| C3 | **Nhập nhằng tiền tệ** — `quoted_price_bqms_v1..v4` KHÔNG có cột currency. **MÂU THUẪN THẬT trong code**: DESIGN §2.2 nốt-1 giả định **USD**, nhưng comment prod `analytics_trends.py:704` ghi rõ **"V1 lưu VND nên chia 24500 để so sánh USD"** | `init_v3.sql:687-690` (4 cột giá, không currency); `analytics_trends.py:704-706` (`USD_VND=24500`, "V1 lưu VND"); ngược với DESIGN §2.2 nốt-1 | `quoted_price_bqms_v1..v4` (không currency); `bqms_samsung_po.currency` = ENUM chuẩn (`init_v3.sql:849,92-97`) | **L3** (phát hiện nghi-sai-đơn-vị per-mã; **CẦN ĐO DATA THẬT** để chốt V1=USD hay VND) |
| C4 | **Tên đối tác gõ tự do** (TEXT, chưa chuẩn hoá) | `sourcing_entries.supplier_name/customer_name` = `TEXT` (`sourcing_entries.sql:11,40`); `xnk_price_lookup.seller_name` = `TEXT` (`xnk_lookup.sql:27`); `imv_orders.customer_name` = `VARCHAR(255)` (`imv_module_v2.sql:26`). **Đã có helper chuẩn hoá tái dùng**: `market_prices.py:36` `NORMALIZED_SELLER_SQL = NULLIF(REGEXP_REPLACE(BTRIM(seller_name),'\s+',' ','g'),'')` | các cột `*_name` | **L6** (tái dùng `NORMALIZED_SELLER_SQL`) |
| C5 | **Soft-delete** — phải loại dòng đã xoá | `sourcing_entries.deleted_at TIMESTAMPTZ` thêm ở `sourcing_catalog_fields.sql:32`; đã dùng thật: `sourcing.py:355` (`se.deleted_at IS NULL`) | `sourcing_entries.deleted_at` | **L2** (điều kiện `deleted_at IS NULL`) |
| C6 | **Data cũ nhiễu xu hướng** — cần cắt cửa sổ thời gian | cột ngày có sẵn: `bqms_rfq.inquiry_date` (`init_v3.sql:679`), `sourcing_entries.inquiry_date` (`sourcing_entries.sql:18`), `xnk_price_lookup.rfq_date/quoted_date` (`xnk_lookup.sql:7,19`), `imv_orders.order_date` (`imv_module_v2.sql:20`) → đã COALESCE thành `obs_date` trong VIEW (§2.1) | `obs_date` | **L5** (recency window, config) |
| C7 | **`exchange_rates` thiếu rate** → `price_vnd` ra NULL/sai (MEMORY: Thang chưa nhập đủ vài mốc) | schema `exchange_rates` UNIQUE `(rate_date,from_currency,to_currency,rate_type)` (`init_v3.sql:375-386`); `fn_to_vnd` trả NULL khi thiếu rate (§2.3) | `price_vnd IS NULL` khi thiếu | **L2/L7** (quan sát thiếu `price_vnd` → gắn cờ, KHÔNG dùng cho thống kê VND; vẫn giữ `price_goc` để hiển thị) |

> **Ghi chú trung thực**: C1/C2/C5/C6 = **rẻ + chắc** (điều kiện WHERE đơn giản, quy tắc đã có trong code). C3 (phát hiện sai currency) và L4 (outlier robust) = **cần đo data thật trước** vì có nguy cơ false-positive; mặc định **GẮN CỜ, không xoá** (xem §9.4).

### 9.1 SƠ ĐỒ PIPELINE (thô → 7 tầng lọc → sạch → hiển thị)

```
┌──────────────────────────────────────────────────────────────────────┐
│  VIEW THÔ  v_price_observations  (§2 — UNION ALL 6 nhánh, giữ NGUYÊN) │
│  = SINGLE SOURCE OF TRUTH thô, dùng để AUDIT. KHÔNG sửa.              │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  (mỗi dòng gắn dần cờ dropped_reason,
                                │   KHÔNG xoá vật lý — minh bạch)
                                ▼
        ╔═══════════════ CLEANING PIPELINE (7 tầng) ══════════════════╗
        ║  L1  Dedup sinh-đôi     → DISTINCT ON (tái dùng bqms.py)     ║
        ║  L2  Giá không hợp lệ   → price>0, ¬FOC, deleted_at IS NULL  ║
        ║  L3  Currency guard     → cờ suspect_currency (đo trước)     ║
        ║  L4  Outlier robust/mã  → median±k·MAD (k từ config, AUTO)   ║  ← "tinh chỉnh tự động"
        ║  L5  Recency window     → obs_date ≥ now - N tháng (config)  ║
        ║  L6  Chuẩn hoá thực thể → BTRIM/UPPER mã + party canonical   ║
        ║  L7  Min-sample gating  → n < ngưỡng ⇒ insufficient_data     ║
        ╚═══════════════════════════════╤═════════════════════════════╝
                                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  VIEW SẠCH  v_price_observations_clean                                 │
│  = chỉ dòng qua L1–L6 (dropped_reason IS NULL), + cột quality_score.  │
│  L7 áp Ở TẦNG ĐỌC (endpoint) vì phụ thuộc GROUP-BY của từng màn.      │
└───────┬──────────────────────┬───────────────────────┬───────────────┘
        ▼                      ▼                       ▼
  Xu hướng giá (§3.1)   Tra cứu giá (§3.2)      F1/F2/F3 (§8)
  hiện "n=7, lọc 2      "n sau lọc + n loại"    win-zone/momentum/radar
   ngoại lai"           disclaimer khi mỏng      ĐỌC TỪ LAYER SẠCH
```

### 9.2 BẢNG TỪNG BỘ LỌC (làm gì · cột · SQL/quy tắc · loại hay cờ)

| Tầng | Làm gì | Cột thật | SQL / quy tắc | Loại hay Cờ |
|---|---|---|---|---|
| **L1 Dedup** | Gộp cặp sinh-đôi `(rfq_number, bqms_code)` etl↔onedrive, giữ dòng mang user-action | `rfq_number, bqms_code, quote_unlocked, quoted_price_bqms_v4..v1, bqms_push_status, updated_at, id` | `DISTINCT ON (rfq_number,bqms_code) ORDER BY quote_unlocked::int DESC, (v4 NOT NULL)::int DESC, …(v1)…, (push_status NOT NULL)::int DESC, updated_at DESC, id DESC` — **copy nguyên `bqms.py:832-846`** (DRY). Chỉ áp cho nhánh `source='bqms'` từ `bqms_rfq`. | **LOẠI** (giữ 1) → cờ `dedup_dropped` cho dòng thua |
| **L2 Giá không hợp lệ** | Bỏ giá ≤0/NULL, FOC, đã soft-delete | `price_goc`, `vendor_quote_items.free_charge`, `sourcing_entries.deleted_at` | `price_goc > 0 AND price_goc IS NOT NULL` · nhánh sourcing thêm `deleted_at IS NULL` · nhánh vendor/FOC loại `free_charge IS TRUE` (như `procurement.py:1698`). VIEW §2.4 đã có `WHERE …>0` — L2 chỉ **bổ sung `deleted_at`/FOC** cho đủ. | **LOẠI** → `dropped_reason='nonpositive_price'` / `'foc'` / `'soft_deleted'` |
| **L3 Currency guard** | Phát hiện dòng nghi **sai đơn vị tiền** (VND bị coi USD hoặc ngược lại) | `price_goc, currency_goc, price_vnd`, per `product_key` | Sau khi đã có `price_vnd` (qua `fn_to_vnd`), so `price_vnd` của dòng với **median `price_vnd` cùng mã**: nếu `price_vnd > 100 × median` HOẶC `price_vnd < median / 100` ⇒ nghi lệch bậc-độ-lớn (thường là nhầm ×24500). **Ngưỡng 100× = có chủ ý rộng** để chỉ bắt lỗi đơn-vị, không bắt biến động giá thường. | **CỜ** `suspect_currency=true` (KHÔNG xoá; C3 chưa chốt V1=USD/VND → xoá = nguy hiểm). **CẦN ĐO DATA THẬT** trước khi bật loại. |
| **L4 Outlier robust/mã** | **Tinh chỉnh tự động**: loại điểm cách xa median CỦA TỪNG MÃ theo MAD (tự thích nghi, KHÔNG ngưỡng cứng) | `price_vnd` (fallback `price_goc` nếu VND NULL), partition theo `product_key` (+ tuỳ chọn `price_role`) | Xem công thức MAD §9.5. Loại khi `robust_z = 0.6745·|x − median| / MAD > k` (mặc định `k=3.5` từ config). MAD=0 (mọi giá bằng nhau) ⇒ không loại gì. | **LOẠI** → `dropped_reason='outlier_mad'` + lưu `robust_z` để hiển thị |
| **L5 Recency window** | Cắt data quá cũ khỏi thống kê xu hướng | `obs_date` | `obs_date >= (CURRENT_DATE - (cfg.recency_months \|\| ' months')::interval)`. Mặc định 24 tháng (config). | **LOẠI khỏi thống kê** → `dropped_reason='stale'` (vẫn xem được ở chế độ audit) |
| **L6 Chuẩn hoá thực thể** | Trim/chuẩn mã + tên đối tác canonical (KISS) | `product_key, bqms_code, party_name` | Mã: `UPPER(NULLIF(REGEXP_REPLACE(BTRIM(product_key),'\s+','','g'),''))`. Tên: **tái dùng** `NULLIF(REGEXP_REPLACE(BTRIM(party_name),'\s+',' ','g'),'')` (`market_prices.py:36`) → cột phụ `party_name_canon`. **KISS: chỉ trim+collapse-space+upper, KHÔNG fuzzy-match.** | **GẮN CỘT** `product_key_canon, party_name_canon` (không xoá bản gốc) |
| **L7 Min-sample gating** | Không hiện dự đoán khi mẫu mỏng | `COUNT(*)` sau L1–L6 theo nhóm hiển thị | `n = count(*)`; nếu `n < cfg.min_sample` (mặc định 5, khớp F1 §8.1) ⇒ `insufficient_data=true`, FE hiện "chưa đủ dữ liệu". **Áp ở endpoint** (phụ thuộc GROUP-BY từng màn: mã / mã×role / mã×tháng). | **CỜ** `insufficient_data` (không loại dòng, chỉ chặn hiển-thị-dự-đoán) |

### 9.3 NƠI ĐẶT TẦNG NÀY — VIEW lồng VIEW (khuyến nghị KISS)

**Quyết định: VIEW `v_price_observations_clean` bọc VIEW thô** (L1–L6 nằm trong VIEW sạch), **L7 ở endpoint**.

| Phương án | Ưu | Nhược | KISS? |
|---|---|---|---|
| **(A) VIEW lồng VIEW** `v_price_observations_clean` **← CHỌN** | 1 nơi định nghĩa sạch, DRY (mọi màn + F1/F2/F3 đọc chung); rollback = `DROP VIEW …_clean` (VIEW thô còn nguyên để audit); test độc lập (`SELECT dropped_reason, count(*) …`) | L4 (MAD per-mã) là window-function trên toàn tập → cần index `product_key` + `obs_date` để không chậm | ✅ Cao nhất |
| (B) CTE lặp trong từng endpoint | Không thêm object DB | Vi phạm DRY (copy MAD 3-4 chỗ), dễ lệch quy tắc giữa các màn, khó audit | ❌ |
| (C) MATERIALIZED VIEW sạch | Nhanh khi data lớn | YAGNI bây giờ (data nhỏ, §2.4); refresh-lag; phức tạp | ⏳ chỉ khi đo chậm |

- **Giữ data thô để audit**: VIEW thô `v_price_observations` KHÔNG đổi. VIEW sạch chỉ thêm `WHERE dropped_reason IS NULL` + cột `quality_score`. Muốn xem "đã loại gì" → query thẳng CTE trung gian (§9.5 expose `dropped_reason`).
- **L4/L5/L7 phụ thuộc config** → VIEW sạch **đọc `price_intel_config`** qua subquery/CROSS JOIN 1 dòng (bảng bé, cache tốt). Đổi knob = `UPDATE price_intel_config` rồi VIEW tự áp lần query kế (không phải sửa code).
- **L7 ở endpoint** (không trong VIEW): vì ngưỡng min-sample áp theo **nhóm hiển thị khác nhau** mỗi màn (Tra cứu = theo mã; Xu hướng = theo mã×tháng×role; F1 = theo mã×won/lost). Đặt trong VIEW sẽ sai altitude.

### 9.4 "TINH CHỈNH TỰ ĐỘNG" NGHĨA LÀ GÌ + BẢNG CONFIG

**"Tinh chỉnh tự động" = 2 lớp:**
1. **Ngưỡng outlier AUTO per-mã (robust, tự thích nghi)** — L4 dùng median+MAD **tính riêng cho từng `product_key`**, nên ngưỡng loại (`median ± k·MAD`) **tự co giãn theo độ phân tán thật của từng mã** — mã giá ổn định → dải hẹp, loại nhạy; mã giá dao động thật → dải rộng, ít loại oan. KHÔNG hardcode "loại nếu > 1 triệu". Chỉ hằng số `k` (bao nhiêu MAD) là config, mặc định 3.5.
2. **Config chỉnh tay** — mọi knob nằm 1 bảng nhỏ key/value, admin `UPDATE`, mặc định hợp lý:

```sql
-- migration price_intel_config.sql (Đợt 1, ngay sau VIEW thô)
CREATE TABLE IF NOT EXISTS price_intel_config (
    key         TEXT PRIMARY KEY,
    value       NUMERIC      NOT NULL,      -- dùng NUMERIC cho knob số; bật/tắt = 0/1
    description TEXT,
    updated_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_by  UUID         REFERENCES users(id)
);
INSERT INTO price_intel_config (key, value, description) VALUES
  ('mad_k',              3.5, 'L4: số MAD để coi là ngoại lai (robust_z > k). Cao=nới, thấp=chặt'),
  ('recency_months',      24, 'L5: cửa sổ thời gian (tháng) cho thống kê xu hướng'),
  ('min_sample',           5, 'L7: n tối thiểu mới hiện dự đoán, dưới ngưỡng = chưa đủ dữ liệu'),
  ('currency_ratio',     100, 'L3: bội số lệch median để nghi sai đơn vị tiền tệ'),
  ('enable_L3_currency',   0, 'Bật/tắt L3 (mặc định TẮT=chỉ gắn cờ; bật=loại — cần đo trước)'),
  ('enable_L4_outlier',    1, 'Bật/tắt L4 lọc ngoại lai MAD'),
  ('enable_L5_recency',    1, 'Bật/tắt L5 cắt thời gian')
ON CONFLICT (key) DO NOTHING;
```
- **Mỗi bộ lọc bật/tắt được** (`enable_L*`) — L3 mặc định **0 (chỉ gắn cờ, không loại)** vì C3 chưa chốt V1=USD/VND; L4/L5 mặc định bật. Admin chỉnh qua endpoint `PATCH /analytics/price-intel/config` (giữ `require_role` admin nội bộ).

**Điểm chất lượng + cờ lý do loại (minh bạch):**
- Mỗi **quan sát** giữ cột `dropped_reason TEXT` (NULL = sạch) + `robust_z NUMERIC` (khoảng cách MAD) + `suspect_currency BOOL`.
- Mỗi **mã** (khi hiển thị) có **`quality_score` 0–100**: KISS = `100 − 25·(có suspect_currency) − 15·(recency mỏng) − penalty theo tỷ lệ outlier`. FE hiện chip: `n=7 · đã lọc 2 ngoại lai · chất lượng 82`.
- API mọi màn trả kèm `{ n_raw, n_clean, n_dropped, dropped_breakdown: {outlier_mad:2, foc:1, stale:3}, quality_score }` → hiển thị "n=7, đã lọc 2 ngoại lai" (§9.6). **KHÔNG âm thầm**: người dùng luôn thấy đã loại bao nhiêu, vì sao.

### 9.5 PHÁC THẢO SQL — VIEW SẠCH + CÔNG THỨC MAD PER-MÃ

```sql
-- migration price_intel_clean_view.sql  (Đợt 1, ngay SAU v_price_observations)
-- Yêu cầu: v_price_observations (§2.4), fn_to_vnd (§2.3), price_intel_config (§9.4).
CREATE OR REPLACE VIEW v_price_observations_clean AS
WITH cfg AS (   -- L4/L5/L3 knobs (bảng 1-vài dòng, cache tốt)
  SELECT
    MAX(value) FILTER (WHERE key='mad_k')            AS mad_k,
    MAX(value) FILTER (WHERE key='recency_months')   AS recency_months,
    MAX(value) FILTER (WHERE key='currency_ratio')   AS currency_ratio,
    MAX(value) FILTER (WHERE key='enable_L3_currency')AS en_l3,
    MAX(value) FILTER (WHERE key='enable_L4_outlier') AS en_l4,
    MAX(value) FILTER (WHERE key='enable_L5_recency') AS en_l5
  FROM price_intel_config
),
-- L1 dedup đã xử lý TRONG nhánh bqms của v_price_observations (dùng bqms_dedup CTE
--   khi build VIEW thô — copy bqms.py:832-846). Ở đây coi VIEW thô đã dedup.
base AS (          -- L2 + L6 (giá hợp lệ + chuẩn hoá thực thể)
  SELECT o.*,
         UPPER(NULLIF(REGEXP_REPLACE(BTRIM(o.product_key),'\s+','','g'),'')) AS product_key_canon,
         NULLIF(REGEXP_REPLACE(BTRIM(o.party_name),'\s+',' ','g'),'')        AS party_name_canon,
         COALESCE(o.price_vnd, o.price_goc) AS px   -- dùng VND, fallback giá gốc (C7)
    FROM v_price_observations o
   WHERE o.price_goc > 0            -- L2 (VIEW thô đã lọc >0; guard lần 2)
),
stats AS (         -- L4: median + MAD PER MÃ (robust). Bước 1: median mỗi mã.
  SELECT product_key_canon,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY px) AS med_px,
         COUNT(*) AS n_code
    FROM base
   GROUP BY product_key_canon
),
dev AS (           -- Bước 2: |x − median|, rồi MAD = median các |x−median| CÙNG mã.
  SELECT b.*, s.med_px, s.n_code,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(b.px - s.med_px))
           OVER (PARTITION BY b.product_key_canon) AS mad
    FROM base b JOIN stats s USING (product_key_canon)
),
flagged AS (
  SELECT d.*,
         -- robust z-score (0.6745 = hằng số chuẩn MAD→stddev khi phân phối ~normal)
         CASE WHEN d.mad > 0
              THEN 0.6745 * ABS(d.px - d.med_px) / d.mad
              ELSE 0 END AS robust_z,
         -- L3 nghi sai currency: lệch bậc-độ-lớn so median cùng mã
         (d.med_px > 0 AND (d.px > (SELECT currency_ratio FROM cfg) * d.med_px
                        OR  d.px < d.med_px / (SELECT currency_ratio FROM cfg))) AS suspect_currency
    FROM dev d
),
labelled AS (
  SELECT f.*,
         CASE
           WHEN (SELECT en_l5 FROM cfg) = 1
                AND f.obs_date < CURRENT_DATE - ((SELECT recency_months FROM cfg)||' months')::interval
             THEN 'stale'                                              -- L5
           WHEN (SELECT en_l4 FROM cfg) = 1 AND f.mad > 0
                AND f.robust_z > (SELECT mad_k FROM cfg)
             THEN 'outlier_mad'                                        -- L4
           WHEN (SELECT en_l3 FROM cfg) = 1 AND f.suspect_currency
             THEN 'suspect_currency'                                   -- L3 (chỉ khi BẬT)
           ELSE NULL
         END AS dropped_reason
    FROM flagged f
)
SELECT
  * ,   -- gồm product_key_canon, party_name_canon, med_px, mad, robust_z, suspect_currency
  -- quality_score per-dòng (KISS): trừ điểm theo cờ
  GREATEST(0, 100
     - CASE WHEN suspect_currency THEN 25 ELSE 0 END
     - CASE WHEN robust_z > 3 THEN LEAST(20, (robust_z*3)::int) ELSE 0 END
  ) AS quality_score
FROM labelled
WHERE dropped_reason IS NULL;      -- VIEW SẠCH = chỉ dòng qua được

-- Muốn AUDIT "đã loại gì": bỏ WHERE cuối (hoặc tạo v_price_observations_dropped
--   = SELECT dropped_reason, count(*) FROM labelled GROUP BY 1).
```

**Giải thích MAD per-mã (cốt lõi "tinh chỉnh tự động"):**
- `med_px` = trung vị giá của **riêng mã đó**. `mad` = trung vị của `|giá − median|` của **riêng mã đó** → thước đo phân tán **kháng ngoại lai** (không như stddev, 1 điểm cực đại không thổi phồng MAD).
- `robust_z = 0.6745·|x−median| / MAD` → điểm chuẩn hoá; ngưỡng loại `> mad_k` (3.5 mặc định). Ngưỡng **tự co giãn theo `mad` từng mã** = auto-tuning.
- **An toàn cạnh biên**: `MAD=0` (mọi giá bằng nhau, hoặc `n_code=1`) ⇒ `robust_z=0` ⇒ KHÔNG loại gì (tránh chia 0 và tránh loại oan mã ít mẫu). Mã 1 điểm → không có gì để so → giữ nguyên, để **L7** chặn hiển-thị-dự-đoán.

### 9.6 ẢNH HƯỞNG F1/F2/F3 + HIỂN THỊ (§8 đọc từ layer SẠCH)

- **F1 (win-zone, §8.1)**: percentile WON/LOST tính trên **giá chào đã qua L2+L4** → 1 dòng FOC-0 hay 1 dòng nhầm ×24500 không kéo `win_floor`/`win_ceiling`. **Lưu ý**: F1 chạy trên `bqms_rfq` trực tiếp (giá chào + result cùng dòng, §8 D2) → **áp L1 (dedup) + L2 (price>0) + L4 (MAD trên tập WON và LOST của mã)** ngay trong query F1, KHÔNG nhất thiết qua VIEW (vì F1 cần cột `result`). DRY: dùng cùng hằng `mad_k` từ config.
- **F2 (momentum, §8.2)**: series median/tháng đọc `v_price_observations_clean` (đã bỏ stale + outlier) → slope `_linear_regression` không bị 1 điểm bẩn bẻ cong. L5 (recency) trùng ý `window_months` của F2 — thống nhất đọc `recency_months` từ config.
- **F3 (radar, §8.3)**: cadence đọc `bqms_rfq` sau **L1 dedup** (nếu không, sinh-đôi làm `ask_count` phồng gấp đôi → `cadence_days` sai một nửa). L2/L4 không cần cho F3 (chỉ đếm ngày, không dùng giá).
- **Hiển thị bắt buộc (UI)** — mọi màn (§3) + drawer (§8.4) hiện:
  - Chip: **`n=7 · đã lọc 2 ngoại lai · chất lượng 82`** (từ `{n_clean, dropped_breakdown, quality_score}`).
  - Khi `insufficient_data` (L7): **"Chưa đủ dữ liệu (n=3 < 5)"** thay vì số dự đoán.
  - Khi có `suspect_currency`: banner vàng **"⚠ N dòng nghi sai đơn vị tiền — đang chờ kiểm tra"** (vì L3 mặc định chỉ gắn cờ).
  - Tooltip "đã lọc gì": bung `dropped_breakdown` (outlier_mad / foc / stale / soft_deleted).

### 9.7 GẮN VÀO KẾ HOẠCH ĐỢT (chèn vào Đợt 1, NGAY SAU VIEW thô)

| # | File đụng | Sửa | Verify | Phụ thuộc |
|---|---|---|---|---|
| **1.1a** | migration `price_intel_config.sql` | Tạo bảng config + seed 7 knob mặc định (§9.4) | `SELECT * FROM price_intel_config` ra 7 dòng | Không |
| **1.1b** | migration `price_intel_clean_view.sql` | Tạo `v_price_observations_clean` (§9.5) — L1..L6 trong VIEW | `SELECT dropped_reason, count(*) FROM …(labelled) GROUP BY 1` thấy phân bố loại; `SELECT count(*) FROM v_price_observations_clean` < thô | 1.1 (VIEW thô), 1.1a |
| **1.1c** | (đo trước khi tin) | 3 query đo: (a) `count(*) FILTER(WHERE suspect_currency)` để quyết bật L3; (b) phân bố `robust_z` xem `mad_k=3.5` loại bao nhiêu %; (c) `min/max obs_date` xem 24 tháng còn bao nhiêu | Có số thật → chốt V1=USD/VND (C3) + tinh chỉnh `mad_k`, `recency_months` | 1.1b |
| **1.1d** | endpoints §3 + §8 | Trỏ đọc `v_price_observations_clean` (thay `v_price_observations`); áp **L7** min-sample ở tầng đọc; trả `{n_raw,n_clean,n_dropped,dropped_breakdown,quality_score}` | API trả metadata lọc; F1/F2/F3 đọc layer sạch | 1.1b, §8 |
| **1.1e** | `PATCH /analytics/price-intel/config` (admin) | Endpoint sửa knob (require_role admin nội bộ, **KHÔNG** vendor_router) | Đổi `mad_k` → VIEW áp query kế | 1.1a |
| **1.1f** | FE các màn + drawer | Chip `n · đã lọc X ngoại lai · chất lượng` + banner suspect_currency + "chưa đủ dữ liệu" | Mã có outlier hiện "đã lọc", mã mỏng hiện disclaimer | 1.1d |

> **Lý do chèn Đợt 1**: F1/F2/F3 (§8, Đợt 2.5) + 2 màn (§3, Đợt 2) đều đọc data — nếu dựng layer sạch **sau**, phải sửa lại mọi endpoint. Dựng ngay sau VIEW thô = mọi tầng trên đọc sạch từ đầu (DRY). **1.1c (đo) là chốt chặn**: chưa đo xong currency + phân bố MAD thì **để L3 TẮT, L4 bật nhẹ** (`mad_k` cao) — nới trước, siết sau khi có số.

### 9.8 CẢNH BÁO TRUNG THỰC (đọc trước khi code)

- **Rẻ + chắc, làm ngay**: L1 (dedup, quy tắc đã có `bqms.py`), L2 (price>0/FOC/soft-delete, điều kiện WHERE đã dùng trong prod), L5 (recency), L6 (chuẩn hoá, tái dùng `market_prices.py:36`). Rủi ro thấp.
- **CẦN ĐO DATA THẬT trước khi tin** (ghi rõ, không hứa):
  - **C3 currency (L3)**: mâu thuẫn THẬT — DESIGN §2.2 nói V1=USD, code `analytics_trends.py:704` nói V1=VND. **Phải đo phân bố giá + đọc luồng nhập `bqms_rfq` để chốt** trước khi bật L3 loại. Mặc định L3 **chỉ gắn cờ**, không xoá (xoá nhầm = mất data thật).
  - **L4 MAD**: có thể **false-positive** với mã có giá thật biến động lớn (đơn hàng số lượng khác nhau → đơn giá khác thật). `mad_k=3.5` là điểm khởi đầu; **đo `robust_z` phân bố (1.1c) rồi chỉnh**. Đừng để `mad_k` quá thấp (siết quá tay = mất data thật).
- **Lọc quá tay hại hơn không lọc**: mọi tầng **đếm được đã loại gì** (`dropped_reason` + `dropped_breakdown`), **chỉnh được** (config), **KHÔNG âm thầm** (UI luôn hiện "đã lọc N"). Data thô giữ nguyên để audit → rollback = `DROP VIEW …_clean` + `DROP TABLE price_intel_config`.
- **Không làm quá tay (YAGNI)**: (a) KHÔNG fuzzy-match tên NCC (L6 chỉ trim+upper — dedupe tên gần-giống để Đợt sau nếu Thang cần); (b) KHÔNG dùng MATERIALIZED VIEW cho đến khi đo chậm; (c) KHÔNG ML/sklearn — MAD+percentile đủ; (d) KHÔNG tự-động xoá dòng suspect_currency khi chưa chốt C3.

---

## 10. SỐ LIỆU ĐO THẬT TRÊN PROD (2026-07-02) — CHỐT ĐIỀU CHỈNH THIẾT KẾ

Đã chạy query read-only trên prod (Thang cho phép). Kết quả LẬT LẠI vài giả định của §2/§8 — bản §10 này **ưu tiên hơn** khi mâu thuẫn.

### 10.1 Tiền tệ — CHỐT: `quoted_price_bqms_v1..v4` + `purchase_price_vnd` = **VND** (không phải USD)
- V1: n=1092, min=480, p50=**724.500**, p90=**26.294.000**, max=238tr → độ lớn VND.
- Đối chiếu cùng mã: `R400O005-006695` V1=18.500.000 ≈ `xnk.price_vnd`=18.512.010 (KHỚP), ≠ `price_usd`=706. `Z0000000-040538` V1=7.980.000 ≈ xnk_vnd 8.010.780.
- → **Sửa §2.2 nốt-1 + §8 D3 (giả định USD) = SAI.** Trong VIEW: `quote_v1/quote_final` là **VND, dùng thẳng, KHÔNG `fn_to_vnd`**. `fn_to_vnd` chỉ còn cần cho `purchase_price_rmb` (97 dòng) + imv ngoại tệ (0 dòng — all VND) → **quy đổi gần như không cần**. **Gỡ bỏ toàn bộ rủi ro "biên lãi sai đơn vị" của §8 D3.**

### 10.2 F1 (% thắng thầu) — KHÔNG KHẢ THI → **BỎ khỏi scope** (thay §8.1)
- `result`: **closed=2.629**, pending=285, lost=140, **won=68**, skipped=2. (Enum thực có 'closed'/'skipped' — §8 D1 đúng khi cảnh báo dùng ILIKE.)
- Codes có ≥5 lần decided(won/lost)+giá = **0**. Histogram: 3 mã có 4 lần, 9 mã có 3 lần, 33 mã có 2, 103 mã có 1. → **không đủ mẫu/mã** cho win-prob.
- → **BỎ F1 win-probability.** Thay bằng **dải giá tham chiếu** (thị trường XNK + giá vốn + giá mình từng chào), KHÔNG %. Bật F1 tương lai cần ghi Thắng/Thua (Thang đồng ý — plan riêng §11 TODO).

### 10.3 Nguồn dữ liệu — độ dày thật (sửa §2.2/§10.3 của các báo cáo trước)
| Nguồn | Rows | Quyết định |
|---|---|---|
| xnk_price_lookup | 35.124 | backbone thị trường ✅ |
| sourcing_entries (sale VND) | 9.947 | rất dày — nguồn nội bộ chính ✅ |
| bqms_rfq priced v1/v4 | 1.092 (total 3.124) | V1 dày; **V4 chỉ 16 dòng** → dùng V1 làm giá chào chính |
| bqms_rfq cost VND / RMB | 380 / 97 | cost_ncc modest ✅ |
| **bqms_samsung_po priced** | **0** | ❌ **BỎ nhánh `won_po`** (§2.2, §8 D4) — bảng rỗng |
| sourcing_supplier_prices | 12 | ❌ gần trống → cost dùng `sourcing_entries.cost_vnd`, KHÔNG dựa `cost_vnd_equiv` |
| imv_orders | 26 (0 khớp imv_code, all VND) | ⚠️ kênh phụ — gắn nhưng giá trị thấp; **coverage map = 0%** (§1.3) → IMV chỉ hiện theo item_code, KHÔNG lên chart bqms_code |

### 10.4 F3 Radar — KHẢ THI: **161 mã** có ≥3 lần hỏi / 2.300 mã distinct → LÀM (thay Đợt 2.5, kéo lên Đợt 1).
### 10.5 Làm sạch cần thật: **449 cặp trùng sinh-đôi** (L1), 2.031 V1 null, 1 V1=0. exchange_rates: USD→VND dày (1.528 dòng 2019–2026); RMB/JPY/KRW/EUR→VND chỉ ~42 dòng gần đây — nhưng gần hết đã VND nên ít ảnh hưởng. → **L4 `mad_k` khởi đầu 3.5, L3 TẮT** (không còn nghi currency vì đã chốt VND).

### 10.6 SCOPE BUILD ĐÃ CHỐT (2026-07-02)
- **BUILD**: Đợt 0 (dọn menu: bỏ Dự báo + redirect /analytics/forecast→price-trends, /analytics/xnk→market-prices) → Đợt 1 (VIEW `v_price_observations` all-VND + `v_price_observations_clean` L1/L2/L4/L5/L6 + config + sửa contract KPI/volatility `analytics_trends.py`) → Radar F3 (endpoint + panel) + Đà giá F2 + dải giá tham chiếu (không %).
- **BỎ**: F1 %thắng, nhánh won_po (samsung_po rỗng), quy đổi USD cho V1.
- **PLAN RIÊNG (§11 TODO)**: nút "đánh dấu Thắng/Thua" khi RFQ đóng → tích dữ liệu để tương lai bật F1.
