import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X } from 'lucide-react'
import type { Customer } from '@/lib/api'
import {
  CUSTOMER_TYPES,
  INDUSTRIES,
  INDUSTRIAL_ZONES,
  PROVINCES,
  SMT_BRANDS,
  PURCHASE_FREQUENCY,
  PAYMENT_TERMS,
  CUSTOMER_TIERS,
} from '@/lib/constants'

const customerSchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  companyNameLocal: z.string().optional(),
  type: z.string().min(1, 'Type is required'),
  industry: z.string().optional(),
  industrialZone: z.string().optional(),
  province: z.string().optional(),
  address: z.string().optional(),
  contactName: z.string().optional(),
  contactTitle: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactZalo: z.string().optional(),
  contactWechat: z.string().optional(),
  contact2Name: z.string().optional(),
  contact2Title: z.string().optional(),
  contact2Phone: z.string().optional(),
  contact2Email: z.string().email().optional().or(z.literal('')),
  smtBrands: z.array(z.string()).optional(),
  smtModels: z.string().optional(),
  purchaseFrequency: z.string().optional(),
  estimatedAnnualValue: z.number().optional(),
  paymentTerms: z.string().optional(),
  tier: z.string().optional(),
  status: z.string().default('active'),
  source: z.string().optional(),
  notes: z.string().optional(),
})

type CustomerFormData = z.infer<typeof customerSchema>

interface CustomerFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: Partial<Customer>) => Promise<void>
  customer?: Customer | null
  mode: 'create' | 'edit'
}

export default function CustomerForm({
  isOpen,
  onClose,
  onSubmit,
  customer,
  mode,
}: CustomerFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer
      ? {
          ...customer,
          smtBrands: customer.smtBrands ? JSON.parse(customer.smtBrands) : [],
        } as any
      : { status: 'active', smtBrands: [] },
  })

  if (!isOpen) return null

  const handleFormSubmit = async (data: CustomerFormData) => {
    try {
      const submitData: any = {
        ...data,
        smtBrands: data.smtBrands ? JSON.stringify(data.smtBrands) : null,
      }
      await onSubmit(submitData)
      reset()
      onClose()
    } catch (error) {
      console.error('Form submission error:', error)
    }
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl max-h-[90vh] bg-white rounded-xl border border-stone-200 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between bg-stone-50 px-6 py-4 border-b border-stone-200">
            <h2 className="font-display text-xl font-semibold text-stone-900">
              {mode === 'create' ? 'Thêm khách hàng mới' : 'Sửa khách hàng'}
            </h2>
            <button
              onClick={handleClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-200 hover:text-stone-700 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <form
            onSubmit={handleSubmit(handleFormSubmit)}
            className="flex-1 overflow-y-auto p-6"
          >
            <div className="space-y-6">
              {/* Company Info */}
              <div>
                <h3 className="text-sm font-medium text-stone-600 mb-3">
                  Company Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Company Name *
                    </label>
                    <input
                      {...register('companyName')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="Samsung Display Vietnam"
                    />
                    {errors.companyName && (
                      <p className="mt-1 text-xs text-red-400">
                        {errors.companyName.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Tên tiếng Việt
                    </label>
                    <input
                      {...register('companyNameLocal')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="Samsung Display Việt Nam"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Type *
                    </label>
                    <select
                      {...register('type')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="">Select type</option>
                      {CUSTOMER_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                    {errors.type && (
                      <p className="mt-1 text-xs text-red-400">{errors.type.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Industry
                    </label>
                    <select
                      {...register('industry')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="">Select industry</option>
                      {INDUSTRIES.map((ind) => (
                        <option key={ind.value} value={ind.value}>
                          {ind.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Industrial Zone
                    </label>
                    <select
                      {...register('industrialZone')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="">Select zone</option>
                      {INDUSTRIAL_ZONES.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Province
                    </label>
                    <select
                      {...register('province')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="">Select province</option>
                      {PROVINCES.map((prov) => (
                        <option key={prov} value={prov}>
                          {prov}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Address
                    </label>
                    <input
                      {...register('address')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="Full address"
                    />
                  </div>
                </div>
              </div>

              {/* Primary Contact */}
              <div>
                <h3 className="text-sm font-medium text-stone-600 mb-3">
                  Primary Contact
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Name
                    </label>
                    <input
                      {...register('contactName')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="Nguyễn Văn A"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Title
                    </label>
                    <input
                      {...register('contactTitle')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="Purchasing Manager"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Phone
                    </label>
                    <input
                      {...register('contactPhone')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="0985145533"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Email
                    </label>
                    <input
                      {...register('contactEmail')}
                      type="email"
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="contact@company.com"
                    />
                    {errors.contactEmail && (
                      <p className="mt-1 text-xs text-red-400">
                        {errors.contactEmail.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Zalo
                    </label>
                    <input
                      {...register('contactZalo')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="0985145533"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      WeChat
                    </label>
                    <input
                      {...register('contactWechat')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="wechat_id"
                    />
                  </div>
                </div>
              </div>

              {/* Secondary Contact */}
              <div>
                <h3 className="text-sm font-medium text-stone-600 mb-3">
                  Secondary Contact (Optional)
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Name
                    </label>
                    <input
                      {...register('contact2Name')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Title
                    </label>
                    <input
                      {...register('contact2Title')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Phone
                    </label>
                    <input
                      {...register('contact2Phone')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Email
                    </label>
                    <input
                      {...register('contact2Email')}
                      type="email"
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* Business Info */}
              <div>
                <h3 className="text-sm font-medium text-stone-600 mb-3">
                  Business Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      SMT Brands (Multi-select)
                    </label>
                    <select
                      {...register('smtBrands')}
                      multiple
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      size={4}
                    >
                      {SMT_BRANDS.map((brand) => (
                        <option key={brand} value={brand}>
                          {brand}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-stone-500">
                      Hold Ctrl/Cmd to select multiple
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Machine Models
                    </label>
                    <input
                      {...register('smtModels')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="NXT-H08, NPM-W2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Purchase Frequency
                    </label>
                    <select
                      {...register('purchaseFrequency')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="">Select frequency</option>
                      {PURCHASE_FREQUENCY.map((freq) => (
                        <option key={freq.value} value={freq.value}>
                          {freq.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Estimated Annual Value (VND)
                    </label>
                    <input
                      {...register('estimatedAnnualValue', { valueAsNumber: true })}
                      type="number"
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="500000000"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Payment Terms
                    </label>
                    <select
                      {...register('paymentTerms')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="">Select terms</option>
                      {PAYMENT_TERMS.map((term) => (
                        <option key={term.value} value={term.value}>
                          {term.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      Customer Tier
                    </label>
                    <select
                      {...register('tier')}
                      className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="">Select tier</option>
                      {CUSTOMER_TIERS.map((tier) => (
                        <option key={tier.value} value={tier.value}>
                          {tier.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">
                  Notes
                </label>
                <textarea
                  {...register('notes')}
                  rows={3}
                  className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                  placeholder="Additional notes..."
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              onClick={handleSubmit(handleFormSubmit)}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              {isSubmitting
                ? 'Saving...'
                : mode === 'create'
                ? 'Create Customer'
                : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
