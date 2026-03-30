"""Integration tests — run against live API on localhost:8000."""
import pytest
import httpx

BASE = "http://localhost:8000"
API = f"{BASE}/api/v1"


@pytest.fixture(scope="module")
def token():
    r = httpx.post(f"{API}/auth/login", json={
        "email": "thang@songchau.vn",
        "password": "SongChau@2026",
    }, timeout=10)
    if r.status_code != 200:
        pytest.skip("API not reachable")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


def test_health():
    r = httpx.get(f"{BASE}/api/health", timeout=5)
    assert r.status_code == 200
    assert r.json()["status"] in ("healthy", "degraded")


def test_login_success():
    r = httpx.post(f"{API}/auth/login", json={
        "email": "thang@songchau.vn",
        "password": "SongChau@2026",
    }, timeout=10)
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_login_wrong_password():
    r = httpx.post(f"{API}/auth/login", json={
        "email": "thang@songchau.vn",
        "password": "WrongPass",
    }, timeout=10)
    assert r.status_code == 401


def test_me(h):
    r = httpx.get(f"{API}/auth/me", headers=h, timeout=5)
    assert r.status_code == 200
    assert r.json()["email"] == "thang@songchau.vn"


def test_workflows_list(h):
    r = httpx.get(f"{API}/workflows", headers=h, timeout=5)
    assert r.status_code == 200


def test_suppliers_list(h):
    r = httpx.get(f"{API}/suppliers", headers=h, timeout=5)
    assert r.status_code == 200


def test_purchase_orders_list(h):
    r = httpx.get(f"{API}/purchase-orders", headers=h, timeout=5)
    assert r.status_code == 200


def test_inventory_list(h):
    r = httpx.get(f"{API}/inventory", headers=h, timeout=5)
    assert r.status_code == 200


def test_bqms_kpi(h):
    r = httpx.get(f"{API}/bqms/kpi", headers=h, timeout=5)
    assert r.status_code == 200


def test_notifications_list(h):
    r = httpx.get(f"{API}/notifications", headers=h, timeout=5)
    assert r.status_code == 200


def test_dashboard_kpis(h):
    r = httpx.get(f"{API}/dashboard/kpis", headers=h, timeout=5)
    assert r.status_code == 200


def test_sales_orders_list(h):
    r = httpx.get(f"{API}/sales-orders", headers=h, timeout=5)
    assert r.status_code == 200


def test_finance_summary(h):
    r = httpx.get(f"{API}/finance/summary", headers=h, timeout=5)
    assert r.status_code == 200


def test_xnk_list(h):
    r = httpx.get(f"{API}/xnk", headers=h, timeout=5)
    assert r.status_code == 200


def test_audit_list(h):
    r = httpx.get(f"{API}/audit", headers=h, timeout=5)
    assert r.status_code == 200


def test_api_docs():
    r = httpx.get(f"{BASE}/api/docs", timeout=5)
    assert r.status_code == 200


def test_unauthorized_without_token():
    r = httpx.get(f"{API}/workflows", timeout=5)
    assert r.status_code in (401, 403)
