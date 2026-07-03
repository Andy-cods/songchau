'use client';

// Thang 2026-06-04: Full rewrite — "Xu hướng giá kinh doanh đa mã, đa khách".
// Restrained palette: white cards, slate text, indigo `brand` token,
// emerald/amber/rose status, sky for customer axis. No rainbow gradients,
// no decorative orbs, no top accent stripes. Series colors limited to the
// shared chart-colors tokens (brand + info/success/warning/danger + neutral).

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bell,
  ChevronDown,
  Loader2,
  Minus,
  Plus,
  RefreshCcw,
  Search,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CHART } from '@/lib/chart-colors';
import { useUrlState } from '@/hooks/useUrlState';
import { ExportButton } from '@/components/analytics/ExportButton';

// Code-splitting (W3-16): CodeHistoryDrawer itself pulls in recharts (778
// lines) — deferring it removes that whole chunk from this route's
// first-load JS. Kept unconditionally rendered below (unchanged from
// before) so component lifecycle/state (e.g. forecastMode) behaves
// identically; the drawer already renders null while `code` is falsy.
const CodeHistoryDrawer = dynamic(
  () => import('@/components/analytics/CodeHistoryDrawer').then((m) => m.CodeHistoryDrawer),
  { ssr: false, loading: () => null },
);

// The 4 inline charts below live in PriceTrendCharts.tsx so recharts can be
// deferred via dynamic(ssr:false) — they're wrapped in <div ref={xxxRef}>
// (unchanged, still in this page) so <ExportButton chartRef> screenshotting
// keeps working exactly as before.
const MultiSeriesLineChart = dynamic(
  () => import('./PriceTrendCharts').then((m) => m.MultiSeriesLineChart),
  { ssr: false, loading: () => <div className="h-[320px] w-full animate-pulse rounded-lg bg-slate-100" /> },
);
const RoleLineChart = dynamic(
  () => import('./PriceTrendCharts').then((m) => m.RoleLineChart),
  { ssr: false, loading: () => <div className="h-[300px] w-full animate-pulse rounded-lg bg-slate-100" /> },
);
const CustomerLineChart = dynamic(
  () => import('./PriceTrendCharts').then((m) => m.CustomerLineChart),
  { ssr: false, loading: () => <div className="h-[260px] w-full animate-pulse rounded-lg bg-slate-100" /> },
);
const SupplierLineChart = dynamic(
  () => import('./PriceTrendCharts').then((m) => m.SupplierLineChart),
  { ssr: false, loading: () => <div className="h-[260px] w-full animate-pulse rounded-lg bg-slate-100" /> },
);

// ──────────────────────────────────────────────────────────────────────────
// Restrained series palette — only these 6 colors used for chart lines.
// ──────────────────────────────────────────────────────────────────────────
const SERIES_COLORS = [
  CHART.brand,    // brand — primary series
  CHART.info,     // info — customer axis
  CHART.success,  // success — healthy / second compare
  CHART.warning,  // warning — watch
  CHART.danger,   // danger — alert / spike
  CHART.neutral,  // neutral — fallback
];

const MARKET_DASH = CHART.neutral; // slate dashed — market overlay

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────
interface KpiPayload {
  data: {
    gmv_quote_month_vnd: number | null;
    gmv_quote_delta_pct: number | null;
    win_rate_pct: number | null;
    win_rate_delta_pct: number | null;
    volatile_code_count: number;
    margin_squeeze_customer_count: number;
    avg_margin_pct: number | null;
    median_sale_vnd: number | null;
    top_customer_name: string | null;
    top_customer_gmv_vnd: number | null;
  };
}

interface MultiSeriesPoint {
  month_key: string;
  [code: string]: number | string | null;
}
interface MultiSeriesResponse {
  data: {
    months: string[];
    codes: string[];
    series: MultiSeriesPoint[];
    market_median: MultiSeriesPoint[];
  };
}

interface CustomerSeriesResponse {
  data: {
    months: string[];
    customers: string[];
    series: MultiSeriesPoint[];
  };
}

interface SupplierSeriesResponse {
  data: {
    months: string[];
    suppliers: string[];
    series: MultiSeriesPoint[];
  };
}

// Xu hướng giá theo VAI TRÒ (price_role) — 1 đường / role, đọc
// v_price_observations_clean. Series phẳng: mỗi phần tử = 1 tháng.
type PriceRole = 'quote_v1' | 'market_xnk' | 'cost_ncc' | 'sale_sourcing' | 'imv_buy';
interface RoleSeriesResponse {
  data: {
    months: string[];
    codes: string[];
    roles: string[];
    series: MultiSeriesPoint[];
  };
}
const ROLE_META: Record<PriceRole, { label: string; color: string }> = {
  quote_v1: { label: 'Mình chào (V1)', color: CHART.brand },
  market_xnk: { label: 'Thị trường (XNK)', color: CHART.info },
  cost_ncc: { label: 'Giá vốn (NCC)', color: CHART.success },
  sale_sourcing: { label: 'Giá bán (Nguồn cung)', color: CHART.warning },
  imv_buy: { label: 'IMV mua', color: CHART.danger },
};
const ROLE_KEYS_FE: PriceRole[] = [
  'quote_v1',
  'market_xnk',
  'cost_ncc',
  'sale_sourcing',
  'imv_buy',
];

interface VolatilityRow {
  bqms_code: string;
  product_name?: string | null;
  rfq_count: number;
  median_v1: number | null;
  min_v1: number | null;
  max_v1: number | null;
  stddev_pct: number | null;
  last_seen: string | null;
}
interface VolatilityResponse {
  data: VolatilityRow[];
}

// Radar — mã Samsung hay hỏi theo chu kỳ; dự đoán lần hỏi tiếp theo.
type RadarStatus = 'overdue' | 'due_soon' | 'on_track' | 'unknown';
interface RadarRow {
  bqms_code: string;
  product_name: string | null;
  customer: string | null;
  ask_count: number;
  first_inquiry: string | null;
  last_inquiry: string | null;
  cadence_days: number | null;
  days_since_last: number | null;
  due_ratio: number | null;
  status: RadarStatus;
  next_expected_date: string | null;
  has_cost: boolean;
  has_sourcing: boolean;
  last_v1_vnd: number | null;
}
interface RepeatRadarResponse {
  data: {
    generated_at: string;
    count: number;
    rows: RadarRow[];
  };
}

interface MonthlyTrendRow {
  month_key: string;
  rfq_count: number;
  median_v1_vnd: number | null;
  market_median_vnd: number | null;
}
interface MonthlyTrendResponse {
  data: MonthlyTrendRow[];
}

interface FreshCodeRow {
  bqms_code: string;
  first_inquiry_date: string | null;
  customer: string | null;
  product_name: string | null;
  suggested_market_median_usd: number | null;
  urgency: 'high' | 'medium' | 'low';
}
interface FreshCodesResponse {
  data: FreshCodeRow[];
}

interface MatchedBqmsRow {
  bqms_code: string;
  our_v1_usd: number | null;
  market_median_usd: number | null;
  gap_pct: number | null;
  result: 'won' | 'lost' | 'pending';
  customer: string | null;
  suggested_action_vi: string | null;
  n_quotes?: number;
  n_market?: number;
}
interface MatchedBqmsResponse {
  data: MatchedBqmsRow[];
}

interface CodeOption {
  bqms_code: string;
  specification?: string | null;
  rfq_count?: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Format helpers
// ──────────────────────────────────────────────────────────────────────────
function fmtCount(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('vi-VN');
}
function fmtMoneyShort(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} tỷ ₫`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M ₫`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K ₫`;
  return `${v.toLocaleString('vi-VN')} ₫`;
}
function fmtMoneyFull(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${Math.round(v).toLocaleString('vi-VN')} ₫`;
}
function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}%`;
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('vi-VN');
}
function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `$${Number(v).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
function fmtMonth(key: string): string {
  if (!key) return '—';
  const [year, month] = key.split('-');
  return `T${parseInt(month, 10)}/${year.slice(2)}`;
}

// Index normalization: divide each series by its first non-null value, ×100.
function normalizeIndex(series: MultiSeriesPoint[], keys: string[]): MultiSeriesPoint[] {
  const safeSeries = Array.isArray(series) ? series : [];
  const safeKeys = Array.isArray(keys) ? keys : [];
  const bases: Record<string, number> = {};
  for (const k of safeKeys) {
    const first = safeSeries.find((p) => typeof p[k] === 'number' && (p[k] as number) > 0);
    if (first) bases[k] = first[k] as number;
  }
  return safeSeries.map((p) => {
    const out: MultiSeriesPoint = { month_key: p.month_key };
    for (const k of safeKeys) {
      const v = p[k];
      out[k] = typeof v === 'number' && bases[k] ? (v / bases[k]) * 100 : null;
    }
    return out;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────
export default function PriceTrendsPage() {
  // URL-shareable filters — Thang 2026-06-04.
  //   /analytics/price-trends?months=24&codes=BQ1,BQ2&customers=SDV,SEHC&absolute=1
  // `absolute=1` flips indexMode to false (Tuyệt đối view). Default Index 100
  // keeps the URL clean (no flag).
  const [months, setMonths] = useUrlState<number>('months', 12);
  const [selectedCodes, setSelectedCodes] = useUrlState<string[]>('codes', []);
  const [selectedCustomers, setSelectedCustomers] = useUrlState<string[]>('customers', []);
  const [indexMode, setIndexMode] = useUrlState<boolean>('absolute', true, {
    // Stored inverted: omit when default (index on), write `absolute=1`
    // only when user switches to absolute mode.
    serialize: (v) => (v ? null : '1'),
    deserialize: (raw) => raw == null,
  });
  const [activeTab, setActiveTab] = useState<'fresh' | 'matched'>('fresh');
  const [filterText, setFilterText] = useState('');
  const searchTerm = useDeferredValue(filterText.trim().toLowerCase());
  const [drilldownCode, setDrilldownCode] = useState<string | null>(null);

  // Refs for PNG export (one per panel)
  const kpiRef = useRef<HTMLDivElement>(null);
  const multiSeriesRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);
  const customerRef = useRef<HTMLDivElement>(null);
  const supplierRef = useRef<HTMLDivElement>(null);
  const volatilityRef = useRef<HTMLDivElement>(null);
  const radarRef = useRef<HTMLDivElement>(null);

  // KPI strip
  const kpiQ = useQuery<KpiPayload>({
    queryKey: ['pt-kpi', months],
    queryFn: () => api.get(`/api/v1/analytics/price-trends/kpi?months=${months}`),
    retry: false,
  });
  const kpi = kpiQ.data?.data;

  // Volatility ranking (also acts as code suggestion source)
  const volQ = useQuery<VolatilityResponse>({
    queryKey: ['pt-volatility', months],
    queryFn: () => api.get(`/api/v1/analytics/price-trends/volatility?months=${months}&limit=50`),
    retry: false,
  });
  const volatility = volQ.data?.data ?? [];

  // Auto-seed up to 4 codes from volatility on first load if none picked
  useEffect(() => {
    if (selectedCodes.length === 0 && volatility.length > 0) {
      setSelectedCodes(volatility.slice(0, 4).map((r) => r.bqms_code));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volatility.length]);

  // Multi-series compare chart
  const codesParam = selectedCodes.join(',');
  const customersParam = selectedCustomers.join(',');

  // Safe query-string builder — uses URLSearchParams so special chars in codes
  // are escaped exactly once and empty params are simply omitted.
  const buildQs = (params: Record<string, string | number | undefined | null>) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v == null) return;
      const s = String(v);
      if (s === '') return;
      sp.set(k, s);
    });
    return sp.toString();
  };

  const multiSeriesQ = useQuery<MultiSeriesResponse>({
    queryKey: ['pt-multi', months, codesParam],
    queryFn: () =>
      api.get(
        `/api/v1/analytics/price-trends/multi-series?${buildQs({
          months,
          codes: codesParam,
        })}`,
      ),
    enabled: selectedCodes.length > 0,
    retry: false,
  });
  const multiData = multiSeriesQ.data?.data;

  // Xu hướng giá theo VAI TRÒ (price_role) — tái dùng codes + months.
  const [activeRoles, setActiveRoles] = useState<PriceRole[]>(ROLE_KEYS_FE);
  const byRoleQ = useQuery<RoleSeriesResponse>({
    queryKey: ['pt-by-role', months, codesParam],
    queryFn: () =>
      api.get(
        `/api/v1/analytics/price-trends/by-role?${buildQs({
          months,
          codes: codesParam,
        })}`,
      ),
    enabled: selectedCodes.length > 0,
    retry: false,
  });
  const byRole = byRoleQ.data?.data;
  const roleChartData = useMemo(() => {
    if (!byRole) return [] as MultiSeriesPoint[];
    const series = Array.isArray(byRole.series) ? byRole.series : [];
    return series.map((p) => ({ ...p, month_label: fmtMonth(p.month_key as string) }));
  }, [byRole]);
  const toggleRole = (role: PriceRole) =>
    setActiveRoles((rs) => (rs.includes(role) ? rs.filter((r) => r !== role) : [...rs, role]));

  // Customer split
  const byCustomerQ = useQuery<CustomerSeriesResponse>({
    queryKey: ['pt-by-customer', months, codesParam, customersParam],
    queryFn: () =>
      api.get(
        `/api/v1/analytics/price-trends/by-customer?${buildQs({
          months,
          codes: codesParam,
          customers: customersParam,
        })}`,
      ),
    enabled: selectedCodes.length > 0,
    retry: false,
  });
  const byCustomer = byCustomerQ.data?.data;

  // Supplier split
  const bySupplierQ = useQuery<SupplierSeriesResponse>({
    queryKey: ['pt-by-supplier', months, codesParam],
    queryFn: () =>
      api.get(
        `/api/v1/analytics/price-trends/by-supplier?${buildQs({
          months,
          codes: codesParam,
        })}`,
      ),
    enabled: selectedCodes.length > 0,
    retry: false,
  });
  const bySupplier = bySupplierQ.data?.data;

  // XNK market overlay (single dashed series on main chart)
  const xnkQ = useQuery<MonthlyTrendResponse>({
    queryKey: ['pt-xnk', months],
    queryFn: () => api.get(`/api/v1/xnk/analytics/monthly-trend?months=${months}`),
    retry: false,
  });
  const xnk = xnkQ.data?.data ?? [];

  // Fresh codes (last 14 days, never seen in prior 90d)
  const freshQ = useQuery<FreshCodesResponse>({
    queryKey: ['pt-fresh-14d'],
    queryFn: () => api.get(`/api/v1/analytics/price-trends/fresh-codes-14d?limit=200`),
    retry: false,
  });
  const freshRows = freshQ.data?.data ?? [];

  // Matched BQMS (V1 nội bộ + XNK market + result)
  const matchedQ = useQuery<MatchedBqmsResponse>({
    queryKey: ['pt-matched', months],
    queryFn: () =>
      api.get(`/api/v1/analytics/price-trends/matched-bqms?months=${months}&limit=200`),
    retry: false,
  });
  const matchedRows = matchedQ.data?.data ?? [];

  // Repeat-RFQ radar — mã Samsung hay hỏi theo chu kỳ, dự đoán lần hỏi tới.
  const radarQ = useQuery<RepeatRadarResponse>({
    queryKey: ['pt-repeat-radar'],
    queryFn: () =>
      api.get(`/api/v1/analytics/price-trends/repeat-rfq-radar?limit=100&min_asks=3`),
    retry: false,
  });
  const radarRows = radarQ.data?.data?.rows ?? [];

  // ──────────────────────────────────────────────────────────────────────
  // Derived chart data
  // ──────────────────────────────────────────────────────────────────────
  const multiChartData = useMemo(() => {
    if (!multiData) return [] as MultiSeriesPoint[];
    const codes = Array.isArray(multiData.codes) ? multiData.codes : selectedCodes;
    const raw = Array.isArray(multiData.series) ? multiData.series : [];
    // Merge in market overlay by month_key as "__market"
    const marketMap = new Map<string, number | null>();
    const xnkRows = Array.isArray(xnk) ? xnk : [];
    for (const row of xnkRows) marketMap.set(row.month_key, row.market_median_vnd ?? null);

    const merged: MultiSeriesPoint[] = raw.map((p) => ({
      ...p,
      __market: marketMap.get(p.month_key as string) ?? null,
    }));

    if (indexMode) {
      const norm = normalizeIndex(merged, [...(codes ?? []), '__market']);
      return norm.map((p) => ({ ...p, month_label: fmtMonth(p.month_key as string) }));
    }
    return merged.map((p) => ({ ...p, month_label: fmtMonth(p.month_key as string) }));
  }, [multiData, xnk, indexMode, selectedCodes]);

  const customerChartData = useMemo(() => {
    if (!byCustomer) return [] as MultiSeriesPoint[];
    const series = Array.isArray(byCustomer.series) ? byCustomer.series : [];
    return series.map((p) => ({
      ...p,
      month_label: fmtMonth(p.month_key as string),
    }));
  }, [byCustomer]);

  const supplierChartData = useMemo(() => {
    if (!bySupplier) return [] as MultiSeriesPoint[];
    const series = Array.isArray(bySupplier.series) ? bySupplier.series : [];
    return series.map((p) => ({
      ...p,
      month_label: fmtMonth(p.month_key as string),
    }));
  }, [bySupplier]);

  const filteredVolatility = useMemo(() => {
    if (!searchTerm) return volatility;
    return volatility.filter((r) => r.bqms_code.toLowerCase().includes(searchTerm));
  }, [volatility, searchTerm]);

  const filteredFresh = useMemo(() => {
    if (!searchTerm) return freshRows;
    return freshRows.filter(
      (r) =>
        r.bqms_code.toLowerCase().includes(searchTerm) ||
        (r.customer ?? '').toLowerCase().includes(searchTerm) ||
        (r.product_name ?? '').toLowerCase().includes(searchTerm),
    );
  }, [freshRows, searchTerm]);

  // Matched: sort by |gap_pct| DESC then take top 50, with pagination
  const sortedMatched = useMemo(() => {
    const filtered = !searchTerm
      ? matchedRows
      : matchedRows.filter(
          (r) =>
            r.bqms_code.toLowerCase().includes(searchTerm) ||
            (r.customer ?? '').toLowerCase().includes(searchTerm),
        );
    const copy = [...filtered];
    copy.sort((a, b) => Math.abs(b.gap_pct ?? 0) - Math.abs(a.gap_pct ?? 0));
    return copy;
  }, [matchedRows, searchTerm]);

  const [matchedPage, setMatchedPage] = useState(0);
  const MATCHED_PAGE_SIZE = 50;
  const matchedPageCount = Math.max(1, Math.ceil(sortedMatched.length / MATCHED_PAGE_SIZE));
  const matchedPageRows = useMemo(
    () =>
      sortedMatched.slice(
        matchedPage * MATCHED_PAGE_SIZE,
        matchedPage * MATCHED_PAGE_SIZE + MATCHED_PAGE_SIZE,
      ),
    [sortedMatched, matchedPage],
  );
  useEffect(() => {
    // Reset to first page if filter shrinks the set below current page
    if (matchedPage > 0 && matchedPage >= matchedPageCount) setMatchedPage(0);
  }, [matchedPageCount, matchedPage]);

  const refreshAll = () => {
    kpiQ.refetch();
    volQ.refetch();
    multiSeriesQ.refetch();
    byRoleQ.refetch();
    byCustomerQ.refetch();
    bySupplierQ.refetch();
    xnkQ.refetch();
    freshQ.refetch();
    matchedQ.refetch();
    radarQ.refetch();
  };

  // Helper to push a code into compare from the Fresh/Matched tables.
  const addCompareCode = (code: string) =>
    setSelectedCodes((s) => (s.includes(code) || s.length >= 6 ? s : [...s, code]));

  const isLoading =
    kpiQ.isLoading ||
    volQ.isLoading ||
    multiSeriesQ.isLoading ||
    byCustomerQ.isLoading ||
    bySupplierQ.isLoading ||
    freshQ.isLoading ||
    matchedQ.isLoading ||
    radarQ.isLoading;

  return (
    <div className="space-y-4">
      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-brand-600" strokeWidth={2.5} />
              <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">
                Xu hướng giá kinh doanh
              </h1>
              <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-brand-700 ring-1 ring-brand-200">
                đa mã · đa khách
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              So sánh tối đa 6 mã BQMS, đối chiếu giá TT XNK và khách hàng Samsung theo tháng.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MonthRangePicker value={months} onChange={setMonths} />
            <CodePicker
              selected={selectedCodes}
              onChange={setSelectedCodes}
              suggestions={volatility.map((v) => ({ bqms_code: v.bqms_code, rfq_count: v.rfq_count }))}
            />
            <CustomerPicker
              selected={selectedCustomers}
              onChange={setSelectedCustomers}
              suggestions={Array.isArray(byCustomer?.customers) ? byCustomer!.customers : []}
            />
            <button
              onClick={refreshAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-700"
            >
              <RefreshCcw
                className={cn(
                  'h-3.5 w-3.5',
                  (kpiQ.isFetching || volQ.isFetching || multiSeriesQ.isFetching) && 'animate-spin',
                )}
              />
              Tải lại
            </button>
          </div>
        </div>
      </header>

      {/* ── KPI strip ── */}
      <div className="relative">
        <div className="absolute -top-1 right-0 z-10">
          <ExportButton
            scope="price-trends"
            panel="kpi-strip"
            filters={{ months, selectedCodes, selectedCustomers }}
            chartRef={kpiRef}
            label="Xuất KPI"
          />
        </div>
      <section ref={kpiRef} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="GMV chào tháng này"
          value={fmtMoneyShort(kpi?.gmv_quote_month_vnd)}
          deltaPct={kpi?.gmv_quote_delta_pct}
          subtitle="Tổng giá bán đã chốt trong tháng"
          tone="brand"
          icon={<TrendingUp className="h-3.5 w-3.5" />}
        />
        <KpiCard
          label="Tỷ lệ trúng"
          value={fmtPct(kpi?.win_rate_pct)}
          deltaPct={kpi?.win_rate_delta_pct}
          subtitle={`Margin TB ${fmtPct(kpi?.avg_margin_pct)}`}
          tone="emerald"
        />
        <KpiCard
          label="Mã biến động cao"
          value={fmtCount(kpi?.volatile_code_count)}
          subtitle={`Biến động CV>30% trong ${months} tháng`}
          tone="amber"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
        />
        <KpiCard
          label="Khách đang co biên"
          value={fmtCount(kpi?.margin_squeeze_customer_count)}
          subtitle={
            kpi?.top_customer_name
              ? `Top: ${kpi.top_customer_name} · ${fmtMoneyShort(kpi.top_customer_gmv_vnd)}`
              : 'Chưa có dữ liệu PO'
          }
          tone="rose"
          icon={<Users className="h-3.5 w-3.5" />}
        />
      </section>
      </div>

      {/* ── Active selection chips ── */}
      {(selectedCodes.length > 0 || selectedCustomers.length > 0) && (
        <SelectionChips
          codes={selectedCodes}
          customers={selectedCustomers}
          onRemoveCode={(c) => setSelectedCodes((s) => s.filter((x) => x !== c))}
          onRemoveCustomer={(c) => setSelectedCustomers((s) => s.filter((x) => x !== c))}
          onClear={() => {
            setSelectedCodes([]);
            setSelectedCustomers([]);
          }}
        />
      )}

      {/* ── Main multi-series chart ── */}
      <Panel
        title="Biểu đồ đa mã — giá V1 trung vị theo tháng"
        subtitle={
          indexMode
            ? 'Index 100 = tháng đầu (so sánh hình dạng xu hướng giữa các mã)'
            : 'Giá tuyệt đối (₫) — chỉ so sánh được khi cùng dải giá'
        }
        loading={multiSeriesQ.isFetching}
        right={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setIndexMode(true)}
                className={cn(
                  'rounded-md px-2 py-1 transition',
                  indexMode ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                Index 100
              </button>
              <button
                type="button"
                onClick={() => setIndexMode(false)}
                className={cn(
                  'rounded-md px-2 py-1 transition',
                  !indexMode ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                Tuyệt đối
              </button>
            </div>
            <ExportButton
              scope="price-trends"
              panel="multi-series"
              filters={{ months, selectedCodes, indexMode }}
              chartRef={multiSeriesRef}
            />
          </div>
        }
      >
        <div ref={multiSeriesRef}>
        {selectedCodes.length === 0 ? (
          <EmptyBlock label='Chọn 1-6 mã BQMS ở header (nút "So sánh mã") để bắt đầu.' />
        ) : multiChartData.length === 0 ? (
          <EmptyBlock />
        ) : (
          <MultiSeriesLineChart data={multiChartData} indexMode={indexMode} selectedCodes={selectedCodes} />
        )}
        <Legend codes={selectedCodes} showMarket />
        </div>
      </Panel>

      {/* ── Giá theo vai trò (price_role) ── */}
      <Panel
        title="Giá theo vai trò"
        subtitle="Median theo tháng cho từng vai trò giá (Mình chào / Thị trường / Giá vốn / Giá bán / IMV) — bật/tắt đường bên phải"
        loading={byRoleQ.isFetching}
        right={
          <div className="flex flex-wrap items-center gap-1.5">
            {ROLE_KEYS_FE.map((role) => {
              const on = activeRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset transition',
                    on
                      ? 'bg-white text-slate-700 ring-slate-300'
                      : 'bg-slate-50 text-slate-400 ring-slate-200 line-through',
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: on ? ROLE_META[role].color : '#cbd5e1' }}
                  />
                  {ROLE_META[role].label}
                </button>
              );
            })}
            <ExportButton
              scope="price-trends"
              panel="by-role"
              filters={{ months, selectedCodes, activeRoles }}
              chartRef={roleRef}
            />
          </div>
        }
      >
        <div ref={roleRef}>
          {selectedCodes.length === 0 ? (
            <EmptyBlock label='Chọn 1-6 mã BQMS ở header (nút "So sánh mã") để xem giá theo vai trò.' />
          ) : roleChartData.length === 0 || activeRoles.length === 0 ? (
            <EmptyBlock label="Chưa có dữ liệu giá theo vai trò cho các mã đã chọn." />
          ) : (
            <RoleLineChart data={roleChartData} activeRoles={activeRoles} />
          )}
        </div>
      </Panel>

      {/* ── Split view: customer + supplier ── */}
      <section className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Giá theo khách hàng Samsung"
          subtitle="Mỗi đường = 1 buyer/plant — đơn giá PO trung bình theo tháng"
          loading={byCustomerQ.isFetching}
          right={
            <ExportButton
              scope="price-trends"
              panel="customer-split"
              filters={{ months, selectedCodes, selectedCustomers }}
              chartRef={customerRef}
            />
          }
        >
          <div ref={customerRef}>
          {selectedCodes.length === 0 ? (
            <EmptyBlock label="Chọn ít nhất 1 mã BQMS." />
          ) : !byCustomer ||
            !Array.isArray(byCustomer.customers) ||
            byCustomer.customers.length === 0 ? (
            <EmptyBlock label="Chưa có PO Samsung cho các mã đã chọn." />
          ) : (
            <>
              <CustomerLineChart data={customerChartData} customers={byCustomer.customers ?? []} />
              <Legend codes={(byCustomer.customers ?? []).slice(0, 6)} />
            </>
          )}
          </div>
        </Panel>

        <Panel
          title="So sánh NCC theo mã"
          subtitle="Từ sourcing_entries — sale_vnd quy đổi theo NCC × tháng"
          loading={bySupplierQ.isFetching}
          right={
            <ExportButton
              scope="price-trends"
              panel="supplier-compare"
              filters={{ months, selectedCodes }}
              chartRef={supplierRef}
            />
          }
        >
          <div ref={supplierRef}>
          {selectedCodes.length === 0 ? (
            <EmptyBlock label="Chọn ít nhất 1 mã BQMS." />
          ) : !bySupplier ||
            !Array.isArray(bySupplier.suppliers) ||
            bySupplier.suppliers.length === 0 ? (
            <EmptyBlock label="Chưa có sourcing entry cho các mã đã chọn." />
          ) : (
            <>
              <SupplierLineChart data={supplierChartData} suppliers={bySupplier.suppliers ?? []} />
              <Legend codes={(bySupplier.suppliers ?? []).slice(0, 6)} />
            </>
          )}
          </div>
        </Panel>
      </section>

      {/* ── Volatility ranking table ── */}
      <Panel
        title="Xếp hạng biến động giá"
        subtitle="Top 20 mã có độ lệch chuẩn giá V1 cao nhất — click để xem lịch sử"
        loading={volQ.isFetching}
        right={
          <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Lọc mã..."
              className="w-36 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
            />
          </label>
          <ExportButton
            scope="price-trends"
            panel="volatility-table"
            filters={{ months, filterText, selectedCodes }}
            chartRef={volatilityRef}
          />
          </div>
        }
      >
        <div ref={volatilityRef}>
        <VolatilityTable
          rows={filteredVolatility.slice(0, 20)}
          onPick={setDrilldownCode}
          onAdd={(code) =>
            setSelectedCodes((s) => (s.includes(code) || s.length >= 6 ? s : [...s, code]))
          }
          selectedCodes={selectedCodes}
          isError={volQ.isError}
        />
        </div>
      </Panel>

      {/* ── Repeat-RFQ radar ── */}
      <Panel
        title="🔔 Mã sắp được hỏi lại"
        subtitle="Dự đoán mã Samsung hay hỏi theo chu kỳ — chuẩn bị giá & nguồn cung trước"
        loading={radarQ.isFetching}
        right={
          <ExportButton
            scope="price-trends"
            panel="repeat-radar"
            filters={{}}
            chartRef={radarRef}
          />
        }
      >
        <div ref={radarRef}>
          <RepeatRadarTable
            rows={radarRows}
            onPick={setDrilldownCode}
            loading={radarQ.isFetching}
            isError={radarQ.isError}
          />
        </div>
      </Panel>

      {/* ── Tabbed alerts section ── */}
      <Panel title="Cảnh báo & nhật ký" loading={false}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TabButton
            active={activeTab === 'fresh'}
            onClick={() => setActiveTab('fresh')}
            label="Mới hỏi 14 ngày"
            count={filteredFresh.length}
            tone="amber"
          />
          <TabButton
            active={activeTab === 'matched'}
            onClick={() => setActiveTab('matched')}
            label="Match đầy đủ"
            count={sortedMatched.length}
            tone="sky"
          />
        </div>
        {activeTab === 'fresh' && (
          <FreshCodesTable
            rows={filteredFresh}
            selectedCodes={selectedCodes}
            onPick={setDrilldownCode}
            onAdd={addCompareCode}
            loading={freshQ.isFetching}
            isError={freshQ.isError}
          />
        )}
        {activeTab === 'matched' && (
          <MatchedBqmsTable
            rows={matchedPageRows}
            totalCount={sortedMatched.length}
            page={matchedPage}
            pageCount={matchedPageCount}
            pageSize={MATCHED_PAGE_SIZE}
            onPageChange={setMatchedPage}
            selectedCodes={selectedCodes}
            onPick={setDrilldownCode}
            onAdd={addCompareCode}
            loading={matchedQ.isFetching}
            isError={matchedQ.isError}
          />
        )}
      </Panel>

      <CodeHistoryDrawer code={drilldownCode} onClose={() => setDrilldownCode(null)} />

      {isLoading && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-md">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />
          Đang tính toán...
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────

function MonthRangePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold">
      {[6, 12, 24].map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            'rounded-md px-2.5 py-1 transition',
            value === m
              ? 'bg-brand-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          {m}T
        </button>
      ))}
    </div>
  );
}

function CodePicker({
  selected,
  onChange,
  suggestions,
}: {
  selected: string[];
  onChange: (codes: string[]) => void;
  suggestions: CodeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = suggestions.filter((s) => !selected.includes(s.bqms_code));
    if (!q) return base.slice(0, 20);
    return base.filter((s) => s.bqms_code.toLowerCase().includes(q)).slice(0, 20);
  }, [suggestions, selected, query]);

  const addCode = (code: string) => {
    if (selected.includes(code) || selected.length >= 6) return;
    onChange([...selected, code]);
    setQuery('');
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-semibold transition',
          selected.length > 0
            ? 'border-brand-300 text-brand-700'
            : 'border-slate-200 text-slate-700 hover:border-brand-300 hover:text-brand-700',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        So sánh mã
        <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[11px] font-bold text-brand-700">
          {selected.length}/6
        </span>
        <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <label className="mb-2 flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nhập mã BQMS..."
              className="w-full bg-transparent text-xs outline-none placeholder:text-slate-400"
            />
          </label>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400">
                Không có mã phù hợp.
              </p>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.bqms_code}
                  type="button"
                  onClick={() => addCode(s.bqms_code)}
                  disabled={selected.length >= 6}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="font-mono font-semibold text-slate-800">{s.bqms_code}</span>
                  {s.rfq_count != null && (
                    <span className="text-[11px] tabular-nums text-slate-500">
                      {s.rfq_count} RFQ
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
          {selected.length >= 6 && (
            <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
              Đạt giới hạn 6 mã. Bỏ chọn 1 mã để thêm.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CustomerPicker({
  selected,
  onChange,
  suggestions,
}: {
  selected: string[];
  onChange: (codes: string[]) => void;
  suggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  const filtered = suggestions.filter((s) => !selected.includes(s)).slice(0, 30);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={suggestions.length === 0}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
          selected.length > 0
            ? 'border-sky-300 text-sky-700'
            : 'border-slate-200 text-slate-700 hover:border-sky-300 hover:text-sky-700',
        )}
      >
        <Users className="h-3.5 w-3.5" />
        Khách hàng
        <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[11px] font-bold text-sky-700">
          {selected.length || 'all'}
        </span>
        <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400">
                Chọn mã BQMS trước để xem danh sách KH.
              </p>
            ) : (
              filtered.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange([...selected, s])}
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-slate-700 transition hover:bg-sky-50"
                >
                  {s}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SelectionChips({
  codes,
  customers,
  onRemoveCode,
  onRemoveCustomer,
  onClear,
}: {
  codes: string[];
  customers: string[];
  onRemoveCode: (c: string) => void;
  onRemoveCustomer: (c: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Đang so sánh:
      </span>
      {codes.map((c, idx) => (
        <span
          key={c}
          className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold ring-1"
          style={{
            color: SERIES_COLORS[idx % SERIES_COLORS.length],
            // restrained: only colored dot, ring stays slate
            boxShadow: `inset 0 0 0 1px ${SERIES_COLORS[idx % SERIES_COLORS.length]}33`,
          }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: SERIES_COLORS[idx % SERIES_COLORS.length] }}
          />
          <span className="font-mono">{c}</span>
          <button
            type="button"
            onClick={() => onRemoveCode(c)}
            className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      {customers.map((c) => (
        <span
          key={c}
          className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-sky-200"
        >
          <Users className="h-2.5 w-2.5" />
          {c}
          <button
            type="button"
            onClick={() => onRemoveCustomer(c)}
            className="rounded-full p-0.5 text-sky-400 hover:bg-sky-100 hover:text-sky-700"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-[11px] font-semibold text-slate-500 hover:text-rose-600"
      >
        Xóa hết
      </button>
    </div>
  );
}

function KpiCard({
  label,
  value,
  deltaPct,
  subtitle,
  tone,
  icon,
}: {
  label: string;
  value: string;
  deltaPct?: number | null;
  subtitle?: string;
  tone: 'brand' | 'emerald' | 'amber' | 'rose';
  icon?: ReactNode;
}) {
  const toneText = {
    brand: 'text-brand-700',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
  }[tone];
  const iconBg = {
    brand: 'bg-brand-50 text-brand-600 ring-brand-200',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-600 ring-amber-200',
    rose: 'bg-rose-50 text-rose-600 ring-rose-200',
  }[tone];

  const deltaPositive = deltaPct != null && deltaPct > 0;
  const deltaNegative = deltaPct != null && deltaPct < 0;
  const deltaTone =
    deltaPct == null
      ? 'bg-slate-100 text-slate-500 ring-slate-200'
      : deltaPositive
        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
        : deltaNegative
          ? 'bg-rose-50 text-rose-700 ring-rose-200'
          : 'bg-slate-100 text-slate-500 ring-slate-200';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {icon && (
            <span
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded-md ring-1 ring-inset',
                iconBg,
              )}
            >
              {icon}
            </span>
          )}
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            {label}
          </p>
        </div>
        {deltaPct != null && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset',
              deltaTone,
            )}
          >
            {deltaPositive ? (
              <ArrowUp className="h-2.5 w-2.5" />
            ) : deltaNegative ? (
              <ArrowDown className="h-2.5 w-2.5" />
            ) : (
              <Minus className="h-2.5 w-2.5" />
            )}
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        )}
      </div>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums tracking-tight', toneText)}>
        {value}
      </p>
      {subtitle && <p className="mt-1 truncate text-[11px] text-slate-500">{subtitle}</p>}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  loading,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold tracking-tight text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-brand-700 ring-1 ring-brand-200">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              đang tải
            </span>
          )}
          {right}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Legend({ codes, showMarket }: { codes: string[]; showMarket?: boolean }) {
  if (codes.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
      {codes.map((c, idx) => (
        <span key={c} className="inline-flex items-center gap-1">
          <span
            className="h-2 w-3 rounded-sm"
            style={{ background: SERIES_COLORS[idx % SERIES_COLORS.length] }}
          />
          <span className="font-mono font-semibold text-slate-700">{c}</span>
        </span>
      ))}
      {showMarket && (
        <span className="inline-flex items-center gap-1">
          <span
            className="h-px w-4 border-t-2 border-dashed"
            style={{ borderColor: MARKET_DASH }}
          />
          <span className="font-semibold text-slate-500">TT XNK (trung vị)</span>
        </span>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone: 'rose' | 'amber' | 'sky';
}) {
  const activeBg = {
    rose: 'bg-rose-600 text-white ring-rose-300',
    amber: 'bg-amber-600 text-white ring-amber-300',
    sky: 'bg-sky-600 text-white ring-sky-300',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ring-1 ring-inset',
        active
          ? activeBg
          : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0 text-[11px] font-bold tabular-nums',
          active ? 'bg-white/25' : 'bg-slate-100 text-slate-600',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function VolatilityTable({
  rows,
  onPick,
  onAdd,
  selectedCodes,
  isError,
}: {
  rows: VolatilityRow[];
  onPick: (code: string) => void;
  onAdd: (code: string) => void;
  selectedCodes: string[];
  isError: boolean;
}) {
  const [sort, setSort] = useState<keyof VolatilityRow>('stddev_pct');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = (a[sort] as number) ?? -Infinity;
      const bv = (b[sort] as number) ?? -Infinity;
      return dir === 'asc' ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sort, dir]);

  if (isError) {
    return <EmptyBlock label="Không tải được dữ liệu biến động. Thử tải lại." />;
  }
  if (rows.length === 0) {
    return <EmptyBlock label="Chưa có dữ liệu biến động." />;
  }

  const toggleSort = (key: keyof VolatilityRow) => {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir('desc');
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <TH>Mã BQMS</TH>
            <TH align="right" onClick={() => toggleSort('rfq_count')} sortable>
              RFQ
            </TH>
            <TH align="right" onClick={() => toggleSort('median_v1')} sortable>
              V1 TB
            </TH>
            <TH align="right">Min — Max</TH>
            <TH align="right" onClick={() => toggleSort('stddev_pct')} sortable>
              Stddev %
            </TH>
            <TH>Lần cuối</TH>
            <TH align="right">Thao tác</TH>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const isPicked = selectedCodes.includes(r.bqms_code);
            return (
              <tr
                key={r.bqms_code}
                onClick={() => onPick(r.bqms_code)}
                className="cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-brand-50/40"
              >
                <td className="px-3 py-2">
                  <span className="font-mono text-[12px] font-bold text-slate-800">
                    {r.bqms_code}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {r.rfq_count}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                  {fmtMoneyShort(r.median_v1)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-500">
                  {fmtMoneyShort(r.min_v1)} — {fmtMoneyShort(r.max_v1)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  <span
                    className={cn(
                      'inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold',
                      (r.stddev_pct ?? 0) > 30
                        ? 'bg-rose-50 text-rose-700'
                        : (r.stddev_pct ?? 0) > 15
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    {r.stddev_pct?.toFixed(1) ?? '—'}%
                  </span>
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-500">{fmtDate(r.last_seen)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    disabled={isPicked || selectedCodes.length >= 6}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(r.bqms_code);
                    }}
                    className={cn(
                      'rounded-md px-2 py-0.5 text-[11px] font-bold transition',
                      isPicked
                        ? 'bg-brand-100 text-brand-600'
                        : selectedCodes.length >= 6
                          ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                          : 'bg-brand-600 text-white hover:bg-brand-700',
                    )}
                  >
                    {isPicked ? '✓ đã chọn' : '+ so sánh'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TH({
  children,
  align = 'left',
  onClick,
  sortable,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  onClick?: () => void;
  sortable?: boolean;
}) {
  return (
    <th
      onClick={onClick}
      className={cn(
        'px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500',
        align === 'right' ? 'text-right' : 'text-left',
        sortable && 'cursor-pointer select-none hover:text-brand-700',
      )}
    >
      {children}
    </th>
  );
}

function EmptyBlock({ label = 'Chưa có dữ liệu phù hợp.' }: { label?: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 text-center text-xs text-slate-500">
      {label}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Repeat-RFQ radar table — mã Samsung hay hỏi theo chu kỳ. Click 1 dòng →
// mở CodeHistoryDrawer (dùng lại drawer chung của trang qua onPick).
// Nhấn mạnh mã "sắp hỏi lại mà CHƯA có giá vốn" bằng dot rose cảnh báo.
// ──────────────────────────────────────────────────────────────────────────
const RADAR_STATUS_META: Record<
  RadarStatus,
  { label: string; className: string }
> = {
  overdue: { label: 'Quá hạn hỏi', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  due_soon: { label: 'Sắp hỏi lại', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  on_track: { label: 'Đúng nhịp', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
  unknown: { label: '—', className: 'bg-slate-100 text-slate-500 ring-slate-200' },
};

function BoolMark({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="font-bold text-emerald-600">✓</span>
  ) : (
    <span className="font-bold text-slate-400">✗</span>
  );
}

function RepeatRadarTable({
  rows,
  onPick,
  loading,
  isError,
}: {
  rows: RadarRow[];
  onPick: (code: string) => void;
  loading: boolean;
  isError: boolean;
}) {
  if (loading && rows.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand-600" />
        Đang dò chu kỳ hỏi lại...
      </div>
    );
  }
  if (isError) {
    return <EmptyBlock label="Không tải được radar mã sắp hỏi lại. Thử tải lại." />;
  }
  if (rows.length === 0) {
    return <EmptyBlock label="Chưa có mã nào đủ dữ liệu chu kỳ" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <TH>Mã BQMS</TH>
            <TH>Tên hàng</TH>
            <TH align="right">Số lần hỏi</TH>
            <TH align="right">Chu kỳ (ngày)</TH>
            <TH align="right">Cách lần cuối (ngày)</TH>
            <TH>Trạng thái</TH>
            <TH align="right">Giá vốn?</TH>
            <TH align="right">Nguồn cung?</TH>
            <TH align="right">Giá V1 gần nhất</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = RADAR_STATUS_META[r.status] ?? RADAR_STATUS_META.unknown;
            const soon = r.status === 'due_soon' || r.status === 'overdue';
            const needCost = soon && !r.has_cost;
            return (
              <tr
                key={r.bqms_code}
                onClick={() => onPick(r.bqms_code)}
                className={cn(
                  'cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-brand-50/40',
                  needCost && 'bg-rose-50/30',
                )}
              >
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    {needCost && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-rose-500"
                        title="Sắp hỏi lại mà chưa có giá vốn"
                      />
                    )}
                    <span className="font-mono text-[12px] font-bold text-slate-800">
                      {r.bqms_code}
                    </span>
                  </span>
                </td>
                <td
                  className="px-3 py-2 max-w-xs truncate text-[11px] text-slate-600"
                  title={r.product_name ?? ''}
                >
                  {r.product_name ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {r.ask_count}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {r.cadence_days != null ? Math.round(r.cadence_days) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {r.days_since_last != null ? Math.round(r.days_since_last) : '—'}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset',
                      meta.className,
                    )}
                  >
                    {soon && <Bell className="h-3 w-3" />}
                    {meta.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <BoolMark ok={r.has_cost} />
                </td>
                <td className="px-3 py-2 text-right">
                  <BoolMark ok={r.has_sourcing} />
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                  {fmtMoneyFull(r.last_v1_vnd)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Fresh codes table — last 14 days, never asked in prior 90d.
// Click row → push code into selectedCodes (Thêm vào so sánh).
// ──────────────────────────────────────────────────────────────────────────
function FreshCodesTable({
  rows,
  selectedCodes,
  onPick,
  onAdd,
  loading,
  isError,
}: {
  rows: FreshCodeRow[];
  selectedCodes: string[];
  onPick: (code: string) => void;
  onAdd: (code: string) => void;
  loading: boolean;
  isError: boolean;
}) {
  if (loading && rows.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand-600" />
        Đang tải mã mới...
      </div>
    );
  }
  if (isError) {
    return <EmptyBlock label="Không tải được danh sách mã mới. Thử tải lại." />;
  }
  if (rows.length === 0) {
    return <EmptyBlock label="Chưa có mã mới trong 14 ngày" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <TH>Mã BQMS</TH>
            <TH>Ngày hỏi đầu</TH>
            <TH>Khách</TH>
            <TH>Tên hàng</TH>
            <TH align="right">Market median (USD)</TH>
            <TH align="right">Urgency</TH>
            <TH align="right">Thao tác</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isPicked = selectedCodes.includes(r.bqms_code);
            const urgencyClass =
              r.urgency === 'high'
                ? 'bg-rose-50 text-rose-700 ring-rose-200'
                : r.urgency === 'medium'
                  ? 'bg-amber-50 text-amber-700 ring-amber-200'
                  : 'bg-slate-100 text-slate-600 ring-slate-200';
            const urgencyLabel =
              r.urgency === 'high' ? 'Cao' : r.urgency === 'medium' ? 'Vừa' : 'Thấp';
            return (
              <tr
                key={r.bqms_code}
                onClick={() => {
                  onAdd(r.bqms_code);
                  onPick(r.bqms_code);
                }}
                className="cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-amber-50/40"
              >
                <td className="px-3 py-2 font-mono text-[12px] font-bold text-slate-800">
                  {r.bqms_code}
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-600">
                  {fmtDate(r.first_inquiry_date)}
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-700">{r.customer ?? '—'}</td>
                <td
                  className="px-3 py-2 max-w-xs truncate text-[11px] text-slate-600"
                  title={r.product_name ?? ''}
                >
                  {r.product_name ?? '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                  {fmtUsd(r.suggested_market_median_usd)}
                </td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset',
                      urgencyClass,
                    )}
                  >
                    {urgencyLabel}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    disabled={isPicked || selectedCodes.length >= 6}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(r.bqms_code);
                    }}
                    className={cn(
                      'rounded-md px-2 py-0.5 text-[11px] font-bold transition',
                      isPicked
                        ? 'bg-brand-100 text-brand-600'
                        : selectedCodes.length >= 6
                          ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                          : 'bg-brand-600 text-white hover:bg-brand-700',
                    )}
                  >
                    {isPicked ? '✓ đã chọn' : '+ Thêm vào so sánh'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Matched BQMS table — V1 nội bộ + XNK market + result.
// Sort by |gap_pct| DESC done in parent, top 50 per page, paginated.
// gap% color: emerald (< 0, ours cheaper), amber (0–10%), rose (> 10%).
// ──────────────────────────────────────────────────────────────────────────
function MatchedBqmsTable({
  rows,
  totalCount,
  page,
  pageCount,
  pageSize,
  onPageChange,
  selectedCodes,
  onPick,
  onAdd,
  loading,
  isError,
}: {
  rows: MatchedBqmsRow[];
  totalCount: number;
  page: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  selectedCodes: string[];
  onPick: (code: string) => void;
  onAdd: (code: string) => void;
  loading: boolean;
  isError: boolean;
}) {
  if (loading && rows.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand-600" />
        Đang tải bảng match...
      </div>
    );
  }
  if (isError) {
    return <EmptyBlock label="Không tải được bảng match. Thử tải lại." />;
  }
  if (rows.length === 0) {
    return <EmptyBlock label="Chưa có mã nào đủ cả V1 nội bộ + XNK market + kết quả." />;
  }

  const resultClass = (r: MatchedBqmsRow['result']) =>
    r === 'won'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : r === 'lost'
        ? 'bg-rose-50 text-rose-700 ring-rose-200'
        : 'bg-slate-100 text-slate-600 ring-slate-200';
  const resultLabel = (r: MatchedBqmsRow['result']) =>
    r === 'won' ? 'Trúng' : r === 'lost' ? 'Trượt' : 'Chờ';

  const start = page * pageSize + 1;
  const end = Math.min(start + rows.length - 1, totalCount);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <TH>Mã BQMS</TH>
              <TH align="right">V1 nội bộ (USD)</TH>
              <TH align="right">Market median (USD)</TH>
              <TH align="right">Gap %</TH>
              <TH align="right">Kết quả</TH>
              <TH>Khách</TH>
              <TH>Gợi ý hành động</TH>
              <TH align="right">Thao tác</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gap = r.gap_pct ?? 0;
              const gapAbs = Math.abs(gap);
              const gapClass =
                gap < 0
                  ? 'bg-emerald-50 text-emerald-700'
                  : gapAbs <= 10
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-rose-50 text-rose-700';
              const isPicked = selectedCodes.includes(r.bqms_code);
              return (
                <tr
                  key={r.bqms_code}
                  onClick={() => onPick(r.bqms_code)}
                  className="cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-sky-50/40"
                >
                  <td className="px-3 py-2 font-mono text-[12px] font-bold text-slate-800">
                    {r.bqms_code}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                    {fmtUsd(r.our_v1_usd)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                    {fmtUsd(r.market_median_usd)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    <span
                      className={cn(
                        'inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold',
                        gapClass,
                      )}
                    >
                      {gap > 0 ? '+' : ''}
                      {gap.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset',
                        resultClass(r.result),
                      )}
                    >
                      {resultLabel(r.result)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-700">{r.customer ?? '—'}</td>
                  <td
                    className="px-3 py-2 max-w-md truncate text-[11px] text-slate-600"
                    title={r.suggested_action_vi ?? ''}
                  >
                    {r.suggested_action_vi ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={isPicked || selectedCodes.length >= 6}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAdd(r.bqms_code);
                      }}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-[11px] font-bold transition',
                        isPicked
                          ? 'bg-brand-100 text-brand-600'
                          : selectedCodes.length >= 6
                            ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                            : 'bg-brand-600 text-white hover:bg-brand-700',
                      )}
                    >
                      {isPicked ? '✓ đã chọn' : '+ so sánh'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-600">
          <span>
            Hiển thị <span className="font-bold tabular-nums">{start}</span>–
            <span className="font-bold tabular-nums">{end}</span> trên{' '}
            <span className="font-bold tabular-nums">{totalCount}</span> mã
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => onPageChange(Math.max(0, page - 1))}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Trước
            </button>
            <span className="px-2 font-mono tabular-nums">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount - 1}
              onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Sau →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
