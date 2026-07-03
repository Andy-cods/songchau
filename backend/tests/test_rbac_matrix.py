"""W1-02 — Ma trận RBAC (route × role) snapshot-based.

Ý TƯỞNG
────────
1. Enumerate MỌI route THỰC của app lúc chạy (app.routes → APIRoute).
2. Đọc quyền KỲ VỌNG từ hai nguồn, đối chiếu nhau + đối chiếu hành vi HTTP:
     • rbac_matrix.yaml  — người khai (snapshot, chống drift).
     • introspection     — đọc thẳng closure của require_role(...) trên từng
                           route (nguồn SỰ THẬT khi chạy) → tự suy allowed_roles
                           + allow_viewer, hoặc nhận diện get_current_user (auth
                           bất kỳ) / resolve_vendor (cổng NCC).
3. PHỦ ĐẦY ĐỦ = introspection (KHÔNG HTTP): mọi route được suy guard + đối chiếu
   yaml (chống drift) + kiểm cấu trúc (giá nội bộ allow_viewer=False, cổng NCC cô
   lập). Đây là nguồn phủ 100% route.
4. CROSS-CHECK = HTTP có LẤY MẪU: chỉ bắn ~vài chục request đại diện (mỗi NHÓM
   guard × role liên quan, KHÔNG phải toàn 8-role × toàn-route) để chứng minh
   introspection khớp runtime. Phân loại đáp ứng thành PASS (đã-qua-cổng-quyền:
   mọi status KHÁC 401/403 — chấp nhận 200/404/422/500 vì ta CHỈ kiểm QUYỀN) /
   401 / 403, rồi so với kỳ vọng. (Cách cũ bắn toàn ma trận ~6000 request in-
   process → >10' timeout; nay ≲ ~80 request, vài giây.)

Vì sao introspection là nguồn sự thật cho HÀNH VI: yaml do người điền có thể
sai/thiếu; còn closure require_role là đúng thứ endpoint thực thi. yaml được
kiểm ở test cross-check (routes đã khai PHẢI khớp introspection) + completeness
(chống drift). Nhờ vậy ma trận hành vi phủ 100% route ngay cả khi yaml mới seed
một phần — orchestrator điền nốt `routes:` sau (hoặc chạy RBAC_MATRIX_DUMP=1 để
tự sinh rbac_matrix.generated.yaml).

Chạy: backend/scripts/run_tests_ci.sh -m integration
"""

from __future__ import annotations

import json
import os
import re
import pathlib

import pytest

# Cần schema đầy đủ (users + role_enum + vendor_accounts): chỉ chạy khi có snapshot.
pytestmark = pytest.mark.integration

TESTS_DIR = pathlib.Path(__file__).resolve().parent
MATRIX_YAML = TESTS_DIR / "rbac_matrix.yaml"

# 8 role THẬT trong role_enum (KHÔNG có 'sales'/'director' — xem open_risks).
ENUM_ROLES = [
    "admin", "manager", "procurement", "warehouse",
    "staff", "accountant", "viewer", "vendor",
]
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Route/prefix hạ tầng KHÔNG phải API nghiệp vụ → bỏ khỏi ma trận.
SKIP_PATH_EXACT = {"/api/openapi.json", "/api/docs", "/api/redoc", "/metrics"}
SKIP_PATH_PREFIX = ("/ws", "/api/docs", "/api/redoc")


# ─────────────────────────── YAML loader (PyYAML optional) ──────────────────
def _strip_comment(s: str) -> str:
    """Bỏ comment '#' ngoài dấu nháy."""
    out, q = [], None
    for ch in s:
        if q:
            out.append(ch)
            if ch == q:
                q = None
        elif ch in ('"', "'"):
            q = ch
            out.append(ch)
        elif ch == "#":
            break
        else:
            out.append(ch)
    return "".join(out)


def _scalar(tok: str):
    tok = tok.strip()
    if not tok:
        return None
    if tok[0] in ("'", '"') and tok[-1] == tok[0]:
        return tok[1:-1]
    low = tok.lower()
    if low in ("true", "false"):
        return low == "true"
    if low in ("null", "~", "none"):
        return None
    try:
        return int(tok)
    except ValueError:
        return tok


def _inline_list(tok: str):
    inner = tok.strip()[1:-1].strip()
    if not inner:
        return []
    return [_scalar(p) for p in inner.split(",") if p.strip()]


def _mini_yaml(text: str) -> dict:
    """Parser con cho ĐÚNG schema rbac_matrix.yaml (indent 0/2/4).

    Đủ dùng khi image test không cài PyYAML. Hỗ trợ: scalar top-level, block list
    (`- item`), block map (routes) với route-key ở indent 2 và scalar/inline-list
    con ở indent 4.
    """
    root: dict = {}
    lines = [l for l in text.split("\n")]
    n = len(lines)
    i = 0

    def indent_of(s: str) -> int:
        return len(s) - len(s.lstrip(" "))

    while i < n:
        raw = _strip_comment(lines[i]).rstrip()
        if not raw.strip():
            i += 1
            continue
        ind = indent_of(raw)
        content = raw.strip()
        key, sep, rest = content.partition(":")
        key = key.strip()
        rest = rest.strip()
        if ind != 0 or not sep:
            i += 1
            continue
        if rest and rest.startswith("["):
            root[key] = _inline_list(rest)
            i += 1
            continue
        if rest:
            root[key] = _scalar(rest)
            i += 1
            continue
        # Block: peek để phân biệt list vs map.
        j = i + 1
        while j < n and not _strip_comment(lines[j]).strip():
            j += 1
        if j >= n:
            root[key] = None
            i = j
            continue
        peek = _strip_comment(lines[j]).strip()
        if peek.startswith("- "):
            items = []
            i = j
            while i < n:
                cur = _strip_comment(lines[i]).rstrip()
                if not cur.strip():
                    i += 1
                    continue
                if indent_of(cur) < 2 or not cur.strip().startswith("- "):
                    break
                items.append(_scalar(cur.strip()[2:]))
                i += 1
            root[key] = items
        else:
            # Map (routes): keys ở indent 2, con ở indent 4.
            mp: dict = {}
            i = j
            cur_key = None
            while i < n:
                cur = _strip_comment(lines[i]).rstrip()
                if not cur.strip():
                    i += 1
                    continue
                ci = indent_of(cur)
                if ci < 2:
                    break
                ck, csep, crest = cur.strip().partition(":")
                ck = _scalar(ck.strip())
                crest = crest.strip()
                if ci == 2:
                    cur_key = ck
                    mp[cur_key] = {}
                elif ci >= 4 and cur_key is not None:
                    if crest.startswith("["):
                        mp[cur_key][ck] = _inline_list(crest)
                    else:
                        mp[cur_key][ck] = _scalar(crest)
                i += 1
            root[key] = mp
    return root


def _load_matrix() -> dict:
    text = MATRIX_YAML.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore
        return yaml.safe_load(text) or {}
    except Exception:
        return _mini_yaml(text)


MATRIX = _load_matrix()
NO_AUTH = set(MATRIX.get("no_auth") or [])
VENDOR_PREFIXES = tuple(MATRIX.get("vendor_prefixes") or ["/api/vendor"])
VIEWER_DENY_PREFIXES = tuple(MATRIX.get("viewer_deny_prefixes") or [])
DECLARED_ROUTES = MATRIX.get("routes") or {}
STRICT_DRIFT = bool(MATRIX.get("strict_drift"))


# ─────────────────────────── route enumeration ─────────────────────────────
def _iter_routes():
    """(method, path, guard) cho mọi APIRoute nghiệp vụ. Import app 1 lần."""
    from fastapi.routing import APIRoute
    from app.main import app

    seen = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        path = route.path
        if path in SKIP_PATH_EXACT or path.startswith(SKIP_PATH_PREFIX):
            continue
        guard = _extract_guard(route)
        for method in sorted(route.methods or []):
            if method in ("HEAD", "OPTIONS"):
                continue
            seen.append((method, path, guard))
    return seen


def _extract_guard(route) -> dict:
    """Đọc cấu hình bảo vệ THỰC của route từ cây dependency.

    Trả {kind, roles:set, allow_viewer:bool}:
      kind='role'   → require_role(*roles, allow_viewer=...)
      kind='vendor' → resolve_vendor (cổng NCC)
      kind='any'    → chỉ get_current_user (mọi user đăng nhập qua được)
      kind='none'   → không có dep auth (public)
    """
    found = {"kind": "none", "roles": set(), "allow_viewer": True}

    def walk(dep, depth=0):
        if dep is None or depth > 8:
            return
        call = getattr(dep, "call", None)
        if call is not None:
            name = getattr(call, "__name__", "") or ""
            qual = getattr(call, "__qualname__", "") or ""
            if name == "_check" and "require_role" in qual:
                cvars = {}
                free = call.__code__.co_freevars
                closure = call.__closure__ or ()
                for fname, cell in zip(free, closure):
                    try:
                        cvars[fname] = cell.cell_contents
                    except ValueError:
                        pass
                found["kind"] = "role"
                found["roles"] = set(cvars.get("allowed_roles", ()) or ())
                found["allow_viewer"] = bool(cvars.get("allow_viewer", True))
            elif name == "resolve_vendor":
                found["kind"] = "vendor"
            elif name == "get_current_user" and found["kind"] == "none":
                found["kind"] = "any"
        for sub in getattr(dep, "dependencies", None) or []:
            walk(sub, depth + 1)

    walk(getattr(route, "dependant", None))
    return found


ROUTES = _iter_routes()
# Cho phép giới hạn nhanh khi debug: RBAC_MATRIX_MAX=50 → chỉ 50 route đầu.
_MAX = os.environ.get("RBAC_MATRIX_MAX")
if _MAX and _MAX.isdigit():
    ROUTES = ROUTES[: int(_MAX)]


# ─────────────────────────── expected-behavior model ───────────────────────
def _expected(method: str, path: str, guard: dict, role):
    """Trả ('pass' | '401' | '403') cho (route, role|None). role=None = no-token."""
    key = f"{method} {path}"
    is_vendor_path = path.startswith(VENDOR_PREFIXES)

    # 1) Whitelist không cần token.
    if key in NO_AUTH:
        return "pass"

    # 2) Cổng NCC.
    if is_vendor_path or guard["kind"] == "vendor":
        if role is None:
            return "401"
        return "pass" if role == "vendor" else "403"

    # 3) /api/v1 — public (không dep auth): mọi phía qua được, kể cả no-token.
    if guard["kind"] in ("none", "any"):
        # 'any' = chỉ get_current_user → cần token; no-token ⇒ 401.
        if guard["kind"] == "any" and role is None:
            return "401"
        return "pass"

    # 4) kind == 'role'
    if role is None:
        return "401"
    if role == "viewer":
        # Cơ chế viewer-read-only-toàn-hệ: GET/HEAD qua khi allow_viewer=True.
        if guard["allow_viewer"] and method in SAFE_METHODS:
            return "pass"
        return "403"
    if role == "vendor":
        return "pass" if "vendor" in guard["roles"] else "403"
    return "pass" if role in guard["roles"] else "403"


def _sub_path(path: str) -> str:
    """Thay {param} bằng '1' để gọi được (ta chỉ kiểm QUYỀN, 404/422 = đã-qua-cổng)."""
    return re.sub(r"\{[^}]+\}", "1", path)


def _classify(status_code: int) -> str:
    if status_code == 401:
        return "401"
    if status_code == 403:
        return "403"
    return "pass"


# ─────────────────────────── fixtures ──────────────────────────────────────
@pytest.fixture(autouse=True)
def _disable_rate_limit():
    """Tắt slowapi (default 200/min per-key) — ma trận bắn hàng nghìn request
    cùng key sẽ dính 429 giả nếu không tắt."""
    try:
        from app.core.slowapi_limiter import limiter
        prev = getattr(limiter, "enabled", True)
        limiter.enabled = False
        yield
        limiter.enabled = prev
    except Exception:
        yield


@pytest.fixture
async def role_tokens(users_factory, db):
    """Headers cho 8 role thật. Vendor được cấp vendor_accounts active để
    resolve_vendor qua cổng NCC (users_factory chỉ tạo hàng users)."""
    out = {}
    for r in ENUM_ROLES:
        out[r] = await users_factory(r)
    # Seed 1 vendor_accounts active cho user vendor (id bigint không default →
    # tự cấp id; tx rollback nên an toàn).
    vinfo = out["vendor"]
    try:
        await db.execute(
            """
            INSERT INTO vendor_accounts (id, user_id, company_name, contact_name,
                                         is_approved, status)
            VALUES (COALESCE((SELECT MAX(id) FROM vendor_accounts), 0) + 1,
                    $1, 'RBAC Test Co', 'RBAC Tester', true, 'active')
            """,
            vinfo["id"],
        )
    except Exception:
        # status enum có thể khác → thử không set status (mặc định pending) +
        # is_approved=true đã đủ để resolve_vendor chấp nhận.
        await db.execute(
            """
            INSERT INTO vendor_accounts (id, user_id, company_name, contact_name,
                                         is_approved)
            VALUES (COALESCE((SELECT MAX(id) FROM vendor_accounts), 0) + 1,
                    $1, 'RBAC Test Co', 'RBAC Tester', true)
            """,
            vinfo["id"],
        )
    return out


def _ok(expected: str, got: str) -> bool:
    """'pass' kỳ vọng khớp mọi status không-401/403; '401'/'403' phải khớp đúng."""
    if expected == "pass":
        return got == "pass"
    return got == expected


# ═══════════════════════════════════════════════════════════════════════════
# PHẦN 1 — PHỦ ĐẦY ĐỦ qua INTROSPECTION (KHÔNG HTTP, 0 request, mili-giây).
#   introspection require_role là NGUỒN SỰ THẬT: nó suy guard cho 100% route
#   nên không cần bắn HTTP để phủ. Các test dưới đây đối chiếu guard-suy-luận với
#   yaml (chống drift) + kiểm bất biến cấu trúc. HTTP (Phần 2) chỉ CROSS-CHECK.
# ═══════════════════════════════════════════════════════════════════════════
def test_guard_structure_invariants():
    """Bất biến CẤU TRÚC trên MỌI route (suy từ introspection, KHÔNG HTTP):

      * Cổng NCC (prefix /api/vendor) ⇒ guard 'vendor' (resolve_vendor) HOẶC nằm
        trong NO_AUTH / là route */auth/* (đăng nhập NCC). KHÔNG được rơi vào
        'any'/'none'/'role' của /api/v1 — nếu không là LỖ cô lập tenant.
      * Có ÍT NHẤT một route require_role allow_viewer=False (khoá W0-21 'giá nội
        bộ' còn tồn tại) và mọi route như vậy đều nằm dưới prefix đã khai
        (viewer_deny_prefixes) — bắt drift khi thêm endpoint giá mà quên khai.
      * _expected trả giá trị hợp lệ ('pass'/'401'/'403') cho mọi (route, role).
    """
    bad: list[str] = []
    deny_routes = 0
    for method, path, guard in ROUTES:
        key = f"{method} {path}"

        # (a) cô lập cổng NCC
        if path.startswith(VENDOR_PREFIXES):
            if guard["kind"] != "vendor" and key not in NO_AUTH and "/auth/" not in path:
                bad.append(
                    f"{key}: route cổng NCC nhưng guard={guard['kind']} "
                    f"(cần 'vendor' hoặc whitelist đăng-nhập) — nghi LỖ cô lập"
                )

        # (b) giá nội bộ: allow_viewer=False PHẢI nằm dưới prefix đã khai
        if guard["kind"] == "role" and not guard["allow_viewer"]:
            deny_routes += 1
            if VIEWER_DENY_PREFIXES and not path.startswith(VIEWER_DENY_PREFIXES):
                bad.append(
                    f"{key}: allow_viewer=False nhưng KHÔNG thuộc "
                    f"viewer_deny_prefixes — khai bổ sung vào rbac_matrix.yaml"
                )

        # (c) model quyết định được cho mọi role
        for role in (None, "viewer", "vendor", "admin"):
            exp = _expected(method, path, guard, role)
            if exp not in ("pass", "401", "403"):
                bad.append(f"{key}: _expected(role={role}) trả '{exp}' (bất hợp lệ)")

    assert not bad, "Sai bất biến cấu trúc guard:\n  " + "\n  ".join(bad)
    assert deny_routes > 0, (
        "Không thấy route allow_viewer=False nào — kỳ vọng có (price-analytics/"
        "analytics/price-lookup/market-prices). Kiểm introspection require_role."
    )


# ═══════════════════════════════════════════════════════════════════════════
# PHẦN 2 — CROSS-CHECK HTTP có LẤY MẪU (sampled).
#   introspection (Phần 1) đã là nguồn phủ đầy đủ; HTTP chỉ để CHỨNG MINH nó
#   khớp runtime. Vì thế ta bắn MẪU ĐẠI DIỆN: mỗi NHÓM guard vài route × role
#   LIÊN QUAN (không phải toàn 8-role × toàn-route). Ngân sách ≲ ~80 request.
# ═══════════════════════════════════════════════════════════════════════════
SAMPLE_PER_BUCKET = int(os.environ.get("RBAC_SAMPLE_PER_BUCKET") or 4)


def _bucket_routes() -> dict:
    """Chia route theo NHÓM guard để lấy mẫu:

      public      : no-token qua được (NO_AUTH hoặc không dep auth, không NCC)
      any         : cần đăng-nhập-bất-kỳ (get_current_user)
      vendor      : cổng NCC (resolve_vendor / prefix /api/vendor)
      role_get    : require_role, method AN TOÀN, allow_viewer=True
      role_write  : require_role, method GHI      → invariant 'viewer chỉ GET'
      viewer_deny : require_role, allow_viewer=False (giá nội bộ) → khoá W0-21
    """
    b = {k: [] for k in
         ("public", "any", "vendor", "role_get", "role_write", "viewer_deny")}
    for method, path, guard in ROUTES:
        key = f"{method} {path}"
        is_vendor = path.startswith(VENDOR_PREFIXES) or guard["kind"] == "vendor"
        if key in NO_AUTH:
            b["public"].append((method, path, guard))
        elif is_vendor:
            b["vendor"].append((method, path, guard))
        elif guard["kind"] == "none":
            b["public"].append((method, path, guard))
        elif guard["kind"] == "any":
            b["any"].append((method, path, guard))
        elif guard["kind"] == "role":
            if not guard["allow_viewer"] and method in SAFE_METHODS:
                b["viewer_deny"].append((method, path, guard))
            elif method in SAFE_METHODS:
                b["role_get"].append((method, path, guard))
            else:
                b["role_write"].append((method, path, guard))
    return b


def _sample(routes: list, safe_first: bool = False) -> list:
    """Tối đa SAMPLE_PER_BUCKET route ĐẦU (thứ tự ổn định) của một nhóm."""
    if safe_first:
        key = lambda r: (r[0] not in SAFE_METHODS, r[1], r[0])  # noqa: E731
    else:
        key = lambda r: (r[1], r[0])                            # noqa: E731
    return sorted(routes, key=key)[:SAMPLE_PER_BUCKET]


def _an_allowed_role(guard: dict):
    """Một role THẬT (enum) được phép — ưu tiên không phải viewer/vendor."""
    plain = [r for r in ENUM_ROLES
             if r in guard["roles"] and r not in ("viewer", "vendor")]
    if plain:
        return plain[0]
    any_in = [r for r in ENUM_ROLES if r in guard["roles"]]
    return any_in[0] if any_in else None


def _a_denied_role(guard: dict):
    """Một role THẬT (không viewer/vendor) KHÔNG được phép ⇒ kỳ vọng 403."""
    for r in ENUM_ROLES:
        if r not in guard["roles"] and r not in ("viewer", "vendor"):
            return r
    return None


def _probe_roles(bucket: str, guard: dict) -> list:
    """Role (None = no-token) CẦN bắn cho 1 route mẫu — CHỈ role liên quan để
    chứng minh từng nhánh pass/401/403, KHÔNG bắn đủ 8 role."""
    if bucket == "public":
        return [None]                       # no-token vẫn qua
    if bucket == "any":
        return [None, "admin"]              # thiếu token ⇒ 401; role bất kỳ ⇒ pass
    if bucket == "vendor":
        # 401 (thiếu token) / pass (vendor) / 403 (gate NCC chặn non-vendor)
        return [None, "vendor", "admin"]
    roles = [None]                          # INVARIANT 1: no-token ⇒ 401
    denied, allowed = _a_denied_role(guard), _an_allowed_role(guard)
    if bucket == "role_get":
        roles.append("viewer")             # allow_viewer + GET ⇒ pass
        if denied:
            roles.append(denied)           # ngoài set ⇒ 403
        roles.append("vendor")             # INVARIANT 4: vendor cô lập ⇒ 403
    elif bucket == "role_write":
        roles.append("viewer")             # INVARIANT 2: viewer KHÔNG ghi ⇒ 403
        roles.append("vendor")             # INVARIANT 4
    elif bucket == "viewer_deny":
        roles.append("viewer")             # INVARIANT 3 (W0-21): giá nội bộ ⇒ 403
    if allowed and allowed not in roles:
        roles.append(allowed)              # role hợp lệ ⇒ pass
    out = []
    for r in roles:                        # unique, giữ thứ tự
        if r not in out:
            out.append(r)
    return out


async def test_rbac_sampled_http_crosscheck(client, role_tokens):
    """CROSS-CHECK có LẤY MẪU: introspection require_role KHỚP hành vi HTTP
    runtime trên route ĐẠI DIỆN mỗi nhóm guard × role liên quan.

    KHÔNG quét toàn bộ — Phần 1 (introspection) đã phủ 100% route; đây là bằng
    chứng chéo. Gói gọn 4 INVARIANT CỐT LÕI qua các probe:
      1) no-token ⇒ 401 trên route có cổng quyền (role/any/vendor).
      2) viewer chỉ GET — method ghi ⇒ 403.
      3) viewer bị chặn endpoint 'giá nội bộ' (allow_viewer=False) = khoá W0-21.
      4) vendor KHÔNG chạm require_role của /api/v1 ⇒ 403.
    """
    buckets = _bucket_routes()
    # Nhóm invariant PHẢI có route — nếu rỗng, test 'xanh giả'. Bắt sớm.
    assert buckets["viewer_deny"], (
        "Không mẫu được route allow_viewer=False (giá nội bộ) — kiểm introspection."
    )
    assert buckets["vendor"], "Không mẫu được route cổng NCC — kiểm app.routes."
    assert buckets["role_write"] or buckets["role_get"], (
        "Không mẫu được route require_role nào — kiểm app.routes."
    )

    failures: list[str] = []
    n_req = n_routes = 0
    for bucket, routes in buckets.items():
        for method, path, guard in _sample(routes, safe_first=(bucket == "public")):
            n_routes += 1
            url = _sub_path(path)
            call = getattr(client, method.lower())
            for role in _probe_roles(bucket, guard):
                headers = role_tokens[role]["headers"] if role else None
                r = await call(url, headers=headers)
                n_req += 1
                exp = _expected(method, path, guard, role)
                got = _classify(r.status_code)
                if not _ok(exp, got):
                    failures.append(
                        f"[{bucket}] {method} {path} role={role or 'no-token'}: "
                        f"kỳ vọng {exp}, nhận {got} ({r.status_code})"
                    )

    # In ngân sách request để orchestrator theo dõi (hiện khi -s hoặc khi fail).
    print(
        f"[rbac] sampled cross-check: {n_req} HTTP request / {n_routes} route mẫu "
        f"(SAMPLE_PER_BUCKET={SAMPLE_PER_BUCKET})"
    )
    assert not failures, (
        f"introspection ↔ runtime LỆCH ({n_req} request / {n_routes} route mẫu):\n  "
        + "\n  ".join(failures)
    )


# ─────────────────────────── yaml cross-check + drift ───────────────────────
def _covered_by_yaml(method: str, path: str) -> bool:
    key = f"{method} {path}"
    return (
        key in NO_AUTH
        or key in DECLARED_ROUTES
        or path.startswith(VENDOR_PREFIXES)
    )


def test_declared_roles_match_code():
    """Route đã khai `roles:` trong yaml PHẢI khớp require_role thực tế (bắt
    trường hợp sửa code mà quên cập nhật ma trận)."""
    guard_by_key = {f"{m} {p}": g for (m, p, g) in ROUTES}
    bad = []
    for key, spec in DECLARED_ROUTES.items():
        if not isinstance(spec, dict) or spec.get("roles") is None:
            continue
        g = guard_by_key.get(key)
        if g is None:
            bad.append(f"{key}: khai trong yaml nhưng route không tồn tại")
            continue
        if g["kind"] != "role":
            bad.append(f"{key}: yaml khai roles nhưng code kind={g['kind']}")
            continue
        declared = set(spec["roles"])
        if declared != g["roles"]:
            bad.append(
                f"{key}: yaml={sorted(declared)} != code={sorted(g['roles'])}"
            )
    assert not bad, "Sai lệch yaml↔code:\n  " + "\n  ".join(bad)


def test_route_coverage_no_drift():
    """Chống drift: route trong app.routes mà chưa khai ở yaml.

    strict_drift=false → chỉ CẢNH BÁO (skip) + gợi ý chạy RBAC_MATRIX_DUMP=1.
    strict_drift=true  → FAIL 'route mới chưa khai báo quyền'.
    """
    undeclared = sorted(
        f"{m} {p}" for (m, p, _g) in ROUTES if not _covered_by_yaml(m, p)
    )
    if not undeclared:
        return
    hint = (
        f"{len(undeclared)} route chưa khai trong rbac_matrix.yaml. "
        f"Chạy RBAC_MATRIX_DUMP=1 để tự sinh rbac_matrix.generated.yaml rồi dán "
        f"vào `routes:`. Ví dụ (10 đầu):\n  " + "\n  ".join(undeclared[:10])
    )
    if STRICT_DRIFT:
        pytest.fail("route mới chưa khai báo quyền — " + hint)
    pytest.skip(hint)


def test_dump_generated_matrix():
    """RBAC_MATRIX_DUMP=1 → ghi ma trận introspect được ra file để review/merge.

    Không bật env → skip. File sinh dạng JSON (không phụ thuộc PyYAML) nhưng
    map thẳng sang cấu trúc `routes:` của yaml."""
    if os.environ.get("RBAC_MATRIX_DUMP") != "1":
        pytest.skip("đặt RBAC_MATRIX_DUMP=1 để sinh rbac_matrix.generated.json")
    gen = {}
    for method, path, guard in ROUTES:
        entry = {"auth": guard["kind"]}
        if guard["kind"] == "role":
            entry["roles"] = sorted(guard["roles"])
            if not guard["allow_viewer"]:
                entry["viewer_deny"] = True
        entry["status"] = "todo"
        gen[f"{method} {path}"] = entry
    out = TESTS_DIR / "rbac_matrix.generated.json"
    out.write_text(json.dumps(gen, ensure_ascii=False, indent=2), encoding="utf-8")
    assert out.exists() and gen
