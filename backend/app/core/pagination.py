"""
Standardized pagination utility for Song Chau ERP.

Provides:
  - PaginationParams: Pydantic model for query parameters
  - paginate(): Build safe ORDER BY + LIMIT + OFFSET clause
  - PaginatedResponse: Standard response envelope

Usage in endpoints:
    from app.core.pagination import PaginationParams, paginate, PaginatedResponse

    ALLOWED_SORTS = ["created_at", "name", "total_amount"]

    @router.get("")
    async def list_items(
        page: int = Query(1, ge=1),
        page_size: int = Query(25, ge=1, le=200),
        sort_by: str = Query("created_at"),
        sort_dir: str = Query("desc"),
        conn = Depends(get_db),
    ):
        params = PaginationParams(
            page=page, page_size=page_size,
            sort_by=sort_by, sort_dir=sort_dir,
        )
        order_clause, limit, offset = paginate(params, ALLOWED_SORTS)

        rows = await conn.fetch(
            f"SELECT * FROM items WHERE active = true {order_clause} LIMIT $1 OFFSET $2",
            limit, offset,
        )
        total = await conn.fetchval("SELECT COUNT(*) FROM items WHERE active = true")

        return PaginatedResponse.build(rows, total, params)
"""

from __future__ import annotations

from typing import Any, Sequence

from pydantic import BaseModel, Field

from app.core.security_middleware import validate_sort_column, validate_sort_direction


class PaginationParams(BaseModel):
    """Standard pagination query parameters."""

    page: int = Field(default=1, ge=1, description="Page number (1-based)")
    page_size: int = Field(default=25, ge=1, le=200, description="Items per page")
    sort_by: str = Field(default="created_at", description="Column to sort by")
    sort_dir: str = Field(default="desc", description="Sort direction: asc or desc")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size


class PaginatedResponse(BaseModel):
    """Standard paginated response envelope."""

    data: list[Any]
    total: int
    page: int
    page_size: int
    total_pages: int

    @classmethod
    def build(
        cls,
        rows: Sequence[Any],
        total: int,
        params: PaginationParams,
    ) -> dict[str, Any]:
        """Build a paginated response dict from query results."""
        # Convert asyncpg Records to dicts if needed
        data = []
        for row in rows:
            if hasattr(row, "items"):
                data.append(dict(row))
            else:
                data.append(row)

        total_pages = max(1, (total + params.page_size - 1) // params.page_size)

        return {
            "data": data,
            "total": total,
            "page": params.page,
            "page_size": params.page_size,
            "total_pages": total_pages,
        }


def paginate(
    params: PaginationParams,
    allowed_sorts: Sequence[str],
    table_alias: str = "",
) -> tuple[str, int, int]:
    """Build a safe ORDER BY clause + LIMIT/OFFSET values.

    Args:
        params: Pagination parameters from the request.
        allowed_sorts: Whitelist of allowed sort column names.
        table_alias: Optional table alias prefix (e.g., "wi" -> "wi.created_at").

    Returns:
        Tuple of (order_by_clause, limit, offset).
        The clause includes "ORDER BY ..." and is safe to interpolate.
    """
    column = validate_sort_column(params.sort_by, allowed_sorts)
    direction = validate_sort_direction(params.sort_dir)

    if table_alias:
        order_clause = f"ORDER BY {table_alias}.{column} {direction}"
    else:
        order_clause = f"ORDER BY {column} {direction}"

    return order_clause, params.limit, params.offset
