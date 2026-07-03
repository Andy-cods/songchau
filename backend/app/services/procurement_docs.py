"""Procurement contract document renderer.

Builds the contract HTML (Song Châu letterhead + parties + line items + terms +
e-sign blocks) and converts it to PDF via Gotenberg's Chromium HTML route
(gotenberg_service.convert_html_to_pdf). Gotenberg is the canonical (and only)
PDF engine per PLAN §8 — there is no hand-built fallback.

Public API:
    render_contract_html(contract: dict, items: list[dict]) -> str
    async generate_contract_pdf(conn, contract_id: int) -> str   # → relative path
    async render_contract_pdf(contract: dict, items: list[dict], out_path) -> str

SECURITY: every DB-/vendor-supplied string (vendor_name, vendor_address,
specification, notes, signature name, terms) is HTML-escaped via `_esc`
(html.escape) before interpolation. This is the HTML analogue of
quote_renderer._defuse_formula (which guards XLSX formula injection, NOT
applicable to HTML). The PDF is rendered by headless Chromium, so unescaped
DB content would otherwise be a stored-XSS / markup-injection vector.
"""
from __future__ import annotations

import base64
import functools
import html
import logging
import os
from datetime import date, datetime
from typing import Any

import asyncpg

from app.core.config import settings
from app.services.gotenberg_service import convert_html_to_pdf

logger = logging.getLogger(__name__)

# Company letterhead — OFFICIAL Song Châu legal identity, taken verbatim from the
# real "Mẫu báo giá" (mau_bao_gia_dump.json cells A3-A8) + the seeded companies
# row (init_v3.sql: 'Cong ty TNHH MTV Song Chau', MST 2500574479). This is a legal
# document, so the letterhead MUST match the official quote exactly.
COMPANY_NAME = "SONG CHÂU"
COMPANY_VN = "CÔNG TY TNHH MỘT THÀNH VIÊN SONG CHÂU"
COMPANY_TAX = "MST: 2500574479"
COMPANY_ADDRESS = "TDP 4 Đạm Nội, P. Tiền Châu, TP. Phúc Yên, Vĩnh Phúc"
COMPANY_HOTLINE = "ĐT: 0984716995"
COMPANY_EMAIL = "Email: dangthison@songchau.vn"
COMPANY_WEB = "Web: songchau.vn"


# ---------------------------------------------------------------------------
# Formatting / escaping helpers
# ---------------------------------------------------------------------------

def _esc(v: Any) -> str:
    """HTML-escape any DB-/vendor-supplied value (XSS into Chromium)."""
    return html.escape(str(v if v is not None else ""))


def _fmt_money(v: Any) -> str:
    """Format amount with `.` thousands sep (VN convention)."""
    if v is None or v == "":
        return "0"
    try:
        n = float(v)
        if n == int(n):
            return f"{int(n):,}".replace(",", ".")
        return f"{n:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    except Exception:
        return _esc(v)


def _fmt_qty(v: Any) -> str:
    if v is None or v == "":
        return "0"
    try:
        f = float(v)
        if f == int(f):
            return f"{int(f):,}".replace(",", ".")
        return f"{f:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    except Exception:
        return _esc(v)


def _fmt_date(v: Any) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, (date, datetime)):
        return v.strftime("%d/%m/%Y")
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).strftime("%d/%m/%Y")
    except Exception:
        return _esc(v)


def _num2words_vn(n: Any) -> str:
    """Convert số -> chữ VN (tối đa 999 tỉ). Mirror of quote_renderer._num2words_vn."""
    if n is None or n == 0:
        return "không"
    try:
        n = int(round(float(n)))
    except Exception:
        return str(n)
    if n < 0:
        return "âm " + _num2words_vn(-n)

    don_vi = ["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]

    def _read_3(num: int, full: bool) -> str:
        tram, du = divmod(num, 100)
        chuc, dv = divmod(du, 10)
        out: list[str] = []
        if full or tram > 0:
            out.append(don_vi[tram] + " trăm")
            if chuc == 0 and dv > 0:
                out.append("lẻ")
        if chuc > 1:
            out.append(don_vi[chuc] + " mươi")
            if dv == 1:
                out.append("mốt")
            elif dv == 5:
                out.append("lăm")
            elif dv > 0:
                out.append(don_vi[dv])
        elif chuc == 1:
            out.append("mười")
            if dv == 5:
                out.append("lăm")
            elif dv > 0:
                out.append(don_vi[dv])
        elif chuc == 0 and dv > 0:
            out.append(don_vi[dv])
        return " ".join(s for s in out if s)

    units = ["", "nghìn", "triệu", "tỉ"]
    groups: list[int] = []
    while n > 0:
        groups.append(n % 1000)
        n //= 1000

    parts: list[str] = []
    for idx in range(len(groups) - 1, -1, -1):
        g = groups[idx]
        if g == 0 and idx > 0:
            continue
        s = _read_3(g, full=(idx != len(groups) - 1))
        if s:
            parts.append(s + (" " + units[idx] if units[idx] else ""))
    out = " ".join(parts).strip()
    return out[:1].upper() + out[1:] if out else "không"


# ---------------------------------------------------------------------------
# CSS — ONE violet brand color + slate (matches Song Châu design restraint)
# ---------------------------------------------------------------------------

_CSS = """
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
body {
    font-family: 'DejaVu Sans', 'Be Vietnam Pro', 'Inter', Arial, sans-serif;
    font-size: 10pt; color: #0f172a; margin: 0;
}
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
.header { display: flex; justify-content: space-between; align-items: flex-start; }
.header .left { flex: 1; }
.header .right { text-align: right; font-size: 9pt; color: #475569; }
.logo { height: 13mm; width: auto; display: block; margin-bottom: 1.5mm; }
.brand { font-size: 16pt; font-weight: 700; color: #6d28d9; letter-spacing: 0.5px; }
.subbrand { font-size: 9pt; color: #475569; }
.violet-bar { height: 2mm; background: #6d28d9; margin: 5mm 0 3mm; border-radius: 1mm; }
.doc-title { font-size: 20pt; font-weight: 700; color: #0f172a; text-align: center; margin: 2mm 0 1mm; }
.doc-sub { text-align: center; color: #475569; font-size: 9.5pt; margin-bottom: 5mm; }
.section { margin-bottom: 5mm; }
.section-title { font-size: 10pt; font-weight: 700; color: #4c1d95; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #e2e8f0; padding-bottom: 1mm; margin-bottom: 2mm; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
.parties .lbl { color: #64748b; font-size: 9pt; }
.parties .nm { font-weight: 700; color: #0f172a; }
.parties .line { font-size: 9.5pt; color: #334155; }
table.items { width: 100%; border-collapse: collapse; margin-top: 1mm; }
table.items th {
    background: #ede9fe; color: #4c1d95; font-weight: 700; font-size: 9pt;
    padding: 2mm 1.5mm; border: 1px solid #c4b5fd; text-align: center;
}
table.items td { padding: 1.8mm 1.5mm; border: 1px solid #e2e8f0; font-size: 9.5pt; vertical-align: top; }
table.items td.r { text-align: right; }
table.items td.c { text-align: center; }
table.items tr.grand td { font-size: 11pt; font-weight: 700; color: #6d28d9; background: #f5f3ff; }
.words { font-style: italic; color: #475569; margin-top: 2mm; }
.terms .row { display: flex; gap: 4mm; padding: 1mm 0; font-size: 9.5pt; }
.terms .row .k { width: 42mm; color: #64748b; }
.terms .row .v { flex: 1; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-top: 10mm; text-align: center; font-size: 9.5pt; }
.sign .box { min-height: 30mm; }
.sign .title { font-weight: 700; color: #4c1d95; margin-bottom: 2mm; }
.sign .hint { color: #94a3b8; font-size: 8.5pt; }
.sign .esigned { color: #16a34a; font-weight: 700; margin-top: 1mm; }
.wrap { padding: 14mm 12mm; }
"""


# ---------------------------------------------------------------------------
# Letterhead logo (optional, drop-in at runtime — no rebuild)
# ---------------------------------------------------------------------------
# The Song Châu logo is embedded as a base64 data-URI so the Gotenberg HTML is
# fully self-contained (no external fetch). Drop the file at one of these paths
# and restart the API to pick it up:
#   * <FILES_BASE_PATH>/branding/songchau_logo.(png|jpg)   ← shared volume, no rebuild
#   * app/services/assets/songchau_logo.png                ← bundled in image
# If NO file is found the text brand stands alone (current behaviour) — the PDF
# never breaks on a missing logo.
_LOGO_PATHS = (
    os.path.join(settings.FILES_BASE_PATH, "branding", "songchau_logo.png"),
    os.path.join(settings.FILES_BASE_PATH, "branding", "songchau_logo.jpg"),
    os.path.join(os.path.dirname(__file__), "assets", "songchau_logo.png"),
)


@functools.lru_cache(maxsize=1)
def _logo_data_uri() -> str:
    """Base64 data-URI of the Song Châu letterhead logo (cached per process).

    Returns '' when no logo file is present. A deploy restart clears the cache,
    so dropping the file under <FILES_BASE_PATH>/branding/ + restart is enough.
    """
    for p in _LOGO_PATHS:
        try:
            if os.path.isfile(p):
                with open(p, "rb") as fh:
                    raw = fh.read()
                low = p.lower()
                mime = (
                    "image/jpeg" if low.endswith((".jpg", ".jpeg"))
                    else "image/svg+xml" if low.endswith(".svg")
                    else "image/png"
                )
                return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
        except Exception:  # pragma: no cover - logo is best-effort decoration
            logger.warning("letterhead: could not read logo %s", p)
    return ""


def _letterhead_left_html() -> str:
    """Left side of the letterhead: Song Châu logo (if present) + brand text.

    Shared by every Song Châu document (contract / delivery note / PO) so the
    branding stays identical across the whole procurement paper trail (DRY).
    """
    logo = _logo_data_uri()
    logo_img = f"<img class=\"logo\" src=\"{logo}\" alt=\"Song Châu\" />" if logo else ""
    return (
        "<div class=\"left\">"
        f"{logo_img}"
        f"<div class=\"brand\">{_esc(COMPANY_NAME)}</div>"
        f"<div class=\"subbrand\">{_esc(COMPANY_VN)}</div>"
        "</div>"
    )


def _render_items_rows(items: list[dict]) -> str:
    rows: list[str] = []
    for it in items:
        qty = it.get("quantity")
        unit_price = it.get("unit_price")
        total_price = it.get("total_price")
        if total_price is None:
            try:
                total_price = float(qty or 0) * float(unit_price or 0)
            except Exception:
                total_price = 0
        rows.append(
            "<tr>"
            f"<td class='c'>{_esc(it.get('item_no'))}</td>"
            f"<td class='c'>{_esc(it.get('bqms_code'))}</td>"
            f"<td>{_esc(it.get('specification'))}</td>"
            f"<td class='c'>{_fmt_qty(qty)}</td>"
            f"<td class='c'>{_esc(it.get('unit') or 'EA')}</td>"
            f"<td class='r'>{_fmt_money(unit_price)}</td>"
            f"<td class='r'>{_fmt_money(total_price)}</td>"
            "</tr>"
        )
    return "\n".join(rows)


def render_contract_html(contract: dict, items: list[dict]) -> str:
    """Render the contract as a standalone HTML document.

    All DB/vendor strings pass through _esc (html.escape) before interpolation.
    """
    items = items or []
    currency = _esc(contract.get("currency") or "VND")

    # Grand total — prefer the stored total_amount; else sum the line items.
    total = contract.get("total_amount")
    if total is None:
        total = 0.0
        for it in items:
            tp = it.get("total_price")
            if tp is None:
                try:
                    tp = float(it.get("quantity") or 0) * float(it.get("unit_price") or 0)
                except Exception:
                    tp = 0
            try:
                total += float(tp or 0)
            except Exception:
                pass
    try:
        total_int = int(round(float(total)))
    except Exception:
        total_int = 0
    words = (_num2words_vn(total_int) + " đồng") if currency == "VND" else _num2words_vn(total_int)

    status = (contract.get("status") or "draft")
    is_signed = status in ("signed", "active", "completed")
    sig = contract.get("signature_data") or {}
    if not isinstance(sig, dict):
        sig = {}
    signer = contract.get("signed_by_vendor") or sig.get("name") or ""
    signed_at = contract.get("signed_at")

    vendor_block = "".join(
        f"<div class='line'>{line}</div>"
        for line in [
            f"MST: {_esc(contract.get('vendor_tax_code'))}" if contract.get("vendor_tax_code") else "",
            _esc(contract.get("vendor_address")) if contract.get("vendor_address") else "",
            f"ĐT: {_esc(contract.get('vendor_phone'))}" if contract.get("vendor_phone") else "",
            f"Email: {_esc(contract.get('vendor_email'))}" if contract.get("vendor_email") else "",
        ]
        if line
    )

    if is_signed:
        ncc_sign = (
            f"<div class='nm'>{_esc(signer)}</div>"
            f"<div class='esigned'>Đã ký điện tử</div>"
            f"<div class='hint'>{_fmt_date(signed_at)}</div>"
        )
    else:
        ncc_sign = "<div class='hint'>(Ký, ghi rõ họ tên, đóng dấu)</div>"

    rows_html = _render_items_rows(items)

    notes_row = (
        f"<div class='row'><div class='k'>Ghi chú</div><div class='v'>{_esc(contract.get('notes'))}</div></div>"
        if contract.get("notes") else ""
    )

    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>Hợp đồng {_esc(contract.get('contract_no'))}</title>
<style>{_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    {_letterhead_left_html()}
    <div class="right">
      <div>{_esc(COMPANY_TAX)}</div>
      <div>{_esc(COMPANY_ADDRESS)}</div>
      <div>{_esc(COMPANY_HOTLINE)}</div>
      <div>{_esc(COMPANY_EMAIL)} · {_esc(COMPANY_WEB)}</div>
    </div>
  </div>
  <div class="violet-bar"></div>
  <div class="doc-title">HỢP ĐỒNG CUNG ỨNG</div>
  <div class="doc-sub">
    Số: <b>{_esc(contract.get('contract_no'))}</b> ·
    Ngày: {_fmt_date(contract.get('contract_date'))}
    {(" · Hiệu lực: " + _fmt_date(contract.get('effective_date'))) if contract.get('effective_date') else ""}
  </div>

  <div class="section">
    <div class="section-title">Các bên</div>
    <div class="parties">
      <div>
        <div class="lbl">BÊN A (Bên mua)</div>
        <div class="nm">{_esc(COMPANY_VN)}</div>
        <div class="line">{_esc(COMPANY_TAX)}</div>
        <div class="line">{_esc(COMPANY_ADDRESS)}</div>
      </div>
      <div>
        <div class="lbl">BÊN B (Nhà cung cấp)</div>
        <div class="nm">{_esc(contract.get('vendor_name'))}</div>
        {vendor_block}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Hàng hoá / dịch vụ</div>
    <table class="items">
      <thead>
        <tr>
          <th style="width:8mm">STT</th>
          <th style="width:24mm">Mã BQMS</th>
          <th>Quy cách</th>
          <th style="width:16mm">SL</th>
          <th style="width:12mm">ĐVT</th>
          <th style="width:26mm">Đơn giá</th>
          <th style="width:28mm">Thành tiền</th>
        </tr>
      </thead>
      <tbody>
        {rows_html}
      </tbody>
    </table>
    <table class="items" style="margin-top:0">
      <tr class="grand"><td class="r" style="border:none">TỔNG CỘNG ({currency})</td><td class="r" style="width:28mm">{_fmt_money(total)}</td></tr>
    </table>
    <div class="words">Bằng chữ: {_esc(words)}.</div>
  </div>

  <div class="section terms">
    <div class="section-title">Điều khoản</div>
    <div class="row"><div class="k">Phương thức thanh toán</div><div class="v">{_esc(contract.get('payment_terms') or 'Theo thoả thuận')}</div></div>
    <div class="row"><div class="k">Điều kiện giao hàng</div><div class="v">{_esc(contract.get('delivery_terms') or 'Theo thoả thuận')}</div></div>
    <div class="row"><div class="k">Điều kiện bảo hành</div><div class="v">{_esc(contract.get('warranty_terms') or 'Theo thoả thuận')}</div></div>
    {notes_row}
  </div>

  <div class="sign">
    <div class="box">
      <div class="title">ĐẠI DIỆN BÊN A — SONG CHÂU</div>
      <div class="hint">(Ký, ghi rõ họ tên, đóng dấu)</div>
    </div>
    <div class="box">
      <div class="title">ĐẠI DIỆN BÊN B — NHÀ CUNG CẤP</div>
      {ncc_sign}
    </div>
  </div>
</div>
</body>
</html>"""


def _contract_pdf_relpath(contract_no: str) -> str:
    """Relative storage path (under FILES_BASE_PATH) for a contract PDF.

    Filename is derived only from contract_no (server-generated, UNIQUE) — never
    from client input — and sanitised so it can never escape the contracts dir.
    """
    safe = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in str(contract_no))
    return f"contracts/{safe}.pdf"


async def render_contract_pdf(contract: dict, items: list[dict], out_path: str) -> str:
    """Render contract HTML → PDF at out_path (absolute) via Gotenberg.

    Returns the same out_path. Thin wrapper used directly when the caller already
    has the contract+items dicts in hand (matches the task signature).
    """
    html_str = render_contract_html(contract, items)
    return await convert_html_to_pdf(html_str, out_path)


async def generate_contract_pdf(conn: asyncpg.Connection, contract_id: int) -> str:
    """Fetch contract + items, render PDF, write under FILES_BASE_PATH.

    Returns the RELATIVE path (e.g. 'contracts/SC-CT-2026-0001.pdf') so the
    endpoint can store it in contract_file_path. The endpoint sets
    pdf_generated_at=NOW() and (if appropriate) contract_file_path itself.
    """
    contract = await conn.fetchrow(
        "SELECT * FROM procurement_contracts WHERE id = $1", contract_id
    )
    if not contract:
        raise ValueError(f"Contract {contract_id} not found")
    items = await conn.fetch(
        "SELECT * FROM procurement_contract_items WHERE contract_id = $1 ORDER BY item_no",
        contract_id,
    )

    contract_d = dict(contract)
    items_d = [dict(i) for i in items]

    rel = _contract_pdf_relpath(contract_d.get("contract_no") or f"contract-{contract_id}")
    out_abs = os.path.join(settings.FILES_BASE_PATH, rel)

    html_str = render_contract_html(contract_d, items_d)
    await convert_html_to_pdf(html_str, out_abs)

    logger.info("Generated contract PDF for #%s -> %s", contract_id, out_abs)
    return rel


# ===========================================================================
# Đợt 8 #2 — PHIẾU GIAO NHẬN HÀNG HÓA (Delivery Note) PDF
# ---------------------------------------------------------------------------
# Song Châu (BÊN MUA / BÊN NHẬN) phát hành phiếu giao nhận cho một lô giao của
# NCC (BÊN GIAO). KHÁC HẲN Samsung deliveryInvoicePDF.do (ở đó Song Châu là
# vendor tải tài liệu của Samsung). Tái dùng toàn bộ letterhead + _esc/_fmt/_CSS
# + Gotenberg của contract renderer (DRY).
# ===========================================================================

_QUALITY_VN = {"ok": "Đạt", "minor_defect": "Lỗi nhẹ", "rejected": "Loại"}


def _render_delivery_item_rows(items: list[dict]) -> str:
    rows: list[str] = []
    for i, it in enumerate(items, start=1):
        q = _QUALITY_VN.get(str(it.get("quality_status") or "ok"), _esc(it.get("quality_status")))
        rows.append(
            "<tr>"
            f"<td class='c'>{i}</td>"
            f"<td class='c'>{_esc(it.get('bqms_code'))}</td>"
            f"<td>{_esc(it.get('specification'))}</td>"
            f"<td class='c'>{_esc(it.get('unit') or 'EA')}</td>"
            f"<td class='r'>{_fmt_qty(it.get('ordered_qty'))}</td>"
            f"<td class='r'>{_fmt_qty(it.get('delivered_qty'))}</td>"
            f"<td class='c'>{q}</td>"
            "</tr>"
        )
    return "\n".join(rows)


def render_delivery_note_html(delivery: dict, items: list[dict]) -> str:
    """Render PHIẾU GIAO NHẬN HÀNG HÓA as a standalone HTML document.

    All DB-/vendor-supplied strings pass through _esc before interpolation.
    """
    items = items or []
    rows_html = _render_delivery_item_rows(items)

    # Logistics / packing block (GĐ1 fields).
    packing_rows = "".join(
        f"<div class='row'><div class='k'>{k}</div><div class='v'>{v}</div></div>"
        for k, v in [
            ("Số hóa đơn NCC", _esc(delivery.get("vendor_invoice_no")) if delivery.get("vendor_invoice_no") else ""),
            ("Ngày hóa đơn", _fmt_date(delivery.get("invoice_date"))),
            ("Số kiện", (f"{_fmt_qty(delivery.get('packing_qty'))} {_esc(delivery.get('packing_unit') or '')}".strip()
                          if delivery.get("packing_qty") is not None else "")),
            ("Tổng khối lượng", (f"{_fmt_qty(delivery.get('gross_weight'))} KG" if delivery.get("gross_weight") is not None else "")),
            ("Phương thức giao", _esc(delivery.get("delivery_method"))),
            ("Mã vận đơn", _esc(delivery.get("tracking_no")) if delivery.get("tracking_no") else ""),
            ("Ngày giao", _fmt_date(delivery.get("delivered_at"))),
        ]
        if v
    )

    notes_row = (
        f"<div class='row'><div class='k'>Ghi chú</div><div class='v'>{_esc(delivery.get('notes'))}</div></div>"
        if delivery.get("notes") else ""
    )

    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>Phiếu giao nhận {_esc(delivery.get('delivery_no'))}</title>
<style>{_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    {_letterhead_left_html()}
    <div class="right">
      <div>{_esc(COMPANY_TAX)}</div>
      <div>{_esc(COMPANY_ADDRESS)}</div>
      <div>{_esc(COMPANY_HOTLINE)}</div>
      <div>{_esc(COMPANY_EMAIL)} · {_esc(COMPANY_WEB)}</div>
    </div>
  </div>
  <div class="violet-bar"></div>
  <div class="doc-title">PHIẾU GIAO NHẬN HÀNG HÓA</div>
  <div class="doc-sub">
    Số: <b>{_esc(delivery.get('delivery_no'))}</b>
    {(" · Đơn mua: " + _esc(delivery.get('po_no'))) if delivery.get('po_no') else ""}
    {(" · Ngày: " + _fmt_date(delivery.get('delivered_at'))) if delivery.get('delivered_at') else ""}
  </div>

  <div class="section">
    <div class="section-title">Các bên</div>
    <div class="parties">
      <div>
        <div class="lbl">BÊN GIAO (Nhà cung cấp)</div>
        <div class="nm">{_esc(delivery.get('vendor_name'))}</div>
      </div>
      <div>
        <div class="lbl">BÊN NHẬN (Bên mua)</div>
        <div class="nm">{_esc(COMPANY_VN)}</div>
        <div class="line">{_esc(COMPANY_TAX)}</div>
        <div class="line">{_esc(COMPANY_ADDRESS)}</div>
      </div>
    </div>
  </div>

  {("<div class='section terms'><div class='section-title'>Thông tin đóng gói / vận chuyển</div>" + packing_rows + "</div>") if packing_rows else ""}

  <div class="section">
    <div class="section-title">Hàng hóa giao nhận</div>
    <table class="items">
      <thead>
        <tr>
          <th style="width:8mm">STT</th>
          <th style="width:24mm">Mã BQMS</th>
          <th>Quy cách</th>
          <th style="width:12mm">ĐVT</th>
          <th style="width:18mm">SL đặt</th>
          <th style="width:18mm">SL giao</th>
          <th style="width:16mm">Chất lượng</th>
        </tr>
      </thead>
      <tbody>
        {rows_html}
      </tbody>
    </table>
    {("<div class='section terms' style='margin-top:3mm'>" + notes_row + "</div>") if notes_row else ""}
  </div>

  <div class="sign">
    <div class="box">
      <div class="title">ĐẠI DIỆN BÊN GIAO — NHÀ CUNG CẤP</div>
      <div class="hint">(Ký, ghi rõ họ tên)</div>
    </div>
    <div class="box">
      <div class="title">ĐẠI DIỆN BÊN NHẬN — SONG CHÂU</div>
      <div class="hint">(Ký, ghi rõ họ tên, đóng dấu)</div>
    </div>
  </div>
</div>
</body>
</html>"""


def _delivery_note_relpath(delivery_no: str) -> str:
    safe = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in str(delivery_no))
    return f"delivery_notes/{safe}.pdf"


async def generate_delivery_note_pdf(conn: asyncpg.Connection, delivery_id: int) -> str:
    """Fetch delivery + items, render Phiếu Giao Nhận PDF under FILES_BASE_PATH.

    Returns the RELATIVE path (e.g. 'delivery_notes/SC-DEL-2026-0001.pdf') so the
    endpoint can store it in procurement_deliveries.delivery_note_path.
    """
    delivery = await conn.fetchrow(
        """SELECT d.*, p.po_no, p.vendor_name
             FROM procurement_deliveries d
             LEFT JOIN procurement_pos p ON p.id = d.po_id
            WHERE d.id = $1""",
        delivery_id,
    )
    if not delivery:
        raise ValueError(f"Delivery {delivery_id} not found")
    items = await conn.fetch(
        """SELECT di.delivered_qty, di.quality_status,
                  pi.bqms_code, pi.specification, pi.ordered_qty, pi.unit, pi.item_no
             FROM procurement_delivery_items di
             JOIN procurement_po_items pi ON pi.id = di.po_item_id
            WHERE di.delivery_id = $1
            ORDER BY pi.item_no""",
        delivery_id,
    )

    delivery_d = dict(delivery)
    items_d = [dict(i) for i in items]

    rel = _delivery_note_relpath(delivery_d.get("delivery_no") or f"delivery-{delivery_id}")
    out_abs = os.path.join(settings.FILES_BASE_PATH, rel)

    html_str = render_delivery_note_html(delivery_d, items_d)
    # Atomic write: render to a per-process temp then os.replace, so a concurrent
    # download never streams a half-written file (deterministic path is re-rendered).
    tmp_abs = f"{out_abs}.{os.getpid()}.tmp"
    await convert_html_to_pdf(html_str, tmp_abs)
    os.replace(tmp_abs, out_abs)

    logger.info("Generated delivery note PDF for #%s -> %s", delivery_id, out_abs)
    return rel


# ===========================================================================
# Đợt 8 #9 — ĐƠN ĐẶT HÀNG (Purchase Order) PDF
# ---------------------------------------------------------------------------
# Song Châu (BÊN MUA) phát hành ĐƠN ĐẶT HÀNG cho NCC (BÊN BÁN). On-demand render
# (PO nhỏ, render nhanh) — không cần cột DB. Tái dùng letterhead + helpers.
# ===========================================================================

def _render_po_item_rows(items: list[dict]) -> str:
    rows: list[str] = []
    for i, it in enumerate(items, start=1):
        qty = it.get("ordered_qty")
        unit_price = it.get("unit_price")
        try:
            total_price = float(qty or 0) * float(unit_price or 0)
        except Exception:
            total_price = 0
        rows.append(
            "<tr>"
            f"<td class='c'>{i}</td>"
            f"<td class='c'>{_esc(it.get('bqms_code'))}</td>"
            f"<td>{_esc(it.get('specification'))}</td>"
            f"<td class='r'>{_fmt_qty(qty)}</td>"
            f"<td class='c'>{_esc(it.get('unit') or 'EA')}</td>"
            f"<td class='r'>{_fmt_money(unit_price)}</td>"
            f"<td class='r'>{_fmt_money(total_price)}</td>"
            "</tr>"
        )
    return "\n".join(rows)


def render_po_html(po: dict, items: list[dict]) -> str:
    """Render ĐƠN ĐẶT HÀNG as a standalone HTML document (all DB strings _esc'd)."""
    items = items or []
    raw_currency = po.get("currency") or "VND"  # compare on RAW (pre-escape) value
    currency = _esc(raw_currency)
    total = po.get("total_amount")
    if total is None:
        total = 0.0
        for it in items:
            try:
                total += float(it.get("ordered_qty") or 0) * float(it.get("unit_price") or 0)
            except Exception:
                pass
    try:
        total_int = int(round(float(total)))
    except Exception:
        total_int = 0
    words = (_num2words_vn(total_int) + " đồng") if raw_currency == "VND" else _num2words_vn(total_int)
    rows_html = _render_po_item_rows(items)
    notes_row = (
        f"<div class='row'><div class='k'>Ghi chú</div><div class='v'>{_esc(po.get('notes'))}</div></div>"
        if po.get("notes") else ""
    )

    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>Đơn đặt hàng {_esc(po.get('po_no'))}</title>
<style>{_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    {_letterhead_left_html()}
    <div class="right">
      <div>{_esc(COMPANY_TAX)}</div>
      <div>{_esc(COMPANY_ADDRESS)}</div>
      <div>{_esc(COMPANY_HOTLINE)}</div>
      <div>{_esc(COMPANY_EMAIL)} · {_esc(COMPANY_WEB)}</div>
    </div>
  </div>
  <div class="violet-bar"></div>
  <div class="doc-title">ĐƠN ĐẶT HÀNG</div>
  <div class="doc-sub">
    Số: <b>{_esc(po.get('po_no'))}</b> · Ngày: {_fmt_date(po.get('po_date'))}
    {(" · Hợp đồng: " + _esc(po.get('contract_no'))) if po.get('contract_no') else ""}
  </div>

  <div class="section">
    <div class="section-title">Các bên</div>
    <div class="parties">
      <div>
        <div class="lbl">BÊN MUA</div>
        <div class="nm">{_esc(COMPANY_VN)}</div>
        <div class="line">{_esc(COMPANY_TAX)}</div>
        <div class="line">{_esc(COMPANY_ADDRESS)}</div>
      </div>
      <div>
        <div class="lbl">BÊN BÁN (Nhà cung cấp)</div>
        <div class="nm">{_esc(po.get('vendor_name'))}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Hàng hóa đặt mua</div>
    <table class="items">
      <thead>
        <tr>
          <th style="width:8mm">STT</th>
          <th style="width:24mm">Mã BQMS</th>
          <th>Quy cách</th>
          <th style="width:16mm">SL đặt</th>
          <th style="width:12mm">ĐVT</th>
          <th style="width:26mm">Đơn giá</th>
          <th style="width:28mm">Thành tiền</th>
        </tr>
      </thead>
      <tbody>
        {rows_html}
      </tbody>
    </table>
    <table class="items" style="margin-top:0">
      <tr class="grand"><td class="r" style="border:none">TỔNG CỘNG ({currency})</td><td class="r" style="width:28mm">{_fmt_money(total)}</td></tr>
    </table>
    <div class="words">Bằng chữ: {_esc(words)}.</div>
  </div>

  <div class="section terms">
    <div class="section-title">Điều kiện</div>
    <div class="row"><div class="k">Địa chỉ giao hàng</div><div class="v">{_esc(po.get('delivery_address') or 'Theo thoả thuận')}</div></div>
    <div class="row"><div class="k">Hạn giao yêu cầu</div><div class="v">{_fmt_date(po.get('requested_delivery_date')) or 'Theo thoả thuận'}</div></div>
    {notes_row}
  </div>

  <div class="sign">
    <div class="box">
      <div class="title">ĐẠI DIỆN BÊN BÁN — NHÀ CUNG CẤP</div>
      <div class="hint">(Ký, ghi rõ họ tên)</div>
    </div>
    <div class="box">
      <div class="title">ĐẠI DIỆN BÊN MUA — SONG CHÂU</div>
      <div class="hint">(Ký, ghi rõ họ tên, đóng dấu)</div>
    </div>
  </div>
</div>
</body>
</html>"""


def _po_pdf_relpath(po_no: str) -> str:
    safe = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in str(po_no))
    return f"po_pdfs/{safe}.pdf"


async def generate_po_pdf(conn: asyncpg.Connection, po_id: int) -> str:
    """Fetch PO + items, render ĐƠN ĐẶT HÀNG PDF under FILES_BASE_PATH. Returns rel path.

    On-demand (no DB column): the endpoint re-renders fresh each download.
    """
    po = await conn.fetchrow(
        """SELECT p.*, c.contract_no
             FROM procurement_pos p
             LEFT JOIN procurement_contracts c ON c.id = p.contract_id
            WHERE p.id = $1""",
        po_id,
    )
    if not po:
        raise ValueError(f"PO {po_id} not found")
    items = await conn.fetch(
        "SELECT * FROM procurement_po_items WHERE po_id = $1 ORDER BY item_no", po_id,
    )
    po_d = dict(po)
    items_d = [dict(i) for i in items]
    rel = _po_pdf_relpath(po_d.get("po_no") or f"po-{po_id}")
    out_abs = os.path.join(settings.FILES_BASE_PATH, rel)
    html_str = render_po_html(po_d, items_d)
    # Atomic write (see generate_delivery_note_pdf): temp + os.replace.
    tmp_abs = f"{out_abs}.{os.getpid()}.tmp"
    await convert_html_to_pdf(html_str, tmp_abs)
    os.replace(tmp_abs, out_abs)
    logger.info("Generated PO PDF for #%s -> %s", po_id, out_abs)
    return rel
