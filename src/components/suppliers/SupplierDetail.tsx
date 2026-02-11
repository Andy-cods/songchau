import { useState } from 'react'
import { X, Edit, Star, Globe, Phone, Mail, MessageCircle, Trash2 } from 'lucide-react'
import type { Supplier } from '@/lib/api'
import { cn, safeParseJsonArray } from '@/lib/utils'
import { SUPPLIER_COUNTRIES } from '@/lib/constants'

interface SupplierDetailProps {
  supplier: Supplier | null
  isOpen: boolean
  onClose: () => void
  onEdit?: (supplier: Supplier) => void
  onDelete?: (supplier: Supplier) => void
}

function ScoreBar({ label, score, color }: { label: string; score: number | null; color: string }) {
  if (!score) return null
  const percentage = (score / 10) * 100
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-stone-400">{label}</span>
        <span className="text-xs font-medium text-stone-600">{score}/10</span>
      </div>
      <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

export default function SupplierDetail({ supplier, isOpen, onClose, onEdit, onDelete }: SupplierDetailProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  if (!isOpen || !supplier) return null

  const countryData = SUPPLIER_COUNTRIES.find((c) => c.value === supplier.country)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 slide-over-backdrop" onClick={onClose} />

      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white border-l border-stone-200 z-50 overflow-y-auto slide-over-panel">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white/95 backdrop-blur border-b border-stone-200 px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-stone-900">
              {supplier.companyName}
            </h2>
            {supplier.companyNameLocal && (
              <p className="text-sm text-stone-400 mt-0.5">{supplier.companyNameLocal}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onDelete && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-600 hover:text-stone-900 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Xóa
              </button>
            )}
            {onEdit && (
              <button
                onClick={() => onEdit(supplier)}
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

        {/* Delete Confirmation */}
        {showDeleteConfirm && (
          <div className="mx-6 mt-4 rounded-lg bg-red-500/10 border border-red-500/30 p-4">
            <p className="text-sm text-red-300 mb-3">
              Bạn có chắc muốn xóa <strong>{supplier.companyName}</strong>? Hành động này không thể hoàn tác.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { onDelete!(supplier); setShowDeleteConfirm(false) }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                Xác nhận xóa
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg bg-stone-100 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-200 transition-colors"
              >
                Hủy
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Info Card */}
          <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-stone-500 uppercase tracking-wider">Quốc gia</label>
                <p className="text-stone-700 mt-1 flex items-center gap-2">
                  <span className="text-xl">{countryData?.flag || '🌐'}</span>
                  <span className="capitalize">{supplier.country}</span>
                </p>
              </div>

              <div>
                <label className="text-xs text-stone-500 uppercase tracking-wider">Platform</label>
                {supplier.platform ? (
                  <div className="mt-1">
                    <span className="inline-block px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-xs font-medium text-amber-400">
                      {supplier.platform}
                    </span>
                    {supplier.platformUrl && (
                      <a
                        href={supplier.platformUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-xs text-amber-400 hover:text-amber-300"
                      >
                        <Globe className="h-3.5 w-3.5 inline" /> Link
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-stone-500 mt-1">—</p>
                )}
              </div>

              <div>
                <label className="text-xs text-stone-500 uppercase tracking-wider">Rating</label>
                <div className="flex items-center gap-1 mt-1">
                  {supplier.rating ? (
                    <>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={cn(
                            'h-4 w-4',
                            star <= supplier.rating! ? 'fill-yellow-400 text-yellow-400' : 'text-stone-600'
                          )}
                        />
                      ))}
                      <span className="ml-1 text-sm text-stone-600">({supplier.rating})</span>
                    </>
                  ) : (
                    <span className="text-stone-500">—</span>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-stone-500 uppercase tracking-wider">Lead Time</label>
                <p className="text-stone-700 mt-1">
                  {supplier.leadTimeDays ? `${supplier.leadTimeDays} ngày` : '—'}
                </p>
              </div>

              {safeParseJsonArray(supplier.speciality).length > 0 && (
                <div className="col-span-2">
                  <label className="text-xs text-stone-500 uppercase tracking-wider">Chuyên môn</label>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {safeParseJsonArray(supplier.speciality).map((item) => (
                      <span key={item} className="inline-block px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs font-medium text-amber-400">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {safeParseJsonArray(supplier.brands).length > 0 && (
                <div className="col-span-2">
                  <label className="text-xs text-stone-500 uppercase tracking-wider">Brands</label>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {safeParseJsonArray(supplier.brands).map((item) => (
                      <span key={item} className="inline-block px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs font-medium text-amber-400">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {supplier.minOrderValue && (
                <div>
                  <label className="text-xs text-stone-500 uppercase tracking-wider">MOQ</label>
                  <p className="text-stone-700 mt-1">${supplier.minOrderValue.toLocaleString()}</p>
                </div>
              )}

              {safeParseJsonArray(supplier.paymentMethods).length > 0 && (
                <div>
                  <label className="text-xs text-stone-500 uppercase tracking-wider">Thanh toán</label>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {safeParseJsonArray(supplier.paymentMethods).map((item) => (
                      <span key={item} className="inline-block px-2.5 py-1 rounded-lg bg-stone-200 border border-stone-600/50 text-xs font-medium text-stone-600">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Score Card */}
          {(supplier.qualityScore || supplier.deliveryScore || supplier.priceScore) && (
            <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
              <h3 className="font-display text-lg font-semibold text-stone-900 mb-4">Scorecard</h3>
              <div className="space-y-4">
                <ScoreBar label="Quality" score={supplier.qualityScore} color="bg-green-500" />
                <ScoreBar label="Delivery" score={supplier.deliveryScore} color="bg-amber-500" />
                <ScoreBar label="Price" score={supplier.priceScore} color="bg-amber-500" />
              </div>
            </div>
          )}

          {/* Contact Card */}
          <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
            <h3 className="font-display text-lg font-semibold text-stone-900 mb-4">Liên hệ</h3>
            <div className="space-y-3">
              {supplier.contactName && (
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-stone-200 flex items-center justify-center text-stone-400">
                    {supplier.contactName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-stone-700">{supplier.contactName}</p>
                  </div>
                </div>
              )}
              {supplier.contactPhone && (
                <div className="flex items-center gap-3 text-sm text-stone-600">
                  <Phone className="h-4 w-4 text-stone-500" />
                  {supplier.contactPhone}
                </div>
              )}
              {supplier.contactEmail && (
                <div className="flex items-center gap-3 text-sm text-stone-600">
                  <Mail className="h-4 w-4 text-stone-500" />
                  {supplier.contactEmail}
                </div>
              )}
              {supplier.contactWechat && (
                <div className="flex items-center gap-3 text-sm text-stone-600">
                  <MessageCircle className="h-4 w-4 text-stone-500" />
                  WeChat: {supplier.contactWechat}
                </div>
              )}
              {!supplier.contactName && !supplier.contactPhone && !supplier.contactEmail && (
                <p className="text-sm text-stone-500">Chưa có thông tin liên hệ</p>
              )}
            </div>
          </div>

          {/* Notes */}
          {supplier.notes && (
            <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
              <h3 className="font-display text-lg font-semibold text-stone-900 mb-3">Ghi chú</h3>
              <p className="text-sm text-stone-600 whitespace-pre-wrap">{supplier.notes}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
