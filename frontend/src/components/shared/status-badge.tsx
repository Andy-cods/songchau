'use client';

import { cn } from '@/lib/utils';
import type { StatusVariant } from '@/lib/constants';

interface StatusBadgeProps {
  label: string;
  variant: StatusVariant;
  pulse?: boolean;
  className?: string;
}

const VARIANT_STYLES: Record<StatusVariant, { bg: string; text: string; dot: string }> = {
  success: {
    bg: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
  },
  warning: {
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
  },
  danger: {
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-700',
    dot: 'bg-red-500',
  },
  info: {
    bg: 'bg-cyan-50 border-cyan-200',
    text: 'text-cyan-700',
    dot: 'bg-cyan-500',
  },
  neutral: {
    bg: 'bg-slate-50 border-slate-200',
    text: 'text-slate-600',
    dot: 'bg-slate-400',
  },
};

export function StatusBadge({ label, variant, pulse, className }: StatusBadgeProps) {
  const styles = VARIANT_STYLES[variant];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border',
        styles.bg,
        styles.text,
        className
      )}
    >
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span
            className={cn(
              'absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping',
              styles.dot
            )}
          />
          <span
            className={cn(
              'relative inline-flex rounded-full h-2 w-2',
              styles.dot
            )}
          />
        </span>
      )}
      {label}
    </span>
  );
}
