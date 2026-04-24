"""Vendor Portal — Auth endpoints (login, register)."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.core.database import get_db
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/register")
async def vendor_register(
    body: dict[str, Any],
    conn: asyncpg.Connection = Depends(get_db),
):
    """Đăng ký tài khoản nhà cung cấp mới. Cần Song Châu duyệt trước khi đăng nhập."""
    required = ["email", "password", "company_name", "contact_name", "phone"]
    for f in required:
        if not body.get(f):
            raise HTTPException(400, f"Trường '{f}' là bắt buộc")

    email = body["email"].strip().lower()

    # Check email unique
    existing = await conn.fetchval("SELECT id FROM users WHERE email = $1", email)
    if existing:
        raise HTTPException(400, "Email đã được sử dụng")

    # Create user with role=vendor
    pwd_hash = hash_password(body["password"])
    user_id = await conn.fetchval(
        """
        INSERT INTO users (email, hashed_password, full_name, role, is_active)
        VALUES ($1, $2, $3, 'vendor'::role_enum, false)
        RETURNING id
        """,
        email, pwd_hash, body["contact_name"].strip(),
    )

    # Create vendor account
    await conn.execute(
        """
        INSERT INTO vendor_accounts (user_id, company_name, contact_name, phone, address, tax_code, product_categories)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        """,
        user_id,
        body["company_name"].strip(),
        body["contact_name"].strip(),
        body.get("phone", "").strip(),
        body.get("address", "").strip() or None,
        body.get("tax_code", "").strip() or None,
        body.get("product_categories") or None,
    )

    logger.info("Vendor registered: %s (%s)", email, body["company_name"])

    return {
        "message": "Đăng ký thành công! Vui lòng chờ Song Châu duyệt tài khoản.",
        "user_id": user_id,
    }


@router.post("/login")
async def vendor_login(
    body: dict[str, Any],
    conn: asyncpg.Connection = Depends(get_db),
):
    """Đăng nhập nhà cung cấp."""
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    if not email or not password:
        raise HTTPException(400, "Email và mật khẩu là bắt buộc")

    user = await conn.fetchrow(
        "SELECT id, email, hashed_password, full_name, role, is_active FROM users WHERE email = $1",
        email,
    )

    if not user or str(user["role"]) != "vendor":
        raise HTTPException(401, "Email hoặc mật khẩu không đúng")

    if not verify_password(password, user["hashed_password"]):
        raise HTTPException(401, "Email hoặc mật khẩu không đúng")

    if not user["is_active"]:
        # Check if approved
        va = await conn.fetchrow(
            "SELECT is_approved FROM vendor_accounts WHERE user_id = $1", user["id"]
        )
        if not va or not va["is_approved"]:
            raise HTTPException(403, "Tài khoản chưa được duyệt. Vui lòng liên hệ Song Châu.")
        # Approved but inactive — activate
        await conn.execute("UPDATE users SET is_active = true WHERE id = $1", user["id"])

    # Get vendor account info
    vendor = await conn.fetchrow(
        "SELECT id, company_name, contact_name FROM vendor_accounts WHERE user_id = $1",
        user["id"],
    )

    access_token = create_access_token(str(user["id"]), "vendor", user["email"])
    refresh_token = create_refresh_token(str(user["id"]))

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "full_name": user["full_name"],
            "role": "vendor",
            "vendor_id": vendor["id"] if vendor else None,
            "company_name": vendor["company_name"] if vendor else None,
        },
    }
