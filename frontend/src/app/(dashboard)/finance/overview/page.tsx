'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertTriangle,
  RefreshCw,
  Inbox,
  CreditCard,
  DollarSign,
  Plus,
  Save,
  Loader2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { KPICard } from '@/components/shared/kpi-card';
import { TableSkeleton } from '@/components/shared/table-skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';

// ─── Constants ───────────────────────────────────────────────────

/** Auto-refresh cadence (ms) for the finance overview queries. */
const REFRESH_INTERVAL_MS = 30_000;

/** Max width (px) for the cash-book create modal. */
const MODAL_MAX_W = 480;

// ─── Types ──────────────────────────────────────────────────────

interface AgingBuckets {
  current?: number;
  '0_30'?: number;
  '30_days'?: number;
  '30_60'?: number;
  '60_days'?: number;
  '60_90'?: number;
  '90_plus'?: number;
  'over_90'?: number;
}

/** Accounts-Receivable row (customer-side). */
interface ARRow {
  ar_id?: number | string;
  customer_name?: string | null;
  client_name?: string | null;
  invoice_number?: string | null;
  amount?: number | null;
  due_date?: string | null;
  received_amount?: number | null;
  paid_amount?: number | null;
  days_overdue?: number | null;
  status?: string | null;
}

/** Accounts-Payable row (supplier-side). */
interface APRow {
  ap_id?: number | string;
  supplier_name?: string | null;
  invoice_number?: string | null;
  amount?: number | null;
  due_date?: string | null;
  paid_amount?: number | null;
  days_overdue?: number | null;
  status?: string | null;
}

interface CashBookEntry {
  id?: number | string;
  date?: string | null;
  transaction_date?: string | null;
  type?: string | null;
  amount?: number | null;
  amount_in?: number | null;
  amount_out?: number | null;
  balance?: number | null;
  running_balance?: number | null;
  description?: string | null;
  note?: string | null;
}

interface CashFlowPoint {
  income?: number;
  expense?: number;
  ar?: number;
  ap?: number;
  net?: number;
  net_cash?: number;
}

interface DashboardData {
  total_ar?: number;
  total_ap?: number;
  cash_balance?: number;
  cash?: number;
  ap_aging?: AgingBuckets;
  ar_aging?: AgingBuckets;
}

interface APResponse {
  total?: number;
  aging?: AgingBuckets;
  by_supplier?: APRow[];
  items?: APRow[];
}

interface ARResponse {
  total?: number;
  aging?: AgingBuckets;
  by_customer?: ARRow[];
  items?: ARRow[];
}

// ─── Helpers ────────────────────────────────────────────────────

function fmtVnd(value?: number | null): string {
  if (value == null) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000)
    return sign + new Intl.NumberFormat('vi-VN').format(Math.round(abs / 1_000_000_000)) + ' tỷ';
  if (abs >= 1_000_000)
    return sign + new Intl.NumberFormat('vi-VN').format(Math.round(abs / 1_000_000)) + ' tr';
  return sign + new Intl.NumberFormat('vi-VN').format(abs) + '₫';
}

// ─── Status Badge ────────────────────────────────────────────────

function StatusBadge({
  status,
  daysOverdue,
}: {
  status?: string | null;
  daysOverdue?: number | null;
}) {
  if ((daysOverdue ?? 0) > 0)
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Quá hạn {daysOverdue}N
      </span>
    );
  const s = (status ?? '').toLowerCase();
  if (s === 'paid' || s === 'received')
    return (
      <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">
        Đã thanh toán
      </span>
    );
  if (s === 'partial')
    return (
      <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
        Một phần
      </span>
    );
  return (
    <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
      Chưa TT
    </span>
  );
}

// ─── AR / AP Table ──────────────────────────────────────────────

function ARAPTable({
  title,
  isLoading,
  items,
  variant,
}: {
  title: string;
  isLoading: boolean;
  items: Array<ARRow | APRow>;
  variant: 'ar' | 'ap';
}) {
  const isAR = variant === 'ar';
  const partyLabel = isAR ? 'Khách hàng' : 'Nhà cung cấp';
  const dueLabel = isAR ? 'Hạn thu' : 'Hạn TT';
  const paidLabel = isAR ? 'Đã thu' : 'Đã trả';
  const partyKey = (item: ARRow | APRow): string => {
    if (isAR) {
      const ar = item as ARRow;
      return ar.customer_name ?? ar.client_name ?? '—';
    }
    return (item as APRow).supplier_name ?? '—';
  };
  const paidKey = (item: ARRow | APRow): number | null | undefined => {
    if (isAR) {
      const ar = item as ARRow;
      return ar.received_amount ?? ar.paid_amount;
    }
    return (item as APRow).paid_amount;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700 leading-snug">{title}</h3>
        {!isLoading && items.length > 0 && (
          <span className="text-xs text-slate-500 tabular-nums">{items.length} bản ghi</span>
        )}
      </div>
      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          heading={isAR ? 'Không có công nợ thu' : 'Không có công nợ trả'}
          description={
            isAR
              ? 'Hóa đơn bán hàng sẽ hiển thị ở đây'
              : 'Hóa đơn nhà cung cấp sẽ hiển thị ở đây'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/60 border-b border-slate-100">
                <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  {partyLabel}
                </th>
                <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  Số HĐ
                </th>
                <th scope="col" className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  Số tiền
                </th>
                <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  {dueLabel}
                </th>
                <th scope="col" className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  {paidLabel}
                </th>
                <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  Trạng thái
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, i) => {
                const overdue = (item.days_overdue ?? 0) > 0;
                const idKey =
                  isAR
                    ? (item as ARRow).ar_id
                    : (item as APRow).ap_id;
                const partyName = partyKey(item);
                return (
                  <tr
                    key={idKey ?? i}
                    className={`hover:bg-slate-50/60 transition-colors ${overdue ? 'bg-rose-50/40' : ''}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {overdue && (
                          <>
                            <span className="sr-only">Quá hạn —</span>
                            <AlertTriangle className="h-3.5 w-3.5 text-rose-500 flex-shrink-0" aria-hidden="true" />
                          </>
                        )}
                        <span
                          className="text-sm font-medium text-slate-900 truncate max-w-[180px]"
                          title={partyName}
                        >
                          {partyName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-slate-500">{item.invoice_number ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-mono tabular-nums text-slate-900">
                      {fmtVnd(item.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                      {overdue ? (
                        <span className="text-rose-600 font-medium">{formatDate(item.due_date)}</span>
                      ) : (
                        formatDate(item.due_date)
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-mono tabular-nums text-slate-500">
                      {fmtVnd(paidKey(item))}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={item.status} daysOverdue={item.days_overdue} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Cash Book Table ─────────────────────────────────────────────

function CashBookTable({
  isLoading,
  items,
}: {
  isLoading: boolean;
  items: CashBookEntry[];
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700 leading-snug">Sổ quỹ gần đây</h3>
        {!isLoading && items.length > 0 && (
          <span className="text-xs text-slate-500 tabular-nums">{items.length} bút toán</span>
        )}
      </div>
      {isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          heading="Chưa có bút toán sổ quỹ"
          description="Bấm 'Ghi sổ quỹ' để tạo bút toán đầu tiên"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/60 border-b border-slate-100">
                <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  Ngày
                </th>
                <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  Loại
                </th>
                <th scope="col" className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  Mô tả
                </th>
                <th scope="col" className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  Số tiền
                </th>
                <th scope="col" className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5">
                  Số dư
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, i) => {
                const isIncome =
                  (item.type ?? '').toLowerCase() === 'income' || (item.amount_in ?? 0) > 0;
                const amount = item.amount_in ?? item.amount_out ?? item.amount ?? 0;
                const description = item.description ?? item.note ?? '—';
                return (
                  <tr key={item.id ?? i} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                      {formatDate(item.date ?? item.transaction_date)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ring-1 ring-inset ${
                          isIncome
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                            : 'bg-rose-50 text-rose-700 ring-rose-200'
                        }`}
                      >
                        {isIncome ? 'Thu' : 'Chi'}
                      </span>
                    </td>
                    <td
                      className="px-4 py-2.5 text-sm text-slate-700 max-w-[320px] truncate"
                      title={description}
                    >
                      {description}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right text-sm font-mono tabular-nums font-medium ${
                        isIncome ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {isIncome ? '+' : '−'}
                      {fmtVnd(Math.abs(amount))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-mono tabular-nums text-slate-900">
                      {fmtVnd(item.balance ?? item.running_balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Aging Block (4-bucket horizontal bar) ───────────────────────

/**
 * Finding #2: palette restraint — drop bg-orange-500 (out of whitelist),
 * use slate-300 / amber-300 / amber-500 / rose-500.
 * Finding #10: aria-valuetext on each progressbar so SR users hear the
 * formatted amount alongside the percentage.
 */
function AgingBlock({
  label,
  current,
  d30,
  d60,
  d90,
}: {
  label: string;
  current?: number;
  d30?: number;
  d60?: number;
  d90?: number;
}) {
  const buckets = [
    { name: '0–30 ngày', value: current ?? 0, color: 'bg-slate-300' },
    { name: '31–60 ngày', value: d30 ?? 0, color: 'bg-amber-300' },
    { name: '61–90 ngày', value: d60 ?? 0, color: 'bg-amber-500' },
    { name: '> 90 ngày', value: d90 ?? 0, color: 'bg-rose-500' },
  ];
  const total = buckets.reduce((s, b) => s + b.value, 0);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-slate-700 leading-snug">{label}</p>
        <p className="text-xs font-mono tabular-nums text-slate-500">
          Tổng: <span className="text-slate-900 font-semibold">{fmtVnd(total)}</span>
        </p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {buckets.map((b) => {
          const pct = total > 0 ? Math.round((b.value / total) * 100) : 0;
          return (
            <div key={b.name} className="min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-slate-500 leading-snug truncate" title={b.name}>
                  {b.name}
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-700">{pct}%</span>
              </div>
              <div
                className="h-2 bg-slate-100 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={`${b.name}: ${fmtVnd(b.value)} (${pct}%)`}
                aria-label={`${label} ${b.name}`}
              >
                <div className={`h-full ${b.color}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
                {fmtVnd(b.value)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function FinanceOverviewPage() {
  const queryClient = useQueryClient();
  const [showCashBookForm, setShowCashBookForm] = useState(false);

  const refetchAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['finance-ap'] });
    queryClient.invalidateQueries({ queryKey: ['finance-ar'] });
    queryClient.invalidateQueries({ queryKey: ['finance-cashflow'] });
    queryClient.invalidateQueries({ queryKey: ['finance-cashbook'] });
  }, [queryClient]);

  // Auto-refresh — interval defined as named constant for clarity (Finding #16).
  useEffect(() => {
    const interval = setInterval(refetchAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refetchAll]);

  // Queries — preserved exactly
  const { data: dashRaw, isLoading: dashLoading, isFetching: dashFetching } = useQuery({
    queryKey: ['finance-dashboard'],
    queryFn: () => api.get<DashboardData | { data: DashboardData }>('/api/v1/finance-management/dashboard'),
    retry: 1,
  });

  const { data: apRaw, isLoading: apLoading } = useQuery({
    queryKey: ['finance-ap'],
    queryFn: () => api.get<{ data: APResponse } | APResponse>('/api/v1/finance-management/ap-summary'),
    retry: 1,
  });

  const { data: arRaw, isLoading: arLoading } = useQuery({
    queryKey: ['finance-ar'],
    queryFn: () => api.get<{ data: ARResponse } | ARResponse>('/api/v1/finance-management/ar-summary'),
    retry: 1,
  });

  const { data: cashflowRaw, isLoading: cashflowLoading } = useQuery({
    queryKey: ['finance-cashflow'],
    queryFn: () => api.get<{ data?: CashFlowPoint[]; items?: CashFlowPoint[] }>('/api/v1/finance-management/cash-flow'),
    retry: 1,
  });

  const { data: cashbookRaw, isLoading: cashbookLoading } = useQuery({
    queryKey: ['finance-cashbook'],
    queryFn: () => api.get<{ data?: CashBookEntry[]; items?: CashBookEntry[] }>('/api/v1/finance-management/cash-book?page=1'),
    retry: 1,
  });

  // Extract data — narrow via interfaces; "as" only to disambiguate union shapes.
  const dashData: DashboardData =
    ((dashRaw as { data?: DashboardData } | undefined)?.data as DashboardData) ??
    (dashRaw as DashboardData) ??
    {};
  const apData: APResponse =
    ((apRaw as { data?: APResponse } | undefined)?.data as APResponse) ??
    (apRaw as APResponse) ??
    {};
  const arData: ARResponse =
    ((arRaw as { data?: ARResponse } | undefined)?.data as ARResponse) ??
    (arRaw as ARResponse) ??
    {};
  const cashflowData: CashFlowPoint[] =
    (cashflowRaw as { data?: CashFlowPoint[] } | undefined)?.data ??
    (cashflowRaw as { items?: CashFlowPoint[] } | undefined)?.items ??
    [];
  const cashbookItems: CashBookEntry[] =
    (cashbookRaw as { data?: CashBookEntry[] } | undefined)?.data ??
    (cashbookRaw as { items?: CashBookEntry[] } | undefined)?.items ??
    [];
  const apItems: APRow[] = apData.by_supplier ?? apData.items ?? [];
  const arItems: ARRow[] = arData.by_customer ?? arData.items ?? [];

  // KPI values
  const totalAR =
    dashData.total_ar ?? arData.total ?? arItems.reduce((s, r) => s + (r.amount ?? 0), 0);
  const totalAP =
    dashData.total_ap ?? apData.total ?? apItems.reduce((s, r) => s + (r.amount ?? 0), 0);
  const cashBalance = dashData.cash_balance ?? dashData.cash ?? null;

  // Aging data
  const apAging: AgingBuckets = apData.aging ?? dashData.ap_aging ?? {};
  const arAging: AgingBuckets = arData.aging ?? dashData.ar_aging ?? {};

  // Overdue counts (derived)
  const arOverdueCount = arItems.filter((r) => (r.days_overdue ?? 0) > 0).length;
  const apOverdueCount = apItems.filter((r) => (r.days_overdue ?? 0) > 0).length;
  const arOverdueAmount = arItems
    .filter((r) => (r.days_overdue ?? 0) > 0)
    .reduce((s, r) => s + (r.amount ?? 0), 0);
  const apOverdueAmount = apItems
    .filter((r) => (r.days_overdue ?? 0) > 0)
    .reduce((s, r) => s + (r.amount ?? 0), 0);

  // Net cash flow this period
  const netCashflow = cashflowData.reduce((s, r) => {
    const inc = r.income ?? r.ar ?? 0;
    const exp = r.expense ?? r.ap ?? 0;
    return s + (r.net ?? r.net_cash ?? inc - exp);
  }, 0);

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <PageHeader
        title="Tài chính tổng hợp"
        subtitle="Tổng quan AR · AP · Dòng tiền"
        actions={
          <>
            <button
              type="button"
              onClick={refetchAll}
              aria-label="Tải lại danh sách"
              className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 text-sm font-semibold disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 transition-colors"
            >
              <RefreshCw
                className={`h-4 w-4 text-slate-500 ${dashFetching ? 'motion-safe:animate-spin' : ''}`}
                aria-hidden="true"
              />
              Tải lại
            </button>
            <button
              type="button"
              onClick={() => setShowCashBookForm(true)}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-semibold shadow-sm shadow-brand-600/20 disabled:bg-brand-300 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 transition-colors"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Ghi sổ quỹ
            </button>
          </>
        }
      />

      {/* ── KPI Strip (6-up) — Finding #11: shared KPICard ──────── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <KPICard
          label="Công nợ thu"
          value={fmtVnd(totalAR)}
          sub={`${arItems.length} hóa đơn`}
          icon={Wallet}
          tone="brand"
          loading={dashLoading || arLoading}
        />
        <KPICard
          label="Công nợ trả"
          value={fmtVnd(totalAP)}
          sub={`${apItems.length} hóa đơn`}
          icon={CreditCard}
          tone="slate"
          loading={dashLoading || apLoading}
        />
        <KPICard
          label="Quá hạn thu"
          value={fmtVnd(arOverdueAmount)}
          sub={arOverdueCount > 0 ? `${arOverdueCount} HĐ quá hạn` : 'Không có HĐ quá hạn'}
          icon={AlertTriangle}
          tone="rose"
          loading={arLoading}
        />
        <KPICard
          label="Quá hạn trả"
          value={fmtVnd(apOverdueAmount)}
          sub={apOverdueCount > 0 ? `${apOverdueCount} HĐ quá hạn` : 'Không có HĐ quá hạn'}
          icon={AlertTriangle}
          tone="rose"
          loading={apLoading}
        />
        <KPICard
          label="Tiền mặt + NH"
          value={fmtVnd(cashBalance)}
          icon={DollarSign}
          tone="brand"
          loading={dashLoading}
        />
        <KPICard
          label="Dòng tiền kỳ này"
          value={fmtVnd(netCashflow)}
          sub={
            netCashflow >= 0
              ? 'Dương — dòng tiền tốt'
              : 'Âm — cần theo dõi'
          }
          icon={netCashflow >= 0 ? TrendingUp : TrendingDown}
          tone={netCashflow >= 0 ? 'brand' : 'rose'}
          loading={cashflowLoading}
        />
      </div>

      {/* ── Aging Block ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700 leading-snug">Tuổi nợ</h3>
          <div
            className="flex items-center gap-3 text-[11px] text-slate-500"
            aria-label="Chú thích buckets tuổi nợ"
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-300" aria-hidden="true" /> 0–30
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-300" aria-hidden="true" /> 31–60
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" /> 61–90
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" aria-hidden="true" /> &gt;90
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:divide-x xl:divide-slate-100">
          <AgingBlock
            label="Phải thu (AR)"
            current={arAging.current ?? arAging['0_30']}
            d30={arAging['30_days'] ?? arAging['30_60']}
            d60={arAging['60_days'] ?? arAging['60_90']}
            d90={arAging['90_plus'] ?? arAging['over_90']}
          />
          <div className="xl:pl-6">
            <AgingBlock
              label="Phải trả (AP)"
              current={apAging.current ?? apAging['0_30']}
              d30={apAging['30_days'] ?? apAging['30_60']}
              d60={apAging['60_days'] ?? apAging['60_90']}
              d90={apAging['90_plus'] ?? apAging['over_90']}
            />
          </div>
        </div>
      </div>

      {/* ── Two-column AR / AP Tables ─────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ARAPTable title="Công nợ phải thu" isLoading={arLoading} items={arItems} variant="ar" />
        <ARAPTable title="Công nợ phải trả" isLoading={apLoading} items={apItems} variant="ap" />
      </div>

      {/* ── Cashbook Table (full width) ──────────────────────── */}
      <CashBookTable isLoading={cashbookLoading} items={cashbookItems} />

      {/* Cash Book Create Modal */}
      {showCashBookForm && (
        <CashBookCreateModal
          onClose={() => setShowCashBookForm(false)}
          onCreated={() => {
            setShowCashBookForm(false);
            refetchAll();
          }}
        />
      )}
    </div>
  );
}

// ─── Cash Book Create Modal ──────────────────────────────────────

type Direction = 'income' | 'expense' | 'transfer';

const DIRECTION_OPTIONS: ReadonlyArray<{ val: Direction; label: string }> = [
  { val: 'income', label: 'Thu' },
  { val: 'expense', label: 'Chi' },
  { val: 'transfer', label: 'Chuyển khoản' },
];

/**
 * Finding #5: focus management for the modal
 *   - Form `onSubmit` so Enter submits (and "Hủy" stays type="button")
 *   - First radio button receives autoFocus on mount
 *   - useEffect stores the previously focused element and restores it on close
 *   - Tab/Shift-Tab focus trap: keep focus inside the dialog while it's open
 */
function CashBookCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().split('T')[0] as string,
    direction: 'income' as Direction,
    category: 'other',
    description: '',
    amount: '',
    currency: 'VND',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dialogRef = useRef<HTMLFormElement | null>(null);
  const firstRadioRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Store the previously-focused element, autofocus the first radio,
  // and restore focus on unmount.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Defer to after first paint so refs are wired.
    const t = requestAnimationFrame(() => {
      firstRadioRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(t);
      // Restore focus to the launching element so SR users continue
      // their reading position naturally.
      previouslyFocused.current?.focus?.();
    };
  }, []);

  // ESC to close + Tab focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = dialogRef.current;
      if (!container) return;
      const focusables = container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const CATEGORIES = [
    { value: 'customer_receipt', label: 'Thu từ khách hàng' },
    { value: 'supplier_payment', label: 'Thanh toán NCC' },
    { value: 'salary', label: 'Lương' },
    { value: 'rent', label: 'Thuê mặt bằng' },
    { value: 'tax', label: 'Thuế' },
    { value: 'other', label: 'Khác' },
  ];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.description || !form.amount) {
      setError('Vui lòng nhập mô tả và số tiền');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('/api/v1/finance-management/cash-book', {
        ...form,
        amount: Number(form.amount),
      });
      onCreated();
    } catch (err) {
      const detail = (err as { detail?: string })?.detail;
      setError(detail ?? 'Lỗi tạo bút toán');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cashbook-modal-title"
    >
      <form
        ref={dialogRef}
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-xl w-full max-h-[85vh] overflow-y-auto border border-slate-200"
        style={{ maxWidth: MODAL_MAX_W }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 id="cashbook-modal-title" className="text-sm font-semibold text-slate-900 leading-snug">
            Tạo bút toán sổ quỹ
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Direction */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Loại
            </label>
            <div
              role="radiogroup"
              aria-label="Loại bút toán"
              className="flex flex-wrap items-center gap-1.5"
            >
              {DIRECTION_OPTIONS.map((d, idx) => {
                const active = form.direction === d.val;
                return (
                  <button
                    key={d.val}
                    ref={idx === 0 ? firstRadioRef : undefined}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setForm((f) => ({ ...f, direction: d.val }))}
                    className={`h-9 px-3 rounded-lg text-xs font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 ${
                      active
                        ? 'bg-brand-600 border-brand-600 text-white shadow-sm shadow-brand-600/20'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Date + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="cashbook-date" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Ngày
              </label>
              <input
                id="cashbook-date"
                type="date"
                value={form.entry_date}
                onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
                className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
              />
            </div>
            <div>
              <label htmlFor="cashbook-category" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Danh mục
              </label>
              <select
                id="cashbook-category"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* Description */}
          <div>
            <label htmlFor="cashbook-desc" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Mô tả <span className="text-rose-500">*</span>
            </label>
            <input
              id="cashbook-desc"
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="VD: Thanh toán NCC Trung Quốc — PO-2026-0042"
              className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
            />
          </div>
          {/* Amount + Currency */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label htmlFor="cashbook-amount" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Số tiền <span className="text-rose-500">*</span>
              </label>
              <input
                id="cashbook-amount"
                type="number"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0"
                className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 font-mono tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
              />
            </div>
            <div>
              <label htmlFor="cashbook-currency" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Tiền tệ
              </label>
              <select
                id="cashbook-currency"
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
              >
                <option value="VND">VND</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
              </select>
            </div>
          </div>
          {/* Notes */}
          <div>
            <label htmlFor="cashbook-notes" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Ghi chú
            </label>
            <textarea
              id="cashbook-notes"
              value={form.notes}
              rows={2}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 leading-snug placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
            />
          </div>
          {error && (
            <div
              role="alert"
              className="text-xs text-rose-700 bg-rose-50 ring-1 ring-inset ring-rose-200 rounded-lg px-3 py-2 leading-snug"
            >
              {error}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 transition-colors"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-semibold shadow-sm shadow-brand-600/20 disabled:bg-brand-300 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 transition-colors"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Tạo bút toán
          </button>
        </div>
      </form>
    </div>
  );
}

