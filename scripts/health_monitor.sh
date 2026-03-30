#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Song Châu ERP — Health Monitor
# Kiểm tra sức khỏe toàn bộ hệ thống mỗi 5 phút (qua cron)
#
# Cron entry (thêm bằng: crontab -e):
#   */5 * * * * /opt/erp/scripts/health_monitor.sh >> /opt/erp/data/logs/health.log 2>&1
#
# Kiểm tra:
#   - API health endpoint (/api/health)
#   - PostgreSQL (container + query)
#   - Redis (container + ping)
#   - Nginx (container + HTTP response)
#   - Worker + Scheduler containers
#   - Dung lượng đĩa (cảnh báo < 5GB, nguy hiểm < 2GB)
#   - RAM usage (cảnh báo > 85%, nguy hiểm > 95%)
#   - CPU load average
#
# Cảnh báo gửi qua: log file + tùy chọn webhook/email
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

# ── Cấu hình ──────────────────────────────────────────────────────
LOG_DIR="/opt/erp/data/logs"
LOG_FILE="${LOG_DIR}/health.log"
ALERT_LOG="${LOG_DIR}/health_alerts.log"
STATUS_FILE="${LOG_DIR}/health_status.json"
API_URL="http://localhost/api/health"
DISK_PATH="/opt/erp"
DISK_WARN_GB=5      # Cảnh báo khi < 5GB
DISK_CRIT_GB=2      # Nguy hiểm khi < 2GB
RAM_WARN_PCT=85     # Cảnh báo khi RAM > 85%
RAM_CRIT_PCT=95     # Nguy hiểm khi RAM > 95%
LOAD_WARN=3.0       # Cảnh báo khi load average 5m > 3.0
ALERT_COOLDOWN=1800 # Không gửi cùng 1 cảnh báo trong 30 phút
ALERT_COOLDOWN_FILE="${LOG_DIR}/.alert_cooldown"

# Webhook URL (tùy chọn - điền vào để nhận cảnh báo)
WEBHOOK_URL="${HEALTH_WEBHOOK_URL:-}"
# Email nhận cảnh báo (cần cài sendmail/ssmtp)
ALERT_EMAIL="${HEALTH_ALERT_EMAIL:-}"

# ── Màu sắc (chỉ dùng khi chạy interactive) ──────────────────────
if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; BOLD=''; NC=''
fi

# ── Trạng thái tổng hợp ───────────────────────────────────────────
OVERALL_STATUS="OK"
FAILED_CHECKS=()
WARN_CHECKS=()
declare -A CHECK_RESULTS

mkdir -p "${LOG_DIR}"
touch "${LOG_FILE}" "${ALERT_LOG}"
[[ ! -f "${ALERT_COOLDOWN_FILE}" ]] && echo "{}" > "${ALERT_COOLDOWN_FILE}"

# ── Helper functions ──────────────────────────────────────────────
ts()      { date '+%Y-%m-%d %H:%M:%S'; }
log()     { echo "[$(ts)] $*" | tee -a "${LOG_FILE}"; }
log_ok()  { echo -e "[$(ts)] ${GREEN}OK${NC}    $*" | tee -a "${LOG_FILE}"; }
log_warn(){ echo -e "[$(ts)] ${YELLOW}WARN${NC}  $*" | tee -a "${LOG_FILE}"; }
log_fail(){ echo -e "[$(ts)] ${RED}FAIL${NC}  $*" | tee -a "${LOG_FILE}"; }

# Ghi kết quả check vào JSON status file
set_check() {
    local name="$1" status="$2" detail="${3:-}"
    CHECK_RESULTS["${name}"]="${status}|${detail}"
    if [[ "${status}" == "FAIL" ]]; then
        OVERALL_STATUS="FAIL"
        FAILED_CHECKS+=("${name}")
    elif [[ "${status}" == "WARN" && "${OVERALL_STATUS}" == "OK" ]]; then
        OVERALL_STATUS="WARN"
        WARN_CHECKS+=("${name}")
    fi
}

# Gửi cảnh báo (với cooldown để tránh spam)
send_alert() {
    local check_name="$1"
    local message="$2"
    local severity="${3:-FAIL}"  # FAIL hoặc WARN

    # Kiểm tra cooldown
    local cooldown_key="${check_name}_${severity}"
    local last_alert
    last_alert=$(python3 -c "
import json, time, sys
try:
    data = json.load(open('${ALERT_COOLDOWN_FILE}'))
    last = data.get('${cooldown_key}', 0)
    print(int(time.time()) - int(last))
except:
    print(9999)
" 2>/dev/null || echo "9999")

    if (( last_alert < ALERT_COOLDOWN )); then
        return 0  # Còn trong cooldown, bỏ qua
    fi

    # Ghi log cảnh báo
    local alert_msg="[$(ts)] [${severity}] ${check_name}: ${message}"
    echo "${alert_msg}" >> "${ALERT_LOG}"
    log "${alert_msg}"

    # Cập nhật cooldown timestamp
    python3 -c "
import json, time
try:
    data = json.load(open('${ALERT_COOLDOWN_FILE}'))
except:
    data = {}
data['${cooldown_key}'] = int(time.time())
json.dump(data, open('${ALERT_COOLDOWN_FILE}', 'w'))
" 2>/dev/null || true

    # Gửi webhook nếu đã cấu hình
    if [[ -n "${WEBHOOK_URL}" ]]; then
        local emoji="🚨"
        [[ "${severity}" == "WARN" ]] && emoji="⚠️"
        curl -sf -X POST "${WEBHOOK_URL}" \
            -H "Content-Type: application/json" \
            -d "{\"text\":\"${emoji} Song Châu ERP Alert\\n${alert_msg}\"}" \
            --max-time 10 &>/dev/null || true
    fi

    # Gửi email nếu đã cấu hình
    if [[ -n "${ALERT_EMAIL}" ]] && command -v mail &>/dev/null; then
        echo "${alert_msg}" | mail -s "[Song Châu ERP] ${severity}: ${check_name}" "${ALERT_EMAIL}" &>/dev/null || true
    fi
}

# ═══════════════════════════════════════════════════════════════════
# CHECK 1: API Health Endpoint
# ═══════════════════════════════════════════════════════════════════
check_api() {
    local http_code response_time

    # Đo thời gian response
    local start_ms=$(date +%s%3N)
    if http_code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "${API_URL}" 2>/dev/null); then
        local end_ms=$(date +%s%3N)
        response_time=$((end_ms - start_ms))

        if [[ "${http_code}" == "200" ]]; then
            log_ok "API health: HTTP ${http_code} (${response_time}ms)"
            set_check "api" "OK" "HTTP ${http_code}, ${response_time}ms"
        else
            log_fail "API health: HTTP ${http_code}"
            set_check "api" "FAIL" "HTTP ${http_code}"
            send_alert "api" "API health endpoint trả về HTTP ${http_code}"
        fi
    else
        log_fail "API health: Không thể kết nối đến ${API_URL}"
        set_check "api" "FAIL" "Connection refused"
        send_alert "api" "API không phản hồi tại ${API_URL}"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# CHECK 2: PostgreSQL
# ═══════════════════════════════════════════════════════════════════
check_postgres() {
    # Kiểm tra container đang chạy
    if ! docker ps --filter "name=sc-postgres" --filter "status=running" | grep -q "sc-postgres"; then
        log_fail "PostgreSQL container sc-postgres không chạy"
        set_check "postgres_container" "FAIL" "Container down"
        send_alert "postgres_container" "Container sc-postgres không hoạt động!"
        return
    fi

    # Kiểm tra kết nối và query
    local db_check
    if db_check=$(docker exec sc-postgres pg_isready -U scadmin -d songchau_erp -q 2>&1); then
        log_ok "PostgreSQL: Container running, kết nối OK"
        set_check "postgres" "OK" "Container running"

        # Kiểm tra số lượng active connections
        local conn_count
        conn_count=$(docker exec sc-postgres psql -U scadmin -d songchau_erp -t -c \
            "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';" 2>/dev/null | tr -d ' ' || echo "?")
        log_ok "PostgreSQL: ${conn_count} active connections"
        set_check "postgres_connections" "OK" "${conn_count} active"
    else
        log_fail "PostgreSQL: pg_isready thất bại — ${db_check}"
        set_check "postgres" "FAIL" "pg_isready failed"
        send_alert "postgres" "PostgreSQL không chấp nhận kết nối: ${db_check}"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# CHECK 3: Redis
# ═══════════════════════════════════════════════════════════════════
check_redis() {
    if ! docker ps --filter "name=sc-redis" --filter "status=running" | grep -q "sc-redis"; then
        log_fail "Redis container sc-redis không chạy"
        set_check "redis" "FAIL" "Container down"
        send_alert "redis" "Container sc-redis không hoạt động!"
        return
    fi

    local pong
    if pong=$(docker exec sc-redis redis-cli ping 2>/dev/null); then
        if [[ "${pong}" == "PONG" ]]; then
            # Kiểm tra memory usage của Redis
            local redis_mem
            redis_mem=$(docker exec sc-redis redis-cli info memory 2>/dev/null | grep "used_memory_human" | cut -d: -f2 | tr -d '[:space:]' || echo "?")
            log_ok "Redis: PONG, memory=${redis_mem}"
            set_check "redis" "OK" "PONG, mem=${redis_mem}"
        else
            log_warn "Redis: Phản hồi bất ngờ: ${pong}"
            set_check "redis" "WARN" "Unexpected response: ${pong}"
        fi
    else
        log_fail "Redis: Không thể ping"
        set_check "redis" "FAIL" "ping failed"
        send_alert "redis" "Redis không phản hồi PING!"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# CHECK 4: Nginx
# ═══════════════════════════════════════════════════════════════════
check_nginx() {
    if ! docker ps --filter "name=sc-nginx" --filter "status=running" | grep -q "sc-nginx"; then
        log_fail "Nginx container sc-nginx không chạy"
        set_check "nginx" "FAIL" "Container down"
        send_alert "nginx" "Container sc-nginx không hoạt động!"
        return
    fi

    local http_code
    if http_code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost/" 2>/dev/null); then
        if [[ "${http_code}" =~ ^(200|301|302|307|308)$ ]]; then
            log_ok "Nginx: HTTP ${http_code}"
            set_check "nginx" "OK" "HTTP ${http_code}"
        else
            log_warn "Nginx: HTTP ${http_code}"
            set_check "nginx" "WARN" "HTTP ${http_code}"
        fi
    else
        log_fail "Nginx: Không phản hồi"
        set_check "nginx" "FAIL" "No response"
        send_alert "nginx" "Nginx không phản hồi trên port 80!"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# CHECK 5: Worker và Scheduler
# ═══════════════════════════════════════════════════════════════════
check_workers() {
    # Procrastinate Worker
    if docker ps --filter "name=sc-worker" --filter "status=running" | grep -q "sc-worker"; then
        log_ok "Procrastinate Worker: running"
        set_check "worker" "OK" "running"
    else
        log_warn "Procrastinate Worker sc-worker không chạy"
        set_check "worker" "WARN" "Container down"
        send_alert "worker" "Procrastinate Worker không hoạt động!" "WARN"
    fi

    # Procrastinate Scheduler
    if docker ps --filter "name=sc-scheduler" --filter "status=running" | grep -q "sc-scheduler"; then
        log_ok "Procrastinate Scheduler: running"
        set_check "scheduler" "OK" "running"
    else
        log_warn "Procrastinate Scheduler sc-scheduler không chạy"
        set_check "scheduler" "WARN" "Container down"
        send_alert "scheduler" "Procrastinate Scheduler không hoạt động!" "WARN"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# CHECK 6: Dung lượng đĩa
# ═══════════════════════════════════════════════════════════════════
check_disk() {
    local disk_avail_gb
    # Lấy số GB available trên partition chứa /opt/erp
    disk_avail_gb=$(df -BG "${DISK_PATH}" 2>/dev/null | awk 'NR==2 {gsub("G",""); print $4}' || echo "0")

    # Tổng kích thước dữ liệu ERP
    local data_size="?"
    if [[ -d "/opt/erp/data" ]]; then
        data_size=$(du -sh /opt/erp/data 2>/dev/null | cut -f1 || echo "?")
    fi

    if (( disk_avail_gb < DISK_CRIT_GB )); then
        log_fail "Đĩa: Chỉ còn ${disk_avail_gb}GB trống (< ${DISK_CRIT_GB}GB) — NGUY HIỂM!"
        set_check "disk" "FAIL" "${disk_avail_gb}GB free"
        send_alert "disk" "Đĩa gần đầy! Chỉ còn ${disk_avail_gb}GB (ngưỡng nguy hiểm: ${DISK_CRIT_GB}GB)"
    elif (( disk_avail_gb < DISK_WARN_GB )); then
        log_warn "Đĩa: Còn ${disk_avail_gb}GB trống (< ${DISK_WARN_GB}GB) — cần dọn dẹp"
        set_check "disk" "WARN" "${disk_avail_gb}GB free"
        send_alert "disk" "Đĩa sắp đầy, còn ${disk_avail_gb}GB (ngưỡng cảnh báo: ${DISK_WARN_GB}GB)" "WARN"
    else
        log_ok "Đĩa: ${disk_avail_gb}GB trống, data ERP dùng ${data_size}"
        set_check "disk" "OK" "${disk_avail_gb}GB free"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# CHECK 7: RAM
# ═══════════════════════════════════════════════════════════════════
check_memory() {
    local mem_info mem_total mem_available ram_used_pct

    # Đọc từ /proc/meminfo
    mem_total=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
    mem_available=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
    ram_used_pct=$(( (mem_total - mem_available) * 100 / mem_total ))

    local mem_used_gb=$(( (mem_total - mem_available) / 1024 / 1024 ))
    local mem_total_gb=$(( mem_total / 1024 / 1024 ))

    if (( ram_used_pct >= RAM_CRIT_PCT )); then
        log_fail "RAM: ${ram_used_pct}% used (${mem_used_gb}GB/${mem_total_gb}GB) — NGUY HIỂM!"
        set_check "memory" "FAIL" "${ram_used_pct}% used"
        send_alert "memory" "RAM đạt ${ram_used_pct}%! Hệ thống có thể sắp hết bộ nhớ."
    elif (( ram_used_pct >= RAM_WARN_PCT )); then
        log_warn "RAM: ${ram_used_pct}% used (${mem_used_gb}GB/${mem_total_gb}GB) — cao"
        set_check "memory" "WARN" "${ram_used_pct}% used"
        send_alert "memory" "RAM đang cao: ${ram_used_pct}% (${mem_used_gb}GB/${mem_total_gb}GB)" "WARN"
    else
        log_ok "RAM: ${ram_used_pct}% used (${mem_used_gb}GB/${mem_total_gb}GB)"
        set_check "memory" "OK" "${ram_used_pct}% used"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# CHECK 8: CPU Load Average
# ═══════════════════════════════════════════════════════════════════
check_cpu() {
    local load_1 load_5 load_15
    read load_1 load_5 load_15 _ < /proc/loadavg

    # So sánh load_5 với ngưỡng (dùng bc hoặc python3)
    local load_check
    load_check=$(python3 -c "
load5 = float('${load_5}')
warn = ${LOAD_WARN}
if load5 >= warn * 1.5:
    print('FAIL')
elif load5 >= warn:
    print('WARN')
else:
    print('OK')
" 2>/dev/null || echo "OK")

    local cpu_count
    cpu_count=$(nproc 2>/dev/null || echo "4")

    case "${load_check}" in
        FAIL)
            log_fail "CPU Load: ${load_5} (5m avg) — NGUY HIỂM! (${cpu_count} cores)"
            set_check "cpu" "FAIL" "load5=${load_5}"
            send_alert "cpu" "CPU load cao nguy hiểm: ${load_5} (5min avg, ${cpu_count} cores)"
            ;;
        WARN)
            log_warn "CPU Load: ${load_5} (5m avg) — cao (${cpu_count} cores)"
            set_check "cpu" "WARN" "load5=${load_5}"
            send_alert "cpu" "CPU load cao: ${load_5} (5min avg, ${cpu_count} cores)" "WARN"
            ;;
        *)
            log_ok "CPU Load: ${load_1} / ${load_5} / ${load_15} (1/5/15m, ${cpu_count} cores)"
            set_check "cpu" "OK" "load5=${load_5}"
            ;;
    esac
}

# ═══════════════════════════════════════════════════════════════════
# MAIN: Chạy tất cả checks
# ═══════════════════════════════════════════════════════════════════
main() {
    log "════════════════════════════════════════"
    log "Health check bắt đầu — $(ts)"
    log "════════════════════════════════════════"

    check_api
    check_postgres
    check_redis
    check_nginx
    check_workers
    check_disk
    check_memory
    check_cpu

    # ── Ghi JSON status file ──────────────────────────────────────
    python3 -c "
import json, time
results = {}
$(for key in "${!CHECK_RESULTS[@]}"; do
    echo "results['${key}'] = '${CHECK_RESULTS[$key]}'"
done)
output = {
    'timestamp': '$(ts)',
    'overall': '${OVERALL_STATUS}',
    'checks': results,
    'failed': $(python3 -c "import json; print(json.dumps(${FAILED_CHECKS[*]+"[\"${FAILED_CHECKS[*]// /\",\"}\"]}") if '${FAILED_CHECKS[*]:-}' else print('[]'))" 2>/dev/null || echo "[]"),
}
json.dump(output, open('${STATUS_FILE}', 'w'), indent=2)
" 2>/dev/null || true

    # ── Tóm tắt ──────────────────────────────────────────────────
    log "════════════════════════════════════════"
    if [[ "${OVERALL_STATUS}" == "OK" ]]; then
        log_ok "Tất cả checks PASSED — Hệ thống hoạt động bình thường"
    elif [[ "${OVERALL_STATUS}" == "WARN" ]]; then
        log_warn "Có ${#WARN_CHECKS[@]} cảnh báo: ${WARN_CHECKS[*]:-}"
    else
        log_fail "CÓ ${#FAILED_CHECKS[@]} LỖI: ${FAILED_CHECKS[*]:-}"
        exit 1
    fi
    log "Status file: ${STATUS_FILE}"
    log "════════════════════════════════════════"
}

main "$@"
