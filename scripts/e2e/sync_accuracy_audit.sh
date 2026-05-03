#!/bin/bash
# Sync accuracy audit — runs all 14+ integrity checks via psql.
# Used by bqms_exhaustive.py via SSH.

PSQL="docker exec sc-postgres psql -U scadmin -d songchau_erp -t -A -F| -c"

echo "=== sync_accuracy_audit ==="
declare -A QUERIES=(
  [01_total_rfq]="SELECT COUNT(*) FROM bqms_rfq"
  [02_total_po]="SELECT COUNT(*) FROM bqms_samsung_po"
  [03_total_delivery]="SELECT COUNT(*) FROM bqms_deliveries"
  [04_total_quote_log]="SELECT COUNT(*) FROM bqms_quote_log"
  [05_total_contacts]="SELECT COUNT(*) FROM bqms_contacts WHERE is_active=true"

  [10_po_orphan_no_rfq]="SELECT COUNT(*) FROM bqms_samsung_po WHERE rfq_id IS NULL"
  [11_po_with_rfq_pct]="SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE rfq_id IS NOT NULL) / NULLIF(COUNT(*), 0), 1) FROM bqms_samsung_po"

  [20_delivery_orphan_no_po]="SELECT COUNT(*) FROM bqms_deliveries WHERE samsung_po_id IS NULL"
  [21_delivery_with_po_pct]="SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE samsung_po_id IS NOT NULL) / NULLIF(COUNT(*), 0), 1) FROM bqms_deliveries"

  [30_dup_po_numbers]="SELECT COUNT(*) FROM (SELECT po_number FROM bqms_samsung_po GROUP BY 1 HAVING COUNT(*) > 1) t"
  [31_dup_delivery_keys]="SELECT COUNT(*) FROM (SELECT po_number, bqms_code FROM bqms_deliveries GROUP BY 1,2 HAVING COUNT(*) > 1) t"

  [40_po_amount_zero]="SELECT COUNT(*) FROM bqms_samsung_po WHERE amount=0 OR amount IS NULL"
  [41_po_amount_zero_pct]="SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE amount=0 OR amount IS NULL) / NULLIF(COUNT(*), 0), 1) FROM bqms_samsung_po"

  [50_rfq_with_v1]="SELECT COUNT(*) FROM bqms_rfq WHERE quoted_price_bqms_v1 IS NOT NULL"
  [51_rfq_with_v2]="SELECT COUNT(*) FROM bqms_rfq WHERE quoted_price_bqms_v2 IS NOT NULL"
  [52_rfq_with_v3]="SELECT COUNT(*) FROM bqms_rfq WHERE quoted_price_bqms_v3 IS NOT NULL"
  [53_rfq_with_item_type]="SELECT COUNT(*) FROM bqms_rfq WHERE item_type IS NOT NULL"
  [54_rfq_won_pct]="SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE result='won') / NULLIF(COUNT(*) FILTER (WHERE result IN ('won','lost')), 0), 1) FROM bqms_rfq"

  [60_del_pending_old]="SELECT COUNT(*) FROM bqms_deliveries WHERE delivery_status='chua_giao' AND delivery_date < CURRENT_DATE - INTERVAL '30 days'"
  [61_del_in_transit_no_date]="SELECT COUNT(*) FROM bqms_deliveries WHERE delivery_status='dang_giao' AND actual_delivered_at IS NULL"
  [62_del_done_no_date]="SELECT COUNT(*) FROM bqms_deliveries WHERE delivery_status IN ('da_giao','hoan_tat') AND actual_delivered_at IS NULL"

  [70_last_bqms_sync_hours]="SELECT ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(completed_at))) / 3600, 1) FROM etl_sync_log WHERE sync_type='bqms_po' AND status='success'"
  [71_last_local_index_min]="SELECT ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(completed_at))) / 60, 1) FROM etl_sync_log WHERE sync_type='local_filesystem_index' AND status='success'"
  [72_last_imv_sync_hours]="SELECT ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(started_at))) / 3600, 1) FROM imv_sync_log WHERE status='success'"

  [80_rfq_modified_30d]="SELECT COUNT(*) FROM bqms_rfq WHERE updated_at > NOW() - INTERVAL '30 days'"
  [81_po_modified_30d]="SELECT COUNT(*) FROM bqms_samsung_po WHERE updated_at > NOW() - INTERVAL '30 days'"
  [82_del_modified_30d]="SELECT COUNT(*) FROM bqms_deliveries WHERE updated_at > NOW() - INTERVAL '30 days'"
)

# Sort keys for stable output
keys=$(echo "${!QUERIES[@]}" | tr ' ' '\n' | sort)
for key in $keys; do
  q="${QUERIES[$key]}"
  result=$(eval $PSQL "\"$q;\"" 2>&1 | tr -d ' ' | head -1)
  echo "${key}=${result}"
done

# Special: status breakdown
echo "=== delivery_status_breakdown ==="
docker exec sc-postgres psql -U scadmin -d songchau_erp -t -A -c "SELECT delivery_status, COUNT(*) FROM bqms_deliveries GROUP BY 1 ORDER BY 2 DESC"

echo "=== sync_log recent (5) ==="
docker exec sc-postgres psql -U scadmin -d songchau_erp -t -A -c "SELECT sync_type, status, started_at, completed_at FROM etl_sync_log ORDER BY started_at DESC LIMIT 5"

echo "=== rfq_year_breakdown ==="
docker exec sc-postgres psql -U scadmin -d songchau_erp -t -A -c "SELECT EXTRACT(YEAR FROM COALESCE(inquiry_date, effective_date, created_at::date))::int AS yr, COUNT(*) FROM bqms_rfq GROUP BY 1 ORDER BY 1 DESC"
