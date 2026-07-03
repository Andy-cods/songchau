# Test case E2E — Khách hàng — CRM + Pipeline + Deal Chain

Phạm vi file này: `backend/app/api/v1/crm.py`, `backend/app/api/v1/crm_pipeline.py`, `backend/app/api/v1/deal_chain.py` + các trang FE `crm/page.tsx`, `crm/new/page.tsx`, `crm/[id]/page.tsx`, `crm/_components/HoSoTab.tsx`, `chains/page.tsx`, `chains/[code]/page.tsx`. Không trùng bộ 118 ca đấu thầu (`<workspace>/plans/bidding-e2e-test-plan/` — chú ý: ở gốc workspace, NGOÀI songchau-erp/) và 122 ca price-intelligence (`plans/price-intelligence/E2E_TEST_PLAN.md`, trong songchau-erp/).

4 lớp thực thi dùng xuyên suốt:
- **[AUTO-API]** — pytest gọi REST trực tiếp, assert response/DB, không đụng UI.
- **[SEMI-UI]** — chạy tay hoặc Playwright, tới điểm dừng an toàn (không bấm nút phá dữ liệu thật, không gửi email/push Samsung).
- **[MANUAL]** — chỉ chạy tay có giám sát (không áp dụng cho mảng này — không có bước nào chạm Samsung).
- **BG-** — BUG-GATE: kỳ vọng ghi trong cột "Kỳ vọng" là **hành vi đúng theo nghiệp vụ**; hành vi **thực tế hiện tại** ghi rõ trong ngoặc — ca sẽ FAIL cho tới khi bug được fix. Không tính vào % coverage tính năng.

## Dữ liệu chuẩn bị chung

**Tài khoản test cố định** (không dùng tài khoản thật của Thang):
| Username | Role | Dùng cho |
|---|---|---|
| `test_admin@songchau.test` | admin | full quyền |
| `test_manager@songchau.test` | manager | tạo/sửa KH, gán owner, external-map, generate pipeline, margin |
| `test_staff@songchau.test` | staff | đọc, ghi tương tác, KHÔNG được gán owner/xoá map |
| `test_staff2@songchau.test` | staff | dùng làm "owner khác" trong ca filter owner=mine, và ca IDOR notif nếu cần |
| `test_sales@songchau.test` | sales (nếu role tồn tại trong hệ, else dùng staff) | ca role-liền-kề |
| `test_accountant@songchau.test` | accountant | đọc AR/financials |
| `test_viewer@songchau.test` | viewer | ca 403 toàn bộ (role thấp hơn staff, KHÔNG có trong whitelist `require_role` của 3 file) |
| `test_vendor@songchau.test` | vendor | ca 403 xác nhận cổng NCC không đụng được API CRM nội bộ |

**Bản ghi mồi khách hàng** (prefix `DEMO-`, dọn bằng glob `customer_code LIKE 'DEMO-%'` sau khi chạy xong):
1. **"DEMO Khách Có Map"** (`customer_code=DEMO-CUS-001`) — có đủ 3 external map preset (`bqms_samsung_po/company`, `bqms_deliveries/sev_type`, `bqms_orders/customer_name`) trỏ tới dữ liệu PO/deliveries/RFQ thật đã có trong `bqms_samsung_po`/`bqms_deliveries`/`bqms_rfq_submissions` (tái dùng dữ liệu DEMO-MIX-01 đã LIVE) → dùng cho ca "có dữ liệu thật".
2. **"DEMO Khách Trống"** (`DEMO-CUS-002`) — không có external map nào → dùng cho ca "rỗng nhưng có thể hiểu lầm là chưa từng mua hàng".
3. **"DEMO Khách Gần Trùng"** (`DEMO-CUS-003`) — tax_code/phone/company_name gần giống KH 1 (lệch 1-2 ký tự) → dùng cho ca duplicate-check.
4. Owner của KH 1 = `test_manager`, KH 2 = `test_staff`, KH 3 = chưa gán (NULL) → dùng cho ca filter `owner=mine`.

**Bản ghi mồi khác:**
- 6 dòng `crm_interactions` cho KH1: 1 có `follow_up_date` = hôm qua (overdue), 1 = hôm nay, 1 = +5 ngày (upcoming ≤7 ngày), 3 còn lại không có follow-up.
- 3 `crm_pipeline_cards`: 1 ở stage `new`, 1 ở stage `active` (mồi kéo sang `delivering`), 1 `is_archived=true` (mồi xác nhận không hiện trên board).
- 1 chain "hoàn chỉnh" đủ RFQ→Quotation→SO→Supplier Quote→PO→Shipment→Invoice→Payment 2 tiền tệ (1 dòng cost bằng USD, 1 dòng revenue bằng VND) để test margin đa tiền tệ.
- 1 chain có `exchange_rates` rỗng cho kỳ tính margin (test fallback hardcode 25450 tại `deal_chain.py:380`).
- `crm_account_external_map` UNIQUE constraint: seed sẵn 1 dòng trùng key `(customer_id, source_system='bqms_samsung_po', match_field='company', match_value=...)` để test idempotent upsert (ON CONFLICT DO UPDATE).

**Ghi chú KHÔNG đụng Samsung thật:** mảng CRM/pipeline/deal-chain hoàn toàn không có bước push Samsung trực tiếp — điểm chạm gần nhất là dữ liệu `bqms_*` đã tồn tại (đọc, không ghi). Mọi ca `[AUTO-API]` chạy trên prod-với-rollback-txn hoặc staging; mọi ca ghi dữ liệu dùng prefix `DEMO-` và dọn bằng glob trong teardown. Ca nào gọi tới module ngoài phạm vi (`sourcing`, `documents`) chỉ test tới ranh giới response/side-effect quan sát được từ phía CRM (link/badge xuất hiện), không lặp lại test chi tiết sourcing.

---

## Bảng test case

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-KHACHHANG-001 | Tìm nhanh KH theo tên (autofill) | Đơn lẻ | staff | KH1 "DEMO Khách Có Map" đã seed | 1. `GET /crm/customers/search?q=DEMO Khách&limit=10` | 200; mảng kết quả chứa KH1 với `company_name`, `code`, contact chính (JOIN LATERAL); không chứa KH đã `is_active=false` | P2 | API |
| TC-KHACHHANG-002 | Tìm nhanh KH — q rỗng bị chặn | Negative | staff | — | 1. `GET /crm/customers/search?q=` (chuỗi rỗng) | 422 (min_length=1) | P3 | API |
| TC-KHACHHANG-003 | Tìm nhanh KH — limit vượt biên | Negative | staff | — | 1. `GET /crm/customers/search?q=DEMO&limit=51` | 422 (limit 1-50) | P3 | API |
| TC-KHACHHANG-004 | Tìm theo mã số thuế/company_name unaccent | Đơn lẻ | staff | KH1 có tax_code cụ thể | 1. `GET /crm/customers/search?q=<tax_code KH1>` 2. `GET /crm/customers/search?q=` bản không dấu của company_name | 200 cả 2 lần đều trả về KH1 (ILIKE unaccent hoạt động đúng) | P2 | API |
| TC-KHACHHANG-005 | Danh sách KH — mở trang /crm mặc định | Đơn lẻ | staff | ≥3 KH DEMO đã seed | 1. Mở `/crm` 2. Quan sát bảng CustomersWorkArea | Bảng hiện đủ 3 KH DEMO, phân trang client `PAGE_SIZE=25`, không có lỗi console | P1 | UI |
| TC-KHACHHANG-006 | Danh sách KH — filter theo owner=mine | Đơn lẻ | manager (đăng nhập `test_manager`) | KH1 owner=test_manager, KH2 owner=test_staff | 1. Mở `/crm` 2. Chọn filter "Của tôi" | Chỉ hiện KH1, KH2/KH3 bị ẩn | P1 | UI |
| TC-KHACHHANG-007 | Danh sách KH — filter owner=uuid khác hợp lệ | Đơn lẻ | manager | — | 1. `GET /crm/customers?owner=<uuid test_staff>` | 200; chỉ trả về KH có owner_id đó | P2 | API |
| TC-KHACHHANG-008 | Filter owner — UUID không tồn tại | Negative | manager | — | 1. `GET /crm/customers?owner=<uuid ngẫu nhiên không có trong users>` | 404 | P2 | API |
| TC-KHACHHANG-009 | Filter owner — chuỗi không phải UUID và không phải "mine" | Negative | manager | — | 1. `GET /crm/customers?owner=abc123` | 400 | P2 | API |
| TC-KHACHHANG-010 | Danh sách KH — page_size cap 1000 (fix bug 30/06 W0) | Đơn lẻ | manager | ≥1 KH | 1. `GET /crm/customers?page_size=1000` 2. `GET /crm/customers?page_size=1001` | (1) 200; (2) 422 hoặc tự động clamp về 1000 tuỳ validator — assert KHÔNG còn tái hiện bug cũ trả 422 ở `page_size=500` | P1 | API |
| TC-KHACHHANG-011 | Danh sách KH — filter search + customer_type + is_active kết hợp | Kết hợp | staff | KH1 active, seed thêm 1 KH is_active=false | 1. `GET /crm/customers?search=DEMO&customer_type=<loại KH1>&is_active=true` | 200; chỉ trả KH1, KH inactive bị loại | P2 | API |
| TC-KHACHHANG-012 | Danh sách KH — filter FE client-side biz (bqms/imv) + density toggle | Đơn lẻ | staff | — | 1. Mở `/crm` 2. Bấm filter "BQMS" 3. Bấm toggle mật độ (density) | Bảng lọc đúng theo biz; density đổi chiều cao dòng, không lỗi | P3 | UI |
| TC-KHACHHANG-013 | Chi tiết KH — mở trang tồn tại | Đơn lẻ | staff | KH1 | 1. Mở `/crm/{id KH1}` | 200; hiện đủ StatStrip 5 chỉ số + 4 tab | P1 | UI |
| TC-KHACHHANG-014 | Chi tiết KH — id không tồn tại | Negative | staff | — | 1. `GET /crm/customers/999999999` 2. Mở `/crm/999999999` trên UI | BE 404; FE render EmptyState "Không tìm thấy khách hàng" | P2 | API+UI |
| TC-KHACHHANG-015 | Kiểm tra trùng KH — trùng tax_code chính xác | Validation | staff | KH1 có tax_code X | 1. Mở `/crm/new` 2. Điền `tax_code` = X (giống hệt KH1), blur field | `POST /customers/check-duplicate` trả về ≥1 match (KH1); FE hiện banner cảnh báo trùng + checkbox "Tôi xác nhận đây là KH KHÁC" | P1 | UI |
| TC-KHACHHANG-016 | Kiểm tra trùng KH — company_name gần giống (ILIKE unaccent) | Validation | staff | KH3 "DEMO Khách Gần Trùng" tên gần giống KH1 | 1. `/crm/new` điền company_name gần giống KH1 (bỏ dấu/khác 1-2 ký tự), blur | Match trả về ≤10 kết quả gồm KH1; không match quá rộng (không trả toàn bộ bảng) | P2 | UI |
| TC-KHACHHANG-017 | Chặn submit khi có trùng nhưng chưa tick xác nhận | Negative | staff | Trùng tax_code với KH1 | 1. `/crm/new` điền trùng tax_code KH1 2. KHÔNG tick "Tôi xác nhận đây là KH KHÁC" 3. Bấm nút "Tạo khách hàng" | Submit bị chặn ở FE, toast lỗi hiện ra, KHÔNG có request `POST /customers` nào được gửi (network tab rỗng) | P1 | UI |
| TC-KHACHHANG-018 | Trùng KH — link "Mở hồ sơ" điều hướng đúng | Đơn lẻ | staff | Trùng với KH1 | 1. `/crm/new` trigger trùng KH1 2. Bấm link "Mở hồ sơ" ở kết quả trùng | Điều hướng sang `/crm/{id KH1}` | P3 | UI |
| TC-KHACHHANG-019 | Tạo KH mới hợp lệ — full flow (manager) | Luồng | manager | Không trùng dữ liệu | 1. `/crm/new` 2. Điền company_name="DEMO-CUS-NEW", customer_code="DEMO-NEW-001", customer_type, contact_name, industry, email + phone 3. Bấm "Tạo khách hàng" | `POST /customers` 201; DB có KH mới; tự động tạo `crm_contacts` (email/phone/tên đã điền) là contact chính; tự động tạo `crm_pipeline_cards` stage='new'; toast "Đã tạo khách hàng" + redirect `/crm` | P1 | API+UI |
| TC-KHACHHANG-020 | Tạo KH — customer_code trùng | Negative | manager | KH đã có customer_code="DEMO-CUS-001" | 1. `POST /customers` với `customer_code="DEMO-CUS-001"` (trùng) | 409 | P1 | API |
| TC-KHACHHANG-021 | Tạo KH — lead_source=samsung_referral → priority=high | Đơn lẻ | manager | — | 1. `POST /customers` với `lead_source="samsung_referral"` | 201; `crm_pipeline_cards` tạo kèm có `priority='high'`, `stage='new'` | P2 | API |
| TC-KHACHHANG-022 | Tạo KH — lead_source khác → priority=normal | Đơn lẻ | manager | — | 1. `POST /customers` với `lead_source="cold_call"` (hoặc khác samsung_referral) | 201; pipeline card `priority='normal'` | P3 | API |
| TC-KHACHHANG-023 | Tạo KH — role staff bị 403 ở tầng BE dù FE không chặn | Permission | staff | Form FE không khoá nút cho staff | 1. Đăng nhập staff 2. Điền form hợp lệ ở `/crm/new` 3. Bấm "Tạo khách hàng" | `POST /customers` trả 403 (BE `require_role(manager,admin)`); FE hiện toast lỗi quyền — ghi nhận thêm: FE KHÔNG ẩn/khoá nút trước khi submit cho staff (gap UX, không phải bug bảo mật vì BE đã chặn đúng) | P1 | UI |
| TC-KHACHHANG-024 | Form tạo KH — Zod chặn thiếu field bắt buộc | Validation | staff | — | 1. `/crm/new` để trống `industry` 2. Bấm "Tạo khách hàng" | Form KHÔNG submit; lỗi Zod hiện dưới field `industry`; không có request BE nào | P2 | UI |
| TC-KHACHHANG-025 | Form tạo KH — refine bắt buộc có ít nhất 1 trong phone/email | Validation | staff | — | 1. `/crm/new` điền đủ field khác, để trống CẢ phone và email 2. Bấm "Tạo khách hàng" | Lỗi Zod gắn vào field `phone` ("Cần ít nhất số điện thoại hoặc email"); chặn submit | P2 | UI |
| TC-KHACHHANG-026 | Form tạo KH — email sai định dạng | Validation | staff | — | 1. Điền `email="abc-khong-hop-le"` 2. Bấm "Tạo khách hàng" | Lỗi Zod "Email không hợp lệ"; chặn submit | P3 | UI |
| TC-KHACHHANG-027 | BG-CRM-01: tạo KH — pipeline card fail vẫn báo thành công (silent partial-failure) | BUG-GATE | manager | Giả lập lỗi insert `crm_pipeline_cards` (constraint vi phạm cố ý, ví dụ stage sai) qua rollback-txn thao túng | 1. Gọi thẳng hàm `create_customer` với điều kiện khiến insert pipeline card lỗi | **Kỳ vọng đúng**: response phải cảnh báo rõ (vd field `pipeline_card_created:false` hoặc mã lỗi riêng) để FE không hiển thị toast "Đã tạo card trong CRM pipeline" sai sự thật. **Thực tế hiện tại**: lỗi chỉ `log.warning`, response 201 không phân biệt, FE luôn báo đã tạo card → ca này FAIL cho tới khi sửa (code: `crm.py:592-663`) | P1 | API |
| TC-KHACHHANG-028 | Cập nhật KH — bổ sung thông tin qua CustomerEditModal (từ bảng) | Đơn lẻ | manager | KH1 | 1. Mở `/crm` 2. Mở menu dòng KH1 → "Sửa" 3. Đổi `industry` 4. Bấm "Lưu" | `PUT /customers/{id}` 200; DB cập nhật đúng field; toast thành công; bảng refetch hiện giá trị mới | P1 | UI |
| TC-KHACHHANG-029 | Cập nhật KH — qua EditCustomerSlideOver (trang chi tiết) | Đơn lẻ | manager | KH1 | 1. Mở `/crm/{id KH1}` 2. Bấm "Sửa hồ sơ" (slide-over) 3. Đổi trường bất kỳ 4. "Lưu" | Cùng endpoint `PUT /customers/{id}` 200; 2 entrypoint FE hội tụ đúng 1 API — không lệch dữ liệu | P2 | UI |
| TC-KHACHHANG-030 | Cập nhật KH — payload rỗng | Negative | manager | KH1 | 1. `PUT /customers/{id}` với body `{}` | 400 | P2 | API |
| TC-KHACHHANG-031 | Cập nhật KH — tax_code bị khoá với staff | Permission | staff | KH1 | 1. Mở `/crm/{id KH1}` → sửa hồ sơ | Field "Mã số thuế" hiển thị readonly kèm nhãn "(chỉ quản lý sửa)"; nếu cố gửi `PUT` với `tax_code` khác từ staff → BE vẫn phải từ chối đổi tax_code (assert giá trị DB không đổi sau request) | P1 | API+UI |
| TC-KHACHHANG-032 | Gán owner 1 KH — hợp lệ | Đơn lẻ | manager | KH2 chưa gán hoặc gán khác | 1. Mở `/crm` 2. Chọn KH2 → "Gán chủ sở hữu" (AssignOwnerModal) 3. Chọn `test_staff2` 4. Xác nhận | `PATCH /customers/{id}/owner` 200; `owner_name` hiển thị đổi trong bảng ngay | P1 | UI |
| TC-KHACHHANG-033 | Gán owner — owner_id không phải UUID | Negative | manager | — | 1. `PATCH /customers/{id}/owner` body `{"owner_id":"abc"}` | 400 | P2 | API |
| TC-KHACHHANG-034 | Gán owner — owner không tồn tại | Negative | manager | — | 1. `PATCH /customers/{id}/owner` body owner_id = UUID ngẫu nhiên | 404 | P2 | API |
| TC-KHACHHANG-035 | Bỏ gán owner (null) | Đơn lẻ | manager | KH2 đã có owner | 1. `PATCH /customers/{id}/owner` body `{"owner_id":null}` | 200; `owner_id` trong DB = NULL; bảng hiện "Chưa gán" | P2 | API |
| TC-KHACHHANG-036 | Gán owner — staff bị 403 | Permission | staff | KH bất kỳ | 1. Đăng nhập staff 2. `PATCH /customers/{id}/owner` | 403; checkbox chọn dòng/nút "Gán chủ sở hữu" KHÔNG hiện trên UI cho staff (assert DOM không có checkbox) | P1 | API+UI |
| TC-KHACHHANG-037 | Gán owner hàng loạt (bulk) — chọn all-on-page | Kết hợp | manager | ≥3 KH DEMO trên cùng trang | 1. Mở `/crm` 2. Tick checkbox "chọn tất cả trang này" 3. Bấm "Gán chủ sở hữu" (action bar) 4. Chọn owner, xác nhận | `POST /customers/assign-owner` 200 với danh sách id đã chọn; toàn bộ owner đổi đồng loạt; action bar biến mất sau khi xong | P2 | UI |
| TC-KHACHHANG-038 | Bulk assign — action bar chỉ hiện khi có selection | Đơn lẻ | manager | — | 1. Mở `/crm` (chưa tick gì) 2. Quan sát | Action bar "Gán chủ sở hữu / Bỏ chọn" KHÔNG hiện; tick 1 dòng → action bar xuất hiện | P3 | UI |
| TC-KHACHHANG-039 | Hàng đợi "Cần làm hôm nay" — 3 nhóm overdue/today/upcoming | Đơn lẻ | staff | 3 interaction seed (overdue/today/+5 ngày) | 1. `GET /crm/follow-ups/due?scope=mine` (đăng nhập user tạo 3 tương tác) | 200; đúng 3 nhóm phân loại theo ngày; overdue = hôm qua, today = hôm nay, upcoming = trong 7 ngày | P1 | API |
| TC-KHACHHANG-040 | Follow-up queue — scope=all vs mine | Kết hợp | manager vs staff | Interactions của nhiều user khác nhau | 1. `GET /follow-ups/due?scope=mine` (staff, chỉ thấy của mình) 2. `GET /follow-ups/due?scope=all` (manager, thấy hết) | scope=mine chỉ trả bản ghi có `owner_id` hoặc `interaction.created_by` = user hiện tại; scope=all trả toàn bộ | P2 | API |
| TC-KHACHHANG-041 | Follow-up queue — limit vượt biên | Negative | staff | — | 1. `GET /follow-ups/due?limit=301` | 422 (limit 1-300) | P3 | API |
| TC-KHACHHANG-042 | Follow-up queue — auto refetch 60s (WorkQueueRail) | Đơn lẻ | staff | — | 1. Mở trang có WorkQueueRail 2. Đợi 65 giây, quan sát network tab | Có 1 request `GET /follow-ups/due` lặp lại sau ~60s (`refetchInterval`) | P3 | UI |
| TC-KHACHHANG-043 | Đánh dấu follow-up "Xong" | Đơn lẻ | staff | 1 interaction có follow_up_date=hôm nay | 1. Mở WorkQueueRail 2. Bấm nút "Xong" ở dòng tương tác đó | `PATCH /interactions/{id}/done` 200; `follow_up_date` set NULL (bản ghi tương tác KHÔNG bị xoá — kiểm tra vẫn còn trong `GET /interactions`); dòng biến mất khỏi hàng đợi | P1 | UI |
| TC-KHACHHANG-044 | Đánh dấu "Xong" — id không tồn tại | Negative | staff | — | 1. `PATCH /interactions/999999999/done` | 404 | P2 | API |
| TC-KHACHHANG-045 | BG-CRM-02: QuickLogModal (bảng KH) — chọn loại "zalo" | BUG-GATE | staff | KH1 | 1. Mở `/crm` → menu dòng KH1 → "Ghi nhanh" (QuickLogModal) 2. Chọn loại tương tác "Zalo" 3. Điền nội dung 4. Bấm "Lưu" | **Kỳ vọng đúng**: lưu thành công 201, xuất hiện trong timeline KH1. **Thực tế hiện tại**: `POST /interactions` trả 422 vì backend `Literal['email','call','meeting','visit','other']` không có `'zalo'` (`crm.py` InteractionCreateRequest, FE `crm/page.tsx:724`) → ca FAIL, xác nhận bug W0-03 | P1 | UI |
| TC-KHACHHANG-046 | BG-CRM-03: QuickLogModal — chọn loại "note" | BUG-GATE | staff | KH1 | 1. Tương tự TC-045 nhưng chọn "Ghi chú" (note) | Cùng lỗi 422 như TC-045 — biến thể thứ 2 của bug W0-03 | P2 | UI |
| TC-KHACHHANG-047 | BG-CRM-04: AddInteractionModal (trang chi tiết) — chọn "demo" | BUG-GATE | staff | KH1 | 1. Mở `/crm/{id KH1}` 2. Mở "Thêm tương tác" (AddInteractionModal) 3. Chọn loại "Demo" 4. Lưu | 422 (Literal backend không có 'demo') — biến thể thứ 3 của W0-03 (`crm/[id]/page.tsx:236`) | P1 | UI |
| TC-KHACHHANG-048 | BG-CRM-05: AddInteractionModal — chọn "support" | BUG-GATE | staff | KH1 | 1. Tương tự TC-047 nhưng chọn "Hỗ trợ" (support) | 422 — biến thể thứ 4 của W0-03 | P2 | UI |
| TC-KHACHHANG-049 | BG-CRM-06: Composer nhanh (Activity Rail InlineLogForm) — chọn "demo"/"support" | BUG-GATE | staff | KH1 | 1. Mở `/crm/{id KH1}` 2. Dùng ô "Ghi nhanh" trong Activity Rail 3. Chọn loại demo hoặc support | 422 — cùng danh sách INTERACTION_TYPES với TC-047/048 (`crm/[id]/page.tsx:1290-1387`), xác nhận rủi ro lặp ở component thứ 3 | P3 | UI |
| TC-KHACHHANG-050 | Ghi tương tác hợp lệ — loại "call" (được chấp nhận cả 3 nơi) | Đơn lẻ | staff | KH1 | 1. QuickLogModal chọn "Gọi điện" (call) 2. Lưu | 201; `crm_interactions` có bản ghi mới, hiện trong timeline | P1 | UI |
| TC-KHACHHANG-051 | Ghi tương tác — loại "visit" hợp lệ ở BE nhưng KHÔNG có trong dropdown FE (dead value) | Đơn lẻ | staff | — | 1. `POST /interactions` trực tiếp với `interaction_type="visit"` (bỏ qua FE) | 201 — xác nhận BE chấp nhận value mà không FE nào cho chọn (dead value ghi nhận là gap UX, không phải bug chặn) | P3 | API |
| TC-KHACHHANG-052 | Ghi tương tác — contact_id không thuộc customer_id | Negative | staff | KH1 và contact thuộc KH2 | 1. `POST /interactions` với `customer_id=KH1`, `contact_id=<contact của KH2>` | 400 | P1 | API |
| TC-KHACHHANG-053 | Ghi tương tác — subject rỗng / quá dài | Validation | staff | — | 1. `POST /interactions` với `subject=""` 2. `POST /interactions` với `subject` dài 501 ký tự | Cả 2 đều 422 (min_length=1, max_length=500) | P3 | API |
| TC-KHACHHANG-054 | Ghi tương tác — cập nhật last_contacted_at của contact | Đơn lẻ | staff | KH1 có contact_id | 1. `POST /interactions` với `contact_id` hợp lệ | 201; `crm_contacts.last_contacted_at` của contact đó được cập nhật trong cùng transaction | P2 | API |
| TC-KHACHHANG-055 | Danh sách tương tác — filter customer/loại/khoảng ngày + phân trang | Kết hợp | staff | ≥6 interaction KH1 | 1. `GET /interactions?customer_id={KH1}&interaction_type=call&date_from=...&date_to=...&page_size=200` | 200; đúng bộ lọc; `page_size=201` → 422 (cap 1-200) | P2 | API |
| TC-KHACHHANG-056 | Timeline tổng hợp KH — merge 3 nguồn đúng thứ tự | Đơn lẻ | staff | KH1 có interactions + orders + invoices trộn ngày | 1. `GET /customers/{id}/timeline?limit=20` | 200; các sự kiện sắp xếp giảm dần theo thời gian, không trùng lặp, không thiếu | P1 | API |
| TC-KHACHHANG-057 | Timeline — offset vượt tổng số bản ghi | Đơn lẻ (biên) | staff | KH1 có tổng cộng N bản ghi timeline (interactions+orders+invoices merge) | 1. `GET /customers/{id}/timeline?limit=20&offset=N+50` (offset chắc chắn vượt tổng số bản ghi thật) | HTTP 200 (KHÔNG 500), trả mảng rỗng `[]` — đây là kỳ vọng xác định (deterministic), thay cho ghi nhận mơ hồ trước đây. Nếu offset vượt mà trả 500/lỗi → FAIL. (Rủi ro lệch/lặp giữa các nguồn khi offset nằm GIỮA khoảng dữ liệu — khác với ca này — vẫn là hạn chế thiết kế merge-fetch đã biết, không phải BUG-GATE, không kiểm ở ca này.) | P3 | API |
| TC-KHACHHANG-058 | Danh bạ liên hệ — tạo contact mới + is_primary tự unset cái cũ | Đơn lẻ | staff | KH1 đã có 1 contact is_primary=true | 1. `POST /contacts` body customer_id=KH1, full_name mới, `is_primary=true` | 201; contact cũ tự động `is_primary=false`; chỉ đúng 1 contact primary cho KH1 | P1 | API |
| TC-KHACHHANG-059 | Tạo contact — full_name rỗng/quá dài | Validation | staff | — | 1. `POST /contacts` `full_name=""` 2. `full_name` dài 201 ký tự | Cả 2 → 422 (min_length=1, max_length=200) | P3 | API |
| TC-KHACHHANG-060 | Danh bạ tổng hợp toàn hệ thống (Contacts-all) | Đơn lẻ | staff | KH1 có contact crm + có contact khớp trong bqms_contacts | 1. `GET /contacts-all?search=DEMO` | 200; gộp `crm_contacts` + `bqms_contacts`; xác nhận: `search` chỉ áp cho crm_contacts, phần bqms_contacts trả nguyên (limit cứng 50, không phân trang) — bất nhất filter ghi nhận là gap, không chặn | P2 | API |
| TC-KHACHHANG-061 | External map — preview risk_level=ok (match 1-1) | Đơn lẻ | manager | KH1, alias company khớp đúng 1 dòng bqms | 1. Mở `/crm/{id KH1}` → ExternalMapsCard → "Xem trước" preset `bqms_samsung_po/company` | `POST /external-maps/preview` 200; `risk_level="ok"` | P1 | UI |
| TC-KHACHHANG-062 | External map — preview risk_level=too_wide (>50 match) | Đơn lẻ | manager | Alias giá trị quá chung chung (vd rỗng/1 ký tự) | 1. Preview với match_value cực rộng | `risk_level="too_wide"` (>50 kết quả) | P2 | API |
| TC-KHACHHANG-063 | External map — preview risk_level=no_match | Đơn lẻ | manager | Alias không khớp gì | 1. Preview với match_value không tồn tại trong bqms | `risk_level="no_match"` | P3 | API |
| TC-KHACHHANG-064 | External map — nguồn không nằm trong 3 preset | Negative | manager | — | 1. `POST /external-maps/preview` với `source_system="unknown_source"` | 400 "Unsupported external mapping source" | P2 | API |
| TC-KHACHHANG-065 | External map — tạo mới + is_primary unset map cùng (customer,source,field) | Đơn lẻ | manager | KH1 đã có 1 map primary cùng source/field | 1. `POST /external-maps` body mới `is_primary=true` cùng source+field | 201; map cũ tự `is_primary=false` | P2 | API |
| TC-KHACHHANG-066 | External map — idempotent upsert khi trùng UNIQUE (customer,source,field,value) | Đơn lẻ | manager | 1 map đã tồn tại đúng bộ key | 1. `POST /external-maps` gửi lại đúng key đã tồn tại (giá trị khác 1 field phụ, vd is_primary) | 201 (hoặc 200 tuỳ response code thực) — KHÔNG lỗi trùng, ON CONFLICT DO UPDATE ghi đè; DB chỉ có 1 dòng cho bộ key đó (không nhân đôi) | P2 | API |
| TC-KHACHHANG-067 | External map — xoá mapping | Đơn lẻ | manager | 1 map của KH1 | 1. Mở ExternalMapsCard 2. Bấm "Xoá" ở 1 map | `DELETE /external-maps/{id}` 200; map biến mất khỏi `GET /external-maps` | P2 | UI |
| TC-KHACHHANG-068 | External map — staff không được tạo/xoá | Permission | staff | — | 1. Đăng nhập staff 2. `POST /external-maps` 3. `DELETE /external-maps/{id}` | Cả 2 → 403; UI ẩn nút "Thêm liên kết"/"Xoá" cho staff (chỉ hiện xem) | P1 | API+UI |
| TC-KHACHHANG-069 | KPI tổng quan CRM (overview) — win_rate + top 5 KH + doanh thu 6 tháng | Đơn lẻ | staff | Dữ liệu RFQ won/lost đã có | 1. Mở dashboard CRM có overview widget 2. `GET /overview` | 200; `win_rate` tính từ toàn bộ `bqms_rfq.result` (không lọc theo KH — ghi chú rõ đây là hành vi thiết kế, không phải bug); top 5 KH sắp theo PO amount qua external map; mảng doanh thu đúng 6 tháng gần nhất | P2 | API |
| TC-KHACHHANG-070 | Lịch sử đơn hàng KH — KH có external map (dữ liệu thật) | Đơn lẻ | staff | KH1 | 1. Mở `/crm/{id KH1}` → tab "Đơn hàng" | `GET /customers/{id}/orders` 200; `pos` và `deliveries` khớp với dữ liệu PO/deliveries thật đã map | P1 | UI |
| TC-KHACHHANG-071 | Lịch sử đơn hàng KH — KH trống (chưa map) trả rỗng gây hiểu lầm | Negative | staff | KH2 "DEMO Khách Trống" | 1. Mở `/crm/{id KH2}` → tab "Đơn hàng" | `pos=[]`, `deliveries=[]` dù KH2 thực tế có thể có PO thật chưa map — UI hiện "Chưa có đơn hàng" KHÔNG phân biệt được với "thực sự chưa từng mua" — ghi nhận rủi ro hiểu lầm (F-CRM-23 note), đề xuất thêm badge "Chưa liên kết dữ liệu BQMS" ở đợt sau | P1 | UI |
| TC-KHACHHANG-072 | Tài chính KH — AR aging buckets đa tiền tệ | Đơn lẻ | accountant | KH1 có AR VND và USD, mỗi loại đủ current/1-30/31-60/>60 ngày | 1. `GET /customers/{id}/financials` | 200; 4 bucket đúng cho từng currency **riêng biệt** (VND và USD KHÔNG được cộng gộp thành 1 số) — assert cả 2 mảng currency tồn tại độc lập | P1 | API |
| TC-KHACHHANG-073 | Tài chính KH — KH2 trống trả doanh thu 0 dù có thể có dữ liệu thật | Negative | accountant | KH2 | 1. `GET /customers/{id KH2}/financials` | Trả về 0/rỗng — cùng rủi ro như TC-071, ghi nhận không coi là lỗi chức năng vì đúng theo match_context hiện có | P2 | API |
| TC-KHACHHANG-074 | Lịch sử RFQ/báo giá KH — win rate qua 2 nguồn UNION | Đơn lẻ | staff | KH1 có RFQ link trực tiếp customer_id VÀ RFQ chỉ khớp qua customer_name alias | 1. `GET /customers/{id}/quotes` | 200; kết quả UNION cả 2 nguồn không trùng lặp (không đếm đôi 1 RFQ có cả 2 điều kiện khớp) | P1 | API |
| TC-KHACHHANG-075 | Trang chi tiết KH — badge số lượng 4 tab đúng | Đơn lẻ | staff | KH1 | 1. Mở `/crm/{id KH1}` | Badge tab "Hồ sơ" = total_pos + total quote; tab "Đơn hàng" = total_pos; tab "Liên hệ" = contacts.length — đối chiếu số hiển thị với API riêng lẻ | P2 | UI |
| TC-KHACHHANG-076 | StatStrip 5 chỉ số — click điều hướng đúng tab | Đơn lẻ | staff | KH1 | 1. Bấm từng chỉ số trong StatStrip (Doanh thu, PO, Công nợ, Báo giá mở, Tỷ lệ trúng) | Mỗi lần bấm chuyển đúng sang tab tương ứng | P3 | UI |
| TC-KHACHHANG-077 | StatStrip — "Công nợ" có pulse khi overdue | Đơn lẻ | accountant | KH1 có AR quá hạn | 1. Mở `/crm/{id KH1}` | Chỉ số "Công nợ" có hiệu ứng pulse/nhấn mạnh khi tồn tại khoản overdue | P3 | UI |
| TC-KHACHHANG-078 | Activity Rail — thu gọn/mở rộng lưu localStorage | Đơn lẻ | staff | — | 1. Mở `/crm/{id}` 2. Bấm thu gọn rail 3. Reload trang (F5) | Trạng thái thu gọn được giữ nguyên sau reload (đọc key `RAIL_COLLAPSE_KEY` trong localStorage) | P3 | UI |
| TC-KHACHHANG-079 | Hồ sơ (HoSoTab) — 4 thư mục ảo tải đúng dữ liệu | Đơn lẻ | staff | KH1 có sourcing entries + quote_batch + documents | 1. Mở tab "Hồ sơ" trang chi tiết KH1 | 4 folder Báo giá/Đơn hàng/Mã sourcing/Tài liệu gọi đúng 4 API (`/sourcing/quote-batch`, `/sourcing/orders`, `/sourcing/by-customer/{id}`, `/documents/by-entity/customer/{id}`), hiển thị đúng số dòng khớp dữ liệu mồi | P1 | UI |
| TC-KHACHHANG-080 | HoSoTab — tải file có token (buildAuthedUrl) | Đơn lẻ | staff | 1 quote/document có file thật | 1. Tab "Hồ sơ" → bấm "Tải" ở 1 dòng | Mở tab mới với URL chứa `?token=` từ localStorage `access_token`; file tải về đúng | P2 | UI |
| TC-KHACHHANG-081 | HoSoTab — tải file khi token hết hạn/localStorage trống | Negative | staff | Xoá `access_token` khỏi localStorage trước khi bấm | 1. Xoá localStorage `access_token` (giữ session cookie khác nếu có) 2. Bấm "Tải" | URL mở thiếu `?token=` hợp lệ → tab mới trả 401/lỗi trình duyệt không có thông báo thân thiện trong app — ghi nhận gap UX (F-CRM-30), đề xuất chặn nút hoặc show toast trước khi mở tab | P2 | UI |
| TC-KHACHHANG-082 | HoSoTab — Gửi báo giá (đổi label Gửi→Gửi lại) | Đơn lẻ | staff | 1 quote_batch chưa gửi | 1. Tab "Hồ sơ" → bấm "Gửi" ở dòng báo giá | `POST /sourcing/quote-batch/{quote_no}/send` 200; label nút đổi thành "Gửi lại"; `sent_at` có giá trị | P2 | UI |
| TC-KHACHHANG-083 | HoSoTab — Tạo đơn hàng từ báo giá (idempotent double-click) | Kết hợp | staff | 1 quote_batch chưa có converted_order_id | 1. Bấm "Tạo đơn" 2. NGAY LẬP TỨC bấm lại "Tạo đơn" lần 2 (double-click) | Lần 1: `POST .../create-order` 201, tạo 1 đơn. Lần 2: `already_existed=true`, KHÔNG tạo đơn trùng; toast khác biệt cho 2 trường hợp; DB chỉ có đúng 1 đơn liên kết quote_batch đó | P1 | UI |
| TC-KHACHHANG-084 | HoSoTab — quote đã convert hiện link chéo thay vì nút Tạo đơn | Đơn lẻ | staff | quote_batch có `converted_order_id` sẵn | 1. Mở tab "Hồ sơ" | Hiện link "Đơn {id}" thay cho nút "Tạo đơn" | P3 | UI |
| TC-KHACHHANG-085 | HoSoTab — Sửa & gửi lại báo giá tạo version mới | Đơn lẻ | staff | quote_batch v1 đã gửi | 1. Bấm "Sửa & gửi lại" ở dòng báo giá | Mở QuoteBatchModal với `reviseOfQuoteNo`; sau khi lưu, chip "v2" hiện trên dòng mới, dòng v1 giữ nguyên lịch sử | P2 | UI |
| TC-KHACHHANG-086 | HoSoTab — chip "Hết hạn" khi expired=true | Đơn lẻ | staff | 1 quote_batch quá hạn | 1. Mở tab "Hồ sơ" | Chip "Hết hạn" hiện đúng ở dòng đó | P3 | UI |
| TC-KHACHHANG-087 | Mở modal "Báo giá" từ bảng KH (không chọn sẵn KH) | Đơn lẻ | staff | — | 1. Mở `/crm` 2. Bấm nút "Báo giá" (không ở dòng nào) | QuoteBatchModal mở, cho phép chọn khách hàng trong modal (không prefill) | P2 | UI |
| TC-KHACHHANG-088 | Mở modal "Báo giá" từ trang chi tiết KH (chọn sẵn) | Đơn lẻ | staff | KH1 | 1. Mở `/crm/{id KH1}` 2. Bấm "Báo giá" | QuoteBatchModal mở với `customer_id=KH1` đã prefill, không cho đổi KH khác trong modal | P2 | UI |
| TC-KHACHHANG-089 | Pipeline board — load đủ 5 cột theo stage | Đơn lẻ | staff | Cards seed ở nhiều stage | 1. Mở `/crm` (view Kanban) | `GET /board` 200; đủ 5 cột new/nurturing/active/delivering/aftercare; card `is_archived=true` KHÔNG hiện | P1 | UI |
| TC-KHACHHANG-090 | Pipeline board — sort priority rồi moved_at | Đơn lẻ | staff | 1 cột có card urgent + normal trộn | 1. Quan sát thứ tự card trong 1 cột | Card `urgent` luôn trên `high` trên `normal` trên `low`; cùng priority thì `moved_at` mới nhất lên trước | P2 | API |
| TC-KHACHHANG-091 | Pipeline board — is_overdue tính theo ngày server | Đơn lẻ | staff | 1 card có follow_up_date < hôm nay | 1. `GET /board` | Card đó có `is_overdue=true` | P3 | API |
| TC-KHACHHANG-092 | Kéo-thả card sang "active" — auto follow-up +3 ngày | Đơn lẻ | staff | 1 card ở stage "new" | 1. Mở Kanban 2. Kéo card từ "Mới" sang "Đang chăm sóc" (active) | `PATCH /cards/{id}/move` 200; DB `follow_up_date = today+3`, `follow_up_note="Gọi hỏi KH đã xem báo giá chưa"`; card xuất hiện ở cột active ngay (không cần reload) | P1 | UI |
| TC-KHACHHANG-093 | Kéo-thả card sang "aftercare" — auto follow-up +7 ngày | Đơn lẻ | staff | 1 card ở stage "delivering" | 1. Kéo card sang cột "Chăm sóc sau bán" (aftercare) | `follow_up_date = today+7` | P1 | UI |
| TC-KHACHHANG-094 | Kéo-thả — stage đích không hợp lệ | Negative | staff | — | 1. `PATCH /cards/{id}/move` body `{"stage":"khong_ton_tai"}` | 400 | P2 | API |
| TC-KHACHHANG-095 | Kéo-thả — card không tồn tại | Negative | staff | — | 1. `PATCH /cards/999999999/move` | 404 | P2 | API |
| TC-KHACHHANG-096 | Kéo-thả — realtime sync 2 tab (emit_record_changed) | Kết hợp | staff | 1 card, 2 tab trình duyệt cùng đăng nhập | 1. Mở `/crm` ở 2 tab 2. Tab A kéo card sang cột khác 3. Quan sát tab B (không reload) | Tab B tự cập nhật board (invalidate `crm-board`) trong vài giây mà không cần F5 | P2 | UI |
| TC-KHACHHANG-097 | Tạo card pipeline thủ công — hợp lệ | Đơn lẻ | staff | — | 1. Mở Kanban → "Thêm thẻ" (CreateCardModal) 2. Điền `title` 3. Lưu | `POST /cards` 201; card mới hiện ở cột "Mới" | P2 | UI |
| TC-KHACHHANG-098 | Tạo card — thiếu title | Negative | staff | — | 1. `POST /cards` không có `title` | 400 | P2 | API |
| TC-KHACHHANG-099 | Cập nhật card — field không hợp lệ bị lọc theo whitelist | Negative | staff | 1 card | 1. `PUT /cards/{id}` body có field lạ không nằm trong whitelist + body rỗng sau khi lọc | 400 (không field hợp lệ) | P3 | API |
| TC-KHACHHANG-100 | Cập nhật card — id không tồn tại | Negative | staff | — | 1. `PUT /cards/999999999` | 404 | P3 | API |
| TC-KHACHHANG-101 | Lưu trữ (archive) card — không có xác nhận double-check | Negative | staff | 1 card | 1. Mở Kanban 2. Bấm "Lưu trữ" trên PipelineCard MỘT LẦN duy nhất (không có dialog xác nhận) | `DELETE /cards/{id}` 200 ngay lập tức, card biến mất khỏi board — ghi nhận gap UX: không có bước xác nhận trước khi archive, dễ bấm nhầm mất card khỏi Kanban (soft-delete nên phục hồi được qua DB nhưng không có nút "Hoàn tác" ở FE) | P2 | UI |
| TC-KHACHHANG-102 | Tự động tạo/cập nhật card từ BQMS (Generate) — chạy thành công | Luồng | manager | Nhiều KH active có PO/RFQ/deliveries qua alias | 1. Mở Kanban 2. Bấm "Tạo từ BQMS" | Nút disable + hiện "Đang tạo…" (Loader2) trong lúc chạy; `POST /pipeline/generate` 200; toast kết quả có số `created`/`updated`; stage tính đúng theo rule delivering>aftercare>active>nurturing>new dựa trên đếm PO/RFQ/deliveries | P1 | UI |
| TC-KHACHHANG-103 | Generate pipeline — staff bị 403 | Permission | staff | — | 1. `POST /pipeline/generate` (đăng nhập staff) | 403; nút "Tạo từ BQMS" KHÔNG hiện trên UI cho staff | P1 | API+UI |
| TC-KHACHHANG-104 | Generate pipeline — chạy đồng bộ trong request (không phải job nền), ngưỡng hiệu năng | Đơn lẻ | manager | Seed đủ 500 KH active (khớp quy mô prod hiện tại; nếu prod ít hơn, seed bù cho đủ 500) | 1. Gọi `POST /pipeline/generate` đo thời gian phản hồi (`time.perf_counter()` trước/sau request) | Ngưỡng xác định: **≤10 giây cho 500 KH → PASS**; **>10 giây → FAIL** (không phải chỉ "ghi nhận rủi ro" — vượt ngưỡng nghĩa là cần chuyển sang background job thật ở đợt sau, ghi rõ số giây đo được vào kết quả ca). | P2 | API |
| TC-KHACHHANG-105 | Thống kê pipeline (/pipeline/stats) — endpoint có hoạt động dù nghi mồ côi FE | Đơn lẻ | staff | Cards đa dạng stage | 1. `GET /pipeline/stats` | 200; trả đúng counts theo stage + overdue — xác nhận BE hoạt động đúng dù FE `crm/page.tsx` hiện tại không thấy nơi gọi (grep lại toàn repo FE 1 lần nữa trước khi kết luận "mồ côi" hẳn) | P3 | API |
| TC-KHACHHANG-106 | Danh sách chuỗi giao dịch (Deal Chain) — filter current_stage/is_complete/needs_review | Kết hợp | staff | ≥3 chain đa trạng thái | 1. Mở `/chains` 2. Lọc theo `is_complete=true` | `GET /chains?is_complete=true` 200; đúng bộ lọc; phân trang `limit` 1-200 | P1 | UI |
| TC-KHACHHANG-107 | BG-CRM-07: Deal Chain list — enum stage FE không khớp backend STAGE_ORDER | BUG-GATE | staff | 1 chain có `current_stage="quotation"` (giá trị backend thật) | 1. Mở `/chains` 2. Quan sát PipelineDots/StageBadge của dòng đó | **Kỳ vọng đúng**: badge phải nhận diện đúng vị trí "Báo giá" trong chuỗi 9 bước backend (rfq/quotation/so/supplier_quote/po/shipment/invoice/payment/completed). **Thực tế hiện tại**: FE `PIPELINE_STAGES` dùng enum khác (rfq/quote/win/po_supplier/shipment/delivery/invoice/paid) → `STAGE_ORDER[stage]` undefined, badge hiển thị sai/luôn ở vị trí đầu — ca FAIL, xác nhận W2-13 phần list (`chains/page.tsx`) | P1 | UI |
| TC-KHACHHANG-108 | Tìm kiếm chuỗi giao dịch (client-side, chưa fetch hết) | Negative | staff | Danh sách chains vượt quá 1 trang backend | 1. Mở `/chains` 2. Gõ vào ô tìm kiếm `chain_code`/`customer_name`/`rfq_number` của 1 chain KHÔNG nằm trong trang đã tải | Kết quả tìm kiếm trống dù chain tồn tại trong DB (vì search chỉ lọc trên tập đã fetch, không gọi lại API) — ghi nhận gap thiết kế (F-CRM-43), không coi BUG-GATE vì hành vi nhất quán với code, chỉ là hạn chế UX | P2 | UI |
| TC-KHACHHANG-109 | Chi tiết 1 chuỗi giao dịch — id không tồn tại | Negative | staff | — | 1. `GET /chains/khong-ton-tai` 2. Mở `/chains/khong-ton-tai` trên UI | BE 404; FE hiện EmptyState phù hợp | P2 | API+UI |
| TC-KHACHHANG-110 | BG-CRM-08: Chi tiết chuỗi giao dịch — shape response BE khác hoàn toàn kỳ vọng FE (W2-13 chính) | BUG-GATE | staff | 1 chain hoàn chỉnh đủ dữ liệu | 1. Mở `/chains/{code}` 2. Quan sát toàn bộ trang (RFQ card, SO card, PO card, Shipment, Invoice, Payments, Margin) | **Kỳ vọng đúng**: trang hiển thị đầy đủ `stages: ChainStage[]` và `margin_breakdown` (profit_vnd/profit_percent/cost_of_goods_vnd) như interface FE định nghĩa. **Thực tế hiện tại**: BE trả `{data:{chain,completion_pct,rfq,sales_order,supplier_quote,purchase_order,shipment,invoice,payments,events,margin}}` — không có field `stages` hay `margin_breakdown`, margin dùng tên khác (`gross_profit_vnd`/`margin_pct`/`cogs_vnd` lồng trong `costs{}`) → khả năng cao trang render trống hoặc lỗi TypeScript runtime (`undefined.map` trên `stages`) — ca FAIL, xác nhận W2-13 phần detail (`deal_chain.py:146` vs `chains/[code]/page.tsx`); đây là ca ưu tiên fix cao nhất trong toàn mảng CRM vì chặn hẳn 1 trang | P1 | UI |
| TC-KHACHHANG-111 | Tính margin chuỗi — đa tiền tệ (VND revenue + USD cost) | Đơn lẻ | manager | Chain có 1 dòng cost USD, revenue VND, exchange_rates có tỷ giá thật | 1. `GET /chains/{code}/margin` | 200; `source="pre_calculated"` nếu đã có `deal_margins`, else tính live rồi UPSERT (`source="live_calculated"`); số liệu VND và USD được quy đổi và trình bày tách bạch — assert KHÔNG cộng gộp trực tiếp 2 đơn vị tiền trước khi quy đổi | P1 | API |
| TC-KHACHHANG-112 | Tính margin — meets_threshold hardcode 15% | Đơn lẻ | manager | 1 chain margin=14.9%, 1 chain margin=15.1% | 1. `GET /chains/{code}/margin` cho cả 2 chain | Chain 14.9% → `meets_threshold=false`; chain 15.1% → `true` (đúng ngưỡng cứng 15% tại `deal_chain.py:403`) — ghi nhận đây là hardcode, không cấu hình được, nếu Thang muốn đổi ngưỡng cần sửa code | P3 | API |
| TC-KHACHHANG-113 | Tính margin — fallback usd_rate=25450 khi exchange_rates rỗng | Đơn lẻ | manager | 1 chain có dòng USD, xoá sạch `exchange_rates` cho kỳ đó (trong transaction rollback) | 1. `GET /chains/{code}/margin` (trong txn đã xoá rate) | Response dùng `usd_rate=25450` (hardcode `deal_chain.py:380`); so sánh với ca có rate thật để thấy chênh lệch số liệu — ghi nhận rủi ro số liệu sai nếu tỷ giá thực khác xa 25450 (F-CRM-45 risk) | P1 | API |
| TC-KHACHHANG-114 | Tính margin — staff bị 403 | Permission | staff | — | 1. `GET /chains/{code}/margin` (đăng nhập staff) | 403 | P1 | API |
| TC-KHACHHANG-115 | Tính margin — double-call không tạo 2 dòng deal_margins (idempotent UPSERT) | Kết hợp | manager | 1 chain chưa có deal_margins sẵn | 1. `GET /chains/{code}/margin` lần 1 (tính live, UPSERT) 2. Gọi lại lần 2 ngay | Lần 2 trả `source="pre_calculated"` (đọc lại bản đã lưu, không tính lại/không tạo dòng mới); DB `deal_margins` chỉ có đúng 1 dòng cho chain đó | P2 | API |
| TC-KHACHHANG-116 | Trạng thái rỗng — danh sách KH không có kết quả | Đơn lẻ | staff | Filter ra kết quả rỗng | 1. Mở `/crm` 2. Filter search = chuỗi vô nghĩa | EmptyState "Không tìm thấy khách hàng phù hợp" + gợi ý đổi filter | P3 | UI |
| TC-KHACHHANG-117 | Trạng thái lỗi mạng — danh sách KH phải báo lỗi trong 3 giây, KHÔNG màn trắng | Negative | staff | Giả lập lỗi mạng (chặn/mock endpoint trả 500/timeout tạm thời) | 1. Mở `/crm` khi `GET /customers` trả lỗi 500/timeout. 2. Đợi tối đa 3 giây, quan sát vùng bảng | Kỳ vọng xác định: trong vòng **3 giây** phải hiện được thông báo lỗi (toast hoặc inline error state) cho người dùng biết danh sách tải lỗi — KHÔNG được to màn trắng/không được chỉ giữ nguyên skeleton loading vô thời hạn. **PASS** nếu có thông báo lỗi (toast/inline) xuất hiện ≤3s; **FAIL** (mở bug UX) nếu sau 3s vẫn không có thông báo nào (chỉ skeleton treo hoặc bảng trống không giải thích, dựa hoàn toàn vào react-query default không xử lý `onError`). | P2 | UI |
| TC-KHACHHANG-118 | Trạng thái rỗng/lỗi — Deal Chain list | Đơn lẻ | staff | Không có chain nào khớp filter | 1. Mở `/chains` với filter ra 0 kết quả 2. Giả lập `GET /chains` lỗi | EmptyState `variant='error'` riêng biệt cho trường hợp lỗi API, khác EmptyState cho rỗng thật (2 UI khác nhau, đã xử lý tốt hơn phần KH) | P3 | UI |
| TC-KHACHHANG-119 | Phân quyền tổng thể — viewer/vendor bị chặn toàn bộ endpoint CRM | Permission (ma trận) | viewer, vendor | — | 1. Đăng nhập `test_viewer` → gọi lần lượt `GET /customers`, `GET /board`, `GET /chains` 2. Đăng nhập `test_vendor` → gọi lại 3 endpoint trên | Toàn bộ trả 403 cho cả viewer và vendor (role thấp nhất cho phép luôn là staff trong `require_role` của 3 file crm.py/crm_pipeline.py/deal_chain.py) | P1 | API |
| TC-KHACHHANG-120 | Phân quyền — ma trận đọc (staff/accountant/manager/admin PASS) vs ghi (chỉ manager/admin) | Permission (ma trận) | staff, accountant, manager, admin | 1 KH mồi | 1. Mỗi role gọi `GET /customers/{id}` (đọc) 2. Mỗi role gọi `PATCH /customers/{id}/owner` (ghi) | Đọc: cả 4 role PASS 200. Ghi (owner-assign): chỉ manager/admin PASS 200, staff/accountant 403 | P1 | API |
| TC-KHACHHANG-121 | Composer nhanh (Activity Rail InlineLogForm) — loại "call" hợp lệ, timeline cập nhật ngay (positive, bổ sung cạnh BG-CRM-06) | Đơn lẻ | staff | KH1 | 1. Mở `/crm/{id KH1}` → Activity Rail. 2. Ở ô ghi nhanh, giữ nguyên loại mặc định "Gọi điện" (`interaction_type='call'` — giá trị khởi tạo của `composer` state, `crm/[id]/page.tsx:1306`, nằm trong `INTERACTION_TYPES` hợp lệ dòng 236-243). 3. Nhập nội dung vào subject. 4. Bấm gửi | `POST /api/v1/crm/interactions` → 201 (cùng endpoint QuickLogModal/AddInteractionModal đang dùng, `crm/[id]/page.tsx:1322`); `onSuccess` (dòng 1323-1328) chạy: toast "Đã ghi nhanh", `composer.subject` tự reset rỗng, `queryClient.invalidateQueries(['crm-timeline', customerId])` + `['crm-customer', customerId])` bắn ngay → Activity Rail timeline hiện dòng tương tác mới NGAY (không cần F5), đúng nội dung vừa nhập; badge số lượng liên quan (StatStrip/tab Hồ sơ) cập nhật theo | P1 | UI |

---

## Map feature → ca (chứng minh phủ 100%)

| Feature | Test case |
|---|---|
| F-CRM-01 | TC-001, TC-002, TC-003, TC-004 |
| F-CRM-02 | TC-005, TC-006, TC-010, TC-011, TC-012 |
| F-CRM-03 | TC-007, TC-008, TC-009 |
| F-CRM-04 | TC-013, TC-014 |
| F-CRM-05 | TC-015, TC-016, TC-017, TC-018 |
| F-CRM-06 | TC-019, TC-020, TC-021, TC-022, TC-023, TC-027 (BG-CRM-01) |
| F-CRM-07 | TC-024, TC-025, TC-026 |
| F-CRM-08 | TC-028, TC-029, TC-030 |
| F-CRM-09 | TC-032, TC-033, TC-034, TC-035, TC-036 |
| F-CRM-10 | TC-037, TC-038 |
| F-CRM-11 | TC-039, TC-040, TC-041, TC-042 |
| F-CRM-12 | TC-043, TC-044 |
| F-CRM-13 | TC-045 (BG), TC-046 (BG), TC-050 |
| F-CRM-14 | TC-047 (BG), TC-048 (BG), TC-051, TC-052, TC-053 |
| F-CRM-15 | TC-049 (BG), TC-121 |
| F-CRM-16 | TC-052, TC-053, TC-054 |
| F-CRM-17 | TC-055 |
| F-CRM-18 | TC-056, TC-057 |
| F-CRM-19 | TC-058, TC-059 |
| F-CRM-20 | TC-060 |
| F-CRM-21 | TC-061, TC-062, TC-063, TC-064, TC-065, TC-066, TC-067, TC-068 |
| F-CRM-22 | TC-069 |
| F-CRM-23 | TC-070, TC-071 |
| F-CRM-24 | TC-072, TC-073 |
| F-CRM-25 | TC-074 |
| F-CRM-26 | TC-018 |
| F-CRM-27 | TC-013, TC-075, TC-076 |
| F-CRM-28 | TC-078 |
| F-CRM-29 | TC-079 |
| F-CRM-30 | TC-080, TC-081 |
| F-CRM-31 | TC-082 |
| F-CRM-32 | TC-083, TC-084 |
| F-CRM-33 | TC-085, TC-086 |
| F-CRM-34 | TC-087, TC-088 |
| F-CRM-35 | TC-089, TC-090, TC-091 |
| F-CRM-36 | TC-092, TC-093, TC-094, TC-095, TC-096 |
| F-CRM-37 | TC-097, TC-098 |
| F-CRM-38 | TC-099, TC-100 |
| F-CRM-39 | TC-101 |
| F-CRM-40 | TC-102, TC-103, TC-104 |
| F-CRM-41 | TC-105 |
| F-CRM-42 | TC-106, TC-107 (BG) |
| F-CRM-43 | TC-108 |
| F-CRM-44 | TC-109, TC-110 (BG) |
| F-CRM-45 | TC-111, TC-112, TC-113, TC-114, TC-115 |
| F-CRM-46 | TC-116, TC-117 |
| F-CRM-47 | TC-118 |
| F-CRM-48 | TC-119, TC-120 |

**Tổng số ca**: 121 (TC-KHACHHANG-001 → TC-KHACHHANG-121).
**Trong đó BUG-GATE (BG-CRM-xx)**: 8 ca — TC-027, TC-045, TC-046, TC-047, TC-048, TC-049, TC-107, TC-110 (không tính vào % coverage tính năng, đại diện cho bug W0-03 x6 biến thể + W2-13 x2 biến thể list/detail).
**Ca hợp lệ tính coverage**: 113/121 — phủ đủ 48/48 feature (F-CRM-01 → F-CRM-48), mỗi feature ≥1 ca không-BUG-GATE (trừ F-CRM-42/44 chỉ có ca BG kèm ca thường TC-106/TC-109 để phủ phần positive-path còn lại của chính feature đó; F-CRM-15 nay có thêm TC-121 phủ nhánh positive bên cạnh BG-CRM-06).
**Ưu tiên**: P1 = 48 ca, P2 = 47 ca, P3 = 26 ca.
**Tự động hoá được (Y)**: 79 ca đánh "API" (thuần AUTO-API) + phần lớn ca "UI" cũng automatable qua Playwright ở đợt sau (chỉ TC-042 phụ thuộc thời gian thực 60s và TC-104 đo hiệu năng là khó tự động hoá ổn định, nên đánh N cho đợt đầu).
