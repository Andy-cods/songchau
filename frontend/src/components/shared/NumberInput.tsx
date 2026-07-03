'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * NumberInput — emits a plain JS number via `onChange(number | null)` and shows
 * vi-VN thousand separators (1.234.567).
 *
 * Caret bug-proof by design (Thang 2026-06-17, redo): while the field is
 * FOCUSED we show the raw text the user is typing (no per-keystroke
 * reformatting → the cursor never jumps / inserts stray digits). On BLUR we show
 * the grouped value. Simple and correct beats clever-but-fragile caret restore.
 */
export interface NumberInputProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  /** Decimal places allowed (default 0 = integer). vi-VN decimal sep = ",". */
  decimals?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Right-aligned static suffix, e.g. "₫" / "%" / "kg". */
  suffix?: ReactNode;
  id?: string;
  'aria-label'?: string;
}

function groupVi(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Parse a free-typed string. vi-VN: "." groups, "," is the decimal sep. Lenient:
 * integer-only strips every separator; with decimals > 0 the LAST comma is the
 * decimal point and dots are grouping.
 */
function parseNum(raw: string, decimals: number): number | null {
  let s = (raw || '').trim();
  if (!s) return null;
  const neg = s.startsWith('-');
  if (decimals > 0) {
    s = s.replace(/[^0-9.,]/g, '');
    const lastComma = s.lastIndexOf(',');
    let intp = s;
    let fracp = '';
    if (lastComma >= 0) {
      intp = s.slice(0, lastComma);
      fracp = s.slice(lastComma + 1);
    }
    intp = intp.replace(/\D/g, '');
    fracp = fracp.replace(/\D/g, '').slice(0, decimals);
    if (!intp && !fracp) return null;
    const n = Number((intp || '0') + (fracp ? '.' + fracp : '')) * (neg ? -1 : 1);
    return Number.isFinite(n) ? n : null;
  }
  const d = s.replace(/\D/g, '');
  if (!d) return null;
  const n = Number(d) * (neg ? -1 : 1);
  return Number.isFinite(n) ? n : null;
}

export function NumberInput({
  value,
  onChange,
  decimals = 0,
  placeholder,
  disabled,
  className,
  suffix,
  id,
  'aria-label': ariaLabel,
}: NumberInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  // Postgres NUMERIC columns serialize as STRINGS in JSON ("12000.00"), so a
  // parent may hand us a string. Coerce to a real number here — otherwise
  // Number.isFinite() on a string is false and the field renders EMPTY.
  const numValue: number | null =
    value == null ? null : typeof value === 'number' ? value : Number(value as unknown as string);

  const grouped = numValue == null || !Number.isFinite(numValue) ? '' : groupVi(numValue, decimals);
  const display = focused ? draft : grouped;

  return (
    <div className={cn('relative flex items-center', disabled && 'opacity-60')}>
      <input
        id={id}
        aria-label={ariaLabel}
        type="text"
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        value={display}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => {
          setFocused(true);
          // Seed the draft with a clean editable number (no grouping dots).
          setDraft(
            numValue == null || !Number.isFinite(numValue)
              ? ''
              : decimals > 0
              ? String(numValue).replace('.', ',')
              : String(Math.round(numValue)),
          );
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          onChange(parseNum(raw, decimals));
        }}
        className={cn(
          'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 tabular-nums placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition-all',
          suffix && 'pr-9',
          disabled && 'bg-slate-50 cursor-not-allowed',
          className,
        )}
      />
      {suffix && (
        <span className="absolute right-3 text-slate-400 text-sm font-bold pointer-events-none tabular-nums">
          {suffix}
        </span>
      )}
    </div>
  );
}

export default NumberInput;
