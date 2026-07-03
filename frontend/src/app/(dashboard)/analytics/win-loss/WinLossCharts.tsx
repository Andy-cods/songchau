'use client';

// Code-splitting (W3-16): recharts extracted out of page.tsx so it can be
// next/dynamic-imported with ssr:false — keeps the ~100KB+ recharts chunk
// out of this route's first-load JS. Pure presentational: receives
// pre-computed chart data as props, no data-fetching here.

import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { CHART, WIN_LOSS_COLORS } from '@/lib/chart-colors';

// Win/Loss/Pending → success / danger / neutral (shared token).
const COLORS = WIN_LOSS_COLORS;

interface PieDatum {
  name: string;
  value: number;
}

interface BarDatum {
  name: string;
  'Thắng': number;
  'Thua': number;
}

interface WinLossChartsProps {
  pieData: PieDatum[];
  barData: BarDatum[];
}

export function WinLossCharts({ pieData, barData }: WinLossChartsProps) {
  return (
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
            <Bar dataKey="Thắng" fill={CHART.success} />
            <Bar dataKey="Thua" fill={CHART.danger} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
