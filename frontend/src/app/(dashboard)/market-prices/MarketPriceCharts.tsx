'use client';

// Code-splitting (W3-16): recharts extracted out of page.tsx so each chart
// can be next/dynamic-imported with ssr:false — keeps recharts out of this
// route's first-load JS. Pure presentational: receives pre-computed data.

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Duplicated from page.tsx (also used there for non-chart KPI text) — small
// duplication is acceptable to avoid prop-plumbing formatter functions.
function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: digits });
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function compactUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return fmtUsd(n);
}

// ─── 1. Dashboard trend sparkline area (import volume by period) ──────

interface TrendPoint {
  period_label: string;
  count: number;
}

export function TrendSparkArea({ points, year }: { points: TrendPoint[]; year: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={`xnkDashboardTrend${year}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0f4c81" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#0f4c81" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period_label" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} width={34} />
        <Tooltip
          formatter={(value: number, key: string) => key === 'count' ? fmtNum(value, 0) : compactUsd(value)}
          labelFormatter={(label) => `Kỳ: ${label}`}
          contentStyle={{ borderRadius: 16, borderColor: '#dbe3f0' }}
        />
        <Area type="monotone" dataKey="count" stroke="#0f4c81" fill={`url(#xnkDashboardTrend${year})`} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── 2. Selected-code price history area ───────────────────────────────

interface HistoryPoint {
  date: string;
  price_usd: number;
}

export function MarketAreaChart({ data }: { data: HistoryPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs><linearGradient id="marketHistory" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#0f4c81" stopOpacity={0.28} /><stop offset="100%" stopColor="#0f4c81" stopOpacity={0.02} /></linearGradient></defs>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(value: number) => fmtUsd(value)} labelFormatter={(label) => `Ngày: ${label}`} contentStyle={{ borderRadius: 16, borderColor: '#dbe3f0' }} />
        <Area type="monotone" dataKey="price_usd" stroke="#0f4c81" fill="url(#marketHistory)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
