# RUNBOOK — Sổ tay vận hành sự cố (Song Châu ERP)

> Đối tượng đọc: bất kỳ ai (kể cả người ngoài team) có SSH vào VPS và cần xử lý sự cố mà không cần hỏi lại Thang.
> Prod: VPS `103.56.158.129`, thư mục deploy `/opt/erp`, DB `songchau_erp` (user `scadmin`), 7 container: `sc-postgres`, `sc-api`, `sc-worker` (procrastinate-worker), `sc-scheduler` (procrastinate-scheduler), `sc-frontend`, `sc-redis`, `sc-nginx`.
> Mọi lệnh dưới đây chạy trên VPS, trong `/opt/erp`, trừ khi ghi rõ khác.
> Kênh cảnh báo duy nhất: `/opt/erp/data/logs/alerts.log` (xem mục 9 để đọc).

---

## 1. Deploy & Rollback

### 1.1. Deploy bình thường (có cổng test tự chặn)
```bash
cd /opt/erp
./scripts/deploy.sh                  # deploy branch hiện tại
./scripts/deploy.sh --branch main    # deploy branch cụ thể
```
Quy trình `scripts/deploy.sh` làm (7 bước, tự log vào `data/logs/deploy.log`):
1. Kiểm tra môi trường (docker, git, disk trống ≥2GB).
2. **Backup Postgres** trước khi đổi gì (`pg_dump --format=custom` → `data/backups/pre_deploy_<TS>.dump`, giữ 7 ngày).
3. `git pull` (tự `git stash` nếu có thay đổi cục bộ chưa commit).
4. Build lại **cả 4 service** backend: `api frontend procrastinate-worker procrastinate-scheduler` — **PHẢI đủ 4**, thiếu worker/scheduler thì 2 container đó chạy code cũ sau deploy (bug đã từng xảy ra, xem comment W0-02 trong script).
5. **Cổng kiểm thử (CI gate)** — chạy `backend/scripts/run_tests_ci.sh -m 'smoke or unit or integration'` trên image `api` **vừa build** (Postgres tạm tmpfs, network riêng, KHÔNG chạm prod DB). Đỏ → **HỦY deploy ngay, không restart container** — code cũ vẫn chạy nguyên vẹn, không cần rollback.
6. `docker compose up -d --remove-orphans` (rolling restart), `docker image prune -f`.
7. Health check: `curl http://localhost/api/health` tối đa 10 lần / cách 6s. Fail → tự rollback (xem 1.2).

Tham số:
- `--no-backup` — bỏ backup (không khuyến nghị).
- `--skip-build` — chỉ restart, không build lại.
- `--skip-tests` — bỏ cổng test (**chỉ dùng khi khẩn cấp**, tự chịu rủi ro).

### 1.2. Rollback tự động
Khi health check thất bại ở bước 7, `deploy.sh` tự gọi hàm `rollback()`:
- `git checkout <commit_cũ> -- .` rồi `docker compose up -d` lại với code cũ.
- **KHÔNG tự động restore DB** — script chỉ in lệnh gợi ý, tự tay quyết định:
  ```bash
  docker exec -i sc-postgres pg_restore -U scadmin -d songchau_erp < <BACKUP_FILE>
  ```
  Lý do không tự làm: tránh mất dữ liệu mới ghi vào giữa lúc deploy.

### 1.3. Deploy thủ công qua `docker cp` (hotfix nhanh, không qua git pull đầy đủ)
Dùng khi cần vá 1-2 file ngay mà không muốn build lại toàn bộ image (tốn 2-5 phút). Đây cũng là pattern mà toàn bộ Đợt 1/2/3 dùng để deploy fix:
```bash
# 1) copy file đã sửa vào CẢ 3 container (api + worker + scheduler share code)
docker cp app/services/xxx.py sc-api:/app/app/services/xxx.py
docker cp app/services/xxx.py sc-worker:/app/app/services/xxx.py
docker cp app/services/xxx.py sc-scheduler:/app/app/services/xxx.py

# 2) LƯU Ý (gate quan trọng): nếu đang có push báo giá BQMS chạy dở, đợi/kiểm tra trước khi restart —
#    restart giữa lúc push sẽ làm job kẹt ở running (worker OOM-giống), watchdog sẽ tự dọn sau ~20' (mục 4)
#    nhưng an toàn hơn là kiểm trước:
docker exec sc-postgres psql -U scadmin -d songchau_erp -t -A -c \
  "SELECT count(*) FROM bqms_rfq WHERE bqms_push_status IN ('running','queued');"
# Nếu > 0: đợi xong hoặc chấp nhận watchdog dọn ~20' sau. Nếu bằng 0: restart an toàn ngay.

# 3) restart CẢ 3 container (không phải chỉ api — scheduler/worker giữ code cũ nếu không restart)
docker restart sc-api sc-worker sc-scheduler

# 4) verify
curl -sf http://localhost/api/health && echo OK
docker logs sc-api --tail 30
```
Với **frontend**: build rồi `up -d --no-deps` (KHÔNG dùng `--force-recreate` toàn compose — sẽ recreate luôn postgres/redis và có thể mất mount/volume tạm giữa chừng):
```bash
cd /opt/erp
docker compose -f docker-compose.yml -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps frontend
```

**Nhược điểm docker cp**: sống qua `docker restart` bình thường nhưng **MẤT khi rebuild image** hoặc `up --force-recreate`/`deploy.sh` chạy lại (build lại từ git). Muốn vĩnh viễn: commit file đã sửa vào git rồi mới `docker cp`/deploy chính thức.

### Verify sau deploy
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps   # tất cả "Up (healthy)"
curl -sf http://localhost/api/health
tail -30 /opt/erp/data/logs/deploy.log
```

---

## 2. Backup & Restore

### 2.1. Backup tự động
- Cron `0 2 * * *` (02:00 hằng ngày, cài bởi `scripts/install_crons.sh`) chạy `pg_dump -Fc -Z6` → `data/backups/daily_<TS>.dump`. Retention: xoá file `daily_*.dump` cũ hơn 14 ngày. Kết quả (OK/FAIL) ghi vào `alerts.log`.
- Log riêng của cron: `data/logs/cron_backup.log`.
- Backup thủ công ngay (không đợi 02:00):
  ```bash
  /opt/erp/scripts/install_crons.sh backup
  ```

### 2.2. Restore — TẠI SAO PHẢI DÙNG WRAPPER `restore_backup.sh` (không `pg_restore` trần)
4 bảng (`customers`/`inventory`/`products`/`suppliers`) có cột GENERATED STORED dùng `immutable_unaccent()` → gọi `unaccent()`. `pg_dump` phát ra `search_path=''` trong dump; khi `pg_restore` tính lại cột generated, `unaccent()` không resolve được (search_path rỗng) → **4 bảng + view/matview phụ thuộc KHÔNG restore được** (chỉ ra 170/182 bảng thay vì đủ). Đây là bug đã gặp thật (m43), KHÔNG phải lý thuyết.

`restore_backup.sh` xử lý bằng cách:
1. Pre-create extensions (`unaccent`, `uuid-ossp`, `pg_trgm`, `btree_gin`) trong DB đích.
2. Pre-create `immutable_unaccent` với `SET search_path=public` (bản non-inlinable) TRƯỚC khi restore — `pg_restore` báo "already exists" cho CREATE FUNCTION trong dump (vô hại), nhưng cột generated sẽ dùng bản search_path đúng.
3. `pg_restore --no-owner --no-privileges`.
4. Guard: kiểm tra dump có ≥170 TABLE entries + có bảng `leave_policy` (HR) trước khi restore — chặn dump hỏng/thiếu ngay từ đầu.

**Dùng:**
```bash
# THỬ (drill) — dựng Postgres tạm (tmpfs, network riêng), restore, verify đủ bảng, tự xoá. KHÔNG đụng gì tới DB thật.
/opt/erp/scripts/restore_backup.sh /opt/erp/data/backups/daily_20260704_020000.dump --drill

# THẬT — restore vào DB MỚI (KHÔNG ghi đè songchau_erp đang chạy)
/opt/erp/scripts/restore_backup.sh /opt/erp/data/backups/daily_20260704_020000.dump songchau_erp_restored
# Sau khi restore xong + kiểm dữ liệu OK, TỰ QUYẾT ĐỊNH đổi tên/điểm-tới DB này (không tự động).
```
Script trả exit 0 khi đạt đủ 182/182 bảng+view kỳ vọng (chỉnh ngưỡng qua `EXPECT_TABLES=<n>` nếu schema thay đổi).

**Lưu ý copy dump giữa container** (bài học thật 2026-07-03): PHẢI `docker cp sc-postgres:/path host:/path` rồi `docker cp host:/path target:/path` — copy nhầm từ `/tmp` HOST có thể lấy dump STALE (thiếu bảng).

### 2.3. Drill tự động
Cron `0 3 * * 0` (Chủ Nhật 03:00) tự lấy backup `daily_*.dump` mới nhất và chạy `restore_backup.sh --drill`. FAIL → ghi `CRITICAL` vào `alerts.log`. Log chi tiết: `data/logs/cron_drill.log`.

Chạy drill thủ công ngay:
```bash
/opt/erp/scripts/install_crons.sh drill
```

### Verify
```bash
tail -5 /opt/erp/data/logs/alerts.log | grep -i backup
ls -lh /opt/erp/data/backups/daily_*.dump | tail -3
```

---

## 3. Xoay mật khẩu Samsung (sec-bqms)

**Triệu chứng**: Samsung buộc đổi mật khẩu, hoặc `test-login` báo sai mật khẩu, hoặc scraper báo login fail liên tục.

**Cách xử** — KHÔNG cần sửa `.env` + restart 3 container (cách cũ chậm, dễ sai). Update qua API runtime:
```bash
# Cần JWT admin (login qua FE lấy token, hoặc dùng curl login trước)
curl -X PUT http://localhost/api/v1/bqms/scraper-settings/credentials \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"username": "<user_moi_neu_doi>", "password": "<mat_khau_moi>"}'
```
Cơ chế (`app/services/bqms_credentials.py`):
- Ghi override vào bảng `app_config` (`bqms_username` / `bqms_password`), KHÔNG phải env.
- Cache in-process TTL ~30s — **KHÔNG cần restart** `sc-api`/`sc-worker`/`sc-scheduler`, các process khác tự đọc override trong vòng 30s.
- Password KHÔNG BAO GIỜ log hay trả về qua API (chỉ trả `password_set: true/false` + `source: db|env`).

**Test-login trước khi bật lại scraper** (bắt buộc — interlock an toàn):
```bash
curl -X POST http://localhost/api/v1/bqms/scraper-settings/test-login \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
# → { "ok": true/false, "message": "..." }
```
- Nếu `ok: true` → hệ thống tự ghi `bqms_last_login_ok_at = NOW()` vào `app_config`.
- **6 cờ scraper** chỉ BẬT được (`PUT /bqms/scraper-settings/flags` với `value: true`) nếu có 1 lần test-login PASS **trong 24 giờ gần nhất** — nếu không sẽ nhận `409 Conflict`. Đây là safety interlock chống spam mật khẩu sai làm khoá tài khoản Samsung. TẮT cờ (`value: false`) thì luôn được phép (kill-switch không bị chặn).
6 tên flag (key UI → key `app_config` thật, trong `_SCRAPER_FLAG_KEYS`): `periodic_scrape`, `smart_sync`, `smart_rescan`, `code_track`, `state_tick`, `won_sync`.
```bash
curl -X PUT http://localhost/api/v1/bqms/scraper-settings/flags \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" \
  -d '{"flags": {"periodic_scrape": true, "smart_sync": true, "smart_rescan": true,
                  "code_track": true, "state_tick": true, "won_sync": true}}'
```

**Verify**:
```bash
curl http://localhost/api/v1/bqms/scraper-settings -H "Authorization: Bearer <ADMIN_TOKEN>"
# kiểm "credentials.source":"db", "credentials.password_set":true, "flags" đủ 6 cờ true
```

---

## 4. Orphan push Samsung (job đẩy báo giá bị treo)

**Triệu chứng**: `bqms_rfq.bqms_push_status` kẹt ở `running` hoặc `queued` mãi không xong, nút "Đẩy" trên FE không phản hồi/không đổi trạng thái.

**Chẩn đoán** — nguyên nhân thường gặp: `sc-worker` bị OOM giữa lúc push (Playwright/Chromium ngốn RAM) → job chết nhưng không có gì dọn dòng DB.

**Cơ chế tự phục hồi đã có sẵn**: `bqms_push_watchdog` (task periodic, chạy mỗi 15 phút, file `app/tasks/bqms_push_watchdog.py`):
- Case A: status=`running` + heartbeat (hoặc `started_at`) cũ > 20 phút → coi là chết (worker OOM), đánh dấu `failed`.
- Case B: status=`queued` + heartbeat cũ > 20 phút + job Procrastinate nền đã kết thúc/mất (`failed/cancelled/succeeded/aborted`/không còn) → mồ côi, đánh dấu `failed`. Nếu job nền còn `todo`/`doing` thì BỎ QUA (đang chờ hợp lệ).
- Khi đánh dấu `failed`: tạo notification cho toàn bộ admin + chèn 1 dòng vào `retry_queue` (chống trùng theo `rfq_id`).

**Cách xử khi cần ngay (không đợi 15 phút)**:
```bash
# 1) Kiểm có job kẹt không
docker exec sc-postgres psql -U scadmin -d songchau_erp -c \
  "SELECT id, rfq_number, bqms_push_status, bqms_push_started_at, bqms_push_heartbeat_at
     FROM bqms_rfq WHERE bqms_push_status IN ('running','queued')
     ORDER BY bqms_push_started_at;"

# 2) Kiểm sc-worker có bị OOM không (RestartCount tăng bất thường / log OOMKilled)
docker inspect sc-worker --format '{{.State.OOMKilled}} restarts={{.RestartCount}}'
docker logs sc-worker --tail 100 | grep -i "killed\|oom\|memory"

# 3) Chạy watchdog ngay thay vì đợi cron (nếu có cách gọi task thủ công qua procrastinate shell,
#    hoặc đơn giản restart worker để cron periodic tự bắt ở lần chạy kế — task tự chạy mỗi 15').
#    Nhanh nhất: đợi tối đa 15' rồi kiểm lại status='failed'.

# 4) Sau khi status='failed': vào /admin/retry-queue hoặc trang /bqms bấm "ĐẨY LẠI"
#    (idempotent, an toàn — không đẩy trùng giá đã lên Samsung, bấm được ngay không cần đợi gì thêm).
```

**Nếu worker liên tục OOM khi push** (không phải 1 lần đơn lẻ): xem mục 8 (OOM worker) — RAM limit hiện tại `sc-worker` = 2G (đã tăng từ 512M gây OOM lúc push, xem `docker-compose.prod.yml`).

**Verify**:
```bash
docker exec sc-postgres psql -U scadmin -d songchau_erp -t -A -c \
  "SELECT count(*) FROM bqms_rfq WHERE bqms_push_status IN ('running','queued');"
# → 0 nếu đã dọn sạch, hoặc chỉ còn job THẬT đang chạy (heartbeat mới < 20')
```

---

## 5. IMV sync fail

**Triệu chứng**: alert `sync-freshness` trong `alerts.log`, hoặc dashboard IMV không có dữ liệu mới, hoặc nhận notification "IMV sync lỗi 2 đêm liên tiếp".

**Cơ chế**: `imv_nightly_sync` (cron `50 23 * * *`, file `app/tasks/imv_sync.py`) chạy 1 phiên Playwright lấy 6 loại entity (rfq/orders/deliveries/payments/contracts/rejections). Có 2 tầng lỗi:
- **Lỗi cấp session** (login IMV hỏng, hoặc crash trước khi fetch bất kỳ entity nào): ghi `status='error'` cho TẤT CẢ entity vào `imv_sync_log` (không còn im lặng như trước — bug W0-11 đã fix).
- **Lỗi cấp entity** (1 entity riêng lỗi khi upsert): chỉ entity đó `status='error'`.
- **Cảnh báo tự động**: `_check_consecutive_errors` — nếu 1 entity lỗi **2 đêm liên tiếp** → bắn notification cho toàn bộ admin (chỉ bắn 1 lần lúc chuyển từ 1→2 lỗi liên tiếp, không spam mỗi đêm sau đó).
- **Alert riêng** (`alerts.sh` CHECK 2, mỗi 5 phút): `sync-freshness` — cảnh báo nếu `bqms_rfq.updated_at` cũ hơn 36h. Đây là proxy cho BQMS, KHÔNG PHẢI IMV — **TODO: xác nhận với Thang** nếu muốn thêm check freshness riêng cho IMV (bảng `imv_sync_log`/`imv_rfq`).

**Cách xử**:
```bash
# 1) Xem log lỗi gần nhất theo entity
docker exec sc-postgres psql -U scadmin -d songchau_erp -c \
  "SELECT entity_type, status, error_message, started_at
     FROM imv_sync_log ORDER BY started_at DESC LIMIT 20;"

# 2) Kiểm credential IMV — KHÁC BQMS: IMV dùng biến env thuần (IMV_USERNAME/IMV_PASSWORD trong .env),
#    KHÔNG có runtime-override qua app_config như BQMS. Đổi mật khẩu IMV → PHẢI sửa .env + restart:
#    (sửa /opt/erp/.env rồi)
docker restart sc-worker sc-scheduler

# 3) Kiểm scraper Playwright còn chạy được không (site IMV đổi UI / bị chặn IP)
docker logs sc-worker --tail 200 | grep -i imv

# 4) Chạy lại sync thủ công (nếu cần ngay, không đợi 23:50 đêm sau) — cần vào Python/procrastinate
#    shell trong container hoặc gọi qua admin endpoint nếu FE có nút "Sync lại IMV" (kiểm /imv trên FE).
```

**Verify**:
```bash
docker exec sc-postgres psql -U scadmin -d songchau_erp -t -A -c \
  "SELECT entity_type, status FROM imv_sync_log
     WHERE started_at > NOW() - INTERVAL '1 day'
     ORDER BY started_at DESC;"
# → status='success' cho tất cả 6 entity gần nhất
```

---

## 6. SSL ≤ 14 ngày

**Triệu chứng**: `alerts.log` có dòng `WARN ssl het han sau <N> ngay`.

**Cơ chế đã có**: `scripts/ssl_setup.sh` cài sẵn cron certbot renew 2 lần/ngày:
```
0 2,14 * * * root certbot renew --quiet --no-self-upgrade 2>> /opt/erp/data/logs/ssl_renewal.log
```
Bình thường certbot tự renew ở ngưỡng 30 ngày trước hết hạn — nếu `alerts.sh` vẫn báo ≤14 ngày nghĩa là auto-renew đang LỖI.

**Cách xử**:
```bash
# 1) Xem log renew gần nhất
tail -50 /opt/erp/data/logs/ssl_renewal.log

# 2) Chạy renew thủ công + xem lỗi trực tiếp
certbot renew --force-renewal
# hoặc dry-run trước để debug không tốn quota Let's Encrypt:
certbot renew --dry-run

# 3) Nếu lỗi do webroot/nginx (port 80 bị chiếm hoặc route /.well-known/ sai):
docker exec sc-nginx nginx -t
docker logs sc-nginx --tail 50

# 4) Sau khi renew xong, reload nginx để áp cert mới (KHÔNG cần restart toàn bộ)
docker exec sc-nginx nginx -s reload
```

**Verify**:
```bash
echo | openssl s_client -connect localhost:443 2>/dev/null | openssl x509 -noout -enddate
# tính lại số ngày còn lại, phải > 14
```

---

## 7. Disk ≥ 85%

**Triệu chứng**: `alerts.log` có dòng `WARN disk <mount> dang dung <pct>%` (check cho `/` và `/opt/erp` nếu khác filesystem).

**Cách xử theo thứ tự ưu tiên (an toàn → mạnh tay hơn)**:
```bash
# 1) Xem tổng quan trước khi xoá gì
df -h /
du -sh /opt/erp/data/backups /opt/erp/data/logs /var/lib/docker 2>/dev/null

# 2) Dọn backup deploy cũ (deploy.sh đã tự xoá pre_deploy_*.dump >7 ngày, daily_*.dump >14 ngày —
#    nếu vẫn đầy, kiểm có backup cũ kiểu khác không do cron cũ/thủ công để lại)
find /opt/erp/data/backups -name "*.dump" -mtime +14 -exec ls -lh {} \;
# rà kỹ trước khi xoá tay — không xoá backup gần nhất

# 3) Docker image/build cache cũ (deploy.sh chỉ prune sau mỗi lần build — cache tích luỹ giữa các lần)
docker image prune -af    # xoá image không dùng (mạnh hơn -f thường)
docker builder prune -af  # xoá build cache
docker system df          # xem dung lượng theo loại (images/containers/volumes/cache)

# 4) Log rotate — kiểm logrotate đã chạy đúng chưa (scripts/setup_logrotate.sh cài sẵn)
du -sh /opt/erp/data/logs/*.log | sort -h | tail -10
logrotate -f /etc/logrotate.d/songchau-erp   # ép rotate ngay nếu file to bất thường

# 5) Bảng DB phình to bất thường (audit_log/notifications/procrastinate_events) — xem PERF_BASELINE
#    (audit_log 175MB/chỉ 2039 dòng lúc baseline — nghi bloat, cần VACUUM):
docker exec sc-postgres psql -U scadmin -d songchau_erp -c "VACUUM (VERBOSE, ANALYZE) audit_log;"
```

**Verify**:
```bash
df -h / /opt/erp
# pct phải < 85% sau khi dọn
```

---

## 8. OOM worker (sc-worker)

**Triệu chứng**: push BQMS bị kẹt (xem mục 4), hoặc `alerts.sh` CHECK 5 báo `restart-loop` cho `sc-worker`, hoặc `docker ps` cho thấy `sc-worker` restart nhiều lần gần đây.

**Bối cảnh**: `sc-worker` chạy Playwright/Chromium để push báo giá lên Samsung — tốn RAM đột biến lúc push. RAM limit hiện tại (đã tăng sau khi 512M gây OOM thật — xem `docker-compose.prod.yml`):
- `sc-worker`: limit **2G**, reservation 384M.
- `sc-scheduler`: limit **1G**, reservation 256M.

**Cách xử**:
```bash
# 1) Xác nhận có phải OOM thật không
docker inspect sc-worker --format 'OOMKilled={{.State.OOMKilled}} RestartCount={{.RestartCount}} StartedAt={{.State.StartedAt}}'
dmesg 2>/dev/null | grep -i "out of memory\|oom-kill" | tail -20   # cần quyền root trên host

# 2) Xem RAM đang dùng thực tế (so với limit 2G)
docker stats --no-stream sc-worker sc-scheduler

# 3) Nếu OOM lặp lại thường xuyên (không phải 1 lần đơn lẻ) → job nào đang nặng:
docker exec sc-postgres psql -U scadmin -d songchau_erp -c \
  "SELECT id, task_name, status, scheduled_at FROM procrastinate_jobs
     WHERE status = 'doing' ORDER BY scheduled_at;"
#   kiểm xem có phải push nhiều mã cùng lúc / batch quá lớn không (BQMS Push Batch giữ
#   samsung_session_lock nên PHẢI tuần tự — nếu thấy nhiều job push chạy 'doing' cùng lúc là bất thường)

# 4) Restart để giải phóng ngay (an toàn — watchdog mục 4 sẽ tự dọn job kẹt do restart này)
docker restart sc-worker sc-scheduler

# 5) Nếu OOM tái diễn dù đã ở 2G — cân nhắc tăng limit trong docker-compose.prod.yml
#    (deploy.resources.limits.memory của procrastinate-worker), rồi
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps procrastinate-worker
```

**Verify**:
```bash
docker inspect sc-worker --format 'Running={{.State.Running}} OOMKilled={{.State.OOMKilled}}'
docker stats --no-stream sc-worker   # RAM dưới limit, ổn định không tăng liên tục
```

---

## 9. Đọc alert

### 9.1. Kênh alert DUY NHẤT: `alerts.log`
File: `/opt/erp/data/logs/alerts.log`. Ghi bởi `scripts/alerts.sh` (chạy qua cron mỗi 5 phút) + `scripts/install_crons.sh` (backup/drill). **Chỉ ghi khi có vấn đề — im lặng nếu OK** (tránh spam), trừ 5 check của `alerts.sh` chạy độc lập mỗi 5 phút nên có thể thấy dòng lặp lại nếu tình trạng còn kéo dài.

**Format 1 dòng**: `<ISO-8601 UTC> <SEVERITY> <check> <chi tiết>`
```
2026-07-04T19:05:00Z WARN job-stuck 4 job dang 'doing' qua 30 phut
2026-07-04T19:10:00Z CRITICAL restore-drill restore drill FAIL rc=1 file=daily_20260704.dump
```

**5 check + severity**:
| check | severity khi vượt ngưỡng | ngưỡng |
|---|---|---|
| `job-stuck` | WARN | procrastinate job `status='doing'` > 30 phút |
| `sync-freshness` | WARN | `bqms_rfq.updated_at` cũ hơn 36h (proxy — TODO xác nhận nguồn với Thang nếu có bảng sync-log riêng đúng hơn) |
| `ssl` | WARN (hoặc INFO nếu không tìm thấy cert, tối đa 1 lần/24h) | ≤ 14 ngày hết hạn |
| `disk` | WARN | `/` hoặc `/opt/erp` dùng ≥ 85% |
| `restart-loop` | WARN | container SC restart > 3 lần trong lúc uptime hiện tại < 1h |

Cộng thêm 2 nguồn CRITICAL riêng (từ `install_crons.sh`):
- `backup` FAIL — pg_dump/docker cp lỗi hoặc dump rỗng.
- `restore-drill` CRITICAL — drill Chủ Nhật thất bại (không đủ 182 bảng).

**Đọc nhanh** (mọi lệnh chạy trên VPS):
```bash
tail -50 /opt/erp/data/logs/alerts.log                    # 50 dòng gần nhất
grep CRITICAL /opt/erp/data/logs/alerts.log | tail -20     # chỉ CRITICAL
grep "$(date -u +%Y-%m-%d)" /opt/erp/data/logs/alerts.log  # alert hôm nay (UTC)
```
File tự rotate khi > 5MB (`mv alerts.log alerts.log.1`), xem thêm `alerts.log.1` nếu cần lịch sử xa hơn.

### 9.2. Log cron riêng (stdout/stderr từng cron, để debug KHI check trong alerts.log không đủ chi tiết)
```bash
tail -100 /opt/erp/data/logs/cron_backup.log    # cron 02:00
tail -100 /opt/erp/data/logs/cron_drill.log     # cron CN 03:00
tail -100 /opt/erp/data/logs/cron_alerts.log    # cron */5 phút (alerts.sh) — bao gồm cả stderr nếu alerts.log tự nó bị hỏng (quyền/disk đầy)
```

### 9.3. Đối chiếu ngay bằng tay (không cần đợi cron)
```bash
/opt/erp/scripts/alerts.sh          # chạy cả 5 check ngay lập tức, in kết quả vào alerts.log như cron
```

---

## Phụ lục — bảng tham chiếu nhanh

| Việc | Lệnh |
|---|---|
| Xem trạng thái container | `docker compose -f docker-compose.yml -f docker-compose.prod.yml ps` |
| Health API | `curl -sf http://localhost/api/health` |
| Vào Postgres | `docker exec -it sc-postgres psql -U scadmin -d songchau_erp` |
| Deploy log | `tail -f /opt/erp/data/logs/deploy.log` |
| Danh sách backup | `ls -lh /opt/erp/data/backups/` |
| Cài lại 3 cron (idempotent) | `sudo /opt/erp/scripts/install_crons.sh` |

---

## Chỗ cần Thang bổ sung / xác nhận (đừng tự suy đoán)

1. **Mục 5 (IMV sync fail)**: chưa tìm thấy nút "sync lại IMV thủ công" trên FE hay endpoint admin gọi trực tiếp `imv_nightly_sync` ngoài giờ cron 23:50 — TODO xác nhận với Thang cách trigger lại sync ngay khi cần (có thể cần thêm endpoint, hoặc dùng procrastinate CLI trong container).
2. **Mục 5**: `alerts.sh` check `sync-freshness` hiện chỉ theo dõi `bqms_rfq.updated_at` (BQMS), CHƯA có check freshness riêng cho IMV. TODO hỏi Thang có cần thêm check IMV riêng không.
3. **Mục 9**: `sync-freshness` dùng `MAX(updated_at)` làm proxy — bảng `bqms_rfq` còn cột `synced_at` (nullable) có thể là nguồn đúng nghĩa hơn. Đã ghi chú sẵn trong code (`app/tasks`/`scripts/alerts.sh`) nhưng CHƯA đổi vì cần Thang xác nhận nguồn nào đúng.
4. **Kênh cảnh báo ngoài** (email/Telegram/Zalo): hiện chỉ ghi vào `alerts.log`, chưa có kênh đẩy ra ngoài vì M365 env chưa cấu hình (theo DOT2_CLOSEOUT). TODO: khi Thang chọn kênh, cần wire thêm notifier đọc `alerts.log`.
5. **Mục 8**: chưa có ngưỡng RAM "an toàn tuyệt đối" xác nhận từ Thang cho `sc-worker` khi push nhiều mã cùng lúc (2G là baseline sau 1 lần OOM ở 512M — có thể cần tăng thêm nếu batch push lớn hơn trong tương lai).
