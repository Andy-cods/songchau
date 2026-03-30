'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { DELIVERY_STATUS_CONFIG } from '@/lib/constants';
import type { PaginatedResponse, DeliveryStatus } from '@/types/models';

// ─── Types ─────────────────────────────────────────────────────

interface BQMSDelivery {
  id: string;
  po_date: string;
  po_number: string;
  bqms_code: string;
  spec: string;
  quantity: number;
  unit_price: number;
  currency: 'VND' | 'USD' | 'RMB';
  delivery_status: DeliveryStatus;
  delivery_date: string | null;
}

// ─── Mock Data ─────────────────────────────────────────────────

const MOCK_DELIVERIES: BQMSDelivery[] = [
  {
    id: '1',
    po_date: '2026-03-15',
    po_number: 'PO-2026-0142',
    bqms_code: 'BQ-260315-001',
    spec: 'MCCB NF250-SEV 3P 200A',
    quantity: 50,
    unit_price: 4500000,
    currency: 'VND',
    delivery_status: 'in_transit',
    delivery_date: '2026-04-05',
  },
  {
    id: '2',
    po_date: '2026-03-12',
    po_number: 'PO-2026-0139',
    bqms_code: 'BQ-260312-002',
    spec: 'Contactor MC-85a 220V',
    quantity: 200,
    unit_price: 850000,
    currency: 'VND',
    delivery_status: 'delivered',
    delivery_date: '2026-03-25',
  },
  {
    id: '3',
    po_date: '2026-03-10',
    po_number: 'PO-2026-0135',
    bqms_code: 'BQ-260310-001',
    spec: 'ACB NT06H1 630A 3P',
    quantity: 5,
    unit_price: 45000000,
    currency: 'VND',
    delivery_status: 'customs_clearance',
    delivery_date: '2026-04-10',
  },
  {
    id: '4',
    po_date: '2026-03-08',
    po_number: 'PO-2026-0132',
    bqms_code: 'BQ-260308-003',
    spec: 'VFD FR-E840-0120 5.5kW',
    quantity: 10,
    unit_price: 12500000,
    currency: 'VND',
    delivery_status: 'completed',
    delivery_date: '2026-03-20',
  },
  {
    id: '5',
    po_date: '2026-03-05',
    po_number: 'PO-2026-0128',
    bqms_code: 'BQ-260305-002',
    spec: 'Relay G3PE-245B DC12-24',
    quantity: 100,
    unit_price: 380000,
    currency: 'VND',
    delivery_status: 'pending',
    delivery_date: null,
  },
  {
    id: '6',
    po_date: '2026-03-02',
    po_number: 'PO-2026-0125',
    bqms_code: 'BQ-260302-001',
    spec: 'MCB iC60N 3P 32A C',
    quantity: 500,
    unit_price: 320000,
    currency: 'VND',
    delivery_status: 'picked_up',
    delivery_date: '2026-03-30',
  },
];

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

  const { data, isLoading, error } = useQuery<PaginatedResponse<BQMSDelivery>>({
    queryKey: ['bqms', 'deliveries', statusFilter],
    queryFn: () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      return api.get(`/api/v1/bqms/deliveries${params}`);
    },
    retry: false,
  });

  const deliveries = data?.items?.length ? data.items : MOCK_DELIVERIES;

  // Apply local filters
  let filtered = deliveries;
  if (statusFilter !== 'all') {
    filtered = filtered.filter((d) => d.delivery_status === statusFilter);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (d) =>
        d.po_number.toLowerCase().includes(q) ||
        d.bqms_code.toLowerCase().includes(q) ||
        d.spec.toLowerCase().includes(q)
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
              onClick={() => setStatusFilter(sf.value)}
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

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <Truck className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400 font-medium">
              Không tìm thấy đơn giao hàng nào
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
                {filtered.map((d) => {
                  const statusCfg = DELIVERY_STATUS_CONFIG[d.delivery_status];
                  return (
                    <tr
                      key={d.id}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <TD>{formatDate(d.po_date)}</TD>
                      <TD>
                        <span className="font-mono text-brand-600 font-medium">
                          {d.po_number}
                        </span>
                      </TD>
                      <TD>
                        <span className="font-mono">{d.bqms_code}</span>
                      </TD>
                      <TD>{d.spec}</TD>
                      <TD align="right">
                        <span className="font-mono">
                          {d.quantity.toLocaleString('vi-VN')}
                        </span>
                      </TD>
                      <TD align="right">
                        <span className="font-mono">
                          {formatCurrency(d.unit_price, d.currency)}
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
                      <TD>{d.delivery_date ? formatDate(d.delivery_date) : '—'}</TD>
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
        Hiển thị {filtered.length} đơn giao hàng
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
