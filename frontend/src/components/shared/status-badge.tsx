'use client';

import { cn } from '@/lib/utils';
import type { StatusVariant } from '@/lib/constants';
import { STATUS_CLASSES } from './status-tokens';

interface StatusBadgeProps {
  label: string;
  variant: StatusVariant;
  pulse?: boolean;
  className?: string;
  /**
   * Size: 'sm' = table cell (default), 'md' = larger emphasis (detail panel hero)
   */
  size?: 'sm' | 'md';
}

/**
 * Status badge — flat palette restraint (Thang 2026-06-19).
 *
 * Colours come from the SINGLE shared palette in `./status-tokens`
 * (STATUS_CLASSES) so StatusBadge and the ui/Badge stay perfectly in sync:
 *   - info     → sky
 *   - success  → emerald
 *   - warning  → amber
 *   - danger   → rose
 *   - neutral  → slate
 *
 * All variants meet WCAG AA contrast (text 700 on bg 50 ≥ 4.5:1).
 * Pulse animation is gated behind motion-safe: so prefers-reduced-motion
 * users see a static dot.
 */

export function StatusBadge({ label, variant, pulse, className, size = 'sm' }: StatusBadgeProps) {
  const s = STATUS_CLASSES[variant];
  const sizeClasses = size === 'md'
    ? 'px-3 py-1 text-[11px] gap-2'
    : 'px-2.5 py-0.5 text-[11px] gap-1.5';
  const dotSize = size === 'md' ? 'h-2 w-2' : 'h-1.5 w-1.5';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold tracking-wide whitespace-nowrap',
        sizeClasses,
        s.bg,
        s.text,
        s.ring,
        className,
      )}
    >
      <span className={cn('relative flex shrink-0', dotSize)} aria-hidden="true">
        {pulse && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping',
              '[animation-duration:2s]',
              s.dot,
            )}
          />
        )}
        <span className={cn('relative inline-flex rounded-full', dotSize, s.dot)} />
      </span>
      <span className="leading-none">{label}</span>
    </span>
  );
}
