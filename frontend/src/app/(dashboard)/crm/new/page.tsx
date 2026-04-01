'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Contact } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ─── Schema ───────────────────────────────────────────────────

const createCustomerSchema = z.object({
  company_name: z.string().min(1, 'Vui lòng nhập tên công ty'),
  short_name: z.string().optional(),
  // customer_code is required by the backend (min_length=1)
  customer_code: z.string().min(1, 'Vui lòng nhập mã khách hàng'),
  tax_code: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Email không hợp lệ').optional().or(z.literal('')),
  customer_type: z.string().min(1, 'Vui lòng chọn loại khách hàng'),
  business_system: z.string().optional(),
});

type CreateCustomerFormData = z.infer<typeof createCustomerSchema>;

// ─── Options ─────────────────────────────────────────────────

const CUSTOMER_TYPE_OPTIONS = [
  { value: 'enterprise', label: 'Doanh nghiệp' },
  { value: 'government', label: 'Cơ quan nhà nước' },
  { value: 'individual', label: 'Cá nhân' },
  { value: 'distributor', label: 'Đại lý phân phối' },
  { value: 'other', label: 'Khác' },
];

// DB enum: business_system — only 'bqms' and 'imv' are valid values
const BUSINESS_SYSTEM_OPTIONS = [
  { value: 'bqms', label: 'BQMS (Samsung SEV/SEVT)' },
  { value: 'imv', label: 'iMarket Vietnam (IMV)' },
];

// ─── Page Component ───────────────────────────────────────────

export default function NewCustomerPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateCustomerFormData>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: {
      company_name: '',
      short_name: '',
      customer_code: '',
      tax_code: '',
      address: '',
      phone: '',
      email: '',
      customer_type: '',
      business_system: '',
    },
  });

  const onSubmit = async (data: CreateCustomerFormData) => {
    setIsSubmitting(true);
    try {
      await api.post('/api/v1/crm/customers', {
        company_name: data.company_name,
        short_name: data.short_name || undefined,
        customer_code: data.customer_code || undefined,
        tax_code: data.tax_code || undefined,
        address: data.address || undefined,
        phone: data.phone || undefined,
        email: data.email || undefined,
        customer_type: data.customer_type,
        business_system: data.business_system || undefined,
      });
      toast.success('Tạo khách hàng thành công!');
      router.push('/crm');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'detail' in err
          ? (err as { detail: string }).detail
          : 'Có lỗi xảy ra khi tạo khách hàng';
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
          href="/crm"
          className="p-2 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            Thêm khách hàng mới
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Nhập thông tin khách hàng
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
            {/* Company Name */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Tên công ty <span className="text-red-500">*</span>
              </label>
              <input
                {...register('company_name')}
                placeholder="Tên đầy đủ công ty"
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  errors.company_name ? 'border-red-400' : 'border-slate-200'
                )}
              />
              {errors.company_name && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.company_name.message}
                </p>
              )}
            </div>

            {/* Short Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Tên viết tắt
              </label>
              <input
                {...register('short_name')}
                placeholder="VD: ABC Corp"
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Customer Code */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Mã khách hàng <span className="text-red-500">*</span>
              </label>
              <input
                {...register('customer_code')}
                placeholder="VD: KH-001"
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  errors.customer_code ? 'border-red-400' : 'border-slate-200'
                )}
              />
              {errors.customer_code && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.customer_code.message}
                </p>
              )}
            </div>

            {/* Tax Code */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Mã số thuế
              </label>
              <input
                {...register('tax_code')}
                placeholder="VD: 0312345678"
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Customer Type */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Loại khách hàng <span className="text-red-500">*</span>
              </label>
              <select
                {...register('customer_type')}
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  errors.customer_type ? 'border-red-400' : 'border-slate-200'
                )}
              >
                <option value="">-- Chọn loại khách hàng --</option>
                {CUSTOMER_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {errors.customer_type && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.customer_type.message}
                </p>
              )}
            </div>

            {/* Business System */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Hệ thống kinh doanh
              </label>
              <select
                {...register('business_system')}
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="">-- Chọn hệ thống --</option>
                {BUSINESS_SYSTEM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Số điện thoại
              </label>
              <input
                type="tel"
                {...register('phone')}
                placeholder="+84 hoặc 0..."
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
                placeholder="email@company.com"
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

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pb-6">
          <Link href="/crm">
            <Button type="button" variant="outline">
              Hủy bỏ
            </Button>
          </Link>
          <Button type="submit" loading={isSubmitting} className="gap-2">
            <Contact className="h-4 w-4" />
            Tạo khách hàng
          </Button>
        </div>
      </form>
    </div>
  );
}
