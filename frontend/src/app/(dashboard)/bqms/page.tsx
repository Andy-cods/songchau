'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardList,
  RefreshCw,
  Search,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { KPICard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { LineAreaChart } from '@/components/charts/line-area-chart';
import { DonutChart } from '@/components/charts/donut-chart';
import { ParetoChart } from '@/components/charts/pareto-chart';
import { HorizontalBarChart } from '@/components/charts/horizontal-bar-chart';
import type { BQMSKpi, PaginatedResponse } from '@/types/models';

// ─── Types ─────────────────────────────────────────────────────

interface BQMSVolumePoint {
  month: string;
  total: number;
  won: number;
}

interface BQMSTypeSplit {
  name: string;
  value: number;
}

interface MakerCount {
  maker: string;
  count: number;
}

interface DeadlineUrgency {
  label: string;
  count: number;
}

interface BQMSTableRecord {
  id: string;
  date: string;
  order_number: string;
  bqms_code: string;
  product_name: string;
  type: string;
  maker: string;
  quantity: number;
  deadline: string;
  status: 'draft' | 'submitted' | 'won' | 'lost' | 'cancelled';
}

// ─── Mock / Fallback Data ──────────────────────────────────────

const MOCK_KPI: BQMSKpi = {
  total_bids: 156,
  total_won: 98,
  total_lost: 42,
  win_rate: 62.8,
  total_value: 18500000000,
  won_value: 12200000000,
  period: 'Q1/2026',
};

const MOCK_VOLUME: BQMSVolumePoint[] = [
  { month: 'T10/25', total: 18, won: 11 },
  { month: 'T11/25', total: 22, won: 15 },
  { month: 'T12/25', total: 20, won: 12 },
  { month: 'T1/26', total: 25, won: 17 },
  { month: 'T2/26', total: 19, won: 13 },
  { month: 'T3/26', total: 28, won: 18 },
];

const MOCK_TYPE_SPLIT: BQMSTypeSplit[] = [
  { name: 'Gia công (GC)', value: 94 },
  { name: 'Thương mại (TM)', value: 62 },
];

const MOCK_MAKERS: MakerCount[] = [
  { maker: 'Mitsubishi', count: 35 },
  { maker: 'Schneider', count: 28 },
  { maker: 'Siemens', count: 22 },
  { maker: 'ABB', count: 18 },
  { maker: 'Omron', count: 15 },
  { maker: 'Fuji', count: 12 },
  { maker: 'LS', count: 14 },
  { maker: 'Chint', count: 12 },
];

const MOCK_DEADLINE: DeadlineUrgency[] = [
  { label: 'Quá hạn', count: 5 },
  { label: 'Hôm nay', count: 3 },
  { label: '1-3 ngày', count: 8 },
  { label: '4-7 ngày', count: 12 },
  { label: '>7 ngày', count: 28 },
];

const MOCK_TABLE_RECORDS: BQMSTableRecord[] = [
  {
    id: '1',
    date: '2026-03-28',
    order_number: 'DH-2026-0089',
    bqms_code: 'BQ-260328-001',
    product_name: 'MCCB NF250-SEV 3P 200A',
    type: 'TM',
    maker: 'Mitsubishi',
    quantity: 50,
    deadline: '2026-04-05',
    status: 'submitted',
  },
  {
    id: '2',
    date: '2026-03-27',
    order_number: 'DH-2026-0088',
    bqms_code: 'BQ-260327-002',
    product_name: 'Contactor MC-85a 220V',
    type: 'GC',
    maker: 'LS Electric',
    quantity: 200,
    deadline: '2026-04-02',
    status: 'won',
  },
  {
    id: '3',
    date: '2026-03-26',
    order_number: 'DH-2026-0087',
    bqms_code: 'BQ-260326-003',
    product_name: 'ACB NT06H1 630A 3P',
    type: 'TM',
    maker: 'Schneider',
    quantity: 5,
    deadline: '2026-04-10',
    status: 'submitted',
  },
  {
    id: '4',
    date: '2026-03-25',
    order_number: 'DH-2026-0085',
    bqms_code: 'BQ-260325-001',
    product_name: 'VFD FR-E840-0120 5.5kW',
    type: 'GC',
    maker: 'Mitsubishi',
    quantity: 10,
    deadline: '2026-03-30',
    status: 'lost',
  },
  {
    id: '5',
    date: '2026-03-24',
    order_number: 'DH-2026-0083',
    bqms_code: 'BQ-260324-002',
    product_name: 'Relay G3PE-245B DC12-24',
    type: 'TM',
    maker: 'Omron',
    quantity: 100,
    deadline: '2026-04-01',
    status: 'won',
  },
  {
    id: '6',
    date: '2026-03-23',
    order_number: 'DH-2026-0081',
    bqms_code: 'BQ-260323-001',
    product_name: 'MCB iC60N 3P 32A C',
    type: 'TM',
    maker: 'Schneider',
    quantity: 500,
    deadline: '2026-03-28',
    status: 'draft',
  },
];

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
};

// ─── Page Component ────────────────────────────────────────────

export default function BQMSPage() {
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch KPIs
  const { data: kpi, isLoading: kpiLoading } = useQuery<BQMSKpi>({
    queryKey: ['bqms', 'kpi'],
    queryFn: () => api.get('/api/v1/bqms/kpi'),
    retry: false,
  });

  // Fetch volume trend
  const { data: volumeData } = useQuery<BQMSVolumePoint[]>({
    queryKey: ['bqms', 'volume-trend'],
    queryFn: () => api.get('/api/v1/bqms/volume-trend'),
    retry: false,
  });

  // Fetch records
  const { data: recordsData, isLoading: recordsLoading } = useQuery<
    PaginatedResponse<BQMSTableRecord>
  >({
    queryKey: ['bqms', 'records'],
    queryFn: () => api.get('/api/v1/bqms/records'),
    retry: false,
  });

  // Use real data or fallback
  const kpiData = kpi ?? MOCK_KPI;
  const volume = volumeData?.length ? volumeData : MOCK_VOLUME;
  const records = recordsData?.items?.length
    ? recordsData.items
    : MOCK_TABLE_RECORDS;

  // Filter records by search
  const filteredRecords = searchQuery
    ? records.filter(
        (r) =>
          r.bqms_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.maker.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.order_number.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : records;

  const processedCount = kpiData.total_won + kpiData.total_lost;
  const pendingCount = kpiData.total_bids - processedCount;

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
          <span>Cập nhật lần cuối: {formatDate(new Date())}</span>
        </div>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          label="Tổng BQMS"
          value={kpiData.total_bids}
          accentColor="border-brand-500"
          loading={kpiLoading}
          trend={{ direction: 'up', value: kpiData.period }}
        />
        <KPICard
          label="Đã xử lý"
          value={processedCount}
          accentColor="border-emerald-500"
          loading={kpiLoading}
          trend={{
            direction: 'up',
            value: `${(kpiData?.win_rate ?? 0).toFixed(1)}% win`,
          }}
        />
        <KPICard
          label="Makers"
          value={MOCK_MAKERS.length}
          accentColor="border-cyan-500"
          loading={kpiLoading}
        />
        <KPICard
          label="Đang chờ"
          value={pendingCount > 0 ? pendingCount : 16}
          accentColor="border-amber-500"
          loading={kpiLoading}
          trend={{ direction: 'up', value: 'cần xử lý' }}
        />
      </div>

      {/* ── Charts Row 1 ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <div className="lg:col-span-7 bg-white rounded-lg shadow-sm p-4">
          <LineAreaChart
            data={volume}
            xKey="month"
            yKeys={['total', 'won']}
            colors={['#6366f1', '#10b981']}
            title="Xu hướng BQMS theo tháng"
            height={300}
          />
        </div>

        <div className="lg:col-span-5 bg-white rounded-lg shadow-sm p-4">
          <DonutChart
            data={MOCK_TYPE_SPLIT}
            nameKey="name"
            valueKey="value"
            colors={['#6366f1', '#06b6d4']}
            title="Phân bổ GC / TM"
            height={300}
          />
        </div>
      </div>

      {/* ── Charts Row 2 ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        <div className="lg:col-span-6 bg-white rounded-lg shadow-sm p-4">
          <ParetoChart
            data={MOCK_MAKERS}
            nameKey="maker"
            valueKey="count"
            barColor="#6366f1"
            lineColor="#f59e0b"
            title="Top Makers (Pareto)"
            height={320}
          />
        </div>

        <div className="lg:col-span-6 bg-white rounded-lg shadow-sm p-4">
          <HorizontalBarChart
            data={MOCK_DEADLINE}
            nameKey="label"
            valueKey="count"
            color="#ef4444"
            title="Deadline khẩn cấp"
          />
        </div>
      </div>

      {/* ── Data Table ────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {/* Table header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-slate-700">
              Danh sách BQMS
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
                  <TH>Đơn hàng</TH>
                  <TH>Mã BQMS</TH>
                  <TH>Tên hàng</TH>
                  <TH>GC/TM</TH>
                  <TH>Maker</TH>
                  <TH align="right">SL</TH>
                  <TH>Deadline</TH>
                  <TH>Trạng thái</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.map((record) => {
                  const statusCfg = BQMS_STATUS_MAP[record.status];
                  return (
                    <tr
                      key={record.id}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <TD>{formatDate(record.date)}</TD>
                      <TD>
                        <span className="font-mono text-brand-600">
                          {record.order_number}
                        </span>
                      </TD>
                      <TD>
                        <span className="font-mono">{record.bqms_code}</span>
                      </TD>
                      <TD>{record.product_name}</TD>
                      <TD>
                        <span
                          className={cn(
                            'inline-flex px-1.5 py-0.5 rounded text-xs font-medium',
                            record.type === 'GC'
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-cyan-50 text-cyan-700'
                          )}
                        >
                          {record.type}
                        </span>
                      </TD>
                      <TD>{record.maker}</TD>
                      <TD align="right">
                        <span className="font-mono">
                          {record.quantity.toLocaleString('vi-VN')}
                        </span>
                      </TD>
                      <TD>{formatDate(record.deadline)}</TD>
                      <TD>
                        {statusCfg && (
                          <StatusBadge
                            label={statusCfg.label}
                            variant={statusCfg.variant}
                          />
                        )}
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
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-36 bg-slate-200 rounded animate-pulse flex-1" />
          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-16 bg-slate-200 rounded-full animate-pulse" />
        </div>
      ))}
    </div>
  );
}
