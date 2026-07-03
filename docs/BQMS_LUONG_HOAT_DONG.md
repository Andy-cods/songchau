# LƯU ĐỒ HOẠT ĐỘNG BQMS — Mô tả bằng ngôn ngữ tự nhiên

> Tài liệu này mô tả TOÀN BỘ luồng làm việc của module BQMS bằng ngôn ngữ thường ngày, không dùng từ ngữ kỹ thuật. Dành cho anh Thang và đội ngũ nghiệp vụ.

Cập nhật: 13/05/2026 — sau audit E2E (60 pass / 3 fail-script-bug)

---

## TỔNG QUAN

BQMS là cổng đấu thầu của Samsung dành cho nhà cung cấp. Hệ thống Song Châu kết nối tự động với cổng này, kéo về các đơn yêu cầu báo giá, giúp nhân viên báo giá nhanh hơn, theo dõi đơn từ lúc Samsung mời đến lúc giao hàng xong xuôi.

Nói đơn giản, hệ thống giống một **trợ lý ảo** làm 4 việc lớn:
1. **Đi xem** cổng Samsung mỗi nửa tiếng có gì mới.
2. **Bê về** thông tin chi tiết, file đính kèm, hình ảnh sản phẩm.
3. **Sắp xếp** vào bảng để nhân viên xử lý.
4. **Theo dõi** từ lúc báo giá → trúng thầu → ký hợp đồng → nhận PO → giao hàng → hoàn tất.

---

## A. KHI MỘT ĐƠN MỚI XUẤT HIỆN TRÊN CỔNG SAMSUNG

### A.1 Trợ lý tự động ghé thăm cổng (cứ 30 phút một lần)

Mỗi nửa tiếng, một chiếc "robot" (gọi là **periodic scrape**) sẽ tự đăng nhập vào cổng Samsung bằng tài khoản của Song Châu, mở mục Bidding (Đấu thầu), và xem danh sách yêu cầu báo giá mới nhất.

- **Bật/tắt robot này** ở góc trên phải trang BQMS — nút công tắc "Auto-scrape" màu xanh = đang chạy, xám = đang tắt.
- Nếu vì lý do gì cần tắt tạm thời (sửa hệ thống, đổi tài khoản…), chỉ cần click công tắc.

### A.2 Robot làm gì khi thấy đơn mới

Với mỗi đơn (gọi là một RFQ — Request For Quotation), robot:

1. **Ghi nhận** mã đơn (ví dụ `QT26060648`), tên dự án, ngày đăng, deadline báo giá, người phụ trách phía Samsung.
2. **Click vào chi tiết** đơn để xem các mã linh kiện bên trong (Samsung gọi là Quotation Amount). Ví dụ 1 đơn có thể có 4 mã: vỏ máy, lò xo, trục xoay, chân đế.
3. **Tải tất cả file đính kèm**: bản vẽ kỹ thuật (.dwg, .stp), file Excel báo giá mẫu (.xlsx), tài liệu yêu cầu (.pdf).
4. **Tách ảnh sản phẩm** từ file Excel ra thư mục riêng để hiển thị ở cột Ảnh.
5. **Lưu mọi thứ** vào ổ cứng theo cấu trúc: `RFQ 2026/THANG 5/QT26060648_16-05_17h00/` (tên thư mục có encode deadline).

### A.3 Khi nào trợ lý "nghỉ", khi nào "tự thức dậy"

Có một robot phụ chạy nhanh hơn (gọi là **smart auto-rescan**), cứ **5 phút** kiểm tra:
- Nếu thấy có đơn nào thiếu chi tiết (ví dụ: đã có metadata nhưng chưa kéo về items, chưa có ảnh) → **bật chế độ làm việc**, kéo về cho đủ.
- Nếu mọi đơn đều đầy đủ → **ngủ tiếp**, không tiêu tốn tài nguyên.

Trên giao diện, nút "Thiếu N" màu vàng (chỗ header BQMS) hiển thị số đơn chưa đủ data. Bấm vào sẽ thấy:
- Trạng thái robot phụ: **đang ngủ (idle)** hay **đang làm (running)**.
- Danh sách các đơn còn thiếu, với cột "Samsung báo X items → hệ thống đã có Y items".
- Nút **"Quét bù ngay"** để bắt làm việc ngay nếu không muốn chờ 5 phút.

---

## B. NHÂN VIÊN MỞ TRANG BQMS THẤY GÌ

### B.1 Bảng danh sách đơn (BQMS table)

Mở trang `/bqms`, nhân viên thấy 1 bảng lớn liệt kê toàn bộ đơn. Mỗi dòng tương ứng **1 mã linh kiện**, không phải 1 đơn — vì 1 đơn có nhiều mã.

Các cột chính (từ trái sang phải):
1. **Hành động** (sticky, luôn hiện bên trái khi cuộn): nút "Báo giá" màu xanh nếu đơn còn pending.
2. **#** số thứ tự
3. **Số đơn** (rfq_number) — ví dụ QT26060648
4. **BQMS Code** — mã linh kiện cụ thể, ví dụ Z0000002-535751
5. **Ảnh** — thumbnail ảnh sản phẩm. Nếu không có ảnh thật, sẽ hiện một huy hiệu gradient màu với 4 ký tự cuối của mã (ví dụ `5751`) — không bao giờ trống.
6. **Tên hàng / Spec** — mô tả sản phẩm
7. **Loại** — TM (thương mại, mua-bán lại) hoặc GC (gia công, mình sản xuất). Tự phát hiện từ tên file đính kèm; có thể click để chỉnh tay nếu sai.
8. **Maker** — nhà sản xuất ghi trên đơn (thường là SAMSUNG ELECTRONICS)
9. **SL / ĐVT** — số lượng và đơn vị (EA, kg, m…)
10. **CIS Code, Part NO, MOQ** — các thông tin thêm về linh kiện
11. **V1/V2/V3/V4** — giá đã báo qua từng vòng. Mỗi vòng tô màu khác (blue → cyan → teal → emerald) để dễ nhìn.
12. **Trạng thái** — Pending (tím), Won (xanh), Lost (đỏ), Closed (xám), Skipped (xám mờ)
13. **Người phụ trách Samsung, Department, Requester** — ai bên Samsung đăng đơn
14. **D-Day** — còn bao nhiêu ngày tới deadline báo giá
15. **Ngày đăng, ngày hỏi hàng**

### B.2 Sắp xếp, lọc, tìm

- Mặc định **đơn mới nhất** (số QT cao nhất, đăng gần đây nhất) lên đầu, khớp đúng thứ tự trên cổng Samsung.
- Bộ lọc theo **tháng + năm**, **trạng thái** (Active/Won/Lost/Closed/Skip), **TM/GC**.
- Tìm theo số đơn, BQMS code, tên hàng, maker.

### B.3 Bảng KPI ở đầu trang

Hiển thị:
- Tổng số đơn trong tháng
- Won (trúng) — bao nhiêu mã đã trúng thầu
- Lost (trượt)
- Pending (đang chờ)
- Win rate (tỉ lệ trúng tính từ won/won+lost)

---

## C. BẤM NÚT "BÁO GIÁ" — CHUYỆN GÌ XẢY RA

**QUAN TRỌNG (cập nhật 13/05/2026):** Nút "Báo giá" giờ là **thao tác nhẹ < 1 giây** — KHÔNG còn trigger scrape lên cổng Samsung nữa. Mọi việc nặng (đăng nhập Samsung, drill chi tiết, download file, extract ảnh) do **3 con robot cron tự lo ngầm** (chu kỳ 30 phút / 5 phút / 3 phút). Mỗi lần robot quét đều thực hiện toàn bộ:

- Mở chi tiết đơn → quét bảng các mã linh kiện → kéo từng mã về.
- Click từng file đính kèm → tải về thư mục `raw/`.
- Đọc các file Excel → tách ảnh embedded → lưu vào `images/`.
- Đối chiếu mã linh kiện và đặt tên ảnh theo bqms_code để cột Ảnh hiển thị đúng.
- **Tạo các dòng trong cơ sở dữ liệu cho từng mã** (mỗi mã 1 row riêng) — **dòng xuất hiện ngay** trong bảng BQMS với trạng thái "🔒 V1-V4 khóa".

### C.1 Click "Báo giá" trên dòng đó (sau khi cron đã xử lý đơn)

1. **Tức thì (<1 giây)** hệ thống:
   - Đảm bảo các dòng bqms_rfq cho mã đó tồn tại (idempotent — cron thường đã tạo từ trước).
   - **Mở khoá 4 vòng V1/V2/V3/V4** — flip cờ `quote_unlocked = true`.
   - **Gán đơn cho user đang đăng nhập** (`assigned_to = me`).
   - Đánh dấu staging = `approved`.
2. **Toast thành công** xuất hiện: "🔓 Đã mở khoá V1-V4 cho N mã linh kiện".
3. Cell V1-V4 trên các dòng đó chuyển từ "🔒 Khoá" (xám) → nút màu xanh **+ L1** sẵn sàng nhập giá.
4. Cột "Người PT" giờ hiển thị tên user vừa click.

### C.2 Nếu robot chưa kịp drill đơn

Hiếm khi xảy ra (chỉ vài phút sau lần scrape đầu), nhưng nếu user click "Báo giá" mà robot CHƯA drill chi tiết đơn đó:
- Endpoint trả về **HTTP 200 + warning** "RFQ chưa được auto-drill, chờ 3-5 phút rồi click lại".
- Staging vẫn ở `pending_review`.
- Robot smart-code-track (chu kỳ 3 phút) sẽ phát hiện gap "items_mismatch" → priority drill → 3-5 phút sau đơn sẽ đầy đủ.

### C.3 Nếu Samsung đã đóng cổng / xóa file

Một số đơn cũ Samsung đã xóa attachment khỏi portal (sau khi đã chọn nhà cung cấp). Trong trường hợp này:
- Cron drill xong vẫn upsert dòng từ metadata Samsung công bố (bqms_code, spec, maker).
- Cột Ảnh hiển thị **huy hiệu gradient 4 ký tự cuối bqms_code** (mỗi mã 1 màu) — không có ảnh thật nhưng vẫn nhận diện được.
- Click "Báo giá" vẫn hoạt động → mở khoá V1-V4 bình thường.

### C.4 Vì sao tách scrape khỏi nút Báo giá?

Trước đây nút Báo giá làm **CẢ HAI việc**: drill 30-90 giây + mở khoá. Khi drill fail (Samsung Access-Violated, mạng chậm, file Excel corrupt) → user thấy lỗi, không hiểu vì sao. Đây là nguồn gốc rất nhiều bug "ảnh không hiện", "thông tin biến mất", "spec NULL".

Giờ **tách rạch ròi**:
- **Scrape** (chạy ngầm, retry tự động, log audit) = lo data ingestion
- **Báo giá** = thao tác nhẹ của user (mở khoá, gán user, < 1s)

Lỗi scrape giờ được **smart-code-track** phát hiện + tự heal (10 loại gap), không còn để user gánh chịu.

---

## D. BẤM VÀO MỘT DÒNG — BẢNG CHI TIẾT BÊN PHẢI MỞ RA

Click bất kỳ dòng nào → drawer chi tiết slide từ phải vào, hiển thị đầy đủ:

### D.1 Tab Tổng quan
- BQMS code, số RFQ, deadline, người phụ trách Samsung
- Phân loại (TM/GC) với nút sửa
- Spec full text
- Thông tin maker, MOQ, CIS, Part NO
- Người PT đã được gán (assigned_to_name) — sẽ tự gán cho người báo giá đầu tiên

### D.2 Tab Lịch sử báo giá (V1→V4)
4 ô tương ứng 4 vòng báo giá:
- Ô màu xám (chưa báo) → click "L1" để báo lần 1
- Ô màu xanh nhạt → giá đã báo
- Mỗi lần báo giá ghi log: ai báo, lúc nào, giá bao nhiêu, vòng nào
- Bên dưới là **lịch sử thay đổi giá**: nếu báo lại giá khác (sửa 1.2M → 1.5M), cả 2 giá đều lưu được để theo dõi

### D.3 Tab Tài liệu
- Danh sách file trong thư mục `raw/` (bản vẽ, Excel mẫu)
- Gallery ảnh `images/` (thumbnail có thể click phóng to)
- Nút "Mở folder" → đi tới trang `/documents/browser` tại thư mục đơn này
- Nếu là file Excel → có nút "Sửa" → mở OnlyOffice editor trong cùng tab (chỉnh sửa và lưu trực tiếp)

### D.4 Section báo giá nhanh (cho hàng TM)
- Click "L1" trên ô V1 → popup nhập giá → enter → 5-15 giây sau hệ thống tạo ra:
  - File báo giá Excel (theo template AMA BAC NINH)
  - File PDF (chuyển từ Excel)
  - File CAM_KET (cam kết chất lượng) Excel + PDF
  - Lưu vào thư mục `[QT]_AMA BAC NINH_L1/`
- Toast "✅ Đã tạo 4 file V1" hiện ra
- Vào tab Tài liệu sẽ thấy file mới

### D.5 GC wizard (cho hàng gia công)
- Click "L1" trên hàng GC → mở wizard nhiều bước:
  1. **Bước 1**: chọn các mã linh kiện trong đơn
  2. **Bước 2**: với mỗi mã, nhập:
     - Materials (vật liệu): tên, kích thước (W×L×H), số lượng, đơn giá
     - Parts (linh kiện rời)
     - Others (chi phí khác)
     - Processes (công đoạn gia công + thời gian)
     - Nego (điều chỉnh đàm phán)
  3. **Bước 3**: review + nhập hệ số thương lượng
  4. **Bước 4**: ấn "Tạo báo giá"
- Hệ thống áp dụng công thức:
  - **Material amount** = Đơn giá × **Weight** (đã sửa từ × Qty cũ — theo yêu cầu 13/05)
  - Mỗi mã 1 sheet trong file Excel, có thể đính kèm ảnh sản phẩm
- Trước khi tạo, có nút **"Đổi ảnh"** trên ô Product photo:
  - Upload từ máy (drag-drop hoặc file picker)
  - Hoặc chọn từ thư viện ảnh đã có của RFQ
  - Ảnh upload sẽ auto-fit + căn giữa trong cell B93:H98

---

## E. CỘT ẢNH — LÀM SAO LUÔN HIỂN THỊ

Đây là vấn đề được sửa kỹ. Quy tắc 5 tầng:

1. **Tầng 0 (ưu tiên cao nhất)**: nếu user đã upload ảnh override qua "Đổi ảnh" → dùng ảnh đó.
2. **Tầng 1**: tìm ảnh có tên bắt đầu bằng `<bqms_code>_*` trong thư mục `images/` của đơn.
3. **Tầng 2**: ảnh nào tên chứa `bqms_code` ở giữa.
4. **Tầng 3**: ảnh `_shared_*` (dùng chung nhiều mã trong cùng đơn).
5. **Tầng 4**: ảnh bất kỳ trong thư mục đơn (khi scrape không khớp được tên).
6. **Tầng 5 (fallback cuối)**: lấy ảnh đầu tiên của thư mục — đặc biệt cho hàng pending chưa có bqms_code.
7. **Nếu thư mục trống hoàn toàn** → frontend hiển thị **huy hiệu gradient 4 ký tự cuối** của bqms_code, mỗi mã 1 màu khác nhau (hash-based).

→ Cột Ảnh **không bao giờ trống**, kể cả khi Samsung đã xóa file.

---

## F. LƯU ĐỒ CHI TIẾT — TRACK VÒNG BÁO GIÁ V1→V4 + CẬP NHẬT + THÔNG BÁO

### F.1 Hai khái niệm cần phân biệt

Đây là phần dễ nhầm lẫn nhất. Có **2 khái niệm "vòng"** khác nhau:

1. **Vòng Samsung yêu cầu** (Detail Version) — Samsung tự đẩy lên cổng khi muốn nhà cung cấp báo lại. Ghi nhận trong DB ở cột `bqms_rfq.version` (số nguyên 1-4).
2. **Vòng nhà cung cấp đã báo** (Quoted Round) — mỗi lần Song Châu báo giá. Ghi nhận trong cột `quoted_price_bqms_v1` đến `quoted_price_bqms_v4`.

Bình thường 2 con số trùng nhau (Samsung gọi V2 → mình báo V2). Khi LỆCH (VD Samsung gọi V3 mà mình mới báo V1) là cảnh báo đỏ.

### F.2 Toàn bộ chuỗi vòng đời 1 mã linh kiện — từ đầu đến cuối

```
1. SAMSUNG đăng RFQ trên cổng                                  [bên ngoài]
        │
        ▼
2. ROBOT cron 30 phút quét list                                [bqms_periodic_scrape]
        │  • Login → vào mục Bidding → xem danh sách mới
        │  • Lưu raw_json vào bqms_vendor_portal_staging (status=pending_review)
        ▼
3. ROBOT drill chi tiết cho từng RFQ mới                       [_auto_drill_new_rfqs]
        │  • Mở chi tiết → quét grid items → kéo từng mã linh kiện
        │  • Tải file đính kèm vào raw/
        │  • Tách ảnh từ Excel vào images/
        │  • Auto-UPSERT bqms_rfq cho từng mã (quote_unlocked=FALSE, version=1)
        ▼
4. CỘT V1 hiển thị "🔒 Khoá"  ← user thấy dòng trong table BQMS
        │  • Nhân viên click "Báo giá" trên dòng
        ▼
5. ENDPOINT /vendor-staging/{id}/quote — INSTANT < 1 giây      [Phase H]
        │  • UPDATE bqms_rfq SET quote_unlocked = true
        │  • SET assigned_to = current_user
        │  • Mark staging.status = 'approved'
        ▼
6. CỘT V1 chuyển sang "+ L1" màu xanh — sẵn sàng nhập giá
        │  • Nhân viên click "+ L1" → popup nhập giá
        ▼
7. ENDPOINT /rfq/{id}/generate-round?round_n=1&new_price=X     [generate-round]
        │  • UPDATE bqms_rfq.quoted_price_bqms_v1 = X
        │  • INSERT bqms_quote_log (rfq_id, round=1, price=X, item_type=TM,
        │       quoted_by=user_id, quoted_at=NOW())
        │  • Fetch tất cả items cùng rfq_number
        │  • Run run_autofill_job(quote_level=1) → tạo file
        │       [QT]_AMA BAC NINH_L1/
        │         ├── BG[QT]_L1.xlsx        (file báo giá Excel)
        │         ├── BG[QT]_L1.pdf         (PDF chuyển từ Excel)
        │         ├── CAM_KET_[QT]_L1.xlsx  (cam kết chất lượng)
        │         └── CAM_KET_[QT]_L1.pdf
        │  • INSERT quotations (rfq_no, flow_type=TM, quote_level=1,
        │       output_xlsx=..., output_pdf=..., status='completed')
        ▼
8. CỘT V1 hiển thị giá đã báo (background xanh emerald)
        │  • Nhân viên upload file qua cổng Samsung (manual hoặc auto)
        ▼
9. SAMSUNG XEM XÉT (vài ngày → vài tuần)
        │
        ├── (a) Samsung chấp nhận giá → won
        │       Robot Selection Result scrape → mark bqms_rfq.result = 'won'
        │       Dòng chuyển nền xanh emerald + thông báo bell
        │       Đi tiếp đến trang Trúng BG để khai HS code
        │
        ├── (b) Samsung trượt → lost
        │       result = 'lost', nền đỏ
        │
        └── (c) SAMSUNG YÊU CẦU VÒNG 2 — đẩy version trên cổng
                Robot scrape 30p phát hiện version=2 (regex _VERSION_RE)
                bqms_rfq UPDATE: SET version = GREATEST(version, 2)
                Notes thêm dòng: " | [round-bump v1→v2 @ 2026-05-13]"
                CỘT V2 chuyển từ "🔒 Khoá" → "+ L2" sẵn sàng
                Gửi notification cho assigned_to user (xem F.4)
                → Quy trình lặp từ bước 6 cho V2
                → Tối đa 4 vòng (V1→V4)
```

### F.3 Bảng track 4 cột V1/V2/V3/V4 hiển thị thế nào

Trong detail drawer (mở khi click dòng), section "Lịch sử báo giá" có 4 ô vuông:

| Vòng | Điều kiện hiển thị | Màu/Trạng thái | Click làm gì |
|------|---|---|---|
| V1 | `quote_unlocked=true` (sau click Báo giá) | "+ L1" xanh brand | Popup nhập giá → tạo file L1 |
| V2 | V1 đã set + `version>=2` ngầm hiểu | "+ L2" xanh brand | Popup nhập giá → tạo file L2 |
| V3 | V2 đã set | "+ L3" xanh brand | Popup → L3 |
| V4 | V3 đã set | "+ L4" xanh brand | Popup → L4 |
| (chưa thoả) | | "🔒 Khoá" xám | Tooltip "Click Báo giá để mở khoá" |
| (đã báo) | giá đã có trong DB | Background emerald + "↻ L_n" | Click để báo LẠI (sửa giá) |

**Khi báo lại cùng 1 vòng:** giá MỚI ghi đè vào `quoted_price_bqms_v_n`, audit log mới thêm vào `bqms_quote_log` — giá CŨ vẫn lưu trong log để xem lịch sử.

### F.4 LỊCH SỬ thay đổi giá (audit trail)

Mỗi lần click "+ L1" / "+ L2" / etc → ngoài UPDATE bqms_rfq, hệ thống còn INSERT 1 row vào `bqms_quote_log`:

```
Bảng bqms_quote_log (bảng audit):
┌──────────┬───────┬───────────┬──────────┬────────────┬────────────────────┐
│ rfq_id   │ round │ price     │ currency │ quoted_by  │ quoted_at          │
├──────────┼───────┼───────────┼──────────┼────────────┼────────────────────┤
│ 254792   │   1   │ 1500000   │ VND      │ Thang      │ 2026-05-13 14:30   │
│ 254792   │   1   │ 1450000   │ VND      │ Thang      │ 2026-05-13 15:00   │ (sửa giá)
│ 254792   │   2   │ 1400000   │ VND      │ Thang      │ 2026-05-15 09:00   │ (Samsung yêu cầu V2)
│ 254792   │   3   │ 1350000   │ VND      │ Mai        │ 2026-05-16 10:00   │ (V3)
└──────────┴───────┴───────────┴──────────┴────────────┴────────────────────┘
```

Trong detail drawer, mục "Tab Tài liệu" → "Lịch sử báo giá" hiện toàn bộ lịch sử này. User có thể xem ai báo, lúc nào, giá bao nhiêu.

### F.5 ROUND-BUMP detection — Robot tự nhận diện Samsung gửi lại QT (Phase I, 14/05/2026)

**Bối cảnh:** Samsung không gửi email báo "mời báo lại". Khi muốn vòng 2/3/4, cổng sec-bqms tự **đẩy QT cũ lên đầu danh sách Bidding như entry mới đăng**:
- `rfq_number` y hệt (VD `QT26061295` vẫn là `QT26061295`)
- Subject/reqName có thể đổi (VD thêm "(2nd)", "2nd Round")
- D-Day reset đếm ngược mới
- **Quan trọng: file vòng 1 trên cổng đã bị Samsung XÓA** — nếu robot scrape blindly sẽ thấy 0 attachments → ghi đè lên data V1 local → mất files vĩnh viễn.

#### Robot detect bằng 3 điều kiện ĐỒNG THỜI:

| # | Điều kiện | Cách check |
|---|---|---|
| 1 | **Đã tồn tại trên hệ thống BQMS** | `SELECT MAX(version) FROM bqms_rfq WHERE rfq_number=?` (phải có row) |
| 2 | **Trạng thái cổng KHÁC Closed** | `_is_closed_status(raw)` trả False (`progressStatusName`/`dday`/`submitGb` không chứa "closed") |
| 3 | **KHÔNG có Unselected trong Selection Result** | `SELECT 1 FROM bqms_vendor_portal_staging WHERE module='selection_result' AND rfq_number=? AND raw_json->>'selectionResult'='Unselected'` |

**Cả 3 đúng cùng lúc → robot xác định đây là round-bump.**

#### Parse số vòng:

Robot đọc cell "RFQ No" trong mục Basic Information của QT → parse number 1/2/3/4. Fallback: regex tìm "(2nd)", "2nd Round", "V2" trong subject/reqName.

#### Action khi round-bump:

Hàm `apply_round_bump(pool, rfq_number, new_version, raw_row)`:

✅ **Update**:
- `bqms_rfq.version = GREATEST(version, new_version)`
- Notes append `[round-bump v_old→v_new @ YYYY-MM-DD]`
- `req_name` nếu Samsung đổi subject (so sánh trước/sau, set IF DIFFERENT)
- Dispatch notification `dispatch_rfq_version_bump` cho `assigned_to`

❌ **KHÔNG đụng**:
- specification / maker / expected_qty / unit / quoted_price_*
- folder local / raw/ / images/
- **TUYỆT ĐỐI KHÔNG GỌI** `download_files_for_rfq` — sẽ ghi đè V1 files

#### Wire trong cron flow:

Trong `_auto_drill_new_rfqs` (cron 30 phút), với mỗi RFQ candidate:
```
TRƯỚC khi gọi download_files_for_rfq:
    bump_to = detect_is_round_bump(pool, rfq_number, raw)
    if bump_to is not None:
        apply_round_bump(...)
        continue (skip Playwright drill entirely)
    else:
        download_files_for_rfq(...) (normal flow)
```

Smart Code-Track 3-min cũng dùng cùng logic này khi heal d2/d5 gaps.

### F.6 HỆ THỐNG THÔNG BÁO — 3 kênh

#### Kênh 1: Bell Notification (chuông góc trên màn hình)
Khi sự kiện xảy ra, hệ thống INSERT row vào bảng `notifications`:

| Loại sự kiện | type | Recipient | Khi nào |
|---|---|---|---|
| **RFQ mới** | `bqms_rfq_new` | Mọi user role admin/manager/bộ phận BQMS | Robot drill xong RFQ mới, có items + ảnh |
| **Round-bump V1→V2** | `rfq_version_bump` | assigned_to (người đã báo V1) | Robot detect version tăng |
| **Trúng/Trượt** | `selection_result` | assigned_to | Selection Result scrape mark won/lost |
| **Giao hàng đổi trạng thái** | `delivery_status_change` | warehouse + manager | PATCH /deliveries/{id}/status |

Chuông hiển thị **số chấm đỏ** = số sự kiện chưa xem. Click chuông → drawer slide từ phải, hiện 30 sự kiện gần nhất kèm link "Xem ngay".

#### Kênh 2: Toast (góc dưới phải, tự biến mất sau 5-10s)
Phản hồi tức thì cho action user vừa làm:
- "🔓 Đã mở khoá V1-V4 cho 4 mã linh kiện" (sau click Báo giá)
- "✅ Đã tạo 4 file V2 cho QT26061295" (sau báo giá L2)
- "❌ Lỗi: Samsung Access Violated" (khi scrape fail)

Toast KHÔNG lưu DB, chỉ hiển thị tạm. Nếu user lỡ miss → có thể xem lại ở Activity Feed.

#### Kênh 3: Activity Feed (drawer nhỏ tích hợp chuông)
Tổng hợp **tất cả sự kiện** trong 2 ngày qua, bao gồm cả những thứ không phát chuông:
- "Robot drill QT26061295 — 6 items, 0 file"
- "Smart Code-Track heal 4 gap d5_all_image_tiers_empty"
- "User Mai báo giá V1 cho QT26060648 = 1.5M VND"
- "PO #2112673752 confirmed trên Samsung"

Cron 30s frontend poll `/api/v1/bqms/activity/recent?days=2&limit=30` → drawer cập nhật tự động.

### F.7 KHI ROUND-BUMP LỖI — robot retry như nào

Có khi robot scrape detect được V2 nhưng download file V2 fail (mạng chậm, Samsung Access Violated). Lúc này:
- `bqms_rfq.version=2` đã được set (success path)
- Nhưng folder cho V2 chưa có file mới
- **Smart Code-Track 3 phút** sẽ phát hiện gap **d2_items_mismatch** hoặc **d5_all_image_tiers_empty**
- → Tự dispatch lại drill cho RFQ đó (cooldown 10 phút giữa các retry)
- → 5 attempts thất bại → exclude 1 giờ (backoff)

User KHÔNG cần làm gì — engine tự retry. Status hiển thị trong widget "🧠 Smart Code-Track" ở header trang BQMS.

### F.8 Đặc biệt — RFQ không có ảnh dù đã drill

Đôi khi 1 RFQ Samsung CHỈ có text mô tả, KHÔNG có file Excel đính kèm (loại "info-only inquiry"). Trong trường hợp này:
- Robot scrape xong: `raw/` 0 file, `images/` 0 file
- Cột Ảnh hiển thị huy hiệu gradient 4 ký tự cuối bqms_code (mỗi mã 1 màu)
- Smart Code-Track 3 phút detect d5_all_image_tiers_empty → retry → vẫn 0 file → log lại nhưng không spam
- Đây KHÔNG phải bug — Samsung không có dữ liệu để pull

User vẫn báo giá bình thường được — V1-V4 vẫn unlock khi click "Báo giá".

---

## G. SAMSUNG CHỌN TRÚNG/TRƯỢT

### G.1 Robot Selection Result scrape
Cứ 30 phút robot cũng vào trang "Selection Result" của Samsung, đọc:
- Mã đơn nào được "Selected" → đánh dấu `result='won'` trong DB
- Mã đơn nào "Unselected" → `result='lost'`

Trong BQMS table:
- Dòng won → màu xanh emerald
- Dòng lost → màu đỏ nhạt
- KPI win-rate tự cập nhật

### G.2 Trang Trúng BG (Won Quotations)
Vào `/bqms/won-quotations`, xem tất cả đơn đã trúng:
- Cột "Mã hàng", "Tên hàng", "HS Code", "Đơn giá", "Số lượng", "Thành tiền VND/USD"
- Có thể nhập/sửa **HS Code** (mã hải quan) — quan trọng cho khai xuất khẩu
- **Tra hàng loạt HS code**: paste 1 list mã → nhấn "Tra cứu" → hệ thống tự gợi ý HS code dựa trên đơn cũ đã khai

---

## H. SAMSUNG TẠO PO (PURCHASE ORDER)

### H.1 Robot scrape PO + MRO
Định kỳ 30 phút, robot vào mục "P/O Receipt" và "MRO P/O Receipt" của Samsung:
- Kéo về danh sách PO mới (số PO, ngày, mã linh kiện, số lượng, đơn giá)
- Tự **bridge** sang bảng `bqms_deliveries` để theo dõi giao hàng

### H.2 Confirm PO trên cổng Samsung
- Trang BQMS có nút "Confirm PO" cho mỗi PO chưa xác nhận
- Click → hệ thống gọi API confirm của Samsung trực tiếp (không cần đăng nhập tay)
- Có thể batch confirm nhiều PO cùng lúc
- Lỡ confirm nhầm thì **admin** có nút "Cancel Confirm" để hủy

---

## I. THEO DÕI GIAO HÀNG

### I.1 Trang `/bqms/deliveries`
Mỗi PO sau khi confirm → 1 dòng trong bảng giao hàng, cột:
- Số PO, BQMS Code, Spec, SL, ĐV
- **Trạng thái**: Chưa giao / Đang giao / Đã giao / Hoàn tất
- Ngày PO, Ngày giao, SL giao thực tế, Pending (= SL - SL giao TT)
- **Người giao hàng** (driver) + **Biển số xe** (mới thêm 13/05)
- Xuất xứ, Tổng GT đã giao

### I.2 Drawer chi tiết khi click dòng
Section **Giao hàng**:
- Tất cả ô đều **click vào ô để sửa** (không chỉ icon pencil)
- Nhập SL giao thực tế, ngày giao, phương thức giao, xuất xứ
- Hiển thị tổng giá trị đã giao

Section **Người giao hàng** (mới):
- Hiển thị driver được gán: tên, SĐT, biển số (badge vàng), loại xe
- Nút "Đổi" → mở dropdown chọn driver khác
- Nút "Bỏ gán"
- Nút "Quản lý ↗" → mở modal CRUD driver

Section **Liên hệ**:
- Người nhận, Kho nhận, Mail PUR, SĐT PUR — tất cả editable

### I.3 Modal quản lý người giao hàng
- Nút "Người giao" ở header trang `/bqms/deliveries` mở modal
- List driver với: tên, biển số, SĐT, CCCD, loại xe, có ảnh CCCD/biển số chưa
- **Tạo mới**: nhập tên, SĐT, số CCCD, biển số xe, loại xe, ghi chú
- **Sửa**: click "Sửa" trên dòng driver
- **Upload ảnh**: 2 ô grid cho CCCD và biển số xe — drag file PNG/JPG/WebP <10MB
- **Xóa**: nếu driver đang được dùng trong PO → soft delete (is_active=false), nếu không → hard delete

### I.4 Chuyển trạng thái giao hàng
Trong drawer chi tiết có các nút chuyển:
- Pending → "Bắt đầu giao" → In Transit
- In Transit → "Thông quan" → Customs Clearance (cho hàng nhập)
- Customs Clearance → "Đã giao" → Delivered
- Delivered → "Hoàn tất" → Completed (tự set actual_delivered_at)

---

## J. HỢP ĐỒNG (CONTRACTS)

### J.1 Robot scrape Contract
Cứ 30 phút robot vào "Contract Inquiry" của Samsung:
- Kéo contract mới về staging
- Auto-merge vào bảng `bqms_contracts`, match với `bqms_won_quotations` qua rfq_number

### J.2 Xem hợp đồng
- Vào `/bqms/won-quotations` → cột "Contract" → icon link nếu có
- Click → drawer hợp đồng: số contract, ngày, tổng giá trị, status, danh sách items

---

## K. CHỈNH SỬA EXCEL TRỰC TIẾP TRÊN WEB

### K.1 OnlyOffice integration
- Vào `/documents/browser` → tìm file .xlsx → click "Sửa"
- Trang `/documents/edit?path=...` mở editor OnlyOffice trong iframe
- Editor full-featured: edit cell, formula, định dạng, biểu đồ
- Auto-save mỗi 2 phút, force-save khi đóng tab
- Khi user save → callback chạy → file mới ghi đè file cũ → PDF tự render lại

### K.2 Bug đã sửa (13/05)
- documentType phải là `cell` (không phải `spreadsheet`) — fix lỗi "Có lỗi xảy ra"
- Override JSON config cho OnlyOffice container để cho phép private IP

---

## L. CÁC THAO TÁC PHỤ

### L.1 Skip đơn (không báo giá)
- Trên dòng đơn hoặc trong drawer → nút "Skip"
- Đánh dấu đơn là "skipped" → ẩn khỏi list pending mặc định
- Có thể "Bỏ skip" sau nếu đổi ý

### L.2 Override phân loại TM/GC
- Hệ thống tự đoán TM/GC từ tên file đính kèm (.dwg → GC, .pdf only → TM)
- Nếu đoán sai → click ô "Loại" → chọn TM/GC/Auto
- Auto = revert về tự đoán

### L.3 Bulk lookup HS code
- Trên trang Trúng BG → nút "Tra hàng loạt"
- Paste list mã → hệ thống tra qua đơn cũ → hiện gợi ý → "Apply all" để bulk update

### L.4 Notification (chuông góc trên)
Hiển thị các sự kiện gần đây:
- Đơn mới scrape về
- V2/V3 round-bump
- Đơn won/lost
- Báo giá batch hoàn tất

### L.5 Activity Feed (bell icon)
- Click chuông → drawer mở
- Hiển thị 30 sự kiện gần nhất trong 2 ngày qua
- Mỗi sự kiện: ai làm, làm gì, lúc nào, link tới RFQ

---

## M. CÁC NÚT ADMIN

Chỉ admin nhìn thấy:

- **Reset BQMS data**: xóa toàn bộ bqms_records, bqms_deliveries, quotations bqms-related (nguy hiểm — chỉ dùng khi cài lại).
- **Re-extract images**: scan lại các thư mục, extract lại ảnh từ Excel (dùng khi sửa thuật toán extract).
- **Manual scrape trigger**: bật từng loại scrape (bidding/contract/MRO/selection) bằng tay không chờ cron.

---

## N. LƯU ĐỒ TỔNG QUAN — CÁC LUỒNG CHÍNH

```
┌─────────────────────────────────────────────────────────────┐
│  CỔNG SAMSUNG sec-bqms.com                                  │
│  (Bidding • Contract • MRO PO • Selection Result)           │
└──────────────────────┬──────────────────────────────────────┘
                       │ Cứ 30 phút robot scrape login + kéo
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  STAGING (bqms_vendor_portal_staging)                       │
│  • module=bidding|contract|po|selection_result              │
│  • status=pending_review|approved|skipped                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
   [Auto-drill]   [User click     [Smart rescan
   khi có gap     "Báo giá"]      mỗi 5 phút]
        │              │              │
        └──────────────┴──────────────┘
                       │ Tải file + tách ảnh + UPSERT
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  bqms_rfq (1 dòng = 1 mã linh kiện)                        │
│  • Hiển thị trên trang /bqms                                │
│  • Cột Ảnh: tier 0-5 fallback → gradient placeholder        │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────────────┐
        ▼              ▼                      ▼
  [Báo giá L1-L4]  [GC Wizard]         [Skip / Classification
   (TM flow)       (Materials,          override]
        │           Parts, Process)
        │              │
        ▼              ▼
  bqms_quote_log + quotations + file Excel/PDF
                       │
                       │ Samsung chọn
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Selection Result → bqms_rfq.result = won|lost              │
│  • Trang /bqms/won-quotations với HS code editor            │
└──────────────────────┬──────────────────────────────────────┘
                       │ Samsung tạo PO
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  bqms_samsung_po + bqms_deliveries                          │
│  • Trang /bqms/deliveries                                   │
│  • Gán driver (CCCD + biển số xe)                           │
│  • Trạng thái: Chưa giao → Đang giao → Đã giao → Hoàn tất   │
└─────────────────────────────────────────────────────────────┘
```

---

## O. TÓM TẮT KỊCH BẢN HẰNG NGÀY CỦA NHÂN VIÊN

### Sáng đến công ty

1. Mở `/bqms` → xem nút "Thiếu N" (góc trên phải).
   - Nếu N=0 → mọi thứ đã đầy đủ.
   - Nếu N>0 → click → xem danh sách → click "Quét bù ngay" nếu muốn xử lý ngay.
2. Xem KPI tháng: tổng đơn, win rate.
3. Xem danh sách đơn pending (filter "Active") → đơn nào D-Day gần thì làm trước.

### Báo giá 1 đơn

1. Click "Báo giá" trên dòng → toast "Đang drill...".
2. Đợi 30-90s → toast "Đã tạo N mã".
3. Dòng đơn tự reload thành N mã linh kiện.
4. Click 1 mã → drawer chi tiết.
5. Xem spec, ảnh sản phẩm, file đính kèm.
6. Tính giá theo bản vẽ + cost.
7. Click "L1" → nhập giá → đợi 5-15s → file Excel/PDF được tạo.
8. Trong tab Tài liệu → download file hoặc gửi mail.

### Theo dõi sau khi báo

1. Đợi Samsung phản hồi (qua robot cứ 30p check).
2. Nếu lên V2 → notification → click vào báo lại.
3. Khi Samsung chọn trúng → kết quả tự cập nhật + KPI tăng.
4. Vào Trúng BG → nhập HS code (nếu xuất khẩu).

### Khi nhận PO

1. Samsung tạo PO → tự xuất hiện trong Giao Hàng.
2. Confirm PO trên BQMS (nếu chưa confirm tự động).
3. Gán driver → upload CCCD + biển số xe.
4. Cập nhật trạng thái: Bắt đầu giao → Thông quan → Đã giao → Hoàn tất.

---

## P. TÌNH HUỐNG ĐẶC BIỆT

### P.1 Samsung xóa file sau khi đã chọn nhà cung cấp
- Folder local sẽ vĩnh viễn empty.
- Hệ thống vẫn có metadata (mã, spec, qty) trong DB.
- Cột Ảnh hiện gradient placeholder.
- KHÔNG phải bug — đây là behavior của Samsung.

### P.2 Cron lỡ chu kỳ (server restart, mất mạng)
- Đơn mới chưa kéo về.
- Smart rescan (5 phút) sẽ tự bắt được khi có gap.
- Hoặc admin click "Quét bù ngay" thủ công.

### P.3 Robot bị Access-Violated khi drill
- Samsung đôi khi block session nếu navigate quá nhanh.
- Scraper auto-retry với session mới.
- Nếu fail nhiều lần → log error, đơn ở trạng thái pending → user click Báo giá để retry thủ công.

### P.4 Conflict 2 user cùng sửa
- Optimistic lock qua field `version` trong bqms_deliveries/bqms_rfq.
- User B sửa trễ → nhận 409 → reload xem version mới rồi sửa lại.

### P.5 OnlyOffice editor báo lỗi
- Đã sửa (13/05): documentType="cell" cho xlsx (trước là "spreadsheet" sai).
- Container OnlyOffice mount config JSON cho phép private IP.

---

## Q. CÁC FILE TÀI LIỆU HỆ THỐNG

- `MAPPING_BQMS_FLOW.md` — kỹ thuật, bảng DB + endpoint mapping
- `REPORT_bqms_exhaustive.md` — audit cũ
- `BQMS_LUONG_HOAT_DONG.md` (file này) — ngôn ngữ tự nhiên, dành cho nghiệp vụ

---

*Tài liệu này được tạo dựa trên kết quả audit E2E ngày 13/05/2026:*
*60 chức năng đã test PASS, 0 fail thực tế (3 fail còn lại là test script bug đã được xác nhận không phải lỗi code).*
