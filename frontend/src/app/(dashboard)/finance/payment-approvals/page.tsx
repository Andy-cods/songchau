'use client';

/**
 * /finance/payment-approvals
 * ──────────────────────────
 * Accountant-side queue for payment_requests created by sales when they push a
 * sourcing order from `confirmed` → `payment_requested`. Sale-side users see a
 * read-only view of their own requests (backend auto-filters by requester_id).
 *
 * Restrained palette: slate base + brand (indigo) accent, functional
 * emerald/amber/rose only on KPI numbers and status badges. h-11 inputs,
 * [15px] body, text-xs labels.
 */

import { useMemo, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Filter,
  Inbox,
  ReceiptText,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { StatusBadge } from '@/components/shared/status-badge';
import { KPICard } from '@/components/shared/kpi-card';
import { TableSkeleton } from '@/components/shared/table-skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import {
  StatusPillRow,
  type StatusPillOption,
} from '@/components/shared/status-pill-row';
import {
  PaymentApprovalDrawer,
  type PaymentRequestStatus,
} from '@/components/payment-approvals/PaymentApprovalDrawer';
import { PageHeader } from '@/components/shared/page-header';

/* ─────────── Types ─────────── */

interface PaymentRequestRow {
  id: number;
  pr_number?: string | null;
  status: PaymentRequestStatus;
  amount_vnd?: number | null;
  amount?: number | null;
  beneficiary_name?: string | null;
  payment_method?: string | null;
  requester_email?: string | null;
  requester_name?: string | null;
  created_at?: string | null;
  decision_at?: string | null;

  sourcing_order_id?: number | null;
  sourcing_order?: {
    order_number?: string | null;
    customer_name?: string | null;
  } | null;
}

interface ListResponse {
  items?: PaymentRequestRow[];
  total?: number;
  data?: {
    items?: PaymentRequestRow[];
    total?: number;
  };
}

/* ─────────── Helpers ─────────── */

function fmtVnd(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Math.round(Number(v)).toLocaleString('vi-VN') + ' ₫';
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('vi-VN');
}

function shortName(email: string | null | undefined): string {
  if (!email) return '—';
  const name = email.split('@')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const STATUS_META: Record<
  PaymentRequestStatus,
  { label: string; variant: 'warning' | 'success' | 'danger' | 'info' }
> = {
  pending: { label: 'Chờ duyệt', variant: 'warning' },
  approved: { label: 'Đã duyệt', variant: 'success' },
  rejected: { label: 'Đã từ chối', variant: 'danger' },
  paid: { label: 'Đã chi', variant: 'info' },
};

type StatusValue = PaymentRequestStatus | 'all';

const STATUS_FILTERS: ReadonlyArray<StatusPillOption<StatusValue>> = [
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'approved', label: 'Đã duyệt' },
  { value: 'rejected', label: 'Đã từ chối' },
  { value: 'paid', label: 'Đã chi' },
  { value: 'all', label: 'Tất cả' },
];

function unwrapItems(data: ListResponse | undefined): PaymentRequestRow[] {
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items;
  const nested = data.data?.items;
  if (Array.isArray(nested)) return nested;
  // Defensive — some endpoints return the array directly.
  if (Array.isArray(data as unknown)) return data as unknown as PaymentRequestRow[];
  return [];
}

/* ─────────── Page ─────────── */

export default function PaymentApprovalsPage() {
  const { user } = useAuth();
  const role = (user?.role || '').toLowerCase();
  const isSalesOnly = role === 'sales';

  const [statusFilter, setStatusFilter] = useState<StatusValue>('pending');
  const [customerSearch, setCustomerSearch] = useState('');
  const [salesSearch, setSalesSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  /* ── Main list ─────────────────────────────────────────────── */
  const listQuery = useQuery<ListResponse>({
    queryKey: ['payment-requests', statusFilter, dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const qs = params.toString();
      return api.get('/api/v1/payment-requests' + (qs ? '?' + qs : ''));
    },
    refetchOnWindowFocus: false,
  });

  /* ── KPI counts (separate queries so they don't flash) ─────── */
  const pendingCountQuery = useQuery<ListResponse>({
    queryKey: ['payment-requests-count', 'pending'],
    queryFn: () =>
      api.get('/api/v1/payment-requests?status=pending&page_size=1'),
    refetchOnWindowFocus: false,
  });

  const last7Date = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }, []);

  const approved7Query = useQuery<ListResponse>({
    queryKey: ['payment-requests-count', 'approved-7', last7Date],
    queryFn: () =>
      api.get(
        '/api/v1/payment-requests?status=approved&date_from=' +
          last7Date +
          '&page_size=1',
      ),
    refetchOnWindowFocus: false,
  });

  const rejected7Query = useQuery<ListResponse>({
    queryKey: ['payment-requests-count', 'rejected-7', last7Date],
    queryFn: () =>
      api.get(
        '/api/v1/payment-requests?status=rejected&date_from=' +
          last7Date +
          '&page_size=1',
      ),
    refetchOnWindowFocus: false,
  });

  /* ── Filter rows client-side for customer & sales search ───── */
  const rows = useMemo(() => {
    const items = unwrapItems(listQuery.data);
    const cs = customerSearch.trim().toLowerCase();
    const ss = salesSearch.trim().toLowerCase();
    return items.filter((r) => {
      if (cs) {
        const cust = (
          r.sourcing_order?.customer_name || ''
        ).toLowerCase();
        if (!cust.includes(cs)) return false;
      }
      if (ss) {
        const sales = (
          r.requester_name || r.requester_email || ''
        ).toLowerCase();
        if (!sales.includes(ss)) return false;
      }
      return true;
    });
  }, [listQuery.data, customerSearch, salesSearch]);

  // Finding #15: narrowed locals instead of non-null assertions.
  const pendingItems = unwrapItems(pendingCountQuery.data);
  const pendingCount = pendingCountQuery.data?.total ?? pendingItems.length;
  const approved7Items = unwrapItems(approved7Query.data);
  const approved7Count = approved7Query.data?.total ?? approved7Items.length;
  const rejected7Items = unwrapItems(rejected7Query.data);
  const rejected7Count = rejected7Query.data?.total ?? rejected7Items.length;

  const refreshAll = () => {
    listQuery.refetch();
    pendingCountQuery.refetch();
    approved7Query.refetch();
    rejected7Query.refetch();
  };

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <PageHeader
        title="Duyệt thanh toán"
        subtitle="Đề xuất từ sales — kế toán quyết định"
        actions={
          <button
            type="button"
            onClick={refreshAll}
            disabled={listQuery.isFetching}
            aria-label="Tải lại danh sách"
            className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 text-sm font-semibold disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 transition-colors"
          >
            <RefreshCw
              className={cn(
                'h-4 w-4 text-slate-500',
                listQuery.isFetching && 'motion-safe:animate-spin',
              )}
              aria-hidden="true"
            />
            Tải lại
          </button>
        }
      />

      {/* ─── KPI strip (Finding #11: shared KPICard; #9: label leading-snug
            is in the shared component) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          icon={Clock}
          label="Chờ duyệt"
          value={pendingCount.toLocaleString('vi-VN')}
          tone="amber"
          loading={pendingCountQuery.isLoading}
        />
        <KPICard
          icon={CheckCircle2}
          label="Đã duyệt (7 ngày)"
          value={approved7Count.toLocaleString('vi-VN')}
          tone="emerald"
          loading={approved7Query.isLoading}
        />
        <KPICard
          icon={XCircle}
          label="Đã từ chối (7 ngày)"
          value={rejected7Count.toLocaleString('vi-VN')}
          tone="rose"
          loading={rejected7Query.isLoading}
        />
      </div>

      {/* ─── Filter bar ─── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Bộ lọc
          </span>
        </div>

        {/* Status pills — Finding #3: shared component has focus-follows-selection. */}
        <StatusPillRow<StatusValue>
          options={STATUS_FILTERS}
          value={statusFilter}
          onChange={setStatusFilter}
          ariaLabel="Lọc theo trạng thái"
        />

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Customer search */}
          <div className={cn(isSalesOnly ? 'md:col-span-8' : 'md:col-span-4')}>
            <label
              htmlFor="pa-customer-search"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Khách hàng
            </label>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="pa-customer-search"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Tên khách…"
                aria-label="Tìm theo khách hàng"
                className="w-full h-11 pl-10 pr-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition-colors"
              />
            </div>
          </div>

          {/* Sales search (hidden when sales-only — they only see their own) */}
          {!isSalesOnly && (
            <div className="md:col-span-4">
              <label
                htmlFor="pa-sales-search"
                className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Sale yêu cầu
              </label>
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="pa-sales-search"
                  value={salesSearch}
                  onChange={(e) => setSalesSearch(e.target.value)}
                  placeholder="Tên/email sale…"
                  aria-label="Tìm theo sale yêu cầu"
                  className="w-full h-11 pl-10 pr-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition-colors"
                />
              </div>
            </div>
          )}

          {/* Date range */}
          <div className="md:col-span-2">
            <label
              htmlFor="pa-date-from"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Từ ngày
            </label>
            <input
              id="pa-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition-colors"
            />
          </div>
          <div className="md:col-span-2">
            <label
              htmlFor="pa-date-to"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Đến ngày
            </label>
            <input
              id="pa-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* ─── Table ─── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {listQuery.isLoading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : listQuery.isError ? (
          <EmptyState
            variant="error"
            icon={AlertCircle}
            heading="Không tải được danh sách thanh toán"
            description="Vui lòng thử lại hoặc liên hệ quản trị viên nếu lỗi tiếp diễn."
            actionLabel="Thử lại"
            onAction={() => listQuery.refetch()}
          />
        ) : rows.length === 0 ? (
          <PaymentApprovalsEmpty
            isSales={isSalesOnly}
            statusFilter={statusFilter}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/60 border-b border-slate-100">
                  <th
                    scope="col"
                    className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5 w-[140px]"
                  >
                    PR
                  </th>
                  <th
                    scope="col"
                    className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                  >
                    Đơn
                  </th>
                  <th
                    scope="col"
                    className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                  >
                    Khách hàng
                  </th>
                  <th
                    scope="col"
                    className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                  >
                    Người thụ hưởng
                  </th>
                  <th
                    scope="col"
                    className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                  >
                    Số tiền
                  </th>
                  {!isSalesOnly && (
                    <th
                      scope="col"
                      className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                    >
                      Sale yêu cầu
                    </th>
                  )}
                  <th
                    scope="col"
                    className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                  >
                    Trạng thái
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const meta = STATUS_META[r.status];
                  const amount = r.amount_vnd ?? r.amount;
                  const customerName = r.sourcing_order?.customer_name || '';
                  const beneficiaryName = r.beneficiary_name || '';
                  const handleKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpenId(r.id);
                    }
                  };
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setOpenId(r.id)}
                      onKeyDown={handleKey}
                      role="button"
                      tabIndex={0}
                      aria-label={`Mở yêu cầu ${r.pr_number || 'PR-' + r.id}`}
                      className="hover:bg-slate-50/60 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-inset"
                    >
                      <td className="px-4 py-2.5 font-mono tabular-nums text-brand-600 font-semibold">
                        {r.pr_number || 'PR-' + r.id}
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-700">
                        {r.sourcing_order?.order_number || (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td
                        className="px-4 py-2.5 text-slate-900 max-w-[200px] truncate"
                        title={customerName || undefined}
                      >
                        {customerName || <span className="text-slate-300">—</span>}
                      </td>
                      <td
                        className="px-4 py-2.5 text-slate-700 max-w-[200px] truncate"
                        title={beneficiaryName || undefined}
                      >
                        {beneficiaryName || (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900">
                        {fmtVnd(amount)}
                      </td>
                      {!isSalesOnly && (
                        <td className="px-4 py-2.5 text-slate-700">
                          <div className="leading-snug">
                            {r.requester_name || shortName(r.requester_email)}
                          </div>
                          <div className="text-xs text-slate-400 leading-snug">
                            {fmtDate(r.created_at)}
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <StatusBadge
                          label={meta.label}
                          variant={meta.variant}
                          pulse={r.status === 'pending'}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Drawer ─── */}
      {openId != null && (
        <PaymentApprovalDrawer
          paymentRequestId={openId}
          onClose={() => setOpenId(null)}
          onMutated={refreshAll}
        />
      )}
    </div>
  );
}

/* ─────────── Sub-components ─────────── */

function PaymentApprovalsEmpty({
  isSales,
  statusFilter,
}: {
  isSales: boolean;
  statusFilter: StatusValue;
}) {
  const isPending = statusFilter === 'pending';
  const Icon = isSales ? ReceiptText : isPending ? Inbox : ReceiptText;
  const heading = isSales
    ? 'Bạn chưa có đề xuất TT nào'
    : isPending
      ? 'Không có yêu cầu chờ duyệt'
      : 'Không có dữ liệu phù hợp bộ lọc';
  const description = isSales
    ? 'Khi bạn đề xuất TT từ đơn hàng, nó sẽ xuất hiện ở đây.'
    : 'Thử đổi trạng thái hoặc bỏ bộ lọc.';
  return <EmptyState icon={Icon} heading={heading} description={description} />;
}
