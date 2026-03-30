'use client';

import { AreaChart, Area, ResponsiveContainer } from 'recharts';

// ─── Props ─────────────────────────────────────────────────────

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

// ─── Component ─────────────────────────────────────────────────

export function Sparkline({
  data,
  color = '#6366f1',
  width = 80,
  height = 32,
}: SparklineProps) {
  // Transform number array to recharts format
  const chartData = data.map((value, index) => ({ index, value }));

  if (!chartData.length) return null;

  // Unique ID for gradient to avoid SVG collisions
  const gradientId = `sparkline-grad-${color.replace('#', '')}`;

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
