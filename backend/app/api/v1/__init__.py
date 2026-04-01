"""
Song Châu ERP — API v1 Router Registry

Tất cả routers được đăng ký tại đây.
Mỗi router tương ứng với 1 file trong app/api/v1/:
  auth, users, workflows, suppliers, purchase_orders, inventory,
  bqms, files, notifications, sales_orders, finance, xnk,
  customs, reports, dashboard, audit, etl,
  [Phase 1] quotation_templates, price_analytics, smart_classify, scheduled_reports,
  [Phase 2] supplier_quotes, shipment_tracking, invoice_management, deal_chain, exchange_rates_api,
  [Phase 3] smart_inventory, smart_notifications, profit_analysis, task_assignments
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
