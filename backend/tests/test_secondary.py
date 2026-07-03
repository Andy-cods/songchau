"""W1-10 — CỤM SECONDARY: Kho (inventory) + Vận chuyển (shipments) + Workflow duyệt + Orders unified.

Phủ tự động 4 nhóm nghiệp vụ "phụ trợ" theo CODE THỰC (không bám plan cũ):
  * app/api/v1/inventory.py          — /api/v1/inventory
  * app/api/v1/shipment_tracking.py  — /api/v1/shipments
  * app/api/v1/workflows.py + app/services/workflow_engine.py — /api/v1/workflows
  * app/api/v1/orders.py             — /api/v1/orders  (view v_unified_orders)

Chạy in-process qua ASGITransport (xem conftest). Mọi ghi dữ liệu nằm trong
transaction của fixture `db` và bị ROLLBACK — không rác prod.

════════════════════════════════════════════════════════════════════════════
BÁM SCHEMA THỰC (tests/_schema_snapshot.sql) — 2 KHỐI "DRIFT" ĐÃ XÁC MINH
════════════════════════════════════════════════════════════════════════════
Trong lúc soạn test, đối chiếu CODE với snapshot đã lộ 2 vùng CODE ↔ SCHEMA
LỆCH NHAU (code tham chiếu cột KHÔNG tồn tại trong bất kỳ file .sql nào của repo:
init.sql / init_v3.sql / _schema_snapshot.sql). Những đường-đi "happy" chạm DB ở
2 vùng này sẽ 500 trên harness → được đánh dấu bằng @pytest.mark.xfail (strict=
False): thân test khẳng định HÀNH VI ĐÚNG (mong đợi sau khi hoà giải schema); khi
schema/code được sửa khớp, test tự chuyển XPASS. Đây chính là "khoá" bug — verify
fix sẽ tự sáng đèn.

  DRIFT-WF (khoá "current_status → current_state"):
    workflow_engine.py + workflows.py dùng cột current_state / entity_type /
    entity_id / workflow_history(workflow_id, acted_by, from_state, to_state).
    Snapshot workflow_instances CÓ: current_status (enum workflow_status),
    workflow_type (NOT NULL), ref_type, ref_id, title (NOT NULL); workflow_history
    CÓ: instance_id, actor_id, from_status, to_status. Enum workflow_status KHÔNG
    có 'closed' (chỉ 'cancelled'). ⇒ MỌI endpoint workflow chạm DB (create / list
    có filter status / pending / action / history) hiện 500 trên harness.
    → Đề bài mô tả "VỪA fix current_state" nhưng snapshot vẫn là current_status:
      hoặc thiếu migration đổi tên cột, hoặc snapshot cũ. Cần Thang hoà giải.

  DRIFT-INV:
    inventory.receive_goods: ON CONFLICT (product_id) — inventory KHÔNG có UNIQUE
    trên product_id (chỉ UNIQUE product_code); DO UPDATE ... updated_at = NOW()
    — cột tên thật là last_updated; INSERT (product_id, quantity) bỏ trống
    product_code / product_name (đều NOT NULL). inventory_movements: code ghi cột
    `note` (thật: `notes`), thiếu product_code/before_qty/after_qty (NOT NULL),
    reference_type='manual'/'shipment' & movement_type='adjust_in'/'adjust_out'
    VI PHẠM CHECK (chỉ nhận in|out|adjust và po|sale|bqms_delivery|imv_delivery|
    adjustment|return). Ngoài ra adjust/movements nhận inventory_id: str nhưng
    `WHERE id = $1` bind vào cột bigint KHÔNG cast ⇒ asyncpg DataError. ⇒ receive
    hợp lệ + adjust thành công + guard "kho không âm" đều 500 trước khi tới đích.

Các NHÁNH KHÔNG chạm 2 vùng drift (RBAC gate, Pydantic 422, guard trước-DB, định
tuyến, và TOÀN BỘ máy trạng thái shipments qua seed trực tiếp) được test XANH,
assert tường minh.
"""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
import pytest_asyncio

pytestmark = pytest.mark.integration

INV = "/api/v1/inventory"
SHIP = "/api/v1/shipments"
WF = "/api/v1/workflows"
ORD = "/api/v1/orders"


# ── Guard: chỉ chạy khi có full prod schema (snapshot). Fixture ASYNC + function-
#    scope, nhận `schema_info` như DEPENDENCY khai báo (KHÔNG request.getfixturevalue
#    trên fixture async → tránh "event loop is already running"). Giống test_crm. ──
@pytest_asyncio.fixture(autouse=True)
async def _require_full_schema(request, schema_info):
    if request.node.get_closest_marker("integration") and not schema_info["full_schema"]:
        pytest.skip(
            "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
            "(pg_dump --schema-only). Schema đang nạp: " + schema_info["source"]
        )


def _uniq(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


# ── Seed helpers (dùng `db` — cùng connection app request, rollback sau test) ──
async def _seed_supplier(db, creator_uuid) -> int:
    return await db.fetchval(
        "INSERT INTO suppliers (name, created_by) VALUES ($1, $2::uuid) RETURNING id",
        _uniq("DEMO NCC"), creator_uuid,
    )


async def _seed_po(db, supplier_id, creator_uuid, *, total=10_000_000) -> int:
    return await db.fetchval(
        """
        INSERT INTO purchase_orders
            (po_number, supplier_id, total_amount, exchange_rate, created_by, status)
        VALUES ($1, $2, $3, 1, $4::uuid, 'draft')
        RETURNING id
        """,
        _uniq("PO"), supplier_id, total, creator_uuid,
    )


async def _seed_shipment(db, creator_uuid, *, status="pending") -> dict:
    """Seed NCC + PO + 1 lô hàng ở trạng thái cho trước. shipment_number cấp sẵn
    (bỏ qua trigger gen_shipment_number). status là cột text + CHECK (không enum)."""
    supplier_id = await _seed_supplier(db, creator_uuid)
    po_id = await _seed_po(db, supplier_id, creator_uuid)
    ship_id = await db.fetchval(
        """
        INSERT INTO shipments (shipment_number, po_id, supplier_id, status, created_by)
        VALUES ($1, $2, $3, $4, $5::uuid)
        RETURNING id
        """,
        _uniq("SH"), po_id, supplier_id, status, creator_uuid,
    )
    return {"shipment_id": ship_id, "po_id": po_id, "supplier_id": supplier_id}


async def _seed_shipment_item(db, shipment_id, *, product_id=None, qty=10) -> int:
    """1 dòng lô hàng. product_id=None ⇒ receive KHÔNG chạm inventory (bỏ nhánh
    drift inventory_movements) → test được đường receive hợp lệ."""
    return await db.fetchval(
        """
        INSERT INTO shipment_items (shipment_id, product_id, quantity_shipped, unit)
        VALUES ($1, $2, $3, 'EA')
        RETURNING id
        """,
        shipment_id, product_id, qty,
    )


async def _seed_product(db) -> int:
    return await db.fetchval(
        "INSERT INTO products (product_name) VALUES ($1) RETURNING id",
        _uniq("SP"),
    )


async def _seed_inventory(db, *, quantity=5) -> dict:
    """Seed products + 1 dòng inventory (product_id FK → products). quantity numeric
    ≥0 (CHECK). Trả về id (bigint) để dựng path."""
    product_id = await _seed_product(db)
    inv_id = await db.fetchval(
        """
        INSERT INTO inventory (product_id, product_code, product_name, quantity)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        """,
        product_id, _uniq("PC"), _uniq("Tên SP"), quantity,
    )
    return {"inventory_id": inv_id, "product_id": product_id, "quantity": quantity}


async def _seed_sourcing_order(db, *, source_type="sourcing", status="draft",
                               total=5_000_000) -> dict:
    row = await db.fetchrow(
        """
        INSERT INTO sourcing_orders
            (order_number, customer_name, source_type, status, total_value_vnd)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, order_number, source_type, status
        """,
        _uniq("SO"), "DEMO KH Đơn", source_type, status, total,
    )
    return dict(row)


# ════════════════════════════════════════════════════════════════════════════
# A) INVENTORY — /api/v1/inventory
# ════════════════════════════════════════════════════════════════════════════

async def test_inventory_list_ok_shape(client, manager):
    """GET /inventory → 200, shape {data: list, total: int} (kho rỗng vẫn hợp lệ)."""
    r = await client.get(INV, headers=manager["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["data"], list)
    assert isinstance(body["total"], int)


async def test_inventory_low_stock_ok(client, manager):
    """GET /inventory/low-stock → 200 (query min_stock/quantity đúng cột snapshot)."""
    r = await client.get(f"{INV}/low-stock", headers=manager["headers"])
    assert r.status_code == 200, r.text
    assert isinstance(r.json()["data"], list)


async def test_inventory_list_vendor_403(client, vendor):
    """RBAC: vendor (không thuộc allowed_roles, không phải viewer) → 403."""
    r = await client.get(INV, headers=vendor["headers"])
    assert r.status_code == 403, r.text


async def test_inventory_list_viewer_readonly_ok(client, viewer):
    """RBAC: viewer GET → 200 (allow_viewer mặc định True, bypass read-only)."""
    r = await client.get(INV, headers=viewer["headers"])
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("qty", [0, -5])
async def test_receive_quantity_nonpositive_400(client, staff, qty):
    """POST /inventory/receive với quantity ≤ 0 → 400 (guard TRƯỚC mọi DB)."""
    r = await client.post(
        f"{INV}/receive",
        json={"product_id": "1", "quantity": qty},
        headers=staff["headers"],
    )
    assert r.status_code == 400, r.text


async def test_receive_viewer_write_403(client, viewer):
    """POST /inventory/receive bằng viewer → 403 VIEWER_READ_ONLY (method ghi)."""
    r = await client.post(
        f"{INV}/receive",
        json={"product_id": "1", "quantity": 5},
        headers=viewer["headers"],
    )
    assert r.status_code == 403, r.text


async def test_receive_vendor_403(client, vendor):
    """POST /inventory/receive bằng vendor → 403 (INSUFFICIENT_PERMISSIONS)."""
    r = await client.post(
        f"{INV}/receive",
        json={"product_id": "1", "quantity": 5},
        headers=vendor["headers"],
    )
    assert r.status_code == 403, r.text


async def test_adjust_zero_delta_400(client, manager):
    """PUT /inventory/{id}/adjust với quantity_delta = 0 → 400 (guard trước DB)."""
    r = await client.put(
        f"{INV}/1/adjust",
        json={"quantity_delta": 0, "reason": "Kiểm kê định kỳ"},
        headers=manager["headers"],
    )
    assert r.status_code == 400, r.text


@pytest.mark.parametrize("reason", ["", "ab"])
async def test_adjust_reason_too_short_400(client, manager, reason):
    """Lý do < 3 ký tự → 400 (guard trước DB).

    LƯU Ý đề bài kỳ vọng 422; CODE THỰC trả 400 (HTTPException 400, không phải
    Pydantic). Bám code → assert 400. (delta ≠ 0 để vượt guard số-lượng.)"""
    r = await client.put(
        f"{INV}/1/adjust",
        json={"quantity_delta": 5, "reason": reason},
        headers=manager["headers"],
    )
    assert r.status_code == 400, r.text


async def test_adjust_missing_reason_422(client, manager):
    """Thiếu hẳn field reason (required) → 422 (Pydantic chặn trước handler)."""
    r = await client.put(
        f"{INV}/1/adjust",
        json={"quantity_delta": 5},
        headers=manager["headers"],
    )
    assert r.status_code == 422, r.text


async def test_adjust_staff_forbidden_403(client, staff):
    """RBAC: adjust yêu cầu manager/admin → staff → 403."""
    r = await client.put(
        f"{INV}/1/adjust",
        json={"quantity_delta": 5, "reason": "Điều chỉnh kiểm kê"},
        headers=staff["headers"],
    )
    assert r.status_code == 403, r.text


async def test_adjust_viewer_forbidden_403(client, viewer):
    """RBAC: viewer method ghi → 403 (VIEWER_READ_ONLY)."""
    r = await client.put(
        f"{INV}/1/adjust",
        json={"quantity_delta": 5, "reason": "Điều chỉnh kiểm kê"},
        headers=viewer["headers"],
    )
    assert r.status_code == 403, r.text


# ── DRIFT-INV (đã khớp schema): đường-đi chạm DB nay hợp lệ; assert HÀNH VI ĐÚNG ──
# (Trước đây xfail: ON CONFLICT không UNIQUE / SET updated_at / thiếu product_code /
#  cột `note` / reference_type='manual'. Đã sửa: upsert last_updated + product_code,
#  cột notes, reference_type='adjustment', before/after_qty, unique index product_id.)
async def test_receive_valid_creates_movement_expected_201(client, staff, db):
    """MONG ĐỢI: nhập kho hợp lệ → 201 + ghi inventory_movements 'in'."""
    product_id = await _seed_product(db)
    r = await client.post(
        f"{INV}/receive",
        json={"product_id": str(product_id), "quantity": 25, "note": "Nhập demo"},
        headers=staff["headers"],
    )
    assert r.status_code == 201, r.text
    assert r.json()["data"]["movement"]["movement_type"] == "in"


# (Trước đây xfail: inventory_id:str bind vào bigint → asyncpg DataError; movement
#  'adjust_out' vi phạm CHECK. Đã sửa: path int + movement_type='adjust'.)
async def test_adjust_cannot_go_negative_expected_400(client, manager, db):
    """MONG ĐỢI (kho KHÔNG âm): tồn 5, điều chỉnh -100 → 400, KHÔNG cho âm."""
    inv = await _seed_inventory(db, quantity=5)
    r = await client.put(
        f"{INV}/{inv['inventory_id']}/adjust",
        json={"quantity_delta": -100, "reason": "Xuất vượt tồn"},
        headers=manager["headers"],
    )
    assert r.status_code == 400, r.text
    # Tồn kho KHÔNG được đổi (vẫn 5, ≥ 0).
    qty = await db.fetchval(
        "SELECT quantity FROM inventory WHERE id = $1", inv["inventory_id"]
    )
    assert float(qty) == 5.0


# ════════════════════════════════════════════════════════════════════════════
# B) SHIPMENTS — /api/v1/shipments  (khoá 3 BUG-GATE E2E)
# ════════════════════════════════════════════════════════════════════════════

# ── BUG-GATE (a): FE gọi POST /shipments/{id}/status nhưng BE KHÔNG có route đó ──
async def test_bug_gate_a_status_route_absent_404(client, manager):
    """BUG-GATE (a): BE chỉ có /depart /arrive /receive — KHÔNG có /{id}/status.
    POST /shipments/{id}/status → 404 (định tuyến không khớp; không chạm DB).

    FE nào gọi POST .../status sẽ luôn hỏng cho tới khi BE thêm route hoặc FE đổi
    sang 3 route hành động chuyên biệt."""
    r = await client.post(f"{SHIP}/1/status", json={"status": "in_transit"},
                          headers=manager["headers"])
    assert r.status_code in (404, 405), r.text


# ── BUG-GATE (b)+(c): máy trạng thái đúng thứ tự + status 'in_transit' (KHÔNG 'departed') ──
async def test_bug_gate_bc_depart_then_arrive_status_values(client, staff, db):
    """BUG-GATE (b) đường đúng (depart→arrive) + (c) GIÁ TRỊ status — nhánh XANH.

    (b) depart → arrive theo thứ tự đều 200.
    (c) sau depart, status = 'in_transit' — KHÔNG phải 'departed' (FE kỳ vọng
        'departed' là SAI; 'departed' cũng KHÔNG nằm trong CHECK shipments_status);
        sau arrive → 'arrived_port'.

    Bước /receive TÁCH sang test xfail bên dưới: dù item product_id=NULL né được
    nhánh inventory, /receive vẫn 500 vì cập nhật `purchase_orders.received_at`
    (cột thật là received_date) — xem DRIFT-SHIP."""
    sh = await _seed_shipment(db, staff["id"], status="pending")
    today = dt.date.today().isoformat()

    r1 = await client.post(f"{SHIP}/{sh['shipment_id']}/depart",
                           json={"atd": today, "carrier": "COSCO"},
                           headers=staff["headers"])
    assert r1.status_code == 200, r1.text
    assert r1.json()["data"]["status"] == "in_transit"      # (c) KHÔNG 'departed'

    r2 = await client.post(f"{SHIP}/{sh['shipment_id']}/arrive",
                           json={"ata": today}, headers=staff["headers"])
    assert r2.status_code == 200, r2.text
    assert r2.json()["data"]["status"] == "arrived_port"

    # DB xác nhận trạng thái sau arrive.
    st = await db.fetchval("SELECT status FROM shipments WHERE id=$1", sh["shipment_id"])
    assert st == "arrived_port"


# (Trước đây xfail DRIFT-SHIP: UPDATE purchase_orders SET received_at — cột thật là
#  received_date. Đã sửa: dùng received_date; nhánh inventory khớp schema.)
async def test_receive_marks_shipment_received_expected_200(client, staff, db):
    """MONG ĐỢI: từ 'arrived_port' + xác nhận nhận hàng → 200, lô chuyển 'received'."""
    sh = await _seed_shipment(db, staff["id"], status="arrived_port")
    item_id = await _seed_shipment_item(db, sh["shipment_id"], product_id=None, qty=10)
    r = await client.post(
        f"{SHIP}/{sh['shipment_id']}/receive",
        json={"received_items": [{"shipment_item_id": item_id, "quantity_received": 10}]},
        headers=staff["headers"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "received"


async def test_bug_gate_b_arrive_before_depart_400(client, staff, db):
    """BUG-GATE (b) sai thứ tự: arrive khi còn 'pending' → 400.

    LƯU Ý đề bài kỳ vọng 409; CODE THỰC trả 400 (HTTPException 400). Bám code."""
    sh = await _seed_shipment(db, staff["id"], status="pending")
    r = await client.post(f"{SHIP}/{sh['shipment_id']}/arrive",
                          json={"ata": dt.date.today().isoformat()},
                          headers=staff["headers"])
    assert r.status_code == 400, r.text


async def test_bug_gate_b_receive_before_arrive_400(client, staff, db):
    """BUG-GATE (b): receive khi lô còn 'pending' → 400 (chưa đến cảng/đang đi)."""
    sh = await _seed_shipment(db, staff["id"], status="pending")
    r = await client.post(f"{SHIP}/{sh['shipment_id']}/receive",
                          json={"received_items": []}, headers=staff["headers"])
    assert r.status_code == 400, r.text


async def test_bug_gate_b_depart_twice_400(client, staff, db):
    """BUG-GATE (b): depart lần 2 (lô đã 'in_transit') → 400 (chỉ 'pending' mới depart)."""
    sh = await _seed_shipment(db, staff["id"], status="in_transit")
    r = await client.post(f"{SHIP}/{sh['shipment_id']}/depart",
                          json={"atd": dt.date.today().isoformat()},
                          headers=staff["headers"])
    assert r.status_code == 400, r.text


async def test_depart_missing_atd_422(client, staff, db):
    """Body thiếu atd (required) → 422 (Pydantic chặn trước handler)."""
    sh = await _seed_shipment(db, staff["id"], status="pending")
    r = await client.post(f"{SHIP}/{sh['shipment_id']}/depart",
                          json={}, headers=staff["headers"])
    assert r.status_code == 422, r.text


async def test_create_shipment_ok(client, staff, db):
    """POST /shipments hợp lệ → 201; shipment_number tự sinh (trigger gen_shipment_number)."""
    supplier_id = await _seed_supplier(db, staff["id"])
    po_id = await _seed_po(db, supplier_id, staff["id"])
    r = await client.post(
        SHIP,
        json={"po_id": po_id, "items": [{"quantity_shipped": 5, "product_id": None}]},
        headers=staff["headers"],
    )
    assert r.status_code == 201, r.text
    assert r.json()["data"]["shipment_number"]


async def test_create_shipment_no_items_400(client, staff, db):
    """POST /shipments không có item → 400."""
    supplier_id = await _seed_supplier(db, staff["id"])
    po_id = await _seed_po(db, supplier_id, staff["id"])
    r = await client.post(SHIP, json={"po_id": po_id, "items": []},
                          headers=staff["headers"])
    assert r.status_code == 400, r.text


async def test_create_shipment_bad_po_404(client, staff):
    """POST /shipments với po_id không tồn tại → 404."""
    r = await client.post(
        SHIP,
        json={"po_id": 999_999_999, "items": [{"quantity_shipped": 5}]},
        headers=staff["headers"],
    )
    assert r.status_code == 404, r.text


async def test_shipment_get_not_found_404(client, staff):
    """GET /shipments/{id} không tồn tại → 404."""
    r = await client.get(f"{SHIP}/999999999", headers=staff["headers"])
    assert r.status_code == 404, r.text


async def test_shipments_list_vendor_403(client, vendor):
    """RBAC: vendor list shipments → 403."""
    r = await client.get(SHIP, headers=vendor["headers"])
    assert r.status_code == 403, r.text


async def test_shipments_list_viewer_ok(client, viewer):
    """RBAC: viewer GET shipments → 200 (read-only bypass)."""
    r = await client.get(SHIP, headers=viewer["headers"])
    assert r.status_code == 200, r.text


# ════════════════════════════════════════════════════════════════════════════
# C) WORKFLOWS — /api/v1/workflows  (verify fix current_state)
# ════════════════════════════════════════════════════════════════════════════

# ── NHÁNH XANH: RBAC + Pydantic + cap (đều chặn TRƯỚC khi chạm SQL drift) ──────
async def test_workflows_vendor_403_all(client, vendor):
    """RBAC: vendor bị 403 trên mọi endpoint workflow (GET & ghi) — chặn ở require_role
    trước handler (không chạm SQL drift)."""
    paths_get = [WF, f"{WF}/pending/me", f"{WF}/1"]
    for p in paths_get:
        r = await client.get(p, headers=vendor["headers"])
        assert r.status_code == 403, f"GET {p}: {r.status_code} {r.text}"
    r = await client.post(WF, json={"entity_type": "purchase_order", "entity_id": "1"},
                          headers=vendor["headers"])
    assert r.status_code == 403, r.text
    r = await client.post(f"{WF}/1/action", json={"action": "approve"},
                          headers=vendor["headers"])
    assert r.status_code == 403, r.text


async def test_workflow_create_viewer_write_403(client, viewer):
    """RBAC: viewer POST /workflows (ghi) → 403 (VIEWER_READ_ONLY)."""
    r = await client.post(WF, json={"entity_type": "purchase_order", "entity_id": "1"},
                          headers=viewer["headers"])
    assert r.status_code == 403, r.text


async def test_workflow_create_missing_fields_422(client, manager):
    """POST /workflows thiếu entity_type/entity_id (required) → 422 (Pydantic)."""
    r = await client.post(WF, json={"amount": 1000}, headers=manager["headers"])
    assert r.status_code == 422, r.text


async def test_workflow_action_missing_action_422(client, manager):
    """POST /workflows/{id}/action thiếu action (required) → 422 (Pydantic)."""
    r = await client.post(f"{WF}/1/action", json={"comment": "ok"},
                          headers=manager["headers"])
    assert r.status_code == 422, r.text


async def test_workflows_list_limit_cap_422(client, manager):
    """GET /workflows?limit=201 vượt cap le=200 → 422 (validate query trước handler)."""
    r = await client.get(f"{WF}?limit=201", headers=manager["headers"])
    assert r.status_code == 422, r.text


# ── DRIFT-WF (RESOLVED): code nay khop schema prod (current_status / workflow_type /
#    ref_type / ref_id / data jsonb; workflow_history.instance_id/actor_id/from_status/
#    to_status; enum workflow_status khong co 'closed' -> 'cancelled'). Cac test duoi
#    chay THAT + phai XANH.
async def test_workflow_create_expected_201(client, manager):
    """MONG ĐỢI: tạo workflow → 201, trạng thái khởi tạo 'draft'."""
    r = await client.post(
        WF,
        json={"entity_type": "purchase_order", "entity_id": "1",
              "amount": 1_000_000, "title": "Demo duyệt"},
        headers=manager["headers"],
    )
    assert r.status_code == 201, r.text
    assert r.json()["data"]["current_status"] == "draft"


async def test_workflow_list_status_filter_not_500(client, manager):
    """MONG ĐỢI (khoá bug): GET /workflows?status=pending_l1 → KHÔNG 500."""
    r = await client.get(f"{WF}?status=pending_l1", headers=manager["headers"])
    assert r.status_code != 500, r.text
    assert r.status_code == 200, r.text


async def test_workflow_pending_me_not_500(client, manager):
    """MONG ĐỢI: GET /workflows/pending/me → 200, shape {items, total}."""
    r = await client.get(f"{WF}/pending/me", headers=manager["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert "items" in data and "total" in data


async def test_workflow_approve_flow_and_escalation_l2(client, manager, admin):
    """MONG ĐỢI (verify fix): submit → approve.

    * amount < 50tr: manager approve L1 → 'approved' ngay.
    * amount ≥ 50tr: manager approve L1 → escalate 'pending_l2' (chờ admin).
    * action lần 2 trên workflow đã quyết → 400 (chuyển trạng thái không hợp lệ).
    """
    # (1) Nhỏ hơn ngưỡng → approve thẳng.
    r = await client.post(
        WF, json={"entity_type": "purchase_order", "entity_id": "1",
                  "amount": 1_000_000, "title": "Nhỏ"},
        headers=manager["headers"])
    assert r.status_code == 201, r.text
    wid = str(r.json()["data"]["id"])
    # draft → submit → pending_l1
    rs = await client.post(f"{WF}/{wid}/action", json={"action": "submit"},
                           headers=manager["headers"])
    assert rs.status_code == 200, rs.text
    ra = await client.post(f"{WF}/{wid}/action", json={"action": "approve"},
                           headers=manager["headers"])
    assert ra.status_code == 200, ra.text
    assert ra.json()["data"]["current_status"] == "approved"
    # action lần 2 (đã 'approved') → 400.
    ra2 = await client.post(f"{WF}/{wid}/action", json={"action": "approve"},
                            headers=manager["headers"])
    assert ra2.status_code == 400, ra2.text

    # (2) ≥ ngưỡng 50tr → approve L1 chỉ escalate lên pending_l2.
    r2 = await client.post(
        WF, json={"entity_type": "purchase_order", "entity_id": "2",
                  "amount": 60_000_000, "title": "Lớn"},
        headers=manager["headers"])
    assert r2.status_code == 201, r2.text
    wid2 = str(r2.json()["data"]["id"])
    await client.post(f"{WF}/{wid2}/action", json={"action": "submit"},
                      headers=manager["headers"])
    rb = await client.post(f"{WF}/{wid2}/action", json={"action": "approve"},
                           headers=manager["headers"])
    assert rb.status_code == 200, rb.text
    assert rb.json()["data"]["current_status"] == "pending_l2"


async def test_workflow_approve_by_other_user_notifies_creator(client, db, manager, admin):
    """KHOÁ BUG (03/07 — cụm notification): duyệt bởi người KHÁC người tạo → _notify()
    fire BÊN TRONG transaction của execute_action.

    Trước fix: _notify INSERT cột `notifications.link` (không tồn tại) + type
    'workflow_update' (không có trong enum) ⇒ raise ⇒ rollback + 500 CẢ luồng duyệt
    mỗi khi acted_by != created_by (ca maker-checker thường gặp). Test cũ dùng cùng
    một user tạo+duyệt nên _notify bị skip (dòng `if created_by != acted_by`), bỏ lọt.

    Sau fix (m42 thêm enum + link→metadata jsonb): approve → 200 và tạo 1 notification
    'workflow_update' cho người tạo, link nằm trong metadata->>'link'.
    """
    # manager TẠO + submit → pending_l1 (amount < 50tr)
    r = await client.post(
        WF, json={"entity_type": "purchase_order", "entity_id": "77",
                  "amount": 1_000_000, "title": "Duyệt bởi người khác"},
        headers=manager["headers"])
    assert r.status_code == 201, r.text
    wid = str(r.json()["data"]["id"])
    rs = await client.post(f"{WF}/{wid}/action", json={"action": "submit"},
                           headers=manager["headers"])
    assert rs.status_code == 200, rs.text

    # admin (KHÁC người tạo) approve L1 → 'approved' NGAY (amount < ngưỡng).
    # Đây là bước trước-fix ném 500; giờ phải 200.
    ra = await client.post(f"{WF}/{wid}/action", json={"action": "approve"},
                           headers=admin["headers"])
    assert ra.status_code == 200, ra.text
    assert ra.json()["data"]["current_status"] == "approved"

    # _notify đã tạo notification 'workflow_update' cho NGƯỜI TẠO (manager),
    # link điều hướng nằm trong metadata jsonb (không phải cột 'link').
    row = await db.fetchrow(
        """
        SELECT type::text AS ntype, metadata->>'link' AS link
        FROM notifications
        WHERE recipient_id = $1::uuid AND type = 'workflow_update'
        ORDER BY id DESC LIMIT 1
        """,
        manager["id"],
    )
    assert row is not None, "Thiếu notification 'workflow_update' cho người tạo"
    assert row["link"] == f"/workflows/{wid}", row["link"]


# ════════════════════════════════════════════════════════════════════════════
# D) ORDERS UNIFIED — /api/v1/orders/unified  (view v_unified_orders)
# ════════════════════════════════════════════════════════════════════════════

async def test_orders_unified_shape_empty(client, manager):
    """GET /orders/unified → 200, shape {data: list, total: int}."""
    r = await client.get(f"{ORD}/unified", headers=manager["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["data"], list)
    assert isinstance(body["total"], int)


async def test_orders_unified_seeded_row_appears(client, manager, db):
    """Seed 1 sourcing_order → xuất hiện trong view; search theo order_number khớp,
    trường ánh xạ đúng (order_ref = order_number, source_type, order_status)."""
    so = await _seed_sourcing_order(db, source_type="sourcing", status="quoted")
    r = await client.get(f"{ORD}/unified", headers=manager["headers"],
                         params={"search": so["order_number"]})
    assert r.status_code == 200, r.text
    rows = r.json()["data"]
    match = [x for x in rows if x["order_ref"] == so["order_number"]]
    assert len(match) == 1, rows
    assert match[0]["source_type"] == "sourcing"
    assert match[0]["order_status"] == "quoted"
    assert match[0]["ar_state"] == "none"   # chưa có công nợ


async def test_orders_unified_filter_source_type(client, manager, db):
    """Filter source_type=bqms_po chỉ trả đơn có source_type đó."""
    a = await _seed_sourcing_order(db, source_type="sourcing")
    b = await _seed_sourcing_order(db, source_type="bqms_po")
    r = await client.get(f"{ORD}/unified", headers=manager["headers"],
                         params={"source_type": "bqms_po", "limit": 200})
    assert r.status_code == 200, r.text
    refs = {x["order_ref"] for x in r.json()["data"]}
    assert b["order_number"] in refs
    assert a["order_number"] not in refs


async def test_orders_unified_limit_cap_422(client, manager):
    """limit=201 vượt cap le=200 → 422."""
    r = await client.get(f"{ORD}/unified?limit=201", headers=manager["headers"])
    assert r.status_code == 422, r.text


async def test_orders_unified_accountant_ok(client, accountant):
    """RBAC: accountant NẰM trong allowed_roles → 200."""
    r = await client.get(f"{ORD}/unified", headers=accountant["headers"])
    assert r.status_code == 200, r.text


async def test_orders_unified_viewer_ok(client, viewer):
    """RBAC: viewer GET → 200 (read-only bypass)."""
    r = await client.get(f"{ORD}/unified", headers=viewer["headers"])
    assert r.status_code == 200, r.text


async def test_orders_unified_staff_forbidden_403(client, staff):
    """RBAC: staff KHÔNG thuộc {sales,accountant,manager,admin}, không phải viewer → 403."""
    r = await client.get(f"{ORD}/unified", headers=staff["headers"])
    assert r.status_code == 403, r.text


async def test_orders_unified_vendor_forbidden_403(client, vendor):
    """RBAC: vendor → 403."""
    r = await client.get(f"{ORD}/unified", headers=vendor["headers"])
    assert r.status_code == 403, r.text
