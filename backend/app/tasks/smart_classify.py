"""
Procrastinate task for M03: Smart RFQ Classification.

Background task for batch AI classification of large RFQ sets.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.core.procrastinate_app import app

logger = logging.getLogger(__name__)


@app.task(name="batch_classify_rfq", queue="ai")
def batch_classify_rfq(items_json: str, batch_id: str, user_id: str) -> dict[str, Any]:
    """Background task for classifying RFQ items via AI.

    Used when batch size > 20 items to avoid API timeout.
    """
    import asyncio

    async def _run():
        import asyncpg as apg
        from app.core.config import settings
        from app.services.gemini_service import classify_rfq_items

        dsn = (
            f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
            f"@postgres:5432/{settings.POSTGRES_DB}"
        )
        conn = await apg.connect(dsn)

        try:
            items = json.loads(items_json)

            # Find similar history for context
            history = []
            for item in items[:5]:
                rows = await conn.fetch(
                    """
                    SELECT bqms_code, specification, maker, result,
                           quoted_price_bqms_v1, created_at
                    FROM bqms_rfq
                    WHERE bqms_code % $1
                    ORDER BY similarity(bqms_code, $1) DESC
                    LIMIT 5
                    """,
                    item.get("bqms_code", ""),
                )
                history.extend([dict(r) for r in rows])

            # Classify in batches of 10
            all_results = []
            for i in range(0, len(items), 10):
                batch = items[i:i + 10]
                results = await classify_rfq_items(batch, history)
                all_results.extend(results)

            # Save results
            for r in all_results:
                rfq_id = await conn.fetchval(
                    "SELECT id FROM bqms_rfq WHERE bqms_code = $1 ORDER BY created_at DESC LIMIT 1",
                    r.get("bqms_code", ""),
                )
                await conn.execute(
                    """
                    INSERT INTO ai_classification_results
                        (rfq_id, bqms_code, classification, confidence, reasoning, model_version, batch_id)
                    VALUES ($1, $2, $3, $4, $5, 'gemini-1.5-flash', $6)
                    """,
                    rfq_id,
                    r.get("bqms_code", ""),
                    r.get("classification", "xem"),
                    r.get("confidence", 0.5),
                    r.get("reasoning", ""),
                    batch_id,
                )

            chot = len([r for r in all_results if r.get("classification") == "chot"])
            xem = len([r for r in all_results if r.get("classification") == "xem"])
            bo = len([r for r in all_results if r.get("classification") == "bo"])

            return {
                "batch_id": batch_id,
                "total": len(all_results),
                "chot": chot,
                "xem": xem,
                "bo": bo,
            }

        finally:
            await conn.close()

    return asyncio.run(_run())
