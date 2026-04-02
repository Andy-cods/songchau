'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Search, X, ChevronDown, ChevronUp, Package } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { DELIVERY_STATUS_CONFIG } from '@/lib/constants';
import type { DeliveryStatus } from '@/types/models';

// ─── Types ──────────────────────────────────────────────────────

interface DeliveryRecord {
  id: string;
  delivery_number?: string;
  delivery_date?: string;
  po_number?: string;
  bqms_code?: string;
  spec?: string;
  product_name?: string;
  quantity?: number | null;
  unit?: string;
  delivery_status?: string;
  status?: string;
  shipper?: string;
  carrier?: string;
  po_date?: string;
  created_at?: string;
  tracking_number?: string;
  notes?: string;
  unit_price?: number | null;
  currency?: string;
  estimated_arrival?: string;
  actual_arrival?: string;
}

// ─── Constants ──────────────────────────────────────────────────

const STATUS_FILTERS: { value: DeliveryStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'pending', label: 'Chờ lấy hàng' },
  { value: 'picked_up', label: 'Đã lấy hàng' },
  { value: 'in_transit', label: 'Đang vận chuyển' },
  { value: 'customs_clearance', label: 'Thông quan' },
  { value: 'delivered', label: 'Đã giao' },
  { value: 'completed', label: 'Hoàn tất' },
];

const MONTHS = [
  { value: '', label: 'Tất cả tháng' },
  { value: '1', label: 'Tháng 1' },
  { value: '2', label: 'Tháng 2' },
  { value: '3', label: 'Tháng 3' },
  { value: '4', label: 'Tháng 4' },
  { value: '5', label: 'Tháng 5' },
  { value: '6', label: 'Tháng 6' },
  { value: '7', label: 'Tháng 7' },
  { value: '8', label: 'Tháng 8' },
  { value: '9', label: 'Tháng 9' },
  { value: '10', label: 'Tháng 10' },
  { value: '11', label: 'Tháng 11' },
  { value: '12', label: 'Tháng 12' },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => String(CURRENT_YEAR - i));

// ─── Page Component ─────────────────────────────────────────────

export default function BQMSDeliveriesPage() {
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<DeliveryRecord | null>(null);

  const { data: raw, isLoading, error } = useQuery({
    queryKey: ['bqms', 'deliveries', statusFilter, month, year, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (month) params.set('month', month);
      if (year) params.set('year', year);
      params.set('page', String(page));
      params.set('limit', '50');
      const qs = params.toString();
      return api.get<any>(`/api/v1/bqms/deliveries${qs ? `?${qs}` : ''}`);
    },
    retry: 1,
  });

  const deliveries: DeliveryRecord[] = raw?.data ?? [];
  const total: number = raw?.total ?? deliveries.length;

  // Local search filter
  let filtered = deliveries;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (d) =>
        (d.po_number ?? '').toLowerCase().includes(q) ||
        (d.bqms_code ?? '').toLowerCase().includes(q) ||
        (d.spec ?? d.product_name ?? '').toLowerCase().includes(q) ||
        (d.delivery_number ?? '').toLowerCase().includes(q) ||
        (d.shipper ?? d.carrier ?? '').toLowerCase().includes(q)
    );
  }

  return (
    <div className="flex gap-4">
      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-display font-bold text-slate-900">
              BQMS — Theo dõi giao hàng
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Thống kê tình trạng giao hàng · mới nhất trước
            </p>
          </div>
          <div className="text-sm text-slate-400 font-mono">
            {total} đơn
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-lg border border-slate-200 p-3 mb-4 flex flex-wrap items-center gap-3">
          {/* Status tabs */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-md p-1">
            {STATUS_FILTERS.map((sf) => (
              <button
                key={sf.value}
                onClick={() => { setStatusFilter(sf.value); setPage(1); }}
                className={cn(
                  'px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap',
                  statusFilter === sf.value
                    ? 'bg-white text-brand-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {sf.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Month select */}
            <select
              value={month}
              onChange={(e) => { setMonth(e.target.value); setPage(1); }}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>

            {/* Year select */}
            <select
              value={year}
              onChange={(e) => { setYear(e.target.value); setPage(1); }}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Tất cả năm</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm PO, mã BQMS, spec, shipper..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 w-64"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {error && !isLoading && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">Có lỗi khi tải dữ liệu. Vui lòng thử lại.</p>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          {isLoading ? (
            <TableSkeleton />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-300">
              <Truck className="h-12 w-12 mb-3" />
              <p className="text-sm text-slate-400 font-medium">
                {deliveries.length === 0
                  ? 'Chưa có dữ liệu giao hàng'
                  : 'Không tìm thấy kết quả phù hợp'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <TH>Mã giao hàng</TH>
                    <TH>Ngày giao</TH>
                    <TH>Mã PO</TH>
                    <TH>Sản phẩm / Spec</TH>
                    <TH align="right">SL</TH>
                    <TH>Trạng thái</TH>
                    <TH>Shipper</TH>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((d, idx) => {
                    const status = d.delivery_status ?? d.status ?? 'pending';
                    const statusCfg = (DELIVERY_STATUS_CONFIG as any)[status];
                    const isSelected = selectedRow?.id === d.id;
                    return (
                      <tr
                        key={d.id ?? idx}
                        onClick={() => setSelectedRow(isSelected ? null : d)}
                        className={cn(
                          'hover:bg-slate-50 transition-colors cursor-pointer',
                          isSelected && 'bg-brand-50 border-l-2 border-brand-500'
                        )}
                      >
                        <TD>
                          <span className="font-mono text-brand-600 font-medium text-xs">
                            {d.delivery_number ?? '—'}
                          </span>
                        </TD>
                        <TD>{formatDate(d.delivery_date ?? d.actual_arrival)}</TD>
                        <TD>
                          <span className="font-mono text-slate-600 text-xs">
                            {d.po_number ?? '—'}
                          </span>
                        </TD>
                        <TD>
                          <div className="max-w-[200px]">
                            <p className="text-sm text-slate-700 truncate">
                              {d.spec ?? d.product_name ?? '—'}
                            </p>
                            {d.bqms_code && (
                              <p className="text-xs text-slate-400 font-mono">{d.bqms_code}</p>
                            )}
                          </div>
                        </TD>
                        <TD align="right">
                          <span className="font-mono text-sm">
                            {d.quantity != null
                              ? `${Number(d.quantity).toLocaleString('vi-VN')}${d.unit ? ` ${d.unit}` : ''}`
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
                            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                              {status}
                            </span>
                          )}
                        </TD>
                        <TD>
                          <span className="text-sm text-slate-600">
                            {d.shipper ?? d.carrier ?? '—'}
                          </span>
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
          <span>Hiển thị {filtered.length} / {total} đơn giao hàng</span>
          {total > 50 && (
            <div className="flex items-center gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 rounded border border-slate-200 text-xs disabled:opacity-40 hover:bg-slate-50"
              >
                Trước
              </button>
              <span className="text-xs font-mono">Trang {page}</span>
              <button
                disabled={deliveries.length < 50}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 rounded border border-slate-200 text-xs disabled:opacity-40 hover:bg-slate-50"
              >
                Sau
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedRow && (
        <div className="w-80 shrink-0">
          <DetailPanel delivery={selectedRow} onClose={() => setSelectedRow(null)} />
        </div>
      )}
    </div>
  );
}

// ─── Detail Panel ───────────────────────────────────────────────

function DetailPanel({
  delivery,
  onClose,
}: {
  delivery: DeliveryRecord;
  onClose: () => void;
}) {
  const status = delivery.delivery_status ?? delivery.status ?? 'pending';
  const statusCfg = (DELIVERY_STATUS_CONFIG as any)[status];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden sticky top-4">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-brand-500" />
          <span className="text-sm font-semibold text-slate-700">Chi tiết giao hàng</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Delivery number + status */}
        <div>
          <p className="text-xs text-slate-400 uppercase font-mono tracking-wider mb-1">Mã giao hàng</p>
          <p className="font-mono text-brand-600 font-semibold text-base">
            {delivery.delivery_number ?? '—'}
          </p>
        </div>

        <div>
          <p className="text-xs text-slate-400 uppercase font-mono tracking-wider mb-1">Trạng thái</p>
          {statusCfg ? (
            <StatusBadge
              label={statusCfg.label}
              variant={statusCfg.variant}
              pulse={statusCfg.pulse}
            />
          ) : (
            <span className="text-sm text-slate-500">{status}</span>
          )}
        </div>

        <div className="border-t border-slate-100 pt-4 space-y-3">
          <DetailRow label="Mã PO" value={delivery.po_number} mono />
          <DetailRow label="Mã BQMS" value={delivery.bqms_code} mono />
          <DetailRow label="Sản phẩm" value={delivery.spec ?? delivery.product_name} />
          <DetailRow
            label="Số lượng"
            value={
              delivery.quantity != null
                ? `${Number(delivery.quantity).toLocaleString('vi-VN')}${delivery.unit ? ` ${delivery.unit}` : ''}`
                : null
            }
          />
          <DetailRow label="Shipper" value={delivery.shipper ?? delivery.carrier} />
          <DetailRow label="Mã vận đơn" value={delivery.tracking_number} mono />
        </div>

        <div className="border-t border-slate-100 pt-4 space-y-3">
          <DetailRow label="Ngày giao dự kiến" value={formatDate(delivery.estimated_arrival)} />
          <DetailRow label="Ngày giao thực tế" value={formatDate(delivery.actual_arrival ?? delivery.delivery_date)} />
          <DetailRow label="Ngày tạo" value={formatDate(delivery.created_at)} />
        </div>

        {delivery.notes && (
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-400 uppercase font-mono tracking-wider mb-1">Ghi chú</p>
            <p className="text-sm text-slate-600">{delivery.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className={cn('text-sm text-right text-slate-700 truncate', mono && 'font-mono text-xs')}>
        {value ?? '—'}
      </span>
    </div>
  );
}

// ─── Table helpers ──────────────────────────────────────────────

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
        'text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3 whitespace-nowrap',
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
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-40 bg-slate-200 rounded animate-pulse flex-1" />
          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-24 bg-slate-200 rounded-full animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
