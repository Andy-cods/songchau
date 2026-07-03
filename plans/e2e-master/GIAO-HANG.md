# Test case E2E — Giao hàng + Hồ sơ (dossier)

Phạm vi: `/bqms/deliveries`, `/bqms/deliveries/new-dossier`, `/shipments`, `/shipments/[id]` (songchau-erp).
Nguồn kiểm kê: kiểm kê mảng 67 feature F-DELIVERY-01..67 + 18 feature F-SHIP-01..18 (85 feature).
Không có bộ test tự động sẵn có cho mảng này — toàn bộ 100% viết mới.

## Dữ liệu chuẩn bị chung

**Tài khoản test cố định** (seed 1 lần, dùng chung toàn bộ suite, không dùng tài khoản thật của Thang):
| user | role | dùng cho |
|---|---|---|
| test_admin@songchau.test | admin | full quyền, mọi ca PASS |
| test_manager@songchau.test | manager | full quyền deliveries+dossier, nhận notification duyệt |
| test_staff@songchau.test | staff | full quyền deliveries+dossier, chủ job (test 3-job-active) |
| test_warehouse@songchau.test | warehouse | wizard dossier, nhận notification PATCH status |
| test_sales@songchau.test | sales | wizard dossier (được phép), KHÔNG được /deliveries CRUD chính (chỉ bulk-lookup) |
| test_procurement@songchau.test | procurement | wizard dossier, bulk-lookup |
| test_accountant@songchau.test | accountant | wizard dossier, bulk-lookup |
| test_viewer@songchau.test | viewer | chỉ đọc — chuẩn chặn cho mọi ca 403; bulk-lookup được phép (role mở rộng) |
| test_director@songchau.test | director/manager cấp cao | dùng cho ca duyệt song song nếu cần |

**Bản ghi mồi (prefix DEMO- để dọn bằng glob, dọn trong teardown mọi ca ghi filesystem):**
- `DEMO-PO-3DOT` / `DEMO-BQMS-001`: 1 cặp (po_number, bqms_code) có **3 đợt giao** (3 dòng bqms_deliveries cùng po+code, delivered_at khác nhau) → mồi dedup, badge "3 đợt giao", `header_from_last_attempt`.
- `DEMO-JOB-QUEUED-1`, `DEMO-JOB-QUEUED-2`: dossier_jobs status=`queued`.
- `DEMO-JOB-RUNNING-STALE`: status=`running`, `heartbeat_at` set giả > 5 phút trước → mồi `stuck_warning` + watchdog.
- `DEMO-JOB-AWAITING`: status=`awaiting_confirm`, `checkpoint_started_at` mồi countdown 300s.
- `DEMO-JOB-DONE`: status=`done`, có `output_folder` **thật tồn tại trên đĩa** dưới `/data/onedrive-staging/Puplic/BQMS/Giao hàng/DEMO-...` chứa 1 Excel + 1 PDF Delivery Note + 1 PDF PO + 1 ảnh — mồi cho update-regenerate, tải file, tải zip.
- `DEMO-JOB-FAILED`: status=`failed`.
- `DEMO-STAFF-3ACTIVE`: test_staff đã sở hữu sẵn 3 job active (queued+running+awaiting_confirm) trước khi chạy ca 429.
- `DEMO-SEV-ITEMS` (2 dòng SEV), `DEMO-SEVT-ITEMS` (2 dòng SEVT), `DEMO-MIX-SEVSEVT` (1 dòng SEV + 1 dòng SEVT cùng chọn) → mồi 400 mix.
- `DEMO-BQMS-IMG-5LAYER`: 1 mã BQMS có đủ 5 lớp ảnh ưu tiên (picker-pinned/override-RFQ/override-code/image_index/FS scan) để test smart image lookup.
- Fixture file cố định trong `tests/fixtures/files/`: `anh_hop_le.jpg` (~4.9MB), `anh_bien_5mb.png` (đúng 5MB), `anh_qua_5mb.png` (5MB+1 byte), `anh_sai_dinh_dang.webp`, `file_0_byte.jpg`.
- Shipments: `DEMO-SHIP-PENDING` (status=pending), `DEMO-SHIP-INTRANSIT` (status=in_transit), `DEMO-SHIP-ARRIVED` (status=arrived_port), `DEMO-SHIP-RECEIVED` (status=received, không được sửa), `DEMO-PO-FOR-SHIP` (PO còn item chưa gắn shipment nào, mồi POST tạo lô hàng).

**Nguyên tắc AN TOÀN — KHÔNG đụng Samsung thật:**
- Mọi ca liên quan `create-dossier` chỉ chạy tới ranh giới **enqueue job** ([AUTO-API] — assert bản ghi job tạo đúng trong DB, KHÔNG chờ worker Procrastinate chạy scraper Samsung thật) hoặc tới **awaiting_confirm rồi bấm Huỷ** ([SEMI-UI] — an toàn, không tạo Delivery thật trên Samsung).
- Ca duy nhất chạm nút **Xác nhận (Confirm)** thật tại checkpoint được đánh dấu `[MANUAL ⚠️ KHÔNG HOÀN TÁC]` — chỉ Thang chạy có giám sát, ngoài giờ làm việc SEC, dùng đúng 1 PO/mã hy sinh định trước, có checklist screenshot. Không đưa vào CI/automation.
- Sau mỗi ca ghi file thật (dossier job done), teardown xoá thư mục theo glob `DEMO-*` dưới `/data/onedrive-staging/Puplic/BQMS/Giao hàng/`.
- Mã HTTP kỳ vọng ghi trực tiếp trong cột "Kỳ vọng" (không tách cột riêng theo đúng khuôn 9 cột được duyệt cho file này).

---

## Bảng test case

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-GIAOHANG-001 | Mở trang danh sách Giao hàng | Đơn lẻ | staff | Đăng nhập bình thường | 1. Vào `/bqms/deliveries` | Bảng Excel-like hiển thị, dedup theo (po_number,bqms_code) hiện đợt giao mới nhất | P1 | UI |
| TC-GIAOHANG-002 | Viewer bị khoá nút sửa trên trang Giao hàng | Permission | viewer | test_viewer đăng nhập | 1. Vào `/bqms/deliveries` 2. Click 1 ô để sửa | `useIsReadOnly()`=true → ô không vào chế độ edit, không có nút Lưu | P1 | UI |
| TC-GIAOHANG-003 | GET /bqms/deliveries trả list phân trang đúng | Đơn lẻ | staff | Có ≥60 dòng dữ liệu mồi | 1. GET `/bqms/deliveries?page=1&limit=50` | 200, trả 50 item, `total` = tổng dedup thật | P1 | API |
| TC-GIAOHANG-004 | Filter status hợp lệ | Đơn lẻ | staff | DEMO-PO-3DOT có dòng status=`da_giao` | 1. GET `?status=da_giao` | 200, chỉ trả dòng `da_giao` | P2 | API |
| TC-GIAOHANG-005 | Filter month/year biên hợp lệ | Đơn lẻ | staff | — | 1. GET `?month=1` 2. GET `?month=12` 3. GET `?year=2020` 4. GET `?year=2099` | 200 cả 4 | P2 | API |
| TC-GIAOHANG-006 | Filter month/year ngoài biên → 422 | Negative | staff | — | 1. GET `?month=0` 2. GET `?month=13` 3. GET `?year=2019` 4. GET `?year=2100` | 422 cả 4 (bqms.py `_build_delivery_filters`) | P1 | API |
| TC-GIAOHANG-007 | Search theo PO/BQMS/shipping/spec/item_name/quotation_no | Đơn lẻ | staff | Gõ đúng 1 phần mã DEMO-PO-3DOT | 1. GET `?search=DEMO-PO-3DOT` | 200, chỉ trả dòng khớp ILIKE | P2 | API |
| TC-GIAOHANG-008 | limit ngoài biên (>200) | Negative | staff | — | 1. GET `?limit=201` | 400/422 (limit 1..200) | P2 | API |
| TC-GIAOHANG-009 | KPI cards hiển thị đúng 5 số | Đơn lẻ | staff | DEMO-PO-3DOT + vài dòng trạng thái khác | 1. Vào `/bqms/deliveries` xem 5 card đầu trang | Tổng đơn/Đã giao/Đang giao/Chưa giao/Tổng giá trị đã giao khớp dedup theo dòng mới nhất; tổng giá trị SUM riêng theo dòng (kể cả partial) | P1 | API+UI |
| TC-GIAOHANG-010 | KPI không double-count PO có 3 đợt giao | Edge | staff | DEMO-PO-3DOT (3 dòng, 1 cặp po+code) | 1. GET `/bqms/deliveries/kpi` | "Tổng đơn" đếm DEMO-PO-3DOT là **1**, không phải 3 | P1 | API |
| TC-GIAOHANG-011 | Pill filter trạng thái (Tất cả/Chưa giao/Đang giao/Đã giao/Hoàn tất) | Đơn lẻ | staff | — | 1. Click từng pill lần lượt | Bảng lọc đúng theo pill, pill active có highlight | P2 | UI |
| TC-GIAOHANG-012 | Ô tìm kiếm trên UI | Đơn lẻ | staff | — | 1. Gõ mã BQMS vào ô tìm kiếm | Bảng lọc realtime/debounce đúng kết quả | P2 | UI |
| TC-GIAOHANG-013 | Toggle "Ẩn đã giao/hoàn tất" | Đơn lẻ | staff | Có dòng đã giao + chưa giao | 1. Bật toggle "Ẩn đã giao/hoàn tất" | Dòng đã-giao/hoàn-tất biến mất khỏi UI (không xoá DB) 2. Tắt toggle → dòng trở lại | P2 | UI |
| TC-GIAOHANG-014 | Column picker lưu localStorage | Đơn lẻ | staff | — | 1. Click nút chọn cột 2. Bỏ tick 2 cột 3. F5 reload trang | Bảng chỉ còn cột đã chọn sau reload (đọc `delivery_columns_v4`) | P3 | UI |
| TC-GIAOHANG-015 | Column picker localStorage hỏng không làm trắng trang | Edge | staff | Set `localStorage.delivery_columns_v4='{bad json'` bằng devtools | 1. Reload `/bqms/deliveries` | Trang vẫn render (fallback cột mặc định), không crash trắng trang | P2 | UI |
| TC-GIAOHANG-016 | Export Excel danh sách | Đơn lẻ | staff | ≤10.000 dòng | 1. Click "Xuất Excel" | 200, tải về .xlsx 23 cột format THỐNG KÊ PO, freeze header | P1 | API |
| TC-GIAOHANG-017 | Export Excel vượt 10.000 dòng | Negative | staff | Seed/giả lập >10.000 dòng khớp filter | 1. GET `/bqms/deliveries/export` với filter ra >10.000 dòng | 400 | P2 | API |
| TC-GIAOHANG-018 | Export bởi role không được phép → 403 | Permission | sales | test_sales đăng nhập | 1. GET `/bqms/deliveries/export` | 403 (chỉ staff/manager/admin) | P1 | API |
| TC-GIAOHANG-019 | Mở Revenue Dashboard modal | Đơn lẻ | manager | — | 1. Click nút mở Revenue Dashboard | Modal hiện summary+timeseries+breakdown doanh thu PO | P2 | UI |
| TC-GIAOHANG-020 | revenue-stats group_by hợp lệ | Đơn lẻ | manager | — | 1. GET `/bqms/deliveries/revenue-stats?group_by=day` 2. lặp lại với month/driver/po/bqms/recipient/origin/status | 200 tất cả 8 giá trị group_by | P2 | API |
| TC-GIAOHANG-021 | revenue-stats group_by không hợp lệ → 400 | Negative | manager | — | 1. GET `?group_by=abc` | 400 | P2 | API |
| TC-GIAOHANG-022 | revenue-stats breakdown_limit biên | Edge | manager | — | 1. GET `?breakdown_limit=1` 2. GET `?breakdown_limit=100` 3. GET `?breakdown_limit=101` | 200/200/400 | P3 | API |
| TC-GIAOHANG-023 | Mở Quản lý người giao hàng (Driver Management) | Đơn lẻ | admin | — | 1. Click nút "Quản lý người giao hàng" 2. Thêm 1 tài xế (họ tên, CCCD, biển số xe) | Modal hiện danh sách; tài xế mới xuất hiện trong danh sách | P2 | UI |
| TC-GIAOHANG-024 | Gán tài xế inline cho 1 dòng giao hàng (DriverPicker) | Đơn lẻ | staff | Có ≥1 tài xế trong hệ thống | 1. Click ô DriverPicker trên 1 dòng 2. Chọn tài xế | PUT `/deliveries/{id}` field driver_id cập nhật; ô hiển thị tên tài xế | P2 | API+UI |
| TC-GIAOHANG-025 | Tạo mới delivery thủ công — happy path | Đơn lẻ | staff | — | 1. Click "Tạo mới" 2. Điền po_number, bqms_code, specification 3. Click nút Lưu | 201, dòng mới xuất hiện, delivery_status=`chua_giao`, unit=`EA`, data_source=`manual` | P1 | API+UI |
| TC-GIAOHANG-026 | Tạo mới thiếu field bắt buộc | Negative | staff | — | 1. Mở modal Tạo mới 2. Chỉ điền po_number, để trống bqms_code | Nút Lưu bị disable (FE) ; nếu gọi thẳng POST thiếu field → 400 | P1 | API+UI |
| TC-GIAOHANG-027 | Modal Tạo mới — chọn liên hệ (contact suggestion) autofill | Đơn lẻ | staff | Có sẵn 1 contact trùng tên | 1. Mở modal Tạo mới 2. Gõ tên liên hệ, chọn gợi ý | Các field buyer info (dept/recipient...) tự điền theo contact chọn | P2 | UI |
| TC-GIAOHANG-028 | Sửa delivery — optimistic lock happy path | Đơn lẻ | staff | 1 dòng version=N | 1. PUT `/deliveries/{id}` với version=N | 200, version tăng lên N+1 | P1 | API |
| TC-GIAOHANG-029 | Optimistic lock — 2 tab cùng sửa 1 dòng | Kết hợp | staff | 2 tab cùng mở 1 dòng version=N | 1. Tab A PUT version=N (thành công) 2. Tab B PUT version=N (đã cũ) | Tab A: 200. Tab B: 409, UI hiện cảnh báo conflict, KHÔNG ghi đè âm thầm | P1 | API |
| TC-GIAOHANG-030 | PUT không gửi field nào → 400 | Negative | staff | — | 1. PUT `/deliveries/{id}` body rỗng | 400 | P2 | API |
| TC-GIAOHANG-031 | Inline edit Pending qty tự tính SL đã giao | Đơn lẻ | staff | Dòng có SL đặt=100 | 1. Click ô Pending, nhập 30 2. Enter | SL đã giao hiển thị = 100-30=70 | P1 | UI |
| TC-GIAOHANG-032 | Inline edit Pending qty nhập âm/chữ | Negative | staff | Dòng SL đặt=100 | 1. Nhập Pending=150 (âm) 2. Nhập Pending="abc" | Cả 2: validate chặn hoặc trả 400, không lưu giá trị sai | P2 | UI |
| TC-GIAOHANG-033 | Inline đổi trạng thái qua dropdown state-machine | Đơn lẻ | staff | Dòng status=`chua_giao` | 1. Click ô trạng thái 2. Chọn "Đang giao" | PATCH `/deliveries/{id}/status`, 200, badge đổi màu | P1 | API+UI |
| TC-GIAOHANG-034 | PATCH status với giá trị không hợp lệ | Negative | staff | — | 1. PATCH `/deliveries/{id}/status` body `{status:"khong_ton_tai"}` | 400 (ngoài VALID_STATUSES) | P1 | API |
| TC-GIAOHANG-035 | PATCH status sang "đã giao" tự set actual_delivered_at + gửi notification | Kết hợp | staff | Dòng status=`dang_giao` | 1. PATCH status=`da_giao` | 200; DB `actual_delivered_at` được set = thời điểm hiện tại; notification dispatch tới manager+warehouse (kiểm tra badge unread tăng ở tài khoản manager/warehouse) | P1 | API |
| TC-GIAOHANG-036 | Inline edit field text/number khác (generic editor) | Đơn lẻ | staff | — | 1. Click ô spec/ghi chú 2. Sửa giá trị 3. Enter | Lưu qua PUT, hiển thị giá trị mới | P3 | UI |
| TC-GIAOHANG-037 | Sort cột bằng click header | Đơn lẻ | staff | — | 1. Click header cột ngày giao (ArrowUpDown) | Bảng sắp xếp tăng/giảm dần đúng | P3 | UI |
| TC-GIAOHANG-038 | Checkbox chọn tất cả dòng trên trang | Đơn lẻ | staff | — | 1. Click checkbox header | Toàn bộ dòng trang hiện tại được tick | P3 | UI |
| TC-GIAOHANG-039 | Click dòng mở Detail slide-over panel | Đơn lẻ | staff | — | 1. Click vào 1 dòng bảng | Panel mở bên phải hiện đủ 6 nhóm: Sản phẩm/Thông tin PO/Spec/Giao hàng/Liên hệ/Ghi chú | P2 | UI |
| TC-GIAOHANG-040 | Đóng detail panel bằng ESC và nút X | Đơn lẻ | staff | Panel đang mở | 1. Nhấn phím ESC 2. Mở lại, click nút X | Cả 2 cách đều đóng panel | P3 | UI |
| TC-GIAOHANG-041 | Badge cảnh báo trùng (amber dot) | Đơn lẻ | staff | Seed 1 dòng trùng key nghi vấn | 1. Vào `/bqms/deliveries` | Dòng nghi trùng hiện chấm cam cảnh báo | P3 | UI |
| TC-GIAOHANG-042 | Phân trang Prev/Next disable ở biên | Đơn lẻ | staff | Có ≥1 trang | 1. Ở trang 1, kiểm tra nút Prev 2. Sang trang cuối, kiểm tra nút Next | Prev disable ở trang 1; Next disable ở trang cuối | P3 | UI |
| TC-GIAOHANG-043 | Multi-select → Thống kê xuất xứ (Origin Summary) | Đơn lẻ | staff | Tick ≥2 dòng | 1. Tick 2 dòng 2. Click "Thống kê xuất xứ" | Modal hiện bqms_code + country_origin đúng 2 dòng chọn | P2 | API+UI |
| TC-GIAOHANG-044 | origin-summary vượt 1000 ID → 400 | Negative | staff | — | 1. POST `/deliveries/origin-summary` với 1001 id | 400 | P2 | API |
| TC-GIAOHANG-045 | origin-summary danh sách rỗng | Edge | staff | — | 1. POST body `{ids: []}` | 200, `{items:[], total:0}` — không lỗi | P2 | API |
| TC-GIAOHANG-046 | Copy kết quả Origin Summary | Đơn lẻ | staff | Modal đang mở có dữ liệu | 1. Click nút copy | Clipboard chứa text kết quả, toast xác nhận | P3 | UI |
| TC-GIAOHANG-047 | Tra cứu hàng loạt (Bulk lookup) — happy path | Đơn lẻ | staff | Paste 3 mã BQMS hợp lệ | 1. Click "Tra cứu hàng loạt" 2. Dán 3 mã 3. Click tra cứu | 200, trả items + found_codes đủ 3 mã | P1 | API+UI |
| TC-GIAOHANG-048 | Bulk lookup mở rộng role (viewer/sales/procurement/warehouse/accountant) | Permission | viewer | — | 1. POST `/deliveries/bulk-lookup` với 1 mã hợp lệ, dùng token viewer | 200 (role được mở rộng, khác với endpoint list chính) | P2 | API |
| TC-GIAOHANG-049 | Bulk lookup vượt 200 mã → 400 | Negative | staff | 201 mã | 1. POST 201 mã | 400 | P2 | API |
| TC-GIAOHANG-050 | Bulk lookup rỗng → 400 | Negative | staff | — | 1. POST codes=[] | 400 | P2 | API |
| TC-GIAOHANG-051 | Bulk lookup normalize (khoảng trắng, chữ thường, trùng) | Edge | staff | Dán `" abc123 "`, `"ABC123"`, `"abc123"` (3 biến thể cùng mã) | 1. POST 3 chuỗi trên | Normalize trim+uppercase+dedup → chỉ tra cứu 1 mã `ABC123` | P2 | API |
| TC-GIAOHANG-052 | Bulk lookup mã không tồn tại → missing_codes | Edge | staff | 1 mã có thật + 1 mã bịa | 1. POST cả 2 | 200, mã có thật vào `found_codes`, mã bịa vào `missing_codes` | P2 | API |
| TC-GIAOHANG-053 | Toggle view Summary/Rows + copy trong Bulk lookup modal | Đơn lẻ | staff | Đã có kết quả tra cứu | 1. Click toggle Summary↔Rows 2. Click copy | Hiển thị đổi đúng chế độ; copy thành công | P3 | UI |
| TC-GIAOHANG-054 | Mở "Mở lại hồ sơ" (DossierJobsModal) | Đơn lẻ | staff | Có job DEMO-JOB-DONE | 1. Click "Mở lại hồ sơ" | Modal liệt kê job gần đây, thấy DEMO-JOB-DONE | P2 | API+UI |
| TC-GIAOHANG-055 | dossier-jobs limit biên | Edge | staff | — | 1. GET `?limit=1` 2. GET `?limit=200` 3. GET `?limit=201` | 200/200/400 (hoặc mặc định 50 nếu bỏ trống) | P3 | API |
| TC-GIAOHANG-056 | Nút "Mở thư mục" trong DossierJobsModal | Đơn lẻ | staff | DEMO-JOB-DONE có output_folder | 1. Trong modal, click "Mở thư mục" trên dòng DEMO-JOB-DONE | Điều hướng sang Quản lý tài liệu đúng thư mục job | P3 | UI |
| TC-GIAOHANG-057 | Nút "Sửa" trong DossierJobsModal điều hướng edit wizard | Đơn lẻ | staff | DEMO-JOB-DONE | 1. Click "Sửa" trên dòng DEMO-JOB-DONE | Điều hướng `/bqms/deliveries/new-dossier?job={id}`, wizard vào Edit mode | P1 | UI |
| TC-GIAOHANG-058 | GET shipments lịch sử đầy đủ cho 1 cặp po+code | Đơn lẻ | staff | DEMO-PO-3DOT (3 đợt) | 1. GET `/deliveries/shipments?po_number=...&bqms_code=...` | 200, trả đủ **3** dòng lịch sử (không dedup như bảng chính) | P1 | API |
| TC-GIAOHANG-059 | GET shipments thiếu param → 422 | Negative | staff | — | 1. GET `/deliveries/shipments` (không param) | 422 | P2 | API |
| TC-GIAOHANG-060 | Số dòng bảng chính (dedup) vs tổng shipments khớp logic | Kết hợp | staff | DEMO-PO-3DOT | 1. GET danh sách chính → đếm DEMO-PO-3DOT = 1 dòng 2. GET shipments cùng cặp → 3 dòng | Bảng chính hiện 1 (mới nhất) + badge "3 đợt giao"; slide-over "N đợt giao" hiện đủ 3 | P1 | API+UI |
| TC-GIAOHANG-061 | User vượt 3 job active → 429 | Negative | staff | DEMO-STAFF-3ACTIVE (3 job active) | 1. test_staff POST `/deliveries/create-dossier` job thứ 4 | 429 | P1 | API |
| TC-GIAOHANG-062 | Hệ thống ≥10 job trong queue → 503 | Negative | staff | Seed 10 job status=`queued` toàn hệ | 1. Bất kỳ user POST create-dossier job mới | 503 | P2 | API |
| TC-GIAOHANG-063 | Mở wizard Tạo hồ sơ — Create mode | Đơn lẻ | staff | Tick 2 dòng delivery ở trang danh sách | 1. Tick 2 dòng 2. Bấm nút tạo hồ sơ (điều hướng `new-dossier?ids=...`) | Wizard mở 6 tab: Thông tin chung/Packing List/Cam kết HA/List Detail/Label/Tổng hợp, tab 1 hiện | P1 | UI |
| TC-GIAOHANG-064 | Wizard — Edit mode hydrate từ job cũ | Đơn lẻ | staff | DEMO-JOB-DONE | 1. Vào `new-dossier?job={DEMO-JOB-DONE.id}` | Form hydrate đúng dữ liệu đã lưu (form_data) + ảnh cũ hiện lại | P1 | API+UI |
| TC-GIAOHANG-065 | Dot indicator tab đổi màu theo trạng thái điền | Đơn lẻ | staff | Wizard Create mode mới mở | 1. Bỏ trống tab 1 → xem dot 2. Điền đủ tab 1 → xem dot | untouched=slate → complete=emerald khi đủ field; attention=amber khi thiếu 1 phần | P2 | UI |
| TC-GIAOHANG-066 | dossier-prefill happy path | Đơn lẻ | staff | Tick 2 dòng DEMO-SEV-ITEMS | 1. POST `/deliveries/dossier-prefill` body delivery_ids=[2 id] | 200, form prefill đủ item, dept/pr_person/receiver theo rule | P1 | API |
| TC-GIAOHANG-067 | dossier-prefill delivery_ids rỗng/sai kiểu → 400 | Negative | staff | — | 1. POST body `{delivery_ids: []}` 2. POST body `{delivery_ids: "abc"}` | 400 cả 2 | P1 | API |
| TC-GIAOHANG-068 | dossier-prefill delivery_ids không tồn tại → 404 | Negative | staff | — | 1. POST `{delivery_ids:[999999999]}` | 404 | P2 | API |
| TC-GIAOHANG-069 | dossier-prefill chặn mix SEV/SEVT | Negative | staff | DEMO-MIX-SEVSEVT (1 SEV + 1 SEVT) | 1. POST prefill với cả 2 id | 400 | P1 | API |
| TC-GIAOHANG-070 | create-dossier chặn mix SEV/SEVT (tầng tạo job) | Negative | staff | DEMO-MIX-SEVSEVT | 1. POST `/deliveries/create-dossier` items lẫn SEV+SEVT | 400 | P1 | API |
| TC-GIAOHANG-071 | Auto-fill vendor_invoice_no theo pattern {DDMMYYYY}-{NN} | Đơn lẻ | staff | Chưa có hồ sơ nào hôm nay | 1. Prefill 1 hồ sơ mới hôm nay | vendor_invoice_no = `{hôm nay DDMMYYYY}-01` | P2 | API |
| TC-GIAOHANG-072 | Counter vendor_invoice_no tăng đúng khi 2 hồ sơ cùng ngày | Kết hợp | staff | 2 job prefill liên tiếp cùng ngày | 1. Prefill job A 2. Prefill job B (cùng ngày) | job A = `-01`, job B = `-02`, không trùng số | P1 | API |
| TC-GIAOHANG-073 | Smart image lookup 5-layer priority | Đơn lẻ | staff | DEMO-BQMS-IMG-5LAYER có đủ 5 lớp | 1. Prefill hồ sơ chứa mã này | `system_image_url` trả đúng lớp ưu tiên cao nhất (P0 picker-pinned) | P2 | API |
| TC-GIAOHANG-074 | Auto-prefill per-item history từ job done trước | Đơn lẻ | staff | DEMO-JOB-DONE cùng bqms_code với job mới | 1. Prefill hồ sơ mới chứa cùng mã BQMS đã có ở DEMO-JOB-DONE | dim_l/w/h, box_weight, unit... tự điền theo lịch sử job trước | P2 | API |
| TC-GIAOHANG-075 | Prefill dept/pr_person/receiver theo rule | Đơn lẻ | staff | Delivery có receiving_warehouse + recipient_name | 1. Prefill | dept=receiving_warehouse, pr_person=recipient_name, receiver luôn để trống (locked, không cho sửa ở FE) | P2 | API+UI |
| TC-GIAOHANG-076 | Multi-delivery history + "Dùng lại" header từ lần giao trước | Luồng | staff | DEMO-PO-3DOT (đã có hồ sơ lần 1) | 1. Chọn dòng giao lần 2 của DEMO-PO-3DOT 2. Prefill | Hiện "lần 2 của PO này" + nút "Dùng lại" header lần trước 3. Click "Dùng lại" | Header (nơi nhận, thông tin giao...) copy từ hồ sơ lần 1; shipping_no/output_folder vẫn tách riêng cho lần 2 | P1 | API+UI |
| TC-GIAOHANG-077 | Upload ảnh Hệ thống/Thực tế — happy path | Đơn lẻ | staff | Job đang ở trạng thái nhập liệu (chưa done/failed), file `anh_hop_le.jpg` | 1. Tab Cam kết HA 2. Chọn 1 item 3. Upload ảnh slot "Thực tế" | 200, ảnh lưu, preview hiện trong wizard | P1 | API+UI |
| TC-GIAOHANG-078 | Upload ảnh đúng biên 5MB | Edge | staff | `anh_bien_5mb.png` đúng 5,000,000 byte | 1. Upload | 200 (đúng biên PASS) | P2 | API |
| TC-GIAOHANG-079 | Upload ảnh vượt 5MB → 413 | Negative | staff | `anh_qua_5mb.png` = 5MB+1byte | 1. Upload | 413 | P1 | API |
| TC-GIAOHANG-080 | Upload sai định dạng → 400 | Negative | staff | `anh_sai_dinh_dang.webp` | 1. Upload | 400 (chỉ nhận .png/.jpg/.jpeg) | P1 | API |
| TC-GIAOHANG-081 | Upload slot không hợp lệ → 400 | Negative | staff | — | 1. POST upload-image với `slot="khac"` | 400 (chỉ nhận actual/system) | P2 | API |
| TC-GIAOHANG-082 | Upload khi job không tồn tại → 404 | Negative | staff | job_id giả | 1. POST upload-image job_id=999999 | 404 | P2 | API |
| TC-GIAOHANG-083 | Upload khi job đã done/failed → 409 | Negative | staff | DEMO-JOB-DONE | 1. POST upload-image lên job DEMO-JOB-DONE | 409 | P1 | API |
| TC-GIAOHANG-084 | GET lại ảnh đã upload (hydrate khi sửa) | Đơn lẻ | staff | Job đã có ảnh upload | 1. Mở lại wizard edit job đó | Ảnh cũ hiện lại đúng slot | P2 | API |
| TC-GIAOHANG-085 | GET ảnh khi chưa upload → 404 | Negative | staff | Job chưa có ảnh slot đó | 1. GET `/dossier-job/{id}/image?slot=system` | 404 | P3 | API |
| TC-GIAOHANG-086 | GET ảnh slot sai → 400 | Negative | staff | — | 1. GET `?slot=abc` | 400 | P3 | API |
| TC-GIAOHANG-087 | GET dossier-system-image theo mã hợp lệ | Đơn lẻ | staff | DEMO-BQMS-IMG-5LAYER | 1. GET `/dossier-system-image/{bqms_code}` | 200, stream ảnh | P2 | API |
| TC-GIAOHANG-088 | dossier-system-image mã sai regex → 400 | Negative | staff | — | 1. GET `/dossier-system-image/abc$%^` | 400 | P2 | API |
| TC-GIAOHANG-089 | dossier-system-image mã không có ảnh → 404 | Negative | staff | Mã hợp lệ nhưng không có ảnh | 1. GET | 404 | P3 | API |
| TC-GIAOHANG-090 | Enqueue job create-dossier — happy path [AUTO-API] | Đơn lẻ | staff | Prefill xong 1 form hợp lệ | 1. Click "Tạo hồ sơ" ở tab Tổng hợp (submit) | 200/201, job tạo status=`queued`, có `queue_position`; **không** chờ worker chạy thật | P1 | API |
| TC-GIAOHANG-091 | create-dossier sev_type sai → 400 | Negative | staff | — | 1. POST create-dossier body sev_type=`SEVX` | 400 | P1 | API |
| TC-GIAOHANG-092 | create-dossier items rỗng → 400 | Negative | staff | — | 1. POST body items=[] | 400 | P1 | API |
| TC-GIAOHANG-093 | create-dossier item không khớp delivery row → 400 | Negative | staff | item bqms_code không tồn tại trong bqms_deliveries | 1. POST với item lạ | 400 | P2 | API |
| TC-GIAOHANG-094 | create-dossier defer task thất bại → job set failed | Edge | staff | Giả lập Procrastinate lỗi (mock) | 1. POST create-dossier trong điều kiện defer lỗi | 500, job trong DB có status=`failed` (không kẹt `queued` ma) | P3 | API |
| TC-GIAOHANG-095 | Poll job status — queued | Đơn lẻ | staff | DEMO-JOB-QUEUED-1 | 1. GET `/dossier-job/{id}` (FE poll mỗi 4s) | 200, `queue_position` + `eta_seconds` trả về | P2 | API |
| TC-GIAOHANG-096 | Poll job status — running quá 5 phút không heartbeat | Edge | staff | DEMO-JOB-RUNNING-STALE | 1. GET `/dossier-job/{id}` | 200, có field `stuck_warning=true` | P1 | API |
| TC-GIAOHANG-097 | Poll job status — job không tồn tại → 404 | Negative | staff | — | 1. GET `/dossier-job/999999999` | 404 | P2 | API |
| TC-GIAOHANG-098 | Checkpoint awaiting_confirm hiện đúng UI [SEMI-UI] | Đơn lẻ | staff | DEMO-JOB-AWAITING | 1. Mở wizard poll tới job này | UI hiện `confirm_image_url` (screenshot popup Create Delivery đã điền), đếm ngược từ `confirm_remaining_seconds`, 2 nút "Xác nhận" / "Huỷ" | P1 | API+UI |
| TC-GIAOHANG-099 | Đếm ngược 300s hiển thị đúng | Đơn lẻ | staff | DEMO-JOB-AWAITING mới bắt đầu | 1. Quan sát đồng hồ đếm ngược | Bắt đầu ~300s, giảm dần theo giây thật | P2 | UI |
| TC-GIAOHANG-100 | Bấm "Huỷ" tại checkpoint [SEMI-UI] — an toàn | Đơn lẻ | staff | DEMO-JOB-AWAITING | 1. Bấm nút "Huỷ" | 200, job chuyển sang trạng thái huỷ (không tạo Delivery thật trên Samsung); toast xác nhận đã huỷ | P1 | API+UI |
| TC-GIAOHANG-101 | Bấm "Xác nhận" / "Huỷ" khi job không ở awaiting_confirm → 409 | Negative | staff | DEMO-JOB-DONE | 1. POST `/dossier-job/{id}/confirm` 2. POST `/dossier-job/{id}/cancel` | 409 cả 2 | P1 | API |
| TC-GIAOHANG-102 | Confirm/cancel job không tồn tại → 404 | Negative | staff | — | 1. POST confirm job_id=999999999 | 404 | P2 | API |
| TC-GIAOHANG-103 | Auto-cancel khi hết 300s (server-side) | Edge | staff | DEMO-JOB-AWAITING đặt `checkpoint_started_at` = 301s trước | 1. GET poll job status | Job tự chuyển trạng thái huỷ (server tự phát hiện quá hạn), UI không còn cho phép Confirm | P1 | API |
| TC-GIAOHANG-104 | Biên đúng 299s vs 301s tại checkpoint | Edge | staff | 2 job đặt checkpoint_started_at 299s và 301s trước | 1. GET poll cả 2 job | Job 299s: vẫn awaiting_confirm, còn cho Confirm/Huỷ. Job 301s: đã auto-cancel | P2 | API |
| TC-GIAOHANG-105 | Bấm "Xác nhận" thật tại checkpoint [MANUAL ⚠️ KHÔNG HOÀN TÁC] | Đơn lẻ | admin (Thang giám sát) | 1 PO/mã hy sinh định trước, ngoài giờ SEC | 1. Chỉ Thang bấm "Xác nhận" trên đúng 1 job đã duyệt | Samsung tạo Delivery thật, không hoàn tác được; checklist screenshot từng bước; **KHÔNG chạy trong CI/automation** | P1 | Tay |
| TC-GIAOHANG-106 | GET confirm-image chưa có screenshot → 404 | Negative | staff | Job chưa tới awaiting_confirm | 1. GET `/dossier-job/{id}/confirm-image` | 404 | P3 | API |
| TC-GIAOHANG-107 | Tải file Excel/Delivery Note/PO — happy path | Đơn lẻ | staff | DEMO-JOB-DONE có đủ 3 file | 1. GET `?kind=excel` 2. GET `?kind=delivery_note` 3. GET `?kind=po&po={po_number}` | 200 cả 3, tải đúng file | P1 | API |
| TC-GIAOHANG-108 | Tải file kind không hợp lệ → 400 | Negative | staff | — | 1. GET `?kind=abc` | 400 | P2 | API |
| TC-GIAOHANG-109 | Tải file kind=po thiếu query po → 400 | Negative | staff | — | 1. GET `?kind=po` (không kèm po) | 400 | P2 | API |
| TC-GIAOHANG-110 | Tải file job/file không tồn tại → 404 | Negative | staff | — | 1. GET job_id giả 2. GET job thật nhưng file chưa sinh | 404 cả 2 | P2 | API |
| TC-GIAOHANG-111 | Tải file — path traversal bị chặn → 403 | Negative | staff | — | 1. Giả lập file path chứa `../../` ra ngoài `/data/onedrive-staging/Puplic/BQMS/Giao hàng` | 403 | P1 | API |
| TC-GIAOHANG-112 | Tải toàn bộ thư mục .zip | Đơn lẻ | staff | DEMO-JOB-DONE | 1. Click "Tải tất cả (zip)" | 200, file .zip chứa Excel+PDF+ảnh | P1 | API+UI |
| TC-GIAOHANG-113 | Tải zip khi chưa có output_folder → 404 | Negative | staff | Job chưa done | 1. GET `/dossier-job/{id}/folder.zip` | 404 | P2 | API |
| TC-GIAOHANG-114 | Update-regenerate — happy path, job đã done | Đơn lẻ | staff | DEMO-JOB-DONE | 1. Mở wizard edit job DEMO-JOB-DONE 2. Sửa 1 field (VD ghi chú) 3. Click "Cập nhật hồ sơ" | 200, job build lại **chỉ file Excel**, **không** enqueue lại scraper Samsung (assert không có popup Create Delivery chạy lại, output_folder giữ nguyên trừ Excel) | P1 | API |
| TC-GIAOHANG-115 | Update-regenerate khi job chưa done → 409 | Negative | staff | DEMO-JOB-QUEUED-1 | 1. POST `/dossier-job/{id}/update-regenerate` | 409 | P1 | API |
| TC-GIAOHANG-116 | Update-regenerate job không tồn tại → 404 | Negative | staff | — | 1. POST job_id giả | 404 | P2 | API |
| TC-GIAOHANG-117 | Update-regenerate defer thất bại → 500 | Edge | staff | Giả lập worker lỗi | 1. POST update-regenerate trong điều kiện lỗi | 500 | P3 | API |
| TC-GIAOHANG-118 | Watchdog phát hiện job stuck | Đơn lẻ | admin | DEMO-JOB-RUNNING-STALE (heartbeat cũ) | 1. Trigger task `bqms_dossier_watchdog` (staging) | Job được đánh dấu cảnh báo/stuck theo logic watchdog, không tự "done" giả | P2 | API |
| TC-GIAOHANG-119 | Trang Danh bạ (Contacts) — happy path | Đơn lẻ | staff | Có ≥1 contact | 1. GET `/bqms/contacts` | 200, trả danh sách contact | P3 | API |
| TC-GIAOHANG-120 | Danh bạ search theo q | Đơn lẻ | staff | — | 1. GET `/bqms/contacts?q=<tên contact>` | 200, lọc đúng | P3 | API |
| TC-GIAOHANG-121 | Danh bạ bởi role ngoài staff/manager/admin → 403 | Permission | viewer | — | 1. GET `/bqms/contacts` với token viewer | 403 | P2 | API |
| TC-GIAOHANG-122 | **[LUỒNG] Chọn từ Giao hàng → Tạo hồ sơ → Huỷ an toàn** [SEMI-UI] | Luồng | staff | DEMO-SEV-ITEMS 2 dòng | 1. Vào `/bqms/deliveries`, tick 2 dòng 2. Click nút tạo hồ sơ → wizard mở, prefill đúng 3. Điền đủ 6 tab, upload ảnh Cam kết 4. Click "Tạo hồ sơ" (submit) → job `queued` 5. Poll tới `awaiting_confirm` 6. Click "Huỷ" | Job kết thúc ở trạng thái huỷ, KHÔNG tạo Delivery thật; toàn bộ log job có đủ dấu vết queued→running→awaiting_confirm→cancelled | P1 | API+UI |
| TC-GIAOHANG-123 | **[LUỒNG] Sửa hồ sơ đã hoàn tất (update-regenerate)** | Luồng | staff | DEMO-JOB-DONE | 1. "Mở lại hồ sơ" → tìm DEMO-JOB-DONE 2. Click "Sửa" → wizard Edit mode hydrate 3. Sửa 1 field 4. Submit "Cập nhật hồ sơ" | Chỉ Excel được build lại, PDF Delivery Note/PO cũ giữ nguyên, KHÔNG có request nào chạm scraper Samsung | P1 | API+UI |
| TC-GIAOHANG-124 | **[LUỒNG] Giao hàng lặp lại cùng PO (lần N)** | Luồng | staff | DEMO-PO-3DOT (đã có hồ sơ lần 1) | 1. Chọn dòng giao lần 2 2. Prefill → thấy "lần 2 của PO này" + đề nghị "Dùng lại" header 3. Click "Dùng lại" 4. Submit tới `queued` [AUTO-API dừng lại] | Header copy đúng từ lần 1, shipping_no/output_folder tách riêng cho lần 2, không trộn dữ liệu 2 lần giao | P1 | API+UI |
| TC-GIAOHANG-125 | **[LUỒNG] Tra cứu nhanh không qua bảng** | Luồng | staff | DEMO-PO-3DOT + 1 mã lạ | 1. Click "Tra cứu hàng loạt" 2. Dán 4 mã (3 thật + 1 lạ) 3. Xem kết quả 4. Copy | found_codes=3, missing_codes=1, copy hoạt động; tương tự multi-select Origin Summary cho luồng còn lại | P2 | API+UI |
| TC-GIAOHANG-126 | 2 user cùng bấm tạo dossier cho cùng nhóm delivery_ids | Kết hợp | staff, manager | Cùng 2 dòng delivery | 1. staff và manager cùng POST create-dossier với cùng delivery_ids (gần như đồng thời, asyncio.gather) | 2 job tách biệt được tạo, invoice counter KHÔNG trùng (mỗi job vendor_invoice_no khác nhau) | P1 | API |
| TC-GIAOHANG-127 | Wizard F5 giữa chừng — mất dữ liệu chưa submit, job đã enqueue thì KHÔNG mất (đọc code xác nhận) | Đơn lẻ | staff | Đang điền wizard Create mode | 1a. Điền 3/6 tab, CHƯA bấm "Tạo hồ sơ" (submit) → F5 reload trang. 1b. (nhánh khác) Đã bấm submit (job `queued`) → F5 NGAY khi job đang chạy nền | Kỳ vọng xác định (đọc `new-dossier/page.tsx` + `wizard-steps.tsx` toàn thư mục — chỉ có state qua `useState` thuần, KHÔNG có `localStorage`/`sessionStorage` nào lưu `form_data`; hit `localStorage` duy nhất trong thư mục là `access_token` phục vụ auth ảnh, không liên quan form): **Nhánh 1a — F5 TRƯỚC submit**: MẤT TOÀN BỘ dữ liệu đã nhập ở bước ≥3 (header, item edits, ảnh đã upload — vốn là `File` object RAM, không thể phục hồi qua reload); component remount rỗng, chỉ prefill lại dữ liệu GỐC từ `?ids=` (không phải dữ liệu user đã sửa) — PASS nếu đúng hành vi mất dữ liệu này (đây là hành vi THỰC TẾ đã xác nhận qua code, không phải nghi ngờ; ghi nhận là gap UX thiếu draft-autosave, KHÔNG phải bug vì code không lỗi — Thang quyết định có làm đợt sau không). **Nhánh 1b — F5 SAU submit**: job vẫn tiếp tục chạy ở `sc-worker` (Procrastinate, `bqms.py:4747-4755` defer task độc lập hoàn toàn với tab/kết nối FE) — job KHÔNG bị huỷ; NHƯNG `jobId` chỉ lưu trong React state (không ghi vào URL `?job=`) nên F5 khiến FE MẤT khả năng tự động poll lại đúng job đó qua trang wizard — phải vào "Mở lại hồ sơ" (DossierJobsModal, xem TC-GIAOHANG-054/057) để tìm lại job theo danh sách và resume theo dõi. | P2 | UI |
| TC-GIAOHANG-128 | Countdown checkpoint vẫn đếm đúng sau F5 | Edge | staff | DEMO-JOB-AWAITING đang đếm ngược | 1. F5 reload trang wizard đang ở checkpoint | Đồng hồ đếm ngược tính lại theo `confirm_remaining_seconds` từ server (không reset về 300s) | P1 | API+UI |
| TC-GIAOHANG-129 | Mở trang Vận chuyển /shipments | Đơn lẻ | staff | — | 1. Vào `/shipments` | Kanban 4 cột: Chờ xuất/Đang vận chuyển/Đã đến cảng/Đã nhận; nút toggle Table view | P2 | UI |
| TC-GIAOHANG-130 | Empty state "Chưa có lô hàng nào" | Đơn lẻ | staff | Không có shipment nào (môi trường sạch) | 1. Vào `/shipments` | Hiện empty state đúng thông điệp | P3 | UI |
| TC-GIAOHANG-131 | Loading state 4 skeleton card | Đơn lẻ | staff | Throttle mạng chậm | 1. Vào `/shipments` lúc đang tải | 4 skeleton card hiện trước khi data về | P3 | UI |
| TC-GIAOHANG-132 | GET /api/v1/shipments filter + sort ETA | Đơn lẻ | staff | DEMO-SHIP-PENDING, DEMO-SHIP-INTRANSIT | 1. GET `?status=in_transit` 2. GET `?po_id=...` 3. GET `?supplier_id=...` | 200, lọc đúng, sort theo ETA | P2 | API |
| TC-GIAOHANG-133 | Kanban card cảnh báo overdue | Đơn lẻ | staff | 1 shipment ETA quá hạn, status != received | 1. Vào `/shipments` xem card đó | Viền đỏ + icon cảnh báo | P2 | UI |
| TC-GIAOHANG-134 | POST /api/v1/shipments — tạo lô hàng từ PO [AUTO-API] | Đơn lẻ | staff | DEMO-PO-FOR-SHIP | 1. POST `/api/v1/shipments` body po_id + items | 201, insert shipments+shipment_items+revenue_chain link+domain_event | P1 | API |
| TC-GIAOHANG-135 | POST shipments items rỗng → 400 | Negative | staff | — | 1. POST body items=[] | 400 | P2 | API |
| TC-GIAOHANG-136 | POST shipments po_id không tồn tại → 404 | Negative | staff | — | 1. POST po_id=999999999 | 404 | P2 | API |
| TC-GIAOHANG-137 | **[BUG-GATE] Nút "Tạo lô hàng" → /shipments/new không tồn tại** | Negative (BUG-GATE) | staff | — | 1. Vào `/shipments` 2. Click nút "Tạo lô hàng" | **Kỳ vọng hiện tại = FAIL/404** — không có `frontend/src/app/(dashboard)/shipments/new/page.tsx`. Ca này PASS nghĩa là bug đã fix; không tính vào coverage cho tới khi fix. Cần hỏi Thang: module Shipments có đang dùng thật không trước khi build form. | P1 | UI |
| TC-GIAOHANG-138 | Mở trang chi tiết lô hàng /shipments/[id] | Đơn lẻ | staff | DEMO-SHIP-INTRANSIT | 1. Vào `/shipments/{id}` | Stepper 5 bước + info card + bảng items hiện đúng | P2 | UI |
| TC-GIAOHANG-139 | GET /api/v1/shipments/{id} chi tiết + timeline | Đơn lẻ | staff | DEMO-SHIP-INTRANSIT | 1. GET `/api/v1/shipments/{id}` | 200, có items + timeline domain_events | P2 | API |
| TC-GIAOHANG-140 | GET shipment không tồn tại → 404 + error state | Negative | staff | — | 1. Vào `/shipments/999999999` | UI: "Không tìm thấy lô hàng" + link Quay lại; API: 404 | P2 | API+UI |
| TC-GIAOHANG-141 | **[BUG-GATE] Nút hành động trang chi tiết gọi endpoint không tồn tại** | Negative (BUG-GATE) | staff | DEMO-SHIP-PENDING | 1. Vào `/shipments/{id}` (status=pending) 2. Click nút hành động ("Cập nhật xuất phát") | **Kỳ vọng hiện tại = FAIL/404** — FE gọi `POST /api/v1/shipments/{id}/status` nhưng BE chỉ có `/depart`,`/arrive`,`/receive` với schema khác. PASS nghĩa là FE đã sửa gọi đúng endpoint. Không viết regression cho nút này cho tới khi fix. | P1 | UI |
| TC-GIAOHANG-142 | POST /shipments/{id}/depart — happy path [AUTO-API] | Đơn lẻ | staff | DEMO-SHIP-PENDING (status=pending) | 1. POST `/depart` body `{atd: "<ngày giờ>"}` | 200, status→`in_transit`, domain_event `shipment.departed` insert | P1 | API |
| TC-GIAOHANG-143 | POST /depart khi status != pending → 400 | Negative | staff | DEMO-SHIP-INTRANSIT (đã in_transit) | 1. POST `/depart` | 400 | P1 | API |
| TC-GIAOHANG-144 | POST /depart thiếu atd → 400 | Negative | staff | — | 1. POST `/depart` body rỗng | 400 (atd bắt buộc) | P2 | API |
| TC-GIAOHANG-145 | POST /arrive — happy path | Đơn lẻ | staff | DEMO-SHIP-INTRANSIT | 1. POST `/arrive` body `{ata: "<ngày giờ>"}` | 200, status→`arrived_port` | P1 | API |
| TC-GIAOHANG-146 | POST /arrive khi status != in_transit → 400 | Negative | staff | DEMO-SHIP-PENDING | 1. POST `/arrive` | 400 | P1 | API |
| TC-GIAOHANG-147 | POST /receive — happy path, cập nhật kho | Đơn lẻ | staff | DEMO-SHIP-ARRIVED | 1. POST `/receive` body `received_items=[{shipment_item_id, qty,...}]` | 200, insert inventory_movements + upsert inventory (nếu có product_id), PO status→`received`, revenue_chain stage→`invoice` | P1 | API |
| TC-GIAOHANG-148 | POST /receive status không hợp lệ → 400 | Negative | staff | DEMO-SHIP-RECEIVED (đã received) | 1. POST `/receive` lần 2 | 400 (chỉ nhận arrived_port/customs_clearance/in_transit) | P1 | API |
| TC-GIAOHANG-149 | POST /receive received_items rỗng → 400 | Negative | staff | DEMO-SHIP-ARRIVED | 1. POST body received_items=[] | 400 | P2 | API |
| TC-GIAOHANG-150 | POST /receive shipment_item_id không thuộc shipment → 404 | Negative | staff | DEMO-SHIP-ARRIVED | 1. POST với shipment_item_id của lô khác | 404 | P2 | API |
| TC-GIAOHANG-151 | PUT /shipments/{id} cập nhật tracking info | Đơn lẻ | staff | DEMO-SHIP-INTRANSIT | 1. PUT body carrier/tracking_number/BL/container/ETD/ETA/chi phí | 200, cập nhật đúng field | P2 | API |
| TC-GIAOHANG-152 | PUT shipment đã received/cancelled → 400 (chặn sửa) | Negative | staff | DEMO-SHIP-RECEIVED | 1. PUT bất kỳ field | 400 | P1 | API |
| TC-GIAOHANG-153 | PUT body rỗng toàn null → 400 | Negative | staff | DEMO-SHIP-INTRANSIT | 1. PUT toàn field null | 400 | P2 | API |
| TC-GIAOHANG-154 | Badge Đủ/Một phần/Chưa nhận theo qty | Đơn lẻ | staff | DEMO-SHIP-ARRIVED có item nhận 1 phần | 1. Vào `/shipments/{id}` xem bảng items | Badge đúng theo quantity_received vs quantity_shipped | P2 | UI |
| TC-GIAOHANG-155 | **[BUG-GATE] Trạng thái "departed" không bao giờ được set** | Negative (BUG-GATE) | staff | DEMO-SHIP-PENDING | 1. POST `/depart` 2. Kiểm tra DB `status` | **Kỳ vọng hiện tại = FAIL đối chiếu FE**: DB nhảy thẳng `pending`→`in_transit`, không có giá trị `departed` — nhưng FE stepper liệt kê "Xuất phát" là bước riêng và Kanban list không có cột `departed`. Ghi nhận mismatch, không viết ca stepper hiển thị bước "departed" tách biệt cho tới khi FE/BE thống nhất enum. | P2 | API |
| TC-GIAOHANG-156 | Role staff/manager/admin được phép Shipments; role khác (sales) → 403 | Permission | sales | — | 1. GET `/api/v1/shipments` với token sales | 403 | P2 | API |
| TC-GIAOHANG-157 | **[GHI CHÚ PHẠM VI]** Xác nhận Shipments là module riêng (bảng `shipments`/`shipment_items`), KHÔNG liên kết chéo với `bqms_deliveries`/dossier trong code đọc được | Negative (BUG-GATE/scope) | — | Đọc code | 1. Grep chéo `shipments` ↔ `bqms_deliveries` trong backend | Không tìm thấy liên kết trực tiếp — xác nhận với Thang trước khi mở rộng suite Shipments: module đang dùng thật (lô hàng quốc tế Trung Quốc→kho, theo comment `shipment_tracking.py`) hay là WIP/code mồ côi song song BQMS | P1 | Tay |

---

## Map feature → ca (chứng minh phủ 100%)

| Feature | Ca test |
|---|---|
| F-DELIVERY-01 | TC-GIAOHANG-001, 002 |
| F-DELIVERY-02 | TC-GIAOHANG-003..008 |
| F-DELIVERY-03 | TC-GIAOHANG-009, 010 |
| F-DELIVERY-04 | TC-GIAOHANG-005, 006 |
| F-DELIVERY-05 | TC-GIAOHANG-011 |
| F-DELIVERY-06 | TC-GIAOHANG-012 |
| F-DELIVERY-07 | TC-GIAOHANG-013 |
| F-DELIVERY-08 | TC-GIAOHANG-014, 015 |
| F-DELIVERY-09 | TC-GIAOHANG-016, 017 |
| F-DELIVERY-10 | TC-GIAOHANG-018 |
| F-DELIVERY-11 | TC-GIAOHANG-019 |
| F-DELIVERY-12 | TC-GIAOHANG-020, 021, 022 |
| F-DELIVERY-13 | TC-GIAOHANG-023 |
| F-DELIVERY-14 | TC-GIAOHANG-024 |
| F-DELIVERY-15 | TC-GIAOHANG-025 |
| F-DELIVERY-16 | TC-GIAOHANG-025, 026 |
| F-DELIVERY-17 | TC-GIAOHANG-026 |
| F-DELIVERY-18 | TC-GIAOHANG-027 |
| F-DELIVERY-19 | TC-GIAOHANG-028, 029, 030 |
| F-DELIVERY-20 | TC-GIAOHANG-029 |
| F-DELIVERY-21 | TC-GIAOHANG-031, 032 |
| F-DELIVERY-22 | TC-GIAOHANG-033 |
| F-DELIVERY-23 | TC-GIAOHANG-033, 034, 035 |
| F-DELIVERY-24 | TC-GIAOHANG-036 |
| F-DELIVERY-25 | TC-GIAOHANG-037 |
| F-DELIVERY-26 | TC-GIAOHANG-038 |
| F-DELIVERY-27 | TC-GIAOHANG-039 |
| F-DELIVERY-28 | TC-GIAOHANG-040 |
| F-DELIVERY-29 | TC-GIAOHANG-041 |
| F-DELIVERY-30 | TC-GIAOHANG-042 |
| F-DELIVERY-31 | TC-GIAOHANG-043 |
| F-DELIVERY-32 | TC-GIAOHANG-043, 044, 045 |
| F-DELIVERY-33 | TC-GIAOHANG-046 |
| F-DELIVERY-34 | TC-GIAOHANG-047 |
| F-DELIVERY-35 | TC-GIAOHANG-047..052 |
| F-DELIVERY-36 | TC-GIAOHANG-053 |
| F-DELIVERY-37 | TC-GIAOHANG-054 |
| F-DELIVERY-38 | TC-GIAOHANG-054, 055 |
| F-DELIVERY-39 | TC-GIAOHANG-056, 057 |
| F-DELIVERY-40 | TC-GIAOHANG-058, 059, 060 |
| F-DELIVERY-41 | TC-GIAOHANG-061, 062 |
| F-DELIVERY-42 | TC-GIAOHANG-063 |
| F-DELIVERY-43 | TC-GIAOHANG-063, 064 |
| F-DELIVERY-44 | TC-GIAOHANG-065 |
| F-DELIVERY-45 | TC-GIAOHANG-066, 067, 068, 069 |
| F-DELIVERY-46 | TC-GIAOHANG-069, 070 |
| F-DELIVERY-47 | TC-GIAOHANG-071 |
| F-DELIVERY-48 | TC-GIAOHANG-073 |
| F-DELIVERY-49 | TC-GIAOHANG-074 |
| F-DELIVERY-50 | TC-GIAOHANG-075 |
| F-DELIVERY-51 | TC-GIAOHANG-076 |
| F-DELIVERY-52 | TC-GIAOHANG-077..083 |
| F-DELIVERY-53 | TC-GIAOHANG-084, 085, 086 |
| F-DELIVERY-54 | TC-GIAOHANG-087, 088, 089 |
| F-DELIVERY-55 | TC-GIAOHANG-090..094 |
| F-DELIVERY-56 | TC-GIAOHANG-095, 096, 097 |
| F-DELIVERY-57 | TC-GIAOHANG-098, 099 |
| F-DELIVERY-58 | TC-GIAOHANG-100, 101, 102, 105 |
| F-DELIVERY-59 | TC-GIAOHANG-100, 101 |
| F-DELIVERY-60 | TC-GIAOHANG-099, 103, 104, 128 |
| F-DELIVERY-61 | TC-GIAOHANG-106 |
| F-DELIVERY-62 | TC-GIAOHANG-107..111 |
| F-DELIVERY-63 | TC-GIAOHANG-112, 113 |
| F-DELIVERY-64 | TC-GIAOHANG-114..117 |
| F-DELIVERY-65 | TC-GIAOHANG-105, 122 (an toàn qua Cancel; nhánh thật chỉ ở TC-105) |
| F-DELIVERY-66 | TC-GIAOHANG-118 |
| F-DELIVERY-67 | TC-GIAOHANG-119, 120, 121 |
| F-SHIP-01 | TC-GIAOHANG-129 |
| F-SHIP-02 | TC-GIAOHANG-132 |
| F-SHIP-03 | TC-GIAOHANG-130 |
| F-SHIP-04 | TC-GIAOHANG-131 |
| F-SHIP-05 | TC-GIAOHANG-133 |
| F-SHIP-06 | TC-GIAOHANG-137 (BUG-GATE) |
| F-SHIP-07 | TC-GIAOHANG-134, 135, 136 |
| F-SHIP-08 | TC-GIAOHANG-138 |
| F-SHIP-09 | TC-GIAOHANG-139, 140 |
| F-SHIP-10 | TC-GIAOHANG-141 (BUG-GATE) |
| F-SHIP-11 | TC-GIAOHANG-141 (BUG-GATE) |
| F-SHIP-12 | TC-GIAOHANG-142, 143, 144 |
| F-SHIP-13 | TC-GIAOHANG-145, 146 |
| F-SHIP-14 | TC-GIAOHANG-147..150 |
| F-SHIP-15 | TC-GIAOHANG-151, 152, 153 |
| F-SHIP-16 | TC-GIAOHANG-154 |
| F-SHIP-17 | TC-GIAOHANG-140 |
| F-SHIP-18 | TC-GIAOHANG-155 (BUG-GATE) |

**Luồng (flows) → ca:**
| Luồng | Ca |
|---|---|
| Chọn từ Giao hàng → Tạo hồ sơ (an toàn tới Cancel) | TC-GIAOHANG-122 |
| Sửa hồ sơ đã hoàn tất (update-regenerate) | TC-GIAOHANG-123 |
| Giao hàng lặp lại cùng PO (lần N, "Dùng lại" header) | TC-GIAOHANG-124, 076 |
| Tra cứu nhanh không qua bảng | TC-GIAOHANG-125 |
| Vận chuyển quốc tế (Shipments) — luồng bị gãy do bug | TC-GIAOHANG-134, 142, 145, 147 + BUG-GATE 137/141/155 |

**Tổng số ca: 157** (TC-GIAOHANG-001 → TC-GIAOHANG-157), phủ đủ 85/85 feature (67 F-DELIVERY + 18 F-SHIP), 3 BUG-GATE (F-SHIP-06/11/18), 1 ca [MANUAL ⚠️ KHÔNG HOÀN TÁC] (TC-GIAOHANG-105), còn lại [AUTO-API]/[SEMI-UI] an toàn cho CI/tay.

Phân bổ độ ưu tiên: P1 = 62 ca (chặn/luồng chính/bảo mật/BUG-GATE), P2 = 68 ca, P3 = 27 ca.
Phân bổ tự động hoá: API = 96 ca, UI/API+UI = 55 ca, Tay = 6 ca (bao gồm 1 ca MANUAL-SAMSUNG + 2 ghi chú phạm vi/gap UX).
