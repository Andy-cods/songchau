"""
PDF conversion service.

Primary: OnlyOffice Document Server (accurate Excel rendering).
Fallback: Gotenberg/LibreOffice.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

GOTENBERG_URL = "http://gotenberg:3000"
ONLYOFFICE_URL = "http://onlyoffice"


def _repair_xlsx_for_x2t(xlsx_path: str, template_path: str | None = None) -> str:
    """Repair openpyxl-saved xlsx for x2t compatibility.

    openpyxl rewrites drawing XML in a format x2t can't parse.
    Fix: replace drawing/media files with originals from template.
    """
    import zipfile
    import xml.etree.ElementTree as ET

    repaired = xlsx_path + ".repaired.xlsx"

    # Determine template path from the xlsx filename
    if template_path is None:
        fname = os.path.basename(xlsx_path).lower()
        if "cam_ket" in fname:
            template_path = "/data/files/templates/CAM_KET.xlsx"
        elif "quotation" in fname:
            template_path = "/data/files/templates/QUOTATION.xlsx"
        else:
            # GC files: look for .original backup created before openpyxl edits
            original = xlsx_path + ".original"
            if os.path.exists(original):
                template_path = original

    if not template_path or not os.path.exists(template_path):
        return xlsx_path  # Can't repair without template

    with zipfile.ZipFile(xlsx_path, 'r') as zin:
        with zipfile.ZipFile(template_path, 'r') as ztpl:
            with zipfile.ZipFile(repaired, 'w', zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)

                    # Skip calcChain (causes issues)
                    if 'calcChain' in item.filename:
                        continue

                    # Replace drawing/media files with template originals
                    if any(x in item.filename.lower() for x in ['drawing', 'media/']):
                        if item.filename in ztpl.namelist():
                            data = ztpl.read(item.filename)

                    # Clean Content_Types
                    if item.filename == '[Content_Types].xml':
                        root = ET.fromstring(data.decode('utf-8'))
                        for elem in list(root):
                            if 'calcChain' in elem.get('PartName', ''):
                                root.remove(elem)
                        data = ET.tostring(root, encoding='utf-8', xml_declaration=True)

                    zout.writestr(item, data)

    return repaired


async def _convert_via_onlyoffice(xlsx_path: str, output_pdf_path: str) -> str:
    """Convert XLSX to PDF via OnlyOffice x2t converter.

    Repairs openpyxl drawing XML, then converts via x2t inside OnlyOffice container.
    """
    import uuid
    import subprocess

    # Step 1: Repair xlsx for x2t compatibility
    repaired = _repair_xlsx_for_x2t(xlsx_path)

    job_id = uuid.uuid4().hex[:8]
    x2t_bin = "/var/www/onlyoffice/documentserver/server/FileConverter/bin/x2t"
    container_input = f"/tmp/x2t_{job_id}.xlsx"
    container_output = f"/tmp/x2t_{job_id}.pdf"
    container_params = f"/tmp/x2t_{job_id}.xml"

    try:
        # Step 2: Copy repaired file into OnlyOffice container
        subprocess.run(
            ["docker", "cp", repaired, f"sc-onlyoffice:{container_input}"],
            capture_output=True, timeout=30,
        )

        # Step 3: Write params XML
        params_script = (
            f"with open('{container_params}', 'w') as f: "
            f"f.write('<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            f"<TaskQueueDataConvert>"
            f"<m_sFileFrom>{container_input}</m_sFileFrom>"
            f"<m_sFileTo>{container_output}</m_sFileTo>"
            f"<m_nFormatTo>513</m_nFormatTo>"
            f"<m_bIsNoBase64>true</m_bIsNoBase64>"
            f"</TaskQueueDataConvert>')"
        )
        subprocess.run(
            ["docker", "exec", "sc-onlyoffice", "python3", "-c", params_script],
            capture_output=True, timeout=10,
        )

        # Step 4: Run x2t
        result = subprocess.run(
            ["docker", "exec", "sc-onlyoffice", x2t_bin, container_params],
            capture_output=True, timeout=120,
        )

        # Step 5: Copy PDF back
        Path(output_pdf_path).parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["docker", "cp", f"sc-onlyoffice:{container_output}", output_pdf_path],
            capture_output=True, timeout=30,
        )

        # Cleanup container files
        subprocess.run(
            ["docker", "exec", "sc-onlyoffice", "rm", "-f",
             container_input, container_output, container_params],
            capture_output=True, timeout=10,
        )

        if not os.path.exists(output_pdf_path) or os.path.getsize(output_pdf_path) == 0:
            err = result.stderr.decode()[:200] if result.stderr else "no output"
            raise RuntimeError(f"x2t failed (rc={result.returncode}): {err}")

        logger.info("OnlyOffice x2t converted %s -> %s (%d bytes)",
                     xlsx_path, output_pdf_path, os.path.getsize(output_pdf_path))
        return output_pdf_path

    finally:
        # Cleanup repaired temp file
        if repaired != xlsx_path:
            try:
                os.unlink(repaired)
            except OSError:
                pass


async def _convert_via_gotenberg(xlsx_path: str, output_pdf_path: str) -> str:
    """Convert XLSX to PDF via Gotenberg/LibreOffice (fallback)."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        with open(xlsx_path, "rb") as f:
            resp = await client.post(
                f"{GOTENBERG_URL}/forms/libreoffice/convert",
                files={"files": (Path(xlsx_path).name, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                # Thang 2026-05-20: send landscape=false so Gotenberg respects
                # the xlsx's own page_setup (which we now set to PORTRAIT in
                # gc_template_quotation.py + autofill_service.py). The explicit
                # data hint here is belt-and-braces for files whose embedded
                # page_setup is missing/ambiguous.
                data={"landscape": "false"},
            )
        resp.raise_for_status()

        Path(output_pdf_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_pdf_path, "wb") as out:
            out.write(resp.content)

    logger.info("Gotenberg converted %s -> %s (%d bytes)", xlsx_path, output_pdf_path, len(resp.content))
    return output_pdf_path


async def convert_html_to_pdf(html: str, output_pdf_path: str) -> str:
    """Convert an HTML string to PDF via Gotenberg's Chromium HTML route.

    Used for documents we render as HTML (e.g. procurement contracts) — distinct
    from convert_xlsx_to_pdf which goes through the LibreOffice route. Posts the
    HTML as `index.html` (the filename Gotenberg's Chromium route requires) and
    asks for A4 portrait. Mirrors the structure of _convert_via_gotenberg.

    Canonical engine per PLAN §8. Gotenberg is the sole PDF engine for báo
    giá now — there is no hand-built fallback (the AMA WeasyPrint mirror was
    removed); failures surface as a clear error to the caller.
    """
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{GOTENBERG_URL}/forms/chromium/convert/html",
            files={"index.html": ("index.html", html.encode("utf-8"), "text/html")},
            data={
                # A4 portrait in inches (Gotenberg/Chromium uses inches).
                "paperWidth": "8.27",
                "paperHeight": "11.7",
                "marginTop": "0.6",
                "marginBottom": "0.6",
                "marginLeft": "0.5",
                "marginRight": "0.5",
                "printBackground": "true",
            },
        )
        resp.raise_for_status()

        Path(output_pdf_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_pdf_path, "wb") as out:
            out.write(resp.content)

    logger.info("Gotenberg (chromium) rendered HTML -> %s (%d bytes)",
                output_pdf_path, len(resp.content))
    return output_pdf_path


async def convert_xlsx_to_pdf(xlsx_path: str, output_pdf_path: str) -> str:
    """Convert Excel to PDF.

    Per Thang 2026-05-11: switched to GOTENBERG ONLY. The OnlyOffice path
    was silently stripping product images because `_repair_xlsx_for_x2t`
    overwrites the entire `xl/media/` folder with the template's stamp+logo
    PNGs (originally needed because openpyxl-saved drawing XML couldn't be
    parsed by x2t — but it nukes our per-item product photos along the way).
    Gotenberg/LibreOffice handles openpyxl-saved xlsx natively and preserves
    all embedded images. Verified end-to-end: direct Gotenberg call on the
    same xlsx yielded 5 image objects in the resulting PDF (vs 1 via
    OnlyOffice).
    """
    Path(output_pdf_path).parent.mkdir(parents=True, exist_ok=True)
    return await _convert_via_gotenberg(xlsx_path, output_pdf_path)
