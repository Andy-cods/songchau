# SONG CHÂU ERP — MASTER PROGRESS
## Cập nhật: 11/04/2026 | Go-Live: 30/08/2026

---

## TỔNG QUAN HỆ THỐNG: 40 MODULES | 78 PAGES | 95 TABLES

```
CORE ERP:    █████████████████░░░  85% (Core ERP + Data Import)
PHASE 1:     ████████████████████  100% (4 modules — M01/M02/M03/M08)
PHASE 2: M04(tạm tắt) + M05(Market Prices XNK) + M07(Vendor Portal) + M09(redesign 22 cột)
PHASE 5: M12 + M24
PHASE 6: M29 + M30(quarterly invoices) + M33(CRM Kanban Pipeline)
PLUS: Concurrent Sync (Optimistic Lock + WebSocket + Redis cache) — 07/04/2026
SESSION 5: Vendor Portal + CRM Kanban + Quarterly Invoices + Dashboard CEO + M05 + Concurrent Sync
TỔNG DỰ ÁN:  ████████████████░░░░  82% (13/40 modules + Vendor Portal + infra)
```

### Live: đang chuyển VPS mới (backup sẵn sàng)
### Login: thang@songchau.vn / SongChau@2026

---

## ĐÃ HOÀN THÀNH ✅

| Hạng mục | Số liệu (verified 01/04) |
|---|---|
| Backend API | 35+ routers, ~200 endpoints |
| Backend files | 93 Python files |
| Frontend pages | 70+ pages (53 verified accessible) |
| Frontend components | 29 components |
| Database | 105 tables, 59,565 rows |
| Users | 18 accounts, 6 roles |
| Git commits | 9 |
| E2E tests | 91/92 API pass + 53/53 pages = 98% |
| Data thật | bqms_rfq: 8,161 rows, bqms_deliveries: 2,584 rows, bqms_contacts: 97 rows, OneDrive: 54,595 files |

---

## ROADMAP 40 MODULES — 8 PHASES — 22 TUẦN

### Phase 1: Business Intelligence (Tuần 1-3) — ✅ HOÀN THÀNH 31/03/2026
| Module | Tên | Status | Pages |
|---|---|---|---|
| M01 | Điền Báo Giá Tự Động (TM + GC) | ✅ | /bqms/quotation/new, /history, /[id], /templates |
| M02 | Theo Dõi Giá & Phân Tích | ✅ | /analytics/price-trends, /win-loss. Cập nhật 11/04/2026 tối: redesign thành "Trung tâm xu hướng giá" với benchmark dữ liệu thật giữa `bqms_rfq` và `xnk_price_lookup`, gắn badge tin cậy/độ phủ nguồn, dùng ngày nghiệp vụ thay cho `created_at`, thêm biểu đồ so sánh giá nội bộ vs TT XNK theo tháng, maker compare, và bảng đối soát BQMS match; `báo giá trúng` + `giao hàng` hiện ở chế độ held-out để minh bạch nguồn nhưng chưa trộn vào KPI chính. |
| M03 | Lọc Đơn Thông Minh (AI) | ✅ | /bqms/classify |
| M08 | Báo Cáo Tự Động | ✅ | /reports/scheduled |

### Phase 2: Samsung & Supply Chain (Tuần 4-6) — 19 ngày
| Module | Tên | Status | Pages |
|---|---|---|---|
| M04 | Đồng Bộ Samsung BQMS | ✅ | Playwright headless login + PO intercept → 332 POs synced, SyncWidget, /sync/trigger+latest+history |
| M05 | Tìm Giá Thị Trường (XNK) | ✅ | /market-prices — rebuilt 10/04/2026 từ TT XNK BQMS 2026.xlsm, 35,124 records, đủ năm 2023-2026, UI hiển thị compact + full cột Excel. Cập nhật 11/04/2026: chuyển sort sang server-side trước khi phân trang, mặc định ưu tiên ngày RFQ mới nhất toàn bộ dữ liệu, vẫn giữ tùy chọn lấy dòng cuối Excel lên trước, và panel lịch sử BQMS cũng sort theo ngày đúng hơn. Cập nhật 11/04/2026 chiều: vá parser ngày cho dữ liệu MM/DD/YY mơ hồ, rồi chỉnh lại đúng chỗ hiển thị theo phản hồi người dùng: bỏ widget "Dòng dữ liệu mới nhất", dồn logic xếp khối năm 2026 -> 2025 -> 2024 -> 2023 vào chính mục "Kết quả tra cứu", cho phép drill-down xem riêng từng năm, và đổi "Xu hướng báo giá theo tháng" sang dropdown chọn 1 năm. Auto-rebuild qua OneDrive sync khi workbook 2026 đổi. Tabs: Tra cứu giá + Đối thủ. Backend: search/by-bqms/search-sections/sellers/stats/dashboard |
| M06 | Canh Gác Samsung | ⏳ | /bqms/watchdog |
| M07 | Quản Lý NCC Thông Minh | ✅ | Vendor Portal (port 8080) — đăng ký, đăng nhập, đợt báo giá, sealed bidding USD/RMB + /procurement (admin: duyệt NCC, tạo đợt, so sánh giá, chọn trúng) |
| M09 | Theo Dõi Giao Hàng | ✅✅ | /bqms/deliveries (REDESIGN: 22 cột, KPI, DANH BẠ, export Excel) |

### Phase 3: Operations Intelligence (Tuần 7-9) — 17 ngày
| Module | Tên | Status | Pages |
|---|---|---|---|
| M10 | Quản Lý Tồn Kho Thông Minh | ⏳ | /inventory/forecast, /reorder |
| M11 | Thông Báo Thông Minh | ⏳ | /notifications/settings |
| M13 | Phân Tích Lợi Nhuận | ⏳ | /analytics/profit, /[customer_id] |
| M14 | Phân Công Công Việc | ⏳ | /tasks, /new, /workload |

### Phase 4: System Health (Tuần 10-12) — 20 ngày
| Module | Tên | Status | Pages |
|---|---|---|---|
| M16 | Bảng Điều Khiển Hiệu Suất | ⏳ | /admin/performance |
| M17 | Trung Tâm Di Chuyển Dữ Liệu | ⏳ | /admin/migration |
| M18 | Đồng Bộ OneDrive Liên Tục | ⏳ | /admin/onedrive-sync |
| M19 | Trung Tâm Lỗi | ⏳ | /admin/errors |
| M20 | Hàng Đợi Xử Lý Lại | ⏳ | /admin/retry-queue |
| M21 | Lịch Sử Container | ⏳ | /admin/containers |
| M22 | Xác Nhận Backup | ⏳ | /admin/backups |

### Phase 5: UX & Productivity (Tuần 13-14) — 17 ngày
| Module | Tên | Status | Pages |
|---|---|---|---|
| M12 | Quản Lý Tài Liệu | ✅ | /documents/browser (File Browser + 54K files synced) |
| M23 | Nhật Ký Bảo Mật | ⏳ | /admin/security-log |
| M24 | Xuất Excel 1 Chạm | ✅ | Delivery export giống format THỐNG KÊ PO |
| M25 | Thao Tác Hàng Loạt | ⏳ | (tính năng trên mọi bảng) |
| M26 | Hướng Dẫn Sử Dụng | ⏳ | /help, /help/first-login |
| M27 | Kiểm Tra Chất Lượng DL | ⏳ | /admin/data-quality |
| M28 | Nhật Ký Hoạt Động User | ⏳ | /admin/user-activity |

### Phase 6: Finance & CRM (Tuần 15-17) — 19 ngày
| Module | Tên | Status | Pages |
|---|---|---|---|
| M29 | Quản Lý Tài Chính | ✅ | /finance/overview (real data + cash-book CRUD) |
| M30 | Hóa Đơn Điện Tử | ✅ | /finance/quarterly-invoices (Q1 2026: 151 bán + 67 mua, upload PDF + pdfplumber OCR, lưu /data/files/invoices_pdf/) |
| M31 | Quản Lý Đơn Bán Hàng | ⏳ | (enhance existing sales-orders) |
| M33 | Quản Lý Khách Hàng (CRM) | ✅ | /crm Kanban Pipeline 5 stages (KH-based, drag-drop, auto-generate from BQMS) + /crm/[id] với 5 tab |
| M36 | Báo Cáo Tài Chính | ⏳ | /finance/reports |

### Phase 7: Advanced Features (Tuần 18-20) — 22 ngày
| Module | Tên | Status | Pages |
|---|---|---|---|
| M15 | Lịch Sử Giao Tiếp Samsung | ⏳ | /bqms/emails |
| M32 | Tự Động Đọc Email | ⏳ | (background service) |
| M34 | Hải Quan & XNK | ⏳ | /customs, /[id] |
| M37 | Dự Báo Nhu Cầu (AI) | ⏳ | /analytics/forecast |
| M38 | OCR Tài Liệu | ⏳ | /documents/ocr |
| M39 | Lịch & Nghỉ Phép | ⏳ | /calendar |

### Phase 8: Platform Maturity (Tuần 21-22) — 9 ngày
| Module | Tên | Status | Pages |
|---|---|---|---|
| M35 | Ứng Dụng Di Động (PWA) | ⏳ | /pwa/install |
| M40 | Đa Ngôn Ngữ | ⏳ | /settings/language |

---

## SỐ LIỆU DỰ KIẾN SAU 40 MODULES

| Metric | Hiện tại (Phase 1 done) | Sau 40 modules |
|---|---|---|
| **Frontend pages** | 33 | **78** |
| **Backend API endpoints** | 106 | **~200** |
| **Backend files** | 64 | **~130** |
| **Database tables** | 69 | **95** |
| **Database rows** | 59,552 | **~100,000+** |
| **Frontend components** | 29 | **~50** |
| **Tự động hóa** | 70% | **88%** |
| **Tiết kiệm** | ~15h/ngày | **~18h/ngày** |

---

## SECURITY FRAMEWORK (xuyên suốt)
- Input validation: Pydantic strict mode
- SQL injection: parameterized queries only
- XSS: sanitize all user input
- Rate limiting: per-endpoint sensitivity
- Audit trail: all write operations
- Encryption: pgcrypto cho data nhạy cảm
- Session: JWT blacklist on logout
- File upload: MIME + extension + size validation

## PERFORMANCE TARGETS
- API response < 200ms (p95)
- Dashboard load < 1 second
- Background jobs: sync < 5min, reports < 30s
- Cache hit rate > 85%

---

*Master Plan v3 | 40 modules | 78 pages | 95 tables | 22 tuần*
*Chi tiết: plans/MASTER_PLAN_40_MODULES.md*

## Update 13/04/2026 - Quarterly Invoice Cost Controls
- M30 /finance/quarterly-invoices: bo sung sua truc tiep theo tung hoa don cho VAT, tax_rate, cost_price, cost_vat, shipping_cost, customs_fee, commission, other_costs, manual_adjustment, notes.
- Backend summary da tinh them total_configured_cost, total_extra_costs, net_profit_after_costs tren du lieu that.
- Da them migration quarterly_invoices_editable_costs.sql va deploy live len VPS.
- Smoke test live: /finance/quarterly-invoices = 200, /login = 200, /api/health = 200; bang sales = 151 dong, purchases = 68 dong sau migration.
- Update 13/04/2026 (auth + audit): reset lai login that `thang@songchau.vn / SongChau@2026` tren VPS; bo sung audit trail cho PUT /finance/quarterly-invoices vao bang audit_log; test live pass voi login 200, sales update 200 + rollback 200, purchase update 200 + rollback 200, audit_log tang +4 ban ghi cho 2 lan sua va 2 lan rollback.
- Update 13/04/2026 (CRM planning): da review module CRM hien tai, xac dinh blocker lon nhat la mapping `customer -> BQMS/PO/delivery` con dang text-match; da tao blueprint theo doi lau dai tai `docs/CRM_BLUEPRINT.md` gom sitemap CRM moi, Customer 360, Opportunity CRM, After-sales, KPI, data model, guardrail, phase roadmap, quick wins va huong mo rong SAP/MES/IoT.
- Update 13/04/2026 (CRM execution spec): da dung agent brainstorm + cook de tach tiep `docs/CRM_PHASE0_EXECUTION_SPEC.md`, chot ro cac quyet dinh business can khoa, schema rollout order, API/UI rollout order, test plan, migration/backfill strategy, quick wins va done criteria cho Phase 0-1; buoc uu tien cao nhat khi quay lai implement van la `crm_account_external_map` de thay the text-match hien tai.
- Update 13/04/2026 (CRM Phase 0 kickoff code): da them migration `backend/migrations/crm_account_external_map.sql`, service `backend/app/services/crm_mapping_service.py`, va va cac route `crm.py`/`crm_pipeline.py` de doi `orders`, `financials`, `quotes`, `overview`, `auto-generate pipeline` sang su dung alias mapping ro rang thay vi text-match truc tiep; dong thoi mo them API quan ly `external-maps` de sau nay co the xac nhan mapping theo tung account.
- Update 13/04/2026 (CRM external-maps UI): da dua card `Lien ket du lieu` vao trang chi tiet khach hang `frontend/src/app/(dashboard)/crm/[id]/page.tsx`, cho phep xem / them / xoa mapping theo 3 preset nguon that (`bqms_samsung_po/company`, `bqms_deliveries/sev_type`, `bqms_orders/customer_name`), tu dong refresh cac tab `Don hang`, `Tai chinh`, `Bao gia` sau khi mutate, va deploy live len VPS; smoke test live pass voi `/crm/5 = 200`, `/crm = 200`, `/login = 200`, CRM API auth e2e van 200 tren `overview/detail/orders/financials/quotes/external-maps/pipeline`.
- Update 13/04/2026 (CRM external-maps preview): da bo sung preview endpoint `POST /api/v1/crm/customers/{id}/external-maps/preview` trong `backend/app/api/v1/crm.py`, frontend bat buoc preview truoc khi luu mapping, hien `matched_count + sample 5 dong + warning no_match/too_wide/conflict`, va deploy live len VPS; e2e live pass ca route `preview = 200`, dong thoi da bat dau lo ra mapping stale thuc te (vi du customer test co alias `bqms_deliveries` dang 0 match).
- Update 23/04/2026 (sidebar readiness + nav cleanup): da them registry readiness rieng cho cac muc sidebar `Nang cao` + `He thong` trong `frontend/src/lib/module-readiness.ts`, gan badge `Dang trien khai` cho cac module roadmap chua chot live (`Email Samsung`, `Du bao`, `Ngon ngu`, `Hieu suat`, `Loi he thong`, `Di chuyen du lieu`, `Containers`, `Backup`, `Chat luong DL`, `Bao mat`) va giu nguyen cac page dang live nhu `Users`, `Suppliers`, `Settings`, `Documents`, `Audit Log`.
- Update 23/04/2026 (migration nav fix): sua sidebar item `migration` tu link sai `/documents/browser` thanh dung module `/admin/migration`, doi nhan thanh `Di chuyen du lieu`, tranh trung nghia voi `Quan ly tai lieu` o menu chinh.
- Update 23/04/2026 (module status banner): da chen banner trang thai dung chung trong `frontend/src/app/(dashboard)/layout.tsx` + `frontend/src/components/layout/module-readiness-banner.tsx` de khi vao cac module dang trien khai, user thay ro pham vi hien tai va cac loi di thay the thay vi cam giac dead-end/404.
- Update 23/04/2026 (verify): da chay `cmd /c npx tsc --noEmit` trong `songchau-erp/frontend`; ket qua fail do cac loi TypeScript co san ngoai pham vi patch, tap trung o `admin/migration/page.tsx`, `settings/page.tsx`, `approvals/page.tsx`, `finance/cash-book/page.tsx`, `invoices/page.tsx`, `shipments/page.tsx`, `supplier-quotes/page.tsx`. Patch sidebar/readiness moi chua phat hien them loi type rieng.
- Update 23/04/2026 (nav standardization phase 2): da chuan hoa them `command-search`, `breadcrumb`, `topbar` va route `notifications` de cac diem dieu huong deu dung chung readiness registry; command palette bay gio lay source tu `getSidebarConfig(...)`, bo duplicate theo `href`, tim kiem khong dau, va hien badge `WIP` nhat quan voi sidebar.
- Update 23/04/2026 (ui slice check): da tach mot TS check rieng cho dung slice vua sua va pass sach, xac nhan bo file nav/readiness/topbar/breadcrumb/search moi khong tu dua loi type rieng vao frontend.
- Update 23/04/2026 (frontend deploy live): da upload cac file frontend lien quan len VPS `103.56.158.129`, build lai `frontend` container thanh cong bang `docker compose build frontend`, restart `frontend + nginx`, sau do smoke test public domain `https://erp.songchau.vn` pass 200 cho `/login`, `/notifications`, `/admin/migration`, `/admin/performance`, `/admin/errors`, `/admin/containers`, `/admin/backups`, `/admin/data-quality`, `/admin/security-log`, `/bqms/emails`, `/analytics/forecast`, `/settings/language`.
- Update 23/04/2026 (post-deploy auth check): da chay `python scripts/test_login.py`, ket qua login that qua API tren VPS tra `200` va access token hop le cho tai khoan admin `thang@songchau.vn`.
- Update 23/04/2026 (public https auth check): da test truc tiep `POST https://erp.songchau.vn/api/v1/auth/login` va nhan `200` + access token hop le, xac nhan login public qua domain that van hoat dong sau deploy.
- Update 23/04/2026 (remove WIP markers): da go badge/cham `WIP` khoi sidebar, command search va banner readiness trong dashboard layout theo feedback user; giu nguyen route that, khong con hien thi trang thai dang trien khai tren UI.
- Update 23/04/2026 (404 investigation): da scan toan bo link noi bo trong frontend va doi chieu voi cay `app/(dashboard)`; khong con static route page nao trong code dang tro toi duong dan khong ton tai. Nguon gay 404 hop ly nhat tren may user la service worker cu dang cache build/frontend shell.
- Update 23/04/2026 (disable stale PWA cache): da bo dang ky service worker trong `frontend/src/app/layout.tsx`, them script unregister + xoa cache `sc-erp-*`, dong thoi thay `frontend/public/sw.js` thanh ban cleanup khong intercept request nua de giam tinh trang may client giu build cu sau deploy.
- Update 23/04/2026 (redeploy after cache fix): da deploy lai frontend len VPS sau patch tren, build container pass va smoke test public domain tiep tuc `200` cho `/login`, `/notifications`, `/admin/migration`, `/admin/performance`, `/admin/errors`, `/admin/containers`, `/admin/backups`, `/admin/data-quality`, `/admin/security-log`, `/bqms/emails`, `/analytics/forecast`, `/settings/language`.
