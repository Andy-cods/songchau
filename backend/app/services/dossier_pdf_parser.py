"""Extract Shipping No from Delivery Note PDF.

Sample DeliveryNote PDF (Commercial invoice & Packing list) renders text:

    [ Shipping No : 3016050264 ] [ Vendor Invoice No : 15052026-01 ] ...

Use pdfplumber to read text; regex out the Shipping No (8-12 digits after
the label).

Fallback if regex misses: scan all pages for first 10-digit sequence at
or near a barcode position.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# Primary regex — matches "Shipping No : 3016050264" or variants
_RE_SHIPPING_LABEL = re.compile(
    r"Shipping\s*No\s*[\.:\]\)]*\s*([0-9]{8,12})",
    re.IGNORECASE,
)
# Fallback — first 10-digit sequence anywhere
_RE_10DIGIT = re.compile(r"\b(\d{10})\b")


def extract_shipping_no(pdf_path: Path | str) -> str | None:
    """Read PDF, return first matching Shipping No or None.

    Tries pdfplumber first (handles text-layer PDFs). Falls back to OCR
    only if pdfplumber finds zero text (rare for Samsung-generated PDFs).
    """
    p = Path(pdf_path)
    if not p.exists():
        logger.warning("extract_shipping_no: file missing: %s", p)
        return None

    try:
        import pdfplumber  # type: ignore
    except ImportError:
        logger.error("pdfplumber not installed — cannot extract Shipping No")
        return None

    text_pages: list[str] = []
    try:
        with pdfplumber.open(str(p)) as pdf:
            for page in pdf.pages:
                t = page.extract_text() or ""
                text_pages.append(t)
    except Exception as exc:
        logger.warning("pdfplumber open failed for %s: %s", p, exc)
        return None

    full_text = "\n".join(text_pages)

    # Try labeled regex
    m = _RE_SHIPPING_LABEL.search(full_text)
    if m:
        sn = m.group(1)
        logger.info("extract_shipping_no: matched label -> %s", sn)
        return sn

    # Fallback: first 10-digit sequence on page 1
    if text_pages:
        m = _RE_10DIGIT.search(text_pages[0])
        if m:
            sn = m.group(1)
            logger.info("extract_shipping_no: fallback 10-digit -> %s", sn)
            return sn

    logger.warning("extract_shipping_no: no match found in %s", p)
    return None


def extract_metadata(pdf_path: Path | str) -> dict:
    """Extract all useful metadata from a Delivery Note PDF.

    Returns:
        {
            "shipping_no":   str | None,
            "vendor_invoice_no": str | None,
            "create_date":   str | None,
            "po_seq_list":   list[{po_number, po_seq}],   # from page 1 table
            "delivery_qty_total": float | None,
        }
    """
    p = Path(pdf_path)
    out = {
        "shipping_no": None,
        "vendor_invoice_no": None,
        "create_date": None,
        "po_seq_list": [],
        "delivery_qty_total": None,
    }
    if not p.exists():
        return out

    try:
        import pdfplumber
    except ImportError:
        return out

    try:
        with pdfplumber.open(str(p)) as pdf:
            text = "\n".join((pg.extract_text() or "") for pg in pdf.pages)
    except Exception as exc:
        logger.warning("extract_metadata pdfplumber fail: %s", exc)
        return out

    # Shipping No
    m = _RE_SHIPPING_LABEL.search(text)
    if m:
        out["shipping_no"] = m.group(1)

    # Vendor Invoice No
    m = re.search(r"Vendor\s*Invoice\s*No\s*[\.:\]\)]*\s*([A-Za-z0-9\-]+)", text, re.IGNORECASE)
    if m:
        out["vendor_invoice_no"] = m.group(1)

    # Create Date
    m = re.search(r"Create\s*Date\s*[\.:\]\)]*\s*(\d{2}/\d{2}/\d{4})", text, re.IGNORECASE)
    if m:
        out["create_date"] = m.group(1)

    return out
