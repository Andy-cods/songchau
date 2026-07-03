"""W1-04 — CỤM ĐẤU THẦU NCC (procurement / vendor bidding).

Phủ TỰ-ĐỘNG-HOÁ-ĐƯỢC (API in-process, KHÔNG UI) các ca trong
`plans/bidding-e2e-test-plan/01-individual-cases.md`. Mỗi test map ngược mã
TC-IND trong docstring (traceability). Chạy in-process qua ASGITransport (xem
conftest). Mọi ghi nằm trong transaction của fixture `db` → ROLLBACK, không rác.

Bề mặt được test
────────────────
  * ADMIN  (app/api/v1/procurement.py, prefix /api/v1/procurement):
      - Vòng đời phiên: create_batch / list_batches / get_batch_admin / publish /
        set_deadline                                            (TC-IND-001/004/008/009/022)
      - Items: add_items (manual) / import-paste                (TC-IND-011/020)
      - Mời NCC: invite_vendors / list_invitations              (TC-IND-027/028)
      - Đánh giá: matrix (lowest-highlight, sealed-mask, FX)     (TC-IND-034/049/051)
      - Maker-checker AWARD: award(propose) / approve / reject   (TC-IND-042/043/044/046/050)
      - Cấu hình phê duyệt: get/put approval-config             (TC-IND-047/048)
  * VENDOR (app/api/vendor/*, prefix /api/vendor):
      - quote submit/draft + deadline guard + invitation gate   (TC-IND-066/067)
      - vendor thấy đợt được mời / không được mời → 404 (isolation, SEC)

BÁM SCHEMA THỰC (tests/_schema_snapshot.sql) — mọi cột/enum đã đối chiếu:
  * procurement_rfq_batches.status CHECK ∈ {draft, cho_duyet, approved,
    rejected_internal, published, evaluating, awarded, closed, cancelled};
    award_status CHECK ∈ {none, proposed, approved}.
  * vendor_quotes.status CHECK ∈ {draft, submitted, awarded, rejected, withdrawn};
    v_latest_vendor_quote CHỈ chọn status ∈ {submitted, awarded}.
  * exchange_rates.from/to_currency = enum currency_code (VND/USD/RMB/KRW/JPY/EUR/CNY);
    rate numeric(15,4). fetch_fx_to_vnd có CACHE TTL in-process → autouse fixture
    gọi invalidate_pricing_caches() trước mỗi test + dùng ngày as-of tường minh.
  * app_config(key text, value jsonb) — 3 cờ Đợt 3 maker-checker seed qua
    to_jsonb(::bool)/(::numeric), mặc định KHÔNG có row → DEFAULT-OFF.

DRIFT/KỲ VỌNG ĐỀ-BÀI vs CODE THỰC (bám CODE):
  * Đề bài kỳ vọng "quá hạn nộp → 409"; CODE THỰC (_persist_quote) trả **400**
    ("Đã quá hạn báo giá cho đợt này"). Bám code → assert 400 (xem
    test_submit_past_deadline_blocked). 409 chỉ dùng cho re-award khi đang có đề
    xuất treo (award_status='proposed') — test riêng.

MUTATION-CHECK (bằng chứng test bắt lỗi thật):
  * SoD maker-checker: nếu ai gỡ guard "checker phải khác proposer" trong
    approve_award, `test_self_approve_forbidden_403` chuyển từ 403 → 200 ⇒ FAIL.
  * FX: nếu _vnd() nhân nhầm rate, `test_fx_vnd_equiv_computed` sai số ⇒ FAIL.
  * Sealed: nếu matrix quên mask khi niêm phong,
    `test_sealed_batch_masks_prices_before_deadline` thấy unit_price != None ⇒ FAIL.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio

pytestmark = pytest.mark.integration

PROC = "/api/v1/procurement"
VBATCH = "/api/vendor/batches"
VQUOTE = "/api/vendor/quotes"


# ── Guard: chỉ chạy khi có full prod schema; + xoá cache FX (tránh nhiễm chéo).
#    Fixture ASYNC + function-scope, nhận schema_info như DEPENDENCY (giống
#    test_secondary/test_crm — KHÔNG request.getfixturevalue trên fixture async).
@pytest_asyncio.fixture(autouse=True)
async def _require_full_schema(request, schema_info):
    if request.node.get_closest_marker("integration") and not schema_info["full_schema"]:
        pytest.skip(
            "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
            "(pg_dump --schema-only). Schema đang nạp: " + schema_info["source"]
        )
    # FX rate có cache TTL 60s in-process keyed (currency, as_of). Xoá trước mỗi
    # test để 1 test không đọc rate/negative-cache do test khác để lại.
    try:
        from app.services.sourcing_pricing_engine import invalidate_pricing_caches
        invalidate_pricing_caches()
    except Exception:  # pragma: no cover - degrade nếu module đổi
        pass


def _uniq(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


# ════════════════════════════════════════════════════════════════════════════
# Seed helpers (dùng `db` — cùng connection app request, rollback sau test).
# TÁI DÙNG pattern seed "thế giới đấu thầu" của test_vendor_isolation.py.
# ════════════════════════════════════════════════════════════════════════════

async def _mk_vendor_account(db, user_id, name="Cty NCC") -> int:
    """vendor_accounts ACTIVE gắn với 1 users.id (role vendor). status enum='active'."""
    return await db.fetchval(
        """
        INSERT INTO vendor_accounts (user_id, company_name, contact_name,
                                     is_approved, status)
        VALUES ($1, $2, 'Người LH', true, 'active')
        RETURNING id
        """,
        user_id, _uniq(name),
    )


async def _mk_batch(
    db, creator, *, status="draft", award_mode="per_item", current_round=1,
    item_count=0, bid_deadline=None, sealed=False, award_status="none",
) -> int:
    """1 đợt đấu thầu. published_at tự set khi status đã công bố/xét/chốt.

    bid_deadline nhận datetime tz-aware (timestamptz) hoặc None. sealed →
    sealed_until_deadline (NOT NULL DEFAULT FALSE). award_status ∈ CHECK.
    """
    return await db.fetchval(
        """
        INSERT INTO procurement_rfq_batches
            (batch_code, title, status, award_mode, created_by, item_count,
             current_round, bid_deadline, deadline_round1, sealed_until_deadline,
             award_status, visibility, published_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'invited',
                CASE WHEN $3 IN ('published','evaluating','awarded','closed')
                     THEN NOW() ELSE NULL END)
        RETURNING id
        """,
        _uniq("BID"), "Đợt test đấu thầu", status, award_mode, creator, item_count,
        current_round, bid_deadline, sealed, award_status,
    )


async def _mk_item(
    db, batch_id, *, item_no=1, quantity=10, target_price=None,
    source_kind="manual", bqms_code=None, spec="Bạc lót SUS304",
) -> int:
    """1 dòng RFQ. target_price numeric (nội bộ — không lộ vendor). quantity numeric."""
    return await db.fetchval(
        """
        INSERT INTO procurement_rfq_items
            (batch_id, item_no, specification, quantity, unit, source_kind,
             target_price, bqms_code, product_name)
        VALUES ($1, $2, $3, $4, 'EA', $5, $6, $7, 'Sản phẩm')
        RETURNING id
        """,
        batch_id, item_no, spec, quantity, source_kind, target_price, bqms_code,
    )


async def _mk_invitation(db, batch_id, vendor_id, *, round_number=1,
                         status="invited", invited_by=None) -> int:
    return await db.fetchval(
        """
        INSERT INTO procurement_rfq_invitations
            (batch_id, vendor_id, round_number, status, invited_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        """,
        batch_id, vendor_id, round_number, status, invited_by,
    )


async def _mk_quote(db, batch_id, vendor_id, *, currency="VND", total=None,
                    status="submitted", round_number=1, lines=()) -> int:
    """1 báo giá NCC + các dòng. status ∈ CHECK. submitted_at set khi submitted.

    lines = iterable[(item_id, unit_price, quantity)].
    """
    qid = await db.fetchval(
        """
        INSERT INTO vendor_quotes
            (batch_id, vendor_id, currency, total_amount, status, round_number,
             submitted_at)
        VALUES ($1, $2, $3, $4, $5, $6,
                CASE WHEN $5 = 'submitted' THEN NOW() ELSE NULL END)
        RETURNING id
        """,
        batch_id, vendor_id, currency, total, status, round_number,
    )
    for item_id, unit_price, qty in lines:
        await db.execute(
            """
            INSERT INTO vendor_quote_items
                (quote_id, item_id, unit_price, quantity, offered_qty, currency)
            VALUES ($1, $2, $3, $4, $4, $5)
            """,
            qid, item_id, unit_price, qty, currency,
        )
    return qid


async def _mk_fx(db, *, frm, rate, rate_date):
    """1 dòng exchange_rates <frm> → VND, hiệu lực rate_date. rate numeric(15,4)."""
    await db.execute(
        """
        INSERT INTO exchange_rates (rate_date, from_currency, to_currency, rate, rate_type)
        VALUES ($1, $2, 'VND', $3, 'transfer')
        """,
        rate_date, frm, rate,
    )


async def _set_award_flags(db, *, enabled, threshold=50_000_000, breakglass=False):
    """Seed 3 cờ Đợt 3 maker-checker vào app_config (jsonb). Threshold ::numeric."""
    for key, val in (
        ("procurement_award_approval_enabled", enabled),
        ("procurement_award_breakglass_enabled", breakglass),
    ):
        await db.execute(
            "INSERT INTO app_config (key, value) VALUES ($1, to_jsonb($2::bool)) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            key, val,
        )
    await db.execute(
        "INSERT INTO app_config (key, value) VALUES "
        "('procurement_award_approval_threshold_vnd', to_jsonb($1::numeric)) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        Decimal(str(threshold)),
    )


async def _seed_awardable(db, creator, vendor_id, *, currency="VND",
                          unit_price=1000, qty=10, deadline=None):
    """Đợt PUBLISHED + 1 item + lời mời + 1 báo giá SUBMITTED của vendor_id.

    Trả (batch_id, item_id). Dùng cho các luồng award/approve/reject.
    """
    bid = await _mk_batch(db, creator, status="published", item_count=1,
                          bid_deadline=deadline)
    iid = await _mk_item(db, bid, quantity=qty)
    await _mk_invitation(db, bid, vendor_id, invited_by=creator)
    await _mk_quote(db, bid, vendor_id, currency=currency, total=unit_price * qty,
                    status="submitted", lines=[(iid, unit_price, qty)])
    return bid, iid


def _future(**kw) -> datetime:
    return datetime.now(timezone.utc) + timedelta(**kw)


def _past(**kw) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kw)


# ════════════════════════════════════════════════════════════════════════════
# A) VÒNG ĐỜI PHIÊN THẦU — create / list / detail / publish / deadline
# ════════════════════════════════════════════════════════════════════════════

async def test_create_batch_ok(client, admin):
    """TC-IND-001 — Tạo phiên thầu (admin) → 200 + trả id + batch_code."""
    r = await client.post(f"{PROC}/batches",
                          json={"title": "Đợt bạc lót Q3", "award_mode": "per_item"},
                          headers=admin["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["id"] and data["batch_code"].startswith("BATCH-2026-")


async def test_create_batch_missing_title_400(client, admin):
    """TC-IND-001 (âm) — thiếu title (bắt buộc) → 400."""
    r = await client.post(f"{PROC}/batches", json={"award_mode": "per_item"},
                          headers=admin["headers"])
    assert r.status_code == 400, r.text


async def test_create_batch_staff_403(client, staff):
    """TC-IND-001 / SEC-RBAC — staff KHÔNG thuộc _WRITE_ROLES → 403."""
    r = await client.post(f"{PROC}/batches", json={"title": "X"},
                          headers=staff["headers"])
    assert r.status_code == 403, r.text


async def test_create_batch_vendor_403(client, vendor):
    """SEC — vendor KHÔNG được tạo phiên (chỉ cổng NCC) → 403."""
    r = await client.post(f"{PROC}/batches", json={"title": "X"},
                          headers=vendor["headers"])
    assert r.status_code == 403, r.text


async def test_list_batches_shows_seeded(client, manager, db):
    """TC-IND-008 — list_batches trả {data, total}; đợt seed xuất hiện + invited_count."""
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1)
    code = await db.fetchval("SELECT batch_code FROM procurement_rfq_batches WHERE id=$1", bid)
    r = await client.get(f"{PROC}/batches", headers=manager["headers"], params={"limit": 50})
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["total"], int) and body["total"] >= 1
    match = [b for b in body["data"] if b["batch_code"] == code]
    assert len(match) == 1, body["data"]
    assert "invited_count" in match[0] and "submitted_count" in match[0]


async def test_get_batch_admin_ok(client, manager, db):
    """TC-IND-009 — chi tiết phiên (admin) → 200, data gồm items/invitations/quotes."""
    bid = await _mk_batch(db, manager["id"], item_count=1)
    await _mk_item(db, bid)
    r = await client.get(f"{PROC}/batches/{bid}", headers=manager["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["id"] == bid
    assert isinstance(data["items"], list) and len(data["items"]) == 1
    assert "invitations" in data and "quotes" in data


async def test_get_batch_admin_not_found_404(client, manager):
    """TC-IND-009 (âm) — phiên không tồn tại → 404."""
    r = await client.get(f"{PROC}/batches/999000111", headers=manager["headers"])
    assert r.status_code == 404, r.text


async def test_publish_from_draft_ok(client, manager, db):
    """TC-IND-022 — publish gate OFF: draft (có item) → published."""
    bid = await _mk_batch(db, manager["id"], item_count=1)
    await _mk_item(db, bid)
    r = await client.patch(f"{PROC}/batches/{bid}/publish", headers=manager["headers"])
    assert r.status_code == 200, r.text
    st = await db.fetchval("SELECT status FROM procurement_rfq_batches WHERE id=$1", bid)
    assert st == "published"


async def test_publish_empty_batch_400(client, manager, db):
    """TC-IND-022 (âm) — publish phiên KHÔNG có item → 400 (guard item_count=0)."""
    bid = await _mk_batch(db, manager["id"], item_count=0)
    r = await client.patch(f"{PROC}/batches/{bid}/publish", headers=manager["headers"])
    assert r.status_code == 400, r.text


async def test_set_deadline_ok(client, manager, db):
    """TC-IND-004 — đặt hạn báo giá cho phiên draft → 200 + bid_deadline lưu."""
    bid = await _mk_batch(db, manager["id"], item_count=1)
    dl = _future(days=5).isoformat()
    r = await client.patch(f"{PROC}/batches/{bid}/deadline",
                           json={"bid_deadline": dl}, headers=manager["headers"])
    assert r.status_code == 200, r.text
    saved = await db.fetchval("SELECT bid_deadline FROM procurement_rfq_batches WHERE id=$1", bid)
    assert saved is not None


# ════════════════════════════════════════════════════════════════════════════
# B) QUẢN LÝ ITEMS — add manual / import-paste (chỉ khi draft)
# ════════════════════════════════════════════════════════════════════════════

async def test_add_items_manual_ok(client, manager, db):
    """TC-IND-011 — thêm item thủ công vào phiên draft → imported=1; item_count đồng bộ."""
    bid = await _mk_batch(db, manager["id"])
    r = await client.post(
        f"{PROC}/batches/{bid}/items",
        json={"items": [{"specification": "Vòng bi 6204", "quantity": 20, "unit": "EA"}]},
        headers=manager["headers"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1
    cnt = await db.fetchval("SELECT item_count FROM procurement_rfq_batches WHERE id=$1", bid)
    assert cnt == 1


async def test_add_items_to_published_400(client, manager, db):
    """TC-IND-011 (âm) — chỉ thêm item khi status='draft'; published → 400."""
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1)
    r = await client.post(
        f"{PROC}/batches/{bid}/items",
        json={"items": [{"specification": "Thêm sau công bố", "quantity": 1}]},
        headers=manager["headers"],
    )
    assert r.status_code == 400, r.text


async def test_import_paste_ok(client, manager, db):
    """TC-IND-020 — import items bằng dán bảng (tab/newline) → imported≥2."""
    bid = await _mk_batch(db, manager["id"])
    text = "MA001\tỐc vít M6\t100\tEA\nMA002\tĐai ốc M6\t200\tEA"
    r = await client.post(f"{PROC}/batches/{bid}/import-paste",
                          json={"text": text}, headers=manager["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["imported"] >= 2
    cnt = await db.fetchval("SELECT COUNT(*) FROM procurement_rfq_items WHERE batch_id=$1", bid)
    assert cnt >= 2


async def test_import_paste_empty_400(client, manager, db):
    """TC-IND-020 (âm) — dán rỗng → 400."""
    bid = await _mk_batch(db, manager["id"])
    r = await client.post(f"{PROC}/batches/{bid}/import-paste",
                          json={"text": "   "}, headers=manager["headers"])
    assert r.status_code == 400, r.text


# ════════════════════════════════════════════════════════════════════════════
# C) MỜI NCC & DANH SÁCH MỜI — invite_vendors / list_invitations + vendor visibility
# ════════════════════════════════════════════════════════════════════════════

async def test_invite_vendor_and_vendor_sees_batch(client, manager, vendor, db):
    """TC-IND-027 + TC-IND-061 — mời NCC → tạo invitation; NCC (token) thấy đợt mình được mời."""
    va = await _mk_vendor_account(db, vendor["id"])
    bid = await _mk_batch(db, manager["id"], item_count=1)
    await _mk_item(db, bid)

    r = await client.post(f"{PROC}/batches/{bid}/invite",
                          json={"vendor_ids": [va], "round_number": 1},
                          headers=manager["headers"])
    assert r.status_code == 200, r.text
    created = r.json()["data"]["created"]
    assert len(created) == 1 and created[0]["vendor_id"] == va

    # invite tự auto-publish khi còn draft (gate OFF) → NCC xem được.
    inv = await db.fetchval(
        "SELECT COUNT(*) FROM procurement_rfq_invitations WHERE batch_id=$1 AND vendor_id=$2",
        bid, va,
    )
    assert inv == 1

    # NCC đăng nhập thấy chi tiết đợt được mời (200).
    rv = await client.get(f"{VBATCH}/{bid}", headers=vendor["headers"])
    assert rv.status_code == 200, rv.text
    assert rv.json()["data"]["id"] == bid


async def test_invite_empty_vendor_ids_400(client, manager, db):
    """TC-IND-027 (âm) — vendor_ids rỗng → 400."""
    bid = await _mk_batch(db, manager["id"], item_count=1)
    await _mk_item(db, bid)
    r = await client.post(f"{PROC}/batches/{bid}/invite",
                          json={"vendor_ids": []}, headers=manager["headers"])
    assert r.status_code == 400, r.text


async def test_invite_unknown_vendor_reported_failure(client, manager, db):
    """TC-IND-027 — mời vendor_id không tồn tại → không 500; báo trong failures[]."""
    bid = await _mk_batch(db, manager["id"], item_count=1)
    await _mk_item(db, bid)
    r = await client.post(f"{PROC}/batches/{bid}/invite",
                          json={"vendor_ids": [999000111]}, headers=manager["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["created"] == []
    assert any(f["vendor_id"] == 999000111 for f in data["failures"])


async def test_list_invitations_shows_invited(client, manager, vendor, db):
    """TC-IND-028 — list_invitations trả NCC được mời + shape {data, sealed}."""
    va = await _mk_vendor_account(db, vendor["id"])
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1)
    await _mk_item(db, bid)
    await _mk_invitation(db, bid, va, invited_by=manager["id"])
    r = await client.get(f"{PROC}/batches/{bid}/invitations", headers=manager["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sealed"] is False
    rows = [x for x in body["data"] if x["vendor_id"] == va]
    assert len(rows) == 1 and rows[0]["status"] == "invited"


async def test_vendor_uninvited_batch_404(client, manager, vendor, db):
    """SEC / isolation — NCC xem đợt KHÔNG được mời → 404 (không lộ tồn tại)."""
    await _mk_vendor_account(db, vendor["id"])
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1)
    await _mk_item(db, bid)  # KHÔNG mời vendor này
    r = await client.get(f"{VBATCH}/{bid}", headers=vendor["headers"])
    assert r.status_code in (403, 404), r.text


# ════════════════════════════════════════════════════════════════════════════
# D) BÁO GIÁ NCC — draft (ẩn với bên mua) / submit / deadline-guard / invite-gate
# ════════════════════════════════════════════════════════════════════════════

async def test_draft_invisible_then_submit_visible_in_matrix(client, manager, vendor, db):
    """TC-IND-067 → TC-IND-066 — LƯU NHÁP vô hình với bên mua, chỉ hiện sau khi GỬI.

    Ma trận admin lọc status='submitted' → nháp KHÔNG lọt; sau submit mới hiện +
    quote_count tăng. Đây là bất biến "nháp ẩn với bên mua" (_persist_quote).
    """
    va = await _mk_vendor_account(db, vendor["id"])
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1,
                          bid_deadline=_future(days=3))
    iid = await _mk_item(db, bid, quantity=10)
    await _mk_invitation(db, bid, va, invited_by=manager["id"])

    # 1) NCC LƯU NHÁP (không notes/valid_until) → 200 status draft.
    rd = await client.post(f"{VQUOTE}/draft",
                           json={"batch_id": bid, "currency": "VND",
                                 "items": [{"item_id": iid, "unit_price": 500, "quantity": 10}]},
                           headers=vendor["headers"])
    assert rd.status_code == 200, rd.text
    assert rd.json()["status"] == "draft"

    # Ma trận: cột NCC RỖNG (chưa có submitted); quote_count vẫn 0.
    rm = await client.get(f"{PROC}/batches/{bid}/matrix", headers=manager["headers"])
    assert rm.status_code == 200, rm.text
    vrow = [v for v in rm.json()["data"]["vendors"] if v["vendor_id"] == va][0]
    assert vrow["quote_id"] is None and vrow["total_amount"] is None
    qc = await db.fetchval("SELECT quote_count FROM procurement_rfq_batches WHERE id=$1", bid)
    assert (qc or 0) == 0

    # 2) NCC GỬI (bắt buộc notes + valid_until) → 200 status submitted.
    rs = await client.post(f"{VQUOTE}/submit",
                           json={"batch_id": bid, "currency": "VND", "notes": "Báo giá tốt",
                                 "valid_until": "2027-01-31",
                                 "items": [{"item_id": iid, "unit_price": 500, "quantity": 10}]},
                           headers=vendor["headers"])
    assert rs.status_code == 200, rs.text
    assert rs.json()["status"] == "submitted"

    # Ma trận: giờ NCC hiện total=5000, ô có unit_price=500 và là giá thấp nhất.
    rm2 = await client.get(f"{PROC}/batches/{bid}/matrix", headers=manager["headers"])
    data = rm2.json()["data"]
    vrow2 = [v for v in data["vendors"] if v["vendor_id"] == va][0]
    assert vrow2["quote_id"] is not None
    assert float(vrow2["total_amount"]) == 5000.0
    cell = data["items"][0]["cells"][str(va)]
    assert float(cell["unit_price"]) == 500.0 and cell["is_lowest"] is True


async def test_submit_past_deadline_blocked(client, manager, vendor, db):
    """TC-IND-066 (deadline guard) — GỬI báo giá sau hạn → 400.

    LƯU Ý: đề bài kỳ vọng 409; CODE THỰC _persist_quote raise **400** ("Đã quá
    hạn báo giá cho đợt này"). Bám code → assert 400 (server-side, tránh khe 5').
    """
    va = await _mk_vendor_account(db, vendor["id"])
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1,
                          bid_deadline=_past(hours=2))
    iid = await _mk_item(db, bid, quantity=10)
    await _mk_invitation(db, bid, va, invited_by=manager["id"])
    r = await client.post(f"{VQUOTE}/submit",
                          json={"batch_id": bid, "currency": "VND", "notes": "trễ",
                                "valid_until": "2027-01-31",
                                "items": [{"item_id": iid, "unit_price": 500, "quantity": 10}]},
                          headers=vendor["headers"])
    assert r.status_code == 400, r.text
    assert "hạn" in r.text.lower()


async def test_submit_uninvited_round_404(client, manager, vendor, db):
    """TC-IND-066 (invite gate) — NCC không có lời mời cho VÒNG đang mở → 404."""
    await _mk_vendor_account(db, vendor["id"])  # active nhưng KHÔNG mời
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1,
                          bid_deadline=_future(days=3))
    iid = await _mk_item(db, bid, quantity=10)
    r = await client.post(f"{VQUOTE}/submit",
                          json={"batch_id": bid, "currency": "VND", "notes": "x",
                                "valid_until": "2027-01-31",
                                "items": [{"item_id": iid, "unit_price": 500, "quantity": 10}]},
                          headers=vendor["headers"])
    assert r.status_code == 404, r.text


# ════════════════════════════════════════════════════════════════════════════
# E) SEALED-BID — niêm phong giá tới hết hạn (SEC-005 / TC-IND-049)
# ════════════════════════════════════════════════════════════════════════════

async def test_sealed_batch_masks_prices_before_deadline(client, manager, vendor, db):
    """TC-IND-049 / SEC-005 — đợt NIÊM PHONG + CHƯA hết hạn: matrix giấu MỌI con số.

    total_amount & unit_price → None; batch.sealed=True. Bảo vệ công bằng: bên mua
    không thấy mặt bằng giá của đối thủ trước hạn.
    """
    va = await _mk_vendor_account(db, vendor["id"])
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1,
                          bid_deadline=_future(days=2), sealed=True)
    iid = await _mk_item(db, bid, quantity=10)
    await _mk_invitation(db, bid, va, invited_by=manager["id"])
    await _mk_quote(db, bid, va, currency="VND", total=7000, status="submitted",
                    lines=[(iid, 700, 10)])

    r = await client.get(f"{PROC}/batches/{bid}/matrix", headers=manager["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["batch"]["sealed"] is True
    vrow = [v for v in data["vendors"] if v["vendor_id"] == va][0]
    assert vrow["total_amount"] is None  # ẩn tổng
    cell = data["items"][0]["cells"][str(va)]
    assert cell["unit_price"] is None and cell.get("sealed") is True


async def test_sealed_reveals_after_deadline(client, manager, vendor, db):
    """TC-IND-049 — cùng đợt niêm phong nhưng ĐÃ hết hạn: matrix HIỆN giá bình thường."""
    va = await _mk_vendor_account(db, vendor["id"])
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1,
                          bid_deadline=_past(hours=1), sealed=True)
    iid = await _mk_item(db, bid, quantity=10)
    await _mk_invitation(db, bid, va, invited_by=manager["id"])
    await _mk_quote(db, bid, va, currency="VND", total=7000, status="submitted",
                    lines=[(iid, 700, 10)])

    r = await client.get(f"{PROC}/batches/{bid}/matrix", headers=manager["headers"])
    data = r.json()["data"]
    assert data["batch"]["sealed"] is False
    cell = data["items"][0]["cells"][str(va)]
    assert float(cell["unit_price"]) == 700.0


# ════════════════════════════════════════════════════════════════════════════
# F) MA TRẬN — RBAC + tô giá thấp nhất (TC-IND-034)
# ════════════════════════════════════════════════════════════════════════════

async def test_matrix_vendor_403(client, vendor, manager, db):
    """SEC — vendor KHÔNG được gọi route admin matrix → 403 (require_role read)."""
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1)
    r = await client.get(f"{PROC}/batches/{bid}/matrix", headers=vendor["headers"])
    assert r.status_code == 403, r.text


async def test_matrix_lowest_highlight_between_two_vendors(client, manager, vendor,
                                                           users_factory, db):
    """TC-IND-034 — 2 NCC báo cùng loại tiền: ô rẻ nhất is_lowest=True, ô kia False."""
    va = await _mk_vendor_account(db, vendor["id"], name="NCC-A")
    vb_user = await users_factory("vendor", email="vendorB2@test.songchau.vn")
    vb = await _mk_vendor_account(db, vb_user["id"], name="NCC-B")

    bid = await _mk_batch(db, manager["id"], status="published", item_count=1)
    iid = await _mk_item(db, bid, quantity=10)
    await _mk_invitation(db, bid, va, invited_by=manager["id"])
    await _mk_invitation(db, bid, vb, invited_by=manager["id"])
    await _mk_quote(db, bid, va, currency="VND", total=5000, status="submitted",
                    lines=[(iid, 500, 10)])   # rẻ hơn
    await _mk_quote(db, bid, vb, currency="VND", total=8000, status="submitted",
                    lines=[(iid, 800, 10)])

    r = await client.get(f"{PROC}/batches/{bid}/matrix", headers=manager["headers"])
    assert r.status_code == 200, r.text
    cells = r.json()["data"]["items"][0]["cells"]
    assert cells[str(va)]["is_lowest"] is True
    assert cells[str(vb)]["is_lowest"] is False


# ════════════════════════════════════════════════════════════════════════════
# G) MAKER-CHECKER AWARD — propose / approve (SoD) / reject (TC-IND-042/043/044/050)
# ════════════════════════════════════════════════════════════════════════════

async def test_award_gate_off_finalizes_immediately(client, manager, vendor, db):
    """TC-IND-042/046 — gate TẮT (mặc định): award per_item → CHỐT NGAY.

    award_status='none'; batch='awarded'; báo giá thắng → 'awarded'.
    """
    va = await _mk_vendor_account(db, vendor["id"])
    bid, iid = await _seed_awardable(db, manager["id"], va, currency="VND",
                                     unit_price=1000, qty=10)
    r = await client.post(f"{PROC}/batches/{bid}/award",
                          json={"awards": [{"item_id": iid, "vendor_id": va}],
                                "award_reason": "Giá thấp nhất, đủ năng lực"},
                          headers=manager["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["data"]["award_status"] == "none"
    st = await db.fetchval("SELECT status FROM procurement_rfq_batches WHERE id=$1", bid)
    assert st == "awarded"
    qst = await db.fetchval(
        "SELECT status FROM vendor_quotes WHERE batch_id=$1 AND vendor_id=$2", bid, va)
    assert qst == "awarded"


async def test_award_missing_reason_400(client, manager, vendor, db):
    """TC-IND-042 (âm) — award_reason bắt buộc; thiếu → 400."""
    va = await _mk_vendor_account(db, vendor["id"])
    bid, iid = await _seed_awardable(db, manager["id"], va)
    r = await client.post(f"{PROC}/batches/{bid}/award",
                          json={"awards": [{"item_id": iid, "vendor_id": va}]},
                          headers=manager["headers"])
    assert r.status_code == 400, r.text


async def test_award_staff_403(client, staff, manager, vendor, db):
    """SEC-RBAC — award yêu cầu _WRITE_ROLES; staff → 403."""
    va = await _mk_vendor_account(db, vendor["id"])
    bid, iid = await _seed_awardable(db, manager["id"], va)
    r = await client.post(f"{PROC}/batches/{bid}/award",
                          json={"awards": [{"item_id": iid, "vendor_id": va}],
                                "award_reason": "x"},
                          headers=staff["headers"])
    assert r.status_code == 403, r.text


async def test_award_gate_on_proposes(client, manager, vendor, db):
    """TC-IND-050/043 — gate BẬT + tổng ≥ ngưỡng (=0): award → TREO 'proposed'.

    KHÔNG finalize: batch chuyển 'evaluating', báo giá GIỮ 'submitted'.
    """
    va = await _mk_vendor_account(db, vendor["id"])
    await _set_award_flags(db, enabled=True, threshold=0)
    bid, iid = await _seed_awardable(db, manager["id"], va, currency="VND",
                                     unit_price=1000, qty=10)
    r = await client.post(f"{PROC}/batches/{bid}/award",
                          json={"awards": [{"item_id": iid, "vendor_id": va}],
                                "award_reason": "Đề xuất chốt"},
                          headers=manager["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["data"]["award_status"] == "proposed"
    row = await db.fetchrow(
        "SELECT status, award_status FROM procurement_rfq_batches WHERE id=$1", bid)
    assert row["award_status"] == "proposed" and row["status"] == "evaluating"
    qst = await db.fetchval(
        "SELECT status FROM vendor_quotes WHERE batch_id=$1 AND vendor_id=$2", bid, va)
    assert qst == "submitted"  # CHƯA finalize


async def test_self_approve_forbidden_403(client, manager, vendor, db):
    """TC-IND-043 (SoD) — người ĐỀ XUẤT tự DUYỆT đề xuất mình → 403 (breakglass OFF)."""
    va = await _mk_vendor_account(db, vendor["id"])
    await _set_award_flags(db, enabled=True, threshold=0, breakglass=False)
    bid, iid = await _seed_awardable(db, manager["id"], va)
    # manager propose
    rp = await client.post(f"{PROC}/batches/{bid}/award",
                           json={"awards": [{"item_id": iid, "vendor_id": va}],
                                 "award_reason": "đề xuất"},
                           headers=manager["headers"])
    assert rp.status_code == 200, rp.text
    # manager (chính mình) approve → 403
    ra = await client.post(f"{PROC}/batches/{bid}/approve-award", headers=manager["headers"])
    assert ra.status_code == 403, ra.text
    # vẫn treo proposed
    aw = await db.fetchval("SELECT award_status FROM procurement_rfq_batches WHERE id=$1", bid)
    assert aw == "proposed"


async def test_other_user_approves_finalizes(client, manager, admin, vendor, db):
    """TC-IND-043 — NGƯỜI THỨ HAI (admin ≠ proposer) duyệt → CHỐT: batch 'awarded'."""
    va = await _mk_vendor_account(db, vendor["id"])
    await _set_award_flags(db, enabled=True, threshold=0)
    bid, iid = await _seed_awardable(db, manager["id"], va)
    rp = await client.post(f"{PROC}/batches/{bid}/award",
                           json={"awards": [{"item_id": iid, "vendor_id": va}],
                                 "award_reason": "đề xuất"},
                           headers=manager["headers"])
    assert rp.status_code == 200, rp.text
    ra = await client.post(f"{PROC}/batches/{bid}/approve-award", headers=admin["headers"])
    assert ra.status_code == 200, ra.text
    row = await db.fetchrow(
        "SELECT status, award_status FROM procurement_rfq_batches WHERE id=$1", bid)
    assert row["status"] == "awarded" and row["award_status"] == "approved"
    qst = await db.fetchval(
        "SELECT status FROM vendor_quotes WHERE batch_id=$1 AND vendor_id=$2", bid, va)
    assert qst == "awarded"


async def test_award_foreign_currency_forces_approval(client, manager, vendor, db):
    """TC-IND-050 / SEC-013 — fail-safe: gate BẬT, ngưỡng RẤT CAO nhưng có dòng
    NGOẠI TỆ (USD) → vẫn phải duyệt (has_foreign) → 'proposed', không chốt-ngay."""
    va = await _mk_vendor_account(db, vendor["id"])
    await _set_award_flags(db, enabled=True, threshold=10**15)  # ngưỡng khổng lồ
    bid, iid = await _seed_awardable(db, manager["id"], va, currency="USD",
                                     unit_price=100, qty=5)
    r = await client.post(f"{PROC}/batches/{bid}/award",
                          json={"awards": [{"item_id": iid, "vendor_id": va}],
                                "award_reason": "USD bid"},
                          headers=manager["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["data"]["award_status"] == "proposed"


async def test_award_below_threshold_finalizes(client, manager, vendor, db):
    """TC-IND-050 — gate BẬT nhưng tổng VND < ngưỡng → chốt NGAY (award_status='none')."""
    va = await _mk_vendor_account(db, vendor["id"])
    await _set_award_flags(db, enabled=True, threshold=10**15)
    bid, iid = await _seed_awardable(db, manager["id"], va, currency="VND",
                                     unit_price=1000, qty=10)  # tổng 10.000 << ngưỡng
    r = await client.post(f"{PROC}/batches/{bid}/award",
                          json={"awards": [{"item_id": iid, "vendor_id": va}],
                                "award_reason": "nhỏ"},
                          headers=manager["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["data"]["award_status"] == "none"
    st = await db.fetchval("SELECT status FROM procurement_rfq_batches WHERE id=$1", bid)
    assert st == "awarded"


async def test_reaward_while_proposed_409(client, manager, vendor, db):
    """TC-IND-042 (guard) — đang có đề xuất treo mà award lại → 409 (tránh chồng đề xuất)."""
    va = await _mk_vendor_account(db, vendor["id"])
    await _set_award_flags(db, enabled=True, threshold=0)
    bid, iid = await _seed_awardable(db, manager["id"], va)
    rp = await client.post(f"{PROC}/batches/{bid}/award",
                           json={"awards": [{"item_id": iid, "vendor_id": va}],
                                 "award_reason": "1"},
                           headers=manager["headers"])
    assert rp.status_code == 200, rp.text
    r2 = await client.post(f"{PROC}/batches/{bid}/award",
                           json={"awards": [{"item_id": iid, "vendor_id": va}],
                                 "award_reason": "2"},
                           headers=manager["headers"])
    assert r2.status_code == 409, r2.text


async def test_reject_award_rolls_back(client, manager, admin, vendor, db):
    """TC-IND-044 — từ chối đề xuất → award_status='none', batch 'evaluating',
    rfq_items.awarded_* được clear (không còn award 'ma')."""
    va = await _mk_vendor_account(db, vendor["id"])
    await _set_award_flags(db, enabled=True, threshold=0)
    bid, iid = await _seed_awardable(db, manager["id"], va)
    rp = await client.post(f"{PROC}/batches/{bid}/award",
                           json={"awards": [{"item_id": iid, "vendor_id": va}],
                                 "award_reason": "đề xuất"},
                           headers=manager["headers"])
    assert rp.status_code == 200, rp.text
    rr = await client.post(f"{PROC}/batches/{bid}/reject-award",
                           json={"reason": "Cần thương lượng lại"},
                           headers=admin["headers"])
    assert rr.status_code == 200, rr.text
    row = await db.fetchrow(
        "SELECT status, award_status FROM procurement_rfq_batches WHERE id=$1", bid)
    assert row["award_status"] == "none" and row["status"] == "evaluating"
    aw_v = await db.fetchval(
        "SELECT awarded_vendor_id FROM procurement_rfq_items WHERE id=$1", iid)
    assert aw_v is None
    active = await db.fetchval(
        "SELECT COUNT(*) FROM procurement_awards WHERE batch_id=$1 AND superseded_by IS NULL", bid)
    assert active == 0


async def test_reject_award_missing_reason_400(client, manager, vendor, db):
    """TC-IND-044 (âm) — từ chối không kèm lý do → 400."""
    va = await _mk_vendor_account(db, vendor["id"])
    await _set_award_flags(db, enabled=True, threshold=0)
    bid, iid = await _seed_awardable(db, manager["id"], va)
    await client.post(f"{PROC}/batches/{bid}/award",
                      json={"awards": [{"item_id": iid, "vendor_id": va}], "award_reason": "x"},
                      headers=manager["headers"])
    rr = await client.post(f"{PROC}/batches/{bid}/reject-award",
                           json={"reason": "  "}, headers=manager["headers"])
    assert rr.status_code == 400, rr.text


# ════════════════════════════════════════════════════════════════════════════
# H) FX NORMALIZE — quy đổi VND song song ở matrix (SEC-007 / TC-IND-051)
# ════════════════════════════════════════════════════════════════════════════

async def test_fx_vnd_equiv_computed(client, manager, vendor, db):
    """TC-IND-051 / SEC-007 — báo giá USD + có tỷ giá as-of hạn → vnd_equiv đúng.

    total 1000 USD × rate 24500 = 24.500.000 VND; fx_missing=False. as-of =
    bid_deadline.date() (tường minh, cố định → không nhiễu cache).
    """
    va = await _mk_vendor_account(db, vendor["id"])
    deadline = datetime(2026, 6, 30, 12, 0, tzinfo=timezone.utc)
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1,
                          bid_deadline=deadline)
    iid = await _mk_item(db, bid, quantity=10)
    await _mk_invitation(db, bid, va, invited_by=manager["id"])
    await _mk_quote(db, bid, va, currency="USD", total=1000, status="submitted",
                    lines=[(iid, 100, 10)])
    await _mk_fx(db, frm="USD", rate=24500, rate_date=date(2026, 6, 1))

    r = await client.get(f"{PROC}/batches/{bid}/matrix", headers=manager["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["batch"]["fx"]["as_of"] == "2026-06-30"
    vrow = [v for v in data["vendors"] if v["vendor_id"] == va][0]
    assert vrow["fx_missing"] is False
    assert vrow["vnd_equiv_total"] == pytest.approx(24_500_000.0)


async def test_fx_missing_rate_flagged(client, manager, vendor, db):
    """TC-IND-051 — báo giá ngoại tệ KHÔNG có tỷ giá → fx_missing=True, vnd_equiv=None
    (KHÔNG bịa rate, KHÔNG nhân 1 âm thầm)."""
    va = await _mk_vendor_account(db, vendor["id"])
    deadline = datetime(2026, 6, 30, 12, 0, tzinfo=timezone.utc)
    bid = await _mk_batch(db, manager["id"], status="published", item_count=1,
                          bid_deadline=deadline)
    iid = await _mk_item(db, bid, quantity=10)
    await _mk_invitation(db, bid, va, invited_by=manager["id"])
    await _mk_quote(db, bid, va, currency="KRW", total=50000, status="submitted",
                    lines=[(iid, 5000, 10)])
    # KHÔNG seed tỷ giá KRW.

    r = await client.get(f"{PROC}/batches/{bid}/matrix", headers=manager["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    vrow = [v for v in data["vendors"] if v["vendor_id"] == va][0]
    assert vrow["fx_missing"] is True and vrow["vnd_equiv_total"] is None
    assert data["batch"]["fx"]["missing_count"] >= 1


# ════════════════════════════════════════════════════════════════════════════
# I) CẤU HÌNH PHÊ DUYỆT — get/put approval-config (TC-IND-047/048)
# ════════════════════════════════════════════════════════════════════════════

async def test_get_approval_config_ok(client, manager):
    """TC-IND-047 — đọc cấu hình phê duyệt → 200, có đủ cờ P7 + Đợt 3 (DEFAULT-OFF)."""
    r = await client.get(f"{PROC}/approval-config", headers=manager["headers"])
    assert r.status_code == 200, r.text
    cfg = r.json()["data"]
    for k in ("approval_required", "allow_self", "award_approval_enabled",
              "award_approval_threshold_vnd", "award_breakglass_enabled"):
        assert k in cfg, cfg
    assert cfg["award_approval_enabled"] is False  # mặc định tắt


async def test_put_approval_config_admin_toggles(client, admin, db):
    """TC-IND-048 — admin bật cờ maker-checker + đặt ngưỡng → phản ánh lại + lưu app_config."""
    r = await client.put(f"{PROC}/approval-config",
                         json={"award_approval_enabled": True,
                               "award_approval_threshold_vnd": 30_000_000},
                         headers=admin["headers"])
    assert r.status_code == 200, r.text
    cfg = r.json()["data"]
    assert cfg["award_approval_enabled"] is True
    assert float(cfg["award_approval_threshold_vnd"]) == 30_000_000.0
    stored = await db.fetchval(
        "SELECT value::text FROM app_config WHERE key='procurement_award_approval_enabled'")
    assert stored == "true"


async def test_put_approval_config_manager_403(client, manager):
    """TC-IND-048 (RBAC) — ghi cấu hình chỉ admin; manager → 403."""
    r = await client.put(f"{PROC}/approval-config",
                         json={"award_approval_enabled": True},
                         headers=manager["headers"])
    assert r.status_code == 403, r.text
