'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  Banknote,
  AlertTriangle,
  Users,
  Inbox,
  X,
  CheckCircle,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────

interface ARCustomerItem {
  ar_id?: number;
  customer_name: string;
  invoice_number?: string;
  amount: number;
  due_date?: string;
  paid_amount?: number;
  status?: string;
  days_overdue?: number;
}

interface ARSummaryResponse {
  data: {
    total: number;
    overdue: number;
    by_customer: ARCustomerItem[];
  };
}

interface ReceiptFormState {
  payment_date: string;
  amount: string;
  bank_ref: string;
}

// ─── Helpers ────────────────────────────────────────────────────

function fmtVnd(value: number): string {
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + '₫';
}

function StatusBadge({ status, daysOverdue }: { status?: string; daysOverdue?: number }) {
  if (daysOverdue && daysOverdue > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
        <AlertTriangle className="h-3 w-3" />
        Quá hạn {daysOverdue}N
      </span>
    );
  }
  const s = status?.toLowerCase() ?? '';
  if (s === 'paid') return <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">Đã thu</span>;
  if (s === 'partial') return <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Thu 1 phần</span>;
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">Chưa thu</span>;
}

// ─── Skeleton ────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-20 bg-slate-200 rounded-full animate-pulse ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ─── Summary Card ────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  color: string;
  icon: React.ElementType;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-lg font-bold font-mono text-slate-900 mt-0.5">{value}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Receipt Form (inline) ────────────────────────────────────────

function ReceiptForm({
  item,
  onClose,
  onSuccess,
}: {
  item: ARCustomerItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<ReceiptFormState>({
    payment_date: new Date().toISOString().slice(0, 10),
    amount: item.amount != null ? String(item.amount - (item.paid_amount ?? 0)) : '',
    bank_ref: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post('/api/v1/finance-management/record-receipt', payload),
    onSuccess: () => {
      onSuccess();
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? 'Lỗi ghi nhận thu tiền';
      setError(msg);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) {
      setError('Số tiền phải lớn hơn 0');
      return;
    }
    mutation.mutate({
      ar_id: item.ar_id,
      amount: amt,
      payment_date: form.payment_date,
      bank_ref: form.bank_ref || undefined,
    });
  }

  return (
    <td colSpan={7} className="px-4 py-3 bg-emerald-50/60 border-t border-emerald-100">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Ngày thu tiền</label>
          <input
            type="date"
            value={form.payment_date}
            onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))}
            className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Số tiền (VNĐ)</label>
          <input
            type="number"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            placeholder="0"
            min="1"
            className="border border-slate-300 rounded px-2 py-1 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Mã ngân hàng</label>
          <input
            type="text"
            value={form.bank_ref}
            onChange={e => setForm(f => ({ ...f, bank_ref: e.target.value }))}
            placeholder="Tuỳ chọn"
            className="border border-slate-300 rounded px-2 py-1 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>
        <div className="flex items-end gap-2 mb-0.5">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors"
          >
            <CheckCircle className="h-4 w-4" />
            {mutation.isPending ? 'Đang lưu...' : 'Xác nhận thu'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 text-sm text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
            Huỷ
          </button>
        </div>
        {error && <p className="w-full text-xs text-red-600 mt-1">{error}</p>}
      </form>
    </td>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function ReceivablesPage() {
  const queryClient = useQueryClient();
  const [openFormIdx, setOpenFormIdx] = useState<number | null>(null);

  const { data, isLoading } = useQuery<ARSummaryResponse>({
    queryKey: ['ar-summary'],
    queryFn: () => api.get('/api/v1/finance-management/ar-summary'),
    retry: 1,
  });

  const summary = data?.data;
  const customers = summary?.by_customer ?? [];

  function handleReceiptSuccess() {
    queryClient.invalidateQueries({ queryKey: ['ar-summary'] });
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
          <Banknote className="h-5 w-5 text-brand-600" />
          Công nợ phải thu
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">Theo dõi công nợ từ khách hàng</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <SummaryCard
          label="Tổng phải thu"
          value={summary ? fmtVnd(summary.total) : '—'}
          color="text-emerald-600 bg-emerald-50"
          icon={Banknote}
        />
        <SummaryCard
          label="Quá hạn"
          value={summary ? fmtVnd(summary.overdue) : '—'}
          color="text-red-600 bg-red-50"
          icon={AlertTriangle}
        />
        <SummaryCard
          label="Số khách hàng"
          value={summary ? `${customers.length} khách` : '—'}
          color="text-slate-600 bg-slate-50"
          icon={Users}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <Inbox className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400">Không có công nợ nào</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Khách hàng</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số hóa đơn</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số tiền</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Hạn thanh toán</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Đã thu</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Trạng thái</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((item, idx) => {
                  const isOverdue = (item.days_overdue ?? 0) > 0;
                  const isPaid = item.status?.toLowerCase() === 'paid';
                  const isOpen = openFormIdx === idx;
                  return (
                    <>
                      <tr
                        key={idx}
                        className={`hover:bg-slate-50/50 transition-colors ${isOverdue ? 'bg-red-50/30' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isOverdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                            <span className="text-sm font-medium text-slate-800">{item.customer_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-mono text-slate-500">{item.invoice_number ?? '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-mono font-medium text-slate-900">{fmtVnd(item.amount)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                            {formatDate(item.due_date)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-mono text-slate-600">
                            {item.paid_amount != null ? fmtVnd(item.paid_amount) : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={item.status} daysOverdue={item.days_overdue} />
                        </td>
                        <td className="px-4 py-3">
                          {!isPaid && (
                            <button
                              onClick={() => setOpenFormIdx(isOpen ? null : idx)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                            >
                              {isOpen ? 'Đóng' : 'Ghi nhận thu tiền'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`form-${idx}`} className="border-b border-emerald-100">
                          <ReceiptForm
                            item={item}
                            onClose={() => setOpenFormIdx(null)}
                            onSuccess={handleReceiptSuccess}
                          />
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 text-xs text-slate-400">
        {customers.length > 0 && `${customers.length} khách hàng có công nợ`}
      </div>
    </div>
  );
}
