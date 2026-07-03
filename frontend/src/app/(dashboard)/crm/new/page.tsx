'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronLeft, Contact, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageShellHeader, SHELL, ELEVATION, TYPE } from '@/components/cockpit';

// ─── Schema ───────────────────────────────────────────────────

const createCustomerSchema = z
  .object({
    company_name: z.string().min(1, 'Vui lòng nhập tên công ty'),
    short_name: z.string().optional(),
    customer_code: z.string().min(1, 'Vui lòng nhập mã khách hàng'),
    tax_code: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email('Email không hợp lệ').optional().or(z.literal('')),
    customer_type: z.string().min(1, 'Vui lòng chọn loại khách hàng'),
    business_system: z.string().optional(),
    // Extended intake
    contact_name: z.string().min(1, 'Vui lòng nhập người liên hệ'),
    contact_role: z.string().optional(),
    industry: z.string().min(1, 'Vui lòng chọn ngành nghề'),
    company_size: z.string().optional(),
    lead_source: z.string().optional(),
    preferred_channel: z.string().optional(),
    website: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine((d) => !!(d.phone || d.email), {
    message: 'Phải nhập ít nhất 1 trong 2: Email hoặc Số điện thoại',
    path: ['phone'],
  });

type CreateCustomerFormData = z.infer<typeof createCustomerSchema>;

type DuplicateMatch = {
  id: number;
  customer_code: string;
  company_name: string;
  tax_code: string | null;
  industry: string | null;
  lead_source: string | null;
};

// ─── Options ─────────────────────────────────────────────────

const CUSTOMER_TYPE_OPTIONS = [
  { value: 'enterprise', label: 'Doanh nghiệp' },
  { value: 'government', label: 'Cơ quan nhà nước' },
  { value: 'individual', label: 'Cá nhân' },
  { value: 'distributor', label: 'Đại lý phân phối' },
  { value: 'other', label: 'Khác' },
];

const BUSINESS_SYSTEM_OPTIONS = [
  { value: 'bqms', label: 'BQMS (Samsung SEV/SEVT)' },
  { value: 'imv', label: 'iMarket Vietnam (IMV)' },
];

const INDUSTRY_OPTIONS = [
  { value: 'electronics', label: 'Điện tử' },
  { value: 'mechanical', label: 'Cơ khí' },
  { value: 'plastic', label: 'Nhựa' },
  { value: 'metal', label: 'Kim loại / Luyện kim' },
  { value: 'packaging', label: 'Bao bì' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'trading', label: 'Thương mại tổng hợp' },
  { value: 'other', label: 'Khác' },
];

const COMPANY_SIZE_OPTIONS = [
  { value: 'micro', label: 'Dưới 10 người' },
  { value: 'small', label: '10-50 người' },
  { value: 'medium', label: '50-200 người' },
  { value: 'large', label: '200-1000 người' },
  { value: 'enterprise', label: 'Trên 1000 người' },
];

const LEAD_SOURCE_OPTIONS = [
  { value: 'samsung_referral', label: 'Samsung giới thiệu' },
  { value: 'trade_show', label: 'Hội chợ / triển lãm' },
  { value: 'web', label: 'Website / tìm kiếm' },
  { value: 'cold_call', label: 'Cold call / email' },
  { value: 'existing_referral', label: 'KH hiện tại giới thiệu' },
  { value: 'other', label: 'Khác' },
];

const CHANNEL_OPTIONS = [
  { value: 'zalo', label: 'Zalo' },
  { value: 'email', label: 'Email' },
  { value: 'call', label: 'Gọi điện' },
  { value: 'meeting', label: 'Gặp mặt' },
];

const CONTACT_ROLE_OPTIONS = [
  'Mua hàng', 'Kỹ thuật', 'Giám đốc', 'Kế toán', 'Kho', 'Khác',
];

// ─── Page Component ───────────────────────────────────────────

export default function NewCustomerPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [duplicateAck, setDuplicateAck] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
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
      contact_name: '',
      contact_role: '',
      industry: '',
      company_size: '',
      lead_source: '',
      preferred_channel: '',
      website: '',
      notes: '',
    },
  });

  const runDuplicateCheck = async () => {
    const v = getValues();
    if (!v.tax_code && !v.email && !v.phone && !v.company_name) {
      setDuplicates([]);
      return;
    }
    try {
      const res = await api.post<{ matches: DuplicateMatch[] }>(
        '/api/v1/crm/customers/check-duplicate',
        {
          tax_code: v.tax_code || null,
          email: v.email || null,
          phone: v.phone || null,
          company_name: v.company_name || null,
        },
      );
      setDuplicates(res.matches || []);
      if ((res.matches?.length || 0) > 0) setDuplicateAck(false);
    } catch {}
  };

  const onSubmit = async (data: CreateCustomerFormData) => {
    if (duplicates.length > 0 && !duplicateAck) {
      toast.error('Có khách hàng trùng — vui lòng xác nhận hoặc mở hồ sơ cũ');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/api/v1/crm/customers', {
        ...data,
        email: data.email || undefined,
        short_name: data.short_name || undefined,
        tax_code: data.tax_code || undefined,
        address: data.address || undefined,
        phone: data.phone || undefined,
        business_system: data.business_system || undefined,
        contact_role: data.contact_role || undefined,
        company_size: data.company_size || undefined,
        lead_source: data.lead_source || undefined,
        preferred_channel: data.preferred_channel || undefined,
        website: data.website || undefined,
        notes: data.notes || undefined,
      });
      toast.success('Tạo khách hàng thành công! Đã tạo card trong CRM pipeline.');
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

  const inputClass = (hasError?: boolean) =>
    cn(
      'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent',
      hasError ? 'border-rose-400' : 'border-slate-200',
    );

  return (
    <div className={cn(SHELL.page, '-m-6')}>
      <PageShellHeader
        title="Thêm khách hàng mới"
        eyebrow="CRM"
        leading={
          <Link href="/crm" aria-label="Quay lại"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 ring-1 ring-slate-200 bg-white hover:bg-slate-50 hover:text-slate-700 transition-colors">
            <ChevronLeft className="h-4.5 w-4.5" />
          </Link>
        }
      />

      <div className={cn(SHELL.content, 'pt-4')}>
      <div className="mx-auto max-w-3xl">
      <p className="text-[13px] text-slate-500 mb-4">Nhập đủ thông tin để tự động tạo lead trong CRM pipeline</p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Duplicate warning */}
        {duplicates.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-medium text-amber-900">Khách hàng có thể đã tồn tại</h4>
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  {duplicates.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-mono font-semibold">{d.customer_code}</span> · {d.company_name}
                        {d.tax_code && <span className="text-amber-600 ml-2">MST: {d.tax_code}</span>}
                      </span>
                      <Link href={`/crm/${d.id}`} className="text-xs text-amber-700 underline hover:no-underline">
                        Mở hồ sơ
                      </Link>
                    </li>
                  ))}
                </ul>
                <label className="inline-flex items-center gap-2 mt-3 text-sm">
                  <input
                    type="checkbox"
                    checked={duplicateAck}
                    onChange={(e) => setDuplicateAck(e.target.checked)}
                    className="rounded border-amber-400"
                  />
                  <span className="text-amber-900">Tôi xác nhận đây là KH KHÁC, vẫn tạo mới</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Company Info */}
        <div className={cn(ELEVATION.container, 'rounded-lg p-6')}>
          <h3 className={cn(TYPE.h2, 'mb-4')}>Thông tin công ty</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label required>Tên công ty</Label>
              <input {...register('company_name')} placeholder="Tên đầy đủ" className={inputClass(!!errors.company_name)} onBlur={runDuplicateCheck} />
              <ErrMsg e={errors.company_name} />
            </div>

            <div>
              <Label>Tên viết tắt</Label>
              <input {...register('short_name')} placeholder="VD: ABC Corp" className={inputClass()} />
            </div>

            <div>
              <Label required>Mã khách hàng</Label>
              <input {...register('customer_code')} placeholder="VD: KH-001" className={inputClass(!!errors.customer_code)} />
              <ErrMsg e={errors.customer_code} />
            </div>

            <div>
              <Label>Mã số thuế</Label>
              <input {...register('tax_code')} placeholder="10 hoặc 13 chữ số" className={inputClass()} onBlur={runDuplicateCheck} />
            </div>

            <div>
              <Label required>Loại khách hàng</Label>
              <select {...register('customer_type')} className={inputClass(!!errors.customer_type)}>
                <option value="">-- Chọn --</option>
                {CUSTOMER_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ErrMsg e={errors.customer_type} />
            </div>

            <div>
              <Label required>Ngành nghề</Label>
              <select {...register('industry')} className={inputClass(!!errors.industry)}>
                <option value="">-- Chọn --</option>
                {INDUSTRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ErrMsg e={errors.industry} />
            </div>

            <div>
              <Label>Quy mô công ty</Label>
              <select {...register('company_size')} className={inputClass()}>
                <option value="">-- Chọn --</option>
                {COMPANY_SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <Label>Hệ thống KD</Label>
              <select {...register('business_system')} className={inputClass()}>
                <option value="">-- Chọn --</option>
                {BUSINESS_SYSTEM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="md:col-span-2">
              <Label>Địa chỉ</Label>
              <input {...register('address')} placeholder="Địa chỉ đầy đủ" className={inputClass()} />
            </div>

            <div className="md:col-span-2">
              <Label>Website</Label>
              <input {...register('website')} placeholder="https://..." className={inputClass()} />
            </div>
          </div>
        </div>

        {/* Contact Info */}
        <div className={cn(ELEVATION.container, 'rounded-lg p-6')}>
          <h3 className={cn(TYPE.h2, 'mb-4')}>Người liên hệ</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label required>Họ tên</Label>
              <input {...register('contact_name')} placeholder="VD: Nguyễn Văn A" className={inputClass(!!errors.contact_name)} />
              <ErrMsg e={errors.contact_name} />
            </div>

            <div>
              <Label>Chức vụ / Phòng ban</Label>
              <select {...register('contact_role')} className={inputClass()}>
                <option value="">-- Chọn --</option>
                {CONTACT_ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div>
              <Label>Số điện thoại</Label>
              <input type="tel" {...register('phone')} placeholder="0901234567 hoặc +84..." className={inputClass(!!errors.phone)} onBlur={runDuplicateCheck} />
              <ErrMsg e={errors.phone} />
            </div>

            <div>
              <Label>Email</Label>
              <input type="email" {...register('email')} placeholder="email@company.com" className={inputClass(!!errors.email)} onBlur={runDuplicateCheck} />
              <ErrMsg e={errors.email} />
            </div>

            <div>
              <Label>Kênh ưu tiên</Label>
              <select {...register('preferred_channel')} className={inputClass()}>
                <option value="">-- Chọn --</option>
                {CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <Label>Nguồn lead</Label>
              <select {...register('lead_source')} className={inputClass()}>
                <option value="">-- Chọn --</option>
                {LEAD_SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className={cn(ELEVATION.container, 'rounded-lg p-6')}>
          <h3 className={cn(TYPE.h2, 'mb-4')}>Ghi chú</h3>
          <textarea {...register('notes')} rows={3} placeholder="Context về khách hàng, yêu cầu đặc biệt..." className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pb-6">
          <Link href="/crm"><Button type="button" variant="outline">Hủy bỏ</Button></Link>
          <Button type="submit" loading={isSubmitting} className="gap-2">
            <Contact className="h-4 w-4" />
            Tạo khách hàng + Lead
          </Button>
        </div>
      </form>
      </div>
      </div>
    </div>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-slate-700 mb-1">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function ErrMsg({ e }: { e: any }) {
  if (!e) return null;
  return <p className="text-xs text-red-500 mt-1">{e.message}</p>;
}
