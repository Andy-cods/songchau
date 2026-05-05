'use client';

import { useState } from 'react';
import { Eye, EyeOff, Lock, Mail, Loader2 } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import type { ApiError } from '@/types/models';

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
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden bg-slate-950">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#1e3a8a_0%,transparent_50%),radial-gradient(circle_at_80%_30%,#4c1d95_0%,transparent_55%),radial-gradient(circle_at_60%_80%,#0f766e_0%,transparent_50%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(15,23,42,0.4)_0%,rgba(2,6,23,0.85)_100%)]" />

      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Main content */}
      <div className="relative z-10 w-full max-w-[420px] px-5">
        {/* Brand mark above the card */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-400 via-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/40 ring-1 ring-white/10 mb-3">
            <span className="text-white font-black text-lg tracking-tight">SC</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Song Châu ERP
          </h1>
          <p className="text-[13px] text-slate-400 mt-1.5">
            Hệ thống quản lý doanh nghiệp
          </p>
        </div>

        {/* Glass card */}
        <div className="bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl p-7 shadow-2xl shadow-black/40">
          <div className="mb-6">
            <h2 className="text-[15px] font-semibold text-white">Đăng nhập</h2>
            <p className="text-[12px] text-slate-400 mt-1">
              Sử dụng tài khoản công ty để truy cập hệ thống
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-[12px] font-medium text-slate-300 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-white/[0.06] border border-white/10 rounded-xl text-[13px] text-white placeholder:text-slate-500 focus:outline-none focus:bg-white/[0.08] focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20 transition"
                  placeholder="email@songchau.vn"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-[12px] font-medium text-slate-300 mb-1.5">
                Mật khẩu
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 bg-white/[0.06] border border-white/10 rounded-xl text-[13px] text-white placeholder:text-slate-500 focus:outline-none focus:bg-white/[0.08] focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20 transition"
                  placeholder="Nhập mật khẩu"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-500 hover:text-slate-300 transition"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-[12px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-rose-400 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 mt-1 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold rounded-xl text-[13px] shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang đăng nhập...
                </span>
              ) : (
                'Đăng nhập'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-slate-500 mt-6">
          Song Châu Co., Ltd &copy; 2026 · v1.0
        </p>
      </div>
    </div>
  );
}
