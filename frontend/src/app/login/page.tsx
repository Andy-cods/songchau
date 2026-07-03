'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import type { ApiError } from '@/types/models';

// Editorial Monogram (L3) — "A trading floor, not a marketing site."
// ONE brand color = the Tailwind `brand` token (brand-600 #4f46e5), the same
// indigo BQMS/cockpit use. No orbs, no gradients — same-hue depth + Syne
// monogram as typographic texture only.
// All transitions use cubic-bezier(0.16, 1, 0.3, 1) at 200ms unless noted.

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login({ email, password });
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr?.detail || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    // Split-screen, forced-LIGHT, pre-auth surface — intentionally ignores app
    // dark-mode. minHeight uses calc(100vh / 0.8) because globals.css applies
    // `body { zoom: 0.8 }`; plain 100vh would only cover 80% (gap at bottom).
    <div className="grid bg-white lg:grid-cols-2" style={{ minHeight: 'calc(100vh / 0.8)' }}>
      {/* Scoped style block — floating-label transitions + reduced-motion guard.
          Tailwind doesn't ship a :placeholder-shown variant by default, so we
          drive the label state via a sibling selector on the wrapper. */}
      <style dangerouslySetInnerHTML={{ __html: `
        .float-field { position: relative; }
        .float-field input {
          width: 100%;
          height: 56px;
          padding: 22px 14px 8px 14px;
          font-size: 14px;
          font-weight: 400;
          font-variant-numeric: tabular-nums;
          color: #0f172a;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          outline: none;
          transition: border-color 150ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 150ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .float-field input::placeholder { color: transparent; }
        .float-field input:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.12);
        }
        .float-field label {
          position: absolute;
          left: 14px;
          top: 18px;
          font-size: 13px;
          font-weight: 400;
          color: #64748b;
          pointer-events: none;
          transform-origin: left top;
          transition: top 200ms cubic-bezier(0.16, 1, 0.3, 1), font-size 200ms cubic-bezier(0.16, 1, 0.3, 1), color 200ms cubic-bezier(0.16, 1, 0.3, 1), font-weight 200ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .float-field input:focus + label,
        .float-field input:not(:placeholder-shown) + label {
          top: 8px;
          font-size: 11px;
          font-weight: 500;
          color: #4338ca;
        }
        .float-field.has-trailing input { padding-right: 52px; }
        @keyframes errEnter {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .float-field input,
          .float-field label,
          .cta-button,
          .error-block {
            transition: color 120ms linear, background-color 120ms linear !important;
            transform: none !important;
          }
          .error-block { animation: errEnter 120ms linear !important; }
        }
      ` }} />

      {/* ── Left brand panel (desktop ≥ lg) ─────────────────────────── */}
      <aside
        className="relative hidden flex-col overflow-hidden bg-brand-700 text-white ring-1 ring-inset ring-white/10 lg:flex"
        aria-hidden="false"
      >
        {/* Oversized SC outline-monogram watermark — typography AS texture.
            Bleeds 80px off the left edge, fills 6% white, strokes 10% white.
            Sits at z-0 BEHIND the foreground content stack. */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute left-[-80px] top-1/2 z-0 h-[720px] w-[720px] -translate-y-1/2 select-none"
          viewBox="0 0 400 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ forcedColorAdjust: 'auto' }}
        >
          <text
            x="0"
            y="320"
            className="font-display"
            fontSize="360"
            fontWeight={800}
            letterSpacing="-0.04em"
            fill="rgba(255,255,255,0.06)"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={1.5}
          >
            SC
          </text>
        </svg>

        {/* Foreground content stack — tri-bound: top lockup, center headline,
            bottom footer. Padding 96px (xl: 112px). */}
        <div className="relative z-10 flex h-full flex-col justify-between px-24 py-24 xl:px-28">
          {/* (1) Top lockup */}
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-white ring-1 ring-inset ring-black/5"
              aria-hidden="true"
            >
              <span className="font-display text-[16px] font-bold leading-none tracking-tight text-brand-700">
                SC
              </span>
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight text-white">
                Song Châu ERP
              </div>
              <div className="text-[12px] text-white/70">Hệ thống vận hành doanh nghiệp</div>
            </div>
          </div>

          {/* (2) Vertical center block — headline, accent rule, one sentence */}
          <div className="max-w-[520px]">
            <h2
              className="font-display font-bold text-white xl:text-[64px]"
              style={{
                fontSize: 'clamp(48px, 4.5vw, 64px)',
                lineHeight: 1.08,
                letterSpacing: '-0.02em',
              }}
            >
              Vận hành minh bạch. Quyết định nhanh hơn.
            </h2>

            {/* 60px brand-300 accent rule */}
            <div className="mt-8 h-px w-[60px] bg-brand-300" aria-hidden="true" />

            <p
              className="mt-6 max-w-[460px] text-white/75"
              style={{ fontSize: '15px', lineHeight: 1.55 }}
            >
              Một hệ thống vận hành toàn bộ chuỗi giá trị — từ chào giá đến giao hàng, từ dữ liệu
              thị trường đến quyết định kinh doanh.
            </p>
          </div>

          {/* (3) Footer — anchored bottom-left, single row */}
          <div className="text-[12px] text-white/60">
            <span>&copy; Song Châu Co., Ltd</span>
            <span className="mx-2">&middot;</span>
            <span>2026</span>
            <span className="mx-2">&middot;</span>
            <span>v1.0</span>
          </div>
        </div>

        {/* Vertical hairline divider between panels (only at lg+) */}
        <div
          className="absolute right-0 top-0 h-full w-px bg-brand-900/40"
          aria-hidden="true"
        />
      </aside>

      {/* ── Right form panel ────────────────────────────────────────── */}
      <main className="relative flex flex-col items-center justify-center px-6 py-12 sm:px-10">
        {/* Mobile sticky brand bar (< lg): collapsed 96px-tall brand strip */}
        <div className="absolute left-0 right-0 top-0 flex h-[96px] items-center bg-brand-700 px-6 sm:px-10 lg:hidden">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white ring-1 ring-inset ring-black/5 sm:h-11 sm:w-11"
              aria-hidden="true"
            >
              <span className="font-display text-[14px] font-bold leading-none tracking-tight text-brand-700 sm:text-[16px]">
                SC
              </span>
            </div>
            <div className="leading-tight">
              <div className="text-[14px] font-semibold tracking-tight text-white sm:text-[15px]">
                Song Châu ERP
              </div>
              <div className="text-[11px] text-white/70 sm:text-[12px]">
                Hệ thống vận hành doanh nghiệp
              </div>
            </div>
          </div>
        </div>

        <div className="w-full max-w-[420px] pt-24 lg:pt-0">
          {/* Tier-1 floating card — slim brand top-hairline (the ONLY allowed
              chrome decoration), ring-1 hairline, soft floating shadow. */}
          <div className="relative rounded-xl bg-white px-8 py-9 ring-1 ring-slate-200 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)]">
            {/* Slim brand top hairline, flush on the card top edge */}
            <div
              className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-brand-600"
              aria-hidden="true"
            />

            {/* Heading */}
            <div className="mb-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                Đăng nhập hệ thống
              </p>
              <h1
                className="mt-1.5 font-display font-bold text-slate-900"
                style={{
                  fontSize: 'clamp(24px, 3vw, 28px)',
                  lineHeight: 1.15,
                  letterSpacing: '-0.015em',
                }}
              >
                Đăng nhập
              </h1>
              <p className="mt-1.5 text-[13px] leading-[1.5] text-slate-600">
                Sử dụng tài khoản công ty để truy cập hệ thống
              </p>
            </div>

          <form onSubmit={handleSubmit} className="space-y-[14px]" noValidate>
            {/* Email — floating-label */}
            <div className="float-field">
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder=" "
                required
                autoComplete="email"
                autoFocus
                aria-required="true"
              />
              <label htmlFor="email">Email</label>
            </div>

            {/* Password — floating-label + trailing reveal toggle */}
            <div className="float-field has-trailing">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder=" "
                required
                autoComplete="current-password"
                aria-required="true"
              />
              <label htmlFor="password">Mật khẩu</label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:text-slate-600 focus-visible:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                tabIndex={-1}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>

            {/* Forgot-password link — right-aligned, quiet brand */}
            <div className="flex justify-end pt-1">
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="text-[12px] text-brand-600 underline-offset-2 transition-colors hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:rounded-sm"
              >
                Quên mật khẩu?
              </a>
            </div>

            {/* Error block — appears on submission failure */}
            {error && (
              <div
                role="alert"
                aria-live="polite"
                className="error-block flex items-start gap-2 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-3 text-[12px] leading-[1.5] text-rose-700"
                style={{ animation: 'errEnter 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
              >
                <AlertCircle
                  className="mt-[1px] h-[14px] w-[14px] flex-shrink-0"
                  aria-hidden="true"
                />
                <span>
                  <span className="font-medium">Lỗi:</span> {error}
                </span>
              </div>
            )}

            {/* Primary CTA — full-width, 52px tall, no shadow, 1px translateY lift */}
            <button
              type="submit"
              disabled={loading}
              className="cta-button group relative flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-brand-600 text-[13.5px] font-medium text-white transition-all duration-200 ease-out hover:-translate-y-px hover:bg-brand-700 active:translate-y-0 active:bg-brand-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:bg-brand-600"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Đang đăng nhập&hellip;</span>
                </>
              ) : (
                <>
                  <span>Đăng nhập</span>
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </>
              )}
            </button>
            </form>
          </div>

          {/* Escape hatch — Thang's brand of the app, preserved. Sits OUTSIDE
              the card. If user is stuck due to zombie token state, wipes storage + reloads. */}
          <div className="mt-6 pt-2 text-center">
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.clear();
                  sessionStorage.clear();
                } catch {}
                if (typeof window !== 'undefined') {
                  // Cache-bust reload so JS bundles refresh too.
                  window.location.href = '/login?_t=' + Date.now();
                }
              }}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md px-3 text-[11px] text-slate-400 transition-colors hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              Bị mắc kẹt? Xoá phiên và làm mới
            </button>
          </div>

          {/* Mobile footer (< lg only) — desktop shows it on the brand panel */}
          <p
            className="mt-10 text-center text-[11px] text-slate-400 lg:hidden"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
          >
            <span>&copy; Song Châu Co., Ltd</span>
            <span className="mx-2">&middot;</span>
            <span>2026</span>
            <span className="mx-2">&middot;</span>
            <span>v1.0</span>
          </p>
        </div>
      </main>
    </div>
  );
}
