# CRM Phase 0 Execution Spec

## Muc tieu

Tai lieu nay bien [CRM_BLUEPRINT.md](C:\Users\ASUS\OneDrive\Documents\hệ thống song châu\docs\CRM_BLUEPRINT.md) thanh execution spec de:
- co the giao implementation sau nay ma khong can dinh nghia lai
- chot ro thu tu schema, API, UI, migration, test
- biet Phase 0 va Phase 1 done khi nao

Phan nay chua implementation code. Day la spec de bat tay lam.

## Scope cua Phase 0

Phase 0 khong nham tao CRM day du. Muc tieu cua no la:
- chot quy tac nghiep vu
- chot mapping strategy
- chot data model toi thieu
- xac dinh rollout order va guardrail

Neu lam code ngay ma bo qua Phase 0, CRM rat de tro thanh mot lop UI dep nhung KPI sai nghia.

## Cac quyet dinh bat buoc phai chot voi business

1. `Scope CRM v1`
- CRM chi bao gom `Account + Opportunity + Follow-up + Case`
- chua gom marketing automation

2. `Owner model`
- moi account, opportunity, follow-up, case thuoc ai
- rule chuyen owner

3. `Stage/status model`
- mot bo enum thong nhat cho backend va frontend

4. `Customer 360 source of truth`
- du lieu nao doc tu ERP
- du lieu nao do CRM nhap tay

5. `Mapping strategy`
- customer noi voi RFQ/BQMS/PO/Invoice/Delivery bang gi
- khong dung `short_name ILIKE` lam khoa chinh

6. `KPI coverage rule`
- KPI nao du dieu kien moi duoc hien

7. `Next action playbook`
- follow-up hop le can gi
- overdue tinh nhu the nao

8. `Contact semantics`
- phan biet `crm_contacts` va `bqms_contacts`

## Anti-pattern can tranh

1. Dung text match lam khoa lien ket chinh
2. Lam dashboard truoc khi co mapping layer
3. Tron contact CRM va contact logistics/BQMS thanh mot loai
4. Cho phep opportunity khong co owner, stage, next action
5. Phinh scope qua som sang automation, scoring, mobile app

## Data model toi thieu can co

### Bang uu tien

1. `crm_accounts`
2. `crm_account_external_map`
3. `crm_contacts`
4. `crm_opportunities`
5. `crm_activities`
6. `crm_follow_ups`
7. `crm_cases`
8. `crm_account_owner_history`

### Field/enum quan trong nhat

#### `crm_accounts`
- `id`
- `account_name`
- `tax_code`
- `owner_user_id`
- `status`
- `primary_contact_id`

#### `crm_account_external_map`
- `account_id`
- `source_system`
- `external_key`
- `alias_name`
- `tax_code`
- `is_primary`

#### `crm_contacts`
- `account_id`
- `full_name`
- `phone`
- `email`
- `role_title`
- `is_primary`

#### `crm_opportunities`
- `account_id`
- `owner_user_id`
- `stage`
- `status`
- `expected_value`
- `currency`
- `next_action_date`
- `close_target_date`

#### `crm_activities`
- `account_id`
- `opportunity_id`
- `activity_type`
- `activity_at`
- `owner_user_id`
- `summary`

#### `crm_follow_ups`
- `account_id`
- `opportunity_id`
- `owner_user_id`
- `next_action_date`
- `status`
- `priority`

#### `crm_cases`
- `account_id`
- `related_order_no`
- `related_delivery_no`
- `status`
- `priority`
- `opened_at`
- `assigned_to`

#### Enum de xai thong nhat

- `opportunity_stage`
  - `new`, `qualified`, `quoted`, `negotiation`, `won`, `lost`
- `opportunity_status`
  - `open`, `on_hold`, `won`, `lost`, `cancelled`
- `follow_up_status`
  - `pending`, `done`, `overdue`, `cancelled`
- `case_status`
  - `open`, `in_progress`, `waiting_customer`, `resolved`, `closed`
- `lost_reason`
  - `price`, `spec_mismatch`, `timeline`, `competitor`, `customer_cancelled`, `unknown`

## Schema rollout order

### Phase 0A - Align core hien co

Muc tieu:
- chot bang core dang ton tai
- tranh hai nguon `contact master`

Viec can lam:
- review `customers`, `crm_contacts`, `crm_interactions`
- xac minh `backend/migrations/phase6_finance.sql` la canonical schema
- neu fresh install van phu thuoc `backend/init.sql`, can co bridge/view hoac align ten bang legacy

Ket qua can co:
- mot nguon schema ro rang cho contacts/interactions
- khong co hai luong ghi song song vao contact master

### Phase 0B - Mapping layer

Muc tieu:
- tao `crm_account_external_map`

Viec can lam:
- noi customer voi alias BQMS
- noi voi tax_code / short_name / external source key
- quy dinh natural key va duplicate rule

Ket qua can co:
- moi account co the link on dinh voi du lieu BQMS/ERP

### Phase 0C - Constraint/index safe

Muc tieu:
- bo sung unique/index/updated timestamp neu thieu

Viec can lam:
- unique key cho customer
- dedupe key cho contact
- `version` hoac optimistic concurrency neu can

Ket qua can co:
- CRUD on dinh
- tranh duplicate ro rang

## API rollout order

### Rollout 1 - Core CRM API

File neo:
- [crm.py](C:\Users\ASUS\OneDrive\Documents\hệ thống song châu\songchau-erp\backend\app\api\v1\crm.py)

Can co:
- list/create/update account
- list/create contacts
- list/create interactions
- customer detail
- timeline

Nguyen tac:
- giu response shape on dinh
- read-first, write surface nho

### Rollout 2 - Fix integration endpoints

Can co:
- customer quotes phai loc that theo account/customer
- customer orders, deliveries, financials khong duoc dua vao text match tho
- summary cards phai doc tu data that

### Rollout 3 - Pipeline API

File neo:
- [crm_pipeline.py](C:\Users\ASUS\OneDrive\Documents\hệ thống song châu\songchau-erp\backend\app\api\v1\crm_pipeline.py)

Dieu kien truoc khi mo rong:
- stage enum backend/frontend thong nhat
- logic generate board dung theo customer mapping that

## UI rollout order

### UI Phase 0

File neo:
- [page.tsx](C:\Users\ASUS\OneDrive\Documents\hệ thống song châu\songchau-erp\frontend\src\app\(dashboard)\crm\page.tsx)
- [page.tsx](C:\Users\ASUS\OneDrive\Documents\hệ thống song châu\songchau-erp\frontend\src\app\(dashboard)\crm\[id]\page.tsx)
- [page.tsx](C:\Users\ASUS\OneDrive\Documents\hệ thống song châu\songchau-erp\frontend\src\app\(dashboard)\crm\new\page.tsx)

Chi can:
- accounts list
- account detail
- contacts
- interactions
- timeline
- search/filter co ban

Khong lam ngay:
- board phuc tap
- 360 dashboard day KPI
- widget phan tich nang

### UI Phase 1

Mo rong:
- opportunity list
- opportunity detail
- overdue follow-up view
- customer 360 panels
- pipeline board

## Test plan toi thieu

### Backend unit/integration

- search/filter customer
- create/update customer
- create contact
- create interaction
- timeline ordering
- permission matrix theo role
- customer detail tra dung contacts/interactions/orders

### Data integrity

- mot customer khong co hai primary contact cung luc
- timeline sort dung
- duplicate customer/contact khong tang vo ly
- mapping customer -> ERP khong dua vao text match tho sau khi co layer moi

### Frontend smoke

- mo `/crm`
- mo `/crm/[id]`
- tao/sua customer
- tao contact
- tao interaction
- refresh van thay du lieu

### Regression

- API response shape on dinh
- backend/frontend dung cung enum stage/status

## Migration va backfill strategy

1. Chi additive migration trong vong dau
- them bang
- them cot
- them index
- them constraint safe

2. Backfill phai idempotent
- `INSERT ... ON CONFLICT DO UPDATE`

3. Neu co legacy contacts
- backfill mot chieu sang `crm_contacts`
- khoa luong ghi vao legacy

4. Khong rebuild sach CRM master o lan dau
- giu raw data cu
- clean dan bang rule va mapping

5. Neu can tuong thich nguoc
- uu tien tao view/adapter
- khong copy logic ra nhieu noi

## Quick wins nen lam truoc implementation lon

1. Tao `crm_account_external_map`
2. Dong bo stage enum backend/frontend
3. Them `owner` va `next_action_date`
4. Tach `bqms_contacts` khoi `crm_contacts` theo semantics
5. Tao man `Follow-up qua han`
6. Sua route quote/order/financials de loc dung theo customer

## Done criteria

### Phase 0 done khi

- blueprint da chot
- enum, owner model, mapping strategy da chot
- schema rollout order da ro
- API/UI rollout order da ro
- test plan va migration strategy da ro

### Phase 1 done khi

- `customers`, `contacts`, `interactions` CRUD chay that
- `/crm` va `/crm/[id]` hien data that, khong con demo placeholder
- timeline va contact list on dinh
- moi write co audit/version story ro

### Phase 2 done khi

- account 360 co lien ket RFQ, quotation, order, invoice, delivery, AR
- pipeline board chay that
- summary cards khong con KPI gia
- import/backfill lap lai khong nhan ban du lieu

## Cach theo doi khi quay lai trien khai

Moi phase nen co:
- owner
- target date
- current status
- blockers
- output demo duoc

Moi dot update nen ghi:
- schema nao da xong
- API nao da xong
- UI nao da xong
- KPI nao da co du lieu that
- blocker hien tai la gi

## De xuat thu tu bat tay lam sau nay

1. Mapping layer
2. Fix current CRM routes cho dung data
3. Fix enum/stage pipeline
4. Follow-up overdue view
5. Opportunity entity
6. Customer 360
