# ROADMAP HOÀN THIỆN 100% — Song Chau ERP (BẢN FINAL v2)

> **Sinh 2026-07-02 qua 2 vòng multi-agent:**
> **Vòng 1** — 12 Sonnet khảo sát code thật → Fable tổng hợp → Opus phản biện (NEEDS_FIX, 9 sửa) → verifier Opus xác nhận DAG sạch.
> **Vòng 2 (lệnh Thang: dead code = 0 + tối ưu hiệu suất)** — 6 Sonnet sweep dead-code/perf → Fable chốt bổ sung → Opus re-review với dữ liệu thật (NEEDS_FIX, 7 nhóm sửa đã áp: Fable nhầm bqms_sitemap, sót 4 router + 9 trang FE + nhóm hạ tầng OOM, index sai cột, perf budget mâu thuẫn cap RAM).
> Mục tiêu: đưa hệ từ **~60%** lên **đạt đủ 9 chiều Định nghĩa Hoàn thành**, đóng gói v1.0.0, ổn định ≥14 ngày — **không phải quay lại sửa thủ công nữa**.

## Định nghĩa Hoàn thành (9 chiều — chuẩn nghiệm thu)
1. **Chức năng** — mỗi module trọn vòng, không route chết, zero "chờ test tay".
2. **Kiểm thử** — test tự động API+E2E chạy & XANH; không còn bug Cao/Trung đã biết.
3. **Bảo mật** — RBAC kín; cổng NCC cô lập (giá nội bộ không rò); secrets; audit-log; maker-checker AWARD bật.
4. **Vận hành** — deploy 1-lệnh có gate; backup+restore ĐÃ TEST; giám sát/cảnh báo; vendor server live; M365 bật.
5. **Dữ liệu** — exchange_rates tự cập nhật; twin/orphan kiểm soát; migration sạch idempotent.
6. **Tài liệu** — hướng dẫn theo vai trò + runbook + kiến trúc/API/DB đủ để dev khác tiếp quản.
7. **Đóng gói** — release đánh version, .env mẫu, chạy máy trắng theo checklist; ổn định ≥2 tuần.
8. **Sạch code** — 0 dead code có bằng chứng: `scripts/dead_code_sweep.py` (quét 0-importer BE+FE, allowlist có ADR) chạy trong CI gate = **0 finding**; 0 router định nghĩa-mà-không-mount thiếu ADR; mọi lần gỡ = **commit riêng** `chore(dead-code): remove <file> — evidence: 0 importer`, khôi phục bằng `git revert` 1 lệnh; sau gỡ: `import app.main` OK + `next build` xanh + full suite xanh.
9. **Hiệu suất** — perf budget đo được, không claim chay: baseline P95/P99 (Prometheus /metrics có sẵn) + `pg_stat_statements` chụp **TRƯỚC** mọi tối ưu vào `PERF_BASELINE.md` kèm lệnh tái tạo; mọi thay đổi nhân danh "tối ưu" phải kèm số trước/sau đo cùng điều kiện — **không có số = không merge**; tối ưu không đạt ngưỡng → hoàn nguyên hoặc ghi "neutral, giữ vì lý do X".

---

## 1. Bảng điểm hiện trạng (12 cụm) — tổng thể **~60%**

| # | Cụm | % | Điểm nghẽn chính |
|---|---|---|---|
| 1 | Bảo mật / Test / Dữ liệu | **45** | 0 test chứng minh RBAC; cô lập vendor chỉ có comment; cookie chưa Secure; test_api tự-skip |
| 2 | Tài chính (AR/AP) | **55** | 2 API song song lệch nhau; auto-AR/AP OFF; thiếu đối soát; 0 test |
| 3 | Module phụ | **55** | 2 route chết cần CẮT; 4 module "in_progress"; notif/calendar-leave trùng |
| 4 | Vận hành / Hạ tầng | **58** | deploy.sh không build worker/scheduler; backup giả; vendor chưa live; M365 trống |
| 5 | Analytics / Trung tâm giá | **60** | price-intelligence vừa ship (chưa xác nhận migration prod); demand_forecast 500 (route chết); 0 test |
| 6 | BQMS báo giá | **62** | test chỉ phủ wizard cơ bản; "Báo giá silent click" treo; twin dựa convention |
| 7 | BQMS scraper/push | **62** | Dossier Part 2 selector chưa verify; orphan push OOM; 0 test |
| 8 | CRM | **62** | interaction_type 422; 0 test; fallback tỷ giá 25450 ngầm |
| 9 | IMV | **62** | scrape lỗi → rỗng fail-silent; 2 map stub; 0 test |
| 10 | HR / Năng suất | **62** | test parity KPI "được hứa nhưng không tồn tại"; task xem chéo; chưa trừ lễ (M42) |
| 11 | Nguồn cung | **68** | bug negative-cost bị test giả che; render N≥5 tràn dấu; import Excel treo |
| 12 | Đấu thầu NCC | **72** | tốt nhất hệ; nhưng maker-checker OFF; 118 ca e2e chưa chạy |

**Ba lỗ hổng kéo điểm (đúng chỗ khiến Thang phải tự sửa):** (1) Kiểm thử — 73 router/8 file test, phần lớn "verify tay"; (2) Vận hành — backup chưa từng test restore, deploy.sh bug tái diễn; (3) Bảo mật vận hành — maker-checker OFF, cookie chưa Secure, audit-log thiếu.

---

## 2. Thay đổi so với bản Fable (áp theo phản biện Opus — verdict NEEDS_FIX)

Reviewer bắt lỗi **thứ tự nghiêm trọng** trong bản Fable; đã sửa như sau:

| # | Vấn đề Opus bắt | Sửa đã áp |
|---|---|---|
| C1 | Bật maker-checker (đụng nghiệp vụ) xếp Đợt 0 — **trước khi có test** | Dời **W3-00** (maker-checker), depends test finance W1-05 + bidding W1-04 |
| C2 | Hợp nhất API tài chính (đụng tiền) xếp Đợt 0 — trước test + trước restore | Dời **W1-50**, đứng **sau** restore drill W1-00 + bắt buộc snapshot-diff |
| C3 | Restore drill xếp Đợt 2 — quá muộn so với refactor phá hoại | Kéo lên **W1-00** (đầu Đợt 1), trước mọi refactor dữ liệu |
| C4 | Gỡ fallback FX 25450 (Đợt 2) muộn hơn test khẳng định nó (Đợt 1) | Kéo phần gỡ code lên **W0-15** (Đợt 0); auto-fetch giữ Đợt 2 (W2-03) |
| C5 | **Thiếu** kiểm tra độ tin cậy Procrastinate scheduler (nhiều cron dựa vào) | Thêm **W0-14** |
| C6 | **Thiếu** audit idempotency migration (harness W1-01 giả định điều này) | Thêm **W0-13**, CHẶN W1-01 |
| C7 | **Thiếu** module đối soát AP/AR (không phát hiện lệch sau auto-AR/AP) | Thêm **W3-12** |
| C8 | **Thiếu** M42 trừ ngày lễ (KPI sai) | Thêm **W3-13** |
| C9 | **Thiếu** hardening magic-link cổng NCC (chỉ test cô lập dữ liệu) | Thêm **W2-07**, CHẶN vendor-live W2-05 |
| +A | Analytics: demand_forecast 500 route chết + migration prod chưa xác nhận | Gộp cắt vào **W0-09**; thêm verify **W0-12**; thêm test **W1-12** |
| +V | **(kiểm lần cuối Opus)** Đợt-3 định bật auto-AR/AP trước audit-log + đối soát | Sắp lại: **W3-07 (audit) + W3-12 (đối soát) đứng TRƯỚC W3-06 (auto-AR/AP)** |
| +B | **(vòng 2 re-review)** Fable nhầm bqms_sitemap (comment ≠ caller); sót 4 router + 9 trang FE + 3 dep + nhóm hạ tầng OOM (worker cap 512M!) + v_price_observations_clean; index W2-09 sai cột; perf budget RSS 1.5G mâu thuẫn cap | W0-16 +sitemap; thêm **W0-20** (RAM worker), **W2-12** (4 router), **W2-13** (9 trang), W2-09 sửa cột theo query thật, W3-14 +materialized view, budget RSS 1.2G/limit 1.5G |

Nguyên tắc xuyên suốt (Opus nhấn): **lưới an toàn trước refactor phá hoại; test trước thay đổi hành vi; mọi cơ chế bảo vệ phải được test bằng cách LÀM HỎNG THẬT ít nhất 1 lần.**

---

## 3. Lộ trình 5 đợt (đã sửa thứ tự) — ~54 hạng mục

### ĐỢT 0 — Vá bug an toàn + dựng tiền đề (không đụng nghiệp vụ tiền/thầu)
*Mục tiêu nghiệm thu: mọi bug Cao/Trung có evidence reproduce→fix→verify; route chết = 404; nền cho Đợt 1 sẵn sàng. Toàn bộ Sonnet/Haiku (rẻ), 1 số Opus cho việc khép-vòng.*

| ID | Việc | DoD | Effort | Model | Depends |
|---|---|---|---|---|---|
| W0-01 | Cookie refresh_token `Secure=True` + samesite (auth.py:62,134) | 3 | S | sonnet | — |
| W0-02 | deploy.sh rebuild đủ 4 service (api+frontend+worker+scheduler) | 4 | S | sonnet | — |
| W0-03 | CRM interaction_type 422 → nới Literal đủ 9 giá trị + CHECK DB | 1 | S | sonnet | — |
| W0-04 | Sourcing negative-cost: raise thay clamp + **viết lại test giả** (mutation check) | 2 | S | sonnet | — |
| W0-06 | Sửa nút backup admin UI gây hiểu lầm (dump bỏ data bảng lớn) | 4 | M | sonnet | — |
| W0-07 | Tự phục hồi orphan push (sc-worker OOM) — closed loop + retry-queue | 4 | M | opus | — |
| W0-09 | **CẮT route chết** (YAGNI): batch_operations, pwa_settings, **+ demand_forecast.py (500 dead)** | 1 | S | haiku | — |
| W0-10 | "Báo giá silent click" — *cần repro từ Thang trước*; không repro→đóng "không tái hiện" | 1 | S | sonnet | *(repro Thang)* |
| W0-11 | IMV: phân biệt lỗi-scrape vs grid-rỗng + alert fail-silent | 4 | M | sonnet | — |
| **W0-12** | **(mới)** Verify `price_intel_v1.sql` đã áp prod — nếu thiếu thì migration-first ngay | 4 | S | sonnet | — |
| **W0-13** | **(mới·Opus)** Audit + làm **idempotent** toàn bộ migrations — **CHẶN W1-01** | 5 | M | opus | — |
| **W0-14** | **(mới·Opus)** Verify/fix độ tin cậy Procrastinate scheduler (hoặc chuyển cron trọng yếu → OS-cron) | 4 | M | opus | — |
| **W0-15** | **(mới·Opus)** Gỡ hardcode FX fallback (24500 analytics_trends + 25450 deal_chain) → `rate_missing` flag/warning thay số giả | 5 | S | sonnet | — |
| **W0-16** | **(vòng 2)** Gỡ **5 module backend chết** verify 2 lớp: etl/excel_processor.py (20KB), services/file_browser_service.py (12.5KB), etl/bqms_deep_inspect.py (10KB), **etl/bqms_sitemap.py** (Fable phán keep SAI — 2 "caller" chỉ là comment nhắc file .md), core/pagination.py (chỉ tự nhắc trong docstring) + method `db_pool.get_connection()` 0-caller (bẫy leak). Mỗi file 1 commit riêng revert-được | 8 | S | haiku | — |
| **W0-17** | **(vòng 2)** Gỡ **15 file frontend chết** (~150KB, verify từng file 2 lớp cả vendor-portal): CreateDossierWizardModal 55KB (bị thay bởi 6-tab), SellerDetailDrawer 40KB, layout cũ sidebar/topbar/user-menu, theme-toggle (dark mode đã gỡ), module-readiness-banner, pareto-chart, toast-provider*, separator, price-lookup, date-range-picker, file-dropzone, shared/export-button (≠ analytics/ExportButton SỐNG), services/purchase-orders.ts + **3 dependency thừa** (@radix-ui tooltip/avatar/label). *toast-provider là nơi DUY NHẤT mount `<Toaster/>` sonner nhưng chưa từng được mount → ghi note commit, Thang verify toast còn hiện | 8 | S | sonnet | — |
| **W0-18** | **(vòng 2)** **Perf baseline TRƯỚC mọi tối ưu**: bật pg_stat_statements (restart Postgres cửa sổ thấp điểm, ghi runbook) + chụp P95/P99 top-20 endpoint từ /metrics + top-20 query theo total_exec_time + thời gian build/test + RSS worker → `PERF_BASELINE.md` kèm LỆNH tái tạo từng số | 9 | S | sonnet | — |
| **W0-19** | **(vòng 2)** `scripts/dead_code_sweep.py` chính thức (quét 2 lớp import-shaped + raw-string; allowlist YAML mỗi entry bắt buộc có ADR) — khai báo RÕ phạm vi: KHÔNG bắt router-mounted-0-caller (W2-12 lo) + trang Next.js (W2-13 lo). Tự chứng minh: thêm file orphan giả → exit 1 | 8 | S | sonnet | W0-16, W0-17 |
| **W0-20** | **(vòng 2·re-review)** **Fix cap RAM worker — nguyên nhân gốc OOM orphan-push**: docker-compose.prod.yml đang override procrastinate-worker 1G→**512M** (đúng service từng OOM!); khôi phục ≥1.5G + cân lại tổng memory container ≤6.5G/8GB VPS (hạ onlyoffice, xem lại postgres shared_buffers 1536M=75% cap 2G) — làm TRƯỚC khi chốt perf budget RSS worker | 4 | S | sonnet | — |
| **W0-21** | **(mới — phát hiện khi thiết kế E2E 03/07)** **BẢO MẬT: viewer rò giá nội bộ qua Ctrl+K** — price_lookup.py thiếu `allow_viewer=False` (trái chuẩn rbac.py:46-53): tài khoản xem-only đọc được purchase_price_rmb/vnd + quoted v1..v4 + đơn giá PO thắng. Fix 1 dòng/endpoint + verify bằng TC-HETHONG-075: viewer gọi → 403, admin → 200 | 3 | S | sonnet | — |

**Nghiệm thu chính (item trọng yếu):**
- **W0-02:** thêm VERSION_MARKER vào 1 task → `./deploy.sh` → `docker exec` worker grep thấy chuỗi mới; 3 service backend cùng CREATED sau deploy.
- **W0-04:** `pytest test_sourcing_pricing_engine.py` 5/5 xanh; **revert fix engine → test phải ĐỎ** (mutation).
- **W0-07:** `docker kill sc-worker` giữa push → ≤20' job hiện `failed` trên retry-queue + admin nhận notif; bấm re-push (idempotent) thành công.
- **W0-13:** chạy toàn bộ migrations 2 lần liên tiếp trên DB trắng → không lỗi (nếu không đạt, Đợt 1 harness sập).

---

### ĐỢT 1 — Móng test CI-safe + lưới an toàn dữ liệu *(gap lớn nhất)*
*Mục tiêu: từ 8 file test → suite CI-safe phủ 73 router; restore drill đã kiểm chứng; test đỏ = không deploy. Nghiệm thu: `scripts/run_tests.sh` xanh 2 lần liên tiếp trên VPS lẫn máy trắng, ≤10 phút.*

| ID | Việc | DoD | Effort | Model | Depends |
|---|---|---|---|---|---|
| **W1-00** | **(kéo lên)** Restore drill verify — TRƯỚC mọi refactor phá hoại | 4 | M | sonnet | — |
| W1-01 | Harness CI-safe (Postgres tạm tmpfs + migrations tự chạy + fixture 7 role, 1 lệnh) | 2 | L | opus | W0-13 |
| W1-02 | Ma trận RBAC 73 router × role (snapshot yaml, route mới chưa khai → FAIL). **Vai trò kép (vòng 2):** (a) snapshot = BẰNG CHỨNG gỡ route (route biến mất có chủ đích = diff được review, không chủ đích = FAIL) — W2-10/W2-12 dựa vào đây; (b) BẮT BUỘC phủ đủ **14 endpoint admin trong bqms.py không tìm thấy caller** (reset-data, po/confirm...) và assert role admin — rủi ro bảo mật lớn hơn dead-code; hỏi Thang endpoint nào còn gọi tay qua Postman → allowlist + ADR | 3 | L | opus | W1-01 |
| W1-03 | Test cô lập vendor: giá nội bộ KHÔNG rò `/api/vendor/*` (sentinel + mutation check) | 3 | M | opus | W1-01 |
| **W1-50** | **(dời từ W0-08)** Hợp nhất 2 API tài chính `/finance` vs `/finance-management` | 1 | M | sonnet | W1-00 |
| W1-04 | Tự động hoá ≥40 ca trọng yếu từ plan e2e 118 ca đấu thầu (traceable TC-IND) | 2 | XL | sonnet | W1-01, W1-03 |
| W1-05 | Test API finance (AP/AR/payment/invoice/aging, số kỳ vọng tính tay) | 2 | L | sonnet | W1-01, W1-50 |
| W1-06 | Test API CRM + deal_chain (khoá bug 422; assert `rate_missing` thay 25450) | 2 | M | sonnet | W1-01, W0-03, W0-15 |
| W1-07 | Test HR: leave race (2-txn), **test_aggregator_view_parity ĐÚNG TÊN**, attendance | 2 | M | sonnet | W1-01 |
| W1-08 | Test IMV: parser XML fixtures + upsert idempotent + import notes=None | 2 | M | sonnet | W1-01 |
| W1-09 | Mở rộng e2e BQMS: generate-round, won, dossier-prefill golden, push **dry-run mock** | 2 | L | sonnet | W1-01 |
| W1-10 | Test module secondary giữ lại (inventory/shipments/workflows/orders) **+ documents/ocr/onlyoffice/calendar/dashboard/notifications** *(mở rộng theo Opus)* | 2 | M | sonnet | W1-01, W0-09 |
| **W1-12** | **(mới·Analytics)** Test analytics + chạy tập tự-động-hoá-được của 122-ca price-intel; **sửa claim bảo mật sai** trong E2E_TEST_PLAN.md | 2 | M | sonnet | W1-01 |
| W1-11 | CI gate: `run_tests.sh` chạy trong deploy.sh TRƯỚC build; đỏ = dừng. **Bổ sung (vòng 2):** thứ tự gate = `dead_code_sweep.py` (finding ngoài allowlist = ĐỎ) → `tsc --noEmit` (sau khi W3-15 xong) → `run_tests.sh` → build | 2 | S | sonnet | W1-01 |

**Nghiệm thu chính:** W1-01 chạy 2 lần liên tiếp xanh không side-effect · W1-02 route mới chưa khai quyền → test tự FAIL · W1-03 thêm `target_price` vào SELECT vendor → suite ĐỎ · W1-50 snapshot JSON ar/ap 2 API **khớp trước khi merge** (lệch → root-cause trước) · W1-05 aging 3 hoá đơn 15/45/95 ngày → bucket đúng số viết sẵn.

---

### ĐỢT 2 — Hardening vận hành + refactor an toàn (đã có lưới đỡ)
*Mục tiêu DoD #4+#5: backup ĐÃ TEST restore + cron tự cài, FX auto, M365, vendor server live, alert 1 kênh, dedup twin chuẩn hoá. Nghiệm thu: drill PASS + alert giả lập ≤5' + vendor login qua domain https.*

| ID | Việc | DoD | Effort | Model | Depends |
|---|---|---|---|---|---|
| W2-02 | Cron installer idempotent (backup 02:00 + health 5' + drill CN 03:00, retention 14+4) | 4 | S | sonnet | W1-00 |
| W2-03 | Exchange_rates **auto-fetch** hằng ngày (Vietcombank XML), manual vẫn ưu tiên nếu mới hơn | 5 | M | sonnet | W0-15 |
| W2-06 | Alerting hợp nhất 1 kênh: job-stuck>30', sync freshness<36h, SSL≤14 ngày, disk≥85%, restart-loop | 4 | M | sonnet | W2-02 |
| **W2-07** | **(mới·Opus)** Hardening + test magic-link cổng NCC (entropy/expiry/one-time/replay) — **CHẶN W2-05** | 3 | M | opus | W1-03 |
| W2-08 | *(dời từ W3-11)* Chuẩn hoá dedup twin BQMS → VIEW `v_bqms_rfq_dedup` + guard CI. **Lưu ý perf (vòng 2·re-review):** CTE dedup của /rfq-table chạy **4 lần/1 request** — VIEW thường KHÔNG giải quyết perf (re-run mỗi SELECT); VIEW ở đây lo TÍNH ĐÚNG; nếu pg_stat_statements (W0-18) xác nhận nóng → W3-14 quyết materialized/bảng vật lý + trigger, dựa EXPLAIN thật | 5 | M | sonnet | W1-01, W1-09 |
| **W2-09** | **(vòng 2, SỬA CỘT theo re-review)** Bộ index quick-win an toàn (behavior_change=false, CONCURRENTLY ngoài giờ, EXPLAIN trước/sau vào PERF_BASELINE.md): bảng nóng nhất `bqms_vendor_portal_staging` (37 query, **0 index/362 toàn hệ**) — index theo **query thật** bqms.py:989 `(module, rfq_number, id DESC)` cho DISTINCT ON + `(module, rfq_number)` cho EXISTS (bản Fable `(rfq_number,bqms_code,scraped_at)` SAI cột, planner sẽ bỏ). **Lưu ý:** bảng này KHÔNG có CREATE TABLE trong migration nào (ngoài version control!) → gộp fix vào W0-13. + partial index `bqms_rfq.push_status_v2` (poll 3s đang seq-scan) + trigram GIN sourcing_entries (7) + xnk_price_lookup (4) + notif (recipient, created) | 9 | M | sonnet | W0-18, W0-13 |
| **W2-10** | **(vòng 2)** Gỡ likely_dead SAU verify + có lưới W1-02: public_bid.py 26.7KB (unmount có chủ đích 18/06, cần Thang xác nhận bỏ hẳn → DECISIONS.md), core/procrastinate_schema.py (đối chiếu kết luận W0-14 — nếu bootstrap dùng nó thì ALIVE), 3 component file-browser (Preview/Toolbar/Breadcrumb — verify trang tự implement). git tag pre-dead-code trước khi xoá; RBAC snapshot không đổi; full suite + next build xanh | 8 | S | sonnet | W1-02, W0-14, W0-19 |
| **W2-11** | **(vòng 2)** Cache header chọn lọc cho ảnh BQMS/thumbnail: main.py:269 đang `no-store` TOÀN CỤC → trang /bqms tải lại toàn bộ ảnh mỗi lần vào. Endpoint ảnh → `private, max-age=86400` + ETag (đổi ảnh pinned → hiện ≤1'); endpoint JSON GIỮ no-store (assert bằng test); 403 vẫn 403 (không rò ảnh giữa user). Reload lần 2: request ảnh 200 giảm ≥80% | 9 | S | sonnet | W0-18 |
| **W2-12** | **(vòng 2·re-review, Fable sót)** Xử lý 4 router mồ côi: **forecast.py** — gỡ include_router `/forecast` khỏi `__init__.py` nhưng GIỮ file (analytics_exports.py import hàm nội bộ) + ADR; **excel_export.py / sales_orders.py / customs.py** — hỏi Thang (còn gọi tay?) → bỏ: gỡ router+file có RBAC-snapshot làm chứng; giữ excel_export: BẮT BUỘC bọc build-Excel-50k-dòng vào `asyncio.to_thread` (đang chặn event loop — finding high). Nghiệm thu: OpenAPI sạch tag, 404 đúng chỗ, analytics_exports vẫn import OK | 1 | S | sonnet | W1-02 *(+xác nhận Thang)* |
| **W2-13** | **(vòng 2·re-review, Fable sót)** Xử lý **9 trang FE mồ côi** (0 nav + 0 Link/router.push, đã grep xác nhận đảo cô lập): bqms/folder/[rfq], bqms/classify, chains + chains/[code], documents (gốc), orders/unified, reports/scheduled → xoá hoặc redirect-stub (như forecast/xnk) **tuỳ Thang chọn từng trang**; riêng **finance/cash-book + finance/payables** xử CÙNG W1-50 (trùng chức năng finance/overview — giữ 1 chỗ). Mỗi trang re-verify template-literal href trước khi đụng | 1 | M | sonnet | W1-50 *(+Thang chọn)* |
| W2-04 | **[CHẶN BỞI THANG]** Bật M365 (OneDrive sync + email HĐ + logo) — cấp 4 biến | 4 | M | sonnet | *(creds Thang)* |
| W2-05 | **[CHẶN BỞI THANG]** Vendor server 45.124.95.32 LIVE: cờ `SC_ROLE=vendor` + deploy + domain + TLS | 4 | L | opus | W1-03, W2-07 *(domain Thang)* |

**Nghiệm thu chính:** W1-00/W2-02 làm hỏng file backup giả → drill FAIL + alert đến · W2-03 sau 1 ngày prod có row `source='auto'` hôm nay · W2-05 `SC_ROLE=vendor` local → `/api/v1/bqms/rfq-table` = 404, `/api/vendor/*` OK; test cô lập W1-03 chạy CHỐNG server mới = pass.

---

### ĐỢT 3 — Bật hành vi nghiệp vụ (đã có test đỡ) + hoàn thiện chức năng
*Mục tiêu: 0 module "in_progress"; 0 TODO thật; auto-AR/AP bật có lưới đỡ; audit-log phủ finance/CRM. Nghiệm thu: module-readiness.ts sạch; grep TODO thật = 0.*

| ID | Việc | DoD | Effort | Model | Depends |
|---|---|---|---|---|---|
| **W3-00** | **(dời từ W0-05)** BẬT maker-checker AWARD prod (threshold Thang) — SAU test | 3 | S | sonnet | W1-04, W1-05 *(threshold Thang)* |
| W3-07 | Audit-log append-only (immutable trigger) cho mutation finance + CRM — **trước khi bật auto-AR/AP** | 3 | M | sonnet | W1-50, W1-05 |
| W3-12 | **(mới·Opus)** Module/endpoint **đối soát AP/AR** — lưới phát hiện lệch, đặt **trước** auto-AR/AP | 1 | M | sonnet | W1-05 |
| W3-06 | Bật auto-AR + auto-AP prod (hook lỗi phải notify, không nuốt) — **sau** audit-log + đối soát | 1 | M | sonnet | W3-00, W3-07, W3-12, W1-05 |
| W3-01 | Verify thật Dossier Part 2 (popup Samsung) + xoá TODO selector | 1 | L | opus | W0-07 |
| W3-02 | IMV contracts/rejections: guard-on-data (alert khi có row) thay hoàn thiện (YAGNI) | 5 | S | haiku | W0-11 |
| W3-04 | Fix render báo giá N≥5 dòng: dấu/chữ ký tràn trang 2 (golden PDF) | 1 | S | sonnet | — |
| W3-05 | Chốt Xếp hạng NCC (prev_rank) — đóng trạng thái BUILDING | 1 | M | sonnet | W1-03 |
| W3-08 | Đóng 4 module "in_progress" + gỡ trùng calendar-leave (chỉ HR M41 ghi) + ranh giới 2 hệ notif | 1 | L | sonnet | W0-09 |
| W3-10 | Siết RBAC task_assignments: staff chỉ thấy task liên quan mình | 3 | S | sonnet | W1-02 |
| **W3-13** | **(mới·Opus)** M42: trừ ngày lễ khỏi workdays_present (KPI đúng) | 1 | S | sonnet | — |
| **W3-14** | **(vòng 2)** Tối ưu **top-5 query/endpoint theo SỐ pg_stat_statements** (không đoán): danh sách chốt từ baseline W0-18 ghi vào PERF_BASELINE.md TRƯỚC khi code. Nghi phạm từ sweep: dedup CTE /rfq-table chạy 4×/request (fold còn 1), **`v_price_observations_clean` VIEW tính median/MAD trên UNION 4 nguồn MỖI query → materialized + refresh** (finding high Fable sót), procurement matrix, dashboard aggregate, crm page_size=1000. Mỗi target: P95 −40% HOẶC ghi "không đáng tối ưu vì X" kèm số; snapshot JSON trước/sau bằng nhau từng byte; mutation check; KHÔNG thêm lib mới (cache = phương án cuối) | 9 | L | opus | W0-18, W1-01, W1-04, W1-05, W1-06, W1-09, W2-09 |
| **W3-15** | **(vòng 2)** TypeScript 0 lỗi + gỡ `ignoreBuildErrors:true` khỏi next.config.js (type error đang bị NUỐT khi build — trái lệnh "không sửa lại tiny issue"). Bước 1: `tsc --noEmit` đếm lỗi (nếu >200 → báo Thang chốt scope); kết thúc: 0 error, flag gỡ, CI gate thêm bước tsc; CẤM đạt-0 bằng @ts-ignore (grep đếm trước/sau không tăng); eslint.ignoreDuringBuilds để sau v1.0.0 (không ôm 2 việc) | 8 | M | sonnet | W1-11 |
| **W3-16** | **(vòng 2·re-review, Fable sót)** Code-splitting FE: **0 chỗ dùng next/dynamic toàn hệ** — recharts (16 file) + modal/wizard nặng đang eager-bundle. Dynamic-import recharts wrappers + top-5 modal nặng nhất; đo first-load JS từng trang trước/sau (next build output): trang analytics giảm ≥20% hoặc ghi neutral trung thực | 9 | M | sonnet | W1-11 |
| W3-03 | **[CHẶN BỞI THANG]** Sourcing import Excel (C) — cần file mẫu khách | 1 | M | sonnet | *(file Thang)* |
| W3-09 | Nối email thật smart-notifications (sau M365) HOẶC ẩn option | 1 | S | sonnet | W2-04 |

**Nghiệm thu chính:** W3-00 A propose→A tự approve **403**→B approve OK + audit row · W3-06 1 tuần đầu accountant đối chiếu tay lệch=0; hook lỗi → notif + retry được · W3-01 giờ thấp điểm, `--dry-run` trước, giữ session-lock; không an toàn → hạ "manual-assisted" ghi rõ UI · W3-07 psql thử UPDATE audit_log → ERROR.

---

### ĐỢT 4 — Tài liệu + đóng gói v1.0.0 + gate ổn định 14 ngày
*Mục tiêu DoD #6+#7. Nghiệm thu: người ngoài làm theo runbook xử được sự cố; chạy máy trắng ≤60'; 14 ngày 0 sự cố P1 → Thang ký nghiệm thu.*

| ID | Việc | DoD | Effort | Model | Depends |
|---|---|---|---|---|---|
| W4-01 | RUNBOOK.md (deploy/rollback, backup/restore, xoay creds Samsung, orphan push, IMV fail, SSL, disk, OOM) | 6 | M | sonnet | W1-00, W2-06, W0-07 |
| W4-02 | ARCHITECTURE.md + API.md (từ OpenAPI) + DB.md + RBAC_MATRIX.md (sinh từ yaml test) | 6 | L | sonnet | W1-02 |
| W4-03 | 6 hướng dẫn theo vai trò (sales/procurement/accountant/manager/admin/vendor) | 6 | M | sonnet | — |
| W4-04 | `.env.example` đầy đủ + kiểm kê secrets + fail-fast khi thiếu biến | 7 | S | sonnet | — |
| W4-05 | Release v1.0.0: tag + CHANGELOG + version ở /health & footer + **INSTALL.md kiểm chứng máy trắng ≤60'**. **Bổ sung (vòng 2):** CHANGELOG có mục "Performance" (bảng trước/sau từ PERF_BASELINE.md) + "Dead code removed" (tổng KB/file + commit hash) — thiếu 2 mục = chưa đạt chiều 8+9 | 7 | M | sonnet | W4-04, W1-11 |
| W4-06 | Gate ổn định 14 ngày (0 P1, ≤2 P2 đã fix + test chống tái diễn) → **báo cáo 9 CHIỀU**, Thang ký. **Bổ sung (vòng 2):** ngày cuối gate: dead_code_sweep = 0 finding (allowlist chỉ còn entry có ADR) + toàn bộ Perf Budget đo lại = ĐẠT | 7 | M | sonnet | W4-05 |

---

## 4. Việc CHỜ THANG (cung cấp / quyết định — tách riêng, không nghẽn critical path)
**Cung cấp:**
1. **M365** (W2-04): tạo app registration + cấp 4 biến `M365_TENANT_ID/CLIENT_ID/CLIENT_SECRET` → bật OneDrive sync + email HĐ + logo.
2. **Domain** (W2-05): trỏ A record → 45.124.95.32 để vendor server lên https.
3. **File Excel mẫu khách** (W3-03): để làm parser import nguồn cung theo cột thật.
4. **Threshold maker-checker** (W3-00): chốt ngưỡng VNĐ + ai được duyệt.

**Quyết định (từ vòng 2 — trả lời khi tới Đợt tương ứng, mỗi câu 1 dòng):**
5. (W2-12) `excel_export.py` / `sales_orders.py` / `customs.py` — anh còn gọi tay qua Postman không, hay bỏ hẳn?
6. (W1-02) 14 endpoint admin trong bqms.py (reset-data, po/confirm...) — cái nào anh còn dùng tay → allowlist, còn lại siết.
7. (W2-13) 9 trang FE mồ côi — từng trang: xoá hẳn hay để redirect-stub? (riêng cash-book/payables quyết cùng W1-50).
8. (W2-10) `public_bid.py` (magic-link public cũ, đã unmount 18/06) — xác nhận bỏ hẳn?
9. (W0-17) Sau khi gỡ toast-provider: anh bấm 1 hành động có toast (vd lưu nguồn cung) xem thông báo còn hiện — nghi vấn Toaster chưa từng được mount (bug tiềm ẩn có sẵn, độc lập việc gỡ).

*Nếu quá hạn → đóng tạm bằng phương án degrade ghi rõ; các item này KHÔNG chặn phần còn lại.*

---

## 5. Rủi ro & giảm thiểu (từ Fable, đã lọc qua Opus)
- **Samsung/IMV đổi UI/credential giữa chừng** (đã xảy ra 22/06) → interlock test-login 24h + freshness alert (W0-11/W2-06); W3-01 chạy `--dry-run` giờ thấp điểm, có đường lui manual-assisted.
- **Bật maker-checker + auto-AR/AP đổi hành vi thật** → thứ tự bắt buộc test finance (W1-05) → maker-checker (W3-00) → auto-AR/AP (W3-06) + 1 tuần đối chiếu tay lệch=0; break-glass + flag tắt nhanh làm van xả.
- **Refactor trên hệ LIVE (finance merge W1-50, dedup VIEW W2-08)** → snapshot-compare bắt buộc trước/sau + restore drill (W1-00) đã kiểm chứng làm đường lui + deploy từng phần rollback rõ.
- **Test làm ẩu sinh test giả** (đã xảy ra sourcing) → mọi test qua mutation check (phá code → test phải đỏ); reviewer thứ 2 duyệt phần assert.
- **Hệ "mục" dần khi ngừng thuê agent** → mọi kiểm tra đưa vào máy: CI gate trong deploy.sh, cron drill/health/FX tự chạy, alert về email Thang; runbook copy-paste-được; gate 14 ngày chứng minh tự-vận-hành trước khi ký.

---

## 6. Checklist đóng gói v1.0.0
- [ ] Git tag v1.0.0 + CHANGELOG; version ở /health & footer admin.
- [ ] `.env.example` đầy đủ mọi biến (JWT/DB/Redis/M365×4/SC_ROLE/GOTENBERG/BQMS+IMV creds/feature flags); `.env` trong .gitignore; grep repo 0 secret hardcode.
- [ ] `./scripts/deploy.sh` 1-lệnh: test (đỏ=dừng) → backup → build đủ 4 service → health-check → rollback tự động.
- [ ] Backup cron pg_dump 02:00 (14+4 bản) + restore drill CN 03:00 vào Postgres tạm, PASS/FAIL alert — cài bằng `install_cron.sh` idempotent.
- [ ] Chạy máy trắng theo `INSTALL.md` → login ≤60'; migrations chạy 2 lần không lỗi.
- [ ] `run_tests.sh` xanh trên VPS lẫn máy trắng (harness Postgres tạm).
- [ ] Vendor server 45.124.95.32 live qua domain https, `SC_ROLE=vendor` (route nội bộ 404), test cô lập giá pass chống server này.
- [ ] Giám sát: health_monitor cron 5' alert 1 kênh; `go_live_checklist.sh` 12/12 PASS.
- [ ] docs/: RUNBOOK, ARCHITECTURE, API, DB, RBAC_MATRIX, DECISIONS, 6 guide, INSTALL.
- [ ] Bảo mật chốt: maker-checker bật (threshold trong DECISIONS), cookie Secure, audit-log immutable phủ bidding+finance+CRM, 0 route chết.
- [ ] **Sạch code (chiều 8):** dead_code_sweep.py trong CI = 0 finding; allowlist chỉ còn entry có ADR; CHANGELOG mục "Dead code removed" (tổng ~200KB+ BE/FE, commit hash revert-được).
- [ ] **Hiệu suất (chiều 9):** PERF_BASELINE.md có trước/sau; toàn bộ Perf Budget (mục 6b) ĐẠT ngày cuối gate; tsc 0 lỗi, ignoreBuildErrors đã gỡ.
- [ ] Gate 14 ngày: 0 P1, ≤2 P2 đã fix — báo cáo **9 chiều DoD**, Thang ký.

---

## 6b. PERF BUDGET v1.0.0 (chiều 9 — đã sửa mâu thuẫn theo re-review)
| # | Chỉ tiêu | Ngưỡng |
|---|---|---|
| 1 | P95 GET /api/v1/bqms/rfq-table | ≤ 800ms *(aspirational — phụ thuộc giải dedup-4×; có escape-clause đối chiếu baseline)* |
| 2 | P95 GET list chính (sourcing/procurement-matrix/crm/dashboard) | ≤ 500ms; P99 ≤ 1500ms |
| 3 | Request log `request_complete_slow` (>1s, main.py:121 có sẵn) | < 1%/ngày suốt 14 ngày gate |
| 4 | pg_stat_statements ngày cuối gate | 0 query >5% total_exec_time chưa được review trong W3-14 |
| 5 | Trang /bqms load lần 2 (sau W2-11) | request ảnh 200 giảm ≥80%; tương tác ≤3s (DevTools, trung vị 3 lần) |
| 6 | sc-worker **(SỬA — bản Fable mâu thuẫn cap 512M)** | sau W0-20 nâng limit lên 1.5G: RSS peak ≤ **1.2G** (dưới limit) trong 1 push batch; 0 orphan push/tuần suốt gate |
| 7 | Build & deploy | next build ≤5'; deploy.sh trọn gói ≤15'; run_tests.sh ≤10' |
| 8 | Backup/restore | pg_dump đêm ≤10'; restore drill ≤30' (chỉnh theo số thật W1-00) |
| — | **Quy tắc** | mọi số đo bằng lệnh ghi trong PERF_BASELINE.md, cùng điều kiện trước/sau; miss ngày cuối gate = chưa ký chiều 9 |

## 6c. TỪ CHỐI CÓ LÝ DO (không làm — chống tối ưu cảm tính)
- **GZipMiddleware app-level** — nginx ĐÃ gzip application/json (conf:57-60); thêm = nén 2 lần tốn CPU.
- **Gỡ/tách framer-motion** — UX chủ đích Thang đã duyệt; vài chục KB không bõ rủi ro regression 13 trang LIVE.
- **Dynamic-import html2canvas** — ĐÃ có sẵn (analytics/ExportButton.tsx:85).
- **Tăng DB pool 5/20** — 0 bằng chứng nghẽn; chờ baseline W0-18 nói chuyện.
- **Redis cache cho API list** — dao 2 lưỡi stale-data (tiền lệ bug chunk-cache 15/06); chỉ là phương án cuối trong W3-14.
- **Tách bqms.py 365KB / procurement.py 307KB** — thẩm mỹ, KHÔNG tăng tốc runtime, rủi ro rất cao trên 2 module nóng nhất; nếu muốn → epic riêng SAU v1.0.0.
- **vendor rank.py trả 404 khi flag OFF** — feature flag chủ đích (#15 band-mờ), KHÔNG phải dead code → allowlist + ADR.
- **eslint.ignoreDuringBuilds** — style-level, tách khỏi W3-15 để không phình scope; sau v1.0.0 nếu Thang muốn.
- **revenue_tasks.py** — GIỮ: manual-trigger workaround còn lý do tồn tại (gắn kết luận W0-14; scheduler tin cậy rồi mới tính gỡ).

## 7. Model để implement (Fable CHỈ dùng cho nghĩ — Đợt 1 này)
- **Haiku**: cắt route chết, guard YAGNI (W0-09, W3-02).
- **Sonnet**: phần lớn (vá bug, test, docs, hardening) — rẻ, đủ mạnh.
- **Opus**: việc khép-vòng/nhạy cảm (W0-07 orphan self-heal, W0-13 idempotency, W0-14 scheduler, W1-01/02/03 harness+RBAC+cô lập, W2-05/W2-07 vendor+magic-link, W3-01 Dossier Samsung).

---
*Nguồn: `scratchpad/roadmap.json` (Fable) + `scratchpad/review.json` (Opus) + recon 12 cụm. Bản này là kết quả Đợt 1 để Thang duyệt trước khi thực thi Đợt 0.*
