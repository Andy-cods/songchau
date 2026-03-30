#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Song Châu ERP — Cấu hình Log Rotation
# VPS: 103.56.158.129 (Ubuntu 24.04)
#
# Xoay vòng log của Docker containers và ứng dụng ERP:
#   - Docker JSON logs: daily, 14 bản, compress
#   - App logs (/opt/erp/data/logs): daily, 30 bản, compress
#   - Nginx access/error logs: daily, 14 bản, compress
#
# Sử dụng: sudo ./scripts/setup_logrotate.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

LOG_DIR="/opt/erp/data/logs"
LOG_FILE="${LOG_DIR}/setup_logrotate.log"

log()     { local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"; echo -e "${CYAN}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
success() { local msg="[$(date '+%Y-%m-%d %H:%M:%S')] OK  $*"; echo -e "${GREEN}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
warn()    { local msg="[$(date '+%Y-%m-%d %H:%M:%S')] WARN $*"; echo -e "${YELLOW}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
error()   { local msg="[$(date '+%Y-%m-%d %H:%M:%S')] ERR $*"; echo -e "${RED}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
header()  { echo -e "\n${BOLD}${BLUE}══════════════════════════════════════${NC}"; echo -e "${BOLD}${BLUE}  $*${NC}"; echo -e "${BOLD}${BLUE}══════════════════════════════════════${NC}\n"; }

mkdir -p "${LOG_DIR}"

header "Song Châu ERP — Log Rotation Setup"

if [[ $EUID -ne 0 ]]; then
    error "Cần quyền root. Chạy: sudo $0"
    exit 1
fi

# ── Kiểm tra logrotate đã được cài đặt chưa ─────────────────────
if ! command -v logrotate &>/dev/null; then
    log "Cài đặt logrotate..."
    apt-get update -qq && apt-get install -y -qq logrotate
    success "logrotate đã được cài đặt"
else
    success "logrotate đã có sẵn: $(logrotate --version | head -1)"
fi

# ── 1. Cấu hình logrotate cho Docker container logs ──────────────
header "Bước 1: Docker Container Logs"
log "Tạo /etc/logrotate.d/docker-containers..."

cat > /etc/logrotate.d/docker-containers << 'ROTATEEOF'
# Song Châu ERP — Docker Container Log Rotation
# File log Docker nằm tại /var/lib/docker/containers/<id>/<id>-json.log
# Xoay vòng: hàng ngày, giữ 14 bản, nén gzip

/var/lib/docker/containers/*/*.log {
    # Xoay hàng ngày
    daily

    # Giữ 14 bản (2 tuần)
    rotate 14

    # Nén file cũ bằng gzip
    compress

    # Không nén file vừa xoay (để dễ đọc nếu cần debug ngay)
    delaycompress

    # Không báo lỗi nếu file không tồn tại
    missingok

    # Không xoay nếu file rỗng
    notifempty

    # Chia sẻ signal với nhiều file cùng lúc (hiệu quả hơn)
    sharedscripts

    # Sao chép và truncate (an toàn với Docker vì Docker giữ file handle)
    copytruncate

    # Giới hạn kích thước: xoay nếu file > 100MB (dù chưa đến ngày)
    maxsize 100M

    postrotate
        # Sau khi xoay, reload Docker daemon để nhận file log mới
        # (không cần thiết với copytruncate nhưng đảm bảo an toàn)
        /bin/true
    endscript
}
ROTATEEOF

success "Docker log rotation config đã tạo"

# ── 2. Cấu hình logrotate cho application logs ───────────────────
header "Bước 2: Application Logs (/opt/erp/data/logs)"
log "Tạo /etc/logrotate.d/songchau-erp-app..."

mkdir -p /opt/erp/data/logs

cat > /etc/logrotate.d/songchau-erp-app << 'APPROTATEOF'
# Song Châu ERP — Application Log Rotation
# Logs ứng dụng tại /opt/erp/data/logs/
# Xoay vòng: hàng ngày, giữ 30 bản, nén gzip

/opt/erp/data/logs/*.log {
    # Xoay hàng ngày
    daily

    # Giữ 30 bản (1 tháng)
    rotate 30

    # Nén file cũ
    compress
    delaycompress

    # Không báo lỗi nếu file không tồn tại
    missingok

    # Không xoay nếu rỗng
    notifempty

    # Tạo file mới sau khi xoay
    create 0640 root root

    # Dùng ngày trong tên file xoay: health.log.2025-01-15
    dateext
    dateformat -%Y-%m-%d

    sharedscripts

    # Kích thước tối đa 50MB per file
    maxsize 50M

    postrotate
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Log rotation thực hiện" >> /opt/erp/data/logs/logrotate_audit.log
    endscript
}

# Backup logs giữ lâu hơn (90 ngày)
/opt/erp/data/logs/backup_*.log {
    daily
    rotate 90
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
    dateext
    dateformat -%Y-%m-%d
}
APPROTATEOF

success "Application log rotation config đã tạo"

# ── 3. Cấu hình logrotate cho Nginx logs (trong container) ───────
header "Bước 3: Nginx Container Logs"
log "Tạo /etc/logrotate.d/songchau-nginx..."

cat > /etc/logrotate.d/songchau-nginx << 'NGINXROTATEEOF'
# Song Châu ERP — Nginx Log Rotation
# Nginx chạy trong Docker, log qua Docker JSON log driver.
# Config này xử lý nếu có volume mount cho nginx logs.

/opt/erp/nginx/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data adm
    sharedscripts
    dateext
    dateformat -%Y-%m-%d
    maxsize 100M

    postrotate
        # Gửi signal USR1 để nginx reopen log files
        docker exec sc-nginx nginx -s reopen 2>/dev/null || /bin/true
    endscript
}
NGINXROTATEEOF

success "Nginx log rotation config đã tạo"

# ── 4. Cấu hình Docker daemon để giới hạn log từ đầu ─────────────
header "Bước 4: Cấu hình Docker Daemon Log Driver"
DOCKER_DAEMON_FILE="/etc/docker/daemon.json"

if [[ -f "${DOCKER_DAEMON_FILE}" ]]; then
    log "Kiểm tra cấu hình Docker daemon hiện tại..."
    if grep -q '"log-driver"' "${DOCKER_DAEMON_FILE}"; then
        warn "Docker daemon đã có log driver config. Kiểm tra ${DOCKER_DAEMON_FILE} thủ công."
    else
        warn "Docker daemon.json tồn tại nhưng chưa có log-driver. Backup và cập nhật..."
        cp "${DOCKER_DAEMON_FILE}" "${DOCKER_DAEMON_FILE}.backup.$(date +%Y%m%d)"
        # Merge JSON - đơn giản hóa: thêm log config
        log "Vui lòng thêm thủ công vào ${DOCKER_DAEMON_FILE}:"
        echo '  "log-driver": "json-file",'
        echo '  "log-opts": { "max-size": "10m", "max-file": "3" }'
    fi
else
    log "Tạo /etc/docker/daemon.json với log driver config..."
    mkdir -p /etc/docker
    cat > "${DOCKER_DAEMON_FILE}" << 'DAEMONEOF'
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "3"
    },
    "storage-driver": "overlay2"
}
DAEMONEOF
    success "Docker daemon.json đã được tạo"
    warn "Cần restart Docker để áp dụng: systemctl restart docker"
    warn "LƯU Y: Restart Docker sẽ dừng TẤT CA containers!"
fi

# ── 5. Test cấu hình logrotate ────────────────────────────────────
header "Bước 5: Kiểm tra cấu hình"
log "Chạy logrotate --debug để kiểm tra syntax..."

if logrotate --debug /etc/logrotate.d/docker-containers 2>&1 | grep -q "error"; then
    error "Lỗi trong config docker-containers"
else
    success "docker-containers config OK"
fi

if logrotate --debug /etc/logrotate.d/songchau-erp-app 2>&1 | grep -q "error"; then
    error "Lỗi trong config songchau-erp-app"
else
    success "songchau-erp-app config OK"
fi

# ── 6. Kiểm tra cron logrotate ─────────────────────────────────────
header "Bước 6: Kiểm tra cron"
if [[ -f /etc/cron.daily/logrotate ]]; then
    success "logrotate cron daily đã tồn tại: /etc/cron.daily/logrotate"
else
    warn "Không tìm thấy /etc/cron.daily/logrotate"
    log "Tạo cron job thủ công..."
    echo "0 3 * * * root /usr/sbin/logrotate /etc/logrotate.conf --state /var/lib/logrotate/status" \
        > /etc/cron.d/logrotate-songchau
    success "Cron job tạo tại /etc/cron.d/logrotate-songchau (chạy 03:00 hàng ngày)"
fi

# ── Tóm tắt ──────────────────────────────────────────────────────
header "Setup hoàn thành!"
echo -e "${GREEN}Log rotation đã được cấu hình:${NC}"
echo -e "  /etc/logrotate.d/docker-containers   — Docker logs, 14 ngày, gzip"
echo -e "  /etc/logrotate.d/songchau-erp-app    — App logs, 30 ngày, gzip"
echo -e "  /etc/logrotate.d/songchau-nginx      — Nginx logs, 14 ngày, gzip"
echo -e "  /etc/docker/daemon.json              — Docker log driver (max 10m x 3)"
echo ""
echo -e "${YELLOW}Lệnh hữu ích:${NC}"
echo -e "  logrotate -f /etc/logrotate.d/docker-containers   # Force rotate ngay"
echo -e "  logrotate --debug /etc/logrotate.d/songchau-erp-app  # Kiểm tra"
echo -e "  cat /var/lib/logrotate/status                     # Xem trạng thái"
echo ""
success "Log: ${LOG_FILE}"
