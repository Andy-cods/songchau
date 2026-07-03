"""W3-05 — Xếp hạng NCC (vendor scorecard): đóng gói `prev_rank` / Δ hạng.

Bối cảnh: `/api/v1/procurement/vendor-scorecard` (list) đã tính `prev_rank` bằng
cách chạy LẠI `_scorecard_factors` trên cửa sổ thời gian LÙI về trước
(`offset_months=months`) rồi xếp hạng bằng `_ranks_from_factors` — HOÀN TOÀN
runtime, KHÔNG cột DB nào lưu prev_rank (prod xác nhận không có cột này). Gap
đóng ở đây: `/vendor-scorecard/{id}` (detail) trước đó KHÔNG bao giờ tính/trả
`rank`/`prev_rank` dù FE (`analytics/vendor-scorecard/page.tsx` dòng
~1004-1007) đã đọc `detail.rank` / `detail.prev_rank` cho mini-stat "Δ hạng" —
field luôn `undefined` nên UI luôn hiện "—" bất kể dữ liệu thật. Đã bổ sung
`_compute_prev_ranks()` (dùng chung cho cả 2 endpoint) + `rank`/`prev_rank`
trong response detail (procurement_analytics.py).

Cách test tạo ra một "swap hạng" THẬT giữa 2 kỳ liên tiếp bằng CHÍNH cơ chế
được factor `response`/`win` đọc — không cần seed vendor_quotes/PO gì cả, chỉ
cần procurement_rfq_invitations (batch_id, vendor_id, status, invited_at). LƯU
Ý: hễ `submitted_batches > 0` thì factor `win` cũng CÓ MẶT (won_batches/submitted
= 0/N = 0.0, không phải None — vì không seed award nào) nên nó tham gia
renormalise CÙNG `response` (mỗi factor trọng số 0.15 gốc → 0.5/0.5 sau khi
renormalise, vì chỉ 2 factor có dữ liệu):

  months=2, min_invites=3 (mặc định).
  Kỳ HIỆN TẠI (invited_at ~20 ngày trước, trong [now-2mo, now]):
    X: 3 lời mời, cả 3 'submitted' → response=1.00, win=0.00 → score=(1.0+0.0)/2*100=50.0  → rank 1
    Y: 3 lời mời, 1 'submitted'    → response=0.33, win=0.00 → score=(0.33+0.0)/2*100=16.7  → rank 2
  Kỳ TRƯỚC (invited_at ~95 ngày trước, trong [now-4mo, now-2mo)):
    X: 3 lời mời, 1 'submitted'    → response=0.33, win=0.00 → score=16.7 → prior rank 2
    Y: 3 lời mời, cả 3 'submitted' → response=1.00, win=0.00 → score=50.0 → prior rank 1

  ⇒ X đi lên (prev_rank=2 → rank=1, Δ=+1); Y đi xuống (prev_rank=1 → rank=2, Δ=-1).
  List và detail PHẢI khớp NHAU tuyệt đối trên cả rank lẫn prev_rank (cùng hàm).

MUTATION-CHECK: xoá dòng `"rank": rank, "prev_rank": prev_rank,` khỏi response
dict của `vendor_scorecard_detail` → `test_detail_rank_prev_rank_matches_list`
PHẢI FAIL (KeyError / None thay vì 1,2).
"""
from __future__ import annotations

import pytest
import pytest_asyncio

pytestmark = pytest.mark.integration

BASE = "/api/v1/procurement/vendor-scorecard"


@pytest.fixture(autouse=True)
def _require_full_schema(request):
    if request.node.get_closest_marker("integration"):
        info = request.getfixturevalue("schema_info")
        if not info["full_schema"]:
            pytest.skip(
                "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
                "(pg_dump --schema-only). Schema đang nạp: " + info["source"]
            )


async def _mk_vendor(db, users_factory, *, email: str, company: str) -> int:
    u = await users_factory("vendor", email=email)
    return await db.fetchval(
        """
        INSERT INTO vendor_accounts (user_id, company_name, contact_name,
                                     is_approved, status)
        VALUES ($1, $2, 'Người liên hệ test', true, 'active')
        RETURNING id
        """,
        u["id"], company,
    )


async def _mk_batch(db, creator_id: str, batch_code: str) -> int:
    return await db.fetchval(
        """
        INSERT INTO procurement_rfq_batches (batch_code, title, created_by)
        VALUES ($1, 'Đợt test xếp hạng NCC', $2)
        RETURNING id
        """,
        batch_code, creator_id,
    )


async def _invite(db, batch_id: int, vendor_id: int, status: str, days_ago: int) -> None:
    # make_interval(days=>$4) thay vì ($4 || ' days')::interval — tránh asyncpg suy
    # kiểu $4 thành text (do || nối chuỗi) rồi từ chối int truyền vào.
    await db.execute(
        """
        INSERT INTO procurement_rfq_invitations
            (batch_id, vendor_id, round_number, status, invited_at)
        VALUES ($1, $2, 1, $3, NOW() - make_interval(days => $4))
        """,
        batch_id, vendor_id, status, days_ago,
    )


@pytest_asyncio.fixture
async def rank_swap_world(db, manager, users_factory):
    """Seed X/Y sao cho hạng ĐẢO NGƯỢC giữa kỳ hiện tại và kỳ trước (xem docstring)."""
    creator = manager["id"]

    vendor_x = await _mk_vendor(db, users_factory, email="rankx@test.songchau.vn", company="Cty NCC X (đi lên)")
    vendor_y = await _mk_vendor(db, users_factory, email="ranky@test.songchau.vn", company="Cty NCC Y (đi xuống)")

    # Kỳ HIỆN TẠI (~20 ngày trước, trong cửa sổ months=2 mặc định của test).
    for i in range(3):
        b = await _mk_batch(db, creator, f"RANK-CUR-X-{i}")
        await _invite(db, b, vendor_x, "submitted", 20)
    for i in range(3):
        b = await _mk_batch(db, creator, f"RANK-CUR-Y-{i}")
        status = "submitted" if i == 0 else "invited"
        await _invite(db, b, vendor_y, status, 20)

    # Kỳ TRƯỚC (~95 ngày trước ⇒ nằm trong [now-4mo, now-2mo) khi offset_months=2).
    for i in range(3):
        b = await _mk_batch(db, creator, f"RANK-PRIOR-X-{i}")
        status = "submitted" if i == 0 else "invited"
        await _invite(db, b, vendor_x, status, 95)
    for i in range(3):
        b = await _mk_batch(db, creator, f"RANK-PRIOR-Y-{i}")
        await _invite(db, b, vendor_y, "submitted", 95)

    return {"vendor_x": vendor_x, "vendor_y": vendor_y}


# ─────────────────────────────────────────────────────────────────────────────
# 1) List endpoint — shape 200 + prev_rank phản ánh swap thật
# ─────────────────────────────────────────────────────────────────────────────

async def test_list_shape_and_rank_swap(client, admin, rank_swap_world):
    r = await client.get(BASE, headers=admin["headers"], params={"months": 2})
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["months"] == 2
    assert "scored_count" in body and "total_count" in body
    rows = body["data"]
    assert isinstance(rows, list) and len(rows) >= 2

    by_id = {row["vendor_id"]: row for row in rows}
    rx = by_id[rank_swap_world["vendor_x"]]
    ry = by_id[rank_swap_world["vendor_y"]]

    # Shape đầy đủ field FE cần trên MỖI dòng.
    for row in (rx, ry):
        for key in (
            "vendor_id", "vendor_name", "score", "grade", "response_rate",
            "win_rate", "on_time_rate", "avg_lead_days", "price_score",
            "insufficient", "prev_rank",
        ):
            assert key in row, f"thiếu field {key!r} trong VendorRow"

    # X đủ dữ liệu, response=100% kỳ hiện tại → score cao nhất, không sparse.
    # score = renormalise(response=1.0, win=0.0) * 100 = (1.0+0.0)/2*100 = 50.0.
    assert rx["insufficient"] is False
    assert rx["score"] == 50.0
    assert ry["insufficient"] is False
    assert round(float(ry["score"]), 1) == 16.7

    # X xếp trước Y trong danh sách đã sort theo score desc (rank ngầm = vị trí).
    idx_x = next(i for i, row in enumerate(rows) if row["vendor_id"] == rx["vendor_id"])
    idx_y = next(i for i, row in enumerate(rows) if row["vendor_id"] == ry["vendor_id"])
    assert idx_x < idx_y, "X (score 50.0) phải xếp TRƯỚC Y (score 16.7)"

    # prev_rank: kỳ trước X yếu (rank 2), Y mạnh (rank 1) — ĐẢO NGƯỢC hạng hiện tại.
    assert rx["prev_rank"] == 2, f"prev_rank X kỳ vọng 2, nhận {rx['prev_rank']}"
    assert ry["prev_rank"] == 1, f"prev_rank Y kỳ vọng 1, nhận {ry['prev_rank']}"


# ─────────────────────────────────────────────────────────────────────────────
# 2) Detail endpoint — GAP ĐÃ ĐÓNG: rank + prev_rank khớp CHÍNH XÁC với list
# ─────────────────────────────────────────────────────────────────────────────

async def test_detail_rank_prev_rank_matches_list(client, admin, rank_swap_world):
    rx = await client.get(f"{BASE}/{rank_swap_world['vendor_x']}", headers=admin["headers"], params={"months": 2})
    ry = await client.get(f"{BASE}/{rank_swap_world['vendor_y']}", headers=admin["headers"], params={"months": 2})
    assert rx.status_code == 200, rx.text[:300]
    assert ry.status_code == 200, ry.text[:300]
    dx = rx.json()["data"]
    dy = ry.json()["data"]

    # Field mới — trước bản vá này KHÔNG tồn tại trong response detail.
    assert "rank" in dx and "prev_rank" in dx
    assert "rank" in dy and "prev_rank" in dy

    # X: đi từ hạng 2 (kỳ trước) lên hạng 1 (hiện tại).
    assert dx["rank"] == 1, f"rank X kỳ vọng 1, nhận {dx['rank']}"
    assert dx["prev_rank"] == 2, f"prev_rank X kỳ vọng 2, nhận {dx['prev_rank']}"

    # Y: đi từ hạng 1 (kỳ trước) xuống hạng 2 (hiện tại).
    assert dy["rank"] == 2, f"rank Y kỳ vọng 2, nhận {dy['rank']}"
    assert dy["prev_rank"] == 1, f"prev_rank Y kỳ vọng 1, nhận {dy['prev_rank']}"

    # score/grade detail phải NHẤT QUÁN với list (cùng _scorecard_factors).
    # score=50.0 (xem docstring đầu file) < 60 ⇒ grade 'C' (_grade: A>=80,B>=60,C<60).
    assert dx["score"] == 50.0
    assert dx["grade"] == "C"


async def test_detail_insufficient_vendor_has_null_rank(client, admin, manager, users_factory, db):
    """NCC insufficient (invited < min_invites) ⇒ score/grade/rank/prev_rank ĐỀU null.

    _ranks_from_factors chỉ xếp hạng vendor sufficient+scored; vendor thiếu dữ
    liệu vắng mặt khỏi dict ranks ⇒ .get(vid) trả None — không bị lộ hạng giả.
    """
    creator = manager["id"]
    vendor_z = await _mk_vendor(db, users_factory, email="rankz@test.songchau.vn", company="Cty NCC Z (mới)")
    # Chỉ 1 lời mời (< min_invites mặc định = 3) ⇒ insufficient.
    b = await _mk_batch(db, creator, "RANK-SPARSE-Z-0")
    await _invite(db, b, vendor_z, "submitted", 5)

    r = await client.get(f"{BASE}/{vendor_z}", headers=admin["headers"], params={"months": 2})
    assert r.status_code == 200, r.text[:300]
    d = r.json()["data"]
    assert d["insufficient"] is True
    assert d["score"] is None
    assert d["grade"] is None
    assert d["rank"] is None
    assert d["prev_rank"] is None


async def test_detail_unknown_vendor_404(client, admin):
    r = await client.get(f"{BASE}/999999999", headers=admin["headers"])
    assert r.status_code == 404, r.text[:200]


# ─────────────────────────────────────────────────────────────────────────────
# 3) RBAC — _READ_ROLES (admin/manager/procurement/staff) + viewer GET bypass
# ─────────────────────────────────────────────────────────────────────────────

async def test_rbac_staff_and_admin_pass(client, admin, staff, rank_swap_world):
    for actor in (admin, staff):
        r = await client.get(BASE, headers=actor["headers"], params={"months": 2})
        assert r.status_code == 200, f"[{actor['role']}] kỳ vọng 200, nhận {r.status_code}: {r.text[:200]}"


async def test_rbac_viewer_get_allowed(client, viewer, rank_swap_world):
    """viewer KHÔNG nằm trong _READ_ROLES nhưng endpoint không set allow_viewer=False
    ⇒ viewer vẫn qua được GET (read-only toàn hệ, hành vi hiện có — không phải giá
    nội bộ per-vendor như /price-lookup)."""
    r = await client.get(BASE, headers=viewer["headers"], params={"months": 2})
    assert r.status_code == 200, r.text[:200]


async def test_rbac_accountant_blocked(client, accountant, rank_swap_world):
    """accountant: không trong _READ_ROLES, không phải viewer ⇒ 403."""
    r = await client.get(BASE, headers=accountant["headers"], params={"months": 2})
    assert r.status_code == 403, r.text[:200]
