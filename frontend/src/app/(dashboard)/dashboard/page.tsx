'use client';

import { useQuery } from '@tanstack/react-query';
import {
  FileCheck,
  TrendingUp,
  AlertTriangle,
  Activity,
  ChevronRight,
  Inbox,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';
import { KPICard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { STATUS_CONFIG } from '@/lib/constants';
import { Sparkline } from '@/components/charts/sparkline';
import { LineAreaChart } from '@/components/charts/line-area-chart';
import { HorizontalBarChart } from '@/components/charts/horizontal-bar-chart';
import type { WorkflowStatus } from '@/types/models';

// ─── Page Component ────────────────────────────────────────────

export default function DashboardPage() {
  // Fetch dashboard KPIs
  const { data: kpisRaw, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: () => api.get<any>('/api/v1/dashboard/kpis'),
    retry: 1,
  });

  // Fetch recent activity
  const { data: activityRaw, isLoading: activityLoading } = useQuery({
    queryKey: ['dashboard-recent-activity'],
    queryFn: () => api.get<any>('/api/v1/dashboard/recent-activity'),
    retry: 1,
  });

  // Fetch stock alerts
  const { data: alertsRaw, isLoading: alertsLoading } = useQuery({
    queryKey: ['dashboard-stock-alerts'],
    queryFn: () => api.get<any>('/api/v1/dashboard/stock-alerts'),
    retry: 1,
  });

  // Fetch revenue monthly for chart
  const { data: revenueRaw } = useQuery({
    queryKey: ['reports-revenue-monthly'],
    queryFn: () => api.get<any>('/api/v1/reports/revenue-monthly'),
    retry: 1,
  });

  // Fetch top suppliers
  const { data: suppliersRaw } = useQuery({
    queryKey: ['reports-supplier-performance'],
    queryFn: () => api.get<any>('/api/v1/reports/supplier-performance'),
    retry: 1,
  });

  // Fetch pending workflows
  const { data: workflowsRaw } = useQuery({
    queryKey: ['workflows-dashboard'],
    queryFn: () => api.get<any>('/api/v1/workflows?status=pending&limit=5'),
    retry: 1,
  });

  // Fetch BQMS KPI for win rate
  const { data: bqmsRaw } = useQuery({
    queryKey: ['bqms-kpi-dash'],
    queryFn: () => api.get<any>('/api/v1/bqms/kpi'),
    retry: 1,
  });

  const isLoading = kpisLoading;

  // Extract KPI values from real API response — no mock fallbacks
  const kpis = kpisRaw?.data ?? kpisRaw ?? {};
  const bqmsKpi = bqmsRaw?.data ?? bqmsRaw ?? {};

  const revenueValue = kpis?.total_revenue ?? kpis?.total_revenue_mtd ?? 0;
  const totalRFQ = kpis?.total_rfq ?? bqmsKpi?.total_rfqs ?? 0;
  const totalDeliveries = kpis?.total_deliveries ?? bqmsKpi?.total_deliveries ?? 0;
  const pendingCount = kpis?.pending_approvals ?? 0;
  const winRate = Number(kpis?.bqms_win_rate ?? bqmsKpi?.win_rate_pct ?? 0);

  // Revenue chart data from real API
  const _rev = revenueRaw?.data;
  const revenueData: any[] = Array.isArray(_rev) ? _rev : Array.isArray(_rev?.items) ? _rev.items : [];

  // Supplier performance data from real API
  const _sup = suppliersRaw?.data;
  const suppliersData: any[] = (Array.isArray(_sup) ? _sup : Array.isArray(_sup?.items) ? _sup.items : []).slice(0, 8);

  // Pending approvals from real API
  const _wf = workflowsRaw?.data;
  const pendingWorkflows: any[] = (Array.isArray(_wf) ? _wf : Array.isArray(_wf?.items) ? _wf.items : []).slice(0, 5);

  // Recent activity from real API
  const _act = activityRaw?.data;
  const activityItems: any[] = (Array.isArray(_act) ? _act : Array.isArray(_act?.items) ? _act.items : []).slice(0, 8);

  // Stock alerts from real API
  const _alr = alertsRaw?.data;
  const stockAlerts: any[] = (Array.isArray(_alr) ? _alr : Array.isArray(_alr?.items) ? _alr.items : []).slice(0, 6);

  // Sparkline data from KPIs (if available from API) or empty
  const revenueTrend = kpis?.revenue_trend ?? [];
  const poTrend = kpis?.po_trend ?? [];
  const pendingTrend = kpis?.pending_trend ?? [];
  const stockTrend = kpis?.stock_trend ?? [];
  const winTrend = kpis?.win_trend ?? [];

  return (
    <div>
      <h2 className="text-xl font-display font-bold text-slate-900 mb-6">
        Tổng quan
      </h2>

      {/* ── ROW 1: KPI Cards with Sparklines ──────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <KPICardWithSparkline
          label="Doanh thu tháng"
          value={revenueValue ? formatCurrency(revenueValue) : '0'}
          accentColor="border-brand-500"
          loading={isLoading}
          sparkData={revenueTrend}
          sparkColor="#6366f1"
        />

        <KPICardWithSparkline
          label="BQMS RFQ"
          value={totalRFQ}
          accentColor="border-cyan-500"
          loading={isLoading}
          sparkData={poTrend}
          sparkColor="#06b6d4"
        />

        <KPICardWithSparkline
          label="Chờ duyệt"
          value={pendingCount}
          accentColor="border-amber-500"
          loading={isLoading}
          trend={
            pendingCount > 0
              ? { direction: 'up' as const, value: `${pendingCount} yêu cầu` }
              : undefined
          }
          sparkData={pendingTrend}
          sparkColor="#f59e0b"
        />

        <KPICardWithSparkline
          label="Giao hàng"
          value={totalDeliveries}
          accentColor="border-red-500"
          loading={isLoading}
          trend={
            totalDeliveries > 0
              ? { direction: 'up' as const, value: `${totalDeliveries} đơn` }
              : undefined
          }
          sparkData={stockTrend}
          sparkColor="#ef4444"
        />

        <KPICardWithSparkline
          label="BQMS Win%"
          value={winRate ? `${winRate}%` : '0%'}
          accentColor="border-emerald-500"
          loading={isLoading}
          trend={
            winRate > 0
              ? {
                  direction: winRate >= 50 ? ('up' as const) : ('down' as const),
                  value: `${bqmsKpi?.total_won ?? 0}/${bqmsKpi?.total_bids ?? 0}`,
                }
              : undefined
          }
          sparkData={winTrend}
          sparkColor="#10b981"
        />
      </div>

      {/* ── ROW 2: Charts ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        {/* Revenue Trend */}
        <div className="lg:col-span-7 bg-white rounded-lg shadow-sm p-4">
          {revenueData.length > 0 ? (
            <LineAreaChart
              data={revenueData}
              xKey="month"
              yKeys={['revenue']}
              colors={['#6366f1']}
              title="Xu hướng doanh thu theo tháng"
              height={300}
            />
          ) : (
            <NoChartData title="Xu hướng doanh thu theo tháng" />
          )}
        </div>

        {/* Top Suppliers */}
        <div className="lg:col-span-5 bg-white rounded-lg shadow-sm p-4">
          {suppliersData.length > 0 ? (
            <HorizontalBarChart
              data={suppliersData}
              nameKey="name"
              valueKey="value"
              color="#06b6d4"
              title="Top NCC theo hiệu suất"
            />
          ) : (
            <NoChartData title="Top NCC theo hiệu suất" />
          )}
        </div>
      </div>

      {/* ── ROW 3: Panels ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pending Approvals */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="flex items-center justify-between p-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-700">
                Phê duyệt đang chờ
              </h3>
            </div>
            <Link
              href="/approvals"
              className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5"
            >
              Xem tất cả
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {pendingWorkflows.length === 0 ? (
              <EmptyPanel
                icon={<FileCheck className="h-10 w-10" />}
                message="Không có yêu cầu nào đang chờ duyệt"
              />
            ) : (
              pendingWorkflows.map((item: any, idx: number) => {
                const status = (item.status ?? 'pending') as WorkflowStatus;
                const sc = (STATUS_CONFIG as any)[status] ?? {
                  label: status,
                  variant: 'neutral' as const,
                };
                return (
                  <div
                    key={item.id ?? idx}
                    className="px-4 py-3 hover:bg-slate-50/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-700 truncate">
                        {item.title ?? item.reference_id ?? `Workflow #${idx + 1}`}
                      </p>
                      <StatusBadge
                        label={sc.label}
                        variant={sc.variant}
                        pulse={sc.pulse}
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-400">
                        {item.initiator?.full_name ??
                          item.initiated_by_name ??
                          item.initiated_by ??
                          '—'}
                      </span>
                      <span className="text-xs text-slate-300">|</span>
                      <span className="text-xs text-slate-400">
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="flex items-center gap-2 p-4 border-b border-slate-100">
            <Activity className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-slate-700">
              Hoạt động gần đây
            </h3>
          </div>
          <div className="divide-y divide-slate-50">
            {activityLoading ? (
              <ActivitySkeleton />
            ) : activityItems.length === 0 ? (
              <EmptyPanel
                icon={<Activity className="h-10 w-10" />}
                message="Chưa có dữ liệu hoạt động"
              />
            ) : (
              activityItems.map((item: any, idx: number) => (
                <div
                  key={item.id ?? idx}
                  className="px-4 py-3 hover:bg-slate-50/50 transition-colors"
                >
                  <p className="text-sm text-slate-600">
                    <span className="font-medium text-slate-700">
                      {item.user_email ?? item.user_name ?? '—'}
                    </span>{' '}
                    {item.action ?? '—'}{' '}
                    <span className="font-mono text-brand-600 text-xs">
                      {item.table_name ?? item.target ?? ''}
                    </span>
                  </p>
                  <span className="text-xs text-slate-400 mt-0.5 block">
                    {formatRelativeTime(item.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Stock Alerts */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="flex items-center justify-between p-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <h3 className="text-sm font-semibold text-slate-700">
                Cảnh báo tồn kho
              </h3>
            </div>
            <Link
              href="/inventory"
              className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5"
            >
              Xem kho
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {alertsLoading ? (
              <ActivitySkeleton />
            ) : stockAlerts.length === 0 ? (
              <EmptyPanel
                icon={<AlertTriangle className="h-10 w-10" />}
                message="Không có cảnh báo tồn kho"
              />
            ) : (
              stockAlerts.map((item: any, idx: number) => {
                const current = item.quantity ?? item.current_stock ?? 0;
                const min = item.min_stock ?? 1;
                const ratio = min > 0 ? current / min : 0;
                return (
                  <div
                    key={item.id ?? idx}
                    className="px-4 py-3 hover:bg-slate-50/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-700">
                          {item.product_name}
                        </p>
                        <span className="text-xs font-mono text-slate-400">
                          {item.product_code}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono font-bold text-red-600">
                          {current}
                        </p>
                        <span className="text-xs text-slate-400">
                          / {min} tối thiểu
                        </span>
                      </div>
                    </div>
                    {/* Stock bar */}
                    <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          ratio < 0.3
                            ? 'bg-red-500'
                            : ratio < 0.6
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                        )}
                        style={{
                          width: `${Math.min(100, ratio * 100)}%`,
                        }}
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

// ─── KPI Card + Sparkline Wrapper ──────────────────────────────

function KPICardWithSparkline({
  sparkData,
  sparkColor,
  loading,
  ...kpiProps
}: React.ComponentProps<typeof KPICard> & {
  sparkData: number[];
  sparkColor: string;
}) {
  if (loading) {
    return <KPICard {...kpiProps} loading />;
  }

  return (
    <div
      className={cn(
        'bg-white rounded-lg p-4 border-t-[3px] shadow-sm transition-shadow hover:shadow-md',
        kpiProps.accentColor || 'border-brand-500',
        kpiProps.className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono uppercase text-slate-400 tracking-wider">
            {kpiProps.label}
          </p>
          <p className="text-2xl font-display font-bold text-slate-900 mt-1">
            {kpiProps.value}
          </p>
          {kpiProps.trend && (
            <div
              className={cn(
                'flex items-center gap-1 mt-1 text-xs font-medium',
                kpiProps.trend.direction === 'up'
                  ? 'text-emerald-600'
                  : 'text-red-600'
              )}
            >
              {kpiProps.trend.direction === 'up' ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingUp className="h-3.5 w-3.5 rotate-180" />
              )}
              <span>{kpiProps.trend.value}</span>
            </div>
          )}
        </div>
        {sparkData.length > 0 && (
          <div className="ml-2 flex-shrink-0">
            <Sparkline data={sparkData} color={sparkColor} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty Panel ────────────────────────────────────────────────

function EmptyPanel({
  icon,
  message,
}: {
  icon: React.ReactNode;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-slate-300">
      {icon}
      <p className="text-sm text-slate-400 mt-2">{message}</p>
    </div>
  );
}

// ─── No Chart Data ──────────────────────────────────────────────

function NoChartData({ title }: { title: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      <div className="flex flex-col items-center justify-center h-[300px] text-slate-300">
        <Inbox className="h-12 w-12 mb-3" />
        <p className="text-sm text-slate-400">Chưa có dữ liệu</p>
      </div>
    </div>
  );
}

// ─── Activity Skeleton ──────────────────────────────────────────

function ActivitySkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-1">
          <div className="h-4 w-3/4 bg-slate-200 rounded animate-pulse" />
          <div className="h-3 w-1/3 bg-slate-100 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
