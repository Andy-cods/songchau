# 📇 Hướng dẫn sử dụng — Kinh doanh (Sales)

## Bạn là ai, bạn làm được gì

Bạn đang dùng ERP với vai trò **Kinh doanh**. Menu bên trái (sidebar) của bạn có các nhóm sau:

- **Tổng quan**: Tổng quan (trang chủ), Báo cáo hàng ngày, BQMS, Giao hàng, Quản lý tài liệu.
- **Khách hàng & Mua hàng**: Khách hàng (CRM), Mua hàng.
- **Đấu thầu NCC**: chỉ có mục **Phiên đấu thầu** — bạn KHÔNG thấy "Phân tích đấu thầu" hay "Xếp hạng NCC" (2 mục đó chỉ dành cho quản lý/admin).
- **Tài chính**: chỉ có mục **Đề xuất TT của tôi** — bạn chỉ thấy các đề xuất thanh toán do chính mình tạo, không thấy của người khác.
- **Phân tích**: Tra cứu giá XNK, Xu hướng giá, Thư viện nguồn cung.
- **Nhân sự**: Nghỉ phép & Chuyên cần.

Hướng dẫn này tập trung vào 4 việc bạn làm nhiều nhất: quản lý khách hàng (CRM), tra giá + lưu nguồn cung (Sourcing), tạo báo giá gửi khách, và theo dõi đơn hàng. Cuối bài có thêm vài mục phụ ngắn gọn.

## Xem và tạo khách hàng mới (CRM)

**Mục đích:** quản lý danh sách khách hàng của bạn, không quên lịch hẹn/follow-up, xem nhanh lịch sử báo giá — đơn hàng — công nợ của từng khách.

**Các bước:**

1. Vào menu **Khách hàng** (nhóm "Khách hàng & Mua hàng").
2. Trang mặc định hiển thị dạng **Bảng**; có thể bấm nút chuyển sang **Pipeline** (xem khách hàng dạng các cột giai đoạn: Mới tiếp nhận → Đang chăm sóc → Có RFQ/PO mới → Đang giao hàng → Theo dõi sau bán) ở góc trên bên phải.
3. Thanh số liệu phía trên cho biết: Tổng KH, Có đơn, Doanh thu, Quá hạn FU (follow-up quá hạn), Hôm nay, Mới tháng. Bấm vào "Quá hạn FU" hoặc "Hôm nay" để mở nhanh khung "Cần làm" bên phải/trên cùng.
4. Dùng ô **"Tìm công ty / mã / MST / liên hệ / chủ sở hữu…"** để tìm khách hàng; có thể lọc theo hệ (BQMS/IMV), theo trạng thái Hoạt động/Ngừng, và chuyển giữa **"KH của tôi"** / **"Tất cả"**.
5. Để thêm khách hàng mới: bấm nút **"+ Thêm KH"** ở góc trên bên phải. Trong form điền:
   - **Thông tin công ty**: Tên công ty (*), Tên viết tắt, Mã khách hàng (*), Mã số thuế, Loại khách hàng (*) (Doanh nghiệp / Cơ quan nhà nước / Cá nhân / Đại lý phân phối / Khác), Ngành nghề (*), Quy mô công ty, Hệ thống KD (BQMS Samsung hoặc iMarket Vietnam), Địa chỉ, Website.
   - **Người liên hệ**: Họ tên (*), Chức vụ/Phòng ban, Số điện thoại, Email (phải điền ít nhất 1 trong 2: SĐT hoặc Email), Kênh ưu tiên, Nguồn lead.
   - **Ghi chú**: mô tả thêm về khách hàng, yêu cầu đặc biệt.
   - Khi bạn rời khỏi ô Tên công ty / MST / SĐT / Email, hệ thống tự kiểm tra trùng lặp. Nếu phát hiện khách hàng giống, sẽ hiện cảnh báo màu vàng liệt kê các khách trùng kèm link "Mở hồ sơ" — bạn phải tick **"Tôi xác nhận đây là KH KHÁC, vẫn tạo mới"** mới lưu tiếp được.
   - Bấm **"Tạo khách hàng + Lead"** — hệ thống tạo khách hàng và đồng thời tạo 1 card trong pipeline CRM.
6. Bấm vào 1 dòng khách hàng trong bảng để mở trang chi tiết, có 4 tab:
   - **Tổng quan**: thông tin nhanh (địa chỉ, SĐT, email, hệ thống, người phụ trách), tóm tắt Báo giá (số RFQ, tỷ lệ trúng), Tài chính (công nợ theo tuổi nợ + doanh thu + thanh toán gần đây), và "Liên kết dữ liệu" (nối dữ liệu PO/giao hàng Samsung của khách này — chỉ Quản lý/Admin sửa được, bạn chỉ xem).
   - **📁 Hồ sơ**: xem 4 "thư mục ảo" bên trái — **Báo giá**, **Đơn hàng**, **Mã đã sourcing**, **Tài liệu** — mỗi thư mục có bảng riêng (chi tiết ở mục "Tạo báo giá cho khách hàng" bên dưới). Lưu ý: mục "Đơn hàng" ở đây là các đơn hàng bạn tạo từ báo giá (khác với tab "Đơn hàng" bên ngoài).
   - **Đơn hàng** (tab ngoài): danh sách PO Samsung + các lô giao hàng liên quan tới khách này (chỉ có nếu khách đã được nối dữ liệu BQMS).
   - **Liên hệ**: danh sách người liên hệ của khách, có nút "Ghi tương tác" và "Thêm liên hệ".
7. Trên trang chi tiết, các nút ở đầu trang:
   - **"Sửa"**: mở khung sửa nhanh (tên công ty, tên rút gọn, địa chỉ, ghi chú, người liên hệ chính). Riêng **MST** và **người phụ trách** chỉ Quản lý sửa được.
   - **"Báo giá"**: mở luôn khung tạo báo giá cho khách này (xem mục kế tiếp).
   - **"Ghi nhanh ▾"**: có 2 lựa chọn — **"Ghi tương tác"** (ghi lại 1 lần liên hệ: gọi điện/email/gặp mặt/demo/hỗ trợ kỹ thuật/khác, kèm ghi chú và ngày hẹn follow-up) và **"Thêm liên hệ"** (thêm 1 người liên hệ mới cho khách).
8. Ở trang danh sách, rê chuột qua 1 dòng khách hàng để hiện 3 icon thao tác nhanh: Sửa nhanh, Ghi tương tác, Thêm liên hệ.

**Mẹo:** Nếu bạn được quản lý bấm "Gán chủ sở hữu" cho mình, khách đó sẽ hiện trong bộ lọc "KH của tôi" và trong khung "Cần làm" mỗi khi tới hạn follow-up.

## Sourcing: tìm giá & lưu nguồn cung (Thư viện nguồn cung)

**Mục đích:** tra lại giá đã báo/đã mua cho 1 mã hàng trước đây, lưu thông tin nhà cung cấp (NCC) + giá để dùng lại sau này, tránh báo sai giá hoặc quên NCC cũ.

**Các bước:**

1. Vào menu **Thư viện nguồn cung** (nhóm "Phân tích").
2. Trang mặc định ẩn khối "Thống kê tổng quan" ở trên — bấm vào để mở nếu cần xem số liệu tổng (tổng entries, bao nhiêu đã có giá bán, mã unique, độ phủ brand...).
3. Dùng ô tìm kiếm **"Tìm model / BQMS / sản phẩm / khách / NCC..."** (mẹo: gõ phím **/** ở bất kỳ đâu trên trang để nhảy thẳng vào ô này). Có thể lọc thêm theo Catalog, Brand, Stage, Status, Khách hàng, và "Giá" (Có giá bán / Chưa có giá).
4. Bảng liệt kê từng "nguồn cung" đã lưu, gồm: Ảnh, Sản phẩm (model/mã BQMS/tên), Khách + người phụ trách, NSX (nhà sản xuất), NCC, Giá (giá bán + % biên lợi nhuận — tô màu xanh/vàng/đỏ theo mức lời), Catalog, Phân loại. Bấm vào 1 dòng để mở khung chi tiết đầy đủ.
5. Để **lưu 1 nguồn cung mới**: bấm nút tím **"Lưu nguồn mới"** ở góc trên bên phải. Khung mở ra có 5 mục (chọn ở thanh dọc bên trái):
   - **Sản phẩm**: Model/Spec, Mã BQMS (để trống nếu không gắn RFQ nào), Nhà sản xuất, Tên sản phẩm.
   - **Khách hàng**: chọn khách hàng từ danh bạ CRM (gõ để tìm) — hệ thống tự điền tên hiển thị trên báo giá; chọn Người phụ trách (Sale); nhập Ngày hỏi giá.
   - **Giá — Multi-currency**: chọn Tiền tệ (VNĐ/Yên Nhật/USD/Won Hàn/Nhân dân tệ/Euro), nhập Giá nhập/đơn vị (tỷ giá tự lấy từ bảng tỷ giá theo loại tiền), Số lượng, Cân nặng (kg — dùng cho hàng hỏi giá nước ngoài).
   - **Nhà cung cấp**: có thể thêm NHIỀU NCC cho cùng 1 mã hàng — mỗi NCC gồm Tên NCC, Số điện thoại, Email, loại tiền + giá nhập, Lead time (ngày giao hàng), MOQ (số lượng tối thiểu), Ghi chú NCC. Chọn 1 NCC làm "NCC chính".
   - **Phân loại / Ghi chú**: Trạng thái xử lý (Validated/Quoted/Sample/Candidate/Rejected — chỉ để theo dõi, không ảnh hưởng tới giá), Ghi chú công khai (mọi người xem được), Ghi chú nội bộ (chỉ team sourcing thấy), và có thể dán ảnh sản phẩm trực tiếp bằng Ctrl+V hoặc kéo-thả.
   - Lưu bằng phím tắt Ctrl+S (hoặc nút Lưu ở cuối khung).
6. Để **so sánh giá giữa các NCC** cùng 1 mã: rê chuột qua dòng đó, bấm icon "So sánh NCC" (2 mũi tên chéo).
7. **Import Excel**: bấm nút "Import Excel" ở góc trên để nạp danh sách hàng loạt từ file Excel.
8. **Tra cứu hàng loạt**: bấm nút "Tra cứu hàng loạt" — dán một danh sách nhiều Model (mỗi dòng 1 mã, hoặc cách nhau bằng dấu phẩy) để tra nhanh lịch sử giá cho tất cả các mã cùng lúc.
9. Khi cần **tạo báo giá** hoặc **gửi đấu thầu** từ những mã đã lưu: tick chọn (checkbox) 1 hoặc nhiều dòng — một thanh hành động màu xanh lá sẽ hiện ra phía trên bảng với 2 nút: **"Tạo báo giá (N)"** (xem mục kế tiếp) và **"Gửi đấu thầu (N)"** (đẩy các mã đã chọn sang module Đấu thầu NCC để mời nhà cung cấp báo giá cạnh tranh).

**Mẹo:** Cột "Giá" hiển thị luôn % biên lợi nhuận theo màu (xanh ≥30%, vàng 10–30%, đỏ <10%) — nhìn thoáng qua là biết mã nào đang lời mỏng.

## Tạo báo giá cho khách hàng (Customer Quote Hub)

**Mục đích:** gộp các mã đã lưu ở Thư viện nguồn cung thành 1 bộ báo giá, xuất file Excel/PDF/TSV để gửi khách, rồi theo dõi luôn đơn hàng phát sinh từ báo giá đó.

**Lưu ý quan trọng:** Đây là báo giá cho **khách hàng thường (CRM)** của công ty. Nó hoàn toàn khác với báo giá gửi cho **Samsung qua hệ BQMS** — xem mục "Báo giá cho Samsung (BQMS)" bên dưới. Hai luồng này KHÔNG dùng chung màn hình, đừng nhầm lẫn.

**Các bước:**

Có 2 cách mở khung tạo báo giá:

1. **Từ trang Khách hàng** (`/crm`): bấm nút **"Báo giá"** trên đầu trang (không cần chọn sẵn dòng nào) — khung mở ra sẽ để bạn chọn khách hàng bên trong. Hoặc mở 1 khách hàng cụ thể rồi bấm nút "Báo giá" ở đầu trang chi tiết — khách hàng đó sẽ được khoá sẵn.
2. **Từ Thư viện nguồn cung** (`/sourcing`): tick chọn các dòng cần báo giá rồi bấm **"Tạo báo giá (N)"**.

Trong khung **"Tạo báo giá hàng loạt"**:

1. Chọn **Khách hàng** (nếu chưa khoá sẵn) — gõ tên/mã/MST để tìm; hệ thống tự điền MST, người liên hệ, địa chỉ của khách.
2. Điền **Ghi chú** (tuỳ chọn), **Hiệu lực đến** (ngày hết hạn báo giá), và chọn **Người báo giá** (tên bạn hoặc đồng nghiệp phụ trách).
3. Thêm dòng sản phẩm bằng ô **"Thêm dòng"** — gõ mã/tên để tìm trong Thư viện nguồn cung rồi thêm vào báo giá (nếu bạn vào từ /sourcing với các dòng đã tick sẵn thì chúng đã có sẵn trong danh sách). Cũng có thể dán nhiều mã cùng lúc từ IMV/Excel/danh sách khác.
4. Với **mỗi dòng sản phẩm**, bạn cần: chọn đúng 1 NCC (giá) hoặc tự nhập giá tay (phải lớn hơn 0), nhập **Số lượng (SL)**, và thời gian **Giao hàng** (ví dụ "20-25 ngày"). Nếu khách này từng được báo giá mã đó trước đây, hệ thống sẽ gợi ý **"Lần trước: ₫... — Áp dụng"** để lấy lại giá cũ chỉ với 1 cú bấm.
5. Chọn **Định dạng** xuất file: Excel / PDF / TSV. Nếu chọn PDF, có thể bấm **"Xem preview"** để xem trước khi tải.
6. Khi tất cả các dòng đã chọn giá hợp lệ (dòng chữ "Tất cả N dòng đã chọn giá ✓" chuyển sang màu xanh), bấm **"Tạo + tải Excel/PDF/TSV"** để xuất file — báo giá này cũng được lưu lại trong hệ thống.
7. Xem lại các báo giá đã tạo cho 1 khách: vào trang chi tiết khách hàng đó > tab **"📁 Hồ sơ"** > thư mục **"Báo giá"**. Mỗi báo giá có các thao tác:
   - **Tải**: tải lại file đã xuất.
   - **Gửi / Gửi lại**: đánh dấu đã gửi cho khách (chuyển trạng thái Nháp → Đã gửi).
   - **Sửa & gửi lại**: tạo 1 phiên bản mới (v2, v3…) của báo giá khi cần chỉnh giá hoặc thông tin.
   - **Tạo đơn**: khi khách đồng ý mua, bấm để tạo 1 Đơn hàng từ báo giá này. Nếu đơn đã được tạo rồi, nút này đổi thành link "Đơn {số}" để mở lại đơn đó ngay.

## Theo dõi đơn hàng

**Mục đích:** theo dõi toàn bộ đơn hàng phát sinh từ báo giá — từ lúc khách chốt mua đến khi giao hàng xong.

**Các bước:**

1. Vào Thư viện nguồn cung (`/sourcing`) rồi bấm nút **"Theo dõi đơn hàng"** ở góc trên bên phải. (Bạn cũng có thể vào từ tab 📁 Hồ sơ của 1 khách hàng, thư mục "Đơn hàng", bấm vào 1 dòng.)
2. Trang có 2 cách xem, chuyển bằng nút góc trên bên phải: **Pipeline** (dạng cột theo trạng thái) và **Bảng** (dạng danh sách).
3. Đơn hàng đi qua các trạng thái: **Nháp → Đã báo giá → Khách chốt → Đề xuất TT → Đã duyệt TT → Đang giao → Đã giao** (và có thể bị Huỷ). Bấm vào 1 ô số liệu ở trên (ví dụ "Khách chốt") để lọc nhanh các đơn đang ở trạng thái đó.
4. Bấm vào 1 đơn (thẻ ở Pipeline hoặc dòng ở Bảng) để mở khung xem chi tiết đơn.
5. Ở chế độ **Bảng**, mỗi dòng có 3 nút thao tác nhanh:
   - **"PDF báo giá"**: mở lại file báo giá gốc của đơn này (chỉ bấm được nếu đơn có gắn báo giá).
   - **"Khách đã đặt"**: xác nhận khách đã chốt mua hàng — chuyển đơn sang trạng thái "Khách chốt" (chỉ thực hiện 1 lần, sau đó nút hiện "Đã đặt").
   - **"Đề xuất TT"**: gửi yêu cầu thanh toán cho Kế toán duyệt — chỉ dùng được khi đơn đã ở trạng thái "Khách chốt".
6. Có thể tick chọn nhiều đơn cùng lúc rồi đổi trạng thái hàng loạt bằng thanh **"N đơn đã chọn"** hiện ra phía trên bảng.

**Mẹo:** Nút "Đề xuất TT" ở đây chính là nơi tạo ra các dòng bạn sẽ thấy lại ở menu Tài chính > **"Đề xuất TT của tôi"**.

## Báo giá cho Samsung (BQMS)

**Mục đích:** đây là luồng báo giá RIÊNG dành cho các mã hàng Samsung hỏi giá qua hệ BQMS — khác hoàn toàn với việc tạo báo giá cho khách hàng thường ở mục phía trên.

**Các bước:**

1. Vào menu **BQMS** (nhóm "Tổng quan") — đây là danh sách các mã Samsung đang hỏi giá (RFQ), có đánh dấu mã nào đang "Chờ báo".
2. Bấm vào 1 dòng RFQ để mở khung chi tiết, rồi bấm nút **"Báo giá ngay"** — hệ thống mở khoá các vòng giá (V1 đến V4) cho mã đó và gán về bạn.
3. Nhập giá cho từng vòng V1–V4 (tuỳ Samsung yêu cầu bao nhiêu vòng).
4. Khi đã nhập ít nhất 1 vòng giá, nút **"🚀 Đẩy lên SEC V{số vòng}"** sẽ xuất hiện — bấm để đẩy báo giá đó thẳng lên hệ thống sec-bqms.com của Samsung (ở dạng lưu tạm).
5. Ngoài ra còn có công cụ riêng gọi là **"Tạo Báo Giá Tự Động"** (vào từ Báo cáo hàng ngày > "Hành động nhanh" > **"Tạo báo giá mới"**): bạn nhập mã RFQ (ví dụ QT24138430) hoặc tải lên file Excel "BC BQMS", hệ thống sẽ tự tạo file báo giá theo mẫu Excel có sẵn. Các mẫu này được quản lý ở trang "Quản Lý Template", và mọi báo giá đã tạo được lưu lại ở trang **"Lịch Sử Báo Giá"** (có thể tải lại, chia sẻ link, hoặc đồng bộ lên OneDrive từ đó).

## Đề xuất thanh toán của tôi

**Mục đích:** theo dõi các yêu cầu thanh toán bạn đã gửi Kế toán (từ nút "Đề xuất TT" ở trang Theo dõi đơn hàng).

**Các bước:**
1. Vào menu **"Đề xuất TT của tôi"** (nhóm Tài chính).
2. Bạn chỉ thấy các đề xuất do chính mình tạo, với trạng thái: Chờ duyệt / Đã duyệt / Đã từ chối / Đã chi.
3. Lọc theo trạng thái, theo tên khách hàng, hoặc theo khoảng ngày. Bấm vào 1 dòng để xem chi tiết.

## Báo cáo hàng ngày

**Mục đích:** xem nhanh số liệu doanh thu và tình hình báo giá trong ngày.

**Các bước:**
1. Vào menu **"Báo cáo hàng ngày"**. Trang tự làm mới mỗi 60 giây nếu đang xem ngày hôm nay.
2. Xem số yêu cầu hỏi giá hôm nay, doanh thu PO theo ngày/tuần/tháng (so với cùng kỳ năm trước), biểu đồ xu hướng, và bảng nhiệt (heatmap) các mã bán chạy gần đây.
3. Nút **"Hành động nhanh"** cho phép nhảy thẳng tới: Tạo báo giá mới (BQMS), Tra giá (Ctrl+K), Đồng bộ BQMS, Quản lý giao hàng.
4. Có thể sao chép nội dung báo cáo (nút copy) hoặc in trang.

## Tra cứu giá

**Mục đích:** tra giá thị trường XNK và xem xu hướng giá kinh doanh của công ty theo thời gian.

**Các bước:**
1. **Tra cứu giá XNK** (`/market-prices`): dùng ô tìm "Tìm theo BQMS code, tên hàng, HS code, đối thủ..." hoặc lọc riêng theo BQMS code / HS code / tên đối thủ (bên bán) để xem lịch sử giá xuất nhập khẩu.
2. **Xu hướng giá** (`/analytics/price-trends`): lọc theo mã BQMS để xem biểu đồ giá theo tháng (nhiều đường: giá theo vai trò, theo khách hàng, theo NCC) cùng vài số liệu tổng quan (doanh số báo giá trong tháng, tỷ lệ trúng, số mã giá đang biến động mạnh).

## Phiên đấu thầu NCC (xem cơ bản)

Menu **"Phiên đấu thầu"** (nhóm "Đấu thầu NCC") cho bạn xem danh sách các phiên đấu thầu nhà cung cấp: mã phiên, tiêu đề, trạng thái, số mã linh kiện, số NCC đã mời, số báo giá đã nhận. Bấm vào 1 phiên để xem nhanh, rồi bấm **"Mở workspace"** để vào chi tiết. Bạn **không có** menu "Phân tích đấu thầu" hay "Xếp hạng NCC" — 2 phần đó chỉ dành cho quản lý/admin.

## Cần Thang xác nhận

- **Trang `/bqms/quotation` (3 bước: Upload PDF RFQ → Xem & Sửa → Gửi duyệt)**: chỉ được liên kết từ 1 nút lọc "quá hạn" ở Dashboard biểu đồ (`?filter=overdue`) mà bản thân trang không đọc tham số này — trông giống trang cũ/mồ côi, khác hẳn luồng "Báo giá ngay" + "Đẩy lên SEC" đang dùng thật trong `/bqms`, và cũng khác luồng "Tạo Báo Giá Tự Động" ở `/bqms/quotation/new` (đang được liên kết thật từ nhiều nơi). Guide này **không hướng dẫn** sales dùng trang 3 bước đó — đề nghị Thang xác nhận có nên xoá hẳn hay còn dùng cho việc gì khác.
- **`/orders/unified`**: đã là 1 trang redirect rỗng (đánh dấu mồ côi từ đợt cook trước), không có nav nào trỏ tới. Guide dùng `/sourcing/orders` làm trang "Theo dõi đơn hàng" cho sales — xin xác nhận đây đúng là trang Thang muốn nhân viên Kinh doanh dùng.
- **`/vendor-bidding`**: sidebar sales chỉ hiện tab "Phiên đấu thầu", nhưng về giao diện các tab khác (Hợp đồng, Đơn mua PO, Giao hàng, Tài khoản NCC) nằm trong cùng 1 trang nên sales vẫn có thể bấm qua xem — không rõ backend có chặn dữ liệu (403) cho các tab đó với role sales hay không. Đề nghị Thang xác nhận để tránh guide hướng dẫn nhầm vào phần sales không có quyền.
- **Giao hàng (`/bqms/deliveries`)**: có trong sidebar sales nhưng không nằm trong phạm vi yêu cầu viết chi tiết lần này — guide chỉ nêu tên menu. Xác nhận có cần bổ sung mục riêng hướng dẫn Giao hàng cho sales không (trang này khá thiên về vận hành/kho, có nhiều thao tác sửa số liệu giao hàng không phân quyền theo role ở giao diện).
