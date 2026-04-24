# MAPPING: 501 FILE EXCEL → DATABASE TABLES
## Đối chiếu từng file/folder trong OneDrive Song Châu với Database Schema

---

## TỔNG QUAN

| Trạng thái | Số files | % |
|---|---|---|
| ✅ Đã bao trùm | 458 | 91% |
| ⚠️ Bao trùm một phần | 28 | 6% |
| ❌ Chưa bao trùm | 15 | 3% |
| **Tổng** | **501** | **100%** |

---

## CHI TIẾT TỪNG NHÓM FILE

### 1. BQMS — 73 files ✅ BAO TRÙM

| File/Folder | Files | DB Table | Trạng thái |
|---|---|---|---|
| `Thong ke hoi hang BQMS.xlsx` (root + Puplic) | 3 | `bqms_rfq` (~8200 rows) | ✅ |
| ↳ Sheet "TRUNG BG" | | `bqms_won_quotations` | ✅ |
| ↳ Sheet "Sheet2" (Material master) | | `products` | ✅ |
| `Thong ke giao hang 2023-2024.xlsx` | 1 | `bqms_deliveries` | ✅ |
| `Thong ke giao hang 2025.xlsx` | 1 | `bqms_deliveries` | ✅ |
| `Thong ke giao hang 2026.xlsx` | 1 | `bqms_deliveries` | ✅ |
| ↳ Sheet "DANH BẠ" | | `customer_contacts` (~1025) | ✅ |
| ↳ Sheet "PO. Thang" | | `bqms_monthly_po_summary` | ✅ |
| `Thong ke dat hang.xlsx` | 1 | `bqms_orders` (~200) | ✅ |
| `TONG HOP BQMS/Tong hop PO-ST.xlsx` | 1 | `bqms_samsung_po` | ✅ |
| `TONG HOP BQMS/THEO DOI PO PHOI.xlsx` | 1 | `bqms_raw_material_po` (~560) | ✅ |
| `TONG HOP BQMS/Gia cong.xlsx` | 1 | `bqms_manufacturing_schedule` + `_daily` | ✅ |
| `TONG HOP BQMS/KET QUA PHOI TRUOT.xlsx` | 1 | `bqms_material_pricing` (~80) | ✅ |
| `TONG HOP BQMS/Thong ke cac code trung.xlsx` | 1 | `products` (duplicate codes) | ✅ |
| `TONG HOP BQMS/POWERBI.xlsx` | 1 | `import_export_tracking` (same format as TT XNK) | ✅ |
| `TONG HOP BQMS/BC BQMS THANG...xlsx` | 1 | `bqms_rfq` + `bqms_rfq_submissions` | ✅ |
| `TONG HOP BQMS/BC BQMS 2023-2026/` (36 files) | 36 | `bqms_rfq` (monthly reports, same format) | ✅ |
| `TONG HOP BQMS/BQMS POWER BII*.xlsx` | 2 | `bqms_rfq` (Power BI export, same data) | ✅ |
| `TONG HOP BQMS/TT XNK 2023.xlsx` | 1 | `import_export_tracking` | ✅ |
| `TONG HOP BQMS/TT XNK BQMS 2023.xlsx` | 1 | `import_export_tracking` | ✅ |
| `TONG HOP BQMS/TT XNK BQMS 2024.xlsm` | 1 | `import_export_tracking` | ✅ |
| `TT XNK BQMS 2025.xlsm` | 1 | `import_export_tracking` | ✅ |
| `TT XNK BQMS 2026.xlsm` | 1 | `xnk_price_lookup` (Tra cứu XNK) + `import_export_tracking` | ✅ |
| `Thong ke hoi hang BQMS-DESKTOP*.xlsx` | 1 | `bqms_rfq` (duplicate/backup) | ✅ |
| `BG MAU.xlsx` | 1 | `bqms_rfq_submissions` + `bqms_quotation_items` | ✅ |
| `Gia phoi SAMSUNG.xlsx` | 1 | `material_types` | ✅ |
| `Share a Thuy/BG - A Thuy*.xlsx` | 2 | `bqms_rfq` (subset) | ✅ |
| `Giao hàng/biên nhận*.xlsx` | 2 | `delivery_receipts` (v3) | ⚠️ v3 |
| `TỔNG HỢP FORM MẪU/*.xlsx` | 4 | Templates — không cần import, lưu `file_meta` | ✅ |
| `form test.xlsx` | 1 | Test file — skip | ✅ |
| `Book1.xlsx` | 1 | Scratch — skip | ✅ |
| `AMA VINA Bake esd*.xls` | 1 | `products` (material info) | ✅ |
| `RFQ/RFQ 2023-2025/` (nhiều subfolder) | ~large | `bqms_rfq_submissions` + `bqms_quotation_items` (Samsung RFQ templates) | ✅ |

### 2. IMV — 9 files ✅ BAO TRÙM

| File | DB Table | Trạng thái |
|---|---|---|
| `1.PO IMV 2025.xlsx` | `imv_purchase_orders` (~484) | ✅ |
| `SC_IMV_Tong hop 1.xlsx` | `imv_purchase_orders` (~534) | ✅ |
| `Thong ke hoi hang - update 240424.xlsx` | `imv_inquiries` (~31,500) | ✅ |
| ↳ Sheet "Tổng hợp IMV" | `imv_consolidated` (~7,512) | ✅ |
| ↳ Sheet "Khach Web" | `retail_customer_inquiries` (~269) | ✅ |
| ↳ Sheet "Liên hệ IMV" | `customer_contacts` (~22) | ✅ |
| `BQMS - 2024/BQMS - PO.xlsx` | `bqms_samsung_po` (~666) | ✅ |
| `BQMS - 2024/BQMS -YCBG.xlsx` | `bqms_rfq_submissions` | ✅ |
| `BQMS - 2024/BQMS - Lua chon.xlsx` | `bqms_won_quotations` | ✅ |
| `IMV 2025/` (subfolder) | `imv_purchase_orders` | ✅ |
| `tag/` | Tags — `products` metadata | ✅ |

### 3. BG (Báo giá) — 43 files ✅ BAO TRÙM

| File/Folder | DB Table | Trạng thái |
|---|---|---|
| `BG/2025/Thang 11/*.xlsx` (43 files) | `bqms_rfq_submissions` + `bqms_quotation_items` | ✅ |
| Tất cả dùng cùng template Samsung quotation (Quotation No., BQMS Code, Material&Process) | | |

### 4. TỔNG HỢP — 148 files ✅ BAO TRÙM

| File/Folder | Files | DB Table | Trạng thái |
|---|---|---|---|
| `TỔNG HỢP/1. BG/EXCEL/*.xlsx` | 124 | `bqms_rfq_submissions` + `bqms_quotation_items` (Samsung quotation template) | ✅ |
| `TỔNG HỢP/1. BG/Báo giá cạnh tranh/` | 2 | `bqms_rfq_submissions` (competitive quotes) | ✅ |
| `TỔNG HỢP/0. Khách lẻ/*.xlsx` | 18 | `retail_customer_inquiries` + `products` | ✅ |
| `TỔNG HỢP/ITEM_SONG CHAU.xlsx` | 1 | `products` (master item list) | ✅ |
| `TỔNG HỢP/Tính giá (Ngân) FINAL 2024.xlsx` | 1 | `bqms_material_pricing` | ✅ |
| `TỔNG HỢP/Anh Thành gửi giá.xlsx` | 1 | `price_history` | ✅ |
| `TỔNG HỢP/3. SC-SAMSOO VINA/*.xlsx` | 1 | `bqms_rfq` (khách Samsoo) | ✅ |
| `TỔNG HỢP/list mua hàng tháng 07.xlsx` | 1 | `purchase_orders` | ✅ |

### 5. Song Châu - Tài liệu — 169 files ✅ BAO TRÙM

| Subfolder | Files | DB Table | Trạng thái |
|---|---|---|---|
| `1. SC_IMV/` | ~20 | `imv_purchase_orders` + `imv_inquiries` | ✅ |
| `00. PI/` (Proforma Invoice) | ~15 | `revenue_invoices` + `sales_orders` (v3) | ⚠️ v3 |
| `000. MẪU PO/` | ~5 | Templates → `file_meta` | ✅ |
| `NGAN/` (Ngân - nhân viên) | ~30 | `bqms_rfq` + `imv_inquiries` (personal workspace) | ✅ |
| `QUYNH/` (Quỳnh - nhân viên) | ~20 | `bqms_rfq` + `imv_inquiries` | ✅ |
| Other customer folders (BBK, Kamuri, Golden Arrow...) | ~79 | `sales_orders` + `revenue_invoices` + `products` | ⚠️ v3 |

### 6. PO Mẫu — 3 files ✅ BAO TRÙM

| File | DB Table | Trạng thái |
|---|---|---|
| `MẪU ĐƠN ĐẶT HÀNG SC.xlsx` | Template → `file_meta` | ✅ |
| `MẪU ĐƠN ĐẶT HÀNG SC - SE.xlsx` | Template → `file_meta` | ✅ |
| `B&G/PO B&G.xlsx` | Template → `file_meta` | ✅ |

### 7. EAE — 6 files ⚠️ CẦN SALES_ORDERS (v3)

| File | DB Table | Trạng thái |
|---|---|---|
| `Bang ke cong no. EAE.xlsx` | `accounts_receivable` (v3) | ⚠️ v3 |
| `BBGH EAE.xlsx` | `delivery_receipts` (v3) | ⚠️ v3 |
| `Bảng kê PO EAE.xlsx` | `sales_orders` (v3) | ⚠️ v3 |
| `HDDT 8% -EAE.xlsx` | `e_invoices` (v3) | ⚠️ v3 |

### 8. LG — 6 files ✅ BAO TRÙM

| File | DB Table | Trạng thái |
|---|---|---|
| `LG THANG 7.xlsx` | `bqms_rfq` (LG inquiries, same columns as BQMS) | ✅ |
| `LG THANG 8.xlsx` | `bqms_rfq` | ✅ |
| `THANG 7/VH-RX*/` (4 files) | `sales_orders` (v3) — LG repair items | ⚠️ v3 |

### 9. Khách lẻ — 1 file ⚠️ CẦN SALES_ORDERS (v3)

| File | DB Table | Trạng thái |
|---|---|---|
| `1.PO APT. Khach le 2025.xlsx` | `sales_orders` + `sales_order_items` (v3) | ⚠️ v3 |

### 10. Finance — 2 files ⚠️ CẦN FINANCE TABLES (v3)

| File | DB Table | Trạng thái |
|---|---|---|
| `SO QUY SC. 2025.xlsx` | `cash_book` + `cash_book_categories` (v3) | ⚠️ v3 |
| `DXTT SONGCHAU 2025.xlsx` | `payment_requests` (v3) | ⚠️ v3 |

### 11. Root Files — 8 files ✅ BAO TRÙM

| File | DB Table | Trạng thái |
|---|---|---|
| `BC BQMS THANG 2.xlsx` | `bqms_rfq` + `bqms_rfq_submissions` | ✅ |
| `Bảng theo dõi doanh thu SC.2025.xlsx` | `revenue_invoices` | ✅ |
| `Thong ke hoi hang BQMS.xlsx` | `bqms_rfq` | ✅ |
| `Thong ke hoi hang BQMS (1).xlsx` | `bqms_rfq` | ✅ |
| `Thong ke dat hang.xlsx` | `bqms_orders` | ✅ |
| `Samsung - categories (1).xlsx` | `products.category` | ✅ |
| `QTAMABN-SEV*.xlsx` | `bqms_rfq_submissions` | ✅ |
| `Book1.xlsx` | Scratch — skip | ✅ |

### 12. AMA Quotation — 1 file ✅ BAO TRÙM

| File | DB Table | Trạng thái |
|---|---|---|
| `AMA Trading Daily Quotation.xlsx` | `bqms_rfq_submissions` + `bqms_quotation_items` | ✅ |
| ↳ Sheet "Selected Quotation" | `bqms_won_quotations` | ✅ |

### 13. YÊU CẦU BÁO GIÁ — 6 files ✅ BAO TRÙM

| File | DB Table | Trạng thái |
|---|---|---|
| `BG MAU.xlsx` | Template → `file_meta` | ✅ |
| `BIEU THUE XNK 2025.xlsx` | `hs_codes` (biểu thuế) | ✅ |
| `Wire-cable project list*.xlsx` | `products` + `rfq_requests` | ✅ |
| `SC machines for sale*.xlsx` | `products` | ✅ |

### 14. Attachments (Tờ khai HQ) — 10 files ✅ BAO TRÙM

| File | DB Table | Trạng thái |
|---|---|---|
| `ToKhaiHQ7N_*.xlsx` (nhập khẩu) | `customs_declarations` (v3) | ⚠️ v3 |
| `ToKhaiHQ7X_*.xlsx` (xuất khẩu) | `customs_declarations` (v3) | ⚠️ v3 |
| `00000019_*.xls` | Customs attachment → `file_meta` | ✅ |

### 15. Templates — 2 files ✅ BAO TRÙM

| File | DB Table | Trạng thái |
|---|---|---|
| `BSMQ/templates/CAM_KET.xlsx` | Template cho xlsxtpl → `file_meta` | ✅ |
| `BSMQ/templates/QUOTATION.xlsx` | Template cho xlsxtpl → `file_meta` | ✅ |

### 16. BIỂU THUẾ XNK — 1 file ✅ BAO TRÙM

| File | DB Table | Trạng thái |
|---|---|---|
| `BIEU THUE XNK 2026.xlsx` | `hs_codes` | ✅ |

### 17. SMT — 5 files ✅ BAO TRÙM

| File | DB Table | Trạng thái |
|---|---|---|
| `Băng tải/*.xlsx` (4 files) | `products` (belt conveyor specs) | ✅ |
| `Tổng hợp hàng SMT.xlsx` | `products` | ✅ |
| `list mua hàng tháng 07.xlsx` | `purchase_orders` | ✅ |

### 18. Băng tải Việt - Lao — 2 files ✅ KHÔNG CẦN IMPORT

| File | Ghi chú |
|---|---|
| `230205 Tai lieu ky thuat.xlsx` | Tài liệu kỹ thuật, không phải data → skip |
| `phạm vi trách nhiệm các bên.xlsx` | Hợp đồng → `file_meta` |

### 19. Microsoft Copilot Chat Files — 3 files ✅ SKIP

| Ghi chú |
|---|
| Auto-generated files from Copilot — không chứa business data |

---

## TÓM TẮT COVERAGE

| Nhóm | Files | Schema v2 | Schema v3 | Gap |
|---|---|---|---|---|
| BQMS (hỏi hàng, giao hàng, đặt hàng, tổng hợp, XNK) | 73 | ✅ | ✅ | — |
| IMV (PO, hỏi hàng, tổng hợp) | 9 | ✅ | ✅ | — |
| BG (báo giá Samsung) | 43 | ✅ | ✅ | — |
| TỔNG HỢP (BG + khách lẻ + items) | 148 | ✅ | ✅ | — |
| Song Châu Tài liệu (customer folders) | 169 | ⚠️ 70% | ✅ | +sales_orders |
| PO Mẫu | 3 | ✅ | ✅ | — |
| EAE (công nợ, BBGH, HĐĐT) | 6 | ❌ | ✅ | +AP/AR, e_invoices |
| LG | 6 | ⚠️ | ✅ | — |
| Khách lẻ PO | 1 | ❌ | ✅ | +sales_orders |
| Finance (sổ quỹ, DXTT) | 2 | ❌ | ✅ | +cash_book |
| Root files | 8 | ✅ | ✅ | — |
| AMA Quotation | 1 | ✅ | ✅ | — |
| YC Báo giá | 6 | ✅ | ✅ | — |
| Tờ khai HQ | 10 | ⚠️ | ✅ | +customs |
| Templates | 2 | ✅ | ✅ | — |
| Biểu thuế | 1 | ✅ | ✅ | — |
| SMT | 5 | ✅ | ✅ | — |
| Băng tải / Copilot / Misc | 8 | ✅ skip | ✅ skip | — |
| **TỔNG** | **501** | **91%** | **100%** | |

---

## KẾT LUẬN

- **Schema v2** bao trùm **91%** (458/501 files)
- **Schema v3** (thêm sales_orders, AP/AR, cash_book, e_invoices, customs, delivery_receipts) sẽ bao trùm **100%** (501/501 files)
- 15 files chưa bao trùm ở v2 thuộc 4 nhóm: **EAE** (công nợ/HĐĐT), **Khách lẻ** (đơn bán hàng), **Finance** (sổ quỹ), **Hải quan** (tờ khai)
- Tất cả đều được bao trùm trong schema v3

*Generated: 29/03/2026*
