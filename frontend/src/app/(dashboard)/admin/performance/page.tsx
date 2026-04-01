'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Database,
  Table2,
  Rows3,
  MemoryStick,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
  Container,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface HealthDashboard {
  db_size: string;
  table_count: number;
  total_rows: number;
  redis_memory: string;
  uptime: string;
  last_bqms_sync: string | null;
  containers: Array<{ name: string; status: string }>;
}

interface DbStat {
  table_name: string;
  row_count: number;
  size_bytes: number;
}

interface HealthCheckResult {
  status: string;
  checks: Record<string, { status: string; message?: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function containerStatusColor(status: string) {
  const s = status.toLowerCase();
  if (s.includes('up') || s === 'running') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (s.includes('restart')) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function containerBorderColor(status: string) {
  const s = status.toLowerCase();
  if (s.includes('up') || s === 'running') return 'border-emerald-200';
  if (s.includes('restart')) return 'border-amber-200';
  return 'border-red-200';
}

// ─── Stat Card ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color = 'text-brand-600',
  loading,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color?: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4 flex items-center gap-4">
      <div className={cn('p-2.5 rounded-lg bg-slate-50', color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">{label}</p>
        {loading ? (
          <div className="h-6 w-24 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-lg font-bold text-slate-800 truncate">{value}</p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function PerformancePage() {
  const queryClient = useQueryClient();
  const [healthResults, setHealthResults] = useState<HealthCheckResult | null>(null);

  const { data: dashRaw, isLoading: dashLoading } = useQuery({
    queryKey: ['system-health-dashboard'],
    queryFn: () => api.get<{ data: HealthDashboard }>('/api/v1/system-health/dashboard'),
    refetchInterval: 30_000,
  });

  const { data: dbStatsRaw, isLoading: dbStatsLoading } = useQuery({
    queryKey: ['system-health-db-stats'],
    queryFn: () => api.get<{ data: DbStat[] }>('/api/v1/system-health/db-stats'),
  });

  const healthCheckMutation = useMutation({
    mutationFn: () => api.post<{ data: HealthCheckResult }>('/api/v1/system-health/health-check'),
    onSuccess: (res) => {
      setHealthResults(res.data ?? (res as any));
      queryClient.invalidateQueries({ queryKey: ['system-health-dashboard'] });
    },
  });

  const dash = dashRaw?.data ?? (dashRaw as any);
  const dbStats: DbStat[] = ((dbStatsRaw?.data ?? (dbStatsRaw as any)) ?? [])
    .slice()
    .sort((a: DbStat, b: DbStat) => b.row_count - a.row_count);
  const containers = dash?.containers ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Hiệu suất hệ thống</h2>
          <p className="text-sm text-slate-500 mt-0.5">Giám sát tài nguyên và sức khỏe hệ thống</p>
        </div>
        <button
          onClick={() => healthCheckMutation.mutate()}
          disabled={healthCheckMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition-colors"
        >
          {healthCheckMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Activity className="h-4 w-4" />
          )}
          Kiểm tra sức khỏe
        </button>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="Kích thước DB"
          value={dash?.db_size ?? '—'}
          icon={Database}
          color="text-blue-600"
          loading={dashLoading}
        />
        <StatCard
          label="Số bảng"
          value={dash?.table_count ?? '—'}
          icon={Table2}
          color="text-purple-600"
          loading={dashLoading}
        />
        <StatCard
          label="Tổng hàng"
          value={dash?.total_rows?.toLocaleString('vi-VN') ?? '—'}
          icon={Rows3}
          color="text-cyan-600"
          loading={dashLoading}
        />
        <StatCard
          label="Redis bộ nhớ"
          value={dash?.redis_memory ?? '—'}
          icon={MemoryStick}
          color="text-amber-600"
          loading={dashLoading}
        />
        <StatCard
          label="Uptime"
          value={dash?.uptime ?? '—'}
          icon={Clock}
          color="text-emerald-600"
          loading={dashLoading}
        />
      </div>

      {/* Health Check Results */}
      {healthResults && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-700">Kết quả kiểm tra sức khỏe</h3>
            <span
              className={cn(
                'ml-2 text-xs px-2 py-0.5 rounded-full font-medium',
                healthResults.status === 'healthy'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-red-100 text-red-700'
              )}
            >
              {healthResults.status === 'healthy' ? 'Khỏe mạnh' : 'Có vấn đề'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(healthResults.checks ?? {}).map(([key, val]) => (
              <div
                key={key}
                className={cn(
                  'p-3 rounded-lg border text-sm',
                  val.status === 'ok' || val.status === 'healthy'
                    ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                    : 'bg-red-50 border-red-100 text-red-800'
                )}
              >
                <p className="font-medium">{key}</p>
                {val.message && <p className="text-xs mt-0.5 opacity-75">{val.message}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DB Stats Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <Database className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-700">Thống kê bảng dữ liệu</h3>
          {dbStatsLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-auto" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Tên bảng</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Số hàng</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Kích thước</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {dbStatsLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3"><div className="h-4 w-40 bg-slate-200 rounded animate-pulse" /></td>
                      <td className="px-4 py-3 text-right"><div className="h-4 w-16 bg-slate-200 rounded animate-pulse ml-auto" /></td>
                      <td className="px-4 py-3 text-right"><div className="h-4 w-16 bg-slate-200 rounded animate-pulse ml-auto" /></td>
                    </tr>
                  ))
                : dbStats.map((row) => (
                    <tr key={row.table_name} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{row.table_name}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-800">
                        {(row.row_count ?? 0).toLocaleString('vi-VN')}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500 font-mono text-xs">
                        {formatBytes(row.size_bytes)}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!dbStatsLoading && dbStats.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">Chưa có dữ liệu</div>
          )}
        </div>
      </div>

      {/* Containers Grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Container className="h-4 w-4 text-slate-600" />
          <h3 className="text-sm font-semibold text-slate-700">Trạng thái containers</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {dashLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-20 bg-slate-200 rounded-lg animate-pulse" />
              ))
            : containers.length === 0
              ? (
                <div className="col-span-full text-center py-8 text-slate-400 text-sm">
                  Không có dữ liệu container
                </div>
              )
              : containers.map((c: { name: string; status: string }) => (
                  <div
                    key={c.name}
                    className={cn(
                      'bg-white rounded-lg border shadow-sm p-3 flex flex-col gap-2',
                      containerBorderColor(c.status)
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Container className="h-4 w-4 text-slate-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-slate-800 truncate">{c.name}</span>
                    </div>
                    <span
                      className={cn(
                        'self-start text-xs px-2 py-0.5 rounded-full font-medium border',
                        containerStatusColor(c.status)
                      )}
                    >
                      {c.status}
                    </span>
                  </div>
                ))}
        </div>
      </div>
    </div>
  );
}
