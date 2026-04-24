'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ChevronLeft,
  Plus,
  Globe,
  CheckCircle2,
  Loader2,
  X,
  AlertCircle,
  Package,
  Trophy,
  ClipboardList,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import type { StatusVariant } from '@/lib/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BatchItem {
  id: number;
  specification: string;
  bqms_code: string | null;
  quantity: number;
  unit: string;
  required_material: string | null;
  target_price: number | null;
}

interface QuoteCell {
  item_id: number;
  vendor_id: number;
  vendor_name: string;
  unit_price: number;
  currency: 'VND' | 'USD' | 'RMB';
}

interface ComparisonRow {
  item_id: number;
  vendor_quotes: {
    vendor_id: number;
    unit_price: number | null;
    currency: string | null;
  }[];
}

interface BatchDetail {
  id: number;
  batch_code: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published' | 'awarded' | 'cancelled';
  award_mode: 'per_item' | 'per_batch';
  notes_internal: string | null;
  item_count: number;
  quote_count: number;
  created_at: string;
  published_at: string | null;
  items: BatchItem[];
  quotes: QuoteCell[];
  comparison: ComparisonRow[];
}

interface BatchDetailResponse {
  data: BatchDetail;
}

interface AddItemForm {
  specification: string;
  bqms_code: string;
  quantity: string;
  unit: string;
  required_material: string;
  target_price: string;
}

const EMPTY_ITEM_FORM: AddItemForm = {
  specification: '',
  bqms_code: '',
  quantity: '',
  unit: 'cái',
  required_material: '',
  target_price: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBatchStatusConfig(status: BatchDetail['status']): { label: string; variant: StatusVariant } {
  switch (status) {
    case 'draft':     return { label: 'Nháp',        variant: 'neutral' };
    case 'published': return { label: 'Đang mở',     variant: 'info'    };
    case 'awarded':   return { label: 'Đã chọn NCC', variant: 'success' };
    case 'cancelled': return { label: 'Đã hủy',      variant: 'danger'  };
  }
}

function getAwardModeLabel(mode: 'per_item' | 'per_batch'): string {
  return mode === 'per_item' ? 'Theo hạng mục' : 'Theo đợt';
}

// ─── Add Items Modal ──────────────────────────────────────────────────────────

interface AddItemsModalProps {
  batchId: number;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function AddItemsModal({ batchId, open, onClose, onSuccess }: AddItemsModalProps) {
  const [items, setItems] = useState<AddItemForm[]>([{ ...EMPTY_ITEM_FORM }]);
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/procurement/batches/${batchId}/items`, {
        items: items.map((it) => ({
          specification: it.specification.trim(),
          bqms_code: it.bqms_code.trim() || undefined,
          quantity: parseFloat(it.quantity) || 0,
          unit: it.unit.trim(),
          required_material: it.required_material.trim() || undefined,
          target_price: it.target_price ? parseFloat(it.target_price) : undefined,
        })),
      }),
    onSuccess: () => {
      onSuccess();
      onClose();
      setItems([{ ...EMPTY_ITEM_FORM }]);
      setError(null);
    },
    onError: () => setError('Thêm hạng mục thất bại. Vui lòng thử lại.'),
  });

  function addRow() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM_FORM }]);
  }

  function removeRow(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: keyof AddItemForm, value: string) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasEmpty = items.some((it) => !it.specification.trim() || !it.quantity || !it.unit.trim());
    if (hasEmpty) {
      setError('Vui lòng điền đầy đủ: Mô tả, Số lượng, Đơn vị cho tất cả hạng mục.');
      return;
    }
    setError(null);
    mutate();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mt-8 mb-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <Package className="h-4 w-4 text-brand-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Thêm hạng mục</h2>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_100px_80px_80px_100px_120px_32px] gap-2 text-xs font-medium text-slate-500 px-1">
            <span>Mô tả / Đặc tính</span>
            <span>Mã BQMS</span>
            <span>SL</span>
            <span>ĐVT</span>
            <span>Vật liệu YC</span>
            <span>Giá mục tiêu</span>
            <span />
          </div>

          {/* Item rows */}
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-[1fr_100px_80px_80px_100px_120px_32px] gap-2 items-start">
                <input
                  type="text"
                  value={item.specification}
                  onChange={(e) => updateRow(index, 'specification', e.target.value)}
                  placeholder="Mô tả hạng mục..."
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-slate-300"
                />
                <input
                  type="text"
                  value={item.bqms_code}
                  onChange={(e) => updateRow(index, 'bqms_code', e.target.value)}
                  placeholder="Mã BQMS"
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-slate-300 font-mono"
                />
                <input
                  type="number"
                  value={item.quantity}
                  onChange={(e) => updateRow(index, 'quantity', e.target.value)}
                  placeholder="0"
                  min="0"
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-slate-300 font-mono text-right"
                />
                <input
                  type="text"
                  value={item.unit}
                  onChange={(e) => updateRow(index, 'unit', e.target.value)}
                  placeholder="cái"
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-slate-300"
                />
                <input
                  type="text"
                  value={item.required_material}
                  onChange={(e) => updateRow(index, 'required_material', e.target.value)}
                  placeholder="SS316..."
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-slate-300"
                />
                <input
                  type="number"
                  value={item.target_price}
                  onChange={(e) => updateRow(index, 'target_price', e.target.value)}
                  placeholder="0"
                  min="0"
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-slate-300 font-mono text-right"
                />
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  disabled={items.length === 1}
                  className="h-7 w-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors mt-0.5"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm dòng
          </button>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1 border-t border-slate-100 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Lưu hạng mục ({items.length})
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Award Confirm Modal ──────────────────────────────────────────────────────

interface AwardConfirmModalProps {
  open: boolean;
  batchId: number;
  awardMode: 'per_item' | 'per_batch';
  // per_batch: single vendor selection
  vendors: { id: number; name: string }[];
  // per_item: item-level pre-selected winner
  itemAwards?: { item_id: number; vendor_id: number; vendor_name: string; price: number; currency: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

function AwardConfirmModal({
  open,
  batchId,
  awardMode,
  vendors,
  itemAwards,
  onClose,
  onSuccess,
}: AwardConfirmModalProps) {
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      if (awardMode === 'per_batch') {
        return api.post(`/api/v1/procurement/batches/${batchId}/award`, {
          vendor_id: selectedVendorId,
        });
      }
      return api.post(`/api/v1/procurement/batches/${batchId}/award`, {
        awards: itemAwards?.map((a) => ({
          item_id: a.item_id,
          vendor_id: a.vendor_id,
          price: a.price,
          currency: a.currency,
        })),
      });
    },
    onSuccess: () => {
      onSuccess();
      onClose();
      setError(null);
    },
    onError: () => setError('Chọn NCC thất bại. Vui lòng thử lại.'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (awardMode === 'per_batch' && !selectedVendorId) {
      setError('Vui lòng chọn nhà cung cấp.');
      return;
    }
    setError(null);
    mutate();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Trophy className="h-4 w-4 text-emerald-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Chốt nhà cung cấp</h2>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {awardMode === 'per_batch' ? (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">
                Chọn nhà cung cấp cho toàn đợt
              </label>
              <div className="space-y-2">
                {vendors.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVendorId(v.id)}
                    className={cn(
                      'w-full px-3 py-2.5 rounded-lg border text-left text-sm transition-colors',
                      selectedVendorId === v.id
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-medium'
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    )}
                  >
                    {selectedVendorId === v.id && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 inline mr-2" />
                    )}
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-slate-600 mb-3">
                Xác nhận chốt các NCC rẻ nhất theo từng hạng mục:
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {(itemAwards ?? []).map((a) => (
                  <div
                    key={a.item_id}
                    className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg text-xs"
                  >
                    <span className="text-slate-700 truncate flex-1 mr-3">HM #{a.item_id}</span>
                    <span className="text-emerald-700 font-medium whitespace-nowrap">{a.vendor_name}</span>
                    <span className="text-slate-500 font-mono ml-3 whitespace-nowrap">
                      {formatCurrency(a.price, a.currency as 'VND' | 'USD' | 'RMB')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <Trophy className="h-3.5 w-3.5" />
              Xác nhận chốt
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Comparison Table ─────────────────────────────────────────────────────────

interface ComparisonTableProps {
  batch: BatchDetail;
  onAwardItem: (itemId: number, vendorId: number, price: number, currency: string, vendorName: string) => void;
}

function ComparisonTable({ batch, onAwardItem }: ComparisonTableProps) {
  const { items, quotes } = batch;

  // Build unique vendor list from quotes
  const vendorMap = new Map<number, string>();
  quotes.forEach((q) => vendorMap.set(q.vendor_id, q.vendor_name));
  const vendors = Array.from(vendorMap.entries()).map(([id, name]) => ({ id, name }));

  if (vendors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <ClipboardList className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">Chưa có báo giá nào</p>
        <p className="text-xs mt-1">Nhà cung cấp sẽ gửi báo giá sau khi đợt được công bố</p>
      </div>
    );
  }

  // Map: item_id -> vendor_id -> {price, currency}
  const priceMap = new Map<number, Map<number, { price: number; currency: string }>>();
  quotes.forEach((q) => {
    if (!priceMap.has(q.item_id)) priceMap.set(q.item_id, new Map());
    priceMap.get(q.item_id)!.set(q.vendor_id, { price: q.unit_price, currency: q.currency });
  });

  // Compute min/max per item row
  function getRowStats(itemId: number): { min: number | null; max: number | null } {
    const row = priceMap.get(itemId);
    if (!row) return { min: null, max: null };
    const prices = Array.from(row.values()).map((v) => v.price);
    if (prices.length === 0) return { min: null, max: null };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-slate-50">
            <th className="text-left px-4 py-2.5 font-medium text-slate-500 border-b border-r border-slate-200 sticky left-0 bg-slate-50 min-w-[220px]">
              Hạng mục
            </th>
            <th className="text-right px-3 py-2.5 font-medium text-slate-500 border-b border-r border-slate-200 whitespace-nowrap">
              Giá MT
            </th>
            {vendors.map((v) => (
              <th
                key={v.id}
                className="text-center px-3 py-2.5 font-medium text-slate-600 border-b border-r border-slate-200 min-w-[130px] whitespace-nowrap"
              >
                {v.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => {
            const { min, max } = getRowStats(item.id);
            const rowPrices = priceMap.get(item.id);

            return (
              <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                {/* Item spec */}
                <td className="px-4 py-3 border-r border-slate-100 sticky left-0 bg-white hover:bg-slate-50 transition-colors">
                  <div className="font-medium text-slate-800 leading-snug">{item.specification}</div>
                  <div className="flex items-center gap-2 mt-0.5 text-slate-400">
                    {item.bqms_code && (
                      <span className="font-mono">{item.bqms_code}</span>
                    )}
                    <span>
                      {item.quantity} {item.unit}
                    </span>
                    {item.required_material && (
                      <span className="truncate max-w-[100px]">{item.required_material}</span>
                    )}
                  </div>
                </td>

                {/* Target price */}
                <td className="px-3 py-3 text-right border-r border-slate-100 font-mono text-slate-400">
                  {item.target_price ? formatCurrency(item.target_price) : '—'}
                </td>

                {/* Vendor prices */}
                {vendors.map((v) => {
                  const cell = rowPrices?.get(v.id);
                  if (!cell) {
                    return (
                      <td
                        key={v.id}
                        className="px-3 py-3 text-center text-slate-300 border-r border-slate-100"
                      >
                        —
                      </td>
                    );
                  }

                  const isCheapest = min !== null && cell.price === min && vendors.length > 1;
                  const isMostExpensive = max !== null && cell.price === max && vendors.length > 1 && min !== max;

                  return (
                    <td
                      key={v.id}
                      className={cn(
                        'px-3 py-3 border-r border-slate-100 text-center',
                        isCheapest && 'bg-emerald-50',
                        isMostExpensive && 'bg-red-50'
                      )}
                    >
                      <div
                        className={cn(
                          'font-mono font-medium',
                          isCheapest ? 'text-emerald-700' : isMostExpensive ? 'text-red-600' : 'text-slate-700'
                        )}
                      >
                        {formatCurrency(cell.price, cell.currency as 'VND' | 'USD' | 'RMB')}
                      </div>
                      {isCheapest && batch.award_mode === 'per_item' && batch.status === 'published' && (
                        <button
                          onClick={() => onAwardItem(item.id, v.id, cell.price, cell.currency, v.name)}
                          className="mt-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
                        >
                          Chọn NCC
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const batchId = parseInt(params.id, 10);
  const queryClient = useQueryClient();

  const [showAddItems, setShowAddItems] = useState(false);
  const [showAward, setShowAward] = useState(false);
  const [pendingItemAward, setPendingItemAward] = useState<{
    item_id: number;
    vendor_id: number;
    vendor_name: string;
    price: number;
    currency: string;
  } | null>(null);

  // ── Query ────────────────────────────────────────────────────────────────────

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['procurement-batch', batchId],
    queryFn: () =>
      api.get(`/api/v1/procurement/batches/${batchId}`) as Promise<BatchDetailResponse>,
    enabled: !isNaN(batchId),
  });

  // ── Publish mutation ─────────────────────────────────────────────────────────

  const { mutate: publishBatch, isPending: isPublishing } = useMutation({
    mutationFn: () => api.patch(`/api/v1/procurement/batches/${batchId}/publish`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procurement-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['procurement-batches'] });
    },
  });

  const batch = data?.data;

  // ── Vendor list for per_batch award ─────────────────────────────────────────

  const vendorMap = new Map<number, string>();
  batch?.quotes?.forEach((q) => vendorMap.set(q.vendor_id, q.vendor_name));
  const vendorList = Array.from(vendorMap.entries()).map(([id, name]) => ({ id, name }));

  // Build cheapest-per-item awards for per_item mode
  const cheapestItemAwards = (() => {
    if (!batch || batch.award_mode !== 'per_item') return [];
    const priceMap = new Map<number, { vendor_id: number; vendor_name: string; price: number; currency: string }>();
    batch.quotes.forEach((q) => {
      const cur = priceMap.get(q.item_id);
      if (!cur || q.unit_price < cur.price) {
        priceMap.set(q.item_id, {
          vendor_id: q.vendor_id,
          vendor_name: q.vendor_name,
          price: q.unit_price,
          currency: q.currency,
        });
      }
    });
    return Array.from(priceMap.entries()).map(([item_id, v]) => ({ item_id, ...v }));
  })();

  // ── Loading / Error states ───────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="space-y-4">
          <div className="h-8 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-24 bg-white rounded-xl border border-slate-200 animate-pulse" />
          <div className="h-64 bg-white rounded-xl border border-slate-200 animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError || !batch) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-64 gap-3">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="text-sm text-slate-600">Không tải được dữ liệu. Vui lòng thử lại.</p>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 text-sm font-medium text-brand-600 border border-brand-200 rounded-lg hover:bg-brand-50 transition-colors"
        >
          Thử lại
        </button>
      </div>
    );
  }

  const statusCfg = getBatchStatusConfig(batch.status);
  const hasQuotes = batch.quotes && batch.quotes.length > 0;

  return (
    <div className="p-6 space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Link href="/procurement" className="hover:text-brand-600 transition-colors">
          Mua hàng
        </Link>
        <ChevronLeft className="h-3 w-3 rotate-180" />
        <span className="text-slate-600 font-medium">{batch.batch_code}</span>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-slate-400">{batch.batch_code}</span>
              <StatusBadge
                label={statusCfg.label}
                variant={statusCfg.variant}
                pulse={batch.status === 'published'}
              />
              <span className="text-xs text-slate-400">
                {getAwardModeLabel(batch.award_mode)}
              </span>
            </div>
            <h1 className="text-lg font-bold text-slate-900 mt-1 leading-snug">{batch.title}</h1>
            {batch.description && (
              <p className="text-sm text-slate-500 mt-1">{batch.description}</p>
            )}
            <div className="flex items-center gap-4 mt-3 text-xs text-slate-400 font-mono">
              <span>{batch.item_count} hạng mục</span>
              <span>{batch.quote_count} báo giá</span>
              <span>Tạo {formatDate(batch.created_at)}</span>
              {batch.published_at && <span>Công bố {formatDate(batch.published_at)}</span>}
            </div>
            {batch.notes_internal && (
              <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
                <span className="font-medium">Ghi chú nội bộ: </span>
                {batch.notes_internal}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {batch.status === 'draft' && (
              <>
                <button
                  onClick={() => setShowAddItems(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Thêm HM
                </button>
                <button
                  onClick={() => publishBatch()}
                  disabled={isPublishing || batch.item_count === 0}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-cyan-600 rounded-lg hover:bg-cyan-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {isPublishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Globe className="h-4 w-4" />
                  )}
                  Công bố
                </button>
              </>
            )}
            {batch.status === 'published' && hasQuotes && (
              <button
                onClick={() => setShowAward(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <Trophy className="h-4 w-4" />
                Chốt NCC
              </button>
            )}
            {batch.status === 'published' && (
              <button
                onClick={() => setShowAddItems(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Thêm HM
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">Danh sách hạng mục</h2>
          <span className="text-xs text-slate-400 font-mono">{batch.item_count} hạng mục</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 w-8">#</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Mô tả / Đặc tính</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 whitespace-nowrap">Mã BQMS</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500 whitespace-nowrap">Số lượng</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 whitespace-nowrap">ĐVT</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 whitespace-nowrap">Vật liệu YC</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500 whitespace-nowrap">Giá mục tiêu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batch.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    Chưa có hạng mục nào. Nhấn &quot;Thêm HM&quot; để bắt đầu.
                  </td>
                </tr>
              ) : (
                batch.items.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-400 font-mono">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800 block leading-snug max-w-[280px]">
                        {item.specification}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {item.bqms_code ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">
                      {new Intl.NumberFormat('vi-VN').format(item.quantity)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{item.unit}</td>
                    <td className="px-4 py-3 text-slate-500">{item.required_material ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">
                      {formatCurrency(item.target_price)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Comparison table */}
      {(batch.status === 'published' || batch.status === 'awarded') && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">So sánh báo giá</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                  <span className="h-2 w-2 rounded-sm bg-emerald-500 inline-block" />
                  Rẻ nhất
                </span>
                <span className="mx-2 text-slate-200">|</span>
                <span className="inline-flex items-center gap-1 text-red-500 font-medium">
                  <span className="h-2 w-2 rounded-sm bg-red-400 inline-block" />
                  Đắt nhất
                </span>
              </p>
            </div>
            <span className="text-xs text-slate-400 font-mono">{vendorList.length} NCC</span>
          </div>
          <ComparisonTable
            batch={batch}
            onAwardItem={(itemId, vendorId, price, currency, vendorName) => {
              setPendingItemAward({ item_id: itemId, vendor_id: vendorId, vendor_name: vendorName, price, currency });
              setShowAward(true);
            }}
          />
        </div>
      )}

      {/* Modals */}
      <AddItemsModal
        batchId={batchId}
        open={showAddItems}
        onClose={() => setShowAddItems(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['procurement-batch', batchId] });
        }}
      />

      <AwardConfirmModal
        open={showAward}
        batchId={batchId}
        awardMode={batch.award_mode}
        vendors={vendorList}
        itemAwards={
          pendingItemAward
            ? [pendingItemAward]
            : cheapestItemAwards
        }
        onClose={() => {
          setShowAward(false);
          setPendingItemAward(null);
        }}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['procurement-batch', batchId] });
          queryClient.invalidateQueries({ queryKey: ['procurement-batches'] });
          router.push('/procurement');
        }}
      />
    </div>
  );
}
