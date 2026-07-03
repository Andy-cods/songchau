'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

// Shape of POST /api/vendor/auth/forgot-password (BE-3). The endpoint always
// returns a generic 200 (chống dò email). While M365 email is not live it ALSO
// returns `reset_link` so an admin can relay it manually; once email works the
// backend stops returning the link (email_sent=true) for security.
interface ForgotResponse {
  message?: string;
  email_sent?: boolean;
  reset_link?: string;
}

export default function VendorForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ForgotResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<ForgotResponse>('/api/vendor/auth/forgot-password', { email });
      setResult(res ?? {});
    } catch (err: any) {
      setError(err?.detail ?? 'Không gửi được yêu cầu, vui lòng thử lại');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    if (!result?.reset_link) return;
    try {
      await navigator.clipboard.writeText(result.reset_link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — user can still select the text manually */
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
            <p className="mt-1 text-sm text-slate-500">Quên mật khẩu</p>
          </div>

          {result ? (
            // Generic success state — never confirms whether the email exists.
            <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 space-y-4">
              <div className="w-14 h-14 bg-brand-50 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">Đã ghi nhận yêu cầu</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {result.message ?? 'Nếu email tồn tại, link đặt lại mật khẩu đã được tạo.'}
                </p>
              </div>

              {/* Email chưa cấu hình → backend trả về link để admin gửi tay. */}
              {result.reset_link && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-800">
                    Email tự động chưa được bật — gửi link này cho nhà cung cấp:
                  </p>
                  <div className="mt-2 flex items-stretch gap-2">
                    <code className="flex-1 break-all rounded-md bg-white px-2.5 py-2 text-[11px] text-slate-700 ring-1 ring-inset ring-amber-200">
                      {result.reset_link}
                    </code>
                    <button
                      type="button"
                      onClick={copyLink}
                      className="shrink-0 rounded-md bg-amber-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
                    >
                      {copied ? 'Đã chép' : 'Sao chép'}
                    </button>
                  </div>
                </div>
              )}

              {result.email_sent && !result.reset_link && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  Đã gửi email — vui lòng kiểm tra hộp thư (kể cả mục spam).
                </div>
              )}

              <Link href="/login" className="inline-block text-sm font-medium text-brand-600 hover:underline">
                ← Quay lại đăng nhập
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-800">Quên mật khẩu</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Nhập email tài khoản nhà cung cấp — chúng tôi sẽ tạo link đặt lại mật khẩu.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-600 block mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="email@congty.com"
                />
              </div>

              {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-brand-600 text-white font-semibold rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Đang gửi...' : 'Gửi link đặt lại'}
              </button>

              <p className="text-center text-sm text-slate-500">
                Nhớ ra mật khẩu? <Link href="/login" className="text-brand-600 font-medium hover:underline">Đăng nhập</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Shared brand panel (left pane) — matches login/register/activate ---- */
function BrandPanel() {
  return (
    <div className="relative hidden lg:flex flex-col justify-between bg-brand-600 px-12 py-14 text-white overflow-hidden">
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
          Lấy lại quyền truy cập tài khoản để tiếp tục nhận thư mời thầu và gửi báo giá.
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
