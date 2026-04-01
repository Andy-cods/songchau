"""
M01: Quotation Templates + Auto-Fill API.

Endpoints:
  - CRUD for quotation templates (upload/manage Excel templates)
  - Auto-fill: parse BC BQMS → preview items → generate quotation
  - History: list/view generated quotations
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.core.database import get_db
from app.core.rbac import require_role, TokenData

router = APIRouter()


# ─── Pydantic Models ─────────────────────────────────────────

class TemplateCreate(BaseModel):
    name: str
    description: str | None = None
    template_type: str  # cam_ket, commercial, combined
    is_default: bool = False


class QuotationCreate(BaseModel):
    rfq_no: str
    source_type: str = "excel"  # excel, rfq_code, ai_classify
    template_id: int | None = None
    items: list[dict[str, Any]] = []


class QuotationUpdate(BaseModel):
    items: list[dict[str, Any]] | None = None
    status: str | None = None


# ─── Template CRUD ────────────────────────────────────────────

@router.get("/templates")
async def list_templates(
    template_type: str | None = None,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List all quotation templates."""
    if template_type:
        rows = await conn.fetch(
            "SELECT * FROM quotation_templates WHERE template_type = $1 ORDER BY is_default DESC, name",
            template_type,
        )
    else:
        rows = await conn.fetch(
            "SELECT * FROM quotation_templates ORDER BY template_type, is_default DESC, name"
        )
    return {"data": [dict(r) for r in rows]}


@router.post("/templates")
async def create_template(
    name: str = Form(...),
    template_type: str = Form(...),
    description: str = Form(None),
    is_default: bool = Form(False),
    file: UploadFile = File(...),
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Upload a new quotation template."""
    if template_type not in ("cam_ket", "commercial", "combined"):
        raise HTTPException(400, "template_type phải là cam_ket, commercial, hoặc combined")

    # Save file
    import aiofiles
    file_ext = file.filename.rsplit(".", 1)[-1] if file.filename else "xlsx"
    file_name = f"template_{template_type}_{uuid.uuid4().hex[:8]}.{file_ext}"
    file_path = f"/data/files/templates/{file_name}"

    from pathlib import Path
    Path("/data/files/templates").mkdir(parents=True, exist_ok=True)

    content = await file.read()
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # If setting as default, unset other defaults
    if is_default:
        await conn.execute(
            "UPDATE quotation_templates SET is_default = false WHERE template_type = $1",
            template_type,
        )

    row = await conn.fetchrow(
        """
        INSERT INTO quotation_templates (name, description, template_type, file_path, is_default, created_by)
        VALUES ($1, $2, $3, $4, $5, $6::uuid)
        RETURNING *
        """,
        name, description, template_type, file_path, is_default, token_data.user_id,
    )
    return {"data": dict(row), "message": f"Template '{name}' đã được tạo"}


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Delete a quotation template."""
    deleted = await conn.fetchval(
        "DELETE FROM quotation_templates WHERE id = $1 RETURNING id", template_id
    )
    if not deleted:
        raise HTTPException(404, "Template không tồn tại")
    return {"message": "Đã xóa template"}


# ─── Auto-Fill: Lookup by RFQ Code ───────────────────────────

@router.get("/lookup")
async def lookup_rfq(
    rfq_code: str = Query(..., min_length=2, description="Mã RFQ (VD: QT23033303)"),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Lookup RFQ items from DB by RFQ number → return items with price history."""
    from app.services.tools.autofill_service import lookup_prices, classify_loai_hang

    # Search by exact match or partial match
    rows = await conn.fetch(
        """
        SELECT rfq_number, bqms_code, specification, maker, unit,
               expected_qty, quoted_price_bqms_v1, quoted_price_bqms_v2,
               quoted_price_bqms_v3, quoted_price_bqms_v4,
               result::text as result, notes, person_in_charge_name
        FROM bqms_rfq
        WHERE rfq_number = $1
           OR rfq_number ILIKE '%' || $1 || '%'
        ORDER BY created_at DESC
        LIMIT 100
        """,
        rfq_code,
    )

    if not rows:
        raise HTTPException(404, f"Không tìm thấy RFQ '{rfq_code}'")

    items = []
    for r in rows:
        items.append({
            "id": f"{r['rfq_number']}_{r['bqms_code']}",
            "don_hang": r["rfq_number"],
            "bqms": r["bqms_code"] or "",
            "spec": r["specification"] or "",
            "short_name": "",
            "loai_hang": "UNKNOWN",
            "maker": r["maker"] or "",
            "mark": "",
            "don_vi": r["unit"] or "EA",
            "so_luong": int(r["expected_qty"] or 0),
            "han_bg": "",
            "deadline_dt": None,
            "is_urgent": False,
            "ghi_chu": r["notes"] or "",
        })

    # Lookup prices for each item
    items = await lookup_prices(conn, items)

    return {
        "data": {
            "items": items,
            "total": len(items),
            "gc_count": len([i for i in items if i["loai_hang"] == "GC"]),
            "tm_count": len([i for i in items if i["loai_hang"] == "TM"]),
            "with_price": len([i for i in items if i.get("suggested_price")]),
            "rfq_number": rows[0]["rfq_number"] if rows else rfq_code,
        },
        "message": f"Tìm thấy {len(items)} items cho RFQ '{rfq_code}'",
    }


# ─── Auto-Fill: Parse ─────────────────────────────────────────

@router.post("/parse")
async def parse_bc_bqms(
    file: UploadFile = File(...),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Parse an uploaded BC BQMS Excel file → list of order items with price lookup."""
    from app.services.tools.autofill_service import parse_bc_bqms as _parse, lookup_prices

    content = await file.read()
    if not content:
        raise HTTPException(400, "File rỗng")

    try:
        items = _parse(content)
    except Exception as exc:
        raise HTTPException(400, f"Lỗi parse Excel: {exc}")

    if not items:
        raise HTTPException(400, "Không tìm thấy đơn hàng trong file Excel")

    # Lookup prices
    items = await lookup_prices(conn, items)

    return {
        "data": {
            "items": items,
            "total": len(items),
            "gc_count": len([i for i in items if i["loai_hang"] == "GC"]),
            "tm_count": len([i for i in items if i["loai_hang"] == "TM"]),
            "with_price": len([i for i in items if i.get("suggested_price")]),
        },
        "message": f"Đã parse {len(items)} đơn hàng",
    }


# ─── Auto-Fill: Generate ─────────────────────────────────────

@router.post("/generate")
async def generate_quotation(
    body: QuotationCreate,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Create a quotation record and start auto-fill background job."""
    # Get templates
    cam_ket_tpl = await conn.fetchval(
        "SELECT file_path FROM quotation_templates WHERE template_type = 'cam_ket' AND is_default = true LIMIT 1"
    )
    commercial_tpl = await conn.fetchval(
        "SELECT file_path FROM quotation_templates WHERE template_type = 'commercial' AND is_default = true LIMIT 1"
    )

    if body.template_id:
        tpl = await conn.fetchrow(
            "SELECT file_path, template_type FROM quotation_templates WHERE id = $1", body.template_id
        )
        if tpl:
            if tpl["template_type"] == "cam_ket":
                cam_ket_tpl = tpl["file_path"]
            else:
                commercial_tpl = tpl["file_path"]

    # Create quotation record
    row = await conn.fetchrow(
        """
        INSERT INTO quotations (rfq_no, source_type, template_id, items, total_items, created_by, status)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6::uuid, 'processing')
        RETURNING id, rfq_no, status, created_at
        """,
        body.rfq_no,
        body.source_type,
        body.template_id,
        json.dumps(body.items, default=str, ensure_ascii=False),
        len(body.items),
        token_data.user_id,
    )

    # Run auto-fill (inline for now; can move to Procrastinate for large batches)
    from app.services.tools.autofill_service import run_autofill_job

    result = await run_autofill_job(
        conn=conn,
        quotation_id=row["id"],
        items=body.items,
        cam_ket_template=cam_ket_tpl,
        commercial_template=commercial_tpl,
    )

    return {
        "data": {
            "id": row["id"],
            "rfq_no": row["rfq_no"],
            "status": "completed" if result["success"] else "failed",
            "files": result.get("files", []),
            "total_items": result.get("total_items", 0),
            "filled_items": result.get("filled_items", 0),
            "errors": result.get("errors", []),
        },
        "message": "Báo giá đã được tạo" if result["success"] else "Tạo báo giá thất bại",
    }


# ─── Quotation History ───────────────────────────────────────

@router.get("/history")
async def list_quotations(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: str | None = None,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List generated quotations with pagination."""
    offset = (page - 1) * limit
    conditions = []
    params: list[Any] = []

    if status:
        conditions.append(f"status = ${len(params) + 1}")
        params.append(status)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total = await conn.fetchval(f"SELECT COUNT(*) FROM quotations {where}", *params)

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT q.*, u.full_name as created_by_name
        FROM quotations q
        LEFT JOIN users u ON u.id = q.created_by
        {where}
        ORDER BY q.created_at DESC
        LIMIT ${len(params) - 1} OFFSET ${len(params)}
        """,
        *params,
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "limit": limit,
        }
    }


@router.get("/history/{quotation_id}")
async def get_quotation(
    quotation_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Get a single quotation detail."""
    row = await conn.fetchrow(
        """
        SELECT q.*, u.full_name as created_by_name
        FROM quotations q
        LEFT JOIN users u ON u.id = q.created_by
        WHERE q.id = $1
        """,
        quotation_id,
    )
    if not row:
        raise HTTPException(404, "Báo giá không tồn tại")
    return {"data": dict(row)}


@router.get("/download/{quotation_id}/{file_type}")
async def download_quotation_file(
    quotation_id: int,
    file_type: str,  # cam_ket_xlsx, cam_ket_pdf, quotation_xlsx, quotation_pdf
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Download a generated quotation file."""
    from fastapi.responses import FileResponse

    row = await conn.fetchrow("SELECT output_xlsx, output_pdf FROM quotations WHERE id = $1", quotation_id)
    if not row:
        raise HTTPException(404, "Báo giá không tồn tại")

    if "pdf" in file_type and row["output_pdf"]:
        return FileResponse(row["output_pdf"], media_type="application/pdf", filename=f"quotation_{quotation_id}.pdf")
    elif row["output_xlsx"]:
        return FileResponse(
            row["output_xlsx"],
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=f"quotation_{quotation_id}.xlsx",
        )

    raise HTTPException(404, "File chưa được tạo")
