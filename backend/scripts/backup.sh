#!/usr/bin/env bash
# =============================================================================
# backup.sh — Sao lưu cơ sở dữ liệu PostgreSQL cho hệ thống Song Châu ERP
#
# Chức năng:
#   1. Dùng pg_dump để xuất toàn bộ CSDL ra file SQL
#   2. Nén file bằng gzip để tiết kiệm dung lượng
#   3. (Tùy chọn) Mã hóa file bằng GPG nếu cấu hình BACKUP_GPG_KEY
#   4. Đồng bộ file sang server từ xa qua rsync + SSH
#   5. Xóa các file sao lưu cũ hơn BACKUP_RETENTION_DAYS ngày
#
# Sử dụng:
#   chmod +x scripts/backup.sh
#   ./scripts/backup.sh
#
# Biến môi trường (có thể đặt trong .env hoặc cấu hình hệ thống):
#   POSTGRES_HOST         — Máy chủ PostgreSQL (mặc định: localhost)
#   POSTGRES_PORT         — Cổng PostgreSQL (mặc định: 5432)
#   POSTGRES_DB           — Tên cơ sở dữ liệu (mặc định: songchau_erp)
#   POSTGRES_USER         — Tên người dùng PostgreSQL (mặc định: scadmin)
#   PGPASSWORD            — Mật khẩu PostgreSQL (xuất ra môi trường)
#   BACKUP_DIR            — Thư mục lưu file sao lưu (mặc định: /backup/postgres)
#   BACKUP_RETENTION_DAYS — Số ngày giữ file cũ (mặc định: 30)
#   BACKUP_GPG_KEY        — ID khóa GPG để mã hóa (để trống = không mã hóa)
#   REMOTE_BACKUP_HOST    — Server từ xa để rsync (để trống = bỏ qua rsync)
#   REMOTE_BACKUP_PATH    — Đường dẫn trên server từ xa (mặc định: /backup/songchau)
#   REMOTE_BACKUP_USER    — Tên người dùng SSH (mặc định: backup)
#   REMOTE_SSH_KEY        — Đường dẫn đến khóa SSH riêng tư
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Cấu hình mặc định
# ---------------------------------------------------------------------------
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-songchau_erp}"
POSTGRES_USER="${POSTGRES_USER:-scadmin}"

BACKUP_DIR="${BACKUP_DIR:-/backup/postgres}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_GPG_KEY="${BACKUP_GPG_KEY:-}"

REMOTE_BACKUP_HOST="${REMOTE_BACKUP_HOST:-}"
REMOTE_BACKUP_PATH="${REMOTE_BACKUP_PATH:-/backup/songchau}"
REMOTE_BACKUP_USER="${REMOTE_BACKUP_USER:-backup}"
REMOTE_SSH_KEY="${REMOTE_SSH_KEY:-}"

# Định dạng tên file: songchau_erp_2026-03-29_143000.sql.gz[.gpg]
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
BACKUP_FILENAME="${POSTGRES_DB}_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILENAME}"

# ---------------------------------------------------------------------------
# Hàm tiện ích
# ---------------------------------------------------------------------------
log() {
    # Ghi nhật ký với nhãn thời gian
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error_exit() {
    # Ghi lỗi và thoát với mã lỗi 1
    log "LỖI: $*" >&2
    exit 1
}

check_command() {
    # Kiểm tra xem lệnh có tồn tại trong hệ thống không
    command -v "$1" >/dev/null 2>&1 || error_exit "Lệnh '$1' không tìm thấy. Vui lòng cài đặt."
}

# ---------------------------------------------------------------------------
# Kiểm tra các công cụ cần thiết
# ---------------------------------------------------------------------------
log "Kiểm tra các công cụ cần thiết..."
check_command pg_dump
check_command gzip

if [[ -n "${BACKUP_GPG_KEY}" ]]; then
    check_command gpg
fi

if [[ -n "${REMOTE_BACKUP_HOST}" ]]; then
    check_command rsync
    check_command ssh
fi

# ---------------------------------------------------------------------------
# Tạo thư mục sao lưu nếu chưa tồn tại
# ---------------------------------------------------------------------------
log "Tạo thư mục sao lưu: ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}" || error_exit "Không thể tạo thư mục ${BACKUP_DIR}"

# Đảm bảo quyền hạn chế truy cập vào thư mục sao lưu
chmod 700 "${BACKUP_DIR}"

# ---------------------------------------------------------------------------
# Bước 1: Xuất cơ sở dữ liệu bằng pg_dump và nén bằng gzip
# ---------------------------------------------------------------------------
log "Bắt đầu sao lưu cơ sở dữ liệu '${POSTGRES_DB}' từ ${POSTGRES_HOST}:${POSTGRES_PORT}..."

# Export mật khẩu để pg_dump sử dụng (an toàn hơn dùng -W)
export PGPASSWORD

pg_dump \
    --host="${POSTGRES_HOST}" \
    --port="${POSTGRES_PORT}" \
    --username="${POSTGRES_USER}" \
    --dbname="${POSTGRES_DB}" \
    --format=plain \
    --no-password \
    --verbose \
    --lock-wait-timeout=30s \
    2>>"${BACKUP_DIR}/backup_${TIMESTAMP}.log" \
    | gzip --best > "${BACKUP_PATH}" \
    || error_exit "pg_dump thất bại. Xem log: ${BACKUP_DIR}/backup_${TIMESTAMP}.log"

# Kiểm tra file đầu ra không rỗng
BACKUP_SIZE=$(stat -c%s "${BACKUP_PATH}" 2>/dev/null || stat -f%z "${BACKUP_PATH}" 2>/dev/null || echo 0)
if [[ "${BACKUP_SIZE}" -lt 1024 ]]; then
    error_exit "File sao lưu quá nhỏ (${BACKUP_SIZE} bytes). Có thể đã xảy ra lỗi."
fi

log "Sao lưu thành công: ${BACKUP_PATH} ($(du -sh "${BACKUP_PATH}" | cut -f1))"

# ---------------------------------------------------------------------------
# Bước 2: Mã hóa bằng GPG (tùy chọn)
# ---------------------------------------------------------------------------
FINAL_BACKUP_PATH="${BACKUP_PATH}"

if [[ -n "${BACKUP_GPG_KEY}" ]]; then
    log "Mã hóa file sao lưu bằng GPG với khóa '${BACKUP_GPG_KEY}'..."

    GPG_OUTPUT="${BACKUP_PATH}.gpg"
    gpg \
        --batch \
        --yes \
        --trust-model always \
        --recipient "${BACKUP_GPG_KEY}" \
        --output "${GPG_OUTPUT}" \
        --encrypt "${BACKUP_PATH}" \
        || error_exit "Mã hóa GPG thất bại."

    # Xóa file chưa mã hóa sau khi mã hóa thành công
    rm -f "${BACKUP_PATH}"
    FINAL_BACKUP_PATH="${GPG_OUTPUT}"
    log "Mã hóa thành công: ${FINAL_BACKUP_PATH}"
fi

# ---------------------------------------------------------------------------
# Bước 3: Đồng bộ sang server từ xa qua rsync (tùy chọn)
# ---------------------------------------------------------------------------
if [[ -n "${REMOTE_BACKUP_HOST}" ]]; then
    log "Đồng bộ file sao lưu sang ${REMOTE_BACKUP_USER}@${REMOTE_BACKUP_HOST}:${REMOTE_BACKUP_PATH}..."

    # Xây dựng tùy chọn SSH
    SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=30 -o BatchMode=yes"
    if [[ -n "${REMOTE_SSH_KEY}" ]]; then
        SSH_OPTS="${SSH_OPTS} -i ${REMOTE_SSH_KEY}"
    fi

    rsync \
        --archive \
        --compress \
        --progress \
        --checksum \
        --rsh="ssh ${SSH_OPTS}" \
        "${FINAL_BACKUP_PATH}" \
        "${REMOTE_BACKUP_USER}@${REMOTE_BACKUP_HOST}:${REMOTE_BACKUP_PATH}/" \
        || error_exit "rsync sang server từ xa thất bại."

    log "Đồng bộ thành công sang ${REMOTE_BACKUP_HOST}."
else
    log "Bỏ qua đồng bộ từ xa (REMOTE_BACKUP_HOST chưa được cấu hình)."
fi

# ---------------------------------------------------------------------------
# Bước 4: Xóa các file sao lưu cũ hơn BACKUP_RETENTION_DAYS ngày
# ---------------------------------------------------------------------------
log "Xóa các file sao lưu cũ hơn ${BACKUP_RETENTION_DAYS} ngày trong ${BACKUP_DIR}..."

DELETED_COUNT=0
while IFS= read -r -d '' old_file; do
    log "  Xóa file cũ: ${old_file}"
    rm -f "${old_file}"
    DELETED_COUNT=$((DELETED_COUNT + 1))
done < <(find "${BACKUP_DIR}" \
    -maxdepth 1 \
    -type f \
    \( -name "${POSTGRES_DB}_*.sql.gz" -o -name "${POSTGRES_DB}_*.sql.gz.gpg" \) \
    -mtime "+${BACKUP_RETENTION_DAYS}" \
    -print0 2>/dev/null)

# Cũng xóa các file log cũ
while IFS= read -r -d '' old_log; do
    rm -f "${old_log}"
done < <(find "${BACKUP_DIR}" \
    -maxdepth 1 \
    -type f \
    -name "backup_*.log" \
    -mtime "+${BACKUP_RETENTION_DAYS}" \
    -print0 2>/dev/null)

if [[ "${DELETED_COUNT}" -gt 0 ]]; then
    log "Đã xóa ${DELETED_COUNT} file sao lưu cũ."
else
    log "Không có file nào cần xóa."
fi

# ---------------------------------------------------------------------------
# Hoàn thành
# ---------------------------------------------------------------------------
log "===== Sao lưu hoàn tất ====="
log "File: ${FINAL_BACKUP_PATH}"
log "Kích thước: $(du -sh "${FINAL_BACKUP_PATH}" | cut -f1)"
log "Thời gian: ${TIMESTAMP}"

# Trả về mã thành công
exit 0
