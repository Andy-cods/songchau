"""
Gemini AI service for RFQ classification (M03).

Uses Google Generative AI SDK to classify RFQ items as:
  - chot (CHỐT ✅) — Should quote, high win probability
  - xem  (XEM XÉT 🟡) — Review needed
  - bo   (BỎ QUA ❌) — Skip, low win probability
"""

from __future__ import annotations

import json
import logging
from typing import Any

import google.generativeai as genai

from app.core.config import settings

logger = logging.getLogger(__name__)

_model = None


def _get_model():
    global _model
    if _model is None:
        genai.configure(api_key=settings.GEMINI_API_KEY)
        _model = genai.GenerativeModel("gemini-1.5-flash")
    return _model


CLASSIFY_PROMPT = """Bạn là chuyên gia phân tích RFQ (Request for Quotation) cho ngành spare parts SMT Samsung.

Dựa trên thông tin RFQ dưới đây và lịch sử tương tự, hãy phân loại mỗi item:
- "chot": Nên báo giá, xác suất thắng cao (có lịch sử thắng, giá cạnh tranh, maker quen)
- "xem": Cần xem xét thêm (chưa rõ, giá biến động, maker mới)
- "bo": Bỏ qua (giá quá cao so với thị trường, lịch sử thua nhiều, margin thấp)

Trả về JSON array, mỗi item gồm:
{{"bqms_code": "...", "classification": "chot|xem|bo", "confidence": 0.0-1.0, "reasoning": "..."}}

RFQ Items:
{items_json}

Lịch sử tương tự:
{history_json}

CHỈ trả về JSON array, KHÔNG giải thích thêm."""


async def classify_rfq_items(
    items: list[dict[str, Any]],
    history: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Classify a batch of RFQ items using Gemini AI.

    Args:
        items: List of RFQ items with bqms_code, specification, maker, etc.
        history: Similar historical RFQ data for context.

    Returns:
        List of classification results.
    """
    model = _get_model()

    items_json = json.dumps(items, ensure_ascii=False, default=str)
    history_json = json.dumps(history[:20], ensure_ascii=False, default=str)

    prompt = CLASSIFY_PROMPT.format(items_json=items_json, history_json=history_json)

    try:
        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=0.1,
                max_output_tokens=4096,
                response_mime_type="application/json",
            ),
        )

        results = json.loads(response.text)
        if not isinstance(results, list):
            results = [results]

        return results

    except Exception as exc:
        logger.error("Gemini classify error: %s", exc)
        # Fallback: mark all as "xem" with low confidence
        return [
            {
                "bqms_code": item.get("bqms_code", ""),
                "classification": "xem",
                "confidence": 0.0,
                "reasoning": f"AI error: {exc}",
            }
            for item in items
        ]
