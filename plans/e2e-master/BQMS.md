# Test case E2E — BQMS — Báo giá Samsung

Phạm vi: `bidding.songchau.com/bqms/*` (trang chính, quotation, classify, mro, won-quotations, deliveries, folder, emails) +
backend `backend/app/api/v1/bqms.py`, `quotation_templates.py`, `smart_classify.py`, `bqms_images.py`, `price_lookup.py`.
KHÔNG trùng với `backend/tests/e2e/test_bqms_quotation_e2e.py` (10 test happy-path wizard TM/GC core đã có sẵn — không viết lại,
chỉ viết case bổ sung/negative/role/regression cho đúng luồng đó khi cần, có ghi chú "bổ sung cho suite có sẵn").

## Dữ liệu chuẩn bị chung

**Tài khoản test cố định** (theo GÓI DỮ LIỆU MỒI chung, dùng lại không tạo mới):
`test_admin@songchau.test`, `test_manager@songchau.test`, `test_staff@songchau.test`, `test_sales@songchau.test`,
`test_procurement@songchau.test`, `test_warehouse@songchau.test`, `test_accountant@songchau.test`, `test_viewer@songchau.test`,
`test_director@songchau.test` + 2 vendor account (2 NCC demo khác nhau, bắt IDOR chéo NCC) + 1 vendor CHƯA được mời batch nào.
Vai trò cho phép đọc `/rfq-table` (bqms.py:658): 7 role (admin/manager/staff/sales/procurement/warehouse/accountant) + viewer
đọc riêng (read-only, subset filter). scraper-settings/reset-data/reextract-images: **admin-only**. scrape-control/data-gaps:
**admin/manager**.

**Bản ghi mồi BQMS** (seed 1 lần, prefix `DEMO-BQMS-`, dọn bằng glob prefix ở teardown):
- Tái dùng `DEMO-MIX-01` (5 mã BQMS đã LIVE) làm xương sống.
- 1 mã BQMS có **twin etl + onedrive_sync trùng (rfq_number, bqms_code)** — bắt lỗi đếm đôi ở `/rfq-table`, `/kpi`, vendor-staging JOIN
  (memory: BQMS RFQ Dup Rows, 116 cặp trùng thật trong prod).
- 1 mã BQMS có `SUBMIT_GIVEUP='Y'` (item bị bỏ/abandon) — mồi regression price=0 khi push.
- 1 RFQ đã từng `result='closed'` ở vòng 1 rồi được Samsung mở lại vòng 2 với deadline mới còn hạn — mồi regression reopen (fix 24/06).
- 1 mã BQMS có đủ 5 lớp ảnh (primary-pin / override-RFQ / override-code / bqms_image_index / FS scan) để test resolve priority.
- 1 folder RFQ thật trên staging có `L1` + `L1.archived_<ts>` sẵn (mồi regression "mất File Lần 1" khi regenerate cùng round).
- 1 RFQ có N=3 items (3 dòng `bqms_rfq` cùng `rfq_number`) — mồi dedupe push theo rfq_number chứ không theo item id.
- 8 mã BQMS đủ điều kiện push (giá>0, có ảnh, có file) cho ca biên batch =8; thêm 1 mã thứ 9 cho ca =9 → 400.
- 1 mã thiếu giá/ảnh/file cố ý — mồi "batch skip kèm lý do, không hỏng cả mẻ".
- 1 template Excel mặc định TM + 1 GC đã upload sẵn ở `/bqms/quotation/templates`.
- `app_config.bqms_edit_enabled` mặc định ON trong môi trường test — có khối riêng bật/tắt và **teardown phải trả về ON**.

**Ranh giới an toàn — TUYỆT ĐỐI KHÔNG đụng Samsung thật trừ khi ghi rõ [MANUAL-SAMSUNG ⚠️]:**
- Mọi ca liên quan `POST /rfq/{id}/push-to-sec`, `/push-to-sec/batch`, `POST /sync`, `POST /scrape-*` chạy ở lớp
  **[AUTO-API]** chỉ tới ranh giới **defer job** — assert bản ghi job/queue tạo đúng (status=`queued`, payload đúng), **KHÔNG chờ
  worker Procrastinate thật sự điều khiển trình duyệt vào Samsung** (worker trỏ mock hoặc tắt hẳn ở môi trường test).
- Lớp **[SEMI-UI]**: thao tác tay/Playwright tới điểm dừng an toàn — mở `PushToSecModal` xem preview, KHÔNG bấm nút "Đẩy báo giá lên SEC" cuối cùng; hoặc bấm rồi **Hủy** ở bước xác nhận.
- Lớp **[MANUAL-SAMSUNG ⚠️KHÔNG-HOÀN-TÁC]**: chỉ Thang chạy có giám sát, ngoài giờ làm việc SEC, tối đa 1 RFQ hy sinh định trước
  (không phải RFQ khách thật đang chờ), có checklist chụp màn hình từng bước. CI/agent không bao giờ được chạy các ca này.
- Rate-limit (5/phút push đơn, 3/phút batch): gom vào **Khối R** cuối bảng, chạy tách biệt có `sleep 60s` reset giữa các khối, không xen giữa các ca khác.
- Ca chạm prod dùng **rollback-txn** (mở transaction gọi thẳng hàm, rollback cuối) hoặc dữ liệu prefix `DEMO-BQMS-` dọn theo glob.

---

## Bảng test case

Cột: **Mã** | **Tên** | **Loại** | **Vai trò** | **Chuẩn bị** | **Các bước** | **Kỳ vọng** | **Ưu tiên** | **Tự động hoá**

### Nhóm A — F1 Sync & Scrape (F-BQMS-01, 80-89)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-001 | Khởi động job đồng bộ Samsung BQMS thành công | Đơn lẻ | admin | Không có job sync nào đang chạy (GET `/bqms/sync/latest` status != running) | 1) Mở `/bqms`. 2) Bấm nút "Đồng bộ Samsung" (kích hoạt `POST /bqms/sync`). | Toast "Đã bắt đầu đồng bộ"; `job_id` trả về; `GET /bqms/sync/status/{job_id}` trả `status=running` rồi chuyển `queued/running` hợp lệ | P1 | API |
| TC-BQMS-002 | Sync khi đang có job khác chạy → 400 | Negative | admin | 1 job sync đang `status=running` (seed thủ công bảng job) | Gọi `POST /bqms/sync` lần 2 khi job cũ chưa xong | HTTP 400, message nêu rõ job đang chạy, không tạo job thứ 2 | P1 | API |
| TC-BQMS-003 | Poll trạng thái job qua toàn bộ vòng đời | Đơn lẻ | admin | Job vừa tạo ở TC-001 | Poll `GET /bqms/sync/status/{job_id}` mỗi 2s tới khi `status` không còn `queued/running` | Chuỗi trạng thái hợp lệ (queued→running→success/failed), có `progress`/`steps` tăng dần, không kẹt vô hạn | P2 | API |
| TC-BQMS-004 | Xem lịch sử đồng bộ + bước chi tiết | Đơn lẻ | manager | Có ≥1 job sync đã hoàn tất trong lịch sử | 1) Mở `/bqms`, xem widget "Lịch sử đồng bộ". 2) Gọi `GET /bqms/sync/history`, `GET /bqms/sync/steps` | Danh sách job có thời gian, kết quả; steps hiển thị đúng thứ tự các bước cào (login→list RFQ→detail→...) | P2 | API |
| TC-BQMS-005 | Circuit breaker mở sau chuỗi lỗi đăng nhập Samsung | Regression | admin | Seed circuit breaker file `failures` vượt ngưỡng (mô phỏng lỗi liên tiếp) | 1) `GET /bqms/sync/circuit` xem `open=true`. 2) Gọi `POST /bqms/sync` khi breaker mở | `GET /sync/circuit` trả `open:true`, `last_error`; `POST /sync` bị chặn/báo lỗi rõ ràng, KHÔNG thử login Samsung thêm (bảo vệ tài khoản khỏi khóa) | P1 | API |
| TC-BQMS-006 | Reset circuit breaker rồi sync lại bình thường | Regression | admin | Circuit đang mở (nối tiếp TC-005) | 1) Bấm "Reset circuit breaker" (`POST /sync/circuit/reset`). 2) `GET /sync/circuit` xác nhận `open=false`. 3) `POST /sync` chạy lại được | Breaker reset về đóng; sync mới chạy bình thường, không bị chặn | P2 | API |
| TC-BQMS-007 | Reset circuit breaker bởi role không phải admin → 403 | Negative | manager | Circuit đang mở | Gọi `POST /sync/circuit/reset` bằng token manager | HTTP 403 | P2 | API |
| TC-BQMS-008 | Cài đặt Scraper — xem/sửa flags bởi admin | Đơn lẻ | admin | — | 1) Mở `/bqms` → "Cài đặt Scraper" (ScraperSettingsCard). 2) `GET /scraper-settings`. 3) Tắt 1 flag qua `PUT /flags`. 4) Bật lại, teardown về nguyên trạng | Flag đổi đúng giá trị trả về; UI phản ánh trạng thái mới ngay | P1 | API+UI |
| TC-BQMS-009 | Scraper settings bởi manager → 403 (admin-only) | Negative | manager | — | Gọi `GET /scraper-settings`, `PUT /flags`, `PUT /credentials`, `POST /test-login` bằng token manager | Cả 4 endpoint HTTP 403 | P1 | API |
| TC-BQMS-010 | Test-login Samsung xác thực credentials | Đơn lẻ [SEMI-UI] | admin | Credentials Samsung hợp lệ đã cấu hình | Bấm "Test đăng nhập" trên ScraperSettingsCard (`POST /test-login`) | Trả kết quả PASS trong ≤24h — đây là điều kiện interlock để được phép bật lại scraper flag (memory: BQMS Scrapers Paused) | P1 | API |
| TC-BQMS-011 | Bật/tắt scrape thủ công (scrape-control) | Đơn lẻ | manager | — | 1) `GET /scrape-control/status`. 2) Bấm toggle "Chế độ scrape thủ công" (`POST /toggle`) | Trạng thái đổi đúng, UI hiện badge "Thủ công" | P2 | API+UI |
| TC-BQMS-012 | scrape-control toggle bởi staff → 403 | Negative | staff | — | `POST /scrape-control/toggle` bằng token staff | HTTP 403 | P2 | API |
| TC-BQMS-013 | Data gaps — xem mã thiếu dữ liệu + KPI (Đủ items/Thiếu/Tổng pending/Chưa drill/Drill rỗng) | Đơn lẻ | manager | Có ≥1 mã BQMS chưa scrape hết items | Mở `/bqms` → tab "Data gaps" (`GET /data-gaps`) | 5 KPI hiển thị đúng số liệu, không tính trùng do twin etl/onedrive | P2 | API+UI |
| TC-BQMS-014 | Toggle code-track / smart-rescan cho 1 mã | Đơn lẻ | manager | 1 mã trong data-gaps | Bấm toggle "Theo dõi mã" (`POST /toggle-code-track`) và "Auto rescan" (`POST /toggle-smart-rescan`) | Cờ đổi đúng theo mã, ghi vào `healing-log` | P2 | API |
| TC-BQMS-015 | Quét bù ngay (force rescan qua data-gaps) | Đơn lẻ [AUTO-API] | manager | 1 mã pending trong data-gaps | Bấm "Quét bù ngay" (`POST /rescan`, force=true) | Job rescan tạo đúng cho mã đó; `GET /healing-log` ghi nhận lượt quét | P2 | API |
| TC-BQMS-016 | Scrape thủ công theo loại (contracts/mro-po/bidding/announcement/selection-result) | Đơn lẻ [AUTO-API] | admin | — | Gọi lần lượt `POST /scrape-contracts`, `/scrape-mro-po`, `/scrape-bidding`, `/scrape-announcement`, `/scrape-selection-result` | Mỗi endpoint tạo job riêng, trả `job_id`, không đụng nhau (không giữ chung 1 session lock gây deadlock) | P2 | API |
| TC-BQMS-017 | Kết quả chọn NCC từ scraper (selection-result) | Đơn lẻ [AUTO-API] | manager | — | `POST /scrape-trigger/selection-result` | Job tạo đúng, dữ liệu selection-result ghi vào bảng liên quan sau khi worker chạy (assert ở mock) | P3 | API |
| TC-BQMS-018 | Reset toàn bộ data — confirm đúng case-sensitive | Negative | admin | — | Gọi `POST /admin/reset-data` với `confirm='reset'` (thường), rồi `confirm='RESET '` (thừa space) | Cả 2 lần đều HTTP 400, KHÔNG xoá dữ liệu | P1 | API |
| TC-BQMS-019 | Reset toàn bộ data bởi non-admin → 403 | Negative | manager | — | `POST /admin/reset-data` confirm='RESET' bằng token manager | HTTP 403 | P1 | API |
| TC-BQMS-020 | Re-extract ảnh hàng loạt (admin) | Đơn lẻ [AUTO-API] | admin | ≥2 mã có ảnh cần re-extract | `POST /admin/reextract-images` | Job tạo đúng; non-admin gọi cùng endpoint → 403 (ca phụ) | P3 | API |
| TC-BQMS-021 | Hoạt động gần đây (activity feed) — có dữ liệu | Đơn lẻ | staff | Có thao tác gần đây (VD: vừa sửa giá 1 dòng) | Mở `/bqms`, xem widget "Hoạt động gần đây" (`GET /activity/recent`) | Liệt kê đúng hành động, người thực hiện, thời gian, mới nhất trên đầu | P3 | UI |
| TC-BQMS-022 | Hoạt động gần đây — empty state | Trạng thái | staff | Môi trường sạch không có activity (test riêng) | Mở widget hoạt động khi rỗng | Hiện thông báo trống rõ ràng, không lỗi trắng trang | P3 | UI |

### Nhóm B — Trang chính, Filter, KPI (F-BQMS-02..22)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-023 | Mở trang BQMS — KPI Cards hiển thị đúng số liệu, không đếm đôi twin | Luồng | staff | Mã BQMS có twin etl+onedrive_sync | 1) Đăng nhập, mở `/bqms`. 2) Đối chiếu KPI Card "Tổng RFQ" với `SELECT COUNT DISTINCT (rfq_number,bqms_code)` dedup CTE | Số liệu KPI = số dedup, KHÔNG cộng gấp đôi mã có twin | P1 | API+UI |
| TC-BQMS-024 | Filter Năm/Tháng lọc đúng bảng | Đơn lẻ | staff | Có RFQ nhiều tháng khác nhau | Chọn Năm=2026, Tháng=06 trên filter | Bảng chỉ hiện RFQ tháng 06/2026; URL/query param đồng bộ | P2 | UI |
| TC-BQMS-025 | Filter Kết quả — đủ option cho staff | Đơn lẻ | staff | — | Mở dropdown "Kết quả" | Có đủ: Đang theo dõi/Chưa báo giá/Trúng/Trượt/Closed/Skip/Tất cả | P2 | UI |
| TC-BQMS-026 | Filter Kết quả — viewer bị ẩn option Trúng/Trượt/Closed/Skip | Negative/Permission | viewer | — | Đăng nhập viewer, mở dropdown "Kết quả" | Chỉ thấy subset (Đang theo dõi/Chưa báo giá/Tất cả); các option Trúng/Trượt/Closed/Skip KHÔNG hiển thị (`hideForViewer`) | P1 | UI |
| TC-BQMS-027 | Filter Nguồn (Vendor Portal/Excel cũ/OneDrive sync/Nhập tay) | Đơn lẻ | staff | Có RFQ đủ 4 nguồn | Chọn từng nguồn, xác nhận bảng lọc đúng theo cột `source` | Kết quả đúng nguồn đã chọn | P3 | UI |
| TC-BQMS-028 | Filter Vòng V1..V4 | Đơn lẻ | staff | RFQ có/không có V2 | Chọn "Đã có V2" | Chỉ hiện RFQ có `quoted_price_bqms_v2` không null | P3 | UI |
| TC-BQMS-029 | Filter Loại hàng TM/GC | Đơn lẻ | staff | Mã TM và GC trộn | Chọn "TM" | Chỉ hiện RFQ `classification='TM'` | P2 | UI |
| TC-BQMS-030 | Tìm kiếm mã BQMS/RFQ qua search box | Đơn lẻ | staff | Mã DEMO-MIX-01 đã seed | Gõ mã vào ô tìm kiếm | Bảng lọc đúng còn lại đúng mã gõ (debounce, không lag) | P2 | UI |
| TC-BQMS-031 | Ctrl+K global palette đồng bộ search khi filter tháng khác đang bật | Edge case | staff | Filter tháng=05 đang bật, mã cần tìm ở tháng=06 | 1) Mở filter tháng=05. 2) Bấm Ctrl+K, gõ mã ở tháng 06, chọn kết quả | Điều hướng đúng tới mã đó (tự nới/bỏ filter tháng nếu cần), KHÔNG báo "không tìm thấy" sai | P2 | UI |
| TC-BQMS-032 | Xóa bộ lọc — chip "Đang lọc" biến mất | Đơn lẻ | staff | Đang bật ≥2 filter | Bấm "Xóa bộ lọc" | Toàn bộ filter về mặc định, chip "Đang lọc" biến mất, bảng hiện lại đầy đủ | P3 | UI |
| TC-BQMS-033 | Bảng RFQ chính — phân trang GET /rfq-table | Đơn lẻ | procurement | ≥50 RFQ trong DB | Cuộn/bấm trang 2 | Trả đúng offset/limit, không lặp/thiếu dòng giữa 2 trang | P2 | API |
| TC-BQMS-034 | Bảng RFQ chính — 7 role đọc được, role thứ 8 không có trong danh sách bị 403 | Ma trận role | 7 role hợp lệ + 1 role lạ | — | Gọi `GET /rfq-table` bằng từng token | 7 role → 200; role không thuộc danh sách allow (nếu có) → 403 | P1 | API |
| TC-BQMS-035 | Table skeleton loading state | Trạng thái | staff | Mạng chậm (throttle) | Mở `/bqms`, quan sát lúc đang tải | Hiện `TableSkeleton`, không hiện bảng trống/lỗi trong lúc chờ | P3 | UI |
| TC-BQMS-036 | Empty state "Không có dữ liệu phù hợp" | Trạng thái | staff | Filter ra kết quả rỗng (VD tháng không có RFQ) | Chọn filter chắc chắn rỗng | Hiện đúng message empty-state, có gợi ý "Xóa bộ lọc" | P3 | UI |
| TC-BQMS-037 | Error state "Không thể tải dữ liệu" | Trạng thái | staff | Mô phỏng API `/rfq-table` trả 500 | Mở `/bqms` khi API lỗi | Hiện error state rõ ràng + nút Thử lại, không crash trắng trang | P3 | UI |
| TC-BQMS-038 | Mở Row detail panel/drawer | Đơn lẻ | staff | 1 RFQ bất kỳ | Click vào 1 dòng | `RowDetailPanel`/`DetailDrawer` mở đúng đủ thông tin dòng đó | P2 | UI |
| TC-BQMS-039 | Sửa giá inline (PriceCell) — số hợp lệ | Đơn lẻ | staff | 1 RFQ chưa có giá | Click ô giá, nhập `150000`, Enter | `PATCH /rfq/{id}/price` thành công, giá cập nhật ngay trên UI (optimistic) | P1 | API+UI |
| TC-BQMS-040 | Sửa giá inline — định dạng số lạ | Edge case | staff | 1 RFQ | Nhập lần lượt: `1.000,5` / `1000.5` / `-500` / `0` | `1.000,5` và `1000.5` phải cho CÙNG kết quả đã chuẩn hoá (hoặc 1 trong 2 bị từ chối rõ ràng); số âm → từ chối/400; `0` được chấp nhận có cảnh báo riêng (không lẫn với "chưa nhập") | P1 | API |
| TC-BQMS-041 | Sửa giá inline bởi viewer → 403 | Negative/Permission | viewer | 1 RFQ | Viewer thử click sửa ô giá | UI không cho sửa (readonly) hoặc API `PATCH /price` trả 403 nếu gọi trực tiếp | P1 | API+UI |
| TC-BQMS-042 | 2 tab cùng sửa PriceCell 1 dòng — concurrency | Edge case | staff | 1 RFQ mở 2 tab cùng account | Tab A nhập giá 100, Tab B nhập giá 200 gần như đồng thời, cả 2 Enter | Xác nhận hành vi thực tế (last-write-wins theo timestamp response cuối); giá trị cuối trong DB khớp với request tới sau; KHÔNG mất update hoàn toàn (không về giá rỗng) | P2 | API |
| TC-BQMS-043 | Sửa phân loại TM/GC inline — giá trị hợp lệ | Đơn lẻ | staff | 1 RFQ | Chọn "TM" trong ClassificationCell | `PATCH /rfq/{id}/classification` value="TM" → 200, cell cập nhật | P1 | API |
| TC-BQMS-044 | Sửa phân loại — giá trị không hợp lệ → 400 | Negative | staff | 1 RFQ | Gọi trực tiếp `PATCH /classification` với `"tm"` (thường) rồi `"XX"` | Cả 2 → HTTP 400 (chỉ nhận `'TM'`/`'GC'`/`null`) | P1 | API |
| TC-BQMS-045 | Đánh dấu kết quả Thắng/Thua/Pending hợp lệ | Đơn lẻ | staff | 1 RFQ | Bấm ResultMarkControl chọn "Trúng thầu" | `PATCH /rfq/{id}/result` value="won" → 200, badge đổi màu đúng | P1 | API+UI |
| TC-BQMS-046 | Đánh dấu kết quả — giá trị không hợp lệ → 400 | Negative | staff | 1 RFQ | `PATCH /result` value="win" (sai chính tả) | HTTP 400 (chỉ nhận won/lost/pending) | P1 | API |
| TC-BQMS-047 | Bỏ qua (Skip) RFQ | Đơn lẻ | staff | 1 RFQ chưa skip | Bấm "Bỏ qua" trên dòng | `POST /rfq/{id}/skip` → 200; RFQ chuyển filter "Skip", không còn ở "Đang theo dõi" | P2 | API+UI |
| TC-BQMS-048 | Tạo báo giá nhanh inline (InlineCreateQuotation) | Đơn lẻ | staff | 1 RFQ chưa có báo giá | Bấm "Tạo nhanh" trên dòng, điền form rút gọn, Lưu | Báo giá tạo thành công, xuất hiện trong lịch sử báo giá | P2 | UI |
| TC-BQMS-049 | Rescan cưỡng bức 1 RFQ (force-rescan) | Đơn lẻ [AUTO-API] | manager | 1 RFQ dữ liệu cũ | Bấm "Rescan" trên dòng (`POST /rfq/{id}/force-rescan`) | Job rescan tạo đúng cho đúng RFQ đó | P3 | API |
| TC-BQMS-050 | Xem lịch sử thay đổi RFQ | Đơn lẻ | staff | RFQ đã qua ≥2 lần sửa giá/kết quả | Mở tab "Lịch sử" trên RowDetailPanel (`GET /rfq/{id}/history`) | Liệt kê đủ các lần sửa, có người sửa + thời gian, đúng thứ tự | P2 | API |
| TC-BQMS-051 | Đổi tên file trong folder RFQ — hợp lệ (tên có dấu) | Đơn lẻ | staff | 1 RFQ có ≥1 file | Bấm RenameButton, nhập "Báo giá đợt 2 ốc vít.xlsx" | `POST /rename-file` → 200, tên hiển thị đúng unicode | P2 | API+UI |
| TC-BQMS-052 | Đổi tên file — rỗng / chứa `\` hoặc `/` / vượt 200 ký tự → 400 | Negative | staff | 1 RFQ có file | Nhập lần lượt: chuỗi rỗng, `a\\b.xlsx`, tên 201 ký tự | Cả 3 → HTTP 400 | P1 | API |
| TC-BQMS-053 | Đổi tên file — tên không tồn tại → 404 / trùng tên → 409 | Negative | staff | 1 RFQ có 2 file A, B | 1) Đổi tên file không tồn tại → 404. 2) Đổi tên A thành trùng tên B → 409 | Đúng 2 mã lỗi tương ứng | P2 | API |
| TC-BQMS-054 | Đổi tên folder/subfolder báo giá (L1/L2..) | Đơn lẻ | staff | RFQ có subfolder L1 | Bấm FolderSubRenameMenu, đổi tên L1 → "L1 - Vòng 1" | `POST /rename-folder` → 200, cùng ràng buộc 400/404/409 như rename-file | P3 | API |
| TC-BQMS-055 | Xem subfolder báo giá của RFQ | Đơn lẻ | staff | RFQ có nhiều subfolder | `GET /rfq/{id}/subfolders` | Trả đúng danh sách thư mục con theo cấp L1/L2 | P3 | API |

### Nhóm C — F3/F4/F5 Wizard TM/GC + generate-round (F-BQMS-26..36)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-056 | Lấy danh sách item để báo giá (wizard-items) | Đơn lẻ | staff | RFQ TM có nhiều item | `GET /rfq/{id}/wizard-items` | Trả đủ item, đúng giá gợi ý/spec/maker | P2 | API |
| TC-BQMS-057 | TmQuoteWizard — Chọn tất cả rồi Tạo file V1 | Luồng | staff | RFQ TM chưa báo giá vòng nào | 1) Mở RFQ trên bảng chính. 2) Mở TmQuoteWizard. 3) Bấm "Chọn tất cả". 4) Sửa giá 1 item tại chỗ. 5) Bấm "Tạo file V1" | `POST /quotation-templates/generate` → 200; danh sách "Files đã tạo" xuất hiện đúng file Excel/PDF; giá đã sửa phản ánh đúng trong file | P1 | API+UI |
| TC-BQMS-058 | TmQuoteWizard — Bỏ qua từng dòng | Đơn lẻ | staff | RFQ TM nhiều item | Bấm "Bỏ qua" trên 1 dòng, xác nhận dòng đó không vào file generate | Item bị bỏ qua không xuất hiện trong file kết quả, không chặn các item còn lại | P2 | UI |
| TC-BQMS-059 | GcQuoteWizard — Step 1 Config chọn năm/tháng/cấp báo giá L1..Ln | Đơn lẻ | staff | RFQ GC | Chọn năm/tháng, chọn cấp "L1" | Danh sách sheet tương ứng hiển thị đúng cấp đã chọn | P2 | UI |
| TC-BQMS-060 | GcQuoteWizard — detect-files/scan-markers phân loại đúng Sẵn sàng/Thiếu giá/Skip | Luồng | staff | RFQ GC có file Excel với 1 sheet đủ giá, 1 sheet thiếu giá, 1 sheet đánh dấu skip | 1) Bấm "Quét file" (`POST /gc/detect-files`). 2) `POST /gc/scan-markers` | 3 nhóm hiển thị đúng: sheet đủ giá → "Sẵn sàng"; sheet thiếu → "Thiếu giá" kèm gợi ý sửa; sheet đánh dấu skip → "Skip", không lẫn nhóm | P1 | API |
| TC-BQMS-061 | GcQuoteWizard — sửa giá gợi ý từng sheet rồi Generate | Luồng | staff | Tiếp TC-060, đã sửa giá sheet "Thiếu giá" | 1) Sửa giá vào sheet thiếu. 2) Bấm "Tạo file GC" (`POST /gc/generate`) | 200; sheet chuyển "Sẵn sàng"; file GC sinh đúng, "Cảnh báo lỗi" trống nếu không còn thiếu | P1 | API |
| TC-BQMS-062 | Form GC item chi tiết (Material/Parts/Other/Process, Management Expenses, Profit, Result Total Amount) | Đơn lẻ | staff | 1 item GC | Mở GcItemForm, nhập đủ Material+Parts+Other+Process+Management Expenses+Profit | "Result Total Amount" tự tính đúng công thức tổng, khớp số hiển thị trong file xuất | P2 | UI |
| TC-BQMS-063 | Danh sách Files đã tạo + Cảnh báo lỗi sau generate | Trạng thái | staff | Vừa generate xong (TC-057) | Xem panel "Files đã tạo"/"Cảnh báo lỗi" | Liệt kê đúng file, link tải hoạt động; nếu có lỗi generate 1 phần thì hiện đúng dòng lỗi không lẫn với file thành công | P2 | UI |
| TC-BQMS-064 | Thử lại (Retry) khi generate lỗi | Đơn lẻ | staff | Mô phỏng generate 1 file lỗi (VD template hỏng) | Bấm "Thử lại" trên dòng lỗi | Chỉ generate lại đúng file lỗi đó, không sinh trùng các file đã thành công | P2 | UI |
| TC-BQMS-065 | Vòng 2 — round=2 KHÔNG bắt buộc ảnh (bẫy ngược) | Regression | staff | RFQ đã có V1, chuẩn bị tạo V2, KHÔNG upload ảnh mới | 1) Mở wizard vòng 2. 2) Bấm "Tạo file V2" mà không có ảnh mới đính kèm | `POST /rfq/{id}/generate-round` round=2 → 200 (dùng ảnh Samsung lưu sẵn từ V1), KHÔNG bị chặn bởi validate ảnh | P1 | API |
| TC-BQMS-066 | Vòng 1 — round=1 BẮT BUỘC ảnh | Regression | staff | RFQ mới, chưa có ảnh nào | Mở push-preview round=1 không có ảnh | Validate 400/cảnh báo "cần ảnh cho vòng 1", chặn generate/push cho tới khi có ảnh | P1 | API |
| TC-BQMS-067 | generate-round — round=0 và round=5 → 400 | Negative | staff | 1 RFQ | `POST /rfq/{id}/generate-round` round=0, sau đó round=5 | Cả 2 → HTTP 400 "round must be 1-4" | P1 | API |
| TC-BQMS-068 | Regression đóng-mở-lại RFQ V2 — result='closed' không chặn báo giá vòng mới còn hạn | Regression | staff | RFQ mồi có `result='closed'` từ vòng 1, deadline vòng 2 (Samsung mở lại) còn hạn | 1) Mở RFQ này trên bảng. 2) Mở wizard vòng 2, thử "Tạo file V2" và push | KHÔNG bị chặn bởi cờ `result='closed'` cũ; sinh file/preview push bình thường vì deadline mới còn hạn (fix 24/06 — case regression bắt buộc) | P1 | API |
| TC-BQMS-069 | Regen PDF từ file quote (quote-file/regen-pdf) | Đơn lẻ | staff | 1 file Excel quote đã tạo | Bấm "Regen PDF" | `POST /quote-file/regen-pdf` → 200, PDF mới thay thế đúng bản cũ, số liệu khớp Excel nguồn | P2 | API |
| TC-BQMS-070 | Xem trước PDF trong modal / mở tab mới / đóng | Đơn lẻ | staff | 1 file PDF đã tạo | 1) Bấm biểu tượng xem trước → modal mở. 2) Bấm "Mở tab mới". 3) Đóng modal | PDF hiển thị đúng nội dung; tab mới mở đúng URL; đóng modal không lỗi console | P3 | UI |
| TC-BQMS-071 | Regenerate cùng round 2 lần liên tiếp — file Lần 1 không bị mất (archived) | Regression | staff | Folder RFQ mồi có `L1` sẵn (đã seed) | 1) Bấm "Tạo file V1" lần nữa trên RFQ đã có V1. 2) Kiểm tra thư mục staging | File V1 cũ được đổi tên `.archived_<ts>` giữ lại, file mới thay vào đúng vị trí L1, KHÔNG mất dữ liệu lịch sử | P1 | API |
| TC-BQMS-072 | Regenerate 2 lần trong <1 giây (đụng counter suffix) | Edge case | staff | Cùng RFQ TC-071 | Gửi 2 request `generate-round` gần như đồng thời (`asyncio.gather`) | Không sinh file trùng tên/ghi đè lẫn nhau không kiểm soát; counter suffix tăng đúng thứ tự, hoặc 1 trong 2 bị 409 "đang xử lý" | P2 | API |

### Nhóm D — F6/F7 Push lên SEC (đơn + hàng loạt) — mặt tiền uy tín Samsung

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-073 | Push preview — build payload đầy đủ | Đơn lẻ [SEMI-UI] | staff | RFQ đã có V1, giá>0, ảnh, file | Mở PushToSecModal, xem preview (`GET /rfq/{id}/push-preview`) | Payload hiện đủ: opinion, danh sách file đính kèm, ảnh, từng item giá>0; KHÔNG bấm nút gửi cuối | P1 | API |
| TC-BQMS-074 | Push đơn — Submission Opinion rỗng → 400 | Negative | staff | RFQ đủ điều kiện khác | Để trống ô "Ý kiến gửi" (Submission Opinion), bấm "Đẩy báo giá lên SEC" | `POST /push-to-sec` → 400, message rõ "cần nhập ý kiến" | P1 | API |
| TC-BQMS-075 | Push đơn — không có file đính kèm nào → 400 | Negative | staff | RFQ chưa gắn file nào | Bấm push khi 0 file đính kèm | HTTP 400 "cần ít nhất 1 file" | P1 | API |
| TC-BQMS-076 | Push đơn round=1 — thiếu ảnh → 400 | Negative | staff | RFQ round=1, chưa có ảnh | Bấm push round=1 không ảnh | HTTP 400 bắt ảnh đúng round 1 | P1 | API |
| TC-BQMS-077 | Push đơn round=2 — không có ảnh vẫn PASS validate | Regression | staff | RFQ round=2, không upload ảnh mới | Bấm push round=2 | Validate KHÔNG chặn ở bước ảnh (dùng ảnh Samsung sẵn có) — chỉ dừng ở [SEMI-UI], không bấm nút gửi cuối | P1 | API |
| TC-BQMS-078 | Push đơn — giá item = 0 (không phải abandonment) → 400 | Negative | staff | RFQ có 1 item giá=0, KHÔNG đánh dấu SUBMIT_GIVEUP | Bấm push | HTTP 400 "giá phải >0" cho item đó | P1 | API |
| TC-BQMS-079 | Push đơn — item abandonment (SUBMIT_GIVEUP='Y') push price=0 không phải 1 | Regression bảo mật số liệu | staff | Mã mồi `SUBMIT_GIVEUP='Y'` đã seed | Xem payload preview cho item này | Trường giá trong payload = `0`, KHÔNG phải `1` (Samsung SUM toàn bộ dòng vào grand total — sai 1 làm lệch tổng gửi Samsung, fix 03/06) | P1 | API |
| TC-BQMS-080 | Push đơn thành công — dispatch job Procrastinate | Luồng [AUTO-API] | staff | RFQ đủ điều kiện (opinion, file, ảnh round1, giá>0) | 1) Điền đủ Submission Opinion. 2) Bấm "Đẩy báo giá lên SEC" | `POST /push-to-sec` → 200; job `bqms_submit_quote` tạo đúng `status=queued`, payload khớp preview; KHÔNG chờ worker thật chạy Samsung | P1 | API |
| TC-BQMS-081 | Dedupe 409 — bấm push 2 item KHÁC NHAU cùng 1 RFQ liên tiếp | Regression quan trọng | staff | RFQ mồi N=3 items | 1) Push item A của RFQ X (queued). 2) Ngay sau đó push item B (khác dòng, cùng `rfq_number` X) | Lần 2 → HTTP 409 "RFQ đang trong hàng đợi/đang chạy" (dedupe theo `rfq_number`, KHÔNG theo item id); KHÔNG có 2 job cho cùng RFQ | P1 | API |
| TC-BQMS-082 | Double-click nút "Đẩy báo giá lên SEC" — không tạo job đôi | Edge case/Concurrency | staff | RFQ đủ điều kiện push | Bắn 2 request `POST /push-to-sec` gần như đồng thời (`asyncio.gather`) | Đúng 1 request 200 tạo job, request còn lại 409 dedupe; DB chỉ có đúng 1 job `queued` cho RFQ đó | P1 | API |
| TC-BQMS-083 | Double-click "Tạo file V{round}" và Push cùng lúc trong modal | Edge case | staff | RFQ đủ điều kiện | Bấm "Tạo file V1" và gần như ngay lập tức bấm "Đẩy báo giá lên SEC" trước khi file xong | Push phải chờ/generate xong file mới cho phép gửi, hoặc bị chặn với thông báo rõ ràng "đang tạo file"; không gửi file cũ/rỗng lên Samsung | P1 | API |
| TC-BQMS-084 | Push đơn — rate limit 5/phút → 429 [Khối R] | Negative | staff | RFQ khác nhau đủ điều kiện push (để không dính 409 dedupe) | Gọi `POST /push-to-sec` 6 lần trong 1 phút (5 RFQ khác nhau + 1 lần dư) | Request thứ 6 → HTTP 429; 5 request đầu không bị chặn bởi rate-limit (có thể bị 409 nếu trùng RFQ — dùng RFQ khác nhau để cô lập) | P1 | API |
| TC-BQMS-085 | 409 dedupe khi RFQ đang `running` (không chỉ `queued`) | Đơn lẻ | staff | Mô phỏng job đang `status=running` cho RFQ Y | Push lại RFQ Y khi job đang running | HTTP 409, message phân biệt được queued vs running nếu có | P2 | API |
| TC-BQMS-086 | Hủy queue khi job đang `queued` | Đơn lẻ [AUTO-API] | staff | Job push `status=queued` | Bấm "Hủy" trên PushQueueWidget (`POST /push-queue/cancel/{rfq_number}`) | 200, job chuyển `cancelled`, KHÔNG được worker nhặt lên chạy | P1 | API |
| TC-BQMS-087 | Hủy queue khi job đang `running` — hành vi khác với queued | Edge case | staff | Job push `status=running` (mô phỏng) | Bấm "Hủy" khi job đang running | Ghi nhận hành vi thực tế: hoặc bị từ chối (400/409 "không thể hủy khi đang chạy") hoặc đánh dấu cancel-request chờ worker tự dừng ở checkpoint an toàn — KHÔNG được ngắt cứng giữa lúc đang thao tác trên Samsung | P1 | API |
| TC-BQMS-088 | Theo dõi hàng đợi push (PushQueueWidget) hiển thị đúng trạng thái | Trạng thái | staff | 2-3 job push ở trạng thái khác nhau | `GET /push-queue/status`, quan sát widget | Hiển thị đúng số lượng theo từng trạng thái, cập nhật theo thời gian thực (poll) | P2 | UI |
| TC-BQMS-089 | Popup tiến trình push (PushProgressPopup) cập nhật liên tục | Trạng thái | staff | Job push đang chạy (mock) | Quan sát popup trong lúc job chạy | Progress cập nhật mỗi ~3s (memory: push resilience), không đứng hình | P3 | UI |
| TC-BQMS-090 | Xem screenshot lỗi push | Đơn lẻ | staff | Job push thất bại (mock lỗi) | `GET /rfq/{id}/push-screenshot` | Trả ảnh chụp màn hình đúng bước lỗi, giúp phân biệt lỗi do Samsung đóng hạn (không phải bug hệ mình) | P2 | API |
| TC-BQMS-091 | Upload ảnh trong preview trước khi push | Đơn lẻ | staff | RFQ round=1 đang mở preview, thiếu ảnh | Bấm "Tải ảnh lên" trong modal preview, chọn file JPG hợp lệ | `POST /push-preview/upload-image` → 200, ảnh xuất hiện ngay trong preview, validate ảnh round1 chuyển PASS | P2 | API |
| TC-BQMS-092 | Lịch sử vòng push theo RFQ (round-history) | Đơn lẻ | staff | RFQ đã push V1, V2 | `GET /rfq/{rfq_number}/round-history` | Liệt kê đúng thứ tự V1→V2, kèm thời gian, trạng thái từng vòng | P2 | API |
| TC-BQMS-093 | Badge vòng push hiện tại (PushRoundBadge) | Trạng thái | staff | RFQ đang ở vòng 2 | Xem badge trên dòng RFQ | Hiển thị đúng "V2", đổi màu/label khi RFQ chuyển vòng | P3 | UI |
| TC-BQMS-094 | Push batch — biên đúng 8 mã PASS | Luồng [AUTO-API] | staff | 8 mã đủ điều kiện (giá>0, ảnh, file) | 1) Mở BatchPushSecModal. 2) Chọn đúng 8 mã. 3) Bấm "Đẩy hàng loạt lên SEC" | `POST /push-to-sec/batch` → 200; 1 job `bqms_submit_batch` tạo đúng, payload có đủ 8 mã, giữ `samsung_session_lock` xuyên suốt | P1 | API |
| TC-BQMS-095 | Push batch — 9 mã → 400 | Negative | staff | 9 mã đủ điều kiện | Chọn 9 mã, bấm gửi | `POST /push-to-sec/batch` → HTTP 400 "tối đa 8 mã", không tạo job | P1 | API |
| TC-BQMS-096 | Push batch — 0 mã → 400 | Negative | staff | — | Bấm gửi khi chưa chọn mã nào | HTTP 400 | P1 | API |
| TC-BQMS-097 | Push batch — mã thiếu giá/ảnh/file bị SKIP kèm lý do, không hỏng cả mẻ | Regression quan trọng | staff | 7 mã đủ điều kiện + 1 mã thiếu ảnh (mã mồi) | Chọn 8 mã (gồm 1 mã lỗi), bấm gửi | `POST /batch` vẫn 200, job tạo với 7 mã hợp lệ để push, riêng mã lỗi được đánh dấu SKIP kèm lý do rõ ràng ("thiếu ảnh") trong response/preview — KHÔNG làm hỏng toàn bộ batch | P1 | API |
| TC-BQMS-098 | Push batch — no-retry per code (1 mã lỗi không lặp lại) | Đơn lẻ [AUTO-API] | staff | Job batch đang chạy, 1 mã lỗi giữa chừng (mock) | Theo dõi `round-history`/log job | Mã lỗi bị bỏ qua chuyển sang mã tiếp theo ngay, KHÔNG retry vô hạn làm treo cả hàng đợi | P1 | API |
| TC-BQMS-099 | Push batch — rate limit 3/phút → 429 [Khối R] | Negative | staff | 4 lượt batch hợp lệ (mỗi lượt set mã khác nhau) | Gọi `POST /push-to-sec/batch` 4 lần trong 1 phút | Lần thứ 4 → HTTP 429 | P1 | API |
| TC-BQMS-100 | Push batch — 1 job giữ session_lock, không đụng độ với push đơn song song | Concurrency | staff | 1 batch job đang chạy + 1 push đơn RFQ khác (không trùng mã trong batch) gọi cùng lúc | Bắn `POST /push-to-sec` (đơn, RFQ ngoài batch) trong lúc batch job đang giữ lock | Push đơn phải CHỜ lock (không chạy song song đụng session Samsung) hoặc bị queue đúng thứ tự — không có 2 tiến trình cùng thao tác Samsung 1 lúc (memory: BQMS Push Concurrency, đã fix bằng advisory lock) | P1 | API |
| TC-BQMS-101 | Session Samsung hết hạn giữa push — retry lần 3 = force re-login | Regression [MANUAL-SAMSUNG ⚠️] | admin | RFQ hy sinh định trước, ngoài giờ SEC | Theo checklist push resilience: mô phỏng session hết hạn ở retry 1,2, quan sát retry 3 | Retry thứ 3 thực hiện force re-login thay vì tiếp tục dùng session cũ; log xác nhận | P2 | Tay |
| TC-BQMS-102 | Re-push idempotent khi `prev_status=saved_temp` | Regression [MANUAL-SAMSUNG ⚠️] | admin | RFQ hy sinh đã ở trạng thái saved_temp trên Samsung | Push lại đúng RFQ đó | Hệ thống nhận diện re-push, KHÔNG tạo trùng báo giá trên Samsung, bypass đúng logic idempotent (memory: Push Override) | P2 | Tay |

### Nhóm E — F8 Cổng NCC vendor-staging (F-BQMS-74..79)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-103 | Danh sách + chi tiết vendor-staging | Đơn lẻ | staff / vendor | Vendor được mời ≥1 staging | `GET /vendor-staging`, `GET /vendor-staging/{id}` | Trả đúng danh sách theo quyền (vendor chỉ thấy của mình) | P1 | API |
| TC-BQMS-104 | Vendor NCC A xem chi tiết staging của NCC B → IDOR check | Negative/Bảo mật | vendor (2 account khác NCC) | 2 vendor account thuộc 2 NCC demo khác nhau, mỗi NCC có staging riêng | Vendor A gọi `GET /vendor-staging/{id_của_B}` | HTTP 403/404, KHÔNG lộ dữ liệu chéo NCC | P1 | API |
| TC-BQMS-105 | Vendor chưa được mời gọi vendor-staging → 404 | Negative | vendor (chưa mời) | Vendor account chưa gắn batch nào | `GET /vendor-staging` | Danh sách rỗng hoặc 404 rõ ràng, không lộ dữ liệu của vendor khác | P2 | API |
| TC-BQMS-106 | NCC nộp báo giá 1 mã | Đơn lẻ | vendor | 1 staging item đang mở | 1) Đăng nhập cổng NCC. 2) Nhập giá, bấm "Gửi báo giá" | `POST /vendor-staging/{id}/quote` → 200, item chuyển trạng thái đã báo giá | P1 | API |
| TC-BQMS-107 | NCC bỏ qua 1 mã | Đơn lẻ | vendor | 1 staging item | Bấm "Bỏ qua" | `POST /skip` → 200, item chuyển skip, không còn chờ báo giá | P2 | API |
| TC-BQMS-108 | Nộp báo giá hàng loạt qua queue (quote-batch) | Luồng [AUTO-API] | vendor | ≥3 staging item cùng lúc | Tick chọn nhiều mã, bấm "Gửi hàng loạt" | `POST /quote-batch` → 200 tạo job Procrastinate; `GET status` poll tới hoàn tất; `GET list` trả đúng kết quả từng mã | P1 | API |
| TC-BQMS-109 | quote-batch rate-limit 10/phút → 429 [Khối R] | Negative | vendor | Nhiều lượt gửi batch | Gọi `POST /quote-batch` 11 lần trong 1 phút | Lần 11 → 429 | P2 | API |
| TC-BQMS-110 | Quyết định chọn/loại NCC (decide) | Đơn lẻ | manager | Staging đã có báo giá từ vendor | Bấm "Chọn NCC này" / "Loại" trên 1 staging | `POST /decide` → 200, trạng thái đổi đúng | P1 | API |
| TC-BQMS-111 | Merge-approved — giá NCC đã duyệt chảy đúng sang đấu thầu nội bộ | Luồng quan trọng | manager | ≥2 staging đã `decide=approved` | Bấm "Gộp đã duyệt" (`POST /merge-approved`) | 200; dữ liệu award/giá NCC merge đúng vào bảng đấu thầu nội bộ, KHÔNG merge nhầm staging chưa duyệt, KHÔNG merge đôi (chạy 2 lần liên tiếp không tạo bản ghi trùng) | P1 | API |
| TC-BQMS-112 | Tải file đính kèm bidding (download-files) | Đơn lẻ | staff | Staging có file đính kèm | `POST /bidding/{staging_id}/download-files` | Trả đúng file, không lộ file của staging khác | P2 | API |
| TC-BQMS-113 | So sánh coverage Excel vs Portal | Đơn lẻ | manager | Dữ liệu Excel cũ + Portal scrape cùng kỳ | `GET /coverage/excel-vs-portal` | Báo cáo đúng phần trùng/thiếu giữa 2 nguồn | P3 | API |
| TC-BQMS-114 | vendor-staging edit khi `_assert_bqms_edit_enabled` flag OFF → 403 | Permission/Flag | staff | `app_config.bqms_edit_enabled=false` | Thử `POST /vendor-staging/{id}/quote` hoặc `/decide` khi flag OFF | HTTP 403 toàn bộ endpoint mutate; teardown bật lại flag=true | P1 | API |

### Nhóm F — F9 Dossier giao hàng (F-BQMS-92..96)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-115 | Trang Deliveries — KPI + revenue-stats đúng số | Đơn lẻ | staff | PO có 3 đợt giao (mồi dedup) | Mở `/bqms/deliveries`, xem KPI Cards | Số liệu KPI khớp query dedup theo đợt giao (GIỮ history, không gộp nhầm 3 đợt thành 1) | P1 | API+UI |
| TC-BQMS-116 | Export deliveries — vượt 10.000 bản ghi → 400 | Negative | staff | Mô phỏng filter ra >10.000 dòng | Bấm "Xuất Excel" với filter rộng | `GET /export` → HTTP 400 rõ lý do vượt giới hạn | P2 | API |
| TC-BQMS-117 | Tạo đơn giao hàng — thiếu field bắt buộc → 400 | Negative | staff | — | `POST /deliveries` thiếu `customer_id` | HTTP 400 | P2 | API |
| TC-BQMS-118 | Sửa đơn giao hàng — không có trường update nào → 400 | Negative | staff | 1 đơn có sẵn | `PUT /deliveries/{id}` body rỗng | HTTP 400 | P2 | API |
| TC-BQMS-119 | Đổi trạng thái đơn giao hàng — thiếu `status`/giá trị sai/id không tồn tại | Negative | staff | 1 đơn có sẵn | `PATCH /{id}/status` không có field `status`; rồi `status="flying"`; rồi id giả | 400/400/404 tương ứng | P2 | API |
| TC-BQMS-120 | Mở wizard Tạo hồ sơ giao hàng — prefill đúng dữ liệu | Luồng | staff | PO đã giao xong, chưa có dossier | 1) Mở `/bqms/deliveries/new-dossier`. 2) Chọn PO. 3) Xem prefill (`POST /dossier-prefill`) | Thông tin N/O/P/Receiver/shipping tự điền đúng từ PO | P1 | API+UI |
| TC-BQMS-121 | Tạo hồ sơ dossier — sev_type sai / items rỗng → 400 | Negative | staff | — | `POST /create-dossier` với `sev_type="ABC"`, rồi `items=[]` | HTTP 400 cả 2 | P1 | API |
| TC-BQMS-122 | Tạo dossier thành công — poll job tới `done` | Luồng [AUTO-API] | staff | PO hợp lệ, đủ items | 1) Bấm "Tạo hồ sơ". 2) Poll `GET dossier-job/{id}` | Job đi qua queued→running→done; `output_folder` tồn tại thật trên đĩa (dùng prefix DEMO- dọn sau) | P1 | API |
| TC-BQMS-123 | Upload ảnh vào dossier đang xử lý | Đơn lẻ | staff | Job dossier đang `running`/`awaiting_confirm` | `POST /upload-image` | 200 khi job ở trạng thái cho phép; nếu job đã ở status khác (VD `done`) → 409 "không upload thêm được" | P2 | API |
| TC-BQMS-124 | Xác nhận (Confirm) dossier ở checkpoint awaiting_confirm | Đơn lẻ | staff | Job ở `awaiting_confirm` | Bấm "Xác nhận" | `POST /confirm` → 200, job chuyển tiếp xử lý/hoàn tất | P1 | API |
| TC-BQMS-125 | Hủy (Cancel) dossier | Đơn lẻ | staff | Job đang xử lý | Bấm "Hủy" | `POST /cancel` → 200, job dừng đúng trạng thái `cancelled`, không tiếp tục ngầm | P2 | API |
| TC-BQMS-126 | Tải folder.zip / file dossier | Đơn lẻ | staff | Job `done` có `output_folder` thật | Bấm "Tải zip" | `GET folder.zip` trả file đúng, đếm số entry khớp số file thực có trên đĩa (không thiếu âm thầm) | P2 | API |
| TC-BQMS-127 | Cập nhật + regenerate dossier | Đơn lẻ | staff | Dossier `done` cần sửa | `POST update-regenerate` | 200, hồ sơ mới thay thế đúng, giữ được ảnh cũ nếu không đổi | P2 | API |
| TC-BQMS-128 | Ảnh hệ thống theo mã BQMS cho dossier | Đơn lẻ | staff | Mã có ảnh hệ thống sẵn | `GET /dossier-system-image/{bqms_code}` | Trả đúng ảnh ưu tiên theo mã | P3 | API |
| TC-BQMS-129 | 3 job dossier active cùng 1 user — rate-limit/giới hạn | Negative | staff | User đã có 3 job dossier `queued/running` | Tạo dossier job thứ 4 | HTTP 429 hoặc từ chối rõ ràng "quá nhiều job đang xử lý" | P2 | API |
| TC-BQMS-130 | F5 reload trình duyệt giữa wizard dossier — job vẫn tiếp tục | Edge case | staff | Job dossier đang `running` | Nhấn F5 giữa lúc job chạy | Job trên server KHÔNG bị hủy do reload FE; poll lại vẫn thấy đúng tiến trình, form không mất trạng thái nghiêm trọng (hoặc khôi phục lại từ job_id trên URL) | P2 | UI |
| TC-BQMS-131 | Tra gốc xuất xứ + bulk-lookup giao hàng | Đơn lẻ | staff | ≥1 lô hàng có mã xuất xứ | `POST /origin-summary`, `POST /bulk-lookup` | Trả đúng tổng hợp theo mã, không lẫn dữ liệu đơn khác | P3 | API |
| TC-BQMS-132 | Quản lý tài xế giao hàng (DriverManagementModal/Picker) | Đơn lẻ | staff | ≥1 tài xế đã tạo | Mở modal, thêm/chọn tài xế cho 1 đơn | Gán tài xế thành công, hiển thị đúng trên đơn giao hàng | P3 | UI |
| TC-BQMS-133 | Dashboard doanh thu (RevenueDashboardModal) | Đơn lẻ | manager | Có dữ liệu doanh thu tháng hiện tại | Mở modal, xem biểu đồ | Số liệu khớp `revenue-stats`, không lệch giữa modal và trang chính | P2 | UI |

### Nhóm G — F10 Won Quotations, HS Code, Contracts, Records/Contacts, Analytics

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-134 | Trang Won Quotations — danh sách + tổng có/chưa HS code | Đơn lẻ | staff | Có bản ghi trúng thầu có/chưa HS | Mở `/bqms/won-quotations` | Tổng số + tổng có HS + tổng chưa HS khớp query thực tế | P2 | API+UI |
| TC-BQMS-135 | Sửa HS code / ghi chú won quotation | Đơn lẻ | staff | 1 bản ghi won | `PATCH /won-quotations/{id}` sửa HS code | 200, cập nhật đúng, hiển thị lại ngay trên bảng | P2 | API |
| TC-BQMS-136 | Tra HS code hàng loạt (bulk-lookup) | Đơn lẻ | staff | File Excel danh sách mã cần tra | Mở modal "Tra HS code hàng loạt", upload file | `POST /hs-code/bulk-lookup` → 200, trả đúng kết quả từng dòng, dòng không tra được có ghi chú lỗi rõ ràng | P2 | API |
| TC-BQMS-137 | Refresh 1 won quotation theo RFQ number | Đơn lẻ | staff | 1 RFQ đã trúng thầu, dữ liệu won cũ | `POST /won-quotations/refresh/{rfq_number}` | 200, đồng bộ lại đúng dữ liệu mới nhất từ bqms_rfq | P3 | API |
| TC-BQMS-138 | Refresh toàn bộ won (RefreshWonButton) | Đơn lẻ | manager | — | Bấm "Làm mới toàn bộ" | `POST /won/refresh` → 200, số bản ghi cập nhật khớp thực tế | P3 | UI |
| TC-BQMS-139 | Danh sách Hợp đồng (contracts) + merge | Đơn lẻ | staff | ≥2 contract liên quan cùng RFQ | `GET /contracts`, `GET /contracts/{id}`, `POST /contracts/merge` | Danh sách đúng; merge gộp đúng không trùng lặp | P3 | API |
| TC-BQMS-140 | KPI tổng quan BQMS + Analytics Pareto | Đơn lẻ | manager | Dữ liệu đủ nhiều tháng | `GET /kpi`, `GET /analytics/pareto` | Số liệu tổng quan đúng; Pareto sắp xếp giảm dần theo giá trị | P3 | API |
| TC-BQMS-141 | Thống kê thắng/thua theo kỳ (win-lost stats) — period sai → 400 | Negative | manager | — | `GET /stats/win-lost` period="quý" (không hợp lệ) | HTTP 400 | P2 | API |
| TC-BQMS-142 | Records — danh sách bản ghi RFQ chi tiết | Đơn lẻ | staff | — | `GET /records` | Trả đúng cấu trúc bản ghi, phân trang hợp lý | P3 | API |
| TC-BQMS-143 | Danh bạ liên hệ (contacts) | Đơn lẻ | staff | — | `GET /contacts` | Trả đúng danh sách liên hệ liên quan RFQ | P3 | API |
| TC-BQMS-144 | Staging Hợp đồng + MRO staging | Đơn lẻ | staff | — | `GET /staging/contracts`, `GET /staging/mro` | Trả đúng dữ liệu thô trước khi merge chính thức | P3 | API |
| TC-BQMS-145 | Trang MRO — danh sách PO + filter trạng thái | Đơn lẻ | staff | PO đủ 6 trạng thái (Đã đặt/Xác nhận/Đang SX/Đang giao/Đã giao/Đã đóng) | Mở `/bqms/mro`, lọc từng trạng thái | Mỗi filter trả đúng PO tương ứng | P2 | UI |
| TC-BQMS-146 | PO confirm / cancel-confirm | Đơn lẻ | staff | 1 PO chưa confirm | `POST /po/confirm`, sau đó `POST /po/cancel-confirm` | Trạng thái đổi đúng theo từng thao tác, không cho cancel PO đã Đã đóng | P2 | API |

### Nhóm H — Parse/Classify + Templates + Quotation list/detail/history (F-BQMS-37..57)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-147 | Upload file BC BQMS hợp lệ để parse | Đơn lẻ (bổ sung cho suite có sẵn) | staff | File mẫu chuẩn xlsx hợp lệ | `POST /rfq/parse` upload file | 200, trả đúng dữ liệu RFQ đã parse | P1 | API |
| TC-BQMS-148 | Parse file 0 byte → 400 | Negative | staff | File 0 byte (fixture chuẩn) | `POST /rfq/parse` | HTTP 400 | P1 | API |
| TC-BQMS-149 | Parse file >50MB → 400 | Negative | staff | File >50MB (fixture chuẩn) | `POST /rfq/parse` | HTTP 400 | P1 | API |
| TC-BQMS-150 | Trang Classify — upload BC, xem tổng/tin cậy/lý do/nguồn | Luồng | staff | File BC hợp lệ | Mở `/bqms/classify`, upload, xem kết quả | Hiển thị đúng tổng số dòng, % tin cậy, lý do phân loại, nguồn dữ liệu | P2 | UI |
| TC-BQMS-151 | Phân loại hàng loạt bằng AI (smart_classify batch) | Đơn lẻ | staff | ≥5 RFQ chưa phân loại | `POST /batch` | 200, mỗi RFQ có `classification` + `confidence` gán tự động | P2 | API |
| TC-BQMS-152 | Xem kết quả phân loại (results) | Đơn lẻ | staff | Vừa chạy batch TC-151 | `GET /results` | Trả đúng kết quả, khớp số RFQ đã phân loại | P2 | API |
| TC-BQMS-153 | Ghi đè kết quả phân loại AI (override) | Đơn lẻ | staff | 1 RFQ đã có kết quả AI sai | `POST /override` sửa classification | 200, ghi đè đúng, không bị AI ghi lại đè lên lần sau | P2 | API |
| TC-BQMS-154 | Templates báo giá — danh sách + tạo mới | Đơn lẻ | admin | — | Mở `/bqms/quotation/templates`, `GET/POST /templates` | Danh sách hiển thị đúng; tạo mới thành công | P2 | API+UI |
| TC-BQMS-155 | Upload template Excel — đặt mặc định + chọn loại | Đơn lẻ | admin | File Excel mẫu template | Upload, tick "Đặt làm mặc định", chọn loại "Thương mại" | 200, template mới thành mặc định, các template Thương mại khác tự bỏ mặc định (chỉ 1 mặc định/loại) | P2 | UI |
| TC-BQMS-156 | Xóa template | Đơn lẻ | admin | 1 template không phải mặc định | `DELETE /templates/{id}` | 200, biến mất khỏi danh sách; xóa template đang là mặc định → cảnh báo/chặn hoặc set mặc định mới tự động (ghi nhận hành vi thực tế) | P2 | API |
| TC-BQMS-157 | Lookup mẫu báo giá theo mã | Đơn lẻ | staff | Mã có template map sẵn | `GET /lookup?code=...` | Trả đúng template tương ứng loại TM/GC/Kết hợp | P3 | API |
| TC-BQMS-158 | Trang Báo giá — danh sách + Xác nhận gửi duyệt | Luồng | staff | 1 báo giá draft | Mở `/bqms/quotation`, chọn file, bấm "Xác nhận gửi duyệt" | Chuyển trạng thái đúng, xuất hiện trong lịch sử chờ duyệt | P2 | UI |
| TC-BQMS-159 | Tạo báo giá tự động (quotation/new) — nhập mã RFQ + upload BC | Luồng | staff | Mã RFQ hợp lệ + file BC | Mở `/bqms/quotation/new`, nhập mã, upload file, bấm tạo | Báo giá tạo thành công, điều hướng đúng tới trang chi tiết | P1 | UI |
| TC-BQMS-160 | Chi tiết 1 báo giá — loading/not-found/error state | Trạng thái | staff | 1 báo giá tồn tại + 1 id giả | Mở `/bqms/quotation/{id}` hợp lệ rồi id giả | Trang hợp lệ hiển thị đủ; id giả → not-found rõ ràng, không crash | P2 | UI |
| TC-BQMS-161 | Sửa báo giá đã tạo (PATCH history) | Đơn lẻ | staff | 1 báo giá đã tạo | `PATCH /history/{id}` sửa giá | 200, cập nhật đúng, file liên quan có regen nếu cần | P2 | API |
| TC-BQMS-162 | Xóa mềm báo giá (soft delete) + Khôi phục (restore) | Luồng | staff | 1 báo giá | 1) `DELETE /history/{id}`. 2) `POST /history/{id}/restore` | Xóa: biến mất khỏi danh sách chính, còn trong "đã xóa". Restore: quay lại danh sách chính nguyên vẹn dữ liệu | P2 | API |
| TC-BQMS-163 | Lịch sử báo giá — phân trang Trước/Sau | Đơn lẻ | staff | ≥30 báo giá trong lịch sử | Bấm "Sau" rồi "Trước" trên `/bqms/quotation/history` | Điều hướng đúng trang, không lặp/thiếu dòng | P3 | UI |
| TC-BQMS-164 | Đồng bộ OneDrive cho 1 báo giá — M365 env trống | Bug-gate/Ghi nhận | staff | 1 báo giá, môi trường M365 để trống như prod | `POST /history/{id}/sync-onedrive` | Kỳ vọng hiện tại: KHÔNG sync thật lên OneDrive cloud (assert best-effort/502, không giả định thành công) | P2 | API |
| TC-BQMS-165 | Chia sẻ báo giá (share link) | Đơn lẻ | staff | 1 báo giá | `POST /history/{id}/share` | 200, trả link share hoạt động, `GET /share-link` khớp | P3 | API |
| TC-BQMS-166 | Tải file báo giá theo file_type | Đơn lẻ | staff | Báo giá có cả Excel + PDF | `GET /download/{id}/{file_type}` cho từng loại | Trả đúng file tương ứng loại | P2 | API |
| TC-BQMS-167 | Preview file báo giá inline trên trình duyệt | Đơn lẻ | staff | 1 file PDF | `GET /preview/{id}/{file_type}` | Trả nội dung inline đúng, header `Content-Disposition` không ép tải xuống | P3 | API |
| TC-BQMS-168 | Link công khai xem báo giá (public share) — không cần đăng nhập | Đơn lẻ | (không token) | Đã có share link từ TC-165 | Mở `GET /public/{id}/{file_type}` không kèm Authorization | 200, xem được file mà không cần login; id không hợp lệ/đã thu hồi → 403/404 | P2 | API |
| TC-BQMS-169 | Trang Emails — xem email liên quan RFQ | Đơn lẻ | staff | RFQ có email liên quan trong DB | Mở `/bqms/emails`, chọn RFQ | Hiển thị đúng Từ/Đến/nội dung; empty state khi RFQ không có email | P3 | UI |
| TC-BQMS-170 | Trang Folder quản lý tài liệu theo RFQ — loading/empty | Trạng thái | staff | RFQ không có file nào | Mở `/bqms/folder/{rfq}` | Empty state rõ ràng "Chưa có tài liệu"; RFQ có file → hiển thị đúng cây thư mục | P3 | UI |

### Nhóm I — Thư viện ảnh, override, folder bidding, price_lookup (F-BQMS-98..106)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-171 | Resolve ảnh theo mã — đủ 5 lớp, ưu tiên đúng thứ tự | Regression quan trọng | staff | Mã mồi có đủ 5 lớp ảnh (primary-pin/override-RFQ/override-code/image_index/FS) | `GET /code/{code}/images`, gỡ dần từng lớp từ trên xuống, gọi lại mỗi lần | Ảnh trả về luôn đúng lớp cao nhất còn tồn tại theo thứ tự: primary-pin → override-RFQ → override-code → image_index → FS scan | P1 | API |
| TC-BQMS-172 | Đặt ảnh chính (primary-image) | Đơn lẻ | staff | Mã có ≥2 ảnh | `POST /primary-image` chọn 1 ảnh | 200, ảnh đó trở thành primary-pin, ưu tiên cao nhất khi resolve | P2 | API |
| TC-BQMS-173 | Xóa ảnh chính / xóa ảnh | Đơn lẻ | staff | Mã có primary-image | `DELETE /primary-image`, `DELETE /image` | 200, resolve ảnh rớt xuống đúng lớp kế tiếp | P2 | API |
| TC-BQMS-174 | Crop ảnh — EXIF orientation ảnh chụp dọc từ điện thoại | Regression | staff | Ảnh EXIF orientation=6 (fixture chuẩn) | `POST /crop-image` chọn vùng như người dùng thấy trên UI (đã xoay đúng) | Ảnh kết quả crop đúng vùng người dùng nhìn thấy, KHÔNG bị lệch do EXIF chưa transpose (fix `exif_transpose`) | P1 | API |
| TC-BQMS-175 | Crop ảnh — vùng crop <4px → 400; tọa độ ngoài biên bị clamp | Negative/Edge case | staff | 1 ảnh | `POST /crop-image` với vùng 2x2px; sau đó tọa độ âm/vượt kích thước ảnh | Vùng quá nhỏ → 400; tọa độ ngoài biên tự clamp về trong ảnh, không lỗi 500 | P2 | API |
| TC-BQMS-176 | Crop xong tự ghim làm ảnh chính | Đơn lẻ | staff | 1 ảnh chưa phải primary | Crop ảnh đó | Sau crop, ảnh tự động trở thành primary-pin | P2 | API |
| TC-BQMS-177 | Upload ảnh mới cho mã BQMS | Đơn lẻ | staff | Mã chưa có ảnh nào | `POST /upload-image` | 200, ảnh xuất hiện trong thư viện, resolve trả đúng ảnh mới nếu không có lớp cao hơn | P2 | API |
| TC-BQMS-178 | Ghi đè ảnh báo giá theo RFQ (quote-image-override) | Luồng | staff | 1 RFQ | 1) `POST /quote-image-override` đặt ảnh riêng cho RFQ này. 2) `GET check` xác nhận. 3) `DELETE` gỡ override | Override có hiệu lực cao hơn ảnh mặc định của mã trong đúng RFQ này (không ảnh hưởng RFQ khác cùng mã); xóa override quay về ảnh mặc định | P2 | API |
| TC-BQMS-179 | Xem folder bidding + tải file trong folder | Đơn lẻ | staff | Mã có folder thật trên staging | `GET /bidding/folder`, `GET /bidding/folder/file` | Trả đúng danh sách file + tải đúng file chọn | P2 | API |
| TC-BQMS-180 | Folder bidding — mã không có folder → exists:false, không 500 | Negative | staff | Mã không có folder trên đĩa | `GET /bidding/folder` mã đó | Trả `exists:false` + danh sách probed paths, KHÔNG lỗi 500 | P2 | API |
| TC-BQMS-181 | vendor gọi folder bidding → 403 | Permission | vendor | — | `GET /bidding/folder` bằng token vendor | HTTP 403 | P2 | API |
| TC-BQMS-182 | Ảnh RFQ (rfq/image endpoint) | Đơn lẻ | staff | RFQ có ảnh riêng | `GET /rfq/image` | Trả đúng ảnh gắn với RFQ đó | P3 | API |
| TC-BQMS-183 | Tìm kiếm giá toàn cục theo mã BQMS (price_lookup) | Đơn lẻ | staff | Mã có lịch sử giá nhiều kỳ | `GET /search/global`, `GET /search`, `GET /{bqms_code}` | Trả đúng lịch sử giá theo mã, sắp xếp theo thời gian | P2 | API |

### Khối R — Rate-limit (chạy riêng, cách ly, có sleep 60s reset)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-184 | Tổng hợp rate-limit toàn mảng BQMS chạy tuần tự cách ly | Kết hợp | staff/admin | Chạy sau khi mọi ca khác đã xong, không xen giữa | Chạy lần lượt TC-084 (push đơn 5/phút), TC-099 (batch 3/phút), TC-109 (quote-batch 10/phút), mỗi khối cách nhau `sleep 60s` | Mỗi khối trả đúng 429 ở request vượt ngưỡng, KHÔNG ảnh hưởng chéo giữa 3 loại rate-limit (dùng bucket riêng theo endpoint) | P1 | API |

### Khối P — Flag `bqms_edit_enabled` 2 chiều (ON/OFF cùng phiên, teardown bắt buộc)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-185 | Flag OFF — mọi endpoint mutate BQMS trả 403 | Permission/Flag | admin (set flag) + staff (thao tác) | `app_config.bqms_edit_enabled` set false qua admin | Thử lần lượt: PATCH price, PATCH classification, PATCH result, skip, push-to-sec, vendor-staging quote/decide | TẤT CẢ → HTTP 403 (`_assert_bqms_edit_enabled`, bqms.py:47) | P1 | API |
| TC-BQMS-186 | Flag bật lại ON — hoạt động bình thường + teardown xác nhận | Permission/Flag | admin | Tiếp TC-185 | Set flag lại true, lặp lại các thao tác ở TC-185 | Tất cả trả về 200 như trước; kết thúc phiên xác nhận flag trong DB = giá trị gốc trước khi bắt đầu suite (không để lệch prod) | P1 | API |

---

## Map feature → ca (chứng minh phủ 100% kiểm kê F-BQMS-01..106)

| Feature | Ca kiểm chứng |
|---|---|
| F-BQMS-01 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007 |
| F-BQMS-02 | TC-023 |
| F-BQMS-03 | TC-023 |
| F-BQMS-04 | TC-024 |
| F-BQMS-05 | TC-025, TC-026 |
| F-BQMS-06 | TC-027 |
| F-BQMS-07 | TC-028 |
| F-BQMS-08 | TC-029 |
| F-BQMS-09 | TC-030, TC-031 |
| F-BQMS-10 | TC-032 |
| F-BQMS-11 | TC-033, TC-034, TC-023 |
| F-BQMS-12 | TC-035 |
| F-BQMS-13 | TC-036 |
| F-BQMS-14 | TC-037 |
| F-BQMS-15 | TC-038 |
| F-BQMS-16 | TC-039, TC-040, TC-041, TC-042 |
| F-BQMS-17 | TC-043, TC-044 |
| F-BQMS-18 | TC-045, TC-046 |
| F-BQMS-19 | TC-047 |
| F-BQMS-20 | TC-048 |
| F-BQMS-21 | TC-049 |
| F-BQMS-22 | TC-050 |
| F-BQMS-23 | TC-051, TC-052, TC-053 |
| F-BQMS-24 | TC-054 |
| F-BQMS-25 | TC-055 |
| F-BQMS-26 | TC-056 |
| F-BQMS-27 | TC-059, TC-060, TC-061 |
| F-BQMS-28 | TC-057, TC-058 |
| F-BQMS-29 | TC-062 |
| F-BQMS-30 | TC-057 |
| F-BQMS-31 | TC-061 |
| F-BQMS-32 | TC-065, TC-066, TC-067, TC-068 |
| F-BQMS-33 | TC-069 |
| F-BQMS-34 | TC-070 |
| F-BQMS-35 | TC-063 |
| F-BQMS-36 | TC-064 |
| F-BQMS-37 | TC-154, TC-156 |
| F-BQMS-38 | TC-155 |
| F-BQMS-39 | TC-157 |
| F-BQMS-40 | TC-158 |
| F-BQMS-41 | TC-159 |
| F-BQMS-42 | TC-160 |
| F-BQMS-43 | TC-161 |
| F-BQMS-44 | TC-162 |
| F-BQMS-45 | TC-163 |
| F-BQMS-46 | TC-164 |
| F-BQMS-47 | TC-165 |
| F-BQMS-48 | TC-162 |
| F-BQMS-49 | TC-166 |
| F-BQMS-50 | TC-167 |
| F-BQMS-51 | TC-168 |
| F-BQMS-52 | TC-169 |
| F-BQMS-53 | TC-170 |
| F-BQMS-54 | TC-150 |
| F-BQMS-55 | TC-151 |
| F-BQMS-56 | TC-153 |
| F-BQMS-57 | TC-152 |
| F-BQMS-58 | TC-145 |
| F-BQMS-59 | TC-146 |
| F-BQMS-60 | TC-134 |
| F-BQMS-61 | TC-135 |
| F-BQMS-62 | TC-136 |
| F-BQMS-63 | TC-137 |
| F-BQMS-64 | TC-138 |
| F-BQMS-65 | TC-139 |
| F-BQMS-66 | TC-073, TC-074, TC-075, TC-076, TC-077, TC-078, TC-079, TC-080, TC-081, TC-082, TC-083, TC-084 |
| F-BQMS-67 | TC-094, TC-095, TC-096, TC-097, TC-098, TC-099, TC-100 |
| F-BQMS-68 | TC-086, TC-087, TC-088 |
| F-BQMS-69 | TC-089 |
| F-BQMS-70 | TC-090 |
| F-BQMS-71 | TC-091 |
| F-BQMS-72 | TC-092 |
| F-BQMS-73 | TC-093 |
| F-BQMS-74 | TC-103, TC-104, TC-105 |
| F-BQMS-75 | TC-106, TC-107 |
| F-BQMS-76 | TC-108, TC-109 |
| F-BQMS-77 | TC-110, TC-111 |
| F-BQMS-78 | TC-112 |
| F-BQMS-79 | TC-113 |
| F-BQMS-80 | TC-008, TC-009, TC-010 |
| F-BQMS-81 | TC-011, TC-012 |
| F-BQMS-82 | TC-013, TC-014, TC-015 |
| F-BQMS-83 | TC-016 |
| F-BQMS-84 | TC-017 |
| F-BQMS-85 | TC-018, TC-019 |
| F-BQMS-86 | TC-020 |
| F-BQMS-87 | TC-021 |
| F-BQMS-88 | TC-140 |
| F-BQMS-89 | TC-141 |
| F-BQMS-90 | TC-142 |
| F-BQMS-91 | TC-143 |
| F-BQMS-92 | TC-115, TC-116 |
| F-BQMS-93 | TC-117, TC-118, TC-119 |
| F-BQMS-94 | TC-131 |
| F-BQMS-95 | TC-120, TC-121, TC-122, TC-123, TC-124, TC-125, TC-126, TC-127 |
| F-BQMS-96 | TC-128 |
| F-BQMS-97 | TC-144 |
| F-BQMS-98 | TC-171, TC-172, TC-173, TC-174, TC-175, TC-176, TC-177 |
| F-BQMS-99 | TC-178 |
| F-BQMS-100 | TC-179, TC-180, TC-181 |
| F-BQMS-101 | TC-182 |
| F-BQMS-102 | TC-132 |
| F-BQMS-103 | TC-133 |
| F-BQMS-104 | TC-187, TC-188 (dùng chung PushToBiddingModal — đã có 8 ca ở bộ 118 ca đấu thầu tại `<workspace>/plans/bidding-e2e-test-plan/` TC-IND/TC-CMB liên quan source='bqms'; TC-187/188 chỉ bổ sung riêng phần entry-point + luồng đầy đủ từ trang BQMS — xem ghi chú dưới) |
| F-BQMS-105 | TC-183 |
| F-BQMS-106 | TC-114, TC-185, TC-186 |

**Ghi chú F-BQMS-104**: nút "Push sang Đấu thầu NCC nội bộ" trên trang BQMS dùng chung component `PushToBiddingModal` đã có ca ở bộ 118 ca đấu thầu (`<workspace>/plans/bidding-e2e-test-plan/` — chú ý: ở gốc workspace, NGOÀI songchau-erp/) qua `TC-IND`/`TC-CMB` với `source='bqms'` — không viết lại theo nguyên tắc KHÔNG TRÙNG. Bổ sung ca xác nhận entry-point đúng từ trang BQMS kèm nhánh positive đầy đủ (batch source_kind='bqms', dedup twin-defense, không rò notes):

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-BQMS-187 | Mở PushToBiddingModal từ trang BQMS — payload nguồn đúng source='bqms' | Đơn lẻ | sales | 1 mã BQMS đủ điều kiện push sang đấu thầu | Trên `/bqms`, chọn mã, bấm "Đẩy sang Đấu thầu NCC" | Modal mở đúng, payload gửi đi có `source_kind='bqms'`, `notes` KHÔNG lộ số RFQ khách (memo IMV→Bidding anti-leak áp dụng chung) | P2 | UI |
| TC-BQMS-188 | Push multi-select N mã BQMS đang-mở → tạo batch source_kind='bqms' — luồng đầy đủ (positive, dedup + anti-leak, đọc code xác nhận) | Luồng | sales/admin | ≥N mã BQMS đang-mở (result chưa closed) đủ điều kiện, trong đó có ≥1 mã có twin etl+onedrive_sync trùng (rfq_number,bqms_code) | 1. Trên `/bqms`, multi-select N mã (tick nhiều dòng, đã lọc chỉ mã đang-mở). 2. Bấm "Đẩy sang Đấu thầu NCC" → PushToBiddingModal → chọn mode Tạo mới, nhập title+deadline → xác nhận. BE: `POST /batches/{batch_id}/import-from-bqms` (`procurement.py:1834`, hàm `import_items_from_bqms`) body `{"rfq_ids":[...]}` hoặc `{"bqms_codes":[...]}`. 3. Kiểm tra batch xuất hiện ở `/vendor-bidding`. 4. Đọc chi tiết batch/items vừa tạo. 5. Lặp lại bước 2 với ĐÚNG N mã cũ (không đổi mã) | Bước 2: HTTP 200, batch tạo/cập nhật với `source_kind='bqms'`. Bước 3: batch hiện đúng trong danh sách `/vendor-bidding`. Bước 4: `notes=None` cho mọi item (`procurement.py:1970-1974` — cột `notes` là vendor-visible nên KHÔNG được ghi rfq_number Samsung; nguồn gốc chỉ lưu `source_bqms_rfq_id`/`source_bqms_rfq_number`, cả hai admin-only, không lộ ra vendor-facing serializer); `items` đúng N dòng — mã có twin etl+onedrive_sync CHỈ xuất hiện ĐÚNG 1 lần (CTE `bqms_dedup`, `procurement.py:1884-1896`, `DISTINCT ON (rfq_number,bqms_code)` ưu tiên `quote_unlocked` DESC rồi `bqms_push_status` DESC — bất kể caller gửi id nào). Bước 5 (chạy lại): KHÔNG tạo item trùng — response báo đủ N mã vào `skipped_duplicates` (idempotency check tại `_insert_rfq_items`, dòng 778-794: `SELECT 1 FROM procurement_rfq_items WHERE batch_id=$1 AND (item_code=$2 OR bqms_code=$2)`), số dòng `procurement_rfq_items` của batch KHÔNG tăng thêm | P1 | API+UI |

---

**Tổng số ca trong file này: 188** (TC-BQMS-001 → TC-BQMS-188), gồm 4 nhóm phân lớp thực thi:
- [AUTO-API] đa số các ca API — chạy CI/pytest tới ranh giới defer job.
- [SEMI-UI] các ca chạm push preview không bấm gửi (TC-073, TC-077, phần đầu TC-081/082/083 trước khi xác nhận cuối).
- [MANUAL-SAMSUNG ⚠️] chỉ 2 ca (TC-101, TC-102) — Thang chạy tay có giám sát, 1 RFQ hy sinh, ngoài giờ SEC.
- Còn lại là UI/kết hợp API+UI chạy Playwright đợt sau.

Ưu tiên: P1 = 70 ca (chặn phát hành/an toàn Samsung/bảo mật), P2 = 84 ca, P3 = 34 ca.
Tự động hoá: API-only = 132 ca, API+UI kết hợp = 12 ca, UI-only = 39 ca, Tay (MANUAL-SAMSUNG) = 2 ca.
