#!/usr/bin/env bash
# ===========================================================================
# run_tests_ci.sh — W1-01 harness runner (VALIDATED 2026-07-03: 41 passed).
#
# Chạy pytest CI-safe TRÊN MỘT MÁY CÓ DOCKER (vd prod host /opt/erp/backend),
# CÔ LẬP TUYỆT ĐỐI khỏi prod DB (network riêng — prod postgres KHÔNG với tới).
#
# Vì sao không dùng run_tests.sh (host-pytest): host thường thiếu Docker/deps
# hoặc Python xung khắc (asyncpg 0.29 vs Py3.13). Cách này chạy pytest TRONG
# image backend (đủ Python 3.11 + deps) nên bền.
#
#   image test  = commit từ sc-api ĐANG CHẠY (code live)  [hoặc TEST_IMG=...]
#   DB test     = Postgres 16 tạm (tmpfs) trên network riêng
#   schema      = psql nạp _schema_snapshot.sql: pre-create extensions +
#                 sed search_path='' -> 'public' (pg_dump ép '' làm unaccent()
#                 không resolve) ; SCHEMA_PRELOADED=1 -> conftest chỉ dùng
#
# Dùng:  ./scripts/run_tests_ci.sh                  # smoke or unit
#        ./scripts/run_tests_ci.sh -m integration   # cần _schema_snapshot.sql
#        ./scripts/run_tests_ci.sh -k users -m smoke
# ===========================================================================
set -uo pipefail
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP="${BACKEND_DIR}/tests/_schema_snapshot.sql"
NET="${TEST_NET:-sctest_net}"; PG="${TEST_PG:-sctest-pg}"
IMG="${TEST_IMG:-}"; COMMITTED=""
PYTEST_ARGS=("$@"); [[ ${#PYTEST_ARGS[@]} -eq 0 ]] && PYTEST_ARGS=(-m "smoke or unit")

cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  [[ -n "$COMMITTED" ]] && docker rmi "$IMG" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ -z "$IMG" ]]; then
  IMG="sctest-api:ci"; echo ">> commit sc-api -> $IMG (chụp code live)"
  docker commit sc-api "$IMG" >/dev/null; COMMITTED=1
fi
docker network create "$NET" >/dev/null 2>&1 || true
docker rm -f "$PG" >/dev/null 2>&1 || true
echo ">> Postgres tạm ($PG, tmpfs, network $NET)"
docker run -d --name "$PG" --network "$NET" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_DB=sc_test -e POSTGRES_USER=sc_test -e POSTGRES_PASSWORD=sc_test \
  postgres:16-alpine -c fsync=off -c synchronous_commit=off \
  -c shared_preload_libraries=pg_stat_statements >/dev/null
for _ in $(seq 1 40); do
  docker exec "$PG" pg_isready -U sc_test -d sc_test >/dev/null 2>&1 && break; sleep 1
done
echo ">> pre-create extensions + nạp schema (psql, search_path=public)"
docker exec "$PG" psql -U sc_test -d sc_test -q -c \
  'CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS pg_stat_statements; CREATE EXTENSION IF NOT EXISTS btree_gin;' >/dev/null
if [[ -f "$SNAP" ]]; then
  docker cp "$SNAP" "$PG":/tmp/schema.sql
  docker exec "$PG" sed -i "s/set_config('search_path', '', false)/set_config('search_path', 'public', false)/" /tmp/schema.sql
  docker exec "$PG" psql -U sc_test -d sc_test -q -f /tmp/schema.sql
else
  echo "!! Không thấy $SNAP — integration test sẽ tự skip (chỉ smoke/unit)."
fi
# Quote từng arg (printf %q) để biểu thức marker nhiều từ ('smoke or unit or
# integration') KHÔNG bị word-split khi nhúng vào chuỗi `sh -c`.
PYTEST_Q=$(printf '%q ' "${PYTEST_ARGS[@]}")
echo ">> pytest ${PYTEST_Q}"
docker run --rm --network "$NET" --env-file "${ENV_FILE:-/opt/erp/.env}" \
  -e POSTGRES_DB=sc_test -e POSTGRES_USER=sc_test -e POSTGRES_PASSWORD=sc_test \
  -e TEST_DATABASE_URL="postgresql://sc_test:sc_test@${PG}:5432/sc_test" \
  -e SCHEMA_PRELOADED=1 -e APP_ENV=development -e COOKIE_SECURE=False \
  -v "${BACKEND_DIR}/tests":/app/tests -v "${BACKEND_DIR}/pytest.ini":/app/pytest.ini -w /app "$IMG" \
  sh -c "pip install -q pytest==8.2.2 pytest-asyncio==0.23.8 pyyaml 2>/dev/null; python -m pytest ${PYTEST_Q} -p no:cacheprovider"
