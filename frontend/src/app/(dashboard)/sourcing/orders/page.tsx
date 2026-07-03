'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  Boxes,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Filter,
  Kanban,
  LayoutGrid,
  Loader2,
  Package,
  PackageCheck,
  PlusCircle,
  RefreshCw,
  Search,
  Send,
  ShoppingCart,
  Table as TableIcon,
  Truck,
  Wallet,
  X,
} from 'lucide-react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ORDER_STATUS_META,
  type OrderStatusCode,
} from '@/components/sourcing/SourcingFormDrawer';
import { SourcingOrderDetailDrawer } from '@/components/sourcing/SourcingOrderDetailDrawer';

/* ─────────── Types ─────────── */

interface OrderItemSummary {
  model?: string | null;
  product_name?: string | null;
  qty?: number | null;
}

interface OrderRow {
  id: number;
  order_number: string;
  status: OrderStatusCode;
  customer_name?: string | null;
  assigned_to_email?: string | null;
  total_value_vnd?: number | null;
  order_date?: string | null;
  updated_at?: string | null;
  // Backend persists `line_items` (JSONB). List endpoint may also expose `items`.
  // Read sites should fall back to either.
  line_items?: OrderItemSummary[];
  items?: OrderItemSummary[];
  // FIX (Thang 2026-06-15): per-row action buttons need these — quote_no from
  // source_ref_no when source_type=quote_batch, primary_supplier_name from order
  // detail / serializer. Both optional because list endpoint may not always
  // populate them.
  quote_no?: string | null;
  source_ref_no?: string | null;
  primary_supplier_name?: string | null;
}

interface OrdersListResponse {
  data: {
    items: OrderRow[];
    total: number;
    page: number;
    pages: number;
    counts_by_status?: Partial<Record<OrderStatusCode, number>>;
  };
}

type ViewMode = 'pipeline' | 'table';

interface BulkTransitionResult {
  order_id: number;
  order_number: string;
  success: boolean;
  error: string | null;
}

type BulkTransitionFailure = Pick<BulkTransitionResult, 'order_id' | 'order_number' | 'error'>;

const KANBAN_COLUMNS: OrderStatusCode[] = [
  'draft',
  'quoted',
  'confirmed',
  'payment_requested',
  'payment_approved',
  'shipped',
  'delivered',
];

const KPI_COLUMNS: OrderStatusCode[] = [
  'draft',
  'quoted',
  'confirmed',
  'payment_requested',
  'shipped',
  'delivered',
];

/* ─────────── Helpers ─────────── */

function fmtVnd(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return String(Math.round(v).toLocaleString('vi-VN')) + ' ₫';
}

function fmtCount(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString('vi-VN');
}

function daysSince(v: string | null | undefined): number | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function shortName(email: string | null | undefined): string {
  if (!email) return '—';
  const name = email.split('@')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/* ─────────── Page ─────────── */

export default function SourcingOrdersPage() {
  const [view, setView] = useState<ViewMode>('pipeline');
  const [searchInput, setSearchInput] = useState('');
  const [filterStatus, setFilterStatus] = useState<OrderStatusCode | ''>('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [drawerOrderId, setDrawerOrderId] = useState<number | null>(null);
  // Deep-link: open the order drawer when ?order_id= is present (e.g. arriving
  // from the CRM Hồ sơ "→ Đơn {n}" link). Runs once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const oid = new URLSearchParams(window.location.search).get('order_id');
    const n = oid != null ? Number(oid) : NaN;
    if (Number.isFinite(n) && n > 0) setDrawerOrderId(n);
  }, []);
  const [bulkTransitionTo, setBulkTransitionTo] = useState<OrderStatusCode | ''>('');
  const [bulkFailures, setBulkFailures] = useState<BulkTransitionFailure[]>([]);
  const [bulkFailuresOpen, setBulkFailuresOpen] = useState(true);

  const ordersQ = useQuery<OrdersListResponse['data']>({
    queryKey: [
      'sourcing-orders',
      searchInput,
      filterStatus,
      filterCustomer,
      dateFrom,
      dateTo,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page_size', '200');
      if (searchInput.trim()) params.set('q', searchInput.trim());
      if (filterStatus) params.set('status', filterStatus);
      if (filterCustomer.trim()) params.set('customer_name', filterCustomer.trim());
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const res = (await api.get(
        '/api/v1/sourcing/orders?' + params.toString(),
      )) as OrdersListResponse;
      return res.data;
    },
  });

  const orders = ordersQ.data?.items || [];

  const countsByStatus = useMemo<Record<OrderStatusCode, number>>(() => {
    const fromApi = ordersQ.data?.counts_by_status;
    const acc: Record<string, number> = {
      draft: 0,
      quoted: 0,
      confirmed: 0,
      payment_requested: 0,
      payment_approved: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
    };
    if (fromApi) {
      Object.assign(acc, fromApi);
    } else {
      for (const o of orders) acc[o.status] = (acc[o.status] || 0) + 1;
    }
    return acc as Record<OrderStatusCode, number>;
  }, [ordersQ.data, orders]);

  const ordersByStatus = useMemo(() => {
    const map: Record<OrderStatusCode, OrderRow[]> = {
      draft: [],
      quoted: [],
      confirmed: [],
      payment_requested: [],
      payment_approved: [],
      shipped: [],
      delivered: [],
      cancelled: [],
    };
    for (const o of orders) {
      if (map[o.status]) map[o.status].push(o);
    }
    return map;
  }, [orders]);

  const bulkTransitionMut = useMutation({
    mutationFn: async (vars: { ids: number[]; status: OrderStatusCode }) => {
      // Build a quick id -> order_number lookup so failures can be displayed
      // with the human-readable order number rather than the raw DB id.
      const orderNumberById = new Map<number, string>();
      for (const o of orders) orderNumberById.set(o.id, o.order_number);

      const settled = await Promise.allSettled(
        vars.ids.map((id) =>
          api
            .patch('/api/v1/sourcing/orders/' + id + '/status', {
              new_status: vars.status,
            })
            .then(() => id),
        ),
      );

      const results: BulkTransitionResult[] = settled.map((r, idx) => {
        const id = vars.ids[idx];
        const order_number = orderNumberById.get(id) || '#' + id;
        if (r.status === 'fulfilled') {
          return { order_id: id, order_number, success: true, error: null };
        }
        const reason: any = r.reason;
        // api.ts throws ApiError { detail, status_code }
        const message =
          (reason && (reason.detail || reason.message)) ||
          (typeof reason === 'string' ? reason : null) ||
          'Lỗi không xác định';
        return { order_id: id, order_number, success: false, error: message };
      });
      return results;
    },
    onSuccess: (results) => {
      const success = results.filter((r) => r.success);
      const failed: BulkTransitionFailure[] = results
        .filter((r) => !r.success)
        .map(({ order_id, order_number, error }) => ({ order_id, order_number, error }));

      const summary =
        success.length + ' đơn chuyển status thành công' +
        (failed.length > 0 ? ' · ' + failed.length + ' đơn thất bại' : '');

      if (success.length > 0) {
        toast.success(summary);
      } else {
        toast.error(summary);
      }

      if (failed.length > 0) {
        // Inline panel (rendered below) — also emit a second toast as a
        // peripheral cue so the user notices even if they look away.
        toast.error(
          failed.length === 1
            ? 'Đơn ' + failed[0].order_number + ' thất bại: ' + (failed[0].error || '')
            : failed.length + ' đơn thất bại — xem chi tiết bên dưới',
        );
        setBulkFailures(failed);
        setBulkFailuresOpen(true);
      } else {
        setBulkFailures([]);
      }

      setSelectedIds(new Set());
      setBulkTransitionTo('');
      ordersQ.refetch();
    },
    onError: (err: any) => {
      // Reached only if mutationFn itself throws (it shouldn't — allSettled
      // catches per-order failures). Kept as a safety net.
      toast.error(err?.detail || err?.message || 'Bulk update thất bại');
    },
  });

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ─────────── Per-row action handlers (Thang 2026-06-15) ───────────
   * Three buttons wired here, all originally dead in this list view:
   *  1. Xuất PDF báo giá — open quote-batch PDF for order.quote_no
   *  2. Khách đã đặt     — PATCH status → 'confirmed' (reuse existing endpoint)
   *  3. Đề xuất TT kế toán — POST /payment-approvals (NOT yet implemented in
   *     backend — shows a "chưa kích hoạt" toast and logs warn so we know to
   *     add the endpoint later; do NOT silently swallow). */
  const queryClient = useQueryClient();
  const [pendingActionId, setPendingActionId] = useState<{ id: number; kind: 'confirm' | 'payment' } | null>(null);

  const handleExportQuotePdf = (order: OrderRow) => {
    const quoteNo = order.quote_no || order.source_ref_no;
    if (!quoteNo) {
      toast.warning('Đơn này chưa có báo giá');
      return;
    }
    // Backend endpoint is /quote-batch/{quote_no}/download (verified locate phase).
    window.open(
      '/api/v1/sourcing/quote-batch/' + encodeURIComponent(quoteNo) + '/download',
      '_blank',
      'noopener,noreferrer',
    );
  };

  const handleConfirmOrder = async (order: OrderRow) => {
    if (order.status === 'confirmed') return;
    setPendingActionId({ id: order.id, kind: 'confirm' });
    try {
      await api.patch('/api/v1/sourcing/orders/' + order.id + '/status', {
        new_status: 'confirmed',
      });
      toast.success('Đã xác nhận khách đặt');
      await queryClient.invalidateQueries({ queryKey: ['sourcing-orders'] });
    } catch (err: any) {
      toast.error(err?.detail || err?.message || 'Không xác nhận được đơn');
    } finally {
      setPendingActionId(null);
    }
  };

  const handleProposePayment = async (order: OrderRow) => {
    if (order.status !== 'confirmed') {
      toast.warning("Chỉ có thể đề xuất TT khi đơn đã ở trạng thái 'Khách đã đặt'");
      return;
    }
    setPendingActionId({ id: order.id, kind: 'payment' });
    try {
      await api.post('/api/v1/sourcing/orders/' + order.id + '/payment-request', {
        payment_method: 'bank_transfer',
      });
      toast.success('Đã gửi đề xuất TT tới kế toán');
      await queryClient.invalidateQueries({ queryKey: ['sourcing-orders'] });
    } catch (err: any) {
      toast.error('Lỗi: ' + (err?.response?.data?.detail || err?.message || 'Không xác định'));
    } finally {
      setPendingActionId(null);
    }
  };

  const clearFilters = () => {
    setSearchInput('');
    setFilterStatus('');
    setFilterCustomer('');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilter =
    !!searchInput || !!filterStatus || !!filterCustomer || !!dateFrom || !!dateTo;

  return (
    <div className="space-y-6 pb-12">
      {/* ─────────── Header ─────────── */}
      <PageHeader
        icon={ShoppingCart}
        title={
          <span className="inline-flex items-center gap-2">
            Theo dõi đơn hàng
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200 align-middle">
              Quote → Order
            </span>
          </span>
        }
        subtitle={
          <>
            <span className="font-semibold tabular-nums text-slate-900">
              {fmtCount(ordersQ.data?.total)}
            </span>{' '}
            đơn · pipeline báo giá → khách chốt → thanh toán → giao hàng.
          </>
        }
        actions={
          <>
            <Link
              href="/sourcing"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              <ArrowLeft className="h-4 w-4 text-slate-500" />
              Quay lại thư viện
            </Link>
            <button
              type="button"
              onClick={() => ordersQ.refetch()}
              className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
              title="Tải lại"
            >
              <RefreshCw className={cn('h-4 w-4', ordersQ.isFetching && 'animate-spin')} />
            </button>
          </>
        }
      />

      {/* ─────────── KPI Strip ─────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {KPI_COLUMNS.map((s) => {
          const meta = ORDER_STATUS_META[s];
          const Icon = meta.icon;
          const count = countsByStatus[s] || 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className={cn(
                'group rounded-xl border bg-white p-4 text-left transition-all shadow-sm',
                filterStatus === s
                  ? 'border-brand-300 ring-2 ring-brand-200'
                  : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={cn(
                    'h-7 w-7 rounded-md flex items-center justify-center ring-1',
                    meta.badgeClass,
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  {meta.label}
                </span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-slate-900">{fmtCount(count)}</div>
            </button>
          );
        })}
      </div>

      {/* ─────────── Toolbar: search + filters + view toggle ─────────── */}
      <section className="sticky top-0 z-20 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur shadow-sm">
        <div className="p-4 flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm mã đơn / khách / sale..."
              className="w-full pl-10 pr-9 py-2.5 border border-slate-200 bg-white rounded-lg text-[15px] focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <input
            value={filterCustomer}
            onChange={(e) => setFilterCustomer(e.target.value)}
            placeholder="Khách hàng..."
            className="h-11 px-3 border border-slate-200 bg-white rounded-lg text-sm focus:outline-none focus:border-brand-400"
          />

          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-transparent text-sm text-slate-700 outline-none"
            />
            <span className="text-slate-400">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-transparent text-sm text-slate-700 outline-none"
            />
          </div>

          {hasActiveFilter && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 ring-1 ring-rose-200"
            >
              <X className="h-3.5 w-3.5" /> Xoá lọc
            </button>
          )}

          {/* View toggle */}
          <div className="ml-auto inline-flex items-center rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setView('pipeline')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-bold transition-colors',
                view === 'pipeline' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              <Kanban className="h-4 w-4" />
              Pipeline
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-bold transition-colors',
                view === 'table' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              <TableIcon className="h-4 w-4" />
              Bảng
            </button>
          </div>
        </div>
      </section>

      {/* ─────────── Bulk action bar ─────────── */}
      {selectedIds.size > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-3.5 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-bold text-emerald-900">
            <CheckCircle2 className="h-4 w-4" /> {selectedIds.size} đơn đã chọn
          </span>
          <select
            value={bulkTransitionTo}
            onChange={(e) => setBulkTransitionTo(e.target.value as OrderStatusCode | '')}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none"
          >
            <option value="">— Chọn trạng thái —</option>
            {KANBAN_COLUMNS.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_META[s].label}
              </option>
            ))}
            <option value="cancelled">Huỷ</option>
          </select>
          <button
            type="button"
            disabled={!bulkTransitionTo || bulkTransitionMut.isPending}
            onClick={() =>
              bulkTransitionMut.mutate({
                ids: Array.from(selectedIds),
                status: bulkTransitionTo as OrderStatusCode,
              })
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 disabled:opacity-50"
          >
            {bulkTransitionMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Áp dụng
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-2 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-100"
          >
            Bỏ chọn
          </button>
        </div>
      )}

      {/* ─────────── Bulk transition failures ─────────── */}
      {bulkFailures.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-5 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setBulkFailuresOpen((v) => !v)}
              className="inline-flex items-center gap-2 text-sm font-bold text-rose-900"
            >
              {bulkFailuresOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <AlertCircle className="h-4 w-4" />
              {bulkFailures.length} đơn không chuyển được status
            </button>
            <button
              type="button"
              onClick={() => setBulkFailures([])}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              title="Đóng"
            >
              <X className="h-3.5 w-3.5" /> Đóng
            </button>
          </div>
          {bulkFailuresOpen && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {bulkFailures.map((f) => (
                <li
                  key={f.order_id}
                  className="flex items-start gap-2 rounded-md bg-white/70 px-3 py-2 ring-1 ring-rose-200"
                >
                  <span className="font-mono font-bold text-rose-900 shrink-0">
                    {f.order_number}
                  </span>
                  <span className="text-rose-400">:</span>
                  <span className="text-rose-800 break-words">
                    {f.error || 'Lỗi không xác định'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ─────────── Loading / error ─────────── */}
      {ordersQ.isLoading && (
        <div className="space-y-3 py-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {ordersQ.isError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50">
          <EmptyState
            variant="error"
            heading="Không tải được danh sách đơn."
            actionLabel="Thử lại"
            onAction={() => ordersQ.refetch()}
          />
        </div>
      )}

      {/* ─────────── Content ─────────── */}
      {!ordersQ.isLoading && !ordersQ.isError && orders.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-20 text-center">
          <div className="mx-auto h-24 w-24 rounded-3xl bg-brand-50 ring-1 ring-brand-100 flex items-center justify-center mb-5">
            <Boxes className="h-12 w-12 text-brand-600" strokeWidth={1.8} />
          </div>
          <h3 className="text-xl font-bold text-slate-900">
            Chưa có đơn hàng nào
          </h3>
          <p className="mt-2 text-[15px] text-slate-600 max-w-md mx-auto leading-relaxed">
            Tạo đơn đầu tiên từ một entry sourcing — mở entry và nhấn{' '}
            <span className="font-semibold text-slate-800">"Khách đã đặt"</span> để
            chuyển báo giá thành đơn hàng.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/sourcing"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              <PlusCircle className="h-4 w-4" />
              Mở thư viện sourcing
            </Link>
            <Link
              href="/sourcing"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Tìm hiểu quy trình
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </Link>
          </div>
        </div>
      )}

      {!ordersQ.isLoading && view === 'pipeline' && orders.length > 0 && (
        <PipelineView
          ordersByStatus={ordersByStatus}
          onCardClick={(id) => setDrawerOrderId(id)}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      )}

      {!ordersQ.isLoading && view === 'table' && orders.length > 0 && (
        <TableView
          orders={orders}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onRowClick={(id) => setDrawerOrderId(id)}
          onExportPdf={handleExportQuotePdf}
          onConfirmOrder={handleConfirmOrder}
          onProposePayment={handleProposePayment}
          pendingActionId={pendingActionId}
        />
      )}

      {/* Drawer */}
      {drawerOrderId != null && (
        <SourcingOrderDetailDrawer
          orderId={drawerOrderId}
          onClose={() => setDrawerOrderId(null)}
          onMutated={() => ordersQ.refetch()}
        />
      )}
    </div>
  );
}

/* ─────────── Pipeline (Kanban) ─────────── */

function PipelineView({
  ordersByStatus,
  onCardClick,
  selectedIds,
  onToggleSelect,
}: {
  ordersByStatus: Record<OrderStatusCode, OrderRow[]>;
  onCardClick: (id: number) => void;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
}) {
  return (
    <div className="overflow-x-auto pb-3 -mx-2 px-2">
      <div className="flex gap-4 min-w-full" style={{ minWidth: '1400px' }}>
        {KANBAN_COLUMNS.map((status) => {
          const meta = ORDER_STATUS_META[status];
          const Icon = meta.icon;
          const items = ordersByStatus[status] || [];
          return (
            <div
              key={status}
              className="flex-1 min-w-[220px] rounded-xl border border-slate-200 bg-slate-50/60"
            >
              <header className="flex items-center justify-between px-3 py-3 border-b border-slate-200 sticky top-0 bg-slate-50/95 backdrop-blur rounded-t-xl z-10">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      'h-7 w-7 rounded-md flex items-center justify-center ring-1',
                      meta.badgeClass,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-bold text-slate-900 truncate">{meta.label}</span>
                </div>
                <span className="text-xs font-bold tabular-nums text-slate-500 bg-white ring-1 ring-slate-200 rounded-md px-1.5 py-0.5">
                  {items.length}
                </span>
              </header>
              <div className="p-2 space-y-2 max-h-[640px] overflow-y-auto">
                {items.length === 0 && (
                  <div className="text-xs text-slate-400 italic text-center py-6">
                    Trống
                  </div>
                )}
                {items.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onClick={() => onCardClick(order.id)}
                    selected={selectedIds.has(order.id)}
                    onToggleSelect={() => onToggleSelect(order.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrderCard({
  order,
  onClick,
  selected,
  onToggleSelect,
}: {
  order: OrderRow;
  onClick: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const itemList = order.line_items ?? order.items ?? [];
  const firstItem = itemList[0];
  const days = daysSince(order.updated_at || order.order_date);
  return (
    <div
      className={cn(
        'group rounded-lg bg-white ring-1 px-3 py-2.5 cursor-pointer transition-all hover:shadow-sm',
        selected ? 'ring-brand-400 bg-brand-50/30' : 'ring-slate-200 hover:ring-slate-300',
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-900 truncate">
            {order.customer_name || '—'}
          </div>
          <div className="text-[11px] font-mono text-slate-500 truncate">
            {order.order_number}
          </div>
        </div>
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggleSelect}
          className="h-4 w-4 accent-brand-600 cursor-pointer shrink-0"
        />
      </div>
      {firstItem && (
        <div className="text-xs text-slate-600 mt-1 truncate">
          <span className="font-mono font-semibold text-slate-700">
            {firstItem.model || firstItem.product_name || '—'}
          </span>
          {firstItem.qty != null && (
            <span className="text-slate-500"> × {firstItem.qty}</span>
          )}
          {itemList.length > 1 && (
            <span className="text-slate-400"> · +{itemList.length - 1}</span>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold tabular-nums text-brand-700">
          {fmtVnd(order.total_value_vnd)}
        </span>
        {days != null && (
          <span className="text-[11px] text-slate-500">
            {days === 0 ? 'hôm nay' : days + 'd'}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─────────── Table view ─────────── */

function TableView({
  orders,
  selectedIds,
  onToggleSelect,
  onRowClick,
  onExportPdf,
  onConfirmOrder,
  onProposePayment,
  pendingActionId,
}: {
  orders: OrderRow[];
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onRowClick: (id: number) => void;
  onExportPdf: (order: OrderRow) => void;
  onConfirmOrder: (order: OrderRow) => void | Promise<void>;
  onProposePayment: (order: OrderRow) => void | Promise<void>;
  pendingActionId: { id: number; kind: 'confirm' | 'payment' } | null;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-[15px]">
          <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
            <tr>
              <th className="px-3 py-3 w-8"></th>
              <th className="px-3 py-3 text-left">Mã đơn</th>
              <th className="px-3 py-3 text-left">Khách hàng</th>
              <th className="px-3 py-3 text-left">Sale</th>
              <th className="px-3 py-3 text-left">Trạng thái</th>
              <th className="px-3 py-3 text-right">Tổng VND</th>
              <th className="px-3 py-3 text-left">Ngày tạo</th>
              <th className="px-3 py-3 text-left">Hành động</th>
              <th className="px-3 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const meta = ORDER_STATUS_META[order.status];
              const Icon = meta.icon;
              const confirmed = order.status === 'confirmed';
              const isConfirming =
                pendingActionId?.id === order.id && pendingActionId.kind === 'confirm';
              const isProposing =
                pendingActionId?.id === order.id && pendingActionId.kind === 'payment';
              const hasQuote = !!(order.quote_no || order.source_ref_no);
              return (
                <tr
                  key={order.id}
                  onClick={() => onRowClick(order.id)}
                  className={cn(
                    'border-b border-slate-100 cursor-pointer transition-colors',
                    selectedIds.has(order.id) ? 'bg-brand-50/40' : 'hover:bg-slate-50',
                  )}
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(order.id)}
                      onChange={() => onToggleSelect(order.id)}
                      className="h-4 w-4 accent-brand-600 cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-3 font-mono font-semibold text-slate-800">
                    {order.order_number}
                  </td>
                  <td className="px-3 py-3 font-semibold text-slate-900">
                    {order.customer_name || '—'}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {shortName(order.assigned_to_email)}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md text-xs font-bold ring-1 px-2 py-0.5',
                        meta.badgeClass,
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-bold text-slate-900">
                    {fmtVnd(order.total_value_vnd)}
                  </td>
                  <td className="px-3 py-3 text-slate-600 tabular-nums">
                    {order.order_date
                      ? new Date(order.order_date).toLocaleDateString('vi-VN')
                      : '—'}
                  </td>
                  <td
                    className="px-3 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onExportPdf(order)}
                        disabled={!hasQuote}
                        title={hasQuote ? 'Xuất PDF báo giá' : 'Đơn này chưa có báo giá'}
                        className="inline-flex items-center gap-1 rounded-md ring-1 ring-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-brand-700 hover:ring-brand-200 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        PDF báo giá
                      </button>
                      <button
                        type="button"
                        onClick={() => onConfirmOrder(order)}
                        disabled={confirmed || isConfirming}
                        title={
                          confirmed
                            ? 'Đơn đã được xác nhận'
                            : 'Xác nhận khách đã đặt'
                        }
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md ring-1 px-2 py-1 text-xs font-semibold transition-colors',
                          confirmed
                            ? 'ring-emerald-200 bg-emerald-50 text-emerald-700 cursor-default'
                            : 'ring-slate-200 bg-white text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 hover:ring-emerald-200',
                          (isConfirming || confirmed) && 'cursor-not-allowed',
                        )}
                      >
                        {isConfirming ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <BadgeCheck className="h-3.5 w-3.5" />
                        )}
                        {confirmed ? 'Đã đặt' : 'Khách đã đặt'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onProposePayment(order)}
                        disabled={isProposing}
                        title="Đề xuất thanh toán tới kế toán"
                        className="inline-flex items-center gap-1 rounded-md ring-1 ring-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-brand-700 hover:ring-brand-200 disabled:opacity-60 disabled:cursor-wait"
                      >
                        {isProposing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Đề xuất TT
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Suppress unused-icon warnings (kept for design consistency / future use)
const _unused: ReactNode = (
  <span style={{ display: 'none' }}>
    <ClipboardList />
    <Filter />
    <LayoutGrid />
    <Package />
    <PackageCheck />
    <Truck />
    <Wallet />
  </span>
);
void _unused;
