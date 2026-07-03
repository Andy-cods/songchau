'use client';

/**
 * ItemDescCell — 3-tier item-identity cell for the Đấu thầu NCC drawer/matrix.
 *
 * Tier 1 — item_code ?? bqms_code, rendered in TYPE.code (mono brand-700).
 * Tier 2 — full specification (NOT truncated when truncate=false — the default);
 *          set truncate to clamp to one line (matrix item-col reuse, M2).
 * Tier 3 — required_material · part · maker joined with '·' in text-[11px]
 *          text-slate-400 (the demoted meta line).
 *
 * Pure presentation, NO data fetch. Mirror of the vendor-portal ItemDescCell
 * (identical prop contract) so both apps read the same — DRY across apps but
 * each keeps its own file (frontend ↔ vendor-portal cannot cross-import).
 */

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TYPE } from './tokens';

export interface ItemDescCellProps {
  /** Tier 1 — item code / bqms_code. */
  code?: ReactNode;
  /** Tier 2 — full specification. */
  spec?: ReactNode;
  /** Tier 3 — required material. */
  material?: string | null;
  /** Tier 3 — part / drawing no. */
  part?: string | null;
  /** Tier 3 — maker. */
  maker?: string | null;
  /** Clamp the spec to a single line (matrix reuse). Default false = full. */
  truncate?: boolean;
  className?: string;
}

export function ItemDescCell({
  code,
  spec,
  material,
  part,
  maker,
  truncate = false,
  className,
}: ItemDescCellProps) {
  // Tier 3 meta segments — drop empties, join with a middot.
  const meta = [material, part, maker].filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0,
  );

  const hasCode = code != null && code !== '';
  const hasSpec = spec != null && spec !== '';

  return (
    <div className={cn('min-w-0', className)}>
      {hasCode && <div className={TYPE.code}>{code}</div>}
      {hasSpec && (
        <div
          className={cn(
            'text-[11px] text-slate-600',
            truncate ? 'truncate' : 'whitespace-pre-wrap break-words',
          )}
          title={truncate && typeof spec === 'string' ? spec : undefined}
        >
          {spec}
        </div>
      )}
      {meta.length > 0 && (
        <div className="mt-0.5 text-[11px] text-slate-400">{meta.join(' · ')}</div>
      )}
      {!hasCode && !hasSpec && meta.length === 0 && (
        <span className="text-slate-300">—</span>
      )}
    </div>
  );
}
