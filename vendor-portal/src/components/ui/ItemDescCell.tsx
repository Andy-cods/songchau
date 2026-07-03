import { cn } from '@/lib/cn';

export interface ItemDescCellProps {
  /** Tier 1 — the BQMS / item code, rendered in the mono brand code token. */
  code?: string | null;
  /** Tier 2 — full specification; NOT truncated when truncate=false (default). */
  spec?: string | null;
  /** Tier 3 fragments — joined with ' · ' beneath the spec in a muted micro line. */
  material?: string | null;
  part?: string | null;
  maker?: string | null;
  model?: string | null;
  /** When true, clamp the spec to a single truncated line (matrix reuse). Default false. */
  truncate?: boolean;
  className?: string;
}

/**
 * 3-tier item identity stack for the vendor-portal read-only quote table.
 *
 *   Tier 1  bqms_code            font-mono text-brand-700 (the code token)
 *   Tier 2  specification        full, NOT truncated when truncate=false (default)
 *   Tier 3  material · part · maker · model   text-[11px] text-slate-400
 *
 * Replaces the old Item + Vật liệu two-column pair so the description densifies
 * by typography rather than by extra columns. Pure presentation — no data fetch.
 *
 * MIRROR: this is the vendor-portal twin of the admin cockpit ItemDescCell. Both
 * apps keep their OWN file (frontend↔vendor-portal cannot cross-import) but share
 * the IDENTICAL 3-tier prop contract so the two webs read the same.
 */
export function ItemDescCell({
  code,
  spec,
  material,
  part,
  maker,
  model,
  truncate = false,
  className,
}: ItemDescCellProps): JSX.Element {
  const tier3 = [material, part, maker, model].filter(Boolean).join(' · ');

  return (
    <div className={cn('min-w-0 leading-tight', className)}>
      {code && (
        <span className="block font-mono text-[11px] font-semibold text-brand-700">{code}</span>
      )}
      <span
        className={cn(
          'block text-[12px] text-slate-700',
          code && 'mt-0.5',
          truncate && 'truncate',
        )}
        title={truncate ? (spec ?? undefined) : undefined}
      >
        {spec || <span className="text-slate-400">—</span>}
      </span>
      {tier3 && <span className="mt-0.5 block text-[11px] text-slate-400">{tier3}</span>}
    </div>
  );
}

export default ItemDescCell;
