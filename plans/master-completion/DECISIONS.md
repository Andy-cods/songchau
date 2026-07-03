# DECISIONS (ADR) — Song Chau ERP hoàn thiện

> Quyết định thực thi do **Fable brainstorm** ra + **Opus phản biện** (APPROVE_WITH_CHANGES), Thang cho toàn quyền (2026-07-03). Ràng buộc: KHÔNG chạm sec-bqms (Samsung đang đổi mật khẩu).

## D1 — WORKFLOW reconcile → SỬA CODE (không migration phá hủy)
Prod `workflow_instances` có `current_status`(enum workflow_status)/`workflow_type`/`ref_type`/`ref_id`/`title`/`data`, `workflow_history` có `instance_id`/`actor_id`/`from_status`/`to_status` — là **thiết kế chủ đích**, 3 đường code sống đang dùng đúng (bqms_service/dashboard/notifications). Code `workflow_engine.py`/`workflows.py` (dùng `current_state`/`entity_type`) mới là cái SAI → mọi thao tác workflow 500. **Quyết: sửa code về khớp prod** (code-only, low risk, rollback = git revert + cp). Migration rename trên bảng LIVE bị BÁC (phá 3 đường sống). + thêm 3 route alias `/workflows/{id}/approve|reject|escalate` (FE đang gọi, hiện 404). **Trạng thái:** cook agent đang sửa → harness verify → deploy.
*(Lưu ý: tôi từng "fix" line 165 sai chiều → đã revert. current_status là ĐÚNG.)*

## D2 — INVENTORY reconcile → SỬA CODE + 1 index additive
receive/adjust/shipment-receive 500 vì `ON CONFLICT(product_id)` không unique + cột phantom (updated_at/note/available_qty). **Quyết: sửa code khớp schema thật** (product_code/last_updated/notes/before_qty/after_qty/received_date) + **CREATE UNIQUE INDEX CONCURRENTLY uq_inventory_product_id** (precheck: 0 trùng, 50 dòng — an toàn). Additive, rollback = DROP INDEX. **Trạng thái:** cook đang sửa → index CONCURRENTLY + verify indisvalid → deploy.

## D3 — HR (m40/m41) → DEPLOY (additive)
Module code-complete cả BE (leave/attendance/employee-kpi router) lẫn FE, nhưng bảng chưa áp prod → 500. Precheck: leave_requests **rỗng** (CHECK không fail) + **tất cả cột prereq m40 tồn tại**. **Quyết: deploy m40+m41** (IF NOT EXISTS additive/idempotent). **Opus bắt buộc:** (1) restore-drill/backup trước; (2) 8 helper index m40 chạy giờ thấp điểm/CONCURRENTLY (bảng nhỏ nên nhanh); (3) re-dump `_schema_snapshot.sql` sau (để harness W1-07 chạy được). **Trạng thái:** chờ restore drill xong → deploy giờ thấp điểm.

## D4 — revenue_chain → GIỮ MANUAL đợt này (không convert periodic)
Comment "connector chưa fix" đã STALE (đã fix ở procrastinate_app.py) → sửa comment + ADR. Lịch convert theo gate:
- `sync_exchange_rates`: **KHÔNG BAO GIỜ** convert (trùng fx_rates_sync đã periodic).
- `check_overdue_invoices`: convert SAU W1-05 (test finance) + feature flag default OFF.
- `check_shipment_eta`: convert khi làm W2-06 (hiện chạy xong vứt kết quả).
- `detect_rfq_wins` (auto-tạo Sales Order): **CHỈ** convert SAU W3-07(audit)+W3-12(đối soát) + **Thang duyệt tay** (đổi hành vi đụng tiền — human-gate GOAL §3). Opus: "never in a safe list".

## D5 — CLOSEOUT (viewer-403 + W0-10)
- **viewer→403 (W0-21)**: đã có **test-máy** canh (test_analytics 10 ca + test_harness_smoke) → coi như **nghiệm thu bằng máy**; test tay của Thang chỉ là xác nhận optional.
- **W0-10 (Báo giá silent click)**: không có repro → **đóng "không tái hiện"**, chờ Thang cung cấp kịch bản nếu tái phát. Không chặn hoàn thành.

## Thứ tự thi hành (Opus duyệt)
CLOSEOUT → REVCHAIN(doc) → **restore drill** → HR → INV → WF. Mỗi bước đụng prod: gate bqms_push=0|0, verify sạch, rollback rõ.
