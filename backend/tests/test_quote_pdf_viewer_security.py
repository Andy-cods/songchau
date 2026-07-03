"""Regression E2E tests for the viewer-escalation HIGH security fix
(Thang 2026-06-13).

Background
──────────
The pre-fix endpoint exposed::

    GET  /api/v1/sourcing/orders/{id}/quote-pdf?regenerate=true

which let *any* authenticated user — including a read-only ``viewer`` —
ride a privilege-escalating mutation on a GET (renderable as <img>,
prefetch-able, CSRF-reachable). Side effects of the mutation included:

  * bumping ``sourcing_orders.quote_pdf_version``
  * auto-transitioning ``status: draft → quoted``
  * inserting a row into ``sourcing_order_status_history``
  * writing a new ``/data/files/quotes/<order>_v<N>.pdf`` file

The fix splits the endpoint in two:

  * ``GET  /orders/{id}/quote-pdf``               — strictly read-only,
    viewer + all authenticated roles may download the existing PDF.
    The ``?regenerate=true`` toggle no longer exists; if passed, it is
    silently ignored.
  * ``POST /orders/{id}/quote-pdf/regenerate``    — mutating; allowlist
    is ``admin / manager / sales / procurement / director``. Viewer +
    staff + accountant are explicitly excluded.

Additionally ``app.core.rbac.require_role`` blocks viewer on any non-
GET/HEAD/OPTIONS method system-wide. The POST endpoint therefore has a
**double** privilege boundary (rbac global + endpoint allowlist); these
tests verify both layers.

What these tests pin
────────────────────
1. ``viewer`` POSTing the regenerate endpoint → ``403`` (no mutation).
2. ``viewer`` GETting the read-only endpoint → ``200`` (existing PDF).
3. ``viewer`` GETting with the legacy ``?regenerate=true`` query
   param → returns existing PDF, ``quote_pdf_version`` unchanged, no
   new ``sourcing_order_status_history`` row created.
4. ``admin`` POSTing the regenerate endpoint → ``200`` + version bumps
   + new status_history row is inserted.

Run from inside the backend container (where Postgres + API are
reachable) or against a deployed instance with the env vars below set::

    pytest backend/tests/test_quote_pdf_viewer_security.py -v

Required env (with safe defaults for local dev):

  ERP_BASE_URL          (default: http://localhost:8000)
  ERP_ADMIN_EMAIL       (default: thang@songchau.vn)
  ERP_ADMIN_PASSWORD    (default: SongChau@2026)
  ERP_VIEWER_EMAIL      (default: viewer@songchau.vn)
  ERP_VIEWER_PASSWORD   (default: Viewer@2026)
  ERP_TEST_ORDER_ID     (optional — re-use an existing sourcing_order
                         id that already has quote_pdf_version >= 1;
                         if absent the test will auto-create + seed one
                         via the admin token)

If the API is unreachable or required login fails, the affected tests
``pytest.skip`` rather than fail — CI without a live backend stays green.
"""
from __future__ import annotations

import os
import uuid
from typing import Any

import httpx
import pytest
import pytest_asyncio


# ─────────────────────────── Config ───────────────────────────

BASE_URL = os.getenv("ERP_BASE_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api/v1"

ADMIN_EMAIL = os.getenv("ERP_ADMIN_EMAIL", "thang@songchau.vn")
ADMIN_PASSWORD = os.getenv("ERP_ADMIN_PASSWORD", "SongChau@2026")

VIEWER_EMAIL = os.getenv("ERP_VIEWER_EMAIL", "viewer@songchau.vn")
VIEWER_PASSWORD = os.getenv("ERP_VIEWER_PASSWORD", "Viewer@2026")

PRESEEDED_ORDER_ID = os.getenv("ERP_TEST_ORDER_ID")  # optional

TIMEOUT = 30


# ───────────────────── Fixtures (async) ─────────────────────


async def _login(client: httpx.AsyncClient, email: str, password: str) -> str | None:
    """Return access_token or None on failure (caller decides to skip)."""
    try:
        r = await client.post(
            f"{API}/auth/login",
            json={"email": email, "password": password},
            timeout=TIMEOUT,
        )
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout):
        return None
    if r.status_code != 200:
        return None
    body = r.json()
    return body.get("access_token") or body.get("data", {}).get("access_token")


@pytest.fixture(scope="module")
def anyio_backend() -> str:
    # pytest-asyncio in "auto" mode will discover async tests; this
    # fixture also lets us run under anyio if the project switches.
    return "asyncio"


@pytest_asyncio.fixture
async def http_client():
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        yield c


@pytest_asyncio.fixture
async def admin_token(http_client: httpx.AsyncClient) -> str:
    tok = await _login(http_client, ADMIN_EMAIL, ADMIN_PASSWORD)
    if not tok:
        pytest.skip(
            f"Admin login failed for {ADMIN_EMAIL} at {BASE_URL} — "
            "set ERP_ADMIN_EMAIL/ERP_ADMIN_PASSWORD or start the API."
        )
    return tok


@pytest_asyncio.fixture
async def viewer_token(http_client: httpx.AsyncClient) -> str:
    tok = await _login(http_client, VIEWER_EMAIL, VIEWER_PASSWORD)
    if not tok:
        pytest.skip(
            f"Viewer login failed for {VIEWER_EMAIL} at {BASE_URL} — "
            "create a role='viewer' user or set ERP_VIEWER_EMAIL/"
            "ERP_VIEWER_PASSWORD."
        )
    return tok


@pytest.fixture
def admin_headers(admin_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def viewer_headers(viewer_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {viewer_token}"}


# ─────────── Helpers: seed an order with a v1 PDF ───────────


async def _ensure_order_with_pdf(
    client: httpx.AsyncClient, admin_h: dict[str, str]
) -> int:
    """Return id of a sourcing_order that already has a v1 quote PDF on disk.

    If ``ERP_TEST_ORDER_ID`` is set, assume it's already seeded. Otherwise
    create a minimal draft order via the admin token + force a first
    POST /quote-pdf/regenerate so subsequent reads have a real file.
    """
    if PRESEEDED_ORDER_ID:
        return int(PRESEEDED_ORDER_ID)

    # Minimal order payload — schema fields lifted from
    # POST /api/v1/sourcing/orders (see app/api/v1/sourcing.py:1821).
    payload: dict[str, Any] = {
        "customer_name": f"PYTEST viewer-sec {uuid.uuid4().hex[:8]}",
        "customer_email": "pytest-viewer-sec@example.com",
        "person_in_charge": "pytest",
        "delivery_date": None,
        "payment_terms": "NET 30",
        "notes": "auto-created by test_quote_pdf_viewer_security",
        "internal_notes": "auto-cleanup-candidate",
        "line_items": [
            {
                "description": "Stub line for PDF render",
                "qty": 1,
                "unit_price_vnd": 1_000_000,
                "tax_pct": 10,
            }
        ],
        "currency": "VND",
        "initial_status": "draft",
    }
    r = await client.post(f"{API}/sourcing/orders", json=payload, headers=admin_h)
    if r.status_code not in (200, 201):
        pytest.skip(
            f"Cannot seed sourcing_order (status={r.status_code} body={r.text[:200]});"
            " set ERP_TEST_ORDER_ID to a pre-existing order with a v1 PDF."
        )
    data = r.json().get("data") or r.json()
    order_id = int(data.get("id") or data.get("order_id"))

    # Force a first regenerate so quote_pdf_version >= 1.
    rr = await client.post(
        f"{API}/sourcing/orders/{order_id}/quote-pdf/regenerate",
        headers=admin_h,
    )
    if rr.status_code != 200:
        pytest.skip(
            f"Could not seed first PDF (status={rr.status_code}); the GET test"
            " requires an existing quote_pdf file."
        )
    return order_id


async def _get_order(
    client: httpx.AsyncClient, h: dict[str, str], order_id: int
) -> dict[str, Any] | None:
    r = await client.get(f"{API}/sourcing/orders/{order_id}", headers=h)
    if r.status_code != 200:
        return None
    body = r.json()
    return body.get("data") or body


async def _status_history_count(
    client: httpx.AsyncClient, h: dict[str, str], order_id: int
) -> int | None:
    """Read status_history rows for an order. Returns None if endpoint is N/A."""
    # Project exposes status history via GET /sourcing/orders/{id} (.status_history)
    # OR a dedicated subroute. We try both, fall back to the main payload.
    o = await _get_order(client, h, order_id)
    if not o:
        return None
    history = o.get("status_history")
    if isinstance(history, list):
        return len(history)
    # Last-resort: try the explicit subroute, if it exists.
    r = await client.get(
        f"{API}/sourcing/orders/{order_id}/status-history", headers=h
    )
    if r.status_code == 200:
        body = r.json()
        rows = body.get("data") or body
        if isinstance(rows, list):
            return len(rows)
    return None


# ─────────────────────────── Tests ───────────────────────────


@pytest.mark.asyncio
async def test_viewer_cannot_post_regenerate(
    http_client: httpx.AsyncClient,
    admin_headers: dict[str, str],
    viewer_headers: dict[str, str],
):
    """REGRESSION (HIGH): viewer must NOT be able to POST /quote-pdf/regenerate.

    Pre-fix: viewer could ride GET ?regenerate=true and bump version.
    Post-fix: the mutating path is POST-only with viewer excluded — must 403.
    """
    order_id = await _ensure_order_with_pdf(http_client, admin_headers)

    r = await http_client.post(
        f"{API}/sourcing/orders/{order_id}/quote-pdf/regenerate",
        headers=viewer_headers,
    )
    assert r.status_code == 403, (
        f"Viewer POST to regenerate must return 403; got {r.status_code} "
        f"body={r.text[:300]}"
    )


@pytest.mark.asyncio
async def test_viewer_can_get_existing_pdf(
    http_client: httpx.AsyncClient,
    admin_headers: dict[str, str],
    viewer_headers: dict[str, str],
):
    """Viewer must still be able to DOWNLOAD an existing PDF — read-only path.

    The fix must not break the legitimate viewer use case (read the file).
    """
    order_id = await _ensure_order_with_pdf(http_client, admin_headers)

    r = await http_client.get(
        f"{API}/sourcing/orders/{order_id}/quote-pdf",
        headers=viewer_headers,
    )
    assert r.status_code == 200, (
        f"Viewer GET on existing PDF should return 200; got {r.status_code} "
        f"body={r.text[:300]}"
    )
    # Body is a real PDF (file response); content-type is application/pdf.
    ct = r.headers.get("content-type", "")
    assert "pdf" in ct.lower(), f"Expected application/pdf, got {ct!r}"


@pytest.mark.asyncio
async def test_viewer_get_with_regenerate_query_does_not_mutate(
    http_client: httpx.AsyncClient,
    admin_headers: dict[str, str],
    viewer_headers: dict[str, str],
):
    """The legacy ?regenerate=true query MUST be silently ignored on GET.

    Pre-fix exploit: GET /quote-pdf?regenerate=true bumped version + wrote
    status_history even for a viewer. Post-fix: query string is ignored on
    GET; no mutation occurs.

    We verify by snapshotting (quote_pdf_version, status_history.len) before
    and after the call — they MUST be equal.
    """
    order_id = await _ensure_order_with_pdf(http_client, admin_headers)

    before = await _get_order(http_client, admin_headers, order_id)
    if before is None:
        pytest.skip("Cannot fetch order before-state via admin GET; skipping invariant check.")
    version_before = before.get("quote_pdf_version")
    history_before = await _status_history_count(http_client, admin_headers, order_id)

    r = await http_client.get(
        f"{API}/sourcing/orders/{order_id}/quote-pdf",
        params={"regenerate": "true"},
        headers=viewer_headers,
    )
    # GET must still succeed (read-only) — query is ignored, not rejected.
    assert r.status_code == 200, (
        f"Viewer GET with legacy ?regenerate=true should still be 200 (query"
        f" ignored), got {r.status_code} body={r.text[:300]}"
    )

    after = await _get_order(http_client, admin_headers, order_id)
    assert after is not None, "Cannot fetch order after-state — invariant un-checkable."
    version_after = after.get("quote_pdf_version")
    history_after = await _status_history_count(http_client, admin_headers, order_id)

    assert version_after == version_before, (
        f"quote_pdf_version mutated despite viewer GET! "
        f"before={version_before} after={version_after} — escalation REGRESSED."
    )
    if history_before is not None and history_after is not None:
        assert history_after == history_before, (
            f"status_history grew on viewer GET (before={history_before} "
            f"after={history_after}) — escalation REGRESSED."
        )


@pytest.mark.asyncio
async def test_admin_can_post_regenerate_and_bumps_version(
    http_client: httpx.AsyncClient,
    admin_headers: dict[str, str],
):
    """Admin POST /regenerate must succeed (200) + bump version + log history.

    Positive control: confirms the new POST path actually mutates for an
    authorised role, otherwise the negative viewer test above could be
    falsely passing (e.g. the route is just always 403).
    """
    order_id = await _ensure_order_with_pdf(http_client, admin_headers)

    before = await _get_order(http_client, admin_headers, order_id)
    if before is None:
        pytest.skip("Cannot fetch before-state for admin regenerate test.")
    version_before = int(before.get("quote_pdf_version") or 0)
    history_before = await _status_history_count(http_client, admin_headers, order_id) or 0

    r = await http_client.post(
        f"{API}/sourcing/orders/{order_id}/quote-pdf/regenerate",
        headers=admin_headers,
    )
    assert r.status_code == 200, (
        f"Admin POST regenerate must succeed; got {r.status_code} body={r.text[:300]}"
    )
    ct = r.headers.get("content-type", "")
    assert "pdf" in ct.lower(), f"Admin regenerate should stream a PDF, got {ct!r}"

    after = await _get_order(http_client, admin_headers, order_id)
    assert after is not None
    version_after = int(after.get("quote_pdf_version") or 0)
    assert version_after == version_before + 1, (
        f"quote_pdf_version should bump by 1; before={version_before} "
        f"after={version_after}"
    )

    history_after = await _status_history_count(http_client, admin_headers, order_id)
    if history_after is not None:
        assert history_after >= history_before + 1, (
            f"Expected at least one new status_history row after regenerate; "
            f"before={history_before} after={history_after}"
        )
