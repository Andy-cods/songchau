'use client';

import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowUpRight,
  ArrowRight,
  BarChart3,
  Target,
  Truck,
  FileText,
  Clock,
  ChevronRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/* ================================================================
   DESIGN SYSTEM
   ================================================================ */

const COLORS = {
  blue:      '#2563eb',
  blueLight: '#60a5fa',
  blueFade:  '#eff6ff',
  emerald:   '#059669',
  emeraldLt: '#34d399',
  emeraldFd: '#ecfdf5',
  amber:     '#d97706',
  amberFade: '#fffbeb',
  red:       '#dc2626',
  redFade:   '#fef2f2',
  violet:    '#7c3aed',
  violetFd:  '#f5f3ff',
  slate900:  '#0f172a',

  // Chart palette — 8 colors, carefully curated
  donut: [
    '#2563eb', '#059669', '#d97706', '#7c3aed',
    '#dc2626', '#0891b2', '#ea580c', '#65a30d',
  ],
};

const MONTH_SHORT = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];

/* ================================================================
   FORMATTERS
   ================================================================ */

function fmtVnd(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtNum(n: number): string {
  return n.toLocaleString('vi-VN');
}

function monthLabel(isoMonth: string): string {
  const parts = isoMonth?.split('-');
  if (parts?.length >= 2) return `T${parseInt(parts[1], 10)}`;
  return isoMonth ?? '';
}

function daysSince(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
}

function convPct(from: number, to: number): string {
  if (!from) return '0%';
  return `${((to / from) * 100).toFixed(1)}%`;
}

/* ================================================================
   SHARED COMPONENTS
   ================================================================ */

/** Tooltip for Recharts — dark glass morphism style */
function ChartTooltip({ active, payload, label, valueFormatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white rounded-lg px-3.5 py-2.5 shadow-xl text-xs border border-slate-700/50">
      <p className="font-medium text-slate-400 mb-1.5 text-[11px]">{label}</p>
      <div className="space-y-1">
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-slate-300">{entry.name}</span>
            <span className="font-mono font-semibold ml-auto pl-3">
              {valueFormatter ? valueFormatter(entry.value) : fmtNum(entry.value ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton loader with subtle shimmer */
function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn(
      'animate-pulse rounded-xl',
      'bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 bg-[length:200%_100%]',
      className
    )} />
  );
}

/* ================================================================
   MAIN DASHBOARD
   ================================================================ */

export default function DashboardPage() {
  const router = useRouter();

  const { data: raw, isLoading } = useQuery({
    queryKey: ['dashboard-v2'],
    queryFn: () => api.get<any>('/api/v1/dashboard/kpis-v2'),
    refetchInterval: 30_000,
    retry: 2,
  });

  const d = raw?.data ?? {};

  /* ── Scalar KPIs ──────────────────────────────────────────── */
  const rfqThisMonth  = d.rfq_this_month   ?? 0;
  const rfqMomPct     = d.rfq_mom_pct      ?? 0;
  const winRate3m     = d.win_rate_3m       ?? 0;
  const won3m         = d.won_3m            ?? 0;
  const decided3m     = d.decided_3m        ?? 0;
  const revThisMonth  = d.revenue_this_month ?? 0;
  const rfqPending    = d.rfq_pending       ?? 0;
  const rfqOverdue    = d.rfq_overdue       ?? 0;

  /* ── Arrays ───────────────────────────────────────────────── */
  const monthlyRevenue: any[] = Array.isArray(d.monthly_revenue) ? d.monthly_revenue : [];
  const yoy: any[]            = Array.isArray(d.yoy)             ? d.yoy             : [];
  const funnel: any           = d.funnel ?? {};
  const winRateTrend: any[]   = Array.isArray(d.win_rate_trend)  ? d.win_rate_trend  : [];
  const makers: any[]         = Array.isArray(d.makers)          ? d.makers          : [];
  const owners: any[]         = Array.isArray(d.owners)          ? d.owners          : [];
  const urgentRfqs: any[]     = Array.isArray(d.urgent_rfqs)     ? d.urgent_rfqs     : [];

  /* ── NEW: Delivery + PO + Vendor data ──────────────────────── */
  const delivery: any          = d.delivery ?? {};
  const deliveryOverdue: any[] = Array.isArray(d.delivery_overdue) ? d.delivery_overdue : [];
  const samsungPo: any         = d.samsung_po ?? {};
  const recentPos: any[]       = Array.isArray(d.recent_pos) ? d.recent_pos : [];
  const vendorPortal: any      = d.vendor_portal ?? {};

  /* ── Derived data ─────────────────────────────────────────── */

  // Revenue proxy: use total_quoted from monthly if no revenue_this_month
  const revenueProxy = revThisMonth || (monthlyRevenue.length > 0
    ? monthlyRevenue[monthlyRevenue.length - 1]?.total_quoted ?? 0
    : 0);

  const revenueChartData = monthlyRevenue.map((m: any) => ({
    name: monthLabel(m.month ?? ''),
    quoted: m.total_quoted ?? 0,
    won:    m.won_revenue  ?? 0,
    rfq:    m.total_rfq    ?? 0,
  }));

  const currentYear = new Date().getFullYear();
  const yoyChartData = yoy.map((y: any, i: number) => ({
    name: MONTH_SHORT[i] ?? `T${y.month_num ?? i + 1}`,
    thisYear: y.rfq_this_year  ?? 0,
    lastYear: y.rfq_last_year  ?? 0,
  }));

  const funnelStages = [
    { key: 'rfq',       label: 'RFQ nhận',    value: funnel.rfq_received ?? 0, icon: <FileText className="w-4 h-4" />, color: COLORS.blue },
    { key: 'quoted',    label: 'Đã báo giá', value: funnel.quoted       ?? 0, icon: <BarChart3 className="w-4 h-4" />, color: COLORS.violet },
    { key: 'won',       label: 'Đã thắng',   value: funnel.won          ?? 0, icon: <Target className="w-4 h-4" />,   color: COLORS.emerald },
    { key: 'delivered', label: 'Giao hàng',   value: funnel.delivered    ?? 0, icon: <Truck className="w-4 h-4" />,    color: COLORS.amber },
    { key: 'invoiced',  label: 'Xuất HĐ',    value: funnel.invoiced     ?? 0, icon: <ArrowRight className="w-4 h-4" />, color: '#64748b' },
  ];
  const funnelMax = funnelStages[0]?.value || 1;

  const toNum = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const makersDonut = makers.map((m: any) => ({
    name:  m.maker ?? '',
    value: toNum(m.total),
    won:   toNum(m.won),
    rate:  toNum(m.win_rate),
  }));

  const avgWinRate = winRateTrend.length
    ? winRateTrend.reduce((s: number, r: any) => s + (r.win_rate ?? 0), 0) / winRateTrend.length
    : 0;

  /* ── Current date display ─────────────────────────────────── */
  const now = new Date();
  const monthDisplay = now.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });

  /* ══════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-[#fafbfc]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8 space-y-8">

        {/* ─────────────────────────────────────────────────────────
            HEADER
            ───────────────────────────────────────────────────────── */}
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Tổng quan
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Theo dõi hiệu suất kinh doanh &mdash; cập nhật mỗi 30 giây
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-white border border-slate-200/60 rounded-lg px-3 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Live
            </div>
            <span className="text-[13px] font-medium text-slate-500 capitalize">
              {monthDisplay}
            </span>
          </div>
        </header>

        {/* ─────────────────────────────────────────────────────────
            HERO KPI ROW — 4 big numbers
            ───────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {isLoading ? (
            <>
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-[140px]" />)}
            </>
          ) : (
            <>
              {/* KPI 1 — RFQ This Month */}
              <div className="bg-white rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-100/80 group hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-shadow duration-300">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[13px] font-medium text-slate-500">RFQ tháng này</span>
                  <span className={cn(
                    'inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-md',
                    rfqMomPct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600',
                  )}>
                    {rfqMomPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {rfqMomPct >= 0 ? '+' : ''}{rfqMomPct.toFixed(1)}%
                  </span>
                </div>
                <p className="text-4xl font-extrabold text-slate-900 tracking-tight">
                  {fmtNum(rfqThisMonth)}
                </p>
                <p className="text-xs text-slate-400 mt-2">so với tháng trước</p>
              </div>

              {/* KPI 2 — Win Rate 3 months */}
              <div className="bg-white rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-100/80 group hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-shadow duration-300">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[13px] font-medium text-slate-500">Win Rate (3 tháng)</span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md">
                    {won3m}/{decided3m}
                  </span>
                </div>
                <p className="text-4xl font-extrabold text-emerald-600 tracking-tight">
                  {winRate3m.toFixed(1)}%
                </p>
                <div className="mt-3 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                    style={{ width: `${Math.min(winRate3m, 100)}%` }}
                  />
                </div>
              </div>

              {/* KPI 3 — Total RFQ (pending pipeline) */}
              <div className="bg-white rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-100/80 group hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-shadow duration-300">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[13px] font-medium text-slate-500">Tổng RFQ pipeline</span>
                  {revenueProxy > 0 && (
                    <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                      {fmtVnd(revenueProxy)} quoted
                    </span>
                  )}
                </div>
                <p className="text-4xl font-extrabold text-slate-900 tracking-tight">
                  {fmtNum(funnel.rfq_received ?? rfqPending)}
                </p>
                <p className="text-xs text-slate-400 mt-2">{fmtNum(rfqPending)} đang chờ xử lý</p>
              </div>

              {/* KPI 4 — Overdue Alert */}
              <div className={cn(
                'rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] border group hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-shadow duration-300',
                rfqOverdue > 100
                  ? 'bg-red-50/70 border-red-200/60'
                  : rfqOverdue > 0
                  ? 'bg-amber-50/50 border-amber-200/60'
                  : 'bg-white border-slate-100/80'
              )}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[13px] font-medium text-slate-500">Quá hạn</span>
                  {rfqOverdue > 0 && (
                    <AlertTriangle className={cn(
                      'w-4 h-4',
                      rfqOverdue > 100 ? 'text-red-500' : 'text-amber-500'
                    )} />
                  )}
                </div>
                <p className={cn(
                  'text-4xl font-extrabold tracking-tight',
                  rfqOverdue > 100 ? 'text-red-600' : rfqOverdue > 0 ? 'text-amber-600' : 'text-slate-900'
                )}>
                  {fmtNum(rfqOverdue)}
                </p>
                <p className="text-xs mt-2">
                  {rfqOverdue > 0 ? (
                    <button
                      onClick={() => router.push('/bqms/quotation?filter=overdue')}
                      className="text-red-600 font-medium hover:underline inline-flex items-center gap-1"
                    >
                      Cần xử lý ngay <ArrowUpRight className="w-3 h-3" />
                    </button>
                  ) : (
                    <span className="text-emerald-600 font-medium">Tuyệt vời! Không có quá hạn</span>
                  )}
                </p>
              </div>
            </>
          )}
        </section>

        {/* ─────────────────────────────────────────────────────────
            CHARTS ROW — Monthly Activity + YoY Comparison
            ───────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Monthly Activity — stacked bar */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-100/80 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-base font-semibold text-slate-700">Hoạt động theo tháng</h2>
                <p className="text-xs text-slate-400 mt-0.5">Giá trị báo giá vs. doanh thu tháng</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="w-2.5 h-2.5 rounded-[3px] bg-blue-500" /> Báo giá
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="w-2.5 h-2.5 rounded-[3px] bg-emerald-500" /> Chốt được
                </span>
              </div>
            </div>
            {isLoading ? <Skeleton className="h-[280px]" /> : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={revenueChartData} barCategoryGap="25%" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    tickFormatter={fmtVnd}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false} tickLine={false}
                    width={50}
                  />
                  <Tooltip content={<ChartTooltip valueFormatter={fmtVnd} />} />
                  <Bar dataKey="quoted" name="Báo giá" fill={COLORS.blue} radius={[4,4,0,0]} />
                  <Bar dataKey="won" name="Chốt được" fill={COLORS.emerald} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* YoY Comparison — area + dashed line */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-100/80 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-base font-semibold text-slate-700">So sánh cùng kỳ</h2>
                <p className="text-xs text-slate-400 mt-0.5">RFQ năm nay vs. năm trước</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> {currentYear}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="w-2.5 h-2.5 rounded-full border-2 border-slate-300" /> {currentYear - 1}
                </span>
              </div>
            </div>
            {isLoading ? <Skeleton className="h-[280px]" /> : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={yoyChartData}>
                  <defs>
                    <linearGradient id="grad-this-year" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.blue} stopOpacity={0.12} />
                      <stop offset="100%" stopColor={COLORS.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false} tickLine={false}
                    width={40}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="thisYear"
                    name={`${currentYear}`}
                    stroke={COLORS.blue}
                    strokeWidth={2.5}
                    fill="url(#grad-this-year)"
                    dot={{ r: 3, fill: COLORS.blue, strokeWidth: 0 }}
                    activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="lastYear"
                    name={`${currentYear - 1}`}
                    stroke="#cbd5e1"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={{ r: 3, fill: '#cbd5e1', strokeWidth: 0 }}
                    activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────────
            FUNNEL — Horizontal pipeline visualization
            ───────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-100/80 p-6">
          <div className="mb-6">
            <h2 className="text-base font-semibold text-slate-700">Phễu chuyển đổi kinh doanh</h2>
            <p className="text-xs text-slate-400 mt-0.5">Từ RFQ đến xuất hoá đơn</p>
          </div>
          {isLoading ? <Skeleton className="h-[120px]" /> : (
            <>
              {/* Desktop: horizontal funnel */}
              <div className="hidden md:block">
                <div className="flex items-stretch gap-0">
                  {funnelStages.map((stage, idx) => {
                    const prevVal = idx > 0 ? funnelStages[idx - 1].value : null;
                    const conv = prevVal !== null ? convPct(prevVal, stage.value) : null;
                    const widthPct = Math.max((stage.value / funnelMax) * 100, 8);

                    return (
                      <div key={stage.key} className="flex items-center flex-1 min-w-0">
                        {/* Conversion arrow between stages */}
                        {idx > 0 && (
                          <div className="flex flex-col items-center px-2 shrink-0">
                            <ArrowRight className="w-4 h-4 text-slate-300" />
                            <span className="text-[10px] font-medium text-slate-400 mt-0.5 whitespace-nowrap">
                              {conv}
                            </span>
                          </div>
                        )}
                        {/* Stage card */}
                        <div className="flex-1 min-w-0 text-center">
                          <div className="flex items-center justify-center gap-1.5 mb-2" style={{ color: stage.color }}>
                            {stage.icon}
                            <span className="text-xs font-medium">{stage.label}</span>
                          </div>
                          <p className="text-2xl font-bold text-slate-900">{fmtNum(stage.value)}</p>
                          {/* Bar representation */}
                          <div className="mt-2 mx-auto h-2 bg-slate-100 rounded-full overflow-hidden max-w-[120px]">
                            <div
                              className="h-full rounded-full transition-all duration-1000"
                              style={{ width: `${widthPct}%`, backgroundColor: stage.color }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mobile: vertical funnel */}
              <div className="md:hidden space-y-3">
                {funnelStages.map((stage, idx) => {
                  const prevVal = idx > 0 ? funnelStages[idx - 1].value : null;
                  const conv = prevVal !== null ? convPct(prevVal, stage.value) : null;
                  const widthPct = Math.max((stage.value / funnelMax) * 100, 8);

                  return (
                    <div key={stage.key}>
                      {conv && (
                        <div className="flex items-center gap-1.5 ml-3 mb-1">
                          <ChevronRight className="w-3 h-3 text-slate-300" />
                          <span className="text-[10px] font-medium text-slate-400">{conv}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${stage.color}10`, color: stage.color }}>
                          {stage.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-slate-600">{stage.label}</span>
                            <span className="text-sm font-bold text-slate-900 font-mono">{fmtNum(stage.value)}</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-1000"
                              style={{ width: `${widthPct}%`, backgroundColor: stage.color }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* ─────────────────────────────────────────────────────────
            ROW 3 — Maker Donut + Urgent RFQ Table
            ───────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Maker Distribution — donut chart */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-100/80 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-semibold text-slate-700">Phân bổ theo Maker</h2>
              <span className="text-xs text-slate-400">{makers.length} nhà sản xuất</span>
            </div>
            {isLoading ? <Skeleton className="h-[340px]" /> : (
              <div className="flex flex-col items-center">
                {/* Donut */}
                <div className="relative">
                  <ResponsiveContainer width={200} height={200}>
                    <PieChart>
                      <Pie
                        data={makersDonut}
                        cx="50%" cy="50%"
                        innerRadius={60} outerRadius={88}
                        paddingAngle={2}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {makersDonut.map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS.donut[i % COLORS.donut.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.[0]) return null;
                          const item = payload[0].payload;
                          return (
                            <div className="bg-slate-900 text-white rounded-lg px-3.5 py-2.5 shadow-xl text-xs border border-slate-700/50">
                              <p className="font-semibold mb-1">{item.name}</p>
                              <p className="text-slate-400">{fmtNum(item.value)} RFQ &middot; Win: {item.rate?.toFixed(1)}%</p>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center label */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-bold text-slate-800">
                      {fmtNum(makersDonut.reduce((s, m) => s + m.value, 0))}
                    </span>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">RFQ</span>
                  </div>
                </div>

                {/* Legend list */}
                <div className="w-full mt-4 space-y-1.5">
                  {makersDonut.slice(0, 6).map((m, i) => (
                    <div key={m.name} className="flex items-center gap-2.5 py-1 group/item hover:bg-slate-50 rounded-lg px-2 -mx-2 transition-colors">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: COLORS.donut[i % COLORS.donut.length] }}
                      />
                      <span className="text-xs text-slate-600 truncate flex-1">{m.name}</span>
                      <span className="text-xs text-slate-400 font-mono tabular-nums">{fmtNum(m.value)}</span>
                      <span className={cn(
                        'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                        m.rate >= 30 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
                      )}>
                        {m.rate?.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Urgent RFQ Table */}
          <div className="lg:col-span-3 bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-100/80 overflow-hidden flex flex-col">
            {/* Table header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-slate-700">RFQ cần xử lý ngay</h2>
                {rfqOverdue > 0 && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-600">
                    <AlertTriangle className="w-3 h-3" />
                    {fmtNum(rfqOverdue)}
                  </span>
                )}
              </div>
              <button
                onClick={() => router.push('/bqms/quotation?filter=overdue')}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-0.5"
              >
                Xem tất cả <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {isLoading ? (
              <div className="p-6 space-y-3 flex-1">
                {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : urgentRfqs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mb-3">
                  <Target className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-400">Không có RFQ khẩn cấp</p>
                <p className="text-xs text-slate-300 mt-1">Tất cả RFQ đang được xử lý tốt</p>
              </div>
            ) : (
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Số RFQ</th>
                      <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Maker</th>
                      <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Phụ trách</th>
                      <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Ngày nhận</th>
                      <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {urgentRfqs.slice(0, 8).map((rfq: any, i: number) => {
                      const days = daysSince(rfq.inquiry_date ?? rfq.created_at ?? '');
                      const isOverdue = days > 3;
                      const isWarning = !isOverdue && days > 0;
                      return (
                        <tr
                          key={rfq.rfq_number ?? i}
                          onClick={() => router.push(`/bqms/quotation/new?rfq_code=${rfq.bqms_code ?? rfq.rfq_number ?? ''}`)}
                          className={cn(
                            'border-b border-slate-50 cursor-pointer transition-colors duration-150',
                            isOverdue ? 'hover:bg-red-50/50' :
                            isWarning ? 'hover:bg-amber-50/50' :
                            'hover:bg-slate-50/50',
                          )}
                        >
                          <td className="px-6 py-3">
                            <span className="text-sm font-mono font-semibold text-slate-800 hover:text-blue-600 transition-colors">
                              {rfq.rfq_number ?? '--'}
                            </span>
                          </td>
                          <td className="px-6 py-3">
                            <span className="text-sm text-slate-600">{rfq.maker ?? '--'}</span>
                          </td>
                          <td className="px-6 py-3">
                            <span className="text-sm text-slate-500">{rfq.person_in_charge_name ?? '--'}</span>
                          </td>
                          <td className="px-6 py-3">
                            <span className="text-sm text-slate-400 tabular-nums">
                              {rfq.inquiry_date ? new Date(rfq.inquiry_date).toLocaleDateString('vi-VN') : '--'}
                            </span>
                          </td>
                          <td className="px-6 py-3">
                            {isOverdue ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-red-50 text-red-600">
                                <AlertTriangle className="w-3 h-3" />
                                Quá hạn ({Math.floor(days)}d)
                              </span>
                            ) : isWarning ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-600">
                                <Clock className="w-3 h-3" />
                                Sắp hạn
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-500">
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

            {/* Bottom action bar */}
            {!isLoading && urgentRfqs.length > 0 && (
              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span><strong className="text-slate-600">{fmtNum(rfqPending)}</strong> đang chờ</span>
                  <span className="w-px h-3 bg-slate-200" />
                  <span className="text-red-500"><strong>{fmtNum(rfqOverdue)}</strong> quá hạn</span>
                </div>
                <button
                  onClick={() => router.push('/bqms/quotation?filter=overdue')}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                >
                  Xử lý RFQ quá hạn
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────────
            ROW 4 — Win Rate Trend + Top Owners
            ───────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Win Rate Trend — area chart (2/3 width) */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-100/80 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-base font-semibold text-slate-700">Xu hướng tỷ lệ thắng</h2>
                <p className="text-xs text-slate-400 mt-0.5">Win rate theo tháng</p>
              </div>
              {avgWinRate > 0 && (
                <span className="text-xs font-medium text-slate-400 bg-slate-50 px-2.5 py-1 rounded-md">
                  Trung bình: {avgWinRate.toFixed(1)}%
                </span>
              )}
            </div>
            {isLoading ? <Skeleton className="h-[260px]" /> : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={winRateTrend.map((r: any) => ({
                  name: monthLabel(r.month ?? ''),
                  rate: r.win_rate ?? 0,
                  won: r.won ?? 0,
                  lost: r.lost ?? 0,
                }))}>
                  <defs>
                    <linearGradient id="grad-winrate" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.emerald} stopOpacity={0.15} />
                      <stop offset="100%" stopColor={COLORS.emerald} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false} tickLine={false}
                    width={40}
                  />
                  <Tooltip content={<ChartTooltip valueFormatter={(v: number) => `${v.toFixed(1)}%`} />} />
                  {avgWinRate > 0 && (
                    <ReferenceLine
                      y={avgWinRate}
                      stroke={COLORS.amber}
                      strokeDasharray="4 3"
                      strokeWidth={1.5}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="rate"
                    name="Tỷ lệ thắng"
                    stroke={COLORS.emerald}
                    strokeWidth={2.5}
                    fill="url(#grad-winrate)"
                    dot={{ r: 3, fill: COLORS.emerald, strokeWidth: 0 }}
                    activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top Owners — ranked list (1/3 width) */}
          <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-100/80 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-semibold text-slate-700">Nhân viên nổi bật</h2>
              <span className="text-xs text-slate-400">{owners.length} người</span>
            </div>
            {isLoading ? (
              <div className="space-y-3">
                {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : owners.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Không có dữ liệu</p>
            ) : (
              <div className="space-y-1">
                {owners
                  .sort((a: any, b: any) => (b.won ?? 0) - (a.won ?? 0))
                  .slice(0, 8)
                  .map((o: any, i: number) => {
                    const total = o.total ?? 0;
                    const won = o.won ?? 0;
                    const rate = o.win_rate ?? 0;
                    return (
                      <div
                        key={o.owner ?? i}
                        className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-slate-50 transition-colors group/row"
                      >
                        {/* Rank number */}
                        <span className={cn(
                          'w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0',
                          i === 0 ? 'bg-amber-100 text-amber-700' :
                          i === 1 ? 'bg-slate-200 text-slate-600' :
                          i === 2 ? 'bg-orange-100 text-orange-600' :
                          'bg-slate-100 text-slate-400',
                        )}>
                          {i + 1}
                        </span>
                        {/* Name + stats */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{o.owner ?? '--'}</p>
                          <p className="text-[11px] text-slate-400">{fmtNum(total)} RFQ &middot; {won} won</p>
                        </div>
                        {/* Win rate badge */}
                        <span className={cn(
                          'text-[11px] font-semibold px-2 py-0.5 rounded-md shrink-0',
                          rate >= 50 ? 'bg-emerald-50 text-emerald-600' :
                          rate >= 20 ? 'bg-blue-50 text-blue-600' :
                          'bg-slate-50 text-slate-400',
                        )}>
                          {rate.toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────────
            ROW 5 — Giao hàng · PO Samsung · Cổng NCC
            ───────────────────────────────────────────────────────── */}
        {!isLoading && (
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* ── Giao hàng ── */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex flex-col">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Truck className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <h3 className="text-[13px] font-semibold text-slate-800">Giao hàng</h3>
                </div>
                <button onClick={() => router.push('/bqms/deliveries')} className="text-[11px] text-brand-600 hover:underline font-medium flex items-center gap-0.5">Xem tất cả <ChevronRight className="w-3 h-3" /></button>
              </div>
              <div className="p-5 flex-1 space-y-4">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-2xl font-bold text-slate-800">{fmtNum(delivery.total_deliveries ?? 0)}</p>
                    <p className="text-[11px] text-slate-400">tổng đơn</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-emerald-600">{fmtVnd(delivery.delivered_value_this_month ?? 0)}</p>
                    <p className="text-[11px] text-slate-400">đã giao tháng này</p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {[
                    { label: 'Đã giao', value: delivery.delivered ?? 0, color: 'bg-emerald-500' },
                    { label: 'Đang giao', value: delivery.in_transit ?? 0, color: 'bg-blue-500' },
                    { label: 'Chưa giao', value: delivery.pending ?? 0, color: 'bg-amber-400' },
                  ].map(s => {
                    const total = (delivery.total_deliveries ?? 1) || 1;
                    const pct = Math.max(((s.value / total) * 100), 2);
                    return <div key={s.label} className={`${s.color} h-2 rounded-full`} style={{ width: `${pct}%` }} title={`${s.label}: ${fmtNum(s.value)}`} />;
                  })}
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Đã giao <strong className="text-slate-700">{fmtNum(delivery.delivered ?? 0)}</strong></span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Đang <strong className="text-slate-700">{fmtNum(delivery.in_transit ?? 0)}</strong></span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Chờ <strong className="text-slate-700">{fmtNum(delivery.pending ?? 0)}</strong></span>
                </div>
                {(delivery.overdue ?? 0) > 0 && (
                  <div className="bg-red-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-3 h-3 text-red-500" />
                      <span className="text-[11px] font-semibold text-red-600">{fmtNum(delivery.overdue)} đơn quá hạn</span>
                    </div>
                    {deliveryOverdue.slice(0, 3).map((dd: any, i: number) => (
                      <p key={i} className="text-[10px] text-red-500/80 truncate">{dd.po_number} — {dd.spec}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── PO Samsung ── */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex flex-col">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-brand-100 flex items-center justify-center">
                    <FileText className="w-3.5 h-3.5 text-brand-600" />
                  </div>
                  <h3 className="text-[13px] font-semibold text-slate-800">PO Samsung</h3>
                </div>
                <button onClick={() => router.push('/bqms')} className="text-[11px] text-brand-600 hover:underline font-medium flex items-center gap-0.5">BQMS <ChevronRight className="w-3 h-3" /></button>
              </div>
              <div className="p-5 flex-1 space-y-4">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-2xl font-bold text-slate-800">{fmtNum(samsungPo.total_pos ?? 0)}</p>
                    <p className="text-[11px] text-slate-400">tổng PO</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-brand-600">{fmtNum(samsungPo.pos_this_month ?? 0)}</p>
                    <p className="text-[11px] text-slate-400">PO tháng này</p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-slate-500">Giá trị tháng này</p>
                  <p className="text-base font-bold text-slate-800">{fmtVnd(samsungPo.amount_this_month ?? 0)}</p>
                </div>
                {recentPos.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-slate-400 font-medium">Top 5 PO gần nhất</p>
                    {recentPos.slice(0, 5).map((p: any, i: number) => (
                      <div key={i} className="flex items-center justify-between gap-2 py-1 border-b border-slate-50 last:border-0">
                        <div className="min-w-0">
                          <p className="text-[11px] text-slate-700 truncate font-medium">{p.spec}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{p.po_number}</p>
                        </div>
                        <span className="text-[11px] font-mono text-slate-600 shrink-0">{fmtVnd(p.amount ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Cổng NCC ── */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex flex-col">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center">
                    <Target className="w-3.5 h-3.5 text-purple-600" />
                  </div>
                  <h3 className="text-[13px] font-semibold text-slate-800">Cổng Nhà Cung Cấp</h3>
                </div>
                <button onClick={() => router.push('/procurement')} className="text-[11px] text-brand-600 hover:underline font-medium flex items-center gap-0.5">Quản lý <ChevronRight className="w-3 h-3" /></button>
              </div>
              <div className="p-5 flex-1 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center py-3 bg-emerald-50/70 rounded-xl">
                    <p className="text-xl font-bold text-emerald-700">{vendorPortal.approved_vendors ?? 0}</p>
                    <p className="text-[10px] text-emerald-600 font-medium mt-0.5">NCC đã duyệt</p>
                  </div>
                  <div className={cn('text-center py-3 rounded-xl', (vendorPortal.pending_vendors ?? 0) > 0 ? 'bg-amber-50/70' : 'bg-slate-50')}>
                    <p className={cn('text-xl font-bold', (vendorPortal.pending_vendors ?? 0) > 0 ? 'text-amber-700' : 'text-slate-300')}>{vendorPortal.pending_vendors ?? 0}</p>
                    <p className="text-[10px] text-slate-500 font-medium mt-0.5">Chờ duyệt</p>
                  </div>
                  <div className="text-center py-3 bg-blue-50/70 rounded-xl">
                    <p className="text-xl font-bold text-blue-700">{vendorPortal.open_batches ?? 0}</p>
                    <p className="text-[10px] text-blue-600 font-medium mt-0.5">Đợt đang mở</p>
                  </div>
                  <div className="text-center py-3 bg-purple-50/70 rounded-xl">
                    <p className="text-xl font-bold text-purple-700">{vendorPortal.total_quotes ?? 0}</p>
                    <p className="text-[10px] text-purple-600 font-medium mt-0.5">Báo giá nhận</p>
                  </div>
                </div>
                <div className="text-center py-3 bg-gradient-to-r from-slate-50 to-slate-100/50 rounded-xl">
                  <p className="text-lg font-bold text-slate-800">{vendorPortal.awarded_batches ?? 0}</p>
                  <p className="text-[10px] text-slate-500 font-medium">Đợt đã chọn NCC</p>
                </div>
              </div>
            </div>

          </section>
        )}

      </div>
    </div>
  );
}
