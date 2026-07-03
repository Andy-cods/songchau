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

  const _qRaw: any = qualityRaw?.data ?? qualityRaw;
  const items: DataQualityItem[] = Array.isArray(_qRaw)
    ? _qRaw
    : Array.isArray(_qRaw?.items) ? _qRaw.items : [];

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
      <PageHeader
        icon={ShieldCheck}
        title="Chất lượng dữ liệu"
        subtitle="Kiểm tra và báo cáo chất lượng dữ liệu hệ thống"
        actions={
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition-colors"
          >
            {runMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            Chạy kiểm tra
          </button>
        }
      />

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
        <Card padded={false} className="p-4">
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
        </Card>
      )}

      {/* Results Table */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <Table2 className="h-4 w-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-slate-700">Kết quả kiểm tra</h3>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-auto" />}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bảng</TableHead>
              <TableHead>Tên kiểm tra</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="text-right">Hàng bị ảnh hưởng</TableHead>
              <TableHead>Chi tiết</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : items.map((item, idx) => (
                  <TableRow
                    key={idx}
                    className={cn(
                      item.status.toLowerCase() === 'fail' && 'bg-red-50/30'
                    )}
                  >
                    <TableCell className="py-2.5 font-mono text-xs text-slate-700">{item.table_name}</TableCell>
                    <TableCell className="py-2.5 text-sm text-slate-600">{item.check_name}</TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={item.status} />
                        <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', statusBadgeClass(item.status))}>
                          {statusLabel(item.status)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 text-right font-mono text-sm text-slate-700">
                      {item.affected_rows > 0
                        ? <span className={item.status.toLowerCase() !== 'pass' ? 'text-amber-600 font-bold' : ''}>
                            {(item.affected_rows ?? 0).toLocaleString('vi-VN')}
                          </span>
                        : <span className="text-slate-300">0</span>}
                    </TableCell>
                    <TableCell className="py-2.5 text-xs text-slate-500 max-w-xs truncate">
                      {item.details ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!isLoading && items.length === 0 && (
          <EmptyState
            icon={ShieldCheck}
            heading='Nhấn "Chạy kiểm tra" để bắt đầu'
            className="py-12"
          />
        )}
      </Card>
    </div>
  );
}
