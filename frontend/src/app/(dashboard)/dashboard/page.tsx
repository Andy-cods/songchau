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
  Zap,
  Target,
  ChevronRight,
  FileText,
  Package,
  CircleDot,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  BarChart,
  Bar,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Design Tokens ──────────────────────────────────────────────

const PALETTE = {
  primary:    '#1e40af',
  primaryLight: '#3b82f6',
  success:    '#059669',
  successLight: '#10b981',
  warning:    '#d97706',
  danger:     '#dc2626',
  purple:     '#7c3aed',

  // Chart palette — harmonious, max 5
  chart: ['#3b82f6', '#10b981', '#f59e0b', '#7c3aed', '#ef4444'],
  chartFade: ['#dbeafe', '#d1fae5', '#fef3c7', '#ede9fe', '#fee2e2'],

  // Donut
  donut: ['#3b82f6', '#10b981', '#f59e0b', '#7c3aed', '#ef4444', '#06b6d4', '#f97316', '#84cc16'],
};

const VM = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];

// ─── Helpers ────────────────────────────────────────────────────

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
  if (!from) return '--';
  return `${((to / from) * 100).toFixed(1)}%`;
}

// ─── Custom Tooltip (shared) ────────────────────────────────────

function CustomTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900/95 backdrop-blur-sm text-white rounded-xl px-4 py-3 shadow-2xl text-xs border border-white/10">
      <p className="font-semibold text-slate-300 mb-2 text-[11px] tracking-wide uppercase">{label}</p>
      <div className="space-y-1">
        {payload.map((p: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-slate-400">{p.name}:</span>
            <span className="font-mono font-semibold ml-auto">
              {formatter ? formatter(p.value) : fmtNum(p.value ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mini Sparkline ─────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data?.length) return null;
  const pts = data.map((v, i) => ({ i, v }));
  const gradId = `spark-${color.replace('#', '')}`;
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={pts} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone" dataKey="v"
          stroke={color} strokeWidth={2}
          fill={`url(#${gradId})`} dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-gradient-to-r from-slate-100 to-slate-50 rounded-xl', className)} />;
}

// ─── Card Wrapper ───────────────────────────────────────────────

function Card({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'bg-white rounded-2xl shadow-sm border border-slate-100/80',
        'hover:shadow-md hover:border-slate-200/80 transition-all duration-300 ease-out',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ─── Section Header ─────────────────────────────────────────────

function SectionHeader({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      {icon && (
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center text-slate-500 shadow-sm">
          {icon}
        </div>
      )}
      <div>
        <h2 className="text-sm font-bold text-slate-800 tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── KPI Card ───────────────────────────────────────────────────

function KpiCard({
  icon, iconBg, iconColor, value, label, delta, deltaLabel,
  sparkData, sparkColor, extra,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  value: string;
  label: string;
  delta?: number;
  deltaLabel?: string;
  sparkData?: number[];
  sparkColor?: string;
  extra?: React.ReactNode;
}) {
  return (
    <Card className="p-6 flex flex-col justify-between min-h-[148px] relative overflow-hidden group">
      {/* Subtle gradient accent top */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ backgroundImage: `linear-gradient(to right, ${sparkColor ?? PALETTE.primaryLight}, transparent)` }}
      />

      <div className="flex items-start justify-between">
        <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shadow-sm', iconBg)}>
          <span className={iconColor}>{icon}</span>
        </div>
        {delta !== undefined && (
          <span className={cn(
            'flex items-center gap-0.5 text-xs font-semibold px-2.5 py-1 rounded-full',
            delta > 0 ? 'bg-emerald-50 text-emerald-700' :
            delta < 0 ? 'bg-red-50 text-red-600' :
            'bg-slate-50 text-slate-500'
          )}>
            {delta > 0 ? <ArrowUpRight className="w-3 h-3" /> :
             delta < 0 ? <ArrowDownRight className="w-3 h-3" /> :
             <Minus className="w-3 h-3" />}
            {deltaLabel ?? `${Math.abs(delta).toFixed(1)}%`}
          </span>
        )}
      </div>

      <div className="mt-4 flex-1">
        <p className="text-3xl font-bold text-slate-900 tracking-tight">{value}</p>
        <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mt-1">{label}</p>
        {extra}
      </div>

      {sparkData && sparkColor && (
        <div className="mt-3 -mx-1">
          <Sparkline data={sparkData} color={sparkColor} />
        </div>
      )}
    </Card>
  );
}

// ─── Ring Progress ──────────────────────────────────────────────

function RingProgress({ value, max = 100, color, size = 56 }: { value: number; max?: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(value / max, 1) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={5} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={5}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        className="transition-all duration-700"
      />
    </svg>
  );
}

// ─── Funnel Bar ─────────────────────────────────────────────────

function FunnelStage({
  label, value, maxValue, color, conversionLabel, icon, index,
}: {
  label: string; value: number; maxValue: number; color: string;
  conversionLabel?: string; icon: React.ReactNode; index: number;
}) {
  const widthPct = maxValue ? Math.max((value / maxValue) * 100, 6) : 6;
  return (
    <div className="group">
      {conversionLabel && (
        <div className="flex items-center gap-2 ml-10 mb-1.5">
          <div className="flex items-center gap-1">
            <ChevronRight className="w-3 h-3 text-slate-300" />
            <span className="text-[11px] font-medium text-slate-400">
              {conversionLabel}
            </span>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 opacity-60"
          style={{ backgroundColor: `${color}15` }}>
          <span style={{ color }}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-600">{label}</span>
            <span className="text-xs font-bold text-slate-800 font-mono">{fmtNum(value)}</span>
          </div>
          <div className="h-3 bg-slate-50 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-out relative"
              style={{
                width: `${widthPct}%`,
                background: `linear-gradient(90deg, ${color}, ${color}dd)`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ─── MAIN PAGE ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

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
  const urgentRfqs: any[]     = Array.isArray(d.urgent_rfqs)     ? d.urgent_rfqs     : [];

  // ── Derived chart data ─────────────────────────────────────────

  const revenueChartData = monthlyRevenue.map((m: any) => ({
    name: monthLabel(m.month ?? ''),
    'Báo giá':    m.total_quoted ?? 0,
    'Chốt được':  m.won_revenue  ?? 0,
  }));

  const currentYear = new Date().getFullYear();
  const yoyChartData = yoy.map((y: any, i: number) => ({
    name: VM[i] ?? `T${y.month_num ?? i + 1}`,
    [`${currentYear}`]:     y.rfq_this_year  ?? 0,
    [`${currentYear - 1}`]: y.rfq_last_year  ?? 0,
  }));

  const funnelStages = [
    { label: 'RFQ nhận được', value: funnel.rfq_received ?? 0, color: PALETTE.primaryLight, icon: <FileText className="w-3.5 h-3.5" /> },
    { label: 'Đã báo giá',    value: funnel.quoted       ?? 0, color: PALETTE.purple,       icon: <CircleDot className="w-3.5 h-3.5" /> },
    { label: 'Đã thắng',      value: funnel.won          ?? 0, color: PALETTE.success,      icon: <Target className="w-3.5 h-3.5" /> },
    { label: 'Đã giao hàng',  value: funnel.delivered    ?? 0, color: PALETTE.warning,      icon: <Package className="w-3.5 h-3.5" /> },
    { label: 'Đã xuất HĐ',    value: funnel.invoiced     ?? 0, color: '#64748b',            icon: <BarChart3 className="w-3.5 h-3.5" /> },
  ];
  const funnelMax = funnelStages[0]?.value || 1;

  const avgWinRate = winRateTrend.length
    ? winRateTrend.reduce((s: number, r: any) => s + (r.win_rate ?? 0), 0) / winRateTrend.length
    : 0;
  const winRateChartData = winRateTrend.map((r: any) => ({
    name: monthLabel(r.month ?? ''),
    'Tỷ lệ thắng': r.win_rate ?? 0,
  }));

  const makersChartData = makers.map((m: any) => ({
    name:  m.maker    ?? '',
    value: m.total    ?? 0,
    won:   m.won      ?? 0,
    rate:  m.win_rate ?? 0,
  }));

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-10">

        {/* ═══ HEADER ═══════════════════════════════════════════════ */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Tổng quan
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Theo dõi hiệu suất kinh doanh theo thời gian thực
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Live pulse */}
            <div className="flex items-center gap-2 bg-white rounded-full px-4 py-2 shadow-sm border border-slate-100">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-slate-500">Cập nhật trực tiếp</span>
            </div>
            {/* Date */}
            <div className="bg-white rounded-full px-4 py-2 shadow-sm border border-slate-100">
              <span className="text-xs font-medium text-slate-500">
                {new Date().toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })}
              </span>
            </div>
          </div>
        </header>

        {/* ═══ ROW 1: KPI Cards ═══════════════════════════════════ */}
        <section>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">

            {isLoading ? (
              <>
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-[168px]" />)}
              </>
            ) : (
              <>
                {/* KPI 1 — RFQ tháng này */}
                <KpiCard
                  icon={<BarChart3 className="w-5 h-5" />}
                  iconBg="bg-blue-50"
                  iconColor="text-blue-600"
                  value={fmtNum(rfqThisMonth)}
                  label="RFQ tháng này"
                  delta={rfqMomPct}
                  sparkData={rfqSpark}
                  sparkColor={PALETTE.primaryLight}
                />

                {/* KPI 2 — Tỷ lệ thắng */}
                <KpiCard
                  icon={<Target className="w-5 h-5" />}
                  iconBg="bg-emerald-50"
                  iconColor="text-emerald-600"
                  value={`${winRate3m.toFixed(1)}%`}
                  label="Tỷ lệ thắng 3 tháng"
                  delta={winRateDelta}
                  deltaLabel={`${winRateDelta >= 0 ? '+' : ''}${winRateDelta.toFixed(1)} điểm`}
                  sparkColor={PALETTE.successLight}
                  extra={
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[11px] text-slate-400">
                        {won3m}/{decided3m} đã quyết định
                      </span>
                      <div className="ml-auto">
                        <RingProgress value={winRate3m} max={100} color={PALETTE.success} size={44} />
                      </div>
                    </div>
                  }
                />

                {/* KPI 3 — Doanh thu thang */}
                <KpiCard
                  icon={<TrendingUp className="w-5 h-5" />}
                  iconBg="bg-violet-50"
                  iconColor="text-violet-600"
                  value={fmtVnd(revThisMonth)}
                  label="Doanh thu tháng này"
                  delta={revMomPct}
                  sparkData={monthlyRevenue.map((m: any) => m.won_revenue ?? 0)}
                  sparkColor={PALETTE.purple}
                />

                {/* KPI 4 — Can xu ly */}
                <KpiCard
                  icon={<Clock className="w-5 h-5" />}
                  iconBg="bg-amber-50"
                  iconColor="text-amber-600"
                  value={fmtNum(rfqPending)}
                  label="RFQ đang chờ xử lý"
                  delta={rfqOverdue > 0 ? undefined : 0}
                  extra={
                    <div className="mt-2">
                      {rfqOverdue > 0 && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                          <span className="text-xs font-semibold text-red-600">{fmtNum(rfqOverdue)} quá hạn</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: rfqPending ? `${Math.min((rfqOverdue / rfqPending) * 100, 100)}%` : '0%',
                              background: `linear-gradient(90deg, ${PALETTE.danger}, #f87171)`,
                            }}
                          />
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono shrink-0">
                          {rfqPending ? Math.round((rfqOverdue / rfqPending) * 100) : 0}%
                        </span>
                      </div>
                    </div>
                  }
                />
              </>
            )}
          </div>
        </section>

        {/* ═══ ROW 2: Revenue & YoY ══════════════════════════════ */}
        <section>
          <SectionHeader
            title="Doanh thu & So sánh"
            subtitle="12 tháng gần nhất"
            icon={<BarChart3 className="w-4 h-4" />}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Revenue bar chart */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm font-semibold text-slate-800">Báo giá vs Doanh thu</p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: PALETTE.primaryLight }} />
                    <span className="text-[11px] text-slate-400">Báo giá</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: PALETTE.successLight }} />
                    <span className="text-[11px] text-slate-400">Chốt được</span>
                  </div>
                </div>
              </div>
              {isLoading ? <Skeleton className="h-[260px]" /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={revenueChartData} barCategoryGap="30%" barGap={3}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtVnd} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip content={<CustomTooltip formatter={fmtVnd} />} />
                    <Bar dataKey="Báo giá"   fill={PALETTE.primaryLight} radius={[6,6,0,0]} />
                    <Bar dataKey="Chốt được" fill={PALETTE.successLight} radius={[6,6,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* YoY comparison — area chart */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm font-semibold text-slate-800">So sánh RFQ theo năm</p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PALETTE.primaryLight }} />
                    <span className="text-[11px] text-slate-400">{currentYear}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full border-2 border-slate-300" />
                    <span className="text-[11px] text-slate-400">{currentYear - 1}</span>
                  </div>
                </div>
              </div>
              {isLoading ? <Skeleton className="h-[260px]" /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={yoyChartData}>
                    <defs>
                      <linearGradient id="yoy-this" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.primaryLight} stopOpacity={0.15} />
                        <stop offset="100%" stopColor={PALETTE.primaryLight} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone" dataKey={`${currentYear}`}
                      stroke={PALETTE.primaryLight} strokeWidth={2.5}
                      fill="url(#yoy-this)"
                      dot={{ r: 3, fill: PALETTE.primaryLight, strokeWidth: 0 }}
                      activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                    />
                    <Line
                      type="monotone" dataKey={`${currentYear - 1}`}
                      stroke="#cbd5e1" strokeWidth={2} strokeDasharray="6 4"
                      dot={{ r: 3, fill: '#cbd5e1', strokeWidth: 0 }}
                      activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
        </section>

        {/* ═══ ROW 3: Funnel (full width) ════════════════════════ */}
        <section>
          <SectionHeader
            title="Phễu bán hàng"
            subtitle="Chuyển đổi từng giai đoạn"
            icon={<Zap className="w-4 h-4" />}
          />
          <Card className="p-6 sm:p-8">
            {isLoading ? <Skeleton className="h-[280px]" /> : (
              <div className="space-y-4">
                {funnelStages.map((stage, idx) => {
                  const prevVal = idx > 0 ? funnelStages[idx - 1].value : null;
                  const conv = prevVal !== null ? convPct(prevVal, stage.value) : undefined;
                  return (
                    <FunnelStage
                      key={stage.label}
                      label={stage.label}
                      value={stage.value}
                      maxValue={funnelMax}
                      color={stage.color}
                      conversionLabel={conv ? `${conv} chuyển đổi` : undefined}
                      icon={stage.icon}
                      index={idx}
                    />
                  );
                })}
              </div>
            )}
          </Card>
        </section>

        {/* ═══ ROW 4: Win Rate Trend + Makers ════════════════════ */}
        <section>
          <SectionHeader
            title="Phân tích hiệu suất"
            subtitle="Xu hướng & phân bố"
            icon={<Activity className="w-4 h-4" />}
          />
          <div className="grid grid-cols-1 lg:grid-cols-7 gap-5">

            {/* Win rate trend (wider) */}
            <Card className="lg:col-span-4 p-6">
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm font-semibold text-slate-800">Xu hướng tỷ lệ thắng</p>
                {avgWinRate > 0 && (
                  <span className="text-xs text-slate-500 bg-slate-50 px-3 py-1 rounded-full font-medium">
                    TB: {avgWinRate.toFixed(1)}%
                  </span>
                )}
              </div>
              {isLoading ? <Skeleton className="h-[260px]" /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={winRateChartData}>
                    <defs>
                      <linearGradient id="wr-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.success} stopOpacity={0.2} />
                        <stop offset="100%" stopColor={PALETTE.success} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      axisLine={false} tickLine={false} width={40}
                    />
                    <Tooltip content={<CustomTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />} />
                    {avgWinRate > 0 && (
                      <ReferenceLine
                        y={avgWinRate} stroke={PALETTE.warning}
                        strokeDasharray="4 3" strokeWidth={1.5}
                        label={{
                          value: `TB ${avgWinRate.toFixed(1)}%`,
                          position: 'insideTopRight',
                          fontSize: 10,
                          fill: PALETTE.warning,
                          fontWeight: 600,
                        }}
                      />
                    )}
                    <Area
                      type="monotone" dataKey="Tỷ lệ thắng"
                      stroke={PALETTE.success} strokeWidth={2.5}
                      fill="url(#wr-grad)"
                      dot={{ r: 3, fill: PALETTE.success, strokeWidth: 0 }}
                      activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Maker donut (narrower) */}
            <Card className="lg:col-span-3 p-6">
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm font-semibold text-slate-800">Phân bố Maker</p>
                <span className="text-xs text-slate-400 bg-slate-50 px-3 py-1 rounded-full">
                  {makers.length} nhà sản xuất
                </span>
              </div>
              {isLoading ? <Skeleton className="h-[260px]" /> : (
                <div className="flex flex-col items-center">
                  <div className="relative">
                    <ResponsiveContainer width={200} height={200}>
                      <PieChart>
                        <Pie
                          data={makersChartData}
                          cx="50%" cy="50%"
                          innerRadius={58} outerRadius={85}
                          paddingAngle={2}
                          dataKey="value"
                          isAnimationActive
                          strokeWidth={0}
                        >
                          {makersChartData.map((_: any, i: number) => (
                            <Cell key={i} fill={PALETTE.donut[i % PALETTE.donut.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }: any) => {
                            if (!active || !payload?.[0]) return null;
                            const d = payload[0].payload;
                            return (
                              <div className="bg-slate-900/95 backdrop-blur-sm text-white rounded-xl px-4 py-3 shadow-2xl text-xs border border-white/10">
                                <p className="font-semibold mb-1">{d.name}</p>
                                <p className="text-slate-400">{d.value} RFQ &middot; Win: {d.rate?.toFixed(1)}%</p>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-2xl font-bold text-slate-800">{makers.length}</span>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">makers</span>
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="w-full mt-4 space-y-2">
                    {makersChartData.slice(0, 6).map((m: any, i: number) => (
                      <div key={m.name} className="flex items-center gap-2.5 group/legend">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 transition-transform group-hover/legend:scale-125"
                          style={{ backgroundColor: PALETTE.donut[i % PALETTE.donut.length] }}
                        />
                        <span className="text-xs text-slate-600 font-medium truncate flex-1">{m.name}</span>
                        <span className="text-xs text-slate-400 font-mono shrink-0">{fmtNum(m.value)}</span>
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: m.rate >= 30 ? '#d1fae5' : '#fef3c7',
                            color: m.rate >= 30 ? PALETTE.success : PALETTE.warning,
                          }}
                        >
                          {m.rate?.toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </section>

        {/* ═══ ROW 5: Action Table ═══════════════════════════════ */}
        <section>
          <SectionHeader
            title="Cần xử lý ngay"
            subtitle={`${urgentRfqs.length} RFQ khẩn cấp cần hành động`}
            icon={<AlertTriangle className="w-4 h-4" />}
          />

          <Card className="overflow-hidden">
            {/* Table header bar */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50/80 to-white">
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold text-slate-800">Danh sách RFQ khẩn cấp</p>
                {rfqOverdue > 0 && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-600">
                    <AlertTriangle className="w-3 h-3" />
                    {fmtNum(rfqOverdue)} quá hạn
                  </span>
                )}
              </div>
              <button
                onClick={() => router.push('/bqms/quotation?filter=overdue')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1"
              >
                Xem tất cả
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : urgentRfqs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-300">
                <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <p className="text-sm font-medium text-slate-400">Không có RFQ khẩn cấp</p>
                <p className="text-xs text-slate-300 mt-1">Tất cả RFQ đều đang được xử lý</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Số RFQ</th>
                      <th className="text-left px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Mã BQMS</th>
                      <th className="text-left px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Maker</th>
                      <th className="text-left px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Người phụ trách</th>
                      <th className="text-left px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Ngày nhận</th>
                      <th className="text-left px-6 py-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Tình trạng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {urgentRfqs.slice(0, 10).map((rfq: any, i: number) => {
                      const days = daysSince(rfq.inquiry_date ?? rfq.created_at ?? '');
                      const isOverdue = days > 3;
                      const isWarning = !isOverdue && days > 0;
                      return (
                        <tr
                          key={rfq.rfq_number ?? i}
                          onClick={() => router.push(`/bqms/quotation/new?rfq_code=${rfq.bqms_code ?? rfq.rfq_number ?? ''}`)}
                          className={cn(
                            'border-b border-slate-50 cursor-pointer transition-all duration-200 group',
                            isOverdue ? 'bg-red-50/50 hover:bg-red-50' :
                            isWarning ? 'bg-amber-50/50 hover:bg-amber-50' :
                            'hover:bg-slate-50/50'
                          )}
                        >
                          <td className="px-6 py-3.5">
                            <span className="text-sm font-mono font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">
                              {rfq.rfq_number ?? '--'}
                            </span>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className="text-sm font-mono text-slate-500">
                              {rfq.bqms_code ?? '--'}
                            </span>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className="text-sm font-medium text-slate-700">{rfq.maker ?? '--'}</span>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className="text-sm text-slate-600">{rfq.person_in_charge_name ?? '--'}</span>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className="text-sm text-slate-500">
                              {rfq.inquiry_date ? new Date(rfq.inquiry_date).toLocaleDateString('vi-VN') : '--'}
                            </span>
                          </td>
                          <td className="px-6 py-3.5">
                            {isOverdue ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-100 text-red-700">
                                <AlertTriangle className="w-3 h-3" />
                                Quá hạn ({Math.floor(days)}d)
                              </span>
                            ) : isWarning ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">
                                <Clock className="w-3 h-3" />
                                Sắp hạn
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">
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

            {/* Summary bar */}
            {!isLoading && urgentRfqs.length > 0 && (
              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                      <Clock className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{fmtNum(rfqPending)}</p>
                      <p className="text-[10px] text-slate-400">đang chờ</p>
                    </div>
                  </div>
                  <div className="w-px h-8 bg-slate-200" />
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-red-700">{fmtNum(rfqOverdue)}</p>
                      <p className="text-[10px] text-slate-400">quá hạn</p>
                    </div>
                  </div>
                  <div className="w-px h-8 bg-slate-200" />
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <Target className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{winRate3m.toFixed(1)}%</p>
                      <p className="text-[10px] text-slate-400">tỷ lệ thắng</p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => router.push('/bqms/quotation?filter=overdue')}
                  className="text-xs font-semibold px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Xử lý RFQ quá hạn
                </button>
              </div>
            )}
          </Card>
        </section>

      </div>
    </div>
  );
}
