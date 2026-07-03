'use client';

import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired on Enter or the "Tìm" button. */
  onSubmit?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Dense single-row search: leading icon, h-8 input, indigo "Tìm" button.
 * Submits on Enter or button click; controlled via value/onChange.
 */
export function SearchBar({
  value,
  onChange,
  onSubmit,
  placeholder = 'Tìm kiếm…',
  className,
}: SearchBarProps): JSX.Element {
  const submit = () => onSubmit?.(value);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </div>
      <button
        type="button"
        onClick={submit}
        className="inline-flex h-8 shrink-0 items-center rounded-lg bg-brand-600 px-3 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
      >
        Tìm
      </button>
    </div>
  );
}

export default SearchBar;
