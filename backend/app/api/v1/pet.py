"""Pet gamification API — adopt, interact, set avatar, view EXP history.

Per Thang 2026-05-12 "Full Vision": 9 species × 3 forms = 27 sprites,
EXP from quote actions + daily interactions, set pet as profile avatar.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData
from app.services.pet_service import compute_level, compute_form, award_exp

logger = logging.getLogger(__name__)
router = APIRouter(tags=["pet"])


# ---------------------------------------------------------------------------
# Pydantic
# ---------------------------------------------------------------------------

class AdoptIn(BaseModel):
    species: str
    nickname: str | None = None


class InteractIn(BaseModel):
    kind: str = Field(..., pattern="^(feed|pet|play)$")


# Interaction cooldown (per kind, per pet)
INTERACT_COOLDOWN_SECONDS = 3600  # 1 hour


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ser_pet(row: dict) -> dict:
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    if "id" in d and not isinstance(d["id"], str):
        d["id"] = str(d["id"])
    if "user_id" in d and not isinstance(d["user_id"], str):
        d["user_id"] = str(d["user_id"])
    return d


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/pets/catalog")
async def list_catalog(
    conn: asyncpg.Connection = Depends(get_db),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
):
    """Get full pet species catalog (9 species)."""
    rows = await conn.fetch(
        """
        SELECT species, display_name_vi, description_vi,
               form_1_sprite, form_2_sprite, form_3_sprite,
               unlock_level_2, unlock_level_3, rarity, color_theme, sort_order
        FROM pet_species_catalog
        ORDER BY sort_order, species
        """,
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/me/pets")
async def list_my_pets(
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List my adopted pets (sorted by avatar first, then created_at)."""
    rows = await conn.fetch(
        """
        SELECT p.id, p.user_id, p.species, p.nickname,
               p.current_form, p.exp, p.level, p.is_avatar,
               p.last_fed_at, p.last_pet_at, p.last_play_at,
               p.created_at, p.updated_at,
               c.display_name_vi, c.color_theme, c.rarity,
               c.form_1_sprite, c.form_2_sprite, c.form_3_sprite,
               c.unlock_level_2, c.unlock_level_3,
               CASE p.current_form
                 WHEN 1 THEN c.form_1_sprite
                 WHEN 2 THEN c.form_2_sprite
                 WHEN 3 THEN c.form_3_sprite
               END AS current_sprite
        FROM user_pets p
        JOIN pet_species_catalog c ON c.species = p.species
        WHERE p.user_id = $1::uuid
        ORDER BY p.is_avatar DESC, p.created_at ASC
        """,
        token_data.user_id,
    )
    pets = [_ser_pet(r) for r in rows]
    return {"data": pets}


@router.post("/me/pets/adopt")
async def adopt_pet(
    body: AdoptIn,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Adopt a new pet (max 3 per user, no duplicate species)."""
    # Verify species exists
    species_row = await conn.fetchrow(
        "SELECT species, display_name_vi, rarity FROM pet_species_catalog WHERE species = $1",
        body.species,
    )
    if not species_row:
        raise HTTPException(404, f"Loài '{body.species}' không tồn tại")

    # Check user's current pet count + duplicates
    current = await conn.fetch(
        "SELECT species FROM user_pets WHERE user_id = $1::uuid",
        token_data.user_id,
    )
    if len(current) >= 3:
        raise HTTPException(400, "Bạn đã nuôi tối đa 3 pet — phải bỏ 1 con trước")
    if any(c["species"] == body.species for c in current):
        raise HTTPException(409, f"Bạn đã có {species_row['display_name_vi']}")

    # Legendary species need 100+ total exp from all pets
    if species_row["rarity"] == "legendary":
        total_exp = await conn.fetchval(
            "SELECT COALESCE(SUM(exp), 0) FROM user_pets WHERE user_id = $1::uuid",
            token_data.user_id,
        )
        if (total_exp or 0) < 100:
            raise HTTPException(
                403,
                f"Loài {species_row['display_name_vi']} cần unlock — báo giá thêm để đạt 100 EXP "
                f"(hiện có {total_exp})"
            )

    is_first = len(current) == 0
    pet_id = await conn.fetchval(
        """
        INSERT INTO user_pets (user_id, species, nickname, is_avatar)
        VALUES ($1::uuid, $2, $3, $4)
        RETURNING id
        """,
        token_data.user_id, body.species, body.nickname or species_row["display_name_vi"],
        is_first,  # First pet auto-set as avatar
    )
    return {
        "data": {"pet_id": str(pet_id), "is_avatar": is_first},
        "message": f"Đã nhận nuôi {species_row['display_name_vi']}!"
    }


@router.post("/me/pets/{pet_id}/interact")
async def interact_with_pet(
    pet_id: str,
    body: InteractIn,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Feed/pet/play — adds +1 EXP per kind, 1h cooldown per kind."""
    pet = await conn.fetchrow(
        """
        SELECT p.*, c.unlock_level_2, c.unlock_level_3
        FROM user_pets p JOIN pet_species_catalog c ON c.species = p.species
        WHERE p.id = $1::uuid AND p.user_id = $2::uuid
        """,
        pet_id, token_data.user_id,
    )
    if not pet:
        raise HTTPException(404, "Pet không tồn tại hoặc không thuộc về bạn")

    cooldown_field = {
        "feed": "last_fed_at",
        "pet":  "last_pet_at",
        "play": "last_play_at",
    }[body.kind]

    last_at = pet[cooldown_field]
    now = datetime.now(timezone.utc)
    if last_at:
        elapsed = (now - last_at).total_seconds()
        if elapsed < INTERACT_COOLDOWN_SECONDS:
            remaining_min = int((INTERACT_COOLDOWN_SECONDS - elapsed) / 60)
            raise HTTPException(
                429,
                f"Pet còn no — đợi thêm ~{remaining_min} phút"
            )

    # Update cooldown timestamp
    await conn.execute(
        f"UPDATE user_pets SET {cooldown_field} = NOW() WHERE id = $1::uuid",
        pet_id,
    )

    # Award EXP
    result = await award_exp(
        conn, token_data.user_id,
        f"interaction_{body.kind}", delta=1, source_ref=pet_id,
    )

    return {
        "data": result or {},
        "message": {"feed": "🍖 Pet đã ăn ngon!", "pet": "💚 Pet rất vui!",
                    "play": "🎾 Pet chơi hăng say!"}[body.kind],
    }


@router.post("/me/pets/{pet_id}/set-avatar")
async def set_pet_as_avatar(
    pet_id: str,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Set this pet as profile avatar (unset previous if any)."""
    pet = await conn.fetchrow(
        """
        SELECT p.*, c.form_1_sprite, c.form_2_sprite, c.form_3_sprite
        FROM user_pets p JOIN pet_species_catalog c ON c.species = p.species
        WHERE p.id = $1::uuid AND p.user_id = $2::uuid
        """,
        pet_id, token_data.user_id,
    )
    if not pet:
        raise HTTPException(404, "Pet không tồn tại")

    # Atomic: unset all my pets, set this one
    await conn.execute(
        "UPDATE user_pets SET is_avatar = false WHERE user_id = $1::uuid",
        token_data.user_id,
    )
    await conn.execute(
        "UPDATE user_pets SET is_avatar = true WHERE id = $1::uuid",
        pet_id,
    )

    # Also update users.avatar_url to the current sprite (if column exists)
    sprite_map = {1: pet["form_1_sprite"], 2: pet["form_2_sprite"], 3: pet["form_3_sprite"]}
    sprite_url = sprite_map.get(pet["current_form"]) or pet["form_1_sprite"]
    try:
        await conn.execute(
            "UPDATE users SET avatar_url = $1 WHERE id = $2::uuid",
            sprite_url, token_data.user_id,
        )
    except Exception as exc:
        # avatar_url column may not exist — that's OK, pet.is_avatar is the canonical
        logger.info("users.avatar_url update skipped: %s", exc)

    return {"data": {"pet_id": pet_id, "sprite_url": sprite_url}, "message": "Đã đặt làm avatar"}


@router.get("/me/pets/{pet_id}/exp-history")
async def pet_exp_history(
    pet_id: str,
    limit: int = 50,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Recent EXP gain events for a pet."""
    # Verify ownership
    own = await conn.fetchval(
        "SELECT 1 FROM user_pets WHERE id = $1::uuid AND user_id = $2::uuid",
        pet_id, token_data.user_id,
    )
    if not own:
        raise HTTPException(404, "Pet không tồn tại")

    rows = await conn.fetch(
        """
        SELECT event_type, exp_delta, source_ref, created_at
        FROM pet_exp_log
        WHERE user_pet_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT $2
        """,
        pet_id, limit,
    )
    items = []
    for r in rows:
        items.append({
            "event_type": r["event_type"],
            "exp_delta": r["exp_delta"],
            "source_ref": r["source_ref"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        })
    return {"data": items}


@router.delete("/me/pets/{pet_id}")
async def release_pet(
    pet_id: str,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Release a pet (delete) — frees adoption slot."""
    result = await conn.execute(
        "DELETE FROM user_pets WHERE id = $1::uuid AND user_id = $2::uuid",
        pet_id, token_data.user_id,
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Pet không tồn tại")
    return {"message": "Đã chia tay pet — slot trống cho bạn nhận nuôi con khác"}
