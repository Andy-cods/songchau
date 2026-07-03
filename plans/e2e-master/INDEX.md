# BỘ TEST CASE E2E TOÀN HỆ — INDEX

> Sinh 2026-07-03 qua workflow 5 pha: 7 Sonnet kiểm kê (490 feature) → **Fable brainstorm** (edge case + 8 luồng kết hợp) → **Opus plan lần 2** (bắt 12 mảng sót → HE-THONG.md) → 8 Sonnet viết → Opus rà độ phủ (NEEDS_FIX) → vá trọn (4 ca bù gap + 9 ca khử mơ hồ + format + file thứ 9).
> Chuẩn phủ: **mỗi feature kiểm kê ≥1 ca** — chứng minh bằng bảng "Map feature→ca" cuối mỗi file.

## 1. Tổng quan

| File | Số ca | Đơn lẻ | Kết hợp | Luồng | P1 | Auto (API/API+UI) |
|---|---|---|---|---|---|---|
| [BQMS.md](BQMS.md) | **188** | 89 | 1 | 15 | 69+ | 132 |
| [GIAO-HANG.md](GIAO-HANG.md) | **157** | 71 | 5 | 7 | 63 | 98 |
| [KHACH-HANG.md](KHACH-HANG.md) | **121** | 61 | 8 | 2 | 43+ | 56 |
| [NGUON-CUNG.md](NGUON-CUNG.md) | **132** | 72 | 6 | 16 | 56 | ~90 |
| [TAI-CHINH.md](TAI-CHINH.md) | **141** | 71 | 4 | 13 | 61+ | 140 |
| [DAU-THAU.md](DAU-THAU.md) *(chỉ DELTA sau 30/06)* | **47** | 30 | 3 | — | 26 | 25 |
| [FILE-FOLDER.md](FILE-FOLDER.md) | **177** | 88 | 7 | — | 63 | 118 |
| [FLOWS.md](FLOWS.md) *(luồng xuyên mảng)* | **17 luồng** (118 trạm) | — | 17 | 17 | 11 | 14 |
| [HE-THONG.md](HE-THONG.md) *(12 nhóm xuyên suốt)* | **85** | 31 | 8 | — | 28 | 78 |
| **TỔNG MỚI** | **1.065 ca** | | | | **~420 P1** | **~750 tự động hoá được** |

**+ Tham chiếu bộ sẵn có (KHÔNG viết lại):**
- `<workspace>/plans/bidding-e2e-test-plan/` — **118 ca** lõi đấu thầu (106 TC-IND + 12 TC-CMB). *Chú ý: ở GỐC workspace, NGOÀI songchau-erp/.*
- `<workspace>/plans/commercial-bidding/E2E_TEST_CASES.md` — **276 ca** mô hình thương mại.
- `songchau-erp/plans/price-intelligence/E2E_TEST_PLAN.md` — **122 ca** trung tâm giá (lưu ý: claim bảo mật price_analytics trong file này đã LỖI THỜI — code hiện có allow_viewer=False đủ 8/8; sẽ sửa khi chạy W1-12).

**→ Toàn hệ: ~1.581 ca.**

## 2. Quy ước chung
- Mã ca: `TC-<AREA>-###`; BUG-GATE: `BG-<AREA>-##` (ca xác nhận bug đã biết — chạy để chứng minh bug tồn tại/đã đóng, không tính coverage tính năng).
- Cột "Tự động hoá": `API` | `UI` | `API+UI` | `Tay`.
- `[HARNESS-ONLY ⚠️]`: chỉ chạy trên môi trường test/harness (đụng số dư phép, FX, audit-log) — KHÔNG chạy tay trên prod.
- `[MANUAL ⚠️ KHÔNG HOÀN TÁC]`: duy nhất **1 ca toàn bộ** chạm Samsung thật (TC-GIAOHANG-105) — chỉ Thang chạy giám sát ngoài giờ SEC. Mọi ca push khác dừng ở enqueue/dry-run.
- Dữ liệu mồi: tài khoản `test_<role>@songchau.test` (9 role), phiên demo DEMO-MIX-01 (3 NCC), bản ghi tiền tố `DEMO-*`, teardown theo glob.

## 3. Thứ tự chạy khuyến nghị
1. **HE-THONG** nhóm 1 (auth/token) — nền của mọi ma trận quyền; hỏng thì dừng.
2. **BQMS** → **NGUON-CUNG** → **KHACH-HANG** (3 mảng nguồn dữ liệu).
3. **TAI-CHINH** → **DAU-THAU** (delta + 118 + 276) — mảng đụng tiền, chạy sau khi dữ liệu mồi từ (2) sẵn.
4. **GIAO-HANG** → **FILE-FOLDER**.
5. **HE-THONG** phần còn lại (notification, FX, HR, workflows, dashboard đối soát...).
6. **FLOWS** cuối cùng — cần dữ liệu chín từ tất cả mảng.

## 4. Map sang roadmap (tự động hoá thành pytest ở Đợt 1)
| Item roadmap | Nguồn ca |
|---|---|
| W1-02 RBAC matrix | Cột "Vai trò" toàn bộ 9 file + HE-THONG nhóm 1 + **14 endpoint admin bqms** |
| W1-03 cô lập vendor | DAU-THAU + FILE-FOLDER (file NCC) + 118 ca phần sealed-bid |
| W1-04 bidding ≥40 ca | DAU-THAU.md 25 auto-API + chọn từ 118 ca |
| W1-05 finance ≥25 ca | TAI-CHINH.md (140 auto-API) |
| W1-06 CRM ≥20 ca | KHACH-HANG.md (56 auto-API) |
| W1-07 HR | HE-THONG nhóm 4 (leave race FOR UPDATE, KPI parity) |
| W1-08 IMV | HE-THONG nhóm 5 |
| W1-09 BQMS e2e mở rộng | BQMS.md (generate-round, won, dossier-prefill, push dry-run) |
| W1-10 secondary | FILE-FOLDER.md + HE-THONG nhóm 6/7/12 |
| W1-12 analytics | price-intelligence 122 ca + sửa claim lỗi thời |

## 5. ⚠️ BUG THẬT PHÁT HIỆN TRONG LÚC THIẾT KẾ TEST (chưa nằm trong roadmap trước đó)
| # | Bug | Bằng chứng | Mức | Xử lý |
|---|---|---|---|---|
| 1 | **Viewer đọc được giá vốn/giá chào nội bộ qua Ctrl+K** — price_lookup.py thiếu `allow_viewer=False` (rbac.py:46-53 yêu cầu chặn) → tài khoản xem-only đọc purchase_price_rmb/vnd + quoted v1..v4 + đơn giá PO thắng | TC-HETHONG-075 / BG-19 | **CAO — bảo mật** | **W0-21 (mới, Đợt 0)** |
| 2 | Workflows engine + Purchase Orders hỏng toàn diện: workflow_engine.py SQL sai tên cột vs schema → create/submit **500**; tạo PO qua UI **422** (items vs line_items) | HE-THONG nhóm 6+7, 8 BG | Cao (nhưng module nghi mồ côi) | Gộp quyết định vào **W2-12** (sửa hay cắt) |
| 3 | Dashboard AP/AR **hardcode = 0**; finance-management/dashboard **500 ngay khi có 1 row deal_margins** (cast chain_code::BIGINT sai) | TC-HETHONG-066..068 | Trung | Gộp vào **W1-50** (hợp nhất finance) |
| 4 | Shipments FE/BE lệch: nút "Tạo lô hàng" → trang không tồn tại; FE gọi POST /status không có route; status 'departed' không bao giờ được set | GIAO-HANG BG (3 ca) | Trung | Gộp vào **W3-08** (module phụ) |
| 5 | `<Toaster/>` sonner chưa từng được mount → toast có thể không hiển thị ở đâu cả | W0-17 note | Trung | Verify khi làm W0-17 |
| 6 | F5 giữa QuoteBatchModal / dossier wizard = mất toàn bộ dữ liệu nhập (không có draft-save) | TC-FLOW-015, TC-GIAOHANG-127 | Trung (UX) | Ghi nhận — Thang quyết có làm draft-save không |
| 7 | FX không có staleness-check giữa preview và send báo giá | TC-FLOW-011 | Thấp (đã có frozen snapshot bảo vệ hướng chính) | Ghi nhận |
| 8 | Trigger audit-immutable không chặn TRUNCATE; 2 bảng snapshot chỉ "immutable trên comment" | TC-HETHONG-069..071 | Thấp | Gộp vào W3-07 |
| 9 | Role chết `sales`/`director` xuất hiện trong code nhưng không có trong enum DB | HE-THONG cảnh báo | Thấp | Gộp vào W1-02 |
