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
