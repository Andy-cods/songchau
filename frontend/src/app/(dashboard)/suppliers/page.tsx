'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { Building2, Plus, Star } from 'lucide-react';
import { getSuppliers } from '@/services/suppliers';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import type { Supplier, PaginatedResponse } from '@/types/models';

// ─── Column Definitions ────────────────────────────────────────

const columnHelper = createColumnHelper<Supplier>();

const columns = [
  columnHelper.accessor('name', {
    header: 'Tên NCC',
    cell: (info) => (
      <div>
        <span className="text-sm font-medium text-slate-900">
          {info.getValue()}
        </span>
        <span className="block text-xs text-slate-400 font-mono">
          {info.row.original.code}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('contact_person', {
    header: 'Liên hệ',
    cell: (info) => (
      <span className="text-sm text-slate-700">
        {info.getValue() || '—'}
      </span>
    ),
  }),
  columnHelper.accessor('phone', {
    header: 'SĐT',
    cell: (info) => (
      <span className="text-sm font-mono text-slate-600">
        {info.getValue() || '—'}
      </span>
    ),
  }),
  columnHelper.accessor('country', {
    header: 'Quốc gia',
    cell: (info) => (
      <span className="text-sm text-slate-700">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('rating', {
    header: 'Rating',
    enableSorting: true,
    cell: (info) => {
      const rating = info.getValue();
      if (rating == null) return <span className="text-sm text-slate-400">—</span>;
      return (
        <div className="flex items-center gap-1">
          <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
          <span className="text-sm font-mono text-slate-700">{Number(rating || 0).toFixed(1)}</span>
        </div>
      );
    },
  }),
  columnHelper.accessor('is_active', {
    header: 'Trạng thái',
    cell: (info) => (
      <StatusBadge
        label={info.getValue() ? 'Hoạt động' : 'Ngưng'}
        variant={info.getValue() ? 'success' : 'neutral'}
      />
    ),
  }),
];

// ─── Page Component ────────────────────────────────────────────

export default function SuppliersPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<PaginatedResponse<Supplier>>({
    queryKey: ['suppliers', page, search],
    queryFn: () => getSuppliers({ page, page_size: 20, search: search || undefined }),
  });

  const suppliers = data?.items ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            Nhà cung cấp
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý danh sách nhà cung cấp
          </p>
        </div>
        <Link href="/suppliers/new">
          <Button>
            <Plus className="h-4 w-4" />
            Thêm NCC
          </Button>
        </Link>
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={suppliers}
        isLoading={isLoading}
        searchPlaceholder="Tìm kiếm theo tên, mã NCC, quốc gia..."
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
        onRowClick={(row) => router.push(`/suppliers/${row.id}`)}
        emptyState={
          <EmptyState
            icon={Building2}
            heading="Chưa có nhà cung cấp nào"
            description="Thêm nhà cung cấp để bắt đầu quản lý đơn hàng"
            actionLabel="Thêm NCC"
            onAction={() => router.push('/suppliers/new')}
          />
        }
      />
    </div>
  );
}
