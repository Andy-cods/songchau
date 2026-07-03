'use client';

/**
 * PaymentApprovalDrawer
 * ─────────────────────
 * Right-side slide-in drawer for /payment-approvals.
 * Loads a single payment_request via GET /api/v1/payment-requests/{id}
 * and lets accountant/admin Duyệt / Từ chối / Đánh dấu đã chi.
 *
 * Palette restraint (per Thang 2026-05-23):
 *   slate base + brand accent header + functional emerald/amber/rose.
 *   No gradient stripes, no rainbow tiles.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  FileText,
  History,
  Landmark,
  Loader2,
  Package,
  ReceiptText,
  Send,
  User,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';

import { api } from '@/lib/api';
import { cn, withToken } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { StatusBadge } from '@/components/shared/status-badge';

/* ─────────── Types ─────────── */

export type PaymentRequestStatus = 'pending' | 'approved' | 'rejected' | 'paid';

interface PaymentLineItem {
  model?: string | null;
  product_name?: string | null;
  supplier_name?: string | null;
  qty?: number | null;
  sale_unit_vnd?: number | null;
  sale_total_vnd?: number | null;
}

interface OrderStatusHistoryEntry {
  status?: string | null;
  by_user_email?: string | null;
  at?: string | null;
  note?: string | null;
}

interface WorkflowHistoryEntry {
  action?: string | null;
  by_user_email?: string | null;
  at?: string | null;
  note?: string | null;
}

export interface PaymentRequestDetail {
  id: number;
  pr_number?: string | null;
  status: PaymentRequestStatus;
  amount_vnd?: number | null;
  amount?: number | null;
  currency?: string | null;
  payment_method?: string | null;
  beneficiary_name?: string | null;
  beneficiary_bank?: string | null;
  beneficiary_account?: string | null;
  note?: string | null;
  description?: string | null;
  requester_email?: string | null;
  requester_name?: string | null;
  created_at?: string | null;
  decision_at?: string | null;
  decided_by_email?: string | null;
  decision_note?: string | null;
  paid_at?: string | null;
  paid_by_email?: string | null;

  quote_pdf_url?: string | null;
  sourcing_order_id?: number | null;
  sourcing_order?: {
    id?: number | null;
    order_number?: string | null;
    customer_name?: string | null;
    total_value_vnd?: number | null;
    line_items?: PaymentLineItem[];
    items?: PaymentLineItem[];
    status_history?: OrderStatusHistoryEntry[];
  } | null;

  workflow_history?: WorkflowHistoryEntry[];
}

interface Props {
  paymentRequestId: number | null;
  onClose: () => void;
  onMutated?: () => void;
}

/* ─────────── Helpers ─────────── */

function fmtVnd(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Math.round(Number(v)).toLocaleString('vi-VN') + ' ₫';
}

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('vi-VN');
}

function relativeTime(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return sec + 's trước';
  const min = Math.round(sec / 60);
  if (min < 60) return min + ' phút trước';
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + ' giờ trước';
  const day = Math.round(hr / 24);
  return day + ' ngày trước';
}

function shortName(email: string | null | undefined): string {
  if (!email) return '—';
  const name = email.split('@')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Chuyển khoản',
  cash: 'Tiền mặt',
  credit_card: 'Thẻ tín dụng',
  letter_of_credit: 'L/C',
};

const REJECT_REASONS = [
  'Sai thông tin tài khoản',
  'Vượt hạn mức',
  'Thiếu chứng từ',
  'Đơn hàng chưa xác nhận',
  'Khác',
];

const STATUS_META: Record<
  PaymentRequestStatus,
  { label: string; variant: 'warning' | 'success' | 'danger' | 'info' }
> = {
  pending: { label: 'Chờ duyệt', variant: 'warning' },
  approved: { label: 'Đã duyệt', variant: 'success' },
  rejected: { label: 'Đã từ chối', variant: 'danger' },
  paid: { label: 'Đã chi', variant: 'info' },
};

/* ─────────── Main Drawer ─────────── */

export function PaymentApprovalDrawer({
  paymentRequestId,
  onClose,
  onMutated,
}: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const actorRole = (user?.role || '').toLowerCase();
  const canDecide =
    actorRole === 'accountant' ||
    actorRole === 'admin' ||
    actorRole === 'manager';

  const [approveNote, setApproveNote] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0]);
  const [rejectNote, setRejectNote] = useState('');
  const [showItemsAll, setShowItemsAll] = useState(false);

  const prQuery = useQuery<PaymentRequestDetail>({
    queryKey: ['payment-request', paymentRequestId],
    enabled: paymentRequestId != null,
    queryFn: async () => {
      const res = (await api.get(
        '/api/v1/payment-requests/' + paymentRequestId,
      )) as any;
      // Accept both { data: {...} } and flat shape.
      return (res?.data ?? res) as PaymentRequestDetail;
    },
  });

  const pr = prQuery.data;

  const invalidateRelated = () => {
    queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
    queryClient.invalidateQueries({ queryKey: ['payment-request'] });
    queryClient.invalidateQueries({ queryKey: ['sourcing-orders'] });
    queryClient.invalidateQueries({ queryKey: ['sourcing-order'] });
    onMutated?.();
  };

  const approveMut = useMutation({
    mutationFn: async (note?: string) => {
      if (!pr?.id) throw new Error('Không có yêu cầu');
      return api.post('/api/v1/payment-requests/' + pr.id + '/approve', {
        note: note || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Đã duyệt thanh toán');
      setApproveNote('');
      invalidateRelated();
      prQuery.refetch();
    },
    onError: (err: any) =>
      toast.error(err?.detail || err?.message || 'Không thể duyệt yêu cầu'),
  });

  const rejectMut = useMutation({
    mutationFn: async (vars: { reason: string; note: string }) => {
      if (!pr?.id) throw new Error('Không có yêu cầu');
      const combined = vars.note
        ? vars.reason + ' — ' + vars.note
        : vars.reason;
      return api.post('/api/v1/payment-requests/' + pr.id + '/reject', {
        reason: combined,
      });
    },
    onSuccess: () => {
      toast.success('Đã từ chối yêu cầu');
      setShowRejectForm(false);
      setRejectNote('');
      invalidateRelated();
      prQuery.refetch();
    },
    onError: (err: any) =>
      toast.error(err?.detail || err?.message || 'Không thể từ chối yêu cầu'),
  });

  const markPaidMut = useMutation({
    mutationFn: async () => {
      if (!pr?.id) throw new Error('Không có yêu cầu');
      return api.post('/api/v1/payment-requests/' + pr.id + '/mark-paid');
    },
    onSuccess: () => {
      toast.success('Đã đánh dấu đã chi');
      invalidateRelated();
      prQuery.refetch();
    },
    onError: (err: any) =>
      toast.error(err?.detail || err?.message || 'Không thể đánh dấu đã chi'),
  });

  const lineItems = useMemo<PaymentLineItem[]>(() => {
    const so = pr?.sourcing_order;
    return so?.line_items ?? so?.items ?? [];
  }, [pr]);

  const visibleItems = showItemsAll ? lineItems : lineItems.slice(0, 3);
  const moreItemsCount = lineItems.length - visibleItems.length;

  const amount = pr?.amount_vnd ?? pr?.amount ?? null;
  const prNumber = pr?.pr_number || (pr?.id ? 'PR-' + pr.id : '—');
  const statusMeta = pr ? STATUS_META[pr.status] : STATUS_META.pending;

  // V1 security fix (Thang 2026-06-13): GET /quote-pdf is now read-only and
  // 404s when no PDF exists. Accountants cannot regenerate (POST is restricted
  // to sales/manager/admin/procurement/director) — but in the payment-approval
  // flow the order is already at status >= payment_requested, so a PDF should
  // have been rendered by sales before reaching this drawer. If still missing
  // we surface a clear error instead of silently opening a 404.
  const openPdf = async () => {
    if (typeof window === 'undefined') return;
    if (pr?.quote_pdf_url) {
      const url = pr.quote_pdf_url.startsWith('http')
        ? pr.quote_pdf_url
        : withToken(pr.quote_pdf_url);
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (!pr?.sourcing_order_id) return;
    const pdfUrl = '/api/v1/sourcing/orders/' + pr.sourcing_order_id + '/quote-pdf';
    try {
      const probe = await fetch(pdfUrl, { method: 'GET', credentials: 'include' });
      if (probe.ok) {
        window.open(withToken(pdfUrl), '_blank', 'noopener');
        return;
      }
      if (probe.status === 404) {
        toast.error(
          'PDF báo giá chưa được tạo. Liên hệ Sale phụ trách bấm "Tạo lại PDF" trên đơn.',
        );
        return;
      }
      toast.error('Không tải được PDF (HTTP ' + probe.status + ')');
    } catch (err: any) {
      toast.error(err?.message || 'Mở PDF thất bại');
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm cursor-default"
        aria-label="Đóng"
      />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
        className="relative w-full max-w-[860px] bg-slate-50 h-full overflow-y-auto shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─────────── Sticky Header ─────────── */}
        <div className="sticky top-0 z-20 bg-white text-slate-900 border-b border-slate-200 px-7 py-5">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <ReceiptText className="h-7 w-7 text-white" strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Đề xuất thanh toán
              </div>
              <h2 className="mt-1 text-[26px] font-bold tracking-tight text-slate-900 truncate">
                {prNumber}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {pr && (
                  <StatusBadge
                    label={statusMeta.label}
                    variant={statusMeta.variant}
                    pulse={pr.status === 'pending'}
                    size="md"
                  />
                )}
                {pr?.sourcing_order?.order_number && (
                  <span className="inline-flex items-center gap-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200 px-2 py-0.5">
                    <Package className="h-3 w-3" />
                    {pr.sourcing_order.order_number}
                  </span>
                )}
                {pr?.sourcing_order?.customer_name && (
                  <span className="inline-flex items-center gap-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200 px-2 py-0.5">
                    <User className="h-3 w-3" />
                    {pr.sourcing_order.customer_name}
                  </span>
                )}
                {pr?.created_at && (
                  <span className="inline-flex items-center gap-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200 px-2 py-0.5">
                    <Calendar className="h-3 w-3" />
                    {fmtDateTime(pr.created_at)}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-10 w-10 rounded-lg bg-slate-100 hover:bg-slate-200 ring-1 ring-slate-200 flex items-center justify-center transition-colors"
              aria-label="Đóng"
            >
              <X className="h-5 w-5 text-slate-600" />
            </button>
          </div>
        </div>

        {/* ─────────── Body ─────────── */}
        <div className="flex-1 p-7 space-y-5">
          {prQuery.isLoading && (
            <div className="flex items-center justify-center py-20 text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}

          {prQuery.isError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-start gap-2.5">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <span>Không tải được yêu cầu thanh toán.</span>
            </div>
          )}

          {pr && (
            <>
              {/* Amount hero */}
              <div className="rounded-xl border border-brand-200 bg-brand-50 px-5 py-4">
                <div className="text-xs font-bold uppercase tracking-wider text-brand-600">
                  Số tiền đề xuất
                </div>
                <div className="mt-1 text-[32px] font-bold tabular-nums text-slate-900">
                  {fmtVnd(amount)}
                </div>
                {pr.description && (
                  <div className="mt-1 text-sm text-slate-600">
                    {pr.description}
                  </div>
                )}
              </div>

              {/* Section 1: Đơn hàng */}
              <SectionCard
                icon={<Package className="h-5 w-5" />}
                title="Đơn hàng"
                subtitle={
                  pr.sourcing_order?.order_number
                    ? 'Liên kết tới đơn ' + pr.sourcing_order.order_number
                    : 'Không có đơn liên kết'
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Mã đơn"
                    value={pr.sourcing_order?.order_number}
                    mono
                  />
                  <Field
                    label="Khách hàng"
                    value={pr.sourcing_order?.customer_name}
                  />
                  <Field
                    label="Tổng giá trị đơn"
                    value={fmtVnd(pr.sourcing_order?.total_value_vnd)}
                  />
                  <Field
                    label="Số dòng hàng"
                    value={String(lineItems.length || 0) + ' dòng'}
                  />
                </div>

                {lineItems.length > 0 && (
                  <div className="mt-4 overflow-x-auto -mx-2">
                    <table className="min-w-full text-[14px]">
                      <thead className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-2 py-2">Model</th>
                          <th className="text-left px-2 py-2">Sản phẩm</th>
                          <th className="text-left px-2 py-2">NCC</th>
                          <th className="text-right px-2 py-2">SL</th>
                          <th className="text-right px-2 py-2">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleItems.map((item, idx) => {
                          const qty = Number(item.qty) || 0;
                          const unit = Number(item.sale_unit_vnd) || 0;
                          const total =
                            Number(item.sale_total_vnd) || unit * qty;
                          return (
                            <tr
                              key={idx}
                              className="border-b border-slate-100 hover:bg-slate-50"
                            >
                              <td className="px-2 py-2.5 font-mono text-slate-800 text-[13px]">
                                {item.model || '—'}
                              </td>
                              <td className="px-2 py-2.5 text-slate-700 max-w-[240px] truncate">
                                {item.product_name || '—'}
                              </td>
                              <td className="px-2 py-2.5 text-slate-600">
                                {item.supplier_name || '—'}
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-slate-800">
                                {qty.toLocaleString('vi-VN')}
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums font-bold text-slate-900">
                                {fmtVnd(total)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {moreItemsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowItemsAll(true)}
                        className="mt-2 text-xs font-semibold text-brand-700 hover:text-brand-800"
                      >
                        Xem thêm {moreItemsCount} dòng…
                      </button>
                    )}
                    {showItemsAll && lineItems.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setShowItemsAll(false)}
                        className="mt-2 text-xs font-semibold text-slate-500 hover:text-slate-700"
                      >
                        Thu gọn
                      </button>
                    )}
                  </div>
                )}
              </SectionCard>

              {/* Section 2: Đề xuất */}
              <SectionCard
                icon={<Wallet className="h-5 w-5" />}
                title="Đề xuất từ sales"
                subtitle={
                  pr.requester_email
                    ? 'Người đề xuất: ' + shortName(pr.requester_email)
                    : undefined
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Người thụ hưởng"
                    value={pr.beneficiary_name}
                    icon={<User className="h-3.5 w-3.5 text-slate-400" />}
                  />
                  <Field
                    label="Hình thức TT"
                    value={
                      pr.payment_method
                        ? PAYMENT_METHOD_LABELS[pr.payment_method] ??
                          pr.payment_method
                        : '—'
                    }
                    icon={<CreditCard className="h-3.5 w-3.5 text-slate-400" />}
                  />
                  <Field
                    label="Ngân hàng"
                    value={pr.beneficiary_bank}
                    icon={<Landmark className="h-3.5 w-3.5 text-slate-400" />}
                  />
                  <Field
                    label="Số tài khoản"
                    value={pr.beneficiary_account}
                    mono
                    icon={<Building2 className="h-3.5 w-3.5 text-slate-400" />}
                  />
                </div>

                {pr.note && (
                  <div className="mt-4 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3.5 py-2.5">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Ghi chú từ sales
                    </div>
                    <p className="text-[15px] text-slate-700 whitespace-pre-wrap">
                      {pr.note}
                    </p>
                  </div>
                )}
              </SectionCard>

              {/* Section 3: Lịch sử order */}
              <SectionCard
                icon={<History className="h-5 w-5" />}
                title="Lịch sử"
                subtitle="Vết duyệt và trạng thái đơn"
              >
                <HistoryTimeline
                  workflowHistory={pr.workflow_history}
                  orderHistory={pr.sourcing_order?.status_history}
                  decisionAt={pr.decision_at}
                  decidedBy={pr.decided_by_email}
                  decisionNote={pr.decision_note}
                  decisionStatus={pr.status}
                  paidAt={pr.paid_at}
                  paidBy={pr.paid_by_email}
                />
              </SectionCard>

              {/* Section 4: Quote PDF */}
              <SectionCard
                icon={<FileText className="h-5 w-5" />}
                title="Quote PDF"
                subtitle="Xem báo giá liên kết"
              >
                <button
                  type="button"
                  onClick={openPdf}
                  disabled={!pr.quote_pdf_url && !pr.sourcing_order_id}
                  className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <FileText className="h-4 w-4" />
                  Xem PDF
                  <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                </button>
                {!pr.quote_pdf_url && !pr.sourcing_order_id && (
                  <p className="mt-2 text-xs text-slate-500">
                    Không có PDF báo giá đính kèm.
                  </p>
                )}
              </SectionCard>

              {/* Section 5: Decision panel */}
              {pr.status === 'pending' && canDecide && (
                <SectionCard
                  icon={<Send className="h-5 w-5 text-brand-600" />}
                  title="Quyết định"
                  subtitle="Ghi chú duyệt sẽ lưu vào lịch sử"
                  highlight
                >
                  {!showRejectForm ? (
                    <>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                        Ghi chú duyệt (tuỳ chọn)
                      </label>
                      <textarea
                        rows={3}
                        value={approveNote}
                        onChange={(e) => setApproveNote(e.target.value)}
                        placeholder="VD: OK chi NCC ABC, đã đối chiếu công nợ…"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 resize-none"
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            approveMut.mutate(approveNote.trim() || undefined)
                          }
                          disabled={approveMut.isPending}
                          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[15px] font-bold disabled:opacity-50 shadow-sm"
                        >
                          {approveMut.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          Duyệt thanh toán
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowRejectForm(true)}
                          disabled={
                            approveMut.isPending || rejectMut.isPending
                          }
                          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[15px] font-bold disabled:opacity-50 shadow-sm"
                        >
                          <X className="h-4 w-4" />
                          Từ chối
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <label className="block text-xs font-bold uppercase tracking-wider text-rose-700">
                        Lý do từ chối
                      </label>
                      <select
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        className="w-full h-11 rounded-lg border border-rose-200 bg-white px-3 text-[15px] text-slate-900 focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                      >
                        {REJECT_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <textarea
                        rows={3}
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Mô tả chi tiết (bắt buộc)"
                        className="w-full rounded-lg border border-rose-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 resize-none"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!rejectNote.trim()) {
                              toast.error('Cần điền mô tả lý do từ chối');
                              return;
                            }
                            rejectMut.mutate({
                              reason: rejectReason,
                              note: rejectNote.trim(),
                            });
                          }}
                          disabled={rejectMut.isPending}
                          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[15px] font-bold disabled:opacity-50 shadow-sm"
                        >
                          {rejectMut.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                          Xác nhận từ chối
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowRejectForm(false);
                            setRejectNote('');
                          }}
                          disabled={rejectMut.isPending}
                          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg text-slate-700 hover:bg-slate-100 text-[15px] font-semibold"
                        >
                          Bỏ qua
                        </button>
                      </div>
                    </div>
                  )}
                </SectionCard>
              )}

              {/* Mark-paid panel (only when approved) */}
              {pr.status === 'approved' && canDecide && (
                <SectionCard
                  icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                  title="Đánh dấu đã chi"
                  subtitle="Sau khi đã chuyển tiền thực tế"
                  highlight
                >
                  <button
                    type="button"
                    onClick={() => markPaidMut.mutate()}
                    disabled={markPaidMut.isPending}
                    className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[15px] font-bold disabled:opacity-50 shadow-sm"
                  >
                    {markPaidMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Đánh dấu đã chi
                  </button>
                </SectionCard>
              )}

              {/* Decision-already-made info panel */}
              {pr.status !== 'pending' && (
                <div
                  className={cn(
                    'rounded-xl border px-4 py-3.5 text-sm',
                    pr.status === 'approved' &&
                      'border-emerald-200 bg-emerald-50/60 text-emerald-800',
                    pr.status === 'rejected' &&
                      'border-rose-200 bg-rose-50/60 text-rose-800',
                    pr.status === 'paid' &&
                      'border-sky-200 bg-sky-50/60 text-sky-800',
                  )}
                >
                  <div className="text-xs font-bold uppercase tracking-wider mb-1 opacity-80">
                    {pr.status === 'paid'
                      ? 'Đã chi'
                      : pr.status === 'approved'
                        ? 'Đã duyệt'
                        : 'Đã từ chối'}
                  </div>
                  <div className="text-[15px]">
                    {pr.status === 'paid' && pr.paid_at && (
                      <>
                        Bởi{' '}
                        <span className="font-semibold">
                          {shortName(pr.paid_by_email)}
                        </span>{' '}
                        · {fmtDateTime(pr.paid_at)}
                      </>
                    )}
                    {pr.status !== 'paid' && pr.decision_at && (
                      <>
                        Bởi{' '}
                        <span className="font-semibold">
                          {shortName(pr.decided_by_email)}
                        </span>{' '}
                        · {fmtDateTime(pr.decision_at)}
                      </>
                    )}
                  </div>
                  {pr.decision_note && pr.status !== 'paid' && (
                    <div className="mt-2 rounded-md bg-white/70 ring-1 ring-current/10 px-3 py-2 text-[14px] text-slate-700">
                      {pr.decision_note}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </motion.aside>
    </div>
  );
}

/* ─────────── Sub-components ─────────── */

function SectionCard({
  icon,
  title,
  subtitle,
  children,
  highlight,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
  highlight?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border bg-white shadow-sm',
        highlight ? 'border-brand-200' : 'border-slate-200',
      )}
    >
      <header className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100">
        <div
          className={cn(
            'h-10 w-10 rounded-lg flex items-center justify-center shrink-0',
            highlight
              ? 'bg-brand-50 text-brand-700'
              : 'bg-slate-100 text-slate-600',
          )}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold tracking-tight text-slate-900">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          )}
        </div>
      </header>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  icon,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'text-[15px] text-slate-900 font-semibold',
          mono && 'font-mono text-[14px]',
        )}
      >
        {value || '—'}
      </span>
    </div>
  );
}

function HistoryTimeline({
  workflowHistory,
  orderHistory,
  decisionAt,
  decidedBy,
  decisionNote,
  decisionStatus,
  paidAt,
  paidBy,
}: {
  workflowHistory?: WorkflowHistoryEntry[];
  orderHistory?: OrderStatusHistoryEntry[];
  decisionAt?: string | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
  decisionStatus: PaymentRequestStatus;
  paidAt?: string | null;
  paidBy?: string | null;
}) {
  // Prefer workflow_history if present; else fall back to order history.
  const rawEntries: { label: string; at?: string | null; by?: string | null; note?: string | null }[] = [];

  if (workflowHistory && workflowHistory.length > 0) {
    for (const w of workflowHistory) {
      rawEntries.push({
        label: w.action || '—',
        at: w.at,
        by: w.by_user_email,
        note: w.note,
      });
    }
  } else if (orderHistory && orderHistory.length > 0) {
    for (const h of orderHistory) {
      rawEntries.push({
        label: h.status || '—',
        at: h.at,
        by: h.by_user_email,
        note: h.note,
      });
    }
  }

  // Tack the decision/paid events onto the timeline if not already present.
  if (decisionStatus !== 'pending' && decisionAt) {
    rawEntries.push({
      label:
        decisionStatus === 'approved'
          ? 'Đã duyệt thanh toán'
          : decisionStatus === 'rejected'
            ? 'Đã từ chối'
            : 'Quyết định',
      at: decisionAt,
      by: decidedBy,
      note: decisionNote,
    });
  }
  if (paidAt) {
    rawEntries.push({
      label: 'Đã chi tiền',
      at: paidAt,
      by: paidBy,
    });
  }

  if (rawEntries.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic">
        Chưa có lịch sử ghi nhận.
      </div>
    );
  }

  return (
    <ol className="relative space-y-5 pl-6">
      <span className="absolute left-[11px] top-2 bottom-2 w-px bg-slate-200" />
      {rawEntries.map((h, idx) => {
        const isLast = idx === rawEntries.length - 1;
        return (
          <li key={idx} className="relative">
            <span
              className={cn(
                'absolute -left-6 top-0 h-6 w-6 rounded-full ring-2 ring-white flex items-center justify-center text-white',
                isLast ? 'bg-brand-600' : 'bg-slate-400',
              )}
            >
              <Clock className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span
                className={cn(
                  'text-[15px] font-bold',
                  isLast ? 'text-slate-900' : 'text-slate-700',
                )}
              >
                {h.label}
              </span>
              {h.at && (
                <>
                  <span className="text-xs text-slate-500">
                    {fmtDateTime(h.at)}
                  </span>
                  <span className="text-xs text-slate-400">
                    · {relativeTime(h.at)}
                  </span>
                </>
              )}
            </div>
            {h.by && (
              <div className="text-xs text-slate-500 mt-0.5">
                Bởi{' '}
                <span className="font-semibold text-slate-700">
                  {shortName(h.by)}
                </span>
              </div>
            )}
            {h.note && (
              <div className="mt-1 rounded-md bg-slate-50 ring-1 ring-slate-200 px-2.5 py-1.5 text-sm text-slate-700">
                {h.note}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
