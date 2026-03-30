'use client';

import { useQuery } from '@tanstack/react-query';
import {
  FileCheck,
  TrendingUp,
  AlertTriangle,
  Activity,
  ChevronRight,
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
import type { BQMSKpi, WorkflowStatus } from '@/types/models';

// ─── API Response Types ────────────────────────────────────────

interface DashboardKPIs {
  revenue_this_month: number;
  total_po_this_month: number;
  pending_approvals: number;
  low_stock_items: number;
  bqms_win_rate: number;
  revenue_trend: number[];
  po_trend: number[];
  pending_trend: number[];
  stock_trend: number[];
  win_trend: number[];
}

interface RevenuePoint {
  month: string;
  revenue: number;
}

interface TopSupplier {
  name: string;
  value: number;
}

interface PendingApproval {
  id: string;
  title: string;
  type: string;
  status: WorkflowStatus;
  initiated_by_name: string;
  created_at: string;
}

interface ActivityItem {
  id: string;
  action: string;
  user_name: string;
  target: string;
  created_at: string;
}

interface StockAlert {
  id: string;
  product_name: string;
  product_code: string;
  current_stock: number;
  min_stock: number;
}

// ─── Mock / Fallback Data ──────────────────────────────────────

const MOCK_REVENUE_TREND: RevenuePoint[] = [
  { month: 'T8/25', revenue: 820000000 },
  { month: 'T9/25', revenue: 950000000 },
  { month: 'T10/25', revenue: 870000000 },
  { month: 'T11/25', revenue: 1100000000 },
  { month: 'T12/25', revenue: 1250000000 },
  { month: 'T1/26', revenue: 980000000 },
  { month: 'T2/26', revenue: 1150000000 },
  { month: 'T3/26', revenue: 1380000000 },
];

const MOCK_TOP_SUPPLIERS: TopSupplier[] = [
  { name: 'Mitsubishi Electric', value: 2800000000 },
  { name: 'Schneider Electric', value: 2200000000 },
  { name: 'Siemens AG', value: 1900000000 },
  { name: 'ABB Ltd', value: 1600000000 },
  { name: 'Omron Corp', value: 1200000000 },
  { name: 'Fuji Electric', value: 950000000 },
  { name: 'LS Electric', value: 780000000 },
  { name: 'Chint Group', value: 620000000 },
];

const MOCK_PENDING: PendingApproval[] = [
  {
    id: '1',
    title: 'PO-2026-0142 - Mitsubishi Electric',
    type: 'po_approval',
    status: 'pending',
    initiated_by_name: 'Nguyễn Văn An',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '2',
    title: 'PO-2026-0139 - Schneider Electric',
    type: 'po_approval',
    status: 'in_review',
    initiated_by_name: 'Trần Thị Bích',
    created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '3',
    title: 'Thay đổi giá - LS Electric Q2/2026',
    type: 'price_change',
    status: 'pending',
    initiated_by_name: 'Lê Hoàng Nam',
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
];

const MOCK_ACTIVITY: ActivityItem[] = [
  {
    id: '1',
    action: 'đã duyệt',
    user_name: 'Phạm Minh Tuấn',
    target: 'PO-2026-0138',
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
  {
    id: '2',
    action: 'đã tạo',
    user_name: 'Nguyễn Văn An',
    target: 'PO-2026-0142',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '3',
    action: 'cập nhật trạng thái giao hàng',
    user_name: 'Trần Văn Đức',
    target: 'DL-2026-0055',
    created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '4',
    action: 'đã trúng thầu',
    user_name: 'Lê Thị Hoa',
    target: 'BQMS-20260312',
    created_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '5',
    action: 'nhập kho',
    user_name: 'Trần Văn Đức',
    target: 'PO-2026-0135',
    created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  },
];

const MOCK_STOCK_ALERTS: StockAlert[] = [
  { id: '1', product_name: 'Contactor MC-9b', product_code: 'MC-9B-LS', current_stock: 3, min_stock: 10 },
  { id: '2', product_name: 'MCCB NF125-SGV', product_code: 'NF125SGV-MIT', current_stock: 1, min_stock: 5 },
  { id: '3', product_name: 'Relay MY4N 24VDC', product_code: 'MY4N-24DC-OMR', current_stock: 8, min_stock: 20 },
  { id: '4', product_name: 'MCB iC60N 2P 16A', product_code: 'IC60N-2P16-SCH', current_stock: 5, min_stock: 15 },
];

const MOCK_KPI_SPARKLINES = {
  revenue: [65, 72, 58, 80, 92, 75, 88, 100],
  po: [12, 15, 10, 18, 22, 14, 20, 25],
  pending: [5, 3, 7, 4, 6, 8, 3, 5],
  stock: [2, 4, 3, 5, 4, 6, 5, 4],
  win: [60, 55, 65, 70, 62, 68, 72, 75],
};

// ─── Page Component ────────────────────────────────────────────

export default function DashboardPage() {
  // Fetch dashboard KPIs
  const { data: kpis, isLoading: kpisLoading } = useQuery<DashboardKPIs>({
    queryKey: ['dashboard', 'kpis'],
    queryFn: () => api.get('/api/v1/dashboard/kpis'),
    retry: false,
  });

  // Fetch BQMS KPIs
  const { data: bqmsKpi, isLoading: bqmsLoading } = useQuery<BQMSKpi>({
    queryKey: ['bqms', 'kpi'],
    queryFn: () => api.get('/api/v1/bqms/kpi'),
    retry: false,
  });

  // Fetch revenue trend
  const { data: revenueTrend } = useQuery<RevenuePoint[]>({
    queryKey: ['dashboard', 'revenue-trend'],
    queryFn: () => api.get('/api/v1/dashboard/revenue-trend'),
    retry: false,
  });

  // Fetch top suppliers
  const { data: topSuppliers } = useQuery<TopSupplier[]>({
    queryKey: ['dashboard', 'top-suppliers'],
    queryFn: () => api.get('/api/v1/dashboard/top-suppliers'),
    retry: false,
  });

  // Fetch pending approvals
  const { data: pendingApprovals } = useQuery<PendingApproval[]>({
    queryKey: ['workflows', 'pending', 'me'],
    queryFn: () => api.get('/api/v1/workflows/pending/me'),
    retry: false,
  });

  const isLoading = kpisLoading || bqmsLoading;

  // Use real data or fall back to mock
  const revenueData = revenueTrend?.length ? revenueTrend : MOCK_REVENUE_TREND;
  const suppliersData = topSuppliers?.length ? topSuppliers : MOCK_TOP_SUPPLIERS;
  const pendingData = pendingApprovals?.length ? pendingApprovals : MOCK_PENDING;

  const revenueValue = kpis?.revenue_this_month ?? 1380000000;
  const totalPO = kpis?.total_po_this_month ?? 25;
  const pendingCount = kpis?.pending_approvals ?? 5;
  const lowStockCount = kpis?.low_stock_items ?? 4;
  const winRate = bqmsKpi?.win_rate ?? 75;

  return (
    <div>
      <h2 className="text-xl font-display font-bold text-slate-900 mb-6">
        Tổng quan
      </h2>

      {/* ── ROW 1: KPI Cards with Sparklines ──────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <KPICardWithSparkline
          label="Doanh thu tháng"
          value={formatCurrency(revenueValue)}
          accentColor="border-brand-500"
          loading={isLoading}
          trend={{ direction: 'up', value: '+12% so với T2' }}
          sparkData={kpis?.revenue_trend ?? MOCK_KPI_SPARKLINES.revenue}
          sparkColor="#6366f1"
        />

        <KPICardWithSparkline
          label="Tổng PO"
          value={totalPO}
          accentColor="border-cyan-500"
          loading={isLoading}
          trend={{ direction: 'up', value: '+3 so với T2' }}
          sparkData={kpis?.po_trend ?? MOCK_KPI_SPARKLINES.po}
          sparkColor="#06b6d4"
        />

        <KPICardWithSparkline
          label="Chờ duyệt"
          value={pendingCount}
          accentColor="border-amber-500"
          loading={isLoading}
          trend={
            pendingCount > 3
              ? { direction: 'up' as const, value: `${pendingCount} yêu cầu` }
              : undefined
          }
          sparkData={kpis?.pending_trend ?? MOCK_KPI_SPARKLINES.pending}
          sparkColor="#f59e0b"
        />

        <KPICardWithSparkline
          label="Tồn kho thấp"
          value={lowStockCount}
          accentColor="border-red-500"
          loading={isLoading}
          trend={
            lowStockCount > 0
              ? { direction: 'up' as const, value: `${lowStockCount} sản phẩm` }
              : undefined
          }
          sparkData={kpis?.stock_trend ?? MOCK_KPI_SPARKLINES.stock}
          sparkColor="#ef4444"
        />

        <KPICardWithSparkline
          label="BQMS Win%"
          value={`${winRate}%`}
          accentColor="border-emerald-500"
          loading={isLoading}
          trend={
            winRate >= 50
              ? { direction: 'up' as const, value: `${bqmsKpi?.total_won ?? 18}/${bqmsKpi?.total_bids ?? 24}` }
              : { direction: 'down' as const, value: `${bqmsKpi?.total_won ?? 18}/${bqmsKpi?.total_bids ?? 24}` }
          }
          sparkData={kpis?.win_trend ?? MOCK_KPI_SPARKLINES.win}
          sparkColor="#10b981"
        />
      </div>

      {/* ── ROW 2: Charts ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        {/* Revenue Trend */}
        <div className="lg:col-span-7 bg-white rounded-lg shadow-sm p-4">
          <LineAreaChart
            data={revenueData}
            xKey="month"
            yKeys={['revenue']}
            colors={['#6366f1']}
            title="Xu hướng doanh thu (8 tháng gần nhất)"
            height={300}
          />
        </div>

        {/* Top Suppliers */}
        <div className="lg:col-span-5 bg-white rounded-lg shadow-sm p-4">
          <HorizontalBarChart
            data={suppliersData}
            nameKey="name"
            valueKey="value"
            color="#06b6d4"
            title="Top 8 NCC theo giá trị"
          />
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
            {pendingData.length === 0 ? (
              <EmptyState
                icon={<FileCheck className="h-10 w-10" />}
                message="Không có yêu cầu nào đang chờ duyệt"
              />
            ) : (
              pendingData.map((item) => {
                const sc = STATUS_CONFIG[item.status];
                return (
                  <div
                    key={item.id}
                    className="px-4 py-3 hover:bg-slate-50/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-700 truncate">
                        {item.title}
                      </p>
                      {sc && (
                        <StatusBadge
                          label={sc.label}
                          variant={sc.variant}
                          pulse={sc.pulse}
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-400">
                        {item.initiated_by_name}
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
            {MOCK_ACTIVITY.map((item) => (
              <div
                key={item.id}
                className="px-4 py-3 hover:bg-slate-50/50 transition-colors"
              >
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-slate-700">
                    {item.user_name}
                  </span>{' '}
                  {item.action}{' '}
                  <span className="font-mono text-brand-600 text-xs">
                    {item.target}
                  </span>
                </p>
                <span className="text-xs text-slate-400 mt-0.5 block">
                  {formatRelativeTime(item.created_at)}
                </span>
              </div>
            ))}
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
            {MOCK_STOCK_ALERTS.map((item) => (
              <div
                key={item.id}
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
                      {item.current_stock}
                    </p>
                    <span className="text-xs text-slate-400">
                      / {item.min_stock} tối thiểu
                    </span>
                  </div>
                </div>
                {/* Stock bar */}
                <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      item.current_stock / item.min_stock < 0.3
                        ? 'bg-red-500'
                        : item.current_stock / item.min_stock < 0.6
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                    )}
                    style={{
                      width: `${Math.min(100, (item.current_stock / item.min_stock) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
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
        <div className="ml-2 flex-shrink-0">
          <Sparkline data={sparkData} color={sparkColor} />
        </div>
      </div>
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────

function EmptyState({
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
