'use client';

// Code-splitting (W3-16): recharts extracted out of page.tsx so it can be
// next/dynamic-imported with ssr:false — keeps recharts out of this route's
// first-load JS. Pure presentational: receives pre-computed chart data.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { CHART } from '@/lib/chart-colors';

interface ConsumptionChartProps {
  data: { day: string; qty: number }[];
}

export function ConsumptionChart({ data }: ConsumptionChartProps) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v: number) => [v.toLocaleString('vi-VN'), 'Xuất kho']}
          labelFormatter={(label) => `Ngày ${label}`}
        />
        <Bar dataKey="qty" fill={CHART.brand} radius={[3, 3, 0, 0]} name="Xuất kho" />
      </BarChart>
    </ResponsiveContainer>
  );
}
