#!/usr/bin/env bash
# ============================================================================
# restore_backup.sh — Khôi phục backup custom-format (pg_dump -Fc) ĐẦY ĐỦ 182/182.
#
# VÌ SAO CẦN WRAPPER: 4 bảng (customers/inventory/products/suppliers) có GENERATED
# STORED column `*_unaccent = immutable_unaccent(lower(...))`. Hàm immutable_unaccent
# gọi unaccent(); pg_dump phát search_path='' → khi pg_restore tính cột generated,
# unaccent() không resolve → 4 bảng + view/matview phụ thuộc KHÔNG restore (chỉ 170/182).
# CÁCH XỬ LÝ (đã kiểm chứng 182/182 + matview 7/7 + đủ data):
#   1) pre-create extensions (unaccent/uuid-ossp/pg_trgm/btree_gin) trong target
#   2) pre-create immutable_unaccent với `SET search_path=public` (NON-INLINABLE)
#      → pg_restore dùng bản này (CREATE FUNCTION trong dump báo "already exists" —
#        vô hại), cột generated tính qua function-call với search_path riêng → OK
#   3) pg_restore --no-owner --no-privileges
#
# LƯU Ý QUAN TRỌNG (bài học 2026-07-03): khi copy dump giữa container PHẢI dùng
# `docker cp sc-postgres:/path host:/path` rồi `docker cp host:/path target:/path`
# — copy nhầm từ /tmp HOST có thể lấy dump STALE (thiếu bảng) → restore thiếu dữ liệu.
#
# DÙNG:
#   ./restore_backup.sh <backup.dump> --drill            # restore thử vào Postgres tạm, verify, xoá
#   ./restore_backup.sh <backup.dump> <target_db_name>   # restore thật vào DB mới (KHÔNG ghi đè prod)
# Trả exit 0 nếu đạt đủ số bảng kỳ vọng (mặc định 182, chỉnh qua EXPECT_TABLES).
# ============================================================================
set -uo pipefail

DUMP="${1:?Thiếu tham số: đường dẫn file backup .dump}"
MODE="${2:?Thiếu tham số: --drill hoặc <target_db_name>}"
PGC="${PG_CONTAINER:-sc-postgres}"
PGUSER="${PGUSER:-scadmin}"
EXPECT_TABLES="${EXPECT_TABLES:-182}"
EXTS="CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS btree_gin;"
FIXED_FUNC="CREATE OR REPLACE FUNCTION public.immutable_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public,pg_catalog AS 'SELECT public.unaccent(\$1)';"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
say()  { echo -e "${YELLOW}[restore]${NC} $*"; }
ok()   { echo -e "${GREEN}[restore] OK${NC} $*"; }
die()  { echo -e "${RED}[restore] LỖI${NC} $*"; exit 1; }

[[ -f "$DUMP" ]] || die "Không thấy file backup: $DUMP"

# GUARD: dump phải hợp lệ + đủ bảng (bắt dump truncate/anomaly trước khi restore)
DUMPNAME="$(basename "$DUMP")"
docker cp "$DUMP" "$PGC:/tmp/$DUMPNAME" || die "Không copy được dump vào $PGC"
N_TABLE=$(docker exec "$PGC" sh -c "pg_restore -l /tmp/$DUMPNAME 2>/dev/null | grep -cE 'TABLE public '") || N_TABLE=0
say "Dump chứa $N_TABLE TABLE entries"
[[ "$N_TABLE" -ge 170 ]] || die "Dump nghi hỏng/thiếu bảng ($N_TABLE < 170) — KHÔNG restore. Kiểm tra file backup."
HAS_LP=$(docker exec "$PGC" sh -c "pg_restore -l /tmp/$DUMPNAME 2>/dev/null | grep -c 'TABLE public leave_policy '")
[[ "$HAS_LP" == "1" ]] || die "Dump thiếu bảng HR (leave_policy) — nghi backup không hoàn chỉnh."

if [[ "$MODE" == "--drill" ]]; then
  NET="screstore_drill_net"; TPG="screstore-drill-pg"
  cleanup(){ docker rm -f "$TPG" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; docker exec "$PGC" rm -f "/tmp/$DUMPNAME" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  say "DRILL: dựng Postgres tạm (tmpfs, network riêng)"
  docker network create "$NET" >/dev/null 2>&1 || true
  docker rm -f "$TPG" >/dev/null 2>&1 || true
  docker run -d --name "$TPG" --network "$NET" --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_DB=drill -e POSTGRES_USER="$PGUSER" -e POSTGRES_PASSWORD=drill \
    postgres:16-alpine -c fsync=off >/dev/null
  for _ in $(seq 1 40); do docker exec "$TPG" pg_isready -U "$PGUSER" -d drill >/dev/null 2>&1 && break; sleep 1; done
  docker exec "$TPG" psql -U "$PGUSER" -d drill -c "$EXTS" >/dev/null
  docker exec "$TPG" psql -U "$PGUSER" -d drill -c "$FIXED_FUNC" >/dev/null
  docker cp "$DUMP" "$TPG:/tmp/$DUMPNAME"
  say "pg_restore vào DB tạm..."
  docker exec "$TPG" pg_restore -U "$PGUSER" -d drill --no-owner --no-privileges "/tmp/$DUMPNAME" 2>&1 \
    | grep -iE 'error' | grep -viE 'already exists' | head -10 || true
  GOT=$(docker exec "$TPG" psql -U "$PGUSER" -d drill -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  MV=$(docker exec "$TPG" psql -U "$PGUSER" -d drill -t -A -c "SELECT count(*) FROM pg_matviews")
  say "Kết quả DRILL: $GOT/$EXPECT_TABLES bảng+view, $MV matview"
  [[ "$GOT" -ge "$EXPECT_TABLES" ]] && { ok "DRILL PASS — backup restore được đầy đủ ($GOT bảng, $MV matview)"; exit 0; } \
    || die "DRILL FAIL — chỉ $GOT/$EXPECT_TABLES bảng"
else
  TARGET="$MODE"
  say "RESTORE THẬT vào DB mới '$TARGET' (KHÔNG đụng prod songchau_erp)"
  docker exec "$PGC" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$TARGET\"" 2>&1 | grep -vi 'already exists' || true
  docker exec "$PGC" psql -U "$PGUSER" -d "$TARGET" -c "$EXTS" >/dev/null
  docker exec "$PGC" psql -U "$PGUSER" -d "$TARGET" -c "$FIXED_FUNC" >/dev/null
  say "pg_restore..."
  docker exec "$PGC" pg_restore -U "$PGUSER" -d "$TARGET" --no-owner --no-privileges "/tmp/$DUMPNAME" 2>&1 \
    | grep -iE 'error' | grep -viE 'already exists' | head -10 || true
  GOT=$(docker exec "$PGC" psql -U "$PGUSER" -d "$TARGET" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  docker exec "$PGC" rm -f "/tmp/$DUMPNAME"
  [[ "$GOT" -ge "$EXPECT_TABLES" ]] && { ok "RESTORE PASS vào '$TARGET' ($GOT bảng). Đổi tên/điểm-tới DB này khi sẵn sàng."; exit 0; } \
    || die "RESTORE FAIL — chỉ $GOT/$EXPECT_TABLES bảng trong '$TARGET'"
fi
