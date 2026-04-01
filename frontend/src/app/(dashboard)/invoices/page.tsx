'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Receipt, Plus, Search, AlertTriangle, TrendingUp, Clock, DollarSign } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────

type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled';

interface Invoice {
  id: number;
  invoice_number: string;
  customer_name: string;
  total_amount_vnd: number;
  paid_amount_vnd: number;
  status: InvoiceStatus;
  due_date?: string;
  issued_date: string;
}

interface InvoiceStats {
  total_outstanding_vnd: number;
  overdue_count: number;
  this_month_revenue_vnd: number;
}

interface ApiResponse {
  items: Invoice[];
  total: number;
  page: number;
  total_pages: number;
  stats?: InvoiceStats;
}

// ─── Status Config ──────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft:     { label: 'Nháp',           className: 'bg-slate-100 text-slate-600' },
  sent:      { label: 'Đã gửi',         className: 'bg-blue-100 text-blue-700' },
  partial:   { label: 'Thanh toán một phần', className: 'bg-amber-100 text-amber-700' },
  paid:      { label: 'Đã thanh toán',  className: 'bg-green-100 text-green-700' },
  overdue:   { label: 'Quá hạn',        className: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Đã hủy',         className: 'bg-slate-100 text-slate-400' },
};

const ALL_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'];

// ─── Helpers ────────────────────────────────────────────────────────

function isOverdue(invoice: Invoice): boolean {
  if (invoice.status === 'paid' || invoice.status === 'cancelled') return false;
  if (!invoice.due_date) return false;
  return new Date(invoice.due_date) < new Date();
}

function formatVND(amount: number): string {
  return amount.toLocaleString('vi-VN') + '₫';
}

// ─── Stats Cards ─────────────────────────────────────────────────────

function StatsCards({ stats }: { stats?: InvoiceStats }) {
  const cards = [
    {
      label: 'Công nợ chưa thu',
      value: stats ? formatVND(stats.total_outstanding_vnd) : '—',
      icon: DollarSign,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      label: 'Hóa đơn quá hạn',
      value: stats ? stats.overdue_count.toString() : '—',
      icon: AlertTriangle,
      color: 'text-red-600 bg-red-50',
      suffix: ' hóa đơn',
    },
    {
      label: 'Doanh thu tháng này',
      value: stats ? formatVND(stats.this_month_revenue_vnd) : '—',
      icon: TrendingUp,
      color: 'text-green-600 bg-green-50',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {cards.map((card) => (
        <div key={card.label} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${card.color}`}>
              <card.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500">{card.label}</p>
              <p className="text-lg font-bold font-mono text-slate-900 mt-0.5">{card.value}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-36 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-5 w-24 bg-slate-200 rounded-full animate-pulse" />
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse ml-auto" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function InvoicesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');

  const { data, isLoading, error } = useQuery<ApiResponse>({
    queryKey: ['invoices', statusFilter],
    queryFn: () =>
      api.get('/api/v1/invoices' + (statusFilter !== 'all' ? `?status=${statusFilter}` : '')),
    retry: false,
  });

  const invoices = (data?.items ?? []).filter((inv) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      inv.invoice_number.toLowerCase().includes(s) ||
      inv.customer_name.toLowerCase().includes(s)
    );
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Hóa đơn</h2>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý hóa đơn và công nợ khách hàng</p>
        </div>
        <Link
          href="/invoices/new"
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          Tạo hóa đơn
        </Link>
      </div>

      {/* Stats */}
      <StatsCards stats={data?.stats} />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm số hóa đơn, khách hàng..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Tất cả
          </button>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : error || invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <Receipt className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400 font-medium">Chưa có hóa đơn nào</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Số hóa đơn</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Khách hàng</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Tổng tiền</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Trạng thái</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Hạn thanh toán</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Đã thanh toán</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => {
                  const overdue = isOverdue(inv);
                  const sc = STATUS_CONFIG[inv.status];
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => router.push(`/invoices/${inv.id}`)}
                      className={`hover:bg-slate-50/50 transition-colors cursor-pointer ${overdue ? 'bg-red-50/30' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono font-medium text-brand-600">{inv.invoice_number}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-700">{inv.customer_name}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-mono text-slate-900">{formatVND(inv.total_amount_vnd)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.className}`}>{sc.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        {inv.due_date ? (
                          <span className={`text-sm flex items-center gap-1 ${overdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                            {overdue && <AlertTriangle className="h-3.5 w-3.5" />}
                            {!overdue && <Clock className="h-3.5 w-3.5 text-slate-400" />}
                            {formatDate(inv.due_date)}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-mono ${inv.paid_amount_vnd >= inv.total_amount_vnd ? 'text-green-600' : 'text-slate-700'}`}>
                          {formatVND(inv.paid_amount_vnd)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>Hiển thị {invoices.length} / {data.total} hóa đơn</span>
          <span>Trang {data.page} / {data.total_pages}</span>
        </div>
      )}
    </div>
  );
}
