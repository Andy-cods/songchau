# PERF BASELINE — Song Chau ERP (W0-18)

> Chụp 2026-07-03 ~02:50 ICT. pg_stat_statements ĐÃ bật (v1.10) — **không cần restart Postgres** vì `shared_preload_libraries` đã preload sẵn. Số P95/top-query per-endpoint sẽ TÍCH LŨY 24–48h kể từ giờ (counter /metrics + pg_stat_statements reset khi restart). Đây là mốc gốc để so sánh SAU khi tối ưu (W2-09/W2-11/W3-14/W3-16).

## Cách tái tạo (chạy lại để đo)
- **P95 endpoint**: `docker exec sc-api curl -s localhost:8000/metrics | grep http_request_duration_seconds` (histogram bucket) — dựng P95 từ bucket.
- **Top query**: `docker exec sc-postgres psql -U scadmin -d songchau_erp -c "SELECT queryid, calls, mean_exec_time, total_exec_time, query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20"`.
- **RSS**: `docker stats --no-stream`. **Build**: đo `docker compose build` + `next build`. **Test**: `run_tests.sh` (Đợt 1).

## Trạng thái gốc (2026-07-03)
- **DB size**: 819 MB.
- **RSS/limit** (nhàn rỗi ~3h sáng): sc-api 589M/1G (CPU 11%), sc-worker 37M/2G, sc-scheduler 37M/1G, sc-postgres 796M/2G, sc-frontend 17M/512M. → dư tài nguyên lớn ở worker/scheduler; api dùng 589M là cao nhất.
- **Index**: bqms_rfq 26 index; bqms_vendor_portal_staging **5 index** (86.149 dòng) — *không phải "0 index" như bản Fable tưởng; W2-09 chỉ cần index composite cho DISTINCT ON còn thiếu, không phải từ đầu*.
- **12 bảng lớn nhất**:

| Bảng | Size | n_live_tup |
|---|---|---|
| onedrive_file_index | 201 MB | 78.256 |
| **audit_log** | **175 MB** | **2.039** ⚠️ |
| bqms_vendor_portal_staging | 102 MB | 86.149 |
| notifications | 84 MB | 188.802 ⚠️ |
| **xnk_price_lookup** | 58 MB | **0** ⚠️ |
| procrastinate_events | 27 MB | 209.760 |
| imv_consolidated | 27 MB | 0 |
| bqms_rfq | 23 MB | 3.256 |
| sourcing_entries | 20 MB | 13.798 |
| procrastinate_jobs | 14 MB | 68.864 |

## Perf Budget (mục tiêu v1.0.0 — đo lại cuối gate 14 ngày)
- P95 /bqms/rfq-table ≤ 800ms; list chính (sourcing/procurement/crm/dashboard) ≤ 500ms, P99 ≤ 1500ms.
- Trang /bqms load lần 2 (sau W2-11 cache ảnh): request ảnh 200 giảm ≥80%, tương tác ≤3s.
- sc-worker RSS ≤ 1.2G khi push batch; 0 orphan push/tuần.
- next build ≤5'; deploy.sh trọn gói ≤15'; run_tests.sh ≤10'.
- slow-request (>1s, main.py:121) < 1%/ngày suốt gate.

## ⚠️ Phát hiện vệ sinh dữ liệu (mới — khi chụp baseline, chưa trong roadmap)
1. **audit_log 175 MB / chỉ 2.039 dòng** → ~86 KB/dòng: hoặc payload JSON khổng lồ, hoặc **bloat dead-tuple cần VACUUM FULL**. Cần điều tra (có thể tiết kiệm ~150MB). → đưa vào Đợt 2 (data hygiene).
2. **xnk_price_lookup n_live_tup = 0** dù 58MB (memory nói ~35K dòng): **stats cũ → planner có thể chọn sai kế hoạch** (Seq Scan). Cần `ANALYZE xnk_price_lookup` (rẻ, an toàn). → làm sớm Đợt 2 (ảnh hưởng /market-prices, W3-14).
3. **notifications 188.802 dòng / 84MB** + procrastinate_events 209.760 + procrastinate_jobs 68.864 (3.123 failed, riêng `check_deadline_reminders` fail **2.218 lần** — task periodic lỗi liên tục cần điều tra): tích lũy lớn → cần **cron prune** (đã có task `prune_audit_logs` 02:00; mở rộng prune notifications/procrastinate cũ). → Đợt 2.

## TODO baseline (revisit)
- [ ] Sau 48h: chụp `pg_stat_statements` top-20 total_exec_time → chốt danh sách 5 target cho W3-14.
- [ ] Sau 48h: dựng P95 top-20 endpoint từ /metrics histogram (counter đã reset lúc deploy 03/07).
- [ ] Điều tra `check_deadline_reminders` fail 2.218 lần (task periodic hỏng).
