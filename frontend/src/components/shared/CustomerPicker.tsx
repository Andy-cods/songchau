'use client';

/**
 * CustomerPicker — debounced async autocomplete for selecting a CRM customer.
 *
 * Reuses the debounce + autocomplete + `api` pattern from
 * components/shared/price-lookup.tsx and the cockpit design tokens
 * (ONE indigo brand token + slate ramp, 8pt grid, no rainbow/gradient/orbs).
 *
 * Behaviour:
 *  - Typing (≥1 char) debounces 250ms → GET /api/v1/crm/customers/search?q=&limit=10
 *  - Dropdown lists company_name + (code · MST), keyboard navigable (↑ ↓ Enter Esc)
 *  - Selecting → onChange(picked). When a value is set, the input collapses to a
 *    compact chip "company · MST" with an ✕ clear button.
 *
 * Pure client component. No external lib.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X, Building2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DEPTH, ELEVATION } from '@/components/cockpit/tokens';

// ─── Shared contract type (imported by QuoteBatchModal + HoSoTab) ──────────
export type PickedCustomer = {
  id: number;
  customer_code: string | null;
  company_name: string;
  short_name: string | null;
  tax_code: string | null;
  address: string | null;
  business_system: string | null;
  primary_contact: { full_name: string; phone: string | null; email: string | null } | null;
};

export interface CustomerPickerProps {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Build the muted "code · MST" sub-line for a customer. */
function subLine(c: PickedCustomer): string {
  const parts = [c.customer_code, c.tax_code ? `MST ${c.tax_code}` : null].filter(Boolean);
  return parts.join(' · ');
}

export function CustomerPicker({
  value,
  onChange,
  placeholder = 'Tìm khách hàng (tên / mã / MST)…',
  autoFocus,
  disabled,
  className,
}: CustomerPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Debounced search (250ms) — mirrors price-lookup.tsx.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ data: PickedCustomer[] }>(
          `/api/v1/crm/customers/search?q=${encodeURIComponent(q)}&limit=10`,
        );
        setResults(res.data || []);
        setActive(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const pick = (c: PickedCustomer) => {
    onChange(c);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setQuery('');
    setResults([]);
    // Return focus to the input so the user can immediately re-search.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) {
      if (e.key === 'ArrowDown' && results.length > 0) setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = results[active];
      if (c) pick(c);
    }
  };

  const showDropdown = open && query.trim().length >= 1;

  // ─── Locked chip when a value is selected ────────────────────────────────
  if (value) {
    const chipSub = value.tax_code ? `MST ${value.tax_code}` : value.customer_code || '—';
    return (
      <div className={cn('inline-flex max-w-full items-center', className)}>
        <span
          className={cn(
            'inline-flex min-w-0 items-center gap-2 rounded-md bg-brand-50 px-2.5 py-1.5',
            'text-[13px] ring-1 ring-inset ring-brand-200',
          )}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-brand-600" />
          <span className="min-w-0 truncate font-semibold text-brand-800">{value.company_name}</span>
          <span className="shrink-0 font-mono text-[11px] text-brand-500">· {chipSub}</span>
          {!disabled && (
            <button
              type="button"
              onClick={clear}
              aria-label="Bỏ chọn khách hàng"
              className={cn(
                'ml-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full',
                'text-brand-500 hover:bg-brand-100 hover:text-brand-700',
                DEPTH.focusRing,
              )}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      </div>
    );
  }

  // ─── Search input + dropdown ─────────────────────────────────────────────
  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200',
          'transition-colors focus-within:ring-2 focus-within:ring-brand-500',
          disabled && 'opacity-50',
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Xóa tìm kiếm"
            className="shrink-0 text-slate-400 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          className={cn(
            'absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg',
            ELEVATION.container,
            ELEVATION.floating,
            DEPTH.divider,
          )}
        >
          {loading && results.length === 0 ? (
            <div className="space-y-2 p-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-slate-400">
              Không tìm thấy khách hàng cho “{query.trim()}”.
            </div>
          ) : (
            results.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left',
                  i === active ? DEPTH.activeWash : 'hover:bg-slate-50',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-slate-800">
                    {c.company_name}
                  </div>
                  {subLine(c) && (
                    <div className="truncate font-mono text-[11px] text-slate-400">{subLine(c)}</div>
                  )}
                </div>
                {c.primary_contact?.full_name && (
                  <span className="shrink-0 truncate text-[11px] text-slate-400">
                    {c.primary_contact.full_name}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
