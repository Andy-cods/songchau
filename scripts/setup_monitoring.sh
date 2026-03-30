#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Song Châu ERP — Cài đặt Beszel Monitoring Agent
# VPS: 103.56.158.129 (Ubuntu 24.04)
#
# Beszel agent chạy trong Docker (đã khai báo ở docker-compose),
# script này cấu hình hệ thống để agent có thể monitor đúng cách.
#
# Sử dụng: sudo ./scripts/setup_monitoring.sh [BESZEL_HUB_URL] [KEY]
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Màu sắc terminal ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

BESZEL_HUB_URL="${1:-}"
BESZEL_KEY="${2:-}"
LOG_DIR="/opt/erp/data/logs"
LOG_FILE="${LOG_DIR}/setup_monitoring.log"
COMPOSE_DIR="/opt/erp"

# ── Helper functions ──────────────────────────────────────────────
log()     { local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"; echo -e "${CYAN}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
success() { local msg="[$(date '+%Y-%m-%d %H:%M:%S')] OK  $*"; echo -e "${GREEN}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
warn()    { local msg="[$(date '+%Y-%m-%d %H:%M:%S')] WARN $*"; echo -e "${YELLOW}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
error()   { local msg="[$(date '+%Y-%m-%d %H:%M:%S')] ERR $*"; echo -e "${RED}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
header()  { echo -e "\n${BOLD}${BLUE}══════════════════════════════════════${NC}"; echo -e "${BOLD}${BLUE}  $*${NC}"; echo -e "${BOLD}${BLUE}══════════════════════════════════════${NC}\n"; }

mkdir -p "${LOG_DIR}"

header "Beszel Monitoring Agent Setup"
log "Bắt đầu cài đặt Beszel monitoring..."

# ── Kiểm tra quyền root ────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    error "Script này cần quyền root. Chạy: sudo $0"
    exit 1
fi

# ── 1. Cài đặt các công cụ monitoring cơ bản ─────────────────────
header "Bước 1: Cài đặt công cụ hệ thống"
log "Cập nhật package list..."
apt-get update -qq

log "Cài đặt: sysstat, iotop, htop, jq, curl..."
apt-get install -y -qq sysstat iotop htop jq curl net-tools lsof
success "Công cụ hệ thống đã được cài đặt"

# Bật sysstat để thu thập số liệu hệ thống
sed -i 's/ENABLED="false"/ENABLED="true"/' /etc/default/sysstat 2>/dev/null || true
systemctl enable sysstat 2>/dev/null || true
systemctl start sysstat 2>/dev/null || true
success "sysstat đã được bật"

# ── 2. Cấu hình node_exporter (prometheus metrics) ───────────────
header "Bước 2: Cài đặt Node Exporter"
NODE_EXPORTER_VERSION="1.8.2"
ARCH="linux-amd64"

if command -v node_exporter &>/dev/null; then
    warn "node_exporter đã được cài đặt, bỏ qua..."
else
    log "Tải node_exporter v${NODE_EXPORTER_VERSION}..."
    cd /tmp
    curl -sSL "https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.${ARCH}.tar.gz" \
        -o node_exporter.tar.gz
    tar -xzf node_exporter.tar.gz
    cp "node_exporter-${NODE_EXPORTER_VERSION}.${ARCH}/node_exporter" /usr/local/bin/
    chmod +x /usr/local/bin/node_exporter
    rm -rf node_exporter.tar.gz "node_exporter-${NODE_EXPORTER_VERSION}.${ARCH}"

    # Tạo systemd service cho node_exporter
    cat > /etc/systemd/system/node_exporter.service << 'SVCEOF'
[Unit]
Description=Node Exporter - Prometheus metrics cho Song Chau ERP
After=network.target

[Service]
Type=simple
User=nobody
ExecStart=/usr/local/bin/node_exporter \
    --collector.systemd \
    --collector.processes \
    --web.listen-address=127.0.0.1:9100
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
SVCEOF

    systemctl daemon-reload
    systemctl enable node_exporter
    systemctl start node_exporter
    success "node_exporter đã được cài đặt và khởi động (port 9100 - localhost only)"
fi

# ── 3. Thêm Beszel agent vào docker-compose nếu chưa có ──────────
header "Bước 3: Kiểm tra Beszel agent trong Docker Compose"
COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.yml"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
    warn "Không tìm thấy ${COMPOSE_FILE}. Bỏ qua bước này."
else
    if grep -q "beszel-agent\|beszel_agent" "${COMPOSE_FILE}" 2>/dev/null; then
        success "Beszel agent đã có trong docker-compose.yml"
    else
        warn "Beszel agent chưa có trong docker-compose.yml"
        log "Thêm Beszel agent service..."

        # Tạo file override riêng cho beszel
        cat > "${COMPOSE_DIR}/docker-compose.beszel.yml" << BESZELEOF
# docker-compose.beszel.yml — Beszel monitoring agent
# Chạy: docker compose -f docker-compose.yml -f docker-compose.beszel.yml up -d

services:
  beszel-agent:
    image: henrygd/beszel-agent:latest
    container_name: sc-beszel-agent
    restart: unless-stopped
    network_mode: host
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
    environment:
      LISTEN: 0.0.0.0:45876
      KEY: "${BESZEL_KEY:-REPLACE_WITH_BESZEL_KEY}"
    pid: host
    privileged: false
    cap_add:
      - SYS_PTRACE
BESZELEOF
        success "Đã tạo docker-compose.beszel.yml"
        log "Khởi động Beszel agent..."
        cd "${COMPOSE_DIR}" && docker compose -f docker-compose.yml -f docker-compose.beszel.yml up -d beszel-agent || \
            warn "Chưa thể khởi động — cần cung cấp BESZEL_KEY hợp lệ"
    fi
fi

# ── 4. Mở port cho Beszel trong firewall ─────────────────────────
header "Bước 4: Cấu hình Firewall cho Beszel"
if command -v ufw &>/dev/null; then
    # Chỉ cho phép Beszel hub kết nối vào agent port
    if [[ -n "${BESZEL_HUB_URL}" ]]; then
        BESZEL_HUB_IP=$(echo "${BESZEL_HUB_URL}" | sed 's|https\?://||' | cut -d: -f1 | cut -d/ -f1)
        ufw allow from "${BESZEL_HUB_IP}" to any port 45876 proto tcp comment "Beszel hub" 2>/dev/null || true
        success "Đã mở port 45876 cho ${BESZEL_HUB_IP}"
    else
        warn "Chưa cung cấp BESZEL_HUB_URL — bỏ qua cấu hình firewall cho Beszel"
        warn "Chạy thủ công: ufw allow from <BESZEL_HUB_IP> to any port 45876 proto tcp"
    fi
else
    warn "ufw không được cài đặt. Cấu hình firewall thủ công nếu cần."
fi

# ── 5. Tạo script kiểm tra trạng thái monitoring ─────────────────
header "Bước 5: Tạo script kiểm tra"
cat > /usr/local/bin/sc-monitoring-status << 'STATUSEOF'
#!/bin/bash
# Kiểm tra trạng thái monitoring services
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'

check() {
    local name="$1"; local cmd="$2"
    if eval "${cmd}" &>/dev/null; then
        echo -e "  ${GREEN}OK${NC}  ${name}"
    else
        echo -e "  ${RED}DOWN${NC}  ${name}"
    fi
}

echo -e "\n${BOLD}=== Song Châu ERP — Monitoring Status ===${NC}"
echo ""
echo "System services:"
check "sysstat"       "systemctl is-active sysstat"
check "node_exporter" "systemctl is-active node_exporter"
check "node_exporter metrics" "curl -sf http://127.0.0.1:9100/metrics"

echo ""
echo "Docker containers:"
check "Beszel Agent"  "docker ps --filter name=sc-beszel-agent --filter status=running | grep -q sc-beszel"

echo ""
echo "Node Exporter metrics URL: http://127.0.0.1:9100/metrics"
echo ""
STATUSEOF
chmod +x /usr/local/bin/sc-monitoring-status

# ── Tóm tắt ──────────────────────────────────────────────────────
header "Setup hoàn thành!"
echo -e "${GREEN}Monitoring agent đã được cài đặt:${NC}"
echo -e "  - sysstat       : thu thập số liệu hệ thống"
echo -e "  - node_exporter : metrics tại http://127.0.0.1:9100/metrics"
echo -e "  - Beszel agent  : container sc-beszel-agent"
echo ""
echo -e "${YELLOW}Bước tiếp theo:${NC}"
echo -e "  1. Truy cập Beszel Hub và thêm server 103.56.158.129:45876"
echo -e "  2. Copy Public Key từ Hub vào BESZEL_KEY trong docker-compose.beszel.yml"
echo -e "  3. Chạy: docker compose -f docker-compose.yml -f docker-compose.beszel.yml up -d"
echo -e "  4. Kiểm tra: sc-monitoring-status"
echo ""
success "Log: ${LOG_FILE}"
