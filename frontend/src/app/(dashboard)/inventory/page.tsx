'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createColumnHelper } from '@tanstack/react-table';
import { Package } from 'lucide-react';
import { getInventory } from '@/services/inventory';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { cn } from '@/lib/utils';
import type { InventoryItem, PaginatedResponse } from '@/types/models';

// ─── Column Definitions ────────────────────────────────────────

const columnHelper = createColumnHelper<InventoryItem>();

const columns = [
  columnHelper.accessor('product_code', {
    header: 'Mã hàng',
    cell: (info) => (
      <span className="text-sm font-mono font-medium text-brand-600">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('product_name', {
    header: 'Tên hàng',
    cell: (info) => (
      <div>
        <span className="text-sm font-medium text-slate-900">
          {info.getValue()}
        </span>
        {info.row.original.category && (
          <span className="block text-xs text-slate-400">
            {info.row.original.category}
          </span>
        )}
      </div>
    ),
  }),
  columnHelper.accessor('current_stock', {
    header: 'Tồn kho',
    cell: (info) => {
      const value = info.getValue();
      const minStock = info.row.original.min_stock;
      const isLow = value < minStock;
      return (
        <span
          className={cn(
            'text-sm font-mono',
            isLow ? 'text-red-600 font-semibold' : 'text-slate-700'
          )}
        >
          {value.toLocaleString('vi-VN')} {info.row.original.unit}
        </span>
      );
    },
  }),
  columnHelper.display({
    id: 'ordered',
    header: 'Đã đặt',
    cell: () => (
      <span className="text-sm font-mono text-slate-500">—</span>
    ),
  }),
  columnHelper.display({
    id: 'available',
    header: 'Khả dụng',
    cell: (info) => {
      const stock = info.row.original.current_stock;
      const minStock = info.row.original.min_stock;
      const isLow = stock < minStock;
      return (
        <span
          className={cn(
            'text-sm font-mono',
            isLow ? 'text-red-600 font-semibold' : 'text-slate-700'
          )}
        >
          {stock.toLocaleString('vi-VN')}
        </span>
      );
    },
  }),
  columnHelper.accessor('min_stock', {
    header: 'Tối thiểu',
    cell: (info) => (
      <span className="text-sm font-mono text-slate-500">
        {info.getValue().toLocaleString('vi-VN')}
      </span>
    ),
  }),
  columnHelper.accessor('warehouse_location', {
    header: 'Vị trí',
    cell: (info) => (
      <span className="text-sm text-slate-600">
        {info.getValue() || '—'}
      </span>
    ),
  }),
];

// ─── Page Component ────────────────────────────────────────────

export default function InventoryPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<PaginatedResponse<InventoryItem>>({
    queryKey: ['inventory', page, search],
    queryFn: () => getInventory({ page, page_size: 20, search: search || undefined }),
  });

  const items = data?.items ?? [];

  const lowStockCount = items.filter((item) => item.current_stock < item.min_stock).length;

  return (
    <div role="region" aria-label="Trang kho hàng">
      {/* Header */}
      <PageHeader
        icon={Package}
        title="Kho hàng"
        subtitle="Theo dõi tồn kho và vị trí hàng hóa"
        className="mb-6"
      />

      {/* Low stock alert */}
      {!isLoading && lowStockCount > 0 && (
        <div
          role="alert"
          aria-live="polite"
          aria-label={`Cảnh báo: ${lowStockCount} mặt hàng dưới mức tồn kho tối thiểu`}
          className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2"
        >
          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
          <span className="text-sm text-red-700 font-medium">
            Có {lowStockCount} mặt hàng dưới mức tồn kho tối thiểu
          </span>
        </div>
      )}

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        searchPlaceholder="Tìm kiếm theo mã hàng, tên hàng..."
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
        onRowClick={(row) => router.push(`/inventory/${row.id}`)}
        emptyState={
          <EmptyState
            icon={Package}
            heading="Chưa có hàng hóa nào"
            description="Kho hàng sẽ được cập nhật khi nhận hàng từ đơn mua"
          />
        }
      />
    </div>
  );
}
