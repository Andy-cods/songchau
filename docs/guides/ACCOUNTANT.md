# Hướng Dẫn Sử Dụng Hệ Thống — Dành Cho Kế Toán

Chào bạn! Tài liệu này hướng dẫn cách sử dụng phần mềm ERP của công ty dành riêng cho vai trò **Kế toán**. Bạn không cần biết gì về kỹ thuật — cứ làm theo từng bước là được. Ở cuối tài liệu có mục "Cần Thang xác nhận" liệt kê vài chỗ hệ thống chưa hoàn thiện, bạn cứ đọc qua để biết trước, không phải lỗi do bạn thao tác sai.

## Bạn là ai, bạn làm được gì

Khi đăng nhập với tài khoản vai trò **Kế toán**, menu bên trái của bạn chỉ có 2 nhóm:

- **Tài chính**: Tài chính tổng hợp, Hóa đơn, Duyệt thanh toán, Báo cáo TC
- **Nhân sự**: Nghỉ phép & Chuyên cần

Bạn có toàn quyền xem và ghi nhận số liệu công nợ, sổ quỹ, duyệt các đề xuất thanh toán từ bên Kinh doanh (sales) gửi lên. Các phần khác của hệ thống (Mua hàng, BQMS, Đấu thầu NCC...) không hiển thị trong menu của bạn vì không thuộc phạm vi công việc Kế toán.

---

## 1. Xem công nợ phải thu / phải trả — "Tài chính tổng hợp"

**Mục đích:** Đây là màn hình chính, tổng hợp toàn bộ tình hình tài chính công ty ở một chỗ — công nợ khách hàng nợ mình (phải thu), công nợ mình nợ nhà cung cấp (phải trả), tiền mặt/ngân hàng, và dòng tiền.

**Các bước:**
1. Vào menu **Tài chính → Tài chính tổng hợp**.
2. Trên cùng là 6 ô số liệu nhanh: *Công nợ thu*, *Công nợ trả*, *Quá hạn thu*, *Quá hạn trả*, *Tiền mặt + NH*, *Dòng tiền kỳ này*.
3. Bên dưới là khối **"Tuổi nợ"** — chia công nợ phải thu (AR) và phải trả (AP) ra 4 khoảng: 0–30 ngày, 31–60 ngày, 61–90 ngày, và trên 90 ngày, giúp bạn thấy ngay khoản nào sắp/đã quá hạn lâu.
4. Tiếp theo là 2 bảng: **"Công nợ phải thu"** (khách hàng nào đang nợ mình) và **"Công nợ phải trả"** (mình đang nợ nhà cung cấp nào) — mỗi dòng có tên khách/NCC, số hóa đơn, số tiền, hạn thanh toán, đã thu/trả bao nhiêu, và trạng thái (Chưa TT / Một phần / Đã thanh toán / Quá hạn).
5. Cuối trang là **"Sổ quỹ gần đây"** — danh sách các khoản thu/chi tiền mặt gần nhất.
6. Bấm **"Tải lại"** ở góc trên phải bất cứ lúc nào để làm mới số liệu (trang cũng tự làm mới mỗi 30 giây).

**Mẹo:**
- 2 bảng công nợ ở trang này chỉ để **xem**, không có nút ghi nhận thu tiền/trả tiền ngay tại đây và cũng không có nút xuất file/tải Excel.
- Muốn **ghi nhận đã thu tiền** của một khách hàng cụ thể, hiện có 2 cách: (a) vào **Hóa đơn** → mở hóa đơn khách đó → bấm ghi nhận thanh toán (xem mục 3, nhưng lưu ý cảnh báo bên dưới); (b) có một trang riêng tên "Công nợ phải thu" hiển thị đầy đủ và có nút **"Ghi nhận thu tiền"** ngay trên từng dòng — nhưng trang này hiện **không có trong menu**, chỉ vào được nếu ai đó gửi bạn đường dẫn trực tiếp. Đã đưa vào mục cần Thang xác nhận bên dưới.

---

## 2. Ghi sổ quỹ (thu/chi tiền mặt, ngân hàng)

**Mục đích:** Ghi lại một khoản thu vào hoặc chi ra (tiền mặt, chuyển khoản) — ví dụ thu tiền khách, trả lương, trả tiền thuê mặt bằng, đóng thuế...

**Các bước:**
1. Ở trang **Tài chính tổng hợp**, bấm nút **"Ghi sổ quỹ"** (góc trên bên phải, cạnh nút Tải lại).
2. Trong cửa sổ hiện ra, chọn **Loại**: Thu / Chi / Chuyển khoản.
3. Chọn **Ngày**, chọn **Danh mục** (Thu từ khách hàng / Thanh toán NCC / Lương / Thuê mặt bằng / Thuế / Khác).
4. Nhập **Mô tả** (bắt buộc) và **Số tiền** (bắt buộc), chọn **Tiền tệ** (VND/USD/CNY).
5. Có thể thêm **Ghi chú** nếu cần.
6. Bấm **"Tạo bút toán"** để lưu. Bút toán mới sẽ hiện ngay trong bảng "Sổ quỹ gần đây".

**Mẹo:** Nếu bạn gõ thẳng đường dẫn `/finance/cash-book` vào trình duyệt, hệ thống sẽ tự động đưa bạn về đúng trang Tài chính tổng hợp này — vì sổ quỹ đã được gộp chung vào đây, không còn là trang riêng nữa.

---

## 3. Hóa đơn

**Mục đích:** Xem danh sách hóa đơn bán hàng, tình trạng thanh toán, và (về nguyên tắc) ghi nhận khách đã trả tiền hoặc gửi email hóa đơn cho khách.

**Các bước (theo thiết kế màn hình):**
1. Vào menu **Tài chính → Hóa đơn**.
2. Trang hiển thị 3 ô số liệu: *Công nợ chưa thu*, *Hóa đơn quá hạn*, *Doanh thu tháng này*.
3. Có thể lọc theo trạng thái (Nháp / Đã gửi / TT một phần / Đã thanh toán / Quá hạn / Đã hủy) và tìm theo số hóa đơn hoặc tên khách.
4. Bấm vào một dòng hóa đơn để xem chi tiết: danh sách mặt hàng, các lần đã thanh toán, và 2 nút "Gửi email" / ghi nhận thanh toán mới.

**⚠️ Lưu ý quan trọng (đã kiểm tra trong code, chưa được Thang xác nhận sửa):**
- Theo rà soát, phần "quyền truy cập" phía sau của mục Hóa đơn hiện **chưa cho phép vai trò Kế toán** gọi được dữ liệu — nghĩa là có khả năng khi bạn bấm vào menu "Hóa đơn", trang sẽ báo lỗi không tải được / không đủ quyền, dù mục này vẫn hiện trong menu của bạn. **Đây không phải do bạn thao tác sai** — đây là lỗi cấu hình quyền cần Thang xem lại.
- Nút **"Tạo hóa đơn"** trên trang danh sách hiện dẫn tới một trang chưa được xây dựng — bấm vào có thể báo "không tìm thấy trang".
- Trong màn chi tiết hóa đơn, 2 nút "Gửi email" và ghi nhận thanh toán mới cũng có khả năng báo lỗi tương tự (không khớp với phần xử lý phía sau, và phần xử lý đó cũng chưa cho phép vai trò Kế toán).
- **Cách thay thế tạm thời để không bị gián đoạn công việc:** dùng trang "Tài chính tổng hợp" (mục 1) để xem công nợ thu tổng quan, và trang ghi sổ quỹ (mục 2) để ghi nhận các khoản thu/chi thực tế cho tới khi mục Hóa đơn được sửa xong.

---

## 4. Đối soát công nợ (kiểm tra lệch số liệu AP/AR)

**Mục đích:** Đây là một chức năng kiểm tra tự động phát hiện 3 loại lệch số liệu công nợ: (1) tiền đã thu/trả thực tế không khớp số ghi trên hệ thống, (2) trạng thái hóa đơn (đã TT / một phần) không khớp số tiền thực nhận, (3) hóa đơn quá hạn nhưng chưa được đánh dấu "quá hạn".

**⚠️ Hiện chưa có nút hay màn hình nào trên giao diện cho chức năng này.** Chức năng đối soát này hiện chỉ tồn tại ở phía xử lý ngầm bên trong hệ thống (không có trang, không có nút bấm) — nghĩa là **bạn chưa thể tự chạy đối soát được**. Nếu bạn nghe nhắc tới "đối soát công nợ" hoặc thấy đường dẫn `/finance/reconcile` ở đâu đó (ví dụ trong một thông báo lỗi hệ thống), đó chỉ là một đường dẫn tham chiếu — trang thực tế **chưa được xây**, bấm vào sẽ không thấy gì hữu ích.

Mục này đã đưa vào "Cần Thang xác nhận" — cần quyết định có nên xây giao diện cho việc đối soát hay không.

---

## 5. Tỷ giá ngoại tệ (CNY/VND, USD/VND...)

**Mục đích:** Hệ thống dùng tỷ giá để quy đổi tiền hàng ngoại tệ sang VNĐ khi tính giá, báo giá... Tỷ giá có thể lấy tự động hoặc nhập tay.

**Cách hoạt động (theo code):** Khi có một tỷ giá được nhập **tay** (nguồn "manual") cho một ngày, hệ thống sẽ luôn ưu tiên lấy tỷ giá mới nhất theo ngày/giờ nhập — tức tỷ giá nhập tay gần đây nhất sẽ "thắng" và được dùng làm tỷ giá hiện hành, kể cả khi có tỷ giá tự động khác.

**⚠️ Hiện KHÔNG có trang hay nút nào trên giao diện để Kế toán tự nhập tỷ giá.** Theo rà soát code, việc tạo/sửa tỷ giá hiện chỉ cho phép vai trò **Quản lý (manager)** và **Quản trị viên (admin)** thực hiện — vai trò Kế toán hiện **không nằm trong danh sách được phép**, dù trong ghi chú code có ghi ý định là "kế toán nhập tay". Ngoài ra, cũng chưa có trang nhập liệu nào được xây dựng cho ai cả (kể cả admin) — chỉ có thể làm qua cách khác không phải qua giao diện thông thường.

**Việc bạn cần làm lúc này:** Nếu công ty cần cập nhật tỷ giá mới, hãy báo Thang hoặc người có quyền quản trị hỗ trợ cập nhật giúp, vì hiện tại tài khoản Kế toán chưa tự thao tác được trên giao diện.

---

## 6. Duyệt thanh toán (đề xuất thanh toán từ Kinh doanh)

**Mục đích:** Khi bên Kinh doanh (sales) đề xuất một khoản cần thanh toán (ví dụ trả tiền nhà cung cấp cho một đơn hàng), đề xuất đó sẽ về hàng đợi của bạn để duyệt hoặc từ chối.

**Các bước:**
1. Vào menu **Tài chính → Duyệt thanh toán**.
2. Trên cùng có 3 ô số liệu: *Chờ duyệt*, *Đã duyệt (7 ngày)*, *Đã từ chối (7 ngày)*.
3. Có thể lọc theo trạng thái (Chờ duyệt / Đã duyệt / Đã từ chối / Đã chi / Tất cả), tìm theo tên khách hàng hoặc tên sale đề xuất, và chọn khoảng ngày.
4. Bấm vào một dòng để mở chi tiết bên phải màn hình — xem đầy đủ: đơn hàng liên quan, danh sách mặt hàng, người thụ hưởng, ngân hàng/số tài khoản, hình thức thanh toán, ghi chú từ sales, lịch sử xử lý, và file báo giá (PDF) nếu có.
5. Nếu đề xuất đang **"Chờ duyệt"**, bạn có 2 lựa chọn:
   - Bấm **"Duyệt thanh toán"** (có thể ghi thêm ghi chú duyệt, ví dụ "OK chi NCC ABC, đã đối chiếu công nợ").
   - Bấm **"Từ chối"** — bắt buộc chọn 1 lý do (Sai thông tin tài khoản / Vượt hạn mức / Thiếu chứng từ / Đơn hàng chưa xác nhận / Khác) và phải nhập mô tả chi tiết.
6. Sau khi **đã duyệt**, sẽ xuất hiện thêm nút **"Đánh dấu đã chi"** — bấm nút này sau khi bạn đã thực sự chuyển tiền, để đóng vòng đề xuất đó lại (trạng thái chuyển thành "Đã chi").

**Mẹo:**
- Vòng đời 1 đề xuất: **Chờ duyệt → Đã duyệt → Đã chi**, hoặc **Chờ duyệt → Đã từ chối** (khi đó bên sales có thể sửa và gửi lại đề xuất mới).
- Hiện tại, việc bạn **duyệt thanh toán không tự động tạo công nợ phải thu (AR)** cho đơn hàng liên quan — tính năng tự động này (do hệ thống gọi là "auto-AR") đang được **tắt mặc định**, chờ Thang xem xét và bật khi sẵn sàng. Vì vậy, sau khi duyệt, nếu đơn hàng cần ghi công nợ phải thu, bạn vẫn cần tự ghi nhận thủ công (qua Hóa đơn hoặc Sổ quỹ) như quy trình hiện tại, tính năng tự động chưa chạy.

---

## 7. Báo cáo tài chính

**Mục đích:** Xem báo cáo lãi/lỗ, so sánh doanh thu theo tháng, và danh sách khách hàng đóng góp doanh thu nhiều nhất.

**Các bước:**
1. Vào menu **Tài chính → Báo cáo TC**.
2. Chọn khoảng thời gian: 3 / 6 / 12 tháng.
3. Xem các ô số liệu: doanh thu, giá vốn, lợi nhuận gộp, chi phí, lợi nhuận ròng, tỷ suất lợi nhuận.
4. Xem biểu đồ so sánh theo tháng và bảng Top khách hàng theo doanh thu.

**⚠️ Cảnh báo — trang này đang trong quá trình xây dựng, số liệu có thể SAI hoặc TRỐNG:**
- Theo ghi chú kỹ thuật mới nhất trong code, các ô số liệu (doanh thu/lợi nhuận...) hiện có thể hiển thị **"NaN₫"** (tức là lỗi, không phải số 0 thật) do phần hiển thị và phần xử lý dữ liệu phía sau đang không khớp nhau.
- Bộ chọn khoảng thời gian **3/6/12 tháng hiện chưa có tác dụng thực sự** (phần xử lý phía sau bỏ qua lựa chọn này).
- Biểu đồ so sánh theo tháng và bảng Top khách hàng có thể hiển thị **trống**.
- Khi vào trang, bạn có thể thấy một dòng thông báo tự động cảnh báo "module đang triển khai" — đây là bình thường, hệ thống tự nhắc bạn nên dùng trang này như tham khảo, **không dùng để chốt số liệu chính thức**. Hãy dùng trang **"Tài chính tổng hợp"** (mục 1) làm nguồn số liệu đáng tin cậy hơn trong lúc chờ sửa.

---

## Cần Thang xác nhận

1. **Mục Hóa đơn (`/finance/invoices`) — nghi ngờ chặn quyền Kế toán.** Phần xử lý phía sau của toàn bộ mục Hóa đơn (xem danh sách, xem chi tiết, gửi email, ghi nhận thanh toán) hiện chỉ cho phép vai trò staff/manager/admin — không có accountant, dù menu vẫn hiển thị mục này cho Kế toán. Cần xác nhận có đúng là accountant đang bị chặn không, và nếu đúng thì có nên bổ sung quyền.
2. **Nút "Tạo hóa đơn" trỏ tới trang chưa tồn tại** (`/invoices/new`) — cần xác nhận có nên xây trang này, hay tạm ẩn nút.
3. **2 nút trong màn chi tiết hóa đơn ("Gửi email", ghi nhận thanh toán) gọi sai đường dẫn xử lý phía sau** so với các đường dẫn thực tế đang có — cần xác nhận có nên sửa lại cho khớp.
4. **Đối soát công nợ AP/AR (`/finance/reconcile`) chưa có giao diện** — chỉ tồn tại như một chức năng kiểm tra ngầm chưa có màn hình. Cần xác nhận có nên xây giao diện cho Kế toán tự chạy đối soát, hay đây chỉ là công cụ nội bộ.
5. **Nhập tỷ giá thủ công chưa cho phép vai trò Kế toán** (chỉ manager/admin), và cũng **chưa có trang nhập liệu nào cho ai cả**. Cần xác nhận: có mở quyền cho Kế toán không, và xây giao diện nhập tỷ giá ở đâu.
6. **Trang "Công nợ phải thu" (`/finance/receivables`) có đầy đủ chức năng (kể cả nút "Ghi nhận thu tiền" ngay trên từng dòng) nhưng không có trong menu** — chỉ vào được qua đường dẫn trực tiếp. Cần xác nhận có nên thêm vào menu Kế toán vì nó hữu ích hơn 2 bảng chỉ-xem ở "Tài chính tổng hợp".
7. **Trang "Bảng kê HĐ quý" (`/finance/quarterly-invoices`) tồn tại và hoạt động nhưng không có trong menu chính** — chỉ xuất hiện dưới dạng gợi ý khi vào trang Báo cáo TC. Cần xác nhận có nên thêm vào menu.
8. **Auto-AR (tự động tạo công nợ phải thu khi duyệt thanh toán) đang tắt mặc định** — cần Thang xác nhận thời điểm bật, vì sẽ thay đổi quy trình hiện tại (Kế toán đang phải tự ghi công nợ thủ công).
9. **Báo cáo tài chính (`/finance/reports`) đang có lỗi số liệu đã biết** (NaN, bộ lọc tháng không hoạt động, biểu đồ/bảng trống) — cần xác nhận thời điểm sửa xong để Kế toán có thể dùng làm số liệu chính thức.
