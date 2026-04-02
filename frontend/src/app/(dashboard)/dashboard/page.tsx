'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ShoppingCart,
  TrendingUp,
  AlertTriangle,
  Clock,
  ChevronRight,
  BarChart3,
  Users,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Activity,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
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
} from 'recharts';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

// ─── Color Palette ──────────────────────────────────────────────
const COLORS = {
  brand: '#1e40af',
  brandLight: '#3b82f6',
  brandFade: '#dbeafe',
  success: '#10b981',
  successFade: '#d1fae5',
  warning: '#f59e0b',
  warningFade: '#fef3c7',
  danger: '#ef4444',
  dangerFade: '#fee2e2',
  slate: '#64748b',
  slateFade: '#f1f5f9',
  purple: '#8b5cf6',
  purpleFade: '#ede9fe',
  cyan: '#06b6d4',
  cyanFade: '#cffafe',
};

const MAKER_COLORS = ['#1e40af', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];

const VIET_MONTHS = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];

// ─── Helpers ────────────────────────────────────────────────────

function formatBillions(val: number): string {
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(0)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
  return String(val);
}

function hoursUntil(dt: string | null | undefined): number {
  if (!dt) return Infinity;
  return (new Date(dt).getTime() - Date.now()) / 3_600_000;
}

function deadlineUrgency(dt: string | null | undefined): 'critical' | 'warning' | 'normal' {
  const h = hoursUntil(dt);
  if (h < 24) return 'critical';
  if (h < 48) return 'warning';
  return 'normal';
}

function pct(a: number, b: number): number {
  if (!b) return 0;
  return Math.round(((a - b) / b) * 100);
}

// ─── Custom Tooltip ─────────────────────────────────────────────

function VndTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white rounded-xl px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-slate-300 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-mono">
          {p.name}: {formatBillions(p.value ?? 0)}
        </p>
      ))}
    </div>
  );
}

function PctTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white rounded-xl px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-slate-300 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {(p.value ?? 0).toLocaleString('vi-VN')}
        </p>
      ))}
    </div>
  );
}

// ─── KPI Card ───────────────────────────────────────────────────

interface KPICardProps {
  label: string;
  value: string | number;
  change?: number;           // % change vs previous period
  icon: React.ReactNode;
  accentColor: string;
  fadeBg: string;
  loading?: boolean;
  sparkData?: number[];
  sparkColor?: string;
  suffix?: string;
}

function KPICard({ label, value, change, icon, accentColor, fadeBg, loading, sparkData = [], sparkColor = '#1e40af' }: KPICardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 animate-pulse">
        <div className="h-4 w-24 bg-slate-100 rounded mb-3" />
        <div className="h-8 w-32 bg-slate-200 rounded mb-2" />
        <div className="h-3 w-16 bg-slate-100 rounded" />
      </div>
    );
  }

  const chartData = sparkData.map((v, i) => ({ i, v }));
  const gradId = `spark-${sparkColor.replace('#', '')}`;

  const positiveChange = change !== undefined && change > 0;
  const negativeChange = change !== undefined && change < 0;

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-all duration-200 group">
      <div className="flex items-start justify-between mb-3">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', fadeBg)}>
          <div style={{ color: accentColor }}>{icon}</div>
        </div>
        {change !== undefined && (
          <div className={cn(
            'flex items-center gap-0.5 text-xs font-semibold px-2 py-1 rounded-full',
            positiveChange ? 'bg-emerald-50 text-emerald-700' :
            negativeChange ? 'bg-red-50 text-red-600' :
            'bg-slate-50 text-slate-500'
          )}>
            {positiveChange ? <ArrowUpRight className="h-3 w-3" /> :
             negativeChange ? <ArrowDownRight className="h-3 w-3" /> :
             <Minus className="h-3 w-3" />}
            {Math.abs(change)}%
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900 font-mono mb-0.5">{value}</p>
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      {chartData.length > 1 && (
        <div className="mt-3 h-10">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={sparkColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={2} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Section Header ──────────────────────────────────────────────

function SectionHeader({ title, subtitle, icon, action }: { title: string; subtitle?: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        {icon && <div className="text-slate-400">{icon}</div>}
        <div>
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();

  // — KPIs
  const { data: kpisRaw, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: () => api.get<any>('/api/v1/dashboard/kpis'),
    refetchInterval: 30_000,
    retry: 1,
  });

  // — Finance dashboard
  const { data: financeRaw, isLoading: financeLoading } = useQuery({
    queryKey: ['finance-dashboard'],
    queryFn: () => api.get<any>('/api/v1/finance-management/dashboard'),
    refetchInterval: 30_000,
    retry: 1,
  });

  // — Cash flow (monthly income/expense for charts)
  const { data: cashflowRaw } = useQuery({
    queryKey: ['finance-cashflow'],
    queryFn: () => api.get<any>('/api/v1/finance-management/cash-flow'),
    refetchInterval: 30_000,
    retry: 1,
  });

  // — BQMS records (for RFQ deadline alerts)
  const { data: bqmsRaw, isLoading: bqmsLoading } = useQuery({
    queryKey: ['bqms-records-dashboard'],
    queryFn: () => api.get<any>('/api/v1/bqms/records'),
    refetchInterval: 30_000,
    retry: 1,
  });

  // — Price analytics (maker breakdown)
  const { data: makerRaw } = useQuery({
    queryKey: ['price-analytics-maker'],
    queryFn: () => api.get<any>('/api/v1/price-analytics/by-maker?months=12'),
    retry: 1,
  });

  // — Price analytics overview
  const { data: priceOverviewRaw } = useQuery({
    queryKey: ['price-analytics-overview'],
    queryFn: () => api.get<any>('/api/v1/price-analytics/overview?months=12'),
    retry: 1,
  });

  // — Inventory
  const { data: inventoryRaw } = useQuery({
    queryKey: ['inventory-dashboard'],
    queryFn: () => api.get<any>('/api/v1/smart-inventory/dashboard'),
    refetchInterval: 30_000,
    retry: 1,
  });

  // — Team workload
  const { data: workloadRaw } = useQuery({
    queryKey: ['task-workload'],
    queryFn: () => api.get<any>('/api/v1/task-assignments/workload'),
    retry: 1,
  });

  // ── Data extraction ──────────────────────────────────────────

  const kpis = kpisRaw?.data ?? kpisRaw ?? {};
  const finance = financeRaw?.data ?? financeRaw ?? {};

  // KPI values
  const poActive = kpis?.active_po_count ?? kpis?.po_active ?? 0;
  const poChange = kpis?.po_change_pct ?? undefined;
  const revMonth = finance?.revenue_this_month ?? kpis?.total_revenue_mtd ?? 0;
  const revMonthPrev = finance?.revenue_last_month ?? 0;
  const revYear = finance?.revenue_ytd ?? kpis?.total_revenue_ytd ?? 0;
  const revYearPrev = finance?.revenue_last_year ?? 0;
  const poTrend: number[] = kpis?.po_trend ?? [];
  const revTrend: number[] = finance?.revenue_trend ?? kpis?.revenue_trend ?? [];

  // BQMS records
  const _bqms = bqmsRaw?.data;
  const allBqms: any[] = Array.isArray(_bqms) ? _bqms : Array.isArray(_bqms?.items) ? _bqms.items : [];
  const rfqActive = allBqms.filter((r: any) => !['completed','cancelled','rejected'].includes(r.status ?? '')).length;

  // RFQ deadline within 48 hours
  const now = Date.now();
  const urgentRfqs = allBqms
    .filter((r: any) => {
      const dl = r.deadline_dt ?? r.deadline ?? r.due_date;
      if (!dl) return false;
      const ms = new Date(dl).getTime() - now;
      return ms > 0 && ms < 48 * 3_600_000;
    })
    .sort((a: any, b: any) => {
      const da = a.deadline_dt ?? a.deadline ?? a.due_date;
      const db = b.deadline_dt ?? b.deadline ?? b.due_date;
      return new Date(da).getTime() - new Date(db).getTime();
    });

  // Cashflow chart data
  const _cf = cashflowRaw?.data;
  const cfItems: any[] = Array.isArray(_cf) ? _cf : Array.isArray(_cf?.items) ? _cf.items : [];

  // Build monthly chart — normalize keys
  const monthlyRevenue = cfItems.map((m: any, idx: number) => {
    const label = m.month_label ?? m.month ?? m.period ?? VIET_MONTHS[idx] ?? `T${idx + 1}`;
    const shortLabel = typeof label === 'string' && label.length > 4 ? label.slice(-4) : label;
    return {
      name: shortLabel,
      'Doanh thu': m.income ?? m.revenue ?? m.total_income ?? 0,
      'Chi phí': m.expense ?? m.cost ?? m.total_expense ?? 0,
      'Lợi nhuận': (m.income ?? m.revenue ?? 0) - (m.expense ?? m.cost ?? 0),
    };
  });

  // YoY comparison — split into this year vs last year
  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;

  // Attempt to get YoY from finance or build from cashflow
  const _yoyRaw = finance?.yoy_data ?? finance?.monthly_yoy ?? [];
  const yoyData: any[] = Array.isArray(_yoyRaw) && _yoyRaw.length > 0
    ? _yoyRaw.map((d: any, i: number) => ({
        name: VIET_MONTHS[i] ?? `T${i+1}`,
        [currentYear]: d.this_year ?? d.current ?? 0,
        [lastYear]: d.last_year ?? d.previous ?? 0,
      }))
    : VIET_MONTHS.map((m, i) => ({
        name: m,
        [currentYear]: cfItems[i]?.income ?? cfItems[i]?.revenue ?? 0,
        [lastYear]: cfItems[i]?.last_year_income ?? cfItems[i]?.prev_year_revenue ?? 0,
      }));

  // Maker pie data
  const _maker = makerRaw?.data;
  const makerArr: any[] = Array.isArray(_maker) ? _maker : Array.isArray(_maker?.items) ? _maker.items : [];
  const makerPie = makerArr.slice(0, 5).map((m: any) => ({
    name: m.maker_name ?? m.name ?? m.maker ?? '—',
    value: m.rfq_count ?? m.count ?? m.total ?? 0,
  }));

  // Price analytics overview
  const priceOverview = priceOverviewRaw?.data ?? priceOverviewRaw ?? {};
  const winRate = Number(priceOverview?.win_rate ?? 0);

  // Inventory alerts
  const _inv = inventoryRaw?.data;
  const invDash = _inv ?? {};
  const lowStockItems: any[] = Array.isArray(invDash?.low_stock_items)
    ? invDash.low_stock_items.slice(0, 5)
    : [];

  // Team workload
  const _wl = workloadRaw?.data;
  const workloadArr: any[] = Array.isArray(_wl) ? _wl : Array.isArray(_wl?.items) ? _wl.items : [];
  const workloadData = workloadArr.slice(0, 8).map((w: any) => ({
    name: w.user_name ?? w.full_name ?? w.name ?? '—',
    tasks: w.task_count ?? w.assigned ?? w.total ?? 0,
    done: w.completed ?? w.done ?? 0,
  }));

  const isLoading = kpisLoading || financeLoading;

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bảng điều khiển</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Cập nhật lần cuối: {new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
            <span className="ml-2 inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-600 font-medium">Live</span>
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200">
          <Activity className="h-3.5 w-3.5" />
          Tự động làm mới mỗi 30 giây
        </div>
      </div>

      {/* ── ROW 1: KPI Cards ────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="PO đang theo dõi"
          value={poActive}
          change={poChange}
          icon={<ShoppingCart className="h-5 w-5" />}
          accentColor={COLORS.brand}
          fadeBg="bg-blue-50"
          loading={isLoading}
          sparkData={poTrend}
          sparkColor={COLORS.brand}
        />
        <KPICard
          label="Doanh thu tháng"
          value={formatCurrency(revMonth)}
          change={pct(revMonth, revMonthPrev)}
          icon={<BarChart3 className="h-5 w-5" />}
          accentColor={COLORS.success}
          fadeBg="bg-emerald-50"
          loading={isLoading}
          sparkData={revTrend}
          sparkColor={COLORS.success}
        />
        <KPICard
          label="Doanh thu năm (YTD)"
          value={formatCurrency(revYear)}
          change={pct(revYear, revYearPrev)}
          icon={<TrendingUp className="h-5 w-5" />}
          accentColor={COLORS.purple}
          fadeBg="bg-purple-50"
          loading={isLoading}
          sparkData={[]}
          sparkColor={COLORS.purple}
        />
        <KPICard
          label="RFQ đang xử lý"
          value={rfqActive}
          icon={<Zap className="h-5 w-5" />}
          accentColor={COLORS.warning}
          fadeBg="bg-amber-50"
          loading={bqmsLoading}
          sparkData={[]}
          sparkColor={COLORS.warning}
        />
      </div>

      {/* ── ROW 2: Revenue Charts ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Doanh thu theo tháng — BarChart */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <SectionHeader
            title="Doanh thu theo tháng"
            subtitle="12 tháng gần nhất — thu nhập, chi phí và lợi nhuận"
            icon={<BarChart3 className="h-4 w-4" />}
          />
          {monthlyRevenue.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyRevenue} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={formatBillions} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
                <Tooltip content={<VndTooltip />} cursor={{ fill: '#f8fafc' }} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#64748b', paddingTop: 8 }} />
                <Bar dataKey="Doanh thu" fill={COLORS.brandLight} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="Chi phí" fill={COLORS.warning} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="Lợi nhuận" fill={COLORS.success} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart height={280} message="Chưa có dữ liệu dòng tiền" />
          )}
        </div>

        {/* So sánh cùng kỳ — LineChart YoY */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <SectionHeader
            title="So sánh doanh thu cùng kỳ (YoY)"
            subtitle={`${currentYear} vs ${lastYear} — 12 tháng`}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={yoyData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatBillions} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
              <Tooltip content={<VndTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#64748b', paddingTop: 8 }} />
              <Line
                type="monotone"
                dataKey={String(currentYear)}
                stroke={COLORS.brand}
                strokeWidth={2.5}
                dot={{ fill: COLORS.brand, r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey={String(lastYear)}
                stroke={COLORS.slate}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ fill: COLORS.slate, r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── ROW 3: RFQ Alerts + Maker Pie ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* RFQ sắp hết hạn — col-span 3 */}
        <div className="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
                <Clock className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">RFQ sắp hết hạn</h3>
                <p className="text-xs text-slate-400">Trong vòng 48 giờ tới — click để điền báo giá</p>
              </div>
            </div>
            {urgentRfqs.length > 0 && (
              <span className="inline-flex items-center gap-1 bg-red-50 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                {urgentRfqs.length} cần xử lý
              </span>
            )}
          </div>
          {urgentRfqs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-300">
              <Clock className="h-10 w-10 mb-2" />
              <p className="text-sm text-slate-400">Không có RFQ nào sắp hết hạn</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-5 py-2 bg-slate-50">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mã RFQ / BQMS</span>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Deadline</span>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Còn lại</span>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Trạng thái</span>
              </div>
              {urgentRfqs.map((rfq: any, idx: number) => {
                const dl = rfq.deadline_dt ?? rfq.deadline ?? rfq.due_date;
                const urgency = deadlineUrgency(dl);
                const hrs = hoursUntil(dl);
                const rfqCode = rfq.rfq_code ?? rfq.rfq_no ?? rfq.code ?? `RFQ-${idx + 1}`;
                const bqmsCode = rfq.bqms_code ?? rfq.reference ?? '—';
                const status = rfq.status ?? 'pending';

                return (
                  <button
                    key={rfq.id ?? idx}
                    onClick={() => router.push(`/bqms/quotation/new?rfq_code=${encodeURIComponent(rfqCode)}`)}
                    className={cn(
                      'w-full grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-5 py-3 text-left transition-all duration-150 hover:bg-slate-50 group',
                      urgency === 'critical' && 'bg-red-50/60 hover:bg-red-50',
                      urgency === 'warning' && 'bg-amber-50/50 hover:bg-amber-50',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {urgency === 'critical' && (
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                        )}
                        <span className="text-sm font-semibold text-slate-800 font-mono truncate">{rfqCode}</span>
                      </div>
                      <span className="text-xs text-slate-400 font-mono">{bqmsCode}</span>
                    </div>
                    <span className="text-xs text-slate-600 font-mono whitespace-nowrap">
                      {formatDate(dl)}
                    </span>
                    <span className={cn(
                      'text-xs font-bold whitespace-nowrap',
                      urgency === 'critical' ? 'text-red-600' : 'text-amber-600'
                    )}>
                      {hrs < 1 ? `${Math.round(hrs * 60)}p` : `${Math.round(hrs)}h`}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium capitalize',
                        urgency === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      )}>
                        {status}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-brand-500 transition-colors" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Phân bổ theo Maker — Donut + col-span 2 */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <SectionHeader
            title="Phân bổ theo Maker"
            subtitle="Top 5 makers theo RFQ 12 tháng"
            icon={<Package className="h-4 w-4" />}
          />
          {makerPie.length > 0 ? (
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={makerPie}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {makerPie.map((_: any, i: number) => (
                      <Cell key={i} fill={MAKER_COLORS[i % MAKER_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val: any, name: any) => [val, name]}
                    contentStyle={{ borderRadius: 12, fontSize: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="w-full space-y-1.5 mt-1">
                {makerPie.map((m: any, i: number) => {
                  const total = makerPie.reduce((s: number, x: any) => s + (x.value ?? 0), 0);
                  const pctVal = total > 0 ? Math.round((m.value / total) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: MAKER_COLORS[i % MAKER_COLORS.length] }} />
                      <span className="text-xs text-slate-600 flex-1 truncate">{m.name}</span>
                      <span className="text-xs font-bold text-slate-700 font-mono">{pctVal}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyChart height={200} message="Chưa có dữ liệu maker" />
          )}

          {/* Win Rate callout */}
          {winRate > 0 && (
            <div className="mt-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-3 border border-blue-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">BQMS Win Rate</span>
                <span className={cn(
                  'text-sm font-bold',
                  winRate >= 50 ? 'text-emerald-600' : 'text-amber-600'
                )}>
                  {winRate.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1.5 h-1.5 bg-white/60 rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', winRate >= 50 ? 'bg-emerald-500' : 'bg-amber-500')}
                  style={{ width: `${Math.min(100, winRate)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs text-slate-400">Thắng: {priceOverview?.won_count ?? 0}</span>
                <span className="text-xs text-slate-400">Tổng: {priceOverview?.total_rfq ?? 0}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── ROW 4: Team Workload + Inventory ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workload team */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <SectionHeader
            title="Workload nhóm"
            subtitle="Phân công công việc theo thành viên"
            icon={<Users className="h-4 w-4" />}
          />
          {workloadData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                layout="vertical"
                data={workloadData}
                margin={{ top: 0, right: 40, bottom: 0, left: 80 }}
                barGap={2}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={76} />
                <Tooltip content={<PctTooltip />} cursor={{ fill: '#f8fafc' }} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#64748b', paddingTop: 8 }} />
                <Bar dataKey="tasks" name="Được giao" fill={COLORS.brandLight} radius={[0, 4, 4, 0]} maxBarSize={14} />
                <Bar dataKey="done" name="Hoàn thành" fill={COLORS.success} radius={[0, 4, 4, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart height={240} message="Chưa có dữ liệu workload" />
          )}
        </div>

        {/* Inventory low-stock alerts */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Cảnh báo tồn kho</h3>
                <p className="text-xs text-slate-400">Mặt hàng dưới mức tối thiểu</p>
              </div>
            </div>
            <Link
              href="/inventory"
              className="text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-0.5 transition-colors"
            >
              Xem kho
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Inventory KPI row */}
          {invDash?.total_items != null && (
            <div className="grid grid-cols-3 gap-px bg-slate-100 border-b border-slate-100">
              {[
                { label: 'Tổng SKU', value: invDash?.total_items ?? invDash?.sku_count ?? 0, color: 'text-slate-700' },
                { label: 'Cảnh báo', value: invDash?.low_stock_count ?? lowStockItems.length, color: 'text-amber-600' },
                { label: 'Hết hàng', value: invDash?.out_of_stock_count ?? invDash?.out_of_stock ?? 0, color: 'text-red-600' },
              ].map((s, i) => (
                <div key={i} className="bg-white px-4 py-2.5 text-center">
                  <p className={cn('text-lg font-bold font-mono', s.color)}>{s.value}</p>
                  <p className="text-xs text-slate-400">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="divide-y divide-slate-50">
            {lowStockItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-300">
                <AlertTriangle className="h-8 w-8 mb-2" />
                <p className="text-sm text-slate-400">Không có cảnh báo tồn kho</p>
              </div>
            ) : (
              lowStockItems.map((item: any, idx: number) => {
                const current = item.quantity ?? item.current_stock ?? item.qty ?? 0;
                const min = item.min_stock ?? item.min_qty ?? 1;
                const ratio = min > 0 ? current / min : 0;
                return (
                  <div key={item.id ?? idx} className="px-5 py-3 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-700 truncate">
                          {item.product_name ?? item.name ?? '—'}
                        </p>
                        <span className="text-xs font-mono text-slate-400">
                          {item.product_code ?? item.sku ?? '—'}
                        </span>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <p className={cn('text-sm font-bold font-mono', ratio < 0.3 ? 'text-red-600' : 'text-amber-600')}>
                          {current}
                        </p>
                        <span className="text-xs text-slate-400">/ {min} min</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          ratio < 0.3 ? 'bg-red-500' : ratio < 0.6 ? 'bg-amber-500' : 'bg-emerald-500'
                        )}
                        style={{ width: `${Math.min(100, ratio * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Empty Chart Placeholder ─────────────────────────────────────

function EmptyChart({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-slate-300 rounded-xl bg-slate-50/60"
      style={{ height }}
    >
      <BarChart3 className="h-8 w-8 mb-2" />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}
