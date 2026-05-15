"""BQMS periodic auto-scrape — runs every 30 min in background.

Per Thang 2026-05-11: scrape bidding/contract/MRO modules every 30 min to
keep staging fresh. Special handling:

  - Closed column: if RFQ shows status='Closed', mark in DB and stop
    re-scraping that row (no further updates needed).
  - Round 2 detection: for RFQs we already quoted (status=approved in
    staging), re-check after their deadline to detect "[New] / 2 th"
    invitation (round 2). When detected, write to bqms_quote_log so the
    dashboard "Tổng quan" can surface it.
  - Image preservation: download_files_for_rfq already skips re-extract
    if folder has existing images (per same-date fix in scraper).

Schedule: every 30 minutes (cron='*/30 * * * *'). Uses Procrastinate
periodic dispatcher (same pattern as bqms_excel_auto_import).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.config import settings
from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Periodic task — every 30 min
# ---------------------------------------------------------------------------

def _is_periodic_enabled() -> bool:
    """Check `app_config.bqms_periodic_scrape_enabled` flag — runtime toggle."""
    try:
        with psycopg2.connect(SYNC_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT value FROM app_config WHERE key = 'bqms_periodic_scrape_enabled'"
                )
                row = cur.fetchone()
                if not row:
                    return False
                v = row[0]
                # asyncpg returns dict for jsonb; psycopg2 may return bool/str
                if isinstance(v, bool):
                    return v
                if isinstance(v, str):
                    return v.lower() in ("true", "1", "yes")
                return bool(v)
    except Exception as exc:
        logger.warning("_is_periodic_enabled check failed: %s — defaulting to OFF", exc)
        return False


# ---------------------------------------------------------------------------
# Smart auto-rescan — every 5 min, only drills RFQs missing _detail.items.
# Phase F (Thang 2026-05-13): user wants "smart turn on/off" — task chạy
# ngầm tự động, idle nhanh khi không có gap, work khi có. Tách khỏi cron
# 30-min để responsive hơn.
# ---------------------------------------------------------------------------

def _smart_rescan_enabled() -> bool:
    """Default ON (vs periodic_scrape default OFF). User có thể tắt riêng
    smart-rescan mà không ảnh hưởng cron list-scrape."""
    try:
        with psycopg2.connect(SYNC_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT value FROM app_config WHERE key = 'bqms_smart_rescan_enabled'"
                )
                row = cur.fetchone()
                if not row:
                    return True  # default ON
                v = row[0]
                if isinstance(v, bool):
                    return v
                if isinstance(v, str):
                    return v.lower() in ("true", "1", "yes")
                return bool(v)
    except Exception:
        return True


def _write_rescan_state(state: dict[str, Any]) -> None:
    """Persist last rescan run summary to app_config for UI display."""
    try:
        with psycopg2.connect(SYNC_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO app_config (key, value, updated_at)
                    VALUES ('bqms_smart_rescan_state', %s::jsonb, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                    """,
                    (json.dumps(state, default=str),),
                )
                conn.commit()
    except Exception as exc:
        logger.warning("_write_rescan_state failed: %s", exc)


@app.periodic(cron="*/5 * * * *")
@app.task(name="bqms_smart_rescan", queue="bqms")
def bqms_smart_rescan(timestamp: int = 0) -> dict[str, Any]:
    """Smart auto-rescan: chạy mỗi 5 phút, chỉ drill RFQ thiếu items.

    Workflow:
      1. Đếm gap (RFQ pending thiếu _detail.items) — nhanh, đọc DB
      2. Nếu gap = 0 → exit ngay (idle, tốn <50ms)
      3. Nếu gap > 0 → drill up to 20 RFQs (budget 4 phút để fit trong 5-min cron)
      4. Ghi state vào app_config để UI hiển thị

    Toggle: app_config.bqms_smart_rescan_enabled (default true).
    """
    if not _smart_rescan_enabled():
        return {"status": "disabled", "skipped": True}

    started_at = datetime.now(timezone.utc)
    state: dict[str, Any] = {
        "started_at": started_at.isoformat(),
        "status": "running",
        "gaps_before": 0,
        "processed": 0,
        "files_downloaded": 0,
        "duration_seconds": 0.0,
    }

    # 1. Quick gap count
    try:
        with psycopg2.connect(SYNC_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*) FROM bqms_vendor_portal_staging
                    WHERE module = 'bidding' AND status = 'pending_review'
                      AND (raw_json->'_detail' IS NULL
                           OR jsonb_array_length(COALESCE(raw_json->'_detail'->'items','[]'::jsonb)) = 0)
                    """
                )
                gaps_before = int(cur.fetchone()[0])
    except Exception as exc:
        logger.warning("smart_rescan gap-count failed: %s", exc)
        gaps_before = 0

    state["gaps_before"] = gaps_before

    # 2. Smart idle — no gaps, exit fast
    if gaps_before == 0:
        state["status"] = "idle"
        state["finished_at"] = datetime.now(timezone.utc).isoformat()
        state["duration_seconds"] = (datetime.now(timezone.utc) - started_at).total_seconds()
        _write_rescan_state(state)
        logger.info("smart_rescan: no gaps — skipping (idle)")
        return state

    # 3. Drill — small batch to fit 5-min cron window
    t0 = time.monotonic()
    logger.info("smart_rescan: %d gaps detected → drilling up to 20", gaps_before)
    try:
        result = asyncio.run(_smart_rescan_drill(max_rfqs=20, budget_seconds=240))
        state.update(result)
        state["status"] = "done"
    except Exception as exc:
        logger.exception("smart_rescan drill failed: %s", exc)
        state["status"] = "error"
        state["error"] = str(exc)[:300]

    state["duration_seconds"] = round(time.monotonic() - t0, 2)
    state["finished_at"] = datetime.now(timezone.utc).isoformat()
    _write_rescan_state(state)
    return state


async def _smart_rescan_drill(max_rfqs: int, budget_seconds: int) -> dict[str, Any]:
    """Run _auto_drill_new_rfqs with a small batch. Returns summary dict.

    Holds samsung_session_lock for the duration — gracefully skips this cycle
    if another Samsung task (push / code_track) is already running.
    """
    import asyncpg
    from app.services.samsung_session_lock import samsung_session_lock

    db_url = (
        str(settings.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)
    try:
        try:
            async with samsung_session_lock(pool, who="smart_rescan", timeout_seconds=60):
                processed, total_files = await _auto_drill_new_rfqs(
                    pool, max_per_cycle=max_rfqs, budget_seconds=budget_seconds,
                )
                return {
                    "processed": int(processed),
                    "files_downloaded": int(total_files),
                }
        except RuntimeError as exc:
            logger.info("smart_rescan skip cycle (Samsung lock busy): %s", exc)
            return {"processed": 0, "files_downloaded": 0, "skipped_samsung_lock": True}
    finally:
        await pool.close()


@app.periodic(cron="*/30 * * * *")
@app.task(name="bqms_periodic_scrape", queue="bqms")
def bqms_periodic_scrape(timestamp: int = 0) -> dict[str, Any]:
    """Scrape bidding/contract/MRO every 30 min, update Closed status,
    detect round-2 invitations, log activity to bqms_quote_log.

    Per Thang 2026-05-11: runtime-toggleable via app_config.
    bqms_periodic_scrape_enabled flag (default OFF). UI button on /bqms
    can flip the flag. When OFF, the task is a no-op (returns immediately).
    """
    if not _is_periodic_enabled():
        logger.info("bqms_periodic_scrape: DISABLED via app_config flag")
        return {"status": "disabled", "skipped": True}

    started_at = datetime.now(timezone.utc)
    logger.info("bqms_periodic_scrape: starting (utc=%s)", started_at.isoformat())

    result: dict[str, Any] = {
        "bidding_new": 0,
        "contract_new": 0,
        "mro_new": 0,
        "closed_marked": 0,
        "round2_detected": 0,
        "errors": [],
        "duration_seconds": 0.0,
        "started_at": started_at.isoformat(),
    }
    t0 = time.monotonic()

    try:
        result.update(asyncio.run(_run_all()))
    except Exception as exc:
        logger.exception("bqms_periodic_scrape failed: %s", exc)
        result["errors"].append(f"top-level: {exc}")

    result["duration_seconds"] = round(time.monotonic() - t0, 2)
    _log_periodic_run(result)
    logger.info(
        "bqms_periodic_scrape done in %.1fs (bidding=%d drilled=%d files=%d closed=%d r2=%d)",
        result["duration_seconds"], result["bidding_new"],
        result.get("detail_drilled", 0), result.get("files_downloaded", 0),
        result["closed_marked"], result["round2_detected"],
    )
    return result


async def _run_all() -> dict[str, Any]:
    """Run all 3 scrapers + post-process updates.

    NOTE (Thang 2026-05-15): periodic_scrape is default OFF per app_config flag.
    Even if enabled, smart_rescan (cron */5) and code_track (cron */3) already
    have samsung_session_lock guards — they'll skip when periodic_scrape is
    holding the lock. We don't acquire the lock here because periodic_scrape
    is a "long-form" job (~25 min) and locking that long would starve push.
    Future improvement: chunk periodic_scrape into RFQ-batches, each acquiring
    the lock briefly.
    """
    import asyncpg
    from app.etl.bqms_bidding_scraper import scrape_bidding
    from app.etl.bqms_contract_scraper import scrape_contracts
    from app.etl.bqms_mro_scraper import scrape_mro_po

    out = {
        "bidding_new": 0, "contract_new": 0, "mro_new": 0,
        "detail_drilled": 0, "files_downloaded": 0,
        "closed_marked": 0, "round2_detected": 0, "errors": [],
    }

    db_url = (
        str(settings.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)

    try:
        # 1. Bidding list scrape — list-only (drill_details=False because
        # BQMS portal frequently returns "Access Violated" when navigating
        # back from detail to list, breaking in-place drill chain).
        try:
            r = await scrape_bidding(
                limit=0, save_raw_json=False, db_pool=pool,
                drill_details=False, smart_skip=True,
            )
            out["bidding_new"] = int(r.get("list_count", 0))
        except Exception as exc:
            out["errors"].append(f"bidding: {exc}")
            logger.warning("bidding scrape failed: %s", exc)

        # 1b. POST-SCRAPE auto-detail: for each pending_review staging row that
        # doesn't have images yet, run download_files_for_rfq to fetch
        # attachments + extract product images. Each call uses its OWN
        # Playwright session (login per RFQ) — slower than drill_details=True
        # but reliable (no Access-Violated issue). Cap to MAX_DETAIL_PER_CYCLE
        # so a single cycle doesn't exceed the 30-min budget.
        # Also save fresh_detail back to staging.raw_json so the drawer shows
        # items + attachments + version + classification immediately.
        # Per Thang 2026-05-11: user wants detail visible BEFORE clicking "Báo giá".
        try:
            # Per Thang 2026-05-13: drill ALL pending RFQs in 1 cycle (default).
            # max_per_cycle=50 + budget guard 22 min inside loop.
            n_dl, n_files = await _auto_drill_new_rfqs(pool, max_per_cycle=50, budget_seconds=1320)
            out["detail_drilled"] = n_dl
            out["files_downloaded"] = n_files
        except Exception as exc:
            out["errors"].append(f"auto_drill: {exc}")
            logger.warning("auto_drill failed: %s", exc)

        # 2. Contracts
        try:
            r = await scrape_contracts(
                limit=20, drill_items=True, save_raw_json=False, db_pool=pool,
            )
            out["contract_new"] = int(r.get("drilled_count", 0))
        except Exception as exc:
            out["errors"].append(f"contract: {exc}")
            logger.warning("contract scrape failed: %s", exc)

        # 2b. Bridge contract staging → bqms_won_quotations (Trúng BG)
        # Per Thang 2026-05-15: replace Excel-based won_quotations import with
        # Samsung scrape source. Runs even if 2. failed — picks up backlog.
        try:
            from app.services.bqms_won_quotations_sync import (
                upsert_won_from_contract_staging,
            )
            ws = await upsert_won_from_contract_staging(pool)
            out["won_inserted"] = ws.get("inserted", 0)
            out["won_updated"] = ws.get("updated", 0)
            out["won_skipped"] = ws.get("skipped", 0)
            out["won_errors"] = ws.get("errors", 0)
        except Exception as exc:
            out["errors"].append(f"won_bridge: {exc}")
            logger.warning("won_quotations bridge failed: %s", exc)

        # 3. MRO
        try:
            r = await scrape_mro_po(
                limit=0, save_raw_json=False, db_pool=pool,
            )
            out["mro_new"] = int(r.get("list_count", 0))
        except Exception as exc:
            out["errors"].append(f"mro: {exc}")
            logger.warning("mro scrape failed: %s", exc)

        # 3b. Bridge po staging → bqms_deliveries (Giao hàng)
        # Per Thang 2026-05-15: replace Excel-based deliveries import with
        # Samsung MRO scrape source.
        try:
            from app.services.bqms_deliveries_sync import (
                upsert_deliveries_from_po_staging,
            )
            ds = await upsert_deliveries_from_po_staging(pool)
            out["delivery_inserted"] = ds.get("inserted", 0)
            out["delivery_updated"] = ds.get("updated", 0)
            out["delivery_skipped"] = ds.get("skipped", 0)
            out["delivery_errors"] = ds.get("errors", 0)
        except Exception as exc:
            out["errors"].append(f"delivery_bridge: {exc}")
            logger.warning("deliveries bridge failed: %s", exc)

        # 4. Selection Result (won/lost) — per Thang 2026-05-11:
        # scrape Selection Result page, auto-mark bqms_rfq.result='won'/'lost'
        # so dashboard KPIs (trúng/trượt) update.
        try:
            from app.etl.bqms_l1_l3_scraper import scrape_selection_result
            r = await scrape_selection_result(
                limit=0, save_raw_json=False, db_pool=pool,
                auto_mark_result=True,
            )
            out["selection_won"] = int(r.get("won_marked", 0))
            out["selection_lost"] = int(r.get("lost_marked", 0))
        except Exception as exc:
            out["errors"].append(f"selection_result: {exc}")
            logger.warning("selection_result scrape failed: %s", exc)

        # 4. Post-process: Closed status detection
        # Mark RFQs whose latest scrape shows status containing "Closed" as
        # not_active (so future scans skip them). Idempotent.
        try:
            out["closed_marked"] = await _mark_closed_rfqs(pool)
        except Exception as exc:
            out["errors"].append(f"closed_mark: {exc}")
            logger.warning("closed_mark failed: %s", exc)

        # 5. Round 2 detection
        try:
            out["round2_detected"] = await _detect_round2_invitations(pool)
        except Exception as exc:
            out["errors"].append(f"round2: {exc}")
            logger.warning("round2 detection failed: %s", exc)
    finally:
        await pool.close()

    return out


async def _auto_drill_new_rfqs(
    pool,
    max_per_cycle: int = 50,
    budget_seconds: int = 1320,
) -> tuple[int, int]:
    """For pending_review bidding staging rows whose folder has NO images,
    run `download_files_for_rfq` to drill detail + download attachments +
    extract product images. Capped to `max_per_cycle` per scrape cycle
    AND to budget_seconds total time (default 22 min — leaves 8 min for
    contract/MRO/closed/round2 within 30-min cron window).

    Per Thang 2026-05-13: chuyển default drill ALL RFQ trong 1 chu kỳ. Trước
    đây chỉ drill 8/cycle → 30 RFQ phải mất 4 cycles = 2h. Giờ drill tới khi
    hết budget thời gian hoặc đủ max_per_cycle.

    Returns (rfqs_processed, total_files_downloaded).
    """
    import time as _time
    _started = _time.monotonic()
    from pathlib import Path
    from app.etl.bqms_bidding_scraper import (
        find_existing_rfq_folder, download_files_for_rfq,
    )

    async with pool.acquire() as conn:
        # Pull recent pending bidding rows + their raw_json.
        # Order: newest first so the most recent RFQs get processed each cycle.
        rows = await conn.fetch(
            """
            SELECT id, rfq_number, raw_json, scraped_at
            FROM bqms_vendor_portal_staging
            WHERE module = 'bidding'
              AND status IN ('pending_review', 'approved')
              AND rfq_number IS NOT NULL
            ORDER BY id DESC
            LIMIT 200
            """,
        )

    # Phase F (Thang 2026-05-13): drill criteria mở rộng.
    # Trước đây chỉ check "folder không có ảnh" → bỏ qua RFQ đã có ảnh nhưng
    # thiếu _detail.items → cột BQMS/maker/CIS/Part NO ở bảng vẫn rỗng.
    # Giờ: drill khi THIẾU folder/ảnh HOẶC thiếu _detail.items trong raw_json.
    candidates = []
    for r in rows:
        if len(candidates) >= max_per_cycle:
            break
        # 1) Detail items check (cheap — read raw_json which we already have)
        raw_local = r["raw_json"]
        if isinstance(raw_local, str):
            try:
                raw_local = json.loads(raw_local)
            except Exception:
                raw_local = {}
        detail_local = (raw_local or {}).get("_detail") or {}
        has_detail_items = bool(detail_local.get("items"))
        # 2) Filesystem check (cheap)
        folder = find_existing_rfq_folder(r["rfq_number"])
        has_folder = folder is not None
        has_images_dir = bool(folder and (folder / "images").exists())
        has_images = False
        if has_images_dir:
            try:
                has_images = any(
                    p.is_file() and p.stat().st_size > 100
                    for p in (folder / "images").glob("*.png")
                )
            except Exception:
                pass
        # Need drill if ANY of: missing folder | missing images | missing items
        # (so RFQ already downloaded but with stale/empty _detail still gets re-drilled)
        if not (has_folder and has_images and has_detail_items):
            candidates.append(r)

    if not candidates:
        logger.info("auto_drill: no candidates need detail drilling")
        return (0, 0)

    logger.info("auto_drill: %d RFQs need detail (cap=%d)", len(candidates), max_per_cycle)

    # Pre-fetch recipient user IDs: BQMS-aware users (department contains BQMS
    # or role=admin/manager) — they get the system Bell notification.
    async with pool.acquire() as conn:
        recipients = await conn.fetch(
            "SELECT id FROM users "
            "WHERE is_active = true AND deleted_at IS NULL "
            "AND (department ILIKE '%BQMS%' OR role IN ('admin','manager'))",
        )
        recipient_ids = [r["id"] for r in recipients]
    logger.info("auto_drill: %d recipients will get notifications", len(recipient_ids))

    total_files = 0
    processed = 0
    for r in candidates:
        # Budget guard — break if total time exceeds budget_seconds.
        elapsed = _time.monotonic() - _started
        if elapsed > budget_seconds:
            logger.info(
                "auto_drill: budget exhausted (%.0fs > %ds) — break after %d/%d",
                elapsed, budget_seconds, processed, len(candidates),
            )
            break
        try:
            raw = r["raw_json"]
            if isinstance(raw, str):
                raw = json.loads(raw)

            # Phase I (Thang 2026-05-14): Round-bump detection — BEFORE drill.
            # When Samsung pushes a QT to round 2/3/4, the V1 attachments on
            # the portal are DELETED. If we blindly call download_files_for_rfq
            # we'd overwrite V1 files with 0 attachments → data loss.
            # → Detect first, then if it's a bump, skip Playwright entirely
            #   and only update DB (version + maybe subject).
            from app.etl.bqms_bidding_scraper import (
                detect_is_round_bump, apply_round_bump,
            )
            bump_to = await detect_is_round_bump(pool, r["rfq_number"], raw)
            if bump_to is not None:
                bump_summary = await apply_round_bump(
                    pool, r["rfq_number"], bump_to, raw,
                )
                logger.info(
                    "auto_drill %s: ROUND-BUMP v%s→%s — skipped scrape, files preserved",
                    r["rfq_number"], bump_summary.get("old_version"), bump_to,
                )
                processed += 1
                await asyncio.sleep(1)
                continue  # skip the normal drill path

            # Phase F (Thang 2026-05-13): pass force_drill_detail=True so even RFQs
            # already-with-images get their grid items drilled — fixes "—" columns.
            dl = await download_files_for_rfq(
                r["rfq_number"], raw, db_pool=pool,
                force_drill_detail=True,
            )
            n_files = int(dl.get("downloaded_count", 0))
            n_imgs = int(dl.get("images_extracted", 0))
            fresh_detail = dl.get("fresh_detail")

            # Save fresh_detail back into staging.raw_json so drawer shows
            # items/attachments/version/classification immediately.
            if fresh_detail and (fresh_detail.get("items") or fresh_detail.get("attachments")):
                raw["_detail"] = fresh_detail
                async with pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE bqms_vendor_portal_staging "
                        "SET raw_json = $1::jsonb "
                        "WHERE id = $2",
                        json.dumps(raw, ensure_ascii=False, default=str),
                        r["id"],
                    )

                # Phase H (Thang 2026-05-13): Scrape auto-UPSERT bqms_rfq sao cho
                # rows xuất hiện NGAY trong BQMS table (locked state — V1-V4 ô
                # khóa cho tới khi user click "Báo giá"). Trước đây upsert chỉ
                # xảy ra khi user click → nguồn gốc của nhiều bug "thông tin
                # biến mất" / "ảnh không hiện".
                if fresh_detail.get("items"):
                    try:
                        from app.etl.bqms_bidding_scraper import upsert_bqms_rfq_for_one_staging_row
                        n_up = await upsert_bqms_rfq_for_one_staging_row(pool, raw)
                        logger.info("auto_drill %s: auto-upserted %d bqms_rfq rows (locked V1-V4)",
                                    r["rfq_number"], n_up)
                    except Exception as up_exc:
                        logger.warning("auto_drill %s: upsert failed: %s", r["rfq_number"], up_exc)

            total_files += n_files
            processed += 1

            # System Bell notification — push a notif row to each BQMS recipient
            # so the global Bell shows "RFQ mới: QT26xxxxxx".
            if recipient_ids:
                spec = (raw.get("reqName") or raw.get("subject") or "")[:120]
                items_count = len((fresh_detail or {}).get("items") or [])
                async with pool.acquire() as conn:
                    for uid in recipient_ids:
                        try:
                            await conn.execute(
                                """
                                INSERT INTO notifications
                                    (recipient_id, type, title, body, ref_type, ref_id, metadata)
                                VALUES ($1::uuid, 'bqms_rfq_new', $2, $3, 'bqms_rfq', $4, $5::jsonb)
                                """,
                                uid,
                                f"RFQ mới: {r['rfq_number']}",
                                f"{spec}\n{items_count} items · {n_imgs} ảnh · {n_files} file",
                                r["id"],
                                json.dumps({
                                    "rfq_number": r["rfq_number"],
                                    "items_count": items_count,
                                    "images": n_imgs,
                                    "files": n_files,
                                    "link": "/bqms",
                                }),
                            )
                        except Exception as exc:
                            logger.warning("notif insert for %s failed: %s", uid, exc)

            logger.info(
                "auto_drill %s: files=%d images=%d items=%d duration=%.1fs notif=%d",
                r["rfq_number"], n_files, n_imgs,
                len((fresh_detail or {}).get("items") or []),
                float(dl.get("duration_seconds", 0)),
                len(recipient_ids),
            )
            # Light delay between drills to be polite to Samsung BQMS
            await asyncio.sleep(3)
        except Exception as exc:
            logger.warning("auto_drill %s FAILED: %s", r["rfq_number"], exc)
    return (processed, total_files)


async def _mark_closed_rfqs(pool) -> int:
    """Find staging rows whose latest raw_json status contains 'Closed' and
    log to audit_log so the dashboard can surface them. Idempotent — uses
    a 24h dedup window."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, rfq_number, raw_json
            FROM bqms_vendor_portal_staging
            WHERE module = 'bidding'
              AND status IN ('approved', 'pending_review')
              AND (raw_json->>'progressStatusName' ILIKE '%closed%'
                   OR raw_json->>'submitGb' ILIKE '%closed%'
                   OR raw_json::text ILIKE '%"status":"Closed"%')
            """,
        )
        marked = 0
        for r in rows:
            try:
                # Dedup: skip if we've logged closure for this RFQ in last 24h
                existing = await conn.fetchval(
                    """
                    SELECT 1 FROM audit_log
                    WHERE action = 'bqms_periodic.closed'
                      AND record_id = $1
                      AND created_at > NOW() - INTERVAL '24 hours'
                    LIMIT 1
                    """,
                    r["rfq_number"],
                )
                if existing:
                    continue
                await conn.execute(
                    """
                    INSERT INTO audit_log
                        (action, table_name, record_id, new_data, created_at)
                    VALUES (
                        'bqms_periodic.closed',
                        'bqms_vendor_portal_staging',
                        $1, $2::jsonb, NOW()
                    )
                    """,
                    r["rfq_number"],
                    json.dumps({
                        "staging_id": r["id"],
                        "message": f"RFQ {r['rfq_number']} đã Closed — không cần re-scan nữa",
                    }),
                )
                # Phase 2.4 per Thang 2026-05-12: also set bqms_rfq.result='closed'
                # so the row shows up under "Closed" filter on BQMS table.
                try:
                    await conn.execute(
                        """
                        UPDATE bqms_rfq
                        SET result = 'closed'::rfq_result,
                            result_date = CURRENT_DATE,
                            updated_at = NOW()
                        WHERE rfq_number = $1
                          AND result IN ('pending'::rfq_result)
                        """,
                        r["rfq_number"],
                    )
                except Exception as exc:
                    logger.warning("set result=closed failed for %s: %s", r["rfq_number"], exc)
                marked += 1
            except Exception as exc:
                logger.warning("closed audit insert failed for %s: %s", r['rfq_number'], exc)
        return marked


async def _detect_round2_invitations(pool) -> int:
    """For RFQs we've quoted (v1 priced), check if Samsung re-opened with a
    new round — detect '[New]' or '/ 2 th' in reqName/subject. Logs to
    audit_log so dashboard 'Tổng quan' surfaces it."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.id, s.rfq_number, s.raw_json
            FROM bqms_vendor_portal_staging s
            JOIN bqms_rfq r ON r.rfq_number = s.rfq_number
            WHERE s.module = 'bidding'
              AND s.status = 'approved'
              AND r.quoted_price_bqms_v1 IS NOT NULL
              AND (
                  s.raw_json->>'reqName' ILIKE '[new]%'
                  OR s.raw_json->>'reqName' ILIKE '%/ 2 th%'
                  OR s.raw_json->>'reqName' ILIKE '%/ 2th%'
                  OR s.raw_json->>'subject'  ILIKE '[new]%'
              )
            """,
        )
        n = 0
        for r in rows:
            try:
                existing = await conn.fetchval(
                    """
                    SELECT 1 FROM audit_log
                    WHERE action = 'bqms_periodic.round2_invitation'
                      AND record_id = $1
                      AND created_at > NOW() - INTERVAL '7 days'
                    LIMIT 1
                    """,
                    r["rfq_number"],
                )
                if existing:
                    continue
                raw = r["raw_json"]
                if isinstance(raw, str):
                    raw = json.loads(raw)
                subject = (raw.get("reqName") or raw.get("subject") or "")[:200]
                await conn.execute(
                    """
                    INSERT INTO audit_log
                        (action, table_name, record_id, new_data, created_at)
                    VALUES (
                        'bqms_periodic.round2_invitation',
                        'bqms_vendor_portal_staging',
                        $1, $2::jsonb, NOW()
                    )
                    """,
                    r["rfq_number"],
                    json.dumps({
                        "staging_id": r["id"],
                        "subject": subject,
                        "message": f"Round 2 invitation: {subject}",
                    }),
                )
                n += 1
                logger.info("Round 2 detected for %s: %s", r['rfq_number'], subject[:80])
            except Exception as exc:
                logger.warning("round2 audit insert failed for %s: %s", r['rfq_number'], exc)
        return n


def _log_periodic_run(result: dict[str, Any]) -> None:
    """Insert a row into etl_sync_log to track periodic scrape runs."""
    try:
        with psycopg2.connect(SYNC_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO etl_sync_log
                        (sync_type, status, started_at, completed_at, rows_inserted, error_message)
                    VALUES ('bqms_periodic', %s, NOW(), NOW(), %s, %s)
                    """,
                    (
                        "success" if not result.get("errors") else "partial",
                        int(result.get("bidding_new", 0)) +
                        int(result.get("contract_new", 0)) +
                        int(result.get("mro_new", 0)),
                        "; ".join(result.get("errors", [])[:3]) or None,
                    ),
                )
                conn.commit()
    except Exception as exc:
        logger.warning("etl_sync_log insert failed: %s", exc)


# ───────────────────────────────────────────────────────────────────
# Smart Code-Track — Phase G (Thang 2026-05-13)
# Self-healing engine, every 3 min. Sits alongside (does not replace)
# the 30-min `bqms_periodic_scrape` and 5-min `bqms_smart_rescan`.
# Detects 10 kinds of gaps, dispatches targeted re-scrapes per RFQ.
# See backend/app/services/bqms_gap_{detector,healer}.py.
# ───────────────────────────────────────────────────────────────────


def _code_track_enabled() -> bool:
    """Read app_config.bqms_code_track_enabled. Defaults to TRUE (per Thang
    request: 'luôn luôn chạy ẩn')."""
    try:
        with psycopg2.connect(SYNC_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT value FROM app_config WHERE key = 'bqms_code_track_enabled'"
                )
                row = cur.fetchone()
                if not row:
                    return True  # default ON
                v = row[0]
                if isinstance(v, bool):
                    return v
                if isinstance(v, str):
                    return v.lower() in ("true", "1", "yes")
                return bool(v)
    except Exception:
        return True


def _write_code_track_state(state: dict[str, Any]) -> None:
    """Persist last cycle summary to app_config for UI display."""
    try:
        with psycopg2.connect(SYNC_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO app_config (key, value, updated_at)
                    VALUES ('bqms_code_track_state', %s::jsonb, NOW())
                    ON CONFLICT (key) DO UPDATE SET
                        value = EXCLUDED.value,
                        updated_at = NOW()
                    """,
                    (json.dumps(state, default=str),),
                )
                conn.commit()
    except Exception as exc:
        logger.warning("_write_code_track_state failed: %s", exc)


@app.periodic(cron="*/3 * * * *")
@app.task(name="bqms_smart_code_track", queue="bqms")
def bqms_smart_code_track(timestamp: int = 0) -> dict[str, Any]:
    """Continuous self-healing engine — every 3 min.

    Workflow:
      1. Detect 10 kinds of gaps (DB+FS, 5s budget)
      2. Group by RFQ, apply 10-min cooldown, cap to 4 dispatches/cycle
      3. Targeted re-scrape via download_files_for_rfq(force_drill_detail=True)
      4. Map fresh_detail back: fill NULLs, classify TM/GC, rename orphan images
      5. Record audit rows to bqms_row_gaps; persist summary to app_config

    Toggle: app_config.bqms_code_track_enabled (default true).
    Budget: 120s hard cap. Uses pg_advisory_lock to prevent concurrent runs.
    """
    if not _code_track_enabled():
        return {"status": "disabled", "skipped": True}

    started_at = datetime.now(timezone.utc)
    state: dict[str, Any] = {
        "started_at": started_at.isoformat(),
        "status": "running",
    }

    try:
        state.update(asyncio.run(_run_code_track_cycle()))
    except Exception as exc:
        logger.exception("smart_code_track cycle failed: %s", exc)
        state["status"] = "error"
        state["error"] = str(exc)[:300]

    state["finished_at"] = datetime.now(timezone.utc).isoformat()
    state["duration_seconds"] = (
        datetime.now(timezone.utc) - started_at
    ).total_seconds()
    _write_code_track_state(state)
    return state


async def _run_code_track_cycle() -> dict[str, Any]:
    """Async wrapper — creates pool and delegates to gap_healer.run_cycle.

    Skips cycle gracefully if another Samsung task is holding the session lock.
    """
    import asyncpg
    from app.services.samsung_session_lock import samsung_session_lock
    db_url = (
        str(settings.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)
    try:
        try:
            async with samsung_session_lock(pool, who="code_track", timeout_seconds=60):
                from app.services.bqms_gap_healer import run_cycle
                return await run_cycle(pool, budget_seconds=120)
        except RuntimeError as exc:
            logger.info("code_track skip cycle (Samsung lock busy): %s", exc)
            return {"status": "skipped", "reason": "samsung_lock_busy"}
    finally:
        await pool.close()
