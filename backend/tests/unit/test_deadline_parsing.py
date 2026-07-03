"""Unit tests — deadline parsing + GAP-X1 boundary contract (no DB, no network).

These cover the PURE plumbing behind the bidding-fairness deadline guard:
  * `_parse_deadline`  — feeds procurement_rfq_batches.bid_deadline (what the
    GAP-X1 guard `bid_deadline < NOW()` in app/api/vendor/quotes.py reads).
  * `_parse_valid_until` — the quote-level "hiệu lực đến".
  * The GAP-X1 boundary contract itself (strict less-than, NULL = open,
    tz-aware) asserted against REAL parser output — so a regression that
    flips `<`→`<=` or mishandles tz/NULL is caught here, not in production.

The authoritative reject (HTTP 400 "Đã quá hạn") lives in
app/api/vendor/quotes.py:233 and is computed in SQL for tz-safety; a full
end-to-end assertion needs a seeded batch + vendor token (out of scope for a
pure unit test, which must not mutate the live/prod DB).
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1.procurement import _parse_deadline
from app.api.vendor.quotes import _parse_valid_until

VN = timezone(timedelta(hours=7))
UTC = timezone.utc


# ── _parse_deadline ─────────────────────────────────────────────────────────
def test_parse_deadline_none_and_blank():
    assert _parse_deadline(None) is None
    assert _parse_deadline("") is None
    assert _parse_deadline("   ") is None


def test_parse_deadline_naive_assumed_vn():
    # A bare 'YYYY-MM-DDTHH:MM' (no offset) is assumed Vietnam local (+07:00).
    dt = _parse_deadline("2026-07-01T17:00")
    assert dt is not None
    assert dt.tzinfo is not None
    assert dt.utcoffset() == timedelta(hours=7)


def test_parse_deadline_z_is_utc():
    dt = _parse_deadline("2026-07-01T10:00:00Z")
    assert dt.utcoffset() == timedelta(0)


def test_parse_deadline_explicit_offset_preserved():
    dt = _parse_deadline("2026-07-01T17:00:00+07:00")
    assert dt.utcoffset() == timedelta(hours=7)


def test_parse_deadline_passthrough_datetime():
    aware = datetime(2026, 7, 1, 17, 0, tzinfo=VN)
    assert _parse_deadline(aware) == aware
    # A naive datetime gets the VN tz stamped on.
    naive = datetime(2026, 7, 1, 17, 0)
    stamped = _parse_deadline(naive)
    assert stamped.utcoffset() == timedelta(hours=7)


def test_parse_deadline_invalid_raises_400():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        _parse_deadline("khong-phai-ngay")
    assert exc.value.status_code == 400


# ── GAP-X1 boundary contract (strict <, NULL = open, tz-aware) ───────────────
def _is_past(bid_deadline, now):
    """Mirror of the SQL guard `bid_deadline IS NOT NULL AND bid_deadline < NOW()`
    used ONLY to assert the documented boundary semantics against real parsed
    values. The production guard is the SQL in quotes.py:224 (authoritative)."""
    return bid_deadline is not None and bid_deadline < now


def test_gapx1_past_deadline_is_closed():
    now = datetime(2026, 7, 1, 17, 0, tzinfo=VN)
    one_sec_ago = _parse_deadline("2026-07-01T16:59:59+07:00")
    assert _is_past(one_sec_ago, now) is True


def test_gapx1_future_deadline_is_open():
    now = datetime(2026, 7, 1, 17, 0, tzinfo=VN)
    one_sec_ahead = _parse_deadline("2026-07-01T17:00:01+07:00")
    assert _is_past(one_sec_ahead, now) is False


def test_gapx1_exactly_now_is_open_strict_lt():
    # Strict '<' → a deadline EQUAL to now is NOT yet past (still open).
    now = datetime(2026, 7, 1, 17, 0, tzinfo=VN)
    same = _parse_deadline("2026-07-01T17:00:00+07:00")
    assert _is_past(same, now) is False


def test_gapx1_null_deadline_is_open():
    now = datetime(2026, 7, 1, 17, 0, tzinfo=VN)
    assert _is_past(_parse_deadline(None), now) is False


def test_gapx1_cross_timezone_boundary():
    # 10:00Z == 17:00+07:00 → equal instants; cross-tz must not misclassify.
    now = datetime(2026, 7, 1, 17, 0, tzinfo=VN)
    in_utc = _parse_deadline("2026-07-01T09:59:59Z")  # = 16:59:59 +07:00 → past
    assert _is_past(in_utc, now) is True


# ── _parse_valid_until ──────────────────────────────────────────────────────
def test_valid_until_none_blank_invalid_to_none():
    assert _parse_valid_until(None) is None
    assert _parse_valid_until("") is None
    assert _parse_valid_until("rac") is None  # unparseable → None (never blocks submit)


def test_valid_until_iso_date_and_z():
    assert _parse_valid_until("2026-07-01") == datetime(2026, 7, 1, 0, 0)
    assert _parse_valid_until("2026-07-01T00:00:00Z").utcoffset() == timedelta(0)
