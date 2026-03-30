'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { DELIVERY_STATUS_CONFIG } from '@/lib/constants';
import type { DeliveryStatus } from '@/types/models';

// ─── Status filter options ─────────────────────────────────────

const STATUS_FILTERS: { value: DeliveryStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'pending', label: 'Chờ lấy hàng' },
  { value: 'picked_up', label: 'Đã lấy hàng' },
  { value: 'in_transit', label: 'Đang vận chuyển' },
  { value: 'customs_clearance', label: 'Thông quan' },
  { value: 'delivered', label: 'Đã giao' },
  { value: 'completed', label: 'Hoàn tất' },
];

// ─── Page Component ────────────────────────────────────────────

export default function BQMSDeliveriesPage() {
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  const { data: raw, isLoading, error } = useQuery({
    queryKey: ['bqms', 'deliveries', statusFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', '50');
      const qs = params.toString();
      return api.get<any>(`/api/v1/bqms/deliveries${qs ? `?${qs}` : ''}`);
    },
    retry: 1,
  });

  // Extract data from API — no mock fallback
  const deliveries: any[] = raw?.data ?? [];
  const total = raw?.total ?? deliveries.length;

  // Apply local search filter
  let filtered = deliveries;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (d: any) =>
        (d.po_number || '').toLowerCase().includes(q) ||
        (d.bqms_code || '').toLowerCase().includes(q) ||
        (d.spec || d.product_name || '').toLowerCase().includes(q) ||
        (d.delivery_number || '').toLowerCase().includes(q)
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            BQMS - Theo dõi giao hàng
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý tình trạng giao hàng các đơn BQMS
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Status filter tabs */}
        <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-1">
          {STATUS_FILTERS.map((sf) => (
            <button
              key={sf.value}
              onClick={() => {
                setStatusFilter(sf.value);
                setPage(1);
              }}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                statusFilter === sf.value
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              {sf.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm PO, mã BQMS, spec..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-64"
          />
        </div>
      </div>

      {/* Error State */}
      {error && !isLoading && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">Có lỗi xảy ra, thử lại sau</p>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <Truck className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400 font-medium">
              {deliveries.length === 0
                ? 'Chưa có dữ liệu giao hàng'
                : 'Không tìm thấy đơn giao hàng nào'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <TH>Ngày PO</TH>
                  <TH>Số PO</TH>
                  <TH>Mã BQMS</TH>
                  <TH>Spec</TH>
                  <TH align="right">SL</TH>
                  <TH align="right">Đơn giá</TH>
                  <TH>Trạng thái</TH>
                  <TH>Ngày giao</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((d: any, idx: number) => {
                  const status = d.delivery_status || d.status || 'pending';
                  const statusCfg = (DELIVERY_STATUS_CONFIG as any)[status];
                  return (
                    <tr
                      key={d.id ?? idx}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <TD>{formatDate(d.po_date ?? d.created_at)}</TD>
                      <TD>
                        <span className="font-mono text-brand-600 font-medium">
                          {d.po_number ?? '—'}
                        </span>
                      </TD>
                      <TD>
                        <span className="font-mono">{d.bqms_code ?? '—'}</span>
                      </TD>
                      <TD>{d.spec ?? d.product_name ?? '—'}</TD>
                      <TD align="right">
                        <span className="font-mono">
                          {d.quantity != null
                            ? Number(d.quantity).toLocaleString('vi-VN')
                            : '—'}
                        </span>
                      </TD>
                      <TD align="right">
                        <span className="font-mono">
                          {d.unit_price != null
                            ? formatCurrency(
                                d.unit_price,
                                d.currency ?? 'VND'
                              )
                            : '—'}
                        </span>
                      </TD>
                      <TD>
                        {statusCfg ? (
                          <StatusBadge
                            label={statusCfg.label}
                            variant={statusCfg.variant}
                            pulse={statusCfg.pulse}
                          />
                        ) : (
                          <span className="text-xs text-slate-500">{status}</span>
                        )}
                      </TD>
                      <TD>
                        {d.delivery_date
                          ? formatDate(d.delivery_date)
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
      <div className="mt-4 text-sm text-slate-500">
        Hiển thị {filtered.length} / {total} đơn giao hàng
      </div>
    </div>
  );
}

// ─── Table Helpers ──────────────────────────────────────────────

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
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-40 bg-slate-200 rounded animate-pulse flex-1" />
          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-20 bg-slate-200 rounded-full animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
