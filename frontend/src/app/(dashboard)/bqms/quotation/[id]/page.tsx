'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  FileSpreadsheet,
  Download,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';

interface QuotationDetail {
  id: number;
  rfq_no: string;
  quotation_no: string | null;
  status: string;
  source_type: string;
  template_id: number | null;
  items: any[];
  output_xlsx: string | null;
  output_pdf: string | null;
  total_items: number;
  filled_items: number;
  error_message: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: any }> = {
  draft: { label: 'Nháp', cls: 'bg-slate-100 text-slate-600', icon: Clock },
  processing: { label: 'Đang xử lý', cls: 'bg-blue-100 text-blue-700', icon: Loader2 },
  completed: { label: 'Hoàn thành', cls: 'bg-green-100 text-green-700', icon: CheckCircle },
  failed: { label: 'Lỗi', cls: 'bg-red-100 text-red-700', icon: XCircle },
  submitted: { label: 'Đã gửi', cls: 'bg-purple-100 text-purple-700', icon: CheckCircle },
};

export default function QuotationDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const { data, isLoading } = useQuery<{ data: QuotationDetail }>({
    queryKey: ['quotation-detail', id],
    queryFn: () => api.get(`/api/v1/quotations/history/${id}`),
    retry: false,
    enabled: !!id,
  });

  const quotation = data?.data;

  if (isLoading) {
    return (
      <div className="p-8 text-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Đang tải...
      </div>
    );
  }

  if (!quotation) {
    return <div className="p-8 text-center text-slate-400">Không tìm thấy báo giá</div>;
  }

  const badge = STATUS_CONFIG[quotation.status] || STATUS_CONFIG.draft;
  const Icon = badge.icon;
  const items = Array.isArray(quotation.items) ? quotation.items : [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/bqms/quotation/history" className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-display font-bold text-slate-900">Báo Giá #{quotation.id}</h2>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium ${badge.cls}`}>
                <Icon className="h-3.5 w-3.5" />{badge.label}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">RFQ: {quotation.rfq_no} | {new Date(quotation.created_at).toLocaleString('vi-VN')}</p>
          </div>
        </div>

        {/* Download buttons */}
        {quotation.status === 'completed' && (
          <div className="flex gap-2">
            {quotation.output_xlsx && (
              <a
                href={`/api/v1/quotations/download/${quotation.id}/quotation_xlsx`}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Download className="h-4 w-4" />Excel
              </a>
            )}
            {quotation.output_pdf && (
              <a
                href={`/api/v1/quotations/download/${quotation.id}/quotation_pdf`}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Download className="h-4 w-4" />PDF
              </a>
            )}
          </div>
        )}
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Tổng items</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{quotation.total_items}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Đã có giá</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{quotation.filled_items}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Nguồn</p>
          <p className="text-lg font-semibold text-slate-800 mt-1 capitalize">{quotation.source_type}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Người tạo</p>
          <p className="text-lg font-semibold text-slate-800 mt-1">{quotation.created_by_name}</p>
        </div>
      </div>

      {/* Error */}
      {quotation.error_message && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700"><XCircle className="h-4 w-4 inline mr-1" />{quotation.error_message}</p>
        </div>
      )}

      {/* Line Items */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Chi tiết đơn hàng ({items.length} items)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">#</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Đơn hàng</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">BQMS</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Spec</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Loại</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Maker</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">SL</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Giá gợi ý</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-slate-500">{i + 1}</td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-700">{item.don_hang}</td>
                  <td className="px-4 py-3 text-sm font-mono text-slate-600">{item.bqms}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-[200px] truncate">{item.spec}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      item.loai_hang === 'GC' ? 'bg-blue-100 text-blue-700'
                      : item.loai_hang === 'TM' ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-500'
                    }`}>{item.loai_hang}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{item.maker}</td>
                  <td className="px-4 py-3 text-sm text-right text-slate-600">{item.so_luong}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">
                    {item.suggested_price ? (
                      <span className="text-green-700">{Number(item.suggested_price).toLocaleString('vi-VN')} ₫</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
