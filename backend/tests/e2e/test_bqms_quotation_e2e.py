"""
E2E test for BQMS quotation flow — Song Chau ERP.

Covers (per Thang's spec 2026-05-07):
  1. Login + obtain JWT
  2. RFQ history listing — pagination + filter
  3. Parse BC BQMS Excel → preview items
  4. Generate quotation TM (Thương mại) → check files exist
  5. Generate quotation GC (Gia công) → check files exist
  6. PATCH a quotation → re-generate
  7. DELETE quotation (soft) + restore + delete (hard)
  8. Cleanup: any remaining test rows + files

Run from backend container OR locally with backend reachable:
  pytest backend/tests/e2e/test_bqms_quotation_e2e.py -v

Required env vars:
  ERP_BASE_URL          (default: http://localhost:8000)
  ERP_TEST_EMAIL        (default: thang@songchau.vn)
  ERP_TEST_PASSWORD     (default: SongChau@2026)
  ERP_TEST_RFQ_PREFIX   (default: TEST-E2E-) — used to mark+cleanup test rows
  ERP_TEST_BC_FILE      (optional path to a real BC BQMS Excel; if absent, a
                         minimal in-memory Excel is generated on the fly)

Tests are tagged with `@pytest.mark.e2e` so they can be skipped in CI by default
unless the test environment exposes a live backend.
"""
from __future__ import annotations

import io
import os
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest

# ─── Config ─────────────────────────────────────────────────────────

BASE_URL    = os.getenv("ERP_BASE_URL", "http://localhost:8000").rstrip("/")
EMAIL       = os.getenv("ERP_TEST_EMAIL",    "thang@songchau.vn")
PASSWORD    = os.getenv("ERP_TEST_PASSWORD", "SongChau@2026")
RFQ_PREFIX  = os.getenv("ERP_TEST_RFQ_PREFIX", "TEST-E2E-")
BC_FILE     = os.getenv("ERP_TEST_BC_FILE")  # may be None
TIMEOUT     = 60  # seconds


pytestmark = pytest.mark.e2e


# ─── Fixtures ───────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def http_client() -> httpx.Client:
    """A reusable HTTP client with longer timeout for file generation calls."""
    with httpx.Client(base_url=BASE_URL, timeout=TIMEOUT) as c:
        yield c


@pytest.fixture(scope="session")
def auth_token(http_client: httpx.Client) -> str:
    """Log in once, reuse the token across tests."""
    r = http_client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    payload = r.json()
    token = payload.get("access_token") or payload.get("data", {}).get("access_token")
    assert token, f"No access_token in login response: {payload}"
    return token


@pytest.fixture(scope="session")
def auth_headers(auth_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture(scope="session")
def test_rfq_no() -> str:
    """A unique RFQ number so cleanup can target it."""
    return f"{RFQ_PREFIX}{int(time.time())}-{uuid.uuid4().hex[:6].upper()}"


@pytest.fixture(scope="session")
def created_quotation_ids() -> list[int]:
    """Track quotation IDs created during the run for end-of-session cleanup."""
    return []


# ─── Helpers ────────────────────────────────────────────────────────

def _make_minimal_bc_bqms_excel() -> bytes:
    """Build a minimal BC BQMS-shaped Excel in memory for parsing tests.

    Real BC BQMS files have a specific layout the parser knows about; this
    mimics the columns the parser expects in the simplest legal form.
    """
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "BC BQMS"
    headers = [
        "STT", "RFQ No", "BQMS Code", "Spec", "Maker",
        "Đơn vị", "Số lượng", "Hạn báo giá", "Loại hàng", "Ghi chú",
    ]
    ws.append(headers)
    rows = [
        (1, "RFQ-TEST-001", "Z9999999-000001",
         "FINGER RF CAL,PB108,TRANG,L23.4xW8.3xH15MM,ESD 10^5-10^7Ohm",
         "AMA", "EA", 100, "31/05/2026", "TM", "test item TM"),
        (2, "RFQ-TEST-001", "Z9999999-000002",
         "BOOTPLATE RF,PB108,TRANG,L136xW80xH5MM,ESD 10^5-10^7Ohm",
         "AMA", "EA", 50, "31/05/2026", "GC", "test item GC"),
    ]
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


def _bc_bqms_payload() -> tuple[str, bytes, str]:
    """Return (filename, bytes, content_type) for /quotations/parse upload."""
    if BC_FILE and Path(BC_FILE).exists():
        return (Path(BC_FILE).name, Path(BC_FILE).read_bytes(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return ("bc_bqms_test.xlsx", _make_minimal_bc_bqms_excel(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def _assert_envelope(r: httpx.Response, expected_status: int = 200) -> dict[str, Any]:
    assert r.status_code == expected_status, f"{r.request.method} {r.request.url} -> {r.status_code}: {r.text[:500]}"
    body = r.json()
    assert "data" in body, f"Response missing 'data' key: {body}"
    return body["data"]


# ─── Scenario 1: Auth ───────────────────────────────────────────────

def test_01_login(auth_token: str):
    """Smoke: token retrieved, non-empty."""
    assert auth_token and len(auth_token) > 20


# ─── Scenario 2: RFQ history listing ────────────────────────────────

def test_02_rfq_history_pagination(http_client: httpx.Client, auth_headers: dict):
    """List RFQ — first page, default size."""
    r = http_client.get("/api/v1/bqms/rfq?limit=10&page=1", headers=auth_headers)
    data = _assert_envelope(r)
    assert "items" in data, data
    assert isinstance(data["items"], list)


def test_03_rfq_table_pivot(http_client: httpx.Client, auth_headers: dict):
    """Denormalized RFQ table view (v1/v2/v3/v4 prices)."""
    r = http_client.get("/api/v1/bqms/rfq-table?limit=5", headers=auth_headers)
    data = _assert_envelope(r)
    assert "items" in data
    if data["items"]:
        sample = data["items"][0]
        for k in ("bqms_code", "rfq_number"):
            assert k in sample, f"Missing key {k} in RFQ table item: {sample}"


# ─── Scenario 3: Parse BC BQMS Excel ────────────────────────────────

def test_04_parse_bc_bqms(http_client: httpx.Client, auth_headers: dict):
    """Upload a BC BQMS Excel and verify parser returns items + TM/GC counts."""
    fname, content, ctype = _bc_bqms_payload()
    files = {"file": (fname, content, ctype)}
    r = http_client.post("/api/v1/quotations/parse", files=files, headers=auth_headers)
    data = _assert_envelope(r)
    assert data["total"] >= 1, f"Parser returned 0 items: {data}"
    assert "tm_count" in data and "gc_count" in data, data
    # Items have minimum expected fields
    item = data["items"][0]
    for k in ("bqms", "spec", "loai_hang"):
        assert k in item, f"Missing key {k}: {item}"


# ─── Scenario 4: Generate quotation — TM flow ───────────────────────

def test_05_generate_quotation_tm(
    http_client: httpx.Client,
    auth_headers: dict,
    test_rfq_no: str,
    created_quotation_ids: list[int],
):
    """Create a TM (Thương mại) quotation, expect Excel + PDF in response."""
    items = [
        {
            "don_hang": test_rfq_no,
            "bqms": "Z9999999-000001",
            "spec": "FINGER RF CAL,PB108,TRANG,L23.4xW8.3xH15MM,ESD 10^5-10^7Ohm",
            "maker": "AMA",
            "don_vi": "EA",
            "so_luong": 100,
            "loai_hang": "TM",
            "unit_price": 180000,
            "ghi_chu": "test TM item",
        },
        {
            "don_hang": test_rfq_no,
            "bqms": "Z9999999-000002",
            "spec": "BOOTPLATE RF,PB108,TRANG,L136xW80xH5MM,ESD 10^5-10^7Ohm",
            "maker": "AMA",
            "don_vi": "EA",
            "so_luong": 50,
            "loai_hang": "TM",
            "unit_price": 128000,
            "ghi_chu": "test TM item 2",
        },
    ]

    r = http_client.post(
        "/api/v1/quotations/generate",
        json={"rfq_no": test_rfq_no, "source_type": "rfq_code", "items": items, "flow_type": "tm"},
        headers=auth_headers,
    )
    data = _assert_envelope(r)
    assert data["status"] == "completed", f"Quotation generation failed: {data}"
    assert data["total_items"] == 2
    qid = data["id"]
    created_quotation_ids.append(qid)

    file_types = {f["type"] for f in data["files"]}
    assert "cam_ket_xlsx" in file_types
    assert "quotation_xlsx" in file_types
    # PDF generation may fail in environments without Gotenberg — warn, don't fail.
    if "cam_ket_pdf" not in file_types:
        pytest.warns(UserWarning, "cam_ket_pdf missing — Gotenberg likely unavailable")


def test_06_download_tm_files(
    http_client: httpx.Client,
    auth_headers: dict,
    created_quotation_ids: list[int],
):
    """Download Excel + PDF (if available) for the TM quotation just created."""
    assert created_quotation_ids, "test_05 must run first"
    qid = created_quotation_ids[0]

    r = http_client.get(f"/api/v1/quotations/download/{qid}/cam_ket_xlsx", headers=auth_headers)
    assert r.status_code == 200, f"download cam_ket_xlsx failed: {r.status_code} {r.text[:300]}"
    assert len(r.content) > 1000, "cam_ket xlsx body suspiciously small"
    assert r.content[:2] == b"PK", "Not an XLSX file (no PK zip magic)"

    r = http_client.get(f"/api/v1/quotations/download/{qid}/quotation_xlsx", headers=auth_headers)
    assert r.status_code == 200
    assert r.content[:2] == b"PK"

    # PDF: optional
    r = http_client.get(f"/api/v1/quotations/download/{qid}/cam_ket_pdf", headers=auth_headers)
    if r.status_code == 200:
        assert r.content[:4] == b"%PDF", "Not a PDF (no %PDF magic)"


# ─── Scenario 5: Generate quotation — GC flow ───────────────────────

def test_07_generate_quotation_gc(
    http_client: httpx.Client,
    auth_headers: dict,
    test_rfq_no: str,
    created_quotation_ids: list[int],
):
    """Create a GC (Gia công) quotation."""
    rfq_gc = f"{test_rfq_no}-GC"
    items = [
        {
            "don_hang": rfq_gc,
            "bqms": "Z9999999-000003",
            "spec": "GC SAMPLE PART, PROCESSING ABS",
            "maker": "AMA",
            "don_vi": "EA",
            "so_luong": 30,
            "loai_hang": "GC",
            "unit_price": 250000,
        }
    ]
    r = http_client.post(
        "/api/v1/quotations/generate",
        json={"rfq_no": rfq_gc, "source_type": "rfq_code", "items": items, "flow_type": "gc"},
        headers=auth_headers,
    )
    data = _assert_envelope(r)
    assert data["status"] in ("completed", "failed"), data
    qid = data["id"]
    created_quotation_ids.append(qid)
    # GC may produce different file types; just check at least one xlsx exists.
    types = {f["type"] for f in data["files"]}
    assert any("xlsx" in t for t in types), f"No xlsx in GC output: {types}"


# ─── Scenario 6: PATCH quotation (edit + regenerate) ────────────────

def test_08_patch_and_regenerate(
    http_client: httpx.Client,
    auth_headers: dict,
    created_quotation_ids: list[int],
):
    """Edit a quotation's items + force regenerate, verify response."""
    assert created_quotation_ids, "no quotation to patch"
    qid = created_quotation_ids[0]
    new_items = [
        {
            "don_hang": "PATCHED-RFQ",
            "bqms": "Z9999999-000099",
            "spec": "PATCHED ITEM SPEC",
            "maker": "AMA",
            "don_vi": "EA",
            "so_luong": 5,
            "loai_hang": "TM",
            "unit_price": 999000,
        }
    ]
    r = http_client.patch(
        f"/api/v1/quotations/history/{qid}",
        json={"items": new_items, "regenerate": True, "flow_type": "tm"},
        headers=auth_headers,
    )
    data = _assert_envelope(r)
    assert data["regenerated"] is True


# ─── Scenario 7: DELETE — soft, restore, hard ───────────────────────

def test_09_soft_delete(
    http_client: httpx.Client,
    auth_headers: dict,
    created_quotation_ids: list[int],
):
    """Soft-delete a quotation; verify list excludes it; verify restore."""
    if len(created_quotation_ids) < 2:
        pytest.skip("need at least 2 created quotations")
    qid = created_quotation_ids[1]

    # Soft delete
    r = http_client.delete(f"/api/v1/quotations/history/{qid}", headers=auth_headers)
    data = _assert_envelope(r)
    assert data.get("soft_deleted") or data.get("already_deleted"), data

    # GET should now 404 (deleted_at IS NULL filter)
    r = http_client.get(f"/api/v1/quotations/history/{qid}", headers=auth_headers)
    assert r.status_code == 404, "soft-deleted quotation must not be returned"

    # Restore
    r = http_client.post(f"/api/v1/quotations/history/{qid}/restore", headers=auth_headers)
    data = _assert_envelope(r)
    assert data.get("restored") is True

    # Re-soft-delete to mark it for cleanup again (we will hard-delete in cleanup).
    http_client.delete(f"/api/v1/quotations/history/{qid}", headers=auth_headers)


# ─── Scenario 8 (cleanup): hard-delete all created quotations ───────

def test_99_cleanup(
    http_client: httpx.Client,
    auth_headers: dict,
    created_quotation_ids: list[int],
):
    """Hard-delete every quotation created in this test run, plus any leftover
    rows whose rfq_no starts with RFQ_PREFIX (defence-in-depth)."""
    failures: list[str] = []

    # Direct cleanup of tracked IDs
    for qid in created_quotation_ids:
        r = http_client.delete(
            f"/api/v1/quotations/history/{qid}?hard=true",
            headers=auth_headers,
        )
        if r.status_code not in (200, 404):
            failures.append(f"hard-delete {qid}: {r.status_code} {r.text[:200]}")

    # Sweep any leftovers by RFQ prefix (idempotent)
    r = http_client.get(
        f"/api/v1/quotations/history?rfq_no={RFQ_PREFIX}&include_deleted=true&limit=100",
        headers=auth_headers,
    )
    if r.status_code == 200:
        for it in r.json().get("data", {}).get("items", []):
            qid = it.get("id")
            if not qid:
                continue
            r2 = http_client.delete(
                f"/api/v1/quotations/history/{qid}?hard=true",
                headers=auth_headers,
            )
            if r2.status_code not in (200, 404):
                failures.append(f"sweep {qid}: {r2.status_code}")

    assert not failures, "Cleanup encountered failures:\n  " + "\n  ".join(failures)
