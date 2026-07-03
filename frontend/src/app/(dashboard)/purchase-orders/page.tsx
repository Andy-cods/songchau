'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import { EmptyState } from '@/components/shared/empty-state';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PO_STATUS_CONFIG } from '@/lib/constants';
import type { PaginatedResponse, PurchaseOrder } from '@/types/models';

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const { data, isLoading, error } = useQuery<PaginatedResponse<PurchaseOrder>>({
    queryKey: ['purchase-orders'],
    queryFn: () => api.get('/api/v1/purchase-orders'),
    retry: false,
  });

  const orders = data?.items ?? [];

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Đơn mua hàng"
        subtitle="Quản lý tất cả đơn đặt hàng"
        icon={ShoppingCart}
        className="mb-6"
        actions={
          <Link
            href="/purchase-orders/new"
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Tạo đơn mới
          </Link>
        }
      />

      {/* Search bar placeholder */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm theo mã PO, nhà cung cấp..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Table */}
      <Card padded={false} className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : error ? (
          <EmptyState
            variant="error"
            icon={ShoppingCart}
            heading="Không tải được đơn mua hàng"
            description="Đã có lỗi xảy ra. Vui lòng thử lại."
          />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            heading="Chưa có đơn mua hàng nào"
            description='Bấm "Tạo đơn mới" để bắt đầu'
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã PO</TableHead>
                <TableHead>Nhà cung cấp</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Giá trị</TableHead>
                <TableHead>Ngày tạo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((po) => {
                const statusConfig = PO_STATUS_CONFIG[po.status];
                return (
                  <TableRow
                    key={po.id}
                    onClick={() => router.push(`/purchase-orders/${po.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <span className="text-sm font-mono font-medium text-brand-600">
                        {po.po_number}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-700">
                        {po.supplier?.name || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {statusConfig ? (
                        <StatusBadge
                          label={statusConfig.label}
                          variant={statusConfig.variant}
                          pulse={statusConfig.pulse}
                        />
                      ) : (
                        <span className="text-sm text-slate-400">{po.status}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-mono text-slate-900">
                        {formatCurrency(po.total_amount, po.currency)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-500">
                        {formatDate(po.created_at)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Pagination info */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>
            Hiển thị {orders.length} / {data.total} đơn hàng
          </span>
          <span>
            Trang {data.page} / {data.total_pages}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Table Skeleton ─────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-28 ml-auto" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
