from fastapi import APIRouter, Depends, HTTPException, Response, Request
from pydantic import BaseModel, EmailStr
import asyncpg
import re

from app.core.config import settings
from app.core.database import get_db
from app.core.security import (
    verify_password,
    hash_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    TokenData,
)
from app.core.rbac import get_current_user

router = APIRouter()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    response: Response,
    conn: asyncpg.Connection = Depends(get_db),
):
    user = await conn.fetchrow(
        "SELECT id, email, full_name, display_name, role, hashed_password, is_active, password_version "
        "FROM users WHERE email = $1",
        body.email,
    )
    if not user or not verify_password(body.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng")

    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Tài khoản đã bị vô hiệu hóa")

    # Token of the just-logged-in user carries their CURRENT pv → never self-locks.
    access_token = create_access_token(
        user_id=str(user["id"]),
        role=user["role"],
        email=user["email"],
        password_version=user["password_version"],
    )
    refresh_token = create_refresh_token(
        user_id=str(user["id"]), password_version=user["password_version"]
    )

    # Set refresh token as HttpOnly cookie
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=7 * 24 * 3600,
    )

    # Update last login
    await conn.execute(
        "UPDATE users SET last_login_at = NOW() WHERE id = $1", user["id"]
    )

    return LoginResponse(
        access_token=access_token,
        user={
            "id": str(user["id"]),
            "email": user["email"],
            "full_name": user["full_name"],
            "display_name": user["display_name"],
            "role": user["role"],
        },
    )


@router.post("/refresh")
async def refresh_token(
    request: Request,
    response: Response,
    conn: asyncpg.Connection = Depends(get_db),
):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        payload = decode_token(token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = await conn.fetchrow(
        "SELECT id, email, role, is_active, password_version FROM users WHERE id = $1",
        payload["sub"],
    )
    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Revoke-token chokepoint: a stale refresh token after a password change/reset
    # must 401 here, else the admin could mint a fresh access token bypassing revoke.
    # OLD refresh token lacks 'pv' → defaults to 1 == DB DEFAULT 1 → does not break on deploy.
    if int(payload.get("pv", 1)) != int(user["password_version"]):
        raise HTTPException(
            status_code=401,
            detail={
                "error": "TOKEN_REVOKED",
                "message": "Phiên đã hết hiệu lực do đổi mật khẩu — vui lòng đăng nhập lại",
            },
        )

    new_access = create_access_token(
        user_id=str(user["id"]),
        role=user["role"],
        email=user["email"],
        password_version=user["password_version"],
    )
    new_refresh = create_refresh_token(
        user_id=str(user["id"]), password_version=user["password_version"]
    )

    response.set_cookie(
        key="refresh_token",
        value=new_refresh,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=7 * 24 * 3600,
    )

    return {"access_token": new_access, "token_type": "bearer"}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("refresh_token")
    return {"message": "Đã đăng xuất"}


@router.get("/me")
async def get_me(
    token_data: TokenData = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
):
    user = await conn.fetchrow(
        "SELECT id, email, full_name, display_name, role, department, phone, last_login_at "
        "FROM users WHERE id = $1",
        token_data.user_id,
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": str(user["id"]),
        "email": user["email"],
        "full_name": user["full_name"],
        "display_name": user["display_name"],
        "role": user["role"],
        "department": user["department"],
        "phone": user["phone"],
        "last_login_at": user["last_login_at"].isoformat() if user["last_login_at"] else None,
    }


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    # FE gửi kèm confirm_password (đã đối chiếu ở client) — Pydantic bỏ qua field thừa.


class UpdateProfileRequest(BaseModel):
    full_name: str | None = None
    display_name: str | None = None
    department: str | None = None
    phone: str | None = None


def _check_pw_strength(pw: str) -> None:
    if len(pw) < 8 or not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise HTTPException(400, "Mật khẩu mới phải có ít nhất 8 ký tự, gồm cả chữ và số")


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    response: Response,
    token_data: TokenData = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tự đổi mật khẩu (self-service, mọi user nội bộ). Bump password_version →
    các phiên KHÁC của chính user này bị revoke; phiên hiện tại được cấp lại token
    pv-mới nên không tự đá ra ngoài."""
    _check_pw_strength(body.new_password)
    if body.new_password == body.current_password:
        raise HTTPException(400, "Mật khẩu mới phải khác mật khẩu hiện tại")
    row = await conn.fetchrow(
        "SELECT email, role, hashed_password FROM users WHERE id = $1",
        token_data.user_id,
    )
    if not row:
        raise HTTPException(404, "Tài khoản không tồn tại")
    if not verify_password(body.current_password, row["hashed_password"]):
        raise HTTPException(400, "Mật khẩu hiện tại không đúng")
    async with conn.transaction():
        new_pv = await conn.fetchval(
            "UPDATE users SET hashed_password = $1, "
            "password_version = password_version + 1, updated_at = NOW() "
            "WHERE id = $2 RETURNING password_version",
            hash_password(body.new_password),
            token_data.user_id,
        )
    access_token = create_access_token(
        user_id=token_data.user_id, role=row["role"], email=row["email"],
        password_version=new_pv,
    )
    refresh = create_refresh_token(user_id=token_data.user_id, password_version=new_pv)
    response.set_cookie(
        key="refresh_token", value=refresh, httponly=True,
        secure=settings.COOKIE_SECURE, samesite="lax", max_age=7 * 24 * 3600,
    )
    return {
        "message": "Đổi mật khẩu thành công",
        "access_token": access_token,
        "refresh_token": refresh,
    }


@router.put("/me")
async def update_me(
    body: UpdateProfileRequest,
    token_data: TokenData = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Cập nhật hồ sơ CHÍNH MÌNH. Chỉ ghi field được gửi khác None (COALESCE) →
    field FE để trống ('') hoặc bỏ qua sẽ KHÔNG xoá trắng dữ liệu cũ."""
    fields = body.model_dump(exclude_none=True)
    # Bỏ chuỗi rỗng để không xoá trắng (FE có thể gửi '' cho phone chưa nhập).
    fields = {k: v for k, v in fields.items() if not (isinstance(v, str) and v == "")}
    if fields:
        cols = ", ".join(f"{k} = ${i}" for i, k in enumerate(fields, start=1))
        await conn.execute(
            f"UPDATE users SET {cols}, updated_at = NOW() WHERE id = ${len(fields) + 1}",
            *fields.values(), token_data.user_id,
        )
    user = await conn.fetchrow(
        "SELECT id, email, full_name, display_name, role, department, phone "
        "FROM users WHERE id = $1",
        token_data.user_id,
    )
    return {
        "id": str(user["id"]),
        "email": user["email"],
        "full_name": user["full_name"],
        "display_name": user["display_name"],
        "role": user["role"],
        "department": user["department"],
        "phone": user["phone"],
    }
