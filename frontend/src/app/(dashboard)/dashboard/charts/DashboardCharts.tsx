'use client';

// Code-splitting (W3-16): recharts extracted out of page.tsx so each chart
// can be next/dynamic-imported with ssr:false — keeps the ~100KB+ recharts
// chunk out of /dashboard's first-load JS. Pure presentational: every
// exported component receives pre-computed chart data as props, no
// data-fetching here.

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { CHART, CATEGORICAL } from '@/lib/chart-colors';

// Duplicated from page.tsx (COLORS/fmtVnd/fmtNum/ChartTooltip are also used
// there for non-chart KPI/funnel/delivery UI) — small duplication is
// acceptable here to avoid prop-plumbing formatter functions and a color map.
const COLORS = {
  violet: CHART.brand,
  emerald: CHART.success,
  amber: CHART.warning,
  donut: [...CATEGORICAL],
};

function fmtVnd(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtNum(n: number): string {
  return n.toLocaleString('vi-VN');
}

/** Tooltip for Recharts — dark glass morphism style */
function ChartTooltip({ active, payload, label, valueFormatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white rounded-lg px-3.5 py-2.5 shadow-xl text-xs border border-slate-700/50">
      <p className="font-medium text-slate-400 mb-1.5 text-[11px]">{label}</p>
      <div className="space-y-1">
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-slate-300">{entry.name}</span>
            <span className="font-mono font-semibold ml-auto pl-3">
              {valueFormatter ? valueFormatter(entry.value) : fmtNum(entry.value ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 1. Monthly revenue (quoted vs won) — bar chart ────────────────────

interface RevenueDatum {
  name: string;
  quoted: number;
  won: number;
  rfq: number;
}

export function RevenueChart({ data }: { data: RevenueDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} barCategoryGap="25%" barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          axisLine={false} tickLine={false}
        />
        <YAxis
          tickFormatter={fmtVnd}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          axisLine={false} tickLine={false}
          width={50}
        />
        <Tooltip content={<ChartTooltip valueFormatter={fmtVnd} />} />
        <Bar dataKey="quoted" name="Báo giá" fill={COLORS.violet} radius={[4,4,0,0]} />
        <Bar dataKey="won" name="Chốt được" fill={COLORS.emerald} radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── 2. YoY comparison — area + dashed line ────────────────────────────

interface YoyDatum {
  name: string;
  thisYear: number;
  lastYear: number;
}

export function YoyChart({ data, currentYear }: { data: YoyDatum[]; currentYear: number }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="grad-this-year" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.violet} stopOpacity={0.12} />
            <stop offset="100%" stopColor={COLORS.violet} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          axisLine={false} tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          axisLine={false} tickLine={false}
          width={40}
        />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="thisYear"
          name={`${currentYear}`}
          stroke={COLORS.violet}
          strokeWidth={2.5}
          fill="url(#grad-this-year)"
          dot={{ r: 3, fill: COLORS.violet, strokeWidth: 0 }}
          activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
        />
        <Line
          type="monotone"
          dataKey="lastYear"
          name={`${currentYear - 1}`}
          stroke="#cbd5e1"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={{ r: 3, fill: '#cbd5e1', strokeWidth: 0 }}
          activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── 3. Maker distribution — donut chart ───────────────────────────────

interface MakerDonutDatum {
  name: string;
  value: number;
  won: number;
  rate: number;
}

export function MakersDonutChart({ data }: { data: MakerDonutDatum[] }) {
  return (
    <ResponsiveContainer width={200} height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%" cy="50%"
          innerRadius={60} outerRadius={88}
          paddingAngle={2}
          dataKey="value"
          strokeWidth={0}
        >
          {data.map((_: any, i: number) => (
            <Cell key={i} fill={COLORS.donut[i % COLORS.donut.length]} />
          ))}
        </Pie>
        <Tooltip
          content={({ active, payload }: any) => {
            if (!active || !payload?.[0]) return null;
            const item = payload[0].payload;
            return (
              <div className="bg-slate-900 text-white rounded-lg px-3.5 py-2.5 shadow-xl text-xs border border-slate-700/50">
                <p className="font-semibold mb-1">{item.name}</p>
                <p className="text-slate-400">{fmtNum(item.value)} RFQ &middot; Win: {item.rate?.toFixed(1)}%</p>
              </div>
            );
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ─── 4. Win-rate trend — area chart w/ reference line ──────────────────

interface WinRateDatum {
  name: string;
  rate: number;
  won: number;
  lost: number;
}

export function WinRateChart({ data, avgWinRate }: { data: WinRateDatum[]; avgWinRate: number }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="grad-winrate" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.emerald} stopOpacity={0.15} />
            <stop offset="100%" stopColor={COLORS.emerald} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          axisLine={false} tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          axisLine={false} tickLine={false}
          width={40}
        />
        <Tooltip content={<ChartTooltip valueFormatter={(v: number) => `${v.toFixed(1)}%`} />} />
        {avgWinRate > 0 && (
          <ReferenceLine
            y={avgWinRate}
            stroke={COLORS.amber}
            strokeDasharray="4 3"
            strokeWidth={1.5}
          />
        )}
        <Area
          type="monotone"
          dataKey="rate"
          name="Tỷ lệ thắng"
          stroke={COLORS.emerald}
          strokeWidth={2.5}
          fill="url(#grad-winrate)"
          dot={{ r: 3, fill: COLORS.emerald, strokeWidth: 0 }}
          activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
