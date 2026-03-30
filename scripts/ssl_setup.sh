#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Song Châu ERP — Let's Encrypt SSL Setup
# Domain: erp.songchau.vn -> 103.56.158.129
#
# Điều kiện trước khi chạy:
#   1. Domain erp.songchau.vn đã trỏ A record về 103.56.158.129
#   2. Port 80 đang mở và Nginx đang chạy
#   3. Chạy với quyền root: sudo ./scripts/ssl_setup.sh
#
# Quá trình:
#   1. Cài đặt certbot
#   2. Obtain certificate qua HTTP-01 challenge (webroot)
#   3. Cài nginx SSL config
#   4. Setup auto-renewal cron
#   5. Test HTTPS
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Cấu hình ──────────────────────────────────────────────────────
DOMAIN="${SSL_DOMAIN:-erp.songchau.vn}"
EMAIL="${SSL_EMAIL:-admin@songchau.vn}"
VPS_IP="103.56.158.129"
COMPOSE_DIR="/opt/erp"
NGINX_CONF_DIR="${COMPOSE_DIR}/nginx/conf.d"
LOG_DIR="/opt/erp/data/logs"
LOG_FILE="${LOG_DIR}/ssl_setup.log"
WEBROOT="/var/www/certbot"

# ── Màu sắc ───────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ts()      { date '+%Y-%m-%d %H:%M:%S'; }
log()     { local msg="[$(ts)] $*"; echo -e "${CYAN}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
success() { local msg="[$(ts)] OK  $*"; echo -e "${GREEN}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
warn()    { local msg="[$(ts)] WARN $*"; echo -e "${YELLOW}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
error()   { local msg="[$(ts)] ERR $*"; echo -e "${RED}${msg}${NC}"; echo "${msg}" >> "${LOG_FILE}"; }
header()  {
    echo -e "\n${BOLD}${BLUE}══════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}  $*${NC}"
    echo -e "${BOLD}${BLUE}══════════════════════════════════════${NC}\n"
}

mkdir -p "${LOG_DIR}" "${WEBROOT}"

header "Song Châu ERP — SSL Setup"
log "Domain: ${DOMAIN} -> ${VPS_IP}"
log "Email:  ${EMAIL}"

# ── Kiểm tra quyền root ────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    error "Cần quyền root. Chạy: sudo SSL_DOMAIN=${DOMAIN} SSL_EMAIL=${EMAIL} $0"
    exit 1
fi

# ── Bước 0: Kiểm tra DNS đã trỏ đúng chưa ────────────────────────
header "Bước 0: Kiểm tra DNS"
log "Kiểm tra ${DOMAIN} trỏ về ${VPS_IP}..."

RESOLVED_IP=$(dig +short "${DOMAIN}" A 2>/dev/null | head -1 || nslookup "${DOMAIN}" 2>/dev/null | grep "Address:" | tail -1 | awk '{print $2}' || echo "")

if [[ -z "${RESOLVED_IP}" ]]; then
    error "Không thể resolve domain ${DOMAIN}"
    error "Đảm bảo:"
    error "  1. Đã thêm A record: ${DOMAIN} -> ${VPS_IP}"
    error "  2. DNS đã propagate (có thể mất đến 24 giờ)"
    error "  3. Kiểm tra: dig +short ${DOMAIN} A"
    exit 1
fi

if [[ "${RESOLVED_IP}" != "${VPS_IP}" ]]; then
    error "Domain ${DOMAIN} trỏ về ${RESOLVED_IP}, cần trỏ về ${VPS_IP}"
    error "Cập nhật DNS A record và chờ propagate rồi chạy lại."
    exit 1
fi

success "DNS OK: ${DOMAIN} -> ${RESOLVED_IP}"

# ── Bước 1: Cài đặt Certbot ───────────────────────────────────────
header "Bước 1: Cài đặt Certbot"

if command -v certbot &>/dev/null; then
    CERTBOT_VERSION=$(certbot --version 2>&1 | grep -o '[0-9.]*' | head -1)
    success "Certbot đã được cài đặt: v${CERTBOT_VERSION}"
else
    log "Cài đặt certbot..."
    apt-get update -qq
    apt-get install -y -qq certbot

    # Cài thêm plugin nếu cần
    apt-get install -y -qq python3-certbot-nginx 2>/dev/null || true

    success "Certbot đã được cài đặt: $(certbot --version 2>&1)"
fi

# ── Bước 2: Chuẩn bị Nginx cho HTTP challenge ────────────────────
header "Bước 2: Chuẩn bị Nginx cho ACME challenge"

# Thêm location /.well-known/acme-challenge vào nginx config hiện tại
# Nginx đang chạy trong Docker, cần expose webroot qua volume

log "Tạo nginx config tạm thời cho ACME challenge..."
cat > "${NGINX_CONF_DIR}/acme-challenge.conf" << 'ACMEEOF'
# Cấu hình tạm thời cho Let's Encrypt ACME HTTP-01 challenge
# File này được include từ default.conf
# Xóa sau khi SSL được cài đặt thành công

server {
    listen 80;
    server_name erp.songchau.vn www.erp.songchau.vn;

    # ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files $uri =404;
    }

    # Redirect tất cả traffic khác về HTTPS (sau khi có cert)
    location / {
        return 302 https://$host$request_uri;
    }
}
ACMEEOF

# Mount webroot vào nginx container
log "Cập nhật docker-compose để mount webroot..."

# Kiểm tra nginx container có mount webroot chưa
if docker inspect sc-nginx 2>/dev/null | grep -q "/var/www/certbot"; then
    success "Nginx đã mount /var/www/certbot"
else
    warn "Nginx container chưa mount /var/www/certbot"
    warn "Cần thêm volume vào docker-compose.yml:"
    warn "  nginx:"
    warn "    volumes:"
    warn "      - /var/www/certbot:/var/www/certbot:ro"
    warn ""
    warn "Restart nginx sau khi cập nhật:"
    warn "  docker compose up -d nginx"

    # Tạo temp nginx container để xử lý challenge
    log "Tạo temporary nginx để xử lý ACME challenge..."
    docker run -d --rm \
        --name certbot-temp-nginx \
        -p 80:80 \
        -v "${WEBROOT}:/var/www/certbot" \
        -v "${NGINX_CONF_DIR}:/etc/nginx/conf.d" \
        nginx:1.26-alpine &>/dev/null || true
fi

# ── Bước 3: Obtain SSL certificate ───────────────────────────────
header "Bước 3: Lấy SSL certificate"

# Dừng nginx container tạm thời để certbot có thể dùng port 80
# (dùng standalone mode thay vì webroot nếu nginx chưa setup)
if docker ps --filter "name=sc-nginx" --filter "status=running" | grep -q "sc-nginx"; then
    log "Dừng nginx tạm thời để certbot chạy standalone..."
    docker stop sc-nginx 2>/dev/null || true
    NGINX_WAS_RUNNING=true
else
    NGINX_WAS_RUNNING=false
fi

# Cleanup temp nginx nếu có
docker stop certbot-temp-nginx 2>/dev/null || true

log "Chạy certbot standalone..."
if certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "${EMAIL}" \
    --domain "${DOMAIN}" \
    --domain "www.${DOMAIN}" \
    --preferred-challenges http \
    --keep-until-expiring \
    2>>"${LOG_FILE}"; then

    success "SSL certificate đã được cấp!"
    success "Certificate: /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
    success "Private key:  /etc/letsencrypt/live/${DOMAIN}/privkey.pem"

    # Hiển thị thông tin certificate
    CERT_EXPIRY=$(openssl x509 -noout -enddate \
        -in "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" 2>/dev/null | cut -d= -f2 || echo "unknown")
    success "Hết hạn: ${CERT_EXPIRY}"
else
    error "Certbot thất bại! Xem log: ${LOG_FILE}"
    if [[ "${NGINX_WAS_RUNNING}" == "true" ]]; then
        docker start sc-nginx 2>/dev/null || true
    fi
    exit 1
fi

# ── Bước 4: Cài đặt SSL nginx config ─────────────────────────────
header "Bước 4: Cài đặt SSL Nginx config"

log "Cài đặt nginx SSL config..."
cp "${NGINX_CONF_DIR}/ssl.conf.template" "${NGINX_CONF_DIR}/ssl.conf" 2>/dev/null || \
    log "ssl.conf.template chưa có — sẽ dùng ssl.conf được tạo sẵn"

# Kích hoạt SSL config (rename default sang http-only)
mv "${NGINX_CONF_DIR}/default.conf" "${NGINX_CONF_DIR}/default.conf.http-only" 2>/dev/null || true
rm -f "${NGINX_CONF_DIR}/acme-challenge.conf"
log "Đã chuyển sang SSL config"

# Cập nhật nginx docker-compose để mount certbot volumes
cat > "${COMPOSE_DIR}/docker-compose.ssl.yml" << SSLCOMPOSEEOF
# docker-compose.ssl.yml — SSL overrides cho nginx
# Sử dụng: docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ssl.yml up -d nginx

services:
  nginx:
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./data/files:/data/files:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - /var/www/certbot:/var/www/certbot:ro
    ports:
      - "80:80"
      - "443:443"
SSLCOMPOSEEOF

# Khởi động lại nginx với SSL config
log "Khởi động nginx với SSL..."
cd "${COMPOSE_DIR}"
docker compose -f docker-compose.yml \
    -f docker-compose.prod.yml \
    -f docker-compose.ssl.yml \
    up -d nginx 2>>"${LOG_FILE}"

success "Nginx đã khởi động với SSL"

# ── Bước 5: Setup auto-renewal ────────────────────────────────────
header "Bước 5: Cấu hình Auto-Renewal"

# Tạo renewal hook để reload nginx sau khi renew
mkdir -p /etc/letsencrypt/renewal-hooks/post

cat > /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh << HOOKEOF
#!/bin/bash
# Reload nginx sau khi cert được renew tự động
docker exec sc-nginx nginx -s reload 2>/dev/null || \
    docker restart sc-nginx 2>/dev/null || true
echo "[\$(date '+%Y-%m-%d %H:%M:%S')] SSL cert renewed và nginx reloaded" >> /opt/erp/data/logs/ssl_renewal.log
HOOKEOF
chmod +x /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh

# Thêm cron job cho auto-renewal (chạy 2 lần/ngày theo khuyến nghị của Let's Encrypt)
CRON_LINE="0 2,14 * * * root certbot renew --quiet --no-self-upgrade 2>> /opt/erp/data/logs/ssl_renewal.log"
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
    (crontab -l 2>/dev/null; echo "${CRON_LINE}") | crontab -
    success "Cron auto-renewal đã được cài đặt (02:00 và 14:00 hàng ngày)"
else
    success "Cron auto-renewal đã tồn tại"
fi

# Test renewal (dry-run)
log "Test renewal (dry-run)..."
if certbot renew --dry-run --quiet 2>>"${LOG_FILE}"; then
    success "Dry-run renewal: PASSED"
else
    warn "Dry-run renewal có vấn đề — kiểm tra log: ${LOG_FILE}"
fi

# ── Bước 6: Test HTTPS ─────────────────────────────────────────────
header "Bước 6: Test HTTPS"

sleep 3  # Chờ nginx khởi động

log "Kiểm tra HTTPS..."
if curl -sf --max-time 15 "https://${DOMAIN}/api/health" -o /dev/null; then
    success "HTTPS hoạt động: https://${DOMAIN}/api/health"
else
    warn "HTTPS chưa phản hồi — có thể nginx cần thêm thời gian"
    warn "Kiểm tra thủ công: curl -v https://${DOMAIN}/api/health"
fi

# Kiểm tra HTTP redirect sang HTTPS
HTTP_RESPONSE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "http://${DOMAIN}/" 2>/dev/null || echo "000")
if [[ "${HTTP_RESPONSE}" =~ ^30[0-9]$ ]]; then
    success "HTTP -> HTTPS redirect hoạt động (${HTTP_RESPONSE})"
else
    warn "HTTP redirect: ${HTTP_RESPONSE} (có thể chưa cấu hình)"
fi

# ── Tóm tắt ──────────────────────────────────────────────────────
header "SSL Setup hoàn thành!"
echo -e "${GREEN}Kết quả:${NC}"
echo -e "  Domain    : https://${DOMAIN}"
echo -e "  Cert      : /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
echo -e "  Hết hạn   : ${CERT_EXPIRY:-$(openssl x509 -noout -enddate -in "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" 2>/dev/null | cut -d= -f2)}"
echo -e "  Auto-renew: Cron 02:00 + 14:00 hàng ngày"
echo -e "  Compose   : ${COMPOSE_DIR}/docker-compose.ssl.yml"
echo ""
echo -e "${YELLOW}Lệnh hữu ích:${NC}"
echo -e "  certbot certificates                    # Xem tất cả certs"
echo -e "  certbot renew --dry-run                 # Test renewal"
echo -e "  openssl s_client -connect ${DOMAIN}:443  # Debug SSL"
echo ""
success "Log: ${LOG_FILE}"
