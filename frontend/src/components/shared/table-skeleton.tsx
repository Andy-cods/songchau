'use client';

import { cn } from '@/lib/utils';

interface TableSkeletonProps {
  /** Number of placeholder rows. */
  rows?: number;
  /** Number of placeholder columns. */
  cols?: number;
  /** Render an outer <thead> header row as well. */
  withHeader?: boolean;
  className?: string;
  /** Aria label for the live region. */
  ariaLabel?: string;
}

/**
 * Shimmer placeholder for tables.
 *
 * Renders a <table> with `rows × cols` skeleton cells. Animation is gated
 * behind `motion-safe:` so users with prefers-reduced-motion see a static
 * placeholder. The container is announced as a polite live region.
 */
export function TableSkeleton({
  rows = 6,
  cols = 5,
  withHeader = false,
  className,
  ariaLabel = 'Đang tải dữ liệu',
}: TableSkeletonProps) {
  const rowCount = Math.max(1, rows);
  const colCount = Math.max(1, cols);

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={ariaLabel}
      className={cn('w-full overflow-hidden rounded-lg border border-slate-200 bg-white', className)}
    >
      <table className="w-full">
        {withHeader && (
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {Array.from({ length: colCount }).map((_, c) => (
                <th key={`h-${c}`} className="px-4 py-3 text-left">
                  <div className="h-3 w-20 rounded bg-slate-200 motion-safe:animate-pulse" />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: rowCount }).map((_, r) => (
            <tr key={`r-${r}`} className="border-b border-slate-100 last:border-b-0">
              {Array.from({ length: colCount }).map((_, c) => {
                // Vary widths so the shimmer doesn't look like a perfect grid.
                const widths = ['w-24', 'w-32', 'w-20', 'w-28', 'w-36', 'w-16'];
                const w = widths[(r + c) % widths.length];
                return (
                  <td key={`c-${r}-${c}`} className="px-4 py-3">
                    <div
                      className={cn(
                        'h-3 rounded bg-slate-200 motion-safe:animate-pulse',
                        w,
                      )}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">Đang tải…</span>
    </div>
  );
}
