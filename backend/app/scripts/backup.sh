#!/bin/bash
# ===========================================================================
# Song Chau ERP — Automated PostgreSQL Backup with Encryption
#
# Runs via cron at 02:00 daily:
#   0 2 * * * /app/app/scripts/backup.sh >> /var/log/backup.log 2>&1
#
# Features:
#   - Full database dump with pg_dump (custom format, compressed)
#   - AES-256 encryption via openssl
#   - Automatic cleanup of backups older than 30 days
#   - Optional upload to remote storage (S3-compatible)
#   - Slack/webhook notification on failure
#
# Required environment variables:
#   POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
#   BACKUP_ENCRYPTION_KEY  — passphrase for AES-256 encryption
#
# Optional:
#   BACKUP_S3_BUCKET       — S3 bucket for offsite storage
#   BACKUP_WEBHOOK_URL     — Webhook URL for failure alerts
#   BACKUP_RETENTION_DAYS  — Days to keep local backups (default: 30)
# ===========================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-songchau_erp}"
DB_USER="${POSTGRES_USER:-scadmin}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
S3_BUCKET="${BACKUP_S3_BUCKET:-}"
WEBHOOK_URL="${BACKUP_WEBHOOK_URL:-}"

BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.dump"
ENCRYPTED_FILE="${BACKUP_FILE}.enc"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

notify_failure() {
    local message="$1"
    log "ERROR: ${message}"

    if [[ -n "${WEBHOOK_URL}" ]]; then
        curl -s -X POST "${WEBHOOK_URL}" \
            -H "Content-Type: application/json" \
            -d "{\"text\": \"[BACKUP FAILED] Song Chau ERP: ${message}\"}" \
            || true
    fi
}

cleanup_old_backups() {
    log "Cleaning up backups older than ${RETENTION_DAYS} days..."
    local count
    count=$(find "${BACKUP_DIR}" -name "*.dump.enc" -mtime "+${RETENTION_DAYS}" -type f | wc -l)
    find "${BACKUP_DIR}" -name "*.dump.enc" -mtime "+${RETENTION_DAYS}" -type f -delete
    find "${BACKUP_DIR}" -name "*.sha256" -mtime "+${RETENTION_DAYS}" -type f -delete
    find "${BACKUP_DIR}" -name "*.dump" -mtime "+${RETENTION_DAYS}" -type f -delete
    log "Removed ${count} old backup(s)"
}

upload_to_s3() {
    if [[ -z "${S3_BUCKET}" ]]; then
        return 0
    fi

    log "Uploading to S3: ${S3_BUCKET}..."
    local s3_path="s3://${S3_BUCKET}/backups/${DB_NAME}/${TIMESTAMP}/"

    if command -v aws &> /dev/null; then
        aws s3 cp "${ENCRYPTED_FILE}" "${s3_path}" --quiet
        aws s3 cp "${CHECKSUM_FILE}" "${s3_path}" --quiet
        log "S3 upload complete"
    else
        log "WARNING: aws CLI not found, skipping S3 upload"
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

log "========================================="
log "Starting backup: ${DB_NAME}"
log "========================================="

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

# Check required tools
for cmd in pg_dump openssl sha256sum; do
    if ! command -v "${cmd}" &> /dev/null; then
        notify_failure "Required command not found: ${cmd}"
        exit 1
    fi
done

# Step 1: Database dump
log "Step 1/4: Creating database dump..."
export PGPASSWORD="${POSTGRES_PASSWORD}"

if ! pg_dump \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    -Fc \
    -Z 6 \
    --no-owner \
    --no-privileges \
    -f "${BACKUP_FILE}"; then
    notify_failure "pg_dump failed for ${DB_NAME}"
    exit 1
fi

unset PGPASSWORD

DUMP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
log "  Dump created: ${DUMP_SIZE}"

# Step 2: Generate checksum
log "Step 2/4: Generating SHA-256 checksum..."
sha256sum "${BACKUP_FILE}" > "${CHECKSUM_FILE}"

# Step 3: Encrypt
log "Step 3/4: Encrypting backup..."
if [[ -n "${ENCRYPTION_KEY}" ]]; then
    openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
        -in "${BACKUP_FILE}" \
        -out "${ENCRYPTED_FILE}" \
        -pass "pass:${ENCRYPTION_KEY}"

    # Remove unencrypted dump
    rm -f "${BACKUP_FILE}"
    FINAL_SIZE=$(du -h "${ENCRYPTED_FILE}" | cut -f1)
    log "  Encrypted backup: ${FINAL_SIZE}"
else
    log "  WARNING: No encryption key set, backup stored unencrypted"
    ENCRYPTED_FILE="${BACKUP_FILE}"
fi

# Step 4: Upload to remote storage
log "Step 4/4: Remote upload..."
upload_to_s3

# Cleanup old backups
cleanup_old_backups

# Summary
log "========================================="
log "Backup complete!"
log "  File: ${ENCRYPTED_FILE}"
log "  Checksum: ${CHECKSUM_FILE}"
log "========================================="
