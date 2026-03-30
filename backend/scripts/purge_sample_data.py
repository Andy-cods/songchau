#!/usr/bin/env python3
"""
Song Châu ERP — Xóa dữ liệu mẫu (sample/seed data) khỏi database.

Xóa các bản ghi được tạo bởi seed_sample_data.py:
  - exchange_rates có source='seed_data'
  - bqms_rfq có notes LIKE '%mẫu%' hoặc rfq_number LIKE 'QT2603%'
  - products có bqms_code LIKE 'Z0000001-%'
  - purchase_orders có po_number LIKE 'PO-2026-000%' (seed POs)
  - workflow_instances có title LIKE '%mẫu%'
  - inventory có location LIKE 'Kho%Kệ%'
  - notifications có title chứa text seed
  - workflow_history liên quan

GIỮ LẠI:
  - Admin user (và tất cả users)
  - Dữ liệu thật import từ Excel
  - etl_sync_log

Usage:
    python scripts/purge_sample_data.py
    python scripts/purge_sample_data.py --dry-run
    python scripts/purge_sample_data.py --dsn postgresql://...
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("purge_sample_data")

# ---------------------------------------------------------------------------
# Database DSN
# ---------------------------------------------------------------------------

DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://scadmin:SC2026_ERP_Pr0d_X9k2mQ7wR4@postgres:5432/songchau_erp",
).replace("+asyncpg", "")

# ---------------------------------------------------------------------------
# Purge queries — thứ tự xóa tôn trọng FK constraints
# ---------------------------------------------------------------------------

PURGE_QUERIES = [
    # 1. Notifications (seed)
    {
        "label": "notifications (seed)",
        "sql": """
            DELETE FROM notifications
            WHERE title IN (
                'Yêu cầu phê duyệt PO-2026-0004',
                'PO-2026-0001 đã được duyệt',
                'Báo giá BQMS bị từ chối',
                'Cảnh báo: Cover Plate sắp hết hàng',
                '2 RFQ mới từ Samsung BQMS'
            )
        """,
    },
    # 2. Workflow history (cascade xóa theo workflow_instances)
    {
        "label": "workflow_history (seed)",
        "sql": """
            DELETE FROM workflow_history
            WHERE instance_id IN (
                SELECT id FROM workflow_instances
                WHERE title LIKE '%mẫu%' OR title LIKE '%demo%'
                   OR title LIKE '%PO-2026-000%'
            )
        """,
    },
    # 3. Workflow instances (seed)
    {
        "label": "workflow_instances (seed)",
        "sql": """
            DELETE FROM workflow_instances
            WHERE title LIKE '%mẫu%' OR title LIKE '%demo%'
               OR title LIKE '%PO-2026-000%'
        """,
    },
    # 4. Inventory movements (seed inventory)
    {
        "label": "inventory_movements (seed products)",
        "sql": """
            DELETE FROM inventory_movements
            WHERE product_code LIKE 'Z0000001-%'
        """,
    },
    # 5. Inventory (seed)
    {
        "label": "inventory (seed)",
        "sql": """
            DELETE FROM inventory
            WHERE product_code LIKE 'Z0000001-%'
        """,
    },
    # 6. PO line items (seed POs)
    {
        "label": "po_line_items (seed POs)",
        "sql": """
            DELETE FROM po_line_items
            WHERE po_id IN (
                SELECT id FROM purchase_orders
                WHERE po_number LIKE 'PO-2026-000%'
                  AND notes LIKE '%mẫu%'
            )
        """,
    },
    # 7. Purchase orders (seed)
    {
        "label": "purchase_orders (seed)",
        "sql": """
            DELETE FROM purchase_orders
            WHERE po_number LIKE 'PO-2026-000%'
              AND notes LIKE '%mẫu%'
        """,
    },
    # 8. BQMS RFQ (seed)
    {
        "label": "bqms_rfq (seed)",
        "sql": """
            DELETE FROM bqms_rfq
            WHERE notes LIKE '%RFQ mẫu cho demo%'
               OR rfq_number LIKE 'QT2603%'
        """,
    },
    # 9. Products (seed) — xóa cuối vì nhiều bảng reference
    {
        "label": "products (seed Z0000001-*)",
        "sql": """
            DELETE FROM products
            WHERE bqms_code LIKE 'Z0000001-%'
              AND bqms_code NOT IN (
                  SELECT DISTINCT bqms_code FROM bqms_rfq WHERE bqms_code IS NOT NULL
                  UNION
                  SELECT DISTINCT bqms_code FROM bqms_orders WHERE bqms_code IS NOT NULL
                  UNION
                  SELECT DISTINCT bqms_code FROM bqms_deliveries WHERE bqms_code IS NOT NULL
              )
        """,
    },
    # 10. Suppliers (seed)
    {
        "label": "suppliers (seed)",
        "sql": """
            DELETE FROM suppliers
            WHERE name IN (
                'Shenzhen Huada Precision Co.',
                'Dongguan Yongxing Metal',
                'Shanghai Precision Parts Ltd.',
                'Suzhou Mingda Industrial',
                'Guangzhou Jiali Trading Co.',
                'Korea Precision Corp.',
                'Busan Metal Works Co.',
                'Inox Việt Nam JSC',
                'Phôi Sài Gòn Co., Ltd',
                'Thép Miền Nam JSC'
            )
            AND id NOT IN (
                SELECT DISTINCT supplier_id FROM purchase_orders WHERE supplier_id IS NOT NULL
            )
        """,
    },
    # 11. Exchange rates (seed)
    {
        "label": "exchange_rates (seed_data)",
        "sql": """
            DELETE FROM exchange_rates
            WHERE source = 'seed_data'
        """,
    },
]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main(dry_run: bool = False) -> None:
    """Xóa dữ liệu mẫu khỏi database."""

    import asyncpg

    logger.info("=" * 60)
    logger.info("SONG CHÂU ERP — XÓA DỮ LIỆU MẪU")
    logger.info("=" * 60)
    logger.info("DSN: %s", DSN.split("@")[-1])
    logger.info("Dry run: %s", dry_run)
    logger.info("-" * 60)

    if dry_run:
        logger.info("[DRY-RUN] Chỉ hiển thị kế hoạch, không xóa dữ liệu.")
        for q in PURGE_QUERIES:
            logger.info("  [DRY-RUN] Sẽ xóa: %s", q["label"])
        return

    try:
        conn = await asyncpg.connect(DSN)
        logger.info("Kết nối database thành công.")
    except Exception as e:
        logger.error("Không thể kết nối database: %s", e)
        sys.exit(1)

    total_deleted = 0

    try:
        for q in PURGE_QUERIES:
            try:
                result = await conn.execute(q["sql"])
                # Parse "DELETE N"
                count = 0
                if result:
                    parts = result.split()
                    if len(parts) >= 2:
                        try:
                            count = int(parts[1])
                        except ValueError:
                            pass

                total_deleted += count
                if count > 0:
                    logger.info("  [✓] Xóa %d bản ghi: %s", count, q["label"])
                else:
                    logger.info("  [−] Không có dữ liệu: %s", q["label"])

            except Exception as e:
                logger.warning("  [✗] Lỗi xóa %s: %s", q["label"], e)

    finally:
        await conn.close()
        logger.info("Đã đóng kết nối database.")

    logger.info("")
    logger.info("=" * 60)
    logger.info("TỔNG KẾT: Đã xóa %d bản ghi sample data.", total_deleted)
    logger.info("GIỮ LẠI : Users, dữ liệu thật, etl_sync_log")
    logger.info("=" * 60)


def cli() -> None:
    parser = argparse.ArgumentParser(
        description="Song Châu ERP — Xóa dữ liệu mẫu (seed data)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Chỉ hiển thị kế hoạch, không xóa thật",
    )
    parser.add_argument(
        "--dsn",
        default=None,
        help="Override DSN kết nối database",
    )

    args = parser.parse_args()

    if args.dsn:
        global DSN
        DSN = args.dsn

    asyncio.run(main(dry_run=args.dry_run))


if __name__ == "__main__":
    cli()
