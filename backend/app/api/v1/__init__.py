"""
Song Châu ERP — API v1 Router Registry

Tất cả routers được đăng ký tại đây.
Mỗi router tương ứng với 1 file trong app/api/v1/:
  auth, users, workflows, suppliers, purchase_orders, inventory,
  bqms, files, notifications, sales_orders, finance, xnk,
  customs, reports, dashboard, audit, etl,
  [Phase 1] quotation_templates, price_analytics, smart_classify, scheduled_reports,
  [Phase 2] supplier_quotes, shipment_tracking, invoice_management, deal_chain, exchange_rates_api,
  [Phase 3] smart_inventory, smart_notifications, profit_analysis, task_assignments,
  [Phase 4] system_health, data_migration, retry_queue_api, container_history,
  [Phase 5] document_management, security_log_api, excel_export, batch_operations,
            user_guide, user_activity,
  [Phase 6] finance_management, crm, finance_reports,
  [Phase 7] email_history, demand_forecast, ocr_service, calendar_api,
  [Phase 8] pwa_settings (PWA config + i18n)
"""

from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.users import router as users_router
from app.api.v1.workflows import router as workflows_router
from app.api.v1.suppliers import router as suppliers_router
from app.api.v1.purchase_orders import router as purchase_orders_router
from app.api.v1.inventory import router as inventory_router
from app.api.v1.bqms import router as bqms_router
from app.api.v1.files import router as files_router
from app.api.v1.notifications import router as notifications_router
from app.api.v1.sales_orders import router as sales_orders_router
from app.api.v1.finance import router as finance_router
from app.api.v1.xnk import router as xnk_router
from app.api.v1.customs import router as customs_router
from app.api.v1.reports import router as reports_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.audit import router as audit_router
from app.api.v1.etl import router as etl_router
from app.api.v1.quotation_templates import router as quotation_templates_router
from app.api.v1.price_analytics import router as price_analytics_router
from app.api.v1.smart_classify import router as smart_classify_router
from app.api.v1.scheduled_reports import router as scheduled_reports_router

# Phase 2 — Revenue Chain
from app.api.v1.supplier_quotes import router as supplier_quotes_router
from app.api.v1.shipment_tracking import router as shipment_tracking_router
from app.api.v1.invoice_management import router as invoice_management_router
from app.api.v1.deal_chain import router as deal_chain_router
from app.api.v1.exchange_rates_api import router as exchange_rates_router

v1_router = APIRouter()

# ── Core ──
v1_router.include_router(auth_router, prefix="/auth", tags=["auth"])
v1_router.include_router(users_router, prefix="/users", tags=["users"])
v1_router.include_router(workflows_router, prefix="/workflows", tags=["workflows"])
v1_router.include_router(notifications_router, prefix="/notifications", tags=["notifications"])
v1_router.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])
v1_router.include_router(audit_router, prefix="/audit", tags=["audit"])
v1_router.include_router(files_router, prefix="/files", tags=["files"])

# ── Business — Mua hàng & NCC ──
v1_router.include_router(suppliers_router, prefix="/suppliers", tags=["suppliers"])
v1_router.include_router(purchase_orders_router, prefix="/purchase-orders", tags=["purchase-orders"])
v1_router.include_router(sales_orders_router, prefix="/sales-orders", tags=["sales-orders"])
v1_router.include_router(inventory_router, prefix="/inventory", tags=["inventory"])

# ── Samsung BQMS ──
v1_router.include_router(bqms_router, prefix="/bqms", tags=["bqms"])

# ── Tài chính & XNK ──
v1_router.include_router(finance_router, prefix="/finance", tags=["finance"])
v1_router.include_router(xnk_router, prefix="/xnk", tags=["xnk"])
v1_router.include_router(customs_router, prefix="/customs", tags=["customs"])

# ── Báo cáo ──
v1_router.include_router(reports_router, prefix="/reports", tags=["reports"])

# ── Phase 1: Business Intelligence ──
v1_router.include_router(quotation_templates_router, prefix="/quotations", tags=["quotations"])
v1_router.include_router(price_analytics_router, prefix="/price-analytics", tags=["price-analytics"])
v1_router.include_router(smart_classify_router, prefix="/smart-classify", tags=["smart-classify"])
v1_router.include_router(scheduled_reports_router, prefix="/scheduled-reports", tags=["scheduled-reports"])

# ── ETL — Đồng bộ dữ liệu ──
v1_router.include_router(etl_router, prefix="/etl", tags=["etl"])

# ── Phase 2: Revenue Chain ──
v1_router.include_router(supplier_quotes_router, prefix="/supplier-quotes", tags=["supplier-quotes"])
v1_router.include_router(shipment_tracking_router, prefix="/shipments", tags=["shipments"])
v1_router.include_router(invoice_management_router, prefix="/invoices", tags=["invoices"])
v1_router.include_router(deal_chain_router, prefix="/chains", tags=["chains"])
v1_router.include_router(exchange_rates_router, prefix="/exchange-rates", tags=["exchange-rates"])

# ── Revenue Chain Tasks (manual triggers) ──
from app.api.v1.revenue_tasks import router as revenue_tasks_router
v1_router.include_router(revenue_tasks_router, prefix="/revenue-tasks", tags=["revenue-tasks"])

# ── Phase 3: Operations Intelligence ──
from app.api.v1.smart_inventory import router as smart_inventory_router
from app.api.v1.smart_notifications import router as smart_notifications_router
from app.api.v1.profit_analysis import router as profit_analysis_router
from app.api.v1.task_assignments import router as task_assignments_router

v1_router.include_router(smart_inventory_router, prefix="/smart-inventory", tags=["smart-inventory"])
v1_router.include_router(smart_notifications_router, prefix="/smart-notifications", tags=["smart-notifications"])
v1_router.include_router(profit_analysis_router, prefix="/profit-analysis", tags=["profit-analysis"])
v1_router.include_router(task_assignments_router, prefix="/task-assignments", tags=["task-assignments"])

# ── Phase 4: System Health & Admin ──
from app.api.v1.system_health import router as system_health_router
from app.api.v1.data_migration import router as data_migration_router
from app.api.v1.retry_queue_api import router as retry_queue_router
from app.api.v1.container_history import router as container_history_router

v1_router.include_router(system_health_router, prefix="/system-health", tags=["system-health"])
v1_router.include_router(data_migration_router, prefix="/data-migration", tags=["data-migration"])
v1_router.include_router(retry_queue_router, prefix="/retry-queue", tags=["retry-queue"])
v1_router.include_router(container_history_router, prefix="/containers", tags=["containers"])

# ── Phase 5: UX & Productivity ──
from app.api.v1.document_management import router as document_mgmt_router
from app.api.v1.security_log_api import router as security_log_router
from app.api.v1.excel_export import router as excel_export_router
from app.api.v1.batch_operations import router as batch_ops_router
from app.api.v1.user_guide import router as user_guide_router
from app.api.v1.user_activity import router as user_activity_router

v1_router.include_router(document_mgmt_router, prefix="/documents", tags=["documents"])
v1_router.include_router(security_log_router, prefix="/security-log", tags=["security-log"])
v1_router.include_router(excel_export_router, prefix="/excel-export", tags=["excel-export"])
v1_router.include_router(batch_ops_router, prefix="/batch", tags=["batch"])
v1_router.include_router(user_guide_router, prefix="/help", tags=["help"])
v1_router.include_router(user_activity_router, prefix="/user-activity", tags=["user-activity"])

# ── Phase 6: Finance & CRM ──
from app.api.v1.finance_management import router as finance_mgmt_router
from app.api.v1.crm import router as crm_router
from app.api.v1.finance_reports import router as finance_reports_router

v1_router.include_router(finance_mgmt_router, prefix="/finance-management", tags=["finance-management"])
v1_router.include_router(crm_router, prefix="/crm", tags=["crm"])
v1_router.include_router(finance_reports_router, prefix="/finance-reports", tags=["finance-reports"])

# ── Phase 7: Advanced Features ──
from app.api.v1.email_history import router as email_history_router
from app.api.v1.demand_forecast import router as demand_forecast_router
from app.api.v1.ocr_service import router as ocr_service_router
from app.api.v1.calendar_api import router as calendar_router

v1_router.include_router(email_history_router, prefix="/emails", tags=["emails"])
v1_router.include_router(demand_forecast_router, prefix="/demand-forecast", tags=["demand-forecast"])
v1_router.include_router(ocr_service_router, prefix="/ocr", tags=["ocr"])
v1_router.include_router(calendar_router, prefix="/calendar", tags=["calendar"])

# ── Phase 8: PWA + i18n ──
from app.api.v1.pwa_settings import router as pwa_settings_router

v1_router.include_router(pwa_settings_router, prefix="/pwa", tags=["pwa"])

# ── File Browser Module ──
from app.api.v1.file_browser import router as file_browser_router

v1_router.include_router(file_browser_router, prefix="/file-browser", tags=["file-browser"])

# ── Procurement (Vendor Bidding Admin) ──
from app.api.v1.procurement import router as procurement_router

v1_router.include_router(procurement_router, prefix="/procurement", tags=["procurement"])

# ── CRM Pipeline Kanban ──
from app.api.v1.crm_pipeline import router as crm_pipeline_router

v1_router.include_router(crm_pipeline_router, prefix="/crm/pipeline", tags=["crm-pipeline"])

# ── Quarterly Invoices (Bảng kê hóa đơn theo quý) ──
from app.api.v1.quarterly_invoices import router as quarterly_invoices_router

v1_router.include_router(quarterly_invoices_router, prefix="/quarterly-invoices", tags=["quarterly-invoices"])

# ── Market Prices (M05 — Tra cứu giá XNK) ──
from app.api.v1.market_prices import router as market_prices_router

v1_router.include_router(market_prices_router, prefix="/market-prices", tags=["market-prices"])

# ── Daily Report (morning summary + revenue trend) ──
from app.api.v1.daily_report import router as daily_report_router

v1_router.include_router(daily_report_router, prefix="/daily-report", tags=["daily-report"])

# ── Price Lookup (Ctrl+K quick widget) ──
from app.api.v1.price_lookup import router as price_lookup_router

v1_router.include_router(price_lookup_router, prefix="/price-lookup", tags=["price-lookup"])

# ── IMV (iMarketVietnam supplier portal) ──
from app.api.v1.imv import router as imv_router

v1_router.include_router(imv_router, prefix="/imv", tags=["imv"])

# ── M40 — Employee Productivity (KPI tháng) ──
from app.api.v1.employee_kpi import router as employee_kpi_router

v1_router.include_router(employee_kpi_router, prefix="/employee-kpi", tags=["employee-kpi"])

# ── M41 — HR: Leave & Attendance ──
from app.api.v1.leave import router as leave_router
from app.api.v1.attendance import router as attendance_router

v1_router.include_router(leave_router, prefix="/leave", tags=["leave"])
v1_router.include_router(attendance_router, prefix="/attendance", tags=["attendance"])
