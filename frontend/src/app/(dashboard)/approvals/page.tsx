'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileCheck,
  Check,
  X,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/shared/card';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { STATUS_CONFIG } from '@/lib/constants';
import type { PaginatedResponse, Workflow, WorkflowStatus } from '@/types/models';

// ─── Workflow type labels ─────────────────────────────────────

const WORKFLOW_TYPE_LABELS: Record<string, string> = {
  po_approval: 'Duyệt PO',
  payment_approval: 'Duyệt thanh toán',
  price_change: 'Thay đổi giá',
  supplier_onboard: 'NCC mới',
};

const PRIORITY_LABELS: Record<string, { label: string; variant: 'danger' | 'warning' | 'info' | 'neutral' }> = {
  high: { label: 'Cao', variant: 'danger' },
  medium: { label: 'Trung bình', variant: 'warning' },
  low: { label: 'Thấp', variant: 'neutral' },
};

// ─── Reject Dialog Inline ─────────────────────────────────────

function RejectForm({
  onReject,
  onCancel,
  isLoading,
}: {
  onReject: (comment: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!comment.trim()) {
      setError('Vui lòng nhập lý do từ chối');
      return;
    }
    onReject(comment.trim());
  };

  return (
    <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg">
      <label className="block text-xs font-medium text-rose-700 mb-1.5">
        Lý do từ chối <span className="text-rose-500">*</span>
      </label>
      <textarea
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          if (error) setError('');
        }}
        placeholder="Nhập lý do từ chối yêu cầu này..."
        rows={2}
        className={cn(
          'w-full px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-rose-500 resize-none',
          error ? 'border-rose-400' : 'border-rose-200'
        )}
      />
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
      <div className="flex items-center justify-end gap-2 mt-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="h-7 text-xs"
        >
          Hủy
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleSubmit}
          loading={isLoading}
          className="h-7 text-xs"
        >
          Xác nhận từ chối
        </Button>
      </div>
    </div>
  );
}

// ─── Pending Card ─────────────────────────────────────────────

function PendingCard({ workflow }: { workflow: Workflow }) {
  const queryClient = useQueryClient();
  const [showRejectForm, setShowRejectForm] = useState(false);

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/api/v1/workflows/${id}/action`, { action: 'approve' }),
    onSuccess: () => {
      toast.success('Đã duyệt yêu cầu');
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      queryClient.invalidateQueries({ queryKey: ['approvals-pending'] });
      queryClient.invalidateQueries({ queryKey: ['approvals-history'] });
    },
    onError: () => toast.error('Không thể duyệt yêu cầu'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      api.post(`/api/v1/workflows/${id}/action`, {
        action: 'reject',
        comment,
      }),
    onSuccess: () => {
      toast.success('Đã từ chối yêu cầu');
      setShowRejectForm(false);
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      queryClient.invalidateQueries({ queryKey: ['approvals-pending'] });
      queryClient.invalidateQueries({ queryKey: ['approvals-history'] });
    },
    onError: () => toast.error('Không thể từ chối yêu cầu'),
  });

  // Extract amount from workflow description or reference
  const amount = (workflow as any).amount as number | undefined;
  const priority = ((workflow as any).priority as string) ?? 'medium';
  const priorityCfg = PRIORITY_LABELS[priority] ?? PRIORITY_LABELS.medium;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-slate-900 truncate">
              {workflow.title}
            </h4>
            <Badge variant={priorityCfg.variant} className="text-[11px] shrink-0">
              {priorityCfg.label}
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mb-2">
            {WORKFLOW_TYPE_LABELS[workflow.workflow_type] ?? workflow.workflow_type}
          </p>
          {workflow.description && (
            <p className="text-xs text-slate-500 mb-3 line-clamp-2">
              {workflow.description}
            </p>
          )}
        </div>
        {amount != null && (
          <div className="text-right shrink-0 ml-4">
            <p className="text-base font-bold font-mono text-slate-900">
              {formatCurrency(amount)}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-400 mb-3">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(workflow.created_at)}
        </span>
        <span>
          Người tạo: {workflow.initiator?.full_name ?? '—'}
        </span>
      </div>

      {/* Action buttons */}
      {!showRejectForm && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 px-4 text-xs bg-emerald-600 hover:bg-emerald-700"
            loading={approveMutation.isPending}
            onClick={() => approveMutation.mutate(workflow.id)}
          >
            <Check className="h-3.5 w-3.5" />
            Duyệt
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-8 px-4 text-xs"
            onClick={() => setShowRejectForm(true)}
          >
            <X className="h-3.5 w-3.5" />
            Từ chối
          </Button>
        </div>
      )}

      {/* Reject form */}
      {showRejectForm && (
        <RejectForm
          onReject={(comment) =>
            rejectMutation.mutate({ id: workflow.id, comment })
          }
          onCancel={() => setShowRejectForm(false)}
          isLoading={rejectMutation.isPending}
        />
      )}
    </Card>
  );
}

// ─── Page Component ───────────────────────────────────────────

export default function ApprovalsPage() {
  const [showHistory, setShowHistory] = useState(true);

  // Fetch pending workflows
  const { data: pendingData, isLoading: pendingLoading } = useQuery<
    PaginatedResponse<Workflow>
  >({
    queryKey: ['approvals-pending'],
    queryFn: () => api.get('/api/v1/workflows?status=pending_l1'),
    retry: false,
  });

  // Fetch recent history
  const { data: historyData, isLoading: historyLoading } = useQuery<
    PaginatedResponse<Workflow>
  >({
    queryKey: ['approvals-history'],
    queryFn: () => api.get('/api/v1/workflows?page_size=20'),
    retry: false,
  });

  // Handle both {items:[]} and {data:{items:[]}} response shapes
  const pendingRaw = pendingData?.items ?? (pendingData as any)?.data?.items ?? (pendingData as any)?.data ?? [];
  const pendingItems = Array.isArray(pendingRaw) ? pendingRaw : [];
  const historyRaw = historyData?.items ?? (historyData as any)?.data?.items ?? (historyData as any)?.data ?? [];
  const historyItems = (Array.isArray(historyRaw) ? historyRaw : []).filter(
    (w: any) => w.status === 'approved' || w.status === 'rejected'
  );

  return (
    <div>
      {/* Header */}
      <PageHeader
        className="mb-6"
        icon={FileCheck}
        title={
          <span className="inline-flex items-center gap-3">
            Phê duyệt
            {pendingItems.length > 0 && (
              <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                {pendingItems.length}
              </span>
            )}
          </span>
        }
        subtitle="Xem xét và xử lý các yêu cầu phê duyệt"
      />

      {/* Pending count alert */}
      {!pendingLoading && pendingItems.length > 0 && (
        <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-sm text-amber-700 font-medium">
            {pendingItems.length} yêu cầu đang chờ duyệt
          </span>
        </div>
      )}

      {/* Section A: Pending */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" />
          Đang chờ duyệt
        </h3>

        {pendingLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <div className="space-y-3">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-64" />
                  <div className="flex gap-2 mt-2">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-8 w-20" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : pendingItems.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              icon={Check}
              heading="Không có yêu cầu nào đang chờ"
              description="Tất cả yêu cầu đã được xử lý"
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingItems.map((wf) => (
              <PendingCard key={wf.id} workflow={wf} />
            ))}
          </div>
        )}
      </div>

      {/* Section B: Recent History */}
      <div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-4 hover:text-slate-900 transition-colors"
        >
          <FileCheck className="h-4 w-4 text-slate-400" />
          Đã xử lý gần đây
          {showHistory ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
          {historyItems.length > 0 && (
            <span className="text-xs text-slate-400 font-normal">
              ({historyItems.length})
            </span>
          )}
        </button>

        {showHistory && (
          <Card padded={false} className="overflow-hidden">
            {historyLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-4 w-32 ml-auto" />
                  </div>
                ))}
              </div>
            ) : historyItems.length === 0 ? (
              <EmptyState icon={FileCheck} heading="Chưa có lịch sử xử lý" />
            ) : (
              <div className="divide-y divide-slate-100">
                {historyItems.map((wf) => {
                  const statusCfg = STATUS_CONFIG[wf.status];
                  return (
                    <div
                      key={wf.id}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 font-medium truncate">
                          {wf.title}
                        </p>
                        <p className="text-xs text-slate-400">
                          {WORKFLOW_TYPE_LABELS[wf.workflow_type] ?? wf.workflow_type}
                          {' \u2022 '}
                          {wf.initiator?.full_name ?? '—'}
                        </p>
                      </div>
                      {statusCfg && (
                        <StatusBadge
                          label={statusCfg.label}
                          variant={statusCfg.variant}
                        />
                      )}
                      <span className="text-xs text-slate-400 shrink-0">
                        {formatRelativeTime(wf.updated_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
