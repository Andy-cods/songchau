'use client';

// Phase G (Thang 2026-05-13): Smart Code-Track widget panel.
// Hiển thị trong DataGaps drawer dưới block Auto-rescan.
//
// - Toggle bật/tắt engine (default ON per Thang request)
// - Status dot + summary "Vừa heal X gap"
// - Grid 10 badge gap_type với count, mỗi loại 1 màu
// - Footer "Healed hôm nay: N · Cooldown: M"
// - Collapse panel "Lịch sử heal" lazy-load /data-gaps/healing-log

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface GapsLike {
  code_track?: {
    enabled: boolean;
    last_run: {
      status?: string;
      gaps_detected?: number;
      healed?: number;
      duration_seconds?: number;
      finished_at?: string;
      updated_at?: string | null;
      errors?: string[];
    } | null;
    gap_breakdown: Record<string, number>;
    healed_today: number;
    pending_cooldown: number;
  };
}

const GAP_LABELS: Record<string, { vi: string; color: string }> = {
  d1_metadata_null:        { vi: 'Thiếu thông tin', color: 'bg-rose-100 text-rose-700 border-rose-200' },
  d2_items_mismatch:       { vi: 'Thiếu items', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  d3_folder_missing:       { vi: 'Thiếu folder', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  d4_subfolder_missing:    { vi: 'Thiếu subfolder', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  d5_all_image_tiers_empty:{ vi: 'Không có ảnh', color: 'bg-sky-100 text-sky-700 border-sky-200' },
  d6_override_stale:       { vi: 'Override hỏng', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  d7_folder_name_legacy:   { vi: 'Folder cũ', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  d8_orphan_folder_old:    { vi: 'Folder mồ côi', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  d9_item_type_null:       { vi: 'Chưa phân TM/GC', color: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
  d10_orphan_image:        { vi: 'Ảnh mồ côi', color: 'bg-slate-100 text-slate-600 border-slate-200' },
};

interface HealingLogEntry {
  id: number;
  rfq_number: string;
  gap_type: string;
  evidence: any;
  detected_at: string;
  last_attempt_at: string | null;
  drill_attempts: number;
  healed_at: string | null;
  last_error: string | null;
}

export function SmartCodeTrackPanel({
  gaps,
  onChanged,
}: {
  gaps: GapsLike | undefined;
  onChanged: () => void;
}) {
  const ct = gaps?.code_track;
  const [showLog, setShowLog] = useState(false);

  const handleToggle = async () => {
    const next = !(ct?.enabled ?? true);
    try {
      await api.post(`/api/v1/bqms/data-gaps/toggle-code-track?enabled=${next}`, {});
      toast.success(`Smart Code-Track đã ${next ? 'BẬT' : 'TẮT'}`);
      onChanged();
    } catch (e: any) {
      toast.error(`Toggle lỗi: ${e?.message ?? 'Unknown'}`);
    }
  };

  const status = ct?.last_run?.status ?? 'idle';
  const dotColor =
    status === 'running' ? 'bg-amber-500 animate-pulse'
    : status === 'idle' ? 'bg-emerald-500'
    : status === 'done' ? 'bg-emerald-500'
    : status === 'all_cooldown' ? 'bg-sky-400'
    : status === 'skipped_lock' ? 'bg-slate-300'
    : status === 'error' ? 'bg-red-500'
    : status === 'disabled' ? 'bg-slate-300'
    : 'bg-slate-300';

  const summaryText = (() => {
    if (status === 'disabled') return 'Đang TẮT';
    if (status === 'running') return `Đang heal ${ct?.last_run?.gaps_detected ?? 0} gap...`;
    if (status === 'idle') return 'Idle (0 gap)';
    if (status === 'done') {
      const h = ct?.last_run?.healed ?? 0;
      const d = ct?.last_run?.gaps_detected ?? 0;
      return `Vừa heal ${h}/${d} gap (${ct?.last_run?.duration_seconds?.toFixed?.(1) ?? '?'}s)`;
    }
    if (status === 'all_cooldown') return 'Tất cả đang cooldown';
    if (status === 'skipped_lock') return 'Skip — worker khác đang chạy';
    if (status === 'error') return `Lỗi: ${ct?.last_run?.errors?.[0] ?? 'unknown'}`;
    return 'Chưa chạy';
  })();

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700">
          🧠 Smart Code-Track
        </span>
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
            ct?.enabled ? 'bg-emerald-500' : 'bg-slate-300',
          )}
          title={ct?.enabled
            ? 'Smart Code-Track đang BẬT — heal 10 loại gap mỗi 3 phút. Click để TẮT.'
            : 'Smart Code-Track đang TẮT. Click để BẬT.'
          }
        >
          <span className={cn(
            'inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform',
            ct?.enabled ? 'translate-x-3.5' : 'translate-x-0.5',
          )}/>
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-[11px]">
        <span className={cn('inline-block w-2 h-2 rounded-full', dotColor)}/>
        <span className="text-slate-600 truncate">{summaryText}</span>
      </div>

      {/* Gap breakdown grid */}
      {ct?.gap_breakdown && Object.keys(ct.gap_breakdown).length > 0 && (
        <div className="grid grid-cols-2 gap-1 pt-1">
          {Object.entries(ct.gap_breakdown).map(([kind, count]) => {
            const lbl = GAP_LABELS[kind] ?? { vi: kind, color: 'bg-slate-100' };
            return (
              <div
                key={kind}
                className={cn(
                  'flex items-center justify-between px-1.5 py-0.5 rounded text-[11px] font-medium border',
                  lbl.color,
                )}
                title={kind}
              >
                <span className="truncate">{lbl.vi}</span>
                <span className="font-bold tabular-nums ml-1">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {ct && (
        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-brand-100">
          <span>Healed hôm nay: <b className="text-emerald-600">{ct.healed_today}</b></span>
          <span>Cooldown: <b className="text-amber-600">{ct.pending_cooldown}</b></span>
        </div>
      )}

      {ct?.last_run?.updated_at && (
        <div className="text-[11px] text-slate-400">
          Lần cuối: {new Date(ct.last_run.updated_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowLog(v => !v)}
        className="text-[11px] text-brand-600 hover:text-brand-800 underline w-full text-left"
      >
        {showLog ? '▼ Ẩn lịch sử heal' : '▶ Xem lịch sử heal'}
      </button>

      {showLog && <HealingLogList />}

      <div className="text-[11px] text-slate-500 italic">
        Tự chạy mỗi 3 phút. Detect 10 loại gap, target re-scrape, map back. Cooldown 10 phút/RFQ.
      </div>
    </div>
  );
}


function HealingLogList() {
  const { data, isLoading } = useQuery<{ data: HealingLogEntry[] }>({
    queryKey: ['bqms-healing-log'],
    queryFn: () => api.get('/api/v1/bqms/data-gaps/healing-log?limit=30'),
    refetchInterval: 30_000,
  });
  const entries = data?.data ?? [];

  if (isLoading) return <div className="text-[11px] text-slate-400 italic py-2">Đang tải...</div>;
  if (entries.length === 0) return <div className="text-[11px] text-slate-400 italic py-2">Chưa có entry nào.</div>;

  return (
    <div className="space-y-1 max-h-[200px] overflow-auto bg-white rounded border border-brand-100 p-1.5">
      {entries.map(e => {
        const lbl = GAP_LABELS[e.gap_type] ?? { vi: e.gap_type, color: 'bg-slate-100' };
        const isHealed = !!e.healed_at;
        return (
          <div key={e.id} className="flex items-center gap-1.5 text-[11px] py-0.5">
            <span className={cn(
              'inline-block w-1.5 h-1.5 rounded-full shrink-0',
              isHealed ? 'bg-emerald-500' : (e.last_error ? 'bg-red-500' : 'bg-amber-500'),
            )}/>
            <span className="font-mono text-slate-700 shrink-0">{e.rfq_number}</span>
            <span className={cn('px-1 py-0 rounded text-[11px] shrink-0', lbl.color)}>{lbl.vi}</span>
            <span className="text-slate-400 truncate text-[11px]">
              {isHealed
                ? `✓ ${new Date(e.healed_at!).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
                : e.last_error
                ? `✗ ${e.last_error.slice(0, 40)}`
                : `× ${e.drill_attempts} thử`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
