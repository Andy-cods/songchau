'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  PieChart,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart2,
  Inbox,
} from 'lucide-react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// ─── Types ──────────────────────────────────────────────────────

interface ProfitLossData {
  revenue: number;
  cogs: number;
  gross_profit: number;
  expenses: number;
  net_profit: number;
  margin_pct: number;
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

// ─── Helpers ────────────────────────────────────────────────────

function fmtVnd(value: number): string {
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + '₫';
}

function MarginBadge({ pct }: { pct: number }) {
  const cls =
    pct >= 20
      ? 'bg-emerald-100 text-emerald-700'
      : pct >= 10
      ? 'bg-amber-100 text-amber-700'
      : 'bg-red-100 text-red-700';
  return <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${cls}`}>{Number(pct ?? 0).toFixed(1)}%</span>;
}

// ─── P&L Card ────────────────────────────────────────────────────

function PLCard({
  label,
  value,
  color,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-lg font-bold font-mono text-slate-900 mt-0.5">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 bg-slate-200 rounded-lg" />
        <div className="space-y-1.5">
          <div className="h-3 w-20 bg-slate-200 rounded" />
          <div className="h-5 w-28 bg-slate-200 rounded" />
        </div>
      </div>
    </div>
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

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery<{ data: MonthlyRow[] }>({
    queryKey: ['finance-monthly', months],
    queryFn: () => api.get(`/api/v1/finance-reports/monthly-comparison?months=${months}`),
    retry: 1,
  });

  const { data: topCustData } = useQuery<{ data: TopCustomerRow[] }>({
    queryKey: ['finance-top-customers'],
    queryFn: () => api.get('/api/v1/finance-reports/top-customers?limit=10'),
    retry: 1,
  });

  const pl = plData?.data ?? (plData as any)?.items ?? plData;
  const monthlyRaw = monthlyData?.data ?? (monthlyData as any)?.items ?? [];
  const monthly = Array.isArray(monthlyRaw) ? monthlyRaw : [];
  const topCustRaw = topCustData?.data ?? (topCustData as any)?.items ?? [];
  const topCustomers = Array.isArray(topCustRaw) ? topCustRaw : [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
            <PieChart className="h-5 w-5 text-brand-600" />
            Báo cáo tài chính
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Kết quả kinh doanh và phân tích lợi nhuận</p>
        </div>
        {/* Period Selector */}
        <div className="flex items-center gap-1.5">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setMonths(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                months === opt.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* P&L Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {plLoading ? (
          Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <PLCard
              label="Doanh thu"
              value={pl ? fmtVnd(pl.revenue) : '—'}
              color="text-blue-600 bg-blue-50"
              icon={TrendingUp}
            />
            <PLCard
              label="Giá vốn (COGS)"
              value={pl ? fmtVnd(pl.cogs) : '—'}
              color="text-orange-600 bg-orange-50"
              icon={BarChart2}
            />
            <PLCard
              label="Lợi nhuận gộp"
              value={pl ? fmtVnd(pl.gross_profit) : '—'}
              color="text-emerald-600 bg-emerald-50"
              icon={DollarSign}
            />
            <PLCard
              label="Chi phí"
              value={pl ? fmtVnd(pl.expenses) : '—'}
              color="text-red-600 bg-red-50"
              icon={TrendingDown}
            />
            <PLCard
              label="Lợi nhuận ròng"
              value={pl ? fmtVnd(pl.net_profit) : '—'}
              color={pl && pl.net_profit >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}
              icon={DollarSign}
            />
            <PLCard
              label="Biên lợi nhuận"
              value={pl && pl.margin_pct != null ? `${Number(pl.margin_pct).toFixed(1)}%` : '—'}
              color="text-brand-600 bg-brand-50"
              icon={PieChart}
            />
          </>
        )}
      </div>

      {/* Monthly Comparison Chart */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">So sánh doanh thu / chi phí theo tháng</h3>
        {monthlyLoading ? (
          <div className="h-[280px] flex items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
          </div>
        ) : monthly.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={monthly} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis
                yAxisId="left"
                tickFormatter={(v) => fmtVnd(v)}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                width={70}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                width={40}
              />
              <Tooltip
                formatter={(value: number, name: string) =>
                  name === 'margin_pct' ? `${Number(value ?? 0).toFixed(1)}%` : fmtVnd(value)
                }
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="revenue" name="Doanh thu" fill="#6366f1" opacity={0.85} radius={[3, 3, 0, 0]} />
              <Bar yAxisId="left" dataKey="cost" name="Chi phí" fill="#f87171" opacity={0.85} radius={[3, 3, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="margin_pct"
                name="Biên LN %"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center h-[280px] text-slate-300">
            <Inbox className="h-10 w-10 mb-2" />
            <p className="text-sm text-slate-400">Chưa có dữ liệu</p>
          </div>
        )}
      </div>

      {/* Monthly Table + Top Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Detail Table */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-sm font-semibold text-slate-700">Chi tiết theo tháng</h3>
          </div>
          {monthly.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-slate-300">
              <Inbox className="h-8 w-8" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/30">
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Tháng</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Doanh thu</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Chi phí</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Biên LN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthly.map((row) => (
                    <tr key={row.month} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="text-sm font-medium text-slate-700">{row.month}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm font-mono text-slate-700">{fmtVnd(row.revenue)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm font-mono text-slate-600">{fmtVnd(row.cost)}</span>
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

        {/* Top Customers */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-sm font-semibold text-slate-700">Top 10 khách hàng</h3>
          </div>
          {topCustomers.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-slate-300">
              <Inbox className="h-8 w-8" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/30">
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">#</th>
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Khách hàng</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Doanh thu</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5">Đơn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topCustomers.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-bold font-mono ${idx < 3 ? 'text-brand-600' : 'text-slate-400'}`}>
                          #{idx + 1}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-sm text-slate-700">{row.customer_name}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm font-mono font-medium text-slate-900">{fmtVnd(row.total_revenue)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm font-mono text-slate-500">{row.order_count}</span>
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
