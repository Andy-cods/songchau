'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Profile {
  id: number;
  company_name: string;
  contact_name: string;
  phone: string;
  address: string;
  email: string;
  status?: string;
  created_at?: string;
}

interface FormState {
  company_name: string;
  contact_name: string;
  phone: string;
  address: string;
}

function formatDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: 'Chờ duyệt', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: 'Đã duyệt', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Bị từ chối', className: 'bg-red-50 text-red-700 border-red-200' },
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<FormState>({ company_name: '', contact_name: '', phone: '', address: '' });
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get<any>('/api/vendor/profile')
      .then(res => {
        const d: Profile = res.data;
        setProfile(d);
        setForm({
          company_name: d.company_name ?? '',
          contact_name: d.contact_name ?? '',
          phone: d.phone ?? '',
          address: d.address ?? '',
        });
      })
      .catch(() => setError('Không tải được thông tin hồ sơ'))
      .finally(() => setLoading(false));
  }, []);

  const handleEdit = () => {
    setEditing(true);
    setSuccess('');
    setError('');
  };

  const handleCancel = () => {
    if (profile) {
      setForm({
        company_name: profile.company_name ?? '',
        contact_name: profile.contact_name ?? '',
        phone: profile.phone ?? '',
        address: profile.address ?? '',
      });
    }
    setEditing(false);
    setError('');
  };

  const handleSave = async () => {
    if (!form.company_name.trim() || !form.contact_name.trim()) {
      setError('Tên công ty và người liên hệ là bắt buộc');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.put<any>('/api/vendor/profile', {
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
      });
      setProfile(res.data ?? { ...profile!, ...form });
      setEditing(false);
      setSuccess('Cập nhật hồ sơ thành công');
      // Update localStorage user info
      const stored = localStorage.getItem('vendor_user');
      if (stored) {
        const u = JSON.parse(stored);
        u.company_name = form.company_name.trim();
        localStorage.setItem('vendor_user', JSON.stringify(u));
      }
    } catch (err: any) {
      setError(err?.detail ?? 'Lưu thất bại, vui lòng thử lại');
    } finally {
      setSaving(false);
    }
  };

  const statusCfg = profile?.status
    ? (STATUS_CONFIG[profile.status] ?? { label: profile.status, className: 'bg-slate-100 text-slate-600 border-slate-200' })
    : null;

  return (
    <main className="max-w-2xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Hồ sơ nhà cung cấp</h1>
        <p className="text-sm text-slate-500 mt-0.5">Thông tin công ty và tài khoản của bạn</p>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 animate-pulse">
          {[1, 2, 3, 4].map(i => (
            <div key={i}>
              <div className="h-3 bg-slate-200 rounded w-24 mb-2" />
              <div className="h-9 bg-slate-100 rounded-lg" />
            </div>
          ))}
        </div>
      ) : error && !profile ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Account info card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Thông tin tài khoản</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Email</p>
                <p className="text-sm text-slate-700 font-medium">{profile?.email ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Ngày đăng ký</p>
                <p className="text-sm text-slate-700">{formatDate(profile?.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Mã nhà cung cấp</p>
                <p className="text-sm font-mono text-brand-600">NCC-{String(profile?.id ?? '').padStart(4, '0')}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Trạng thái</p>
                {statusCfg ? (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusCfg.className}`}>
                    {statusCfg.label}
                  </span>
                ) : (
                  <p className="text-sm text-slate-500">—</p>
                )}
              </div>
            </div>
          </div>

          {/* Editable info card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-700">Thông tin công ty</h2>
              {!editing && (
                <button
                  onClick={handleEdit}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium px-3 py-1.5 border border-brand-200 rounded-lg hover:bg-brand-50 transition-colors"
                >
                  Chỉnh sửa
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1">
                  Tên công ty <span className="text-red-400">*</span>
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={form.company_name}
                    onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                ) : (
                  <p className="text-sm text-slate-800 font-medium">{profile?.company_name || '—'}</p>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">
                  Người liên hệ <span className="text-red-400">*</span>
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={form.contact_name}
                    onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                ) : (
                  <p className="text-sm text-slate-800">{profile?.contact_name || '—'}</p>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Số điện thoại</label>
                {editing ? (
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    placeholder="0901234567"
                  />
                ) : (
                  <p className="text-sm text-slate-800">{profile?.phone || '—'}</p>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Địa chỉ</label>
                {editing ? (
                  <textarea
                    value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                    placeholder="123 Đường ABC, Quận 1, TP.HCM"
                  />
                ) : (
                  <p className="text-sm text-slate-800">{profile?.address || '—'}</p>
                )}
              </div>
            </div>

            {/* Error / success */}
            {error && (
              <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
                {error}
              </div>
            )}

            {/* Editing actions */}
            {editing && (
              <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-slate-100">
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 text-sm bg-brand-600 text-white font-semibold rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            )}
          </div>

          {/* Success message outside cards */}
          {success && !editing && (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {success}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
