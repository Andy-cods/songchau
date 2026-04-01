"""
Gotenberg PDF conversion service.

Converts XLSX → PDF via Gotenberg container's LibreOffice route.
"""

from __future__ import annotations

import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

GOTENBERG_URL = "http://gotenberg:3000"


async def convert_xlsx_to_pdf(xlsx_path: str, output_pdf_path: str) -> str:
    """Convert an Excel file to PDF via Gotenberg.

    Args:
        xlsx_path: Absolute path to the .xlsx file.
        output_pdf_path: Where to write the resulting PDF.

    Returns:
        The output_pdf_path on success.

    Raises:
        httpx.HTTPStatusError on Gotenberg failure.
    """
    async with httpx.AsyncClient(timeout=120.0) as client:
        with open(xlsx_path, "rb") as f:
            resp = await client.post(
                f"{GOTENBERG_URL}/forms/libreoffice/convert",
                files={"files": (Path(xlsx_path).name, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            )
        resp.raise_for_status()

        Path(output_pdf_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_pdf_path, "wb") as out:
            out.write(resp.content)

    logger.info("Converted %s → %s (%d bytes)", xlsx_path, output_pdf_path, len(resp.content))
    return output_pdf_path
