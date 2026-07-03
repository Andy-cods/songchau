# FLOWS.md — Test Case Luồng Kết Hợp Xuyên Mảng (Integration Flows)

> **Ghi chú cấu trúc**: file này khác 7 file chức năng còn lại (BQMS/GIAO-HANG/KHACH-HANG/NGUON-CUNG/TAI-CHINH/DAU-THAU/FILE-FOLDER) — thay vì 1 bảng "mỗi dòng = 1 ca" với 9 cột chuẩn, mỗi luồng ở đây là **1 bảng trạm** (mỗi dòng = 1 bước trong chuỗi xuyên mảng). Mỗi luồng vẫn có đủ **Mã `TC-FLOW-###`** (heading `##`/`###`) và **Ưu tiên** (dòng `P: **P1**`/`P: **P2**` ngay sau bảng trạm) — tương đương cột "Mã" và "Ưu tiên" của 7 file kia, chỉ khác vị trí trình bày (prose thay vì cột riêng) do bản chất luồng đa bước không map 1-1 vào 1 dòng bảng.

Song Chau ERP · QA Architect pass · Nguồn: 8 luồng kết hợp brainstorm Fable (CMB-X1..X8) + 11 điểm sót Đợt bù (đơn lẻ, không có prefix CMB nhưng bắt buộc vì là "nền" của mọi luồng khác).

Quy ước:
- **Bằng chứng** = `file:line` đọc trực tiếp từ repo (Glob/Grep/Read), KHÔNG suy đoán.
- **Vai trò**: `Sale`, `Kế toán`, `Admin/Manager`, `NCC (vendor)`, `Hệ thống/Worker`, `[MANUAL-SAMSUNG]` khi bước chạm Samsung thật (nhãn phụ đánh dấu trạm nào đụng Samsung — không phải giá trị cột Tự động hoá).
- **Tự động hoá** (đồng bộ thang 4 giá trị `API | UI | API+UI | Tay` dùng chung với 7 file kia): `API` (script gọi thẳng REST, an toàn CI) / `UI` (Playwright, cần seed — trước đây ghi `UI-E2E`) / `Tay` (đụng Samsung/OneDrive thật — chỉ checklist tay, không CI — trước đây ghi `MANUAL`).
- Luồng đụng Samsung: viết dạng **dry-run tới điểm dừng an toàn** (trước khi gọi Samsung thật) + **checklist Tay** cho phần còn lại.

Đếm thật ở cuối file (## TỔNG KẾT).

---

## TC-FLOW-001 — Mạch doanh thu chính: BQMS → Đấu thầu nội bộ → Award → AP → Giao hàng → Hồ sơ → File
Nguồn: CMB-X1 · Mảng: BQMS + Đấu thầu + Tài chính + Giao hàng + File
Vai trò: Admin (BQMS) → NCC (vendor demo) → Admin (award) → Kế toán (AP) → Admin/Sale (giao hàng, dossier)

Bằng chứng nối bước:
- Push sang đấu thầu từ nguồn BQMS: `backend/app/api/v1/bqms.py:8232` `push_to_sec` (đơn), `:8344` `push_to_sec_batch`; twin dedupe etl/onedrive theo memory `reference_bqms_rfq_dup_rows` — cần verify JOIN không nhân đôi RFQ khi seed dữ liệu demo.
- AP nguồn "Đấu thầu": `backend/app/api/v1/finance.py` (`/api/v1/finance/payables`, filter `source`), record-payment qua `backend/app/api/v1/finance_management.py` (`record-payment` tolerance 0.01 theo brainstorm).
- Dossier + checkpoint: `backend/app/api/v1/bqms.py` nhóm route `/deliveries/dossier-prefill`, `/deliveries/create-dossier`, job poll (dossier-job/{id}), `awaiting_confirm` → cancel.
- Audit trigger bảo vệ nguồn dữ liệu award: `backend/migrations/procurement_audit_immutable.sql:16` `RAISE EXCEPTION`, `:25` `BEFORE UPDATE OR DELETE ON procurement_audit_log`.

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng (trạng thái/số tiền quan sát qua UI hoặc API) |
|---|---|---|---|---|
| 1. Seed RFQ | Admin | RFQ demo có twin etl+onedrive (2 dòng cùng `rfq_number`) | GET danh sách BQMS | Bảng chỉ hiện **1 dòng/RFQ** (dedupe theo memory `bqms_dedup` CTE) — nếu ra 2 dòng là bug twin sống lại |
| 2. Push sang đấu thầu | Admin | Chọn RFQ ở trạm 1 | Multi-select → PushToBiddingModal source=`bqms` → submit | Draft đấu thầu tạo với `source_kind='bqms'`; `notes` field **KHÔNG chứa** rfq_number/target_price gốc (verify bằng GET chi tiết draft) |
| 3. NCC báo giá | NCC demo | Tài khoản vendor demo có invitation | Login cổng NCC → lưới A-minus nhập giá + upload 1 file ảnh (magic-byte hợp lệ) | Quote lưu `status=submitted`; file xuất hiện trong quote drawer phía admin |
| 4. Xem ma trận + award | Admin | ≥2 NCC đã báo giá | Mở matrix/smart-award | Giá NCC A không lộ cho thao tác xem của NCC B (kiểm cross-check ở TC-FLOW-004); bấm Award → vào hàng đợi maker-checker (chưa final tới khi checker duyệt) |
| 5. Maker-checker duyệt | Admin (checker khác maker) | Award pending | Checker duyệt | Award `status=confirmed`; thử checker = chính maker → phải bị chặn (self-approve) |
| 6. AP sinh ra | Kế toán | Award confirmed | GET `/finance/payables?source=...` | 1 dòng AP mới, `source='Đấu thầu'`, amount = giá trúng thầu × qty |
| 7. Đối chiếu | Kế toán | AP đã sinh | GET `/finance-management/ap-summary` | Tổng theo currency khớp con số ở bước 6 (không cộng gộp cross-currency) |
| 8. Record-payment từng phần | Kế toán | AP `pending`, amount=X | POST record-payment amount=X/2 | AP `status=partial_paid` (hoặc `partial` tuỳ enum), `cash_book` sinh 1 dòng `direction='out'` amount=X/2 |
| 9. Trả nốt | Kế toán | AP `partial_paid` | POST record-payment phần còn lại | AP `status=paid`; tổng 2 dòng cash_book = X |
| 10. Delivery row | Admin | Award confirmed | Tạo/cập nhật delivery row tương ứng | Row xuất hiện ở trang Giao hàng, PO liên kết đúng |
| 11. Dossier wizard | Admin | Delivery row có sẵn | Wizard đủ 6 tab → submit → poll tới `awaiting_confirm` | Job `status=awaiting_confirm`; **DỪNG AN TOÀN Ở ĐÂY** |
| 12. Cancel checkpoint | Admin | Job `awaiting_confirm` | Bấm Cancel | Job `status=cancelled`; xác nhận Samsung **KHÔNG** bị gọi (không có delivery thật sinh trên BQMS) |
| 13. Kiểm file | Admin | Dossier job (kể cả cancelled) | Mở `/documents/browser` + "File mã" (Raw) | File nằm đúng thư mục `output_folder` của job, không lẫn vào RFQ khác |

Điểm gãy hay gặp: twin etl/onedrive nhân đôi RFQ; notes leak rfq_number/target_price; self-approve maker=checker; AP source sai nhãn; audit_log bị sửa tay (test độc lập ở TC-FLOW-009).
P: **P1** (xương sống doanh thu, Thang tuyên bố dùng làm căn cứ bật auto-AR/AP chính thức).
Tự động hoá: **API** tới hết trạm 11 (dry-run, dừng ở `awaiting_confirm`); trạm 12 trở đi vẫn API vì Cancel không đụng Samsung. Không cần bước Tay vì checkpoint an toàn nằm ngay trước bước gọi Samsung thật.

---

## TC-FLOW-002 — Sourcing → Báo giá khách → Đơn hàng → Đề xuất TT → Duyệt/Từ chối → AR → Deal chain margin
Nguồn: CMB-X2 · Mảng: Sourcing + CRM + Tài chính + Deal Chain
Vai trò: Sale → Kế toán → Admin (xem chain)

Bằng chứng:
- Flag AR: `backend/app/core/config.py:37` `PHASE3_AUTO_AR_ENABLED: bool = False`; điểm chốt gate: `backend/app/api/v1/payment_requests.py:441-460` (`_auto_ar_on = settings.PHASE3_AUTO_AR_ENABLED`).
- `QuoteBatchItem._exactly_one` (Flow F trong bảng feature) — mỗi dòng bắt buộc đúng 1 trong `supplier_price_id` / `manual_unit_price_vnd`, 422 nếu cả hai/không cái nào.
- Idempotent create-order theo `source_type+source_ref_id` (Flow H).

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1. Tạo sourcing entry | Sale | — | Nhập cost+currency, bấm "Lưu đợt tính giá" | `pricing_snapshots` version=1 ghi vào entry (giá trị đóng băng, ghi lại làm "golden value" so sánh ở trạm 6) |
| 2. QuoteBatchModal | Sale | Vào từ trang CRM chi tiết KH, `customer_id` autofill | Chọn 5 dòng sourcing (N=5 để bắt tràn trang PDF), mỗi dòng chọn đúng 1 loại giá | Preview PDF 5 dòng KHÔNG tràn sang trang 2 sai layout (BUG-GATE W3-04) |
| 3. Tạo thật | Sale | Preview OK | POST `/quote-batch` preview=false | `quote_no` dạng `SC-YYMMDD-NNNN` sinh ra, ghi `quote_batches` |
| 4. Gửi | Sale | quote_batches status=draft | POST `/send` | `status=sent`, `sent_at` set |
| 5. Tạo đơn | Sale | quote sent | POST `create-order` 2 lần liên tiếp | Lần 2 **không tạo đơn trùng** (idempotent theo source_ref_id) |
| 6. State machine | Sale/Kế toán | Order draft | Chuyển `quoted→confirmed` | Đúng theo `_SO_STATUS_NEXT`; sai thứ tự → 409 |
| 7. Payment request | Sale | Order confirmed | POST `/payment-request` | PR `status=pending` |
| 8. Kế toán TỪ CHỐI | Kế toán | PR pending | POST reject với lý do | **BUG-GATE**: xác nhận reject có trả 422 hay không (ghi nhận đúng nhánh lỗi thật, không giả định PASS) |
| 9. PR duyệt lại sau sửa | Sale → Kế toán | Order về `confirmed` sau reject | Sửa PR → gửi lại → duyệt | `payment_requested→payment_approved` |
| 10. Flag OFF | Kế toán | `PHASE3_AUTO_AR_ENABLED=False` (mặc định) | Sau approve | GET `/finance/receivables` **KHÔNG có AR mới** sinh ra — khẳng định phủ định |
| 11. Flag ON (staging riêng) | Kế toán | Bật flag ở môi trường staging | Approve PR tương tự | AR + `revenue_chain` xuất hiện (best-effort, savepoint không rollback approval nếu lỗi — `payment_requests.py:441-460`) |
| 12. Xem margin | Admin | Chain đã completed | GET `/chains` → click `/chains/[code]` | Margin dùng `usd_rate` thật nếu có, fallback 25450 nếu không — verify field nào đang active; **BUG-GATE W2-13** shape response đúng như FE kỳ vọng hay không |

Điểm gãy hay gặp: reject PR 422, chain detail shape lệch FE/BE, PDF N=5 tràn trang, flag OFF/ON lẫn lộn giữa môi trường.
P: **P1**.
Tự động hoá: **API** toàn bộ (không đụng Samsung); riêng bước 11 (flag ON) chỉ chạy ở staging, đánh dấu **không chạy trên prod**.

---

## TC-FLOW-003 — Vòng đời báo giá Samsung nhiều vòng: TM V1 → push → đóng/mở lại → V2 re-push → Won → HS code → Giao hàng
Nguồn: CMB-X3 · Mảng: BQMS (wizard/push/round) + Giao hàng
Vai trò: Admin → [MANUAL-SAMSUNG] → Admin

Bằng chứng:
- `generate-round`: `backend/app/api/v1/bqms.py` route `/rfq/{id}/generate-round` — 400 nếu round ngoài 1-4 (theo bảng feature F5).
- Push gate ảnh bắt buộc round=1: `bqms.py:8280` log `push_to_sec.image_gate rfq=%s round=%d image_required=%s` — xác nhận có logic phân biệt theo round ngay tại điểm log.
- Dedupe/409 khi RFQ đang queued: `bqms.py:8256-8267`.
- Abandonment SUBMIT_GIVEUP price=0 (đã fix, memory `reference_samsung_abandonment_total`).

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1. Wizard TM V1 | Admin | RFQ mới, round=1 | TmQuoteWizard chọn item, sửa giá → finalize | File Excel/PDF sinh trong subfolder `L1` |
| 2. Push preview round=1 | Admin | File V1 sẵn sàng | GET `/rfq/{id}/push-preview` | Validate: Submission Opinion không rỗng, ≥1 file, **ảnh bắt buộc** vì round=1 (`image_gate` log tại `bqms.py:8280`), giá>0 mọi item |
| 3. **[DỪNG AN TOÀN]** | — | — | Không gọi `/push-to-sec` thật | Ghi nhận payload preview đúng, KHÔNG bấm Push thật trong test tự động |
| 4. [MANUAL-SAMSUNG] Push thật | Admin | Ngoài giờ demo hoặc RFQ test riêng | Push tay lên Samsung | Samsung nhận quote V1 |
| 5. [MANUAL-SAMSUNG] Đóng vòng 1 | — | Samsung tự đóng theo deadline | — | RFQ chuyển `result=closed` |
| 6. [MANUAL-SAMSUNG] Samsung mở lại | — | Samsung admin mở lại (ngoài tầm kiểm soát ta) | — | RFQ `result` phải KHÔNG kẹt "closed" phía app — verify FE `isLiveClosed` + BE 409 deadline-aware (regression fix 24/06) |
| 7. Generate round V2 | Admin | RFQ mở lại | POST `/rfq/{id}/generate-round` round=2 | File V2 tạo, subfolder cũ archive `.archived_<ts>`, **file V1 gốc không mất** |
| 8. Re-push V2 preview | Admin | File V2 sẵn sàng | GET push-preview round=2 | **KHÔNG đòi ảnh** (dùng ảnh Samsung đã có từ round 1) — verify khác hành vi trạm 2 |
| 9. Item bỏ mã (SUBMIT_GIVEUP) | Admin | 1 item trong RFQ đánh dấu bỏ | Push preview | Item đó push `price=0` (không phải 1 — bug đã fix, verify không regress) |
| 10. Saved_temp idempotent | Admin | Round đã `saved_temp` từ lần trước | Re-push cùng round | Bypass idempotent, không lỗi trùng |
| 11. [MANUAL-SAMSUNG] Result=won | — | Sau khi Samsung chốt | — | RFQ vào `/won-quotations` |
| 12. Sửa HS code | Admin | Won quotation có sẵn | PATCH `/won-quotations/{id}` sửa HS code | Lưu đúng; bulk-lookup `/hs-code/bulk-lookup` trả gợi ý hàng loạt |
| 13. Delivery + export | Admin | Won item | Tạo delivery, export Excel | File Excel đúng số liệu won |

Điểm gãy hay gặp: closed-reopen kẹt, ảnh bắt buộc sai round, abandonment price=1 (đã fix, cần regression), saved_temp chặn nav.
P: **P1** (regression suite đắt giá nhất cho quan hệ Samsung — brainstorm tự nhận).
Tự động hoá: **API tới trạm 3** (dry-run preview, không gọi Samsung thật). Trạm 4-6, 11 = **Tay** (checklist — cần Thang/người vận hành thao tác tay trên BQMS thật hoặc dùng RFQ demo riêng ngoài giờ cao điểm). Trạm 7-10, 12-13 chạy lại được bằng **API** sau khi trạm 6 xảy ra tự nhiên hoặc mock `result` trong DB test.

---

## TC-FLOW-004 — Chống rò giá xuyên hệ: nguồn giá nội bộ → cổng NCC → analytics
Nguồn: CMB-X4 · Mảng: BQMS + Sourcing + IMV + Đấu thầu + File
Vai trò: Admin (setup) → NCC A → NCC B → Admin (analytics)

Bằng chứng: 10 file có chứa `notes = None` hoặc `target_price` được liệt kê ở bước grep sơ bộ, gồm `backend/app/api/v1/procurement.py`, `backend/app/services/procurement_notifications.py`, `backend/app/api/vendor/batches.py`, `backend/app/api/v1/procurement_analytics.py`, `backend/app/api/public_bid.py`, `backend/app/api/vendor/rank.py`, `backend/app/api/vendor/scorecard.py`, `backend/app/api/vendor/pos.py`, `backend/app/api/v1/quotation_templates.py`, `backend/migrations/vendor_portal_001.sql` — đây là danh sách điểm phải audit từng cái, KHÔNG suy đoán đã an toàn.

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1. Setup 3 nguồn | Admin | RFQ có `target_price` + `notes` chứa số RFQ khách | Push từ cả bqms/imv/sourcing sang đấu thầu | Draft tạo với `source_kind` tương ứng |
| 2. NCC quét batch detail | NCC token | Có quyền xem batch | GET batch detail | Response KHÔNG chứa `target_price` (kiểm cả nested object) |
| 3. NCC quét drawing/shared-files | NCC token | — | GET drawing, shared-files | KHÔNG chứa `rfq_number` gốc / `notes` chưa lọc |
| 4. NCC quét quote endpoints | NCC token | — | GET quote list/detail | Không leak field cấm |
| 5. Admin items/history | Admin | Item có lịch sử nhiều NCC | GET `/items/history` | Response không chứa `target_price` dù nested |
| 6. Vendor-scorecard/timeline | Admin | — | GET scorecard, timeline | Tương tự — không leak |
| 7. Sealed consistency | Admin | Phiên đang sealed (chưa mở giá) | So sánh matrix vs smart-award | Cả 2 màn che giá NHẤT QUÁN (không màn nào lộ trước) |
| 8. NCC A vs NCC B cách ly | NCC A, NCC B | 2 tài khoản NCC khác nhau cùng phiên | NCC A gọi API lấy file NCC B (đoán ID) | 403/404, không trả file |
| 9. Share-file chủ động | Admin | Admin bật share-file toggle 1 file cho NCC B | NCC B xem lại | Chỉ file được share xuất hiện; audit log ghi hành động share |

Điểm gãy hay gặp: IDOR đoán ID file/quote NCC khác; nested target_price sót trong serializer; sealed matrix/smart-award lệch pha hiển thị.
P: **P1** (rò 1 số target_price/RFQ khách = mất lợi thế đàm phán + lộ danh tính khách Samsung — brainstorm coi đây là loại lỗi "âm thầm không ai báo tới khi thiệt hại xảy ra").
Tự động hoá: **API** toàn bộ, có thể chạy dạng fuzz-scan (script duyệt mọi response JSON tìm string `target_price`/rfq_number pattern) — không đụng Samsung.

---

## TC-FLOW-005 — CRM từ số 0: tạo KH → external map → dữ liệu "nở ra" → Quote Hub → Hồ sơ → tải file
Nguồn: CMB-X5 · Mảng: CRM + Sourcing + File
Vai trò: Sale

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1. Tạo KH gần trùng | Sale | Có KH tên gần giống KH mới | POST `/customers` không tick `duplicateAck` | 409/warning bắt buộc tick xác nhận trùng |
| 2. Tạo KH thật | Sale | Đã tick ack | Submit | Customer tạo; **verify pipeline card THẬT SỰ tồn tại** (GET `/crm/board`, không chỉ tin theo toast — silent fail đã từng xảy ra ở module khác) |
| 3. Trước khi map | Sale | KH mới, chưa external map | GET orders/financials của KH | RỖNG — khẳng định đây là "chưa map" chứ không phải "chưa mua hàng" (2 nguyên nhân dễ nhầm) |
| 4. Tạo external map | Sale | — | Preview map, thử đủ 5 `risk_level` | Mỗi risk_level hiển thị cảnh báo tương ứng đúng mức |
| 5. Sau map | Sale | Map đã tạo | Reload trang KH | orders/PO/AR hiện ra, StatStrip đổi số (không rỗng nữa) |
| 6. QuoteBatchModal | Sale | Từ trang KH đã map | Tạo báo giá | HoSoTab 4 thư mục ảo hiển thị đúng phân loại |
| 7. Gửi + tạo đơn | Sale | Quote draft | Gửi → Tạo đơn 2 lần | Idempotent (giống trạm 5 TC-FLOW-002) |
| 8. Tải file, token hết hạn | Sale | Token hết hạn (mock) | Tải báo giá qua `buildAuthedUrl` | Nhánh token hết hạn có xử lý (refresh hoặc lỗi rõ ràng, không tải file rỗng/hỏng) |

Điểm gãy hay gặp: silent fail khi tạo pipeline card, sale hiểu nhầm "khách chưa từng mua" do chưa map, token hết hạn tải file im lặng.
P: **P2** (first-run experience quan trọng nhưng không mutate tiền trực tiếp).
Tự động hoá: **API/UI**, không đụng Samsung.

---

## TC-FLOW-006 — Vòng đời file 1 RFQ qua nhiều vòng báo giá: tạo → archive → sửa OnlyOffice → push đọc đúng bản
Nguồn: CMB-X6 · Mảng: BQMS + File/OnlyOffice
Vai trò: Admin → Hệ thống (Gotenberg render nền)

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1. Scrape tạo folder | Hệ thống | RFQ mới scrape | `ensure_rfq_folder_on_scrape` | Folder pretty-name tạo, idempotent nếu gọi lại (tìm được naming cũ, không tạo trùng) |
| 2. Tạo báo giá V1 | Admin | Folder có sẵn | Finalize V1 | File vào subfolder `L1` |
| 3. Regenerate V1 lần 2 | Admin | V1 đã tồn tại | Generate lại V1 | Folder cũ → `.archived_<ts>`, **file V1 gốc KHÔNG mất** (có thể verify bằng zip cả 2 bản) |
| 4. Mở OnlyOffice sửa | Admin | File xlsx trong subfolder | Mở qua `/documents/browser` → Sửa | Editor load, autosave/forcesave hoạt động |
| 5. Callback ghi đè | Hệ thống | Save trong OnlyOffice | Callback backend | File ghi đè + backup vào `.onlyoffice-backups` (3 bản) + PDF re-render nền (Gotenberg, best-effort) |
| 6. Push đọc bản mới | Admin | File vừa sửa xong | GET push-preview | Payload build từ file **MỚI NHẤT** sau sửa, không phải bản cache cũ |
| 7. Rename tiếng Việt có dấu | Admin | File/folder tên có dấu | Rename → thử lại preview/push | Vẫn tìm thấy file (không lỗi encoding path) |

Điểm gãy hay gặp: "mất File Lần 1" lịch sử có thật; push lấy file cũ do archive/rename chen giữa; encoding path tiếng Việt.
P: **P1** (file gửi Samsung lấy trực tiếp từ filesystem, không qua DB — sai 1 chỗ là gửi nhầm giá cũ cho khách).
Tự động hoá: **API** tới bước 6 (không cần push thật, chỉ verify payload preview trỏ đúng file mtime mới nhất). Không cần bước Tay vì không chạm Samsung.

---

## TC-FLOW-007 — Hồ sơ giao hàng lặp lại lần N + sửa hậu kỳ: prefill dùng lại header → checkpoint → zip → update-regenerate
Nguồn: CMB-X7 · Mảng: Giao hàng + File
Vai trò: Admin

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1. PO đã giao lần 1 | Admin | Seed job `done` cho PO X | — | Delivery history có 1 attempt |
| 2. Chọn lại cùng PO | Admin | — | Chọn lại delivery rows của PO X | Prefill trả `delivery_history` + "lần N" + `header_from_last_attempt` |
| 3. Dùng lại header | Admin | — | Bấm "Dùng lại" | Form tự điền header lần trước |
| 4. Upload ảnh + submit | Admin | — | Upload system/actual image → submit | Guard: tối đa 3 job/user đồng thời, hàng đợi tối đa 10 — thử vượt ngưỡng phải bị chặn |
| 5. Poll tới awaiting_confirm | Admin | Job enqueued | Poll status | `awaiting_confirm`, xem confirm-image |
| 6. **CANCEL** | Admin | — | Cancel | Job `cancelled` — **điểm dừng an toàn**, KHÔNG tạo Delivery thật trên Samsung |
| 7. [MANUAL-SAMSUNG] Chạy lại tới done | Admin | Job test riêng ngoài giờ | Chạy thật hoặc dùng staging mock | `status=done` |
| 8. Tải zip | Admin | Job done | Tải `folder.zip` | Đếm entry trong zip khớp số file kỳ vọng (Excel + ảnh + PDF Samsung) |
| 9. Mở lại hồ sơ | Admin | Job done | `?job=id` mở wizard edit mode | Hydrate `form_data` + ảnh cũ đúng |
| 10. Update-regenerate | Admin | — | Sửa 1 field → update-regenerate | **CHỈ Excel được build lại**, `vendor_invoice_no` counter **không nhảy**, Samsung **không bị gọi lại** (verify bằng: không có job scraper mới sinh ra) |

Điểm gãy hay gặp: giao lặp cùng PO sai counter hóa đơn, regenerate vô tình gọi lại Samsung tạo Delivery THẬT trùng (hậu quả không hoàn tác được — brainstorm cảnh báo rõ).
P: **P1** (nghiệp vụ hằng tuần thật + rủi ro không hoàn tác).
Tự động hoá: **API tới trạm 6** (an toàn). Trạm 7 = **Tay/staging-mock**. Trạm 8-10 chạy lại bằng **API** trên job đã có sẵn `done` (seed, không cần chạy lại Samsung).

---

## TC-FLOW-008 — Đối soát 2 sổ tài chính song song + hóa đơn tự động: SO → invoice → payment → 2 hệ AP/AR khớp số
Nguồn: CMB-X8 · Mảng: Sourcing orders + Tài chính (2 hệ) + CRM chains
Vai trò: Kế toán

Bằng chứng: `PHASE3_AUTO_AR_ENABLED` (config.py:37) ảnh hưởng cả revenue_chain; enum AR gốc dùng `partial_paid` còn invoice.record-payment dùng `'partial'` (khác chuỗi enum — brainstorm ghi rõ ở feature bảng Tài chính).

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1. SO delivered | Kế toán | SO status=delivered | POST `/invoices/auto-generate` | Invoice `status=draft` + `accounts_receivable status=pending` (không ghi `invoice_id` FK theo thiết kế) |
| 2. Gọi lại auto-generate | Kế toán | Invoice đã có | POST lại | 409 duplicate — không tạo invoice thứ 2 |
| 3. Record-payment invoice từng phần | Kế toán | Invoice draft/sent | Trả 50% (trong tolerance 0.1%) | `invoices.paid_amount` cập nhật; AR liên kết `status='partial'` (LƯU Ý enum khác AR gốc `'partial_paid'`) |
| 4. Trả nốt | Kế toán | — | Trả 50% còn lại | `status=paid`; `revenue_chain.completed` khi đủ tiền |
| 5. AP thủ công song song | Kế toán | — | POST `/finance/payables` amount>0 | AP tạo; `due_date>=invoice_date` — thử ngược lại phải reject |
| 6. Record-payment AP qua finance-management | Kế toán | AP pending | Trả từng phần (tolerance 0.01 — khác tolerance AR ở trạm 3) | Đúng số, `cash_book direction='out'` |
| 7. Đối chiếu 4 màn | Kế toán | Sau trạm 1-6 | Mở lần lượt: `/finance/payables`, `/finance/receivables`, `/finance-management/ap-summary`, `/finance-management/ar-summary`, dashboard overview, cash-book running balance | Tổng từng tiền tệ khớp TUYỆT ĐỐI giữa các màn (không cộng gộp cross-currency); nếu lệch → xác nhận bug W1-50 còn sống |

Điểm gãy hay gặp: enum AR lệch (`partial` vs `partial_paid`), tolerance khác nhau giữa 2 hệ (0.1% vs 0.01), 2 màn AP/AR ra 2 số khác nhau (W1-50).
P: **P1** (tiền đề bắt buộc trước khi Thang bật auto-AR/AP chính thức).
Tự động hoá: **API** toàn bộ, không đụng Samsung.

---

## Phần bổ sung — Đợt bù (điểm sót không nằm trong 8 CMB nhưng là NỀN xuyên mảng)

### TC-FLOW-009 — Auth: password_version revoke chokepoint
Bằng chứng: `backend/app/api/v1/auth.py:36` (`SELECT ... password_version`), `:102` (login lấy `password_version` từ DB), `:111` `if int(payload.get("pv", 1)) != int(user["password_version"])`, `:115` `"error": "TOKEN_REVOKED"`.

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1 | User X | Login lấy access+refresh token | — | Token chứa `pv=<password_version hiện tại>` |
| 2 | Admin | — | Đổi mật khẩu user X (hoặc reset) | `password_version` DB tăng lên |
| 3 | User X | Refresh token cũ (pv cũ) | Gọi refresh | 401 `TOKEN_REVOKED` (`auth.py:115`) |
| 4 | User X | Access token cũ đang sống (chưa hết hạn) | Gọi API thường (không phải refresh) | Vẫn dùng được tới khi access token tự hết hạn (self-lock tránh được — theo thiết kế) |
| 5 | Review hạ tầng | — | Đọc `auth.py:~62-66` cookie `secure=False` | Ghi nhận GAP cấu hình (không phải bug chức năng) — cần review riêng vì prod chạy HTTPS qua nginx |

P: **P1** (nền bảo mật của mọi role-matrix 403 toàn hệ). Tự động hoá: **API**.

### TC-FLOW-010 — Notifications: badge + IDOR mark-read
Bằng chứng: `backend/app/api/v1/notifications.py:114-115` (`unread_count` theo `recipient_id`), `:138-147` `mark_read` (`WHERE id=$1 AND recipient_id=$2::uuid`), `:161-169` `mark_all_read`.

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1 | User A | Có N notif chưa đọc | GET list | `unread_count=N` |
| 2 | User A | Mark 1 notif đã đọc | PUT mark-read | `unread_count=N-1` |
| 3 | User A | Có notif của User B (biết ID qua đoán/leak) | PUT `/{notif_của_B}/read` | 0 dòng ảnh hưởng / 404 — **notif của B KHÔNG đổi trạng thái** (kiểm bằng GET lại phía B) |
| 4 | User A | — | DELETE notif của B tương tự | Tương tự — chặn |

P: **P2** (badge sai → bỏ sót duyệt tiền, nhưng không mutate tiền trực tiếp). Tự động hoá: **API**.

### TC-FLOW-011 — Exchange rates: hazard đổi FX giữa lúc lưu snapshot và lúc export báo giá
Bằng chứng: `backend/app/api/v1/exchange_rates_api.py:187-188, 240-241, 379-380` — cả 3 endpoint mutate FX đều gọi `invalidate_pricing_caches()` ngay sau upsert.

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1 | Sale | Sourcing entry đã "Lưu đợt tính giá" (frozen `quote_snapshot`) | Admin sửa FX qua PUT `/{currency}` | Giá đã lưu (frozen) **KHÔNG đổi** khi GET lại entry |
| 2 | Sale | Dòng dùng `supplier_price_id` sống (chưa freeze) | Admin sửa FX | Giá tính lại (compute_sale_vnd) **CÓ đổi** theo FX mới |
| 3 | Sale | Đang mở QuoteBatchModal preview, dòng KHÔNG có `fx_rate_override` thủ công | Admin sửa FX (`PUT /exchange-rates/{currency}`) giữa lúc preview (`POST /quote-batch preview=true`) và lúc bấm Gửi (`POST /quote-batch preview=false`) | **Kỳ vọng xác định (đọc code `sourcing.py` hàm `create_quote_batch` dòng ~1828-1950)**: KHÔNG có bất kỳ cơ chế đối chiếu nào (không ETag, không version stamp, không so khớp giá preview-time vs send-time) — cả 2 lần gọi độc lập re-run `compute_sale_vnd(...)` với FX **sống tại thời điểm gọi**. Do đó giá lúc Gửi **SẼ khác âm thầm** giá đã hiển thị lúc preview nếu FX đổi ở giữa, KHÔNG có cảnh báo nào cho sale biết. `invalidate_pricing_caches()` (`exchange_rates_api.py:187-188/240-241/379-380`) chỉ xoá cache trong RAM để lần tính tiếp theo lấy rate mới — không liên quan tới việc so khớp 2 lần gọi. Ca PASS nếu quan sát đúng hành vi "giá lệch âm thầm, không cảnh báo" này (xác nhận gap thiết kế cần Thang quyết định có bổ sung cảnh báo hay không); ca không có nhánh "hệ thống tự cảnh báo" vì code hiện tại không có nhánh đó. |

P: **P1** (FX là nguồn thượng nguồn mọi phép tính tiền toàn hệ). Tự động hoá: **API**.

### TC-FLOW-012 — Leave approval maker-checker: race trên hạn mức
Bằng chứng: `backend/app/api/v1/leave.py:553` (`FOR UPDATE` trên `leave_requests`), `:567` (`FOR UPDATE` trên `leave_balance`), `:575-578` (`new_used > total_col` → 409).

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1 | 2 Manager | User Y còn đúng 1 ngày phép; có 2 đơn nghỉ 1 ngày đang pending | Cả 2 manager duyệt gần như đồng thời (`asyncio.gather`) | Chỉ 1 đơn `approved`, đơn còn lại 409 (do lock `FOR UPDATE` tại `leave.py:567`) |
| 2 | Manager | Đơn `pending`, chưa duyệt | Reject | Số dư phép **KHÔNG bị hoàn** (vì chưa từng trừ ở bước tạo đơn) |

P: **P1** (maker-checker có mutate số dư, tương đương PR tài chính, brainstorm cảnh báo brainstorm gốc bỏ sót). Tự động hoá: **API** (dùng `asyncio.gather` giả lập đồng thời).

### TC-FLOW-013 — procurement_audit_log immutable trigger (tầng DB)
Bằng chứng: `backend/migrations/procurement_audit_immutable.sql:16` `RAISE EXCEPTION`, `:25` `BEFORE UPDATE OR DELETE ON procurement_audit_log`.

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1 | Hệ thống (test script, rollback-txn) | Có ≥1 dòng trong `procurement_audit_log` | Gửi `UPDATE procurement_audit_log SET ... WHERE id=X` thẳng qua DB connection | Trigger raise exception, 0 dòng bị đổi |
| 2 | Hệ thống | — | Gửi `DELETE FROM procurement_audit_log WHERE id=X` | Trigger raise exception, 0 dòng bị xoá |

P: **P1** (bổ sung cho audit quarterly tầng app — đây là lớp chặn tầng DB, khác hẳn). Tự động hoá: **API/script SQL trong transaction ROLLBACK** — không sửa dữ liệu thật.

### TC-FLOW-014 — Workflow engine chung (po_approval/price_change/supplier_onboard/payment_approval)

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1 | Sale/Admin | — | POST tạo workflow request | `status=pending`, xuất hiện ở `/pending/me` của người duyệt đúng role |
| 2 | Approver | Request đã quyết định (approved) | POST `/{id}/action` approve lần 2 | 409 "đã quyết định" |
| 3 | User sai role | Request cần role X duyệt | User role Y gọi action | 403 role-gate |
| 4 | Approver | — | Approve request priority cao trước priority thấp | `/approval-log` ghi đúng thứ tự xử lý thực tế |

P: **P2**. Tự động hoá: **API**.

### TC-FLOW-015 — Reload/F5 giữa thao tác nhập tay (data-loss check)

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1 | Admin | Dossier wizard đã enqueue job | F5 giữa chừng | Job vẫn tiếp tục chạy nền (không phụ thuộc tab mở); `form_data` khôi phục được khi mở lại `?job=id` |
| 2 | Sale | QuoteBatchModal đã nhập 5 dòng, chưa submit | F5 | Kỳ vọng xác định (đọc `frontend/src/components/sourcing/QuoteBatchModal.tsx` dòng 200-237, 856-877): toàn bộ state (`ids`/`customer`/`quoteNote`/`validUntil`/`choices` từng dòng giá) là `useState` thuần — KHÔNG có `localStorage`/`sessionStorage` lưu draft (hit `localStorage` duy nhất trong file chỉ là `access_token` phục vụ tải file, không liên quan state modal). F5 XOÁ TOÀN BỘ 5 dòng đã tick + giá đã nhập — modal đóng, phải làm lại từ đầu. Đây là hành vi THỰC TẾ đã xác nhận qua code (không phải giả định), ghi nhận là gap UX thiếu autosave, KHÔNG phải bug. |
| 3 | Admin | Checkpoint `awaiting_confirm` | F5 | Countdown/trạng thái vẫn do server giữ (không reset về 0 phía client) |

P: **P2** (mất dữ liệu nhập tay = mất công, không mutate sai tiền). Tự động hoá: **UI**.

### TC-FLOW-016 — Suppliers/Purchase Orders vs Sourcing Orders: BUG-GATE "còn dùng thật hay mồ côi"
Bằng chứng: `backend/app/api/v1/suppliers.py`, `backend/app/api/v1/purchase_orders.py` tồn tại song song với sourcing orders (`backend/app/api/v1/sourcing.py` Flow I).

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 0. BUG-GATE trước tiên | QA | — | Grep FE (`songchau-erp/frontend/src`) tìm import gọi `purchase_orders.py` endpoints | Nếu 0 kết quả FE → đánh dấu **code mồ côi**, KHÔNG viết case chức năng, chỉ ghi nhận rủi ro |
| 1 | Admin | NCC có ràng buộc AP/quote | DELETE `/suppliers/{id}` | 409 nếu còn AP/quote tham chiếu (đúng ý brainstorm), không cho xoá cứng |

P: **P2** (P1 nếu BUG-GATE xác nhận có dùng thật — cần chốt trước). Tự động hoá: **API**.

### TC-FLOW-017 — Dashboard KPI đối soát chéo

| Trạm | Vai trò | Setup | Hành động | Kỳ vọng |
|---|---|---|---|---|
| 1 | Admin | Sau khi chạy xong TC-FLOW-001, 002, 008 (đã có dữ liệu tiền thật) | GET `/dashboard/kpis` hoặc `/kpis-v2` | Tổng doanh thu/AP/AR khớp với `/finance-management/*-summary` và `deal_margins` — không ra 2 số khác nhau (nguy cơ W1-50 lặp lại ở tầng dashboard) |

P: **P2**. Tự động hoá: **API**.

---

## TỔNG KẾT

- **Tổng số ca**: 17 luồng kết hợp (TC-FLOW-001..017), trong đó 8 ca gốc CMB-X1..X8 + 9 ca bổ sung từ Đợt bù (TC-FLOW-009..017).
- **Đơn lẻ / Kết hợp**: toàn bộ 17 ca đều là **kết hợp** (mỗi ca đi qua ≥2 mảng theo định nghĩa CMB gốc) — 0 ca đơn lẻ trong file này (test đơn lẻ nằm ở file khác theo 00-INVENTORY/01/02 của E2E test plan đấu thầu, không lặp lại ở đây).
- **Luồng đụng Samsung** (cần checklist **Tay** ở ít nhất 1 trạm): TC-FLOW-001 (dừng ở awaiting_confirm, không cần Tay), TC-FLOW-003 (trạm 4-6, 11 = Tay), TC-FLOW-007 (trạm 7 = Tay). → **2/17 ca có trạm Tay bắt buộc**, phần còn lại của 2 ca đó vẫn chạy API/dry-run tới điểm dừng an toàn.
- **Tự động hoá được hoàn toàn bằng API/UI (0 trạm Tay)**: TC-FLOW-002, 004, 005, 006, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017 = **14/17 ca**.
- **P1**: TC-FLOW-001, 002, 003, 004, 006, 007, 008, 009, 011, 012, 013 = **11 ca**.
- **P2**: TC-FLOW-005, 010, 014, 015, 016 (điều kiện), 017 = **6 ca**.

Ghi chú phương pháp: các con số trên đếm theo **số mục TC-FLOW cấp luồng** trong file này, không đếm số bước con trong bảng (tổng số bước con toàn file = 118 trạm, đếm thủ công theo bảng trên).
