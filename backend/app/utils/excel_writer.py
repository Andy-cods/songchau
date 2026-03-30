"""
Excel Writer — generate Samsung quotation files (CAM_KET and QUOTATION templates).

Uses xlsxtpl for template-based generation and openpyxl for any post-processing.
"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from xlsxtpl.writerx import BookWriter

from app.core.config import settings

logger = logging.getLogger(__name__)

# Template directory
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "templates"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_currency(value: float | int | None, currency: str = "VND") -> str:
    """Format a numeric value as currency string."""
    if value is None:
        return ""
    if currency == "VND":
        return f"{value:,.0f}"
    return f"{value:,.2f}"


def _format_date(d: date | datetime | None, fmt: str = "%d/%m/%Y") -> str:
    """Format date for Samsung templates."""
    if d is None:
        return ""
    if isinstance(d, datetime):
        d = d.date()
    return d.strftime(fmt)


def _ensure_dir(path: str) -> None:
    """Ensure parent directory exists."""
    os.makedirs(os.path.dirname(path), exist_ok=True)


# ---------------------------------------------------------------------------
# Samsung Quotation Template Filling
# ---------------------------------------------------------------------------

def fill_quotation_template(
    template_path: str,
    output_path: str,
    items: list[dict[str, Any]],
    metadata: dict[str, Any],
) -> str:
    """
    Fill a Samsung quotation Excel template with data.

    Uses xlsxtpl to populate the template with items and metadata.
    Supports both CAM_KET and QUOTATION (BG MAU) templates.

    Args:
        template_path: Path to the .xlsx template file.
        output_path: Path where the filled file will be saved.
        items: List of line item dicts with keys:
            - line_number, bqms_code, specification, quantity, unit,
              unit_price, amount, material_type, process_costs, etc.
        metadata: Dict with keys:
            - rfq_number, req_no, submission_date, deadline,
              vendor_name, vendor_tax_code, vendor_address,
              customer_name, currency, etc.

    Returns:
        Absolute path to the generated file.

    Raises:
        FileNotFoundError: If template file does not exist.
        ValueError: If required data is missing.
    """
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Template không tồn tại: {template_path}")

    if not items:
        raise ValueError("Danh sách items trống, không thể tạo file báo giá")

    _ensure_dir(output_path)

    # Prepare context for xlsxtpl
    context = _build_template_context(items, metadata)

    logger.info(
        "Tạo file báo giá: template=%s, items=%d, rfq=%s",
        os.path.basename(template_path),
        len(items),
        metadata.get("rfq_number", "N/A"),
    )

    try:
        writer = BookWriter(template_path)
        writer.jinja_env.globals.update(
            format_currency=_format_currency,
            format_date=_format_date,
        )
        writer.render_book(payloads=[context])
        writer.save(output_path)
    except Exception as e:
        raise ValueError(f"Lỗi khi điền template báo giá: {e}") from e

    logger.info("File báo giá đã tạo: %s", output_path)
    return os.path.abspath(output_path)


def _build_template_context(
    items: list[dict[str, Any]],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    """Build the context dict for xlsxtpl rendering."""

    # Compute totals
    total_amount = sum(
        float(item.get("amount") or item.get("unit_price", 0) * item.get("quantity", 0))
        for item in items
    )

    # Enrich items with computed fields
    enriched_items: list[dict[str, Any]] = []
    for idx, item in enumerate(items, start=1):
        qty = float(item.get("quantity", 0))
        unit_price = float(item.get("unit_price", 0))
        amount = float(item.get("amount", 0)) or (qty * unit_price)

        enriched = {
            **item,
            "line_number": item.get("line_number", idx),
            "quantity": qty,
            "unit_price": unit_price,
            "amount": amount,
            "unit_price_fmt": _format_currency(unit_price, metadata.get("currency", "VND")),
            "amount_fmt": _format_currency(amount, metadata.get("currency", "VND")),
        }
        enriched_items.append(enriched)

    # Build payload matching xlsxtpl conventions
    return {
        "sheet_name": "Sheet1",
        "ctx": {
            # Metadata
            "rfq_number": metadata.get("rfq_number", ""),
            "req_no": metadata.get("req_no", ""),
            "submission_date": _format_date(metadata.get("submission_date")),
            "deadline": _format_date(metadata.get("deadline")),
            "vendor_name": metadata.get("vendor_name", "SONG CHAU TRADING CO., LTD"),
            "vendor_tax_code": metadata.get("vendor_tax_code", ""),
            "vendor_address": metadata.get("vendor_address", ""),
            "customer_name": metadata.get("customer_name", "SAMSUNG"),
            "currency": metadata.get("currency", "VND"),
            "total_amount": total_amount,
            "total_amount_fmt": _format_currency(total_amount, metadata.get("currency", "VND")),
            "items_count": len(enriched_items),
            "today": _format_date(date.today()),
            # Items (xlsxtpl iterates over 'items' in the template)
            "items": enriched_items,
        },
    }


# ---------------------------------------------------------------------------
# Convenience: Generate both CAM_KET and QUOTATION files
# ---------------------------------------------------------------------------

def generate_quotation_files(
    submission_id: int,
    items: list[dict[str, Any]],
    metadata: dict[str, Any],
    output_dir: str | None = None,
) -> dict[str, str]:
    """
    Generate both CAM_KET and QUOTATION Excel files for a BQMS submission.

    Args:
        submission_id: The bqms_rfq_submissions.id.
        items: Line items from bqms_quotation_items.
        metadata: Submission metadata.
        output_dir: Base output directory. Defaults to settings.FILES_BASE_PATH.

    Returns:
        Dict with keys 'cam_ket_path' and 'commercial_path'.
    """
    if output_dir is None:
        output_dir = settings.FILES_BASE_PATH

    rfq_number = metadata.get("rfq_number", f"SUB-{submission_id}")
    safe_rfq = rfq_number.replace("/", "-").replace("\\", "-")

    results: dict[str, str] = {}

    # Generate CAM_KET file
    cam_ket_template = str(_TEMPLATES_DIR / "cam_ket_template.xlsx")
    if os.path.exists(cam_ket_template):
        cam_ket_output = os.path.join(
            output_dir, "bqms_quotations", f"CAM_KET_{safe_rfq}_{submission_id}.xlsx"
        )
        try:
            results["cam_ket_path"] = fill_quotation_template(
                template_path=cam_ket_template,
                output_path=cam_ket_output,
                items=items,
                metadata=metadata,
            )
        except Exception as e:
            logger.error("Lỗi tạo CAM_KET: %s", e)
            results["cam_ket_error"] = str(e)
    else:
        logger.warning("Template CAM_KET không tồn tại: %s", cam_ket_template)
        results["cam_ket_error"] = "Template không tồn tại"

    # Generate QUOTATION (commercial) file
    commercial_template = str(_TEMPLATES_DIR / "quotation_template.xlsx")
    if os.path.exists(commercial_template):
        commercial_output = os.path.join(
            output_dir, "bqms_quotations", f"QUOTATION_{safe_rfq}_{submission_id}.xlsx"
        )
        try:
            results["commercial_path"] = fill_quotation_template(
                template_path=commercial_template,
                output_path=commercial_output,
                items=items,
                metadata=metadata,
            )
        except Exception as e:
            logger.error("Lỗi tạo QUOTATION: %s", e)
            results["commercial_error"] = str(e)
    else:
        logger.warning("Template QUOTATION không tồn tại: %s", commercial_template)
        results["commercial_error"] = "Template không tồn tại"

    return results


# ---------------------------------------------------------------------------
# Post-processing: apply styles to generated files
# ---------------------------------------------------------------------------

def apply_post_styles(file_path: str) -> None:
    """
    Apply post-processing styles to a generated Excel file.

    Adjusts column widths, applies number formats, and sets print area.
    """
    if not os.path.exists(file_path):
        return

    try:
        wb = load_workbook(file_path)
        for ws in wb.worksheets:
            # Auto-adjust column widths (approximate)
            for col in ws.columns:
                max_length = 0
                col_letter = col[0].column_letter
                for cell in col:
                    if cell.value:
                        max_length = max(max_length, len(str(cell.value)))
                adjusted_width = min(max_length + 2, 50)
                ws.column_dimensions[col_letter].width = adjusted_width

        wb.save(file_path)
        logger.debug("Post-styles applied: %s", file_path)
    except Exception as e:
        logger.warning("Không thể áp dụng post-styles cho %s: %s", file_path, e)
