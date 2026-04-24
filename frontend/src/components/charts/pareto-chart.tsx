'use client';

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';

// ─── Custom Tooltip ────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: 8,
        padding: '8px 12px',
        color: '#f1f5f9',
        fontSize: 12,
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      <p style={{ margin: 0, marginBottom: 4, fontWeight: 600 }}>{label}</p>
      {payload.map((entry, i) => {
        const raw = Number(entry.value);
        const safe = Number.isFinite(raw) ? raw : 0;
        return (
          <p key={i} style={{ margin: 0, color: entry.color }}>
            {entry.name}:{' '}
            {entry.dataKey === 'cumPercent'
              ? `${safe.toFixed(1)}%`
              : safe.toLocaleString('vi-VN')}
          </p>
        );
      })}
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────

interface ParetoChartProps {
  data: any[];
  nameKey: string;
  valueKey: string;
  barColor?: string;
  lineColor?: string;
  title?: string;
  height?: number;
  className?: string;
}

// ─── Component ─────────────────────────────────────────────────

export function ParetoChart({
  data,
  nameKey,
  valueKey,
  barColor = '#6366f1',
  lineColor = '#f59e0b',
  title,
  height = 320,
  className,
}: ParetoChartProps) {
  // Sort descending by value and compute cumulative %
  const sorted = [...data].sort(
    (a, b) => (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0)
  );

  const total = sorted.reduce((sum, item) => sum + (Number(item[valueKey]) || 0), 0);

  let cumulative = 0;
  const chartData = sorted.map((item) => {
    const val = Number(item[valueKey]) || 0;
    cumulative += val;
    return {
      ...item,
      [valueKey]: val,
      cumPercent: total > 0 ? (cumulative / total) * 100 : 0,
    };
  });

  if (!data.length) {
    return (
      <div className={className}>
        {title && (
          <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
        )}
        <div
          className="flex items-center justify-center text-slate-400 text-sm"
          style={{ height }}
        >
          Chưa có dữ liệu
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {title && (
        <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={chartData}
          margin={{ top: 10, right: 20, bottom: 20, left: 10 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="#e2e8f0"
          />

          <XAxis
            dataKey={nameKey}
            tick={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              fill: '#94a3b8',
            }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
          />

          {/* Left Y-axis: count */}
          <YAxis
            yAxisId="left"
            tick={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              fill: '#94a3b8',
            }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => v.toLocaleString('vi-VN')}
          />

          {/* Right Y-axis: cumulative % */}
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tick={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              fill: '#94a3b8',
            }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />

          <Tooltip content={<ChartTooltip />} />

          {/* 80% reference line */}
          <ReferenceLine
            yAxisId="right"
            y={80}
            stroke="#ef4444"
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{
              value: '80%',
              position: 'right',
              style: {
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                fill: '#ef4444',
              },
            }}
          />

          <Bar
            yAxisId="left"
            dataKey={valueKey}
            name="Số lượng"
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={barColor} />
            ))}
          </Bar>

          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumPercent"
            name="Tích lũy %"
            stroke={lineColor}
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={{ r: 3, fill: lineColor }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
