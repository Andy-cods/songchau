#!/usr/bin/env python3
"""
Song Châu ERP — Validate kết quả import dữ liệu.

So sánh row count thực tế vs kỳ vọng cho mỗi bảng.
Báo cáo mismatches, bảng trống, và các vấn đề dữ liệu.

Usage:
    python scripts/validate_import.py
    python scripts/validate_import.py --dsn postgresql://...
    python scripts/validate_import.py --verbose
    python scripts/validate_import.py --table bqms_rfq
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from typing import Any

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("validate_import")

# ---------------------------------------------------------------------------
# Database DSN
# ---------------------------------------------------------------------------

DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://scadmin:SC2026_ERP_Pr0d_X9k2mQ7wR4@postgres:5432/songchau_erp",
).replace("+asyncpg", "")

# ---------------------------------------------------------------------------
# Expected minimums — ước lượng dựa trên 501 file Excel
# Mỗi bảng: (table_name, min_expected_rows, description)
# ---------------------------------------------------------------------------

EXPECTED_TABLES: list[dict[str, Any]] = [
    {
        "table": "bqms_rfq",
        "min_rows": 50,
        "description": "RFQ từ Samsung BQMS",
        "key_cols": ["rfq_number", "bqms_code"],
        "checks": [
            "SELECT COUNT(*) FROM bqms_rfq WHERE inquiry_date IS NULL",
            "SELECT COUNT(*) FROM bqms_rfq WHERE rfq_number IS NULL OR rfq_number = ''",
        ],
    },
    {
        "table": "bqms_deliveries",
        "min_rows": 100,
        "description": "Giao hàng BQMS 2023-2026",
        "key_cols": ["po_number", "bqms_code"],
        "checks": [
            "SELECT COUNT(*) FROM bqms_deliveries WHERE po_number IS NULL",
            "SELECT COUNT(*) FROM bqms_deliveries WHERE delivery_status = 'chua_giao' AND delivery_date IS NOT NULL",
        ],
    },
    {
        "table": "bqms_orders",
        "min_rows": 20,
        "description": "Đơn hàng BQMS",
        "key_cols": ["rfq_number", "bqms_code"],
        "checks": [
            "SELECT COUNT(*) FROM bqms_orders WHERE rfq_number IS NULL",
        ],
    },
    {
        "table": "bqms_samsung_po",
        "min_rows": 50,
        "description": "Samsung PO (từ BQMS portal)",
        "key_cols": ["po_number"],
        "checks": [
            "SELECT COUNT(*) FROM bqms_samsung_po WHERE po_number IS NULL OR po_number = ''",
        ],
    },
    {
        "table": "bqms_raw_material_po",
        "min_rows": 10,
        "description": "PO phôi nguyên liệu",
        "key_cols": ["po_number", "bqms_code"],
        "checks": [],
    },
    {
        "table": "bqms_material_pricing",
        "min_rows": 10,
        "description": "Giá vật liệu BQMS",
        "key_cols": ["rfq_number", "bqms_code"],
        "checks": [],
    },
    {
        "table": "import_export_tracking",
        "min_rows": 50,
        "description": "Theo dõi XNK 2023-2026",
        "key_cols": ["tracking_date", "bqms_code"],
        "checks": [
            "SELECT COUNT(*) FROM import_export_tracking WHERE tracking_date IS NULL",
        ],
    },
    {
        "table": "imv_inquiries",
        "min_rows": 30,
        "description": "Hỏi hàng IMV",
        "key_cols": ["customer_name", "product_name"],
        "checks": [],
    },
    {
        "table": "imv_consolidated",
        "min_rows": 20,
        "description": "Tổng hợp báo giá IMV",
        "key_cols": ["quotation_no", "product_code"],
        "checks": [],
    },
    {
        "table": "imv_purchase_orders",
        "min_rows": 20,
        "description": "PO IMV",
        "key_cols": ["po_number", "product_code"],
        "checks": [],
    },
    {
        "table": "customer_contacts",
        "min_rows": 5,
        "description": "Danh bạ khách hàng",
        "key_cols": ["full_name"],
        "checks": [],
    },
    {
        "table": "revenue_invoices",
        "min_rows": 50,
        "description": "Hóa đơn doanh thu 2025",
        "key_cols": ["invoice_number"],
        "checks": [
            "SELECT COUNT(*) FROM revenue_invoices WHERE invoice_date IS NULL",
            "SELECT COUNT(*) FROM revenue_invoices WHERE total_amount IS NULL OR total_amount = 0",
        ],
    },
    {
        "table": "products",
        "min_rows": 50,
        "description": "Sản phẩm (Samsung categories + ITEM_SONG CHAU)",
        "key_cols": ["bqms_code"],
        "checks": [
            "SELECT COUNT(*) FROM products WHERE product_name IS NULL OR product_name = ''",
            "SELECT COUNT(*) FROM products WHERE bqms_code IS NULL AND imv_code IS NULL",
        ],
    },
    {
        "table": "exchange_rates",
        "min_rows": 10,
        "description": "Tỷ giá USD/VND",
        "key_cols": ["rate_date"],
        "checks": [
            "SELECT COUNT(*) FROM exchange_rates WHERE rate IS NULL OR rate = 0",
        ],
    },
    {
        "table": "bqms_won_quotations",
        "min_rows": 5,
        "description": "Báo giá trúng thầu BQMS",
        "key_cols": ["rfq_number", "bqms_code"],
        "checks": [],
    },
]


# ---------------------------------------------------------------------------
# Validation logic
# ---------------------------------------------------------------------------

async def validate_table(
    conn,
    config: dict[str, Any],
    verbose: bool = False,
) -> dict[str, Any]:
    """
    Validate một bảng:
    - Đếm rows
    - So sánh vs min_expected
    - Chạy checks bổ sung
    """
    table = config["table"]
    min_rows = config["min_rows"]
    description = config["description"]

    result: dict[str, Any] = {
        "table": table,
        "description": description,
        "actual_rows": 0,
        "min_expected": min_rows,
        "status": "unknown",
        "issues": [],
    }

    try:
        # Đếm tổng rows
        actual = await conn.fetchval(f"SELECT COUNT(*) FROM {table}")
        result["actual_rows"] = actual

        if actual == 0:
            result["status"] = "EMPTY"
            result["issues"].append(f"Bảng '{table}' trống — chưa import?")
        elif actual < min_rows:
            result["status"] = "LOW"
            result["issues"].append(
                f"Chỉ có {actual} dòng (kỳ vọng >= {min_rows})"
            )
        else:
            result["status"] = "OK"

        # Đếm rows theo data_source (nếu cột tồn tại)
        try:
            source_counts = await conn.fetch(
                f"SELECT data_source, COUNT(*) as cnt "
                f"FROM {table} "
                f"WHERE data_source IS NOT NULL "
                f"GROUP BY data_source ORDER BY cnt DESC"
            )
            if source_counts:
                result["by_source"] = {
                    r["data_source"]: r["cnt"] for r in source_counts
                }
        except Exception:
            pass  # Bảng không có cột data_source

        # Kiểm tra NULL trên key columns
        for key_col in config.get("key_cols", []):
            try:
                null_count = await conn.fetchval(
                    f"SELECT COUNT(*) FROM {table} WHERE {key_col} IS NULL"
                )
                if null_count > 0:
                    result["issues"].append(
                        f"{null_count} dòng có {key_col}=NULL"
                    )
            except Exception:
                pass

        # Chạy checks bổ sung
        for check_sql in config.get("checks", []):
            try:
                check_count = await conn.fetchval(check_sql)
                if check_count and check_count > 0:
                    # Trích xuất mô tả từ SQL
                    result["issues"].append(
                        f"Check warning: {check_count} dòng — {check_sql.split('WHERE')[-1].strip()}"
                    )
            except Exception as e:
                if verbose:
                    logger.debug("  Check error for %s: %s", table, e)

        # Lấy date range (nếu có date column)
        date_cols = ["inquiry_date", "po_date", "tracking_date",
                     "invoice_date", "rate_date", "order_date"]
        for dcol in date_cols:
            try:
                date_range = await conn.fetchrow(
                    f"SELECT MIN({dcol}) as min_date, MAX({dcol}) as max_date "
                    f"FROM {table} WHERE {dcol} IS NOT NULL"
                )
                if date_range and date_range["min_date"]:
                    result["date_range"] = {
                        "column": dcol,
                        "min": str(date_range["min_date"]),
                        "max": str(date_range["max_date"]),
                    }
                    break
            except Exception:
                continue

    except Exception as e:
        result["status"] = "ERROR"
        result["issues"].append(f"Lỗi truy vấn: {e}")

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main(
    table_filter: str | None = None,
    verbose: bool = False,
) -> None:
    """Validate toàn bộ kết quả import."""

    import asyncpg

    logger.info("=" * 70)
    logger.info("SONG CHÂU ERP — VALIDATE KẾT QUẢ IMPORT")
    logger.info("=" * 70)
    logger.info("DSN: %s", DSN.split("@")[-1])
    logger.info("-" * 70)

    try:
        conn = await asyncpg.connect(DSN)
        logger.info("Kết nối database thành công.")
    except Exception as e:
        logger.error("Không thể kết nối database: %s", e)
        sys.exit(1)

    results: list[dict[str, Any]] = []
    total_rows = 0
    issues_count = 0

    try:
        # Kiểm tra ETL sync log trước
        logger.info("")
        logger.info("━━━ ETL Sync Log ━━━")
        try:
            last_sync = await conn.fetchrow(
                """
                SELECT sync_type, status, files_processed,
                       rows_inserted, rows_updated, rows_skipped,
                       started_at, completed_at, error_message
                FROM etl_sync_log
                ORDER BY id DESC LIMIT 1
                """
            )
            if last_sync:
                logger.info("  Lần sync cuối: %s (%s)",
                            last_sync["sync_type"], last_sync["status"])
                logger.info("  Thời gian    : %s → %s",
                            last_sync["started_at"], last_sync["completed_at"])
                logger.info("  Files        : %s", last_sync["files_processed"])
                logger.info("  Inserted     : %s", last_sync["rows_inserted"])
                logger.info("  Updated      : %s", last_sync["rows_updated"])
                if last_sync["error_message"]:
                    logger.warning("  Error        : %s", last_sync["error_message"])
            else:
                logger.warning("  Chưa có bản ghi sync nào trong etl_sync_log!")
        except Exception as e:
            logger.warning("  Lỗi đọc etl_sync_log: %s", e)

        # Validate từng bảng
        logger.info("")
        logger.info("━━━ Kiểm tra từng bảng ━━━")

        for config in EXPECTED_TABLES:
            if table_filter and table_filter not in config["table"]:
                continue

            result = await validate_table(conn, config, verbose)
            results.append(result)

            total_rows += result["actual_rows"]
            issues_count += len(result["issues"])

            # Hiển thị kết quả
            status_icon = {
                "OK": "[OK]",
                "LOW": "[!!]",
                "EMPTY": "[--]",
                "ERROR": "[XX]",
            }.get(result["status"], "[??]")

            logger.info(
                "  %s %-30s %6d rows (min=%d) — %s",
                status_icon, result["table"],
                result["actual_rows"], result["min_expected"],
                result["description"],
            )

            if result.get("by_source"):
                for src, cnt in result["by_source"].items():
                    logger.info("      ↳ data_source='%s': %d", src, cnt)

            if result.get("date_range"):
                dr = result["date_range"]
                logger.info(
                    "      ↳ %s: %s → %s",
                    dr["column"], dr["min"], dr["max"],
                )

            for issue in result["issues"]:
                logger.warning("      ⚠ %s", issue)

    finally:
        await conn.close()
        logger.info("")
        logger.info("Đã đóng kết nối database.")

    # Tổng kết
    ok_count = sum(1 for r in results if r["status"] == "OK")
    low_count = sum(1 for r in results if r["status"] == "LOW")
    empty_count = sum(1 for r in results if r["status"] == "EMPTY")
    error_count = sum(1 for r in results if r["status"] == "ERROR")

    logger.info("")
    logger.info("=" * 70)
    logger.info("TỔNG KẾT VALIDATION")
    logger.info("=" * 70)
    logger.info("Tổng bảng kiểm tra : %d", len(results))
    logger.info("  [OK]  Đạt        : %d", ok_count)
    logger.info("  [!!]  Ít dữ liệu : %d", low_count)
    logger.info("  [--]  Trống      : %d", empty_count)
    logger.info("  [XX]  Lỗi        : %d", error_count)
    logger.info("Tổng rows          : %d", total_rows)
    logger.info("Tổng issues        : %d", issues_count)
    logger.info("=" * 70)

    if empty_count > 0 or error_count > 0:
        logger.warning(
            "Có %d bảng trống và %d bảng lỗi — cần kiểm tra import.",
            empty_count, error_count,
        )
        sys.exit(1)

    if issues_count > 5:
        logger.warning(
            "Có %d issues — xem chi tiết phía trên.", issues_count,
        )


def cli() -> None:
    parser = argparse.ArgumentParser(
        description="Song Châu ERP — Validate kết quả import dữ liệu",
    )
    parser.add_argument(
        "--dsn",
        default=None,
        help="Override DSN kết nối database",
    )
    parser.add_argument(
        "--table",
        default=None,
        help="Chỉ validate bảng cụ thể (substring match)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Hiển thị thêm thông tin debug",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    if args.dsn:
        global DSN
        DSN = args.dsn

    asyncio.run(main(
        table_filter=args.table,
        verbose=args.verbose,
    ))


if __name__ == "__main__":
    cli()
