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
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import { PO_STATUS_CONFIG, STATUS_CONFIG } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  PurchaseOrder,
  Workflow,
  WorkflowStatus,
} from '@/types/models';
import { toast } from 'sonner';

// ─── Mock Data ─────────────────────────────────────────────────

const MOCK_PO: PurchaseOrder = {
  id: 'mock-1',
  po_number: 'PO-2026-0142',
  supplier_id: 'sup-1',
  supplier: {
    id: 'sup-1',
    name: 'Mitsubishi Electric Vietnam',
    code: 'MIT-VN',
    contact_person: 'Tanaka Hiroshi',
    email: 'tanaka.h@mitsubishi-electric.vn',
    phone: '+84 28 3822 1234',
    address: '12 Nguyễn Thị Minh Khai, Q.1, TP.HCM',
    country: 'Vietnam',
    tax_id: '0301234567',
    payment_terms: 'Net 30',
    rating: 4.8,
    is_active: true,
    created_at: '2024-01-15T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  },
  status: 'pending_approval',
  items: [
    {
      id: 'item-1',
      product_name: 'MCCB NF250-SEV 3P 200A',
      product_code: 'NF250SEV-200',
      specification: '250AF/200AT, 36kA, 3 cực',
      quantity: 50,
      unit: 'cái',
      unit_price: 4500000,
      currency: 'VND',
      total_price: 225000000,
      notes: 'Giao từng đợt, 25 cái/đợt',
    },
    {
      id: 'item-2',
      product_name: 'MCCB NF125-SGV 3P 100A',
      product_code: 'NF125SGV-100',
      specification: '125AF/100AT, 36kA, 3 cực',
      quantity: 100,
      unit: 'cái',
      unit_price: 2800000,
      currency: 'VND',
      total_price: 280000000,
    },
    {
      id: 'item-3',
      product_name: 'VFD FR-E840-0120 5.5kW',
      product_code: 'FRE840-0120',
      specification: '380V, 3 pha, 5.5kW, vector control',
      quantity: 10,
      unit: 'bộ',
      unit_price: 12500000,
      currency: 'VND',
      total_price: 125000000,
    },
  ],
  subtotal: 630000000,
  tax_amount: 63000000,
  total_amount: 693000000,
  currency: 'VND',
  payment_terms: 'Net 30 - TT 50% trước, 50% khi giao hàng',
  expected_delivery: '2026-04-15',
  notes: 'Ưu tiên giao hàng trước deadline dự án. Yêu cầu CO/CQ đầy đủ.',
  created_by: 'user-1',
  created_by_user: {
    id: 'user-1',
    email: 'an.nguyen@songchau.vn',
    full_name: 'Nguyễn Văn An',
    role: 'sales',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  },
  created_at: '2026-03-25T08:30:00Z',
  updated_at: '2026-03-25T08:30:00Z',
};

const MOCK_WORKFLOW: Workflow = {
  id: 'wf-1',
  workflow_type: 'po_approval',
  reference_id: 'mock-1',
  reference_type: 'purchase_order',
  title: 'Duyệt PO-2026-0142',
  description: 'Yêu cầu duyệt đơn mua hàng Mitsubishi Electric',
  status: 'in_review',
  steps: [
    {
      id: 'step-1',
      step_order: 1,
      approver_id: 'user-2',
      approver: {
        id: 'user-2',
        email: 'tuan.pham@songchau.vn',
        full_name: 'Phạm Minh Tuấn',
        role: 'manager',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
      },
      status: 'approved',
      comment: 'Giá OK, đã so sánh với báo giá Q4/2025.',
      acted_at: '2026-03-26T10:15:00Z',
    },
    {
      id: 'step-2',
      step_order: 2,
      approver_id: 'user-3',
      approver: {
        id: 'user-3',
        email: 'hung.le@songchau.vn',
        full_name: 'Lê Quốc Hùng',
        role: 'director',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
      },
      status: 'pending',
    },
  ],
  initiated_by: 'user-1',
  initiator: {
    id: 'user-1',
    email: 'an.nguyen@songchau.vn',
    full_name: 'Nguyễn Văn An',
    role: 'sales',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  },
  created_at: '2026-03-25T09:00:00Z',
  updated_at: '2026-03-26T10:15:00Z',
};

// ─── Page Component ────────────────────────────────────────────

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const poId = params.id as string;

  // Fetch PO
  const { data: po, isLoading: poLoading } = useQuery<PurchaseOrder>({
    queryKey: ['purchase-orders', poId],
    queryFn: () => api.get(`/api/v1/purchase-orders/${poId}`),
    retry: false,
  });

  // Fetch workflow (if exists)
  const { data: workflow } = useQuery<Workflow>({
    queryKey: ['workflows', 'po', poId],
    queryFn: () => api.get(`/api/v1/workflows/reference/${poId}`),
    retry: false,
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

  // Use real data or mock fallback
  const poData = po ?? MOCK_PO;
  const wfData = workflow ?? MOCK_WORKFLOW;
  const statusCfg = PO_STATUS_CONFIG[poData.status];

  if (poLoading) {
    return <PODetailSkeleton />;
  }

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
              {poData.po_number}
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
            Tạo bởi {poData.created_by_user?.full_name ?? '—'} vào{' '}
            {formatDate(poData.created_at)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-display font-bold text-slate-900">
            {formatCurrency(poData.total_amount, poData.currency)}
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
                  {poData.supplier?.name ?? '—'}
                </p>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  {poData.supplier?.code}
                </p>
              </div>
              <div className="space-y-2">
                {poData.supplier?.contact_person && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    {poData.supplier.contact_person}
                  </div>
                )}
                {poData.supplier?.phone && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                    {poData.supplier.phone}
                  </div>
                )}
                {poData.supplier?.email && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    {poData.supplier.email}
                  </div>
                )}
                {poData.supplier?.address && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                    {poData.supplier.address}
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
                Hạng mục ({poData.items.length})
              </h3>
            </div>
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
                  {poData.items.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-50/50">
                      <td className="px-5 py-3 text-sm text-slate-400 font-mono">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-slate-700">
                          {item.product_name}
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
                        {item.quantity.toLocaleString('vi-VN')} {item.unit}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-mono text-slate-700">
                        {formatCurrency(item.unit_price, item.currency)}
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-mono font-medium text-slate-900">
                        {formatCurrency(item.total_price, item.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200">
                    <td colSpan={4} className="px-5 py-2 text-right text-sm text-slate-500">
                      Tạm tính
                    </td>
                    <td className="px-5 py-2 text-right text-sm font-mono text-slate-700">
                      {formatCurrency(poData.subtotal, poData.currency)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-5 py-2 text-right text-sm text-slate-500">
                      VAT (10%)
                    </td>
                    <td className="px-5 py-2 text-right text-sm font-mono text-slate-700">
                      {formatCurrency(poData.tax_amount, poData.currency)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <td colSpan={4} className="px-5 py-3 text-right text-sm font-semibold text-slate-900">
                      Tổng cộng
                    </td>
                    <td className="px-5 py-3 text-right text-base font-mono font-bold text-brand-600">
                      {formatCurrency(poData.total_amount, poData.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
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
              <DetailRow label="Tiền tệ" value={poData.currency} />
              <DetailRow
                label="Cập nhật lần cuối"
                value={formatRelativeTime(poData.updated_at)}
              />
            </dl>
            {poData.notes && (
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-500 mb-1">Ghi chú</p>
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
            {wfData.steps.length > 0 ? (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-3 top-3 bottom-3 w-px bg-slate-200" />

                <div className="space-y-4">
                  {/* Initiation */}
                  <TimelineStep
                    status="approved"
                    label="Tạo yêu cầu"
                    user={wfData.initiator?.full_name ?? '—'}
                    time={formatRelativeTime(wfData.created_at)}
                  />

                  {/* Steps */}
                  {wfData.steps.map((step) => {
                    const sc = STATUS_CONFIG[step.status];
                    return (
                      <TimelineStep
                        key={step.id}
                        status={step.status}
                        label={`Bước ${step.step_order} — ${sc?.label ?? step.status}`}
                        user={step.approver?.full_name ?? '—'}
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
  status: WorkflowStatus;
  label: string;
  user: string;
  time: string;
  comment?: string;
}) {
  const dotColor: Record<WorkflowStatus, string> = {
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
          dotColor[status]
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
