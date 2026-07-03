'use client';

// Redesigned 2026-05-12 per Thang: hero header, BQMS code prominent,
// action toolbar with Excel/PDF/OnlyOffice edit, modern card-based layout.

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
  Pencil,
  RefreshCw,
  Layers,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

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

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: any; ring: string }> = {
  draft:      { label: 'Nháp',         cls: 'bg-slate-100 text-slate-700',   icon: Clock,         ring: 'ring-slate-300' },
  processing: { label: 'Đang xử lý',   cls: 'bg-blue-100 text-blue-700',     icon: Loader2,       ring: 'ring-blue-300' },
  completed:  { label: 'Hoàn thành',   cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle, ring: 'ring-emerald-300' },
  failed:     { label: 'Lỗi',          cls: 'bg-red-100 text-red-700',       icon: XCircle,       ring: 'ring-red-300' },
  submitted:  { label: 'Đã gửi',       cls: 'bg-sky-100 text-sky-700',       icon: CheckCircle,   ring: 'ring-sky-300' },
};

export default function QuotationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [regenLoading, setRegenLoading] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ data: QuotationDetail }>({
    queryKey: ['quotation-detail', id],
    queryFn: () => api.get(`/api/v1/quotations/history/${id}`),
    retry: false,
    enabled: !!id,
  });

  const quotation = data?.data;

  if (isLoading) {
    return (
      <div className="p-12 text-center text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
        <div className="text-sm">Đang tải báo giá...</div>
      </div>
    );
  }

  if (!quotation) {
    return (
      <div className="p-12 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
          <FileSpreadsheet className="h-8 w-8 text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-700">Không tìm thấy báo giá</h2>
        <p className="text-sm text-slate-500 mt-1">ID #{id} không tồn tại hoặc đã bị xoá.</p>
        <Link
          href="/bqms/quotation/history"
          className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />Quay lại lịch sử
        </Link>
      </div>
    );
  }

  const badge = STATUS_CONFIG[quotation.status] || STATUS_CONFIG.draft;
  const Icon = badge.icon;
  const items = Array.isArray(quotation.items) ? quotation.items : [];
  const fillPct = quotation.total_items > 0
    ? Math.round((quotation.filled_items / quotation.total_items) * 100)
    : 0;

  // Sums + win-rate hints
  const totalSuggested = items.reduce(
    (s, it) => s + (Number(it.suggested_price) || 0) * (Number(it.so_luong) || 1),
    0,
  );
  const gcCount = items.filter((it) => (it.loai_hang || '').toUpperCase() === 'GC').length;
  const tmCount = items.filter((it) => (it.loai_hang || '').toUpperCase() === 'TM').length;

  const onRegenPdf = async () => {
    if (regenLoading || !quotation.output_xlsx) return;
    setRegenLoading(true);
    try {
      await api.post(`/api/v1/bqms/quote-file/regen-pdf`, { xlsx_path: quotation.output_xlsx });
      toast.success('Đã tái sinh PDF');
      setTimeout(() => refetch(), 600);
    } catch (e: any) {
      toast.error(`Regen PDF lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setRegenLoading(false);
    }
  };

  // Direct OnlyOffice edit link
  const editUrl = quotation.output_xlsx
    ? `/documents/edit?path=${encodeURIComponent(quotation.output_xlsx)}`
    : null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs">
        <Link href="/bqms/quotation/history" className="inline-flex items-center gap-1 text-slate-500 hover:text-brand-600">
          <ArrowLeft className="h-3.5 w-3.5" />Lịch sử báo giá
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-mono">#{quotation.id}</span>
      </div>

      {/* Header — flat brand block */}
      <div className="bg-brand-600 rounded-xl text-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-white/15 backdrop-blur rounded-full text-[11px] font-mono uppercase tracking-wider mb-2 border border-white/20">
              <FileSpreadsheet className="h-3 w-3" />
              Báo giá BQMS
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">Báo Giá #{quotation.id}</h1>
              {quotation.quotation_no && (
                <span className="font-mono text-sm bg-white/15 px-2 py-0.5 rounded">
                  {quotation.quotation_no}
                </span>
              )}
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ring-2 ${badge.cls} ${badge.ring} ring-inset`}>
                <Icon className={`h-3.5 w-3.5 ${quotation.status === 'processing' ? 'animate-spin' : ''}`} />
                {badge.label}
              </span>
            </div>
            <div className="mt-2 text-sm text-white/85 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-mono">RFQ: <span className="font-semibold">{quotation.rfq_no}</span></span>
              <span>•</span>
              <span>{new Date(quotation.created_at).toLocaleString('vi-VN')}</span>
              <span>•</span>
              <span>Tạo bởi: <span className="font-semibold">{quotation.created_by_name}</span></span>
            </div>
          </div>

          {/* Action toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {quotation.output_xlsx && (
              <a
                href={`/api/v1/quotations/download/${quotation.id}/quotation_xlsx`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-emerald-700 hover:bg-emerald-50 text-xs font-semibold shadow-md hover:shadow-lg active:scale-95 transition-all"
              >
                <Download className="h-3.5 w-3.5" />Excel
              </a>
            )}
            {quotation.output_pdf && (
              <a
                href={`/api/v1/quotations/download/${quotation.id}/quotation_pdf`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-red-700 hover:bg-red-50 text-xs font-semibold shadow-md hover:shadow-lg active:scale-95 transition-all"
              >
                <Download className="h-3.5 w-3.5" />PDF
              </a>
            )}
            {editUrl && (
              <Link
                href={editUrl}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold shadow-md hover:shadow-lg active:scale-95 transition-all"
                title="Mở Excel online (OnlyOffice) — chỉnh sửa + auto save"
              >
                <Pencil className="h-3.5 w-3.5" />Sửa online
              </Link>
            )}
            {quotation.output_xlsx && (
              <button
                onClick={onRegenPdf}
                disabled={regenLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold border border-white/30 active:scale-95 transition-all disabled:opacity-50"
                title="Tái sinh PDF từ xlsx hiện tại"
              >
                {regenLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Regen PDF
              </button>
            )}
          </div>
        </div>

        {/* Progress bar — fill rate */}
        <div className="mt-4 bg-black/15 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-emerald-400 transition-all duration-700"
            style={{ width: `${fillPct}%` }}
          />
        </div>
        <div className="mt-1.5 text-[11px] text-white/80 flex justify-between">
          <span>Đã điền giá: {quotation.filled_items}/{quotation.total_items} items</span>
          <span className="font-semibold">{fillPct}%</span>
        </div>
      </div>

      {/* Stats row — 4 metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Tổng giá trị"
          value={`${totalSuggested.toLocaleString('vi-VN')} ₫`}
          icon={<TrendingUp className="h-5 w-5" />}
          color="emerald"
        />
        <StatCard
          label="Hàng GC"
          value={`${gcCount} mã`}
          icon={<Layers className="h-5 w-5" />}
          color="blue"
          subline={`${gcCount > 0 ? Math.round((gcCount / items.length) * 100) : 0}% tổng`}
        />
        <StatCard
          label="Hàng TM"
          value={`${tmCount} mã`}
          icon={<Layers className="h-5 w-5" />}
          color="amber"
          subline={`${tmCount > 0 ? Math.round((tmCount / items.length) * 100) : 0}% tổng`}
        />
        <StatCard
          label="Nguồn"
          value={quotation.source_type}
          icon={<FileSpreadsheet className="h-5 w-5" />}
          color="slate"
          subline={`Template #${quotation.template_id ?? '—'}`}
        />
      </div>

      {/* Error banner */}
      {quotation.error_message && (
        <div className="bg-red-50 border-l-4 border-red-500 rounded-r-lg p-4 shadow-sm">
          <div className="flex items-start gap-2">
            <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-800">Lỗi xử lý báo giá</div>
              <div className="text-sm text-red-700 mt-1 break-all">{quotation.error_message}</div>
            </div>
          </div>
        </div>
      )}

      {/* Items table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-600" />
            Chi tiết items <span className="text-slate-400 font-normal">({items.length})</span>
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="text-left text-[11px] font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5 w-10">#</th>
                <th className="text-left text-[11px] font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5">Đơn hàng</th>
                <th className="text-left text-[11px] font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5">BQMS code</th>
                <th className="text-left text-[11px] font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5">Mô tả / Spec</th>
                <th className="text-left text-[11px] font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5">Loại</th>
                <th className="text-left text-[11px] font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5">Maker</th>
                <th className="text-right text-[11px] font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5">SL</th>
                <th className="text-right text-[11px] font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5">Giá gợi ý</th>
                <th className="text-right text-[11px] font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5">Thành tiền</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item: any, i: number) => {
                const total = (Number(item.suggested_price) || 0) * (Number(item.so_luong) || 0);
                return (
                  <tr key={i} className="hover:bg-brand-50/30 transition-colors group">
                    <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{item.don_hang}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded group-hover:bg-brand-100">
                        {item.bqms}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 max-w-[280px]">
                      <div className="truncate" title={item.spec}>{item.spec}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                        item.loai_hang === 'GC' ? 'bg-blue-100 text-blue-700'
                        : item.loai_hang === 'TM' ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-500'
                      }`}>{item.loai_hang || '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{item.maker || '—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 font-medium">{item.so_luong}</td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {item.suggested_price ? (
                        <span className="text-emerald-700">
                          {Number(item.suggested_price).toLocaleString('vi-VN')} ₫
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold">
                      {total > 0 ? (
                        <span className="text-slate-800">{total.toLocaleString('vi-VN')} ₫</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td colSpan={8} className="px-4 py-2.5 text-right text-slate-700">Tổng cộng:</td>
                  <td className="px-4 py-2.5 text-right text-emerald-700 text-base">
                    {totalSuggested.toLocaleString('vi-VN')} ₫
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color, subline }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: 'emerald' | 'blue' | 'amber' | 'slate';
  subline?: string;
}) {
  const colors: Record<typeof color, { bg: string; text: string; iconBg: string }> = {
    emerald: { bg: 'bg-emerald-50',  text: 'text-emerald-700', iconBg: 'bg-emerald-100 text-emerald-600' },
    blue:    { bg: 'bg-blue-50',     text: 'text-blue-700',    iconBg: 'bg-blue-100 text-blue-600' },
    amber:   { bg: 'bg-amber-50',    text: 'text-amber-700',   iconBg: 'bg-amber-100 text-amber-600' },
    slate:   { bg: 'bg-slate-50',    text: 'text-slate-700',   iconBg: 'bg-slate-100 text-slate-600' },
  };
  const c = colors[color];
  return (
    <div className={`${c.bg} rounded-xl p-4 border border-white shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">{label}</div>
          <div className={`text-lg font-bold mt-1 ${c.text} truncate`} title={value}>{value}</div>
          {subline && <div className="text-[11px] text-slate-500 mt-0.5">{subline}</div>}
        </div>
        <div className={`${c.iconBg} w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
