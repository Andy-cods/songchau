'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            Đơn mua hàng
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý tất cả đơn đặt hàng
          </p>
        </div>
        <Link
          href="/purchase-orders/new"
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          Tạo đơn mới
        </Link>
      </div>

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
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : error || orders.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Mã PO
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Nhà cung cấp
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Trạng thái
                  </th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Giá trị
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Ngày tạo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((po) => {
                  const statusConfig = PO_STATUS_CONFIG[po.status];
                  return (
                    <tr
                      key={po.id}
                      onClick={() => router.push(`/purchase-orders/${po.id}`)}
                      className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono font-medium text-brand-600">
                          {po.po_number}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-700">
                          {po.supplier?.name || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {statusConfig ? (
                          <StatusBadge
                            label={statusConfig.label}
                            variant={statusConfig.variant}
                            pulse={statusConfig.pulse}
                          />
                        ) : (
                          <span className="text-sm text-slate-400">{po.status}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-mono text-slate-900">
                          {formatCurrency(po.total_amount, po.currency)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-500">
                          {formatDate(po.created_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-36 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-20 bg-slate-200 rounded-full animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse ml-auto" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-300">
      <ShoppingCart className="h-12 w-12 mb-3" />
      <p className="text-sm text-slate-400 font-medium">
        Chưa có đơn mua hàng nào
      </p>
      <p className="text-xs text-slate-400 mt-1">
        Bấm &quot;Tạo đơn mới&quot; để bắt đầu
      </p>
    </div>
  );
}
