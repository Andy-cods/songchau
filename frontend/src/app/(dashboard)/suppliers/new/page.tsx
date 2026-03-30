'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Building2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ─── Zod Schema ───────────────────────────────────────────────

const createSupplierSchema = z.object({
  name: z.string().min(1, 'Vui lòng nhập tên nhà cung cấp'),
  contact_person: z.string().optional(),
  email: z
    .string()
    .email('Email không hợp lệ')
    .optional()
    .or(z.literal('')),
  phone: z.string().optional(),
  wechat: z.string().optional(),
  country: z.string().min(1, 'Vui lòng nhập quốc gia'),
  address: z.string().optional(),
  payment_terms: z.string().optional(),
  lead_time: z.string().optional(),
  notes: z.string().optional(),
});

type CreateSupplierFormData = z.infer<typeof createSupplierSchema>;

// ─── Country Options ──────────────────────────────────────────

const COUNTRY_OPTIONS = [
  'Việt Nam',
  'Trung Quốc',
  'Nhật Bản',
  'Hàn Quốc',
  'Đài Loan',
  'Đức',
  'Mỹ',
  'Khác',
];

// ─── Page Component ───────────────────────────────────────────

export default function NewSupplierPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateSupplierFormData>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: {
      name: '',
      contact_person: '',
      email: '',
      phone: '',
      wechat: '',
      country: '',
      address: '',
      payment_terms: '',
      lead_time: '',
      notes: '',
    },
  });

  const onSubmit = async (data: CreateSupplierFormData) => {
    setIsSubmitting(true);
    try {
      await api.post('/api/v1/suppliers', {
        name: data.name,
        contact_person: data.contact_person || undefined,
        email: data.email || undefined,
        phone: data.phone || undefined,
        wechat: data.wechat || undefined,
        country: data.country,
        address: data.address || undefined,
        payment_terms: data.payment_terms || undefined,
        lead_time: data.lead_time || undefined,
        notes: data.notes || undefined,
        is_active: true,
      });
      toast.success('Tạo nhà cung cấp thành công!');
      router.push('/suppliers');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'detail' in err
          ? (err as { detail: string }).detail
          : 'Có lỗi xảy ra khi tạo nhà cung cấp';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/suppliers"
          className="p-2 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            Thêm nhà cung cấp mới
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Nhập thông tin nhà cung cấp
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Info Card */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            Thông tin cơ bản
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Tên NCC <span className="text-red-500">*</span>
              </label>
              <input
                {...register('name')}
                placeholder="Tên công ty nhà cung cấp"
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  errors.name ? 'border-red-400' : 'border-slate-200'
                )}
              />
              {errors.name && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.name.message}
                </p>
              )}
            </div>

            {/* Contact Person */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Liên hệ
              </label>
              <input
                {...register('contact_person')}
                placeholder="Họ tên người liên hệ"
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                {...register('email')}
                placeholder="email@supplier.com"
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  errors.email ? 'border-red-400' : 'border-slate-200'
                )}
              />
              {errors.email && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Số điện thoại
              </label>
              <input
                type="tel"
                {...register('phone')}
                placeholder="+84 hoặc +86..."
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* WeChat */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                WeChat
              </label>
              <input
                {...register('wechat')}
                placeholder="WeChat ID"
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Country */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Quốc gia <span className="text-red-500">*</span>
              </label>
              <select
                {...register('country')}
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  errors.country ? 'border-red-400' : 'border-slate-200'
                )}
              >
                <option value="">-- Chọn quốc gia --</option>
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {errors.country && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.country.message}
                </p>
              )}
            </div>

            {/* Address */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Địa chỉ
              </label>
              <input
                {...register('address')}
                placeholder="Địa chỉ đầy đủ"
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Business Info Card */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            Thông tin kinh doanh
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Payment Terms */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Điều khoản thanh toán
              </label>
              <input
                {...register('payment_terms')}
                placeholder="VD: Net 30, TT trước, COD..."
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Lead Time */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Lead time
              </label>
              <input
                {...register('lead_time')}
                placeholder="VD: 7-14 ngày, 30 ngày..."
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
                placeholder="Thông tin bổ sung về nhà cung cấp..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pb-6">
          <Link href="/suppliers">
            <Button type="button" variant="outline">
              Hủy bỏ
            </Button>
          </Link>
          <Button type="submit" loading={isSubmitting} className="gap-2">
            <Building2 className="h-4 w-4" />
            Tạo nhà cung cấp
          </Button>
        </div>
      </form>
    </div>
  );
}
