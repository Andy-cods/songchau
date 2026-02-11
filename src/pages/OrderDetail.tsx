import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Edit,
  Trash2,
  Loader2,
  User,
  Calendar,
  Package,
  CreditCard,
  Truck,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  Box,
  DollarSign,
} from 'lucide-react'
import { useOrder, useUpdateOrderStatus, useRecordPayment, useDeleteOrder } from '@/hooks/useOrders'
import { cn } from '@/lib/utils'
import { ORDER_STATUS_COLORS, PAYMENT_STATUS_COLORS } from '@/lib/constants'
import { format } from 'date-fns'
import { useToast } from '@/hooks/use-toast'
import ConfirmDialog from '@/components/shared/ConfirmDialog'

const ORDER_STATUSES = [
  { value: 'confirmed', label: 'Confirmed', icon: CheckCircle2 },
  { value: 'purchasing', label: 'Purchasing', icon: CreditCard },
  { value: 'in_transit', label: 'In Transit', icon: Truck },
  { value: 'quality_check', label: 'QC', icon: ClipboardCheck },
  { value: 'delivered', label: 'Delivered', icon: Box },
  { value: 'completed', label: 'Completed', icon: CheckCircle2 },
]

const PAYMENT_LABELS: Record<string, string> = {
  unpaid: 'Chưa thanh toán',
  partial: 'Thanh toán một phần',
  paid: 'Đã thanh toán',
}

function StatusStepper({ currentStatus }: { currentStatus: string }) {
  const steps = ORDER_STATUSES
  const currentIndex = steps.findIndex((s) => s.value === currentStatus)

  if (currentStatus === 'cancelled') {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-red-500/5 border border-red-500/20 rounded-lg">
        <div className="h-3 w-3 rounded-full bg-red-500" />
        <span className="text-sm font-medium text-red-400">Đã hủy</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, idx) => {
        const isActive = idx <= currentIndex
        const isCurrent = idx === currentIndex
        const Icon = step.icon
        return (
          <div key={step.value} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'h-10 w-10 rounded-full flex items-center justify-center transition-colors',
                  isActive ? 'bg-brand-500/20 text-brand-400' : 'bg-stone-800 text-stone-600',
                  isCurrent && 'ring-2 ring-brand-500/40 ring-offset-2 ring-offset-stone-900'
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium',
                  isActive ? 'text-stone-300' : 'text-stone-600'
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={cn('h-0.5 w-8 mx-1 mt-[-16px]', isActive ? 'bg-brand-500' : 'bg-stone-700')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const orderId = id ? parseInt(id) : null

  const { data, isLoading } = useOrder(orderId)
  const updateStatusMutation = useUpdateOrderStatus()
  const recordPaymentMutation = useRecordPayment()
  const deleteMutation = useDeleteOrder()

  const [paymentAmount, setPaymentAmount] = useState('')
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const order = data?.data

  const formatCurrency = (amount: number | null | undefined) => {
    if (!amount) return '—'
    return new Intl.NumberFormat('vi-VN').format(amount) + ' ₫'
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!orderId) return
    try {
      await updateStatusMutation.mutateAsync({ id: orderId, status: newStatus })
      toast({ title: 'Cập nhật trạng thái thành công' })
    } catch {
      toast({ title: 'Cập nhật thất bại', variant: 'destructive' })
    }
  }

  const handleRecordPayment = async () => {
    if (!orderId || !paymentAmount) return
    const amount = parseFloat(paymentAmount)
    if (isNaN(amount) || amount <= 0) return

    try {
      await recordPaymentMutation.mutateAsync({ id: orderId, amount })
      setPaymentAmount('')
      setShowPaymentForm(false)
      toast({ title: 'Ghi nhận thanh toán thành công' })
    } catch {
      toast({ title: 'Ghi nhận thất bại', variant: 'destructive' })
    }
  }

  const handleDelete = async () => {
    if (!orderId) return
    try {
      await deleteMutation.mutateAsync(orderId)
      navigate('/orders')
    } catch {
      toast({ title: 'Xóa đơn hàng thất bại', variant: 'destructive' })
    } finally {
      setShowDeleteConfirm(false)
    }
  }

  const getNextStatus = (current: string) => {
    const flow = ['confirmed', 'purchasing', 'in_transit', 'quality_check', 'delivered', 'completed']
    const idx = flow.indexOf(current)
    if (idx >= 0 && idx < flow.length - 1) return flow[idx + 1]
    return null
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-stone-500" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Package className="h-12 w-12 text-stone-600" />
        <p className="text-stone-400">Không tìm thấy đơn hàng</p>
        <button onClick={() => navigate('/orders')} className="btn btn-secondary text-sm px-4 py-2">
          Quay lại
        </button>
      </div>
    )
  }

  const nextStatus = getNextStatus(order.status)
  const nextStatusLabel = nextStatus ? ORDER_STATUSES.find((s) => s.value === nextStatus)?.label : null
  const remainingAmount = (order.totalAmount || 0) - (order.paidAmount || 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/orders')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-display text-2xl font-bold text-stone-50">{order.orderNumber}</h2>
              <span className={cn('badge border text-xs', ORDER_STATUS_COLORS[order.status])}>
                {ORDER_STATUSES.find((s) => s.value === order.status)?.label || order.status}
              </span>
              <span className={cn('badge border text-xs', PAYMENT_STATUS_COLORS[order.paymentStatus])}>
                {PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus}
              </span>
            </div>
            <p className="text-sm text-stone-400 mt-0.5">
              Tạo ngày {format(new Date(order.createdAt), 'dd/MM/yyyy HH:mm')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/orders/${orderId}/edit`)}
            className="flex items-center gap-1.5 rounded-lg bg-stone-700 px-3 py-2 text-sm font-medium text-stone-200 hover:bg-stone-600 transition-colors"
          >
            <Edit className="h-4 w-4" /> Sửa
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-red-600/10 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-600/20 transition-colors"
          >
            <Trash2 className="h-4 w-4" /> Xóa
          </button>
        </div>
      </div>

      {/* Status Stepper */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <StatusStepper currentStatus={order.status} />
          <div className="flex gap-2">
            {nextStatus && (
              <button
                onClick={() => handleStatusChange(nextStatus)}
                disabled={updateStatusMutation.isPending}
                className="btn btn-primary px-4 py-2 text-sm"
              >
                {updateStatusMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : null}
                → {nextStatusLabel}
              </button>
            )}
            {order.status !== 'cancelled' && order.status !== 'completed' && (
              <button
                onClick={() => handleStatusChange('cancelled')}
                className="btn btn-secondary px-3 py-2 text-sm text-red-400 hover:text-red-300"
              >
                Hủy đơn
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left Column - Main Info */}
        <div className="col-span-2 space-y-6">
          {/* Customer Info */}
          <div className="card p-5">
            <h4 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <User className="h-3.5 w-3.5" /> Khách hàng
            </h4>
            <p className="text-sm font-medium text-stone-200">{order.customerName || '—'}</p>
            {order.customerContact && <p className="text-xs text-stone-400 mt-1">{order.customerContact}</p>}
            {order.customerPhone && <p className="text-xs text-stone-400">{order.customerPhone}</p>}
            {order.customerEmail && <p className="text-xs text-stone-400">{order.customerEmail}</p>}
            {order.deliveryAddress && (
              <div className="mt-3 pt-3 border-t border-stone-700/50">
                <p className="text-xs text-stone-500 mb-1">Địa chỉ giao hàng</p>
                <p className="text-sm text-stone-300">{order.deliveryAddress}</p>
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-stone-700/50">
              <h4 className="text-xs font-medium text-stone-400 uppercase tracking-wider flex items-center gap-2">
                <Package className="h-3.5 w-3.5" /> Sản phẩm ({order.items?.length || 0})
              </h4>
            </div>
            <table className="w-full">
              <thead className="bg-stone-900/30">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500">#</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-stone-500">Sản phẩm</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-stone-500">SL</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-stone-500">Đơn giá</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-stone-500">Thành tiền</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-700/30">
                {order.items?.map((item, idx) => (
                  <tr key={item.id || idx}>
                    <td className="px-4 py-2.5 text-xs text-stone-500">{idx + 1}</td>
                    <td className="px-4 py-2.5">
                      <p className="text-sm font-mono text-amber-400">{item.productPartNumber}</p>
                      <p className="text-xs text-stone-400">{item.productName}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm text-stone-300">{item.quantity}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-stone-300">
                      {new Intl.NumberFormat('vi-VN').format(item.unitPrice)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium text-stone-200">
                      {new Intl.NumberFormat('vi-VN').format(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="border-t border-stone-700 px-5 py-4">
              <div className="flex justify-end">
                <div className="w-64 space-y-1.5">
                  <div className="flex justify-between text-base font-bold border-t border-stone-700 pt-2">
                    <span className="text-stone-300">Tổng cộng</span>
                    <span className="text-amber-400">{formatCurrency(order.totalAmount)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {(order.notes || order.internalNotes) && (
            <div className="card p-5 space-y-3">
              {order.notes && (
                <div>
                  <p className="text-xs text-stone-500 mb-1">Ghi chú</p>
                  <p className="text-sm text-stone-300">{order.notes}</p>
                </div>
              )}
              {order.internalNotes && (
                <div className={order.notes ? 'pt-3 border-t border-stone-700/50' : ''}>
                  <p className="text-xs text-stone-500 mb-1">Ghi chú nội bộ</p>
                  <p className="text-sm text-yellow-400/80 italic">{order.internalNotes}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Payment Card */}
          <div className="card p-5">
            <h4 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5" /> Thanh toán
            </h4>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-stone-400">Tổng cộng</span>
                <span className="text-stone-200 font-medium">{formatCurrency(order.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-stone-400">Đã thanh toán</span>
                <span className="text-green-400 font-medium">{formatCurrency(order.paidAmount)}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-stone-700/50 pt-2">
                <span className="text-stone-300 font-medium">Còn lại</span>
                <span className={cn('font-bold', remainingAmount > 0 ? 'text-amber-400' : 'text-green-400')}>
                  {formatCurrency(remainingAmount)}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{
                    width: `${order.totalAmount ? Math.min(100, (order.paidAmount / order.totalAmount) * 100) : 0}%`,
                  }}
                />
              </div>

              {remainingAmount > 0 && (
                <>
                  {showPaymentForm ? (
                    <div className="space-y-2 pt-2">
                      <input
                        type="number"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder="Số tiền..."
                        className="w-full rounded-lg bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-200 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleRecordPayment}
                          disabled={recordPaymentMutation.isPending}
                          className="btn btn-primary flex-1 py-1.5 text-xs"
                        >
                          {recordPaymentMutation.isPending ? 'Đang lưu...' : 'Xác nhận'}
                        </button>
                        <button
                          onClick={() => setShowPaymentForm(false)}
                          className="btn btn-secondary py-1.5 text-xs px-3"
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowPaymentForm(true)}
                      className="w-full btn btn-primary py-2 text-xs mt-2"
                    >
                      <DollarSign className="h-3.5 w-3.5 mr-1" />
                      Ghi nhận thanh toán
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Order Details Card */}
          <div className="card p-5">
            <h4 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5" /> Chi tiết
            </h4>
            <div className="space-y-3 text-sm">
              {order.poNumber && (
                <div>
                  <p className="text-xs text-stone-500">Số PO</p>
                  <p className="text-stone-200 font-mono">{order.poNumber}</p>
                </div>
              )}
              {order.paymentDueDate && (
                <div>
                  <p className="text-xs text-stone-500">Hạn thanh toán</p>
                  <p className="text-stone-300">{format(new Date(order.paymentDueDate), 'dd/MM/yyyy')}</p>
                </div>
              )}
              {order.expectedDelivery && (
                <div>
                  <p className="text-xs text-stone-500">Giao hàng dự kiến</p>
                  <p className={cn(
                    'text-stone-300',
                    new Date(order.expectedDelivery) < new Date() &&
                      order.status !== 'delivered' &&
                      order.status !== 'completed' &&
                      'text-red-400 font-medium'
                  )}>
                    {format(new Date(order.expectedDelivery), 'dd/MM/yyyy')}
                  </p>
                </div>
              )}
              {order.actualDelivery && (
                <div>
                  <p className="text-xs text-stone-500">Giao hàng thực tế</p>
                  <p className="text-green-400">{format(new Date(order.actualDelivery), 'dd/MM/yyyy')}</p>
                </div>
              )}
              {order.trackingNumber && (
                <div>
                  <p className="text-xs text-stone-500">Tracking</p>
                  <p className="text-stone-200 font-mono">{order.trackingNumber}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-stone-500">Tiền tệ</p>
                <p className="text-stone-300">{order.currency}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={`Xóa đơn hàng ${order.orderNumber}?`}
        description="Hành động này không thể hoàn tác."
        confirmLabel="Xóa"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
