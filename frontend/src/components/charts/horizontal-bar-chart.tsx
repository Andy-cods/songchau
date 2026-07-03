'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  LabelList,
} from 'recharts';

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
      <p style={{ margin: 0, fontWeight: 600 }}>{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ margin: 0, color: entry.color }}>
          {typeof entry.value === 'number' ? entry.value.toLocaleString('vi-VN') : entry.value}
        </p>
      ))}
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────

interface HorizontalBarChartProps {
  data: any[];
  nameKey: string;
  valueKey: string;
  color?: string;
  title?: string;
  className?: string;
}

// ─── Component ─────────────────────────────────────────────────

export function HorizontalBarChart({
  data,
  nameKey,
  valueKey,
  color = '#6366f1',
  title,
  className,
}: HorizontalBarChartProps) {
  if (!data.length) {
    return (
      <div className={className}>
        {title && (
          <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
        )}
        <div className="flex items-center justify-center text-slate-500 text-sm h-[360px]">
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
      <ResponsiveContainer width="100%" height={360}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 10, right: 30, bottom: 10, left: 10 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            horizontal={false}
            stroke="#e2e8f0"
          />

          <XAxis
            type="number"
            tick={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              fill: '#94a3b8',
            }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
            tickFormatter={(v: number) => v.toLocaleString('vi-VN')}
          />

          <YAxis
            type="category"
            dataKey={nameKey}
            tick={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              fill: '#94a3b8',
            }}
            axisLine={false}
            tickLine={false}
            width={100}
          />

          <Tooltip content={<ChartTooltip />} />

          <Bar
            dataKey={valueKey}
            radius={[0, 4, 4, 0]}
            maxBarSize={28}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={color} />
            ))}
            <LabelList
              dataKey={valueKey}
              position="insideRight"
              style={{
                fill: '#ffffff',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                fontWeight: 600,
              }}
              formatter={(v: number) => v.toLocaleString('vi-VN')}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
