'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api } from '@/lib/api';
import { cn, withToken } from '@/lib/utils';
import { CHART } from '@/lib/chart-colors';

interface CodeHistoryDrawerProps {
  code: string | null;
  onClose: () => void;
}

interface Summary {
  specification: string | null;
  maker: string | null;
  ctr_type: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total_rfq_count: number;
  total_won_count: number;
  total_lost_count: number;
  total_pending_count: number;
  win_rate_pct: number;
}

interface Frequency {
  rfq_count_12m: number;
  rfq_count_6m: number;
  rfq_count_3m: number;
  inter_arrival_days_avg: number | null;
  inter_arrival_days_stddev: number | null;
  cv_pct: number | null;
  next_expected_date: string | null;
  next_expected_confidence: 'low' | 'medium' | 'high';
}

interface Pricing {
  v1_median: number | null;
  v1_min: number | null;
  v1_max: number | null;
  v4_median: number | null;
  v4_min: number | null;
  v4_max: number | null;
  won_price_median: number | null;
  won_price_min: number | null;
  won_price_max: number | null;
  won_price_count: number;
  market_median_vnd: number | null;
  market_median_usd: number | null;
  market_rows: number;
  v1_vs_won_drop_pct: number | null;
  won_vs_market_gap_pct: number | null;
}

interface Quantity {
  expected_qty_median: number | null;
  expected_qty_min: number | null;
  expected_qty_max: number | null;
  delivered_qty_total: number | null;
  delivered_value_vnd_total: number | null;
}

interface Department {
  department: string;
  rfq_count: number;
  won_count: number;
  win_rate_pct: number;
  median_v1_price: number | null;
}

interface Buyer {
  buyer_name: string;
  plant: string;
  company: string;
  po_count: number;
  median_unit_price: number | null;
  last_po_date: string | null;
}

interface SeasonalSlot {
  month: number;
  rfq_count: number;
  won_count: number;
  median_v1: number | null;
}

interface MonthlyTrend {
  month_key: string;
  rfq_count: number;
  won_count: number;
  median_v1: number | null;
  market_median_vnd: number | null;
}

interface ForecastPoint {
  month_key: string;
  predicted_count: number;
  predicted_count_rounded: number;
}

interface TrendForecast {
  linear: {
    method: string;
    slope_per_month: number;
    intercept: number;
    r_squared: number;
    confidence: 'low' | 'medium' | 'high';
    next_3_months: ForecastPoint[];
  };
  ewma: {
    method: string;
    alpha: number;
    last_smooth: number;
    fit_score: number;
    confidence: 'low' | 'medium' | 'high';
    next_3_months: ForecastPoint[];
  };
}

interface RfqHistoryRow {
  rfq_number: string | null;
  inquiry_date: string | null;
  quoted_v1: number | null;
  quoted_v4: number | null;
  expected_qty: number | null;
  result: string | null;
  person_in_charge: string | null;
  department: string;
}

interface CodeHistoryResponse {
  data: {
    code: string;
    summary: Summary;
    frequency: Frequency;
    pricing: Pricing;
    quantity: Quantity;
    departments: Department[];
    buyers: Buyer[];
    seasonal_heatmap: SeasonalSlot[];
    monthly_trend: MonthlyTrend[];
    trend_forecast: TrendForecast;
    rfq_history: RfqHistoryRow[];
    generated_at: string;
  };
}

const MONTH_LABELS_VI = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];

function fmtMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v.toLocaleString('vi-VN')} ₫`;
}
function fmtCompact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} tỷ`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString('vi-VN');
}
function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  return Number(v).toLocaleString('vi-VN');
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('vi-VN');
}

function confidenceTone(level: 'low' | 'medium' | 'high'): string {
  if (level === 'high') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (level === 'medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

function resultTone(result: string | null | undefined): string {
  if (!result) return 'bg-slate-100 text-slate-600';
  const lower = result.toLowerCase();
  if (lower.includes('won')) return 'bg-emerald-50 text-emerald-700';
  if (lower.includes('lost') || lower.includes('lose')) return 'bg-rose-50 text-rose-700';
  return 'bg-slate-100 text-slate-600';
}

export function CodeHistoryDrawer({ code, onClose }: CodeHistoryDrawerProps) {
  const [forecastMode, setForecastMode] = useState<'linear' | 'ewma'>('linear');

  const { data, isLoading, error } = useQuery<CodeHistoryResponse>({
    queryKey: ['code-history', code],
    queryFn: () =>
      api.get(`/api/v1/price-analytics/code-history/${encodeURIComponent(code as string)}`),
    enabled: !!code,
    retry: false,
  });

  useEffect(() => {
    if (!code) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [code, onClose]);

  const body = data?.data;
  const forecastBlock = body?.trend_forecast?.[forecastMode];

  const chartData = useMemo(() => {
    if (!body) return [];
    const historical = body.monthly_trend.map((row) => ({
      month_key: row.month_key,
      rfq_count: row.rfq_count,
      forecast: null as number | null,
    }));
    if (forecastBlock?.next_3_months) {
      forecastBlock.next_3_months.forEach((point) => {
        historical.push({
          month_key: point.month_key,
          rfq_count: 0,
          forecast: point.predicted_count,
        });
      });
    }
    return historical;
  }, [body, forecastBlock]);

  const maxSeasonalCount = useMemo(() => {
    if (!body) return 0;
    return body.seasonal_heatmap.reduce((max, slot) => Math.max(max, slot.rfq_count), 0);
  }, [body]);

  const priceCompareData = useMemo(() => {
    if (!body) return [];
    const items: { label: string; value: number | null; color: string }[] = [];
    if (body.pricing.v1_median != null) items.push({ label: 'V1', value: body.pricing.v1_median, color: CHART.brand });
    if (body.pricing.v4_median != null) items.push({ label: 'V4', value: body.pricing.v4_median, color: CHART.info });
    if (body.pricing.won_price_median != null) items.push({ label: 'Trúng', value: body.pricing.won_price_median, color: CHART.success });
    if (body.pricing.market_median_vnd != null) items.push({ label: 'Thị trường', value: body.pricing.market_median_vnd, color: CHART.neutral });
    return items;
  }, [body]);

  if (!code) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        onClick={onClose}
        aria-label="Đóng drawer"
        className="flex-1 cursor-default bg-slate-950/40 backdrop-blur-sm transition"
      />
      <aside className="flex h-full w-full max-w-[920px] flex-col overflow-hidden bg-slate-50 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Đào sâu mã BQMS</p>
            <h2 className="font-mono text-xl font-semibold text-slate-900">{code}</h2>
            {body && (
              <p className="text-sm text-slate-600">
                {body.summary.specification || '—'} · {body.summary.maker || 'Không rõ maker'}
                {body.summary.ctr_type && <> · <span className="text-slate-500">{body.summary.ctr_type}</span></>}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isLoading && (
            <div className="flex h-64 items-center justify-center text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Không tải được lịch sử cho mã này. Kiểm tra mã có RFQ trong hệ thống.</p>
            </div>
          )}

          {body && (
            <div className="space-y-6">
              <section className="grid gap-3 md:grid-cols-4">
                <KpiCard
                  label="Tần suất 12 tháng"
                  value={`${body.frequency.rfq_count_12m} lần`}
                  hint={`6M: ${body.frequency.rfq_count_6m} · 3M: ${body.frequency.rfq_count_3m}`}
                  tone="blue"
                />
                <KpiCard
                  label="Tỷ lệ trúng"
                  value={`${body.summary.win_rate_pct}%`}
                  hint={`Trúng ${body.summary.total_won_count}/${body.summary.total_rfq_count} · Mất ${body.summary.total_lost_count}`}
                  tone="emerald"
                />
                <KpiCard
                  label="Giá trúng trung vị"
                  value={fmtMoney(body.pricing.won_price_median)}
                  hint={`Min ${fmtCompact(body.pricing.won_price_min)} · Max ${fmtCompact(body.pricing.won_price_max)} · n=${body.pricing.won_price_count}`}
                  tone="amber"
                />
                <KpiCard
                  label="Lần hỏi kế tiếp dự kiến"
                  value={fmtDate(body.frequency.next_expected_date)}
                  hint={
                    body.frequency.inter_arrival_days_avg
                      ? `Cách ${body.frequency.inter_arrival_days_avg}d ± ${body.frequency.inter_arrival_days_stddev}d`
                      : 'Chưa đủ dữ liệu'
                  }
                  tone="slate"
                  badge={body.frequency.next_expected_confidence}
                />
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <Card title="So sánh giá theo nguồn" subtitle="Nội bộ V1/V4 · Trúng (Samsung PO) · TT XNK">
                  {priceCompareData.length === 0 ? (
                    <EmptyBlock />
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={priceCompareData} margin={{ top: 4, right: 12, bottom: 8, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => fmtCompact(Number(value))} width={68} />
                        <Tooltip
                          formatter={(value: unknown) => [fmtMoney(typeof value === 'number' ? value : Number(value)), 'Giá trung vị']}
                          contentStyle={{ fontSize: 12, borderRadius: 12, borderColor: '#cbd5e1' }}
                        />
                        <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                          {priceCompareData.map((item, idx) => (
                            <Cell key={idx} fill={item.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <MetaPair
                      label="V1 → Trúng (giảm)"
                      value={body.pricing.v1_vs_won_drop_pct != null ? `${body.pricing.v1_vs_won_drop_pct}%` : '—'}
                    />
                    <MetaPair
                      label="Trúng vs TT XNK"
                      value={body.pricing.won_vs_market_gap_pct != null ? `${body.pricing.won_vs_market_gap_pct}%` : '—'}
                    />
                  </div>
                </Card>

                <Card title="Số lượng" subtitle="Hỏi hàng (BQMS) · Đã giao (deliveries)">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MetaPair label="Qty trung vị hỏi" value={fmtNum(body.quantity.expected_qty_median)} />
                    <MetaPair label="Qty min – max" value={`${fmtNum(body.quantity.expected_qty_min)} – ${fmtNum(body.quantity.expected_qty_max)}`} />
                    <MetaPair label="Qty đã giao (tổng)" value={fmtNum(body.quantity.delivered_qty_total)} />
                    <MetaPair label="Giá trị đã giao" value={fmtCompact(body.quantity.delivered_value_vnd_total)} />
                  </div>
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-500">
                    Hệ số biến thiên CV = {body.frequency.cv_pct != null ? `${body.frequency.cv_pct}%` : '—'} ·{' '}
                    Lần đầu {fmtDate(body.summary.first_seen)} · Gần nhất {fmtDate(body.summary.last_seen)}
                  </div>
                </Card>
              </section>

              <Card title="Heatmap mùa vụ" subtitle="Số lần hỏi theo tháng trong năm (tổng hợp toàn bộ lịch sử)">
                {maxSeasonalCount === 0 ? (
                  <EmptyBlock />
                ) : (
                  <div className="grid grid-cols-12 gap-2">
                    {body.seasonal_heatmap.map((slot) => {
                      const intensity = maxSeasonalCount === 0 ? 0 : slot.rfq_count / maxSeasonalCount;
                      const opacity = slot.rfq_count === 0 ? 0.06 : 0.18 + intensity * 0.7;
                      return (
                        <div
                          key={slot.month}
                          className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-sky-600 px-1 py-3 text-center"
                          style={{ backgroundColor: `rgba(2, 132, 199, ${opacity})` }}
                          title={`${MONTH_LABELS_VI[slot.month - 1]} · ${slot.rfq_count} hỏi · ${slot.won_count} trúng`}
                        >
                          <span className={cn('text-[11px] font-semibold uppercase tracking-wider', slot.rfq_count > 0 ? 'text-white' : 'text-slate-500')}>
                            {MONTH_LABELS_VI[slot.month - 1]}
                          </span>
                          <span className={cn('text-sm font-semibold', slot.rfq_count > 0 ? 'text-white' : 'text-slate-400')}>
                            {slot.rfq_count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card
                title="Trend + Dự báo 3 tháng"
                subtitle="Số lượng RFQ/tháng · Linear regression vs EWMA"
                right={
                  <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setForecastMode('linear')}
                      className={cn(
                        'rounded-full px-3 py-1 transition',
                        forecastMode === 'linear' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:text-slate-900',
                      )}
                    >
                      Linear
                    </button>
                    <button
                      type="button"
                      onClick={() => setForecastMode('ewma')}
                      className={cn(
                        'rounded-full px-3 py-1 transition',
                        forecastMode === 'ewma' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:text-slate-900',
                      )}
                    >
                      EWMA α=0.3
                    </button>
                  </div>
                }
              >
                {chartData.length === 0 ? (
                  <EmptyBlock />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month_key" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} width={42} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: unknown, name: string) => {
                          const num = typeof value === 'number' ? value : Number(value);
                          if (Number.isNaN(num)) return ['—', name];
                          return [num.toFixed(num % 1 === 0 ? 0 : 2), name === 'rfq_count' ? 'Thực tế' : 'Dự báo'];
                        }}
                        contentStyle={{ fontSize: 12, borderRadius: 12, borderColor: '#cbd5e1' }}
                      />
                      <Bar dataKey="rfq_count" fill={CHART.brand} radius={[4, 4, 0, 0]} />
                      <Line
                        type="monotone"
                        dataKey="forecast"
                        stroke={CHART.info}
                        strokeWidth={2.5}
                        strokeDasharray="6 4"
                        dot={{ r: 4 }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
                {forecastBlock && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {forecastMode === 'linear' ? (
                      <>
                        <MetaPair label="Slope / tháng" value={body.trend_forecast.linear.slope_per_month.toFixed(3)} />
                        <MetaPair label="R²" value={body.trend_forecast.linear.r_squared.toFixed(3)} />
                        <MetaPair label="Độ tin cậy" value={body.trend_forecast.linear.confidence.toUpperCase()} badge={body.trend_forecast.linear.confidence} />
                      </>
                    ) : (
                      <>
                        <MetaPair label="Last smooth" value={body.trend_forecast.ewma.last_smooth.toFixed(3)} />
                        <MetaPair label="Fit score" value={body.trend_forecast.ewma.fit_score.toFixed(3)} />
                        <MetaPair label="Độ tin cậy" value={body.trend_forecast.ewma.confidence.toUpperCase()} badge={body.trend_forecast.ewma.confidence} />
                      </>
                    )}
                  </div>
                )}
              </Card>

              <section className="grid gap-4 lg:grid-cols-2">
                <Card title="Phòng ban hỏi mua" subtitle="Từ Samsung psinchargeName (vendor portal staging)">
                  {body.departments.length === 0 ? (
                    <EmptyBlock />
                  ) : (
                    <div className="space-y-2">
                      {body.departments.map((row) => (
                        <div key={row.department} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-slate-800">{row.department}</span>
                            <span className="font-mono text-xs text-slate-500">
                              {row.rfq_count} hỏi · WR {row.win_rate_pct}%
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                            <span>Trúng {row.won_count}</span>
                            <span className="font-mono">V1 trung vị: {fmtMoney(row.median_v1_price)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Buyer / Plant" subtitle="Từ bqms_samsung_po (PO trúng thực)">
                  {body.buyers.length === 0 ? (
                    <EmptyBlock />
                  ) : (
                    <div className="space-y-2">
                      {body.buyers.map((row, idx) => (
                        <div key={`${row.buyer_name}-${idx}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-slate-800">{row.buyer_name}</span>
                            <span className="font-mono text-xs text-slate-500">{row.po_count} PO</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                            <span>{row.plant} · {row.company}</span>
                            <span className="font-mono">Đơn giá trung vị: {fmtMoney(row.median_unit_price)}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">PO gần nhất: {fmtDate(row.last_po_date)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </section>

              <Card title="Lịch sử RFQ" subtitle="20 dòng mới nhất">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50/80">
                      <tr>
                        <TH>RFQ</TH>
                        <TH>Ngày hỏi</TH>
                        <TH align="right">V1</TH>
                        <TH align="right">V4</TH>
                        <TH align="right">Qty</TH>
                        <TH>Kết quả</TH>
                        <TH>Phòng ban</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {body.rfq_history.map((row, idx) => (
                        <tr key={`${row.rfq_number}-${idx}`} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-2 font-mono text-[12px] text-sky-700">{row.rfq_number || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{fmtDate(row.inquiry_date)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-700">{fmtCompact(row.quoted_v1)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-700">{fmtCompact(row.quoted_v4)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600">{fmtNum(row.expected_qty)}</td>
                          <td className="px-3 py-2">
                            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', resultTone(row.result))}>
                              {row.result || 'pending'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600">{row.department}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <SourcingForCode code={code} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

interface SourcingMini {
  id: number;
  bqms_code: string | null;
  product_name: string | null;
  maker: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  cost_vnd: number | null;
  sale_vnd: number | null;
  quantity: number | null;
  coefficient: number | null;
  row_classification: string | null;
  image_url: string | null;
  notes: string | null;
  inquiry_date: string | null;
  created_by_email: string | null;
}

function SourcingForCode({ code }: { code: string }) {
  const q = useQuery<{ data: SourcingMini[] }>({
    queryKey: ['sourcing-by-code', code],
    queryFn: () => api.get(`/api/v1/sourcing/by-code/${encodeURIComponent(code)}`),
    enabled: !!code,
    retry: false,
  });
  const entries = q.data?.data ?? [];

  return (
    <Card
      title="Sourcing đã lưu cho mã này"
      subtitle="Tham chiếu khi báo giá cho khách"
      right={
        <a
          href="/sourcing"
          className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100"
        >
          Mở thư viện →
        </a>
      }
    >
      {q.isLoading ? (
        <div className="flex h-32 items-center justify-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-brand-50/40 px-4 py-6 text-center text-sm text-slate-600">
          <p className="font-medium">Chưa có entry sourcing nào cho mã này.</p>
          <p className="mt-1 text-xs text-slate-500">
            Vào "Thư viện nguồn cung" tạo entry với mã BQMS = <span className="font-mono">{code}</span> để team sale tham chiếu.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {e.supplier_name || 'Chưa có NCC'}{' '}
                    {e.maker && <span className="text-xs text-slate-500">· {e.maker}</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {e.product_name || '—'}
                    {e.supplier_phone && <span className="ml-2 font-mono">📞 {e.supplier_phone}</span>}
                  </p>
                </div>
                {e.row_classification && (
                  <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                    {e.row_classification}
                  </span>
                )}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <MetaPair label="Giá nhập VND" value={e.cost_vnd != null ? `${e.cost_vnd.toLocaleString('vi-VN')} ₫` : '—'} />
                <MetaPair label="Giá bán VND" value={e.sale_vnd != null ? `${e.sale_vnd.toLocaleString('vi-VN')} ₫` : '—'} />
                <MetaPair label="Qty" value={e.quantity != null ? e.quantity.toLocaleString('vi-VN') : '—'} />
                <MetaPair label="Hệ số" value={e.coefficient != null ? `×${e.coefficient}` : '—'} />
              </div>
              {e.notes && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">📝 {e.notes}</p>}
              {e.image_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={withToken(e.image_url)}
                  alt="sourcing"
                  className="mt-2 h-24 w-24 rounded-xl border border-slate-200 object-cover"
                  onError={(ev) => ((ev.currentTarget.style.display = 'none'))}
                />
              )}
              <p className="mt-2 text-[11px] text-slate-400">
                {e.inquiry_date && `Hỏi: ${new Date(e.inquiry_date).toLocaleDateString('vi-VN')} · `}
                Bởi {e.created_by_email || '—'}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Card({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
  badge,
}: {
  label: string;
  value: string;
  hint: string;
  tone: 'blue' | 'emerald' | 'amber' | 'slate';
  badge?: 'low' | 'medium' | 'high';
}) {
  const toneClass = {
    blue: 'bg-sky-50',
    emerald: 'bg-emerald-50',
    amber: 'bg-amber-50',
    slate: 'bg-slate-50',
  }[tone];

  return (
    <div className={cn('relative rounded-xl border border-slate-200 p-4', toneClass)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-[11px] text-slate-500">{hint}</p>
      {badge && (
        <span className={cn('absolute right-3 top-3 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase', confidenceTone(badge))}>
          {badge}
        </span>
      )}
    </div>
  );
}

function MetaPair({ label, value, badge }: { label: string; value: string; badge?: 'low' | 'medium' | 'high' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={cn('mt-1 text-sm font-medium text-slate-800', badge && 'inline-flex items-center gap-2')}>
        <span>{value}</span>
        {badge && (
          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', confidenceTone(badge))}>
            {badge}
          </span>
        )}
      </p>
    </div>
  );
}

function TH({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function EmptyBlock() {
  return (
    <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
      Chưa có dữ liệu phù hợp.
    </div>
  );
}
