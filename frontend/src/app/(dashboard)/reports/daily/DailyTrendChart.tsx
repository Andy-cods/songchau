'use client';

// Code-splitting (W3-16): recharts extracted out of page.tsx so it can be
// next/dynamic-imported with ssr:false — keeps recharts out of this route's
// first-load JS. Pure presentational: receives the trend series + a
// callback for the bar-click "chốt ngày" drill-through (must stay wired so
// clicking a bar still updates reportDate exactly as before).

import {
  ResponsiveContainer, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid,
} from 'recharts';
import { CHART } from '@/lib/chart-colors';

type TrendPoint = { bucket: string; amount: number; po_count: number; amount_ly: number };

const fmtDate = (s: string) => {
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function TrendTooltipCount({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.find((p: any) => p.dataKey === 'amount')?.value ?? 0;
  const quoted = payload[0]?.payload?.po_count ?? 0;
  return (
    <div className="bg-slate-900 text-white rounded-lg shadow-xl px-3 py-2.5 text-xs border border-slate-700 min-w-[170px]">
      <div className="font-semibold text-slate-200 mb-1.5">{fmtDate(label)}</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-brand-300">● Tổng yêu cầu</span>
          <span className="font-mono tabular-nums">{total} mã</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-emerald-300">● Đã báo giá</span>
          <span className="font-mono tabular-nums">{quoted} mã</span>
        </div>
      </div>
      <div className="mt-2 pt-1.5 border-t border-slate-700 text-[11px] text-slate-400 text-center">
        Bấm để chốt ngày này
      </div>
    </div>
  );
}

interface DailyTrendChartProps {
  trend: TrendPoint[];
  setReportDate: (bucket: string) => void;
}

export function DailyTrendChart({ trend, setReportDate }: DailyTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={trend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="trendBar" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={CHART.brand} stopOpacity={0.95} />
            <stop offset="100%" stopColor={CHART.brand} stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucket"
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={fmtDate}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#64748b' }}
          width={48}
          tickFormatter={(v) => `${v}`}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: '#f1f5f9' }}
          content={<TrendTooltipCount />}
        />
        <Bar
          dataKey="amount"
          name="Tổng yêu cầu"
          fill="url(#trendBar)"
          radius={[8, 8, 0, 0]}
          maxBarSize={40}
          cursor="pointer"
          onClick={(data: any) => {
            if (data?.bucket) setReportDate(data.bucket);
          }}
        />
        <Line
          type="monotone"
          dataKey="po_count"
          name="Đã báo giá"
          stroke={CHART.success}
          strokeWidth={2.5}
          dot={{ r: 3, fill: CHART.success, stroke: '#fff', strokeWidth: 2 }}
          activeDot={{ r: 5, fill: CHART.success, stroke: '#fff', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
