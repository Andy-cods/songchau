"""Vendor Portal — Profile management."""

from __future__ import annotations

from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.core.database import get_db
from app.core.rbac import get_current_user
from app.core.security import TokenData

router = APIRouter()


def _require_vendor(token: TokenData = Depends(get_current_user)) -> TokenData:
    if token.role != "vendor":
        raise HTTPException(403, "Chỉ nhà cung cấp mới truy cập được")
    return token


@router.get("")
async def get_profile(
    token: TokenData = Depends(_require_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Thông tin hồ sơ nhà cung cấp."""
    row = await conn.fetchrow(
        """
        SELECT va.id, va.company_name, va.contact_name, va.phone, va.address,
               va.tax_code, va.product_categories, va.is_approved, va.created_at,
               u.email
        FROM vendor_accounts va
        JOIN users u ON u.id = va.user_id
        WHERE va.user_id = $1
        """,
        token.user_id,
    )
    if not row:
        raise HTTPException(404, "Hồ sơ không tồn tại")
    return {"data": dict(row)}


@router.put("")
async def update_profile(
    body: dict[str, Any],
    token: TokenData = Depends(_require_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Cập nhật hồ sơ nhà cung cấp."""
    allowed = {"company_name", "contact_name", "phone", "address", "tax_code", "product_categories"}
    sets = []
    params = []
    idx = 1
    for k, v in body.items():
        if k in allowed:
            sets.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
    if not sets:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    params.append(token.user_id)
    await conn.execute(
        f"UPDATE vendor_accounts SET {', '.join(sets)}, updated_at = NOW() WHERE user_id = ${idx}",
        *params,
    )
    return {"message": "Đã cập nhật hồ sơ"}
