/**
 * Data Cockpit — design tokens (class-string constants).
 *
 * Single source of truth for the Đấu thầu NCC "Data Cockpit" direction
 * (Thang 2026-06). These are exported Tailwind class strings so every page
 * agent composes the SAME type scale / elevation / badge / button hierarchy
 * without re-deriving it inline.
 *
 * RESTRAINT (non-negotiable): ONE brand color (brand-600 #4f46e5, the same
 * token BQMS uses) + slate ramp + functional emerald/amber/sky/rose as CALM
 * leading dots + muted labels. (violet survives only as a minor status tone.)
 * No gradients, orbs, rainbow, neon, 3D. Bold only on numbers + H1.
 *
 * NOTE: body{zoom:0.8} is global (globals.css). Sizes here are authored LARGER
 * so the hierarchy survives the zoom-out.
 */

// ─── TYPE SCALE ──────────────────────────────────────────────────────────
// Syne (font-display) + JetBrains Mono (font-mono) are loaded via @import in
// globals.css and mapped in tailwind.config.ts → these classes resolve.

export const TYPE = {
  /** KPI hero value — Syne, big, tight, tabular. */
  kpiValue:
    'font-display text-[30px] leading-[1.05] font-bold tracking-[-0.02em] tabular-nums text-slate-900',
  /** H1 page title. */
  h1: 'font-display text-[22px] font-bold tracking-[-0.015em] text-slate-900',
  /** H2 section heading (semibold, NOT display). */
  h2: 'text-[15px] font-semibold text-slate-900',
  /** Matrix price cell (mono, tabular). Lowest/awarded adds font-bold. */
  matrixPrice: 'font-mono text-[13px] font-medium tabular-nums',
  /** Generic table body text. */
  tableText: 'text-[13px] text-slate-700',
  /** Code / id token (mono, brand). */
  code: 'font-mono text-[12px] font-semibold text-brand-700',
  /** KPI label eyebrow. */
  eyebrow:
    'text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400',
  /** Table header cell — semibold (NOT bold), muted. */
  th: 'text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500',
  /** Currency suffix (₫ / $) — demoted everywhere. */
  currencySuffix: 'font-mono text-[11px] text-slate-400 ml-0.5',
} as const;

// ─── ELEVATION (4 tiers — replaces shadow-sm box-soup) ───────────────────
// Use ring-1 not border for surfaces (sharper at zoom).

export const ELEVATION = {
  /** Tier 0 — page background, no shadow. */
  page: 'bg-slate-50',
  /** Tier 1 — static container/card/table. */
  container: 'bg-white ring-1 ring-slate-200',
  /** Tier 2 — interactive tile/row (hover lift). */
  interactive:
    'bg-white ring-1 ring-slate-200 transition-all duration-150 hover:ring-slate-300 hover:-translate-y-px',
  /** Tier 3 — floating chrome (sticky header, dropdown, freeze col). */
  floating:
    'shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.10)]',
  /** Tier 4 — modal. */
  modal: 'shadow-2xl ring-1 ring-slate-200',
  /** Freeze-column shadow when matrix is scrolled on X. */
  freezeCol: 'shadow-[6px_0_8px_-6px_rgba(15,23,42,0.12)]',
} as const;

// ─── RADIUS ──────────────────────────────────────────────────────────────
// containers/cards/tables/buttons = lg (8px); chips/pills = md (6px);
// modal = xl (12px); status badges = full (intentional contrast). DROP 2xl.

export const RADIUS = {
  container: 'rounded-lg',
  chip: 'rounded-md',
  button: 'rounded-lg',
  modal: 'rounded-xl',
  badge: 'rounded-full',
} as const;

// ─── BADGE (functional, calm — 5px dot + 50 bg + 700 text + inset 100 ring)
// emerald=success/lowest, amber=warning/closed/arrived, sky=info/sent/shipping,
// rose=danger/cancelled, slate=neutral. NOT saturated washes.

export type BadgeTone = 'emerald' | 'amber' | 'sky' | 'rose' | 'violet' | 'slate';

export const BADGE: Record<BadgeTone, { bg: string; text: string; ring: string; dot: string }> = {
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-1 ring-inset ring-emerald-100', dot: 'bg-emerald-500' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-1 ring-inset ring-amber-100', dot: 'bg-amber-500' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-1 ring-inset ring-sky-100', dot: 'bg-sky-500' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-1 ring-inset ring-rose-100', dot: 'bg-rose-500' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-1 ring-inset ring-violet-100', dot: 'bg-violet-500' },
  slate: { bg: 'bg-slate-50', text: 'text-slate-600', ring: 'ring-1 ring-inset ring-slate-200', dot: 'bg-slate-400' },
};

/** Map the project-wide StatusVariant to a cockpit BadgeTone. */
export const STATUS_TO_TONE: Record<'success' | 'warning' | 'danger' | 'info' | 'neutral', BadgeTone> = {
  success: 'emerald',
  warning: 'amber',
  danger: 'rose',
  info: 'sky',
  neutral: 'slate',
};

// ─── BUTTON HIERARCHY ────────────────────────────────────────────────────
// Brand color ONLY for primary. Focus = ring-2 ring-brand-500.

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold ' +
  'transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' +
  'focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap';

export const BUTTON = {
  base: BTN_BASE,
  /** Primary action — the ONE brand button. */
  primary: `${BTN_BASE} px-3.5 py-2 bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800`,
  /** Secondary — bordered, neutral surface. */
  secondary: `${BTN_BASE} px-3.5 py-2 bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300`,
  /** Ghost — text only, hover wash. */
  ghost: `${BTN_BASE} px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900`,
  /** Danger — rose. */
  danger: `${BTN_BASE} px-3.5 py-2 bg-rose-600 text-white hover:bg-rose-700`,
  /** Icon-only square. */
  icon: `${BTN_BASE} h-8 w-8 p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700`,
} as const;

// ─── PAGE SHELL ──────────────────────────────────────────────────────────
// page bg-slate-50, content max-w-[1700px] mx-auto, sections space-y-4.

export const SHELL = {
  page: 'min-h-screen bg-slate-50',
  content: 'mx-auto max-w-[1700px] px-4 lg:px-6',
  sectionStack: 'space-y-4',
  /** Header sticky chrome (z-30, blurred). */
  header:
    'sticky top-0 z-30 h-14 backdrop-blur-md bg-white/80 ring-1 ring-slate-200',
  /** Filter/tabs rail sticky just below header (z-20). */
  filterRail: 'sticky top-14 z-20 bg-slate-50/95 backdrop-blur',
  /** Filter bar inner padding. */
  filterBar: 'px-3 py-2',
} as const;

// ─── DENSITY (table row padding signals hierarchy) ───────────────────────

export type Density = 'comfortable' | 'compact';

export const ROW_PADDING: Record<Density, string> = {
  comfortable: 'px-3 py-2.5', // Thoáng
  compact: 'px-3 py-1.5', // Gọn
};

// ─── DEPTH / FOCUS (brand washes — never decoration) ─────────────────────

export const DEPTH = {
  activeWash: 'bg-brand-50/60',
  rowHover: 'hover:bg-brand-50/40',
  zebra: 'even:bg-slate-50/40',
  focusRing: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
  divider: 'divide-y divide-slate-100',
  hairline: 'ring-1 ring-slate-200',
} as const;

// ─── MODAL (canonical overlay/panel/header — Tier-4 dialog chrome) ───────
// Lifted from vendor-bidding/[id]/page.tsx so EVERY cockpit dialog (scorecard
// drill-down, etc.) reuses the SAME z-50 + rounded-xl + shadow-2xl + ring-1 +
// backdrop-blur-sm chrome instead of re-deriving rounded-2xl box-soup inline.

/** Full-screen scrim — z-50, slate-900/60, blur, centers the panel. */
export const MODAL_OVERLAY =
  'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4';
/** Panel surface — white, Tier-4 elevation, RADIUS.modal (xl). */
export const MODAL_PANEL = `bg-white overflow-hidden ${RADIUS.modal} ${ELEVATION.modal}`;
/** Panel header band — title left, close/actions right. */
export const MODAL_HEADER =
  'px-6 py-4 border-b border-slate-100 bg-white flex items-start justify-between gap-4';

// ─── CHART RAMP (single slate ramp + ONE brand lead — NO rainbow) ────────
// For stacked/composition bars where segments must read as ONE quantity split
// by weight. The FIRST (leading) segment is brand; the rest descend a slate
// ramp. Never assign 6 distinct hues — that violates the design law.

export const CHART_SLATE = ['#475569', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0'] as const; // slate 600→200
/** Brand-led composition palette: brand-600 then slate ramp. */
export const CHART_COLORS = ['#4f46e5', ...CHART_SLATE] as const;

// ─── MATRIX (price-matrix hero rules — left-rule, NOT washes) ────────────

export const MATRIX = {
  /** Lowest price — emerald left rule + bold emerald text. */
  lowest: 'border-l-2 border-emerald-500',
  lowestText: 'font-bold text-emerald-700',
  /** Picked (pre-award selection). */
  picked: 'border-l-2 border-brand-500 ring-1 ring-inset ring-brand-300',
  /** Awarded (final). */
  awarded: 'border-l-2 border-brand-600 ring-1 ring-inset ring-brand-400',
  /** Column crosshair on hover. */
  colHover: 'bg-brand-50/30',
  /** Dim non-lowest when lowest-only toggle is on. */
  dimmed: 'text-slate-400',
  /** Sticky-left freeze-column shadow when scrolled on X (Tier3). */
  freezeCol: 'shadow-[6px_0_8px_-6px_rgba(15,23,42,0.12)]',
} as const;
