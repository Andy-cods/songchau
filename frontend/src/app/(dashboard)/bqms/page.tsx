'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardList,
  RefreshCw,
  Search,
  Inbox,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { KPICard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { LineAreaChart } from '@/components/charts/line-area-chart';
import { DonutChart } from '@/components/charts/donut-chart';
import { ParetoChart } from '@/components/charts/pareto-chart';
import { HorizontalBarChart } from '@/components/charts/horizontal-bar-chart';

// ─── Status Configs for BQMS ───────────────────────────────────

const BQMS_STATUS_MAP: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
> = {
  draft: { label: 'Nháp', variant: 'neutral' },
  submitted: { label: 'Đã gửi', variant: 'info' },
  won: { label: 'Trúng', variant: 'success' },
  lost: { label: 'Trượt', variant: 'danger' },
  cancelled: { label: 'Hủy', variant: 'neutral' },
  pending: { label: 'Đang chờ', variant: 'warning' },
};

// ─── Page Component ────────────────────────────────────────────

export default function BQMSPage() {
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch KPIs
  const { data: kpiRaw, isLoading: kpiLoading } = useQuery({
    queryKey: ['bqms', 'kpi'],
    queryFn: () => api.get<any>('/api/v1/bqms/kpi'),
    retry: 1,
  });

  // Fetch records
  const { data: recordsRaw, isLoading: recordsLoading } = useQuery({
    queryKey: ['bqms', 'records'],
    queryFn: () => api.get<any>('/api/v1/bqms/records'),
    retry: 1,
  });

  // Fetch RFQ data for volume trends
  const { data: rfqRaw } = useQuery({
    queryKey: ['bqms', 'rfq-overview'],
    queryFn: () => api.get<any>('/api/v1/bqms/rfq'),
    retry: 1,
  });

  // Fetch Pareto data
  const { data: paretoRaw } = useQuery({
    queryKey: ['bqms', 'pareto'],
    queryFn: () => api.get<any>('/api/v1/bqms/analytics/pareto'),
    retry: 1,
  });

  // Fetch BQMS win rate from reports
  const { data: winRateRaw } = useQuery({
    queryKey: ['reports', 'bqms-win-rate'],
    queryFn: () => api.get<any>('/api/v1/reports/bqms-win-rate'),
    retry: 1,
  });

  // Extract data from API responses
  const kpiData = kpiRaw?.data ?? kpiRaw ?? {};
  const records: any[] = recordsRaw?.data ?? [];
  const rfqList: any[] = rfqRaw?.data ?? [];
  const paretoData: any[] = paretoRaw?.data ?? [];
  const winRateData: any[] = winRateRaw?.data ?? [];

  // KPI values
  const totalItems = kpiData?.total_items ?? kpiData?.total_bids ?? 0;
  const processed = kpiData?.processed ?? kpiData?.total_won ?? 0;
  const makerCount = kpiData?.maker_count ?? 0;
  const winRate = Number(kpiData?.win_rate ?? 0);
  const lastSynced = kpiData?.last_synced ?? null;

  // Compute type split from records if available
  const typeSplitMap: Record<string, number> = {};
  records.forEach((r: any) => {
    const t = r.type || r.record_type || 'Khác';
    typeSplitMap[t] = (typeSplitMap[t] || 0) + 1;
  });
  const typeSplitData = Object.entries(typeSplitMap).map(([name, value]) => ({
    name,
    value,
  }));

  // Build deadline urgency from records with deadlines
  const today = new Date();
  const deadlineBuckets = { 'Quá hạn': 0, 'Hôm nay': 0, '1-3 ngày': 0, '4-7 ngày': 0, '>7 ngày': 0 };
  records.forEach((r: any) => {
    const dl = r.deadline || r.submitted_at;
    if (!dl) return;
    const d = new Date(dl);
    const diff = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) deadlineBuckets['Quá hạn']++;
    else if (diff === 0) deadlineBuckets['Hôm nay']++;
    else if (diff <= 3) deadlineBuckets['1-3 ngày']++;
    else if (diff <= 7) deadlineBuckets['4-7 ngày']++;
    else deadlineBuckets['>7 ngày']++;
  });
  const deadlineData = Object.entries(deadlineBuckets)
    .map(([label, count]) => ({ label, count }))
    .filter((d) => d.count > 0);

  // Filter records by search
  const filteredRecords = searchQuery
    ? records.filter((r: any) => {
        const q = searchQuery.toLowerCase();
        return (
          (r.bqms_code || r.reference_number || '').toLowerCase().includes(q) ||
          (r.product_name || r.project_name || '').toLowerCase().includes(q) ||
          (r.maker || r.client_name || '').toLowerCase().includes(q) ||
          (r.order_number || '').toLowerCase().includes(q)
        );
      })
    : records;

  return (
    <div>
      {/* ── Topbar ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            BQMS Analytics
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Hệ thống quản lý báo giá mua sắm
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <RefreshCw className="h-3.5 w-3.5" />
          <span>
            Cập nhật lần cuối:{' '}
            {lastSynced ? formatDate(lastSynced) : formatDate(new Date())}
          </span>
        </div>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          label="Tổng BQMS"
          value={totalItems}
          accentColor="border-brand-500"
          loading={kpiLoading}
        />
        <KPICard
          label="Đã xử lý"
          value={processed}
          accentColor="border-emerald-500"
          loading={kpiLoading}
          trend={
            winRate > 0
              ? { direction: 'up', value: `${winRate.toFixed(1)}% win` }
              : undefined
          }
        />
        <KPICard
          label="Makers"
          value={makerCount}
          accentColor="border-cyan-500"
          loading={kpiLoading}
        />
        <KPICard
          label="Đang chờ"
          value={totalItems - processed > 0 ? totalItems - processed : 0}
          accentColor="border-amber-500"
          loading={kpiLoading}
          trend={
            totalItems - processed > 0
              ? { direction: 'up', value: 'cần xử lý' }
              : undefined
          }
        />
      </div>

      {/* ── Charts Row 1 ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <div className="lg:col-span-7 bg-white rounded-lg shadow-sm p-4">
          {winRateData.length > 0 ? (
            <LineAreaChart
              data={winRateData}
              xKey="month"
              yKeys={['total', 'won']}
              colors={['#6366f1', '#10b981']}
              title="Xu hướng BQMS theo tháng"
              height={300}
            />
          ) : (
            <NoChartData title="Xu hướng BQMS theo tháng" />
          )}
        </div>

        <div className="lg:col-span-5 bg-white rounded-lg shadow-sm p-4">
          {typeSplitData.length > 0 ? (
            <DonutChart
              data={typeSplitData}
              nameKey="name"
              valueKey="value"
              colors={['#6366f1', '#06b6d4', '#10b981', '#f59e0b']}
              title="Phân bổ theo loại"
              height={300}
            />
          ) : (
            <NoChartData title="Phân bổ theo loại" />
          )}
        </div>
      </div>

      {/* ── Charts Row 2 ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <div className="lg:col-span-6 bg-white rounded-lg shadow-sm p-4">
          {paretoData.length > 0 ? (
            <ParetoChart
              data={paretoData}
              nameKey="maker"
              valueKey="count"
              barColor="#6366f1"
              lineColor="#f59e0b"
              title="Top Makers (Pareto)"
              height={320}
            />
          ) : (
            <NoChartData title="Top Makers (Pareto)" />
          )}
        </div>

        <div className="lg:col-span-6 bg-white rounded-lg shadow-sm p-4">
          {deadlineData.length > 0 ? (
            <HorizontalBarChart
              data={deadlineData}
              nameKey="label"
              valueKey="count"
              color="#ef4444"
              title="Deadline khẩn cấp"
            />
          ) : (
            <NoChartData title="Deadline khẩn cấp" />
          )}
        </div>
      </div>

      {/* ── Data Table ────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {/* Table header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-slate-700">
              Danh sách BQMS ({records.length} bản ghi)
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm kiếm..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-56"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        {recordsLoading ? (
          <TableSkeleton />
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <ClipboardList className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400 font-medium">
              Chưa có dữ liệu BQMS
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <TH>Ngày</TH>
                  <TH>Mã</TH>
                  <TH>Tên hàng</TH>
                  <TH>Loại</TH>
                  <TH>Maker</TH>
                  <TH align="right">SL</TH>
                  <TH>Trạng thái</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.slice(0, 50).map((record: any, idx: number) => {
                  const status = record.status || 'draft';
                  const statusCfg = BQMS_STATUS_MAP[status] ?? {
                    label: status,
                    variant: 'neutral' as const,
                  };
                  return (
                    <tr
                      key={record.id ?? idx}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <TD>
                        {formatDate(
                          record.date ??
                            record.created_at ??
                            record.submitted_at
                        )}
                      </TD>
                      <TD>
                        <span className="font-mono text-brand-600">
                          {record.bqms_code ??
                            record.reference_number ??
                            record.order_number ??
                            '—'}
                        </span>
                      </TD>
                      <TD>
                        {record.product_name ??
                          record.project_name ??
                          record.client_name ??
                          '—'}
                      </TD>
                      <TD>
                        {record.type || record.record_type ? (
                          <span
                            className={cn(
                              'inline-flex px-1.5 py-0.5 rounded text-xs font-medium',
                              (record.type || record.record_type) === 'GC'
                                ? 'bg-indigo-50 text-indigo-700'
                                : 'bg-cyan-50 text-cyan-700'
                            )}
                          >
                            {record.type || record.record_type}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD>{record.maker ?? '—'}</TD>
                      <TD align="right">
                        <span className="font-mono">
                          {record.quantity != null
                            ? Number(record.quantity).toLocaleString('vi-VN')
                            : '—'}
                        </span>
                      </TD>
                      <TD>
                        <StatusBadge
                          label={statusCfg.label}
                          variant={statusCfg.variant}
                        />
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
        <p className="text-sm text-slate-400">Chưa có dữ liệu biểu đồ</p>
      </div>
    </div>
  );
}

// ─── Table Helpers ──────────────────────────────────────────────

function TH({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
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

function TD({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <td
      className={cn(
        'px-4 py-3 text-sm text-slate-700',
        align === 'right' ? 'text-right' : 'text-left'
      )}
    >
      {children}
    </td>
  );
}

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-36 bg-slate-200 rounded animate-pulse flex-1" />
          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-16 bg-slate-200 rounded-full animate-pulse" />
        </div>
      ))}
    </div>
  );
}
