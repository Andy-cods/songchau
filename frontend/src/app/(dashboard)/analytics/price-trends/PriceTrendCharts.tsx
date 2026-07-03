'use client';

// Code-splitting (W3-16): recharts extracted out of page.tsx so each chart
// can be next/dynamic-imported with ssr:false — keeps recharts out of this
// route's first-load JS. Pure presentational: receives pre-computed chart
// data + the small set of display flags each chart needs.
//
// IMPORTANT: page.tsx keeps the surrounding `<div ref={xxxRef}>` (used by
// <ExportButton chartRef={...}> to screenshot the panel) — only the
// innermost <ResponsiveContainer> markup was moved here, so export capture
// still works unchanged (it mounts into that same ref'd DOM node).

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART } from '@/lib/chart-colors';

// Duplicated from page.tsx (also used there for legends/KPI text outside
// the charts) — small duplication is acceptable to avoid prop-plumbing a
// formatter fn and color arrays through every chart.
const SERIES_COLORS = [
  CHART.brand,
  CHART.info,
  CHART.success,
  CHART.warning,
  CHART.danger,
  CHART.neutral,
];
const MARKET_DASH = CHART.neutral;

function fmtMoneyShort(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} tỷ ₫`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M ₫`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K ₫`;
  return `${v.toLocaleString('vi-VN')} ₫`;
}

type PriceRole = 'quote_v1' | 'market_xnk' | 'cost_ncc' | 'sale_sourcing' | 'imv_buy';
const ROLE_META: Record<PriceRole, { label: string; color: string }> = {
  quote_v1: { label: 'Mình chào (V1)', color: CHART.brand },
  market_xnk: { label: 'Thị trường (XNK)', color: CHART.info },
  cost_ncc: { label: 'Giá vốn (NCC)', color: CHART.success },
  sale_sourcing: { label: 'Giá bán (Nguồn cung)', color: CHART.warning },
  imv_buy: { label: 'IMV mua', color: CHART.danger },
};

// Matches page.tsx's own MultiSeriesPoint shape exactly (month_key +
// index signature covers month_label/codes/__market as string|number|null)
// so the arrays computed in page.tsx are directly assignable here.
interface MultiSeriesPoint {
  month_key: string;
  [code: string]: number | string | null;
}

// ─── 1. Multi-code comparison (index 100 or absolute) ──────────────────

interface MultiSeriesLineChartProps {
  data: MultiSeriesPoint[];
  indexMode: boolean;
  selectedCodes: string[];
}

export function MultiSeriesLineChart({ data, indexMode, selectedCodes }: MultiSeriesLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month_label" tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={(v) =>
            indexMode ? `${Number(v).toFixed(0)}` : fmtMoneyShort(Number(v))
          }
          width={56}
        />
        {indexMode && <ReferenceLine y={100} stroke="#cbd5e1" strokeDasharray="2 4" />}
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#cbd5e1' }}
          formatter={(value: unknown, name: string) => {
            const num = typeof value === 'number' ? value : Number(value);
            if (name === '__market') {
              return [
                indexMode ? num.toFixed(1) : fmtMoneyShort(num),
                'TT XNK (trung vị)',
              ];
            }
            return [indexMode ? num.toFixed(1) : fmtMoneyShort(num), name];
          }}
        />
        {selectedCodes.map((code, idx) => (
          <Line
            key={code}
            type="monotone"
            dataKey={code}
            stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 2.5 }}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
        <Line
          type="monotone"
          dataKey="__market"
          stroke={MARKET_DASH}
          strokeWidth={1.5}
          strokeDasharray="5 4"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── 2. Price by role (quote_v1 / market_xnk / cost_ncc / ...) ─────────

interface RoleLineChartProps {
  data: MultiSeriesPoint[];
  activeRoles: PriceRole[];
}

export function RoleLineChart({ data, activeRoles }: RoleLineChartProps) {
  const roleKeys: PriceRole[] = ['quote_v1', 'market_xnk', 'cost_ncc', 'sale_sourcing', 'imv_buy'];
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month_label" tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={(v) => fmtMoneyShort(Number(v))}
          width={56}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#cbd5e1' }}
          formatter={(value: unknown, name: string) => [
            fmtMoneyShort(Number(value)),
            ROLE_META[name as PriceRole]?.label ?? name,
          ]}
        />
        {roleKeys.filter((r) => activeRoles.includes(r)).map((role) => (
          <Line
            key={role}
            type="monotone"
            dataKey={role}
            name={role}
            stroke={ROLE_META[role].color}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── 3. Customer split ──────────────────────────────────────────────────

interface CustomerLineChartProps {
  data: MultiSeriesPoint[];
  customers: string[];
}

export function CustomerLineChart({ data, customers }: CustomerLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month_label" tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={(v) => fmtMoneyShort(Number(v))}
          width={56}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#cbd5e1' }}
          formatter={(value: unknown, name: string) => [
            fmtMoneyShort(Number(value)),
            name,
          ]}
        />
        {customers.slice(0, 6).map((cust, idx) => (
          <Line
            key={cust}
            type="monotone"
            dataKey={cust}
            stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── 4. Supplier compare ────────────────────────────────────────────────

interface SupplierLineChartProps {
  data: MultiSeriesPoint[];
  suppliers: string[];
}

export function SupplierLineChart({ data, suppliers }: SupplierLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month_label" tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={(v) => fmtMoneyShort(Number(v))}
          width={56}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#cbd5e1' }}
          formatter={(value: unknown, name: string) => [
            fmtMoneyShort(Number(value)),
            name,
          ]}
        />
        {suppliers.slice(0, 6).map((sup, idx) => (
          <Line
            key={sup}
            type="monotone"
            dataKey={sup}
            stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
