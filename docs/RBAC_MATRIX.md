# RBAC_MATRIX.md — Ma trận phân quyền Song Châu ERP

> Nguồn: `backend/app/core/rbac.py` (cơ chế `require_role`), `backend/app/api/vendor/deps.py`
> (`resolve_vendor`), `backend/tests/rbac_matrix.yaml` (ma trận kỳ vọng dùng cho test
> `backend/tests/test_rbac_matrix.py`), grep `require_role(...)` trên toàn bộ
> `backend/app/api/v1/*.py`, và `role_enum` thật trong `backend/tests/_schema_snapshot.sql`.

## 1. 8 role thật trong hệ thống

```sql
CREATE TYPE public.role_enum AS ENUM (
    'admin', 'manager', 'procurement', 'warehouse',
    'staff', 'accountant', 'vendor', 'viewer'
);
```

Code có một số nơi truyền thêm `"sales"` và `"director"` vào `require_role(...)`
(ví dụ `analytics_trends.py`, `price_analytics.py`, `market_prices.py`, `imv.py`,
`orders.py`, `notifications.py`, `file_browser.py`, `pet.py`...) — **2 role này KHÔNG
tồn tại trong `role_enum`**, không user nào tạo được với role đó → nhánh chết, không
ảnh hưởng hành vi thật, chỉ là code thừa (comment gốc trong `rbac_matrix.yaml` xác
nhận điều này). Không cần sửa gấp nhưng dọn được thì nên dọn cho đỡ nhiễu khi đọc code.

## 2. Cơ chế chặn (`require_role`, `app/core/rbac.py`)

Mọi endpoint cần quyền gọi `Depends(require_role("role1", "role2", ..., allow_viewer=True))`.
Thứ tự xử lý trong `_check()`:

1. **Viewer bypass** (mặc định `allow_viewer=True`): nếu `token.role == "viewer"` →
   cho qua nếu method là `GET/HEAD/OPTIONS`; method khác (POST/PUT/PATCH/DELETE) →
   403 `VIEWER_READ_ONLY` bất kể `allowed_roles` là gì.
2. Nếu không phải viewer (hoặc `allow_viewer=False`) → kiểm `token.role in allowed_roles`,
   sai → 403 `INSUFFICIENT_PERMISSIONS`.
3. **Chặn token đã thu hồi**: so `password_version` trong JWT với giá trị hiện tại của
   `users.password_version` trong DB — đổi mật khẩu sẽ bump giá trị này → mọi JWT cũ
   401 `TOKEN_REVOKED` ngay cả khi chưa hết hạn 15 phút.
4. Inject session var Postgres (`app.current_user_id`, `app.current_role`,
   `app.current_user_email`, `app.client_ip`) qua `set_config(..., true)` — dùng cho
   `auto_audit_log()` trigger + (dự định) RLS policy (xem lưu ý §5 `docs/DB.md`: RLS
   đọc `app.current_user_role`, khác tên biến `app.current_role` được set ở đây — khả
   năng RLS không hoạt động như kỳ vọng).

`allow_viewer=False` dùng cho nhóm **"giá nội bộ"** — chặn cả viewer đọc GET (xem §4).

## 3. Cổng NCC (`vendor`) — cô lập hoàn toàn

`role == "vendor"` KHÔNG đi qua `require_role` của `/api/v1` — NCC dùng riêng
`resolve_vendor()` (`app/api/vendor/deps.py`) cho mọi route dưới `/api/vendor/*`:

- Chặn nếu `token.role != "vendor"` (403).
- Tra `vendor_accounts` theo `user_id`, chặn nếu tài khoản chưa `active`/`is_approved`.
- Cũng kiểm `password_version` (revoke token) như trên.
- Trả về `vendor_accounts.id` — **mọi query sau đó bắt buộc lọc theo id này**, NCC
  không bao giờ tự truyền `vendor_id` → không xem được dữ liệu NCC khác (chống rò
  chéo tenant).

Ngược lại: role `vendor` gọi vào bất kỳ route `/api/v1/*` nào đều bị `require_role`
loại (không nằm trong `allowed_roles` của bất kỳ endpoint nào, và không được hưởng
viewer-bypass) → 403.

## 4. Nhóm "giá nội bộ" — viewer bị chặn kể cả GET (`allow_viewer=False`)

Theo `viewer_deny_prefixes` trong `rbac_matrix.yaml` (khớp grep `allow_viewer=False`
trong code):

| Prefix | Router | Vì sao chặn viewer |
|---|---|---|
| `/api/v1/price-analytics` | price_analytics.py | Xu hướng giá nội bộ, margin |
| `/api/v1/analytics` | analytics_trends.py + analytics_exports.py | Trend giá + export chứa giá vốn/giá bán |
| `/api/v1/price-lookup` | price_lookup.py | Widget Ctrl+K — **từng có bug rò giá cho viewer** (đã fix, xem `docs/PROGRESS.md`), nay chặn cứng bằng `allow_viewer=False` |
| `/api/v1/market-prices` | market_prices.py | Giá thị trường XNK dùng nội bộ để định giá |

Đã kiểm `grep -rl "allow_viewer=False" app/api/v1/*.py` trên toàn bộ router — đúng
5 file khớp 4 nhóm trên (`analytics_exports.py` + `analytics_trends.py` cùng mount
`/analytics`, cộng `market_prices.py`, `price_analytics.py`, `price_lookup.py`),
không có router nào khác dùng `allow_viewer=False`. Router `xnk_analytics.py` (mount
`/xnk`) KHÔNG chặn viewer dù cũng là dữ liệu phân tích giá XNK — có thể là một lỗ hổng
nhất quán cần Thang xem xét (nếu coi đây cũng là "giá nội bộ" thì nên thêm
`allow_viewer=False`).

## 5. Whitelist KHÔNG cần token (`no_auth`)

```
GET  /api/health, /api/health/liveness, /api/health/readiness
POST /api/v1/auth/login, /auth/refresh (cookie refresh_token), /auth/logout
POST /api/vendor/auth/register, /login, /activate, /forgot-password, /reset-password
POST /api/v1/onlyoffice/callback   ← TODO-verify (xem docs/API.md mục 4.1)
```

## 6. Ma trận vai trò × nhóm chức năng

Chú thích: **Toàn quyền** = có mặt trong `require_role(...)` của hầu hết endpoint
ghi/xoá nhóm đó · **Có** = xuất hiện ở một phần endpoint (thường là thao tác thường
ngày, không phải cấu hình) · **Đọc** = chỉ vào được các endpoint GET của nhóm (không
có trong `allowed_roles` ghi/sửa nhưng route đó cho phép qua vì list role đủ rộng ở
GET) · **–** = không có trong `require_role` của bất kỳ endpoint nào trong nhóm →
403. Viewer và Vendor xử lý riêng, xem cột ghi chú.

| Nhóm chức năng | admin | manager | procurement | warehouse | staff | accountant | viewer | vendor |
|---|---|---|---|---|---|---|---|---|
| Quản trị user (`/users`) | Toàn quyền | – | – | – | – | – | Đọc (GET bypass) | – |
| Audit log (`/audit`) | Toàn quyền | – | – | – | – | – | Đọc | – |
| System health/migration/retry-queue/containers/security-log | Toàn quyền | – | – | – | – | – | Đọc | – |
| Workflow duyệt (`/workflows`) | Toàn quyền (L1+L2) | Có (L1, duyệt <50M) | – | – | Có (tạo/submit) | – | Đọc | – |
| Notifications | Có | Có | Có | Có | Có | Có | Đọc | – (dùng `/api/vendor/notifications` riêng) |
| Suppliers / NCC nội bộ | Toàn quyền | Có | Có | – | Đọc | – | Đọc | – |
| Purchase Orders nội bộ | Có | Toàn quyền | – | – | Có | – | Đọc | – |
| Inventory / Kho | Toàn quyền | Toàn quyền | – | Có (nhận hàng) | Có (xem/điều chỉnh) | – | Đọc | – |
| BQMS (RFQ/báo giá/push Samsung) | Toàn quyền | Có | Có | Có (drivers) | Có | – | Đọc | – |
| Đấu thầu NCC (`/procurement`) | Toàn quyền | Có | Có | – | Có (một phần) | – | Đọc | qua `/api/vendor/*` riêng |
| Sourcing | Có | Toàn quyền | Có | – | Có | – | Có (1 endpoint) | – |
| IMV (cổng NCC #2) | Toàn quyền | Có | Có | – | Có | Có (1 phần) | Đọc | – |
| Tài chính (AR/AP, cash book) | Toàn quyền | Có | – | – | – | Toàn quyền | Đọc | – |
| Payment requests (duyệt TT sourcing) | Có | – | – | – | – | Toàn quyền | Đọc | – |
| Tỷ giá (`/exchange-rates`) | Toàn quyền (sửa) | Đọc | – | – | Đọc | Đọc | Đọc | – |
| Giá nội bộ (price-analytics/market-prices/price-lookup/analytics-*) | Toàn quyền | Có | Có | – | Có | – | **–** (chặn cứng) | – |
| Báo cáo (`/reports`, `/finance-reports`, scheduled-reports) | Toàn quyền | Có | Có (1 phần) | Có (1 phần) | Có | Có | Đọc | – |
| CRM | Có | Toàn quyền | – | – | Có | Có | Đọc | – |
| HR — Leave | Toàn quyền (policy) | Có (duyệt) | Có (xin nghỉ) | Có (xin nghỉ) | Có (xin nghỉ) | Có (xin nghỉ) | Đọc | – |
| HR — Attendance | Có (chỉnh) | Toàn quyền (chỉnh) | Có (chấm công) | Có (chấm công) | Có (chấm công) | Có (chấm công) | Đọc | – |
| Employee KPI | Toàn quyền (cấu hình) | Có | – | – | Đọc (của mình) | – | Đọc | – |
| File Browser / Document Management | Toàn quyền | Có | – | – | Có | – | Đọc | – |
| Vendor Portal toàn bộ (`/api/vendor/*`) | – | – | – | – | – | – | – | **Toàn quyền** (dữ liệu tự-scope) |

## 7. Chống drift (giữ ma trận này đúng theo thời gian)

`backend/tests/test_rbac_matrix.py` (chạy bằng `pytest -m integration`) tự enumerate
mọi route thật của app lúc runtime, đối chiếu 2 nguồn:

1. `rbac_matrix.yaml` — người khai (mới seed một phần, chưa phủ hết route — file có
   `strict_drift: false` nghĩa là route mới chưa khai chỉ bị SKIP/cảnh báo, không FAIL).
2. Introspection trực tiếp closure `require_role(...)` gắn trên từng route — nguồn sự
   thật khi chạy.

Chạy `RBAC_MATRIX_DUMP=1 pytest ...` sẽ tự sinh `tests/rbac_matrix.generated.yaml`
(đọc toàn bộ route qua introspection) để dán ngược vào phần `routes:` của
`rbac_matrix.yaml` — cách nhanh nhất để lấp đầy phần còn thiếu thay vì đọc tay từng
router như tài liệu này đã làm cho các nhóm chính.

## 8. Cần Thang xác nhận

1. `app.current_role` (set bởi `rbac.py`) vs `app.current_user_role` (đọc bởi RLS
   policy trên `file_meta`/`notifications`/`purchase_orders`/`workflow_instances`) —
   sai tên biến khiến RLS có thể chưa từng lọc đúng theo role ở runtime (xem `docs/DB.md` §2.4).
2. Có muốn dọn 2 role chết `sales`/`director` khỏi toàn bộ `require_role(...)` (đổi
   code, không đổi hành vi vì vốn dĩ không ai match được) để giảm nhiễu khi đọc/maintain?
3. `strict_drift: false` trong `rbac_matrix.yaml` — có muốn bật `true` sau khi điền đủ
   `routes:` để chống route mới quên khai báo quyền (tự FAIL CI thay vì chỉ skip)?
4. Xác nhận `/api/v1/onlyoffice/callback` nằm trong whitelist `no_auth` có đúng chủ đích
   (bảo vệ bằng token ngắn hạn riêng trong query string) hay cần request thêm 1 lớp xác
   thực (ví dụ kiểm tra IP nội bộ container OnlyOffice) — đánh dấu TODO-verify từ chính
   người viết `rbac_matrix.yaml`.
5. `xnk_analytics.py` (`/api/v1/xnk/analytics/...`) không có `allow_viewer=False` dù
   cùng loại dữ liệu phân tích giá XNK như `analytics_trends.py`/`price_analytics.py`
   (2 router này CÓ chặn viewer) — có nên đồng bộ để viewer cũng bị chặn ở đây, hay
   dữ liệu XNK analytics không nhạy cảm bằng nên cố ý để hở?
