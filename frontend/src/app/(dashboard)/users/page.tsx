'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { Users, ShieldAlert, Plus } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { getUsers, type User } from '@/services/users';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { UserAvatar } from '@/components/shared/user-avatar';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/utils';

// ─── Role badge variant mapping ────────────────────────────────

const ROLE_BADGE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  admin: 'danger',
  director: 'warning',
  manager: 'info',
  accountant: 'default',
  warehouse: 'neutral',
  sales: 'success',
  viewer: 'neutral',
  procurement: 'info',
  staff: 'neutral',
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
    // Pet avatar (2026-07-13): hiện avatar thú cưng (nếu nhân viên đã đặt)
    // cạnh họ tên — pet_species/pet_form từ BE, fallback initials.
    cell: (info) => {
      const u = info.row.original;
      return (
        <div className="flex items-center gap-2.5">
          <UserAvatar
            name={u.display_name || u.full_name}
            petSpecies={u.pet_species}
            petForm={u.pet_form}
            size={28}
          />
          <span className="text-sm font-medium text-slate-900">
            {info.getValue()}
          </span>
        </div>
      );
    },
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
  // Thang audit #5: đọc last_login_at (cột thật BE trả) — trước đây đọc
  // updated_at (cột không liên quan tới đăng nhập, luôn hiển thị sai).
  columnHelper.accessor('last_login_at', {
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
  const [search, setSearch] = useState('');

  // Only admin can view this page
  const isAdmin = currentUser?.role === 'admin';

  // Thang audit #5: BE list_users trả {"data": [...]} không phân trang
  // (bảng nhỏ ~18 user) — getUsers() đã unwrap thành mảng phẳng. KHÔNG còn
  // gửi page/page_size/search (BE luôn lờ đi những param này — trước đây
  // FE tưởng lọc được nhưng thực chất không). Tìm kiếm dùng bộ lọc
  // client-side có sẵn của DataTable (globalFilter) qua toàn bộ user trả về.
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers(),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return <AccessDenied />;
  }

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
