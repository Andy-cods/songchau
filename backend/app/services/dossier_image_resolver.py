"""Smart image resolver v2 for BQMS dossier feature.

Lookup priority (in order):
  1. DB index `bqms_image_index` (fast, O(1) — populated by cron crawler)
  2. Fuzzy variants: strip suffix, common suffixes, base-form match
  3. File system fallback (Tier 0/1 from v1)
  4. Broad scan (slow path — last resort)

The DB index is populated by the periodic crawler
`crawl_bqms_image_index` (every 6h). Lookup hits index for ~99%
of cases; filesystem fallback only when index stale.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from pathlib import Path

import psycopg2

logger = logging.getLogger(__name__)

RFQ_ROOT = Path("/data/onedrive-staging/Puplic/BQMS/RFQ")
OVERRIDE_ROOT = Path("/data/quote-overrides")

_IMG_EXTS = (".png", ".jpg", ".jpeg", ".gif")

# In-process LRU-style cache (per-worker, short-lived) — avoids hammering DB
# when same bqms_code appears in multiple POs in one job.
_LOOKUP_CACHE: dict[str, tuple[Path | None, float]] = {}
_CACHE_TTL_SEC = 600  # 10 min


def _cache_get(key: str) -> Path | None | object:
    ent = _LOOKUP_CACHE.get(key)
    if not ent:
        return _MISS
    path, ts = ent
    if time.time() - ts > _CACHE_TTL_SEC:
        _LOOKUP_CACHE.pop(key, None)
        return _MISS
    return path


def _cache_put(key: str, path: Path | None) -> None:
    _LOOKUP_CACHE[key] = (path, time.time())


_MISS = object()  # cache miss sentinel


def find_system_image(
    bqms_code: str,
    rfq_number: str | None = None,
    year: int | None = None,
    month: int | None = None,
    dsn: str | None = None,
) -> Path | None:
    """Smart find — DB index → fuzzy → filesystem fallback.

    `dsn`: optional Postgres DSN (sync). If None, falls back to filesystem-only.
    """
    bqms_code = (bqms_code or "").strip()
    if not bqms_code:
        return None

    # Cache check (per-worker LRU)
    cached = _cache_get(bqms_code)
    if cached is not _MISS:
        return cached  # type: ignore

    # Resolve DSN lazily
    if dsn is None:
        try:
            from app.core.procrastinate_app import SYNC_DSN  # type: ignore
            dsn = SYNC_DSN
        except Exception:
            dsn = None

    # Layer 1: DB index — fast path
    if dsn:
        try:
            hit = _db_index_lookup(dsn, bqms_code)
            if hit:
                _cache_put(bqms_code, hit)
                return hit
        except Exception as exc:
            logger.warning("DB index lookup failed (fallthrough to FS): %s", exc)

    # Layer 2: fuzzy variants — try base form + common suffix permutations
    fuzzy_keys = _fuzzy_variants(bqms_code)
    if dsn:
        for k in fuzzy_keys:
            try:
                hit = _db_index_lookup(dsn, k)
                if hit:
                    logger.info("Image fuzzy match: %s → %s (via %s)", bqms_code, hit, k)
                    _cache_put(bqms_code, hit)
                    return hit
            except Exception:
                pass

    # Layer 3: filesystem fallback (legacy paths) — kept for resilience when index stale
    hit = _fs_fallback(bqms_code, rfq_number, year, month)
    if hit:
        _cache_put(bqms_code, hit)
        return hit

    # Layer 4: broad scan (slow — only if all above missed)
    hit = _broad_scan_rfq_images(bqms_code)
    _cache_put(bqms_code, hit)
    return hit


# ─── Layer 1: DB index lookup ──────────────────────────────────────


def _db_index_lookup(dsn: str, bqms_code: str) -> Path | None:
    """Look up image_path from bqms_image_index using priority view."""
    try:
        with psycopg2.connect(dsn, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT image_path FROM v_bqms_best_image WHERE bqms_code = %s LIMIT 1",
                    (bqms_code,),
                )
                row = cur.fetchone()
                if row:
                    p = Path(row[0])
                    if p.exists():
                        return p
                    # Stale entry — file deleted. Note for crawler.
                    logger.info("Stale image_index entry (file missing): %s", p)
    except psycopg2.OperationalError as exc:
        logger.warning("DB connect for image lookup failed: %s", exc)
    return None


# ─── Layer 2: fuzzy variants ───────────────────────────────────────


def _fuzzy_variants(bqms_code: str) -> list[str]:
    """Generate plausible variants of the BQMS code.

    Samsung BQMS codes follow pattern like `Z0000002-385323` or `Z00001-A`.
    Common variations:
      - Strip trailing version suffix: `-V1`, `-V2`, `-A`, etc.
      - Add common version suffix
      - Underscore vs dash
    """
    out: list[str] = []
    code = bqms_code.strip()
    if not code:
        return out

    # Strip trailing -V<n>, -<letter>, _old, etc.
    base = re.sub(r"[_-](V\d+|[A-Z]|old|new|rev\d*)$", "", code, flags=re.IGNORECASE)
    if base != code and base not in out:
        out.append(base)

    # Convert dash ↔ underscore
    if "-" in code:
        out.append(code.replace("-", "_"))
    if "_" in code:
        out.append(code.replace("_", "-"))

    # Common version suffixes
    for sfx in ("-V1", "-V2", "_V1", "-A", "-B"):
        v = code + sfx
        if v not in out:
            out.append(v)

    return out[:6]  # cap to 6 variants — avoid runaway DB queries


# ─── Layer 3: filesystem fallback ──────────────────────────────────


def _fs_fallback(
    bqms_code: str,
    rfq_number: str | None,
    year: int | None,
    month: int | None,
) -> Path | None:
    """Legacy filesystem search (Tier 0a/0b/1 from v1). Kept for when DB stale."""
    # Tier 0a: targeted override
    if rfq_number:
        ovr_dir = OVERRIDE_ROOT / rfq_number
        if ovr_dir.is_dir():
            for ext in _IMG_EXTS:
                ovr = ovr_dir / f"{bqms_code}__product_photo{ext}"
                if ovr.exists():
                    return ovr
    # Tier 0b: any override folder
    if OVERRIDE_ROOT.is_dir():
        for ovr_dir in OVERRIDE_ROOT.iterdir():
            if not ovr_dir.is_dir():
                continue
            for ext in _IMG_EXTS:
                ovr = ovr_dir / f"{bqms_code}__product_photo{ext}"
                if ovr.exists():
                    return ovr
    # Tier 1: RFQ-targeted
    if rfq_number:
        candidates = _scan_rfq_images(rfq_number, bqms_code, year, month)
        if candidates:
            return candidates[0]
    return None


def _scan_rfq_images(
    rfq_number: str,
    bqms_code: str,
    year: int | None,
    month: int | None,
) -> list[Path]:
    """Scan {rfq_number}_*/images/ for {bqms_code}_*."""
    now = datetime.now()
    years = [year] if year else [now.year, now.year - 1]
    months = [month] if month else list(range(12, 0, -1))

    out: list[Path] = []
    bqms_lower = bqms_code.lower()
    for y in years:
        year_root = RFQ_ROOT / f"RFQ {y}"
        if not year_root.is_dir():
            continue
        for m in months:
            month_root = year_root / f"THANG {m}"
            if not month_root.is_dir():
                continue
            for d in month_root.iterdir():
                if not d.is_dir():
                    continue
                # Pretty-name compat (Thang 2026-05-19/20): bare / `_` / ` ` prefix.
                if (d.name != rfq_number
                        and not d.name.startswith(f"{rfq_number}_")
                        and not d.name.startswith(f"{rfq_number} ")):
                    continue
                images_dir = d / "images"
                if not images_dir.is_dir():
                    continue
                tier1: list[Path] = []
                tier2: list[Path] = []
                for ext in _IMG_EXTS:
                    for p in images_dir.glob(f"*{ext}"):
                        nl = p.name.lower()
                        if nl.startswith(bqms_lower + "_") or nl.startswith(bqms_lower + "."):
                            tier1.append(p)
                        elif bqms_lower in nl:
                            tier2.append(p)
                tier1_clean = [p for p in tier1 if not p.name.lower().startswith("_unverified_")]
                if tier1_clean:
                    out.extend(sorted(tier1_clean))
                    return out
                if tier1:
                    out.extend(sorted(tier1))
                    return out
                if tier2:
                    out.extend(sorted(tier2))
                    return out
    return out


# ─── Layer 4: broad scan ───────────────────────────────────────────


def _broad_scan_rfq_images(bqms_code: str) -> Path | None:
    """Slow path — scan all RFQ folders for {bqms_code}_*."""
    if not RFQ_ROOT.is_dir():
        return None
    now = datetime.now()
    bqms_lower = bqms_code.lower()
    for y in (now.year, now.year - 1):
        year_root = RFQ_ROOT / f"RFQ {y}"
        if not year_root.is_dir():
            continue
        for m in range(12, 0, -1):
            month_root = year_root / f"THANG {m}"
            if not month_root.is_dir():
                continue
            for rfq_dir in month_root.iterdir():
                if not rfq_dir.is_dir():
                    continue
                images_dir = rfq_dir / "images"
                if not images_dir.is_dir():
                    continue
                for ext in _IMG_EXTS:
                    for p in images_dir.glob(f"*{ext}"):
                        nl = p.name.lower()
                        if (nl.startswith(bqms_lower + "_")
                                or nl.startswith(bqms_lower + ".")
                                or nl == bqms_lower + ext):
                            if not nl.startswith("_unverified_"):
                                return p
    return None


# ─── Read helper (unchanged) ───────────────────────────────────────


def read_image_bytes(path: Path | None) -> bytes | None:
    if not path or not path.exists():
        return None
    try:
        return path.read_bytes()
    except OSError as exc:
        logger.warning("read_image_bytes failed for %s: %s", path, exc)
        return None


def clear_lookup_cache() -> None:
    """Public helper — used by tests + after crawler completes."""
    _LOOKUP_CACHE.clear()
