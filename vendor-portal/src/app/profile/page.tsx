'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { BP } from '@/lib/base-path';
import { Badge } from '@/components/Badge';
import { FieldGrid } from '@/components/ui/FieldGrid';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDate, categoriesToString, stringToCategories } from '@/lib/format';

interface Profile {
  id: number;
  company_name: string;
  contact_name: string;
  phone: string;
  address: string;
  email: string;
  /** Tax code now surfaced by GET /api/vendor/profile. */
  tax_code?: string | null;
  /** Ngành hàng (vendor_accounts.product_categories TEXT[]) — surfaced by GET /api/vendor/profile. */
  product_categories?: string[] | null;
  /** Backend returns an `is_approved` boolean; older payloads sent a `status` string. */
  is_approved?: boolean;
  status?: string;
  created_at?: string;
}

interface FormState {
  company_name: string;
  contact_name: string;
  phone: string;
  address: string;
  tax_code: string;
  /** Free-text comma string ⇄ TEXT[] via stringToCategories on save. */
  product_categories: string;
}

/** Resolve the account-approval state into a canonical ERP Badge config. */
function accountStatusCfg(p: Profile | null): { label: string; className: string } {
  // Prefer the boolean the backend actually returns; fall back to a legacy string.
  if (p?.is_approved === true) {
    return { label: 'Đã duyệt', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  }
  if (p?.is_approved === false) {
    return { label: 'Chờ duyệt', className: 'bg-amber-50 text-amber-700 ring-amber-200' };
  }
  switch (p?.status) {
    case 'approved':
      return { label: 'Đã duyệt', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
    case 'rejected':
      return { label: 'Bị từ chối', className: 'bg-rose-50 text-rose-700 ring-rose-200' };
    case 'pending':
      return { label: 'Chờ duyệt', className: 'bg-amber-50 text-amber-700 ring-amber-200' };
    default:
      return { label: 'Chưa xác định', className: 'bg-slate-100 text-slate-600 ring-slate-200' };
  }
}

/** Score a candidate password 0–3 -> a single brand/status dot (no new colors). */
function passwordStrength(pw: string): { level: 0 | 1 | 2 | 3; label: string; dotClass: string; textClass: string } {
  if (!pw) return { level: 0, label: '', dotClass: 'bg-slate-300', textClass: 'text-slate-400' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[a-zA-Z]/.test(pw) && /\d/.test(pw)) score++;
  if (pw.length >= 12 && /[^a-zA-Z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: 1, label: 'Yếu', dotClass: 'bg-rose-500', textClass: 'text-rose-600' };
  if (score === 2) return { level: 2, label: 'Trung bình', dotClass: 'bg-amber-500', textClass: 'text-amber-600' };
  return { level: 3, label: 'Mạnh', dotClass: 'bg-emerald-500', textClass: 'text-emerald-600' };
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<FormState>({ company_name: '', contact_name: '', phone: '', address: '', tax_code: '', product_categories: '' });
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ── Password change (Bảo mật) — Q6 force-relogin on success ─────────────
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

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
          tax_code: d.tax_code ?? '',
          product_categories: categoriesToString(d.product_categories),
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
        tax_code: profile.tax_code ?? '',
        product_categories: categoriesToString(profile.product_categories),
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
        tax_code: form.tax_code.trim() || null,
        product_categories: stringToCategories(form.product_categories),
      });
      // Prefer the server echo; fallback merges form fields but coerces the
      // comma-string back into the TEXT[] shape Profile expects (no string leak).
      setProfile(
        res.data ?? {
          ...profile!,
          company_name: form.company_name.trim(),
          contact_name: form.contact_name.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          tax_code: form.tax_code.trim() || null,
          product_categories: stringToCategories(form.product_categories),
        },
      );
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

  const handleChangePassword = async () => {
    const current = pwForm.current_password;
    const next = pwForm.new_password;
    const confirm = pwForm.confirm_password;
    setPwError('');
    setPwSuccess('');

    // Client-side validation (server re-validates; this is UX-only).
    if (!current || !next || !confirm) {
      setPwError('Vui lòng điền đầy đủ cả ba ô mật khẩu');
      return;
    }
    if (next !== confirm) {
      setPwError('Mật khẩu mới và xác nhận không khớp');
      return;
    }
    if (next === current) {
      setPwError('Mật khẩu mới phải khác mật khẩu hiện tại');
      return;
    }
    if (next.length < 8 || !/[a-zA-Z]/.test(next) || !/\d/.test(next)) {
      setPwError('Mật khẩu mới phải có ít nhất 8 ký tự, gồm cả chữ và số');
      return;
    }

    setPwSaving(true);
    try {
      await api.post('/api/vendor/profile/change-password', {
        current_password: current,
        new_password: next,
      });
      // Q6 = FORCE-RELOGIN: pv was bumped server-side; this session is now revoked.
      // No token is returned — clear it and bounce to login deterministically.
      setPwSuccess('Đổi mật khẩu thành công — đang đăng xuất...');
      localStorage.removeItem('vendor_token');
      localStorage.removeItem('vendor_user');
      window.location.href = `${BP}/login`;
    } catch (err: any) {
      setPwError(err?.detail ?? 'Đổi mật khẩu thất bại, vui lòng thử lại');
    } finally {
      setPwSaving(false);
    }
  };

  const statusCfg = accountStatusCfg(profile);
  const vendorCode = `NCC-${String(profile?.id ?? '').padStart(4, '0')}`;

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-5">
      <PageHeader
        title="Hồ sơ nhà cung cấp"
        subtitle="Thông tin tài khoản và công ty của bạn trên cổng nhà cung cấp Song Châu"
        actions={
          !loading && profile ? <Badge {...statusCfg} withDot /> : undefined
        }
      />

      {loading ? (
        <div className="space-y-4">
          <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-4 h-3 w-32 rounded bg-slate-200" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i}>
                  <div className="mb-1.5 h-2 w-16 rounded bg-slate-200" />
                  <div className="h-4 w-28 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
          <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-4 h-3 w-32 rounded bg-slate-200" />
            <div className="space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i}>
                  <div className="mb-1.5 h-2 w-20 rounded bg-slate-200" />
                  <div className="h-8 rounded-lg bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : error && !profile ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
          <p className="text-sm text-rose-600">{error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* ── Read-only account block (FieldGrid) ───────────────────────── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Thông tin tài khoản
              </h2>
              <span className="font-mono text-[11px] font-semibold tabular-nums text-brand-600">
                {vendorCode}
              </span>
            </div>
            <FieldGrid
              cols={3}
              fields={[
                { label: 'Công ty', value: profile?.company_name, tone: 'slate' },
                { label: 'Người liên hệ', value: profile?.contact_name },
                { label: 'Email', value: profile?.email, mono: true },
                { label: 'Điện thoại', value: profile?.phone, mono: true },
                { label: 'Mã số thuế', value: profile?.tax_code, mono: true, tone: 'brand' },
                {
                  label: 'Trạng thái tài khoản',
                  value: <Badge {...statusCfg} withDot />,
                },
                { label: 'Ngày đăng ký', value: formatDate(profile?.created_at), mono: true },
                {
                  label: 'Ngành hàng',
                  value: categoriesToString(profile?.product_categories) || undefined,
                  colSpan: 2,
                },
                {
                  label: 'Địa chỉ',
                  value: profile?.address,
                  colSpan: 2,
                },
              ]}
            />
          </section>

          {/* ── Security / password column ────────────────────────────────── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Bảo mật
            </h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Mật khẩu hiện tại
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={pwForm.current_password}
                  onChange={e => setPwForm(f => ({ ...f, current_password: e.target.value }))}
                  className="h-8 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Mật khẩu mới
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pwForm.new_password}
                  onChange={e => setPwForm(f => ({ ...f, new_password: e.target.value }))}
                  className="h-8 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                {pwForm.new_password && (() => {
                  const s = passwordStrength(pwForm.new_password);
                  return (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dotClass}`} />
                      <span className={`text-[11px] font-medium ${s.textClass}`}>{s.label}</span>
                      <span className="text-[11px] text-slate-400">· tối thiểu 8 ký tự, gồm chữ và số</span>
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Xác nhận mật khẩu mới
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pwForm.confirm_password}
                  onChange={e => setPwForm(f => ({ ...f, confirm_password: e.target.value }))}
                  className="h-8 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {pwError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-600">
                  {pwError}
                </div>
              )}
              {pwSuccess && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
                  {pwSuccess}
                </div>
              )}

              <button
                type="button"
                onClick={handleChangePassword}
                disabled={pwSaving}
                className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {pwSaving ? 'Đang đổi...' : 'Đổi mật khẩu'}
              </button>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Sau khi đổi mật khẩu, bạn sẽ được đăng xuất và cần đăng nhập lại bằng mật khẩu mới.
              </p>
            </div>
          </section>

          {/* ── Editable company block ────────────────────────────────────── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Thông tin công ty
              </h2>
              {!editing && (
                <button
                  onClick={handleEdit}
                  className="rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
                >
                  Chỉnh sửa
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Tên công ty <span className="text-rose-400">*</span>
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={form.company_name}
                    onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
                    className="h-8 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                ) : (
                  <p className="text-sm font-medium text-slate-800">{profile?.company_name || '—'}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Người liên hệ <span className="text-rose-400">*</span>
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={form.contact_name}
                    onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                    className="h-8 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                ) : (
                  <p className="text-sm text-slate-800">{profile?.contact_name || '—'}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Số điện thoại
                </label>
                {editing ? (
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="h-8 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="0901234567"
                  />
                ) : (
                  <p className="font-mono text-sm text-slate-800">{profile?.phone || '—'}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Mã số thuế
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={form.tax_code}
                    onChange={e => setForm(f => ({ ...f, tax_code: e.target.value }))}
                    className="h-8 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="0123456789"
                  />
                ) : (
                  <p className="font-mono text-sm text-slate-800">{profile?.tax_code || '—'}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Ngành hàng <span className="font-normal normal-case text-slate-300">(cách nhau dấu phẩy)</span>
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={form.product_categories}
                    onChange={e => setForm(f => ({ ...f, product_categories: e.target.value }))}
                    className="h-8 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="jig, băng tải, cảm biến"
                  />
                ) : (
                  <p className="text-sm text-slate-800">
                    {categoriesToString(profile?.product_categories) || '—'}
                  </p>
                )}
              </div>

              <div className="md:row-span-2">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Địa chỉ
                </label>
                {editing ? (
                  <textarea
                    value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="123 Đường ABC, Quận 1, TP.HCM"
                  />
                ) : (
                  <p className="text-sm text-slate-800">{profile?.address || '—'}</p>
                )}
              </div>
            </div>

            {/* Inline error */}
            {error && profile && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">
                {error}
              </div>
            )}

            {/* Editing actions */}
            {editing && (
              <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                >
                  {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            )}
          </section>

          {/* Success message */}
          {success && !editing && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 lg:col-span-3">
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
