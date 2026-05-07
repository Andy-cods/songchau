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
    flow_type: str = "tm"  # tm or gc


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
    year: int | None = Query(None, description="Lọc theo năm (VD: 2026)"),
    month: int | None = Query(None, description="Lọc theo tháng (1-12)"),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Lookup RFQ items from DB by RFQ number → return items with price history.
    Optionally filter by year/month of inquiry_date.
    """
    from app.services.tools.autofill_service import lookup_prices, classify_loai_hang

    # Build dynamic query with optional year/month filters
    conditions = ["(rfq_number = $1 OR rfq_number ILIKE '%' || $1 || '%')"]
    params: list[Any] = [rfq_code]
    idx = 2

    if year is not None:
        conditions.append(
            f"EXTRACT(YEAR FROM COALESCE(inquiry_date, created_at::date)) = ${idx}"
        )
        params.append(year)
        idx += 1

    if month is not None:
        conditions.append(
            f"EXTRACT(MONTH FROM COALESCE(inquiry_date, created_at::date)) = ${idx}"
        )
        params.append(month)
        idx += 1

    where = " AND ".join(conditions)

    rows = await conn.fetch(
        f"""
        SELECT rfq_number, bqms_code, specification, maker, unit,
               expected_qty, quoted_price_bqms_v1, quoted_price_bqms_v2,
               quoted_price_bqms_v3, quoted_price_bqms_v4,
               purchase_price_rmb, purchase_price_vnd, quoted_price_ama,
               result::text as result, notes, person_in_charge_name,
               COALESCE(inquiry_date, created_at::date) as effective_date
        FROM bqms_rfq
        WHERE {where}
        ORDER BY created_at DESC
        LIMIT 200
        """,
        *params,
    )

    if not rows:
        raise HTTPException(404, f"Không tìm thấy RFQ '{rfq_code}'" +
                            (f" trong năm {year}" if year else "") +
                            (f" tháng {month}" if month else ""))

    items = []
    for r in rows:
        # Determine loai_hang from spec/maker heuristics
        spec_lower = (r["specification"] or "").lower()
        maker_lower = (r["maker"] or "").lower()
        if any(kw in spec_lower for kw in ("gia công", "gia cong", "gc")):
            loai = "GC"
        elif any(kw in maker_lower for kw in ("gia công", "gia cong")):
            loai = "GC"
        else:
            loai = "TM"  # Default to TM if no GC indicator

        items.append({
            "id": f"{r['rfq_number']}_{r['bqms_code']}",
            "don_hang": r["rfq_number"],
            "bqms": r["bqms_code"] or "",
            "spec": r["specification"] or "",
            "short_name": "",
            "loai_hang": loai,
            "maker": r["maker"] or "",
            "mark": "",
            "don_vi": r["unit"] or "EA",
            "so_luong": int(r["expected_qty"] or 0),
            "han_bg": "",
            "deadline_dt": None,
            "is_urgent": False,
            "ghi_chu": r["notes"] or "",
            "purchase_price_rmb": float(r["purchase_price_rmb"]) if r["purchase_price_rmb"] else None,
            "purchase_price_vnd": float(r["purchase_price_vnd"]) if r["purchase_price_vnd"] else None,
            "quoted_price_ama": float(r["quoted_price_ama"]) if r["quoted_price_ama"] else None,
            "result": r["result"],
            "effective_date": r["effective_date"].isoformat() if r["effective_date"] else None,
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
        flow_type=body.flow_type,
    )

    # Build download/preview URLs for files
    files_with_urls = []
    for f in result.get("files", []):
        f_info = {**f}
        if "pdf" in f["type"]:
            f_info["preview_url"] = f"/api/v1/quotations/preview/{row['id']}/{f['type']}"
        f_info["download_url"] = f"/api/v1/quotations/download/{row['id']}/{f['type']}"
        files_with_urls.append(f_info)

    return {
        "data": {
            "id": row["id"],
            "rfq_no": row["rfq_no"],
            "status": "completed" if result["success"] else "failed",
            "files": files_with_urls,
            "total_items": result.get("total_items", 0),
            "filled_items": result.get("filled_items", 0),
            "errors": result.get("errors", []),
            "flow_type": body.flow_type,
        },
        "message": "Báo giá đã được tạo" if result["success"] else "Tạo báo giá thất bại",
    }


# ─── Quotation History ───────────────────────────────────────

@router.get("/history")
async def list_quotations(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: str | None = None,
    rfq_no: str | None = Query(None, description="Tìm theo RFQ number (LIKE)"),
    created_by: str | None = Query(None, description="UUID nhân viên"),
    date_from: str | None = Query(None, description="ISO date"),
    date_to: str | None = Query(None, description="ISO date"),
    include_deleted: bool = Query(False, description="Admin-only: hiển thị cả báo giá đã xóa"),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List generated quotations with pagination and filters."""
    offset = (page - 1) * limit
    conditions: list[str] = []
    params: list[Any] = []

    # Soft-delete filter (default = exclude). Only admin can include deleted.
    if not (include_deleted and token_data.role == "admin"):
        conditions.append("q.deleted_at IS NULL")

    if status:
        conditions.append(f"q.status = ${len(params) + 1}")
        params.append(status)
    if rfq_no:
        conditions.append(f"q.rfq_no ILIKE ${len(params) + 1}")
        params.append(f"%{rfq_no}%")
    if created_by:
        conditions.append(f"q.created_by = ${len(params) + 1}::uuid")
        params.append(created_by)
    if date_from:
        conditions.append(f"q.created_at >= ${len(params) + 1}::timestamptz")
        params.append(date_from)
    if date_to:
        conditions.append(f"q.created_at < (${len(params) + 1}::date + INTERVAL '1 day')::timestamptz")
        params.append(date_to)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    # COUNT must reference table alias `q` since `where` clauses use it.
    total = await conn.fetchval(f"SELECT COUNT(*) FROM quotations q {where}", *params)

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
          AND q.deleted_at IS NULL
        """,
        quotation_id,
    )
    if not row:
        raise HTTPException(404, "Báo giá không tồn tại")
    return {"data": dict(row)}


# ─── Edit + Regenerate ───────────────────────────────────────

class QuotationPatch(BaseModel):
    """Edit an existing quotation; if `regenerate=true` (default when items
    changed) the underlying Excel + PDF files are recreated from the new items."""
    items: list[dict[str, Any]] | None = None
    rfq_no: str | None = None
    flow_type: str | None = None  # 'tm' | 'gc'
    template_id: int | None = None
    regenerate: bool = True


@router.patch("/history/{quotation_id}")
async def patch_quotation(
    quotation_id: int,
    body: QuotationPatch,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Edit a quotation. If items changed, regenerate Excel + PDF files."""
    row = await conn.fetchrow(
        "SELECT * FROM quotations WHERE id = $1 AND deleted_at IS NULL",
        quotation_id,
    )
    if not row:
        raise HTTPException(404, "Báo giá không tồn tại")

    # Owner / admin / manager can edit
    is_owner = str(row["created_by"]) == token_data.user_id
    if not (is_owner or token_data.role in ("admin", "manager")):
        raise HTTPException(403, "Bạn chỉ sửa được báo giá của chính mình.")

    # Apply scalar updates
    new_rfq = body.rfq_no or row["rfq_no"]
    new_template_id = body.template_id if body.template_id is not None else row["template_id"]
    new_items = body.items if body.items is not None else json.loads(row["items"]) if isinstance(row["items"], str) else (row["items"] or [])

    await conn.execute(
        """
        UPDATE quotations
        SET rfq_no      = $1,
            items       = $2::jsonb,
            template_id = $3,
            total_items = $4,
            updated_at  = NOW()
        WHERE id = $5
        """,
        new_rfq,
        json.dumps(new_items, default=str, ensure_ascii=False),
        new_template_id,
        len(new_items),
        quotation_id,
    )

    # If items changed (or caller forced regenerate=true), rebuild files.
    must_regen = body.regenerate and (body.items is not None or body.rfq_no is not None or body.template_id is not None)
    if must_regen:
        cam_ket_tpl = await conn.fetchval(
            "SELECT file_path FROM quotation_templates WHERE template_type = 'cam_ket' AND is_default = true LIMIT 1"
        )
        commercial_tpl = await conn.fetchval(
            "SELECT file_path FROM quotation_templates WHERE template_type = 'commercial' AND is_default = true LIMIT 1"
        )
        if new_template_id:
            tpl = await conn.fetchrow(
                "SELECT file_path, template_type FROM quotation_templates WHERE id = $1", new_template_id
            )
            if tpl:
                if tpl["template_type"] == "cam_ket":
                    cam_ket_tpl = tpl["file_path"]
                else:
                    commercial_tpl = tpl["file_path"]

        from app.services.tools.autofill_service import run_autofill_job
        result = await run_autofill_job(
            conn=conn,
            quotation_id=quotation_id,
            items=new_items,
            cam_ket_template=cam_ket_tpl,
            commercial_template=commercial_tpl,
            flow_type=body.flow_type or "tm",
        )
        return {
            "data": {
                "id": quotation_id,
                "regenerated": True,
                "files": result.get("files", []),
                "errors": result.get("errors", []),
            },
            "message": "Đã cập nhật và tạo lại báo giá.",
        }

    return {
        "data": {"id": quotation_id, "regenerated": False},
        "message": "Đã cập nhật báo giá (không tạo lại file).",
    }


@router.delete("/history/{quotation_id}")
async def delete_quotation(
    quotation_id: int,
    hard: bool = Query(False, description="Admin-only: xóa hẳn record + file"),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Soft-delete (default) hoặc hard-delete (admin) báo giá.

    Soft-delete: chỉ set `deleted_at`, file vẫn còn trên disk để khôi phục.
    Hard-delete: xóa record + xóa toàn bộ folder file_path output.
    """
    row = await conn.fetchrow(
        "SELECT * FROM quotations WHERE id = $1",
        quotation_id,
    )
    if not row:
        raise HTTPException(404, "Báo giá không tồn tại")

    is_owner = str(row["created_by"]) == token_data.user_id
    is_admin = token_data.role == "admin"
    if not (is_owner or is_admin):
        raise HTTPException(403, "Chỉ người tạo hoặc admin mới được xóa.")

    if hard:
        if not is_admin:
            raise HTTPException(403, "Hard delete chỉ admin được thực hiện.")
        # Remove on-disk folder
        import os
        import shutil
        if row["output_pdf"]:
            out_dir = os.path.dirname(row["output_pdf"])
            if out_dir.startswith("/data/files/") and os.path.isdir(out_dir):
                try:
                    shutil.rmtree(out_dir)
                except Exception:
                    pass
        await conn.execute("DELETE FROM quotations WHERE id = $1", quotation_id)
        return {"data": {"id": quotation_id, "hard_deleted": True}, "message": "Đã xóa hẳn báo giá + file."}

    # Soft-delete
    if row["deleted_at"]:
        return {"data": {"id": quotation_id, "already_deleted": True}, "message": "Báo giá đã được xóa trước đó."}
    await conn.execute(
        "UPDATE quotations SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
        quotation_id,
    )
    return {"data": {"id": quotation_id, "soft_deleted": True}, "message": "Đã xóa báo giá (có thể khôi phục)."}


# ─── OneDrive Integration (M-quotation P2) ───────────────────

@router.post("/history/{quotation_id}/sync-onedrive")
async def sync_quotation_onedrive(
    quotation_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Re-upload quotation files to OneDrive (manual sync).

    Useful when the auto-sync during generation failed (OneDrive auth down,
    network issue, etc.). Reuses the existing local files at output_pdf's
    parent directory.
    """
    row = await conn.fetchrow(
        """
        SELECT id, rfq_no, output_pdf, output_xlsx, created_at, deleted_at
        FROM quotations WHERE id = $1
        """,
        quotation_id,
    )
    if not row:
        raise HTTPException(404, "Báo giá không tồn tại")
    if row["deleted_at"]:
        raise HTTPException(409, "Báo giá đã bị xóa, không sync được.")
    if not row["output_pdf"] and not row["output_xlsx"]:
        raise HTTPException(400, "Báo giá chưa sinh file local nào để sync.")

    # Collect all generated files in the output dir
    import os
    out_dir = os.path.dirname(row["output_pdf"] or row["output_xlsx"])
    if not os.path.isdir(out_dir):
        raise HTTPException(404, f"Thư mục file local không tồn tại: {out_dir}")

    local_files: list[dict[str, str]] = []
    for fname in os.listdir(out_dir):
        full = os.path.join(out_dir, fname)
        if not os.path.isfile(full) or fname.startswith("~$"):
            continue
        ftype = "unknown"
        low = fname.lower()
        if "cam_ket" in low and low.endswith(".pdf"):
            ftype = "cam_ket_pdf"
        elif "cam_ket" in low and low.endswith((".xlsx", ".xlsm")):
            ftype = "cam_ket_xlsx"
        elif "quotation" in low and low.endswith(".pdf"):
            ftype = "quotation_pdf"
        elif "quotation" in low and low.endswith((".xlsx", ".xlsm")):
            ftype = "quotation_xlsx"
        elif low.endswith(".pdf"):
            ftype = "other_pdf"
        elif low.endswith((".xlsx", ".xlsm")):
            ftype = "other_xlsx"
        else:
            continue
        local_files.append({"type": ftype, "path": full})

    if not local_files:
        raise HTTPException(400, "Không tìm thấy file Excel/PDF trong thư mục local.")

    from app.services.quotation_onedrive import sync_quotation_to_onedrive
    created_at = row["created_at"]
    od = await sync_quotation_to_onedrive(
        rfq_no=row["rfq_no"],
        local_files=local_files,
        year=created_at.year,
        month=created_at.month,
        create_share_links=True,
    )

    if od.get("errors") and not od.get("primary_url"):
        await conn.execute(
            "UPDATE quotations SET onedrive_sync_error = $1, updated_at = NOW() WHERE id = $2",
            "; ".join(od["errors"])[:500],
            quotation_id,
        )
        raise HTTPException(502, {
            "error": "ONEDRIVE_SYNC_FAILED",
            "details": od["errors"],
        })

    await conn.execute(
        """
        UPDATE quotations
        SET onedrive_folder_id  = $1,
            onedrive_url        = $2,
            onedrive_share_url  = $3,
            onedrive_synced_at  = NOW(),
            onedrive_sync_error = NULL,
            updated_at          = NOW()
        WHERE id = $4
        """,
        od.get("folder_id"),
        od.get("primary_url"),
        od.get("primary_share"),
        quotation_id,
    )

    return {
        "data": {
            "quotation_id": quotation_id,
            "folder_path": od.get("folder_path"),
            "folder_id": od.get("folder_id"),
            "primary_url": od.get("primary_url"),
            "primary_share": od.get("primary_share"),
            "items": od.get("items", []),
            "errors": od.get("errors", []),
        },
        "message": "Đã đồng bộ báo giá lên OneDrive.",
    }


@router.get("/history/{quotation_id}/onedrive-link")
async def get_quotation_onedrive_link(
    quotation_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Return cached OneDrive web URL + share URL for a quotation.

    Frontend uses `web_url` to open Office Online in a new tab; `share_url`
    can be copied + sent to the customer.
    """
    row = await conn.fetchrow(
        """
        SELECT id, onedrive_url, onedrive_share_url, onedrive_folder_id,
               onedrive_synced_at, onedrive_sync_error
        FROM quotations WHERE id = $1 AND deleted_at IS NULL
        """,
        quotation_id,
    )
    if not row:
        raise HTTPException(404, "Báo giá không tồn tại")

    return {
        "data": {
            "web_url": row["onedrive_url"],
            "share_url": row["onedrive_share_url"],
            "folder_id": row["onedrive_folder_id"],
            "synced_at": row["onedrive_synced_at"].isoformat() if row["onedrive_synced_at"] else None,
            "sync_error": row["onedrive_sync_error"],
            "is_synced": bool(row["onedrive_url"]),
        }
    }


@router.post("/history/{quotation_id}/share")
async def create_quotation_share_link(
    quotation_id: int,
    scope: str = Query("anonymous", description="anonymous | organization"),
    link_type: str = Query("view", description="view | edit"),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Create / replace the M365 share link for the QUOTATION PDF.

    Per Thang 2026-05-07: scope='anonymous' (anyone with link) is allowed.
    """
    if scope not in ("anonymous", "organization"):
        raise HTTPException(400, "scope phải là 'anonymous' hoặc 'organization'")
    if link_type not in ("view", "edit"):
        raise HTTPException(400, "link_type phải là 'view' hoặc 'edit'")

    row = await conn.fetchrow(
        """
        SELECT q.id, q.onedrive_folder_id, q.deleted_at
        FROM quotations q
        WHERE q.id = $1
        """,
        quotation_id,
    )
    if not row:
        raise HTTPException(404, "Báo giá không tồn tại")
    if row["deleted_at"]:
        raise HTTPException(409, "Báo giá đã bị xóa.")

    # We share the QUOTATION PDF preferentially; need its item id.
    # Caller should sync first if folder_id is empty.
    folder_id = row["onedrive_folder_id"]
    if not folder_id:
        raise HTTPException(409, "Báo giá chưa sync OneDrive. Hãy gọi /sync-onedrive trước.")

    # Look up the QUOTATION PDF item id by walking folder children.
    from app.etl.onedrive_client import OneDriveClient
    from app.services.quotation_onedrive import get_or_create_share_link
    target_item_id: str | None = None
    try:
        async with OneDriveClient() as client:
            inner = client._ensure_client()  # noqa: SLF001
            headers = await client._auth_headers()  # noqa: SLF001
            resp = await inner.get(
                f"{client.GRAPH_URL}/drives/{client._drive_id}/items/{folder_id}/children",  # noqa: SLF001
                headers=headers,
            )
            resp.raise_for_status()
            children = resp.json().get("value", [])
            # Prefer QUOTATION PDF, then any PDF, then any xlsx
            for ch in children:
                n = ch.get("name", "").lower()
                if n.endswith(".pdf") and "quotation" in n:
                    target_item_id = ch.get("id"); break
            if not target_item_id:
                for ch in children:
                    if ch.get("name", "").lower().endswith(".pdf"):
                        target_item_id = ch.get("id"); break
            if not target_item_id and children:
                target_item_id = children[0].get("id")
    except Exception as exc:
        raise HTTPException(502, f"Không lấy được danh sách file OneDrive: {exc}")

    if not target_item_id:
        raise HTTPException(404, "Không có file nào trong folder OneDrive để share.")

    url, err = await get_or_create_share_link(target_item_id, scope=scope, link_type=link_type)
    if not url:
        raise HTTPException(502, f"Tạo share link thất bại: {err}")

    # Persist if scope=anonymous + view (the common case)
    if scope == "anonymous" and link_type == "view":
        await conn.execute(
            "UPDATE quotations SET onedrive_share_url = $1, updated_at = NOW() WHERE id = $2",
            url, quotation_id,
        )

    return {
        "data": {
            "quotation_id": quotation_id,
            "share_url": url,
            "scope": scope,
            "link_type": link_type,
        },
        "message": "Đã tạo share link.",
    }


@router.post("/history/{quotation_id}/restore")
async def restore_quotation(
    quotation_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Restore a soft-deleted quotation (admin/manager)."""
    row = await conn.fetchrow(
        "SELECT id, deleted_at FROM quotations WHERE id = $1", quotation_id
    )
    if not row:
        raise HTTPException(404, "Báo giá không tồn tại")
    if not row["deleted_at"]:
        return {"data": {"id": quotation_id, "restored": False}, "message": "Báo giá chưa bị xóa."}
    await conn.execute(
        "UPDATE quotations SET deleted_at = NULL, updated_at = NOW() WHERE id = $1",
        quotation_id,
    )
    return {"data": {"id": quotation_id, "restored": True}, "message": "Đã khôi phục báo giá."}


# ─── Public File Sharing (for Google/MS Office Online Viewer) ──

import hashlib
import hmac
import time as _time

from app.core.config import settings


def _make_share_token(quotation_id: int, file_type: str, expires_in: int = 3600) -> str:
    """Create a short-lived HMAC token for public file access (1 hour default)."""
    exp = int(_time.time()) + expires_in
    msg = f"{quotation_id}:{file_type}:{exp}"
    sig = hmac.new(settings.JWT_SECRET_KEY.encode(), msg.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{exp}.{sig}"


def _verify_share_token(quotation_id: int, file_type: str, token: str) -> bool:
    """Verify a share token."""
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return False
        exp = int(parts[0])
        sig = parts[1]
        if _time.time() > exp:
            return False
        msg = f"{quotation_id}:{file_type}:{exp}"
        expected = hmac.new(settings.JWT_SECRET_KEY.encode(), msg.encode(), hashlib.sha256).hexdigest()[:16]
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


@router.get("/internal-file")
async def internal_file_serve(
    path: str = Query(...),
):
    """Internal endpoint for OnlyOffice to fetch files. Only accessible within docker network."""
    from fastapi.responses import FileResponse
    import os

    if not path.startswith("/data/files/"):
        raise HTTPException(403, "Invalid path")
    if not os.path.exists(path):
        raise HTTPException(404, "File not found")

    return FileResponse(path)


def _find_quotation_file(output_pdf: str | None, file_type: str) -> str | None:
    """Find the specific file in the quotation output directory."""
    import os
    if not output_pdf:
        return None
    out_dir = os.path.dirname(output_pdf)
    if not os.path.isdir(out_dir):
        return None

    # GC file types: gc_pdf_{bqms_code}, gc_xlsx
    if file_type.startswith("gc_pdf_"):
        code = file_type.replace("gc_pdf_", "")
        for fname in os.listdir(out_dir):
            if code in fname and fname.lower().endswith(".pdf"):
                return os.path.join(out_dir, fname)
        return None
    elif file_type == "gc_xlsx":
        for fname in os.listdir(out_dir):
            if fname.lower().endswith((".xlsx", ".xlsm")) and not fname.startswith("~$") and not fname.startswith("_temp_"):
                return os.path.join(out_dir, fname)
        return None

    # TM file types: cam_ket_pdf, cam_ket_xlsx, quotation_pdf, quotation_xlsx
    is_cam_ket = "cam_ket" in file_type
    is_pdf = "pdf" in file_type
    prefix = "cam_ket" if is_cam_ket else "quotation"
    ext = ".pdf" if is_pdf else ".xlsx"

    for fname in os.listdir(out_dir):
        if fname.lower().startswith(prefix) and fname.lower().endswith(ext):
            return os.path.join(out_dir, fname)
    return None


@router.get("/download/{quotation_id}/{file_type}")
async def download_quotation_file(
    quotation_id: int,
    file_type: str,
    token: str | None = Query(None, description="JWT token (for browser direct links)"),
    token_data: TokenData | None = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Download a generated quotation file. Supports token via header or query param."""
    from fastapi.responses import FileResponse

    row = await conn.fetchrow("SELECT output_pdf FROM quotations WHERE id = $1", quotation_id)
    if not row:
        raise HTTPException(404, "Bao gia khong ton tai")

    file_path = _find_quotation_file(row["output_pdf"], file_type)
    if not file_path:
        raise HTTPException(404, "File chua duoc tao")

    is_pdf = "pdf" in file_type
    is_cam_ket = "cam_ket" in file_type
    label = "CAM_KET" if is_cam_ket else "QUOTATION"
    ext = "pdf" if is_pdf else "xlsx"
    media = "application/pdf" if is_pdf else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    return FileResponse(file_path, media_type=media, filename=f"{label}_{quotation_id}.{ext}")


@router.get("/preview/{quotation_id}/{file_type}")
async def preview_quotation_pdf(
    quotation_id: int,
    file_type: str,
    token: str | None = Query(None, description="JWT token (for iframe/browser)"),
    token_data: TokenData | None = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Preview a generated quotation PDF inline in browser."""
    from fastapi.responses import FileResponse

    row = await conn.fetchrow("SELECT output_pdf FROM quotations WHERE id = $1", quotation_id)
    if not row:
        raise HTTPException(404, "Bao gia khong ton tai")

    file_path = _find_quotation_file(row["output_pdf"], file_type)
    if not file_path:
        raise HTTPException(404, "PDF chua duoc tao")

    return FileResponse(
        file_path,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )


@router.get("/share-link/{quotation_id}/{file_type}")
async def get_share_link(
    quotation_id: int,
    file_type: str,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Generate a temporary public share link for a quotation file (1 hour)."""
    row = await conn.fetchrow("SELECT output_pdf FROM quotations WHERE id = $1", quotation_id)
    if not row:
        raise HTTPException(404, "Bao gia khong ton tai")

    file_path = _find_quotation_file(row["output_pdf"], file_type)
    if not file_path:
        raise HTTPException(404, "File khong ton tai")

    share_token = _make_share_token(quotation_id, file_type)
    public_url = f"/api/v1/quotations/public/{quotation_id}/{file_type}?s={share_token}"

    return {"url": public_url, "expires_in": 3600}


@router.get("/public/{quotation_id}/{file_type}")
async def public_file_access(
    quotation_id: int,
    file_type: str,
    s: str = Query(..., description="Share token"),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Serve a quotation file publicly using a signed share token. No auth required."""
    from fastapi.responses import FileResponse

    if not _verify_share_token(quotation_id, file_type, s):
        raise HTTPException(403, "Link het han hoac khong hop le")

    row = await conn.fetchrow("SELECT output_pdf FROM quotations WHERE id = $1", quotation_id)
    if not row:
        raise HTTPException(404, "Bao gia khong ton tai")

    file_path = _find_quotation_file(row["output_pdf"], file_type)
    if not file_path:
        raise HTTPException(404, "File khong ton tai")

    is_pdf = "pdf" in file_type
    media = "application/pdf" if is_pdf else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    return FileResponse(
        file_path,
        media_type=media,
        headers={
            "Content-Disposition": "inline",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ─── GC (Gia Công) Endpoints ─────────────────────────────────

class GCDetectRequest(BaseModel):
    rfq_no: str
    year: int | None = None
    month: int | None = None


class GCScanRequest(BaseModel):
    rfq_no: str
    excel_path: str
    quote_level: int = 2
    price_overrides: dict[str, float] | None = None


class GCGenerateRequest(BaseModel):
    rfq_no: str
    quote_level: int = 2
    source_folder: str
    sheets: list[dict[str, Any]] = []


@router.post("/gc/detect-files")
async def gc_detect_files(
    body: GCDetectRequest,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
) -> dict:
    """Phát hiện file Excel GC trên OneDrive staging."""
    from app.services.tools.gc_autofill_service import detect_gc_files

    result = await detect_gc_files(body.rfq_no, body.year, body.month)
    if not result.get("rfq_folder"):
        raise HTTPException(404, f"Không tìm thấy folder RFQ '{body.rfq_no}' trên OneDrive")
    return {"data": result}


@router.post("/gc/scan-markers")
async def gc_scan_markers(
    body: GCScanRequest,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict:
    """Scan Excel sheets cho GC markers và match giá từ DB."""
    from app.services.tools.gc_autofill_service import scan_markers

    # Validate path
    if not body.excel_path.startswith("/data/onedrive-staging/"):
        raise HTTPException(400, "Đường dẫn phải nằm trong OneDrive staging")

    # Build price map from DB
    VALID_PRICE_COLS = {
        1: "quoted_price_bqms_v1", 2: "quoted_price_bqms_v2",
        3: "quoted_price_bqms_v3", 4: "quoted_price_bqms_v4",
    }
    price_map: dict[str, float] = {}
    try:
        price_col = VALID_PRICE_COLS.get(min(body.quote_level, 4), "quoted_price_bqms_v1")
        rows = await conn.fetch(
            f"""
            SELECT bqms_code, {price_col} as target_price,
                   quoted_price_bqms_v1, quoted_price_bqms_v2,
                   quoted_price_bqms_v3, quoted_price_bqms_v4
            FROM bqms_rfq
            WHERE rfq_number ILIKE $1 || '%'
              AND {price_col} IS NOT NULL
            ORDER BY created_at DESC
            """,
            body.rfq_no,
        )

        seen_codes: set[str] = set()
        for r in rows:
            code = (r["bqms_code"] or "").strip()
            if not code or code in seen_codes:
                continue
            seen_codes.add(code)

            target = r["target_price"]
            if target is not None:
                price_map[code] = float(target)
    except Exception as exc:
        raise HTTPException(500, f"Lỗi truy vấn giá: {exc}")

    # Apply user overrides
    if body.price_overrides:
        price_map.update(body.price_overrides)

    try:
        sheets = await scan_markers(body.excel_path, price_map)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))

    return {
        "data": {
            "sheets": sheets,
            "total_sheets": len(sheets),
            "ready_sheets": len([s for s in sheets if s["status"] == "ready"]),
            "price_map_size": len(price_map),
            "quote_level": body.quote_level,
        }
    }


@router.post("/gc/generate")
async def gc_generate(
    body: GCGenerateRequest,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict:
    """Clone folder, apply GC edits, convert to PDF."""
    from app.services.tools.gc_autofill_service import run_gc_autofill_job

    # Validate
    if not body.source_folder.startswith("/data/onedrive-staging/"):
        raise HTTPException(400, "Source folder phải nằm trong OneDrive staging")

    ready_sheets = [s for s in body.sheets if s.get("status") == "ready"]
    if not ready_sheets:
        raise HTTPException(400, "Không có sheet nào sẵn sàng để điền giá")

    # Create quotation record
    row = await conn.fetchrow(
        """
        INSERT INTO quotations
            (rfq_no, source_type, flow_type, quote_level, gc_source_folder,
             items, total_items, created_by, status)
        VALUES ($1, 'onedrive', 'gc', $2, $3, $4::jsonb, $5, $6::uuid, 'processing')
        RETURNING id, rfq_no, status, created_at
        """,
        body.rfq_no,
        body.quote_level,
        body.source_folder,
        json.dumps(body.sheets, default=str, ensure_ascii=False),
        len(ready_sheets),
        token_data.user_id,
    )

    result = await run_gc_autofill_job(
        conn=conn,
        quotation_id=row["id"],
        rfq_no=body.rfq_no,
        quote_level=body.quote_level,
        sheet_edits=ready_sheets,
        gc_source_folder=body.source_folder,
    )

    # Build download/preview URLs
    files_with_urls = []
    for f in result.get("files", []):
        f_info = {**f}
        if "pdf" in f.get("type", ""):
            f_info["preview_url"] = f"/api/v1/quotations/preview/{row['id']}/{f['type']}"
        f_info["download_url"] = f"/api/v1/quotations/download/{row['id']}/{f['type']}"
        files_with_urls.append(f_info)

    return {
        "data": {
            "id": row["id"],
            "rfq_no": body.rfq_no,
            "status": "completed" if result["success"] else "failed",
            "flow_type": "gc",
            "quote_level": body.quote_level,
            "files": files_with_urls,
            "cloned_folder": result.get("cloned_folder", ""),
            "total_sheets": result.get("total_sheets", 0),
            "edited_sheets": result.get("edited_sheets", 0),
            "edit_report": result.get("edit_report", []),
            "errors": result.get("errors", []),
        },
        "message": "Báo giá GC đã được tạo" if result["success"] else "Tạo báo giá GC thất bại",
    }
