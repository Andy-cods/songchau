#!/usr/bin/env bash
# ============================================================================
# alerts.sh — 5 CHECK sức khoẻ vận hành cho Song Châu ERP. Ghi CẢNH BÁO vào
# kênh alert DUY NHẤT /opt/erp/data/logs/alerts.log khi VƯỢT NGƯỠNG, IM LẶNG
# nếu OK (tránh spam log — Thang tự tail/wire kênh khác sau này).
#
# CHẠY QUA CRON (do install_crons.sh cài, mỗi 5 phút):
#   */5 * * * * /opt/erp/scripts/alerts.sh >> /opt/erp/data/logs/cron_alerts.log 2>&1
# Cũng có thể chạy tay để kiểm tra ngay lập tức:
#   /opt/erp/scripts/alerts.sh
#
# 5 CHECK (mỗi check ĐỘC LẬP — 1 check lỗi KHÔNG được làm hỏng 4 check còn lại):
#   1) JOB-STUCK       procrastinate_jobs status='doing' quá 30 phút
#   2) SYNC-FRESHNESS  bqms_rfq.updated_at cũ hơn 36h (PROXY — xem ghi chú trong
#                      check_sync_freshness, cần Thang xác nhận nguồn nếu có
#                      bảng sync-log riêng chính xác hơn)
#   3) SSL             chứng chỉ HTTPS còn <= 14 ngày là hết hạn
#   4) DISK            / và /opt/erp (nếu khác mount) dùng >= 85%
#   5) RESTART-LOOP    container SC restart > 3 lần trong lúc uptime < 1h
#
# Format 1 dòng alert: <ISO-8601 UTC> <SEVERITY> <check> <chi tiết>
#   Ví dụ: 2026-07-03T19:05:00Z WARN job-stuck 4 job dang 'doing' qua 30 phut
#
# `set -u` để bắt lỗi biến chưa khai báo, NHƯNG CỐ Ý KHÔNG `set -e` / `pipefail`:
# 1 lệnh lỗi trong 1 check không được phép làm cả script thoát sớm và bỏ lỡ các
# check còn lại. Mỗi check còn được bọc thêm trong subshell `( check ) || true`
# ở main() để chặn cả trường hợp check tự exit/lỗi biến bất ngờ.
#
# KHÔNG hardcode secret: psql chạy qua `docker exec sc-postgres` (trust nội bộ
# container, cùng network Docker) — không cần mật khẩu Postgres trong file này.
# ============================================================================
set -u

# ── Hằng số / ngưỡng ─────────────────────────────────────────────────────
LOG_DIR="/opt/erp/data/logs"
ALERT_LOG="${LOG_DIR}/alerts.log"
SSL_NOCERT_STATE="${LOG_DIR}/.alerts_ssl_nocert_last"
PGC="sc-postgres"
PGUSER="scadmin"
PGDB="songchau_erp"

JOB_STUCK_MIN=30              # phút — ngưỡng JOB-STUCK
SYNC_STALE_HOURS=36           # giờ — ngưỡng SYNC-FRESHNESS
SSL_WARN_DAYS=14              # ngày — ngưỡng SSL sắp hết hạn
DISK_WARN_PCT=85              # % — ngưỡng DISK
RESTART_MAX=3                 # số lần restart tối đa chấp nhận được
RESTART_WINDOW_SEC=3600       # 1h — chỉ báo nếu container mới restart gần đây
ALERT_LOG_MAXBYTES=$((5 * 1024 * 1024))   # 5MB — ngưỡng rotate alerts.log
SSL_NOCERT_RENOTIFY_SEC=86400 # 24h — không tìm thấy cert thì tối đa 1 INFO/ngày

# 7 container SC theo docker-compose.prod.yml
CONTAINERS="sc-postgres sc-api sc-worker sc-scheduler sc-frontend sc-redis sc-nginx"

mkdir -p "${LOG_DIR}" 2>/dev/null || true
touch "${ALERT_LOG}" 2>/dev/null || true

# ── Helper chung ─────────────────────────────────────────────────────────
ts_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

emit() {
    local sev="$1" check="$2" detail="$3" line
    line="$(printf '%s %s %s %s' "$(ts_iso)" "${sev}" "${check}" "${detail}")"
    if ! printf '%s\n' "${line}" >> "${ALERT_LOG}" 2>/dev/null; then
        # Kênh alert DUY NHẤT bị hỏng (quyền/disk đầy/thư mục bị xoá) — in ra stderr
        # làm kênh dự phòng miễn phí (cron đã redirect stderr vào cron_alerts.log).
        echo "[alerts.log-fail] ${line}" >&2
    fi
}

is_uint() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }
is_int()  { [[ "${1:-}" =~ ^-?[0-9]+$ ]]; }

have_docker() { command -v docker >/dev/null 2>&1; }

# Chạy 1 câu SQL qua docker exec, trả rỗng (không crash) nếu lỗi kết nối/psql
psql1() {
    docker exec "${PGC}" psql -U "${PGUSER}" -d "${PGDB}" -t -A -c "$1" 2>/dev/null
}

# ── Rotate alerts.log nếu > 5MB (rotate đơn giản: mv thành .1) ──────────
rotate_alert_log() {
    local sz
    sz="$(wc -c < "${ALERT_LOG}" 2>/dev/null)"
    is_uint "${sz}" || sz=0
    if (( sz > ALERT_LOG_MAXBYTES )); then
        mv -f "${ALERT_LOG}" "${ALERT_LOG}.1" 2>/dev/null || true
        : > "${ALERT_LOG}" 2>/dev/null || true
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 1: JOB-STUCK — procrastinate_jobs 'doing' quá 30 phút
# ═══════════════════════════════════════════════════════════════════════
check_job_stuck() {
    have_docker || return 0

    local cnt
    cnt="$(psql1 "SELECT count(*) FROM procrastinate_jobs WHERE status='doing' AND scheduled_at < now() - interval '${JOB_STUCK_MIN} minutes';")"
    is_uint "${cnt}" || return 0

    if (( cnt > 0 )); then
        emit "WARN" "job-stuck" "${cnt} job dang 'doing' qua ${JOB_STUCK_MIN} phut"
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 2: SYNC-FRESHNESS — lần sync BQMS/IMV gần nhất > 36h
#
# PROXY: dùng MAX(updated_at) FROM bqms_rfq theo đúng yêu cầu gốc. Bảng này còn
# có cột synced_at (nullable) — nếu đó là nguồn đúng nghĩa "lần sync cuối" hơn
# thì chỉ cần đổi tên cột trong câu SQL bên dưới. CẦN THANG XÁC NHẬN nguồn nào
# phản ánh đúng "sync BQMS/IMV" nhất (có thể có bảng sync-log riêng khác).
# ═══════════════════════════════════════════════════════════════════════
check_sync_freshness() {
    have_docker || return 0

    local hours
    hours="$(psql1 "SELECT COALESCE((EXTRACT(EPOCH FROM now() - MAX(updated_at)) / 3600)::int, 999999) FROM bqms_rfq;")"
    is_int "${hours}" || return 0

    if (( hours > SYNC_STALE_HOURS )); then
        emit "WARN" "sync-freshness" "bqms_rfq.updated_at cach day ${hours}h (nguon=proxy MAX(updated_at), xac nhan voi Thang neu co bang sync-log rieng)"
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 3: SSL — chứng chỉ HTTPS còn <= 14 ngày
# ═══════════════════════════════════════════════════════════════════════
check_ssl() {
    local cert enddate source epoch now_epoch days

    cert="$(ls -1 /etc/letsencrypt/live/*/fullchain.pem 2>/dev/null | head -1)"
    if [[ -n "${cert}" && -f "${cert}" ]]; then
        source="${cert}"
        enddate="$(openssl x509 -enddate -noout -in "${cert}" 2>/dev/null | cut -d= -f2)"
    else
        source="s_client:localhost:443"
        # `timeout 5` bắt buộc: nếu port 443 bị DROP (thay vì reset/refuse), s_client có
        # thể treo vô thời hạn -> cron */5 phút sẽ chồng job liên tục nếu không giới hạn.
        enddate="$(echo | timeout 5 openssl s_client -connect localhost:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
    fi

    if [[ -z "${enddate}" ]]; then
        # Không tìm thấy chứng chỉ nào (chưa có SSL / môi trường dev). Ghi INFO tối
        # đa 1 lần / 24h (dùng file marker có timestamp, KHÔNG quét ngược alerts.log)
        # để tránh spam mà vẫn không im lặng vĩnh viễn nếu tình trạng còn kéo dài.
        local last now
        now="$(date +%s)"
        last=0
        if [[ -f "${SSL_NOCERT_STATE}" ]]; then
            last="$(cat "${SSL_NOCERT_STATE}" 2>/dev/null)"
            is_uint "${last}" || last=0
        fi
        if (( now - last >= SSL_NOCERT_RENOTIFY_SEC )); then
            emit "INFO" "ssl" "khong tim thay chung chi qua /etc/letsencrypt/live/*/fullchain.pem hoac localhost:443"
            echo "${now}" > "${SSL_NOCERT_STATE}" 2>/dev/null || true
        fi
        return 0
    fi

    epoch="$(date -d "${enddate}" +%s 2>/dev/null)"
    is_uint "${epoch}" || return 0
    now_epoch="$(date +%s)"
    days=$(( (epoch - now_epoch) / 86400 ))

    if (( days <= SSL_WARN_DAYS )); then
        emit "WARN" "ssl" "het han sau ${days} ngay (nguon=${source})"
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 4: DISK — / và /opt/erp (nếu khác mount) dùng >= 85%
# ═══════════════════════════════════════════════════════════════════════
check_disk_one() {
    local mount="$1" pct
    pct="$(df -P "${mount}" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
    is_uint "${pct}" || return 0

    if (( pct >= DISK_WARN_PCT )); then
        emit "WARN" "disk" "${mount} dang dung ${pct}%"
    fi
}

check_disk() {
    check_disk_one "/"

    if [[ -d "/opt/erp" ]]; then
        local fs_root fs_erp
        fs_root="$(df -P / 2>/dev/null | awk 'NR==2 {print $1}')"
        fs_erp="$(df -P /opt/erp 2>/dev/null | awk 'NR==2 {print $1}')"
        if [[ -n "${fs_erp}" && "${fs_erp}" != "${fs_root}" ]]; then
            check_disk_one "/opt/erp"
        fi
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 5: RESTART-LOOP — container SC restart > 3 lần, uptime hiện tại < 1h
# ═══════════════════════════════════════════════════════════════════════
check_restart_loop() {
    have_docker || return 0

    local c running restart_count started_at started_epoch now_epoch uptime

    for c in ${CONTAINERS}; do
        docker inspect "${c}" >/dev/null 2>&1 || continue

        running="$(docker inspect -f '{{.State.Running}}' "${c}" 2>/dev/null)"
        [[ "${running}" == "true" ]] || continue

        restart_count="$(docker inspect -f '{{.RestartCount}}' "${c}" 2>/dev/null)"
        is_uint "${restart_count}" || continue
        (( restart_count > RESTART_MAX )) || continue

        started_at="$(docker inspect -f '{{.State.StartedAt}}' "${c}" 2>/dev/null)"
        started_epoch="$(date -d "${started_at}" +%s 2>/dev/null)"
        is_uint "${started_epoch}" || continue
        now_epoch="$(date +%s)"
        uptime=$(( now_epoch - started_epoch ))

        if (( uptime < RESTART_WINDOW_SEC )); then
            emit "WARN" "restart-loop" "${c} RestartCount=${restart_count} uptime=${uptime}s (<1h) — nghi restart-loop"
        fi
    done
}

# ═══════════════════════════════════════════════════════════════════════
# MAIN — chạy 5 check, mỗi check bọc riêng trong subshell + || true để 1 check
# lỗi (unbound var, lệnh con exit bất ngờ...) không làm hỏng các check còn lại.
# ═══════════════════════════════════════════════════════════════════════
main() {
    rotate_alert_log

    ( check_job_stuck )      || true
    ( check_sync_freshness ) || true
    ( check_ssl )             || true
    ( check_disk )            || true
    ( check_restart_loop )    || true
}

main "$@"
