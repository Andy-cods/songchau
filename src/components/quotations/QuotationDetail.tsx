import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X,
  Edit,
  Send,
  CheckCircle,
  XCircle,
  FileDown,
  Trash2,
  User,
  Calendar,
  FileText,
  Loader2,
  ShoppingCart,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { QUOTATION_STATUS_COLORS, QUOTATION_STATUS_LABELS } from '@/lib/constants'
import { useQuotation, useUpdateQuotationStatus, useDeleteQuotation } from '@/hooks/useQuotations'
import { format } from 'date-fns'
import { pdf } from '@react-pdf/renderer'
import { useToast } from '@/hooks/use-toast'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import QuotationPDF from './QuotationPDF'

interface QuotationDetailProps {
  quotationId: number | null
  isOpen: boolean
  onClose: () => void
}

export default function QuotationDetail({ quotationId, isOpen, onClose }: QuotationDetailProps) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuotation(quotationId)
  const updateStatus = useUpdateQuotationStatus()
  const deleteMutation = useDeleteQuotation()
  const { toast } = useToast()
  const [exportingPDF, setExportingPDF] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<string | null>(null)

  const quotation = data?.data

  const handleStatusChange = (status: string) => {
    setPendingStatus(status)
  }

  const handleConfirmStatusChange = async () => {
    if (!quotationId || !pendingStatus) return
    try {
      await updateStatus.mutateAsync({ id: quotationId, status: pendingStatus })
      toast({ title: `Cập nhật trạng thái thành ${pendingStatus}` })
    } catch (error) {
      console.error('Failed to update status:', error)
      toast({ title: 'Cập nhật trạng thái thất bại', variant: 'destructive' })
    } finally {
      setPendingStatus(null)
    }
  }

  const handleDelete = async () => {
    if (!quotationId) return
    try {
      await deleteMutation.mutateAsync(quotationId)
      onClose()
    } catch (error) {
      console.error('Failed to delete:', error)
      toast({ title: 'Xóa báo giá thất bại', variant: 'destructive' })
    } finally {
      setShowDeleteConfirm(false)
    }
  }

  const handleExportPDF = async () => {
    if (!quotation) return
    setExportingPDF(true)
    try {
      const blob = await pdf(<QuotationPDF quotation={quotation} />).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${quotation.quoteNumber}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to export PDF:', error)
      toast({ title: 'Xuất PDF thất bại', variant: 'destructive' })
    } finally {
      setExportingPDF(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm slide-over-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-slate-900 border-l border-slate-700 shadow-2xl overflow-y-auto slide-over-panel">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-900/95 backdrop-blur border-b border-slate-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-blue-400" />
            <div>
              <h3 className="text-lg font-semibold text-slate-50">
                {isLoading ? '...' : quotation?.quoteNumber}
              </h3>
              {quotation && (
                <span
                  className={cn(
                    'inline-block px-2 py-0.5 rounded border text-xs font-medium mt-1',
                    QUOTATION_STATUS_COLORS[quotation.status]
                  )}
                >
                  {QUOTATION_STATUS_LABELS[quotation.status]}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
          </div>
        ) : !quotation ? (
          <div className="py-20 text-center text-slate-500">Quotation not found</div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigate(`/quotations/${quotationId}/edit`)}
                className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 transition-colors"
              >
                <Edit className="h-3.5 w-3.5" /> Edit
              </button>
              {quotation.status === 'draft' && (
                <button
                  onClick={() => handleStatusChange('sent')}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600/20 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-600/30 transition-colors"
                >
                  <Send className="h-3.5 w-3.5" /> Mark Sent
                </button>
              )}
              {(quotation.status === 'sent' || quotation.status === 'viewed') && (
                <>
                  <button
                    onClick={() => handleStatusChange('accepted')}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600/20 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-600/30 transition-colors"
                  >
                    <CheckCircle className="h-3.5 w-3.5" /> Accept
                  </button>
                  <button
                    onClick={() => handleStatusChange('rejected')}
                    className="flex items-center gap-1.5 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30 transition-colors"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </button>
                </>
              )}
              <button
                onClick={handleExportPDF}
                disabled={exportingPDF}
                className="flex items-center gap-1.5 rounded-lg bg-orange-600/20 px-3 py-1.5 text-xs font-medium text-orange-400 hover:bg-orange-600/30 transition-colors disabled:opacity-50"
              >
                {exportingPDF ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileDown className="h-3.5 w-3.5" />
                )}
                PDF
              </button>
              {quotation.status === 'accepted' && (
                <button
                  onClick={() => navigate(`/orders/new?fromQuotation=${quotationId}`)}
                  className="flex items-center gap-1.5 rounded-lg bg-purple-600/20 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-purple-600/30 transition-colors"
                >
                  <ShoppingCart className="h-3.5 w-3.5" /> Tạo đơn hàng
                </button>
              )}
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 rounded-lg bg-red-600/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/20 transition-colors ml-auto"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>

            {/* Customer Info */}
            <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-5">
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <User className="h-3.5 w-3.5" /> Customer
              </h4>
              <p className="text-sm font-medium text-slate-200">{quotation.customerName}</p>
              {quotation.customerContact && (
                <p className="text-xs text-slate-400 mt-1">{quotation.customerContact}</p>
              )}
              {quotation.customerPhone && (
                <p className="text-xs text-slate-400">{quotation.customerPhone}</p>
              )}
              {quotation.customerEmail && (
                <p className="text-xs text-slate-400">{quotation.customerEmail}</p>
              )}
            </div>

            {/* Quote Info */}
            <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-5">
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" /> Details
              </h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Created</p>
                  <p className="text-slate-300">{format(new Date(quotation.createdAt), 'dd/MM/yyyy HH:mm')}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Valid Until</p>
                  <p className="text-slate-300">
                    {quotation.validUntil
                      ? format(new Date(quotation.validUntil), 'dd/MM/yyyy')
                      : '—'}
                  </p>
                </div>
                {quotation.sentAt && (
                  <div>
                    <p className="text-xs text-slate-500">Sent At</p>
                    <p className="text-slate-300">{format(new Date(quotation.sentAt), 'dd/MM/yyyy HH:mm')}</p>
                  </div>
                )}
                {quotation.acceptedAt && (
                  <div>
                    <p className="text-xs text-slate-500">Accepted At</p>
                    <p className="text-slate-300">{format(new Date(quotation.acceptedAt), 'dd/MM/yyyy HH:mm')}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-500">Currency</p>
                  <p className="text-slate-300">{quotation.currency}</p>
                </div>
              </div>
              {quotation.notes && (
                <div className="mt-3 pt-3 border-t border-slate-700/50">
                  <p className="text-xs text-slate-500 mb-1">Notes</p>
                  <p className="text-sm text-slate-300">{quotation.notes}</p>
                </div>
              )}
              {quotation.internalNotes && (
                <div className="mt-3 pt-3 border-t border-slate-700/50">
                  <p className="text-xs text-slate-500 mb-1">Internal Notes</p>
                  <p className="text-sm text-yellow-400/80 italic">{quotation.internalNotes}</p>
                </div>
              )}
            </div>

            {/* Line Items */}
            <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-700/50">
                <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Items ({quotation.items?.length || 0})
                </h4>
              </div>
              <table className="w-full">
                <thead className="bg-slate-900/30">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">#</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Product</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Qty</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Unit Price</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {quotation.items?.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-mono text-blue-400">{item.productPartNumber}</p>
                        <p className="text-xs text-slate-400">{item.productName}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm text-slate-300">{item.quantity}</td>
                      <td className="px-4 py-2.5 text-right text-sm text-slate-300">
                        {new Intl.NumberFormat('vi-VN').format(item.unitPrice)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm font-medium text-slate-200">
                        {new Intl.NumberFormat('vi-VN').format(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div className="border-t border-slate-700 px-5 py-4">
                <div className="flex justify-end">
                  <div className="w-64 space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Subtotal</span>
                      <span className="text-slate-300">
                        {new Intl.NumberFormat('vi-VN').format(quotation.subtotal || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">VAT ({quotation.taxRate}%)</span>
                      <span className="text-slate-300">
                        {new Intl.NumberFormat('vi-VN').format(quotation.taxAmount || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-base font-bold border-t border-slate-700 pt-2">
                      <span className="text-slate-300">Total</span>
                      <span className="text-blue-400">
                        {new Intl.NumberFormat('vi-VN').format(quotation.totalAmount || 0)}{' '}
                        {quotation.currency}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status change confirm */}
      <ConfirmDialog
        isOpen={!!pendingStatus}
        title={
          pendingStatus === 'sent' ? 'Đánh dấu đã gửi?' :
          pendingStatus === 'accepted' ? 'Đánh dấu đã chấp nhận?' :
          pendingStatus === 'rejected' ? 'Đánh dấu từ chối?' : 'Xác nhận?'
        }
        confirmLabel="Xác nhận"
        onConfirm={handleConfirmStatusChange}
        onCancel={() => setPendingStatus(null)}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={`Xóa báo giá ${quotation?.quoteNumber || ''}?`}
        description="Hành động này không thể hoàn tác."
        confirmLabel="Xóa"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  )
}
