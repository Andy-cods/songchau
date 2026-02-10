import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Search,
  Save,
  Loader2,
  Package,
} from 'lucide-react'
import { useCustomerList } from '@/hooks/useCustomerList'
import { useCreateQuotation, useUpdateQuotation, useNextQuoteNumber, useQuotation } from '@/hooks/useQuotations'
import { fetchProducts, type Product } from '@/lib/api'
import { useDebounce } from '@/hooks/useDebounce'
import { useToast } from '@/hooks/use-toast'
import { format, addDays } from 'date-fns'

// Zod schema
const lineItemSchema = z.object({
  productId: z.number().min(1, 'Select a product'),
  productPartNumber: z.string().optional(),
  productName: z.string().optional(),
  quantity: z.number().min(1, 'Min 1'),
  unitPrice: z.number().min(0, 'Min 0'),
  costPrice: z.number().nullable().optional(),
  amount: z.number(),
  notes: z.string().nullable().optional(),
})

const quotationSchema = z.object({
  customerId: z.number().min(1, 'Select a customer'),
  currency: z.string().default('VND'),
  taxRate: z.number().default(10),
  validUntil: z.string().min(1, 'Required'),
  notes: z.string().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  items: z.array(lineItemSchema).min(1, 'Add at least one item'),
})

type FormData = z.infer<typeof quotationSchema>

interface QuotationFormProps {
  quotationId?: number
}

export default function QuotationForm({ quotationId }: QuotationFormProps) {
  const navigate = useNavigate()
  const isEdit = !!quotationId
  const { data: customerList } = useCustomerList()
  const { data: nextNumber } = useNextQuoteNumber()
  const { data: existingQuotation } = useQuotation(quotationId || null)
  const createMutation = useCreateQuotation()
  const updateMutation = useUpdateQuotation()
  const { toast } = useToast()

  // Product search state
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [searchingProducts, setSearchingProducts] = useState(false)
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null)
  const debouncedSearch = useDebounce(productSearch, 300)

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(quotationSchema),
    defaultValues: {
      customerId: 0,
      currency: 'VND',
      taxRate: 10,
      validUntil: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
      notes: '',
      internalNotes: '',
      items: [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watch('items')
  const watchTaxRate = watch('taxRate')

  // Load existing quotation data for edit mode
  useEffect(() => {
    if (isEdit && existingQuotation?.data) {
      const q = existingQuotation.data
      reset({
        customerId: q.customerId,
        currency: q.currency,
        taxRate: q.taxRate,
        validUntil: q.validUntil || '',
        notes: q.notes || '',
        internalNotes: q.internalNotes || '',
        items: (q.items || []).map((item) => ({
          productId: item.productId,
          productPartNumber: item.productPartNumber || '',
          productName: item.productName || '',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          costPrice: item.costPrice ?? null,
          amount: item.amount,
          notes: item.notes || '',
        })),
      })
    }
  }, [isEdit, existingQuotation, reset])

  // Product search
  useEffect(() => {
    if (!debouncedSearch || debouncedSearch.length < 2) {
      setProductResults([])
      return
    }
    setSearchingProducts(true)
    fetchProducts({ search: debouncedSearch, limit: 10 })
      .then((res) => setProductResults(res.data))
      .catch(console.error)
      .finally(() => setSearchingProducts(false))
  }, [debouncedSearch])

  // Calculate totals
  const subtotal = watchItems?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0
  const taxAmount = Math.round(subtotal * (watchTaxRate / 100))
  const totalAmount = subtotal + taxAmount

  // Add product to line items
  const handleAddProduct = useCallback(
    (product: Product, index: number) => {
      setValue(`items.${index}.productId`, product.id)
      setValue(`items.${index}.productPartNumber`, product.partNumber)
      setValue(`items.${index}.productName`, product.name)
      setValue(`items.${index}.unitPrice`, product.sellingPrice || 0)
      setValue(`items.${index}.costPrice`, product.costPrice ?? null)
      setValue(`items.${index}.amount`, (product.sellingPrice || 0) * (watchItems?.[index]?.quantity || 1))
      setProductSearch('')
      setProductResults([])
      setActiveItemIndex(null)
    },
    [setValue, watchItems]
  )


  // Submit
  const onSubmit = async (data: FormData) => {
    try {
      const payload = {
        ...data,
        quoteNumber: isEdit ? undefined : nextNumber?.quoteNumber,
        subtotal,
        taxAmount,
        totalAmount,
        status: 'draft' as const,
      }

      if (isEdit && quotationId) {
        await updateMutation.mutateAsync({ id: quotationId, data: payload })
      } else {
        await createMutation.mutateAsync(payload as any)
      }
      navigate('/quotations')
    } catch (error) {
      console.error('Failed to save quotation:', error)
      toast({ title: 'Lưu báo giá thất bại', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/quotations')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-50">
              {isEdit ? 'Edit Quotation' : 'New Quotation'}
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {isEdit
                ? existingQuotation?.data?.quoteNumber
                : nextNumber?.quoteNumber || 'Loading...'}
            </p>
          </div>
        </div>
        <button
          onClick={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20 disabled:opacity-50"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isEdit ? 'Update' : 'Create'} Quotation
        </button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Customer & Basic Info */}
        <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
          <h3 className="text-sm font-medium text-slate-300 mb-4">Customer & Quote Info</h3>
          <div className="grid grid-cols-4 gap-4">
            {/* Customer Select */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Customer <span className="text-red-400">*</span>
              </label>
              <select
                {...register('customerId', { valueAsNumber: true })}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value={0}>-- Select Customer --</option>
                {customerList?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName}
                  </option>
                ))}
              </select>
              {errors.customerId && (
                <p className="mt-1 text-xs text-red-400">{errors.customerId.message}</p>
              )}
            </div>

            {/* Currency */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Currency</label>
              <select
                {...register('currency')}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="VND">VND</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
                <option value="JPY">JPY</option>
              </select>
            </div>

            {/* Valid Until */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Valid Until <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                {...register('validUntil')}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {errors.validUntil && (
                <p className="mt-1 text-xs text-red-400">{errors.validUntil.message}</p>
              )}
            </div>

            {/* Tax Rate */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Tax Rate (%)</label>
              <input
                type="number"
                step="0.1"
                {...register('taxRate', { valueAsNumber: true })}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Notes */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes (shown on PDF)</label>
              <textarea
                {...register('notes')}
                rows={2}
                placeholder="Payment terms, delivery notes..."
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Internal Notes */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Internal Notes</label>
              <textarea
                {...register('internalNotes')}
                rows={2}
                placeholder="Internal use only..."
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Line Items
            </h3>
            <button
              type="button"
              onClick={() =>
                append({
                  productId: 0,
                  productPartNumber: '',
                  productName: '',
                  quantity: 1,
                  unitPrice: 0,
                  costPrice: null,
                  amount: 0,
                  notes: '',
                })
              }
              className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Item
            </button>
          </div>

          {errors.items?.root && (
            <p className="mb-3 text-xs text-red-400">{errors.items.root.message}</p>
          )}

          {fields.length === 0 ? (
            <div className="py-12 text-center">
              <Package className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No items added yet</p>
              <button
                type="button"
                onClick={() =>
                  append({
                    productId: 0,
                    productPartNumber: '',
                    productName: '',
                    quantity: 1,
                    unitPrice: 0,
                    costPrice: null,
                    amount: 0,
                    notes: '',
                  })
                }
                className="mt-3 text-sm text-blue-400 hover:text-blue-300"
              >
                + Add your first item
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="pb-2 text-left text-xs font-medium text-slate-400 w-8">#</th>
                    <th className="pb-2 text-left text-xs font-medium text-slate-400">Product</th>
                    <th className="pb-2 text-right text-xs font-medium text-slate-400 w-24">Qty</th>
                    <th className="pb-2 text-right text-xs font-medium text-slate-400 w-36">Unit Price</th>
                    <th className="pb-2 text-right text-xs font-medium text-slate-400 w-36">Amount</th>
                    <th className="pb-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {fields.map((field, index) => (
                    <tr key={field.id} className="group">
                      <td className="py-3 text-xs text-slate-500">{index + 1}</td>
                      <td className="py-3 pr-3">
                        {watchItems?.[index]?.productId ? (
                          <div>
                            <p className="text-sm font-mono text-blue-400">
                              {watchItems[index].productPartNumber}
                            </p>
                            <p className="text-xs text-slate-400">{watchItems[index].productName}</p>
                          </div>
                        ) : (
                          <div className="relative">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                              <input
                                type="text"
                                value={activeItemIndex === index ? productSearch : ''}
                                onChange={(e) => {
                                  setProductSearch(e.target.value)
                                  setActiveItemIndex(index)
                                }}
                                onFocus={() => setActiveItemIndex(index)}
                                placeholder="Search part number or name..."
                                className="w-full rounded-lg bg-slate-900 border border-slate-700 pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            {activeItemIndex === index && productResults.length > 0 && (
                              <div className="absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-lg bg-slate-800 border border-slate-600 shadow-xl">
                                {productResults.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => handleAddProduct(p, index)}
                                    className="w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors"
                                  >
                                    <p className="text-sm font-mono text-blue-400">{p.partNumber}</p>
                                    <p className="text-xs text-slate-400">
                                      {p.name} {p.brand && `• ${p.brand}`}
                                      {p.sellingPrice && ` • ${new Intl.NumberFormat('vi-VN').format(p.sellingPrice)}`}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            )}
                            {activeItemIndex === index && searchingProducts && (
                              <div className="absolute z-20 mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 p-3 text-center">
                                <Loader2 className="h-4 w-4 animate-spin text-slate-400 mx-auto" />
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        <input
                          type="number"
                          min={1}
                          {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 1
                            setValue(`items.${index}.quantity`, val)
                            setValue(`items.${index}.amount`, val * (watchItems?.[index]?.unitPrice || 0))
                          }}
                          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-right text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <input
                          type="number"
                          min={0}
                          {...register(`items.${index}.unitPrice`, { valueAsNumber: true })}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0
                            setValue(`items.${index}.unitPrice`, val)
                            setValue(`items.${index}.amount`, (watchItems?.[index]?.quantity || 1) * val)
                          }}
                          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-right text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <p className="text-sm font-medium text-slate-200">
                          {new Intl.NumberFormat('vi-VN').format(watchItems?.[index]?.amount || 0)}
                        </p>
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Totals */}
        {fields.length > 0 && (
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6">
            <div className="flex justify-end">
              <div className="w-72 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Subtotal</span>
                  <span className="text-slate-200 font-medium">
                    {new Intl.NumberFormat('vi-VN').format(subtotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">VAT ({watchTaxRate}%)</span>
                  <span className="text-slate-200">
                    {new Intl.NumberFormat('vi-VN').format(taxAmount)}
                  </span>
                </div>
                <div className="border-t border-slate-700 pt-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">Total</span>
                  <span className="text-lg font-bold text-blue-400">
                    {new Intl.NumberFormat('vi-VN').format(totalAmount)} {watch('currency')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
