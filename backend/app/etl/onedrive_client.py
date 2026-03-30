"""
OneDrive ETL Client — Microsoft Graph API integration for delta sync.

Uses the client credentials flow (daemon app) to sync Excel files from
a shared OneDrive/SharePoint folder to the local processing pipeline.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
import msal

from app.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------

class OneDriveError(Exception):
    """Base exception cho mọi lỗi liên quan đến OneDrive."""


class OneDriveAuthError(OneDriveError):
    """Lỗi xác thực với Microsoft Graph API."""


class OneDriveAPIError(OneDriveError):
    """Lỗi khi gọi Microsoft Graph API."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


# ---------------------------------------------------------------------------
# OneDrive Client
# ---------------------------------------------------------------------------

class OneDriveClient:
    """
    Async client for Microsoft Graph API — OneDrive delta sync.

    Authenticates via client credentials flow (M365_TENANT_ID, M365_CLIENT_ID,
    M365_CLIENT_SECRET) and syncs changed Excel files from a specific drive.

    Usage::

        async with OneDriveClient() as client:
            files, new_delta_token = await client.delta_sync(last_delta_token)
            for f in files:
                content = await client.download_file(f["id"])
    """

    GRAPH_URL = "https://graph.microsoft.com/v1.0"
    SCOPES = ["https://graph.microsoft.com/.default"]

    # Only sync these file types
    _SYNC_EXTENSIONS = {".xlsx", ".xls", ".xlsm", ".csv"}

    def __init__(
        self,
        tenant_id: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        drive_id: str | None = None,
    ) -> None:
        self._tenant_id = tenant_id or settings.M365_TENANT_ID
        self._client_id = client_id or settings.M365_CLIENT_ID
        self._client_secret = client_secret or settings.M365_CLIENT_SECRET
        self._drive_id = drive_id or settings.M365_DRIVE_ID

        if not all([self._tenant_id, self._client_id, self._client_secret]):
            raise OneDriveAuthError(
                "M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET phải được cấu hình trong .env"
            )

        self._access_token: str | None = None
        self._http_client: httpx.AsyncClient | None = None

        # MSAL confidential client
        self._msal_app = msal.ConfidentialClientApplication(
            client_id=self._client_id,
            client_credential=self._client_secret,
            authority=f"https://login.microsoftonline.com/{self._tenant_id}",
        )

    # -- Context manager --------------------------------------------------

    async def __aenter__(self) -> OneDriveClient:
        self._http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=15.0),
            headers={"Accept": "application/json"},
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        self._access_token = None

    # -- Auth -------------------------------------------------------------

    async def get_token(self) -> str:
        """
        Acquire access token via MSAL client credentials flow.

        Returns cached token if still valid, otherwise acquires a new one.
        """
        # Try silent acquisition first (cached token)
        result = self._msal_app.acquire_token_silent(
            scopes=self.SCOPES,
            account=None,
        )

        if not result:
            logger.info("OneDrive: acquiring new access token")
            result = self._msal_app.acquire_token_for_client(scopes=self.SCOPES)

        if "access_token" not in result:
            error_desc = result.get("error_description", result.get("error", "Unknown error"))
            raise OneDriveAuthError(f"Không thể lấy access token: {error_desc}")

        self._access_token = result["access_token"]
        return self._access_token

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            raise OneDriveError(
                "Client chưa được khởi tạo. Sử dụng 'async with OneDriveClient() as client:'"
            )
        return self._http_client

    async def _auth_headers(self) -> dict[str, str]:
        """Get headers with fresh auth token."""
        token = await self.get_token()
        return {"Authorization": f"Bearer {token}"}

    # -- Delta Sync -------------------------------------------------------

    async def delta_sync(
        self,
        delta_token: str | None = None,
    ) -> tuple[list[dict[str, Any]], str]:
        """
        Perform a delta sync — retrieve only changed files since last sync.

        Args:
            delta_token: Previous delta token from the last sync.
                         None for initial full sync.

        Returns:
            Tuple of (changed_files, new_delta_token).
            Each file dict contains: id, name, size, lastModifiedDateTime,
            mimeType, downloadUrl, parentPath.
        """
        client = self._ensure_client()
        headers = await self._auth_headers()

        if not self._drive_id:
            raise OneDriveError("M365_DRIVE_ID chưa được cấu hình")

        # Build delta URL
        if delta_token:
            url = delta_token  # delta token IS the full URL
        else:
            url = f"{self.GRAPH_URL}/drives/{self._drive_id}/root/delta"

        logger.info(
            "OneDrive delta sync: %s",
            "initial" if not delta_token else "incremental",
        )

        changed_files: list[dict[str, Any]] = []
        new_delta_token: str = ""

        # Paginate through all results
        while url:
            try:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 410:
                    # Delta token expired — need full resync
                    logger.warning("OneDrive delta token hết hạn, cần resync toàn bộ")
                    return await self.delta_sync(delta_token=None)
                raise OneDriveAPIError(
                    f"Delta sync thất bại: HTTP {e.response.status_code}",
                    status_code=e.response.status_code,
                ) from e

            data = resp.json()

            for item in data.get("value", []):
                # Skip folders, only process files
                if "file" not in item:
                    continue

                # Skip deleted items
                if item.get("deleted"):
                    continue

                name: str = item.get("name", "")
                ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""

                # Only sync Excel files
                if ext not in self._SYNC_EXTENSIONS:
                    continue

                file_info: dict[str, Any] = {
                    "id": item["id"],
                    "name": name,
                    "size": item.get("size", 0),
                    "lastModifiedDateTime": item.get("lastModifiedDateTime"),
                    "mimeType": item.get("file", {}).get("mimeType", ""),
                    "downloadUrl": item.get("@microsoft.graph.downloadUrl", ""),
                    "parentPath": (
                        item.get("parentReference", {}).get("path", "")
                    ),
                    "webUrl": item.get("webUrl", ""),
                }
                changed_files.append(file_info)

            # Check for next page or delta link
            url = data.get("@odata.nextLink")
            if not url:
                new_delta_token = data.get("@odata.deltaLink", "")
                break

        logger.info(
            "OneDrive delta sync: %d files changed, token=%s",
            len(changed_files),
            "updated" if new_delta_token else "none",
        )

        return changed_files, new_delta_token

    # -- File Download ----------------------------------------------------

    async def download_file(self, file_id: str) -> bytes:
        """
        Download a specific file by its Graph API ID.

        Args:
            file_id: The Microsoft Graph file item ID.

        Returns:
            File content as bytes.
        """
        client = self._ensure_client()
        headers = await self._auth_headers()

        url = f"{self.GRAPH_URL}/drives/{self._drive_id}/items/{file_id}/content"

        logger.info("OneDrive download: file_id=%s", file_id)

        try:
            resp = await client.get(url, headers=headers, follow_redirects=True)
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise OneDriveAPIError(
                f"Tải file thất bại (id={file_id}): HTTP {e.response.status_code}",
                status_code=e.response.status_code,
            ) from e

        logger.info("OneDrive download complete: %d bytes", len(resp.content))
        return resp.content

    # -- Utility ----------------------------------------------------------

    async def get_drive_info(self) -> dict[str, Any]:
        """Get info about the configured drive (for health check / diagnostics)."""
        client = self._ensure_client()
        headers = await self._auth_headers()

        url = f"{self.GRAPH_URL}/drives/{self._drive_id}"

        try:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error("OneDrive drive info failed: %s", e)
            return {"error": str(e)}

    async def list_folder(self, folder_path: str = "/") -> list[dict[str, Any]]:
        """List items in a specific folder (for debugging)."""
        client = self._ensure_client()
        headers = await self._auth_headers()

        if folder_path == "/":
            url = f"{self.GRAPH_URL}/drives/{self._drive_id}/root/children"
        else:
            url = f"{self.GRAPH_URL}/drives/{self._drive_id}/root:/{folder_path}:/children"

        try:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return data.get("value", [])
        except httpx.HTTPStatusError as e:
            raise OneDriveAPIError(
                f"List folder thất bại: HTTP {e.response.status_code}",
                status_code=e.response.status_code,
            ) from e
