'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, UserPlus, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth } from '@/providers/auth-provider';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS } from '@/lib/constants';
import type { UserRole } from '@/types/models';

// ─── Zod Schema ───────────────────────────────────────────────

const createUserSchema = z.object({
  email: z
    .string()
    .min(1, 'Vui lòng nhập email')
    .email('Email không hợp lệ'),
  full_name: z.string().min(1, 'Vui lòng nhập họ tên'),
  display_name: z.string().optional(),
  role: z.enum(
    ['admin', 'director', 'manager', 'accountant', 'warehouse', 'sales', 'viewer'],
    { required_error: 'Vui lòng chọn vai trò' }
  ),
  department: z.string().optional(),
  phone: z.string().optional(),
  password: z
    .string()
    .min(8, 'Mật khẩu phải có ít nhất 8 ký tự')
    .regex(/[A-Z]/, 'Mật khẩu phải có ít nhất 1 chữ hoa')
    .regex(/[0-9]/, 'Mật khẩu phải có ít nhất 1 số'),
});

type CreateUserFormData = z.infer<typeof createUserSchema>;

// ─── Role Options ─────────────────────────────────────────────

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'admin', label: ROLE_LABELS.admin },
  { value: 'director', label: ROLE_LABELS.director },
  { value: 'manager', label: ROLE_LABELS.manager },
  { value: 'accountant', label: ROLE_LABELS.accountant },
  { value: 'warehouse', label: ROLE_LABELS.warehouse },
  { value: 'sales', label: ROLE_LABELS.sales },
  { value: 'viewer', label: ROLE_LABELS.viewer },
];

// ─── Access Denied Component ──────────────────────────────────

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 mb-4">
        <ShieldAlert className="h-8 w-8 text-red-400" />
      </div>
      <h3 className="text-lg font-display font-semibold text-slate-900">
        Truy cập bị từ chối
      </h3>
      <p className="mt-1 text-sm text-slate-500 max-w-sm text-center">
        Bạn không có quyền truy cập trang này. Chỉ quản trị viên mới có thể thêm người dùng.
      </p>
      <Link href="/users" className="mt-4">
        <Button variant="outline" size="sm">
          Quay lại danh sách
        </Button>
      </Link>
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────

export default function NewUserPage() {
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      full_name: '',
      display_name: '',
      role: undefined,
      department: '',
      phone: '',
      password: '',
    },
  });

  if (!isAdmin) {
    return <AccessDenied />;
  }

  const onSubmit = async (data: CreateUserFormData) => {
    setIsSubmitting(true);
    try {
      await api.post('/api/v1/users', {
        email: data.email,
        full_name: data.full_name,
        display_name: data.display_name || undefined,
        role: data.role,
        department: data.department || undefined,
        phone: data.phone || undefined,
        password: data.password,
      });
      toast.success('Tạo người dùng thành công!');
      router.push('/users');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'detail' in err
          ? (err as { detail: string }).detail
          : 'Có lỗi xảy ra khi tạo người dùng';
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
          href="/users"
          className="p-2 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            Thêm người dùng mới
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Tạo tài khoản mới cho hệ thống
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
            {/* Email */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                {...register('email')}
                placeholder="email@songchau.vn"
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

            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Họ tên <span className="text-red-500">*</span>
              </label>
              <input
                {...register('full_name')}
                placeholder="Nguyễn Văn A"
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  errors.full_name ? 'border-red-400' : 'border-slate-200'
                )}
              />
              {errors.full_name && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.full_name.message}
                </p>
              )}
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Tên hiển thị
              </label>
              <input
                {...register('display_name')}
                placeholder="Tên viết tắt hoặc nickname"
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Role */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Vai trò <span className="text-red-500">*</span>
              </label>
              <select
                {...register('role')}
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  errors.role ? 'border-red-400' : 'border-slate-200'
                )}
              >
                <option value="">-- Chọn vai trò --</option>
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {errors.role && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.role.message}
                </p>
              )}
            </div>

            {/* Department */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Phòng ban
              </label>
              <input
                {...register('department')}
                placeholder="VD: Kinh doanh, Kế toán..."
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Số điện thoại
              </label>
              <input
                type="tel"
                {...register('phone')}
                placeholder="+84..."
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Mật khẩu <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                {...register('password')}
                placeholder="Tối thiểu 8 ký tự"
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  errors.password ? 'border-red-400' : 'border-slate-200'
                )}
              />
              {errors.password && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.password.message}
                </p>
              )}
              <p className="text-xs text-slate-400 mt-1">
                Ít nhất 8 ký tự, bao gồm 1 chữ hoa và 1 số
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pb-6">
          <Link href="/users">
            <Button type="button" variant="outline">
              Hủy bỏ
            </Button>
          </Link>
          <Button type="submit" loading={isSubmitting} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Tạo người dùng
          </Button>
        </div>
      </form>
    </div>
  );
}
