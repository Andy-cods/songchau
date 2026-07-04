# ARCHITECTURE.md — Kiến trúc hệ thống Song Châu ERP

> Nguồn: đọc trực tiếp `backend/docker-compose.yml` (ở gốc repo), `backend/app/main.py`,
> `backend/app/api/v1/__init__.py`, `backend/app/core/*`, `backend/app/services/*`,
> `backend/app/tasks/*`, `backend/app/etl/*`, `nginx/conf.d/*.conf`. Bổ sung/đối chiếu:
> `docs/SYSTEM_EVENT_MAP.md` (bản đồ sự kiện chi tiết hơn, 30/03/2026 — một số router đã
> đổi từ khi viết, xem ghi chú "đã lỗi thời" bên dưới).

## 1. Bức tranh tổng thể

Song Châu ERP là hệ thống nội bộ cho một công ty thương mại: mua phụ tùng từ NCC
Trung Quốc → bán cho Samsung Việt Nam qua cổng đấu thầu **BQMS** (sec-bqms.com), song
song có module **Đấu thầu NCC** (vendor bidding, tự vận hành), **Sourcing** (tìm/lưu giá
nguồn hàng ngoài BQMS), **Tài chính** (AR/AP, cash book, tỷ giá), **CRM**, và **HR**
(nghỉ phép, chấm công, KPI). Kiến trúc theo hướng **event-driven / chain-reaction**: một
hành động (Samsung đăng RFQ, NCC gửi báo giá, hàng về kho, thanh toán...) tự động kích
hoạt bước tiếp theo qua kết hợp DB trigger (`pg_notify`), Procrastinate task queue, và
Socket.IO realtime — giảm thao tác tay.

## 2. Stack công nghệ (đọc từ code thật)

| Lớp | Công nghệ | Ghi chú |
|---|---|---|
| Frontend chính | Next.js `14.2.35` (React) | container `sc-frontend`, build riêng, `NEXT_PUBLIC_API_URL=/api` |
| Vendor portal | Next.js riêng (container `sc-vendor-portal`, cổng nội bộ `3001`) | app riêng cho NCC, domain/route tách biệt qua nginx |
| Backend API | FastAPI `0.111.0` (Python), Uvicorn `0.30.1` | container `sc-api`, KHÔNG dùng ORM |
| DB layer | `asyncpg` `0.29.0` trực tiếp (raw SQL) | `app/models/` và `app/repositories/` **rỗng** (không file nào) — toàn bộ query nằm thẳng trong `app/api/v1/*.py` và `app/services/*.py` |
| Database | PostgreSQL `16-alpine` | container `sc-postgres`, tuning thủ công (`shared_buffers=1536MB`, `pg_stat_statements`, `log_min_duration_statement=500`) |
| Task queue | Procrastinate `2.14.0` (Postgres-backed, KHÔNG dùng Redis làm broker) | 2 container riêng: `sc-worker` (concurrency 5, xử lý job deferred từ API) và `sc-scheduler` (concurrency 1, `--listen-notify`, chạy các periodic/cron task — tách riêng để tránh 2 worker cùng fire 1 lịch định kỳ) |
| Cache / rate-limit | Redis `7-alpine` | dùng cho `app/core/cache.py` (RedisCache — cache theo TTL từng loại data) + `app/core/rate_limit.py` (rate-limit các endpoint auth); **không** phải hàng đợi Procrastinate. `slowapi` (endpoint Sourcing/BQMS nặng) mặc định lưu in-memory, không qua Redis |
| Realtime | `python-socketio[asyncio]` 5.14 | mount tại `/ws` (ASGI app riêng, mount SAU cùng để không chặn route HTTP) |
| PDF/Office | Gotenberg 8 (`sc-libreoffice`, LibreOffice headless, timeout 120s) + OnlyOffice Document Server (`sc-onlyoffice`, `JWT_ENABLED=false`) | Gotenberg dùng để export báo giá/dossier ra PDF; OnlyOffice cho phép sửa file xlsx/docx ngay trên trình duyệt (`app/api/v1/onlyoffice.py`, callback lưu file khi OnlyOffice POST ngược) |
| Reverse proxy | nginx `1.26-alpine` (`sc-nginx`) | 2 server block: `default.conf` (domain ERP chính, cổng 80/443/8080) + `vendor.conf` (domain cổng NCC) |
| Observability | `prometheus-fastapi-instrumentator` 7.0 tại `/metrics` (không nằm trong OpenAPI schema, không có `location /metrics` trong nginx → **không lộ ra ngoài internet**, chỉ truy cập được qua network nội bộ Docker) | JSON structured logging (`app/core/logging_config.py`) với `request_id`/`user_id`/`route`/`latency_ms` |

### 2.1 Container thực tế (docker-compose.yml)

**10 service**, không phải 7 — CẦN THANG XÁC NHẬN nếu con số "7" trong yêu cầu ban đầu
đến từ một bản compose cũ hơn:

1. `postgres` (sc-postgres) — DB chính
2. `redis` (sc-redis) — cache + rate-limit
3. `api` (sc-api) — FastAPI backend
4. `frontend` (sc-frontend) — Next.js ERP chính
5. `nginx` (sc-nginx) — reverse proxy, cổng public 80/443/8080
6. `vendor-portal` (sc-vendor-portal) — Next.js cổng NCC
7. `procrastinate-worker` (sc-worker) — task queue worker (concurrency 5)
8. `procrastinate-scheduler` (sc-scheduler) — periodic task runner (concurrency 1, listen-notify)
9. `gotenberg` (sc-libreoffice) — render PDF
10. `onlyoffice` (sc-onlyoffice) — editor xlsx/docx in-browser

Nếu chỉ đếm "lõi vận hành 24/7 chính" (bỏ 2 service phụ trợ ít quan trọng là
`onlyoffice` + `gotenberg`, hoặc gộp worker+scheduler làm 1 khái niệm "Procrastinate"),
có thể ra 7-8 tuỳ cách đếm — nhưng thực tế compose file định nghĩa đúng 10 container độc lập.

## 3. Cấu trúc `backend/app/`

```
app/
├── main.py            FastAPI app: lifespan (mở db_pool/redis/procrastinate),
│                       middleware (rate-limit, IP block, size limit, content-type,
│                       CORS, request tracing, Prometheus, BQMS kill-switch,
│                       security headers/no-store), mount routers + /ws Socket.IO
├── api/
│   ├── health.py       /api/health, /liveness, /readiness — no-auth, dùng cho
│   │                    docker healthcheck
│   ├── v1/              ~60 route module, mount qua app/api/v1/__init__.py dưới
│   │                    prefix /api/v1 (xem docs/API.md để có danh sách đầy đủ)
│   └── vendor/           11 route module riêng, mount ở app/main.py dưới
│                        /api/vendor (KHÔNG nằm trong v1_router) — cổng NCC cô lập
├── core/                config, database (asyncpg pool), cache (Redis), security
│                        (JWT), rbac (require_role — RBAC chokepoint), procrastinate_app,
│                        rate_limit, slowapi_limiter, security_middleware, audit,
│                        logging_config, concurrency
├── services/            business logic thuần (không phải route handler):
│                        bqms_* (10 file — scrape/push/state-machine/dossier cho Samsung),
│                        chain_service.py (event spine Đơn↔PO↔Giao hàng↔Tài chính),
│                        workflow_engine.py (state machine duyệt đa cấp),
│                        sourcing_pricing_engine.py, gotenberg_service.py,
│                        quote_renderer.py, event_notifications.py, dossier_*,
│                        samsung_session_lock.py (pg_advisory_lock chống 2 phiên
│                        Samsung chạy song song)
├── tasks/                ~24 file định nghĩa Procrastinate task (deferred + periodic):
│                        bqms_periodic_scrape, bqms_sync, bqms_won_sync, fx_rates_sync,
│                        kpi_aggregator, notifications, reports, revenue_chain,
│                        audit_retention, onedrive_sync, imv_sync, procurement_deadlines...
├── etl/                  scraper/client low-level: bqms_playwright.py,
│                        samsung_bqms_client.py, bqms_po_api.py, bqms_bidding_scraper.py,
│                        bqms_contract_scraper.py, bqms_dossier_scraper.py,
│                        bqms_l1_l3_scraper.py, bqms_mro_scraper.py, imv_playwright.py,
│                        onedrive_client.py
├── websocket/            Socket.IO ASGI app: auth.py + handlers.py (emit_workflow_update,
│                        emit_notification, emit_stock_alert, emit_bqms_sync_done,
│                        emit_report_ready — room-based)
├── utils/                email_sender.py, excel_writer.py, pdf_parser.py
├── models/               RỖNG (không file) — không dùng lớp model/ORM
└── repositories/         RỖNG (không file) — không dùng repository pattern
```

**Điểm kiến trúc quan trọng**: đây KHÔNG phải codebase kiểu ORM/repository truyền
thống. Mọi câu SQL viết trực tiếp (asyncpg) ngay trong route handler hoặc service —
`app/models/` và `app/repositories/` tồn tại như thư mục rỗng (có thể là chỗ đặt chỗ dự
định ban đầu, chưa từng được dùng).

## 4. RBAC & bảo mật tầng API (tóm tắt — chi tiết xem `docs/RBAC_MATRIX.md`)

- Cổng chặn duy nhất: `require_role(*roles, allow_viewer=True)` trong
  `app/core/rbac.py`. Viewer mặc định bypass (đọc được mọi GET), trừ khi
  `allow_viewer=False` (nhóm "giá nội bộ").
- Row Level Security (RLS) có bật ở 4 bảng (`file_meta`, `notifications`,
  `purchase_orders`, `workflow_instances`) nhưng chỉ `ENABLE ROW LEVEL SECURITY`
  (không có `FORCE`) — nghĩa là **RLS không áp dụng cho chủ sở hữu bảng**; vì
  connection của app dùng đúng role sở hữu bảng (`POSTGRES_USER`), các policy này
  gần như không có tác dụng thực tế ở runtime. Enforcement chính nằm ở tầng API
  (`require_role`), RLS chỉ là lớp phòng thủ chiều sâu chưa được kích hoạt đầy đủ —
  **CẦN THANG XÁC NHẬN** đây có phải chủ đích hay là một khoảng hở kỹ thuật cần bật `FORCE`.
- BQMS có thêm 1 middleware kill-switch: khi `app_config.bqms_user_edit_disabled=true`,
  mọi request mutate (POST/PATCH/PUT/DELETE) vào `/api/v1/bqms/*` bị chặn 403 (trừ
  whitelist scrape/sync/admin) — dùng khi cần "đóng băng" dữ liệu BQMS do người dùng sửa
  tay, chỉ nhận dữ liệu từ scrape.
- `audit_log` là bảng append-only cứng: trigger `trg_audit_log_immutable` +
  function `audit_log_immutable()` raise exception nếu có UPDATE/DELETE.
  11 bảng nghiệp vụ (AP, AR, `bqms_samsung_po`, `cash_book`, `customers`,
  `exchange_rates`, `import_export_tracking`, `imv_purchase_orders`, `inventory`,
  `purchase_orders`, `revenue_invoices`, `sales_orders`) có trigger `auto_audit_log()`
  tự ghi audit khi INSERT/UPDATE/DELETE.

## 5. Luồng dữ liệu chính (event-driven / chain-reaction)

Tài liệu chi tiết từng sự kiện + sơ đồ mermaid: `docs/SYSTEM_EVENT_MAP.md` (30/03/2026 —
lưu ý một vài router đã đổi tên/xoá kể từ khi viết tài liệu đó, ví dụ router
`sales_orders`/`customs`/`forecast`/`batch_operations`/`demand_forecast`/`pwa_settings`
đã bị gỡ khỏi `v1_router` ngày 2026-07-03, xem comment trong
`app/api/v1/__init__.py`). Tóm tắt 5 chuỗi chính theo code hiện tại:

### 5.1 BQMS: scrape → staging → báo giá → push Samsung
```
etl/bqms_playwright.py, samsung_bqms_client.py, bqms_po_api.py  (đăng nhập/scrape sec-bqms.com)
   → tasks/bqms_periodic_scrape.py, bqms_sync.py, bqms_won_sync.py (Procrastinate periodic,
     chạy trên sc-scheduler) ghi vào bqms_rfq / bqms_samsung_po / bqms_vendor_portal_staging /
     bqms_won_quotations
   → services/bqms_quote_scenario.py + bqms_state_machine.py (điền báo giá từ staging,
     state machine draft→saved_temp→submitted)
   → api/v1/bqms.py + bqms_drivers.py + bqms_images.py (Procurement thao tác qua UI)
   → services/bqms_quote_pusher.py (đẩy báo giá lên lại Samsung qua Playwright,
     khoá bằng samsung_session_lock.py để 1 phiên Samsung tại 1 thời điểm)
   → khi thắng thầu: tasks/bqms_dossier.py + bqms_dossier_watchdog.py +
     services/dossier_excel_builder.py/dossier_folder.py/dossier_pdf_parser.py/
     dossier_image_resolver.py tạo "hồ sơ giao hàng"
```

### 5.2 Đấu thầu NCC (vendor bidding — tự vận hành, không qua Samsung)
```
api/v1/procurement.py + procurement_analytics.py (admin/procurement quản trị RFQ batch,
  mời NCC, so sánh báo giá, award, hợp đồng, PO, giao hàng — bảng procurement_*)
     ↔ api/vendor/* (11 module: auth/batches/quotes/profile/contracts/pos/deliveries/
       notifications/scorecard/rank/messages) — cổng NCC hoàn toàn cô lập qua
       resolve_vendor() (app/api/vendor/deps.py): mọi query LUÔN scope theo
       vendor_accounts.id lấy từ JWT, NCC không bao giờ truyền vendor_id tuỳ ý.
3 nguồn RFQ có thể import vào đấu thầu: từ BQMS, từ IMV, từ Sourcing
  (cột source_kind trên bảng batch/RFQ, dùng chung 1 modal FE PushToBiddingModal).
procurement_audit_log có trigger immutable riêng (procurement_audit_log_immutable).
```

### 5.3 Sourcing (tìm/lưu giá nguồn hàng ngoài BQMS)
```
api/v1/sourcing.py + services/sourcing_pricing_engine.py (Prometheus metrics riêng:
  calc_suggest_latency_seconds, fx_cache_hit_total, rule_fallback_total)
  + sourcing_quote_pdf_renderer.py (xuất báo giá PDF qua Gotenberg, không dùng WeasyPrint)
     → sourcing_entries / sourcing_orders / sourcing_supplier_prices /
       sourcing_pricing_rules (đa NCC, đa tiền tệ)
     → api/v1/payment_requests.py: kế toán duyệt thanh toán cho đơn sourcing
```

### 5.4 Finance chain — AR/AP
```
services/chain_service.py: nối Đơn (sourcing_orders) ↔ PO ↔ Giao hàng
  (bqms_deliveries) ↔ Tài chính (accounts_receivable) qua 1 bảng revenue_chain
  (mã RC-YYYYMM-NNNNNN, sinh atomic bằng sequence revenue_chain_code_seq) +
  domain_events (audit trail append-only). ensure_ar_for_order() idempotent
  (unique index uq_ar_sourcing_order). TOÀN BỘ auto-AR hiện GATED bởi flag
  PHASE3_AUTO_AR_ENABLED (mặc định False) — nghĩa là ở thời điểm hiện tại,
  việc tạo AR vẫn cần thao tác/kích hoạt thủ công, chưa tự động hoàn toàn.
api/v1/finance.py, finance_management.py, finance_reports.py, quarterly_invoices.py,
  exchange_rates_api.py — accounts_payable/receivable, cash_book, exchange_rates.
Mọi thay đổi trên các bảng tài chính trên đều tự ghi audit_log (auto_audit_log trigger).
```

### 5.5 HR (M40/M41)
```
api/v1/leave.py + attendance.py + employee_kpi.py
  → leave_requests / leave_balance / leave_policy / attendance_incidents /
    employee_monthly_kpi (+ view employee_current_month_kpi)
  → tasks/kpi_aggregator.py tính KPI tháng định kỳ.
  Duyệt nghỉ phép: 1 cấp quản lý trực tiếp (không multi-level như workflow PO).
```

### 5.6 Duyệt đa cấp (Workflow Engine) — dùng chung cho PO & các phiếu khác
```
services/workflow_engine.py: state machine draft → pending_l1 → (approved|rejected)
  hoặc → pending_l2 → (approved|rejected) → cancelled.
Ngưỡng: amount < 50,000,000 VND (settings.PO_APPROVAL_THRESHOLD) → Manager (L1) duyệt
  thẳng; amount >= ngưỡng → phải qua thêm Admin (L2).
DB trigger notify_workflow_change() bắn pg_notify khi current_status đổi →
  app/websocket/handlers.py emit_workflow_update() đẩy realtime qua Socket.IO
  (/ws, room-based) cho FE cập nhật ngay không cần refresh.
```

## 6. Reverse proxy (nginx)

- `default.conf` — domain ERP chính (`erp.songchau.vn`): `/` → frontend (Next.js),
  `/api/` → api backend (có location riêng cho `/api/v1/auth/`, `/api/v1/files/upload`,
  `/api/v1/data-migration/` để chỉnh timeout/body-size), `/ws/` → Socket.IO, `/files/`
  → static file serving trực tiếp từ volume `data/files`.
- `vendor.conf` — domain cổng NCC: `/api/vendor/` → proxy sang API container (dùng
  chung backend `sc-api`, khác prefix), `/` → `vendor-portal:3001`.
- `/metrics` (Prometheus) KHÔNG có location nào trong nginx → không lộ ra ngoài internet
  qua domain public; chỉ có thể scrape từ trong Docker network nội bộ.
