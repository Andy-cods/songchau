import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Optional value tint (functional palette). Omit for default slate-800 value.
export type FieldTone = 'emerald' | 'amber' | 'rose' | 'sky' | 'slate' | 'brand';

export interface Field {
  label: ReactNode;
  /** Any ReactNode — string, number, a <Badge/>, a link, etc. */
  value: ReactNode;
  /** Render the value in font-mono (codes, dates, money). */
  mono?: boolean;
  tone?: FieldTone;
  /** Span N grid columns (e.g. 2 for a long address). Default 1. */
  colSpan?: number;
}

export interface FieldGridProps {
  fields: Field[];
  /** Max columns at lg. Default 4. The grid steps 2 → 3 → 4 across breakpoints. */
  cols?: 2 | 3 | 4;
  className?: string;
}

const VALUE_TONE: Record<FieldTone, string> = {
  emerald: 'text-emerald-700',
  amber: 'text-amber-700',
  rose: 'text-rose-700',
  sky: 'text-sky-700',
  slate: 'text-slate-800',
  brand: 'text-brand-700',
};

// Static maps so Tailwind's JIT scanner sees every class literally.
const COLS_CLASS: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
};

const SPAN_CLASS: Record<number, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-2 md:col-span-3',
  4: 'col-span-2 md:col-span-3 lg:col-span-4',
};

/**
 * Dense label/value detail grid for entity headers (contract/PO/quote detail).
 * Micro uppercase label + a text-sm value; values may be any ReactNode.
 */
export function FieldGrid({ fields, cols = 4, className }: FieldGridProps): JSX.Element {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', COLS_CLASS[cols], className)}>
      {fields.map((f, i) => (
        <div key={i} className={SPAN_CLASS[f.colSpan ?? 1] ?? 'col-span-1'}>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {f.label}
          </dt>
          <dd
            className={cn(
              'mt-0.5 text-sm',
              f.mono && 'font-mono tabular-nums',
              f.tone ? VALUE_TONE[f.tone] : 'text-slate-800',
            )}
          >
            {f.value == null || f.value === '' ? <span className="text-slate-400">—</span> : f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default FieldGrid;
