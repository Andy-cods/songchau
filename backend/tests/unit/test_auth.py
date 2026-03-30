"""Unit tests for authentication module."""
import pytest
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token


def test_hash_password():
    hashed = hash_password("TestPass123")
    assert hashed.startswith("$2b$12$")
    assert len(hashed) == 60


def test_verify_password_correct():
    hashed = hash_password("SongChau@2026")
    assert verify_password("SongChau@2026", hashed) is True


def test_verify_password_wrong():
    hashed = hash_password("correct")
    assert verify_password("wrong", hashed) is False


def test_verify_password_invalid_hash():
    assert verify_password("test", "not-a-hash") is False


def test_create_access_token():
    token = create_access_token("user-123", "admin", "test@test.com")
    assert isinstance(token, str)
    assert len(token) > 50


def test_decode_access_token():
    token = create_access_token("user-456", "manager", "mgr@test.com")
    payload = decode_token(token)
    assert payload["sub"] == "user-456"
    assert payload["role"] == "manager"
    assert payload["email"] == "mgr@test.com"
    assert payload["type"] == "access"


def test_create_refresh_token():
    token = create_refresh_token("user-789")
    payload = decode_token(token)
    assert payload["sub"] == "user-789"
    assert payload["type"] == "refresh"


def test_tokens_are_unique():
    t1 = create_access_token("u1", "admin", "a@b.com")
    t2 = create_access_token("u1", "admin", "a@b.com")
    assert t1 != t2  # Different jti
