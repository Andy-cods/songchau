const API_BASE = '/api'

export interface Product {
  id: number
  partNumber: string
  name: string
  nameLocal: string | null
  category: string
  subcategory: string | null
  brand: string | null
  machineModel: string | null
  material: string | null
  size: string | null
  specifications: string | null
  costPrice: number | null
  costCurrency: string
  sellingPrice: number | null
  sellingCurrency: string
  marginPercent: number | null
  isConsumable: boolean
  stockQuantity: number
  reorderLevel: number
  unit: string
  imageUrl: string | null
  status: string
  tags: string | null
  notes: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: number
  name: string
  nameLocal: string | null
  slug: string
  parentId: number | null
  icon: string | null
  sortOrder: number
  description: string | null
}

export interface ProductsResponse {
  data: Product[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface CategoriesResponse {
  data: Category[]
}

export interface StatsResponse {
  total: number
  byCategory: Array<{ category: string; count: number }>
  byBrand: Array<{ brand: string; count: number }>
}

// Fetch products with filters
export async function fetchProducts(params: {
  search?: string
  category?: string
  brand?: string
  machineModel?: string
  material?: string
  page?: number
  limit?: number
}): Promise<ProductsResponse> {
  const query = new URLSearchParams()

  if (params.search) query.append('search', params.search)
  if (params.category) query.append('category', params.category)
  if (params.brand) query.append('brand', params.brand)
  if (params.machineModel) query.append('machineModel', params.machineModel)
  if (params.material) query.append('material', params.material)
  if (params.page) query.append('page', params.page.toString())
  if (params.limit) query.append('limit', params.limit.toString())

  const res = await fetch(`${API_BASE}/products?${query}`)
  if (!res.ok) throw new Error('Failed to fetch products')
  return res.json()
}

// Fetch single product
export async function fetchProduct(id: number): Promise<{ data: Product }> {
  const res = await fetch(`${API_BASE}/products/${id}`)
  if (!res.ok) throw new Error('Failed to fetch product')
  return res.json()
}

// Create product
export async function createProduct(data: Partial<Product>): Promise<{ data: Product }> {
  const res = await fetch(`${API_BASE}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create product')
  return res.json()
}

// Update product
export async function updateProduct(id: number, data: Partial<Product>): Promise<{ data: Product }> {
  const res = await fetch(`${API_BASE}/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update product')
  return res.json()
}

// Delete product
export async function deleteProduct(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/products/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete product')
}

// Fetch categories
export async function fetchCategories(): Promise<CategoriesResponse> {
  const res = await fetch(`${API_BASE}/categories`)
  if (!res.ok) throw new Error('Failed to fetch categories')
  return res.json()
}

// Fetch product stats
export async function fetchProductStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_BASE}/products/stats`)
  if (!res.ok) throw new Error('Failed to fetch stats')
  return res.json()
}

// Fetch unique brands
export async function fetchBrands(): Promise<{ data: string[] }> {
  const res = await fetch(`${API_BASE}/products/brands`)
  if (!res.ok) throw new Error('Failed to fetch brands')
  return res.json()
}

// Fetch unique machine models (optionally filtered by brand)
export async function fetchMachineModels(brand?: string): Promise<{ data: string[] }> {
  const query = brand ? `?brand=${encodeURIComponent(brand)}` : ''
  const res = await fetch(`${API_BASE}/products/models${query}`)
  if (!res.ok) throw new Error('Failed to fetch models')
  return res.json()
}

// ==================== PRODUCT DETAIL DATA ====================

export interface SalesHistoryItem {
  id: number
  referenceNumber: string
  customerName: string
  date: string
  quantity: number
  unitPrice: number
  amount: number
  status: string
}

export interface SalesHistorySummary {
  totalSoldQty: number
  totalRevenue: number
  uniqueCustomers: number
  totalOrders: number
  totalQuotations: number
}

export interface ProductSupplier {
  id: number
  supplierId: number
  supplierName: string
  country: string
  platform: string | null
  rating: number | null
  qualityScore: number | null
  deliveryScore: number | null
  priceScore: number | null
  costPrice: number | null
  costCurrency: string
  moq: number | null
  leadTimeDays: number | null
  lastPurchaseDate: string | null
  lastPurchasePrice: number | null
  notes: string | null
}

export interface RelatedProduct {
  id: number
  partNumber: string
  name: string
  category: string
  material: string | null
  size: string | null
  sellingPrice: number | null
  sellingCurrency: string
  stockQuantity: number
}

export async function fetchProductSalesHistory(productId: number): Promise<{
  data: {
    orders: SalesHistoryItem[]
    quotations: SalesHistoryItem[]
    summary: SalesHistorySummary
  }
}> {
  const res = await fetch(`${API_BASE}/products/${productId}/sales-history`)
  if (!res.ok) throw new Error('Failed to fetch sales history')
  return res.json()
}

export async function fetchProductSuppliers(productId: number): Promise<{
  data: {
    suppliers: ProductSupplier[]
    bestPriceSupplierId: number | null
  }
}> {
  const res = await fetch(`${API_BASE}/products/${productId}/suppliers`)
  if (!res.ok) throw new Error('Failed to fetch product suppliers')
  return res.json()
}

export async function fetchRelatedProducts(productId: number): Promise<{ data: RelatedProduct[] }> {
  const res = await fetch(`${API_BASE}/products/${productId}/related`)
  if (!res.ok) throw new Error('Failed to fetch related products')
  return res.json()
}

// ==================== CUSTOMERS ====================

export interface Customer {
  id: number
  companyName: string
  companyNameLocal: string | null
  type: string
  industry: string | null
  industrialZone: string | null
  province: string | null
  address: string | null
  contactName: string | null
  contactTitle: string | null
  contactPhone: string | null
  contactEmail: string | null
  contactZalo: string | null
  contactWechat: string | null
  contact2Name: string | null
  contact2Title: string | null
  contact2Phone: string | null
  contact2Email: string | null
  smtBrands: string | null
  smtModels: string | null
  purchaseFrequency: string | null
  estimatedAnnualValue: number | null
  paymentTerms: string | null
  tier: string | null
  status: string
  source: string | null
  tags: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface CustomersResponse {
  data: Customer[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// Fetch customers with filters
export async function fetchCustomers(params: {
  search?: string
  type?: string
  province?: string
  tier?: string
  status?: string
  page?: number
  limit?: number
}): Promise<CustomersResponse> {
  const query = new URLSearchParams()

  if (params.search) query.append('search', params.search)
  if (params.type) query.append('type', params.type)
  if (params.province) query.append('province', params.province)
  if (params.tier) query.append('tier', params.tier)
  if (params.status) query.append('status', params.status)
  if (params.page) query.append('page', params.page.toString())
  if (params.limit) query.append('limit', params.limit.toString())

  const res = await fetch(`${API_BASE}/customers?${query}`)
  if (!res.ok) throw new Error('Failed to fetch customers')
  return res.json()
}

// Fetch single customer
export async function fetchCustomer(id: number): Promise<{ data: Customer }> {
  const res = await fetch(`${API_BASE}/customers/${id}`)
  if (!res.ok) throw new Error('Failed to fetch customer')
  return res.json()
}

// Create customer
export async function createCustomer(data: Partial<Customer>): Promise<{ data: Customer }> {
  const res = await fetch(`${API_BASE}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create customer')
  return res.json()
}

// Update customer
export async function updateCustomer(id: number, data: Partial<Customer>): Promise<{ data: Customer }> {
  const res = await fetch(`${API_BASE}/customers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update customer')
  return res.json()
}

// Delete customer
export async function deleteCustomer(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/customers/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete customer')
}

// ==================== SUPPLIERS ====================

export interface Supplier {
  id: number
  companyName: string
  companyNameLocal: string | null
  country: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  contactWechat: string | null
  contactLine: string | null
  platform: string | null
  platformUrl: string | null
  rating: number | null
  qualityScore: number | null
  deliveryScore: number | null
  priceScore: number | null
  speciality: string | null
  brands: string | null
  minOrderValue: number | null
  leadTimeDays: number | null
  paymentMethods: string | null
  status: string
  tags: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface SuppliersResponse {
  data: Supplier[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// Fetch suppliers with filters
export async function fetchSuppliers(params: {
  search?: string
  country?: string
  platform?: string
  status?: string
  minRating?: number
  page?: number
  limit?: number
}): Promise<SuppliersResponse> {
  const query = new URLSearchParams()

  if (params.search) query.append('search', params.search)
  if (params.country) query.append('country', params.country)
  if (params.platform) query.append('platform', params.platform)
  if (params.status) query.append('status', params.status)
  if (params.minRating) query.append('minRating', params.minRating.toString())
  if (params.page) query.append('page', params.page.toString())
  if (params.limit) query.append('limit', params.limit.toString())

  const res = await fetch(`${API_BASE}/suppliers?${query}`)
  if (!res.ok) throw new Error('Failed to fetch suppliers')
  return res.json()
}

// Fetch single supplier
export async function fetchSupplier(id: number): Promise<{ data: Supplier }> {
  const res = await fetch(`${API_BASE}/suppliers/${id}`)
  if (!res.ok) throw new Error('Failed to fetch supplier')
  return res.json()
}

// Create supplier
export async function createSupplier(data: Partial<Supplier>): Promise<{ data: Supplier }> {
  const res = await fetch(`${API_BASE}/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create supplier')
  return res.json()
}

// Update supplier
export async function updateSupplier(id: number, data: Partial<Supplier>): Promise<{ data: Supplier }> {
  const res = await fetch(`${API_BASE}/suppliers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update supplier')
  return res.json()
}

// Delete supplier
export async function deleteSupplier(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/suppliers/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete supplier')
}

// ==================== ACTIVITIES ====================

export interface Activity {
  id: number
  entityType: string
  entityId: number
  type: string
  title: string | null
  content: string | null
  followUpAt: string | null
  followUpDone: boolean
  createdAt: string
}

export interface ActivitiesResponse {
  data: Activity[]
}

// Fetch activities for an entity
export async function fetchActivities(params: {
  entityType: string
  entityId: number
  limit?: number
}): Promise<ActivitiesResponse> {
  const query = new URLSearchParams()
  query.append('entityType', params.entityType)
  query.append('entityId', params.entityId.toString())
  if (params.limit) query.append('limit', params.limit.toString())

  const res = await fetch(`${API_BASE}/activities?${query}`)
  if (!res.ok) throw new Error('Failed to fetch activities')
  return res.json()
}

// Create activity
export async function createActivity(data: Partial<Activity>): Promise<{ data: Activity }> {
  const res = await fetch(`${API_BASE}/activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create activity')
  return res.json()
}

// Update activity
export async function updateActivity(id: number, data: Partial<Activity>): Promise<{ data: Activity }> {
  const res = await fetch(`${API_BASE}/activities/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update activity')
  return res.json()
}

// Mark follow-up as done
export async function markFollowUpDone(id: number): Promise<{ data: Activity }> {
  const res = await fetch(`${API_BASE}/activities/${id}/follow-up-done`, {
    method: 'PATCH',
  })
  if (!res.ok) throw new Error('Failed to mark follow-up as done')
  return res.json()
}

// Delete activity
export async function deleteActivity(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/activities/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete activity')
}

// ==================== QUOTATIONS ====================

export interface QuoteItem {
  id?: number
  quotationId?: number
  productId: number
  productPartNumber?: string
  productName?: string
  supplierId?: number | null
  quantity: number
  unitPrice: number
  costPrice?: number | null
  amount: number
  notes?: string | null
}

export interface Quotation {
  id: number
  quoteNumber: string
  customerId: number
  customerName?: string
  customerContact?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  customerAddress?: string | null
  status: string
  subtotal: number | null
  taxRate: number
  taxAmount: number | null
  totalAmount: number | null
  currency: string
  validUntil: string | null
  notes: string | null
  internalNotes: string | null
  sentAt: string | null
  acceptedAt: string | null
  createdAt: string
  updatedAt: string
  items?: QuoteItem[]
}

export interface QuotationsResponse {
  data: Quotation[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// Get next quote number
export async function getNextQuoteNumber(): Promise<{ quoteNumber: string }> {
  const res = await fetch(`${API_BASE}/quotations/next-number`)
  if (!res.ok) throw new Error('Failed to get next quote number')
  return res.json()
}

// Fetch quotations with filters
export async function fetchQuotations(params: {
  search?: string
  status?: string
  customerId?: number
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}): Promise<QuotationsResponse> {
  const query = new URLSearchParams()

  if (params.search) query.append('search', params.search)
  if (params.status) query.append('status', params.status)
  if (params.customerId) query.append('customerId', params.customerId.toString())
  if (params.dateFrom) query.append('dateFrom', params.dateFrom)
  if (params.dateTo) query.append('dateTo', params.dateTo)
  if (params.page) query.append('page', params.page.toString())
  if (params.limit) query.append('limit', params.limit.toString())

  const res = await fetch(`${API_BASE}/quotations?${query}`)
  if (!res.ok) throw new Error('Failed to fetch quotations')
  return res.json()
}

// Fetch single quotation
export async function fetchQuotation(id: number): Promise<{ data: Quotation }> {
  const res = await fetch(`${API_BASE}/quotations/${id}`)
  if (!res.ok) throw new Error('Failed to fetch quotation')
  return res.json()
}

// Create quotation
export async function createQuotation(data: Partial<Quotation> & { items: QuoteItem[] }): Promise<{ data: Quotation }> {
  const res = await fetch(`${API_BASE}/quotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create quotation')
  return res.json()
}

// Update quotation
export async function updateQuotation(
  id: number,
  data: Partial<Quotation> & { items?: QuoteItem[] }
): Promise<{ data: Quotation }> {
  const res = await fetch(`${API_BASE}/quotations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update quotation')
  return res.json()
}

// Update quotation status
export async function updateQuotationStatus(id: number, status: string): Promise<{ data: Quotation }> {
  const res = await fetch(`${API_BASE}/quotations/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error('Failed to update quotation status')
  return res.json()
}

// Delete quotation
export async function deleteQuotation(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/quotations/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete quotation')
}

// ==================== ORDERS ====================

export interface OrderItem {
  id?: number
  orderId?: number
  productId: number
  productPartNumber?: string
  productName?: string
  supplierId?: number | null
  quantity: number
  unitPrice: number
  costPrice?: number | null
  amount: number
  status: string
  supplierOrderDate?: string | null
  supplierDeliveryDate?: string | null
}

export interface Order {
  id: number
  orderNumber: string
  quotationId?: number | null
  customerId: number
  customerName?: string
  customerContact?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  customerAddress?: string | null
  status: string
  poNumber?: string | null
  totalAmount: number | null
  currency: string
  paymentStatus: string
  paidAmount: number
  paymentDueDate?: string | null
  expectedDelivery?: string | null
  actualDelivery?: string | null
  deliveryAddress?: string | null
  trackingNumber?: string | null
  notes?: string | null
  internalNotes?: string | null
  createdAt: string
  updatedAt: string
  items?: OrderItem[]
}

export interface OrdersResponse {
  data: Order[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// Fetch orders with filters
export async function fetchOrders(params: {
  search?: string
  status?: string
  paymentStatus?: string
  customerId?: number
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}): Promise<OrdersResponse> {
  const query = new URLSearchParams()

  if (params.search) query.append('search', params.search)
  if (params.status) query.append('status', params.status)
  if (params.paymentStatus) query.append('paymentStatus', params.paymentStatus)
  if (params.customerId) query.append('customerId', params.customerId.toString())
  if (params.dateFrom) query.append('dateFrom', params.dateFrom)
  if (params.dateTo) query.append('dateTo', params.dateTo)
  if (params.page) query.append('page', params.page.toString())
  if (params.limit) query.append('limit', params.limit.toString())

  const res = await fetch(`${API_BASE}/orders?${query}`)
  if (!res.ok) throw new Error('Failed to fetch orders')
  return res.json()
}

// Fetch single order
export async function fetchOrder(id: number): Promise<{ data: Order }> {
  const res = await fetch(`${API_BASE}/orders/${id}`)
  if (!res.ok) throw new Error('Failed to fetch order')
  return res.json()
}

// Create order
export async function createOrder(data: Partial<Order> & { items: OrderItem[] }): Promise<{ data: Order }> {
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create order')
  return res.json()
}

// Update order
export async function updateOrder(
  id: number,
  data: Partial<Order> & { items?: OrderItem[] }
): Promise<{ data: Order }> {
  const res = await fetch(`${API_BASE}/orders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update order')
  return res.json()
}

// Update order status
export async function updateOrderStatus(id: number, status: string): Promise<{ data: Order }> {
  const res = await fetch(`${API_BASE}/orders/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error('Failed to update order status')
  return res.json()
}

// Record payment
export async function recordPayment(id: number, amount: number): Promise<{ data: Order }> {
  const res = await fetch(`${API_BASE}/orders/${id}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  })
  if (!res.ok) throw new Error('Failed to record payment')
  return res.json()
}

// Delete order
export async function deleteOrder(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/orders/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete order')
}

// ==================== PIPELINE ====================

export interface PipelineDeal {
  id: number
  customerId?: number | null
  customerName?: string
  title: string
  stage: string
  dealValue: number | null
  currency: string
  probability: number | null
  expectedCloseDate?: string | null
  actualCloseDate?: string | null
  lostReason?: string | null
  quotationId?: number | null
  assignedTo?: string | null
  notes?: string | null
  tags?: string | null
  createdAt: string
  updatedAt: string
}

export interface PipelineStageStats {
  stage: string
  count: number
  totalValue: number
  weightedValue: number
}

export interface PipelineStatsResponse {
  data: PipelineStageStats[]
  totalWeighted: number
}

export interface PipelineResponse {
  data: PipelineDeal[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// Get pipeline stats
export async function fetchPipelineStats(): Promise<PipelineStatsResponse> {
  const res = await fetch(`${API_BASE}/pipeline/stats`)
  if (!res.ok) throw new Error('Failed to fetch pipeline stats')
  return res.json()
}

// Fetch pipeline deals
export async function fetchPipeline(params: {
  search?: string
  stage?: string
  customerId?: number
  page?: number
  limit?: number
}): Promise<PipelineResponse> {
  const query = new URLSearchParams()

  if (params.search) query.append('search', params.search)
  if (params.stage) query.append('stage', params.stage)
  if (params.customerId) query.append('customerId', params.customerId.toString())
  if (params.page) query.append('page', params.page.toString())
  if (params.limit) query.append('limit', params.limit.toString())

  const res = await fetch(`${API_BASE}/pipeline?${query}`)
  if (!res.ok) throw new Error('Failed to fetch pipeline')
  return res.json()
}

// Fetch single deal
export async function fetchPipelineDeal(id: number): Promise<{ data: PipelineDeal }> {
  const res = await fetch(`${API_BASE}/pipeline/${id}`)
  if (!res.ok) throw new Error('Failed to fetch pipeline deal')
  return res.json()
}

// Create pipeline deal
export async function createPipelineDeal(data: Partial<PipelineDeal>): Promise<{ data: PipelineDeal }> {
  const res = await fetch(`${API_BASE}/pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create pipeline deal')
  return res.json()
}

// Update pipeline deal
export async function updatePipelineDeal(id: number, data: Partial<PipelineDeal>): Promise<{ data: PipelineDeal }> {
  const res = await fetch(`${API_BASE}/pipeline/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update pipeline deal')
  return res.json()
}

// Update pipeline stage
export async function updatePipelineStage(
  id: number,
  stage: string,
  lostReason?: string
): Promise<{ data: PipelineDeal }> {
  const res = await fetch(`${API_BASE}/pipeline/${id}/stage`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage, lostReason }),
  })
  if (!res.ok) throw new Error('Failed to update pipeline stage')
  return res.json()
}

// Delete pipeline deal
export async function deletePipelineDeal(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/pipeline/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete pipeline deal')
}

// ==================== DASHBOARD ====================

export interface DashboardStats {
  revenue: {
    current: number
    change: number
  }
  pendingOrders: number
  pendingQuotations: number
  pipelineValue: number
  totalCustomers: number
  totalProducts: number
  avgOrderValue: number
}

export interface RevenueByMonth {
  month: string
  revenue: number
}

export interface ProductsByCategory {
  category: string
  count: number
}

export interface TopCustomer {
  customerId: number
  customerName: string
  totalOrders: number
  revenue: number
}

// Get dashboard stats
export async function fetchDashboardStats(): Promise<DashboardStats> {
  const res = await fetch(`${API_BASE}/dashboard/stats`)
  if (!res.ok) throw new Error('Failed to fetch dashboard stats')
  return res.json()
}

// Get revenue by month
export async function fetchRevenueByMonth(): Promise<{ data: RevenueByMonth[] }> {
  const res = await fetch(`${API_BASE}/dashboard/revenue-by-month`)
  if (!res.ok) throw new Error('Failed to fetch revenue by month')
  return res.json()
}

// Get products by category
export async function fetchProductsByCategory(): Promise<{ data: ProductsByCategory[] }> {
  const res = await fetch(`${API_BASE}/dashboard/products-by-category`)
  if (!res.ok) throw new Error('Failed to fetch products by category')
  return res.json()
}

// Get top customers
export async function fetchTopCustomers(): Promise<{ data: TopCustomer[] }> {
  const res = await fetch(`${API_BASE}/dashboard/top-customers`)
  if (!res.ok) throw new Error('Failed to fetch top customers')
  return res.json()
}

// Get recent activities
export async function fetchRecentActivities(): Promise<ActivitiesResponse> {
  const res = await fetch(`${API_BASE}/dashboard/recent-activities`)
  if (!res.ok) throw new Error('Failed to fetch recent activities')
  return res.json()
}

// Get follow-up reminders
export async function fetchFollowUpReminders(): Promise<ActivitiesResponse> {
  const res = await fetch(`${API_BASE}/dashboard/follow-up-reminders`)
  if (!res.ok) throw new Error('Failed to fetch follow-up reminders')
  return res.json()
}

export async function fetchCustomerAcquisition(): Promise<{ data: { month: string; count: number }[] }> {
  const res = await fetch(`${API_BASE}/dashboard/customer-acquisition`)
  if (!res.ok) throw new Error('Failed to fetch customer acquisition data')
  return res.json()
}

// ==================== DASHBOARD MAP DATA ====================

export interface SuppliersByCountry {
  country: string
  count: number
}

export interface CustomersByProvince {
  province: string
  count: number
}

export async function fetchSuppliersByCountry(): Promise<{ data: SuppliersByCountry[] }> {
  const res = await fetch(`${API_BASE}/dashboard/suppliers-by-country`)
  if (!res.ok) throw new Error('Failed to fetch suppliers by country')
  return res.json()
}

export async function fetchCustomersByProvince(): Promise<{ data: CustomersByProvince[] }> {
  const res = await fetch(`${API_BASE}/dashboard/customers-by-province`)
  if (!res.ok) throw new Error('Failed to fetch customers by province')
  return res.json()
}

// ==================== SETTINGS ====================

export interface Settings {
  companyName: string
  companyNameLocal: string
  companyAddress: string
  companyTaxCode: string
  companyEmail: string
  companyPhone: string
  defaultCurrency: string
  usdToVnd: string
  cnyToVnd: string
  jpyToVnd: string
  taxRate: string
  quoteNumberPrefix: string
  orderNumberPrefix: string
}

// Get settings
export async function fetchSettings(): Promise<{ settings: Settings }> {
  const res = await fetch(`${API_BASE}/settings`)
  if (!res.ok) throw new Error('Failed to fetch settings')
  return res.json()
}

// Update settings
export async function updateSettings(settings: Partial<Settings>): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  })
  if (!res.ok) throw new Error('Failed to update settings')
  return res.json()
}

// Backup database
export async function backupDatabase(): Promise<Blob> {
  const res = await fetch(`${API_BASE}/settings/backup`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to backup database')
  return res.blob()
}
