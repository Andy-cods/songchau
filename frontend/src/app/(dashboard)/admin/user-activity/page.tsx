'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Eye,
  Users,
  MousePointerClick,
  TrendingUp,
  Loader2,
  Filter,
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

interface ActivityItem {
  id?: number;
  action: string;
  page: string;
  entity_type: string | null;
  user_id?: number;
  user_email?: string;
  user_name?: string;
  created_at: string;
}

interface ActivityResponse {
  data: {
    items: ActivityItem[];
    total: number;
  };
}

interface ActivitySummary {
  data: {
    active_users_today: number;
    top_pages: Array<{ page: string; count: number }>;
    actions_by_type: Record<string, number>;
  };
}

interface User {
  id: number;
  full_name: string;
  email: string;
}

interface UsersResponse {
  data: {
    items: User[];
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  view:   'bg-blue-100 text-blue-700 border-blue-200',
  create: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  update: 'bg-amber-100 text-amber-700 border-amber-200',
  delete: 'bg-red-100 text-red-700 border-red-200',
  export: 'bg-slate-100 text-slate-700 border-slate-200',
  login:  'bg-cyan-100 text-cyan-700 border-cyan-200',
};

const ACTION_LABELS: Record<string, string> = {
  view:   'Xem',
  create: 'Tạo',
  update: 'Cập nhật',
  delete: 'Xóa',
  export: 'Xuất',
  login:  'Đăng nhập',
};

// ─── Mini Bar Chart ───────────────────────────────────────────────

function MiniBarChart({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2 h-24">
      {data.map((d) => (
        <div key={d.label} className="flex flex-col items-center gap-1 flex-1">
          <span className="text-[11px] text-slate-400 font-mono">{d.value}</span>
          <div
            className="w-full bg-brand-500 rounded-t-sm transition-all duration-300"
            style={{ height: `${Math.max(4, (d.value / max) * 72)}px` }}
          />
          <span className="text-[11px] text-slate-400 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
  colorClass,
  loading,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ElementType;
  colorClass: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4 flex items-center gap-4">
      <div className={cn('p-2.5 rounded-lg', colorClass)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">{label}</p>
        {loading ? (
          <div className="h-6 w-20 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <>
            <p className="text-xl font-bold text-slate-800">{value}</p>
            {sub && <p className="text-xs text-slate-400 truncate">{sub}</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function UserActivityPage() {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [page, setPage] = useState(1);

  const { data: summaryRaw, isLoading: summaryLoading } = useQuery({
    queryKey: ['user-activity-summary'],
    queryFn: () => api.get<ActivitySummary>('/api/v1/user-activity/summary'),
    refetchInterval: 60_000,
  });

  const { data: usersRaw } = useQuery({
    queryKey: ['users-list-activity'],
    queryFn: () => api.get<UsersResponse>('/api/v1/users?page=1&limit=100'),
  });

  const { data: activityRaw, isLoading: activityLoading } = useQuery({
    queryKey: ['user-activity', selectedUserId, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (selectedUserId) params.set('user_id', selectedUserId);
      return api.get<ActivityResponse>(`/api/v1/user-activity?${params}`);
    },
  });

  const summary = summaryRaw?.data ?? (summaryRaw as any);
  const users: User[] =
    usersRaw?.data?.items ?? (usersRaw as any)?.items ?? (usersRaw as any) ?? [];
  const items: ActivityItem[] =
    activityRaw?.data?.items ?? (activityRaw as any)?.items ?? [];
  const total: number = activityRaw?.data?.total ?? (activityRaw as any)?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const topPages = summary?.top_pages ?? [];
  const actionsByType = summary?.actions_by_type ?? {};

  // Prepare chart data for actions by type
  const chartData = Object.entries(actionsByType)
    .slice(0, 7)
    .map(([label, value]) => ({ label: ACTION_LABELS[label] ?? label, value: value as number }));

  // Top page label
  const topPage = topPages[0]?.page ?? '—';

  // Total actions
  const totalActions = Object.values(actionsByType).reduce(
    (sum: number, v) => sum + (v as number),
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={MousePointerClick}
        title="Hoạt động người dùng"
        subtitle="Theo dõi hành động và trang xem của toàn bộ người dùng hệ thống"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Users hoạt động hôm nay"
          value={summary?.active_users_today ?? '—'}
          icon={Users}
          colorClass="bg-brand-50 text-brand-600"
          loading={summaryLoading}
        />
        <SummaryCard
          label="Trang xem nhiều nhất"
          value={topPage}
          sub={topPages[0] ? `${topPages[0].count} lượt` : undefined}
          icon={Eye}
          colorClass="bg-brand-50 text-brand-600"
          loading={summaryLoading}
        />
        <SummaryCard
          label="Tổng hành động"
          value={totalActions.toLocaleString('vi-VN')}
          icon={MousePointerClick}
          colorClass="bg-brand-50 text-brand-600"
          loading={summaryLoading}
        />
      </div>

      {/* Chart + Top Pages */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Action Chart */}
        <Card padded={false} className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-brand-600" />
            <h3 className="text-sm font-semibold text-slate-700">Hành động theo loại</h3>
            {summaryLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-auto" />}
          </div>
          {summaryLoading ? (
            <div className="h-24 bg-slate-100 rounded animate-pulse" />
          ) : chartData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Chưa có dữ liệu</p>
          ) : (
            <MiniBarChart data={chartData} />
          )}
        </Card>

        {/* Top Pages */}
        <Card padded={false} className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Eye className="h-4 w-4 text-brand-600" />
            <h3 className="text-sm font-semibold text-slate-700">Trang phổ biến nhất</h3>
          </div>
          {summaryLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : topPages.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-2">
              {topPages.slice(0, 7).map((p: { page: string; count: number }, i: number) => {
                const pct = Math.round((p.count / (topPages[0]?.count || 1)) * 100);
                return (
                  <div key={p.page} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400 w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-medium text-slate-700 truncate max-w-[160px]">
                          {p.page}
                        </span>
                        <span className="text-xs text-slate-400 font-mono ml-2">
                          {(p.count ?? 0).toLocaleString('vi-VN')}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full">
                        <div
                          className="h-full bg-brand-400 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-500">Lọc người dùng:</span>
        </div>
        <select
          value={selectedUserId}
          onChange={(e) => {
            setSelectedUserId(e.target.value);
            setPage(1);
          }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
        >
          <option value="">Tất cả người dùng</option>
          {users.map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.full_name} ({u.email})
            </option>
          ))}
        </select>
        {selectedUserId && (
          <button
            onClick={() => {
              setSelectedUserId('');
              setPage(1);
            }}
            className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      {/* Activity Table */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <MousePointerClick className="h-4 w-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-slate-700">Nhật ký hoạt động</h3>
          <span className="ml-auto text-xs text-slate-400 font-mono">{total} bản ghi</span>
          {activityLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thời gian</TableHead>
              <TableHead>Người dùng</TableHead>
              <TableHead>Hành động</TableHead>
              <TableHead>Trang</TableHead>
              <TableHead>Đối tượng</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activityLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : items.length === 0
                ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState
                        icon={MousePointerClick}
                        heading="Chưa có dữ liệu hoạt động"
                        className="py-12"
                      />
                    </td>
                  </tr>
                )
                : items.map((item, idx) => (
                    <TableRow key={item.id ?? idx}>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap font-mono">
                        {formatRelativeTime(item.created_at)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {item.user_name ?? item.user_email ?? (item.user_id ? `User #${item.user_id}` : '—')}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                            ACTION_COLORS[item.action] ?? 'bg-slate-100 text-slate-600 border-slate-200'
                          )}
                        >
                          {ACTION_LABELS[item.action] ?? item.action}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 font-mono">{item.page}</TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {item.entity_type ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-400">
              Trang {page} / {totalPages}
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
