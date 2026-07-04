# Kiểm kê Secrets — Song Châu ERP (W4-04)

Mục đích: liệt kê MỌI secret thật hệ thống dùng — nằm ở đâu, ai/cái gì đọc
nó, cách xoay vòng (rotate) khi lộ/định kỳ. File `.env.example` (ở
`backend/.env.example`) chỉ chứa placeholder — KHÔNG có secret thật.

Quy ước mức độ:
- **P0** — lộ ra là mất dữ liệu/tiền/uy tín ngay (DB, JWT).
- **P1** — lộ ra ảnh hưởng 1 tích hợp/tính năng (BQMS, IMV, M365, Gemini).


## 1. Nơi lưu secret thật hiện tại

| Secret | Vị trí file | Trạng thái git |
|---|---|---|
| `songchau-erp/.env` (root — dùng bởi `docker-compose.yml` `env_file: .env` cho service `api`/`procrastinate-worker`/`procrastinate-scheduler`/`postgres`) | VPS + máy dev local | Đã có trong `.gitignore` dòng 1 (`.env`), xác nhận KHÔNG nằm trong `git ls-files` — chưa từng bị commit. |
| `backend/.env` (nếu chạy backend ngoài Docker, `Config.env_file=".env"` trong `app/core/config.py`) | máy dev local (nếu có) | Cùng pattern `.env` trong `.gitignore` — được ignore tự động (pattern không có `/` đầu nên áp dụng mọi thư mục con). |
| `app_config` (bảng Postgres, key `bqms_username`/`bqms_password`) | Database production | N/A (dữ liệu DB, không phải file) — override runtime cho BQMS, xem mục 3. |

**Xác nhận 2026-07-04**: đã chạy `git check-ignore -v .env` (khớp `.gitignore:1`) và
`git ls-files | grep env` (chỉ ra `Claude-Kit/.env.example`, KHÔNG có `.env`
thật) → secret trong `.env` chưa từng lọt vào lịch sử git.


## 2. Danh sách secret (theo biến env trong `backend/.env.example`)

| Biến | Mức | Dùng ở đâu | Cách xoay vòng |
|---|---|---|---|
| `POSTGRES_PASSWORD` | P0 | Kết nối Postgres trực tiếp (`docker-compose.yml` truyền vào container `postgres` + `api`/`worker`/`scheduler` qua `env_file`) | `ALTER USER scadmin WITH PASSWORD '<new>'` trong Postgres → sửa `POSTGRES_PASSWORD` **và** `DATABASE_URL` (chứa password lồng trong connection string — PHẢI sửa cả 2 cho khớp) trong `.env` trên VPS → `docker compose restart postgres api procrastinate-worker procrastinate-scheduler`. |
| `DATABASE_URL` | P0 | `app/core/config.py:async_database_url` — connection string đầy đủ, ưu tiên hơn `POSTGRES_*` nếu có giá trị | Xem trên (đi kèm `POSTGRES_PASSWORD`). |
| `JWT_SECRET_KEY` | P0 | Ký + verify access/refresh token (`app/core/security.py`) — TOÀN BỘ phiên đăng nhập | Tạo mới: `python -c "import secrets; print(secrets.token_hex(32))"` → cập nhật `.env` trên VPS → restart `sc-api` (+`sc-worker`/`sc-scheduler` nếu chúng cũng verify token). **Hệ quả: mọi user đang đăng nhập bị logout ngay lập tức** — nên xoay vào giờ thấp điểm, báo trước cho user. |
| `DB_ENCRYPTION_KEY` | P1 (dự phòng) | Khai báo trong `Settings` nhưng **CHƯA được code nào đọc** (đã grep `Fernet\|encrypt\|decrypt` trong `app/` — 0 kết quả). Giữ nguyên giá trị hiện có phòng khi tính năng mã hoá field-level được implement sau này; không cần xoay khẩn cấp vì chưa dùng. | Khi implement tính năng dùng nó: đổi key sẽ làm dữ liệu đã mã hoá cũ KHÔNG giải mã được nữa — cần kế hoạch re-encrypt, không xoay tuỳ tiện. |
| `BQMS_USERNAME` / `BQMS_PASSWORD` | P1 | Đăng nhập `sec-bqms.com` (scraper Playwright + push báo giá). **Có cơ chế override runtime**: `app/services/bqms_credentials.py` đọc từ bảng `app_config` (key `bqms_username`/`bqms_password`) trước, cache 30s, chỉ fallback về `settings.BQMS_*` (tức `.env`) nếu bảng không có override. | **Cách ưu tiên (không cần restart)**: gọi `PUT /bqms/scraper-settings/credentials` (đổi Samsung ép đổi mật khẩu định kỳ) — ghi vào `app_config`, `sc-worker`/`sc-scheduler` tự nhận trong ≤30s. Cách dự phòng: sửa `.env` + restart 3 container (xem `reference_vps_deploy_pattern`). |
| `IMV_USER_ID` / `IMV_PASSWORD` | P1 | Đăng nhập `imvmall.com` (scraper `app/etl/imv_playwright.py`) — **KHÔNG có** cơ chế override DB như BQMS, đọc thẳng `settings.IMV_*` | Sửa `.env` trên VPS → restart `sc-worker`/`sc-scheduler` (tiến trình chạy scraper). |
| `GEMINI_API_KEY` | P1 | OCR (`app/api/v1/ocr_service.py`) | Tạo key mới trong Google AI Studio → revoke key cũ → cập nhật `.env` → restart `sc-api`. |
| `M365_CLIENT_SECRET` | P1 | Đăng nhập app-only Microsoft Graph (đồng bộ OneDrive + gửi email qua `app/tasks/notifications.py`, `app/utils/email_sender.py`) — dùng MSAL confidential-client flow với `M365_TENANT_ID`/`M365_CLIENT_ID` | Tạo client secret mới trong Azure AD App Registration (Certificates & secrets) → xoá secret cũ → cập nhật `.env` → restart `sc-api`/`sc-worker`/`sc-scheduler`. **Hiện TRỐNG trên VPS** (chưa setup — xem ghi chú Thang cần chuẩn bị tài khoản M365). |
| `GRAPH_API_ACCESS_TOKEN` | P1 | **RIÊNG BIỆT** với `M365_CLIENT_SECRET` ở trên — dùng thẳng trong `app/api/v1/invoice_management.py:send_invoice_email()` để gọi Graph `sendMail`, đọc qua `os.getenv()` (không khai báo trong `Settings`). Đây là bearer token dán trực tiếp, không phải client-credentials flow. | Token Graph thường hết hạn ~1h nếu lấy qua delegated flow — **cần xác nhận với Thang cách token này được cấp/refresh** (có thể là thiết kế dở dang/legacy, nên cân nhắc hợp nhất về cùng 1 luồng MSAL client-credentials như `email_sender.py` để khỏi phải tay đổi token định kỳ). Ghi nhận là điểm cần dọn ở đợt sau, KHÔNG sửa trong W4-04 vì ngoài phạm vi. |

Biến **không phải secret** nhưng nhạy cảm nhẹ (không public nhưng lộ không
gây hại nghiêm trọng ngay): `M365_TENANT_ID`, `M365_CLIENT_ID`,
`M365_DRIVE_ID`, `BQMS_BASE_URL`, `IMV_BASE_URL` — vẫn nên giữ trong `.env`,
không hardcode, không cần quy trình rotate khẩn.


## 3. Phát hiện ngoài phạm vi Settings — secret hardcode trong code (BÁO, KHÔNG SỬA)

Khi grep toàn bộ `songchau-erp/` tìm secret hardcode, phát hiện **4 file ở
`songchau-erp/scripts/` (KHÔNG phải `backend/`) hardcode cùng 1 mật khẩu SSH
VPS thật** dạng biến `VPS_PASS = "x2dk4Tf2..."`:

- `scripts/deploy_bqms_5_tasks.py`
- `scripts/deploy_sourcing_orders.py`
- `scripts/deploy_sourcing_orders_option_b.py`
- `scripts/onedrive_sync_agent.py`

**Đã an toàn ở mức git**: cả 4 file này đã được thêm vào `.gitignore` (khối
"Ad-hoc scripts hardcode VPS creds (2026-07-04)") nên KHÔNG bị commit/lộ qua
git history hay remote. Tuy nhiên mật khẩu vẫn nằm dạng plaintext trên đĩa,
lặp lại y hệt ở cả 4 file (dùng chung 1 mật khẩu SSH root cho VPS) — nếu máy
dev bị lộ (mất laptop, backup OneDrive đồng bộ nhầm ra ngoài, v.v.) thì lộ
luôn quyền root VPS.

Không sửa các file này trong phạm vi W4-04 (thuộc `scripts/` ở root, không
phải `backend/app`, và đây là tooling deploy tay chứ không phải app runtime
đọc qua `Settings`). Khuyến nghị cho đợt sau: chuyển `VPS_PASS`/`VPS_HOST`/
`VPS_USER` sang đọc từ biến môi trường (`os.environ["VPS_PASS"]`, không có
default) hoặc SSH key thay vì password, và xoay mật khẩu SSH VPS này nếu
nghi ngờ đã từng rời khỏi máy dev.

Không phát hiện secret hardcode nào khác trong `backend/app/` — mọi
`settings.BQMS_PASSWORD`, `settings.M365_CLIENT_SECRET`,
`settings.JWT_SECRET_KEY`, ... đều đọc qua `Settings`/env, không có giá trị
mặc định là secret thật (default toàn bộ là chuỗi rỗng `""`).


## 4. Fail-fast (W4-04)

`backend/app/core/config.py` — `Settings._validate_production_requirements`
(model_validator mode="after"): khi `APP_ENV=production`, RAISE
`ValueError` lúc khởi động (import `app.core.config` → `settings =
Settings()`) nếu:

- Thiếu `JWT_SECRET_KEY`, hoặc ngắn hơn 32 ký tự, hoặc vẫn chứa chuỗi
  `"change-me"` (dấu hiệu copy nguyên từ `.env.example` quên đổi).
- Thiếu cả `DATABASE_URL` lẫn `POSTGRES_PASSWORD` (không có gì để build
  connection string), hoặc `DATABASE_URL`/`POSTGRES_PASSWORD` vẫn chứa
  `"change-me"`.
- Thiếu `APP_URL` (rỗng → CORS rơi về `allow_origins=["*"]` kèm
  `allow_credentials=True` trong `app/main.py`, không an toàn).

Khi `APP_ENV=development` (hoặc bất kỳ giá trị khác `"production"`), toàn
bộ kiểm tra trên được BỎ QUA — không cản trở dev. `tests/conftest.py` đã tự
đặt `APP_ENV=development` trước khi import app nên test suite không bị ảnh
hưởng.
