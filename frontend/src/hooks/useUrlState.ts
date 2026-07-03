'use client';

// Generic URL-state sync hook — Thang 2026-06-04.
//
// Keeps a piece of React state mirrored to a URL search param so the user can
// share / bookmark / back-button the page in any filter / view configuration.
//
// Design:
//   - Reads the initial value from the URL on first render (so deep links work).
//   - Writes back to the URL with `router.replace(..., { scroll: false })` —
//     no new history entry per keystroke, no scroll-jump.
//   - Default serializer handles string / number / boolean / string[] / number[].
//     Complex objects can pass custom `serialize` / `deserialize`.
//   - Empty values (null, undefined, '', []) are stripped from the URL to keep
//     it readable (the param simply disappears instead of `?key=`).
//
// Usage:
//
//   const [years, setYears] = useUrlState<number[]>('years', [2026]);
//   const [hs, setHs] = useUrlState<string>('hs', '');
//   const [outliers, setOutliers] = useUrlState<boolean>('outliers', false);
//
// Per-key search params (readable URLs) are preferred over base64 blobs.
//
// SSR note: this is client-only ('use client'). On first render before the
// browser hydrates we read `window.location.search` directly via a lazy
// initializer, falling back to `defaultValue` when window is undefined.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// ──────────────────────────────────────────────────────────────────────────
// Default (de)serializers
// ──────────────────────────────────────────────────────────────────────────

function defaultSerialize<T>(value: T): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? '1' : null; // omit on false
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((v) => (v == null ? '' : String(v))).join(',');
  }
  // Fallback for objects: JSON.
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function defaultDeserialize<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  // Infer target type from `fallback` shape.
  if (typeof fallback === 'string') return raw as unknown as T;
  if (typeof fallback === 'number') {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as unknown as T;
  }
  if (typeof fallback === 'boolean') {
    return (raw === '1' || raw === 'true') as unknown as T;
  }
  if (Array.isArray(fallback)) {
    const parts = raw.split(',').filter((s) => s.length > 0);
    if (fallback.length > 0 && typeof fallback[0] === 'number') {
      return parts.map(Number).filter((n) => Number.isFinite(n)) as unknown as T;
    }
    return parts as unknown as T;
  }
  // Object fallback: try JSON.
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────────────────────────────────

export interface UseUrlStateOptions<T> {
  serialize?: (value: T) => string | null;
  deserialize?: (raw: string | null, fallback: T) => T;
}

export function useUrlState<T>(
  key: string,
  defaultValue: T,
  options?: UseUrlStateOptions<T>,
): [T, (next: T | ((prev: T) => T)) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Capture defaultValue in a ref so its referential instability (consumers
  // often pass new array/object literals every render — e.g. `[CURRENT_YEAR]`,
  // `[]`, `{from, to}`) does not destabilize our (de)serializers. The
  // initial-value at mount time is the one that matters; later changes to the
  // default literal are intentionally ignored.
  const defaultValueRef = useRef<T>(defaultValue);

  // Stable (de)serializers. User-supplied callbacks are wrapped through a ref
  // so consumers may pass new arrow functions every render without churn.
  const userSerializeRef = useRef(options?.serialize);
  const userDeserializeRef = useRef(options?.deserialize);
  userSerializeRef.current = options?.serialize;
  userDeserializeRef.current = options?.deserialize;

  const serialize = useCallback(
    (v: T): string | null =>
      userSerializeRef.current ? userSerializeRef.current(v) : defaultSerialize(v),
    [],
  );
  const deserialize = useCallback(
    (raw: string | null, fb: T): T =>
      userDeserializeRef.current
        ? userDeserializeRef.current(raw, fb)
        : defaultDeserialize(raw, fb),
    [],
  );

  // Lazy init: read URL once. Stays stable across re-renders because we keep
  // local state as the source of truth, only writing back to the URL on change.
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValueRef.current;
    const raw = searchParams?.get(key) ?? null;
    return deserialize(raw, defaultValueRef.current);
  });

  // Track last serialized value to skip redundant URL writes. Initialize from
  // the actual URL (not from serialize(value)) so that on mount we treat the
  // existing URL as already-written and skip the no-op first effect.
  const lastWrittenRef = useRef<string | null>(
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get(key),
  );

  // Sync to URL whenever value changes. Debounced via microtask + rAF to
  // coalesce React 18 batched state updates and avoid a render storm if a
  // consumer effect calls setValue inside a render-triggered useEffect.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next = serialize(value);
    // Compare against last-written AND the actual current URL value. This
    // double-guard prevents redundant router.replace calls when a sibling
    // useUrlState hook just rewrote the URL (which mutates window.location)
    // and our value happens to already match.
    const currentInUrl = new URLSearchParams(window.location.search).get(key);
    if (next === lastWrittenRef.current && next === currentInUrl) return;
    if (next === currentInUrl) {
      // URL already reflects our value (e.g. set by another tab / popstate);
      // just update our ref and skip the write.
      lastWrittenRef.current = next;
      return;
    }

    // Debounce the actual write so multiple state updates in the same tick
    // produce a single router.replace.
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      // Re-read URL at write-time in case a sibling hook wrote between
      // schedule and execution.
      const params = new URLSearchParams(window.location.search);
      if (next == null) {
        params.delete(key);
      } else {
        params.set(key, next);
      }
      const qs = params.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      lastWrittenRef.current = next;
      router.replace(url, { scroll: false });
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // router is stable; serialize/deserialize are useCallback-stable; refs are
    // stable. Only value / key / pathname can meaningfully change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, key, pathname]);

  // Setter passthrough (memoized for callers).
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next));
  }, []);

  return [value, set];
}
