'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Calendar,
  CheckCircle2,
  Clock,
  FileEdit,
  FileText,
  Loader2,
  Package,
  PackageCheck,
  Send,
  ShoppingCart,
  Truck,
  User,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { ORDER_STATUS_META, type OrderStatusCode } from './SourcingFormDrawer';

/* ─────────── Types ─────────── */

export interface OrderItem {
  id?: number;
  sourcing_entry_id?: number | null;
  model?: string | null;
  product_name?: string | null;
  supplier_name?: string | null;
  qty?: number | null;
  cost_vnd?: number | null;
  tax_pct?: number | null;
  coefficient?: number | null;
  sale_unit_vnd?: number | null;
  sale_total_vnd?: number | null;
}

export interface OrderStatusHistoryEntry {
  status: OrderStatusCode;
  by_user_email?: string | null;
  at?: string | null;
  note?: string | null;
}

export interface SourcingOrderDetail {
  id: number;
  order_number: string;
  status: OrderStatusCode;
  customer_name?: string | null;
  customer_email?: string | null;
  assigned_to_email?: string | null;
  delivery_date?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
  order_date?: string | null;
  total_value_vnd?: number | null;
  subtotal_vnd?: number | null;
  shipping_fee_vnd?: number | null;
  tax_vnd_display?: number | null;
  discount_vnd?: number | null;
  items?: OrderItem[];
  status_history?: OrderStatusHistoryEntry[];
}

interface Props {
  orderId: number | null;
  onClose: () => void;
  onMutated?: () => void;
}

const TRANSITIONS: Record<OrderStatusCode, OrderStatusCode[]> = {
  draft: ['quoted', 'cancelled'],
  quoted: ['confirmed', 'cancelled'],
  confirmed: ['payment_requested', 'cancelled'],
  payment_requested: ['payment_approved', 'confirmed', 'cancelled'],
  payment_approved: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/**
 * PERM-1 — Mirror of backend `_SO_TRANSITION_ROLES` in
 * `backend/app/api/v1/sourcing.py`. Keep in sync — backend is the
 * source of truth; this is purely for hiding buttons the actor can't use.
 *
 *   draft → quoted                       : sales, procurement, manager, admin
 *   quoted → confirmed                   : sales, manager, admin
 *   payment_requested → payment_approved : accountant, manager, admin
 *   payment_approved → shipped           : warehouse, manager, admin
 *   shipped → delivered                  : warehouse, sales, manager, admin
 *   * → cancelled                        : manager, admin only
 *
 * (confirmed → payment_requested has its own dedicated endpoint with its own
 *  role list — sales/manager/admin — handled via the "Đề xuất TT" button.)
 */
const TRANSITION_ROLES: Partial<Record<`${OrderStatusCode}->${OrderStatusCode}`, string[]>> = {
  'draft->quoted':                        ['sales', 'procurement', 'manager', 'admin'],
  'quoted->confirmed':                    ['sales', 'manager', 'admin'],
  'confirmed->payment_requested':         ['sales', 'manager', 'admin'],
  'payment_requested->payment_approved':  ['accountant', 'manager', 'admin'],
  'payment_approved->shipped':            ['warehouse', 'manager', 'admin'],
  'shipped->delivered':                   ['warehouse', 'sales', 'manager', 'admin'],
};
const CANCEL_ROLES: string[] = ['manager', 'admin'];

function canPerformTransition(
  role: string | null | undefined,
  from: OrderStatusCode,
  to: OrderStatusCode,
): boolean {
  const r = (role || '').toLowerCase();
  // admin can always act; viewer never can.
  if (r === 'viewer') return false;
  if (to === 'cancelled') return CANCEL_ROLES.includes(r);
  const allowed = TRANSITION_ROLES[`${from}->${to}`];
  if (!allowed) return r === 'admin' || r === 'manager'; // fail-closed default
  return allowed.includes(r);
}

/* ─────────── Helpers ─────────── */

function fmtVnd(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return String(Math.round(v).toLocaleString('vi-VN')) + ' ₫';
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

/* ─────────── Main Drawer ─────────── */

export function SourcingOrderDetailDrawer({ orderId, onClose, onMutated }: Props) {
  const [actionNote, setActionNote] = useState('');
  const [showCancelInput, setShowCancelInput] = useState(false);
  const { user } = useAuth();
  const actorRole = (user?.role || '').toLowerCase();

  const orderQ = useQuery<SourcingOrderDetail>({
    queryKey: ['sourcing-order', orderId],
    enabled: orderId != null,
    queryFn: async () => {
      // Backend returns { data: { order: {...}, status_history: [...] } }
      // and persists `line_items` (not `items`). Normalize to a flat shape.
      const res = (await api.get('/api/v1/sourcing/orders/' + orderId)) as {
        data: { order: any; status_history?: OrderStatusHistoryEntry[] };
      };
      const order = res.data?.order || {};
      const items: OrderItem[] = order.line_items ?? order.items ?? [];
      return {
        ...order,
        items,
        status_history: res.data?.status_history || [],
      } as SourcingOrderDetail;
    },
  });

  const order = orderQ.data;

  const transitionMut = useMutation({
    mutationFn: async (vars: { next: OrderStatusCode; note?: string }) => {
      if (!order?.id) throw new Error('Không có đơn');
      const res = (await api.patch(
        '/api/v1/sourcing/orders/' + order.id + '/status',
        { new_status: vars.next, note: vars.note },
      )) as { data: SourcingOrderDetail };
      return res.data;
    },
    onSuccess: (_data, vars) => {
      toast.success('Đã chuyển sang: ' + ORDER_STATUS_META[vars.next].label);
      setActionNote('');
      setShowCancelInput(false);
      orderQ.refetch();
      onMutated?.();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || 'Chuyển trạng thái thất bại');
    },
  });

  const proposePaymentMut = useMutation({
    mutationFn: async () => {
      if (!order?.id) throw new Error('Không có đơn');
      const supplier = order.items?.[0]?.supplier_name;
      const res = (await api.post('/api/v1/sourcing/orders/' + order.id + '/payment-request', {
        payment_method: 'bank_transfer',
        beneficiary_name: supplier,
        description:
          'Thanh toán đơn ' +
          order.order_number +
          (supplier ? ' cho NCC ' + supplier : ''),
      })) as { data: unknown };
      return res.data;
    },
    onSuccess: () => {
      toast.success('Đã đề xuất thanh toán tới kế toán');
      orderQ.refetch();
      onMutated?.();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || 'Đề xuất TT thất bại');
    },
  });

  // V1 security fix (Thang 2026-06-13): GET /quote-pdf is read-only and 404s
  // when no PDF exists. On 404 we POST /quote-pdf/regenerate (only allowed
  // for sales/manager/admin/procurement/director — viewer/staff/accountant
  // get 403). On success the file is opened.
  const openPdf = async () => {
    if (!order?.id || typeof window === 'undefined') return;
    const pdfUrl = '/api/v1/sourcing/orders/' + order.id + '/quote-pdf';
    try {
      const probe = await fetch(pdfUrl, { method: 'GET', credentials: 'include' });
      if (probe.ok) {
        window.open(pdfUrl, '_blank', 'noopener');
        return;
      }
      if (probe.status === 404) {
        await api.post(pdfUrl + '/regenerate', {});
        window.open(pdfUrl, '_blank', 'noopener');
        orderQ.refetch();
        return;
      }
      toast.error('Không tải được PDF (HTTP ' + probe.status + ')');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) {
        toast.error('Bạn không có quyền tạo lại PDF báo giá.');
      } else {
        toast.error(err?.response?.data?.detail || err?.message || 'Mở PDF thất bại');
      }
    }
  };

  const validNext = useMemo<OrderStatusCode[]>(() => {
    if (!order?.status) return [];
    const all = TRANSITIONS[order.status] || [];
    // PERM-1: hide transitions the actor's role can't perform server-side.
    return all.filter((next) => canPerformTransition(actorRole, order.status, next));
  }, [order?.status, actorRole]);

  // PERM-1: cancel button visibility tracks _SO_CANCEL_ROLES.
  const canCancel = useMemo<boolean>(() => {
    if (!order?.status) return false;
    if (order.status === 'cancelled' || order.status === 'delivered') return false;
    return CANCEL_ROLES.includes(actorRole);
  }, [order?.status, actorRole]);

  return (
    <div className="fixed inset-0 z-[120] flex justify-end">
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
        className="relative w-full max-w-[900px] bg-slate-50 h-full overflow-y-auto shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─────────── Sticky Header ─────────── */}
        <div className="sticky top-0 z-20 bg-white text-slate-900 border-b border-slate-200 px-7 py-5">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <ShoppingCart className="h-7 w-7 text-white" strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Chi tiết đơn hàng
              </div>
              <h2 className="mt-1 text-[26px] font-bold tracking-tight text-slate-900 truncate">
                {order?.order_number || (orderQ.isLoading ? 'Đang tải…' : '—')}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {order?.status && (() => {
                  const meta = ORDER_STATUS_META[order.status];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md text-xs font-bold ring-1 px-2 py-0.5',
                        meta.badgeClass,
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                  );
                })()}
                {order?.customer_name && (
                  <span className="inline-flex items-center gap-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200 px-2 py-0.5">
                    <User className="h-3 w-3" />
                    {order.customer_name}
                  </span>
                )}
                {order?.order_date && (
                  <span className="inline-flex items-center gap-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200 px-2 py-0.5">
                    <Calendar className="h-3 w-3" />
                    {fmtDateTime(order.order_date)}
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
          {orderQ.isLoading && (
            <div className="flex items-center justify-center py-20 text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}

          {orderQ.isError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-start gap-2.5">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <span>Không tải được đơn hàng.</span>
            </div>
          )}

          {order && (
            <>
              {/* Summary card */}
              <SectionCard icon={<FileText className="h-5 w-5" />} title="Tổng quan đơn">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <SummaryField label="Khách hàng" value={order.customer_name} />
                  <SummaryField label="Email khách" value={order.customer_email} mono />
                  <SummaryField label="Sale phụ trách" value={shortName(order.assigned_to_email)} />
                  <SummaryField label="Ngày tạo" value={fmtDateTime(order.order_date)} />
                  <SummaryField label="Ngày giao dự kiến" value={fmtDateTime(order.delivery_date)} />
                  <SummaryField label="Điều khoản TT" value={order.payment_terms} />
                </div>

                <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <TotalBox label="Subtotal" value={order.subtotal_vnd ?? order.total_value_vnd} />
                  <TotalBox label="Ship" value={order.shipping_fee_vnd} subdued />
                  <TotalBox label="VAT (thông tin)" value={order.tax_vnd_display} subdued />
                  <TotalBox label="Tổng đơn" value={order.total_value_vnd} highlight />
                </div>
              </SectionCard>

              {/* Items */}
              <SectionCard
                icon={<Package className="h-5 w-5" />}
                title="Danh sách hàng"
                subtitle={(order.items?.length ?? 0) + ' dòng'}
              >
                <div className="overflow-x-auto -mx-2">
                  <table className="min-w-full text-[14px]">
                    <thead className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-2 py-2">Model</th>
                        <th className="text-left px-2 py-2">Sản phẩm</th>
                        <th className="text-left px-2 py-2">NCC</th>
                        <th className="text-right px-2 py-2">SL</th>
                        <th className="text-right px-2 py-2">Đơn giá</th>
                        <th className="text-right px-2 py-2">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(order.items || []).map((item, idx) => {
                        const qty = item.qty || 0;
                        const unit = item.sale_unit_vnd || 0;
                        const total = item.sale_total_vnd ?? unit * qty;
                        return (
                          <tr
                            key={String(item.id ?? idx)}
                            className="border-b border-slate-100 hover:bg-slate-50"
                          >
                            <td className="px-2 py-3 font-mono text-slate-800">
                              {item.model || '—'}
                            </td>
                            <td className="px-2 py-3 text-slate-700 max-w-[240px] truncate">
                              {item.product_name || '—'}
                            </td>
                            <td className="px-2 py-3 text-slate-600">
                              {item.supplier_name || '—'}
                            </td>
                            <td className="px-2 py-3 text-right tabular-nums font-semibold text-slate-800">
                              {qty.toLocaleString('vi-VN')}
                            </td>
                            <td className="px-2 py-3 text-right tabular-nums text-slate-700">
                              {fmtVnd(unit)}
                            </td>
                            <td className="px-2 py-3 text-right tabular-nums font-bold text-slate-900">
                              {fmtVnd(total)}
                            </td>
                          </tr>
                        );
                      })}
                      {(!order.items || order.items.length === 0) && (
                        <tr>
                          <td colSpan={6} className="px-2 py-6 text-center text-slate-500">
                            Chưa có dòng hàng.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              {/* Status timeline */}
              <SectionCard icon={<Clock className="h-5 w-5" />} title="Lịch sử trạng thái">
                <StatusTimeline history={order.status_history || []} currentStatus={order.status} />
              </SectionCard>

              {/* Cancel note input */}
              {showCancelInput && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 space-y-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-rose-700">
                    Lý do huỷ (bắt buộc)
                  </label>
                  <textarea
                    rows={3}
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder="Khách đổi ý / sai NCC / …"
                    className="w-full rounded-lg border border-rose-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!actionNote.trim()) {
                          toast.error('Cần điền lý do huỷ');
                          return;
                        }
                        transitionMut.mutate({ next: 'cancelled', note: actionNote.trim() });
                      }}
                      disabled={transitionMut.isPending}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" />
                      Xác nhận huỷ
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCancelInput(false);
                        setActionNote('');
                      }}
                      className="px-4 py-2 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-100"
                    >
                      Bỏ qua
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ─────────── Sticky Footer — actions ─────────── */}
        {order && (
          <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white px-7 py-4 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
                >
                  <FileText className="h-4 w-4" />
                  PDF báo giá
                </button>
                {!showCancelInput && canCancel && (
                  <button
                    type="button"
                    onClick={() => setShowCancelInput(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 ring-1 ring-rose-200"
                  >
                    <XCircle className="h-4 w-4" />
                    Huỷ đơn
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {validNext
                  .filter((s) => s !== 'cancelled')
                  .map((next) => {
                    const meta = ORDER_STATUS_META[next];
                    const Icon = meta.icon;
                    // Confirmed -> Payment Requested uses dedicated endpoint
                    const isProposePayment =
                      order.status === 'confirmed' && next === 'payment_requested';
                    return (
                      <button
                        key={next}
                        type="button"
                        onClick={() => {
                          if (isProposePayment) {
                            proposePaymentMut.mutate();
                          } else {
                            transitionMut.mutate({ next });
                          }
                        }}
                        disabled={transitionMut.isPending || proposePaymentMut.isPending}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 disabled:opacity-50 shadow-sm"
                      >
                        {transitionMut.isPending || proposePaymentMut.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isProposePayment ? (
                          <Send className="h-4 w-4" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                        {isProposePayment ? 'Đề xuất TT kế toán' : 'Chuyển: ' + meta.label}
                        <ArrowRight className="h-3.5 w-3.5 opacity-70" />
                      </button>
                    );
                  })}
                {validNext.length === 0 && (
                  <span className="text-sm text-slate-500 italic">
                    {order.status === 'delivered' || order.status === 'cancelled'
                      ? 'Đơn đã ở trạng thái kết thúc.'
                      : 'Role của bạn không có quyền chuyển trạng thái đơn này.'}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
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
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100">
        <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold tracking-tight text-slate-900">{title}</h3>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </header>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

function SummaryField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      <span
        className={cn(
          'text-[15px] text-slate-900 font-semibold',
          mono && 'font-mono text-sm',
        )}
      >
        {value || '—'}
      </span>
    </div>
  );
}

function TotalBox({
  label,
  value,
  highlight,
  subdued,
}: {
  label: string;
  value: number | null | undefined;
  highlight?: boolean;
  subdued?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg p-3 ring-1',
        highlight && 'bg-brand-50 ring-brand-200',
        !highlight && !subdued && 'bg-slate-50 ring-slate-200',
        subdued && 'bg-white ring-slate-100',
      )}
    >
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div
        className={cn(
          'text-[17px] font-bold tabular-nums',
          highlight ? 'text-brand-700' : 'text-slate-900',
        )}
      >
        {fmtVnd(value)}
      </div>
    </div>
  );
}

function StatusTimeline({
  history,
  currentStatus,
}: {
  history: OrderStatusHistoryEntry[];
  currentStatus: OrderStatusCode;
}) {
  const items = history.length > 0 ? history : [{ status: currentStatus }];
  return (
    <ol className="relative space-y-5 pl-6">
      <span className="absolute left-[11px] top-2 bottom-2 w-px bg-slate-200" />
      {items.map((h, idx) => {
        const meta = ORDER_STATUS_META[h.status] || ORDER_STATUS_META.draft;
        const Icon = meta.icon;
        const isLast = idx === items.length - 1;
        return (
          <li key={idx} className="relative">
            <span
              className={cn(
                'absolute -left-6 top-0 h-6 w-6 rounded-full ring-2 ring-white flex items-center justify-center',
                meta.dotClass,
                'text-white',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn('text-[15px] font-bold', isLast ? 'text-slate-900' : 'text-slate-700')}>
                {meta.label}
              </span>
              {h.at && (
                <>
                  <span className="text-xs text-slate-500">{fmtDateTime(h.at)}</span>
                  <span className="text-xs text-slate-400">· {relativeTime(h.at)}</span>
                </>
              )}
            </div>
            {h.by_user_email && (
              <div className="text-xs text-slate-500 mt-0.5">
                Bởi{' '}
                <span className="font-semibold text-slate-700">
                  {shortName(h.by_user_email)}
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

const _suppressUnused = [BadgeCheck, FileEdit, PackageCheck, Truck, CheckCircle2, Wallet];
