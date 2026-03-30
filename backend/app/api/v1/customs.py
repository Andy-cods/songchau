"""Customs Declarations API — Quan ly to khai hai quan."""

from __future__ import annotations

from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CustomsItemRequest(BaseModel):
    line_number: int
    xnk_tracking_id: int | None = None
    product_id: int | None = None
    hs_code_id: int | None = None
    hs_code: str
    description: str
    country_origin: str | None = None
    quantity: float
    unit: str
    unit_price_usd: float | None = None
    amount_usd: float | None = None
    import_tax_rate: float | None = None
    import_tax: float | None = None
    vat_rate: float = 10
    vat_amount: float | None = None


class CustomsCreateRequest(BaseModel):
    declaration_number: str
    declaration_date: date
    declaration_type: str  # 'import' or 'export'
    customs_office: str | None = None
    importer_name: str
    importer_tax_code: str
    exporter_name: str | None = None
    country_origin: str | None = None
    port_of_loading: str | None = None
    port_of_discharge: str | None = None
    transport_mode: str | None = None
    bill_of_lading: str | None = None
    total_value_usd: float | None = None
    total_value_vnd: float | None = None
    import_tax: float = 0
    vat_amount: float = 0
    special_tax: float = 0
    total_tax: float = 0
    document_path: str | None = None
    notes: str | None = None
    items: list[CustomsItemRequest] = []


class CustomsStatusUpdate(BaseModel):
    status: str  # draft, submitted, green, yellow, red, cleared, cancelled


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_STATUSES = {"draft", "submitted", "green", "yellow", "red", "cleared", "cancelled"}

# Valid transitions: status -> set of allowed next statuses
STATUS_TRANSITIONS = {
    "draft": {"submitted", "cancelled"},
    "submitted": {"green", "yellow", "red", "cancelled"},
    "green": {"cleared"},
    "yellow": {"cleared", "red"},
    "red": {"cleared", "yellow"},
    "cleared": set(),
    "cancelled": set(),
}


async def _get_declaration(conn: asyncpg.Connection, decl_id: int) -> dict:
    row = await conn.fetchrow(
        "SELECT * FROM customs_declarations WHERE id = $1", decl_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tờ khai hải quan không tồn tại")
    return dict(row)


async def _get_declaration_items(conn: asyncpg.Connection, decl_id: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT cdi.*, p.product_name, p.bqms_code
        FROM customs_declaration_items cdi
        LEFT JOIN products p ON p.id = cdi.product_id
        WHERE cdi.declaration_id = $1
        ORDER BY cdi.line_number ASC
        """,
        decl_id,
    )
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_customs(
    declaration_type: str | None = Query(None, description="import hoặc export"),
    status: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    q: str | None = Query(None, description="Tìm theo số tờ khai, tên người nhập"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if declaration_type:
        conditions.append(f"cd.declaration_type = ${idx}")
        params.append(declaration_type)
        idx += 1
    if status:
        conditions.append(f"cd.status = ${idx}")
        params.append(status)
        idx += 1
    if date_from:
        conditions.append(f"cd.declaration_date >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"cd.declaration_date <= ${idx}")
        params.append(date_to)
        idx += 1
    if q:
        conditions.append(
            f"(cd.declaration_number ILIKE '%' || ${idx} || '%' "
            f"OR cd.importer_name ILIKE '%' || ${idx} || '%')"
        )
        params.append(q)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM customs_declarations cd WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT cd.*,
               (SELECT COUNT(*) FROM customs_declaration_items WHERE declaration_id = cd.id) AS item_count
        FROM customs_declarations cd
        WHERE {where}
        ORDER BY cd.declaration_date DESC, cd.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("", status_code=201)
async def create_customs(
    body: CustomsCreateRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    if body.declaration_type not in ("import", "export"):
        raise HTTPException(status_code=400, detail="Loại tờ khai phải là 'import' hoặc 'export'")

    # Check unique declaration number
    existing = await conn.fetchval(
        "SELECT id FROM customs_declarations WHERE declaration_number = $1",
        body.declaration_number,
    )
    if existing:
        raise HTTPException(status_code=409, detail="Số tờ khai đã tồn tại trong hệ thống")

    async with conn.transaction():
        decl = await conn.fetchrow(
            """
            INSERT INTO customs_declarations
                (declaration_number, declaration_date, declaration_type,
                 customs_office, importer_name, importer_tax_code,
                 exporter_name, country_origin, port_of_loading,
                 port_of_discharge, transport_mode, bill_of_lading,
                 total_value_usd, total_value_vnd,
                 import_tax, vat_amount, special_tax, total_tax,
                 status, document_path, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18,
                    'draft', $19, $20, $21::uuid)
            RETURNING *
            """,
            body.declaration_number,
            body.declaration_date,
            body.declaration_type,
            body.customs_office,
            body.importer_name,
            body.importer_tax_code,
            body.exporter_name,
            body.country_origin,
            body.port_of_loading,
            body.port_of_discharge,
            body.transport_mode,
            body.bill_of_lading,
            body.total_value_usd,
            body.total_value_vnd,
            body.import_tax,
            body.vat_amount,
            body.special_tax,
            body.total_tax,
            body.document_path,
            body.notes,
            token_data.user_id,
        )
        decl_id = decl["id"]

        for item in body.items:
            await conn.execute(
                """
                INSERT INTO customs_declaration_items
                    (declaration_id, line_number, xnk_tracking_id, product_id,
                     hs_code_id, hs_code, description, country_origin,
                     quantity, unit, unit_price_usd, amount_usd,
                     import_tax_rate, import_tax, vat_rate, vat_amount)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                        $9, $10, $11, $12, $13, $14, $15, $16)
                """,
                decl_id,
                item.line_number,
                item.xnk_tracking_id,
                item.product_id,
                item.hs_code_id,
                item.hs_code,
                item.description,
                item.country_origin,
                item.quantity,
                item.unit,
                item.unit_price_usd,
                item.amount_usd,
                item.import_tax_rate,
                item.import_tax,
                item.vat_rate,
                item.vat_amount,
            )

    result = dict(decl)
    result["items"] = [item.model_dump() for item in body.items]
    return {"data": result, "message": "Đã tạo tờ khai hải quan"}


@router.get("/{decl_id}")
async def get_customs(
    decl_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    decl = await _get_declaration(conn, decl_id)
    items = await _get_declaration_items(conn, decl_id)
    decl["items"] = items
    return {"data": decl}


@router.put("/{decl_id}/status")
async def update_customs_status(
    decl_id: int,
    body: CustomsStatusUpdate,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Update customs declaration status with transition validation."""
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Trạng thái không hợp lệ. Phải là một trong: {', '.join(sorted(VALID_STATUSES))}",
        )

    decl = await _get_declaration(conn, decl_id)
    current_status = decl["status"]

    allowed = STATUS_TRANSITIONS.get(current_status, set())
    if body.status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Không thể chuyển trạng thái từ '{current_status}' sang '{body.status}'. "
                   f"Trạng thái tiếp theo hợp lệ: {', '.join(sorted(allowed)) if allowed else 'không có'}",
        )

    cleared_at_clause = ", cleared_at = NOW()" if body.status == "cleared" else ""

    row = await conn.fetchrow(
        f"""
        UPDATE customs_declarations
        SET status = $1, updated_at = NOW(){cleared_at_clause}
        WHERE id = $2
        RETURNING *
        """,
        body.status,
        decl_id,
    )
    return {
        "data": dict(row),
        "message": f"Đã chuyển trạng thái tờ khai sang '{body.status}'",
    }
