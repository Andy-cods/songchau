'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  BarChart2,
  Loader2,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { CHART } from '@/lib/chart-colors';
import { PageHeader } from '@/components/shared/page-header';

// ─── Types ─────────────────────────────────────────────────────

interface ProfitOverview {
  total_revenue: number;
  total_cost: number;
  gross_profit: number;
  avg_margin_pct: number;
  best_deal?: string;
  worst_deal?: string;
  deal_count: number;
}

interface DealRow {
  chain_code: string;
  rfq_number: string;
  revenue_vnd: number;
  total_cost_vnd: number;
  margin_pct: number;
}

interface MakerRow {
  maker: string;
  deal_count: number;
  total_revenue: number;
  total_profit: number;
  avg_margin: number;
}

interface SupplierRow {
  supplier_name: string;
  deal_count: number;
  total_cost: number;
  avg_margin: number;
}

interface PeriodRow {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
  margin_pct: number;
}

// ─── Helpers ────────────────────────────────────────────────────

function fmtVnd(value: number): string {
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + ' ₫';
}

function MarginBadge({ pct }: { pct: number }) {
  const cls =
    pct >= 15
      ? 'bg-emerald-100 text-emerald-700'
      : pct >= 5
      ? 'bg-amber-100 text-amber-700'
      : 'bg-rose-100 text-rose-700';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {Number(pct ?? 0).toFixed(1)}%
    </span>
  );
}

// ─── KPI Card ───────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon: Icon,
  colorClass,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  colorClass: string;
  loading: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 flex items-center gap-4">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${colorClass}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">{label}</p>
        {loading ? (
          <div className="h-6 w-24 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-xl font-bold text-slate-900 mt-0.5">{value}</p>
        )}
      </div>
    </div>
  );
}

// ─── Tab types ───────────────────────────────────────────────────

type TabKey = 'deal' | 'maker' | 'supplier' | 'period';

const TABS: { id: TabKey; label: string }[] = [
  { id: 'deal', label: 'Theo deal' },
  { id: 'maker', label: 'Theo maker' },
  { id: 'supplier', label: 'Theo NCC' },
  { id: 'period', label: 'Theo tháng' },
];

// ─── Page ───────────────────────────────────────────────────────

export default function ProfitAnalysisPage() {
  const [months, setMonths] = useState(6);
  const [activeTab, setActiveTab] = useState<TabKey>('deal');

  const { data: overviewData, isLoading: overviewLoading } = useQuery<{ data: ProfitOverview }>({
    queryKey: ['profit-overview', months],
    queryFn: () => api.get(`/api/v1/profit-analysis/overview?months=${months}`),
    retry: false,
  });

  const { data: dealData, isLoading: dealLoading } = useQuery<{ data: DealRow[] }>({
    queryKey: ['profit-by-deal', months],
    queryFn: () => api.get(`/api/v1/profit-analysis/by-deal?months=${months}`),
    enabled: activeTab === 'deal',
    retry: false,
  });

  const { data: makerData, isLoading: makerLoading } = useQuery<{ data: MakerRow[] }>({
    queryKey: ['profit-by-maker', months],
    queryFn: () => api.get(`/api/v1/profit-analysis/by-maker?months=${months}`),
    enabled: activeTab === 'maker',
    retry: false,
  });

  const { data: supplierData, isLoading: supplierLoading } = useQuery<{ data: SupplierRow[] }>({
    queryKey: ['profit-by-supplier', months],
    queryFn: () => api.get(`/api/v1/profit-analysis/by-supplier?months=${months}`),
    enabled: activeTab === 'supplier',
    retry: false,
  });

  const { data: periodData, isLoading: periodLoading } = useQuery<{ data: PeriodRow[] }>({
    queryKey: ['profit-by-period', months],
    queryFn: () => api.get(`/api/v1/profit-analysis/by-period?months=${months}`),
    enabled: activeTab === 'period',
    retry: false,
  });

  const overview = overviewData?.data ?? (overviewData as any)?.items ?? overviewData;
  const dealsRaw = dealData?.data ?? (dealData as any)?.items ?? [];
  const deals = Array.isArray(dealsRaw) ? dealsRaw : [];
  const makersRaw = makerData?.data ?? (makerData as any)?.items ?? [];
  const makers = Array.isArray(makersRaw) ? makersRaw : [];
  const suppliersRaw = supplierData?.data ?? (supplierData as any)?.items ?? [];
  const suppliers = Array.isArray(suppliersRaw) ? suppliersRaw : [];
  const periodsRaw = periodData?.data ?? (periodData as any)?.items ?? [];
  const periods = Array.isArray(periodsRaw) ? periodsRaw : [];

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Phân tích lợi nhuận"
        subtitle="Tổng quan doanh thu, chi phí và biên lợi nhuận"
        icon={BarChart2}
        className="mb-6"
        actions={
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700"
          >
            <option value={3}>3 tháng</option>
            <option value={6}>6 tháng</option>
            <option value={12}>12 tháng</option>
            <option value={24}>24 tháng</option>
          </select>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Doanh thu"
          value={overview ? fmtVnd(overview.total_revenue) : '—'}
          icon={DollarSign}
          colorClass="bg-brand-50 text-brand-600"
          loading={overviewLoading}
        />
        <KpiCard
          label="Chi phí"
          value={overview ? fmtVnd(overview.total_cost) : '—'}
          icon={TrendingDown}
          colorClass="bg-rose-50 text-rose-600"
          loading={overviewLoading}
        />
        <KpiCard
          label="Lợi nhuận gộp"
          value={overview ? fmtVnd(overview.gross_profit) : '—'}
          icon={TrendingUp}
          colorClass="bg-emerald-50 text-emerald-600"
          loading={overviewLoading}
        />
        <KpiCard
          label="Margin TB"
          value={overview && overview.avg_margin_pct != null ? `${Number(overview.avg_margin_pct).toFixed(1)}%` : '—'}
          icon={BarChart2}
          colorClass={
            overview && overview.avg_margin_pct != null
              ? overview.avg_margin_pct >= 15
                ? 'bg-emerald-50 text-emerald-600'
                : overview.avg_margin_pct >= 5
                ? 'bg-amber-50 text-amber-600'
                : 'bg-rose-50 text-rose-600'
              : 'bg-slate-50 text-slate-600'
          }
          loading={overviewLoading}
        />
      </div>

      {/* Extra info row */}
      {overview && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Tổng số deal</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{overview.deal_count}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Deal tốt nhất</p>
            <p className="text-sm font-medium text-emerald-700 mt-0.5 truncate">{overview.best_deal ?? '—'}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Deal kém nhất</p>
            <p className="text-sm font-medium text-rose-700 mt-0.5 truncate">{overview.worst_deal ?? '—'}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-6 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200">

        {/* Theo deal */}
        {activeTab === 'deal' && (
          dealLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : deals.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
              Không có dữ liệu
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Chain code</th>
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">RFQ</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Doanh thu</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Chi phí</th>
                    <th className="text-center text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {deals.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm font-mono text-brand-600">{row.chain_code}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{row.rfq_number}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-slate-700">
                        {fmtVnd(row.revenue_vnd)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-slate-700">
                        {fmtVnd(row.total_cost_vnd)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <MarginBadge pct={row.margin_pct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Theo maker */}
        {activeTab === 'maker' && (
          makerLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : makers.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
              Không có dữ liệu
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Maker</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số deal</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Doanh thu</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Lợi nhuận</th>
                    <th className="text-center text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Margin TB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {makers.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.maker}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-slate-600">{row.deal_count}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-slate-700">{fmtVnd(row.total_revenue)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-emerald-700">{fmtVnd(row.total_profit)}</td>
                      <td className="px-4 py-3 text-center">
                        <MarginBadge pct={row.avg_margin} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Theo NCC */}
        {activeTab === 'supplier' && (
          supplierLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : suppliers.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
              Không có dữ liệu
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Nhà cung cấp</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số deal</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Tổng chi phí</th>
                    <th className="text-center text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Margin TB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {suppliers.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.supplier_name}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-slate-600">{row.deal_count}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-slate-700">{fmtVnd(row.total_cost)}</td>
                      <td className="px-4 py-3 text-center">
                        <MarginBadge pct={row.avg_margin} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Theo tháng */}
        {activeTab === 'period' && (
          periodLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : periods.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
              Không có dữ liệu
            </div>
          ) : (
            <div>
              {/* Line Chart */}
              <div className="p-6 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">
                  Doanh thu / Chi phí / Lợi nhuận theo tháng
                </h3>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={periods}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}tr`}
                    />
                    <Tooltip
                      formatter={(v: number, name: string) => [fmtVnd(v), name]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke={CHART.brand}
                      strokeWidth={2}
                      name="Doanh thu"
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="cost"
                      stroke={CHART.danger}
                      strokeWidth={2}
                      name="Chi phí"
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="profit"
                      stroke={CHART.success}
                      strokeWidth={2}
                      name="Lợi nhuận"
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Tháng</th>
                      <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Doanh thu</th>
                      <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Chi phí</th>
                      <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Lợi nhuận</th>
                      <th className="text-center text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {periods.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-slate-700">{row.month}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono text-brand-700">{fmtVnd(row.revenue)}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono text-rose-700">{fmtVnd(row.cost)}</td>
                        <td className="px-4 py-3 text-sm text-right font-mono text-emerald-700">{fmtVnd(row.profit)}</td>
                        <td className="px-4 py-3 text-center">
                          <MarginBadge pct={row.margin_pct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
