"""Smoke tests that PROVE the W1-01 harness works with no live server.

Every test here drives the real FastAPI app in-process (httpx ASGITransport)
against the throwaway Postgres from docker-compose.test.yml. They run under the
minimal bootstrap schema (users + role_enum) — no prod snapshot required — so
they are always green once the test DB is up.

What each test pins (with an EXPLICIT expected status):
  1. GET /api/health                         -> 200            (no auth, ASGI works)
  2. GET /api/v1/users without a token       -> 401            (auth is enforced)
  3. seed admin  -> GET /api/v1/users        -> 200 + sees self (valid JWT + RBAC pass)
  4. seed staff  -> GET /api/v1/users        -> 403            (role gate rejects non-admin)
  5. seed viewer -> GET /api/v1/users        -> 200            (viewer read-only bypass)
  6. seed viewer -> GET internal-price ep    -> 403            (W0-21 allow_viewer=False lock)
  7. seed admin  -> GET internal-price ep    -> not 401/403    (admin passes the price gate)
"""

import pytest

pytestmark = pytest.mark.smoke

USERS = "/api/v1/users"
# price_lookup.search_global — require_role(..., allow_viewer=False): the W0-21
# "internal price" lock. Mounted at /api/v1/price-lookup (see api/v1/__init__.py).
INTERNAL_PRICE = "/api/v1/price-lookup/search/global"


async def test_health_ok(client):
    r = await client.get("/api/health")
    assert r.status_code == 200, r.text
    body = r.json()
    # Redis is not initialized in-process, so overall may be "degraded" — that
    # is expected and still a 200. DB (SELECT 1) goes through the get_db
    # override and MUST report ok.
    assert body["status"] in ("healthy", "degraded")
    assert body["database"]["status"] == "ok"


async def test_users_requires_auth(client):
    r = await client.get(USERS)
    assert r.status_code == 401, r.text


async def test_admin_can_list_users(client, admin):
    r = await client.get(USERS, headers=admin["headers"])
    assert r.status_code == 200, r.text
    emails = [u["email"] for u in r.json()["data"]]
    # The seeded admin (created in this test's transaction) must be visible.
    assert admin["email"] in emails


async def test_staff_forbidden_on_admin_endpoint(client, staff):
    r = await client.get(USERS, headers=staff["headers"])
    assert r.status_code == 403, r.text


async def test_viewer_read_only_bypass(client, viewer):
    # /users is require_role("admin") with default allow_viewer=True, so a
    # viewer GET is allowed (read-only bypass across the system).
    r = await client.get(USERS, headers=viewer["headers"])
    assert r.status_code == 200, r.text


async def test_viewer_blocked_on_internal_price(client, viewer):
    # W0-21 lock: internal-price endpoints pass allow_viewer=False, so a viewer
    # is treated as a normal role, is not in the allowed list, and gets 403 —
    # raised in require_role BEFORE any table is touched.
    r = await client.get(INTERNAL_PRICE, params={"q": "ab"}, headers=viewer["headers"])
    assert r.status_code == 403, r.text


async def test_admin_passes_internal_price_gate(client, admin, schema_info):
    # Admin is in the allowed role list, so the RBAC gate lets the request
    # through (that gate is the thing under test). With the full schema the
    # handler returns 200; under the bootstrap-only schema the bqms_rfq table
    # is absent so the handler 500s AFTER passing the gate. Either way the
    # authorization decision is "allowed" (not 401/403).
    r = await client.get(INTERNAL_PRICE, params={"q": "ab"}, headers=admin["headers"])
    assert r.status_code not in (401, 403), r.text
    if schema_info["full_schema"]:
        assert r.status_code == 200, r.text
