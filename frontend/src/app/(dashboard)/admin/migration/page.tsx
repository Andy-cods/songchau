'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Clock, PlayCircle, ShieldCheck, Database, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api } from '@/lib/api';

// ─── Types (match ACTUAL backend responses) ─────────────────

interface SyncStatusItem {
  sync_type: string;
  label: string;
  status: string;
  last_started: string | null;
  last_completed: string | null;
  rows_inserted: number | null;
  error_message: string | null;
}

interface SyncHistoryItem {
  id: number;
  sync_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  rows_inserted: number | null;
  rows_skipped: number | null;
  rows_updated: number | null;
  error_message: string | null;
  source_file: string | null;
}

interface ImportStatItem {
  table_name: string;
  row_count: number;
  exact: boolean;
}

interface DataQualityItem {
  id: number;
  table_name: string;
  check_name: string;
  check_type: string;
  status: string;
  affected_rows: number;
  details: any;
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Chưa đồng bộ';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s trước`;
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return `${Math.floor(diff / 86400)} ngày trước`;
}

function statusBadge(status: string) {
  const s = status?.toLowerCase() || '';
  if (s === 'success') return 'bg-emerald-100 text-emerald-700';
  if (s === 'running') return 'bg-blue-100 text-blue-700';
  if (s === 'error' || s === 'failed') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-600';
}

function statusLabel(status: string) {
  const s = status?.toLowerCase() || '';
  if (s === 'success') return 'Thành công';
  if (s === 'running') return 'Đang chạy';
  if (s === 'error' || s === 'failed') return 'Thất bại';
  if (s === 'never_run') return 'Chưa chạy';
  return status;
}

function qualityBadge(status: string) {
  const s = status?.toLowerCase() || '';
  if (s === 'pass') return 'bg-emerald-100 text-emerald-700';
  if (s === 'warning') return 'bg-amber-100 text-amber-700';
  if (s === 'fail') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-600';
}

function qualityLabel(status: string) {
  const s = status?.toLowerCase() || '';
  if (s === 'pass') return 'Đạt';
  if (s === 'warning') return 'Cảnh báo';
  if (s === 'fail') return 'Không đạt';
  return status;
}

// ─── Page ───────────────────────────────────────────────────

export default function MigrationPage() {
  const queryClient = useQueryClient();
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  // API: sync-status returns array of SyncStatusItem[]
  const { data: statusRaw, isLoading: statusLoading } = useQuery({
    queryKey: ['migration-sync-status'],
    queryFn: () => api.get<{ data: SyncStatusItem[] }>('/api/v1/data-migration/sync-status'),
    refetchInterval: 10_000,
  });

  // API: sync-history returns {items, total, page}
  const { data: historyRaw, isLoading: historyLoading } = useQuery({
    queryKey: ['migration-sync-history', historyPage],
    queryFn: () => api.get<{ data: { items: SyncHistoryItem[]; total: number } }>(
      `/api/v1/data-migration/sync-history?page=${historyPage}&page_size=20`
    ),
  });

  // API: import-stats returns array
  const { data: importRaw } = useQuery({
    queryKey: ['migration-import-stats'],
    queryFn: () => api.get<{ data: ImportStatItem[] }>('/api/v1/data-migration/import-stats'),
  });

  // API: data-quality returns {items, total}
  const { data: qualityRaw, isLoading: qualityLoading } = useQuery({
    queryKey: ['migration-data-quality'],
    queryFn: () => api.get<{ data: { items: DataQualityItem[]; total: number } }>(
      '/api/v1/data-migration/data-quality?page=1&page_size=50'
    ),
  });

  const triggerBqms = useMutation({
    mutationFn: () => api.post('/api/v1/data-migration/trigger-sync/bqms'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['migration-sync-history'] });
    },
  });

  const triggerOnedrive = useMutation({
    mutationFn: () => api.post('/api/v1/data-migration/trigger-sync/onedrive'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['migration-sync-history'] });
    },
  });

  const runQuality = useMutation({
    mutationFn: () => api.post('/api/v1/data-migration/data-quality/run'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-data-quality'] });
    },
  });

  // Safe data extraction
  const statusItems: SyncStatusItem[] = Array.isArray(statusRaw?.data) ? statusRaw.data : [];
  const bqmsStatus = statusItems.find(s => s.sync_type === 'bqms');
  const onedriveStatus = statusItems.find(s => s.sync_type === 'onedrive');

  const history: SyncHistoryItem[] = Array.isArray(historyRaw?.data?.items)
    ? historyRaw.data.items
    : Array.isArray(historyRaw?.data)
      ? historyRaw.data : [];
  const historyTotal = (historyRaw?.data as any)?.total ?? history.length;

  const importStats: ImportStatItem[] = Array.isArray(importRaw?.data)
    ? importRaw.data : [];

  const qualityItems: DataQualityItem[] = Array.isArray(qualityRaw?.data?.items)
    ? qualityRaw.data.items
    : Array.isArray(qualityRaw?.data)
      ? qualityRaw.data : [];

  const passCount = qualityItems.filter(q => q.status === 'pass').length;
  const warnCount = qualityItems.filter(q => q.status === 'warning').length;
  const failCount = qualityItems.filter(q => q.status === 'fail').length;

  const isAnySyncing = triggerBqms.isPending || triggerOnedrive.isPending
    || statusItems.some(s => s.status === 'running');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-display font-bold text-slate-900">Đồng bộ dữ liệu</h2>
        <p className="text-sm text-slate-500 mt-0.5">Quản lý đồng bộ BQMS Samsung và OneDrive Song Châu</p>
      </div>

      {/* ═══ Section 1: Sync Status Cards ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className={`h-4 w-4 ${bqmsStatus?.status === 'running' ? 'animate-spin text-blue-500' : 'text-slate-400'}`} />
            <span className="text-xs text-slate-500 uppercase tracking-wider">BQMS Samsung</span>
          </div>
          <p className="text-sm font-semibold text-slate-700">
            {timeAgo(bqmsStatus?.last_completed ?? bqmsStatus?.last_started ?? null)}
          </p>
          {bqmsStatus?.rows_inserted ? (
            <p className="text-xs text-slate-400 mt-1">{bqmsStatus.rows_inserted} rows</p>
          ) : null}
          <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded font-medium ${statusBadge(bqmsStatus?.status || 'never_run')}`}>
            {statusLabel(bqmsStatus?.status || 'never_run')}
          </span>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className={`h-4 w-4 ${onedriveStatus?.status === 'running' ? 'animate-spin text-indigo-500' : 'text-slate-400'}`} />
            <span className="text-xs text-slate-500 uppercase tracking-wider">OneDrive Song Châu</span>
          </div>
          <p className="text-sm font-semibold text-slate-700">
            {timeAgo(onedriveStatus?.last_completed ?? onedriveStatus?.last_started ?? null)}
          </p>
          {onedriveStatus?.rows_inserted ? (
            <p className="text-xs text-slate-400 mt-1">{onedriveStatus.rows_inserted} rows</p>
          ) : null}
          <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded font-medium ${statusBadge(onedriveStatus?.status || 'never_run')}`}>
            {statusLabel(onedriveStatus?.status || 'never_run')}
          </span>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="h-4 w-4 text-slate-400" />
            <span className="text-xs text-slate-500 uppercase tracking-wider">Import Stats</span>
          </div>
          <p className="text-sm font-semibold text-slate-700">
            {importStats.length} tables
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {importStats.reduce((sum, t) => sum + (t.row_count ?? 0), 0).toLocaleString('vi-VN')} tổng rows
          </p>
        </div>
      </div>

      {/* Trigger Buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => triggerBqms.mutate()}
          disabled={triggerBqms.isPending || isAnySyncing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {triggerBqms.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          Đồng bộ BQMS
        </button>
        <button
          onClick={() => triggerOnedrive.mutate()}
          disabled={triggerOnedrive.isPending || isAnySyncing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {triggerOnedrive.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          Đồng bộ OneDrive
        </button>
        {isAnySyncing && (
          <span className="flex items-center gap-2 text-sm text-blue-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang đồng bộ...
          </span>
        )}
      </div>

      {/* ═══ Section 2: Sync History ═══ */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <RefreshCw className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-700">Lịch sử đồng bộ</h3>
          <span className="text-xs text-slate-400 ml-auto">{historyTotal} bản ghi</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Loại</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Trạng thái</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Thời gian</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Inserted</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Skipped</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Lỗi</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {historyLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-200 rounded animate-pulse" /></td>
                  ))}</tr>
                ))
              ) : history.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">Chưa có lịch sử đồng bộ</td></tr>
              ) : history.map((item) => (
                <>
                  <tr key={item.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => setExpandedRow(expandedRow === item.id ? null : item.id)}>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono font-medium text-slate-700 uppercase">{item.sync_type}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusBadge(item.status)}`}>
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{timeAgo(item.started_at)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-700">{(item.rows_inserted ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-400">{(item.rows_skipped ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-xs text-red-500 max-w-[200px] truncate">{item.error_message || '—'}</td>
                    <td className="px-2">{expandedRow === item.id ? <ChevronUp className="h-3 w-3 text-slate-400" /> : <ChevronDown className="h-3 w-3 text-slate-400" />}</td>
                  </tr>
                  {expandedRow === item.id && (
                    <tr key={`${item.id}-detail`}>
                      <td colSpan={7} className="bg-slate-50 px-6 py-3 text-xs text-slate-600">
                        <div className="grid grid-cols-2 gap-4">
                          <div><span className="text-slate-400">Bắt đầu:</span> {item.started_at ? new Date(item.started_at).toLocaleString('vi-VN') : '—'}</div>
                          <div><span className="text-slate-400">Hoàn thành:</span> {item.completed_at ? new Date(item.completed_at).toLocaleString('vi-VN') : '—'}</div>
                          <div><span className="text-slate-400">Rows inserted:</span> {item.rows_inserted ?? 0}</div>
                          <div><span className="text-slate-400">Rows updated:</span> {item.rows_updated ?? 0}</div>
                          <div><span className="text-slate-400">Rows skipped:</span> {item.rows_skipped ?? 0}</div>
                          <div><span className="text-slate-400">Source:</span> {item.source_file || '—'}</div>
                          {item.error_message && (
                            <div className="col-span-2 text-red-600 bg-red-50 p-2 rounded">{item.error_message}</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {historyTotal > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-400">Trang {historyPage}</span>
            <div className="flex gap-1">
              <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage === 1}
                className="px-3 py-1 text-xs border rounded disabled:opacity-40">Trước</button>
              <button onClick={() => setHistoryPage(p => p + 1)} disabled={historyPage * 20 >= historyTotal}
                className="px-3 py-1 text-xs border rounded disabled:opacity-40">Sau</button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ Section 3: Import Stats ═══ */}
      {importStats.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-slate-100">
            <Database className="h-4 w-4 text-green-600" />
            <h3 className="text-sm font-semibold text-slate-700">Thống kê Import theo bảng</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Bảng</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Số hàng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {importStats.filter(t => t.row_count > 0).sort((a, b) => b.row_count - a.row_count).map((t, i) => (
                  <tr key={i} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{t.table_name}</td>
                    <td className="px-4 py-2 text-right font-mono text-sm text-slate-800">{(t.row_count ?? 0).toLocaleString('vi-VN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Section 4: Data Quality ═══ */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-slate-700">Chất lượng dữ liệu</h3>
            {qualityItems.length > 0 && (
              <div className="flex gap-2 ml-4">
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">{passCount} đạt</span>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">{warnCount} cảnh báo</span>
                <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">{failCount} lỗi</span>
              </div>
            )}
          </div>
          <button
            onClick={() => runQuality.mutate()}
            disabled={runQuality.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-60"
          >
            {runQuality.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            Kiểm tra chất lượng
          </button>
        </div>

        {/* Summary progress bar */}
        {qualityItems.length > 0 && (
          <div className="px-4 py-2 border-b border-slate-100">
            <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
              {passCount > 0 && <div className="bg-emerald-500" style={{ width: `${passCount / qualityItems.length * 100}%` }} />}
              {warnCount > 0 && <div className="bg-amber-500" style={{ width: `${warnCount / qualityItems.length * 100}%` }} />}
              {failCount > 0 && <div className="bg-red-500" style={{ width: `${failCount / qualityItems.length * 100}%` }} />}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Bảng</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Kiểm tra</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Loại</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Kết quả</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Hàng ảnh hưởng</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {qualityLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-200 rounded animate-pulse" /></td>
                  ))}</tr>
                ))
              ) : qualityItems.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">Nhấn "Kiểm tra chất lượng" để chạy kiểm tra</td></tr>
              ) : qualityItems.map((item, idx) => (
                <tr key={item.id ?? idx} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{item.table_name}</td>
                  <td className="px-4 py-2.5 text-sm text-slate-600">{item.check_name}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{item.check_type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${qualityBadge(item.status)}`}>
                      {qualityLabel(item.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm text-slate-700">{(item.affected_rows ?? 0).toLocaleString('vi-VN')}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[200px] truncate">
                    {typeof item.details === 'object' && item.details
                      ? JSON.stringify(item.details).slice(0, 80)
                      : item.details || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
