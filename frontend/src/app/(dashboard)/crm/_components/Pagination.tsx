import { cn } from '@/lib/utils';
import { BUTTON, DEPTH } from '@/components/cockpit/tokens';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  className?: string;
}

/** Build a compact page list with ellipsis: 1 … p-1 p p+1 … N (always shows first + last). */
function buildPages(page: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out: (number | 'gap')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) out.push('gap');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < totalPages - 1) out.push('gap');
  out.push(totalPages);
  return out;
}

/**
 * Compact pager: "◄ 1 2 3 … N ►" + "X–Y / total" recap.
 * Pure presentational — no client hooks. Tabular-nums, keyboard-focusable,
 * aria-current on the active page, disabled at bounds.
 */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (clamped - 1) * pageSize + 1;
  const to = Math.min(clamped * pageSize, total);
  const pages = buildPages(clamped, totalPages);

  const arrow = cn(BUTTON.icon, 'h-7 w-7');
  const go = (p: number) => p !== clamped && p >= 1 && p <= totalPages && onPageChange(p);

  return (
    <nav
      aria-label="Phân trang"
      className={cn('flex items-center justify-between gap-3 tabular-nums', className)}
    >
      <span className="text-[12px] text-slate-500">
        {from}–{to} <span className="text-slate-300">/</span> {total.toLocaleString('vi-VN')}
      </span>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Trang trước"
          className={arrow}
          disabled={clamped <= 1}
          onClick={() => go(clamped - 1)}
        >
          ◄
        </button>

        {pages.map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} aria-hidden className="px-1 text-[12px] text-slate-300 select-none">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-label={`Trang ${p}`}
              aria-current={p === clamped ? 'page' : undefined}
              className={cn(
                BUTTON.ghost,
                DEPTH.focusRing,
                'h-7 min-w-7 px-2 text-[12px] font-semibold tabular-nums',
                p === clamped
                  ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50'
                  : 'text-slate-600',
              )}
              onClick={() => go(p)}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          aria-label="Trang sau"
          className={arrow}
          disabled={clamped >= totalPages}
          onClick={() => go(clamped + 1)}
        >
          ►
        </button>
      </div>
    </nav>
  );
}
