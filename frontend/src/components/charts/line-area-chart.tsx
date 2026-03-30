'use client';

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// ─── Chart color palette ───────────────────────────────────────
const DEFAULT_COLORS = [
  '#6366f1',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#f97316',
  '#64748b',
];

// ─── Custom Tooltip ────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
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
      {payload.map((entry, i) => (
        <p key={i} style={{ margin: 0, color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString('vi-VN') : entry.value}
        </p>
      ))}
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────

interface LineAreaChartProps {
  data: any[];
  xKey: string;
  yKeys: string[];
  colors?: string[];
  title?: string;
  height?: number;
  className?: string;
}

// ─── Component ─────────────────────────────────────────────────

export function LineAreaChart({
  data,
  xKey,
  yKeys,
  colors = DEFAULT_COLORS,
  title,
  height = 320,
  className,
}: LineAreaChartProps) {
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
          data={data}
          margin={{ top: 10, right: 20, bottom: 20, left: 10 }}
        >
          <defs>
            {yKeys.map((key, i) => (
              <linearGradient
                key={key}
                id={`gradient-${key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={colors[i % colors.length]}
                  stopOpacity={0.2}
                />
                <stop
                  offset="95%"
                  stopColor={colors[i % colors.length]}
                  stopOpacity={0}
                />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="#e2e8f0"
          />

          <XAxis
            dataKey={xKey}
            tick={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              fill: '#94a3b8',
            }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
          />

          <YAxis
            tick={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              fill: '#94a3b8',
            }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => v.toLocaleString('vi-VN')}
          />

          <Tooltip content={<ChartTooltip />} />

          {yKeys.length > 1 && (
            <Legend
              wrapperStyle={{
                fontSize: 12,
                fontFamily: 'JetBrains Mono, monospace',
              }}
            />
          )}

          {yKeys.map((key, i) => (
            <Area
              key={`area-${key}`}
              type="monotone"
              dataKey={key}
              fill={`url(#gradient-${key})`}
              stroke="none"
            />
          ))}

          {yKeys.map((key, i) => (
            <Line
              key={`line-${key}`}
              type="monotone"
              dataKey={key}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              dot={{ r: 3, fill: colors[i % colors.length] }}
              activeDot={{ r: 5 }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
