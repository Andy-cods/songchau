'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge — lightweight bordered pill (no dot).
 *
 * Status variants (success/warning/danger/info/neutral) map onto the SAME
 * shared palette as <StatusBadge> (see components/shared/status-tokens.ts), so
 * "danger" is rose and "info" is sky CONSISTENTLY across both badge systems.
 * (Was: danger=red, info=cyan — drifted from StatusBadge. Fixed 2026-06-27.)
 * Class strings are written as static literals here so Tailwind JIT keeps them,
 * but the colour values intentionally match STATUS_CLASSES one-to-one.
 *
 * `default` = brand (indigo) — for the app's neutral brand tag.
 * Variant NAMES are unchanged → fully backwards compatible with all callers.
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border',
  {
    variants: {
      variant: {
        default:
          'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:border-brand-900',
        success:
          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
        warning:
          'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
        danger:
          'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900',
        info:
          'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
        neutral:
          'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
