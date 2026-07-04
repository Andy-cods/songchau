# Đợt 3 — CLOSEOUT (Master Completion)

**Ngày:** 2026-07-04 · **Harness backend:** `381 passed, 0 failed` · **FE build STRICT PASS** (ignoreBuildErrors đã gỡ) · **Không đăng nhập sec-bqms** (Samsung pause). · Commit `0d3afee` pushed GitHub.

Đợt 3 = "bật hành vi nghiệp vụ + hoàn thiện chức năng". Làm evidence-based, mọi bước verify + harness; money-flow giữ cờ TẮT.

---

## 1. Đã LÀM (12/13 việc khả-thi — tất cả LIVE)

### Batch A (343 test)
- **W3-07** audit_log **immutable** (trigger m44 chặn UPDATE/DELETE) + phủ audit payment_transactions/payment_requests. (Phát hiện: `auto_audit_log()` trigger ĐÃ có sẵn cho AP/AR/customers/cash_book/PO/SO/suppliers.)
- **W3-12** endpoint `GET /finance/reconcile` — đối soát AP/AR (paid vs payment_transactions, status vs paid, overdue chưa cờ). Lưới đỡ trước khi bật auto-AR/AP.
- **W3-13** trừ **ngày lễ** khỏi `workdays_present` (m45 `public_holidays` 13 lễ VN 2026, sửa cả aggregator + view).
- **W3-10** RBAC `task_assignments` — staff chỉ thấy task được giao/tạo bởi mình (404 với task người khác).

### Batch B (374 test)
- **W3-02** IMV guard — cảnh báo admin khi có contract/rejection row mới (im lặng bấy lâu).
- **W3-04** render báo giá **N≥5** — root-cause: ngắt-trang rác dòng 25 trong template Excel; fix dọn row_breaks (dấu/chữ ký hết tràn). *(Cần Thang kiểm mắt PDF N=5/7.)*
- **W3-05** xếp hạng NCC — vá gap detail endpoint thiếu rank/prev_rank (FE luôn hiện "—").
- **W3-08** đóng 6 module → live + gỡ trùng calendar-leave (về /leave M41) + doc ranh giới 2 hệ notif; giữ 10 module in_progress có lý do rõ.

### Batch C (381 test) — money-flow, GIỮ CỜ TẮT
- **W3-06/W3-00** VERIFY auto-AR/AP + maker-checker AWARD (đã build sẵn, gated). Gate đúng, self-approve award → 403 đúng. **FIX hook auto-AR/AP đang NUỐT lỗi → giờ notify admin.** m47 seed cờ (=false).

### Batch D
- **W3-14** index composite `idx_notif_recipient_created` (m48) → inbox query **38.7ms → 0.15ms (~250×)**, gọi 9k-18k lần. (price view không đáng materialize, audit_log đủ index — evidence bác roadmap.)
- **W3-15** TypeScript **0 lỗi** (sửa 40, không @ts-ignore) + gỡ `ignoreBuildErrors` → **build STRICT** (type error hết bị nuốt). Đồng bộ toàn bộ /opt/erp/frontend/src=local (gỡ file rác bid/[token]).
- **W3-16** code-split — recharts + 5 modal nặng qua `next/dynamic` (26 file); analytics pages lazy-load chart.

---

## 2. 🚨 CẦN THANG (money-flow — quan trọng)
- **`phase3_auto_ar_enabled=TRUE` trên prod** (không phải false như tài liệu!). Hiện NO-OP vì sourcing_orders.customer_id NULL → skip (AR vẫn rỗng). Nếu backfill customer_id sẽ TỰ tạo AR. **Em KHÔNG đổi cờ — anh xác nhận có chủ đích không?** (procurement_auto_ap + award_approval vẫn false.)
- Thứ tự bật an toàn (khi sẵn sàng): maker-checker AWARD trước (`procurement_award_approval_enabled=true`) → auto-AP (cần vendor_accounts.supplier_id) → auto-AR (cần customer_id) → đối chiếu tay 1 tuần qua /finance/reconcile.
- **W3-04**: render thử báo giá N=5/7 → xác nhận mắt dấu/chữ ký gọn.
- **W3-13**: xác nhận lịch nghỉ bù + Quốc khánh 2026 (đang tạm 01+02/09).

## 3. SKIP / HOÃN đúng phạm vi
- **SKIP W3-01** (Dossier Part 2 popup Samsung — cần sec-bqms login, đang pause).
- **HOÃN W3-03** (Sourcing import Excel — chờ file mẫu khách), **W3-09** (email M365 — chờ creds).

---

## 4. Migration Đợt 3 (đã apply prod)
m44 (audit immutable), m45 (public_holidays), m47 (seed cờ money-flow=false), m48 (index notif), imv_module_v4 (imv enum), leave_requests_backfill_department. + code backend + FE (build strict). Commit `0d3afee`.
