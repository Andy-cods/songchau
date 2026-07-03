# Test case E2E — Thư viện nguồn cung + Báo giá khách

Phạm vi: `frontend/src/app/(dashboard)/sourcing/**`, `frontend/src/app/(dashboard)/orders/**` (view=pipeline/table), `backend/app/api/v1/sourcing.py` (5025 dòng, xác minh line-number 2026-07-02/03), `backend/app/services/sourcing_pricing_engine.py`.

Mã ca: `TC-NGUONCUNG-001..0NN` (zero-pad 3 số), không đè `TC-IND/TC-CMB` (bộ 118 đấu thầu) hay bộ 122 price-intelligence. Ca tổ hợp cuối bảng đánh dấu Loại = "Kết hợp".

---

## Dữ liệu chuẩn bị chung

### Tài khoản test (không dùng tài khoản thật của Thang)
9 user cố định `test_<role>@songchau.test` — vai trò: admin, manager, staff, sales, procurement, warehouse, accountant, viewer, director. Mật khẩu theo password policy Đợt A (đã LIVE).

Ghi chú quyền theo code:
- Danh sách/CRUD sourcing chính (`sourcing.py:331` roles kiểm ở dependency): admin, manager, staff, sales, director, procurement — **KHÔNG** viewer, **KHÔNG** accountant.
- `bulk-lookup` (`sourcing.py:1598`) và `imv-rfq/items` (`sourcing.py:690`) mở rộng hơn — gồm cả viewer + accountant.
- `DELETE /{entry_id}` (`sourcing.py:1207`) và `DELETE /{entry_id}/suppliers/{sup_id}` (`sourcing.py:4474`): **CHỈ** admin/manager/procurement — sales/staff bị 403.
- `POST/PUT /pricing-rules/{item_type}` (`sourcing.py:4563,4574`): **CHỈ** admin/manager.
- `GET /orders` (`sourcing.py:3226`) mở rộng có cả accountant.
- `GET /orders/{id}/quote-pdf` (đọc, `sourcing.py:3785`) có cả viewer; `POST regenerate` (`sourcing.py:3848`) hẹp hơn — loại viewer/staff/accountant.
- Ma trận chuyển trạng thái đơn hàng dùng `_SO_TRANSITION_ROLES` (`sourcing.py:2621`) — mỗi cặp (from,to) có set role riêng, cancel bắt buộc `note` (400 nếu thiếu, áp dụng ở `PATCH .../status`).

### Bản ghi mồi (fixture DB) — prefix `DEMO-`/`TEST-`, dọn bằng glob khi teardown

| Fixture | Nội dung | Dùng cho |
|---|---|---|
| `SRC-GOLDEN-IMPORT` | entry cost=100 USD, fx=25000, fedex_fee_vnd=500,000 → S kỳ vọng = 4,747,064 (đối chiếu `test_import_scenario_S_equals_4747064`) | TC calc-suggest |
| `SRC-GOLDEN-DOMESTIC` | entry domestic → S kỳ vọng = 4,399,740 | TC calc-suggest |
| `SRC-MULTISUP` | 1 entry có 3 supplier prices, 2 tiền tệ (USD, VND) | Flow E so sánh NCC |
| `SRC-SNAP3` | 1 entry có 3 pricing snapshot (v1,v2,v3) | Flow B mở snapshot cũ |
| `SRC-EXCELIMPORT` | 1 entry tạo qua import-excel, KHÔNG có `fx_rate_snapshot`/`customer_id`/`quote_snapshot` | so sánh nhánh Flow C vs A |
| `SRC-FOC` | entry giá 0 / FOC | edge-case giá 0 |
| `QB-CHAIN3` | 1 quote_batch chain 3 version (v1→v2→v3), đúng 1 `is_current=true` | Flow G/H revision |
| `QB-CONVERTED` | 1 quote_batch đã có `converted_order_id` | Flow H idempotent create-order |
| `ORDERS-8STATE` | 8 sourcing orders, mỗi trạng thái draft..cancelled đúng 1 đơn | Flow I pipeline |
| `PR-4STATE` | 1 payment-request pending + 1 approved + 1 rejected + 1 paid | Flow J |
| `FX-LIVE` | `exchange_rates` có USD→VND thật (đã có prod); song song 1 kịch bản staging **xoá** rate để bắt fallback `25450` | đa tiền tệ |
| `CUST-MAP` | khách CRM 'DEMO Khách Có Map' đủ external map, dùng autofill PickCustomer | Flow F |
| `IMV-ITEMS` | ≥3 dòng `imv_rfq` item còn mở, dùng cho paste-mode "imv" trong QuoteBatchModal | F-SOURCING-73 |
| Fixture file | `tests/fixtures/files/`: `Báo giá  ốc vít 🔧.xlsx` (unicode), `empty_0byte.xlsx`, `import_20mb_plus1.xlsx` (biên >20MB), `import_99bytes.xlsx` (biên <100 bytes), `header_only.xlsx`, `sparse_rows.xlsx`, `fake_pdf.exe` (magic-byte giả `.pdf`), ảnh `exif_orientation6.jpg`, ảnh `image_11mb.png` (>10MB) | Flow C, F-SOURCING-24/27/28 |

### Nguyên tắc KHÔNG đụng Samsung thật
Mảng Sourcing/Quote/Orders **không chạm module Bidding/Samsung trực tiếp** — chỉ có Flow K (Đẩy sang Đấu thầu NCC) tạo bản ghi `source_kind='sourcing'` nội bộ hệ đấu thầu, KHÔNG gọi Samsung. Mọi ca push chỉ xác nhận **draft/existing bidding record được tạo đúng** (mức [AUTO-API]) — không bấm "Mở vòng"/gửi mời NCC thật. Ca PDF/Gotenberg dùng file cục bộ, không phải Samsung.

### Lớp thực thi
- **[AUTO-API]**: pytest gọi REST trực tiếp, có thể chạy trong CI/staging.
- **[SEMI-UI]**: chạy tay hoặc Playwright, dừng ở điểm an toàn (preview=true, không bấm nút mutate cuối).
- Không có ca nào trong mảng này thuộc lớp MANUAL-SAMSUNG (module không chạm Samsung).

### Rate-limit cần cô lập cuối suite
`POST /quote-batch` (10/phút), `POST /quote-batch/{quote_no}/send` (30/phút) — chạy trong khối riêng cuối cùng, có `sleep 60s` trước khi chạy ca kế tiếp cùng loại.

### Idempotency/Concurrency
- `POST /{entry_id}/pricing-snapshots` dùng advisory lock — ca bắn 2 request đồng thời (`asyncio.gather`) kỳ vọng version không trùng (2 version liên tiếp, không lock-step race).
- `POST /quote-batch/{quote_no}/create-order` idempotent theo `source_type+source_ref_id` — double-click chỉ tạo 1 order.
- `PATCH /orders/{id}/status` — 2 request đồng thời đổi cùng 1 order sang 2 trạng thái khác nhau — chỉ 1 thành công (409 cho request thua).

---

## Bảng test case

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-NGUONCUNG-001 | Danh sách sourcing hiển thị đúng, phân trang mặc định | Đơn lẻ | staff | Có ≥15 entries | 1. Login test_staff. 2. Mở `/sourcing`. 3. Quan sát bảng | Bảng hiện entries, page_size mặc định, tổng số khớp `GET /` count | P1 | API+UI |
| TC-NGUONCUNG-002 | Sort theo cột whitelist (sale_vnd) | Đơn lẻ | staff | SRC-GOLDEN-IMPORT + ≥2 entries khác | 1. Click header "Giá bán" để sort_by=sale_vnd, sort_dir=desc | Thứ tự giảm dần đúng theo `sale_vnd` | P2 | API |
| TC-NGUONCUNG-003 | Sort field ngoài whitelist bị chặn (negative) | Negative | staff | — | 1. Gọi `GET /?sort_by=DROP TABLE` trực tiếp | 400/422 hoặc fallback field mặc định, KHÔNG lỗi SQL 500 | P2 | API |
| TC-NGUONCUNG-004 | Search debounce 300ms + phím "/" focus | Đơn lẻ | staff | — | 1. Mở `/sourcing`. 2. Bấm phím "/". 3. Gõ nhanh "ABC" | Ô search được focus tự động; chỉ 1 request gửi sau khi ngừng gõ 300ms | P3 | UI |
| TC-NGUONCUNG-005 | Filter catalog_category + has_price + has_supplier kết hợp | Đơn lẻ | sales | SRC-MULTISUP | 1. Chọn filter category=X, has_price=true, has_supplier=true | Chỉ hiện entries thoả cả 3 điều kiện | P1 | API |
| TC-NGUONCUNG-006 | Filter chip hiển thị + xoá từng chip | Đơn lẻ | sales | Áp 2 filter | 1. Áp category + brand filter. 2. Quan sát 2 chip. 3. Bấm "x" trên 1 chip | Chip biến mất, bảng reload chỉ còn filter còn lại | P2 | UI |
| TC-NGUONCUNG-007 | Nút "Xoá lọc" xoá tất cả cùng lúc | Đơn lẻ | sales | Áp ≥3 filter | 1. Bấm "Xoá lọc" | Toàn bộ chip biến mất, bảng về trạng thái không filter | P2 | UI |
| TC-NGUONCUNG-008 | Phân trang: đổi page size, jump-to-page | Đơn lẻ | staff | ≥30 entries | 1. Đổi page size 10→50. 2. Nhập ô "Đến trang" = 2. Enter | Đúng 50 dòng/trang, nhảy đúng trang 2 | P2 | UI |
| TC-NGUONCUNG-009 | Chọn nhiều dòng + select-all trang hiện tại | Đơn lẻ | sales | ≥5 entries | 1. Tick checkbox header "chọn tất cả" | Tất cả dòng trang hiện tại được tick, số lượng đã chọn hiện đúng | P1 | UI |
| TC-NGUONCUNG-010 | Bulk action mở "Tạo báo giá" cần ≥1 dòng chọn | Negative | sales | 0 dòng chọn | 1. Không tick dòng nào. 2. Quan sát nút "Tạo báo giá" | Nút bị disable hoặc ẩn khi chưa chọn dòng nào | P2 | UI |
| TC-NGUONCUNG-011 | StatsPanel mở/đóng và persist trạng thái | Đơn lẻ | staff | — | 1. Mở `/sourcing`. 2. Bấm mở StatsPanel. 3. Reload trang | Panel vẫn ở trạng thái mở (persist qua localStorage/cookie) | P3 | UI |
| TC-NGUONCUNG-012 | Click top_brands trong Stats → auto-set filter | Đơn lẻ | staff | Stats có top_brands data | 1. Mở StatsPanel. 2. Click 1 brand trong "Top thương hiệu" | Filter brand_canonical tự set đúng brand đã click, bảng reload | P2 | UI |
| TC-NGUONCUNG-013 | Autocomplete suggestions cho customer/maker/brand | Đơn lẻ | staff | ≥5 entries có customer khác nhau | 1. Mở form. 2. Gõ 2 ký tự đầu tên khách vào ô Customer | Danh sách gợi ý hiện, khớp `GET /suggestions` | P2 | API |
| TC-NGUONCUNG-014 | Coverage badge theo mã BQMS | Đơn lẻ | staff | SRC-MULTISUP có bqms_code chung | 1. Gọi `GET /coverage?codes=<code>` | Trả đúng số entries + số suppliers cho mã | P3 | API |
| TC-NGUONCUNG-015 | Badge "Lần trước" giá đã báo cho 1 khách | Đơn lẻ | sales | CUST-MAP có ≥1 quote lịch sử | 1. Mở entry của khách đó. 2. Quan sát badge "Lần trước" | Giá hiện đúng giá bán gần nhất đã báo cho khách này (không lẫn khách khác) | P2 | API |
| TC-NGUONCUNG-016 | CodeHistoryDrawer — tất cả entries theo mã BQMS | Đơn lẻ | staff | SRC-MULTISUP | 1. Click icon lịch sử trên 1 dòng có bqms_code | Drawer hiện tất cả entries có cùng mã, kể cả từ nguồn khác (BQMS/IMV/manual) | P2 | API+UI |
| TC-NGUONCUNG-017 | Panel "Mã đã sourcing" trong CRM chi tiết khách hàng | Đơn lẻ | sales | CUST-MAP | 1. Mở CRM chi tiết khách 'DEMO Khách Có Map' | Panel liệt kê đúng các entries có customer_id = khách này | P2 | API |
| TC-NGUONCUNG-018 (F-SOURCING-17) | Xem chi tiết entry — kèm pricing_snapshot_count + vn_shipping_history | Đơn lẻ | staff | SRC-SNAP3 | 1. Click row SRC-SNAP3 | Drawer hiện `pricing_snapshot_count=3`, `latest_pricing_version=3`, lịch sử phí VC hiện đủ | P1 | API |
| TC-NGUONCUNG-019 | [Flow A] Tạo entry mới nhập cost USD → tính giá golden IMPORT | Luồng | sales | fixture rỗng | 1. Bấm "+ Thêm mới". 2. Nhập bqms_code/model/maker. 3. Nhập cost=100, currency=USD, fx=25000, fedex_fee_vnd=500000. 4. Xem tab tính giá tự động gọi `/calc-suggest`. 5. Bấm "Lưu đợt tính giá". 6. Bấm "Lưu" form | Toast lưu thành công; `sale_vnd` = 4,747,064 khớp golden; snapshot version=1 tạo | P1 | API |
| TC-NGUONCUNG-020 | [Flow A] Tạo entry domestic → golden S=4,399,740 | Luồng | sales | fixture rỗng | 1-6 tương tự #019 nhưng item_type domestic, không FX | Toast lưu thành công; `sale_vnd` = 4,399,740 | P1 | API |
| TC-NGUONCUNG-021 | Lưu đợt tính giá — advisory lock chống race (2 request đồng thời) | Kết hợp | sales | 1 entry mới | 1. Bắn 2 request `POST /{id}/pricing-snapshots` đồng thời (asyncio.gather) | 2 version được tạo tuần tự (v1, v2), không version trùng, entry cuối cùng phản ánh version mới nhất | P1 | API |
| TC-NGUONCUNG-022 | Danh sách snapshot metadata | Đơn lẻ | staff | SRC-SNAP3 | 1. `GET /{id}/pricing-snapshots` | Trả 3 bản ghi, version 1,2,3, có timestamp tăng dần | P2 | API |
| TC-NGUONCUNG-023 | [Flow B] Mở lại snapshot cũ — frozen, không tính lại theo rule hiện hành | Luồng | staff | SRC-SNAP3, đổi pricing-rule sau khi tạo v1 | 1. `GET /{id}/pricing-snapshots/1` sau khi rule item_type đã đổi | Trả đúng số liệu ĐÃ ĐÓNG BĂNG tại thời điểm lưu v1, KHÁC với kết quả `/calc-suggest` tính lại bằng rule mới | P1 | API |
| TC-NGUONCUNG-024 | [Flow B] Sửa entry — đổi cost cùng currency cũ: fx_rate_snapshot GIỮ NGUYÊN (đúng thiết kế) | Negative/Đơn lẻ | staff | SRC-GOLDEN-IMPORT | 1. `PUT /{id}` chỉ đổi `cost_amount`, KHÔNG đổi currency, KHÔNG gửi manual rate | `fx_rate_snapshot` không đổi (COALESCE giữ rate cũ) — xác nhận đây là hành vi ĐÚNG theo comment code `sourcing.py:1089`, không phải bug | P1 | API |
| TC-NGUONCUNG-025 | [Flow B] Sửa entry — đổi currency: fx_rate_snapshot ĐƯỢC recompute | Đơn lẻ | staff | SRC-GOLDEN-IMPORT | 1. `PUT /{id}` đổi currency USD→VND | `fx_rate_snapshot` được tính lại (khác giá trị cũ, hoặc set 1 nếu VND) | P1 | API |
| TC-NGUONCUNG-026 | [Flow B] Sửa entry đổi vn_shipping_fee_vnd → append lịch sử | Đơn lẻ | staff | SRC-GOLDEN-DOMESTIC | 1. `PUT /{id}` đổi `vn_shipping_fee_vnd` sang giá trị mới | `sourcing_vn_shipping_history` có thêm 1 dòng mới, giá trị cũ vẫn còn trong lịch sử (không mất) | P2 | API |
| TC-NGUONCUNG-027 | Sửa entry dù đã có order liên kết terminal (delivered) — KHÔNG bị chặn (đọc code xác nhận) | Đơn lẻ | staff | entry liên kết order đã `delivered` | 1. `PUT /{id}` sửa 1 field (vd `product_name`) | HTTP 200, cập nhật thành công. Đọc `sourcing.py:1089-1203` hàm `update_sourcing` xác nhận: handler CHỈ kiểm tra entry tồn tại (404 nếu không), KHÔNG JOIN/kiểm tra status của `sourcing_orders` liên kết, KHÔNG có nhánh 409 nào — sửa được vô điều kiện bất kể order đã terminal hay chưa. **Hành vi chuẩn mong muốn (đề xuất, KHÔNG phải bug bắt buộc sửa ngay)**: nên chặn sửa cost/giá gốc khi order đã `delivered`/`payment_approved` để tránh lệch số liệu đã chốt sổ — ghi nhận gap cho Thang quyết định có ưu tiên sửa hay không. | P3 | API |
| TC-NGUONCUNG-028 | Xoá entry — role admin/manager/procurement PASS | Đơn lẻ | admin | 1 entry test | 1. Click row → mở drawer. 2. Bấm nút Xoá → confirm() dialog | `DELETE /{id}` trả 200/204, entry biến mất khỏi bảng | P2 | API |
| TC-NGUONCUNG-029 | Xoá entry — role sales/staff bị 403 (permission) | Permission | sales | 1 entry test | 1. Gọi trực tiếp `DELETE /{id}` với token sales | 403 Forbidden, entry còn nguyên | P1 | API |
| TC-NGUONCUNG-030 | Xoá entry — confirm() dialog Huỷ không xoá | Negative | admin | 1 entry test | 1. Bấm nút Xoá. 2. Trong dialog xác nhận, bấm Huỷ | Entry KHÔNG bị xoá, không có request DELETE nào gửi đi | P3 | UI |
| TC-NGUONCUNG-031 | Upload ảnh gắn entry — JPG hợp lệ | Đơn lẻ | sales | 1 entry, ảnh `exif_orientation6.jpg` | 1. Mở entry. 2. Bấm "Tải ảnh". 3. Chọn file | `image_url` set đúng, ảnh resize hiển thị đúng chiều (EXIF-aware) | P2 | API |
| TC-NGUONCUNG-032 | Upload ảnh — vượt 10MB bị reject | Negative | sales | `image_11mb.png` | 1. Chọn file 11MB | 400/413, toast lỗi "quá dung lượng", ảnh không lưu | P2 | API |
| TC-NGUONCUNG-033 | Upload ảnh — file rỗng/dưới 8 bytes bị reject | Negative | sales | `empty_0byte.xlsx` đổi tên .jpg | 1. Chọn file rỗng | 400, toast lỗi | P3 | API |
| TC-NGUONCUNG-034 | Upload ảnh rời chưa gắn entry (dùng khi tạo mới) | Đơn lẻ | sales | — | 1. Trong form tạo mới, chưa lưu entry, bấm tải ảnh | `POST /upload-image` trả URL tạm, gắn vào payload khi Lưu form | P2 | API |
| TC-NGUONCUNG-035 | Serve ảnh sourcing yêu cầu JWT | Negative | (unauth) | 1 ảnh đã upload | 1. Gọi `GET /image/{filename}` không có header Authorization và không có `?token=` | 401 Unauthorized | P1 | API |
| TC-NGUONCUNG-036 | Serve ảnh qua query `?token=` (dùng trong `<img>` tag) | Đơn lẻ | staff | 1 ảnh đã upload | 1. `GET /image/{filename}?token=<jwt>` | 200, trả đúng bytes ảnh | P2 | API |
| TC-NGUONCUNG-037 | [Flow C] Import Excel — preview dry_run nhận diện header tiếng Việt | Luồng | procurement | file mẫu có header VI ("Mã BQMS", "Tên hàng"...) | 1. Mở SourcingImportModal. 2. Chọn file. 3. `POST /import-excel?dry_run=true` | Preview hiện đúng "Sẽ import: N / Bỏ qua: M", cột nhận diện đúng ánh xạ EXCEL_HEADER_MAP | P1 | API |
| TC-NGUONCUNG-038 | Import Excel — preview 5 dòng mẫu hiển thị đúng | Đơn lẻ | procurement | file 10 dòng | 1. dry_run=true | Bảng preview hiện đúng 5 dòng đầu, không nhiều hơn | P2 | UI |
| TC-NGUONCUNG-039 | Import Excel — commit insert (dry_run=false) | Luồng | procurement | file preview PASS ở #037 | 1. Bấm "Import" | `POST /import-excel?dry_run=false` insert đúng N dòng trong 1 transaction; các entry này KHÔNG có `fx_rate_snapshot`/`customer_id`/`quote_snapshot` (khác Flow A) | P1 | API |
| TC-NGUONCUNG-040 | Import Excel — file >20MB bị reject | Negative | procurement | `import_20mb_plus1.xlsx` | 1. Chọn file >20MB | 400, "File quá lớn" | P2 | API |
| TC-NGUONCUNG-041 | Import Excel — file <100 bytes bị reject | Negative | procurement | `import_99bytes.xlsx` | 1. Chọn file | 400 | P2 | API |
| TC-NGUONCUNG-042 | Import Excel — file chỉ có header, 0 dòng dữ liệu | Negative | procurement | `header_only.xlsx` | 1. dry_run=true | Preview "Sẽ import: 0", không lỗi 500 | P2 | API |
| TC-NGUONCUNG-043 | Import Excel — dòng rỗng xen kẽ + dòng thiếu cả product_name và bqms_code bị skip | Negative | procurement | `sparse_rows.xlsx` | 1. dry_run=true | Các dòng thiếu cả 2 trường bị đếm vào "Bỏ qua", không văng lỗi toàn file | P2 | API |
| TC-NGUONCUNG-044 | Import Excel — header không nhận diện được → phản hồi rõ ràng | Negative | procurement | file header lạ hoàn toàn | 1. dry_run=true | Preview cột nhận diện = 0/thấp, cảnh báo rõ cho người dùng (không phải insert rác) | P3 | API |
| TC-NGUONCUNG-045 | Import Excel — tên file unicode | Đơn lẻ | procurement | `Báo giá  ốc vít 🔧.xlsx` | 1. Chọn file tên unicode | Upload thành công, không lỗi encoding | P3 | API |
| TC-NGUONCUNG-046 | [Flow E] So sánh NCC theo mã BQMS — ranking + spread | Luồng | staff | SRC-MULTISUP (3 supplier, 2 currency) | 1. Click icon GitCompare trên dòng có bqms_code. 2. Xem SupplierCompareDrawer | Ranking theo `cost_vnd` tăng dần, summary min/max/avg/spread_pct đúng, **mỗi currency hiện riêng, KHÔNG cộng gộp** | P1 | API |
| TC-NGUONCUNG-047 | [Flow D] Bulk Lookup — exact mode | Luồng | staff | ≥5 mã có sẵn | 1. Mở BulkLookupSourcingModal. 2. Paste 5 mã, mỗi dòng 1 mã. 3. Chọn mode "exact". 4. Bấm tìm | `POST /bulk-lookup` trả đúng found/missing, dùng B-tree `model_norm ANY` | P1 | API |
| TC-NGUONCUNG-048 | Bulk Lookup — fuzzy mode (pg_trgm similarity>0.3) | Đơn lẻ | staff | mã gần đúng (sai 1-2 ký tự) | 1. Paste mã gõ sai chính tả nhẹ. 2. Chọn mode "fuzzy" | Trả kết quả gần đúng nhờ similarity, không rỗng | P2 | API |
| TC-NGUONCUNG-049 | Bulk Lookup — vượt 500 mã bị reject | Negative | staff | 501 mã | 1. Paste 501 dòng | 400/422 "Tối đa 500 mã" | P2 | API |
| TC-NGUONCUNG-050 | Bulk Lookup — copy kết quả ra clipboard TSV | Đơn lẻ | staff | kết quả có found | 1. Bấm nút copy | Clipboard chứa dữ liệu dạng TSV (tab-separated), đúng số cột | P3 | UI |
| TC-NGUONCUNG-051 | Bulk Lookup — click 1 dòng found mở chi tiết entry | Đơn lẻ | staff | kết quả có found | 1. Click 1 dòng trong bảng found | Mở drawer chi tiết đúng entry đó | P3 | UI |
| TC-NGUONCUNG-052 | Bulk Lookup — role viewer/accountant vẫn truy cập được (mở rộng hơn CRUD) | Permission | viewer | ≥3 mã | 1. Login test_viewer. 2. Gọi `POST /bulk-lookup` | 200 OK (khác với `GET /` list chính bị 403 cho viewer) | P2 | API |
| TC-NGUONCUNG-053 | Danh sách sourcing chính — role viewer bị 403 | Permission | viewer | — | 1. Login test_viewer. 2. `GET /api/v1/sourcing/` | 403 Forbidden | P1 | API |
| TC-NGUONCUNG-054 | Danh sách sourcing chính — role accountant bị 403 | Permission | accountant | — | 1. Login test_accountant. 2. `GET /api/v1/sourcing/` | 403 Forbidden | P1 | API |
| TC-NGUONCUNG-055 | [Flow F] Dropdown "Người báo giá" cho modal | Đơn lẻ | sales | user list có ≥3 staff | 1. Mở QuoteBatchModal. 2. Mở dropdown "Người báo giá" | `GET /quote-staff` trả danh sách đúng nhân viên | P3 | API |
| TC-NGUONCUNG-056 | [Flow F] Tạo báo giá — PickCustomer autofill company_name/MST/address | Luồng | sales | CUST-MAP, ≥2 entries đã tick | 1. Tick 2 dòng sourcing. 2. Bấm "Tạo báo giá". 3. Trong modal, chọn khách 'DEMO Khách Có Map' | Các trường company_name/MST/address tự điền đúng theo customer_id | P1 | UI |
| TC-NGUONCUNG-057 | [Flow F] Mỗi dòng chọn supplier_price_id (giá sống) | Đơn lẻ | sales | SRC-MULTISUP | 1. Trong modal, dòng của SRC-MULTISUP chọn NCC có sẵn (không nhập tay giá) | Giá dòng đó = kết quả `compute_sale_vnd` sống tính từ supplier price hiện tại | P1 | API |
| TC-NGUONCUNG-058 | [Flow F] Mỗi dòng nhập manual_unit_price_vnd (giá gõ tay) | Đơn lẻ | sales | 1 entry không có supplier | 1. Nhập tay giá vào ô | Giá dòng = giá gõ tay, không gọi compute_sale_vnd | P1 | API |
| TC-NGUONCUNG-059 (BUG-boundary) | QuoteBatchItem._exactly_one — cả supplier_price_id VÀ manual_unit_price_vnd cùng có → 422 | Negative | sales | SRC-MULTISUP | 1. Gửi payload dòng có CẢ hai trường cùng lúc | 422, message rõ "chỉ được chọn một trong hai" (`sourcing.py:1756`) | P1 | API |
| TC-NGUONCUNG-060 (BUG-boundary) | QuoteBatchItem._exactly_one — cả hai đều rỗng → 422 | Negative | sales | 1 dòng không chọn gì | 1. Gửi payload dòng KHÔNG có supplier_price_id lẫn manual_unit_price_vnd | 422 | P1 | API |
| TC-NGUONCUNG-061 | fx_rate_override từng dòng | Đơn lẻ | sales | dòng USD | 1. Nhập `fx_rate_override` khác rate mặc định cho 1 dòng | Giá dòng đó tính theo rate override, các dòng khác không ảnh hưởng | P2 | API |
| TC-NGUONCUNG-062 | delivery_time ghi vào Ghi chú | Đơn lẻ | sales | — | 1. Nhập delivery_time cho 1 dòng | Nội dung xuất hiện trong cột "Ghi chú" của báo giá xuất ra | P3 | API |
| TC-NGUONCUNG-063 | Chọn định dạng xuất xlsx | Đơn lẻ | sales | — | 1. Chọn file_format=xlsx. 2. Xem preview | File xlsx sinh ra hợp lệ, mở được | P2 | API |
| TC-NGUONCUNG-064 | Chọn định dạng xuất pdf | Đơn lẻ | sales | — | 1. Chọn file_format=pdf | PDF sinh qua Gotenberg, mở iframe preview thành công | P1 | API |
| TC-NGUONCUNG-065 | Chọn định dạng xuất tsv | Đơn lẻ | sales | — | 1. Chọn file_format=tsv | File TSV hợp lệ | P3 | API |
| TC-NGUONCUNG-066 | Chọn định dạng khác 3 loại trên → 400 | Negative | sales | — | 1. Gửi `file_format=docx` trực tiếp qua API | 400 (`sourcing.py:1853`) | P2 | API |
| TC-NGUONCUNG-067 | [Flow F] Xem preview báo giá (preview=true) — KHÔNG ghi DB | Luồng | sales | 2 dòng đã điền đủ | 1. Bấm "Xem preview" | `POST /quote-batch preview=true` trả file render, KHÔNG có bản ghi mới trong `quote_batches` | P1 | API |
| TC-NGUONCUNG-068 (biên PDF W3-04) | Xuất PDF báo giá N=1 dòng | Đơn lẻ | sales | 1 dòng | 1. Preview PDF với đúng 1 dòng | PDF layout đúng, 1 trang | P2 | API |
| TC-NGUONCUNG-069 (biên PDF W3-04) | Xuất PDF báo giá N=3 dòng | Đơn lẻ | sales | 3 dòng | 1. Preview PDF với 3 dòng | PDF layout đúng, 1 trang, khớp render mẫu | P2 | API |
| TC-NGUONCUNG-070 (BUG-GATE W3-04) | Xuất PDF báo giá N=5 dòng — kỳ vọng hiện tại có thể FAIL (tràn trang 2) | Negative | sales | 5 dòng | 1. Preview PDF với đúng 5 dòng | **BG-SOURCING-01**: kỳ vọng layout gọn trong 1 trang; nếu dòng cuối bị đẩy sang trang 2 sai định dạng → FAIL xác nhận bug W3-04 còn tồn tại | P1 | API |
| TC-NGUONCUNG-071 (biên PDF W3-04) | Xuất PDF báo giá N=6 dòng | Đơn lẻ | sales | 6 dòng | 1. Preview PDF với 6 dòng | Xác nhận breakpoint tràn trang xảy ra ở N nào chính xác (đối chiếu #070) | P2 | API |
| TC-NGUONCUNG-072 (biên PDF W3-04) | Xuất PDF báo giá N=20 dòng (nhiều trang) | Đơn lẻ | sales | 20 dòng | 1. Preview PDF với 20 dòng | Phân trang tự nhiên, header lặp lại đúng mỗi trang, không cắt dòng giữa trang | P2 | API |
| TC-NGUONCUNG-073 | row_classification khác nhau — giá KHÔNG đổi (item_type='default' cứng) | Negative/Đơn lẻ | sales | 2 entries row_classification khác nhau, cost/rule giống nhau | 1. Đưa cả 2 vào cùng 1 quote-batch | Giá tính ra bằng nhau (vì `create_quote_batch` dùng `item_type='default'` cứng, không đọc row_classification — xác nhận đây là thiết kế V1.1, không phải bug) | P2 | API |
| TC-NGUONCUNG-074 | [Flow F] Gửi/Tạo báo giá thật (preview=false) — sinh quote_no | Luồng | sales | preview PASS ở #067 | 1. Bấm "Gửi/Tạo báo giá" | `POST /quote-batch preview=false` tạo bản ghi `quote_batches`, `quote_no` dạng SC-YYMMDD-NNNN, `valid_until` = +10 ngày mặc định | P1 | API |
| TC-NGUONCUNG-075 (rate-limit, chạy cuối) | Tạo báo giá vượt 10 request/phút → 429 | Negative | sales | — | 1. Bắn 11 request `POST /quote-batch preview=false` liên tục trong <60s | Request thứ 11 trả 429; sau `sleep 60s` request tiếp theo lại 200 | P2 | API |
| TC-NGUONCUNG-076 | Danh sách báo giá đã tạo — filter theo customer_id | Đơn lẻ | sales | CUST-MAP có ≥2 quote | 1. `GET /quote-batch?customer_id=X` | Chỉ trả quote của khách X | P2 | API |
| TC-NGUONCUNG-077 | Danh sách báo giá — all_versions=true trả cả chain | Đơn lẻ | sales | QB-CHAIN3 | 1. `GET /quote-batch?all_versions=true` cho quote_group_id của QB-CHAIN3 | Trả đủ 3 version, đúng 1 dòng `is_current=true` (là v3) | P1 | API |
| TC-NGUONCUNG-078 | [Flow H] Đánh dấu báo giá đã gửi | Luồng | sales | 1 quote status=draft | 1. Bấm "Đánh dấu đã gửi" | `POST /quote-batch/{quote_no}/send` → status=sent, `sent_at`/`sent_to_email` set | P1 | API |
| TC-NGUONCUNG-079 (rate-limit, chạy cuối) | Đánh dấu gửi vượt 30/phút → 429 | Negative | sales | ≥31 quote draft | 1. Bắn 31 request send liên tục | Request 31 trả 429 | P3 | API |
| TC-NGUONCUNG-080 | [Flow G] Sửa & gửi lại báo giá — prefill đúng | Luồng | sales | QB-CHAIN3 v3 | 1. Chọn "Sửa & gửi lại" trên quote v3 | `GET /quote-batch/{quote_no}/prefill` khôi phục đúng customer + line items + valid_until + quote_note vào modal | P1 | API |
| TC-NGUONCUNG-081 | [Flow G] Submit revision — chain đúng version + demote is_current | Luồng | sales | prefill PASS ở #080 | 1. Sửa 1 dòng giá. 2. Submit với `revise_of_quote_no=<quote_no cũ>` | Version mới = v4, cùng `quote_group_id`, v3 cũ bị demote `is_current=false`, chỉ v4 `is_current=true` (trong 1 transaction) | P1 | API |
| TC-NGUONCUNG-082 | [Flow H] Tạo đơn từ báo giá đã chấp nhận — idempotent | Luồng | sales | QB-CONVERTED | 1. Bấm "Tạo đơn hàng" trên quote đã có `converted_order_id` (double-click / gọi lại API) | Không tạo order thứ 2; trả lại `converted_order_id` cũ, status `accepted` giữ nguyên | P1 | API |
| TC-NGUONCUNG-083 | Tạo đơn từ báo giá lần đầu | Đơn lẻ | staff | 1 quote status=sent, chưa convert | 1. Bấm "Tạo đơn hàng" | `POST create-order` map line_items snapshot đúng, `quote_batches.status='accepted'`, `converted_order_id` được set | P1 | API |
| TC-NGUONCUNG-084 | Tải file báo giá — DB row tồn tại (đã tạo thật) | Đơn lẻ | sales | quote thật đã tạo ở #074 | 1. Bấm "Tải file" | `GET /quote-batch/{quote_no}/download` trả đúng file theo `file_path` DB | P2 | API |
| TC-NGUONCUNG-085 | Tải file báo giá — preview-only trên đĩa (không có DB row) | Đơn lẻ | sales | file preview còn trên đĩa từ #067, chưa submit | 1. Gọi download quote_no preview | Trả file qua glob `quote_no.*` an toàn (regex), không văng lỗi tìm sai file | P2 | API |
| TC-NGUONCUNG-086 | [Flow K] Đẩy sourcing entries sang Đấu thầu — mode tạo mới draft | Luồng | procurement | ≥2 entries tick chọn | 1. Tick 2 dòng. 2. Bấm "Đẩy đấu thầu NCC". 3. Chọn mode "Tạo mới". 4. Nhập title + deadline. 5. Bấm xác nhận | Bản ghi bidding draft mới tạo, `source_kind='sourcing'`, items map đúng — KHÔNG gọi Samsung | P1 | API |
| TC-NGUONCUNG-087 | [Flow K] Đẩy entries vào draft đấu thầu có sẵn (mode existing) | Đơn lẻ | procurement | 1 draft bidding có sẵn | 1. Chọn mode "Chọn draft có sẵn" → chọn draft | Items được thêm vào đúng draft đã chọn, không tạo draft mới | P2 | API |
| TC-NGUONCUNG-088 | [Flow I] Kanban pipeline hiển thị đủ 8 cột trạng thái | Đơn lẻ | staff | ORDERS-8STATE | 1. Mở `/orders?view=pipeline` | 8 cột draft→...→delivered/cancelled, mỗi cột đúng 1 đơn theo fixture | P1 | UI |
| TC-NGUONCUNG-089 | [Flow I] Chuyển trạng thái đơn qua PATCH — role đúng PASS | Đơn lẻ | staff | 1 đơn status=quoted | 1. Bấm "Khách đã đặt" | `PATCH /orders/{id}/status` quoted→confirmed thành công theo `_SO_TRANSITION_ROLES` | P1 | API |
| TC-NGUONCUNG-090 | Chuyển trạng thái — role không đủ quyền → 403 TRANSITION_FORBIDDEN | Permission | warehouse | 1 đơn status=quoted, chuyển sang confirmed | 1. Gọi PATCH với token warehouse (không có trong role set của transition này) | 403, mã lỗi `TRANSITION_FORBIDDEN` | P1 | API |
| TC-NGUONCUNG-091 | Chuyển trạng thái — sai state (không thuộc whitelist next) → 409 | Negative | staff | đơn status=draft, cố nhảy thẳng lên delivered | 1. PATCH status=delivered trực tiếp | 409 Conflict, không đổi trạng thái | P1 | API |
| TC-NGUONCUNG-092 | Chuyển trạng thái cancel — thiếu note → 400 | Negative | manager | 1 đơn bất kỳ | 1. `PATCH .../status` với `status=cancelled`, KHÔNG gửi `note` | 400 Bad Request | P1 | API |
| TC-NGUONCUNG-093 | Chuyển trạng thái cancel — có note → thành công | Đơn lẻ | manager | 1 đơn bất kỳ | 1. PATCH cancelled kèm `note="lý do huỷ"` | 200, status=cancelled, note lưu trong status_history | P2 | API |
| TC-NGUONCUNG-094 | GET allowed-transitions — ẩn nút không đủ quyền | Đơn lẻ | warehouse | 1 đơn status=quoted | 1. `GET /orders/{id}/allowed-transitions` | Danh sách trả về KHÔNG chứa transition mà warehouse không có quyền (FE dùng để ẩn nút) | P2 | API |
| TC-NGUONCUNG-095 | Concurrency — 2 request đổi cùng 1 order sang 2 trạng thái khác nhau đồng thời | Kết hợp | staff+manager | 1 đơn status=quoted | 1. Bắn đồng thời (asyncio.gather) PATCH→confirmed và PATCH→cancelled | Chỉ 1 request thành công (200), request còn lại 409; trạng thái cuối cùng nhất quán | P1 | API |
| TC-NGUONCUNG-096 | Bulk chuyển trạng thái nhiều đơn — per-row failure report | Kết hợp | staff | 3 đơn, 1 đơn cố tình sai state | 1. Chọn 3 đơn trên bảng. 2. Bấm bulk-transition | `Promise.allSettled` — 2 đơn thành công, 1 đơn hiện trong `bulkFailures` với lý do rõ ràng, không rollback 2 đơn kia | P1 | UI |
| TC-NGUONCUNG-097 | Deep-link mở drawer đơn hàng qua `?order_id=` | Đơn lẻ | staff | 1 order_id hợp lệ | 1. Mở URL `/orders?order_id=123` trực tiếp | Drawer chi tiết đơn 123 tự mở khi load trang | P3 | UI |
| TC-NGUONCUNG-098 | Sửa đơn (PATCH) khi status=delivered (terminal) → 409 | Negative | staff | 1 đơn status=delivered | 1. Thử `PATCH /orders/{id}` sửa items | 409 Conflict, đơn không đổi | P2 | API |
| TC-NGUONCUNG-099 | Sửa đơn — items đổi → tính lại tổng | Đơn lẻ | staff | 1 đơn status=draft | 1. PATCH đổi số lượng 1 item | `total` tính lại đúng theo items mới | P2 | API |
| TC-NGUONCUNG-100 | [Flow J] Đề xuất TT kế toán — idempotent trừ PR bị reject | Luồng | sales | 1 đơn confirmed | 1. Bấm "Đề xuất TT kế toán" 2 lần liên tiếp | Lần 1 tạo PR pending; lần 2 (double-click) không tạo PR trùng — trả lại PR đang pending | P1 | API |
| TC-NGUONCUNG-101 | Đề xuất TT — sau khi PR trước bị reject, đề xuất lại được | Đơn lẻ | sales | PR-4STATE (1 rejected) | 1. Bấm "Đề xuất TT kế toán" lại cho đơn có PR rejected | Tạo PR mới thành công (khác nhánh idempotent ở #100) | P2 | API |
| TC-NGUONCUNG-102 | Duyệt PR — accountant chuyển payment_requested→payment_approved | Đơn lẻ | accountant | PR-4STATE (pending) | 1. Duyệt PR | Status đơn = payment_approved, PR status=approved | P1 | API |
| TC-NGUONCUNG-103 | [Flow J] Xem PDF báo giá đơn hàng (read-only) — role viewer PASS | Đơn lẻ | viewer | 1 đơn đã có PDF render trước | 1. `GET /orders/{id}/quote-pdf` | 200, trả PDF, KHÔNG side-effect (không đổi version/status) | P2 | API |
| TC-NGUONCUNG-104 | Xem PDF — chưa render lần nào → 404 | Negative | staff | 1 đơn mới, chưa render PDF | 1. `GET /orders/{id}/quote-pdf` | 404 | P2 | API |
| TC-NGUONCUNG-105 | Tạo lại PDF (regenerate) — role viewer bị chặn (permission hẹp hơn) | Permission | viewer | 1 đơn có PDF | 1. `POST /orders/{id}/quote-pdf/regenerate` bằng token viewer | 403 (role hẹp hơn, loại viewer/staff/accountant) | P1 | API |
| TC-NGUONCUNG-106 | Tạo lại PDF — role đủ quyền, bump version + auto draft→quoted | Đơn lẻ | sales | 1 đơn status=draft, chưa có PDF | 1. `POST regenerate` | PDF version=1 tạo, status tự chuyển draft→quoted, audit history ghi | P1 | API |
| TC-NGUONCUNG-107 | Tạo lại PDF lần 2 — version bump dù status không đổi | Đơn lẻ | sales | đơn đã có PDF v1, status=quoted | 1. `POST regenerate` lần 2 | version=2, audit history ghi thêm dòng dù status giữ nguyên quoted | P2 | API |
| TC-NGUONCUNG-108 | Tính nhanh 1 dòng giá bán (calc-sale) | Đơn lẻ | staff | — | 1. `GET /calc-sale?...` với tham số golden IMPORT | Trả đúng 4,747,064 | P2 | API |
| TC-NGUONCUNG-109 | Preview nhiều dòng tính giá cho order (không ghi DB) | Đơn lẻ | staff | 3 dòng đầu vào | 1. `POST /orders/calc-preview` | Trả kết quả tính đúng 3 dòng, không có bản ghi order nào được tạo | P2 | API |
| TC-NGUONCUNG-110 | Danh sách giá NCC cho 1 entry — cảnh báo FX stale | Đơn lẻ | staff | SRC-MULTISUP, 1 supplier có fx cũ >X ngày | 1. `GET /{id}/suppliers` | Trả list kèm cờ `fx_stale=true` cho supplier có rate cũ | P2 | API |
| TC-NGUONCUNG-111 | Thêm giá NCC mới cho entry | Đơn lẻ | procurement | 1 entry | 1. `POST /{id}/suppliers` với cost+currency mới | Supplier price mới thêm, `cost_vnd_equiv` tính đúng | P1 | API |
| TC-NGUONCUNG-112 | Sửa giá NCC — re-compute cost_vnd_equiv khi đổi currency | Đơn lẻ | procurement | 1 supplier price USD | 1. `PUT /{id}/suppliers/{sup_id}` đổi currency USD→EUR | `cost_vnd_equiv` tính lại theo rate EUR mới, khác giá trị cũ | P1 | API |
| TC-NGUONCUNG-113 | Xoá giá NCC — role admin/manager/procurement PASS | Đơn lẻ | manager | 1 supplier price | 1. `DELETE /{id}/suppliers/{sup_id}` | 200, supplier price biến mất | P2 | API |
| TC-NGUONCUNG-114 | Xoá giá NCC — role sales bị 403 | Permission | sales | 1 supplier price | 1. `DELETE /{id}/suppliers/{sup_id}` bằng token sales | 403 | P1 | API |
| TC-NGUONCUNG-115 | Đặt NCC làm primary — auto unflag NCC khác | Đơn lẻ | procurement | SRC-MULTISUP (3 supplier, 1 đang primary) | 1. `PATCH .../set-primary` cho supplier #2 | Supplier #2 `is_primary=true`, supplier cũ tự động `is_primary=false` (chỉ 1 primary tại 1 thời điểm) | P1 | API |
| TC-NGUONCUNG-116 | Danh sách pricing rules theo item_type | Đơn lẻ | manager | rule import/domestic có sẵn | 1. `GET /pricing-rules` | Trả đủ rule theo item_type | P3 | API |
| TC-NGUONCUNG-117 | Upsert pricing rule — role admin/manager PASS | Đơn lẻ | admin | rule item_type='domestic' | 1. `PUT /pricing-rules/domestic` đổi 1 hệ số | 200, rule cập nhật, cache `/calc-suggest` invalidate | P1 | API |
| TC-NGUONCUNG-118 | Upsert pricing rule — role sales/procurement bị 403 | Permission | procurement | — | 1. `PUT /pricing-rules/domestic` bằng token procurement | 403 (chỉ admin/manager) | P1 | API |
| TC-NGUONCUNG-119 | Lịch sử thay đổi pricing rule (audit) | Đơn lẻ | manager | sau khi đổi rule ở #117 | 1. `GET /pricing-rules/domestic/history` | Có bản ghi audit mới, before/after value đúng | P2 | API |
| TC-NGUONCUNG-120 | calc-suggest — item_type không xác định fallback default | Negative | staff | entry item_type lạ | 1. `POST /calc-suggest` với item_type không tồn tại trong rule table | Fallback về rule mặc định, không lỗi 500 (đối chiếu `test_unknown_item_type_falls_back_to_default`) | P2 | API |
| TC-NGUONCUNG-121 | calc-suggest — cost=0 trả 0 | Đơn lẻ | staff | SRC-FOC | 1. `POST /calc-suggest` cost=0 | `sale_vnd=0` (đối chiếu `test_zero_cost_returns_zero`) | P2 | API |
| TC-NGUONCUNG-122 | calc-suggest — cost âm bị raise lỗi | Negative | staff | — | 1. `POST /calc-suggest` cost=-100 | 400/422, không tính ra số âm (đối chiếu `test_negative_cost_raises`) | P1 | API |
| TC-NGUONCUNG-123 | calc-suggest/bulk — tối đa 200 dòng, vượt bị chặn | Negative | staff | 201 dòng | 1. `POST /calc-suggest/bulk` với 201 dòng | 400 "tối đa 200 dòng" (`sourcing.py:5000`) | P2 | API |
| TC-NGUONCUNG-124 | calc-suggest/bulk — per-row error không chặn cả batch | Negative | staff | 5 dòng, 1 dòng dữ liệu lỗi (cost âm) | 1. `POST /calc-suggest/bulk` 5 dòng, dòng 3 cost âm | 4 dòng tính bình thường, dòng 3 trả lỗi riêng theo index, không 500 toàn batch | P2 | API |
| TC-NGUONCUNG-125 | Column picker — chọn cột hiển thị, persist localStorage | Đơn lẻ | staff | — | 1. Mở column picker. 2. Ẩn cột "Maker". 3. Reload trang | Cột "Maker" vẫn ẩn sau reload | P3 | UI |
| TC-NGUONCUNG-126 | Modal nhập bằng paste text mã (paste mode) | Đơn lẻ | sales | ≥3 mã hợp lệ | 1. Trong QuoteBatchModal, mở panel paste. 2. Chọn mode "paste". 3. Dán 3 mã | 3 dòng tương ứng tự thêm vào modal đúng entries | P2 | UI |
| TC-NGUONCUNG-127 | Modal nhập từ IMV RFQ (paste mode imv) | Đơn lẻ | sales | IMV-ITEMS | 1. Chọn mode "imv". 2. Chọn RFQ item | Dòng item IMV được chèn vào modal đúng dữ liệu | P2 | API |
| TC-NGUONCUNG-128 (đa tiền tệ, negative) | Cảnh báo fx_stale/fx_error chặn export dòng đó | Negative | sales | 1 dòng supplier price fx_error | 1. Đưa dòng lỗi FX vào modal. 2. Bấm "Gửi/Tạo báo giá" | `compute_sale_vnd` raise ValueError → 400, KHÔNG tạo quote_batch một phần (toàn request bị chặn cho tới khi sửa dòng lỗi) | P1 | API |
| TC-NGUONCUNG-129 (đa tiền tệ) | Quote batch đa tiền tệ — 2 dòng USD + VND trong cùng 1 báo giá, không cộng gộp sai | Kết hợp | sales | 1 dòng nguồn USD, 1 dòng nguồn VND | 1. Đưa cả 2 dòng vào modal. 2. Preview | Mỗi dòng hiện đúng tiền gốc + quy đổi VND riêng biệt; tổng cuối cùng tính bằng VND đã quy đổi đúng, không cộng nhầm số USD thô vào VND | P1 | API |
| TC-NGUONCUNG-130 (kết hợp full flow) | End-to-end: tick 2 entries → tạo báo giá → gửi → tạo đơn → chuyển trạng thái tới payment_requested → xuất PDF | Kết hợp | sales+accountant | SRC-GOLDEN-IMPORT + SRC-GOLDEN-DOMESTIC | **[Flow F]** 1. Tick 2 dòng SRC-GOLDEN-IMPORT + SRC-GOLDEN-DOMESTIC → "Tạo báo giá". 2. Chọn giá mỗi dòng (supplier_price_id hoặc manual), bấm "Gửi/Tạo báo giá" (`preview=false`). <br>**[Flow H]** 3. Bấm "Đánh dấu đã gửi". 4. Bấm "Tạo đơn hàng". <br>**[Flow I]** 5. Chuyển trạng thái đơn qua state machine tới ngay trước `payment_requested` (vd `quoted→confirmed`). <br>**[Flow J]** 6. Bấm "Đề xuất TT kế toán". 7. Bấm "Tạo lại PDF" (regenerate) cho đơn. | Mỗi bước có 1 kỳ vọng quan sát được riêng, đối chiếu đúng field đã định nghĩa ở các TC đơn lẻ tương ứng trong chính file này: <br>**Bước 2 (Flow F, ↔TC-074)**: `quote_batches` có bản ghi mới, `quote_no` dạng `SC-YYMMDD-NNNN`, `status='draft'`. <br>**Bước 3 (Flow H, ↔TC-078)**: `status: draft→sent`, `sent_at` được set. <br>**Bước 4 (Flow H, ↔TC-083)**: `sourcing_orders` có bản ghi mới, `converted_order_id` trên quote_batch được set trỏ đúng order vừa tạo. <br>**Bước 5 (Flow I, ↔TC-089)**: `PATCH /orders/{id}/status` trả 200, `status` đổi đúng theo `_SO_TRANSITION_ROLES`, không 409. <br>**Bước 6 (Flow J, ↔TC-100)**: `payment_requests` có 1 dòng `status='pending'` mới, `sourcing_orders.status→'payment_requested'`. <br>**Bước 7 (Flow J, ↔TC-106)**: PDF `version=1` tạo, `status` tự chuyển tiếp theo audit history nếu còn ở draft. <br>Toàn chuỗi: dữ liệu nhất quán xuyên suốt `quote_no → order_id → PR → PDF version=1` (cùng 1 `quote_no`/`order_id` xuyên các bước, không lệch/không rác dữ liệu trung gian ở bước nào). | P1 | API |
| TC-NGUONCUNG-131 (rollback-txn, prod) | Xác nhận entry/quote_batch demo không rò rỉ ra danh sách thật | Kết hợp | admin | mọi fixture DEMO- | 1. Mở transaction, chạy toàn bộ seed DEMO-, gọi thẳng hàm deployed các bước chính. 2. Rollback | Sau rollback: `SELECT count(*) FROM sourcing_entries WHERE code LIKE 'DEMO-%'` = 0, `SELECT count(*) FROM quote_batches WHERE quote_no LIKE 'SC-%'` không tăng — "0 rác" | P1 | API |
| TC-NGUONCUNG-132 (F-SOURCING-71 đúng) | Empty state bảng sourcing — không có entry khớp filter, nút tạo mới vẫn hoạt động | Đơn lẻ (empty-state) | staff | Filter/search ra 0 kết quả (vd search chuỗi vô nghĩa hoặc filter category không có entry nào khớp) | 1. Mở `/sourcing`, áp filter/search chắc chắn ra 0 dòng. 2. Quan sát vùng bảng. 3. Bấm nút "Tạo entry mới" trong empty-state | Bảng thay bằng empty-state đúng text thật đọc từ code (`sourcing/page.tsx:1098-1099`): dòng chính **"Chưa có entry sourcing nào khớp"** + dòng phụ **"Thử điều chỉnh bộ lọc hoặc bấm "Lưu nguồn mới" ở header."**; nút **"Tạo entry mới"** (dòng 1105, `onClick={() => setIsCreating(true)}`) vẫn hiển thị và bấm được, mở đúng form tạo mới — KHÔNG bị ẩn/disable bởi trạng thái rỗng | P2 | UI |

**Tổng: 132 ca (TC-NGUONCUNG-001 .. 132).**
Phân bổ ưu tiên: P1 = 47, P2 = 67, P3 = 18.
Đơn lẻ = 109, Luồng = 17, Kết hợp = 5, Negative/Permission lồng trong các loại trên = 34 (đánh dấu riêng trong cột Loại khi thuần negative).

---

## Map feature → ca (chứng minh phủ 100%)

| Feature ID | Tên | Ca phủ |
|---|---|---|
| F-SOURCING-01 | Danh sách sourcing entries | TC-NGUONCUNG-001 |
| F-SOURCING-02 | Search debounce + phím "/" | TC-NGUONCUNG-004 |
| F-SOURCING-03 | Filter đa điều kiện | TC-NGUONCUNG-005 |
| F-SOURCING-04 | Filter chips + xoá | TC-NGUONCUNG-006, 007 |
| F-SOURCING-05 | Phân trang | TC-NGUONCUNG-008 |
| F-SOURCING-06 | Chọn nhiều dòng + select-all | TC-NGUONCUNG-009 |
| F-SOURCING-07 | Bulk → Tạo báo giá | TC-NGUONCUNG-010, 056 |
| F-SOURCING-08 | Bulk → Đẩy đấu thầu NCC | TC-NGUONCUNG-086, 087 |
| F-SOURCING-09 | StatsPanel mở/đóng persist | TC-NGUONCUNG-011 |
| F-SOURCING-10 | Click stats → auto filter | TC-NGUONCUNG-012 |
| F-SOURCING-11 | Autocomplete suggestions | TC-NGUONCUNG-013 |
| F-SOURCING-12 | Coverage badge | TC-NGUONCUNG-014 |
| F-SOURCING-13 | Giá bán gần nhất theo khách | TC-NGUONCUNG-015 |
| F-SOURCING-14 | Tìm item IMV RFQ | TC-NGUONCUNG-055, 127 |
| F-SOURCING-15 | CodeHistoryDrawer | TC-NGUONCUNG-016 |
| F-SOURCING-16 | Panel "Mã đã sourcing" trong CRM | TC-NGUONCUNG-017 |
| F-SOURCING-17 | Xem chi tiết entry | TC-NGUONCUNG-018 |
| F-SOURCING-18 | Lưu đợt tính giá (snapshot) | TC-NGUONCUNG-019, 020, 021 |
| F-SOURCING-19 | Danh sách snapshot metadata | TC-NGUONCUNG-022 |
| F-SOURCING-20 | Mở lại snapshot cũ (frozen) | TC-NGUONCUNG-023 |
| F-SOURCING-21 | Tạo mới sourcing entry | TC-NGUONCUNG-019, 020 |
| F-SOURCING-22 | Cập nhật sourcing entry | TC-NGUONCUNG-024, 025, 026, 027 |
| F-SOURCING-23 | Xoá sourcing entry | TC-NGUONCUNG-028, 029, 030 |
| F-SOURCING-24 | Upload ảnh gắn entry | TC-NGUONCUNG-031, 032, 033 |
| F-SOURCING-25 | Upload ảnh rời | TC-NGUONCUNG-034 |
| F-SOURCING-26 | Serve ảnh (JWT) | TC-NGUONCUNG-035, 036 |
| F-SOURCING-27 | Import Excel preview dry_run | TC-NGUONCUNG-037, 038, 042, 043, 044, 045 |
| F-SOURCING-28 | Import Excel commit | TC-NGUONCUNG-039, 040, 041 |
| F-SOURCING-29 | So sánh NCC theo mã | TC-NGUONCUNG-046 |
| F-SOURCING-30 | Bulk Lookup exact/fuzzy | TC-NGUONCUNG-047, 048, 049, 052 |
| F-SOURCING-31 | Copy TSV clipboard | TC-NGUONCUNG-050 |
| F-SOURCING-32 | Dropdown Người báo giá | TC-NGUONCUNG-055 |
| F-SOURCING-33 | Tạo báo giá hàng loạt | TC-NGUONCUNG-056, 057, 058, 059, 060, 061, 062, 074 |
| F-SOURCING-34 | Preview báo giá (không ghi DB) | TC-NGUONCUNG-067 |
| F-SOURCING-35 | Chọn định dạng xuất | TC-NGUONCUNG-063, 064, 065, 066 |
| F-SOURCING-36 | Tải file báo giá | TC-NGUONCUNG-084, 085 |
| F-SOURCING-37 | Danh sách báo giá đã tạo | TC-NGUONCUNG-076, 077 |
| F-SOURCING-38 | Đánh dấu đã gửi | TC-NGUONCUNG-078, 079 |
| F-SOURCING-39 | Sửa & gửi lại (prefill) | TC-NGUONCUNG-080 |
| F-SOURCING-40 | Version chain revise_of | TC-NGUONCUNG-081 |
| F-SOURCING-41 | Tạo đơn từ báo giá (idempotent) | TC-NGUONCUNG-082, 083 |
| F-SOURCING-42 | Tạo đơn hàng nguồn cung | TC-NGUONCUNG-083, 130 |
| F-SOURCING-43 | Danh sách đơn hàng | TC-NGUONCUNG-088 |
| F-SOURCING-44 | Xem chi tiết đơn | TC-NGUONCUNG-097 |
| F-SOURCING-45 | Sửa đơn hàng | TC-NGUONCUNG-098, 099 |
| F-SOURCING-46 | State machine chuyển trạng thái | TC-NGUONCUNG-089, 090, 091, 092, 093, 095 |
| F-SOURCING-47 | GET allowed-transitions | TC-NGUONCUNG-094 |
| F-SOURCING-48 | Đề xuất thanh toán | TC-NGUONCUNG-100, 101 |
| F-SOURCING-49 | Xem PDF báo giá (read-only) | TC-NGUONCUNG-103, 104 |
| F-SOURCING-50 | Tạo lại PDF (regenerate) | TC-NGUONCUNG-105, 106, 107 |
| F-SOURCING-51 | Tính nhanh calc-sale | TC-NGUONCUNG-108 |
| F-SOURCING-52 | Preview tính giá order | TC-NGUONCUNG-109 |
| F-SOURCING-53 | Danh sách giá NCC (fx stale) | TC-NGUONCUNG-110 |
| F-SOURCING-54 | Thêm giá NCC | TC-NGUONCUNG-111 |
| F-SOURCING-55 | Sửa giá NCC | TC-NGUONCUNG-112 |
| F-SOURCING-56 | Xoá giá NCC | TC-NGUONCUNG-113, 114 |
| F-SOURCING-57 | Đặt NCC primary | TC-NGUONCUNG-115 |
| F-SOURCING-58 | Danh sách pricing rules | TC-NGUONCUNG-116 |
| F-SOURCING-59 | Upsert pricing rule | TC-NGUONCUNG-117, 118 |
| F-SOURCING-60 | Lịch sử pricing rule | TC-NGUONCUNG-119 |
| F-SOURCING-61 | calc-suggest (golden + edge) | TC-NGUONCUNG-019, 020, 120, 121, 122 |
| F-SOURCING-62 | calc-suggest/bulk | TC-NGUONCUNG-123, 124 |
| F-SOURCING-63 | Đẩy sang Đấu thầu NCC | TC-NGUONCUNG-086, 087 |
| F-SOURCING-64 | Kanban pipeline | TC-NGUONCUNG-088 |
| F-SOURCING-65 | Table view đơn hàng | TC-NGUONCUNG-096 (bảng dùng để bulk-select) |
| F-SOURCING-66 | Bulk chuyển trạng thái nhiều đơn | TC-NGUONCUNG-096 |
| F-SOURCING-67 | Deep-link ?order_id= | TC-NGUONCUNG-097 |
| F-SOURCING-68 | Nút "Khách đã đặt" | TC-NGUONCUNG-089 |
| F-SOURCING-69 | Nút "Đề xuất TT kế toán" trên bảng | TC-NGUONCUNG-100 |
| F-SOURCING-70 | Xuất PDF trực tiếp từ bảng đơn | TC-NGUONCUNG-106, 130 |
| F-SOURCING-71 | Empty state bảng sourcing | TC-NGUONCUNG-132 |
| F-SOURCING-72 | Column picker | TC-NGUONCUNG-125 |
| F-SOURCING-73 | Paste text / IMV vào modal | TC-NGUONCUNG-126, 127 |
| F-SOURCING-74 | Cảnh báo fx_stale/fx_error chặn export | TC-NGUONCUNG-110, 128 |

Đã sửa (03/07): F-SOURCING-71 (Empty state khi bảng không có dữ liệu) trước đây map ẢO vào TC-071 (thực chất TC-071 là ca "Xuất PDF báo giá N=6 dòng", không liên quan empty-state) do đánh số liền kề nhầm. Nay map đúng vào **TC-NGUONCUNG-132** (ca riêng, viết mới, đọc text thật từ `sourcing/page.tsx`) — không còn mục "bổ sung không mã TC" nào bị bỏ trống trong bảng Map.

Biên đa tiền tệ + golden pricing engine (test unit sẵn có, không lặp lại nhưng đối chiếu trực tiếp trong E2E): `test_import_scenario_S_equals_4747064` ↔ TC-NGUONCUNG-019; `test_domestic_scenario_S_equals_4399740` ↔ TC-NGUONCUNG-020; `test_unknown_item_type_falls_back_to_default` ↔ TC-NGUONCUNG-120; `test_zero_cost_returns_zero` ↔ TC-NGUONCUNG-121; `test_negative_cost_raises` ↔ TC-NGUONCUNG-122.

BUG-GATE trong mảng này: **BG-SOURCING-01** (TC-NGUONCUNG-070, PDF tràn trang N≥5 — W3-04) — ca này KHÔNG tính vào coverage tính năng, chỉ xác nhận trạng thái bug.
