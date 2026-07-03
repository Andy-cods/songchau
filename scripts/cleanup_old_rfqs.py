#!/usr/bin/env python3
"""Phase 5 cleanup — list/delete Closed/Skip RFQ folders >60 days old.

Per Thang 2026-05-12: chỉ xoá các RFQ có result IN ('closed','skipped') với
scraped_at đã hơn 60 ngày, KHÔNG đụng Active hoặc 2026 production.

Usage:
  python cleanup_old_rfqs.py                # DRY-RUN — list only, no delete
  python cleanup_old_rfqs.py --confirm      # Actually delete folders + print size freed
  python cleanup_old_rfqs.py --days 90      # Custom cutoff (default 60)

Safety:
 - DRY-RUN by default
 - Only walks RFQ folders matched in DB query (no rm -rf '*')
 - Print total size before asking confirmation
 - DB rows NEVER deleted (only filesystem cache)
"""
import argparse, os, sys, shutil
sys.path.insert(0, "/app")  # When run inside sc-api container

import asyncio
import asyncpg

DB_URL = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "")
RFQ_ROOT = "/data/onedrive-staging/Puplic/BQMS/RFQ"


def dir_size_bytes(path: str) -> int:
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            try:
                total += os.path.getsize(fp)
            except OSError:
                pass
    return total


def fmt_size(n: int) -> str:
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true", help="Actually delete (default: dry-run)")
    parser.add_argument("--days", type=int, default=60, help="Days threshold (default 60)")
    args = parser.parse_args()

    conn = await asyncpg.connect(DB_URL)

    print(f"Phase 5 cleanup — Closed/Skip RFQs older than {args.days} days")
    print("=" * 70)

    rows = await conn.fetch(
        """
        SELECT DISTINCT rfq_number, result::text AS result,
               MAX(result_date)  AS last_result_date,
               MAX(inquiry_date) AS last_inquiry_date,
               MAX(updated_at)   AS last_updated
        FROM bqms_rfq
        WHERE result::text IN ('closed', 'skipped')
          AND COALESCE(result_date, inquiry_date, updated_at::date)
              < CURRENT_DATE - INTERVAL '$1 days'
        GROUP BY rfq_number, result
        ORDER BY rfq_number
        """.replace("$1", str(args.days)),
    )

    print(f"Found {len(rows)} RFQs matching criteria.\n")

    candidates = []
    for r in rows:
        rfq = r["rfq_number"]
        # Walk RFQ_ROOT for folders matching this rfq_number
        for root, dirs, _ in os.walk(RFQ_ROOT):
            for d in dirs:
                if d == rfq or d.startswith(rfq + "_") or d.startswith(rfq + " "):
                    full = os.path.join(root, d)
                    size = dir_size_bytes(full)
                    candidates.append((rfq, r["result"], full, size))

    total_size = sum(c[3] for c in candidates)
    print(f"Total folders to clean: {len(candidates)}")
    print(f"Estimated reclaim: {fmt_size(total_size)}\n")

    # Print first 20 for preview
    for rfq, result, path, size in candidates[:20]:
        print(f"  [{result:7}] {fmt_size(size):>8} — {path}")
    if len(candidates) > 20:
        print(f"  ... and {len(candidates) - 20} more")

    if not args.confirm:
        print("\nDRY-RUN — no files deleted. Pass --confirm to actually delete.")
        await conn.close()
        return

    print(f"\n⚠️  Deleting {len(candidates)} folders ({fmt_size(total_size)}). Press Ctrl-C in 5s to abort...")
    import time
    time.sleep(5)

    deleted_count = 0
    deleted_bytes = 0
    for _, _, path, size in candidates:
        try:
            shutil.rmtree(path, ignore_errors=False)
            deleted_count += 1
            deleted_bytes += size
            print(f"  ✓ {path}")
        except Exception as exc:
            print(f"  ✗ {path}: {exc}")

    print(f"\nDone — deleted {deleted_count} folders, freed {fmt_size(deleted_bytes)}.")
    print("DB rows NOT touched — only filesystem cache. Re-scrape can re-populate if needed.")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
