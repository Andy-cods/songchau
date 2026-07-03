"""W2-07 — HARDENING + TEST magic-link cổng NCC (bảo mật CHẶN W2-05).

Cổng NCC dùng 2 loại "link đăng nhập/magic-link" (Thang gửi tay cho NCC):

  * KÍCH HOẠT  — `vendor_accounts.activation_token` (+ `activation_expires`, TTL 7
                 ngày). Admin mời NCC → POST `/api/vendor/auth/activate {token, password}`
                 → đặt mật khẩu lần đầu + active. ONE-TIME.
  * ĐẶT LẠI MK — `vendor_accounts.reset_token` (+ `reset_expires`, TTL 30 phút).
                 `/api/vendor/auth/forgot-password` → `/api/vendor/auth/reset-password`.
                 ONE-TIME.

Cả hai đều là link DÙNG-MỘT-LẦN (khác link đăng-nhập-lại-nhiều-lần: NCC đăng nhập
lại bằng email + mật khẩu, KHÔNG bằng token). File này khoá 4 mặt bảo mật:

  ENTROPY  — token = ``secrets.token_urlsafe(32)`` (256-bit): đủ dài, url-safe,
             DUY NHẤT mỗi lần sinh (không đoán/dò được).
  EXPIRY   — token quá hạn → 410; token KHÔNG có hạn (expires NULL) cũng bị từ
             chối (FAIL-CLOSED — hardening W2-07).
  ONE-TIME — dùng lần 1 thành công → token bị tiêu thụ (NULL) → dùng lần 2 bị từ
             chối. Tiêu thụ ATOMIC (UPDATE có điều kiện) chống double-use.
  REPLAY   — token lạ/đã-dùng/hết-hạn bị từ chối; reset còn BUMP password_version
             → revoke mọi phiên/JWT cũ.

──────────────────────────────────────────────────────────────────────────────
MUTATION-CHECK (bằng chứng test THỰC SỰ bắt lỗi)
──────────────────────────────────────────────────────────────────────────────
  * FAIL-CLOSED: ở `auth.py::vendor_activate`, đổi lại điều kiện expiry thành
    `if va["activation_expires"] and va["activation_expires"] < now:` (bỏ nhánh
    NULL) ⇒ `test_activation_null_expiry_rejected` PHẢI FAIL (token vô hạn lọt qua
    → 200 thay vì 410). Khôi phục ⇒ xanh lại.
  * ONE-TIME: bỏ điều kiện `AND activation_token = $2 ... AND activation_expires >
    NOW()` khỏi câu UPDATE tiêu thụ ⇒ token có thể dùng lại → các test one-time đỏ.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import pytest

# Mật khẩu hợp policy NCC (≥8, có chữ + số) — dùng khi POST activate/reset.
TEST_VENDOR_PW = "NewPass@123"
# Regex ký tự URL-safe base64 mà secrets.token_urlsafe sinh ra.
_URLSAFE_RE = re.compile(r"[A-Za-z0-9_-]+")
# token_urlsafe(32) = 32 byte → base64url ~ 43 ký tự (không padding).
_MIN_TOKEN_LEN = 43


# ── Guard: chỉ chạy khi có full prod schema (cần bảng vendor_accounts + users) ──
@pytest.fixture(autouse=True)
def _require_full_schema(request):
    if request.node.get_closest_marker("integration"):
        info = request.getfixturevalue("schema_info")
        if not info["full_schema"]:
            pytest.skip(
                "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
                "(pg_dump --schema-only). Schema đang nạp: " + info["source"]
            )


# ── Chặn gửi email THẬT (M365/MSAL gọi mạng → có thể treo test) ──────────────
@pytest.fixture(autouse=True)
def _stub_email(monkeypatch):
    async def _noop(*args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        return True

    # send_email được import trực tiếp vào 2 namespace endpoint → patch cả hai.
    for target in (
        "app.api.vendor.auth.send_email",
        "app.api.v1.procurement.send_email",
    ):
        monkeypatch.setattr(target, _noop, raising=False)


# ── Seed helpers (đều nằm trong transaction rollback của fixture `db`) ────────
async def _seed_pending_vendor(
    db,
    *,
    activation_token: str | None = None,
    activation_expires: datetime | None = None,
    email: str = "pending-ncc@test.songchau.vn",
) -> dict:
    """NCC PENDING (users inactive + vendor_accounts pending) mang activation_token.

    hashed_password='!' khớp luồng invite thật (không phải bcrypt hợp lệ → không
    đăng nhập được tới khi activate đặt mật khẩu thật).
    """
    user_id = await db.fetchval(
        "INSERT INTO users (email, hashed_password, full_name, role, is_active, "
        "password_version) VALUES ($1, '!', 'NCC Pending', 'vendor'::role_enum, "
        "false, 1) RETURNING id",
        email,
    )
    va_id = await db.fetchval(
        "INSERT INTO vendor_accounts (user_id, company_name, contact_name, status, "
        "activation_token, activation_expires) "
        "VALUES ($1, 'Cty Pending', 'Người P', 'pending', $2, $3) RETURNING id",
        user_id, activation_token, activation_expires,
    )
    return {"user_id": user_id, "va_id": va_id, "email": email}


async def _seed_active_vendor_with_reset(
    db,
    *,
    reset_token: str | None = None,
    reset_expires: datetime | None = None,
    email: str = "active-ncc@test.songchau.vn",
) -> dict:
    """NCC ACTIVE mang reset_token (mô phỏng sau khi gọi forgot-password)."""
    from app.core.security import hash_password

    user_id = await db.fetchval(
        "INSERT INTO users (email, hashed_password, full_name, role, is_active, "
        "password_version) VALUES ($1, $2, 'NCC Active', 'vendor'::role_enum, "
        "true, 1) RETURNING id",
        email, hash_password("OldPass@123"),
    )
    va_id = await db.fetchval(
        "INSERT INTO vendor_accounts (user_id, company_name, contact_name, status, "
        "is_approved, reset_token, reset_expires) "
        "VALUES ($1, 'Cty Active', 'Người A', 'active', true, $2, $3) RETURNING id",
        user_id, reset_token, reset_expires,
    )
    return {"user_id": user_id, "va_id": va_id, "email": email}


def _assert_high_entropy(tok: str) -> None:
    assert tok, "token rỗng"
    assert len(tok) >= _MIN_TOKEN_LEN, f"token quá ngắn ({len(tok)}) — entropy yếu"
    assert _URLSAFE_RE.fullmatch(tok), f"token có ký tự ngoài url-safe: {tok!r}"


# ══════════════════════════════════════════════════════════════════════════
# 1) ENTROPY
# ══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_reset_token_entropy_unique(client, db):
    """forgot-password sinh reset_token 256-bit: đủ dài, url-safe, DUY NHẤT mỗi lần."""
    email = "entropy-reset@test.songchau.vn"
    await _seed_active_vendor_with_reset(db, email=email)  # chưa có token

    seen: set[str] = set()
    for _ in range(5):
        r = await client.post("/api/vendor/auth/forgot-password", json={"email": email})
        assert r.status_code == 200, r.text
        tok = await db.fetchval(
            "SELECT reset_token FROM vendor_accounts WHERE user_id = "
            "(SELECT id FROM users WHERE email = $1)",
            email,
        )
        _assert_high_entropy(tok)
        seen.add(tok)
    assert len(seen) == 5, "reset_token bị lặp giữa các lần — nguồn ngẫu nhiên yếu"


@pytest.mark.integration
async def test_activation_token_entropy_via_invite(client, admin, db):
    """Admin mời NCC → activation_token 256-bit, url-safe, khác nhau mỗi lần mời."""
    seen: set[str] = set()
    for i in range(3):
        r = await client.post(
            "/api/v1/procurement/vendors/invite",
            headers=admin["headers"],
            json={
                "email": f"invitee{i}@test.songchau.vn",
                "company_name": "Cty Mời",
                "contact_name": "Người Mời",
            },
        )
        assert r.status_code == 200, r.text
        link = r.json()["data"]["activation_link"]
        tok = link.rsplit("/", 1)[-1]
        _assert_high_entropy(tok)
        seen.add(tok)
    assert len(seen) == 3, "activation_token bị lặp — nguồn ngẫu nhiên yếu"


# ══════════════════════════════════════════════════════════════════════════
# 2) EXPIRY  (gồm FAIL-CLOSED khi expires NULL)
# ══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_activation_expired_rejected(client, db):
    """activation_token quá hạn → 410; tài khoản KHÔNG bị kích hoạt."""
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    v = await _seed_pending_vendor(
        db, activation_token="act-expired-xyz", activation_expires=past
    )
    r = await client.post(
        "/api/vendor/auth/activate",
        json={"token": "act-expired-xyz", "password": TEST_VENDOR_PW},
    )
    assert r.status_code == 410, r.text
    assert (await db.fetchval("SELECT is_active FROM users WHERE id=$1", v["user_id"])) is False


@pytest.mark.integration
async def test_activation_null_expiry_rejected(client, db):
    """FAIL-CLOSED (hardening W2-07): activation_expires NULL vẫn bị từ chối 410."""
    v = await _seed_pending_vendor(
        db, activation_token="act-noexpiry-xyz", activation_expires=None
    )
    r = await client.post(
        "/api/vendor/auth/activate",
        json={"token": "act-noexpiry-xyz", "password": TEST_VENDOR_PW},
    )
    assert r.status_code == 410, r.text
    assert (await db.fetchval("SELECT is_active FROM users WHERE id=$1", v["user_id"])) is False


@pytest.mark.integration
async def test_reset_expired_rejected(client, db):
    """reset_token quá hạn → 410; mật khẩu KHÔNG bị đổi (pv giữ nguyên)."""
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    v = await _seed_active_vendor_with_reset(
        db, reset_token="rst-expired-xyz", reset_expires=past
    )
    r = await client.post(
        "/api/vendor/auth/reset-password",
        json={"token": "rst-expired-xyz", "password": TEST_VENDOR_PW},
    )
    assert r.status_code == 410, r.text
    assert (await db.fetchval("SELECT password_version FROM users WHERE id=$1", v["user_id"])) == 1


@pytest.mark.integration
async def test_reset_null_expiry_rejected(client, db):
    """FAIL-CLOSED: reset_expires NULL vẫn bị từ chối 410."""
    v = await _seed_active_vendor_with_reset(
        db, reset_token="rst-noexpiry-xyz", reset_expires=None
    )
    r = await client.post(
        "/api/vendor/auth/reset-password",
        json={"token": "rst-noexpiry-xyz", "password": TEST_VENDOR_PW},
    )
    assert r.status_code == 410, r.text


# ══════════════════════════════════════════════════════════════════════════
# 3) ONE-TIME
# ══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_activation_one_time(client, db):
    """activate: lần 1 OK + trả JWT + tiêu thụ token; lần 2 tái dùng → từ chối."""
    future = datetime.now(timezone.utc) + timedelta(days=7)
    v = await _seed_pending_vendor(
        db, activation_token="act-once-xyz", activation_expires=future
    )

    r1 = await client.post(
        "/api/vendor/auth/activate",
        json={"token": "act-once-xyz", "password": TEST_VENDOR_PW},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json().get("access_token"), "activate không trả access_token"

    # Token đã bị tiêu thụ (NULL) + tài khoản active.
    assert (await db.fetchval("SELECT activation_token FROM vendor_accounts WHERE id=$1", v["va_id"])) is None
    assert (await db.fetchval("SELECT is_active FROM users WHERE id=$1", v["user_id"])) is True

    # Lần 2: cùng token → bị từ chối (404 vì token đã NULL).
    r2 = await client.post(
        "/api/vendor/auth/activate",
        json={"token": "act-once-xyz", "password": "Different@456"},
    )
    assert r2.status_code in (404, 409, 410), r2.text


@pytest.mark.integration
async def test_reset_one_time_and_revokes_old_sessions(client, db):
    """reset: lần 1 OK + BUMP pv (revoke phiên cũ) + tiêu thụ token; lần 2 → từ chối."""
    future = datetime.now(timezone.utc) + timedelta(minutes=30)
    v = await _seed_active_vendor_with_reset(
        db, reset_token="rst-once-xyz", reset_expires=future
    )
    pv_before = await db.fetchval("SELECT password_version FROM users WHERE id=$1", v["user_id"])

    r1 = await client.post(
        "/api/vendor/auth/reset-password",
        json={"token": "rst-once-xyz", "password": TEST_VENDOR_PW},
    )
    assert r1.status_code == 200, r1.text

    # pv +1 → mọi JWT cũ bị revoke ở resolve_vendor (chống replay phiên cũ).
    pv_after = await db.fetchval("SELECT password_version FROM users WHERE id=$1", v["user_id"])
    assert pv_after == pv_before + 1, "reset không bump password_version"
    assert (await db.fetchval("SELECT reset_token FROM vendor_accounts WHERE id=$1", v["va_id"])) is None

    # Lần 2: cùng token → từ chối.
    r2 = await client.post(
        "/api/vendor/auth/reset-password",
        json={"token": "rst-once-xyz", "password": "Different@456"},
    )
    assert r2.status_code in (404, 409, 410), r2.text


# ══════════════════════════════════════════════════════════════════════════
# 4) REPLAY  (token lạ / rác)
# ══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_unknown_token_rejected(client, db):
    """Token không tồn tại (đoán mò/replay) → 404 ở cả activate lẫn reset."""
    for path in ("/api/vendor/auth/activate", "/api/vendor/auth/reset-password"):
        r = await client.post(
            path, json={"token": "khong-ton-tai-9999", "password": TEST_VENDOR_PW}
        )
        assert r.status_code in (404, 410), f"{path}: {r.text}"


@pytest.mark.integration
async def test_empty_token_rejected(client, db):
    """Token rỗng → 400 (không lọt vào truy vấn WHERE token=NULL)."""
    for path in ("/api/vendor/auth/activate", "/api/vendor/auth/reset-password"):
        r = await client.post(path, json={"token": "", "password": TEST_VENDOR_PW})
        assert r.status_code == 400, f"{path}: {r.text}"
