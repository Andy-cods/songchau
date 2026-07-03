'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RotateCcw,
  Loader2,
  XCircle,
  Trash2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  PlayCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatRelativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';

// ─── Types ───────────────────────────────────────────────────────

interface RetryJob {
  id: number;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
}

interface RetryQueueSummary {
  pending: number;
  retrying: number;
  completed: number;
  failed: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function statusBadgeClass(status: string) {
  switch (status.toLowerCase()) {
    case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'retrying': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'failed': return 'bg-red-100 text-red-700 border-red-200';
    case 'cancelled': return 'bg-slate-100 text-slate-500 border-slate-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function statusLabel(status: string) {
  switch (status.toLowerCase()) {
    case 'pending': return 'Đang chờ';
    case 'retrying': return 'Đang thử lại';
    case 'completed': return 'Hoàn thành';
    case 'failed': return 'Thất bại';
    case 'cancelled': return 'Đã hủy';
    default: return status;
  }
}

const STATUS_TABS = [
  { value: '', label: 'Tất cả' },
  { value: 'pending', label: 'Đang chờ' },
  { value: 'retrying', label: 'Đang thử lại' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'failed', label: 'Thất bại' },
];

// ─── Summary Card ─────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color = 'text-slate-800',
  loading,
}: {
  label: string;
  value: number | string;
  color?: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
      <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">{label}</p>
      {loading ? (
        <div className="h-7 w-16 bg-slate-200 rounded animate-pulse mt-1" />
      ) : (
        <p className={cn('text-2xl font-bold mt-1', color)}>{value}</p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function RetryQueuePage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page) });
  if (activeTab) params.set('status', activeTab);

  const { data: summaryRaw, isLoading: summaryLoading } = useQuery({
    queryKey: ['retry-queue-summary'],
    queryFn: () => api.get<{ data: RetryQueueSummary }>('/api/v1/retry-queue/summary'),
    refetchInterval: 10_000,
  });

  const { data: jobsRaw, isLoading: jobsLoading } = useQuery({
    queryKey: ['retry-queue-jobs', activeTab, page],
    queryFn: () =>
      api.get<{ data: { items: RetryJob[]; total: number } }>(
        `/api/v1/retry-queue?${params.toString()}`
      ),
    refetchInterval: 10_000,
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/v1/retry-queue/${id}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retry-queue-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['retry-queue-summary'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/v1/retry-queue/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retry-queue-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['retry-queue-summary'] });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: () => api.post('/api/v1/retry-queue/cleanup'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retry-queue-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['retry-queue-summary'] });
    },
  });

  const summary: RetryQueueSummary | null =
    summaryRaw?.data ?? (summaryRaw as any) ?? null;
  const jobs: RetryJob[] = jobsRaw?.data?.items ?? (jobsRaw as any)?.items ?? [];
  const total: number = jobsRaw?.data?.total ?? (jobsRaw as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={RotateCcw}
        title="Hàng đợi thử lại"
        subtitle="Quản lý các tác vụ cần thực thi lại"
        actions={
          <button
            onClick={() => cleanupMutation.mutate()}
            disabled={cleanupMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition-colors"
          >
            {cleanupMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Dọn dẹp
          </button>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Đang chờ"
          value={summary?.pending ?? '—'}
          color="text-amber-600"
          loading={summaryLoading}
        />
        <SummaryCard
          label="Đang thử lại"
          value={summary?.retrying ?? '—'}
          color="text-blue-600"
          loading={summaryLoading}
        />
        <SummaryCard
          label="Hoàn thành"
          value={summary?.completed ?? '—'}
          color="text-emerald-600"
          loading={summaryLoading}
        />
        <SummaryCard
          label="Thất bại"
          value={summary?.failed ?? '—'}
          color={summary?.failed ? 'text-red-600' : 'text-slate-800'}
          loading={summaryLoading}
        />
      </div>

      {/* Status Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setActiveTab(tab.value); setPage(1); }}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeTab === tab.value
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Jobs Table */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <RotateCcw className="h-4 w-4 text-slate-600" />
          <h3 className="text-sm font-semibold text-slate-700">
            Danh sách tác vụ
            {total > 0 && <span className="ml-2 text-xs text-slate-400">({total})</span>}
          </h3>
          {jobsLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-auto" />}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loại tác vụ</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="text-center">Lần thử</TableHead>
              <TableHead>Lỗi cuối</TableHead>
              <TableHead>Tạo lúc</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobsLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <span className="text-xs font-mono font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                        {job.job_type}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', statusBadgeClass(job.status))}>
                        {statusLabel(job.status)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={cn(
                        'text-sm font-mono font-bold',
                        job.attempts >= job.max_attempts ? 'text-red-600' : 'text-slate-700'
                      )}>
                        {job.attempts}/{job.max_attempts}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-[200px] truncate">
                      {job.last_error ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                      {formatRelativeTime(job.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {(job.status === 'pending' || job.status === 'failed') && (
                          <button
                            onClick={() => retryMutation.mutate(job.id)}
                            disabled={retryMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-60 transition-colors whitespace-nowrap"
                          >
                            {retryMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3 w-3" />
                            )}
                            Thử lại
                          </button>
                        )}
                        {(job.status === 'pending' || job.status === 'retrying') && (
                          <button
                            onClick={() => cancelMutation.mutate(job.id)}
                            disabled={cancelMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-60 transition-colors whitespace-nowrap"
                          >
                            {cancelMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <XCircle className="h-3 w-3" />
                            )}
                            Hủy
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!jobsLoading && jobs.length === 0 && (
          <EmptyState
            icon={RotateCcw}
            heading="Không có tác vụ nào"
            className="py-10"
          />
        )}

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
      </Card>
    </div>
  );
}
