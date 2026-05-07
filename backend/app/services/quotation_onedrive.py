"""
Quotation → OneDrive sync (Song Chau ERP, M-quotation P2).

Workflow:
  1. After autofill_service.run_autofill_job() generates files locally at
     /data/files/RFQ {year}/THANG {month}/{rfq_no} ... /,
     this module uploads them to OneDrive under
     /Bao_Gia_BQMS/RFQ {year}/THANG {month}/{rfq_no}/
  2. Returns Graph item ids + webUrl + share link to be saved on the
     quotations row.

Folder root on OneDrive (per Thang 2026-05-07):
    /Bao_Gia_BQMS/

Edit / share / delete are done by the caller; this module is upload-only.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any, Optional

import httpx

from app.etl.onedrive_client import OneDriveClient, OneDriveError, OneDriveAPIError

logger = logging.getLogger(__name__)

# Root folder per Thang's instruction (separate from /Puplic/BQMS staging).
ROOT_FOLDER = "/Bao_Gia_BQMS"


# ---------------------------------------------------------------------------
# Graph helpers (idempotent folder creation, share-link generation)
# ---------------------------------------------------------------------------

async def _ensure_folder_chain(client: OneDriveClient, parts: list[str]) -> str:
    """
    Walk path components, creating folders if missing. Returns the absolute
    OneDrive path (e.g. "/Bao_Gia_BQMS/RFQ 2026/THANG 5/QT26043201").

    Uses `create_folder(..., conflictBehavior=fail)` and treats HTTP 409
    (folder already exists) as success — that's the cheapest "ensure" pattern
    against the Graph API without an extra GET round-trip.
    """
    current = ""
    for p in parts:
        parent = current or "/"
        try:
            await client.create_folder(parent_path=parent, folder_name=p)
        except OneDriveAPIError as exc:
            # 409 = already exists, 412 = nameAlreadyExists.
            if exc.status_code in (409, 412):
                pass
            else:
                raise
        current = f"{current}/{p}" if current else f"/{p}"
    return current


async def _create_share_link(
    client: OneDriveClient,
    item_id: str,
    scope: str = "anonymous",
    link_type: str = "view",
) -> Optional[str]:
    """
    Create an M365 share link for an item via Graph `/createLink`.

    scope: 'anonymous' (anyone with link) | 'organization' (Song Chau tenant)
    link_type: 'view' (read-only) | 'edit' (can modify)

    Returns webUrl of the share link, or None on failure (warn + swallow).
    """
    inner = client._ensure_client()  # noqa: SLF001 — re-use authenticated client
    headers = await client._auth_headers()  # noqa: SLF001
    if not client._drive_id:  # noqa: SLF001
        return None

    url = (
        f"{client.GRAPH_URL}/drives/{client._drive_id}"  # noqa: SLF001
        f"/items/{item_id}/createLink"
    )
    body = {"type": link_type, "scope": scope}
    try:
        resp = await inner.post(url, headers=headers, json=body)
        resp.raise_for_status()
        return resp.json().get("link", {}).get("webUrl")
    except httpx.HTTPStatusError as e:
        logger.warning("createLink failed for %s: HTTP %s", item_id, e.response.status_code)
        return None
    except Exception as e:
        logger.warning("createLink unexpected error for %s: %s", item_id, e)
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def sync_quotation_to_onedrive(
    rfq_no: str,
    local_files: list[dict[str, str]],
    year: int,
    month: int,
    create_share_links: bool = True,
) -> dict[str, Any]:
    """
    Upload all generated quotation files for one quotation to OneDrive.

    Args:
        rfq_no: RFQ number — last folder segment.
        local_files: list of {"type": "cam_ket_pdf", "path": "/data/files/.../CAM_KET_x.pdf"}.
        year, month: period for folder hierarchy.
        create_share_links: if True, also create anonymous-view links.

    Returns dict with keys:
        folder_path:    "/Bao_Gia_BQMS/RFQ 2026/THANG 5/QT26043201"
        folder_id:      Graph driveItem id of the leaf folder
        items:          [{type, path, item_id, web_url, share_url}, ...]
        primary_url:    Web URL of QUOTATION PDF (or first PDF)
        primary_share:  Share URL of same
        errors:         list of error strings (non-fatal)
    """
    safe_rfq = rfq_no.replace("/", "-").replace("\\", "-").replace(":", "-")
    parts = [
        ROOT_FOLDER.lstrip("/"),
        f"RFQ {year}",
        f"THANG {month}",
        safe_rfq,
    ]
    result: dict[str, Any] = {
        "folder_path": "/" + "/".join(parts),
        "folder_id": None,
        "items": [],
        "primary_url": None,
        "primary_share": None,
        "errors": [],
    }

    try:
        async with OneDriveClient() as client:
            # 1. Ensure parent folder chain exists
            folder_path = await _ensure_folder_chain(client, parts)
            result["folder_path"] = folder_path

            # 2. Resolve folder item id (for delete-folder later)
            try:
                inner = client._ensure_client()  # noqa: SLF001
                headers = await client._auth_headers()  # noqa: SLF001
                resp = await inner.get(
                    f"{client.GRAPH_URL}/drives/{client._drive_id}/root:{folder_path}",  # noqa: SLF001
                    headers=headers,
                )
                resp.raise_for_status()
                result["folder_id"] = resp.json().get("id")
            except Exception as e:
                logger.warning("Resolve folder_id failed: %s", e)

            # 3. Upload each file
            for f in local_files:
                local_path = f.get("path")
                ftype = f.get("type", "")
                if not local_path or not os.path.exists(local_path):
                    result["errors"].append(f"Local file missing: {ftype} {local_path}")
                    continue
                fname = os.path.basename(local_path)
                remote_path = f"{folder_path}/{fname}"

                try:
                    with open(local_path, "rb") as fh:
                        content = fh.read()
                    item = await client.upload_file(content=content, remote_path=remote_path)
                    item_id = item.get("id")
                    web_url = item.get("webUrl")

                    share_url: Optional[str] = None
                    if create_share_links and item_id:
                        share_url = await _create_share_link(
                            client, item_id,
                            scope="anonymous",
                            link_type="view",
                        )

                    result["items"].append({
                        "type": ftype,
                        "path": local_path,
                        "remote_path": remote_path,
                        "item_id": item_id,
                        "web_url": web_url,
                        "share_url": share_url,
                    })

                    # Pick the QUOTATION PDF as primary; otherwise first PDF, otherwise any.
                    is_pdf = ftype.endswith("_pdf")
                    is_quotation = "quotation" in ftype.lower()
                    if is_pdf and (is_quotation or result["primary_url"] is None):
                        if is_quotation or "primary_url_locked" not in result:
                            result["primary_url"] = web_url
                            result["primary_share"] = share_url
                            if is_quotation:
                                result["primary_url_locked"] = True

                except OneDriveAPIError as e:
                    result["errors"].append(f"{ftype}: {e}")
                except Exception as e:
                    result["errors"].append(f"{ftype} unexpected: {e}")
    except OneDriveError as e:
        result["errors"].append(f"OneDrive auth/init failed: {e}")
    except Exception as e:
        logger.exception("sync_quotation_to_onedrive crashed")
        result["errors"].append(f"crashed: {e}")

    return result


async def delete_quotation_folder(folder_id: str) -> tuple[bool, Optional[str]]:
    """
    Delete an entire OneDrive folder by its Graph item id.

    Returns (ok, error_message).
    """
    if not folder_id:
        return False, "folder_id is empty"
    try:
        async with OneDriveClient() as client:
            ok = await client.delete_item(folder_id)
            return ok, None
    except OneDriveError as e:
        return False, str(e)
    except Exception as e:
        return False, f"unexpected: {e}"


async def get_or_create_share_link(
    item_id: str,
    scope: str = "anonymous",
    link_type: str = "view",
) -> tuple[Optional[str], Optional[str]]:
    """
    Top-level wrapper: return (web_url, error). Used by the share-link API.
    """
    try:
        async with OneDriveClient() as client:
            url = await _create_share_link(client, item_id, scope=scope, link_type=link_type)
            if url:
                return url, None
            return None, "createLink returned no URL"
    except OneDriveError as e:
        return None, str(e)
    except Exception as e:
        return None, f"unexpected: {e}"


async def upload_one_file(
    rfq_no: str,
    local_path: str,
    year: int,
    month: int,
) -> dict[str, Any]:
    """
    One-shot upload: ensure folder + upload + return URLs. Used by the
    manual /sync-onedrive endpoint when re-uploading a single file.
    """
    return await sync_quotation_to_onedrive(
        rfq_no=rfq_no,
        local_files=[{"type": "manual", "path": local_path}],
        year=year,
        month=month,
        create_share_links=True,
    )
