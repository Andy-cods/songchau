"""BQMS Image endpoints — extracted from bqms.py (PR-2, Thang 2026-05-13).

This module handles 3 categories of image / file serving:

  1. RFQ folder browsing (`/bidding/folder`, `/bidding/folder/file`):
     - Lists files inside `/data/onedrive-staging/.../<RFQ>/raw/` and `.../images/`
     - Path-traversal guarded; resolves both legacy bare-name and new pretty-name folders.

  2. RFQ image lookup (`/rfq/image`):
     - Searches for the image associated with a given bqms_code (and optionally
       rfq_number), with tiered fallback to handle un-verified item codes.
     - When bqms_code is missing, returns the first image found inside the RFQ folder.

  3. Quote-form image overrides (`/quote-image-override` POST/DELETE/check):
     - User uploads to override the default auto-discovered image
       (product_photo / stamp / signature) when generating GC/TM quote files.
     - Files saved at `/data/quote-overrides/<RFQ>/<bqms_code>__<slot>.<ext>`.

Routes are mounted under `/api/v1/bqms` via v1_router.include_router so client
URLs remain unchanged from before the extraction.
"""
from __future__ import annotations

import hashlib
import logging
import re as _re
import time as _time
from datetime import datetime as _dt
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from app.core.rbac import require_role
from app.core.security import TokenData
from app.core.database import db_pool

logger = logging.getLogger(__name__)
router = APIRouter()

# Image extensions accepted everywhere in this module — lowercase, compared
# against `p.name.lower().endswith(...)` so filesystem casing (.PNG / .JPG)
# doesn't trip us up on case-sensitive Linux filesystems.
_IMG_EXTS_TUPLE = (".png", ".jpg", ".jpeg", ".gif")


def _image_etag(p: Path, extra: str = "") -> str:
    """Content-derived ETag: path + mtime_ns + size (+ optional extra key, e.g.
    bqms_code). Changes the instant the resolved file changes (re-pin / re-crop
    / re-upload all write a NEW file — see resolve_rfq_image_file priorities),
    so a conditional revalidation after this never serves a stale 304.
    """
    st = p.stat()
    raw = f"{extra}:{p}:{st.st_mtime_ns}:{st.st_size}"
    return 'W/"' + hashlib.sha1(raw.encode()).hexdigest()[:16] + '"'


def _file_response_cached(p: Path, request: Request, extra_etag_key: str = "") -> Response:
    """Serve an image file with browser-PRIVATE caching + ETag revalidation.

    W2-11 (Thang 2026-07-03): was unconditionally `no-store`, which forced the
    /bqms grid to re-download every row's thumbnail on every page visit (slow).

    Cache-Control: private, max-age=86400 —
      - `private` (NEVER `public`): a shared proxy/CDN must NOT cache this body
        across different users. Each user's <img> request already carries
        their own `?token=` (see BqmsImageThumb.tsx withToken()), so even a
        `public` cache would be keyed per-URL/per-user in practice, but we
        keep `private` as defense-in-depth against any misconfigured
        intermediary cache.
      - RBAC (`require_role(...)` Depends) has ALREADY run and can ALREADY
        have raised 403 before this function is ever called — for a
        conditional request too, since FastAPI resolves Depends before the
        route body runs on every single request, 304 included. Caching never
        bypasses auth.

    ETag lets a browser send `If-None-Match` after `max-age` expires and get a
    cheap 304 instead of re-downloading identical bytes. It also gives the FE
    an explicit "did the image actually change" signal to pair with the
    existing bustKey cache-bust (BqmsImageThumb sets `?_b=<n>` right after the
    user re-pins a primary image — a NEW url is always a cache MISS regardless
    of max-age, so re-pinned images show immediately without waiting for TTL).
    """
    etag = _image_etag(p, extra_etag_key)
    headers = {
        "Cache-Control": "private, max-age=86400",
        "ETag": etag,
        # Sentinel so main.py's security_headers middleware knows NOT to
        # overwrite the Cache-Control above (it strips this header before the
        # response leaves the server — see main.py W2-11 comment). Set on the
        # 304 branch too: a 304 Not-Modified has no Content-Type per HTTP
        # spec, so content-type sniffing would miss exactly the response most
        # worth keeping cacheable.
        "X-SC-Image-Cache": "1",
    }
    inm = request.headers.get("if-none-match")
    if inm and etag in (t.strip() for t in inm.split(",")):
        return Response(status_code=304, headers=headers)
    return FileResponse(path=str(p), filename=p.name, headers=headers)


def _not_found_no_store(detail: str) -> JSONResponse:
    """Return 404 with Cache-Control: no-store.

    Before this, the browser would aggressively cache the 404 response — so
    when the crawler/inline-indexer later wrote the image, the column still
    showed the no-image placeholder for hours until a hard refresh.
    """
    return JSONResponse(
        status_code=404,
        content={"detail": detail},
        headers={"Cache-Control": "no-store"},
    )

# Image override storage (bind-mounted /data/quote-overrides)
_OVERRIDE_ROOT = Path("/data/quote-overrides")
_OVERRIDE_SLOTS = ("product_photo", "stamp", "signature")
_OVERRIDE_MAX_BYTES = 5 * 1024 * 1024

# Primary-image override (user-chosen) storage — for code-level override (no rfq).
# Lives INSIDE /data/onedrive-staging/ (which IS bind-mounted in all 3 containers
# — sc-api/sc-worker/sc-scheduler) so files persist across container restarts.
# The dot-prefix `.user-image-uploads` hides it from /documents/browser.
# (CRITICAL FIX 2026-05-19: previously stored at /data/bqms-image-uploads which
#  was NOT mounted → uploads lost on every `docker restart sc-api`.)
_CODE_OVERRIDE_ROOT = Path("/data/onedrive-staging/Puplic/BQMS/.user-image-uploads")
_CODE_OVERRIDE_MAX_BYTES = 10 * 1024 * 1024  # 10MB — bigger than quote-overrides for primary image flexibility


# ─── RFQ folder browsing ───────────────────────────────────────


@router.get("/bidding/folder")
async def list_bidding_folder(
    rfq_number: str = Query(..., min_length=2),
    when_year: int | None = Query(None, description="Year (default: search current + last year)"),
    when_month: int | None = Query(None, description="Month (default: search current + neighbors)"),
    # Mở rộng cho cổng đấu thầu (procurement/staff xem "File mã" của RFQ gốc).
    # Vendor (role 'vendor') KHÔNG trong tập này → cổng NCC không bao giờ gọi được.
    token_data: TokenData = Depends(require_role("admin", "manager", "procurement", "staff")),
):
    """List files inside the per-RFQ folder created by /bidding/{id}/download-files.

    Per Thang 2026-05-11: now uses `find_existing_rfq_folder` which matches
    BOTH legacy bare-name (`QT26060682`) AND pretty-name (`QT26060682_09-05_17h00`)
    patterns. Previously the bare-name probe missed all folders created
    after the 2026-05-10 pretty-naming change.
    """
    from app.etl.bqms_bidding_scraper import (
        find_existing_rfq_folder, _rfq_folder_path,
    )

    candidates: list[tuple[int, int]] = []
    now = _dt.now()
    if when_year and when_month:
        candidates.append((when_year, when_month))
    else:
        for y in (now.year, now.year - 1):
            for m in (now.month, now.month - 1, now.month + 1):
                if 1 <= m <= 12 and (y, m) not in candidates:
                    candidates.append((y, m))

    folder = None
    for y, m in candidates:
        f = find_existing_rfq_folder(rfq_number, _dt(y, m, 1))
        if f and f.exists():
            folder = f
            break

    if folder is None:
        return {
            "data": {
                "exists": False,
                "rfq_number": rfq_number,
                "probed": [
                    str(_rfq_folder_path(rfq_number, _dt(y, m, 1)))
                    for (y, m) in candidates[:5]
                ],
            }
        }

    raw_dir = folder / "raw"
    images_dir = folder / "images"

    def _list(d):
        out = []
        if d.exists() and d.is_dir():
            for f in sorted(d.iterdir(), key=lambda p: p.name.lower()):
                if f.is_file():
                    out.append({
                        "name": f.name,
                        "size": f.stat().st_size,
                        "modified": f.stat().st_mtime,
                    })
        return out

    return {
        "data": {
            "exists": True,
            "rfq_number": rfq_number,
            "folder": str(folder),
            "files": _list(raw_dir),
            "images": _list(images_dir),
        }
    }


# ─── RFQ image lookup with tiered fallback ─────────────────────


async def resolve_rfq_image_file(
    bqms_code: str | None, rfq_number: str | None
) -> Path | None:
    """Resolve a BQMS item's image to a real file on disk, or None — NO auth, NO redirect.

    DRY single source of the `/rfq/image` resolution heuristics (primary-image DB
    pin → per-RFQ override → code override → bqms_image_index → tiered FS scan).
    Returns the resolved `Path` (which exists) or None if nothing matched.

    Reused server-side by callers that must STREAM the bytes themselves rather
    than 307-redirect the browser to the admin-gated `/rfq/image` endpoint — e.g.
    the invitation-gated VENDOR drawing route, where the vendor's token would be
    rejected by that endpoint's admin/staff role guard. Raises HTTPException(400)
    on a malformed bqms_code (same validation as the endpoint).
    """
    from app.etl.bqms_bidding_scraper import RFQ_ROOT

    if bqms_code is not None and bqms_code.strip() and not _re.match(r"^[A-Z0-9\-_]+$", bqms_code):
        raise HTTPException(400, "Invalid bqms_code")
    if not bqms_code and not rfq_number:
        raise HTTPException(400, "Provide bqms_code or rfq_number")

    # PRIORITY 0 — user-chosen primary image (DB)
    # If user explicitly picked an image via /code/{code}/primary-image,
    # always return THAT exact file. Bypass all heuristics.
    if bqms_code:
        try:
            async with db_pool.pool().acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT image_path FROM bqms_code_primary_image WHERE bqms_code = $1",
                    bqms_code,
                )
            if row and row["image_path"]:
                p = Path(row["image_path"])
                if p.exists():
                    return p
                logger.warning("Primary image for %s disappeared: %s", bqms_code, p)
        except Exception as exc:
            logger.warning("Primary image DB lookup failed (continuing): %s", exc)

    # PRIORITY 1 — Per-RFQ quote-form override (specific to this rfq+code combo,
    # set via /quote-image-override upload from GC quote form "Đổi ảnh" button).
    if bqms_code and rfq_number and _re.match(r"^[A-Z0-9\-_]+$", rfq_number):
        ovr_dir = _OVERRIDE_ROOT / rfq_number
        if ovr_dir.exists():
            for ext in (".png", ".jpg", ".jpeg"):
                ovr = ovr_dir / f"{bqms_code}__product_photo{ext}"
                if ovr.exists():
                    return ovr

    # PRIORITY 2 — Code-level override uploaded via picker modal (no specific RFQ).
    # Lives at _CODE_OVERRIDE_ROOT/<bqms_code>/* — set as "primary" via picker.
    if bqms_code:
        code_ovr_dir = _CODE_OVERRIDE_ROOT / bqms_code
        if code_ovr_dir.exists():
            files = sorted(
                (f for f in code_ovr_dir.iterdir()
                 if f.is_file() and f.suffix.lower() in (".png", ".jpg", ".jpeg")),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
            if files:
                return files[0]

    # PRIORITY 2.5 — bqms_image_index DB lookup (Thang 2026-05-19: NEW).
    # The crawler + post-scrape inline indexer populate this table mapping
    # bqms_code → absolute file path. O(1) DB hit, far faster and more
    # reliable than walking 12 months × N RFQ folders on every request.
    # When a row's file is missing on disk, we purge that row and fall
    # through to the filesystem scan, which then warms the index again.
    if bqms_code:
        try:
            async with db_pool.pool().acquire() as conn:
                idx_rows = await conn.fetch(
                    """
                    SELECT image_path, source, rfq_number AS row_rfq, mtime
                      FROM bqms_image_index
                     WHERE bqms_code = $1
                     ORDER BY
                       CASE WHEN $2::text IS NOT NULL AND rfq_number = $2::text THEN 0 ELSE 1 END,
                       CASE source WHEN 'override' THEN 1
                                   WHEN 'quote'    THEN 2
                                   WHEN 'rfq'      THEN 3
                                   WHEN 'product'  THEN 4
                                   ELSE 5 END,
                       mtime DESC NULLS LAST,
                       id ASC
                    """,
                    bqms_code, rfq_number,
                )
            stale_paths: list[str] = []
            for r in idx_rows:
                p = Path(r["image_path"])
                if p.exists() and p.is_file():
                    return p
                stale_paths.append(r["image_path"])
            if stale_paths:
                try:
                    async with db_pool.pool().acquire() as conn:
                        await conn.execute(
                            "DELETE FROM bqms_image_index WHERE bqms_code = $1 AND image_path = ANY($2::text[])",
                            bqms_code, stale_paths,
                        )
                    logger.info("Pruned %d stale image_index rows for %s", len(stale_paths), bqms_code)
                except Exception as exc:
                    logger.warning("Stale-row prune failed: %s", exc)
        except Exception as exc:
            logger.warning("Image index lookup failed (falling back to FS): %s", exc)

    # PRIORITY 3 — RFQ-folder filesystem lookup with STRICT tiers.
    # CRITICAL FIX (Thang 2026-05-19): removed Tier 4 (any non-prefixed image)
    # and Tier 5 (ANY image) when bqms_code is provided — they were the root
    # cause of "ảnh lạc xuất hiện không hiểu từ đâu". When user asks for
    # bqms_code X and no image matches, return 404 + let placeholder show,
    # don't lie with an unrelated image. Tier 5 stays only for RFQ-level
    # rows where bqms_code is None (the original Phase E case).
    #
    # 2026-05-19 (this fix): case-insensitive filename matching (uses iterdir +
    # lowercase suffix check instead of `glob('*.png')` which is case-sensitive
    # on Linux and would silently miss `.PNG`/`.JPG` files).
    now = _dt.now()
    candidates_yr = [now.year, now.year - 1, now.year - 2]
    candidates_mo = list(range(12, 0, -1))

    found: Path | None = None
    for y in candidates_yr:
        year_root = RFQ_ROOT / f"RFQ {y}"
        if not year_root.exists():
            continue
        for m in candidates_mo:
            month_root = year_root / f"THANG {m}"
            if not month_root.exists():
                continue
            if rfq_number:
                # Pretty-name compat (Thang 2026-05-19/20):
                #   bare `{rfq}` | OLD `{rfq}_<...>` | NEW `{rfq} <qty> <date> <time>`
                rfq_dirs = [
                    d for d in month_root.iterdir()
                    if d.is_dir() and (
                        d.name == rfq_number
                        or d.name.startswith(f"{rfq_number}_")
                        or d.name.startswith(f"{rfq_number} ")
                    )
                ]
                if not rfq_dirs:
                    continue
            else:
                rfq_dirs = [d for d in month_root.iterdir() if d.is_dir()]
            for d in rfq_dirs:
                images_dir = d / "images"
                if not images_dir.exists():
                    continue
                # Strict tiers (only when bqms_code given):
                #   Tier 1: exact prefix match `<bqms_code>_*` (case-insensitive)
                #   Tier 2: contains bqms_code anywhere in filename (skip _unverified_/_shared_)
                # No more "any image" fallback for code-specific lookups.
                # RFQ-level (bqms_code is None): keep tier_rfq returning any image
                tier1: list[Path] = []
                tier2: list[Path] = []
                tier_rfq: list[Path] = []
                code_lower = (bqms_code or "").lower()
                for p in images_dir.iterdir():
                    if not p.is_file():
                        continue
                    nl = p.name.lower()
                    if not nl.endswith(_IMG_EXTS_TUPLE):
                        continue
                    if not code_lower:
                        # RFQ-level: any image except _unverified_/_shared_ junk
                        if not nl.startswith("_unverified_") and not nl.startswith("_shared_"):
                            tier_rfq.append(p)
                        continue
                    if nl.startswith(code_lower + "_"):
                        tier1.append(p)
                    elif (
                        code_lower in nl
                        and not nl.startswith("_unverified_")
                        and not nl.startswith("_shared_")
                    ):
                        tier2.append(p)
                if not code_lower:
                    if tier_rfq:
                        found = sorted(tier_rfq)[0]
                else:
                    for tier in (tier1, tier2):
                        if tier:
                            found = sorted(tier)[0]
                            break
                if found:
                    break
            if found:
                break
        if found:
            break

    if not found:
        return None

    # Found via filesystem — warm the DB index so the next request is O(1).
    if bqms_code:
        try:
            st = found.stat()
            async with db_pool.pool().acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO bqms_image_index
                        (bqms_code, image_path, source, rfq_number, file_size, mtime, indexed_at)
                    VALUES ($1, $2, 'rfq', $3, $4, to_timestamp($5), NOW())
                    ON CONFLICT (bqms_code, image_path) DO UPDATE SET
                        source     = EXCLUDED.source,
                        rfq_number = EXCLUDED.rfq_number,
                        file_size  = EXCLUDED.file_size,
                        mtime      = EXCLUDED.mtime,
                        indexed_at = NOW()
                    """,
                    bqms_code, str(found), rfq_number, st.st_size, st.st_mtime,
                )
        except Exception as exc:
            logger.warning("Index warm-up failed for %s: %s", bqms_code, exc)

    return found


@router.get("/rfq/image")
async def get_rfq_image(
    request: Request,
    bqms_code: str | None = Query(None, description="Item code, e.g. Z0000002-010845. Optional — if missing, returns ANY image from the RFQ folder."),
    rfq_number: str | None = Query(None, description="RFQ number to scope the search. Required when bqms_code is missing."),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
):
    """Lookup the extracted image for one BQMS item code (or first image of RFQ).

    Phase E (Thang 2026-05-13): bqms_code now OPTIONAL. When the BQMS table has
    rows BEFORE items get split (#items=0), there's no bqms_code yet but the
    folder may still contain xlsx-extracted images. In that case we return the
    first image found inside the RFQ folder (RFQ-level fallback) so the "Ảnh"
    column hiển thị giống detail-page gallery thay vì placeholder.

    Searches `Puplic/BQMS/RFQ/RFQ <year>/THANG <month>/*/images/...` from the
    most recent year/month. Used by the BQMS function UI cell "Ảnh" + Quotation
    form prefill + Quote wizard product photo cell — this is the hottest image
    endpoint in the app (one request per grid row).

    Cache-Control (W2-11, Thang 2026-07-03): `private, max-age=86400` + ETag on
    a HIT — was `no-store` on every path (2026-05-19), which forced the /bqms
    grid to re-fetch every row's thumbnail from disk on every page load. A
    re-pinned primary image is NOT shadowed by this: BqmsImageThumb.tsx bumps
    a `?_b=` cache-bust query param the moment the picker reports a change, so
    the browser always treats that as a brand-new URL (guaranteed cache MISS)
    regardless of max-age. A MISS (404, "no image yet") still returns
    no-store — see `_not_found_no_store` — so the retry-after-indexer flow
    keeps working.
    """
    found = await resolve_rfq_image_file(bqms_code, rfq_number)
    if found is None:
        ident = bqms_code or rfq_number or "?"
        return _not_found_no_store(f"No image for {ident}")
    return _file_response_cached(found, request, extra_etag_key=bqms_code or "")


# ─── Per-RFQ folder single-file serve ─────────────────────────


def resolve_rfq_file_path(rfq_number: str, kind: str, name: str):
    """Resolve the on-disk Path of one file inside an RFQ folder's raw/ or
    images/ subdir — path-traversal guarded. Returns Path or None (folder/file
    missing, bad kind, or traversal attempt).

    DRY single source: used by the admin serve endpoint AND the vendor
    shared-file download (app/api/vendor/batches.py). The vendor path NEVER
    exposes rfq_number — it resolves it server-side from the shared-files row.
    """
    if kind not in ("raw", "images"):
        return None
    from app.etl.bqms_bidding_scraper import find_existing_rfq_folder

    # Quét RỘNG ~3 năm, ưu tiên tháng gần hiện tại rồi lùi dần (file chia sẻ có thể
    # được NCC tải nhiều TUẦN sau khi tạo RFQ, qua ranh giới tháng → cửa sổ ±1 tháng
    # cũ sẽ 404). Dừng ngay khi tìm thấy folder → trường hợp RFQ gần đây vẫn nhanh.
    now = _dt.now()
    base = now.year * 12 + (now.month - 1)
    offsets = [0] + list(range(-1, -36, -1)) + [1, 2]  # current → 35 tháng trước, +2 tháng tới
    candidates: list[tuple[int, int]] = []
    for off in offsets:
        ym = base + off
        pair = (ym // 12, ym % 12 + 1)
        if pair not in candidates:
            candidates.append(pair)

    folder = None
    for y, m in candidates:
        f = find_existing_rfq_folder(rfq_number, _dt(y, m, 1))
        if f and f.exists():
            folder = f
            break
    if folder is None:
        return None

    sub = folder / kind
    target = sub / name
    try:  # path-traversal guard: target must stay inside sub
        target.resolve().relative_to(sub.resolve())
    except ValueError:
        return None
    if not target.exists() or not target.is_file():
        return None
    return target


@router.get("/bidding/folder/file")
async def serve_bidding_file(
    rfq_number: str = Query(..., min_length=2),
    name: str = Query(..., min_length=1),
    kind: str = Query("raw", regex="^(raw|images)$"),
    # Mở rộng cho cổng đấu thầu (procurement/staff tải "File mã"). Vendor không thuộc tập.
    token_data: TokenData = Depends(require_role("admin", "manager", "procurement", "staff")),
):
    """Serve a single file from the per-RFQ folder. Only files inside
    raw/ or images/ are served — no path traversal allowed.
    """
    target = resolve_rfq_file_path(rfq_number, kind, name)
    if target is None:
        raise HTTPException(404, f"File not found: {name}")
    return FileResponse(target, filename=name)


# ─── Quote-form image overrides ────────────────────────────────


@router.post("/quote-image-override")
async def upload_quote_image_override(
    rfq_number: str = Form(..., min_length=2),
    bqms_code: str = Form(..., min_length=2),
    slot: str = Form("product_photo"),
    file: UploadFile = File(...),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Upload an image to override the default auto-discovered image in
    GC/TM quote form. Slot is one of product_photo|stamp|signature.
    """
    if slot not in _OVERRIDE_SLOTS:
        raise HTTPException(400, f"slot phải là {_OVERRIDE_SLOTS}")
    if not _re.match(r"^[A-Z0-9\-_]+$", rfq_number) or not _re.match(r"^[A-Z0-9\-_]+$", bqms_code):
        raise HTTPException(400, "rfq_number / bqms_code chỉ chấp nhận [A-Z0-9-_]")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg"):
        raise HTTPException(400, "Chỉ chấp nhận .png/.jpg/.jpeg")

    target_dir = _OVERRIDE_ROOT / rfq_number
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{bqms_code}__{slot}{ext}"

    # Read with size limit
    total = 0
    with open(target, "wb") as f:
        while True:
            chunk = await file.read(64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > _OVERRIDE_MAX_BYTES:
                f.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, "Ảnh quá lớn (>5MB)")
            f.write(chunk)

    logger.info("Image override uploaded: %s (%d bytes)", target, total)
    return {
        "data": {
            "rfq_number": rfq_number,
            "bqms_code": bqms_code,
            "slot": slot,
            "path": str(target),
            "size_bytes": total,
        },
        "message": "Đã thay ảnh thành công",
    }


@router.delete("/quote-image-override")
async def delete_quote_image_override(
    rfq_number: str = Query(..., min_length=2),
    bqms_code: str = Query(..., min_length=2),
    slot: str = Query("product_photo"),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Xoá override → quay về dùng ảnh auto-discover từ RFQ folder."""
    if slot not in _OVERRIDE_SLOTS:
        raise HTTPException(400, "slot không hợp lệ")
    folder = _OVERRIDE_ROOT / rfq_number
    deleted = []
    for ext in (".png", ".jpg", ".jpeg"):
        p = folder / f"{bqms_code}__{slot}{ext}"
        if p.exists():
            p.unlink()
            deleted.append(p.name)
    return {"data": {"deleted": deleted}, "message": "Đã xoá override"}


@router.get("/quote-image-override/check")
async def check_image_override(
    rfq_number: str = Query(...),
    bqms_code: str = Query(...),
    slot: str = Query("product_photo"),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Trả về xem có override không + path."""
    folder = _OVERRIDE_ROOT / rfq_number
    for ext in (".png", ".jpg", ".jpeg"):
        p = folder / f"{bqms_code}__{slot}{ext}"
        if p.exists():
            return {"data": {"exists": True, "path": str(p), "size_bytes": p.stat().st_size}}
    return {"data": {"exists": False}}


# ─── Image Picker (Thang 2026-05-19): user chooses primary image per bqms_code ──
#
# 3 endpoints:
#   GET  /code/{code}/images       — list ALL images known for this code (index + override + RFQ folders)
#   POST /code/{code}/primary-image — pin one as primary
#   POST /code/{code}/upload-image  — upload new override (added to index + auto-set primary)


def _validate_code(code: str) -> str:
    if not _re.match(r"^[A-Z0-9\-_]{2,64}$", code):
        raise HTTPException(400, "bqms_code không hợp lệ")
    return code


@router.get("/code/{bqms_code}/images")
async def list_code_images(
    bqms_code: str,
    include_rfq_siblings: bool = Query(
        True,
        description="Also include images belonging to OTHER bqms_codes in the same "
                    "RFQ folder. User then has full RFQ context to pick from.",
    ),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Liệt kê TẤT CẢ ảnh hệ thống biết về 1 mã linh kiện.

    Trả về:
      - images: list of {path, source, rfq_number, file_size, mtime, is_primary, scope}
      - primary_path: image_path user đã pin (nếu có)
      - rfq_numbers: list các RFQ mà mã này thuộc về (để UI hiện group header)

    Scope field (Thang 2026-05-20):
      "own"     — ảnh trực tiếp thuộc mã này (filename prefix khớp, hoặc upload riêng cho mã)
      "sibling" — ảnh trong CÙNG QT/RFQ folder nhưng thuộc mã khác (user vẫn pin được)
      "upload"  — file user upload qua picker, code-level override

    Source order: primary → own → upload → sibling. Inside each group: override > quote > rfq > product.
    """
    from app.etl.bqms_bidding_scraper import find_existing_rfq_folder

    bqms_code = _validate_code(bqms_code)

    rows: list[dict] = []
    primary_path: str | None = None
    rfq_numbers: list[str] = []
    try:
        async with db_pool.pool().acquire() as conn:
            primary = await conn.fetchrow(
                "SELECT image_path FROM bqms_code_primary_image WHERE bqms_code = $1",
                bqms_code,
            )
            if primary:
                primary_path = primary["image_path"]

            # 1) Own-code images from index
            db_rows = await conn.fetch(
                """
                SELECT image_path, source, rfq_number, file_size, mtime
                  FROM bqms_image_index
                 WHERE bqms_code = $1
                 ORDER BY CASE source WHEN 'override' THEN 1
                                      WHEN 'quote'    THEN 2
                                      WHEN 'rfq'      THEN 3
                                      WHEN 'product'  THEN 4
                                      ELSE 5 END,
                          mtime DESC NULLS LAST,
                          file_size DESC NULLS LAST,
                          id ASC
                """,
                bqms_code,
            )

            # 2) Discover RFQs this code belongs to — from bqms_rfq + image_index
            #    (use union: bqms_rfq is authoritative; image_index catches edge
            #    cases where extraction tagged the code but bqms_rfq row was
            #    skipped/closed).
            if include_rfq_siblings:
                rfq_rows = await conn.fetch(
                    """
                    SELECT DISTINCT rfq_number FROM (
                        SELECT rfq_number FROM bqms_rfq WHERE bqms_code = $1 AND rfq_number IS NOT NULL
                        UNION
                        SELECT rfq_number FROM bqms_image_index WHERE bqms_code = $1 AND rfq_number IS NOT NULL
                    ) u
                    """,
                    bqms_code,
                )
                rfq_numbers = [r["rfq_number"] for r in rfq_rows if r["rfq_number"]]

        seen_paths: set[str] = set()

        # Section: OWN — indexed images for this exact code
        for r in db_rows:
            path = r["image_path"]
            if path in seen_paths:
                continue
            seen_paths.add(path)
            p = Path(path)
            rows.append({
                "path": path,
                "filename": p.name,
                "source": r["source"],
                "rfq_number": r["rfq_number"],
                "file_size": r["file_size"],
                "mtime": r["mtime"].isoformat() if r["mtime"] else None,
                "is_primary": (primary_path == path),
                "exists": p.exists(),
                "scope": "own",
            })

        # Section: UPLOAD — user uploads in /data/.../user-image-uploads/<code>/
        code_dir = _CODE_OVERRIDE_ROOT / bqms_code
        if code_dir.exists():
            for f in sorted(code_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
                if not f.is_file() or f.suffix.lower() not in (".png", ".jpg", ".jpeg"):
                    continue
                if str(f) in seen_paths:
                    continue
                seen_paths.add(str(f))
                rows.append({
                    "path": str(f),
                    "filename": f.name,
                    "source": "override",
                    "rfq_number": None,
                    "file_size": f.stat().st_size,
                    "mtime": _dt.fromtimestamp(f.stat().st_mtime).isoformat(),
                    "is_primary": (primary_path == str(f)),
                    "exists": True,
                    "scope": "upload",
                })

        # Section: SIBLINGS — other images in same RFQ folder (Thang 2026-05-20)
        # Helps when one product photo is shared across multiple bqms_codes
        # (e.g. RFQ QT26066093 with 5 related parts — user wants to pin the
        # same source image as the "Hệ thống" reference for several mã).
        if include_rfq_siblings and rfq_numbers:
            now = _dt.now()
            year_month_candidates: list[tuple[int, int]] = []
            for y in (now.year, now.year - 1):
                for m in (now.month, now.month - 1, now.month + 1):
                    if 1 <= m <= 12:
                        year_month_candidates.append((y, m))

            sibling_paths: list[Path] = []
            for rfq_no in rfq_numbers:
                folder = None
                for y, m in year_month_candidates:
                    f = find_existing_rfq_folder(rfq_no, _dt(y, m, 1))
                    if f and f.exists():
                        folder = f
                        break
                if folder is None:
                    continue
                images_dir = folder / "images"
                if not images_dir.exists():
                    continue
                for ext in (".png", ".jpg", ".jpeg", ".gif"):
                    for p in images_dir.glob(f"*{ext}"):
                        nl = p.name.lower()
                        # Skip _unverified_ noise. Keep _shared_ (cross-item template).
                        if nl.startswith("_unverified_"):
                            continue
                        # Skip if already added as "own" (we'd be duplicating)
                        if str(p) in seen_paths:
                            continue
                        # Heuristic: if filename starts with bqms_code (case-insensitive),
                        # it's "own" not "sibling" — but it should have been in the
                        # index. Still, double-check.
                        if nl.startswith(bqms_code.lower() + "_"):
                            continue
                        sibling_paths.append(p)
                # End folder loop

            # Dedup + sort siblings by mtime DESC (newest first)
            for p in sorted(set(sibling_paths), key=lambda x: x.stat().st_mtime, reverse=True):
                if str(p) in seen_paths:
                    continue
                seen_paths.add(str(p))
                # Try to infer which bqms_code this sibling belongs to from its
                # filename prefix (Z0000002-385323_1.png → "Z0000002-385323").
                m_code = _re.match(r"^([A-Z0-9][A-Z0-9_\-]{4,40})_", p.name)
                sibling_code = m_code.group(1) if m_code else None
                rows.append({
                    "path": str(p),
                    "filename": p.name,
                    "source": "rfq",
                    "rfq_number": None,  # may belong to any RFQ this code is in
                    "sibling_of_code": sibling_code,
                    "file_size": p.stat().st_size,
                    "mtime": _dt.fromtimestamp(p.stat().st_mtime).isoformat(),
                    "is_primary": (primary_path == str(p)),
                    "exists": True,
                    "scope": "sibling",
                })
    except Exception as exc:
        logger.exception("list_code_images failed for %s: %s", bqms_code, exc)
        raise HTTPException(500, f"DB lookup failed: {exc}")

    # Final sort: primary first, then by scope (own > upload > sibling)
    _scope_rank = {"own": 0, "upload": 1, "sibling": 2}
    rows.sort(key=lambda r: (
        not r["is_primary"],
        _scope_rank.get(r.get("scope", "own"), 9),
    ))

    return {
        "data": {
            "bqms_code": bqms_code,
            "primary_path": primary_path,
            "images": rows,
            "rfq_numbers": rfq_numbers,
            "total": len(rows),
        }
    }


@router.get("/code/{bqms_code}/image-blob")
async def get_code_image_blob(
    request: Request,
    bqms_code: str,
    path: str = Query(..., description="Absolute path returned by /images"),
    normalize: bool = Query(
        False,
        description="Thang 2026-06-23: exif_transpose + re-encode PNG so the CROPPER "
                    "sees the SAME pixel grid the crop endpoint will operate on "
                    "(fixes 'crop sai tỷ lệ' khi ảnh JPEG có EXIF orientation).",
    ),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Serve a SPECIFIC image by absolute path (used by picker grid thumbnails).

    Path is validated to be inside one of: RFQ_ROOT, _OVERRIDE_ROOT,
    _CODE_OVERRIDE_ROOT — so user can't ask for `/etc/passwd`.

    Cache-Control (W2-11, Thang 2026-07-03): `private, max-age=86400` + ETag
    — was `no-store`. Same reasoning as `/rfq/image`: the picker grid re-opens
    and re-renders the SAME candidate image paths repeatedly, RBAC already ran
    above via `require_role`, and `path` is itself part of the cache key (a
    different candidate image = a different URL = never confused for another).
    """
    from app.etl.bqms_bidding_scraper import RFQ_ROOT
    bqms_code = _validate_code(bqms_code)

    target = Path(path).resolve()
    allowed_roots = [
        RFQ_ROOT.resolve(),
        _OVERRIDE_ROOT.resolve(),
        _CODE_OVERRIDE_ROOT.resolve(),
    ]
    if not any(str(target).startswith(str(r) + "/") or str(target) == str(r) for r in allowed_roots):
        raise HTTPException(403, "Path outside allowed roots")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"File not found: {target.name}")
    if target.suffix.lower() not in (".png", ".jpg", ".jpeg", ".gif"):
        raise HTTPException(400, "Not an image")

    # Thang 2026-06-23: cropper requests ?normalize=1 → serve EXIF-corrected PNG
    # bytes so the displayed image == the exif_transposed grid crop_code_image
    # operates on. Without this, an EXIF-rotated JPEG shows oriented in the
    # browser but the backend cropped a different-axis grid → "crop sai tỷ lệ".
    if normalize:
        etag = _image_etag(target, f"{bqms_code}:normalize")
        headers = {
            "Cache-Control": "private, max-age=86400",
            "ETag": etag,
            "X-SC-Image-Cache": "1",  # see main.py security_headers — sentinel, not sniffed by Content-Type
        }
        inm = request.headers.get("if-none-match")
        if inm and etag in (t.strip() for t in inm.split(",")):
            return Response(status_code=304, headers=headers)
        from io import BytesIO
        from PIL import Image as PILImage, ImageOps
        try:
            with PILImage.open(target) as im:
                im = ImageOps.exif_transpose(im) or im
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGBA")
                buf = BytesIO()
                im.save(buf, format="PNG")
            return Response(content=buf.getvalue(), media_type="image/png", headers=headers)
        except Exception as exc:  # noqa: BLE001 — fall back to raw on any error
            logger.warning("image-blob normalize failed for %s: %s — serving raw", target.name, exc)

    return _file_response_cached(target, request, extra_etag_key=bqms_code)


@router.post("/code/{bqms_code}/primary-image")
async def set_primary_image(
    bqms_code: str,
    payload: dict,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Pin one image as the user-chosen primary for this bqms_code.

    body: {"image_path": "/data/..."}  — must be an indexed or uploaded image.
    Effect: future GET /rfq/image?bqms_code=X will ALWAYS return this exact file.
    """
    from app.etl.bqms_bidding_scraper import RFQ_ROOT
    bqms_code = _validate_code(bqms_code)
    image_path = (payload or {}).get("image_path") or ""
    if not image_path:
        raise HTTPException(400, "image_path là required")

    p = Path(image_path).resolve()
    allowed_roots = [
        RFQ_ROOT.resolve(),
        _OVERRIDE_ROOT.resolve(),
        _CODE_OVERRIDE_ROOT.resolve(),
    ]
    if not any(str(p).startswith(str(r) + "/") for r in allowed_roots):
        raise HTTPException(403, "image_path outside allowed roots")
    if not p.exists():
        raise HTTPException(404, "image file không tồn tại")

    try:
        async with db_pool.pool().acquire() as conn:
            await conn.execute(
                """
                INSERT INTO bqms_code_primary_image (bqms_code, image_path, chosen_by, chosen_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (bqms_code) DO UPDATE
                SET image_path = EXCLUDED.image_path,
                    chosen_by  = EXCLUDED.chosen_by,
                    chosen_at  = NOW()
                """,
                bqms_code, str(p), (token_data.user_id or None),
            )
        logger.info("Primary image set: %s → %s (by user %s)",
                    bqms_code, p.name, token_data.email or token_data.user_id)
    except Exception as exc:
        logger.exception("set_primary_image failed: %s", exc)
        raise HTTPException(500, f"DB write failed: {exc}")

    return {
        "data": {"bqms_code": bqms_code, "image_path": str(p)},
        "message": f"Đã chọn ảnh chính: {p.name}",
    }


@router.delete("/code/{bqms_code}/primary-image")
async def unset_primary_image(
    bqms_code: str,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Remove user-chosen primary → fall back to auto-pick (priority view)."""
    bqms_code = _validate_code(bqms_code)
    try:
        async with db_pool.pool().acquire() as conn:
            await conn.execute(
                "DELETE FROM bqms_code_primary_image WHERE bqms_code = $1",
                bqms_code,
            )
    except Exception as exc:
        raise HTTPException(500, f"DB delete failed: {exc}")
    return {"data": {"bqms_code": bqms_code}, "message": "Đã bỏ chọn ảnh chính"}


@router.delete("/code/{bqms_code}/image")
async def delete_code_image(
    bqms_code: str,
    path: str = Query(..., description="Absolute path of the image file to delete"),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Delete ONE image attributed to this bqms_code.

    Hard rule: only files inside the override roots can be deleted —
      • `_OVERRIDE_ROOT` (per-RFQ quote-form override)
      • `_CODE_OVERRIDE_ROOT` (code-level override, includes cropped images)
    RFQ-scraped images under `RFQ_ROOT/...` are NEVER deletable through this
    endpoint, because they're the source-of-truth from Samsung's xlsx and
    rescraping would just re-create them.

    Side effects:
      1. Remove the file from disk (`unlink`, silently ignore missing).
      2. Delete the matching row from `bqms_image_index`.
      3. If this file was the user-pinned primary in
         `bqms_code_primary_image`, clear that row too so the auto-pick logic
         in /rfq/image takes over.
    """
    bqms_code = _validate_code(bqms_code)
    if not path:
        raise HTTPException(400, "path là required")

    p = Path(path).resolve()
    deletable_roots = [
        _OVERRIDE_ROOT.resolve(),
        _CODE_OVERRIDE_ROOT.resolve(),
    ]
    # Hard refuse to touch anything outside override roots — protects RFQ
    # source files even if the caller fabricates a path.
    if not any(str(p).startswith(str(r) + "/") for r in deletable_roots):
        raise HTTPException(
            403,
            "Chỉ được xoá ảnh upload/crop (override). Ảnh từ RFQ Samsung "
            "không xoá được — nếu sai thì chọn ảnh khác làm primary.",
        )

    file_existed = p.exists() and p.is_file()
    if file_existed:
        try:
            p.unlink()
        except OSError as exc:
            logger.exception("delete file failed: %s", exc)
            raise HTTPException(500, f"Không xoá được file: {exc}")

    primary_cleared = False
    rows_removed = 0
    try:
        async with db_pool.pool().acquire() as conn:
            res = await conn.execute(
                "DELETE FROM bqms_image_index WHERE bqms_code = $1 AND image_path = $2",
                bqms_code, str(p),
            )
            # res is like 'DELETE 1' — parse the count for the response payload
            try:
                rows_removed = int(res.split()[-1])
            except (ValueError, IndexError):
                rows_removed = 0
            prim = await conn.fetchrow(
                "SELECT image_path FROM bqms_code_primary_image WHERE bqms_code = $1",
                bqms_code,
            )
            if prim and prim["image_path"] == str(p):
                await conn.execute(
                    "DELETE FROM bqms_code_primary_image WHERE bqms_code = $1",
                    bqms_code,
                )
                primary_cleared = True
    except Exception as exc:
        logger.warning("DB cleanup after delete failed: %s", exc)

    logger.info(
        "Deleted image: %s (existed=%s rows_removed=%d primary_cleared=%s) by user=%s",
        p, file_existed, rows_removed, primary_cleared,
        token_data.email or token_data.user_id,
    )
    return {
        "data": {
            "bqms_code": bqms_code,
            "path": str(p),
            "file_existed": file_existed,
            "rows_removed": rows_removed,
            "primary_cleared": primary_cleared,
        },
        "message": "Đã xoá ảnh" + (" + bỏ ghim primary" if primary_cleared else ""),
    }


@router.post("/code/{bqms_code}/crop-image")
async def crop_code_image(
    bqms_code: str,
    payload: dict,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Crop an existing image and save the result as a new override + primary.

    Body:
      {
        "source_path": "/data/.../images/<code>_1.png",   # absolute, must be inside allowed roots
        "crop": {"x": 12, "y": 30, "width": 400, "height": 300}   # natural-pixel coords
      }

    The cropper component reports coords in the original image's pixel space
    (i.e. it accounts for any on-screen scaling); the backend trusts those
    numbers and just clamps to image bounds.

    Output: new PNG at `_CODE_OVERRIDE_ROOT/<code>/cropped_<ts>.png`, upserted
    into `bqms_image_index` (source='override') and pinned as primary so it
    shows up immediately in the BQMS column.
    """
    from app.etl.bqms_bidding_scraper import RFQ_ROOT
    from PIL import Image as PILImage, ImageOps

    bqms_code = _validate_code(bqms_code)
    source_path = (payload or {}).get("source_path") or ""
    crop = (payload or {}).get("crop") or {}

    if not source_path:
        raise HTTPException(400, "source_path là required")
    try:
        x = int(crop.get("x", 0))
        y = int(crop.get("y", 0))
        w = int(crop.get("width", 0))
        h = int(crop.get("height", 0))
    except (TypeError, ValueError):
        raise HTTPException(400, "crop.{x,y,width,height} phải là số nguyên")
    if w <= 0 or h <= 0:
        raise HTTPException(400, "crop.width và crop.height phải > 0")

    # Validate source path is inside an allowed root
    src = Path(source_path).resolve()
    allowed_roots = [
        RFQ_ROOT.resolve(),
        _OVERRIDE_ROOT.resolve(),
        _CODE_OVERRIDE_ROOT.resolve(),
    ]
    if not any(str(src).startswith(str(r) + "/") or str(src) == str(r) for r in allowed_roots):
        raise HTTPException(403, "source_path nằm ngoài thư mục cho phép")
    if not src.exists() or not src.is_file():
        raise HTTPException(404, f"Source image không tồn tại: {src.name}")
    if src.suffix.lower() not in (".png", ".jpg", ".jpeg", ".gif"):
        raise HTTPException(400, "Source không phải file ảnh hợp lệ")

    # Load + crop with PIL. Clamp coords to image bounds so a slightly-off
    # crop rectangle (eg. dragged past the edge in the UI) doesn't 500 here.
    try:
        with PILImage.open(src) as im:
            # Thang 2026-06-23 (fix crop lệch/xoay): trình duyệt TỰ xoay ảnh theo
            # EXIF Orientation khi hiển thị → user crop trên ảnh ĐÃ xoay, nhưng
            # PIL đọc lưới pixel GỐC (chưa xoay) → cắt sai vùng (xoay/lệch nhiều).
            # exif_transpose chuẩn hoá hướng khớp với cái trình duyệt hiển thị.
            # No-op với PNG / ảnh không có EXIF nên an toàn tuyệt đối.
            im = ImageOps.exif_transpose(im) or im
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA")
            iw, ih = im.size
            x0 = max(0, min(iw - 1, x))
            y0 = max(0, min(ih - 1, y))
            x1 = max(x0 + 1, min(iw, x + w))
            y1 = max(y0 + 1, min(ih, y + h))
            if (x1 - x0) < 4 or (y1 - y0) < 4:
                raise HTTPException(400, "Vùng crop quá nhỏ (<4px)")
            cropped = im.crop((x0, y0, x1, y1))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Crop failed for %s: %s", src, exc)
        raise HTTPException(500, f"Crop thất bại: {exc}")

    # Save as PNG into per-code override dir
    target_dir = _CODE_OVERRIDE_ROOT / bqms_code
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"cropped_{int(_time.time())}.png"
    try:
        cropped.save(target, format="PNG", optimize=True)
    except Exception as exc:
        logger.exception("Save cropped image failed: %s", exc)
        raise HTTPException(500, f"Save thất bại: {exc}")

    size_bytes = target.stat().st_size if target.exists() else 0

    # Upsert into index + pin as primary so next list render uses it.
    try:
        async with db_pool.pool().acquire() as conn:
            await conn.execute(
                """
                INSERT INTO bqms_image_index
                    (bqms_code, image_path, source, rfq_number, file_size, mtime, indexed_at)
                VALUES ($1, $2, 'override', NULL, $3, NOW(), NOW())
                ON CONFLICT (bqms_code, image_path) DO UPDATE SET
                    file_size  = EXCLUDED.file_size,
                    mtime      = EXCLUDED.mtime,
                    indexed_at = NOW()
                """,
                bqms_code, str(target), size_bytes,
            )
            await conn.execute(
                """
                INSERT INTO bqms_code_primary_image (bqms_code, image_path, chosen_by, chosen_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (bqms_code) DO UPDATE SET
                    image_path = EXCLUDED.image_path,
                    chosen_by  = EXCLUDED.chosen_by,
                    chosen_at  = NOW()
                """,
                bqms_code, str(target),
                (token_data.user_id or None),
            )
    except Exception as exc:
        # Best-effort: file was written, even if DB write fails the next
        # crawler pass will index it. Don't 500 the request.
        logger.warning("Index/primary write after crop failed: %s", exc)

    logger.info(
        "Cropped image saved: %s (%d bytes, from %s, crop=%dx%d@%d,%d)",
        target, size_bytes, src.name, (x1 - x0), (y1 - y0), x0, y0,
    )
    return {
        "data": {
            "bqms_code": bqms_code,
            "path": str(target),
            "filename": target.name,
            "size_bytes": size_bytes,
            "source": str(src),
            "crop_applied": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
            "set_primary": True,
        },
        "message": "Đã crop ảnh và đặt làm ảnh chính",
    }


@router.post("/code/{bqms_code}/upload-image")
async def upload_code_image(
    bqms_code: str,
    file: UploadFile = File(...),
    set_primary: bool = Form(True, description="Auto-set as primary after upload"),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Upload a new image for this bqms_code → /data/bqms-image-uploads/<code>/<ts>_<name>.

    Auto-indexed into bqms_image_index (source='override') + optionally pinned
    as primary so it shows immediately in the BQMS list thumbnail.
    """
    bqms_code = _validate_code(bqms_code)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg"):
        raise HTTPException(400, "Chỉ chấp nhận .png/.jpg/.jpeg")

    target_dir = _CODE_OVERRIDE_ROOT / bqms_code
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _re.sub(r"[^A-Za-z0-9._-]", "_", Path(file.filename or "img").stem)[:50]
    target = target_dir / f"{int(_time.time())}_{safe_name}{ext}"

    total = 0
    with open(target, "wb") as f:
        while True:
            chunk = await file.read(64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > _CODE_OVERRIDE_MAX_BYTES:
                f.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, f"Ảnh quá lớn (>{_CODE_OVERRIDE_MAX_BYTES // (1024*1024)}MB)")
            f.write(chunk)

    # Index immediately (otherwise user has to wait for 6h crawler)
    try:
        async with db_pool.pool().acquire() as conn:
            await conn.execute(
                """
                INSERT INTO bqms_image_index
                    (bqms_code, image_path, source, rfq_number, file_size, mtime, indexed_at)
                VALUES ($1, $2, 'override', NULL, $3, NOW(), NOW())
                ON CONFLICT (bqms_code, image_path) DO UPDATE
                SET file_size = EXCLUDED.file_size,
                    mtime     = EXCLUDED.mtime,
                    indexed_at = NOW()
                """,
                bqms_code, str(target), total,
            )
            if set_primary:
                await conn.execute(
                    """
                    INSERT INTO bqms_code_primary_image (bqms_code, image_path, chosen_by, chosen_at)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (bqms_code) DO UPDATE
                    SET image_path = EXCLUDED.image_path,
                        chosen_by  = EXCLUDED.chosen_by,
                        chosen_at  = NOW()
                    """,
                    bqms_code, str(target),
                    (token_data.user_id or None),
                )
    except Exception as exc:
        logger.warning("Upload OK but index/primary write failed: %s", exc)

    logger.info("Code image uploaded: %s (%d bytes, primary=%s)",
                target, total, set_primary)
    return {
        "data": {
            "bqms_code": bqms_code,
            "path": str(target),
            "filename": target.name,
            "size_bytes": total,
            "set_primary": set_primary,
        },
        "message": "Đã upload ảnh" + (" + chọn làm ảnh chính" if set_primary else ""),
    }
