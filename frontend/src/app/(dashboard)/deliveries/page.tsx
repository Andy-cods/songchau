'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { DELIVERY_STATUS_CONFIG } from '@/lib/constants';
import type { PaginatedResponse, Delivery, DeliveryStatus } from '@/types/models';

// ─── Filter Tabs ──────────────────────────────────────────────

const FILTER_TABS: { value: DeliveryStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'in_transit', label: 'Đang vận chuyển' },
  { value: 'delivered', label: 'Đã giao' },
  { value: 'pending', label: 'Chờ lấy hàng' },
];

// ─── Page Component ───────────────────────────────────────────

export default function DeliveriesPage() {
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading } = useQuery<PaginatedResponse<Delivery>>({
    queryKey: ['deliveries', statusFilter],
    queryFn: () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      return api.get(`/api/v1/bqms/deliveries${params}`);
    },
    retry: false,
  });

  const deliveries = data?.items ?? [];

  // Apply local filters
  let filtered = deliveries;
  if (statusFilter !== 'all') {
    filtered = filtered.filter((d) => d.status === statusFilter);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (d) =>
        d.delivery_number.toLowerCase().includes(q) ||
        (d.purchase_order?.po_number ?? '').toLowerCase().includes(q) ||
        (d.carrier ?? '').toLowerCase().includes(q) ||
        (d.tracking_number ?? '').toLowerCase().includes(q)
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            Vận chuyển
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Theo dõi tình trạng giao hàng các đơn mua
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Status filter tabs */}
        <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                statusFilter === tab.value
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm số PO, mã vận đơn..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-64"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <Truck className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400 font-medium">
              Chưa có đơn hàng vận chuyển
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Các đơn hàng sẽ hiển thị khi có đơn mua đang vận chuyển
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <TH>Mã vận đơn</TH>
                  <TH>Số PO</TH>
                  <TH>Sản phẩm</TH>
                  <TH>NCC</TH>
                  <TH align="right">SL</TH>
                  <TH>Trạng thái giao</TH>
                  <TH>Ngày dự kiến</TH>
                  <TH>Ngày giao thực tế</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((d) => {
                  const statusCfg = DELIVERY_STATUS_CONFIG[d.status];
                  return (
                    <tr
                      key={d.id}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <TD>
                        <span className="font-mono text-brand-600 font-medium">
                          {d.delivery_number}
                        </span>
                      </TD>
                      <TD>
                        <span className="font-mono text-slate-700">
                          {d.purchase_order?.po_number ?? '—'}
                        </span>
                      </TD>
                      <TD>
                        <div className="max-w-[200px]">
                          {d.purchase_order?.items?.length ? (
                            <>
                              <span className="text-sm text-slate-700">
                                {d.purchase_order.items[0].product_name}
                              </span>
                              {d.purchase_order.items.length > 1 && (
                                <span className="block text-xs text-slate-400">
                                  +{d.purchase_order.items.length - 1} sản phẩm khác
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </div>
                      </TD>
                      <TD>
                        {d.purchase_order?.supplier?.name ?? '—'}
                      </TD>
                      <TD align="right">
                        <span className="font-mono">
                          {d.purchase_order?.items
                            ?.reduce((sum, item) => sum + item.quantity, 0)
                            .toLocaleString('vi-VN') ?? '—'}
                        </span>
                      </TD>
                      <TD>
                        {statusCfg && (
                          <StatusBadge
                            label={statusCfg.label}
                            variant={statusCfg.variant}
                            pulse={statusCfg.pulse}
                          />
                        )}
                      </TD>
                      <TD>
                        {d.estimated_arrival
                          ? formatDate(d.estimated_arrival)
                          : '—'}
                      </TD>
                      <TD>
                        {d.actual_arrival
                          ? formatDate(d.actual_arrival)
                          : '—'}
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Count */}
      {filtered.length > 0 && (
        <div className="mt-4 text-sm text-slate-500">
          Hiển thị {filtered.length} đơn vận chuyển
        </div>
      )}
    </div>
  );
}

// ─── Table Helpers ─────────────────────────────────────────────

function TH({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={cn(
        'text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3',
        align === 'right' ? 'text-right' : 'text-left'
      )}
    >
      {children}
    </th>
  );
}

function TD({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <td
      className={cn(
        'px-4 py-3 text-sm text-slate-700',
        align === 'right' ? 'text-right' : 'text-left'
      )}
    >
      {children}
    </td>
  );
}

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-36 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-24 bg-slate-200 rounded-full animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
