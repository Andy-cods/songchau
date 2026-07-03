"""BQMS QT lifecycle state machine + D-N deadline engine (Batch 2C / plan 2B).

This module materializes the QT lifecycle state defined in the plan:

    NEW ─(quote Vn)→ V1_QUOTED ─(push to SEC)→ AWAITING_RESULT (đếm D-N)
        AWAITING_RESULT ─(re-invite: Samsung mời vòng sau)→ WON_INVITED
        WON_INVITED     ─(quote Vn+1)→ V1_QUOTED → ... (loop V1..V4)
        AWAITING_RESULT ─(day AFTER deadline, no re-invite; grace=0)→ LOST_EXPIRED
        WON_INVITED is STICKY: it never auto-expires on the OLD deadline; it
        leaves WON_INVITED only when the user re-quotes+pushes the next round.

Design contract (matches plan "Batch 2B"):
  * The event log `bqms_qt_events` is the SOURCE OF TRUTH; `bqms_rfq.qt_state`
    is a MATERIALIZED cache. Every transition appends an event row.
  * Re-invite detection is DETERMINISTIC (version/round bump or reappear-after-
    absence + old deadline passed) — NOT a fragile `[new]` string match.
  * Re-invite detection runs BEFORE the expire pass within a single tick so we
    never close a QT that Samsung just re-invited.
  * Everything is GUARDED: if the Batch-2C columns/tables do not exist yet
    (migration not applied), `run_state_tick` no-ops cleanly so the live job
    never crashes.

`compute_qt_state(row)` is a pure function (no I/O) so it can be unit-tested.
`run_state_tick(conn)` is the async driver that reads candidate rows, detects
re-invites, expires stale/overdue rows, and writes the materialized state +
event rows.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Mapping

# Reuse the robust deadline parser already battle-tested in auto_skip_expired.
from app.services.bqms_auto_skip_expired import parse_deadline

logger = logging.getLogger(__name__)

# Valid state labels (mirror the bqms_qt_state ENUM).
STATE_NEW = "NEW"
STATE_V1_QUOTED = "V1_QUOTED"
STATE_AWAITING = "AWAITING_RESULT"
STATE_WON_INVITED = "WON_INVITED"
STATE_LOST_EXPIRED = "LOST_EXPIRED"
STATE_CLOSED = "CLOSED"
STATE_CANCELLED = "CANCELLED"

ALL_STATES = frozenset({
    STATE_NEW, STATE_V1_QUOTED, STATE_AWAITING, STATE_WON_INVITED,
    STATE_LOST_EXPIRED, STATE_CLOSED, STATE_CANCELLED,
})

# Grace period (in DAYS) after the deadline DAY before we mark LOST_EXPIRED.
# Thang policy (confirmed 2026-06-17): D-Day (deadline == today) is still OPEN;
# the NEXT day the QT is Closed. So grace = 0 means LOST_EXPIRED fires only when
# today's DATE is strictly AFTER the deadline DATE (deadline_date < today_date).
# A positive value would extend the open window by that many extra days.
DEFAULT_GRACE_DAYS = 0


# ---------------------------------------------------------------------------
# Pure state computation
# ---------------------------------------------------------------------------
def _as_dt(v: Any) -> datetime | None:
    """Coerce a value to a UTC-aware datetime, or None."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        # Try ISO first, then the Samsung deadline parser.
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return parse_deadline(s)
    return None


def _any_quoted(row: Mapping[str, Any]) -> bool:
    return any(
        row.get(k) is not None
        for k in (
            "quoted_price_bqms_v1", "quoted_price_bqms_v2",
            "quoted_price_bqms_v3", "quoted_price_bqms_v4",
        )
    )


def _highest_quoted_round(row: Mapping[str, Any]) -> int | None:
    for n, k in (
        (4, "quoted_price_bqms_v4"), (3, "quoted_price_bqms_v3"),
        (2, "quoted_price_bqms_v2"), (1, "quoted_price_bqms_v1"),
    ):
        if row.get(k) is not None:
            return n
    return None


def compute_qt_state(
    row: Mapping[str, Any],
    *,
    now: datetime | None = None,
    grace_days: int = DEFAULT_GRACE_DAYS,
) -> tuple[str, str]:
    """Compute the QT lifecycle state for a single bqms_rfq row (pure).

    Args:
      row: mapping with (at least) keys: result, bqms_pushed_at,
           quoted_price_bqms_v1..v4, deadline_dt (or deadline_raw),
           qt_state (current, optional).
      now: injectable "current time" (UTC-aware) for deterministic tests.
      grace_days: days after deadline before AWAITING_RESULT → LOST_EXPIRED.

    Returns:
      (state, reason) — `state` is one of ALL_STATES; `reason` is a short
      human/audit string explaining the decision.

    Precedence (terminal results win; they are owner/scraper decisions):
      result='cancelled'                 -> CANCELLED
      result='won'                       -> WON_INVITED
      result='lost'                      -> LOST_EXPIRED
      result='closed'                    -> CLOSED
      else (result pending/None):
        STICKY: already WON_INVITED       -> stay WON_INVITED until next-round quote
        pushed + deadline DAY elapsed     -> LOST_EXPIRED  (D-N elapsed; grace=0
                                              means today's DATE > deadline DATE)
        pushed (still on/within deadline) -> AWAITING_RESULT
        any V quoted (not yet pushed)     -> V1_QUOTED
        nothing quoted                    -> NEW

    Grace semantics: the comparison is by DATE, not datetime. With grace_days=0
    (Thang 2026-06-17) a QT whose deadline is TODAY is still AWAITING_RESULT
    (open); it only flips to LOST_EXPIRED the day AFTER the deadline DATE
    (deadline_date + grace_days < today_date).
    """
    now = now or datetime.now(timezone.utc)
    result = (row.get("result") or "").strip().lower() if row.get("result") else None

    # Terminal results set by owner / scraper take precedence.
    if result == "cancelled":
        return STATE_CANCELLED, "result=cancelled"
    if result == "won":
        return STATE_WON_INVITED, "result=won (trúng → mời vòng sau)"
    if result == "lost":
        return STATE_LOST_EXPIRED, "result=lost"
    if result == "closed":
        return STATE_CLOSED, "result=closed"

    # WON_INVITED STICKINESS (Thang 2026-06-17 fix): once Samsung re-invites a QT
    # (qt_state=WON_INVITED, result still pending), it stays WON_INVITED until the
    # user actually quotes+pushes the next round. The OLD deadline has already
    # passed, so without this guard the expire pass below would wrongly flip it
    # back to LOST_EXPIRED and emit a bogus qt.deadline_passed event on EVERY tick.
    #
    # Release condition (deterministic): a FRESH push happened AFTER the re-invite
    # — i.e. bqms_pushed_at > reinvited_at. That means the user quoted the new
    # round and re-pushed to SEC, so the row should flow through the normal
    # pushed-path below (→ AWAITING_RESULT with the NEW deadline). Until then it
    # stays sticky.
    if (row.get("qt_state") or "") == STATE_WON_INVITED:
        _pushed = _as_dt(row.get("bqms_pushed_at"))
        _reinvited = _as_dt(row.get("reinvited_at"))
        # Release ONLY when we can prove a fresh push happened strictly after the
        # recorded re-invite. If reinvited_at is unknown, stay sticky (we cannot
        # prove the user re-quoted, so never auto-expire a re-invited QT).
        _repushed = (
            _pushed is not None and _reinvited is not None and _pushed > _reinvited
        )
        if not _repushed:
            return STATE_WON_INVITED, "đang chờ user báo giá vòng mới (re-invite, sticky)"
        # else: fall through — fresh push after re-invite → re-enter AWAITING_RESULT

    pushed_at = _as_dt(row.get("bqms_pushed_at"))
    deadline = _as_dt(row.get("deadline_dt")) or _as_dt(row.get("deadline_raw"))

    if pushed_at is not None:
        # Compare by calendar DATE so the deadline DAY stays open (D-Day=OPEN).
        # LOST_EXPIRED fires only when (deadline_date + grace_days) < today_date.
        if deadline is not None and (deadline.date() + timedelta(days=grace_days)) < now.date():
            grace_txt = f" + {grace_days}d" if grace_days else ""
            return (
                STATE_LOST_EXPIRED,
                f"đã đẩy SEC; deadline {deadline.date()}{grace_txt} đã qua (ngày), không tái mời",
            )
        return STATE_AWAITING, "đã đẩy SEC, đang đếm ngược D-N chờ kết quả"

    if _any_quoted(row):
        return STATE_V1_QUOTED, "đã báo giá trong ERP, chưa đẩy SEC"

    return STATE_NEW, "mã mới, chưa báo giá"


# ---------------------------------------------------------------------------
# Re-invite detection (deterministic)
# ---------------------------------------------------------------------------
def detect_reinvite(
    row: Mapping[str, Any],
    *,
    latest_presence: Mapping[str, Any] | None,
    prior_absent: bool,
    now: datetime | None = None,
) -> tuple[bool, str]:
    """Decide whether a row is a Samsung re-invite (trúng → mời vòng sau).

    Deterministic predicate (replaces the fragile `ILIKE '[new]%'` match). A QT
    is treated as re-invited when ALL of:
      (a) it is currently AWAITING_RESULT (already pushed, waiting on a result),
      (b) it has been quoted at least once (current_round>=1 OR samsung_round>=2),
      (c) it reappears ACTIVE in a newer scrape (latest_presence.is_active),
      (d) its OLD deadline has passed,
    AND at least one freshness signal:
      (e1) the Samsung round increased (presence.samsung_round > row.version), OR
      (e2) the new deadline is later than the persisted deadline_dt, OR
      (e3) it was ABSENT from a scrape then reappeared (prior_absent).

    Args:
      row: bqms_rfq row mapping (needs qt_state, version, current_round,
           deadline_dt).
      latest_presence: most-recent bqms_scrape_presence row for this RFQ
           (is_active, samsung_round, deadline_dt, seen_at), or None.
      prior_absent: True if there exists a presence row with is_active=False
           (or a gap) BEFORE the latest active one — i.e. it disappeared then
           came back.
      now: injectable current time.

    Returns:
      (is_reinvite, reason). reason is "" when not a re-invite.
    """
    now = now or datetime.now(timezone.utc)

    # (a) only QTs awaiting a result can be re-invited.
    if (row.get("qt_state") or "") != STATE_AWAITING:
        return False, ""

    # (b) must have been quoted at least once (ERP round or Samsung round 2+).
    current_round = row.get("current_round") or _highest_quoted_round(row) or 0
    samsung_round = row.get("version") or 0
    if not (int(current_round) >= 1 or int(samsung_round) >= 2):
        return False, ""

    # (c) must reappear ACTIVE in the newest scrape.
    if not latest_presence or not latest_presence.get("is_active"):
        return False, ""

    # (d) the old (persisted) deadline must have passed.
    old_deadline = _as_dt(row.get("deadline_dt"))
    if old_deadline is None or now <= old_deadline:
        return False, ""

    # Freshness signals (e1/e2/e3) — at least one required.
    new_round = latest_presence.get("samsung_round") or 0
    new_deadline = _as_dt(latest_presence.get("deadline_dt"))

    if int(new_round) > int(samsung_round):
        return True, f"samsung_round {samsung_round}→{new_round} (round bump)"
    if new_deadline is not None and old_deadline is not None and new_deadline > old_deadline:
        return True, f"deadline mới {new_deadline.date()} muộn hơn cũ {old_deadline.date()}"
    if prior_absent:
        return True, "QT từng VẮNG mặt rồi xuất hiện lại active sau khi hết hạn"

    return False, ""


# ---------------------------------------------------------------------------
# Async driver
# ---------------------------------------------------------------------------
async def _columns_exist(conn) -> bool:
    """Guard: are the Batch-2C columns/tables present? If not, tick no-ops."""
    try:
        ok_col = await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'bqms_rfq' AND column_name = 'qt_state'
            )
            """
        )
        ok_evt = await conn.fetchval("SELECT to_regclass('public.bqms_qt_events') IS NOT NULL")
        ok_pres = await conn.fetchval("SELECT to_regclass('public.bqms_scrape_presence') IS NOT NULL")
        return bool(ok_col and ok_evt and ok_pres)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("bqms_state_machine: column-existence probe failed: %s", exc)
        return False


async def _append_event(
    conn,
    *,
    rfq_number: str,
    bqms_code: str | None,
    event_type: str,
    from_state: str | None,
    to_state: str | None,
    round_no: int | None,
    deadline_dt: datetime | None,
    actor: str,
    evidence: dict,
) -> None:
    await conn.execute(
        """
        INSERT INTO bqms_qt_events
            (rfq_number, bqms_code, event_type, from_state, to_state,
             round_no, deadline_dt, actor, evidence)
        VALUES ($1, $2, $3, $4::bqms_qt_state, $5::bqms_qt_state,
                $6, $7, $8, $9::jsonb)
        """,
        rfq_number, bqms_code, event_type, from_state, to_state,
        round_no, deadline_dt, actor, json.dumps(evidence),
    )


async def run_state_tick(
    conn,
    *,
    grace_days: int = DEFAULT_GRACE_DAYS,
    max_rows: int = 500,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Single materialization tick: re-invite pass FIRST, then expire/recompute.

    Order of operations (per plan — re-invite must run before expire):
      1. Probe that Batch-2C schema exists; if not, no-op.
      2. RE-INVITE PASS: for rows in AWAITING_RESULT, check deterministic
         re-invite predicate against the latest scrape_presence; if matched →
         qt_state=WON_INVITED, reinvited_at=now, append 'qt.reinvited' event.
      3. RECOMPUTE PASS: for the remaining candidate rows, compute_qt_state();
         if it differs from the stored qt_state → update + append
         'qt.state_changed' (and 'qt.deadline_passed' when entering LOST_EXPIRED).

    Idempotent: only writes when state actually changes; safe to run every tick.

    Returns a summary dict: {checked, reinvited, transitioned, expired, errors}.
    """
    out: dict[str, Any] = {
        "checked": 0, "reinvited": 0, "transitioned": 0,
        "expired": 0, "skipped_no_schema": False, "errors": [],
    }
    now = datetime.now(timezone.utc)

    if not await _columns_exist(conn):
        out["skipped_no_schema"] = True
        logger.info("bqms_state_machine: schema not present yet — tick no-op")
        return out

    # Candidate rows: anything not already in a terminal-and-stable state.
    # We still re-check WON_INVITED/closed rows cheaply but skip CANCELLED.
    rows = await conn.fetch(
        """
        SELECT id, rfq_number, bqms_code, result::text AS result,
               version, current_round, qt_state::text AS qt_state,
               deadline_dt, deadline_raw, bqms_pushed_at,
               quoted_price_bqms_v1, quoted_price_bqms_v2,
               quoted_price_bqms_v3, quoted_price_bqms_v4,
               reinvited_at
          FROM bqms_rfq
         WHERE qt_state IS DISTINCT FROM 'CANCELLED'
         ORDER BY id
         LIMIT $1
        """,
        max_rows,
    )
    out["checked"] = len(rows)

    # ----- helpers to fetch presence info per RFQ (batched lazily) -----
    async def _latest_presence(rfq_number: str) -> dict | None:
        rec = await conn.fetchrow(
            """
            SELECT is_active, samsung_round, deadline_dt, seen_at
              FROM bqms_scrape_presence
             WHERE rfq_number = $1
             ORDER BY seen_at DESC, id DESC
             LIMIT 1
            """,
            rfq_number,
        )
        return dict(rec) if rec else None

    async def _was_absent(rfq_number: str) -> bool:
        # Did this RFQ have an inactive presence row in recent history?
        return bool(await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 FROM bqms_scrape_presence
                 WHERE rfq_number = $1 AND is_active = FALSE
            )
            """,
            rfq_number,
        ))

    # ---------------- PASS 1: RE-INVITE (must run before expire) ----------------
    awaiting_rows = [r for r in rows if (r["qt_state"] or "") == STATE_AWAITING]
    reinvited_ids: set[int] = set()
    for r in awaiting_rows:
        try:
            presence = await _latest_presence(r["rfq_number"])
            prior_absent = await _was_absent(r["rfq_number"])
            is_reinvite, reason = detect_reinvite(
                r, latest_presence=presence, prior_absent=prior_absent, now=now,
            )
            if not is_reinvite:
                continue
            reinvited_ids.add(int(r["id"]))
            out["reinvited"] += 1
            new_deadline = None
            if presence:
                new_deadline = presence.get("deadline_dt")
            if not dry_run:
                async with conn.transaction():
                    await conn.execute(
                        """
                        UPDATE bqms_rfq
                           SET qt_state = 'WON_INVITED',
                               state_changed_at = NOW(),
                               reinvited_at = NOW(),
                               updated_at = NOW()
                         WHERE id = $1
                        """,
                        int(r["id"]),
                    )
                    await _append_event(
                        conn,
                        rfq_number=r["rfq_number"],
                        bqms_code=r["bqms_code"],
                        event_type="qt.reinvited",
                        from_state=STATE_AWAITING,
                        to_state=STATE_WON_INVITED,
                        round_no=(r["current_round"] or 0) + 1,
                        deadline_dt=new_deadline,
                        actor="state_engine",
                        evidence={
                            "reason": reason,
                            "old_deadline": r["deadline_dt"].isoformat() if r["deadline_dt"] else None,
                            "samsung_round": r["version"],
                            "presence": {
                                "is_active": presence.get("is_active") if presence else None,
                                "samsung_round": presence.get("samsung_round") if presence else None,
                            },
                        },
                    )
            logger.info("state_engine: re-invite %s (%s)", r["rfq_number"], reason)
        except Exception as exc:
            out["errors"].append(f"reinvite {r['rfq_number']}: {exc}")
            logger.warning("state_engine: reinvite failed for %s: %s", r["rfq_number"], exc)

    # ---------------- PASS 2: RECOMPUTE / EXPIRE ----------------
    for r in rows:
        if int(r["id"]) in reinvited_ids:
            continue  # already handled this tick
        try:
            cur_state = (r["qt_state"] or STATE_NEW)
            new_state, reason = compute_qt_state(r, now=now, grace_days=grace_days)
            if new_state == cur_state:
                continue
            event_type = "qt.state_changed"
            if new_state == STATE_LOST_EXPIRED and cur_state == STATE_AWAITING:
                event_type = "qt.deadline_passed"
                out["expired"] += 1
            out["transitioned"] += 1
            if not dry_run:
                async with conn.transaction():
                    await conn.execute(
                        """
                        UPDATE bqms_rfq
                           SET qt_state = $1::bqms_qt_state,
                               state_changed_at = NOW(),
                               updated_at = NOW()
                         WHERE id = $2
                        """,
                        new_state, int(r["id"]),
                    )
                    await _append_event(
                        conn,
                        rfq_number=r["rfq_number"],
                        bqms_code=r["bqms_code"],
                        event_type=event_type,
                        from_state=cur_state,
                        to_state=new_state,
                        round_no=r["current_round"],
                        deadline_dt=r["deadline_dt"],
                        actor="state_engine",
                        evidence={"reason": reason},
                    )
            logger.info(
                "state_engine: %s %s→%s (%s)",
                r["rfq_number"], cur_state, new_state, reason,
            )
        except Exception as exc:
            out["errors"].append(f"recompute {r['rfq_number']}: {exc}")
            logger.warning("state_engine: recompute failed for %s: %s", r["rfq_number"], exc)

    return out
