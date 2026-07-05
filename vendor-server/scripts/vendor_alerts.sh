#!/usr/bin/env bash
# ============================================================================
# vendor_alerts.sh — 5 CHECK sức khoẻ vận hành cho SERVER VENDOR (45.124.95.32,
# cổng đấu thầu NCC). Khung bám theo scripts/alerts.sh của server MAIN: emit()
# + rotate + mỗi check bọc subshell riêng, IM LẶNG khi OK (tránh spam log).
#
# CHẠY QUA CRON (cài bởi phần cron của Đợt V, mỗi 5 phút):
#   */5 * * * * /opt/vendor/scripts/vendor_alerts.sh >> /opt/vendor/logs/cron_alerts.log 2>&1
# Chạy tay để kiểm tra ngay:
#   /opt/vendor/scripts/vendor_alerts.sh
#
# 5 CHECK (mỗi check ĐỘC LẬP — 1 check lỗi KHÔNG làm hỏng 4 check còn lại):
#   1) vendor-health     docker exec sc-vendor-api curl /api/health != "healthy"
#                        -> CRITICAL. /api/health kiểm cả DB + Redis (qua tunnel)
#                        nên check này cũng che luôn tunnel-DB/Redis.
#   2) vendor-tunnel     systemd vendor-tunnel không active HOẶC 172.17.0.1:15432
#                        không bắt được -> WARN.
#   3) vendor-data-mount canary. sshfs erp-data (old:/data -> /mnt/erp-data) +
#                        bind /mnt/erp-data/files -> container /data/files. Có 3
#                        trạng thái (xem check_data_mount).
#   4) vendor-disk       df -P / >= 85% -> WARN.
#   5) vendor-ssl        cert vendor.songchau.vn còn <= 14 ngày -> WARN.
#
# Format 1 dòng: <ISO-8601 UTC> <SEVERITY> <check> <chi tiết>  (giống alerts.sh)
#   Ví dụ: 2026-07-05T13:30:00Z CRITICAL vendor-health api khong healthy ...
#
# GHI LOG 2 NƠI:
#   - LOCAL  /opt/vendor/logs/alerts.log            (rotate khi > 5MB)
#   - MIRROR /mnt/erp-data/logs/alerts-vendor.log   (best-effort, qua sshfs về
#            MAIN). LƯU Ý TOPOLOGY: sshfs mount old:/data (KHÔNG phải
#            /opt/erp/data) -> file này nằm ở MAIN tại /data/logs/alerts-vendor.log.
#            Dùng FILE RIÊNG (KHÔNG append chung alerts.log của main) vì sshfs
#            không đảm bảo O_APPEND atomic giữa 2 host.
#
# `set -u` bắt biến chưa khai báo; CỐ Ý KHÔNG `set -e`/`pipefail` để 1 lệnh lỗi
# trong 1 check không làm cả script thoát sớm. Mỗi check còn bọc `( c ) || true`.
# KHÔNG hardcode secret: health đi qua docker exec (mạng nội bộ container).
# ============================================================================
set -u

# ── Hằng số / ngưỡng ─────────────────────────────────────────────────────
LOG_DIR="/opt/vendor/logs"
ALERT_LOG="${LOG_DIR}/alerts.log"
MIRROR_DIR="/mnt/erp-data/logs"
MIRROR_LOG="${MIRROR_DIR}/alerts-vendor.log"

VAPI="sc-vendor-api"
HEALTH_URL="http://localhost:8000/api/health"
TUNNEL_UNIT="vendor-tunnel"
TUNNEL_HOSTPORT_HOST="172.17.0.1"
TUNNEL_PG_PORT="15432"

# canary — lưới an toàn cho V-05 (stale FUSE bind sau khi sshfs remount).
CANARY_HOST="/mnt/erp-data/files/.mount-canary"   # host vendor thấy qua sshfs
CANARY_CONT="/data/files/.mount-canary"           # container thấy qua bind

SSL_CERT="/etc/letsencrypt/live/vendor.songchau.vn/fullchain.pem"

DISK_WARN_PCT=85
SSL_WARN_DAYS=14
ALERT_LOG_MAXBYTES=$((5 * 1024 * 1024))   # 5MB — ngưỡng rotate alerts.log

mkdir -p "${LOG_DIR}" 2>/dev/null || true
touch "${ALERT_LOG}" 2>/dev/null || true

# ── Helper chung ─────────────────────────────────────────────────────────
ts_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# emit: ghi LOCAL (kênh chính) + MIRROR best-effort sang MAIN. Chỉ gọi khi VƯỢT
# NGƯỠNG (im lặng khi OK) -> cả 2 file chỉ chứa cảnh báo thật, không spam.
emit() {
    local sev="$1" check="$2" detail="$3" line
    line="$(printf '%s %s %s %s' "$(ts_iso)" "${sev}" "${check}" "${detail}")"
    if ! printf '%s\n' "${line}" >> "${ALERT_LOG}" 2>/dev/null; then
        # Kênh local hỏng (quyền/disk đầy) — stderr là kênh dự phòng (cron redirect).
        echo "[alerts.log-fail] ${line}" >&2
    fi
    # MIRROR: best-effort, KHÔNG bao giờ làm check fail (sshfs có thể đang rớt).
    printf '%s\n' "${line}" >> "${MIRROR_LOG}" 2>/dev/null || true
}

is_uint() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }
have_docker() { command -v docker >/dev/null 2>&1; }

# ── Rotate alerts.log local nếu > 5MB (mv thành .1) ──────────────────────
rotate_alert_log() {
    local sz
    sz="$(wc -c < "${ALERT_LOG}" 2>/dev/null)"
    is_uint "${sz}" || sz=0
    if (( sz > ALERT_LOG_MAXBYTES )); then
        mv -f "${ALERT_LOG}" "${ALERT_LOG}.1" 2>/dev/null || true
        : > "${ALERT_LOG}" 2>/dev/null || true
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 1: vendor-health — /api/health phải chứa "status":"healthy"
# (che luôn DB + Redis vì /api/health kiểm cả 2 qua tunnel)
# ═══════════════════════════════════════════════════════════════════════
check_health() {
    have_docker || return 0
    local out
    out="$(docker exec "${VAPI}" curl -fsS -m10 "${HEALTH_URL}" 2>/dev/null)"
    if ! printf '%s' "${out}" | grep -q '"status":"healthy"'; then
        emit "CRITICAL" "vendor-health" "sc-vendor-api /api/health khong healthy (DB/Redis qua tunnel?) resp=$(printf '%s' "${out}" | head -c 120)"
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 2: vendor-tunnel — systemd active + TCP 172.17.0.1:15432 bắt được
# ═══════════════════════════════════════════════════════════════════════
check_tunnel() {
    if systemctl is-active --quiet "${TUNNEL_UNIT}" \
       && timeout 3 bash -c "</dev/tcp/${TUNNEL_HOSTPORT_HOST}/${TUNNEL_PG_PORT}" 2>/dev/null; then
        return 0
    fi
    emit "WARN" "vendor-tunnel" "${TUNNEL_UNIT} khong active hoac ${TUNNEL_HOSTPORT_HOST}:${TUNNEL_PG_PORT} khong bat duoc (DB/Redis NCC co the dut)"
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 3: vendor-data-mount — canary, LƯỚI cho V-05 (stale FUSE bind)
#   - host THẤY canary + container THẤY  -> OK (im lặng)
#   - host THẤY canary + container KHÔNG  -> stale bind: WARN + TỰ CHỮA
#     (docker restart sc-vendor-api để bind lại FUSE mới) + INFO đã self-heal
#   - host KHÔNG thấy canary              -> CRITICAL: sshfs erp-data rớt
# ═══════════════════════════════════════════════════════════════════════
check_data_mount() {
    have_docker || return 0

    if [[ -e "${CANARY_HOST}" ]]; then
        if docker exec "${VAPI}" test -e "${CANARY_CONT}" 2>/dev/null; then
            return 0   # cả 2 thấy -> mount + bind OK, im lặng
        fi
        # host thấy nhưng container KHÔNG -> FUSE bind cũ (stale). Tự chữa.
        emit "WARN" "vendor-data-mount" "stale bind: host thay canary nhung sc-vendor-api /data/files KHONG thay -> restart de bind lai FUSE moi"
        if docker restart "${VAPI}" >/dev/null 2>&1; then
            emit "INFO" "vendor-data-mount" "da self-heal: docker restart ${VAPI} xong (bind lai /data/files)"
        else
            emit "CRITICAL" "vendor-data-mount" "self-heal FAIL: docker restart ${VAPI} loi"
        fi
    else
        # host cũng KHÔNG thấy -> sshfs đứt (hoặc canary bị xoá trên MAIN /data/files)
        emit "CRITICAL" "vendor-data-mount" "host KHONG thay ${CANARY_HOST} -> sshfs erp-data co the da rot (hoac canary bi xoa tren MAIN:/data/files)"
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 4: vendor-disk — df -P / >= 85%
# ═══════════════════════════════════════════════════════════════════════
check_disk() {
    local pct
    pct="$(df -P / 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
    is_uint "${pct}" || return 0
    if (( pct >= DISK_WARN_PCT )); then
        emit "WARN" "vendor-disk" "/ dang dung ${pct}%"
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 5: vendor-ssl — cert vendor.songchau.vn còn <= 14 ngày
# ═══════════════════════════════════════════════════════════════════════
check_ssl() {
    if [[ ! -f "${SSL_CERT}" ]]; then
        # Cổng NCC BẮT BUỘC có TLS -> thiếu cert là bất thường -> WARN (không im lặng).
        emit "WARN" "vendor-ssl" "khong tim thay cert ${SSL_CERT}"
        return 0
    fi
    local enddate epoch now_epoch days
    enddate="$(openssl x509 -enddate -noout -in "${SSL_CERT}" 2>/dev/null | cut -d= -f2)"
    [[ -n "${enddate}" ]] || return 0
    epoch="$(date -d "${enddate}" +%s 2>/dev/null)"
    is_uint "${epoch}" || return 0
    now_epoch="$(date +%s)"
    days=$(( (epoch - now_epoch) / 86400 ))
    if (( days <= SSL_WARN_DAYS )); then
        emit "WARN" "vendor-ssl" "cert het han sau ${days} ngay (${SSL_CERT})"
    fi
}

# ═══════════════════════════════════════════════════════════════════════
# MAIN — 5 check, mỗi check bọc subshell + || true để cô lập lỗi
# ═══════════════════════════════════════════════════════════════════════
main() {
    rotate_alert_log

    ( check_health )      || true
    ( check_tunnel )      || true
    ( check_data_mount )  || true
    ( check_disk )        || true
    ( check_ssl )         || true
}

main "$@"
