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
