# Hướng dẫn sử dụng Song Châu ERP — Dành cho Mua hàng (Procurement)

Chào bạn! Đây là hướng dẫn dùng hệ thống ERP dành riêng cho vai trò **Mua hàng** — người tổ chức đấu thầu nhà cung cấp (NCC), theo dõi đơn mua hàng (PO) và giao hàng. Viết theo kiểu cầm tay chỉ việc, không cần biết kỹ thuật. Cuối bài có mục "Cần Thang xác nhận" liệt kê vài chỗ hệ thống đang thiếu/lệch quyền — không phải do bạn thao tác sai.

## Bạn là ai, bạn làm được gì

Tài khoản của bạn mang vai trò **`procurement`** (phòng "Mua hàng" — ví dụ các tài khoản `ngan@`, `quynh@`, `thuy@`, `hang@`, `linh@`). Ở phía máy chủ, bạn được cấp quyền **tạo/sửa** hầu hết dữ liệu trong khu vực **Đấu thầu NCC** (tạo phiên, mời NCC, chốt thầu) cũng như xem/ghi Nhà cung cấp, IMV, nghỉ phép của chính mình.

**⚠️ Quan trọng — menu bên trái của bạn hiện KHÔNG hiển thị các mục này.** Theo rà soát code (`frontend/src/lib/constants.ts`), thanh menu chỉ có cấu hình sẵn cho các vai trò admin/director/manager/accountant/warehouse/sales/viewer — **chưa có cấu hình riêng cho vai trò `procurement`**, nên hệ thống tạm cho bạn thấy menu rút gọn mặc định: chỉ **Tổng quan** và **Quản lý tài liệu**. Điều này **không có nghĩa là bạn không có quyền** — phía máy chủ vẫn cho phép bạn thao tác đầy đủ ở các trang dưới đây, bạn chỉ cần gõ thẳng địa chỉ vào trình duyệt (hoặc bấm **Ctrl+K** / **⌘K** để tìm nhanh) cho tới khi menu được bổ sung. Xem chi tiết ở mục "Cần Thang xác nhận" cuối bài.

Các trang chính bạn sẽ dùng hàng ngày (gõ trực tiếp vào thanh địa chỉ):

| Việc cần làm | Địa chỉ |
|---|---|
| Tổ chức đấu thầu NCC | `/vendor-bidding` |
| Import mã hàng cần mua từ IMV | `/imv` |
| Xem/thêm Nhà cung cấp | `/suppliers` |
| Đơn mua hàng (PO) — xem mục 3 (có giới hạn quyền) | `/purchase-orders` |
| Giao hàng Samsung (BQMS) — xem mục 4 (có giới hạn quyền) | `/bqms/deliveries` |
| Nghỉ phép & chuyên cần của tôi | `/hr` |

Hướng dẫn này tập trung vào việc bạn làm nhiều nhất: **tổ chức 1 phiên đấu thầu nhà cung cấp từ đầu đến khi có PO và giao hàng**.

---

## 1. Tổ chức đấu thầu nhà cung cấp (Đấu thầu NCC)

**Mục đích:** Mời nhiều NCC báo giá cạnh tranh cho cùng 1 danh sách mã hàng, so sánh giá, chọn người thắng, rồi tạo hợp đồng + đơn mua hàng.

Vào `/vendor-bidding`. Trang có 5 tab ở trên: **Phiên đấu thầu**, **Hợp đồng**, **Đơn mua (PO)**, **Giao hàng**, **Tài khoản NCC**.

### 1.1. Tạo phiên đấu thầu mới

1. Ở tab **Phiên đấu thầu**, bấm **"+ Tạo phiên"**. Điền tiêu đề, mô tả, hạn nộp báo giá (deadline), và chọn **cơ chế chọn thầu**: **"Cả phiên"** (per_batch — 1 NCC thắng trọn cả phiên) hoặc **"Từng mã"** (per_item — mỗi mã hàng có thể chọn NCC khác nhau).
2. Thêm mã hàng cần mua vào phiên bằng 1 trong các cách:
   - **Nhập tay** từng dòng (mã, mô tả, số lượng, đơn vị...).
   - **Import từ BQMS** — kéo các mã Samsung đang cần mua thẳng vào phiên (cũng có thể làm ngược lại: vào trang BQMS, lọc mã đang mở, tick chọn rồi bấm **"Đẩy lên đấu thầu"**).
   - **Import từ IMV** — kéo mã từ hệ IMV (xem thêm mục 5).
   - **Import từ Thư viện nguồn cung** (catalog/Sourcing) — lấy mã đã lưu sẵn ở Sourcing, hoặc tick chọn ngay tại `/sourcing` rồi bấm **"Gửi đấu thầu (N)"**.
   - **Dán danh sách (paste)** hoặc **Import Excel** — dán/tải lên hàng loạt.
3. Khi danh sách mã đã đủ, bấm **"Công bố"** (publish) để mở phiên cho NCC báo giá. Một số phiên có thể cần **duyệt nội bộ trước khi công bố** — nếu có, phiên nằm ở trạng thái "Chờ duyệt" cho tới khi Quản lý/Admin duyệt xong mới công bố được.

### 1.2. Mời nhà cung cấp báo giá

1. Trong phiên vừa tạo, vào tab **"NCC được mời"**.
2. Bấm **"Mời NCC"**, chọn 1 hoặc nhiều NCC đã có **tài khoản đăng nhập cổng NCC** (không còn dùng link-ẩn-danh kiểu cũ). Nếu NCC muốn mời chưa có tài khoản, dùng tab **"Tài khoản NCC"** để duyệt/tạo tài khoản trước (xem mục 6).
3. Hệ thống ghi nhận lời mời và tạo quyền truy cập cho NCC, nhưng **hiện KHÔNG tự gửi email mời/nhắc** (email mời + email nhắc đã được TẮT theo quyết định 2026-06-30) — bạn cần **tự gửi đường link đăng nhập cổng NCC** (`ncc.songchau.vn`) cho họ qua Zalo/điện thoại/email cá nhân. NCC tự đăng nhập rồi mới thấy phiên trong Dashboard của họ.
4. Theo dõi cột trạng thái mời: **Đã mời → Đã xem → Đã báo giá** (hoặc **Từ chối**).
5. Nếu cần bổ sung/đính chính thông tin cho tất cả NCC đang tham gia, dùng **"Phụ lục"** (addendum) — mọi NCC được mời sẽ thấy thông báo này ở tab Hỏi đáp của họ.
6. Nếu NCC có thắc mắc, xem và trả lời ở tab **"Hỏi đáp"** (Q&A) trong trang chi tiết phiên.

### 1.3. So sánh báo giá và chốt thầu (award)

1. Khi đã có đủ báo giá (hoặc gần hết hạn), vào tab **"So sánh & chốt"** (matrix) — bảng ma trận: mỗi hàng là 1 mã hàng, mỗi cột là 1 NCC, ô là giá NCC đó báo cho mã đó (giá thấp nhất được tô nổi bật). Cẩn thận với các ô **FOC/giá 0** — đó là NCC cam kết miễn phí thật, không phải thiếu dữ liệu.
2. Có thể xem chi tiết báo giá đầy đủ của từng NCC, kèm file đính kèm họ tải lên hoặc link tham khảo họ dán (bấm icon 📎 để mở khung xem trước/tải zip).
3. Muốn tham khảo thêm uy tín NCC trước khi chốt, xem **"Xếp hạng NCC"** (`/analytics/vendor-scorecard`): điểm 0–100, hạng A/B/C theo giao đúng hạn/chất lượng/phản hồi mời thầu, kèm Δ hạng so kỳ trước.
4. Chọn NCC thắng: nếu phiên chọn **"Cả phiên"**, chọn 1 NCC duy nhất thắng toàn bộ. Nếu **"Từng mã"**, chọn NCC thắng riêng cho từng dòng. Bắt buộc nhập **lý do chốt thầu**.
5. Nếu công ty đã bật cơ chế **"2 người xác nhận" (maker-checker)** cho các phiên giá trị lớn (mặc định ngưỡng 50 triệu VNĐ, hiện đang **TẮT**), sau khi bạn bấm chốt, đề xuất sẽ ở trạng thái **"Chờ duyệt"** cho tới khi một người **khác** bạn — Quản lý, Admin, hoặc một Mua hàng khác — duyệt lại mới chính thức ghi nhận công nợ. Bạn sẽ **không tự duyệt được** đề xuất do chính mình tạo (nút "Duyệt chốt thầu" sẽ ẩn/báo lỗi), trừ khi Admin đã bật chế độ khẩn cấp "break-glass".
6. Nếu giá NCC còn cao, có thể **"Mở vòng mới"** (open-round) thay vì chốt ngay — hệ thống mở thêm 1 vòng báo giá nữa, NCC sẽ thấy giá họ báo ở vòng trước để tự điều chỉnh giảm giá (đấu giá ngược).
7. Muốn chốt lại (re-award) một phiên đã chốt trước đó, hệ thống yêu cầu **huỷ Hợp đồng/PO hiện tại trước** để tránh sinh công nợ trùng.

**Mẹo:** Toàn bộ thao tác mời/chốt/mở vòng đều được ghi lại ở tab lịch sử (audit) của phiên — hữu ích khi cần tra lại ai đã làm gì, lúc nào.

---

## 2. Sau khi chốt thầu: Hợp đồng

**Mục đích:** Lập hợp đồng với NCC thắng thầu, gửi cho NCC ký điện tử trên cổng của họ.

1. Sau khi phiên đã "Đã chốt" (awarded), quay lại trang chi tiết phiên, tab **"Hợp đồng"**, bấm **"Tạo hợp đồng"**.
2. Hệ thống tự điền lại mã hàng + giá đã chốt vào hợp đồng. Kiểm tra lại điều kiện thanh toán/giao hàng/bảo hành rồi lưu.
3. Bấm **"Tạo PDF"** để xuất file hợp đồng, rồi **"Gửi NCC"** — NCC sẽ nhận thông báo + email, vào cổng của họ để xem và ký điện tử.
4. Khi NCC đã ký, hợp đồng chuyển trạng thái "NCC đã ký" — bạn có thể **"Kích hoạt"** (activate) để chính thức có hiệu lực.
5. Từ hợp đồng đã có hiệu lực, có thể **"Tạo PO"** để sinh đơn mua hàng (xem mục 3).

**Lưu ý:** Việc **tạo hợp đồng mới** và **tạo PO từ hợp đồng** hiện chỉ dành cho **Quản lý/Admin** (không có vai trò Mua hàng) — nếu bạn không thấy 2 nút này hoặc bị báo thiếu quyền, nhờ Quản lý/Admin bấm giúp bước đó. Xuất PDF, gửi NCC, xác nhận đã ký, kích hoạt hợp đồng thì bạn làm được bình thường.

---

## 3. Đơn mua hàng (PO)

Hệ thống hiện có **2 nơi liên quan tới PO**, cần phân biệt rõ:

### 3.1. PO sinh ra từ Hợp đồng đấu thầu (trong `/vendor-bidding`, tab "Đơn mua (PO)")

Đây là PO gắn với luồng Đấu thầu NCC ở mục 1–2. Bạn xem chi tiết từng PO, tải PDF, và **huỷ PO** nếu cần — các thao tác này bạn làm được. Khi hàng về, việc xác nhận số lượng thực nhận nằm ở mục 4 bên dưới.

### 3.2. Trang "Đơn mua hàng" độc lập (`/purchase-orders`)

Đây là một module PO khác, tách biệt, KHÔNG liên kết với luồng Đấu thầu NCC — dùng cho các đơn mua hàng đặt trực tiếp không qua đấu thầu.

**⚠️ Cần lưu ý:** theo rà soát quyền phía máy chủ, module này hiện **chỉ cho phép staff/manager/admin** truy cập — vai trò `procurement` **chưa nằm trong danh sách được phép** ở bất kỳ thao tác nào (xem danh sách, xem chi tiết, tạo mới, trình duyệt, xác nhận nhận hàng). Nếu bạn vào `/purchase-orders`, có khả năng hệ thống báo lỗi "không đủ quyền" dù khung giao diện vẫn hiển thị được. Đây không phải lỗi thao tác của bạn — đã đưa vào mục "Cần Thang xác nhận".

**Việc bạn cần làm lúc này:** nếu cần tạo/xem một đơn mua hàng không qua đấu thầu, nhờ Quản lý/Admin xử lý giúp tại `/purchase-orders`, hoặc ưu tiên dùng luồng Đấu thầu NCC (mục 1–2) — luồng đó bạn có đầy đủ quyền hơn.

---

## 4. Giao hàng

Tương tự PO, có 2 nơi xem giao hàng:

### 4.1. Giao hàng của phiên đấu thầu (`/vendor-bidding`, tab "Giao hàng")

Bạn có thể **kiểm tra chất lượng từng dòng hàng**, **xác nhận số lượng thực nhận**, xem/tải phiếu giao nhận, cập nhật trạng thái giao hàng — các thao tác này bạn làm được bình thường.

**⚠️ Cần lưu ý:** riêng việc **xem DANH SÁCH** giao hàng và **xem chi tiết 1 lô giao hàng** (trước khi thao tác) hiện theo rà soát quyền phía máy chủ **chỉ cho phép staff/manager/admin** — vai trò `procurement` chưa nằm trong danh sách được phép ở 2 endpoint xem-danh-sách/xem-chi-tiết này (dù các thao tác ghi nhận số liệu bên trong lại CÓ cho phép bạn). Có thể bạn sẽ gặp lỗi khi mở tab này trước khi thao tác được. Đã đưa vào "Cần Thang xác nhận".

**Khi công ty bật "auto-AP":** mỗi lô giao hàng được xác nhận "đã nhận" sẽ tự sinh 1 khoản **công nợ phải trả (AP)** cho NCC đó — Kế toán sẽ đối soát khoản này sau. Tính năng này hiện đang **TẮT** mặc định.

### 4.2. Giao hàng Samsung (BQMS) — `/bqms/deliveries`

Đây là danh sách giao hàng cho các đơn Samsung (khác với giao hàng NCC ở trên). **⚠️ Theo rà soát quyền, trang này hiện cũng chỉ cho phép staff/manager/admin xem danh sách** — vai trò `procurement` chưa được cấp quyền xem trang này. Nếu cần theo dõi giao hàng Samsung, nhờ Quản lý/Admin/Sales hỗ trợ xem giúp, hoặc chờ Thang mở quyền.

---

## 5. Import mã hàng từ IMV

**Mục đích:** IMV (iMarketVietnam) là một hệ nguồn khác chứa các RFQ/mã hàng cần mua — bạn có thể kéo thẳng các mã đó vào 1 phiên đấu thầu NCC thay vì gõ tay lại.

**Các bước:**
1. Vào `/imv`, chọn tab **"Yêu cầu báo giá"** (RFQ) hoặc các tab khác (Đặt hàng/Giao hàng/Thanh toán/Hợp đồng/Từ chối) để xem dữ liệu nguồn IMV.
2. Tick chọn các mã cần mua, bấm nút đẩy sang Đấu thầu NCC (mở khung **"Gửi đấu thầu"** — chọn phiên có sẵn hoặc tạo phiên mới, các mã đã chọn sẽ tự được thêm vào).

**Mẹo:** Cách làm y hệt cách đẩy mã từ Thư viện nguồn cung (Sourcing) hoặc từ BQMS sang Đấu thầu NCC — dùng chung 1 khung "Gửi đấu thầu" (`PushToBiddingModal`).

---

## 6. Nhà cung cấp (Suppliers)

**Mục đích:** Quản lý danh bạ nhà cung cấp nội bộ, và duyệt/từ chối tài khoản NCC đăng ký vào cổng.

1. Vào `/suppliers` để xem danh sách NCC, xem lịch sử giá theo NCC, thêm NCC mới.
2. Để duyệt tài khoản NCC mới đăng ký (tự đăng ký qua cổng `ncc.songchau.vn`), vào `/vendor-bidding` > tab **"Tài khoản NCC"** — xem danh sách chờ duyệt, bấm **"Duyệt"** hoặc **"Từ chối"**.

**Lưu ý:** Việc **duyệt/từ chối tài khoản NCC** và **mời NCC theo email riêng lẻ** hiện chỉ dành cho Quản lý/Admin — nếu bạn không thấy nút Duyệt/Từ chối/Mời ở đây, nhờ Quản lý/Admin xử lý.

---

## 7. Nghỉ phép & Chuyên cần của tôi

**Mục đích:** Gửi đơn xin nghỉ phép, xem số ngày phép còn lại, xem lịch sử đi muộn/về sớm của chính bạn.

1. Vào `/hr`. Bấm **"Xin nghỉ"**, chọn loại nghỉ (phép năm/không lương/ốm...), khoảng ngày, lý do, gửi đi.
2. Đơn của bạn sẽ được Quản lý trực tiếp duyệt (1 cấp duy nhất) — theo dõi trạng thái Chờ duyệt/Đã duyệt/Từ chối ngay tại trang này.

---

## Cần Thang xác nhận

1. **Menu bên trái CHƯA có cấu hình riêng cho vai trò `procurement`.** File `frontend/src/lib/constants.ts` (hàm `getSidebarConfig`) chỉ có case cho admin/director/manager/accountant/warehouse/sales/viewer — vai trò `procurement` (và cả `staff`) rơi vào nhánh mặc định, chỉ hiện 2 mục Tổng quan + Quản lý tài liệu. 5 tài khoản Mua hàng thật (`ngan@`, `quynh@`, `thuy@`, `hang@`, `linh@`) hiện KHÔNG thấy menu Đấu thầu NCC / IMV / Nhà cung cấp / PO / Giao hàng trên thanh điều hướng dù phía máy chủ đã cấp quyền đầy đủ cho phần lớn các trang đó. Cần xác nhận: có nên bổ sung ngay 1 case `procurement` vào `getSidebarConfig` (gợi ý: Tổng quan, Đấu thầu NCC, Mua hàng/PO, Giao hàng, IMV, Nhà cung cấp, Nhân sự) để nhân viên dùng menu bình thường thay vì phải gõ địa chỉ tay.
2. **`/purchase-orders` (module PO độc lập, KHÔNG qua đấu thầu) chặn hoàn toàn vai trò `procurement`** ở mọi thao tác (xem danh sách/chi tiết/tạo mới/duyệt/nhận hàng) — chỉ cho staff/manager/admin. Cần xác nhận đây có phải chủ đích (Mua hàng chỉ nên dùng luồng Đấu thầu NCC, không dùng PO rời) hay là thiếu sót cần bổ sung quyền.
3. **Xem danh sách/chi tiết "Đơn mua (PO)" và "Giao hàng" bên trong `/vendor-bidding`** (API `procurement.py`: `GET /pos`, `GET /pos/{id}`, `GET /deliveries`, `GET /deliveries/{id}`) hiện chỉ cho phép staff/manager/admin — **không có `procurement`**, trong khi các thao tác GHI trên chính 2 nhóm dữ liệu này (huỷ PO, xác nhận số lượng, kiểm tra chất lượng, tạo phiếu giao nhận, đổi trạng thái) LẠI cho phép `procurement`. Đây là lỗ hổng phân quyền rõ ràng (được phép ghi nhưng không được phép xem danh sách/chi tiết trước khi ghi) — rất có thể đang khiến nhân viên Mua hàng gặp lỗi 403 khi mở 2 tab này. Đề nghị xác nhận gấp và bổ sung `procurement` vào các endpoint GET tương ứng.
4. **`/bqms/deliveries` (Giao hàng Samsung) cũng chặn `procurement`** ở endpoint xem danh sách chính (`GET /api/v1/bqms/deliveries` chỉ cho staff/manager/admin). Cần xác nhận có nên mở quyền xem cho Mua hàng (nếu họ cần theo dõi giao hàng Samsung) hay việc này chỉ thuộc phạm vi Sales/Kho.
5. **Xem danh sách/chi tiết Hợp đồng** (`GET /procurement/contracts`, `GET /procurement/contracts/{id}`) cũng chỉ cho staff/manager/admin, không có `procurement` — trong khi các thao tác xuất PDF/gửi NCC/xác nhận ký/kích hoạt hợp đồng LẠI cho phép `procurement`. Cùng dạng lỗ hổng như mục 3 — cần xác nhận và bổ sung quyền xem.
6. **Tạo hợp đồng mới và tạo PO từ hợp đồng** hiện chỉ dành cho Quản lý/Admin (không có `procurement`) — cần xác nhận đây có phải chủ đích (để 1 người khác kiểm soát bước phát sinh công nợ) hay nên mở thêm cho Mua hàng tự làm để đỡ phải nhờ người khác từng bước.
7. **Duyệt/từ chối tài khoản NCC mới đăng ký** (`PATCH /vendors/{id}/approve|reject`) và **mời NCC theo email riêng lẻ** (`POST /vendors/invite`) cũng chỉ dành Quản lý/Admin — cần xác nhận có nên mở quyền duyệt tài khoản NCC cho Mua hàng, vì đây là việc vận hành hàng ngày của phòng Mua hàng.
8. **Cơ chế maker-checker (2 người duyệt chốt thầu) hiện đang TẮT** (cờ `procurement_award_approval_enabled = false`), nên phần "chờ duyệt 2 người" mô tả ở mục 1.3 hiện chưa xảy ra trong thực tế — mọi lượt chốt thầu của bạn có hiệu lực ngay. Cần xác nhận thời điểm bật cờ này (và ngưỡng tiền áp dụng — mặc định đang set 50 triệu VNĐ).
9. **Email mời/nhắc NCC đã tắt chủ đích** (quyết định 2026-06-30, giữ email kích hoạt tài khoản + email hợp đồng) — guide đã mô tả đúng theo quyết định này, nhưng nêu ra đây để Thang xác nhận vẫn đang là chủ trương hiện hành, chưa đổi lại.
