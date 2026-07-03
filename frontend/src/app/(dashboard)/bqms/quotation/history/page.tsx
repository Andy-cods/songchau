'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  FileSpreadsheet,
  Search,
  Download,
  Eye,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Cloud,
  CloudOff,
  RefreshCw,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/table';

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
  deleted_at: string | null;
  onedrive_url: string | null;
  onedrive_share_url: string | null;
  onedrive_synced_at: string | null;
  onedrive_sync_error: string | null;
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
  draft:      { label: 'Nháp',         cls: 'bg-slate-100 text-slate-600', icon: Clock },
  processing: { label: 'Đang xử lý',   cls: 'bg-blue-100 text-blue-700',   icon: Loader2 },
  completed:  { label: 'Hoàn thành',   cls: 'bg-green-100 text-green-700', icon: CheckCircle },
  failed:     { label: 'Lỗi',          cls: 'bg-red-100 text-red-700',     icon: XCircle },
  submitted:  { label: 'Đã gửi',       cls: 'bg-sky-100 text-sky-700',     icon: CheckCircle },
};

export default function QuotationHistoryPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const { data, isLoading } = useQuery<QuotationListResponse>({
    queryKey: ['quotation-history', page, search, includeDeleted],
    queryFn: () => {
      const qs = new URLSearchParams({
        page: String(page),
        limit: '20',
      });
      if (search) qs.set('rfq_no', search);
      if (includeDeleted) qs.set('include_deleted', 'true');
      return api.get(`/api/v1/quotations/history?${qs.toString()}`);
    },
    retry: false,
  });

  const quotations = data?.data.items ?? [];
  const total = data?.data.total ?? 0;

  // ─── Mutations ───
  const syncMut = useMutation({
    mutationFn: (id: number) => api.post(`/api/v1/quotations/history/${id}/sync-onedrive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotation-history'] }),
  });

  const shareMut = useMutation({
    mutationFn: (id: number) =>
      api.post<{ data: { share_url: string } }>(
        `/api/v1/quotations/history/${id}/share?scope=anonymous&link_type=view`
      ),
    onSuccess: (resp) => {
      const url = resp?.data?.share_url;
      if (url && navigator.clipboard) {
        navigator.clipboard.writeText(url).catch(() => {});
        alert(`Đã copy share link:\n${url}`);
      } else if (url) {
        prompt('Share link (copy thủ công):', url);
      }
      qc.invalidateQueries({ queryKey: ['quotation-history'] });
    },
    onError: (err: any) => {
      alert(`Tạo share link lỗi: ${err?.detail ?? err?.message ?? 'Unknown'}`);
    },
  });

  const deleteMut = useMutation({
    mutationFn: ({ id, hard }: { id: number; hard: boolean }) =>
      api.delete(`/api/v1/quotations/history/${id}${hard ? '?hard=true' : ''}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotation-history'] }),
  });

  const restoreMut = useMutation({
    mutationFn: (id: number) => api.post(`/api/v1/quotations/history/${id}/restore`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotation-history'] }),
  });

  return (
    <div>
      <PageHeader
        title="Lịch Sử Báo Giá"
        subtitle="Danh sách tất cả báo giá đã tạo"
        className="mb-6"
        actions={
          <Link
            href="/bqms/quotation/new"
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <FileSpreadsheet className="h-4 w-4" />Tạo mới
          </Link>
        }
      />

      <div className="mb-4 flex gap-3 items-center">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo mã RFQ..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => { setIncludeDeleted(e.target.checked); setPage(1); }}
          />
          Hiển thị đã xóa
        </label>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Đang tải...
          </div>
        ) : quotations.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} heading="Chưa có báo giá nào" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
                <TableHead>#</TableHead>
                <TableHead>RFQ</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>OneDrive</TableHead>
                <TableHead>Người tạo</TableHead>
                <TableHead>Ngày tạo</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotations.map((q) => {
                const badge = STATUS_BADGE[q.status] || STATUS_BADGE.draft;
                const Icon = badge.icon;
                const isSynced = !!q.onedrive_url;
                const isDeleted = !!q.deleted_at;
                return (
                  <TableRow key={q.id} className={isDeleted ? 'opacity-50' : ''}>
                    <TableCell className="text-sm text-slate-500">{q.id}</TableCell>
                    <TableCell className="text-sm font-medium text-slate-700">
                      {q.rfq_no}
                      {isDeleted && (
                        <span className="ml-1 text-[11px] text-rose-500 uppercase">đã xóa</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                        <Icon className="h-3 w-3" />{badge.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {q.filled_items}/{q.total_items}
                    </TableCell>
                    <TableCell className="text-sm">
                      {isSynced ? (
                        <a
                          href={q.onedrive_url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                          title={`Sync lúc ${q.onedrive_synced_at ? new Date(q.onedrive_synced_at).toLocaleString('vi-VN') : ''}`}
                        >
                          <Cloud className="h-3.5 w-3.5" />
                          Mở
                        </a>
                      ) : q.onedrive_sync_error ? (
                        <span
                          className="inline-flex items-center gap-1 text-rose-500"
                          title={q.onedrive_sync_error}
                        >
                          <CloudOff className="h-3.5 w-3.5" />Lỗi
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-400">
                          <CloudOff className="h-3.5 w-3.5" />
                          Chưa sync
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{q.created_by_name}</TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {new Date(q.created_at).toLocaleDateString('vi-VN')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5">
                          {!isDeleted && (
                            <Link
                              href={`/bqms/quotation/${q.id}`}
                              className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700"
                              title="Xem chi tiết"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                          )}
                          {q.status === 'completed' && !isDeleted && (
                            <>
                              <a
                                href={`/api/v1/quotations/download/${q.id}/quotation_xlsx`}
                                className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-green-600"
                                title="Tải Excel"
                              >
                                <Download className="h-4 w-4" />
                              </a>
                              {!isSynced && (
                                <button
                                  onClick={() => syncMut.mutate(q.id)}
                                  disabled={syncMut.isPending}
                                  className="p-1.5 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600 disabled:opacity-50"
                                  title="Đồng bộ lên OneDrive"
                                >
                                  <RefreshCw className={`h-4 w-4 ${syncMut.isPending && syncMut.variables === q.id ? 'animate-spin' : ''}`} />
                                </button>
                              )}
                              {isSynced && (
                                <button
                                  onClick={() => shareMut.mutate(q.id)}
                                  disabled={shareMut.isPending}
                                  className="p-1.5 hover:bg-brand-50 rounded text-slate-400 hover:text-brand-600 disabled:opacity-50"
                                  title="Tạo + copy share link"
                                >
                                  <Share2 className="h-4 w-4" />
                                </button>
                              )}
                            </>
                          )}
                          {!isDeleted && (
                            <button
                              onClick={() => {
                                if (confirm(`Xóa báo giá ${q.rfq_no}? (có thể khôi phục sau)`)) {
                                  deleteMut.mutate({ id: q.id, hard: false });
                                }
                              }}
                              disabled={deleteMut.isPending}
                              className="p-1.5 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600 disabled:opacity-50"
                              title="Xóa (soft)"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                          {isDeleted && (
                            <button
                              onClick={() => restoreMut.mutate(q.id)}
                              disabled={restoreMut.isPending}
                              className="p-1.5 hover:bg-emerald-50 rounded text-slate-400 hover:text-emerald-600 disabled:opacity-50"
                              title="Khôi phục"
                            >
                              <Undo2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
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
