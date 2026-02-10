import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2 } from 'lucide-react'
import { useCreateSupplier, useUpdateSupplier } from '@/hooks/useSuppliers'
import { SUPPLIER_COUNTRIES, SUPPLIER_PLATFORMS } from '@/lib/constants'
import type { Supplier } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'

const supplierSchema = z.object({
  companyName: z.string().min(1, 'Tên công ty là bắt buộc'),
  companyNameLocal: z.string().optional(),
  country: z.string().min(1, 'Chọn quốc gia'),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
  contactWechat: z.string().optional(),
  platform: z.string().optional(),
  platformUrl: z.string().optional(),
  rating: z.number().min(1).max(5).optional(),
  qualityScore: z.number().min(0).max(10).optional(),
  deliveryScore: z.number().min(0).max(10).optional(),
  priceScore: z.number().min(0).max(10).optional(),
  speciality: z.string().optional(),
  brands: z.string().optional(),
  minOrderValue: z.number().optional(),
  leadTimeDays: z.number().optional(),
  paymentMethods: z.string().optional(),
  notes: z.string().optional(),
})

type SupplierFormData = z.infer<typeof supplierSchema>

interface SupplierFormProps {
  isOpen: boolean
  onClose: () => void
  supplier?: Supplier | null
  mode: 'create' | 'edit'
}

export default function SupplierForm({ isOpen, onClose, supplier, mode }: SupplierFormProps) {
  const createMutation = useCreateSupplier()
  const updateMutation = useUpdateSupplier()
  const { toast } = useToast()
  const isEdit = mode === 'edit'

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
  } = useForm<SupplierFormData>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {},
  })

  const watchRating = watch('rating')
  const watchQuality = watch('qualityScore')
  const watchDelivery = watch('deliveryScore')
  const watchPrice = watch('priceScore')

  useEffect(() => {
    if (isEdit && supplier) {
      reset({
        companyName: supplier.companyName,
        companyNameLocal: supplier.companyNameLocal || '',
        country: supplier.country,
        contactName: supplier.contactName || '',
        contactPhone: supplier.contactPhone || '',
        contactEmail: supplier.contactEmail || '',
        contactWechat: supplier.contactWechat || '',
        platform: supplier.platform || '',
        platformUrl: supplier.platformUrl || '',
        rating: supplier.rating || undefined,
        qualityScore: supplier.qualityScore || undefined,
        deliveryScore: supplier.deliveryScore || undefined,
        priceScore: supplier.priceScore || undefined,
        speciality: supplier.speciality || '',
        brands: supplier.brands || '',
        minOrderValue: supplier.minOrderValue || undefined,
        leadTimeDays: supplier.leadTimeDays || undefined,
        paymentMethods: supplier.paymentMethods || '',
        notes: supplier.notes || '',
      })
    } else {
      reset({
        companyName: '',
        country: 'china',
        contactName: '',
        contactPhone: '',
        contactEmail: '',
        platform: '',
        notes: '',
      })
    }
  }, [isEdit, supplier, reset])

  if (!isOpen) return null

  const onSubmit = async (data: SupplierFormData) => {
    try {
      if (isEdit && supplier) {
        await updateMutation.mutateAsync({ id: supplier.id, data })
        toast({ title: 'Cập nhật nhà cung cấp thành công' })
      } else {
        await createMutation.mutateAsync(data)
        toast({ title: 'Thêm nhà cung cấp thành công' })
      }
      reset()
      onClose()
    } catch {
      toast({ title: 'Lưu nhà cung cấp thất bại', variant: 'destructive' })
    }
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={handleClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl max-h-[90vh] bg-slate-900 rounded-xl border border-slate-700 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between bg-slate-800/50 px-6 py-4 border-b border-slate-700">
            <h2 className="font-display text-xl font-semibold text-slate-50">
              {isEdit ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp mới'}
            </h2>
            <button
              onClick={handleClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6">
            <div className="space-y-6">
              {/* Company Info */}
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-3">Thông tin công ty</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Tên công ty <span className="text-red-400">*</span>
                    </label>
                    <input
                      {...register('companyName')}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Company Name"
                    />
                    {errors.companyName && (
                      <p className="mt-1 text-xs text-red-400">{errors.companyName.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Tên tiếng Trung/bản địa</label>
                    <input
                      {...register('companyNameLocal')}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="本地名称"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Quốc gia <span className="text-red-400">*</span>
                    </label>
                    <select
                      {...register('country')}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {SUPPLIER_COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    {errors.country && (
                      <p className="mt-1 text-xs text-red-400">{errors.country.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Platform</label>
                    <select
                      {...register('platform')}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">-- Chọn --</option>
                      {SUPPLIER_PLATFORMS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Contact */}
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-3">Liên hệ</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Tên liên hệ</label>
                    <input
                      {...register('contactName')}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Điện thoại</label>
                    <input
                      {...register('contactPhone')}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
                    <input
                      {...register('contactEmail')}
                      type="email"
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">WeChat</label>
                    <input
                      {...register('contactWechat')}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Scores */}
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-3">Đánh giá</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Rating: {watchRating || '—'}/5
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      {...register('rating', { valueAsNumber: true })}
                      className="w-full accent-yellow-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Quality: {watchQuality || '—'}/10
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      {...register('qualityScore', { valueAsNumber: true })}
                      className="w-full accent-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Delivery: {watchDelivery || '—'}/10
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      {...register('deliveryScore', { valueAsNumber: true })}
                      className="w-full accent-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Price: {watchPrice || '—'}/10
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      {...register('priceScore', { valueAsNumber: true })}
                      className="w-full accent-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Business Info */}
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-3">Thông tin kinh doanh</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Chuyên môn</label>
                    <input
                      {...register('speciality')}
                      placeholder="Nozzle, Feeder..."
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Brands</label>
                    <input
                      {...register('brands')}
                      placeholder="Panasonic, Fuji..."
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">MOQ (giá trị tối thiểu)</label>
                    <input
                      type="number"
                      {...register('minOrderValue', { valueAsNumber: true })}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Lead time (ngày)</label>
                    <input
                      type="number"
                      {...register('leadTimeDays', { valueAsNumber: true })}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Ghi chú</label>
                <textarea
                  {...register('notes')}
                  rows={3}
                  className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          </form>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-700 bg-slate-800/50 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              onClick={handleSubmit(onSubmit)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Cập nhật' : 'Thêm NCC'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
