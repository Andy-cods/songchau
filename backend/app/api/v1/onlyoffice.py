"""OnlyOffice Document Server integration.

Per Thang 2026-05-11: allow inline xlsx editing for files in onedrive-staging.
User clicks "Sửa" in /documents/browser → opens /documents/edit?path=... → that
page loads OnlyOffice DocEditor in an iframe, which fetches the xlsx, lets
user edit, then POSTs back to our callback when saved.

Flow:
  1. Frontend → GET /api/v1/onlyoffice/config?path=<xlsx>
       Returns DocsAPI config JSON + a signed short_token in `document.url`
       and `editorConfig.callbackUrl`. The OnlyOffice container fetches
       the file using that token, no JWT auth on file endpoint.

  2. OnlyOffice → GET /api/v1/onlyoffice/file?token=<short_token>
       Serves the xlsx bytes. Token verifies path + expiry.

  3. OnlyOffice → POST /api/v1/onlyoffice/callback?token=<short_token>
       Called when user saves / closes editor with changes. Body contains
       `{status: 2 or 6, url: <new_xlsx_url>}` — we download from `url`
       and replace the original file. Re-renders PDF via Gotenberg.

Container reachability:
  - sc-onlyoffice ↔ sc-api on docker network 'erp_internal'.
  - OnlyOffice fetches files at `http://api:8000/api/v1/onlyoffice/file?token=...`.
  - User browser loads OnlyOffice JS at `https://app.songchau.vn/onlyoffice/...`
    (proxied by nginx → sc-onlyoffice:80).
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse

from app.core.config import settings
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter(tags=["onlyoffice"])

# Allowed root for files we'll serve to OnlyOffice
ALLOWED_ROOT = Path("/data/onedrive-staging").resolve()
TOKEN_TTL_SECONDS = 4 * 3600   # editor session validity
SECRET = (settings.JWT_SECRET_KEY or "onlyoffice-fallback").encode()
BACKUP_KEEP = 3   # keep only last N backups per file


def _sign_token(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    sig = hmac.new(SECRET, body, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(body).decode().rstrip("=") + "." + \
           base64.urlsafe_b64encode(sig).decode().rstrip("=")


def _verify_token(token: str) -> dict[str, Any]:
    try:
        body_b64, sig_b64 = token.split(".")
        pad = "=" * (-len(body_b64) % 4)
        body = base64.urlsafe_b64decode(body_b64 + pad)
        pad2 = "=" * (-len(sig_b64) % 4)
        sig = base64.urlsafe_b64decode(sig_b64 + pad2)
        expected = hmac.new(SECRET, body, hashlib.sha256).digest()
        if not hmac.compare_digest(sig, expected):
            raise ValueError("bad signature")
        payload = json.loads(body)
        if payload.get("exp", 0) < int(time.time()):
            raise ValueError("expired")
        return payload
    except Exception as exc:
        raise HTTPException(403, f"invalid file token: {exc}")


def _safe_resolve(path: str) -> Path:
    p = Path(path).resolve()
    try:
        p.relative_to(ALLOWED_ROOT)
    except ValueError:
        raise HTTPException(403, f"path outside allowed root: {p}")
    if not p.exists():
        raise HTTPException(404, f"file not found: {p}")
    if p.suffix.lower() not in (".xlsx", ".xls", ".docx", ".doc"):
        raise HTTPException(400, "only office files allowed")
    return p


@router.get("/onlyoffice/config")
async def onlyoffice_editor_config(
    request: Request,
    path: str = Query(..., description="Absolute path to xlsx under /data/onedrive-staging/"),
    session: str | None = Query(None, description="Frontend session id — append to doc_key to force a fresh editor instance on every page load (bypasses OnlyOffice's per-key cache that can serve stale state when the user reopens the same file)."),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Return DocsAPI editor config + signed file token (TTL 4h).

    Frontend pages this and feeds it to `new DocsAPI.DocEditor(placeholder, config)`.

    Thang 2026-05-21: added `session` query param. Frontend should pass a
    per-page-load value (e.g. Date.now()) so doc_key is unique every time.
    Without this, OnlyOffice keeps the document open in shared mode and may
    show stale state if the user closes + reopens the editor — which was
    showing up as "the editor opens but won't accept changes" complaints.
    """
    p = _safe_resolve(path)
    mtime = int(p.stat().st_mtime)
    # Sign a short token that authorizes OnlyOffice to fetch+save the file
    file_token = _sign_token({
        "path": str(p),
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
        "user_id": str(token_data.user_id),
        "mtime": mtime,
        # bind token to the same session — replay protection across users.
        "session": session or "",
    })

    # Document key — unique per (file content, session) so each editor open
    # gets a fresh DocsAPI instance even when mtime hasn't changed.
    key_input = f"{p}_{mtime}_{session or ''}_{token_data.user_id}"
    doc_key = hashlib.sha1(key_input.encode()).hexdigest()[:22]

    # URLs that OnlyOffice (container) uses — internal docker-network host.
    # sc-onlyoffice resolves "api" as the sc-api container.
    internal_base = "http://api:8000"
    file_url = f"{internal_base}/api/v1/onlyoffice/file?token={file_token}"
    callback_url = f"{internal_base}/api/v1/onlyoffice/callback?token={file_token}"

    ext = p.suffix.lower().lstrip(".")
    # OnlyOffice spec: documentType MUST be one of word|cell|slide|pdf|diagram
    # Previous bug (Thang 2026-05-13): "spreadsheet" was wrong → editor crashed
    # with "Có lỗi xảy ra" + NotFoundError insertBefore in iframe.
    doc_type = (
        "cell" if ext in ("xlsx", "xls", "csv") else
        "word" if ext in ("docx", "doc") else
        "slide" if ext in ("pptx", "ppt") else
        "pdf" if ext == "pdf" else
        "cell"  # safe default for unknowns
    )

    config = {
        "document": {
            "fileType": ext,
            "key": doc_key,
            "title": p.name,
            "url": file_url,
            "permissions": {
                "edit": True,
                "download": True,
                "print": True,
                "review": True,
            },
        },
        "documentType": doc_type,
        "editorConfig": {
            "mode": "edit",
            "lang": "vi",
            "callbackUrl": callback_url,
            "user": {
                "id": str(token_data.user_id),
                "name": token_data.email or "ERP user",
            },
            "customization": {
                "autosave": True,
                "forcesave": True,
                "compactToolbar": False,
                "uiTheme": "default-light",
            },
        },
        "type": "desktop",
        # `width`/`height` controlled by container CSS
    }
    return {"data": config, "file_token": file_token}


@router.get("/onlyoffice/file")
async def onlyoffice_file_get(token: str = Query(...)):
    """OnlyOffice container fetches the xlsx via this endpoint using the
    signed token. No JWT auth — the token IS the auth."""
    payload = _verify_token(token)
    p = Path(payload["path"]).resolve()
    try:
        p.relative_to(ALLOWED_ROOT)
    except ValueError:
        raise HTTPException(403, "path violation")
    if not p.exists():
        raise HTTPException(404, "file disappeared")
    return FileResponse(
        path=str(p), filename=p.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def _purge_old_backups(p: Path, keep: int = BACKUP_KEEP) -> None:
    """Keep only the `keep` most recent `.bak-<ts>` siblings; delete the rest.

    Backup naming: `{p}.bak-{unix_ts}` (e.g. `quote.xlsx.bak-1716045123`).
    Hidden under `.onlyoffice-backups/` so the file browser doesn't show them.
    """
    backup_dir = p.parent / ".onlyoffice-backups"
    if not backup_dir.exists():
        return
    prefix = f"{p.name}.bak-"
    candidates = sorted(
        (f for f in backup_dir.iterdir() if f.name.startswith(prefix)),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    for old in candidates[keep:]:
        try:
            old.unlink()
        except Exception as exc:
            logger.warning("purge backup %s failed: %s", old.name, exc)


async def _regenerate_pdf(xlsx_path: str) -> None:
    """Background task: convert xlsx → pdf via Gotenberg.

    Run AFTER callback returns so the OnlyOffice container doesn't time out
    waiting for slow conversion (was blocking saves up to 30s on big files).
    """
    try:
        from app.services.gotenberg_service import convert_xlsx_to_pdf
        pdf_path = str(Path(xlsx_path).with_suffix(".pdf"))
        await convert_xlsx_to_pdf(xlsx_path, pdf_path)
        logger.info("OnlyOffice → PDF re-rendered (bg): %s", pdf_path)
    except Exception as exc:
        logger.warning("Re-render PDF (bg) failed for %s: %s", xlsx_path, exc)


@router.post("/onlyoffice/callback")
async def onlyoffice_callback(
    background_tasks: BackgroundTasks,
    token: str = Query(...),
    payload: dict[str, Any] = None,
):
    """OnlyOffice posts here on save/forcesave/close events.
    status meanings (OnlyOffice spec):
      0 = no doc activity (init)
      1 = editing in progress
      2 = ready for saving (closed, save needed)
      3 = save failed (editing was bad)
      4 = closed without changes
      6 = force-save requested while editing
      7 = force-save failed
    We download from `payload.url` and overwrite the file on statuses 2 & 6.
    PDF re-render runs as a background task so we don't block the callback
    response (OnlyOffice times out after 30s).
    Per spec, MUST return `{"error": 0}` on success."""
    info = _verify_token(token)
    p = Path(info["path"]).resolve()
    status = (payload or {}).get("status")
    url = (payload or {}).get("url")

    logger.info("OnlyOffice callback path=%s status=%s url=%s",
                p.name, status, (url or "")[:80])

    # Log editor-side failures so we can surface a meaningful error in Activity
    if status == 3:
        logger.error("OnlyOffice save failed (status=3): %s — payload=%s",
                     p.name, json.dumps(payload, ensure_ascii=False)[:300])
    elif status == 7:
        logger.error("OnlyOffice force-save failed (status=7): %s — payload=%s",
                     p.name, json.dumps(payload, ensure_ascii=False)[:300])

    if status in (2, 6) and url:
        # Download the new xlsx from the OnlyOffice document server
        try:
            async with httpx.AsyncClient(timeout=60.0) as cli:
                r = await cli.get(url)
                r.raise_for_status()
                new_bytes = r.content
            # Backup the previous version then overwrite. Backups live in a
            # hidden sibling folder so they don't appear in /documents/browser.
            backup_dir = p.parent / ".onlyoffice-backups"
            backup_dir.mkdir(exist_ok=True)
            backup_path = backup_dir / f"{p.name}.bak-{int(time.time())}"
            try:
                if p.exists():
                    p.replace(backup_path)
            except Exception as exc:
                logger.warning("backup rename failed (proceeding anyway): %s", exc)
            p.write_bytes(new_bytes)
            logger.info("OnlyOffice saved %s (%d bytes, backup=%s)",
                        p.name, len(new_bytes), backup_path.name)

            # Purge old backups (keep last BACKUP_KEEP) — disk-bloat fix
            _purge_old_backups(p)

            # Re-render PDF next to the xlsx — runs AFTER response sent so
            # OnlyOffice doesn't wait on Gotenberg.
            if p.suffix.lower() == ".xlsx":
                background_tasks.add_task(_regenerate_pdf, str(p))
        except Exception as exc:
            logger.exception("OnlyOffice callback save failed: %s", exc)
            return JSONResponse({"error": 1, "message": str(exc)})

    return JSONResponse({"error": 0})


@router.post("/onlyoffice/force-save")
async def onlyoffice_force_save(
    path: str = Query(..., description="Same path used in /config"),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """User-triggered save. Calls OnlyOffice Command Service `forcesave`,
    which makes the document server POST a status=6 callback back to us
    immediately (instead of waiting for autosave or editor close).

    Lets the user click a "Save" button in the editor UI instead of having
    to close the tab to flush changes.
    """
    p = _safe_resolve(path)
    mtime = int(p.stat().st_mtime)
    doc_key = hashlib.sha1(f"{p}_{mtime}".encode()).hexdigest()[:20]
    cmd_url = "http://onlyoffice/coauthoring/CommandService.ashx"
    body = {"c": "forcesave", "key": doc_key}
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            r = await cli.post(cmd_url, json=body)
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"raw": r.text}
        # OnlyOffice returns {"error": N} — 0=ok, 4=no changes, 1/3/4/5/6=fail
        logger.info("force-save %s → %s", p.name, data)
        return {"data": data, "key": doc_key}
    except Exception as exc:
        logger.warning("force-save call failed: %s", exc)
        raise HTTPException(502, f"OnlyOffice command service unreachable: {exc}")
