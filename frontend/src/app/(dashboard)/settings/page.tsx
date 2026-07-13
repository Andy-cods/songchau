'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  User,
  Lock,
  Info,
  CheckCircle2,
  AlertCircle,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/providers/auth-provider';
import { ROLE_LABELS } from '@/lib/constants';
import type { User as UserModel } from '@/types/models';
import ScraperSettingsCard from '@/components/bqms/ScraperSettingsCard';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/shared/user-avatar';
import { useMyAvatarPet } from '@/components/pet/use-my-avatar-pet';

// ─── Types ───────────────────────────────────────────────────────

interface SystemInfo {
  version: string;
  db_tables_count: number;
  uptime_seconds: number;
  environment: string;
}

// ─── Schemas ─────────────────────────────────────────────────────

const profileSchema = z.object({
  full_name: z.string().min(2, 'Nhập ít nhất 2 ký tự'),
  display_name: z.string().optional(),
  phone: z.string().optional(),
  department: z.string().optional(),
});

const passwordSchema = z
  .object({
    current_password: z.string().min(1, 'Nhập mật khẩu hiện tại'),
    new_password: z.string().min(8, 'Mật khẩu mới tối thiểu 8 ký tự'),
    confirm_password: z.string().min(1, 'Xác nhận mật khẩu mới'),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirm_password'],
  });

type ProfileForm = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

// ─── Helpers ─────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} ngày`);
  if (h > 0) parts.push(`${h} giờ`);
  if (m > 0) parts.push(`${m} phút`);
  return parts.length > 0 ? parts.join(' ') : 'vừa khởi động';
}

// ─── Sub-components ───────────────────────────────────────────────

function SectionTitle({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="p-2 bg-brand-50 rounded-lg mt-0.5">
        <Icon className="h-4 w-4 text-brand-600" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {description && (
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
    </div>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────

export default function SettingsPage() {
  const { user: authUser } = useAuth();
  const avatarPet = useMyAvatarPet(); // pet đang làm avatar (null nếu chưa đặt)
  const [profileSaved, setProfileSaved] = useState(false);

  // Fetch full profile
  const { data: me, isLoading: meLoading } = useQuery<UserModel>({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get('/api/v1/auth/me'),
    retry: false,
  });

  // Fetch system info (admin only) — dữ liệu THẬT từ 2 endpoint:
  //   /api/health                      → version + uptime_seconds + environment (APP_ENV)
  //   /api/v1/system-health/dashboard  → data.database.tables (số bảng thật, ~182)
  // Trước đây trả cứng {version:'1.0.0', db_tables_count:64, uptime:0, env:NODE_ENV}
  // ở CẢ try lẫn catch → số giả (64 bảng sai, uptime luôn 0, env build-time).
  const { data: sysInfo } = useQuery<SystemInfo>({
    queryKey: ['system', 'info'],
    queryFn: async () => {
      const health = (await api.get('/api/health')) as {
        version: string;
        uptime_seconds: number;
        environment?: string;
      };
      let tables = 0;
      try {
        // /dashboard nặng (quét nhiều bảng) — best-effort: nếu lỗi vẫn hiện version/uptime.
        const dash = (await api.get('/api/v1/system-health/dashboard')) as {
          data?: { database?: { tables?: number } };
        };
        tables = dash?.data?.database?.tables ?? 0;
      } catch {
        /* giữ tables=0 */
      }
      return {
        version: health.version,
        db_tables_count: tables,
        uptime_seconds: health.uptime_seconds,
        environment: health.environment ?? (process.env.NODE_ENV ?? 'production'),
      };
    },
    enabled: authUser?.role === 'admin',
    retry: false,
  });

  // Profile form
  const {
    register: regProfile,
    handleSubmit: handleProfile,
    formState: { errors: profileErrors },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: me
      ? {
          full_name: me.full_name,
          display_name: me.display_name ?? '',
          phone: me.phone ?? '',
          department: me.department ?? '',
        }
      : undefined,
  });

  // Password form
  const {
    register: regPassword,
    handleSubmit: handlePassword,
    reset: resetPassword,
    formState: { errors: pwErrors },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      current_password: '',
      new_password: '',
      confirm_password: '',
    },
  });

  const profileMutation = useMutation({
    mutationFn: (data: ProfileForm) => api.put('/api/v1/auth/me', data),
    onSuccess: () => {
      toast.success('Cập nhật hồ sơ thành công');
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'detail' in err
          ? (err as { detail: string }).detail
          : 'Có lỗi xảy ra';
      toast.error(msg);
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (data: PasswordForm) =>
      api.post('/api/v1/auth/change-password', data),
    onSuccess: (res: unknown) => {
      // Đổi mật khẩu bump password_version → phiên CŨ bị revoke. BE cấp token
      // pv-mới; lưu lại để lần refresh kế không 401 TOKEN_REVOKED đá caller ra.
      const r = res as { access_token?: string; refresh_token?: string } | undefined;
      if (r?.access_token) localStorage.setItem('access_token', r.access_token);
      if (r?.refresh_token) localStorage.setItem('refresh_token', r.refresh_token);
      toast.success('Đổi mật khẩu thành công');
      resetPassword();
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'detail' in err
          ? (err as { detail: string }).detail
          : 'Mật khẩu hiện tại không đúng';
      toast.error(msg);
    },
  });

  if (meLoading) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Page Header */}
      <PageHeader
        icon={User}
        title="Cài đặt"
        subtitle="Quản lý hồ sơ cá nhân và cài đặt hệ thống"
        className="mb-6"
      />

      <div className="space-y-6">
        {/* Profile Section */}
        <Card padded={false} className="p-6">
          <SectionTitle
            icon={User}
            title="Thông tin cá nhân"
            description="Cập nhật tên hiển thị và thông tin liên lạc"
          />

          {/* Avatar + role row — pet avatar (2026-07-13) nếu user đã đặt,
              fallback chữ cái đầu như cũ */}
          <div className="flex items-center gap-4 mb-6 p-4 bg-slate-50 rounded-lg">
            {avatarPet ? (
              <UserAvatar
                name={me?.display_name || me?.full_name}
                petSpecies={avatarPet.species}
                petForm={avatarPet.form}
                size={56}
              />
            ) : (
              <div className="h-14 w-14 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xl font-bold flex-shrink-0">
                {(me?.display_name || me?.full_name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {me?.display_name || me?.full_name}
              </p>
              <p className="text-xs text-slate-500">{me?.email}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Shield className="h-3 w-3 text-brand-500" />
                <span className="text-xs text-brand-600 font-medium">
                  {me?.role ? ROLE_LABELS[me.role] : '—'}
                </span>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleProfile((data) => profileMutation.mutate(data))}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <FormField label="Họ và tên *" error={profileErrors.full_name?.message}>
              <input
                {...regProfile('full_name')}
                placeholder="Nguyễn Văn A"
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500',
                  profileErrors.full_name ? 'border-red-400' : 'border-slate-300'
                )}
              />
            </FormField>

            <FormField label="Tên hiển thị" error={profileErrors.display_name?.message}>
              <input
                {...regProfile('display_name')}
                placeholder="Tên ngắn"
                className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </FormField>

            <FormField label="Số điện thoại" error={profileErrors.phone?.message}>
              <input
                {...regProfile('phone')}
                placeholder="+84 xxx xxx xxx"
                className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </FormField>

            <FormField label="Phòng ban" error={profileErrors.department?.message}>
              <input
                {...regProfile('department')}
                placeholder="Phòng kinh doanh..."
                className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </FormField>

            <div className="md:col-span-2">
              <FormField label="Email (không thể thay đổi)">
                <input
                  value={me?.email ?? ''}
                  disabled
                  className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed"
                />
              </FormField>
            </div>

            <div className="md:col-span-2 flex items-center gap-3">
              <Button
                type="submit"
                loading={profileMutation.isPending}
              >
                Lưu thay đổi
              </Button>
              {profileSaved && (
                <div className="flex items-center gap-1.5 text-emerald-600 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  Đã lưu
                </div>
              )}
            </div>
          </form>
        </Card>

        {/* Change Password Section */}
        <Card padded={false} className="p-6">
          <SectionTitle
            icon={Lock}
            title="Đổi mật khẩu"
            description="Sử dụng mật khẩu mạnh, ít nhất 8 ký tự"
          />

          <form
            onSubmit={handlePassword((data) => passwordMutation.mutate(data))}
            className="space-y-4 max-w-md"
          >
            <FormField
              label="Mật khẩu hiện tại *"
              error={pwErrors.current_password?.message}
            >
              <input
                type="password"
                {...regPassword('current_password')}
                placeholder="••••••••"
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500',
                  pwErrors.current_password ? 'border-red-400' : 'border-slate-300'
                )}
              />
            </FormField>

            <FormField
              label="Mật khẩu mới *"
              error={pwErrors.new_password?.message}
            >
              <input
                type="password"
                {...regPassword('new_password')}
                placeholder="••••••••"
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500',
                  pwErrors.new_password ? 'border-red-400' : 'border-slate-300'
                )}
              />
            </FormField>

            <FormField
              label="Xác nhận mật khẩu mới *"
              error={pwErrors.confirm_password?.message}
            >
              <input
                type="password"
                {...regPassword('confirm_password')}
                placeholder="••••••••"
                className={cn(
                  'w-full h-9 px-3 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500',
                  pwErrors.confirm_password ? 'border-red-400' : 'border-slate-300'
                )}
              />
            </FormField>

            <Button type="submit" loading={passwordMutation.isPending}>
              Đổi mật khẩu
            </Button>
          </form>
        </Card>

        {/* BQMS Scraper Settings — Admin only */}
        {authUser?.role === 'admin' && <ScraperSettingsCard />}

        {/* System Info — Admin only */}
        {authUser?.role === 'admin' && (
          <Card padded={false} className="p-6">
            <SectionTitle
              icon={Info}
              title="Thông tin hệ thống"
              description="Chỉ quản trị viên mới thấy phần này"
            />

            {sysInfo ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Phiên bản', value: sysInfo.version },
                  {
                    label: 'Số bảng DB',
                    value: `${sysInfo.db_tables_count} bảng`,
                  },
                  {
                    label: 'Thời gian hoạt động',
                    value: formatUptime(sysInfo.uptime_seconds),
                  },
                  {
                    label: 'Môi trường',
                    value: sysInfo.environment,
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-100"
                  >
                    <p className="text-xs text-slate-400 mb-1">{label}</p>
                    <p className="text-sm font-semibold text-slate-800 font-mono">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                variant="error"
                icon={AlertCircle}
                heading="Không thể tải thông tin hệ thống"
                className="py-8"
              />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
