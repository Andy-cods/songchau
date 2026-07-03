'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User, AuthResponse, LoginCredentials } from '@/types/models';
import { api } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
}

// ─── Context ────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ─── Public paths that don't require authentication ─────────────

// Public paths — Thang 2026-05-14: thêm /bid/* cho NCC vào magic-link không cần login.
const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password', '/bid/'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

// ─── Provider ───────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Safety net (Thang 2026-05-22): force isLoading=false after 4s no matter
  // what. Prevents the dreaded "infinite spinner" if some sync code throws
  // before the finally block can run.
  useEffect(() => {
    const safetyTimer = setTimeout(() => setIsLoading(false), 4000);
    return () => clearTimeout(safetyTimer);
  }, []);

  // Hydrate auth state from localStorage on mount. Hardened (Thang 2026-05-22):
  // setIsLoading(false) MUST run even if anything throws so the app never gets
  // stuck on the "Đang tải..." spinner. Also guard against "undefined" string
  // values left over from past failed logins.
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem('access_token');
      const storedUser = localStorage.getItem('user');
      // "undefined" string from a botched JSON.stringify(undefined) breaks JSON.parse
      const looksValidUser =
        storedUser && storedUser !== 'undefined' && storedUser !== 'null';
      const looksValidToken =
        storedToken && storedToken !== 'undefined' && storedToken.split('.').length === 3;
      if (looksValidToken && looksValidUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser!));
      } else if (storedToken || storedUser) {
        // Partial / corrupted state — clean slate.
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
      }
    } catch {
      try {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
      } catch {}
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Redirect logic: protect dashboard routes, redirect logged-in users away from login
  useEffect(() => {
    if (isLoading) return;

    // Race-safe token check: React state may not have flushed yet immediately
    // after a successful login(), so also read localStorage. Otherwise the
    // first effect run after login() could see token=null and bounce the user
    // back to /login → infinite loop (Thang 2026-05-22).
    const effectiveToken =
      token ||
      (typeof window !== 'undefined' ? localStorage.getItem('access_token') : null);
    const hasToken =
      effectiveToken && effectiveToken !== 'undefined' && effectiveToken.split('.').length === 3;

    if (!hasToken && !isPublicPath(pathname)) {
      router.replace('/login');
      return;
    }

    // Per Thang 2026-05-14: KHÔNG redirect logged-in user khỏi /bid/.
    if (hasToken && isPublicPath(pathname) && !pathname.startsWith('/bid/')) {
      const role = user?.role
        || (() => {
          try {
            const u = localStorage.getItem('user');
            if (u && u !== 'undefined') return JSON.parse(u)?.role;
          } catch {}
          return undefined;
        })();
      const landingPath = role === 'viewer' ? '/bqms' : '/dashboard';
      router.replace(landingPath);
    }
  }, [token, pathname, isLoading, router, user?.role]);

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      // Clean stale auth before requesting login (Thang 2026-05-22):
      // any zombie tokens in localStorage that match the new token's
      // expiry/sig get cleared so refresh interceptors won't mix them.
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');

      const data = await api.post<AuthResponse>('/api/v1/auth/login', credentials);

      // Defensive: if backend response is missing expected fields, fail loud
      // instead of silently storing "undefined" string.
      if (!data?.access_token || !data?.user) {
        throw new Error('Login response thiếu access_token hoặc user');
      }

      localStorage.setItem('access_token', data.access_token);
      if (data.refresh_token) {
        localStorage.setItem('refresh_token', data.refresh_token);
      }
      localStorage.setItem('user', JSON.stringify(data.user));

      setToken(data.access_token);
      setUser(data.user);

      // Viewer (guest) lands on /bqms — they don't see Tổng quan in nav.
      router.push(data.user?.role === 'viewer' ? '/bqms' : '/dashboard');
    },
    [router]
  );

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');

    setToken(null);
    setUser(null);

    router.push('/login');
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: !!token && !!user,
      login,
      logout,
    }),
    [user, token, isLoading, login, logout]
  );

  // Show nothing while initial auth check is running
  // (prevents flash of protected content or login page).
  // Escape hatch (Thang 2026-05-22): show "Xoá phiên & vào lại" button after
  // 3s so the user can recover from any zombie state instead of staring at
  // an infinite spinner.
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3 max-w-md">
          <div className="h-8 w-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
          <span className="text-sm text-slate-500">Đang tải...</span>
          <SpinnerEscape />
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ───────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

// ─── Helpers ─────────────────────────────────────────────────────

// Shown under the initial loading spinner. Appears after 3s so users stuck on
// the spinner have a way out (clear localStorage + retry).
function SpinnerEscape() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div className="mt-6 text-center space-y-2">
      <p className="text-xs text-slate-400">
        Đang tải lâu hơn bình thường?
      </p>
      <button
        onClick={() => {
          try {
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('user');
            sessionStorage.clear();
          } catch {}
          if (typeof window !== 'undefined') {
            window.location.href = '/login?_t=' + Date.now();
          }
        }}
        className="text-xs px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-slate-700"
      >
        Xoá phiên & vào lại
      </button>
    </div>
  );
}
