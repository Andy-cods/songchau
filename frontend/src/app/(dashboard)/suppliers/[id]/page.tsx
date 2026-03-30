'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  Globe,
  CreditCard,
  Star,
  Edit2,
  Check,
  X,
  History,
} from 'lucide-react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Supplier } from '@/types/models';

// ─── Types ───────────────────────────────────────────────────────

interface PriceHistoryEntry {
  id: string;
  product_name: string;
  specification?: string;
  unit: string;
  unit_price: number;
  currency: 'VND' | 'USD' | 'RMB';
  effective_date: string;
  notes?: string;
}

// ─── Edit Schema ─────────────────────────────────────────────────

const editSchema = z.object({
  name: z.string().min(1, 'Nhập tên nhà cung cấp'),
  contact_person: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Email không hợp lệ').optional().or(z.literal('')),
  address: z.string().optional(),
  country: z.string().optional(),
  payment_terms: z.string().optional(),
});

type EditFormData = z.infer<typeof editSchema>;

// ─── Star Rating ─────────────────────────────────────────────────

function StarRating({ rating }: { rating?: number | null }) {
  if (rating == null) return <span className="text-slate-400 text-sm">—</span>;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            'h-4 w-4',
            star <= rating
              ? 'text-amber-400 fill-amber-400'
              : 'text-slate-200 fill-slate-200'
          )}
        />
      ))}
      <span className="ml-1.5 text-sm text-slate-600">{rating}/5</span>
    </div>
  );
}

// ─── Info Row ─────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
      <Icon className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-400 mb-0.5">{label}</p>
        <p className="text-sm text-slate-800 break-words">{value || '—'}</p>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id as string;

  const [isEditing, setIsEditing] = useState(false);

  const { data: supplier, isLoading } = useQuery<Supplier>({
    queryKey: ['supplier', id],
    queryFn: () => api.get(`/api/v1/suppliers/${id}`),
    retry: false,
  });

  const { data: priceHistory, isLoading: priceLoading } = useQuery<
    PriceHistoryEntry[]
  >({
    queryKey: ['supplier-price-history', id],
    queryFn: () => api.get(`/api/v1/suppliers/${id}/price-history`),
    retry: false,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
    values: supplier
      ? {
          name: supplier.name,
          contact_person: supplier.contact_person ?? '',
          phone: supplier.phone ?? '',
          email: supplier.email ?? '',
          address: supplier.address ?? '',
          country: supplier.country ?? '',
          payment_terms: supplier.payment_terms ?? '',
        }
      : undefined,
  });

  const editMutation = useMutation({
    mutationFn: (data: EditFormData) =>
      api.put(`/api/v1/suppliers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      toast.success('Cập nhật nhà cung cấp thành công');
      setIsEditing(false);
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'detail' in err
          ? (err as { detail: string }).detail
          : 'Có lỗi xảy ra';
      toast.error(msg);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <Building2 className="h-12 w-12 mb-3" />
        <p className="text-sm font-medium">Không tìm thấy nhà cung cấp</p>
        <Link href="/suppliers" className="mt-4">
          <Button variant="outline" size="sm">
            Quay lại danh sách
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/suppliers"
            className="p-2 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-xl font-display font-bold text-slate-900">
              {supplier.name}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5 font-mono">
              {supplier.code}
            </p>
          </div>
        </div>

        {!isEditing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="gap-1.5"
          >
            <Edit2 className="h-3.5 w-3.5" />
            Chỉnh sửa
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsEditing(false);
                reset();
              }}
              className="gap-1.5 text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
              Hủy
            </Button>
            <Button
              size="sm"
              loading={editMutation.isPending}
              onClick={handleSubmit((data) => editMutation.mutate(data))}
              className="gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Lưu
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info Card */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Thông tin nhà cung cấp
            </h3>

            {/* Status badge */}
            <div className="mb-4">
              <span
                className={cn(
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                  supplier.is_active
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-500 border border-slate-200'
                )}
              >
                {supplier.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động'}
              </span>
            </div>

            {isEditing ? (
              <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
                {[
                  { name: 'name', label: 'Tên NCC *', placeholder: 'Tên nhà cung cấp' },
                  { name: 'contact_person', label: 'Người liên hệ', placeholder: 'Họ và tên' },
                  { name: 'phone', label: 'Điện thoại', placeholder: '+84...' },
                  { name: 'email', label: 'Email', placeholder: 'email@example.com' },
                  { name: 'address', label: 'Địa chỉ', placeholder: 'Địa chỉ' },
                  { name: 'country', label: 'Quốc gia', placeholder: 'VN, CN...' },
                  { name: 'payment_terms', label: 'Điều khoản TT', placeholder: 'TT30, COD...' },
                ].map(({ name, label, placeholder }) => (
                  <div key={name}>
                    <label className="block text-xs text-slate-500 mb-1">{label}</label>
                    <input
                      {...register(name as keyof EditFormData)}
                      placeholder={placeholder}
                      className={cn(
                        'w-full h-8 px-2 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500',
                        errors[name as keyof EditFormData]
                          ? 'border-red-400'
                          : 'border-slate-300'
                      )}
                    />
                    {errors[name as keyof EditFormData] && (
                      <p className="text-[10px] text-red-500 mt-0.5">
                        {errors[name as keyof EditFormData]?.message as string}
                      </p>
                    )}
                  </div>
                ))}
              </form>
            ) : (
              <div>
                <InfoRow icon={Building2} label="Tên nhà cung cấp" value={supplier.name} />
                <InfoRow icon={Phone} label="Điện thoại" value={supplier.phone} />
                <InfoRow icon={Mail} label="Email" value={supplier.email} />
                <InfoRow
                  icon={Globe}
                  label="Quốc gia"
                  value={supplier.country}
                />
                <InfoRow
                  icon={CreditCard}
                  label="Điều khoản thanh toán"
                  value={supplier.payment_terms}
                />
                <div className="flex items-start gap-3 py-3">
                  <Star className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-slate-400 mb-1">Đánh giá</p>
                    <StarRating rating={supplier.rating} />
                  </div>
                </div>
                {supplier.contact_person && (
                  <InfoRow
                    icon={Building2}
                    label="Người liên hệ"
                    value={supplier.contact_person}
                  />
                )}
                {supplier.address && (
                  <InfoRow
                    icon={Globe}
                    label="Địa chỉ"
                    value={supplier.address}
                  />
                )}
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-400 space-y-1">
              <p>Tạo lúc: {formatDate(supplier.created_at)}</p>
              <p>Cập nhật: {formatDate(supplier.updated_at)}</p>
            </div>
          </div>
        </div>

        {/* Price History */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="flex items-center gap-2 p-4 border-b border-slate-100">
              <History className="h-4 w-4 text-indigo-500" />
              <h3 className="text-sm font-semibold text-slate-700">
                Lịch sử giá
              </h3>
            </div>

            {priceLoading ? (
              <div className="p-4 space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex gap-4 items-center">
                    <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
                    <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
                    <div className="h-4 w-24 bg-slate-200 rounded animate-pulse ml-auto" />
                  </div>
                ))}
              </div>
            ) : !priceHistory || priceHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-slate-300">
                <History className="h-10 w-10 mb-3" />
                <p className="text-sm text-slate-400">Chưa có lịch sử giá</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      {[
                        'Sản phẩm',
                        'Quy cách',
                        'Đơn vị',
                        'Đơn giá',
                        'Ngày áp dụng',
                        'Ghi chú',
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-slate-400"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {priceHistory.map((entry) => (
                      <tr
                        key={entry.id}
                        className="hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm text-slate-800 font-medium">
                          {entry.product_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {entry.specification || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {entry.unit}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-slate-800">
                          {formatCurrency(entry.unit_price, entry.currency)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {formatDate(entry.effective_date)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500 max-w-[180px] truncate">
                          {entry.notes || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
