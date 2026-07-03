"""BQMS Driver management — extracted from bqms.py (PR-1, Thang 2026-05-13).

Drivers = bqms_contacts rows with is_driver=true. Each driver record includes:
  - Basic info (full_name, phone, email)
  - Verification documents: CCCD photo + license_plate photo
  - Vehicle details: license_plate number, vehicle_type
  - notes

Storage:
  - Driver rows live in `bqms_contacts` table (extended via migration
    bqms_drivers_extension.sql).
  - Image files live under `/data/driver-docs/{driver_id}/{cccd|license_plate}.{ext}`.

Routes (mounted under /api/v1/bqms via v1_router include_router):
  - GET    /drivers                                — list active drivers
  - POST   /drivers                                — create driver
  - PATCH  /drivers/{driver_id}                    — update driver
  - DELETE /drivers/{driver_id}                    — soft or hard delete
  - POST   /drivers/{driver_id}/upload-image       — upload CCCD or plate photo
  - GET    /drivers/{driver_id}/image/{kind}       — serve photo bytes

Deliveries integrate via `bqms_deliveries.driver_id` FK (handled in bqms.py).
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()

# Per Thang 2026-05-13 E2E test: /data/driver-docs không bind-mount → ảnh mất
# khi container restart. Dùng /data/files (đã mount sang /opt/erp/data/files trên host).
_DRIVER_DOCS_ROOT = Path("/data/files/driver-docs")
_DRIVER_DOC_KINDS = ("cccd", "license_plate")
_DRIVER_DOC_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


@router.get("/drivers")
async def list_drivers(
    q: str | None = Query(None),
    include_inactive: bool = Query(False),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách người giao hàng (bqms_contacts.is_driver=true)."""
    conditions = ["is_driver = true"]
    params: list = []
    idx = 1
    if not include_inactive:
        conditions.append("is_active = true")
    if q:
        conditions.append(
            f"(full_name ILIKE ${idx} OR phone ILIKE ${idx} "
            f"OR license_plate ILIKE ${idx} OR cccd_number ILIKE ${idx})"
        )
        params.append(f"%{q}%")
        idx += 1
    where = " AND ".join(conditions)
    rows = await conn.fetch(
        f"""
        SELECT id, full_name, email_username, phone, is_active,
               cccd_number, cccd_image_path, license_plate, license_plate_image_path,
               vehicle_type, driver_notes, created_at, updated_at
        FROM bqms_contacts WHERE {where}
        ORDER BY full_name
        """,
        *params,
    )
    return {
        "data": [
            {**dict(r),
             "has_cccd_image": bool(r["cccd_image_path"]),
             "has_plate_image": bool(r["license_plate_image_path"])}
            for r in rows
        ],
        "total": len(rows),
    }


class _DriverIn(BaseModel):
    full_name: str
    phone: str | None = None
    cccd_number: str | None = None
    license_plate: str | None = None
    vehicle_type: str | None = None
    driver_notes: str | None = None
    email_username: str | None = None


@router.post("/drivers")
async def create_driver(
    body: _DriverIn,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo driver mới. Reuse bqms_contacts với is_driver=true."""
    if not body.full_name or not body.full_name.strip():
        raise HTTPException(400, "full_name là bắt buộc")
    # email_username là UNIQUE NOT NULL trong bqms_contacts → tự sinh nếu thiếu
    email = (body.email_username or "").strip()
    if not email:
        # auto-generate: driver_{phone-or-random}
        phone_clean = (body.phone or "").strip().replace(" ", "") or str(int(time.time()))
        email = f"driver_{phone_clean}@songchau.local"

    row = await conn.fetchrow(
        """
        INSERT INTO bqms_contacts
            (full_name, email_username, phone, is_driver, is_active,
             cccd_number, license_plate, vehicle_type, driver_notes,
             created_at, updated_at)
        VALUES ($1, $2, $3, true, true, $4, $5, $6, $7, NOW(), NOW())
        RETURNING *
        """,
        body.full_name.strip(),
        email,
        (body.phone or "").strip() or None,
        (body.cccd_number or "").strip() or None,
        (body.license_plate or "").strip() or None,
        (body.vehicle_type or "").strip() or None,
        (body.driver_notes or "").strip() or None,
    )
    return {"data": dict(row), "message": "Đã tạo driver"}


class _DriverPatch(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    cccd_number: str | None = None
    license_plate: str | None = None
    vehicle_type: str | None = None
    driver_notes: str | None = None
    is_active: bool | None = None


@router.patch("/drivers/{driver_id}")
async def update_driver(
    driver_id: int,
    body: _DriverPatch,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Update driver info."""
    sets = []
    params: list = []
    idx = 1
    payload = body.model_dump(exclude_unset=True)
    for k, v in payload.items():
        sets.append(f"{k} = ${idx}")
        params.append(v)
        idx += 1
    if not sets:
        raise HTTPException(400, "Không có trường để update")
    sets.append("updated_at = NOW()")
    params.append(driver_id)
    row = await conn.fetchrow(
        f"UPDATE bqms_contacts SET {', '.join(sets)} "
        f"WHERE id = ${idx} AND is_driver = true RETURNING *",
        *params,
    )
    if not row:
        raise HTTPException(404, f"Driver #{driver_id} không tồn tại")
    return {"data": dict(row), "message": "Đã cập nhật driver"}


@router.delete("/drivers/{driver_id}")
async def delete_driver(
    driver_id: int,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Soft delete driver (is_active=false). Hard delete chỉ khi không còn delivery FK."""
    in_use = await conn.fetchval(
        "SELECT COUNT(*) FROM bqms_deliveries WHERE driver_id = $1", driver_id,
    )
    if in_use and int(in_use) > 0:
        # Soft delete
        await conn.execute(
            "UPDATE bqms_contacts SET is_active = false, updated_at = NOW() "
            "WHERE id = $1 AND is_driver = true",
            driver_id,
        )
        return {"data": {"soft_deleted": True, "deliveries_in_use": int(in_use)},
                "message": f"Soft delete: driver được dùng trong {in_use} delivery"}
    # Hard delete
    await conn.execute(
        "DELETE FROM bqms_contacts WHERE id = $1 AND is_driver = true",
        driver_id,
    )
    return {"data": {"hard_deleted": True}, "message": "Đã xóa driver"}


@router.post("/drivers/{driver_id}/upload-image")
async def upload_driver_image(
    driver_id: int,
    kind: str = Form(..., description="'cccd' hoặc 'license_plate'"),
    file: UploadFile = File(...),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Upload ảnh CCCD hoặc biển số xe cho driver."""
    if kind not in _DRIVER_DOC_KINDS:
        raise HTTPException(400, f"kind phải là một trong {_DRIVER_DOC_KINDS}")
    if not file.filename:
        raise HTTPException(400, "Thiếu file")
    ext = Path(file.filename).suffix.lower()
    if ext not in _DRIVER_DOC_EXTENSIONS:
        raise HTTPException(400, f"Định dạng ảnh phải là {_DRIVER_DOC_EXTENSIONS}")

    driver = await conn.fetchrow(
        "SELECT id FROM bqms_contacts WHERE id = $1 AND is_driver = true",
        driver_id,
    )
    if not driver:
        raise HTTPException(404, f"Driver #{driver_id} không tồn tại")

    driver_dir = _DRIVER_DOCS_ROOT / str(driver_id)
    driver_dir.mkdir(parents=True, exist_ok=True)
    target = driver_dir / f"{kind}{ext}"

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(400, "File quá 10MB")
    target.write_bytes(contents)

    db_col = "cccd_image_path" if kind == "cccd" else "license_plate_image_path"
    await conn.execute(
        f"UPDATE bqms_contacts SET {db_col} = $1, updated_at = NOW() WHERE id = $2",
        str(target), driver_id,
    )
    return {"data": {"path": str(target), "size": len(contents), "kind": kind},
            "message": f"Đã upload ảnh {kind}"}


@router.get("/drivers/{driver_id}/image/{kind}")
async def get_driver_image(
    driver_id: int,
    kind: str,
    token_data: TokenData = Depends(require_role(
        "staff", "manager", "admin", "warehouse", "sales", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Serve ảnh CCCD / biển số của driver."""
    if kind not in _DRIVER_DOC_KINDS:
        raise HTTPException(400, f"kind phải là một trong {_DRIVER_DOC_KINDS}")
    db_col = "cccd_image_path" if kind == "cccd" else "license_plate_image_path"
    path = await conn.fetchval(
        f"SELECT {db_col} FROM bqms_contacts WHERE id = $1 AND is_driver = true",
        driver_id,
    )
    if not path:
        raise HTTPException(404, f"Driver #{driver_id} chưa upload ảnh {kind}")
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, f"File ảnh không tồn tại trên disk: {p}")
    return FileResponse(str(p), filename=p.name)
