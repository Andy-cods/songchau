"""Samsung BQMS Register Delivery + P/O Receipt scraper for dossier feature.

Flow:
  1. Login (reuse pattern from bqms_mro_scraper)
  2. Navigate `/bqms/mro/forward/vendor/grCreateDelivery.do`
  3. Set 90-day date range + paste PO list → click `a.btn_search`
  4. Verify grid has expected rows → tick rows matching (po_number, po_seq)
     via dhtmlxGrid API: `g.cells(rid, 1).setValue(1)` (col 1 = row checkbox)
  5. Click `a#btnCreate` → popup opens (window OR modal — handle both)
  6. Fill popup header form (Vendor Invoice No, Invoice Date, ETD,
     Packing Qty/Unit, Volume, Gross Weight, Remark)
  7. Fill per-item Shipping Qty in popup grid
  8. Click submit (Save / Create Delivery in popup)
  9. After save: click "Delivery Note" → expect_download → save Invoice PDF
  10. Per PO: navigate `/bqms/mro/forward/vendor/vendorPoConfirm.do`,
      search → click PO link → expect_download → save Purchase Order PDF

Confirmed selectors (from recon v1-v8):
  - Input filters: #srchFromDate #srchToDate (readonly, JS .value=),
    #srchPoNos, #srchCondType, #srchCompanyCode (C5H0=SEV, C5H2=SEVT),
    #srchBqmsCode, #srchDocType
  - Search button: a.btn_search
  - Create Delivery button: a#btnCreate
  - Grid var (window): `globalActiveDHTMLGridObject`
  - Row checkbox: col index 1 (dhtmlxGrid eXcell_ch type)
  - Login: page.evaluate("login()") after fill #id #pass

TODO at runtime (will refine via e2e tests):
  - Popup detection: try context.expect_page() first, fall back to in-page
    modal detection (div with input form). Tickrow → click btnCreate sequence.
  - Popup form field IDs: discover at e2e test (placeholders in code below).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

REGISTER_DELIVERY_URL = "/bqms/mro/forward/vendor/grCreateDelivery.do?target=vendor"
PO_RECEIPT_URL = "/bqms/mro/forward/vendor/vendorPoConfirm.do?target=vendor"


async def run_dossier_scrape(
    *,
    po_items: list[dict],   # [{po_number, po_seq, bqms_code, shipping_qty}, ...]
    company_code: str,       # "C5H0" (SEV) or "C5H2" (SEVT)
    vendor_invoice_no: str,
    invoice_date: str,       # YYYY-MM-DD
    etd: str,                # YYYY-MM-DD
    packing_qty: float,
    packing_unit: str,       # "Box"
    volume: float,
    volume_unit: str,        # "M3"
    gross_weight: float,
    weight_unit: str,        # "KG"
    remark: str,
    shipping_manager: str,
    work_dir: Path,
    progress_cb=None,
    confirm_cb=None,
    confirm_screenshot_path: Path | None = None,
) -> dict:
    """Run the full dossier scrape end-to-end.

    Returns:
        {
            success: bool,
            invoice_pdf: Path,
            po_pdfs: [{po: str, path: Path, status: str}, ...],
            shipping_no: str | None,   # extracted later by caller via pdf_parser
            warnings: list[str],
            errors: list[str],
            cancelled: bool,           # True if user huỷ tại checkpoint (không tạo Delivery)
        }

    confirm_cb (optional async callable): nếu cung cấp, sau khi điền xong popup
        Create Delivery (PHASE E) nhưng TRƯỚC khi bấm Save (PHASE F), scraper sẽ
        gọi `decision = await confirm_cb(preview)` để chờ user kiểm tra 100% và
        xác nhận. `preview` là dict {screenshot, header{}, items[], warnings[]}.
        decision ∈ {'confirm', 'cancel', 'timeout'}. confirm → bấm Save; cancel /
        timeout → đóng popup không lưu (an toàn, không tạo Delivery thật).
    confirm_screenshot_path (optional): nơi lưu screenshot popup đã điền cho
        checkpoint (mặc định work_dir / 'confirm_preview.png').
    """
    from playwright.async_api import async_playwright
    from app.core.config import settings
    from app.services.bqms_credentials import get_bqms_credentials

    base = (settings.BQMS_BASE_URL or "https://www.sec-bqms.com").rstrip("/")
    user, pwd = get_bqms_credentials()
    if not user or not pwd:
        raise RuntimeError("BQMS_USERNAME / BQMS_PASSWORD missing in settings")

    out: dict = {
        "success": False,
        "invoice_pdf": None,
        "po_pdfs": [],
        "warnings": [],
        "errors": [],
        "cancelled": False,
    }
    work_dir.mkdir(parents=True, exist_ok=True)

    def _progress(pct: int, step: str) -> None:
        logger.info("[dossier-scrape] %d%% %s", pct, step)
        if progress_cb:
            try:
                progress_cb(pct, step)
            except Exception:
                pass

    distinct_pos: list[str] = []
    for it in po_items:
        po = (it.get("po_number") or "").strip()
        if po and po not in distinct_pos:
            distinct_pos.append(po)

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-popup-blocking",  # Samsung dùng window.open cho popup Create Delivery
            ],
        )
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            accept_downloads=True,
        )
        # Dialog message CAPTURE (Thang 2026-06-25 false-success fix): record every
        # native dialog (confirm + alert) text into a SHARED list so PHASE F can
        # inspect Samsung's post-save alert. Declared in outer scope so the main
        # page handler AND every popup handler append to the SAME list.
        captured_dialogs: list[dict] = []

        async def _capture_and_accept(d):
            captured_dialogs.append({"type": d.type, "message": d.message or ""})
            await d.accept()

        page = await ctx.new_page()
        page.on("dialog", lambda d: asyncio.create_task(_capture_and_accept(d)))

        # Auto-accept dialogs on ANY page in this context (popups inherit this).
        # Samsung popups show native confirm("Save?") + alert("Completed") that
        # block JS execution until handled.
        def _attach_dialog_handler(new_page):
            new_page.on("dialog", lambda d: asyncio.create_task(_capture_and_accept(d)))
        ctx.on("page", _attach_dialog_handler)

        # Helper: check if a page URL indicates Samsung session expired (login redirect)
        def _is_login_page(u: str) -> bool:
            if not u:
                return False
            u = u.lower()
            return "/vendorlogin.do" in u or "anonymous" in u

        async def _do_login():
            """Idempotent login — call when fresh or when session expired mid-flow."""
            await page.goto(
                f"{base}/bqms/vendorPortal/anonymous/vendorLogin.do?_frameF=true",
                wait_until="domcontentloaded", timeout=30000,
            )
            await page.fill("input#id", user)
            await page.fill("input#pass", pwd)
            await page.evaluate("login()")
            # Bug fix #5: more reliable wait — check URL doesn't contain anonymous/login
            # AND wait_for_function so JS-driven redirect after login completes
            await page.wait_for_function(
                "() => !location.href.toLowerCase().includes('anonymous') && "
                "!location.href.toLowerCase().includes('/vendorlogin')",
                timeout=30000,
            )

        try:
            # ============ PHASE A — LOGIN ============
            _progress(5, "Đăng nhập Samsung BQMS...")
            await _do_login()

            # ============ PHASE B — REGISTER DELIVERY SEARCH ============
            _progress(15, "Mở Register Delivery...")
            await page.goto(f"{base}{REGISTER_DELIVERY_URL}", wait_until="networkidle", timeout=45000)
            if _is_login_page(page.url):
                logger.warning("Session expired after navigate, re-login")
                await _do_login()
                await page.goto(f"{base}{REGISTER_DELIVERY_URL}", wait_until="networkidle", timeout=45000)
            # B4 perf: wait for filter form ready instead of fixed sleep
            try:
                await page.wait_for_selector("#srchFromDate, #srchPoNos", state="visible", timeout=10000)
            except Exception:
                await page.wait_for_timeout(2000)  # fallback

            # Set 90-day date range (P/O Date is default; readonly inputs → JS)
            from_dt = (datetime.now() - timedelta(days=90)).strftime("%m/%d/%Y")
            to_dt = datetime.now().strftime("%m/%d/%Y")
            await page.evaluate("""
                ([from_date, to_date]) => {
                    const f = document.getElementById('srchFromDate');
                    const t = document.getElementById('srchToDate');
                    if (f) { f.value = from_date; f.dispatchEvent(new Event('change', {bubbles:true})); }
                    if (t) { t.value = to_date; t.dispatchEvent(new Event('change', {bubbles:true})); }
                }
            """, [from_dt, to_dt])
            # Set Company filter
            try:
                await page.select_option("#srchCompanyCode", company_code)
            except Exception as exc:
                out["warnings"].append(f"set company filter failed: {exc}")
            # Paste PO numbers (comma-separated)
            po_list_str = ",".join(distinct_pos)
            await page.fill("#srchPoNos", po_list_str)
            _progress(20, f"Tìm {len(distinct_pos)} PO...")
            await page.click("a.btn_search")
            # B4 perf: wait for grid to populate instead of fixed 5s sleep
            try:
                await page.wait_for_function(
                    "() => { for (const k of Object.keys(window)) { try { const v = window[k]; "
                    "if (v && typeof v.getColumnIndex === 'function' && v.getColumnIndex('chk') >= 0 && v.getRowsNum() > 0) return true; } catch(e) {} } return false; }",
                    timeout=15000,
                )
            except Exception:
                await page.wait_for_timeout(2000)

            # Verify grid has rows
            grid_info = await page.evaluate("""
                () => {
                    const g = window.globalActiveDHTMLGridObject;
                    if (!g) return {err: 'no grid'};
                    return {rows: g.getRowsNum(), cols: g.getColumnsNum()};
                }
            """)
            if grid_info.get("err") or grid_info.get("rows", 0) == 0:
                out["errors"].append(
                    f"Search returned 0 rows for POs {distinct_pos}. "
                    "Có thể các PO đã giao hết / không thuộc Company đã chọn."
                )
                return out
            _progress(30, f"Tìm thấy {grid_info['rows']} dòng")

            # ============ PHASE C — TICK ROWS MATCHING (po, seq) ============
            wanted = [{"po": it["po_number"], "seq": str(it.get("po_seq", ""))} for it in po_items]
            # Find the correct dhtmlxGrid instance — it's the one with col "chk".
            # `globalActiveDHTMLGridObject` may point to a different grid
            # (login notification popup). Scan window for grid with col 'chk'.
            grid_var_name = await page.evaluate("""
                () => {
                    // Pick the grid with the MOST rows (avoids a stray/empty grid widget
                    // when several dhtmlxGrid instances exist on the page).
                    let best_grid = null, max_rows = 0;
                    for (const k of Object.keys(window)) {
                        try {
                            const v = window[k];
                            if (v && typeof v.getColumnIndex === 'function' && typeof v.getRowsNum === 'function') {
                                const chkIdx = v.getColumnIndex('chk');
                                const rows = v.getRowsNum();
                                if (chkIdx >= 0 && rows > 0 && rows > max_rows) {
                                    best_grid = k;
                                    max_rows = rows;
                                }
                            }
                        } catch(e) {}
                    }
                    return best_grid;
                }
            """)
            logger.info("Grid var found: %s", grid_var_name)
            if not grid_var_name:
                out["errors"].append("Không tìm thấy grid var có col 'chk' và có rows > 0")
                return out

            # Get row IDs to tick (using the correct grid var)
            # grid_var passed as a JS ARG (not f-string) to avoid injection; po/seq
            # trimmed before compare (whitespace padding). Match keeps permissive seq:
            # if an item has no seq, match any row for that PO (unchanged behavior).
            rows_to_tick = await page.evaluate("""
                ([wanted, grid_var]) => {
                    const g = window[grid_var];
                    if (!g) return {err: 'no grid'};
                    const total = g.getRowsNum();
                    const poIdx = g.getColumnIndex('poNo');
                    const seqIdx = g.getColumnIndex('poSeq');
                    const out = {to_tick: [], rows_seen: [], po_col: poIdx, seq_col: seqIdx, total: total};
                    for (let r = 0; r < total; r++) {
                        const rid = g.getRowId(r);
                        const po = String(g.cells(rid, poIdx).getValue() || '').trim();
                        const seq = String(g.cells(rid, seqIdx).getValue() || '').trim();
                        out.rows_seen.push({rid, po, seq});
                        if (wanted.some(w => w.po === po && (!w.seq || w.seq === seq))) {
                            out.to_tick.push(rid);
                        }
                    }
                    return out;
                }
            """, [wanted, grid_var_name])
            logger.info("Rows to tick (via %s): %s", grid_var_name, rows_to_tick)

            # Tick rows — page source xác nhận:
            #   - Header col 0 = Id:"chk" Type:"check" (master checkbox)
            #   - g.getColumnIndex("chk") trả về index col chứa checkbox
            #   - mro.openCreatePop() validate via g.getCheckedRows(chkIdx)
            #   - Popup mở qua window.open() → cần ctx.expect_page() để bắt
            tick_result = {"ticked": 0, "errors": [], "grid_var": grid_var_name}
            for rid in rows_to_tick.get("to_tick", []):
                # Pass rid + grid_var_name safely as JS args (avoid f-string injection bugs
                # when rid is non-numeric like "row_001")
                bbox = await page.evaluate(
                    """
                    ([grid_var, rid]) => {
                        const g = window[grid_var];
                        const chkIdx = g.getColumnIndex('chk');
                        const cell = g.cells(rid, chkIdx);
                        if (!cell || !cell.cell) return null;
                        const img = cell.cell.querySelector('img');
                        if (!img) return null;
                        img.scrollIntoView({block: 'center', inline: 'center'});
                        const r = img.getBoundingClientRect();
                        return {
                            x: r.x + r.width/2, y: r.y + r.height/2,
                            src_before: img.src.split('/').pop(),
                            chkIdx: chkIdx,
                        };
                    }
                    """,
                    [grid_var_name, rid],
                )
                if not bbox:
                    tick_result["errors"].append(f"row {rid}: no bbox")
                    continue
                logger.info("Row %s bbox: %s", rid, bbox)
                # Native mouse click — fires real MouseEvent with all handlers
                await page.mouse.click(bbox["x"], bbox["y"])
                # Wait until the row is actually checked (state-based) instead of a
                # blind 700ms — more reliable on slow loads; fall back to 700ms.
                try:
                    await page.wait_for_function(
                        "([grid_var, rid]) => { const g = window[grid_var]; const chkIdx = g.getColumnIndex('chk'); const checked = g.getCheckedRows(chkIdx) || ''; return checked.split(',').includes(String(rid)); }",
                        [grid_var_name, rid],
                        timeout=5000,
                    )
                except Exception:
                    await page.wait_for_timeout(700)
                # Verify via grid API getCheckedRows
                after = await page.evaluate(
                    """
                    ([grid_var, rid]) => {
                        const g = window[grid_var];
                        const chkIdx = g.getColumnIndex('chk');
                        const checked = g.getCheckedRows(chkIdx);
                        const cell = g.cells(rid, chkIdx);
                        const img = cell && cell.cell ? cell.cell.querySelector('img') : null;
                        return {
                            checked_rows: checked,
                            is_in_checked: checked && checked.split(',').includes(String(rid)),
                            img_src: img ? img.src.split('/').pop() : null,
                        };
                    }
                    """,
                    [grid_var_name, rid],
                )
                logger.info("Row %s after click: %s", rid, after)
                if after.get("is_in_checked"):
                    tick_result["ticked"] += 1
                else:
                    tick_result["errors"].append(f"row {rid}: not in checked_rows. state={after}")

            await page.wait_for_timeout(800)
            await page.screenshot(path=str(work_dir / "after_tick.png"), full_page=True)
            logger.info("Tick result: %s", tick_result)
            logger.info("Tick result: %s", tick_result)
            if tick_result.get("ticked", 0) == 0:
                out["errors"].append(
                    f"Không tick được row nào. Wanted: {wanted}, "
                    f"seen: {tick_result.get('rows_seen', [])[:5]}"
                )
                return out

            # ============ PHASE D — CLICK CREATE DELIVERY ============
            _progress(40, f"Tick xong {tick_result['ticked']} dòng, mở Create Delivery...")
            await page.screenshot(path=str(work_dir / "before_create.png"), full_page=True)

            # Click btnCreate — page source xác nhận handler là:
            #   $("#btnCreate").click(() => mro.openCreatePop())
            # openCreatePop() validate getCheckedRows + gọi mroPopup.openPop(url)
            # = window.open(url, name, options) → opens new TAB/WINDOW.
            # Playwright bắt qua ctx.expect_page().
            popup_page = None
            try:
                # Try jQuery click (because handler is registered via $.click)
                async with ctx.expect_page(timeout=15000) as pop_info:
                    await page.evaluate("""
                        () => {
                            const btn = document.getElementById('btnCreate');
                            if (!btn) throw new Error('btnCreate not found');
                            if (btn.disabled || btn.classList.contains('disabled')) {
                                throw new Error('btnCreate is disabled');
                            }
                            // Single trigger only (jQuery click handler -> mro.openCreatePop);
                            // do NOT also dispatch a native MouseEvent or 2 popups open.
                            if (typeof window.jQuery !== 'undefined') {
                                window.jQuery(btn).trigger('click');
                            } else {
                                btn.click();
                            }
                        }
                    """)
                popup_page = await pop_info.value
                logger.info("Popup window opened: %s", popup_page.url)
                await popup_page.wait_for_load_state("domcontentloaded", timeout=20000)
                await popup_page.wait_for_timeout(3000)
                target_page = popup_page
            except Exception as exc:
                logger.warning("expect_page failed: %s", exc)
                # Maybe validate failed silently. Check alert dialog or check rows again.
                debug_state = await page.evaluate("""
                    () => {
                        const g = window.globalActiveDHTMLGridObject;
                        const chkIdx = g ? g.getColumnIndex('chk') : -1;
                        const checked = g ? g.getCheckedRows(chkIdx) : null;
                        return {
                            chk_col_idx: chkIdx,
                            checked_rows: checked,
                            rows_total: g ? g.getRowsNum() : 0,
                        };
                    }
                """)
                logger.warning("State after btnCreate click: %s", debug_state)
                out["errors"].append(f"Popup không mở. {exc}. State: {debug_state}")
                await page.screenshot(path=str(work_dir / "popup_fail.png"), full_page=True)
                return out


            # ============ PHASE E — FILL POPUP FORM ============
            # Wait for popup auto-search to complete (mro.init() → mro.search() → grid fills)
            _progress(45, "Chờ popup load grid...")
            try:
                await target_page.wait_for_function(
                    "() => window.grid && typeof window.grid.getRowsNum === 'function' && window.grid.getRowsNum() > 0",
                    timeout=20000,
                )
            except Exception as exc:
                logger.warning("Popup grid không có rows sau 20s: %s", exc)
                await target_page.screenshot(path=str(work_dir / "popup_grid_empty.png"))
                # Continue — maybe rows came in a different way

            _progress(50, "Điền form Create Delivery...")

            # Source confirmed: localeDateFormat = "M/d/yyyy" (no zero-pad)
            def _to_us_date(s: str) -> str:
                if not s:
                    return ""
                try:
                    dt = datetime.strptime(s, "%Y-%m-%d")
                    return f"{dt.month}/{dt.day}/{dt.year}"
                except Exception:
                    return s

            # --- Risk mitigation A: fetch packingUnit options + pick valid ---
            packing_unit_options = await target_page.evaluate(
                """
                () => {
                    const sel = document.getElementById('packingUnit');
                    if (!sel) return null;
                    return Array.from(sel.options).map(o => ({val: o.value, txt: (o.textContent||'').trim()}));
                }
                """
            )
            logger.info("packingUnit options: %s", packing_unit_options)
            out["debug_packing_unit_options"] = packing_unit_options

            chosen_packing_unit = None
            if packing_unit_options:
                wanted_upper = (packing_unit or "").upper().strip()
                # 1) Exact match on value (case-insensitive)
                for o in packing_unit_options:
                    if (o.get("val") or "").upper() == wanted_upper:
                        chosen_packing_unit = o["val"]
                        break
                # 2) Match on text
                if not chosen_packing_unit:
                    for o in packing_unit_options:
                        if (o.get("txt") or "").upper() == wanted_upper:
                            chosen_packing_unit = o["val"]
                            break
                # 3) First non-empty value — LAST RESORT, surface a warning so a
                #    wrong Packing Unit doesn't pass silently.
                if not chosen_packing_unit:
                    for o in packing_unit_options:
                        if o.get("val"):
                            chosen_packing_unit = o["val"]
                            break
                    if chosen_packing_unit:
                        msg = (f"Packing Unit '{packing_unit}' không khớp options "
                               f"{[o.get('val') for o in packing_unit_options]} — dùng tạm '{chosen_packing_unit}'")
                        logger.error(msg)
                        out["warnings"].append(msg)

            # --- Risk mitigation B: pre-validate qty <= residualQty + read grid state ---
            grid_state = await target_page.evaluate(
                """
                () => {
                    const g = window.grid;
                    if (!g) return {err: 'no grid'};
                    const colIdx = (id) => g.getColumnIndex(id);
                    const iPo = colIdx('poNo'), iSeq = colIdx('poSeq'),
                          iCode = colIdx('itemCode'), iQty = colIdx('deliveryQty'),
                          iRes = colIdx('residualQty'), iImg = colIdx('itemImgYn'),
                          iType = colIdx('ITEM_TYPE'), iPoDt = colIdx('poDate');
                    const rows = [];
                    const total = g.getRowsNum();
                    for (let r = 0; r < total; r++) {
                        const rid = g.getRowId(r);
                        rows.push({
                            rid,
                            poNo: String(g.cells(rid, iPo).getValue() || ''),
                            poSeq: String(g.cells(rid, iSeq).getValue() || ''),
                            itemCode: String(g.cells(rid, iCode).getValue() || ''),
                            residualQty: parseFloat(String(g.cells(rid, iRes).getValue() || '0').replace(/,/g, '')),
                            itemImgYn: iImg >= 0 ? String(g.cells(rid, iImg).getValue() || '') : '',
                            itemType: iType >= 0 ? String(g.cells(rid, iType).getValue() || '') : '',
                            poDate: iPoDt >= 0 ? String(g.cells(rid, iPoDt).getValue() || '') : '',
                        });
                    }
                    return {total, rows};
                }
                """
            )
            logger.info("Popup grid state: %s", grid_state)
            out["debug_grid_state"] = grid_state

            # Pre-validate: each (po, code) in po_items must have row in grid with shipping_qty ≤ residualQty
            qty_lookup = {(it["po_number"], it["bqms_code"]): float(it.get("shipping_qty", 0)) for it in po_items}
            validation_errors = []
            for row in grid_state.get("rows", []):
                key = (row["poNo"], row["itemCode"])
                if key not in qty_lookup:
                    continue
                wanted_qty = qty_lookup[key]
                if wanted_qty <= 0:
                    validation_errors.append(f"PO {row['poNo']} / {row['itemCode']}: shipping_qty phải > 0")
                elif wanted_qty > row["residualQty"]:
                    validation_errors.append(
                        f"PO {row['poNo']} / {row['itemCode']}: shipping_qty {wanted_qty} > residualQty {row['residualQty']}"
                    )
                # Image required check
                if row.get("itemImgYn") == "N" and row.get("itemType") != "PUNCHOUT":
                    po_dt = row.get("poDate") or ""
                    try:
                        po_dt_int = int(po_dt.replace("-", "").replace("/", "")) if po_dt else 99999999
                    except Exception:
                        po_dt_int = 99999999
                    if po_dt_int > 20150700:
                        validation_errors.append(
                            f"PO {row['poNo']} / {row['itemCode']}: chưa có ảnh trên Samsung (itemImgYn=N) — phải upload trước"
                        )

            if validation_errors:
                out["errors"].extend(validation_errors)
                out["errors"].append("Pre-validation failed — abort trước khi submit")
                await target_page.screenshot(path=str(work_dir / "pre_validate_fail.png"))
                return out

            # --- Fill non-mask fields via JS .value= (safe, fast) ---
            # civNo, invoiceDate, deliveryDate, deliveryRspId, remark — plain text
            field_values = {
                "civNo": vendor_invoice_no or "",
                "invoiceDate": _to_us_date(invoice_date),
                "deliveryDate": _to_us_date(etd),
                "deliveryRspId": shipping_manager or "AMA Bac Ninh JSC",
                "remark": remark or "",
            }
            fill_js_result = await target_page.evaluate(
                """
                (vals) => {
                    const out = {};
                    for (const [id, v] of Object.entries(vals)) {
                        const el = document.getElementById(id);
                        if (el) {
                            el.value = String(v);
                            el.dispatchEvent(new Event('input', {bubbles: true}));
                            el.dispatchEvent(new Event('change', {bubbles: true}));
                            out[id] = el.value;
                        } else {
                            out[id] = null;
                        }
                    }
                    return out;
                }
                """,
                field_values,
            )
            logger.info("JS-filled fields: %s", fill_js_result)

            # --- Risk mitigation C: inputmask fields → use page.fill() (clicks + types) ---
            # packingQty, volume, grossWeight have inputmask format `#,##0.0000` —
            # JS .value= alone may not bind properly. page.fill() emulates real typing.
            for mask_id, mask_val in [
                ("packingQty", str(packing_qty)),
                ("volume", str(volume)),
                ("grossWeight", str(gross_weight)),
            ]:
                try:
                    await target_page.locator(f"#{mask_id}").fill(mask_val, timeout=5000)
                    # Trigger change event after fill (some masks bind on blur)
                    await target_page.evaluate(
                        f"() => {{ const el = document.getElementById('{mask_id}'); "
                        f"if (el) el.dispatchEvent(new Event('change', {{bubbles: true}})); }}"
                    )
                    # READBACK VERIFY — inputmask may reformat/reject; warn on mismatch.
                    rb = await target_page.evaluate(
                        f"() => (document.getElementById('{mask_id}') || {{}}).value || ''"
                    )
                    try:
                        if abs(float(mask_val) - float(str(rb).replace(",", ""))) > 0.0001:
                            out["warnings"].append(f"Inputmask {mask_id}: gửi {mask_val} nhưng đọc lại {rb}")
                            logger.warning("Inputmask %s mismatch: sent %s got %s", mask_id, mask_val, rb)
                    except Exception:
                        pass
                except Exception as exc:
                    logger.warning("fill mask #%s failed: %s", mask_id, exc)
                    out["warnings"].append(f"fill {mask_id}={mask_val} failed: {exc}")

            # packingUnit SELECT — set chosen value
            if chosen_packing_unit:
                try:
                    await target_page.select_option("#packingUnit", chosen_packing_unit, timeout=5000)
                    logger.info("packingUnit selected: %s", chosen_packing_unit)
                except Exception as exc:
                    logger.warning("select packingUnit failed: %s", exc)
                    out["warnings"].append(f"select packingUnit={chosen_packing_unit} failed: {exc}")

            # Fill deliveryQty per row — normalize keys (trim) + READBACK VERIFY each set.
            qty_map_by_key = {
                f"{str(po or '').strip()}__{str(code or '').strip()}": qty
                for (po, code), qty in qty_lookup.items()
            }
            qty_fill_result = await target_page.evaluate(
                """
                (qty_map_by_key) => {
                    const g = window.grid;
                    if (!g) return {err: 'no popup grid'};
                    const qIdx = g.getColumnIndex('deliveryQty');
                    const codeIdx = g.getColumnIndex('itemCode');
                    const poIdx = g.getColumnIndex('poNo');
                    if (qIdx < 0 || codeIdx < 0 || poIdx < 0) {
                        return {err: `col idx invalid q=${qIdx} code=${codeIdx} po=${poIdx}`};
                    }
                    const out = {rows: g.getRowsNum(), filled: [], skipped: [], verify_fail: []};
                    for (let r = 0; r < out.rows; r++) {
                        const rid = g.getRowId(r);
                        const po = String(g.cells(rid, poIdx).getValue() || '').trim();
                        const code = String(g.cells(rid, codeIdx).getValue() || '').trim();
                        const key = `${po}__${code}`;
                        if (qty_map_by_key[key] != null) {
                            try {
                                g.cells(rid, qIdx).setValue(qty_map_by_key[key]);
                                const after = g.cells(rid, qIdx).getValue();
                                const afterNum = parseFloat(String(after || '0').replace(/,/g, ''));
                                const wantNum = parseFloat(String(qty_map_by_key[key]).replace(/,/g, ''));
                                if (Math.abs(afterNum - wantNum) < 0.001) {
                                    out.filled.push({rid, po, code, qty: qty_map_by_key[key], after});
                                } else {
                                    out.verify_fail.push({rid, po, code, sent: qty_map_by_key[key], readback: after});
                                }
                            } catch(e) { out.skipped.push({rid, po, code, err: String(e)}); }
                        } else {
                            out.skipped.push({rid, po, code, reason: 'no match'});
                        }
                    }
                    return out;
                }
                """,
                qty_map_by_key,
            )
            logger.info("Qty fill in popup: %s", qty_fill_result)
            for vf in (qty_fill_result.get("verify_fail") or []):
                msg = f"Shipping Qty không khớp sau khi điền: PO {vf['po']} / {vf['code']} gửi {vf['sent']} đọc lại {vf['readback']}"
                logger.warning(msg)
                out["warnings"].append(msg)
            out["debug_qty_fill"] = qty_fill_result

            await target_page.screenshot(path=str(work_dir / "popup_filled.png"), full_page=True)

            # ============ PHASE E2 — CHECKPOINT: CHỜ USER XÁC NHẬN ============
            # Trước khi bấm Save (KHÔNG HOÀN TÁC), đọc lại giá trị thực đã điền
            # trên popup + chụp screenshot + cảnh báo thiếu, rồi chờ user xác nhận.
            if confirm_cb is not None:
                _progress(58, "Chờ xác nhận trước khi tạo Delivery...")
                # Read back the ACTUAL values currently in the popup form + grid.
                readback = await target_page.evaluate(
                    """
                    () => {
                        const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '') : null; };
                        const sel = document.getElementById('packingUnit');
                        let packingUnitTxt = null;
                        if (sel && sel.selectedIndex >= 0) {
                            const o = sel.options[sel.selectedIndex];
                            packingUnitTxt = o ? (o.textContent || o.value || '').trim() : null;
                        }
                        const g = window.grid;
                        const rows = [];
                        if (g && typeof g.getRowsNum === 'function') {
                            const ci = (id) => g.getColumnIndex(id);
                            const ciAny = (...ids) => { for (const id of ids) { const x = ci(id); if (x >= 0) return x; } return -1; };
                            const numv = (rid, idx) => idx >= 0
                                ? parseFloat(String(g.cells(rid, idx).getValue() || '0').replace(/,/g, '')) : null;
                            const strv = (rid, idx) => idx >= 0 ? String(g.cells(rid, idx).getValue() || '') : null;
                            const iPo = ci('poNo'), iSeq = ci('poSeq'), iCode = ci('itemCode'),
                                  iQty = ci('deliveryQty'), iRes = ci('residualQty');
                            // Extra columns (Thang 2026-06-25): mirror Samsung popup grid so the
                            // checkpoint table shows P/O Qty + Accumulate + Item Images. ciAny()
                            // tries multiple ids; missing → null (best-effort, never crashes).
                            const iPoQty  = ciAny('poQty', 'PO_QTY'),
                                  iSumDel = ciAny('sumDeliveryQty', 'accumDeliveryQty', 'accumulateQty', 'accumQty'),
                                  iImg    = ciAny('itemImgYn', 'ITEM_IMG_YN'),
                                  iType   = ciAny('ITEM_TYPE', 'itemType'),
                                  iPoDt   = ciAny('poDate', 'PO_DATE'),
                                  iC1 = ciAny('category1Name', 'category1'),
                                  iC2 = ciAny('category2Name', 'category2'),
                                  iC3 = ciAny('category3Name', 'category3'),
                                  iC4 = ciAny('category4Name', 'category4');
                            for (let r = 0; r < g.getRowsNum(); r++) {
                                const rid = g.getRowId(r);
                                const qty = parseFloat(String(g.cells(rid, iQty).getValue() || '0').replace(/,/g, ''));
                                if (!qty) continue;  // chỉ show row có deliveryQty > 0
                                rows.push({
                                    po: String(g.cells(rid, iPo).getValue() || ''),
                                    seq: String(g.cells(rid, iSeq).getValue() || ''),
                                    code: String(g.cells(rid, iCode).getValue() || ''),
                                    deliveryQty: qty,
                                    residualQty: parseFloat(String(g.cells(rid, iRes).getValue() || '0').replace(/,/g, '')),
                                    poQty: numv(rid, iPoQty),
                                    sumDeliveryQty: numv(rid, iSumDel),
                                    itemImgYn: strv(rid, iImg),
                                    itemType: strv(rid, iType),
                                    poDate: strv(rid, iPoDt),
                                    category1: strv(rid, iC1),
                                    category2: strv(rid, iC2),
                                    category3: strv(rid, iC3),
                                    category4: strv(rid, iC4),
                                });
                            }
                        }
                        return {
                            civNo: val('civNo'),
                            invoiceDate: val('invoiceDate'),
                            deliveryDate: val('deliveryDate'),
                            deliveryRspId: val('deliveryRspId'),
                            remark: val('remark'),
                            packingQty: val('packingQty'),
                            packingUnit: packingUnitTxt,
                            volume: val('volume'),
                            grossWeight: val('grossWeight'),
                            rows,
                        };
                    }
                    """
                )
                logger.info("Confirm checkpoint readback: %s", readback)

                # Build warnings for missing / suspicious params.
                warns: list[str] = []
                if not (readback.get("civNo") or "").strip():
                    warns.append("Vendor Invoice No (civNo) đang trống")
                if not (readback.get("invoiceDate") or "").strip():
                    warns.append("Invoice Date đang trống")
                if not (readback.get("deliveryDate") or "").strip():
                    warns.append("ETD / Delivery Date đang trống")
                try:
                    if float(readback.get("packingQty") or 0) <= 0:
                        warns.append("Packing Qty ≤ 0")
                except Exception:
                    warns.append("Packing Qty không hợp lệ")
                rb_rows = readback.get("rows") or []
                if not rb_rows:
                    warns.append("Không có dòng nào có Shipping Qty > 0")
                for rr in rb_rows:
                    if rr.get("deliveryQty", 0) > rr.get("residualQty", 0):
                        warns.append(
                            f"PO {rr.get('po')} / {rr.get('code')}: Shipping Qty {rr.get('deliveryQty')} > còn lại {rr.get('residualQty')}"
                        )
                # Items đã chọn nhưng không khớp row nào trong popup
                rb_keys = {(rr.get("po"), rr.get("code")) for rr in rb_rows}
                for it in po_items:
                    if (it.get("po_number"), it.get("bqms_code")) not in rb_keys:
                        warns.append(
                            f"PO {it.get('po_number')} / {it.get('bqms_code')}: chưa điền được Shipping Qty trên popup"
                        )

                # Screenshot dành riêng cho checkpoint (để frontend hiển thị).
                shot_path = confirm_screenshot_path or (work_dir / "confirm_preview.png")
                try:
                    Path(shot_path).parent.mkdir(parents=True, exist_ok=True)
                    # Thang 2026-06-25: the Delivery Item dhtmlxGrid scrolls horizontally
                    # inside a fixed-width popup, so full_page screenshot CLIPS every column
                    # past "Category 1". Before capturing, widen the popup viewport AND expand
                    # the grid + its scroll ancestors to the full content width so ALL columns
                    # render. Best-effort (wrapped) — never blocks the checkpoint.
                    try:
                        # Wide enough to render the Delivery Item grid through Category 4
                        # (full_page captures full HEIGHT but only viewport WIDTH).
                        await target_page.set_viewport_size({"width": 2560, "height": 1100})
                    except Exception:
                        pass
                    try:
                        expand_res = await target_page.evaluate("""() => {
                            try {
                                const g = window.grid;
                                const obj = (g && g.obj) || document.querySelector('.gridbox, [class*=gridbox]');
                                if (!obj) return 'no-grid';
                                let el = obj, sw = 0;
                                for (let i = 0; i < 5 && el; i++) { sw = Math.max(sw, el.scrollWidth || 0); el = el.parentElement; }
                                let node = obj;
                                for (let i = 0; i < 5 && node; i++) {
                                    node.style.width = (sw + 30) + 'px';
                                    node.style.maxWidth = 'none';
                                    node.style.overflow = 'visible';
                                    node = node.parentElement;
                                }
                                if (g && typeof g.setSizes === 'function') { try { g.setSizes(); } catch(e){} }
                                return 'expanded:' + sw;
                            } catch(e) { return 'err:' + e; }
                        }""")
                        logger.info("confirm grid-expand: %s", expand_res)
                        await target_page.wait_for_timeout(600)
                    except Exception as exc:
                        logger.warning("confirm grid-expand failed: %s", exc)
                    await target_page.screenshot(path=str(shot_path), full_page=True)
                except Exception as exc:
                    logger.warning("confirm screenshot failed: %s", exc)

                preview = {
                    "screenshot": Path(shot_path).name,
                    "header": {
                        "Vendor Invoice No": readback.get("civNo"),
                        "Invoice Date": readback.get("invoiceDate"),
                        "ETD / Delivery Date": readback.get("deliveryDate"),
                        "Shipping Manager": readback.get("deliveryRspId"),
                        "Packing Qty": readback.get("packingQty"),
                        "Packing Unit": readback.get("packingUnit"),
                        "Volume (M3)": readback.get("volume"),
                        "Gross Weight (KG)": readback.get("grossWeight"),
                        "Remark": readback.get("remark"),
                    },
                    "items": rb_rows,
                    "warnings": warns,
                }

                try:
                    decision = await confirm_cb(preview)
                except Exception as exc:
                    logger.warning("confirm_cb raised: %s — treat as cancel", exc)
                    decision = "cancel"
                logger.info("Confirm checkpoint decision: %s", decision)

                if decision != "confirm":
                    # Đóng popup KHÔNG lưu → không tạo Delivery thật.
                    out["cancelled"] = True
                    out["cancel_reason"] = "timeout" if decision == "timeout" else "user_cancel"
                    try:
                        if popup_page and not popup_page.is_closed():
                            await popup_page.close()
                    except Exception:
                        pass
                    msg = ("Hết thời gian chờ xác nhận (5 phút) — đã huỷ, không tạo Delivery"
                           if decision == "timeout"
                           else "User đã huỷ tại bước kiểm tra — không tạo Delivery")
                    out["warnings"].append(msg)
                    return out
                _progress(60, "Đã xác nhận — submit Create Delivery...")

            # ============ PHASE F — SUBMIT CREATE DELIVERY ============
            _progress(60, "Submit Create Delivery...")
            # Source confirmed: $("#btnSave").click() → mro.save() → confirm → POST saveDelivery
            # → alert success → location.href change (popup reloads with deliverySeq)
            popup_url_before = target_page.url

            # False-success fix: capture deliverySeq BEFORE save (create flow = empty/None).
            # A genuine save assigns a NEW deliverySeq; a stale one means the save did NOT
            # commit. We clear the dialog list right before the click so only THIS submit's
            # alerts are inspected.
            delivery_seq_before = await target_page.evaluate(
                "() => (document.getElementById('deliverySeq') || {}).value || null"
            )
            logger.info("deliverySeq before submit: %s", delivery_seq_before)
            captured_dialogs.clear()

            try:
                # Trigger save — dialogs auto-accepted by ctx handler
                await target_page.evaluate(
                    """
                    () => {
                        if (typeof window.jQuery !== 'undefined') {
                            window.jQuery('#btnSave').trigger('click');
                        } else {
                            document.getElementById('btnSave').click();
                        }
                    }
                    """
                )
            except Exception as exc:
                out["errors"].append(f"Submit btnSave click failed: {exc}")
                await target_page.screenshot(path=str(work_dir / "submit_fail.png"))
                return out

            # Wait for popup URL change (location.href = "...&deliverySeq=NEW&...")
            # Or wait for popup to reload with new deliverySeq param
            new_delivery_seq = None
            new_secure_key = None
            url_change_ok = False
            for _ in range(45):
                await target_page.wait_for_timeout(1000)
                try:
                    cur_url = target_page.url
                    if cur_url != popup_url_before and "deliverySeq=" in cur_url:
                        # Parse deliverySeq + secureKey
                        from urllib.parse import urlparse, parse_qs
                        q = parse_qs(urlparse(cur_url).query)
                        new_delivery_seq = (q.get("deliverySeq", [""])[0] or "").strip()
                        new_secure_key = (q.get("secureKey", [""])[0] or "").strip()
                        if new_delivery_seq:
                            url_change_ok = True
                            logger.info("Popup reloaded: deliverySeq=%s", new_delivery_seq)
                            break
                except Exception:
                    pass
            if not url_change_ok:
                # Maybe still on old URL but save was successful (sometimes Samsung doesn't navigate
                # but just calls mro.search() to refresh). Check mode + btnInvoiceDownload visibility.
                state = await target_page.evaluate(
                    """
                    () => ({
                        url: location.href,
                        mode: window.mode || null,
                        delSeq: (document.getElementById('deliverySeq') || {}).value || null,
                        btnInvVisible: (() => {
                            const el = document.getElementById('btnInvoiceDownload');
                            return el ? el.offsetParent !== null : false;
                        })(),
                    })
                    """
                )
                logger.warning("URL did not change. State: %s", state)
                new_delivery_seq = state.get("delSeq") or None

                # ===== False-success verification (Thang 2026-06-25) =====
                # GROUND TRUTH of a committed save = a NEW deliverySeq appeared. A stale
                # seq (== before-submit) or empty seq means the save did NOT commit —
                # exactly the bug that let a job "succeed" without a real delivery.
                # Samsung error alerts are auto-accepted, so we ALSO scan captured dialog
                # text — but only to ENRICH the message. The deliverySeq stays the arbiter
                # so a benign warning can't false-FAIL a real save (→ duplicate delivery).
                seq_committed = bool(new_delivery_seq and new_delivery_seq != delivery_seq_before)
                err_kw = ('error', 'fail', 'cannot', 'invalid', 'lỗi', 'thất bại',
                          'không thể', 'không hợp lệ', '오류', '실패', '错误', '失败', '无法')
                ok_kw = ('success', 'complete', 'thành công', 'hoàn tất', '완료', '成功', '完成')
                error_dialogs = [
                    d for d in captured_dialogs
                    if (m := (d.get("message") or "").lower())
                    and any(k in m for k in err_kw) and not any(k in m for k in ok_kw)
                ]
                if not seq_committed:
                    msg = (f"Save KHÔNG thành công — deliverySeq không đổi "
                           f"(trước={delivery_seq_before}, sau={new_delivery_seq}).")
                    if error_dialogs:
                        msg += " Samsung báo: " + " | ".join(
                            (d.get("message") or "")[:160] for d in error_dialogs)
                    out["errors"].append(msg)
                    logger.warning("Submit NOT committed: %s", msg)
                    await target_page.screenshot(path=str(work_dir / "submit_no_navigate.png"))
                    return out
                if error_dialogs:
                    # Committed (new seq) but Samsung also showed an alert → warn, don't fail.
                    out.setdefault("warnings", []).append(
                        "Samsung hiện alert khi lưu (delivery vẫn được tạo): "
                        + " | ".join((d.get("message") or "")[:160] for d in error_dialogs))
                logger.info("Save OK (deliverySeq mới: %s -> %s)", delivery_seq_before, new_delivery_seq)

            await target_page.wait_for_timeout(3000)  # let popup finish reloading
            await target_page.screenshot(path=str(work_dir / "after_submit.png"), full_page=True)
            out["delivery_seq"] = new_delivery_seq

            # ============ PHASE G — DOWNLOAD DELIVERY NOTE (INVOICE PDF) ============
            _progress(70, "Tải Delivery Note (Invoice)...")
            invoice_path = work_dir / "DeliveryNote.pdf"

            # Approach A — call mro.download() directly via evaluate (skips waiting btn visible)
            # Approach B — direct fetch fallback if expect_download times out
            download_caught = False
            try:
                async with target_page.expect_download(timeout=25000) as dl_info:
                    await target_page.evaluate(
                        """
                        () => {
                            if (typeof window.mro !== 'undefined' && typeof window.mro.download === 'function') {
                                window.mro.download();
                                return true;
                            }
                            // Fallback: click btnInvoiceDownload via jQuery
                            const el = document.getElementById('btnInvoiceDownload');
                            if (el) {
                                if (typeof window.jQuery !== 'undefined') {
                                    window.jQuery(el).trigger('click');
                                } else { el.click(); }
                                return true;
                            }
                            return false;
                        }
                        """
                    )
                dl = await dl_info.value
                await dl.save_as(str(invoice_path))
                download_caught = True
                out["invoice_pdf"] = str(invoice_path)
                logger.info("Invoice saved via expect_download: %s", invoice_path)
            except Exception as exc:
                logger.warning("expect_download timed out (%s) — falling back to direct fetch", exc)

            # Approach B — direct POST fetch with session cookies if Approach A failed
            if not download_caught and new_delivery_seq:
                try:
                    from urllib.parse import quote
                    # mro.download() body shape:
                    # {grSearchVO: {srchDeliverySeq: X, secureKey: encodeURIComponent(Y)}}
                    payload = {
                        "grSearchVO": {
                            "srchDeliverySeq": new_delivery_seq,
                            "secureKey": quote(new_secure_key or "", safe=""),
                        }
                    }
                    api_url = f"{base}/bqms/mro/general/GR/deliveryInvoicePDF.do"
                    logger.info("Direct fetch %s payload=%s", api_url, payload)
                    resp = await target_page.request.post(
                        api_url,
                        data=json.dumps(payload),
                        headers={"Content-Type": "application/json; charset=UTF-8"},
                        timeout=45000,
                    )
                    if resp.ok:
                        body = await resp.body()
                        if body and len(body) > 1024 and body[:4] == b"%PDF":
                            invoice_path.write_bytes(body)
                            out["invoice_pdf"] = str(invoice_path)
                            download_caught = True
                            logger.info("Invoice saved via direct fetch: %s (%d bytes)", invoice_path, len(body))
                        else:
                            out["errors"].append(
                                f"Direct fetch returned non-PDF body (len={len(body) if body else 0})"
                            )
                    else:
                        out["errors"].append(f"Direct fetch HTTP {resp.status}: {await resp.text()}")
                except Exception as exc:
                    out["errors"].append(f"Direct fetch Delivery Note failed: {exc}")

            if not download_caught:
                await target_page.screenshot(path=str(work_dir / "delivery_note_fail.png"))

            # ============ PHASE H — DOWNLOAD PER-PO PURCHASE ORDER ============
            # Flow (Thang spec 2026-05-18):
            #   1. Navigate P/O Receipt page
            #   2. Fill PO No + click search → grid populates
            #   3. Click PO No cell value (anchor) → NEW WINDOW opens
            #   4. In new window: click "blue arrow" download icon → PDF downloads
            _progress(80, "Tải Purchase Order PDFs...")
            await page.goto(f"{base}{PO_RECEIPT_URL}", wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(3000)
            # Confirmed IDs (recon vendorPoConfirm.do 2026-05-18):
            #   srchStDate / srchEdDate (readonly), srchPoNo (singular), srchStatusName (text input),
            #   srchCompanySelect (SELECT: null=ALL, C5H2=SEVT, C5H0=SEV)
            from_dt_po = (datetime.now() - timedelta(days=365)).strftime("%m/%d/%Y")
            to_dt_po = datetime.now().strftime("%m/%d/%Y")
            await page.evaluate(f"""
                () => {{
                    const f = document.getElementById('srchStDate');
                    const t = document.getElementById('srchEdDate');
                    if (f) {{ f.value = '{from_dt_po}'; f.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                    if (t) {{ t.value = '{to_dt_po}'; t.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                    // Clear Status filter (default "Not Confirm" hides already-confirmed POs)
                    const st = document.getElementById('srchStatusName');
                    if (st) {{ st.value = ''; st.dispatchEvent(new Event('change',{{bubbles:true}})); }}
                }}
            """)
            # Company filter — `null` means -ALL-, C5H0=SEV, C5H2=SEVT
            try:
                await page.select_option("#srchCompanySelect", company_code, timeout=3000)
            except Exception:
                # Fall back to -ALL- if specific company code rejected
                try:
                    await page.select_option("#srchCompanySelect", "null", timeout=2000)
                except Exception:
                    pass

            for po in distinct_pos:
                po_pdf = work_dir / f"PurchaseOrder_{po}.pdf"
                po_popup = None
                try:
                    # ---- Step 1: Fill PO No + search ----
                    await page.evaluate(
                        f"""() => {{
                            const el = document.getElementById('srchPoNo');
                            if (el) {{
                                el.value = '{po}';
                                el.dispatchEvent(new Event('input',{{bubbles:true}}));
                                el.dispatchEvent(new Event('change',{{bubbles:true}}));
                            }}
                        }}"""
                    )
                    await page.locator("a.btn_search").first.click()
                    await page.wait_for_timeout(5000)

                    # Verify grid has rows + dump state for debug
                    # Recon confirmed: grid = globalActiveDHTMLGridObject, PO col id = 'PO_NO' (UPPERCASE)
                    po_grid_state = await page.evaluate(
                        """
                        (po) => {
                            let gridVar = null, gridObj = null;
                            for (const k of Object.keys(window)) {
                                try {
                                    const v = window[k];
                                    if (v && typeof v.getColumnsNum === 'function'
                                        && typeof v.getRowsNum === 'function'
                                        && v.getRowsNum() > 0) {
                                        gridVar = k; gridObj = v;
                                        break;
                                    }
                                } catch(e) {}
                            }
                            if (!gridObj) return {err: 'no grid with rows', rows: 0};
                            // Try both casings
                            let poColIdx = -1;
                            for (const colId of ['PO_NO', 'poNo', 'PoNo', 'poNumber']) {
                                const idx = gridObj.getColumnIndex(colId);
                                if (idx >= 0) { poColIdx = idx; break; }
                            }
                            let matchRid = null;
                            const total = gridObj.getRowsNum();
                            const seen = [];
                            if (poColIdx >= 0) {
                                for (let r = 0; r < total; r++) {
                                    const rid = gridObj.getRowId(r);
                                    const v = String(gridObj.cells(rid, poColIdx).getValue() || '').trim();
                                    seen.push(v);
                                    if (v === po) { matchRid = rid; break; }
                                }
                            }
                            return {gridVar, rows: total, poColIdx, matchRid, seen: seen.slice(0, 10)};
                        }
                        """,
                        po,
                    )
                    logger.info("PO %s grid state: %s", po, po_grid_state)
                    if po_grid_state.get("rows", 0) == 0:
                        raise RuntimeError(f"P/O Receipt search returned 0 rows for PO {po}")

                    # ---- Step 2: Click PO No anchor → expect new window popup ----
                    try:
                        async with ctx.expect_page(timeout=20000) as pop_info:
                            clicked = await page.evaluate(
                                """
                                ([po, gridVar, matchRid, poColIdx]) => {
                                    // Strategy A: use grid API to find the cell + click the anchor inside
                                    if (gridVar && matchRid != null && poColIdx >= 0) {
                                        const g = window[gridVar];
                                        const cell = g.cells(matchRid, poColIdx);
                                        if (cell && cell.cell) {
                                            const a = cell.cell.querySelector('a');
                                            if (a) {
                                                a.scrollIntoView({block: 'center'});
                                                if (typeof window.jQuery !== 'undefined') {
                                                    window.jQuery(a).trigger('click');
                                                } else { a.click(); }
                                                return {via: 'grid_cell_anchor'};
                                            }
                                            // No anchor — click the cell TD itself
                                            cell.cell.scrollIntoView({block: 'center'});
                                            cell.cell.click();
                                            return {via: 'grid_cell_td'};
                                        }
                                    }
                                    // Strategy B: scan all anchors with exact PO text
                                    const anchors = document.querySelectorAll('a');
                                    for (const a of anchors) {
                                        const txt = (a.textContent || '').trim();
                                        if (txt === po && a.offsetParent !== null) {
                                            if (typeof window.jQuery !== 'undefined') {
                                                window.jQuery(a).trigger('click');
                                            } else { a.click(); }
                                            return {via: 'anchor_text'};
                                        }
                                    }
                                    return null;
                                }
                                """,
                                [po, po_grid_state.get("gridVar"), po_grid_state.get("matchRid"),
                                 po_grid_state.get("poColIdx", -1)],
                            )
                            if not clicked:
                                # Last resort: Playwright text locator
                                await page.locator(f"text='{po}'").first.click(timeout=8000)
                            logger.info("PO %s click result: %s", po, clicked)
                        po_popup = await pop_info.value
                        await po_popup.wait_for_load_state("domcontentloaded", timeout=15000)
                        await po_popup.wait_for_timeout(3000)
                        logger.info("PO %s popup opened: %s", po, po_popup.url)
                    except Exception as exc:
                        await page.screenshot(path=str(work_dir / f"po_{po}_click_fail.png"))
                        raise RuntimeError(f"PO popup không mở: {exc}")

                    # ---- Step 3: In attachFilePop popup, capture PDF via response listener ----
                    # Popup uses DextUpload5 widget that downloads via HIDDEN IFRAME.
                    # Playwright expect_download does NOT catch iframe downloads.
                    # Strategy: register page.on('response') to intercept any PDF response
                    # from any frame in the popup, then trigger click "Download All".
                    from urllib.parse import urlparse, parse_qs as _parse_qs
                    file_ref_id = None
                    try:
                        q = _parse_qs(urlparse(po_popup.url).query)
                        file_ref_id = (q.get("fileRefId", [""])[0] or "").strip()
                    except Exception:
                        pass
                    logger.info("PO %s popup fileRefId=%s", po, file_ref_id)

                    # Wait for DextUpload5 widget Download All button to render
                    try:
                        await po_popup.wait_for_selector(
                            "a[id^='downloadDEXTX5_']", state="visible", timeout=20000,
                        )
                    except Exception as exc:
                        logger.warning("DEXTX5 download btn not visible: %s", exc)
                        await po_popup.screenshot(path=str(work_dir / f"po_{po}_no_btn.png"))

                    # Bug fix #3+4: scope listener state in dict to avoid closure ambiguity,
                    # AND remove listener after capture/timeout to prevent memory leak across iterations.
                    capture_state = {"pdf": None, "url": None, "done": False}
                    pdf_event = asyncio.Event()

                    async def _on_resp(resp, _state=capture_state, _evt=pdf_event, _po=po):
                        if _state["done"]:
                            return
                        try:
                            url = resp.url
                            ct = (resp.headers.get("content-type") or "").lower()
                            cd = (resp.headers.get("content-disposition") or "").lower()
                            if "pdf" in ct or ".pdf" in cd or url.lower().endswith(".pdf"):
                                logger.info("PO %s candidate PDF: %s (ct=%s, cd=%s)",
                                            _po, url[:120], ct, cd)
                                try:
                                    body = await resp.body()
                                    if body and len(body) > 1024 and body[:4] == b"%PDF":
                                        _state["pdf"] = body
                                        _state["url"] = url
                                        _state["done"] = True
                                        _evt.set()
                                except Exception as exc:
                                    logger.warning("read body failed: %s", exc)
                        except Exception:
                            pass

                    listener = lambda r: asyncio.create_task(_on_resp(r))
                    po_popup.on("response", listener)

                    # Click "Download All" button — fires dx5DownloadFile() → iframe nav → PDF response
                    try:
                        clicked_btn = await po_popup.evaluate(
                            """
                            () => {
                                // 1. Try direct id pattern
                                const dxBtn = document.querySelector("a[id^='downloadDEXTX5_']");
                                if (dxBtn && dxBtn.offsetParent !== null) {
                                    if (typeof window.jQuery !== 'undefined') {
                                        window.jQuery(dxBtn).trigger('click');
                                    } else { dxBtn.click(); }
                                    return {id: dxBtn.id, onclick: (dxBtn.getAttribute('onclick') || '').slice(0,100)};
                                }
                                // 2. Try calling dx5DownloadFile() directly if available
                                if (typeof window.dx5DownloadFile === 'function' &&
                                    typeof window.targetIdattachFile !== 'undefined') {
                                    window.dx5DownloadFile(window.targetIdattachFile, 'AUTO', true);
                                    return {via: 'direct_dx5_call'};
                                }
                                return null;
                            }
                            """
                        )
                        logger.info("PO %s download click: %s", po, clicked_btn)
                    except Exception as exc:
                        logger.warning("download click failed: %s", exc)

                    # Wait up to 25s for PDF response to be captured
                    try:
                        await asyncio.wait_for(pdf_event.wait(), timeout=25.0)
                    except asyncio.TimeoutError:
                        logger.warning("PO %s: no PDF response captured in 25s", po)
                    finally:
                        # Bug fix #4: always remove listener — prevents leak across iterations
                        try:
                            po_popup.remove_listener("response", listener)
                        except Exception:
                            pass

                    if capture_state["pdf"]:
                        po_pdf.write_bytes(capture_state["pdf"])
                        captured_url = capture_state["url"]
                        out["po_pdfs"].append({"po": po, "path": str(po_pdf), "status": "ok",
                                              "captured_url": captured_url[:200] if captured_url else None})
                        logger.info("PO %s PDF saved (%d bytes) from %s",
                                    po, len(capture_state["pdf"]), captured_url)
                    else:
                        out["po_pdfs"].append({"po": po, "path": None, "status": "failed",
                                              "error": "No PDF response captured",
                                              "fileRefId": file_ref_id})
                        await po_popup.screenshot(path=str(work_dir / f"po_{po}_no_pdf.png"))
                except Exception as exc:
                    out["po_pdfs"].append({"po": po, "path": None, "status": "failed", "error": str(exc)[:300]})
                    out["warnings"].append(f"PO {po} download failed: {exc}")
                    try:
                        await page.screenshot(path=str(work_dir / f"po_{po}_search_fail.png"))
                    except Exception:
                        pass
                finally:
                    # Close PO popup to clean up before next iteration
                    if po_popup:
                        try:
                            await po_popup.close()
                        except Exception:
                            pass

            _progress(95, "Xong scrape")
            # Success requires Invoice PDF saved with non-zero size
            inv_path = out.get("invoice_pdf")
            invoice_ok = False
            if inv_path:
                try:
                    invoice_ok = Path(inv_path).stat().st_size > 1024  # ≥1KB
                except Exception:
                    invoice_ok = False
            if not invoice_ok and inv_path:
                out["errors"].append(f"Invoice PDF saved but suspiciously small or missing: {inv_path}")
            out["success"] = invoice_ok

        except Exception as exc:
            logger.exception("dossier scrape top-level failed")
            out["errors"].append(f"top: {str(exc)[:300]}")
        finally:
            try:
                await browser.close()
            except Exception:
                pass

    return out
