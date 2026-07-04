# Đợt 4 — RELEASE v1.0.0 + Báo cáo Gate 9 chiều

**Ngày:** 2026-07-04 · **Version:** 1.0.0 (`/api/health` trả version) · Backend **381 test PASS**, FE **build STRICT**.

Báo cáo tự đánh giá theo **9 chiều Definition-of-Done**. Gate ổn định 14 ngày là mốc THỜI GIAN (cần 14 ngày prod chạy + Thang ký) — phần đánh giá dưới là hiện trạng ngày phát hành.

---

## Đánh giá 9 chiều

| # | Chiều | Trạng thái | Ghi chú |
|---|---|---|---|
| 1 | **Chức năng** | 🟢 ~90% | Module trọn vòng; 6 module flip→live (W3-08), 10 giữ in_progress có lý do rõ; route chết → 404/redirect-stub; báo giá N≥5 verify visual OK. |
| 2 | **Kiểm thử** | 🟢 | 381 test tự động XANH; bug Cao/Trung đã biết đều fixed (notification cluster, WF/INV/HR reconcile, finance, leave, restore). CÒN: W1-09 BQMS e2e HOÃN (Samsung pause). |
| 3 | **Bảo mật** | 🟡 | RBAC kín + vendor cô lập + audit_log immutable + magic-link hardening ✓. maker-checker AWARD **built, cờ TẮT** (chờ Thang bật). CẦN Thang: đổi mật khẩu root VPS (lộ history), xác nhận cờ auto_ar. |
| 4 | **Vận hành** | 🟡 | deploy 1-lệnh có gate ✓; backup+restore **ĐÃ TEST 182/182** ✓; giám sát/alert ✓. CHỜ Thang: vendor server live (domain), M365. |
| 5 | **Dữ liệu** | 🟢 | exchange_rates auto-fetch (manual ưu tiên) ✓; migration idempotent (chạy 2 lần OK) ✓. twin/orphan dedup BQMS → W2-08 HOÃN (Samsung). |
| 6 | **Tài liệu** | 🟢 | RUNBOOK, ARCHITECTURE/API/DB/RBAC, 6 hướng dẫn vai trò, .env.example + secrets inventory, INSTALL, CHANGELOG. |
| 7 | **Đóng gói** | 🟡 | version /health ✓, .env.example ✓, INSTALL máy-trắng ✓, CHANGELOG (có Performance+Dead-code) ✓, git tag v1.0.0. Ổn định ≥2 tuần → **GATE 14 NGÀY (đang chờ lịch)**. |
| 8 | **Sạch code** | 🟡 | Đã gỡ dead-code (sales_orders/customs/public_bid + 9 trang FE, commit riêng). `dead_code_sweep.py` hiện **10 finding** — cần allowlist+ADR trước gate (xem dưới). |
| 9 | **Hiệu suất** | 🟢 | PERF_BASELINE có số trước/sau (notif index 250×); Prometheus /metrics + pg_stat_statements làm nguồn; mọi tối ưu kèm số. |

---

## Chiều 8 — Xử lý 10 finding dead_code_sweep (trước khi ký gate)

| File | Phân loại | Xử lý đề xuất |
|---|---|---|
| `components/cockpit/index.tsx` | FALSE-POSITIVE (import kiểu thư mục `@/components/cockpit`, dùng thật RankDelta) | Sửa heuristic sweep (bắt directory-index) HOẶC allowlist |
| `file-browser/viewers/index.ts` | FALSE-POSITIVE (barrel index) | như trên |
| `components/ui/dropdown-menu.tsx` | Cần verify (UI primitive) | grep dùng; nếu 0 → xoá |
| `api/v1/batch_operations.py` | GIỮ có chủ đích (unmounted W0-09, giữ file) | allowlist + ADR |
| `api/v1/demand_forecast.py` | GIỮ (unmounted, forecast bỏ) | allowlist + ADR |
| `api/v1/pwa_settings.py` | GIỮ (unmounted W0-09) | allowlist + ADR |
| `core/procrastinate_schema.py` | Cần verify (bootstrap dùng?) | đối chiếu W0-14; nếu dùng→allowlist, không→xoá |
| `file-browser/{BreadcrumbNav,FileToolbar,PreviewPanel}.tsx` | Cần verify (W2-10: trang tự implement?) | grep dùng; nếu 0 → xoá (commit riêng) |

→ **Action trước gate:** cập nhật `dead_code_allowlist.yaml` (entry + ADR cho nhóm giữ-chủ-đích) + xoá nhóm verified-dead (commit riêng) + vá heuristic directory-index → sweep = 0.

---

## Gate ổn định 14 ngày — TIÊU CHÍ (chờ lịch + Thang ký)
- **0 sự cố P1** trong 14 ngày liên tiếp (theo alerts.log + báo cáo thủ công).
- **≤2 sự cố P2**, đều đã fix + có test chống tái diễn.
- Ngày cuối gate: `dead_code_sweep = 0 finding`; Perf Budget đo lại = ĐẠT (chiều 9); drill restore vẫn PASS.
- Giám sát: cron alert 5-check chạy /5' (đã cài); backup+drill tự động.
- **Thang ký nghiệm thu** dựa báo cáo 9 chiều này.

> Gate CHƯA bắt đầu đếm — khởi động khi Thang chốt "bắt đầu theo dõi 14 ngày".

---

## Việc CÒN cho Thang (tách khỏi critical path)
Đổi mật khẩu root VPS · xác nhận cờ `phase3_auto_ar_enabled=true` · bật maker-checker AWARD (threshold) · M365 (OneDrive/email/logo) · domain vendor server · mở lại Samsung → W1-09 BQMS e2e + W2-08 dedup.
