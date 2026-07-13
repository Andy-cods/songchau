-- Phase 6 (Thang 2026-05-12 "Full Vision") — Pet gamification system.
--
-- 9 species (chó, mèo, koi, hải âu, vịt, rồng, ngựa, hoa, cây) × 3 forms each
-- = 27 unique sprites. EXP rule: 1 quote = +1 exp, 1 won quote = +5 exp,
-- daily interaction = +1 exp each (3 types × 1h cooldown — code
-- INTERACT_COOLDOWN_SECONDS trong pet.py là nguồn sự thật).
-- Level formula: level = 1 + floor(exp / 10). Form unlock at lv 5 / 20.
-- User can adopt up to 3 pets, designate 1 as avatar.

BEGIN;

-- 1. Species catalog (seed table, read-only after initial insert)
CREATE TABLE IF NOT EXISTS pet_species_catalog (
    species          TEXT PRIMARY KEY,
    display_name_vi  TEXT NOT NULL,
    description_vi   TEXT,
    form_1_sprite    TEXT NOT NULL,
    form_2_sprite    TEXT NOT NULL,
    form_3_sprite    TEXT NOT NULL,
    unlock_level_2   INT DEFAULT 5,
    unlock_level_3   INT DEFAULT 20,
    rarity           TEXT DEFAULT 'common',  -- 'common' | 'rare' | 'legendary'
    color_theme      TEXT,                    -- hex e.g. '#3b82f6'
    sort_order       INT DEFAULT 100
);

COMMENT ON TABLE pet_species_catalog IS 'Catalog 9 loài pet với 3 hình thái mỗi loài (Thang 2026-05-12)';

-- Seed 9 species. Forms 2 and 3 unlock at lv 5 / 20 (default).
-- Rồng = legendary (cao cấp nhất), Hoa/Cây = rare, rest = common.
INSERT INTO pet_species_catalog (species, display_name_vi, description_vi,
    form_1_sprite, form_2_sprite, form_3_sprite,
    rarity, color_theme, sort_order)
VALUES
    ('dog',     'Chó',     'Người bạn trung thành — sủa lên mỗi khi bạn báo giá xong',
        '/pets/dog_1.svg',     '/pets/dog_2.svg',     '/pets/dog_3.svg',
        'common', '#f59e0b', 10),
    ('cat',     'Mèo',     'Mèo lười tĩnh lặng — hài lòng khi pet level lên',
        '/pets/cat_1.svg',     '/pets/cat_2.svg',     '/pets/cat_3.svg',
        'common', '#ec4899', 20),
    ('koi',     'Cá Koi',  'Cá koi may mắn — bơi quanh khi RFQ thắng thầu',
        '/pets/koi_1.svg',     '/pets/koi_2.svg',     '/pets/koi_3.svg',
        'common', '#ef4444', 30),
    ('seagull', 'Hải âu',  'Hải âu vùng biển — bay vòng quanh khi báo giá nhiều',
        '/pets/seagull_1.svg', '/pets/seagull_2.svg', '/pets/seagull_3.svg',
        'common', '#3b82f6', 40),
    ('duck',    'Vịt',     'Vịt vui vẻ — quack quack khi level lên',
        '/pets/duck_1.svg',    '/pets/duck_2.svg',    '/pets/duck_3.svg',
        'common', '#eab308', 50),
    ('horse',   'Ngựa',    'Ngựa mạnh mẽ — phi nước đại khi đạt mốc EXP',
        '/pets/horse_1.svg',   '/pets/horse_2.svg',   '/pets/horse_3.svg',
        'common', '#a855f7', 60),
    ('flower',  'Hoa',     'Bông hoa nhỏ — nở thành cây hoa đại thụ',
        '/pets/flower_1.svg',  '/pets/flower_2.svg',  '/pets/flower_3.svg',
        'rare',   '#f43f5e', 70),
    ('plant',   'Cây',     'Mầm cây nhỏ → cây cổ thụ — kiên nhẫn sẽ thắng',
        '/pets/plant_1.svg',   '/pets/plant_2.svg',   '/pets/plant_3.svg',
        'rare',   '#10b981', 80),
    ('dragon',  'Rồng',    'Linh thiêng nhất — chỉ unlock khi tổng EXP > 100',
        '/pets/dragon_1.svg',  '/pets/dragon_2.svg',  '/pets/dragon_3.svg',
        'legendary', '#dc2626', 90)
ON CONFLICT (species) DO NOTHING;

-- 2. User pets (each user can own up to 3)
CREATE TABLE IF NOT EXISTS user_pets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    species             TEXT NOT NULL REFERENCES pet_species_catalog(species),
    nickname            TEXT,
    current_form        INT NOT NULL DEFAULT 1 CHECK (current_form IN (1, 2, 3)),
    exp                 INT NOT NULL DEFAULT 0 CHECK (exp >= 0),
    level               INT NOT NULL DEFAULT 1 CHECK (level >= 1),
    is_avatar           BOOLEAN NOT NULL DEFAULT false,
    last_fed_at         TIMESTAMPTZ,
    last_pet_at         TIMESTAMPTZ,
    last_play_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_pets_user_id ON user_pets(user_id);
-- Only one avatar pet per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_pets_avatar
    ON user_pets(user_id) WHERE is_avatar = true;

COMMENT ON TABLE user_pets IS 'Pet của user — adopt tối đa 3/user, 1 đặt làm avatar';
COMMENT ON COLUMN user_pets.current_form IS '1/2/3 = baby/teen/adult, auto-progresses on level threshold';

-- 3. EXP log (audit trail)
CREATE TABLE IF NOT EXISTS pet_exp_log (
    id              BIGSERIAL PRIMARY KEY,
    user_pet_id     UUID NOT NULL REFERENCES user_pets(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,    -- 'quote_submitted'|'quote_won'|'interaction_feed'|'interaction_pet'|'interaction_play'|'daily_login'
    exp_delta       INT NOT NULL,
    source_ref      TEXT,              -- rfq_id, won_quotation_id, etc
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pet_exp_log_pet_id ON pet_exp_log(user_pet_id);
CREATE INDEX IF NOT EXISTS idx_pet_exp_log_created_at ON pet_exp_log(created_at DESC);

COMMENT ON TABLE pet_exp_log IS 'EXP audit log — mỗi event mỗi row';

COMMIT;
