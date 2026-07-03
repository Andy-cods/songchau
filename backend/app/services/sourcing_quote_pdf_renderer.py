"""Báo giá PDF renderer cho Sourcing quote batches.

Strategy: quote_renderer.render_xlsx → gotenberg_service.convert_xlsx_to_pdf
---------------------------------------------------------------------------
The single faithful Song Châu báo-giá layout lives in
``quote_renderer.render_xlsx`` (template ``SOURCING_QUOTE.xlsx`` — logo,
signature stamp, accounting number formats, merges, totals block). This
module no longer re-implements its own xlsx filler; it simply maps the PDF
caller's ``quote_data`` onto ``quote_renderer.render_xlsx`` kwargs, writes a
temp xlsx, then converts it to PDF via Gotenberg/LibreOffice.

If Gotenberg is unreachable the renderer HARD-FAILS with a clear Vietnamese
error — there is NO hand-built fallback form (the old WeasyPrint "AMA BAC
NINH" mirror rendered the WRONG company identity and has been removed).

Public API
----------
* ``render_pdf(quote_data, items) -> bytes``
  Fill the Song Châu template via ``quote_renderer.render_xlsx``, run
  Gotenberg, return PDF bytes. Raises ``RuntimeError`` on Gotenberg failure.
"""
from __future__ import annotations

import logging
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Iterable

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────
# Public — PDF build (Song Châu template xlsx + Gotenberg)
# ─────────────────────────────────────────────────────────────────────
async def render_pdf(
    quote_data: dict,
    items: Iterable[dict],
) -> bytes:
    """Render báo giá PDF by filling the Song Châu xlsx template
    (``quote_renderer.render_xlsx``) then converting via Gotenberg.

    Returns raw PDF bytes. Caller decides whether to write to disk or
    stream to the HTTP response.

    Raises
    ------
    RuntimeError
        If Gotenberg/LibreOffice is unreachable or fails — NEVER falls
        back to a hand-built / alternate-identity form.
    """
    from app.services import gotenberg_service, quote_renderer

    items_list = list(items)

    # ── Map quote_data -> quote_renderer.render_xlsx kwargs ────────────
    quote_no = quote_data.get("quote_no") or "quote"
    customer_name = (
        quote_data.get("customer_company")
        or quote_data.get("customer_name")
        or ""
    )
    created_by = quote_data.get("created_by") or ""
    created_at = quote_data.get("quote_date") or datetime.now()

    # total_value = subtotal (qty * unit) — the renderer applies VAT on top
    # for the "bằng chữ" grand total.
    total_value = sum(
        float(it.get("quantity") or 0) * float(it.get("unit_price_vnd") or 0)
        for it in items_list
    )

    valid_days = quote_data.get("valid_days")
    validity = f"{valid_days} ngày" if valid_days else None

    tax_pct = quote_data.get("tax_pct")
    vat_rate = (tax_pct / 100.0) if tax_pct else None

    with tempfile.TemporaryDirectory(prefix="sc_quote_pdf_") as tmp:
        tmp_dir = Path(tmp)
        xlsx_path = tmp_dir / f"{quote_no}.xlsx"
        pdf_path = tmp_dir / f"{quote_no}.pdf"

        # ONE faithful xlsx filler — same path as file_format=xlsx.
        quote_renderer.render_xlsx(
            xlsx_path,
            quote_no=quote_no,
            customer_name=customer_name,
            quote_note=quote_data.get("quote_note") or "",
            line_items=items_list,
            total_value=total_value,
            created_by=created_by,
            created_at=created_at,
            customer_contact=quote_data.get("customer_contact"),
            customer_address=quote_data.get("customer_address"),
            customer_mst=quote_data.get("customer_mst"),
            quote_owner=created_by,
            validity=validity,
            vat_rate=vat_rate,
        )

        try:
            await gotenberg_service.convert_xlsx_to_pdf(
                str(xlsx_path), str(pdf_path)
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Gotenberg convert failed for quote %s: %s", quote_no, exc
            )
            raise RuntimeError(
                "Không tạo được PDF báo giá — Gotenberg/LibreOffice không "
                "phản hồi. Kiểm tra service http://gotenberg:3000."
            ) from exc

        return pdf_path.read_bytes()
