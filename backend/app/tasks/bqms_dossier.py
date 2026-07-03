"""Procrastinate task: orchestrate full delivery dossier creation.

Job flow:
  1. Acquire samsung_session_lock (so doesn't conflict with push/scrape)
  2. Run scraper → get Invoice PDF + PO PDFs
  3. Parse Shipping No from Invoice PDF
  4. Build dossier folder + Excel from template
  5. Update bqms_deliveries rows (shipping_no, actual_delivered_qty, ...)
  6. Update bqms_dossier_jobs.status='done'

Status flow: queued → running → invoice_ready → po_downloaded → excel_built → done
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.config import settings
from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


def _evidence_key(po_number, po_seq, bqms_code) -> str:
    """Composite, filesystem-safe key for per-item evidence images.

    Cam kết sheets are PER ITEM (po_number, po_seq, bqms_code); the same
    bqms_code can appear on >1 sheet across different POs/sequences, so a
    bqms_code-only key collides. This builds the same sanitized string the
    upload endpoint sanitizes from the posted `item_key`, byte-for-byte:
        sanitize(f"{po_number}|{po_seq or ''}|{bqms_code}")
    where sanitize = re.sub(r"[^A-Za-z0-9_\\-]", "_", ...).
    """
    return re.sub(r"[^A-Za-z0-9_\-]", "_", f"{po_number}|{po_seq or ''}|{bqms_code}")


@app.task(name="bqms_create_delivery_dossier", queue="bqms_push")
def bqms_create_delivery_dossier(job_id: int) -> dict[str, Any]:
    """Procrastinate task entry point. Sync wrapper around async core."""
    logger.info("bqms_create_delivery_dossier job_id=%d starting", job_id)
    try:
        result = asyncio.run(_run_dossier_job(job_id))
        logger.info("bqms_create_delivery_dossier job_id=%d done: %s", job_id, result.get("status"))
        return result
    except Exception as exc:
        logger.exception("bqms_create_delivery_dossier job_id=%d FAILED", job_id)
        _update_job_sync(job_id, status="failed", error=str(exc)[:1000],
                         finished_at=datetime.now(timezone.utc))
        return {"job_id": job_id, "status": "failed", "error": str(exc)}


@app.task(name="bqms_regenerate_dossier_excel", queue="bqms_push")
def bqms_regenerate_dossier_excel(job_id: int) -> dict[str, Any]:
    """Procrastinate task entry point — EXCEL-ONLY regenerate.

    SAFETY: this re-builds ONLY the .xlsx from the (edited) stored form_data +
    already-uploaded evidence images, overwriting the existing Excel in the
    stored output_folder. It MUST NOT run the Samsung scraper, acquire the
    samsung_session_lock, open the create-delivery popup (irreversible, already
    done), re-parse Shipping No, or run the bqms_deliveries qty-accumulation
    UPDATE (would double-count delivered qty). Reuses stored
    shipping_no/output_folder. Sync wrapper around async core.
    """
    logger.info("bqms_regenerate_dossier_excel job_id=%d starting", job_id)
    try:
        result = asyncio.run(_run_regenerate_excel_job(job_id))
        logger.info("bqms_regenerate_dossier_excel job_id=%d done: %s", job_id, result.get("status"))
        return result
    except Exception as exc:
        logger.exception("bqms_regenerate_dossier_excel job_id=%d FAILED", job_id)
        _update_job_sync(job_id, status="failed", error=str(exc)[:1000],
                         updated_at=datetime.now(timezone.utc))
        return {"job_id": job_id, "status": "failed", "error": str(exc)}


def _update_job_sync(job_id: int, **fields) -> None:
    """Update bqms_dossier_jobs row (sync, psycopg2)."""
    if not fields:
        return
    cols = list(fields.keys())
    vals = [fields[c] for c in cols]
    set_clause = ", ".join(f"{c} = %s" for c in cols)
    try:
        with psycopg2.connect(SYNC_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE bqms_dossier_jobs SET {set_clause} WHERE id = %s",
                    (*vals, job_id),
                )
                conn.commit()
    except Exception as exc:
        logger.warning("update_job_sync(%d) failed: %s", job_id, exc)


async def _get_pool():
    """Create a FRESH asyncpg pool bound to the CURRENT event loop.

    Thang 2026-06-25 fix (regenerate stuck at 'regenerating'): each Procrastinate
    task runs via asyncio.run() — a NEW event loop per call, and sync tasks may run
    in parallel worker threads. The previous module-level cached pool (+ an
    asyncio.Lock) was bound to the FIRST task's loop; the 2nd task reused it on a
    different/closed loop → "Event loop is closed" / "another operation is in
    progress", and the job never got its status reset. So we now hand back a
    PER-TASK pool; the caller MUST close it in its `finally` block.
    """
    import asyncpg
    db_url = str(settings.DATABASE_URL).replace("postgresql+asyncpg", "postgresql").replace("+asyncpg", "")
    return await asyncpg.create_pool(db_url, min_size=1, max_size=4)


async def _close_pool(pool) -> None:
    """Gracefully close a per-task pool; force-terminate if close hangs."""
    try:
        await asyncio.wait_for(pool.close(), timeout=10)
    except Exception:
        try:
            pool.terminate()
        except Exception:
            pass


async def _build_excel_for_job(
    conn,
    job_row: dict,
    form_data: dict,
    folder: Path,
    folder_name: str,
    shipping_no: str,
) -> dict:
    """Build (overwrite) the dossier Excel from form_data + uploaded evidence.

    SCRAPER-FREE. Contains ONLY the Excel-build portion: batch DB lookups
    (deliv_map DISTINCT ON + rfq_map defaults), per-item image resolution
    (_read_evidence / _evidence_key + system override + actual), payload-wins
    field resolution + box fields + box_qty_total_override + labels, then
    build_dossier_workbook(... output_path=folder/excel_filename(folder_name),
    shipping_no=shipping_no ...).

    It MUST NOT call the scraper, parse PDFs, or UPDATE bqms_deliveries. The
    passed `shipping_no` is used as-is (NOT re-parsed).

    `conn` is an asyncpg connection (acquired from the shared pool by the
    caller). Returns a dict with the built excel path + warnings.
    """
    from app.services.dossier_folder import excel_filename
    from app.services.dossier_excel_builder import build_dossier_workbook, DossierItem
    from app.services.dossier_image_resolver import find_system_image, read_image_bytes

    sev_type = job_row["sev_type"]
    job_id = job_row["id"]
    items: list[dict] = form_data.get("items", [])

    # evidence_dir matches the create-flow path (per job_id), so re-using the
    # already-uploaded per-item evidence images.
    evidence_dir = Path(f"/data/bqms-push-evidence/dossier/{job_id}")

    # ---- Batch DB lookups (read-only) ----
    bqms_codes_list = list({it["bqms_code"] for it in items})
    po_keys = [(it["po_number"], it["bqms_code"]) for it in items]

    deliv_map: dict[tuple[str, str], dict] = {}
    rfq_map: dict[str, dict] = {}
    d_rows = await conn.fetch(
        """
        SELECT DISTINCT ON (po_number, bqms_code)
               po_number, bqms_code, item_name, specification, unit,
               recipient_name, receiving_warehouse
          FROM bqms_deliveries
         WHERE (po_number, bqms_code) IN (
             SELECT * FROM unnest($1::text[], $2::text[])
         )
         ORDER BY po_number, bqms_code,
                  COALESCE(actual_delivered_at, delivery_date::timestamptz) DESC NULLS LAST,
                  updated_at DESC NULLS LAST,
                  id DESC
        """,
        [k[0] for k in po_keys], [k[1] for k in po_keys],
    )
    for r in d_rows:
        deliv_map[(r["po_number"], r["bqms_code"])] = dict(r)

    r_rows = await conn.fetch(
        "SELECT bqms_code, rfq_number, person_in_charge_name, department "
        "FROM bqms_rfq WHERE bqms_code = ANY($1::text[])",
        bqms_codes_list,
    )
    for r in r_rows:
        rfq_map[r["bqms_code"]] = dict(r)

    # Resolve image paths in PARALLEL (filesystem I/O via threads)
    sys_paths = await asyncio.gather(*[
        asyncio.to_thread(
            find_system_image,
            it["bqms_code"],
            rfq_map.get(it["bqms_code"], {}).get("rfq_number"),
        )
        for it in items
    ])

    async def _read_evidence(it: dict, slot: str):
        # Per-item composite key (matches upload endpoint's sanitized item_key
        # byte-for-byte). Fall back to legacy bqms_code-only filename when
        # po_seq is missing (older clients / pre-key uploads).
        key = _evidence_key(it.get("po_number"), it.get("po_seq"), it.get("bqms_code"))
        p = evidence_dir / f"{key}_{slot}.png"
        if not p.exists():
            if it.get("po_seq") in (None, ""):
                legacy = evidence_dir / f"{it.get('bqms_code')}_{slot}.png"
                if legacy.exists():
                    return await asyncio.to_thread(legacy.read_bytes)
            return None
        return await asyncio.to_thread(p.read_bytes)

    sys_default_bytes = await asyncio.gather(*[
        asyncio.to_thread(read_image_bytes, p) for p in sys_paths
    ])
    sys_override_bytes = await asyncio.gather(*[
        _read_evidence(it, "system") for it in items
    ])
    actual_bytes_list = await asyncio.gather(*[
        _read_evidence(it, "actual") for it in items
    ])

    # Build dossier items (zero DB/IO from here on)
    dossier_items: list[DossierItem] = []
    for idx, it in enumerate(items):
        bqms_code = it["bqms_code"]
        po_number = it["po_number"]
        deliv_row = deliv_map.get((po_number, bqms_code)) or {}
        rfq_row = rfq_map.get(bqms_code) or {}
        # Prefer user override system image, then default from RFQ folder
        sys_img_bytes = sys_override_bytes[idx] or sys_default_bytes[idx]
        actual_bytes = actual_bytes_list[idx]
        deliv_spec = (deliv_row.get("specification") or "") if deliv_row else ""
        # Box Weight: blank stays blank — NO gross-weight split.
        _bw = it.get("box_weight")
        eff_box_w = float(_bw) if _bw not in (None, "") else None
        # Box Qty (col O): blank allowed, no clamp-to-1.
        _bq = it.get("box_qty")
        if _bq in (None, ""):
            eff_box_qty = None
        else:
            try:
                eff_box_qty = int(float(_bq))
            except (TypeError, ValueError):
                eff_box_qty = None

        # ---- PAYLOAD-WINS resolution (Thang LOCKED 2026-06-25) ----
        def _payload_wins(field: str, default: str, allow_blank: bool = False) -> str:
            v = it.get(field)
            if allow_blank:
                return str(v) if v is not None else default
            return str(v) if v not in (None, "") else default

        dept_default = (
            (deliv_row.get("receiving_warehouse") or "").strip()
            or (rfq_row.get("department") or "").strip()
        )
        pr_default = (deliv_row.get("recipient_name") or "").strip()
        name_default = (deliv_row.get("item_name") or "")[:40]

        dossier_items.append(DossierItem(
            po_number=po_number,
            po_seq=str(it.get("po_seq", "")),
            bqms_code=bqms_code,
            item_name=_payload_wins("item_name", name_default)[:40],
            specification=(it.get("specification") or "") or deliv_spec,
            unit=_payload_wins("unit", deliv_row.get("unit") or "PC"),
            shipping_qty=float(it.get("shipping_qty", 0)),
            dept=_payload_wins("dept", dept_default, allow_blank=True),
            pr_person=_payload_wins("pr_person", pr_default, allow_blank=True),
            receiver=_payload_wins("receiver", "", allow_blank=True),
            box_weight=eff_box_w,
            dim_l=it.get("dim_l") or "",
            dim_w=it.get("dim_w") or "",
            dim_h=it.get("dim_h") or "",
            packing_size=str(it.get("packing_size") or ""),
            box_qty=eff_box_qty,
            system_image=sys_img_bytes,
            actual_image=actual_bytes,
        ))

    # Box-Qty TOTAL override (PRINT-ONLY).
    _bqt_raw = form_data.get("box_qty_total_override")
    try:
        box_qty_total_override = (
            int(float(_bqt_raw)) if _bqt_raw not in (None, "") else None
        )
    except (TypeError, ValueError):
        box_qty_total_override = None

    # Build Excel — CPU-bound, run in thread (frees event loop). Overwrites the
    # existing .xlsx in the stored folder.
    excel_path = folder / excel_filename(folder_name)
    build_result = await asyncio.to_thread(
        build_dossier_workbook,
        items=dossier_items,
        customer=sev_type,
        shipping_no=shipping_no or "",
        invoice_no=form_data.get("vendor_invoice_no", ""),
        shipping_date=datetime.now().strftime("%d/%m/%Y"),
        output_path=excel_path,
        box_qty_total_override=box_qty_total_override,
        labels=form_data.get("labels"),
    )

    return {
        "excel": str(excel_path),
        "excel_path": excel_path,
        "warnings": list(build_result.get("warnings", [])),
    }


async def _run_dossier_job(job_id: int) -> dict:
    """Async core — orchestrate scraper + builder + DB."""
    from app.services.samsung_session_lock import samsung_session_lock
    from app.etl.bqms_dossier_scraper import run_dossier_scrape
    from app.services.dossier_folder import (
        build_dossier_folder_name, build_dossier_folder_path,
        ensure_dossier_folder, find_existing_dossier_folder,
        excel_filename, delivery_note_filename, purchase_order_filename,
    )
    from app.services.dossier_pdf_parser import extract_shipping_no
    from app.services.dossier_excel_builder import build_dossier_workbook, DossierItem
    from app.services.dossier_image_resolver import find_system_image, read_image_bytes

    pool = await _get_pool()

    try:
        # 1. Load job row
        async with pool.acquire() as c:
            row = await c.fetchrow(
                "SELECT * FROM bqms_dossier_jobs WHERE id = $1", job_id,
            )
        if not row:
            return {"job_id": job_id, "status": "failed", "error": "job row not found"}

        form_data = row["form_data"]
        if isinstance(form_data, str):
            form_data = json.loads(form_data)
        sev_type = row["sev_type"]
        po_numbers: list[str] = list(row["po_numbers"] or [])
        items: list[dict] = form_data.get("items", [])

        # Set status running
        await _update_job_async(
            pool, job_id,
            status="running",
            progress_pct=5, progress_step="Bắt đầu",
            started_at=datetime.now(timezone.utc),
        )

        # 2. Build folder path
        # items_by_po + qty_by_po
        items_by_po: dict[str, list[str]] = {}
        qty_by_po: dict[str, int] = {}
        for it in items:
            po = it["po_number"]
            items_by_po.setdefault(po, []).append(it.get("item_name") or "")
            qty_by_po[po] = qty_by_po.get(po, 0) + int(it.get("shipping_qty", 0))

        # Multi-delivery folder naming (Thang 2026-05-21): append "lan-N DD-MM"
        # so each delivery attempt for the same PO list gets its OWN folder
        # and history is preserved. attempt_no is auto-set by DB trigger.
        attempt_no = int(row.get("delivery_attempt_no") or 1) if isinstance(row, dict) else int(row["delivery_attempt_no"] or 1)
        folder_name = build_dossier_folder_name(
            po_numbers, items_by_po, qty_by_po,
            attempt_no=attempt_no,
            delivery_date=row["created_at"] if row["created_at"] else None,
        )
        # Idempotent re-check: only reuse if SAME job is retried (same attempt).
        # Different attempt_no must always get a NEW folder.
        existing = None
        if attempt_no == 1:
            existing = find_existing_dossier_folder(sev_type, po_numbers)
            # But only if the existing folder name doesn't have a `lan-N` suffix
            # (i.e. it's a pre-2026-05-21 folder from before multi-delivery).
            # If it has `lan-`, that's a different attempt — don't reuse.
            if existing and " lan-" in existing.name:
                existing = None
        if existing:
            folder = existing
            logger.info("Reusing existing folder (attempt 1, no lan- suffix): %s", folder)
        else:
            folder = build_dossier_folder_path(sev_type, folder_name)
            ensure_dossier_folder(folder)
            logger.info("Created NEW folder for attempt %d: %s", attempt_no, folder)
        await _update_job_async(pool, job_id, output_folder=str(folder),
                                progress_pct=10, progress_step="Tạo folder")

        work_dir = folder  # save PDFs directly into final folder
        company_code = "C5H0" if sev_type == "SEV" else "C5H2"

        # 3. Run scraper inside Samsung session lock
        # progress_cb is invoked SYNCHRONOUSLY from inside the scraper's running
        # event loop. We schedule the DB update via asyncio.create_task so it
        # runs on the same loop without blocking the scraper.
        loop = asyncio.get_running_loop()

        async def _scrape_progress(pct: int, step: str):
            try:
                await _update_job_async(pool, job_id,
                                        progress_pct=10 + (pct * 70 // 100),
                                        progress_step=step)
            except Exception as exc:
                logger.warning("scrape_progress update failed: %s", exc)

        def _progress_cb_sync(pct: int, step: str) -> None:
            # Schedule the coro on the same running loop.
            try:
                loop.create_task(_scrape_progress(pct, step))
            except Exception as exc:
                logger.warning("progress_cb schedule failed: %s", exc)

        # Heartbeat loop — updates last_heartbeat_at every 30s while scraper runs.
        # Watchdog will kill jobs with stale heartbeat (>5 min) automatically.
        async def _heartbeat():
            while True:
                try:
                    await asyncio.sleep(30)
                    await _update_job_async(pool, job_id,
                                            last_heartbeat_at=datetime.now(timezone.utc))
                except asyncio.CancelledError:
                    break
                except Exception as exc:
                    logger.warning("heartbeat failed: %s", exc)

        heartbeat_task = asyncio.create_task(_heartbeat())

        # Checkpoint "Confirm before Create Delivery" (Thang 2026-05-28):
        # scraper điền xong popup → gọi confirm_cb → ta set status awaiting_confirm
        # + lưu preview, rồi poll confirm_signal cho tới khi user confirm/cancel
        # hoặc hết 5 phút (timeout → cancel an toàn). Screenshot lưu vào evidence dir
        # để serve qua endpoint /dossier-job/{id}/confirm-image.
        evidence_dir = Path(f"/data/bqms-push-evidence/dossier/{job_id}")
        CONFIRM_TIMEOUT_SECONDS = 300

        async def _confirm_cb(preview: dict) -> str:
            # Reset signal + lưu preview, chuyển status awaiting_confirm.
            await _update_job_async(
                pool, job_id,
                status="awaiting_confirm",
                confirm_signal=None,
                confirm_preview=json.dumps(preview, ensure_ascii=False, default=str),
                awaiting_confirm_at=datetime.now(timezone.utc),
                progress_pct=58,
                progress_step="Chờ bạn kiểm tra + xác nhận trước khi tạo Delivery",
            )
            waited = 0
            while waited < CONFIRM_TIMEOUT_SECONDS:
                await asyncio.sleep(3)
                waited += 3
                try:
                    async with pool.acquire() as c:
                        sig = await c.fetchval(
                            "SELECT confirm_signal FROM bqms_dossier_jobs WHERE id = $1", job_id,
                        )
                except Exception as exc:
                    logger.warning("poll confirm_signal failed: %s", exc)
                    continue
                if sig == "confirm":
                    await _update_job_async(pool, job_id, status="running",
                                            progress_step="Đã xác nhận — đang tạo Delivery")
                    return "confirm"
                if sig == "cancel":
                    return "cancel"
            return "timeout"

        scrape_result = None
        try:
            async with samsung_session_lock(pool, who=f"dossier-{job_id}", timeout_seconds=600):
                scrape_result = await run_dossier_scrape(
                    po_items=items,
                    company_code=company_code,
                    vendor_invoice_no=form_data.get("vendor_invoice_no", ""),
                    invoice_date=form_data.get("invoice_date", ""),
                    etd=form_data.get("etd", ""),
                    packing_qty=float(form_data.get("packing_qty", 1)),
                    packing_unit=form_data.get("packing_unit", "Box"),
                    volume=float(form_data.get("volume", 0)),
                    volume_unit=form_data.get("volume_unit", "M3"),
                    gross_weight=float(form_data.get("gross_weight", 0)),
                    weight_unit=form_data.get("weight_unit", "KG"),
                    remark=form_data.get("remark", ""),
                    shipping_manager=form_data.get("shipping_manager", "AMA Bac Ninh JSC"),
                    work_dir=work_dir,
                    progress_cb=_progress_cb_sync,
                    confirm_cb=_confirm_cb,
                    confirm_screenshot_path=evidence_dir / "confirm_preview.png",
                )
        finally:
            # Stop heartbeat once scraper done (success or fail)
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except (asyncio.CancelledError, Exception):
                pass

        # User huỷ tại checkpoint (hoặc timeout) → KHÔNG tạo Delivery, dừng sạch.
        if scrape_result.get("cancelled"):
            reason = scrape_result.get("cancel_reason") or "user_cancel"
            step = ("Hết thời gian chờ xác nhận — đã huỷ"
                    if reason == "timeout" else "Bạn đã huỷ tại bước kiểm tra")
            await _update_job_async(
                pool, job_id, status="cancelled", progress_step=step,
                finished_at=datetime.now(timezone.utc),
                files=json.dumps({"warnings": scrape_result.get("warnings", [])},
                                 ensure_ascii=False, default=str),
            )
            return {"job_id": job_id, "status": "cancelled", "reason": reason}

        if not scrape_result.get("success"):
            err = "; ".join(scrape_result.get("errors", [])) or "scrape failed"
            await _update_job_async(pool, job_id, status="failed", error=err[:1000],
                                    finished_at=datetime.now(timezone.utc),
                                    files=json.dumps(scrape_result, default=str, ensure_ascii=False))
            return {"job_id": job_id, "status": "failed", "error": err}

        await _update_job_async(pool, job_id, status="invoice_ready", progress_pct=80,
                                progress_step="Tải Invoice xong, parse Shipping No")

        # 4. Extract Shipping No from Invoice PDF — CPU-bound, run in thread
        invoice_pdf = scrape_result.get("invoice_pdf")
        shipping_no = None
        if invoice_pdf and Path(invoice_pdf).exists():
            shipping_no = await asyncio.to_thread(extract_shipping_no, invoice_pdf)
        if shipping_no:
            await _update_job_async(pool, job_id, shipping_no=shipping_no)
        else:
            scrape_result.setdefault("warnings", []).append("Không trích xuất được Shipping No từ Invoice PDF")

        # 5. Rename Invoice + PO PDFs theo pattern sample
        if invoice_pdf:
            target_invoice = folder / delivery_note_filename(folder_name)
            if str(invoice_pdf) != str(target_invoice):
                try:
                    shutil.move(invoice_pdf, target_invoice)
                    scrape_result["invoice_pdf"] = str(target_invoice)
                except Exception as exc:
                    scrape_result.setdefault("warnings", []).append(f"rename invoice failed: {exc}")

        for po_info in scrape_result.get("po_pdfs", []):
            if po_info.get("status") != "ok":
                continue
            old_path = po_info["path"]
            # Find item_short for this PO
            item_names = items_by_po.get(po_info["po"], [])
            item_short = (item_names[0] or "").split(",")[0].strip().lower()[:30] if item_names else ""
            new_name = purchase_order_filename(po_info["po"], item_short)
            new_path = folder / new_name
            try:
                shutil.move(old_path, new_path)
                po_info["path"] = str(new_path)
            except Exception as exc:
                scrape_result.setdefault("warnings", []).append(f"rename PO {po_info['po']} failed: {exc}")

        await _update_job_async(pool, job_id, status="po_downloaded", progress_pct=85,
                                progress_step="Build Excel...")

        # ============ 6. Build Excel — via scraper-free helper ============
        # The Excel-build portion (batch DB lookups + image resolution + item
        # assembly + build_dossier_workbook) is extracted into
        # _build_excel_for_job so the Excel-only regenerate task can reuse it.
        # CREATE flow stays identical: scraper ran ABOVE, shipping_no parsed
        # above, qty-accumulation UPDATE still runs BELOW.
        async with pool.acquire() as c:
            excel_build = await _build_excel_for_job(
                c, dict(row), form_data, folder, folder_name, shipping_no or "",
            )
        excel_path = excel_build["excel_path"]
        scrape_result["excel"] = str(excel_path)
        scrape_result.setdefault("warnings", []).extend(excel_build.get("warnings", []))

        await _update_job_async(pool, job_id, status="excel_built", progress_pct=92,
                                progress_step="Cập nhật bqms_deliveries...")

        # ============ 7. UPDATE bqms_deliveries — BY ID (was: by po+bqms_code) ============
        # Thang 2026-06-25 hotfix (dup-key crash @92%): the OLD `WHERE po_number=$
        # AND bqms_code=$` is NON-UNIQUE — ~49% of (po,code) pairs have >1 row in
        # bqms_deliveries (a samsung_scrape row + several onedrive_sync siblings).
        # That UPDATE matched ALL siblings and stamped the SAME shipping_no on each,
        # collapsing N distinct (po,shipping_no,bqms_code) keys onto ONE → violated
        # uq_bqms_deliv_po_ship_code WITHIN the statement (e.g. job 23: 4 rows for
        # 2112685351/Z0000002-335858). It also OVER-COUNTED qty (added shipping_qty
        # to every sibling row).
        #
        # FIX: target the ONE canonical row per item by id. delivery_row_ids was
        # captured at submit time as MAX(id) per item (endpoint: ORDER BY id DESC
        # LIMIT 1) and is positionally aligned with items. id is the PK → single
        # row → no collapse, no over-count. The `[job N]` marker guard makes a
        # same-job replay a no-op (the +qty increment is additive, not otherwise
        # idempotent). On any failure here we WARN and still mark the job done —
        # the Samsung delivery (Part 2, irreversible) + Excel + folder already
        # succeeded; re-running to "fix" tracking would create a DUPLICATE delivery.
        job_marker = f"[dossier job {job_id}]"
        row_ids: list = list(row["delivery_row_ids"] or [])
        update_payload: list[tuple] = []
        seen_ids: set[int] = set()

        if len(row_ids) == len(items) and all(r is not None for r in row_ids):
            # Primary path — stored MAX(id) targets, 1:1 with items.
            for it, rid in zip(items, row_ids):
                rid = int(rid)
                if rid in seen_ids:
                    continue  # two items → same row: add qty only once
                seen_ids.add(rid)
                update_payload.append(
                    (shipping_no, float(it.get("shipping_qty", 0)), job_marker, rid)
                )
        else:
            # Fallback (older jobs / length mismatch): re-select MAX(id) per (po,code)
            # — one row, the SAME selection the endpoint used. NEVER fall back to the
            # (po,code) UPDATE form, which reintroduces the collapse.
            logger.warning(
                "Job %d: delivery_row_ids mismatch (len=%d vs items=%d) — "
                "falling back to MAX(id) per (po,bqms_code)",
                job_id, len(row_ids), len(items),
            )
            async with pool.acquire() as c:
                for it in items:
                    rid = await c.fetchval(
                        "SELECT id FROM bqms_deliveries "
                        "WHERE po_number=$1 AND bqms_code=$2 ORDER BY id DESC LIMIT 1",
                        it["po_number"], it["bqms_code"],
                    )
                    if rid is None or int(rid) in seen_ids:
                        continue
                    seen_ids.add(int(rid))
                    update_payload.append(
                        (shipping_no, float(it.get("shipping_qty", 0)), job_marker, int(rid))
                    )

        try:
            async with pool.acquire() as c:
                async with c.transaction():
                    # WHERE id targets exactly one row (PK) → cannot collapse siblings.
                    # The job-marker guard skips a row already stamped by THIS job so a
                    # replay never double-adds shipping_qty.
                    await c.executemany(
                        """
                        UPDATE bqms_deliveries
                           SET shipping_no          = COALESCE($1, shipping_no),
                               actual_delivered_at  = COALESCE(actual_delivered_at, NOW()),
                               actual_delivered_qty = COALESCE(actual_delivered_qty, 0) + $2,
                               delivery_info        = $3,
                               updated_at           = NOW()
                         WHERE id = $4
                           AND (delivery_info IS NULL OR position($3 in delivery_info) = 0)
                        """,
                        update_payload,
                    )
        except Exception as exc:
            msg = f"Cập nhật bqms_deliveries thất bại (không chặn hồ sơ): {exc}"
            logger.exception("Job %d: %s", job_id, msg)
            scrape_result.setdefault("warnings", []).append(msg)

        # Determine if any PO in this batch still has pending qty (partial delivery).
        # Thang 2026-05-21: surface this flag on the job so UI can display
        # "đợt {N} (còn pending {qty})" badges and statistics queries are simpler.
        is_partial = False
        try:
            async with pool.acquire() as c:
                pending_check = await c.fetchval(
                    """
                    SELECT COUNT(*) FROM bqms_deliveries
                     WHERE po_number = ANY($1::text[])
                       AND COALESCE(actual_delivered_qty, 0) < COALESCE(quantity, 0)
                    """,
                    po_numbers,
                )
                is_partial = bool(pending_check and int(pending_check) > 0)
        except Exception as exc:
            logger.warning("partial-flag check failed for job %s: %s", job_id, exc)

        # 8. Mark done
        await _update_job_async(
            pool, job_id,
            status="done",
            progress_pct=100,
            progress_step="Hoàn thành",
            is_partial=is_partial,
            files=json.dumps({
                "excel": str(excel_path),
                "delivery_note": scrape_result.get("invoice_pdf"),
                "po_pdfs": scrape_result.get("po_pdfs", []),
                "warnings": scrape_result.get("warnings", []),
            }, ensure_ascii=False, default=str),
            finished_at=datetime.now(timezone.utc),
        )

        return {
            "job_id": job_id,
            "status": "done",
            "folder": str(folder),
            "excel": str(excel_path),
            "shipping_no": shipping_no,
        }

    finally:
        # Per-task pool (one per asyncio.run loop) — close it so connections are
        # not leaked and never reused across a closed loop.
        await _close_pool(pool)


async def _run_regenerate_excel_job(job_id: int) -> dict:
    """Async core — EXCEL-ONLY regenerate of an existing dossier.

    Re-builds ONLY the .xlsx from the (edited) stored form_data + the
    already-uploaded evidence images, overwriting the existing Excel in the
    stored output_folder. Reuses the stored shipping_no and output_folder.

    SAFETY — this function does NONE of the following (the entire point of the
    feature):
      * NO Samsung scraper / run_dossier_scrape
      * NO samsung_session_lock acquisition
      * NO create-delivery popup (irreversible, already done at create time)
      * NO Shipping No re-parse (stored shipping_no is reused as-is)
      * NO bqms_deliveries actual_delivered_qty accumulation UPDATE
        (that would double-count delivered qty)
    """
    from app.services.dossier_folder import ensure_dossier_folder

    pool = await _get_pool()

    try:
        # 1. Load job row
        async with pool.acquire() as c:
            row = await c.fetchrow(
                "SELECT * FROM bqms_dossier_jobs WHERE id = $1", job_id,
            )
        if not row:
            return {"job_id": job_id, "status": "failed", "error": "job row not found"}

        job_row = dict(row)

        form_data = job_row.get("form_data")
        if isinstance(form_data, str):
            form_data = json.loads(form_data)
        if not isinstance(form_data, dict):
            form_data = form_data or {}

        shipping_no = job_row.get("shipping_no") or ""

        output_folder = job_row.get("output_folder")
        if not output_folder:
            await _update_job_async(
                pool, job_id, status="failed",
                error="output_folder trống — không có hồ sơ để cập nhật Excel",
                updated_at=datetime.now(timezone.utc),
            )
            return {"job_id": job_id, "status": "failed", "error": "missing output_folder"}

        folder = Path(output_folder)
        folder_name = folder.name
        # Recreate folder on disk if it went missing (uses the same helper as
        # the create flow). NO scraper, NO popup — just an mkdir.
        if not folder.exists():
            ensure_dossier_folder(folder)
            logger.info("regenerate: recreated missing folder %s", folder)

        await _update_job_async(
            pool, job_id,
            progress_pct=40, progress_step="Đang dựng lại Excel...",
            updated_at=datetime.now(timezone.utc),
        )

        # 2. Build Excel ONLY (scraper-free helper, reuse stored shipping_no).
        async with pool.acquire() as c:
            excel_build = await _build_excel_for_job(
                c, job_row, form_data, folder, folder_name, shipping_no,
            )
        excel_path = excel_build["excel_path"]

        # 3. Mark done — preserve other file refs already stored on the job;
        #    only refresh the excel path + warnings. NO bqms_deliveries UPDATE.
        prior_files = job_row.get("files")
        if isinstance(prior_files, str):
            try:
                prior_files = json.loads(prior_files)
            except (ValueError, TypeError):
                prior_files = {}
        if not isinstance(prior_files, dict):
            prior_files = {}
        prior_files["excel"] = str(excel_path)
        prior_files["warnings"] = excel_build.get("warnings", [])

        await _update_job_async(
            pool, job_id,
            status="done",
            files=json.dumps(prior_files, ensure_ascii=False, default=str),
            progress_pct=100,
            progress_step="Đã cập nhật Excel",
            finished_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )

        return {
            "job_id": job_id,
            "status": "done",
            "folder": str(folder),
            "excel": str(excel_path),
            "shipping_no": shipping_no,
        }

    except Exception as exc:
        logger.exception("regenerate excel job %d failed", job_id)
        await _update_job_async(
            pool, job_id, status="failed", error=str(exc)[:1000],
            updated_at=datetime.now(timezone.utc),
        )
        return {"job_id": job_id, "status": "failed", "error": str(exc)}

    finally:
        # Per-task pool (one per asyncio.run loop) — close it so connections are
        # not leaked and never reused across a closed loop.
        await _close_pool(pool)


async def _update_job_async(pool, job_id: int, **fields) -> None:
    """Async UPDATE bqms_dossier_jobs."""
    if not fields:
        return
    cols = list(fields.keys())
    vals = [fields[c] for c in cols]
    set_clause = ", ".join(f"{c} = ${i + 1}" for i, c in enumerate(cols))
    sql = f"UPDATE bqms_dossier_jobs SET {set_clause} WHERE id = ${len(cols) + 1}"
    try:
        async with pool.acquire() as c:
            await c.execute(sql, *vals, job_id)
    except Exception as exc:
        logger.warning("update_job_async(%d) failed: %s", job_id, exc)
