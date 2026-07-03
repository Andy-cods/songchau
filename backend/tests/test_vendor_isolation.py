"""W1-03 — CÁCH LY CỔNG NHÀ CUNG CẤP (bảo mật số 1).

Nguyên tắc tối thượng của ERP Song Châu: **giá/thông tin NỘI BỘ không bao giờ rò
qua cổng NCC** (`/api/vendor/*`). Một NCC mở DevTools và đọc thẳng JSON response —
nếu trong đó có `target_price` (giá đích bên mua), giá vốn (`cost_*`,
`purchase_price_*`), ghi chú nội bộ (`notes_internal`), số RFQ khách
(`source_bqms_rfq_number`), hay ĐƠN GIÁ của NCC ĐỐI THỦ → phá vỡ toàn bộ tính công
bằng đấu thầu. File này chốt chặn đó bằng test tự động.

Chiến lược
──────────
1. Seed (qua fixture `db`, rollback sau test) một đợt đấu thầu HOÀN CHỈNH mang các
   trường nội-bộ với GIÁ TRỊ SENTINEL DUY NHẤT:
       * batch.notes_internal          = SENTINEL_NOTE
       * batch.source_bqms_rfq_number  = SENTINEL_RFQ
       * item.target_price             = SENTINEL_NUM (987654321)
       * item.source_ref_id            = SENTINEL_NUM
       * item.source_bqms_rfq_id       = SENTINEL_NUM
       * báo giá của NCC ĐỐI THỦ (vendor B): total_amount/unit_price = SENTINEL_NUM,
         notes = SENTINEL_COMPETITOR
   NCC đăng nhập (vendor A) có báo giá RIÊNG với giá THƯỜNG (không sentinel) để
   phân biệt "được phép thấy giá của mình" vs "cấm thấy sentinel nội bộ".

2. LIỆT KÊ ĐỘNG mọi route GET dưới `/api/vendor/*` từ `app.routes` lúc chạy
   (KHÔNG hardcode — thêm endpoint mới là tự động được quét). Gọi từng cái bằng
   token vendor A, rồi QUÉT ĐỆ QUY toàn bộ JSON:
       * KHÔNG có KEY nhạy cảm nào (target_price, cost_*, quoted_price_v1..4,
         notes_internal, source_ref_id, purchase_price_*, won_price, ...).
       * KHÔNG có GIÁ TRỊ SENTINEL nào (raw-text scan bắt mọi kiểu mã hoá số/chuỗi).

3. Cách ly tenant: vendor A gọi tài nguyên của vendor B (đợt không được mời, PO của
   B) ⇒ 404/403, KHÔNG lộ tồn tại.

──────────────────────────────────────────────────────────────────────────────
MUTATION-CHECK (bằng chứng test THỰC SỰ bắt lỗi — hãy tự kiểm định kỳ)
──────────────────────────────────────────────────────────────────────────────
Test này phải ĐỎ nếu ai đó vô tình rò giá nội bộ. Chứng minh nhanh:

  A) Rò KEY + rò VALUE cùng lúc — sửa `app/api/vendor/batches.py`, thêm
     `target_price` vào câu SELECT items trong `get_invited_batch_detail`:

         SELECT id, item_no, specification, bqms_code, quantity, unit,
                required_material, drawing_url, drawing_filename, notes,
                dimension, maker, part_no, moq,
                product_name, model,
                target_price            -- ⬅️ THÊM DÒNG NÀY (cố tình rò)
           FROM procurement_rfq_items
          WHERE batch_id = $1

     Chạy lại: `test_vendor_endpoints_never_leak_internal_fields` PHẢI FAIL với
     "key nhạy cảm 'target_price'" VÀ "sentinel 987654321" tại endpoint
     `/api/vendor/batches/{batch_id}`. Gỡ dòng đó ⇒ xanh lại.

  B) Rò báo giá ĐỐI THỦ — trong `my_quotes` (quotes.py) đổi `WHERE vq.vendor_id=$1`
     thành bỏ điều kiện (JOIN mọi vendor). `test_my_quotes_no_competitor_leak`
     PHẢI FAIL vì thấy SENTINEL_COMPETITOR / 987654321 của vendor B.

  C) `test_scanner_selfcheck` (mark smoke, KHÔNG cần DB) cắm sẵn một payload rò để
     chứng minh bộ quét đệ quy hoạt động — nếu ai làm hỏng helper, test này đỏ
     ngay mà không phụ thuộc schema.
"""
from __future__ import annotations

import re
from typing import Any, Iterator

import pytest
import pytest_asyncio

# ── Sentinels: giá trị "không thể xuất hiện hợp lệ" ở cổng NCC ───────────────
SENTINEL_NUM = 987654321                    # target_price / source_ref_id / giá đối thủ
SENTINEL_NOTE = "SECRET_INTERNAL_NOTE_XyZ987"       # batch.notes_internal
SENTINEL_RFQ = "SECRET_CUST_RFQ_XyZ987"             # batch.source_bqms_rfq_number
SENTINEL_COMPETITOR = "SECRET_COMPETITOR_NOTE_XyZ987"  # notes báo giá vendor B

# Chuỗi con phải KHÔNG xuất hiện trong bất kỳ response nào của vendor A.
SENTINEL_STRINGS: tuple[str, ...] = (
    str(SENTINEL_NUM),
    SENTINEL_NOTE,
    SENTINEL_RFQ,
    SENTINEL_COMPETITOR,
)

# ── Danh sách KEY nội-bộ TUYỆT MẬT (khớp đệ quy trên mọi cấp JSON) ───────────
FORBIDDEN_EXACT = {
    "target_price",
    "cost_ncc",
    "notes_internal",
    "source_ref_id",
    "source_bqms_rfq_id",
    "source_bqms_rfq_number",
    "purchase_price_rmb",
    "purchase_price_vnd",
    "won_price",
    "criteria_currency",   # tiêu chí nội bộ bên mua
}
# Mẫu prefix/pattern: cost_* (cost_vnd/usd/rmb/jpy/krw/amount/price/vat) và
# quoted_price_v1..v4. Dùng regex để không bỏ sót biến thể.
_FORBIDDEN_PATTERNS = (
    re.compile(r"^cost(_.*)?$"),
    re.compile(r"^quoted_price_v\d+$"),
    re.compile(r"^purchase_price(_.*)?$"),
)


def _is_forbidden_key(key: str) -> bool:
    k = key.lower()
    if k in FORBIDDEN_EXACT:
        return True
    return any(p.match(k) for p in _FORBIDDEN_PATTERNS)


# ── Bộ quét đệ quy dùng chung ───────────────────────────────────────────────
def iter_items(obj: Any, path: str = "$") -> Iterator[tuple[str, Any, Any]]:
    """Duyệt ĐỆ QUY mọi (path, key, value) trong cấu trúc JSON.

    dict → yield từng (path, key, value) rồi đệ quy value.
    list → đệ quy từng phần tử (key=None).
    """
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield (f"{path}.{k}", k, v)
            yield from iter_items(v, f"{path}.{k}")
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            yield from iter_items(v, f"{path}[{i}]")


def forbidden_keys_in(obj: Any) -> list[tuple[str, str]]:
    """Trả về [(path, key)] cho mọi KEY nhạy cảm tìm thấy đệ quy."""
    return [
        (path, key)
        for path, key, _ in iter_items(obj)
        if key is not None and _is_forbidden_key(key)
    ]


def sentinels_in_text(text: str) -> list[str]:
    """Trả về các sentinel (chuỗi/số) xuất hiện trong raw JSON text.

    Raw-text scan cố ý: bắt MỌI kiểu mã hoá — số int/float, Decimal-as-string,
    lồng trong chuỗi — mà cách duyệt theo kiểu có thể bỏ sót.
    """
    return [s for s in SENTINEL_STRINGS if s in text]


# ── Guard: chỉ chạy khi có full prod schema; smoke không kích hoạt schema ────
@pytest.fixture(autouse=True)
def _require_full_schema(request):
    if request.node.get_closest_marker("integration"):
        info = request.getfixturevalue("schema_info")
        if not info["full_schema"]:
            pytest.skip(
                "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
                "(pg_dump --schema-only). Schema đang nạp: " + info["source"]
            )


# ── Seed một thế giới đấu thầu đầy đủ (2 NCC, 1 đợt chung + 1 đợt B-only) ────
@pytest_asyncio.fixture
async def world(db, manager, vendor, users_factory):
    """Seed dữ liệu nội-bộ có sentinel + 2 vendor_accounts (A = fixture `vendor`).

    Trả dict id để test dùng. Mọi thứ nằm trong transaction rollback của `db`.
    """
    creator = manager["id"]  # uuid nội bộ cho created_by

    # Vendor A = user của fixture `vendor` → gắn vendor_accounts ACTIVE.
    vendor_a_id = await db.fetchval(
        """
        INSERT INTO vendor_accounts (user_id, company_name, contact_name,
                                     is_approved, status)
        VALUES ($1, 'Cty NCC A (đăng nhập)', 'Người A', true, 'active')
        RETURNING id
        """,
        vendor["id"],
    )

    # Vendor B = NCC đối thủ (không đăng nhập trong test).
    vendor_b_user = await users_factory("vendor", email="vendorB@test.songchau.vn")
    vendor_b_id = await db.fetchval(
        """
        INSERT INTO vendor_accounts (user_id, company_name, contact_name,
                                     is_approved, status)
        VALUES ($1, 'Cty NCC B (đối thủ)', 'Người B', true, 'active')
        RETURNING id
        """,
        vendor_b_user["id"],
    )

    # Đợt đấu thầu CHUNG (A + B đều được mời) — mang sentinel nội bộ.
    batch_id = await db.fetchval(
        """
        INSERT INTO procurement_rfq_batches
            (batch_code, title, status, created_by, item_count, published_at,
             current_round, award_mode, notes_internal, source_bqms_rfq_number,
             visibility)
        VALUES ('BID-ISO-001', 'Đợt test cách ly', 'published', $1, 1, NOW(),
                1, 'per_item', $2, $3, 'invited')
        RETURNING id
        """,
        creator, SENTINEL_NOTE, SENTINEL_RFQ,
    )

    # LƯU Ý kiểu asyncpg: target_price là `numeric`, còn source_ref_id +
    # source_bqms_rfq_id là `bigint`. KHÔNG dùng chung 1 placeholder cho cả ba —
    # asyncpg suy kiểu tham số từ ngữ cảnh cột, nếu $2 vừa numeric vừa bigint sẽ
    # ném AmbiguousParameterError ("inconsistent types deduced ... numeric vs
    # bigint"). Tách $2 (numeric, giá) và $3 (bigint, cả hai id) — VẪN truyền
    # cùng SENTINEL_NUM để test bắt được value rò ở mọi cột.
    item_id = await db.fetchval(
        """
        INSERT INTO procurement_rfq_items
            (batch_id, item_no, specification, quantity, unit, target_price,
             source_kind, source_ref_id, source_bqms_rfq_id, notes, bqms_code,
             product_name)
        VALUES ($1, 1, 'Bạc lót thép SUS304', 100, 'EA', $2,
                'bqms', $3, $3, 'Ghi chú công khai cho NCC', 'MRO-TEST-01',
                'Bạc lót')
        RETURNING id
        """,
        batch_id, SENTINEL_NUM, SENTINEL_NUM,
    )

    # Mời cả A và B.
    for v in (vendor_a_id, vendor_b_id):
        await db.execute(
            """
            INSERT INTO procurement_rfq_invitations
                (batch_id, vendor_id, round_number, status)
            VALUES ($1, $2, 1, 'invited')
            """,
            batch_id, v,
        )

    # Báo giá của A — giá THƯỜNG (được phép tự thấy).
    quote_a_id = await db.fetchval(
        """
        INSERT INTO vendor_quotes
            (batch_id, vendor_id, currency, total_amount, status, round_number,
             submitted_at, notes)
        VALUES ($1, $2, 'USD', 5000, 'submitted', 1, NOW(), 'Báo giá của tôi')
        RETURNING id
        """,
        batch_id, vendor_a_id,
    )
    await db.execute(
        """
        INSERT INTO vendor_quote_items (quote_id, item_id, unit_price, quantity)
        VALUES ($1, $2, 50, 100)
        """,
        quote_a_id, item_id,
    )

    # Báo giá của B — SENTINEL (A tuyệt đối không được thấy).
    quote_b_id = await db.fetchval(
        """
        INSERT INTO vendor_quotes
            (batch_id, vendor_id, currency, total_amount, status, round_number,
             submitted_at, notes)
        VALUES ($1, $2, 'USD', $3, 'submitted', 1, NOW(), $4)
        RETURNING id
        """,
        batch_id, vendor_b_id, SENTINEL_NUM, SENTINEL_COMPETITOR,
    )
    await db.execute(
        """
        INSERT INTO vendor_quote_items (quote_id, item_id, unit_price, quantity)
        VALUES ($1, $2, $3, 100)
        """,
        quote_b_id, item_id, SENTINEL_NUM,
    )

    # Đợt CHỈ MỜI B (A KHÔNG được mời) — để test cách ly 404.
    batch_b_only = await db.fetchval(
        """
        INSERT INTO procurement_rfq_batches
            (batch_code, title, status, created_by, item_count, published_at,
             current_round, award_mode, notes_internal)
        VALUES ('BID-ISO-B', 'Đợt riêng của B', 'published', $1, 0, NOW(),
                1, 'per_item', $2)
        RETURNING id
        """,
        creator, SENTINEL_NOTE,
    )
    await db.execute(
        """
        INSERT INTO procurement_rfq_invitations
            (batch_id, vendor_id, round_number, status)
        VALUES ($1, $2, 1, 'invited')
        """,
        batch_b_only, vendor_b_id,
    )

    # PO của A (để endpoint /pos trả dữ liệu thật) — giá THƯỜNG.
    po_a_id = await db.fetchval(
        """
        INSERT INTO procurement_pos
            (po_no, vendor_id, vendor_name, total_amount, currency, status,
             created_by)
        VALUES ('PO-ISO-A', $1, 'Cty NCC A', 6000, 'USD', 'open', $2)
        RETURNING id
        """,
        vendor_a_id, creator,
    )
    await db.execute(
        """
        INSERT INTO procurement_po_items
            (po_id, item_no, specification, ordered_qty, unit, unit_price)
        VALUES ($1, 1, 'Bạc lót thép', 100, 'EA', 60)
        """,
        po_a_id,
    )

    # PO của B (A gọi ⇒ phải 404).
    po_b_id = await db.fetchval(
        """
        INSERT INTO procurement_pos
            (po_no, vendor_id, vendor_name, total_amount, currency, status,
             created_by, notes)
        VALUES ('PO-ISO-B', $1, 'Cty NCC B', $2, 'USD', 'open', $3, $4)
        RETURNING id
        """,
        vendor_b_id, SENTINEL_NUM, creator, SENTINEL_COMPETITOR,
    )

    # Hợp đồng của A (đã gửi) — để /contracts trả dữ liệu thật, giá THƯỜNG.
    contract_a_id = await db.fetchval(
        """
        INSERT INTO procurement_contracts
            (contract_no, batch_id, vendor_id, vendor_name, total_amount,
             currency, status, created_by, sent_to_vendor_at)
        VALUES ('HD-ISO-A', $1, $2, 'Cty NCC A', 6000, 'USD', 'sent', $3, NOW())
        RETURNING id
        """,
        batch_id, vendor_a_id, creator,
    )

    return {
        "vendor_a_id": vendor_a_id,
        "vendor_b_id": vendor_b_id,
        "batch_id": batch_id,
        "item_id": item_id,
        "batch_b_only": batch_b_only,
        "po_a_id": po_a_id,
        "po_b_id": po_b_id,
        "contract_a_id": contract_a_id,
    }


# ── Liệt kê ĐỘNG mọi route GET /api/vendor/* từ app.routes ───────────────────
def _vendor_get_routes() -> list[str]:
    from app.main import app

    paths: list[str] = []
    for r in app.routes:
        path = getattr(r, "path", "")
        methods = getattr(r, "methods", None) or set()
        if path.startswith("/api/vendor/") and "GET" in methods:
            paths.append(path)
    # ổn định thứ tự để thông báo lỗi dễ đọc
    return sorted(set(paths))


def _fill_path(template: str, world: dict) -> str:
    """Thay {param} bằng id đã seed (hoặc id-bịa lớn ⇒ endpoint trả 404 an toàn)."""
    subs = {
        "batch_id": world["batch_id"],
        "item_id": world["item_id"],
        "po_id": world["po_a_id"],
        "contract_id": world["contract_a_id"],
        "notification_id": 999_000_111,
        "delivery_id": 999_000_222,
        "quote_id": 999_000_333,
        "idx": 0,
    }

    def repl(m: re.Match) -> str:
        name = m.group(1)
        return str(subs.get(name, 999_000_999))

    return re.sub(r"\{([^}]+)\}", repl, template)


# Query params vô hại; endpoint bỏ qua cái không dùng. `name` cho download,
# `kind`/`months`/`page`/`limit` cho các list/scorecard.
_SAFE_QUERY = {
    "page": 1,
    "limit": 5,
    "months": 12,
    "kind": "raw",
    "name": "khong-ton-tai.pdf",
}


@pytest.mark.integration
async def test_vendor_endpoints_never_leak_internal_fields(client, vendor, world):
    """QUÉT TOÀN BỘ: mọi GET /api/vendor/* (token vendor A) — không key nhạy cảm,
    không giá trị sentinel, ở BẤT KỲ cấp JSON nào."""
    routes = _vendor_get_routes()
    assert routes, "Không liệt kê được route vendor nào — kiểm tra app.routes"

    leaks: list[str] = []
    checked = 0

    for template in routes:
        url = _fill_path(template, world)
        r = await client.get(url, headers=vendor["headers"], params=_SAFE_QUERY)
        checked += 1

        # 1) Rò VALUE (raw-text, mọi kiểu mã hoá).
        hit = sentinels_in_text(r.text)
        if hit:
            leaks.append(
                f"[{template}] rò SENTINEL {hit} (HTTP {r.status_code}) "
                f"→ body: {r.text[:300]}"
            )

        # 2) Rò KEY nhạy cảm (chỉ khi body là JSON).
        try:
            body = r.json()
        except Exception:
            body = None
        if body is not None:
            bad = forbidden_keys_in(body)
            if bad:
                leaks.append(
                    f"[{template}] rò KEY nhạy cảm {bad} (HTTP {r.status_code})"
                )

    assert checked >= 10, f"Quét quá ít endpoint ({checked}) — nghi ngờ enumeration hỏng"
    assert not leaks, "RÒ THÔNG TIN NỘI BỘ QUA CỔNG NCC:\n" + "\n".join(leaks)


@pytest.mark.integration
async def test_batch_detail_no_sentinel(client, vendor, world):
    """Chi tiết đợt (bề mặt rò chính) — 200, thấy giá CỦA MÌNH, KHÔNG sentinel/key."""
    bid = world["batch_id"]
    r = await client.get(f"/api/vendor/batches/{bid}", headers=vendor["headers"])
    assert r.status_code == 200, r.text

    assert not sentinels_in_text(r.text), "batch detail rò sentinel nội bộ"
    body = r.json()
    assert not forbidden_keys_in(body), "batch detail rò key nội bộ"

    # Sanity: A vẫn thấy báo giá HỢP LỆ của chính mình (không phải test rỗng).
    assert body["data"]["my_quote"] is not None
    assert body["data"]["my_quote"]["total_amount"] is not None
    # item công khai hiển thị nhưng KHÔNG kèm target_price.
    it = body["data"]["items"][0]
    assert "target_price" not in it and "source_ref_id" not in it


@pytest.mark.integration
async def test_my_quotes_no_competitor_leak(client, vendor, world):
    """/quotes/my chỉ trả báo giá của A — không dính giá/ghi chú của B."""
    r = await client.get("/api/vendor/quotes/my", headers=vendor["headers"])
    assert r.status_code == 200, r.text
    assert not sentinels_in_text(r.text), "quotes/my rò dữ liệu NCC đối thủ"
    body = r.json()
    assert not forbidden_keys_in(body)
    # A phải có ít nhất báo giá của mình.
    assert len(body["data"]) >= 1


@pytest.mark.integration
async def test_tenant_isolation_batch_not_invited(client, vendor, world):
    """A xem đợt CHỈ mời B ⇒ 404 (không lộ tồn tại), không rò sentinel."""
    r = await client.get(
        f"/api/vendor/batches/{world['batch_b_only']}", headers=vendor["headers"]
    )
    assert r.status_code in (403, 404), r.text
    assert not sentinels_in_text(r.text)


@pytest.mark.integration
async def test_tenant_isolation_po_cross_vendor(client, vendor, world):
    """A xem PO của B ⇒ 404, và bản thân PO của B mang sentinel không được lộ."""
    r = await client.get(
        f"/api/vendor/pos/{world['po_b_id']}", headers=vendor["headers"]
    )
    assert r.status_code in (403, 404), r.text
    assert not sentinels_in_text(r.text)


@pytest.mark.integration
async def test_prefill_not_invited_is_404(client, vendor, world):
    """Prefill (điền form vòng trước) cho đợt A không được mời ⇒ 404, không rò."""
    r = await client.get(
        f"/api/vendor/quotes/batches/{world['batch_b_only']}/prefill",
        headers=vendor["headers"],
    )
    assert r.status_code in (403, 404), r.text
    assert not sentinels_in_text(r.text)


@pytest.mark.smoke
def test_scanner_selfcheck():
    """Bằng chứng bộ quét THỰC SỰ bắt lỗi (không cần DB).

    Nếu ai làm hỏng `iter_items` / `forbidden_keys_in` / `sentinels_in_text`,
    test này đỏ ngay — nên khi các test integration ở trên xanh, ta biết là xanh
    THẬT (đã seed sentinel + quét đúng), không phải xanh giả.
    """
    planted = {
        "data": {
            "id": 1,
            "total_amount": 5000,               # hợp lệ
            "items": [
                {
                    "item_no": 1,
                    "unit_price": 50,           # hợp lệ
                    "target_price": SENTINEL_NUM,   # rò KEY + VALUE
                    "meta": {"notes_internal": SENTINEL_NOTE},  # rò lồng sâu
                }
            ],
        }
    }
    import json

    # KEY scan bắt cả target_price (nông) lẫn notes_internal (lồng 3 cấp).
    keys = {k for _, k in forbidden_keys_in(planted)}
    assert "target_price" in keys
    assert "notes_internal" in keys

    # VALUE scan (raw-text) bắt số 987654321 và chuỗi bí mật.
    hits = sentinels_in_text(json.dumps(planted))
    assert str(SENTINEL_NUM) in hits
    assert SENTINEL_NOTE in hits

    # Payload SẠCH ⇒ không báo động giả.
    clean = {"data": [{"total_amount": 5000, "unit_price": 50, "currency": "USD"}]}
    assert forbidden_keys_in(clean) == []
    assert sentinels_in_text(json.dumps(clean)) == []
