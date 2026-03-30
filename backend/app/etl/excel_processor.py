"""
Excel Processor — process Excel files from OneDrive into database tables.

Handles header detection, Vietnamese header normalization, schema classification,
and data loading via asyncpg raw SQL.
"""

from __future__ import annotations

import io
import logging
import re
from datetime import date, datetime
from typing import Any

import asyncpg
from python_calamine import CalamineWorkbook

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Vietnamese header normalization map
# ---------------------------------------------------------------------------

HEADER_MAP: dict[str, str] = {
    # BQMS RFQ / Hoi Hang
    "stt": "line_number",
    "ma bqms": "bqms_code",
    "bqms code": "bqms_code",
    "item code": "bqms_code",
    "ma hang": "bqms_code",
    "ten hang": "product_name",
    "product name": "product_name",
    "item name": "product_name",
    "description": "product_name",
    "mo ta": "product_name",
    "quy cach": "specification",
    "spec": "specification",
    "specification": "specification",
    "nha san xuat": "maker",
    "maker": "maker",
    "manufacturer": "maker",
    "so luong": "quantity",
    "qty": "quantity",
    "quantity": "quantity",
    "sl": "quantity",
    "don vi": "unit",
    "unit": "unit",
    "dvt": "unit",
    "uom": "unit",
    "ngay hoi": "inquiry_date",
    "inquiry date": "inquiry_date",
    "ket qua": "result",
    "result": "result",
    "nguoi phu trach": "person_in_charge_name",
    "nhan vien": "person_in_charge_name",
    "pic": "person_in_charge_name",
    "ghi chu": "notes",
    "note": "notes",
    "notes": "notes",
    "remark": "notes",
    # Pricing
    "gia nhap rmb": "purchase_price_rmb",
    "gia nhap vnd": "purchase_price_vnd",
    "gia bao ama": "quoted_price_ama",
    "gia bao bqms v1": "quoted_price_bqms_v1",
    "gia bao bqms v2": "quoted_price_bqms_v2",
    "gia bao bqms v3": "quoted_price_bqms_v3",
    "gia bao bqms v4": "quoted_price_bqms_v4",
    "nha cung cap": "supplier_name",
    "ncc": "supplier_name",
    "supplier": "supplier_name",
    "bao cao": "report",
    "report": "report",
    "rfq number": "rfq_number",
    "rfq no": "rfq_number",
    "so rfq": "rfq_number",
    # PO / Samsung PO
    "ngay po": "po_date",
    "po date": "po_date",
    "p/o date": "po_date",
    "so po": "po_number",
    "po number": "po_number",
    "p/o no": "po_number",
    "po no": "po_number",
    "don gia": "unit_price",
    "unit price": "unit_price",
    "thanh tien": "amount",
    "amount": "amount",
    "buyer": "buyer_name",
    "company": "company",
    "plant": "plant",
    "shipping qty": "shipping_qty",
    "gr qty": "gr_qty",
    # Deliveries
    "shipping no": "shipping_no",
    "so qt": "quotation_no",
    "tinh trang": "delivery_status",
    "ngay giao hang": "delivery_date",
    "ngay giao": "delivery_date",
    "delivery date": "delivery_date",
    "sl giao thuc te": "actual_delivered_qty",
    "sev/t": "sev_type",
    "mail pur": "buyer_email",
    "ten nguoi nhan": "recipient_name",
    "kho nhan": "receiving_warehouse",
    "sdt pur": "buyer_phone",
    "thong tin giao hang": "delivery_info",
    "cach thuc giao hang": "delivery_method",
    "xuat xu": "country_origin",
    # Raw material PO
    "hang san": "in_stock",
    "sl con thieu": "remaining_qty",
    "sl da giao": "delivered_qty",
    "pending": "pending",
    # Material pricing
    "trong luong": "weight_kg",
    "chieu dai": "dimension_l",
    "chieu rong": "dimension_w",
    "chieu cao": "dimension_h",
    "loai": "material_type",
    "material type": "material_type",
}


# ---------------------------------------------------------------------------
# Schema classification — map normalized column sets to target tables
# ---------------------------------------------------------------------------

# Define column signatures for each target table
_TABLE_SIGNATURES: dict[str, set[str]] = {
    "bqms_rfq": {
        "rfq_number", "bqms_code", "inquiry_date",
    },
    "bqms_samsung_po": {
        "po_number", "po_date", "bqms_code", "order_qty",
    },
    "bqms_deliveries": {
        "po_number", "shipping_no", "delivery_status",
    },
    "bqms_orders": {
        "rfq_number", "bqms_code", "po_date",
    },
    "bqms_raw_material_po": {
        "po_number", "bqms_code", "remaining_qty",
    },
    "bqms_material_pricing": {
        "bqms_code", "weight_kg", "material_type",
    },
}


def classify_schema(columns: set[str]) -> str | None:
    """
    Determine which database table a set of normalized columns maps to.

    Returns the table name, or None if no match found.
    """
    best_table: str | None = None
    best_score = 0

    for table, signature in _TABLE_SIGNATURES.items():
        overlap = len(columns & signature)
        if overlap > best_score:
            best_score = overlap
            best_table = table

    # Require at least 2 matching columns
    if best_score < 2:
        return None

    return best_table


# ---------------------------------------------------------------------------
# Header detection
# ---------------------------------------------------------------------------

def _normalize_text(text: str) -> str:
    """Normalize Vietnamese text: lowercase, strip diacritics, remove extra whitespace."""
    if not text:
        return ""
    # Simple diacritic removal for common Vietnamese chars
    replacements = {
        "á": "a", "à": "a", "ả": "a", "ã": "a", "ạ": "a",
        "ắ": "a", "ằ": "a", "ẳ": "a", "ẵ": "a", "ặ": "a",
        "ấ": "a", "ầ": "a", "ẩ": "a", "ẫ": "a", "ậ": "a",
        "é": "e", "è": "e", "ẻ": "e", "ẽ": "e", "ẹ": "e",
        "ế": "e", "ề": "e", "ể": "e", "ễ": "e", "ệ": "e",
        "í": "i", "ì": "i", "ỉ": "i", "ĩ": "i", "ị": "i",
        "ó": "o", "ò": "o", "ỏ": "o", "õ": "o", "ọ": "o",
        "ố": "o", "ồ": "o", "ổ": "o", "ỗ": "o", "ộ": "o",
        "ớ": "o", "ờ": "o", "ở": "o", "ỡ": "o", "ợ": "o",
        "ú": "u", "ù": "u", "ủ": "u", "ũ": "u", "ụ": "u",
        "ứ": "u", "ừ": "u", "ử": "u", "ữ": "u", "ự": "u",
        "ý": "y", "ỳ": "y", "ỷ": "y", "ỹ": "y", "ỵ": "y",
        "đ": "d", "Đ": "d",
    }
    result = text.strip().lower()
    for src, dst in replacements.items():
        result = result.replace(src, dst)
    # Collapse multiple spaces
    result = re.sub(r"\s+", " ", result).strip()
    return result


def detect_header_row(
    rows: list[list[Any]],
    max_scan: int = 15,
) -> tuple[int, dict[int, str]]:
    """
    Detect which row in a sheet is the header row.

    Scans the first `max_scan` rows and picks the row with the most
    recognized header matches.

    Returns:
        Tuple of (header_row_index, column_map) where column_map is
        {col_index: normalized_field_name}.
    """
    best_row_idx = -1
    best_col_map: dict[int, str] = {}
    best_match_count = 0

    for row_idx, row in enumerate(rows[:max_scan]):
        col_map: dict[int, str] = {}

        for col_idx, cell in enumerate(row):
            if cell is None:
                continue
            normalized = _normalize_text(str(cell))
            if normalized in HEADER_MAP:
                field_name = HEADER_MAP[normalized]
                col_map[col_idx] = field_name

        if len(col_map) > best_match_count:
            best_match_count = len(col_map)
            best_row_idx = row_idx
            best_col_map = col_map

    return best_row_idx, best_col_map


# ---------------------------------------------------------------------------
# Value parsing
# ---------------------------------------------------------------------------

def _parse_cell_value(value: Any, field_name: str) -> Any:
    """Parse a cell value based on the target field type."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None

    # Date fields
    date_fields = {
        "inquiry_date", "po_date", "delivery_date",
        "preferred_delivery_date", "deadline",
    }
    if field_name in date_fields:
        return _parse_date_value(value)

    # Numeric fields
    numeric_fields = {
        "quantity", "order_qty", "unit_price", "amount",
        "purchase_price_rmb", "purchase_price_vnd",
        "quoted_price_ama", "quoted_price_bqms_v1",
        "quoted_price_bqms_v2", "quoted_price_bqms_v3",
        "quoted_price_bqms_v4", "shipping_qty", "gr_qty",
        "actual_delivered_qty", "remaining_qty", "delivered_qty",
        "weight_kg", "dimension_l", "dimension_w", "dimension_h",
        "total_delivered_value_vnd",
    }
    if field_name in numeric_fields:
        return _parse_numeric_value(value)

    # Boolean fields
    bool_fields = {"in_stock", "pending", "close_po"}
    if field_name in bool_fields:
        return _parse_bool_value(value)

    # Integer fields
    int_fields = {"line_number", "po_qty"}
    if field_name in int_fields:
        return _parse_int_value(value)

    # String fields: strip and return
    return str(value).strip()


def _parse_date_value(value: Any) -> date | None:
    """Parse date from various Excel formats."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        # Excel serial date
        try:
            from datetime import timedelta
            base = date(1899, 12, 30)
            return base + timedelta(days=int(value))
        except (ValueError, OverflowError):
            return None

    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_numeric_value(value: Any) -> float | None:
    """Parse numeric from string/number, handling Vietnamese formatting."""
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(",", "").replace(" ", "")
    if not s or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_int_value(value: Any) -> int | None:
    """Parse integer value."""
    n = _parse_numeric_value(value)
    if n is None:
        return None
    return int(n)


def _parse_bool_value(value: Any) -> bool:
    """Parse boolean from various representations."""
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    return s in ("true", "1", "yes", "y", "x", "co", "có")


# ---------------------------------------------------------------------------
# Table-specific INSERT helpers
# ---------------------------------------------------------------------------

_INSERT_TEMPLATES: dict[str, str] = {
    "bqms_rfq": """
        INSERT INTO bqms_rfq (
            rfq_number, bqms_code, specification, maker,
            inquiry_date, person_in_charge_name, expected_qty, unit,
            purchase_price_rmb, purchase_price_vnd,
            quoted_price_ama, quoted_price_bqms_v1,
            quoted_price_bqms_v2, quoted_price_bqms_v3, quoted_price_bqms_v4,
            supplier_name, result, report, notes
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15,
            $16, COALESCE($17::rfq_result, 'pending'), $18, $19
        )
        ON CONFLICT (id) DO NOTHING
    """,
    "bqms_samsung_po": """
        INSERT INTO bqms_samsung_po (
            po_number, po_date, request_no, specification, maker,
            bqms_code, order_qty, unit_price, amount,
            buyer_name, buyer_email, company, plant,
            preferred_delivery_date, shipping_qty, gr_qty, remark
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16, $17
        )
        ON CONFLICT (po_number) DO NOTHING
    """,
    "bqms_deliveries": """
        INSERT INTO bqms_deliveries (
            po_number, po_date, shipping_no, quotation_no,
            bqms_code, specification, quantity, unit,
            unit_price, amount, sev_type, buyer_email,
            recipient_name, receiving_warehouse, buyer_phone,
            delivery_status, delivery_date, actual_delivered_qty,
            delivery_info, delivery_method, country_origin, notes
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15,
            COALESCE($16::delivery_status, 'chua_giao'), $17, $18,
            $19, $20, $21, $22
        )
    """,
    "bqms_raw_material_po": """
        INSERT INTO bqms_raw_material_po (
            po_date, po_number, bqms_code, specification,
            po_qty, unit, in_stock, remaining_qty,
            delivered_qty, pending, notes
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        )
    """,
    "bqms_material_pricing": """
        INSERT INTO bqms_material_pricing (
            rfq_number, bqms_code, specification,
            unit_price_vnd, weight_kg,
            dimension_l, dimension_w, dimension_h,
            material_type, notes
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
    """,
}

# Column ordering for each table (must match INSERT placeholder order)
_COLUMN_ORDER: dict[str, list[str]] = {
    "bqms_rfq": [
        "rfq_number", "bqms_code", "specification", "maker",
        "inquiry_date", "person_in_charge_name", "quantity", "unit",
        "purchase_price_rmb", "purchase_price_vnd",
        "quoted_price_ama", "quoted_price_bqms_v1",
        "quoted_price_bqms_v2", "quoted_price_bqms_v3", "quoted_price_bqms_v4",
        "supplier_name", "result", "report", "notes",
    ],
    "bqms_samsung_po": [
        "po_number", "po_date", "rfq_number", "specification", "maker",
        "bqms_code", "quantity", "unit_price", "amount",
        "buyer_name", "buyer_email", "company", "plant",
        "delivery_date", "shipping_qty", "gr_qty", "notes",
    ],
    "bqms_deliveries": [
        "po_number", "po_date", "shipping_no", "quotation_no",
        "bqms_code", "specification", "quantity", "unit",
        "unit_price", "amount", "sev_type", "buyer_email",
        "recipient_name", "receiving_warehouse", "buyer_phone",
        "delivery_status", "delivery_date", "actual_delivered_qty",
        "delivery_info", "delivery_method", "country_origin", "notes",
    ],
    "bqms_raw_material_po": [
        "po_date", "po_number", "bqms_code", "specification",
        "quantity", "unit", "in_stock", "remaining_qty",
        "delivered_qty", "pending", "notes",
    ],
    "bqms_material_pricing": [
        "rfq_number", "bqms_code", "specification",
        "unit_price", "weight_kg",
        "dimension_l", "dimension_w", "dimension_h",
        "material_type", "notes",
    ],
}


# ---------------------------------------------------------------------------
# Main processor
# ---------------------------------------------------------------------------

async def process_excel_file(
    conn: asyncpg.Connection,
    file_path_or_bytes: str | bytes,
    source_file: str,
) -> dict[str, Any]:
    """
    Process an Excel file with potentially multiple sheets.

    For each sheet:
    1. Detect the header row
    2. Normalize headers using HEADER_MAP
    3. Classify which DB table the sheet maps to
    4. Parse and load rows into the appropriate table

    Args:
        conn: asyncpg database connection.
        file_path_or_bytes: Path to the Excel file or raw bytes.
        source_file: Name of the source file (for logging/tracking).

    Returns:
        Summary dict with per-sheet results.
    """
    logger.info("Processing Excel file: %s", source_file)

    # Open workbook
    if isinstance(file_path_or_bytes, bytes):
        wb = CalamineWorkbook.from_filelike(io.BytesIO(file_path_or_bytes))
    else:
        wb = CalamineWorkbook.from_path(file_path_or_bytes)

    sheet_names = wb.sheet_names
    results: dict[str, Any] = {
        "source_file": source_file,
        "sheets_found": len(sheet_names),
        "sheets": {},
    }

    total_inserted = 0
    total_skipped = 0

    for sheet_name in sheet_names:
        logger.info("Processing sheet: %s / %s", source_file, sheet_name)

        sheet_data = wb.get_sheet_by_name(sheet_name)
        rows = sheet_data.to_python()

        if not rows or len(rows) < 2:
            results["sheets"][sheet_name] = {
                "status": "skipped",
                "reason": "Không đủ dữ liệu (< 2 dòng)",
            }
            continue

        # Detect header row
        header_row_idx, col_map = detect_header_row(rows)

        if header_row_idx < 0 or len(col_map) < 2:
            results["sheets"][sheet_name] = {
                "status": "skipped",
                "reason": f"Không nhận diện được header (matched={len(col_map)} cột)",
            }
            total_skipped += 1
            continue

        # Classify target table
        normalized_columns = set(col_map.values())
        target_table = classify_schema(normalized_columns)

        if not target_table:
            results["sheets"][sheet_name] = {
                "status": "skipped",
                "reason": f"Không xác định được bảng đích (columns={normalized_columns})",
            }
            total_skipped += 1
            continue

        if target_table not in _INSERT_TEMPLATES:
            results["sheets"][sheet_name] = {
                "status": "skipped",
                "reason": f"Bảng '{target_table}' chưa có INSERT template",
            }
            total_skipped += 1
            continue

        logger.info(
            "Sheet '%s' → table '%s' (header row=%d, columns=%d)",
            sheet_name, target_table, header_row_idx, len(col_map),
        )

        # Process data rows
        insert_sql = _INSERT_TEMPLATES[target_table]
        column_order = _COLUMN_ORDER[target_table]
        sheet_inserted = 0
        sheet_errors = 0

        data_rows = rows[header_row_idx + 1:]

        for row_idx, row in enumerate(data_rows):
            # Skip empty rows
            if not row or all(cell is None or str(cell).strip() == "" for cell in row):
                continue

            # Build row dict from column map
            row_dict: dict[str, Any] = {}
            for col_idx, field_name in col_map.items():
                if col_idx < len(row):
                    row_dict[field_name] = _parse_cell_value(row[col_idx], field_name)

            # Build parameter list in the required order
            params = []
            for col_name in column_order:
                params.append(row_dict.get(col_name))

            # Skip rows with no essential data
            if all(p is None for p in params[:3]):
                continue

            try:
                await conn.execute(insert_sql, *params)
                sheet_inserted += 1
            except asyncpg.UniqueViolationError:
                # Skip duplicates
                pass
            except Exception as e:
                sheet_errors += 1
                if sheet_errors <= 5:
                    logger.warning(
                        "Row %d error in %s/%s: %s",
                        row_idx + header_row_idx + 2,
                        source_file,
                        sheet_name,
                        e,
                    )

        total_inserted += sheet_inserted

        results["sheets"][sheet_name] = {
            "status": "success",
            "target_table": target_table,
            "rows_inserted": sheet_inserted,
            "rows_errors": sheet_errors,
            "header_row": header_row_idx + 1,
            "columns_mapped": len(col_map),
        }

    results["total_inserted"] = total_inserted
    results["total_skipped"] = total_skipped

    logger.info(
        "Excel processing complete: %s → %d inserted, %d sheets skipped",
        source_file, total_inserted, total_skipped,
    )

    return results
