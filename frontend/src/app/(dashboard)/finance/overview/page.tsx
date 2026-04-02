'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertTriangle,
  RefreshCw,
  Inbox,
  CreditCard,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

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

function fmtChartVnd(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + 'tỷ';
  if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(0) + 'tr';
  return String(value);
}

// ─── KPI Card ────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  accentClass,
  loading,
}: {
  label: string;
  value?: string;
  sub?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  accentClass: string;
  loading?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border-l-4 ${accentClass} p-4 flex items-center gap-4`}>
      <div className="p-2.5 rounded-xl bg-slate-50">
        <Icon className="h-5 w-5 text-slate-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        {loading ? (
          <div className="h-6 w-24 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-xl font-bold font-mono text-slate-900 leading-tight">{value ?? '—'}</p>
        )}
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
      {trend === 'up' && <ArrowUpRight className="h-5 w-5 text-emerald-500 flex-shrink-0" />}
      {trend === 'down' && <ArrowDownRight className="h-5 w-5 text-red-500 flex-shrink-0" />}
    </div>
  );
}

// ─── Table Skeleton ──────────────────────────────────────────────

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-20 bg-slate-200 rounded-full animate-pulse ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ─── Status Badge ────────────────────────────────────────────────

function StatusBadge({
  status,
  daysOverdue,
}: {
  status?: string;
  daysOverdue?: number;
}) {
  if ((daysOverdue ?? 0) > 0)
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">
        <AlertTriangle className="h-3 w-3" />
        Quá hạn {daysOverdue}N
      </span>
    );
  const s = (status ?? '').toLowerCase();
  if (s === 'paid' || s === 'received')
    return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700">Đã thanh toán</span>;
  if (s === 'partial')
    return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700">Một phần</span>;
  return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-500">Chưa TT</span>;
}

// ─── AP Table ───────────────────────────────────────────────────

function APTable({ isLoading, items }: { isLoading: boolean; items: any[] }) {
  if (isLoading) return <TableSkeleton />;
  if (!items.length)
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-300">
        <Inbox className="h-10 w-10 mb-2" />
        <p className="text-sm text-slate-400">Không có dữ liệu công nợ trả</p>
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50/60 border-b border-slate-100">
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Nhà cung cấp</th>
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Số HĐ</th>
            <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Số tiền</th>
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Hạn TT</th>
            <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Đã trả</th>
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Trạng thái</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item: any, i: number) => {
            const overdue = (item.days_overdue ?? 0) > 0;
            return (
              <tr
                key={item.ap_id ?? i}
                className={`hover:bg-slate-50/50 transition-colors ${overdue ? 'bg-red-50/25' : ''}`}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                    <span className="text-sm font-medium text-slate-800">{item.supplier_name ?? '—'}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs font-mono text-slate-500">{item.invoice_number ?? '—'}</td>
                <td className="px-4 py-2.5 text-right text-sm font-mono font-medium text-slate-900">{fmtVnd(item.amount)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(item.due_date)}</td>
                <td className="px-4 py-2.5 text-right text-sm font-mono text-slate-600">{fmtVnd(item.paid_amount)}</td>
                <td className="px-4 py-2.5"><StatusBadge status={item.status} daysOverdue={item.days_overdue} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── AR Table ───────────────────────────────────────────────────

function ARTable({ isLoading, items }: { isLoading: boolean; items: any[] }) {
  if (isLoading) return <TableSkeleton />;
  if (!items.length)
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-300">
        <Inbox className="h-10 w-10 mb-2" />
        <p className="text-sm text-slate-400">Không có dữ liệu công nợ thu</p>
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50/60 border-b border-slate-100">
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Khách hàng</th>
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Số HĐ</th>
            <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Số tiền</th>
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Hạn thu</th>
            <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Đã thu</th>
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Trạng thái</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item: any, i: number) => {
            const overdue = (item.days_overdue ?? 0) > 0;
            return (
              <tr
                key={item.ar_id ?? i}
                className={`hover:bg-slate-50/50 transition-colors ${overdue ? 'bg-red-50/25' : ''}`}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                    <span className="text-sm font-medium text-slate-800">{item.customer_name ?? item.client_name ?? '—'}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs font-mono text-slate-500">{item.invoice_number ?? '—'}</td>
                <td className="px-4 py-2.5 text-right text-sm font-mono font-medium text-slate-900">{fmtVnd(item.amount)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(item.due_date)}</td>
                <td className="px-4 py-2.5 text-right text-sm font-mono text-slate-600">{fmtVnd(item.received_amount ?? item.paid_amount)}</td>
                <td className="px-4 py-2.5"><StatusBadge status={item.status} daysOverdue={item.days_overdue} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Cash Book Table ─────────────────────────────────────────────

function CashBookTable({ isLoading, items }: { isLoading: boolean; items: any[] }) {
  if (isLoading) return <TableSkeleton />;
  if (!items.length)
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-300">
        <Inbox className="h-10 w-10 mb-2" />
        <p className="text-sm text-slate-400">Không có dữ liệu sổ quỹ</p>
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50/60 border-b border-slate-100">
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Ngày</th>
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Diễn giải</th>
            <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Thu</th>
            <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Chi</th>
            <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Số dư</th>
            <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Loại</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item: any, i: number) => {
            const isIncome = (item.type ?? '').toLowerCase() === 'income' || (item.amount_in ?? 0) > 0;
            return (
              <tr key={item.id ?? i} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                  {formatDate(item.date ?? item.transaction_date)}
                </td>
                <td className="px-4 py-2.5 text-sm text-slate-700 max-w-[220px] truncate">
                  {item.description ?? item.note ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-sm font-mono font-medium text-emerald-700">
                  {item.amount_in || isIncome ? fmtVnd(item.amount_in ?? item.amount) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-sm font-mono font-medium text-red-600">
                  {item.amount_out || (!isIncome && !item.amount_in)
                    ? fmtVnd(item.amount_out ?? item.amount)
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-sm font-mono text-slate-700">
                  {fmtVnd(item.balance ?? item.running_balance)}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                      isIncome ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {isIncome ? 'Thu' : 'Chi'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Aging Analysis ──────────────────────────────────────────────

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
  const total = (current ?? 0) + (d30 ?? 0) + (d60 ?? 0) + (d90 ?? 0);
  const pct = (v?: number) => total > 0 ? Math.round(((v ?? 0) / total) * 100) : 0;
  return (
    <div className="flex-1 min-w-[200px]">
      <p className="text-xs font-semibold text-slate-600 mb-3">{label}</p>
      <div className="space-y-2">
        {[
          { name: 'Hiện tại', value: current, pctVal: pct(current), color: 'bg-emerald-400' },
          { name: '1-30 ngày', value: d30, pctVal: pct(d30), color: 'bg-amber-400' },
          { name: '31-60 ngày', value: d60, pctVal: pct(d60), color: 'bg-orange-500' },
          { name: '60+ ngày', value: d90, pctVal: pct(d90), color: 'bg-red-500' },
        ].map((row) => (
          <div key={row.name}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs text-slate-500">{row.name}</span>
              <span className="text-xs font-mono text-slate-700">{fmtVnd(row.value)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full ${row.color}`}
                style={{ width: `${row.pctVal}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Custom Tooltip for Recharts ─────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-slate-700 mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-slate-600">{p.name}:</span>
          <span className="font-mono text-slate-900">{fmtChartVnd(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function FinanceOverviewPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'ap' | 'ar' | 'cashbook'>('ap');

  const refetchAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['finance-ap'] });
    queryClient.invalidateQueries({ queryKey: ['finance-ar'] });
    queryClient.invalidateQueries({ queryKey: ['finance-cashflow'] });
    queryClient.invalidateQueries({ queryKey: ['finance-cashbook'] });
  }, [queryClient]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(refetchAll, 30000);
    return () => clearInterval(interval);
  }, [refetchAll]);

  // Queries
  const { data: dashRaw, isLoading: dashLoading } = useQuery({
    queryKey: ['finance-dashboard'],
    queryFn: () => api.get<any>('/api/v1/finance-management/dashboard'),
    retry: 1,
  });

  const { data: apRaw, isLoading: apLoading } = useQuery({
    queryKey: ['finance-ap'],
    queryFn: () => api.get<any>('/api/v1/finance-management/ap-summary'),
    retry: 1,
  });

  const { data: arRaw, isLoading: arLoading } = useQuery({
    queryKey: ['finance-ar'],
    queryFn: () => api.get<any>('/api/v1/finance-management/ar-summary'),
    retry: 1,
  });

  const { data: cashflowRaw, isLoading: cashflowLoading } = useQuery({
    queryKey: ['finance-cashflow'],
    queryFn: () => api.get<any>('/api/v1/finance-management/cash-flow'),
    retry: 1,
  });

  const { data: cashbookRaw, isLoading: cashbookLoading } = useQuery({
    queryKey: ['finance-cashbook'],
    queryFn: () => api.get<any>('/api/v1/finance-management/cash-book?page=1'),
    retry: 1,
  });

  // Extract data
  const dashData = dashRaw?.data ?? dashRaw ?? {};
  const apData = apRaw?.data ?? {};
  const arData = arRaw?.data ?? {};
  const cashflowData: any[] = cashflowRaw?.data ?? cashflowRaw?.items ?? [];
  const cashbookItems: any[] = cashbookRaw?.data ?? cashbookRaw?.items ?? [];
  const apItems: any[] = apData.by_supplier ?? apData.items ?? [];
  const arItems: any[] = arData.by_customer ?? arData.items ?? [];

  // KPI values
  const totalAR = dashData.total_ar ?? arData.total ?? arItems.reduce((s: number, r: any) => s + (r.amount ?? 0), 0);
  const totalAP = dashData.total_ap ?? apData.total ?? apItems.reduce((s: number, r: any) => s + (r.amount ?? 0), 0);
  const netBalance = totalAR - totalAP;
  const cashBalance = dashData.cash_balance ?? dashData.cash ?? null;

  // Aging data
  const apAging = apData.aging ?? dashData.ap_aging ?? {};
  const arAging = arData.aging ?? dashData.ar_aging ?? {};

  // Prepare chart data — AP vs AR by month
  const apvsarData: any[] = (() => {
    if (cashflowData.length > 0) return cashflowData;
    // build placeholder if no data
    return [];
  })();

  // Prepare chart for normalized format
  const normalizedCashflow = apvsarData.map((row: any) => ({
    month: row.month ?? row.period ?? row.label ?? '',
    AR: row.ar ?? row.receivable ?? row.income ?? 0,
    AP: row.ap ?? row.payable ?? row.expense ?? 0,
    'Thu ròng': row.net ?? row.net_cash ?? (row.income ?? 0) - (row.expense ?? 0),
    Chi: Math.abs(row.expense ?? row.ap ?? 0),
    Thu: row.income ?? row.ar ?? 0,
  }));

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Tổng quan Tài chính</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Công nợ trả · Công nợ thu · Sổ quỹ
          </p>
        </div>
        <button
          onClick={refetchAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Làm mới
        </button>
      </div>

      {/* ── KPI Row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          label="Tổng phải thu (AR)"
          value={fmtVnd(totalAR)}
          sub={`${arItems.length} khách hàng`}
          icon={TrendingUp}
          trend="up"
          accentClass="border-emerald-500"
          loading={dashLoading || arLoading}
        />
        <KPICard
          label="Tổng phải trả (AP)"
          value={fmtVnd(totalAP)}
          sub={`${apItems.length} nhà cung cấp`}
          icon={TrendingDown}
          trend="down"
          accentClass="border-red-400"
          loading={dashLoading || apLoading}
        />
        <KPICard
          label="Số dư ròng (AR - AP)"
          value={fmtVnd(netBalance)}
          sub={netBalance >= 0 ? 'Dương — có lợi' : 'Âm — cần theo dõi'}
          icon={DollarSign}
          trend={netBalance >= 0 ? 'up' : 'down'}
          accentClass={netBalance >= 0 ? 'border-cyan-500' : 'border-orange-500'}
          loading={dashLoading || apLoading || arLoading}
        />
        <KPICard
          label="Tiền mặt"
          value={fmtVnd(cashBalance)}
          icon={Wallet}
          accentClass="border-brand-500"
          loading={dashLoading}
        />
      </div>

      {/* ── Charts Row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        {/* AP vs AR Bar Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-slate-700">AP vs AR theo tháng</h3>
          </div>
          {cashflowLoading ? (
            <div className="h-[260px] flex items-center justify-center">
              <div className="space-y-2 w-full px-4">
                {[70, 50, 80, 60, 40].map((w, i) => (
                  <div key={i} className="flex gap-2 items-end h-8">
                    <div className={`h-full bg-slate-200 rounded animate-pulse`} style={{ width: `${w}%` }} />
                    <div className={`h-2/3 bg-slate-200 rounded animate-pulse`} style={{ width: `${100 - w}%` }} />
                  </div>
                ))}
              </div>
            </div>
          ) : normalizedCashflow.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[260px] text-slate-300">
              <Inbox className="h-10 w-10 mb-2" />
              <p className="text-sm text-slate-400">Chưa có dữ liệu</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={normalizedCashflow} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tickFormatter={fmtChartVnd} tick={{ fontSize: 10, fill: '#94a3b8' }} width={55} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="AP" name="Phải trả (AP)" fill="#f87171" radius={[3, 3, 0, 0]} />
                <Bar dataKey="AR" name="Phải thu (AR)" fill="#34d399" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Cash Flow Area Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-slate-700">Dòng tiền theo tháng</h3>
          </div>
          {cashflowLoading ? (
            <div className="h-[260px] flex items-center justify-center">
              <div className="h-[200px] w-full mx-4 bg-gradient-to-t from-slate-100 to-slate-50 rounded animate-pulse" />
            </div>
          ) : normalizedCashflow.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[260px] text-slate-300">
              <Inbox className="h-10 w-10 mb-2" />
              <p className="text-sm text-slate-400">Chưa có dữ liệu</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={normalizedCashflow} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradThu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="gradChi" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tickFormatter={fmtChartVnd} tick={{ fontSize: 10, fill: '#94a3b8' }} width={55} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="Thu"
                  name="Thu"
                  stroke="#34d399"
                  strokeWidth={2}
                  fill="url(#gradThu)"
                />
                <Area
                  type="monotone"
                  dataKey="Chi"
                  name="Chi"
                  stroke="#f87171"
                  strokeWidth={2}
                  fill="url(#gradChi)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Tables (Tabs) ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden mb-6">
        {/* Tab Bar */}
        <div className="flex border-b border-slate-100">
          {(
            [
              { key: 'ap', label: 'Công nợ trả', icon: TrendingDown, count: apItems.length },
              { key: 'ar', label: 'Công nợ thu', icon: TrendingUp, count: arItems.length },
              { key: 'cashbook', label: 'Sổ quỹ', icon: Wallet, count: cashbookItems.length },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1 text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'ap' && <APTable isLoading={apLoading} items={apItems} />}
        {activeTab === 'ar' && <ARTable isLoading={arLoading} items={arItems} />}
        {activeTab === 'cashbook' && <CashBookTable isLoading={cashbookLoading} items={cashbookItems} />}
      </div>

      {/* ── Aging Analysis ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center gap-2 mb-5">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-700">Phân tích tuổi nợ (Aging)</h3>
        </div>
        <div className="flex flex-wrap gap-8">
          <AgingBlock
            label="Phải trả (AP)"
            current={apAging.current ?? apAging['0_30']}
            d30={apAging['30_days'] ?? apAging['30_60']}
            d60={apAging['60_days'] ?? apAging['60_90']}
            d90={apAging['90_plus'] ?? apAging['over_90']}
          />
          <div className="w-px bg-slate-100 self-stretch" />
          <AgingBlock
            label="Phải thu (AR)"
            current={arAging.current ?? arAging['0_30']}
            d30={arAging['30_days'] ?? arAging['30_60']}
            d60={arAging['60_days'] ?? arAging['60_90']}
            d90={arAging['90_plus'] ?? arAging['over_90']}
          />
        </div>
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-slate-50">
          {[
            { name: 'Hiện tại', color: 'bg-emerald-400' },
            { name: '1-30 ngày', color: 'bg-amber-400' },
            { name: '31-60 ngày', color: 'bg-orange-500' },
            { name: '60+ ngày', color: 'bg-red-500' },
          ].map((l) => (
            <div key={l.name} className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
              {l.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
