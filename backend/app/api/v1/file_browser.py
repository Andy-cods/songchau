"""
File Browser API — Song Châu ERP

Duyệt file OneDrive giống Windows Explorer (filesystem-based, không cần DB crawl).

Endpoints:
  GET  /folder          — List folder contents (subfolders + files)
  GET  /search          — Search files by name
  GET  /file/preview    — Multi-format preview
  GET  /file/download   — Serve file for iframe/download
  GET  /stats           — Folder statistics
"""

from __future__ import annotations

import logging
import mimetypes
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form as FastAPIForm
from fastapi.responses import FileResponse

from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()

STAGING_DIR = Path("/data/onedrive-staging")

# Default start path — skip root noise, go straight to business folders
DEFAULT_START_PATH = "Puplic"

# Folders to hide at any level (system/irrelevant)
HIDDEN_FOLDERS = {
    "desktop.ini", "__pycache__", "node_modules", ".git",
    "Microsoft Copilot Chat Files", "Pictures", "Desktop",
    "Scans", "SC - Tai lieu 240916",
}

# Priority folders — shown first (case-insensitive)
PRIORITY_FOLDERS = ["BQMS", "BG", "IMV", "EAE", "LG", "AMA Quotation"]

CATEGORY_MAP = {
    "excel": {".xlsx", ".xls", ".xlsm", ".xlsb", ".csv"},
    "pdf": {".pdf"},
    "image": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"},
    "word": {".docx", ".doc"},
    "cad_3d": {".stp", ".step", ".x_t", ".x_b", ".igs", ".iges", ".stl"},
    "cad_2d": {".dwg", ".dxf"},
    "archive": {".zip", ".rar", ".7z"},
    "presentation": {".pptx", ".ppt"},
}

ICON_MAP = {
    "excel": "file-spreadsheet", "pdf": "file-text", "image": "image",
    "word": "file-text", "cad_3d": "box", "cad_2d": "pen-tool",
    "archive": "archive", "presentation": "presentation", "other": "file",
}

ALL_ROLES = ("staff", "warehouse", "sales", "accountant", "manager", "director", "admin")


def _cat(ext: str) -> str:
    ext = ext.lower()
    for cat, exts in CATEGORY_MAP.items():
        if ext in exts:
            return cat
    return "other"


def _safe(rel: str) -> Path:
    full = (STAGING_DIR / rel).resolve()
    if not str(full).startswith(str(STAGING_DIR.resolve())):
        raise HTTPException(403, "Truy cập bị từ chối")
    return full


# ---------------------------------------------------------------------------
# GET /folder — List folder contents (filesystem-based)
# ---------------------------------------------------------------------------

@router.get("/folder")
async def list_folder(
    path: str = Query("", description="Relative path from staging root"),
    sort_by: str = Query("name", description="name | size | modified | type"),
    sort_dir: str = Query("asc", description="asc | desc"),
    file_type: str | None = Query(None, description="Filter: excel, pdf, image, cad_3d, archive"),
    token_data: TokenData = Depends(require_role(*ALL_ROLES)),
):
    """List folder contents — subfolders first, then files."""
    folder = _safe(path)
    if not folder.exists():
        raise HTTPException(404, f"Thu muc khong ton tai: {path}")
    if not folder.is_dir():
        raise HTTPException(400, f"Khong phai thu muc: {path}")

    folders: list[dict] = []
    files: list[dict] = []

    try:
        entries = sorted(folder.iterdir(), key=lambda e: e.name.lower())
    except PermissionError:
        raise HTTPException(403, "Khong co quyen truy cap")

    for entry in entries:
        if entry.name.startswith((".", "~$", "__")):
            continue
        if entry.name in HIDDEN_FOLDERS or entry.name == "desktop.ini":
            continue
        rel = str(entry.relative_to(STAGING_DIR)).replace("\\", "/")

        if entry.is_dir():
            try:
                child_count = len([c for c in entry.iterdir()
                                   if not c.name.startswith(".") and c.name not in HIDDEN_FOLDERS])
            except PermissionError:
                child_count = 0
            folders.append({"name": entry.name, "path": rel, "type": "folder", "children_count": child_count})

        elif entry.is_file():
            # Skip system/temp files
            if entry.name.lower() in ("desktop.ini", "thumbs.db", ".ds_store"):
                continue
            if entry.suffix.lower() in (".tmp", ".lnk", ".crdownload"):
                continue
            ext = entry.suffix.lower()
            category = _cat(ext)
            if file_type and category != file_type:
                continue
            try:
                st = entry.stat()
                modified = datetime.fromtimestamp(st.st_mtime).isoformat()
                size = st.st_size
            except OSError:
                modified = None
                size = 0
            files.append({
                "name": entry.name, "path": rel, "type": "file",
                "extension": ext.lstrip("."), "category": category,
                "icon": ICON_MAP.get(category, "file"), "size": size, "modified": modified,
            })

    # Sort folders: priority first, then alphabetical
    priority_lower = [p.lower() for p in PRIORITY_FOLDERS]
    def folder_sort_key(f: dict) -> tuple:
        name_lower = f["name"].lower()
        try:
            idx = priority_lower.index(name_lower)
        except ValueError:
            idx = 999
        return (idx, name_lower)
    folders.sort(key=folder_sort_key)

    # Sort files
    reverse = sort_dir == "desc"
    key_map = {"size": lambda f: f["size"], "modified": lambda f: f.get("modified") or "",
               "type": lambda f: f["extension"]}
    files.sort(key=key_map.get(sort_by, lambda f: f["name"].lower()), reverse=reverse)

    parts = [p for p in path.split("/") if p]
    breadcrumb = [{"name": "OneDrive", "path": ""}]
    for i, part in enumerate(parts):
        breadcrumb.append({"name": part, "path": "/".join(parts[:i + 1])})

    return {"data": {"path": path, "breadcrumb": breadcrumb, "folders": folders, "files": files,
                      "total_folders": len(folders), "total_files": len(files)}}


# ---------------------------------------------------------------------------
# GET /search — Search files by name
# ---------------------------------------------------------------------------

@router.get("/search")
async def search_files(
    q: str = Query(..., min_length=2),
    path: str = Query(""),
    file_type: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role(*ALL_ROLES)),
):
    """Search files by name."""
    search_root = _safe(path)
    if not search_root.is_dir():
        raise HTTPException(400, "Khong phai thu muc")

    ql = q.lower()
    results: list[dict] = []
    for root, dirs, flist in os.walk(str(search_root)):
        dirs[:] = [d for d in dirs if not d.startswith((".", "__"))]
        for fname in flist:
            if ql not in fname.lower() or fname.startswith((".", "~$")):
                continue
            fp = Path(root) / fname
            ext = fp.suffix.lower()
            cat = _cat(ext)
            if file_type and cat != file_type:
                continue
            rel = str(fp.relative_to(STAGING_DIR)).replace("\\", "/")
            try:
                st = fp.stat()
            except OSError:
                continue
            results.append({
                "name": fname, "path": rel,
                "parent_path": str(fp.parent.relative_to(STAGING_DIR)).replace("\\", "/"),
                "extension": ext.lstrip("."), "category": cat,
                "icon": ICON_MAP.get(cat, "file"), "size": st.st_size,
                "modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
            })
            if len(results) >= limit:
                break
        if len(results) >= limit:
            break
    return {"data": results, "total": len(results), "query": q}


# ---------------------------------------------------------------------------
# GET /file/preview — Multi-format preview
# ---------------------------------------------------------------------------

@router.get("/file/preview")
async def file_preview(
    path: str = Query(...),
    sheet: str | None = Query(None),
    rows: int = Query(50, ge=1, le=500),
    token_data: TokenData = Depends(require_role(*ALL_ROLES)),
):
    """Preview file based on type."""
    fp = _safe(path)
    if not fp.is_file():
        raise HTTPException(404, "File khong ton tai")

    ext = fp.suffix.lower()
    cat = _cat(ext)
    try:
        st = fp.stat()
    except OSError:
        raise HTTPException(500, "Khong the doc file")

    base = {"file_path": path, "file_name": fp.name, "size": st.st_size,
            "extension": ext.lstrip("."), "category": cat,
            "download_url": f"/api/v1/file-browser/file/download?path={path}"}

    if ext in (".xlsx", ".xls", ".xlsm", ".xlsb"):
        try:
            from python_calamine import CalamineWorkbook
            wb = CalamineWorkbook.from_path(str(fp))
            sheets_list = wb.sheet_names
            active = sheet if sheet and sheet in sheets_list else sheets_list[0]
            all_rows = wb.get_sheet_by_name(active).to_python()
            hi = 0
            for i, row in enumerate(all_rows[:10]):
                if sum(1 for c in row if c is not None and str(c).strip()) >= 3:
                    hi = i
                    break
            headers = [str(c) if c else f"Col{j}" for j, c in enumerate(all_rows[hi])] if hi < len(all_rows) else []
            data_rows = [[str(c) if c is not None else "" for c in row] for row in all_rows[hi+1:hi+1+rows]]
            return {"data": {**base, "preview_type": "excel", "sheets": sheets_list,
                    "active_sheet": active, "total_rows": len(all_rows), "headers": headers, "rows": data_rows}}
        except Exception as exc:
            return {"data": {**base, "preview_type": "excel_error", "error": str(exc)}}

    if ext == ".pdf":
        return {"data": {**base, "preview_type": "pdf"}}
    if cat == "image":
        return {"data": {**base, "preview_type": "image"}}
    if ext in (".docx",):
        text = ""
        try:
            import zipfile as zf
            with zf.ZipFile(str(fp)) as z:
                with z.open("word/document.xml") as doc:
                    xml = doc.read().decode("utf-8", errors="replace")
                    text = " ".join(re.findall(r"<w:t[^>]*>([^<]+)</w:t>", xml))[:5000]
        except Exception as exc:
            text = f"Loi: {exc}"
        return {"data": {**base, "preview_type": "word", "text_content": text}}
    if ext == ".zip":
        try:
            import zipfile as zf
            with zf.ZipFile(str(fp)) as z:
                entries = [{"name": i.filename, "size": i.file_size, "is_dir": i.is_dir()} for i in z.infolist()[:200]]
            return {"data": {**base, "preview_type": "zip", "entries": entries}}
        except Exception as exc:
            return {"data": {**base, "preview_type": "zip_error", "error": str(exc)}}
    if cat == "cad_3d":
        return {"data": {**base, "preview_type": "cad_3d"}}
    if cat == "cad_2d":
        return {"data": {**base, "preview_type": "cad_2d"}}
    return {"data": {**base, "preview_type": "unsupported"}}


# ---------------------------------------------------------------------------
# GET /file/download — Serve file
# ---------------------------------------------------------------------------

# mimetypes inside the slim container does NOT know the Office Open XML types
# (guess_type('.xlsx') → None), so downloads fell back to octet-stream. Map them
# explicitly so the Content-Type is correct too.
_EXT_MIME = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
    ".csv": "text/csv",
}


@router.get("/file/download")
async def file_download(
    path: str = Query(...),
    token: str | None = Query(None),
    dl: int = Query(0, description="1 = tải về (attachment + filename); 0 = xem inline (preview iframe)"),
    token_data: TokenData = Depends(require_role(*ALL_ROLES)),
):
    """Serve file for download (dl=1) or inline preview (dl=0).

    BUG FIX (Thang 2026-06-17): the old code forced ``Content-Disposition: inline``
    via a manual header WITHOUT a filename. The "Tải về" link opens the URL in a new
    tab, so the browser saved the file as "download" with NO extension → Office files
    "không xem được" on Windows. Now dl=1 → ``attachment; filename*=...`` (FileResponse
    handles RFC-5987 encoding for Vietnamese names); dl=0 keeps inline for the preview.
    """
    fp = _safe(path)
    if not fp.is_file():
        raise HTTPException(404, "File khong ton tai")
    ct, _ = mimetypes.guess_type(str(fp))
    if not ct:
        ct = _EXT_MIME.get(fp.suffix.lower())
    return FileResponse(
        str(fp),
        media_type=ct or "application/octet-stream",
        filename=fp.name,
        content_disposition_type="attachment" if dl else "inline",
    )


# ---------------------------------------------------------------------------
# GET /stats — Folder statistics
# ---------------------------------------------------------------------------

@router.get("/stats")
async def folder_stats(
    path: str = Query(""),
    token_data: TokenData = Depends(require_role(*ALL_ROLES)),
):
    """Folder statistics — total files, size, by category."""
    folder = _safe(path)
    if not folder.is_dir():
        raise HTTPException(400, "Khong phai thu muc")

    stats: dict[str, int] = {}
    total_size = 0
    total_files = 0
    for root, dirs, flist in os.walk(str(folder)):
        dirs[:] = [d for d in dirs if not d.startswith((".", "__"))]
        for fname in flist:
            if fname.startswith((".", "~$")):
                continue
            fp = Path(root) / fname
            cat = _cat(fp.suffix.lower())
            stats[cat] = stats.get(cat, 0) + 1
            total_files += 1
            try:
                total_size += fp.stat().st_size
            except OSError:
                pass

    return {"data": {"path": path, "total_files": total_files, "total_size": total_size, "by_category": stats}}


# ---------------------------------------------------------------------------
# POST /file/upload — Upload file(s) to a folder
# Per Thang 2026-05-11: add upload PDF/xlsx/etc into Quản lý tài liệu folders.
# ---------------------------------------------------------------------------

@router.post("/file/upload")
async def upload_files(
    parent_path: str = FastAPIForm("", description="Folder where to drop the files"),
    overwrite: bool = FastAPIForm(False, description="Overwrite if file exists"),
    files: list[UploadFile] = File(..., description="One or more files to upload"),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
):
    """Upload one or more files into a folder under onedrive-staging.

    Constraints:
      - parent_path must resolve under STAGING_DIR (path traversal blocked).
      - Each file max 100 MB.
      - Allowed extensions: pdf, xlsx, xls, docx, doc, png, jpg, jpeg, gif,
        txt, csv, zip, 7z, dwg, dxf, step, stp, x_t.
      - If `overwrite=False` and filename exists → 409.
    """
    parent = _safe(parent_path)
    if not parent.is_dir():
        raise HTTPException(404, f"Thu muc cha khong ton tai: {parent_path}")

    ALLOWED = {
        ".pdf", ".xlsx", ".xls", ".docx", ".doc", ".png", ".jpg", ".jpeg",
        ".gif", ".txt", ".csv", ".zip", ".7z", ".dwg", ".dxf",
        ".step", ".stp", ".x_t", ".igs", ".iges",
    }
    MAX_SIZE = 100 * 1024 * 1024  # 100 MB

    results: list[dict] = []
    for upload in files:
        fname = (upload.filename or "").strip()
        if not fname:
            results.append({"name": "(empty)", "error": "Tên file rỗng"})
            continue
        # Strip any path components for safety
        fname = Path(fname).name
        if any(c in fname for c in '/\\:*?"<>|'):
            results.append({"name": fname, "error": "Tên file chứa ký tự cấm"})
            continue
        ext = Path(fname).suffix.lower()
        if ext not in ALLOWED:
            results.append({"name": fname, "error": f"Đuôi {ext} không cho phép"})
            continue

        target = parent / fname
        if target.exists() and not overwrite:
            results.append({"name": fname, "error": "File đã tồn tại (dùng overwrite=true để ghi đè)"})
            continue

        try:
            # Stream the upload to disk in chunks to avoid OOM on big files
            total = 0
            with open(target, "wb") as out_f:
                while True:
                    chunk = await upload.read(1024 * 1024)  # 1 MB
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_SIZE:
                        out_f.close()
                        target.unlink(missing_ok=True)
                        raise HTTPException(413, f"File {fname} vượt 100 MB")
                    out_f.write(chunk)
            rel = str(target.relative_to(STAGING_DIR)).replace("\\", "/")
            results.append({
                "name": fname,
                "size": total,
                "path": rel,
            })
            logger.info("Uploaded %s (%d B) to %s by %s",
                        fname, total, parent_path, token_data.email)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Upload failed for %s", fname)
            results.append({"name": fname, "error": str(exc)[:200]})

    succeeded = [r for r in results if "error" not in r]
    failed = [r for r in results if "error" in r]
    return {
        "data": {
            "uploaded": succeeded,
            "failed": failed,
            "total_uploaded": len(succeeded),
            "total_failed": len(failed),
        },
        "message": f"Upload xong: {len(succeeded)} OK, {len(failed)} lỗi",
    }


# ---------------------------------------------------------------------------
# POST /folder/create — Create new folder
# ---------------------------------------------------------------------------

@router.post("/folder/create")
async def create_folder(
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
):
    """Tao thu muc moi."""
    parent_path = body.get("parent_path", "")
    folder_name = body.get("name", "").strip()

    if not folder_name:
        raise HTTPException(400, "Ten thu muc khong duoc de trong")
    if any(c in folder_name for c in '/\\:*?"<>|'):
        raise HTTPException(400, "Ten thu muc chua ky tu khong hop le")

    parent = _safe(parent_path)
    if not parent.is_dir():
        raise HTTPException(404, "Thu muc cha khong ton tai")

    new_folder = parent / folder_name
    if new_folder.exists():
        raise HTTPException(409, f"Thu muc '{folder_name}' da ton tai")

    new_folder.mkdir(parents=False)
    rel = str(new_folder.relative_to(STAGING_DIR)).replace("\\", "/")
    logger.info("Created folder: %s by %s", rel, token_data.email)

    return {"data": {"name": folder_name, "path": rel}, "message": f"Da tao thu muc '{folder_name}'"}


# ---------------------------------------------------------------------------
# POST /file/move — Move file/folder to another location
# ---------------------------------------------------------------------------

@router.post("/file/move")
async def move_item(
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
):
    """Di chuyen file hoac thu muc sang vi tri moi."""
    import shutil

    source_path = body.get("source", "").strip()
    dest_folder = body.get("destination", "").strip()

    if not source_path or not dest_folder:
        raise HTTPException(400, "Thieu source hoac destination")

    src = _safe(source_path)
    dst_dir = _safe(dest_folder)

    if not src.exists():
        raise HTTPException(404, f"Khong tim thay: {source_path}")
    if not dst_dir.is_dir():
        raise HTTPException(400, f"Dich den khong phai thu muc: {dest_folder}")

    dst = dst_dir / src.name
    if dst.exists():
        raise HTTPException(409, f"'{src.name}' da ton tai trong thu muc dich")

    shutil.move(str(src), str(dst))
    new_rel = str(dst.relative_to(STAGING_DIR)).replace("\\", "/")
    logger.info("Moved %s -> %s by %s", source_path, new_rel, token_data.email)

    return {"data": {"old_path": source_path, "new_path": new_rel}, "message": f"Da di chuyen '{src.name}'"}


# ---------------------------------------------------------------------------
# POST /file/rename — Rename file or folder
# ---------------------------------------------------------------------------

@router.post("/file/rename")
async def rename_item(
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
):
    """Doi ten file hoac thu muc."""
    item_path = body.get("path", "").strip()
    new_name = body.get("new_name", "").strip()

    if not item_path or not new_name:
        raise HTTPException(400, "Thieu path hoac new_name")
    if any(c in new_name for c in '/\\:*?"<>|'):
        raise HTTPException(400, "Ten moi chua ky tu khong hop le")

    src = _safe(item_path)
    if not src.exists():
        raise HTTPException(404, f"Khong tim thay: {item_path}")

    dst = src.parent / new_name
    if dst.exists():
        raise HTTPException(409, f"'{new_name}' da ton tai")

    src.rename(dst)
    new_rel = str(dst.relative_to(STAGING_DIR)).replace("\\", "/")
    logger.info("Renamed %s -> %s by %s", item_path, new_rel, token_data.email)

    return {"data": {"old_path": item_path, "new_path": new_rel}, "message": f"Da doi ten thanh '{new_name}'"}


# ---------------------------------------------------------------------------
# DELETE /file/delete — Delete file or empty folder
# ---------------------------------------------------------------------------

@router.delete("/file/delete")
async def delete_item(
    path: str = Query(...),
    recursive: bool = Query(
        False,
        description="When true, non-empty folders are soft-deleted by renaming "
                    "to `.trash_<timestamp>_<name>` in the same parent. "
                    "Recover via shell mv. Empty folders + files always delete.",
    ),
    token_data: TokenData = Depends(require_role("admin", "manager")),
):
    """Xóa file hoặc thư mục (chỉ admin/manager).

    Thang 2026-05-22: thêm soft-delete cho thư mục có file. Pass recursive=true
    → rename folder → `.trash_<ts>_<original-name>` cùng parent. Không xóa thật
    → file vẫn còn đó, lúc nào cần recover thì shell `mv` lại.
    """
    import time
    target = _safe(path)
    if not target.exists():
        raise HTTPException(404, f"Không tìm thấy: {path}")

    if target.is_dir():
        children = list(target.iterdir())
        if children:
            if not recursive:
                raise HTTPException(
                    400,
                    "Thư mục có file bên trong. Gửi recursive=true để "
                    "chuyển vào thùng rác (có thể khôi phục).",
                )
            ts = int(time.time())
            trash_name = f".trash_{ts}_{target.name}"
            trash_path = target.parent / trash_name
            # If collision (unlikely with timestamp), append counter
            n = 1
            while trash_path.exists():
                trash_path = target.parent / f"{trash_name}_{n}"
                n += 1
            target.rename(trash_path)
            logger.info(
                "Soft-deleted folder %s → %s by %s",
                path, trash_path.name, token_data.email,
            )
            return {
                "message": f"Đã chuyển '{target.name}' vào thùng rác",
                "trash_path": str(trash_path.relative_to(target.parent.anchor)) if trash_path.is_absolute() else str(trash_path),
                "trash_name": trash_path.name,
            }
        target.rmdir()
        logger.info("Deleted empty folder %s by %s", path, token_data.email)
    else:
        target.unlink()
        logger.info("Deleted file %s by %s", path, token_data.email)
    return {"message": f"Đã xóa '{target.name}'"}
