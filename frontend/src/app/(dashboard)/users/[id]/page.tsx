'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  User,
  Mail,
  ShieldAlert,
  Save,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ROLE_LABELS } from '@/lib/constants';
import { useAuth } from '@/providers/auth-provider';
import type { UserRole } from '@/types/models';

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

const ROLE_BADGE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  admin: 'danger',
  director: 'warning',
  manager: 'info',
  accountant: 'default',
  warehouse: 'neutral',
  sales: 'success',
  viewer: 'neutral',
};

// ─── Page Component ───────────────────────────────────────────

export default function UserDetailPage() {
  const params = useParams();
  const userId = params.id as string;
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const isAdmin = currentUser?.role === 'admin';

  const [editForm, setEditForm] = useState({
    full_name: '',
    role: '' as UserRole | '',
    is_active: true,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [formInitialized, setFormInitialized] = useState(false);

  const { data: userRaw, isLoading, error } = useQuery({
    queryKey: ['users', userId],
    queryFn: () => api.get<any>(`/api/v1/users/${userId}`),
    retry: 1,
  });

  const userData = userRaw?.data ?? userRaw ?? null;

  // Initialize edit form once data loads
  if (userData && !formInitialized) {
    setEditForm({
      full_name: userData.full_name ?? '',
      role: userData.role ?? '',
      is_active: userData.is_active ?? true,
    });
    setFormInitialized(true);
  }

  const updateMutation = useMutation({
    mutationFn: (data: { full_name: string; role: UserRole | ''; is_active: boolean }) =>
      api.put(`/api/v1/users/${userId}`, data),
    onSuccess: () => {
      toast.success('Cập nhật người dùng thành công!');
      queryClient.invalidateQueries({ queryKey: ['users', userId] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setIsEditing(false);
    },
    onError: () => toast.error('Không thể cập nhật người dùng'),
  });

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 mb-4">
          <ShieldAlert className="h-8 w-8 text-red-400" />
        </div>
        <h3 className="text-lg font-display font-semibold text-slate-900">
          Truy cập bị từ chối
        </h3>
        <p className="mt-1 text-sm text-slate-500 max-w-sm text-center">
          Bạn không có quyền truy cập trang này.
        </p>
        <Link href="/users" className="mt-4">
          <Button variant="outline" size="sm">
            Quay lại danh sách
          </Button>
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error || !userData) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <User className="h-16 w-16 text-slate-300 mb-4" />
        <h3 className="text-lg font-semibold text-slate-700 mb-2">
          Không tìm thấy người dùng
        </h3>
        <Link href="/users" className="mt-4">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Quay lại danh sách
          </Button>
        </Link>
      </div>
    );
  }

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
        <div className="flex-1">
          <h2 className="text-xl font-display font-bold text-slate-900">
            {userData.full_name ?? userData.email}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5 font-mono">
            {userData.email}
          </p>
        </div>
        <StatusBadge
          label={userData.is_active ? 'Hoạt động' : 'Khóa'}
          variant={userData.is_active ? 'success' : 'danger'}
        />
      </div>

      {/* Info Card */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700">
            Thông tin tài khoản
          </h3>
          {!isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
            >
              Chỉnh sửa
            </Button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-4">
            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Họ tên
              </label>
              <input
                type="text"
                value={editForm.full_name}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, full_name: e.target.value }))
                }
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            {/* Role */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Vai trò
              </label>
              <select
                value={editForm.role}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, role: e.target.value as UserRole }))
                }
                className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              >
                <option value="">-- Chọn vai trò --</option>
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-slate-700">
                Trạng thái
              </label>
              <button
                type="button"
                onClick={() =>
                  setEditForm((prev) => ({ ...prev, is_active: !prev.is_active }))
                }
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  editForm.is_active ? 'bg-brand-600' : 'bg-slate-200'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    editForm.is_active ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
              <span className="text-sm text-slate-600">
                {editForm.is_active ? 'Hoạt động' : 'Khóa'}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={() => updateMutation.mutate(editForm)}
                loading={updateMutation.isPending}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                Lưu thay đổi
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditing(false);
                  setEditForm({
                    full_name: userData.full_name ?? '',
                    role: userData.role ?? '',
                    is_active: userData.is_active ?? true,
                  });
                }}
              >
                Hủy
              </Button>
            </div>
          </div>
        ) : (
          <dl className="space-y-3">
            <InfoRow label="Email">
              <div className="flex items-center gap-1.5 text-sm text-slate-700">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-mono">{userData.email}</span>
              </div>
            </InfoRow>
            <InfoRow label="Họ tên">
              <span className="text-sm font-medium text-slate-900">
                {userData.full_name ?? '—'}
              </span>
            </InfoRow>
            <InfoRow label="Vai trò">
              <Badge variant={ROLE_BADGE_VARIANT[userData.role] || 'neutral'}>
                {ROLE_LABELS[userData.role as UserRole] || userData.role}
              </Badge>
            </InfoRow>
            <InfoRow label="Phòng ban">
              <span className="text-sm text-slate-700">
                {userData.department ?? '—'}
              </span>
            </InfoRow>
            <InfoRow label="Trạng thái">
              <StatusBadge
                label={userData.is_active ? 'Hoạt động' : 'Khóa'}
                variant={userData.is_active ? 'success' : 'danger'}
              />
            </InfoRow>
            <InfoRow label="Đăng nhập cuối">
              <span className="text-sm text-slate-600">
                {userData.last_login_at
                  ? formatRelativeTime(userData.last_login_at)
                  : '—'}
              </span>
            </InfoRow>
            <InfoRow label="Ngày tạo">
              <span className="text-sm text-slate-600">
                {formatDate(userData.created_at)}
              </span>
            </InfoRow>
          </dl>
        )}
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center py-1">
      <dt className="text-xs text-slate-400 flex-shrink-0">{label}</dt>
      <dd className="ml-4 flex justify-end">{children}</dd>
    </div>
  );
}
