"""Pytest fixtures for Song Châu ERP tests."""
import pytest
import httpx

BASE = "http://localhost:8000"
API = f"{BASE}/api/v1"


@pytest.fixture(scope="session")
def auth_token():
    r = httpx.post(f"{API}/auth/login", json={
        "email": "thang@songchau.vn",
        "password": "SongChau@2026",
    }, timeout=10)
    if r.status_code == 200:
        return r.json()["access_token"]
    pytest.skip("API not available")


@pytest.fixture(scope="session")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture(scope="session")
def client():
    return httpx.Client(base_url=BASE, timeout=10)
