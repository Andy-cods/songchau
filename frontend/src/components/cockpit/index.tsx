'use client';

/**
 * Data Cockpit — shared presentation primitives for the Đấu thầu NCC pages.
 *
 * Generic + typed. NO page data hard-coded. Pair with ./tokens.ts.
 * Motion via framer-motion, all transitions <200ms, respects
 * prefers-reduced-motion. See tokens.ts for the full design rationale.
 */

import {
  useEffect,
  useState,
  type ReactNode,
  type HTMLAttributes,
} from 'react';
import dynamic from 'next/dynamic';
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  animate,
} from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Rows3, Rows4 } from 'lucide-react';
import { cn, toNum, safeFixed } from '@/lib/utils';
import {
  TYPE,
  ELEVATION,
  RADIUS,
  BADGE,
  BUTTON,
  SHELL,
  DEPTH,
  ROW_PADDING,
  STATUS_TO_TONE,
  MODAL_OVERLAY,
  MODAL_PANEL,
  MODAL_HEADER,
  CHART_SLATE,
  CHART_COLORS,
  type BadgeTone,
  type Density,
} from './tokens';

export {
  TYPE, ELEVATION, RADIUS, BADGE, BUTTON, SHELL, DEPTH, ROW_PADDING, STATUS_TO_TONE,
  MODAL_OVERLAY, MODAL_PANEL, MODAL_HEADER, CHART_SLATE, CHART_COLORS,
};
// (BADGE re-exported above is the functional tone map consumed by list pages.)
export type { BadgeTone, Density };

// Shared brand color for charts/sparklines (brand-600 #4f46e5 — indigo design law).
const BRAND = '#4f46e5';

// Code-splitting (W3-16): cockpit is imported by many bidding pages; deferring
// recharts here keeps it out of every consumer's first-load JS until a
// Sparkline actually mounts.
const Sparkline = dynamic(
  () => import('@/components/charts/sparkline').then((m) => m.Sparkline),
  { ssr: false, loading: () => null },
);

// ════════════════════════════════════════════════════════════════════════
// TopProgressBar — system-wide thin violet refetch heartbeat (h-0.5).
// Render once, flush to the bottom edge of the sticky header.
// ════════════════════════════════════════════════════════════════════════

export interface TopProgressBarProps {
  /** True while react-query isFetching — drives the heartbeat. */
  active: boolean;
  className?: string;
}

export function TopProgressBar({ active, className }: TopProgressBarProps) {
  const reduce = useReducedMotion();
  return (
    <div
      className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden', className)}
      aria-hidden
    >
      <AnimatePresence>
        {active && (
          <motion.div
            className="h-full bg-brand-500"
            initial={{ x: '-100%' }}
            animate={
              reduce
                ? { x: 0, opacity: [0.4, 1, 0.4] }
                : { x: ['-100%', '100%'] }
            }
            exit={{ opacity: 0 }}
            transition={{
              duration: reduce ? 1.2 : 1.1,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            style={{ width: '40%' }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// PageShellHeader — sticky top chrome (z-30, h-14, blurred) + flush refetch bar.
// ════════════════════════════════════════════════════════════════════════

export interface PageShellHeaderProps {
  /** H1 title (page name). */
  title: ReactNode;
  /** Optional eyebrow above the title. */
  eyebrow?: ReactNode;
  /** Leading slot (back button / breadcrumb). */
  leading?: ReactNode;
  /** Trailing slot (actions). */
  actions?: ReactNode;
  /** Drives the flush violet refetch bar. */
  isFetching?: boolean;
  className?: string;
}

export function PageShellHeader({
  title,
  eyebrow,
  leading,
  actions,
  isFetching = false,
  className,
}: PageShellHeaderProps) {
  return (
    <header className={cn(SHELL.header, ELEVATION.floating, className)}>
      <div className={cn(SHELL.content, 'flex h-14 items-center gap-3')}>
        {leading}
        <div className="min-w-0 flex-1">
          {eyebrow && <div className={cn(TYPE.eyebrow, 'leading-none mb-0.5')}>{eyebrow}</div>}
          <h1 className={cn(TYPE.h1, 'truncate leading-tight')}>{title}</h1>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <TopProgressBar active={isFetching} />
    </header>
  );
}

// ════════════════════════════════════════════════════════════════════════
// CountUp — animated number on mount (used by KpiCell, reusable).
// ════════════════════════════════════════════════════════════════════════

export interface CountUpProps {
  value: number;
  /** Decimal places. */
  decimals?: number;
  /** Prepend (e.g. "₫"). */
  prefix?: string;
  /** Append (e.g. "%"). */
  suffix?: string;
  /** Use thousands grouping (vi-VN). Default true. */
  group?: boolean;
  durationMs?: number;
  className?: string;
}

export function CountUp({
  value,
  decimals = 0,
  prefix,
  suffix,
  group = true,
  durationMs = 700,
  className,
}: CountUpProps) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: durationMs / 1000,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
    // re-run when target value changes
  }, [value, durationMs, reduce]);

  const formatted = group
    ? display.toLocaleString('vi-VN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : display.toFixed(decimals);

  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════
// KpiCell + KpiRail — hero KPI rail (count-up + inline sparkline + delta).
// NO slate-100 icon chip (it ate the prime corner for zero data).
// ════════════════════════════════════════════════════════════════════════

export interface KpiDelta {
  /** Signed value; sign decides direction. */
  value: number;
  /** Display label, e.g. "+12%" or "3 mới". If omitted, derived from value. */
  label?: string;
  /** Invert color semantics (down = good). Default false. */
  goodIsDown?: boolean;
}

export interface KpiCellProps {
  /** Eyebrow label. */
  label: string;
  /** Numeric hero value (animated). Use `display` to override the rendered text. */
  value?: number;
  /** Pre-formatted string override (skips count-up — for non-numeric values like "—"). */
  display?: ReactNode;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Demoted currency suffix (₫/$) — rendered tiny + muted. */
  unit?: string;
  /** Inline sparkline series. */
  spark?: number[];
  delta?: KpiDelta;
  /** Accent color hint for an optional left rule (functional tone). */
  tone?: BadgeTone;
  /** Click → drill-in. Makes the tile interactive. */
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}

function KpiCellSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(ELEVATION.container, RADIUS.container, 'p-4', className)}>
      <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-7 w-24 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-3 w-16 animate-pulse rounded bg-slate-100" />
    </div>
  );
}

export function KpiCell({
  label,
  value,
  display,
  decimals = 0,
  prefix,
  suffix,
  unit,
  spark,
  delta,
  tone,
  onClick,
  loading,
  className,
}: KpiCellProps) {
  if (loading) return <KpiCellSkeleton className={className} />;

  const interactive = !!onClick;
  const deltaUp = delta ? delta.value > 0 : false;
  const deltaFlat = delta ? delta.value === 0 : false;
  // Good direction: by default up = good, unless goodIsDown.
  const deltaGood = delta
    ? delta.goodIsDown
      ? delta.value < 0
      : delta.value > 0
    : false;
  const deltaColor = deltaFlat
    ? 'text-slate-400'
    : deltaGood
      ? 'text-emerald-600'
      : 'text-rose-600';
  const DeltaIcon = deltaFlat ? Minus : deltaUp ? TrendingUp : TrendingDown;
  const deltaLabel =
    delta?.label ??
    (delta ? `${delta.value > 0 ? '+' : ''}${delta.value}` : undefined);

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn(TYPE.eyebrow, 'leading-none')}>{label}</span>
        {tone && <span className={cn('mt-0.5 h-1.5 w-1.5 rounded-full', BADGE[tone].dot)} />}
      </div>

      <div className="mt-2.5 flex items-end gap-1.5">
        <span className={TYPE.kpiValue}>
          {display != null ? (
            display
          ) : (
            <CountUp
              value={toNum(value)}
              decimals={decimals}
              prefix={prefix}
              suffix={suffix}
            />
          )}
        </span>
        {unit && <span className={cn(TYPE.currencySuffix, 'mb-1')}>{unit}</span>}
      </div>

      {(spark || delta) && (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {delta ? (
            <span className={cn('inline-flex items-center gap-1 text-[12px] font-semibold', deltaColor)}>
              <DeltaIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
              {deltaLabel}
            </span>
          ) : (
            <span />
          )}
          {spark && spark.length > 1 && (
            <Sparkline data={spark} color={BRAND} width={64} height={22} />
          )}
        </div>
      )}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          ELEVATION.interactive,
          RADIUS.container,
          DEPTH.focusRing,
          'p-4 text-left',
          tone && cn('border-l-2', BADGE[tone].dot.replace('bg-', 'border-')),
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      className={cn(
        ELEVATION.container,
        RADIUS.container,
        'p-4',
        tone && cn('border-l-2', BADGE[tone].dot.replace('bg-', 'border-')),
        className,
      )}
    >
      {body}
    </div>
  );
}

export interface KpiRailProps {
  children: ReactNode;
  /** Grid columns at lg breakpoint. Default 4. */
  cols?: 2 | 3 | 4 | 5 | 6;
  /** Stagger child entrance. Default true. */
  stagger?: boolean;
  className?: string;
}

const COLS_CLS: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-2 lg:grid-cols-5',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
};

export function KpiRail({ children, cols = 4, stagger = true, className }: KpiRailProps) {
  const reduce = useReducedMotion();
  if (!stagger || reduce) {
    return <div className={cn('grid grid-cols-1 gap-3', COLS_CLS[cols], className)}>{children}</div>;
  }
  return (
    <motion.div
      className={cn('grid grid-cols-1 gap-3', COLS_CLS[cols], className)}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.04 } },
      }}
    >
      {Array.isArray(children)
        ? children.map((child, i) => (
            <motion.div
              key={i}
              variants={{
                hidden: { opacity: 0, y: 6 },
                show: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' } },
              }}
            >
              {child}
            </motion.div>
          ))
        : children}
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// CockpitTabs — sliding violet pill (framer-motion layoutId) + count badges.
// ════════════════════════════════════════════════════════════════════════

export interface CockpitTab<T extends string = string> {
  id: T;
  label: ReactNode;
  /** Optional count badge. */
  count?: number;
  /** Optional leading icon. */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface CockpitTabsProps<T extends string = string> {
  tabs: CockpitTab<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Unique layoutId namespace (avoid pill collisions if 2 tab-bars mount). */
  layoutGroup?: string;
  className?: string;
}

export function CockpitTabs<T extends string = string>({
  tabs,
  value,
  onChange,
  layoutGroup = 'cockpit-tabs',
  className,
}: CockpitTabsProps<T>) {
  const reduce = useReducedMotion();
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 rounded-lg bg-slate-100/80 p-1',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold',
              'transition-colors duration-150',
              DEPTH.focusRing,
              active ? 'text-white' : 'text-slate-600 hover:text-slate-900',
              tab.disabled && 'opacity-40 pointer-events-none',
            )}
          >
            {active && (
              <motion.span
                layoutId={`${layoutGroup}-pill`}
                className="absolute inset-0 rounded-md bg-brand-600"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 500, damping: 38, mass: 0.7 }
                }
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {tab.icon}
              {tab.label}
              {tab.count != null && (
                <span
                  className={cn(
                    'inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums',
                    active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// StatusPill — calm dot + muted label (NOT a saturated wash).
// ════════════════════════════════════════════════════════════════════════

export interface StatusPillProps {
  label: ReactNode;
  tone: BadgeTone;
  /** Pulsing dot for live/active states. */
  pulse?: boolean;
  /** 'badge' = filled pill (default); 'bare' = dot + label, no pill bg. */
  variant?: 'badge' | 'bare';
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusPill({
  label,
  tone,
  pulse,
  variant = 'badge',
  size = 'sm',
  className,
}: StatusPillProps) {
  const c = BADGE[tone];
  const pad = size === 'md' ? 'px-2.5 py-1 text-[12px] gap-1.5' : 'px-2 py-0.5 text-[11px] gap-1.5';

  const dot = (
    <span className="relative flex h-[5px] w-[5px]">
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping [animation-duration:2s]',
            c.dot,
          )}
        />
      )}
      <span className={cn('relative inline-flex h-[5px] w-[5px] rounded-full', c.dot)} />
    </span>
  );

  if (variant === 'bare') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-medium', c.text, className)}>
        {dot}
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full font-semibold',
        pad,
        c.bg,
        c.text,
        c.ring,
        className,
      )}
    >
      {dot}
      <span className="leading-none">{label}</span>
    </span>
  );
}

/**
 * Convenience: map project StatusVariant → StatusPill tone.
 * Uses `status` (not `variant`) to avoid clashing with StatusPill's own
 * `variant` ('badge' | 'bare') prop, which is forwarded through.
 */
export interface StatusPillFromVariantProps extends Omit<StatusPillProps, 'tone'> {
  status: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}
export function StatusPillFromVariant({ status, ...rest }: StatusPillFromVariantProps) {
  return <StatusPill tone={STATUS_TO_TONE[status]} {...rest} />;
}

// ════════════════════════════════════════════════════════════════════════
// DataPanel / Card — Tier-1 container with optional header.
// ════════════════════════════════════════════════════════════════════════

export interface DataPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** H2 section title. */
  title?: ReactNode;
  /** Eyebrow above title. */
  eyebrow?: ReactNode;
  /** Header trailing slot (filters, toggles). */
  actions?: ReactNode;
  /** Remove inner padding (for flush tables). Default false. */
  flush?: boolean;
  /** Interactive (Tier-2 hover lift). Default false. */
  interactive?: boolean;
  children: ReactNode;
}

export function DataPanel({
  title,
  eyebrow,
  actions,
  flush = false,
  interactive = false,
  className,
  children,
  ...rest
}: DataPanelProps) {
  return (
    <div
      className={cn(
        interactive ? ELEVATION.interactive : ELEVATION.container,
        RADIUS.container,
        'overflow-hidden',
        className,
      )}
      {...rest}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            {eyebrow && <div className={cn(TYPE.eyebrow, 'mb-0.5 leading-none')}>{eyebrow}</div>}
            {title && <h2 className={cn(TYPE.h2, 'truncate')}>{title}</h2>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(!flush && 'px-4 pb-4', (title || actions) && !flush && 'pt-0')}>
        {children}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// DensityToggle — Thoáng / Gọn (comfortable / compact).
// ════════════════════════════════════════════════════════════════════════

export interface DensityToggleProps {
  value: Density;
  onChange: (d: Density) => void;
  className?: string;
}

export function DensityToggle({ value, onChange, className }: DensityToggleProps) {
  const opts: { id: Density; label: string; icon: ReactNode }[] = [
    { id: 'comfortable', label: 'Thoáng', icon: <Rows3 className="h-3.5 w-3.5" /> },
    { id: 'compact', label: 'Gọn', icon: <Rows4 className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className={cn('inline-flex items-center rounded-md bg-slate-100 p-0.5', className)} role="group">
      {opts.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            title={o.label}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold transition-colors',
              DEPTH.focusRing,
              active
                ? 'bg-white text-brand-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SkeletonRow — table skeleton row helper.
// ════════════════════════════════════════════════════════════════════════

export interface SkeletonRowProps {
  /** Number of cells. */
  cols: number;
  density?: Density;
  /** Per-column width hints (tailwind w-* classes). Cycles if shorter than cols. */
  widths?: string[];
  className?: string;
}

const DEFAULT_WIDTHS = ['w-24', 'w-32', 'w-16', 'w-20', 'w-28', 'w-14'];

export function SkeletonRow({ cols, density = 'comfortable', widths, className }: SkeletonRowProps) {
  const w = widths && widths.length ? widths : DEFAULT_WIDTHS;
  return (
    <tr className={className}>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className={ROW_PADDING[density]}>
          <div className={cn('h-3 animate-pulse rounded bg-slate-200', w[i % w.length])} />
        </td>
      ))}
    </tr>
  );
}

/** Non-table skeleton block (cards / lists). */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('h-4 w-full animate-pulse rounded bg-slate-200', className)} />;
}

// ════════════════════════════════════════════════════════════════════════
// ToggleChip — generic on/off pill (e.g. matrix "Chỉ giá thấp nhất").
// ════════════════════════════════════════════════════════════════════════

export interface ToggleChipProps {
  active: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function ToggleChip({ active, onChange, label, icon, className }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChange(!active)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
        DEPTH.focusRing,
        active
          ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200'
          : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50',
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════
// StatStrip — thin (h-11) inline label·value·dot chip row.
// Replaces a 4-KPI hero block with a dense one-line summary that sits under
// the PageShellHeader. Density from layout, NOT decoration: one brand color,
// slate ramp, 5px functional dots. Items are separated by hairline rules.
// ════════════════════════════════════════════════════════════════════════

export interface StatChip {
  /** Muted leading label (e.g. "NCC mời"). */
  label: ReactNode;
  /** Bold tabular value (e.g. 5 or "₫ 48.350.000"). */
  value: ReactNode;
  /** Optional 5px leading dot tone. */
  tone?: BadgeTone;
  /** Pulse the dot (live/urgent). */
  pulse?: boolean;
  /** Color the value with the tone text (e.g. emerald savings). Default false. */
  emphasizeValue?: boolean;
  /** Render a hairline divider BEFORE this chip. */
  divider?: boolean;
  /** Push this + following chips to the right edge. */
  alignEnd?: boolean;
  /** Optional click → drill-in / switch tab. */
  onClick?: () => void;
  /** Tooltip. */
  title?: string;
}

export interface StatStripProps {
  items: StatChip[];
  /** Make the strip sticky just below the h-14 header. Default false. */
  sticky?: boolean;
  className?: string;
}

function StatChipView({ chip }: { chip: StatChip }) {
  const dotCls = chip.tone ? BADGE[chip.tone].dot : null;
  const valueCls = chip.emphasizeValue && chip.tone ? BADGE[chip.tone].text : 'text-slate-900';
  const inner = (
    <>
      {dotCls && (
        <span className="relative flex h-[5px] w-[5px]">
          {chip.pulse && (
            <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping [animation-duration:2s]', dotCls)} />
          )}
          <span className={cn('relative inline-flex h-[5px] w-[5px] rounded-full', dotCls)} />
        </span>
      )}
      <span className="text-slate-400">{chip.label}</span>
      <b className={cn('tabular-nums font-semibold', valueCls)}>{chip.value}</b>
    </>
  );
  const base = 'inline-flex items-center gap-1.5 text-[12px] text-slate-600 whitespace-nowrap';
  if (chip.onClick) {
    return (
      <button type="button" onClick={chip.onClick} title={chip.title}
        className={cn(base, DEPTH.focusRing, 'rounded-md px-1 -mx-1 hover:text-slate-900 transition-colors')}>
        {inner}
      </button>
    );
  }
  return <span className={base} title={chip.title}>{inner}</span>;
}

export function StatStrip({ items, sticky = false, className }: StatStripProps) {
  return (
    <div
      className={cn(
        'flex h-11 items-center gap-4 px-4 text-[12px]',
        'bg-slate-50/95 backdrop-blur ring-1 ring-slate-200/70',
        sticky && 'sticky top-14 z-20',
        className,
      )}
    >
      {items.map((chip, i) => (
        <span key={i} className={cn('flex items-center gap-4', chip.alignEnd && 'ml-auto')}>
          {chip.divider && <span className="h-4 w-px bg-slate-200" />}
          <StatChipView chip={chip} />
        </span>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// TrackingRail — ~300px right column container ("mission control" side panel).
// Persistent (NOT tab-switched). Below xl it is hidden by the parent grid;
// callers stack a slide-over/disclosure instead. Provides a titled scroll
// surface + RailCard / RailStepper helpers for the lifecycle + funnel cards.
// ════════════════════════════════════════════════════════════════════════

export interface TrackingRailProps {
  /** Eyebrow title (e.g. "Theo dõi phiên"). */
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function TrackingRail({ title, children, className }: TrackingRailProps) {
  return (
    <aside className={cn('bg-white p-3 space-y-3 overflow-auto', className)}>
      {title && <div className={cn(TYPE.eyebrow, 'leading-none')}>{title}</div>}
      {children}
    </aside>
  );
}

/** A single hairline-ringed card inside the TrackingRail. */
export function RailCard({
  title,
  tone,
  actions,
  className,
  children,
}: {
  title?: ReactNode;
  /** Tint the card ring/bg (e.g. amber for an urgent deadline). */
  tone?: BadgeTone;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const tint = tone
    ? cn(BADGE[tone].ring, tone === 'amber' ? 'bg-amber-50/50' : tone === 'rose' ? 'bg-rose-50/40' : 'bg-white')
    : 'ring-1 ring-slate-200 bg-white';
  return (
    <div className={cn('rounded-lg p-3', tint, className)}>
      {(title || actions) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <div className="text-[11px] font-semibold text-slate-500">{title}</div>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export interface RailStep {
  label: ReactNode;
  /** done = filled emerald check, active = brand ring, todo = grey. */
  state: 'done' | 'active' | 'todo';
}

/** Vertical lifecycle stepper for the rail. */
export function RailStepper({ steps, className }: { steps: RailStep[]; className?: string }) {
  return (
    <ol className={cn('space-y-2.5 text-[12px]', className)}>
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          {s.state === 'done' ? (
            <span className="h-4 w-4 shrink-0 rounded-full bg-emerald-500 text-white grid place-items-center text-[11px]">✓</span>
          ) : s.state === 'active' ? (
            <span className="h-4 w-4 shrink-0 rounded-full bg-brand-600 ring-4 ring-brand-100" />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded-full bg-slate-200" />
          )}
          <span className={cn(
            s.state === 'active' ? 'font-semibold text-brand-700' : s.state === 'done' ? 'text-slate-500' : 'text-slate-400',
          )}>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ════════════════════════════════════════════════════════════════════════
// MonthsFilter — segmented month-window control (3/6/12/24 "T").
// Generalized from analytics/procurement/page.tsx. Active pill = white on
// brand-700; track = bg-slate-100/80 p-0.5. Pure presentational.
// ════════════════════════════════════════════════════════════════════════

export interface MonthsFilterProps {
  /** Current month window. */
  value: number;
  onChange: (months: number) => void;
  /** Selectable windows. Default [3, 6, 12, 24]. */
  options?: number[];
  /** Suffix after each number. Default "T" (tháng). */
  suffix?: string;
  className?: string;
}

export function MonthsFilter({
  value,
  onChange,
  options = [3, 6, 12, 24],
  suffix = 'T',
  className,
}: MonthsFilterProps) {
  return (
    <div
      className={cn('inline-flex items-center rounded-lg bg-slate-100/80 p-0.5', className)}
      role="group"
      aria-label="Khoảng thời gian"
    >
      {options.map((m) => {
        const active = value === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            aria-pressed={active}
            className={cn(
              'rounded-md px-2.5 py-1 text-[12px] font-semibold tabular-nums transition-colors',
              DEPTH.focusRing,
              active
                ? 'bg-white text-brand-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {m}
            {suffix}
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// RankDelta — rank movement chip (prevRank − rank). >0 up (emerald), <0 down
// (rose), 0 flat (—), null no-prior (— muted). Small, mono, tabular-nums.
// ════════════════════════════════════════════════════════════════════════

export interface RankDeltaProps {
  /** prevRank − rank: positive = moved UP, negative = moved DOWN, 0 = flat, null = no prior rank. */
  delta: number | null;
  /** Show the directional icon alongside the number. Default true. */
  showIcon?: boolean;
  className?: string;
}

export function RankDelta({ delta, showIcon = true, className }: RankDeltaProps) {
  const base = 'inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold tabular-nums';

  if (delta == null) {
    return <span className={cn(base, 'text-slate-300', className)}>—</span>;
  }
  if (delta === 0) {
    return <span className={cn(base, 'text-slate-400', className)}>—</span>;
  }

  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn(base, up ? 'text-emerald-600' : 'text-rose-600', className)}>
      {showIcon ? (
        <Icon className="h-3 w-3" strokeWidth={2.5} />
      ) : (
        <span aria-hidden>{up ? '▲' : '▼'}</span>
      )}
      {Math.abs(delta)}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════
// ScoreCompositionBar — thin stacked bar: total score split by weighted
// factors. Segment WIDTH ∝ weight; segment SHADE ∝ valuePct, drawn on a
// SLATE ramp with ONE brand-led lead segment (NOT 6 hues). Compact for cells.
// ════════════════════════════════════════════════════════════════════════

export interface ScoreSegment {
  /** Stable key (factor id). */
  key: string;
  /** Human label (legend / title). */
  label: string;
  /** 0–100 sub-score for this factor — drives fill darkness, not width. */
  valuePct: number;
  /** Relative weight (any positive unit; normalized internally) — drives width. */
  weight: number;
}

export interface ScoreCompositionBarProps {
  segments: ScoreSegment[];
  /** Bar height (tailwind h-* class). Default 'h-2'. */
  height?: string;
  /** Render the inline legend (dot + label + value%) below the bar. Default false. */
  legend?: boolean;
  className?: string;
}

/** Map a 0–100 sub-score to a slate shade; index 0 leans brand (the lead). */
function compositionShade(index: number, valuePct: number): string {
  const v = Math.max(0, Math.min(100, valuePct));
  if (index === 0) {
    // Lead segment carries the ONE brand color; darker = higher score.
    return v >= 66 ? 'bg-brand-600' : v >= 33 ? 'bg-brand-500' : 'bg-brand-400';
  }
  // Remaining segments ride the slate ramp; darker = higher score.
  return v >= 66 ? 'bg-slate-500' : v >= 33 ? 'bg-slate-400' : 'bg-slate-300';
}

export function ScoreCompositionBar({
  segments,
  height = 'h-2',
  legend = false,
  className,
}: ScoreCompositionBarProps) {
  const totalWeight = segments.reduce((acc, s) => acc + Math.max(0, toNum(s.weight, 0)), 0);

  return (
    <div className={cn('w-full', className)}>
      <div className={cn('flex w-full overflow-hidden rounded-full bg-slate-100', height)}>
        {totalWeight > 0 &&
          segments.map((s, i) => {
            const w = Math.max(0, toNum(s.weight, 0));
            if (w <= 0) return null;
            const widthPct = (w / totalWeight) * 100;
            return (
              <div
                key={s.key}
                className={cn('h-full first:rounded-l-full last:rounded-r-full', compositionShade(i, toNum(s.valuePct, 0)))}
                style={{ width: `${widthPct}%` }}
                title={`${s.label}: ${safeFixed(s.valuePct, 0)} đ`}
              />
            );
          })}
      </div>

      {legend && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {segments.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <span className={cn('h-1.5 w-1.5 rounded-full', compositionShade(i, toNum(s.valuePct, 0)))} />
              <span className="text-slate-600">{s.label}</span>
              <span className="tabular-nums text-slate-400">{safeFixed(s.valuePct, 0)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// FactorBar — one row of the factor breakdown (drill-down modal). label +
// weight eyebrow, brand fill on slate track at scorePct%, numeric score, n=.
// scorePct === null → StatusPill tone="slate" "Chưa đủ dữ liệu" (NOT bare
// opacity). Generalized from analytics/vendor-scorecard/page.tsx.
// ════════════════════════════════════════════════════════════════════════

export interface FactorBarProps {
  /** Factor name (e.g. "Tỷ lệ phản hồi mời"). */
  label: string;
  /** Applied weight as a PERCENT (e.g. 22 → "w 22%"). */
  weightPct: number;
  /** Optional raw-metric caption (e.g. "85%" or "3.2 ngày"). */
  valueLabel?: string;
  /** 0–100 sub-score; null → muted "Chưa đủ dữ liệu" state. */
  scorePct: number | null;
  /** Raw sample size (renders "n=…"). */
  n?: number;
  className?: string;
}

export function FactorBar({ label, weightPct, valueLabel, scorePct, n, className }: FactorBarProps) {
  const missing = scorePct == null;
  const pct = missing ? 0 : Math.max(0, Math.min(100, toNum(scorePct, 0)));

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-slate-700">{label}</span>
          <span className={cn(TYPE.eyebrow, 'shrink-0 normal-case tracking-normal')}>
            w {safeFixed(weightPct, 0)}%
          </span>
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          {valueLabel && <span className="text-[11px] tabular-nums text-slate-500">{valueLabel}</span>}
          <span className="w-9 text-right font-mono text-[14px] font-bold tabular-nums text-slate-900">
            {missing ? '—' : safeFixed(scorePct, 0)}
          </span>
        </div>
      </div>

      {missing ? (
        <StatusPill tone="slate" variant="bare" label="Chưa đủ dữ liệu" className="text-[11px]" />
      ) : (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
          </div>
          {n != null && (
            <div className="mt-1 text-[11px] tabular-nums text-slate-400">
              n={toNum(n, 0).toLocaleString('vi-VN')}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// CurrencyTotalRow — per-currency total line(s). NEVER sums across currencies:
// the page derives `totals` by grouping on currency and summing line/total
// amounts within each group, then renders one mono tabular line per currency
// (e.g. "Tổng USD 12.400 · Tổng VND 4.500.000"). Mirror of the NCC
// CurrencyTotalRow contract so both apps read identically.
// ════════════════════════════════════════════════════════════════════════

export interface CurrencyTotalRowProps {
  /** Pre-grouped per-currency totals (page does the grouping + sum). */
  totals: { currency: string; amount: number }[];
  /** Leading label per entry. Default "Tổng". */
  label?: string;
  className?: string;
}

export function CurrencyTotalRow({ totals, label = 'Tổng', className }: CurrencyTotalRowProps) {
  if (!totals.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {totals.map((t, i) => (
        <span key={`${t.currency}-${i}`} className="inline-flex items-baseline gap-1 whitespace-nowrap">
          <span className="text-[11px] text-slate-400">{label}</span>
          <b className="font-mono text-[13px] font-bold tabular-nums text-slate-900">
            {toNum(t.amount).toLocaleString('vi-VN')}
          </b>
          <span className={TYPE.currencySuffix}>{t.currency}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Re-export item-identity cell (mirror of NCC ItemDescCell) ────────────
export { ItemDescCell } from './item-desc-cell';
export type { ItemDescCellProps } from './item-desc-cell';

// ─── Re-export price-matrix primitives (single import surface) ────────────
export {
  PriceMatrixCell,
  MatrixFreezeCol,
  MatrixVendorHead,
  matrixCellClass,
} from './price-matrix';
export type {
  MatrixCellState,
  PriceMatrixCellProps,
  MatrixFreezeColProps,
  MatrixVendorHeadProps,
} from './price-matrix';
export { MATRIX } from './tokens';
