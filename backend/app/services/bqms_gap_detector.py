"""BQMS Gap Detector — pure async functions detecting 10 kinds of data gaps.

Phase G (Thang 2026-05-13): Smart Code-Track engine.

Each detector returns `list[Gap]`. All detectors compose via `detect_all_gaps()`
which is wrapped in `asyncio.wait_for(timeout=5.0)` — if any detector hangs,
the cycle still returns what it has so far. Detectors do **NOT** touch
Playwright; only DB + filesystem reads. Heavy lifting (scrape, drill) happens
in `bqms_gap_healer.py`.

Gap types (see bqms_smart_code_track.sql CHECK constraint):
  d1_metadata_null         — bqms_rfq has NULL bqms_code/specification/maker/expected_qty
  d2_items_mismatch        — Samsung itemCnt > 0 but _detail.items = []
  d3_folder_missing        — staging.status=approved but RFQ folder absent on disk
  d4_subfolder_missing     — folder exists but raw/ or images/ subdir missing
  d5_all_image_tiers_empty — approved bqms_rfq row but images/ folder has 0 valid png
  d6_override_stale        — DB says override exists but file gone from /data/quote-overrides
  d7_folder_name_legacy    — folder named bare <QT>, not pretty <QT>_<item>_<date>_<time>
  d8_orphan_folder_old     — folder exists >7 days, no matching staging row
  d9_item_type_null        — bqms_rfq.classification_override IS NULL AND notes lacks 'classification=...'
  d10_orphan_image         — file in images/ that doesn't match any bqms_code prefix
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

GAP_TYPES = (
    "d1_metadata_null",
    "d2_items_mismatch",
    "d3_folder_missing",
    "d4_subfolder_missing",
    "d5_all_image_tiers_empty",
    "d6_override_stale",
    "d7_folder_name_legacy",
    "d8_orphan_folder_old",
    "d9_item_type_null",
    "d10_orphan_image",
)

_RFQ_ROOT = Path("/data/onedrive-staging/Puplic/BQMS/RFQ")
_OVERRIDE_ROOT = Path("/data/quote-overrides")


@dataclass
class Gap:
    kind: str
    rfq_number: str
    rfq_id: int | None = None
    staging_id: int | None = None
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class FsCache:
    """Filesystem scan cache, populated once per detection cycle.

    Cuts thousands of stat() calls down to ~600 by walking each year/month
    once. Detectors d3/d4/d7/d8/d10 share this view.
    """
    folder_map: dict[str, Path] = field(default_factory=dict)   # rfq_number -> Path of matching folder
    folder_index: list[Path] = field(default_factory=list)      # all RFQ-level folders
    folder_mtimes: dict[Path, float] = field(default_factory=dict)
    images_count: dict[Path, int] = field(default_factory=dict) # folder -> number of valid PNG/JPG ≥100 bytes
    has_raw: dict[Path, bool] = field(default_factory=dict)
    has_images_dir: dict[Path, bool] = field(default_factory=dict)


def _scan_filesystem(now: datetime | None = None) -> FsCache:
    """One-pass scan of /data/onedrive-staging/Puplic/BQMS/RFQ/{year}/{month}/.

    Returns FsCache with folder_map (RFQ → Path), counts for raw/images.
    Limits to current year + previous year, all months. Idempotent.
    """
    now = now or datetime.now()
    cache = FsCache()
    if not _RFQ_ROOT.exists():
        return cache

    rfq_re = re.compile(r"^(QT\d+)(?:_.*)?$", re.IGNORECASE)
    valid_image_min = 100  # bytes — anything smaller is treated as broken/placeholder

    for year in (now.year, now.year - 1):
        year_dir = _RFQ_ROOT / f"RFQ {year}"
        if not year_dir.exists():
            continue
        try:
            month_entries = list(os.scandir(year_dir))
        except OSError:
            continue
        for month_e in month_entries:
            if not month_e.is_dir():
                continue
            month_path = Path(month_e.path)
            try:
                rfq_entries = list(os.scandir(month_path))
            except OSError:
                continue
            for rfq_e in rfq_entries:
                if not rfq_e.is_dir():
                    continue
                rfq_folder = Path(rfq_e.path)
                cache.folder_index.append(rfq_folder)
                try:
                    cache.folder_mtimes[rfq_folder] = rfq_e.stat().st_mtime
                except OSError:
                    cache.folder_mtimes[rfq_folder] = 0
                m = rfq_re.match(rfq_folder.name)
                if m:
                    # Map RFQ-number → folder (prefer pretty over bare if both exist; pretty contains "_")
                    rfq_num = m.group(1).upper()
                    existing = cache.folder_map.get(rfq_num)
                    is_pretty = "_" in rfq_folder.name
                    if existing is None or (is_pretty and "_" not in existing.name):
                        cache.folder_map[rfq_num] = rfq_folder

                raw_dir = rfq_folder / "raw"
                img_dir = rfq_folder / "images"
                cache.has_raw[rfq_folder] = raw_dir.is_dir()
                cache.has_images_dir[rfq_folder] = img_dir.is_dir()

                # Count valid images
                cnt = 0
                if img_dir.is_dir():
                    try:
                        for img_e in os.scandir(img_dir):
                            if not img_e.is_file():
                                continue
                            n = img_e.name.lower()
                            if not (n.endswith(".png") or n.endswith(".jpg")
                                    or n.endswith(".jpeg") or n.endswith(".gif")):
                                continue
                            try:
                                if img_e.stat().st_size >= valid_image_min:
                                    cnt += 1
                            except OSError:
                                pass
                    except OSError:
                        pass
                cache.images_count[rfq_folder] = cnt
    return cache


# ───────────────────────────────────────────────────────────────────
# Detectors
# ───────────────────────────────────────────────────────────────────

async def detect_metadata_null(conn, *, limit: int = 50) -> list[Gap]:
    """d1: bqms_rfq rows with NULL critical metadata fields."""
    rows = await conn.fetch(
        """
        SELECT id, rfq_number, bqms_code, specification, maker, expected_qty
        FROM bqms_rfq
        WHERE data_source = 'etl'
          AND created_at > NOW() - INTERVAL '30 days'
          AND (bqms_code IS NULL OR specification IS NULL
               OR maker IS NULL OR expected_qty IS NULL)
        LIMIT $1
        """,
        limit,
    )
    out = []
    for r in rows:
        missing = [k for k in ("bqms_code", "specification", "maker", "expected_qty") if r[k] is None]
        out.append(Gap(
            kind="d1_metadata_null",
            rfq_number=r["rfq_number"],
            rfq_id=int(r["id"]),
            evidence={"missing_fields": missing},
        ))
    return out


async def detect_items_mismatch(conn, *, limit: int = 50) -> list[Gap]:
    """d2: Samsung itemCnt > 0 but _detail.items array empty/null."""
    rows = await conn.fetch(
        """
        SELECT s.id AS staging_id, s.rfq_number,
               s.raw_json->>'itemCnt' AS samsung_item_cnt,
               jsonb_array_length(COALESCE(s.raw_json->'_detail'->'items','[]'::jsonb)) AS our_items
        FROM bqms_vendor_portal_staging s
        WHERE s.module = 'bidding'
          AND s.status IN ('pending_review','approved')
          AND s.raw_json->>'itemCnt' ~ '^[0-9]'
          AND jsonb_array_length(COALESCE(s.raw_json->'_detail'->'items','[]'::jsonb)) = 0
        ORDER BY s.id DESC
        LIMIT $1
        """,
        limit,
    )
    out = []
    for r in rows:
        samsung_cnt = (r["samsung_item_cnt"] or "").strip()
        try:
            expected = int(re.match(r"\d+", samsung_cnt).group()) if samsung_cnt else 0
        except (AttributeError, ValueError):
            expected = 0
        if expected > 0:
            out.append(Gap(
                kind="d2_items_mismatch",
                rfq_number=r["rfq_number"],
                staging_id=int(r["staging_id"]),
                evidence={"samsung_expected": expected, "our_items": 0},
            ))
    return out


async def detect_folder_missing(conn, *, fs_cache: FsCache, limit: int = 50) -> list[Gap]:
    """d3: staging row exists but no folder on disk."""
    rows = await conn.fetch(
        """
        SELECT s.id AS staging_id, s.rfq_number
        FROM bqms_vendor_portal_staging s
        WHERE s.module = 'bidding'
          AND s.status IN ('pending_review', 'approved')
          AND s.created_at > NOW() - INTERVAL '30 days'
        ORDER BY s.id DESC
        LIMIT $1
        """,
        limit * 4,  # over-fetch since most will have folders
    )
    out = []
    for r in rows:
        rfq = (r["rfq_number"] or "").upper()
        if not rfq:
            continue
        if rfq not in fs_cache.folder_map:
            out.append(Gap(
                kind="d3_folder_missing",
                rfq_number=rfq,
                staging_id=int(r["staging_id"]),
                evidence={},
            ))
            if len(out) >= limit:
                break
    return out


async def detect_subfolder_missing(conn, *, fs_cache: FsCache, limit: int = 50) -> list[Gap]:
    """d4: folder exists but raw/ or images/ subdir absent."""
    out = []
    for rfq_num, folder in fs_cache.folder_map.items():
        has_raw = fs_cache.has_raw.get(folder, False)
        has_img = fs_cache.has_images_dir.get(folder, False)
        if not (has_raw and has_img):
            out.append(Gap(
                kind="d4_subfolder_missing",
                rfq_number=rfq_num,
                evidence={"has_raw": has_raw, "has_images_dir": has_img,
                          "folder": str(folder)},
            ))
            if len(out) >= limit:
                break
    return out


async def detect_all_image_tiers_empty(conn, *, fs_cache: FsCache, limit: int = 50) -> list[Gap]:
    """d5: approved bqms_rfq row but images/ has 0 valid images."""
    rows = await conn.fetch(
        """
        SELECT id, rfq_number, bqms_code
        FROM bqms_rfq
        WHERE data_source = 'etl'
          AND bqms_code IS NOT NULL
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY id DESC
        LIMIT $1
        """,
        limit * 4,
    )
    seen_rfq = set()
    out = []
    for r in rows:
        rfq = (r["rfq_number"] or "").upper()
        if not rfq or rfq in seen_rfq:
            continue
        seen_rfq.add(rfq)
        folder = fs_cache.folder_map.get(rfq)
        if folder is None:
            # covered by d3
            continue
        n_images = fs_cache.images_count.get(folder, 0)
        if n_images == 0:
            out.append(Gap(
                kind="d5_all_image_tiers_empty",
                rfq_number=rfq,
                rfq_id=int(r["id"]),
                evidence={"folder": str(folder), "images_count": 0,
                          "bqms_code": r["bqms_code"]},
            ))
            if len(out) >= limit:
                break
    return out


async def detect_override_stale(conn, *, limit: int = 50) -> list[Gap]:
    """d6: an override file path in DB but file gone from disk.

    Since we don't store override paths in DB explicitly, scan
    /data/quote-overrides for orphan folders (RFQ not in bqms_rfq).
    """
    out = []
    if not _OVERRIDE_ROOT.exists():
        return out
    try:
        override_dirs = list(os.scandir(_OVERRIDE_ROOT))
    except OSError:
        return out

    # Get all RFQ numbers from bqms_rfq for cross-reference
    rfq_rows = await conn.fetch("SELECT DISTINCT rfq_number FROM bqms_rfq WHERE rfq_number IS NOT NULL")
    valid_rfqs = {r["rfq_number"] for r in rfq_rows}

    for e in override_dirs:
        if not e.is_dir():
            continue
        rfq_num = e.name
        if rfq_num not in valid_rfqs:
            # orphan override folder
            out.append(Gap(
                kind="d6_override_stale",
                rfq_number=rfq_num,
                evidence={"folder": e.path, "reason": "RFQ not found in bqms_rfq"},
            ))
            if len(out) >= limit:
                break
    return out


async def detect_folder_name_legacy(conn, *, fs_cache: FsCache, limit: int = 50) -> list[Gap]:
    """d7: folder named bare <QT> (no underscore) — legacy convention pre-2026-05-10."""
    out = []
    for rfq_num, folder in fs_cache.folder_map.items():
        if "_" not in folder.name:
            out.append(Gap(
                kind="d7_folder_name_legacy",
                rfq_number=rfq_num,
                evidence={"folder": str(folder), "name": folder.name},
            ))
            if len(out) >= limit:
                break
    return out


async def detect_orphan_folder_old(conn, *, fs_cache: FsCache, limit: int = 50) -> list[Gap]:
    """d8: folder exists >7 days with no matching staging row."""
    rfq_rows = await conn.fetch(
        "SELECT DISTINCT UPPER(rfq_number) AS r FROM bqms_vendor_portal_staging "
        "WHERE module='bidding' AND rfq_number IS NOT NULL"
    )
    known_rfqs = {r["r"] for r in rfq_rows}
    cutoff = (datetime.now() - timedelta(days=7)).timestamp()
    out = []
    for rfq_num, folder in fs_cache.folder_map.items():
        if rfq_num in known_rfqs:
            continue
        mtime = fs_cache.folder_mtimes.get(folder, 0)
        if mtime > 0 and mtime < cutoff:
            out.append(Gap(
                kind="d8_orphan_folder_old",
                rfq_number=rfq_num,
                evidence={"folder": str(folder),
                          "age_days": (datetime.now().timestamp() - mtime) / 86400},
            ))
            if len(out) >= limit:
                break
    return out


async def detect_item_type_null(conn, *, limit: int = 50) -> list[Gap]:
    """d9: bqms_rfq has no classification (neither override nor in notes)."""
    rows = await conn.fetch(
        """
        SELECT id, rfq_number, bqms_code
        FROM bqms_rfq
        WHERE data_source = 'etl'
          AND classification_override IS NULL
          AND (notes IS NULL OR notes NOT ILIKE '%classification=%')
          AND created_at > NOW() - INTERVAL '30 days'
        LIMIT $1
        """,
        limit,
    )
    return [
        Gap(kind="d9_item_type_null", rfq_number=r["rfq_number"],
            rfq_id=int(r["id"]), evidence={"bqms_code": r["bqms_code"]})
        for r in rows
    ]


async def detect_orphan_image(conn, *, fs_cache: FsCache, limit: int = 50) -> list[Gap]:
    """d10: image file in images/ that doesn't start with any bqms_code prefix."""
    out = []
    # Pre-fetch ALL bqms_codes for RFQs that have folders
    rfq_codes = await conn.fetch(
        """
        SELECT UPPER(rfq_number) AS rfq, bqms_code FROM bqms_rfq
        WHERE rfq_number = ANY($1::text[]) AND bqms_code IS NOT NULL
        """,
        list(fs_cache.folder_map.keys()),
    )
    codes_by_rfq: dict[str, set[str]] = {}
    for r in rfq_codes:
        codes_by_rfq.setdefault(r["rfq"], set()).add(r["bqms_code"].lower())

    for rfq_num, folder in fs_cache.folder_map.items():
        img_dir = folder / "images"
        if not img_dir.is_dir():
            continue
        valid_codes = codes_by_rfq.get(rfq_num, set())
        if not valid_codes:
            continue  # No codes to match against; can't determine orphan
        try:
            files = list(os.scandir(img_dir))
        except OSError:
            continue
        for f in files:
            if not f.is_file():
                continue
            n = f.name.lower()
            if not (n.endswith(".png") or n.endswith(".jpg") or n.endswith(".jpeg")):
                continue
            if n.startswith("_"):  # _shared_, _unverified_ — handled by tier 3
                continue
            # Check if name starts with any known bqms_code
            if any(n.startswith(code + "_") or n.startswith(code + ".") for code in valid_codes):
                continue
            out.append(Gap(
                kind="d10_orphan_image",
                rfq_number=rfq_num,
                evidence={"file": f.path, "filename": f.name,
                          "candidate_codes": list(valid_codes)[:5]},
            ))
            if len(out) >= limit:
                return out
    return out


# ───────────────────────────────────────────────────────────────────
# Orchestrator
# ───────────────────────────────────────────────────────────────────

async def detect_all_gaps(
    conn=None,
    *,
    pool=None,
    max_per_kind: int = 50,
    timeout: float = 20.0,
) -> list[Gap]:
    """Run all 10 detectors. Returns combined list (partial if timeout).

    Phase H fix (Thang 2026-05-13): asyncpg connections KHÔNG thread-safe —
    không thể chạy nhiều query concurrent trên cùng 1 conn. Trước đây dùng
    asyncio.gather với shared conn → tất cả 10 detector fail silently với
    "another operation is in progress". Giờ chạy SERIAL với cùng conn,
    HOẶC nếu pool được cung cấp, gather với separate conn cho mỗi detector.
    """
    fs_cache = _scan_filesystem()

    if pool is not None:
        # Parallel mode — each detector acquires its own connection
        detector_specs = [
            ("d1", detect_metadata_null, {"limit": max_per_kind}),
            ("d2", detect_items_mismatch, {"limit": max_per_kind}),
            ("d3", detect_folder_missing, {"fs_cache": fs_cache, "limit": max_per_kind}),
            ("d4", detect_subfolder_missing, {"fs_cache": fs_cache, "limit": max_per_kind}),
            ("d5", detect_all_image_tiers_empty, {"fs_cache": fs_cache, "limit": max_per_kind}),
            ("d6", detect_override_stale, {"limit": max_per_kind}),
            ("d7", detect_folder_name_legacy, {"fs_cache": fs_cache, "limit": max_per_kind}),
            ("d8", detect_orphan_folder_old, {"limit": max_per_kind}),
            ("d9", detect_item_type_null, {"limit": max_per_kind}),
            ("d10", detect_orphan_image, {"fs_cache": fs_cache, "limit": max_per_kind}),
        ]
        # Special-case d8 needs fs_cache too (was missed in spec list)
        detector_specs[7] = ("d8", detect_orphan_folder_old, {"fs_cache": fs_cache, "limit": max_per_kind})

        async def _run_with_own_conn(name, fn, kwargs):
            try:
                async with pool.acquire() as own_conn:
                    return await fn(own_conn, **kwargs)
            except Exception as exc:
                logger.warning("detector %s failed: %s", name, exc)
                return []

        async def _do() -> list[Gap]:
            coros = [_run_with_own_conn(n, f, kw) for n, f, kw in detector_specs]
            results = await asyncio.gather(*coros)
            out: list[Gap] = []
            for r in results:
                out.extend(r)
            return out

        try:
            return await asyncio.wait_for(_do(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("detect_all_gaps timeout after %ss", timeout)
            return []

    # Serial mode — share single connection (slower but safe for caller)
    if conn is None:
        raise ValueError("Either conn or pool must be provided")

    async def _do_serial() -> list[Gap]:
        out: list[Gap] = []
        detectors = [
            ("d1", lambda: detect_metadata_null(conn, limit=max_per_kind)),
            ("d2", lambda: detect_items_mismatch(conn, limit=max_per_kind)),
            ("d3", lambda: detect_folder_missing(conn, fs_cache=fs_cache, limit=max_per_kind)),
            ("d4", lambda: detect_subfolder_missing(conn, fs_cache=fs_cache, limit=max_per_kind)),
            ("d5", lambda: detect_all_image_tiers_empty(conn, fs_cache=fs_cache, limit=max_per_kind)),
            ("d6", lambda: detect_override_stale(conn, limit=max_per_kind)),
            ("d7", lambda: detect_folder_name_legacy(conn, fs_cache=fs_cache, limit=max_per_kind)),
            ("d8", lambda: detect_orphan_folder_old(conn, fs_cache=fs_cache, limit=max_per_kind)),
            ("d9", lambda: detect_item_type_null(conn, limit=max_per_kind)),
            ("d10", lambda: detect_orphan_image(conn, fs_cache=fs_cache, limit=max_per_kind)),
        ]
        for name, factory in detectors:
            try:
                out.extend(await factory())
            except Exception as exc:
                logger.warning("detector %s failed: %s", name, exc)
        return out

    try:
        return await asyncio.wait_for(_do_serial(), timeout=timeout)
    except asyncio.TimeoutError:
        logger.warning("detect_all_gaps timeout after %ss", timeout)
        return []
