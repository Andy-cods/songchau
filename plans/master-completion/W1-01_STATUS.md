# W1-01 Harness — trạng thái (2026-07-03)

## ✅ HOÀN TẤT — 41 passed, harness chạy thật, blocker event-loop ĐÃ FIX
Fix: **bỏ session-scoped `event_loop` fixture + đổi `schema_info` sang function-scope** → pytest-asyncio quản lý 1 loop/test cho mọi fixture+test+app → hết lỗi asyncpg "different loop". Kết quả: **41 passed / 4 failed** — 7/7 smoke PASS (health, list users, RBAC, W0-21 viewer→403, admin qua gate). 4 fail còn lại = 2 BUG THẬT (sourcing golden + workflow transitions, xem cuối file), KHÔNG phải harness.
Deliverable chạy được: **`backend/scripts/run_tests_ci.sh`** (chạy trên máy có Docker vd prod host, cô lập tuyệt đối). `_schema_snapshot.sql` đã lưu.

---
## (Lịch sử) Kết luận ban đầu: CƠ CHẾ ĐÃ CHỨNG MINH CHẠY, còn 1 blocker thiết kế (event-loop)

Harness được **chạy thật** trên prod host trong network cô lập tuyệt đối (prod DB không với tới — verify `PROD_POSTGRES_UNREACHABLE`). Đã qua 6 vòng vá, mỗi vòng gỡ 1 lớp vấn đề thật.

### ✅ Đã hoạt động (bằng chứng chạy thật)
- Cô lập tuyệt đối khỏi prod (network riêng `sctest_net`, Postgres tạm tmpfs, teardown sạch).
- **34 unit test PASS** + **3/7 smoke PASS** — gồm chính: `test_users_requires_auth` (401), `test_staff_forbidden` (403), **`test_viewer_blocked_on_internal_price` (403 = khoá W0-21)**. → auth/JWT/RBAC-gate/ASGI-in-process đều đúng.
- **Schema prod nạp SẠCH 0 lỗi** (169 bảng) sau khi tìm ra công thức nạp đúng (dưới).

### 🔴 Blocker còn lại (1 việc thiết kế)
`app/core/rbac.py:89` (`await conn.fetchval` check password_version) ném:
`RuntimeError: got Future attached to a different loop` (asyncpg/protocol).
→ Nguyên nhân: **asyncpg connection + starlette `BaseHTTPMiddleware` + pytest-asyncio**. `db` connection tạo ở 1 event loop; `BaseHTTPMiddleware` chạy handler trong task anyio ở loop khác → asyncpg (bound-to-loop) nổ. 4 smoke test chạm DB (list_users, price-gate admin, viewer bypass, health) fail vì lý do này (KHÔNG phải bug app — app chạy tốt ở prod).
→ Đây là combo khó nổi tiếng. **Hướng fix** (chọn 1, cần thử cẩn thận): (a) init 1 asyncpg POOL trên đúng test loop + cô lập bằng TRUNCATE-giữa-test thay vì single-conn-rollback; (b) hoặc dùng ASGITransport bỏ qua BaseHTTPMiddleware layer trong test; (c) hoặc pytest-asyncio `loop_scope=session` nhất quán + tạo conn trên loop đó. → làm ở lượt W1-01-fix.

## Công thức NẠP SCHEMA đúng (đã validate — port vào run_tests.sh/CI)
Nạp pg_dump prod vào Postgres tạm KHÔNG dùng asyncpg.execute (mong manh) mà bằng psql, với:
1. `pg_dump --schema-only --no-owner --no-privileges` từ prod → `backend/tests/_schema_snapshot.sql` (đã lưu, 575KB).
2. Postgres tạm chạy với `-c shared_preload_libraries=pg_stat_statements`.
3. Pre-create extensions TRƯỚC: `unaccent, uuid-ossp, pg_trgm, pg_stat_statements, btree_gin`.
4. **Sửa search_path**: `sed s/set_config('search_path', '', false)/set_config('search_path', 'public', false)/` (pg_dump ép '' làm `unaccent()` không-qualify không resolve → hỏng ~5 bảng customers/inventory/suppliers).
5. `psql -f schema.sql` (psql xử lý backslash `\restrict` của pg_dump 16 mà asyncpg không hiểu).
6. conftest: `SCHEMA_PRELOADED=1` → skip re-load, chỉ dùng.

**Cách chạy đã validate** (chạy trên host có Docker, vd prod host, cô lập): `docker commit sc-api` → network riêng → Postgres tạm → 3 bước nạp trên → `docker run` pytest trong ảnh đó (`pip install pytest==8.2.2 pytest-asyncio==0.23.8`). Script mẫu: scratchpad/run_harness_prod.py.

## Đã sửa trong conftest.py (giữ lại — cải tiến thật)
- Lọc dòng backslash pg_dump 16 (`\restrict`) trước khi execute.
- `SCHEMA_PRELOADED=1` → dùng schema nạp-sẵn-bằng-psql.
- `HARNESS_RAISE=1` → bật raise_app_exceptions để debug traceback thật.

## 🐛 2 phát hiện THẬT harness vừa bắt (giá trị của việc dựng test)
1. **`test_sourcing_pricing_engine`**: golden S kỳ vọng 4.399.740 nhưng engine ra 4.868.700 (domestic) + import scenario lệch. → test cũ/bug engine, cần điều tra ở W1 (sourcing test).
2. **`test_workflow`**: `TRANSITIONS[(PENDING_L1, APPROVE)] = None` (kỳ vọng APPROVED) + thiếu ESCALATE. → **khớp bug "workflows engine hỏng" từ thiết kế E2E (INDEX #2)**. Workflow state machine thiếu transition.

## Việc còn của Đợt 1 (chưa làm)
W1-01-fix (event-loop) → W1-02 RBAC matrix → W1-03 cô lập vendor → W1-00 restore drill → W1-50 hợp nhất finance (+bug dashboard AP/AR=0) → W1-04..12 module tests (dùng harness) → W1-11 CI gate. Ước tính nhiều giờ.
