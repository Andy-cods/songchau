'use client';

import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * PageHeader — the single, flat page title block (premium-enterprise, BQMS /
 * Daily Report style). Replaces the 4-5 ad-hoc header styles scattered across
 * pages (hero gradients, h1-vs-h2 drift, font-display only on some pages).
 *
 * Layout: [ optional mono-colour icon in a soft brand tile ] [ h1 + subtitle ]
 *         …………………………………………………… [ actions slot, right ]
 *
 * Design law:
 *   - ONE accent = brand indigo. Icon tile = bg-brand-50 + text-brand-600
 *     (or pass `iconTone="slate"` for a neutral header). NO gradient, NO orb.
 *   - Title is always h1, font-display, one fixed scale.
 *   - Flat background — the page owns its bg; this block is transparent.
 *
 * Additive primitive: pages opt in. Does not replace anything automatically.
 */

export interface PageHeaderProps {
  /** Page title — rendered as a single h1, font-display. */
  title: React.ReactNode;
  /** Optional one-line subtitle below the title. */
  subtitle?: React.ReactNode;
  /** Optional leading icon (lucide). Shown in a soft brand tile. */
  icon?: LucideIcon;
  /** Icon tile tone. 'brand' (default) = brand tile; 'slate' = neutral tile. */
  iconTone?: 'brand' | 'slate';
  /** Right-aligned actions (buttons, filters…). */
  actions?: React.ReactNode;
  /** Optional eyebrow shown above the title (uppercase, muted). */
  eyebrow?: React.ReactNode;
  className?: string;
}

const ICON_TILE: Record<'brand' | 'slate', string> = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300',
  slate: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300',
};

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  iconTone = 'brand',
  actions,
  eyebrow,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              ICON_TILE[iconTone],
            )}
          >
            <Icon aria-hidden="true" className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {eyebrow}
            </p>
          )}
          <h1 className="truncate font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
