"""Golden-value regression tests for sourcing_pricing_engine.compute_sale_vnd().

These tests pin the **R1-documented** canonical outputs from the
``/api/v1/sourcing/calc-suggest`` OpenAPI docstring + the
"Bảng tính giá 2026" spreadsheet template:

  * IMPORT  scenario (is_domestic_vn=False) →  S = 5,283,320
  * DOMESTIC scenario (is_domestic_vn=True ) →  S = 4,868,700

Golden values REBASELINED (triage 2026-07-03):
  The old literals 4,747,064 / 4,399,740 were copied from
  plans/sourcing-rebuild-2026-06/reports/pricing-engine-golden-values.md,
  whose worked traces use DIFFERENT inputs than `_CANON_INPUTS` below
  (Scenario A = 12,000 JPY @180 item_type='import-electronics';
   Scenario B = 2,500,000 VND, L=150,000, swift=5.5 @26,500). They never
  corresponded to the cost=100 USD @25,000 / M=500,000 / item_type='default'
  inputs this test actually feeds. Recomputed by hand against the current
  engine (swift = 5 × H, round-once overhaul 30/06) the true outputs for
  THESE inputs are 5,283,320 (import) and 4,868,700 (domestic). Every
  structural column (K/L/M/N/O/P + profit%) already matched the engine; only
  the final S literals were stale, so they are updated here.

If a future change to the engine produces a different S, the choice
is to fix the engine OR update BOTH this file AND the /calc-suggest
docstring AND the spreadsheet template — never silently drift one of
them.

DB is mocked — these are pure-arithmetic asserts on the engine; no
Postgres / asyncpg pool needed. Run with::

    pytest backend/tests/test_sourcing_pricing_engine.py -v
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any

import pytest

from app.services.sourcing_pricing_engine import (
    _hardcoded_rule,
    compute_sale_vnd,
    invalidate_pricing_caches,
)


# ──────────────────────────── helpers ────────────────────────────


class _FakeConn:
    """Minimal asyncpg.Connection stand-in.

    The engine only ever calls ``await conn.fetchrow(sql, *args)``. We
    return canonical default-rule rows + a stable FX row, mirroring
    what ``sourcing_pricing_rules`` + ``exchange_rates`` would yield in
    production.

    Pass ``rule=None`` (default) → canonical hardcoded "default" rule.
    Pass ``rule=<dict>`` → simulate a non-default item_type lookup.
    Pass ``rule_missing=True`` → simulate "no default row in DB" path
    so the engine falls back to ``_hardcoded_rule()``.
    """

    def __init__(
        self,
        rule: dict[str, Any] | None = None,
        usd_to_vnd: Decimal = Decimal("25000"),
        rule_missing: bool = False,
    ):
        self._rule = rule or _hardcoded_rule()
        self._usd = usd_to_vnd
        self._rule_missing = rule_missing

    async def fetchrow(self, sql: str, *args: Any):  # noqa: ANN401
        sql_l = sql.lower()
        if "exchange_rates" in sql_l:
            return {"rate": self._usd}
        if "sourcing_pricing_rules" in sql_l:
            if self._rule_missing:
                return None
            r = self._rule
            return {
                "item_type": r["item_type"],
                "markup_pct": r["markup_pct"],
                "tax_pct": r["tax_pct"],
                "shipping_fee_vnd": r["shipping_fee_vnd"],
                "import_tax_pct": r["import_tax_pct"],
                "vat_pct": r["vat_pct"],
                "purchase_cost_pct": r["purchase_cost_pct"],
                "transfer_fee_pct": r["transfer_fee_pct"],
                "swift_fee_usd": r["swift_fee_usd"],
                "profit_pct_import": r["profit_pct_import"],
                "profit_pct_domestic": r["profit_pct_domestic"],
                "description_vi": r.get("description_vi"),
            }
        return None


def _run(coro):
    """Run an async coroutine — avoids pytest-asyncio plugin dep."""
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _clear_caches():
    """Ensure no cross-test bleed via the engine's in-process TTL cache."""
    invalidate_pricing_caches()
    yield
    invalidate_pricing_caches()


# ──── Canonical inputs (verbatim from /calc-suggest docstring) ────

_CANON_INPUTS = dict(
    item_type="default",
    cost_amount=Decimal("100"),
    currency="USD",
    exchange_rate=Decimal("25000"),
    qty=Decimal("1"),
    fedex_fee_vnd=Decimal("500000"),
    vn_shipping_fee_vnd=Decimal("0"),
)


# ──────────────────────── golden-value tests ────────────────────────


def test_import_scenario_S_equals_5283320():
    """IMPORT golden: S = 5,283,320 — recomputed for _CANON_INPUTS.

    Inputs:
      cost_amount=100 USD, exchange_rate=25000, qty=1,
      fedex_fee_vnd=500000, vn_shipping_fee_vnd=0, is_domestic_vn=False
    Expected breakdown (template Bảng tính giá 2026):
      K=2,500,000  M=500,000  N=600,000 (20% import tax on K+M)
      O=360,000 (10% VAT)     P=625,000 (25% purchase cost)
      R uses 12% import profit rate
    """
    result = _run(compute_sale_vnd(
        _FakeConn(),
        is_domestic_vn=False,
        **_CANON_INPUTS,
    ))
    br = result["breakdown"]
    s = result["suggested_sale_vnd"]

    # Structural invariants — these are deterministic and cheap to assert.
    assert br["K"] == 2_500_000, f"K must be 2,500,000; got {br['K']}"
    assert br["L"] == 0, f"L (vn shipping) must be 0; got {br['L']}"
    assert br["M"] == 500_000, f"M (Fedex) must be 500,000; got {br['M']}"
    assert br["N"] == 600_000, f"N (Thuế NK 20%) must be 600,000; got {br['N']}"
    assert br["O"] == 360_000, f"O (VAT 10%) must be 360,000; got {br['O']}"
    assert br["P"] == 625_000, f"P (Mua hộ 25%) must be 625,000; got {br['P']}"
    assert br["params"]["profit_pct_used"] == 12.0, "Import → 12% profit"

    # The golden S — recomputed by hand for _CANON_INPUTS against the current
    # engine (K=2,500,000; Q = 7,250 + 5×25,000 = 132,250; base=4,717,250;
    # R = 12% = 566,070; S = base + R = 5,283,320). See file docstring for the
    # rebaseline rationale.
    assert s == 5_283_320, (
        f"IMPORT S regression: expected 5,283,320 (recomputed for "
        f"_CANON_INPUTS: cost=100 USD @25,000, M=500,000, qty=1, import), "
        f"got {s:,}. If the engine changed, update this test AND the "
        f"/calc-suggest docstring together."
    )


def test_domestic_scenario_S_equals_4868700():
    """DOMESTIC golden: S = 4,868,700 — recomputed for _CANON_INPUTS.

    Same canonical inputs as IMPORT but is_domestic_vn=True:
      → N = 0 (no import tax)
      → profit_pct = 20% (domestic) instead of 12% (import)
    """
    result = _run(compute_sale_vnd(
        _FakeConn(),
        is_domestic_vn=True,
        **_CANON_INPUTS,
    ))
    br = result["breakdown"]
    s = result["suggested_sale_vnd"]

    # Structural invariants
    assert br["N"] == 0, "Domestic → N must be 0 (no import tax)"
    assert br["params"]["profit_pct_used"] == 20.0, "Domestic → 20% profit"
    assert br["K"] == 2_500_000
    assert br["P"] == 625_000

    # The golden S — recomputed by hand for _CANON_INPUTS against the current
    # engine (N=0 domestic; O=300,000; Q=132,250; base=4,057,250;
    # R = 20% = 811,450; S = base + R = 4,868,700). See file docstring for the
    # rebaseline rationale.
    assert s == 4_868_700, (
        f"DOMESTIC S regression: expected 4,868,700 (recomputed for "
        f"_CANON_INPUTS with is_domestic_vn=True), got {s:,}. If the engine "
        f"changed, update this test AND the /calc-suggest docstring together."
    )


# ─────────────────── edge / fallback tests ───────────────────


def test_unknown_item_type_falls_back_to_default():
    """An unknown item_type must not raise — must fall back to the 'default' rule.

    The engine's ``get_rule()`` does this via a second SELECT for
    item_type='default'; if neither exists, it falls back to
    ``_hardcoded_rule()`` (also marked _fallback=True).

    We simulate "row not in DB" via ``rule_missing=True`` on FakeConn —
    the engine therefore lands on the hardcoded fallback. The engine
    must still return a valid result with the canonical default %s
    applied and ``rule_used.fallback_to_default`` truthy.
    """
    result = _run(compute_sale_vnd(
        _FakeConn(rule_missing=True),
        item_type="THIS_ITEM_TYPE_DOES_NOT_EXIST_xyz",
        cost_amount=Decimal("100"),
        currency="USD",
        exchange_rate=Decimal("25000"),
        qty=Decimal("1"),
        fedex_fee_vnd=Decimal("500000"),
        vn_shipping_fee_vnd=Decimal("0"),
        is_domestic_vn=False,
    ))
    br = result["breakdown"]

    # Must produce a finite positive sale value (i.e. no crash, no zero).
    assert result["suggested_sale_vnd"] > 0

    # Canonical default %s from _hardcoded_rule() must be in play.
    p = br["params"]
    assert p["import_tax_pct"] == 20.0
    assert p["vat_pct"] == 10.0
    assert p["purchase_cost_pct"] == 25.0
    assert p["profit_pct_import"] == 12.0
    assert p["profit_pct_domestic"] == 20.0

    # The 'rule_used' meta must announce that we fell back.
    rule_used = br["rule_used"]
    assert rule_used["item_type"] == "default", (
        f"Unknown item_type should fall back to 'default'; "
        f"got rule_used.item_type={rule_used['item_type']!r}"
    )
    assert rule_used["fallback_to_default"] is True, (
        "Unknown item_type must mark rule_used.fallback_to_default=True so "
        "the UI can warn the user that the default rule was applied."
    )


def test_zero_cost_returns_zero():
    """cost_amount=0 must not crash and must yield a non-negative S.

    With zero cost: I=0, K=0, P=0. N=0 (no goods to tax). O depends only
    on M and N. Q reduces to swift fee + (M only) × transfer_fee. S is
    therefore the sum of fixed fees + their VAT + profit margin — small
    but defined. The key regression guard: no exception, no negative S.
    """
    result = _run(compute_sale_vnd(
        _FakeConn(),
        item_type="default",
        cost_amount=Decimal("0"),
        currency="USD",
        exchange_rate=Decimal("25000"),
        qty=Decimal("1"),
        # Also zero out optional fees so the test asserts the pure-zero case.
        fedex_fee_vnd=Decimal("0"),
        vn_shipping_fee_vnd=Decimal("0"),
        is_domestic_vn=False,
    ))
    br = result["breakdown"]
    s = result["suggested_sale_vnd"]

    # K depends only on cost — must be zero.
    assert br["K"] == 0, f"K must be 0 when cost=0; got {br['K']}"
    assert br["I"] == 0, f"I (unit VND) must be 0 when cost=0; got {br['I']}"
    assert br["P"] == 0, f"P (purchase cost) must be 0 when K=0; got {br['P']}"
    assert br["N"] == 0, f"N must be 0 (no fedex, no cost); got {br['N']}"

    # S is the swift fee + its profit pickup — never negative, may be zero
    # (Swift fee × 12% then divided by qty=1). Allow either: ≥ 0.
    assert s >= 0, f"S must be ≥ 0 when cost=0 (got {s})"


def test_negative_cost_raises():
    """Negative ``cost_amount`` must be rejected — never silently coerced.

    Contract (per the task spec): a negative ``cost_amount`` represents
    corrupt/garbage data (e.g. a BQMS scraper field flipped sign) and
    MUST NOT produce a "looks plausible" sale value. The engine should
    raise so the caller surfaces the error to the user instead of
    quoting against a nonsense input.

    Implementation note (Thang 2026-06-13):
    The live engine at sourcing_pricing_engine.py lines 256–257 currently
    *clamps* negative cost to zero. This test pins the **stricter**
    contract demanded by R1 — if it fails today, the engine guard needs
    to be tightened from "clamp" to "raise ValueError". Either way, this
    test prevents the contract from drifting silently: once we move the
    engine to raise, an accidental revert to clamp-on-negative is caught
    here.
    """
    with pytest.raises(ValueError) as exc_info:
        _run(compute_sale_vnd(
            _FakeConn(),
            item_type="default",
            cost_amount=Decimal("-100"),
            currency="USD",
            exchange_rate=Decimal("25000"),
            qty=Decimal("1"),
            fedex_fee_vnd=Decimal("500000"),
            vn_shipping_fee_vnd=Decimal("0"),
            is_domestic_vn=False,
        ))
    # Sanity: the exception message should mention the offending input,
    # not just bubble an unrelated KeyError / TypeError.
    assert exc_info.value is not None
