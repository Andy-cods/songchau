# GOAL — Hoàn thành & đóng gói Song Chau ERP (hợp đồng tự chạy)

> Thiết lập 2026-07-03. Mục tiêu: đưa hệ đạt đủ **9 chiều Định nghĩa Hoàn thành** theo [ROADMAP.md](ROADMAP.md) (5 đợt, ~68 việc), có [bộ E2E 1.581 ca](../e2e-master/INDEX.md) làm lưới kiểm. Chốt bằng gate ổn định 14 ngày → Thang ký.

## 1. Mục tiêu (Definition of Done)
Đạt đủ 9 chiều: (1) chức năng trọn vòng (2) test tự động xanh (3) bảo mật/RBAC/cô lập NCC/audit/maker-checker (4) vận hành: deploy-1-lệnh + backup-restore-đã-test + giám sát + vendor live + M365 (5) dữ liệu: FX auto + twin kiểm soát + migration idempotent (6) tài liệu bàn giao (7) đóng gói v1.0.0 chạy máy trắng (8) **0 dead code** (9) **perf budget đạt**. Ổn định ≥14 ngày, 0 sự cố P1.

## 2. Tôi TỰ LÀM (không hỏi từng bước)
- Implement code (Haiku/Sonnet/Opus theo model_suggested), mỗi thay đổi qua **adversarial review** (agent phản biện) trước khi deploy.
- **Deploy CODE** theo kỷ luật cứng: gate `bqms_push=0|0` → cp 3 container + clear pycache + import-gate → restart → **verify sạch** → rollback nếu hỏng.
- Gỡ **dead code** khi có bằng chứng 0-caller (4 nguồn) + commit riêng revert-được.
- Chạy/viết **test tự động**, perf baseline, viết **tài liệu**.
- **Báo cáo ngắn sau mỗi batch** (làm gì · verify gì · còn gì · rủi ro).

## 3. Tôi DỪNG, chờ Thang (human-gate cứng)
1. **Thay đổi hành vi nghiệp vụ đụng tiền/NCC** — LUÔN cần duyệt tay: bật maker-checker AWARD (W3-00), bật auto-AR/AP (W3-06), Samsung dossier Part 2 thật (W3-01), release v1.0.0 + go-live.
2. **9 quyết định** đã liệt (mục 4 ROADMAP): router/trang mồ côi, 14 admin endpoint, public_bid, toast… — hỏi khi tới đợt tương ứng.
3. **4 việc Thang cấp**: M365, domain vendor, file Excel mẫu, threshold maker-checker.
4. **DB write** — theo chính sách Thang chọn (mục 5 dưới).

## 4. Safety gate cứng (không bao giờ vi phạm)
- `bqms_push` phải `0|0` trước mọi restart backend.
- Migration-first + verify residue-free + có đường rollback.
- KHÔNG tự động đụng Samsung thật; KHÔNG xoá/ghi đè dữ liệu sản xuất; giá nội bộ KHÔNG rò sang NCC.
- Mỗi cơ chế bảo vệ phải được test bằng cách "làm hỏng thật" ít nhất 1 lần.

## 5. Chính sách DB-write & độ sâu tự chạy (Thang chốt 2026-07-03)
- **DB write = TỰ ĐỘNG với migration AN TOÀN** (ADD COLUMN, CREATE INDEX CONCURRENTLY, nới CHECK, CREATE TABLE/VIEW — additive/idempotent), luôn migration-first + verify residue-free + rollback path. **DỪNG hỏi** với migration PHÁ HỦY (DROP COLUMN/TABLE, XÓA/SỬA dữ liệu, siết constraint).
- **Độ sâu = tự chạy hết Đợt 0 + Đợt 1**, báo cáo ngắn sau mỗi batch, **DỪNG tổng kết cuối Đợt 1** chờ Thang duyệt trước khi vào Đợt 2-3.

## 6. Trạng thái hiện tại
- ✅ Đợt 0 Batch 1: 4 fix code-only LIVE (W0-21 bảo mật viewer, W0-01 cookie, W0-04 negative-cost, W0-15 FX).
- ⏸️ W0-03 (crm 422 + migration) chờ chính sách DB-write.
- ⬜ Đợt 0 còn Batch 2–3 (13 việc); Đợt 1–4 phía sau.
