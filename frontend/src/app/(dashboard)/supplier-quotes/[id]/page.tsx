'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  ExternalLink,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────

type SupplierQuoteStatus = 'draft' | 'requested' | 'received' | 'accepted' | 'rejected';

interface SupplierQuoteItem {
  id: number;
  bqms_code: string;
  specification: string;
  maker: string;
  quantity: number;
  unit: string;
  unit_price_cny?: number;
  samsung_sell_price_vnd?: number;
  margin_percent?: number;
}

interface SupplierQuote {
  id: number;
  quote_number: string;
  supplier: { id: number; name: string };
  rfq_number?: string;
  status: SupplierQuoteStatus;
  total_amount_cny?: number;
  avg_margin_percent?: number;
  po_number?: string;
  po_id?: number;
  created_at: string;
  updated_at: string;
  items: SupplierQuoteItem[];
}

// ─── Status Config ──────────────────────────────────────────────────

const STATUS_CONFIG: Record<SupplierQuoteStatus, { label: string; className: string }> = {
  draft:     { label: 'Nháp',             className: 'bg-slate-100 text-slate-600' },
  requested: { label: 'Đã gửi yêu cầu',  className: 'bg-blue-100 text-blue-700' },
  received:  { label: 'Đã nhận báo giá', className: 'bg-amber-100 text-amber-700' },
  accepted:  { label: 'Chấp nhận',        className: 'bg-green-100 text-green-700' },
  rejected:  { label: 'Từ chối',          className: 'bg-red-100 text-red-700' },
};

// ─── Margin Badge ───────────────────────────────────────────────────

function MarginBadge({ pct }: { pct: number }) {
  const cls =
    pct >= 15 ? 'text-green-700 bg-green-100' :
    pct >= 5  ? 'text-amber-700 bg-amber-100' :
                'text-red-700 bg-red-100';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${cls}`}>
      {Number(pct ?? 0).toFixed(1)}%
    </span>
  );
}

// ─── Enter Prices Dialog ────────────────────────────────────────────

interface EnterPricesDialogProps {
  items: SupplierQuoteItem[];
  onClose: () => void;
  onSubmit: (prices: Array<{ id: number; unit_price_cny: number; samsung_sell_price_vnd: number }>) => void;
  isPending: boolean;
}

function EnterPricesDialog({ items, onClose, onSubmit, isPending }: EnterPricesDialogProps) {
  const [prices, setPrices] = useState<Record<number, { unit_price_cny: number; samsung_sell_price_vnd: number }>>(
    Object.fromEntries(items.map((item) => [item.id, { unit_price_cny: 0, samsung_sell_price_vnd: 0 }]))
  );

  const handleChange = (id: number, field: 'unit_price_cny' | 'samsung_sell_price_vnd', value: number) => {
    setPrices((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleSubmit = () => {
    onSubmit(
      items.map((item) => ({
        id: item.id,
        unit_price_cny: prices[item.id]?.unit_price_cny ?? 0,
        samsung_sell_price_vnd: prices[item.id]?.samsung_sell_price_vnd ?? 0,
      }))
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">Nhập giá nhà cung cấp</h3>
          <p className="text-xs text-slate-500 mt-0.5">Nhập đơn giá CNY và giá bán Samsung (VNĐ)</p>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full min-w-[600px]">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100 bg-slate-50/80">
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Mã BQMS</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">SL</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Đơn giá NCC (CNY)</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Giá bán Samsung (VNĐ)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-sm font-mono text-brand-600">{item.bqms_code}</td>
                  <td className="px-4 py-2 text-sm text-slate-600">{item.quantity} {item.unit}</td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={prices[item.id]?.unit_price_cny ?? 0}
                      onChange={(e) => handleChange(item.id, 'unit_price_cny', Number(e.target.value))}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={prices[item.id]?.samsung_sell_price_vnd ?? 0}
                      onChange={(e) => handleChange(item.id, 'samsung_sell_price_vnd', Number(e.target.value))}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            onClick={handleSubmit}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Lưu giá
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Margin Summary Card ────────────────────────────────────────────

function MarginSummaryCard({ quote }: { quote: SupplierQuote }) {
  const pct = quote.avg_margin_percent ?? 0;
  const color =
    pct >= 15 ? 'border-green-200 bg-green-50' :
    pct >= 5  ? 'border-amber-200 bg-amber-50' :
                'border-red-200 bg-red-50';
  const textColor =
    pct >= 15 ? 'text-green-700' :
    pct >= 5  ? 'text-amber-700' :
                'text-red-700';

  return (
    <div className={`rounded-lg border p-4 flex items-center gap-4 ${color}`}>
      <div className={`p-2 rounded-full ${pct >= 15 ? 'bg-green-100' : pct >= 5 ? 'bg-amber-100' : 'bg-red-100'}`}>
        {pct >= 5 ? (
          <TrendingUp className={`h-5 w-5 ${textColor}`} />
        ) : (
          <AlertTriangle className={`h-5 w-5 ${textColor}`} />
        )}
      </div>
      <div>
        <p className="text-xs text-slate-500">Margin trung bình</p>
        <p className={`text-2xl font-bold font-mono ${textColor}`}>{Number(pct ?? 0).toFixed(1)}%</p>
      </div>
      {quote.total_amount_cny != null && (
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-500">Tổng giá NCC</p>
          <p className="text-lg font-bold font-mono text-slate-800">
            ¥{(quote.total_amount_cny ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function SupplierQuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [showPriceDialog, setShowPriceDialog] = useState(false);

  const { data: quote, isLoading, error } = useQuery<SupplierQuote>({
    queryKey: ['supplier-quote', id],
    queryFn: () => api.get(`/api/v1/supplier-quotes/${id}`),
    retry: false,
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) =>
      api.post(`/api/v1/supplier-quotes/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-quote', id] });
      toast.success('Đã cập nhật trạng thái');
    },
    onError: (err: any) => toast.error(err?.detail ?? 'Lỗi cập nhật trạng thái'),
  });

  const enterPricesMutation = useMutation({
    mutationFn: (prices: Array<{ id: number; unit_price_cny: number; samsung_sell_price_vnd: number }>) =>
      api.post(`/api/v1/supplier-quotes/${id}/prices`, { prices }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-quote', id] });
      setShowPriceDialog(false);
      toast.success('Đã lưu giá nhà cung cấp');
    },
    onError: (err: any) => toast.error(err?.detail ?? 'Lỗi lưu giá'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p className="text-sm">Không tìm thấy báo giá hoặc có lỗi xảy ra.</p>
        <Link href="/supplier-quotes" className="text-sm text-brand-600 mt-2 hover:underline">Quay lại danh sách</Link>
      </div>
    );
  }

  const sc = STATUS_CONFIG[quote.status];

  return (
    <div>
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Link href="/supplier-quotes" className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500 mt-0.5">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-display font-bold text-slate-900">{quote.quote_number}</h2>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.className}`}>{sc.label}</span>
            {quote.rfq_number && (
              <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">RFQ: {quote.rfq_number}</span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {quote.supplier.name} · Cập nhật {formatDate(quote.updated_at)}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {quote.status === 'draft' && (
            <button
              onClick={() => updateStatusMutation.mutate('requested')}
              disabled={updateStatusMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
            >
              {updateStatusMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Send className="h-4 w-4" />
              Gửi yêu cầu
            </button>
          )}
          {quote.status === 'requested' && (
            <button
              onClick={() => setShowPriceDialog(true)}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Nhập giá NCC
            </button>
          )}
          {quote.status === 'received' && (
            <>
              <button
                onClick={() => updateStatusMutation.mutate('rejected')}
                disabled={updateStatusMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
              >
                <XCircle className="h-4 w-4" />
                Từ chối
              </button>
              <button
                onClick={() => updateStatusMutation.mutate('accepted')}
                disabled={updateStatusMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
              >
                {updateStatusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Chấp nhận
              </button>
            </>
          )}
          {quote.status === 'accepted' && quote.po_number && (
            <Link
              href={`/purchase-orders/${quote.po_id}`}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              PO: {quote.po_number}
            </Link>
          )}
        </div>
      </div>

      {/* Margin Summary */}
      <div className="mb-6">
        <MarginSummaryCard quote={quote} />
      </div>

      {/* Items Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Chi tiết hàng hóa</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Mã BQMS</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Thông số</th>
                <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Maker</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">SL</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Đơn giá NCC (CNY)</th>
                <th className="text-right text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Giá bán Samsung (VNĐ)</th>
                <th className="text-center text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quote.items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono font-medium text-brand-600">{item.bqms_code}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-slate-700">{item.specification || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-slate-600">{item.maker || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-slate-700">{item.quantity} {item.unit}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.unit_price_cny != null ? (
                      <span className="text-sm font-mono text-slate-900">
                        ¥{(item.unit_price_cny ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.samsung_sell_price_vnd != null ? (
                      <span className="text-sm font-mono text-slate-900">
                        {(item.samsung_sell_price_vnd ?? 0).toLocaleString('vi-VN')}₫
                      </span>
                    ) : (
                      <span className="text-sm text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.margin_percent != null ? (
                      <MarginBadge pct={item.margin_percent} />
                    ) : (
                      <span className="text-sm text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Enter Prices Dialog */}
      {showPriceDialog && (
        <EnterPricesDialog
          items={quote.items}
          onClose={() => setShowPriceDialog(false)}
          onSubmit={(prices) => enterPricesMutation.mutate(prices)}
          isPending={enterPricesMutation.isPending}
        />
      )}
    </div>
  );
}
