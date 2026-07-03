"""BQMS Image Resizer — pre-resize ảnh trước khi set_input_files() vào Samsung.

Thang 2026-05-14: Samsung Item Image Uploader crop area là vuông. Ảnh nguồn từ
BQMS folder thường tỉ lệ tùy ý → cần pad thành vuông + resize 500x500 để khi
upload là vừa khung xanh, không cần wheel zoom.

Cache resized images theo (src_path, mtime, target_size) trong /tmp.
"""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Phải dùng path đã được bind-mount giữa sc-api và sc-worker
# /data/quote-overrides ĐÃ ĐƯỢC MOUNT trên cả 2 containers (verified via docker inspect).
# Subfolder _pusher_cache để không lẫn với override ảnh của user.
CACHE_DIR = Path("/data/quote-overrides/_pusher_cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Samsung Item Image Uploader stores at 400x400 natural size (verified via
# probe of itemImg element trong upload popup — Thang 2026-05-15). Resize
# về đúng kích thước này tránh Samsung tự crop/scale lại làm méo ảnh.
DEFAULT_TARGET = (400, 400)


def resize_for_samsung(src_path: str | Path, target: tuple[int, int] = DEFAULT_TARGET) -> Path:
    """Resize ảnh nguồn về kích thước vuông + pad nền trắng.

    Returns: path tới file đã resize, ở /tmp/bqms_push_imgs/.
    Cache hit nếu (src_path, mtime, target_size) khớp từ trước.
    """
    from PIL import Image

    src = Path(src_path)
    if not src.exists():
        raise FileNotFoundError(f"Image not found: {src}")

    # Cache key dựa trên path + mtime + target dims
    mtime = src.stat().st_mtime
    key_str = f"{src.resolve()}|{mtime}|{target[0]}x{target[1]}"
    key = hashlib.md5(key_str.encode()).hexdigest()[:16]
    out_path = CACHE_DIR / f"{src.stem}_{key}.png"

    if out_path.exists():
        return out_path

    img = Image.open(src)
    # Convert to RGBA để hỗ trợ pad
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")

    # Fit-in-target: scale giữ tỉ lệ, dài cạnh = target.
    img.thumbnail(target, Image.Resampling.LANCZOS)

    # Pad nền trắng (không transparent — Samsung crop hiển thị nền checkerboard
    # nếu transparent, gây nhầm lẫn) thành vuông target
    bg = Image.new("RGB", target, (255, 255, 255))
    paste_x = (target[0] - img.width) // 2
    paste_y = (target[1] - img.height) // 2
    if img.mode == "RGBA":
        bg.paste(img, (paste_x, paste_y), mask=img)
    else:
        bg.paste(img, (paste_x, paste_y))
    bg.save(out_path, "PNG", optimize=True)
    logger.info("resize_for_samsung: %s → %s (%dx%d)", src.name, out_path.name, *target)
    return out_path


def resolve_image_for_bqms_code(
    bqms_code: str,
    rfq_number: str,
    onedrive_root: str | Path = "/data/onedrive-staging/Puplic/BQMS/RFQ",
) -> Path | None:
    """Resolve ảnh tốt nhất cho 1 bqms_code theo tier priority.

    TIER 0: /data/quote-overrides/{rfq_number}/{bqms_code}__product_photo.* (user override)
    TIER 1: {bqms_code}_*.png trong .../images/ (prefix match)
    TIER 2: *{bqms_code}*.png (substring)
    TIER 3: _shared_*.png (RFQ-level shared)
    TIER 4: bất kỳ file non-_ prefix
    """
    from datetime import datetime

    code_lower = bqms_code.lower()

    # TIER 0 — user override
    ovr_dir = Path(f"/data/quote-overrides/{rfq_number}")
    if ovr_dir.exists():
        for ext in (".png", ".jpg", ".jpeg"):
            for pattern in (f"{bqms_code}__product_photo{ext}", f"{bqms_code}{ext}"):
                p = ovr_dir / pattern
                if p.exists():
                    return p

    # TIER 1-4 — scan BQMS folder
    root = Path(onedrive_root)
    now = datetime.now()
    for y in [now.year, now.year - 1]:
        year_root = root / f"RFQ {y}"
        if not year_root.exists():
            continue
        for m in range(12, 0, -1):
            month_root = year_root / f"THANG {m}"
            if not month_root.exists():
                continue
            for d in month_root.iterdir():
                if not d.is_dir():
                    continue
                # Pretty-name compat (Thang 2026-05-19/20):
                #   NEW: `{rfq} {qty} {date} {time}` (space-prefix)
                #   OLD: `{rfq}_{item}_{qty}_{date}_{time}` (underscore-prefix)
                #   Bare: `{rfq}` (legacy)
                if (d.name != rfq_number
                        and not d.name.startswith(f"{rfq_number}_")
                        and not d.name.startswith(f"{rfq_number} ")):
                    continue
                images_dir = d / "images"
                if not images_dir.exists():
                    continue
                tier1: list[Path] = []
                tier2: list[Path] = []
                tier3: list[Path] = []
                tier4: list[Path] = []
                for ext in (".png", ".jpg", ".jpeg", ".gif"):
                    for p in images_dir.glob(f"*{ext}"):
                        nl = p.name.lower()
                        if nl.startswith(code_lower + "_"):
                            tier1.append(p)
                        elif code_lower in nl and not nl.startswith("_unverified_"):
                            tier2.append(p)
                        elif nl.startswith("_shared_"):
                            tier3.append(p)
                        elif not nl.startswith("_"):
                            tier4.append(p)
                for tier in (tier1, tier2, tier3, tier4):
                    if tier:
                        return sorted(tier)[0]
    return None
