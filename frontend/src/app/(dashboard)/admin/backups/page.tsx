'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  HardDrive,
  Loader2,
  CheckCircle2,
  Shield,
  ShieldOff,
  Database,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatRelativeTime } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface Backup {
  id: number;
  backup_type: string;
  file_size_bytes: number;
  tables_count: number;
  rows_count: number;
  status: string;
  verified: boolean;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function statusBadgeClass(status: string) {
  switch (status.toLowerCase()) {
    case 'completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'running': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'failed': return 'bg-red-100 text-red-700 border-red-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function statusLabel(status: string) {
  switch (status.toLowerCase()) {
    case 'completed': return 'Hoàn thành';
    case 'running': return 'Đang chạy';
    case 'failed': return 'Thất bại';
    default: return status;
  }
}

function backupTypeBadge(type: string) {
  switch (type.toLowerCase()) {
    case 'full': return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'incremental': return 'bg-cyan-100 text-cyan-700 border-cyan-200';
    case 'differential': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function backupTypeLabel(type: string) {
  switch (type.toLowerCase()) {
    case 'full': return 'Đầy đủ';
    case 'incremental': return 'Tăng dần';
    case 'differential': return 'Vi sai';
    default: return type;
  }
}

// ─── Page ─────────────────────────────────────────────────────────

export default function BackupsPage() {
  const queryClient = useQueryClient();

  const { data: backupsRaw, isLoading } = useQuery({
    queryKey: ['system-health-backups'],
    queryFn: () => api.get<{ data: Backup[] }>('/api/v1/system-health/backups'),
  });

  const verifyMutation = useMutation({
    mutationFn: (id: number) =>
      api.post(`/api/v1/system-health/backups/verify/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-health-backups'] });
    },
  });

  const backups: Backup[] = backupsRaw?.data ?? (backupsRaw as any) ?? [];

  const verifiedCount = backups.filter((b) => b.verified).length;
  const unverifiedCount = backups.filter((b) => !b.verified).length;
  const totalSize = backups.reduce((sum, b) => sum + (b.file_size_bytes ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-display font-bold text-slate-900">Xác thực backup</h2>
        <p className="text-sm text-slate-500 mt-0.5">Quản lý và xác minh các bản sao lưu hệ thống</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">Tổng backup</p>
          <p className="text-2xl font-bold mt-1 text-slate-800">
            {isLoading ? <span className="inline-block h-7 w-12 bg-slate-200 rounded animate-pulse" /> : backups.length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">Đã xác thực</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600">
            {isLoading ? <span className="inline-block h-7 w-12 bg-slate-200 rounded animate-pulse" /> : verifiedCount}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">Chưa xác thực</p>
          <p className={cn('text-2xl font-bold mt-1', unverifiedCount > 0 ? 'text-amber-600' : 'text-slate-800')}>
            {isLoading ? <span className="inline-block h-7 w-12 bg-slate-200 rounded animate-pulse" /> : unverifiedCount}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">Tổng dung lượng</p>
          <p className="text-2xl font-bold mt-1 text-slate-800">
            {isLoading ? <span className="inline-block h-7 w-16 bg-slate-200 rounded animate-pulse" /> : formatBytes(totalSize)}
          </p>
        </div>
      </div>

      {/* Backups Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <HardDrive className="h-4 w-4 text-slate-600" />
          <h3 className="text-sm font-semibold text-slate-700">Danh sách backup</h3>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-auto" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Loại</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Dung lượng</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Bảng</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Số hàng</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Trạng thái</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Xác thực</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Ngày tạo</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-slate-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                : backups.map((backup) => (
                    <tr key={backup.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', backupTypeBadge(backup.backup_type))}>
                          {backupTypeLabel(backup.backup_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
                        {formatBytes(backup.file_size_bytes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-slate-700">
                        {backup.tables_count.toLocaleString('vi-VN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-slate-700">
                        {backup.rows_count.toLocaleString('vi-VN')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', statusBadgeClass(backup.status))}>
                          {statusLabel(backup.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {backup.verified ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-600">
                            <Shield className="h-3.5 w-3.5" />
                            Đã xác thực
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-amber-500">
                            <ShieldOff className="h-3.5 w-3.5" />
                            Chưa xác thực
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {formatRelativeTime(backup.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {!backup.verified && (
                          <button
                            onClick={() => verifyMutation.mutate(backup.id)}
                            disabled={verifyMutation.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-60 transition-colors whitespace-nowrap"
                          >
                            {verifyMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3" />
                            )}
                            Xác nhận
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!isLoading && backups.length === 0 && (
            <div className="text-center py-10">
              <Database className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">Chưa có backup nào</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
