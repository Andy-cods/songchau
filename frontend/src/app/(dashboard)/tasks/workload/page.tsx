'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Users,
  Shuffle,
  Loader2,
  CheckCircle,
  Clock,
  ListTodo,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import { StatCard } from '@/components/shared/stat-card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ─────────────────────────────────────────────────────

interface WorkloadItem {
  user_id: string;
  full_name: string;
  pending_count: number;
  in_progress_count: number;
  // Backend counts completions over a rolling 30-day window, not calendar "today".
  completed_30d: number;
}

interface AutoAssignResult {
  assigned_count: number;
  assignments: { task_id: string; title: string; assigned_to_name: string }[];
}

// ─── Workload Bar ────────────────────────────────────────────────

function WorkloadBar({
  label,
  value,
  max,
  colorClass,
}: {
  label: string;
  value: number;
  max: number;
  colorClass: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-24 text-right shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-slate-700 w-6 shrink-0">{value}</span>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────

export default function WorkloadPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ data: WorkloadItem[] }>({
    queryKey: ['task-workload'],
    queryFn: () => api.get('/api/v1/task-assignments/workload'),
    retry: false,
  });

  const autoAssignMutation = useMutation({
    mutationFn: () => api.post<{ data: AutoAssignResult }>('/api/v1/task-assignments/auto-assign'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-workload'] });
      queryClient.invalidateQueries({ queryKey: ['task-assignments'] });
    },
  });

  const _wRaw: any = data?.data;
  const workload: WorkloadItem[] = Array.isArray(_wRaw) ? _wRaw : Array.isArray(_wRaw?.items) ? _wRaw.items : [];

  const maxTotal = Math.max(...workload.map((w) => w.pending_count + w.in_progress_count), 1);

  const autoResult = autoAssignMutation.data?.data;

  return (
    <div>
      {/* Header */}
      <PageHeader
        className="mb-6"
        icon={Users}
        title="Phân công công việc"
        subtitle="Theo dõi khối lượng công việc theo nhân viên"
        actions={
          <>
            <Link
              href="/tasks"
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ListTodo className="h-4 w-4" />
              Danh sách công việc
            </Link>
            <button
              onClick={() => autoAssignMutation.mutate()}
              disabled={autoAssignMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition-colors"
            >
              {autoAssignMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shuffle className="h-4 w-4" />
              )}
              Tự động phân công
            </button>
          </>
        }
      />

      {/* Auto-assign result */}
      {autoAssignMutation.isSuccess && autoResult && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
          <p className="text-sm font-medium text-emerald-800 mb-2">
            Đã phân công {autoResult.assigned_count} công việc thành công
          </p>
          {autoResult.assignments.length > 0 && (
            <ul className="space-y-1">
              {autoResult.assignments.slice(0, 5).map((a) => (
                <li key={a.task_id} className="text-xs text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle className="h-3 w-3 shrink-0" />
                  <span className="font-medium">{a.assigned_to_name}</span>
                  <span>←</span>
                  <span className="truncate">{a.title}</span>
                </li>
              ))}
              {autoResult.assignments.length > 5 && (
                <li className="text-xs text-emerald-600">
                  và {autoResult.assignments.length - 5} công việc khác...
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {autoAssignMutation.isError && (
        <div className="mb-6 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
          Không thể tự động phân công. Vui lòng thử lại.
        </div>
      )}

      {/* Summary Row */}
      {!isLoading && workload.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard
            icon={Clock}
            tone="warning"
            label="Chờ xử lý"
            value={workload.reduce((s, w) => s + w.pending_count, 0)}
          />
          <StatCard
            icon={ListTodo}
            tone="info"
            label="Đang làm"
            value={workload.reduce((s, w) => s + w.in_progress_count, 0)}
          />
          <StatCard
            icon={CheckCircle}
            tone="success"
            label="Xong (30 ngày)"
            value={workload.reduce((s, w) => s + w.completed_30d, 0)}
          />
        </div>
      )}

      {/* Workload Chart */}
      <Card padded={false} className="mb-6">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Phân bố công việc</h3>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : workload.length === 0 ? (
          <EmptyState
            icon={Users}
            heading="Không có dữ liệu phân công"
          />
        ) : (
          <div className="p-6 space-y-5">
            {workload.map((w) => {
              const totalActive = w.pending_count + w.in_progress_count;
              return (
                <div key={w.user_id}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-800">{w.full_name}</span>
                    <span className="text-xs text-slate-500">
                      {totalActive} đang xử lý · {w.completed_30d} xong (30 ngày)
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <WorkloadBar
                      label="Chờ xử lý"
                      value={w.pending_count}
                      max={maxTotal}
                      colorClass="bg-amber-400"
                    />
                    <WorkloadBar
                      label="Đang làm"
                      value={w.in_progress_count}
                      max={maxTotal}
                      colorClass="bg-sky-400"
                    />
                    <WorkloadBar
                      label="Xong (30 ngày)"
                      value={w.completed_30d}
                      max={maxTotal}
                      colorClass="bg-emerald-400"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Workload Table */}
      <Card padded={false}>
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Chi tiết theo nhân viên</h3>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : workload.length === 0 ? (
          <EmptyState icon={Users} heading="Không có dữ liệu" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nhân viên</TableHead>
                <TableHead className="text-right">Chờ xử lý</TableHead>
                <TableHead className="text-right">Đang làm</TableHead>
                <TableHead className="text-right">Xong (30 ngày)</TableHead>
                <TableHead className="text-right">Tổng đang xử lý</TableHead>
                <TableHead>Xem công việc</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
                {workload.map((w) => {
                  const total = w.pending_count + w.in_progress_count;
                  const loadClass =
                    total > 10 ? 'text-rose-600 font-semibold' : total > 5 ? 'text-amber-600' : 'text-slate-700';
                  return (
                    <TableRow key={w.user_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 text-xs font-semibold">
                            {w.full_name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-slate-800">{w.full_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm font-mono text-amber-600">{w.pending_count}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm font-mono text-sky-600">{w.in_progress_count}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm font-mono text-emerald-600">{w.completed_30d}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`text-sm font-mono ${loadClass}`}>{total}</span>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/tasks?assigned_to=${w.user_id}`}
                          className="flex items-center gap-1 text-xs text-brand-600 hover:underline"
                        >
                          Xem <ChevronRight className="h-3 w-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
