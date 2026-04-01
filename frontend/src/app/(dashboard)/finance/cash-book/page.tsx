'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  BookOpen,
  Plus,
  X,
  Loader2,
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  Inbox,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// ─── Types ──────────────────────────────────────────────────────

interface CashBookEntry {
  id: number;
  entry_date: string;
  entry_type: 'income' | 'expense' | 'transfer';
  category: string;
  description: string;
  amount_vnd: number;
  balance_after: number;
}

interface CashBookResponse {
  data: {
    items: CashBookEntry[];
    total: number;
  };
}

interface CashFlowMonth {
  month: string;
  income: number;
  expense: number;
  net: number;
}

interface CashFlowResponse {
  data: CashFlowMonth[];
}

interface CreateEntryForm {
  entry_date: string;
  entry_type: 'income' | 'expense' | 'transfer';
  category: string;
  description: string;
  amount: string;
  currency: string;
}

// ─── Helpers ────────────────────────────────────────────────────

function fmtVnd(value: number): string {
  if (value >= 1_000_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000_000)) + ' tỷ';
  if (value >= 1_000_000)
    return new Intl.NumberFormat('vi-VN').format(Math.round(value / 1_000_000)) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(value) + '₫';
}

const ENTRY_TYPE_CONFIG = {
  income: { label: 'Thu', className: 'bg-emerald-100 text-emerald-700', icon: TrendingUp },
  expense: { label: 'Chi', className: 'bg-red-100 text-red-700', icon: TrendingDown },
  transfer: { label: 'Chuyển', className: 'bg-blue-100 text-blue-700', icon: ArrowLeftRight },
};

const CATEGORIES = {
  income: ['Thu từ khách hàng', 'Thu lãi ngân hàng', 'Thu khác'],
  expense: ['Trả nhà cung cấp', 'Chi lương', 'Chi thuê văn phòng', 'Chi vận chuyển', 'Chi khác'],
  transfer: ['Chuyển khoản nội bộ', 'Nạp/Rút ngân hàng'],
};

const today = new Date().toISOString().split('T')[0];
const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

// ─── Create Entry Modal ──────────────────────────────────────────

function CreateEntryModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateEntryForm>({
    entry_date: today,
    entry_type: 'income',
    category: 'Thu từ khách hàng',
    description: '',
    amount: '',
    currency: 'VND',
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateEntryForm) =>
      api.post('/api/v1/finance-management/cash-book', {
        ...payload,
        amount: Number(payload.amount),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-book'] });
      queryClient.invalidateQueries({ queryKey: ['cash-flow'] });
      onClose();
    },
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const updated = { ...prev, [name]: value };
      // Reset category when type changes
      if (name === 'entry_type') {
        const cats = CATEGORIES[value as keyof typeof CATEGORIES] ?? [];
        updated.category = cats[0] ?? '';
      }
      return updated;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) return;
    mutation.mutate(form);
  };

  const categories = CATEGORIES[form.entry_type] ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">Tạo bút toán mới</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Ngày <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                name="entry_date"
                value={form.entry_date}
                onChange={handleChange}
                required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Loại <span className="text-red-500">*</span>
              </label>
              <select
                name="entry_type"
                value={form.entry_type}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                <option value="income">Thu</option>
                <option value="expense">Chi</option>
                <option value="transfer">Chuyển khoản</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Danh mục <span className="text-red-500">*</span>
            </label>
            <select
              name="category"
              value={form.category}
              onChange={handleChange}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nội dung <span className="text-red-500">*</span>
            </label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={2}
              required
              placeholder="Mô tả bút toán..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Số tiền <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="amount"
                value={form.amount}
                onChange={handleChange}
                min="1"
                required
                placeholder="0"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tiền tệ</label>
              <select
                name="currency"
                value={form.currency}
                onChange={handleChange}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                <option value="VND">VNĐ</option>
                <option value="USD">USD</option>
                <option value="RMB">CNY</option>
              </select>
            </div>
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              Có lỗi xảy ra. Vui lòng thử lại.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Tạo bút toán
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Table Skeleton ──────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-14 bg-slate-200 rounded-full animate-pulse" />
          <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse ml-auto" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function CashBookPage() {
  const [showModal, setShowModal] = useState(false);
  const [fromDate, setFromDate] = useState(threeMonthsAgo);
  const [toDate, setToDate] = useState(today);
  const [page, setPage] = useState(1);

  const { data: cashBookData, isLoading: cashLoading } = useQuery<CashBookResponse>({
    queryKey: ['cash-book', page, fromDate, toDate],
    queryFn: () =>
      api.get(`/api/v1/finance-management/cash-book?page=${page}&from=${fromDate}&to=${toDate}`),
    retry: 1,
  });

  const { data: cashFlowData } = useQuery<CashFlowResponse>({
    queryKey: ['cash-flow'],
    queryFn: () => api.get('/api/v1/finance-management/cash-flow'),
    retry: 1,
  });

  // Handle both {data:{items:[]}} and {items:[]} response shapes
  const entriesRaw = cashBookData?.data?.items ?? (cashBookData as any)?.items ?? [];
  const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
  const total = cashBookData?.data?.total ?? (cashBookData as any)?.total ?? 0;
  const chartRaw = cashFlowData?.data ?? (cashFlowData as any)?.items ?? [];
  const chartData = Array.isArray(chartRaw) ? chartRaw : [];

  return (
    <div>
      {showModal && <CreateEntryModal onClose={() => setShowModal(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-brand-600" />
            Sổ quỹ
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Theo dõi thu chi và dòng tiền</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          Tạo bút toán
        </button>
      </div>

      {/* Cash Flow Chart */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Dòng tiền 12 tháng gần nhất</h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis
                tickFormatter={(v) => fmtVnd(v)}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                width={70}
              />
              <Tooltip
                formatter={(value: number) => fmtVnd(value)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="income"
                name="Thu"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="expense"
                name="Chi"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="net"
                name="Ròng"
                stroke="#6366f1"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center h-[240px] text-slate-300">
            <Inbox className="h-10 w-10 mb-2" />
            <p className="text-sm text-slate-400">Chưa có dữ liệu dòng tiền</p>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span>Từ:</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span>Đến:</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
        </div>
        <span className="text-xs text-slate-400 ml-auto">{total} bút toán</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {cashLoading ? (
          <TableSkeleton />
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <BookOpen className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400">Chưa có bút toán nào trong kỳ này</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Ngày</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Loại</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Danh mục</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Nội dung</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số tiền</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số dư sau</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => {
                  const typeConfig = ENTRY_TYPE_CONFIG[entry.entry_type] ?? ENTRY_TYPE_CONFIG.income;
                  return (
                    <tr key={entry.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-600">{formatDate(entry.entry_date)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${typeConfig.className}`}>
                          <typeConfig.icon className="h-3 w-3" />
                          {typeConfig.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-600">{entry.category}</span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <span className="text-sm text-slate-700 line-clamp-1">{entry.description}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-mono font-medium ${
                          entry.entry_type === 'income'
                            ? 'text-emerald-600'
                            : entry.entry_type === 'expense'
                            ? 'text-red-600'
                            : 'text-blue-600'
                        }`}>
                          {entry.entry_type === 'income' ? '+' : entry.entry_type === 'expense' ? '-' : ''}
                          {fmtVnd(entry.amount_vnd)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-mono text-slate-700">{fmtVnd(entry.balance_after)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>Hiển thị {entries.length} / {total} bút toán</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Trước
            </button>
            <span className="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium">{page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={entries.length < 20}
              className="px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Sau
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
