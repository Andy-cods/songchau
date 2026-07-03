#!/usr/bin/env bash
# ===========================================================================
# scripts/run_tests.sh — one command to run the W1-01 harness CI-safely.
#
#   up (docker-compose.test.yml, --wait for healthy)  ->  pytest  ->  down -v
#
# Idempotent: run it twice in a row and both go green with NO side effects
# (the DB is tmpfs + `down -v` wipes it; conftest DROPs+reloads schema/session
# and rolls back every test's writes).
#
# Usage:
#   scripts/run_tests.sh                 # default: smoke + unit (no snapshot needed)
#   scripts/run_tests.sh --all           # everything incl. integration + e2e
#   scripts/run_tests.sh -m smoke        # any pytest marker expression
#   scripts/run_tests.sh --keep          # leave containers up for debugging
#   scripts/run_tests.sh --keep -m integration -k suppliers   # extra pytest args
#
# Requirements on the HOST: Docker (compose v2) + a Python env with the backend
# deps installed (`pip install -r requirements.txt`). pytest imports the app in
# process, so the app's libraries must be importable.
# ===========================================================================
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${BACKEND_DIR}/docker-compose.test.yml"
COMPOSE=(docker compose -f "${COMPOSE_FILE}")

KEEP=0
MARKER_SET=0
PYTEST_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --all) PYTEST_ARGS+=("-m" "smoke or unit or integration"); MARKER_SET=1; shift ;;
    -m) PYTEST_ARGS+=("-m" "$2"); MARKER_SET=1; shift 2 ;;
    *) PYTEST_ARGS+=("$1"); shift ;;
  esac
done

# Default marker selection: the fast, self-contained tiers that need no prod
# snapshot. Integration/e2e are opt-in (--all or -m).
if [[ "${MARKER_SET}" -eq 0 ]]; then
  PYTEST_ARGS=("-m" "smoke or unit" "${PYTEST_ARGS[@]}")
fi

# Env the harness (conftest.py) + run_tests share. Match docker-compose.test.yml.
export TEST_DATABASE_URL="postgresql://sc_test:sc_test@127.0.0.1:55432/sc_test"
export REDIS_URL="redis://127.0.0.1:56379/0"
export JWT_SECRET_KEY="${JWT_SECRET_KEY:-test-harness-jwt-secret-not-for-prod}"
export APP_ENV="development"
export COOKIE_SECURE="False"
export POSTGRES_DB="sc_test"
export POSTGRES_USER="sc_test"
export POSTGRES_PASSWORD="sc_test"

cleanup() {
  if [[ "${KEEP}" -eq 1 ]]; then
    echo ">> --keep set: leaving test containers up."
    echo "   Postgres: 127.0.0.1:55432   Redis: 127.0.0.1:56379"
    echo "   Tear down with: ${COMPOSE[*]} down -v"
  else
    echo ">> Tearing down test containers (down -v)..."
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo ">> Starting ephemeral Postgres + Redis (tmpfs, ports 55432/56379)..."
# Fresh every run — clear any leftovers first, then wait for healthy.
"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
if ! "${COMPOSE[@]}" up -d --wait; then
  echo "!! 'up --wait' failed; falling back to a manual health poll." >&2
  "${COMPOSE[@]}" up -d
  for _ in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T postgres-test pg_isready -U sc_test -d sc_test >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

echo ">> Running pytest ${PYTEST_ARGS[*]}"
cd "${BACKEND_DIR}"
# conftest.py loads the schema (snapshot if present, else bootstrap) in a
# session fixture, so there is no separate schema-load step here.
set +e
python -m pytest "${PYTEST_ARGS[@]}"
RC=$?
set -e

echo ">> pytest exit code: ${RC}"
exit "${RC}"
