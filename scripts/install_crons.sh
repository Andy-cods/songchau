#!/usr/bin/env bash
# ============================================================================
# install_crons.sh — Cài đặt 3 cron job vận hành cho Song Châu ERP (IDEMPOTENT:
# chạy lại bao nhiêu lần cũng an toàn, KHÔNG nhân đôi cron).
#
# CÁCH DÙNG (trên host Ubuntu, /opt/erp/scripts/):
#   sudo /opt/erp/scripts/install_crons.sh            # cài/refresh 3 cron cho root
#   sudo /opt/erp/scripts/install_crons.sh install     # (tương đương, tường minh)
#
# 3 CRON ĐƯỢC CÀI (mỗi dòng có marker "# SC-ERP-CRON:<name>" để nhận diện + gỡ
# trước khi cài lại — đây là cơ chế idempotent):
#   1) backup  — 02:00 hằng ngày:
#        pg_dump -Fc -Z6 songchau_erp qua `docker exec sc-postgres`, `docker cp` ra
#        /opt/erp/data/backups/daily_<TS>.dump. Retention: xoá daily_*.dump > 14 ngày.
#        Ghi kết quả OK(size)/FAIL vào /opt/erp/data/logs/alerts.log.
#   2) drill   — 03:00 Chủ Nhật hằng tuần:
#        Lấy backup daily_*.dump mới nhất, chạy restore_backup.sh --drill.
#        exit != 0 -> ghi CRITICAL vào alerts.log ("restore drill FAIL").
#   3) health  — mỗi 5 phút:
#        Gọi /opt/erp/scripts/alerts.sh (5 check ngưỡng — xem file đó).
#
# SCRIPT NÀY CŨNG LÀ WORKER CHO 2 CRON ĐẦU (tự gọi lại chính nó với sub-command,
# cron KHÔNG gọi trực tiếp pg_dump/psql):
#   install_crons.sh backup   # chạy 1 lần: backup + retention (do cron 02:00 gọi)
#   install_crons.sh drill    # chạy 1 lần: restore-drill (do cron CN 03:00 gọi)
#
# VÌ SAO GỘP BACKUP/DRILL VÀO FILE NÀY THAY VÌ TÁCH FILE RIÊNG (xem
# plans/w2-ops-scripts/PLAN.md QĐ-1): `date +%Y%m%d_%H%M%S` chạy BÊN TRONG script
# (không nằm literal trên dòng crontab) -> dòng cron KHÔNG chứa ký tự % -> KHÔNG
# cần escape \% trong crontab. Cron ngắn gọn, dễ đọc, dễ debug.
#
# KHÔNG hardcode secret: pg_dump/psql chạy qua `docker exec sc-postgres` (trust nội
# bộ container, cùng network Docker) — không cần mật khẩu Postgres trong file này.
# ============================================================================
set -uo pipefail

# ── Hằng số ────────────────────────────────────────────────────────────────
SCRIPTS_DIR="/opt/erp/scripts"
BACKUP_DIR="/opt/erp/data/backups"
LOG_DIR="/opt/erp/data/logs"
ALERT_LOG="${LOG_DIR}/alerts.log"
PGC="sc-postgres"
PGUSER="scadmin"
PGDB="songchau_erp"
RETENTION_DAYS=14
MARK="SC-ERP-CRON"

# ── Helper: ghi 1 dòng vào kênh alert DUY NHẤT (alerts.log) ────────────────
# Format: <ISO-8601 UTC> <SEVERITY> <check> <chi tiết>
ts_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

emit() {
    local sev="$1" check="$2" detail="$3" line
    line="$(printf '%s %s %s %s' "$(ts_iso)" "${sev}" "${check}" "${detail}")"
    mkdir -p "${LOG_DIR}" 2>/dev/null || true
    if ! printf '%s\n' "${line}" >> "${ALERT_LOG}" 2>/dev/null; then
        # Kênh alert DUY NHẤT bị hỏng (quyền/disk đầy/thư mục bị xoá) — in ra stderr
        # làm kênh dự phòng miễn phí (cron đã redirect stderr vào cron_*.log riêng).
        echo "[alerts.log-fail] ${line}" >&2
    fi
}

# ═══════════════════════════════════════════════════════════════════════════
# do_backup — pg_dump -Fc -Z6 songchau_erp -> daily_<TS>.dump, retention 14 ngày
# ═══════════════════════════════════════════════════════════════════════════
do_backup() {
    mkdir -p "${BACKUP_DIR}" "${LOG_DIR}" 2>/dev/null || true

    local ts in_container out_host
    ts="$(date +%Y%m%d_%H%M%S)"
    in_container="/tmp/daily_${ts}.dump"
    out_host="${BACKUP_DIR}/daily_${ts}.dump"

    if ! docker exec "${PGC}" pg_dump -U "${PGUSER}" -d "${PGDB}" -Fc -Z6 -f "${in_container}" 2>&1; then
        emit "FAIL" "backup" "pg_dump loi (TS=${ts})"
        docker exec "${PGC}" rm -f "${in_container}" >/dev/null 2>&1 || true
        return 1
    fi

    if ! docker cp "${PGC}:${in_container}" "${out_host}" 2>&1; then
        emit "FAIL" "backup" "docker cp loi (TS=${ts})"
        docker exec "${PGC}" rm -f "${in_container}" >/dev/null 2>&1 || true
        return 1
    fi
    docker exec "${PGC}" rm -f "${in_container}" >/dev/null 2>&1 || true

    # Guard: dump không được rỗng/hỏng trước khi coi là thành công
    if [[ ! -s "${out_host}" ]]; then
        emit "FAIL" "backup" "dump rong/hong: ${out_host}"
        return 1
    fi

    local size
    size="$(du -h "${out_host}" 2>/dev/null | cut -f1)"
    [[ -n "${size}" ]] || size="?"

    # Retention: CHỈ xoá daily_*.dump (namespace riêng của cron này — KHÔNG đụng
    # tới songchau_*.dump do scripts/backup.sh cũ tạo ra, tránh xoá nhầm backup khác)
    local deleted
    deleted="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'daily_*.dump' -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null | wc -l | tr -d ' ')"
    [[ -n "${deleted}" ]] || deleted=0

    emit "OK" "backup" "daily_${ts}.dump size=${size} da_xoa_cu=${deleted}"
    return 0
}

# ═══════════════════════════════════════════════════════════════════════════
# do_drill — restore-drill với backup daily_*.dump mới nhất
# ═══════════════════════════════════════════════════════════════════════════
do_drill() {
    mkdir -p "${LOG_DIR}" 2>/dev/null || true

    local latest
    latest="$(ls -1t "${BACKUP_DIR}"/daily_*.dump 2>/dev/null | head -1)"

    if [[ -z "${latest}" || ! -f "${latest}" ]]; then
        emit "CRITICAL" "restore-drill" "khong tim thay backup daily_*.dump nao trong ${BACKUP_DIR}"
        return 1
    fi

    if [[ ! -x "${SCRIPTS_DIR}/restore_backup.sh" ]]; then
        emit "CRITICAL" "restore-drill" "khong tim thay/khong chay duoc restore_backup.sh tai ${SCRIPTS_DIR}"
        return 1
    fi

    "${SCRIPTS_DIR}/restore_backup.sh" "${latest}" --drill
    local rc=$?

    if [[ "${rc}" -ne 0 ]]; then
        emit "CRITICAL" "restore-drill" "restore drill FAIL rc=${rc} file=$(basename "${latest}")"
        return 1
    fi

    # Thành công: KHÔNG ghi alerts.log (im lặng khi OK, tránh spam kênh cảnh báo).
    # Log chi tiết PASS đã có trong stdout của restore_backup.sh (cron redirect vào
    # /opt/erp/data/logs/cron_drill.log).
    return 0
}

# ═══════════════════════════════════════════════════════════════════════════
# do_install — cài/refresh 3 dòng cron cho root, idempotent qua marker
# ═══════════════════════════════════════════════════════════════════════════
do_install() {
    # Spec yêu cầu cài cron CHO ROOT — bắt buộc (không chỉ cảnh báo), vì nếu chạy
    # nhầm user thường, script sẽ "cài xong" vào SAI crontab (của user đó), 3 cron
    # thật sự cần chạy dưới root (docker exec, ghi /opt/erp/data/...) sẽ không tồn
    # tại mà không ai biết.
    if [[ "$(id -u)" -ne 0 ]]; then
        echo "LOI: can chay bang root/sudo de cai cron cho user root (dang chay boi $(id -un))." >&2
        exit 1
    fi

    mkdir -p "${LOG_DIR}" 2>/dev/null || true

    local l_backup l_drill l_health
    l_backup="0 2 * * * ${SCRIPTS_DIR}/install_crons.sh backup >> ${LOG_DIR}/cron_backup.log 2>&1 # ${MARK}:backup"
    l_drill="0 3 * * 0 ${SCRIPTS_DIR}/install_crons.sh drill >> ${LOG_DIR}/cron_drill.log 2>&1 # ${MARK}:drill"
    l_health="*/5 * * * * ${SCRIPTS_DIR}/alerts.sh >> ${LOG_DIR}/cron_alerts.log 2>&1 # ${MARK}:health"

    # Idempotent: bóc mọi dòng cron cũ có marker của mình rồi ghi lại 3 dòng mới.
    # `crontab -l` trả lỗi (exit != 0) nếu user chưa có crontab nào -> `|| true` để
    # không dừng script (set -u không set -e, nhưng để tường minh vẫn guard rõ ràng).
    local current
    current="$(crontab -l 2>/dev/null || true)"

    # QUAN TRỌNG: kiểm tra exit code của `crontab -`. Nếu không check, 1 lỗi ghi
    # crontab (syntax, quyền, crontab không cài) sẽ bị "set -uo pipefail" bỏ qua
    # (không có -e) và script vẫn in "Da cai xong" dù 3 cron CHƯA hề được cài —
    # false-positive nguy hiểm cho 1 script đảm bảo vận hành.
    if ! { printf '%s\n' "${current}" | grep -v "${MARK}" | grep -v '^[[:space:]]*$'
           printf '%s\n' "${l_backup}"
           printf '%s\n' "${l_drill}"
           printf '%s\n' "${l_health}"
         } | crontab -; then
        echo "LOI: ghi crontab that bai — 3 cron CHUA duoc cai. Kiem tra quyen/crontab da cai dat chua." >&2
        exit 1
    fi

    echo "Da cai xong 3 cron (marker: ${MARK}). Crontab hien tai:"
    echo "----------------------------------------------------------------------"
    crontab -l
    echo "----------------------------------------------------------------------"
}

# ── Entry point ──────────────────────────────────────────────────────────
main() {
    case "${1:-install}" in
        install) do_install ;;
        backup)  do_backup ;;
        drill)   do_drill ;;
        *)
            echo "Dung: $0 [install|backup|drill]" >&2
            exit 2
            ;;
    esac
}

main "$@"
