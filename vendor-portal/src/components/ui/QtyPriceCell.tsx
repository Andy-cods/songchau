'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMoneyNum } from '@/lib/format';

export interface QtyPriceCellProps {
  /** Controlled numeric value; null/'' renders an empty input. */
  value: number | string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Prior-round value shown as a ghost line beneath, with a Δ% arrow. */
  prev?: number | null;
  /** Trailing unit suffix inside the field (e.g. 'VND', '₫'). */
  suffix?: string;
  align?: 'left' | 'right';
  placeholder?: string;
  className?: string;
  /** Optional aria-label forwarded to the underlying <input>. */
  ariaLabel?: string;
  /** data-cell key forwarded to the <input> for keyboard grid navigation. */
  dataCell?: string;
  /** onPaste forwarded to the <input> (e.g. paste-from-Excel fill-down). */
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
}

// Δ% of current vs prev. Down (cheaper) is good → emerald; up → rose. Returns
// null when it can't be computed (no prev, prev=0, or current not a number).
function computeDelta(value: number | string | null, prev?: number | null) {
  if (prev == null || prev === 0) return null;
  const cur = typeof value === 'string' ? parseFloat(value) : value;
  if (cur == null || !Number.isFinite(cur)) return null;
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) return { pct: 0, dir: 'flat' as const };
  return { pct, dir: pct < 0 ? ('down' as const) : ('up' as const) };
}

/**
 * Dense numeric input cell for the quote grid: right-aligned tabular input with
 * an optional ghost "lần trước" prior value + Δ% arrow beneath it. Down = cheaper
 * = emerald (good for the buyer), up = rose.
 */
export function QtyPriceCell({
  value,
  onChange,
  disabled = false,
  prev,
  suffix,
  align = 'right',
  placeholder = '0',
  className,
  ariaLabel,
  dataCell,
  onPaste,
}: QtyPriceCellProps): JSX.Element {
  const delta = computeDelta(value, prev);

  return (
    <div className={cn('inline-flex flex-col', align === 'right' ? 'items-end' : 'items-start', className)}>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          value={value ?? ''}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel}
          data-cell={dataCell}
          onPaste={onPaste}
          onChange={e => onChange(e.target.value)}
          className={cn(
            'h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm tabular-nums text-slate-800',
            'focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
            suffix ? 'pr-9' : '',
            align === 'right' ? 'text-right' : 'text-left',
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
            {suffix}
          </span>
        )}
      </div>
      {prev != null && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
          <span className="tabular-nums">lần trước: {formatMoneyNum(prev)}</span>
          {delta && delta.dir !== 'flat' && (
            <span
              className={cn(
                'inline-flex items-center font-semibold tabular-nums',
                delta.dir === 'down' ? 'text-emerald-600' : 'text-rose-600',
              )}
            >
              {delta.dir === 'down' ? (
                <ArrowDown className="h-3 w-3" />
              ) : (
                <ArrowUp className="h-3 w-3" />
              )}
              {Math.abs(delta.pct).toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default QtyPriceCell;
