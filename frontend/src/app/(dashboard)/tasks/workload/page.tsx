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

// ─── Types ─────────────────────────────────────────────────────

interface WorkloadItem {
  user_id: string;
  full_name: string;
  pending_count: number;
  in_progress_count: number;
  completed_today: number;
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

  const workload = data?.data ?? [];

  const maxTotal = Math.max(...workload.map((w) => w.pending_count + w.in_progress_count), 1);

  const autoResult = autoAssignMutation.data?.data;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-600" />
            Phân công công việc
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Theo dõi khối lượng công việc theo nhân viên
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/tasks"
            className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <ListTodo className="h-4 w-4" />
            Danh sách task
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
        </div>
      </div>

      {/* Auto-assign result */}
      {autoAssignMutation.isSuccess && autoResult && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm font-medium text-green-800 mb-2">
            Đã phân công {autoResult.assigned_count} công việc thành công
          </p>
          {autoResult.assignments.length > 0 && (
            <ul className="space-y-1">
              {autoResult.assignments.slice(0, 5).map((a) => (
                <li key={a.task_id} className="text-xs text-green-700 flex items-center gap-1.5">
                  <CheckCircle className="h-3 w-3 shrink-0" />
                  <span className="font-medium">{a.assigned_to_name}</span>
                  <span>←</span>
                  <span className="truncate">{a.title}</span>
                </li>
              ))}
              {autoResult.assignments.length > 5 && (
                <li className="text-xs text-green-600">
                  và {autoResult.assignments.length - 5} công việc khác...
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {autoAssignMutation.isError && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Không thể tự động phân công. Vui lòng thử lại.
        </div>
      )}

      {/* Summary Row */}
      {!isLoading && workload.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Chờ xử lý</p>
              <p className="text-xl font-bold text-slate-900">
                {workload.reduce((s, w) => s + w.pending_count, 0)}
              </p>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <ListTodo className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Đang làm</p>
              <p className="text-xl font-bold text-slate-900">
                {workload.reduce((s, w) => s + w.in_progress_count, 0)}
              </p>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 text-green-600">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Xong hôm nay</p>
              <p className="text-xl font-bold text-slate-900">
                {workload.reduce((s, w) => s + w.completed_today, 0)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Workload Chart */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 mb-6">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Phân bố công việc</h3>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : workload.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Users className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">Không có dữ liệu phân công</p>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {workload.map((w) => {
              const totalActive = w.pending_count + w.in_progress_count;
              return (
                <div key={w.user_id}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-800">{w.full_name}</span>
                    <span className="text-xs text-slate-500">
                      {totalActive} đang xử lý · {w.completed_today} xong hôm nay
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
                      colorClass="bg-blue-400"
                    />
                    <WorkloadBar
                      label="Xong hôm nay"
                      value={w.completed_today}
                      max={maxTotal}
                      colorClass="bg-green-400"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Workload Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Chi tiết theo nhân viên</h3>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : workload.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
            Không có dữ liệu
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Nhân viên</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Chờ xử lý</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Đang làm</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Xong hôm nay</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Tổng đang xử lý</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Xem tasks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workload.map((w) => {
                  const total = w.pending_count + w.in_progress_count;
                  const loadClass =
                    total > 10 ? 'text-red-600 font-semibold' : total > 5 ? 'text-amber-600' : 'text-slate-700';
                  return (
                    <tr key={w.user_id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 text-xs font-semibold">
                            {w.full_name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-slate-800">{w.full_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-mono text-amber-600">{w.pending_count}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-mono text-blue-600">{w.in_progress_count}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-mono text-green-600">{w.completed_today}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-mono ${loadClass}`}>{total}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/tasks?assigned_to=${w.user_id}`}
                          className="flex items-center gap-1 text-xs text-brand-600 hover:underline"
                        >
                          Xem <ChevronRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
