# Hướng dẫn — Bộ phận MUA HÀNG (Procurement)

## Bạn là ai — bạn làm được gì
Bạn phụ trách **mua hàng & đấu thầu nhà cung cấp (NCC)**: tạo phiên đấu thầu, mời NCC báo giá, so sánh — xếp hạng, chốt thầu (award), lập đơn mua (PO), theo dõi giao hàng. Nguồn nhu cầu đến từ 2 nơi: **Nguồn cung (Sourcing)** và **Samsung BQMS** (các mã cần mua).

Menu chính: **Đấu thầu NCC** (`/vendor-bidding`), **Mua hàng / PO**, **Giao hàng**, **IMV**, **BQMS**.

---

## 1. Tạo phiên đấu thầu + mời NCC
**Mục đích:** gom nhu cầu (từ Sourcing hoặc BQMS) thành 1 phiên, mời nhiều NCC cùng báo giá để so sánh.

**Các bước:**
1. Từ trang **Nguồn cung** hoặc **BQMS**: tick các mã cần mua → nút **"Đẩy lên đấu thầu"** (modal `PushToBiddingModal`). Chọn nguồn (sourcing/bqms/imv), tạo phiên (batch).
2. Vào **Đấu thầu NCC** → phiên vừa tạo → **Mở vòng** (open round): đặt hạn báo giá.
3. **Mời NCC**: chọn NCC từ danh sách → hệ thống ghi nhận quyền truy cập (invitation). *Lưu ý (dự án hiện tại):* email mời/nhắc đang TẮT — bạn **tự gửi link đăng nhập** cho NCC (họ vào cổng NCC riêng để báo giá).

**Mẹo:** một phiên có thể **nhiều vòng** (V1→V2→V3) — mở lại vòng mới nếu cần NCC báo lại; hệ thống giữ lịch sử giá từng vòng.

---

## 2. Nhận & so sánh báo giá NCC
**Mục đích:** xem NCC báo giá, so sánh giá/điều kiện để chọn.

**Các bước:**
1. NCC nhập báo giá ở cổng riêng (lưới kiểu Sec-BQMS: giá từng dòng, FOC, đính kèm ảnh/link).
2. Trong phiên đấu thầu, xem **ma trận so sánh** giá các NCC theo từng dòng. Giá thấp nhất được tô nổi bật.
3. Xem đính kèm NCC (📎 → drawer xem trước ảnh / tải zip).

**Mẹo:** cẩn thận với dòng **FOC/giá 0** — hệ thống có cảnh báo để không chọn nhầm; kiểm kỹ trước khi chốt.

---

## 3. Xếp hạng NCC
**Mục đích:** đánh giá NCC theo nhiều tiêu chí (phản hồi, tỷ lệ thắng, đúng hạn, chất lượng, thời gian giao, giá) để quyết định dài hạn.

**Các bước:** vào **Xếp hạng NCC** (`/analytics/vendor-scorecard`): bảng điểm 0–100, hạng A/B/C, **Δ hạng** (tăng/giảm so kỳ trước). Bấm 1 NCC xem chi tiết từng tiêu chí.

---

## 4. Chốt thầu (Award) — có thể cần DUYỆT 2 người
**Mục đích:** chọn NCC thắng cho từng mã/dòng.

**Các bước:**
1. Trong phiên → chọn NCC thắng cho mỗi dòng → **Chốt thầu**.
2. **Nếu bật maker-checker** (duyệt 2 người — do quản trị bật khi award ≥ ngưỡng, mặc định 50 triệu): người **đề xuất** chốt (propose) → phải người **thứ hai** (manager/admin, khác người đề xuất) **duyệt** mới có hiệu lực. Người tự đề xuất KHÔNG tự duyệt được (nút bị ẩn / báo 403). Mọi thao tác ghi audit.

**Mẹo:** kiểm tra ngưỡng + trạng thái "Chờ duyệt chốt thầu" trên phiên. *Lưu ý vai trò:* quyền duyệt hiện dành cho **admin/manager/procurement** — nếu tài khoản bạn không thuộc nhóm này, sẽ không thấy nút duyệt.

---

## 5. Lập đơn mua (PO) + theo dõi giao hàng
**Mục đích:** sau khi chốt NCC, tạo PO và theo dõi hàng về.

**Các bước:**
1. Từ kết quả chốt thầu → tạo **PO** cho NCC thắng (số lượng, giá, điều khoản).
2. PO có thể qua **duyệt workflow** (Mua hàng → quản lý duyệt L1, giá lớn escalate L2 — xem hướng dẫn Quản lý).
3. Theo dõi **Giao hàng** (`/bqms/deliveries` hoặc mục Giao hàng): trạng thái từng đợt giao, xác nhận nhận hàng.
4. *Khi quản trị bật auto-AP:* mỗi đợt giao "đã nhận" tự sinh **công nợ phải trả (AP)** cho NCC — kế toán đối soát.

---

## 6. IMV — nguồn hàng bổ sung
**Mục đích:** IMV là một hệ nguồn hàng (giống BQMS) — đồng bộ RFQ/đơn/giao hàng/hợp đồng từ hệ ngoài.

**Các bước:** vào **IMV** xem RFQ đồng bộ về; có thể **đẩy IMV lên đấu thầu** (tick RFQ → PushToBidding). Nếu có **hợp đồng/từ chối** mới, hệ thống cảnh báo admin để xử tay.

---

## 7. BQMS → đấu thầu
**Mục đích:** các mã Samsung cần mua ngoài → đẩy sang đấu thầu NCC.

**Các bước:** ở trang **BQMS**, lọc mã đang-mở → tick → **Đẩy lên đấu thầu** (giống Sourcing). Nguồn được đánh dấu `source=bqms`.

> **Lưu ý Samsung:** hệ thống sec-bqms có thể đang **tạm dừng** (đổi mật khẩu). Khi đó việc scrape/đẩy báo giá lên Samsung bị hoãn — hỏi quản trị trước khi thao tác liên quan Samsung.

---

## Cần Thang xác nhận
1. Quy trình gửi link mời NCC (email tắt → gửi tay): xác nhận đúng cách vận hành hiện tại.
2. Vai trò tài khoản bạn (procurement/manager/admin) — để đảm bảo thấy nút duyệt chốt thầu.
3. Ngưỡng maker-checker + khi nào bật chính thức (hiện cờ đang tắt).
4. `/vendor-bidding` gộp 5 tab (Phiên/Hợp đồng/PO/Giao hàng/Tài khoản NCC) — quyền truy cập từng tab theo vai trò.
