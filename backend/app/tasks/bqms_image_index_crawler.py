"""Periodic crawler that populates `bqms_image_index` table.

Walks `/data/onedrive-staging/Puplic/BQMS/RFQ/RFQ {y}/THANG {m}/<rfq>_*/images/`
and `/data/quote-overrides/<rfq>/` → upserts (bqms_code, image_path, source).

Runs every 6 hours via Procrastinate cron. Idempotent — re-upserts existing
rows (refresh mtime/size) and prunes stale entries (file no longer exists).

Lookup latency goes from O(folder traversal) to O(1) DB index query.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)

RFQ_ROOT = Path("/data/onedrive-staging/Puplic/BQMS/RFQ")
OVERRIDE_ROOT = Path("/data/quote-overrides")

_IMG_EXTS = (".png", ".jpg", ".jpeg", ".gif")

# Regex to extract BQMS code from filename: matches `Z0000002-385323_*.png` style
# OR `Z0000002-385323.png` exact.
_BQMS_CODE_RE = re.compile(r"^([A-Z0-9][A-Z0-9_\-]{4,40}?)(?:_|\.|$)", re.IGNORECASE)


@app.periodic(cron="15 */6 * * *")  # every 6 hours at :15
@app.task(name="bqms_image_index_crawl", queue="default", queueing_lock="bqms_image_index_crawl")
def bqms_image_index_crawl(timestamp: int = 0) -> dict[str, Any]:
    """Walk RFQ_ROOT + OVERRIDE_ROOT, upsert into bqms_image_index, prune stale."""
    started = time.time()
    stats = {"scanned": 0, "upserted": 0, "pruned": 0, "errors": 0}

    rows: list[tuple] = []

    # ─── Walk RFQ_ROOT ─────────────────────────────────────────────
    if RFQ_ROOT.is_dir():
        try:
            now = datetime.now()
            # Limit to last 2 years (older RFQs rarely re-delivered)
            for y in (now.year, now.year - 1):
                year_root = RFQ_ROOT / f"RFQ {y}"
                if not year_root.is_dir():
                    continue
                for m_root in year_root.iterdir():
                    if not m_root.is_dir():
                        continue
                    for rfq_dir in m_root.iterdir():
                        if not rfq_dir.is_dir():
                            continue
                        images_dir = rfq_dir / "images"
                        if not images_dir.is_dir():
                            continue
                        # Try to extract RFQ number from folder name prefix
                        rfq_num = rfq_dir.name.split("_")[0] if "_" in rfq_dir.name else rfq_dir.name
                        for ext in _IMG_EXTS:
                            for p in images_dir.glob(f"*{ext}"):
                                stats["scanned"] += 1
                                if p.name.lower().startswith("_unverified_"):
                                    continue
                                code = _extract_bqms_code(p.name)
                                if not code:
                                    continue
                                try:
                                    st = p.stat()
                                    rows.append((
                                        code, str(p), "rfq", rfq_num,
                                        st.st_size,
                                        datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
                                    ))
                                except OSError as exc:
                                    logger.warning("stat %s failed: %s", p, exc)
                                    stats["errors"] += 1
        except Exception:
            logger.exception("RFQ_ROOT scan top-level fail")
            stats["errors"] += 1

    # ─── Walk OVERRIDE_ROOT ────────────────────────────────────────
    if OVERRIDE_ROOT.is_dir():
        try:
            for ovr_dir in OVERRIDE_ROOT.iterdir():
                if not ovr_dir.is_dir():
                    continue
                rfq_num = ovr_dir.name
                for ext in _IMG_EXTS:
                    # Override naming: {bqms_code}__product_photo.{ext}
                    for p in ovr_dir.glob(f"*__product_photo{ext}"):
                        stats["scanned"] += 1
                        # Extract code before "__product_photo"
                        stem = p.name.rsplit("__product_photo", 1)[0]
                        if not stem:
                            continue
                        try:
                            st = p.stat()
                            rows.append((
                                stem, str(p), "override", rfq_num,
                                st.st_size,
                                datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
                            ))
                        except OSError as exc:
                            logger.warning("stat override %s failed: %s", p, exc)
                            stats["errors"] += 1
        except Exception:
            logger.exception("OVERRIDE_ROOT scan top-level fail")
            stats["errors"] += 1

    # ─── Upsert into DB ────────────────────────────────────────────
    if rows:
        try:
            with psycopg2.connect(SYNC_DSN, connect_timeout=10) as conn:
                with conn.cursor() as cur:
                    cur.executemany(
                        """
                        INSERT INTO bqms_image_index
                            (bqms_code, image_path, source, rfq_number, file_size, mtime, indexed_at)
                        VALUES (%s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT (bqms_code, image_path) DO UPDATE SET
                            source     = EXCLUDED.source,
                            rfq_number = EXCLUDED.rfq_number,
                            file_size  = EXCLUDED.file_size,
                            mtime      = EXCLUDED.mtime,
                            indexed_at = NOW()
                        """,
                        rows,
                    )
                    stats["upserted"] = cur.rowcount
                    # Prune stale entries (not seen this crawl + older than 24h)
                    cur.execute(
                        "DELETE FROM bqms_image_index WHERE indexed_at < NOW() - INTERVAL '24 hours'"
                    )
                    stats["pruned"] = cur.rowcount
                    conn.commit()
        except Exception as exc:
            logger.exception("DB upsert/prune failed")
            stats["errors"] += 1
            stats["db_error"] = str(exc)[:200]

    stats["duration_sec"] = round(time.time() - started, 2)
    logger.info("bqms_image_index_crawl done: %s", stats)
    return stats


def _extract_bqms_code(filename: str) -> str | None:
    """Extract BQMS code from image filename.

    Examples:
      "Z0000002-385323_1.png"        → "Z0000002-385323"
      "Z0000002-385323.png"          → "Z0000002-385323"
      "Z0000002-385323__detail.jpg"  → "Z0000002-385323"
    """
    # Strip extension
    stem = filename.rsplit(".", 1)[0]
    # Handle double-underscore separator first (override convention)
    if "__" in stem:
        stem = stem.split("__", 1)[0]
    # Then handle single-underscore (RFQ convention "{code}_{seq}")
    parts = stem.split("_", 1)
    candidate = parts[0]
    # Basic sanity — must contain at least one digit + length 6-40
    if not re.search(r"\d", candidate) or not (6 <= len(candidate) <= 40):
        return None
    return candidate
