'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Users, ShieldAlert, Plus } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { getUsers } from '@/services/users';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS } from '@/lib/constants';
import { formatDate, formatRelativeTime } from '@/lib/utils';
import type { User, PaginatedResponse } from '@/types/models';

// ─── Role badge variant mapping ────────────────────────────────

const ROLE_BADGE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  admin: 'danger',
  director: 'warning',
  manager: 'info',
  accountant: 'default',
  warehouse: 'neutral',
  sales: 'success',
  viewer: 'neutral',
};

// ─── Column Definitions ────────────────────────────────────────

const columnHelper = createColumnHelper<User>();

const columns = [
  columnHelper.accessor('email', {
    header: 'Email',
    cell: (info) => (
      <span className="text-sm font-mono text-slate-700">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('full_name', {
    header: 'Họ tên',
    cell: (info) => (
      <span className="text-sm font-medium text-slate-900">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('role', {
    header: 'Vai trò',
    cell: (info) => {
      const role = info.getValue();
      return (
        <Badge variant={ROLE_BADGE_VARIANT[role] || 'neutral'}>
          {ROLE_LABELS[role] || role}
        </Badge>
      );
    },
  }),
  columnHelper.accessor('department', {
    header: 'Phòng ban',
    cell: (info) => (
      <span className="text-sm text-slate-600">
        {info.getValue() || '—'}
      </span>
    ),
  }),
  columnHelper.accessor('is_active', {
    header: 'Trạng thái',
    cell: (info) => (
      <StatusBadge
        label={info.getValue() ? 'Hoạt động' : 'Khóa'}
        variant={info.getValue() ? 'success' : 'danger'}
      />
    ),
  }),
  columnHelper.accessor('updated_at', {
    header: 'Đăng nhập cuối',
    cell: (info) => (
      <span className="text-sm text-slate-500">
        {formatRelativeTime(info.getValue())}
      </span>
    ),
  }),
];

// ─── Access Denied Component ───────────────────────────────────

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
        Bạn không có quyền truy cập trang này. Chỉ quản trị viên mới có thể quản lý người dùng.
      </p>
    </div>
  );
}

// ─── Page Component ────────────────────────────────────────────

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  // Only admin can view this page
  const isAdmin = currentUser?.role === 'admin';

  const { data, isLoading } = useQuery<PaginatedResponse<User>>({
    queryKey: ['users', page, search],
    queryFn: () => getUsers({ page, page_size: 20, search: search || undefined }),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return <AccessDenied />;
  }

  const users = data?.items ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            Người dùng
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý tài khoản và phân quyền
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4" />
          Thêm người dùng
        </Button>
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={users}
        isLoading={isLoading}
        searchPlaceholder="Tìm kiếm theo email, họ tên..."
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        pagination={
          data
            ? {
                page: data.page,
                pageSize: data.page_size,
                total: data.total,
                totalPages: data.total_pages,
              }
            : undefined
        }
        onPageChange={setPage}
        emptyState={
          <EmptyState
            icon={Users}
            heading="Chưa có người dùng nào"
            description="Thêm người dùng để bắt đầu quản lý hệ thống"
            actionLabel="Thêm người dùng"
            onAction={() => {}}
          />
        }
      />
    </div>
  );
}
