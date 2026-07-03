'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Filter, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import { EmptyState } from '@/components/shared/empty-state';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';

// ─── Types ───────────────────────────────────────────────────────

type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'APPROVE'
  | 'REJECT';

// ─── Action Badge ─────────────────────────────────────────────────

const ACTION_STYLES: Record<
  string,
  { label: string; className: string }
> = {
  CREATE: {
    label: 'Tạo mới',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  UPDATE: {
    label: 'Cập nhật',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  DELETE: {
    label: 'Xóa',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  LOGIN: {
    label: 'Đăng nhập',
    className: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  },
  LOGOUT: {
    label: 'Đăng xuất',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  APPROVE: {
    label: 'Phê duyệt',
    className: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  REJECT: {
    label: 'Từ chối',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  INSERT: {
    label: 'Thêm',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  SELECT: {
    label: 'Truy vấn',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  },
};

function ActionBadge({ action }: { action: string }) {
  const upperAction = (action || '').toUpperCase();
  const cfg = ACTION_STYLES[upperAction] ?? {
    label: action || 'Khác',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
        cfg.className
      )}
    >
      {cfg.label}
    </span>
  );
}

// ─── Table names ─────────────────────────────────────────────────

const TABLE_LABELS: Record<string, string> = {
  purchase_orders: 'Đơn mua hàng',
  suppliers: 'Nhà cung cấp',
  workflows: 'Phê duyệt',
  users: 'Người dùng',
  inventory: 'Kho hàng',
  deliveries: 'Vận chuyển',
  bqms_records: 'BQMS',
  bqms_rfq: 'RFQ',
  audit_log: 'Nhật ký',
};

// ─── Main Component ───────────────────────────────────────────────

export default function AuditLogPage() {
  const [filterAction, setFilterAction] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data: raw, isLoading, error } = useQuery({
    queryKey: ['audit', filterAction, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterAction !== 'ALL') params.set('action', filterAction);
      params.set('page', String(page));
      params.set('limit', '50');
      const qs = params.toString();
      return api.get<any>(`/api/v1/audit${qs ? `?${qs}` : ''}`);
    },
    retry: 1,
  });

  // Extract data from API — no mock fallback
  const entries: any[] = raw?.data ?? [];
  const total = raw?.total ?? entries.length;

  // Apply local search filter
  const filtered = search
    ? entries.filter((entry: any) => {
        const searchLower = search.toLowerCase();
        return (
          (entry.user_name || entry.user_email || '')
            .toLowerCase()
            .includes(searchLower) ||
          (entry.table_name || '').toLowerCase().includes(searchLower) ||
          (entry.record_id || '').toLowerCase().includes(searchLower) ||
          (entry.detail || entry.description || '')
            .toLowerCase()
            .includes(searchLower)
        );
      })
    : entries;

  const actionFilters = [
    'ALL',
    'CREATE',
    'UPDATE',
    'DELETE',
    'APPROVE',
    'REJECT',
    'LOGIN',
    'LOGOUT',
  ];

  return (
    <div>
      {/* Header */}
      <PageHeader
        icon={ClipboardList}
        title="Nhật ký hệ thống"
        subtitle="Theo dõi mọi hoạt động trong hệ thống"
        className="mb-6"
      />

      {/* Error State */}
      {error && !isLoading && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">
            Có lỗi xảy ra, thử lại sau
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        {/* Search */}
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm kiếm người dùng, bảng, ID..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>

        {/* Action filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400 flex-shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            {actionFilters.map((action) => (
              <button
                key={action}
                onClick={() => {
                  setFilterAction(action);
                  setPage(1);
                }}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded border transition-colors',
                  filterAction === action
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                )}
              >
                {action === 'ALL'
                  ? 'Tất cả'
                  : ACTION_STYLES[action]?.label ?? action}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <Card padded={false} className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            heading={
              entries.length === 0
                ? 'Chưa có dữ liệu nhật ký'
                : 'Không có kết quả nào'
            }
          />
        ) : (
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                {[
                  'Thời gian',
                  'Người dùng',
                  'Hành động',
                  'Bảng',
                  'ID',
                  'Chi tiết',
                ].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((entry: any, idx: number) => (
                <TableRow key={entry.id ?? idx}>
                  {/* Thời gian */}
                  <TableCell className="whitespace-nowrap">
                    <div>
                      <p className="text-xs font-mono text-slate-600">
                        {formatRelativeTime(
                          entry.timestamp ?? entry.created_at
                        )}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {entry.timestamp || entry.created_at
                          ? `${new Date(
                              entry.timestamp ?? entry.created_at
                            ).toLocaleTimeString('vi-VN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })} ${formatDate(
                              entry.timestamp ?? entry.created_at
                            )}`
                          : '—'}
                      </p>
                    </div>
                  </TableCell>

                  {/* Người dùng */}
                  <TableCell className="whitespace-nowrap">
                    <div>
                      <p className="text-sm text-slate-800 font-medium">
                        {entry.user_name ?? entry.user_email ?? '—'}
                      </p>
                      <p className="text-xs text-slate-400">
                        {entry.user_email ?? ''}
                      </p>
                    </div>
                  </TableCell>

                  {/* Hành động */}
                  <TableCell>
                    <ActionBadge action={entry.action} />
                  </TableCell>

                  {/* Bảng */}
                  <TableCell className="whitespace-nowrap">
                    <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      {TABLE_LABELS[entry.table_name] ??
                        entry.table_name ??
                        '—'}
                    </span>
                  </TableCell>

                  {/* ID */}
                  <TableCell className="whitespace-nowrap">
                    <span className="text-xs font-mono text-brand-600">
                      {entry.record_id ?? '—'}
                    </span>
                  </TableCell>

                  {/* Chi tiết */}
                  <TableCell className="max-w-[300px]">
                    <p
                      className="text-sm text-slate-600 truncate"
                      title={entry.detail ?? entry.description ?? ''}
                    >
                      {entry.detail ?? entry.description ?? '—'}
                    </p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Count + Pagination */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-slate-400">
          Hiển thị {filtered.length} / {total} bản ghi
        </span>
        {total > 50 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 text-xs border border-slate-200 rounded bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Trước
            </button>
            <span className="text-xs text-slate-500">Trang {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={entries.length < 50}
              className="px-3 py-1 text-xs border border-slate-200 rounded bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Sau
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Table Skeleton ─────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-16 bg-slate-200 rounded-full animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-16 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-48 bg-slate-200 rounded animate-pulse flex-1" />
        </div>
      ))}
    </div>
  );
}
