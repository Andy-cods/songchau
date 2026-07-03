'use client';

// PR-1 (Thang 2026-05-13): extracted from deliveries/page.tsx.
// CRUD modal cho driver — list + create + update + delete + upload ảnh CCCD/biển số.

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { DriverRecord } from './types';

/** JWT-aware image — fetch blob → ObjectURL.
 * Backend endpoint /drivers/{id}/image/{kind} requires Authorization header,
 * so plain <img src=...> would 401. */
function AuthedImage({
  driverId, kind, alt, className,
}: {
  driverId: number;
  kind: 'cccd' | 'license_plate';
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    const token = localStorage.getItem('access_token') ?? '';
    fetch(`/api/v1/bqms/drivers/${driverId}/image/${kind}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.blob() : null)
      .then(b => {
        if (cancelled || !b) return;
        createdUrl = URL.createObjectURL(b);
        setUrl(createdUrl);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [driverId, kind]);

  if (loading) return <div className={`${className} flex items-center justify-center text-xs text-slate-400`}>Đang tải...</div>;
  if (!url) return <div className={`${className} flex items-center justify-center text-xs text-rose-500`}>Lỗi tải</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <a href={url} target="_blank" rel="noreferrer" title="Click để xem full size"><img src={url} alt={alt} className={className} /></a>;
}

export function DriverManagementModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, refetch } = useQuery<{ data: DriverRecord[] }>({
    queryKey: ['bqms-drivers'],
    queryFn: () => api.get('/api/v1/bqms/drivers'),
  });
  const drivers = data?.data ?? [];
  const [editing, setEditing] = useState<DriverRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    full_name: '', phone: '', cccd_number: '', license_plate: '',
    vehicle_type: '', driver_notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<{ id: number; kind: string } | null>(null);

  const resetForm = () => setForm({
    full_name: '', phone: '', cccd_number: '', license_plate: '',
    vehicle_type: '', driver_notes: '',
  });

  const handleStartEdit = (d: DriverRecord) => {
    setEditing(d);
    setCreating(false);
    setForm({
      full_name: d.full_name ?? '',
      phone: d.phone ?? '',
      cccd_number: d.cccd_number ?? '',
      license_plate: d.license_plate ?? '',
      vehicle_type: d.vehicle_type ?? '',
      driver_notes: d.driver_notes ?? '',
    });
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) {
      toast.error('Tên là bắt buộc');
      return;
    }
    setSaving(true);
    try {
      if (creating) {
        await api.post('/api/v1/bqms/drivers', form);
        toast.success('Đã tạo driver');
      } else if (editing) {
        await api.patch(`/api/v1/bqms/drivers/${editing.id}`, form);
        toast.success('Đã cập nhật driver');
      }
      setCreating(false);
      setEditing(null);
      resetForm();
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['bqms-drivers'] });
    } catch (e: any) {
      toast.error(`Lưu thất bại: ${e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (d: DriverRecord) => {
    if (!window.confirm(`Xóa driver "${d.full_name}"?`)) return;
    try {
      await api.delete(`/api/v1/bqms/drivers/${d.id}`);
      toast.success('Đã xóa');
      await refetch();
    } catch (e: any) {
      toast.error(`Xóa thất bại: ${e?.message ?? 'Unknown'}`);
    }
  };

  const handleUpload = async (driverId: number, kind: 'cccd' | 'license_plate', file: File) => {
    setUploading({ id: driverId, kind });
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      // Bug fix (Thang 2026-05-18): dùng api.upload — gửi đúng Authorization từ
      // localStorage 'access_token'. Trước đây raw fetch với 'token' → 401 silent fail.
      await api.upload(`/api/v1/bqms/drivers/${driverId}/upload-image`, fd);
      toast.success(`Đã upload ảnh ${kind === 'cccd' ? 'CCCD' : 'biển số'}`);
      await refetch();
    } catch (e: any) {
      toast.error(`Upload thất bại: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2.5">
            <Truck className="h-5 w-5 text-brand-600" />
            Quản lý người giao hàng <span className="text-slate-400 font-medium">({drivers.length})</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <XCircle className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4 bg-slate-50/50">
          {(creating || editing) && (
            <div className="rounded-xl border-2 border-brand-300 bg-white p-5 space-y-3 shadow-sm">
              <h3 className="text-base font-bold text-brand-700 flex items-center gap-2">
                {creating ? '+ Tạo driver mới' : `Sửa "${editing?.full_name}"`}
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">Tên <span className="text-rose-500">*</span></span>
                  <input className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" value={form.full_name}
                    onChange={e => setForm({ ...form, full_name: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">SĐT</span>
                  <input className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">Số CCCD</span>
                  <input className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-brand-500" value={form.cccd_number}
                    onChange={e => setForm({ ...form, cccd_number: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">Biển số xe</span>
                  <input className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono uppercase focus:ring-2 focus:ring-brand-500 focus:border-brand-500" value={form.license_plate}
                    onChange={e => setForm({ ...form, license_plate: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">Loại xe</span>
                  <input className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" placeholder="Xe tải 1T / Xe máy / ..." value={form.vehicle_type}
                    onChange={e => setForm({ ...form, vehicle_type: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-xs font-medium text-slate-600">Ghi chú</span>
                  <textarea className="px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" rows={2} value={form.driver_notes}
                    onChange={e => setForm({ ...form, driver_notes: e.target.value })} />
                </label>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} disabled={saving}
                  className="px-5 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors">
                  {saving ? 'Đang lưu...' : 'Lưu'}
                </button>
                <button onClick={() => { setCreating(false); setEditing(null); resetForm(); }}
                  className="px-5 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors">
                  Hủy
                </button>
              </div>
            </div>
          )}

          {!creating && !editing && (
            <button onClick={() => { setCreating(true); resetForm(); }}
              className="w-full py-3 rounded-xl border-2 border-dashed border-slate-300 text-sm font-semibold text-slate-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50/40 transition-colors">
              + Thêm driver mới
            </button>
          )}

          <div className="space-y-3">
            {drivers.map(d => (
              <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-display font-bold text-base text-slate-900">{d.full_name}</h4>
                      {d.license_plate && (
                        <span className="font-mono text-sm font-bold bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-md border border-amber-300">
                          {d.license_plate}
                        </span>
                      )}
                      {!d.is_active && (
                        <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded">Inactive</span>
                      )}
                    </div>
                    <div className="text-sm text-slate-500 mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      {d.phone && <span>📞 <span className="font-mono">{d.phone}</span></span>}
                      {d.cccd_number && <span>CCCD: <span className="font-mono">{d.cccd_number}</span></span>}
                      {d.vehicle_type && <span>🚚 {d.vehicle_type}</span>}
                    </div>
                    {d.driver_notes && <p className="text-xs text-slate-500 mt-1.5 italic">{d.driver_notes}</p>}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => handleStartEdit(d)} className="text-xs px-3 py-1 rounded-md bg-slate-100 hover:bg-slate-200 font-medium">Sửa</button>
                    <button onClick={() => handleDelete(d)} className="text-xs px-3 py-1 rounded-md bg-rose-100 text-rose-700 hover:bg-rose-200 font-medium">Xóa</button>
                  </div>
                </div>

                {/* Image rows — CCCD + biển số */}
                <div className="grid grid-cols-2 gap-3">
                  {(['cccd', 'license_plate'] as const).map(kind => {
                    const hasImg = kind === 'cccd' ? d.has_cccd_image : d.has_plate_image;
                    const label = kind === 'cccd' ? '🪪 Ảnh CCCD' : '🚗 Ảnh biển số xe';
                    const isUploading = uploading?.id === d.id && uploading?.kind === kind;
                    return (
                      <div key={kind} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs uppercase font-bold text-slate-600 tracking-wider">{label}</span>
                          <label className="cursor-pointer text-xs text-brand-600 hover:text-brand-800 font-semibold inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-brand-50">
                            {isUploading ? '...' : (hasImg ? '🔄 Đổi' : '+ Upload')}
                            <input type="file" accept="image/*" className="hidden"
                              onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) handleUpload(d.id, kind, f);
                                e.target.value = '';
                              }} />
                          </label>
                        </div>
                        {hasImg ? (
                          <AuthedImage
                            driverId={d.id}
                            kind={kind}
                            alt={label}
                            className="w-full h-40 object-contain rounded-md border border-slate-200 bg-white cursor-zoom-in hover:opacity-90 transition-opacity"
                          />
                        ) : (
                          <div className="w-full h-40 flex items-center justify-center bg-white rounded-md border-2 border-dashed border-slate-200 text-slate-300 text-sm">
                            Chưa có ảnh
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {drivers.length === 0 && !creating && (
              <p className="text-center text-sm text-slate-400 italic py-10">Chưa có driver nào. Click "+ Thêm driver mới" ở trên.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
