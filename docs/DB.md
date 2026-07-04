# DB.md — Mô hình dữ liệu Song Châu ERP

> Nguồn: `backend/tests/_schema_snapshot.sql` (bản dump schema Postgres dùng cho test —
> `grep '^CREATE TABLE'` / `'^CREATE VIEW'` / `'^CREATE MATERIALIZED VIEW'`), đối chiếu
> `backend/init.sql` / `backend/init_v3.sql` / `backend/migrations/*`.

## 0. Số liệu thật (đếm trực tiếp từ schema snapshot)

- **174 bảng** (`CREATE TABLE`) — không phải ~182 như ước lượng ban đầu, chênh lệch
  nhỏ, có thể do vài bảng được thêm/gộp/archive kể từ lần đếm trước.
  **CẦN THANG XÁC NHẬN** nếu có bảng nào bị thiếu do snapshot chưa cập nhật.
- **7 materialized view**: `bqms_kpi`, `mv_bqms_win_rate`, `mv_inventory_value`,
  `mv_po_pipeline`, `mv_revenue_monthly`, `mv_supplier_performance`,
  `mv_vat_declaration_monthly`.
- **7 view thường**: `employee_current_month_kpi`, `v_bqms_best_image`,
  `v_latest_vendor_quote`, `v_po_delivery_history`, `v_price_observations`,
  `v_price_observations_clean`, `v_unified_orders`.

## 1. Nhóm bảng chính theo miền nghiệp vụ

### 1.1 BQMS (Samsung — mua/bán qua cổng sec-bqms.com)
`bqms_rfq`, `bqms_samsung_po`, `bqms_deliveries` (+ `bqms_deliveries_archive_pre2026`,
`bqms_deliveries_spec_bak`), `bqms_vendor_portal_staging` (dữ liệu thô cào về, dùng để
điền báo giá), `bqms_rfq_submissions`, `bqms_quotation_items`, `bqms_quote_batches` +
`bqms_quote_batch_items`, `bqms_quote_log`, `bqms_won_quotations`, `bqms_orders`,
`bqms_contracts` + `bqms_contract_items`, `bqms_contacts`, `bqms_dossier_jobs` (job tạo
hồ sơ giao hàng), `bqms_image_index` + `bqms_code_primary_image` (ảnh mã hàng),
`bqms_manufacturing_daily`, `bqms_manufacturing_schedule`, `bqms_material_pricing`,
`bqms_monthly_po_summary`, `bqms_qt_events`, `bqms_raw_material_po`, `bqms_records`,
`bqms_row_gaps` (dò lỗ hổng dữ liệu), `bqms_scrape_presence`, `samsung_watchdog_events`.
Materialized view: `bqms_kpi`, `mv_bqms_win_rate`. View: `v_bqms_best_image`.

### 1.2 Đấu thầu NCC (`procurement_*` — vendor bidding tự vận hành)
`procurement_rfq_batches`, `procurement_rfq_items`, `procurement_rfq_invitations`,
`procurement_rfq_messages` (Q&A), `procurement_rfq_shared_files`, `procurement_awards`,
`procurement_contracts` + `procurement_contract_items`, `procurement_pos` +
`procurement_po_items`, `procurement_deliveries` + `procurement_delivery_items`,
`procurement_bid_tokens` (magic-link cũ — **đã bỏ dùng W2-10 2026-07-03**, bảng còn
giữ chưa drop, cần Thang quyết định xoá hay giữ), `procurement_audit_log` (append-only
riêng, trigger `procurement_audit_log_immutable`). NCC-side: `vendor_accounts`,
`vendor_quotes` + `vendor_quote_items`. View: `v_latest_vendor_quote`.

### 1.3 Sourcing (tìm/lưu giá nguồn hàng ngoài BQMS)
`sourcing_entries`, `sourcing_orders`, `sourcing_order_status_history` (+
`_archive`), `sourcing_supplier_prices`, `sourcing_pricing_rules` (+ `_history`),
`sourcing_pricing_snapshots` (giá đã chốt/frozen tại thời điểm báo giá),
`sourcing_vn_shipping_history`.

### 1.4 Tài chính (Finance)
`accounts_receivable`, `accounts_payable`, `payment_transactions`, `payment_requests`,
`cash_book` + `cash_book_categories`, `exchange_rates`, `budget_targets`,
`fiscal_periods`, `deal_margins`, `revenue_invoices`, `e_invoices`, `invoices` +
`invoice_items`, `purchase_invoices_q`, `sales_invoices_q`, `profit_reports`.
Materialized view: `mv_revenue_monthly`, `mv_vat_declaration_monthly`.

### 1.5 HR (M40 KPI + M41 Leave/Attendance)
`leave_policy`, `leave_requests`, `leave_balance`, `attendance_incidents`,
`public_holidays`, `employee_monthly_kpi`. View: `employee_current_month_kpi`.

### 1.6 CRM
`customers`, `customer_contacts`, `crm_contacts`, `crm_interactions`,
`crm_pipeline_cards` (Kanban), `crm_account_external_map` (map với hệ thống ngoài),
`companies` (danh bạ công ty dùng chung).

### 1.7 Mua hàng / Kho / Sản phẩm (Purchasing, Inventory, Products)
`suppliers`, `supplier_contracts`, `supplier_product_map`, `supplier_quotes` +
`supplier_quote_items`, `supplier_ratings`, `supplier_scores`, `contract_price_items`,
`purchase_orders` + `po_line_items`, `products`, `material_types`, `inventory`,
`inventory_movements`, `stock_alerts`, `price_history`, `price_intel_config`,
`market_prices`, `quotations`, `quotation_templates`, `quote_batches` (báo giá cho
khách hàng, dùng bởi Customer Quote Hub — khác với `bqms_quote_batches`),
`rfq_requests`, `rfq_line_items`, `rfq_quotations` (RFQ gửi NCC Trung Quốc, khác với
`procurement_rfq_*` của module đấu thầu), `sales_orders` + `sales_order_items`,
`shipments` + `shipment_items`, `delivery_receipts`. View: `v_po_delivery_history`,
`v_price_observations` / `v_price_observations_clean` (gộp giá đa nguồn BQMS +
Sourcing + IMV), `v_unified_orders` (dashboard hợp nhất Đơn↔PO↔Giao hàng↔Tài chính).
Materialized view: `mv_inventory_value`, `mv_po_pipeline`, `mv_supplier_performance`.

### 1.8 XNK / Hải quan
`customs_declarations` + `customs_declaration_items`, `import_export_tracking`,
`hs_codes`, `xnk_price_lookup`.

### 1.9 IMV (cổng NCC thứ 2 — iMarketVietnam)
`imv_rfq`, `imv_inquiries`, `imv_orders`, `imv_purchase_orders`, `imv_contracts`,
`imv_deliveries`, `imv_payments`, `imv_rejections`, `imv_consolidated`,
`imv_sync_log`.

### 1.10 Workflow (duyệt đa cấp)
`workflow_instances` (state machine draft→pending_l1→pending_l2→approved/rejected),
`workflow_history` (log từng lần đổi trạng thái).

### 1.11 Audit / Bảo mật / Hệ thống (system, cross-cutting)
`audit_log` (**append-only** — xem §2), `security_log`, `error_log`, `backup_log`,
`etl_sync_log`, `mv_refresh_log`, `data_quality_checks`, `domain_events` (audit trail
cho revenue chain), `revenue_chain` (bảng spine nối Đơn↔PO↔Giao hàng↔Tài chính, mã
`RC-YYYYMM-NNNNNN`), `app_config` (feature flag, vd `bqms_user_edit_disabled`),
`system_config`, `system_settings`, `system_health_checks`, `idempotency_keys`,
`retry_queue`, `dim_date` (bảng chiều ngày cho báo cáo/BI), `ai_classification_results`
(kết quả AI phân loại RFQ), `demand_forecasts`, `calendar_events`,
`user_activity_log`, `user_sessions`, `users`, `notifications`, `email_history`,
`ocr_results`, `onedrive_file_index`, `file_meta`, `file_review_status`, `documents`,
`help_articles`, `report_executions`, `scheduled_reports`, `task_assignments`,
`tasks`, `tags` + `taggings`, `pim_enrichment_audit`, `pet_species_catalog` +
`pet_exp_log` + `user_pets` (gamification), `procrastinate_jobs` +
`procrastinate_events` + `procrastinate_periodic_defers` (bảng nội bộ của thư viện
task-queue Procrastinate, KHÔNG tự tay sửa).

## 2. Quy ước quan trọng (đọc từ code, không suy đoán)

### 2.1 `audit_log` là bảng append-only cứng
```sql
CREATE TRIGGER trg_audit_log_immutable
  BEFORE DELETE OR UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();
```
Function `audit_log_immutable()` luôn `RAISE EXCEPTION` — không ai (kể cả `admin`,
kể cả superuser dùng đúng function này) sửa/xoá được 1 dòng nào trong `audit_log`
qua đường bình thường. Việc ghi vào `audit_log` tự động qua trigger `auto_audit_log()`
gắn trên 11 bảng nghiệp vụ (`trg_audit_*`): `accounts_payable`, `accounts_receivable`,
`bqms_samsung_po`, `cash_book`, `customers`, `exchange_rates`,
`import_export_tracking`, `imv_purchase_orders`, `inventory`, `purchase_orders`,
`revenue_invoices`, `sales_orders`. `user_id` ghi vào audit lấy từ session var
`app.current_user_id` (do `require_role()` set mỗi request — nếu gọi ngoài luồng
HTTP/thiếu session var thì `user_id` sẽ là NULL).
`procurement_audit_log` có cơ chế immutable **riêng** (`procurement_audit_log_immutable`),
tách khỏi `audit_log` chung — 2 bảng audit độc lập, không tự động đồng bộ với nhau.

### 2.2 `notifications` dùng `ref_type`/`ref_id` + `metadata jsonb` — KHÔNG có cột link
```sql
ref_type text, ref_id bigint, metadata jsonb
```
Không có cột `link`/`url` cứng — Frontend tự dựng đường dẫn từ `ref_type` + `ref_id`
(+ dữ liệu phụ trong `metadata` khi cần). Có thêm cột `recipient_vendor_id` (bigint,
trỏ `vendor_accounts.id`) để dùng chung 1 bảng cho cả noti nội bộ (`recipient_id` →
`users.id`) lẫn noti gửi cho NCC (`recipient_vendor_id`) — 2 cột recipient loại trừ
nhau tuỳ đối tượng nhận.

### 2.3 `immutable_unaccent(text)` — `SET search_path`
```sql
CREATE FUNCTION public.immutable_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_catalog'
    AS $_$ SELECT public.unaccent($1); $_$;
```
Bọc lại hàm `unaccent()` (vốn `STABLE`, không cho phép dùng trong generated column)
thành `IMMUTABLE` + khoá cứng `search_path` (chống search_path hijacking, bắt buộc với
hàm được đánh dấu `IMMUTABLE` dùng trong index/generated column). Dùng làm cột
`GENERATED ALWAYS AS (immutable_unaccent(lower(...))) STORED` để tìm kiếm không dấu
nhanh (có index) trên 4 bảng: `companies.company_name_unaccent`,
`products.name_unaccent`, `suppliers.name_unaccent`, `customers` (tương tự).

### 2.4 Row Level Security (RLS) — bật nhưng khả năng bị "vô hiệu hoá ngầm"
4 bảng có `ENABLE ROW LEVEL SECURITY` + policy: `file_meta`, `notifications`,
`purchase_orders`, `workflow_instances`. Ví dụ:
```sql
CREATE POLICY po_full_access ON purchase_orders
  USING (current_setting('app.current_user_role', true) = ANY (ARRAY['admin','manager','procurement','accountant']));
CREATE POLICY po_warehouse_transit ON purchase_orders FOR SELECT
  USING (current_setting('app.current_user_role', true) = 'warehouse'
         AND status = ANY (ARRAY['in_transit','partial_received','received']));
```
**Phát hiện cần Thang xác nhận**: các policy trên đọc session var
`app.current_user_role`, nhưng `app/core/rbac.py` (chỗ duy nhất set session var mỗi
request) chỉ set `app.current_role` (thiếu chữ `_user_`) — 2 tên khác nhau. Ngoài ra
cả 4 bảng chỉ `ENABLE` chứ không `FORCE ROW LEVEL SECURITY`, nên RLS **không áp dụng**
cho chủ sở hữu bảng (chính là DB user mà API dùng để connect). Kết luận thực tế: các
policy RLS này gần như **không có tác dụng ở runtime hiện tại** — toàn bộ phân quyền
đang chạy đúng là tầng `require_role()` ở API, RLS chỉ là lớp phòng thủ được khai báo
sẵn nhưng chưa "bật thật".

### 2.5 Tách bạch 2 nguồn "quote"/"RFQ" dễ nhầm tên
- `quote_batches` (báo giá gửi khách hàng, Customer Quote Hub) ≠ `bqms_quote_batches`
  (batch báo giá BQMS) ≠ `vendor_quotes`/`vendor_quote_items` (NCC nộp báo giá qua
  cổng đấu thầu).
- `rfq_requests`/`rfq_line_items`/`rfq_quotations` (RFQ gửi NCC Trung Quốc, nhập tay)
  ≠ `procurement_rfq_batches`/`procurement_rfq_items` (RFQ trong module Đấu thầu NCC
  tự vận hành) ≠ `bqms_rfq` (RFQ từ Samsung) ≠ `imv_rfq` (RFQ trên cổng IMV).

### 2.6 Materialized view refresh
Refresh định kỳ qua Procrastinate (`SCH-08` trong `docs/SYSTEM_EVENT_MAP.md`,
`REFRESH MATERIALIZED VIEW CONCURRENTLY`), kết quả ghi vào `mv_refresh_log`
(`duration_ms`, trạng thái) để theo dõi hiệu năng.

## 3. Cần Thang xác nhận

1. `app.current_role` (rbac.py) vs `app.current_user_role` (RLS policies) — có phải
   1 bug thật (RLS chưa từng chạy đúng) hay có nơi khác set biến thứ 2 mà chưa tìm
   thấy trong lần đọc này?
2. Có nên bật `FORCE ROW LEVEL SECURITY` cho 4 bảng đã có policy, hay giữ nguyên vì
   phân quyền tầng API đã đủ và không muốn rủi ro khi bật thêm 1 lớp mới?
3. `procurement_bid_tokens` (magic-link, đã ngừng dùng) — xoá bảng hay giữ để tra cứu
   lịch sử?
4. Danh sách 174 bảng ở trên lấy từ `tests/_schema_snapshot.sql` — nếu file này không
   được refresh sau migration gần nhất, số liệu có thể lệch nhẹ so với DB production
   thật; nên đối chiếu lại bằng `\dt` trên Postgres thật khi cần con số chính xác 100%.
