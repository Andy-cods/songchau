from fastapi import APIRouter, Depends, HTTPException, Response, Request
from pydantic import BaseModel, EmailStr
import asyncpg

from app.core.database import get_db
from app.core.security import (
    verify_password,
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
        "SELECT id, email, full_name, display_name, role, hashed_password, is_active "
        "FROM users WHERE email = $1",
        body.email,
    )
    if not user or not verify_password(body.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng")

    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Tài khoản đã bị vô hiệu hóa")

    access_token = create_access_token(
        user_id=str(user["id"]),
        role=user["role"],
        email=user["email"],
    )
    refresh_token = create_refresh_token(user_id=str(user["id"]))

    # Set refresh token as HttpOnly cookie
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=False,  # Set True when using HTTPS
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
        "SELECT id, email, role, is_active FROM users WHERE id = $1",
        payload["sub"],
    )
    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    new_access = create_access_token(
        user_id=str(user["id"]),
        role=user["role"],
        email=user["email"],
    )
    new_refresh = create_refresh_token(user_id=str(user["id"]))

    response.set_cookie(
        key="refresh_token",
        value=new_refresh,
        httponly=True,
        secure=False,
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
