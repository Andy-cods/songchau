import { useState, useEffect } from 'react'
import { X, Edit, Package, TrendingUp, Users, Star, AlertTriangle, Layers, Tag, ShoppingCart, FileText } from 'lucide-react'
import type { Product, SalesHistoryItem, SalesHistorySummary, ProductSupplier, RelatedProduct } from '@/lib/api'
import { fetchProductSalesHistory, fetchProductSuppliers, fetchRelatedProducts } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SUPPLIER_COUNTRIES } from '@/lib/constants'

interface ProductDetailProps {
  product: Product | null
  isOpen: boolean
  onClose: () => void
  onEdit?: (product: Product) => void
}

const materialColors: Record<string, string> = {
  CERAMIC: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  METAL: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  RUBBER: 'bg-green-500/10 text-green-600 border-green-500/20',
  'O-RING': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  PLASTIC: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
}

const getCountryFlag = (country: string): string => {
  const found = SUPPLIER_COUNTRIES.find(c => c.value === country)
  return found?.flag || ''
}

export default function ProductDetail({ product, isOpen, onClose, onEdit }: ProductDetailProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'sales' | 'suppliers'>('info')

  // Sales history state
  const [salesOrders, setSalesOrders] = useState<SalesHistoryItem[]>([])
  const [salesQuotes, setSalesQuotes] = useState<SalesHistoryItem[]>([])
  const [salesSummary, setSalesSummary] = useState<SalesHistorySummary | null>(null)
  const [loadingSales, setLoadingSales] = useState(false)

  // Suppliers state
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([])
  const [bestPriceSupplierId, setBestPriceSupplierId] = useState<number | null>(null)
  const [loadingSuppliers, setLoadingSuppliers] = useState(false)

  // Related products state
  const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([])
  const [loadingRelated, setLoadingRelated] = useState(false)

  // Reset when product changes
  useEffect(() => {
    if (isOpen && product) {
      setActiveTab('info')
      setSalesOrders([])
      setSalesQuotes([])
      setSalesSummary(null)
      setSuppliers([])
      setRelatedProducts([])
      loadRelatedProducts(product.id)
    }
  }, [isOpen, product?.id])

  // Lazy load tab data
  useEffect(() => {
    if (!isOpen || !product) return
    if (activeTab === 'sales' && salesOrders.length === 0 && !loadingSales) {
      loadSalesHistory(product.id)
    }
    if (activeTab === 'suppliers' && suppliers.length === 0 && !loadingSuppliers) {
      loadSupplierData(product.id)
    }
  }, [activeTab, isOpen, product?.id])

  const loadSalesHistory = async (productId: number) => {
    setLoadingSales(true)
    try {
      const res = await fetchProductSalesHistory(productId)
      setSalesOrders(res.data.orders)
      setSalesQuotes(res.data.quotations)
      setSalesSummary(res.data.summary)
    } catch (error) {
      console.error('Failed to load sales history:', error)
    } finally {
      setLoadingSales(false)
    }
  }

  const loadSupplierData = async (productId: number) => {
    setLoadingSuppliers(true)
    try {
      const res = await fetchProductSuppliers(productId)
      setSuppliers(res.data.suppliers)
      setBestPriceSupplierId(res.data.bestPriceSupplierId)
    } catch (error) {
      console.error('Failed to load suppliers:', error)
    } finally {
      setLoadingSuppliers(false)
    }
  }

  const loadRelatedProducts = async (productId: number) => {
    setLoadingRelated(true)
    try {
      const res = await fetchRelatedProducts(productId)
      setRelatedProducts(res.data)
    } catch (error) {
      console.error('Failed to load related products:', error)
    } finally {
      setLoadingRelated(false)
    }
  }

  if (!isOpen || !product) return null

  const tags: string[] = (() => {
    try {
      return product.tags ? JSON.parse(product.tags) : []
    } catch {
      return []
    }
  })()

  const tabs = [
    { id: 'info' as const, label: 'Thông tin' },
    { id: 'sales' as const, label: 'Lịch sử bán' },
    { id: 'suppliers' as const, label: 'Nhà cung cấp' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 slide-over-backdrop"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-3xl bg-white border-l border-stone-200 z-50 overflow-y-auto slide-over-panel">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-stone-200">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-stone-900">
                Chi tiết sản phẩm
              </h2>
              <p className="text-sm text-stone-400 mt-1">
                Mã: <span className="font-mono text-amber-500">{product.partNumber}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {onEdit && (
                <button
                  onClick={() => onEdit(product)}
                  className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
                >
                  <Edit className="h-4 w-4" />
                  Sửa
                </button>
              )}
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="flex gap-6 px-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'pb-3 text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'text-amber-500 border-b-2 border-amber-500'
                    : 'text-stone-400 hover:text-stone-600'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* ===== INFO TAB ===== */}
          {activeTab === 'info' && (
            <>
              {/* Main Info Card */}
              <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
                <h3 className="font-display text-lg font-semibold text-stone-900 mb-4">
                  Thông tin sản phẩm
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Part Number</label>
                    <p className="font-mono text-lg font-semibold text-amber-500 tracking-wide mt-1">
                      {product.partNumber}
                    </p>
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Name</label>
                    <p className="text-stone-700 mt-1">{product.name}</p>
                    {product.nameLocal && (
                      <p className="text-xs text-stone-400 mt-0.5">{product.nameLocal}</p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Category</label>
                    <p className="text-stone-700 mt-1 capitalize">
                      {product.category}
                      {product.subcategory && (
                        <span className="text-stone-400"> / {product.subcategory}</span>
                      )}
                    </p>
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Brand</label>
                    <p className="text-stone-700 mt-1">{product.brand || '—'}</p>
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Machine Model</label>
                    <p className="text-stone-700 mt-1">{product.machineModel || '—'}</p>
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Material</label>
                    {product.material ? (
                      <span
                        className={cn(
                          'inline-block px-3 py-1 rounded-md border text-xs font-medium mt-1',
                          materialColors[product.material] || 'bg-stone-100 text-stone-600 border-stone-200'
                        )}
                      >
                        {product.material}
                      </span>
                    ) : (
                      <p className="text-stone-700 mt-1">—</p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Size / Spec</label>
                    <p className="font-mono text-stone-700 mt-1">{product.size || '—'}</p>
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Remark</label>
                    <p className="text-stone-700 mt-1">{product.remark || '—'}</p>
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Stock Quantity</label>
                    <p className="text-stone-700 mt-1">{product.stockQuantity} {product.unit}</p>
                    {product.reorderLevel > 0 && product.stockQuantity < product.reorderLevel && (
                      <div className="flex items-center gap-1 mt-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs text-amber-500 font-medium">
                          Dưới mức tồn kho tối thiểu ({product.reorderLevel})
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Status</label>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn(
                        'inline-block px-3 py-1 rounded-md text-xs font-medium',
                        product.status === 'active'
                          ? 'bg-green-500/10 text-green-600'
                          : 'bg-gray-500/10 text-gray-500'
                      )}>
                        {product.status}
                      </span>
                      {product.isConsumable && (
                        <span className="inline-block px-2 py-1 rounded-md text-xs font-medium bg-blue-500/10 text-blue-600 border border-blue-500/20">
                          Consumable
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Tags */}
                {tags.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-stone-200">
                    <label className="text-xs text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Tag className="h-3 w-3" />
                      Tags
                    </label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {tags.map((tag: string) => (
                        <span key={tag} className="inline-block px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-xs font-medium text-amber-600">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {product.notes && (
                  <div className="mt-4 pt-4 border-t border-stone-200">
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Notes</label>
                    <p className="text-stone-600 mt-2">{product.notes}</p>
                  </div>
                )}
              </div>

              {/* Pricing Card */}
              <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
                <h3 className="font-display text-lg font-semibold text-stone-900 mb-4">
                  Pricing Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Cost Price</label>
                    <p className="text-stone-700 mt-1">
                      {product.costPrice ? `${product.costPrice.toLocaleString()} ${product.costCurrency}` : '—'}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">Selling Price</label>
                    <p className="text-stone-700 mt-1">
                      {product.sellingPrice ? `${product.sellingPrice.toLocaleString()} ${product.sellingCurrency}` : '—'}
                    </p>
                  </div>
                  {product.marginPercent !== null && (
                    <div className="col-span-2">
                      <label className="text-xs text-stone-500 uppercase tracking-wider">Margin</label>
                      <p className="text-green-500 font-semibold mt-1">{product.marginPercent}%</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ===== SALES HISTORY TAB ===== */}
          {activeTab === 'sales' && (
            <>
              {loadingSales ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-stone-50 animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : salesOrders.length === 0 && salesQuotes.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16">
                  <div className="rounded-full bg-stone-50 p-4">
                    <ShoppingCart className="h-8 w-8 text-stone-400" />
                  </div>
                  <p className="font-medium text-stone-500">Chưa có lịch sử bán hàng</p>
                  <p className="text-sm text-stone-400">Sản phẩm này chưa xuất hiện trong đơn hàng hoặc báo giá</p>
                </div>
              ) : (
                <>
                  {/* Summary Stats */}
                  {salesSummary && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl bg-stone-50 border border-stone-200 p-4 text-center">
                        <Package className="h-5 w-5 text-amber-500 mx-auto mb-1" />
                        <p className="text-2xl font-bold text-stone-900">{salesSummary.totalSoldQty}</p>
                        <p className="text-xs text-stone-400">Tổng SL bán</p>
                      </div>
                      <div className="rounded-xl bg-stone-50 border border-stone-200 p-4 text-center">
                        <TrendingUp className="h-5 w-5 text-amber-500 mx-auto mb-1" />
                        <p className="text-2xl font-bold text-stone-900">
                          {salesSummary.totalRevenue.toLocaleString('vi-VN')}
                        </p>
                        <p className="text-xs text-stone-400">Doanh thu (VND)</p>
                      </div>
                      <div className="rounded-xl bg-stone-50 border border-stone-200 p-4 text-center">
                        <Users className="h-5 w-5 text-amber-500 mx-auto mb-1" />
                        <p className="text-2xl font-bold text-stone-900">{salesSummary.uniqueCustomers}</p>
                        <p className="text-xs text-stone-400">Khách hàng</p>
                      </div>
                    </div>
                  )}

                  {/* Orders */}
                  {salesOrders.length > 0 && (
                    <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <ShoppingCart className="h-4 w-4 text-stone-500" />
                        <h4 className="font-semibold text-stone-700">
                          Đơn hàng ({salesOrders.length})
                        </h4>
                      </div>
                      <div className="space-y-2">
                        {salesOrders.map((item) => (
                          <div key={`order-${item.id}`} className="flex items-center gap-4 p-3 rounded-lg bg-white border border-stone-100">
                            <div className="flex-1 min-w-0">
                              <p className="font-mono text-sm font-medium text-amber-500">
                                {item.referenceNumber}
                              </p>
                              <p className="text-xs text-stone-400 mt-0.5">
                                {item.customerName} &middot; {item.date ? new Date(item.date).toLocaleDateString('vi-VN') : '—'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-stone-700">
                                {item.quantity} x {item.unitPrice?.toLocaleString()}
                              </p>
                              <p className="text-xs font-medium text-stone-500">
                                = {item.amount?.toLocaleString()} VND
                              </p>
                            </div>
                            <span className={cn(
                              'px-2 py-1 rounded text-[10px] font-medium uppercase',
                              item.status === 'delivered' ? 'bg-green-500/10 text-green-600' :
                              item.status === 'confirmed' ? 'bg-blue-500/10 text-blue-600' :
                              item.status === 'pending' ? 'bg-yellow-500/10 text-yellow-600' :
                              'bg-stone-100 text-stone-500'
                            )}>
                              {item.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quotations */}
                  {salesQuotes.length > 0 && (
                    <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <FileText className="h-4 w-4 text-stone-500" />
                        <h4 className="font-semibold text-stone-700">
                          Báo giá ({salesQuotes.length})
                        </h4>
                      </div>
                      <div className="space-y-2">
                        {salesQuotes.map((item) => (
                          <div key={`quote-${item.id}`} className="flex items-center gap-4 p-3 rounded-lg bg-white border border-stone-100">
                            <div className="flex-1 min-w-0">
                              <p className="font-mono text-sm font-medium text-amber-500">
                                {item.referenceNumber}
                              </p>
                              <p className="text-xs text-stone-400 mt-0.5">
                                {item.customerName} &middot; {item.date ? new Date(item.date).toLocaleDateString('vi-VN') : '—'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-stone-700">
                                {item.quantity} x {item.unitPrice?.toLocaleString()}
                              </p>
                              <p className="text-xs font-medium text-stone-500">
                                = {item.amount?.toLocaleString()} VND
                              </p>
                            </div>
                            <span className={cn(
                              'px-2 py-1 rounded text-[10px] font-medium uppercase',
                              item.status === 'accepted' ? 'bg-green-500/10 text-green-600' :
                              item.status === 'sent' ? 'bg-blue-500/10 text-blue-600' :
                              item.status === 'draft' ? 'bg-yellow-500/10 text-yellow-600' :
                              'bg-stone-100 text-stone-500'
                            )}>
                              {item.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ===== SUPPLIERS TAB ===== */}
          {activeTab === 'suppliers' && (
            <>
              {loadingSuppliers ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 bg-stone-50 animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : suppliers.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16">
                  <div className="rounded-full bg-stone-50 p-4">
                    <Package className="h-8 w-8 text-stone-400" />
                  </div>
                  <p className="font-medium text-stone-500">Chưa có nhà cung cấp</p>
                  <p className="text-sm text-stone-400">Chưa có NCC nào được liên kết với sản phẩm này</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {suppliers.map((supplier) => (
                    <div
                      key={supplier.id}
                      className={cn(
                        'rounded-xl border p-5 transition-colors',
                        supplier.supplierId === bestPriceSupplierId
                          ? 'bg-green-50/50 border-green-200'
                          : 'bg-stone-50 border-stone-200'
                      )}
                    >
                      {/* Supplier Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{getCountryFlag(supplier.country)}</span>
                          <h4 className="font-semibold text-stone-800">{supplier.supplierName}</h4>
                          {supplier.platform && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                              {supplier.platform}
                            </span>
                          )}
                        </div>
                        {supplier.supplierId === bestPriceSupplierId && (
                          <span className="px-2 py-1 rounded-md text-xs font-medium bg-green-500/10 text-green-600 border border-green-500/20">
                            Giá tốt nhất
                          </span>
                        )}
                      </div>

                      {/* Price & Terms */}
                      <div className="grid grid-cols-3 gap-4 mb-3">
                        <div>
                          <p className="text-xs text-stone-400">Giá nhập</p>
                          <p className="text-sm font-semibold text-stone-800">
                            {supplier.costPrice ? `${supplier.costPrice.toLocaleString()} ${supplier.costCurrency}` : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-stone-400">MOQ</p>
                          <p className="text-sm font-semibold text-stone-800">
                            {supplier.moq ?? '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-stone-400">Lead time</p>
                          <p className="text-sm font-semibold text-stone-800">
                            {supplier.leadTimeDays ? `${supplier.leadTimeDays} ngày` : '—'}
                          </p>
                        </div>
                      </div>

                      {/* Rating & Scores */}
                      <div className="flex items-center gap-6">
                        {/* Stars */}
                        {supplier.rating && (
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={cn(
                                  'h-3.5 w-3.5',
                                  star <= supplier.rating!
                                    ? 'text-amber-400 fill-amber-400'
                                    : 'text-stone-300'
                                )}
                              />
                            ))}
                          </div>
                        )}

                        {/* Score bars */}
                        {(supplier.qualityScore || supplier.deliveryScore || supplier.priceScore) && (
                          <div className="flex items-center gap-4 flex-1">
                            {supplier.qualityScore !== null && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-stone-400 w-10">Quality</span>
                                <div className="w-16 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                                  <div
                                    className={cn(
                                      'h-full rounded-full',
                                      (supplier.qualityScore ?? 0) >= 8 ? 'bg-green-500' :
                                      (supplier.qualityScore ?? 0) >= 6 ? 'bg-yellow-500' : 'bg-red-500'
                                    )}
                                    style={{ width: `${(supplier.qualityScore ?? 0) * 10}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-stone-500">{supplier.qualityScore}</span>
                              </div>
                            )}
                            {supplier.deliveryScore !== null && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-stone-400 w-12">Delivery</span>
                                <div className="w-16 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                                  <div
                                    className={cn(
                                      'h-full rounded-full',
                                      (supplier.deliveryScore ?? 0) >= 8 ? 'bg-green-500' :
                                      (supplier.deliveryScore ?? 0) >= 6 ? 'bg-yellow-500' : 'bg-red-500'
                                    )}
                                    style={{ width: `${(supplier.deliveryScore ?? 0) * 10}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-stone-500">{supplier.deliveryScore}</span>
                              </div>
                            )}
                            {supplier.priceScore !== null && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-stone-400 w-8">Price</span>
                                <div className="w-16 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                                  <div
                                    className={cn(
                                      'h-full rounded-full',
                                      (supplier.priceScore ?? 0) >= 8 ? 'bg-green-500' :
                                      (supplier.priceScore ?? 0) >= 6 ? 'bg-yellow-500' : 'bg-red-500'
                                    )}
                                    style={{ width: `${(supplier.priceScore ?? 0) * 10}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-stone-500">{supplier.priceScore}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Last purchase info */}
                      {supplier.lastPurchaseDate && (
                        <p className="text-xs text-stone-400 mt-3 pt-3 border-t border-stone-200">
                          Mua gần nhất: {new Date(supplier.lastPurchaseDate).toLocaleDateString('vi-VN')}
                          {supplier.lastPurchasePrice && ` — ${supplier.lastPurchasePrice.toLocaleString()} ${supplier.costCurrency}`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ===== RELATED PRODUCTS (always at bottom) ===== */}
          {relatedProducts.length > 0 && (
            <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Layers className="h-5 w-5 text-stone-400" />
                <h3 className="font-display text-base font-semibold text-stone-900">
                  Sản phẩm cùng máy
                </h3>
                <span className="text-xs text-stone-400">
                  ({product.brand} {product.machineModel})
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {relatedProducts.map((rp) => (
                  <div
                    key={rp.id}
                    className="rounded-lg bg-white border border-stone-200 p-3 hover:border-amber-300 transition-colors"
                  >
                    <span className="font-mono text-xs font-semibold text-amber-500 tracking-wide">
                      {rp.partNumber}
                    </span>
                    <p className="text-sm text-stone-700 mt-1 line-clamp-1">{rp.name}</p>
                    <div className="flex items-center justify-between mt-2">
                      {rp.material ? (
                        <span className={cn(
                          'inline-block px-2 py-0.5 rounded border text-[10px] font-medium',
                          materialColors[rp.material] || 'bg-stone-100 text-stone-600 border-stone-200'
                        )}>
                          {rp.material}
                        </span>
                      ) : (
                        <span />
                      )}
                      {rp.size && (
                        <span className="text-xs font-mono text-stone-500">{rp.size}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
