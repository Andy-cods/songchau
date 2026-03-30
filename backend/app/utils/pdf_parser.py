"""
Samsung RFQ PDF Parser — extract structured items from Samsung quotation request PDFs.

Uses pdfplumber with tuned table detection settings for Samsung's specific PDF format.
"""

from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import pdfplumber

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class RFQItem:
    """A single line item extracted from a Samsung RFQ PDF."""

    bqms_code: str
    product_name: str
    specification: str = ""
    maker: str = ""
    quantity: int = 0
    unit: str = "EA"
    deadline: date | None = None

    # Optional fields that may be present in some Samsung PDF formats
    part_no: str = ""
    remark: str = ""
    line_number: int = 0


@dataclass
class RFQParseResult:
    """Full result from parsing a Samsung RFQ PDF."""

    rfq_number: str = ""
    req_no: str = ""
    vendor_code: str = ""
    submission_deadline: date | None = None
    items: list[RFQItem] = field(default_factory=list)
    page_count: int = 0
    raw_text: str = ""


# ---------------------------------------------------------------------------
# Header normalization
# ---------------------------------------------------------------------------

# Map Samsung PDF column headers to our field names (case-insensitive matching)
_HEADER_MAP: dict[str, str] = {
    "no": "line_number",
    "no.": "line_number",
    "seq": "line_number",
    "item code": "bqms_code",
    "item_code": "bqms_code",
    "bqms code": "bqms_code",
    "material code": "bqms_code",
    "code": "bqms_code",
    "description": "product_name",
    "item description": "product_name",
    "item name": "product_name",
    "material name": "product_name",
    "name": "product_name",
    "spec": "specification",
    "specification": "specification",
    "spec.": "specification",
    "maker": "maker",
    "manufacturer": "maker",
    "maker/brand": "maker",
    "qty": "quantity",
    "quantity": "quantity",
    "order qty": "quantity",
    "req qty": "quantity",
    "unit": "unit",
    "uom": "unit",
    "delivery date": "deadline",
    "delivery": "deadline",
    "req delivery": "deadline",
    "del. date": "deadline",
    "part no": "part_no",
    "part no.": "part_no",
    "remark": "remark",
    "remarks": "remark",
    "note": "remark",
}


def _normalize_header(raw: str) -> str | None:
    """Normalize a raw header string to a known field name."""
    if not raw:
        return None
    cleaned = raw.strip().lower().replace("\n", " ").replace("  ", " ")
    return _HEADER_MAP.get(cleaned)


# ---------------------------------------------------------------------------
# Date parsing
# ---------------------------------------------------------------------------

_DATE_PATTERNS = [
    (r"\d{4}-\d{2}-\d{2}", "%Y-%m-%d"),
    (r"\d{4}/\d{2}/\d{2}", "%Y/%m/%d"),
    (r"\d{2}/\d{2}/\d{4}", "%d/%m/%Y"),
    (r"\d{2}-\d{2}-\d{4}", "%d-%m-%Y"),
    (r"\d{8}", "%Y%m%d"),
]


def _parse_date(value: str | None) -> date | None:
    """Try to parse a date from various Samsung formats."""
    if not value or not value.strip():
        return None
    value = value.strip()
    for pattern, fmt in _DATE_PATTERNS:
        match = re.search(pattern, value)
        if match:
            try:
                return datetime.strptime(match.group(), fmt).date()
            except ValueError:
                continue
    return None


def _parse_int(value: str | None) -> int:
    """Parse integer from cell value, handling commas and decimals."""
    if not value or not value.strip():
        return 0
    cleaned = re.sub(r"[^\d.]", "", value.strip())
    if not cleaned:
        return 0
    try:
        return int(float(cleaned))
    except (ValueError, OverflowError):
        return 0


# ---------------------------------------------------------------------------
# Metadata extraction
# ---------------------------------------------------------------------------

_RFQ_NUMBER_RE = re.compile(r"(?:RFQ|REQ|QT)\s*(?:No\.?|Number)?[:\s]*([A-Z0-9-]+)", re.IGNORECASE)
_REQ_NO_RE = re.compile(r"REQ[_\s]?NO[:\s]*([A-Z0-9-]+)", re.IGNORECASE)
_VENDOR_CODE_RE = re.compile(r"Vendor\s*(?:Code)?[:\s]*([A-Z0-9-]+)", re.IGNORECASE)
_DEADLINE_RE = re.compile(
    r"(?:Submission|Reply)\s*(?:Dead\s*line|Date)[:\s]*(\d{4}[\-/]\d{2}[\-/]\d{2})",
    re.IGNORECASE,
)


def _extract_metadata(full_text: str) -> dict[str, Any]:
    """Extract RFQ metadata from the full text of the PDF."""
    meta: dict[str, Any] = {}

    m = _RFQ_NUMBER_RE.search(full_text)
    if m:
        meta["rfq_number"] = m.group(1).strip()

    m = _REQ_NO_RE.search(full_text)
    if m:
        meta["req_no"] = m.group(1).strip()

    m = _VENDOR_CODE_RE.search(full_text)
    if m:
        meta["vendor_code"] = m.group(1).strip()

    m = _DEADLINE_RE.search(full_text)
    if m:
        meta["submission_deadline"] = _parse_date(m.group(1))

    return meta


# ---------------------------------------------------------------------------
# Table extraction settings for Samsung PDFs
# ---------------------------------------------------------------------------

_TABLE_SETTINGS: dict[str, Any] = {
    "vertical_strategy": "lines",
    "horizontal_strategy": "lines",
    "snap_tolerance": 5,
    "snap_x_tolerance": 5,
    "snap_y_tolerance": 5,
    "join_tolerance": 3,
    "join_x_tolerance": 3,
    "join_y_tolerance": 3,
    "edge_min_length": 10,
    "min_words_vertical": 1,
    "min_words_horizontal": 1,
    "text_tolerance": 3,
    "text_x_tolerance": 3,
    "text_y_tolerance": 3,
}

# Fallback: if lines-based detection fails, try text-based
_TABLE_SETTINGS_FALLBACK: dict[str, Any] = {
    "vertical_strategy": "text",
    "horizontal_strategy": "text",
    "snap_tolerance": 5,
    "join_tolerance": 3,
    "min_words_vertical": 2,
    "min_words_horizontal": 1,
}


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------

def parse_samsung_rfq_pdf(pdf_bytes: bytes) -> RFQParseResult:
    """
    Parse a Samsung RFQ PDF and extract structured items.

    Args:
        pdf_bytes: Raw PDF content as bytes.

    Returns:
        RFQParseResult with extracted items and metadata.

    Raises:
        ValueError: If the PDF cannot be parsed or contains no valid data.
    """
    if not pdf_bytes:
        raise ValueError("Dữ liệu PDF trống")

    result = RFQParseResult()

    try:
        pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
    except Exception as e:
        raise ValueError(f"Không thể mở file PDF: {e}") from e

    result.page_count = len(pdf.pages)

    if result.page_count == 0:
        raise ValueError("File PDF không có trang nào")

    # Extract full text for metadata
    full_text_parts: list[str] = []
    all_tables: list[list[list[str | None]]] = []

    for page in pdf.pages:
        page_text = page.extract_text() or ""
        full_text_parts.append(page_text)

        # Try lines-based table extraction first
        tables = page.extract_tables(table_settings=_TABLE_SETTINGS)
        if not tables:
            tables = page.extract_tables(table_settings=_TABLE_SETTINGS_FALLBACK)
        all_tables.extend(tables)

    result.raw_text = "\n".join(full_text_parts)
    pdf.close()

    # Extract metadata from text
    meta = _extract_metadata(result.raw_text)
    result.rfq_number = meta.get("rfq_number", "")
    result.req_no = meta.get("req_no", "")
    result.vendor_code = meta.get("vendor_code", "")
    result.submission_deadline = meta.get("submission_deadline")

    # Process tables
    items: list[RFQItem] = []
    line_counter = 0

    for table in all_tables:
        if not table or len(table) < 2:
            continue

        # First row is header
        raw_headers = table[0]
        if not raw_headers:
            continue

        # Map headers to field names
        col_map: dict[int, str] = {}
        for col_idx, raw_header in enumerate(raw_headers):
            field_name = _normalize_header(raw_header or "")
            if field_name:
                col_map[col_idx] = field_name

        # Need at minimum a bqms_code or product_name column to proceed
        mapped_fields = set(col_map.values())
        if not (mapped_fields & {"bqms_code", "product_name"}):
            logger.debug("Bảng bị bỏ qua: không tìm thấy cột bqms_code hoặc product_name")
            continue

        # Process data rows
        for row in table[1:]:
            if not row or all(not cell or not str(cell).strip() for cell in row):
                continue

            row_data: dict[str, str] = {}
            for col_idx, field_name in col_map.items():
                if col_idx < len(row):
                    cell_value = row[col_idx]
                    row_data[field_name] = str(cell_value).strip() if cell_value else ""

            # Skip rows without essential data
            bqms_code = row_data.get("bqms_code", "").strip()
            product_name = row_data.get("product_name", "").strip()
            if not bqms_code and not product_name:
                continue

            line_counter += 1

            item = RFQItem(
                bqms_code=bqms_code,
                product_name=product_name,
                specification=row_data.get("specification", ""),
                maker=row_data.get("maker", ""),
                quantity=_parse_int(row_data.get("quantity")),
                unit=row_data.get("unit", "EA").upper() or "EA",
                deadline=_parse_date(row_data.get("deadline")),
                part_no=row_data.get("part_no", ""),
                remark=row_data.get("remark", ""),
                line_number=_parse_int(row_data.get("line_number")) or line_counter,
            )
            items.append(item)

    result.items = items

    if not items:
        logger.warning(
            "Không trích xuất được dòng nào từ PDF (pages=%d, tables=%d)",
            result.page_count,
            len(all_tables),
        )

    logger.info(
        "PDF parsed: rfq=%s, items=%d, pages=%d",
        result.rfq_number or "(unknown)",
        len(items),
        result.page_count,
    )

    return result
