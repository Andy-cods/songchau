# Hướng dẫn sử dụng hệ thống — Dành cho Quản trị viên

Chào bạn! Đây là hướng dẫn dùng hệ thống Song Chau ERP dành riêng cho vai trò **Quản trị viên** — vai trò có quyền cao nhất, thấy được tất cả các khu vực trong hệ thống. Hướng dẫn viết theo kiểu "cầm tay chỉ việc", không cần biết code hay kỹ thuật vẫn đọc hiểu được.

## Bạn là ai, bạn làm được gì

Với vai trò Quản trị viên, ở thanh menu bên trái bạn sẽ thấy đầy đủ mọi nhóm menu (Tổng quan, BQMS Samsung, IMV, Khách hàng & Mua hàng, Đấu thầu NCC, Tài chính, Phân tích, Nhân sự...), và có riêng một nhóm menu tên là **"Hệ thống"** chỉ mình bạn thấy được, gồm 3 mục:

- **Nhà cung cấp** (`/suppliers`)
- **Người dùng** (`/users`) — quản lý tài khoản nhân viên
- **Cài đặt** (`/settings`) — hồ sơ cá nhân + cấu hình quan trọng

Ngoài 3 mục hiện trên menu, hệ thống còn có một loạt **trang quản trị/giám sát khác** không hiện trên menu chính (để đỡ rối cho người dùng thường), nhưng bạn vẫn vào được bằng cách gõ thẳng địa chỉ trên trình duyệt. Hướng dẫn này sẽ chỉ bạn từng trang một, kể cả các trang "ẩn" đó, vì với vai trò quản trị viên bạn nên biết chúng tồn tại và dùng khi cần.

---

## 1. Quản lý người dùng và phân quyền

**Mục đích:** Tạo tài khoản mới cho nhân viên, xem danh sách ai đang dùng hệ thống, đổi vai trò hoặc khóa tài khoản khi cần.

**Các bước:**
- Vào menu **Hệ thống → Người dùng** (địa chỉ `/users`). Bạn sẽ thấy bảng danh sách với các cột: Email, Họ tên, Vai trò, Phòng ban, Trạng thái (Hoạt động/Khóa), Đăng nhập cuối. Có ô tìm kiếm theo email/họ tên.
- Bấm **"Thêm người dùng"** để tạo tài khoản mới. Điền:
  - Email* (bắt buộc, đúng định dạng email)
  - Họ tên* (bắt buộc)
  - Tên hiển thị (không bắt buộc — biệt danh ngắn gọn)
  - Vai trò* — chọn 1 trong 7: **Quản trị viên, Giám đốc, Quản lý, Kế toán, Kho vận, Kinh doanh, Khách (Xem)**
  - Phòng ban, Số điện thoại (không bắt buộc)
  - Mật khẩu* — tối thiểu 8 ký tự, phải có ít nhất 1 chữ hoa và 1 số
  - Bấm **"Tạo người dùng"** để hoàn tất.
- Bấm vào một dòng trong danh sách để xem chi tiết tài khoản đó. Bấm **"Chỉnh sửa"** để sửa: **Họ tên, Vai trò, Trạng thái** (bật/tắt công tắc Hoạt động ⇄ Khóa). Bấm **"Lưu thay đổi"** để áp dụng.

**Mẹo:**
- Trạng thái "Khóa" dùng để tạm ngừng cho một tài khoản đăng nhập được (ví dụ nhân viên nghỉ việc) mà không cần xóa hẳn dữ liệu của họ.
- Trang chỉnh sửa **không cho sửa Email, Số điện thoại, Phòng ban** — những trường này chỉ hiển thị để xem, không có ô để đổi. Muốn đổi các trường đó, hiện tại chưa có cách nào qua giao diện web (xem mục "Cần Thang xác nhận" bên dưới).
- Mỗi người tự đổi mật khẩu của chính mình ở trang **Cài đặt** (mục 2 bên dưới) — trang Người dùng **không có** nút để admin đặt mật khẩu mới thay cho người khác (xem mục "Cần Thang xác nhận").

---

## 2. Hồ sơ cá nhân và đổi mật khẩu

**Mục đích:** Cập nhật thông tin cá nhân của chính bạn và tự đổi mật khẩu đăng nhập.

**Các bước:**
- Vào menu **Hệ thống → Cài đặt** (`/settings`).
- Mục **"Thông tin cá nhân"**: sửa Họ và tên, Tên hiển thị, Số điện thoại, Phòng ban rồi bấm **"Lưu thay đổi"**. Email hiển thị nhưng không sửa được.
- Mục **"Đổi mật khẩu"**: nhập Mật khẩu hiện tại, Mật khẩu mới (tối thiểu 8 ký tự), Xác nhận mật khẩu mới, rồi bấm **"Đổi mật khẩu"**.

**Mẹo:** Đây cũng là trang chứa 2 khu vực quan trọng chỉ Quản trị viên nhìn thấy — mục 3 và mục 4 dưới đây đều nằm ngay trong trang Cài đặt này, cuộn xuống là thấy.

---

## 3. Cấu hình đồng bộ Samsung BQMS (đổi mật khẩu, bật/tắt tự động lấy dữ liệu)

**Mục đích:** Hệ thống có các "robot" (gọi là scraper) tự động đăng nhập vào cổng BQMS của Samsung để lấy dữ liệu RFQ/báo giá/PO về. Mục này cho phép bạn đổi tài khoản Samsung đang dùng và bật/tắt từng robot — **làm ngay trên web, không cần nhờ ai vào server sửa file cấu hình nữa.**

Mục này nằm ngay trong trang **Cài đặt** (`/settings`), khối có tiêu đề **"BQMS / Đồng bộ Samsung"**, chỉ Quản trị viên nhìn thấy.

**Các bước — khi Samsung bắt đổi mật khẩu:**
1. Trước tiên, đổi mật khẩu **trên chính website BQMS của Samsung** như bình thường (ngoài hệ thống Song Châu ERP).
2. Quay lại mục "BQMS / Đồng bộ Samsung", nhập **Tên đăng nhập** và **Đổi mật khẩu Samsung** (mật khẩu MỚI vừa đổi), bấm **"Lưu thông tin Samsung"**.
3. Bấm **"Test đăng nhập Samsung"** để hệ thống thử đăng nhập 1 lần bằng thông tin vừa lưu. Nếu thấy dòng chữ xanh **"Đăng nhập Samsung thành công"** là ổn.
4. Chỉ sau khi Test thành công, bạn mới bật lại được các công tắc scraper bên trên (hệ thống **tự chặn**, báo lỗi nếu bạn bật công tắc mà chưa Test thành công trong vòng 24 giờ gần nhất — đây là cơ chế an toàn để tránh gõ sai mật khẩu nhiều lần làm Samsung khóa tài khoản).

**6 công tắc scraper có thể bật/tắt riêng từng cái** (hoặc bấm "Bật tất cả" / "Tắt tất cả"):
| Tên | Việc nó làm |
|---|---|
| Đồng bộ định kỳ | Quét toàn bộ RFQ theo lịch |
| Đồng bộ thông minh | Chỉ quét mã có thay đổi |
| Rà soát lại | Quét lại các mã nghi ngờ thiếu |
| Theo dõi mã | Bám theo từng mã được đánh dấu |
| State tick | Cập nhật trạng thái máy trạng thái |
| Đồng bộ trúng thầu | Kéo dữ liệu PO/đơn trúng thầu |

Khu vực trạng thái phía dưới cho biết: mật khẩu đã đặt hay chưa, mật khẩu hiện đang lấy từ đâu ("ghi đè (DB)" = mật khẩu bạn vừa lưu trên web, hay "mặc định (ENV)" = mật khẩu gốc cấu hình sẵn trên server), và lần cập nhật gần nhất.

**Mẹo:**
- Nếu chưa cần đổi gì, cứ để nguyên — không bắt buộc phải test lại thường xuyên.
- Nếu Samsung khóa tài khoản do đăng nhập sai nhiều lần, hãy **tắt hết công tắc trước** (việc tắt luôn được phép, không bị chặn) rồi mới xử lý đổi mật khẩu.

---

## 4. Ngôn ngữ hiển thị (tính năng đang thử nghiệm)

**Mục đích:** Trang thử đổi giao diện sang tiếng Anh. Trang này **không có trên menu**, phải gõ thẳng địa chỉ `/settings/language`.

**Các bước:** Chọn thẻ 🇻🇳 Tiếng Việt hoặc 🇬🇧 English, hệ thống tải lại trang. Bên dưới có bảng xem trước một vài chữ mẫu được dịch (menu Tổng quan, Tìm kiếm, Tạo mới...).

**Mẹo:** Đây là bản thử nghiệm sớm — xem mục "Cần Thang xác nhận" vì tính năng này **chưa đổi được ngôn ngữ thật của toàn bộ ứng dụng**, chỉ đổi vài chữ trong bảng xem trước ở chính trang này.

---

## 5. Theo dõi các phần chạy dịch vụ của hệ thống (Containers)

**Mục đích:** Xem "sức khỏe" của từng phần chạy dịch vụ đứng sau hệ thống (ví dụ: phần lưu dữ liệu, phần xử lý yêu cầu web, phần xử lý việc chạy nền...) — cái nào đang chạy tốt, cái nào bị dừng, và xem log (nhật ký) của từng phần khi có sự cố.

Trang ẩn, vào bằng địa chỉ `/admin/containers`.

**Các bước:**
- Trang hiện dạng lưới các thẻ, mỗi thẻ là 1 phần dịch vụ (cơ sở dữ liệu, bộ nhớ đệm, máy chủ xử lý, giao diện web, tạo PDF, cổng vào, xử lý tác vụ nền, lên lịch tác vụ...), có chấm màu xanh = đang chạy tốt, vàng = đang khởi động lại, đỏ = dừng.
- Bấm vào 1 thẻ để xem 50 dòng nhật ký (log) gần nhất của phần đó — hữu ích khi báo lỗi cho bên kỹ thuật.

**Mẹo:** Danh sách tự làm mới mỗi 15 giây, không cần bấm F5.

---

## 6. Giám sát hiệu suất hệ thống

**Mục đích:** Xem tổng quan tài nguyên hệ thống đang dùng (dung lượng cơ sở dữ liệu, số bảng, tổng số dòng dữ liệu, bộ nhớ đệm, thời gian chạy liên tục) và chủ động chạy kiểm tra sức khỏe.

Trang ẩn, vào bằng địa chỉ `/admin/performance`.

**Các bước:**
- Xem 5 thẻ số liệu ở đầu trang: Kích thước DB, Số bảng, Tổng hàng, Redis bộ nhớ, Uptime.
- Bấm **"Kiểm tra sức khỏe"** để chạy kiểm tra ngay lập tức — kết quả hiện thành các ô "Khỏe mạnh" (xanh) hoặc báo vấn đề (đỏ) cho từng mục kiểm tra.
- Cuộn xuống xem bảng **"Thống kê bảng dữ liệu"** (tên bảng, số hàng, dung lượng) và khu vực **"Trạng thái containers"** (giống mục 5).

**Mẹo:** Dùng trang này khi thấy hệ thống chạy chậm, để xác định nhanh có phần nào đang quá tải không.

---

## 7. Trung tâm lỗi hệ thống

**Mục đích:** Xem danh sách các lỗi kỹ thuật hệ thống tự ghi lại, đánh dấu đã xử lý.

Trang ẩn, vào bằng địa chỉ `/admin/errors`.

**Các bước:**
- 4 thẻ tổng hợp đầu trang: Tổng lỗi (30 ngày), Chưa xử lý, 7 ngày gần nhất, Nghiêm trọng.
- Lọc theo Loại lỗi (API Error, DB Error, Auth Error, Validation Error, Sync Error), Mức độ (Nghiêm trọng/Lỗi/Cảnh báo), Trạng thái (Chưa xử lý/Đã xử lý).
- Bấm vào 1 dòng lỗi để mở rộng xem chi tiết: thông báo đầy đủ, "Stack Trace" (đoạn kỹ thuật để bên dev tra lỗi), endpoint (đường dẫn bị lỗi).
- Bấm nút **"Đã xử lý"** ở cuối dòng khi lỗi đã được khắc phục xong.

**Mẹo:** Nếu thấy nhiều lỗi "Nghiêm trọng" dồn dập trong thời gian ngắn, nên báo ngay cho bên kỹ thuật.

---

## 8. Hàng đợi thử lại

**Mục đích:** Một số việc hệ thống làm ngầm (ví dụ gửi thông báo, đẩy dữ liệu) có thể thất bại tạm thời và được xếp vào hàng đợi để thử lại tự động. Trang này cho bạn xem và can thiệp thủ công nếu cần.

Trang ẩn, vào bằng địa chỉ `/admin/retry-queue`.

**Các bước:**
- 4 thẻ tổng hợp: Đang chờ, Đang thử lại, Hoàn thành, Thất bại.
- Lọc theo tab trạng thái (Tất cả/Đang chờ/Đang thử lại/Hoàn thành/Thất bại).
- Với từng tác vụ: bấm **"Thử lại"** để chạy lại ngay, hoặc **"Hủy"** để bỏ hẳn không thử nữa.
- Bấm **"Dọn dẹp"** ở góc trên để xóa bớt các tác vụ cũ đã xong.

**Mẹo:** Cột "Lần thử" hiện dạng số/số tối đa (ví dụ 3/5) — nếu đã chạm số tối đa mà vẫn thất bại, nên xem "Lỗi cuối" trước khi bấm Thử lại lại.

---

## 9. Nhật ký bảo mật

**Mục đích:** Theo dõi ai đăng nhập, đăng nhập thất bại, bị từ chối quyền truy cập, hoặc có hoạt động đáng ngờ.

Trang ẩn, vào bằng địa chỉ `/admin/security-log`.

**Các bước:**
- 3 thẻ tổng hợp: Đăng nhập hôm nay, Đăng nhập thất bại, Hoạt động đáng ngờ.
- Lọc theo Loại sự kiện (Đăng nhập, Đăng xuất, Đăng nhập thất bại, Từ chối quyền, Đáng ngờ) và Mức độ (Nghiêm trọng, Cao, Trung bình, Thấp, Thông tin).
- Bảng liệt kê: thời gian, loại sự kiện, người dùng, địa chỉ IP, mức độ, chi tiết. Các dòng "Đáng ngờ"/"Đăng nhập thất bại" được tô nền đỏ nhạt để dễ nhận ra.

**Mẹo:** Nếu thấy nhiều "Đăng nhập thất bại" liên tiếp từ cùng 1 người/IP lạ, nên kiểm tra và cân nhắc khóa tài khoản đó (mục 1).

---

## 10. Hoạt động người dùng

**Mục đích:** Xem ai đang dùng hệ thống nhiều, xem trang nào, làm hành động gì (xem/tạo/sửa/xóa/xuất dữ liệu/đăng nhập).

Trang ẩn, vào bằng địa chỉ `/admin/user-activity`.

**Các bước:**
- 3 thẻ tổng hợp: Users hoạt động hôm nay, Trang xem nhiều nhất, Tổng hành động.
- Biểu đồ cột "Hành động theo loại" và danh sách "Trang phổ biến nhất".
- Lọc theo 1 người dùng cụ thể bằng ô chọn ở dưới, xem bảng nhật ký chi tiết (thời gian, người dùng, hành động, trang, đối tượng).

**Mẹo:** Dùng trang này để biết nhân viên nào thực sự đang dùng hệ thống, hoặc kiểm tra ai đã thao tác gì trên một trang cụ thể.

---

## 11. Chất lượng dữ liệu

**Mục đích:** Chạy các kiểm tra tự động để phát hiện dữ liệu bị thiếu, sai định dạng, hoặc bất thường trong các bảng dữ liệu.

Trang ẩn, vào bằng địa chỉ `/admin/data-quality`.

**Các bước:**
- Bấm **"Chạy kiểm tra"** để hệ thống quét lại toàn bộ.
- Xem 4 thẻ: Tổng kiểm tra, Đạt, Cảnh báo, Không đạt + thanh tỷ lệ đạt.
- Bảng chi tiết: Bảng dữ liệu, Tên kiểm tra, Trạng thái (Đạt/Cảnh báo/Không đạt), số Hàng bị ảnh hưởng, Chi tiết.

**Mẹo:** Mục "Chất lượng dữ liệu" này cũng xuất hiện y hệt ở cuối trang **Đồng bộ dữ liệu** (mục 12) — hai nơi cùng lấy chung 1 nguồn dữ liệu, không phải 2 bộ kiểm tra khác nhau, nên không cần chạy cả hai chỗ.

---

## 12. Đồng bộ dữ liệu (BQMS Samsung + OneDrive Song Châu)

**Mục đích:** Đây là "trung tâm" quản lý việc lấy dữ liệu từ BQMS Samsung và từ các file OneDrive của Song Châu vào hệ thống — xem file nào đã nhập, nhập tay 1 file cụ thể, hoặc bấm chạy đồng bộ ngay lập tức.

Trang ẩn, vào bằng địa chỉ `/admin/migration`.

**Các bước:**
- **Khu vực "File OneDrive (Staging)"**: cây thư mục các file đang nằm chờ trong OneDrive. Có tab lọc theo trạng thái (Tất cả/Đã import/Cần cập nhật/Chưa import) và ô tìm kiếm tên file. Bấm vào 1 file để xem chi tiết (tên, định dạng, kích thước, ngày sửa, bảng đích trong CSDL, số dòng hiện có, lần nhập gần nhất), rồi có thể:
  - **"Xem trước"** — coi trước nội dung file (bảng Excel/CSV, PDF, ảnh, hoặc Word) trước khi quyết định nhập.
  - **"Import file này"** — nhập chính thức file đó vào hệ thống; có thanh tiến trình, xong sẽ báo số dòng mới/cập nhật/bỏ qua.
  - **"Bỏ qua"** — đánh dấu không cần nhập file này.
- **Khu vực trạng thái đồng bộ**: 2 thẻ cho biết BQMS Samsung và OneDrive Song Châu lần cuối chạy khi nào, bao nhiêu dòng. Bấm **"Đồng bộ BQMS"** / **"Đồng bộ OneDrive"** để chạy thủ công ngay (không cần đợi lịch tự động).
- **Khu vực "Lịch sử đồng bộ"**: bảng ghi lại mọi lần chạy đồng bộ trước đó — bấm vào 1 dòng để xem chi tiết (bắt đầu/hoàn thành lúc nào, bao nhiêu dòng, lỗi gì nếu có).
- **Khu vực "Thống kê Import theo bảng"**: số dòng dữ liệu hiện có trong từng bảng CSDL.
- **Khu vực "Chất lượng dữ liệu"**: giống hệt mục 11 ở trên.

**Mẹo:** Đây là chỗ để kiểm tra "dữ liệu đã vào hệ thống đầy đủ chưa" mỗi khi có file mới từ Samsung hoặc từ nội bộ Song Châu.

---

## 13. Trang cũ: "Duyệt Vendor Portal" (ít dùng)

**Mục đích:** Đây là trang duyệt thủ công dữ liệu quét được từ BQMS trước khi đưa vào hệ thống chính — dùng cho các module hợp đồng, đơn hàng (PO), đấu thầu, thông báo, kết quả chọn thầu.

Trang này **đã bị ẩn khỏi menu chính từ giữa năm 2026** vì luồng báo giá giờ làm trực tiếp ngay ở trang **BQMS** (nút "Báo giá" trong bảng), không cần bước duyệt riêng nữa cho phần báo giá. Trang vẫn còn tồn tại và vào được qua địa chỉ `/admin/vendor-staging` cho các trường hợp còn lại (hợp đồng, PO, thông báo...).

**Các bước:** Chọn loại dữ liệu cần duyệt (hợp đồng/PO/đấu thầu/thông báo/kết quả), lọc theo tab trạng thái (Chờ duyệt/Đã duyệt/Bị từ chối/Skip/Đã merge), xem trước từng dòng rồi Duyệt/Từ chối/Skip.

**Mẹo:** Vì ít dùng và không có trên menu, chỉ nên vào trang này khi biết chắc mình cần duyệt dữ liệu hợp đồng/PO/đấu thầu thủ công — còn báo giá thường ngày thì làm ở trang BQMS như bình thường.

---

## 14. Nhật ký hệ thống (Audit — toàn bộ lịch sử thao tác)

**Mục đích:** Đây là sổ nhật ký "không thể sửa, không thể xóa" ghi lại MỌI thao tác tạo/sửa/xóa/duyệt/từ chối/đăng nhập/đăng xuất trên toàn hệ thống — dùng để tra cứu ai đã làm gì, khi nào, với dữ liệu nào.

Trang ẩn, vào bằng địa chỉ `/audit`.

**Các bước:**
- Lọc theo Hành động: Tất cả, Tạo mới, Cập nhật, Xóa, Phê duyệt, Từ chối, Đăng nhập, Đăng xuất.
- Tìm kiếm theo tên/email người dùng, tên bảng dữ liệu, hoặc mã bản ghi.
- Bảng hiện: Thời gian, Người dùng, Hành động, Bảng (tên dễ hiểu như "Đơn mua hàng", "Nhà cung cấp"...), ID bản ghi, Chi tiết.

**Mẹo:** Khác với "Hoạt động người dùng" (mục 10, ghi lại việc XEM trang), trang này ghi lại việc THAY ĐỔI dữ liệu thật (tạo/sửa/xóa/duyệt) — dùng khi cần truy vết ai đã sửa một đơn hàng, một nhà cung cấp... cụ thể.

---

## Cần Thang xác nhận

- **Trang "Ngôn ngữ" (`/settings/language`) chưa đổi được ngôn ngữ thật của toàn hệ thống.** Đây chỉ là bản thử nghiệm sớm: bấm chọn tiếng Anh chỉ đổi vài chữ mẫu trong 1 bảng xem trước ngay tại trang đó, còn menu và toàn bộ các trang khác vẫn hiển thị tiếng Việt như cũ. Cần xác nhận: có nên hoàn thiện tiếp tính năng này, hay tạm thời không cần nhắc tới với người dùng vì dễ gây hiểu lầm là đổi được ngôn ngữ cả hệ thống.
- **Chưa có nút "Đặt lại mật khẩu" cho người dùng khác.** Phần xử lý phía sau (backend) đã có sẵn khả năng admin đặt mật khẩu mới thay cho 1 nhân viên khác, nhưng hiện **không có nút bấm nào** trên trang Người dùng để dùng tính năng đó. Nếu một nhân viên quên mật khẩu, quản trị viên hiện chưa có cách xử lý qua giao diện web. Cần xác nhận: có cần thêm nút này vào trang chi tiết người dùng không, hay tạm thời xử lý bằng cách khác.
- **Khối "Thông tin hệ thống" trong trang Cài đặt** (Phiên bản, Số bảng DB, Thời gian hoạt động, Môi trường) — một vài số liệu ở đây hiện là giá trị cố định mang tính tham khảo, chưa nối đầy đủ với số liệu thực tế theo ghi chú để lại trong code. Nếu cần các số liệu này chính xác tuyệt đối, nên nhờ đội kỹ thuật hoàn thiện thêm.
- **Về việc đổi mật khẩu Samsung BQMS**: xác nhận lại với Thang rằng tính năng này **đã có đầy đủ giao diện trên web** (mục 3 ở trên) — đổi tên đăng nhập/mật khẩu, bật/tắt scraper, test đăng nhập — không cần vào server sửa file cấu hình `.env` như quy trình cũ nữa. Nếu tài liệu/ghi nhớ trước đây nói "phải sửa file trên server" thì thông tin đó đã lỗi thời, cần cập nhật lại quy trình làm việc thực tế cho đúng.
- **Trang "Duyệt Vendor Portal" (`/admin/vendor-staging`, mục 13)** hiện ít dùng và không có trên menu. Xác nhận có cần giữ lại (cho hợp đồng/PO/đấu thầu) hay có thể gỡ bỏ hẳn để đỡ rối.
