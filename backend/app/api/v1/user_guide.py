"""
User Guide / Help API (M26) — Song Châu ERP

Knowledge base for user-facing help articles and first-login onboarding guide.
Articles are stored as Markdown in the help_articles table.

Endpoints:
  GET  /articles            — List published articles grouped by category
  GET  /articles/{slug}     — Get a single article by slug
  POST /articles            — Create or update an article (admin only)
  GET  /first-login         — Get the first-login onboarding guide
"""

from __future__ import annotations

import logging
import re
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_CATEGORIES = {
    "onboarding",
    "purchasing",
    "sales",
    "inventory",
    "finance",
    "bqms",
    "reports",
    "admin",
    "general",
    "faq",
}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ArticleUpsertRequest(BaseModel):
    title: str
    slug: Optional[str] = None          # auto-generated if omitted
    content: str                        # Markdown text
    category: str = "general"
    order_index: int = 0
    is_published: bool = True

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Tiêu đề không được rỗng")
        return v.strip()

    @field_validator("content")
    @classmethod
    def content_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Nội dung không được rỗng")
        return v

    @field_validator("category")
    @classmethod
    def valid_category(cls, v: str) -> str:
        if v not in VALID_CATEGORIES:
            raise ValueError(
                f"Danh mục không hợp lệ. Chấp nhận: {', '.join(sorted(VALID_CATEGORIES))}"
            )
        return v


# ---------------------------------------------------------------------------
# Helper: slug generation
# ---------------------------------------------------------------------------

def _make_slug(title: str) -> str:
    """Convert a Vietnamese title to an ASCII-friendly slug."""
    # Replace Vietnamese characters — simplified transliteration
    vn_map = str.maketrans(
        "àáảãạăắặằẳẵâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ"
        "ÀÁẢÃẠĂẮẶẰẲẴÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ",
        "aaaaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyy"
        "AAAAAAAAAAAAAAAAAAADEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYY" + "y" * 3,
    )
    slug = title.lower().translate(vn_map)
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug[:100] or "article"


# ---------------------------------------------------------------------------
# GET /articles — List published articles by category
# ---------------------------------------------------------------------------

@router.get("/articles")
async def list_articles(
    category: Optional[str] = None,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["is_published = true"]
    params: list = []
    idx = 1

    if category:
        conditions.append(f"category = ${idx}")
        params.append(category)
        idx += 1

    where = " AND ".join(conditions)

    rows = await conn.fetch(
        f"""
        SELECT id, title, slug, category, order_index, is_published,
               created_at, updated_at,
               LEFT(content, 200) AS excerpt
        FROM help_articles
        WHERE {where}
        ORDER BY category ASC, order_index ASC, created_at ASC
        """,
        *params,
    )

    # Group by category for convenience
    grouped: dict[str, list] = {}
    for r in rows:
        cat = r["category"]
        if cat not in grouped:
            grouped[cat] = []
        grouped[cat].append(dict(r))

    return {
        "data": {
            "articles": [dict(r) for r in rows],
            "by_category": grouped,
            "total": len(rows),
        }
    }


# ---------------------------------------------------------------------------
# GET /articles/{slug} — Get single article by slug
# ---------------------------------------------------------------------------

@router.get("/articles/{slug}")
async def get_article(
    slug: str,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """
        SELECT ha.*,
               u.full_name AS created_by_name
        FROM help_articles ha
        LEFT JOIN users u ON u.id = ha.created_by
        WHERE ha.slug = $1
        """,
        slug,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Bài viết không tồn tại")

    if not row["is_published"] and token_data.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Bài viết chưa được công khai",
        )

    # Fetch related articles from same category
    related = await conn.fetch(
        """
        SELECT id, title, slug, order_index
        FROM help_articles
        WHERE category = $1
          AND slug != $2
          AND is_published = true
        ORDER BY order_index ASC
        LIMIT 5
        """,
        row["category"],
        slug,
    )

    return {
        "data": {
            **dict(row),
            "related_articles": [dict(r) for r in related],
        }
    }


# ---------------------------------------------------------------------------
# POST /articles — Create or update article (admin only)
# ---------------------------------------------------------------------------

@router.post("/articles", status_code=201)
async def upsert_article(
    body: ArticleUpsertRequest,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Generate slug if not provided
    slug = body.slug.strip() if body.slug else _make_slug(body.title)

    # Check if slug already exists
    existing = await conn.fetchrow(
        "SELECT id FROM help_articles WHERE slug = $1", slug
    )

    if existing:
        # Update existing article
        row = await conn.fetchrow(
            """
            UPDATE help_articles
            SET title       = $1,
                content     = $2,
                category    = $3,
                order_index = $4,
                is_published = $5,
                updated_at  = NOW()
            WHERE slug = $6
            RETURNING *
            """,
            body.title,
            body.content,
            body.category,
            body.order_index,
            body.is_published,
            slug,
        )
        return {
            "data": dict(row),
            "message": f"Đã cập nhật bài viết '{body.title}'",
        }
    else:
        # Insert new article
        row = await conn.fetchrow(
            """
            INSERT INTO help_articles
                (title, slug, content, category, order_index, is_published, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7::uuid)
            RETURNING *
            """,
            body.title,
            slug,
            body.content,
            body.category,
            body.order_index,
            body.is_published,
            token_data.user_id,
        )
        return {
            "data": dict(row),
            "message": f"Đã tạo bài viết '{body.title}'",
        }


# ---------------------------------------------------------------------------
# GET /first-login — Onboarding guide for new users
# ---------------------------------------------------------------------------

@router.get("/first-login")
async def first_login_guide(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """
        SELECT title, slug, content, category, updated_at
        FROM help_articles
        WHERE slug = 'first-login-guide'
          AND is_published = true
        LIMIT 1
        """
    )

    if not row:
        # Fallback minimal guide
        return {
            "data": {
                "title": "Chào mừng đến với Song Châu ERP",
                "content": (
                    "# Chào mừng!\n\n"
                    "Hệ thống ERP Song Châu giúp bạn quản lý mua hàng, bán hàng, "
                    "kho bãi và tài chính hiệu quả.\n\n"
                    "## Bắt đầu\n"
                    "1. Đổi mật khẩu trong phần Cài đặt\n"
                    "2. Xem Dashboard để nắm tổng quan\n"
                    "3. Liên hệ quản trị viên nếu cần hỗ trợ\n"
                ),
                "slug": "first-login-guide",
                "is_fallback": True,
            }
        }

    # Fetch quick-links: all articles in onboarding category
    quick_links = await conn.fetch(
        """
        SELECT title, slug
        FROM help_articles
        WHERE category = 'onboarding'
          AND slug != 'first-login-guide'
          AND is_published = true
        ORDER BY order_index ASC
        LIMIT 10
        """
    )

    return {
        "data": {
            **dict(row),
            "quick_links": [dict(r) for r in quick_links],
            "user_role": token_data.role,
        }
    }
