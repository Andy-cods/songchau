'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Shield,
  LogIn,
  LogOut,
  AlertTriangle,
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

interface SecurityLogItem {
  id: number;
  event_type: string;
  user_id: number | null;
  user_email?: string;
  ip_address: string;
  severity: string;
  details: string | null;
  created_at: string;
}

interface SecurityLogResponse {
  data: {
    items: SecurityLogItem[];
    total: number;
  };
}

interface SecuritySummary {
  data: {
    logins_today: number;
    failed_logins: number;
    suspicious: number;
    by_type: Record<string, number>;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function eventTypeBadge(type: string): string {
  switch (type) {
    case 'login':            return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'logout':           return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'login_failed':     return 'bg-red-100 text-red-700 border-red-200';
    case 'permission_denied':return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'suspicious':       return 'bg-red-100 text-red-700 border-red-200';
    default:                 return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function eventTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    login:             'Đăng nhập',
    logout:            'Đăng xuất',
    login_failed:      'Đăng nhập thất bại',
    permission_denied: 'Từ chối quyền',
    suspicious:        'Đáng ngờ',
  };
  return labels[type] ?? type;
}

function severityBadge(severity: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical': return 'bg-red-100 text-red-800 border-red-200';
    case 'high':     return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'medium':   return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'low':      return 'bg-slate-100 text-slate-600 border-slate-200';
    case 'info':     return 'bg-blue-50 text-blue-600 border-blue-100';
    default:         return 'bg-slate-100 text-slate-500 border-slate-200';
  }
}

function severityLabel(severity: string): string {
  const labels: Record<string, string> = {
    critical: 'Nghiêm trọng',
    high:     'Cao',
    medium:   'Trung bình',
    low:      'Thấp',
    info:     'Thông tin',
  };
  return labels[severity?.toLowerCase()] ?? severity;
}

// ─── Summary Card ─────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon: Icon,
  colorClass,
  loading,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  colorClass: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4 flex items-center gap-4">
      <div className={cn('p-2.5 rounded-lg', colorClass)}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-slate-400 font-mono uppercase tracking-wide">{label}</p>
        {loading ? (
          <div className="h-6 w-16 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-xl font-bold text-slate-800">{value}</p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

const EVENT_TYPES = [
  { value: '', label: 'Tất cả loại' },
  { value: 'login', label: 'Đăng nhập' },
  { value: 'logout', label: 'Đăng xuất' },
  { value: 'login_failed', label: 'Đăng nhập thất bại' },
  { value: 'permission_denied', label: 'Từ chối quyền' },
  { value: 'suspicious', label: 'Đáng ngờ' },
];

const SEVERITIES = [
  { value: '', label: 'Tất cả mức độ' },
  { value: 'critical', label: 'Nghiêm trọng' },
  { value: 'high', label: 'Cao' },
  { value: 'medium', label: 'Trung bình' },
  { value: 'low', label: 'Thấp' },
  { value: 'info', label: 'Thông tin' },
];

export default function SecurityLogPage() {
  const [eventType, setEventType] = useState('');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);

  const { data: summaryRaw, isLoading: summaryLoading } = useQuery({
    queryKey: ['security-log-summary'],
    queryFn: () => api.get<SecuritySummary>('/api/v1/security-log/summary'),
    refetchInterval: 60_000,
  });

  const { data: logsRaw, isLoading: logsLoading } = useQuery({
    queryKey: ['security-log', eventType, severity, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (eventType) params.set('event_type', eventType);
      if (severity) params.set('severity', severity);
      return api.get<SecurityLogResponse>(`/api/v1/security-log?${params}`);
    },
  });

  const summary = summaryRaw?.data ?? (summaryRaw as any);
  const items: SecurityLogItem[] =
    logsRaw?.data?.items ?? (logsRaw as any)?.items ?? [];
  const total: number = logsRaw?.data?.total ?? (logsRaw as any)?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  function handleFilterChange() {
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={Shield}
        title="Nhật ký bảo mật"
        subtitle="Giám sát đăng nhập, truy cập và các sự kiện bảo mật hệ thống"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Đăng nhập hôm nay"
          value={summary?.logins_today ?? '—'}
          icon={LogIn}
          colorClass="bg-emerald-50 text-emerald-600"
          loading={summaryLoading}
        />
        <SummaryCard
          label="Đăng nhập thất bại"
          value={summary?.failed_logins ?? '—'}
          icon={LogOut}
          colorClass="bg-red-50 text-red-600"
          loading={summaryLoading}
        />
        <SummaryCard
          label="Hoạt động đáng ngờ"
          value={summary?.suspicious ?? '—'}
          icon={AlertTriangle}
          colorClass="bg-amber-50 text-amber-600"
          loading={summaryLoading}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-500">Lọc:</span>
        </div>
        <select
          value={eventType}
          onChange={(e) => {
            setEventType(e.target.value);
            handleFilterChange();
          }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
        >
          {EVENT_TYPES.map((et) => (
            <option key={et.value} value={et.value}>
              {et.label}
            </option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            handleFilterChange();
          }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
        >
          {SEVERITIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {(eventType || severity) && (
          <button
            onClick={() => {
              setEventType('');
              setSeverity('');
              setPage(1);
            }}
            className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      {/* Log Table */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <Shield className="h-4 w-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-slate-700">Nhật ký sự kiện</h3>
          <span className="ml-auto text-xs text-slate-400 font-mono">{total} sự kiện</span>
          {logsLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thời gian</TableHead>
              <TableHead>Loại sự kiện</TableHead>
              <TableHead>Người dùng</TableHead>
              <TableHead>Địa chỉ IP</TableHead>
              <TableHead>Mức độ</TableHead>
              <TableHead>Chi tiết</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logsLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : items.length === 0
                ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        icon={Shield}
                        heading="Không có sự kiện bảo mật"
                        className="py-12"
                      />
                    </td>
                  </tr>
                )
                : items.map((log) => (
                    <TableRow
                      key={log.id}
                      className={cn(
                        (log.event_type === 'suspicious' || log.event_type === 'login_failed') &&
                          'bg-red-50/30'
                      )}
                    >
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap font-mono">
                        {formatRelativeTime(log.created_at)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                            eventTypeBadge(log.event_type)
                          )}
                        >
                          {eventTypeLabel(log.event_type)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {log.user_email ?? (log.user_id ? `User #${log.user_id}` : 'Khách')}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {log.ip_address}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                            severityBadge(log.severity)
                          )}
                        >
                          {severityLabel(log.severity)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 max-w-[200px] truncate">
                        {log.details ?? '—'}
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
