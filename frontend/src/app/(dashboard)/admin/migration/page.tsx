'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  PlayCircle,
  ShieldCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatRelativeTime } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface SyncStatus {
  bqms_last_sync: string | null;
  onedrive_last_sync: string | null;
  next_scheduled: string | null;
}

interface SyncHistoryItem {
  id: number;
  sync_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  rows_processed: number;
  error_message: string | null;
}

interface DataQualityItem {
  table_name: string;
  check_name: string;
  status: string;
  affected_rows: number;
  details: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────

function syncStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'success': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'running': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'failed': return 'bg-red-100 text-red-700 border-red-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function syncStatusLabel(status: string) {
  switch (status.toLowerCase()) {
    case 'success': return 'Thành công';
    case 'running': return 'Đang chạy';
    case 'failed': return 'Thất bại';
    default: return status;
  }
}

function qualityStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'pass': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'warning': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'fail': return 'bg-red-100 text-red-700 border-red-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function qualityStatusLabel(status: string) {
  switch (status.toLowerCase()) {
    case 'pass': return 'Đạt';
    case 'warning': return 'Cảnh báo';
    case 'fail': return 'Không đạt';
    default: return status;
  }
}

// ─── Sync Card ───────────────────────────────────────────────────

function SyncStatusCard({
  label,
  value,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string | null;
  icon: React.ElementType;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4 flex items-start gap-3">
      <div className="p-2 rounded-lg bg-slate-50 text-slate-500 flex-shrink-0">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">{label}</p>
        {loading ? (
          <div className="h-5 w-32 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-sm font-semibold text-slate-700 mt-0.5">
            {value ? formatRelativeTime(value) : 'Chưa đồng bộ'}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function MigrationPage() {
  const queryClient = useQueryClient();

  const { data: statusRaw, isLoading: statusLoading } = useQuery({
    queryKey: ['migration-sync-status'],
    queryFn: () => api.get<{ data: SyncStatus }>('/api/v1/data-migration/sync-status'),
    refetchInterval: 15_000,
  });

  const { data: historyRaw, isLoading: historyLoading } = useQuery({
    queryKey: ['migration-sync-history'],
    queryFn: () =>
      api.get<{ data: { items: SyncHistoryItem[]; total: number } }>(
        '/api/v1/data-migration/sync-history?page=1'
      ),
  });

  const { data: qualityRaw, isLoading: qualityLoading } = useQuery({
    queryKey: ['migration-data-quality'],
    queryFn: () =>
      api.get<{ data: DataQualityItem[] }>('/api/v1/data-migration/data-quality'),
  });

  const triggerBqmsMutation = useMutation({
    mutationFn: () => api.post('/api/v1/data-migration/trigger-sync/bqms'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['migration-sync-history'] });
    },
  });

  const triggerOnedriveMutation = useMutation({
    mutationFn: () => api.post('/api/v1/data-migration/trigger-sync/onedrive'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['migration-sync-history'] });
    },
  });

  const runQualityMutation = useMutation({
    mutationFn: () => api.post('/api/v1/data-migration/data-quality/run'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-data-quality'] });
    },
  });

  const status: SyncStatus | null = statusRaw?.data ?? (statusRaw as any) ?? null;
  const history: SyncHistoryItem[] = historyRaw?.data?.items ?? (historyRaw as any)?.items ?? [];
  const quality: DataQualityItem[] = qualityRaw?.data ?? (qualityRaw as any) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-display font-bold text-slate-900">Đồng bộ dữ liệu</h2>
        <p className="text-sm text-slate-500 mt-0.5">Quản lý đồng bộ BQMS và OneDrive</p>
      </div>

      {/* Sync Status Cards + Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SyncStatusCard
          label="Đồng bộ BQMS lần cuối"
          value={status?.bqms_last_sync ?? null}
          icon={RefreshCw}
          loading={statusLoading}
        />
        <SyncStatusCard
          label="Đồng bộ OneDrive lần cuối"
          value={status?.onedrive_last_sync ?? null}
          icon={RefreshCw}
          loading={statusLoading}
        />
        <SyncStatusCard
          label="Lịch đồng bộ tiếp theo"
          value={status?.next_scheduled ?? null}
          icon={Clock}
          loading={statusLoading}
        />
      </div>

      {/* Trigger Buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => triggerBqmsMutation.mutate()}
          disabled={triggerBqmsMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {triggerBqmsMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          Đồng bộ BQMS
        </button>
        <button
          onClick={() => triggerOnedriveMutation.mutate()}
          disabled={triggerOnedriveMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {triggerOnedriveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          Đồng bộ OneDrive
        </button>
      </div>

      {/* Sync History Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <RefreshCw className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-700">Lịch sử đồng bộ</h3>
          {historyLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-auto" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Loại</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Trạng thái</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Bắt đầu</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Số hàng</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Lỗi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {historyLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-slate-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                : history.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono font-medium text-slate-700 uppercase">
                          {item.sync_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', syncStatusBadge(item.status))}>
                          {syncStatusLabel(item.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {formatRelativeTime(item.started_at)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm text-slate-700">
                        {item.rows_processed.toLocaleString('vi-VN')}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-red-500 max-w-xs truncate">
                        {item.error_message ?? <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!historyLoading && history.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">Chưa có lịch sử đồng bộ</div>
          )}
        </div>
      </div>

      {/* Data Quality Section */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-slate-700">Chất lượng dữ liệu</h3>
          </div>
          <button
            onClick={() => runQualityMutation.mutate()}
            disabled={runQualityMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors"
          >
            {runQualityMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            Kiểm tra chất lượng
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Bảng</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Kiểm tra</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Trạng thái</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Hàng bị ảnh hưởng</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {qualityLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-slate-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                : quality.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{item.table_name}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-600">{item.check_name}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', qualityStatusBadge(item.status))}>
                          {qualityStatusLabel(item.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm text-slate-700">
                        {item.affected_rows.toLocaleString('vi-VN')}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 max-w-xs truncate">
                        {item.details ?? <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!qualityLoading && quality.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              Nhấn "Kiểm tra chất lượng" để chạy kiểm tra
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
