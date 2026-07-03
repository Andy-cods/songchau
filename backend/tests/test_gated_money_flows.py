"""W3-06 / W3-00 — CỤM LUỒNG TIỀN GATED (auto-AR / auto-AP / maker-checker AWARD).

Ba luồng tiền được BUILD SẴN nhưng GATE mặc-định-TẮT qua app_config. Bộ test này
CHỨNG MINH gate hoạt động đúng theo cả 2 chiều + KHÓA phần hardening W3-06
("hook lỗi phải notify, không nuốt"):

  auto-AR (payment_requests.approve_payment_request)
    * cờ OFF (mặc định) → duyệt đề xuất TT KHÔNG tạo accounts_receivable.
    * cờ ON             → duyệt → CÓ AR đúng số (= total_value_vnd).
    * cờ ON + hook LỖI  → duyệt vẫn 200, KHÔNG có AR (savepoint rollback), NHƯNG
                          admin nhận notification (KHÔNG nuốt lỗi) — MUTATION-CHECK
                          cho hardening: gỡ notify → test này FAIL.

  auto-AP (procurement.update_delivery_status)
    * cờ OFF → giao hàng 'received' KHÔNG tạo accounts_payable.
    * cờ ON  → giao hàng 'received' → CÓ AP đúng số (= Σ delivered_qty*unit_price).
    * cờ ON + hook LỖI → receipt vẫn 200 + admin nhận notification.

  maker-checker AWARD (procurement.award / approve-award)
    * cờ ON (ngưỡng 0): người ĐỀ XUẤT tự DUYỆT → 403 (SoD); NGƯỜI THỨ HAI duyệt →
      200 + batch 'awarded' + audit row 'award_approved'.

⚠️ Test bật cờ CHỈ trong transaction rollback của fixture `db` (conftest) — KHÔNG
   chạm prod. Không có cờ nào bị set true ngoài phạm vi test.

Chạy in-process qua ASGITransport (xem conftest). Mọi ghi nằm trong transaction
của fixture `db` → ROLLBACK, không rác. Cần full prod schema snapshot.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

pytestmark = pytest.mark.integration

PR = "/api/v1/payment-requests"
PROC = "/api/v1/procurement"


# ── Guard: chỉ chạy khi có full prod schema snapshot (mọi bảng tài chính/đấu
#    thầu chỉ tồn tại ở snapshot, không có ở bootstrap tối thiểu). Mirror
#    test_finance/test_bidding. ────────────────────────────────────────────────
@pytest_asyncio.fixture(autouse=True)
async def _require_full_schema(request, schema_info):
    if request.node.get_closest_marker("integration") and not schema_info["full_schema"]:
        pytest.skip(
            "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
            "(pg_dump --schema-only). Schema đang nạp: " + schema_info["source"]
        )


def _uniq(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


# ════════════════════════════════════════════════════════════════════════════
# Seed helpers (dùng `db` — cùng connection app request, rollback sau test).
# ════════════════════════════════════════════════════════════════════════════

async def _set_bool_flag(db, key: str, value: bool) -> None:
    """app_config(key,value jsonb) — set/UPSERT 1 cờ bool. CHỈ trong tx test."""
    await db.execute(
        "INSERT INTO app_config (key, value) VALUES ($1, to_jsonb($2::bool)) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        key, value,
    )


async def _set_num_flag(db, key: str, value) -> None:
    await db.execute(
        "INSERT INTO app_config (key, value) VALUES ($1, to_jsonb($2::numeric)) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        key, value,
    )


async def _seed_customer(db, *, name="KH Test AR") -> int:
    return await db.fetchval(
        "INSERT INTO customers (customer_code, company_name) VALUES ($1, $2) RETURNING id",
        _uniq("CUS"), name,
    )


async def _seed_supplier(db, created_by, *, name=None) -> int:
    return await db.fetchval(
        "INSERT INTO suppliers (name, created_by) VALUES ($1, $2::uuid) RETURNING id",
        name or _uniq("NCC"), created_by,
    )


async def _seed_sourcing_order(
    db, *, customer_id, total_vnd, status="payment_requested",
    payment_terms="Net 30", currency="VND",
) -> int:
    """sourcing_orders: order_number/customer_name NOT NULL; total_value_vnd,
    status, currency có DEFAULT nhưng ta set tường minh. customer_id cần cho AR."""
    return await db.fetchval(
        """
        INSERT INTO sourcing_orders
            (order_number, customer_id, customer_name, total_value_vnd,
             currency, status, payment_terms, order_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE)
        RETURNING id
        """,
        _uniq("SO"), customer_id, "KH Test AR", total_vnd, currency,
        status, payment_terms,
    )


async def _seed_payment_request(
    db, *, requester_id, sourcing_order_id, amount, status="pending",
) -> int:
    """payment_requests: requester_id/request_date/description/amount NOT NULL."""
    return await db.fetchval(
        """
        INSERT INTO payment_requests
            (requester_id, request_date, description, amount, status,
             sourcing_order_id)
        VALUES ($1::uuid, CURRENT_DATE, $2, $3, $4, $5)
        RETURNING id
        """,
        requester_id, "Đề xuất TT test", amount, status, sourcing_order_id,
    )


# ── auto-AP world ────────────────────────────────────────────────────────────
async def _seed_vendor_account(db, user_id, *, supplier_id=None) -> int:
    return await db.fetchval(
        """
        INSERT INTO vendor_accounts (user_id, supplier_id, company_name,
                                     contact_name, is_approved, status)
        VALUES ($1, $2, $3, 'Người LH', true, 'active')
        RETURNING id
        """,
        user_id, supplier_id, _uniq("NCC"),
    )


async def _seed_po(db, created_by, *, vendor_id=None, currency="VND", total=1_000_000) -> int:
    return await db.fetchval(
        """
        INSERT INTO procurement_pos
            (po_no, vendor_id, vendor_name, total_amount, currency, created_by)
        VALUES ($1, $2, 'NCC test', $3, $4, $5::uuid)
        RETURNING id
        """,
        _uniq("PO"), vendor_id, total, currency, created_by,
    )


async def _seed_po_item(db, po_id, *, ordered_qty=10, unit_price=100_000) -> int:
    return await db.fetchval(
        """
        INSERT INTO procurement_po_items
            (po_id, item_no, specification, ordered_qty, unit_price)
        VALUES ($1, 1, 'Bạc lót SUS304', $2, $3)
        RETURNING id
        """,
        po_id, ordered_qty, unit_price,
    )


async def _seed_delivery(db, po_id, created_by, *, vendor_id=None, status="arrived") -> int:
    return await db.fetchval(
        """
        INSERT INTO procurement_deliveries
            (delivery_no, po_id, vendor_id, status, created_by)
        VALUES ($1, $2, $3, $4, $5::uuid)
        RETURNING id
        """,
        _uniq("DLV"), po_id, vendor_id, status, created_by,
    )


async def _seed_delivery_item(db, delivery_id, po_item_id, *, delivered_qty=10) -> int:
    return await db.fetchval(
        """
        INSERT INTO procurement_delivery_items
            (delivery_id, po_item_id, delivered_qty)
        VALUES ($1, $2, $3)
        RETURNING id
        """,
        delivery_id, po_item_id, delivered_qty,
    )


# ── bidding world (award maker-checker) — tối giản từ test_bidding ────────────
async def _seed_awardable(db, creator, vendor_id, *, unit_price=1000, qty=10):
    """Đợt PUBLISHED + 1 item + lời mời + 1 báo giá SUBMITTED. Trả (batch, item)."""
    bid = await db.fetchval(
        """
        INSERT INTO procurement_rfq_batches
            (batch_code, title, status, award_mode, created_by, item_count,
             current_round, sealed_until_deadline, award_status, visibility,
             published_at)
        VALUES ($1, 'Đợt test', 'published', 'per_item', $2, 1, 1, false,
                'none', 'invited', NOW())
        RETURNING id
        """,
        _uniq("BID"), creator,
    )
    iid = await db.fetchval(
        """
        INSERT INTO procurement_rfq_items
            (batch_id, item_no, specification, quantity, unit, source_kind,
             product_name)
        VALUES ($1, 1, 'Bạc lót', $2, 'EA', 'manual', 'Sản phẩm')
        RETURNING id
        """,
        bid, qty,
    )
    await db.execute(
        "INSERT INTO procurement_rfq_invitations "
        "(batch_id, vendor_id, round_number, status, invited_by) "
        "VALUES ($1, $2, 1, 'invited', $3)",
        bid, vendor_id, creator,
    )
    qid = await db.fetchval(
        """
        INSERT INTO vendor_quotes
            (batch_id, vendor_id, currency, total_amount, status, round_number,
             submitted_at)
        VALUES ($1, $2, 'VND', $3, 'submitted', 1, NOW())
        RETURNING id
        """,
        bid, vendor_id, unit_price * qty,
    )
    await db.execute(
        "INSERT INTO vendor_quote_items "
        "(quote_id, item_id, unit_price, quantity, offered_qty, currency) "
        "VALUES ($1, $2, $3, $4, $4, 'VND')",
        qid, iid, unit_price, qty,
    )
    return bid, iid


# ════════════════════════════════════════════════════════════════════════════
# 1) AUTO-AR — cờ phase3_auto_ar_enabled (payment_requests.approve)
# ════════════════════════════════════════════════════════════════════════════

async def test_auto_ar_off_default_no_receivable(client, accountant, db):
    """Cờ OFF (mặc định, không seed app_config) → duyệt đề xuất TT → 200 nhưng
    KHÔNG tạo accounts_receivable. Đây là hành vi prod hiện tại (gate TẮT)."""
    cust = await _seed_customer(db)
    so = await _seed_sourcing_order(db, customer_id=cust, total_vnd=5_000_000)
    pr = await _seed_payment_request(
        db, requester_id=accountant["id"], sourcing_order_id=so, amount=5_000_000)

    r = await client.post(f"{PR}/{pr}/approve", json={"note": "duyệt"},
                          headers=accountant["headers"])
    assert r.status_code == 200, r.text

    n = await db.fetchval(
        "SELECT COUNT(*) FROM accounts_receivable WHERE sourcing_order_id = $1", so)
    assert n == 0, "gate OFF mà vẫn tạo AR — side-effect rò rỉ!"


async def test_auto_ar_on_creates_receivable(client, accountant, db):
    """Cờ ON (app_config) → duyệt → tạo ĐÚNG 1 AR: amount = total_value_vnd,
    customer_id khớp, status 'pending'. Chứng minh luồng auto-AR khi Thang bật."""
    await _set_bool_flag(db, "phase3_auto_ar_enabled", True)
    cust = await _seed_customer(db)
    so = await _seed_sourcing_order(db, customer_id=cust, total_vnd=7_500_000)
    pr = await _seed_payment_request(
        db, requester_id=accountant["id"], sourcing_order_id=so, amount=7_500_000)

    r = await client.post(f"{PR}/{pr}/approve", json={}, headers=accountant["headers"])
    assert r.status_code == 200, r.text

    ar = await db.fetchrow(
        "SELECT amount, customer_id, status, payment_request_id "
        "FROM accounts_receivable WHERE sourcing_order_id = $1", so)
    assert ar is not None, "gate ON mà không tạo AR"
    assert float(ar["amount"]) == 7_500_000.0
    assert ar["customer_id"] == cust
    assert str(ar["status"]) == "pending"
    assert ar["payment_request_id"] == pr


async def test_auto_ar_hook_failure_notifies_admin(client, accountant, admin, db, monkeypatch):
    """HARDENING W3-06 — cờ ON nhưng hook auto-AR NÉM LỖI: duyệt VẪN 200 (savepoint
    cô lập), KHÔNG có AR (rollback), NHƯNG admin NHẬN notification (không nuốt lỗi).

    MUTATION-CHECK: nếu ai gỡ `notify_admins_hook_failure` khỏi except-block, số
    notification = 0 ⇒ test FAIL.
    """
    from app.services import chain_service

    async def _boom(*a, **k):
        raise RuntimeError("AR insert nổ (mô phỏng)")

    monkeypatch.setattr(chain_service, "ensure_ar_for_order", _boom)

    await _set_bool_flag(db, "phase3_auto_ar_enabled", True)
    cust = await _seed_customer(db)
    so = await _seed_sourcing_order(db, customer_id=cust, total_vnd=9_000_000)
    pr = await _seed_payment_request(
        db, requester_id=accountant["id"], sourcing_order_id=so, amount=9_000_000)

    r = await client.post(f"{PR}/{pr}/approve", json={}, headers=accountant["headers"])
    assert r.status_code == 200, r.text  # duyệt KHÔNG bị hook làm hỏng

    n_ar = await db.fetchval(
        "SELECT COUNT(*) FROM accounts_receivable WHERE sourcing_order_id = $1", so)
    assert n_ar == 0, "hook lỗi mà vẫn có AR — savepoint không rollback đúng"

    n_notif = await db.fetchval(
        "SELECT COUNT(*) FROM notifications "
        "WHERE recipient_id = $1::uuid AND type = 'workflow_update' "
        "  AND ref_type = 'payment_request' AND ref_id = $2",
        admin["id"], pr,
    )
    assert n_notif >= 1, "hook auto-AR lỗi mà KHÔNG notify admin — đang NUỐT lỗi!"


# ════════════════════════════════════════════════════════════════════════════
# 2) AUTO-AP — cờ procurement_auto_ap_enabled (procurement.update_delivery_status)
# ════════════════════════════════════════════════════════════════════════════

async def test_auto_ap_off_default_no_payable(client, admin, db):
    """Cờ OFF (mặc định) → giao hàng chuyển 'received' → 200 nhưng KHÔNG tạo AP."""
    po = await _seed_po(db, admin["id"])
    dlv = await _seed_delivery(db, po, admin["id"], status="arrived")

    r = await client.put(f"{PROC}/deliveries/{dlv}/status",
                         json={"status": "received"}, headers=admin["headers"])
    assert r.status_code == 200, r.text

    n = await db.fetchval(
        "SELECT COUNT(*) FROM accounts_payable WHERE delivery_id = $1", dlv)
    assert n == 0, "gate OFF mà vẫn tạo AP — side-effect rò rỉ!"


async def test_auto_ap_on_creates_payable(client, admin, vendor, db):
    """Cờ ON → giao hàng 'received' → tạo ĐÚNG 1 AP: amount = Σ delivered_qty *
    unit_price, supplier_id khớp, status 'pending'."""
    await _set_bool_flag(db, "procurement_auto_ap_enabled", True)
    sup = await _seed_supplier(db, admin["id"])
    va = await _seed_vendor_account(db, vendor["id"], supplier_id=sup)
    po = await _seed_po(db, admin["id"], vendor_id=va, currency="VND")
    pit = await _seed_po_item(db, po, ordered_qty=10, unit_price=100_000)
    dlv = await _seed_delivery(db, po, admin["id"], vendor_id=va, status="arrived")
    await _seed_delivery_item(db, dlv, pit, delivered_qty=10)

    r = await client.put(f"{PROC}/deliveries/{dlv}/status",
                         json={"status": "received"}, headers=admin["headers"])
    assert r.status_code == 200, r.text

    ap = await db.fetchrow(
        "SELECT amount, supplier_id, status FROM accounts_payable WHERE delivery_id = $1",
        dlv)
    assert ap is not None, "gate ON mà không tạo AP"
    assert float(ap["amount"]) == 1_000_000.0  # 10 * 100.000
    assert ap["supplier_id"] == sup
    assert str(ap["status"]) == "pending"


async def test_auto_ap_hook_failure_notifies_admin(client, admin, db, monkeypatch):
    """HARDENING W3-06 — cờ ON nhưng hook auto-AP NÉM LỖI: receipt VẪN 200, KHÔNG
    có AP, NHƯNG admin nhận notification (không nuốt lỗi). MUTATION-CHECK."""
    from app.services import chain_service

    async def _boom(*a, **k):
        raise RuntimeError("AP insert nổ (mô phỏng)")

    monkeypatch.setattr(chain_service, "ensure_ap_for_procurement_delivery", _boom)

    await _set_bool_flag(db, "procurement_auto_ap_enabled", True)
    po = await _seed_po(db, admin["id"])
    dlv = await _seed_delivery(db, po, admin["id"], status="arrived")

    r = await client.put(f"{PROC}/deliveries/{dlv}/status",
                         json={"status": "received"}, headers=admin["headers"])
    assert r.status_code == 200, r.text

    n_ap = await db.fetchval(
        "SELECT COUNT(*) FROM accounts_payable WHERE delivery_id = $1", dlv)
    assert n_ap == 0

    n_notif = await db.fetchval(
        "SELECT COUNT(*) FROM notifications "
        "WHERE recipient_id = $1::uuid AND type = 'workflow_update' "
        "  AND ref_type = 'procurement_delivery' AND ref_id = $2",
        admin["id"], dlv,
    )
    assert n_notif >= 1, "hook auto-AP lỗi mà KHÔNG notify admin — đang NUỐT lỗi!"


# ════════════════════════════════════════════════════════════════════════════
# 3) MAKER-CHECKER AWARD — SoD: proposer ≠ checker (procurement.approve-award)
# ════════════════════════════════════════════════════════════════════════════

async def test_maker_checker_self_approve_403_then_other_approves(
    client, manager, admin, vendor, db,
):
    """Cờ ON (ngưỡng 0): manager ĐỀ XUẤT chốt thầu → treo 'proposed'; manager tự
    DUYỆT → 403 (SoD); admin (khác) duyệt → 200 + batch 'awarded' + audit row
    'award_approved' ghi lại proposer/approver."""
    await _set_bool_flag(db, "procurement_award_approval_enabled", True)
    await _set_num_flag(db, "procurement_award_approval_threshold_vnd", 0)
    va = await _seed_vendor_account(db, vendor["id"])
    bid, iid = await _seed_awardable(db, manager["id"], va, unit_price=1000, qty=10)

    # manager đề xuất → treo proposed
    rp = await client.post(f"{PROC}/batches/{bid}/award",
                           json={"awards": [{"item_id": iid, "vendor_id": va}],
                                 "award_reason": "Giá thấp nhất"},
                           headers=manager["headers"])
    assert rp.status_code == 200, rp.text
    assert rp.json()["data"]["award_status"] == "proposed"

    # manager tự duyệt đề xuất mình → 403 (SoD, breakglass OFF)
    rself = await client.post(f"{PROC}/batches/{bid}/approve-award",
                              headers=manager["headers"])
    assert rself.status_code == 403, rself.text
    aw = await db.fetchval(
        "SELECT award_status FROM procurement_rfq_batches WHERE id = $1", bid)
    assert aw == "proposed", "tự duyệt bị chặn nhưng trạng thái đã đổi — SAI"

    # admin (người thứ hai) duyệt → chốt
    rok = await client.post(f"{PROC}/batches/{bid}/approve-award",
                            headers=admin["headers"])
    assert rok.status_code == 200, rok.text
    row = await db.fetchrow(
        "SELECT status, award_status FROM procurement_rfq_batches WHERE id = $1", bid)
    assert row["status"] == "awarded" and row["award_status"] == "approved"

    # audit row 'award_approved' phải tồn tại (lưu vết ai duyệt)
    n_audit = await db.fetchval(
        "SELECT COUNT(*) FROM procurement_audit_log "
        "WHERE entity_type = 'batch' AND entity_id = $1 AND action = 'award_approved'",
        bid,
    )
    assert n_audit >= 1, "duyệt award mà KHÔNG ghi audit — mất dấu vết compliance"
