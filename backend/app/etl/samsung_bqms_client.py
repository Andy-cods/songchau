"""
Samsung BQMS API Client — reverse-engineered integration with sec-bqms.com.

Handles the full login flow (session + MFA), PO list retrieval, and PDF download.
All HTTP calls are async via httpx with retry logic (tenacity).
"""

from __future__ import annotations

import hashlib
import logging
from datetime import date, datetime, timezone
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------

class BQMSError(Exception):
    """Base exception cho mọi lỗi liên quan đến Samsung BQMS."""


class BQMSAuthError(BQMSError):
    """Lỗi xác thực với Samsung BQMS portal."""


class BQMSAPIError(BQMSError):
    """Lỗi khi gọi API Samsung BQMS."""

    def __init__(self, message: str, status_code: int | None = None, response_body: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


# ---------------------------------------------------------------------------
# Samsung BQMS Client
# ---------------------------------------------------------------------------

class SamsungBQMSClient:
    """
    Async client cho Samsung BQMS vendor portal (sec-bqms.com).

    Usage::

        async with SamsungBQMSClient() as client:
            await client.login()
            po_list = await client.get_po_list(date(2026, 1, 1), date(2026, 3, 31))
    """

    BASE_URL: str = settings.BQMS_BASE_URL or "https://www.sec-bqms.com"

    # Endpoints
    _EP_LOGIN_PAGE = "/bqms/vendorPortal/anonymous/vendorLogin.do"
    _EP_AUTHENTICATE = "/bqms/vendorPortal/anonymous/loginCertificatePage.do"
    _EP_MFA_TOKEN = "/bqms/partnerLogin/anonymous/mfaCreateToken.do"
    _EP_AUTH_COMPLETE = "/bqms/partnerLogin/anonymous/authLoginPage.do"
    _EP_PO_LIST = "/bqms/mro/vendor/selectPOAcceptList.do"
    _EP_PO_PDF = "/bqms/mro/vendor/downloadPOPdf.do"

    # Session timeout (Samsung typically ~30 min)
    _SESSION_TTL_SECONDS = 25 * 60  # refresh at 25 min to be safe

    def __init__(
        self,
        username: str | None = None,
        password: str | None = None,
        base_url: str | None = None,
    ) -> None:
        if username and password:
            self._username, self._password = username, password
        else:
            from app.services.bqms_credentials import get_bqms_credentials
            res_user, res_pwd = get_bqms_credentials()
            self._username = username or res_user
            self._password = password or res_pwd
        self._base_url = base_url or self.BASE_URL

        if not self._username or not self._password:
            raise BQMSAuthError("BQMS_USERNAME và BQMS_PASSWORD phải được cấu hình trong .env")

        self._client: httpx.AsyncClient | None = None
        self._authenticated = False
        self._login_time: datetime | None = None

    # -- Context manager --------------------------------------------------

    async def __aenter__(self) -> SamsungBQMSClient:
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SongChau-ERP/1.0",
                "Accept": "application/json, text/html, */*",
                "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
            },
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None
        self._authenticated = False
        self._login_time = None

    # -- Internal helpers -------------------------------------------------

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise BQMSError("Client chưa được khởi tạo. Sử dụng 'async with SamsungBQMSClient() as client:'")
        return self._client

    def _session_expired(self) -> bool:
        if not self._authenticated or self._login_time is None:
            return True
        elapsed = (datetime.now(timezone.utc) - self._login_time).total_seconds()
        return elapsed > self._SESSION_TTL_SECONDS

    async def _ensure_authenticated(self) -> None:
        """Auto re-login if session expired."""
        if self._session_expired():
            logger.info("BQMS session hết hạn hoặc chưa đăng nhập, tiến hành đăng nhập lại")
            await self.login()

    @staticmethod
    def _hash_password(password: str) -> str:
        """Samsung uses SHA-256 hex digest for password hashing."""
        return hashlib.sha256(password.encode("utf-8")).hexdigest()

    # -- Login flow -------------------------------------------------------

    # KHÔNG retry login — Samsung block tài khoản nếu sai nhiều lần
    async def login(self) -> None:
        """
        4-step login flow for Samsung BQMS vendor portal.

        Step 1: GET login page → obtain JSESSIONID cookie
        Step 2: POST credentials (loginId + SHA256 password hash)
        Step 3: POST MFA token creation
        Step 4: POST auth completion
        """
        client = self._ensure_client()
        self._authenticated = False
        self._login_time = None

        logger.info("BQMS đăng nhập: bắt đầu (user=%s)", self._username)

        # Step 1: Get session cookie
        try:
            resp1 = await client.get(self._EP_LOGIN_PAGE)
            resp1.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise BQMSAuthError(f"Không thể truy cập trang đăng nhập BQMS: HTTP {e.response.status_code}") from e

        jsessionid = client.cookies.get("JSESSIONID")
        if not jsessionid:
            logger.warning("BQMS login step 1: không nhận được JSESSIONID, tiếp tục thử")

        logger.debug("BQMS login step 1 OK: JSESSIONID=%s", jsessionid and jsessionid[:8])

        # Step 2: Authenticate with credentials
        password_hash = self._hash_password(self._password)
        auth_data = {
            "loginId": self._username,
            "loginPasswordHash": password_hash,
            "languageSelection": "en",
        }

        try:
            resp2 = await client.post(
                self._EP_AUTHENTICATE,
                data=auth_data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp2.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise BQMSAuthError(
                f"Xác thực BQMS thất bại: HTTP {e.response.status_code}"
            ) from e

        # Parse step 2 response
        try:
            resp2_data = resp2.json()
        except Exception:
            resp2_data = {}

        result = resp2_data.get("result", "")
        if result != "SUCCESS" or "loginFail" in resp2.text:
            raise BQMSAuthError(
                f"Sai tên đăng nhập hoặc mật khẩu BQMS (result={result})"
            )

        user_id = resp2_data.get("userId", self._username)
        cert_code = resp2_data.get("certCode", "")
        cert_name = resp2_data.get("certName", "")

        logger.debug("BQMS login step 2 OK: userId=%s, certCode=%s", user_id, cert_code[:8] if cert_code else "?")

        # Step 3: MFA token creation (may return 404 — that's OK)
        try:
            resp3 = await client.post(
                self._EP_MFA_TOKEN,
                data={"userId": user_id, "passwordHash": password_hash},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            logger.debug("BQMS login step 3: HTTP %d", resp3.status_code)
        except Exception as e:
            logger.debug("BQMS login step 3: non-fatal error: %s", e)

        # Step 4: Complete authentication
        cert_form = {
            "userId": user_id,
            "certId": cert_code,
            "certName": cert_name,
            "passwordHash": password_hash,
            "certPassword": "",
            "signsrc": "",
            "signdata": "",
            "signcert": "",
        }
        try:
            resp4 = await client.post(
                self._EP_AUTH_COMPLETE,
                data=cert_form,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            logger.debug("BQMS login step 4: HTTP %d", resp4.status_code)
        except httpx.HTTPStatusError as e:
            raise BQMSAuthError(
                f"Hoàn tất xác thực thất bại: HTTP {e.response.status_code}"
            ) from e

        self._authenticated = True
        self._login_time = datetime.now(timezone.utc)
        logger.info("BQMS đăng nhập thành công (user=%s)", self._username)

    # -- PO List ----------------------------------------------------------

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.TransportError, httpx.TimeoutException)),
        reraise=True,
    )
    async def get_po_list(
        self,
        date_from: date,
        date_to: date,
        status_codes: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Fetch PO list from Samsung BQMS portal.

        Args:
            date_from: Start date for PO search.
            date_to: End date for PO search.
            status_codes: PO status filter (default: ["N"] = new/unconfirmed).

        Returns:
            List of PO dicts with keys matching Samsung API response fields.
        """
        await self._ensure_authenticated()
        client = self._ensure_client()

        if status_codes is None:
            status_codes = ["N"]

        logger.info(
            "BQMS lấy danh sách PO: %s → %s (status=%s)",
            date_from.isoformat(),
            date_to.isoformat(),
            status_codes,
        )

        # Navigate to PO page first to establish session context
        try:
            await client.get(
                "/bqms/mro/forward/vendor/vendorPoConfirm.do"
                "?target=vendor&_menuId=AZknkggsAB8V-Qhq&_menuF=true"
            )
        except Exception:
            pass  # non-fatal

        # Samsung BQMS PO list payload (reverse-engineered from portal)
        payload = {
            "srchStDate": date_from.strftime("%Y%m%d"),
            "srchEdDate": date_to.strftime("%Y%m%d"),
            "srchPoNo": None,
            "srchCompanyCode": None,
            "srchStatusCode": status_codes,
            "mroPageVO": {
                "pageInfos": [{
                    "id": "page1",
                    "pageIndex": 1,
                    "location": ".paginate",
                    "pageScript": "search()",
                    "pageSize": "9999",
                    "originalPageSize": None,
                }]
            },
        }

        po_headers = {
            "Content-Type": "application/json; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{self._base_url}/bqms/mro/forward/vendor/vendorPoConfirm.do",
            "Origin": self._base_url,
        }

        try:
            resp = await client.post(
                self._EP_PO_LIST,
                json=payload,
                headers=po_headers,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise BQMSAPIError(
                f"Lấy danh sách PO thất bại: HTTP {e.response.status_code}",
                status_code=e.response.status_code,
                response_body=e.response.text[:500],
            ) from e

        data = resp.json()

        # Samsung response: {"poList": [...], "page1_result": {"totalCnt": "N"}}
        if isinstance(data, dict):
            records = (
                data.get("poList")
                or data.get("result")
                or data.get("list")
                or data.get("data")
                or []
            )
            total = data.get("page1_result", {}).get("totalCnt", len(records))
            logger.info("BQMS PO list: totalCnt=%s, records=%d", total, len(records))
        elif isinstance(data, list):
            records = data
        else:
            logger.warning("BQMS PO list: unexpected response type %s", type(data).__name__)
            records = []

        logger.info("BQMS PO list: nhận được %d records", len(records))
        return records

    # -- PDF Download -----------------------------------------------------

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.TransportError, httpx.TimeoutException)),
        reraise=True,
    )
    async def download_pdf(self, po_no: str, secure_key: str) -> bytes:
        """
        Download PDF for a specific PO from Samsung portal.

        Args:
            po_no: Purchase order number.
            secure_key: Security key from the PO record (required for download).

        Returns:
            PDF file content as bytes.

        Raises:
            BQMSAPIError: If download fails or returns non-PDF content.
        """
        await self._ensure_authenticated()
        client = self._ensure_client()

        logger.info("BQMS download PDF: PO=%s", po_no)

        try:
            resp = await client.post(
                self._EP_PO_PDF,
                data={"poNo": po_no, "secureKey": secure_key},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise BQMSAPIError(
                f"Tải PDF thất bại cho PO {po_no}: HTTP {e.response.status_code}",
                status_code=e.response.status_code,
            ) from e

        content_type = resp.headers.get("content-type", "")
        if "pdf" not in content_type and len(resp.content) < 1024:
            raise BQMSAPIError(
                f"Response không phải PDF cho PO {po_no} (content-type={content_type})",
                response_body=resp.text[:200],
            )

        logger.info("BQMS PDF downloaded: PO=%s, size=%d bytes", po_no, len(resp.content))
        return resp.content

    # -- Utility ----------------------------------------------------------

    async def health_check(self) -> bool:
        """Check if BQMS portal is reachable."""
        client = self._ensure_client()
        try:
            resp = await client.get(self._EP_LOGIN_PAGE, timeout=10.0)
            return resp.status_code == 200
        except Exception:
            return False
