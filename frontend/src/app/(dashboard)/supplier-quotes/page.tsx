'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus, Search, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────

type SupplierQuoteStatus = 'draft' | 'requested' | 'received' | 'accepted' | 'rejected';

interface SupplierQuote {
  id: number;
  quote_number: string;
  supplier: { id: number; name: string };
  rfq_number?: string;
  status: SupplierQuoteStatus;
  total_amount_cny?: number;
  margin_percent?: number;
  created_at: string;
  updated_at: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  total_pages: number;
}

// ─── Status Config ─────────────────────────────────────────────────

const STATUS_CONFIG: Record<SupplierQuoteStatus, { label: string; className: string }> = {
  draft:     { label: 'Nháp',        className: 'bg-slate-100 text-slate-600' },
  requested: { label: 'Đã gửi yêu cầu', className: 'bg-blue-100 text-blue-700' },
  received:  { label: 'Đã nhận báo giá', className: 'bg-amber-100 text-amber-700' },
  accepted:  { label: 'Chấp nhận',   className: 'bg-green-100 text-green-700' },
  rejected:  { label: 'Từ chối',     className: 'bg-red-100 text-red-700' },
};

const ALL_STATUSES: SupplierQuoteStatus[] = ['draft', 'requested', 'received', 'accepted', 'rejected'];

// ─── Helpers ───────────────────────────────────────────────────────

function MarginBadge({ pct }: { pct: number }) {
  const cls =
    pct >= 15 ? 'text-green-700 bg-green-50' :
    pct >= 5  ? 'text-amber-700 bg-amber-50' :
                'text-red-700 bg-red-50';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${cls}`}>
      {pct.toFixed(1)}%
    </span>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-36 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-24 bg-slate-200 rounded-full animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse ml-auto" />
          <div className="h-4 w-16 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-300">
      <FileText className="h-12 w-12 mb-3" />
      <p className="text-sm text-slate-400 font-medium">Chưa có báo giá NCC nào</p>
      <p className="text-xs text-slate-400 mt-1">Bấm "Tạo báo giá NCC" để bắt đầu</p>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function SupplierQuotesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SupplierQuoteStatus | 'all'>('all');

  const { data, isLoading, error } = useQuery<PaginatedResponse<SupplierQuote>>({
    queryKey: ['supplier-quotes', statusFilter],
    queryFn: () =>
      api.get('/api/v1/supplier-quotes' + (statusFilter !== 'all' ? `?status=${statusFilter}` : '')),
    retry: false,
  });

  const quotes = (data?.items ?? []).filter((q) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      q.quote_number.toLowerCase().includes(s) ||
      q.supplier.name.toLowerCase().includes(s) ||
      (q.rfq_number ?? '').toLowerCase().includes(s)
    );
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Báo giá nhà cung cấp</h2>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý tất cả báo giá từ nhà cung cấp</p>
        </div>
        <Link
          href="/supplier-quotes/new"
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          Tạo báo giá NCC
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm số báo giá, NCC, RFQ..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Tất cả
          </button>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : error || quotes.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số báo giá</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Nhà cung cấp</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Ref RFQ</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Trạng thái</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Tổng (CNY)</th>
                  <th className="text-center text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Margin</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Ngày cập nhật</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {quotes.map((q) => {
                  const sc = STATUS_CONFIG[q.status];
                  return (
                    <tr
                      key={q.id}
                      onClick={() => router.push(`/supplier-quotes/${q.id}`)}
                      className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono font-medium text-brand-600">{q.quote_number}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-700">{q.supplier.name}</span>
                      </td>
                      <td className="px-4 py-3">
                        {q.rfq_number ? (
                          <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{q.rfq_number}</span>
                        ) : (
                          <span className="text-sm text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.className}`}>{sc.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {q.total_amount_cny != null ? (
                          <span className="text-sm font-mono text-slate-900">
                            {q.total_amount_cny.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {q.margin_percent != null ? (
                          <MarginBadge pct={q.margin_percent} />
                        ) : (
                          <span className="text-sm text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-500">{formatDate(q.updated_at)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>Hiển thị {quotes.length} / {data.total} báo giá</span>
          <span>Trang {data.page} / {data.total_pages}</span>
        </div>
      )}
    </div>
  );
}
