'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatDate, formatMoneyNum } from '@/lib/format';

// ── Column contract ─────────────────────────────────────────────────────────
// Generic, render-or-format driven column. Screen cooks supply EITHER a custom
// `render(row, i)` (wins) OR a `format` shortcut that maps the raw value at
// `row[key]` to a dense, design-system cell (date/money/num/truncate/text).
// `badge` expects the value to already be a ReactNode (e.g. a <StatusChip/>).
export type ColumnAlign = 'left' | 'right' | 'center';

export type ColumnFormat = 'date' | 'money' | 'num' | 'badge' | 'truncate' | 'text';

export interface Column<T> {
  /** Field key on the row; also the React list key for the column. */
  key: keyof T & string;
  /** Header label (uppercase micro-label rendering is handled by the table). */
  header: ReactNode;
  /** Fixed width — number = px, string = a Tailwind width class (e.g. 'w-40'). */
  w?: number | string;
  /** Horizontal alignment of header + body cell. Numbers should use 'right'. */
  align?: ColumnAlign;
  /** Extra classes merged onto every body cell of this column. */
  className?: string;
  /** Custom cell renderer. Takes precedence over `format`. */
  render?: (row: T, index: number) => ReactNode;
  /** Built-in dense formatter applied to row[key] when no `render` is given. */
  format?: ColumnFormat;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  onRowClick?: (row: T, index: number) => void;
  /** Per-row class hook (e.g. urgency tint). Merged after zebra/hover. */
  getRowClassName?: (row: T, index: number) => string | undefined;
  emptyIcon?: ReactNode;
  emptyLabel?: ReactNode;
  /** Sticky <thead> for tall scroll regions. Default true. */
  stickyHeader?: boolean;
  /** Skeleton row count while loading. Default 6. */
  skeletonRows?: number;
}

const ALIGN_CLASS: Record<ColumnAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

// Numbers/money/dates are tabular + mono-leaning for column alignment.
function formatCell(value: unknown, fmt: ColumnFormat): ReactNode {
  switch (fmt) {
    case 'date':
      return <span className="font-mono tabular-nums">{formatDate(value as string)}</span>;
    case 'money':
      return <span className="font-mono tabular-nums">{formatMoneyNum(value as number)}</span>;
    case 'num':
      return <span className="tabular-nums">{value == null ? '—' : String(value)}</span>;
    case 'truncate':
      return <span className="block max-w-[280px] truncate">{(value as ReactNode) ?? '—'}</span>;
    case 'badge':
      return (value as ReactNode) ?? null;
    case 'text':
    default:
      return (value as ReactNode) ?? '—';
  }
}

function widthStyle<T>(col: Column<T>): { className?: string; style?: { width: number } } {
  if (typeof col.w === 'number') return { style: { width: col.w } };
  if (typeof col.w === 'string') return { className: col.w };
  return {};
}

/**
 * Generic dense table engine for the vendor portal.
 *
 * One shared primitive replacing the hand-rolled grid tables across
 * quotes/contracts/orders. Sticky head, zebra rows, hover, horizontal scroll,
 * skeleton loading and an empty state — all driven by a typed Column<T>[].
 */
export function DataTable<T>({
  columns,
  rows,
  loading = false,
  onRowClick,
  getRowClassName,
  emptyIcon,
  emptyLabel = 'Không có dữ liệu',
  stickyHeader = true,
  skeletonRows = 6,
}: DataTableProps<T>): JSX.Element {
  const clickable = Boolean(onRowClick);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-[11px]">
        <thead
          className={cn(
            'bg-slate-50 text-slate-500',
            stickyHeader && 'sticky top-0 z-10',
          )}
        >
          <tr className="border-b border-slate-200">
            {columns.map(col => {
              const w = widthStyle(col);
              return (
                <th
                  key={col.key}
                  scope="col"
                  style={w.style}
                  className={cn(
                    'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap',
                    ALIGN_CLASS[col.align ?? 'left'],
                    w.className,
                  )}
                >
                  {col.header}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, r) => (
              <tr key={`sk-${r}`} aria-hidden="true">
                {columns.map((col, c) => (
                  <td key={col.key} className={cn('px-3 py-2', ALIGN_CLASS[col.align ?? 'left'])}>
                    <div
                      className={cn(
                        'h-3.5 rounded bg-slate-100 animate-pulse',
                        col.align === 'right' && 'ml-auto',
                        col.align === 'center' && 'mx-auto',
                        c === 0 ? 'w-24' : 'w-16',
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  {emptyIcon && <div className="text-slate-300">{emptyIcon}</div>}
                  <span className="text-sm text-slate-500">{emptyLabel}</span>
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={cn(
                  'transition-colors',
                  i % 2 === 1 && 'bg-slate-50/40',
                  'hover:bg-slate-50',
                  clickable && 'cursor-pointer',
                  getRowClassName?.(row, i),
                )}
              >
                {columns.map((col, c) => {
                  const w = widthStyle(col);
                  const content = col.render
                    ? col.render(row, i)
                    : col.format
                      ? formatCell((row as Record<string, unknown>)[col.key], col.format)
                      : ((row as Record<string, unknown>)[col.key] as ReactNode) ?? '—';
                  return (
                    <td
                      key={col.key}
                      style={w.style}
                      className={cn(
                        'px-3 py-2 align-middle text-slate-700',
                        ALIGN_CLASS[col.align ?? 'left'],
                        (col.format === 'money' || col.format === 'num') && 'tabular-nums',
                        c === 0 && 'font-medium text-slate-800',
                        w.className,
                        col.className,
                      )}
                    >
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
