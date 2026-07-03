'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/utils';

export interface StatusPillOption<V extends string = string> {
  /** Unique identifying value. */
  value: V;
  /** Visible label. */
  label: string;
  /** Optional count badge. */
  count?: number;
}

interface StatusPillRowProps<V extends string = string> {
  /** Pill definitions. */
  options: ReadonlyArray<StatusPillOption<V>>;
  /** Currently selected value. */
  value: V;
  /** Selection handler. */
  onChange: (value: V) => void;
  /** Accessible group label. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Status pill row — accessible radiogroup.
 *
 * Implements the WAI-ARIA radio pattern:
 *   - role="radiogroup" wrapper + role="radio" pills
 *   - Roving tabindex: only the selected pill has tabIndex=0
 *   - Arrow Left/Right/Up/Down move selection AND focus (wraps)
 *   - Home/End jump to first/last
 *   - Space/Enter re-selects current (no-op when already selected)
 *
 * Finding #3 fix: focus is shifted PROGRAMMATICALLY via refs.current[idx]?.focus()
 * inside requestAnimationFrame so React commits the new tabIndex before the
 * browser tries to focus — otherwise the focus call lands on a stale node.
 */
export function StatusPillRow<V extends string = string>({
  options,
  value,
  onChange,
  ariaLabel = 'Lọc trạng thái',
  className,
}: StatusPillRowProps<V>) {
  const groupId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // Index of the currently selected option. Falls back to 0 if value is unknown.
  const selectedIndex = useMemo(() => {
    const i = options.findIndex((o) => o.value === value);
    return i === -1 ? 0 : i;
  }, [options, value]);

  // Keep the ref array length in sync with options length to avoid leaks.
  useEffect(() => {
    refs.current = refs.current.slice(0, options.length);
  }, [options.length]);

  const moveTo = useCallback(
    (nextIndex: number) => {
      const len = options.length;
      if (len === 0) return;
      // Wrap around.
      const idx = ((nextIndex % len) + len) % len;
      const next = options[idx];
      if (!next) return;
      onChange(next.value);
      // Finding #3: focus AFTER React commits the new tabIndex.
      // requestAnimationFrame ensures the re-render has run.
      requestAnimationFrame(() => {
        refs.current[idx]?.focus();
      });
    },
    [options, onChange],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          moveTo(index + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          moveTo(index - 1);
          break;
        case 'Home':
          e.preventDefault();
          moveTo(0);
          break;
        case 'End':
          e.preventDefault();
          moveTo(options.length - 1);
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          // Re-confirm current; no movement.
          onChange(options[index].value);
          break;
        default:
          break;
      }
    },
    [moveTo, onChange, options],
  );

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      id={groupId}
      className={cn('inline-flex flex-wrap items-center gap-1.5', className)}
    >
      {options.map((opt, index) => {
        const isSelected = index === selectedIndex;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              'border transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-1',
              isSelected
                ? 'border-brand-300 bg-brand-50 text-brand-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none',
                  isSelected
                    ? 'bg-brand-100 text-brand-700'
                    : 'bg-slate-100 text-slate-600',
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
