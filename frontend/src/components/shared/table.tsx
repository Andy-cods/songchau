'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Table — the ONE low-level table primitive (premium-enterprise flat).
 *
 * Standardises the ~7 copy-pasted <table> markups into one set of parts with a
 * SINGLE <th> definition: font-mono uppercase tracking-wider text-slate-400
 * px-4 py-3. Wide tables never bleed because <Table> wraps the element in an
 * overflow-x-auto scroller by default (set `wrap={false}` to opt out).
 *
 * Dark mode is baked into every part. Use together with <Card padded={false}>
 * for a bordered, scrollable data surface, e.g.:
 *
 *   <Card padded={false} className="overflow-hidden">
 *     <Table>
 *       <TableHeader><TableRow>
 *         <TableHead>Mã</TableHead><TableHead>Tên</TableHead>
 *       </TableRow></TableHeader>
 *       <TableBody>
 *         <TableRow><TableCell>…</TableCell><TableCell>…</TableCell></TableRow>
 *       </TableBody>
 *     </Table>
 *   </Card>
 *
 * For full sort/search/pagination prefer the higher-level <DataTable>
 * (components/shared/data-table.tsx); reach for these parts when a page needs a
 * bespoke table but should still match the one canonical th/cell style.
 */

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** Wrap in an overflow-x-auto scroller so wide tables never bleed. */
  wrap?: boolean;
  /** className for the wrapping scroller (only when wrap=true). */
  wrapperClassName?: string;
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, wrap = true, wrapperClassName, ...props }, ref) => {
    const table = (
      <table
        ref={ref}
        className={cn('w-full border-collapse text-sm', className)}
        {...props}
      />
    );
    if (!wrap) return table;
    return <div className={cn('overflow-x-auto', wrapperClassName)}>{table}</div>;
  },
);
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40',
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('divide-y divide-slate-100 dark:divide-slate-800', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'px-4 py-3 text-left text-xs font-mono font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn('px-4 py-3 text-slate-700 dark:text-slate-300', className)}
    {...props}
  />
));
TableCell.displayName = 'TableCell';
