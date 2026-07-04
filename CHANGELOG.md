# CHANGELOG — Song Chau ERP

Định dạng theo [Keep a Changelog](https://keepachangelog.com/). Phiên bản theo [SemVer](https://semver.org/).

---

## [1.0.0] — 2026-07-04

Bản phát hành ổn định đầu tiên. Kết quả chương trình **master-completion** (Đợt 0→4):
hệ ERP hoàn thiện ~90%, có lưới test CI-safe, hardening vận hành, tài liệu đầy đủ.
Kiểm thử backend: **381 test PASS**; frontend **build STRICT** (0 lỗi TypeScript).

### Added (tính năng / công cụ mới)
- **Lớp test CI-safe** (381 ca): harness cô lập tuyệt đối khỏi prod DB (Postgres tạm + network riêng), cắm cổng gate vào `deploy.sh` (chặn deploy nếu test đỏ).
- **audit_log immutable** (trigger chặn UPDATE/DELETE) + phủ audit payment; endpoint đối soát công nợ `/finance/reconcile`.
- **Nhân sự**: trừ ngày lễ VN khỏi KPI công-nhật; RBAC task — nhân viên chỉ thấy việc của mình.
- **Tài chính gated** (mặc định TẮT, chờ bật có kiểm soát): auto-AR/AP + maker-checker duyệt-2-người cho award; hook lỗi tạo công nợ nay báo admin (không nuốt).
- **Vận hành**: `scripts/restore_backup.sh` (khôi phục backup đầy đủ 182 bảng), cron backup 02:00 + drill CN 03:00 + alert 5 check; magic-link cổng NCC hardening (expiry fail-closed, one-time atomic).
- **Tài liệu**: RUNBOOK, ARCHITECTURE/API/DB/RBAC, 6 hướng dẫn theo vai trò, `.env.example` + kiểm kê secrets, INSTALL.

### Changed
- FX auto-fetch nay KHÔNG đè tỷ giá nhập tay (manual ưu tiên).
- Notifications dùng `metadata` jsonb (không cột `link`) + bổ sung enum type (workflow_update/timeout, deadline_*, task_assigned, imv_*).
- Frontend gỡ `ignoreBuildErrors` → build enforce TypeScript strict.
- Cache header ảnh BQMS: `private, max-age` + ETag (JSON vẫn no-store).

### Fixed (bug thật lôi ra từ test layer)
- **Workflow approve/reject 500** khi người duyệt ≠ người tạo (cột `link` không tồn tại + enum thiếu + asyncpg `$::text`).
- Reconcile module WORKFLOW/INVENTORY/HR về đúng schema prod (nhiều endpoint từng 500 vì "code viết trước schema").
- `cash_flow_statement` 500 (đọc `r["category"]` + sai convention thu/chi + category tưởng tượng).
- Leave approve/cancel 500 (8 mismatch); render báo giá ≥5 dòng tràn trang (ngắt-trang rác template Excel).
- Restore backup: từng chỉ khôi phục 170/182 bảng (lỗi `unaccent`/search_path) → nay **182/182** (m43 + wrapper).

### Performance (chiều 8 — đo trước/sau, chi tiết `plans/master-completion/PERF_BASELINE.md`)
| Hạng mục | Trước | Sau |
|---|---|---|
| Query inbox thông báo (gọi 9k-18k lần) — index composite (recipient_id, created_at DESC) | 38.7ms, 4.575 buffers | **0.15ms, 8 buffers (~250×)** |
| Trang /bqms tải lại ảnh — cache header + ETag | no-store (tải lại toàn bộ) | cache 86400s, request ảnh giảm mạnh |
| Analytics first-load JS — code-split recharts qua next/dynamic | eager-bundle | chart lazy-load |
| Xuất Excel 50k dòng — asyncio.to_thread | chặn event loop | không chặn |

### Dead code removed (chiều 9)
- Backend router mồ côi: `sales_orders.py` (13.8KB), `customs.py` (10.7KB), `public_bid.py` (26.7KB) — 0 caller, đã xoá.
- Frontend: 9 trang mồ côi (bqms/folder, bqms/classify, chains, documents gốc, orders/unified, reports/scheduled, finance/cash-book, finance/payables) → redirect-stub; gỡ route `/forecast` (giữ file — analytics_exports import).
- Chi tiết + commit hash: `plans/master-completion/DOT2_CLOSEOUT.md`, commit `067be3b`/`0d3afee`.

### Bảo mật (cần Thang xử)
- Mật khẩu root VPS từng bị hardcode trong 2 script cũ đã lên GitHub history → **khuyến nghị đổi mật khẩu root VPS** (đã gitignore các script ad-hoc).
- `phase3_auto_ar_enabled=true` trên prod (hiện no-op) — Thang xác nhận có chủ đích.

---

*Tài liệu chương trình: `plans/master-completion/ROADMAP.md` + `DOT{1,2,3}_CLOSEOUT.md`.*
