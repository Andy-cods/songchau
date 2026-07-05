from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from typing import Optional
import asyncpg

from app.core.security import decode_token, TokenData
from app.core.database import get_db

security_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
) -> TokenData:
    """Extract token from Authorization header OR ?token= query param."""
    raw_token = None
    if credentials:
        raw_token = credentials.credentials
    else:
        # Fallback: read token from query param (for <a href>, <iframe>, direct browser links)
        raw_token = request.query_params.get("token")

    if not raw_token:
        raise HTTPException(status_code=401, detail="Token missing")

    try:
        payload = decode_token(raw_token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return TokenData(
            user_id=payload["sub"],
            role=payload["role"],
            email=payload["email"],
            jti=payload["jti"],
            # Revoke-token claim. OLD tokens lack 'pv' → defaults to 1 (== DB DEFAULT 1)
            # so they are NOT kicked on deploy. The actual revoke comparison happens at
            # the conn-bearing chokepoints (require_role / resolve_vendor / refresh).
            password_version=int(payload.get("pv", 1)),
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")


def require_role(*allowed_roles: str, allow_viewer: bool = True):
    """Guard endpoint theo role.

    allow_viewer (Thang 2026-07-02): mặc định True = giữ cơ chế viewer read-only
    toàn hệ (viewer GET được mọi endpoint). Đặt allow_viewer=False cho các endpoint
    NHẠY CẢM (giá nội bộ: giá mình chào / giá vốn / margin) để CHẶN cả viewer —
    khi đó viewer bị xử như role thường (không nằm trong allowed_roles → 403).
    """
    async def _check(
        request: Request,
        token_data: TokenData = Depends(get_current_user),
        conn: asyncpg.Connection = Depends(get_db),
    ) -> TokenData:
        # Viewer role (Thang 2026-05-20): READ-ONLY across the whole system.
        # Bypasses per-endpoint role list — viewer can hit ANY endpoint, but
        # only via safe HTTP methods (GET/HEAD/OPTIONS). Any mutation method
        # is rejected with 403 regardless of which roles the endpoint allows.
        # NGOẠI LỆ: allow_viewer=False → KHÔNG bypass (giá nội bộ), viewer rơi
        # xuống nhánh elif và bị 403 vì 'viewer' không nằm trong allowed_roles.
        if token_data.role == "viewer" and allow_viewer:
            if request.method.upper() not in ("GET", "HEAD", "OPTIONS"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "error": "VIEWER_READ_ONLY",
                        "message": "Tài khoản xem (viewer) chỉ được phép xem dữ liệu — không sửa/xoá/tạo.",
                    },
                )
            # GET → allowed. Skip the allowed_roles check + proceed to RLS inject.
        elif token_data.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "INSUFFICIENT_PERMISSIONS",
                    "message": f"Role '{token_data.role}' không có quyền thực hiện thao tác này",
                    "required_roles": list(allowed_roles),
                },
            )

        # Revoke-token chokepoint (Wave C — Item 5) for ALL /api/v1/* admin/staff/viewer
        # traffic. Compare the token's password_version against the live DB value; a
        # password change/reset bumps the DB value so every old JWT 401s here.
        # OLD token pv defaults to 1 == DB DEFAULT 1 → not kicked on deploy.
        pv_row = await conn.fetchval(
            "SELECT password_version FROM users WHERE id = $1", token_data.user_id
        )
        if pv_row is not None and int(pv_row) != int(token_data.password_version):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "error": "TOKEN_REVOKED",
                    "message": "Phiên đã hết hiệu lực do đổi mật khẩu — vui lòng đăng nhập lại",
                },
            )

        # Inject RLS/audit context.
        # is_local=false (session-scope) — KHÔNG dùng true: asyncpg auto-commit
        # từng execute() → GUC set is_local=true bốc hơi ngay cuối implicit-txn
        # của chính nó, nên khi endpoint query (statement sau) thì rỗng → RLS policy
        # rỗng + auto_audit_log() ghi user_id=NULL. false giữ GUC suốt vòng đời
        # connection của request; an toàn với pool vì asyncpg RESET ALL khi release.
        # Tên khóa role = 'app.current_user_role' cho KHỚP policy sống (init_v3.sql
        # / _schema_snapshot.sql). Trước đây đặt 'app.current_role' (sai) → nhánh
        # role của mọi RLS policy luôn NULL.
        await conn.execute(
            "SELECT set_config('app.current_user_id', $1, false),"
            "       set_config('app.current_user_role', $2, false),"
            "       set_config('app.current_user_email', $3, false),"
            "       set_config('app.client_ip', $4, false)",
            token_data.user_id,
            token_data.role,
            token_data.email,
            request.client.host or "unknown",
        )
        return token_data

    return _check
