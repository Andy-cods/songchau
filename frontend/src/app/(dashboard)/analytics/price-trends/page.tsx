'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { TrendingUp, Search, Filter, Loader2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface PriceTrendItem {
  bqms_code: string;
  specification: string;
  maker: string;
  quoted_price_bqms_v1: number | null;
  quoted_price_bqms_v2: number | null;
  quoted_price_bqms_v3: number | null;
  quoted_price_bqms_v4: number | null;
  result: string;
  created_at: string;
}

export default function PriceTrendsPage() {
  const [maker, setMaker] = useState('');
  const [bqmsCode, setBqmsCode] = useState('');
  const [months, setMonths] = useState(12);

  const { data, isLoading } = useQuery<{ data: PriceTrendItem[] }>({
    queryKey: ['price-trends', maker, bqmsCode, months],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('months', String(months));
      if (maker) params.set('maker', maker);
      if (bqmsCode) params.set('bqms_code', bqmsCode);
      return api.get(`/api/v1/price-analytics/price-trends?${params}`);
    },
    retry: false,
  });

  const items = data?.data ?? [];

  // Transform data for chart: group by month
  const chartData = (() => {
    const byMonth: Record<string, { month: string; v1: number; v2: number; v3: number; v4: number; count: number }> = {};
    items.forEach((item) => {
      const month = new Date(item.created_at).toLocaleDateString('vi-VN', { month: 'short', year: 'numeric' });
      if (!byMonth[month]) byMonth[month] = { month, v1: 0, v2: 0, v3: 0, v4: 0, count: 0 };
      const m = byMonth[month];
      if (item.quoted_price_bqms_v1) { m.v1 += item.quoted_price_bqms_v1; m.count++; }
      if (item.quoted_price_bqms_v2) m.v2 += item.quoted_price_bqms_v2;
      if (item.quoted_price_bqms_v3) m.v3 += item.quoted_price_bqms_v3;
      if (item.quoted_price_bqms_v4) m.v4 += item.quoted_price_bqms_v4;
    });
    return Object.values(byMonth).map((m) => ({
      month: m.month,
      'V1': m.count ? Math.round(m.v1 / m.count) : 0,
      'V2': m.count ? Math.round(m.v2 / m.count) : 0,
      'V3': m.count ? Math.round(m.v3 / m.count) : 0,
      'V4': m.count ? Math.round(m.v4 / m.count) : 0,
    }));
  })();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            <TrendingUp className="h-5 w-5 inline mr-2 text-brand-600" />
            Xu Hướng Giá
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Biến động giá v1→v4 theo thời gian và nhà sản xuất</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm theo BQMS code..."
              value={bqmsCode}
              onChange={(e) => setBqmsCode(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>
          <div className="flex-1 relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Lọc theo Maker..."
              value={maker}
              onChange={(e) => setMaker(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm"
            />
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
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Giá trung bình theo tháng (VND)</h3>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400">Không có dữ liệu</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: number) => v.toLocaleString('vi-VN') + ' ₫'} />
              <Legend />
              <Line type="monotone" dataKey="V1" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="V2" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="V3" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="V4" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">BQMS</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Spec</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Maker</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">V1</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">V2</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">V3</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">V4</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Kết quả</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Ngày</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.slice(0, 50).map((item, i) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-slate-600">{item.bqms_code}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-[150px] truncate">{item.specification}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{item.maker}</td>
                  <td className="px-4 py-3 text-sm text-right text-slate-700">{(item.quoted_price_bqms_v1 ?? 0).toLocaleString('vi-VN') || '—'}</td>
                  <td className="px-4 py-3 text-sm text-right text-slate-700">{(item.quoted_price_bqms_v2 ?? 0).toLocaleString('vi-VN') || '—'}</td>
                  <td className="px-4 py-3 text-sm text-right text-slate-700">{(item.quoted_price_bqms_v3 ?? 0).toLocaleString('vi-VN') || '—'}</td>
                  <td className="px-4 py-3 text-sm text-right text-slate-700">{(item.quoted_price_bqms_v4 ?? 0).toLocaleString('vi-VN') || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      item.result?.toLowerCase().includes('won') ? 'bg-green-100 text-green-700'
                      : item.result?.toLowerCase().includes('los') ? 'bg-red-100 text-red-700'
                      : 'bg-slate-100 text-slate-500'
                    }`}>{item.result || 'Pending'}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">{new Date(item.created_at).toLocaleDateString('vi-VN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length > 50 && (
          <div className="px-4 py-3 border-t border-slate-100 text-sm text-slate-500 text-center">
            Hiển thị 50/{items.length} kết quả
          </div>
        )}
      </div>
    </div>
  );
}
