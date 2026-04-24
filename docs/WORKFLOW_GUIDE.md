# SONG CHÂU ERP — LUỒNG LÀM VIỆC ĐỀ XUẤT
## Hướng dẫn sử dụng theo vai trò

---

## TỔNG QUAN HỆ THỐNG

```
http://103.56.158.129
18 tài khoản | 6 vai trò | 23 trang | 38,656 dữ liệu thật
```

---

## TÀI KHOẢN ĐĂNG NHẬP

| Email | Vai trò | Phòng ban | Mật khẩu |
|---|---|---|---|
| thang@songchau.vn | Admin | Ban GĐ | SongChau@2026 |
| manager@songchau.vn | Manager | Kinh doanh | SC2026Manager! |
| giamdoc@songchau.vn | Manager | Ban GĐ | SC2026GiamDoc! |
| ngan@songchau.vn | Procurement | Mua hàng | SC2026Ngan! |
| quynh@songchau.vn | Procurement | Mua hàng | SC2026Quynh! |
| thuy@songchau.vn | Procurement | Mua hàng | SC2026Thuy! |
| hang@songchau.vn | Procurement | Mua hàng | SC2026Hang! |
| linh@songchau.vn | Procurement | Mua hàng | SC2026Linh! |
| kho@songchau.vn | Warehouse | Kho | SC2026Kho! |
| kho2@songchau.vn | Warehouse | Kho | SC2026Kho2! |
| ketoan@songchau.vn | Accountant | Kế toán | SC2026KeToan! |
| ketoan2@songchau.vn | Accountant | Kế toán | SC2026KeToan2! |
| staff1-6@songchau.vn | Staff | VP/KD | SC2026Staff1-6! |

---

## LUỒNG LÀM VIỆC THEO VAI TRÒ

### 1. ADMIN (Thắng)
```
Trang chính: Dashboard → Tổng quan toàn bộ hệ thống
├── Xem KPI: Doanh thu, RFQ, Giao hàng, Samsung PO
├── Quản lý người dùng: /users → Tạo/sửa/xóa tài khoản
├── Audit log: /audit → Xem lịch sử thao tác
├── Settings: /settings → Cấu hình hệ thống
├── Reports: /reports → Báo cáo tổng hợp
└── ETL: /etl/sync-status → Trạng thái đồng bộ OneDrive
```

### 2. MANAGER (Trưởng phòng)
```
Trang chính: Dashboard → KPI phòng ban
├── Phê duyệt: /approvals → Duyệt/từ chối yêu cầu (1 click)
│   ├── PO dưới 50M₫ → Manager duyệt
│   └── PO trên 50M₫ → Chuyển Admin duyệt
├── Đơn mua hàng: /purchase-orders → Xem tình trạng PO
├── NCC: /suppliers → Quản lý nhà cung cấp
├── BQMS: /bqms → Xem analytics Samsung
└── Reports: /reports → Báo cáo doanh thu, hiệu suất NCC
```

### 3. PROCUREMENT (Mua hàng — Ngân, Quỳnh, Thúy, Hằng, Linh)
```
Luồng hàng ngày:
1. /bqms → Kiểm tra RFQ mới từ Samsung
2. /bqms/quotation → Upload PDF RFQ → Hệ thống parse tự động
   → Xem & sửa → Gửi duyệt Manager
3. /purchase-orders/new → Tạo PO mới cho NCC
   → Chọn NCC → Thêm sản phẩm → Gửi duyệt
4. /bqms/deliveries → Theo dõi giao hàng Samsung
5. /deliveries → Theo dõi vận chuyển
6. /suppliers → Quản lý NCC (thêm/sửa thông tin)

Luồng BQMS Samsung (killer feature):
┌─────────────────────────────────────────────┐
│ 1. Samsung đăng RFQ → Hệ thống detect      │
│ 2. NV upload PDF RFQ → Parse tự động (2 phút)│
│ 3. Xem & chỉnh sửa giá báo                 │
│ 4. Gửi duyệt Manager                        │
│ 5. Manager duyệt → Auto upload Samsung      │
│ 6. Theo dõi kết quả trúng/trượt             │
└─────────────────────────────────────────────┘
```

### 4. WAREHOUSE (Kho — Kho, Kho2)
```
Trang chính: Dashboard → Hàng đang về, tồn kho thấp
├── /inventory → Xem tồn kho realtime
├── /inventory/[id] → Chi tiết sản phẩm + lịch sử xuất/nhập
├── /deliveries → Theo dõi hàng đang vận chuyển
└── /purchase-orders → Xem PO đang giao → Xác nhận nhận hàng
```

### 5. ACCOUNTANT (Kế toán — Kế Toán, Kế Toán 2)
```
Trang chính: Dashboard → Doanh thu, công nợ
├── /reports → Báo cáo doanh thu tháng
├── /purchase-orders → Xem lịch sử PO (chỉ đọc)
└── /bqms → Xem thống kê BQMS (chỉ đọc)
Lưu ý: Kế toán CHỈ XEM, không tạo/sửa/xóa
```

### 6. STAFF (Nhân viên — Staff 1-6)
```
Trang chính: Dashboard → Tổng quan cơ bản
├── /purchase-orders → Tạo yêu cầu mua hàng
├── /workflows → Xem trạng thái yêu cầu của mình
└── /notifications → Nhận thông báo
```

---

## LUỒNG NGHIỆP VỤ CHÍNH

### Luồng 1: MUA HÀNG TỪ NCC (BPF-02)
```
Staff/Procurement tạo yêu cầu → Manager duyệt
→ Procurement tạo PO → Gửi NCC
→ NCC xác nhận → Đang vận chuyển
→ Warehouse nhận hàng → Cập nhật kho
→ Kế toán xem báo cáo
```

### Luồng 2: BQMS SAMSUNG (BPF-01 — Killer Feature)
```
Samsung RFQ → NV upload PDF
→ Hệ thống parse tự động (pdfplumber + AI)
→ Điền template Excel (xlsxtpl)
→ NV review 30 giây → Gửi duyệt
→ Manager 1 click duyệt
→ Upload Samsung BQMS API
→ Theo dõi kết quả trúng/trượt
```

### Luồng 3: PHÊ DUYỆT ĐA CẤP (BPF-03)
```
Bất kỳ → Tạo yêu cầu (draft)
→ Submit → Chờ duyệt L1 (Manager)
→ Nếu < 50M₫: Manager duyệt → Done
→ Nếu ≥ 50M₫: Manager duyệt → Chuyển L2 (Admin)
→ Admin duyệt → Done
→ Từ chối: Phải ghi lý do → Thông báo người tạo
→ Timeout 3 ngày: Tự động nhắc nhở
```

---

## DỮ LIỆU HIỆN TẠI TRONG HỆ THỐNG

| Dữ liệu | Số lượng | Nguồn |
|---|---|---|
| Người dùng | 18 | Seed script |
| BQMS RFQ inquiries | 2,469 | OneDrive Excel |
| BQMS deliveries | 2,561 | OneDrive Excel |
| BQMS Samsung PO | 318 | OneDrive Excel |
| IMV inquiries | 13,594 | OneDrive Excel |
| IMV consolidated | 11,023 | OneDrive Excel |
| Import/Export tracking | 5,673 | OneDrive Excel |
| Exchange rates | 1,486 | OneDrive Excel |
| Revenue invoices | 47 | OneDrive Excel |
| **Tổng** | **38,656** | |

---

## BƯỚC TIẾP THEO CHO THẮNG

### Ngay bây giờ:
1. ✅ Login vào http://103.56.158.129 với tài khoản admin
2. ✅ Kiểm tra Dashboard — xem KPI thật
3. ✅ Vào /bqms — xem 2,469 RFQ records
4. ✅ Vào /users — xem 18 tài khoản nhân viên
5. ✅ Test login với tài khoản khác (ngan@songchau.vn / SC2026Ngan!)

### Tuần tới:
1. Trỏ domain erp.songchau.vn → 103.56.158.129
2. Chạy ssl_setup.sh để cài HTTPS
3. Cấu hình Azure App Registration cho OneDrive auto-sync
4. Training nhân viên (per role)

### Tháng tới:
1. Staff bắt đầu tạo PO mới trong ERP
2. Procurement test BQMS quotation wizard
3. Song song OneDrive + ERP (2 tháng)
4. Chuyển hoàn toàn sang ERP

---

*Tài liệu: 30/03/2026 | Song Châu ERP v1.0*
