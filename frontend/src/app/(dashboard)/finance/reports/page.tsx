'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart2,
  Wallet,
  Inbox,
} from 'lucide-react';
import { KPICard } from '@/components/shared/kpi-card';
import { TableSkeleton } from '@/components/shared/table-skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';

// Code-splitting (W3-16): recharts moved into MonthlyComparisonChart.tsx,
// deferred via dynamic() so it isn't part of this route's first-load JS.
const MonthlyComparisonChart = dynamic(
  () => import('./MonthlyComparisonChart').then((m) => m.MonthlyComparisonChart),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-72 bg-slate-100 rounded-xl motion-safe:animate-pulse"
        aria-busy="true"
        aria-live="polite"
      />
    ),
  },
);

// ─── Types ──────────────────────────────────────────────────────

// Khớp shape THẬT của BE /finance-reports/profit-loss (revenue/cogs là object,
// các số phẳng có hậu tố _vnd) — trước đây đọc phẳng pl.revenue/pl.gross_profit...
// nên fmtVnd(object)/undefined → NaN toàn bộ 5 thẻ KPI.
interface ProfitLossData {
  revenue: { from_deals_vnd: number; from_invoices: number; collected: number };
  cogs: { cogs_vnd: number; freight_vnd: number; customs_duty_vnd: number; total_cost_vnd: number };
  gross_profit_vnd: number;
  avg_margin_pct: number;
  total_opex_vnd: number;
  net_profit_vnd: number;
}

interface MonthlyRow {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
  margin_pct: number;
}

interface TopCustomerRow {
  customer_name: string;
  total_revenue: number;
  order_count: number;
}

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

// ─── Helpers ────────────────────────────────────────────────────

function fmtVnd(value: number): string {
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + '₫';
}

// ─── Margin Badge ────────────────────────────────────────────────

function MarginBadge({ pct }: { pct: number }) {
  const tone: Tone =
    pct >= 20 ? 'success' : pct >= 10 ? 'warning' : 'danger';
  const cls =
    tone === 'success'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : tone === 'warning'
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : 'bg-rose-50 text-rose-700 ring-rose-200';
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold tabular-nums ring-1 ring-inset',
        cls
      )}
    >
      {Number(pct ?? 0).toFixed(1)}%
    </span>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { value: 3, label: '3 tháng' },
  { value: 6, label: '6 tháng' },
  { value: 12, label: '12 tháng' },
];

export default function FinanceReportsPage() {
  const [months, setMonths] = useState(6);

  const { data: plData, isLoading: plLoading } = useQuery<{ data: ProfitLossData }>({
    queryKey: ['finance-pl', months],
    queryFn: () => api.get(`/api/v1/finance-reports/profit-loss?months=${months}`),
    retry: 1,
  });

  // BE trả data={monthly:[...]} (object, KHÔNG phải mảng) → Array.isArray cũ = false → bảng rỗng.
  const { data: monthlyData, isLoading: monthlyLoading } = useQuery<{ data: { monthly?: unknown[] } }>({
    queryKey: ['finance-monthly', months],
    queryFn: () => api.get(`/api/v1/finance-reports/monthly-comparison?months=${months}`),
    retry: 1,
  });

  // BE trả data={customers:[...]} (object) — tương tự.
  const { data: topCustData } = useQuery<{ data: { customers?: unknown[] } }>({
    queryKey: ['finance-top-customers'],
    queryFn: () => api.get('/api/v1/finance-reports/top-customers?limit=10'),
    retry: 1,
  });

  const pl = plData?.data;
  // Bóc .monthly + map key BE (revenue_vnd/cost_vnd/net_profit_vnd/avg_margin_pct)
  // sang tên FE (revenue/cost/profit/margin_pct) → chart/bảng giữ nguyên.
  const monthlyRaw = monthlyData?.data?.monthly ?? [];
  const monthly: MonthlyRow[] = (Array.isArray(monthlyRaw) ? monthlyRaw : []).map((r: any) => ({
    month: r.month,
    revenue: Number(r.revenue_vnd ?? 0),
    cost: Number(r.cost_vnd ?? 0),
    profit: Number(r.net_profit_vnd ?? 0),
    margin_pct: Number(r.avg_margin_pct ?? 0),
  }));
  // Bóc .customers + map company_name → customer_name (BE không có customer_name).
  const topCustRaw = topCustData?.data?.customers ?? [];
  const topCustomers: TopCustomerRow[] = (Array.isArray(topCustRaw) ? topCustRaw : []).map((r: any) => ({
    customer_name: r.company_name ?? r.short_name ?? '—',
    total_revenue: Number(r.total_revenue ?? 0),
    order_count: Number(r.order_count ?? 0),
  }));

  // Net profit: brand by default; flips to danger (rose) only when negative
  // (a real warning), per the neutral-KPI rule.
  const netTone: 'rose' | 'brand' = pl && pl.net_profit_vnd < 0 ? 'rose' : 'brand';

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Báo cáo tài chính"
        subtitle="Kết quả kinh doanh và phân tích lợi nhuận"
        actions={
          /* Period Selector */
          <div
            role="radiogroup"
            aria-label="Chọn khoảng thời gian"
            className="flex flex-wrap items-center gap-1.5"
          >
            {PERIOD_OPTIONS.map((opt) => {
              const active = months === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMonths(opt.value)}
                  className={cn(
                    'h-9 px-3 rounded-lg text-xs font-semibold border transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2',
                    active
                      ? 'bg-brand-600 border-brand-600 text-white shadow-sm shadow-brand-600/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        }
      />

      {/* Finding #7: drop the standalone "Biên LN" KPI — it duplicates the
          sub-label already rendered under "Lợi nhuận ròng". Strip is now 5-up. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPICard
          label="Doanh thu"
          value={pl ? fmtVnd(pl.revenue.from_deals_vnd) : '—'}
          tone="brand"
          icon={TrendingUp}
          loading={plLoading}
        />
        <KPICard
          label="Giá vốn (COGS)"
          value={pl ? fmtVnd(pl.cogs.total_cost_vnd) : '—'}
          tone="slate"
          icon={BarChart2}
          loading={plLoading}
        />
        <KPICard
          label="Lợi nhuận gộp"
          value={pl ? fmtVnd(pl.gross_profit_vnd) : '—'}
          tone="brand"
          icon={DollarSign}
          loading={plLoading}
        />
        <KPICard
          label="Chi phí"
          value={pl ? fmtVnd(pl.total_opex_vnd) : '—'}
          tone="slate"
          icon={TrendingDown}
          loading={plLoading}
        />
        <KPICard
          label="Lợi nhuận ròng"
          value={pl ? fmtVnd(pl.net_profit_vnd) : '—'}
          tone={netTone}
          icon={Wallet}
          sub={
            pl && pl.avg_margin_pct != null
              ? `Biên LN ${Number(pl.avg_margin_pct).toFixed(1)}%`
              : undefined
          }
          loading={plLoading}
        />
      </div>

      {/* Monthly Comparison Chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700 leading-snug">
            So sánh theo tháng
          </h3>
        </div>
        {monthlyLoading ? (
          <div
            className="h-72 bg-slate-100 rounded-xl motion-safe:animate-pulse"
            aria-busy="true"
            aria-live="polite"
          />
        ) : monthly.length > 0 ? (
          <MonthlyComparisonChart monthly={monthly} />
        ) : (
          <EmptyState
            icon={Inbox}
            heading="Chưa có dữ liệu"
            description="Chọn khoảng thời gian khác hoặc kiểm tra lại nguồn dữ liệu."
          />
        )}
      </div>

      {/* Two-column tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Top Customers */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700 leading-snug">
              Top khách hàng
            </h3>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {topCustomers.length > 0 ? `${topCustomers.length} KH` : ''}
            </span>
          </div>
          {topCustomers.length === 0 ? (
            <EmptyState
              icon={Inbox}
              heading="Chưa có khách hàng"
              description="Dữ liệu doanh thu theo khách hàng sẽ hiển thị ở đây."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-100">
                    <th
                      scope="col"
                      className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5 w-8"
                    >
                      #
                    </th>
                    <th
                      scope="col"
                      className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                    >
                      Khách hàng
                    </th>
                    <th
                      scope="col"
                      className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                    >
                      Doanh thu
                    </th>
                    <th
                      scope="col"
                      className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                    >
                      Số đơn
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topCustomers.map((row, idx) => (
                    <tr
                      key={`${row.customer_name}-${idx}`}
                      className="hover:bg-slate-50/60 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            'text-xs font-mono font-bold tabular-nums',
                            idx < 3 ? 'text-brand-600' : 'text-slate-400'
                          )}
                        >
                          {idx + 1}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="block text-sm text-slate-900 truncate max-w-[260px] leading-snug"
                          title={row.customer_name}
                        >
                          {row.customer_name}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm font-mono tabular-nums text-slate-900">
                          {fmtVnd(row.total_revenue)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm font-mono tabular-nums text-slate-500">
                          {row.order_count}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Monthly Detail Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700 leading-snug">
              Chi tiết theo tháng
            </h3>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {monthly.length > 0 ? `${monthly.length} tháng` : ''}
            </span>
          </div>
          {monthlyLoading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : monthly.length === 0 ? (
            <EmptyState
              icon={Inbox}
              heading="Chưa có dữ liệu"
              description="Dữ liệu doanh thu / chi phí theo tháng sẽ hiển thị ở đây."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-100">
                    <th
                      scope="col"
                      className="text-left text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                    >
                      Tháng
                    </th>
                    <th
                      scope="col"
                      className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                    >
                      Doanh thu
                    </th>
                    <th
                      scope="col"
                      className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                    >
                      Chi phí
                    </th>
                    <th
                      scope="col"
                      className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                    >
                      LN
                    </th>
                    <th
                      scope="col"
                      className="text-right text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 px-4 py-2.5"
                    >
                      Biên LN
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthly.map((row) => (
                    <tr
                      key={row.month}
                      className="hover:bg-slate-50/60 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <span className="text-sm font-mono text-slate-700 tabular-nums">
                          {row.month}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm font-mono tabular-nums text-slate-900">
                          {fmtVnd(row.revenue)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm font-mono tabular-nums text-slate-500">
                          {fmtVnd(row.cost)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span
                          className={cn(
                            'text-sm font-mono tabular-nums',
                            row.profit < 0 ? 'text-rose-600' : 'text-slate-900'
                          )}
                        >
                          {fmtVnd(row.profit)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <MarginBadge pct={row.margin_pct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
