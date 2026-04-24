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
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")


def require_role(*allowed_roles: str):
    async def _check(
        request: Request,
        token_data: TokenData = Depends(get_current_user),
        conn: asyncpg.Connection = Depends(get_db),
    ) -> TokenData:
        if token_data.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "INSUFFICIENT_PERMISSIONS",
                    "message": f"Role '{token_data.role}' không có quyền thực hiện thao tác này",
                    "required_roles": list(allowed_roles),
                },
            )

        # Inject RLS context
        await conn.execute(
            "SELECT set_config('app.current_user_id', $1, true),"
            "       set_config('app.current_role', $2, true),"
            "       set_config('app.current_user_email', $3, true),"
            "       set_config('app.client_ip', $4, true)",
            token_data.user_id,
            token_data.role,
            token_data.email,
            request.client.host or "unknown",
        )
        return token_data

    return _check
