"""W1-06 — CỤM CRM (Khách hàng + Pipeline + Deal-chain margin).

Phủ tự động các luồng CRM nội bộ (`app/api/v1/crm.py`, `crm_pipeline.py`,
`deal_chain.py`) theo bộ ca `plans/e2e-master/KHACH-HANG.md` — chỉ các ca
[AUTO-API] (pytest gọi REST in-process qua fixture `client`, assert response/DB,
rollback sau mỗi test).

Chạy in-process qua ASGITransport (xem conftest). Mọi ghi dữ liệu nằm trong
transaction của fixture `db` và bị ROLLBACK — không rác prod.

────────────────────────────────────────────────────────────────────────────
GHI CHÚ QUAN TRỌNG — bám CODE THỰC, không bám plan cũ
────────────────────────────────────────────────────────────────────────────
KHACH-HANG.md được viết KHI 2 bug còn tồn tại; code hiện tại ĐÃ SỬA cả hai, nên
các assert dưới đây khoá HÀNH VI ĐÚNG (đã fix), KHÁC kỳ vọng "FAIL" trong plan:

  * W0-03 (interaction_type): `InteractionCreateRequest.interaction_type` nay là
    Literal ĐỦ 9 giá trị (email/call/meeting/visit/other/zalo/note/demo/support)
    và bảng `crm_interactions` có CHECK khớp đúng 9 giá trị đó. → cả 9 giá trị
    PHẢI 201 (không còn 422 cho zalo/note/demo/support như TC-045..049 mô tả).

  * W0-15 (margin thiếu tỷ giá): `deal_chain.get_chain_margin` KHÔNG còn bịa
    hằng 25450. Khi `exchange_rates` rỗng và có freight USD>0 → `rate_missing=true`,
    `freight_vnd=null`, `gross_profit_vnd/margin_pct=null`. → test khẳng định
    KHÔNG có số 25450 trong response (khác TC-113 cũ).

RBAC (bám `app/core/rbac.py`): `require_role(..., allow_viewer=True)` (mặc định)
cho VIEWER đọc (GET) mọi endpoint (read-only toàn hệ). Vì thế các GET của CRM
KHÔNG chặn viewer (viewer GET → 200), chỉ chặn viewer ở method ghi và chặn
vendor mọi method. → test khẳng định hành vi thực này (khác TC-119 cũ vốn kỳ
vọng viewer 403 trên GET).
"""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
import pytest_asyncio

pytestmark = pytest.mark.integration

CRM = "/api/v1/crm"
CHAINS = "/api/v1/chains"
PIPE = "/api/v1/crm/pipeline"

# 9 giá trị interaction_type hợp lệ — KHỚP CHÍNH XÁC Literal ở crm.py +
# CONSTRAINT crm_interactions_interaction_type_check trong _schema_snapshot.sql.
INTERACTION_TYPES_9 = [
    "email", "call", "meeting", "visit", "other",
    "zalo", "note", "demo", "support",
]


# ── Guard: chỉ chạy khi có full prod schema (snapshot). Bootstrap schema tối
#    thiểu không có bảng customers/crm_* → auto-skip thay vì lỗi khó hiểu.
#    QUAN TRỌNG: fixture ASYNC + function-scope, nhận `schema_info` như DEPENDENCY
#    khai báo (KHÔNG dùng request.getfixturevalue trên fixture async — pattern đó
#    ép pytest-asyncio chạy run_until_complete trong loop đang chạy → RuntimeError
#    "This event loop is already running"). Mirror cách `db` phụ thuộc schema_info
#    trong conftest: mọi thứ chạy trên đúng 1 loop/test. ────────────────────────
@pytest_asyncio.fixture(autouse=True)
async def _require_full_schema(request, schema_info):
    if request.node.get_closest_marker("integration") and not schema_info["full_schema"]:
        pytest.skip(
            "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
            "(pg_dump --schema-only). Schema đang nạp: " + schema_info["source"]
        )


def _num(x):
    """Chuẩn hoá số JSON (Decimal-as-str/int/float) về float để so sánh."""
    return None if x is None else float(x)


def _uniq(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


# ── Seed helpers (dùng `db` — cùng connection app request, rollback sau test) ──
async def _seed_customer(
    db,
    *,
    company_name="DEMO KH",
    code=None,
    tax_code=None,
    owner_id=None,
    is_active=True,
    customer_type=None,
) -> dict:
    code = code or _uniq("DEMO-CUS")
    row = await db.fetchrow(
        """
        INSERT INTO customers
            (customer_code, company_name, tax_code, owner_id, is_active, customer_type)
        VALUES ($1, $2, $3, $4::uuid, $5, $6)
        RETURNING id, customer_code, company_name, tax_code, owner_id, customer_type
        """,
        code, company_name, tax_code, owner_id, is_active, customer_type,
    )
    return dict(row)


async def _seed_contact(db, customer_id, *, full_name="LH Chính", is_primary=False) -> int:
    return await db.fetchval(
        """
        INSERT INTO crm_contacts (customer_id, full_name, is_primary)
        VALUES ($1, $2, $3) RETURNING id
        """,
        customer_id, full_name, is_primary,
    )


async def _seed_interaction(
    db, customer_id, created_by, *, itype="call", subject="Ghi chú",
    follow_up_date=None, contact_id=None,
) -> int:
    return await db.fetchval(
        """
        INSERT INTO crm_interactions
            (customer_id, contact_id, interaction_type, subject, created_by, follow_up_date)
        VALUES ($1, $2, $3, $4, $5::uuid, $6) RETURNING id
        """,
        customer_id, contact_id, itype, subject, created_by, follow_up_date,
    )


async def _seed_card(
    db, *, stage="new", title="Card DEMO", priority="normal",
    is_archived=False, customer_id=None, follow_up_date=None,
) -> int:
    return await db.fetchval(
        """
        INSERT INTO crm_pipeline_cards
            (stage, title, priority, is_archived, customer_id, follow_up_date)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        """,
        stage, title, priority, is_archived, customer_id, follow_up_date,
    )


async def _seed_chain(
    db, creator_uuid, *, revenue_vnd=100_000_000, freight_usd=1000,
    customs_vnd=2_000_000, other_vnd=1_000_000, po_total_vnd=50_000_000,
    with_rate=True, usd_rate=25_000,
) -> dict:
    """Seed 1 chuỗi doanh thu đủ để tính margin: PO (COGS) + Shipment (freight/
    customs/other) + Invoice (revenue) + revenue_chain trỏ tới cả 3.

    Với with_rate=True: cài tỷ giá USD→VND = usd_rate. Với False: XOÁ sạch
    exchange_rates để ép nhánh rate_missing (khoá W0-15).
    """
    supplier_id = await db.fetchval(
        "INSERT INTO suppliers (name, created_by) VALUES ($1, $2::uuid) RETURNING id",
        _uniq("DEMO NCC"), creator_uuid,
    )
    cust = await _seed_customer(db, company_name="DEMO KH Chuỗi")

    po_id = await db.fetchval(
        """
        INSERT INTO purchase_orders
            (po_number, supplier_id, total_amount, exchange_rate, created_by, status)
        VALUES ($1, $2, $3, 1, $4::uuid, 'draft')
        RETURNING id
        """,
        _uniq("PO"), supplier_id, po_total_vnd, creator_uuid,
    )
    sh_id = await db.fetchval(
        """
        INSERT INTO shipments
            (shipment_number, po_id, supplier_id, freight_cost_usd,
             customs_duty_vnd, other_costs_vnd, created_by, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, 'pending')
        RETURNING id
        """,
        _uniq("SH"), po_id, supplier_id, freight_usd, customs_vnd, other_vnd, creator_uuid,
    )
    inv_id = await db.fetchval(
        """
        INSERT INTO invoices
            (invoice_number, customer_id, due_date, currency, total_amount,
             created_by, status)
        VALUES ($1, $2, (CURRENT_DATE + 30), 'VND', $3, $4::uuid, 'sent')
        RETURNING id
        """,
        _uniq("INV"), cust["id"], revenue_vnd, creator_uuid,
    )
    chain_code = _uniq("CHAIN")
    await db.execute(
        """
        INSERT INTO revenue_chain
            (chain_code, po_id, shipment_id, invoice_id, current_stage)
        VALUES ($1, $2, $3, $4, 'invoice')
        """,
        chain_code, po_id, sh_id, inv_id,
    )

    # Tỷ giá: hoặc cài đúng 1 dòng, hoặc xoá sạch để test rate_missing.
    await db.execute("DELETE FROM exchange_rates WHERE from_currency='USD' AND to_currency='VND'")
    if with_rate:
        await db.execute(
            """
            INSERT INTO exchange_rates (rate_date, from_currency, to_currency, rate, rate_type)
            VALUES (CURRENT_DATE, 'USD', 'VND', $1, 'transfer')
            """,
            usd_rate,
        )
    return {"chain_code": chain_code, "po_id": po_id, "shipment_id": sh_id,
            "invoice_id": inv_id, "customer_id": cust["id"]}


@pytest_asyncio.fixture
async def customer(db):
    return await _seed_customer(db, company_name="DEMO KH Chính")


# ════════════════════════════════════════════════════════════════════════════
# 1) TẠO KHÁCH HÀNG + DUPLICATE-CHECK
# ════════════════════════════════════════════════════════════════════════════

async def test_create_customer_success_creates_contact_and_pipeline_card(client, manager, db):
    """TC-019: tạo KH hợp lệ (manager) → 201, tự tạo contact chính + pipeline card 'new'."""
    code = _uniq("DEMO-NEW")
    body = {
        "customer_code": code,
        "company_name": "DEMO Công Ty Mới",
        "customer_type": "samsung_vendor",
        "contact_name": "Nguyễn Văn A",
        "contact_role": "Mua hàng",
        "industry": "electronics",
        "email": "a.nguyen@democrm.vn",
        "phone": "0900123456",
        "lead_source": "cold_call",
    }
    r = await client.post(f"{CRM}/customers", json=body, headers=manager["headers"])
    assert r.status_code == 201, r.text
    cid = r.json()["data"]["id"]
    assert r.json()["data"]["customer_code"] == code

    # Contact chính tự tạo từ email/phone/contact_name.
    contact = await db.fetchrow(
        "SELECT full_name, email, phone, is_primary FROM crm_contacts "
        "WHERE customer_id=$1 AND is_primary=true", cid,
    )
    assert contact is not None
    assert contact["full_name"] == "Nguyễn Văn A"
    assert contact["email"] == "a.nguyen@democrm.vn"

    # Pipeline card tự tạo ở stage 'new'.
    card = await db.fetchrow(
        "SELECT stage, priority FROM crm_pipeline_cards WHERE customer_id=$1", cid,
    )
    assert card is not None
    assert card["stage"] == "new"
    assert card["priority"] == "normal"  # lead_source != samsung_referral


async def test_create_customer_samsung_referral_priority_high(client, manager, db):
    """TC-021: lead_source=samsung_referral → pipeline card priority='high'."""
    code = _uniq("DEMO-REF")
    r = await client.post(
        f"{CRM}/customers",
        json={"customer_code": code, "company_name": "DEMO Ref",
              "lead_source": "samsung_referral"},
        headers=manager["headers"],
    )
    assert r.status_code == 201, r.text
    cid = r.json()["data"]["id"]
    priority = await db.fetchval(
        "SELECT priority FROM crm_pipeline_cards WHERE customer_id=$1", cid,
    )
    assert priority == "high"


async def test_create_customer_duplicate_code_409(client, manager, customer):
    """TC-020: customer_code trùng → 409."""
    r = await client.post(
        f"{CRM}/customers",
        json={"customer_code": customer["customer_code"], "company_name": "Khác Tên"},
        headers=manager["headers"],
    )
    assert r.status_code == 409, r.text


async def test_create_customer_staff_forbidden_403(client, staff):
    """TC-023: staff POST /customers → 403 (require_role manager/admin, chặn ở BE)."""
    r = await client.post(
        f"{CRM}/customers",
        json={"customer_code": _uniq("DEMO-STAFF"), "company_name": "DEMO Staff"},
        headers=staff["headers"],
    )
    assert r.status_code == 403, r.text


async def test_check_duplicate_by_tax_code_exact(client, staff, db):
    """TC-015: check-duplicate trùng tax_code chính xác → match KH đã seed."""
    tax = "0101" + uuid.uuid4().hex[:8]
    cust = await _seed_customer(db, company_name="DEMO KH MST", tax_code=tax)
    r = await client.post(
        f"{CRM}/customers/check-duplicate",
        json={"tax_code": tax}, headers=staff["headers"],
    )
    assert r.status_code == 200, r.text
    ids = [m["id"] for m in r.json()["matches"]]
    assert cust["id"] in ids


async def test_check_duplicate_by_company_name_unaccent(client, staff, db):
    """TC-016: check-duplicate theo company_name (ILIKE unaccent) → match."""
    name = "DEMO Công Ty Cổ Phần " + uuid.uuid4().hex[:6]
    cust = await _seed_customer(db, company_name=name)
    # bỏ dấu 1 phần: 'demo cong ty' phải khớp company_name_unaccent
    r = await client.post(
        f"{CRM}/customers/check-duplicate",
        json={"company_name": "demo cong ty"}, headers=staff["headers"],
    )
    assert r.status_code == 200, r.text
    ids = [m["id"] for m in r.json()["matches"]]
    assert cust["id"] in ids


async def test_check_duplicate_empty_body_returns_empty(client, staff):
    """Không truyền tiêu chí nào → {"matches": []} (không quét toàn bảng)."""
    r = await client.post(
        f"{CRM}/customers/check-duplicate", json={}, headers=staff["headers"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["matches"] == []


# ════════════════════════════════════════════════════════════════════════════
# 2) DANH SÁCH + PHÂN TRANG (khoá bug cap page_size=1000, fix 30/06)
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("page_size,expect", [(500, 200), (1000, 200), (1001, 422)])
async def test_list_customers_page_size_cap(client, manager, page_size, expect):
    """TC-010: page_size 500 & 1000 → 200 (bug cũ trả 422 ở 500 KHÔNG tái hiện);
    1001 vượt cap le=1000 → 422."""
    r = await client.get(
        f"{CRM}/customers?page_size={page_size}", headers=manager["headers"],
    )
    assert r.status_code == expect, r.text
    if expect == 200:
        assert r.json()["data"]["pagination"]["page_size"] == page_size


async def test_list_customers_returns_seeded_row(client, staff, customer):
    """TC-005: KH đã seed xuất hiện trong danh sách + shape pagination đúng."""
    r = await client.get(f"{CRM}/customers?page_size=1000", headers=staff["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    ids = [c["id"] for c in data["customers"]]
    assert customer["id"] in ids
    assert set(data["pagination"]) >= {"page", "page_size", "total", "total_pages"}


async def test_list_customers_owner_mine(client, manager, db):
    """TC-006: filter owner=mine → chỉ KH có owner_id = user hiện tại."""
    mine = await _seed_customer(db, company_name="DEMO Của Tôi", owner_id=manager["id"])
    other = await _seed_customer(db, company_name="DEMO Không Chủ")  # owner NULL
    r = await client.get(f"{CRM}/customers?owner=mine&page_size=1000", headers=manager["headers"])
    assert r.status_code == 200, r.text
    ids = [c["id"] for c in r.json()["data"]["customers"]]
    assert mine["id"] in ids
    assert other["id"] not in ids


async def test_list_customers_owner_specific_uuid(client, manager, staff, db):
    """TC-007: filter owner=<uuid hợp lệ khác> → chỉ KH có owner đó."""
    owned = await _seed_customer(db, company_name="DEMO Của Staff", owner_id=staff["id"])
    not_owned = await _seed_customer(db, company_name="DEMO Của Manager", owner_id=manager["id"])
    r = await client.get(
        f"{CRM}/customers?owner={staff['id']}&page_size=1000", headers=manager["headers"],
    )
    assert r.status_code == 200, r.text
    ids = [c["id"] for c in r.json()["data"]["customers"]]
    assert owned["id"] in ids and not_owned["id"] not in ids


async def test_list_customers_owner_invalid_uuid_400(client, manager):
    """TC-009: owner không phải UUID và không phải 'mine' → 400."""
    r = await client.get(f"{CRM}/customers?owner=abc123", headers=manager["headers"])
    assert r.status_code == 400, r.text


async def test_list_customers_owner_unknown_uuid_404(client, manager):
    """TC-008: owner là UUID hợp lệ nhưng không có trong users → 404."""
    r = await client.get(
        f"{CRM}/customers?owner={uuid.uuid4()}", headers=manager["headers"],
    )
    assert r.status_code == 404, r.text


# ════════════════════════════════════════════════════════════════════════════
# 3) INTERACTION_TYPE — 9 giá trị hợp lệ (W0-03 đã fix) + biên
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("itype", INTERACTION_TYPES_9)
async def test_interaction_type_all_9_valid(client, staff, customer, itype):
    """TC-045..051 (fixed): cả 9 interaction_type → 201 (Literal + CHECK khớp)."""
    r = await client.post(
        f"{CRM}/interactions",
        json={"customer_id": customer["id"], "interaction_type": itype,
              "subject": f"Test {itype}"},
        headers=staff["headers"],
    )
    assert r.status_code == 201, f"type={itype}: {r.text}"
    assert r.json()["data"]["interaction_type"] == itype


async def test_interaction_type_invalid_422(client, staff, customer):
    """Giá trị NGOÀI 9 (vd 'fax') → 422 (Pydantic Literal chặn trước DB)."""
    r = await client.post(
        f"{CRM}/interactions",
        json={"customer_id": customer["id"], "interaction_type": "fax",
              "subject": "x"},
        headers=staff["headers"],
    )
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("subject", ["", "x" * 501])
async def test_interaction_subject_bounds_422(client, staff, customer, subject):
    """TC-053: subject rỗng hoặc >500 ký tự → 422 (min_length=1, max_length=500)."""
    r = await client.post(
        f"{CRM}/interactions",
        json={"customer_id": customer["id"], "interaction_type": "call",
              "subject": subject},
        headers=staff["headers"],
    )
    assert r.status_code == 422, r.text


async def test_interaction_contact_not_belong_customer_400(client, staff, db):
    """TC-052: contact_id thuộc KH khác → 400."""
    cust_a = await _seed_customer(db, company_name="DEMO A")
    cust_b = await _seed_customer(db, company_name="DEMO B")
    contact_b = await _seed_contact(db, cust_b["id"], full_name="LH của B")
    r = await client.post(
        f"{CRM}/interactions",
        json={"customer_id": cust_a["id"], "contact_id": contact_b,
              "interaction_type": "call", "subject": "sai contact"},
        headers=staff["headers"],
    )
    assert r.status_code == 400, r.text


async def test_interaction_updates_contact_last_contacted_at(client, staff, db):
    """TC-054: ghi tương tác kèm contact_id → cập nhật last_contacted_at của contact."""
    cust = await _seed_customer(db, company_name="DEMO Contact")
    contact_id = await _seed_contact(db, cust["id"], is_primary=True)
    before = await db.fetchval(
        "SELECT last_contacted_at FROM crm_contacts WHERE id=$1", contact_id,
    )
    assert before is None
    r = await client.post(
        f"{CRM}/interactions",
        json={"customer_id": cust["id"], "contact_id": contact_id,
              "interaction_type": "meeting", "subject": "Gặp KH"},
        headers=staff["headers"],
    )
    assert r.status_code == 201, r.text
    after = await db.fetchval(
        "SELECT last_contacted_at FROM crm_contacts WHERE id=$1", contact_id,
    )
    assert after is not None


async def test_interaction_customer_not_found_404(client, staff):
    """Ghi tương tác cho customer_id không tồn tại → 404."""
    r = await client.post(
        f"{CRM}/interactions",
        json={"customer_id": 999_999_999, "interaction_type": "call", "subject": "x"},
        headers=staff["headers"],
    )
    assert r.status_code == 404, r.text


# ════════════════════════════════════════════════════════════════════════════
# 4) OWNER ASSIGN — RBAC + validate
# ════════════════════════════════════════════════════════════════════════════

async def test_assign_owner_manager_ok(client, manager, staff, customer, db):
    """TC-032: manager gán owner → 200; DB owner_id đổi đúng."""
    r = await client.patch(
        f"{CRM}/customers/{customer['id']}/owner",
        json={"owner_id": staff["id"]}, headers=manager["headers"],
    )
    assert r.status_code == 200, r.text
    owner = await db.fetchval("SELECT owner_id FROM customers WHERE id=$1", customer["id"])
    assert str(owner) == staff["id"]


async def test_assign_owner_admin_ok(client, admin, staff, customer):
    """TC-120: admin cũng được gán owner → 200."""
    r = await client.patch(
        f"{CRM}/customers/{customer['id']}/owner",
        json={"owner_id": staff["id"]}, headers=admin["headers"],
    )
    assert r.status_code == 200, r.text


async def test_assign_owner_staff_forbidden_403(client, staff, customer):
    """TC-036/TC-120: staff gán owner → 403 (ghi chỉ manager/admin)."""
    r = await client.patch(
        f"{CRM}/customers/{customer['id']}/owner",
        json={"owner_id": staff["id"]}, headers=staff["headers"],
    )
    assert r.status_code == 403, r.text


async def test_assign_owner_accountant_forbidden_403(client, accountant, staff, customer):
    """TC-120: accountant (đọc được) vẫn KHÔNG gán owner được → 403."""
    r = await client.patch(
        f"{CRM}/customers/{customer['id']}/owner",
        json={"owner_id": staff["id"]}, headers=accountant["headers"],
    )
    assert r.status_code == 403, r.text


async def test_assign_owner_invalid_uuid_400(client, manager, customer):
    """TC-033: owner_id không phải UUID → 400."""
    r = await client.patch(
        f"{CRM}/customers/{customer['id']}/owner",
        json={"owner_id": "abc"}, headers=manager["headers"],
    )
    assert r.status_code == 400, r.text


async def test_assign_owner_unknown_user_404(client, manager, customer):
    """TC-034: owner_id là UUID hợp lệ nhưng không có user → 404."""
    r = await client.patch(
        f"{CRM}/customers/{customer['id']}/owner",
        json={"owner_id": str(uuid.uuid4())}, headers=manager["headers"],
    )
    assert r.status_code == 404, r.text


async def test_assign_owner_null_unassign(client, manager, db):
    """TC-035: owner_id=null → bỏ gán, DB owner_id = NULL."""
    cust = await _seed_customer(db, company_name="DEMO Bỏ Gán", owner_id=manager["id"])
    r = await client.patch(
        f"{CRM}/customers/{cust['id']}/owner",
        json={"owner_id": None}, headers=manager["headers"],
    )
    assert r.status_code == 200, r.text
    owner = await db.fetchval("SELECT owner_id FROM customers WHERE id=$1", cust["id"])
    assert owner is None


async def test_bulk_assign_owner(client, manager, staff, db):
    """TC-037: gán owner hàng loạt → cập nhật đủ id đã chọn."""
    c1 = await _seed_customer(db, company_name="DEMO Bulk 1")
    c2 = await _seed_customer(db, company_name="DEMO Bulk 2")
    r = await client.post(
        f"{CRM}/customers/assign-owner",
        json={"customer_ids": [c1["id"], c2["id"]], "owner_id": staff["id"]},
        headers=manager["headers"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["updated_count"] == 2
    rows = await db.fetch(
        "SELECT owner_id FROM customers WHERE id = ANY($1::bigint[])", [c1["id"], c2["id"]],
    )
    assert all(str(row["owner_id"]) == staff["id"] for row in rows)


# ════════════════════════════════════════════════════════════════════════════
# 5) DEAL-CHAIN MARGIN — số ĐÚNG (có tỷ giá) + rate_missing (W0-15, không bịa 25450)
# ════════════════════════════════════════════════════════════════════════════

async def test_margin_correct_with_exchange_rate(client, manager, db):
    """TC-111/112: có tỷ giá USD→VND=25000, số margin KHỚP tính tay.

    revenue=100,000,000; cogs=50,000,000; freight=1000*25000=25,000,000;
    customs=2,000,000; other=1,000,000 → total_cost=78,000,000;
    gross_profit=22,000,000; margin_pct=22.0; meets_threshold(15%)=True.
    """
    chain = await _seed_chain(db, manager["id"], revenue_vnd=100_000_000,
                              freight_usd=1000, with_rate=True, usd_rate=25_000)
    r = await client.get(f"{CHAINS}/{chain['chain_code']}/margin", headers=manager["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "live_calculated"
    data = body["data"]
    assert _num(data["revenue_vnd"]) == 100_000_000
    assert _num(data["costs"]["cogs_vnd"]) == 50_000_000
    assert _num(data["costs"]["freight_vnd"]) == 25_000_000
    assert _num(data["costs"]["customs_duty_vnd"]) == 2_000_000
    assert _num(data["costs"]["other_costs_vnd"]) == 1_000_000
    assert _num(data["costs"]["total_cost_vnd"]) == 78_000_000
    assert _num(data["gross_profit_vnd"]) == 22_000_000
    assert _num(data["margin_pct"]) == 22.0
    assert data["is_profitable"] is True
    assert data["meets_threshold"] is True
    assert data["rate_missing"] is False


async def test_margin_below_threshold_15pct(client, manager, db):
    """TC-112: margin < 15% → meets_threshold=False (ngưỡng cứng 15%).

    revenue=80,000,000; total_cost=78,000,000 → gross=2,000,000; margin=2.5%.
    """
    chain = await _seed_chain(db, manager["id"], revenue_vnd=80_000_000,
                              freight_usd=1000, with_rate=True, usd_rate=25_000)
    r = await client.get(f"{CHAINS}/{chain['chain_code']}/margin", headers=manager["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert _num(data["gross_profit_vnd"]) == 2_000_000
    assert _num(data["margin_pct"]) == 2.5
    assert data["is_profitable"] is True
    assert data["meets_threshold"] is False


async def test_margin_rate_missing_no_fake_25450(client, manager, db):
    """TC-113 (fixed W0-15): exchange_rates rỗng + freight USD>0 → rate_missing=True,
    freight_vnd=null, gross_profit/margin=null; KHÔNG có số bịa 25450 trong response."""
    chain = await _seed_chain(db, manager["id"], revenue_vnd=100_000_000,
                              freight_usd=1000, with_rate=False)
    r = await client.get(f"{CHAINS}/{chain['chain_code']}/margin", headers=manager["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    data = body["data"]
    assert data["rate_missing"] is True
    assert data["costs"]["freight_vnd"] is None
    assert data["costs"]["total_cost_vnd"] is None
    assert data["gross_profit_vnd"] is None
    assert data["margin_pct"] is None
    # KHÔNG bịa hằng 25450 ở bất kỳ đâu trong response.
    assert "25450" not in r.text
    # Không ghi rác vào deal_margins khi rate_missing.
    cnt = await db.fetchval(
        "SELECT COUNT(*) FROM deal_margins WHERE chain_code=$1", chain["chain_code"],
    )
    assert cnt == 0


async def test_margin_staff_forbidden_403(client, staff, manager, db):
    """TC-114: staff gọi margin → 403 (require_role manager/admin)."""
    chain = await _seed_chain(db, manager["id"])
    r = await client.get(f"{CHAINS}/{chain['chain_code']}/margin", headers=staff["headers"])
    assert r.status_code == 403, r.text


async def test_margin_chain_not_found_404(client, manager):
    """TC-109: chain_code không tồn tại → 404."""
    r = await client.get(f"{CHAINS}/khong-ton-tai-xyz/margin", headers=manager["headers"])
    assert r.status_code == 404, r.text


async def test_margin_idempotent_upsert(client, manager, db):
    """TC-115: gọi 2 lần → lần 1 live_calculated (UPSERT), lần 2 pre_calculated;
    deal_margins chỉ 1 dòng cho chain đó."""
    chain = await _seed_chain(db, manager["id"], revenue_vnd=100_000_000,
                              freight_usd=1000, with_rate=True, usd_rate=25_000)
    r1 = await client.get(f"{CHAINS}/{chain['chain_code']}/margin", headers=manager["headers"])
    assert r1.status_code == 200 and r1.json()["source"] == "live_calculated", r1.text
    r2 = await client.get(f"{CHAINS}/{chain['chain_code']}/margin", headers=manager["headers"])
    assert r2.status_code == 200 and r2.json()["source"] == "pre_calculated", r2.text
    assert _num(r2.json()["data"]["gross_profit_vnd"]) == 22_000_000
    cnt = await db.fetchval(
        "SELECT COUNT(*) FROM deal_margins WHERE chain_code=$1", chain["chain_code"],
    )
    assert cnt == 1


# ════════════════════════════════════════════════════════════════════════════
# 6) PIPELINE — move stage + board
# ════════════════════════════════════════════════════════════════════════════

async def test_pipeline_move_to_active_sets_followup_plus3(client, staff, db):
    """TC-092: kéo card sang 'active' → follow_up_date = hôm nay + 3 ngày + note chuẩn."""
    card_id = await _seed_card(db, stage="new", title="DEMO Move Active")
    r = await client.patch(
        f"{PIPE}/cards/{card_id}/move", json={"stage": "active"}, headers=staff["headers"],
    )
    assert r.status_code == 200, r.text
    row = await db.fetchrow(
        "SELECT stage, follow_up_date, follow_up_note FROM crm_pipeline_cards WHERE id=$1",
        card_id,
    )
    assert row["stage"] == "active"
    assert row["follow_up_date"] == dt.date.today() + dt.timedelta(days=3)
    assert row["follow_up_note"] == "Gọi hỏi KH đã xem báo giá chưa"


async def test_pipeline_move_to_aftercare_plus7(client, staff, db):
    """TC-093: kéo sang 'aftercare' → follow_up_date = hôm nay + 7 ngày."""
    card_id = await _seed_card(db, stage="delivering", title="DEMO Move Aftercare")
    r = await client.patch(
        f"{PIPE}/cards/{card_id}/move", json={"stage": "aftercare"}, headers=staff["headers"],
    )
    assert r.status_code == 200, r.text
    fu = await db.fetchval("SELECT follow_up_date FROM crm_pipeline_cards WHERE id=$1", card_id)
    assert fu == dt.date.today() + dt.timedelta(days=7)


async def test_pipeline_move_invalid_stage_400(client, staff, db):
    """TC-094: stage đích không hợp lệ → 400."""
    card_id = await _seed_card(db, stage="new", title="DEMO Bad Stage")
    r = await client.patch(
        f"{PIPE}/cards/{card_id}/move", json={"stage": "khong_ton_tai"},
        headers=staff["headers"],
    )
    assert r.status_code == 400, r.text


async def test_pipeline_move_card_not_found_404(client, staff):
    """TC-095: card không tồn tại → 404."""
    r = await client.patch(
        f"{PIPE}/cards/999999999/move", json={"stage": "active"}, headers=staff["headers"],
    )
    assert r.status_code == 404, r.text


async def test_pipeline_board_excludes_archived(client, staff, db):
    """TC-089: board gồm card không archived, phủ đủ 5 cột; card archived KHÔNG hiện."""
    active_card = await _seed_card(db, stage="active", title="DEMO Board Active")
    archived_card = await _seed_card(db, stage="new", title="DEMO Board Archived", is_archived=True)
    r = await client.get(f"{PIPE}/board", headers=staff["headers"])
    assert r.status_code == 200, r.text
    board = r.json()["data"]
    assert set(board) >= {"new", "nurturing", "active", "delivering", "aftercare"}
    all_ids = [c["id"] for stage in board.values() for c in stage["cards"]]
    assert active_card in all_ids
    assert archived_card not in all_ids


async def test_pipeline_create_card_missing_title_400(client, staff):
    """TC-098: tạo card thiếu title → 400."""
    r = await client.post(f"{PIPE}/cards", json={"stage": "new"}, headers=staff["headers"])
    assert r.status_code == 400, r.text


# ════════════════════════════════════════════════════════════════════════════
# 7) FOLLOW-UPS DUE — 3 nhóm overdue/today/upcoming
# ════════════════════════════════════════════════════════════════════════════

async def test_follow_ups_due_three_buckets(client, staff, db):
    """TC-039: hàng đợi 'Cần làm hôm nay' phân đúng 3 nhóm theo follow_up_date.

    overdue=hôm qua(+1 quá hạn), today=hôm nay, upcoming=+5 ngày (≤7). Bản ghi
    KHÔNG có follow_up_date bị loại (filter follow_up_date IS NOT NULL)."""
    cust = await _seed_customer(db, company_name="DEMO Follow", owner_id=staff["id"])
    today = dt.date.today()
    await _seed_interaction(db, cust["id"], staff["id"], subject="Quá hạn",
                            follow_up_date=today - dt.timedelta(days=1))
    await _seed_interaction(db, cust["id"], staff["id"], subject="Hôm nay",
                            follow_up_date=today)
    await _seed_interaction(db, cust["id"], staff["id"], subject="Sắp tới",
                            follow_up_date=today + dt.timedelta(days=5))
    await _seed_interaction(db, cust["id"], staff["id"], subject="Không hẹn",
                            follow_up_date=None)
    r = await client.get(f"{CRM}/follow-ups/due?scope=mine", headers=staff["headers"])
    assert r.status_code == 200, r.text
    counts = r.json()["counts"]
    assert counts["overdue"] == 1
    assert counts["today"] == 1
    assert counts["upcoming"] == 1


async def test_follow_ups_due_limit_over_max_422(client, staff):
    """TC-041: limit vượt biên (301) → 422 (le=300)."""
    r = await client.get(f"{CRM}/follow-ups/due?limit=301", headers=staff["headers"])
    assert r.status_code == 422, r.text


async def test_mark_followup_done_clears_date_keeps_row(client, staff, db):
    """TC-043/044: đánh dấu xong → follow_up_date=NULL nhưng bản ghi vẫn còn."""
    cust = await _seed_customer(db, company_name="DEMO Done", owner_id=staff["id"])
    iid = await _seed_interaction(db, cust["id"], staff["id"], subject="Cần xong",
                                  follow_up_date=dt.date.today())
    r = await client.patch(f"{CRM}/interactions/{iid}/done", headers=staff["headers"])
    assert r.status_code == 200, r.text
    row = await db.fetchrow(
        "SELECT id, follow_up_date FROM crm_interactions WHERE id=$1", iid,
    )
    assert row is not None and row["follow_up_date"] is None
    # id không tồn tại → 404
    r404 = await client.patch(f"{CRM}/interactions/999999999/done", headers=staff["headers"])
    assert r404.status_code == 404, r404.text


# ════════════════════════════════════════════════════════════════════════════
# 8) RBAC MA TRẬN ĐỌC/GHI + cô lập vendor/viewer (bám rbac.py thực tế)
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("role_fixture", ["staff", "accountant", "manager", "admin"])
async def test_read_customer_detail_all_internal_roles_pass(
    client, customer, role_fixture, staff, accountant, manager, admin,
):
    """TC-120 (đọc): staff/accountant/manager/admin đều GET chi tiết KH → 200.

    Inject 4 fixture role TRỰC TIẾP làm tham số (pytest-asyncio giải quyết chuẩn
    trên 1 loop/test) rồi chọn theo tên — KHÔNG dùng request.getfixturevalue trên
    fixture async (gây RuntimeError 'event loop is already running')."""
    users = {"staff": staff, "accountant": accountant, "manager": manager, "admin": admin}
    user = users[role_fixture]
    r = await client.get(f"{CRM}/customers/{customer['id']}", headers=user["headers"])
    assert r.status_code == 200, f"{role_fixture}: {r.text}"


async def test_vendor_blocked_on_crm_get(client, vendor):
    """TC-119: vendor gọi GET CRM nội bộ → 403 (không thuộc allowed_roles, không phải viewer)."""
    for path in (f"{CRM}/customers", f"{PIPE}/board", f"{CHAINS}"):
        r = await client.get(path, headers=vendor["headers"])
        assert r.status_code == 403, f"{path}: {r.status_code} {r.text}"


async def test_viewer_readonly_get_ok_but_write_403(client, viewer, customer):
    """Bám rbac.py: viewer (allow_viewer mặc định True) ĐỌC được (GET→200) nhưng
    method GHI bị 403. (Khác kỳ vọng cũ TC-119 vốn coi viewer GET là 403.)"""
    r_get = await client.get(f"{CRM}/customers", headers=viewer["headers"])
    assert r_get.status_code == 200, r_get.text
    r_write = await client.post(
        f"{CRM}/interactions",
        json={"customer_id": customer["id"], "interaction_type": "call", "subject": "x"},
        headers=viewer["headers"],
    )
    assert r_write.status_code == 403, r_write.text


async def test_customer_detail_not_found_404(client, staff):
    """TC-014: chi tiết KH id không tồn tại → 404."""
    r = await client.get(f"{CRM}/customers/999999999", headers=staff["headers"])
    assert r.status_code == 404, r.text
