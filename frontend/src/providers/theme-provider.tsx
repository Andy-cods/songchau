'use client';

/**
 * ThemeProvider — Dark mode for Song Chau ERP.
 *
 * Stores user preference in localStorage key 'sc-theme':
 *   'light'  — force light
 *   'dark'   — force dark
 *   'system' — follow OS prefers-color-scheme (default for new users)
 *
 * To prevent flash-of-light when the user has dark mode saved, layout.tsx
 * inlines NO_FLASH_SCRIPT into <head> so the html.dark class is set BEFORE
 * React hydrates.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** User's saved preference (may be 'system'). */
  theme: Theme;
  /** What's actually applied to <html> right now. */
  resolvedTheme: ResolvedTheme;
  /** Set explicit preference. Persists to localStorage. */
  setTheme: (t: Theme) => void;
  /** Cycle: light → dark → system → light. Used by the toggle button. */
  toggleTheme: () => void;
}

const STORAGE_KEY = 'sc-theme';
// Default to LIGHT (Thang 2026-06-15): dark mode is still half-migrated (Phase 2
// codemod not applied) so 'system' on a dark-OS machine rendered many pages with
// broken dark backgrounds. Light is the intended look until dark mode is finished.
const DEFAULT_THEME: Theme = 'light';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
    // Migrate legacy 'theme' key (used by previous skeleton)
    const legacy = window.localStorage.getItem('theme');
    if (legacy === 'light' || legacy === 'dark') return legacy;
  } catch {
    /* localStorage may be blocked */
  }
  return DEFAULT_THEME;
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(_theme: Theme): ResolvedTheme {
  // Dark mode REMOVED (Thang 2026-06-27): always render light. The toggle is
  // gone and any previously-saved 'dark'/'system' preference is ignored, so no
  // one is left stuck on the half-migrated dark theme. The dark: utility classes
  // sprinkled in the codebase stay inert (the html.dark class is never set).
  void systemPrefersDark; // kept for reference; intentionally unused
  return 'light';
}

function applyClass(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Dark mode REMOVED (Thang 2026-06-27): force light on mount, ignore any
  // stored 'dark'/'system' preference. Keeping theme state at 'light' also makes
  // the system-preference effect below a no-op (its `theme !== 'system'` guard
  // always returns early), so an OS-dark machine can never flip us to dark.
  useEffect(() => {
    void readStoredTheme; // preference intentionally ignored now
    setThemeState('light');
    setResolvedTheme('light');
    applyClass('light');
  }, []);

  // Listen to OS preference changes when in system mode
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const r: ResolvedTheme = mq.matches ? 'dark' : 'light';
      setResolvedTheme(r);
      applyClass(r);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const r = resolve(next);
    setResolvedTheme(r);
    applyClass(r);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      window.localStorage.removeItem('theme'); // drop legacy key
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme =
        prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light';
      const r = resolve(next);
      setResolvedTheme(r);
      applyClass(r);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    // Safe fallback for components that mount before provider (e.g. error boundary)
    return {
      theme: DEFAULT_THEME,
      resolvedTheme: 'light',
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return ctx;
}

/**
 * Inline script — runs BEFORE React mounts to set html.dark class and
 * prevent flash-of-light. Read by layout.tsx <head>.
 */
export const NO_FLASH_SCRIPT = `(function(){try{document.documentElement.classList.remove('dark');}catch(e){}})();`;
