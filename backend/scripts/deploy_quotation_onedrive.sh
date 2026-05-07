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
BACKEND_CONTAINER="${BACKEND_CONTAINER:-backend}"
DB_URL="${DATABASE_URL:?Set DATABASE_URL e.g. postgresql://user:pass@host:5432/db}"

cd "$PROJECT_DIR"

echo "=========================================="
echo "Step 1/6: Apply migrations"
echo "=========================================="
psql "$DB_URL" -v ON_ERROR_STOP=1 -f backend/migrations/quotations_soft_delete.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f backend/migrations/quotations_onedrive.sql

echo ""
echo "=========================================="
echo "Step 2/6: Verify M365 env vars"
echo "=========================================="
docker compose exec -T "$BACKEND_CONTAINER" sh -c '
    for v in M365_TENANT_ID M365_CLIENT_ID M365_CLIENT_SECRET M365_DRIVE_ID; do
        if [ -z "$(printenv $v)" ]; then
            echo "WARN: $v not set in backend container — OneDrive sync will fail."
        else
            echo "OK: $v = $(printenv $v | head -c 8)... (truncated)"
        fi
    done
'

echo ""
echo "=========================================="
echo "Step 3/6: Restart containers"
echo "=========================================="
docker compose restart backend worker frontend

echo "Waiting 15s for backend to come up..."
sleep 15

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
psql "$DB_URL" -v ON_ERROR_STOP=1 <<EOF
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
