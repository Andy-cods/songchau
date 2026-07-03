"""W1-08 — Cụm IMV (iMarketVietnam): API đọc + parser XML + W0-11 fail-silent fix.

Ba tầng test, KHÔNG bao giờ chạy scraper thật (không mở Playwright, không gọi
imvmall.com):

  1. INTEGRATION (marker=integration, cần full prod schema snapshot)
     Seed thẳng vào imv_rfq / imv_orders / imv_sync_log qua fixture `db`
     (transaction rollback sau mỗi test), rồi gọi các endpoint ĐỌC:
       * GET /api/v1/imv/stats        — KPI dashboard (PO value, quote rate, trend)
       * GET /api/v1/imv/kpi          — tổng hợp 6 entity + last_sync
       * GET /api/v1/imv/rfq          — alias tương thích (list_entity 'rfq')
       * GET /api/v1/imv/{entity}/list— generic list + filter q/customer + 404
       * GET /api/v1/imv/sync-history — lịch sử sync + filter entity
     và kiểm RBAC: role được phép → 200, role KHÔNG phép (vendor) → 403.
     POST /api/v1/imv/sync CHỈ test nhánh KHÔNG spawn thread:
       * viewer → 403 (VIEWER_READ_ONLY), accountant → 403 (INSUFFICIENT)
       * admin + đã có job 'running' → 409 (khoá đồng thời) — require_role/khoá
         409 raise TRƯỚC khi `threading.Thread(...).start()`, nên KHÔNG có
         Playwright nào chạy.

  2. UNIT — parser thuần trong app/etl/imv_playwright.py (marker=unit, không DB,
     không network). Dùng `pytest.importorskip` để nếu môi trường test KHÔNG cài
     `playwright` (nó là dep nặng, thường chỉ có trên VPS scraper — KHÔNG nằm
     trong requirements của backend) thì SKIP sạch, KHÔNG lỗi collection.

  3. UNIT — W0-11 (fail-silent): app/tasks/imv_sync._sync_entity phải ghi
     status='error' khi entity fetch NÉM EXCEPTION, và status='success' /
     total_records=0 khi entity trả DANH SÁCH RỖNG (lưới trống hợp lệ). Monkeypatch
     nhẹ 3 helper DB (psycopg2 SYNC_DSN) để không cần DB thật.

──────────────────────────────────────────────────────────────────────────────
MUTATION-CHECK (bằng chứng test THỰC SỰ bắt lỗi — tự kiểm định kỳ)
──────────────────────────────────────────────────────────────────────────────
  A) Bỏ nhánh W0-11: trong app/tasks/imv_sync._sync_entity, đổi khối
     `if isinstance(rows, BaseException):` thành `if False:` (coi Exception như
     dữ liệu) → `test_sync_entity_exception_records_error` FAIL (status không còn
     'error', hoặc _upsert_rows nổ khi lặp trên Exception).
  B) Rò RBAC: thêm 'vendor' vào require_role của /kpi →
     `test_kpi_rbac_forbidden_for_vendor` FAIL (nhận 200 thay vì 403).
  C) Hỏng parser: trong RFQ_MAP đổi index rfq_number (8) sang 'skip' →
     `test_row_to_dict_maps_rfq_cells` FAIL (rfq_number=None).
"""

from __future__ import annotations

import pytest
import pytest_asyncio


# ── Guard: các test integration chỉ chạy khi có full prod schema snapshot ─────
# (giống test_vendor_isolation.py). imv_* KHÔNG có trong _bootstrap_schema.sql,
# nên nếu harness rơi về bootstrap thì SKIP sạch thay vì lỗi "table không tồn tại".
@pytest.fixture(autouse=True)
def _require_full_schema(request):
    if request.node.get_closest_marker("integration"):
        info = request.getfixturevalue("schema_info")
        if not info["full_schema"]:
            pytest.skip(
                "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
                "(pg_dump --schema-only) cho các bảng imv_*. Đang nạp: "
                + info["source"]
            )


# ════════════════════════════════════════════════════════════════════════════
# SEED — một "thế giới IMV" nhỏ, giá trị TƯỜNG MINH để assert số đếm chính xác.
# ════════════════════════════════════════════════════════════════════════════
@pytest_asyncio.fixture
async def imv_world(db):
    """Seed 3 RFQ + 2 Orders + 3 sync_log. Mọi thứ trong tx rollback của `db`.

    imv_rfq (kiểu: quantity/offered_qty = numeric(18,4); request/due_date = date):
      RFQ-001  Cty A  qty=100 offered=50  request=today due=today+7 flow=quoted (đã báo giá)
      RFQ-002  Cty B  qty=200 offered=NULL request=today due=today-1 flow=requested (quá hạn)
      RFQ-003  Cty A  qty=300 offered=0    request=today due=today    flow=won  (due hôm nay)

    imv_orders (amount = numeric(18,4)):
      POI-1 Cty A amount=1,000,000  order=today
      POI-2 Cty B amount=2,000,000  order=today

    imv_sync_log:
      rfq    success total=3
      orders error   total=0 (login broke)
      rfq    success total=3  (bản mới hơn — để DISTINCT ON lấy cái này cho 'rfq')
    """
    # ── imv_rfq — 3 dòng (dùng biểu thức ngày SQL để khỏi import datetime) ──
    await db.execute(
        """
        INSERT INTO imv_rfq
            (rfq_number, item_code, product_name, customer_name, handler_login,
             quantity, offered_qty, request_date, due_date, flow_status, status_text)
        VALUES
            ('RFQ-001', 'IT-1', 'Bạc lót thép', 'Cty A', 'hdlr1',
             100, 50, CURRENT_DATE, CURRENT_DATE + 7, 'quoted', 'Đang xử lý')
        """
    )
    await db.execute(
        """
        INSERT INTO imv_rfq
            (rfq_number, item_code, product_name, customer_name, handler_login,
             quantity, offered_qty, request_date, due_date, flow_status, status_text)
        VALUES
            ('RFQ-002', 'IT-2', 'Vòng bi', 'Cty B', 'hdlr2',
             200, NULL, CURRENT_DATE, CURRENT_DATE - 1, 'requested', 'Mới')
        """
    )
    await db.execute(
        """
        INSERT INTO imv_rfq
            (rfq_number, item_code, product_name, customer_name, handler_login,
             quantity, offered_qty, request_date, due_date, flow_status, status_text)
        VALUES
            ('RFQ-003', 'IT-3', 'Gioăng cao su', 'Cty A', 'hdlr1',
             300, 0, CURRENT_DATE, CURRENT_DATE, 'won', 'Trúng')
        """
    )

    # ── imv_orders — 2 dòng ──
    await db.execute(
        """
        INSERT INTO imv_orders
            (po_internal_number, item_code, customer_name, amount, order_date)
        VALUES
            ('POI-1', 'IT-1', 'Cty A', 1000000, CURRENT_DATE),
            ('POI-2', 'IT-2', 'Cty B', 2000000, CURRENT_DATE)
        """
    )

    # ── imv_sync_log — 3 dòng; started_at tăng dần để DISTINCT ON/ORDER BY rõ ──
    await db.execute(
        """
        INSERT INTO imv_sync_log
            (status, entity_type, total_records, new_records, updated_records,
             error_message, duration_seconds, started_at, finished_at)
        VALUES
            ('success', 'rfq', 3, 3, 0, NULL, 1.5,
             NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours'),
            ('error', 'orders', 0, 0, 0, 'login broke mid-session', 0.0,
             NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour'),
            ('success', 'rfq', 3, 0, 3, NULL, 1.2,
             NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes')
        """
    )
    return {"rfq_count": 3, "orders_count": 2}


# ════════════════════════════════════════════════════════════════════════════
# 1. INTEGRATION — endpoint ĐỌC
# ════════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_stats_shape_and_counts(client, manager, imv_world):
    """GET /imv/stats — số PO, tỉ lệ báo giá, top khách, trend đúng như seed."""
    r = await client.get("/api/v1/imv/stats", headers=manager["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]

    # PO: 2 đơn, tổng 3,000,000; cả 2 trong window 12 tháng.
    po = data["po"]
    assert po["total_count"] == 2
    assert po["total_value_vnd"] == 3000000.0
    assert po["count_in_window"] == 2
    assert po["value_in_window_vnd"] == 3000000.0

    # RFQ: tổng 3; đã báo giá theo offered_qty>0 chỉ RFQ-001 (RFQ-003 offered=0
    # KHÔNG tính); theo flow_status (quoted/won/accepted) là RFQ-001 + RFQ-003 = 2.
    rfq = data["rfq"]
    assert rfq["total"] == 3
    assert rfq["quoted_by_offered_qty"] == 1
    assert rfq["quoted_by_status"] == 2
    assert rfq["total_qty_requested"] == 600.0      # 100+200+300
    assert rfq["total_qty_quoted"] == 50.0          # 50 + 0 (NULL→0)
    assert rfq["quote_rate_pct"] == pytest.approx(33.3, abs=0.1)  # 1/3

    # Top khách theo giá trị PO: Cty B (2M) trước Cty A (1M).
    top = data["top_customers"]
    assert top[0]["customer_name"] == "Cty B"
    assert top[0]["total_value_vnd"] == 2000000.0
    names = {c["customer_name"] for c in top}
    assert {"Cty A", "Cty B"} <= names

    # Trend tháng hiện tại: 3 RFQ, 1 đã báo giá (offered>0), qty=600.
    trend = data["monthly_trend"]
    assert len(trend) == 1
    assert trend[0]["rfq_count"] == 3
    assert trend[0]["quoted_count"] == 1
    assert trend[0]["qty_requested"] == 600.0


@pytest.mark.integration
async def test_kpi_shape_and_counts(client, manager, imv_world):
    """GET /imv/kpi — đếm mở/quá hạn/hôm nay + counts 6 entity + last_sync."""
    r = await client.get("/api/v1/imv/kpi", headers=manager["headers"])
    assert r.status_code == 200, r.text
    body = r.json()

    kpi = body["kpi"]
    assert kpi["total"] == 3
    assert kpi["open_rfq"] == 2       # due>=today: RFQ-001(+7), RFQ-003(today)
    assert kpi["overdue"] == 1        # due<today: RFQ-002
    assert kpi["due_today"] == 1      # due=today: RFQ-003
    assert kpi["customers"] == 2      # Cty A, Cty B
    assert kpi["handlers"] == 2       # hdlr1, hdlr2

    counts = body["counts"]
    assert counts["rfq"] == 3
    assert counts["orders"] == 2
    # Các bảng chưa seed → 0 (đảm bảo endpoint đếm đủ 6 entity, không KeyError).
    for empty in ("deliveries", "payments", "contracts", "rejections"):
        assert counts[empty] == 0

    # last_sync tổng thể = bản mới nhất (rfq success, 10 phút trước).
    assert body["last_sync"] is not None
    assert body["last_sync"]["status"] == "success"
    # DISTINCT ON (entity_type): 'orders' phải là bản error đã seed.
    per = body["last_sync_per_entity"]
    assert per["orders"]["status"] == "error"
    assert per["rfq"]["status"] == "success"


@pytest.mark.integration
async def test_rfq_compat_list_and_filters(client, manager, imv_world):
    """GET /imv/rfq (alias) — total đúng; filter q + customer thu hẹp đúng."""
    r = await client.get("/api/v1/imv/rfq", headers=manager["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["total"] == 3
    assert len(data["items"]) == 3
    got = {it["rfq_number"] for it in data["items"]}
    assert got == {"RFQ-001", "RFQ-002", "RFQ-003"}

    # q= khớp rfq_number (một trong search_cols).
    r2 = await client.get(
        "/api/v1/imv/rfq", headers=manager["headers"], params={"q": "RFQ-002"}
    )
    assert r2.status_code == 200
    d2 = r2.json()["data"]
    assert d2["total"] == 1
    assert d2["items"][0]["rfq_number"] == "RFQ-002"

    # customer= khớp customer_name — Cty A có 2 dòng (RFQ-001, RFQ-003).
    r3 = await client.get(
        "/api/v1/imv/rfq", headers=manager["headers"], params={"customer": "Cty A"}
    )
    assert r3.status_code == 200
    d3 = r3.json()["data"]
    assert d3["total"] == 2
    assert {it["rfq_number"] for it in d3["items"]} == {"RFQ-001", "RFQ-003"}


@pytest.mark.integration
async def test_generic_entity_list_and_unknown_404(client, manager, imv_world):
    """GET /imv/{entity}/list — 'orders' trả 2 dòng; entity lạ → 404 rõ ràng."""
    r = await client.get("/api/v1/imv/orders/list", headers=manager["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["total"] == 2
    assert {it["po_internal_number"] for it in data["items"]} == {"POI-1", "POI-2"}

    bad = await client.get("/api/v1/imv/nonsense/list", headers=manager["headers"])
    assert bad.status_code == 404


@pytest.mark.integration
async def test_sync_history_and_entity_filter(client, manager, imv_world):
    """GET /imv/sync-history — 3 dòng; filter entity=orders → chỉ 1 (error)."""
    r = await client.get("/api/v1/imv/sync-history", headers=manager["headers"])
    assert r.status_code == 200, r.text
    rows = r.json()["data"]
    assert len(rows) == 3
    # Sắp xếp started_at DESC → bản mới nhất (rfq success 10') đứng đầu.
    assert rows[0]["status"] == "success"
    # Shape từng dòng.
    for row in rows:
        for key in ("id", "status", "entity_type", "total_records",
                    "new_records", "updated_records", "started_at"):
            assert key in row

    r2 = await client.get(
        "/api/v1/imv/sync-history",
        headers=manager["headers"],
        params={"entity": "orders"},
    )
    assert r2.status_code == 200
    only = r2.json()["data"]
    assert len(only) == 1
    assert only[0]["entity_type"] == "orders"
    assert only[0]["status"] == "error"
    assert only[0]["error_message"] == "login broke mid-session"


# ── RBAC ─────────────────────────────────────────────────────────────────────
@pytest.mark.integration
async def test_kpi_rbac_forbidden_for_vendor(client, vendor, imv_world):
    """Cổng NCC (role=vendor) KHÔNG được đọc dữ liệu nội bộ IMV → 403.

    vendor KHÔNG phải viewer nên KHÔNG hưởng bypass read-only; require_role chặn.
    """
    r = await client.get("/api/v1/imv/kpi", headers=vendor["headers"])
    assert r.status_code == 403, r.text


@pytest.mark.integration
async def test_stats_rbac_forbidden_for_vendor(client, vendor):
    """/imv/stats cũng cấm vendor (không cần seed — chặn ở tầng RBAC)."""
    r = await client.get("/api/v1/imv/stats", headers=vendor["headers"])
    assert r.status_code == 403, r.text


@pytest.mark.integration
async def test_rfq_list_allowed_for_accountant(client, accountant, imv_world):
    """accountant NẰM trong allowed_roles của /rfq → 200 (đối chứng RBAC)."""
    r = await client.get("/api/v1/imv/rfq", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["data"]["total"] == 3


# ── POST /sync — CHỈ các nhánh KHÔNG spawn Playwright thread ─────────────────
@pytest.mark.integration
async def test_sync_forbidden_for_viewer(client, viewer):
    """viewer POST /sync → 403 VIEWER_READ_ONLY (raise trước khi chạy thread)."""
    r = await client.post("/api/v1/imv/sync", headers=viewer["headers"])
    assert r.status_code == 403, r.text


@pytest.mark.integration
async def test_sync_forbidden_for_accountant(client, accountant):
    """accountant KHÔNG trong {admin,manager,procurement} → 403 INSUFFICIENT."""
    r = await client.post("/api/v1/imv/sync", headers=accountant["headers"])
    assert r.status_code == 403, r.text


@pytest.mark.integration
async def test_sync_conflict_when_job_running(client, admin, db):
    """admin POST /sync khi đã có job 'running' (<15') → 409, KHÔNG spawn thread.

    Khoá đồng thời raise 409 TRƯỚC lệnh threading.Thread(...).start(), nên test
    này an toàn: không có Playwright/scraper nào được khởi động.
    """
    await db.execute(
        "INSERT INTO imv_sync_log (status, entity_type, started_at) "
        "VALUES ('running', 'rfq', NOW())"
    )
    r = await client.post("/api/v1/imv/sync", headers=admin["headers"])
    assert r.status_code == 409, r.text


# ════════════════════════════════════════════════════════════════════════════
# 2. UNIT — parser thuần (importorskip nếu thiếu playwright)
# ════════════════════════════════════════════════════════════════════════════
def _pw():
    """Import module parser; SKIP sạch nếu playwright chưa cài (dep nặng, không
    nằm trong requirements backend). Trả về module app.etl.imv_playwright."""
    return pytest.importorskip(
        "app.etl.imv_playwright",
        reason="playwright chưa cài trong môi trường test — bỏ qua unit parser",
    )


@pytest.mark.unit
def test_decode_cell_strips_anchor_and_entities():
    m = _pw()
    # Ô có thẻ <A> bọc → lấy text bên trong.
    assert m._decode_cell('<A href="#foo">ITM-100</A>') == "ITM-100"
    # Ô thuần → strip.
    assert m._decode_cell("  hello  ") == "hello"
    # None → ''.
    assert m._decode_cell(None) == ""
    # Entity HTML được unescape.
    assert m._decode_cell("A &amp; B") == "A & B"


@pytest.mark.unit
def test_number_and_date_parsers():
    m = _pw()
    # số thập phân có dấu phẩy nghìn.
    assert m._parse_decimal("1,234.5") == 1234.5
    assert m._parse_decimal("") is None
    assert m._parse_decimal("abc") is None
    # int chấp nhận dạng float-string.
    assert m._parse_int("12.0") == 12
    assert m._parse_int("1,000") == 1000
    assert m._parse_int("") is None
    # date CHỈ nhận đúng YYYY-MM-DD, còn lại None.
    assert m._parse_date("2026-07-01") == "2026-07-01"
    assert m._parse_date("not-a-date") is None
    assert m._parse_date("01/07/2026") is None


@pytest.mark.unit
def test_row_to_dict_maps_rfq_cells():
    """Dựng 1 <row> với cell ở đúng index RFQ_MAP → map ra field đúng kiểu."""
    m = _pw()
    from xml.etree import ElementTree as ET

    # RFQ_MAP index: 2 status_text, 3 handler_name, 4 customer_name,
    # 7 item_code, 8 rfq_number, 9 product_name, 14 quantity(dec),
    # 16 request_date(date), 17 due_date(date), 26 handler_login.
    texts = [""] * 27
    texts[2] = "Đang xử lý"
    texts[3] = "Nguyen Van A"
    texts[4] = "Cty ABC"
    texts[7] = '<A href="#">ITM-100</A>'   # có anchor → phải decode
    texts[8] = "RFQ-XYZ"
    texts[9] = "Bạc lót"
    texts[14] = "1,234"                      # dec → 1234.0
    texts[16] = "2026-07-01"                 # date hợp lệ
    texts[17] = "not-a-date"                 # date sai → None
    texts[26] = "hlogin"

    row = ET.Element("row")
    for t in texts:
        cell = ET.SubElement(row, "cell")
        cell.text = t

    d = m._row_to_dict(row, m.RFQ_MAP)
    assert d["status_text"] == "Đang xử lý"
    assert d["handler_name"] == "Nguyen Van A"
    assert d["customer_name"] == "Cty ABC"
    assert d["item_code"] == "ITM-100"       # anchor đã bị lột
    assert d["rfq_number"] == "RFQ-XYZ"
    assert d["product_name"] == "Bạc lót"
    assert d["quantity"] == 1234.0
    assert d["request_date"] == "2026-07-01"
    assert d["due_date"] is None
    assert d["handler_login"] == "hlogin"
    # cột 'skip' KHÔNG được xuất hiện.
    assert "row_num" not in d and "action_link" not in d


@pytest.mark.unit
def test_row_to_dict_short_row_fills_none():
    """Row thiếu cell (ngắn hơn map) → field vượt tầm = None, không IndexError."""
    m = _pw()
    from xml.etree import ElementTree as ET

    row = ET.Element("row")
    for t in ["0", "1", "open"]:   # chỉ 3 cell
        cell = ET.SubElement(row, "cell")
        cell.text = t
    d = m._row_to_dict(row, m.RFQ_MAP)
    assert d["status_text"] == "open"        # index 2 có
    assert d["rfq_number"] is None           # index 8 thiếu → None
    assert d["quantity"] is None


# ════════════════════════════════════════════════════════════════════════════
# 3. UNIT — W0-11 fail-silent: _sync_entity phân biệt LỖI vs LƯỚI-TRỐNG
# ════════════════════════════════════════════════════════════════════════════
def _imv_sync():
    """Import task module (psycopg2 + procrastinate); SKIP sạch nếu thiếu dep."""
    return pytest.importorskip(
        "app.tasks.imv_sync",
        reason="thiếu psycopg2/procrastinate trong môi trường test",
    )


@pytest.mark.unit
def test_sync_entity_exception_records_error(monkeypatch):
    """rows là EXCEPTION (fetch hỏng) → status='error', total=0, có error_message,
    và kích hoạt _check_consecutive_errors. KHÔNG được thành 'success 0 rows'.

    Monkeypatch 3 helper DB (đi qua psycopg2 SYNC_DSN thật) để test thuần hàm.
    """
    m = _imv_sync()

    captured: dict = {}

    def fake_create(entity="rfq"):
        return 4242

    def fake_update(log_id, result, entity_type="rfq"):
        captured["log_id"] = log_id
        captured["result"] = dict(result)
        captured["entity_type"] = entity_type

    consec: list = []

    def fake_consec(entity, msg):
        consec.append((entity, msg))

    monkeypatch.setattr(m, "_create_sync_log", fake_create)
    monkeypatch.setattr(m, "_update_sync_log", fake_update)
    monkeypatch.setattr(m, "_check_consecutive_errors", fake_consec)

    # Bất kỳ Exception nào (ở prod là ImvFetchError) — dùng RuntimeError để test
    # KHÔNG phụ thuộc playwright.
    result = m._sync_entity("rfq", RuntimeError("login broke mid-session"))

    assert result["status"] == "error"
    assert result["total_records"] == 0
    assert result["new_records"] == 0
    assert result["updated_records"] == 0
    assert "login broke mid-session" in (result.get("error_message") or "")

    # Đã ghi log với status='error' (không phải success).
    assert captured["result"]["status"] == "error"
    assert captured["entity_type"] == "rfq"
    # Đã chạy cảnh báo lỗi-liên-tiếp đúng 1 lần.
    assert consec == [("rfq", result["error_message"])]


@pytest.mark.unit
def test_sync_entity_empty_list_is_success(monkeypatch):
    """rows là DANH SÁCH RỖNG (lưới trống HỢP LỆ, XML totalRecord=0) →
    status='success', total=0 — KHÔNG bị coi là lỗi, KHÔNG cảnh báo liên tiếp.

    _upsert_rows([]) trả (0,0) mà KHÔNG chạm DB (nhánh `if not rows`), nên chỉ
    cần monkeypatch _create/_update_sync_log."""
    m = _imv_sync()

    captured: dict = {}
    monkeypatch.setattr(m, "_create_sync_log", lambda entity="rfq": 7)
    monkeypatch.setattr(
        m, "_update_sync_log",
        lambda log_id, result, entity_type="rfq": captured.update(
            {"result": dict(result), "entity_type": entity_type}
        ),
    )
    consec: list = []
    monkeypatch.setattr(
        m, "_check_consecutive_errors", lambda e, msg: consec.append((e, msg))
    )

    result = m._sync_entity("rfq", [])

    assert result["status"] == "success"
    assert result["total_records"] == 0
    assert result["new_records"] == 0
    assert result["updated_records"] == 0
    assert captured["result"]["status"] == "success"
    # Lưới trống KHÔNG phải lỗi → KHÔNG kích hoạt cảnh báo liên tiếp.
    assert consec == []
