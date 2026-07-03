'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function VendorLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.post<any>('/api/vendor/auth/login', { email, password });
      localStorage.setItem('vendor_token', res.access_token);
      localStorage.setItem('vendor_user', JSON.stringify(res.user));
      window.location.href = '/ncc/dashboard';
    } catch (err: any) {
      setError(err?.detail ?? 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50">
      <BrandPanel />

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">SC</span>
              <span className="text-lg font-bold text-slate-800">Song Châu</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">Cổng Nhà Cung Cấp</p>
          </div>

          <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 space-y-5">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Đăng nhập</h2>
              <p className="mt-1 text-sm text-slate-500">Truy cập cổng báo giá Nhà Cung Cấp.</p>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-600 block mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" placeholder="email@congty.com" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-slate-600">Mật khẩu</label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  Quên mật khẩu?
                </Link>
              </div>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" placeholder="••••••••" />
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-brand-600 text-white font-semibold rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>

            <p className="text-center text-sm text-slate-500">
              Chưa có tài khoản? <Link href="/register" className="text-brand-600 font-medium hover:underline">Đăng ký</Link>
            </p>
          </form>

          <p className="mt-6 text-center text-xs text-slate-400">
            Cần hỗ trợ? Liên hệ phòng Thu mua Song Châu.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---- Shared brand panel (left pane) ---- */
function BrandPanel() {
  return (
    <div className="relative hidden lg:flex flex-col justify-between bg-brand-600 px-12 py-14 text-white overflow-hidden">
      {/* subtle indigo depth — single-hue, no rainbow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,theme(colors.brand.500)_0%,theme(colors.brand.700)_70%)] opacity-90" />

      <div className="relative">
        <div className="inline-flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25 text-lg font-bold">SC</span>
          <div className="leading-tight">
            <div className="text-lg font-bold">Song Châu</div>
            <div className="text-xs text-brand-100">Vật tư & Gia công cơ khí</div>
          </div>
        </div>
      </div>

      <div className="relative max-w-sm">
        <h1 className="text-3xl font-bold leading-tight">Cổng Nhà Cung Cấp Song Châu</h1>
        <p className="mt-3 text-sm text-brand-100">
          Nhận thư mời thầu, gửi báo giá và theo dõi hợp đồng — đơn hàng trên cùng một nền tảng.
        </p>

        <dl className="mt-10 grid grid-cols-3 gap-4">
          {[
            { v: '24/7', l: 'Gửi báo giá trực tuyến' },
            { v: '100%', l: 'Minh bạch vòng thầu' },
            { v: 'Realtime', l: 'Trạng thái hợp đồng & PO' },
          ].map(s => (
            <div key={s.l} className="rounded-xl bg-white/10 ring-1 ring-white/15 px-3 py-3">
              <dt className="text-lg font-bold">{s.v}</dt>
              <dd className="mt-1 text-[11px] leading-snug text-brand-100">{s.l}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="relative text-xs text-brand-200">
        © {new Date().getFullYear()} Công ty Song Châu. Bảo mật thông tin nhà cung cấp.
      </div>
    </div>
  );
}
