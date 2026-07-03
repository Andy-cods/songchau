'use client';

/**
 * Procurement Analytics (Đợt 6) — /analytics/procurement
 *
 * ONE useQuery → GET /api/v1/procurement/analytics?months=12
 * Renders the vendor-bidding / award funnel KPIs for internal sourcing.
 *
 * CROSS-CUTTING INVARIANTS (do not violate — reviewers reject):
 *  - PER-CURRENCY ONLY. No FX table wired → never SUM across USD/RMB/VND.
 *    spend_trend / award_by_vendor / savings arrive as per-currency arrays;
 *    the currency segmented switch picks ONE group at a time.
 *  - Postgres NUMERIC serializes as STRING in JSON → every number flows
 *    through toNum() / safeFixed() from @/lib/utils BEFORE any
 *    .toFixed() / .toLocaleString(). The backend already excludes superseded
 *    awards (WHERE superseded_by IS NULL) and computes on-time from PO
 *    actual_delivery_date <= requested_delivery_date; FE just renders.
 *  - DESIGN: DATA COCKPIT system. ONE indigo brand (#4f46e5) + slate ramp +
 *    functional emerald/amber/sky/rose as CALM leading dots. NO rainbow
 *    categoricals — extra categories use a slate monochrome ramp. Charts
 *    always receive an explicit colors prop. Cockpit primitives from
 *    @/components/cockpit own the type scale / elevation / motion budget.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { cn, toNum, safeFixed } from '@/lib/utils';
import {
  PageShellHeader,
  KpiRail,
  KpiCell,
  DataPanel,
  MonthsFilter,
  SHELL,
  TYPE,
  ELEVATION,
  RADIUS,
} from '@/components/cockpit';
import {
  ShoppingCart,
  AlertCircle,
  PiggyBank,
} from 'lucide-react';

// Code-splitting (W3-16): defer recharts chunk until charts render.
const ChartSkeleton = ({ height }: { height: number }) => (
  <div className="w-full animate-pulse rounded-lg bg-slate-100" style={{ height }} />
);
const LineAreaChart = dynamic(
  () => import('@/components/charts/line-area-chart').then((m) => m.LineAreaChart),
  { ssr: false, loading: () => <ChartSkeleton height={320} /> },
);
const DonutChart = dynamic(
  () => import('@/components/charts/donut-chart').then((m) => m.DonutChart),
  { ssr: false, loading: () => <ChartSkeleton height={320} /> },
);
const Sparkline = dynamic(
  () => import('@/components/charts/sparkline').then((m) => m.Sparkline),
  { ssr: false, loading: () => null },
);

// ─── Design palette (restrained — ONE indigo brand + slate ramp) ────
const BRAND = '#4f46e5'; // brand-600 series for every chart / highlight
const SLATE_300 = '#cbd5e1'; // non-highlighted bars in award ranking
const SLATE_500 = '#64748b'; // funnel non-final stages
// Monochrome ramp for >1 categorical (DonutChart) — NO rainbow defaults.
const SLATE_RAMP = ['#4f46e5', '#94a3b8', '#cbd5e1', '#e2e8f0', '#64748b', '#475569'];

// ─── Types — mirror GET /api/v1/procurement/analytics ───────────────
// NUMERIC fields may arrive as string; always coerce with toNum/safeFixed.
type Num = number | string | null;

interface SpendPoint {
  month: string; // 'YYYY-MM'
  spend: Num;
}
interface SpendGroup {
  currency: string;
  points: SpendPoint[];
}
interface StatusSlice {
  status: string;
  label?: string;
  count: Num;
}
interface QuoteFunnel {
  invited: Num;
  viewed: Num;
  submitted: Num;
  awarded: Num;
}
interface VendorAward {
  vendor_id?: number | null;
  vendor_name: string;
  amount: Num; // total awarded WITHIN this currency group
}
interface AwardGroup {
  currency: string;
  vendors: VendorAward[];
}
interface CycleTime {
  // publish → award cycle, in days
  avg_days: Num;
  median_days: Num;
  p90_days: Num;
  min_days: Num;
  n: Num; // sample size for "n="
}
interface OnTimeDelivery {
  on_time: Num; // PO actual <= requested over status IN(delivered,closed)
  total: Num;
  rate_pct: Num; // backend NULLIF(total,0)
  trend: Num[]; // monthly on-time % for the Sparkline
}
interface SavingsGroup {
  currency: string;
  baseline: Num; // sum lowest-eligible-quote baseline WITHIN currency
  awarded: Num; // sum awarded WITHIN currency (superseded_by IS NULL)
  savings: Num; // baseline - awarded
  covered: Num; // # awards with a computable baseline
  total_awards: Num; // # awards in group (coverage = covered/total)
}

// #13 — VND rollup (only present when convert_vnd=true). ADDITIVE; the per-currency
// arrays above are untouched. Foreign rows missing a rate at their as-of date are
// EXCLUDED from these sums and counted in missing_rate.
interface VndRollup {
  awarded_vnd: Num;
  po_vnd: Num;
  contract_vnd: Num;
  savings_vnd: Num;
  baseline_vnd: Num;
  awarded_vnd_from_savings: Num;
  missing_rate: { award: Num; po: Num; contract: Num; savings: Num };
  as_of: string;
  rate_source: string;
}
interface VndVendorAward extends VendorAward {
  award_count?: Num;
  missing_rate_rows?: Num;
}

// #17 — delivery-due cockpit (INTERNAL). PO mở sắp/đã quá hạn giao trong 14 ngày.
// progress_pct là % theo SỐ LƯỢNG (currency-free) — KHÔNG có tiền (per-currency).
interface DeliveryDueItem {
  po_id: number;
  po_no: string;
  batch_id: number | null;
  vendor_name: string;
  days_remaining: Num; // <0 = quá hạn, >=0 = còn ... ngày
  requested_delivery_date: string | null; // 'YYYY-MM-DD'
  progress_pct: Num; // null khi chưa có ordered_qty
  severity: 'overdue' | 'due_soon';
}
interface DeliveryDue {
  window_days: Num;
  overdue_count: Num;
  due_soon_count: Num;
  items: DeliveryDueItem[];
}

interface ProcurementAnalytics {
  spend_trend: SpendGroup[];
  batches_by_status: StatusSlice[];
  quote_funnel: QuoteFunnel | null;
  award_by_vendor: AwardGroup[];
  award_by_vendor_vnd: VndVendorAward[] | null;
  cycle_time: CycleTime | null;
  on_time_delivery: OnTimeDelivery | null;
  savings: SavingsGroup[];
  vnd_rollup: VndRollup | null;
  delivery_due: DeliveryDue | null;
}

// Envelope tolerance — backend may wrap in { data } or return bare object.
type AnalyticsResp = { data?: ProcurementAnalytics } & Partial<ProcurementAnalytics>;

const TOP_N = 8; // award ranking cap

// ─── Money helper — compact, per-currency, NUMERIC-safe ─────────────
function fmtAmount(v: Num, currency: string): string {
  const n = toNum(v);
  let body: string;
  if (Math.abs(n) >= 1_000_000_000) body = `${safeFixed(n / 1_000_000_000, 1)} tỷ`;
  else if (Math.abs(n) >= 1_000_000) body = `${safeFixed(n / 1_000_000, 1)}M`;
  else if (Math.abs(n) >= 1_000) body = `${safeFixed(n / 1_000, 0)}K`;
  else body = Math.round(n).toLocaleString('vi-VN');
  return `${body} ${currency}`;
}

function EmptyHint({ children = 'Chưa có dữ liệu' }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center py-10 text-[13px] text-slate-400">
      {children}
    </div>
  );
}

// ─── Currency segmented switch — cockpit chip group ─────────────────
function CurrencySwitch({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  if (options.length <= 1) return null;
  return (
    <div className={cn('inline-flex items-center bg-slate-100/80 p-0.5', RADIUS.container)}>
      {options.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            'rounded-md px-3 py-1 font-mono text-[12px] font-semibold transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
            value === c
              ? 'bg-white text-brand-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

// ─── VND rollup toggle (#13) — same restrained chip group as CurrencySwitch ──
// OFF = per-currency (the default, unchanged). ON = "Quy về VND" read-time rollup.
function VndSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={cn('inline-flex items-center bg-slate-100/80 p-0.5', RADIUS.container)}>
      {([
        ['Theo tiền tệ', false],
        ['Quy về VND', true],
      ] as const).map(([label, on]) => (
        <button
          key={label}
          onClick={() => onChange(on)}
          className={cn(
            'rounded-md px-3 py-1 text-[12px] font-semibold transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
            value === on
              ? 'bg-white text-brand-700 ring-1 ring-inset ring-brand-400 shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────
export default function ProcurementAnalyticsPage() {
  const [months, setMonths] = useState(12);
  const [vnd, setVnd] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AnalyticsResp>({
    queryKey: ['procurement-analytics', months, vnd],
    queryFn: () =>
      api.get(`/api/v1/procurement/analytics?months=${months}${vnd ? '&convert_vnd=true' : ''}`),
    retry: false,
  });

  // Unwrap envelope tolerantly.
  const a: ProcurementAnalytics | undefined = useMemo(() => {
    if (!data) return undefined;
    const root = (data.data ?? data) as Partial<ProcurementAnalytics>;
    return {
      spend_trend: Array.isArray(root.spend_trend) ? root.spend_trend : [],
      batches_by_status: Array.isArray(root.batches_by_status) ? root.batches_by_status : [],
      quote_funnel: root.quote_funnel ?? null,
      award_by_vendor: Array.isArray(root.award_by_vendor) ? root.award_by_vendor : [],
      award_by_vendor_vnd: Array.isArray(root.award_by_vendor_vnd) ? root.award_by_vendor_vnd : null,
      cycle_time: root.cycle_time ?? null,
      on_time_delivery: root.on_time_delivery ?? null,
      savings: Array.isArray(root.savings) ? root.savings : [],
      vnd_rollup: root.vnd_rollup ?? null,
      delivery_due: root.delivery_due ?? null,
    };
  }, [data]);

  // ── Per-currency selection (spend + award + savings each pick ONE group) ──
  const spendCurrencies = useMemo(
    () => (a?.spend_trend ?? []).map((g) => g.currency),
    [a]
  );
  const awardCurrencies = useMemo(
    () => (a?.award_by_vendor ?? []).map((g) => g.currency),
    [a]
  );

  const [spendCcy, setSpendCcy] = useState<string | null>(null);
  const [awardCcy, setAwardCcy] = useState<string | null>(null);

  const activeSpendCcy =
    spendCcy && spendCurrencies.includes(spendCcy) ? spendCcy : spendCurrencies[0] ?? null;
  const activeAwardCcy =
    awardCcy && awardCurrencies.includes(awardCcy) ? awardCcy : awardCurrencies[0] ?? null;

  // ── Shell-level header chrome (sticky) — shared across all states ──
  const header = (
    <PageShellHeader
      eyebrow="Đợt 6 · Sourcing"
      title={
        <span className="inline-flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 shrink-0 text-brand-600" />
          Phân tích mua sắm
        </span>
      }
      isFetching={isFetching}
      actions={
        <div className="flex items-center gap-2">
          <VndSwitch value={vnd} onChange={setVnd} />
          <MonthsFilter value={months} onChange={setMonths} />
        </div>
      }
    />
  );

  // ── Loading state (whole page) ──
  if (isLoading) {
    return (
      <div className={cn(SHELL.page, '-m-6')}>
        {header}
        <div className={cn(SHELL.content, 'py-4', SHELL.sectionStack)}>
          <KpiRail cols={4} stagger={false}>
            {[0, 1, 2, 3].map((i) => (
              <KpiCell key={i} label="" loading />
            ))}
          </KpiRail>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <DataPanel key={i} title="">
                <div className="h-[300px] animate-pulse rounded-lg bg-slate-100" />
              </DataPanel>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error state (whole page) ──
  if (isError || !a) {
    return (
      <div className={cn(SHELL.page, '-m-6')}>
        {header}
        <div className={cn(SHELL.content, 'py-4')}>
          <div
            className={cn(
              ELEVATION.container,
              RADIUS.container,
              'flex flex-col items-center gap-3 p-8 text-center ring-rose-200',
            )}
          >
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <p className="text-[13px] font-medium text-slate-700">
              Không tải được số liệu phân tích mua sắm
            </p>
            <p className="max-w-md text-[12px] text-slate-400">
              {(error as { detail?: string } | null)?.detail ?? 'Lỗi máy chủ hoặc bạn không có quyền truy cập.'}
            </p>
            <button
              onClick={() => refetch()}
              className="mt-1 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Thử lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Derived KPI values (all coerced) ──
  const ot = a.on_time_delivery;
  const otRate = ot ? toNum(ot.rate_pct) : null;
  const otTrend = (ot?.trend ?? []).map((v) => toNum(v));
  const cyc = a.cycle_time;

  // Award (win) total for the active currency — NEVER summed across currencies.
  const activeAwardGroup = (a.award_by_vendor ?? []).find((g) => g.currency === activeAwardCcy);
  const awardTotal = (activeAwardGroup?.vendors ?? []).reduce(
    (s, v) => s + toNum(v.amount),
    0
  );

  // Savings for the active award currency (fallback first group) — per-currency.
  const savingsGroup =
    (a.savings ?? []).find((g) => g.currency === activeAwardCcy) ?? (a.savings ?? [])[0] ?? null;
  const savingsCovered = savingsGroup
    ? `${toNum(savingsGroup.covered)}/${toNum(savingsGroup.total_awards)}`
    : '—';

  // ── Chart datasets ──
  const spendGroup = (a.spend_trend ?? []).find((g) => g.currency === activeSpendCcy);
  const spendData = (spendGroup?.points ?? []).map((p) => ({
    month: p.month,
    spend: toNum(p.spend),
  }));

  const statusData = (a.batches_by_status ?? []).map((s) => ({
    name: s.label ?? s.status,
    value: toNum(s.count),
  }));

  // Funnel — 4 horizontal bars invited → viewed → submitted → awarded.
  const f = a.quote_funnel;
  const funnelStages = f
    ? [
        { name: 'Mời', value: toNum(f.invited), final: false },
        { name: 'Đã xem', value: toNum(f.viewed), final: false },
        { name: 'Báo giá', value: toNum(f.submitted), final: false },
        { name: 'Trúng thầu', value: toNum(f.awarded), final: true },
      ]
    : [];
  const funnelInvited = toNum(f?.invited);

  // ── #13 VND rollup (active only when toggle ON and backend emitted it) ──
  const rollup = vnd ? a.vnd_rollup : null;
  const rollupOn = !!rollup;
  // Total missing-rate rows across all rolled-up sums (for the warning badge).
  const missingTotal = rollup
    ? toNum(rollup.missing_rate.award) +
      toNum(rollup.missing_rate.po) +
      toNum(rollup.missing_rate.contract) +
      toNum(rollup.missing_rate.savings)
    : 0;

  // Award ranking — VND rollup (already sorted DESC) when ON, else per-currency.
  const awardSorted = rollupOn
    ? [...(a.award_by_vendor_vnd ?? [])]
        .map((v) => ({ name: v.vendor_name, amount: toNum(v.amount) }))
        .slice(0, TOP_N)
    : [...(activeAwardGroup?.vendors ?? [])]
        .map((v) => ({ name: v.vendor_name, amount: toNum(v.amount) }))
        .sort((x, y) => y.amount - x.amount)
        .slice(0, TOP_N);
  const awardMax = awardSorted.reduce((m, v) => Math.max(m, v.amount), 0);
  // Currency label for the award ranking bars (VND when rolled up).
  const awardCcyLabel = rollupOn ? 'VND' : activeAwardCcy;

  return (
    <div className={cn(SHELL.page, '-m-6')}>
      {header}

      <div className={cn(SHELL.content, 'py-4', SHELL.sectionStack)}>
        {/* ── KPI rail (4) — Syne hero numbers, per-currency only ── */}
        <KpiRail cols={4}>
          {/* 1. Tổng trúng thầu — per-currency, hoặc gộp VND khi bật toggle */}
          <KpiCell
            label={rollupOn ? 'Trúng thầu · VND (gộp)' : `Trúng thầu · ${activeAwardCcy ?? '—'}`}
            display={
              rollupOn ? (
                <span className="inline-flex items-baseline">
                  {fmtAmount(rollup!.awarded_vnd, 'VND')}
                </span>
              ) : activeAwardCcy ? (
                <span className="inline-flex items-baseline">
                  {fmtAmount(awardTotal, activeAwardCcy)}
                </span>
              ) : (
                '—'
              )
            }
            tone="violet"
          />

          {/* 2. Tỷ lệ đúng hạn % + Sparkline */}
          <KpiCell
            label="Đúng hạn giao"
            display={
              otRate == null ? (
                '—'
              ) : (
                <span className="inline-flex items-baseline">
                  {safeFixed(otRate, 1)}
                  <span className="ml-0.5 font-mono text-[14px] font-semibold text-slate-400">%</span>
                </span>
              )
            }
            spark={otTrend.length > 1 ? otTrend : undefined}
            tone="emerald"
          />

          {/* 3. Tiết kiệm — per-currency, hoặc gộp VND khi bật toggle */}
          <KpiCell
            label={
              rollupOn
                ? 'Tiết kiệm · VND (gộp)'
                : `Tiết kiệm${savingsGroup ? ` · ${savingsGroup.currency}` : ''}`
            }
            display={
              rollupOn
                ? fmtAmount(rollup!.savings_vnd, 'VND')
                : savingsGroup
                  ? fmtAmount(savingsGroup.savings, savingsGroup.currency)
                  : '—'
            }
            tone="violet"
          />

          {/* 4. Chu kỳ publish → award (ngày) */}
          <KpiCell
            label="Chu kỳ chốt thầu"
            display={
              cyc && toNum(cyc.n) > 0 ? (
                <span className="inline-flex items-baseline">
                  {safeFixed(cyc.avg_days, 1)}
                  <span className="ml-1 text-[13px] font-semibold text-slate-400">ngày</span>
                </span>
              ) : (
                '—'
              )
            }
            tone="slate"
          />
        </KpiRail>

        {/* KPI footnotes — secondary context demoted under the rail */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <p className="font-mono text-[11px] text-slate-400">
            {activeAwardCcy ? 'Tổng giá trị thắng thầu trong nhóm tiền' : '—'}
          </p>
          <p className="font-mono text-[11px] text-slate-400">
            {ot ? `${toNum(ot.on_time)}/${toNum(ot.total)} PO` : 'Chưa đủ dữ liệu'}
          </p>
          <p className="font-mono text-[11px] text-slate-400">Coverage {savingsCovered}</p>
          <p className="font-mono text-[11px] text-slate-400">
            {cyc && toNum(cyc.n) > 0
              ? `Trung vị ${safeFixed(cyc.median_days, 0)}d · n=${toNum(cyc.n)}`
              : 'Chưa đủ dữ liệu'}
          </p>
        </div>

        {/* #13 — missing-rate warning when rolling up to VND */}
        {rollupOn && missingTotal > 0 && (
          <p className="font-mono text-[11px] text-amber-600">
            ⚠ {missingTotal} dòng thiếu tỷ giá tại ngày mốc — chưa tính vào tổng VND
          </p>
        )}

        {/* ── Row: spend trend + funnel ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DataPanel
            eyebrow={vnd ? 'Đã quy về VND (read-time)' : 'Không quy đổi'}
            title="Chi tiêu mua sắm theo tháng"
            actions={
              <CurrencySwitch
                options={spendCurrencies}
                value={activeSpendCcy ?? ''}
                onChange={setSpendCcy}
              />
            }
          >
            {spendData.length === 0 ? (
              <EmptyHint />
            ) : (
              <LineAreaChart
                data={spendData}
                xKey="month"
                yKeys={['spend']}
                colors={[BRAND]}
                height={300}
              />
            )}
          </DataPanel>

          <DataPanel
            eyebrow="Mời → Đã xem → Báo giá → Trúng thầu"
            title="Phễu báo giá"
          >
            {funnelStages.length === 0 || funnelInvited === 0 ? (
              <EmptyHint />
            ) : (
              <div className="space-y-3 pt-1">
                {funnelStages.map((stage) => {
                  const pct = funnelInvited > 0 ? (stage.value / funnelInvited) * 100 : 0;
                  return (
                    <div key={stage.name}>
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="font-medium text-slate-600">{stage.name}</span>
                        <span className="font-mono tabular-nums text-slate-500">
                          {stage.value.toLocaleString('vi-VN')}
                          <span className="ml-1 text-slate-300">· {safeFixed(pct, 0)}%</span>
                        </span>
                      </div>
                      <div className="h-5 w-full overflow-hidden rounded-md bg-slate-100">
                        <div
                          className="h-full rounded-md transition-all"
                          style={{
                            width: `${Math.max(pct, stage.value > 0 ? 2 : 0)}%`,
                            backgroundColor: stage.final ? BRAND : SLATE_500,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DataPanel>
        </div>

        {/* ── Row: batches by status (donut) + award by vendor (bars) ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DataPanel title="Phiên đấu thầu theo trạng thái">
            {statusData.length === 0 ? (
              <EmptyHint />
            ) : (
              <DonutChart
                data={statusData}
                nameKey="name"
                valueKey="value"
                colors={SLATE_RAMP}
                height={300}
              />
            )}
          </DataPanel>

          <DataPanel
            eyebrow={
              rollupOn
                ? `Top ${TOP_N} · gộp VND read-time (đã loại re-award)`
                : `Top ${TOP_N} · nhóm tiền ${activeAwardCcy ?? '—'} (đã loại re-award)`
            }
            title={rollupOn ? 'Trúng thầu theo NCC · VND (gộp)' : 'Trúng thầu theo NCC'}
            actions={
              rollupOn ? undefined : (
                <CurrencySwitch
                  options={awardCurrencies}
                  value={activeAwardCcy ?? ''}
                  onChange={setAwardCcy}
                />
              )
            }
          >
            {awardSorted.length === 0 ? (
              <EmptyHint />
            ) : (
              // ONE brand highlight (top vendor) vs slate-300 for the rest.
              <div className="space-y-2.5 pt-1">
                {awardSorted.map((v, i) => {
                  const pct = awardMax > 0 ? (v.amount / awardMax) * 100 : 0;
                  return (
                    <div key={`${v.name}-${i}`} className="flex items-center gap-3">
                      <span
                        className="w-28 shrink-0 truncate text-[12px] text-slate-600"
                        title={v.name}
                      >
                        {v.name}
                      </span>
                      <div className="h-5 flex-1 overflow-hidden rounded-md bg-slate-100">
                        <div
                          className="h-full rounded-md"
                          style={{
                            width: `${Math.max(pct, v.amount > 0 ? 2 : 0)}%`,
                            backgroundColor: i === 0 ? BRAND : SLATE_300,
                          }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right font-mono text-[12px] tabular-nums text-slate-500">
                        {awardCcyLabel ? fmtAmount(v.amount, awardCcyLabel) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </DataPanel>
        </div>

        {/* ── Row: cycle-time stat tiles + savings tile ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <DataPanel
            eyebrow={cyc && toNum(cyc.n) > 0 ? `Mẫu n=${toNum(cyc.n)} phiên` : undefined}
            title="Chu kỳ publish → award"
            className="lg:col-span-2"
          >
            {!cyc || toNum(cyc.n) === 0 ? (
              <EmptyHint>Chưa đủ dữ liệu</EmptyHint>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <CycleTile label="Trung bình" value={safeFixed(cyc.avg_days, 1)} n={toNum(cyc.n)} />
                <CycleTile label="Trung vị" value={safeFixed(cyc.median_days, 1)} n={toNum(cyc.n)} />
                <CycleTile label="P90" value={safeFixed(cyc.p90_days, 1)} n={toNum(cyc.n)} />
                <CycleTile label="Nhanh nhất" value={safeFixed(cyc.min_days, 1)} n={toNum(cyc.n)} />
              </div>
            )}
          </DataPanel>

          <DataPanel
            eyebrow={
              rollupOn
                ? 'Gộp VND read-time — target & giá trúng cùng tỷ giá'
                : 'So với báo giá thấp nhất đủ điều kiện'
            }
            title={rollupOn ? 'Tiết kiệm đấu thầu · VND (gộp)' : 'Tiết kiệm đấu thầu'}
          >
            {rollupOn ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 ring-1 ring-inset ring-brand-100">
                    <PiggyBank className="h-5 w-5 text-brand-600" />
                  </div>
                  <div>
                    <p className={TYPE.kpiValue}>{fmtAmount(rollup!.savings_vnd, 'VND')}</p>
                    {toNum(rollup!.missing_rate.savings) > 0 && (
                      <p className="mt-0.5 font-mono text-[11px] text-amber-600">
                        ⚠ {toNum(rollup!.missing_rate.savings)} dòng thiếu tỷ giá
                      </p>
                    )}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-100">
                    <dt className="text-slate-400">Mục tiêu (baseline)</dt>
                    <dd className="mt-0.5 font-mono font-semibold tabular-nums text-slate-700">
                      {fmtAmount(rollup!.baseline_vnd, 'VND')}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-100">
                    <dt className="text-slate-400">Giá trúng</dt>
                    <dd className="mt-0.5 font-mono font-semibold tabular-nums text-slate-700">
                      {fmtAmount(rollup!.awarded_vnd_from_savings, 'VND')}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : !savingsGroup ? (
              <EmptyHint />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 ring-1 ring-inset ring-brand-100">
                    <PiggyBank className="h-5 w-5 text-brand-600" />
                  </div>
                  <div>
                    <p className={TYPE.kpiValue}>
                      {fmtAmount(savingsGroup.savings, savingsGroup.currency)}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                      Coverage {savingsCovered}
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-100">
                    <dt className="text-slate-400">Báo giá thấp nhất</dt>
                    <dd className="mt-0.5 font-mono font-semibold tabular-nums text-slate-700">
                      {fmtAmount(savingsGroup.baseline, savingsGroup.currency)}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-100">
                    <dt className="text-slate-400">Giá trúng</dt>
                    <dd className="mt-0.5 font-mono font-semibold tabular-nums text-slate-700">
                      {fmtAmount(savingsGroup.awarded, savingsGroup.currency)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </DataPanel>
        </div>

        {/* ── Row: #17 delivery-due cockpit (INTERNAL) — PO sắp / đã trễ hạn giao ── */}
        <DeliveryDuePanel dd={a.delivery_due} />
      </div>
    </div>
  );
}

// ─── #17 Delivery-due panel — PO mở sắp / đã quá hạn giao (INTERNAL) ─
// Per-currency invariant kept: NO money here, only delivery progress (% SL).
// RESTRAINT: ONE brand + slate + rose/amber status dots. No gradient/orb.
function DeliveryDuePanel({ dd }: { dd: DeliveryDue | null }) {
  const items = dd?.items ?? [];
  const overdue = toNum(dd?.overdue_count);
  const dueSoon = toNum(dd?.due_soon_count);
  return (
    <DataPanel
      eyebrow={`Trong ${toNum(dd?.window_days) || 14} ngày tới`}
      title="PO sắp / đã trễ hạn giao"
      actions={
        items.length > 0 ? (
          <div className="flex items-center gap-2 text-[12px]">
            {overdue > 0 && (
              <span className="font-semibold text-rose-600">{overdue} quá hạn</span>
            )}
            {overdue > 0 && dueSoon > 0 && <span className="text-slate-300">·</span>}
            {dueSoon > 0 && <span className="text-amber-600">{dueSoon} sắp hạn</span>}
          </div>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <EmptyHint>Không có PO sắp tới hạn</EmptyHint>
      ) : (
        <div className="divide-y divide-slate-100">
          {items.map((it) => {
            const dr = toNum(it.days_remaining);
            const isOverdue = it.severity === 'overdue';
            const dateLabel = it.requested_delivery_date
              ? new Date(it.requested_delivery_date).toLocaleDateString('vi-VN')
              : '—';
            const Row = (
              <div className="flex items-center gap-3 py-2.5">
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    isOverdue ? 'bg-rose-500' : 'bg-amber-500',
                  )}
                />
                <span className="w-32 shrink-0 truncate font-mono text-[12px] text-slate-700">
                  {it.po_no}
                </span>
                <span className="flex-1 truncate text-[12px] text-slate-500" title={it.vendor_name}>
                  {it.vendor_name}
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-400">
                  {it.progress_pct == null ? '—' : `${safeFixed(it.progress_pct, 0)}%`}
                </span>
                <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-400">
                  {dateLabel}
                </span>
                <span
                  className={cn(
                    'w-16 shrink-0 text-right text-[12px] font-semibold tabular-nums',
                    isOverdue ? 'text-rose-600' : 'text-amber-600',
                  )}
                >
                  {isOverdue ? `Trễ ${Math.abs(dr)}d` : `Còn ${dr}d`}
                </span>
              </div>
            );
            return it.batch_id ? (
              <a
                key={it.po_id}
                href={`/vendor-bidding/${it.batch_id}`}
                className="-mx-2 block rounded-md px-2 hover:bg-slate-50"
              >
                {Row}
              </a>
            ) : (
              <div key={it.po_id} className="-mx-2 px-2">
                {Row}
              </div>
            );
          })}
        </div>
      )}
    </DataPanel>
  );
}

// ─── Cycle-time stat tile (every tile shows its n=) ─────────────────
function CycleTile({
  label,
  value,
  n,
}: {
  label: string;
  value: string;
  n: number;
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-3 text-center ring-1 ring-inset ring-slate-100">
      <p className={TYPE.eyebrow}>{label}</p>
      <p className="mt-1 font-display text-[20px] font-bold tabular-nums text-slate-900">{value}</p>
      <p className="mt-0.5 font-mono text-[11px] text-slate-400">ngày · n={n}</p>
    </div>
  );
}
