'use client';

// PR-1 (Thang 2026-05-13): extracted from deliveries/page.tsx.
// Hiển thị driver đang gán + dropdown chọn lại driver. Nút mở modal
// quản lý driver (CRUD + upload ảnh CCCD / biển số).

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Eye, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { DriverRecord, DriverPickerDelivery } from './types';

export function DriverPicker({ delivery, onChanged, onOpenManager }: {
  delivery: DriverPickerDelivery;
  onChanged: () => void;
  onOpenManager: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  // Show CCCD + biển số inline khi user click "Xem ảnh" (Thang 2026-05-18)
  const [showImages, setShowImages] = useState(false);
  const { data: driversData } = useQuery<{ data: DriverRecord[] }>({
    queryKey: ['bqms-drivers'],
    queryFn: () => api.get('/api/v1/bqms/drivers'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const allDrivers = driversData?.data ?? [];
  const filtered = search
    ? allDrivers.filter(d =>
        d.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        (d.phone ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (d.license_plate ?? '').toLowerCase().includes(search.toLowerCase()))
    : allDrivers;

  // Driver record của driver đang assigned — để biết có ảnh CCCD/biển số chưa
  const assignedDriver = delivery.driver_id
    ? allDrivers.find(d => d.id === delivery.driver_id)
    : null;

  const assignDriver = async (driverId: number | null) => {
    setSaving(true);
    try {
      await api.put(`/api/v1/bqms/deliveries/${delivery.id}`, { driver_id: driverId });
      toast.success(driverId ? 'Đã gán người giao hàng' : 'Đã bỏ gán');
      onChanged();
      setOpen(false);
    } catch (e: any) {
      toast.error(`Gán thất bại: ${e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/40 overflow-hidden">
      <div className="px-3.5 py-2 border-b border-slate-200 bg-white flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Truck className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-slate-600">Người giao hàng</span>
        </div>
        <button
          type="button"
          onClick={onOpenManager}
          className="text-[11px] text-brand-600 hover:text-brand-800 font-semibold"
          title="Quản lý driver (CCCD, biển số xe)"
        >
          Quản lý ↗
        </button>
      </div>
      <div className="px-3.5 py-3 space-y-2">
        {delivery.driver_id ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-800 truncate">{delivery.driver_name ?? '—'}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                  {delivery.driver_phone && <span>📞 <span className="font-mono">{delivery.driver_phone}</span></span>}
                  {delivery.driver_license_plate && (
                    <span className="font-mono font-bold text-emerald-700 bg-white px-1.5 py-0.5 rounded border border-emerald-300">
                      {delivery.driver_license_plate}
                    </span>
                  )}
                  {delivery.driver_vehicle_type && <span className="text-slate-400">({delivery.driver_vehicle_type})</span>}
                  {assignedDriver?.cccd_number && (
                    <span>CCCD: <span className="font-mono text-slate-600">{assignedDriver.cccd_number}</span></span>
                  )}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setOpen(v => !v)}
                  disabled={saving}
                  className="text-[11px] px-2 py-0.5 rounded bg-white border border-slate-200 hover:bg-slate-50"
                >
                  Đổi
                </button>
                <button
                  type="button"
                  onClick={() => assignDriver(null)}
                  disabled={saving}
                  className="text-[11px] px-2 py-0.5 rounded bg-white border border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  Bỏ gán
                </button>
              </div>
            </div>

            {/* Xem chi tiết ảnh CCCD + biển số (Thang 2026-05-18) */}
            {(assignedDriver?.has_cccd_image || assignedDriver?.has_plate_image) && (
              <button
                type="button"
                onClick={() => setShowImages(v => !v)}
                className="mt-2 w-full text-xs px-2 py-1.5 rounded bg-white border border-emerald-200 hover:bg-emerald-50 text-emerald-700 font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Eye className="h-3.5 w-3.5" />
                {showImages ? 'Ẩn ảnh' : 'Xem ảnh CCCD + biển số'}
                <ChevronDown className={cn('h-3 w-3 transition-transform', showImages && 'rotate-180')} />
              </button>
            )}
            {showImages && assignedDriver && (
              <div className="mt-2 grid grid-cols-2 gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <DriverImageBlock
                  driverId={assignedDriver.id}
                  kind="cccd"
                  label="🪪 CCCD"
                  hasImg={!!assignedDriver.has_cccd_image}
                />
                <DriverImageBlock
                  driverId={assignedDriver.id}
                  kind="license_plate"
                  label="🚗 Biển số"
                  hasImg={!!assignedDriver.has_plate_image}
                />
              </div>
            )}
            {assignedDriver && !assignedDriver.has_cccd_image && !assignedDriver.has_plate_image && (
              <p className="mt-2 text-[11px] text-slate-400 italic text-center">
                Chưa có ảnh CCCD / biển số. Click "Quản lý ↗" để upload.
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="w-full px-3 py-2 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50/30 transition-colors"
          >
            + Chọn người giao hàng
          </button>
        )}

        {open && (
          <div className="rounded-lg border border-slate-200 bg-white p-2 space-y-1.5 max-h-[280px] overflow-auto">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm tên, SĐT, biển số..."
              className="w-full text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-brand-400"
              autoFocus
            />
            {filtered.length === 0 && (
              <p className="text-xs text-slate-400 italic text-center py-2">Không có driver. Click "Quản lý ↗" để tạo mới.</p>
            )}
            {filtered.map(d => (
              <button
                type="button"
                key={d.id}
                onClick={() => assignDriver(d.id)}
                disabled={saving}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded text-xs hover:bg-brand-50 transition-colors flex items-center gap-2',
                  d.id === delivery.driver_id && 'bg-emerald-50 ring-1 ring-emerald-300',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-700 truncate">{d.full_name}</div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-2">
                    {d.phone && <span>📞 {d.phone}</span>}
                    {d.license_plate && <span className="font-mono">{d.license_plate}</span>}
                  </div>
                </div>
                <div className="flex gap-0.5">
                  {d.has_cccd_image && <span className="text-[11px] text-emerald-600" title="Có ảnh CCCD">CCCD</span>}
                  {d.has_plate_image && <span className="text-[11px] text-emerald-600" title="Có ảnh biển số">BS</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Driver image block — render JWT-token-aware <img> để xem CCCD/biển số inline.
 * Endpoint backend yêu cầu Authorization → fetch blob + ObjectURL.
 */
function DriverImageBlock({
  driverId, kind, label, hasImg,
}: {
  driverId: number;
  kind: 'cccd' | 'license_plate';
  label: string;
  hasImg: boolean;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch blob with auth header (img tag không tự gửi JWT).
  // Revoke ObjectURL khi unmount để tránh leak.
  useEffect(() => {
    if (!hasImg || typeof window === 'undefined') return;
    let url: string | null = null;
    let cancelled = false;
    setLoading(true);
    const token = localStorage.getItem('access_token') ?? '';
    fetch(`/api/v1/bqms/drivers/${driverId}/image/${kind}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.blob() : null)
      .then(b => {
        if (cancelled || !b) return;
        url = URL.createObjectURL(b);
        setBlobUrl(url);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [driverId, kind, hasImg]);

  return (
    <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
      <div className="px-2 py-1 bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wide text-slate-600">
        {label}
      </div>
      {hasImg ? (
        loading ? (
          <div className="h-32 flex items-center justify-center text-[11px] text-slate-400">Đang tải...</div>
        ) : blobUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <a href={blobUrl} target="_blank" rel="noreferrer" title="Click để xem full size">
            <img src={blobUrl} alt={label} className="w-full h-32 object-contain bg-slate-50 cursor-zoom-in hover:opacity-90 transition-opacity" />
          </a>
        ) : (
          <div className="h-32 flex items-center justify-center text-[11px] text-rose-500">Lỗi tải ảnh</div>
        )
      ) : (
        <div className="h-32 flex items-center justify-center text-[11px] text-slate-300 italic bg-slate-50">
          Chưa upload
        </div>
      )}
    </div>
  );
}
