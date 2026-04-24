# CRM Blueprint - Song Chau ERP

## Muc tieu

Tai lieu nay chot huong phat trien dai hon cho muc `Khach hang / CRM` de:
- co mot roadmap de theo doi ve sau
- biet ro nen xay gi truoc, gi de sau
- tranh lam CRM chung chung, khong bam vao du lieu that cua Song Chau

Execution spec cho buoc bat tay lam duoc tach rieng tai [CRM_PHASE0_EXECUTION_SPEC.md](C:\Users\ASUS\OneDrive\Documents\hệ thống song châu\docs\CRM_PHASE0_EXECUTION_SPEC.md).

CRM cho Song Chau nen di theo huong `Account CRM + Opportunity CRM + After-sales`, bam truc tiep vao RFQ, bao gia, PO, giao hang, cong no va tai lieu.

## Hien trang module CRM

### Da co san

- Danh sach khach hang va chi tiet khach hang
- Contacts va interactions
- Timeline customer
- Pipeline Kanban nhe
- Import `bqms_contacts` tu danh ba that
- Mot phan noi sang sales orders, invoices, accounts receivable, BQMS, deliveries

### Diem manh

- Co du lieu that de bat dau
- Da co giao dien co ban va API CRUD
- Da co y tuong `Customer 360`
- Da co kha nang noi tiep sang cac module ERP khac

### Diem yeu can xem la blocker

- Mapping `customer -> BQMS / PO / delivery` dang dua vao `short_name ILIKE`, chua co bang mapping chuan
- Pipeline stage backend va frontend chua dong bo
- Mot so KPI/route CRM dang tong hop theo toan cuc, chua loc that theo customer
- `bqms_contacts` va `crm_contacts` dang bi tron semantics
- Chua co owner/account manager chuan o cap customer/opportunity

## Nguyen tac thiet ke

1. CRM khong la mot he rieng
- No phai la lop nghiep vu nam tren du lieu ERP that.

2. Khong lay text match lam khoa quan he chinh
- Moi KPI lien quan den customer phai dua tren mapping chuan.

3. Chi tinh KPI tren record dat nguong tin cay toi thieu
- Neu du lieu chua du, phai hien coverage thay vi ve dashboard dep nhung sai.

4. Uu tien workflow van hanh truoc automation
- Follow-up, owner, stage, timeline, overdue view phai dung duoc truoc khi lam AI hay scoring.

5. Tach ro cac lop doi tuong
- Account
- Contact
- Opportunity
- Activity
- After-sales case
- Related vendor/supplier signal

## Dich den san pham

CRM v2 cua Song Chau nen duoc nhin nhu 4 lop:

### 1. Account CRM
- Quan ly ho so khach hang
- Contact chinh
- Nguoi phu trach
- Tinh trang quan he
- Tai lieu lien quan

### 2. Opportunity CRM
- Quan ly RFQ, bao gia, co hoi, du an ban hang
- Stage, expected value, next action, owner, close date
- Ly do thang/thua

### 3. Customer 360
- Tong hop RFQ, quotation, PO, giao hang, cong no, hoa don, tai lieu va interactions
- Cho manager va sales nhin mot lan la thay tinh hinh account

### 4. After-sales / Project Follow-up
- Case sau ban
- Follow-up nghiem thu
- Van de ky thuat / bao hanh
- Tin hieu mua lai

## Sitemap de xuat cho muc Khach hang

1. `Tong quan CRM`
2. `Co hoi / RFQ`
3. `Khach hang`
4. `Lien he`
5. `Bao gia`
6. `Du an / Follow-up`
7. `After-sales / Case`
8. `Cong no khach hang`
9. `Bao cao CRM`

Ghi chu:
- `Nha cung cap lien quan` khong nen tron vao menu Khach hang. Nen de thanh mot huong CRM song song cho procurement/vendor sau nay.

## Cac man hinh chinh nen co

### 1. Tong quan CRM
- KPI tong quan
- Pipeline by stage
- Follow-up qua han
- RFQ moi
- Cong no rui ro
- Case dang mo

### 2. Danh sach co hoi / RFQ
- Filter theo owner, stage, customer, date, BQMS
- Sort theo gia tri, han follow-up, ngay tao

### 3. Chi tiet co hoi
- Timeline
- BQMS / maker / quotation
- Tai lieu lien quan
- Ly do thang/thua
- Next action

### 4. Danh sach khach hang
- Account master
- Nhom khach, MST, khu vuc, owner, status

### 5. Chi tiet khach hang 360
- Doanh thu, RFQ, bao gia, PO, giao hang, cong no, interactions, tai lieu, contacts

### 6. Danh sach bao gia
- Lien ket RFQ -> quotation -> order

### 7. Du an / Follow-up
- Milestone, owner, ngay tiep theo, blocker

### 8. After-sales / Case
- Ho tro ky thuat, khiem khuyet, nghiem thu, mua tiep

### 9. Cong no khach hang
- AR aging
- Hoa don
- Han thanh toan
- Tinh trang qua han

### 10. Bao cao CRM
- Funnel
- Win/loss
- Follow-up discipline
- Account health

## 10 KPI uu tien cao

1. So co hoi mo
2. Gia tri pipeline mo
3. Ty le RFQ -> bao gia
4. Ty le bao gia -> chot don
5. Thoi gian phan hoi RFQ trung binh
6. So follow-up qua han
7. Doanh thu ky nay tu co hoi da chot
8. Cong no qua han
9. Ty le khach hang mua lai
10. So case after-sales dang mo

## Du lieu can cho KPI

| KPI | Du lieu toi thieu |
|---|---|
| So co hoi mo | opportunity_id, stage, status, owner |
| Gia tri pipeline mo | estimated_value, stage, status, currency |
| Ty le RFQ -> bao gia | rfq_id, rfq_date, quotation_id, quotation_date |
| Ty le bao gia -> chot don | quotation_id, sales_order_id hoac won_status |
| Thoi gian phan hoi RFQ | rfq_created_at, first_quote_at hoac first_response_at |
| Follow-up qua han | next_action_date, owner, status |
| Doanh thu tu co hoi da chot | opportunity_id, order/invoice amount, invoice_date |
| Cong no qua han | invoice_no, due_date, amount_due, paid_amount, customer_id |
| Ty le mua lai | customer_id, order history, repeat_order_count |
| Case after-sales dang mo | case_id, status, priority, opened_at, customer_id |

## Data model toi thieu can co

### Entity chinh

- `crm_accounts`
- `crm_account_external_map`
- `crm_contacts`
- `crm_opportunities`
- `crm_activities`
- `crm_follow_ups`
- `crm_cases`
- `crm_tags`
- `crm_account_owner_history`

### Mapping quan trong nhat

Bang `crm_account_external_map` nen la viec dau tien can co. Muc dich:
- noi `customer_id` voi `bqms company key`
- noi voi alias ten khach hang
- noi voi tax_code / short_name / system source

Neu khong co lop nay, Customer 360 va dashboard se tiep tuc sai nghia.

### Relationship toi thieu

- Account 1-n Contacts
- Account 1-n Opportunities
- Account 1-n Activities
- Account 1-n Cases
- Opportunity 1-n Quotations
- Opportunity n-n BQMS codes
- Account 1-n ERP links: RFQ, SO, Invoice, Delivery, AR

## Guardrail du lieu

### Bat buoc

- Khong dung ten text tu do lam khoa noi du lieu
- Moi opportunity phai co `owner`, `stage`, `status`
- Moi follow-up phai co `next_action_date`
- Moi account phai co `primary_contact` hoac danh dau chua du contact
- Stage, status, lost_reason, source phai dung enum

### KPI chi duoc tinh khi

- co mapping customer hop le
- co date nghiep vu hop le
- co amount hop le
- khong duplicate theo khoa business chinh

### Hien thi can co

- data coverage
- freshness
- so record bi loai do thieu field

## Workstreams

### 1. Product va process
- Chot scope CRM v1
- Chot dinh nghia stage
- Chot playbook follow-up
- Chot owner model

### 2. Data va mapping
- Tao account mapping layer
- Dedupe customer/contact
- Chot relation RFQ -> quotation -> SO -> invoice -> delivery

### 3. Backend/API
- CRUD cho accounts, opportunities, activities, cases
- Search/filter/sort
- Timeline hop nhat
- KPI endpoints

### 4. Frontend/UI
- Overview dashboard
- Accounts list + detail 360
- Opportunity list + detail
- Follow-up views
- Cases

### 5. Reporting
- Funnel
- Win/loss
- Follow-up overdue
- Account health

### 6. Adoption
- SOP nhap lieu
- Weekly review
- Chot owner theo team

## Phase roadmap

### Phase 0 - Blueprint va data foundation
Trang thai: Planned

Muc tieu:
- Chot blueprint
- Chot entity
- Chot stage/status
- Chot mapping strategy

Deliverables:
- Tai lieu blueprint nay
- Field dictionary
- Stage definition
- Mapping rule cho customer

Acceptance:
- team co the tra loi ro CRM se quan ly gi, khong quan ly gi
- co danh sach field bat buoc
- co quy uoc KPI

### Phase 1 - CRM Foundation
Trang thai: Planned

Muc tieu:
- Lam sach account/contact
- Co account list va contact list dung duoc that
- Co owner va next action co ban

Deliverables:
- account master
- contact master
- activity log
- search/filter co ban

Acceptance:
- tao/sua/tim duoc account va contact
- moi account co owner
- activity log ghi nhan duoc

### Phase 2 - Opportunity CRM
Trang thai: Planned

Muc tieu:
- Dua RFQ va bao gia vao co hoi
- Theo doi pipeline chot don

Deliverables:
- opportunity entity
- pipeline board
- detail co hoi
- lien ket RFQ/quotation

Acceptance:
- moi co hoi co owner, stage, expected value, next action
- manager xem duoc pipeline team
- co so lieu overdue follow-up

### Phase 3 - Customer 360
Trang thai: Planned

Muc tieu:
- Gom ERP transactions vao mot man hinh account

Deliverables:
- account 360
- tabs RFQ, quotation, SO, delivery, invoices, AR, documents
- account health cards

Acceptance:
- xem duoc lich su khach hang tu 1 noi
- doanh thu, cong no, giao hang khong phu thuoc vao text match tho

### Phase 4 - After-sales va project follow-up
Trang thai: Planned

Muc tieu:
- theo doi sau ban va van de ky thuat

Deliverables:
- case module
- project/follow-up board
- SLA views

Acceptance:
- case gan duoc voi account va order/delivery
- manager thay duoc case mo, qua han

### Phase 5 - Reporting va automation nhe
Trang thai: Planned

Muc tieu:
- co dashboard va canh bao usable

Deliverables:
- funnel report
- win/loss report
- follow-up overdue report
- account risk score don gian

Acceptance:
- KPI dung tren du lieu that
- co coverage va freshness
- co weekly review dashboard

## Quick wins nen lam som

1. Fix mapping customer voi BQMS bang bang mapping rieng
2. Fix customer quotes de loc that theo customer
3. Dong bo pipeline stage backend/frontend
4. Tách `bqms_contacts` khoi `crm_contacts` theo semantics
5. Them owner + next follow-up vao customer detail
6. Tao dashboard `Follow-up qua han`

## Khong nen lam ngay

- marketing automation
- email campaign engine
- AI scoring
- loyalty
- full mobile app
- workflow engine tong quat
- social/chat integration rong

## KPI theo doi tien do du an CRM

| Workstream | Cach theo doi |
|---|---|
| Product | scope approved, stage approved, SOP approved |
| Data | % account duoc mapping, % contact duoc clean |
| Backend | so endpoint san sang, so integration hoan thanh |
| Frontend | so man hinh usable, so man hinh co du lieu that |
| Reporting | so KPI da co coverage va freshness |
| Adoption | % account co owner, % opportunity co next action |

## Tich hop mo rong sau nay

### 1. He thong thuong mai / SAP

Huong dung:
- Song Chau ERP van la lop dieu phoi nghiep vu
- SAP/commercial system lam noi giu accounting/statutory truth

Nen xem nhu benchmark hoac huong mua:
- SAP Business One cho SME ERP/commercial core
- SAP Sales Cloud cho benchmark CRM cap doanh nghiep

### 2. MES cho san xuat

Chi nen noi khi can theo doi:
- work order
- WIP
- quality
- traceability
- OEE

Huong tham chieu:
- SAP Digital Manufacturing
- Siemens Opcenter

### 3. IoT xuong

Chi nen dua vao ERP sau khi da qua lop semantic/event, khong dua raw telemetry vao CRM/ERP.

Nen uu tien cac tin hieu co gia tri ro:
- machine state
- cycle count
- alarm
- energy
- barcode/RFID event

Huong tham chieu:
- Siemens Industrial Edge
- Azure IoT Operations
- AWS IoT SiteWise

## Milestone de quay lai trien khai

1. Blueprint approved
2. Data model approved
3. Mapping layer ready
4. Foundation screens/API ready
5. Opportunity pipeline usable
6. Customer 360 integrated
7. Reporting usable

## Quy uoc cap nhat

Khi quay lai lam CRM, moi dot nen cap nhat:
- phase dang lam
- blockers
- file/schema da them
- KPI nao da co du lieu that
- KPI nao van o muc planned
