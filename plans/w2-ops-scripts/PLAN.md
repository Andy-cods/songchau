# PLAN — W2-02 install_crons.sh + W2-06 alerts.sh

Nguồn: ROADMAP.md dòng 129/131 (`plans/master-completion/ROADMAP.md`), yêu cầu chi tiết từ Thang 2026-07-03.
Trạng thái: DÙNG ĐỂ IMPLEMENT — không chạy thử được ở máy dev Windows (không có docker/crontab thật);
review logic tĩnh + Code Reviewer pass trước khi Thang deploy tay lên VPS.

## 0. Phạm vi & ràng buộc
- Chỉ viết code tĩnh (không chạy/deploy/SSH). Prod: Ubuntu, Docker Compose, 7 container SC.
- KHÔNG sửa `backup.sh`, `health_monitor.sh`, `restore_backup.sh` (chỉ GỌI `restore_backup.sh`).
- Kênh alert DUY NHẤT: append `/opt/erp/data/logs/alerts.log`. Không email/webhook/notifications.
- Hằng số chung: `PGC=sc-postgres`, `PGUSER=scadmin`, `PGDB=songchau_erp`, `BACKUP_DIR=/opt/erp/data/backups`,
  `LOG_DIR=/opt/erp/data/logs`, `ALERT_LOG=$LOG_DIR/alerts.log`, `SCRIPTS_DIR=/opt/erp/scripts`.

## 1. Quyết định kiến trúc

**QĐ-1: logic backup + drill nằm TRONG `install_crons.sh` qua sub-command dispatch**
(`install` mặc định | `backup` | `drill`); cron gọi lại chính script với sub-command. Lý do KISS/DRY:
- Giữ đúng phạm vi "2 file mới" theo spec.
- Hằng số (BACKUP_DIR/ALERT_LOG/retention/marker) khai báo 1 nơi.
- `date +%Y%m%d_%H%M%S` chạy BÊN TRONG script, không nằm trên dòng crontab → dòng cron KHÔNG chứa `%`
  → không cần escape `\%` trong crontab (crontab chỉ cần escape % khi nó xuất hiện literal trên dòng cron).
- Chạy lại `install` chỉ cài cron, KHÔNG vô tình chạy backup.

**QĐ-2:** `alerts.sh` cách ly từng check bằng subshell `( check_x ) || true` — 1 check lỗi/unbound-var/exit
bất ngờ không hỏng check khác. `set -u`, KHÔNG `set -e`, KHÔNG `pipefail` (để 1 pipe lỗi không cascade).

**QĐ-3:** `alerts.sh` im lặng khi OK, chỉ ghi khi vượt ngưỡng. Backup (trong install_crons.sh) là NGOẠI LỆ
có chủ đích: ghi 1 dòng OK/size (spec yêu cầu) và FAIL khi lỗi.

**QĐ-4:** idempotent cron bằng marker `# SC-ERP-CRON:<name>`. Strip mọi dòng marker rồi ghi lại cả 3 dòng
mới trong 1 lần rewrite → luôn hội tụ, không nhân bản. `crontab -l 2>/dev/null || true` xử lý crontab rỗng.

**QĐ-5:** rotate alerts.log trong alerts.sh (>5MB → `mv alerts.log alerts.log.1`). Coexist với logrotate có sẵn
(`setup_logrotate.sh` rotate `*.log` theo ngày) — chấp nhận khả năng double-rotate, vô hại.

## 2. install_crons.sh — outline
- `emit(sev, check, detail)` → ghi 1 dòng ISO-ts vào alerts.log.
- `do_backup()`: pg_dump -Fc -Z6 vào /tmp trong container → docker cp ra BACKUP_DIR/daily_<TS>.dump →
  guard file rỗng (`[[ -s ]]`) → retention `find ... -name 'daily_*.dump' -mtime +14 -delete` → emit OK/FAIL.
- `do_drill()`: tìm `daily_*.dump` mới nhất (`ls -1t`) → nếu rỗng → CRITICAL "no backup" → gọi
  `restore_backup.sh <latest> --drill` → rc!=0 → CRITICAL.
- `do_install()`: build 3 dòng cron với marker, strip dòng cũ cùng marker, ghi lại, in crontab.

Lệnh chính xác dùng: xem code thật trong `scripts/install_crons.sh`.

## 3. alerts.sh — outline
5 hàm check độc lập, mỗi hàm tự guard docker/psql lỗi bằng `|| VAR=""` + regex numeric trước khi `(( ))`:
1. `check_jobs_stuck` — SQL: `SELECT count(*) FROM procrastinate_jobs WHERE status='doing' AND
   scheduled_at < now() - interval '30 minutes';`
2. `check_sync_freshness` — SQL: `SELECT COALESCE((EXTRACT(EPOCH FROM now()-MAX(updated_at))/3600)::int,
   999999) FROM bqms_rfq;` — PROXY, ghi rõ comment cần Thang xác nhận (bảng có cả `updated_at` và
   `synced_at` nullable — spec gốc chỉ định dùng `updated_at`, giữ theo spec).
3. `check_ssl` — thử glob `/etc/letsencrypt/live/*/fullchain.pem` trước, fallback `openssl s_client
   -connect localhost:443`. Không có cert → INFO 1 lần (anti-spam bằng cách so dòng cuối alerts.log).
4. `check_disk` — `df -P /` và `df -P /opt/erp` nếu khác mount (so `df -P / | awk 'NR==2{print $1}'`
   với filesystem của /opt/erp).
5. `check_restart_loop` — `docker inspect` RestartCount + StartedAt cho 7 container SC; RestartCount>3
   VÀ uptime<3600s → WARN.

## 4. Edge-case đã guard (implement thật trong code, xem comment inline)
1. `crontab -l` chưa có crontab nào → `2>/dev/null || true`.
2. Backup dir rỗng khi drill → glob không match → CRITICAL rõ ràng, không "ls: cannot access" lỗi thô.
3. Container không tồn tại → `docker inspect ... || continue`.
4. Docker chưa cài / daemon down → `command -v docker` guard, các check liên quan skip an toàn.
5. Chưa có cert → INFO có anti-spam.
6. psql/docker lỗi kết nối → giá trị rỗng, guard regex số trước khi so sánh số học.
7. `date -d` không parse được → `|| continue` / early return.
8. Retention CHỈ đụng `daily_*.dump` — không xoá nhầm `songchau_*.dump` (namespace của backup.sh cũ,
   giữ nguyên không đổi).
9. Dòng cron rỗng sau khi strip marker → lọc `grep -v '^[[:space:]]*$'` trước khi ghi lại crontab.

## 5. Điểm CẦN THANG XÁC NHẬN (ghi trong output cuối cùng gửi Thang, không phải lỗi cần sửa ngay)
1. Nguồn "sync freshness" chính xác: đang dùng `bqms_rfq.updated_at` theo đúng spec gốc; bảng có thêm
   cột `synced_at` (nullable) — nếu đó là nguồn đúng nghĩa "lần sync cuối" thì đổi 1 dòng SQL.
2. Cert path thật trên VPS: glob tự dò `/etc/letsencrypt/live/*/` nên không cần biết chính xác domain,
   nhưng xác nhận certbot có tồn tại/đang dùng đúng chỗ đó không (ssl_setup.sh cho thấy domain
   erp.songchau.vn qua certbot — khớp).
3. `ssl_setup.sh` có thể đã cài cron certbot renew (giờ khác), `setup_logrotate.sh` có cron logrotate
   03:00 — cron mới (backup 02:00, drill CN 03:00, health */5) không trùng giờ chính xác nhưng gần nhau;
   chấp nhận được vì các job độc lập, không cùng lock.
4. `backup.sh` cũ (tên `songchau_*.dump`, retention 30d) vẫn tồn tại song song, KHÔNG bị install_crons.sh
   đụng tới — nếu Thang muốn gộp/thay thế, cần quyết định riêng (không tự ý xoá cron cũ nếu có).
5. Severity RESTART-LOOP = WARN (không CRITICAL) theo spec gốc — giữ nguyên.
