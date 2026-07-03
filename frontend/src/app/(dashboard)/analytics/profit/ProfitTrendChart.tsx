'use client';

// Code-splitting (W3-16): recharts extracted out of page.tsx so it can be
// next/dynamic-imported with ssr:false — keeps recharts out of this route's
// first-load JS. Pure presentational: receives pre-computed period rows.

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { CHART } from '@/lib/chart-colors';

interface PeriodRow {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
  margin_pct: number;
}

// Duplicated from page.tsx (also used there for table cells) — small
// duplication is acceptable here to avoid prop-plumbing a formatter fn.
function fmtVnd(value: number): string {
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + ' ₫';
}

interface ProfitTrendChartProps {
  periods: PeriodRow[];
}

export function ProfitTrendChart({ periods }: ProfitTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={periods}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}tr`}
        />
        <Tooltip
          formatter={(v: number, name: string) => [fmtVnd(v), name]}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke={CHART.brand}
          strokeWidth={2}
          name="Doanh thu"
          dot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="cost"
          stroke={CHART.danger}
          strokeWidth={2}
          name="Chi phí"
          dot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="profit"
          stroke={CHART.success}
          strokeWidth={2}
          name="Lợi nhuận"
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
