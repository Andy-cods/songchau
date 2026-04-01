'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  CreditCard,
  AlertTriangle,
  Building2,
  Inbox,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────

interface APSupplierItem {
  supplier_name: string;
  invoice_number?: string;
  amount: number;
  due_date?: string;
  paid_amount?: number;
  status?: string;
  days_overdue?: number;
}

interface APSummaryResponse {
  data: {
    total: number;
    overdue: number;
    by_supplier: APSupplierItem[];
  };
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
  if (s === 'paid') return <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">Đã thanh toán</span>;
  if (s === 'partial') return <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Thanh toán 1 phần</span>;
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">Chưa thanh toán</span>;
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
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
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
          {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function PayablesPage() {
  const { data, isLoading } = useQuery<APSummaryResponse>({
    queryKey: ['ap-summary'],
    queryFn: () => api.get('/api/v1/finance-management/ap-summary'),
    retry: 1,
  });

  const summary = data?.data;
  const suppliers = summary?.by_supplier ?? [];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-brand-600" />
          Công nợ phải trả
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">Theo dõi công nợ với nhà cung cấp</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <SummaryCard
          label="Tổng công nợ"
          value={summary ? fmtVnd(summary.total) : '—'}
          color="text-blue-600 bg-blue-50"
          icon={CreditCard}
        />
        <SummaryCard
          label="Quá hạn"
          value={summary ? fmtVnd(summary.overdue) : '—'}
          color="text-red-600 bg-red-50"
          icon={AlertTriangle}
        />
        <SummaryCard
          label="Số nhà cung cấp"
          value={summary ? `${suppliers.length} NCC` : '—'}
          color="text-slate-600 bg-slate-50"
          icon={Building2}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : suppliers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <Inbox className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400">Không có công nợ nào</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Nhà cung cấp</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số hóa đơn</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số tiền</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Hạn thanh toán</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Đã thanh toán</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((item, idx) => {
                  const isOverdue = (item.days_overdue ?? 0) > 0;
                  return (
                    <tr
                      key={idx}
                      className={`hover:bg-slate-50/50 transition-colors ${isOverdue ? 'bg-red-50/30' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isOverdue && <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                          <span className="text-sm font-medium text-slate-800">{item.supplier_name}</span>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 text-xs text-slate-400">
        {suppliers.length > 0 && `${suppliers.length} nhà cung cấp có công nợ`}
      </div>
    </div>
  );
}
