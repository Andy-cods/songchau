"""
Email sender via Microsoft Graph API (M08).

Uses MSAL client credentials flow to send email as the app.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
import msal

from app.core.config import settings

logger = logging.getLogger(__name__)

_token_cache: dict[str, Any] = {}


def _get_access_token() -> str:
    """Acquire an access token via MSAL client credentials."""
    app = msal.ConfidentialClientApplication(
        settings.M365_CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{settings.M365_TENANT_ID}",
        client_credential=settings.M365_CLIENT_SECRET,
    )
    result = app.acquire_token_for_client(
        scopes=["https://graph.microsoft.com/.default"]
    )
    if "access_token" not in result:
        raise RuntimeError(f"MSAL token acquisition failed: {result.get('error_description', result)}")
    return result["access_token"]


async def send_email(
    to_emails: list[str],
    subject: str,
    body_html: str,
    attachments: list[dict[str, Any]] | None = None,
    sender: str = "noreply@songchau.vn",
) -> bool:
    """Send email via Microsoft Graph API.

    Args:
        to_emails: List of recipient email addresses.
        subject: Email subject line.
        body_html: HTML body content.
        attachments: Optional list of {"name": str, "content_bytes": str (base64)}.
        sender: Sender email (must be authorized in Azure AD).

    Returns:
        True if sent successfully.
    """
    token = _get_access_token()

    message: dict[str, Any] = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": body_html},
            "toRecipients": [
                {"emailAddress": {"address": email}} for email in to_emails
            ],
        },
        "saveToSentItems": "false",
    }

    if attachments:
        message["message"]["attachments"] = [
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": att["name"],
                "contentBytes": att["content_bytes"],
            }
            for att in attachments
        ]

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"https://graph.microsoft.com/v1.0/users/{sender}/sendMail",
            json=message,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )

    if resp.status_code == 202:
        logger.info("Email sent to %s: %s", to_emails, subject)
        return True

    logger.error("Email send failed (%d): %s", resp.status_code, resp.text)
    return False
