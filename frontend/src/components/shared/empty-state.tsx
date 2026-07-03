'use client';

import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type EmptyStateVariant = 'empty' | 'error';

interface EmptyStateProps {
  /** Icon shown in the round badge. Defaults to AlertTriangle when variant=error. */
  icon?: LucideIcon;
  /** Main message. */
  heading: string;
  /** Sub-message. */
  description?: string;
  /** Optional action button label. */
  actionLabel?: string;
  /** Callback fired when action button is clicked. */
  onAction?: () => void;
  /**
   * Tone of the empty state.
   *   - 'empty' (default): neutral slate, no role.
   *   - 'error': rose tones, role="alert" so SR announces immediately.
   */
  variant?: EmptyStateVariant;
  className?: string;
}

const VARIANT_STYLES: Record<EmptyStateVariant, {
  badgeBg: string;
  iconColor: string;
  headingColor: string;
}> = {
  empty: {
    badgeBg: 'bg-slate-100 dark:bg-slate-800',
    iconColor: 'text-slate-400',
    headingColor: 'text-slate-700 dark:text-slate-200',
  },
  error: {
    badgeBg: 'bg-rose-50 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:ring-rose-900',
    iconColor: 'text-rose-500',
    headingColor: 'text-rose-700 dark:text-rose-300',
  },
};

export function EmptyState({
  icon,
  heading,
  description,
  actionLabel,
  onAction,
  variant = 'empty',
  className,
}: EmptyStateProps) {
  const styles = VARIANT_STYLES[variant];
  // Default icon: AlertTriangle for error variant, otherwise the caller-supplied one.
  // If the caller passes no icon at all, we fall back to AlertTriangle to keep layout consistent.
  const Icon = icon ?? AlertTriangle;

  return (
    <div
      role={variant === 'error' ? 'alert' : undefined}
      aria-live={variant === 'error' ? 'assertive' : undefined}
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4 text-center',
        className,
      )}
    >
      <div
        className={cn(
          'mb-4 flex h-14 w-14 items-center justify-center rounded-full',
          styles.badgeBg,
        )}
      >
        <Icon aria-hidden="true" className={cn('h-7 w-7', styles.iconColor)} />
      </div>
      <h3 className={cn('text-sm font-semibold', styles.headingColor)}>{heading}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button
          variant={variant === 'error' ? 'destructive' : 'default'}
          size="sm"
          className="mt-4 focus-visible:ring-2 focus-visible:ring-brand-300"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
