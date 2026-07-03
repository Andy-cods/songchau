-- ============================================================================
-- Price Intelligence v1 — Trung tâm thông tin giá đa nguồn (Deploy 2 / Đợt 1)
-- Thang 2026-07-02. Gộp giá BQMS + Sourcing + XNK + IMV về CHUNG (tất cả VND).
-- Thiết kế: plans/price-intelligence/DESIGN.md §2, §9.
-- Số liệu đo thật: V1..V4 = VND; samsung_po rỗng (bỏ won_po); sourcing cost dùng
--   sourcing_entries.cost_vnd (supplier_prices chỉ 12 dòng); imv 26 dòng all VND.
-- Idempotent: CREATE OR REPLACE / IF NOT EXISTS. Rollback = DROP VIEW/FUNCTION/TABLE.
-- ============================================================================

-- ── Bảng cấu hình (các "núm vặn" cho tầng làm sạch, admin chỉnh được) ───────
CREATE TABLE IF NOT EXISTS price_intel_config (
    key         TEXT PRIMARY KEY,
    value       NUMERIC     NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO price_intel_config (key, value, description) VALUES
  ('mad_k',            3.5, 'L4: nguong ngoai lai robust_z > k (cao=noi, thap=chat)'),
  ('recency_months',    24, 'L5: cua so thoi gian (thang) cho quan sat gia'),
  ('min_sample',         5, 'L7: n toi thieu moi hien du doan'),
  ('enable_L4_outlier',  1, 'Bat/tat L4 loc ngoai lai MAD'),
  ('enable_L5_recency',  1, 'Bat/tat L5 cat thoi gian')
ON CONFLICT (key) DO NOTHING;

-- ── Hàm quy đổi về VND (dùng exchange_rates; gần như không cần vì đa số đã VND)
CREATE OR REPLACE FUNCTION fn_to_vnd(amount NUMERIC, cur TEXT, on_date DATE)
RETURNS NUMERIC AS $$
DECLARE r NUMERIC;
BEGIN
    IF amount IS NULL THEN RETURN NULL; END IF;
    IF cur IS NULL OR UPPER(cur) IN ('VND','') THEN RETURN amount; END IF;
    SELECT rate INTO r
      FROM exchange_rates
     WHERE to_currency::text = 'VND'
       AND from_currency::text = UPPER(cur)
       AND (on_date IS NULL OR rate_date <= on_date)
     ORDER BY rate_date DESC
     LIMIT 1;
    IF r IS NULL THEN RETURN NULL; END IF;   -- không có tỷ giá → NULL (vẫn giữ price_goc)
    RETURN amount * r;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── VIEW THÔ: mỗi dòng = 1 "quan sát giá" chuẩn hoá 14 cột ──────────────────
CREATE OR REPLACE VIEW v_price_observations AS
-- (1) BQMS giá mình chào V1 (VND) — dedup twins theo (rfq_number,bqms_code)
WITH bqms_dedup AS (
    SELECT DISTINCT ON (rfq_number, bqms_code)
           id, rfq_number, bqms_code, specification, supplier_name,
           quoted_price_bqms_v1, quoted_price_bqms_v4,
           purchase_price_vnd, purchase_price_rmb, expected_qty,
           COALESCE(inquiry_date, created_at::date) AS obs_date
      FROM bqms_rfq
     ORDER BY rfq_number, bqms_code,
              (result IS NOT NULL)::int DESC, updated_at DESC NULLS LAST, id DESC
)
SELECT 'bqms'::text src, 'quote_v1'::text price_role,
       bqms_code product_key, bqms_code, specification product_name,
       supplier_name party_name, 'supplier'::text party_role,
       obs_date, 'VND'::text currency_goc,
       quoted_price_bqms_v1 price_goc, quoted_price_bqms_v1 price_vnd,
       expected_qty qty, id ref_id, 'bqms_rfq'::text ref_table
  FROM bqms_dedup WHERE quoted_price_bqms_v1 > 0
UNION ALL
-- (1b) BQMS giá vốn NCC (VND)
SELECT 'bqms','cost_ncc', bqms_code, bqms_code, specification,
       supplier_name,'supplier', obs_date,'VND',
       purchase_price_vnd, purchase_price_vnd, expected_qty, id,'bqms_rfq'
  FROM bqms_dedup WHERE purchase_price_vnd > 0
UNION ALL
-- (1c) BQMS giá vốn NCC (RMB → VND qua fn_to_vnd)
SELECT 'bqms','cost_ncc', bqms_code, bqms_code, specification,
       supplier_name,'supplier', obs_date,'RMB',
       purchase_price_rmb, fn_to_vnd(purchase_price_rmb,'RMB',obs_date), expected_qty, id,'bqms_rfq'
  FROM bqms_dedup WHERE purchase_price_rmb > 0
UNION ALL
-- (2) Sourcing giá bán đã chốt (VND)
SELECT 'sourcing','sale_sourcing', bqms_code, bqms_code, product_name,
       customer_name,'customer', inquiry_date,'VND',
       sale_vnd, sale_vnd, quantity, id,'sourcing_entries'
  FROM sourcing_entries
 WHERE deleted_at IS NULL AND sale_vnd > 0 AND bqms_code IS NOT NULL
UNION ALL
-- (2b) Sourcing giá vốn NCC (VND)
SELECT 'sourcing','cost_ncc', bqms_code, bqms_code, product_name,
       supplier_name,'supplier', inquiry_date,'VND',
       cost_vnd, cost_vnd, quantity, id,'sourcing_entries'
  FROM sourcing_entries
 WHERE deleted_at IS NULL AND cost_vnd > 0 AND bqms_code IS NOT NULL
UNION ALL
-- (3) XNK giá thị trường/đối thủ (VND)
SELECT 'xnk','market_xnk', bqms_code, bqms_code, item_name,
       seller_name,'competitor', COALESCE(rfq_date, quoted_date),'VND',
       price_vnd, price_vnd, quantity, id,'xnk_price_lookup'
  FROM xnk_price_lookup WHERE price_vnd > 0 AND bqms_code IS NOT NULL
UNION ALL
-- (4) IMV giá mua (kênh riêng theo item_code; bqms_code best-effort qua products.imv_code)
SELECT 'imv','imv_buy', o.item_code, p.bqms_code, o.product_name,
       o.customer_name,'customer', o.order_date, o.currency,
       o.unit_price,
       CASE WHEN UPPER(COALESCE(o.currency,'VND'))='VND' THEN o.unit_price
            ELSE fn_to_vnd(o.unit_price, o.currency, o.order_date) END,
       o.quantity, o.id,'imv_orders'
  FROM imv_orders o LEFT JOIN products p ON p.imv_code = o.item_code
 WHERE o.unit_price > 0;

-- ── VIEW SẠCH: L2 (price>0), L5 (recency), L4 (MAD per-mã), L6 (chuẩn hoá) ──
-- L1 dedup đã xử lý trong nhánh bqms. L7 (min-sample) áp ở tầng endpoint.
CREATE OR REPLACE VIEW v_price_observations_clean AS
WITH cfg AS (
    SELECT MAX(value) FILTER (WHERE key='mad_k')           AS mad_k,
           MAX(value) FILTER (WHERE key='recency_months')  AS recency_months,
           MAX(value) FILTER (WHERE key='enable_L4_outlier') AS en_l4,
           MAX(value) FILTER (WHERE key='enable_L5_recency') AS en_l5
      FROM price_intel_config
),
base AS (   -- L2 + L6
    -- px = CHỈ price_vnd (KHÔNG fallback price_goc): dòng thiếu tỷ giá (price_vnd NULL)
    -- bị loại khỏi thống kê med/MAD để tránh trộn magnitude ngoại tệ (RMB ~ chục) với
    -- VND (~ triệu) làm lệch median + outlier-detection per-mã. (finding review 02/07)
    SELECT o.*,
           UPPER(BTRIM(o.product_key)) AS product_key_canon,
           NULLIF(BTRIM(o.party_name),'') AS party_name_canon,
           o.price_vnd AS px
      FROM v_price_observations o
     WHERE o.price_goc > 0
       AND o.price_vnd IS NOT NULL
       AND o.price_vnd > 0
),
med AS (    -- median giá PER MÃ
    SELECT product_key_canon,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY px) AS med_px,
           COUNT(*) AS n_code
      FROM base GROUP BY product_key_canon
),
dev AS (    -- |x - median| per row
    SELECT b.*, m.med_px, m.n_code, ABS(b.px - m.med_px) AS absdev
      FROM base b JOIN med m USING (product_key_canon)
),
mad AS (    -- MAD = median các |x-median| PER MÃ
    SELECT product_key_canon,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY absdev) AS mad_px
      FROM dev GROUP BY product_key_canon
),
scored AS (
    SELECT d.*, mad.mad_px,
           CASE WHEN mad.mad_px > 0 THEN 0.6745 * d.absdev / mad.mad_px ELSE 0 END AS robust_z
      FROM dev d JOIN mad USING (product_key_canon)
),
labelled AS (
    SELECT s.*,
           CASE
             WHEN (SELECT en_l5 FROM cfg) = 1
                  AND s.obs_date < CURRENT_DATE - (((SELECT recency_months FROM cfg))::text || ' months')::interval
               THEN 'stale'
             WHEN (SELECT en_l4 FROM cfg) = 1 AND s.mad_px > 0
                  AND s.robust_z > (SELECT mad_k FROM cfg)
               THEN 'outlier_mad'
             ELSE NULL
           END AS dropped_reason
      FROM scored s
)
SELECT src, price_role, product_key, bqms_code, product_name, party_name, party_role,
       obs_date, currency_goc, price_goc, price_vnd, qty, ref_id, ref_table,
       product_key_canon, n_code, robust_z,
       GREATEST(0, 100 - CASE WHEN robust_z > 3 THEN LEAST(20,(robust_z*3)::int) ELSE 0 END) AS quality_score
  FROM labelled
 WHERE dropped_reason IS NULL;
