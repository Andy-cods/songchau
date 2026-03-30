'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MapPin,
  FileText,
  Check,
  X,
  Send,
  Clock,
  User,
  Inbox,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { PO_STATUS_CONFIG, STATUS_CONFIG } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { WorkflowStatus } from '@/types/models';
import { toast } from 'sonner';

// ─── Page Component ────────────────────────────────────────────

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const poId = params.id as string;

  // Fetch PO detail
  const { data: poRaw, isLoading: poLoading, error: poError } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => api.get<any>(`/api/v1/purchase-orders/${poId}`),
    retry: 1,
  });

  // Fetch workflow for this PO (try by reference)
  const { data: workflowRaw } = useQuery({
    queryKey: ['workflows', 'po', poId],
    queryFn: async () => {
      // Try fetching workflows and filter for this PO
      try {
        const res = await api.get<any>(`/api/v1/workflows?reference_id=${poId}`);
        const workflows = res?.data ?? [];
        if (workflows.length > 0) return workflows[0];
        // Try direct endpoint
        return await api.get<any>(`/api/v1/workflows/reference/${poId}`);
      } catch {
        return null;
      }
    },
    retry: false,
    enabled: !!poId,
  });

  // Mutations
  const submitMutation = useMutation({
    mutationFn: () => api.post(`/api/v1/purchase-orders/${poId}/submit`),
    onSuccess: () => {
      toast.success('Đã gửi đơn hàng để duyệt');
      queryClient.invalidateQueries({ queryKey: ['purchase-orders', poId] });
    },
    onError: () => toast.error('Không thể gửi đơn hàng'),
  });

  const approveMutation = useMutation({
    mutationFn: () => api.post(`/api/v1/purchase-orders/${poId}/approve`),
    onSuccess: () => {
      toast.success('Đã duyệt đơn hàng');
      queryClient.invalidateQueries({ queryKey: ['purchase-orders', poId] });
    },
    onError: () => toast.error('Không thể duyệt đơn hàng'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/api/v1/purchase-orders/${poId}/reject`),
    onSuccess: () => {
      toast.success('Đã từ chối đơn hàng');
      queryClient.invalidateQueries({ queryKey: ['purchase-orders', poId] });
    },
    onError: () => toast.error('Không thể từ chối đơn hàng'),
  });

  if (poLoading) {
    return <PODetailSkeleton />;
  }

  // Error state
  if (poError || !poRaw) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Inbox className="h-16 w-16 text-slate-300 mb-4" />
        <h3 className="text-lg font-semibold text-slate-700 mb-2">
          Không tìm thấy đơn hàng
        </h3>
        <p className="text-sm text-slate-500 mb-6">
          Đơn hàng này không tồn tại hoặc bạn không có quyền xem.
        </p>
        <Link
          href="/purchase-orders"
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại danh sách
        </Link>
      </div>
    );
  }

  // Extract PO data — API returns {data: {...}, line_items: [...]}
  const poData = poRaw?.data ?? poRaw ?? {};
  const lineItems: any[] = poRaw?.line_items ?? poData?.items ?? [];
  const supplier = poData?.supplier ?? {};

  // Workflow data from real API
  const wfData = workflowRaw?.data ?? workflowRaw ?? null;
  const wfSteps: any[] = wfData?.steps ?? [];

  const statusCfg = (PO_STATUS_CONFIG as any)[poData.status];

  return (
    <div>
      {/* ── Back + Title ──────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/purchase-orders"
          className="flex items-center justify-center h-8 w-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-display font-bold text-slate-900">
              {poData.po_number ?? `PO #${poId}`}
            </h2>
            {statusCfg && (
              <StatusBadge
                label={statusCfg.label}
                variant={statusCfg.variant}
                pulse={statusCfg.pulse}
              />
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Tạo bởi {poData.created_by_user?.full_name ?? poData.created_by ?? '—'}{' '}
            vào {formatDate(poData.created_at)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-display font-bold text-slate-900">
            {formatCurrency(
              poData.total_amount,
              poData.currency ?? 'VND'
            )}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">Tổng giá trị</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left Column: Main Content ───────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Supplier Info */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-400" />
              Nhà cung cấp
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-base font-semibold text-slate-900">
                  {poData.supplier_name ?? supplier?.name ?? '—'}
                </p>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  {supplier?.code ?? ''}
                </p>
              </div>
              <div className="space-y-2">
                {supplier?.contact_person && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    {supplier.contact_person}
                  </div>
                )}
                {supplier?.phone && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                    {supplier.phone}
                  </div>
                )}
                {supplier?.email && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    {supplier.email}
                  </div>
                )}
                {supplier?.address && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                    {supplier.address}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-400" />
                Hạng mục ({lineItems.length})
              </h3>
            </div>
            {lineItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                <Inbox className="h-10 w-10 mb-2" />
                <p className="text-sm text-slate-400">Chưa có hạng mục nào</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-5 py-3">
                        #
                      </th>
                      <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                        Sản phẩm
                      </th>
                      <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                        SL
                      </th>
                      <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                        Đơn giá
                      </th>
                      <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-5 py-3">
                        Thành tiền
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lineItems.map((item: any, idx: number) => (
                      <tr key={item.id ?? idx} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3 text-sm text-slate-400 font-mono">
                          {idx + 1}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-slate-700">
                            {item.product_name ?? '—'}
                          </p>
                          {item.product_code && (
                            <span className="text-xs font-mono text-slate-400">
                              {item.product_code}
                            </span>
                          )}
                          {item.specification && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              {item.specification}
                            </p>
                          )}
                          {item.notes && (
                            <p className="text-xs text-amber-600 mt-0.5 italic">
                              {item.notes}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-mono text-slate-700">
                          {item.quantity != null
                            ? `${Number(item.quantity).toLocaleString('vi-VN')}${
                                item.unit ? ` ${item.unit}` : ''
                              }`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-mono text-slate-700">
                          {item.unit_price != null
                            ? formatCurrency(
                                item.unit_price,
                                item.currency ?? poData.currency ?? 'VND'
                              )
                            : '—'}
                        </td>
                        <td className="px-5 py-3 text-right text-sm font-mono font-medium text-slate-900">
                          {item.total_price != null
                            ? formatCurrency(
                                item.total_price,
                                item.currency ?? poData.currency ?? 'VND'
                              )
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {(poData.subtotal != null || poData.total_amount != null) && (
                    <tfoot>
                      {poData.subtotal != null && (
                        <tr className="border-t border-slate-200">
                          <td
                            colSpan={4}
                            className="px-5 py-2 text-right text-sm text-slate-500"
                          >
                            Tạm tính
                          </td>
                          <td className="px-5 py-2 text-right text-sm font-mono text-slate-700">
                            {formatCurrency(
                              poData.subtotal,
                              poData.currency ?? 'VND'
                            )}
                          </td>
                        </tr>
                      )}
                      {poData.tax_amount != null && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-5 py-2 text-right text-sm text-slate-500"
                          >
                            VAT
                          </td>
                          <td className="px-5 py-2 text-right text-sm font-mono text-slate-700">
                            {formatCurrency(
                              poData.tax_amount,
                              poData.currency ?? 'VND'
                            )}
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-slate-200">
                        <td
                          colSpan={4}
                          className="px-5 py-3 text-right text-sm font-semibold text-slate-900"
                        >
                          Tổng cộng
                        </td>
                        <td className="px-5 py-3 text-right text-base font-mono font-bold text-brand-600">
                          {formatCurrency(
                            poData.total_amount,
                            poData.currency ?? 'VND'
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Column: Sidebar ───────────────────────────── */}
        <div className="space-y-6">
          {/* Action Buttons */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Thao tác
            </h3>
            <div className="space-y-2">
              {poData.status === 'draft' && (
                <Button
                  className="w-full"
                  onClick={() => submitMutation.mutate()}
                  loading={submitMutation.isPending}
                >
                  <Send className="h-4 w-4" />
                  Gửi duyệt
                </Button>
              )}
              {(poData.status === 'pending_approval' ||
                poData.status === 'draft') && (
                <>
                  <Button
                    className="w-full"
                    onClick={() => approveMutation.mutate()}
                    loading={approveMutation.isPending}
                  >
                    <Check className="h-4 w-4" />
                    Duyệt
                  </Button>
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() => rejectMutation.mutate()}
                    loading={rejectMutation.isPending}
                  >
                    <X className="h-4 w-4" />
                    Từ chối
                  </Button>
                </>
              )}
              {poData.status !== 'draft' &&
                poData.status !== 'pending_approval' && (
                  <p className="text-sm text-slate-400 text-center py-2">
                    Không có thao tác khả dụng
                  </p>
                )}
            </div>
          </div>

          {/* Details */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Chi tiết
            </h3>
            <dl className="space-y-3">
              <DetailRow
                label="Điều khoản thanh toán"
                value={poData.payment_terms ?? '—'}
              />
              <DetailRow
                label="Ngày giao dự kiến"
                value={
                  poData.expected_delivery
                    ? formatDate(poData.expected_delivery)
                    : '—'
                }
              />
              <DetailRow label="Tiền tệ" value={poData.currency ?? '—'} />
              <DetailRow
                label="Cập nhật lần cuối"
                value={formatRelativeTime(poData.updated_at)}
              />
            </dl>
            {poData.notes && (
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-500 mb-1">
                  Ghi chú
                </p>
                <p className="text-sm text-slate-600">{poData.notes}</p>
              </div>
            )}
          </div>

          {/* Workflow Timeline */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-400" />
              Quy trình duyệt
            </h3>
            {wfData && wfSteps.length > 0 ? (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-3 top-3 bottom-3 w-px bg-slate-200" />

                <div className="space-y-4">
                  {/* Initiation */}
                  <TimelineStep
                    status="approved"
                    label="Tạo yêu cầu"
                    user={
                      wfData.initiator?.full_name ??
                      wfData.initiated_by ??
                      '—'
                    }
                    time={formatRelativeTime(wfData.created_at)}
                  />

                  {/* Steps */}
                  {wfSteps.map((step: any) => {
                    const sc = (STATUS_CONFIG as any)[step.status] ?? {
                      label: step.status,
                    };
                    return (
                      <TimelineStep
                        key={step.id}
                        status={step.status}
                        label={`Bước ${step.step_order} — ${sc?.label ?? step.status}`}
                        user={step.approver?.full_name ?? step.approver_id ?? '—'}
                        time={
                          step.acted_at
                            ? formatRelativeTime(step.acted_at)
                            : 'Đang chờ'
                        }
                        comment={step.comment}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-4">
                Chưa có quy trình duyệt
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ──────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function TimelineStep({
  status,
  label,
  user,
  time,
  comment,
}: {
  status: string;
  label: string;
  user: string;
  time: string;
  comment?: string;
}) {
  const dotColor: Record<string, string> = {
    approved: 'bg-emerald-500',
    rejected: 'bg-red-500',
    pending: 'bg-slate-300',
    in_review: 'bg-cyan-500',
    escalated: 'bg-amber-500',
  };

  return (
    <div className="relative pl-8">
      {/* Dot */}
      <div
        className={cn(
          'absolute left-1.5 top-1 h-3 w-3 rounded-full border-2 border-white',
          dotColor[status] ?? 'bg-slate-300'
        )}
      />

      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-slate-500">{user}</span>
          <span className="text-xs text-slate-300">|</span>
          <span className="text-xs text-slate-400">{time}</span>
        </div>
        {comment && (
          <p className="text-xs text-slate-500 mt-1 italic bg-slate-50 rounded px-2 py-1">
            &quot;{comment}&quot;
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────

function PODetailSkeleton() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-1" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-52 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
