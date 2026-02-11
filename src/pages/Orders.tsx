import { useState } from 'react'
import { Plus, Search, X, Package, CheckCircle2, Clock, Truck, ClipboardCheck, Box } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useOrders, useDeleteOrder } from '@/hooks/useOrders'
import { useDebounce } from '@/hooks/useDebounce'
import { type Order } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { useToast } from '@/hooks/use-toast'
import ConfirmDialog from '@/components/shared/ConfirmDialog'

const ORDER_STATUSES = [
  { value: 'confirmed', label: 'Confirmed', color: 'blue' },
  { value: 'purchasing', label: 'Purchasing', color: 'purple' },
  { value: 'in_transit', label: 'In Transit', color: 'amber' },
  { value: 'quality_check', label: 'QC', color: 'orange' },
  { value: 'delivered', label: 'Delivered', color: 'green' },
  { value: 'completed', label: 'Completed', color: 'emerald' },
  { value: 'cancelled', label: 'Cancelled', color: 'red' },
]

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  unpaid: 'bg-red-500/10 text-red-400 border-red-500/20',
  partial: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  paid: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
}

const PAYMENT_LABELS: Record<string, string> = {
  unpaid: 'Chưa TT',
  partial: 'Một phần',
  paid: 'Đã thanh toán',
}

// Status stepper mini component
function StatusStepper({ currentStatus }: { currentStatus: string }) {
  const steps = ['confirmed', 'purchasing', 'in_transit', 'quality_check', 'delivered', 'completed']
  const currentIndex = steps.indexOf(currentStatus)

  if (currentStatus === 'cancelled') {
    return (
      <div className="flex items-center gap-1">
        <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
        <div className="h-0.5 w-4 bg-red-500/20" />
        <div className="h-1.5 w-1.5 rounded-full bg-red-500/20" />
        <div className="h-0.5 w-4 bg-red-500/20" />
        <div className="h-1.5 w-1.5 rounded-full bg-red-500/20" />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, idx) => {
        const isActive = idx <= currentIndex
        const isCurrent = idx === currentIndex
        return (
          <div key={step} className="flex items-center">
            <div
              className={cn(
                'h-1.5 w-1.5 rounded-full transition-colors',
                isActive ? 'bg-brand-500' : 'bg-stone-600',
                isCurrent && 'ring-2 ring-brand-500/30 ring-offset-1 ring-offset-stone-800'
              )}
            />
            {idx < steps.length - 1 && (
              <div className={cn('h-0.5 w-3', isActive ? 'bg-brand-500' : 'bg-stone-600')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function Orders() {
  const navigate = useNavigate()

  // Filter states
  const [searchInput, setSearchInput] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState('')
  const [page, setPage] = useState(1)

  // Debounce search
  const search = useDebounce(searchInput, 300)

  // Queries
  const { data: ordersData, isLoading } = useOrders({
    search,
    status: selectedStatus || undefined,
    paymentStatus: selectedPaymentStatus || undefined,
    page,
    limit: 20,
  })

  const deleteMutation = useDeleteOrder()
  const { toast } = useToast()
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: number; orderNumber: string }>({ open: false, id: 0, orderNumber: '' })

  const orders = ordersData?.data || []
  const pagination = ordersData?.pagination || { total: 0, totalPages: 0, page: 1 }

  const activeFiltersCount = [search, selectedStatus, selectedPaymentStatus].filter(Boolean).length

  const handleClearFilters = () => {
    setSearchInput('')
    setSelectedStatus('')
    setSelectedPaymentStatus('')
    setPage(1)
  }

  const handleDelete = (id: number, orderNumber: string) => {
    setConfirmDelete({ open: true, id, orderNumber })
  }

  const handleConfirmDelete = async () => {
    try {
      await deleteMutation.mutateAsync(confirmDelete.id)
      toast({ title: 'Xóa đơn hàng thành công' })
    } catch (error) {
      console.error('Failed to delete order:', error)
      toast({ title: 'Xóa đơn hàng thất bại', variant: 'destructive' })
    } finally {
      setConfirmDelete({ open: false, id: 0, orderNumber: '' })
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '—'
    return new Intl.NumberFormat('vi-VN').format(amount) + ' ₫'
  }

  // Check if order is overdue
  const isOverdue = (order: Order) => {
    if (!order.expectedDelivery) return false
    if (order.status === 'delivered' || order.status === 'completed') return false
    return new Date(order.expectedDelivery) < new Date()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-stone-900">Đơn hàng</h2>
          <p className="text-sm text-stone-400 mt-1">
            {isLoading ? 'Đang tải...' : `${pagination.total} đơn hàng`}
          </p>
        </div>
        <button
          onClick={() => navigate('/orders/new')}
          className="btn btn-primary px-4 py-2.5 text-sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          Tạo đơn hàng
        </button>
      </div>

      {/* Filter Bar */}
      <div className="card p-4">
        <div className="flex gap-3 flex-wrap items-center">
          {/* Search */}
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-500" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm mã ĐH, PO..."
              className="w-full rounded-lg bg-stone-50 border border-stone-200 pl-9 pr-3 py-2 text-sm text-stone-700 placeholder:text-stone-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {/* Status */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">Tất cả trạng thái</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {/* Payment Status */}
          <select
            value={selectedPaymentStatus}
            onChange={(e) => setSelectedPaymentStatus(e.target.value)}
            className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">Tất cả thanh toán</option>
            <option value="unpaid">Chưa thanh toán</option>
            <option value="partial">Một phần</option>
            <option value="paid">Đã thanh toán</option>
          </select>

          {/* Clear Button */}
          {activeFiltersCount > 0 && (
            <button
              onClick={handleClearFilters}
              className="flex items-center gap-1 px-3 py-2 text-sm text-stone-400 hover:text-stone-900 transition-colors"
            >
              <X className="h-4 w-4" />
              Xóa ({activeFiltersCount})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Mã ĐH</th>
              <th>Khách hàng</th>
              <th>PO</th>
              <th>Tổng tiền</th>
              <th>Trạng thái</th>
              <th>Thanh toán</th>
              <th>Giao hàng</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, idx) => (
                <tr key={idx}>
                  <td colSpan={7}>
                    <div className="h-10 bg-stone-50 animate-pulse rounded" />
                  </td>
                </tr>
              ))
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="rounded-full bg-stone-50 p-4">
                      <Package className="h-8 w-8 text-stone-500" />
                    </div>
                    <div>
                      <p className="font-medium text-stone-600">Không tìm thấy đơn hàng</p>
                      <p className="text-sm text-stone-500 mt-1">Thử thay đổi bộ lọc</p>
                    </div>
                    {activeFiltersCount > 0 && (
                      <button
                        onClick={handleClearFilters}
                        className="btn btn-secondary px-3 py-1.5 text-xs"
                      >
                        Xóa bộ lọc
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              orders.map((order: Order, idx: number) => (
                <tr
                  key={order.id}
                  className={cn(
                    'cursor-pointer transition-colors duration-150',
                    idx % 2 === 0 && 'even:bg-stone-50',
                    isOverdue(order) && 'bg-red-500/5'
                  )}
                  onClick={() => navigate(`/orders/${order.id}`)}
                >
                  <td>
                    <span className="part-number">{order.orderNumber}</span>
                  </td>
                  <td className="text-sm text-stone-700">{order.customerName || '—'}</td>
                  <td>
                    <span className="font-mono text-sm text-stone-400">{order.poNumber || '—'}</span>
                  </td>
                  <td>
                    <div>
                      <p className="text-sm font-medium text-stone-700">
                        {formatCurrency(order.totalAmount)}
                      </p>
                      {order.paidAmount > 0 && (
                        <p className="text-xs text-stone-500">
                          Đã TT: {formatCurrency(order.paidAmount)}
                        </p>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="space-y-1.5">
                      <span
                        className={cn(
                          'badge border text-xs',
                          order.status === 'confirmed' && 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                          order.status === 'purchasing' && 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                          order.status === 'in_transit' && 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                          order.status === 'quality_check' && 'bg-orange-500/10 text-orange-400 border-orange-500/20',
                          order.status === 'delivered' && 'bg-green-500/10 text-green-400 border-green-500/20',
                          order.status === 'completed' && 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                          order.status === 'cancelled' && 'bg-red-500/10 text-red-400 border-red-500/20'
                        )}
                      >
                        {ORDER_STATUSES.find((s) => s.value === order.status)?.label || order.status}
                      </span>
                      <StatusStepper currentStatus={order.status} />
                    </div>
                  </td>
                  <td>
                    <span
                      className={cn(
                        'badge border text-xs',
                        PAYMENT_STATUS_COLORS[order.paymentStatus] || 'bg-stone-100 text-stone-600 border-stone-600'
                      )}
                    >
                      {PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus}
                    </span>
                  </td>
                  <td>
                    {order.expectedDelivery ? (
                      <div className={cn('text-sm', isOverdue(order) && 'text-red-400 font-medium')}>
                        {format(new Date(order.expectedDelivery), 'dd/MM/yyyy')}
                        {isOverdue(order) && <div className="text-xs">Quá hạn</div>}
                      </div>
                    ) : (
                      <span className="text-stone-500">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {!isLoading && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-stone-200 bg-stone-50 px-4 py-3">
            <p className="text-sm text-stone-400">
              Hiển thị {(page - 1) * 20 + 1}-{Math.min(page * 20, pagination.total)} / {pagination.total} đơn hàng
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Trước
              </button>
              <span className="text-sm text-stone-400">
                Trang {page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title={`Xóa đơn hàng ${confirmDelete.orderNumber}?`}
        description="Hành động này không thể hoàn tác."
        confirmLabel="Xóa"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete({ open: false, id: 0, orderNumber: '' })}
      />
    </div>
  )
}
