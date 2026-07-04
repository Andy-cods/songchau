# API.md — Tổng quan API Song Châu ERP

> Nguồn: `backend/app/api/v1/__init__.py` (danh sách router thật đang mount), grep
> `require_role(...)` trong từng file `backend/app/api/v1/*.py` và
> `backend/app/api/vendor/*.py`, `backend/app/main.py` (mount thêm `/api/vendor`,
> `/ws`, `/api/health`), `backend/tests/rbac_matrix.yaml` (ma trận quyền kỳ vọng).

## 0. Cách tra chi tiết từng endpoint (KHÔNG liệt kê ở đây)

Tài liệu này chỉ liệt kê **nhóm** router + mô tả ngắn + quyền. Danh sách đầy đủ từng
endpoint (path, method, request/response schema, status code) được FastAPI **tự sinh**:

- Swagger UI: `GET /api/docs`
- ReDoc: có thể bật thêm nếu cần, hiện chưa mount `/api/redoc` riêng (route bị skip
  trong `tests/test_rbac_matrix.py` như hạ tầng, không phải business route)
- OpenAPI JSON thô: `GET /api/openapi.json` (dùng để generate client, import Postman,
  hoặc chạy script đối chiếu route thật vs `rbac_matrix.yaml`)

`app/main.py` cấu hình: `docs_url="/api/docs"`, `openapi_url="/api/openapi.json"`
(khác mặc định FastAPI `/docs` + `/openapi.json`). Cả 2 route này bị loại khỏi
Prometheus instrumentation (`excluded_handlers`) và khỏi RBAC completeness test.

## 1. Router ngoài `/api/v1`

| Path prefix | Router | Auth | Mô tả |
|---|---|---|---|
| `/api/health`, `/liveness`, `/readiness` | `app/api/health.py` | Không cần token | Health-check cho Docker healthcheck + nginx |
| `/api/vendor/*` | `app/api/vendor/*` (11 module) | role=`vendor` qua `resolve_vendor()` | Cổng NCC (Vendor Bidding Portal) — cô lập hoàn toàn khỏi `/api/v1`, xem mục 3 |
| `/ws` | Socket.IO ASGI app (`app/websocket`) | JWT qua handshake (xem `app/websocket/auth.py`) | Realtime: workflow update, notification, stock alert, bqms sync done, report ready |
| `/metrics` | prometheus-fastapi-instrumentator | Không giới hạn ở tầng code (không lộ qua nginx public) | Prometheus scrape |

## 2. Router dưới `/api/v1` (mount trong `app/api/v1/__init__.py`)

Ký hiệu quyền: liệt kê role trong `require_role(...)`. **"viewer"** mặc định được thêm
ngầm (đọc GET) trừ khi ghi rõ `allow_viewer=False`. Role `sales` và `director` xuất hiện
trong code nhưng **KHÔNG tồn tại** trong `role_enum` của DB (8 role thật:
`admin, manager, procurement, warehouse, staff, accountant, viewer, vendor`) — coi như
nhánh chết, không user nào khớp được (xem `docs/RBAC_MATRIX.md`).

### Core
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/auth` | auth | Login/refresh/logout/`me` | Không cần role (chỉ cần đăng nhập) |
| `/users` | users | Quản trị tài khoản, reset mật khẩu | `admin` only |
| `/workflows` | workflows | Phiếu duyệt đa cấp (PO, chi phí...) — state machine draft→pending_l1→pending_l2 | `staff/manager/admin` |
| `/notifications` | notifications | Chuông thông báo trong app | Mọi role đã login (`staff, manager, admin, procurement, warehouse, accountant` + role chết `sales, director`) |
| `/dashboard` | dashboard | Số liệu tổng quan trang chủ | `staff/manager/admin` (+ accountant/procurement/warehouse tuỳ endpoint con) |
| `/audit` | audit | Xem `audit_log` (append-only) | `admin` only |
| `/files` | files | Upload/liệt kê file dùng chung | `staff/manager/admin` |

### Mua hàng & NCC
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/suppliers` | suppliers | Danh mục NCC + lịch sử giá | `admin/manager/procurement` (đọc thêm `staff`) |
| `/purchase-orders` | purchase-orders | PO nội bộ + workflow duyệt | `staff/manager/admin` |
| `/inventory` | inventory | Tồn kho, phiếu nhập/xuất | `manager/admin` (đọc thêm `staff`) |

### Samsung BQMS (3 module cùng prefix `/bqms`)
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/bqms` | bqms | RFQ, báo giá, push Samsung, dossier | Đa dạng theo endpoint: `admin` only cho thao tác quản trị, `admin/manager/staff(/sales)/procurement` cho nghiệp vụ hàng ngày |
| `/bqms` | bqms-drivers | Trình điều khiển scraper (bật/tắt, xem log) | `manager/admin` (+ `staff/warehouse` một số endpoint) |
| `/bqms` | bqms-images | Duyệt ảnh, ghim ảnh mã hàng | `admin/manager/procurement/staff` |

Toàn bộ mutating request vào `/api/v1/bqms/*` còn bị 1 middleware kill-switch chặn
thêm nếu `app_config.bqms_user_edit_disabled=true` (xem ARCHITECTURE.md §4).

### OnlyOffice
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `` (root, `onlyoffice.py`) | onlyoffice | Mở/sửa file xlsx/docx in-browser + callback lưu | `require_role(...)` cho `/config`, `/force-save`; callback `/callback` xác thực bằng `?token=` riêng (short-lived), theo `rbac_matrix.yaml` nằm trong whitelist `no_auth` — **TODO-verify** (comment gốc trong yaml ghi rõ cần xác nhận lại) |

### Tài chính & XNK
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/finance` | finance | Sổ quỹ, công nợ cơ bản | `accountant/manager/admin` |
| `/xnk` | xnk | Nghiệp vụ xuất nhập khẩu | `staff/manager/admin` (+ `accountant`) |
| `/xnk` | xnk-analytics | Phân tích giá XNK (module riêng, mount lại cùng prefix) | `admin/manager/staff/procurement` + role chết `sales/director` |

### Báo cáo
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/reports` | reports | Báo cáo tổng hợp (tuần/tháng, PO, kho...) | Tuỳ endpoint: `accountant/manager/admin`, `admin` only, hoặc `staff/manager/admin(/warehouse/procurement)` |

### Phase 1 — Business Intelligence
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/quotations` | quotations | Mẫu báo giá | `admin` only (quản trị mẫu) + rộng hơn khi dùng |
| `/price-analytics` | price-analytics | Xu hướng giá — **giá nội bộ** | `admin/manager/staff` (+role chết), `allow_viewer=False` toàn bộ endpoint |
| `/smart-classify` | smart-classify | AI phân loại RFQ (CHỐT/XEM/BỎ) | `admin/manager` (quản trị rule) + rộng hơn khi dùng |
| `/scheduled-reports` | scheduled-reports | Lịch gửi báo cáo tự động | `admin/manager` (+ role chết `director` ở 1 endpoint) |

### ETL
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/etl` | etl | Trigger đồng bộ thủ công (BQMS/OneDrive/IMV) | `admin/manager` (+ `procurement/staff` tuỳ endpoint) |

### Phase 2 — Revenue Chain
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/supplier-quotes` | supplier-quotes | Báo giá NCC nhập tay (Trung Quốc) | `manager/admin` (+ `staff`) |
| `/shipments` | shipments | Theo dõi vận chuyển | `staff/manager/admin` |
| `/invoices` | invoices | Hoá đơn | `manager/admin` (+ `staff`) |
| `/chains` | chains | Xem chuỗi Đơn↔PO↔Giao hàng↔Tài chính (`revenue_chain`) | `manager/admin` (+ `staff`) |
| `/exchange-rates` | exchange-rates | Tỷ giá VND/USD/RMB | `admin` (sửa), `manager/staff` (xem) |
| `/revenue-tasks` | revenue-tasks | Trigger thủ công các bước trong chain | `admin/manager` (+ `accountant`) |

### Phase 3 — Operations Intelligence
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/smart-inventory` | smart-inventory | Gợi ý tồn kho thông minh | `manager/admin` (+ `staff`) |
| `/smart-notifications` | smart-notifications | Thông báo thông minh (rule-based) | `admin/manager` (+ `staff`) |
| `/profit-analysis` | profit-analysis | Phân tích lợi nhuận | `manager/admin` |
| `/task-assignments` | task-assignments | Giao việc nội bộ | `manager/admin` (+ `staff`), viewer mặc định được xem |

### Phase 4 — System Health & Admin
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/system-health` | system-health | Tình trạng hệ thống, container | `admin` only |
| `/data-migration` | data-migration | Công cụ migrate dữ liệu | `admin` only |
| `/retry-queue` | retry-queue | Hàng đợi retry job lỗi | `admin` only |
| `/containers` | containers | Lịch sử container/thùng hàng | `admin` only |

### Phase 5 — UX & Productivity
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/documents` | documents | Quản lý tài liệu | `admin` (quản trị) + `staff/manager/admin` (dùng) |
| `/security-log` | security-log | Log bảo mật (login fail, IP block...) | `admin` only |
| `/excel-export` | excel-export | Xuất Excel tổng hợp | `staff/manager/admin` |
| `/help` | help (user_guide) | Hướng dẫn sử dụng trong app | `admin` (soạn) + `staff/manager/admin` (xem) |
| `/user-activity` | user-activity | Nhật ký hoạt động người dùng | `admin` (xem toàn bộ) + `manager/staff` (giới hạn) |

### Phase 6 — Finance & CRM
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/finance-management` | finance-management | Quản lý tài chính nâng cao | `accountant/manager/admin` |
| `/crm` | crm | Khách hàng, liên hệ, tương tác | `manager/admin` (+ `staff/accountant`) |
| `/crm/pipeline` | crm-pipeline | Kanban pipeline bán hàng | `manager/admin` (+ `staff`) |
| `/finance-reports` | finance-reports | Báo cáo tài chính | `manager/admin` |

### Phase 7 — Advanced Features
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/emails` | emails | Lịch sử email đã gửi | `staff/manager/admin` |
| `/ocr` | ocr | Trích xuất dữ liệu từ ảnh/PDF | `staff/manager/admin` |
| `/calendar` | calendar | Lịch công việc | `staff/manager/admin` |

### Module bổ sung
| Prefix | Tag | Mô tả | Role chính |
|---|---|---|---|
| `/file-browser` | file-browser | Duyệt cây thư mục file hệ thống | `admin/manager` (+ `staff`) |
| `/procurement` | procurement | **Đấu thầu NCC** (admin side): RFQ batch, mời NCC, award, hợp đồng, PO, giao hàng | `admin/manager/procurement` (+ `staff` một số endpoint) |
| `/procurement` | procurement-analytics | Vendor scorecard + smart-award (read-only, không bao giờ ghi/award) | `admin/manager/procurement/staff` |
| `/quarterly-invoices` | quarterly-invoices | Bảng kê hoá đơn theo quý | `accountant/manager/admin` (+ `staff`) |
| `/market-prices` | market-prices | Tra cứu giá thị trường XNK — **giá nội bộ** | `staff/manager/admin/procurement`, `allow_viewer=False` |
| `/daily-report` | daily-report | Báo cáo buổi sáng + xu hướng doanh thu | `staff/manager/admin/accountant/procurement` (1 endpoint mở thêm `viewer`) |
| `/price-lookup` | price-lookup | Widget tra giá nhanh (Ctrl+K) — **giá nội bộ** | `allow_viewer=False` (từng có bug rò giá cho viewer qua Ctrl+K, đã fix — xem `docs/PROGRESS.md`) |
| `/imv` | imv | Cổng NCC thứ 2 — iMarketVietnam | `admin/manager/procurement` (+ `staff/accountant` tuỳ endpoint) |
| `/employee-kpi` | employee-kpi | KPI nhân viên theo tháng (M40) | `admin` (cấu hình) + `manager/staff` (xem) |
| `/leave` | leave | Nghỉ phép (M41) | `admin` (policy) + `manager` (duyệt) + `staff/accountant/procurement/warehouse` (xin nghỉ) |
| `/attendance` | attendance | Chấm công (M41) | `manager/admin` (chỉnh) + nhiều role chấm công/xem |
| `` (root, `pet.py`) | pet | Gamification (thú cưng ảo) | `admin/manager/staff/procurement/warehouse/accountant` (+ role chết `sales`) |
| `/sourcing` | sourcing | Thư viện Sourcing (giá + NCC tìm ngoài BQMS) | `admin/manager/procurement` (+ `staff`, 1 endpoint mở `viewer`) |
| `/payment-requests` | payment-requests | Duyệt thanh toán đơn Sourcing | `accountant/admin` |
| `/analytics` | analytics-trends | Xu hướng giá (bản redesign) — **giá nội bộ** | `allow_viewer=False` toàn bộ |
| `/analytics` | analytics-exports | Xuất Excel/CSV cho mọi panel analytics | `allow_viewer=False` |
| `/orders` | orders | Dashboard hợp nhất Đơn↔PO↔Giao hàng↔Tài chính (đọc view `v_unified_orders`) | `accountant/manager/admin` (role `sales` khai trong code nhưng chết) |

### Router đã bị gỡ khỏi mount (file còn giữ, KHÔNG hoạt động)
Ghi rõ trong comment `app/api/v1/__init__.py` (2026-07-03, đợt dọn dead-route W0-09/W2-12):
`sales_orders`, `customs` (0 caller), `batch_operations`, `demand_forecast`,
`pwa_settings` (dead route), `forecast` (route gỡ nhưng file `forecast.py` **giữ
nguyên** vì `analytics_exports.py` import trực tiếp hàm nội bộ của nó khi export
`scope=forecast`). Nếu thấy các đường dẫn này trong tài liệu cũ (vd
`docs/SYSTEM_EVENT_MAP.md` 30/03/2026), đó là thông tin đã lỗi thời.

## 3. Vendor Portal API (`/api/vendor`, mount riêng ở `app/main.py`, KHÔNG qua `v1_router`)

| Prefix | Module | Mô tả |
|---|---|---|
| `/auth` | `auth.py` | Đăng ký/đăng nhập/kích hoạt/quên mật khẩu NCC (no-auth, whitelist) |
| `/batches` | `batches.py` | Xem RFQ được mời báo giá |
| `/quotes` | `quotes.py` + `rank.py` | Nộp báo giá (kèm ảnh/link), gợi ý band xếp hạng (`rank-hint`, mặc định OFF) |
| `/profile` | `profile.py` | Hồ sơ NCC |
| `/contracts` | `contracts.py` | Hợp đồng |
| `/pos`, `/deliveries` | `pos.py` | Đơn hàng (PO) + giao hàng |
| `/notifications` | `notifications.py` | Thông báo cho NCC |
| `/scorecard` | `scorecard.py` | Điểm đánh giá NCC |
| `/rfq/*/messages` | `messages.py` | Q&A theo batch (thread hỏi-đáp + addendum) |

Toàn bộ endpoint (trừ `/auth`) đi qua `resolve_vendor()` — chặn nếu `role != "vendor"`
hoặc tài khoản chưa kích hoạt, và LUÔN scope truy vấn theo `vendor_accounts.id` suy từ
JWT (không bao giờ nhận `vendor_id` do client truyền lên) → cô lập dữ liệu chéo NCC.

## 4. Cần Thang xác nhận

1. `/onlyoffice/callback` có thực sự an toàn khi để trong whitelist `no_auth`
   không (token ngắn hạn qua query string) — comment gốc trong `rbac_matrix.yaml`
   đánh dấu "TODO-verify".
2. Có muốn xoá hẳn các file router dead (`sales_orders.py`, `customs.py`,
   `batch_operations.py`, `demand_forecast.py`, `pwa_settings.py`) hay giữ lại để
   tham khảo/khôi phục sau.
3. `/metrics` hiện không lộ qua nginx (an toàn theo mặc định do thiếu cấu hình, không
   phải chủ đích) — có cần chặn tường minh hơn (ví dụ `allow` theo IP nội bộ) để tránh
   rủi ro nếu sau này có ai thêm location `/metrics` vào nginx mà quên hạn chế?
