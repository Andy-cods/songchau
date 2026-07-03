'use client';

/**
 * Vendor Scorecard (Đợt 6) — bảng xếp hạng NCC theo điểm tổng hợp.
 *
 * URL: /analytics/vendor-scorecard
 *
 * Backend (contracts the API MUST satisfy — see bottom of file for the SQL rules):
 *   GET /api/v1/procurement/vendor-scorecard?months=12
 *     → { months: number, data: VendorRow[] }   (VendorRow.prev_rank optional)
 *   GET /api/v1/procurement/vendor-scorecard/{id}?months=12
 *     → { data: VendorDetail }
 *
 * Design-law (STRICT): ONE brand color (the BQMS indigo `brand` token) + slate
 * ramp + functional status (emerald=A / amber=B / rose=C / sky info). NO violet
 * literals, NO rainbow categoricals, NO gradients, NO orbs. Dense premium-
 * enterprise — mirrors the "phiên đấu thầu" bidding-session cockpit:
 * PageShellHeader → sticky StatStrip → grid[1fr_300px] center DataPanel + right
 * TrackingRail, drill-down as a centered z-50 modal.
 *
 * CRITICAL number handling: Postgres NUMERIC serializes as a STRING in JSON.
 * Every value funnels through toNum()/safeFixed() from @/lib/utils before any
 * .toFixed()/.toLocaleString(). A null `score` (sparse vendor) renders as a dash
 * and the row is muted + sorted to the bottom — never punished to 0.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Trophy,
  Loader2,
  X,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Building2,
  Award,
  ChevronRight,
  RotateCw,
  Medal,
  FileText,
  FileSignature,
  Package,
  Truck,
  Gavel,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react';

import { api } from '@/lib/api';
import { cn, toNum, safeFixed } from '@/lib/utils';
import {
  PageShellHeader,
  TopProgressBar,
  StatStrip,
  StatusPill,
  DataPanel,
  DensityToggle,
  CountUp,
  SkeletonRow,
  TrackingRail,
  RailCard,
  MonthsFilter,
  RankDelta,
  ScoreCompositionBar,
  FactorBar,
  MODAL_HEADER,
  TYPE,
  ELEVATION,
  RADIUS,
  SHELL,
  DEPTH,
  BUTTON,
  BADGE,
  ROW_PADDING,
  type BadgeTone,
  type Density,
  type StatChip,
  type ScoreSegment,
} from '@/components/cockpit';

// ───────────────────────────────────────────────────────────────────────────
// Types — backend response contracts
// ───────────────────────────────────────────────────────────────────────────

/** A single factor inside the detail breakdown. `n` is the raw sample size. */
interface ScoreFactor {
  key: FactorKey;
  /** 0–100 normalized sub-score; null when this vendor has no data for the factor. */
  score: number | string | null;
  /** raw underlying metric (e.g. response %, lead days) — display-only, coerced. */
  raw: number | string | null;
  /** sample size used to compute this factor; drives the "Chưa đủ dữ liệu" muting. */
  n: number | string | null;
  /** weight actually applied after renormalizing over present factors (0–1). */
  weight: number | string | null;
}

type FactorKey = 'response' | 'win' | 'on_time' | 'price' | 'lead_time' | 'quality';

type Grade = 'A' | 'B' | 'C' | null;

interface VendorRow {
  vendor_id: number;
  vendor_name: string;
  /** Composite 0–100; null => "Chưa đủ dữ liệu" (sparse), rendered muted at bottom. */
  score: number | string | null;
  grade: Grade;
  /** Per-rate sub-metrics, 0–100. NUMERIC strings allowed. */
  response_rate: number | string | null;
  win_rate: number | string | null;
  on_time_rate: number | string | null;
  /** Average lead time in days (PO actual_delivery - requested). */
  avg_lead_days: number | string | null;
  /** Price competitiveness 0–100 (higher = cheaper vs peers, per-currency). */
  price_score: number | string | null;
  /** True when this vendor's awards span >1 currency — can't SUM, flag it. */
  mixed_currency?: boolean;
  /** When true the vendor is too sparse to score (score=null, grade=null). */
  insufficient?: boolean;
  /**
   * Prior-window rank (1-based). NEW optional field — degrades to "—" when the
   * backend hasn't shipped it yet. delta = prev_rank != null ? prev_rank - rank : null.
   */
  prev_rank?: number | string | null;
}

interface RecentAward {
  award_id: number;
  batch_code: string | null;
  batch_title: string | null;
  bqms_code: string | null;
  awarded_price: number | string | null;
  currency: string | null;
  quantity: number | string | null;
  awarded_at: string | null;
}

interface VendorDetail {
  vendor_id: number;
  vendor_name: string;
  score: number | string | null;
  grade: Grade;
  mixed_currency?: boolean;
  insufficient?: boolean;
  factors: ScoreFactor[];
  recent_awards: RecentAward[];
  /** Optional summary metrics surfaced in the modal mini-StatStrip. */
  on_time_rate?: number | string | null;
  avg_lead_days?: number | string | null;
  prev_rank?: number | string | null;
  rank?: number | string | null;
}

interface ListResp {
  months: number;
  data: VendorRow[];
}

interface DetailResp {
  data: VendorDetail;
}

// ── Đợt 10 #14 — Tab1 "Hồ sơ DN" + Tab3 "Lịch sử" contracts ──

/** Tab1 — company profile (light /profile endpoint). */
interface VendorProfile {
  vendor_id: number;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_code: string | null;
  product_categories: string[];
  account_status: string | null;
  is_approved: boolean | null;
  approved_at: string | null;
  last_login_at: string | null;
  created_at: string | null;
}
interface ProfileResp {
  data: VendorProfile;
}

/** Tab3 — 4 independent paginated timeline streams (NEVER summed cross-currency). */
interface TimelineBatch {
  kind: 'batch';
  batch_id: number;
  batch_code: string | null;
  batch_title: string | null;
  invited_at: string | null;
  viewed_at: string | null;
  quote_status: string | null;
  round_number: number | null;
  quote_total: number | string | null;
  quote_currency: string | null;
  won: boolean;
}
interface TimelineContract {
  kind: 'contract';
  contract_id: number;
  contract_no: string | null;
  batch_id: number | null;
  batch_code: string | null;
  total_amount: number | string | null;
  currency: string | null;
  status: string | null;
  contract_date: string | null;
  signed_at: string | null;
  created_at: string | null;
}
interface TimelinePo {
  kind: 'po';
  po_id: number;
  po_no: string | null;
  batch_id: number | null;
  batch_code: string | null;
  total_amount: number | string | null;
  currency: string | null;
  status: string | null;
  po_date: string | null;
  requested_delivery_date: string | null;
  actual_delivery_date: string | null;
  on_time: boolean | null;
}
interface TimelineDelivery {
  kind: 'delivery';
  delivery_id: number;
  delivery_no: string | null;
  po_id: number | null;
  po_no: string | null;
  status: string | null;
  delivery_method: string | null;
  tracking_no: string | null;
  delivered_at: string | null;
  received_at: string | null;
  created_at: string | null;
}
interface TimelineResp {
  data: {
    batches: TimelineBatch[];
    contracts: TimelineContract[];
    pos: TimelinePo[];
    deliveries: TimelineDelivery[];
  };
  counts: { batches: number; contracts: number; pos: number; deliveries: number };
}

type DrawerTab = 'profile' | 'performance' | 'history';
const TIMELINE_PAGE = 20;

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────

const DASH = '—';

const MONTH_OPTIONS = [3, 6, 12, 24];

/**
 * Functional grade palette — emerald/amber/rose ONLY because grade IS a status.
 * Mapped to a cockpit BadgeTone so the calm dot+muted StatusPill renders it.
 */
const GRADE_TONE: Record<'A' | 'B' | 'C', BadgeTone> = {
  A: 'emerald',
  B: 'amber',
  C: 'rose',
};

const FACTOR_META: Record<FactorKey, { label: string; rawSuffix: string; rawDigits: number }> = {
  response: { label: 'Tỷ lệ phản hồi mời', rawSuffix: '%', rawDigits: 0 },
  win: { label: 'Tỷ lệ thắng thầu', rawSuffix: '%', rawDigits: 0 },
  on_time: { label: 'Giao đúng hạn', rawSuffix: '%', rawDigits: 0 },
  price: { label: 'Cạnh tranh giá', rawSuffix: ' điểm', rawDigits: 0 },
  lead_time: { label: 'Lead time', rawSuffix: ' ngày', rawDigits: 1 },
  quality: { label: 'Chất lượng nhận hàng', rawSuffix: '%', rawDigits: 0 },
};

// Stable factor order for the detail breakdown.
const FACTOR_ORDER: FactorKey[] = ['response', 'win', 'on_time', 'price', 'lead_time', 'quality'];

/**
 * Default composite weights (sum = 1.0). These mirror the server's scoring model
 * and drive ScoreCompositionBar segment WIDTHS for the list row (the list
 * response only carries sub-rates, not per-vendor renormalized weights — the
 * drawer factors[].weight is the authoritative one and is used there).
 * `response` is the HEADLINE factor → index 0 → brand lead segment.
 */
const COMPOSITION_WEIGHTS: { key: FactorKey; label: string }[] = [
  { key: 'response', label: 'Phản hồi' },
  { key: 'price', label: 'Giá' },
  { key: 'on_time', label: 'Đúng hạn' },
  { key: 'win', label: 'Thắng thầu' },
  { key: 'lead_time', label: 'Lead time' },
];

const COMPOSITION_WEIGHT_VALUE: Record<FactorKey, number> = {
  response: 0.25,
  price: 0.25,
  on_time: 0.2,
  win: 0.15,
  lead_time: 0.15,
  quality: 0, // not surfaced on the list row
};

/** Lead days → 0–100 score (≤7d ≈ 100, ≥45d ≈ 0). Drives composition shade only. */
function leadDaysToScore(days: number | string | null | undefined): number | null {
  if (days == null) return null;
  const d = toNum(days, NaN);
  if (!Number.isFinite(d)) return null;
  const score = 100 - ((d - 7) / (45 - 7)) * 100;
  return Math.max(0, Math.min(100, score));
}

// ───────────────────────────────────────────────────────────────────────────
// Formatters — every one funnels through toNum/safeFixed
// ───────────────────────────────────────────────────────────────────────────

/** Percent-style rate (0–100). null/non-finite => dash, never 0. */
function fmtRate(v: number | string | null | undefined, digits = 0): string {
  if (v == null) return DASH;
  const s = safeFixed(v, digits, DASH);
  return s === DASH ? DASH : `${s}%`;
}

/** Lead days. null => dash. */
function fmtDays(v: number | string | null | undefined): string {
  if (v == null) return DASH;
  return safeFixed(v, 1, DASH);
}

/** Score 0–100 with no decimals; null (sparse) => dash. */
function fmtScore(v: number | string | null | undefined): string {
  if (v == null) return DASH;
  return safeFixed(v, 0, DASH);
}

/** Money via vi-VN grouping; coerce first. null => dash. */
function fmtMoney(v: number | string | null | undefined): string {
  if (v == null) return DASH;
  const n = toNum(v, NaN);
  return Number.isFinite(n) ? Math.round(n).toLocaleString('vi-VN') : DASH;
}

function fmtInt(v: number | string | null | undefined): string {
  if (v == null) return DASH;
  const n = toNum(v, NaN);
  return Number.isFinite(n) ? Math.round(n).toLocaleString('vi-VN') : DASH;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return DASH;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return DASH;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** A row counts as "insufficient" if the backend flags it OR score is null. */
function isInsufficient(r: { insufficient?: boolean; score: number | string | null }): boolean {
  return Boolean(r.insufficient) || r.score == null;
}

/** prev_rank − rank, coerced. null when no prior rank (degrades gracefully). */
function rankDelta(prevRank: number | string | null | undefined, rank: number): number | null {
  if (prevRank == null) return null;
  const p = toNum(prevRank, NaN);
  return Number.isFinite(p) ? p - rank : null;
}

/**
 * Build ScoreCompositionBar segments for a scored row. Each factor's WIDTH is
 * its weight (COMPOSITION_WEIGHTS order = brand lead at index 0); each factor's
 * SHADE is its 0–100 sub-score. Factors with no data are dropped so the bar
 * width still reads as "what we could measure".
 */
function buildSegments(row: VendorRow): ScoreSegment[] {
  const subScore: Record<FactorKey, number | null> = {
    response: row.response_rate == null ? null : toNum(row.response_rate, 0),
    win: row.win_rate == null ? null : toNum(row.win_rate, 0),
    on_time: row.on_time_rate == null ? null : toNum(row.on_time_rate, 0),
    price: row.price_score == null ? null : toNum(row.price_score, 0),
    lead_time: leadDaysToScore(row.avg_lead_days),
    quality: null,
  };
  return COMPOSITION_WEIGHTS.flatMap(({ key, label }) => {
    const v = subScore[key];
    if (v == null) return [];
    return [{ key, label, valuePct: v, weight: COMPOSITION_WEIGHT_VALUE[key] }];
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────────

export default function VendorScorecardPage() {
  const [months, setMonths] = useState<number>(12);
  const [openId, setOpenId] = useState<number | null>(null);
  const [density, setDensity] = useState<Density>('comfortable');

  const { data, isLoading, isError, isFetching, refetch } = useQuery<ListResp>({
    queryKey: ['vendor-scorecard', months],
    queryFn: () => api.get<ListResp>(`/api/v1/procurement/vendor-scorecard?months=${months}`),
    retry: false,
    refetchInterval: 90_000, // 90s poll — consistent with NotificationBell cadence
  });

  const rows = data?.data ?? [];

  // Sort: scored vendors by score desc, then "Chưa đủ dữ liệu" rows muted at the
  // bottom (alphabetical). Never let a null score sort as 0 in the scored block.
  const sorted = useMemo(() => {
    const scored = rows.filter((r) => !isInsufficient(r));
    const sparse = rows.filter((r) => isInsufficient(r));
    scored.sort((a, b) => toNum(b.score, -Infinity) - toNum(a.score, -Infinity));
    sparse.sort((a, b) => a.vendor_name.localeCompare(b.vendor_name, 'vi'));
    return [...scored, ...sparse];
  }, [rows]);

  const scoredRows = useMemo(() => rows.filter((r) => !isInsufficient(r)), [rows]);
  const scoredCount = scoredRows.length;
  const sparseCount = rows.length - scoredCount;

  const avgScore = useMemo(() => {
    if (!scoredRows.length) return null;
    const sum = scoredRows.reduce((acc, r) => acc + toNum(r.score, 0), 0);
    return sum / scoredRows.length;
  }, [scoredRows]);

  const gradeACount = useMemo(() => rows.filter((r) => r.grade === 'A').length, [rows]);

  // Grade distribution for the rail (A/B/C + sparse).
  const dist = useMemo(() => {
    const d = { A: 0, B: 0, C: 0, sparse: 0 };
    for (const r of rows) {
      if (isInsufficient(r)) d.sparse += 1;
      else if (r.grade === 'A') d.A += 1;
      else if (r.grade === 'B') d.B += 1;
      else if (r.grade === 'C') d.C += 1;
    }
    return d;
  }, [rows]);

  // Podium — top-3 scored vendors (sorted block already score-desc).
  const podium = useMemo(() => scoredRows.length ? sorted.filter((r) => !isInsufficient(r)).slice(0, 3) : [], [scoredRows, sorted]);

  // ── Sticky StatStrip summary (NCC / đủ / chưa đủ / điểm TB / hạng A) ─────
  const statItems: StatChip[] = [
    { label: 'NCC theo dõi', value: rows.length },
    { divider: true, label: 'Đủ dữ liệu', value: scoredCount, tone: 'emerald' },
    { label: 'Chưa đủ', value: sparseCount, tone: 'slate' },
    {
      divider: true,
      label: 'Điểm TB',
      value: avgScore == null ? DASH : safeFixed(avgScore, 0),
      tone: 'sky',
      emphasizeValue: true,
    },
    {
      alignEnd: true,
      divider: true,
      label: 'Hạng A',
      value: gradeACount,
      tone: 'emerald',
      emphasizeValue: true,
    },
  ];

  const cellPad = ROW_PADDING[density];

  return (
    <div className={cn(SHELL.page, '-m-6')}>
      {/* (1) Sticky page header — brand icon box + MonthsFilter + refetch. */}
      <PageShellHeader
        title="Bảng điểm nhà cung cấp"
        eyebrow="Xếp hạng NCC"
        isFetching={isFetching}
        leading={
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600">
            <Trophy className="h-[18px] w-[18px] text-white" />
          </div>
        }
        actions={
          <>
            <MonthsFilter value={months} onChange={setMonths} options={MONTH_OPTIONS} />
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className={cn(BUTTON.icon, 'shrink-0')}
              aria-label="Tải lại"
              title="Tải lại"
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
            </button>
          </>
        }
      />

      {/* (2) Sticky StatStrip — dense one-line summary (replaces the KPI hero). */}
      <StatStrip sticky items={statItems} />

      {/* (3) Mission-control grid: [center ranking 1fr | tracking rail 300px]. */}
      <div className="grid grid-cols-1 gap-4 px-4 py-4 xl:grid-cols-[1fr_300px]">
        {/* ── CENTER: ranking DataPanel (flush table, zebra + density) ── */}
        <section className="min-w-0">
          <DataPanel
            flush
            title="Bảng xếp hạng"
            eyebrow={`${rows.length} NCC · ${scoredCount} đủ dữ liệu · ${sparseCount} chưa đủ`}
            actions={<DensityToggle value={density} onChange={setDensity} />}
          >
            {isError ? (
              <div
                role="alert"
                className={cn(
                  'm-4 flex items-start gap-3 px-4 py-3 text-[13px]',
                  RADIUS.container,
                  BADGE.rose.bg,
                  BADGE.rose.text,
                  BADGE.rose.ring,
                )}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Không tải được bảng điểm nhà cung cấp. Vui lòng thử lại.</p>
              </div>
            ) : (
              <div className="relative overflow-x-auto">
                <TopProgressBar active={isFetching && !isLoading} className="top-0 bottom-auto" />
                <table className="w-full min-w-[860px]">
                  <thead className={cn('sticky top-0 z-10 bg-slate-50/95 backdrop-blur', ELEVATION.floating)}>
                    <tr>
                      <Th className="text-left" style={{ minWidth: 56 }}>#</Th>
                      <Th className="text-left" style={{ minWidth: 220 }}>NCC</Th>
                      <Th className="text-left" style={{ minWidth: 220 }}>Điểm tổng hợp</Th>
                      <Th className="text-left" style={{ minWidth: 90 }}>Hạng</Th>
                      <Th className="text-right" style={{ minWidth: 80 }}>Δ hạng</Th>
                      <th className={cn(cellPad, 'w-8')} />
                    </tr>
                  </thead>
                  <tbody
                    aria-busy={isFetching}
                    className={cn(
                      'divide-y divide-slate-100 transition-opacity',
                      isFetching && !isLoading && 'opacity-60',
                    )}
                  >
                    {isLoading ? (
                      [...Array(8)].map((_, i) => <SkeletonRow key={i} cols={6} density={density} />)
                    ) : sorted.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-3 py-16">
                          <div className="mx-auto max-w-md space-y-3 text-center">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100">
                              <Trophy className="h-8 w-8 text-slate-400" />
                            </div>
                            <p className={cn(TYPE.h2, 'text-slate-700')}>Chưa có dữ liệu để chấm điểm.</p>
                            <p className="text-[13px] text-slate-500">
                              Cần ít nhất một phiên đấu thầu đã chốt trong {months} tháng gần đây.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      sorted.map((r, idx) => (
                        <ScoreRow
                          key={r.vendor_id}
                          rank={idx + 1}
                          row={r}
                          density={density}
                          onOpen={() => setOpenId(r.vendor_id)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </DataPanel>
        </section>

        {/* ── RIGHT: persistent tracking rail (collapses below xl) ── */}
        <ScorecardRail
          podium={podium}
          dist={dist}
          total={rows.length}
          onOpen={setOpenId}
        />
      </div>

      {openId != null && (
        <VendorDetailDrawer vendorId={openId} months={months} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Ranking table
// ───────────────────────────────────────────────────────────────────────────

function Th({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <th style={style} className={cn('px-3 py-2.5 whitespace-nowrap', TYPE.th, className)}>
      {children}
    </th>
  );
}

/** Medal glyph + tone for the top-3 ranks. */
const MEDAL_TONE: Record<number, string> = {
  1: 'text-amber-500',
  2: 'text-slate-400',
  3: 'text-amber-700',
};

function ScoreRow({
  rank,
  row,
  density,
  onOpen,
}: {
  rank: number;
  row: VendorRow;
  density: Density;
  onOpen: () => void;
}) {
  const sparse = isInsufficient(row);
  const grade = row.grade;
  const cellPad = ROW_PADDING[density];
  const segments = useMemo(() => buildSegments(row), [row]);
  const delta = sparse ? null : rankDelta(row.prev_rank, rank);

  const open = () => onOpen();

  return (
    <motion.tr
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      whileHover={{ y: -1 }}
      transition={{ duration: 0.12 }}
      className={cn(
        'group cursor-pointer transition-colors',
        DEPTH.focusRing,
        'focus-visible:ring-inset',
        sparse ? 'bg-slate-50/60 hover:bg-slate-100/60' : cn(DEPTH.zebra, DEPTH.rowHover),
      )}
    >
      {/* Rank + medal glyph for top-3 */}
      <td className={cn(cellPad, 'tabular-nums')}>
        {sparse ? (
          <span className="font-mono text-[12px] font-semibold text-slate-400">{DASH}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-5 text-right font-mono text-[13px] font-semibold text-slate-700">{rank}</span>
            {rank <= 3 && <Medal className={cn('h-3.5 w-3.5', MEDAL_TONE[rank])} />}
          </span>
        )}
      </td>

      {/* NCC name */}
      <td className={cn(cellPad, 'max-w-[280px]')}>
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
              sparse ? 'bg-slate-100 text-slate-400' : 'bg-brand-50 text-brand-600',
            )}
          >
            <Building2 className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <span
              className={cn('block truncate text-[13px] font-medium', sparse ? 'text-slate-500' : 'text-slate-800')}
              title={row.vendor_name}
            >
              {row.vendor_name}
            </span>
            {row.mixed_currency && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                <AlertTriangle className="h-2.5 w-2.5" /> Đa tiền tệ
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Score — hero mono number + ScoreCompositionBar (weight×score split) */}
      <td className={cellPad}>
        {sparse ? (
          <StatusPill tone="slate" variant="bare" label="Chưa đủ dữ liệu" className="text-[12px]" />
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="w-9 shrink-0 text-right font-mono text-[18px] font-bold leading-none tabular-nums text-slate-900">
              {fmtScore(row.score)}
            </span>
            <div className="min-w-[120px] flex-1">
              <ScoreCompositionBar segments={segments} height="h-1.5" />
            </div>
          </div>
        )}
      </td>

      {/* Grade — StatusPill (calm dot + muted label) */}
      <td className={cellPad}>
        {grade ? (
          <StatusPill tone={GRADE_TONE[grade]} label={`Hạng ${grade}`} />
        ) : (
          <span className="text-[12px] text-slate-300">{DASH}</span>
        )}
      </td>

      {/* Rank delta — consumes the optional prev_rank field; "—" when absent. */}
      <td className={cn(cellPad, 'text-right')}>
        <RankDelta delta={delta} />
      </td>

      <td className={cellPad}>
        <ChevronRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-brand-500" />
      </td>
    </motion.tr>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Tracking rail — podium · grade distribution · scoring legend
// ───────────────────────────────────────────────────────────────────────────

function ScorecardRail({
  podium,
  dist,
  total,
  onOpen,
}: {
  podium: VendorRow[];
  dist: { A: number; B: number; C: number; sparse: number };
  total: number;
  onOpen: (id: number) => void;
}) {
  const content = (
    <>
      {/* Bục vinh danh — podium top-3 */}
      <RailCard title="Bục vinh danh">
        {podium.length === 0 ? (
          <div className="text-[12px] text-slate-400">Chưa có NCC nào đủ điểm.</div>
        ) : (
          <ol className="space-y-1.5">
            {podium.map((r, i) => (
              <li key={r.vendor_id}>
                <button
                  type="button"
                  onClick={() => onOpen(r.vendor_id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors',
                    DEPTH.focusRing,
                    DEPTH.rowHover,
                  )}
                >
                  <Medal className={cn('h-4 w-4 shrink-0', MEDAL_TONE[i + 1])} />
                  <span className="flex-1 truncate text-[12px] font-medium text-slate-700" title={r.vendor_name}>
                    {r.vendor_name}
                  </span>
                  <span className="font-mono text-[13px] font-bold tabular-nums text-slate-900">
                    {fmtScore(r.score)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </RailCard>

      {/* Phân bố hạng — slate bars + functional dots */}
      <RailCard title="Phân bố hạng">
        <div className="space-y-1.5">
          <DistRow label="Hạng A" tone="emerald" value={dist.A} total={total} />
          <DistRow label="Hạng B" tone="amber" value={dist.B} total={total} />
          <DistRow label="Hạng C" tone="rose" value={dist.C} total={total} />
          <DistRow label="Chưa đủ" tone="slate" value={dist.sparse} total={total} />
        </div>
      </RailCard>

      {/* Cách chấm điểm — composition legend */}
      <RailCard title="Cách chấm điểm">
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          Điểm tổng hợp 0–100. Bề rộng dải = trọng số, độ đậm = điểm thành phần.
        </p>
        <ScoreCompositionBar
          segments={COMPOSITION_WEIGHTS.map(({ key, label }) => ({
            key,
            label,
            valuePct: 60,
            weight: COMPOSITION_WEIGHT_VALUE[key],
          }))}
          height="h-2"
          legend
        />
      </RailCard>
    </>
  );

  return (
    <>
      {/* xl+: persistent rail */}
      <div className="hidden xl:block">
        <TrackingRail title="Theo dõi xếp hạng" className={cn(ELEVATION.container, RADIUS.container)}>
          {content}
        </TrackingRail>
      </div>
      {/* below xl: collapsible disclosure so nothing is lost on narrow screens */}
      <details className={cn('group xl:hidden', ELEVATION.container, RADIUS.container, 'overflow-hidden')}>
        <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-slate-600 marker:content-['']">
          <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
          Theo dõi xếp hạng
        </summary>
        <div className="space-y-3 px-3 pb-3">{content}</div>
      </details>
    </>
  );
}

function DistRow({
  label,
  tone,
  value,
  total,
}: {
  label: string;
  tone: BadgeTone;
  value: number;
  total: number;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', BADGE[tone].dot)} />
      <span className="w-16 shrink-0 text-slate-600">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right font-mono font-semibold tabular-nums text-slate-700">{value}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Detail modal — hero score + mini-StatStrip + FactorBar breakdown + awards
// ───────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// VendorDetailDrawer (Đợt 10 #14) — RIGHT-anchored 3-tab hồ sơ NCC.
//   Tab "Hồ sơ"     → light /profile query (lazy)
//   Tab "Hiệu suất" → the FULL scorecard (engine) — body preserved verbatim
//   Tab "Lịch sử"   → 4 paginated timeline streams (lazy, per-currency)
// ADMIN-side: admin IS the buyer ⇒ may see rank / win / price / competitors.
// ═══════════════════════════════════════════════════════════════════════════

function VendorDetailDrawer({
  vendorId,
  months,
  onClose,
}: {
  vendorId: number;
  months: number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DrawerTab>('performance');

  // a11y: lock body scroll + Escape-to-close while mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Vendor name for the header — pull from whichever tab data is already loaded.
  const profileQ = useQuery<ProfileResp>({
    queryKey: ['vendor-profile', vendorId],
    queryFn: () => api.get<ProfileResp>(`/api/v1/procurement/vendor-scorecard/${vendorId}/profile`),
    retry: false,
    enabled: tab === 'profile',
  });
  const headerName = profileQ.data?.data.company_name ?? null;

  const TABS: { id: DrawerTab; label: string }[] = [
    { id: 'profile', label: 'Hồ sơ' },
    { id: 'performance', label: 'Hiệu suất' },
    { id: 'history', label: 'Lịch sử' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn('ml-auto flex h-full w-full max-w-2xl flex-col bg-white', ELEVATION.modal)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Hồ sơ nhà cung cấp"
      >
        {/* Header */}
        <div className={MODAL_HEADER}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className={cn(TYPE.eyebrow, 'text-brand-600')}>Hồ sơ NCC</div>
              <h2 className={cn(TYPE.h2, 'truncate')} title={headerName ?? ''}>
                {headerName ?? `NCC #${vendorId}`}
              </h2>
            </div>
          </div>
          <button onClick={onClose} className={cn(BUTTON.icon, 'shrink-0')} aria-label="Đóng">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-4">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors',
                  active
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body — one panel per tab (lazy via `enabled`) */}
        <div className="flex-1 overflow-y-auto bg-slate-50">
          {tab === 'profile' && <ProfileTab query={profileQ} />}
          {tab === 'performance' && <PerformanceTab vendorId={vendorId} months={months} />}
          {tab === 'history' && <HistoryTab vendorId={vendorId} enabled={tab === 'history'} />}
        </div>
      </div>
    </div>
  );
}

// ── Tab "Hiệu suất" — FULL scorecard (engine). Body preserved verbatim. ──

function PerformanceTab({ vendorId, months }: { vendorId: number; months: number }) {
  const { data, isLoading, isError } = useQuery<DetailResp>({
    queryKey: ['vendor-scorecard-detail', vendorId, months],
    queryFn: () =>
      api.get<DetailResp>(`/api/v1/procurement/vendor-scorecard/${vendorId}?months=${months}`),
    retry: false,
  });

  const detail = data?.data;

  // Order the factors stably; missing factors still render (muted, n=0).
  const orderedFactors = useMemo(() => {
    const byKey = new Map<FactorKey, ScoreFactor>();
    for (const f of detail?.factors ?? []) byKey.set(f.key, f);
    return FACTOR_ORDER.map(
      (k) => byKey.get(k) ?? { key: k, score: null, raw: null, n: 0, weight: null },
    );
  }, [detail]);

  // Mini-StatStrip metrics (non-sticky): awards · on-time · lead · Δ hạng.
  const miniStats: StatChip[] = useMemo(() => {
    const awardN = detail?.recent_awards.length ?? 0;
    const rank = detail?.rank == null ? null : toNum(detail.rank, NaN);
    const delta =
      detail && rank != null && Number.isFinite(rank)
        ? rankDelta(detail.prev_rank, rank)
        : null;
    return [
      { label: 'Award', value: awardN, tone: 'sky' },
      {
        divider: true,
        label: 'Đúng hạn',
        value: detail?.on_time_rate == null ? DASH : fmtRate(detail.on_time_rate, 0),
        tone: 'emerald',
      },
      {
        divider: true,
        label: 'Lead',
        value: detail?.avg_lead_days == null ? DASH : `${fmtDays(detail.avg_lead_days)} ngày`,
      },
      {
        divider: true,
        label: 'Δ hạng',
        value: <RankDelta delta={delta} />,
      },
    ];
  }, [detail]);

  return (
    <>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24">
              <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
              <span className="text-sm text-slate-500">Đang tải bảng điểm…</span>
            </div>
          ) : isError || !detail ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-400" />
              Không lấy được bảng điểm cho nhà cung cấp này.
            </div>
          ) : (
            <div className="space-y-4 p-5">
              {/* Hero score — CountUp + TYPE.kpiValue + brand composite bar */}
              <section className={cn(ELEVATION.container, RADIUS.container, 'p-5')}>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <span className={TYPE.eyebrow}>Điểm tổng hợp</span>
                    <span className="mt-1 flex items-baseline leading-none">
                      {detail.score == null ? (
                        <span className={cn(TYPE.kpiValue, 'text-[36px]')}>{DASH}</span>
                      ) : (
                        <>
                          <CountUp
                            value={toNum(detail.score, 0)}
                            decimals={0}
                            className={cn(TYPE.kpiValue, 'text-[36px]')}
                          />
                          <span className="ml-0.5 text-[15px] font-semibold text-slate-400">/100</span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="ml-auto flex flex-col items-end gap-1.5">
                    {detail.grade ? (
                      <StatusPill tone={GRADE_TONE[detail.grade]} size="md" label={`Hạng ${detail.grade}`} />
                    ) : (
                      <StatusPill tone="slate" variant="bare" label="Chưa đủ dữ liệu" />
                    )}
                    {detail.mixed_currency && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                        <AlertTriangle className="h-3 w-3" /> Award đa tiền tệ — không gộp giá
                      </span>
                    )}
                  </div>
                </div>

                {/* Composite progress bar (brand on slate) */}
                {detail.score != null && (
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.max(0, Math.min(100, toNum(detail.score, 0)))}%` }}
                    />
                  </div>
                )}
              </section>

              {/* Mini summary StatStrip (non-sticky) */}
              <div className={cn(ELEVATION.container, RADIUS.container, 'overflow-hidden')}>
                <StatStrip items={miniStats} className="ring-0" />
              </div>

              {/* Factor breakdown — FactorBar primitive */}
              <section className={cn(ELEVATION.container, RADIUS.container, 'overflow-hidden')}>
                <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <BarChart3 className="h-4 w-4 text-brand-600" />
                  <div className="min-w-0 flex-1">
                    <h3 className={TYPE.h2}>Chi tiết theo yếu tố</h3>
                    <p className="text-[11px] text-slate-500">
                      0–100, nền slate. Yếu tố thiếu dữ liệu được làm mờ và bỏ khỏi trọng số.
                    </p>
                  </div>
                </header>
                <div className="space-y-4 p-4">
                  {orderedFactors.map((f) => {
                    const meta = FACTOR_META[f.key];
                    const nNum = toNum(f.n, 0);
                    const missing = f.score == null || nNum <= 0;
                    const weightNum = toNum(f.weight, NaN);
                    const valueLabel =
                      f.raw == null ? undefined : `${safeFixed(f.raw, meta.rawDigits, DASH)}${meta.rawSuffix}`;
                    return (
                      <FactorBar
                        key={f.key}
                        label={meta.label}
                        weightPct={Number.isFinite(weightNum) ? weightNum * 100 : 0}
                        valueLabel={valueLabel}
                        scorePct={missing ? null : toNum(f.score, 0)}
                        n={nNum > 0 ? nNum : undefined}
                      />
                    );
                  })}
                </div>
              </section>

              {/* Recent awards — flush DataPanel table */}
              <DataPanel
                flush
                title="Award gần đây"
                eyebrow={`${detail.recent_awards.length} lần trúng (active, đã trừ re-award)`}
              >
                {detail.recent_awards.length === 0 ? (
                  <div className="py-10 text-center text-[13px] text-slate-400">Chưa có award nào.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className={cn('border-b border-slate-200 bg-slate-50/60', TYPE.th)}>
                        <tr>
                          <th className="px-3 py-2 text-left">Phiên</th>
                          <th className="px-3 py-2 text-left">Mã BQMS</th>
                          <th className="px-3 py-2 text-right">SL</th>
                          <th className="px-3 py-2 text-right">Đơn giá</th>
                          <th className="px-3 py-2 text-left">Ngày</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detail.recent_awards.map((a) => (
                          <tr key={a.award_id} className={cn('transition-colors', DEPTH.rowHover)}>
                            <td className="px-3 py-2">
                              <div className={TYPE.code}>{a.batch_code ?? DASH}</div>
                              {a.batch_title && (
                                <div className="max-w-[160px] truncate text-[11px] text-slate-500" title={a.batch_title}>
                                  {a.batch_title}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {a.bqms_code ? (
                                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                                  {a.bqms_code}
                                </span>
                              ) : (
                                <span className="text-[12px] text-slate-300">{DASH}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-slate-700">
                              {fmtInt(a.quantity)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[13px] font-medium tabular-nums text-slate-900">
                              {fmtMoney(a.awarded_price)}
                              {a.currency && <span className={TYPE.currencySuffix}>{a.currency}</span>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-500">
                              {fmtDate(a.awarded_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </DataPanel>
            </div>
          )}
    </>
  );
}

// ── Tab "Hồ sơ DN" — definition table from the light /profile endpoint ──

const ACCOUNT_STATUS_TONE: Record<string, BadgeTone> = {
  active: 'emerald',
  pending: 'amber',
  suspended: 'rose',
  rejected: 'slate',
};
const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: 'Đang hoạt động',
  pending: 'Chờ duyệt',
  suspended: 'Tạm ngưng',
  rejected: 'Từ chối',
};

function ProfileRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 px-4 py-2.5">
      <div className="text-[12px] font-medium text-slate-500">{label}</div>
      <div className="min-w-0 text-[13px] text-slate-800">{children}</div>
    </div>
  );
}

function ProfileTab({
  query,
}: {
  query: UseQueryResult<ProfileResp>;
}) {
  const { data, isLoading, isError } = query;
  const p = data?.data;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        <span className="text-sm text-slate-500">Đang tải hồ sơ…</span>
      </div>
    );
  }
  if (isError || !p) {
    return (
      <div className="px-6 py-12 text-center text-sm text-slate-500">
        <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-400" />
        Không lấy được hồ sơ nhà cung cấp này.
      </div>
    );
  }

  const status = (p.account_status ?? '').toLowerCase();
  return (
    <div className="space-y-4 p-5">
      <section className={cn(ELEVATION.container, RADIUS.container, 'overflow-hidden')}>
        <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <Building2 className="h-4 w-4 text-brand-600" />
          <h3 className={TYPE.h2}>Thông tin doanh nghiệp</h3>
        </header>
        <div className="divide-y divide-slate-100">
          <ProfileRow label="Tên DN">
            <span className="font-medium text-slate-900">{p.company_name ?? DASH}</span>
          </ProfileRow>
          <ProfileRow label="MST">
            <span className="font-mono text-[12px]">{p.tax_code ?? DASH}</span>
          </ProfileRow>
          <ProfileRow label="Liên hệ">
            <div className="space-y-0.5">
              <div>{p.contact_name ?? DASH}</div>
              {p.phone && <div className="text-[12px] text-slate-500">{p.phone}</div>}
              {p.email && <div className="font-mono text-[12px] text-slate-500">{p.email}</div>}
            </div>
          </ProfileRow>
          <ProfileRow label="Địa chỉ">{p.address ?? DASH}</ProfileRow>
          <ProfileRow label="Trạng thái">
            <StatusPill
              tone={ACCOUNT_STATUS_TONE[status] ?? 'slate'}
              label={ACCOUNT_STATUS_LABEL[status] ?? (p.account_status ?? DASH)}
            />
          </ProfileRow>
          <ProfileRow label="Danh mục">
            {p.product_categories.length === 0 ? (
              <span className="text-slate-400">{DASH}</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {p.product_categories.map((c) => (
                  <span
                    key={c}
                    className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </ProfileRow>
          <ProfileRow label="Đăng nhập gần nhất">
            <span className="font-mono text-[12px] text-slate-500">{fmtDate(p.last_login_at)}</span>
          </ProfileRow>
          <ProfileRow label="Ngày tạo">
            <span className="font-mono text-[12px] text-slate-500">{fmtDate(p.created_at)}</span>
          </ProfileRow>
        </div>
      </section>
    </div>
  );
}

// ── Tab "Lịch sử" — 4 collapsible streams, each "Xem thêm" paginates its own
// stream. PER-CURRENCY: every money value shows its own currency, never summed.

function HistorySection({
  icon: Icon,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  icon: typeof FileText;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={cn(ELEVATION.container, RADIUS.container, 'overflow-hidden')}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-left hover:bg-slate-50"
      >
        <Icon className="h-4 w-4 text-brand-600" />
        <h3 className={cn(TYPE.h2, 'flex-1')}>{title}</h3>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
          {fmtInt(count)}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && children}
    </section>
  );
}

function MoneyCell({ value, currency }: { value: number | string | null; currency: string | null }) {
  return (
    <span className="font-mono text-[13px] font-medium tabular-nums text-slate-900">
      {fmtMoney(value)}
      {currency && <span className={TYPE.currencySuffix}>{currency}</span>}
    </span>
  );
}

// One self-contained paginating stream per kind: each owns its offset + query + acc
// so "Xem thêm" on ONE stream NEVER refetches/replaces another. The BE `kind=<k>`
// predicate returns only that stream + its own count (per-kind independence, B2).
function useTimelineStream<T>(
  vendorId: number,
  kind: 'batches' | 'contracts' | 'pos' | 'deliveries',
  enabled: boolean,
) {
  const [offset, setOffset] = useState(0);
  const [acc, setAcc] = useState<T[]>([]);
  const q = useQuery<TimelineResp>({
    queryKey: ['vendor-timeline', vendorId, kind, offset],
    queryFn: () =>
      api.get<TimelineResp>(
        `/api/v1/procurement/vendor-scorecard/${vendorId}/timeline?limit=${TIMELINE_PAGE}&offset=${offset}&kind=${kind}`,
      ),
    enabled,
    retry: false,
  });
  useEffect(() => {
    if (!q.data) return;
    const rows = q.data.data[kind] as unknown as T[];
    setAcc((prev) => (offset === 0 ? rows : [...prev, ...rows]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  return {
    acc,
    count: q.data?.counts?.[kind] ?? 0,
    isLoading: q.isLoading,
    isError: q.isError,
    isFetching: q.isFetching,
    more: () => setOffset((o) => o + TIMELINE_PAGE),
  };
}

function HistoryTab({ vendorId, enabled }: { vendorId: number; enabled: boolean }) {
  const [open, setOpen] = useState({ batches: true, contracts: true, pos: true, deliveries: true });
  // 4 INDEPENDENT streams (fixed hook order — Rules-of-Hooks safe).
  const sBatches = useTimelineStream<TimelineBatch>(vendorId, 'batches', enabled);
  const sContracts = useTimelineStream<TimelineContract>(vendorId, 'contracts', enabled);
  const sPos = useTimelineStream<TimelinePo>(vendorId, 'pos', enabled);
  const sDeliveries = useTimelineStream<TimelineDelivery>(vendorId, 'deliveries', enabled);
  const streams = { batches: sBatches, contracts: sContracts, pos: sPos, deliveries: sDeliveries };
  // Re-expose under the original shapes so the render below is unchanged.
  const acc = {
    batches: sBatches.acc,
    contracts: sContracts.acc,
    pos: sPos.acc,
    deliveries: sDeliveries.acc,
  };
  const counts = {
    batches: sBatches.count,
    contracts: sContracts.count,
    pos: sPos.count,
    deliveries: sDeliveries.count,
  };
  const allLoading =
    sBatches.isLoading && sContracts.isLoading && sPos.isLoading && sDeliveries.isLoading;
  const allError = sBatches.isError && sContracts.isError && sPos.isError && sDeliveries.isError;
  const more = (kind: keyof typeof streams) => streams[kind].more();

  if (allLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        <span className="text-sm text-slate-500">Đang tải lịch sử…</span>
      </div>
    );
  }
  if (allError) {
    return (
      <div className="px-6 py-12 text-center text-sm text-slate-500">
        <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-400" />
        Không lấy được lịch sử nhà cung cấp này.
      </div>
    );
  }

  const MoreBtn = ({ kind, shown }: { kind: keyof typeof streams; shown: number }) =>
    shown < counts[kind] ? (
      <div className="border-t border-slate-100 px-4 py-2 text-center">
        <button
          onClick={() => more(kind)}
          disabled={streams[kind].isFetching}
          className={cn(BUTTON.ghost, 'text-[12px]')}
        >
          {streams[kind].isFetching ? 'Đang tải…' : `Xem thêm (${fmtInt(counts[kind] - shown)})`}
        </button>
      </div>
    ) : null;

  const empty = (label: string) => (
    <div className="py-8 text-center text-[12px] text-slate-400">{label}</div>
  );

  return (
    <div className="space-y-3 p-5">
      {/* (1) PHIÊN ĐẤU THẦU */}
      <HistorySection
        icon={Gavel}
        title="Phiên đấu thầu"
        count={counts.batches}
        open={open.batches}
        onToggle={() => setOpen((o) => ({ ...o, batches: !o.batches }))}
      >
        {acc.batches.length === 0 ? (
          empty('Chưa tham gia phiên nào.')
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {acc.batches.map((b) => (
                <li key={b.batch_id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={TYPE.code}>{b.batch_code ?? DASH}</span>
                      {b.won && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-100">
                          <Trophy className="h-3 w-3" /> Trúng
                        </span>
                      )}
                    </div>
                    {b.batch_title && (
                      <div className="truncate text-[11px] text-slate-500" title={b.batch_title}>
                        {b.batch_title}
                      </div>
                    )}
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      Mời: {fmtDate(b.invited_at)} · Vòng {b.round_number ?? DASH}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {b.quote_total == null ? (
                      <span className="text-[12px] text-slate-300">{DASH}</span>
                    ) : (
                      <MoneyCell value={b.quote_total} currency={b.quote_currency} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <MoreBtn kind="batches" shown={acc.batches.length} />
          </>
        )}
      </HistorySection>

      {/* (2) HỢP ĐỒNG */}
      <HistorySection
        icon={FileSignature}
        title="Hợp đồng"
        count={counts.contracts}
        open={open.contracts}
        onToggle={() => setOpen((o) => ({ ...o, contracts: !o.contracts }))}
      >
        {acc.contracts.length === 0 ? (
          empty('Chưa có hợp đồng.')
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {acc.contracts.map((c) => (
                <li key={c.contract_id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <span className={TYPE.code}>{c.contract_no ?? DASH}</span>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {fmtDate(c.contract_date ?? c.created_at)}
                      {c.status && <> · {c.status}</>}
                    </div>
                  </div>
                  <MoneyCell value={c.total_amount} currency={c.currency} />
                </li>
              ))}
            </ul>
            <MoreBtn kind="contracts" shown={acc.contracts.length} />
          </>
        )}
      </HistorySection>

      {/* (3) ĐƠN HÀNG (PO) */}
      <HistorySection
        icon={Package}
        title="Đơn hàng (PO)"
        count={counts.pos}
        open={open.pos}
        onToggle={() => setOpen((o) => ({ ...o, pos: !o.pos }))}
      >
        {acc.pos.length === 0 ? (
          empty('Chưa có đơn hàng.')
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {acc.pos.map((po) => (
                <li key={po.po_id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={TYPE.code}>{po.po_no ?? DASH}</span>
                      {po.on_time === true && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> Đúng hạn
                        </span>
                      )}
                      {po.on_time === false && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                          <AlertCircle className="h-3 w-3" /> Trễ hạn
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {fmtDate(po.po_date)}
                      {po.status && <> · {po.status}</>}
                    </div>
                  </div>
                  <MoneyCell value={po.total_amount} currency={po.currency} />
                </li>
              ))}
            </ul>
            <MoreBtn kind="pos" shown={acc.pos.length} />
          </>
        )}
      </HistorySection>

      {/* (4) GIAO HÀNG */}
      <HistorySection
        icon={Truck}
        title="Giao hàng"
        count={counts.deliveries}
        open={open.deliveries}
        onToggle={() => setOpen((o) => ({ ...o, deliveries: !o.deliveries }))}
      >
        {acc.deliveries.length === 0 ? (
          empty('Chưa có lô giao.')
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {acc.deliveries.map((d) => (
                <li key={d.delivery_id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <span className={TYPE.code}>{d.delivery_no ?? DASH}</span>
                    {d.po_no && <span className="ml-2 text-[11px] text-slate-400">PO {d.po_no}</span>}
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {fmtDate(d.delivered_at ?? d.created_at)}
                      {d.status && <> · {d.status}</>}
                    </div>
                  </div>
                  {d.tracking_no && (
                    <span className="font-mono text-[11px] text-slate-500">{d.tracking_no}</span>
                  )}
                </li>
              ))}
            </ul>
            <MoreBtn kind="deliveries" shown={acc.deliveries.length} />
          </>
        )}
      </HistorySection>
    </div>
  );
}
