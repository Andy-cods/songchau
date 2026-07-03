# Test case E2E — Tài chính — AR/AP/Hoá đơn/Thanh toán

Nguồn kiểm kê: 6 file backend `finance.py` (724 dòng), `finance_management.py` (784 dòng),
`invoice_management.py` (657 dòng), `quarterly_invoices.py` (519 dòng), `payment_requests.py`
(773 dòng), `finance_reports.py` (674 dòng) + 8 trang FE `frontend/src/app/(dashboard)/finance/**`
+ `frontend/src/components/payment-approvals/PaymentApprovalDrawer.tsx` +
`frontend/src/app/(dashboard)/approvals/page.tsx` (workflow chung, loại `payment_approval`).

Không tìm thấy bộ test tự động (pytest/Playwright) nào khớp riêng cho mảng này. Bộ 118 ca
đấu thầu (`<workspace>/plans/bidding-e2e-test-plan/` — chú ý: ở gốc workspace, NGOÀI songchau-erp/)
và 122 ca price-intelligence (`songchau-erp/plans/price-intelligence/E2E_TEST_PLAN.md`) không phủ
Finance — bộ này viết mới hoàn toàn, đánh số nối tiếp riêng `TC-TAICHINH-###`.

## Dữ liệu chuẩn bị chung

### Tài khoản test cố định (KHÔNG dùng account thật của Thang)
`test_admin@songchau.test`, `test_manager@songchau.test`, `test_accountant@songchau.test`,
`test_sales@songchau.test`, `test_procurement@songchau.test`, `test_staff@songchau.test`,
`test_warehouse@songchau.test`, `test_viewer@songchau.test`, `test_director@songchau.test`
— mật khẩu theo password policy Đợt A. `accountant/manager/admin` là 3 role được phép hầu hết
API tài chính; `sales/procurement/staff` chỉ tự xem PR của chính mình (auto-filter
`requester_id`); `viewer` xem-only mọi nơi có quyền; `warehouse`/`director` dùng cho ca 403 liền kề.

### Bản ghi mồi (seed 1 lần, prefix `DEMO-`/`TEST-`, dọn bằng glob theo prefix ở teardown)
- **AP/AR**: mỗi hệ (`finance.py` và `finance_management.py`) × 2 nguồn (đấu thầu/thủ công) ×
  2 tiền tệ (VND, USD) × 3 tình trạng (đúng hạn, quá hạn 15 ngày, quá hạn 65 ngày) — phủ đủ
  4-bucket (`finance.py`) lẫn 5-bucket (`finance_management.py`) aging.
- **SO/Invoice**: 1 sourcing_order `status=delivered` CHƯA có invoice active (mồi
  `/invoices/auto-generate` thành công) + 1 SO đã có invoice `active` sẵn (mồi 409 duplicate)
  + 1 SO `status=confirmed` (mồi 400 "chưa đủ điều kiện").
- **Payment Request**: 1 PR `draft`, 1 PR `pending`, 1 PR `approved`, 1 PR `rejected`, 1 PR `paid`
  — mỗi PR gắn 1 sourcing_order riêng để không đụng state machine lẫn nhau.
- **Exchange rate**: `exchange_rates` có USD→VND thật (đã có prod) dùng cho ca so khớp; 1 ca xoá
  tạm rate trong transaction rollback để bắt fallback `25450` (deal_chain.py:317).
- **Quarterly invoices**: ≥3 dòng `sales_invoices_q` và ≥3 dòng `purchase_invoices_q` quý hiện
  tại (Q3-2026), trong đó có 1 dòng ID trùng số ID bên bảng kia (bẫy bug `update_sale` đọc nhầm
  bảng) và có 1 dòng ID KHÔNG trùng ID nào bên purchase (ca baseline không bị bug).
- **File PDF** để test upload bảng kê: `tests/fixtures/files/hoadon_mau.pdf` (parse được 1 phần),
  `tests/fixtures/files/khong-phai-pdf.exe` đổi content-type thành `application/pdf` (magic-byte),
  1 file 0 byte, 1 file 11MB (vượt hạn mức 10MB).

### Ranh giới an toàn — KHÔNG đụng Samsung/Graph thật
- Mọi ca gửi hoá đơn qua Microsoft Graph (`POST /invoices/{id}/send`) chạy trên môi trường
  M365 env TRỐNG như prod hiện tại → kỳ vọng **502** (best-effort), KHÔNG kỳ vọng gửi thành công.
  Không tự ý cấu hình `GRAPH_API_ACCESS_TOKEN` để "cho pass" — đó là hành vi đúng của prod.
- Mọi ca chạm prod thật (không phải staging) dùng pattern **rollback-txn**: mở transaction gọi
  thẳng hàm/endpoint deployed rồi rollback, xác nhận sau khi rollback KHÔNG còn dữ liệu rác
  (đối chiếu bằng `SELECT` trước/sau).
- Ca liên quan `PHASE3_AUTO_AR_ENABLED` (mặc định OFF theo memory) chạy CẢ 2 chiều (OFF hiện tại
  + ON giả lập trên staging) và teardown phải trả flag về giá trị gốc.
- Không có lớp MANUAL-SAMSUNG trong mảng Tài chính (không chạm BQMS) — chỉ có 2 lớp: **API**
  (pytest gọi thẳng REST) và **UI** (Playwright/tay qua trang `/finance/**`).

## Bảng test case

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-TAICHINH-001 | Trang Tổng hợp tài chính load đủ 6 KPI | Đơn lẻ | accountant | Đăng nhập `test_accountant`, có dữ liệu AP/AR/cash-book mồi | 1. Mở `/finance/overview`. 2. Quan sát 6 ô KPI đầu trang (Công nợ thu, Công nợ trả, Quá hạn thu, Quá hạn trả, Tiền mặt+NH, Dòng tiền kỳ này) | Cả 6 ô có số (không "—"), số Công nợ thu = tổng `ar-summary.overview`, số Công nợ trả = tổng `ap-summary.overview` | P1 | API+UI |
| TC-TAICHINH-002 | Nút "Tải lại" refetch song song 5 query | Đơn lẻ | accountant | Đang mở `/finance/overview` | 1. Sửa 1 bản ghi cash-book qua API (giả lập thay đổi ngầm). 2. Bấm nút "Tải lại". 3. Quan sát số Tiền mặt+NH | Toàn bộ 5 query (dashboard/ap-summary/ar-summary/cash-flow/cash-book) refetch lại, số cập nhật đúng bản ghi mới, không cần F5 trang | P2 | UI |
| TC-TAICHINH-003 | Bảng Tuổi nợ (aging) 4 bucket AR/AP hiển thị progressbar đúng % | Đơn lẻ | accountant | Seed AR/AP có bản ghi ở đủ 4 bucket (current/1-30/31-60/60+) | 1. Mở `/finance/overview`. 2. Cuộn tới bảng "Tuổi nợ". 3. Đọc `aria-valuetext` từng progressbar (role=progressbar) | Mỗi bucket hiện đúng số tiền + % đúng công thức (bucket/tổng); tổng 4 bucket = tổng AR (hoặc AP) overview | P2 | API+UI |
| TC-TAICHINH-004 | Bảng Công nợ phải thu/trả — Empty state khi chưa có dữ liệu | Negative | accountant | Company demo mới, chưa có AR/AP nào | 1. Mở `/finance/overview` với company chưa seed dữ liệu | Bảng hiện thông báo rỗng phù hợp (không lỗi trắng trang), Loading skeleton hiện trước khi data về | P2 | UI |
| TC-TAICHINH-005 | Bảng Công nợ — badge quá hạn theo `days_overdue` | Đơn lẻ | accountant | 1 AR quá hạn 65 ngày trong seed | 1. Mở `/finance/overview`, tìm dòng AR quá hạn 65 ngày trong bảng top items | Badge "Quá hạn" hiện đúng màu cảnh báo, số ngày quá hạn khớp `days_overdue` tính từ `due_date` | P2 | UI |
| TC-TAICHINH-006 | Bảng Sổ quỹ gần đây — running balance đúng thứ tự thời gian | Đơn lẻ | accountant | ≥3 bút toán cash-book liên tiếp | 1. Mở `/finance/overview`, xem bảng "Sổ quỹ gần đây" | Icon thu/chi đúng chiều `direction`, số dư chạy (running balance) tăng/giảm đúng thứ tự ngày, dòng mới nhất trên cùng | P2 | UI |
| TC-TAICHINH-007 | Modal "Ghi sổ quỹ" — validate FE trống mô tả/số tiền | Negative | accountant | Đang mở `/finance/overview` | 1. Bấm nút mở modal "Ghi sổ quỹ". 2. Để trống Mô tả và Số tiền. 3. Bấm nút Lưu | Toast lỗi "Vui lòng nhập mô tả và số tiền", modal KHÔNG đóng, không gọi POST | P1 | UI |
| TC-TAICHINH-008 | Modal "Ghi sổ quỹ" — tạo bút toán Thu thành công | Luồng | accountant | — | 1. Mở modal, chọn radio "Thu". 2. Chọn ngày hôm nay. 3. Chọn danh mục (1 trong 6 loại). 4. Nhập Mô tả "TEST thu tiền demo". 5. Nhập Số tiền 1000000, tiền tệ VND. 6. Bấm Lưu | `POST /finance-management/cash-book` 200, toast thành công, modal đóng, dòng mới xuất hiện đầu bảng Sổ quỹ với running balance +1,000,000 | P1 | API+UI |
| TC-TAICHINH-009 | Modal "Ghi sổ quỹ" — focus trap + ESC đóng modal | Đơn lẻ | accountant | Đang mở modal | 1. Mở modal. 2. Nhấn Tab liên tục — focus không thoát khỏi modal. 3. Nhấn ESC | Modal đóng khi ESC, focus quay lại nút đã mở modal, radio đầu tiên tự động focus khi mở modal | P3 | UI |
| TC-TAICHINH-010 | `POST /finance-management/cash-book` — validate `ref_type` ngoài whitelist | Negative | accountant | — | 1. Gọi API trực tiếp với `ref_type="invalid_type"` | HTTP 400, thông báo lỗi liệt kê giá trị hợp lệ {ap,ar,po,invoice,null} | P2 | API |
| TC-TAICHINH-011 | `POST /finance-management/cash-book` — amount<=0 bị chặn | Negative | accountant | — | 1. Gọi API với `amount=0` | HTTP 422 (Field gt=0 validation) | P1 | API |
| TC-TAICHINH-012 | `GET /finance-management/dashboard` — số liệu khớp cash balance + AP/AR outstanding | Đơn lẻ | manager | Dữ liệu mồi AP/AR | 1. Gọi `GET /finance-management/dashboard` | Response có `cash_balance`, `ap_outstanding`, `ar_outstanding`, `overdue`, P&L tháng hiện tại vs tháng trước, thu/chi 7 ngày, top 10 công nợ sắp đến hạn 7 ngày | P2 | API |
| TC-TAICHINH-013 | Auto-refresh 30 giây trang Overview | Đơn lẻ | accountant | Đang mở `/finance/overview`, network tab mở | 1. Mở trang, không thao tác gì. 2. Đợi 31 giây, quan sát network | Có đợt gọi lại đủ 5 query tại giây ~30 mà không cần thao tác tay | P3 | UI |
| TC-TAICHINH-014 | Xử lý dual-shape response `{data:{...}}` vs flat | Đơn lẻ | accountant | Giả lập BE trả 2 shape khác nhau (mock) | 1. Mock API trả `{data:{...}}`. 2. Mock API trả object phẳng. 3. So sánh hiển thị KPI cả 2 lần | Cả 2 shape đều hiển thị đúng số, không có field "undefined"/NaN | P3 | API |
| TC-TAICHINH-015 | Trang Công nợ phải thu — 3 SummaryCard đúng số | Đơn lẻ | accountant | Seed ≥3 AR khác khách hàng | 1. Mở `/finance/receivables` | Card "Tổng phải thu" = tổng amount-paid_amount còn lại, "Quá hạn" = tổng AR overdue, "Số khách hàng" = số khách hàng distinct có AR | P1 | UI |
| TC-TAICHINH-016 | Bảng công nợ phải thu — highlight hàng quá hạn | Đơn lẻ | accountant | 1 AR quá hạn trong seed | 1. Mở `/finance/receivables`, tìm hàng AR quá hạn | Hàng có class highlight cảnh báo (nền đỏ/vàng), cột Trạng thái hiện đúng | P2 | UI |
| TC-TAICHINH-017 | Nút "Ghi nhận thu tiền" mở form inline theo hàng | Đơn lẻ | accountant | 1 AR status=pending | 1. Mở `/finance/receivables`. 2. Bấm "Ghi nhận thu tiền" ở 1 hàng. 3. Bấm lại nút đó lần 2 | Form mở dưới đúng hàng đã bấm (toggle theo index); bấm lần 2 đóng form; các hàng khác không bị ảnh hưởng | P2 | UI |
| TC-TAICHINH-018 | Form Ghi nhận thu tiền — mặc định ngày hôm nay + số tiền = còn lại | Đơn lẻ | accountant | AR `amount=10,000,000`, `paid_amount=3,000,000` | 1. Bấm "Ghi nhận thu tiền" ở hàng AR trên | Trường ngày mặc định = hôm nay, trường số tiền mặc định = 7,000,000 (amount-paid_amount) | P2 | UI |
| TC-TAICHINH-019 | Form Ghi nhận thu tiền — validate FE amount<=0 | Negative | accountant | Form đang mở | 1. Sửa Số tiền = 0. 2. Bấm Lưu/Xác nhận | Toast lỗi FE, không gọi API, form không đóng | P1 | UI |
| TC-TAICHINH-020 | `POST /finance-management/record-receipt` — thu đúng số dư còn lại → status=paid | Luồng | accountant | AR `amount=7,000,000`, `paid_amount=0` | 1. Gọi API với `amount=7,000,000` | HTTP 200, AR status chuyển `pending`→`paid`, tạo dòng `cash_book` `direction='in'` đúng số tiền | P1 | API |
| TC-TAICHINH-021 | `POST /finance-management/record-receipt` — thu 1 phần → status=partial_paid | Luồng | accountant | AR `amount=7,000,000`, `paid_amount=0` | 1. Gọi API với `amount=3,000,000` | HTTP 200, status → `partial_paid`, `paid_amount`=3,000,000 | P1 | API |
| TC-TAICHINH-022 | `POST /finance-management/record-receipt` — vượt số còn lại bị chặn | Negative | accountant | AR còn lại 2,000,000 | 1. Gọi API `amount=5,000,000` | HTTP 400 (vượt remaining ngoài tolerance 0.01) | P1 | API |
| TC-TAICHINH-023 | `POST /finance-management/record-receipt` — AR không tồn tại | Negative | accountant | ar_id giả `99999999` | 1. Gọi API với id không tồn tại | HTTP 404 | P2 | API |
| TC-TAICHINH-024 | `POST /finance-management/record-receipt` — AR đã paid bị chặn ghi thêm | Negative | accountant | AR status=paid | 1. Gọi API record-receipt trên AR đã paid | HTTP 400 | P2 | API |
| TC-TAICHINH-025 | Ẩn nút "Ghi nhận thu tiền" khi AR đã paid | Đơn lẻ | accountant | AR status=paid trong danh sách | 1. Mở `/finance/receivables`, tìm hàng AR paid | Nút "Ghi nhận thu tiền" KHÔNG hiển thị ở hàng đó | P2 | UI |
| TC-TAICHINH-026 | Trang Công nợ phải thu — Empty state + skeleton loading | Đơn lẻ | accountant | Company chưa có AR | 1. Mở `/finance/receivables` với company rỗng | Hiện "Không có công nợ nào"; skeleton hiện trước khi data về (throttle network để quan sát) | P2 | UI |
| TC-TAICHINH-027 | Trang Công nợ phải trả — Summary theo TỪNG currency, KHÔNG cộng gộp | Đa tiền tệ | accountant | Seed AP 1 VND + 1 USD | 1. Mở `/finance/payables`. 2. Đọc 2 khối summary theo currency | Có 2 khối riêng VND và USD, mỗi khối đủ 6 stat (Tổng phải trả/Quá hạn/Hiện tại/1-30/31-60/60+); KHÔNG có con số gộp VND+USD ở đâu trên trang | P1 | API+UI |
| TC-TAICHINH-028 | Filter Nguồn Tất cả/Đấu thầu/Thủ công | Đơn lẻ | accountant | Seed AP có cả nguồn đấu thầu và thủ công | 1. Mở `/finance/payables`. 2. Chọn filter "Đấu thầu". 3. Chọn "Thủ công". 4. Chọn "Tất cả" | Danh sách lọc đúng theo `rowSource` từng lần chọn, tổng số dòng hiển thị khớp | P2 | UI |
| TC-TAICHINH-029 | Badge Nguồn suy luận đúng khi `source` null | Đơn lẻ | accountant | 1 AP có `source=null` nhưng có PO/delivery linkage | 1. Mở `/finance/payables`, quan sát badge Nguồn của dòng đó | Badge tự suy luận "Đấu thầu" (brand pill) dựa trên linkage PO/delivery, không hiện "Thủ công" sai | P2 | UI |
| TC-TAICHINH-030 | StatusPill 5 trạng thái + override overdue theo `due_date` | Đơn lẻ | accountant | 1 AP `status=pending` nhưng `due_date` đã qua | 1. Mở `/finance/payables`, tìm dòng AP đó | StatusPill hiện "Quá hạn" (override) dù DB status vẫn `pending` — vì FE tính lại từ `due_date` | P2 | UI |
| TC-TAICHINH-031 | `GET /finance/payables` — filter kết hợp supplier_id+status+source+overdue+date range | Đơn lẻ | accountant | Seed đa dạng | 1. Gọi API với đủ query param kết hợp | HTTP 200, kết quả đúng giao của mọi điều kiện lọc, `pagination limit<=200` | P2 | API |
| TC-TAICHINH-032 | `GET /finance/payables` — limit>200 bị chặn 422 (đọc code xác nhận) | Negative | accountant | — | 1. Gọi API `limit=500` | HTTP **422** (`finance.py:88` khai báo `limit: int = Query(50, ge=1, le=200)` — Pydantic/FastAPI từ chối cứng, KHÔNG có nhánh ép trần/clamp nào). Trần hợp lệ = **200**. | P3 | API |
| TC-TAICHINH-033 | `GET /finance/payables/summary` — aging 4-bucket theo currency, không cross-sum | Đa tiền tệ | accountant | AP VND+USD ở đủ 4 bucket | 1. Gọi API summary | Mỗi currency có object aging riêng 4 bucket, field tổng KHÔNG gộp 2 currency | P1 | API |
| TC-TAICHINH-034 | Nút "Làm mới" trang Payables refetch summary+list | Đơn lẻ | accountant | — | 1. Mở `/finance/payables`. 2. Sửa 1 AP qua API ngầm. 3. Bấm "Làm mới" | Summary và danh sách cập nhật đúng bản ghi mới không cần F5 | P3 | UI |
| TC-TAICHINH-035 | Cột PO/Phiếu giao hiển thị đúng nguồn (po_no/PO-{id}/invoice_number) | Đơn lẻ | accountant | 3 AP: 1 có po_no, 1 chỉ có id, 1 từ invoice | 1. Mở `/finance/payables`, đọc cột "PO/Phiếu giao" từng dòng | Hiện đúng `po_no` nếu có, else `PO-{id}`, else `invoice_number` tuỳ nguồn dữ liệu | P3 | UI |
| TC-TAICHINH-036 | Error state trang Payables + nút "Thử lại" | Negative | accountant | Giả lập API list lỗi (mock 500) | 1. Mở `/finance/payables` khi API lỗi | Hiện error state với nút "Thử lại"; bấm nút gọi lại API | P2 | UI |
| TC-TAICHINH-037 | `POST /finance/payables` — validate amount<=0 | Negative | accountant | — | 1. Gọi API `amount=-100` | HTTP 400 | P1 | API |
| TC-TAICHINH-038 | `POST /finance/payables` — due_date < invoice_date bị chặn | Negative | accountant | — | 1. Gọi API `invoice_date=2026-07-10`, `due_date=2026-07-01` | HTTP 400 | P1 | API |
| TC-TAICHINH-039 | `POST /finance/payables` — tạo AP thủ công hợp lệ | Luồng | accountant | — | 1. Gọi API amount=5,000,000 VND, due_date hợp lệ | HTTP 201/200, AP mới `status=pending`, xuất hiện trên `/finance/payables` với badge "Thủ công" | P1 | API |
| TC-TAICHINH-040 | `POST /finance/receivables` — validate amount<=0 và due_date<invoice_date | Negative | accountant | — | 1. Gọi API amount=0. 2. Gọi API due_date<invoice_date | Cả 2 lần đều 400 | P2 | API |
| TC-TAICHINH-041 | `POST /finance/payments` — outbound thiếu `ap_id` bị chặn | Negative | accountant | — | 1. Gọi API `direction=outbound` không kèm `ap_id` | HTTP 400 | P1 | API |
| TC-TAICHINH-042 | `POST /finance/payments` — inbound thiếu `ar_id` bị chặn | Negative | accountant | — | 1. Gọi API `direction=inbound` không kèm `ar_id` | HTTP 400 | P1 | API |
| TC-TAICHINH-043 | `POST /finance/payments` — outbound hợp lệ, cập nhật AP atomic | Luồng | accountant | AP còn lại 5,000,000 | 1. Gọi API `direction=outbound`, `ap_id`, `amount=5,000,000` | HTTP 200, AP `status→paid`, `paid_amount` cập nhật atomic trong 1 transaction | P1 | API |
| TC-TAICHINH-044 | `GET /finance/payments` — filter direction + date range, join tên NCC/KH | Đơn lẻ | accountant | ≥2 payment record | 1. Gọi API `direction=outbound&date_from=&date_to=` | HTTP 200, mỗi dòng có `supplier_name`/`customer_name` join sẵn | P2 | API |
| TC-TAICHINH-045 | `POST /finance/cash-book` (hệ finance.py) — direction phải in {thu,chi} | Negative | accountant | — | 1. Gọi API `direction="income"` (sai enum của hệ này) | HTTP 400/422 vì enum hệ finance.py là {thu,chi} khác hệ finance_management.py | P2 | API |
| TC-TAICHINH-046 | `POST /finance/cash-book` — description < 3 ký tự bị chặn | Negative | accountant | — | 1. Gọi API `description="ab"` | HTTP 400 | P2 | API |
| TC-TAICHINH-047 | `POST /finance/cash-book` — running balance tính theo company_id | Đơn lẻ | accountant | 2 company khác nhau có cash-book riêng | 1. Tạo bút toán ở company A. 2. Tạo bút toán ở company B | Running balance của A không bị ảnh hưởng bởi bút toán của B (tính riêng theo `company_id`) | P2 | API |
| TC-TAICHINH-048 | `GET /finance/summary` — tổng hợp AP/AR outstanding+overdue+cash+thu chi tháng | Đơn lẻ | manager | Dữ liệu mồi đủ | 1. Gọi API | HTTP 200, response có đủ field AP/AR outstanding, overdue, cash balance, thu/chi tháng hiện tại | P2 | API |
| TC-TAICHINH-049 | 2 hệ AP/AR song song (finance.py vs finance_management.py) — đối chiếu lệch pha | Kết hợp | accountant | Cùng seed dữ liệu | 1. Gọi `GET /finance/payables/summary`. 2. Gọi `GET /finance-management/ap-summary`. 3. So tổng 2 kết quả (theo từng currency, không cộng gộp) | Kỳ vọng xác định: **2 số PHẢI khớp 100%** (cùng tổng, cùng từng bucket aging, theo từng currency riêng biệt). **PASS** nếu khớp tuyệt đối; **FAIL** nếu lệch dù chỉ 1 đồng — lệch chính là bằng chứng bug W1-50 còn sống (đây là lý do W1-50 yêu cầu hợp nhất 2 hệ thành 1 API duy nhất; không coi kết quả lệch là "chấp nhận được" hay false-positive). | P1 | API |
| TC-TAICHINH-050 | Trang Hóa đơn — KPI strip 3 ô đúng số | Đơn lẻ | staff | Seed invoice đủ trạng thái | 1. Mở `/finance/invoices` | 3 ô "Công nợ chưa thu"/"Hóa đơn quá hạn"/"Doanh thu tháng này" có số đúng | P1 | UI |
| TC-TAICHINH-051 | Filter trạng thái hóa đơn (7 pill: all/draft/sent/partial/paid/overdue/cancelled) | Đơn lẻ | staff | Invoice đủ 6 trạng thái | 1. Mở `/finance/invoices`. 2. Bấm lần lượt từng pill trạng thái | Danh sách lọc đúng theo từng trạng thái, pill active có style riêng | P2 | UI |
| TC-TAICHINH-052 | Search hóa đơn theo số HĐ / tên KH (client-side, deferred) | Đơn lẻ | staff | ≥5 invoice | 1. Gõ số HĐ vào ô tìm kiếm. 2. Xoá, gõ tên KH | Danh sách lọc đúng theo cả 2 kiểu tìm, không giật lag (useDeferredValue) | P3 | UI |
| TC-TAICHINH-053 | Click hàng hóa đơn mở chi tiết `/invoices/{id}` (hỗ trợ Enter/Space) | Đơn lẻ | staff | ≥1 invoice | 1. Click 1 hàng bảng hóa đơn. 2. Dùng Tab focus 1 hàng khác rồi nhấn Enter | Cả click chuột và Enter/Space đều điều hướng tới `/invoices/{id}` đúng | P3 | UI |
| TC-TAICHINH-054 | Override tone "danger" khi hóa đơn overdue bất kể status gốc | Đơn lẻ | staff | 1 invoice status=sent nhưng đã quá `due_date` | 1. Mở `/finance/invoices`, tìm hàng invoice trên | Badge tone hiện "danger" (đỏ) dù DB status vẫn `sent` | P2 | UI |
| TC-TAICHINH-055 | Nút "Tạo hóa đơn" điều hướng `/invoices/new` | Đơn lẻ | manager | — | 1. Bấm nút "Tạo hóa đơn" | Điều hướng đúng route `/invoices/new` | P3 | UI |
| TC-TAICHINH-056 | `POST /invoices/auto-generate` — SO chưa đủ điều kiện status bị chặn | Negative | manager | SO status=confirmed (mồi) | 1. Gọi API auto-generate với SO đó | HTTP 400 | P1 | API |
| TC-TAICHINH-057 | `POST /invoices/auto-generate` — SO đã có invoice active bị chặn duplicate | Negative | manager | SO đã có invoice active (mồi) | 1. Gọi API auto-generate với SO đó | HTTP 409 | P1 | API |
| TC-TAICHINH-058 | `POST /invoices/auto-generate` — SO 0 dòng bị chặn | Negative | manager | SO không có line item | 1. Gọi API auto-generate | HTTP 400 | P2 | API |
| TC-TAICHINH-059 | `POST /invoices/auto-generate` — luồng thành công đầy đủ | Luồng | manager | SO status=delivered, chưa có invoice, có ≥1 dòng | 1. Gọi API auto-generate | HTTP 200/201, tạo `invoice(status=draft)` + `invoice_items` + `accounts_receivable(status=pending)` (KHÔNG ghi `invoice_id` vì FK khác bảng — assert đúng field null này) + cập nhật `revenue_chain` + ghi `domain_event='invoice.created'`; số hóa đơn dạng `INV-YYYYMM-NNNNNN` | P1 | API |
| TC-TAICHINH-060 | Sinh số hóa đơn tự động — không trùng trong cùng tháng khi tạo liên tiếp | Đơn lẻ | manager | 2 SO đủ điều kiện | 1. Gọi auto-generate lần 1. 2. Gọi auto-generate lần 2 ngay sau | 2 invoice_number khác nhau, số sequence tăng đúng (`max sequence trong tháng + 1`) | P1 | API |
| TC-TAICHINH-061 | Idempotency — double-click "Tạo hóa đơn tự động" trên cùng SO | Kết hợp | manager | 1 SO đủ điều kiện | 1. Bắn 2 request `auto-generate` đồng thời trên cùng SO (asyncio.gather) | Chỉ 1 request tạo invoice thành công (200/201), request còn lại nhận 409 duplicate — không tạo 2 invoice cho cùng SO | P1 | API |
| TC-TAICHINH-062 | Job nền sinh PDF hóa đơn — lỗi Gotenberg không rollback invoice | Đơn lẻ | manager | Gotenberg tạm ngắt kết nối (giả lập) | 1. Gọi auto-generate khi Gotenberg lỗi | Invoice vẫn tạo thành công (200/201), lỗi PDF chỉ log, không rollback transaction chính | P2 | API |
| TC-TAICHINH-063 | `GET /invoices/overdue` — side-effect auto-update status→overdue trong GET | Đơn lẻ | staff | 1 invoice `status=sent` đã quá `due_date` chưa được set overdue | 1. Gọi `GET /invoices/overdue` | HTTP 200, invoice đó chuyển `status→'overdue'` NGAY trong lần gọi GET này (ghi nhận rõ đây là side-effect bất thường của GET, không phải bug nhưng cần biết khi viết test idempotent) | P2 | API |
| TC-TAICHINH-064 | `GET /invoices/{id}` — 404 khi không tồn tại | Negative | staff | id giả | 1. Gọi API với id không tồn tại | HTTP 404 | P2 | API |
| TC-TAICHINH-065 | `POST /invoices/{id}/send` — chặn invoice cancelled | Negative | manager | 1 invoice status=cancelled | 1. Gọi API send | HTTP 400 | P2 | API |
| TC-TAICHINH-066 | `POST /invoices/{id}/send` — M365 trống → 502 best-effort, KHÔNG đổi status | Negative | manager | invoice status=draft, GRAPH_API_ACCESS_TOKEN trống (như prod) | 1. Gọi API send | HTTP 502, `status` vẫn `draft` (không tự chuyển `sent` khi gửi thất bại) | P1 | API |
| TC-TAICHINH-067 | `POST /invoices/{id}/send` — thành công (nếu Graph có token ở staging) chuyển draft→sent + domain_event | Luồng | manager | Staging có Graph token hợp lệ (KHÔNG chạy trên prod) | 1. Gọi API send trên staging | HTTP 200, `status→sent`, `sent_at` ghi nhận, `domain_event='invoice.sent'` | P2 | API |
| TC-TAICHINH-068 | `POST /invoices/{id}/record-payment` — chặn cancelled/paid | Negative | manager | invoice status=paid | 1. Gọi API record-payment | HTTP 400 | P1 | API |
| TC-TAICHINH-069 | `POST /invoices/{id}/record-payment` — vượt tổng hóa đơn bị chặn | Negative | manager | invoice total=10,000,000, đã trả 0 | 1. Gọi API `amount=10,500,000` (vượt >0.1% tolerance) | HTTP 400 | P1 | API |
| TC-TAICHINH-070 | `POST /invoices/{id}/record-payment` — trả 1 phần, enum AR liên kết dùng `'partial'` khác AR gốc | Kết hợp | manager | invoice total=10,000,000 | 1. Gọi API `amount=4,000,000` | HTTP 200, `invoices.paid_amount=4,000,000`, `invoices.status='partial'`; AR liên kết cũng chuyển sang `'partial'` (LƯU Ý: khác giá trị `'partial_paid'` dùng ở AR gốc từ `finance.py`/`finance_management.py` — assert đúng chuỗi ký tự `'partial'` cho nhánh invoice này) | P1 | API |
| TC-TAICHINH-071 | `POST /invoices/{id}/record-payment` — trả đủ → paid + revenue_chain completed + domain_event | Luồng | manager | invoice total=10,000,000, đã trả 4,000,000 | 1. Gọi API `amount=6,000,000` | HTTP 200, `status→paid`, `revenue_chain.status→completed`, tạo `payment_transactions`, `domain_event='invoice.payment_received'` | P1 | API |
| TC-TAICHINH-072 | Pagination info trang Invoices — không có nút next/prev thật | Đơn lẻ | staff | >20 invoice | 1. Mở `/finance/invoices`, xem chữ "Hiển thị X/total, Trang Y/Z" | Đúng như thiết kế: chỉ hiện info, KHÔNG có nút điều hướng trang thật trên list (ghi nhận là hành vi hiện tại, không phải bug) | P3 | UI |
| TC-TAICHINH-073 | Trang Bảng kê hóa đơn theo quý — chọn quý + tab Bán ra/Mua vào | Đơn lẻ | accountant | Seed Q3-2026 sales+purchases | 1. Mở `/finance/quarterly-invoices`. 2. Chọn "Q3-2026". 3. Chuyển tab "Bán ra" rồi "Mua vào" | Dữ liệu đổi đúng theo quý chọn; 2 tab hiển thị đúng bảng riêng | P1 | UI |
| TC-TAICHINH-074 | Search hóa đơn quý theo số HĐ/đối tác/mặt hàng (server-side ILIKE) | Đơn lẻ | accountant | ≥3 dòng | 1. Gõ 1 phần tên đối tác vào ô tìm kiếm | Kết quả lọc đúng qua server (network request có query param), không phân biệt hoa/thường | P2 | UI |
| TC-TAICHINH-075 | Bảng Bán ra — 6 SummaryCard + "Lãi sau chi phí" tính client-side đúng công thức | Đơn lẻ | accountant | 1 dòng sales có `amount_before_tax=100,000,000` và 7 loại chi phí tổng 5,000,000 | 1. Mở tab Bán ra, đọc cột "Lãi sau CP" của dòng đó | `Lãi sau CP = amount_before_tax - tổng 7 loại chi phí = 95,000,000`, khớp tính tay | P2 | UI |
| TC-TAICHINH-076 | Bảng Mua vào — 5 SummaryCard đúng số | Đơn lẻ | accountant | Seed purchases | 1. Mở tab Mua vào | 5 card (Số HĐ/Chưa thuế/Thuế GTGT/Tổng có thuế/Chi phí cộng thêm) đúng tổng | P2 | UI |
| TC-TAICHINH-077 | Pagination 50 dòng/trang cho cả 2 bảng | Đơn lẻ | accountant | >50 dòng 1 bảng | 1. Mở tab có >50 dòng. 2. Bấm "Sau" | Trang 2 hiện đúng 50 dòng tiếp theo; bấm "Trước" quay lại đúng trang 1 | P3 | UI |
| TC-TAICHINH-078 | Nút Sửa (Pencil) mở modal chỉnh VAT + 7 loại chi phí | Đơn lẻ | accountant | 1 dòng sales | 1. Bấm icon Pencil ở 1 dòng | Modal mở với đủ field: amount_before_tax, tax_rate, tax_amount, total_amount, 7 loại chi phí, notes — đã điền sẵn giá trị hiện tại | P2 | UI |
| TC-TAICHINH-079 | Nút "Tự tính lại VAT" trong modal sửa | Đơn lẻ | accountant | Modal đang mở, amount_before_tax=100,000,000, tax_rate=10 | 1. Bấm "Tự tính lại VAT" | `tax_amount` tự điền = 10,000,000, `total_amount` tự điền = 110,000,000 | P2 | UI |
| TC-TAICHINH-080 | `PUT /quarterly-invoices/sales/{id}` — chỉ update field trong whitelist + ghi audit_log | Đơn lẻ | accountant | 1 dòng sales | 1. Gọi API PUT với field ngoài whitelist trộn lẫn field hợp lệ | Chỉ field whitelist được cập nhật; `audit_log` ghi 1 dòng UPDATE có `old_data`/`new_data`/`ip`/`user-agent` | P1 | API |
| TC-TAICHINH-081 | BG-TAICHINH-01: `PUT /quarterly-invoices/sales/{id}` 404 sai khi id chỉ tồn tại bên sales | BUG-GATE | accountant | 1 dòng `sales_invoices_q` có ID KHÔNG trùng ID nào ở `purchase_invoices_q` | 1. Gọi `PUT /quarterly-invoices/sales/{id}` với id đó, dữ liệu hợp lệ | **Kỳ vọng hiện tại = FAIL**: trả 404 sai (vì `update_sale()` sau khi fetch từ `sales_invoices_q` lại SELECT kiểm tra tồn tại thứ 2 nhầm từ bảng `purchase_invoices_q`). Ca PASS nghĩa là bug đã fix — không tính vào coverage | P1 | API |
| TC-TAICHINH-082 | Nút "Tải lên PDF" — validate .pdf only + 10MB | Negative | accountant | file `khong-phai-pdf.exe` đổi content-type=`application/pdf`, file 11MB | 1. Mở modal Tải lên PDF. 2. Chọn file .exe giả pdf, bấm Tải lên. 3. Thử lại với file 11MB | Cả 2 lần đều bị chặn: lần 1 do magic-byte check thất bại (không đúng .pdf thật), lần 2 do vượt 10MB — cả 2 nhận lỗi rõ ràng, không tạo bản ghi nháp | P1 | API+UI |
| TC-TAICHINH-083 | `POST /quarterly-invoices/upload-pdf` — parse best-effort tạo bản ghi nháp `source='pdf_ocr'` | Luồng | accountant | file `hoadon_mau.pdf` | 1. Gọi API upload-pdf với file hợp lệ | HTTP 200/201, tạo 1 bản ghi nháp `source='pdf_ocr'`; các field không parse được có fallback (`invoice_number='AUTO-HHMMSS'`, `buyer/seller_name='Cần xác nhận'`) — assert rõ đây là dữ liệu CẦN SỬA TAY, không phải OCR chính xác | P2 | API |
| TC-TAICHINH-084 | `DELETE /quarterly-invoices/sales/{id}` — endpoint tồn tại nhưng KHÔNG có UI gọi | Đơn lẻ | manager | 1 dòng sales test | 1. Gọi API DELETE trực tiếp (không qua UI vì không có nút) | HTTP 200/204, dòng bị xoá — ghi nhận rõ: không có confirm dialog, không có audit log riêng cho DELETE (khác UPDATE có audit) | P3 | API |
| TC-TAICHINH-085 | `GET /quarterly-invoices/overview` — không có UI riêng, chỉ test API | Đơn lẻ | accountant | Seed quý hiện tại | 1. Gọi API overview | HTTP 200, trả doanh thu/chi phí/lợi nhuận tổng quý đúng số cộng dồn từ sales/purchases | P3 | API |
| TC-TAICHINH-086 | Trang Duyệt thanh toán — KPI 3 ô (Chờ duyệt/Đã duyệt 7 ngày/Đã từ chối 7 ngày) | Đơn lẻ | accountant | Seed PR đủ 5 trạng thái | 1. Mở `/finance/payment-approvals` | 3 KPI đúng số, gọi 3 query riêng (không nhấp nháy khi 1 query chậm) | P1 | UI |
| TC-TAICHINH-087 | Redirect `/payment-approvals` → `/finance/payment-approvals` | Đơn lẻ | accountant | — | 1. Truy cập URL cũ `/payment-approvals` | Redirect permanent tới `/finance/payment-approvals`, giữ nguyên query string nếu có | P3 | UI |
| TC-TAICHINH-088 | Filter + tìm kiếm PR — ẩn field "Sale yêu cầu" khi role=sales | Đơn lẻ | sales | Đăng nhập `test_sales` | 1. Mở `/finance/payment-approvals` | Chỉ thấy PR của chính mình (auto-filter `requester_id`), field tìm "Sale yêu cầu" KHÔNG hiển thị trong bộ lọc | P1 | UI |
| TC-TAICHINH-089 | Bảng PR — click hàng mở Drawer chi tiết (Enter/Space hỗ trợ) | Đơn lẻ | accountant | ≥1 PR | 1. Click 1 hàng PR. 2. Tab tới hàng khác, nhấn Enter | Drawer mở đúng PR tương ứng cả 2 cách thao tác | P2 | UI |
| TC-TAICHINH-090 | `GET /payment-requests` — filter kết hợp status csv + assigned_to + customer ILIKE + date range + free-text q | Đơn lẻ | accountant | Seed đa dạng | 1. Gọi API với đủ tham số kết hợp | HTTP 200, kết quả đúng giao các điều kiện; sort whitelist chỉ chấp nhận {created_at,amount,status,approved_at} — sort field lạ bị bỏ qua/400 | P2 | API |
| TC-TAICHINH-091 | `GET /payment-requests/{id}` — 403 khi user không phải chủ PR và không có role đặc quyền | Negative | sales | PR thuộc `test_sales` khác | 1. Đăng nhập `test_sales` A. 2. Gọi API xem PR của `test_sales` B qua URL trực tiếp | HTTP 403 | P1 | API |
| TC-TAICHINH-092 | Drawer chi tiết PR — đủ 5 section (hero số tiền, Đơn hàng, Đề xuất từ sales, Lịch sử, Quote PDF) | Đơn lẻ | accountant | 1 PR pending có line items >3 dòng | 1. Mở Drawer, kiểm tra từng section. 2. Bấm "Xem thêm" ở section Đơn hàng | Đủ 5 section hiển thị đúng dữ liệu; "Xem thêm" mở rộng hết dòng, "Thu gọn" thu lại | P2 | UI |
| TC-TAICHINH-093 | Nút "Xem PDF" — báo lỗi rõ khi PDF chưa tạo | Negative | accountant | PR chưa có `quote_pdf_url` | 1. Bấm "Xem PDF" | Hiện thông báo lỗi rõ ràng "PDF chưa tạo, cần Sale bấm Tạo lại PDF" (không phải lỗi trắng/console) | P2 | UI |
| TC-TAICHINH-094 | Nút "Duyệt thanh toán" chỉ hiện khi status=pending và role đúng | Đơn lẻ | accountant | 1 PR status=approved | 1. Mở Drawer PR status=approved | Nút "Duyệt thanh toán" KHÔNG hiển thị (đã qua trạng thái pending) | P2 | UI |
| TC-TAICHINH-095 | `POST /payment-requests/{id}/approve` — 409 nếu status != pending | Negative | accountant | PR status=approved | 1. Gọi API approve lần 2 trên PR đã approved | HTTP 409 | P1 | API |
| TC-TAICHINH-096 | `POST /payment-requests/{id}/approve` — luồng thành công, drive sourcing_order | Luồng | accountant | PR status=pending, SO liên kết status=payment_requested | 1. Gọi API approve với ghi chú tuỳ chọn | HTTP 200, PR→approved, `sourcing_order.status: payment_requested→payment_approved`, notification in-app tới requester | P1 | API |
| TC-TAICHINH-097 | Idempotency — 2 accountant duyệt đồng thời cùng 1 PR (FOR UPDATE lock) | Kết hợp | accountant | 1 PR pending, 2 session accountant khác nhau | 1. Bắn 2 request `approve` đồng thời (asyncio.gather) trên cùng PR | Chỉ 1 request 200, request còn lại 409 — không có 2 lần drive state machine SO | P1 | API |
| TC-TAICHINH-098 | `approve` với `paid_immediately=true` — flip thẳng sang paid | Đơn lẻ | accountant | PR pending | 1. Gọi API approve `paid_immediately=true` | PR chuyển thẳng `pending→approved→paid` trong 1 lần gọi | P2 | API |
| TC-TAICHINH-099 | Nhánh auto-AR khi `PHASE3_AUTO_AR_ENABLED=OFF` (hiện tại) | Đơn lẻ | accountant | Flag OFF (mặc định) | 1. Gọi API approve PR | PR approved thành công, KHÔNG tạo `accounts_receivable`/`revenue_chain` mới (nhánh auto-AR bị bỏ qua vì flag OFF) | P1 | API |
| TC-TAICHINH-100 | Nhánh auto-AR khi `PHASE3_AUTO_AR_ENABLED=ON` (staging, teardown restore OFF) | Đơn lẻ | accountant | Bật flag trên staging | 1. Bật flag. 2. Gọi API approve PR. 3. Tắt lại flag (teardown) | PR approved, tự tạo `accounts_receivable` + `revenue_chain` qua chain_service (best-effort, dùng savepoint) | P1 | API |
| TC-TAICHINH-101 | Nhánh auto-AR lỗi best-effort — không rollback approval | Negative | accountant | Flag ON, giả lập chain_service lỗi (mock) | 1. Gọi API approve khi chain_service lỗi | Approve vẫn thành công (200), chỉ log lỗi tạo AR (savepoint rollback riêng phần đó, không phá approval chính) | P1 | API |
| TC-TAICHINH-102 | BG-TAICHINH-02: Nút "Từ chối" trên UI luôn 422 do payload FE/BE lệch schema | BUG-GATE | accountant | PR status=pending | 1. Mở Drawer PR. 2. Bấm "Từ chối". 3. Chọn 1 trong 5 lý do, nhập mô tả. 4. Bấm "Xác nhận từ chối" | **Kỳ vọng hiện tại = FAIL**: nhận HTTP 422 vì FE (`PaymentApprovalDrawer.tsx:~241`) chỉ gửi `{reason: combined}` (gộp reason+note tự do) trong khi BE `PaymentRejectPayload` yêu cầu 2 field riêng `note`(min_length 5) và `reason`(Literal 4 giá trị cố định). Ca PASS nghĩa là FE đã sửa để gửi đúng 2 field — không viết regression UI cho luồng từ chối khi ca này còn đỏ | P1 | UI |
| TC-TAICHINH-103 | `POST /payment-requests/{id}/reject` — validate trực tiếp qua API (bỏ qua FE lỗi ở TC-102) | Negative | accountant | PR status=pending | 1. Gọi API trực tiếp đúng schema: `{note:"Thiếu chứng từ hợp lệ", reason:"<1 trong 4 giá trị Literal>"}` | HTTP 200, PR→rejected, `sourcing_order: payment_requested→confirmed`, notification in-app cho sale. Đồng thời gọi thiếu `note` hoặc `note` <5 ký tự → 422 | P1 | API |
| TC-TAICHINH-104 | `reject` — 409 nếu status != pending | Negative | accountant | PR status=approved | 1. Gọi API reject trên PR đã approved | HTTP 409 | P2 | API |
| TC-TAICHINH-105 | Nút "Đánh dấu đã chi" chỉ hiện khi status=approved | Đơn lẻ | accountant | PR status=pending | 1. Mở Drawer PR pending | Nút "Đánh dấu đã chi" KHÔNG hiển thị | P2 | UI |
| TC-TAICHINH-106 | `POST /payment-requests/{id}/mark-paid` — 409 nếu status != approved | Negative | accountant | PR status=pending | 1. Gọi API mark-paid trên PR pending | HTTP 409 | P1 | API |
| TC-TAICHINH-107 | `mark-paid` — luồng thành công, KHÔNG đổi sourcing_order status | Luồng | accountant | PR status=approved | 1. Gọi API mark-paid với `payment_proof_url`+`note` | HTTP 200, PR ghi `paid_at`+metadata jsonb; `sourcing_order.status` GIỮ NGUYÊN (không đổi) — assert rõ điểm khác biệt này | P1 | API |
| TC-TAICHINH-108 | Panel "Đã quyết định" hiện đúng người quyết định + thời gian + ghi chú | Đơn lẻ | accountant | PR status=rejected | 1. Mở Drawer PR đã reject | Panel hiện tên người từ chối, thời gian, ghi chú lý do | P2 | UI |
| TC-TAICHINH-109 | Timeline Lịch sử — fallback đúng nguồn dữ liệu | Đơn lẻ | accountant | PR không có `workflow_history` nhưng có `sourcing_order_status_history` | 1. Mở Drawer PR đó | Timeline vẫn hiển thị đầy đủ mốc, tự thêm mốc duyệt/từ chối/đã chi nếu chưa có trong history | P3 | UI |
| TC-TAICHINH-110 | Ẩn toàn bộ panel Quyết định khi role không đủ quyền (kể cả sales tự xem PR mình) | Permission | sales | `test_sales` xem PR của chính mình status=pending | 1. Đăng nhập sales, mở Drawer PR của mình | Panel "Duyệt/Từ chối/Đánh dấu đã chi" KHÔNG hiển thị (canDecide=false dù là PR của chính họ) | P1 | UI |
| TC-TAICHINH-111 | Empty state khác nhau cho sales vs kế toán | Đơn lẻ | sales, accountant | Cả 2 role chưa có PR phù hợp filter | 1. Đăng nhập sales, filter không khớp gì. 2. Đăng nhập accountant, filter không khớp gì | Sales thấy "Bạn chưa có đề xuất TT nào"; accountant thấy "Không có yêu cầu chờ duyệt"/"Không có dữ liệu phù hợp bộ lọc" — 2 câu khác nhau | P3 | UI |
| TC-TAICHINH-112 | Nút "Tải lại" trang Payment Approvals refetch 4 query | Đơn lẻ | accountant | — | 1. Bấm nút "Tải lại" | List + 3 KPI count refetch đồng thời | P3 | UI |
| TC-TAICHINH-113 | Ma trận role — `POST /payment-requests/{id}/approve` chỉ accountant/admin | Permission | manager | PR pending | 1. Đăng nhập `test_manager`, gọi API approve | HTTP 403 (manager KHÔNG có quyền approve theo role list `accountant, admin`) — ghi rõ nếu thực tế cho phép manager thì cập nhật lại role list | P1 | API |
| TC-TAICHINH-114 | Trang Sổ quỹ — biểu đồ Dòng tiền 12 tháng | Đơn lẻ | accountant | Seed cash-book ≥3 tháng | 1. Mở `/finance/cash-book` | LineChart 3 đường (income/expense/net) hiện đủ 12 tháng, tháng không có data = 0 | P2 | UI |
| TC-TAICHINH-115 | BG-TAICHINH-03: Filter Từ ngày/Đến ngày trang Sổ quỹ không lọc thật | BUG-GATE | accountant | Seed cash-book ngoài khoảng mặc định | 1. Mở `/finance/cash-book`. 2. Chọn "Từ ngày" = 1 tháng trước, "Đến ngày" = hôm nay. 3. Quan sát network request và kết quả | **Kỳ vọng hiện tại = FAIL**: request gửi param `page`/`from`/`to` nhưng backend chỉ nhận `date_from`/`date_to` → server luôn trả mặc định đầu tháng→hôm nay bất kể input; ca PASS nghĩa là FE/BE đã khớp param | P1 | UI |
| TC-TAICHINH-116 | Bảng sổ quỹ — pagination Trước/Sau, disable khi entries<20 | Đơn lẻ | accountant | <20 dòng cash-book | 1. Mở `/finance/cash-book` | Nút "Sau" disable vì tổng dòng <20; cột Số dư sau tính đúng luỹ kế | P3 | UI |
| TC-TAICHINH-117 | Modal "Tạo bút toán" trang Cash-book — đổi Loại reset Danh mục | Đơn lẻ | accountant | — | 1. Mở modal, chọn Loại=Thu, chọn 1 Danh mục. 2. Đổi Loại sang Chi | Danh mục bị reset về rỗng/mặc định (vì danh mục phụ thuộc Loại) | P2 | UI |
| TC-TAICHINH-118 | `GET /finance-management/cash-flow` — months>24 bị chặn 422 (đọc code xác nhận) | Negative | accountant | — | 1. Gọi API `months=30` | HTTP **422** (`finance_management.py:235` khai báo `months: int = Query(12, ge=1, le=24)` — Pydantic/FastAPI từ chối cứng, KHÔNG clamp về 24). Trần hợp lệ = **24 tháng**, mặc định = **12 tháng**. | P3 | API |
| TC-TAICHINH-119 | `GET /finance-management/ap-summary` — aging 5-bucket khác 4-bucket của `/finance/payables/summary` | Đơn lẻ | accountant | Seed AP đủ 5 bucket (current/1-30/31-60/61-90/over_90) | 1. Gọi `GET /finance-management/ap-summary` | 5 bucket đúng field name, `by_supplier` top 20 sort đúng theo tổng nợ giảm dần | P2 | API |
| TC-TAICHINH-120 | `GET /finance-management/ar-summary` — tương tự AP, `by_customer` top 20 | Đơn lẻ | accountant | Seed AR đủ 5 bucket | 1. Gọi API ar-summary | 5 bucket đúng, `by_customer` top 20 đúng | P2 | API |
| TC-TAICHINH-121 | `GET/POST /finance-management/budget` — upsert ON CONFLICT theo category/tháng/năm | Đơn lẻ | manager | — | 1. POST budget category X tháng 7/2026 = 50,000,000. 2. POST lại cùng category/tháng/năm với số khác = 60,000,000 | Lần 2 UPSERT đè giá trị (không tạo dòng trùng), `GET budget` trả 60,000,000 | P2 | API |
| TC-TAICHINH-122 | `POST /finance-management/budget` — 403 khi role accountant (chỉ manager/admin) | Permission | accountant | — | 1. Đăng nhập accountant, gọi POST budget | HTTP 403 (POST chỉ cho manager/admin, GET thì accountant được) | P1 | API |
| TC-TAICHINH-123 | Trang Báo cáo tài chính — 5 KPI + badge Biên LN màu theo ngưỡng | Đơn lẻ | manager | Seed deal_margins tháng hiện tại | 1. Mở `/finance/reports` | 5 KPI (Doanh thu/COGS/LN gộp/Chi phí/LN ròng) hiện số; badge Biên LN đổi màu đúng theo ngưỡng % cấu hình | P1 | UI |
| TC-TAICHINH-124 | BG-TAICHINH-04: Bộ chọn kỳ 3/6/12 tháng không đổi dữ liệu P&L | BUG-GATE | manager | — | 1. Mở `/finance/reports`. 2. Chọn radio "3 tháng", ghi số 5 KPI. 3. Chọn "12 tháng", so sánh lại 5 KPI | **Kỳ vọng hiện tại = FAIL**: 5 KPI KHÔNG đổi (luôn hiện "—" hoặc số tháng hiện tại) vì FE gửi `?months=N` nhưng BE `profit_loss_statement` chỉ đọc `year+month`, bỏ qua `months`, và trả shape lồng `{revenue:{from_deals_vnd,...},...}` khác shape phẳng FE kỳ vọng. Ca PASS nghĩa là mismatch đã fix | P1 | UI |
| TC-TAICHINH-125 | BG-TAICHINH-05: Biểu đồ So sánh theo tháng vẽ giá trị undefined/0 | BUG-GATE | manager | Seed monthly-comparison có data thật | 1. Mở `/finance/reports`, quan sát ComposedChart và bảng "Chi tiết theo tháng" | **Kỳ vọng hiện tại = FAIL**: cột/đường luôn 0 hoặc undefined vì BE trả `revenue_vnd/cost_vnd/gross_profit_vnd/net_profit_vnd/avg_margin_pct` còn FE `MonthlyRow` đọc `revenue/cost/profit/margin_pct`. Ca PASS nghĩa là field đã khớp | P1 | UI |
| TC-TAICHINH-126 | BG-TAICHINH-06: Bảng Top khách hàng cột "Khách hàng" luôn rỗng | BUG-GATE | manager | Seed top-customers có data | 1. Mở `/finance/reports`, xem bảng "Top khách hàng" | **Kỳ vọng hiện tại = FAIL**: cột "Khách hàng" rỗng dù API trả dữ liệu, vì BE trả `company_name` còn FE `TopCustomerRow` đọc `customer_name`. Ca PASS nghĩa là field đã khớp | P1 | UI |
| TC-TAICHINH-127 | `GET /finance-reports/balance-overview` — Tài sản vs Nợ vs Vốn CSH (API-only, chưa có UI) | Đơn lẻ | manager | Seed AR/AP/tồn kho | 1. Gọi API balance-overview | HTTP 200, `Tài sản = tiền mặt+phải thu+tồn kho`, có `Nợ phải trả`, `Vốn chủ sở hữu` | P2 | API |
| TC-TAICHINH-128 | BG-TAICHINH-07: `GET /finance-reports/cash-flow-statement` 500 KeyError 'category' khi có dữ liệu | BUG-GATE | manager | Cash-book có dữ liệu trong kỳ chọn | 1. Gọi API cash-flow-statement với kỳ có ≥1 bút toán cash-book | **Kỳ vọng hiện tại = FAIL**: HTTP 500 (KeyError `'category'`) vì code Python đọc `r['category']` trong list comprehension nhưng câu SQL `cb_breakdown` chỉ SELECT `category_id` (không có alias `category`). Ca PASS nghĩa là SQL đã thêm alias hoặc code đã sửa key | P1 | API |
| TC-TAICHINH-129 | `GET /finance-reports/top-suppliers` — trend_pct so kỳ trước (API-only) | Đơn lẻ | manager | Seed 2 kỳ liên tiếp | 1. Gọi API top-suppliers | HTTP 200, top 10 NCC theo chi tiêu, `trend_pct` tính đúng so kỳ trước | P3 | API |
| TC-TAICHINH-130 | Ma trận role — `/finance-reports/*` chặn accountant (chỉ manager/admin xem báo cáo tổng hợp) | Permission | accountant | — | 1. Đăng nhập accountant, gọi `GET /finance-reports/balance-overview` | HTTP 403 — xác nhận accountant KHÔNG được xem báo cáo tổng hợp dù được xem AP/AR chi tiết | P1 | API |
| TC-TAICHINH-131 | Trang Duyệt phê duyệt chung (`/approvals`) — loại `payment_approval` xuất hiện cùng po_approval/price_change/supplier_onboard | Đơn lẻ | manager | Seed 1 workflow type=payment_approval pending | 1. Mở `/approvals` | Card loại "payment_approval" hiển thị đúng cùng các loại khác, badge Priority đúng | P1 | UI |
| TC-TAICHINH-132 | RejectForm trang Approvals chung — textarea lý do bắt buộc | Negative | manager | Workflow pending | 1. Bấm "Từ chối" trên PendingCard. 2. Để trống lý do, bấm xác nhận | Toast lỗi validate FE, không gọi API | P2 | UI |
| TC-TAICHINH-133 | Nút Duyệt/Từ chối trên PendingCard — invalidate 3 query + toast | Luồng | manager | Workflow pending | 1. Bấm "Duyệt" trên 1 PendingCard | Toast thành công, 3 query (workflows/approvals-pending/approvals-history) invalidate và refetch, card biến mất khỏi danh sách pending | P2 | UI |
| TC-TAICHINH-134 | `POST /workflows/{id}/action` — 409 nếu workflow đã quyết định (khác hẳn `payment_requests.py`) | Negative | manager | Workflow đã approved | 1. Gọi API action=approve lần 2 | HTTP 409 — xác nhận đây là ENGINE KHÁC với `payment_requests.py` dù cùng loại `payment_approval`, cần test độc lập không gộp chung state machine | P1 | API |
| TC-TAICHINH-135 | RBAC toàn mảng — ma trận 9 role cho `GET /finance/payables` (đại diện endpoint đọc) | Permission | 9 role | Đăng nhập lần lượt 9 tài khoản test | 1. Mỗi role gọi `GET /finance/payables` | admin/manager/accountant/viewer: 200; sales/procurement/warehouse/staff/director: 403 (ghi rõ role thực tế được phép theo `require_role` trong code, sửa bảng nếu code cho phép rộng hơn) | P1 | API |
| TC-TAICHINH-136 | RBAC — `POST /invoices/auto-generate`/`send`/`record-payment` chỉ manager/admin, staff bị chặn dù xem được list | Permission | staff | — | 1. Đăng nhập staff, gọi `GET /invoices` (200 kỳ vọng). 2. Gọi `POST /invoices/auto-generate` | GET 200, POST 403 — xác nhận staff xem được nhưng không mutate được | P1 | API |
| TC-TAICHINH-137 | Domain events — invoice.created/sent/payment_received ghi đủ 3 mốc cho 1 vòng đời hóa đơn | Luồng | manager | 1 SO đủ điều kiện, staging có Graph token | 1. auto-generate → send → record-payment đủ 3 bước trên cùng invoice | Sau 3 bước, `domain_event` có đủ 3 dòng `invoice.created`, `invoice.sent`, `invoice.payment_received` theo đúng thứ tự thời gian | P2 | API |
| TC-TAICHINH-138 | Audit log immutable tầng app — quarterly invoices UPDATE ghi đủ old/new/ip/user-agent, KHÔNG có audit cho CREATE/DELETE | Đơn lẻ | accountant | 1 dòng sales | 1. PUT sửa 1 dòng (đã test ở TC-080). 2. DELETE dòng khác. 3. So sánh `audit_log` | Chỉ có dòng audit cho UPDATE; không có dòng audit tương ứng cho hành động DELETE hoặc CREATE trong `quarterly_invoices.py` (ghi nhận rõ đây là khoảng trống, không phải lỗi cần fix ngay) | P2 | API |
| TC-TAICHINH-139 | Đa tiền tệ tổng hợp — AR/AP overview toàn mảng KHÔNG bao giờ cộng gộp VND+USD | Đa tiền tệ | accountant | Seed AR/AP VND+USD | 1. Duyệt lần lượt: `/finance/overview`, `/finance/receivables`, `/finance/payables`, `/finance-management/dashboard`, `/finance-management/ap-summary`, `/finance-management/ar-summary` | Ở TẤT CẢ 6 điểm trên, không có bất kỳ con số nào là tổng VND+USD cộng thẳng theo mệnh giá (mỗi nơi hoặc tách currency riêng hoặc quy đổi rõ ràng có ghi chú tỷ giá) | P1 | API+UI |
| TC-TAICHINH-140 | Fallback tỷ giá 25450 khi `exchange_rates` rỗng (rollback-txn trên prod) | Negative | accountant | Mở transaction, xoá tạm rate USD→VND | 1. Trong transaction, xoá rate USD→VND. 2. Gọi tính toán có quy đổi USD (vd. deal_chain liên quan finance). 3. Rollback transaction | Trong lúc rate rỗng, phép tính dùng fallback `25450`; sau rollback rate gốc phục hồi nguyên vẹn, không còn dấu vết | P2 | API |
| TC-TAICHINH-141 | Từ chối PR — luồng thành công đầy đủ qua Drawer (positive, bổ sung cạnh BG-TAICHINH-02) | Luồng | accountant | PR status=pending, `sourcing_order` liên kết status=`payment_requested` | 1. Đăng nhập `test_accountant` (payment_requests.py:594 `require_role("accountant","admin")` — **manager KHÔNG có quyền**, khớp TC-TAICHINH-113). 2. Mở `/finance/payment-approvals` → chọn PR pending → mở Drawer. 3. Bấm "Từ chối", chọn 1 trong 4 lý do (Literal), nhập `note` ≥5 ký tự. 4. Bấm "Xác nhận từ chối" | PR chuyển `status='rejected'` (+`rejected_by`,`rejected_at`,`rejection_reason` — `payment_requests.py:626-638`); `sourcing_order.status: payment_requested→confirmed` (`_so_apply_status_transition`, dòng 648-663); notification in-app `type='workflow_rejected'` gửi tới `requester_id` (dòng 673-689, best-effort — không làm fail request nếu gửi lỗi); PR biến mất khỏi hàng chờ "Chờ duyệt" trên `/finance/payment-approvals`. **Lưu ý phụ thuộc**: bước 3-4 (thao tác qua UI Drawer) hiện đi qua CÙNG code path đang bị BG-TAICHINH-02 ghi nhận lỗi 422 (FE gửi `{reason: combined}` gộp 1 field thay vì 2 field `note`+`reason` riêng theo `PaymentRejectPayload`) — ca này mô tả **kỳ vọng đúng của toàn luồng nghiệp vụ** (bao gồm cả side-effect DB/notification) và sẽ CHỈ pass thật sự khi BG-TAICHINH-02 được fix; cho tới lúc đó ca FAIL ở đúng bước 4 với cùng nguyên nhân gốc (không tính là lỗi mới, không trùng lặp coverage với BG-TAICHINH-02 vì phạm vi ca này rộng hơn — kiểm cả sourcing_order transition + notification mà BG-TAICHINH-02 không kiểm). | P1 | UI |

## Map feature → ca (chứng minh phủ 100%)

| F-ID | Tên rút gọn | Ca phủ |
|---|---|---|
| F-FIN-01 | KPI strip overview | TC-TAICHINH-001 |
| F-FIN-02 | Nút Tải lại overview | TC-TAICHINH-002 |
| F-FIN-03 | Bảng Tuổi nợ 4 bucket | TC-TAICHINH-003 |
| F-FIN-04 | Bảng công nợ 2 cột + empty/loading | TC-TAICHINH-004, 005 |
| F-FIN-05 | Bảng Sổ quỹ gần đây | TC-TAICHINH-006 |
| F-FIN-06 | Modal Tạo bút toán (overview) | TC-TAICHINH-007, 008, 009 |
| F-FIN-07 | POST cash-book validate | TC-TAICHINH-010, 011 |
| F-FIN-08 | GET dashboard | TC-TAICHINH-012 |
| F-FIN-09 | Auto-refresh 30s | TC-TAICHINH-013 |
| F-FIN-10 | Dual-shape response | TC-TAICHINH-014 |
| F-FIN-11 | 3 SummaryCard receivables | TC-TAICHINH-015 |
| F-FIN-12 | Bảng công nợ khách hàng | TC-TAICHINH-016 |
| F-FIN-13 | Nút Ghi nhận thu tiền inline | TC-TAICHINH-017 |
| F-FIN-14 | Form ghi nhận thu tiền | TC-TAICHINH-018, 019 |
| F-FIN-15 | POST record-receipt | TC-TAICHINH-020, 021, 022, 023, 024 |
| F-FIN-16 | Ẩn nút khi paid | TC-TAICHINH-025 |
| F-FIN-17 | Empty state + skeleton | TC-TAICHINH-026 |
| F-FIN-18 | Summary payables theo currency | TC-TAICHINH-027 |
| F-FIN-19 | Filter Nguồn | TC-TAICHINH-028 |
| F-FIN-20 | Badge Nguồn suy luận | TC-TAICHINH-029 |
| F-FIN-21 | StatusPill override overdue | TC-TAICHINH-030 |
| F-FIN-22 | GET /finance/payables filter | TC-TAICHINH-031, 032 |
| F-FIN-23 | GET /finance/payables/summary | TC-TAICHINH-033 |
| F-FIN-24 | Nút Làm mới | TC-TAICHINH-034 |
| F-FIN-25 | NUMERIC coercion + cột PO | TC-TAICHINH-035 |
| F-FIN-26 | Error state + Thử lại | TC-TAICHINH-036 |
| F-FIN-27 | POST /finance/payables validate | TC-TAICHINH-037, 038, 039 |
| F-FIN-28 | POST /finance/receivables validate | TC-TAICHINH-040 |
| F-FIN-29 | POST /finance/payments validate | TC-TAICHINH-041, 042, 043 |
| F-FIN-30 | GET /finance/payments | TC-TAICHINH-044 |
| F-FIN-31 | POST /finance/cash-book validate | TC-TAICHINH-045, 046, 047 |
| F-FIN-32 | GET /finance/summary | TC-TAICHINH-048 |
| (đối chiếu 2 hệ) | — | TC-TAICHINH-049 |
| F-FIN-33 | KPI strip invoices | TC-TAICHINH-050 |
| F-FIN-34 | Filter trạng thái invoice | TC-TAICHINH-051 |
| F-FIN-35 | Search invoice | TC-TAICHINH-052 |
| F-FIN-36 | Click hàng + override tone | TC-TAICHINH-053, 054 |
| F-FIN-37 | Nút Tạo hóa đơn | TC-TAICHINH-055 |
| F-FIN-39 | POST /invoices/auto-generate | TC-TAICHINH-056, 057, 058, 059, 061 |
| F-FIN-40 | Sinh số hóa đơn | TC-TAICHINH-060 |
| F-FIN-41 | Job PDF Gotenberg | TC-TAICHINH-062 |
| F-FIN-42 | GET /invoices/overdue side-effect | TC-TAICHINH-063 |
| F-FIN-43 | GET /invoices/{id} | TC-TAICHINH-064 |
| F-FIN-44 | POST /invoices/{id}/send | TC-TAICHINH-065, 066, 067 |
| F-FIN-45 | POST /invoices/{id}/record-payment | TC-TAICHINH-068, 069, 070, 071 |
| F-FIN-38 | Pagination info list | TC-TAICHINH-072 |
| F-FIN-46 | Chọn quý + tab | TC-TAICHINH-073 |
| F-FIN-47 | Search server-side ILIKE | TC-TAICHINH-074 |
| F-FIN-48 | 6 SummaryCard Bán ra + Lãi sau CP | TC-TAICHINH-075 |
| F-FIN-49 | 5 SummaryCard Mua vào | TC-TAICHINH-076 |
| F-FIN-50 | Pagination 50/trang | TC-TAICHINH-077 |
| F-FIN-51 | Nút Sửa mở modal | TC-TAICHINH-078 |
| F-FIN-52 | Tự tính lại VAT | TC-TAICHINH-079 |
| F-FIN-53 | PUT whitelist + audit | TC-TAICHINH-080 |
| F-FIN-53 (bug) | update_sale nhầm bảng | TC-TAICHINH-081 (BG-TAICHINH-01) |
| F-FIN-54 | Upload PDF validate + parse | TC-TAICHINH-082, 083 |
| F-FIN-55 | DELETE không có UI | TC-TAICHINH-084 |
| F-FIN-56 | GET overview quý | TC-TAICHINH-085 |
| F-FIN-57 | KPI 3 ô payment-approvals | TC-TAICHINH-086, 087 |
| F-FIN-58 | Filter + ẩn field theo role | TC-TAICHINH-088 |
| F-FIN-59 | Click hàng mở Drawer | TC-TAICHINH-089 |
| F-FIN-60 | GET /payment-requests filter | TC-TAICHINH-090 |
| F-FIN-61 | GET /payment-requests/{id} 403 | TC-TAICHINH-091 |
| F-FIN-62 | Drawer 5 section | TC-TAICHINH-092 |
| F-FIN-63 | Nút Xem PDF | TC-TAICHINH-093 |
| F-FIN-64 | Nút Duyệt thanh toán | TC-TAICHINH-094 |
| F-FIN-66 | POST /approve | TC-TAICHINH-095, 096, 097, 098, 099, 100, 101 |
| F-FIN-65 | Nút Từ chối UI (bug) + positive flow | TC-TAICHINH-102 (BG-TAICHINH-02), TC-TAICHINH-141 |
| F-FIN-67 | POST /reject | TC-TAICHINH-103, 104 |
| F-FIN-68 | Nút Đánh dấu đã chi | TC-TAICHINH-105 |
| F-FIN-69 | POST /mark-paid | TC-TAICHINH-106, 107 |
| F-FIN-70 | Panel Đã quyết định | TC-TAICHINH-108 |
| F-FIN-71 | Timeline lịch sử fallback | TC-TAICHINH-109 |
| F-FIN-72 | Ẩn panel theo role | TC-TAICHINH-110 |
| F-FIN-73 | Empty state khác nhau | TC-TAICHINH-111 |
| F-FIN-74 | Redirect route cũ | TC-TAICHINH-087 |
| F-FIN-75 | Nút Tải lại 4 query | TC-TAICHINH-112 |
| F-FIN-95 | Auto-filter requester_id / 403 | TC-TAICHINH-088, 091, 110 |
| F-FIN-76 | Biểu đồ 12 tháng | TC-TAICHINH-114 |
| F-FIN-77 | Filter ngày (bug param) | TC-TAICHINH-115 (BG-TAICHINH-03) |
| F-FIN-78 | Bảng sổ quỹ + pagination | TC-TAICHINH-116 |
| F-FIN-79 | Modal Tạo bút toán cash-book | TC-TAICHINH-117 |
| F-FIN-80 | GET cash-flow | TC-TAICHINH-118 |
| F-FIN-81 | GET ap-summary 5-bucket | TC-TAICHINH-119 |
| F-FIN-82 | GET ar-summary 5-bucket | TC-TAICHINH-120 |
| F-FIN-83 | GET/POST budget | TC-TAICHINH-121, 122 |
| F-FIN-84 | 5 KPI reports | TC-TAICHINH-123 |
| F-FIN-85 | Bộ chọn kỳ (bug) | TC-TAICHINH-124 (BG-TAICHINH-04) |
| F-FIN-86 | Biểu đồ ComposedChart (bug) | TC-TAICHINH-125 (BG-TAICHINH-05) |
| F-FIN-87 | Bảng Top KH (bug) + Chi tiết tháng | TC-TAICHINH-126 (BG-TAICHINH-06), 125 |
| F-FIN-88 | balance-overview | TC-TAICHINH-127 |
| F-FIN-89 | cash-flow-statement (bug 500) | TC-TAICHINH-128 (BG-TAICHINH-07) |
| F-FIN-90 | top-suppliers | TC-TAICHINH-129 |
| F-FIN-91 | Trang Approvals chung | TC-TAICHINH-131 |
| F-FIN-92 | RejectForm chung | TC-TAICHINH-132 |
| F-FIN-93 | Nút Duyệt/Từ chối chung | TC-TAICHINH-133, 134 |
| F-FIN-94 | RBAC toàn mảng | TC-TAICHINH-135, 136, 130, 122, 113 |
| F-FIN-96 | Domain events | TC-TAICHINH-137 |
| F-FIN-97 | Audit log immutable app-tầng | TC-TAICHINH-080, 138 |
| (đa tiền tệ chung) | — | TC-TAICHINH-139 |
| (fallback FX) | — | TC-TAICHINH-140 |

**Tổng cộng: 141 test case** (`TC-TAICHINH-001` → `TC-TAICHINH-141`, trong đó **7 ca** là BUG-GATE
(đã sửa lỗi đếm cũ ghi nhầm "6 ca" trong khi liệt kê đủ 7): TC-081 (BG-TAICHINH-01),
TC-102 (BG-TAICHINH-02), TC-115 (BG-TAICHINH-03), TC-124 (BG-TAICHINH-04), TC-125 (BG-TAICHINH-05),
TC-126 (BG-TAICHINH-06), TC-128 (BG-TAICHINH-07) — giữ nguyên đánh số vì BG được gắn nhãn trong cột
"Loại" chứ không tách bảng riêng. Coverage 97/97 feature F-FIN-01..97 (F-FIN-38 và F-FIN-74 phủ chéo
trong ca trạng thái khác đã liệt kê ở bảng trên; F-FIN-65 nay có thêm TC-TAICHINH-141 phủ nhánh
positive bên cạnh BG-TAICHINH-02).
