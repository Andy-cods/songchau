#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Song Châu ERP — One-Command Deployment Script
# VPS: 103.56.158.129
#
# Quy trình deploy an toàn:
#   1. Backup PostgreSQL hiện tại
#   2. Pull git changes
#   3. Build images mới
#   4. Rolling restart containers
#   5. Health check sau deploy
#   6. Rollback tự động nếu health check thất bại
#   7. Báo cáo kết quả
#
# Sử dụng:
#   ./scripts/deploy.sh                  # Deploy branch hiện tại
#   ./scripts/deploy.sh --no-backup      # Bỏ qua backup (không khuyến nghị)
#   ./scripts/deploy.sh --skip-build     # Chỉ restart, không build lại
#   ./scripts/deploy.sh --branch main    # Deploy branch cụ thể
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

# ── Cấu hình ──────────────────────────────────────────────────────
DEPLOY_DIR="/opt/erp"
LOG_DIR="/opt/erp/data/logs"
BACKUP_DIR="/opt/erp/data/backups"
DEPLOY_LOG="${LOG_DIR}/deploy.log"
HEALTH_CHECK_URL="http://localhost/api/health"
HEALTH_RETRIES=10
HEALTH_WAIT=6       # Giây chờ giữa mỗi lần health check
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.yml"

# Flags từ arguments
DO_BACKUP=true
DO_BUILD=true
TARGET_BRANCH=""

# ── Màu sắc ───────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Parse arguments ───────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-backup)   DO_BACKUP=false; shift ;;
        --skip-build)  DO_BUILD=false;  shift ;;
        --branch)      TARGET_BRANCH="$2"; shift 2 ;;
        --help|-h)
            echo "Sử dụng: $0 [--no-backup] [--skip-build] [--branch <branch>]"
            exit 0 ;;
        *) echo "Tham số không hợp lệ: $1"; exit 1 ;;
    esac
done

# ── Helper functions ──────────────────────────────────────────────
ts()      { date '+%Y-%m-%d %H:%M:%S'; }
log()     { local msg="[$(ts)] $*"; echo -e "${CYAN}${msg}${NC}"; echo "${msg}" >> "${DEPLOY_LOG}"; }
success() { local msg="[$(ts)] OK    $*"; echo -e "${GREEN}${msg}${NC}"; echo "${msg}" >> "${DEPLOY_LOG}"; }
warn()    { local msg="[$(ts)] WARN  $*"; echo -e "${YELLOW}${msg}${NC}"; echo "${msg}" >> "${DEPLOY_LOG}"; }
error()   { local msg="[$(ts)] ERROR $*"; echo -e "${RED}${msg}${NC}"; echo "${msg}" >> "${DEPLOY_LOG}"; }
header()  {
    local line="══════════════════════════════════════════════════"
    echo -e "\n${BOLD}${BLUE}${line}${NC}"
    echo -e "${BOLD}${BLUE}  $*${NC}"
    echo -e "${BOLD}${BLUE}${line}${NC}\n"
    echo "=== $* ===" >> "${DEPLOY_LOG}"
}

# Thời gian bắt đầu deploy
DEPLOY_START=$(date +%s)
DEPLOY_ID="deploy_$(date +%Y%m%d_%H%M%S)"

mkdir -p "${LOG_DIR}" "${BACKUP_DIR}"

# ── Cleanup on error ──────────────────────────────────────────────
ROLLBACK_NEEDED=false
BACKUP_FILE=""
GIT_PREV_COMMIT=""

cleanup_on_error() {
    local exit_code=$?
    if [[ ${exit_code} -ne 0 ]]; then
        error "Deploy thất bại! Exit code: ${exit_code}"
        if [[ "${ROLLBACK_NEEDED}" == "true" ]]; then
            rollback
        fi
    fi
}
trap cleanup_on_error EXIT

# ── Hàm rollback ─────────────────────────────────────────────────
rollback() {
    header "Rollback"
    warn "Bắt đầu rollback..."

    # Quay lại git commit cũ
    if [[ -n "${GIT_PREV_COMMIT}" ]]; then
        log "Rollback git về commit ${GIT_PREV_COMMIT}..."
        cd "${DEPLOY_DIR}" && git checkout "${GIT_PREV_COMMIT}" -- . 2>>"${DEPLOY_LOG}" || \
            error "Không thể rollback git"
    fi

    # Khởi động lại containers với image cũ
    log "Restart containers với image cũ..."
    cd "${DEPLOY_DIR}" && docker compose -f "${COMPOSE_FILE}" up -d 2>>"${DEPLOY_LOG}" || \
        error "Không thể restart containers khi rollback"

    # Khôi phục database nếu có backup
    if [[ -n "${BACKUP_FILE}" && -f "${BACKUP_FILE}" ]]; then
        warn "Phát hiện backup ${BACKUP_FILE}"
        warn "Để khôi phục DB thủ công:"
        warn "  docker exec -i sc-postgres pg_restore -U scadmin -d songchau_erp < ${BACKUP_FILE}"
        warn "KHÔNG tự động khôi phục DB để tránh mất dữ liệu mới!"
    fi

    error "Rollback hoàn thành. Kiểm tra hệ thống!"
    ROLLBACK_NEEDED=false
}

# ═══════════════════════════════════════════════════════════════════
# BƯỚC 1: Kiểm tra môi trường
# ═══════════════════════════════════════════════════════════════════
header "Bước 1: Kiểm tra môi trường [${DEPLOY_ID}]"

# Kiểm tra đang ở đúng thư mục
if [[ ! -f "${COMPOSE_FILE}" ]]; then
    error "Không tìm thấy ${COMPOSE_FILE}"
    error "Đảm bảo deploy từ thư mục đúng: ${DEPLOY_DIR}"
    exit 1
fi

# Kiểm tra docker
if ! command -v docker &>/dev/null; then
    error "Docker không được cài đặt!"
    exit 1
fi

# Kiểm tra git
if ! command -v git &>/dev/null; then
    error "Git không được cài đặt!"
    exit 1
fi

# Lấy thông tin hiện tại
cd "${DEPLOY_DIR}"
GIT_PREV_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
log "Vị trí hiện tại: branch=${CURRENT_BRANCH}, commit=${GIT_PREV_COMMIT:0:8}"

# Kiểm tra disk space tối thiểu (cần 2GB để build)
DISK_FREE_GB=$(df -BG "${DEPLOY_DIR}" | awk 'NR==2 {gsub("G",""); print $4}')
if (( DISK_FREE_GB < 2 )); then
    error "Không đủ dung lượng đĩa: chỉ còn ${DISK_FREE_GB}GB (cần ít nhất 2GB)"
    exit 1
fi

success "Môi trường OK: docker, git, ${DISK_FREE_GB}GB trống"

# ═══════════════════════════════════════════════════════════════════
# BƯỚC 2: Backup PostgreSQL
# ═══════════════════════════════════════════════════════════════════
header "Bước 2: Backup PostgreSQL"

if [[ "${DO_BACKUP}" == "false" ]]; then
    warn "Bỏ qua backup (--no-backup được chỉ định)"
else
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="${BACKUP_DIR}/pre_deploy_${TIMESTAMP}.dump"

    log "Backup PostgreSQL vào ${BACKUP_FILE}..."

    if ! docker ps --filter "name=sc-postgres" --filter "status=running" | grep -q "sc-postgres"; then
        error "sc-postgres container không chạy — không thể backup!"
        exit 1
    fi

    # Thực hiện backup
    if docker exec sc-postgres pg_dump \
        -U scadmin \
        -d songchau_erp \
        --format=custom \
        --compress=6 \
        -f "/tmp/pre_deploy_${TIMESTAMP}.dump" 2>>"${DEPLOY_LOG}"; then

        docker cp "sc-postgres:/tmp/pre_deploy_${TIMESTAMP}.dump" "${BACKUP_FILE}" 2>>"${DEPLOY_LOG}"
        docker exec sc-postgres rm -f "/tmp/pre_deploy_${TIMESTAMP}.dump"

        local_size=$(du -sh "${BACKUP_FILE}" | cut -f1)
        success "Backup hoàn thành: ${BACKUP_FILE} (${local_size})"

        # Xóa backup deploy cũ hơn 7 ngày để tránh đầy đĩa
        find "${BACKUP_DIR}" -name "pre_deploy_*.dump" -mtime +7 -delete 2>/dev/null || true
    else
        error "Backup thất bại!"
        exit 1
    fi
fi

# ═══════════════════════════════════════════════════════════════════
# BƯỚC 3: Pull git changes
# ═══════════════════════════════════════════════════════════════════
header "Bước 3: Pull git changes"

cd "${DEPLOY_DIR}"

# Chuyển branch nếu được chỉ định
if [[ -n "${TARGET_BRANCH}" ]]; then
    log "Chuyển sang branch: ${TARGET_BRANCH}"
    git fetch origin 2>>"${DEPLOY_LOG}"
    git checkout "${TARGET_BRANCH}" 2>>"${DEPLOY_LOG}"
fi

# Kiểm tra có thay đổi cục bộ không
if ! git diff --quiet 2>/dev/null; then
    warn "Có thay đổi cục bộ chưa commit:"
    git diff --name-only | while read -r f; do warn "  M ${f}"; done
    warn "Stash những thay đổi này..."
    git stash push -m "auto-stash before deploy ${DEPLOY_ID}" 2>>"${DEPLOY_LOG}" || true
fi

# Pull code mới
log "Fetch từ remote origin..."
git fetch origin 2>>"${DEPLOY_LOG}"

CURRENT_BRANCH=$(git branch --show-current)
log "Pull branch ${CURRENT_BRANCH}..."
if git pull origin "${CURRENT_BRANCH}" 2>>"${DEPLOY_LOG}"; then
    NEW_COMMIT=$(git rev-parse HEAD)
    if [[ "${NEW_COMMIT}" == "${GIT_PREV_COMMIT}" ]]; then
        warn "Không có thay đổi mới. Tiếp tục deploy..."
    else
        success "Pull thành công. ${GIT_PREV_COMMIT:0:8} -> ${NEW_COMMIT:0:8}"
        log "Thay đổi:"
        git log --oneline "${GIT_PREV_COMMIT}..${NEW_COMMIT}" 2>/dev/null | \
            while read -r line; do log "  ${line}"; done
    fi
else
    error "git pull thất bại!"
    exit 1
fi

ROLLBACK_NEEDED=true

# ═══════════════════════════════════════════════════════════════════
# BƯỚC 4: Build Docker images
# ═══════════════════════════════════════════════════════════════════
header "Bước 4: Build Docker images"

if [[ "${DO_BUILD}" == "false" ]]; then
    warn "Bỏ qua build (--skip-build được chỉ định)"
else
    log "Build images mới..."
    log "(Quá trình này có thể mất 2-5 phút...)"

    if docker compose -f "${COMPOSE_FILE}" build \
        --no-cache \
        --progress=plain \
        api frontend 2>>"${DEPLOY_LOG}"; then
        success "Build thành công"
    else
        error "Build thất bại! Xem log: ${DEPLOY_LOG}"
        exit 1
    fi
fi

# ═══════════════════════════════════════════════════════════════════
# BƯỚC 5: Rolling restart containers
# ═══════════════════════════════════════════════════════════════════
header "Bước 5: Khởi động containers"
log "Restart tất cả services với image mới..."

if docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans 2>>"${DEPLOY_LOG}"; then
    success "Containers đã được khởi động"
else
    error "Không thể khởi động containers!"
    exit 1
fi

# Dọn dẹp Docker images cũ
log "Dọn dẹp Docker images cũ..."
docker image prune -f 2>>"${DEPLOY_LOG}" || true

# ═══════════════════════════════════════════════════════════════════
# BƯỚC 6: Health check
# ═══════════════════════════════════════════════════════════════════
header "Bước 6: Health check"
log "Chờ services khởi động... (kiểm tra ${HEALTH_RETRIES} lần, cách ${HEALTH_WAIT}s)"

HEALTH_OK=false
for i in $(seq 1 ${HEALTH_RETRIES}); do
    log "Lần thử ${i}/${HEALTH_RETRIES}..."

    if curl -sf --max-time 10 "${HEALTH_CHECK_URL}" -o /dev/null; then
        success "API health check PASSED (lần ${i})"
        HEALTH_OK=true
        break
    else
        if (( i < HEALTH_RETRIES )); then
            warn "Chưa sẵn sàng, chờ ${HEALTH_WAIT}s..."
            sleep "${HEALTH_WAIT}"
        fi
    fi
done

if [[ "${HEALTH_OK}" == "false" ]]; then
    error "Health check THẤT BẠI sau ${HEALTH_RETRIES} lần thử!"
    error "API không phản hồi tại ${HEALTH_CHECK_URL}"
    log "Container status:"
    docker compose -f "${COMPOSE_FILE}" ps 2>>"${DEPLOY_LOG}" | tee -a "${DEPLOY_LOG}"
    log "API logs gần nhất:"
    docker logs sc-api --tail 30 2>>"${DEPLOY_LOG}" | tee -a "${DEPLOY_LOG}"
    exit 1
fi

# Kiểm tra thêm: PostgreSQL và Redis
log "Kiểm tra PostgreSQL..."
if docker exec sc-postgres pg_isready -U scadmin -d songchau_erp -q 2>/dev/null; then
    success "PostgreSQL: OK"
else
    warn "PostgreSQL: Chưa sẵn sàng (có thể vẫn đang khởi động)"
fi

log "Kiểm tra Redis..."
if docker exec sc-redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
    success "Redis: OK"
else
    warn "Redis: Chưa phản hồi"
fi

ROLLBACK_NEEDED=false

# ═══════════════════════════════════════════════════════════════════
# BƯỚC 7: Báo cáo kết quả
# ═══════════════════════════════════════════════════════════════════
header "Deploy thành công!"

DEPLOY_END=$(date +%s)
DEPLOY_DURATION=$(( DEPLOY_END - DEPLOY_START ))

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║         DEPLOY THÀNH CÔNG!                   ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Deploy ID    : ${DEPLOY_ID}"
echo -e "  Branch       : $(git branch --show-current 2>/dev/null || echo 'unknown')"
echo -e "  Commit cũ    : ${GIT_PREV_COMMIT:0:8}"
echo -e "  Commit mới   : $(git rev-parse HEAD 2>/dev/null | cut -c1-8 || echo 'unknown')"
echo -e "  Thời gian    : ${DEPLOY_DURATION}s"
[[ -n "${BACKUP_FILE}" ]] && echo -e "  Backup       : ${BACKUP_FILE}"
echo -e "  Log          : ${DEPLOY_LOG}"
echo ""
echo -e "${CYAN}Container status:${NC}"
docker compose -f "${COMPOSE_FILE}" ps 2>/dev/null || true

# Ghi log tổng kết
log "════════════════════════════════"
log "DEPLOY THÀNH CÔNG: ${DEPLOY_ID} (${DEPLOY_DURATION}s)"
log "Commit: ${GIT_PREV_COMMIT:0:8} -> $(git rev-parse HEAD 2>/dev/null | cut -c1-8 || echo 'unknown')"
log "════════════════════════════════"
