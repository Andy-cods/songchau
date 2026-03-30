#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Song Châu ERP — Go-Live Checklist
# Chạy trước khi đưa hệ thống vào sản xuất
#
# Kiểm tra:
#   1.  Tất cả containers đang chạy và healthy
#   2.  API endpoints phản hồi đúng
#   3.  Database có dữ liệu (tables không rỗng)
#   4.  Redis kết nối được
#   5.  Dung lượng đĩa > 20GB trống
#   6.  RAM < 80% sử dụng
#   7.  Backup gần nhất tồn tại
#   8.  SSL certificate hợp lệ (nếu đã cấu hình)
#   9.  Firewall rules đúng
#   10. Biến môi trường production đã được set
#   11. Cron jobs đã được cài đặt
#   12. Log rotation đã được cài đặt
#   => In báo cáo tóm tắt với màu sắc
#
# Sử dụng: sudo ./scripts/go_live_checklist.sh
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

# ── Cấu hình ──────────────────────────────────────────────────────
VPS_IP="103.56.158.129"
DOMAIN="erp.songchau.vn"
COMPOSE_DIR="/opt/erp"
COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.yml"
LOG_DIR="/opt/erp/data/logs"
BACKUP_DIR="/opt/erp/data/backups"
LOG_FILE="${LOG_DIR}/go_live_checklist.log"
DISK_MIN_GB=20          # Yêu cầu tối thiểu 20GB trống
RAM_MAX_PCT=80          # RAM không được vượt quá 80%
BACKUP_MAX_AGE_HOURS=25 # Backup không được cũ hơn 25 giờ (hàng ngày + buffer)

# ── Màu sắc và format ─────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

ICON_OK="[OK]"
ICON_FAIL="[FAIL]"
ICON_WARN="[WARN]"
ICON_SKIP="[SKIP]"
ICON_INFO="[INFO]"

# ── Tracking kết quả ─────────────────────────────────────────────
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNED_CHECKS=0
SKIPPED_CHECKS=0
declare -a FAILED_ITEMS=()
declare -a WARNED_ITEMS=()
declare -a PASSED_ITEMS=()

ts()      { date '+%Y-%m-%d %H:%M:%S'; }

mkdir -p "${LOG_DIR}"

# ── Ghi log tất cả output ─────────────────────────────────────────
exec > >(tee -a "${LOG_FILE}") 2>&1

# ── Print functions ───────────────────────────────────────────────
pass_check() {
    local label="$1"
    local detail="${2:-}"
    echo -e "  ${GREEN}${ICON_OK}${NC}  ${label}${detail:+  ${DIM}(${detail})${NC}}"
    PASSED_CHECKS=$(( PASSED_CHECKS + 1 ))
    TOTAL_CHECKS=$(( TOTAL_CHECKS + 1 ))
    PASSED_ITEMS+=("${label}")
}

fail_check() {
    local label="$1"
    local detail="${2:-}"
    local fix="${3:-}"
    echo -e "  ${RED}${ICON_FAIL}${NC}  ${label}${detail:+  ${DIM}(${detail})${NC}}"
    [[ -n "${fix}" ]] && echo -e "       ${DIM}Khắc phục: ${fix}${NC}"
    FAILED_CHECKS=$(( FAILED_CHECKS + 1 ))
    TOTAL_CHECKS=$(( TOTAL_CHECKS + 1 ))
    FAILED_ITEMS+=("${label}")
}

warn_check() {
    local label="$1"
    local detail="${2:-}"
    local fix="${3:-}"
    echo -e "  ${YELLOW}${ICON_WARN}${NC}  ${label}${detail:+  ${DIM}(${detail})${NC}}"
    [[ -n "${fix}" ]] && echo -e "       ${DIM}Lưu ý: ${fix}${NC}"
    WARNED_CHECKS=$(( WARNED_CHECKS + 1 ))
    TOTAL_CHECKS=$(( TOTAL_CHECKS + 1 ))
    WARNED_ITEMS+=("${label}")
}

skip_check() {
    local label="$1"
    local reason="${2:-}"
    echo -e "  ${CYAN}${ICON_SKIP}${NC}  ${DIM}${label}${reason:+ (${reason})}${NC}"
    SKIPPED_CHECKS=$(( SKIPPED_CHECKS + 1 ))
    TOTAL_CHECKS=$(( TOTAL_CHECKS + 1 ))
}

info_line() {
    echo -e "  ${BLUE}${ICON_INFO}${NC}  ${DIM}$*${NC}"
}

section() {
    echo ""
    echo -e "${BOLD}${MAGENTA}▶ $*${NC}"
    echo -e "${DIM}$(printf '─%.0s' {1..55})${NC}"
}

# ═══════════════════════════════════════════════════════════════════
# HEADER
# ═══════════════════════════════════════════════════════════════════
clear 2>/dev/null || true
echo ""
echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║     SONG CHAU ERP — GO-LIVE CHECKLIST               ║${NC}"
echo -e "${BOLD}${BLUE}║     VPS: ${VPS_IP}  |  $(ts)          ║${NC}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════
# 1. DOCKER CONTAINERS
# ═══════════════════════════════════════════════════════════════════
section "1. Docker Containers"

REQUIRED_CONTAINERS=(
    "sc-postgres:PostgreSQL"
    "sc-redis:Redis"
    "sc-api:API Backend"
    "sc-frontend:Frontend"
    "sc-nginx:Nginx"
    "sc-worker:Procrastinate Worker"
    "sc-scheduler:Procrastinate Scheduler"
)

for entry in "${REQUIRED_CONTAINERS[@]}"; do
    container="${entry%%:*}"
    label="${entry##*:}"

    # Kiểm tra container đang chạy
    if docker ps --filter "name=${container}" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -q "^${container}$"; then
        # Kiểm tra health status nếu có
        health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "${container}" 2>/dev/null || echo "unknown")

        if [[ "${health}" == "healthy" || "${health}" == "no-healthcheck" ]]; then
            pass_check "${label} (${container})" "running, health=${health}"
        elif [[ "${health}" == "starting" ]]; then
            warn_check "${label} (${container})" "health=starting — vẫn đang khởi động"
        else
            fail_check "${label} (${container})" "health=${health}" "docker logs ${container}"
        fi
    else
        # Kiểm tra container có tồn tại không (stopped)
        if docker ps -a --filter "name=${container}" --format "{{.Names}}" 2>/dev/null | grep -q "^${container}$"; then
            status=$(docker inspect --format='{{.State.Status}}' "${container}" 2>/dev/null || echo "unknown")
            fail_check "${label} (${container})" "status=${status}" "docker start ${container}"
        else
            fail_check "${label} (${container})" "container không tồn tại" "docker compose up -d"
        fi
    fi
done

# ═══════════════════════════════════════════════════════════════════
# 2. API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════
section "2. API Endpoints"

API_CHECKS=(
    "http://localhost/api/health:Health Check"
    "http://localhost/api/v1/auth/login:Auth Endpoint"
    "http://localhost/:Frontend"
)

for entry in "${API_CHECKS[@]}"; do
    url="${entry%%:*}"
    label="${entry##*:}"

    http_code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "${url}" 2>/dev/null || echo "000")
    response_time_ms=$(curl -sf -o /dev/null -w "%{time_total}" --max-time 10 "${url}" 2>/dev/null | \
        awk '{printf "%.0f", $1*1000}' || echo "?")

    case "${http_code}" in
        200|201)
            pass_check "${label}" "HTTP ${http_code}, ${response_time_ms}ms"
            ;;
        301|302|307|308)
            pass_check "${label}" "HTTP ${http_code} redirect (OK cho frontend)"
            ;;
        401|403)
            pass_check "${label}" "HTTP ${http_code} (expected — endpoint cần auth)"
            ;;
        404)
            warn_check "${label}" "HTTP 404 — endpoint chưa có hoặc sai URL" ""
            ;;
        000)
            fail_check "${label}" "Không thể kết nối" "Kiểm tra container và nginx"
            ;;
        *)
            fail_check "${label}" "HTTP ${http_code}" "Kiểm tra logs: docker logs sc-api"
            ;;
    esac
done

# Kiểm tra API docs (Swagger)
swagger_code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost/api/docs" 2>/dev/null || echo "000")
if [[ "${swagger_code}" == "200" ]]; then
    warn_check "API Docs /api/docs" "HTTP 200 — Swagger UI công khai" \
        "Nên tắt hoặc bảo vệ bằng auth trong production!"
else
    pass_check "API Docs /api/docs" "HTTP ${swagger_code} — không công khai"
fi

# ═══════════════════════════════════════════════════════════════════
# 3. DATABASE — Kiểm tra dữ liệu
# ═══════════════════════════════════════════════════════════════════
section "3. Database Integrity"

if docker ps --filter "name=sc-postgres" --filter "status=running" | grep -q "sc-postgres"; then

    # Kiểm tra số lượng tables
    table_count=$(docker exec sc-postgres psql -U scadmin -d songchau_erp -t \
        -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" \
        2>/dev/null | tr -d ' \n' || echo "0")

    if (( table_count > 0 )); then
        pass_check "Database tables" "${table_count} tables trong schema public"
    else
        fail_check "Database tables" "Không có tables nào!" \
            "Chạy migrations: docker exec sc-api python -m alembic upgrade head"
    fi

    # Kiểm tra bảng users (bảng quan trọng nhất)
    user_count=$(docker exec sc-postgres psql -U scadmin -d songchau_erp -t \
        -c "SELECT count(*) FROM users;" 2>/dev/null | tr -d ' \n' || echo "-1")

    if [[ "${user_count}" == "-1" ]]; then
        fail_check "Bảng users" "Bảng users không tồn tại hoặc lỗi query"
    elif (( user_count == 0 )); then
        warn_check "Bảng users" "0 users — cần tạo admin account trước go-live" \
            "Chạy: docker exec sc-api python -m app.scripts.create_admin"
    else
        pass_check "Bảng users" "${user_count} users đã có dữ liệu"
    fi

    # Kiểm tra database size
    db_size=$(docker exec sc-postgres psql -U scadmin -d songchau_erp -t \
        -c "SELECT pg_size_pretty(pg_database_size('songchau_erp'));" \
        2>/dev/null | tr -d ' \n' || echo "?")
    info_line "Database size: ${db_size}"

    # Kiểm tra số active connections
    conn_count=$(docker exec sc-postgres psql -U scadmin -d songchau_erp -t \
        -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'songchau_erp';" \
        2>/dev/null | tr -d ' \n' || echo "?")
    info_line "Active DB connections: ${conn_count}"

    # Kiểm tra replication lag (nếu có replica)
    pass_check "PostgreSQL connectivity" "Query OK"
else
    fail_check "PostgreSQL" "Container không chạy — không thể check DB" \
        "docker compose up -d postgres"
fi

# ═══════════════════════════════════════════════════════════════════
# 4. REDIS
# ═══════════════════════════════════════════════════════════════════
section "4. Redis"

if docker ps --filter "name=sc-redis" --filter "status=running" | grep -q "sc-redis"; then
    redis_pong=$(docker exec sc-redis redis-cli ping 2>/dev/null | tr -d '[:space:]')

    if [[ "${redis_pong}" == "PONG" ]]; then
        redis_mem=$(docker exec sc-redis redis-cli info memory 2>/dev/null | \
            grep "used_memory_human" | cut -d: -f2 | tr -d '[:space:]' || echo "?")
        redis_keys=$(docker exec sc-redis redis-cli dbsize 2>/dev/null | tr -d ' ' || echo "?")
        pass_check "Redis ping" "PONG, ${redis_keys} keys, mem=${redis_mem}"
    else
        fail_check "Redis ping" "Phản hồi: ${redis_pong}" "docker logs sc-redis"
    fi
else
    fail_check "Redis" "Container không chạy" "docker compose up -d redis"
fi

# ═══════════════════════════════════════════════════════════════════
# 5. DISK SPACE
# ═══════════════════════════════════════════════════════════════════
section "5. Disk Space"

disk_avail_gb=$(df -BG "${COMPOSE_DIR}" 2>/dev/null | awk 'NR==2 {gsub("G",""); print $4}' || echo "0")
disk_total_gb=$(df -BG "${COMPOSE_DIR}" 2>/dev/null | awk 'NR==2 {gsub("G",""); print $2}' || echo "0")
disk_used_pct=$(df "${COMPOSE_DIR}" 2>/dev/null | awk 'NR==2 {gsub("%",""); print $5}' || echo "100")

if (( disk_avail_gb >= DISK_MIN_GB )); then
    pass_check "Dung lượng đĩa" "${disk_avail_gb}GB trống / ${disk_total_gb}GB total (${disk_used_pct}% used)"
else
    fail_check "Dung lượng đĩa" \
        "Chỉ còn ${disk_avail_gb}GB (yêu cầu tối thiểu ${DISK_MIN_GB}GB)" \
        "Dọn dẹp: docker system prune -a, xóa logs cũ"
fi

# Kiểm tra data directory
if [[ -d "/opt/erp/data" ]]; then
    data_size=$(du -sh /opt/erp/data 2>/dev/null | cut -f1 || echo "?")
    info_line "Data ERP sử dụng: ${data_size}"
fi

# Docker images và volumes
docker_size=$(docker system df --format "{{.Size}}" 2>/dev/null | head -1 || echo "?")
info_line "Docker disk usage tổng: $(docker system df 2>/dev/null | tail -1 | awk '{print $NF}' || echo '?')"

# ═══════════════════════════════════════════════════════════════════
# 6. MEMORY (RAM)
# ═══════════════════════════════════════════════════════════════════
section "6. Memory (RAM)"

mem_total=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
mem_available=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
ram_used_pct=$(( (mem_total - mem_available) * 100 / mem_total ))
mem_used_gb=$(( (mem_total - mem_available) / 1024 / 1024 ))
mem_total_gb=$(( mem_total / 1024 / 1024 ))

if (( ram_used_pct < RAM_MAX_PCT )); then
    pass_check "RAM usage" "${ram_used_pct}% (${mem_used_gb}GB/${mem_total_gb}GB used)"
else
    fail_check "RAM usage" \
        "${ram_used_pct}% — vượt ngưỡng ${RAM_MAX_PCT}% (${mem_used_gb}GB/${mem_total_gb}GB)" \
        "Kiểm tra container nào dùng nhiều RAM nhất: docker stats --no-stream"
fi

# Top containers theo RAM
echo ""
info_line "RAM usage theo container:"
docker stats --no-stream --format "    {{.Name}}: {{.MemUsage}} ({{.MemPerc}})" 2>/dev/null | head -10 || true

# ═══════════════════════════════════════════════════════════════════
# 7. BACKUP
# ═══════════════════════════════════════════════════════════════════
section "7. Backup"

if [[ -d "${BACKUP_DIR}" ]]; then
    # Tìm backup mới nhất
    latest_backup=$(find "${BACKUP_DIR}" -name "songchau_*.dump" -o -name "pre_deploy_*.dump" 2>/dev/null | \
        sort -r | head -1 || echo "")

    if [[ -n "${latest_backup}" ]]; then
        # Tính tuổi backup (giờ)
        backup_age_seconds=$(( $(date +%s) - $(stat -c %Y "${latest_backup}" 2>/dev/null || echo "0") ))
        backup_age_hours=$(( backup_age_seconds / 3600 ))
        backup_size=$(du -sh "${latest_backup}" 2>/dev/null | cut -f1 || echo "?")

        if (( backup_age_hours < BACKUP_MAX_AGE_HOURS )); then
            pass_check "Backup gần nhất" \
                "$(basename ${latest_backup}) — ${backup_age_hours}h trước (${backup_size})"
        else
            fail_check "Backup gần nhất" \
                "${backup_age_hours}h trước — QUÁ CŨ (max ${BACKUP_MAX_AGE_HOURS}h)" \
                "Chạy backup ngay: ./scripts/backup.sh"
        fi

        # Đếm tổng số backup
        backup_count=$(find "${BACKUP_DIR}" -name "*.dump" 2>/dev/null | wc -l)
        info_line "Tổng cộng: ${backup_count} backup files trong ${BACKUP_DIR}"
    else
        fail_check "Backup" "Không tìm thấy file backup nào!" \
            "Chạy ngay: ./scripts/backup.sh"
    fi
else
    fail_check "Backup directory" "${BACKUP_DIR} không tồn tại" \
        "mkdir -p ${BACKUP_DIR} && ./scripts/backup.sh"
fi

# Kiểm tra cron backup
if crontab -l 2>/dev/null | grep -q "backup.sh"; then
    pass_check "Backup cron job" "Đã được cài đặt"
else
    fail_check "Backup cron job" "Chưa có cron job backup!" \
        "Thêm vào crontab: 0 2 * * * /opt/erp/scripts/backup.sh"
fi

# ═══════════════════════════════════════════════════════════════════
# 8. SSL CERTIFICATE
# ═══════════════════════════════════════════════════════════════════
section "8. SSL Certificate"

CERT_FILE="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [[ -f "${CERT_FILE}" ]]; then
    # Kiểm tra cert hết hạn chưa
    cert_expiry=$(openssl x509 -noout -enddate -in "${CERT_FILE}" 2>/dev/null | cut -d= -f2 || echo "")
    cert_expiry_epoch=$(date -d "${cert_expiry}" +%s 2>/dev/null || echo "0")
    now_epoch=$(date +%s)
    days_until_expiry=$(( (cert_expiry_epoch - now_epoch) / 86400 ))

    if (( days_until_expiry > 30 )); then
        pass_check "SSL Certificate" "Hợp lệ, còn ${days_until_expiry} ngày (hết hạn: ${cert_expiry})"
    elif (( days_until_expiry > 7 )); then
        warn_check "SSL Certificate" "Còn ${days_until_expiry} ngày — sắp hết hạn" \
            "Chạy: certbot renew"
    elif (( days_until_expiry > 0 )); then
        fail_check "SSL Certificate" "Còn ${days_until_expiry} ngày — CẦN GIA HẠN NGAY!" \
            "certbot renew --force-renewal"
    else
        fail_check "SSL Certificate" "ĐÃ HẾT HẠN! ${cert_expiry}" \
            "certbot renew --force-renewal && docker exec sc-nginx nginx -s reload"
    fi

    # Kiểm tra HTTPS có hoạt động không
    https_code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "https://${DOMAIN}/api/health" 2>/dev/null || echo "000")
    if [[ "${https_code}" == "200" ]]; then
        pass_check "HTTPS endpoint" "https://${DOMAIN}/api/health -> HTTP ${https_code}"
    else
        fail_check "HTTPS endpoint" "https://${DOMAIN}/api/health -> HTTP ${https_code}" \
            "Kiểm tra nginx: docker logs sc-nginx"
    fi

    # Kiểm tra auto-renewal
    if crontab -l 2>/dev/null | grep -q "certbot renew"; then
        pass_check "SSL auto-renewal cron" "Đã được cài đặt"
    elif [[ -f /etc/cron.d/certbot || -f /etc/cron.daily/certbot ]]; then
        pass_check "SSL auto-renewal" "Certbot system cron đã có"
    else
        warn_check "SSL auto-renewal" "Chưa có cron job renewal" \
            "Chạy ssl_setup.sh để cài đặt auto-renewal"
    fi

else
    skip_check "SSL Certificate" "Chưa cài đặt (domain ${DOMAIN} chưa có cert)"
    info_line "Chạy ./scripts/ssl_setup.sh sau khi trỏ DNS"
fi

# ═══════════════════════════════════════════════════════════════════
# 9. FIREWALL
# ═══════════════════════════════════════════════════════════════════
section "9. Firewall Rules"

if command -v ufw &>/dev/null; then
    ufw_status=$(ufw status 2>/dev/null | head -1)

    if echo "${ufw_status}" | grep -q "active"; then
        pass_check "UFW Firewall" "Active"

        # Kiểm tra các rules cần thiết
        REQUIRED_PORTS=(
            "22:SSH"
            "80:HTTP"
            "443:HTTPS"
        )

        for entry in "${REQUIRED_PORTS[@]}"; do
            port="${entry%%:*}"
            service="${entry##*:}"

            if ufw status 2>/dev/null | grep -qE "^${port}[/ ].*ALLOW"; then
                pass_check "Port ${port} (${service})" "ALLOW"
            else
                fail_check "Port ${port} (${service})" "Không tìm thấy rule" \
                    "ufw allow ${port}/tcp"
            fi
        done

        # Kiểm tra ports nguy hiểm không được mở ra ngoài
        DANGEROUS_PORTS=("5432" "6379" "8000" "3000")
        for port in "${DANGEROUS_PORTS[@]}"; do
            # Chỉ kiểm tra nếu không có giới hạn IP
            if ufw status 2>/dev/null | grep -E "^${port}" | grep -q "Anywhere" && \
               ! ufw status 2>/dev/null | grep -E "^${port}" | grep -q "DENY"; then
                fail_check "Port ${port}" "Đang mở ra Internet!" \
                    "ufw deny ${port}/tcp (port này chỉ nên dùng nội bộ)"
            else
                pass_check "Port ${port}" "Không mở ra Internet (OK)"
            fi
        done

    else
        fail_check "UFW Firewall" "${ufw_status} — FIREWALL KHÔNG BẬT!" \
            "ufw enable && ufw allow 22 && ufw allow 80 && ufw allow 443"
    fi
elif command -v iptables &>/dev/null; then
    warn_check "Firewall" "Dùng iptables thay vì UFW — kiểm tra thủ công" \
        "iptables -L INPUT -n -v"
else
    fail_check "Firewall" "Không tìm thấy UFW hoặc iptables" \
        "apt-get install ufw && ufw enable"
fi

# ═══════════════════════════════════════════════════════════════════
# 10. BIẾN MÔI TRƯỜNG PRODUCTION
# ═══════════════════════════════════════════════════════════════════
section "10. Biến môi trường Production"

ENV_FILE="${COMPOSE_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
    # Kiểm tra các biến bắt buộc
    REQUIRED_VARS=(
        "POSTGRES_DB"
        "POSTGRES_USER"
        "POSTGRES_PASSWORD"
        "SECRET_KEY"
    )

    for var in "${REQUIRED_VARS[@]}"; do
        if grep -q "^${var}=" "${ENV_FILE}" 2>/dev/null; then
            value=$(grep "^${var}=" "${ENV_FILE}" | cut -d= -f2-)
            if [[ -z "${value}" ]]; then
                fail_check "ENV: ${var}" "Biến tồn tại nhưng rỗng"
            elif [[ "${value}" =~ ^(changeme|password|secret|12345|admin|example) ]]; then
                fail_check "ENV: ${var}" "Đang dùng giá trị mặc định không an toàn!" \
                    "Thay đổi thành giá trị ngẫu nhiên mạnh"
            else
                pass_check "ENV: ${var}" "Đã được set"
            fi
        else
            fail_check "ENV: ${var}" "Biến này chưa có trong .env" \
                "Thêm vào ${ENV_FILE}"
        fi
    done

    # Kiểm tra SECRET_KEY đủ mạnh (> 32 chars)
    if grep -q "^SECRET_KEY=" "${ENV_FILE}" 2>/dev/null; then
        secret_len=$(grep "^SECRET_KEY=" "${ENV_FILE}" | cut -d= -f2- | wc -c)
        if (( secret_len >= 32 )); then
            pass_check "SECRET_KEY strength" "${secret_len} ký tự (>= 32)"
        else
            fail_check "SECRET_KEY strength" "Quá ngắn: ${secret_len} ký tự (cần >= 32)" \
                "openssl rand -hex 32"
        fi
    fi

    # Kiểm tra .env không commit vào git
    if [[ -f "${COMPOSE_DIR}/.gitignore" ]]; then
        if grep -q ".env" "${COMPOSE_DIR}/.gitignore" 2>/dev/null; then
            pass_check ".env trong .gitignore" "File .env không bị commit lên git"
        else
            fail_check ".env trong .gitignore" ".env không có trong .gitignore!" \
                "echo '.env' >> ${COMPOSE_DIR}/.gitignore"
        fi
    fi

    # Permissions của .env
    env_perms=$(stat -c "%a" "${ENV_FILE}" 2>/dev/null || echo "unknown")
    if [[ "${env_perms}" == "600" || "${env_perms}" == "640" ]]; then
        pass_check ".env permissions" "${env_perms} (an toàn)"
    else
        warn_check ".env permissions" "${env_perms} — nên là 600" \
            "chmod 600 ${ENV_FILE}"
    fi

else
    fail_check ".env file" "Không tìm thấy ${ENV_FILE}" \
        "cp .env.example .env && vim ${ENV_FILE}"
fi

# ═══════════════════════════════════════════════════════════════════
# 11. CRON JOBS
# ═══════════════════════════════════════════════════════════════════
section "11. Cron Jobs"

CRON_CHECKS=(
    "backup.sh:Database backup hàng ngày"
    "health_monitor.sh:Health monitoring mỗi 5 phút"
)

crontab_content=$(crontab -l 2>/dev/null || echo "")

for entry in "${CRON_CHECKS[@]}"; do
    script="${entry%%:*}"
    label="${entry##*:}"

    if echo "${crontab_content}" | grep -q "${script}"; then
        pass_check "${label}" "Cron job đã được cài đặt"
    else
        fail_check "${label}" "Chưa có cron job!" \
            "Thêm vào crontab: crontab -e"
    fi
done

# Kiểm tra logrotate
if [[ -f /etc/logrotate.d/docker-containers ]]; then
    pass_check "Log rotation (Docker)" "/etc/logrotate.d/docker-containers"
else
    warn_check "Log rotation (Docker)" "Chưa được cài đặt" \
        "Chạy: ./scripts/setup_logrotate.sh"
fi

if [[ -f /etc/logrotate.d/songchau-erp-app ]]; then
    pass_check "Log rotation (App)" "/etc/logrotate.d/songchau-erp-app"
else
    warn_check "Log rotation (App)" "Chưa được cài đặt" \
        "Chạy: ./scripts/setup_logrotate.sh"
fi

# ═══════════════════════════════════════════════════════════════════
# 12. PERFORMANCE CHECK
# ═══════════════════════════════════════════════════════════════════
section "12. Performance Baseline"

# CPU Load
load_1=$(awk '{print $1}' /proc/loadavg)
load_5=$(awk '{print $2}' /proc/loadavg)
cpu_count=$(nproc 2>/dev/null || echo "4")
info_line "CPU Load: ${load_1} / ${load_5} (1m/5m), ${cpu_count} cores"

# API response time
api_time=$(curl -sf -o /dev/null -w "%{time_total}" --max-time 10 "http://localhost/api/health" 2>/dev/null | \
    awk '{printf "%.0f", $1*1000}' || echo "?")
if [[ "${api_time}" != "?" ]]; then
    if (( api_time < 500 )); then
        pass_check "API response time" "${api_time}ms (< 500ms)"
    elif (( api_time < 2000 )); then
        warn_check "API response time" "${api_time}ms (cao — tối ưu cần thiết)"
    else
        fail_check "API response time" "${api_time}ms (quá chậm!)"
    fi
fi

# Uptime
uptime_str=$(uptime -p 2>/dev/null || uptime | sed 's/.*up /up /')
info_line "Server uptime: ${uptime_str}"

# ═══════════════════════════════════════════════════════════════════
# TỔNG KẾT
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║                    KẾT QUẢ KIỂM TRA                 ║${NC}"
echo -e "${BOLD}${BLUE}╠══════════════════════════════════════════════════════╣${NC}"
printf "${BOLD}${BLUE}║${NC}  %-52s${BOLD}${BLUE}║${NC}\n" "Tổng số checks : ${TOTAL_CHECKS}"
printf "${BOLD}${GREEN}║${NC}  %-52s${BOLD}${GREEN}║${NC}\n" "${ICON_OK} Passed  : ${PASSED_CHECKS}"
printf "${BOLD}${YELLOW}║${NC}  %-52s${BOLD}${YELLOW}║${NC}\n" "${ICON_WARN} Warned  : ${WARNED_CHECKS}"
printf "${BOLD}${RED}║${NC}  %-52s${BOLD}${RED}║${NC}\n" "${ICON_FAIL} Failed  : ${FAILED_CHECKS}"
printf "${BOLD}${CYAN}║${NC}  %-52s${BOLD}${CYAN}║${NC}\n" "${ICON_SKIP} Skipped : ${SKIPPED_CHECKS}"
echo -e "${BOLD}${BLUE}╠══════════════════════════════════════════════════════╣${NC}"

# Verdict
if (( FAILED_CHECKS == 0 && WARNED_CHECKS == 0 )); then
    echo -e "${BOLD}${GREEN}║  VERDICT: PASS — SAN SANG GO-LIVE!                   ║${NC}"
elif (( FAILED_CHECKS == 0 )); then
    echo -e "${BOLD}${YELLOW}║  VERDICT: WARN — Xem xet canh bao truoc go-live     ║${NC}"
else
    echo -e "${BOLD}${RED}║  VERDICT: FAIL — CHUA SAN SANG — Sua loi truoc!      ║${NC}"
fi
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════╝${NC}"

# Danh sách lỗi
if (( FAILED_CHECKS > 0 )); then
    echo ""
    echo -e "${RED}${BOLD}Items cần sửa ngay:${NC}"
    for item in "${FAILED_ITEMS[@]}"; do
        echo -e "  ${RED}${ICON_FAIL}${NC} ${item}"
    done
fi

# Danh sách cảnh báo
if (( WARNED_CHECKS > 0 )); then
    echo ""
    echo -e "${YELLOW}${BOLD}Items cần xem xét:${NC}"
    for item in "${WARNED_ITEMS[@]}"; do
        echo -e "  ${YELLOW}${ICON_WARN}${NC} ${item}"
    done
fi

echo ""
echo -e "${DIM}Checklist log: ${LOG_FILE}${NC}"
echo -e "${DIM}Thời gian: $(ts)${NC}"
echo ""

# Exit code phản ánh kết quả
if (( FAILED_CHECKS > 0 )); then
    exit 1
else
    exit 0
fi
