"""Pytest harness for Song Châu ERP — CI-safe, NO live server required.

W1-01 (Đợt 1). This is the foundation every Đợt-1 test builds on. It replaces
the old conftest that POSTed to a live http://localhost:8000 and pytest.skip()'d
when it was unreachable (a "safe fake" — green because nothing ran).

How it works now
────────────────
  * Postgres + Redis come from docker-compose.test.yml on non-prod ports
    (55432 / 56379). scripts/run_tests.sh brings them up before pytest.
  * The FastAPI app is exercised IN-PROCESS via httpx.ASGITransport — no
    uvicorn, no network, no lifespan. `get_db` is dependency-overridden to a
    per-test transaction that is ROLLED BACK after each test (full isolation).
  * JWTs are minted directly with app.core.security.create_access_token using
    the SAME settings.JWT_SECRET_KEY the app decodes with, so every role gets a
    genuinely valid token without going through /auth/login.

Schema strategy (see `schema_info` fixture): prefer a full prod snapshot at
tests/_schema_snapshot.sql (pg_dump --schema-only); else fall back to the
minimal tests/_bootstrap_schema.sql (users + role_enum) which is enough for the
smoke suite and all auth/RBAC tests.

Fixtures exported
─────────────────
  event_loop            session-scoped loop (lets session async fixtures run)
  schema_info           {"full_schema": bool, "source": str}  (session)
  db                    per-test asyncpg conn inside a rolled-back transaction
  client                httpx.AsyncClient bound to the app (get_db -> db)
  users_factory         async factory: await users_factory("manager") -> dict
  admin / manager / staff / accountant / sales / viewer / vendor
                        convenience per-role seeded user dicts (id, token,
                        headers, ...). Seeded inside the test's tx.
"""

from __future__ import annotations

import os

# ─── 1. Environment MUST be set BEFORE importing app (settings is a singleton
#        instantiated at import time in app.core.config). setdefault so a caller
#        / run_tests.sh can override any of these from the outside. ───────────
os.environ.setdefault("JWT_SECRET_KEY", "test-harness-jwt-secret-not-for-prod")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("COOKIE_SECURE", "False")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "60")
# DB the harness talks to (matches docker-compose.test.yml). run_tests.sh
# exports the same value.
os.environ.setdefault(
    "TEST_DATABASE_URL", "postgresql://sc_test:sc_test@127.0.0.1:55432/sc_test"
)
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:56379/0")
# Placeholders so pydantic Settings() validates; DB access goes through the
# get_db OVERRIDE (our own pool), so these host values are never dialed.
os.environ.setdefault("POSTGRES_DB", "sc_test")
os.environ.setdefault("POSTGRES_USER", "sc_test")
os.environ.setdefault("POSTGRES_PASSWORD", "sc_test")

import pathlib
import asyncio

import asyncpg
import httpx
import pytest
import pytest_asyncio

TESTS_DIR = pathlib.Path(__file__).resolve().parent
SNAPSHOT_SQL = TESTS_DIR / "_schema_snapshot.sql"
BOOTSTRAP_SQL = TESTS_DIR / "_bootstrap_schema.sql"

TEST_DSN = os.environ["TEST_DATABASE_URL"]

# Roles that actually exist in the DB role_enum (init_v3 + add_viewer_role +
# vendor_portal_001). 'sales'/'director' are referenced by app code but were
# NEVER added to the enum, so a users.role can't hold them — for those we store
# a valid placeholder role in the row but mint the token with the REAL role.
_ENUM_ROLES = {
    "admin", "manager", "procurement", "warehouse",
    "staff", "accountant", "viewer", "vendor",
}

# Shared test password for seeded users. Hashed once per session (bcrypt cost 12
# is ~250ms — hashing per row would dominate runtime).
TEST_PASSWORD = "Test@1234"


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers", "smoke: harness self-proof (in-process ASGI + bootstrap schema)"
    )
    config.addinivalue_line(
        "markers", "unit: pure-function tests, no DB / no network"
    )
    config.addinivalue_line(
        "markers",
        "integration: in-process API tests requiring the full prod schema "
        "snapshot (tests/_schema_snapshot.sql); auto-skipped otherwise",
    )


def pytest_collection_modifyitems(config: pytest.Config, items) -> None:
    """Auto-apply markers by location so the default `-m "smoke or unit"`
    selection actually picks up the pre-existing tests (which carry no explicit
    marker). Never overrides a marker a test already declares.

    Mapping:
        tests/unit/**                       -> unit
        tests/integration/**                -> integration
        tests/e2e/**                        -> e2e
        tests/test_sourcing_pricing_engine  -> unit  (pure arithmetic, DB mocked)
        tests/test_quote_pdf_viewer_*       -> e2e   (needs live ERP_BASE_URL)
    """
    for item in items:
        path = str(getattr(item, "fspath", "")).replace("\\", "/")
        existing = {m.name for m in item.iter_markers()}
        def add(name: str) -> None:
            if name not in existing:
                item.add_marker(getattr(pytest.mark, name))
        if "/tests/unit/" in path:
            add("unit")
        elif "/tests/integration/" in path:
            add("integration")
        elif "/tests/e2e/" in path:
            add("e2e")
        elif "test_sourcing_pricing_engine" in path:
            add("unit")
        elif "test_quote_pdf_viewer" in path:
            add("e2e")


# ─── schema load ─────────────────────────────────────────────────────────────
# Function-scoped (KHÔNG session) + KHÔNG tự định nghĩa event_loop: để
# pytest-asyncio quản lý 1 loop/test cho MỌI fixture+test+app → tránh lỗi asyncpg
# "attached to a different loop" (conn tạo ở loop này, request chạy loop khác).
# Khi SCHEMA_PRELOADED=1 (schema đã nạp bằng psql ngoài) fixture là no-op rẻ.
@pytest_asyncio.fixture
async def schema_info() -> dict:
    """Reset schema `public` on the test DB and load the schema-of-record.

    Returns {"full_schema": bool, "source": filename}. full_schema is True only
    when the prod snapshot was used; integration tests key off this to skip.
    """
    if os.environ.get("SCHEMA_PRELOADED") == "1":
        # Schema đã được nạp sẵn bằng psql (xử lý pg_dump chuẩn: search_path,
        # extension, lệnh backslash) — chỉ verify kết nối, KHÔNG drop/reload.
        conn = await asyncpg.connect(TEST_DSN)
        await conn.close()
        return {"full_schema": True, "source": "preloaded-psql"}
    source = SNAPSHOT_SQL if SNAPSHOT_SQL.exists() else BOOTSTRAP_SQL
    if not source.exists():  # pragma: no cover - misconfig guard
        raise RuntimeError(
            f"No schema file found. Expected {SNAPSHOT_SQL.name} or "
            f"{BOOTSTRAP_SQL.name} in {TESTS_DIR}."
        )
    sql = source.read_text(encoding="utf-8")
    # pg_dump 16 chèn dòng lệnh psql-only ("\restrict"/"\unrestrict") mà asyncpg
    # (không phải psql) KHÔNG parse được → lọc bỏ mọi dòng bắt đầu bằng "\".
    sql = "\n".join(
        line for line in sql.splitlines() if not line.lstrip().startswith("\\")
    )

    try:
        conn = await asyncpg.connect(TEST_DSN)
    except Exception as exc:  # pragma: no cover - surfaces a clear message
        raise RuntimeError(
            f"Cannot reach the test database at {TEST_DSN}. Did you start it? "
            f"`docker compose -f docker-compose.test.yml up -d --wait` "
            f"(or use scripts/run_tests.sh). Underlying error: {exc}"
        ) from exc
    try:
        # Clean slate every session — makes both the (non-idempotent) pg_dump
        # snapshot AND the bootstrap file reloadable, even under `--keep`.
        await conn.execute("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
        await conn.execute(sql)
    finally:
        await conn.close()

    return {"full_schema": source is SNAPSHOT_SQL, "source": source.name}


# ─── per-test connection wrapped in a rolled-back transaction ───────────────
@pytest_asyncio.fixture
async def db(schema_info):
    """A single asyncpg connection inside a transaction that is ALWAYS rolled
    back, so every test sees a pristine DB regardless of what it (or the app
    handler) wrote. The app uses this same connection via the get_db override,
    so writes made through the API are rolled back too.
    """
    conn = await asyncpg.connect(TEST_DSN)
    tx = conn.transaction()
    await tx.start()
    try:
        yield conn
    finally:
        try:
            await tx.rollback()
        finally:
            await conn.close()


# ─── in-process API client (no uvicorn, no lifespan) ────────────────────────
@pytest_asyncio.fixture
async def client(db):
    """httpx.AsyncClient talking straight to the ASGI app.

    get_db is overridden to yield the per-test transactional `db` connection, so
    the request handler and the test share one transaction (seeded rows are
    visible; everything rolls back afterwards). ASGITransport does NOT run the
    app lifespan, so db_pool/cache/procrastinate are never initialized — that's
    intentional; nothing here needs them (health tolerates a down Redis).
    """
    from app.main import app
    from app.core.database import get_db

    async def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    # raise_app_exceptions=False -> an unhandled handler error becomes a real
    # 500 RESPONSE (like a live server) instead of propagating into the test.
    transport = httpx.ASGITransport(
        app=app, raise_app_exceptions=os.environ.get("HARNESS_RAISE") == "1"
    )
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)


# ─── user + token seeding ───────────────────────────────────────────────────
@pytest.fixture(scope="session")
def _pw_hash() -> str:
    from app.core.security import hash_password
    return hash_password(TEST_PASSWORD)


@pytest_asyncio.fixture
async def users_factory(db, _pw_hash):
    """Return an async factory that seeds a user + mints a valid JWT.

        rec = await users_factory("manager")
        await client.get("/api/v1/...", headers=rec["headers"])

    The row's stored role is enum-valid; the TOKEN carries the requested role
    (they differ only for 'sales'/'director', which are not in role_enum).
    Pass password=<plain> to seed a login-testable credential (its hash is
    computed on demand); omit it to reuse the shared session hash.
    """
    from app.core.security import create_access_token, hash_password

    seq = {"n": 0}

    async def _make(role: str, *, email: str | None = None,
                    is_active: bool = True, password: str | None = None):
        seq["n"] += 1
        db_role = role if role in _ENUM_ROLES else "staff"
        if email is None:
            email = f"{role}{seq['n']}@test.songchau.vn"
        pw_hash = hash_password(password) if password is not None else _pw_hash
        row = await db.fetchrow(
            """
            INSERT INTO users (email, full_name, display_name, role,
                               hashed_password, is_active, password_version)
            VALUES ($1, $2, $3, $4::role_enum, $5, $6, 1)
            RETURNING id, password_version
            """,
            email, f"Test {role}", f"{role.title()} T",
            db_role, pw_hash, is_active,
        )
        uid = str(row["id"])
        token = create_access_token(
            user_id=uid, role=role, email=email,
            password_version=row["password_version"],
        )
        return {
            "id": uid,
            "email": email,
            "role": role,          # role as carried by the token
            "db_role": db_role,    # role actually stored in users.role
            "password": password or TEST_PASSWORD,
            "token": token,
            "headers": {"Authorization": f"Bearer {token}"},
        }

    return _make


# One convenience fixture per requested role. All are function-scoped and seed
# into the test's rolled-back transaction, so they never leak between tests.
# Each yields the dict returned by users_factory (id, email, role, token,
# headers, ...). 'sales' carries role='sales' in the token but is stored as
# 'staff' in users.role (role_enum has no 'sales' — see conftest _ENUM_ROLES).
@pytest_asyncio.fixture
async def admin(users_factory):
    return await users_factory("admin")


@pytest_asyncio.fixture
async def manager(users_factory):
    return await users_factory("manager")


@pytest_asyncio.fixture
async def staff(users_factory):
    return await users_factory("staff")


@pytest_asyncio.fixture
async def accountant(users_factory):
    return await users_factory("accountant")


@pytest_asyncio.fixture
async def sales(users_factory):
    return await users_factory("sales")


@pytest_asyncio.fixture
async def viewer(users_factory):
    return await users_factory("viewer")


@pytest_asyncio.fixture
async def vendor(users_factory):
    return await users_factory("vendor")
