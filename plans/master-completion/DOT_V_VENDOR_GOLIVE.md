# ĐỢT V — Vendor Go-Live & Kết nối 2 hệ (bổ sung master-completion)

> **Sinh 2026-07-05** qua recon thực địa 2 server (Thang duyệt test B) + workflow 4-agent audit (Fable) + Solution Brainstormer.
> **Nguồn:** `scratchpad/wglnndxvr.output` (23 findings + brainstorm). Bối cảnh: vendor.songchau.vn LIVE HTTPS 05/07 nhưng mới chứng minh **API login** — recon phát hiện **UI vỡ 404 + lỗ bảo mật + 3 quả mìn vận hành**.

## Mục tiêu
Biến cổng NCC `vendor.songchau.vn` thành cổng **CHÍNH THỨC 7 NCC active dùng trơn tru hàng ngày**, luồng nối ERP↔vendor mượt, gỡ hết mìn im-lặng. Nằm trọn trong master-completion (đóng nốt cổng NCC + ổn định 14 ngày), **KHÔNG mở epic mới, KHÔNG đụng Samsung, YAGNI**.

## Nguyên tắc (Brainstormer)
1. **Cắt đường chảy máu trước khi mở đường mới** — bảo mật + UX-vỡ xong TRƯỚC cutover/hoàn thiện.
2. **Thứ tự cutover bất di bất dịch** — link mới trỏ đúng domain (V-03) TRƯỚC khi gỡ /ncc (V-07).
3. **Env phải là nút vặn THẬT** — pydantic ignore field không khai báo → set env suông vô tác dụng; chỉ tính XONG khi verify bằng output chạy thật.
4. **Fail-closed + tự chữa** thay vì dựa người phát hiện — mọi outage cổng NCC là outage IM LẶNG.
5. **YAGNI theo dữ liệu thật** — 7 NCC/9 batch/~5 quote → fix ngắn hạn đo được, không xây pagination/email/replica đầy đủ.

## Bảng công việc (13 item — P0 trước)

| ID | P | Việc | DoD tóm tắt | Effort | Model | Depends | Findings |
|---|---|---|---|---|---|---|---|
| **V-01** | P0 | Vá lỗ **chiếm tài khoản NCC** qua forgot-password (bỏ trả reset_link công khai) + rà log | forgot-password trả generic không link; admin-relay endpoint admin-only; rà access-log | S | opus | — | A1-02 |
| **V-02** | P0 | Sửa **8 hardcode `/ncc`** vendor-portal → `NEXT_PUBLIC_BASE_PATH` bake build + commit + rebuild | vào domain→login, login→/dashboard, 401/logout→/login, 0 lần 404; giữ /ncc chạy | S | sonnet | — | A1-01,A3-02,A1-07 |
| **V-03** | P0 | **VENDOR_PORTAL_URL nút vặn THẬT**: +field Settings + env 2 server + recreate (không restart) | config.py có field; env 2 máy; reset_link + activation_link prefix vendor.songchau.vn | S | sonnet | — | A1-03,A2-01,A4-4,A3-01 |
| **V-04** | P1 | Gỡ mìn tunnel: **2 socat sidecar** thay IP container cứng 172.18.0.x | publish 127.0.0.1:15432/16379; đổi -L tunnel; test ác restart postgres→vendor tự hồi | S | sonnet | — | A4-2 |
| **V-05** | P1 | Gỡ mìn **sshfs stale** (T3): systemd drop-in ExecStartPost restart sc-vendor-api + commit units | replay T3: restart erp-data→≤30s container thấy đủ file không restart tay | S | sonnet | — | A4-1,A4-6 |
| **V-06** | P1 | Đóng lỗ **NCC suspended vẫn login**: fail-closed deps.py + login check + data-fix 11 tk + lọc picker | token suspended→403, login→403, picker không hiện; active không regression | S | sonnet | — | A1-04,A3-06 |
| **V-07** | P1 | **Cutover /ncc**: redirect 301 strip-prefix→domain mới + tắt portal cũ + đồng bộ git drift | curl /ncc/login→Location vendor.songchau.vn/login; nginx -t OK; RAM giảm | S | sonnet | V-02,V-03 | A4-3,A2-02 |
| **V-08** | P1 | **UI admin "Mời NCC + copy link"** (endpoint sẵn 100%, thiếu nút) | modal /vendors/invite hiện activation_link+copy; nút copy link đăng nhập cổng | M | sonnet | V-01,V-03 | A2-03,A3-03 |
| **V-09** | P2 | Fix contract lệch **inv_status/withdrawn** + chặn báo giá khi declined | GET batch trả inv_status/declined_at...; _persist_quote 409 khi declined | S | sonnet | — | A1-05 |
| **V-10** | P2 | Chống **cắt list im lặng** limit=20: FE ?limit=50 + hiện "X/total" + cap quotes/my | 4 trang truyền limit=50 + dòng tổng; quotes.py le=50 | XS | haiku | — | A1-06 |
| **V-11** | P2 | **vendor_alerts.sh** 5-check (health/tunnel/canary-mount tự-chữa/disk/cert) + cron + mirror log main | cron */5; giả lập umount→WARN+self-heal; Thang tail từ main | M | sonnet | V-05 | A4-5 |
| **V-12** | P2 | **vendor_backup.sh** tar tuần 4 stateful (SSH key/letsencrypt/.env/units) về /mnt/erp-data/backups | cron thứ 2; chạy tay→file ở main; tar -tzf đủ 4 nhóm | S | haiku | V-05 | A4-6 |
| **V-13** | P2 | **E2E smoke go-live** 6 bước NCC thật trên domain mới + 2 test ác resilience | checklist PASS 0 rác; docker restart sc-tunnel-pg + erp-data→tự hồi; DOT_V_CLOSEOUT.md | M | opus | V-01..08 | A1-01,A1-02,A3-01,A4-1,A4-2 |

## Việc CHỜ THANG (quyết định)
1. Xác nhận **11 tài khoản suspended** là khoá THẬT (trước khi V-06 UPDATE is_active=false).
2. Chốt thời điểm gỡ /ncc (V-07) — khuyến nghị ngay sau V-02+V-03 verify (redirect 301 tự đỡ token cũ).
3. Bật **maker-checker AWARD** (UI có sẵn) + threshold VND — khuyến nghị BẬT cùng auto-AP.
4. Bật **app_config auto-AP/auto-AR** — SAU maker-checker + verify 1 phiếu; chạy m47:48-57 kiểm nghi vấn `phase3_auto_ar_enabled=TRUE`.
5. **M365** 4 biến — không chặn Đợt V; có thì email tự mang link đúng nhờ V-03.
6. Duyệt lịch 2 blip giờ vắng: `docker restart sc-postgres` (test V-04, ~30s ERP) + recreate sc-nginx (V-07, ~2s).

## KHÔNG LÀM (chống lạc hướng / YAGNI)
- KHÔNG pagination DataTable đầy đủ (V-10 limit=50 đủ); KHÔNG bật lại/xây email (M365 tắt chủ đích); KHÔNG đụng Samsung/BQMS; KHÔNG re-platform UI rfq theo sec-bqms; KHÔNG chuyển DB/replica/HA sang vendor (tunnel PASS T2); KHÔNG WireGuard (UDP chặn); KHÔNG refactor helper _portal_base thành framework; KHÔNG tự bật app_config tài chính (quyết định Thang).

## Trạng thái thi hành
- [x] **V-01 LIVE 05/07** — forgot-password trả generic (không lộ reset_link, verify prod); endpoint admin-only `POST /vendors/{id}/reset-link`; FE forgot-password dọn ô link; rà log: chỉ thấy 1 call = test của tôi (log xoay vòng, không phủ hết cửa sổ → khuyến nghị reset 7 NCC phòng ngừa).
- [x] **V-02 LIVE 05/07** — 8 hardcode /ncc → `NEXT_PUBLIC_BASE_PATH`; rebuild vendor-portal; verify: /login /dashboard /forgot-password=200, /ncc/login=404, **bundle 0 tham chiếu /ncc**; + dọn A1-07 rewrite chết.
- [x] **V-03 LIVE 05/07** — `VENDOR_PORTAL_URL` field Settings + fallback→vendor.songchau.vn; deploy 2 server; verify `_vendor_portal_base()`/`_portal_base()` = https://vendor.songchau.vn. Harness 381 pass, tsc 0 lỗi.
- [x] **V-05 LIVE 05/07** — systemd drop-in `erp-data.service.d/10-restart-vendor-api.conf` (ExecStartPost chờ mountpoint + docker restart sc-vendor-api). Replay T3: restart erp-data → tự hồi ~50s (container thấy đủ file, health 200) KHÔNG restart tay. Units commit vào vendor-server/systemd/.
- [x] **V-06 LIVE 05/07** — deps.py fail-closed 403 suspended (trước nhánh legacy-or) + login vendor kiểm suspended vô điều kiện + list_vendor_accounts/invite loại suspended. Harness 381 + verify có kiểm soát (suspended+is_active=true → login 403 "đã bị tạm khoá"). 11 demo suspended đều e2e, is_active đã=false.
- [x] **V-04 LIVE 05/07** — 2 socat sidecar (docker-compose.tunnel.yml) publish 127.0.0.1:15432/16379 → postgres/redis qua Docker DNS; vendor-tunnel -L → 127.0.0.1; health hồi ~4s; safe test restart socat → tự hồi ~3s. **CÒN test-ác restart sc-postgres (chờ Thang duyệt ~30s ERP blip)**.
- [x] **V-07 LIVE 05/07** — default.conf block /ncc → `301 strip-prefix` vendor.songchau.vn; vendor.conf→.off; nginx -t OK + reload; sc-vendor-portal stop + restart=no; verify /ncc/login→301, ERP+vendor=200, RAM giải phóng. **CÒN compose cleanup 8080+vendor-portal service (recreate nginx giờ vắng)**.
- [ ] V-08 (P1 — UI admin mời NCC) · [ ] V-09..V-13 (P2)
