'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Card / Panel — the ONE surface primitive (premium-enterprise flat).
 *
 * Design law (single radius/border/shadow — replaces the rounded-lg/2xl/[28px]
 * + shadow-sm/md/lg soup):
 *   - rounded-xl + border-slate-200 + shadow-sm
 *   - NO hover:-translate, NO decorative accent stripe, NO gradient
 *   - Dark mode baked in (dark:bg-slate-900 / dark:border-slate-800 / text)
 *
 * Composable parts: <Card> wraps, <CardHeader> / <CardTitle> / <CardContent>
 * / <CardFooter> for the common header+body+footer layout. All optional — a
 * bare <Card> is just a padded surface (use `padded={false}` to remove padding
 * when the child manages its own, e.g. a table).
 */

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Apply default p-5 padding. Set false for tables / custom inner padding. */
  padded?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, padded = true, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-sm',
        'dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100',
        padded && 'p-5',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800',
      className,
    )}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      'text-[15px] font-semibold text-slate-900 dark:text-slate-100',
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('px-5 py-4', className)} {...props} />
));
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800',
      className,
    )}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';
