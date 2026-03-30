'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSearch, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';

// ─── Types ─────────────────────────────────────────────────────

type RFQResult = 'won' | 'lost' | 'pending';

// ─── Status Config ─────────────────────────────────────────────

const RFQ_STATUS_MAP: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
> = {
  won: { label: 'Trúng thầu', variant: 'success' },
  lost: { label: 'Trượt', variant: 'danger' },
  pending: { label: 'Đang xử lý', variant: 'warning' },
  submitted: { label: 'Đã gửi', variant: 'info' },
  draft: { label: 'Nháp', variant: 'neutral' },
  cancelled: { label: 'Hủy', variant: 'neutral' },
};

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
  const [page, setPage] = useState(1);

  const { data: raw, isLoading, error } = useQuery({
    queryKey: ['bqms', 'rfq', resultFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (resultFilter !== 'all') params.set('result', resultFilter);
      params.set('page', String(page));
      params.set('limit', '50');
      const qs = params.toString();
      return api.get<any>(`/api/v1/bqms/rfq${qs ? `?${qs}` : ''}`);
    },
    retry: 1,
  });

  // Extract data from API — no mock fallback
  const rfqs: any[] = raw?.data ?? [];
  const total = raw?.total ?? rfqs.length;

  // Apply local search filter
  let filtered = rfqs;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (r: any) =>
        (r.rfq_number || '').toLowerCase().includes(q) ||
        (r.bqms_code || '').toLowerCase().includes(q) ||
        (r.spec || r.product_name || '').toLowerCase().includes(q) ||
        (r.maker || '').toLowerCase().includes(q)
    );
  }

  // Summary stats from real data
  const totalWon = rfqs.filter(
    (r: any) => r.rfq_result === 'won' || r.status === 'won'
  ).length;
  const totalLost = rfqs.filter(
    (r: any) => r.rfq_result === 'lost' || r.status === 'lost'
  ).length;
  const totalPending = rfqs.filter(
    (r: any) => r.rfq_result === 'pending' || r.status === 'pending'
  ).length;

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
        {rfqs.length > 0 && (
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
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-1">
          {RESULT_FILTERS.map((rf) => (
            <button
              key={rf.value}
              onClick={() => {
                setResultFilter(rf.value);
                setPage(1);
              }}
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
            <FileSearch className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400 font-medium">
              {rfqs.length === 0
                ? 'Chưa có dữ liệu RFQ'
                : 'Không tìm thấy RFQ nào'}
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
                {filtered.map((rfq: any, idx: number) => {
                  const result = rfq.rfq_result || rfq.status || 'pending';
                  const statusCfg = RFQ_STATUS_MAP[result] ?? {
                    label: result,
                    variant: 'neutral' as const,
                  };
                  return (
                    <tr
                      key={rfq.id ?? idx}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <TD>
                        <span className="font-mono text-brand-600 font-medium">
                          {rfq.rfq_number ?? '—'}
                        </span>
                      </TD>
                      <TD>
                        <span className="font-mono">
                          {rfq.bqms_code ?? '—'}
                        </span>
                      </TD>
                      <TD>{rfq.spec ?? rfq.product_name ?? '—'}</TD>
                      <TD>{rfq.maker ?? '—'}</TD>
                      <TD align="right">
                        <span className="font-mono">
                          {rfq.quantity != null
                            ? `${Number(rfq.quantity).toLocaleString('vi-VN')}${
                                rfq.unit ? ` ${rfq.unit}` : ''
                              }`
                            : '—'}
                        </span>
                      </TD>
                      <TD align="right">
                        <span className="font-mono">
                          {rfq.price_v1 != null
                            ? formatCurrency(
                                rfq.price_v1,
                                rfq.currency ?? 'VND'
                              )
                            : '—'}
                        </span>
                      </TD>
                      <TD>
                        <StatusBadge
                          label={statusCfg.label}
                          variant={statusCfg.variant}
                          pulse={result === 'pending'}
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
        Hiển thị {filtered.length} / {total} yêu cầu báo giá
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
