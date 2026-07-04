# Hướng dẫn sử dụng Song Châu ERP — Dành cho Quản lý / Giám đốc

Chào bạn, đây là hướng dẫn nhanh giúp bạn dùng hệ thống ERP để duyệt các yêu cầu, xem báo cáo và quản lý đội ngũ. Tài liệu này viết cho người dùng bình thường, không cần biết kỹ thuật — cứ đọc theo từng bước là làm được.

## Bạn là ai, bạn làm được gì

Khi đăng nhập với quyền Quản lý (manager) hoặc Giám đốc (director), menu bên trái của bạn sẽ có gần như đầy đủ mọi khu vực của hệ thống:

- **Tổng quan** — trang chủ xem số liệu kinh doanh
- **BQMS Samsung** — báo giá, đơn hàng trúng thầu, giao hàng cho Samsung
- **IMV iMarketVietnam**
- **Khách hàng & Mua hàng** — quản lý khách hàng (CRM) và mua hàng
- **Đấu thầu NCC** — tổ chức đấu thầu nhà cung cấp, phân tích, xếp hạng
- **Tài chính** — tài chính tổng hợp, hóa đơn, **duyệt thanh toán**, báo cáo
- **Phân tích** — tra cứu giá, xu hướng giá, thư viện nguồn cung
- **Nhân sự** — nghỉ phép/chuyên cần, và **năng suất nhân viên** (mục này chỉ Quản lý/Admin mới thấy, nhân viên thường không có)

Khu vực duy nhất bạn KHÔNG thấy so với Admin là mục **"Hệ thống"** (quản lý nhà cung cấp/người dùng/cài đặt) — mục này chỉ dành cho Admin.

Bên dưới là hướng dẫn chi tiết cho từng việc quan trọng nhất bạn sẽ làm hàng ngày.

## 1. Xem tổng quan hoạt động kinh doanh (Dashboard)

### Mục đích
Nắm nhanh "sức khỏe" kinh doanh của công ty trong 1 trang: RFQ tháng này, tỷ lệ thắng thầu, doanh thu, đơn hàng quá hạn, tình hình giao hàng, PO Samsung và cổng nhà cung cấp.

### Các bước
1. Vào menu **Tổng quan** (trang này tự mở khi bạn đăng nhập).
2. Xem 4 số lớn ở đầu trang: **RFQ tháng này**, **Win Rate (3 tháng)**, **Tổng RFQ pipeline**, **Quá hạn**.
3. Cuộn xuống xem các biểu đồ: "Hoạt động theo tháng" (báo giá vs. chốt được), "So sánh cùng kỳ" (năm nay vs năm trước), "Phễu chuyển đổi kinh doanh" (từ RFQ đến xuất hóa đơn).
4. Xem "Phân bổ theo Maker" (donut) và bảng "RFQ cần xử lý ngay" — bấm vào 1 dòng RFQ để mở thẳng trang báo giá của mã đó.
5. Cuối trang có 3 khối: **Giao hàng**, **PO Samsung**, **Cổng Nhà Cung Cấp** — mỗi khối có nút "Xem tất cả" để đi sâu hơn.

### Mẹo
- Số liệu tự làm mới mỗi 30 giây, không cần bấm tải lại.
- Ô "Quá hạn" tô đỏ nếu quá 100 mã — bấm "Cần xử lý ngay" để nhảy thẳng tới danh sách RFQ quá hạn.
- Nếu bạn đăng nhập bằng tài khoản chỉ xem (viewer), hệ thống sẽ tự chuyển bạn sang trang "Báo cáo hàng ngày" thay vì Tổng quan.

## 2. Duyệt thanh toán (đề xuất chi tiền từ Sales)

### Mục đích
Khi nhân viên Sales đẩy một đơn hàng sang "yêu cầu thanh toán", đề xuất đó sẽ nằm chờ ở đây để bạn (hoặc kế toán) xem xét và quyết định duyệt hay từ chối.

### Các bước
1. Vào menu **Tài chính > Duyệt thanh toán** (đường dẫn `/finance/payment-approvals`).
2. Trang hiện 3 số nhanh: **Chờ duyệt**, **Đã duyệt (7 ngày)**, **Đã từ chối (7 ngày)**.
3. Dùng thanh lọc trạng thái (Chờ duyệt / Đã duyệt / Đã từ chối / Đã chi / Tất cả), có thể lọc thêm theo tên khách hàng, tên Sale đề xuất, khoảng ngày.
4. Bấm vào 1 dòng trong bảng để mở **ngăn chi tiết** bên phải — xem đầy đủ: số tiền, đơn hàng liên quan, danh sách hàng hóa, người thụ hưởng, ngân hàng/số tài khoản, ghi chú của Sale, lịch sử xử lý, và có thể xem PDF báo giá đính kèm.
5. Trong ngăn chi tiết, ở mục **"Quyết định"**:
   - Muốn duyệt: ghi chú (không bắt buộc) rồi bấm **"Duyệt thanh toán"**.
   - Muốn từ chối: bấm **"Từ chối"**, chọn 1 lý do có sẵn (Sai thông tin tài khoản / Vượt hạn mức / Thiếu chứng từ / Đơn hàng chưa xác nhận / Khác) và **bắt buộc gõ thêm mô tả chi tiết**, rồi bấm "Xác nhận từ chối".
6. Sau khi một đề xuất đã **Đã duyệt**, khi tiền đã thực sự được chuyển, bấm nút **"Đánh dấu đã chi"** để đóng hồ sơ.

### Mẹo
- Đây là quy trình duyệt **1 cấp** (không phải 2 cấp): chỉ cần Quản lý/Kế toán/Admin duyệt là xong, không cần thêm người thứ hai.
- Nếu bạn là Sales, trang này chỉ hiện đề xuất của chính bạn (không thấy của người khác) và không có quyền duyệt.

## 3. Duyệt các yêu cầu khác: PO, thay đổi giá, NCC mới

### Mục đích
Ngoài thanh toán, hệ thống còn có một luồng duyệt chung cho các yêu cầu khác: **Duyệt PO**, **Thay đổi giá**, **NCC mới** (và cả thanh toán, nếu tạo qua luồng này).

### Các bước
1. Trang này **hiện chưa có trong menu bên trái** — bạn cần gõ trực tiếp vào cuối đường link ERP hiện tại: đổi phần cuối thành **`/approvals`** (ví dụ nếu bạn đang ở `.../dashboard` thì sửa thành `.../approvals`).
2. Trang có 2 phần:
   - **"Đang chờ duyệt"** — các thẻ yêu cầu cần bạn xử lý, mỗi thẻ có tiêu đề, loại yêu cầu, mức độ ưu tiên, số tiền (nếu có), người tạo và 2 nút **"Duyệt"** / **"Từ chối"** ngay trên thẻ.
   - **"Đã xử lý gần đây"** — danh sách các yêu cầu đã Duyệt/Từ chối gần đây nhất.
3. Bấm **"Duyệt"** để đồng ý ngay. Bấm **"Từ chối"** sẽ hiện ô nhập lý do (bắt buộc) trước khi xác nhận.

### Mẹo
- Yêu cầu giá trị lớn có thể cần thêm một cấp duyệt của Admin sau khi bạn duyệt xong (bạn sẽ không thấy các yêu cầu ở cấp đó, chỉ Admin xử lý).
- Hệ thống còn có một trang tương tự tên là `/workflows` (dạng bảng, có thêm nút "Chuyển cấp trên") — **hiện trang này có lỗi hiển thị: nút Duyệt/Từ chối không xuất hiện đúng cho các yêu cầu đang chờ thật sự**, nên bạn nên dùng `/approvals` ở trên để duyệt cho chắc ăn.

## 4. Duyệt chốt thầu nhà cung cấp (Đấu thầu NCC)

### Mục đích
Sau khi nhân viên mua hàng so sánh báo giá của các nhà cung cấp và chọn ra người thắng thầu, đề xuất "Chốt thầu" đó sẽ treo chờ **một người thứ hai** (bạn — Quản lý, hoặc Admin) xác nhận trước khi hệ thống ghi nhận công nợ. Đây gọi là cơ chế "2 người xác nhận" để tránh sai sót/gian lận.

### Các bước
1. Vào menu **Đấu thầu NCC > Phiên đấu thầu** (`/vendor-bidding`), chọn phiên đang có đề xuất chốt thầu chờ duyệt.
2. Trong trang chi tiết phiên, nếu có đề xuất đang chờ, bạn sẽ thấy banner màu vàng: **"⏳ Chờ duyệt chốt thầu — Do [tên người đề xuất] đề xuất. Cần người thứ hai duyệt trước khi sinh công nợ."**
3. Có 2 nút:
   - **"Duyệt chốt thầu"** — xác nhận đồng ý, hệ thống sẽ chính thức chốt nhà cung cấp thắng thầu và bắt đầu tính công nợ.
   - **"Từ chối"** — bắt buộc nhập lý do; phiên sẽ quay lại trạng thái "đang xét" để nhân viên mua hàng chọn lại.
4. Ngoài ra, một phiên đấu thầu mới tạo có thể cần bạn **duyệt nội bộ trước khi công bố cho nhà cung cấp** (nút "Duyệt" / "Từ chối" / "Chuyển cấp trên" ở đầu trang phiên, khi phiên đang ở trạng thái chờ duyệt nội bộ).

### Mẹo
- **Quan trọng:** nếu chính bạn là người đã đề xuất chốt thầu đó, nút "Duyệt chốt thầu" sẽ **ẩn đi** — hệ thống bắt buộc phải là người khác duyệt (trừ khi Admin đã bật chế độ đặc biệt "break-glass" cho tình huống khẩn cấp).
- Nút Duyệt/Từ chối ở mục này chỉ hiện với tài khoản có quyền **Quản lý (manager)** hoặc **Admin**. (Xem thêm lưu ý ở cuối tài liệu nếu tài khoản của bạn là "Giám đốc/director".)

## 5. Xem năng suất và xếp hạng nhân viên

### Mục đích
Xem bảng xếp hạng nhân viên theo tháng — doanh thu, số đơn, khách hàng mới, báo giá thắng, deal đóng, ngày hoạt động — và bấm vào từng người để xem chi tiết + xu hướng 6 tháng gần nhất.

### Các bước
1. Vào menu **Nhân sự > Năng suất nhân viên** (`/hr/performance`).
2. Dùng nút mũi tên trái/phải để chọn tháng cần xem.
3. Bấm vào các nút tiêu chí phía trên (Doanh thu / Số đơn / KH mới / Báo giá thắng / Deal đóng / Ngày hoạt động) để sắp xếp bảng xếp hạng theo tiêu chí đó.
4. Bấm vào tên 1 nhân viên trong bảng để xem thẻ chi tiết bên phải: doanh thu, số đơn, khách mới, mã mới, báo giá đã gửi/thắng, deal đóng, báo cáo ngày đã nộp, ngày công, ngày nghỉ, số lần đi muộn — và biểu đồ cột doanh thu 6 tháng gần nhất.

### Mẹo
- Nếu tháng đang chọn là tháng hiện tại, số liệu sẽ có ghi chú **"(tháng đang chạy — số tạm thời)"** vì tháng chưa kết thúc.
- **Quan trọng:** với tài khoản Quản lý (manager), bảng xếp hạng **chỉ hiện nhân viên cùng phòng ban với bạn** — hệ thống tự động giới hạn, bạn không xem được phòng ban khác. Chỉ Admin mới xem được toàn công ty và có thêm ô lọc theo phòng ban + nút "Tính lại" KPI.

## 6. Giao việc và xem khối lượng công việc nhân viên

### Mục đích
Tạo công việc cụ thể giao cho từng nhân viên, theo dõi tiến độ, và xem ai đang bị quá tải để cân đối lại.

### Các bước — Tạo và theo dõi công việc
1. Truy cập bằng cách gõ trực tiếp **`/tasks`** vào cuối đường link ERP (trang này hiện chưa có trong menu bên trái).
2. Bấm **"Tạo công việc"** ở góc phải trên, điền: Tiêu đề (bắt buộc), Mô tả, Loại công việc (Xử lý RFQ / Liên hệ NCC / Duyệt báo giá / Theo dõi giao hàng / Theo dõi thanh toán / Chung), Độ ưu tiên (Khẩn/Cao/Bình thường/Thấp), **Giao cho** (chọn nhân viên, bắt buộc) và Hạn hoàn thành.
3. Dùng bộ lọc phía trên bảng để lọc theo trạng thái, độ ưu tiên, hoặc nhân viên được giao (bộ lọc theo nhân viên chỉ Quản lý/Admin mới thấy).
4. Theo dõi trạng thái từng việc: **Chờ xử lý → Đang làm → Hoàn thành** (nhân viên tự bấm "Bắt đầu"/"Hoàn thành", bạn chỉ cần theo dõi).

### Các bước — Xem khối lượng công việc (Workload)
1. Gõ **`/tasks/workload`** để vào trang phân bố công việc.
2. Xem 3 số tổng: **Chờ xử lý**, **Đang làm**, **Xong (30 ngày)**.
3. Xem biểu đồ thanh ngang cho từng nhân viên (chờ xử lý / đang làm / đã xong) và bảng chi tiết bên dưới — số ở cột "Tổng đang xử lý" sẽ tô **đỏ** nếu nhân viên đang ôm hơn 10 việc cùng lúc (quá tải), tô **vàng** nếu hơn 5 việc.
4. Nếu muốn hệ thống tự chia việc thay bạn, bấm **"Tự động phân công"** — hệ thống sẽ tự gán các việc còn trống cho người phù hợp và báo kết quả ngay bên dưới.
5. Bấm "Xem" cạnh tên nhân viên để mở nhanh danh sách công việc của riêng người đó.

### Mẹo
- Trang `/tasks/workload` có sẵn nút liên kết ngược về `/tasks` ("Danh sách công việc") nên bạn không cần nhớ cả 2 địa chỉ, chỉ cần vào 1 trong 2 rồi bấm qua lại.
- Trang này hiện cũng **chưa có trong menu bên trái**, chỉ vào được bằng cách gõ địa chỉ trực tiếp như trên.

## 7. Duyệt đơn nghỉ phép nhân viên (ngắn gọn)

### Mục đích
Xem xét và duyệt/từ chối đơn xin nghỉ phép của nhân viên, đồng thời xác nhận các báo cáo đi muộn/về sớm.

### Các bước
1. Vào menu **Nhân sự > Nghỉ phép & Chuyên cần** (`/hr`).
2. Chọn tab **"Đợi xử lý"** (tab này chỉ Quản lý/Admin mới thấy).
3. Ở mục **"Đơn xin nghỉ chờ duyệt"**: xem tên nhân viên, phòng ban, loại nghỉ, khoảng ngày, số ngày, lý do — bấm **"Duyệt"** để đồng ý ngay, hoặc **"Từ chối"** (có thể ghi lý do, không bắt buộc).
4. Ở mục **"Ghi nhận chuyên cần chưa xem"**: xem các báo cáo đi muộn/về sớm của nhân viên, bấm **"Đã xem"** để xác nhận đã ghi nhận.

### Mẹo
- Đây là quy trình duyệt **1 cấp duy nhất** — Quản lý trực tiếp duyệt, không cần chuyển lên cấp cao hơn.

## Cần Thang xác nhận

Trong lúc đọc code để viết hướng dẫn này, tôi phát hiện vài điểm cần Thang xác nhận trước khi coi là "đúng thiết kế" hay là lỗi cần sửa:

1. **`/approvals` và `/workflows` đều KHÔNG có trong menu bên trái** (đã kiểm tra `frontend/src/lib/constants.ts`, không có href nào trỏ tới 2 đường dẫn này). Cả 2 trang đều tên "Phê duyệt" và làm cùng một việc (Duyệt PO/thanh toán/thay đổi giá/NCC mới). Tôi đã hướng dẫn dùng `/approvals` vì nó hoạt động đúng; `/workflows` có lỗi: code so sánh trạng thái với chuỗi `'pending'`/`'in_review'` nhưng dữ liệu thật trong hệ thống dùng `'pending_l1'`/`'pending_l2'`, nên nút Duyệt/Từ chối không hiện được cho các yêu cầu đang chờ thật sự (cả ở trang danh sách lẫn trang chi tiết `/workflows/[id]`). Xin xác nhận: (a) có muốn thêm `/approvals` vào menu (ví dụ vào mục Tài chính) không, và (b) có muốn sửa hoặc gỡ bỏ trang `/workflows` bị lỗi không.
2. **`/tasks` (Quản lý công việc) và `/tasks/workload` (Phân công công việc) cũng KHÔNG có trong menu** bên trái cho vai trò Quản lý/Giám đốc — chỉ vào được bằng cách gõ địa chỉ trực tiếp. Xin xác nhận có muốn thêm 2 mục này vào menu không (ví dụ vào nhóm "Nhân sự" hoặc một nhóm "Công việc" riêng).
3. **Vai trò "Giám đốc" (director) hiện KHÔNG có quyền bấm nút "Duyệt chốt thầu"** ở trang Đấu thầu NCC, cũng như không duyệt được phiên đấu thầu nội bộ trước khi công bố — cả ở giao diện lẫn ở phía máy chủ (chỉ cho phép "admin", "manager", "procurement", thiếu "director"). Nếu tài khoản Thang dùng để duyệt có vai trò là "director" (không phải "manager" hay "admin"), bạn sẽ KHÔNG thấy các nút này dù đăng nhập đúng. Xin xác nhận vai trò thực tế Thang đang dùng, và có cần bổ sung quyền "director" vào các chỗ này không.
4. **Trang Năng suất nhân viên**: với vai trò "manager", bảng xếp hạng bị giới hạn CHỈ hiện nhân viên cùng phòng ban (do máy chủ tự ép buộc). Xin xác nhận đây đúng là hành vi mong muốn (mỗi Quản lý chỉ xem phòng mình) hay cần cho Quản lý xem toàn công ty.
5. **Duyệt thanh toán** ở `/finance/payment-approvals` chỉ có **1 cấp duyệt** (không phải 2 cấp L1/L2 như tên trường dữ liệu ở mục 3 gợi ý) — Quản lý/Kế toán/Admin duyệt là xong. Xin xác nhận đây đúng là quy trình mong muốn.

---

File đã tạo tại: `C:\Users\ASUS\OneDrive\Documents\hệ thống song châu\songchau-erp\docs\guides\MANAGER.md`
