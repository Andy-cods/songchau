'use client';

import { Paperclip } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface AttachmentDotProps {
  /** Number of attached files on this line. Renders nothing when 0. */
  count: number;
  onClick: () => void;
  /** Tooltip — e.g. the joined filenames the page passes in. */
  title?: string;
  className?: string;
}

/**
 * Compact 📎 button with an optional count badge for the per-line File column.
 *
 * Renders NOTHING when count === 0. `onClick` is supplied by the page and reuses
 * the existing Bearer-token blob → object-URL download pattern (the page owns the
 * endpoint wiring). Pure presentation.
 */
export function AttachmentDot({
  count,
  onClick,
  title,
  className,
}: AttachmentDotProps): JSX.Element | null {
  if (!count) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? `${count} tệp đính kèm`}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-500',
        'transition-colors hover:bg-brand-50 hover:text-brand-700',
        'focus:outline-none focus:ring-2 focus:ring-brand-100',
        className,
      )}
    >
      <Paperclip className="h-3.5 w-3.5" />
      {count > 1 && <span className="font-mono text-[10px] tabular-nums">{count}</span>}
    </button>
  );
}

export default AttachmentDot;
