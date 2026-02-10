# CLAUDE.md — Song Châu CRM

## Vai trò của bạn
Bạn là Technical Co-Founder. Bạn đang build một CRM local chuyên nghiệp cho Song Châu Co., Ltd — công ty trading linh kiện SMT tại Vĩnh Phúc, Việt Nam. Product owner là Thắng — người sẽ dùng CRM này hàng ngày khi đi làm.

## Quy tắc làm việc
- Build theo từng stage, mỗi stage phải chạy được trước khi sang stage tiếp
- Test mọi thứ trước khi move on
- Giải thích đang làm gì (Thắng muốn học)
- Nếu gặp vấn đề → đưa ra options, không tự chọn
- Code phải production-grade, KHÔNG phải prototype
- UI/UX phải chuyên nghiệp — dark theme, industrial aesthetic

---

## Tech Stack (BẮT BUỘC)

| Layer | Tech | Version |
|-------|------|---------|
| Frontend | React + TypeScript | React 18+ |
| Build tool | Vite | Latest |
| Styling | Tailwind CSS + shadcn/ui | Latest |
| Routing | React Router | v7 |
| State | Zustand | Latest |
| Data fetching | TanStack Query | v5 |
| Backend | Node.js + Hono | Latest |
| Database | SQLite via better-sqlite3 | Latest |
| ORM | Drizzle ORM | Latest |
| Search | Fuse.js | Latest |
| Charts | Recharts | Latest |
| PDF | @react-pdf/renderer | Latest |
| Icons | Lucide React | Latest |
| Tables | TanStack Table | v8 |
| Forms | React Hook Form + Zod | Latest |
| Date | date-fns | Latest |
| DnD (Kanban) | @dnd-kit | Latest |

**Sau khi hoàn thành:** Wrap Electron shell để chạy như desktop app.

---

## Cấu trúc thư mục

```
songchau-crm/
├── CLAUDE.md                  # File này
├── package.json
├── vite.config.ts
├── drizzle.config.ts
├── tailwind.config.ts
├── tsconfig.json
│
├── server/
│   ├── index.ts               # Hono server, port 3001
│   ├── db/
│   │   ├── schema.ts          # Drizzle schema (12 bảng)
│   │   ├── migrations/
│   │   ├── seed.ts            # Seed data catalog Song Châu
│   │   └── index.ts           # DB connection
│   ├── routes/
│   │   ├── customers.ts
│   │   ├── suppliers.ts
│   │   ├── products.ts
│   │   ├── quotations.ts
│   │   ├── orders.ts
│   │   ├── pipeline.ts
│   │   ├── activities.ts
│   │   └── dashboard.ts
│   └── utils/
│       ├── pdf-generator.ts
│       └── catalog-parser.ts  # Parse PDF catalog
│
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── components/
│   │   ├── ui/                # shadcn/ui
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── MainLayout.tsx
│   │   ├── customers/
│   │   ├── suppliers/
│   │   ├── products/
│   │   ├── quotations/
│   │   ├── orders/
│   │   ├── pipeline/
│   │   └── dashboard/
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Customers.tsx
│   │   ├── Suppliers.tsx
│   │   ├── Products.tsx
│   │   ├── Quotations.tsx
│   │   ├── Orders.tsx
│   │   ├── Pipeline.tsx
│   │   ├── ProductLookup.tsx
│   │   └── Settings.tsx
│   ├── hooks/
│   ├── lib/
│   │   ├── api.ts
│   │   ├── utils.ts
│   │   └── constants.ts
│   └── types/
│       └── index.ts
│
├── data/
│   └── catalog-seed.json      # Parsed catalog data
│
└── scripts/
    ├── parse-catalog.ts       # Script parse PDF → JSON
    └── backup-db.ts
```

---

## Design System

### Theme: Industrial Dark
```
Fonts:
  Display: "Plus Jakarta Sans" (headings)
  Body: "Inter" (general text)
  Mono: "JetBrains Mono" (part numbers, prices, codes)

Colors:
  Primary: #2563eb (Industrial Blue)
  Accent: #f97316 (Engineering Orange)
  Success: #22c55e
  Danger: #ef4444
  Background: #0f172a (primary), #1e293b (cards)
  Text: #f8fafc (primary), #94a3b8 (secondary)

Pipeline Stage Colors:
  Lead: #8b5cf6 (Purple)
  Qualified: #3b82f6 (Blue)
  Proposal: #f59e0b (Amber)
  Negotiation: #f97316 (Orange)
  Won: #22c55e (Green)
  Lost: #ef4444 (Red)

Customer Type Badges:
  FDI-Japan: red
  FDI-Korea: blue
  FDI-China: orange
  FDI-Taiwan: purple
  Domestic: green

Cards: bg-slate-800/50 border border-slate-700/50 rounded-xl
Tables: Striped rows, sticky header, hover:bg-slate-700/50
Part numbers: Always render in JetBrains Mono, tracking-wide
```

### Layout
```
┌────────────────────────────────────────────────────┐
│ Sidebar (240px)  │  Header (search + notifications)│
│                  │────────────────────────────────│
│ 🏠 Dashboard     │  Main Content                   │
│ 🔍 Tra cứu       │                                 │
│ 📦 Sản phẩm      │                                 │
│ 👥 Khách hàng    │                                 │
│ 🏭 Nhà cung cấp  │                                 │
│ 💰 Báo giá       │                                 │
│ 📋 Đơn hàng      │                                 │
│ 📊 Pipeline      │                                 │
│ ──────────       │                                 │
│ ⚙️ Cài đặt       │                                 │
│                  │                                 │
│ Song Châu CRM   │                                 │
└────────────────────────────────────────────────────┘
```

### UI Patterns
- Command palette: Ctrl+K — search everything
- Slide-over panels: Chi tiết entity (right side panel)
- Modal dialogs: Forms tạo/sửa
- Toast notifications: Thành công/lỗi
- Skeleton loading: Khi fetch data
- Empty states: Illustration + CTA khi chưa có data
- Keyboard shortcuts: Ctrl+N (new), Ctrl+S (save), Esc (close)

---

## Database Schema (Drizzle ORM)

### Bảng 1: customers
```typescript
export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyName: text('company_name').notNull(),
  companyNameLocal: text('company_name_local'),
  type: text('type').notNull(), // 'fdi_japan' | 'fdi_korea' | 'fdi_china' | 'fdi_taiwan' | 'fdi_other' | 'domestic'
  industry: text('industry'), // 'electronics' | 'automotive' | 'semiconductor' | 'pcb'
  industrialZone: text('industrial_zone'),
  province: text('province'),
  address: text('address'),
  contactName: text('contact_name'),
  contactTitle: text('contact_title'),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  contactZalo: text('contact_zalo'),
  contactWechat: text('contact_wechat'),
  contact2Name: text('contact2_name'),
  contact2Title: text('contact2_title'),
  contact2Phone: text('contact2_phone'),
  contact2Email: text('contact2_email'),
  smtBrands: text('smt_brands'), // JSON array: ['Panasonic','Fuji']
  smtModels: text('smt_models'), // JSON array: ['NPM-W2','NXT-III']
  purchaseFrequency: text('purchase_frequency'), // 'weekly'|'monthly'|'quarterly'|'as_needed'
  estimatedAnnualValue: real('estimated_annual_value'),
  paymentTerms: text('payment_terms'), // 'cod'|'net15'|'net30'|'net45'|'net60'
  tier: text('tier'), // 'A'|'B'|'C'|'D'
  status: text('status').default('active'),
  source: text('source'), // 'referral'|'cold_call'|'exhibition'|'online'
  tags: text('tags'), // JSON array
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
```

### Bảng 2: suppliers
```typescript
export const suppliers = sqliteTable('suppliers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyName: text('company_name').notNull(),
  companyNameLocal: text('company_name_local'),
  country: text('country').notNull(), // 'china'|'japan'|'taiwan'|'korea'|'vietnam'
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  contactWechat: text('contact_wechat'),
  contactLine: text('contact_line'),
  platform: text('platform'), // 'alibaba'|'1688'|'direct'|'smtnet'|'exhibition'
  platformUrl: text('platform_url'),
  rating: integer('rating'), // 1-5
  qualityScore: integer('quality_score'), // 1-10
  deliveryScore: integer('delivery_score'), // 1-10
  priceScore: integer('price_score'), // 1-10
  speciality: text('speciality'), // JSON array
  brands: text('brands'), // JSON array
  minOrderValue: real('min_order_value'),
  leadTimeDays: integer('lead_time_days'),
  paymentMethods: text('payment_methods'), // JSON array
  status: text('status').default('active'),
  tags: text('tags'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
```

### Bảng 3: products
```typescript
export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  partNumber: text('part_number').notNull().unique(),
  name: text('name').notNull(),
  nameLocal: text('name_local'),
  category: text('category').notNull(), // 'nozzle'|'feeder'|'filter'|'belt'|'cylinder'|'sensor'|'motor'|'bearing'|'valve'|'esd'|'solder_tool'|'machine'|'electronic_component'|'dispensing'|'microscope'|'label'|'cleanroom'|'other'
  subcategory: text('subcategory'),
  brand: text('brand'), // 'Panasonic'|'Fuji'|'Samsung'|'JUKI'|'Yamaha'|'Hitachi'|'Casio'|'Sanyo'|'ASM/Siemens'|'Assembleon'
  machineModel: text('machine_model'),
  material: text('material'), // 'ceramic'|'metal'|'rubber'|'o-ring'|'plastic'
  size: text('size'),
  specifications: text('specifications'), // JSON
  costPrice: real('cost_price'),
  costCurrency: text('cost_currency').default('VND'),
  sellingPrice: real('selling_price'),
  sellingCurrency: text('selling_currency').default('VND'),
  marginPercent: real('margin_percent'),
  isConsumable: integer('is_consumable', { mode: 'boolean' }).default(false),
  stockQuantity: integer('stock_quantity').default(0),
  reorderLevel: integer('reorder_level').default(0),
  unit: text('unit').default('piece'),
  imageUrl: text('image_url'),
  status: text('status').default('active'),
  tags: text('tags'),
  notes: text('notes'),
  remark: text('remark'), // Component size info (0402, 0603, 1005, etc.)
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
```

### Bảng 4: supplier_products
```typescript
export const supplierProducts = sqliteTable('supplier_products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  supplierId: integer('supplier_id').references(() => suppliers.id),
  productId: integer('product_id').references(() => products.id),
  costPrice: real('cost_price'),
  costCurrency: text('cost_currency').default('USD'),
  moq: integer('moq'),
  leadTimeDays: integer('lead_time_days'),
  lastPurchaseDate: text('last_purchase_date'),
  lastPurchasePrice: real('last_purchase_price'),
  notes: text('notes'),
});
```

### Bảng 5: quotations
```typescript
export const quotations = sqliteTable('quotations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  quoteNumber: text('quote_number').notNull().unique(), // SC-Q-2026-0001
  customerId: integer('customer_id').references(() => customers.id),
  status: text('status').default('draft'), // 'draft'|'sent'|'viewed'|'accepted'|'rejected'|'expired'
  subtotal: real('subtotal'),
  taxRate: real('tax_rate').default(10),
  taxAmount: real('tax_amount'),
  totalAmount: real('total_amount'),
  currency: text('currency').default('VND'),
  validUntil: text('valid_until'),
  notes: text('notes'),
  internalNotes: text('internal_notes'),
  sentAt: text('sent_at'),
  acceptedAt: text('accepted_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
```

### Bảng 6: quote_items
```typescript
export const quoteItems = sqliteTable('quote_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  quotationId: integer('quotation_id').references(() => quotations.id),
  productId: integer('product_id').references(() => products.id),
  supplierId: integer('supplier_id').references(() => suppliers.id),
  quantity: integer('quantity').notNull(),
  unitPrice: real('unit_price').notNull(),
  costPrice: real('cost_price'),
  amount: real('amount'),
  notes: text('notes'),
});
```

### Bảng 7: orders
```typescript
export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderNumber: text('order_number').notNull().unique(), // SC-PO-2026-0001
  quotationId: integer('quotation_id').references(() => quotations.id),
  customerId: integer('customer_id').references(() => customers.id),
  status: text('status').default('confirmed'), // 'confirmed'|'purchasing'|'in_transit'|'quality_check'|'delivered'|'completed'|'cancelled'
  poNumber: text('po_number'),
  totalAmount: real('total_amount'),
  currency: text('currency').default('VND'),
  paymentStatus: text('payment_status').default('unpaid'), // 'unpaid'|'partial'|'paid'
  paidAmount: real('paid_amount').default(0),
  paymentDueDate: text('payment_due_date'),
  expectedDelivery: text('expected_delivery'),
  actualDelivery: text('actual_delivery'),
  deliveryAddress: text('delivery_address'),
  trackingNumber: text('tracking_number'),
  notes: text('notes'),
  internalNotes: text('internal_notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
```

### Bảng 8: order_items
```typescript
export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').references(() => orders.id),
  productId: integer('product_id').references(() => products.id),
  supplierId: integer('supplier_id').references(() => suppliers.id),
  quantity: integer('quantity').notNull(),
  unitPrice: real('unit_price').notNull(),
  costPrice: real('cost_price'),
  amount: real('amount'),
  status: text('status').default('pending'), // 'pending'|'ordered'|'shipped'|'received'|'delivered'
  supplierOrderDate: text('supplier_order_date'),
  supplierDeliveryDate: text('supplier_delivery_date'),
});
```

### Bảng 9: pipeline
```typescript
export const pipeline = sqliteTable('pipeline', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').references(() => customers.id),
  title: text('title').notNull(),
  stage: text('stage').default('lead'), // 'lead'|'qualified'|'proposal'|'negotiation'|'won'|'lost'
  dealValue: real('deal_value'),
  currency: text('currency').default('VND'),
  probability: integer('probability'), // 0-100
  expectedCloseDate: text('expected_close_date'),
  actualCloseDate: text('actual_close_date'),
  lostReason: text('lost_reason'),
  quotationId: integer('quotation_id').references(() => quotations.id),
  assignedTo: text('assigned_to'),
  notes: text('notes'),
  tags: text('tags'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
```

### Bảng 10: activities
```typescript
export const activities = sqliteTable('activities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entityType: text('entity_type').notNull(), // 'customer'|'supplier'|'order'|'pipeline'
  entityId: integer('entity_id').notNull(),
  type: text('type').notNull(), // 'call'|'email'|'visit'|'meeting'|'note'|'wechat'|'zalo'|'quotation_sent'|'order_placed'|'payment_received'|'follow_up'
  title: text('title'),
  content: text('content'),
  followUpAt: text('follow_up_at'),
  followUpDone: integer('follow_up_done', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});
```

### Bảng 11: settings
```typescript
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
```

### Bảng 12: product_categories (cho catalog navigation)
```typescript
export const productCategories = sqliteTable('product_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  nameLocal: text('name_local'),
  slug: text('slug').notNull().unique(),
  parentId: integer('parent_id'),
  icon: text('icon'),
  sortOrder: integer('sort_order').default(0),
  description: text('description'),
});
```

---

## Catalog Song Châu — TOÀN BỘ DỮ LIỆU SEED

### Quan trọng: Khi build, phải seed TẤT CẢ data dưới đây vào database.

### Product Categories (top-level)
```json
[
  { "name": "SMT Nozzles", "slug": "nozzle", "icon": "Target" },
  { "name": "SMT Feeder Parts", "slug": "feeder", "icon": "Layers" },
  { "name": "SMT Spare Parts", "slug": "spare-parts", "icon": "Wrench" },
  { "name": "SMT Machines", "slug": "machine", "icon": "Factory" },
  { "name": "Soldering & Rework", "slug": "solder-tool", "icon": "Flame" },
  { "name": "Dispensing Equipment", "slug": "dispensing", "icon": "Pipette" },
  { "name": "ESD & Cleanroom", "slug": "esd", "icon": "Shield" },
  { "name": "Electronic Components", "slug": "electronic-component", "icon": "Cpu" },
  { "name": "Electric & Automatic Tools", "slug": "electric-tool", "icon": "Zap" },
  { "name": "Microscopes", "slug": "microscope", "icon": "Search" },
  { "name": "Label & Ribbon", "slug": "label", "icon": "Tag" },
  { "name": "Tweezers & Pliers", "slug": "tweezers", "icon": "Scissors" },
  { "name": "Fume Extractors", "slug": "fume-extractor", "icon": "Wind" }
]
```

### NOZZLE DATA — Panasonic AM100
```json
[
  { "partNumber": "256M", "name": "256M", "spec": "0.39×0.3", "material": "CERAMIC", "remark": "0402", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "225M", "name": "225M", "spec": "0.6×0.35", "material": "CERAMIC", "remark": "0603", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "226M", "name": "226M", "spec": "0.6×0.5", "material": "CERAMIC", "remark": "0603,1005", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "230M", "name": "230M", "spec": "1.0×0.6", "material": "CERAMIC", "remark": "1005,1608", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "235M", "name": "235M", "spec": "1.6×0.8", "material": "CERAMIC", "remark": "1608~3216", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "387M", "name": "387M", "spec": "1.6×1.1", "material": "CERAMIC", "remark": "3216,4532", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "120MT", "name": "120MT", "spec": "Φ1.3/Φ0.9", "material": "METAL", "remark": "2012,3216", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "240MT", "name": "240MT", "spec": "Φ2.4/Φ1.8", "material": "METAL", "remark": "3216,4532", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "260M", "name": "260M", "spec": "Φ5.0/Φ3.0", "material": "METAL", "remark": "TAN", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "184MTR", "name": "184MTR", "spec": "Φ6.0/Φ4.0", "material": "METAL", "remark": "SOP,QFP", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "140M", "name": "140M", "spec": "Φ4.0", "material": "RUBBER", "remark": "IC", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "185M", "name": "185M", "spec": "Φ6.0", "material": "RUBBER", "remark": "QFP,PLCC", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "388M", "name": "388M", "spec": "Φ7.0", "material": "RUBBER", "remark": "QFP,PLCC", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "389M", "name": "389M", "spec": "Φ8.0", "material": "RUBBER", "remark": "QFP,PLCC", "brand": "Panasonic", "model": "AM100" },
  { "partNumber": "199MR", "name": "199MR", "spec": "Φ10.0", "material": "RUBBER", "remark": "Large Component", "brand": "Panasonic", "model": "AM100" }
]
```

### NOZZLE DATA — Panasonic CM series (CM82C-ME, CM82C-MG, CM85C-MGU, CM86C-M2)
Dùng cùng bộ nozzle với AM100 (các mã 256M, 225M, 226M... ở trên).

### NOZZLE DATA — Panasonic NPM
```json
[
  { "partNumber": "KXFX037UA00", "name": "110", "spec": "110", "material": "CERAMIC", "brand": "Panasonic", "model": "NPM" },
  { "partNumber": "KXFX03DJA00", "name": "115", "spec": "115", "material": "CERAMIC", "brand": "Panasonic", "model": "NPM" },
  { "partNumber": "KXFX0383A00", "name": "120", "spec": "120", "material": "CERAMIC", "brand": "Panasonic", "model": "NPM" },
  { "partNumber": "KXFX0384A00", "name": "130", "spec": "130", "material": "CERAMIC", "brand": "Panasonic", "model": "NPM" },
  { "partNumber": "KXFX0385A00", "name": "140", "spec": "140", "material": "METAL", "brand": "Panasonic", "model": "NPM" },
  { "partNumber": "KXFX0386A00", "name": "150", "spec": "150", "material": "METAL", "brand": "Panasonic", "model": "NPM" },
  { "partNumber": "KXFX055PA00", "name": "160", "spec": "160", "material": "RUBBER", "brand": "Panasonic", "model": "NPM" },
  { "partNumber": "KXFX03E4A00", "name": "170", "spec": "170", "material": "RUBBER", "brand": "Panasonic", "model": "NPM" },
  { "partNumber": "KXFX03E3A00", "name": "180", "spec": "180", "material": "RUBBER", "brand": "Panasonic", "model": "NPM" },
  { "partNumber": "KXFX05FKA00", "name": "190", "spec": "190", "material": "RUBBER", "brand": "Panasonic", "model": "NPM" },
  { "partNumber": "KXFX05FLA00", "name": "200", "spec": "200", "material": "RUBBER", "brand": "Panasonic", "model": "NPM" }
]
```

### NOZZLE DATA — Fuji NXT-H04
```json
[
  { "partNumber": "AA06W00", "name": "Φ1.0", "spec": "Φ1.0/Φ0.7", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA06X00", "name": "Φ1.3", "spec": "Φ1.3/Φ1.0", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA06Y00", "name": "Φ1.8", "spec": "Φ1.8", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA06Z00", "name": "Φ2.5", "spec": "Φ2.5", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA07F00", "name": "Φ2.5G", "spec": "Φ2.5", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA07A00", "name": "Φ3.7", "spec": "Φ3.7", "material": "METAL", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA0G00", "name": "Φ3.7G", "spec": "Φ3.7", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA07B00", "name": "Φ5.0", "spec": "Φ5.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA0H00", "name": "Φ5.0G", "spec": "Φ5.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA07C00", "name": "Φ7.0", "spec": "Φ7.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA07K00", "name": "Φ7.0G", "spec": "Φ7.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA07D00", "name": "Φ10.0", "spec": "Φ10.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H04" },
  { "partNumber": "AA07L00", "name": "Φ10.0G", "spec": "Φ10.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H04" }
]
```

### NOZZLE DATA — Fuji NXT-H04S
```json
[
  { "partNumber": "AA8TE00", "name": "Φ1.3", "spec": "Φ1.3/Φ1.0", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H04S" },
  { "partNumber": "AA8WW00", "name": "Φ1.8", "spec": "Φ1.8", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H04S" },
  { "partNumber": "AA8WX00", "name": "Φ2.5", "spec": "Φ2.5", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H04S" },
  { "partNumber": "AA8XA00", "name": "Φ2.5G", "spec": "Φ2.5", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H04S" },
  { "partNumber": "AA93W00", "name": "Φ3.7", "spec": "Φ3.7", "material": "METAL", "brand": "Fuji", "model": "NXT-H04S" },
  { "partNumber": "AA8XB00", "name": "Φ3.7G", "spec": "Φ3.7", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H04S" },
  { "partNumber": "AA93X00", "name": "Φ5.0", "spec": "Φ5.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H04S" },
  { "partNumber": "AA8XC00", "name": "Φ5.0G", "spec": "Φ5.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H04S" },
  { "partNumber": "AA93Y00", "name": "Φ7.0", "spec": "Φ7.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H04S" },
  { "partNumber": "AA8XD00", "name": "Φ7.0G", "spec": "Φ7.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H04S" }
]
```

### NOZZLE DATA — Fuji NXT AIM-H08M
```json
[
  { "partNumber": "AA8DX00", "name": "Φ0.7", "spec": "Φ0.7/Φ0.4", "material": "CERAMIC", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8LT00", "name": "Φ1.0", "spec": "Φ1.0/Φ0.7", "material": "CERAMIC", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8DY00", "name": "Φ1.3", "spec": "Φ1.3/Φ1.0", "material": "CERAMIC", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8LW00", "name": "Φ1.8", "spec": "Φ1.8", "material": "CERAMIC", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8LX00", "name": "Φ2.5", "spec": "Φ2.5", "material": "CERAMIC", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8ME00", "name": "Φ2.5G", "spec": "Φ2.5", "material": "RUBBER", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8LY00", "name": "Φ3.7", "spec": "Φ3.7", "material": "METAL", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8MF00", "name": "Φ3.7G", "spec": "Φ3.7", "material": "RUBBER", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8LZ00", "name": "Φ5.0", "spec": "Φ5.0", "material": "METAL", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8MG00", "name": "Φ5.0G", "spec": "Φ5.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8MA00", "name": "Φ7.0", "spec": "Φ7.0", "material": "METAL", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8MH00", "name": "Φ7.0G", "spec": "Φ7.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8MB00", "name": "Φ10.0", "spec": "Φ10.0", "material": "METAL", "brand": "Fuji", "model": "NXT AIM-H08M" },
  { "partNumber": "AA8MK00", "name": "Φ10.0G", "spec": "Φ10.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT AIM-H08M" }
]
```

### NOZZLE DATA — Fuji NXT M-III 24HEAD
```json
[
  { "partNumber": "2AGKNX005203", "name": "Φ0.3", "spec": "Φ0.3", "material": "CERAMIC", "brand": "Fuji", "model": "NXT M-III 24HEAD" },
  { "partNumber": "2AGKNX005303", "name": "Φ0.4", "spec": "Φ0.4", "material": "CERAMIC", "brand": "Fuji", "model": "NXT M-III 24HEAD" },
  { "partNumber": "2AGKNX005502", "name": "Φ0.5", "spec": "Φ0.5", "material": "CERAMIC", "brand": "Fuji", "model": "NXT M-III 24HEAD" },
  { "partNumber": "2AGKNX003106", "name": "Φ0.7", "spec": "Φ0.7", "material": "CERAMIC", "brand": "Fuji", "model": "NXT M-III 24HEAD" },
  { "partNumber": "2AGKNX003504", "name": "Φ1.0", "spec": "Φ1.0", "material": "CERAMIC", "brand": "Fuji", "model": "NXT M-III 24HEAD" },
  { "partNumber": "2AGKNX001703", "name": "Φ1.3", "spec": "Φ1.3", "material": "CERAMIC", "brand": "Fuji", "model": "NXT M-III 24HEAD" },
  { "partNumber": "2AGKNX003703", "name": "Φ1.8", "spec": "Φ1.8", "material": "CERAMIC", "brand": "Fuji", "model": "NXT M-III 24HEAD" },
  { "partNumber": "2AGKNX003903", "name": "Φ2.5", "spec": "Φ2.5", "material": "CERAMIC", "brand": "Fuji", "model": "NXT M-III 24HEAD" }
]
```

### NOZZLE DATA — Fuji NXT-H08, H12
```json
[
  { "partNumber": "AA1AT00", "name": "Φ0.3", "spec": "Φ0.4/Φ0.25", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA05600", "name": "Φ0.4", "spec": "0.4×0.3", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA05700", "name": "Φ0.7", "spec": "Φ0.7/Φ0.38", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA05800", "name": "Φ1.0", "spec": "Φ1.0/Φ0.7", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA20A00", "name": "Φ1.3", "spec": "Φ1.3/Φ1.0", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA20B00", "name": "Φ1.8", "spec": "Φ1.8", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA20C01", "name": "Φ2.5", "spec": "Φ2.5", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA0WT00", "name": "Φ2.5G", "spec": "Φ2.5", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA20D00", "name": "Φ3.7", "spec": "Φ3.7", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA18C00", "name": "Φ3.7G", "spec": "Φ3.7", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA20E00", "name": "Φ5.0", "spec": "Φ5.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H08, H12" },
  { "partNumber": "AA06300", "name": "Φ5.0G", "spec": "Φ5.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H08, H12" }
]
```

### NOZZLE DATA — Fuji NXT-H01, H02
```json
[
  { "partNumber": "AA0AS00", "name": "Φ1.0", "spec": "Φ1.0/Φ0.7", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA06800", "name": "Φ1.3", "spec": "Φ1.3/Φ1.0", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA0HL00", "name": "Φ1.8", "spec": "Φ1.8", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA0HM00", "name": "Φ2.5", "spec": "Φ2.5", "material": "CERAMIC", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA08410", "name": "Φ2.5G", "spec": "Φ2.5", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA0HN00", "name": "Φ3.7", "spec": "Φ3.7", "material": "METAL", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA08500", "name": "Φ3.7G", "spec": "Φ3.7", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA0HR01", "name": "Φ5.0", "spec": "Φ5.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA07200", "name": "Φ5.0G", "spec": "Φ5.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA08000", "name": "Φ7.0", "spec": "Φ7.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA07310", "name": "Φ7.0G", "spec": "Φ7.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA08100", "name": "Φ10.0", "spec": "Φ10.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA07410", "name": "Φ10.0G", "spec": "Φ10.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA08200", "name": "Φ15.0", "spec": "Φ15.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA07510", "name": "Φ15.0G", "spec": "Φ15.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA08300", "name": "Φ20.0", "spec": "Φ20.0", "material": "METAL", "brand": "Fuji", "model": "NXT-H01, H02" },
  { "partNumber": "AA07610", "name": "Φ20.0G", "spec": "Φ20.0", "material": "RUBBER", "brand": "Fuji", "model": "NXT-H01, H02" }
]
```

### NOZZLE DATA — Casio YCM-7000/7700/7800/8800
```json
[
  { "partNumber": "H03/H3M", "name": "H03/H3M", "spec": "0.4×0.5/Φ0.25", "material": "CERAMIC", "remark": "0603", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "HS1/H1M", "name": "HS1/H1M", "spec": "Φ0.7/Φ0.38", "material": "CERAMIC", "remark": "1005", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "H2/H2M", "name": "H2/H2M", "spec": "Φ1.1/Φ0.65", "material": "CERAMIC", "remark": "1608", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "H06", "name": "H06", "spec": "Φ1.2/Φ0.9", "material": "CERAMIC", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "H7", "name": "H7", "spec": "Φ2.0/Φ1.4", "material": "CERAMIC", "remark": "3216", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "H21 MELF", "name": "H21 MELF", "spec": "Φ0.8/Φ0.45", "material": "CERAMIC", "remark": "MELF", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "H22 MELF", "name": "H22 MELF", "spec": "Φ1.2/Φ0.9", "material": "CERAMIC", "remark": "MELF", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "H23 MELF", "name": "H23 MELF", "spec": "Φ2.0/Φ1.4", "material": "CERAMIC", "remark": "MELF", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "T7", "name": "T7", "spec": "Φ2.0/Φ1.4", "material": "CERAMIC", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "T06", "name": "T06", "spec": "Φ1.6/Φ1.0", "material": "CERAMIC", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "T21 MELF", "name": "T21 MELF", "spec": "Φ0.8/Φ0.45", "material": "CERAMIC", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "T22 MELF", "name": "T22 MELF", "spec": "Φ1.2/Φ0.9", "material": "CERAMIC", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" },
  { "partNumber": "T23 MELF", "name": "T23 MELF", "spec": "Φ2.1/Φ1.4", "material": "CERAMIC", "brand": "Casio", "model": "YCM-7000,7700,7800,8800" }
]
```

### NOZZLE DATA — Yamaha YSM40
```json
[
  { "partNumber": "KLF-M87A0-A0", "name": "510A", "spec": "0.25×0.35(□)", "material": "CERAMIC", "remark": "0402", "brand": "Yamaha", "model": "YSM40" },
  { "partNumber": "KLF-M8710-A0", "name": "511A", "spec": "0.35×0.75(□)", "material": "CERAMIC", "remark": "0603", "brand": "Yamaha", "model": "YSM40" },
  { "partNumber": "KLF-M8720-A0", "name": "512A", "spec": "1.2×0.45(□)", "material": "CERAMIC", "remark": "1005", "brand": "Yamaha", "model": "YSM40" },
  { "partNumber": "KLF-M8730-A1", "name": "513A", "spec": "1.3×2.0(±)", "material": "CERAMIC", "remark": "2012", "brand": "Yamaha", "model": "YSM40" },
  { "partNumber": "KLF-M7710-A0", "name": "501A", "spec": "0.8×0.7(X)", "material": "CERAMIC", "remark": "1005", "brand": "Yamaha", "model": "YSM40" },
  { "partNumber": "KLF-M7720-A0", "name": "502A", "spec": "1.0×1.7(X)", "material": "CERAMIC", "remark": "1608", "brand": "Yamaha", "model": "YSM40" },
  { "partNumber": "KLF-M8740-A0", "name": "503A/514A", "spec": "Φ4.0/3.0×2.0", "material": "METAL", "brand": "Yamaha", "model": "YSM40" },
  { "partNumber": "KLF-M8750-A0", "name": "504A/515A", "spec": "Φ8.0", "material": "O-ring", "brand": "Yamaha", "model": "YSM40" }
]
```

### NOZZLE DATA — Yamaha/Hitachi Σ-G4, Σ-G5 (High speed)
```json
[
  { "partNumber": "HG21C---", "name": "HG21C/HG22C", "spec": "0.5×0.3", "material": "CERAMIC", "remark": "0402", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HG32C---", "name": "HG31C/HG32C/HG33C", "spec": "0.7×0.4", "material": "CERAMIC", "remark": "0603", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HV32C---", "name": "HV31C/HV/32C", "spec": "0.7×0.4", "material": "CERAMIC", "remark": "0603", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HG52C---", "name": "HG51C/HG52C/HG53C", "spec": "1.1×0.6", "material": "CERAMIC", "remark": "1005", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HV51C---", "name": "HV51C/HV52C", "spec": "1.1×0.6", "material": "CERAMIC", "remark": "1005", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HG82C---", "name": "HG81C/HG82C/HG83C", "spec": "1.7×0.9", "material": "CERAMIC", "remark": "1608", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HV82C---", "name": "HV81C/HV82C", "spec": "1.7×0.9", "material": "CERAMIC", "remark": "1608", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HV13C---", "name": "HV13C/HV03C", "spec": "Φ1.3/Φ0.9", "material": "CERAMIC", "remark": "2012", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HV14C---", "name": "HV14C/HA04C", "spec": "Φ1.8/Φ1.1", "material": "CERAMIC", "remark": "3216", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HV15C---", "name": "HV15C/HA05C", "spec": "Φ3.0/Φ2.0", "material": "METAL", "remark": "4523", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HV19C---", "name": "HV19C/HA09C", "spec": "Φ6.0/Φ4.5", "material": "METAL", "remark": "SOP", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HB03C---", "name": "HB03C", "spec": "Φ1.3/Φ0.9", "material": "METAL", "remark": "2012~3216 MELF", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" },
  { "partNumber": "HB04C---", "name": "HB04C", "spec": "Φ1.8/Φ1.1", "material": "METAL", "remark": "3216~5922 MELF", "brand": "Yamaha/Hitachi", "model": "Σ-G4, Σ-G5" }
]
```

### NOZZLE DATA — Yamaha/Hitachi GXH-1, GXH-3 (High speed)
```json
[
  { "partNumber": "630 137 5472", "name": "HA11", "spec": "0.5×0.3", "material": "CERAMIC", "remark": "0402", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 152 8267", "name": "HV31/HV32", "spec": "0.7×0.4", "material": "CERAMIC", "remark": "0603", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 158 6571", "name": "HG31/HG32", "spec": "0.7×0.4", "material": "CERAMIC", "remark": "0603", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 128 4842", "name": "HA10", "spec": "0.7×0.4", "material": "CERAMIC", "remark": "0603", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 152 8472", "name": "HV51/HV52", "spec": "1.1×0.6", "material": "CERAMIC", "remark": "1005", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 159 9632", "name": "HG51/HG52", "spec": "1.1×0.6", "material": "CERAMIC", "remark": "1005", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 129 2878", "name": "HV01", "spec": "Φ0.6/Φ0.4", "material": "CERAMIC", "remark": "1005", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 132 2322", "name": "PV01", "spec": "1.1×0.6", "material": "CERAMIC", "remark": "1005", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 158 9084", "name": "HV81/HV82", "spec": "1.7×0.9", "material": "CERAMIC", "remark": "1608", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 161 3501", "name": "HG81/HG82", "spec": "1.7×0.9", "material": "CERAMIC", "remark": "1608", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 129 2885", "name": "HV02", "spec": "Φ0.9/Φ0.7", "material": "CERAMIC", "remark": "1608", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 129 2892", "name": "HV03", "spec": "Φ1.3/Φ0.9", "material": "CERAMIC", "remark": "2012~2125", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 129 2922", "name": "HV04", "spec": "Φ1.8/Φ1.1", "material": "CERAMIC", "remark": "3216", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 129 2908", "name": "HB03", "spec": "Φ1.3/Φ0.9", "material": "METAL", "remark": "2012 MELF", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 129 2922", "name": "HA04", "spec": "Φ1.8/Φ1.1", "material": "METAL", "remark": "3216", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" },
  { "partNumber": "630 129 2915", "name": "HB04", "spec": "Φ1.8/Φ1.1", "material": "METAL", "remark": "3216 MELF", "brand": "Yamaha/Hitachi", "model": "GXH-1, GXH-3" }
]
```

### NOZZLE DATA — ASM/Siemens 900 series (ORG.)(12HEAD)
```json
[
  { "partNumber": "00322603", "name": "901", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00348186", "name": "902", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00322602", "name": "904", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00345031", "name": "911", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00345020", "name": "913", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00321861", "name": "914", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00321862", "name": "915", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00321863", "name": "917", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00321864", "name": "918", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00321867", "name": "919", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00325972", "name": "920", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00325970", "name": "921", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00324996", "name": "923", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00321866", "name": "924", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00333652", "name": "925", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00346522", "name": "932", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00346523", "name": "933", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00327810", "name": "934", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00346524", "name": "935", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00352353", "name": "936", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00322591", "name": "937", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00322592", "name": "938", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00322593", "name": "939", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00330533", "name": "951", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00330534", "name": "952", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00330535", "name": "953", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00330536", "name": "954", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00330537", "name": "955", "brand": "ASM/Siemens", "model": "900 series 12HEAD" },
  { "partNumber": "00330538", "name": "956", "brand": "ASM/Siemens", "model": "900 series 12HEAD" }
]
```

### NOZZLE DATA — ASM/Siemens 1000 series (ORG.)(20HEAD)
```json
[
  { "partNumber": "03013307-01", "name": "1001", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03015869-01", "name": "1003", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03015840-01", "name": "1004", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03015854-01", "name": "1006", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03013300-01", "name": "1011", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03013303-01", "name": "1014", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03014327-01", "name": "1032", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03013425-01", "name": "1033", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03013103-01", "name": "1034", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03015194-01", "name": "1035", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03014331-01", "name": "1036", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03014336-01", "name": "1133", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03015384-01", "name": "1135", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" },
  { "partNumber": "03015222-01", "name": "1235", "brand": "ASM/Siemens", "model": "1000 series 20HEAD" }
]
```

### NON-NOZZLE PRODUCT CATEGORIES (seed as categories, Thắng sẽ thêm individual products khi đi làm)
```json
[
  { "category": "spare-parts", "items": ["Conveyor belt", "Nozzle", "Feeder", "Cylinder", "Filter", "Bearing", "Servo motor", "Shaft", "Valve", "Sensor", "Belt", "Thermocouple wire", "Motor", "Drive", "Slide", "O ring", "Blade", "Timing belt", "Gear motor", "PLC", "Linear Axis"] },
  { "category": "machine", "items": ["Solder Paste machine", "High precision printer", "Solder paste printing machine", "Reflow oven", "Automatic pick and place machine", "Vertical vision pick and place machine"] },
  { "category": "solder-tool", "items": ["Soldering stations", "Rework stations", "Desoldering Pumps", "Thermometers", "Solder tips"] },
  { "category": "dispensing", "items": ["Dispensing Controllers", "Needles", "Adapters & Barrels", "Soldering Robot", "Glue Dispensing Robot", "Screw Fastening Robot"] },
  { "category": "esd", "items": ["ESD Brushes", "Solvent Dispensers", "ESD Wrist Straps", "ESD Packaging Bag & Tapes", "ESD Table Mat", "ESD Stationery", "Cleanroom Wipers", "ESD Curtains", "Ionizing Air Blowers", "Conductive Trolley", "PCB Racks", "Magazine Racks"] },
  { "category": "electronic-component", "items": ["Samsung", "Murata", "Texas Instruments", "ROHM", "NXP", "Microchip", "Analog Devices", "YAGEO", "Xilinx"] },
  { "category": "electric-tool", "items": ["Electric Screwdrivers"] },
  { "category": "microscope", "items": ["Microscopes", "Spare Parts For Microscopes"] },
  { "category": "label", "items": ["Wax Ribbon", "Resin Ribbon", "Silver label", "PVC label", "Paper label", "Barcode scanner", "Label printing machine"] },
  { "category": "tweezers", "items": ["Tweezers", "Cutting Pliers", "Conductive Plastic Tweezers"] },
  { "category": "fume-extractor", "items": ["Solder Fume Extractor", "Cut Lead Extractor"] }
]
```

### SMT Machine Brands (for feeder parts reference)
Feeder parts available for: Panasonic, Yamaha, Hitachi, Fuji, Sony, JUKI, ASM, Casio, Sanyo, Samsung

---

## Build Sprints

### Sprint 1: Foundation + Products + Catalog (DAYS 1-4)
1. Init project: Vite + React + TS + Tailwind + shadcn/ui
2. Setup Hono server on port 3001
3. Setup SQLite + Drizzle ORM + ALL 12 tables
4. Create seed script — import ALL nozzle data above into products table
5. Build MainLayout: Sidebar (240px, dark) + Header + Content area
6. Build Products page: Table + filters (brand, model, material, category)
7. Build ProductLookup page: Big search bar, instant fuzzy search, filter cascade
8. Command palette (Ctrl+K)

### Sprint 2: Customers + Suppliers (DAYS 5-7)
1. Customers CRUD: List + Detail slide-over + Form
2. Suppliers CRUD: List + Detail + Rating system
3. Activity timeline on both entities
4. Industrial zone dropdown data

### Sprint 3: Quotations + PDF (DAYS 8-11)
1. Quotation CRUD: Create from product lookup
2. Quote items: Add products, set prices, auto-calculate
3. Margin calculator (cost vs selling)
4. PDF export: Professional Song Châu branded template
5. Quote status workflow: draft → sent → accepted/rejected

### Sprint 4: Orders + Pipeline (DAYS 12-15)
1. Orders: Create from accepted quotation
2. Order status tracking workflow
3. Payment tracking
4. Pipeline Kanban board (drag & drop stages)
5. Pipeline list view

### Sprint 5: Dashboard + Polish + Electron (DAYS 16-18)
1. Dashboard: KPI cards, charts (revenue, top products, top customers)
2. Follow-up reminders system
3. Settings page (company info, currency rates, number formats)
4. Keyboard shortcuts
5. Electron wrapper: electron-builder, auto-launch, tray icon
6. Final polish: loading states, empty states, error handling, transitions

---

## Company Info (for PDF headers, settings defaults)
```
Company: Song Châu Co., Ltd (Công Ty TNHH Một thành viên Song Châu)
Address: Zone 4, Tien Chau Ward, Phuc Yen City, Vinh Phuc Province
Tax code: 2500574479
Email: songchaucompanyltd@gmail.com
Phone: 0985145533
```

---

## IMPORTANT NOTES
- Database file location: `./data/songchau.db`
- All JSON fields (tags, smtBrands, etc.) store as JSON strings, parse on read
- Part numbers are CASE-SENSITIVE — preserve exact casing from catalog
- Prices default to VND, support multi-currency display
- Dark mode ONLY — no light mode toggle needed
- Vietnamese language for UI labels where appropriate (bilingual: VN + EN)
- The catalog PDF is at `/mnt/project/SC_Catalog_V20_3_1.pdf` — Claude Code should parse this to extract any additional data not listed above