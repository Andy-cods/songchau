import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState } from 'react'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Hủy',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]" onClick={onCancel} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-stone-900 rounded-xl border border-stone-700 shadow-2xl p-6">
          <div className="flex items-start gap-4">
            {variant === 'danger' && (
              <div className="flex-shrink-0 rounded-full bg-red-500/10 p-2">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
            )}
            <div className="flex-1">
              <h3 className="text-base font-semibold text-stone-100">{title}</h3>
              {description && (
                <p className="mt-1.5 text-sm text-stone-400">{description}</p>
              )}
            </div>
          </div>
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              onClick={onCancel}
              disabled={loading}
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-300 hover:bg-stone-800 transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 flex items-center gap-2 ${
                variant === 'danger'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
