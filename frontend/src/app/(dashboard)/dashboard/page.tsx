'use client';

import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Activity,
  BarChart3,
  Users,
  Zap,
  Target,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Constants ───────────────────────────────────────────────────

const C = {
  blue:   '#3b82f6',
  green:  '#10b981',
  amber:  '#f59e0b',
  red:    '#ef4444',
  purple: '#8b5cf6',
  slate:  '#64748b',
  blueFade:   '#dbeafe',
  greenFade:  '#d1fae5',
  amberFade:  '#fef3c7',
  redFade:    '#fee2e2',
  purpleFade: '#ede9fe',
};

const DONUT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#f97316', '#84cc16',
];

const VM = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];

// ─── Helpers ─────────────────────────────────────────────────────

function fmtVnd(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function monthLabel(isoMonth: string): string {
  // "2025-05" → "T5"
  const parts = isoMonth?.split('-');
  if (parts?.length >= 2) return `T${parseInt(parts[1], 10)}`;
  return isoMonth ?? '';
}

function daysSince(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
}

// ─── Custom Tooltips ─────────────────────────────────────────────

function VndTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white rounded-xl px-3 py-2 shadow-xl text-xs min-w-[140px]">
      <p className="font-semibold text-slate-300 mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-mono leading-5">
          {p.name}: {fmtVnd(p.value ?? 0)}
        </p>
      ))}
    </div>
  );
}

function CountTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white rounded-xl px-3 py-2 shadow-xl text-xs min-w-[140px]">
      <p className="font-semibold text-slate-300 mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="leading-5">
          {p.name}: {(p.value ?? 0).toLocaleString('vi-VN')}
        </p>
      ))}
    </div>
  );
}

function WinRateTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white rounded-xl px-3 py-2 shadow-xl text-xs min-w-[140px]">
      <p className="font-semibold text-slate-300 mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="leading-5">
          {p.name}: {(p.value ?? 0).toFixed(1)}%
        </p>
      ))}
    </div>
  );
}

// ─── Ring Progress ───────────────────────────────────────────────

function RingProgress({ value, max = 100, color, size = 52 }: { value: number; max?: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(value / max, 1) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={6} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={6}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Sparkline ───────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data?.length) return null;
  const pts = data.map((v, i) => ({ i, v }));
  const gradId = `sg-${color.replace('#', '')}`;
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={pts} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Section Header ──────────────────────────────────────────────

function SectionHeader({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      {icon && (
        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
          {icon}
        </div>
      )}
      <div>
        <h2 className="text-sm font-bold text-slate-800 leading-tight">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-slate-100 rounded-lg', className)} />;
}

// ─── Page ────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();

  const { data: raw, isLoading } = useQuery({
    queryKey: ['dashboard-v2'],
    queryFn: () => api.get<any>('/api/v1/dashboard/kpis-v2'),
    refetchInterval: 30_000,
    retry: 2,
  });

  const d = raw?.data ?? {};

  // ── Scalar KPIs ────────────────────────────────────────────────
  const rfqThisMonth  = d.rfq_this_month   ?? 0;
  const rfqMomPct     = d.rfq_mom_pct      ?? 0;
  const rfqSpark: number[] = Array.isArray(d.rfq_spark) ? d.rfq_spark : [];
  const winRate3m     = d.win_rate_3m      ?? 0;
  const winRateDelta  = d.win_rate_delta   ?? 0;
  const won3m         = d.won_3m           ?? 0;
  const decided3m     = d.decided_3m       ?? 0;
  const revThisMonth  = d.revenue_this_month ?? 0;
  const revMomPct     = d.revenue_mom_pct    ?? 0;
  const rfqPending    = d.rfq_pending        ?? 0;
  const rfqOverdue    = d.rfq_overdue        ?? 0;

  // ── Arrays ─────────────────────────────────────────────────────
  const monthlyRevenue: any[] = Array.isArray(d.monthly_revenue) ? d.monthly_revenue : [];
  const yoy: any[]            = Array.isArray(d.yoy)             ? d.yoy             : [];
  const funnel: any           = d.funnel ?? {};
  const winRateTrend: any[]   = Array.isArray(d.win_rate_trend)  ? d.win_rate_trend  : [];
  const makers: any[]         = Array.isArray(d.makers)          ? d.makers          : [];
  const owners: any[]         = Array.isArray(d.owners)          ? d.owners          : [];
  const urgentRfqs: any[]     = Array.isArray(d.urgent_rfqs)     ? d.urgent_rfqs     : [];

  // ── Derived chart data ─────────────────────────────────────────

  // Section 2 – Revenue bar chart
  const revenueChartData = monthlyRevenue.map((m: any) => ({
    name: monthLabel(m.month ?? ''),
    'Báo giá':    m.total_quoted ?? 0,
    'Chốt được':  m.won_revenue  ?? 0,
  }));

  // Section 2 – YoY line chart
  const currentYear = new Date().getFullYear();
  const yoyChartData = yoy.map((y: any, i: number) => ({
    name: VM[i] ?? `T${y.month_num ?? i + 1}`,
    [`Năm ${currentYear}`]:     y.rfq_this_year  ?? 0,
    [`Năm ${currentYear - 1}`]: y.rfq_last_year  ?? 0,
  }));

  // Section 3 – Funnel
  const funnelStages = [
    { label: 'RFQ nhận được', value: funnel.rfq_received ?? 0, color: C.blue },
    { label: 'Đã báo giá',    value: funnel.quoted       ?? 0, color: C.purple },
    { label: 'Đã thắng',      value: funnel.won          ?? 0, color: C.green },
    { label: 'Đã giao hàng',  value: funnel.delivered    ?? 0, color: C.amber },
    { label: 'Đã xuất hóa đơn', value: funnel.invoiced   ?? 0, color: C.slate },
  ];
  const funnelMax = funnelStages[0]?.value || 1;

  // Section 3 – Win rate trend + average
  const avgWinRate = winRateTrend.length
    ? winRateTrend.reduce((s: number, r: any) => s + (r.win_rate ?? 0), 0) / winRateTrend.length
    : 0;
  const winRateChartData = winRateTrend.map((r: any) => ({
    name:        monthLabel(r.month ?? ''),
    'Tỷ lệ thắng': r.win_rate ?? 0,
  }));

  // Section 4 – Owners horizontal bar
  const ownersChartData = [...owners]
    .sort((a: any, b: any) => (b.win_rate ?? 0) - (a.win_rate ?? 0))
    .map((o: any) => ({
      name:           o.owner ?? '',
      'Được giao':    o.total  ?? 0,
      'Đã thắng':     o.won    ?? 0,
      'Tỷ lệ':        o.win_rate ?? 0,
    }));

  // Section 4 – Makers donut
  const makersChartData = makers.map((m: any) => ({
    name:  m.maker    ?? '',
    value: m.total    ?? 0,
    won:   m.won      ?? 0,
    rate:  m.win_rate ?? 0,
  }));

  // ── Funnel conversion helpers ──────────────────────────────────
  function convPct(from: number, to: number): string {
    if (!from) return '—';
    return `${Math.round((to / from) * 100)}%`;
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-8">

      {/* ═══ SECTION 1: Executive Pulse ═══════════════════════════ */}
      <section>
        <SectionHeader
          title="Tổng quan điều hành"
          subtitle="Cập nhật mỗi 30 giây"
          icon={<Activity className="w-4 h-4" />}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

          {/* Card 1 — RFQ tháng này */}
          {isLoading ? (
            <Skeleton className="h-36" />
          ) : (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-50">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                </div>
                <span className={cn(
                  'flex items-center gap-0.5 text-xs font-bold px-2 py-1 rounded-full',
                  rfqMomPct > 0 ? 'bg-emerald-50 text-emerald-700' :
                  rfqMomPct < 0 ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'
                )}>
                  {rfqMomPct > 0 ? <ArrowUpRight className="w-3 h-3" /> :
                   rfqMomPct < 0 ? <ArrowDownRight className="w-3 h-3" /> :
                   <Minus className="w-3 h-3" />}
                  {Math.abs(rfqMomPct).toFixed(1)}%
                </span>
              </div>
              <p className="text-3xl font-black text-slate-900 font-mono">{rfqThisMonth.toLocaleString('vi-VN')}</p>
              <p className="text-xs text-slate-400 font-medium mt-0.5 mb-3">RFQ tháng này</p>
              <Sparkline data={rfqSpark} color={C.blue} />
            </div>
          )}

          {/* Card 2 — Tỷ lệ thắng */}
          {isLoading ? (
            <Skeleton className="h-36" />
          ) : (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-green-50">
                  <Target className="w-5 h-5 text-green-600" />
                </div>
                <span className={cn(
                  'flex items-center gap-0.5 text-xs font-bold px-2 py-1 rounded-full',
                  winRateDelta > 0 ? 'bg-emerald-50 text-emerald-700' :
                  winRateDelta < 0 ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'
                )}>
                  {winRateDelta > 0 ? <ArrowUpRight className="w-3 h-3" /> :
                   winRateDelta < 0 ? <ArrowDownRight className="w-3 h-3" /> :
                   <Minus className="w-3 h-3" />}
                  {Math.abs(winRateDelta).toFixed(1)} điểm %
                </span>
              </div>
              <div className="flex items-end gap-3">
                <div>
                  <p className="text-3xl font-black text-slate-900 font-mono">{winRate3m.toFixed(1)}%</p>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">Tỷ lệ thắng 3 tháng</p>
                  <p className="text-xs text-slate-400 mt-1">{won3m} / {decided3m} RFQ đã quyết</p>
                </div>
                <div className="ml-auto">
                  <RingProgress value={winRate3m} max={100} color={C.green} size={52} />
                </div>
              </div>
            </div>
          )}

          {/* Card 3 — Doanh thu tháng */}
          {isLoading ? (
            <Skeleton className="h-36" />
          ) : (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-purple-50">
                  <TrendingUp className="w-5 h-5 text-purple-600" />
                </div>
                <span className={cn(
                  'flex items-center gap-0.5 text-xs font-bold px-2 py-1 rounded-full',
                  revMomPct > 0 ? 'bg-emerald-50 text-emerald-700' :
                  revMomPct < 0 ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'
                )}>
                  {revMomPct > 0 ? <ArrowUpRight className="w-3 h-3" /> :
                   revMomPct < 0 ? <ArrowDownRight className="w-3 h-3" /> :
                   <Minus className="w-3 h-3" />}
                  {Math.abs(revMomPct).toFixed(1)}%
                </span>
              </div>
              <p className="text-3xl font-black text-slate-900 font-mono">{fmtVnd(revThisMonth)}</p>
              <p className="text-xs text-slate-400 font-medium mt-0.5">Doanh thu tháng này (VND)</p>
              <div className="mt-3 h-9">
                <Sparkline
                  data={monthlyRevenue.map((m: any) => m.won_revenue ?? 0)}
                  color={C.purple}
                />
              </div>
            </div>
          )}

          {/* Card 4 — Cần xử lý */}
          {isLoading ? (
            <Skeleton className="h-36" />
          ) : (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-50">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                {rfqOverdue > 0 && (
                  <span className="flex items-center gap-0.5 text-xs font-bold px-2 py-1 rounded-full bg-red-100 text-red-700">
                    <AlertTriangle className="w-3 h-3" />
                    {rfqOverdue} quá hạn
                  </span>
                )}
              </div>
              <p className="text-3xl font-black text-slate-900 font-mono">{rfqPending.toLocaleString('vi-VN')}</p>
              <p className="text-xs text-slate-400 font-medium mt-0.5 mb-3">RFQ đang chờ xử lý</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-400 rounded-full transition-all"
                    style={{ width: rfqPending ? `${Math.min((rfqOverdue / rfqPending) * 100, 100)}%` : '0%' }}
                  />
                </div>
                <span className="text-xs text-slate-400 shrink-0">
                  {rfqPending ? Math.round((rfqOverdue / rfqPending) * 100) : 0}% quá hạn
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ═══ SECTION 2: Revenue & Comparison ═════════════════════ */}
      <section>
        <SectionHeader
          title="Doanh thu & So sánh"
          subtitle="12 tháng gần nhất"
          icon={<BarChart3 className="w-4 h-4" />}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Left — Grouped bar: total_quoted vs won_revenue */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs font-semibold text-slate-600 mb-4">Báo giá vs Doanh thu chốt (VND)</p>
            {isLoading ? <Skeleton className="h-56" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revenueChartData} barCategoryGap="30%" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtVnd} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<VndTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="Báo giá"   fill={C.blue}  radius={[3,3,0,0]} />
                  <Bar dataKey="Chốt được" fill={C.green} radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Right — YoY line chart */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs font-semibold text-slate-600 mb-4">So sánh RFQ năm nay vs năm ngoái</p>
            {isLoading ? <Skeleton className="h-56" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={yoyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip content={<CountTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line
                    dataKey={`Năm ${currentYear}`}
                    stroke={C.blue} strokeWidth={2.5}
                    dot={{ r: 3, fill: C.blue }} activeDot={{ r: 5 }}
                    type="monotone"
                  />
                  <Line
                    dataKey={`Năm ${currentYear - 1}`}
                    stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 3"
                    dot={{ r: 3, fill: '#94a3b8' }} activeDot={{ r: 5 }}
                    type="monotone"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 3: Funnel + Win Rate Trend ══════════════════ */}
      <section>
        <SectionHeader
          title="Phễu bán hàng & Xu hướng tỷ lệ thắng"
          subtitle="Chuyển đổi từng giai đoạn"
          icon={<Zap className="w-4 h-4" />}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Left — Funnel */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs font-semibold text-slate-600 mb-5">Phễu chuyển đổi</p>
            {isLoading ? <Skeleton className="h-56" /> : (
              <div className="space-y-3">
                {funnelStages.map((stage, idx) => {
                  const widthPct = funnelMax ? Math.max((stage.value / funnelMax) * 100, 4) : 4;
                  const prevVal  = idx > 0 ? funnelStages[idx - 1].value : null;
                  const conv     = prevVal !== null ? convPct(prevVal, stage.value) : null;
                  return (
                    <div key={stage.label}>
                      {conv && (
                        <div className="flex items-center gap-1.5 mb-1 ml-1">
                          <div className="w-px h-3 bg-slate-200" />
                          <span className="text-xs text-slate-400">{conv} chuyển đổi</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <div className="w-[130px] shrink-0 text-right">
                          <span className="text-xs text-slate-500 font-medium truncate block">{stage.label}</span>
                        </div>
                        <div className="flex-1 h-7 bg-slate-50 rounded-lg overflow-hidden relative">
                          <div
                            className="h-full rounded-lg transition-all duration-700 ease-out flex items-center justify-end pr-2"
                            style={{ width: `${widthPct}%`, backgroundColor: stage.color }}
                          >
                            <span className="text-white text-xs font-bold drop-shadow">
                              {stage.value.toLocaleString('vi-VN')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right — Win rate area trend */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-slate-600">Xu hướng tỷ lệ thắng 12 tháng</p>
              {avgWinRate > 0 && (
                <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
                  TB: {avgWinRate.toFixed(1)}%
                </span>
              )}
            </div>
            {isLoading ? <Skeleton className="h-56" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={winRateChartData}>
                  <defs>
                    <linearGradient id="wr-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.green} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false} tickLine={false} width={36}
                  />
                  <Tooltip content={<WinRateTooltip />} />
                  {avgWinRate > 0 && (
                    <ReferenceLine
                      y={avgWinRate} stroke={C.amber}
                      strokeDasharray="4 3" strokeWidth={1.5}
                      label={{ value: `TB ${avgWinRate.toFixed(1)}%`, position: 'insideTopRight', fontSize: 10, fill: C.amber }}
                    />
                  )}
                  <Area
                    type="monotone" dataKey="Tỷ lệ thắng"
                    stroke={C.green} strokeWidth={2.5}
                    fill="url(#wr-fill)"
                    dot={{ r: 3, fill: C.green }} activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 4: Maker Distribution + Owner Performance ═══ */}
      <section>
        <SectionHeader
          title="Phân tích nhà sản xuất & Hiệu suất nhân viên"
          subtitle="Dữ liệu tích lũy"
          icon={<Users className="w-4 h-4" />}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Left — Makers donut */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs font-semibold text-slate-600 mb-4">Top maker (theo số RFQ)</p>
            {isLoading ? <Skeleton className="h-64" /> : (
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <ResponsiveContainer width={180} height={180}>
                    <PieChart>
                      <Pie
                        data={makersChartData}
                        cx="50%" cy="50%"
                        innerRadius={52} outerRadius={78}
                        paddingAngle={2}
                        dataKey="value"
                        isAnimationActive
                      >
                        {makersChartData.map((_: any, i: number) => (
                          <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: any, name: any, props: any) => [
                          `${val} RFQ (Win: ${props.payload.rate?.toFixed(1)}%)`, name
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-lg font-black text-slate-800">{makers.length}</span>
                    <span className="text-[10px] text-slate-400 text-center leading-tight">makers</span>
                  </div>
                </div>
                <div className="flex-1 space-y-2 min-w-0">
                  {makersChartData.slice(0, 8).map((m: any, i: number) => (
                    <div key={m.name} className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
                      />
                      <span className="text-xs text-slate-700 font-medium truncate flex-1">{m.name}</span>
                      <span className="text-xs text-slate-400 font-mono shrink-0">{m.value}</span>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: m.rate >= 30 ? C.greenFade : C.amberFade,
                          color: m.rate >= 30 ? C.green : C.amber,
                        }}
                      >
                        {m.rate?.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right — Owners horizontal bar */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs font-semibold text-slate-600 mb-4">Hiệu suất nhân viên (sắp xếp theo tỷ lệ thắng)</p>
            {isLoading ? <Skeleton className="h-64" /> : (
              <ResponsiveContainer width="100%" height={Math.max(ownersChartData.length * 36 + 30, 200)}>
                <BarChart data={ownersChartData} layout="vertical" barCategoryGap="25%" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category" dataKey="name" width={110}
                    tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false}
                  />
                  <Tooltip content={<CountTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Được giao" fill={C.blue}  radius={[0,3,3,0]} />
                  <Bar dataKey="Đã thắng"  fill={C.green} radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 5: Action Required ══════════════════════════ */}
      <section>
        <SectionHeader
          title="Cần xử lý ngay"
          subtitle="RFQ khẩn cấp cần hành động"
          icon={<AlertTriangle className="w-4 h-4" />}
        />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Left 60% — Urgent RFQ table */}
          <div className="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-50 flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-600">Danh sách RFQ khẩn cấp</p>
              <span className="text-xs text-slate-400">{urgentRfqs.length} mục</span>
            </div>

            {isLoading ? (
              <div className="p-5 space-y-3">
                {[1,2,3].map(i => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : urgentRfqs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                <AlertTriangle className="w-8 h-8 mb-2" />
                <p className="text-sm">Không có RFQ khẩn cấp</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">Số RFQ</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">Mã BQMS</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">Maker</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">Ngày nhận</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">Tình trạng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {urgentRfqs.map((rfq: any, i: number) => {
                      const days = daysSince(rfq.inquiry_date ?? rfq.created_at ?? '');
                      const isOverdue = days > 3;
                      const isWarning = !isOverdue && days > 0;
                      return (
                        <tr
                          key={rfq.rfq_number ?? i}
                          onClick={() => router.push(`/bqms/quotation/new?rfq_code=${rfq.bqms_code ?? rfq.rfq_number ?? ''}`)}
                          className={cn(
                            'border-t border-slate-50 cursor-pointer transition-colors',
                            isOverdue ? 'bg-red-50 hover:bg-red-100' :
                            isWarning ? 'bg-amber-50 hover:bg-amber-100' :
                            'hover:bg-slate-50'
                          )}
                        >
                          <td className="px-4 py-2.5 font-mono font-semibold text-slate-800">
                            {rfq.rfq_number ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-500">
                            {rfq.bqms_code ?? '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="font-semibold text-slate-700">{rfq.maker ?? '—'}</span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">
                            {rfq.inquiry_date ? new Date(rfq.inquiry_date).toLocaleDateString('vi-VN') : '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            {isOverdue ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                                <AlertTriangle className="w-2.5 h-2.5" /> Quá hạn
                              </span>
                            ) : isWarning ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
                                <Clock className="w-2.5 h-2.5" /> Sắp hạn
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                                Mới nhận
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right 40% — Alert cards */}
          <div className="lg:col-span-2 space-y-4">

            {/* Pending */}
            <div className={cn(
              'rounded-2xl p-5 border',
              rfqPending > 0 ? 'bg-amber-50 border-amber-100' : 'bg-white border-slate-100'
            )}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-100 shrink-0">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-black text-amber-800 font-mono">{rfqPending.toLocaleString('vi-VN')}</p>
                  <p className="text-sm font-semibold text-amber-700 mt-0.5">RFQ đang chờ xử lý</p>
                  <p className="text-xs text-amber-500 mt-1">
                    Cần phân tích & báo giá trong thời gian sớm nhất
                  </p>
                </div>
              </div>
            </div>

            {/* Overdue */}
            <div className={cn(
              'rounded-2xl p-5 border',
              rfqOverdue > 0 ? 'bg-red-50 border-red-100' : 'bg-white border-slate-100'
            )}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-100 shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-black text-red-800 font-mono">{rfqOverdue.toLocaleString('vi-VN')}</p>
                  <p className="text-sm font-semibold text-red-700 mt-0.5">RFQ quá hạn xử lý</p>
                  <p className="text-xs text-red-400 mt-1">
                    Đã vượt quá thời gian phản hồi cho phép
                  </p>
                </div>
              </div>
              {rfqOverdue > 0 && (
                <button
                  onClick={() => router.push('/bqms/quotation?filter=overdue')}
                  className="mt-3 w-full text-xs font-semibold text-red-600 bg-red-100 hover:bg-red-200 transition-colors py-2 rounded-xl"
                >
                  Xem tất cả RFQ quá hạn →
                </button>
              )}
            </div>

            {/* Win rate summary */}
            <div className="bg-white rounded-2xl p-5 border border-slate-100">
              <p className="text-xs font-semibold text-slate-500 mb-3">Tổng kết hiệu suất</p>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Tỷ lệ thắng 3 tháng</span>
                  <span className="text-sm font-bold text-slate-800 font-mono">{winRate3m.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">RFQ đã thắng</span>
                  <span className="text-sm font-bold text-green-700 font-mono">{won3m.toLocaleString('vi-VN')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">RFQ đã quyết định</span>
                  <span className="text-sm font-bold text-slate-800 font-mono">{decided3m.toLocaleString('vi-VN')}</span>
                </div>
                <div className="h-px bg-slate-100 my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">So kỳ trước</span>
                  <span className={cn(
                    'text-xs font-bold',
                    winRateDelta > 0 ? 'text-green-600' : winRateDelta < 0 ? 'text-red-500' : 'text-slate-400'
                  )}>
                    {fmtPct(winRateDelta)}
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

    </div>
  );
}
