#!/usr/bin/env python3
"""
Song Châu ERP — Tạo 18 tài khoản người dùng ban đầu.

Chạy MỘT LẦN trước go-live để tạo tài khoản cho toàn bộ nhân sự.
Sử dụng bcrypt (rounds=12) để hash mật khẩu.
ON CONFLICT (email) DO NOTHING — chạy lại an toàn.

Usage:
    python scripts/seed_users.py
    python scripts/seed_users.py --dsn postgresql://user:pass@host:5432/db
    python scripts/seed_users.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

import bcrypt

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("seed_users")

# ---------------------------------------------------------------------------
# Database DSN
# ---------------------------------------------------------------------------

DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://scadmin:SC2026_ERP_Pr0d_X9k2mQ7wR4@postgres:5432/songchau_erp",
)

# ---------------------------------------------------------------------------
# Danh sách 18 nhân viên Song Châu — theo MASTER_CONTEXT roles
# ---------------------------------------------------------------------------

USERS = [
    # ── Admin / IT ──
    {
        "email": "thang@songchau.vn",
        "full_name": "Nguyễn Đức Thắng",
        "display_name": "Thắng",
        "role": "admin",
        "department": "IT",
        "phone": "0901000001",
        "password": "SongChau@2026",
    },
    # ── Managers — Quản lý ──
    {
        "email": "manager@songchau.vn",
        "full_name": "Trưởng Phòng KD",
        "display_name": "Manager",
        "role": "manager",
        "department": "Kinh doanh",
        "phone": "0901000002",
        "password": "SC2026Manager!",
    },
    {
        "email": "giamdoc@songchau.vn",
        "full_name": "Giám Đốc",
        "display_name": "GĐ",
        "role": "manager",
        "department": "Ban Giám Đốc",
        "phone": "0901000003",
        "password": "SC2026GD!",
    },
    # ── Procurement — Mua hàng ──
    {
        "email": "ngan@songchau.vn",
        "full_name": "Nguyễn Thị Ngân",
        "display_name": "Ngân",
        "role": "procurement",
        "department": "Mua hàng",
        "phone": "0901000010",
        "password": "SC2026Ngan!",
    },
    {
        "email": "quynh@songchau.vn",
        "full_name": "Trần Thị Quỳnh",
        "display_name": "Quỳnh",
        "role": "procurement",
        "department": "Mua hàng",
        "phone": "0901000011",
        "password": "SC2026Quynh!",
    },
    {
        "email": "thuy@songchau.vn",
        "full_name": "Lê Thị Thúy",
        "display_name": "Thúy",
        "role": "procurement",
        "department": "Mua hàng",
        "phone": "0901000012",
        "password": "SC2026Thuy!",
    },
    {
        "email": "hang@songchau.vn",
        "full_name": "Phạm Thị Hằng",
        "display_name": "Hằng",
        "role": "procurement",
        "department": "Mua hàng",
        "phone": "0901000013",
        "password": "SC2026Hang!",
    },
    {
        "email": "linh@songchau.vn",
        "full_name": "Nguyễn Thùy Linh",
        "display_name": "Linh",
        "role": "procurement",
        "department": "Mua hàng",
        "phone": "0901000014",
        "password": "SC2026Linh!",
    },
    # ── Warehouse — Kho ──
    {
        "email": "kho@songchau.vn",
        "full_name": "Nguyễn Văn Kho",
        "display_name": "Kho",
        "role": "warehouse",
        "department": "Kho",
        "phone": "0901000020",
        "password": "SC2026Kho!",
    },
    {
        "email": "kho2@songchau.vn",
        "full_name": "Trần Văn Tùng",
        "display_name": "Tùng",
        "role": "warehouse",
        "department": "Kho",
        "phone": "0901000021",
        "password": "SC2026Kho2!",
    },
    # ── Accountant — Kế toán ──
    {
        "email": "ketoan@songchau.vn",
        "full_name": "Phạm Thị Kế Toán",
        "display_name": "Kế Toán",
        "role": "accountant",
        "department": "Kế toán",
        "phone": "0901000030",
        "password": "SC2026KeToan!",
    },
    {
        "email": "ketoan2@songchau.vn",
        "full_name": "Lê Thị Hoa",
        "display_name": "Hoa",
        "role": "accountant",
        "department": "Kế toán",
        "phone": "0901000031",
        "password": "SC2026KeToan2!",
    },
    # ── Staff — Nhân viên văn phòng ──
    {
        "email": "staff1@songchau.vn",
        "full_name": "Nhân viên 1",
        "display_name": "NV1",
        "role": "staff",
        "department": "Văn phòng",
        "phone": "0901000040",
        "password": "SC2026Staff1!",
    },
    {
        "email": "staff2@songchau.vn",
        "full_name": "Nhân viên 2",
        "display_name": "NV2",
        "role": "staff",
        "department": "Văn phòng",
        "phone": "0901000041",
        "password": "SC2026Staff2!",
    },
    {
        "email": "staff3@songchau.vn",
        "full_name": "Nhân viên 3",
        "display_name": "NV3",
        "role": "staff",
        "department": "Văn phòng",
        "phone": "0901000042",
        "password": "SC2026Staff3!",
    },
    {
        "email": "staff4@songchau.vn",
        "full_name": "Nhân viên 4",
        "display_name": "NV4",
        "role": "staff",
        "department": "Văn phòng",
        "phone": "0901000043",
        "password": "SC2026Staff4!",
    },
    {
        "email": "staff5@songchau.vn",
        "full_name": "Nhân viên 5",
        "display_name": "NV5",
        "role": "staff",
        "department": "Kinh doanh",
        "phone": "0901000044",
        "password": "SC2026Staff5!",
    },
    {
        "email": "staff6@songchau.vn",
        "full_name": "Nhân viên 6",
        "display_name": "NV6",
        "role": "staff",
        "department": "Kinh doanh",
        "phone": "0901000045",
        "password": "SC2026Staff6!",
    },
]


def hash_password(password: str) -> str:
    """Hash mật khẩu bằng bcrypt với 12 rounds."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")


INSERT_USER_SQL = """
    INSERT INTO users (email, full_name, display_name, role, department, phone, hashed_password)
    VALUES ($1, $2, $3, $4::role_enum, $5, $6, $7)
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email
"""


async def main(dry_run: bool = False) -> None:
    """Tạo tài khoản cho toàn bộ nhân sự."""

    import asyncpg

    logger.info("=" * 60)
    logger.info("SONG CHÂU ERP — TẠO TÀI KHOẢN NGƯỜI DÙNG")
    logger.info("=" * 60)
    logger.info("Tổng số tài khoản: %d", len(USERS))
    logger.info("DSN: %s", DSN.split("@")[-1])
    logger.info("Dry run: %s", dry_run)
    logger.info("-" * 60)

    # Hash tất cả mật khẩu trước (CPU-bound)
    logger.info("Hash mật khẩu (bcrypt, 12 rounds)...")
    hashed_users = []
    for user in USERS:
        hashed = hash_password(user["password"])
        hashed_users.append({**user, "hashed_password": hashed})
        logger.info("  %-25s role=%-12s department=%s", user["email"], user["role"], user["department"])

    if dry_run:
        logger.info("")
        logger.info("[DRY-RUN] Không ghi vào database.")
        logger.info("Đã chuẩn bị %d tài khoản.", len(hashed_users))
        return

    # Kết nối database
    try:
        conn = await asyncpg.connect(DSN)
        logger.info("Kết nối database thành công.")
    except Exception as e:
        logger.error("Không thể kết nối database: %s", e)
        sys.exit(1)

    created = 0
    skipped = 0

    try:
        for user in hashed_users:
            try:
                result = await conn.fetchrow(
                    INSERT_USER_SQL,
                    user["email"],
                    user["full_name"],
                    user["display_name"],
                    user["role"],
                    user["department"],
                    user.get("phone"),
                    user["hashed_password"],
                )
                if result:
                    created += 1
                    logger.info(
                        "  [+] Tạo mới: %-25s (id=%s)",
                        result["email"],
                        str(result["id"])[:8],
                    )
                else:
                    skipped += 1
                    logger.info("  [=] Đã tồn tại: %s", user["email"])

            except Exception as e:
                logger.error("  [!] Lỗi tạo user %s: %s", user["email"], e)

    finally:
        await conn.close()
        logger.info("Đã đóng kết nối database.")

    # Tổng kết
    logger.info("")
    logger.info("=" * 60)
    logger.info("TỔNG KẾT")
    logger.info("=" * 60)
    logger.info("Tạo mới  : %d tài khoản", created)
    logger.info("Đã có sẵn: %d tài khoản", skipped)
    logger.info("Tổng cộng: %d / %d", created + skipped, len(USERS))
    logger.info("=" * 60)


def cli() -> None:
    parser = argparse.ArgumentParser(
        description="Song Châu ERP — Tạo tài khoản người dùng ban đầu",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Chỉ hiển thị, không ghi vào database",
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
