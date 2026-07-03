'use client';

// Code-splitting (W3-16): recharts extracted out of page.tsx so it can be
// next/dynamic-imported with ssr:false — keeps recharts out of this route's
// first-load JS. Pure presentational: receives pre-computed monthly rows.

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { CHART } from '@/lib/chart-colors';

interface MonthlyRow {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
  margin_pct: number;
}

/**
 * Finding #13: hoist Recharts hex values into named tokens so palette
 * audits don't need to grep the JSX. Data series pull from the shared
 * chart-colors token set; axis/grid/tooltip stay neutral slate chrome.
 *   - revenue → CHART.brand (series chính / nhấn)
 *   - cost    → CHART.neutral (slate — không cạnh tranh với brand)
 *   - margin  → CHART.info (đường biên LN, thông tin phụ)
 */
const CHART_TOKENS = {
  revenue: CHART.brand,
  cost: CHART.neutral,
  margin: CHART.info,
  axisText: '#64748b',
  axisLine: '#e2e8f0',
  gridLine: '#e2e8f0',
  tooltipText: '#475569',
  tooltipBg: '#ffffff',
} as const;

// Duplicated from page.tsx (also used there for KPI cards / table cells) —
// small duplication is acceptable to avoid prop-plumbing a formatter fn.
function fmtVnd(value: number): string {
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + '₫';
}

function fmtChartVnd(value: number): string {
  return fmtVnd(value);
}

interface MonthlyComparisonChartProps {
  monthly: MonthlyRow[];
}

export function MonthlyComparisonChart({ monthly }: MonthlyComparisonChartProps) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={monthly} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid stroke={CHART_TOKENS.gridLine} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: CHART_TOKENS.axisText }}
          axisLine={{ stroke: CHART_TOKENS.axisLine }}
          tickLine={{ stroke: CHART_TOKENS.axisLine }}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={fmtChartVnd}
          tick={{ fontSize: 11, fill: CHART_TOKENS.axisText }}
          axisLine={{ stroke: CHART_TOKENS.axisLine }}
          tickLine={{ stroke: CHART_TOKENS.axisLine }}
          width={70}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: CHART_TOKENS.axisText }}
          axisLine={{ stroke: CHART_TOKENS.axisLine }}
          tickLine={{ stroke: CHART_TOKENS.axisLine }}
          width={40}
        />
        <Tooltip
          wrapperClassName="!rounded-lg !border-slate-200 !shadow-md"
          contentStyle={{
            backgroundColor: CHART_TOKENS.tooltipBg,
            border: `1px solid ${CHART_TOKENS.axisLine}`,
            borderRadius: 8,
            fontSize: 12,
            color: CHART_TOKENS.tooltipText,
          }}
          formatter={(value: number, name: string) =>
            name === 'Biên LN %'
              ? `${Number(value ?? 0).toFixed(1)}%`
              : fmtVnd(value)
          }
        />
        <Legend wrapperStyle={{ fontSize: 12, color: CHART_TOKENS.tooltipText }} />
        <Bar
          yAxisId="left"
          dataKey="revenue"
          name="Doanh thu"
          fill={CHART_TOKENS.revenue}
          radius={[3, 3, 0, 0]}
        />
        <Bar
          yAxisId="left"
          dataKey="cost"
          name="Chi phí"
          fill={CHART_TOKENS.cost}
          radius={[3, 3, 0, 0]}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="margin_pct"
          name="Biên LN %"
          stroke={CHART_TOKENS.margin}
          strokeWidth={2}
          dot={{ r: 3, fill: CHART_TOKENS.margin }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
