# Test case E2E — Lưu trữ file + quản lý thư mục

Phạm vi: Documents (`/documents`), File Browser (`/documents/browser`), OnlyOffice editor, OCR (Gemini Vision), BQMS Raw/Images ("File mã" + Image Picker), Dossier zip, File đấu thầu NCC (upload/link/xem/tải + admin drawer/zip).

Nguồn bằng chứng: `backend/app/api/v1/document_management.py`, `file_browser.py`, `onlyoffice.py`, `ocr_service.py`, `bqms_images.py`, `files.py`, `bqms.py`, `procurement.py`, `backend/app/etl/bqms_bidding_scraper.py`, `backend/app/api/vendor/quotes.py`, `frontend/src/app/(dashboard)/documents/**`, `frontend/src/app/(dashboard)/vendor-bidding/[id]/page.tsx`.

## Dữ liệu chuẩn bị chung

**Tài khoản** (dùng chung 9 role cố định — không dùng tài khoản thật của Thang):
`test_admin@songchau.test`, `test_manager@songchau.test`, `test_staff@songchau.test`, `test_sales@songchau.test`, `test_procurement@songchau.test`, `test_warehouse@songchau.test`, `test_accountant@songchau.test`, `test_viewer@songchau.test`, `test_director@songchau.test` + 2 vendor (`vendor-a@test`, `vendor-b@test` — thuộc 2 NCC demo khác nhau, để test IDOR chéo NCC) + 1 vendor chưa được mời batch nào (`vendor-c-noinvite@test`).

**Bản ghi/thư mục mồi:**
- `tests/fixtures/files/` — bộ file mẫu chuẩn cố định: `Báo giá  ốc vít 🔧.xlsx` (tên unicode + khoảng trắng kép), `empty.pdf` (0 byte), `boundary_49mb.pdf`/`boundary_50mb.pdf`/`boundary_50mb_plus1.pdf` (biên document upload 50MB), `boundary_99mb.zip`/`boundary_100mb.zip`/`boundary_100mb_plus1.zip` (biên file-browser upload 100MB), `boundary_9mb.png`/`boundary_10mb.png`/`boundary_10mb_plus1.png` (biên vendor/BQMS ảnh 10MB), `fake_exe_as_pdf.pdf` (thực chất là .exe đổi đuôi + Content-Type giả `application/pdf`), `exif_orientation_6.jpg` (ảnh chụp dọc điện thoại), `multi_sheet.xlsx` (nhiều sheet), `header_only.xlsx`, `blank_rows.xlsx`, `broken.pdf` (không parse được), `nested.zip` (zip lồng zip), `sample.docx` (có bảng+ảnh), tên có ký tự cấm dùng trong ca negative (không tạo file thật, chỉ dùng chuỗi tên khi gọi API).
- 1 cây thư mục RFQ thật trên `onedrive-staging` dạng `<rfq>_AMABACNINH` có sẵn `..._L1/` chứa 1 file và `..._L1.archived_<ts>/` (mồi regression "mất File Lần 1").
- 1 mã BQMS có đủ 5 lớp ảnh: primary-pin (DB), override theo RFQ, override theo code, có dòng trong `bqms_image_index`, và có ảnh gốc chỉ nằm trên filesystem (không index) — dùng để test rớt đúng thứ tự ưu tiên khi gỡ dần từng lớp.
- 1 batch đấu thầu demo có 3 NCC được mời (2 NCC test ở trên + 1 NCC chưa nộp báo giá), có ≥1 dòng báo giá đã có `attachment_path` cấp-phiếu và ≥1 item có `attachment_paths[]` cấp-dòng, có 1 item share-file=true và 1 item chưa share.
- 1 tài liệu (`documents`) có bản version con (`parent_id` trỏ tới nó) để test 409 xóa cha trước con.
- 1 document có record DB còn nhưng file vật lý đã bị xóa thủ công trên đĩa (mồi 404 download).

**Lưu ý an toàn — KHÔNG đụng Samsung thật:**
- Mọi ca liên quan `quote_round_subfolder`/scraper chỉ chạy trên thư mục staging cục bộ (không trigger job scrape Samsung thật); nếu ca cần trigger qua API scraper thì dùng job ở trạng thái `queued` và dừng lại ở đó (không chờ worker chạy thật), hoặc tắt worker Procrastinate trong môi trường test.
- Ca `push Samsung` không nằm trong mảng file/folder này (thuộc bộ 118 ca đấu thầu) — nếu một bước nào chạm tới push, chỉ tick checklist tay tới bước xác nhận (preview), KHÔNG bấm nút gửi thật.
- Toàn bộ ca ghi đè/xóa file thật trên `onedrive-staging` dùng prefix `DEMO-`/`TEST-` để glob dọn dẹp ở bước teardown; ca chạm prod dùng transaction rollback khi có thể (áp dụng cho các thao tác chỉ ghi DB, không áp dụng được cho ghi file vật lý — các ca ghi file vật lý bắt buộc chạy ở staging).
- Lớp thực thi ghi ở cột "Tự động hoá": **API** = pytest gọi REST tới ranh giới an toàn; **UI** = thao tác tay/Playwright trên trình duyệt tới điểm dừng an toàn; **Tay** = chỉ Thang thao tác có giám sát (không có trong mảng này vì không đụng Samsung).

## Bảng test case

### A. Documents — danh sách/upload/xóa/version (F-DOC-01..08)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-001 | Danh sách tài liệu load mặc định | Đơn lẻ | staff | Có sẵn ≥3 document | Mở `/documents` | Bảng hiện đủ cột, không lỗi console; skeleton 6 hàng biến mất sau load | P2 | UI |
| TC-FILEFOLDER-002 | Filter theo category qua tab | Đơn lẻ | staff | Có document ở nhiều category | Bấm tab "Hợp đồng" | Chỉ còn document category=contract; URL/param category cập nhật | P2 | UI |
| TC-FILEFOLDER-003 | Filter ref_type + search kết hợp | Kết hợp | manager | Document gắn ref_type=purchase_order, search theo tiêu đề | Gọi `GET /api/v1/documents?ref_type=purchase_order&search=<keyword>` | Chỉ trả bản ghi khớp cả 2 điều kiện; phân trang đúng `total` | P2 | API |
| TC-FILEFOLDER-004 | Empty state khi chưa có tài liệu | State | staff | Tài khoản test filter category chưa từng dùng | Chọn category chưa có bản ghi nào | Hiện empty-state đúng thông điệp, không crash | P3 | UI |
| TC-FILEFOLDER-005 | Upload tài liệu hợp lệ | Đơn lẻ | manager | — | Mở `/documents` → "Tải lên" → chọn `sample.docx`, tiêu đề bắt buộc "Hợp đồng DEMO", category="contract" → "Lưu" | Toast thành công; bản ghi mới xuất hiện đầu danh sách; file lưu tên uuid trên đĩa | P1 | UI |
| TC-FILEFOLDER-006 | Upload thiếu tiêu đề | Negative | manager | — | Chọn file, để trống tiêu đề → "Lưu" | Nút Lưu bị chặn hoặc 422; không tạo bản ghi | P2 | UI |
| TC-FILEFOLDER-007 | Upload category không hợp lệ | Negative | manager | — | Gọi API upload với `category="hacker"` | 400, không tạo bản ghi (ngoài VALID_CATEGORIES) | P2 | API |
| TC-FILEFOLDER-008 | Upload MIME giả mạo qua content_type | BUG-GATE (BG-DOC-01) | manager | `fake_exe_as_pdf.pdf` | Upload file thực chất .exe, đổi Content-Type client = `application/pdf` | KỲ VỌNG HIỆN TẠI = PASS (file lọt qua vì chỉ check content_type client gửi, không magic-byte) — ghi nhận là lỗ hổng đang mở, không phải bug cần fix ngay trong ca này | P1 | API |
| TC-FILEFOLDER-009 | Upload file rỗng | Negative | manager | `empty.pdf` (0 byte) | Upload file 0 byte | 400 "file rỗng" | P2 | API |
| TC-FILEFOLDER-010 | Upload đúng biên 50MB | Đơn lẻ | manager | `boundary_50mb.pdf` | Upload | 201, lưu thành công | P2 | API |
| TC-FILEFOLDER-011 | Upload vượt biên 50MB+1 byte | Negative | manager | `boundary_50mb_plus1.pdf` | Upload | 400/413 từ chối | P2 | API |
| TC-FILEFOLDER-012 | Upload phiên bản mới (versioning) | Đơn lẻ | manager | Có document gốc id=D1 | Upload file mới với `parent_id=D1` | Bản ghi mới có `version=D1.version+1`; D1 vẫn còn | P2 | API |
| TC-FILEFOLDER-013 | Upload version với parent_id không tồn tại | Negative | manager | — | Upload với `parent_id=999999` | 404 | P2 | API |
| TC-FILEFOLDER-014 | Tải tài liệu về thành công | Đơn lẻ | staff | Document hợp lệ | Bấm icon tải trên dòng document | File tải về đúng nội dung/tên gốc | P1 | UI |
| TC-FILEFOLDER-015 | Tải tài liệu khi file vật lý đã mất | Negative | staff | Document có record DB nhưng file đã xóa trên đĩa | Bấm tải | 404, toast lỗi rõ ràng (không crash trang) | P2 | API |
| TC-FILEFOLDER-016 | Xóa tài liệu — quyền admin | Đơn lẻ | admin | Document không có version con | Bấm icon xóa → confirm | Toast xóa thành công; bản ghi biến mất khỏi danh sách | P1 | UI |
| TC-FILEFOLDER-017 | Xóa tài liệu — role không đủ quyền | Negative (role-matrix) | manager/staff/sales/procurement/warehouse/accountant/viewer/director | Document hợp lệ | Gọi `DELETE /api/v1/documents/{id}` | 403 cho tất cả role khác admin | P1 | API |
| TC-FILEFOLDER-018 | Xóa tài liệu có version con | Negative | admin | Document cha có bản ghi con `parent_id` trỏ tới | Bấm xóa cha | 409, yêu cầu xóa con trước | P1 | API |
| TC-FILEFOLDER-019 | Chi tiết tài liệu theo entity | Đơn lẻ | staff | Document gắn `ref_type=purchase_order, ref_id=X` | `GET /by-entity/purchase_order/X` | Trả đúng danh sách document gắn entity đó, không lẫn entity khác | P2 | API |
| TC-FILEFOLDER-020 | Phân trang 20/trang | Đơn lẻ | staff | ≥25 document | Chuyển sang trang 2 | Hiện đúng 5 bản ghi còn lại, không trùng trang 1 | P3 | UI |

### B. Files API — upload/gắn entity/dedup (F-FILES-01..03)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-021 | Upload file gắn entity hợp lệ | Đơn lẻ | staff | `ref_type=bqms_rfq, ref_id=<rfq test>` | `POST /api/v1/files/upload` | 201, trả file_id, sha256 lưu đúng | P2 | API |
| TC-FILEFOLDER-022 | ref_type ngoài whitelist | Negative | staff | — | Upload với `ref_type="hacker"` | 400 | P1 | API |
| TC-FILEFOLDER-023 | Dedup cùng nội dung cùng ref | Đơn lẻ | staff | File đã upload 1 lần cho `(ref_type, ref_id)` | Upload lại đúng file đó cùng ref | 200 "duplicate" (không phải 201), không tạo bản ghi mới trên đĩa | P2 | API |
| TC-FILEFOLDER-024 | Cùng nội dung khác ref_type | Đơn lẻ | staff | File đã gắn `ref_type=purchase_order` | Upload cùng nội dung với `ref_type=supplier` khác ref_id | 201, lưu bản ghi mới (dedup chỉ áp dụng cùng ref) | P2 | API |
| TC-FILEFOLDER-025 | Xem metadata file | Đơn lẻ | staff | file_id hợp lệ | `GET /api/v1/files/{file_id}` | Trả đúng metadata (tên, size, sha256, ref) | P3 | API |
| TC-FILEFOLDER-026 | Tải file theo id | Đơn lẻ | staff | file_id hợp lệ | `GET /api/v1/files/{file_id}/download` | Nội dung tải về khớp sha256 gốc | P2 | API |

### C. File Browser — duyệt/CRUD/kéo-thả (F-FB-01..15)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-027 | Duyệt thư mục gốc | Đơn lẻ | staff | — | Mở `/documents/browser` | Danh sách folder BQMS/BG/IMV/EAE/LG/AMA Quotation lên đầu; breadcrumb "Trang chủ" | P1 | UI |
| TC-FILEFOLDER-028 | Sắp xếp theo tên/size/modified/type | Kết hợp | staff | Folder có ≥5 mục | Bấm header cột "Tên" rồi "Kích thước" rồi "Sửa lần cuối" | Thứ tự đổi đúng asc/desc theo cột chọn | P3 | UI |
| TC-FILEFOLDER-029 | Ẩn folder/file hệ thống | Đơn lẻ | staff | Folder chứa `desktop.ini`, `Thumbs.db`, `.lnk` | Mở folder đó | Các file hệ thống KHÔNG hiện trong danh sách | P2 | API |
| TC-FILEFOLDER-030 | Role đọc được phép (role-matrix) | Đơn lẻ (matrix) | staff/warehouse/sales/accountant/manager/director/admin | — | `GET /folder` với từng role | 200 cho cả 7 role | P1 | API |
| TC-FILEFOLDER-031 | Role đọc bị chặn | Negative (role-matrix) | procurement (nếu không thuộc 7 role đọc) | — | `GET /folder` | 403 nếu role không nằm trong danh sách được phép — ghi nhận lại role thực tế được cấp theo code, không giả định | P2 | API |
| TC-FILEFOLDER-032 | Filter theo loại file | Đơn lẻ | staff | Folder trộn nhiều loại file | `GET /folder?type=excel` | Chỉ trả file .xlsx/.xls | P2 | API |
| TC-FILEFOLDER-033 | Tìm kiếm tên file — độ dài tối thiểu | Negative | staff | — | `GET /search?q=a` (1 ký tự) | 422 (min_length=2) | P2 | API |
| TC-FILEFOLDER-034 | Tìm kiếm tên file hợp lệ | Đơn lẻ | staff | File tên chứa "báo giá" | `GET /search?q=báo giá` | Trả đúng file khớp, không phân biệt path | P2 | API |
| TC-FILEFOLDER-035 | Tìm kiếm limit biên 1-200 | Negative | staff | — | `GET /search?q=ab&limit=201` | 422 | P3 | API |
| TC-FILEFOLDER-036 | Preview Excel nhiều sheet | Đơn lẻ | staff | `multi_sheet.xlsx` trong staging | Bấm file → xem preview | Hiện đủ tab sheet, chuyển tab đọc đúng dữ liệu từng sheet | P2 | UI |
| TC-FILEFOLDER-037 | Preview PDF | Đơn lẻ | staff | File pdf hợp lệ | Bấm file pdf | Hiện iframe PDF load được | P2 | UI |
| TC-FILEFOLDER-038 | Preview PDF không parse được | Negative | staff | `broken.pdf` | Bấm file | Hiện thông báo lỗi preview rõ ràng, không crash trang, vẫn cho phép tải xuống | P2 | UI |
| TC-FILEFOLDER-039 | Preview Word trích text | Đơn lẻ | staff | `sample.docx` có bảng+ảnh | Bấm file docx | Hiện text trích từ document.xml (chấp nhận không hiện ảnh/bảng đầy đủ), không lỗi 500 | P2 | UI |
| TC-FILEFOLDER-040 | Preview ZIP liệt kê entries | Đơn lẻ | staff | `nested.zip` (zip lồng zip) | Bấm file zip | Liệt kê danh sách entry cấp 1, không tự giải nén đệ quy gây treo | P3 | UI |
| TC-FILEFOLDER-041 | Preview loại không hỗ trợ | State | staff | File .step/.dwg CAD | Bấm file | Hiện "không hỗ trợ preview" + vẫn cho tải xuống | P3 | UI |
| TC-FILEFOLDER-042 | Tải xuống dl=1 giữ đúng đuôi file (regression) | Đơn lẻ | staff | File tên có dấu | `GET /file/download?...&dl=1` | Header `Content-Disposition: attachment; filename=...` giữ nguyên đuôi file, Windows không mất đuôi | P1 | API |
| TC-FILEFOLDER-043 | Xem inline dl=0 | Đơn lẻ | staff | File pdf | `GET /file/download?...&dl=0` | Trả inline, không ép tải xuống | P3 | API |
| TC-FILEFOLDER-044 | Thống kê thư mục | Đơn lẻ | staff | Folder có nhiều loại file | `GET /stats` | Tổng file/size khớp thực tế; phân loại theo category đúng | P3 | API |
| TC-FILEFOLDER-045 | Upload nhiều file cùng lúc | Đơn lẻ | staff | 3 file hợp lệ khác loại | Mở browser → kéo-thả 3 file vào 1 folder | Toast/summary từng file OK; cả 3 xuất hiện trong danh sách | P1 | UI |
| TC-FILEFOLDER-046 | Upload đúng biên 100MB | Đơn lẻ | staff | `boundary_100mb.zip` | Upload | 200/201, ghi thành công qua stream chunk | P2 | API |
| TC-FILEFOLDER-047 | Upload vượt biên 100MB+1 | Negative | staff | `boundary_100mb_plus1.zip` | Upload | 400/413 (preflight FE chặn trước, hard check BE chặn sau nếu bypass FE) | P2 | API |
| TC-FILEFOLDER-048 | Upload extension ngoài whitelist | Negative | staff | file .exe thật | Upload | 400, không lưu | P1 | API |
| TC-FILEFOLDER-049 | Upload tên chứa ký tự cấm | Negative | staff | Tên file `bad<>name.pdf` | Upload | 400, chặn ký tự cấm | P2 | API |
| TC-FILEFOLDER-050 | Upload trùng tên, overwrite=false | Negative | staff | File cùng tên đã tồn tại tại đích | Upload lại không tick overwrite | 409 | P2 | API |
| TC-FILEFOLDER-051 | Upload trùng tên, overwrite=true | Đơn lẻ | staff | File cùng tên đã tồn tại | Upload lại có `overwrite=true` | 200, file cũ bị ghi đè | P2 | API |
| TC-FILEFOLDER-052 | Upload tên unicode + emoji | Đơn lẻ | staff | `Báo giá  ốc vít 🔧.xlsx` | Upload | Lưu thành công, tên hiển thị đúng không lỗi encoding | P2 | UI |
| TC-FILEFOLDER-053 | Role ghi bị chặn (role-matrix upload) | Negative (matrix) | sales/procurement/warehouse/accountant/viewer/director | File hợp lệ | `POST /file/upload` | 403 (chỉ admin/manager/staff được ghi) | P1 | API |
| TC-FILEFOLDER-054 | Tạo thư mục mới hợp lệ | Đơn lẻ | staff | — | Mở browser → "Tạo thư mục" → nhập "DEMO-Folder-01" → Lưu | Toast thành công; folder mới xuất hiện | P1 | UI |
| TC-FILEFOLDER-055 | Tạo thư mục tên rỗng | Negative | staff | — | "Tạo thư mục" → để trống tên → Lưu | 400, nút Lưu bị chặn hoặc báo lỗi | P2 | UI |
| TC-FILEFOLDER-056 | Tạo thư mục tên chứa ký tự cấm | Negative | staff | — | Nhập tên `Ho:so*moi` | 400 | P2 | API |
| TC-FILEFOLDER-057 | Tạo thư mục trùng tên | Negative | staff | Folder "DEMO-Folder-01" đã tồn tại | Tạo lại cùng tên | 409 | P2 | API |
| TC-FILEFOLDER-058 | Di chuyển file bằng kéo-thả | Đơn lẻ | staff | File A ở folder gốc, folder đích tồn tại | Kéo file A thả vào folder đích | File biến mất khỏi vị trí cũ, xuất hiện ở đích | P1 | UI |
| TC-FILEFOLDER-059 | Di chuyển source không tồn tại | Negative | staff | — | `POST /file/move` với source ảo | 404 | P2 | API |
| TC-FILEFOLDER-060 | Di chuyển đích không phải thư mục | Negative | staff | Đích là 1 file, không phải folder | Move vào "đích" đó | 400 | P2 | API |
| TC-FILEFOLDER-061 | Di chuyển trùng tên tại đích | Negative | staff | Đích đã có file cùng tên | Move | 409 | P2 | API |
| TC-FILEFOLDER-062 | Đổi tên inline — Enter lưu | Đơn lẻ | staff | File tồn tại | Double-click tên file → sửa → nhấn Enter | Tên cập nhật, toast thành công | P2 | UI |
| TC-FILEFOLDER-063 | Đổi tên inline — Escape hủy | Đơn lẻ | staff | File tồn tại | Bắt đầu sửa tên → nhấn Escape | Tên giữ nguyên, không gọi API | P3 | UI |
| TC-FILEFOLDER-064 | Đổi tên rỗng/ký tự cấm | Negative | staff | File tồn tại | Sửa tên thành rỗng hoặc `a/b.pdf` | 400 | P2 | API |
| TC-FILEFOLDER-065 | Đổi tên trùng tên đã tồn tại | Negative | staff | 2 file cùng folder | Đổi tên file A thành tên trùng file B | 409 | P2 | API |
| TC-FILEFOLDER-066 | Xóa file đơn (không phải folder) | Đơn lẻ | admin | File tồn tại | Bấm xóa → confirm | Xóa thật, biến mất khỏi danh sách | P1 | UI |
| TC-FILEFOLDER-067 | Xóa folder rỗng | Đơn lẻ | manager | Folder không có nội dung | Xóa | Xóa thật ngay, không cần soft-delete | P2 | API |
| TC-FILEFOLDER-068 | Xóa folder có nội dung, recursive=false | Negative | manager | Folder có ≥1 file bên trong | `DELETE /file/delete` không kèm recursive | 400 yêu cầu recursive=true | P1 | API |
| TC-FILEFOLDER-069 | Xóa folder có nội dung, recursive=true (soft-delete) | Đơn lẻ | admin | Folder "DEMO-ToDelete" có file bên trong | Modal xác nhận hiện rõ "soft-delete" → confirm | Folder đổi tên `.trash_<ts>_DEMO-ToDelete`, KHÔNG mất dữ liệu vật lý | P1 | UI |
| TC-FILEFOLDER-070 | Không có nút khôi phục sau soft-delete (ghi nhận hành vi) | BUG-GATE (BG-FB-01) | admin | Vừa soft-delete 1 folder | Vào lại `/documents/browser`, tìm cách khôi phục | KỲ VỌNG HIỆN TẠI = FAIL đúng nghĩa "chưa có UI khôi phục" — chỉ hiện text hướng dẫn dùng shell `mv`; ghi nhận rủi ro thao tác nhầm không tự phục hồi qua UI | P1 | UI |
| TC-FILEFOLDER-071 | Xóa bởi role không đủ quyền | Negative (role-matrix) | staff/sales/procurement/warehouse/accountant/viewer/director | File/folder hợp lệ | `DELETE /file/delete` | 403 (chỉ admin/manager) | P1 | API |
| TC-FILEFOLDER-072 | Mở file Office trong OnlyOffice từ preview | Đơn lẻ | staff | File .xlsx | Preview file → thấy nút "Sửa" → bấm | Mở tab mới `/documents/edit?path=...` | P2 | UI |
| TC-FILEFOLDER-073 | Nút "Sửa" không hiện với file không phải Office | State | staff | File .pdf | Preview file pdf | Không có nút "Sửa" | P3 | UI |
| TC-FILEFOLDER-074 | Chuyển view List/Grid | Đơn lẻ | staff | — | Bấm toggle view | Layout đổi đúng, dữ liệu không đổi | P3 | UI |
| TC-FILEFOLDER-075 | Refresh + SyncFreshnessChip | Đơn lẻ | staff | — | Bấm "Làm mới" | Danh sách reload, chip hiển thị thời điểm đồng bộ mới | P3 | UI |
| TC-FILEFOLDER-076 | Empty state "Thư mục trống" | State | staff | Folder rỗng | Mở folder rỗng | Hiện đúng thông điệp, không lỗi | P3 | UI |
| TC-FILEFOLDER-077 | Loading spinner khi tải/search chậm | State | staff | — | Mở folder lớn/tìm kiếm | Spinner hiện trong lúc chờ, biến mất khi xong | P3 | UI |
| TC-FILEFOLDER-078 | Path traversal qua tham số path (folder) | Negative bảo mật | staff | — | `GET /folder?path=../../../../etc` | 400/403, không leak ngoài `ALLOWED_ROOT` | P1 | API |
| TC-FILEFOLDER-079 | Path traversal qua tên khi rename/create | Negative bảo mật | staff | — | Rename/tạo folder tên `../evil` | 400 (chặn theo cùng quy tắc ký tự cấm) | P1 | API |

### D. OnlyOffice — chỉnh sửa file trực tuyến (F-OO-01..05)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-080 | Lấy config editor thành công | Đơn lẻ | staff | File .xlsx hợp lệ | `GET /onlyoffice/config?path=...` | 200, trả `documentType=cell` đúng loại file, token ký hợp lệ TTL 4h | P1 | API |
| TC-FILEFOLDER-081 | documentType map đúng theo loại file (regression) | Kết hợp | staff | .xlsx/.docx/.pptx/.pdf | Gọi config cho từng loại | `documentType` = cell/word/slide/pdf tương ứng, không rơi vào "spreadsheet" (bug lịch sử từng crash editor) | P1 | API |
| TC-FILEFOLDER-082 | Config bởi role không được phép | Negative (role-matrix) | vendor (hoặc role ngoài 7 role cho phép) | — | Gọi config | 403 | P1 | API |
| TC-FILEFOLDER-083 | Session param tạo doc_key mới mỗi lần mở | Đơn lẻ | staff | Mở cùng 1 file 2 lần | Gọi config lần 1 rồi lần 2 với session khác nhau | `doc_key` khác nhau giữa 2 lần → tránh state cũ | P2 | API |
| TC-FILEFOLDER-084 | Serve file cho container qua token hợp lệ | Đơn lẻ | (service-to-service) | Token từ config vừa lấy | `GET /onlyoffice/file?token=...` | 200, trả đúng nội dung file | P2 | API |
| TC-FILEFOLDER-085 | Token hết hạn (>4h) | Negative bảo mật | — | Token TTL đã qua 4h (mock thời gian hoặc token cũ) | `GET /onlyoffice/file?token=<expired>` | 401/403 từ chối | P1 | API |
| TC-FILEFOLDER-086 | Token chữ ký sai | Negative bảo mật | — | Token bị sửa 1 ký tự | `GET /onlyoffice/file?token=<tampered>` | 401/403 | P1 | API |
| TC-FILEFOLDER-087 | Path traversal qua token/path ngoài ALLOWED_ROOT | Negative bảo mật | — | Cố tạo token trỏ path `../../etc/passwd` | Gọi `/onlyoffice/file` | 400/403, không đọc được file ngoài root | P1 | API |
| TC-FILEFOLDER-088 | Callback lưu khi save (status=2) | Đơn lẻ | (OnlyOffice service) | File đang mở editor | Giả lập callback `status=2, url=<file mới>` | File trên đĩa bị ghi đè bản mới; backup cũ lưu vào `.onlyoffice-backups/{name}.bak-{ts}` | P1 | API |
| TC-FILEFOLDER-089 | Backup giữ tối đa 3 bản, purge bản cũ nhất | Kết hợp | (OnlyOffice service) | Đã có 3 bản backup từ trước | Trigger callback save lần thứ 4 | Chỉ còn 3 bản backup mới nhất, bản cũ nhất (thứ 1) bị xóa | P2 | API |
| TC-FILEFOLDER-090 | Callback trigger re-render PDF nền sau response | Đơn lẻ | (OnlyOffice service) | File Excel có sheet in được | Callback save thành công | Response trả về ngay (không chờ Gotenberg, tránh timeout 30s); PDF preview cập nhật sau vài giây | P2 | API |
| TC-FILEFOLDER-091 | Callback status lỗi editor-side (3/7) | Negative | (OnlyOffice service) | — | Giả lập callback `status=3` | Ghi log lỗi, KHÔNG ghi đè file, response vẫn 200 cho OnlyOffice biết đã nhận | P2 | API |
| TC-FILEFOLDER-092 | SSRF qua payload.url callback (ghi nhận bảo mật) | Negative bảo mật, BUG-GATE (BG-OO-01) | (attacker giả lập OnlyOffice) | — | Gửi callback `status=2, url="http://169.254.169.254/..."` (hoặc domain ngoài nội bộ) | KỲ VỌNG HIỆN TẠI = PASS request đi thẳng (không validate domain nội bộ) → xác nhận lỗ hổng SSRF nội bộ đang mở, đề xuất whitelist domain OnlyOffice container | P1 | API |
| TC-FILEFOLDER-093 | Force-save thủ công qua nút Save | Đơn lẻ | staff | Editor đang mở, có thay đổi chưa lưu | Trong editor bấm "Save" (UI OnlyOffice) → gọi `POST /onlyoffice/force-save` | 200, file lưu ngay, không cần đóng tab | P2 | UI |
| TC-FILEFOLDER-094 | Force-save khi command service unreachable | Negative | staff | Mock OnlyOffice CommandService down | Bấm Save | 502, toast lỗi rõ ràng cho user | P3 | API |
| TC-FILEFOLDER-095 | 2 user mở cùng file đồng thời — last-write-wins | Kết hợp (concurrency) | manager + staff | File dùng chung, mở đồng thời 2 session khác nhau | User A sửa & lưu → User B sửa (dựa trên bản cũ) & lưu | doc_key khác nhau theo session nhưng file đĩa CHUNG → bản của B ghi đè A; backup `.bak` vẫn giữ được bản trung gian (của A) trước khi B ghi đè | P1 | UI |
| TC-FILEFOLDER-096 | Trang editor — step tracker đủ 4 bước | Đơn lẻ | staff | — | Mở `/documents/edit?path=...` | Log hiện tuần tự load_script→fetch_config→init_editor→ready; timeout 30s nếu treo | P3 | UI |
| TC-FILEFOLDER-097 | Editor init timeout | Negative | staff | Mock network chậm/OnlyOffice down | Mở trang edit | Sau 30s hiện lỗi timeout rõ ràng, không treo vô hạn | P3 | UI |

### E. OCR (Gemini Vision) (F-OCR-01..04)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-098 | Upload ảnh hợp lệ trích xuất OCR | Đơn lẻ | staff | Ảnh hóa đơn jpg | Mở `/documents/ocr` → chọn ảnh → "Trích xuất" | Record `processing`→`completed`; kết quả JSON có cấu trúc, confidence hiển thị | P1 | UI |
| TC-FILEFOLDER-099 | Upload PDF hợp lệ | Đơn lẻ | staff | `broken.pdf` thay bằng PDF hợp lệ | Trích xuất | Thành công, trả JSON | P2 | UI |
| TC-FILEFOLDER-100 | MIME ngoài whitelist | Negative | staff | file .bmp | Trích xuất | 400 | P2 | API |
| TC-FILEFOLDER-101 | Vượt 20MB | Negative | staff | Ảnh >20MB | Trích xuất | 400 | P2 | API |
| TC-FILEFOLDER-102 | GEMINI_API_KEY trống | Negative | staff | Env trống (mock) | Trích xuất | 503, record không kẹt ở `processing` nếu lỗi xảy ra TRƯỚC insert; nếu lỗi giữa chừng sau insert → ghi nhận record có thể kẹt `processing` (xem TC-108) | P1 | API |
| TC-FILEFOLDER-103 | document_id không tồn tại | Negative | staff | — | Trích xuất kèm `document_id=999999` | 404 | P2 | API |
| TC-FILEFOLDER-104 | Gemini trả JSON không đúng cấu trúc | Kết hợp | staff | Mock Gemini trả text tự do | Trích xuất | Fallback `raw_text_summary`, confidence=40 (thay vì 85 khi JSON chuẩn) | P2 | API |
| TC-FILEFOLDER-105 | Danh sách kết quả OCR phân trang + filter status | Đơn lẻ | staff | ≥25 record OCR nhiều status | Mở `/documents/ocr` → filter status=completed → trang 2 | Đúng số lượng, đúng status lọc | P2 | UI |
| TC-FILEFOLDER-106 | Chi tiết 1 kết quả OCR | Đơn lẻ | staff | 1 record hoàn tất | Bấm vào 1 dòng | Hiện chi tiết JSON đầy đủ | P3 | UI |
| TC-FILEFOLDER-107 | Role không đủ quyền OCR | Negative (role-matrix) | sales/procurement/warehouse/accountant/viewer/director | — | Gọi `/ocr/extract` | 403 (chỉ staff/manager/admin) | P2 | API |
| TC-FILEFOLDER-108 | Record OCR kẹt "processing" khi Gemini lỗi giữa chừng | BUG-GATE (BG-OCR-01) | staff | Mock exception không phải HTTPException giữa lúc gọi Gemini (sau khi đã insert record `processing`) | Trích xuất, gây lỗi mock | KỲ VỌNG HIỆN TẠI = FAIL đúng nghĩa "kẹt vĩnh viễn": record vẫn ở `processing`, không có cron/watchdog dọn — ghi nhận đề xuất thêm watchdog | P2 | API |

### F. BQMS Folder management — regression "mất File Lần 1" (F-BQMS-FOLDER-01..05)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-109 | Tạo folder RFQ pretty-name lần đầu (idempotent) | Đơn lẻ | (job scrape, dừng ở queued) | RFQ mới chưa có folder | Gọi hàm `ensure_rfq_folder_on_scrape` (qua job dừng ở queued, không chờ worker) hoặc unit test trực tiếp | Folder `<rfq>_AMABACNINH` tạo đúng 1 lần | P2 | API |
| TC-FILEFOLDER-110 | Gọi lại ensure_rfq_folder_on_scrape khi folder đã có | Đơn lẻ (idempotency) | — | Folder đã tồn tại từ TC-109 | Gọi lại hàm lần 2 | Không tạo trùng, không lỗi, tìm thấy folder cũ (dù naming convention cũ/mới) | P1 | API |
| TC-FILEFOLDER-111 | Tìm folder RFQ theo convention cũ | Đơn lẻ | — | Folder đặt tên theo convention cũ (không có suffix chuẩn) | Gọi `find_existing_rfq_folder` | Vẫn tìm ra đúng folder | P2 | API |
| TC-FILEFOLDER-112 | Regenerate cùng round — archive giữ lịch sử (regression chính) | Đơn lẻ, quan trọng | — | RFQ có folder `_L1/` sẵn chứa 1 file (từ fixture) | Gọi `quote_round_subfolder(round_n=1)` lần thứ 2 (regenerate) | Folder `_L1/` cũ được rename thành `_L1.archived_<ts>/` giữ nguyên file cũ; folder `_L1/` mới tạo ra SẠCH (rỗng) để autofill ghi file mới | P1 | API |
| TC-FILEFOLDER-113 | Regenerate cùng round 2 lần liên tiếp trong <1s | Kết hợp (concurrency) | — | Folder `_L1/` mới tinh | Gọi `quote_round_subfolder(round_n=1)` 2 lần liên tiếp ngay lập tức (đụng counter suffix cùng timestamp giây) | Cả 2 lần archive đều tạo thư mục archive TÊN KHÁC NHAU (có suffix counter `_1`, `_2`...), không ghi đè lẫn nhau, không exception | P1 | API |
| TC-FILEFOLDER-114 | Regenerate khi rename lỗi (mô phỏng quyền/cross-device) | BUG-GATE (BG-BQMS-01) | — | Mock `sub.rename()` raise OSError | Gọi `quote_round_subfolder(round_n=1)` regenerate | KỲ VỌNG HIỆN TẠI = FAIL đúng nghĩa "mất lịch sử": fallback in-place reuse (không archive được), chỉ log warning, KHÔNG chặn upload → file cũ có thể bị ghi đè mất lịch sử; ghi nhận rủi ro, đề xuất chặn cứng thay vì chỉ log | P1 | API |
| TC-FILEFOLDER-115 | List subfolders trong RFQ root (loại trừ raw/images) | Đơn lẻ | staff | RFQ có `_L1/, _L2/, raw/, images/` | `GET /rfq/{rfq_id}/subfolders` | Chỉ trả `_L1, _L2`, KHÔNG có `raw/images` | P2 | API |
| TC-FILEFOLDER-116 | Đổi tên subfolder trong RFQ | Đơn lẻ | admin/manager | Subfolder `_L1` tồn tại | Đổi tên thành `_L1_renamed` | Thành công, root RFQ KHÔNG đổi tên (chỉ subfolder con) | P2 | API |
| TC-FILEFOLDER-117 | Không cho đổi tên root RFQ qua endpoint này | Negative | admin | — | Gọi rename với path = root RFQ | 400 (chỉ cho phép đổi subfolder bên trong) | P2 | API |

### G. BQMS "File mã" (Raw/Images) + Share cho NCC (F-BQMS-FILE-01..03)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-118 | Mở "File mã" tìm thấy folder | Đơn lẻ | procurement | Mã BQMS có folder Raw/Images thật | Trên trang liên quan mã, bấm nút "File mã" (BqmsCodeFilesButton) | Modal hiện danh sách file trong Raw/Images | P1 | UI |
| TC-FILEFOLDER-119 | "File mã" không tìm thấy folder | State | procurement | Mã BQMS chưa có folder nào | Bấm "File mã" | `exists:false` + danh sách path đã probe (±1 tháng × 2 năm) hiển thị rõ, không lỗi 500 | P2 | API |
| TC-FILEFOLDER-120 | Vendor không truy cập được "File mã" | Negative (role-matrix) | vendor | — | Gọi `GET /bidding/folder` | 403 | P1 | API |
| TC-FILEFOLDER-121 | Tải 1 file trong Raw/Images | Đơn lẻ | procurement | File tồn tại trong folder | Bấm tải trên 1 dòng trong modal | Tải về đúng nội dung | P2 | UI |
| TC-FILEFOLDER-122 | Share 1 file Raw cho NCC — mặc định KHÔNG share | State | admin | Item mới, chưa share file nào | Mở danh sách shared-files của item | Danh sách rỗng theo mặc định | P2 | API |
| TC-FILEFOLDER-123 | Bật share-file cho 1 file | Đơn lẻ | admin | Item có file Raw | Toggle share 1 file → "Chia sẻ" | File chuyển trạng thái shared; audit log ghi `item_share_file` | P1 | UI |
| TC-FILEFOLDER-124 | Tắt share-file | Đơn lẻ | admin | File đang share | Toggle tắt | Audit log ghi `item_unshare_file`; NCC không còn thấy file | P2 | UI |
| TC-FILEFOLDER-125 | Share-file với kind ngoài raw/images | Negative | admin | — | Gọi API share với `kind="video"` | 400 | P2 | API |
| TC-FILEFOLDER-126 | NCC xem file được share không lộ rfq_number | Negative bảo mật | vendor | File đã share cho batch của vendor đó | NCC tải file share | Tải thành công nhưng response/metadata KHÔNG lộ `rfq_number` gốc | P1 | API |

### H. BQMS Image — resolve/picker/crop/pin (F-BQMS-IMG-01..10)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-127 | Resolve ảnh — ưu tiên primary-pin | Đơn lẻ, quan trọng | staff | Mã có đủ 5 lớp ảnh (fixture) | `GET /rfq/image?code=<mã>` | Trả đúng ảnh đã ghim primary (DB), bỏ qua các lớp khác | P1 | API |
| TC-FILEFOLDER-128 | Resolve ảnh — gỡ primary-pin, rớt về override RFQ | Đơn lẻ, quan trọng | staff | Gỡ primary-pin của mã ở TC-127 | Gọi lại resolve | Trả đúng ảnh override theo RFQ (lớp 2) | P1 | API |
| TC-FILEFOLDER-129 | Resolve ảnh — gỡ tiếp, rớt về override code | Đơn lẻ | staff | Gỡ override RFQ | Gọi lại resolve | Trả ảnh override theo code (lớp 3) | P1 | API |
| TC-FILEFOLDER-130 | Resolve ảnh — gỡ tiếp, rớt về image_index | Đơn lẻ | staff | Gỡ override code | Gọi lại resolve | Trả ảnh theo `bqms_image_index` (lớp 4) | P1 | API |
| TC-FILEFOLDER-131 | Resolve ảnh — gỡ tiếp, rớt về filesystem scan | Đơn lẻ | staff | Gỡ record image_index | Gọi lại resolve | Trả ảnh tìm được qua tiered filesystem scan (lớp 5 cuối) | P1 | API |
| TC-FILEFOLDER-132 | Resolve ảnh — mã không có ảnh nào | State | staff | Mã trống hoàn toàn | Gọi resolve | Trả placeholder/404 rõ ràng, không 500 | P2 | API |
| TC-FILEFOLDER-133 | Upload ảnh override cho slot form báo giá | Đơn lẻ | staff | slot="product_photo" | `POST /quote-image-override` với ảnh png <5MB | 200, override lưu đúng slot | P2 | API |
| TC-FILEFOLDER-134 | Upload override vượt 5MB | Negative | staff | Ảnh >5MB | Upload | 400 | P2 | API |
| TC-FILEFOLDER-135 | Upload override MIME sai | Negative | staff | file .gif | Upload | 400 (chỉ png/jpg/jpeg) | P2 | API |
| TC-FILEFOLDER-136 | rfq_number/bqms_code sai định dạng regex | Negative | staff | `rfq_number="abc; DROP TABLE"` | Upload override | 400 (regex `[A-Z0-9-_]`) | P1 | API |
| TC-FILEFOLDER-137 | Xóa override ảnh form báo giá | Đơn lẻ | staff | Override tồn tại | `DELETE` override | Xóa thành công; `GET /check` trả không còn override | P2 | API |
| TC-FILEFOLDER-138 | Image Picker liệt kê mọi ảnh biết về 1 mã | Đơn lẻ | staff | Mã có ảnh own/upload/sibling | Mở `GET /code/{code}/images` | Trả đủ danh sách phân nhóm own/upload/sibling | P2 | API |
| TC-FILEFOLDER-139 | Serve ảnh thumbnail có normalize EXIF | Đơn lẻ | staff | Ảnh EXIF orientation 6 | `GET /code/{code}/image-blob?normalize=true` | Ảnh trả về đã xoay đúng chiều | P2 | API |
| TC-FILEFOLDER-140 | Ghim ảnh chính (pin primary) | Đơn lẻ | staff | Mở Image Picker | Chọn 1 ảnh → "Đặt làm ảnh chính" | `POST /code/{code}/primary-image` 200; resolve sau đó trả đúng ảnh vừa ghim | P1 | UI |
| TC-FILEFOLDER-141 | Bỏ ghim ảnh chính | Đơn lẻ | staff | Ảnh đang được ghim | "Bỏ ghim" | `DELETE /code/{code}/primary-image` 200; resolve rớt xuống lớp kế tiếp | P2 | UI |
| TC-FILEFOLDER-142 | Xóa 1 ảnh override/crop | Đơn lẻ | staff | Ảnh override tồn tại (không phải ảnh gốc Samsung) | Xóa ảnh trong picker | Thành công, không còn trong danh sách | P2 | UI |
| TC-FILEFOLDER-143 | Không xóa được ảnh gốc từ Samsung | Negative | staff | Ảnh gốc (không nằm trong override roots) | Cố xóa ảnh gốc | 400/403, chặn xóa | P1 | API |
| TC-FILEFOLDER-144 | Crop ảnh EXIF orientation 6 (regression) | Đơn lẻ, quan trọng | staff | `exif_orientation_6.jpg` | Mở picker → chọn ảnh dọc từ điện thoại → crop đúng vùng người dùng thấy trên browser → Lưu | Ảnh crop khớp đúng vùng nhìn thấy (không lệch do EXIF); tự động ghim làm primary | P1 | UI |
| TC-FILEFOLDER-145 | Crop vùng <4px | Negative | staff | — | Kéo vùng crop cực nhỏ | 400 | P2 | API |
| TC-FILEFOLDER-146 | Crop tọa độ vượt biên ảnh | Negative | staff | — | Gửi tọa độ crop âm/vượt kích thước ảnh | Clamp về trong biên ảnh, không lỗi 500 | P2 | API |
| TC-FILEFOLDER-147 | Upload ảnh mới cho mã (auto index + auto primary) | Đơn lẻ | staff | — | "Tải ảnh lên" trong picker, chọn file <10MB png/jpg | Ảnh mới lưu, tự động thêm vào `bqms_image_index`, tự động ghim primary | P1 | UI |
| TC-FILEFOLDER-148 | Upload ảnh mã vượt 10MB | Negative | staff | `boundary_10mb_plus1.png` | Upload | 400 | P2 | API |

### I. Dossier — tải folder giao hàng dạng zip (F-DOSSIER-ZIP-01)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-149 | Tải zip dossier job hoàn tất | Đơn lẻ | warehouse | Job dossier status=done, có `output_folder` thật trên đĩa | `GET /deliveries/dossier-job/{job_id}/folder.zip` | 200, tải về zip chứa toàn bộ thư mục con đệ quy | P1 | API |
| TC-FILEFOLDER-150 | Tải zip job chưa có output_folder | Negative | warehouse | Job status=queued/running (chưa có output) | Gọi tải zip | 404 | P2 | API |
| TC-FILEFOLDER-151 | Tải zip khi thư mục đã bị xóa khỏi đĩa | Negative | warehouse | Job done nhưng thư mục đã xóa thủ công | Gọi tải zip | 404, không crash | P2 | API |
| TC-FILEFOLDER-152 | Path-guard chặn ngoài thư mục Giao hàng | Negative bảo mật | admin | — | Cố truyền `job_id` trỏ output_folder ngoài `/Puplic/BQMS/Giao hàng` (nếu có thể mock) | 400/403, không cho tải file ngoài phạm vi pin cứng | P1 | API |

### J. File đấu thầu — NCC upload/link/xem (F-VENDOR-UP-01..03)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-153 | NCC upload file đính kèm báo giá hợp lệ | Đơn lẻ | vendor (vendor-a) | Đã được mời batch demo | Đăng nhập cổng NCC → mở batch → chọn file `.xlsx` <10MB → "Tải lên" | 200, `attachment_path` của round mới nhất được cập nhật | P1 | UI |
| TC-FILEFOLDER-154 | NCC upload magic-byte giả (đổi đuôi .jpg thật) | Đơn lẻ, quan trọng | vendor | File thực chất khác định dạng đổi đuôi thành .jpg | Upload | 400 — bị chặn bởi magic-byte check (khác với document_management không có check này — ghi nhận CHÊNH LỆCH giữa 2 đường upload) | P1 | API |
| TC-FILEFOLDER-155 | NCC upload extension ngoài whitelist | Negative | vendor | file .exe | Upload | 400 | P1 | API |
| TC-FILEFOLDER-156 | NCC upload vượt 10MB | Negative | vendor | `boundary_10mb_plus1.png` | Upload | 400 | P2 | API |
| TC-FILEFOLDER-157 | NCC chưa được mời batch nào | Negative | vendor-c-noinvite | — | Gọi upload-file cho batch bất kỳ | 404 | P1 | API |
| TC-FILEFOLDER-158 | Rate-limit upload 10 lần/phút/IP | Negative (rate-limit — chạy cuối suite, cách ly, sleep 60s reset) | vendor | — | Gọi upload liên tiếp lần thứ 11 trong 1 phút | 429 | P2 | API |
| TC-FILEFOLDER-159 | Path traversal qua tên file khi NCC upload | Negative bảo mật | vendor | Tên file `../../../etc/passwd.xlsx` | Upload | 400, chặn bởi basename+regex+`resolve().relative_to()` assert | P1 | API |
| TC-FILEFOLDER-160 | NCC dán link tham khảo hợp lệ | Đơn lẻ | vendor | — | Dán URL `https://drive.google.com/...` vào ô "Link tham khảo" → Gửi | Lưu `external_url` thành công | P2 | UI |
| TC-FILEFOLDER-161 | NCC dán link scheme không hợp lệ | Negative | vendor | — | Dán `javascript:alert(1)` hoặc `ftp://...` | Bị bỏ qua (ignore + log warning), KHÔNG lưu, không XSS | P1 | API |
| TC-FILEFOLDER-162 | NCC xem bản vẽ (drawing) mã hàng | Đơn lẻ | vendor | Item có ảnh bản vẽ | Mở batch → item → xem bản vẽ | Ảnh/bản vẽ hiện đúng qua resolve server-side (không bị chặn bởi role-guard `/rfq/image`) | P2 | UI |
| TC-FILEFOLDER-163 | Vendor A không xem được file của Vendor B (IDOR) | Negative bảo mật | vendor-a | vendor-b có báo giá riêng trong batch chung | vendor-a cố gọi API tải file đính kèm của vendor-b bằng cách đổi id | 403/404, không lộ chéo | P1 | API |

### K. Admin — tải/xem attachment NCC + Drawer/Lightbox (F-ADMIN-ATT-01..03, F-ADMIN-DRAWER-01..04)

| Mã | Tên | Loại | Vai trò | Chuẩn bị | Các bước | Kỳ vọng | Ưu tiên | Tự động hoá |
|---|---|---|---|---|---|---|---|---|
| TC-FILEFOLDER-164 | Admin tải file cấp-phiếu của 1 NCC | Đơn lẻ | procurement | Quote có `attachment_path` | `GET /procurement/quotes/{quote_id}/attachment` | 200, tải đúng file | P2 | API |
| TC-FILEFOLDER-165 | Admin tải file cấp-phiếu khi quote không có attachment | Negative | procurement | Quote không có file | Gọi API | 404 | P2 | API |
| TC-FILEFOLDER-166 | Admin tải file cấp-dòng theo index | Đơn lẻ | procurement | Item có `attachment_paths[]` ≥2 phần tử | `GET /.../items/{item_id}/attachment?index=1` | 200, đúng file thứ 2 | P2 | API |
| TC-FILEFOLDER-167 | Admin tải file cấp-dòng index vượt/rỗng | Negative | procurement | Item không có file hoặc index=5 khi chỉ có 2 | Gọi API | 404 | P2 | API |
| TC-FILEFOLDER-168 | Admin tải TẤT CẢ file 1 NCC thành zip | Đơn lẻ | procurement | NCC đã nộp báo giá có cả file cấp-phiếu + cấp-dòng | Mở `vendor-bidding/[id]` → drawer → "Tải tất cả (zip)" | 200, file zip gom đủ, group theo bqms_code | P1 | UI |
| TC-FILEFOLDER-169 | Zip "Tải tất cả" khi 1 trong N file đã bị xóa khỏi đĩa | Đơn lẻ, quan trọng | procurement | 5 file thuộc 1 NCC, xóa thủ công 1 file trên đĩa trước khi tải | Bấm "Tải tất cả (zip)" | Zip vẫn tải về thành công chứa 4/5 file còn lại, KHÔNG báo lỗi/fail toàn bộ — đếm số entry trong zip để xác nhận CHÍNH XÁC 4 (ghi nhận: mất file âm thầm, không cảnh báo user) | P1 | API |
| TC-FILEFOLDER-170 | Zip khi NCC chưa nộp báo giá | Negative | procurement | NCC chưa gửi báo giá trong batch | Gọi endpoint zip | 404 | P2 | API |
| TC-FILEFOLDER-171 | Path-guard attachment pin dưới FILES_BASE_PATH | Negative bảo mật | procurement | — | Cố mock `attachment_path` trỏ ra ngoài FILES_BASE_PATH rồi gọi tải | 400/403, chặn truy cập ngoài phạm vi | P1 | API |
| TC-FILEFOLDER-172 | Nút 📎 mở QuoteDrawer | Đơn lẻ | procurement | Dòng báo giá có file | Bấm icon 📎 trên dòng | Drawer mở, hiện đủ Xem trước/Tải/Link tham khảo | P2 | UI |
| TC-FILEFOLDER-173 | Xem trước (Eye) file trong Drawer | Đơn lẻ | procurement | File pdf/ảnh | Bấm icon Eye | Lightbox hiện preview inline | P2 | UI |
| TC-FILEFOLDER-174 | Xem trước file Excel trong Lightbox | State | procurement | File .xlsx | Bấm Eye trên file Excel | Không preview inline được → tự động chuyển sang chế độ "Tải xuống" | P3 | UI |
| TC-FILEFOLDER-175 | Nút "Link tham khảo" trong Drawer | Đơn lẻ | procurement | Quote có `external_url` | Bấm "Link tham khảo" | Mở link đúng URL đã NCC dán (tab mới) | P2 | UI |
| TC-FILEFOLDER-176 | Drawing Lightbox điều hướng ←/→ giữa các item | Đơn lẻ | procurement | Batch có ≥3 item có bản vẽ | Mở lightbox item 1 → bấm → → → | Chuyển đúng thứ tự sang item 2, 3; ← quay lại đúng | P3 | UI |
| TC-FILEFOLDER-177 | Drawing Lightbox — item không có bản vẽ | State | procurement | Item không có ảnh | Mở lightbox tại item đó | Hiện placeholder "không có bản vẽ", không lỗi | P3 | UI |

## Map feature→ca (chứng minh phủ 100%)

| Feature ID | Test case (TC-FILEFOLDER-###) |
|---|---|
| F-DOC-01 | 001, 002, 003 |
| F-DOC-02 | 005, 006, 007, 008, 009, 010, 011, 012, 013 |
| F-DOC-03 | 014, 015 |
| F-DOC-04 | 016, 017, 018 |
| F-DOC-05 | 019 |
| F-DOC-06 | 002 |
| F-DOC-07 | 020 |
| F-DOC-08 | 004, 001 |
| F-FILES-01 | 021, 022, 023, 024 |
| F-FILES-02 | 025 |
| F-FILES-03 | 026 |
| F-FB-01 | 027, 078 |
| F-FB-02 | 032 |
| F-FB-03 | 033, 034, 035 |
| F-FB-04 | 036, 037, 038, 039, 040, 041 |
| F-FB-05 | 042, 043 |
| F-FB-06 | 044 |
| F-FB-07 | 045, 046, 047, 048, 049, 050, 051, 052, 053 |
| F-FB-08 | 054, 055, 056, 057, 079 |
| F-FB-09 | 058, 059, 060, 061 |
| F-FB-10 | 062, 063, 064, 065 |
| F-FB-11 | 066, 067, 068, 069, 070, 071 |
| F-FB-12 | 072, 073 |
| F-FB-13 | 074, 075 |
| F-FB-14 | 076 |
| F-FB-15 | 077 |
| F-FB (role đọc) | 030, 031 |
| F-OO-01 | 080, 081, 082, 083 |
| F-OO-02 | 084, 085, 086, 087 |
| F-OO-03 | 088, 089, 090, 091, 092 |
| F-OO-04 | 093, 094 |
| F-OO-05 | 096, 097 |
| (OnlyOffice concurrency) | 095 |
| F-OCR-01 | 098, 099, 100, 101, 102, 103, 104, 107, 108 |
| F-OCR-02 | 105 |
| F-OCR-03 | 106 |
| F-OCR-04 | 098, 105, 106 |
| F-BQMS-FOLDER-01 | 109, 110 |
| F-BQMS-FOLDER-02 | 111 |
| F-BQMS-FOLDER-03 | 112, 113, 114 |
| F-BQMS-FOLDER-04 | 115 |
| F-BQMS-FOLDER-05 | 116, 117 |
| F-BQMS-FILE-01 | 118, 119, 120 |
| F-BQMS-FILE-02 | 121 |
| F-BQMS-FILE-03 | 122, 123, 124, 125, 126 |
| F-BQMS-IMG-01 | 127, 128, 129, 130, 131, 132 |
| F-BQMS-IMG-02 | 133, 134, 135, 136 |
| F-BQMS-IMG-03 | 137 |
| F-BQMS-IMG-04 | 138 |
| F-BQMS-IMG-05 | 139 |
| F-BQMS-IMG-06 | 140 |
| F-BQMS-IMG-07 | 141 |
| F-BQMS-IMG-08 | 142, 143 |
| F-BQMS-IMG-09 | 144, 145, 146 |
| F-BQMS-IMG-10 | 147, 148 |
| F-DOSSIER-ZIP-01 | 149, 150, 151, 152 |
| F-VENDOR-UP-01 | 153, 154, 155, 156, 157, 158, 159 |
| F-VENDOR-UP-02 | 160, 161 |
| F-VENDOR-UP-03 | 162 |
| F-ADMIN-ATT-01 | 164, 165 |
| F-ADMIN-ATT-02 | 166, 167 |
| F-ADMIN-ATT-03 | 168, 169, 170, 171 |
| F-ADMIN-DRAWER-01 | 172 |
| F-ADMIN-DRAWER-02 | 173, 174, 175, 168 |
| F-ADMIN-DRAWER-03 | 176, 177, 162 |
| F-ADMIN-DRAWER-04 | 173, 174 |
| (IDOR chéo NCC) | 163 |

**Tổng số ca**: 177 (TC-FILEFOLDER-001 → TC-FILEFOLDER-177), phủ đủ 64/64 feature ID trong bảng kiểm kê, kèm 5 ca BUG-GATE (BG-DOC-01, BG-FB-01, BG-OO-01, BG-OCR-01, BG-BQMS-01) ghi nhận đúng hành vi hiện tại của lỗ hổng/giới hạn đã biết mà KHÔNG tính vào coverage tính năng đã hoàn thiện.
