'use client';

import { useQuery } from '@tanstack/react-query';
import { Scale, AlertTriangle, ArrowDownCircle, ArrowUpCircle, Inbox } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { StatCard } from '@/components/shared/stat-card';
import { TableSkeleton } from '@/components/shared/table-skeleton';

// ─── Types ──────────────────────────────────────────────────────
// Shape confirmed from backend/app/api/v1/finance.py `GET /reconcile`
// (require_role accountant/manager/admin). READ-ONLY — chỉ SELECT.

type ReconcileIssueType =
  | 'paid_amount_mismatch'
  | 'status_paid_amount_mismatch'
  | 'overdue_not_flagged';

interface ReconcileIssue {
  type: ReconcileIssueType;
  id: number;
  description: string;
  variance_amount: number;
}

interface ReconcileSummary {
  ar_count: number;
  ap_count: number;
  total_variance_vnd: number;
}

interface ReconcileData {
  ar_issues: ReconcileIssue[];
  ap_issues: ReconcileIssue[];
  summary: ReconcileSummary;
}

interface ReconcileResponse {
  data: ReconcileData;
}

const TYPE_LABELS: Record<ReconcileIssueType, string> = {
  paid_amount_mismatch: 'Lệch số đã thanh toán',
  status_paid_amount_mismatch: 'Trạng thái không khớp số tiền',
  overdue_not_flagged: 'Quá hạn chưa gắn cờ',
};

// variance_amount giữ nguyên currency gốc của bản ghi (có thể VND/USD/RMB —
// xem description để biết đơn vị); KHÔNG gán cứng '₫' để tránh sai đơn vị.
function fmtVariance(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(value));
}

// ─── Issue Table ────────────────────────────────────────────────

function IssueTable({
  title,
  issues,
  emptyLabel,
  variant,
}: {
  title: string;
  issues: ReconcileIssue[];
  emptyLabel: string;
  variant: 'ar' | 'ap';
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      {issues.length === 0 ? (
        <EmptyState icon={Inbox} heading={emptyLabel} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                  Loại
                </th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                  Mã
                </th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                  Mô tả
                </th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                  Chênh lệch
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {issues.map((issue) => (
                <tr
                  key={`${variant}-${issue.id}-${issue.type}`}
                  className="hover:bg-slate-50/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-slate-600">
                      {TYPE_LABELS[issue.type] ?? issue.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono text-slate-500">#{issue.id}</span>
                  </td>
                  <td className="px-4 py-3 max-w-[420px]">
                    <span className="text-sm text-slate-700" title={issue.description}>
                      {issue.description}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        issue.variance_amount !== 0
                          ? 'text-sm font-mono font-medium text-rose-600'
                          : 'text-sm font-mono font-medium text-slate-500'
                      }
                    >
                      {fmtVariance(issue.variance_amount)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────

export default function FinanceReconcilePage() {
  const { data, isLoading, error } = useQuery<ReconcileResponse>({
    queryKey: ['finance-reconcile'],
    queryFn: () => api.get('/api/v1/finance/reconcile'),
    retry: 1,
  });

  const d = data?.data;
  const arIssues = d?.ar_issues ?? [];
  const apIssues = d?.ap_issues ?? [];
  const summary = d?.summary;

  return (
    <div>
      <PageHeader
        className="mb-6"
        icon={Scale}
        title="Đối soát công nợ"
        subtitle="So khớp AR/AP với các khoản thanh toán thực tế — chỉ đọc, không tự sửa dữ liệu"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Lệch phải thu (AR)"
          value={summary ? summary.ar_count : '—'}
          icon={ArrowDownCircle}
          tone={summary && summary.ar_count > 0 ? 'warning' : 'neutral'}
          loading={isLoading}
        />
        <StatCard
          label="Lệch phải trả (AP)"
          value={summary ? summary.ap_count : '—'}
          icon={ArrowUpCircle}
          tone={summary && summary.ap_count > 0 ? 'warning' : 'neutral'}
          loading={isLoading}
        />
        <StatCard
          label="Tổng chênh lệch (VND)"
          value={summary ? formatCurrency(summary.total_variance_vnd, 'VND') : '—'}
          sub="Chỉ cộng bản ghi có currency = VND"
          icon={AlertTriangle}
          tone={summary && summary.total_variance_vnd !== 0 ? 'danger' : 'neutral'}
          loading={isLoading}
        />
      </div>

      {error ? (
        <EmptyState
          variant="error"
          heading="Không thể tải dữ liệu đối soát"
          description="Vui lòng thử lại sau hoặc liên hệ quản trị viên."
        />
      ) : isLoading ? (
        <div className="space-y-6">
          <TableSkeleton rows={4} cols={4} withHeader />
          <TableSkeleton rows={4} cols={4} withHeader />
        </div>
      ) : (
        <div className="space-y-6">
          <IssueTable
            title="Lệch công nợ phải thu (AR)"
            issues={arIssues}
            emptyLabel="Không phát hiện lệch AR"
            variant="ar"
          />
          <IssueTable
            title="Lệch công nợ phải trả (AP)"
            issues={apIssues}
            emptyLabel="Không phát hiện lệch AP"
            variant="ap"
          />
        </div>
      )}
    </div>
  );
}
