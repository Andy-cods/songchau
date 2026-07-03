'use client';

/**
 * PriceMatrixCell — the hard-to-inline visual atom of the price-matrix hero
 * (vendor-bidding [id]). Trading-terminal cell rendering: mono tabular price,
 * demoted ₫ suffix, lowest = emerald LEFT-RULE (not wash), picked/awarded =
 * violet left-rule + ring, column crosshair, lowest-only dimming.
 *
 * PRESERVE all award mechanics in the PAGE — this is presentation only. The
 * page owns selection/award handlers; it passes `state` + an onClick.
 *
 * Also exports MatrixFreezeCol (sticky-left item col wrapper with Tier3 freeze
 * shadow) and matrixCellClass() for callers that render their own <td>.
 */

import { type ReactNode } from 'react';
import { Award } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TYPE, MATRIX } from './tokens';

export type MatrixCellState = 'default' | 'lowest' | 'picked' | 'awarded';

export interface PriceMatrixCellProps {
  /** Pre-formatted price string (page formats with its own fmtMoney). null = no quote. */
  price: ReactNode;
  /** Demoted currency suffix (₫ / $). */
  unit?: string;
  state?: MatrixCellState;
  /** True when this column is hovered → crosshair wash. */
  colHovered?: boolean;
  /** Dim because lowest-only toggle is on and this isn't the lowest. */
  dimmed?: boolean;
  /** Hover handlers for column crosshair (page wires colIndex). */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
  /** Secondary line under the price (e.g. lead-time). */
  sub?: ReactNode;
  className?: string;
}

/** Compute the cell className for callers rendering their own <td>. */
export function matrixCellClass(
  state: MatrixCellState = 'default',
  opts: { colHovered?: boolean; dimmed?: boolean; interactive?: boolean } = {},
): string {
  return cn(
    'px-3 py-2 text-right align-middle transition-colors duration-150',
    opts.interactive && 'cursor-pointer',
    // Left-rule states (RULE not wash)
    state === 'lowest' && MATRIX.lowest,
    state === 'picked' && MATRIX.picked,
    state === 'awarded' && MATRIX.awarded,
    // Column crosshair (only when not carrying a stronger ring state)
    opts.colHovered && state === 'default' && MATRIX.colHover,
    opts.colHovered && state === 'lowest' && MATRIX.colHover,
  );
}

export function PriceMatrixCell({
  price,
  unit,
  state = 'default',
  colHovered,
  dimmed,
  onMouseEnter,
  onMouseLeave,
  onClick,
  sub,
  className,
}: PriceMatrixCellProps) {
  const isEmpty = price == null || price === '' || price === '—';
  const strong = state === 'lowest';
  return (
    <td
      className={cn(
        matrixCellClass(state, { colHovered, dimmed, interactive: !!onClick }),
        className,
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <div className="flex items-center justify-end gap-1">
        {state === 'awarded' && (
          <Award className="h-3.5 w-3.5 text-brand-600" strokeWidth={2.5} aria-label="Đã trao thầu" />
        )}
        <span
          className={cn(
            TYPE.matrixPrice,
            isEmpty && 'text-slate-300',
            strong && MATRIX.lowestText,
            state === 'awarded' && 'font-bold text-brand-700',
            state === 'picked' && 'font-semibold text-brand-700',
            dimmed && !strong && state === 'default' && MATRIX.dimmed,
          )}
        >
          {isEmpty ? '—' : price}
          {!isEmpty && unit && <span className={TYPE.currencySuffix}>{unit}</span>}
        </span>
      </div>
      {sub && <div className="mt-0.5 text-right text-[11px] text-slate-400">{sub}</div>}
    </td>
  );
}

// ─── Sticky-left item column (Tier3 freeze shadow on scrollX) ─────────────

export interface MatrixFreezeColProps {
  children: ReactNode;
  /** Apply the freeze shadow (page sets true once scrollLeft > 0). */
  scrolled?: boolean;
  /** Render as <th> instead of <td>. */
  as?: 'th' | 'td';
  /** left offset (sticky). Default 0. */
  className?: string;
}

export function MatrixFreezeCol({
  children,
  scrolled,
  as = 'td',
  className,
}: MatrixFreezeColProps) {
  const Tag = as;
  return (
    <Tag
      className={cn(
        'sticky left-0 z-10 bg-white px-3 py-2 text-left',
        scrolled && MATRIX.freezeCol,
        className,
      )}
    >
      {children}
    </Tag>
  );
}

// ─── Vendor header cell — 2-line stack (name + status dot + label + radio) ──

export interface MatrixVendorHeadProps {
  name: ReactNode;
  /** Status dot tone class, e.g. "bg-sky-500". */
  dotClass?: string;
  /** Status label (muted, NOT a saturated pill). */
  statusLabel?: ReactNode;
  /** Column-pick radio slot (page owns the input). */
  control?: ReactNode;
  colHovered?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  className?: string;
}

export function MatrixVendorHead({
  name,
  dotClass,
  statusLabel,
  control,
  colHovered,
  onMouseEnter,
  onMouseLeave,
  className,
}: MatrixVendorHeadProps) {
  return (
    <th
      scope="col"
      className={cn(
        'px-3 py-2 text-right align-bottom transition-colors duration-150',
        colHovered && MATRIX.colHover,
        className,
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          {control}
          <span className="text-[12px] font-semibold normal-case tracking-normal text-slate-700">
            {name}
          </span>
        </div>
        {statusLabel && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
            {dotClass && <span className={cn('h-[5px] w-[5px] rounded-full', dotClass)} />}
            {statusLabel}
          </span>
        )}
      </div>
    </th>
  );
}
