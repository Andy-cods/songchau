# Vendor server deploy (45.124.95.32) — checklist

Nền ĐÃ xong: Docker 29.6.1, tunnel new↔old (systemd `vendor-tunnel.service` = Postgres 15432 + Redis 16379; `erp-data.service` = sshfs `/mnt/erp-data`).

## Khi có DOMAIN (Thang gửi) — các bước deploy:
1. **Bê code sang new**: `rsync -az backend/ vendor-portal/ root@45.124.95.32:/opt/vendor/{backend,vendor-portal}` (qua SSH cổng 22).
2. **Copy `.env`** từ server cũ `/opt/erp/.env` → new `/opt/vendor/.env` — **GIỮ NGUYÊN `SECRET_KEY`/JWT** (để token NCC do 2 máy phát ra hợp lệ chéo). Bỏ các biến scraper/BQMS không cần.
3. **Đổi bind tunnel sang docker gateway**: sửa `vendor-tunnel.service` từ `127.0.0.1:15432/16379` → `172.17.0.1:15432/16379` (để container chạm qua `host-gateway`). `systemctl daemon-reload && restart`.
4. **DNS**: trỏ A record domain NCC → `45.124.95.32`.
5. **nginx conf** `nginx/conf.d/vendor.conf`: server_name <domain>; `/api` → `vendor-api:8000`; `/` → `vendor-portal:3000`.
6. **TLS**: certbot cấp cert cho domain (webroot `/var/www/certbot`).
7. `docker compose -f docker-compose.vendor.yml up -d --build` → test cổng NCC end-to-end (đăng nhập NCC, xem RFQ, nộp báo giá, upload file → kiểm file rơi vào `/data` chung).

## Ràng buộc quan trọng
- `SC_ROLE=vendor` (cần thêm ở backend `main.py` để CHỈ mount vendor_router — tránh chạy scraper/worker BQMS trên máy này). *Nếu backend chưa có cờ này → phải thêm.*
- KHÔNG chạy sc-worker/scheduler/onlyoffice ở server mới (chúng thuộc ERP, giữ ở server cũ).
- File NCC upload → `/mnt/erp-data` (sshfs) → về server cũ, admin ERP đọc bình thường.

## Rủi ro cần lưu
- sshfs mount rớt → file upload fail; systemd `Restart=always` + `reconnect` giảm thiểu, nên có cảnh báo.
- Độ trễ tunnel: mọi query DB của NCC đi qua SSH → chậm hơn ~vài ms; chấp nhận được cho cổng NCC.
