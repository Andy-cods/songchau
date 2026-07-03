import secrets
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
import bcrypt as _bcrypt
from pydantic import BaseModel

from app.core.config import settings


class TokenData(BaseModel):
    user_id: str
    role: str
    email: str
    jti: str
    # Revoke-token claim (Wave C — Item 5). Default 1 so OLD tokens (minted before
    # this field existed) decode cleanly and compare equal to the DB DEFAULT 1 →
    # nobody is kicked on deploy. Bumped server-side on every password change/reset.
    password_version: int = 1


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt(12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: str, role: str, email: str, password_version: int = 1) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "email": email,
        "type": "access",
        "pv": password_version,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "jti": secrets.token_hex(16),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: str, password_version: int = 1) -> str:
    payload = {
        "sub": user_id,
        "type": "refresh",
        "pv": password_version,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        "jti": secrets.token_hex(32),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
