'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react';

/**
 * KPI Card — flat, restrained palette.
 *
 * Design contract (Thang 2026-06-19, brand = indigo `brand-*` #4f46e5):
 *   - Top-accent stripe 3px (brand | sky | emerald | amber | rose | slate)
 *   - Padding p-5
 *   - Label: text-[11px] uppercase tracking-wider text-slate-500
 *   - Value: text-2xl font-mono font-semibold text-slate-900
 *   - Optional sub line: text-xs text-slate-500
 *   - Optional icon (h-4) tinted to tone, top-right
 *   - prefers-reduced-motion respected via Tailwind motion-safe:
 *
 * Default accent tone is `brand` (indigo). `sky | emerald | amber | rose`
 * remain as secondary STATUS tones (use only when the number carries meaning).
 * `violet` is kept ONLY as a deprecated alias of `brand` for back-compat —
 * it now renders the brand indigo, never the old violet hue.
 *
 * Backwards compatibility: legacy `accentColor` (Tailwind border-* class)
 * and `trend` prop are still honored so existing callers keep working.
 */

export type KPICardTone =
  | 'brand'
  | 'sky'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'slate'
  /** @deprecated alias of `brand` — renders indigo, kept for old callers. */
  | 'violet';

interface KPICardProps {
  /** Section label, rendered uppercase tracking-wider. */
  label: string;
  /** Main metric — formatted by caller. */
  value: string | number;
  /** Optional sub-label (e.g. "so với tháng trước"). */
  sub?: string;
  /** Optional icon (lucide-react). Rendered at h-4 in tone color. */
  icon?: LucideIcon;
  /** Color tone for the top-accent stripe + icon. Defaults to brand (indigo). */
  tone?: KPICardTone;
  /** Optional trend chip (legacy API). */
  trend?: {
    direction: 'up' | 'down';
    value: string;
  };
  /**
   * Legacy escape hatch: explicit Tailwind border-* class for the top stripe.
   * When provided, overrides `tone`. Kept for existing callers.
   */
  accentColor?: string;
  loading?: boolean;
  className?: string;
}

const TONE_BORDER: Record<KPICardTone, string> = {
  brand: 'border-t-brand-500',
  sky: 'border-t-sky-500',
  emerald: 'border-t-emerald-500',
  amber: 'border-t-amber-500',
  rose: 'border-t-rose-500',
  slate: 'border-t-slate-400',
  // Deprecated alias → brand indigo (no violet).
  violet: 'border-t-brand-500',
};

const TONE_ICON: Record<KPICardTone, string> = {
  brand: 'text-brand-500',
  sky: 'text-sky-500',
  emerald: 'text-emerald-500',
  amber: 'text-amber-500',
  rose: 'text-rose-500',
  slate: 'text-slate-400',
  // Deprecated alias → brand indigo (no violet).
  violet: 'text-brand-500',
};

function KPICardSkeleton({
  accentClass,
  className,
}: {
  accentClass: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Đang tải chỉ số"
      className={cn(
        'relative rounded-lg border border-slate-200 border-t-[3px] bg-white p-5 shadow-sm',
        'dark:bg-slate-900 dark:border-slate-800',
        accentClass,
        className,
      )}
    >
      <div className="mb-3 h-3 w-24 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
      <div className="mb-2 h-7 w-20 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
      <div className="h-3 w-28 rounded bg-slate-100 dark:bg-slate-800/60 motion-safe:animate-pulse" />
      <span className="sr-only">Đang tải…</span>
    </div>
  );
}

export function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'brand',
  trend,
  accentColor,
  loading,
  className,
}: KPICardProps) {
  // Prefer explicit accentColor (legacy) over tone — keeps existing callers intact.
  const accentClass = accentColor ?? TONE_BORDER[tone];
  const iconColorClass = TONE_ICON[tone];

  if (loading) {
    return <KPICardSkeleton accentClass={accentClass} className={className} />;
  }

  return (
    <div
      className={cn(
        'relative rounded-lg border border-slate-200 border-t-[3px] bg-white p-5 shadow-sm',
        'dark:bg-slate-900 dark:border-slate-800',
        'transition-shadow motion-safe:transition-shadow hover:shadow-md',
        'focus-within:ring-2 focus-within:ring-brand-300 focus-within:ring-offset-1',
        accentClass,
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden="true"
          className={cn('absolute right-4 top-4 h-4 w-4', iconColorClass)}
        />
      )}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl font-semibold leading-tight text-slate-900 dark:text-slate-100">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
      {trend && (
        <div
          className={cn(
            'mt-2 inline-flex items-center gap-1 text-xs font-medium',
            trend.direction === 'up' ? 'text-emerald-600' : 'text-rose-600',
          )}
        >
          {trend.direction === 'up' ? (
            <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          <span>{trend.value}</span>
        </div>
      )}
    </div>
  );
}
