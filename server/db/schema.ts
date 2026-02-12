import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// Bảng 1: customers
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
})

// Bảng 2: suppliers
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
})

// Bảng 3: products
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
})

// Bảng 4: supplier_products
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
})

// Bảng 5: quotations
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
})

// Bảng 6: quote_items
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
})

// Bảng 7: orders
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
})

// Bảng 8: order_items
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
})

// Bảng 9: pipeline
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
})

// Bảng 10: activities
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
})

// Bảng 11: order_documents
export const orderDocuments = sqliteTable('order_documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').references(() => orders.id).notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  type: text('type').default('other'), // 'contract'|'invoice'|'po'|'other'
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

// Bảng 12: settings
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

// Bảng 12: product_categories
export const productCategories = sqliteTable('product_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  nameLocal: text('name_local'),
  slug: text('slug').notNull().unique(),
  parentId: integer('parent_id'),
  icon: text('icon'),
  sortOrder: integer('sort_order').default(0),
  description: text('description'),
})
