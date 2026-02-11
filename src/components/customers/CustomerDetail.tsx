import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Edit, Building2, MapPin, DollarSign, FileText, ShoppingCart, Phone, Target } from 'lucide-react'
import type { Customer, Activity, Quotation, Order } from '@/lib/api'
import { fetchActivities, createActivity, markFollowUpDone, fetchQuotations, fetchOrders } from '@/lib/api'
import { cn } from '@/lib/utils'
import { CUSTOMER_TYPE_COLORS, TIER_COLORS } from '@/lib/constants'
import { format } from 'date-fns'
import ContactCard from '../shared/ContactCard'
import ActivityTimeline from '../shared/ActivityTimeline'

interface CustomerDetailProps {
  customer: Customer | null
  isOpen: boolean
  onClose: () => void
  onEdit?: (customer: Customer) => void
}

export default function CustomerDetail({
  customer,
  isOpen,
  onClose,
  onEdit,
}: CustomerDetailProps) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'overview' | 'purchase' | 'activities'>(
    'overview'
  )
  const [activities, setActivities] = useState<Activity[]>([])
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loadingPurchase, setLoadingPurchase] = useState(false)
  const [healthStats, setHealthStats] = useState({ orders: 0, quotations: 0, activities: 0 })

  useEffect(() => {
    if (isOpen && customer) {
      // Always load health stats when panel opens
      loadHealthStats()
    }
    if (isOpen && customer && activeTab === 'activities') {
      loadActivities()
    }
    if (isOpen && customer && activeTab === 'purchase') {
      loadPurchaseHistory()
    }
  }, [isOpen, customer, activeTab])

  const loadHealthStats = async () => {
    if (!customer) return
    try {
      const [quotationsRes, ordersRes, activitiesRes] = await Promise.all([
        fetchQuotations({ customerId: customer.id, limit: 100 }),
        fetchOrders({ customerId: customer.id, limit: 100 }),
        fetchActivities({ entityType: 'customer', entityId: customer.id }),
      ])
      setHealthStats({
        orders: ordersRes.data.length,
        quotations: quotationsRes.data.length,
        activities: activitiesRes.data.length,
      })
    } catch (error) {
      console.error('Failed to load health stats:', error)
    }
  }

  const loadActivities = async () => {
    if (!customer) return
    setLoadingActivities(true)
    try {
      const response = await fetchActivities({
        entityType: 'customer',
        entityId: customer.id,
      })
      setActivities(response.data)
    } catch (error) {
      console.error('Failed to load activities:', error)
    } finally {
      setLoadingActivities(false)
    }
  }

  const loadPurchaseHistory = async () => {
    if (!customer) return
    setLoadingPurchase(true)
    try {
      const [quotationsRes, ordersRes] = await Promise.all([
        fetchQuotations({ customerId: customer.id, limit: 20 }),
        fetchOrders({ customerId: customer.id, limit: 20 }),
      ])
      setQuotations(quotationsRes.data)
      setOrders(ordersRes.data)
    } catch (error) {
      console.error('Failed to load purchase history:', error)
    } finally {
      setLoadingPurchase(false)
    }
  }

  const handleAddActivity = async (data: Partial<Activity>) => {
    if (!customer) return
    await createActivity({
      ...data,
      entityType: 'customer',
      entityId: customer.id,
    })
    loadActivities()
  }

  const handleMarkDone = async (id: number) => {
    await markFollowUpDone(id)
    loadActivities()
  }

  if (!isOpen || !customer) return null

  const smtBrands = customer.smtBrands ? JSON.parse(customer.smtBrands) : []
  const smtModels = customer.smtModels ? customer.smtModels.split(',').map((m) => m.trim()) : []

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 slide-over-backdrop"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-3xl bg-stone-900border-l border-stone-700 z-50 overflow-y-auto slide-over-panel">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-stone-900/95 backdrop-blur border-b border-stone-700 px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-stone-50">
              {customer.companyName}
            </h2>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={cn(
                  'inline-block px-2 py-1 rounded border text-xs font-medium',
                  CUSTOMER_TYPE_COLORS[customer.type] ||
                    'bg-stone-700/50 text-stone-300 border-stone-600'
                )}
              >
                {customer.type}
              </span>
              {customer.tier && (
                <span
                  className={cn(
                    'inline-block px-2 py-1 rounded border text-xs font-medium',
                    TIER_COLORS[customer.tier] ||
                      'bg-stone-700/50 text-stone-300 border-stone-600'
                  )}
                >
                  Tier {customer.tier}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={() => onEdit(customer)}
                className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
              >
                <Edit className="h-4 w-4" />
                Sửa
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-stone-700 px-6">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab('overview')}
              className={cn(
                'pb-3 pt-4 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'overview'
                  ? 'border-amber-400 text-amber-400'
                  : 'border-transparent text-stone-500 hover:text-stone-300'
              )}
            >
              Tổng quan
            </button>
            <button
              onClick={() => setActiveTab('purchase')}
              className={cn(
                'pb-3 pt-4 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'purchase'
                  ? 'border-amber-400 text-amber-400'
                  : 'border-transparent text-stone-500 hover:text-stone-300'
              )}
            >
              Lịch sử mua
            </button>
            <button
              onClick={() => setActiveTab('activities')}
              className={cn(
                'pb-3 pt-4 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'activities'
                  ? 'border-amber-400 text-amber-400'
                  : 'border-transparent text-stone-500 hover:text-stone-300'
              )}
            >
              Activities
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* Health Summary */}
              <div className="grid grid-cols-3 gap-4 stagger-children">
                <div className="rounded-xl bg-stone-800/60 border border-stone-700/40 p-4 text-center">
                  <ShoppingCart className="h-5 w-5 text-amber-400 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-stone-50">{healthStats.orders}</p>
                  <p className="text-xs text-stone-400">Đơn hàng</p>
                </div>
                <div className="rounded-xl bg-stone-800/60 border border-stone-700/40 p-4 text-center">
                  <FileText className="h-5 w-5 text-stone-300 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-stone-50">{healthStats.quotations}</p>
                  <p className="text-xs text-stone-400">Báo giá</p>
                </div>
                <div className="rounded-xl bg-stone-800/60 border border-stone-700/40 p-4 text-center">
                  <Target className="h-5 w-5 text-stone-300 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-stone-50">{healthStats.activities}</p>
                  <p className="text-xs text-stone-400">Hoạt động</p>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { navigate(`/quotations/new?customerId=${customer.id}`); onClose() }}
                  className="flex items-center gap-2 rounded-lg bg-amber-600/10 border border-amber-500/20 px-3 py-2 text-xs font-medium text-amber-400 hover:bg-amber-600/20 hover:border-amber-500/40 transition-all"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Tạo báo giá
                </button>
                <button
                  onClick={() => { navigate(`/orders/new?customerId=${customer.id}`); onClose() }}
                  className="flex items-center gap-2 rounded-lg bg-amber-600/10 border border-amber-500/20 px-3 py-2 text-xs font-medium text-amber-400 hover:bg-amber-600/20 hover:border-amber-500/40 transition-all"
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                  Tạo đơn hàng
                </button>
                {customer.contactPhone && (
                  <a
                    href={`tel:${customer.contactPhone}`}
                    className="flex items-center gap-2 rounded-lg bg-stone-700/50 border border-stone-600/40 px-3 py-2 text-xs font-medium text-stone-300 hover:bg-stone-700 hover:border-stone-500 transition-all"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Gọi điện
                  </a>
                )}
              </div>

              {/* Company Info */}
              <div className="rounded-xl bg-stone-800/50 border border-stone-700/50 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 className="h-5 w-5 text-stone-400" />
                  <h3 className="font-display text-lg font-semibold text-stone-50">
                    Company Information
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">
                      Company Name
                    </label>
                    <p className="text-stone-200 mt-1">{customer.companyName}</p>
                    {customer.companyNameLocal && (
                      <p className="text-sm text-stone-400">{customer.companyNameLocal}</p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">
                      Industry
                    </label>
                    <p className="text-stone-200 mt-1 capitalize">
                      {customer.industry || '—'}
                    </p>
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">
                      Industrial Zone
                    </label>
                    <p className="text-stone-200 mt-1">{customer.industrialZone || '—'}</p>
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">
                      Province
                    </label>
                    <p className="text-stone-200 mt-1">{customer.province || '—'}</p>
                  </div>

                  {customer.address && (
                    <div className="col-span-2">
                      <label className="text-xs text-stone-500 uppercase tracking-wider flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        Address
                      </label>
                      <p className="text-stone-200 mt-1">{customer.address}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Contact Cards */}
              <div className="grid grid-cols-2 gap-4">
                <ContactCard
                  title="Primary Contact"
                  name={customer.contactName}
                  jobTitle={customer.contactTitle}
                  phone={customer.contactPhone}
                  email={customer.contactEmail}
                  zalo={customer.contactZalo}
                  wechat={customer.contactWechat}
                />
                <ContactCard
                  title="Secondary Contact"
                  name={customer.contact2Name}
                  jobTitle={customer.contact2Title}
                  phone={customer.contact2Phone}
                  email={customer.contact2Email}
                />
              </div>

              {/* SMT Equipment */}
              {(smtBrands.length > 0 || smtModels.length > 0) && (
                <div className="rounded-xl bg-stone-800/50 border border-stone-700/50 p-6">
                  <h3 className="font-display text-lg font-semibold text-stone-50 mb-4">
                    SMT Equipment
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {smtBrands.length > 0 && (
                      <div>
                        <label className="text-xs text-stone-500 uppercase tracking-wider">
                          Brands
                        </label>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {smtBrands.map((brand: string) => (
                            <span
                              key={brand}
                              className="inline-block px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-xs font-medium text-amber-400"
                            >
                              {brand}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {smtModels.length > 0 && (
                      <div>
                        <label className="text-xs text-stone-500 uppercase tracking-wider">
                          Models
                        </label>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {smtModels.map((model: string) => (
                            <span
                              key={model}
                              className="inline-block px-2 py-1 rounded bg-stone-700/50 border border-stone-600 text-xs text-stone-300"
                            >
                              {model}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Business Info */}
              <div className="rounded-xl bg-stone-800/50 border border-stone-700/50 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <DollarSign className="h-5 w-5 text-stone-400" />
                  <h3 className="font-display text-lg font-semibold text-stone-50">
                    Business Information
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">
                      Purchase Frequency
                    </label>
                    <p className="text-stone-200 mt-1 capitalize">
                      {customer.purchaseFrequency?.replace('_', ' ') || '—'}
                    </p>
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 uppercase tracking-wider">
                      Payment Terms
                    </label>
                    <p className="text-stone-200 mt-1 uppercase">
                      {customer.paymentTerms || '—'}
                    </p>
                  </div>

                  {customer.estimatedAnnualValue && (
                    <div>
                      <label className="text-xs text-stone-500 uppercase tracking-wider">
                        Est. Annual Value
                      </label>
                      <p className="text-stone-200 mt-1 font-semibold">
                        {customer.estimatedAnnualValue.toLocaleString()} VND
                      </p>
                    </div>
                  )}

                  {customer.source && (
                    <div>
                      <label className="text-xs text-stone-500 uppercase tracking-wider">
                        Source
                      </label>
                      <p className="text-stone-200 mt-1 capitalize">
                        {customer.source.replace('_', ' ')}
                      </p>
                    </div>
                  )}
                </div>

                {customer.notes && (
                  <div className="mt-4 pt-4 border-t border-stone-700">
                    <label className="text-xs text-stone-500 uppercase tracking-wider">
                      Notes
                    </label>
                    <p className="text-stone-300 mt-2">{customer.notes}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Purchase History Tab */}
          {activeTab === 'purchase' && (
            <>
              {loadingPurchase ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-stone-800/50 animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : (
                <>
                  {/* Quotations */}
                  <div className="rounded-xl bg-stone-800/50 border border-stone-700/50 p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <FileText className="h-5 w-5 text-amber-400" />
                      <h3 className="font-display text-lg font-semibold text-stone-50">
                        Báo giá ({quotations.length})
                      </h3>
                    </div>
                    {quotations.length === 0 ? (
                      <p className="text-sm text-stone-500 text-center py-4">Chưa có báo giá</p>
                    ) : (
                      <div className="space-y-2">
                        {quotations.map((q) => (
                          <div
                            key={q.id}
                            onClick={() => { navigate(`/quotations`); onClose() }}
                            className="flex items-center justify-between p-3 rounded-lg bg-stone-900/50 hover:bg-stone-900 cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-sm text-amber-400">{q.quoteNumber}</span>
                              <span className={cn(
                                'badge border text-xs',
                                q.status === 'accepted' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                q.status === 'sent' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                q.status === 'rejected' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                'bg-stone-700/50 text-stone-300 border-stone-600'
                              )}>
                                {q.status}
                              </span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-sm font-mono text-stone-300">
                                {q.totalAmount ? new Intl.NumberFormat('vi-VN').format(q.totalAmount) + ' ' + q.currency : '—'}
                              </span>
                              <span className="text-xs text-stone-500">
                                {format(new Date(q.createdAt), 'dd/MM/yyyy')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Orders */}
                  <div className="rounded-xl bg-stone-800/50 border border-stone-700/50 p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <ShoppingCart className="h-5 w-5 text-amber-400" />
                      <h3 className="font-display text-lg font-semibold text-stone-50">
                        Đơn hàng ({orders.length})
                      </h3>
                    </div>
                    {orders.length === 0 ? (
                      <p className="text-sm text-stone-500 text-center py-4">Chưa có đơn hàng</p>
                    ) : (
                      <div className="space-y-2">
                        {orders.map((o) => (
                          <div
                            key={o.id}
                            onClick={() => { navigate(`/orders/${o.id}`); onClose() }}
                            className="flex items-center justify-between p-3 rounded-lg bg-stone-900/50 hover:bg-stone-900 cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-sm text-amber-400">{o.orderNumber}</span>
                              <span className={cn(
                                'badge border text-xs',
                                o.status === 'delivered' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                o.status === 'processing' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                o.status === 'cancelled' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                'bg-stone-700/50 text-stone-300 border-stone-600'
                              )}>
                                {o.status}
                              </span>
                              <span className={cn(
                                'badge border text-xs',
                                o.paymentStatus === 'paid' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                o.paymentStatus === 'partial' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                'bg-stone-700/50 text-stone-300 border-stone-600'
                              )}>
                                {o.paymentStatus}
                              </span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-sm font-mono text-stone-300">
                                {o.totalAmount ? new Intl.NumberFormat('vi-VN').format(o.totalAmount) + ' ' + o.currency : '—'}
                              </span>
                              <span className="text-xs text-stone-500">
                                {format(new Date(o.createdAt), 'dd/MM/yyyy')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* Activities Tab */}
          {activeTab === 'activities' && (
            <div className="rounded-xl bg-stone-800/50 border border-stone-700/50 p-6">
              <h3 className="font-display text-lg font-semibold text-stone-50 mb-4">
                Activity Timeline
              </h3>
              {loadingActivities ? (
                <p className="text-center text-stone-400 py-8">Loading activities...</p>
              ) : (
                <ActivityTimeline
                  activities={activities}
                  onAddActivity={handleAddActivity}
                  onMarkDone={handleMarkDone}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
