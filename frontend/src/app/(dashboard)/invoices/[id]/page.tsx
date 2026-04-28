'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  Loader2,
  Mail,
  CreditCard,
  Building2,
  Calendar,
  Hash,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────

type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled';

interface InvoiceItem {
  id: number;
  description: string;
  bqms_code?: string;
  quantity: number;
  unit_price_vnd: number;
  total_vnd: number;
}

interface Payment {
  id: number;
  amount_vnd: number;
  payment_date: string;
  bank_ref?: string;
  note?: string;
}

interface Invoice {
  id: number;
  invoice_number: string;
  customer_name: string;
  customer_address?: string;
  customer_tax_code?: string;
  total_amount_vnd: number;
  paid_amount_vnd: number;
  status: InvoiceStatus;
  due_date?: string;
  issued_date: string;
  items: InvoiceItem[];
  payments: Payment[];
}

// ─── Status Config ──────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft:     { label: 'Nháp',                   className: 'bg-slate-100 text-slate-600' },
  sent:      { label: 'Đã gửi',                 className: 'bg-blue-100 text-blue-700' },
  partial:   { label: 'Thanh toán một phần',    className: 'bg-amber-100 text-amber-700' },
  paid:      { label: 'Đã thanh toán',           className: 'bg-green-100 text-green-700' },
  overdue:   { label: 'Quá hạn',               className: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Đã hủy',                className: 'bg-slate-100 text-slate-400' },
};

// ─── Helpers ────────────────────────────────────────────────────────

function formatVND(amount: number): string {
  return amount.toLocaleString('vi-VN') + '₫';
}

// ─── Payment Form ────────────────────────────────────────────────────

interface PaymentFormProps {
  onClose: () => void;
  onSubmit: (data: { amount_vnd: number; payment_date: string; bank_ref: string; note: string }) => void;
  isPending: boolean;
  remainingAmount: number;
}

function PaymentForm({ onClose, onSubmit, isPending, remainingAmount }: PaymentFormProps) {
  const [amount, setAmount] = useState(remainingAmount);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [bankRef, setBankRef] = useState('');
  const [note, setNote] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">Ghi nhận thanh toán</h3>
          <p className="text-xs text-slate-500 mt-0.5">Còn lại: {formatVND(remainingAmount)}</p>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Số tiền (VNĐ) <span className="text-red-500">*</span></label>
            <input
              type="number"
              min={1}
              max={remainingAmount}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Ngày thanh toán <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Mã tham chiếu ngân hàng</label>
            <input
              type="text"
              value={bankRef}
              onChange={(e) => setBankRef(e.target.value)}
              placeholder="VD: FT24123456789"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Ghi chú</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg transition-colors"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => onSubmit({ amount_vnd: amount, payment_date: paymentDate, bank_ref: bankRef, note })}
            disabled={isPending || amount <= 0}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            <CreditCard className="h-4 w-4" />
            Ghi nhận
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  const { data: invoice, isLoading, error } = useQuery<Invoice>({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/api/v1/invoices/${id}`),
    retry: false,
  });

  const sendEmailMutation = useMutation({
    mutationFn: () => api.post(`/api/v1/invoices/${id}/send-email`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      toast.success('Đã gửi hóa đơn qua email');
    },
    onError: (err: any) => toast.error(err?.detail ?? 'Lỗi gửi email'),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: (data: object) => api.post(`/api/v1/invoices/${id}/payments`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      setShowPaymentForm(false);
      toast.success('Đã ghi nhận thanh toán');
    },
    onError: (err: any) => toast.error(err?.detail ?? 'Lỗi ghi nhận thanh toán'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p className="text-sm">Không tìm thấy hóa đơn hoặc có lỗi xảy ra.</p>
        <Link href="/invoices" className="text-sm text-brand-600 mt-2 hover:underline">Quay lại danh sách</Link>
      </div>
    );
  }

  const sc = STATUS_CONFIG[invoice.status];
  const remaining = Math.max(0, invoice.total_amount_vnd - invoice.paid_amount_vnd);
  const paidPercent = invoice.total_amount_vnd > 0
    ? Math.min(100, (invoice.paid_amount_vnd / invoice.total_amount_vnd) * 100)
    : 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Link href="/invoices" className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500 mt-0.5">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-display font-bold text-slate-900">{invoice.invoice_number}</h2>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.className}`}>{sc.label}</span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {invoice.customer_name} · Phát hành {formatDate(invoice.issued_date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => sendEmailMutation.mutate()}
            disabled={sendEmailMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {sendEmailMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Gửi email
          </button>
          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
            <button
              onClick={() => setShowPaymentForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <CreditCard className="h-4 w-4" />
              Ghi nhận thanh toán
            </button>
          )}
        </div>
      </div>

      {/* Invoice Preview */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8 mb-6">
        {/* Invoice Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h3 className="text-2xl font-bold text-slate-900 font-display">HÓA ĐƠN BÁN HÀNG</h3>
            <p className="text-slate-500 text-sm mt-1">Song Châu Trading Co., Ltd.</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-mono font-bold text-brand-600">{invoice.invoice_number}</p>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1 justify-end">
              <Calendar className="h-3.5 w-3.5" />
              Ngày phát hành: {formatDate(invoice.issued_date)}
            </div>
            {invoice.due_date && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5 justify-end">
                <Calendar className="h-3.5 w-3.5" />
                Hạn thanh toán: {formatDate(invoice.due_date)}
              </div>
            )}
          </div>
        </div>

        {/* Customer Info */}
        <div className="bg-slate-50 rounded-lg p-4 mb-8">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Thông tin khách hàng</p>
          <div className="flex items-start gap-6">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <Building2 className="h-4 w-4 text-slate-400" />
              <span className="font-medium">{invoice.customer_name}</span>
            </div>
            {invoice.customer_tax_code && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Hash className="h-4 w-4 text-slate-400" />
                MST: {invoice.customer_tax_code}
              </div>
            )}
          </div>
          {invoice.customer_address && (
            <p className="text-sm text-slate-500 mt-1 ml-6">{invoice.customer_address}</p>
          )}
        </div>

        {/* Items Table */}
        <div className="mb-8">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="text-left text-xs font-semibold text-slate-500 pb-2 pr-4">STT</th>
                <th className="text-left text-xs font-semibold text-slate-500 pb-2">Mô tả hàng hóa</th>
                <th className="text-left text-xs font-semibold text-slate-500 pb-2 px-4">Mã BQMS</th>
                <th className="text-right text-xs font-semibold text-slate-500 pb-2 px-4">SL</th>
                <th className="text-right text-xs font-semibold text-slate-500 pb-2 px-4">Đơn giá (VNĐ)</th>
                <th className="text-right text-xs font-semibold text-slate-500 pb-2 pl-4">Thành tiền (VNĐ)</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, idx) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="py-3 pr-4 text-sm text-slate-400">{idx + 1}</td>
                  <td className="py-3 text-sm text-slate-700">{item.description}</td>
                  <td className="py-3 px-4 text-sm font-mono text-brand-600">{item.bqms_code || '—'}</td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-slate-700">{item.quantity}</td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-slate-700">
                    {(item.unit_price_vnd ?? 0).toLocaleString('vi-VN')}
                  </td>
                  <td className="py-3 pl-4 text-right text-sm font-mono font-medium text-slate-900">
                    {(item.total_vnd ?? 0).toLocaleString('vi-VN')}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="pt-4 text-right text-sm font-semibold text-slate-700 pr-4">Tổng cộng:</td>
                <td className="pt-4 pl-4 text-right text-lg font-bold font-mono text-brand-700">
                  {formatVND(invoice.total_amount_vnd)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Payment Progress */}
        <div className="border-t border-slate-100 pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-600">Tiến độ thanh toán</span>
            <span className="text-sm font-mono font-medium text-slate-800">{Number(paidPercent ?? 0).toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                paidPercent >= 100 ? 'bg-green-500' : paidPercent > 0 ? 'bg-amber-500' : 'bg-slate-300'
              }`}
              style={{ width: `${paidPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
            <span>Đã thanh toán: {formatVND(invoice.paid_amount_vnd)}</span>
            <span>Còn lại: {formatVND(remaining)}</span>
          </div>
        </div>
      </div>

      {/* Payment History */}
      {invoice.payments.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Lịch sử thanh toán</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Ngày</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số tiền</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Mã tham chiếu</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Ghi chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 text-sm text-slate-600">{formatDate(payment.payment_date)}</td>
                    <td className="px-4 py-3 text-right text-sm font-mono font-medium text-green-600">
                      +{formatVND(payment.amount_vnd)}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-500">{payment.bank_ref || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{payment.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment Form Dialog */}
      {showPaymentForm && (
        <PaymentForm
          onClose={() => setShowPaymentForm(false)}
          onSubmit={(data) => recordPaymentMutation.mutate(data)}
          isPending={recordPaymentMutation.isPending}
          remainingAmount={remaining}
        />
      )}
    </div>
  );
}
