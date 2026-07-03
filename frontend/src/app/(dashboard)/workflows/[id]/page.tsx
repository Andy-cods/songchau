'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  FileCheck,
  Clock,
  Check,
  X,
  ArrowUpRight,
  User,
  Calendar,
  DollarSign,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { Card } from '@/components/shared/card';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { STATUS_CONFIG } from '@/lib/constants';
import type { Workflow, WorkflowStatus, WorkflowStep } from '@/types/models';

// ─── Workflow type labels ─────────────────────────────────────

const WORKFLOW_TYPE_LABELS: Record<string, string> = {
  po_approval: 'Duyệt PO',
  payment_approval: 'Duyệt thanh toán',
  price_change: 'Thay đổi giá',
  supplier_onboard: 'NCC mới',
};

const PRIORITY_CONFIG: Record<
  string,
  { label: string; variant: 'danger' | 'warning' | 'info' | 'neutral' }
> = {
  high: { label: 'Cao', variant: 'danger' },
  medium: { label: 'Trung bình', variant: 'warning' },
  low: { label: 'Thấp', variant: 'neutral' },
};

// ─── History Entry Type ───────────────────────────────────────

interface WorkflowHistoryEntry {
  id: string;
  action: string;
  actor_name: string;
  comment?: string;
  timestamp: string;
  from_status?: WorkflowStatus;
  to_status?: WorkflowStatus;
}

// ─── Timeline Step Component ──────────────────────────────────

function TimelineItem({
  entry,
  isLast,
}: {
  entry: WorkflowHistoryEntry;
  isLast: boolean;
}) {
  const actionLabels: Record<string, { label: string; color: string; dotColor: string }> = {
    created: { label: 'Tạo yêu cầu', color: 'text-slate-600', dotColor: 'bg-slate-400' },
    approved: { label: 'Đã duyệt', color: 'text-emerald-600', dotColor: 'bg-emerald-500' },
    rejected: { label: 'Từ chối', color: 'text-rose-600', dotColor: 'bg-rose-500' },
    escalated: { label: 'Chuyển cấp trên', color: 'text-amber-600', dotColor: 'bg-amber-500' },
    submitted: { label: 'Gửi duyệt', color: 'text-brand-600', dotColor: 'bg-brand-500' },
    commented: { label: 'Bình luận', color: 'text-slate-600', dotColor: 'bg-slate-400' },
  };

  const cfg = actionLabels[entry.action] ?? actionLabels.commented;

  return (
    <div className="relative pl-8 pb-6">
      {/* Vertical line */}
      {!isLast && (
        <div className="absolute left-[11px] top-5 bottom-0 w-px bg-slate-200" />
      )}
      {/* Dot */}
      <div
        className={cn(
          'absolute left-0.5 top-1 h-4 w-4 rounded-full border-2 border-white shadow-sm',
          cfg.dotColor
        )}
      />

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-sm font-medium', cfg.color)}>
            {cfg.label}
          </span>
          <span className="text-xs text-slate-400">
            bởi {entry.actor_name}
          </span>
          <span className="text-xs text-slate-300">|</span>
          <span className="text-xs text-slate-400">
            {formatRelativeTime(entry.timestamp)}
          </span>
        </div>
        {entry.comment && (
          <p className="text-xs text-slate-500 mt-1.5 italic bg-slate-50 rounded px-3 py-2">
            &quot;{entry.comment}&quot;
          </p>
        )}
        {entry.to_status && (
          <div className="mt-1.5">
            <span className="text-xs text-slate-400">
              Trạng thái:
            </span>{' '}
            {STATUS_CONFIG[entry.to_status] && (
              <StatusBadge
                label={STATUS_CONFIG[entry.to_status].label}
                variant={STATUS_CONFIG[entry.to_status].variant}
                className="text-[11px]"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────

export default function WorkflowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id as string;

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Fetch workflow
  const { data: workflow, isLoading: wfLoading } = useQuery<Workflow>({
    queryKey: ['workflow', id],
    queryFn: () => api.get(`/api/v1/workflows/${id}`),
    retry: false,
  });

  // Fetch history
  const { data: history, isLoading: historyLoading } = useQuery<
    WorkflowHistoryEntry[]
  >({
    queryKey: ['workflow-history', id],
    queryFn: () => api.get(`/api/v1/workflows/${id}/history`),
    retry: false,
  });

  // Mutations
  const approveMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/workflows/${id}/action`, { action: 'approve' }),
    onSuccess: () => {
      toast.success('Đã duyệt yêu cầu');
      queryClient.invalidateQueries({ queryKey: ['workflow', id] });
      queryClient.invalidateQueries({ queryKey: ['workflow-history', id] });
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: () => toast.error('Không thể duyệt yêu cầu'),
  });

  const rejectMutation = useMutation({
    mutationFn: (comment: string) =>
      api.post(`/api/v1/workflows/${id}/action`, {
        action: 'reject',
        comment,
      }),
    onSuccess: () => {
      toast.success('Đã từ chối yêu cầu');
      setShowRejectForm(false);
      setRejectComment('');
      queryClient.invalidateQueries({ queryKey: ['workflow', id] });
      queryClient.invalidateQueries({ queryKey: ['workflow-history', id] });
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: () => toast.error('Không thể từ chối yêu cầu'),
  });

  const escalateMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/workflows/${id}/action`, { action: 'escalate' }),
    onSuccess: () => {
      toast.success('Đã chuyển cấp trên');
      queryClient.invalidateQueries({ queryKey: ['workflow', id] });
      queryClient.invalidateQueries({ queryKey: ['workflow-history', id] });
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: () => toast.error('Không thể chuyển cấp trên'),
  });

  const handleReject = () => {
    if (!rejectComment.trim()) {
      setRejectError('Vui lòng nhập lý do từ chối');
      return;
    }
    rejectMutation.mutate(rejectComment.trim());
  };

  if (wfLoading) {
    return <WorkflowDetailSkeleton />;
  }

  if (!workflow) {
    return (
      <EmptyState
        icon={FileCheck}
        heading="Không tìm thấy yêu cầu phê duyệt"
        actionLabel="Quay lại danh sách"
        onAction={() => router.push('/workflows')}
      />
    );
  }

  const statusCfg = STATUS_CONFIG[workflow.status];
  const isPending =
    workflow.status === 'pending' || workflow.status === 'in_review';
  const amount = (workflow as any).amount as
    | number
    | undefined;
  const priority =
    ((workflow as any).priority as string) ?? 'medium';
  const deadline = (workflow as any).deadline as
    | string
    | undefined;
  const priorityCfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.medium;

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/workflows"
          className="p-2 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-display font-bold text-slate-900">
              {workflow.title}
            </h2>
            {statusCfg && (
              <StatusBadge
                label={statusCfg.label}
                variant={statusCfg.variant}
                pulse={statusCfg.pulse}
              />
            )}
            <Badge variant={priorityCfg.variant}>
              {priorityCfg.label}
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {WORKFLOW_TYPE_LABELS[workflow.workflow_type] ?? workflow.workflow_type}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Info + Timeline */}
        <div className="lg:col-span-2 space-y-6">
          {/* Workflow Info Card */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              Thông tin yêu cầu
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailItem
                icon={User}
                label="Người tạo"
                value={workflow.initiator?.full_name ?? '—'}
              />
              <DetailItem
                icon={Calendar}
                label="Ngày tạo"
                value={formatDate(workflow.created_at)}
              />
              {amount != null && (
                <DetailItem
                  icon={DollarSign}
                  label="Giá trị"
                  value={formatCurrency(amount)}
                  bold
                />
              )}
              {deadline && (
                <DetailItem
                  icon={AlertCircle}
                  label="Hạn xử lý"
                  value={formatDate(deadline)}
                />
              )}
            </div>

            {workflow.description && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-500 mb-1">
                  Mô tả
                </p>
                <p className="text-sm text-slate-600">{workflow.description}</p>
              </div>
            )}
          </div>

          {/* Approval Steps */}
          {workflow.steps?.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-400" />
                Các bước duyệt
              </h3>
              <div className="space-y-3">
                {workflow.steps.map((step) => {
                  const sc = STATUS_CONFIG[step.status];
                  return (
                    <div
                      key={step.id}
                      className={cn(
                        'flex items-center gap-4 p-3 rounded-lg border',
                        step.status === 'approved'
                          ? 'bg-emerald-50 border-emerald-200'
                          : step.status === 'rejected'
                          ? 'bg-rose-50 border-rose-200'
                          : 'bg-slate-50 border-slate-200'
                      )}
                    >
                      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-500">
                        {step.step_order}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700">
                          {step.approver?.full_name ?? '—'}
                        </p>
                        <p className="text-xs text-slate-400">
                          {step.approver?.role ?? ''}
                          {step.acted_at &&
                            ` \u2022 ${formatRelativeTime(step.acted_at)}`}
                        </p>
                        {step.comment && (
                          <p className="text-xs text-slate-500 mt-1 italic">
                            &quot;{step.comment}&quot;
                          </p>
                        )}
                      </div>
                      {sc && (
                        <StatusBadge
                          label={sc.label}
                          variant={sc.variant}
                          pulse={sc.pulse}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timeline / History */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-brand-500" />
              Lịch sử xử lý
            </h3>

            {historyLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex gap-3 items-start pl-8">
                    <div className="space-y-2 flex-1">
                      <div className="h-4 w-48 bg-slate-200 rounded animate-pulse" />
                      <div className="h-3 w-32 bg-slate-200 rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !history || history.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">
                Chưa có lịch sử xử lý
              </p>
            ) : (
              <div>
                {history.map((entry, idx) => (
                  <TimelineItem
                    key={entry.id}
                    entry={entry}
                    isLast={idx === history.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="space-y-6">
          {/* Action buttons */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Thao tác
            </h3>

            {isPending ? (
              <div className="space-y-2">
                {!showRejectForm && (
                  <>
                    <Button
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      loading={approveMutation.isPending}
                      onClick={() => approveMutation.mutate()}
                    >
                      <Check className="h-4 w-4" />
                      Duyệt
                    </Button>
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={() => setShowRejectForm(true)}
                    >
                      <X className="h-4 w-4" />
                      Từ chối
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      loading={escalateMutation.isPending}
                      onClick={() => escalateMutation.mutate()}
                    >
                      <ArrowUpRight className="h-4 w-4" />
                      Chuyển cấp trên
                    </Button>
                  </>
                )}

                {showRejectForm && (
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-slate-600">
                      Lý do từ chối <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      value={rejectComment}
                      onChange={(e) => {
                        setRejectComment(e.target.value);
                        if (rejectError) setRejectError('');
                      }}
                      placeholder="Nhập lý do từ chối..."
                      rows={3}
                      className={cn(
                        'w-full px-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none',
                        rejectError ? 'border-rose-400' : 'border-slate-200'
                      )}
                    />
                    {rejectError && (
                      <p className="text-xs text-rose-600">{rejectError}</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          setShowRejectForm(false);
                          setRejectComment('');
                          setRejectError('');
                        }}
                      >
                        Hủy
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="flex-1"
                        loading={rejectMutation.isPending}
                        onClick={handleReject}
                      >
                        Xác nhận từ chối
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-2">
                Yêu cầu đã được xử lý
              </p>
            )}
          </div>

          {/* Quick info */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Chi tiết
            </h3>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-xs text-slate-400">Loại</dt>
                <dd className="text-sm text-slate-700">
                  {WORKFLOW_TYPE_LABELS[workflow.workflow_type] ??
                    workflow.workflow_type}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-xs text-slate-400">Mã tham chiếu</dt>
                <dd className="text-sm font-mono text-brand-600">
                  {workflow.reference_id}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-xs text-slate-400">Ngày tạo</dt>
                <dd className="text-sm text-slate-700">
                  {formatDate(workflow.created_at)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-xs text-slate-400">Cập nhật lần cuối</dt>
                <dd className="text-sm text-slate-700">
                  {formatRelativeTime(workflow.updated_at)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Item ──────────────────────────────────────────────

function DetailItem({
  icon: Icon,
  label,
  value,
  bold,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p
          className={cn(
            'text-sm text-slate-700',
            bold && 'font-semibold text-slate-900'
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────

function WorkflowDetailSkeleton() {
  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Skeleton className="h-8 w-8 rounded-md" />
        <div className="flex-1">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-40 mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
