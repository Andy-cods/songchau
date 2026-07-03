-- Nới CHECK constraint interaction_type trên crm_interactions:
-- 5 giá trị cũ (email/call/meeting/visit/other) -> 9 giá trị
-- (thêm zalo/note/demo/support). Idempotent.

ALTER TABLE crm_interactions
    DROP CONSTRAINT IF EXISTS crm_interactions_interaction_type_check;

ALTER TABLE crm_interactions
    ADD CONSTRAINT crm_interactions_interaction_type_check
    CHECK (interaction_type IN (
        'email', 'call', 'meeting', 'visit', 'other',
        'zalo', 'note', 'demo', 'support'
    ));
