# Đợt 2 — CLOSEOUT (Master Completion)

**Ngày:** 2026-07-03 · **Harness cuối:** `316 passed, 0 failed` · **Không đăng nhập sec-bqms** (Samsung pause).

Đợt 2 = hardening vận hành + refactor an toàn (đã có lưới test đỡ). Làm **evidence-based** — roadmap 5 ngày trước đã lỗi thời ở vài chỗ (index đã có sẵn, FX đã auto-fetch), em kiểm prod thật trước khi làm.

---

## 1. Đã LÀM (tất cả LIVE + verify)

| ID | Việc | Kết quả |
|---|---|---|
| **W2-11** | Cache header ảnh BQMS | `no-store` toàn cục → ảnh `private,max-age=86400`+ETag+304; JSON giữ no-store; 403 vẫn 403 (test khoá không rò ảnh giữa user). Trang /bqms tải lại nhanh hơn nhiều. |
| **W2-07** | Hardening magic-link cổng NCC (bảo mật) | Sửa EXPIRY **fail-open→fail-closed** (token expires=NULL từng lọt vô hạn), ONE-TIME **TOCTOU→UPDATE atomic** (chống double-use đua), entropy OK 256-bit; 11 test. |
| **W2-12** | forecast unmount + excel to_thread | Gỡ route /forecast (giữ file — analytics_exports import); **bọc build Excel 50k dòng vào asyncio.to_thread** (đang chặn event loop — finding HIGH). |
| **W2-10/13** | Dead-code XOÁ (Thang duyệt) | Backend: xoá router sales_orders+customs+public_bid.py. FE: 9 trang mồ côi → stub-redirect (cash-book/payables→/finance/overview). Build FE xanh, harness 316. |
| **W2-03** | FX auto-fetch manual-priority | Đã auto-fetch (open.er-api daily 15:00). **Fix**: auto KHÔNG còn đè tỷ giá nhập tay (`WHERE source NOT LIKE 'manual%'`) — verify SQL rollback PASS. |
| **W2-09** | Index quick-win | **Đã tối ưu sẵn** (evidence): staging/notif/xnk/sourcing đều có index+trigram. Không cần thêm. |
| **W2-02** | **Restore hardening + cron** | Gỡ lỗi restore tồn tại lâu: backup xưa chỉ restore 170/182 (unaccent/search_path). Fix `m43` (immutable_unaccent SET search_path) + `scripts/restore_backup.sh` → **drill 182/182 PASS** + đủ data. Cài cron: backup 02:00 (retention 14), drill CN 03:00, health */5. |
| **W2-06** | Alerting 1 kênh | `scripts/alerts.sh`: 5 check (job-stuck>30', sync<36h, SSL≤14d, disk≥85%, restart-loop) → ghi `/opt/erp/data/logs/alerts.log`. Test EXIT=0. |

**Backup an toàn**: pg_dump prod HOÀN CHỈNH (kiểm 5 lần liên tiếp 173 base-table). `restore_backup.sh` có GUARD chống dump truncate.

---

## 2. CẦN THANG (quyết / cấp) — không nghẽn

1. **W2-04 M365** + **W2-05 domain vendor**: anh chọn "để sau" — khi sẵn sàng cấp là bật được (OneDrive sync + email HĐ + logo; cổng NCC https).
2. **Kênh alert**: hiện chỉ ghi `alerts.log` (chưa có kênh ngoài vì M365 tắt). Muốn đẩy email/Telegram/Zalo thì wire thêm — em làm khi anh chọn kênh.
3. **alerts.sh nguồn dữ liệu** (cook nêu): sync-freshness đang dùng `bqms_rfq.updated_at`; nếu muốn dùng `synced_at` thì đổi 1 dòng SQL. Cert path auto-dò `/etc/letsencrypt/live/*` (khớp certbot).
4. **m43**: `immutable_unaccent` giờ non-inlinable (SET search_path) — vô hại (4 bảng dùng nó chỉ 12-50 dòng).
5. **Độ bền**: các fix deploy qua docker cp — sống qua restart, MẤT nếu rebuild image. Muốn vĩnh viễn → commit git (chưa commit vì chưa được yêu cầu).

---

## 3. HOÃN đúng phạm vi
- **W2-08** (dedup twin BQMS → VIEW) — phụ thuộc W1-09 BQMS e2e (Samsung đang pause).
- **W2-04/05** — chờ creds Thang.

---

## 4. File đổi Đợt 2
`main.py`, `bqms_images.py`, `vendor/auth.py`, `api/v1/__init__.py`, `excel_export.py`, `fx_rates_sync.py` (deploy) · migration `m43_qualify_immutable_unaccent.sql` · XOÁ `sales_orders.py`/`customs.py`/`public_bid.py` + 9 trang FE stub · scripts MỚI `restore_backup.sh`/`install_crons.sh`/`alerts.sh` · tests `test_cache_headers.py`(9)/`test_vendor_magic_link.py`(11) · closeout này.
