"""Folder path helpers for delivery dossier feature (Tạo hồ sơ giao hàng).

Folder layout (per Thang 2026-05-16):

    /data/onedrive-staging/Puplic/BQMS/Giao hàng/BBGH {YEAR}/{SEV|SEVT}/
        po {po_list} {items_short} ({qtys_list})/
            AMA po-{po_list} {items_short} ({qtys_list}).xlsx
            DeliveryNote {po_list} {items_short} ({qtys_list}).pdf
            PurchaseOrder_{po_n}_L16X98 {item_short_n}.pdf   (one per PO)

Sample reference folder on VPS:
    /data/onedrive-staging/Puplic/BQMS/Giao hàng/BBGH 2026/SEV/
        po 2112520763, 2112522933 roller (2000, 700)/
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Iterable

# Root where all delivery dossier folders live
DELIVERY_ROOT = Path("/data/onedrive-staging/Puplic/BQMS/Giao hàng")

# Forbidden filename chars on common filesystems
_FORBIDDEN = set('/\\:*?"<>|')


def _sanitize_segment(s: str, max_len: int = 80) -> str:
    """Sanitize a single path segment: strip forbidden chars, collapse whitespace.

    Preserves Vietnamese diacritics (existing folder pattern uses them).
    """
    if not s:
        return ""
    cleaned = "".join(c if c not in _FORBIDDEN else " " for c in s)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip()
    return cleaned


def _item_name_short(item_name: str) -> str:
    """Shorten an item description for use in folder/file names.

    Sample folder uses single-word labels like "roller", "bracket", "conveyor".
    Try to extract the first 1-2 meaningful words, lowercase.
    """
    if not item_name:
        return ""
    # Use just the first comma/dot separated chunk
    head = re.split(r"[,;\.\(\[]", item_name, maxsplit=1)[0].strip()
    # Lowercase + collapse spaces
    head = re.sub(r"\s+", " ", head).strip().lower()
    # Limit to 30 chars
    return head[:30]


def build_dossier_folder_name(
    po_numbers: list[str],
    item_names_by_po: dict[str, list[str]],
    qty_by_po: dict[str, int],
    attempt_no: int = 1,
    delivery_date: "datetime | None" = None,
) -> str:
    """Build the per-job folder name.

    Args:
        po_numbers: ordered list of distinct PO numbers (already unique)
        item_names_by_po: {po_number: [item_name1, item_name2, ...]}
        qty_by_po:        {po_number: total_qty}
        attempt_no:       1 for first delivery, 2 for second batch of the same
                          PO list, etc. (Thang 2026-05-21 — multi-delivery)
        delivery_date:    date stamp for the folder name (defaults to today)

    Returns:
        e.g. "po 2112520763, 2112522933 roller (2000, 700) lan-1 21-05"
        or   "po 2112600726 oring, gasket (220, 1000) lan-2 22-05"
        or   "po 2112582457 conveyor (4) lan-3 23-05"

    NOTE: Old folders (created before this fix) have no `lan-N DD-MM` suffix.
    `find_existing_dossier_folder` still matches them via the `po <num>` prefix.
    """
    pos_part = ", ".join(po_numbers)

    # items_short: distinct item names lowercase, comma-sep
    seen: list[str] = []
    for po in po_numbers:
        for it in item_names_by_po.get(po, []):
            short = _item_name_short(it)
            if short and short not in seen:
                seen.append(short)
    items_short = ", ".join(seen) if seen else "items"

    # qtys list: one per PO in same order
    qtys_part = ", ".join(str(qty_by_po.get(po, 0)) for po in po_numbers)

    # Multi-delivery suffix: lan-N DD-MM
    when = delivery_date or datetime.now()
    suffix = f" lan-{attempt_no} {when.strftime('%d-%m')}"

    raw = f"po {pos_part} {items_short} ({qtys_part}){suffix}"
    return _sanitize_segment(raw, max_len=160)


def build_dossier_folder_path(
    sev_type: str,
    folder_name: str,
    year: int | None = None,
) -> Path:
    """Compose absolute path: DELIVERY_ROOT/BBGH {year}/{SEV|SEVT}/{folder_name}/."""
    if sev_type not in ("SEV", "SEVT"):
        raise ValueError(f"sev_type must be SEV or SEVT, got: {sev_type!r}")
    year = year or datetime.now().year
    return DELIVERY_ROOT / f"BBGH {year}" / sev_type / folder_name


def ensure_dossier_folder(path: Path) -> Path:
    """Create folder (idempotent). Returns path."""
    path.mkdir(parents=True, exist_ok=True)
    return path


def find_existing_dossier_folder(
    sev_type: str,
    po_numbers: list[str],
    year: int | None = None,
) -> Path | None:
    """Best-effort search for an existing folder by PO numbers.

    Matches if any folder under `BBGH {year}/{sev_type}/` starts with `po <po1>`
    or contains all PO numbers in its name.

    Used for idempotent re-run: if job re-runs after partial completion,
    re-attach to the existing folder instead of creating duplicate.
    """
    year = year or datetime.now().year
    parent = DELIVERY_ROOT / f"BBGH {year}" / sev_type
    if not parent.is_dir():
        return None
    primary_po = po_numbers[0] if po_numbers else None
    if not primary_po:
        return None
    candidates: list[Path] = []
    for child in parent.iterdir():
        if not child.is_dir():
            continue
        name = child.name.lower()
        if all(po in name for po in po_numbers):
            candidates.append(child)
    if not candidates:
        return None
    # Prefer most-recently-modified
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def excel_filename(folder_name: str) -> str:
    """`po 2112... roller (2000, 700)` → `AMA po-2112... roller (2000, 700).xlsx`."""
    # Strip leading "po " then prepend "AMA po-"
    stem = folder_name[3:] if folder_name.lower().startswith("po ") else folder_name
    return f"AMA po-{stem}.xlsx"


def delivery_note_filename(folder_name: str) -> str:
    """`po 2112... roller (2000, 700)` → `DeliveryNote 2112... roller (2000, 700).pdf`."""
    stem = folder_name[3:] if folder_name.lower().startswith("po ") else folder_name
    return f"DeliveryNote {stem}.pdf"


def purchase_order_filename(po_number: str, item_short: str = "") -> str:
    """`(2112520763, "block")` → `PurchaseOrder_2112520763_L16X98 block.pdf`.

    Item suffix optional — matches sample folder pattern. L16X98 is AMA Bac
    Ninh's vendor code on Samsung BQMS (constant for this vendor).
    """
    suffix = f" {item_short}" if item_short else ""
    return _sanitize_segment(f"PurchaseOrder_{po_number}_L16X98{suffix}.pdf", max_len=120)
