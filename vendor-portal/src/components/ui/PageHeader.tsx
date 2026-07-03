import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: ReactNode;
  /** Optional "(N)" count shown next to the title. */
  count?: number;
  /** Optional subtitle line under the title. */
  subtitle?: ReactNode;
  /** Right-aligned actions slot (buttons, search, filters). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard list/detail page header: title + optional count, with a right-slot
 * for actions. Wraps gracefully on narrow screens.
 */
export function PageHeader({
  title,
  count,
  subtitle,
  actions,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h1 className="flex items-baseline gap-2 text-xl font-bold text-slate-800">
          {title}
          {count != null && (
            <span className="text-base font-semibold tabular-nums text-slate-400">({count})</span>
          )}
        </h1>
        {subtitle != null && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions != null && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export default PageHeader;
