'use client';

import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Database,
  Filter,
  Loader2,
  RefreshCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface IntelligenceOverview {
  internal_median_v1: number | null;
  internal_median_v4: number | null;
  internal_purchase_median_vnd: number | null;
  market_median_vnd: number | null;
  market_median_usd: number | null;
  matched_codes: number;
  benchmark_match_rate_pct: number;
  median_gap_pct: number | null;
  latest_internal_date: string | null;
  latest_market_date: string | null;
}

interface IntelligenceQuality {
  rfq_coverage_pct: number;
  xnk_coverage_pct: number;
  benchmark_confidence: 'low' | 'medium' | 'high';
  benchmark_reason: string;
  matched_code_count: number;
  internal_code_count: number;
  market_code_count: number;
}

interface IntelligenceSource {
  key: string;
  name: string;
  status: 'active' | 'held_out';
  reliability: 'high' | 'medium' | 'low';
  reason: string;
  row_count: number;
  priced_rows: number;
  coverage_pct?: number;
  latest_date?: string | null;
}

interface MonthlyCompareRow {
  month: string;
  internal_median_v1: number | null;
  market_median_vnd: number | null;
  internal_priced_rows: number;
  market_priced_rows: number;
}

interface MakerCompareRow {
  maker_name: string;
  internal_median_v1: number | null;
  market_median_vnd: number | null;
  internal_rows: number;
  market_rows: number;
  gap_pct: number | null;
}

interface MatchedBqmsRow {
  bqms_code: string;
  internal_median_v1: number | null;
  market_median_vnd: number | null;
  internal_rows: number;
  market_rows: number;
  latest_rfq_date: string | null;
  latest_market_date: string | null;
  gap_pct: number | null;
}

interface IntelligenceResponse {
  overview: IntelligenceOverview;
  data_quality: IntelligenceQuality;
  sources: IntelligenceSource[];
  monthly_compare: MonthlyCompareRow[];
  maker_compare: MakerCompareRow[];
  matched_bqms: MatchedBqmsRow[];
}

const BAR_COLORS = ['#0f766e', '#115e59', '#164e63', '#1d4ed8', '#334155', '#475569', '#64748b', '#0f766e'];

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('vi-VN');
}

function formatMoneyVnd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toLocaleString('vi-VN')} ₫`;
}

function formatMoneyUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCompactMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} tỷ`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatNumber(value);
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
}

function tooltipNumber(value: string | number | Array<string | number> | null | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(normalized) ? normalized : null;
}

function qualityTone(level: IntelligenceQuality['benchmark_confidence'] | IntelligenceSource['reliability']) {
  if (level === 'high') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (level === 'medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

function sourceStatusTone(status: IntelligenceSource['status']) {
  return status === 'active'
    ? 'bg-sky-50 text-sky-700 border-sky-200'
    : 'bg-slate-100 text-slate-600 border-slate-200';
}

export default function PriceTrendsPage() {
  const [bqmsInput, setBqmsInput] = useState('');
  const [makerInput, setMakerInput] = useState('');
  const [months, setMonths] = useState(12);

  const bqmsCode = useDeferredValue(bqmsInput.trim());
  const maker = useDeferredValue(makerInput.trim());

  const { data, isLoading, error, refetch, isFetching } = useQuery<IntelligenceResponse>({
    queryKey: ['price-intelligence', bqmsCode, maker, months],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('months', String(months));
      if (bqmsCode) params.set('bqms_code', bqmsCode);
      if (maker) params.set('maker', maker);
      return api.get(`/api/v1/price-analytics/intelligence?${params.toString()}`);
    },
    retry: false,
  });

  const overview = data?.overview;
  const quality = data?.data_quality;
  const monthlyData = data?.monthly_compare ?? [];
  const makerData = data?.maker_compare ?? [];
  const matchedRows = data?.matched_bqms ?? [];
  const sources = data?.sources ?? [];

  const sourceSummary = useMemo(
    () => ({
      active: sources.filter((source) => source.status === 'active'),
      heldOut: sources.filter((source) => source.status === 'held_out'),
    }),
    [sources],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200 bg-white/95 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              Chỉ dùng dữ liệu thật
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Trung tâm xu hướng giá</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Màn này chỉ benchmark giữa báo giá BQMS và TT XNK. Báo giá trúng và giao hàng được hiển thị để theo dõi độ
                phủ, nhưng chưa bị trộn vào KPI chính cho đến khi khóa nối và ngữ nghĩa giá được xác thực đủ chắc.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[640px]">
            <FilterField
              icon={<Search className="h-4 w-4" />}
              label="Mã BQMS"
              value={bqmsInput}
              onChange={setBqmsInput}
              placeholder="Ví dụ: Z0000002-509805"
            />
            <FilterField
              icon={<Filter className="h-4 w-4" />}
              label="Maker"
              value={makerInput}
              onChange={setMakerInput}
              placeholder="Ví dụ: MISUMI"
            />
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Khoảng thời gian</p>
              <div className="mt-2 flex items-center gap-2">
                <select
                  value={months}
                  onChange={(event) => setMonths(Number(event.target.value))}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-400"
                >
                  <option value={3}>3 tháng</option>
                  <option value={6}>6 tháng</option>
                  <option value={12}>12 tháng</option>
                  <option value={24}>24 tháng</option>
                  <option value={36}>36 tháng</option>
                </select>
                <button
                  onClick={() => {
                    setBqmsInput('');
                    setMakerInput('');
                    setMonths(12);
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900"
                  title="Đặt lại bộ lọc"
                >
                  <RefreshCcw className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-2">
            <p>Không tải được dữ liệu cho trung tâm xu hướng giá.</p>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Tải lại
            </button>
          </div>
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Tổng quan benchmark</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">Chỉ số giá dùng được ngay</h2>
            </div>
            {(isLoading || isFetching) && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Giá nội bộ trung vị V1"
              value={formatMoneyVnd(overview?.internal_median_v1)}
              hint={`V4: ${formatMoneyVnd(overview?.internal_median_v4)}`}
              tone="blue"
            />
            <KpiCard
              label="Giá thị trường trung vị"
              value={formatMoneyVnd(overview?.market_median_vnd)}
              hint={`USD: ${formatMoneyUsd(overview?.market_median_usd)}`}
              tone="emerald"
            />
            <KpiCard
              label="Mã đối chiếu được"
              value={formatNumber(overview?.matched_codes)}
              hint={`Tỷ lệ match: ${overview?.benchmark_match_rate_pct ?? 0}%`}
              tone="amber"
            />
            <KpiCard
              label="Độ lệch trung vị"
              value={overview?.median_gap_pct != null ? `${overview.median_gap_pct}%` : '—'}
              hint={`Giá mua nội bộ: ${formatMoneyVnd(overview?.internal_purchase_median_vnd)}`}
              tone="slate"
            />
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Chất lượng dữ liệu</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">Độ tin cậy hiện tại</h2>
            </div>
            {quality && (
              <span className={cn('inline-flex rounded-full border px-3 py-1 text-xs font-semibold', qualityTone(quality.benchmark_confidence))}>
                {quality.benchmark_confidence === 'high' ? 'Tin cậy cao' : quality.benchmark_confidence === 'medium' ? 'Tin cậy trung bình' : 'Tin cậy thấp'}
              </span>
            )}
          </div>

          <div className="space-y-4">
            <CoverageBar label="Độ phủ giá báo BQMS" value={quality?.rfq_coverage_pct ?? 0} />
            <CoverageBar label="Độ phủ giá TT XNK" value={quality?.xnk_coverage_pct ?? 0} />
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm font-medium text-slate-800">{quality?.benchmark_reason ?? 'Đang chờ dữ liệu.'}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <MetaPair label="Mã nội bộ" value={formatNumber(quality?.internal_code_count)} />
                <MetaPair label="Mã thị trường" value={formatNumber(quality?.market_code_count)} />
                <MetaPair label="Mã match" value={formatNumber(quality?.matched_code_count)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <MetaPair label="Ngày nội bộ mới nhất" value={formatShortDate(overview?.latest_internal_date)} />
              <MetaPair label="Ngày TT XNK mới nhất" value={formatShortDate(overview?.latest_market_date)} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Nguồn dữ liệu</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Nguồn nào đang được dùng trong KPI</h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Database className="h-3.5 w-3.5" />
            Không dùng dữ liệu demo
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Đang tham gia benchmark</p>
            {sourceSummary.active.map((source) => (
              <SourceCard key={source.key} source={source} />
            ))}
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Đang giữ ngoài KPI chính</p>
            {sourceSummary.heldOut.map((source) => (
              <SourceCard key={source.key} source={source} />
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Biến động theo tháng</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">So sánh giá báo nội bộ và giá TT XNK</h2>
            <p className="mt-1 text-sm text-slate-600">
              Trục thời gian dùng ngày nghiệp vụ: `inquiry_date` cho BQMS RFQ và `rfq_date/quoted_date` cho TT XNK, không dùng
              `created_at` làm mốc chính.
            </p>
          </div>

          {isLoading ? (
            <LoadingBlock />
          ) : monthlyData.length === 0 ? (
            <EmptyBlock />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={monthlyData} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis width={68} tick={{ fontSize: 11 }} tickFormatter={(value) => formatCompactMoney(Number(value))} />
                <Tooltip
                  formatter={(value: string | number | Array<string | number> | null | undefined, name: string) => [
                    formatMoneyVnd(tooltipNumber(value)),
                    name === 'internal_median_v1' ? 'Giá nội bộ trung vị V1' : 'Giá TT XNK trung vị',
                  ]}
                  labelFormatter={(label) => `Tháng ${label}`}
                  contentStyle={{ fontSize: 12, borderRadius: 12, borderColor: '#cbd5e1' }}
                />
                <Line type="monotone" dataKey="internal_median_v1" stroke="#0f766e" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="market_median_vnd" stroke="#1d4ed8" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Top maker</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Maker có dữ liệu đối chiếu tốt nhất</h2>
          </div>

          {isLoading ? (
            <LoadingBlock />
          ) : makerData.length === 0 ? (
            <EmptyBlock />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={makerData} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(value) => formatCompactMoney(Number(value))} />
                  <YAxis dataKey="maker_name" type="category" width={96} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: string | number | Array<string | number> | null | undefined) => [
                      formatMoneyVnd(tooltipNumber(value)),
                      'Giá nội bộ trung vị V1',
                    ]}
                    contentStyle={{ fontSize: 12, borderRadius: 12, borderColor: '#cbd5e1' }}
                  />
                  <Bar dataKey="internal_median_v1" radius={[0, 8, 8, 0]}>
                    {makerData.map((_, index) => (
                      <Cell key={index} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-2">
                {makerData.slice(0, 3).map((row) => (
                  <div key={row.maker_name} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-800">{row.maker_name}</span>
                      <span className="font-mono text-slate-700">{row.gap_pct != null ? `${row.gap_pct}%` : '—'}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Nội bộ {row.internal_rows} dòng · TT XNK {row.market_rows} dòng
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Đối chiếu theo mã</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">BQMS match giữa báo giá và TT XNK</h2>
            <p className="mt-1 text-sm text-slate-600">
              Bảng này là lớp đối soát thô. Chỉ hiện các mã có giá ở cả hai nguồn để anh có thể truy ngược và kiểm tra từng mã.
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>{matchedRows.length} mã đang hiển thị</p>
            <p>Ưu tiên mã có ngày mới hơn</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80">
              <tr>
                <TH>Mã BQMS</TH>
                <TH align="right">Giá nội bộ</TH>
                <TH align="right">Giá TT XNK</TH>
                <TH align="right">Độ lệch</TH>
                <TH align="right">Dòng nội bộ</TH>
                <TH align="right">Dòng TT XNK</TH>
                <TH>Ngày mới nhất</TH>
              </tr>
            </thead>
            <tbody>
              {matchedRows.map((row) => (
                <tr key={row.bqms_code} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-mono text-[13px] font-semibold text-sky-700">{row.bqms_code}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{formatMoneyVnd(row.internal_median_v1)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{formatMoneyVnd(row.market_median_vnd)}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span className={cn('rounded-full px-2 py-1 text-[11px] font-semibold', row.gap_pct != null && row.gap_pct > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>
                      {row.gap_pct != null ? `${row.gap_pct}%` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatNumber(row.internal_rows)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatNumber(row.market_rows)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{formatShortDate(row.latest_rfq_date)}</div>
                    <div className="text-xs text-slate-400">TT XNK: {formatShortDate(row.latest_market_date)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FilterField({
  icon,
  label,
  value,
  onChange,
  placeholder,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-slate-400">{icon}</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-10 w-full border-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
        />
      </div>
    </label>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: 'blue' | 'emerald' | 'amber' | 'slate';
}) {
  const toneClass = {
    blue: 'from-sky-50 to-white text-sky-700',
    emerald: 'from-emerald-50 to-white text-emerald-700',
    amber: 'from-amber-50 to-white text-amber-700',
    slate: 'from-slate-100 to-white text-slate-700',
  }[tone];

  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-gradient-to-br p-4', toneClass)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function CoverageBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-mono text-slate-800">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-sky-600" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function MetaPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function SourceCard({ source }: { source: IntelligenceSource }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-900">{source.name}</p>
        <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold', sourceStatusTone(source.status))}>
          {source.status === 'active' ? 'Đang dùng' : 'Đang giữ ngoài'}
        </span>
        <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold', qualityTone(source.reliability))}>
          {source.reliability === 'high' ? 'Tin cậy cao' : source.reliability === 'medium' ? 'Tin cậy trung bình' : 'Tin cậy thấp'}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{source.reason}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetaPair label="Tổng dòng" value={formatNumber(source.row_count)} />
        <MetaPair label="Dòng có giá" value={formatNumber(source.priced_rows)} />
        <MetaPair label="Ngày mới nhất" value={formatShortDate(source.latest_date)} />
      </div>
      {typeof source.coverage_pct === 'number' && (
        <div className="mt-4">
          <CoverageBar label="Độ phủ giá" value={source.coverage_pct} />
        </div>
      )}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex h-72 items-center justify-center text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

function EmptyBlock() {
  return (
    <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
      Chưa có đủ dữ liệu để hiển thị trong bộ lọc hiện tại.
    </div>
  );
}

function TH({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}
