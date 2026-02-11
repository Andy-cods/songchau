import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const LOST_REASONS = [
  { value: 'price', label: 'Giá cả' },
  { value: 'quality', label: 'Chất lượng' },
  { value: 'delivery', label: 'Thời gian giao hàng' },
  { value: 'competitor', label: 'Đối thủ cạnh tranh' },
  { value: 'no_budget', label: 'Không ngân sách' },
  { value: 'other', label: 'Khác' },
]

interface StageChangeModalProps {
  isOpen: boolean
  type: 'lost' | 'won'
  onConfirm: (data: { lostReason?: string; quotationId?: number }) => Promise<void>
  onCancel: () => void
}

export default function StageChangeModal({ isOpen, type, onConfirm, onCancel }: StageChangeModalProps) {
  const [lostReason, setLostReason] = useState('price')
  const [quotationId, setQuotationId] = useState('')
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  const handleConfirm = async () => {
    setLoading(true)
    try {
      if (type === 'lost') {
        await onConfirm({ lostReason })
      } else {
        await onConfirm({ quotationId: quotationId ? parseInt(quotationId) : undefined })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]" onClick={onCancel} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-stone-900 rounded-xl border border-stone-700 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-stone-700 bg-stone-800/50">
            <h3 className="text-sm font-semibold text-stone-100">
              {type === 'lost' ? 'Chuyển sang Lost' : 'Chuyển sang Won'}
            </h3>
            <button
              onClick={onCancel}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-700 hover:text-stone-200 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5">
            {type === 'lost' ? (
              <div>
                <label className="block text-xs font-medium text-stone-400 mb-3">Lý do</label>
                <div className="space-y-2">
                  {LOST_REASONS.map((reason) => (
                    <label
                      key={reason.value}
                      className={cn(
                        'flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors',
                        lostReason === reason.value
                          ? 'bg-red-500/10 border-red-500/30 text-red-400'
                          : 'bg-stone-800/50 border-stone-700/50 text-stone-300 hover:border-stone-600'
                      )}
                    >
                      <input
                        type="radio"
                        name="lostReason"
                        value={reason.value}
                        checked={lostReason === reason.value}
                        onChange={(e) => setLostReason(e.target.value)}
                        className="sr-only"
                      />
                      <div
                        className={cn(
                          'h-4 w-4 rounded-full border-2 flex items-center justify-center',
                          lostReason === reason.value ? 'border-red-400' : 'border-stone-600'
                        )}
                      >
                        {lostReason === reason.value && (
                          <div className="h-2 w-2 rounded-full bg-red-400" />
                        )}
                      </div>
                      <span className="text-sm">{reason.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-stone-400 mb-1.5">
                  ID báo giá liên kết (tùy chọn)
                </label>
                <input
                  type="number"
                  value={quotationId}
                  onChange={(e) => setQuotationId(e.target.value)}
                  placeholder="VD: 1"
                  className="w-full rounded-lg bg-stone-800 border border-stone-700 px-3 py-2 text-sm text-stone-200 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <p className="mt-1.5 text-xs text-stone-500">
                  Để trống nếu không liên kết báo giá
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-stone-700 bg-stone-800/50">
            <button
              onClick={onCancel}
              disabled={loading}
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-300 hover:bg-stone-700 transition-colors"
            >
              Hủy
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 flex items-center gap-2',
                type === 'lost' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
              )}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {type === 'lost' ? 'Xác nhận Lost' : 'Xác nhận Won'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
