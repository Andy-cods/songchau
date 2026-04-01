'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  PlayCircle,
  Table2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface DataQualityItem {
  table_name: string;
  check_name: string;
  status: string;
  affected_rows: number;
  details: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────

function statusBadgeClass(status: string) {
  switch (status.toLowerCase()) {
    case 'pass': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'warning': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'fail': return 'bg-red-100 text-red-700 border-red-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function statusLabel(status: string) {
  switch (status.toLowerCase()) {
    case 'pass': return 'Đạt';
    case 'warning': return 'Cảnh báo';
    case 'fail': return 'Không đạt';
    default: return status;
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status.toLowerCase()) {
    case 'pass': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case 'fail': return <XCircle className="h-4 w-4 text-red-500" />;
    default: return null;
  }
}

// ─── Summary Card ─────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color,
  icon: Icon,
  loading,
}: {
  label: string;
  value: number | string;
  color: string;
  icon: React.ElementType;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4 flex items-center gap-3">
      <div className={cn('p-2 rounded-lg bg-slate-50', color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">{label}</p>
        {loading ? (
          <div className="h-6 w-12 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-2xl font-bold mt-0.5 text-slate-800">{value}</p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function DataQualityPage() {
  const queryClient = useQueryClient();

  const { data: qualityRaw, isLoading } = useQuery({
    queryKey: ['data-quality-standalone'],
    queryFn: () =>
      api.get<{ data: DataQualityItem[] }>('/api/v1/data-migration/data-quality'),
  });

  const runMutation = useMutation({
    mutationFn: () => api.post('/api/v1/data-migration/data-quality/run'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data-quality-standalone'] });
    },
  });

  const items: DataQualityItem[] = qualityRaw?.data ?? (qualityRaw as any) ?? [];

  const passCount = items.filter((i) => i.status.toLowerCase() === 'pass').length;
  const warnCount = items.filter((i) => i.status.toLowerCase() === 'warning').length;
  const failCount = items.filter((i) => i.status.toLowerCase() === 'fail').length;
  const totalChecks = items.length;

  // Group by table
  const tableGroups = items.reduce<Record<string, DataQualityItem[]>>((acc, item) => {
    if (!acc[item.table_name]) acc[item.table_name] = [];
    acc[item.table_name].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Chất lượng dữ liệu</h2>
          <p className="text-sm text-slate-500 mt-0.5">Kiểm tra và báo cáo chất lượng dữ liệu hệ thống</p>
        </div>
        <button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors"
        >
          {runMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          Chạy kiểm tra
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Tổng kiểm tra"
          value={isLoading ? '—' : totalChecks}
          color="text-slate-600"
          icon={ShieldCheck}
          loading={isLoading}
        />
        <SummaryCard
          label="Đạt"
          value={isLoading ? '—' : passCount}
          color="text-emerald-600"
          icon={CheckCircle2}
          loading={isLoading}
        />
        <SummaryCard
          label="Cảnh báo"
          value={isLoading ? '—' : warnCount}
          color="text-amber-600"
          icon={AlertTriangle}
          loading={isLoading}
        />
        <SummaryCard
          label="Không đạt"
          value={isLoading ? '—' : failCount}
          color={failCount > 0 ? 'text-red-600' : 'text-slate-600'}
          icon={XCircle}
          loading={isLoading}
        />
      </div>

      {/* Progress Bar */}
      {!isLoading && totalChecks > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">Tỷ lệ đạt</span>
            <span className="text-sm font-bold text-slate-700">
              {Math.round((passCount / totalChecks) * 100)}%
            </span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex gap-0.5">
            {passCount > 0 && (
              <div
                className="bg-emerald-400 h-full transition-all"
                style={{ width: `${(passCount / totalChecks) * 100}%` }}
              />
            )}
            {warnCount > 0 && (
              <div
                className="bg-amber-400 h-full transition-all"
                style={{ width: `${(warnCount / totalChecks) * 100}%` }}
              />
            )}
            {failCount > 0 && (
              <div
                className="bg-red-400 h-full transition-all"
                style={{ width: `${(failCount / totalChecks) * 100}%` }}
              />
            )}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Đạt</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Cảnh báo</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" /> Không đạt</span>
          </div>
        </div>
      )}

      {/* Results Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <Table2 className="h-4 w-4 text-purple-600" />
          <h3 className="text-sm font-semibold text-slate-700">Kết quả kiểm tra</h3>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-auto" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Bảng</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Tên kiểm tra</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Trạng thái</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Hàng bị ảnh hưởng</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-slate-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                : items.map((item, idx) => (
                    <tr
                      key={idx}
                      className={cn(
                        'hover:bg-slate-50/50 transition-colors',
                        item.status.toLowerCase() === 'fail' && 'bg-red-50/30'
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{item.table_name}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-600">{item.check_name}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <StatusIcon status={item.status} />
                          <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', statusBadgeClass(item.status))}>
                            {statusLabel(item.status)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm text-slate-700">
                        {item.affected_rows > 0
                          ? <span className={item.status.toLowerCase() !== 'pass' ? 'text-amber-600 font-bold' : ''}>
                              {(item.affected_rows ?? 0).toLocaleString('vi-VN')}
                            </span>
                          : <span className="text-slate-300">0</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 max-w-xs truncate">
                        {item.details ?? <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!isLoading && items.length === 0 && (
            <div className="text-center py-12">
              <ShieldCheck className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Nhấn "Chạy kiểm tra" để bắt đầu</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
