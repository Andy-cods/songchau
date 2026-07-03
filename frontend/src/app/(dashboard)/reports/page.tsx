'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  TrendingUp,
  Building2,
  ClipboardCheck,
  Inbox,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { KPICard } from '@/components/shared/kpi-card';
import { LineAreaChart } from '@/components/charts/line-area-chart';
import { HorizontalBarChart } from '@/components/charts/horizontal-bar-chart';
import { DonutChart } from '@/components/charts/donut-chart';
import { CHART } from '@/lib/chart-colors';

// ─── Page Component ────────────────────────────────────────────

export default function ReportsPage() {
  // Fetch revenue monthly
  const { data: revenueRaw, isLoading: revenueLoading } = useQuery({
    queryKey: ['reports', 'revenue-monthly'],
    queryFn: () => api.get<any>('/api/v1/reports/revenue-monthly'),
    retry: 1,
  });

  // Fetch BQMS win rate
  const { data: winRateRaw, isLoading: winRateLoading } = useQuery({
    queryKey: ['reports', 'bqms-win-rate'],
    queryFn: () => api.get<any>('/api/v1/reports/bqms-win-rate'),
    retry: 1,
  });

  // Fetch supplier performance
  const { data: supplierRaw, isLoading: supplierLoading } = useQuery({
    queryKey: ['reports', 'supplier-performance'],
    queryFn: () => api.get<any>('/api/v1/reports/supplier-performance'),
    retry: 1,
  });

  const isLoading = revenueLoading || winRateLoading || supplierLoading;

  // Extract data from API
  const revenueData: any[] = revenueRaw?.data ?? [];
  const winRateData: any[] = winRateRaw?.data ?? [];
  const supplierData: any[] = supplierRaw?.data ?? [];

  // Compute summary KPIs from real data
  const totalRevenue = revenueData.reduce(
    (sum: number, item: any) => sum + (Number(item.revenue) || 0),
    0
  );
  const latestMonthRevenue =
    revenueData.length > 0
      ? Number(revenueData[revenueData.length - 1]?.revenue) || 0
      : 0;

  const totalWon = winRateData.reduce(
    (sum: number, item: any) => sum + (Number(item.won) || 0),
    0
  );
  const totalBids = winRateData.reduce(
    (sum: number, item: any) => sum + (Number(item.total) || 0),
    0
  );
  const overallWinRate = totalBids > 0 ? ((totalWon / totalBids) * 100).toFixed(1) : '0';

  const topSupplier =
    supplierData.length > 0 ? supplierData[0]?.name ?? '—' : '—';

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Báo cáo"
        subtitle="Thống kê và phân tích dữ liệu hệ thống"
        icon={BarChart3}
        className="mb-6"
        actions={
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <BarChart3 className="h-4 w-4 text-brand-400" />
            <span>3 loại báo cáo</span>
          </div>
        }
      />

      {/* KPI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          label="Doanh thu tháng gần nhất"
          value={latestMonthRevenue > 0 ? formatCurrency(latestMonthRevenue) : '—'}
          accentColor="border-emerald-500"
          loading={isLoading}
        />
        <KPICard
          label="Tổng doanh thu"
          value={totalRevenue > 0 ? formatCurrency(totalRevenue) : '—'}
          accentColor="border-brand-500"
          loading={isLoading}
        />
        <KPICard
          label="Tỷ lệ thắng BQMS"
          value={`${overallWinRate}%`}
          accentColor="border-brand-500"
          loading={isLoading}
          trend={
            totalBids > 0
              ? { direction: 'up', value: `${totalWon}/${totalBids}` }
              : undefined
          }
        />
        <KPICard
          label="Top NCC"
          value={topSupplier}
          accentColor="border-brand-500"
          loading={isLoading}
        />
      </div>

      {/* ── Revenue Chart ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-emerald-50 rounded-lg">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              Báo cáo doanh thu tháng
            </h3>
            <p className="text-xs text-slate-500">
              Thống kê doanh thu theo từng tháng
            </p>
          </div>
        </div>
        {revenueLoading ? (
          <ChartSkeleton />
        ) : revenueData.length > 0 ? (
          <LineAreaChart
            data={revenueData}
            xKey="month"
            yKeys={['revenue']}
            colors={[CHART.success]}
            height={320}
          />
        ) : (
          <NoChartData />
        )}
      </div>

      {/* ── BQMS Win Rate + Supplier Performance ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* BQMS Win Rate */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-brand-50 rounded-lg">
              <ClipboardCheck className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Tỷ lệ thắng BQMS
              </h3>
              <p className="text-xs text-slate-500">
                Phân tích tỷ lệ trúng thầu theo tháng
              </p>
            </div>
          </div>
          {winRateLoading ? (
            <ChartSkeleton />
          ) : winRateData.length > 0 ? (
            <LineAreaChart
              data={winRateData}
              xKey="month"
              yKeys={['total', 'won']}
              colors={[CHART.brand, CHART.success]}
              height={300}
            />
          ) : (
            <NoChartData />
          )}
        </div>

        {/* Supplier Performance */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-brand-50 rounded-lg">
              <Building2 className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Hiệu suất nhà cung cấp
              </h3>
              <p className="text-xs text-slate-500">
                Top NCC theo hiệu suất / giá trị
              </p>
            </div>
          </div>
          {supplierLoading ? (
            <ChartSkeleton />
          ) : supplierData.length > 0 ? (
            <HorizontalBarChart
              data={supplierData.slice(0, 10)}
              nameKey="name"
              valueKey="value"
              color={CHART.brand}
            />
          ) : (
            <NoChartData />
          )}
        </div>
      </div>

      {/* ── Win Rate Donut (if data available) ─────────────────── */}
      {winRateData.length > 0 && totalBids > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">
            Tổng quan tỷ lệ BQMS
          </h3>
          <div className="max-w-md mx-auto">
            <DonutChart
              data={[
                { name: 'Trúng thầu', value: totalWon },
                { name: 'Trượt', value: totalBids - totalWon },
              ]}
              nameKey="name"
              valueKey="value"
              colors={[CHART.success, CHART.danger]}
              height={280}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── No Chart Data ──────────────────────────────────────────────

function NoChartData() {
  return (
    <div className="flex flex-col items-center justify-center h-[300px] text-slate-300">
      <Inbox className="h-12 w-12 mb-3" />
      <p className="text-sm text-slate-400">Chưa có dữ liệu</p>
    </div>
  );
}

// ─── Chart Skeleton ─────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="h-[300px] flex items-end gap-2 px-4 pb-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 bg-slate-200 rounded-t animate-pulse"
          style={{ height: `${20 + Math.random() * 60}%` }}
        />
      ))}
    </div>
  );
}
