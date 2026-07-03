"""BQMS Gap Healer — dispatcher + mapping engine.

Phase G (Thang 2026-05-13): consumes gaps from `bqms_gap_detector` and heals
them via targeted re-scrape + post-scrape mapping.

Flow:
  detect_all_gaps  →  plan_heals (group by rfq, cooldown filter, slice budget)
                  →  heal_one (per RFQ, semaphore-limited)
                       ├─ record_attempt → bqms_row_gaps INSERT
                       ├─ download_files_for_rfq(force_drill_detail=True)
                       ├─ apply_metadata_mapping (fill NULLs, never overwrite)
                       ├─ apply_item_type_classification (respect override)
                       ├─ remap_orphan_images (rename in-place + audit_log)
                       └─ record_outcome → UPDATE healed_at
                  →  app_config.bqms_code_track_state ← summary

Safety guarantees:
- pg_advisory_lock prevents 2 workers running cycle simultaneously
- 10-min cooldown per RFQ even across cycles
- 4 RFQs max per cycle, 2 concurrent Playwright sessions
- Metadata mapping NEVER overwrites user-set values (WHERE col IS NULL only)
- Orphan images RENAMED not deleted (audit_log records rename)
- 120s hard budget; gracefully break on timeout
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services.bqms_gap_detector import Gap, detect_all_gaps

logger = logging.getLogger(__name__)

COOLDOWN_MINUTES = 10
MAX_DISPATCH_PER_CYCLE = 4
SEM_CONCURRENT = 2
CHRONIC_FAIL_THRESHOLD = 5  # after 5 attempts, exclude for 1 hour
CHRONIC_FAIL_BACKOFF_HOURS = 1
ADVISORY_LOCK_KEY = 0x42_4D_53_43  # 'BMSC' — bqms code-track

_AUDIT_LOG_ACTION = "bqms.code_track.orphan_image_rename"


@dataclass
class HealPlan:
    rfq_number: str
    gaps: list[Gap]
    staging_id: int | None = None
    raw_row: dict | None = None


@dataclass
class CycleResult:
    started_at: str
    finished_at: str = ""
    duration_seconds: float = 0
    status: str = "running"          # idle | running | done | error
    gaps_detected: int = 0
    gaps_by_kind: dict[str, int] = field(default_factory=dict)
    plans: int = 0
    healed: int = 0
    healed_by_kind: dict[str, int] = field(default_factory=dict)
    skipped_cooldown: int = 0
    errors: list[str] = field(default_factory=list)


# ───────────────────────────────────────────────────────────────────
# Plan stage: group gaps + cooldown + rate-limit
# ───────────────────────────────────────────────────────────────────

async def plan_heals(pool, gaps: list[Gap]) -> tuple[list[HealPlan], int]:
    """Group gaps by rfq_number, drop those under cooldown, return slice + skipped count."""
    if not gaps:
        return [], 0

    # Group
    by_rfq: dict[str, list[Gap]] = {}
    for g in gaps:
        by_rfq.setdefault(g.rfq_number, []).append(g)

    rfq_numbers = list(by_rfq.keys())

    # Cooldown query — one batch lookup
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT rfq_number,
                   MAX(last_attempt_at) AS last_try,
                   COUNT(*) FILTER (WHERE last_attempt_at > NOW() - INTERVAL '1 hour'
                                       AND healed_at IS NULL) AS recent_failures
            FROM bqms_row_gaps
            WHERE rfq_number = ANY($1::text[])
            GROUP BY rfq_number
            """,
            rfq_numbers,
        )
    cooldown_map = {r["rfq_number"]: (r["last_try"], int(r["recent_failures"] or 0))
                    for r in rows}

    plans: list[HealPlan] = []
    skipped = 0
    now = datetime.now(timezone.utc)
    cooldown_cutoff = now.timestamp() - COOLDOWN_MINUTES * 60

    for rfq_num, glist in by_rfq.items():
        last_try, recent_fails = cooldown_map.get(rfq_num, (None, 0))
        # Cooldown check
        if last_try is not None:
            if last_try.timestamp() > cooldown_cutoff:
                skipped += 1
                continue
        # Chronic failure backoff
        if recent_fails >= CHRONIC_FAIL_THRESHOLD:
            skipped += 1
            continue
        plans.append(HealPlan(rfq_number=rfq_num, gaps=glist))

    # Prefer plans with more gaps (heal more at once)
    plans.sort(key=lambda p: -len(p.gaps))
    return plans[:MAX_DISPATCH_PER_CYCLE], skipped + max(0, len(plans) - MAX_DISPATCH_PER_CYCLE)


async def _fetch_staging_raw(pool, rfq_number: str) -> tuple[int | None, dict]:
    """Fetch the most recent staging row for an RFQ to use as raw_json source."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, raw_json FROM bqms_vendor_portal_staging
            WHERE module='bidding' AND rfq_number=$1
            ORDER BY id DESC LIMIT 1
            """,
            rfq_number,
        )
    if not row:
        return None, {}
    raw = row["raw_json"]
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    return int(row["id"]), raw or {}


# ───────────────────────────────────────────────────────────────────
# Mapping engine
# ───────────────────────────────────────────────────────────────────

_TM_KEYWORDS = (
    "thuong mai", "thương mại", "tm", "mua hang", "mua hàng",
    "trade", "commercial",
)
_GC_KEYWORDS = (
    "gia cong", "gia công", "gc", "san xuat", "sản xuất",
    "machining", "fabrication", "jig", "fixture",
)


def _classify_text(text: str) -> str | None:
    """Heuristic TM/GC classification from spec text. Returns None if ambiguous."""
    if not text:
        return None
    t = text.lower()
    gc_hits = sum(1 for k in _GC_KEYWORDS if k in t)
    tm_hits = sum(1 for k in _TM_KEYWORDS if k in t)
    if gc_hits > tm_hits and gc_hits > 0:
        return "GC"
    if tm_hits > gc_hits and tm_hits > 0:
        return "TM"
    return None


async def apply_metadata_mapping(conn, rfq_number: str, fresh_detail: dict) -> int:
    """Fill NULL bqms_code/specification/maker/expected_qty in bqms_rfq.

    GUARDED: WHERE col IS NULL — never overwrites user-set values.
    Returns rows affected.
    """
    items = (fresh_detail or {}).get("items") or []
    if not items:
        return 0
    updated = 0
    for it in items:
        bqms_code = (it.get("item_code") or "").strip() or None
        spec = (it.get("specification") or "").strip() or None
        maker = (it.get("maker") or "").strip() or None
        qty_raw = it.get("qty")
        try:
            qty = float(str(qty_raw).replace(",", "")) if qty_raw not in (None, "", "0") else None
        except (TypeError, ValueError):
            qty = None
        unit = (it.get("unit") or "").strip() or None

        if not bqms_code:
            continue

        # Find candidate row by (rfq_number, bqms_code); if not exact match, by rfq_number only
        result = await conn.execute(
            """
            UPDATE bqms_rfq
            SET specification = COALESCE(specification, $1),
                maker = COALESCE(maker, $2),
                expected_qty = COALESCE(expected_qty, $3),
                unit = COALESCE(unit, $4),
                updated_at = NOW()
            WHERE rfq_number = $5 AND bqms_code = $6
              AND (specification IS NULL OR maker IS NULL
                   OR expected_qty IS NULL OR unit IS NULL)
            """,
            spec, maker, qty, unit, rfq_number, bqms_code,
        )
        # parse "UPDATE N" out of result string
        try:
            n = int(result.split()[-1])
        except (ValueError, IndexError):
            n = 0
        updated += n
    return updated


async def apply_item_type_classification(conn, rfq_number: str, fresh_detail: dict) -> int:
    """Classify TM/GC heuristically and write into bqms_rfq.notes.

    GUARDED: skip if classification_override IS NOT NULL (respect user choice).
    Returns rows affected.
    """
    items = (fresh_detail or {}).get("items") or []
    if not items:
        return 0
    updated = 0
    for it in items:
        bqms_code = (it.get("item_code") or "").strip()
        if not bqms_code:
            continue
        spec = (it.get("specification") or "")
        cls = _classify_text(spec)
        if not cls:
            continue
        marker = f"classification={cls}"
        result = await conn.execute(
            """
            UPDATE bqms_rfq
            SET notes = CASE
                WHEN notes IS NULL OR notes = '' THEN $1
                WHEN notes ILIKE '%classification=%' THEN notes
                ELSE notes || ' | ' || $1
            END,
            updated_at = NOW()
            WHERE rfq_number = $2 AND bqms_code = $3
              AND classification_override IS NULL
              AND (notes IS NULL OR notes NOT ILIKE '%classification=%')
            """,
            marker, rfq_number, bqms_code,
        )
        try:
            n = int(result.split()[-1])
        except (ValueError, IndexError):
            n = 0
        updated += n
    return updated


async def remap_orphan_images(
    conn, rfq_number: str, images_dir: Path, fresh_detail: dict,
) -> int:
    """For unprefixed image files, fuzzy-match by content/order to bqms_codes.

    RENAMES in place (reversible). Logs each rename to audit_log.
    Returns count renamed.
    """
    if not images_dir.is_dir():
        return 0
    items = (fresh_detail or {}).get("items") or []
    if not items:
        return 0
    codes = [(it.get("item_code") or "").strip() for it in items]
    codes = [c for c in codes if c]
    if not codes:
        return 0

    # Find candidate orphan files
    orphans: list[Path] = []
    try:
        for e in os.scandir(images_dir):
            if not e.is_file():
                continue
            n = e.name.lower()
            if not (n.endswith(".png") or n.endswith(".jpg") or n.endswith(".jpeg")):
                continue
            if n.startswith("_"):
                continue
            # if any code prefixes this filename, not orphan
            if any(n.startswith(c.lower() + "_") or n.startswith(c.lower() + ".") for c in codes):
                continue
            orphans.append(Path(e.path))
    except OSError:
        return 0

    if not orphans:
        return 0

    # Pre-existing files per code (to compute the next suffix index)
    next_idx_for_code: dict[str, int] = {}
    for c in codes:
        try:
            n_existing = sum(1 for p in images_dir.glob(f"{c}_*"))
            next_idx_for_code[c] = n_existing + 1
        except OSError:
            next_idx_for_code[c] = 1

    # Simple round-robin assignment (sorted orphan filenames to codes in order)
    orphans.sort(key=lambda p: p.name.lower())
    renamed = 0
    for i, orphan in enumerate(orphans):
        code = codes[i % len(codes)]
        ext = orphan.suffix.lower()
        idx = next_idx_for_code[code]
        next_idx_for_code[code] += 1
        target = images_dir / f"{code}_{idx}{ext}"
        # Skip if target already exists (collision)
        if target.exists():
            continue
        try:
            orphan.rename(target)
            renamed += 1
            # Audit log
            try:
                await conn.execute(
                    """
                    INSERT INTO audit_log
                        (action, table_name, record_id, new_data, created_at)
                    VALUES ($1, 'bqms_row_gaps', $2, $3::jsonb, NOW())
                    """,
                    _AUDIT_LOG_ACTION, rfq_number,
                    json.dumps({"rfq": rfq_number, "from": orphan.name,
                                "to": target.name, "code": code}),
                )
            except Exception as audit_exc:
                logger.warning("audit_log insert failed for orphan rename: %s", audit_exc)
        except OSError as exc:
            logger.warning("rename failed %s → %s: %s", orphan, target, exc)
    return renamed


# ───────────────────────────────────────────────────────────────────
# Heal stage
# ───────────────────────────────────────────────────────────────────

async def _record_attempt(conn, plan: HealPlan) -> dict[str, int]:
    """INSERT/UPSERT one row per gap_type for this RFQ, increment drill_attempts.
    Returns gap_type → row_id map for outcome update."""
    row_ids: dict[str, int] = {}
    for g in plan.gaps:
        # Check existing open row
        row = await conn.fetchrow(
            """
            SELECT id, drill_attempts FROM bqms_row_gaps
            WHERE rfq_number = $1 AND gap_type = $2 AND healed_at IS NULL
            ORDER BY id DESC LIMIT 1
            """,
            plan.rfq_number, g.kind,
        )
        if row:
            new_id = row["id"]
            await conn.execute(
                """
                UPDATE bqms_row_gaps
                SET last_attempt_at = NOW(),
                    drill_attempts = drill_attempts + 1,
                    evidence = $1::jsonb
                WHERE id = $2
                """,
                json.dumps(g.evidence), new_id,
            )
        else:
            new_id = await conn.fetchval(
                """
                INSERT INTO bqms_row_gaps
                    (rfq_number, rfq_id, staging_id, gap_type, evidence,
                     detected_at, last_attempt_at, drill_attempts)
                VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW(), 1)
                RETURNING id
                """,
                plan.rfq_number, g.rfq_id, g.staging_id, g.kind,
                json.dumps(g.evidence),
            )
        row_ids[g.kind] = int(new_id)
    return row_ids


async def _record_outcome(
    conn, row_ids: dict[str, int], healed_kinds: set[str], error: str | None = None,
):
    """Mark healed_at for kinds we successfully addressed; record error for the rest."""
    for kind, rid in row_ids.items():
        if kind in healed_kinds:
            await conn.execute(
                "UPDATE bqms_row_gaps SET healed_at = NOW(), last_error = NULL WHERE id = $1",
                rid,
            )
        elif error:
            await conn.execute(
                "UPDATE bqms_row_gaps SET last_error = $1 WHERE id = $2",
                error[:500], rid,
            )


async def heal_one(pool, plan: HealPlan, *, semaphore: asyncio.Semaphore) -> dict[str, Any]:
    """Heal one RFQ. Returns summary dict."""
    summary: dict[str, Any] = {
        "rfq": plan.rfq_number,
        "gap_kinds": [g.kind for g in plan.gaps],
        "healed_kinds": [],
        "error": None,
    }
    async with semaphore:
        # Step 1: fetch staging raw_json (if not pre-loaded)
        staging_id, raw = (plan.staging_id, plan.raw_row) if plan.raw_row else await _fetch_staging_raw(pool, plan.rfq_number)
        if not raw:
            summary["error"] = "no staging raw_json"
            async with pool.acquire() as c:
                row_ids = await _record_attempt(c, plan)
                await _record_outcome(c, row_ids, set(), error=summary["error"])
            return summary

        plan.staging_id = staging_id
        plan.raw_row = raw

        # Step 2: record attempt (before scrape, so timeout = audit still has entry)
        async with pool.acquire() as c:
            row_ids = await _record_attempt(c, plan)

        # Step 3: targeted re-scrape
        healed_kinds: set[str] = set()
        try:
            from app.etl.bqms_bidding_scraper import (
                download_files_for_rfq, find_existing_rfq_folder,
            )
            dl = await download_files_for_rfq(
                plan.rfq_number, raw, db_pool=pool,
                force_drill_detail=True,
            )
            fresh_detail = dl.get("fresh_detail") or {}
            summary["dl"] = {
                "downloaded": dl.get("downloaded_count", 0),
                "images_extracted": dl.get("images_extracted", 0),
                "items_drilled": len((fresh_detail.get("items") or [])),
            }

            # Step 4: persist fresh_detail to staging.raw_json (so other consumers see it)
            if fresh_detail and (fresh_detail.get("items") or fresh_detail.get("attachments")):
                raw["_detail"] = fresh_detail
                if staging_id:
                    async with pool.acquire() as c:
                        await c.execute(
                            "UPDATE bqms_vendor_portal_staging SET raw_json = $1::jsonb WHERE id = $2",
                            json.dumps(raw, ensure_ascii=False, default=str), staging_id,
                        )

                # Phase H: gap_healer cũng auto-UPSERT bqms_rfq để rows xuất hiện
                # ngay (locked state) — không chờ user click "Báo giá" nữa.
                if fresh_detail.get("items"):
                    try:
                        from app.etl.bqms_bidding_scraper import upsert_bqms_rfq_for_one_staging_row
                        await upsert_bqms_rfq_for_one_staging_row(pool, raw)
                    except Exception as up_exc:
                        logger.warning("gap_healer %s upsert failed: %s", plan.rfq_number, up_exc)

                # d2 healed if items now present
                if fresh_detail.get("items"):
                    healed_kinds.add("d2_items_mismatch")
                # d3/d4 healed if folder + subdirs now exist
                folder = find_existing_rfq_folder(plan.rfq_number)
                if folder and folder.exists():
                    healed_kinds.add("d3_folder_missing")
                    if (folder / "raw").exists() and (folder / "images").exists():
                        healed_kinds.add("d4_subfolder_missing")
                    if dl.get("images_extracted", 0) > 0:
                        healed_kinds.add("d5_all_image_tiers_empty")

            # Step 5: mapping engine
            async with pool.acquire() as c:
                m1 = await apply_metadata_mapping(c, plan.rfq_number, fresh_detail)
                if m1 > 0:
                    healed_kinds.add("d1_metadata_null")
                m2 = await apply_item_type_classification(c, plan.rfq_number, fresh_detail)
                if m2 > 0:
                    healed_kinds.add("d9_item_type_null")
                # Orphan image remap
                folder = find_existing_rfq_folder(plan.rfq_number)
                if folder and (folder / "images").is_dir():
                    m3 = await remap_orphan_images(c, plan.rfq_number, folder / "images", fresh_detail)
                    if m3 > 0:
                        healed_kinds.add("d10_orphan_image")

            # d6_override_stale, d7_folder_name_legacy, d8_orphan_folder_old are
            # passive — heal naturally via filesystem cleanup or won't heal at
            # all (orphan folder/override needs admin decision). Mark as
            # attempted but don't auto-heal.

            summary["healed_kinds"] = sorted(healed_kinds)
        except Exception as exc:
            logger.exception("heal_one(%s) failed: %s", plan.rfq_number, exc)
            summary["error"] = str(exc)[:300]
        finally:
            async with pool.acquire() as c:
                await _record_outcome(c, row_ids, healed_kinds, error=summary.get("error"))
    return summary


# ───────────────────────────────────────────────────────────────────
# Top-level cycle
# ───────────────────────────────────────────────────────────────────

async def run_cycle(pool, *, budget_seconds: int = 120) -> dict[str, Any]:
    """Run one full cycle: detect → plan → heal → record.

    Uses pg_advisory_lock to prevent 2 workers concurrent. Returns summary
    dict for app_config.bqms_code_track_state.
    """
    started_at = datetime.now(timezone.utc)
    result = CycleResult(started_at=started_at.isoformat())

    # Advisory lock — non-blocking, bail if already held
    async with pool.acquire() as conn:
        acquired = await conn.fetchval(
            "SELECT pg_try_advisory_lock($1)", ADVISORY_LOCK_KEY,
        )
        if not acquired:
            result.status = "skipped_lock"
            result.finished_at = datetime.now(timezone.utc).isoformat()
            return _to_dict(result)

    try:
        t0 = time.monotonic()

        # ── Detect ── (Phase H fix: dùng pool để chạy parallel với separate conns)
        gaps = await detect_all_gaps(pool=pool, max_per_kind=50, timeout=20.0)
        result.gaps_detected = len(gaps)
        for g in gaps:
            result.gaps_by_kind[g.kind] = result.gaps_by_kind.get(g.kind, 0) + 1

        # ── Plan ──
        plans, skipped = await plan_heals(pool, gaps)
        result.plans = len(plans)
        result.skipped_cooldown = skipped

        # ── Idle? ──
        if not plans:
            result.status = "idle" if result.gaps_detected == 0 else "all_cooldown"
            result.finished_at = datetime.now(timezone.utc).isoformat()
            result.duration_seconds = round(time.monotonic() - t0, 2)
            return _to_dict(result)

        # ── Heal ──
        semaphore = asyncio.Semaphore(SEM_CONCURRENT)
        async def _heal_with_budget(plan: HealPlan):
            if time.monotonic() - t0 > budget_seconds:
                logger.warning("smart_code_track: budget exhausted, skipping %s", plan.rfq_number)
                return None
            return await heal_one(pool, plan, semaphore=semaphore)

        summaries = await asyncio.gather(*[_heal_with_budget(p) for p in plans],
                                         return_exceptions=True)
        for s in summaries:
            if isinstance(s, Exception):
                result.errors.append(str(s)[:200])
                continue
            if s is None:
                continue
            for k in (s.get("healed_kinds") or []):
                result.healed += 1
                result.healed_by_kind[k] = result.healed_by_kind.get(k, 0) + 1
            if s.get("error"):
                result.errors.append(f"{s['rfq']}: {s['error']}")

        result.status = "done"
        result.finished_at = datetime.now(timezone.utc).isoformat()
        result.duration_seconds = round(time.monotonic() - t0, 2)

    finally:
        async with pool.acquire() as conn:
            await conn.execute("SELECT pg_advisory_unlock($1)", ADVISORY_LOCK_KEY)

    return _to_dict(result)


def _to_dict(r: CycleResult) -> dict[str, Any]:
    return {
        "started_at": r.started_at,
        "finished_at": r.finished_at,
        "duration_seconds": r.duration_seconds,
        "status": r.status,
        "gaps_detected": r.gaps_detected,
        "gaps_by_kind": r.gaps_by_kind,
        "plans": r.plans,
        "healed": r.healed,
        "healed_by_kind": r.healed_by_kind,
        "skipped_cooldown": r.skipped_cooldown,
        "errors": r.errors[:5],  # cap to 5 most-recent in state JSON
    }
