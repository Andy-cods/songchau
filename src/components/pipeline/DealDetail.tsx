import { X, Edit, User, Calendar, DollarSign, FileText, Target } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { type PipelineDeal } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

const STAGE_COLORS: Record<string, string> = {
  lead: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  qualified: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  proposal: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  negotiation: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  won: 'bg-green-500/10 text-green-400 border-green-500/20',
  lost: 'bg-red-500/10 text-red-400 border-red-500/20',
}

interface DealDetailProps {
  deal: PipelineDeal | null
  isOpen: boolean
  onClose: () => void
  onEdit?: (deal: PipelineDeal) => void
}

export default function DealDetail({ deal, isOpen, onClose, onEdit }: DealDetailProps) {
  const navigate = useNavigate()

  if (!isOpen || !deal) return null

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '—'
    return new Intl.NumberFormat('vi-VN').format(amount) + ' ' + deal.currency
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 slide-over-backdrop"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-slate-900 border-l border-slate-700 z-50 overflow-y-auto slide-over-panel">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-900/95 backdrop-blur border-b border-slate-700 px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-50">
              {deal.title}
            </h2>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={cn('badge border text-xs', STAGE_COLORS[deal.stage] || 'bg-slate-700/50 text-slate-300 border-slate-600')}>
                {deal.stage}
              </span>
              {deal.probability !== null && deal.probability !== undefined && (
                <span className="text-xs text-slate-400">{deal.probability}% xác suất</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={() => onEdit(deal)}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
              >
                <Edit className="h-3.5 w-3.5" /> Sửa
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Value Card */}
          <div className="rounded-xl bg-gradient-to-br from-brand-500/10 to-brand-600/5 border border-brand-500/20 p-5">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4 text-brand-400" />
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Giá trị deal</span>
            </div>
            <p className="font-display text-2xl font-bold text-slate-50">
              {formatCurrency(deal.dealValue)}
            </p>
            {deal.dealValue && deal.probability !== null && (
              <p className="text-sm text-slate-400 mt-1">
                Có trọng số: {formatCurrency(Math.round(deal.dealValue * (deal.probability || 0) / 100))}
              </p>
            )}
          </div>

          {/* Deal Info */}
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-5">
            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Target className="h-3.5 w-3.5" /> Chi tiết
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500">Stage</p>
                <p className="text-slate-200 capitalize mt-0.5">{deal.stage}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Xác suất</p>
                <p className="text-slate-200 mt-0.5">{deal.probability ?? 0}%</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Tiền tệ</p>
                <p className="text-slate-200 mt-0.5">{deal.currency}</p>
              </div>
              {deal.expectedCloseDate && (
                <div>
                  <p className="text-xs text-slate-500">Ngày dự kiến chốt</p>
                  <p className="text-slate-200 mt-0.5">{format(new Date(deal.expectedCloseDate), 'dd/MM/yyyy')}</p>
                </div>
              )}
              {deal.actualCloseDate && (
                <div>
                  <p className="text-xs text-slate-500">Ngày chốt thực tế</p>
                  <p className="text-green-400 mt-0.5">{format(new Date(deal.actualCloseDate), 'dd/MM/yyyy')}</p>
                </div>
              )}
              {deal.lostReason && (
                <div>
                  <p className="text-xs text-slate-500">Lý do lost</p>
                  <p className="text-red-400 mt-0.5 capitalize">{deal.lostReason.replace('_', ' ')}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-slate-500">Tạo ngày</p>
                <p className="text-slate-200 mt-0.5">{format(new Date(deal.createdAt), 'dd/MM/yyyy')}</p>
              </div>
            </div>
          </div>

          {/* Customer */}
          {deal.customerName && (
            <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-5">
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <User className="h-3.5 w-3.5" /> Khách hàng
              </h4>
              <p
                className="text-sm font-medium text-blue-400 cursor-pointer hover:underline"
                onClick={() => { navigate('/customers'); onClose() }}
              >
                {deal.customerName}
              </p>
            </div>
          )}

          {/* Linked Quotation */}
          {deal.quotationId && (
            <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-5">
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" /> Báo giá liên kết
              </h4>
              <button
                onClick={() => { navigate('/quotations'); onClose() }}
                className="text-sm font-mono text-blue-400 hover:underline"
              >
                Quotation #{deal.quotationId}
              </button>
            </div>
          )}

          {/* Notes */}
          {deal.notes && (
            <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-5">
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" /> Ghi chú
              </h4>
              <p className="text-sm text-slate-300">{deal.notes}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
