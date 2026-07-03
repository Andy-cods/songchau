"""Pet gamification service — award EXP, recompute level, handle form unlock.

Per Thang 2026-05-12 "Full Vision":
  - Level formula: level = 1 + floor(exp / 10)
  - Form unlock: form 2 at lv 5, form 3 at lv 20
  - 1 quote submitted = +1 exp, 1 quote won = +5 exp
  - Interactions (feed/pet/play): +1 exp each, 1h cooldown per type

All functions are best-effort: failures are logged but don't break the
caller's main flow (we don't want a pet bug to fail a quote submit).
"""
from __future__ import annotations

import logging
from typing import Literal

import asyncpg

logger = logging.getLogger(__name__)

EVENT_TYPES = Literal[
    "quote_submitted", "quote_won", "interaction_feed",
    "interaction_pet", "interaction_play", "daily_login",
]


def compute_level(exp: int) -> int:
    """Pure function: exp → level. Min 1, +1 per 10 exp."""
    return 1 + max(0, exp) // 10


def compute_form(level: int, unlock_2: int = 5, unlock_3: int = 20) -> int:
    """Current form (1/2/3) based on level + species unlock thresholds."""
    if level >= unlock_3:
        return 3
    if level >= unlock_2:
        return 2
    return 1


async def get_primary_pet(conn: asyncpg.Connection, user_id: str) -> dict | None:
    """The "primary" pet is the avatar pet — or the first adopted if no avatar."""
    row = await conn.fetchrow(
        """
        SELECT p.*, c.unlock_level_2, c.unlock_level_3
        FROM user_pets p
        JOIN pet_species_catalog c ON c.species = p.species
        WHERE p.user_id = $1::uuid
        ORDER BY p.is_avatar DESC, p.created_at ASC
        LIMIT 1
        """,
        user_id,
    )
    return dict(row) if row else None


async def award_exp(
    conn: asyncpg.Connection,
    user_id: str,
    event_type: str,
    delta: int,
    source_ref: str | None = None,
) -> dict | None:
    """Award exp to the user's primary pet (or skip if no pet adopted).

    Returns: {pet_id, new_exp, new_level, new_form, leveled_up: bool, evolved: bool}
    or None if no pet / failure (logged).
    """
    try:
        pet = await get_primary_pet(conn, user_id)
        if not pet:
            return None  # User hasn't adopted yet — silent skip

        old_exp = pet["exp"]
        old_level = pet["level"]
        old_form = pet["current_form"]

        new_exp = old_exp + delta
        new_level = compute_level(new_exp)
        new_form = compute_form(
            new_level,
            pet["unlock_level_2"] or 5,
            pet["unlock_level_3"] or 20,
        )

        await conn.execute(
            """
            UPDATE user_pets
            SET exp = $1,
                level = $2,
                current_form = $3,
                updated_at = NOW()
            WHERE id = $4
            """,
            new_exp, new_level, new_form, pet["id"],
        )

        await conn.execute(
            """
            INSERT INTO pet_exp_log (user_pet_id, event_type, exp_delta, source_ref)
            VALUES ($1, $2, $3, $4)
            """,
            pet["id"], event_type, delta, source_ref,
        )

        leveled_up = new_level > old_level
        evolved = new_form > old_form

        # On evolution, drop a system notification (best-effort)
        if evolved:
            try:
                title = f"🎉 Pet đã tiến hóa lên Form {new_form}!"
                body = f"Pet của bạn vừa đạt Level {new_level} và chuyển sang hình thái mới."
                await conn.execute(
                    """
                    INSERT INTO notifications
                      (recipient_id, type, title, body, ref_type, ref_id, metadata)
                    VALUES ($1::uuid, 'bqms_rfq_new', $2, $3, 'user_pet', NULL,
                      jsonb_build_object('pet_id', $4::text, 'old_form', $5, 'new_form', $6))
                    """,
                    user_id, title, body, str(pet["id"]), old_form, new_form,
                )
            except Exception as exc:
                logger.warning("pet evolution notify failed: %s", exc)

        return {
            "pet_id": str(pet["id"]),
            "old_exp": old_exp,
            "new_exp": new_exp,
            "old_level": old_level,
            "new_level": new_level,
            "old_form": old_form,
            "new_form": new_form,
            "leveled_up": leveled_up,
            "evolved": evolved,
        }
    except Exception as exc:
        logger.warning("award_exp failed for user_id=%s event=%s: %s", user_id, event_type, exc)
        return None
