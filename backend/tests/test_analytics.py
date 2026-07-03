"""Cụm Analytics / Trung tâm giá (W1-12) — test in-process ASGI.

Phủ 5 nhóm theo yêu cầu:

  1) **W0-21 — KHOÁ BẢO MẬT (quan trọng nhất).** `require_role(..., allow_viewer=False)`
     trên 3 endpoint /price-lookup phải CHẶN viewer (403) trong khi role bán hàng /
     admin đi qua cổng (không 401/403). Viewer bình thường được GET mọi nơi (read-only
     toàn hệ), nên đây là ngoại lệ CÓ CHỦ Ý cho giá nội bộ — nếu ai đó lỡ bỏ
     `allow_viewer=False`, test này ĐỎ ngay (xem MUTATION-CHECK cuối file).

  2) price-trends /by-role + /multi-series (analytics_trends): seed 1 quan sát giá V1
     (bqms_rfq) → v_price_observations_clean phát sinh role 'quote_v1' → shape + median
     đúng, danh sách role hợp lệ.

  3) market-prices /search + /dashboard state-machine (empty ↔ ready).

  4) profit-analysis /overview: seed deal_margins với 2 deal → KPI khớp số tính tay.

  5) **W0-09 — route đã cắt.** /demand-forecast/*, /batch/*, /pwa/config phải 404
     (3 router gỡ khỏi registry 2026-07-03).

Nền tảng: conftest.py (client / db rollback / admin|staff|sales|viewer). Mọi test
`@pytest.mark.integration` → auto-skip khi thiếu prod snapshot (autouse guard dưới).

──────────────────────────────────────────────────────────────────────────────
MUTATION-CHECK (bằng chứng test THỰC SỰ bắt lỗi)
──────────────────────────────────────────────────────────────────────────────
  A) W0-21: trong app/api/v1/price_lookup.py đổi `allow_viewer=False` → `allow_viewer=True`
     (hoặc bỏ hẳn) ở `search_global`/`search_codes`/`lookup_price`.
     `test_w0_21_viewer_blocked_on_price_lookup` PHẢI FAIL (viewer nhận 200 thay vì 403).
  B) W0-09: mount lại demand_forecast_router trong app/api/v1/__init__.py →
     `test_w0_09_dead_routes_return_404[...demand-forecast...]` PHẢI FAIL (200 thay vì 404).
  C) Profit: sửa gross_profit công thức hoặc filter ngày →
     `test_profit_overview_math` lệch số kỳ vọng.
"""
from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio

pytestmark = pytest.mark.integration

# ── Đường dẫn cố định (khớp prefix mount ở app/api/v1/__init__.py) ────────────
PL_BASE = "/api/v1/price-lookup"
PL_GLOBAL = f"{PL_BASE}/search/global"      # search_global — SALES được phép
PL_SEARCH = f"{PL_BASE}/search"             # search_codes  — SALES KHÔNG có trong list
PL_LOOKUP = f"{PL_BASE}/ANLYT-DUMMY-CODE"   # lookup_price /{bqms_code} — SALES KHÔNG có

ANALYTICS_BASE = "/api/v1/analytics/price-trends"
MARKET_BASE = "/api/v1/market-prices"
PROFIT_BASE = "/api/v1/profit-analysis"

CURRENT_MONTH = f"{date.today():%Y-%m}"     # nhãn tháng hiện tại (YYYY-MM) trong skeleton


# ── Guard: chỉ chạy khi có full prod schema; smoke/bootstrap → skip sạch ─────
@pytest.fixture(autouse=True)
def _require_full_schema(request):
    if request.node.get_closest_marker("integration"):
        info = request.getfixturevalue("schema_info")
        if not info["full_schema"]:
            pytest.skip(
                "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
                "(pg_dump --schema-only). Schema đang nạp: " + info["source"]
            )


async def _relation_exists(db, qualified: str) -> bool:
    """True nếu bảng/view tồn tại (probe rẻ để skip sạch khi snapshot thiếu)."""
    return bool(await db.fetchval("SELECT to_regclass($1) IS NOT NULL", qualified))


# ─────────────────────────────────────────────────────────────────────────────
# 1) W0-21 — KHOÁ BẢO MẬT price-lookup (ca quan trọng nhất)
# ─────────────────────────────────────────────────────────────────────────────

# (url, cần_q): search endpoints bắt buộc ?q>=2 ký tự; lookup dùng path param.
_PL_ENDPOINTS = [
    pytest.param(PL_GLOBAL, True, id="search-global"),
    pytest.param(PL_SEARCH, True, id="search"),
    pytest.param(PL_LOOKUP, False, id="lookup-by-code"),
]


@pytest.mark.parametrize("url,needs_q", _PL_ENDPOINTS)
async def test_w0_21_viewer_blocked_on_price_lookup(client, viewer, url, needs_q):
    """VIEWER bị 403 trên MỌI endpoint /price-lookup (giá nội bộ — allow_viewer=False).

    Đây là bất biến bảo mật W0-21: viewer read-only toàn hệ NHƯNG bị chặn ở lớp giá
    nội bộ. Không phải 401 (token hợp lệ) mà đúng 403 (thiếu quyền)."""
    params = {"q": "ab"} if needs_q else None
    r = await client.get(url, headers=viewer["headers"], params=params)
    assert r.status_code == 403, (
        f"[{url}] viewer PHẢI bị 403 (allow_viewer=False), nhận {r.status_code}: {r.text[:200]}"
    )


@pytest.mark.parametrize("url,needs_q", _PL_ENDPOINTS)
async def test_w0_21_admin_passes_gate(client, admin, url, needs_q):
    """ADMIN đi qua cổng (không 401/403) và tra cứu trả 200 dù bảng rỗng."""
    params = {"q": "ab"} if needs_q else None
    r = await client.get(url, headers=admin["headers"], params=params)
    assert r.status_code not in (401, 403), f"[{url}] admin bị chặn: {r.status_code} {r.text[:200]}"
    assert r.status_code == 200, f"[{url}] admin kỳ vọng 200, nhận {r.status_code}: {r.text[:200]}"


@pytest.mark.parametrize("url,needs_q", _PL_ENDPOINTS)
async def test_w0_21_staff_passes_gate(client, staff, url, needs_q):
    """STAFF có trong danh sách role của cả 3 endpoint → qua cổng, 200."""
    params = {"q": "ab"} if needs_q else None
    r = await client.get(url, headers=staff["headers"], params=params)
    assert r.status_code == 200, f"[{url}] staff kỳ vọng 200, nhận {r.status_code}: {r.text[:200]}"


async def test_w0_21_sales_role_matrix(client, sales):
    """SALES chỉ nằm trong danh sách role của /search/global (không có ở /search & /{code}).

    Ghi lại CHÍNH XÁC ranh giới role hiện tại: sales qua được global (200) nhưng bị 403 ở
    2 endpoint kia. Nếu ai thêm/bớt 'sales' vào các list, test này phản ánh ngay."""
    r_global = await client.get(PL_GLOBAL, headers=sales["headers"], params={"q": "ab"})
    assert r_global.status_code not in (401, 403), r_global.text[:200]
    assert r_global.status_code == 200, r_global.text[:200]

    r_search = await client.get(PL_SEARCH, headers=sales["headers"], params={"q": "ab"})
    assert r_search.status_code == 403, f"sales KHÔNG có trong /search list → 403, nhận {r_search.status_code}"

    r_lookup = await client.get(PL_LOOKUP, headers=sales["headers"])
    assert r_lookup.status_code == 403, f"sales KHÔNG có trong /{{code}} list → 403, nhận {r_lookup.status_code}"


# ─────────────────────────────────────────────────────────────────────────────
# 2) price-trends /by-role + /multi-series (analytics_trends)
# ─────────────────────────────────────────────────────────────────────────────

# Giá V1 nội bộ (VND). Số nguyên → asyncpg bind thẳng vào numeric không cần Decimal.
PRICE_OBS_CODE = "ANLYT-ROLE-01"
PRICE_OBS_V1 = 150000


@pytest_asyncio.fixture
async def seed_price_obs(db):
    """Seed 1 dòng bqms_rfq (giá V1 hôm nay) → v_price_observations_clean sinh 'quote_v1'.

    price_intel_config rỗng trong snapshot schema-only → view 'clean' KHÔNG lọc L4/L5
    (mọi điều kiện `= 1` so với NULL đều false), nên quan sát seed đi thẳng vào view.
    Chỉ 1 quan sát/mã ⇒ MAD=0 ⇒ không bị đánh outlier; obs_date=hôm nay ⇒ không 'stale'.
    """
    if not await _relation_exists(db, "public.v_price_observations_clean"):
        pytest.skip("thiếu view v_price_observations_clean trong snapshot")
    await db.execute(
        """
        INSERT INTO bqms_rfq (rfq_number, bqms_code, specification,
                              inquiry_date, quoted_price_bqms_v1, result)
        VALUES ($1, $2, 'Vòng bi test analytics', CURRENT_DATE, $3, 'won')
        """,
        "RFQ-ANLYT-ROLE-1", PRICE_OBS_CODE, PRICE_OBS_V1,
    )
    return {"code": PRICE_OBS_CODE, "v1": PRICE_OBS_V1}


async def test_price_trends_by_role_shape(client, admin, seed_price_obs):
    """/price-trends/by-role: series phẳng theo tháng, đủ 5 role key, quote_v1 khớp median."""
    r = await client.get(
        f"{ANALYTICS_BASE}/by-role",
        headers=admin["headers"],
        params={"codes": seed_price_obs["code"], "months": 12},
    )
    assert r.status_code == 200, r.text[:300]
    data = r.json()["data"]

    # roles = đúng bộ khoá vai trò của module.
    assert data["roles"] == ["quote_v1", "market_xnk", "cost_ncc", "sale_sourcing", "imv_buy"]
    assert data["codes"] == [seed_price_obs["code"]]
    assert len(data["series"]) == 12  # skeleton 12 tháng

    # Mỗi phần tử tháng có đủ MỌI role key (fill null) + month_key.
    for row in data["series"]:
        assert "month_key" in row
        for role in data["roles"]:
            assert role in row

    # Tháng hiện tại: quote_v1 = median của 1 quan sát = chính giá V1 đã seed.
    cur = next(row for row in data["series"] if row["month_key"] == CURRENT_MONTH)
    assert cur["quote_v1"] == float(seed_price_obs["v1"])
    # Các role không seed → null trong tháng này.
    assert cur["market_xnk"] is None
    assert cur["cost_ncc"] is None


async def test_price_trends_by_role_empty_codes(client, admin):
    """Không truyền codes → payload rỗng (KHÔNG 422). FE tự gate enabled."""
    r = await client.get(f"{ANALYTICS_BASE}/by-role", headers=admin["headers"])
    assert r.status_code == 200, r.text[:200]
    data = r.json()["data"]
    assert data["codes"] == []
    assert data["series"] == []
    assert data["roles"] == ["quote_v1", "market_xnk", "cost_ncc", "sale_sourcing", "imv_buy"]


async def test_price_trends_multi_series_shape(client, admin, seed_price_obs):
    """/price-trends/multi-series: series phẳng recharts, median V1 tháng hiện tại khớp."""
    code = seed_price_obs["code"]
    r = await client.get(
        f"{ANALYTICS_BASE}/multi-series",
        headers=admin["headers"],
        params={"codes": code, "months": 12},
    )
    assert r.status_code == 200, r.text[:300]
    data = r.json()["data"]
    assert data["codes"] == [code]
    assert len(data["series"]) == 12
    assert len(data["months"]) == 12

    cur = next(row for row in data["series"] if row["month_key"] == CURRENT_MONTH)
    assert cur[code] == float(seed_price_obs["v1"])


async def test_price_trends_role_gate_viewer_403(client, viewer, seed_price_obs):
    """analytics_trends cũng khoá viewer (allow_viewer=False) — không rò giá nội bộ."""
    r = await client.get(
        f"{ANALYTICS_BASE}/by-role",
        headers=viewer["headers"],
        params={"codes": seed_price_obs["code"]},
    )
    assert r.status_code == 403, r.text[:200]


# ─────────────────────────────────────────────────────────────────────────────
# 3) market-prices /search + /dashboard state-machine
# ─────────────────────────────────────────────────────────────────────────────

XNK_SEARCH_CODE = "XNK-MP-SEARCH-01"
XNK_READY_CODE = "XNK-MP-READY-01"
XNK_EMPTY_CODE = "XNK-MP-NOPE-9999"        # cố tình không seed → dashboard 'empty'
DASHBOARD_PRICE_MIN_SAMPLE = 12            # ngưỡng 'ready' (đồng bộ market_prices.py)


@pytest_asyncio.fixture
async def seed_xnk(db):
    """Seed xnk_price_lookup: 1 dòng cho /search + đủ 12 dòng giá>0 cho dashboard 'ready'."""
    if not await _relation_exists(db, "public.xnk_price_lookup"):
        pytest.skip("thiếu bảng xnk_price_lookup trong snapshot")

    # Dòng để test /search (lọc theo bqms chính xác).
    await db.execute(
        """
        INSERT INTO xnk_price_lookup (rfq_date, bqms_code, item_name, seller_name,
                                      price_usd, price_vnd, source)
        VALUES (CURRENT_DATE, $1, 'Bạc lót tra cứu', 'ACME CO', 12, 300000, 'excel_import')
        """,
        XNK_SEARCH_CODE,
    )

    # 12 dòng price_usd>0 cùng 1 mã → dashboard(bqms=READY) đạt sample_size=12 = 'ready'.
    for i in range(DASHBOARD_PRICE_MIN_SAMPLE):
        await db.execute(
            """
            INSERT INTO xnk_price_lookup (rfq_date, bqms_code, item_name, seller_name,
                                          price_usd, price_vnd, source)
            VALUES (CURRENT_DATE, $1, 'Bạc lót ready', $2, $3, $4, 'excel_import')
            """,
            XNK_READY_CODE, f"SELLER {i % 4}", 10 + i, (10 + i) * 25000,
        )
    return {"search_code": XNK_SEARCH_CODE, "ready_code": XNK_READY_CODE, "n_ready": DASHBOARD_PRICE_MIN_SAMPLE}


async def test_market_prices_search(client, admin, seed_xnk):
    """/market-prices/search lọc theo bqms trả đúng dòng đã seed."""
    r = await client.get(
        f"{MARKET_BASE}/search",
        headers=admin["headers"],
        params={"bqms": seed_xnk["search_code"]},
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["total"] >= 1
    assert body["data"], "search phải trả ít nhất 1 dòng"
    assert all(row["bqms_code"] == seed_xnk["search_code"] for row in body["data"])


async def test_market_prices_dashboard_ready(client, admin, seed_xnk):
    """Dashboard(bqms=READY) — 12 dòng giá>0 ⇒ price_snapshot='ready', coverage='ready'."""
    r = await client.get(
        f"{MARKET_BASE}/dashboard",
        headers=admin["headers"],
        params={"bqms": seed_xnk["ready_code"]},
    )
    assert r.status_code == 200, r.text[:300]
    data = r.json()["data"]
    assert data["overview"]["total_records"] == seed_xnk["n_ready"]
    assert data["price_snapshot"]["sample_size"] == seed_xnk["n_ready"]
    assert data["price_snapshot"]["status"] == "ready"
    assert data["coverage"]["status"] == "ready"


async def test_market_prices_dashboard_empty(client, admin, seed_xnk):
    """Dashboard(bqms=mã không tồn tại) ⇒ state 'empty' ở coverage + price_snapshot."""
    r = await client.get(
        f"{MARKET_BASE}/dashboard",
        headers=admin["headers"],
        params={"bqms": XNK_EMPTY_CODE},
    )
    assert r.status_code == 200, r.text[:300]
    data = r.json()["data"]
    assert data["overview"]["total_records"] == 0
    assert data["coverage"]["status"] == "empty"
    assert data["price_snapshot"]["status"] == "empty"


# ─────────────────────────────────────────────────────────────────────────────
# 4) profit-analysis /overview — số khớp tính tay
# ─────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def seed_deal_margins(db):
    """2 deal_margins với created_at=2 ngày trước (nằm chắc trong cửa sổ months).

    total_cost/gross_profit/margin_pct là CỘT GENERATED → chỉ set revenue+cogs.
      A: rev=1_000_000, cogs=600_000  → gp=400_000, margin=40.000
      B: rev=2_000_000, cogs=1_900_000→ gp=100_000, margin= 5.000
    created_at lùi 2 ngày vì endpoint filter `created_at <= date.today()` (00:00) —
    dòng tạo 'hôm nay lúc chạy' sẽ > mốc 00:00 và bị loại.
    """
    if not await _relation_exists(db, "public.deal_margins"):
        pytest.skip("thiếu bảng deal_margins trong snapshot")
    await db.execute(
        """
        INSERT INTO deal_margins (chain_code, revenue_vnd, cogs_vnd, created_at)
        VALUES ('DM-ANLYT-A', 1000000, 600000, NOW() - INTERVAL '2 days'),
               ('DM-ANLYT-B', 2000000, 1900000, NOW() - INTERVAL '2 days')
        """
    )
    return {
        "deal_count": 2,
        "total_revenue_vnd": 3000000.0,
        "total_cost_vnd": 2500000.0,
        "total_gross_profit_vnd": 500000.0,
        "avg_margin_pct": 22.5,
        "best_margin_pct": 40.0,
        "worst_margin_pct": 5.0,
        "profitable_deals": 2,
    }


async def test_profit_overview_math(client, manager, seed_deal_margins):
    """/profit-analysis/overview: KPI tổng khớp CHÍNH XÁC số tính tay."""
    r = await client.get(f"{PROFIT_BASE}/overview", headers=manager["headers"], params={"months": 6})
    assert r.status_code == 200, r.text[:300]
    data = r.json()["data"]
    kpis = data["kpis"]
    exp = seed_deal_margins
    assert kpis["deal_count"] == exp["deal_count"]
    assert kpis["total_revenue_vnd"] == exp["total_revenue_vnd"]
    assert kpis["total_cost_vnd"] == exp["total_cost_vnd"]
    assert kpis["total_gross_profit_vnd"] == exp["total_gross_profit_vnd"]
    assert kpis["avg_margin_pct"] == exp["avg_margin_pct"]
    assert kpis["best_margin_pct"] == exp["best_margin_pct"]
    assert kpis["worst_margin_pct"] == exp["worst_margin_pct"]
    assert kpis["profitable_deals"] == exp["profitable_deals"]
    # best/worst deal đúng chain_code.
    assert data["best_deal"]["chain_code"] == "DM-ANLYT-A"
    assert data["worst_deal"]["chain_code"] == "DM-ANLYT-B"


async def test_profit_overview_role_gate(client, staff, seed_deal_margins):
    """/profit-analysis chỉ cho manager/admin (allow_viewer mặc định) — staff bị 403."""
    r = await client.get(f"{PROFIT_BASE}/overview", headers=staff["headers"])
    assert r.status_code == 403, r.text[:200]


# ─────────────────────────────────────────────────────────────────────────────
# 5) W0-09 — route đã cắt phải trả 404
# ─────────────────────────────────────────────────────────────────────────────

_DEAD_ROUTES = [
    "/api/v1/demand-forecast/products",
    "/api/v1/demand-forecast/results",
    "/api/v1/batch/batch-update",
    "/api/v1/pwa/config",
]


@pytest.mark.parametrize("url", _DEAD_ROUTES)
async def test_w0_09_dead_routes_return_404(client, admin, url):
    """demand_forecast / batch_operations / pwa_settings gỡ khỏi registry ⇒ 404.

    Dùng token admin để chắc chắn 404 là do 'route không tồn tại' chứ không phải chặn quyền."""
    r = await client.get(url, headers=admin["headers"])
    assert r.status_code == 404, f"[{url}] kỳ vọng 404 (route đã cắt W0-09), nhận {r.status_code}"
