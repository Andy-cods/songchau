'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, CheckCircle2, XCircle, Clock, Loader2,
  ChevronDown, LogIn, KeyRound, ShieldCheck, FileSearch, Download, Database,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────

interface SyncLatest {
  id: number;
  status: string;
  started_at?: string;
  completed_at?: string;
  rows_inserted?: number;
  rows_updated?: number;
  error_message?: string;
  duration_seconds?: number;
}

interface SyncStep {
  step: number;
  status: string; // "running" | "done" | "error"
  message: string;
  updated_at?: string;
}

interface SyncStepsData {
  steps: SyncStep[];
  current_step: number;
  current_status?: string;
  started_at?: string;
  definitions?: { step: number; label: string }[];
}

// ─── Step Icons ─────────────────────────────────────────────────

const STEP_ICONS = [
  LogIn,        // 1: Mở trang đăng nhập
  KeyRound,     // 2: Điền tài khoản
  ShieldCheck,  // 3: Đăng nhập & xác thực
  FileSearch,   // 4: Mở trang P/O Receipt
  Download,     // 5: Tải danh sách PO
  Database,     // 6: Lưu vào database
];

const STEP_LABELS = [
  'Mở trang đăng nhập',
  'Điền tài khoản',
  'Đăng nhập & xác thực',
  'Mở trang P/O Receipt',
  'Tải danh sách PO',
  'Lưu vào database',
];

function relativeTime(isoStr?: string): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '—';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return `${Math.floor(diff / 86400)} ngày trước`;
}

// ─── Widget ─────────────────────────────────────────────────────

export function SamsungSyncWidget() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncJobId, setSyncJobId] = useState<number | null>(null);
  const [syncError, setSyncError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  // Latest sync
  const { data: latestRaw } = useQuery({
    queryKey: ['bqms-sync-latest'],
    queryFn: () => api.get<any>('/api/v1/bqms/sync/latest'),
    refetchInterval: syncing ? 5000 : 60000,
  });
  const latest: SyncLatest | null = latestRaw?.data ?? null;

  // History
  const { data: historyRaw } = useQuery({
    queryKey: ['bqms-sync-history'],
    queryFn: () => api.get<any>('/api/v1/bqms/sync/history?limit=5'),
    enabled: showHistory,
  });
  const history: SyncLatest[] = historyRaw?.data ?? [];

  // Step progress — poll every 2s while syncing
  const { data: stepsData } = useQuery({
    queryKey: ['bqms-sync-steps'],
    queryFn: () => api.get<SyncStepsData>('/api/v1/bqms/sync/steps'),
    refetchInterval: syncing ? 2000 : false,
    enabled: syncing || showSteps,
  });
  const steps: SyncStep[] = stepsData?.steps ?? [];

  // Auto-show steps when syncing
  useEffect(() => {
    if (syncing) setShowSteps(true);
  }, [syncing]);

  // Poll job status
  useQuery({
    queryKey: ['bqms-sync-status', syncJobId],
    queryFn: () => api.get<any>(`/api/v1/bqms/sync/status/${syncJobId}`),
    enabled: syncing && syncJobId !== null,
    refetchInterval: 5000,
    select: (data: any) => {
      const status = data?.data?.status;
      if (status && status !== 'queued' && status !== 'running') {
        setSyncing(false);
        setSyncJobId(null);
        queryClient.invalidateQueries({ queryKey: ['bqms-sync-latest'] });
        queryClient.invalidateQueries({ queryKey: ['bqms-sync-history'] });
        queryClient.invalidateQueries({ queryKey: ['bqms-sync-steps'] });
      }
      return data;
    },
  });

  const handleSync = async () => {
    setSyncing(true);
    setSyncError('');
    setShowSteps(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const ago = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const res = await api.post<any>(`/api/v1/bqms/sync?date_from=${ago}&date_to=${today}`);
      setSyncJobId(res.job_id);
    } catch (err: any) {
      setSyncError(err?.detail ?? 'Lỗi khởi tạo đồng bộ');
      setSyncing(false);
    }
  };

  // Status display
  const statusIcon = latest?.status === 'success'
    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    : latest?.status === 'error'
    ? <XCircle className="h-4 w-4 text-red-500" />
    : latest?.status === 'running'
    ? <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
    : <Clock className="h-4 w-4 text-slate-400" />;

  const statusText = latest?.status === 'success' ? 'Thành công'
    : latest?.status === 'error' ? 'Lỗi'
    : latest?.status === 'running' ? 'Đang chạy'
    : latest?.status === 'queued' ? 'Đang chờ'
    : 'Chưa đồng bộ';

  const statusColor = latest?.status === 'success' ? 'text-emerald-600'
    : latest?.status === 'error' ? 'text-red-600'
    : 'text-slate-500';

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-brand-500" />
          <span className="text-sm font-semibold text-slate-700">Đồng bộ Samsung BQMS</span>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {syncing ? 'Đang đồng bộ...' : 'Đồng bộ ngay'}
        </button>
      </div>

      {/* Last sync info */}
      {latest ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {statusIcon}
            <span className={cn('text-sm font-medium', statusColor)}>{statusText}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Lần cuối:</span>
            <span className="text-slate-700">{relativeTime(latest.completed_at || latest.started_at)}</span>
            {latest.rows_inserted != null && (
              <>
                <span>Kết quả:</span>
                <span className="text-slate-700">{latest.rows_inserted} PO mới, {latest.rows_updated ?? 0} cập nhật</span>
              </>
            )}
            {latest.duration_seconds != null && (
              <>
                <span>Thời gian:</span>
                <span className="text-slate-700">{latest.duration_seconds}s</span>
              </>
            )}
          </div>
          {latest.error_message && (
            <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 mt-1">{latest.error_message}</div>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400">Chưa đồng bộ lần nào. Nhấn "Đồng bộ ngay" để bắt đầu.</p>
      )}

      {syncError && (
        <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 mt-2">{syncError}</div>
      )}

      {/* ── Step Progress ── */}
      <button
        onClick={() => setShowSteps(!showSteps)}
        className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
      >
        <ChevronDown className={cn('h-3 w-3 transition-transform', showSteps && 'rotate-180')} />
        Tiến trình các bước
      </button>

      {showSteps && (
        <div className="mt-2 border-t border-slate-100 pt-3 space-y-0">
          {STEP_LABELS.map((label, idx) => {
            const stepNum = idx + 1;
            const step = steps.find(s => s.step === stepNum);
            const Icon = STEP_ICONS[idx];
            const isDone = step?.status === 'done';
            const isRunning = step?.status === 'running';
            const isError = step?.status === 'error';
            const isPending = !step;
            const isLast = idx === STEP_LABELS.length - 1;

            return (
              <div key={stepNum} className="flex items-start gap-3">
                {/* Vertical line + icon */}
                <div className="flex flex-col items-center">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all',
                    isDone && 'bg-emerald-500 border-emerald-500',
                    isRunning && 'bg-blue-500 border-blue-500 animate-pulse',
                    isError && 'bg-red-500 border-red-500',
                    isPending && 'bg-white border-slate-200',
                  )}>
                    {isRunning ? (
                      <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                    ) : isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                    ) : isError ? (
                      <XCircle className="h-3.5 w-3.5 text-white" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 text-slate-400" />
                    )}
                  </div>
                  {!isLast && (
                    <div className={cn(
                      'w-0.5 h-6',
                      isDone ? 'bg-emerald-300' : 'bg-slate-200',
                    )} />
                  )}
                </div>

                {/* Content */}
                <div className="pt-1 pb-3 min-w-0 flex-1">
                  <p className={cn(
                    'text-xs font-medium',
                    isDone && 'text-emerald-700',
                    isRunning && 'text-blue-700',
                    isError && 'text-red-700',
                    isPending && 'text-slate-400',
                  )}>
                    Bước {stepNum}: {label}
                  </p>
                  {step?.message && (
                    <p className={cn(
                      'text-[11px] mt-0.5',
                      isDone ? 'text-emerald-600' : isRunning ? 'text-blue-600' : isError ? 'text-red-600' : 'text-slate-400',
                    )}>
                      {step.message}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── History ── */}
      <button
        onClick={() => setShowHistory(!showHistory)}
        className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
      >
        <ChevronDown className={cn('h-3 w-3 transition-transform', showHistory && 'rotate-180')} />
        Lịch sử đồng bộ
      </button>

      {showHistory && history.length > 0 && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-slate-400 uppercase">
                <th className="text-left py-1">Thời gian</th>
                <th className="text-left py-1">Trạng thái</th>
                <th className="text-right py-1">Kết quả</th>
                <th className="text-right py-1">Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id} className="text-xs border-t border-slate-50">
                  <td className="py-1 text-slate-600">{formatDate(h.started_at)}</td>
                  <td className="py-1">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                      h.status === 'success' ? 'bg-emerald-50 text-emerald-700' :
                      h.status === 'error' ? 'bg-red-50 text-red-700' :
                      'bg-slate-50 text-slate-600'
                    )}>
                      {h.status === 'success' ? 'OK' : h.status === 'error' ? 'Lỗi' : h.status}
                    </span>
                  </td>
                  <td className="py-1 text-right text-slate-600 font-mono">
                    {h.status === 'success' ? `${h.rows_inserted ?? 0}+${h.rows_updated ?? 0}` : '—'}
                  </td>
                  <td className="py-1 text-right text-slate-500 font-mono">{h.duration_seconds ?? '—'}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
