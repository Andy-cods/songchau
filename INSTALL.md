# INSTALL — Song Chau ERP (dựng mới ≤60 phút)

Hướng dẫn dựng hệ thống trên **máy Ubuntu trắng có Docker**. Mục tiêu: từ zero → ERP chạy được trong ~60 phút.

## 0. Yêu cầu
- Ubuntu 22.04+ (hoặc tương đương), **Docker + Docker Compose v2**, ≥ 4GB RAM, ≥ 20GB đĩa.
- (Tùy chọn) domain + DNS trỏ về server nếu cần HTTPS công khai.

## 1. Lấy mã nguồn
```bash
git clone https://github.com/Andy-cods/songchau.git /opt/erp
cd /opt/erp
```

## 2. Cấu hình môi trường
```bash
cp backend/.env.example /opt/erp/.env
# Sửa /opt/erp/.env: điền các biến BẮT BUỘC (xem chú thích trong file):
#   POSTGRES_* (mật khẩu DB), JWT_SECRET_KEY (chuỗi ngẫu nhiên ≥64 ký tự),
#   APP_ENV=production. M365/BQMS/IMV để trống nếu chưa dùng (app fail-safe).
```
> App **fail-fast** khi `APP_ENV=production` mà thiếu biến bắt buộc → sửa .env cho đủ.

## 3. Khởi động toàn bộ dịch vụ
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
# Dựng 7 container: sc-postgres, sc-redis, sc-api, sc-worker, sc-scheduler,
# sc-frontend, sc-nginx (+ gotenberg cho xuất PDF).
```

## 4. Nạp schema + migration
```bash
# Nạp schema gốc:
docker exec -i sc-postgres psql -U scadmin -d songchau_erp < backend/init_v3.sql
# Chạy các migration theo thứ tự (m40_pre → m41 → m42 → m43 → m44 → m45 → m47 → m48 + imv_module_v*):
for f in backend/migrations/*.sql; do
  docker cp "$f" sc-postgres:/tmp/m.sql
  docker exec sc-postgres psql -U scadmin -d songchau_erp -v ON_ERROR_STOP=0 -f /tmp/m.sql
done
```
> Migration đều idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING) — chạy lại an toàn.

## 5. (Tùy chọn) Seed dữ liệu mẫu
```bash
docker exec sc-api python scripts/seed_sample_data_v2.py   # nếu cần dữ liệu demo
```

## 6. Cài cron vận hành (backup/drill/alert)
```bash
sudo /opt/erp/scripts/install_crons.sh install
```

## 7. Xác minh
```bash
curl -s http://localhost/api/health | grep -o '"status":"[a-z]*"'   # → "healthy"
curl -s http://localhost/api/health | grep -o '"version":"[0-9.]*"' # → "1.0.0"
# Mở FE: http://<server-ip>/  (đăng nhập bằng tài khoản admin đã seed)
# Chạy cổng test (tùy chọn, cần Docker): ./backend/scripts/run_tests_ci.sh -m 'smoke or unit'
```

## 8. HTTPS (tùy chọn, có domain)
```bash
./scripts/ssl_setup.sh   # certbot; cron certbot tự gia hạn
```

---

**Khôi phục sự cố / vận hành:** xem [docs/RUNBOOK.md](docs/RUNBOOK.md).
**Deploy bản mới:** `./scripts/deploy.sh` (tự chạy cổng test + rollback nếu health fail).
**Khôi phục backup:** `./scripts/restore_backup.sh <file.dump> --drill` (thử) hoặc `<target_db>` (thật).
