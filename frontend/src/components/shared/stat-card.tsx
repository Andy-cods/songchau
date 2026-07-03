'use client';

import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * StatCard / SummaryCard — the ONE money/KPI tile (premium-enterprise flat).
 *
 * Replaces the 4-ish bespoke summary-card variants in finance + local KPI
 * cards in procurement/inventory with one radius / border / type scale / colour
 * language. Unlike <KPICard> (which carries a 3px top-accent stripe), StatCard
 * is fully flat: no stripe, no gradient, no hover-translate.
 *
 * Colour law: neutral by default (counts) — the value reads slate-900. Pass a
 * `tone` ONLY when the number has STATUS meaning (success/warning/danger/info);
 * then the optional icon + a thin left rule pick up that semantic colour. Brand
 * indigo is the accent for an emphasised-but-neutral metric (tone="brand").
 *
 * Dark mode baked in.
 */

export type StatTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface StatCardProps {
  /** Metric label (uppercase eyebrow). */
  label: string;
  /** Main value — pre-formatted by the caller. */
  value: React.ReactNode;
  /** Optional sub line under the value. */
  sub?: React.ReactNode;
  /** Optional lucide icon (top-right), tinted to tone. */
  icon?: LucideIcon;
  /** Semantic tone. Defaults to 'neutral'. Use a status tone only when meaningful. */
  tone?: StatTone;
  loading?: boolean;
  className?: string;
}

const TONE_RULE: Record<StatTone, string> = {
  neutral: 'border-l-slate-200 dark:border-l-slate-700',
  brand: 'border-l-brand-500',
  success: 'border-l-emerald-500',
  warning: 'border-l-amber-500',
  danger: 'border-l-rose-500',
  info: 'border-l-sky-500',
};

const TONE_ICON: Record<StatTone, string> = {
  neutral: 'text-slate-400',
  brand: 'text-brand-500',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  danger: 'text-rose-500',
  info: 'text-sky-500',
};

const TONE_VALUE: Record<StatTone, string> = {
  neutral: 'text-slate-900 dark:text-slate-100',
  brand: 'text-brand-700 dark:text-brand-300',
  success: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-rose-700 dark:text-rose-300',
  info: 'text-sky-700 dark:text-sky-300',
};

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'neutral',
  loading,
  className,
}: StatCardProps) {
  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Đang tải chỉ số"
        className={cn(
          'rounded-xl border border-l-4 border-slate-200 bg-white p-5 shadow-sm',
          'dark:border-slate-800 dark:bg-slate-900',
          TONE_RULE[tone],
          className,
        )}
      >
        <div className="mb-3 h-3 w-24 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
        <div className="h-7 w-20 rounded bg-slate-200 dark:bg-slate-800 motion-safe:animate-pulse" />
        <span className="sr-only">Đang tải…</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative rounded-xl border border-l-4 border-slate-200 bg-white p-5 shadow-sm',
        'dark:border-slate-800 dark:bg-slate-900',
        TONE_RULE[tone],
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden="true"
          className={cn('absolute right-4 top-4 h-4 w-4', TONE_ICON[tone])}
        />
      )}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        className={cn(
          'mt-2 font-mono text-2xl font-semibold leading-tight',
          TONE_VALUE[tone],
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}
