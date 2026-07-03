import { cn } from '@/lib/cn';
import { formatMoneyNum } from '@/lib/format';

export interface CurrencyTotal {
  currency: string;
  amount: number;
}

export interface CurrencyTotalRowProps {
  /** One entry PER currency. VND/USD/RMB are NEVER summed across currencies. */
  totals: CurrencyTotal[];
  /** Leading caption (default 'Tổng'). */
  label?: string;
  className?: string;
}

/**
 * One tabular total line PER currency, e.g.
 *   Tổng   12.400 USD · 4.500.000 VND
 * so multi-currency quote lines are summed WITHIN a currency and never across
 * them. Footer of the read-only quote table.
 *
 * The page derives `totals` by grouping its quote items on
 * (item.currency || quote.currency) and summing line_total = unit_price ×
 * offered_qty (skipping can_do===false and free_charge lines). Mono tabular-nums.
 *
 * MIRROR: identical contract to the admin cockpit CurrencyTotalRow.
 */
export function CurrencyTotalRow({
  totals,
  label = 'Tổng',
  className,
}: CurrencyTotalRowProps): JSX.Element | null {
  if (!totals.length) return null;

  return (
    <div className={cn('flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1', className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {totals.map((t, i) => (
        <span key={t.currency} className="inline-flex items-baseline gap-1">
          {i > 0 && <span className="text-slate-300">·</span>}
          <span className="font-mono text-sm font-bold tabular-nums text-brand-700">
            {formatMoneyNum(t.amount, t.currency)}
          </span>
        </span>
      ))}
    </div>
  );
}

export default CurrencyTotalRow;
