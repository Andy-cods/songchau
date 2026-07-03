import { cn } from '@/lib/cn';

/**
 * Canonical ERP status pill for the vendor portal.
 *
 * ONE shared primitive that eliminates the StatusBadge triplication across
 * quotes/page, contracts/page and contracts/[id]/page. All status semantics
 * (label + color tokens) stay in lib/format — this component only renders the
 * resolved cfg as the canonical rounded-full pill (ring-1 ring-inset + optional
 * leading dot), following the ERP design system.
 *
 * Usage:
 *   <Badge {...quoteStatusCfg(status)} />
 *   <Badge {...contractStatusCfg(c.status)} withDot />
 */
export function Badge({
  label,
  className,
  withDot = false,
}: {
  label: string;
  className: string;
  withDot?: boolean;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset',
        className,
      )}
    >
      {withDot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {label}
    </span>
  );
}
