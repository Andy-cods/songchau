"""
M03: Smart RFQ Classification API (AI-powered).

Endpoints:
  - POST /batch — Classify a batch of RFQ items using Gemini AI
  - GET /results — List classification results
  - POST /override — User override of AI classification
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.database import get_db
from app.core.rbac import require_role, TokenData

router = APIRouter()


# ─── Models ───────────────────────────────────────────────────

class ClassifyBatchRequest(BaseModel):
    items: list[dict[str, Any]]  # [{bqms_code, specification, maker, ...}]


class OverrideRequest(BaseModel):
    classification_id: int
    new_classification: str  # chot, xem, bo
    reason: str | None = None


# ─── Similar History Lookup (pg_trgm) ────────────────────────

async def _find_similar_history(conn: asyncpg.Connection, bqms_code: str, spec: str) -> list[dict]:
    """Find similar RFQ history using pg_trgm fuzzy matching."""
    rows = await conn.fetch(
        """
        SELECT bqms_code, specification, maker, result,
               quoted_price_bqms_v1, quoted_price_bqms_v4,
               similarity(bqms_code, $1) as code_sim,
               created_at
        FROM bqms_rfq
        WHERE bqms_code % $1
           OR specification ILIKE '%' || $2 || '%'
        ORDER BY similarity(bqms_code, $1) DESC
        LIMIT 10
        """,
        bqms_code, spec[:50] if spec else "",
    )
    return [dict(r) for r in rows]


# ─── Rule-Based Pre-Classification ───────────────────────────

async def _rule_based_classify(conn: asyncpg.Connection, item: dict) -> dict | None:
    """Try rule-based classification before calling AI.

    Rules:
      1. If we have won this exact code before → CHOT
      2. If we have lost this code 3+ times → BO
      3. Otherwise → delegate to AI
    """
    bqms_code = item.get("bqms_code", "")
    if not bqms_code:
        return None

    stats = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE result ILIKE '%won%') as won_count,
            COUNT(*) FILTER (WHERE result ILIKE '%lost%' OR result ILIKE '%lose%') as lost_count,
            COUNT(*) as total
        FROM bqms_rfq
        WHERE bqms_code = $1
        """,
        bqms_code,
    )

    if not stats or stats["total"] == 0:
        return None

    if stats["won_count"] > 0:
        return {
            "bqms_code": bqms_code,
            "classification": "chot",
            "confidence": min(0.95, 0.7 + stats["won_count"] * 0.1),
            "reasoning": f"Đã thắng {stats['won_count']}/{stats['total']} lần trước đây",
        }

    if stats["lost_count"] >= 3:
        return {
            "bqms_code": bqms_code,
            "classification": "bo",
            "confidence": min(0.9, 0.5 + stats["lost_count"] * 0.1),
            "reasoning": f"Đã thua {stats['lost_count']}/{stats['total']} lần, xác suất thắng thấp",
        }

    return None


# ─── Batch Classify ───────────────────────────────────────────

@router.post("/batch")
async def classify_batch(
    body: ClassifyBatchRequest,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Classify a batch of RFQ items using rules + Gemini AI.

    Flow:
      1. Try rule-based classification (fast, free)
      2. For remaining items, batch to Gemini AI
      3. Find similar history for context
      4. Save all results to DB
    """
    from app.services.gemini_service import classify_rfq_items

    if not body.items:
        raise HTTPException(400, "Danh sách items rỗng")

    if len(body.items) > 50:
        raise HTTPException(400, "Tối đa 50 items mỗi lần phân loại")

    batch_id = uuid.uuid4().hex[:12]
    results: list[dict] = []
    ai_items: list[dict] = []
    ai_history: list[dict] = []

    # Step 1: Rule-based classification
    for item in body.items:
        rule_result = await _rule_based_classify(conn, item)
        if rule_result:
            rule_result["source"] = "rules"
            rule_result["batch_id"] = batch_id
            results.append(rule_result)
        else:
            ai_items.append(item)
            # Get similar history for AI context
            history = await _find_similar_history(
                conn, item.get("bqms_code", ""), item.get("specification", "")
            )
            if history:
                ai_history.extend(history[:3])

    # Step 2: AI classification for remaining
    if ai_items:
        ai_results = await classify_rfq_items(ai_items, ai_history)
        for r in ai_results:
            r["source"] = "ai"
            r["batch_id"] = batch_id
            results.append(r)

    # Step 3: Save to DB
    for r in results:
        # Find rfq_id if exists
        rfq_id = await conn.fetchval(
            "SELECT id FROM bqms_rfq WHERE bqms_code = $1 ORDER BY created_at DESC LIMIT 1",
            r.get("bqms_code", ""),
        )

        similar = await _find_similar_history(conn, r.get("bqms_code", ""), "")

        await conn.execute(
            """
            INSERT INTO ai_classification_results
                (rfq_id, bqms_code, classification, confidence, reasoning, similar_history, model_version, batch_id)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
            """,
            rfq_id,
            r.get("bqms_code", ""),
            r["classification"],
            r.get("confidence", 0.5),
            r.get("reasoning", ""),
            json.dumps(similar[:5], default=str, ensure_ascii=False),
            r.get("source", "ai"),
            batch_id,
        )

    # Summary
    chot = len([r for r in results if r["classification"] == "chot"])
    xem = len([r for r in results if r["classification"] == "xem"])
    bo = len([r for r in results if r["classification"] == "bo"])

    return {
        "data": {
            "batch_id": batch_id,
            "results": results,
            "summary": {"chot": chot, "xem": xem, "bo": bo, "total": len(results)},
            "rule_based": len(results) - len(ai_items),
            "ai_classified": len(ai_items),
        },
        "message": f"Đã phân loại {len(results)} items: {chot} CHỐT, {xem} XEM XÉT, {bo} BỎ QUA",
    }


# ─── Results History ──────────────────────────────────────────

@router.get("/results")
async def list_results(
    batch_id: str | None = None,
    classification: str | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List AI classification results."""
    conditions: list[str] = []
    params: list[Any] = []

    if batch_id:
        params.append(batch_id)
        conditions.append(f"batch_id = ${len(params)}")
    if classification:
        params.append(classification)
        conditions.append(f"classification = ${len(params)}")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * limit

    total = await conn.fetchval(f"SELECT COUNT(*) FROM ai_classification_results {where}", *params)

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT acr.*, r.specification, r.maker
        FROM ai_classification_results acr
        LEFT JOIN bqms_rfq r ON r.id = acr.rfq_id
        {where}
        ORDER BY acr.created_at DESC
        LIMIT ${len(params) - 1} OFFSET ${len(params)}
        """,
        *params,
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "limit": limit,
        }
    }


# ─── Override ─────────────────────────────────────────────────

@router.post("/override")
async def override_classification(
    body: OverrideRequest,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Override an AI classification result."""
    if body.new_classification not in ("chot", "xem", "bo"):
        raise HTTPException(400, "Classification phải là chot, xem, hoặc bo")

    updated = await conn.fetchval(
        """
        UPDATE ai_classification_results
        SET classification = $2,
            accepted = true,
            reviewed_by = $3::uuid,
            reviewed_at = NOW(),
            reasoning = COALESCE($4, reasoning)
        WHERE id = $1
        RETURNING id
        """,
        body.classification_id,
        body.new_classification,
        token_data.user_id,
        body.reason,
    )

    if not updated:
        raise HTTPException(404, "Kết quả phân loại không tồn tại")

    return {"message": f"Đã cập nhật phân loại thành '{body.new_classification}'"}
