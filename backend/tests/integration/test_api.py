"""Integration tests — run IN-PROCESS against the ASGI app (no live server).

W1-01 converted these off the old "POST to http://localhost:8000, else
pytest.skip()" pattern (which was a safe fake — green because it never ran).

They now use the harness `client` + seeded-role fixtures from conftest.py. They
hit many tables (workflows, suppliers, finance, ...), so they need the FULL prod
schema snapshot at tests/_schema_snapshot.sql. When that file is absent the
whole module SKIPS via the autouse guard below — an honest "schema not loaded",
not a fake "server not up".

To enable: have the orchestrator run `pg_dump --schema-only` from prod into
backend/tests/_schema_snapshot.sql, then re-run. The login tests below only
need the `users` table, so they also work; the list-endpoint tests exercise
real read paths against an empty-but-real schema (expect 200 + empty lists).
"""

import pytest

pytestmark = pytest.mark.integration

API = "/api/v1"


@pytest.fixture(autouse=True)
def _require_full_schema(schema_info):
    if not schema_info["full_schema"]:
        pytest.skip(
            "requires full prod schema snapshot at tests/_schema_snapshot.sql "
            "(pg_dump --schema-only). Loaded schema: " + schema_info["source"]
        )


# ─── auth (needs only the users table) ──────────────────────────────────────
async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] in ("healthy", "degraded")


async def test_login_success(client, users_factory):
    u = await users_factory("admin", email="login.ok@test.songchau.vn",
                            password="SongChau@2026")
    r = await client.post(f"{API}/auth/login",
                          json={"email": u["email"], "password": "SongChau@2026"})
    assert r.status_code == 200
    assert "access_token" in r.json()


async def test_login_wrong_password(client, users_factory):
    u = await users_factory("admin", email="login.bad@test.songchau.vn",
                            password="SongChau@2026")
    r = await client.post(f"{API}/auth/login",
                          json={"email": u["email"], "password": "WrongPass"})
    assert r.status_code == 401


async def test_me(client, admin):
    r = await client.get(f"{API}/auth/me", headers=admin["headers"])
    assert r.status_code == 200
    assert r.json()["email"] == admin["email"]


# ─── authorized read endpoints (need the full schema) ───────────────────────
async def test_workflows_list(client, admin):
    r = await client.get(f"{API}/workflows", headers=admin["headers"])
    assert r.status_code == 200


async def test_suppliers_list(client, admin):
    r = await client.get(f"{API}/suppliers", headers=admin["headers"])
    assert r.status_code == 200


async def test_purchase_orders_list(client, admin):
    r = await client.get(f"{API}/purchase-orders", headers=admin["headers"])
    assert r.status_code == 200


async def test_inventory_list(client, admin):
    r = await client.get(f"{API}/inventory", headers=admin["headers"])
    assert r.status_code == 200


async def test_bqms_kpi(client, admin):
    r = await client.get(f"{API}/bqms/kpi", headers=admin["headers"])
    assert r.status_code == 200


async def test_notifications_list(client, admin):
    r = await client.get(f"{API}/notifications", headers=admin["headers"])
    assert r.status_code == 200


async def test_dashboard_kpis(client, admin):
    r = await client.get(f"{API}/dashboard/kpis", headers=admin["headers"])
    assert r.status_code == 200


async def test_sales_orders_route_removed(client, admin):
    # W2-10 (Thang 2026-07-03): router /sales-orders XOÁ (0 caller). Route giờ 404.
    # (Bảng sales_orders vẫn dùng bởi revenue_chain/crm/kpi — chỉ router bị bỏ.)
    r = await client.get(f"{API}/sales-orders", headers=admin["headers"])
    assert r.status_code == 404


async def test_finance_summary(client, admin):
    r = await client.get(f"{API}/finance/summary", headers=admin["headers"])
    assert r.status_code == 200


async def test_xnk_list(client, admin):
    r = await client.get(f"{API}/xnk", headers=admin["headers"])
    assert r.status_code == 200


async def test_audit_list(client, admin):
    r = await client.get(f"{API}/audit", headers=admin["headers"])
    assert r.status_code == 200


async def test_api_docs(client):
    r = await client.get("/api/docs")
    assert r.status_code == 200


async def test_unauthorized_without_token(client):
    r = await client.get(f"{API}/workflows")
    assert r.status_code in (401, 403)
