'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Receipt,
  Plus,
  Search,
  AlertTriangle,
  TrendingUp,
  Clock,
  Wallet,
  Filter,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { KPICard } from '@/components/shared/kpi-card';
import { TableSkeleton } from '@/components/shared/table-skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import {
  StatusPillRow,
  type StatusPillOption,
} from '@/components/shared/status-pill-row';
import { PageHeader } from '@/components/shared/page-header';

// ─── Types ──────────────────────────────────────────────────────────

type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled';

interface Invoice {
  id: number;
  invoice_number: string;
  customer_name: string;
  total_amount_vnd: number;
  paid_amount_vnd: number;
  status: InvoiceStatus;
  due_date?: string;
  issued_date: string;
}

interface InvoiceStats {
  total_outstanding_vnd: number;
  overdue_count: number;
  this_month_revenue_vnd: number;
}

interface ApiResponse {
  items?: Invoice[];
  total?: number;
  page?: number;
  total_pages?: number;
  stats?: InvoiceStats;
  data?: {
    items?: Invoice[];
    total?: number;
    stats?: InvoiceStats;
  };
}

// ─── Status Config ──────────────────────────────────────────────────

type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'muted';

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; tone: StatusTone }> = {
  draft:     { label: 'Nháp',           tone: 'neutral' },
  sent:      { label: 'Đã gửi',         tone: 'info' },
  partial:   { label: 'TT một phần',    tone: 'warning' },
  paid:      { label: 'Đã thanh toán',  tone: 'success' },
  overdue:   { label: 'Quá hạn',        tone: 'danger' },
  cancelled: { label: 'Đã hủy',         tone: 'muted' },
};

const TONE_BADGE: Record<StatusTone, string> = {
  neutral: 'bg-slate-50 text-slate-700 ring-slate-200',
  info:    'bg-sky-50 text-sky-700 ring-sky-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  danger:  'bg-rose-50 text-rose-700 ring-rose-200',
  muted:   'bg-slate-50 text-slate-400 ring-slate-200',
};

const ALL_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'];

// ─── Helpers ────────────────────────────────────────────────────────

function isOverdue(invoice: Invoice): boolean {
  if (invoice.status === 'paid' || invoice.status === 'cancelled') return false;
  if (!invoice.due_date) return false;
  return new Date(invoice.due_date) < new Date();
}

function formatVND(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return amount.toLocaleString('vi-VN') + '₫';
}

// ─── Stats Strip ────────────────────────────────────────────────────

function StatsCards({ stats, loading }: { stats?: InvoiceStats; loading?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <KPICard
        label="Công nợ chưa thu"
        value={stats ? formatVND(stats.total_outstanding_vnd) : '—'}
        icon={Wallet}
        tone="brand"
        loading={loading}
      />
      <KPICard
        label="Hóa đơn quá hạn"
        value={stats ? (stats.overdue_count ?? 0).toLocaleString('vi-VN') : '—'}
        sub="hóa đơn"
        icon={AlertTriangle}
        tone="rose"
        loading={loading}
      />
      <KPICard
        label="Doanh thu tháng này"
        value={stats ? formatVND(stats.this_month_revenue_vnd) : '—'}
        icon={TrendingUp}
        tone="brand"
        loading={loading}
      />
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function InvoicesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  // Defer the search input for snappier typing — filtering happens on the
  // last "stable" value (Finding #14).
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');

  const { data, isLoading, error, refetch, isFetching } = useQuery<ApiResponse>({
    queryKey: ['invoices', statusFilter],
    queryFn: () =>
      api.get('/api/v1/invoices' + (statusFilter !== 'all' ? `?status=${statusFilter}` : '')),
    retry: false,
  });

  // Unwrap dual-shape response.
  const invoicesRaw: Invoice[] = useMemo(() => {
    const top = data?.items;
    if (Array.isArray(top)) return top;
    const nested = data?.data?.items;
    if (Array.isArray(nested)) return nested;
    const dataField = data?.data;
    if (Array.isArray(dataField)) return dataField as Invoice[];
    return [];
  }, [data]);

  // Finding #14: memoize the filtered list keyed on deferredSearch + raw data.
  const invoices = useMemo(() => {
    if (!deferredSearch) return invoicesRaw;
    const s = deferredSearch.toLowerCase();
    return invoicesRaw.filter(
      (inv) =>
        inv.invoice_number.toLowerCase().includes(s) ||
        inv.customer_name.toLowerCase().includes(s),
    );
  }, [invoicesRaw, deferredSearch]);

  const stats = data?.stats ?? data?.data?.stats;
  const total = data?.total ?? data?.data?.total ?? 0;
  const page = data?.page ?? 1;
  const totalPages = data?.total_pages ?? 1;

  const pillOptions: ReadonlyArray<StatusPillOption<InvoiceStatus | 'all'>> = useMemo(
    () => [
      { value: 'all', label: 'Tất cả' },
      ...ALL_STATUSES.map((s) => ({
        value: s as InvoiceStatus | 'all',
        label: STATUS_CONFIG[s].label,
      })),
    ],
    [],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Hóa đơn"
        subtitle="Quản lý hóa đơn và công nợ khách hàng"
        icon={Receipt}
        actions={
          <Link
            href="/invoices/new"
            className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-semibold shadow-sm shadow-brand-600/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 transition-colors"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Tạo hóa đơn
          </Link>
        }
      />

      {/* KPI Strip */}
      <StatsCards stats={stats} loading={isLoading && !stats} />

      {/* Filter Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Bộ lọc
          </span>
        </div>

        {/* Finding #4: shared StatusPillRow (focus follows selection). */}
        <StatusPillRow<InvoiceStatus | 'all'>
          options={pillOptions}
          value={statusFilter}
          onChange={setStatusFilter}
          ariaLabel="Lọc theo trạng thái"
        />

        <div>
          <label htmlFor="invoice-search" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Tìm kiếm
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input
              id="invoice-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm số hóa đơn hoặc khách hàng…"
              aria-label="Tìm kiếm hóa đơn"
              className="w-full h-11 pl-10 pr-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : error ? (
          /* Finding #6: error path is split — role="alert" + AlertTriangle + retry. */
          <EmptyState
            variant="error"
            heading="Không thể tải hóa đơn"
            description="Vui lòng thử lại sau hoặc liên hệ quản trị viên nếu lỗi tiếp diễn."
            actionLabel={isFetching ? 'Đang thử lại…' : 'Thử lại'}
            onAction={() => refetch()}
          />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={Receipt}
            heading="Chưa có hóa đơn nào"
            description="Tạo hóa đơn mới để bắt đầu quản lý công nợ."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/60 border-b border-slate-100">
                  <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                    Số HĐ
                  </th>
                  <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                    Khách hàng
                  </th>
                  <th scope="col" className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                    Tổng tiền
                  </th>
                  <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                    Trạng thái
                  </th>
                  <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                    Hạn TT
                  </th>
                  <th scope="col" className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                    Đã thanh toán
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => {
                  const overdue = isOverdue(inv);
                  // Finding #8: when overdue, override the status tone to
                  // "danger" so the table cell reflects the actual risk —
                  // a "Đã gửi" invoice 60 days past due should not look info-blue.
                  const sc = STATUS_CONFIG[inv.status];
                  const effectiveTone: StatusTone = overdue ? 'danger' : sc.tone;
                  const effectiveLabel = overdue ? 'Quá hạn' : sc.label;
                  const fullyPaid = inv.paid_amount_vnd >= inv.total_amount_vnd;
                  const handleOpen = () => router.push(`/invoices/${inv.id}`);
                  // Finding #8: prefix "Quá hạn — " to row aria-label.
                  const rowLabel = overdue
                    ? `Quá hạn — Mở hóa đơn ${inv.invoice_number}`
                    : `Mở hóa đơn ${inv.invoice_number}`;
                  return (
                    <tr
                      key={inv.id}
                      onClick={handleOpen}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleOpen();
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={rowLabel}
                      className={`hover:bg-slate-50/60 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 ${
                        overdue ? 'bg-rose-50/40' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <span className="text-sm font-mono font-semibold text-brand-600">
                          {inv.invoice_number}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-sm text-slate-700 truncate block max-w-[260px] leading-snug"
                          title={inv.customer_name}
                        >
                          {inv.customer_name}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm font-mono tabular-nums text-slate-900">
                          {formatVND(inv.total_amount_vnd)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ring-1 ring-inset ${TONE_BADGE[effectiveTone]}`}
                        >
                          {effectiveLabel}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {inv.due_date ? (
                          <span
                            className={`text-sm inline-flex items-center gap-1 leading-snug ${
                              overdue ? 'text-rose-600 font-medium' : 'text-slate-500'
                            }`}
                          >
                            {overdue ? (
                              <>
                                <span className="sr-only">Quá hạn —</span>
                                <AlertTriangle className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" />
                              </>
                            ) : (
                              <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                            )}
                            {formatDate(inv.due_date)}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span
                          className={`text-sm font-mono tabular-nums ${
                            fullyPaid ? 'text-emerald-600 font-semibold' : 'text-slate-700'
                          }`}
                        >
                          {formatVND(inv.paid_amount_vnd)}
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

      {data && total > 0 && (
        <div className="flex items-center justify-between mt-4 px-1 text-sm text-slate-500">
          <span>
            Hiển thị {invoices.length} / {total} hóa đơn
          </span>
          <span>
            Trang {page} / {totalPages}
          </span>
        </div>
      )}
    </div>
  );
}
