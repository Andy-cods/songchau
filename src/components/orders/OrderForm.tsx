import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { useCreateOrder, useUpdateOrder, useOrder } from '@/hooks/useOrders'
import { useQuotation } from '@/hooks/useQuotations'
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
  status: z.string().default('pending'),
})

const orderSchema = z.object({
  customerId: z.number().min(1, 'Select a customer'),
  currency: z.string().default('VND'),
  poNumber: z.string().optional(),
  expectedDelivery: z.string().optional(),
  paymentDueDate: z.string().optional(),
  deliveryAddress: z.string().optional(),
  notes: z.string().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  items: z.array(lineItemSchema).min(1, 'Add at least one item'),
})

type FormData = z.infer<typeof orderSchema>

interface OrderFormProps {
  orderId?: number
}

export default function OrderForm({ orderId }: OrderFormProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromQuotationId = searchParams.get('fromQuotation')
  const customerIdParam = searchParams.get('customerId')
  const isEdit = !!orderId

  const { data: customerList } = useCustomerList()
  const { data: existingOrder } = useOrder(orderId || null)
  const { data: sourceQuotation } = useQuotation(fromQuotationId ? parseInt(fromQuotationId) : null)
  const createMutation = useCreateOrder()
  const updateMutation = useUpdateOrder()
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
    resolver: zodResolver(orderSchema),
    defaultValues: {
      customerId: 0,
      currency: 'VND',
      poNumber: '',
      expectedDelivery: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
      paymentDueDate: '',
      deliveryAddress: '',
      notes: '',
      internalNotes: '',
      items: [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watchItems = watch('items')

  // Load existing order data for edit mode
  useEffect(() => {
    if (isEdit && existingOrder?.data) {
      const o = existingOrder.data
      reset({
        customerId: o.customerId,
        currency: o.currency,
        poNumber: o.poNumber || '',
        expectedDelivery: o.expectedDelivery || '',
        paymentDueDate: o.paymentDueDate || '',
        deliveryAddress: o.deliveryAddress || '',
        notes: o.notes || '',
        internalNotes: o.internalNotes || '',
        items: (o.items || []).map((item) => ({
          productId: item.productId,
          productPartNumber: item.productPartNumber || '',
          productName: item.productName || '',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          costPrice: item.costPrice ?? null,
          amount: item.amount,
          status: item.status || 'pending',
        })),
      })
    }
  }, [isEdit, existingOrder, reset])

  // Pre-fill customerId from query param
  useEffect(() => {
    if (!isEdit && !fromQuotationId && customerIdParam) {
      setValue('customerId', parseInt(customerIdParam))
    }
  }, [isEdit, fromQuotationId, customerIdParam, setValue])

  // Pre-populate from quotation
  useEffect(() => {
    if (!isEdit && sourceQuotation?.data) {
      const q = sourceQuotation.data
      reset({
        customerId: q.customerId,
        currency: q.currency,
        poNumber: '',
        expectedDelivery: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
        paymentDueDate: '',
        deliveryAddress: '',
        notes: q.notes || '',
        internalNotes: `Từ báo giá ${q.quoteNumber}`,
        items: (q.items || []).map((item) => ({
          productId: item.productId,
          productPartNumber: item.productPartNumber || '',
          productName: item.productName || '',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          costPrice: item.costPrice ?? null,
          amount: item.amount,
          status: 'pending',
        })),
      })
    }
  }, [isEdit, sourceQuotation, reset])

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

  // Calculate total
  const totalAmount = watchItems?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0

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
        totalAmount,
        status: 'confirmed' as const,
        quotationId: fromQuotationId ? parseInt(fromQuotationId) : undefined,
      }

      if (isEdit && orderId) {
        await updateMutation.mutateAsync({ id: orderId, data: payload })
      } else {
        await createMutation.mutateAsync(payload as any)
      }
      navigate('/orders')
    } catch (error) {
      console.error('Failed to save order:', error)
      toast({ title: 'Lưu đơn hàng thất bại', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/orders')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="font-display text-2xl font-bold text-stone-900">
              {isEdit ? 'Sửa đơn hàng' : 'Tạo đơn hàng mới'}
            </h2>
            {fromQuotationId && sourceQuotation?.data && (
              <p className="text-sm text-stone-400 mt-0.5">
                Từ báo giá: {sourceQuotation.data.quoteNumber}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          className="flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors shadow-lg shadow-amber-600/20 disabled:opacity-50"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isEdit ? 'Cập nhật' : 'Tạo'} đơn hàng
        </button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Customer & Basic Info */}
        <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
          <h3 className="text-sm font-medium text-stone-600 mb-4">Thông tin đơn hàng</h3>
          <div className="grid grid-cols-4 gap-4">
            {/* Customer Select */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-stone-400 mb-1.5">
                Khách hàng <span className="text-red-400">*</span>
              </label>
              <select
                {...register('customerId', { valueAsNumber: true })}
                className="w-full rounded-lg bg-white border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value={0}>-- Chọn khách hàng --</option>
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
              <label className="block text-xs font-medium text-stone-400 mb-1.5">Tiền tệ</label>
              <select
                {...register('currency')}
                className="w-full rounded-lg bg-white border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="VND">VND</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
                <option value="JPY">JPY</option>
              </select>
            </div>

            {/* PO Number */}
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">Số PO</label>
              <input
                {...register('poNumber')}
                placeholder="PO-2024-001"
                className="w-full rounded-lg bg-white border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
              />
            </div>

            {/* Expected Delivery */}
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">Giao hàng dự kiến</label>
              <input
                type="date"
                {...register('expectedDelivery')}
                className="w-full rounded-lg bg-white border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Payment Due Date */}
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">Hạn thanh toán</label>
              <input
                type="date"
                {...register('paymentDueDate')}
                className="w-full rounded-lg bg-white border border-stone-200 px-3 py-2 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Delivery Address */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-stone-400 mb-1.5">Địa chỉ giao hàng</label>
              <input
                {...register('deliveryAddress')}
                placeholder="Địa chỉ..."
                className="w-full rounded-lg bg-white border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Notes */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-stone-400 mb-1.5">Ghi chú</label>
              <textarea
                {...register('notes')}
                rows={2}
                placeholder="Ghi chú đơn hàng..."
                className="w-full rounded-lg bg-white border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
              />
            </div>

            {/* Internal Notes */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-stone-400 mb-1.5">Ghi chú nội bộ</label>
              <textarea
                {...register('internalNotes')}
                rows={2}
                placeholder="Nội bộ..."
                className="w-full rounded-lg bg-white border border-stone-200 px-3 py-2 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-stone-600 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Sản phẩm
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
                  status: 'pending',
                })
              }
              className="flex items-center gap-1.5 rounded-lg bg-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-200 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Thêm SP
            </button>
          </div>

          {errors.items?.root && (
            <p className="mb-3 text-xs text-red-400">{errors.items.root.message}</p>
          )}

          {fields.length === 0 ? (
            <div className="py-12 text-center">
              <Package className="h-10 w-10 text-stone-600 mx-auto mb-3" />
              <p className="text-sm text-stone-500">Chưa có sản phẩm</p>
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
                    status: 'pending',
                  })
                }
                className="mt-3 text-sm text-amber-400 hover:text-amber-300"
              >
                + Thêm sản phẩm đầu tiên
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className="pb-2 text-left text-xs font-medium text-stone-400 w-8">#</th>
                    <th className="pb-2 text-left text-xs font-medium text-stone-400">Sản phẩm</th>
                    <th className="pb-2 text-right text-xs font-medium text-stone-400 w-24">SL</th>
                    <th className="pb-2 text-right text-xs font-medium text-stone-400 w-36">Đơn giá</th>
                    <th className="pb-2 text-right text-xs font-medium text-stone-400 w-36">Thành tiền</th>
                    <th className="pb-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-700/50">
                  {fields.map((field, index) => (
                    <tr key={field.id} className="group">
                      <td className="py-3 text-xs text-stone-500">{index + 1}</td>
                      <td className="py-3 pr-3">
                        {watchItems?.[index]?.productId ? (
                          <div>
                            <p className="text-sm font-mono text-amber-400">
                              {watchItems[index].productPartNumber}
                            </p>
                            <p className="text-xs text-stone-400">{watchItems[index].productName}</p>
                          </div>
                        ) : (
                          <div className="relative">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-500" />
                              <input
                                type="text"
                                value={activeItemIndex === index ? productSearch : ''}
                                onChange={(e) => {
                                  setProductSearch(e.target.value)
                                  setActiveItemIndex(index)
                                }}
                                onFocus={() => setActiveItemIndex(index)}
                                placeholder="Tìm part number hoặc tên..."
                                className="w-full rounded-lg bg-white border border-stone-200 pl-8 pr-3 py-1.5 text-sm text-stone-700 placeholder-stone-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                              />
                            </div>
                            {activeItemIndex === index && productResults.length > 0 && (
                              <div className="absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-lg bg-stone-100 border border-stone-600 shadow-xl">
                                {productResults.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => handleAddProduct(p, index)}
                                    className="w-full text-left px-3 py-2 hover:bg-stone-200 transition-colors"
                                  >
                                    <p className="text-sm font-mono text-amber-400">{p.partNumber}</p>
                                    <p className="text-xs text-stone-400">
                                      {p.name} {p.brand && `• ${p.brand}`}
                                      {p.sellingPrice && ` • ${new Intl.NumberFormat('vi-VN').format(p.sellingPrice)}`}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            )}
                            {activeItemIndex === index && searchingProducts && (
                              <div className="absolute z-20 mt-1 w-full rounded-lg bg-stone-100 border border-stone-600 p-3 text-center">
                                <Loader2 className="h-4 w-4 animate-spin text-stone-400 mx-auto" />
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
                          className="w-full rounded-lg bg-white border border-stone-200 px-2 py-1.5 text-sm text-right text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
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
                          className="w-full rounded-lg bg-white border border-stone-200 px-2 py-1.5 text-sm text-right text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <p className="text-sm font-medium text-stone-700">
                          {new Intl.NumberFormat('vi-VN').format(watchItems?.[index]?.amount || 0)}
                        </p>
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          className="p-1 rounded text-stone-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
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
          <div className="rounded-xl bg-stone-50 border border-stone-200 p-6">
            <div className="flex justify-end">
              <div className="w-72 space-y-2">
                <div className="flex items-center justify-between border-t border-stone-200 pt-2">
                  <span className="text-sm font-medium text-stone-600">Tổng cộng</span>
                  <span className="text-lg font-bold text-amber-400">
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
