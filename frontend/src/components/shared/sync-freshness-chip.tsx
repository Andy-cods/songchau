'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RefreshCw, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

type ModuleHealth = {
  sync_type?: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  minutes_ago: number | null;
  is_stale: boolean;
  error_message?: string | null;
  files_processed?: number | null;
  rows_inserted?: number | null;
};

type Health = {
  now: string;
  files_indexed?: number;
  modules: Record<string, ModuleHealth>;
};

const fmtAgo = (m: number | null) => {
  if (m == null) return '—';
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h trước`;
  return `${Math.floor(h / 24)} ngày trước`;
};

export function SyncFreshnessChip({
  module,
  showSyncButton = false,
}: {
  module: 'documents' | 'bqms' | 'deliveries';
  showSyncButton?: boolean;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Health>('/api/v1/etl/sync-health');
      setHealth(r);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const trigger = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ message: string }>('/api/v1/etl/sync-local');
      setMsg(r.message);
      setTimeout(load, 30_000);
    } catch (e: any) {
      setMsg(e?.detail || 'Không sync được');
    } finally {
      setBusy(false);
    }
  };

  if (!health || !health.modules?.[module]) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-slate-400">
        <Clock className="h-3 w-3 animate-pulse" /> Đang kiểm tra…
      </div>
    );
  }

  const m = health.modules[module];
  const isOk = !m.is_stale && m.status === 'success';
  const isError = m.status === 'error';

  return (
    <div className="inline-flex items-center gap-3 flex-wrap">
      <div
        className={cn(
          'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium',
          isError ? 'bg-rose-50 text-rose-700' :
          m.is_stale ? 'bg-amber-50 text-amber-700' :
          'bg-emerald-50 text-emerald-700',
        )}
        title={m.error_message || ''}
      >
        {isError ? <AlertCircle className="h-3 w-3" /> :
         m.is_stale ? <Clock className="h-3 w-3" /> :
         <CheckCircle2 className="h-3 w-3" />}
        {m.status === 'never'
          ? 'Chưa từng đồng bộ'
          : `Đồng bộ ${fmtAgo(m.minutes_ago)}`}
      </div>

      {module === 'documents' && health.files_indexed != null && (
        <span className="text-xs text-slate-500 tabular-nums">
          {new Intl.NumberFormat('vi-VN').format(health.files_indexed)} mục đã index
        </span>
      )}

      {showSyncButton && (
        <button
          onClick={trigger}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs h-7 px-2.5 rounded-md bg-slate-900 text-white font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', busy && 'animate-spin')} />
          {busy ? 'Đang sync…' : 'Sync ngay'}
        </button>
      )}

      {msg && <span className="text-[11px] text-slate-500">{msg}</span>}
    </div>
  );
}
