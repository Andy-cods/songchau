'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { FileSpreadsheet, Search, Download, Eye, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface Quotation {
  id: number;
  rfq_no: string;
  quotation_no: string | null;
  status: string;
  source_type: string;
  total_items: number;
  filled_items: number;
  created_by_name: string;
  created_at: string;
}

interface QuotationListResponse {
  data: {
    items: Quotation[];
    total: number;
    page: number;
    limit: number;
  };
}

const STATUS_BADGE: Record<string, { label: string; cls: string; icon: any }> = {
  draft: { label: 'Nháp', cls: 'bg-slate-100 text-slate-600', icon: Clock },
  processing: { label: 'Đang xử lý', cls: 'bg-blue-100 text-blue-700', icon: Loader2 },
  completed: { label: 'Hoàn thành', cls: 'bg-green-100 text-green-700', icon: CheckCircle },
  failed: { label: 'Lỗi', cls: 'bg-red-100 text-red-700', icon: XCircle },
  submitted: { label: 'Đã gửi', cls: 'bg-purple-100 text-purple-700', icon: CheckCircle },
};

export default function QuotationHistoryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<QuotationListResponse>({
    queryKey: ['quotation-history', page],
    queryFn: () => api.get(`/api/v1/quotations/history?page=${page}&limit=20`),
    retry: false,
  });

  const quotations = data?.data.items ?? [];
  const total = data?.data.total ?? 0;

  const filtered = search
    ? quotations.filter((q) => q.rfq_no.toLowerCase().includes(search.toLowerCase()))
    : quotations;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Lịch Sử Báo Giá</h2>
          <p className="text-sm text-slate-500 mt-0.5">Danh sách tất cả báo giá đã tạo</p>
        </div>
        <Link
          href="/bqms/quotation/new"
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <FileSpreadsheet className="h-4 w-4" />Tạo mới
        </Link>
      </div>

      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo mã RFQ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Đang tải...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400">Chưa có báo giá nào</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">#</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">RFQ</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Trạng thái</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Items</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Nguồn</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Người tạo</th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Ngày tạo</th>
                  <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((q) => {
                  const badge = STATUS_BADGE[q.status] || STATUS_BADGE.draft;
                  const Icon = badge.icon;
                  return (
                    <tr key={q.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-slate-500">{q.id}</td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-700">{q.rfq_no}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                          <Icon className="h-3 w-3" />{badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {q.filled_items}/{q.total_items}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500 capitalize">{q.source_type}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{q.created_by_name}</td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {new Date(q.created_at).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/bqms/quotation/${q.id}`}
                            className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          {q.status === 'completed' && (
                            <a
                              href={`/api/v1/quotations/download/${q.id}/quotation_xlsx`}
                              className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-green-600"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-sm text-slate-500">Tổng: {total}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Trước</button>
              <span className="px-3 py-1 text-sm">Trang {page}</span>
              <button onClick={() => setPage((p) => p + 1)} disabled={page * 20 >= total} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Sau</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
