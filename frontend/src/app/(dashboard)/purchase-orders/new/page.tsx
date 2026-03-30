'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { PaginatedResponse, Supplier } from '@/types/models';

// ─── Zod Schema ─────────────────────────────────────────────────

const lineItemSchema = z.object({
  product_name: z.string().min(1, 'Nhập tên sản phẩm'),
  specification: z.string().optional(),
  quantity: z.coerce.number().positive('Số lượng phải lớn hơn 0'),
  unit: z.string().min(1, 'Nhập đơn vị'),
  unit_price: z.coerce.number().min(0, 'Đơn giá không âm'),
  currency: z.enum(['VND', 'USD', 'RMB']),
});

const poSchema = z.object({
  supplier_id: z.string().min(1, 'Chọn nhà cung cấp'),
  expected_delivery: z.string().optional(),
  notes: z.string().optional(),
  currency: z.enum(['VND', 'USD', 'RMB']),
  items: z.array(lineItemSchema).min(1, 'Thêm ít nhất một sản phẩm'),
});

type POFormData = z.infer<typeof poSchema>;

// ─── Default line item ───────────────────────────────────────────

const DEFAULT_ITEM = {
  product_name: '',
  specification: '',
  quantity: 1,
  unit: 'cái',
  unit_price: 0,
  currency: 'VND' as const,
};

// ─── Component ──────────────────────────────────────────────────

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch suppliers
  const { data: suppliersData, isLoading: suppliersLoading } = useQuery<
    PaginatedResponse<Supplier>
  >({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/api/v1/suppliers?page_size=200'),
    retry: false,
  });
  const suppliers = suppliersData?.items ?? [];

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<POFormData>({
    resolver: zodResolver(poSchema),
    defaultValues: {
      supplier_id: '',
      expected_delivery: '',
      notes: '',
      currency: 'VND',
      items: [DEFAULT_ITEM],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const watchedItems = watch('items');
  const watchedCurrency = watch('currency');

  // Calculate totals
  const lineSubtotals = (watchedItems ?? []).map(
    (item) => (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)
  );
  const total = lineSubtotals.reduce((sum, v) => sum + v, 0);

  const onSubmit = async (data: POFormData) => {
    setIsSubmitting(true);
    try {
      const payload = {
        ...data,
        items: data.items.map((item, idx) => ({
          ...item,
          currency: data.currency,
          total_price: lineSubtotals[idx],
        })),
      };
      await api.post('/api/v1/purchase-orders', payload);
      toast.success('Tạo đơn hàng thành công!');
      router.push('/purchase-orders');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'detail' in err
          ? (err as { detail: string }).detail
          : 'Có lỗi xảy ra';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/purchase-orders"
          className="p-2 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            Tạo đơn mua hàng mới
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Điền thông tin đơn đặt hàng
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* General Info Card */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            Thông tin chung
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Supplier */}
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Nhà cung cấp <span className="text-red-500">*</span>
              </label>
              <select
                {...register('supplier_id')}
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  errors.supplier_id ? 'border-red-400' : 'border-slate-300'
                )}
                disabled={suppliersLoading}
              >
                <option value="">
                  {suppliersLoading ? 'Đang tải...' : '-- Chọn nhà cung cấp --'}
                </option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
              {errors.supplier_id && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.supplier_id.message}
                </p>
              )}
            </div>

            {/* Currency */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Tiền tệ <span className="text-red-500">*</span>
              </label>
              <select
                {...register('currency')}
                className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="VND">VNĐ (VND)</option>
                <option value="USD">USD</option>
                <option value="RMB">Nhân dân tệ (CNY)</option>
              </select>
            </div>

            {/* Expected delivery */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Ngày giao hàng dự kiến
              </label>
              <input
                type="date"
                {...register('expected_delivery')}
                className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Notes */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Ghi chú
              </label>
              <textarea
                {...register('notes')}
                rows={3}
                placeholder="Nhập ghi chú, yêu cầu đặc biệt..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
            </div>
          </div>
        </div>

        {/* Line Items Card */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700">
              Danh sách sản phẩm
            </h3>
            <button
              type="button"
              onClick={() => append({ ...DEFAULT_ITEM, currency: watchedCurrency })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-md transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Thêm dòng
            </button>
          </div>

          {errors.items && typeof errors.items.message === 'string' && (
            <p className="text-xs text-red-500 mb-3">{errors.items.message}</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  {['#', 'Tên sản phẩm', 'Quy cách / Thông số', 'Số lượng', 'Đơn vị', 'Đơn giá', 'Thành tiền', ''].map(
                    (h, i) => (
                      <th
                        key={i}
                        className={cn(
                          'px-3 py-2.5 text-left text-xs font-mono uppercase tracking-wider text-slate-400',
                          i === 0 && 'w-10',
                          i === 7 && 'w-10'
                        )}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fields.map((field, index) => {
                  const subtotal = lineSubtotals[index] ?? 0;
                  return (
                    <tr key={field.id} className="group">
                      <td className="px-3 py-2 text-xs text-slate-400 font-mono">
                        {index + 1}
                      </td>

                      {/* Product name */}
                      <td className="px-3 py-2">
                        <input
                          {...register(`items.${index}.product_name`)}
                          placeholder="Tên sản phẩm"
                          className={cn(
                            'w-full h-8 px-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500',
                            errors.items?.[index]?.product_name
                              ? 'border-red-400'
                              : 'border-slate-200'
                          )}
                        />
                        {errors.items?.[index]?.product_name && (
                          <p className="text-[10px] text-red-500 mt-0.5">
                            {errors.items[index]?.product_name?.message}
                          </p>
                        )}
                      </td>

                      {/* Specification */}
                      <td className="px-3 py-2">
                        <input
                          {...register(`items.${index}.specification`)}
                          placeholder="Quy cách"
                          className="w-full h-8 px-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </td>

                      {/* Quantity */}
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          {...register(`items.${index}.quantity`)}
                          className={cn(
                            'w-full h-8 px-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-right',
                            errors.items?.[index]?.quantity
                              ? 'border-red-400'
                              : 'border-slate-200'
                          )}
                        />
                      </td>

                      {/* Unit */}
                      <td className="px-3 py-2">
                        <input
                          {...register(`items.${index}.unit`)}
                          placeholder="cái"
                          className={cn(
                            'w-full h-8 px-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500',
                            errors.items?.[index]?.unit
                              ? 'border-red-400'
                              : 'border-slate-200'
                          )}
                        />
                      </td>

                      {/* Unit Price */}
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          {...register(`items.${index}.unit_price`)}
                          placeholder="0"
                          className="w-full h-8 px-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-right"
                        />
                      </td>

                      {/* Subtotal */}
                      <td className="px-3 py-2 text-right">
                        <span className="text-sm font-mono text-slate-700">
                          {formatCurrency(subtotal, watchedCurrency)}
                        </span>
                      </td>

                      {/* Remove */}
                      <td className="px-3 py-2">
                        {fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => remove(index)}
                            className="p-1 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                            title="Xóa dòng"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div className="flex justify-end mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-6">
              <span className="text-sm font-medium text-slate-600">
                Tổng cộng:
              </span>
              <span className="text-lg font-bold font-mono text-indigo-700">
                {formatCurrency(total, watchedCurrency)}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pb-6">
          <Link href="/purchase-orders">
            <Button type="button" variant="outline">
              Hủy bỏ
            </Button>
          </Link>
          <Button
            type="submit"
            loading={isSubmitting}
            className="gap-2"
          >
            <ShoppingCart className="h-4 w-4" />
            Tạo đơn hàng
          </Button>
        </div>
      </form>
    </div>
  );
}
