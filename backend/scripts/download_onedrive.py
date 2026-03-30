#!/usr/bin/env python3
"""
Song Châu ERP — Download tất cả file Excel từ OneDrive vào local staging.

Sử dụng Microsoft Graph API (MSAL) để:
1. Authenticate bằng client credentials (M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET)
2. List toàn bộ file trong M365_DRIVE_ID
3. Download file .xlsx/.xls vào /data/onedrive-staging/
4. Lưu delta_token cho lần sync kế tiếp (incremental)

Biến môi trường cần thiết:
    M365_TENANT_ID      — Azure AD tenant ID
    M365_CLIENT_ID      — App registration client ID
    M365_CLIENT_SECRET   — App registration secret
    M365_DRIVE_ID       — OneDrive drive ID

Usage:
    python scripts/download_onedrive.py
    python scripts/download_onedrive.py --output /data/onedrive-staging
    python scripts/download_onedrive.py --delta           # Chỉ tải file thay đổi
    python scripts/download_onedrive.py --dry-run         # Liệt kê file, không tải
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("download_onedrive")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_OUTPUT = os.getenv("ONEDRIVE_STAGING_PATH", "/data/onedrive-staging")
DELTA_TOKEN_FILE = ".onedrive_delta_token"
EXCEL_EXTENSIONS = {".xlsx", ".xls", ".xlsm"}

# ---------------------------------------------------------------------------
# Microsoft Graph client
# ---------------------------------------------------------------------------

class OneDriveClient:
    """Client tương tác Microsoft Graph API để download file từ OneDrive."""

    GRAPH_BASE = "https://graph.microsoft.com/v1.0"
    SCOPES = ["https://graph.microsoft.com/.default"]

    def __init__(
        self,
        tenant_id: str,
        client_id: str,
        client_secret: str,
        drive_id: str,
    ):
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.drive_id = drive_id
        self._access_token: str | None = None

    def authenticate(self) -> None:
        """Lấy access token bằng MSAL client credentials flow."""
        import msal

        app = msal.ConfidentialClientApplication(
            client_id=self.client_id,
            client_credential=self.client_secret,
            authority=f"https://login.microsoftonline.com/{self.tenant_id}",
        )

        result = app.acquire_token_for_client(scopes=self.SCOPES)

        if "access_token" not in result:
            error = result.get("error_description", result.get("error", "Unknown"))
            raise RuntimeError(f"MSAL authentication failed: {error}")

        self._access_token = result["access_token"]
        logger.info("Microsoft Graph: đã xác thực thành công.")

    def _headers(self) -> dict[str, str]:
        if not self._access_token:
            raise RuntimeError("Chưa xác thực — gọi authenticate() trước.")
        return {"Authorization": f"Bearer {self._access_token}"}

    def list_all_files(
        self,
        folder_path: str = "/",
    ) -> list[dict[str, Any]]:
        """
        Liệt kê toàn bộ file Excel trong OneDrive (đệ quy).
        Trả về list dict với keys: id, name, path, size, lastModifiedDateTime.
        """
        import httpx

        files: list[dict[str, Any]] = []
        url = f"{self.GRAPH_BASE}/drives/{self.drive_id}/root/children"

        if folder_path and folder_path != "/":
            # Encode path
            url = f"{self.GRAPH_BASE}/drives/{self.drive_id}/root:{folder_path}:/children"

        self._list_recursive(url, files)
        return files

    def _list_recursive(
        self,
        url: str,
        files: list[dict[str, Any]],
    ) -> None:
        """Đệ quy liệt kê file trong OneDrive."""
        import httpx

        with httpx.Client(timeout=60) as client:
            while url:
                resp = client.get(url, headers=self._headers())
                resp.raise_for_status()
                data = resp.json()

                for item in data.get("value", []):
                    if "folder" in item:
                        # Thư mục — đệ quy vào
                        child_url = (
                            f"{self.GRAPH_BASE}/drives/{self.drive_id}"
                            f"/items/{item['id']}/children"
                        )
                        self._list_recursive(child_url, files)
                    elif "file" in item:
                        name = item.get("name", "")
                        ext = Path(name).suffix.lower()
                        if ext in EXCEL_EXTENSIONS:
                            parent_path = (
                                item.get("parentReference", {})
                                .get("path", "")
                                .replace(f"/drives/{self.drive_id}/root:", "")
                            )
                            files.append({
                                "id": item["id"],
                                "name": name,
                                "path": f"{parent_path}/{name}",
                                "size": item.get("size", 0),
                                "lastModifiedDateTime": item.get("lastModifiedDateTime"),
                            })

                # Pagination
                url = data.get("@odata.nextLink")

    def list_delta(
        self,
        delta_token: str | None = None,
    ) -> tuple[list[dict[str, Any]], str]:
        """
        Delta query — chỉ lấy file đã thay đổi từ lần sync trước.
        Trả về (changed_files, new_delta_token).
        """
        import httpx

        if delta_token:
            url = delta_token
        else:
            url = f"{self.GRAPH_BASE}/drives/{self.drive_id}/root/delta"

        files: list[dict[str, Any]] = []
        new_token = ""

        with httpx.Client(timeout=60) as client:
            while url:
                resp = client.get(url, headers=self._headers())
                resp.raise_for_status()
                data = resp.json()

                for item in data.get("value", []):
                    if "file" in item:
                        name = item.get("name", "")
                        ext = Path(name).suffix.lower()
                        if ext in EXCEL_EXTENSIONS:
                            parent_path = (
                                item.get("parentReference", {})
                                .get("path", "")
                                .replace(f"/drives/{self.drive_id}/root:", "")
                            )
                            files.append({
                                "id": item["id"],
                                "name": name,
                                "path": f"{parent_path}/{name}",
                                "size": item.get("size", 0),
                                "lastModifiedDateTime": item.get("lastModifiedDateTime"),
                                "deleted": "deleted" in item,
                            })

                url = data.get("@odata.nextLink")

                if "@odata.deltaLink" in data:
                    new_token = data["@odata.deltaLink"]

        return files, new_token

    def download_file(
        self,
        file_id: str,
        local_path: Path,
    ) -> int:
        """
        Download file từ OneDrive về local.
        Trả về file size in bytes.
        """
        import httpx

        url = f"{self.GRAPH_BASE}/drives/{self.drive_id}/items/{file_id}/content"

        local_path.parent.mkdir(parents=True, exist_ok=True)

        with httpx.Client(timeout=120, follow_redirects=True) as client:
            resp = client.get(url, headers=self._headers())
            resp.raise_for_status()

            local_path.write_bytes(resp.content)
            return len(resp.content)


# ---------------------------------------------------------------------------
# Delta token persistence
# ---------------------------------------------------------------------------

def load_delta_token(output_dir: Path) -> str | None:
    """Đọc delta_token từ file."""
    token_path = output_dir / DELTA_TOKEN_FILE
    if token_path.exists():
        try:
            data = json.loads(token_path.read_text(encoding="utf-8"))
            return data.get("delta_token")
        except Exception:
            return None
    return None


def save_delta_token(output_dir: Path, token: str) -> None:
    """Lưu delta_token vào file."""
    token_path = output_dir / DELTA_TOKEN_FILE
    token_path.write_text(
        json.dumps({"delta_token": token}, indent=2),
        encoding="utf-8",
    )
    logger.info("Đã lưu delta_token vào %s", token_path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(
    output_dir: str,
    use_delta: bool = False,
    dry_run: bool = False,
) -> None:
    """Download tất cả file Excel từ OneDrive."""

    # Kiểm tra env vars
    tenant_id = os.getenv("M365_TENANT_ID", "")
    client_id = os.getenv("M365_CLIENT_ID", "")
    client_secret = os.getenv("M365_CLIENT_SECRET", "")
    drive_id = os.getenv("M365_DRIVE_ID", "")

    if not all([tenant_id, client_id, client_secret, drive_id]):
        logger.warning(
            "Thiếu biến môi trường M365_* — bỏ qua download OneDrive.\n"
            "  Cần: M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET, M365_DRIVE_ID\n"
            "  Để test import, copy file Excel vào thư mục %s thủ công.",
            output_dir,
        )
        return

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    logger.info("=" * 60)
    logger.info("SONG CHÂU ERP — DOWNLOAD FILE TỪ ONEDRIVE")
    logger.info("=" * 60)
    logger.info("Output   : %s", output_dir)
    logger.info("Delta    : %s", use_delta)
    logger.info("Dry run  : %s", dry_run)
    logger.info("-" * 60)

    start_time = time.time()

    # Khởi tạo client
    client = OneDriveClient(
        tenant_id=tenant_id,
        client_id=client_id,
        client_secret=client_secret,
        drive_id=drive_id,
    )

    try:
        client.authenticate()
    except Exception as e:
        logger.error("Lỗi xác thực Microsoft Graph: %s", e)
        sys.exit(1)

    # Lấy danh sách file
    if use_delta:
        delta_token = load_delta_token(output_path)
        if delta_token:
            logger.info("Sử dụng delta_token từ lần sync trước.")
        else:
            logger.info("Không có delta_token — tải toàn bộ.")

        files, new_delta_token = client.list_delta(delta_token)
        logger.info("Delta query: %d file thay đổi.", len(files))
    else:
        files = client.list_all_files()
        new_delta_token = ""
        logger.info("Full listing: %d file Excel.", len(files))

    if not files:
        logger.info("Không có file nào để tải.")
        return

    # Download files
    downloaded = 0
    skipped = 0
    errors = 0
    total_bytes = 0

    for i, f in enumerate(files, start=1):
        relative_path = f["path"].lstrip("/")
        local_path = output_path / relative_path

        # Bỏ qua file đã xóa trên OneDrive (delta mode)
        if f.get("deleted"):
            if local_path.exists():
                logger.info("  [DEL] %s", relative_path)
                if not dry_run:
                    local_path.unlink()
            continue

        if dry_run:
            size_kb = f["size"] / 1024
            logger.info(
                "  [%d/%d] [DRY-RUN] %s (%.1f KB)",
                i, len(files), relative_path, size_kb,
            )
            skipped += 1
            continue

        try:
            size = client.download_file(f["id"], local_path)
            total_bytes += size
            downloaded += 1

            if downloaded % 50 == 0 or downloaded <= 5:
                logger.info(
                    "  [%d/%d] %s (%.1f KB)",
                    i, len(files), relative_path, size / 1024,
                )
        except Exception as e:
            errors += 1
            logger.warning("  [ERR] %s: %s", relative_path, e)

    # Lưu delta token
    if new_delta_token and not dry_run:
        save_delta_token(output_path, new_delta_token)

    elapsed = time.time() - start_time

    # Tổng kết
    logger.info("")
    logger.info("=" * 60)
    logger.info("TỔNG KẾT DOWNLOAD")
    logger.info("=" * 60)
    logger.info("Tổng file       : %d", len(files))
    logger.info("Đã tải          : %d", downloaded)
    logger.info("Bỏ qua          : %d", skipped)
    logger.info("Lỗi             : %d", errors)
    logger.info("Tổng dung lượng : %.1f MB", total_bytes / (1024 * 1024))
    logger.info("Thời gian       : %.1f giây", elapsed)
    logger.info("=" * 60)


def cli() -> None:
    parser = argparse.ArgumentParser(
        description="Song Châu ERP — Download file Excel từ OneDrive",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Thư mục lưu file (mặc định: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--delta",
        action="store_true",
        help="Chỉ tải file thay đổi (incremental sync)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Liệt kê file, không tải về",
    )

    args = parser.parse_args()

    main(
        output_dir=args.output,
        use_delta=args.delta,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    cli()
