"""Vendor Portal — Profile management."""

from __future__ import annotations

import logging
import re
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.api.vendor.deps import resolve_vendor
from app.core.database import get_db
from app.core.rbac import get_current_user
from app.core.security import TokenData, hash_password, verify_password

logger = logging.getLogger(__name__)
router = APIRouter()


def _check_password_strength(pw: str) -> None:
    """Reject weak passwords: min 8 chars AND at least one letter AND one digit."""
    if len(pw) < 8 or not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise HTTPException(
            400, "Mật khẩu mới phải có ít nhất 8 ký tự, gồm cả chữ và số"
        )


@router.get("")
async def get_profile(
    vendor_id: int = Depends(resolve_vendor),
    token: TokenData = Depends(get_current_user),
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
    vendor_id: int = Depends(resolve_vendor),
    token: TokenData = Depends(get_current_user),
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


@router.post("/change-password")
async def change_password(
    body: dict[str, Any],
    vendor_id: int = Depends(resolve_vendor),
    token: TokenData = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
):
    """NCC tự đổi mật khẩu — Q6 FORCE-RELOGIN (Thang chốt Option B).

    KHÔNG cấp token mới: chỉ verify mật khẩu hiện tại + chính sách độ mạnh +
    bump ``password_version`` trong transaction. Việc bump pv vô hiệu hoá CHÍNH
    phiên hiện tại của caller (request kế tiếp sẽ 401 TOKEN_REVOKED ở chokepoint),
    nên FE phải xoá token và đá về /ncc/login. Không cấp token = không có nguy cơ
    lockout do issue-with-stale-pv ở site này.
    """
    current_password = body.get("current_password") or ""
    new_password = body.get("new_password") or ""

    if not current_password or not new_password:
        raise HTTPException(400, "Vui lòng nhập mật khẩu hiện tại và mật khẩu mới")
    _check_password_strength(new_password)
    if new_password == current_password:
        raise HTTPException(400, "Mật khẩu mới phải khác mật khẩu hiện tại")

    row = await conn.fetchrow(
        "SELECT hashed_password, password_version FROM users WHERE id = $1",
        token.user_id,
    )
    if not row:
        raise HTTPException(404, "Tài khoản không tồn tại")
    if not verify_password(current_password, row["hashed_password"]):
        raise HTTPException(400, "Mật khẩu hiện tại không đúng")

    new_hash = hash_password(new_password)
    async with conn.transaction():
        await conn.execute(
            "UPDATE users SET hashed_password = $1, "
            "password_version = password_version + 1, updated_at = NOW() WHERE id = $2",
            new_hash, token.user_id,
        )
        # Notif: recipient_id is NOT NULL → set BOTH the vendor's users.id AND the
        # vendor-portal recipient_vendor_id so the bell badge picks it up.
        await conn.execute(
            """
            INSERT INTO notifications
                (recipient_id, recipient_vendor_id, type, title, body)
            VALUES ($1::uuid, $2, 'password_changed',
                    'Mật khẩu đã được thay đổi',
                    'Mật khẩu tài khoản NCC của bạn vừa được đổi. '
                    'Nếu không phải bạn, liên hệ Song Châu ngay.')
            """,
            token.user_id, vendor_id,
        )
    logger.info("Vendor self-changed password: user_id=%s vendor_id=%s", token.user_id, vendor_id)

    # DELIBERATELY no access_token/refresh_token — Q6 force-relogin.
    return {"message": "Đổi mật khẩu thành công"}
