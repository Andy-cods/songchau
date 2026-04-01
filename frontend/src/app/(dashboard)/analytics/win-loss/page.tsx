'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Trophy, Loader2 } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

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

const COLORS = ['#10b981', '#ef4444', '#94a3b8'];

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            <Trophy className="h-5 w-5 inline mr-2 text-amber-500" />
            Phân Tích Win/Loss
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Tỷ lệ thắng/thua theo maker, xu hướng và lý do</p>
        </div>
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
      </div>

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
            <div className="bg-green-50 rounded-lg shadow-sm border border-green-200 p-4">
              <p className="text-xs text-green-600 uppercase tracking-wider">Tỷ lệ thắng</p>
              <p className="text-2xl font-bold text-green-700 mt-1">{overview.win_rate || 0}%</p>
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
          <div className="grid grid-cols-2 gap-6 mb-6">
            {/* Pie Chart */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Tỷ lệ Win/Loss</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Bar Chart */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Top 10 Maker — Win vs Loss</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={barData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Thắng" fill="#10b981" />
                  <Bar dataKey="Thua" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Loss Reasons Table */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">Lý Do Thua Thầu</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Lý do</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số lần</th>
                    <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Giá TB của ta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {losses.map((l, i) => (
                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-slate-700">{l.reason}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-red-600">{l.count}</td>
                      <td className="px-4 py-3 text-sm text-right text-slate-600">{(l.avg_our_price ?? 0).toLocaleString('vi-VN')} ₫</td>
                    </tr>
                  ))}
                  {losses.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">Không có dữ liệu</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
