'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import {
  Contact,
  Search,
  Plus,
  Inbox,
  TrendingUp,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────

interface CRMCustomer {
  id: number;
  company_name: string;
  short_name?: string;
  total_orders: number;
  total_revenue: number;
  last_order_date?: string;
}

interface CRMCustomersResponse {
  data: {
    items: CRMCustomer[];
    total: number;
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

// ─── Skeleton ────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-12 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-28 bg-slate-200 rounded animate-pulse ml-auto" />
          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function CRMPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const canAdd = user?.role === 'admin' || user?.role === 'manager';

  const { data, isLoading } = useQuery<CRMCustomersResponse>({
    queryKey: ['crm-customers', page],
    queryFn: () => api.get(`/api/v1/crm/customers?page=${page}`),
    retry: 1,
  });

  const allCustomers = data?.data?.items ?? [];
  const total = data?.data?.total ?? 0;

  const customers = search
    ? allCustomers.filter(
        (c) =>
          c.company_name.toLowerCase().includes(search.toLowerCase()) ||
          (c.short_name ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : allCustomers;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
            <Contact className="h-5 w-5 text-brand-600" />
            Quản lý khách hàng (CRM)
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Danh sách khách hàng và lịch sử giao dịch
          </p>
        </div>
        {canAdd && (
          <button
            onClick={() => router.push('/crm/new')}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Thêm khách hàng
          </button>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tên công ty, tên ngắn..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
        <span className="text-xs text-slate-400 ml-auto">{total} khách hàng</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-300">
            <Inbox className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-400">
              {search ? 'Không tìm thấy khách hàng phù hợp' : 'Chưa có khách hàng nào'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Tên công ty
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Tên ngắn
                  </th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Số đơn
                  </th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Doanh thu
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Đơn gần nhất
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((customer) => (
                  <tr
                    key={customer.id}
                    onClick={() => router.push(`/crm/${customer.id}`)}
                    className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-brand-700">
                            {customer.company_name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-slate-800">{customer.company_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-slate-500">{customer.short_name ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-mono text-slate-700">{customer.total_orders}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {customer.total_revenue > 0 ? (
                        <span className="inline-flex items-center gap-1 text-sm font-mono font-medium text-emerald-700">
                          <TrendingUp className="h-3 w-3" />
                          {fmtVnd(customer.total_revenue)}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-slate-500">
                        {customer.last_order_date ? formatDate(customer.last_order_date) : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>Hiển thị {customers.length} / {total} khách hàng</span>
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
              disabled={allCustomers.length < 20}
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
