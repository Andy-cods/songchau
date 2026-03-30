'use client';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  Label,
  ResponsiveContainer,
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
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { fill: string } }>;
}) {
  if (!active || !payload?.length) return null;

  const entry = payload[0];

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
      <p style={{ margin: 0, color: entry.payload.fill, fontWeight: 600 }}>
        {entry.name}: {entry.value.toLocaleString('vi-VN')}
      </p>
    </div>
  );
}

// ─── Custom center label content ──────────────────────────────

function CenterLabelContent({
  viewBox,
  total,
}: {
  viewBox?: { cx?: number; cy?: number };
  total: number;
}) {
  if (!viewBox?.cx || !viewBox?.cy) return null;
  const { cx, cy } = viewBox;

  return (
    <g>
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 20,
          fontWeight: 700,
          fill: '#1e293b',
        }}
      >
        {total.toLocaleString('vi-VN')}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
          fill: '#94a3b8',
        }}
      >
        Tổng cộng
      </text>
    </g>
  );
}

// ─── Props ─────────────────────────────────────────────────────

interface DonutChartProps {
  data: any[];
  nameKey: string;
  valueKey: string;
  colors?: string[];
  title?: string;
  height?: number;
  className?: string;
}

// ─── Component ─────────────────────────────────────────────────

export function DonutChart({
  data,
  nameKey,
  valueKey,
  colors = DEFAULT_COLORS,
  title,
  height = 320,
  className,
}: DonutChartProps) {
  const total = data.reduce((sum, item) => {
    const val = Number(item[valueKey]) || 0;
    return sum + val;
  }, 0);

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
        <PieChart>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={nameKey}
            cx="50%"
            cy="45%"
            innerRadius="60%"
            outerRadius="80%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={colors[index % colors.length]}
              />
            ))}
            <Label
              content={<CenterLabelContent total={total} />}
              position="center"
            />
          </Pie>

          <Tooltip content={<ChartTooltip />} />

          <Legend
            verticalAlign="bottom"
            height={36}
            wrapperStyle={{
              fontSize: 12,
              fontFamily: 'JetBrains Mono, monospace',
            }}
            formatter={(value: string) => (
              <span style={{ color: '#64748b' }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
