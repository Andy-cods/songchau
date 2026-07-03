'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { Trophy, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';

// Code-splitting (W3-16): recharts moved into WinLossCharts.tsx, deferred
// via dynamic() so it isn't part of this route's first-load JS.
const WinLossCharts = dynamic(
  () => import('./WinLossCharts').then((m) => m.WinLossCharts),
  { ssr: false, loading: () => <div className="grid grid-cols-2 gap-6 mb-6"><div className="h-[250px] animate-pulse rounded-lg bg-slate-100" /><div className="h-[250px] animate-pulse rounded-lg bg-slate-100" /></div> },
);

interface Overview {
  total_rfq: number;
  won_count: number;
  lost_count: number;
  pending_count: number;
  win_rate: number;
  avg_price_v1: number;
  unique_makers: number;
  unique_parts: number;
}

interface MakerData {
  maker: string;
  total: number;
  won: number;
  lost: number;
  win_rate: number;
  avg_price: number;
}

interface LossReason {
  reason: string;
  count: number;
  avg_our_price: number;
}

export default function WinLossPage() {
  const [months, setMonths] = useState(6);

  const { data: overviewData, isLoading: loadingOverview } = useQuery<{ data: Overview }>({
    queryKey: ['price-overview', months],
    queryFn: () => api.get(`/api/v1/price-analytics/overview?months=${months}`),
    retry: false,
  });

  const { data: makerData } = useQuery<{ data: MakerData[] }>({
    queryKey: ['price-by-maker', months],
    queryFn: () => api.get(`/api/v1/price-analytics/by-maker?months=${months}`),
    retry: false,
  });

  const { data: lossData } = useQuery<{ data: LossReason[] }>({
    queryKey: ['loss-reasons', months],
    queryFn: () => api.get(`/api/v1/price-analytics/loss-reasons?months=${months}`),
    retry: false,
  });

  const overview = overviewData?.data;
  const makers = makerData?.data ?? [];
  const losses = lossData?.data ?? [];

  const pieData = overview ? [
    { name: 'Thắng', value: overview.won_count },
    { name: 'Thua', value: overview.lost_count },
    { name: 'Pending', value: overview.pending_count },
  ] : [];

  const barData = makers.slice(0, 10).map((m) => ({
    name: m.maker?.length > 12 ? m.maker.slice(0, 12) + '...' : m.maker,
    'Thắng': m.won,
    'Thua': m.lost,
  }));

  return (
    <div>
      <PageHeader
        title="Phân Tích Win/Loss"
        subtitle="Tỷ lệ thắng/thua theo maker, xu hướng và lý do"
        icon={Trophy}
        className="mb-6"
        actions={
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          >
            <option value={3}>3 tháng</option>
            <option value={6}>6 tháng</option>
            <option value={12}>12 tháng</option>
            <option value={24}>24 tháng</option>
          </select>
        }
      />

      {loadingOverview ? (
        <div className="p-8 text-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
      ) : overview && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Tổng RFQ</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{(overview.total_rfq ?? 0).toLocaleString()}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg shadow-sm border border-emerald-200 p-4">
              <p className="text-xs text-emerald-600 uppercase tracking-wider">Tỷ lệ thắng</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{overview.win_rate || 0}%</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Makers</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{overview.unique_makers}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Giá TB (V1)</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{(overview.avg_price_v1 ?? 0).toLocaleString('vi-VN')}</p>
            </div>
          </div>

          {/* Charts Row */}
          <WinLossCharts pieData={pieData} barData={barData} />

          {/* Loss Reasons Table */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">Lý Do Thua Thầu</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lý do</TableHead>
                  <TableHead className="text-right">Số lần</TableHead>
                  <TableHead className="text-right">Giá TB của ta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {losses.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm text-slate-700">{l.reason}</TableCell>
                    <TableCell className="text-sm text-right font-medium text-red-600">{l.count}</TableCell>
                    <TableCell className="text-sm text-right text-slate-600">{(l.avg_our_price ?? 0).toLocaleString('vi-VN')} ₫</TableCell>
                  </TableRow>
                ))}
                {losses.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="px-4 py-8 text-center text-slate-400">Không có dữ liệu</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
