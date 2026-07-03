"""Vendor Portal — Auth endpoints (login, register)."""

from __future__ import annotations

import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import auth_rate_limit
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.utils.email_sender import send_email

logger = logging.getLogger(__name__)
router = APIRouter()


def _validate_password_strength(pw: str) -> None:
    """Chính sách mật khẩu NCC THỐNG NHẤT (Đợt A): ≥8 ký tự, gồm cả chữ và số.
    Áp cho register / activate / change-password. KHÔNG áp ở login → không khoá
    tài khoản cũ vốn đặt mật khẩu yếu theo policy ≥6 trước đây."""
    if len(pw or "") < 8 or not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise HTTPException(400, "Mật khẩu phải tối thiểu 8 ký tự, gồm cả chữ và số")


@router.post("/register")
async def vendor_register(
    body: dict[str, Any],
    conn: asyncpg.Connection = Depends(get_db),
    _rl=Depends(auth_rate_limit),
):
    """Đăng ký tài khoản nhà cung cấp mới. Cần Song Châu duyệt trước khi đăng nhập."""
    required = ["email", "password", "company_name", "contact_name", "phone"]
    for f in required:
        if not body.get(f):
            raise HTTPException(400, f"Trường '{f}' là bắt buộc")
    _validate_password_strength(body["password"])

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
    _rl=Depends(auth_rate_limit),
):
    """Đăng nhập nhà cung cấp."""
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    if not email or not password:
        raise HTTPException(400, "Email và mật khẩu là bắt buộc")

    user = await conn.fetchrow(
        "SELECT id, email, hashed_password, full_name, role, is_active, password_version "
        "FROM users WHERE email = $1",
        email,
    )

    if not user or str(user["role"]) != "vendor":
        raise HTTPException(401, "Email hoặc mật khẩu không đúng")

    if not verify_password(password, user["hashed_password"]):
        raise HTTPException(401, "Email hoặc mật khẩu không đúng")

    if not user["is_active"]:
        # Check account status (transition-safe: new status OR legacy is_approved)
        va = await conn.fetchrow(
            "SELECT status, is_approved FROM vendor_accounts WHERE user_id = $1", user["id"]
        )
        approved = va and (str(va["status"]) == "active" or va["is_approved"])
        if str(va["status"] if va else "") == "suspended":
            raise HTTPException(403, "Tài khoản đã bị tạm khoá. Liên hệ Song Châu.")
        if not approved:
            raise HTTPException(403, "Tài khoản chưa được duyệt. Vui lòng liên hệ Song Châu.")
        # Approved but inactive — activate
        await conn.execute("UPDATE users SET is_active = true WHERE id = $1", user["id"])

    # Get vendor account info + stamp last login
    vendor = await conn.fetchrow(
        "SELECT id, company_name, contact_name FROM vendor_accounts WHERE user_id = $1",
        user["id"],
    )
    if vendor:
        await conn.execute(
            "UPDATE vendor_accounts SET last_login_at = NOW() WHERE id = $1", vendor["id"]
        )

    # Token of the just-logged-in user carries their CURRENT pv → never self-locks.
    access_token = create_access_token(
        str(user["id"]), "vendor", user["email"], user["password_version"]
    )
    refresh_token = create_refresh_token(str(user["id"]), user["password_version"])

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


@router.post("/activate")
async def vendor_activate(
    body: dict[str, Any],
    conn: asyncpg.Connection = Depends(get_db),
    _rl=Depends(auth_rate_limit),
):
    """Kích hoạt tài khoản NCC qua link mời — NCC đặt mật khẩu lần đầu.

    Admin mời 1 NCC → tạo users(vendor, inactive) + vendor_accounts(pending,
    activation_token). NCC mở link ``/activate/{token}`` → POST {token, password}
    → đặt mật khẩu + active + auto đăng nhập. Token dùng 1 lần, hết hạn theo
    activation_expires.
    """
    token = (body.get("token") or "").strip()
    password = body.get("password") or ""
    if not token:
        raise HTTPException(400, "Thiếu token kích hoạt")
    _validate_password_strength(password)

    # W2-07: SELECT này CHỈ để dựng thông báo lỗi thân thiện (404 vs 410) và lấy
    # thông tin user cho JWT. Việc TIÊU THỤ token là câu UPDATE có điều kiện bên
    # dưới (atomic single-use) — KHÔNG dựa vào SELECT này để chống tái dùng, vì có
    # khe TOCTOU giữa đọc và ghi khi 2 request cùng token chạy song song.
    va = await conn.fetchrow(
        """
        SELECT va.id, va.user_id, va.activation_expires, va.company_name,
               u.email, u.full_name
          FROM vendor_accounts va JOIN users u ON u.id = va.user_id
         WHERE va.activation_token = $1
        """,
        token,
    )
    if not va:
        raise HTTPException(404, "Link kích hoạt không hợp lệ hoặc đã dùng")
    # FAIL-CLOSED: activation_expires NULL ⇒ coi như đã hết hạn — KHÔNG cho token
    # vô thời hạn lọt qua (invite luôn set expires nên happy-path không đổi).
    if not va["activation_expires"] or va["activation_expires"] < datetime.now(timezone.utc):
        raise HTTPException(410, "Link kích hoạt đã hết hạn — liên hệ Song Châu để được mời lại")

    pwd_hash = hash_password(password)
    async with conn.transaction():
        # ATOMIC single-use: tiêu thụ token bằng UPDATE có điều kiện token CÒN
        # nguyên + CHƯA hết hạn. Row-lock của UPDATE đảm bảo chỉ MỘT request thắng;
        # các request đua cùng token (double-submit / replay) sẽ RETURNING rỗng.
        consumed = await conn.fetchval(
            """
            UPDATE vendor_accounts
               SET status = 'active', is_approved = true,
                   activation_token = NULL, activation_expires = NULL,
                   last_login_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND activation_token = $2
               AND activation_expires IS NOT NULL
               AND activation_expires > NOW()
            RETURNING id
            """,
            va["id"], token,
        )
        if consumed is None:
            # Thua cuộc đua / token vừa bị tiêu thụ giữa SELECT và UPDATE này.
            raise HTTPException(409, "Link kích hoạt đã được dùng — vui lòng đăng nhập")
        # Bump pv AND read the NEW value atomically via RETURNING. The token below
        # MUST carry this NEW pv — issuing with the OLD pv would 401 the brand-new
        # vendor on their very first request (the classic first-login lockout trap).
        new_pv = await conn.fetchval(
            "UPDATE users SET hashed_password = $1, is_active = true, "
            "password_version = password_version + 1 WHERE id = $2 "
            "RETURNING password_version",
            pwd_hash, va["user_id"],
        )
    logger.info("Vendor account activated: %s (%s)", va["email"], va["company_name"])

    access_token = create_access_token(
        str(va["user_id"]), "vendor", va["email"], new_pv
    )
    refresh_token = create_refresh_token(str(va["user_id"]), new_pv)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {
            "id": va["user_id"],
            "email": va["email"],
            "full_name": va["full_name"],
            "role": "vendor",
            "vendor_id": va["id"],
            "company_name": va["company_name"],
        },
    }


def _portal_base() -> str:
    """Base URL cổng NCC (giống _vendor_portal_base ở api/v1/procurement.py).

    Dùng để build link kích hoạt / đặt lại mật khẩu. Khớp chuẩn activate-link
    hiện tại (``{base}/activate/{token}``) để format nhất quán.
    """
    return (
        getattr(settings, "VENDOR_PORTAL_URL", None)
        or getattr(settings, "PUBLIC_BASE_URL", None)
        # Cổng NCC hiện phục vụ tại erp.songchau.vn/ncc (basePath '/ncc', tạm tới
        # khi có domain riêng — next.config.mjs). Khi gán domain riêng: set env
        # VENDOR_PORTAL_URL=https://ncc.songchau.vn.
        or "https://erp.songchau.vn/ncc"
    ).rstrip("/")


@router.post("/forgot-password")
async def vendor_forgot_password(
    body: dict[str, Any],
    conn: asyncpg.Connection = Depends(get_db),
    _rl=Depends(auth_rate_limit),
):
    """Đợt 1 — NCC quên mật khẩu → sinh reset_token TTL ngắn (30 phút).

    CHỐNG DÒ EMAIL: luôn trả 200 generic, KHÔNG tiết lộ email có tồn tại hay
    không. Token chỉ thực sự được tạo khi email khớp 1 tài khoản vendor.

    EMAIL CHƯA LIVE (M365 trống): thử gửi email best-effort; nếu chưa gửi được
    thì TRẢ VỀ `reset_link` để admin relay tay. Khi M365 live + gửi thành công
    → KHÔNG trả link (bảo mật hơn). Rate-limit bằng auth_rate_limit (5/60s).
    """
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(400, "Email là bắt buộc")

    va = await conn.fetchrow(
        "SELECT va.id, va.contact_name "
        "FROM vendor_accounts va JOIN users u ON u.id = va.user_id "
        "WHERE u.email = $1 AND u.role = 'vendor'::role_enum",
        email,
    )

    result: dict[str, Any] = {
        "message": "Nếu email tồn tại, link đặt lại mật khẩu đã được tạo."
    }
    if not va:
        return result

    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(minutes=30)
    await conn.execute(
        "UPDATE vendor_accounts SET reset_token = $1, reset_expires = $2, "
        "updated_at = NOW() WHERE id = $3",
        token, expires, va["id"],
    )

    reset_link = f"{_portal_base()}/reset-password/{token}"
    email_sent = False
    try:
        await send_email(
            [email],
            "[Song Châu] Đặt lại mật khẩu cổng Nhà Cung Cấp",
            f'<p>Nhấn để đặt lại mật khẩu (hết hạn sau 30 phút):</p>'
            f'<p><a href="{reset_link}">{reset_link}</a></p>',
        )
        email_sent = True
    except Exception as exc:  # noqa: BLE001 — email best-effort
        logger.warning("Reset email NCC %s thất bại (best-effort): %s", email, exc)

    result["email_sent"] = email_sent
    if not email_sent:
        # Email chưa gửi được → lộ link cho admin relay (đánh đổi Đợt 1). Khi
        # gửi được thì KHÔNG trả link.
        result["reset_link"] = reset_link
    return result


@router.post("/reset-password")
async def vendor_reset_password(
    body: dict[str, Any],
    conn: asyncpg.Connection = Depends(get_db),
    _rl=Depends(auth_rate_limit),
):
    """Đợt 1 — NCC đặt mật khẩu mới bằng reset_token.

    Verify token chưa hết hạn → đặt mật khẩu mới + bump password_version (revoke
    MỌI phiên/token cũ) + clear reset_token (dùng 1 lần). KHÔNG cấp token mới →
    FE đá về trang đăng nhập. Rate-limit bằng auth_rate_limit (5/60s).
    """
    token = (body.get("token") or "").strip()
    password = body.get("password") or ""
    if not token:
        raise HTTPException(400, "Thiếu token")
    _validate_password_strength(password)

    # W2-07: SELECT chỉ để dựng thông báo lỗi (404 vs 410). Tiêu thụ token là câu
    # UPDATE có điều kiện bên dưới (atomic single-use) — chống double-use/replay.
    va = await conn.fetchrow(
        "SELECT id, user_id, reset_expires FROM vendor_accounts WHERE reset_token = $1",
        token,
    )
    if not va:
        raise HTTPException(404, "Link đặt lại không hợp lệ hoặc đã dùng")
    # FAIL-CLOSED: reset_expires NULL ⇒ coi như đã hết hạn.
    if not va["reset_expires"] or va["reset_expires"] < datetime.now(timezone.utc):
        raise HTTPException(410, "Link đặt lại đã hết hạn — yêu cầu lại")

    pwd_hash = hash_password(password)
    async with conn.transaction():
        # ATOMIC single-use: tiêu thụ reset_token bằng UPDATE có điều kiện token
        # còn nguyên + chưa hết hạn. Đua cùng token → RETURNING rỗng → 409.
        consumed = await conn.fetchval(
            "UPDATE vendor_accounts SET reset_token = NULL, reset_expires = NULL, "
            "updated_at = NOW() WHERE id = $1 AND reset_token = $2 "
            "AND reset_expires IS NOT NULL AND reset_expires > NOW() RETURNING id",
            va["id"], token,
        )
        if consumed is None:
            raise HTTPException(409, "Link đặt lại đã được dùng — vui lòng đăng nhập")
        # bump password_version → revoke mọi token cũ (force-relogin). is_active=true:
        # reset chỉ áp cho NCC từng active (NCC pending dùng activation flow), cho
        # phép lấy lại quyền sau khi tự đặt mật khẩu qua email + token hợp lệ.
        await conn.execute(
            "UPDATE users SET hashed_password = $1, "
            "password_version = password_version + 1, is_active = true, "
            "updated_at = NOW() WHERE id = $2",
            pwd_hash, va["user_id"],
        )
    logger.info("Vendor password reset for user_id=%s", va["user_id"])
    return {"message": "Đặt lại mật khẩu thành công. Vui lòng đăng nhập."}
