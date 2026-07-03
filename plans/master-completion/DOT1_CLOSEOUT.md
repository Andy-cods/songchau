# Đợt 1 — CLOSEOUT (Master Completion)

**Ngày:** 2026-07-03 · **Theo GOAL:** chạy hết Đợt 0 + Đợt 1 → DỪNG tổng kết báo Thang.
**Kết quả harness cuối:** `296 passed, 2 skipped, 0 failed` (chạy qua CỔNG chính thức `backend/scripts/run_tests_ci.sh`, cô lập tuyệt đối khỏi prod DB).

---

## 1. Đã LÀM (tất cả LIVE + verify)

### Lớp kiểm thử (test layer) — nền cho toàn Đợt 1
- Harness CI cô lập: commit image sc-api → Postgres tạm (tmpfs) trên network riêng → nạp `_schema_snapshot.sql` → pytest. Prod DB KHÔNG với tới.
- **296 test** trên 12+ nhóm: CRM, IMV, analytics, bidding, vendor-isolation, RBAC-matrix, HR, workflow, inventory, finance, sourcing, auth, secondary.

### Fable quyết định 5 việc (D1–D5) — Opus duyệt → `DECISIONS.md` — đã thi hành hết
| | Việc | Kết quả |
|---|---|---|
| D1 | WORKFLOW reconcile (code→schema prod) | LIVE — un-xfail PASS |
| D2 | INVENTORY reconcile + unique index | LIVE — un-xfail PASS |
| D3 | HR deploy m40/m41 (+ fix 2 bug migration) | LIVE |
| D4 | revenue_chain giữ THỦ CÔNG (an toàn) + sửa comment | Done |
| D5 | Closeout viewer/W0-10 + restore drill | Done |

### Bug THẬT lôi ra từ test layer + đã fix (giá trị cốt lõi)
1. **Leave approve/cancel 500** — 8 mismatch code-vs-schema (get_leave_policy row-NULL, float→numeric, notifications).
2. **CỤM BUG NOTIFICATION toàn hệ thống (SEVERE):**
   - Cột `notifications.link` KHÔNG tồn tại (phải dùng `metadata` jsonb) — 5 chỗ INSERT vỡ.
   - Enum thiếu 5 type (`workflow_update/timeout, deadline_overdue/upcoming, task_assigned`) → migration `m42`.
   - `workflow approve/reject → 500` mỗi khi **người duyệt ≠ người tạo** (ca maker-checker thường gặp) vì `_notify` chạy trong transaction. Test cũ dùng cùng-user nên bỏ lọt → đã thêm **test khoá**.
   - Bug asyncpg tinh vi: `jsonb_build_object('link', $4)` param trần → `IndeterminateDatatypeError` → fix `$4::text`. (Audit tĩnh miss, test runtime bắt.)
   - `app/tasks/notifications.py` (cron mỗi giờ) còn `n2.link` + `current_state` (KeyError) → fix.
3. **`cash_flow_statement` 500 LIVE** (cash_book có 20 dòng thật, tỷ đồng): đọc `r["category"]` (SELECT trả `category_id`) + set category "tưởng tượng" + direction sai (`in/out` thay vì `thu/chi`). Kèm `profit_loss` (bug `float − Decimal` TypeError + direction `expense`→`chi`) + `monthly_comparison`. Đã reconcile theo convention THẬT + JOIN `cash_book_categories`.
4. Shipment receive, workflow bqms actor_id, 2 bug migration HR (vòng phụ thuộc + immutable index).

### Hạ tầng
- **W1-11 CI gate**: cắm `run_tests_ci.sh` vào `deploy.sh` (sau build, TRƯỚC restart — đỏ thì HỦY deploy, container cũ nguyên vẹn, không rollback nguy hiểm; có `--skip-tests` khẩn cấp). Sửa 2 lỗi script: quoting marker nhiều-từ + thiếu pyyaml. **Đã validate committed script: 296 passed.**
- **W1-00 restore drill**: phát hiện backup CHƯA restore-sạch 100% (unaccent/search_path) → hardening ở **W2-01**.

### Finance (W1-50/W1-05)
- **"dashboard AP/AR=0" KHÔNG phải bug** — bảng AR/AP RỖNG (auto-tạo tắt + chưa nhập tay), mọi endpoint AP/AR/summary/balance ĐÚNG schema. Test khoá 2 chiều (rỗng→0, seed→số đúng).

---

## 2. CẦN THANG QUYẾT / LÀM (không phải việc code)

1. **RBAC finance — viewer thấy công nợ**: endpoint tài chính mặc định `allow_viewer=True` → viewer đọc được số AP/AR. Nếu coi công nợ nhạy cảm → đổi `allow_viewer=False` (như đã làm cho margin/giá vốn). **Cần Thang quyết.**
2. **FE follow-up (cụm notification)**: FE phải đọc `metadata.link` (không phải cột `link` phẳng) + thêm nhãn cho 5 type notification mới.
3. **Auto-AR/AP đang TẮT**: dashboard sẽ hiện 0 tới khi (a) bật auto-tạo sau verify giao hàng — cần Thang duyệt + maker-checker, hoặc (b) kế toán nhập tay.
4. **profit_loss = accrual** (revenue từ deal_margins/invoices, không cộng cash 'thu'). Nếu muốn P&L kiểu tiền mặt → cần quyết định nghiệp vụ.
5. **Ngữ nghĩa cũ cần xác nhận**: reject-PO → trạng thái `'cancelled'` (po_status enum không có 'rejected'); `/escalate` alias trả 400 (không có transition tương ứng).
6. **Độ bền deploy**: các fix đang deploy qua **docker cp + restart** (đúng pattern dự án) — sống qua `docker restart` nhưng SẼ MẤT nếu rebuild image / `compose up --force-recreate`. Để vĩnh viễn: commit các file đã sửa vào git + build image. (Chưa commit vì chưa được yêu cầu.)

---

## 3. HOÃN (đúng phạm vi)
- **W1-09 BQMS e2e** — HOÃN tới khi Thang đổi xong mật khẩu Samsung (đang pause sec-bqms). Tôi KHÔNG đăng nhập sec-bqms suốt Đợt 1.
- **W2-01 restore hardening** — thuộc Đợt 2.

---

## 4. File đã đổi (deployed qua docker cp)
`app/services/workflow_engine.py`, `app/services/bqms_service.py`, `app/api/v1/workflows.py`, `app/api/v1/inventory.py`, `app/api/v1/shipment_tracking.py`, `app/api/v1/leave.py`, `app/api/v1/purchase_orders.py`, `app/tasks/notifications.py`, `app/api/v1/finance_reports.py`, `app/tasks/revenue_chain.py` · migration `m42_notification_type_add_missing.sql` (+ m40_pre/m41/inventory index) · `scripts/deploy.sh`, `backend/scripts/run_tests_ci.sh` · tests: `test_hr.py`, `test_finance.py`, `test_secondary.py` (test khoá), +8 file test khác.
