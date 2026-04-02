'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  TrendingUp, Search, Loader2, AlertCircle,
  BarChart2, TrendingDown, Activity, Hash,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, ZAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface PriceTrendItem {
  bqms_code: string | null;
  specification: string | null;
  maker: string | null;
  quoted_price_bqms_v1: number | null;
  quoted_price_bqms_v2: number | null;
  quoted_price_bqms_v3: number | null;
  quoted_price_bqms_v4: number | null;
  result: string | null;
  created_at: string | null;
  quantity?: number | null;
}

interface MakerBreakdown {
  maker: string;
  avg_price: number;
  count: number;
  win_rate?: number;
}

// ─── Colors ──────────────────────────────────────────────────────

const V_COLORS = {
  V1: '#3b82f6',
  V2: '#10b981',
  V3: '#f59e0b',
  V4: '#ef4444',
};

const BAR_COLORS = [
  '#6366f1', '#3b82f6', '#0ea5e9', '#10b981',
  '#84cc16', '#f59e0b', '#ef4444', '#ec4899',
  '#8b5cf6', '#14b8a6',
];

// ─── Helpers ─────────────────────────────────────────────────────

function safeNum(v: number | null | undefined): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtPrice(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function resultBadgeClass(result: string | null): string {
  if (!result) return 'bg-slate-100 text-slate-500';
  const r = result.toLowerCase();
  if (r.includes('won') || r.includes('win') || r.includes('thắng')) return 'bg-green-100 text-green-700';
  if (r.includes('los') || r.includes('thua')) return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-500';
}

// ─── Page Component ──────────────────────────────────────────────

export default function PriceTrendsPage() {
  const [bqmsCode, setBqmsCode] = useState('');
  const [maker, setMaker] = useState('');
  const [months, setMonths] = useState(12);
  const [activeTab, setActiveTab] = useState<'evolution' | 'maker' | 'scatter'>('evolution');

  // Fetch trend data
  const { data: trendsRaw, isLoading: trendsLoading, error: trendsError } = useQuery<{ data: PriceTrendItem[] }>({
    queryKey: ['price-trends', bqmsCode, maker, months],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('months', String(months));
      if (maker) p.set('maker', maker);
      if (bqmsCode) p.set('bqms_code', bqmsCode);
      return api.get(`/api/v1/price-analytics/price-trends?${p}`);
    },
    retry: false,
  });

  // Fetch maker breakdown
  const { data: makerRaw, isLoading: makerLoading } = useQuery<{ data: MakerBreakdown[] }>({
    queryKey: ['price-by-maker', months],
    queryFn: () => api.get(`/api/v1/price-analytics/by-maker?months=${months}`),
    retry: false,
  });

  const items: PriceTrendItem[] = trendsRaw?.data ?? [];
  const makerData: MakerBreakdown[] = (makerRaw?.data ?? []).slice(0, 10);

  // ── Stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!items.length) return null;
    const prices: number[] = [];
    items.forEach((item) => {
      [item.quoted_price_bqms_v1, item.quoted_price_bqms_v2,
        item.quoted_price_bqms_v3, item.quoted_price_bqms_v4].forEach((p) => {
        if (p != null && p > 0) prices.push(p);
      });
    });
    if (!prices.length) return null;
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const variance = prices.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / prices.length;
    const std = Math.sqrt(variance);
    return { avg, min, max, std, count: items.length };
  }, [items]);

  // ── Evolution chart data ───────────────────────────────────────
  const evolutionData = useMemo(() => {
    if (bqmsCode && items.length) {
      // Single code: show v1→v4 per record chronologically
      return items
        .filter((i) => i.bqms_code?.toLowerCase().includes(bqmsCode.toLowerCase()))
        .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
        .slice(0, 30)
        .map((item, idx) => ({
          name: item.bqms_code ?? `#${idx + 1}`,
          V1: safeNum(item.quoted_price_bqms_v1),
          V2: safeNum(item.quoted_price_bqms_v2),
          V3: safeNum(item.quoted_price_bqms_v3),
          V4: safeNum(item.quoted_price_bqms_v4),
        }))
        .filter((d) => d.V1 > 0 || d.V2 > 0 || d.V3 > 0 || d.V4 > 0);
    }

    // No code selected: group by month, average
    const byMonth: Record<string, { v1: number; v2: number; v3: number; v4: number; n: number }> = {};
    items.forEach((item) => {
      if (!item.created_at) return;
      const d = new Date(item.created_at);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = { v1: 0, v2: 0, v3: 0, v4: 0, n: 0 };
      const m = byMonth[key];
      const v1 = safeNum(item.quoted_price_bqms_v1);
      if (v1 > 0) { m.v1 += v1; m.n++; }
      m.v2 += safeNum(item.quoted_price_bqms_v2);
      m.v3 += safeNum(item.quoted_price_bqms_v3);
      m.v4 += safeNum(item.quoted_price_bqms_v4);
    });

    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, m]) => ({
        name: key,
        V1: m.n ? Math.round(m.v1 / m.n) : 0,
        V2: m.n ? Math.round(m.v2 / m.n) : 0,
        V3: m.n ? Math.round(m.v3 / m.n) : 0,
        V4: m.n ? Math.round(m.v4 / m.n) : 0,
      }))
      .filter((d) => d.V1 > 0);
  }, [items, bqmsCode]);

  // ── Scatter data ───────────────────────────────────────────────
  const scatterData = useMemo(() =>
    items
      .filter((i) => i.quoted_price_bqms_v1 != null && (i.quantity ?? 0) > 0)
      .slice(0, 200)
      .map((i) => ({
        x: safeNum(i.quantity),
        y: safeNum(i.quoted_price_bqms_v1),
        z: 30,
        label: i.bqms_code ?? '',
      })),
    [items]
  );

  const isLoading = trendsLoading || makerLoading;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-brand-600" />
            Xu Hướng Giá
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Phân tích biến động giá v1→v4 · So sánh Maker · Tối ưu giá
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm BQMS code..."
              value={bqmsCode}
              onChange={(e) => setBqmsCode(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <select
            value={maker}
            onChange={(e) => setMaker(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[160px]"
          >
            <option value="">Tất cả Maker</option>
            {makerData.map((m) => (
              <option key={m.maker} value={m.maker}>{m.maker}</option>
            ))}
          </select>

          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {[3, 6, 12].map((m) => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                  months === m ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {m} tháng
              </button>
            ))}
          </div>

          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-auto" />}
        </div>
      </div>

      {/* Error state */}
      {trendsError && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">Không thể tải dữ liệu giá. Vui lòng thử lại.</p>
        </div>
      )}

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <StatCard
            icon={<Activity className="h-4 w-4" />}
            label="Giá trung bình"
            value={`${fmtPrice(stats.avg)} ₫`}
            color="blue"
          />
          <StatCard
            icon={<TrendingDown className="h-4 w-4" />}
            label="Giá thấp nhất"
            value={`${fmtPrice(stats.min)} ₫`}
            color="green"
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Giá cao nhất"
            value={`${fmtPrice(stats.max)} ₫`}
            color="orange"
          />
          <StatCard
            icon={<Hash className="h-4 w-4" />}
            label="Độ lệch chuẩn"
            value={`${fmtPrice(stats.std)} ₫`}
            color="purple"
          />
        </div>
      )}

      {/* Chart tabs */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 mb-5">
        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-slate-100 px-4 pt-3">
          <ChartTab
            active={activeTab === 'evolution'}
            onClick={() => setActiveTab('evolution')}
            label="Biến động giá v1→v4"
            icon={<TrendingUp className="h-3.5 w-3.5" />}
          />
          <ChartTab
            active={activeTab === 'maker'}
            onClick={() => setActiveTab('maker')}
            label="So sánh Maker"
            icon={<BarChart2 className="h-3.5 w-3.5" />}
          />
          <ChartTab
            active={activeTab === 'scatter'}
            onClick={() => setActiveTab('scatter')}
            label="Giá vs Số lượng"
            icon={<Activity className="h-3.5 w-3.5" />}
          />
        </div>

        <div className="p-5">
          {/* Evolution chart */}
          {activeTab === 'evolution' && (
            <div>
              <p className="text-xs text-slate-400 mb-4">
                {bqmsCode
                  ? `Biến động giá v1→v4 cho mã: ${bqmsCode}`
                  : 'Giá trung bình theo tháng — tất cả mã'}
              </p>
              {trendsLoading ? (
                <ChartLoader />
              ) : evolutionData.length === 0 ? (
                <ChartEmpty />
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={evolutionData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => fmtPrice(v)}
                      width={56}
                    />
                    <Tooltip
                      formatter={(v: number, name: string) => [
                        v > 0 ? `${v.toLocaleString('vi-VN')} ₫` : '—',
                        name,
                      ]}
                      labelStyle={{ fontSize: 12 }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {(Object.entries(V_COLORS) as [keyof typeof V_COLORS, string][]).map(([key, color]) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={color}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Maker bar chart */}
          {activeTab === 'maker' && (
            <div>
              <p className="text-xs text-slate-400 mb-4">Giá bình quân top 10 nhà sản xuất</p>
              {makerLoading ? (
                <ChartLoader />
              ) : makerData.length === 0 ? (
                <ChartEmpty />
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart
                    data={makerData}
                    margin={{ top: 4, right: 16, bottom: 40, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="maker"
                      tick={{ fontSize: 11 }}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtPrice} width={56} />
                    <Tooltip
                      formatter={(v: number) => [`${v.toLocaleString('vi-VN')} ₫`, 'Giá TB']}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="avg_price" radius={[4, 4, 0, 0]}>
                      {makerData.map((_, i) => (
                        <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Scatter plot */}
          {activeTab === 'scatter' && (
            <div>
              <p className="text-xs text-slate-400 mb-4">Giá V1 vs Số lượng — xác định vùng giá tối ưu</p>
              {trendsLoading ? (
                <ChartLoader />
              ) : scatterData.length === 0 ? (
                <ChartEmpty />
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <ScatterChart margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Số lượng"
                      tick={{ fontSize: 11 }}
                      label={{ value: 'Số lượng', position: 'insideBottomRight', offset: -8, fontSize: 11 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Giá V1"
                      tick={{ fontSize: 11 }}
                      tickFormatter={fmtPrice}
                      width={56}
                    />
                    <ZAxis type="number" dataKey="z" range={[40, 120]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload;
                        return (
                          <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-xs">
                            <p className="font-mono text-brand-600 mb-1">{d.label}</p>
                            <p className="text-slate-600">SL: {(d.x as number).toLocaleString('vi-VN')}</p>
                            <p className="text-slate-600">Giá V1: {(d.y as number).toLocaleString('vi-VN')} ₫</p>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData} fill="#3b82f6" fillOpacity={0.6} />
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Data table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Dữ liệu chi tiết</h3>
          <span className="text-xs text-slate-400">{items.length} bản ghi</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <TH>BQMS</TH>
                <TH>Spec</TH>
                <TH>Maker</TH>
                <TH align="right">V1</TH>
                <TH align="right">V2</TH>
                <TH align="right">V3</TH>
                <TH align="right">V4</TH>
                <TH>Kết quả</TH>
                <TH>Ngày</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 && !trendsLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">
                    Không có dữ liệu
                  </td>
                </tr>
              )}
              {trendsLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-300 mx-auto" />
                  </td>
                </tr>
              )}
              {items.slice(0, 100).map((item, i) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-2.5 text-xs font-mono text-brand-600">
                    {item.bqms_code ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-600 max-w-[140px] truncate">
                    {item.specification ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-600">{item.maker ?? '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono text-slate-700">
                    {item.quoted_price_bqms_v1 != null && item.quoted_price_bqms_v1 > 0
                      ? item.quoted_price_bqms_v1.toLocaleString('vi-VN')
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono text-slate-700">
                    {item.quoted_price_bqms_v2 != null && item.quoted_price_bqms_v2 > 0
                      ? item.quoted_price_bqms_v2.toLocaleString('vi-VN')
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono text-slate-700">
                    {item.quoted_price_bqms_v3 != null && item.quoted_price_bqms_v3 > 0
                      ? item.quoted_price_bqms_v3.toLocaleString('vi-VN')
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono text-slate-700">
                    {item.quoted_price_bqms_v4 != null && item.quoted_price_bqms_v4 > 0
                      ? item.quoted_price_bqms_v4.toLocaleString('vi-VN')
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn('text-xs px-2 py-0.5 rounded font-medium', resultBadgeClass(item.result))}>
                      {item.result ?? 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-500">
                    {item.created_at
                      ? new Date(item.created_at).toLocaleDateString('vi-VN')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length > 100 && (
          <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400 text-center">
            Hiển thị 100 / {items.length} bản ghi
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function StatCard({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: 'blue' | 'green' | 'orange' | 'purple';
}) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    orange: 'bg-amber-50 text-amber-600',
    purple: 'bg-violet-50 text-violet-600',
  };
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn('p-1.5 rounded-md', colorMap[color])}>{icon}</div>
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p className="text-lg font-bold text-slate-800 font-mono">{value}</p>
    </div>
  );
}

function ChartTab({
  active, onClick, label, icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
        active
          ? 'border-brand-500 text-brand-600'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ChartLoader() {
  return (
    <div className="h-64 flex items-center justify-center text-slate-300">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
      Không có dữ liệu để hiển thị
    </div>
  );
}

function TH({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3',
        align === 'right' ? 'text-right' : 'text-left'
      )}
    >
      {children}
    </th>
  );
}
