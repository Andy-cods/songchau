"""Auto-close RFQs that are expired OR stale (Thang 2026-05-19).

Smart code: tự đặt result='closed' cho RFQ:
  A) Quá hạn deadline (parse từ raw_json.deadlineDt) AND chưa báo V1 trong ERP
  B) Stale — không thấy trong scrape gần đây (staging.scraped_at > N ngày trước
     hoặc Samsung đã remove khỏi active bidding list)

Cả 2 case → set result='closed', UI hiển thị "Closed" trong cột D-N, RFQ
chuyển sang tab Closed.

Trigger: mỗi 5 phút trong bqms_smart_sync.

File này được giữ lại tên cũ `bqms_auto_skip_expired.py` cho backward compat
nhưng đã đổi semantics: skip → close.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Any

logger = logging.getLogger(__name__)

# Pattern: M/D/YYYY HH:MM (allow 1-2 digit month/day, optional time)
_DEADLINE_RE = re.compile(
    r"(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?",
)

# Samsung deadline is in GMT+7. Convert to UTC by subtracting 7 hours.
_GMT7_OFFSET = timedelta(hours=7)

# Stale threshold: nếu staging chưa được scrape lại trong > N ngày → Samsung
# đã loại RFQ này khỏi danh sách active. Auto-close.
_STALE_DAYS = 3


def parse_deadline(s: str | None) -> datetime | None:
    """Parse Samsung deadline string. Returns UTC-aware datetime or None.

    Examples:
      "(GMT+07:00) 5/19/2026 23:30"  → 2026-05-19T16:30:00Z (UTC)
      "5/19/2026"                     → 2026-05-18T17:00:00Z (start of day GMT+7)
    """
    if not s:
        return None
    m = _DEADLINE_RE.search(s)
    if not m:
        return None
    try:
        mo, dd, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
        hh = int(m.group(4) or 0)
        mn = int(m.group(5) or 0)
        local_dt = datetime(yr, mo, dd, hh, mn)
        return (local_dt - _GMT7_OFFSET).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


async def auto_close_expired_and_stale(
    pool,
    dry_run: bool = False,
    max_rows: int = 100,
    stale_days: int = _STALE_DAYS,
    grace_days: int = 2,
) -> dict[str, Any]:
    """Find + close expired/stale pending RFQs (Thang 2026-05-19 — extended policy).

    Logic (áp dụng cho CẢ chưa báo giá lẫn đang theo dõi báo giá):
      A) Có deadline + deadline đã quá `grace_days` ngày → 'closed'
         (vd grace_days=2 nghĩa deadline 5/17 thì 5/19 hôm nay sẽ close)
      B) KHÔNG có deadline parse được → 'closed' (mã cũ lỗi/thiếu data)
      C) Stale: staging.scraped_at > stale_days ngày → 'closed'
         (Samsung đã loại khỏi active bidding list)

    Filter v2:
      - result = 'pending'  (kể cả đã có V1/V2/V3 — vẫn close nếu quá hạn)
      - KHÔNG còn filter `V1 IS NULL` — close cả đang theo dõi báo giá

    Returns: {checked, expired, no_deadline, stale, closed, errors, rfqs}
    """
    out: dict[str, Any] = {
        "checked": 0, "expired": 0, "no_deadline": 0, "stale": 0,
        "closed": 0, "errors": [], "rfqs": [],
    }
    now_utc = datetime.now(timezone.utc)
    expired_threshold = now_utc - timedelta(days=grace_days)
    stale_threshold = now_utc - timedelta(days=stale_days)

    async with pool.acquire() as conn:
        # Pull candidates: pending RFQ. LEFT JOIN staging — RFQ cũ không có
        # staging row (mã cũ migrated từ Excel) cũng đưa vào candidate.
        rows = await conn.fetch(
            """
            SELECT r.id AS rfq_id, r.rfq_number,
                   r.quoted_price_bqms_v1 IS NOT NULL AS has_v1,
                   r.inquiry_date AS rfq_inquiry_date,
                   r.created_at AS rfq_created_at,
                   s.id AS staging_id,
                   s.scraped_at AS staging_scraped_at,
                   s.raw_json->>'deadlineDt' AS deadline_str,
                   s.raw_json->>'reqName' AS req_name
              FROM bqms_rfq r
         LEFT JOIN LATERAL (
                  SELECT id, raw_json, scraped_at
                    FROM bqms_vendor_portal_staging
                   WHERE rfq_number = r.rfq_number
                     AND module = 'bidding'
                   ORDER BY id DESC LIMIT 1
              ) s ON true
             WHERE r.result = 'pending'
             LIMIT $1
            """,
            max_rows * 3,
        )
        out["checked"] = len(rows)

        close_targets: list[dict] = []
        for r in rows:
            dl = parse_deadline(r["deadline_str"])
            scraped_at = r["staging_scraped_at"]
            reason = None
            if dl is not None:
                # Có deadline — check quá `grace_days` ngày chưa
                if dl < expired_threshold:
                    reason = "expired"
                    out["expired"] += 1
                else:
                    # Còn trong grace period — skip
                    continue
            else:
                # KHÔNG parse được deadline → coi như mã cũ, close
                # (raw_json.deadlineDt empty/null/format lạ)
                if (r["deadline_str"] or "").strip() == "":
                    reason = "no_deadline"
                    out["no_deadline"] += 1
                else:
                    # Có chuỗi nhưng parse fail — coi như no_deadline
                    reason = "no_deadline"
                    out["no_deadline"] += 1

            # Override với stale nếu cũng stale (chính xác hơn)
            if scraped_at and scraped_at < stale_threshold:
                # Stale rolls up vào expired/no_deadline reason — chỉ count stale
                if reason in ("expired",):
                    pass  # keep expired reason
                else:
                    reason = "stale"
                    out["stale"] += 1
                    out["no_deadline"] -= 1  # don't double count

            close_targets.append({
                "rfq_id": int(r["rfq_id"]),
                "rfq_number": r["rfq_number"],
                "staging_id": int(r["staging_id"]) if r["staging_id"] is not None else None,
                "deadline_raw": r["deadline_str"],
                "scraped_at": scraped_at.isoformat() if scraped_at else None,
                "req_name": r["req_name"],
                "has_v1": bool(r["has_v1"]),
                "reason": reason,
            })

        if dry_run:
            out["rfqs"] = close_targets[:50]
            return out

        for t in close_targets[:max_rows]:
            try:
                async with conn.transaction():
                    reason_text = {
                        "expired": f"deadline {t['deadline_raw']} đã quá {grace_days} ngày",
                        "no_deadline": "không có hạn BG (data cũ/thiếu)",
                        "stale": f"không thấy trong scrape > {stale_days} ngày "
                                 f"(last scraped: {t['scraped_at']})",
                    }.get(t["reason"], "auto-close")
                    v1_status = "đã có V1 nhưng chưa won/lost" if t.get("has_v1") else "chưa có V1 ERP"
                    note_marker = (
                        f"\n[{now_utc.isoformat()}] AUTO-CLOSED: {reason_text}. {v1_status}."
                    )

                    # 1. bqms_rfq → closed (bỏ filter V1=NULL — close cả khi đang theo dõi)
                    await conn.execute(
                        """
                        UPDATE bqms_rfq
                           SET result = 'closed',
                               result_date = CURRENT_DATE,
                               updated_at = NOW(),
                               notes = COALESCE(notes, '') || $1
                         WHERE id = $2
                           AND result = 'pending'
                        """,
                        note_marker, t["rfq_id"],
                    )

                    # 2. Staging → approved (đã xử lý xong, không cần báo giá nữa)
                    # KHÔNG dùng status='skipped' vì 'closed' là semantic mới rõ ràng hơn.
                    # Skip nếu mã không có staging (RFQ cũ migrated từ Excel).
                    if t.get("staging_id") is not None:
                        await conn.execute(
                            """
                            UPDATE bqms_vendor_portal_staging
                               SET status = 'approved',
                                   reviewed_at = NOW()
                             WHERE id = $1 AND status = 'pending_review'
                            """,
                            t["staging_id"],
                        )

                    # 3. Audit log (dedup 7 ngày)
                    existing = await conn.fetchval(
                        """
                        SELECT 1 FROM audit_log
                         WHERE action = 'bqms.auto_close_expired'
                           AND record_id = $1
                           AND created_at > NOW() - INTERVAL '7 days'
                         LIMIT 1
                        """,
                        t["rfq_number"],
                    )
                    if not existing:
                        await conn.execute(
                            """
                            INSERT INTO audit_log
                                (action, table_name, record_id, new_data, created_at)
                            VALUES ('bqms.auto_close_expired', 'bqms_rfq',
                                    $1, $2::jsonb, NOW())
                            """,
                            t["rfq_number"],
                            json.dumps({
                                "rfq_id": t["rfq_id"],
                                "reason": t["reason"],
                                "deadline": t["deadline_raw"],
                                "last_scraped_at": t["scraped_at"],
                                "req_name": (t["req_name"] or "")[:120],
                                "message": (
                                    f"Auto-close: deadline {t['deadline_raw']} đã qua"
                                    if t["reason"] == "expired"
                                    else f"Auto-close: stale > {stale_days} ngày"
                                ),
                            }),
                        )
                out["closed"] += 1
                out["rfqs"].append({
                    "rfq_number": t["rfq_number"],
                    "reason": t["reason"],
                })
                logger.info("auto-close %s: %s (%s)",
                            t["reason"], t["rfq_number"], t["deadline_raw"])
            except Exception as exc:
                out["errors"].append(f"{t['rfq_number']}: {exc}")
                logger.warning("auto-close failed for %s: %s", t["rfq_number"], exc)

    return out


# Backward-compat alias (old smart_sync code may import this name)
auto_skip_expired = auto_close_expired_and_stale
