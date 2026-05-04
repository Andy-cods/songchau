"""
Auto-Fill Quotation Service (M01).

Ported from tool1_autofill/engine.py — core business logic only.
Replaces: SQLite → asyncpg, LibreOffice → Gotenberg, filesystem → /data/files.

Core workflow:
  1. parse_bc_bqms()  — Parse uploaded BC BQMS Excel → list of order items
  2. classify_loai_hang() — Classify items as GC/TM
  3. lookup_prices()   — Match prices from bqms_rfq history
  4. fill_cam_ket()    — Fill CAM KET template Excel
  5. fill_quotation()  — Fill Commercial Quotation template Excel
  6. convert to PDF    — Via Gotenberg container
"""

from __future__ import annotations

import io
import logging
import re
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import openpyxl
from openpyxl.drawing.image import Image as XLImage
from openpyxl.utils import column_index_from_string, get_column_letter

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────
FILES_BASE = Path("/data/files/quotations")

COL_KEYWORDS: dict[str, list[str]] = {
    "don_hang":   ["đơn hàng", "don hang", "rfq"],
    "bqms":       ["bqms"],
    "spec":       ["tên hàng", "ten hang", "spec"],
    "short_name": ["explain", "tên ngắn", "ten ngan"],
    "loai_hang":  ["loại hàng", "loai hang"],
    "maker":      ["maker"],
    "mark":       ["mark"],
    "don_vi":     ["đơn vị", "don vi", "unit"],
    "so_luong":   ["số lượng", "so luong", "qty", "quantity"],
    "han_bg":     ["hạn bg", "han bg", "deadline", "hạn"],
    "ghi_chu":    ["ghi chú", "ghi chu", "note"],
}


# ─── Utility Functions ────────────────────────────────────────

def clean_cell(val: Any) -> str:
    """Strip non-breaking spaces and whitespace."""
    if val is None:
        return ""
    return str(val).replace("\xa0", " ").strip()


def fuzzy_match_col(header_str: str, keywords: list[str]) -> bool:
    """Check if header string matches any keyword (case-insensitive substring)."""
    h = header_str.lower().replace("\xa0", " ").strip()
    return any(kw.lower() in h for kw in keywords)


def classify_loai_hang(val: str) -> str:
    """Classify product type: 'gc' (gia công), 'tm' (thương mại), or 'unknown'."""
    if not val:
        return "unknown"
    lh = val.lower().replace("\xa0", " ").strip()
    if any(x in lh for x in ("gia công", "gia cong", "gc")):
        return "gc"
    if any(x in lh for x in ("thương mại", "thuong mai", "tm")):
        return "tm"
    abbr = lh[:2]
    if abbr == "gc":
        return "gc"
    if abbr == "tm":
        return "tm"
    return "unknown"


def _parse_deadline(raw: str) -> datetime | None:
    """Parse Vietnamese deadline strings like '2/4 17h' → datetime."""
    if not raw:
        return None
    raw = clean_cell(raw)
    # Pattern: d/m HHh or d/m
    m = re.match(r"(\d{1,2})/(\d{1,2})\s*(\d{1,2})?h?", raw)
    if m:
        day, month = int(m.group(1)), int(m.group(2))
        hour = int(m.group(3)) if m.group(3) else 17
        year = datetime.now().year
        try:
            return datetime(year, month, day, hour)
        except ValueError:
            return None
    return None


def _is_deadline_urgent(dt: datetime | None) -> bool:
    """Check if deadline is within 48 hours."""
    if not dt:
        return False
    return dt - datetime.now() < timedelta(hours=48)


# ─── BC BQMS Excel Parsing ───────────────────────────────────

def parse_bc_bqms(file_bytes: bytes) -> list[dict[str, Any]]:
    """Parse a BC BQMS Excel file into a list of order items.

    Args:
        file_bytes: Raw bytes of the uploaded Excel file.

    Returns:
        List of order dicts with keys: id, don_hang, bqms, spec, short_name,
        loai_hang, maker, mark, don_vi, so_luong, han_bg, deadline_dt,
        is_urgent, ghi_chu.
    """
    import python_calamine
    from python_calamine import CalamineWorkbook

    wb = CalamineWorkbook.from_buffer(file_bytes)
    sheet_names = wb.sheet_names

    # Find best sheet + header row via scoring
    best_sheet, best_header = sheet_names[0], 0
    best_score = 0

    for name in sheet_names:
        rows = wb.get_sheet_by_name(name).to_python()
        for i, row in enumerate(rows[:15]):
            row_text = " ".join(str(v) for v in row if v is not None).lower()
            score = (
                (2 if "đơn hàng" in row_text or "don hang" in row_text else 0)
                + (2 if "bqms" in row_text else 0)
                + (1 if "maker" in row_text else 0)
                + (1 if "loại hàng" in row_text or "loai hang" in row_text else 0)
            )
            if score > best_score:
                best_score, best_sheet, best_header = score, name, i

    # Read data rows
    all_rows = wb.get_sheet_by_name(best_sheet).to_python()
    if not all_rows or best_header >= len(all_rows):
        return []

    headers = [clean_cell(h) for h in all_rows[best_header]]

    # Map columns
    col_map: dict[str, int] = {}
    for col_idx, header in enumerate(headers):
        for field, keywords in COL_KEYWORDS.items():
            if field not in col_map and fuzzy_match_col(header, keywords):
                col_map[field] = col_idx

    def get_field(row: list, field: str) -> str:
        idx = col_map.get(field)
        if idx is None or idx >= len(row):
            return ""
        return clean_cell(row[idx])

    orders: list[dict[str, Any]] = []
    for row in all_rows[best_header + 1:]:
        don_hang = get_field(row, "don_hang")
        bqms = get_field(row, "bqms")
        if not don_hang and not bqms:
            continue
        if don_hang.lower() in ("đơn hàng", "don hang", "nan", ""):
            if not bqms:
                continue

        loai_raw = get_field(row, "loai_hang")
        loai_norm = classify_loai_hang(loai_raw).upper()

        so_luong_raw = get_field(row, "so_luong")
        try:
            so_luong = int(float(so_luong_raw)) if so_luong_raw else 0
        except (ValueError, TypeError):
            so_luong = 0

        han_bg = get_field(row, "han_bg")
        deadline_dt = _parse_deadline(han_bg)

        orders.append({
            "id": f"{don_hang}_{bqms}",
            "don_hang": don_hang,
            "bqms": bqms,
            "spec": get_field(row, "spec"),
            "short_name": get_field(row, "short_name"),
            "loai_hang": loai_norm,
            "maker": get_field(row, "maker"),
            "mark": get_field(row, "mark"),
            "don_vi": get_field(row, "don_vi") or "EA",
            "so_luong": so_luong,
            "han_bg": han_bg,
            "deadline_dt": deadline_dt.isoformat() if deadline_dt else None,
            "is_urgent": _is_deadline_urgent(deadline_dt),
            "ghi_chu": get_field(row, "ghi_chu"),
        })

    logger.info("Parsed BC BQMS: %d items from sheet '%s'", len(orders), best_sheet)
    return orders


# ─── Price Lookup ─────────────────────────────────────────────

async def lookup_prices(conn, items: list[dict]) -> list[dict]:
    """Lookup latest prices from bqms_rfq for each item.

    Adds 'price_history' list and 'suggested_price' to each item dict.
    """
    for item in items:
        bqms_code = item.get("bqms", "")
        if not bqms_code:
            item["price_history"] = []
            item["suggested_price"] = None
            continue

        rows = await conn.fetch(
            """
            SELECT bqms_code, quoted_price_bqms_v1, quoted_price_bqms_v2,
                   quoted_price_bqms_v3, quoted_price_bqms_v4,
                   result, maker, specification, created_at
            FROM bqms_rfq
            WHERE bqms_code = $1
            ORDER BY created_at DESC
            LIMIT 10
            """,
            bqms_code,
        )

        history = []
        for r in rows:
            prices = [
                r["quoted_price_bqms_v1"],
                r["quoted_price_bqms_v2"],
                r["quoted_price_bqms_v3"],
                r["quoted_price_bqms_v4"],
            ]
            latest_price = next((p for p in reversed(prices) if p), None)
            history.append({
                "prices": [float(p) if p else None for p in prices],
                "result": r["result"],
                "latest_price": float(latest_price) if latest_price else None,
                "date": r["created_at"].isoformat() if r["created_at"] else None,
            })

        # Suggested price = latest winning price, or latest v1
        won_prices = [h["latest_price"] for h in history if h["result"] and "won" in str(h["result"]).lower() and h["latest_price"]]
        if won_prices:
            suggested = won_prices[0]
        elif history and history[0]["latest_price"]:
            suggested = history[0]["latest_price"]
        else:
            suggested = None

        item["price_history"] = history
        item["suggested_price"] = suggested

    return items


# ─── Image Matching ───────────────────────────────────────────

_RFQ_STAGING_ROOT = Path('/data/onedrive-staging/Puplic/BQMS/RFQ')
_IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.bmp'}


def discover_rfq_images(rfq_no: str) -> list[tuple[str, bytes]]:
    """Find images on disk for a given RFQ.

    Walks /data/onedrive-staging/Puplic/BQMS/RFQ/RFQ {year}/THANG */{rfq_no}*/
    and returns (filename, bytes) for every PNG/JPG. Filenames typically follow
    the BQMS code (e.g. Z0000002-508700.png), which match_images_to_orders
    can then match by substring.

    Returns empty list if no folder found -- silent fallback so the rest of
    the pipeline still runs.
    """
    if not rfq_no or rfq_no == 'UNKNOWN' or not _RFQ_STAGING_ROOT.exists():
        return []

    out: list[tuple[str, bytes]] = []
    try:
        for year_dir in _RFQ_STAGING_ROOT.glob('RFQ */'):
            for month_dir in year_dir.glob('THANG */'):
                for rfq_dir in month_dir.glob(f'{rfq_no}*/'):
                    for img_path in rfq_dir.iterdir():
                        if img_path.is_file() and img_path.suffix.lower() in _IMAGE_EXTS:
                            try:
                                out.append((img_path.name, img_path.read_bytes()))
                            except OSError as exc:
                                logger.debug('discover_rfq_images: skip %s: %s', img_path, exc)
    except OSError as exc:
        logger.warning('discover_rfq_images: walk failed: %s', exc)

    if out:
        logger.info('discover_rfq_images: %s -> %d images', rfq_no, len(out))
    return out


def match_images_to_orders(
    uploaded_files: list[tuple[str, bytes]],
    orders: list[dict],
) -> dict[str, bytes]:
    """Match uploaded image files to BQMS codes by filename.

    Args:
        uploaded_files: List of (filename, file_bytes) tuples.
        orders: List of order dicts from parse_bc_bqms().

    Returns:
        Dict mapping bqms_code → image bytes.
    """
    images_map: dict[str, bytes] = {}
    bqms_codes = [o["bqms"] for o in orders if o.get("bqms")]

    for fname, img_bytes in uploaded_files:
        fname_clean = Path(fname).stem.strip()
        matched = None
        for code in bqms_codes:
            if code and (code in fname_clean or fname_clean in code):
                matched = code
                break
        if matched:
            images_map[matched] = img_bytes
            logger.info("Image '%s' matched to BQMS %s", fname, matched)

    return images_map


# ─── Excel Cell Helpers ───────────────────────────────────────

def _get_top_left_of_merged(ws, row: int, col: int) -> tuple[int, int]:
    """If (row, col) is in a merged range, return its top-left cell."""
    for mr in ws.merged_cells.ranges:
        if mr.min_row <= row <= mr.max_row and mr.min_col <= col <= mr.max_col:
            return mr.min_row, mr.min_col
    return row, col


def _safe_set_cell(ws, row: int, col: int, value: Any) -> None:
    """Set cell value, handling merged cells."""
    r, c = _get_top_left_of_merged(ws, row, col)
    ws.cell(row=r, column=c).value = value


def _copy_row_style(ws, src_row: int, dst_row: int, max_col: int = 20) -> None:
    """Copy font, fill, alignment, border, number_format from src to dst."""
    for c in range(1, max_col + 1):
        src = ws.cell(row=src_row, column=c)
        dst = ws.cell(row=dst_row, column=c)
        if src.has_style:
            dst.font = src.font.copy()
            dst.fill = src.fill.copy()
            dst.alignment = src.alignment.copy()
            dst.border = src.border.copy()
            dst.number_format = src.number_format


def _copy_merged_ranges_for_row(ws, src_row: int, dst_row: int) -> None:
    """Copy merged cell ranges from src_row to dst_row."""
    for mr in list(ws.merged_cells.ranges):
        if mr.min_row == src_row and mr.max_row == src_row:
            ws.merge_cells(
                start_row=dst_row, start_column=mr.min_col,
                end_row=dst_row, end_column=mr.max_col,
            )


def _pil_image_to_xl(img_bytes: bytes, max_w: int = 150, max_h: int = 150) -> XLImage | None:
    """Convert image bytes → openpyxl Image, resized with PIL."""
    try:
        from PIL import Image as PILImage

        pil_img = PILImage.open(io.BytesIO(img_bytes))
        if pil_img.mode not in ("RGB", "RGBA"):
            pil_img = pil_img.convert("RGBA")
        pil_img.thumbnail((max_w, max_h), PILImage.LANCZOS)
        w, h = pil_img.size
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        buf.seek(0)
        xl_img = XLImage(buf)
        xl_img.width = w
        xl_img.height = h
        return xl_img
    except Exception as exc:
        logger.warning("Image conversion error: %s", exc)
        return None


# ─── Fill CAM KET Template ───────────────────────────────────

def fill_cam_ket(
    template_path: str | None,
    products: list[dict],
    images_map: dict[str, bytes],
    output_path: str,
) -> bool:
    """Fill the CAM KET (commitment) Excel template.

    If template_path is None or not found, creates from scratch.
    Template layout:
      Row 16-18: Product 1 (3-row block)
      Row 19-21: Product 2 (3-row block)
      Row 22+:   Additional products (inserted rows)
      Column C: Index, D: BQMS, F: Spec, J: Maker, L: Unit Price, N: Image
    """
    from openpyxl.styles import Font, Alignment, Border, Side, PatternFill

    if template_path and Path(template_path).exists():
        wb = openpyxl.load_workbook(template_path)
        ws = wb.active

        SP_START = 16
        ROWS_PER_SP = 3
        COL_C, COL_D, COL_F, COL_J, COL_L, COL_N = 3, 4, 6, 10, 12, 14

        now = datetime.now()
        extra_rows = 0

        for i, product in enumerate(products):
            if i < 2:
                start_row = SP_START + i * ROWS_PER_SP
            else:
                insert_after = SP_START + 2 * ROWS_PER_SP + extra_rows - 1
                ws.insert_rows(insert_after + 1, ROWS_PER_SP)
                _copy_row_style(ws, SP_START + ROWS_PER_SP, insert_after + 1)
                start_row = insert_after + 1
                extra_rows += ROWS_PER_SP

            _safe_set_cell(ws, start_row, COL_C, i + 1)
            _safe_set_cell(ws, start_row, COL_D, product.get("bqms", ""))
            _safe_set_cell(ws, start_row, COL_F, product.get("spec", ""))
            _safe_set_cell(ws, start_row, COL_J, product.get("maker", ""))
            price = product.get("suggested_price") or product.get("unit_price")
            _safe_set_cell(ws, start_row, COL_L, price if price else "")
            bqms_code = product.get("bqms", "")
            if bqms_code in images_map:
                xl_img = _pil_image_to_xl(images_map[bqms_code])
                if xl_img:
                    ws.add_image(xl_img, f"{get_column_letter(COL_N)}{start_row}")

        date_row = 31 + extra_rows
        _safe_set_cell(ws, date_row, COL_L, f"Ngày {now.day} Tháng {now.month} năm {now.year}")
    else:
        # Create from scratch
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "CAM KET"

        now = datetime.now()
        thin_border = Border(
            left=Side(style='thin'), right=Side(style='thin'),
            top=Side(style='thin'), bottom=Side(style='thin')
        )
        header_font = Font(name='Arial', size=11, bold=True)
        data_font = Font(name='Arial', size=10)
        header_fill = PatternFill(start_color='4472C4', end_color='4472C4', fill_type='solid')
        header_font_white = Font(name='Arial', size=10, bold=True, color='FFFFFF')

        # Title
        ws.merge_cells('A1:H1')
        ws['A1'] = 'CAM KET BAO GIA - AMA BAC NINH JSC'
        ws['A1'].font = Font(name='Arial', size=14, bold=True)
        ws['A1'].alignment = Alignment(horizontal='center')

        ws.merge_cells('A2:H2')
        ws['A2'] = f'Ngay: {now.strftime("%d/%m/%Y")}'
        ws['A2'].font = data_font
        ws['A2'].alignment = Alignment(horizontal='center')

        # RFQ info
        rfq_no = products[0].get("don_hang", "N/A") if products else "N/A"
        ws['A4'] = 'RFQ No:'
        ws['A4'].font = Font(name='Arial', size=10, bold=True)
        ws['B4'] = rfq_no
        ws['B4'].font = data_font

        # Headers row 6
        headers = ['#', 'BQMS Code', 'Specification', 'Maker', 'Qty', 'Unit', 'Unit Price (VND)', 'Image']
        for col_idx, h in enumerate(headers, 1):
            cell = ws.cell(row=6, column=col_idx, value=h)
            cell.font = header_font_white
            cell.fill = header_fill
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='center', wrap_text=True)

        # Column widths
        ws.column_dimensions['A'].width = 5
        ws.column_dimensions['B'].width = 20
        ws.column_dimensions['C'].width = 40
        ws.column_dimensions['D'].width = 15
        ws.column_dimensions['E'].width = 10
        ws.column_dimensions['F'].width = 8
        ws.column_dimensions['G'].width = 18
        ws.column_dimensions['H'].width = 12

        # Data rows
        for i, product in enumerate(products):
            row = 7 + i
            price = product.get("suggested_price") or product.get("unit_price")
            data = [
                i + 1,
                product.get("bqms", ""),
                product.get("spec", ""),
                product.get("maker", ""),
                product.get("so_luong", 0),
                product.get("don_vi", "EA"),
                price if price else "",
                "",
            ]
            for col_idx, val in enumerate(data, 1):
                cell = ws.cell(row=row, column=col_idx, value=val)
                cell.font = data_font
                cell.border = thin_border
                if col_idx in (1, 5, 6):
                    cell.alignment = Alignment(horizontal='center')
                elif col_idx == 7:
                    cell.alignment = Alignment(horizontal='right')
                    cell.number_format = '#,##0'

            # Image
            bqms_code = product.get("bqms", "")
            if bqms_code in images_map:
                xl_img = _pil_image_to_xl(images_map[bqms_code])
                if xl_img:
                    ws.add_image(xl_img, f"H{row}")

        # Footer
        footer_row = 7 + len(products) + 2
        ws.merge_cells(f'A{footer_row}:H{footer_row}')
        ws[f'A{footer_row}'] = f'Ngày {now.day} Tháng {now.month} năm {now.year}'
        ws[f'A{footer_row}'].font = data_font
        ws[f'A{footer_row}'].alignment = Alignment(horizontal='right')

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)
    logger.info("CAM KET filled: %d products -> %s", len(products), output_path)
    return True


# ─── Fill Quotation Template ─────────────────────────────────

def fill_quotation(
    template_path: str | None,
    products: list[dict],
    images_map: dict[str, bytes],
    rfq_no: str,
    output_path: str,
) -> bool:
    """Fill the Commercial Quotation Excel template.

    If template_path is None or not found, creates from scratch.
    Columns: A=idx, B=RFQ, C=BQMS+spec, D=maker, E=image,
             F=unit, G=qty, H=price, I=amount, J=notes
    """
    from openpyxl.styles import Font, Alignment, Border, Side, PatternFill

    now = datetime.now()

    if template_path and Path(template_path).exists():
        wb = openpyxl.load_workbook(template_path)
        ws = wb.active
        for sheet_name in wb.sheetnames:
            if any(kw in sheet_name.lower() for kw in ("bqms", "code", "quotation")):
                ws = wb[sheet_name]
                break

        COL_A, COL_B, COL_C, COL_D = 1, 2, 3, 4
        COL_E, COL_F, COL_G, COL_H, COL_I, COL_J = 5, 6, 7, 8, 9, 10

        _safe_set_cell(ws, 4, COL_C, now.strftime("%d/%m/%Y"))
        _safe_set_cell(ws, 6, COL_H, rfq_no)
        _safe_set_cell(ws, 7, COL_C, f"QTAMABN-SEV {now.strftime('%d%m%Y')} - {rfq_no}")
        if products:
            _safe_set_cell(ws, 14, COL_A, f"Product description/ Ten hang: {products[0].get('short_name', '')}")

        DATA_START = 17
        TEMPLATE_ROW = 17
        last_data_row = DATA_START

        for i, product in enumerate(products):
            if i == 0:
                row = DATA_START
            else:
                row = last_data_row + 1
                ws.insert_rows(row)
                _copy_row_style(ws, TEMPLATE_ROW, row)
                _copy_merged_ranges_for_row(ws, TEMPLATE_ROW, row)

            _safe_set_cell(ws, row, COL_A, i + 1)
            _safe_set_cell(ws, row, COL_B, product.get("don_hang", ""))
            _safe_set_cell(ws, row, COL_C, f"{product.get('bqms', '')}\n{product.get('spec', '')}")
            _safe_set_cell(ws, row, COL_D, product.get("maker", ""))
            _safe_set_cell(ws, row, COL_F, product.get("don_vi", "EA"))
            _safe_set_cell(ws, row, COL_G, product.get("so_luong", 0))
            price = product.get("suggested_price") or product.get("unit_price")
            _safe_set_cell(ws, row, COL_H, price if price else "")
            ws.cell(row=row, column=COL_I).value = f"=G{row}*H{row}"
            _safe_set_cell(ws, row, COL_J, product.get("ghi_chu", ""))
            bqms_code = product.get("bqms", "")
            if bqms_code in images_map:
                xl_img = _pil_image_to_xl(images_map[bqms_code])
                if xl_img:
                    ws.add_image(xl_img, f"{get_column_letter(COL_E)}{row}")
            last_data_row = row

        total_row = last_data_row + 1
        ws.insert_rows(total_row)
        _copy_row_style(ws, TEMPLATE_ROW, total_row)
        _safe_set_cell(ws, total_row, COL_A, "Grand Total (VND)")
        ws.cell(row=total_row, column=COL_G).value = f"=SUM(G{DATA_START}:G{last_data_row})"
        ws.cell(row=total_row, column=COL_I).value = f"=SUM(I{DATA_START}:I{last_data_row})"
    else:
        # Create from scratch — professional Commercial Quotation
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "QUOTATION"

        thin_border = Border(
            left=Side(style='thin'), right=Side(style='thin'),
            top=Side(style='thin'), bottom=Side(style='thin')
        )
        header_fill = PatternFill(start_color='2F5496', end_color='2F5496', fill_type='solid')
        header_font = Font(name='Arial', size=10, bold=True, color='FFFFFF')
        data_font = Font(name='Arial', size=10)
        title_font = Font(name='Arial', size=14, bold=True, color='2F5496')
        total_font = Font(name='Arial', size=11, bold=True)
        total_fill = PatternFill(start_color='D6E4F0', end_color='D6E4F0', fill_type='solid')

        # Company header
        ws.merge_cells('A1:J1')
        ws['A1'] = 'AMA BAC NINH JSC - COMMERCIAL QUOTATION'
        ws['A1'].font = title_font
        ws['A1'].alignment = Alignment(horizontal='center')

        # Metadata
        ws['A3'] = 'Date:'
        ws['A3'].font = Font(name='Arial', size=10, bold=True)
        ws['B3'] = now.strftime('%d/%m/%Y')
        ws['B3'].font = data_font

        ws['A4'] = 'Quotation No:'
        ws['A4'].font = Font(name='Arial', size=10, bold=True)
        ws['B4'] = f"QTAMABN-SEV {now.strftime('%d%m%Y')} - {rfq_no}"
        ws['B4'].font = data_font

        ws['F3'] = 'RFQ No:'
        ws['F3'].font = Font(name='Arial', size=10, bold=True)
        ws['G3'] = rfq_no
        ws['G3'].font = Font(name='Arial', size=10, bold=True, color='2F5496')

        # Column headers row 6
        headers = ['#', 'RFQ No', 'BQMS Code / Spec', 'Maker', 'Image', 'Unit', 'Qty', 'Unit Price (VND)', 'Amount (VND)', 'Notes']
        col_widths = [5, 14, 40, 15, 10, 8, 10, 18, 18, 15]

        for col_idx, (h, w) in enumerate(zip(headers, col_widths), 1):
            cell = ws.cell(row=6, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='center', wrap_text=True, vertical='center')
            ws.column_dimensions[get_column_letter(col_idx)].width = w

        ws.row_dimensions[6].height = 30

        # Data rows
        DATA_START = 7
        last_data_row = DATA_START

        for i, product in enumerate(products):
            row = DATA_START + i
            price = product.get("suggested_price") or product.get("unit_price")
            qty = product.get("so_luong", 0)

            data = [
                i + 1,
                product.get("don_hang", ""),
                f"{product.get('bqms', '')}\n{product.get('spec', '')}",
                product.get("maker", ""),
                "",  # image placeholder
                product.get("don_vi", "EA"),
                qty,
                price if price else "",
                None,  # formula
                product.get("ghi_chu", ""),
            ]

            for col_idx, val in enumerate(data, 1):
                cell = ws.cell(row=row, column=col_idx, value=val)
                cell.font = data_font
                cell.border = thin_border
                if col_idx == 1:
                    cell.alignment = Alignment(horizontal='center')
                elif col_idx == 3:
                    cell.alignment = Alignment(wrap_text=True, vertical='top')
                elif col_idx in (7, 8, 9):
                    cell.alignment = Alignment(horizontal='right')
                    cell.number_format = '#,##0'

            # Amount formula
            ws.cell(row=row, column=9).value = f"=G{row}*H{row}"
            ws.cell(row=row, column=9).number_format = '#,##0'

            # Image
            bqms_code = product.get("bqms", "")
            if bqms_code in images_map:
                xl_img = _pil_image_to_xl(images_map[bqms_code])
                if xl_img:
                    ws.add_image(xl_img, f"E{row}")

            last_data_row = row

        # Grand Total row
        total_row = last_data_row + 1
        ws.merge_cells(f'A{total_row}:F{total_row}')
        ws[f'A{total_row}'] = 'GRAND TOTAL (VND)'
        ws[f'A{total_row}'].font = total_font
        ws[f'A{total_row}'].fill = total_fill
        ws[f'A{total_row}'].alignment = Alignment(horizontal='right')
        ws[f'A{total_row}'].border = thin_border

        ws.cell(row=total_row, column=7).value = f"=SUM(G{DATA_START}:G{last_data_row})"
        ws.cell(row=total_row, column=7).font = total_font
        ws.cell(row=total_row, column=7).fill = total_fill
        ws.cell(row=total_row, column=7).border = thin_border
        ws.cell(row=total_row, column=7).number_format = '#,##0'

        ws.cell(row=total_row, column=9).value = f"=SUM(I{DATA_START}:I{last_data_row})"
        ws.cell(row=total_row, column=9).font = total_font
        ws.cell(row=total_row, column=9).fill = total_fill
        ws.cell(row=total_row, column=9).border = thin_border
        ws.cell(row=total_row, column=9).number_format = '#,##0'

        for col in range(1, 11):
            if col not in (1, 7, 9):
                ws.cell(row=total_row, column=col).fill = total_fill
                ws.cell(row=total_row, column=col).border = thin_border

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)
    logger.info("Quotation filled: %d products -> %s", len(products), output_path)
    return True


# ─── Run Auto-Fill Job (orchestrator) ────────────────────────

async def run_autofill_job(
    conn,
    quotation_id: int,
    items: list[dict],
    images: list[tuple[str, bytes]] | None = None,
    cam_ket_template: str | None = None,
    commercial_template: str | None = None,
    flow_type: str = "tm",
) -> dict[str, Any]:
    """Execute the full auto-fill pipeline for a quotation.

    Args:
        flow_type: "tm" (Thương Mại) or "gc" (Gia Công).
            TM: CAM KET (all items) + Commercial Quotation (TM items only).
            GC: CAM KET (all items) + Commercial Quotation (GC items with cost breakdown).

    Steps:
      1. Apply user-edited prices (unit_price field overrides suggested_price)
      2. Lookup prices from DB for items without user price
      3. Match images to orders
      4. Fill CAM KET template (all items)
      5. Fill Commercial Quotation template (filtered by flow_type)
      6. Convert to PDF via Gotenberg
      7. Update quotation record in DB
    """
    from app.services.gotenberg_service import convert_xlsx_to_pdf

    result: dict[str, Any] = {
        "success": False,
        "quotation_id": quotation_id,
        "files": [],
        "errors": [],
    }

    try:
        # Update status
        await conn.execute(
            "UPDATE quotations SET status = 'processing', updated_at = NOW() WHERE id = $1",
            quotation_id,
        )

        # 1. Apply user-edited prices — if item has 'unit_price', use it as suggested_price
        for item in items:
            user_price = item.get("unit_price")
            if user_price is not None and user_price != "" and user_price != 0:
                try:
                    item["suggested_price"] = float(user_price)
                except (ValueError, TypeError):
                    pass

        # 2. Lookup prices from DB for items without a user price
        items_needing_lookup = [i for i in items if not i.get("suggested_price")]
        if items_needing_lookup:
            items_needing_lookup = await lookup_prices(conn, items_needing_lookup)
            # Merge back
            lookup_map = {i["bqms"]: i for i in items_needing_lookup}
            for item in items:
                if not item.get("suggested_price") and item.get("bqms") in lookup_map:
                    looked = lookup_map[item["bqms"]]
                    item["suggested_price"] = looked.get("suggested_price")
                    item["price_history"] = looked.get("price_history", [])

        # Get RFQ no and build output path matching OneDrive structure:
        # RFQ {year}/THANG {month}/{rfq_no} {short_spec}/
        rfq_no = items[0].get("don_hang", "UNKNOWN") if items else "UNKNOWN"
        now = datetime.now()
        year_str = f"RFQ {now.year}"
        month_str = f"THANG {now.month}"

        # Build folder name: "{rfq_no} {short_spec} {day}-{month}"
        short_spec = ""
        if items:
            spec = items[0].get("spec", "") or items[0].get("bqms", "")
            # Take first word/part of spec for folder name
            short_spec = re.sub(r'[\\/:*?"<>|]', '', spec)[:40].strip()
        folder_name = f"{rfq_no} {short_spec} {now.day}-{now.month}".strip()

        output_dir = FILES_BASE / year_str / month_str / folder_name
        output_dir.mkdir(parents=True, exist_ok=True)

        # 3. Match images: combine user-uploaded with auto-discovered from
        # /data/onedrive-staging/Puplic/BQMS/RFQ/.../{rfq_no}*/
        all_image_files: list[tuple[str, bytes]] = list(images or [])
        discovered = discover_rfq_images(rfq_no)
        # User upload wins on filename collision
        seen_names = {n for n, _ in all_image_files}
        for fname, fbytes in discovered:
            if fname not in seen_names:
                all_image_files.append((fname, fbytes))
        images_map: dict[str, bytes] = match_images_to_orders(all_image_files, items)
        if images_map:
            logger.info('autofill: %d products matched to images', len(images_map))

        # Filter items by flow_type
        if flow_type == "gc":
            target_items = [i for i in items if i.get("loai_hang") == "GC"] or items
        else:
            target_items = [i for i in items if i.get("loai_hang") == "TM"] or items

        all_items = items  # CAM KET uses all items

        files: list[dict] = []

        # 4. Fill CAM KET (always — creates from scratch if no template)
        ck_xlsx = str(output_dir / f"CAM_KET_{rfq_no}.xlsx")
        fill_cam_ket(cam_ket_template, all_items, images_map, ck_xlsx)
        files.append({"type": "cam_ket_xlsx", "path": ck_xlsx})

        try:
            ck_pdf = str(output_dir / f"CAM_KET_{rfq_no}.pdf")
            await convert_xlsx_to_pdf(ck_xlsx, ck_pdf)
            files.append({"type": "cam_ket_pdf", "path": ck_pdf})
        except Exception as exc:
            result["errors"].append(f"CAM KET PDF conversion failed: {exc}")

        # 5. Fill Commercial Quotation (always — creates from scratch if no template)
        qt_xlsx = str(output_dir / f"QUOTATION_{rfq_no}.xlsx")
        fill_quotation(commercial_template, target_items, images_map, rfq_no, qt_xlsx)
        files.append({"type": "quotation_xlsx", "path": qt_xlsx})

        try:
            qt_pdf = str(output_dir / f"QUOTATION_{rfq_no}.pdf")
            await convert_xlsx_to_pdf(qt_xlsx, qt_pdf)
            files.append({"type": "quotation_pdf", "path": qt_pdf})
        except Exception as exc:
            result["errors"].append(f"Quotation PDF conversion failed: {exc}")

        # 6. Update DB
        output_xlsx = next((f["path"] for f in files if "xlsx" in f["type"]), None)
        output_pdf = next((f["path"] for f in files if "pdf" in f["type"]), None)

        await conn.execute(
            """
            UPDATE quotations
            SET status = 'completed',
                items = $2::jsonb,
                output_xlsx = $3,
                output_pdf = $4,
                filled_items = $5,
                total_items = $6,
                updated_at = NOW()
            WHERE id = $1
            """,
            quotation_id,
            __import__("json").dumps(items, default=str, ensure_ascii=False),
            output_xlsx,
            output_pdf,
            len([i for i in items if i.get("suggested_price")]),
            len(items),
        )

        result["success"] = True
        result["files"] = files
        result["rfq_no"] = rfq_no
        result["total_items"] = len(items)
        result["filled_items"] = len([i for i in items if i.get("suggested_price")])

    except Exception as exc:
        logger.exception("Auto-fill job failed for quotation %d", quotation_id)
        result["errors"].append(str(exc))
        await conn.execute(
            "UPDATE quotations SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1",
            quotation_id, str(exc),
        )

    return result
