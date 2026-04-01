"""
Manual trigger endpoints for revenue chain background tasks.

These allow admin/manager to trigger tasks on-demand instead of waiting for cron.
Workaround until Procrastinate periodic tasks are fixed.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.rbac import require_role, TokenData

router = APIRouter()


@router.post("/detect-wins")
async def trigger_detect_wins(
    token_data: TokenData = Depends(require_role("admin", "manager")),
):
    """Manually trigger win detection: scan bqms_rfq for won results → create Sales Orders."""
    from app.tasks.revenue_chain import detect_rfq_wins
    result = detect_rfq_wins()
    return {"data": result, "message": result.get("message", "")}


@router.post("/check-shipments")
async def trigger_check_shipments(
    token_data: TokenData = Depends(require_role("admin", "manager")),
):
    """Check approaching/overdue shipment ETAs."""
    from app.tasks.revenue_chain import check_shipment_eta
    result = check_shipment_eta()
    return {"data": result, "message": f"{result['approaching_count']} sắp đến, {result['overdue_count']} quá hạn"}


@router.post("/check-invoices")
async def trigger_check_invoices(
    token_data: TokenData = Depends(require_role("admin", "manager")),
):
    """Check overdue invoices and update status."""
    from app.tasks.revenue_chain import check_overdue_invoices
    result = check_overdue_invoices()
    return {"data": result, "message": f"{result['overdue_count']} hóa đơn quá hạn"}


@router.post("/sync-rates")
async def trigger_sync_rates(
    token_data: TokenData = Depends(require_role("admin", "manager", "accountant")),
):
    """Fetch latest exchange rates from Vietcombank."""
    from app.tasks.revenue_chain import sync_exchange_rates
    result = sync_exchange_rates()
    return {"data": result, "message": "Đã cập nhật tỷ giá" if result.get("success") else result.get("message", "")}
