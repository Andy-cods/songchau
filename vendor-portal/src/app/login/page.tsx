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
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err?.detail ?? 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-brand-700">Song Châu</h1>
          <p className="text-sm text-slate-500 mt-1">Cổng Nhà Cung Cấp</p>
        </div>

        <form onSubmit={handleLogin} className="bg-white rounded-xl shadow-lg p-8 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Đăng nhập</h2>

          <div>
            <label className="text-sm text-slate-600 block mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="email@congty.com" />
          </div>

          <div>
            <label className="text-sm text-slate-600 block mb-1">Mật khẩu</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="••••••••" />
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
      </div>
    </div>
  );
}
