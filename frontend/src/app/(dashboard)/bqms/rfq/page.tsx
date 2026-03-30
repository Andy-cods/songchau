'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSearch, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import type { PaginatedResponse } from '@/types/models';

// ─── Types ─────────────────────────────────────────────────────

type RFQResult = 'won' | 'lost' | 'pending';

interface BQMSRfq {
  id: string;
  rfq_number: string;
  bqms_code: string;
  spec: string;
  maker: string;
  quantity: number;
  unit: string;
  price_v1: number;
  currency: 'VND' | 'USD' | 'RMB';
  rfq_result: RFQResult;
  supplier_name: string | null;
}

// ─── Status Config ─────────────────────────────────────────────

const RFQ_STATUS_MAP: Record<
  RFQResult,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
> = {
  won: { label: 'Trúng thầu', variant: 'success' },
  lost: { label: 'Trượt', variant: 'danger' },
  pending: { label: 'Đang xử lý', variant: 'warning' },
};

// ─── Mock Data ─────────────────────────────────────────────────

const MOCK_RFQS: BQMSRfq[] = [
  {
    id: '1',
    rfq_number: 'RFQ-2026-0089',
    bqms_code: 'BQ-260328-001',
    spec: 'MCCB NF250-SEV 3P 200A',
    maker: 'Mitsubishi',
    quantity: 50,
    unit: 'cái',
    price_v1: 4500000,
    currency: 'VND',
    rfq_result: 'pending',
    supplier_name: null,
  },
  {
    id: '2',
    rfq_number: 'RFQ-2026-0088',
    bqms_code: 'BQ-260327-002',
    spec: 'Contactor MC-85a 220V',
    maker: 'LS Electric',
    quantity: 200,
    unit: 'cái',
    price_v1: 850000,
    currency: 'VND',
    rfq_result: 'won',
    supplier_name: 'Song Châu Trading',
  },
  {
    id: '3',
    rfq_number: 'RFQ-2026-0087',
    bqms_code: 'BQ-260326-003',
    spec: 'ACB NT06H1 630A 3P',
    maker: 'Schneider',
    quantity: 5,
    unit: 'bộ',
    price_v1: 45000000,
    currency: 'VND',
    rfq_result: 'pending',
    supplier_name: null,
  },
  {
    id: '4',
    rfq_number: 'RFQ-2026-0085',
    bqms_code: 'BQ-260325-001',
    spec: 'VFD FR-E840-0120 5.5kW',
    maker: 'Mitsubishi',
    quantity: 10,
    unit: 'bộ',
    price_v1: 12500000,
    currency: 'VND',
    rfq_result: 'lost',
    supplier_name: null,
  },
  {
    id: '5',
    rfq_number: 'RFQ-2026-0083',
    bqms_code: 'BQ-260324-002',
    spec: 'Relay G3PE-245B DC12-24',
    maker: 'Omron',
    quantity: 100,
    unit: 'cái',
    price_v1: 380000,
    currency: 'VND',
    rfq_result: 'won',
    supplier_name: 'Song Châu Trading',
  },
  {
    id: '6',
    rfq_number: 'RFQ-2026-0081',
    bqms_code: 'BQ-260323-001',
    spec: 'MCB iC60N 3P 32A C',
    maker: 'Schneider',
    quantity: 500,
    unit: 'cái',
    price_v1: 320000,
    currency: 'VND',
    rfq_result: 'won',
    supplier_name: 'Song Châu Trading',
  },
  {
    id: '7',
    rfq_number: 'RFQ-2026-0079',
    bqms_code: 'BQ-260321-002',
    spec: 'PLC FX5U-32MT/ES',
    maker: 'Mitsubishi',
    quantity: 8,
    unit: 'bộ',
    price_v1: 18500000,
    currency: 'VND',
    rfq_result: 'lost',
    supplier_name: null,
  },
  {
    id: '8',
    rfq_number: 'RFQ-2026-0077',
    bqms_code: 'BQ-260320-001',
    spec: 'Sensor E3Z-D62 2M',
    maker: 'Omron',
    quantity: 50,
    unit: 'cái',
    price_v1: 1250000,
    currency: 'VND',
    rfq_result: 'pending',
    supplier_name: null,
  },
];

// ─── Filter options ────────────────────────────────────────────

const RESULT_FILTERS: { value: RFQResult | 'all'; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'won', label: 'Trúng thầu' },
  { value: 'lost', label: 'Trượt' },
  { value: 'pending', label: 'Đang xử lý' },
];

// ─── Page Component ────────────────────────────────────────────

export default function BQMSRfqPage() {
  const [resultFilter, setResultFilter] = useState<RFQResult | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading } = useQuery<PaginatedResponse<BQMSRfq>>({
    queryKey: ['bqms', 'rfq', resultFilter],
    queryFn: () => {
      const params = resultFilter !== 'all' ? `?result=${resultFilter}` : '';
      return api.get(`/api/v1/bqms/rfq${params}`);
    },
    retry: false,
  });

  const rfqs = data?.items?.length ? data.items : MOCK_RFQS;

  // Apply local filters
  let filtered = rfqs;
  if (resultFilter !== 'all') {
    filtered = filtered.filter((r) => r.rfq_result === resultFilter);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.rfq_number.toLowerCase().includes(q) ||
        r.bqms_code.toLowerCase().includes(q) ||
        r.spec.toLowerCase().includes(q) ||
        r.maker.toLowerCase().includes(q)
    );
  }

  // Summary stats
  const totalWon = rfqs.filter((r) => r.rfq_result === 'won').length;
  const totalLost = rfqs.filter((r) => r.rfq_result === 'lost').length;
  const totalPending = rfqs.filter((r) => r.rfq_result === 'pending').length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            BQMS - Yêu cầu báo giá (RFQ)
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý và theo dõi kết quả báo giá
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-slate-600">
              Trúng: <strong>{totalWon}</strong>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-slate-600">
              Trượt: <strong>{totalLost}</strong>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-slate-600">
              Chờ: <strong>{totalPending}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-1">
          {RESULT_FILTERS.map((rf) => (
            <button
              key={rf.value}
              onClick={() => setResultFilter(rf.value)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                resultFilter === rf.value
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              {rf.label}
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm RFQ, mã BQMS, spec, maker..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-72"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <FileSearch className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400 font-medium">
              Không tìm thấy RFQ nào
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <TH>RFQ No</TH>
                  <TH>BQMS Code</TH>
                  <TH>Spec</TH>
                  <TH>Maker</TH>
                  <TH align="right">SL</TH>
                  <TH align="right">Giá V1</TH>
                  <TH>Kết quả</TH>
                  <TH>NCC</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((rfq) => {
                  const statusCfg = RFQ_STATUS_MAP[rfq.rfq_result];
                  return (
                    <tr
                      key={rfq.id}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <TD>
                        <span className="font-mono text-brand-600 font-medium">
                          {rfq.rfq_number}
                        </span>
                      </TD>
                      <TD>
                        <span className="font-mono">{rfq.bqms_code}</span>
                      </TD>
                      <TD>{rfq.spec}</TD>
                      <TD>{rfq.maker}</TD>
                      <TD align="right">
                        <span className="font-mono">
                          {rfq.quantity.toLocaleString('vi-VN')} {rfq.unit}
                        </span>
                      </TD>
                      <TD align="right">
                        <span className="font-mono">
                          {formatCurrency(rfq.price_v1, rfq.currency)}
                        </span>
                      </TD>
                      <TD>
                        <StatusBadge
                          label={statusCfg.label}
                          variant={statusCfg.variant}
                          pulse={rfq.rfq_result === 'pending'}
                        />
                      </TD>
                      <TD>
                        <span className="text-slate-600">
                          {rfq.supplier_name ?? '—'}
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

      {/* Count */}
      <div className="mt-4 text-sm text-slate-500">
        Hiển thị {filtered.length} / {rfqs.length} yêu cầu báo giá
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
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-40 bg-slate-200 rounded animate-pulse flex-1" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-16 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-20 bg-slate-200 rounded-full animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
