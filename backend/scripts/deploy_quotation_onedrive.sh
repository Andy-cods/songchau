#!/usr/bin/env bash
# ============================================================
# Deploy: Quotation edit/delete + OneDrive integration (P1+P2)
# Date: 2026-05-07
#
# Run from VPS (Song Chau ERP host) where backend is deployed.
# Idempotent: re-running is safe.
#
# Steps:
#   1. Apply 2 migrations (soft-delete + OneDrive columns)
#   2. Verify env vars (M365_*) are set
#   3. Restart backend + worker containers
#   4. Health check + smoke test 1 endpoint
#   5. Run E2E test suite
#   6. Cleanup test data
# ============================================================
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/songchau-erp}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-}"
PG_CONTAINER="${PG_CONTAINER:-}"
WORKER_CONTAINER="${WORKER_CONTAINER:-}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-}"
PG_USER="${PG_USER:-scadmin}"
PG_DB="${PG_DB:-songchau_erp}"
DB_URL="${DATABASE_URL:-}"

cd "$PROJECT_DIR"

# Auto-detect compose service names (varies by deploy: 'backend' / 'api' /
# 'app' / 'web', 'postgres' / 'db' / 'pg', etc.). User can override via env.
_detect_service() {
    local hint="$1"; shift
    local services
    services="$(docker compose config --services 2>/dev/null)"
    for cand in "$@"; do
        if echo "$services" | grep -qx "$cand"; then
            echo "$cand"
            return 0
        fi
    done
    # Fuzzy fallback
    echo "$services" | grep -i "$hint" | head -1
}

[ -z "$BACKEND_CONTAINER" ]  && BACKEND_CONTAINER="$(_detect_service backend backend api app web)"
[ -z "$PG_CONTAINER" ]       && PG_CONTAINER="$(_detect_service postgres postgres pg db database)"
[ -z "$WORKER_CONTAINER" ]   && WORKER_CONTAINER="$(_detect_service worker worker celery procrastinate)"
[ -z "$FRONTEND_CONTAINER" ] && FRONTEND_CONTAINER="$(_detect_service frontend frontend web nextjs ui)"

echo "Detected services:"
echo "  backend  = ${BACKEND_CONTAINER:-?}"
echo "  postgres = ${PG_CONTAINER:-?}"
echo "  worker   = ${WORKER_CONTAINER:-?}"
echo "  frontend = ${FRONTEND_CONTAINER:-?}"

if [ -z "$BACKEND_CONTAINER" ] || [ -z "$PG_CONTAINER" ]; then
    echo "FATAL: cannot detect required services. Available services:"
    docker compose config --services
    echo ""
    echo "Re-run with explicit env: BACKEND_CONTAINER=<name> PG_CONTAINER=<name> bash $0"
    exit 1
fi

# psql wrapper — prefers host psql if installed, else routes through the
# postgres container via `docker compose exec`. Falls back gracefully when
# DB_URL is not set (DB resolved by container env).
_psql_file() {
    local sql_file="$1"
    if command -v psql >/dev/null 2>&1 && [ -n "$DB_URL" ]; then
        psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$sql_file"
    else
        docker compose exec -T "$PG_CONTAINER" \
            psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 < "$sql_file"
    fi
}

_psql_inline() {
    if command -v psql >/dev/null 2>&1 && [ -n "$DB_URL" ]; then
        psql "$DB_URL" -v ON_ERROR_STOP=1
    else
        docker compose exec -T "$PG_CONTAINER" \
            psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1
    fi
}

echo "=========================================="
echo "Step 1/6: Apply migrations"
echo "=========================================="
_psql_file backend/migrations/quotations_soft_delete.sql
_psql_file backend/migrations/quotations_onedrive.sql

echo ""
echo "=========================================="
echo "Step 2/6: (Re)start containers"
echo "=========================================="
# Some installs have services stopped — `up -d` is idempotent and
# starts them even if they were never up.
_services_to_restart="$BACKEND_CONTAINER"
[ -n "$WORKER_CONTAINER" ]   && _services_to_restart="$_services_to_restart $WORKER_CONTAINER"
[ -n "$FRONTEND_CONTAINER" ] && _services_to_restart="$_services_to_restart $FRONTEND_CONTAINER"
echo "Bringing up: $_services_to_restart"
# shellcheck disable=SC2086
docker compose up -d $_services_to_restart 2>/dev/null \
  || docker compose restart $_services_to_restart

echo "Waiting 15s for backend to come up..."
sleep 15

echo ""
echo "=========================================="
echo "Step 3/6: Verify M365 env vars (non-fatal)"
echo "=========================================="
docker compose exec -T "$BACKEND_CONTAINER" sh -c '
    for v in M365_TENANT_ID M365_CLIENT_ID M365_CLIENT_SECRET M365_DRIVE_ID; do
        if [ -z "$(printenv $v)" ]; then
            echo "WARN: $v not set in backend container — OneDrive sync will fail."
        else
            echo "OK: $v = $(printenv $v | head -c 8)... (truncated)"
        fi
    done
' || echo "WARN: env-var check failed; continuing."

echo ""
echo "=========================================="
echo "Step 4/6: Health check"
echo "=========================================="
HEALTH_URL="${HEALTH_URL:-http://localhost:8000/api/health}"
if curl -fsSL "$HEALTH_URL" | grep -q '"status"'; then
    echo "OK: backend responding."
else
    echo "FAIL: backend health check did not return expected payload."
    echo "Check logs: docker compose logs backend --tail=50"
    exit 1
fi

echo ""
echo "=========================================="
echo "Step 5/6: Run E2E test suite"
echo "=========================================="
echo "Set ERP_TEST_EMAIL / ERP_TEST_PASSWORD to override admin creds."

# Run inside the backend container so it has Python deps + can reach DB.
docker compose exec -T "$BACKEND_CONTAINER" sh -c "
    pip install -q httpx pytest openpyxl 2>&1 | tail -3
    cd /app
    RUN_E2E=1 \
    ERP_BASE_URL='${ERP_BASE_URL:-http://localhost:8000}' \
    ERP_TEST_EMAIL='${ERP_TEST_EMAIL:-thang@songchau.vn}' \
    ERP_TEST_PASSWORD='${ERP_TEST_PASSWORD:-SongChau@2026}' \
    pytest tests/e2e/test_bqms_quotation_e2e.py -v --tb=short
"

echo ""
echo "=========================================="
echo "Step 6/6: Cleanup test data"
echo "=========================================="
# The test suite already runs test_99_cleanup which hard-deletes anything with
# rfq_no ILIKE 'TEST-E2E-%'. Belt-and-braces sweep at SQL level too.
_psql_inline <<EOF
DELETE FROM quotations
WHERE rfq_no ILIKE 'TEST-E2E-%'
   OR rfq_no ILIKE 'PATCHED-RFQ%';
SELECT 'remaining test rows', COUNT(*)
FROM quotations
WHERE rfq_no ILIKE 'TEST-E2E-%' OR rfq_no ILIKE 'PATCHED-RFQ%';
EOF

echo ""
echo "=========================================="
echo "DONE. Manual verifications recommended:"
echo "=========================================="
echo "  1. Open ERP UI: /bqms/quotation/history — bạn sẽ thấy"
echo "     cột OneDrive với icon ☁ Mở / Lỗi / Chưa sync."
echo "  2. Click ☁ Mở để verify file QUOTATION PDF mở trong"
echo "     Office Online tab mới."
echo "  3. Click icon Share2 (chia sẻ) — link sẽ được copy vào"
echo "     clipboard, scope=anonymous (anyone-with-link)."
echo "  4. Tạo 1 báo giá thật — verify Excel chỉ có 1 dòng"
echo "     'Grand Total (VND)' với SUM đúng (Bug 1 đã fix)."
echo "  5. Dọn dẹp /data/files/quotations/ folder cũ nếu cần"
echo "     bằng:"
echo "        find /data/files -path '*RFQ*' -type d -mtime +30 -exec rm -rf {} +"
