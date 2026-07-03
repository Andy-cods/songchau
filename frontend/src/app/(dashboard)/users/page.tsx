'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { Users, ShieldAlert, Plus } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { getUsers } from '@/services/users';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
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
    <EmptyState
      variant="error"
      icon={ShieldAlert}
      heading="Truy cập bị từ chối"
      description="Bạn không có quyền truy cập trang này. Chỉ quản trị viên mới có thể quản lý người dùng."
      className="py-24"
    />
  );
}

// ─── Page Component ────────────────────────────────────────────

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const router = useRouter();
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
      <PageHeader
        icon={Users}
        title="Người dùng"
        subtitle="Quản lý tài khoản và phân quyền"
        actions={
          <Link href="/users/new">
            <Button>
              <Plus className="h-4 w-4" />
              Thêm người dùng
            </Button>
          </Link>
        }
        className="mb-6"
      />

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
        onRowClick={(row) => router.push(`/users/${row.id}`)}
        emptyState={
          <EmptyState
            icon={Users}
            heading="Chưa có người dùng nào"
            description="Thêm người dùng để bắt đầu quản lý hệ thống"
            actionLabel="Thêm người dùng"
            onAction={() => router.push('/users/new')}
          />
        }
      />
    </div>
  );
}
