'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { stringToCategories } from '@/lib/format';

export default function VendorRegisterPage() {
  const [form, setForm] = useState({
    email: '', password: '', password_confirm: '',
    company_name: '', contact_name: '', phone: '',
    address: '', tax_code: '', product_categories: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.password_confirm) {
      setError('Mật khẩu xác nhận không khớp');
      return;
    }
    // Match backend _validate_password_strength: ≥8 ký tự, có cả chữ và số.
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
      setError('Mật khẩu phải có ít nhất 8 ký tự, gồm cả chữ và số');
      return;
    }

    setLoading(true);
    try {
      // product_categories: free-text comma → TEXT[] (backend nhận list[str]).
      await api.post('/api/vendor/auth/register', {
        ...form,
        product_categories: stringToCategories(form.product_categories),
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.detail ?? 'Đăng ký thất bại');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50">
        <BrandPanel />
        <div className="flex items-center justify-center px-6 py-12">
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 max-w-md text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Đăng ký thành công!</h2>
            <p className="text-sm text-slate-600 mb-4">
              Tài khoản của bạn đang chờ Song Châu duyệt. Bạn sẽ nhận email thông báo khi được duyệt.
            </p>
            <Link href="/login" className="text-brand-600 font-medium hover:underline">← Quay lại đăng nhập</Link>
          </div>
        </div>
      </div>
    );
  }

  const Field = ({ label, name, type = 'text', required = false, placeholder = '' }: any) => (
    <div>
      <label className="text-sm font-medium text-slate-600 block mb-1.5">{label}{required && <span className="text-red-500"> *</span>}</label>
      <input type={type} value={(form as any)[name]} onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
        required={required} placeholder={placeholder}
        className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
    </div>
  );

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50">
      <BrandPanel />

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-lg">
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">SC</span>
              <span className="text-lg font-bold text-slate-800">Song Châu</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">Đăng ký Nhà Cung Cấp</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 space-y-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Thông tin đăng ký</h2>
              <p className="mt-1 text-sm text-slate-500">Tạo tài khoản để nhận thư mời thầu từ Song Châu.</p>
            </div>

            <Field label="Tên công ty" name="company_name" required placeholder="Công ty TNHH ABC" />
            <Field label="Người liên hệ" name="contact_name" required placeholder="Nguyễn Văn A" />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Email" name="email" type="email" required placeholder="email@congty.com" />
              <Field label="Số điện thoại" name="phone" required placeholder="0901234567" />
            </div>

            <Field label="Địa chỉ" name="address" placeholder="Thành phố, Quốc gia" />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Mã số thuế" name="tax_code" placeholder="0123456789" />
              <Field label="Ngành hàng" name="product_categories" placeholder="jig, băng tải, cảm biến" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-slate-600 block mb-1.5">Mật khẩu<span className="text-red-500"> *</span></label>
                <input type="password" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required placeholder="≥8 ký tự, có chữ và số"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
                <PasswordStrength value={form.password} />
              </div>
              <Field label="Xác nhận mật khẩu" name="password_confirm" type="password" required placeholder="Nhập lại mật khẩu" />
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-brand-600 text-white font-semibold rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
              {loading ? 'Đang đăng ký...' : 'Đăng ký'}
            </button>

            <p className="text-center text-sm text-slate-500">
              Đã có tài khoản? <Link href="/login" className="text-brand-600 font-medium hover:underline">Đăng nhập</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---- Client-only password-strength meter ---- */
function scorePassword(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

function PasswordStrength({ value }: { value: string }) {
  const score = scorePassword(value);
  const labels = ['Quá yếu', 'Yếu', 'Trung bình', 'Khá', 'Mạnh'];
  const barColors = ['bg-slate-200', 'bg-rose-500', 'bg-amber-500', 'bg-sky-500', 'bg-emerald-500'];
  const textColors = ['text-slate-400', 'text-rose-600', 'text-amber-600', 'text-sky-600', 'text-emerald-600'];

  if (!value) return null;

  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i < score ? barColors[score] : 'bg-slate-200'}`}
          />
        ))}
      </div>
      <p className={`mt-1 text-xs font-medium ${textColors[score]}`}>Độ mạnh: {labels[score]}</p>
    </div>
  );
}

/* ---- Shared brand panel (left pane) ---- */
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
          Đăng ký để nhận thư mời thầu, gửi báo giá và theo dõi hợp đồng — đơn hàng trực tuyến.
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
