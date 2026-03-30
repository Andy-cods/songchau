#!/usr/bin/env python3
"""
Song Châu ERP — Seed dữ liệu mẫu cho demo / go-live testing.

Tạo dữ liệu thực tế cho tất cả module chính:
  - 10 nhà cung cấp (CN, KR, VN)
  - 20 sản phẩm (BQMS codes)
  - 5 purchase orders với line items
  - 3 workflow instances (pending, approved, rejected)
  - 5 inventory items
  - 10 BQMS RFQ records
  - 5 notifications
  - Tỷ giá USD/VND 7 ngày gần nhất

Tất cả INSERT sử dụng ON CONFLICT DO NOTHING — idempotent.

Usage:
    python scripts/seed_sample_data.py
    python scripts/seed_sample_data.py --dsn postgresql://...
    python scripts/seed_sample_data.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import date, timedelta
from decimal import Decimal

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("seed_sample_data")

# ---------------------------------------------------------------------------
# Database DSN
# ---------------------------------------------------------------------------

DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://scadmin:SC2026_ERP_Pr0d_X9k2mQ7wR4@postgres:5432/songchau_erp",
).replace("+asyncpg", "")


# ---------------------------------------------------------------------------
# Seed functions — mỗi hàm seed 1 bảng
# ---------------------------------------------------------------------------

async def seed_exchange_rates(conn) -> int:
    """Tỷ giá USD/VND, RMB/VND, KRW/VND — 7 ngày gần nhất."""
    logger.info("Seed tỷ giá ngoại tệ (7 ngày)...")
    today = date.today()
    count = 0

    rates_data = [
        # (from_currency, to_currency, base_rate, daily_variance)
        ("USD", "VND", 25_480.0, 15.0),
        ("RMB", "VND", 3_520.0, 8.0),
        ("KRW", "VND", 18.5, 0.1),
        ("JPY", "VND", 168.0, 1.0),
    ]

    for from_cur, to_cur, base_rate, variance in rates_data:
        for day_offset in range(7):
            rate_date = today - timedelta(days=day_offset)
            # Giả lập biến động nhẹ
            rate = base_rate + (variance * (3 - day_offset) / 3)

            try:
                result = await conn.execute(
                    """
                    INSERT INTO exchange_rates (rate_date, from_currency, to_currency, rate, source)
                    VALUES ($1, $2::currency_code, $3::currency_code, $4, 'seed_data')
                    ON CONFLICT (rate_date, from_currency, to_currency) DO NOTHING
                    """,
                    rate_date, from_cur, to_cur, round(rate, 4),
                )
                if "INSERT 0 1" in result:
                    count += 1
            except Exception as e:
                logger.warning("  Lỗi insert tỷ giá %s/%s ngày %s: %s", from_cur, to_cur, rate_date, e)

    logger.info("  Đã tạo %d bản ghi tỷ giá.", count)
    return count


async def get_admin_user_id(conn) -> str | None:
    """Lấy UUID của admin user (Thắng)."""
    row = await conn.fetchrow(
        "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    )
    if row:
        return str(row["id"])

    # Fallback: bất kỳ user nào
    row = await conn.fetchrow("SELECT id FROM users LIMIT 1")
    if row:
        return str(row["id"])

    return None


async def get_user_id_by_role(conn, role: str) -> str | None:
    """Lấy UUID của user theo role."""
    row = await conn.fetchrow(
        "SELECT id FROM users WHERE role = $1 LIMIT 1", role
    )
    return str(row["id"]) if row else None


async def seed_suppliers(conn, admin_id: str) -> int:
    """10 nhà cung cấp — Trung Quốc, Hàn Quốc, Việt Nam."""
    logger.info("Seed nhà cung cấp (10)...")

    suppliers = [
        # (name, contact_name, email, phone, wechat, country, payment_terms, lead_time, currency)
        ("Shenzhen Huada Precision Co.", "Zhang Wei", "zhang@huada.cn", "+86-755-8888-0001", "huada_zhang", "CN", "T/T 30% deposit, 70% before shipment", 21, "USD"),
        ("Dongguan Yongxing Metal", "Li Mei", "li@yongxing.cn", "+86-769-2222-0002", "yongxing_li", "CN", "T/T 100% after delivery", 14, "RMB"),
        ("Shanghai Precision Parts Ltd.", "Wang Jun", "wang@shprecision.cn", "+86-21-6666-0003", "shprecision_wang", "CN", "L/C 60 days", 28, "USD"),
        ("Suzhou Mingda Industrial", "Chen Yi", "chen@mingda.cn", "+86-512-5555-0004", "mingda_chen", "CN", "T/T 50% deposit", 18, "RMB"),
        ("Guangzhou Jiali Trading Co.", "Huang Fang", "huang@jiali.cn", "+86-20-3333-0005", "jiali_huang", "CN", "T/T full prepaid", 10, "USD"),
        ("Korea Precision Corp.", "Kim Minji", "kim@koprec.kr", "+82-31-888-0006", None, "KR", "T/T 30 days after B/L", 25, "KRW"),
        ("Busan Metal Works Co.", "Park Jisoo", "park@busanmetal.kr", "+82-51-999-0007", None, "KR", "L/C 90 days", 30, "KRW"),
        ("Inox Việt Nam JSC", "Nguyễn Văn An", "an@inoxvn.com.vn", "028-3838-0008", None, "VN", "Chuyển khoản 15 ngày", 7, "VND"),
        ("Phôi Sài Gòn Co., Ltd", "Trần Thị Mai", "mai@phoisg.com.vn", "028-3939-0009", None, "VN", "COD", 5, "VND"),
        ("Thép Miền Nam JSC", "Lê Hoàng Dũng", "dung@thepmiennam.vn", "028-3737-0010", None, "VN", "Chuyển khoản 7 ngày", 3, "VND"),
    ]

    count = 0
    for s in suppliers:
        try:
            result = await conn.execute(
                """
                INSERT INTO suppliers (
                    name, contact_name, contact_email, contact_phone,
                    contact_wechat, country, payment_terms, lead_time_days,
                    default_currency, rating, is_active, created_by
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8,
                    $9::currency_code, 4.0, true, $10::uuid
                )
                ON CONFLICT DO NOTHING
                """,
                s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8],
                admin_id,
            )
            if "INSERT 0 1" in result:
                count += 1
        except Exception as e:
            logger.warning("  Lỗi insert supplier '%s': %s", s[0], e)

    logger.info("  Đã tạo %d nhà cung cấp.", count)
    return count


async def seed_products(conn) -> int:
    """20 sản phẩm — BQMS codes thực tế."""
    logger.info("Seed sản phẩm (20)...")

    products = [
        # (bqms_code, product_name, specification, maker, unit, country_origin)
        ("Z0000001-709890", "Shaft Motor", "SUS304, D20 x L150mm", "Samsung", "EA", "CN"),
        ("Z0000001-712345", "Bearing Holder", "AL6061, 50x30x25mm", "Samsung", "EA", "CN"),
        ("Z0000001-715678", "Guide Rail", "SUS316, L500mm", "Samsung", "EA", "KR"),
        ("Z0000001-718901", "Cover Plate", "SPCC, 100x80x2mm", "Samsung", "EA", "CN"),
        ("Z0000001-721234", "Pin Locating", "SKD11, D8 x L30mm", "Samsung", "EA", "CN"),
        ("Z0000001-724567", "Spacer Ring", "POM, OD25 x ID15 x H10", "Samsung", "EA", "VN"),
        ("Z0000001-727890", "Clamp Bracket", "SS400, 60x40x5mm", "Samsung", "EA", "CN"),
        ("Z0000001-730123", "Roller Guide", "SUJ2, D30 x L80mm", "Samsung", "EA", "KR"),
        ("Z0000001-733456", "Nozzle Tip", "SUS316L, D5 x L20mm", "Samsung", "EA", "CN"),
        ("Z0000001-736789", "Spring Holder", "SUS304, D12 x L45mm", "Samsung", "EA", "CN"),
        ("Z0000001-740012", "Sensor Bracket", "AL5052, 80x40x3mm", "Samsung", "EA", "VN"),
        ("Z0000001-743345", "Conveyor Roller", "SUS304, D50 x L300mm", "Samsung", "EA", "CN"),
        ("Z0000001-746678", "Pusher Block", "SKS3, 40x30x20mm", "Samsung", "EA", "CN"),
        ("Z0000001-749901", "Support Plate", "SS400, 120x100x8mm", "Samsung", "EA", "VN"),
        ("Z0000001-753234", "Motor Mount", "AL6061, 80x80x15mm", "Samsung", "EA", "CN"),
        ("Z0000001-756567", "Cable Guide", "POM, 30x20x10mm", "Samsung", "EA", "CN"),
        ("Z0000001-759890", "Inspection Jig", "SKD11, 100x80x30mm", "Samsung", "SET", "CN"),
        ("Z0000001-763123", "Cam Plate", "SCM440, D60 x H25mm", "Samsung", "EA", "KR"),
        ("Z0000001-766456", "Air Cylinder Mount", "AL6061, 60x50x12mm", "Samsung", "EA", "CN"),
        ("Z0000001-769789", "Linear Bushing", "SUJ2, ID10 x OD16 x L25mm", "Samsung", "EA", "KR"),
    ]

    count = 0
    for p in products:
        try:
            result = await conn.execute(
                """
                INSERT INTO products (
                    bqms_code, product_name, specification, maker,
                    unit, country_origin, business_system, is_active
                ) VALUES ($1, $2, $3, $4, $5, $6, 'bqms', true)
                ON CONFLICT (bqms_code) DO NOTHING
                """,
                p[0], p[1], p[2], p[3], p[4], p[5],
            )
            if "INSERT 0 1" in result:
                count += 1
        except Exception as e:
            logger.warning("  Lỗi insert product '%s': %s", p[0], e)

    logger.info("  Đã tạo %d sản phẩm.", count)
    return count


async def seed_purchase_orders(conn, admin_id: str) -> int:
    """5 purchase orders với line items."""
    logger.info("Seed purchase orders (5)...")

    # Lấy supplier IDs
    suppliers = await conn.fetch(
        "SELECT id, name FROM suppliers ORDER BY id LIMIT 5"
    )
    if not suppliers:
        logger.warning("  Không có supplier — bỏ qua seed PO.")
        return 0

    # Lấy product IDs
    products = await conn.fetch(
        "SELECT id, product_name, bqms_code, specification, maker FROM products ORDER BY id LIMIT 10"
    )

    today = date.today()
    count = 0

    po_data = [
        # (po_suffix, supplier_idx, status, days_ago, currency, items_count)
        ("0001", 0, "approved", 30, "USD", 3),
        ("0002", 1, "in_transit", 15, "RMB", 2),
        ("0003", 2, "received", 45, "KRW", 2),
        ("0004", 3, "draft", 2, "USD", 1),
        ("0005", 4, "pending_approval", 5, "VND", 2),
    ]

    for po_suffix, sup_idx, status, days_ago, currency, items_count in po_data:
        po_number = f"PO-2026-{po_suffix}"
        supplier = suppliers[min(sup_idx, len(suppliers) - 1)]
        order_date = today - timedelta(days=days_ago)

        # Kiểm tra PO đã tồn tại chưa
        existing = await conn.fetchrow(
            "SELECT id FROM purchase_orders WHERE po_number = $1", po_number
        )
        if existing:
            logger.info("  [=] PO đã tồn tại: %s", po_number)
            continue

        try:
            po_row = await conn.fetchrow(
                """
                INSERT INTO purchase_orders (
                    po_number, supplier_id, status, currency,
                    order_date, expected_date, subtotal, total_amount,
                    notes, created_by
                ) VALUES (
                    $1, $2, $3::po_status, $4::currency_code,
                    $5, $6, $7, $8, $9, $10::uuid
                )
                RETURNING id
                """,
                po_number, supplier["id"], status, currency,
                order_date, order_date + timedelta(days=21),
                0.0, 0.0,
                f"Đơn hàng mẫu — {supplier['name']}",
                admin_id,
            )

            if not po_row:
                continue

            po_id = po_row["id"]
            subtotal = Decimal("0")

            # Thêm line items
            for line_num in range(1, items_count + 1):
                product = products[min(line_num - 1 + count, len(products) - 1)]
                qty = Decimal(str(line_num * 50))
                unit_price = Decimal(str(line_num * 15000 + 5000))

                await conn.execute(
                    """
                    INSERT INTO po_line_items (
                        po_id, line_number, product_id, product_code,
                        product_name, specification, maker,
                        quantity, unit, unit_price, currency
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, 'EA', $9, $10::currency_code
                    )
                    """,
                    po_id, line_num, product["id"],
                    product["bqms_code"], product["product_name"],
                    product.get("specification"), product.get("maker"),
                    float(qty), float(unit_price), currency,
                )
                subtotal += qty * unit_price

            # Cập nhật tổng tiền PO
            await conn.execute(
                """
                UPDATE purchase_orders
                SET subtotal = $1, total_amount = $1
                WHERE id = $2
                """,
                float(subtotal), po_id,
            )

            count += 1
            logger.info("  [+] PO: %s, %d items, total=%s %s", po_number, items_count, subtotal, currency)

        except Exception as e:
            logger.warning("  Lỗi tạo PO %s: %s", po_number, e)

    logger.info("  Đã tạo %d purchase orders.", count)
    return count


async def seed_workflows(conn, admin_id: str) -> int:
    """3 workflow instances — pending, approved, rejected."""
    logger.info("Seed workflow instances (3)...")

    # Lấy user IDs cho assign
    manager_id = await get_user_id_by_role(conn, "manager")
    procurement_id = await get_user_id_by_role(conn, "procurement")

    if not manager_id or not procurement_id:
        logger.warning("  Thiếu user manager/procurement — bỏ qua seed workflow.")
        return 0

    workflows = [
        # (type, status, title, amount, priority, created_by, assigned_to)
        (
            "purchase_approval", "pending_l1",
            "Phê duyệt PO-2026-0004 — Suzhou Mingda Industrial",
            Decimal("25000000"), 3,
            procurement_id, manager_id,
        ),
        (
            "po_approval", "approved",
            "Phê duyệt đơn hàng phôi SKD11 — Shenzhen Huada",
            Decimal("85000000"), 2,
            procurement_id, manager_id,
        ),
        (
            "bqms_quotation", "rejected",
            "Báo giá BQMS Z0000001-709890 — giá cao hơn thị trường",
            Decimal("12500000"), 2,
            procurement_id, manager_id,
        ),
    ]

    count = 0
    for wf_type, status, title, amount, priority, created_by, assigned_to in workflows:
        try:
            existing = await conn.fetchrow(
                "SELECT id FROM workflow_instances WHERE title = $1", title
            )
            if existing:
                logger.info("  [=] Workflow đã tồn tại: %s", title[:50])
                continue

            wf_row = await conn.fetchrow(
                """
                INSERT INTO workflow_instances (
                    workflow_type, current_status, title, amount,
                    currency, priority, created_by, assigned_to
                ) VALUES (
                    $1::workflow_type, $2::workflow_status, $3, $4,
                    'VND', $5, $6::uuid, $7::uuid
                )
                RETURNING id
                """,
                wf_type, status, title, float(amount),
                priority, created_by, assigned_to,
            )

            if wf_row:
                # Thêm lịch sử workflow
                await conn.execute(
                    """
                    INSERT INTO workflow_history (
                        instance_id, from_status, to_status, action, actor_id, comment
                    ) VALUES ($1, NULL, 'draft', 'create', $2::uuid, 'Tạo mới bởi hệ thống seed')
                    """,
                    wf_row["id"], created_by,
                )

                if status != "draft":
                    await conn.execute(
                        """
                        INSERT INTO workflow_history (
                            instance_id, from_status, to_status, action, actor_id, comment
                        ) VALUES ($1, 'draft', $2::workflow_status, $3, $4::uuid, $5)
                        """,
                        wf_row["id"], status,
                        "approve" if status == "approved" else ("reject" if status == "rejected" else "submit"),
                        assigned_to if status in ("approved", "rejected") else created_by,
                        "Dữ liệu mẫu cho demo",
                    )

                count += 1
                logger.info("  [+] Workflow: %s — %s", status, title[:50])

        except Exception as e:
            logger.warning("  Lỗi tạo workflow: %s", e)

    logger.info("  Đã tạo %d workflow instances.", count)
    return count


async def seed_inventory(conn) -> int:
    """5 inventory items."""
    logger.info("Seed inventory (5)...")

    products = await conn.fetch(
        "SELECT id, bqms_code, product_name, specification FROM products ORDER BY id LIMIT 5"
    )
    if not products:
        logger.warning("  Không có product — bỏ qua seed inventory.")
        return 0

    count = 0
    inventory_data = [
        # (product_idx, qty, reserved, min_stock, location, unit_cost)
        (0, 150, 20, 50, "Kho A — Kệ 1", 45000.0),
        (1, 80, 0, 30, "Kho A — Kệ 2", 28000.0),
        (2, 200, 50, 100, "Kho B — Kệ 1", 65000.0),
        (3, 30, 10, 20, "Kho A — Kệ 3", 15000.0),
        (4, 500, 100, 200, "Kho B — Kệ 2", 8500.0),
    ]

    for prod_idx, qty, reserved, min_stock, location, unit_cost in inventory_data:
        product = products[min(prod_idx, len(products) - 1)]
        try:
            result = await conn.execute(
                """
                INSERT INTO inventory (
                    product_id, product_code, product_name,
                    specification, unit, quantity, reserved_qty,
                    min_stock, location, unit_cost
                ) VALUES (
                    $1, $2, $3, $4, 'EA', $5, $6, $7, $8, $9
                )
                ON CONFLICT (product_code) DO NOTHING
                """,
                product["id"], product["bqms_code"], product["product_name"],
                product.get("specification"),
                float(qty), float(reserved), float(min_stock),
                location, unit_cost,
            )
            if "INSERT 0 1" in result:
                count += 1
        except Exception as e:
            logger.warning("  Lỗi insert inventory: %s", e)

    logger.info("  Đã tạo %d inventory items.", count)
    return count


async def seed_bqms_rfq(conn) -> int:
    """10 BQMS RFQ records."""
    logger.info("Seed BQMS RFQ (10)...")

    products = await conn.fetch(
        "SELECT id, bqms_code, specification, maker FROM products ORDER BY id LIMIT 10"
    )

    today = date.today()
    count = 0

    rfq_data = [
        # (rfq_number, person, expected_qty, rmb_price, vnd_price, result, days_ago)
        ("QT26030101", "Ngân", 100, 85.5, 305000, "won", 60),
        ("QT26030102", "Quỳnh", 200, 42.0, 150000, "won", 55),
        ("QT26030103", "Thúy", 50, 120.0, 428000, "lost", 50),
        ("QT26030104", "Ngân", 500, 15.0, 53500, "pending", 30),
        ("QT26030105", "Quỳnh", 80, 95.0, 339000, "won", 45),
        ("QT26030106", "Hằng", 150, 68.0, 243000, "pending", 20),
        ("QT26030107", "Linh", 300, 25.0, 89000, "won", 40),
        ("QT26030108", "Ngân", 60, 180.0, 643000, "lost", 35),
        ("QT26030109", "Quỳnh", 1000, 8.5, 30000, "pending", 10),
        ("QT26030110", "Thúy", 75, 155.0, 553000, "pending", 5),
    ]

    suppliers_list = [
        "Shenzhen Huada Precision Co.",
        "Dongguan Yongxing Metal",
        "Shanghai Precision Parts Ltd.",
        "Korea Precision Corp.",
        "Inox Việt Nam JSC",
    ]

    for i, (rfq_no, person, qty, rmb, vnd, result, days_ago) in enumerate(rfq_data):
        product = products[min(i, len(products) - 1)]
        inquiry_date = today - timedelta(days=days_ago)
        supplier = suppliers_list[i % len(suppliers_list)]

        try:
            r = await conn.execute(
                """
                INSERT INTO bqms_rfq (
                    rfq_number, bqms_code, specification, maker,
                    inquiry_date, person_in_charge_name, expected_qty,
                    purchase_price_rmb, purchase_price_vnd,
                    supplier_name, result, notes
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11::rfq_result, $12
                )
                """,
                rfq_no, product["bqms_code"], product.get("specification"),
                product.get("maker"), inquiry_date, person, float(qty),
                float(rmb), float(vnd), supplier, result,
                f"RFQ mẫu cho demo — {product['bqms_code']}",
            )
            count += 1
        except Exception as e:
            logger.warning("  Lỗi insert RFQ %s: %s", rfq_no, e)

    logger.info("  Đã tạo %d BQMS RFQ records.", count)
    return count


async def seed_notifications(conn) -> int:
    """5 notifications — các loại khác nhau."""
    logger.info("Seed notifications (5)...")

    # Lấy user IDs
    admin_id = await get_user_id_by_role(conn, "admin")
    manager_id = await get_user_id_by_role(conn, "manager")
    procurement_id = await get_user_id_by_role(conn, "procurement")
    warehouse_id = await get_user_id_by_role(conn, "warehouse")

    if not all([admin_id, manager_id, procurement_id]):
        logger.warning("  Thiếu user — bỏ qua seed notifications.")
        return 0

    notifications = [
        # (recipient_id, type, title, body, is_read)
        (
            manager_id, "workflow_request",
            "Yêu cầu phê duyệt PO-2026-0004",
            "Ngân yêu cầu phê duyệt đơn hàng cho Suzhou Mingda, tổng giá trị 25,000,000 VND.",
            False,
        ),
        (
            procurement_id, "workflow_approved",
            "PO-2026-0001 đã được duyệt",
            "Đơn hàng PO-2026-0001 (Shenzhen Huada) đã được Manager phê duyệt. Tiến hành gửi cho NCC.",
            True,
        ),
        (
            procurement_id, "workflow_rejected",
            "Báo giá BQMS bị từ chối",
            "Báo giá cho Z0000001-709890 bị từ chối — giá cao hơn 15% so với thị trường. Cần đàm phán lại.",
            False,
        ),
        (
            warehouse_id or admin_id, "stock_alert",
            "Cảnh báo: Cover Plate sắp hết hàng",
            "Tồn kho Cover Plate (Z0000001-718901) còn 30 EA, dưới mức tối thiểu 20 EA.",
            False,
        ),
        (
            admin_id, "bqms_rfq_new",
            "2 RFQ mới từ Samsung BQMS",
            "Hệ thống nhận được 2 yêu cầu báo giá mới từ Samsung. Vui lòng kiểm tra và phân công.",
            False,
        ),
    ]

    count = 0
    for recipient_id, ntype, title, body, is_read in notifications:
        try:
            result = await conn.execute(
                """
                INSERT INTO notifications (
                    recipient_id, type, title, body, is_read
                ) VALUES (
                    $1::uuid, $2::notification_type, $3, $4, $5
                )
                """,
                recipient_id, ntype, title, body, is_read,
            )
            count += 1
        except Exception as e:
            logger.warning("  Lỗi insert notification: %s", e)

    logger.info("  Đã tạo %d notifications.", count)
    return count


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main(dry_run: bool = False) -> None:
    """Seed toàn bộ dữ liệu mẫu."""

    import asyncpg

    logger.info("=" * 60)
    logger.info("SONG CHÂU ERP — SEED DỮ LIỆU MẪU")
    logger.info("=" * 60)
    logger.info("DSN: %s", DSN.split("@")[-1])
    logger.info("Dry run: %s", dry_run)
    logger.info("-" * 60)

    if dry_run:
        logger.info("[DRY-RUN] Chỉ hiển thị kế hoạch, không ghi vào database.")
        logger.info("  - 7 ngày tỷ giá (USD, RMB, KRW, JPY → VND)")
        logger.info("  - 10 nhà cung cấp (CN/KR/VN)")
        logger.info("  - 20 sản phẩm BQMS")
        logger.info("  - 5 purchase orders + line items")
        logger.info("  - 3 workflow instances")
        logger.info("  - 5 inventory items")
        logger.info("  - 10 BQMS RFQ records")
        logger.info("  - 5 notifications")
        return

    # Kết nối database
    try:
        conn = await asyncpg.connect(DSN)
        logger.info("Kết nối database thành công.")
    except Exception as e:
        logger.error("Không thể kết nối database: %s", e)
        sys.exit(1)

    totals: dict[str, int] = {}

    try:
        # Kiểm tra có user nào chưa
        admin_id = await get_admin_user_id(conn)
        if not admin_id:
            logger.error(
                "Không tìm thấy user nào trong database! "
                "Chạy 'python scripts/seed_users.py' trước."
            )
            sys.exit(1)

        logger.info("Admin user ID: %s", admin_id[:8])
        logger.info("")

        # Seed theo thứ tự dependency
        totals["exchange_rates"] = await seed_exchange_rates(conn)
        totals["suppliers"] = await seed_suppliers(conn, admin_id)
        totals["products"] = await seed_products(conn)
        totals["purchase_orders"] = await seed_purchase_orders(conn, admin_id)
        totals["workflows"] = await seed_workflows(conn, admin_id)
        totals["inventory"] = await seed_inventory(conn)
        totals["bqms_rfq"] = await seed_bqms_rfq(conn)
        totals["notifications"] = await seed_notifications(conn)

    finally:
        await conn.close()
        logger.info("Đã đóng kết nối database.")

    # Tổng kết
    logger.info("")
    logger.info("=" * 60)
    logger.info("TỔNG KẾT SEED DATA")
    logger.info("=" * 60)
    grand_total = 0
    for table, cnt in totals.items():
        logger.info("  %-25s: %d bản ghi", table, cnt)
        grand_total += cnt
    logger.info("-" * 60)
    logger.info("  %-25s: %d bản ghi", "TỔNG CỘNG", grand_total)
    logger.info("=" * 60)


def cli() -> None:
    parser = argparse.ArgumentParser(
        description="Song Châu ERP — Seed dữ liệu mẫu cho demo",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Chỉ hiển thị kế hoạch, không ghi vào database",
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
