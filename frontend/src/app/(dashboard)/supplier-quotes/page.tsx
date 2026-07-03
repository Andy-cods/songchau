'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus, Search, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
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
import type { StatusVariant } from '@/lib/constants';

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

const STATUS_CONFIG: Record<SupplierQuoteStatus, { label: string; variant: StatusVariant }> = {
  draft:     { label: 'Nháp',           variant: 'neutral' },
  requested: { label: 'Đã gửi yêu cầu', variant: 'info' },
  received:  { label: 'Đã nhận báo giá', variant: 'warning' },
  accepted:  { label: 'Chấp nhận',      variant: 'success' },
  rejected:  { label: 'Từ chối',        variant: 'danger' },
};

const ALL_STATUSES: SupplierQuoteStatus[] = ['draft', 'requested', 'received', 'accepted', 'rejected'];

// ─── Helpers ───────────────────────────────────────────────────────

function MarginBadge({ pct }: { pct: number }) {
  const cls =
    pct >= 15 ? 'text-emerald-700 bg-emerald-50' :
    pct >= 5  ? 'text-amber-700 bg-amber-50' :
                'text-rose-700 bg-rose-50';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${cls}`}>
      {Number(pct ?? 0).toFixed(1)}%
    </span>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-4 w-24 ml-auto" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
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

  // Handle both {items:[]} and {data:{items:[]}} response shapes
  const quotesRaw = data?.items ?? (data as any)?.data?.items ?? (data as any)?.data ?? [];
  const quotes = (Array.isArray(quotesRaw) ? quotesRaw : []).filter((q: SupplierQuote) => {
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
      <PageHeader
        title="Báo giá nhà cung cấp"
        subtitle="Quản lý tất cả báo giá từ nhà cung cấp"
        icon={FileText}
        className="mb-6"
        actions={
          <Link
            href="/supplier-quotes/new"
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Tạo báo giá NCC
          </Link>
        }
      />

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
      <Card padded={false} className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : error ? (
          <EmptyState
            variant="error"
            icon={FileText}
            heading="Không tải được báo giá NCC"
            description="Đã có lỗi xảy ra. Vui lòng thử lại."
          />
        ) : quotes.length === 0 ? (
          <EmptyState
            icon={FileText}
            heading="Chưa có báo giá NCC nào"
            description='Bấm "Tạo báo giá NCC" để bắt đầu'
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Số báo giá</TableHead>
                <TableHead>Nhà cung cấp</TableHead>
                <TableHead>Ref RFQ</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Tổng (CNY)</TableHead>
                <TableHead className="text-center">Margin</TableHead>
                <TableHead>Ngày cập nhật</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q: SupplierQuote) => {
                const sc = STATUS_CONFIG[q.status];
                return (
                  <TableRow
                    key={q.id}
                    onClick={() => router.push(`/supplier-quotes/${q.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <span className="text-sm font-mono font-medium text-brand-600">{q.quote_number}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-700">{q.supplier.name}</span>
                    </TableCell>
                    <TableCell>
                      {q.rfq_number ? (
                        <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{q.rfq_number}</span>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge variant={sc.variant} label={sc.label} />
                    </TableCell>
                    <TableCell className="text-right">
                      {q.total_amount_cny != null ? (
                        <span className="text-sm font-mono text-slate-900">
                          {(q.total_amount_cny ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {q.margin_percent != null ? (
                        <MarginBadge pct={q.margin_percent} />
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-500">{formatDate(q.updated_at)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {data && (data.total ?? (data as any)?.data?.total ?? 0) > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>Hiển thị {quotes.length} / {data.total ?? (data as any)?.data?.total ?? 0} báo giá</span>
          <span>Trang {data.page ?? 1} / {data.total_pages ?? 1}</span>
        </div>
      )}
    </div>
  );
}
