"""
Song Châu ERP — API v1 Router Registry

Tất cả 17 module routers được đăng ký tại đây.
Mỗi router tương ứng với 1 file trong app/api/v1/:
  auth, users, workflows, suppliers, purchase_orders, inventory,
  bqms, files, notifications, sales_orders, finance, xnk,
  customs, reports, dashboard, audit, etl
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

# ── ETL — Đồng bộ dữ liệu ──
v1_router.include_router(etl_router, prefix="/etl", tags=["etl"])
