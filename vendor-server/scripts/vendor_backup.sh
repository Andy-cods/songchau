#!/usr/bin/env bash
# ============================================================================
# vendor_backup.sh — Backup 4 nhóm STATEFUL của server VENDOR (45.124.95.32)
# về kho backup trên MAIN qua sshfs. Chạy hàng tuần (thứ 2, 04:00) bởi cron.
#
# 4 NHÓM (mất chúng = phải dựng lại cổng NCC từ đầu):
#   1) /etc/letsencrypt                          — cert TLS vendor.songchau.vn
#   2) /opt/vendor/vendor-server/.env            — SECRET_KEY/JWT (token NCC hợp
#      lệ chéo 2 máy), M365, POSTGRES_PASSWORD... (LƯU Ý: .env nằm ở
#      vendor-server/.env, KHÔNG phải /opt/vendor/.env như spec gốc — đã verify)
#   3) systemd units: vendor-tunnel.service + erp-data.service + erp-data.service.d
#      (tunnel DB/Redis + sshfs mount + drop-in self-heal V-05)
#   4) /root/.ssh                                — id_tunnel (khoá kết nối MAIN)
#
# ĐÍCH: /mnt/erp-data/backups (sshfs). TOPOLOGY: sshfs mount old:/data -> file
# thật nằm ở MAIN tại /data/backups/vendor-conf-YYYYMMDD.tar.gz (persistent,
# ngoài đĩa vendor -> sống sót nếu mất hẳn server vendor).
#
# umask 077: archive chứa SSH KEY + .env (secret) -> chỉ root đọc (0600).
# date TRONG script (không trên dòng crontab) -> cron không chứa ký tự '%'.
# Nếu sshfs rớt (đích không ghi được) -> tar fail -> emit 1 dòng FAIL vào
# /opt/vendor/logs/alerts.log (local; nếu sshfs rớt thì mirror sang MAIN cũng
# không tới được — V-11 vendor-tunnel/vendor-data-mount sẽ cảnh báo song song).
# ============================================================================
set -u
umask 077

LOG_DIR="/opt/vendor/logs"
ALERT_LOG="${LOG_DIR}/alerts.log"
BACKUP_DIR="/mnt/erp-data/backups"
RETENTION_DAYS=60

# 4 nhóm stateful cần backup (đường dẫn ĐÃ verify tồn tại trên server vendor).
SRC_PATHS=(
    "/etc/letsencrypt"
    "/opt/vendor/vendor-server/.env"
    "/etc/systemd/system/vendor-tunnel.service"
    "/etc/systemd/system/erp-data.service"
    "/etc/systemd/system/erp-data.service.d"
    "/root/.ssh"
)

ts_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

emit() {
    local sev="$1" check="$2" detail="$3" line
    line="$(printf '%s %s %s %s' "$(ts_iso)" "${sev}" "${check}" "${detail}")"
    mkdir -p "${LOG_DIR}" 2>/dev/null || true
    if ! printf '%s\n' "${line}" >> "${ALERT_LOG}" 2>/dev/null; then
        echo "[alerts.log-fail] ${line}" >&2
    fi
}

main() {
    local ts out
    ts="$(date +%Y%m%d)"
    out="${BACKUP_DIR}/vendor-conf-${ts}.tar.gz"

    # Đích phải ghi được (sshfs còn sống). Đây là guard chính cho case "sshfs rớt".
    if [[ ! -d "${BACKUP_DIR}" ]]; then
        emit "FAIL" "vendor-backup" "dich ${BACKUP_DIR} khong ton tai/khong doc duoc -> sshfs erp-data co the da rot"
        return 1
    fi

    # tar 4 nhóm. tar strip leading '/' (member -> etc/letsencrypt/...) + 2>/dev/null
    # nuốt cảnh báo "Removing leading /". Lỗi 1 file lẻ không làm hỏng cả archive.
    tar -czf "${out}" "${SRC_PATHS[@]}" 2>/dev/null
    local rc=$?

    # Xác nhận archive thật sự tạo được & không rỗng (sshfs có thể rớt GIỮA CHỪNG).
    if [[ ! -s "${out}" ]]; then
        emit "FAIL" "vendor-backup" "tar that bai / archive rong (rc=${rc}) file=${out} -> kiem tra sshfs"
        return 1
    fi

    # Retention: xoá vendor-conf-*.tar.gz > 60 ngày (namespace riêng, không đụng
    # daily_*.dump của cron MAIN nếu vô tình cùng thư mục).
    find "${BACKUP_DIR}" -maxdepth 1 -name 'vendor-conf-*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null

    # Thành công: IM LẶNG (không spam kênh cảnh báo). Bằng chứng size ghi vào
    # cron_backup.log qua stdout để tiện tra cứu khi cần.
    local size
    size="$(du -h "${out}" 2>/dev/null | cut -f1)"
    echo "$(ts_iso) OK vendor-backup ${out} size=${size:-?}"
    return 0
}

main "$@"
