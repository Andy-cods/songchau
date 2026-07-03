import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import hash_password, TokenData

router = APIRouter()


class CreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str
    display_name: str | None = None
    role: str
    department: str | None = None
    phone: str | None = None
    password: str


class UpdateUserRequest(BaseModel):
    full_name: str | None = None
    display_name: str | None = None
    role: str | None = None
    department: str | None = None
    phone: str | None = None
    is_active: bool | None = None


@router.get("")
async def list_users(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    rows = await conn.fetch(
        "SELECT id, email, full_name, display_name, role, department, phone, "
        "is_active, last_login_at, created_at "
        "FROM users ORDER BY created_at DESC"
    )
    return {
        "data": [
            {**dict(r), "id": str(r["id"])}
            for r in rows
        ]
    }


@router.post("", status_code=201)
async def create_user(
    body: CreateUserRequest,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    existing = await conn.fetchval("SELECT 1 FROM users WHERE email = $1", body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email đã tồn tại")

    user_id = await conn.fetchval(
        "INSERT INTO users (email, full_name, display_name, role, department, phone, hashed_password, created_by) "
        "VALUES ($1, $2, $3, $4::role_enum, $5, $6, $7, $8) RETURNING id",
        body.email,
        body.full_name,
        body.display_name,
        body.role,
        body.department,
        body.phone,
        hash_password(body.password),
        token_data.user_id,
    )

    return {"data": {"id": str(user_id)}, "message": "Tạo người dùng thành công"}


@router.put("/{user_id}")
async def update_user(
    user_id: str,
    body: UpdateUserRequest,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Không có gì để cập nhật")

    set_clauses = []
    values = []
    for i, (key, value) in enumerate(updates.items(), start=1):
        if key == "role":
            set_clauses.append(f"{key} = ${i}::role_enum")
        else:
            set_clauses.append(f"{key} = ${i}")
        values.append(value)

    values.append(user_id)
    query = f"UPDATE users SET {', '.join(set_clauses)} WHERE id = ${len(values)}"
    await conn.execute(query, *values)

    return {"message": "Cập nhật thành công"}


@router.delete("/{user_id}")
async def deactivate_user(
    user_id: str,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    await conn.execute(
        "UPDATE users SET is_active = false WHERE id = $1", user_id
    )
    return {"message": "Đã vô hiệu hóa tài khoản"}


@router.post("/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    body: dict,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Admin đặt lại mật khẩu cho NGƯỜI DÙNG KHÁC.

    FE (users.ts:63) gửi ``{password: newPassword}`` — đọc body['password'].
    Bump ``password_version`` → mọi token cũ của user đích đều 401 (revoke). Endpoint
    này KHÔNG cấp token (admin reset người khác). user_id là str; users.id là UUID
    → asyncpg tự ép str→UUID (giống update_user/deactivate_user), KHÔNG cast bigint.
    """
    new_password = body.get("password") or ""
    if len(new_password) < 8 or not re.search(r"[A-Za-z]", new_password) or not re.search(r"\d", new_password):
        raise HTTPException(
            status_code=400,
            detail="Mật khẩu mới phải có ít nhất 8 ký tự, gồm cả chữ và số",
        )

    async with conn.transaction():
        target_role = await conn.fetchval(
            "UPDATE users SET hashed_password = $1, "
            "password_version = password_version + 1, updated_at = NOW() "
            "WHERE id = $2 RETURNING role",
            hash_password(new_password), user_id,
        )
        if target_role is None:
            raise HTTPException(status_code=404, detail="Người dùng không tồn tại")

        # NCC → gửi thông báo password_changed (recipient_id NOT NULL → set cả 2 cột).
        if str(target_role) == "vendor":
            vendor_id = await conn.fetchval(
                "SELECT id FROM vendor_accounts WHERE user_id = $1", user_id
            )
            if vendor_id is not None:
                await conn.execute(
                    """
                    INSERT INTO notifications
                        (recipient_id, recipient_vendor_id, type, title, body)
                    VALUES ($1::uuid, $2, 'password_changed',
                            'Mật khẩu đã được thay đổi',
                            'Mật khẩu tài khoản NCC của bạn vừa được Song Châu đặt lại. '
                            'Vui lòng đăng nhập lại bằng mật khẩu mới.')
                    """,
                    user_id, vendor_id,
                )

    return {
        "message": "Đã đặt lại mật khẩu — mọi phiên cũ của người dùng đã bị vô hiệu hoá"
    }
