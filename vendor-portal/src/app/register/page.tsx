'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function VendorRegisterPage() {
  const [form, setForm] = useState({
    email: '', password: '', password_confirm: '',
    company_name: '', contact_name: '', phone: '',
    address: '', tax_code: '',
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
    if (form.password.length < 6) {
      setError('Mật khẩu phải có ít nhất 6 ký tự');
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/vendor/auth/register', form);
      setSuccess(true);
    } catch (err: any) {
      setError(err?.detail ?? 'Đăng ký thất bại');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
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
    );
  }

  const Field = ({ label, name, type = 'text', required = false, placeholder = '' }: any) => (
    <div>
      <label className="text-sm text-slate-600 block mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      <input type={type} value={(form as any)[name]} onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
        required={required} placeholder={placeholder}
        className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-brand-700">Song Châu</h1>
          <p className="text-sm text-slate-500 mt-1">Đăng ký Nhà Cung Cấp</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-8 space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Thông tin đăng ký</h2>

          <Field label="Tên công ty" name="company_name" required placeholder="Công ty TNHH ABC" />
          <Field label="Người liên hệ" name="contact_name" required placeholder="Nguyễn Văn A" />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" name="email" type="email" required placeholder="email@congty.com" />
            <Field label="Số điện thoại" name="phone" required placeholder="0901234567" />
          </div>

          <Field label="Địa chỉ" name="address" placeholder="Thành phố, Quốc gia" />
          <Field label="Mã số thuế" name="tax_code" placeholder="0123456789" />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mật khẩu" name="password" type="password" required placeholder="Ít nhất 6 ký tự" />
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
  );
}
