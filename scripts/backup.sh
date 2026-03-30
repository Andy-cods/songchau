#!/bin/bash
# ═══════════════════════════════════════════════════
# Song Châu ERP — PostgreSQL Backup Script
# Chạy hàng đêm lúc 02:00 via cron
# ═══════════════════════════════════════════════════
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/erp/data/backups"
RETENTION_DAYS=30

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

mkdir -p "${BACKUP_DIR}"

# 1. PostgreSQL dump
log "Bắt đầu backup PostgreSQL..."
docker exec sc-postgres pg_dump \
    -U scadmin \
    -d songchau_erp \
    --format=custom \
    --compress=9 \
    -f "/tmp/backup_${TIMESTAMP}.dump"

docker cp "sc-postgres:/tmp/backup_${TIMESTAMP}.dump" "${BACKUP_DIR}/songchau_${TIMESTAMP}.dump"
docker exec sc-postgres rm -f "/tmp/backup_${TIMESTAMP}.dump"

DUMP_SIZE=$(du -sh "${BACKUP_DIR}/songchau_${TIMESTAMP}.dump" | cut -f1)
log "Backup hoàn thành: songchau_${TIMESTAMP}.dump (${DUMP_SIZE})"

# 2. Xóa backup cũ hơn 30 ngày
DELETED=$(find "${BACKUP_DIR}" -name "songchau_*.dump" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
log "Đã xóa ${DELETED} backup cũ (>${RETENTION_DAYS} ngày)"

# 3. Verify backup
TABLES=$(docker exec sc-postgres pg_restore --list "${BACKUP_DIR}/songchau_${TIMESTAMP}.dump" 2>/dev/null | grep "TABLE " | wc -l || echo "?")
log "Verify: ${TABLES} tables trong backup"

log "Backup script hoàn thành!"
