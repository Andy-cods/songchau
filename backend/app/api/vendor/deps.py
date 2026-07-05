"""Vendor Portal — shared dependencies.

`resolve_vendor` is the single chokepoint that turns a JWT into the caller's
own `vendor_accounts.id`. EVERY `/api/vendor/*` query must scope by this id — a
vendor can never pass an arbitrary vendor_id (prevents cross-tenant data access).
"""
from __future__ import annotations

import asyncpg
from fastapi import Depends, HTTPException

from app.core.database import get_db
from app.core.rbac import get_current_user
from app.core.security import TokenData


async def resolve_vendor(
    token: TokenData = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> int:
    """Return the active vendor_accounts.id for the logged-in supplier.

    Enforces role == 'vendor' AND an active account. Transition-safe: accepts
    the new `status='active'` OR the legacy `is_approved=true` so already-approved
    accounts keep working before the status backfill is fully rolled out.
    Raises 403 if the caller is not an active vendor.
    """
    if token.role != "vendor":
        raise HTTPException(403, "Chỉ nhà cung cấp mới truy cập được")
    row = await conn.fetchrow(
        """
        SELECT va.id, va.status, va.is_approved, u.password_version
          FROM vendor_accounts va
          JOIN users u ON u.id = va.user_id
         WHERE va.user_id = $1
        """,
        token.user_id,
    )
    if not row:
        raise HTTPException(403, "Tài khoản nhà cung cấp không tồn tại")
    # V-06 fail-closed: 'suspended' CHẶN CỨNG trước nhánh legacy-or. Trước đây
    # (status='suspended' OR is_approved=true) → NCC bị khoá vẫn qua mọi endpoint
    # nếu is_approved còn true (khoá bằng SQL tay thường chỉ đổi status).
    if str(row["status"]) == "suspended":
        raise HTTPException(403, "Tài khoản nhà cung cấp đã bị khoá")
    is_active = str(row["status"]) == "active" or row["is_approved"] is True
    if not is_active:
        raise HTTPException(403, "Tài khoản chưa được kích hoạt / duyệt")
    # Revoke-token chokepoint for ALL /api/vendor/* traffic. A password change/reset
    # bumps users.password_version → old vendor JWTs 401 here. OLD token pv defaults
    # to 1 == DB DEFAULT 1 → not kicked on deploy.
    if int(row["password_version"]) != int(token.password_version):
        raise HTTPException(
            401,
            {
                "error": "TOKEN_REVOKED",
                "message": "Phiên đã hết hiệu lực do đổi mật khẩu — vui lòng đăng nhập lại",
            },
        )
    return row["id"]
