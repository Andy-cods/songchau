import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2 } from 'lucide-react'
import { useCustomerList } from '@/hooks/useCustomerList'
import { useCreateDeal, useUpdateDeal } from '@/hooks/usePipeline'
import type { PipelineDeal } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'

const dealSchema = z.object({
  title: z.string().min(1, 'Tiêu đề là bắt buộc'),
  customerId: z.number().optional(),
  dealValue: z.number().optional(),
  currency: z.string().default('VND'),
  probability: z.number().min(0).max(100).default(50),
  expectedCloseDate: z.string().optional(),
  stage: z.string().default('lead'),
  notes: z.string().optional(),
})

type DealFormData = z.infer<typeof dealSchema>

interface DealFormProps {
  isOpen: boolean
  onClose: () => void
  deal?: PipelineDeal | null
  defaultStage?: string
}

const STAGES = [
  { value: 'lead', label: 'Lead' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
]

export default function DealForm({ isOpen, onClose, deal, defaultStage }: DealFormProps) {
  const { data: customerList } = useCustomerList()
  const createMutation = useCreateDeal()
  const updateMutation = useUpdateDeal()
  const { toast } = useToast()
  const isEdit = !!deal

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
  } = useForm<DealFormData>({
    resolver: zodResolver(dealSchema),
    defaultValues: {
      title: '',
      customerId: undefined,
      dealValue: undefined,
      currency: 'VND',
      probability: 50,
      expectedCloseDate: '',
      stage: defaultStage || 'lead',
      notes: '',
    },
  })

  const watchProbability = watch('probability')

  // Load deal data for edit
  useEffect(() => {
    if (isEdit && deal) {
      reset({
        title: deal.title,
        customerId: deal.customerId || undefined,
        dealValue: deal.dealValue || undefined,
        currency: deal.currency,
        probability: deal.probability || 50,
        expectedCloseDate: deal.expectedCloseDate || '',
        stage: deal.stage,
        notes: deal.notes || '',
      })
    } else if (!isEdit) {
      reset({
        title: '',
        customerId: undefined,
        dealValue: undefined,
        currency: 'VND',
        probability: 50,
        expectedCloseDate: '',
        stage: defaultStage || 'lead',
        notes: '',
      })
    }
  }, [isEdit, deal, defaultStage, reset])

  if (!isOpen) return null

  const onSubmit = async (data: DealFormData) => {
    try {
      if (isEdit && deal) {
        await updateMutation.mutateAsync({ id: deal.id, data })
        toast({ title: 'Cập nhật deal thành công' })
      } else {
        await createMutation.mutateAsync(data)
        toast({ title: 'Tạo deal thành công' })
      }
      reset()
      onClose()
    } catch {
      toast({ title: 'Lưu deal thất bại', variant: 'destructive' })
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
        <div className="w-full max-w-lg max-h-[90vh] bg-white rounded-xl border border-stone-200 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between bg-stone-50 px-6 py-4 border-b border-stone-200">
            <h2 className="font-display text-xl font-semibold text-stone-900">
              {isEdit ? 'Sửa deal' : 'Tạo deal mới'}
            </h2>
            <button
              onClick={handleClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-200 hover:text-stone-700 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6">
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-stone-400 mb-1.5">
                  Tiêu đề <span className="text-red-400">*</span>
                </label>
                <input
                  {...register('title')}
                  placeholder="VD: Nozzle cho Samsung VN"
                  className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                {errors.title && (
                  <p className="mt-1 text-xs text-red-400">{errors.title.message}</p>
                )}
              </div>

              {/* Customer */}
              <div>
                <label className="block text-xs font-medium text-stone-400 mb-1.5">Khách hàng</label>
                <select
                  {...register('customerId', { valueAsNumber: true })}
                  className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">-- Chọn khách hàng --</option>
                  {customerList?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Deal Value */}
                <div>
                  <label className="block text-xs font-medium text-stone-400 mb-1.5">Giá trị deal</label>
                  <input
                    type="number"
                    {...register('dealValue', { valueAsNumber: true })}
                    placeholder="0"
                    className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                {/* Currency */}
                <div>
                  <label className="block text-xs font-medium text-stone-400 mb-1.5">Tiền tệ</label>
                  <select
                    {...register('currency')}
                    className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="VND">VND</option>
                    <option value="USD">USD</option>
                    <option value="CNY">CNY</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Probability */}
                <div>
                  <label className="block text-xs font-medium text-stone-400 mb-1.5">
                    Xác suất: {watchProbability}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    {...register('probability', { valueAsNumber: true })}
                    className="w-full accent-brand-500"
                  />
                </div>

                {/* Stage */}
                <div>
                  <label className="block text-xs font-medium text-stone-400 mb-1.5">Stage</label>
                  <select
                    {...register('stage')}
                    className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {STAGES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Expected Close Date */}
              <div>
                <label className="block text-xs font-medium text-stone-400 mb-1.5">Ngày dự kiến chốt</label>
                <input
                  type="date"
                  {...register('expectedCloseDate')}
                  className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-stone-400 mb-1.5">Ghi chú</label>
                <textarea
                  {...register('notes')}
                  rows={3}
                  placeholder="Ghi chú thêm..."
                  className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>
            </div>
          </form>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-stone-200 bg-stone-50 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-200 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              onClick={handleSubmit(onSubmit)}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Cập nhật' : 'Tạo deal'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
