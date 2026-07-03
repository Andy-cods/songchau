-- ============================================================
-- Migration: M43 — schema-qualify unaccent() bên trong immutable_unaccent
-- Date: 2026-07-03
-- Plan: W2-02 restore hardening (master-completion Đợt 2)
--
-- WHY: pg_dump phát ra `SELECT pg_catalog.set_config('search_path','',false)`
-- ở đầu dump. immutable_unaccent(text) gọi `unaccent($1)` KHÔNG schema-qualify.
-- 4 bảng (customers/inventory/products/suppliers) có GENERATED STORED column
-- `*_unaccent = immutable_unaccent(lower(...))`. Khi pg_restore COPY dữ liệu, cột
-- generated được tính lại → gọi unaccent() với search_path='' → "function
-- unaccent(text) does not exist" → 4 bảng lõi + view/matview phụ thuộc KHÔNG
-- restore được (drill W1-00: chỉ 170/182 bảng). Qualify `public.unaccent` khiến
-- hàm resolve bất kể search_path ⇒ backup TỰ CHỨA, restore SẠCH ở mọi nơi.
--
-- LƯU Ý (vì sao cần SET search_path): chỉ qualify `public.unaccent` trong body
-- KHÔNG đủ — SQL-function inlining của Postgres re-resolve body theo search_path
-- của SESSION restore (=''), làm mất qualification → vẫn "unaccent does not exist".
-- Thêm `SET search_path = public, pg_catalog` khiến hàm KHÔNG được inline (giữ SET)
-- → chạy như function call thật với search_path riêng → unaccent luôn resolve.
--
-- AN TOÀN: chỉ CREATE OR REPLACE 1 hàm SQL (cùng signature immutable_unaccent(text)).
-- KHÔNG drop/alter cột generated, KHÔNG đụng bảng/index/dữ liệu. Idempotent.
-- (Hàm chỉ tính khi GHI vào 4 bảng nhỏ 12-50 dòng → không-inline không ảnh hưởng perf.)
-- ============================================================

CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE PARALLEL SAFE
    SET search_path = public, pg_catalog
AS $function$
    SELECT public.unaccent($1);
$function$;
