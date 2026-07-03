'use client';

/**
 * useDebouncedValue — return a value that only updates after `delay`ms of
 * stillness. ICE frontend #1 (Thang 2026-06-13): wrapping the sourcing-page
 * search input in this hook turns a 5-10x-per-second tanstack-query refetch
 * (one per keystroke) into a single request after the user pauses typing.
 *
 * Usage:
 *   const [searchInput, setSearchInput] = useState('');
 *   const debouncedSearch = useDebouncedValue(searchInput, 300);
 *   // Use debouncedSearch in queryKey / params, searchInput in the <input>.
 */
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value);
      return;
    }
    const handle = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(handle);
  }, [value, delay]);

  return debounced;
}

export default useDebouncedValue;
