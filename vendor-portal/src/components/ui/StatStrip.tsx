import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Functional tone accents (design-restraint: NO violet-as-status). Drives the
// left-border + icon-pill tint of a KPI tile. `brand` is allowed for a primary
// headline metric only. Omit `tone` for the default neutral slate tile.
export type StatTone = 'brand' | 'emerald' | 'amber' | 'rose' | 'sky' | 'slate';

export interface StatItem {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
}

export interface StatStripProps {
  items: StatItem[];
  className?: string;
}

const TONE: Record<StatTone, { border: string; pill: string }> = {
  brand: { border: 'border-l-brand-500', pill: 'bg-brand-50 text-brand-600' },
  emerald: { border: 'border-l-emerald-500', pill: 'bg-emerald-50 text-emerald-600' },
  amber: { border: 'border-l-amber-500', pill: 'bg-amber-50 text-amber-600' },
  rose: { border: 'border-l-rose-500', pill: 'bg-rose-50 text-rose-600' },
  sky: { border: 'border-l-sky-500', pill: 'bg-sky-50 text-sky-600' },
  slate: { border: 'border-l-slate-300', pill: 'bg-slate-100 text-slate-500' },
};

/**
 * Dense KPI strip: 2-up on mobile, 4-up on lg. Each tile is a rounded card with
 * an optional tone accent (left border + icon pill tint) and a tabular value.
 */
export function StatStrip({ items, className }: StatStripProps): JSX.Element {
  return (
    <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
      {items.map((item, i) => {
        const tone = item.tone ? TONE[item.tone] : null;
        return (
          <div
            key={i}
            className={cn(
              'relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm',
              tone && cn('border-l-4', tone.border),
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {item.label}
              </p>
              {item.icon && (
                <span
                  className={cn(
                    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    tone ? tone.pill : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {item.icon}
                </span>
              )}
            </div>
            <p className="mt-2 text-xl font-bold tabular-nums text-slate-800">{item.value}</p>
            {item.hint != null && (
              <p className="mt-0.5 text-[11px] text-slate-400">{item.hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default StatStrip;
