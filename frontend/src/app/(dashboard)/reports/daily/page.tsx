'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import {
  ResponsiveContainer, BarChart, Bar, Line, LineChart, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend, ComposedChart,
} from 'recharts';
import { Copy, Check, Calendar, TrendingUp, TrendingDown, Package, Truck } from 'lucide-react';

type MorningReport = {
  report_date: string;
  requests: { total: number; tm: number; gc: number; unclassified: number };
  quoted_today: {
    total: number;
    breakdown: Array<{
      round: number;
      rfq_inquiry_date: string | null;
      label: string;
      total: number;
      tm: number;
      gc: number;
      type_tag?: string;
    }>;
  };
  text_version: string;
};

type RevenueSummary = {
  report_date: string;
  cutoff: string;
  currency: string;
  po_revenue: {
    today: { amount: number; count: number };
    week: { amount: number; count: number };
    month: { amount: number; count: number };
    yoy_same_day: { amount: number; count: number };
    yoy_mtd: { amount: number; count: number };
    delta_yoy_today_pct: number | null;
    delta_yoy_mtd_pct: number | null;
  };
  delivery_revenue: {
    week: { amount_vnd: number; count: number };
    month: { amount_vnd: number; count: number };
  };
};

type TrendPoint = { bucket: string; amount: number; po_count: number; amount_ly: number };

const fmtUSD = (v: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0);

const fmtVND = (v: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(v || 0);

const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

export default function DailyReportPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [reportDate, setReportDate] = useState(today);
  const [morning, setMorning] = useState<MorningReport | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [trendPeriod, setTrendPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<MorningReport>(`/api/v1/daily-report/morning?report_date=${reportDate}`),
      api.get<RevenueSummary>(`/api/v1/daily-report/revenue?report_date=${reportDate}`),
      api.get<{ series: TrendPoint[] }>(`/api/v1/daily-report/trend?period=${trendPeriod}&n=${trendPeriod === 'day' ? 30 : trendPeriod === 'week' ? 12 : 13}`),
    ])
      .then(([m, r, t]) => {
        setMorning(m);
        setRevenue(r);
        setTrend(t.series || []);
      })
      .catch((err) => console.error('daily-report load failed', err))
      .finally(() => setLoading(false));
  }, [reportDate, trendPeriod]);

  const handleCopy = async () => {
    if (!morning?.text_version) return;
    try {
      await navigator.clipboard.writeText(morning.text_version);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const weekDelta = useMemo(() => {
    if (!revenue) return null;
    // naive: vs yoy_mtd as proxy; real WoW would need another endpoint
    return null;
  }, [revenue]);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Báo cáo doanh thu hàng ngày</h1>
          <p className="text-sm text-slate-500 mt-1">
            Tổng hợp RFQ, báo giá, doanh thu theo ngày. Cutoff: {revenue?.cutoff ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            value={reportDate}
            max={today}
            onChange={(e) => setReportDate(e.target.value)}
          />
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiTile
          label="Hôm nay"
          value={fmtUSD(revenue?.po_revenue.today.amount || 0)}
          badge={`${revenue?.po_revenue.today.count || 0} PO`}
          delta={revenue?.po_revenue.delta_yoy_today_pct}
          deltaLabel="vs cùng ngày năm ngoái"
          loading={loading}
        />
        <KpiTile
          label="Tuần này"
          value={fmtUSD(revenue?.po_revenue.week.amount || 0)}
          badge={`${revenue?.po_revenue.week.count || 0} PO`}
          loading={loading}
        />
        <KpiTile
          label="Tháng này (MTD)"
          value={fmtUSD(revenue?.po_revenue.month.amount || 0)}
          badge={`${revenue?.po_revenue.month.count || 0} PO`}
          delta={revenue?.po_revenue.delta_yoy_mtd_pct}
          deltaLabel="YoY MTD"
          loading={loading}
        />
        <KpiTile
          label="Doanh thu giao hàng tuần"
          value={fmtVND(revenue?.delivery_revenue.week.amount_vnd || 0)}
          badge={`${revenue?.delivery_revenue.week.count || 0} lô`}
          loading={loading}
          icon="truck"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — Morning report text card */}
        <section className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Báo cáo buổi sáng</h2>
              <p className="text-xs text-slate-500 mt-0.5">Copy 1 click → Zalo group</p>
            </div>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Đã copy' : 'Copy text'}
            </button>
          </div>
          {loading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(8)].map((_, i) => <div key={i} className="h-4 bg-slate-100 rounded" />)}
            </div>
          ) : morning ? (
            <pre className="text-sm font-mono whitespace-pre-wrap text-slate-800 bg-slate-50 rounded-xl p-4 leading-relaxed">
{morning.text_version}
            </pre>
          ) : null}

          {/* Structured breakdown below text */}
          {morning && (
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-slate-500">Yêu cầu hôm nay</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{morning.requests.total}</div>
                <div className="mt-2 flex gap-3">
                  <span className="text-sky-700">TM: {morning.requests.tm}</span>
                  <span className="text-amber-700">GC: {morning.requests.gc}</span>
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-slate-500">Báo giá hôm nay</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{morning.quoted_today.total}</div>
                <div className="mt-2 text-slate-600">{morning.quoted_today.breakdown.length} vòng</div>
              </div>
            </div>
          )}
        </section>

        {/* RIGHT — Trend chart */}
        <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Xu hướng doanh thu (có YoY)</h2>
              <p className="text-xs text-slate-500 mt-0.5">PO value theo {trendPeriod === 'day' ? 'ngày' : trendPeriod === 'week' ? 'tuần' : 'tháng'} — overlay năm ngoái</p>
            </div>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
              {(['day', 'week', 'month'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setTrendPeriod(p)}
                  className={`px-3 py-1.5 ${trendPeriod === p ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {p === 'day' ? 'Ngày' : p === 'week' ? 'Tuần' : 'Tháng'}
                </button>
              ))}
            </div>
          </div>
          <div className="h-80">
            {loading ? (
              <div className="h-full bg-slate-50 rounded-xl animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={60} tickFormatter={(v) => `$${Math.round(v / 1000)}K`} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, borderColor: '#dbe3f0' }}
                    formatter={(v: number) => fmtUSD(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="amount" name="Năm nay" fill="#0f4c81" radius={[6, 6, 0, 0]} />
                  <Line dataKey="amount_ly" name="Năm ngoái" stroke="#64748b" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function KpiTile({
  label, value, badge, delta, deltaLabel, loading, icon,
}: {
  label: string;
  value: string;
  badge?: string;
  delta?: number | null;
  deltaLabel?: string;
  loading?: boolean;
  icon?: 'truck';
}) {
  const positive = typeof delta === 'number' && delta > 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        {icon === 'truck' ? <Truck className="w-4 h-4 text-slate-300" /> : <Package className="w-4 h-4 text-slate-300" />}
      </div>
      {loading ? (
        <div className="h-8 bg-slate-100 rounded mt-3 animate-pulse" />
      ) : (
        <div className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">{value}</div>
      )}
      <div className="mt-2 flex items-center justify-between text-xs">
        {badge && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-600">{badge}</span>}
        {delta != null && Number.isFinite(delta) && (
          <span className={`inline-flex items-center gap-1 font-medium ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>
            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmtPct(delta)}
            {deltaLabel && <span className="text-slate-400 font-normal"> {deltaLabel}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
