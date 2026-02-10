import { X, Edit, Star, Globe, Phone, Mail, MessageCircle } from 'lucide-react'
import type { Supplier } from '@/lib/api'
import { cn } from '@/lib/utils'
import { SUPPLIER_COUNTRIES } from '@/lib/constants'

interface SupplierDetailProps {
  supplier: Supplier | null
  isOpen: boolean
  onClose: () => void
  onEdit?: (supplier: Supplier) => void
}

function ScoreBar({ label, score, color }: { label: string; score: number | null; color: string }) {
  if (!score) return null
  const percentage = (score / 10) * 100
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="text-xs font-medium text-slate-300">{score}/10</span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

export default function SupplierDetail({ supplier, isOpen, onClose, onEdit }: SupplierDetailProps) {
  if (!isOpen || !supplier) return null

  const countryData = SUPPLIER_COUNTRIES.find((c) => c.value === supplier.country)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 slide-over-backdrop" onClick={onClose} />

      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-slate-900 border-l border-slate-700 z-50 overflow-y-auto slide-over-panel">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-900/95 backdrop-blur border-b border-slate-700 px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-50">
              {supplier.companyName}
            </h2>
            {supplier.companyNameLocal && (
              <p className="text-sm text-slate-400 mt-0.5">{supplier.companyNameLocal}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={() => onEdit(supplier)}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                <Edit className="h-4 w-4" />
                Sửa
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Info Card */}
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">Quốc gia</label>
                <p className="text-slate-200 mt-1 flex items-center gap-2">
                  <span className="text-xl">{countryData?.flag || '🌐'}</span>
                  <span className="capitalize">{supplier.country}</span>
                </p>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">Platform</label>
                {supplier.platform ? (
                  <div className="mt-1">
                    <span className="inline-block px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-xs font-medium text-indigo-400">
                      {supplier.platform}
                    </span>
                    {supplier.platformUrl && (
                      <a
                        href={supplier.platformUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-xs text-blue-400 hover:text-blue-300"
                      >
                        <Globe className="h-3.5 w-3.5 inline" /> Link
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-500 mt-1">—</p>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">Rating</label>
                <div className="flex items-center gap-1 mt-1">
                  {supplier.rating ? (
                    <>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={cn(
                            'h-4 w-4',
                            star <= supplier.rating! ? 'fill-yellow-400 text-yellow-400' : 'text-slate-600'
                          )}
                        />
                      ))}
                      <span className="ml-1 text-sm text-slate-300">({supplier.rating})</span>
                    </>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">Lead Time</label>
                <p className="text-slate-200 mt-1">
                  {supplier.leadTimeDays ? `${supplier.leadTimeDays} ngày` : '—'}
                </p>
              </div>

              {supplier.speciality && (
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider">Chuyên môn</label>
                  <p className="text-slate-200 mt-1">{supplier.speciality}</p>
                </div>
              )}

              {supplier.brands && (
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider">Brands</label>
                  <p className="text-slate-200 mt-1">{supplier.brands}</p>
                </div>
              )}

              {supplier.minOrderValue && (
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider">MOQ</label>
                  <p className="text-slate-200 mt-1">${supplier.minOrderValue.toLocaleString()}</p>
                </div>
              )}

              {supplier.paymentMethods && (
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider">Thanh toán</label>
                  <p className="text-slate-200 mt-1">{supplier.paymentMethods}</p>
                </div>
              )}
            </div>
          </div>

          {/* Score Card */}
          {(supplier.qualityScore || supplier.deliveryScore || supplier.priceScore) && (
            <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
              <h3 className="font-display text-lg font-semibold text-slate-50 mb-4">Scorecard</h3>
              <div className="space-y-4">
                <ScoreBar label="Quality" score={supplier.qualityScore} color="bg-green-500" />
                <ScoreBar label="Delivery" score={supplier.deliveryScore} color="bg-blue-500" />
                <ScoreBar label="Price" score={supplier.priceScore} color="bg-purple-500" />
              </div>
            </div>
          )}

          {/* Contact Card */}
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
            <h3 className="font-display text-lg font-semibold text-slate-50 mb-4">Liên hệ</h3>
            <div className="space-y-3">
              {supplier.contactName && (
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-400">
                    {supplier.contactName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-200">{supplier.contactName}</p>
                  </div>
                </div>
              )}
              {supplier.contactPhone && (
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <Phone className="h-4 w-4 text-slate-500" />
                  {supplier.contactPhone}
                </div>
              )}
              {supplier.contactEmail && (
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <Mail className="h-4 w-4 text-slate-500" />
                  {supplier.contactEmail}
                </div>
              )}
              {supplier.contactWechat && (
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <MessageCircle className="h-4 w-4 text-slate-500" />
                  WeChat: {supplier.contactWechat}
                </div>
              )}
              {!supplier.contactName && !supplier.contactPhone && !supplier.contactEmail && (
                <p className="text-sm text-slate-500">Chưa có thông tin liên hệ</p>
              )}
            </div>
          </div>

          {/* Notes */}
          {supplier.notes && (
            <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
              <h3 className="font-display text-lg font-semibold text-slate-50 mb-3">Ghi chú</h3>
              <p className="text-sm text-slate-300 whitespace-pre-wrap">{supplier.notes}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
