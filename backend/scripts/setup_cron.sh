#!/usr/bin/env bash
# =============================================================================
# setup_cron.sh — Cài đặt cron jobs cho Song Châu ERP trên VPS
#
# Chạy 1 lần sau khi deploy để đăng ký tất cả scheduled tasks.
#
# Các jobs:
#   02:00 hàng ngày   — Sao lưu database PostgreSQL
#   23:30 hàng ngày   — Đồng bộ BQMS Samsung (backup cron, primary qua Procrastinate)
#   07:00 hàng ngày   — Refresh materialized views cho báo cáo
#   CN hàng tuần      — Xoay vòng log files
#   06:00 ngày 1      — Báo cáo tổng hợp tháng
#
# Usage:
#   chmod +x scripts/setup_cron.sh
#   sudo ./scripts/setup_cron.sh
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Cấu hình
# ---------------------------------------------------------------------------
APP_USER="${APP_USER:-deploy}"
PROJECT_DIR="${PROJECT_DIR:-/opt/songchau-erp/backend}"
DOCKER_COMPOSE="${DOCKER_COMPOSE:-docker compose}"
LOG_DIR="${LOG_DIR:-/var/log/songchau-erp}"
BACKUP_SCRIPT="${PROJECT_DIR}/scripts/backup.sh"

# ---------------------------------------------------------------------------
# Hàm tiện ích
# ---------------------------------------------------------------------------
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error_exit() {
    log "LỖI: $*" >&2
    exit 1
}

# ---------------------------------------------------------------------------
# Kiểm tra quyền
# ---------------------------------------------------------------------------
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log "Cảnh báo: Không chạy với quyền root. Cron sẽ được cài cho user hiện tại."
    CRON_USER="$(whoami)"
else
    CRON_USER="${APP_USER}"
fi

# ---------------------------------------------------------------------------
# Tạo thư mục log
# ---------------------------------------------------------------------------
log "Tạo thư mục log: ${LOG_DIR}"
mkdir -p "${LOG_DIR}"
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    chown "${APP_USER}:${APP_USER}" "${LOG_DIR}" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Chuẩn bị nội dung crontab
# ---------------------------------------------------------------------------
CRON_CONTENT="
# ═══════════════════════════════════════════════════════════════
# Song Châu ERP — Scheduled Tasks
# Cài đặt bởi setup_cron.sh — $(date '+%Y-%m-%d %H:%M:%S')
# ═══════════════════════════════════════════════════════════════

# Biến môi trường chung
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
PROJECT_DIR=${PROJECT_DIR}

# ─── 1. Sao lưu database — 02:00 hàng ngày ───
# Sử dụng pg_dump + gzip, xóa backup cũ hơn 30 ngày
0 2 * * * cd ${PROJECT_DIR} && ${BACKUP_SCRIPT} >> ${LOG_DIR}/backup.log 2>&1

# ─── 2. Đồng bộ BQMS Samsung — 23:30 hàng ngày ───
# Backup cron cho task Procrastinate (phòng trường hợp worker bị lỗi)
# Primary: Procrastinate periodic task trong app/tasks/bqms_sync.py
30 23 * * * cd ${PROJECT_DIR} && ${DOCKER_COMPOSE} exec -T backend python -m app.tasks.bqms_sync >> ${LOG_DIR}/bqms_sync.log 2>&1

# ─── 3. Refresh materialized views cho báo cáo — 07:00 hàng ngày ───
# Refresh bqms_kpi và mv_revenue_monthly trước giờ làm việc
0 7 * * * cd ${PROJECT_DIR} && ${DOCKER_COMPOSE} exec -T postgres psql -U scadmin -d songchau_erp -c \"REFRESH MATERIALIZED VIEW CONCURRENTLY bqms_kpi; REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_monthly;\" >> ${LOG_DIR}/mv_refresh.log 2>&1

# ─── 4. Xoay vòng log — Chủ nhật hàng tuần lúc 03:00 ───
# Nén log cũ hơn 7 ngày, xóa log cũ hơn 90 ngày
0 3 * * 0 find ${LOG_DIR} -name '*.log' -mtime +7 -exec gzip -q {} \\; 2>/dev/null; find ${LOG_DIR} -name '*.log.gz' -mtime +90 -delete 2>/dev/null

# ─── 5. Báo cáo tổng hợp tháng — 06:00 ngày 1 hàng tháng ───
0 6 1 * * cd ${PROJECT_DIR} && ${DOCKER_COMPOSE} exec -T backend python -m app.tasks.reports >> ${LOG_DIR}/monthly_report.log 2>&1

# ─── 6. Kiểm tra sức khỏe hệ thống — mỗi 5 phút ───
*/5 * * * * curl -sf http://localhost:8000/health > /dev/null || echo \"[ALERT] Song Chau ERP health check failed at \$(date)\" >> ${LOG_DIR}/healthcheck.log

# ─── 7. Dọn dẹp file tạm — 04:00 hàng ngày ───
0 4 * * * find /data/files/tmp -type f -mtime +3 -delete 2>/dev/null; find /tmp/songchau_* -mtime +1 -delete 2>/dev/null
"

# ---------------------------------------------------------------------------
# Cài đặt crontab
# ---------------------------------------------------------------------------
log "Cài đặt crontab cho user: ${CRON_USER}"

# Giữ lại cron jobs cũ không liên quan đến Song Châu
EXISTING_CRON=""
if crontab -u "${CRON_USER}" -l 2>/dev/null | grep -v "Song Châu\|Song Chau\|songchau" > /tmp/existing_cron.tmp 2>/dev/null; then
    EXISTING_CRON=$(cat /tmp/existing_cron.tmp)
fi

# Ghi crontab mới
{
    if [[ -n "${EXISTING_CRON}" ]]; then
        echo "${EXISTING_CRON}"
        echo ""
    fi
    echo "${CRON_CONTENT}"
} | crontab -u "${CRON_USER}" -

# Dọn dẹp
rm -f /tmp/existing_cron.tmp

# ---------------------------------------------------------------------------
# Xác nhận
# ---------------------------------------------------------------------------
log ""
log "═══════════════════════════════════════════════════════════"
log " CÀI ĐẶT CRON THÀNH CÔNG"
log "═══════════════════════════════════════════════════════════"
log " User       : ${CRON_USER}"
log " Project    : ${PROJECT_DIR}"
log " Log dir    : ${LOG_DIR}"
log ""
log " Jobs đã cài:"
log "   02:00 daily  — Backup PostgreSQL"
log "   23:30 daily  — BQMS sync (backup cron)"
log "   07:00 daily  — Refresh materialized views"
log "   03:00 Sun    — Log rotation"
log "   06:00 1st    — Monthly report"
log "   */5 min      — Health check"
log "   04:00 daily  — Cleanup temp files"
log ""
log " Xem crontab: crontab -u ${CRON_USER} -l"
log "═══════════════════════════════════════════════════════════"

exit 0
