'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatRelativeTime } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface SystemError {
  id: number;
  error_type: string;
  severity: string;
  message: string;
  endpoint: string | null;
  created_at: string;
  resolved: boolean;
  stack_trace?: string;
}

interface ErrorSummary {
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  last_7d: number;
  last_30d: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function severityBadge(severity: string) {
  switch (severity.toLowerCase()) {
    case 'critical': return 'bg-red-100 text-red-800 border-red-200';
    case 'error': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'warning': return 'bg-amber-100 text-amber-700 border-amber-200';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function typeBadge(type: string) {
  return 'bg-purple-50 text-purple-700 border-purple-200';
}

function severityLabel(severity: string) {
  switch (severity.toLowerCase()) {
    case 'critical': return 'Nghiêm trọng';
    case 'error': return 'Lỗi';
    case 'warning': return 'Cảnh báo';
    default: return severity;
  }
}

// ─── Summary Card ─────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color = 'text-slate-800',
  loading,
}: {
  label: string;
  value: string | number;
  color?: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
      <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">{label}</p>
      {loading ? (
        <div className="h-7 w-20 bg-slate-200 rounded animate-pulse mt-1" />
      ) : (
        <p className={cn('text-2xl font-bold mt-1', color)}>{value}</p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function ErrorsPage() {
  const queryClient = useQueryClient();
  const [errorType, setErrorType] = useState('');
  const [severity, setSeverity] = useState('');
  const [resolved, setResolved] = useState<boolean | null>(null);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const params = new URLSearchParams({ page: String(page) });
  if (errorType) params.set('error_type', errorType);
  if (severity) params.set('severity', severity);
  if (resolved !== null) params.set('resolved', String(resolved));

  const { data: errorsRaw, isLoading: errorsLoading } = useQuery({
    queryKey: ['system-errors', errorType, severity, resolved, page],
    queryFn: () =>
      api.get<{ data: { items: SystemError[]; total: number } }>(
        `/api/v1/system-health/errors?${params.toString()}`
      ),
  });

  const { data: summaryRaw, isLoading: summaryLoading } = useQuery({
    queryKey: ['system-errors-summary'],
    queryFn: () => api.get<{ data: ErrorSummary }>('/api/v1/system-health/errors/summary'),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) =>
      api.post(`/api/v1/system-health/errors/${id}/resolve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-errors'] });
      queryClient.invalidateQueries({ queryKey: ['system-errors-summary'] });
    },
  });

  const errors: SystemError[] = errorsRaw?.data?.items ?? (errorsRaw as any)?.items ?? [];
  const total: number = errorsRaw?.data?.total ?? (errorsRaw as any)?.total ?? 0;
  const summary: ErrorSummary | null = summaryRaw?.data ?? (summaryRaw as any) ?? null;

  const criticalCount =
    summary?.by_severity?.critical ?? 0;
  const unresolvedCount =
    (summary?.by_severity?.error ?? 0) +
    (summary?.by_severity?.critical ?? 0) +
    (summary?.by_severity?.warning ?? 0);

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-display font-bold text-slate-900">Trung tâm lỗi</h2>
        <p className="text-sm text-slate-500 mt-0.5">Theo dõi và xử lý lỗi hệ thống</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Tổng lỗi (30 ngày)"
          value={summary?.last_30d ?? '—'}
          color="text-slate-800"
          loading={summaryLoading}
        />
        <SummaryCard
          label="Chưa xử lý"
          value={unresolvedCount}
          color="text-orange-600"
          loading={summaryLoading}
        />
        <SummaryCard
          label="7 ngày gần nhất"
          value={summary?.last_7d ?? '—'}
          color="text-amber-600"
          loading={summaryLoading}
        />
        <SummaryCard
          label="Nghiêm trọng"
          value={criticalCount}
          color={criticalCount > 0 ? 'text-red-600' : 'text-slate-800'}
          loading={summaryLoading}
        />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">Bộ lọc</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            value={errorType}
            onChange={(e) => { setErrorType(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Tất cả loại lỗi</option>
            <option value="api_error">API Error</option>
            <option value="db_error">DB Error</option>
            <option value="auth_error">Auth Error</option>
            <option value="validation_error">Validation Error</option>
            <option value="sync_error">Sync Error</option>
          </select>
          <select
            value={severity}
            onChange={(e) => { setSeverity(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Tất cả mức độ</option>
            <option value="critical">Nghiêm trọng</option>
            <option value="error">Lỗi</option>
            <option value="warning">Cảnh báo</option>
          </select>
          <select
            value={resolved === null ? '' : String(resolved)}
            onChange={(e) => {
              setResolved(e.target.value === '' ? null : e.target.value === 'true');
              setPage(1);
            }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="false">Chưa xử lý</option>
            <option value="true">Đã xử lý</option>
          </select>
        </div>
      </div>

      {/* Error Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <h3 className="text-sm font-semibold text-slate-700">
            Danh sách lỗi
            {total > 0 && (
              <span className="ml-2 text-xs text-slate-400">({total} kết quả)</span>
            )}
          </h3>
          {errorsLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-auto" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="w-6 px-4 py-2.5" />
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Thời gian</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Loại</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Mức độ</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Thông báo</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Endpoint</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Trạng thái</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {errorsLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-slate-200 rounded animate-pulse" style={{ width: `${60 + j * 10}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : errors.map((err) => (
                    <>
                      <tr
                        key={err.id}
                        className={cn(
                          'hover:bg-slate-50/50 transition-colors cursor-pointer',
                          expandedId === err.id && 'bg-slate-50'
                        )}
                        onClick={() => setExpandedId(expandedId === err.id ? null : err.id)}
                      >
                        <td className="px-4 py-3">
                          {expandedId === err.id
                            ? <ChevronDown className="h-4 w-4 text-slate-400" />
                            : <ChevronRight className="h-4 w-4 text-slate-300" />}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                          {formatRelativeTime(err.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs px-2 py-0.5 rounded border font-mono', typeBadge(err.error_type))}>
                            {err.error_type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', severityBadge(err.severity))}>
                            {severityLabel(err.severity)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700 max-w-xs truncate">{err.message}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 max-w-[150px] truncate">
                          {err.endpoint ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {err.resolved ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Đã xử lý
                            </span>
                          ) : (
                            <span className="text-xs text-orange-500">Chưa xử lý</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {!err.resolved && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                resolveMutation.mutate(err.id);
                              }}
                              disabled={resolveMutation.isPending}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-60 transition-colors whitespace-nowrap"
                            >
                              {resolveMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              Đã xử lý
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedId === err.id && (
                        <tr key={`${err.id}-detail`} className="bg-slate-50">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="space-y-3">
                              <div>
                                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Thông báo đầy đủ</p>
                                <p className="text-sm text-slate-700">{err.message}</p>
                              </div>
                              {err.stack_trace && (
                                <div>
                                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Stack Trace</p>
                                  <pre className="text-xs font-mono bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-48">
                                    {err.stack_trace}
                                  </pre>
                                </div>
                              )}
                              {err.endpoint && (
                                <div>
                                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Endpoint</p>
                                  <code className="text-xs font-mono bg-slate-100 px-2 py-1 rounded text-slate-700">
                                    {err.endpoint}
                                  </code>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
            </tbody>
          </table>
          {!errorsLoading && errors.length === 0 && (
            <div className="text-center py-10 text-slate-400 text-sm">Không có lỗi nào</div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Trang {page} / {totalPages} ({total} kết quả)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                Trước
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
