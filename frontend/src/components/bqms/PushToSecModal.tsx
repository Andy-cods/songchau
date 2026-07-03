'use client';

/**
 * Push to SEC-BQMS modal (Thang 2026-05-14).
 *
 * Admin click "Đẩy lên SEC" trong BQMS table → modal mở ra với preview:
 *  - Items: image thumbnail (auto/override/upload) + price + abandonment + lead_time
 *  - Submission Opinion (auto-aggregate descriptions của items không abandon)
 *  - Quote Valid Date (today + 3 months)
 *  - File Attachment (list từ L<round> folder)
 * Admin sửa nếu cần → click Push → backend dispatch Procrastinate task.
 */

import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  X, Send, Loader2, AlertCircle, CheckCircle2, Upload, Image as ImageIcon,
  FileText, Calendar, Package, Sparkles, RefreshCw, FileSpreadsheet, FileDown,
  ChevronRight, Eye, Building2, AlertTriangle, TrendingUp,
} from 'lucide-react';

// Helper — backend endpoint /api/v1/bqms/rfq/image requires JWT.
// <img src> không gửi Authorization header được → append ?token=<jwt> query.
// Pattern này được dùng ở BqmsImageThumb hiện hữu, backend hỗ trợ.
function withToken(url: string): string {
  if (typeof window === 'undefined') return url;
  const token = localStorage.getItem('access_token') ?? '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

interface PreviewItem {
  rfq_item_id: number;
  bqms_code: string;
  description: string;
  specification: string | null;
  quantity: number;
  unit: string;
  maker: string;
  image_path: string | null;
  image_source: 'auto' | 'override' | 'missing';
  quotation_price: number;
  abandonment: 'N' | 'Y';
  lead_time_days: number;
  weight: number;  // Thang 2026-05-23: Amount = price × weight × qty
}

interface PreviewData {
  rfq_id: number;
  rfq_number: string;
  classification: 'TM' | 'GC';
  round: number;
  items: PreviewItem[];
  submission_opinion: string;
  quote_valid_date: string;
  attachment_paths: string[];
  warnings: string[];
}

export default function PushToSecModal(
  { rfqId, initialRound = 1, onClose }:
  { rfqId: number; initialRound?: number; onClose: () => void },
) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [opinion, setOpinion] = useState('');
  const [validDate, setValidDate] = useState('');
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  // Batch 2g: user chọn file nào sẽ đẩy. Default = tất cả file của preview.
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [round, setRound] = useState<number>(initialRound);

  useEffect(() => {
    setLoading(true);
    api.get<any>(`/api/v1/bqms/rfq/${rfqId}/push-preview?round_n=${round}`)
      .then((r) => {
        const d: PreviewData = r.data;
        setPreview(d);
        // Default weight=1 nếu backend chưa trả weight
        setItems(d.items.map((it: PreviewItem) => ({ ...it, weight: it.weight ?? 1 })));
        setOpinion(d.submission_opinion);
        setValidDate(d.quote_valid_date);
        setAttachmentPaths(d.attachment_paths);
        setSelectedPaths(new Set(d.attachment_paths)); // default: tất cả checked
      })
      .catch((e: any) => toast.error(`Lỗi load preview: ${e?.detail ?? e?.message}`))
      .finally(() => setLoading(false));
  }, [rfqId, round]);

  // Auto-update opinion when items change (abandonment toggle)
  useEffect(() => {
    const newOpinion = items.filter((i) => i.abandonment === 'N').map((i) => i.description).join(', ');
    if (newOpinion !== opinion && items.length > 0) {
      // Only auto-update if user hasn't manually edited
      // (heuristic: if current opinion matches old items aggregation)
      setOpinion(newOpinion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const totalAmount = useMemo(
    () => items.filter((i) => i.abandonment === 'N')
      .reduce((s, i) => s + i.quotation_price * (i.weight ?? 1) * i.quantity, 0),
    [items],
  );

  const updateItem = (idx: number, patch: Partial<PreviewItem>) => {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  // Batch 2g — attachment selection helpers
  const togglePath = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const allSelected = attachmentPaths.length > 0 && selectedPaths.size === attachmentPaths.length;
  const toggleSelectAll = () => {
    setSelectedPaths(allSelected ? new Set() : new Set(attachmentPaths));
  };

  const handleUploadOverride = async (idx: number, file: File) => {
    const item = items[idx];
    const fd = new FormData();
    fd.append('file', file);
    try {
      toast.info('Đang upload ảnh override...');
      const res: any = await api.post(
        `/api/v1/bqms/rfq/${rfqId}/push-preview/upload-image?bqms_code=${encodeURIComponent(item.bqms_code)}`,
        fd,
      );
      // Reload preview to get resized path
      const r = await api.get<any>(`/api/v1/bqms/rfq/${rfqId}/push-preview?round_n=${round}`);
      const fresh = r.data.items.find((x: PreviewItem) => x.bqms_code === item.bqms_code);
      if (fresh) {
        updateItem(idx, { image_path: fresh.image_path, image_source: fresh.image_source });
      }
      toast.success('Ảnh override đã lưu + resize');
    } catch (e: any) {
      toast.error(`Lỗi upload: ${e?.detail ?? e?.message}`);
    }
  };

  const handlePush = async () => {
    if (!preview) return;
    setPushing(true);
    try {
      const res: any = await api.post(`/api/v1/bqms/rfq/${rfqId}/push-to-sec`, {
        items: items.map((i) => ({
          rfq_item_id: i.rfq_item_id,
          bqms_code: i.bqms_code,
          description: i.description,
          image_path: i.image_path,
          quotation_price: i.quotation_price,
          abandonment: i.abandonment,
          lead_time_days: i.lead_time_days,
        })),
        submission_opinion: opinion,
        quote_valid_date: validDate,
        // Batch 2g: chỉ đẩy file user đã tick (default = tất cả, giữ thứ tự gốc)
        attachment_paths: attachmentPaths.filter((p) => selectedPaths.has(p)),
        round,
      });
      toast.success(`✓ ${res.message}. Job ID: ${res.data.job_id.slice(0, 8)}`);
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
      queryClient.invalidateQueries({ queryKey: ['bqms-push-queue'] });
      onClose();
    } catch (e: any) {
      const errs = e?.detail?.errors ?? [e?.detail ?? e?.message];
      toast.error(
        <div className="text-xs">
          <div className="font-semibold mb-1">Không thể push:</div>
          <ul className="list-disc list-inside">
            {(Array.isArray(errs) ? errs : [errs]).map((er: string, i: number) => <li key={i}>{er}</li>)}
          </ul>
        </div>,
        { duration: 8000 },
      );
    } finally {
      setPushing(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-xl px-10 py-12 shadow-2xl flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-slate-700" />
          <span className="text-xs font-medium text-slate-600">Đang chuẩn bị preview...</span>
        </div>
      </div>
    );
  }

  if (!preview) return null;

  const activeCount = items.filter((i) => i.abandonment === 'N').length;
  const skipCount = items.filter((i) => i.abandonment === 'Y').length;
  // Image only required on V1 — Samsung tự reuse V1 image cho V2/V3/V4.
  // (Backend gate: bqms.py image_required = (body.round == 1); Worker gate: bqms_quote_pusher.py skip when round_n != 1)
  const missingImages = round === 1 ? items.filter((i) => !i.image_path && i.abandonment === 'N').length : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[94vh] overflow-hidden flex flex-col ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — clean dark slate, flat (no gradient) */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-white/10 ring-1 ring-white/20 flex items-center justify-center">
                  <Send className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-display font-bold leading-tight">Đẩy báo giá lên SEC-BQMS</h2>
                  <p className="text-[11px] text-slate-300 leading-tight">
                    Submission đến <span className="font-semibold text-white">Save Temporarily</span> — anh xác nhận lần cuối trên Samsung
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-300 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
              title="Đóng (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Sub-bar: RFQ id + classification + round selector */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 ring-1 ring-white/15">
              <Building2 className="h-3.5 w-3.5 text-slate-300" />
              <span className="font-mono text-xs font-semibold">{preview.rfq_number}</span>
            </div>
            <div className={cn(
              'inline-flex items-center px-2 py-1 rounded-md text-[11px] font-bold tracking-wide ring-1',
              preview.classification === 'GC'
                ? 'bg-brand-500/20 text-brand-200 ring-brand-400/30'
                : 'bg-sky-500/20 text-sky-200 ring-sky-400/30',
            )}>
              {preview.classification === 'GC' ? 'GIA CÔNG' : 'THƯƠNG MẠI'}
            </div>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/10 ring-1 ring-white/15">
              <span className="text-[11px] text-slate-300 uppercase tracking-wide">Vòng</span>
              <select
                value={round}
                onChange={(e) => setRound(parseInt(e.target.value))}
                disabled={pushing}
                className="bg-transparent text-xs font-bold text-white focus:outline-none cursor-pointer"
              >
                <option value={1} className="text-slate-900">V1</option>
                <option value={2} className="text-slate-900">V2</option>
                <option value={3} className="text-slate-900">V3</option>
                <option value={4} className="text-slate-900">V4</option>
              </select>
            </div>
            <div className="flex-1" />
            <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
              <Package className="h-3.5 w-3.5" />
              {activeCount} sẽ đẩy
              {skipCount > 0 && <span className="text-slate-500">· {skipCount} bỏ qua</span>}
            </div>
          </div>
        </div>

        {/* Warnings strip */}
        {(preview.warnings.length > 0 || missingImages > 0) && (
          <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-[12px] text-amber-900 leading-relaxed">
                {missingImages > 0 && (
                  <div><span className="font-semibold">{missingImages} mã chưa có ảnh</span> — bấm "Đổi ảnh" để upload</div>
                )}
                {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            </div>
          </div>
        )}

        {/* V2+ info banner — Samsung reuses V1 image, no upload needed */}
        {round > 1 && (
          <div className="px-6 py-2.5 bg-sky-50 border-b border-sky-200">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-sky-600 mt-0.5 flex-shrink-0" />
              <div className="text-[12px] text-sky-900 leading-relaxed">
                Vòng <span className="font-semibold">V{round}</span>: Samsung tự dùng lại ảnh từ V1, không cần upload ảnh mới.
              </div>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50">
          <div className="p-6 space-y-6">
            {/* === Items list === */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    Mã linh kiện
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Điều chỉnh giá / loại bỏ / lead time trước khi đẩy</p>
                </div>
                <span className="text-[11px] font-mono text-slate-500">{items.length} dòng</span>
              </div>

              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div
                    key={item.bqms_code}
                    className={cn(
                      'rounded-xl border bg-white p-4 transition-all',
                      item.abandonment === 'Y'
                        ? 'border-slate-200 opacity-60 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300 hover:shadow-sm',
                    )}
                  >
                    <div className="grid grid-cols-12 gap-4 items-start">
                      {/* Image — only round 1 (round 2-4 reuse Samsung's saved V1 image) */}
                      {round === 1 && (
                        <div className="col-span-2">
                          <div className="relative group">
                            {item.image_path ? (
                              <div className="aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={withToken(`/api/v1/bqms/rfq/image?bqms_code=${encodeURIComponent(item.bqms_code)}&rfq_number=${encodeURIComponent(preview.rfq_number)}`)}
                                  alt={item.bqms_code}
                                  className="w-full h-full object-cover"
                                  onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                                />
                              </div>
                            ) : (
                              <div className="aspect-square rounded-lg bg-rose-50 border border-rose-200 flex flex-col items-center justify-center gap-1">
                                <ImageIcon className="h-6 w-6 text-rose-400" strokeWidth={1.5} />
                                <span className="text-[11px] text-rose-700 font-semibold">Thiếu ảnh</span>
                              </div>
                            )}
                            {/* Source chip */}
                            {item.image_path && (
                              <div className={cn(
                                'absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold tracking-wide backdrop-blur shadow-sm',
                                item.image_source === 'override'
                                  ? 'bg-emerald-600/95 text-white'
                                  : 'bg-slate-900/80 text-white',
                              )}>
                                {item.image_source === 'override' ? 'Đã sửa' : 'Tự động'}
                              </div>
                            )}
                            {/* Replace button */}
                            <label className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 px-2 py-1 bg-white/95 hover:bg-white border border-slate-200 shadow-sm rounded text-[11px] font-semibold text-slate-700 cursor-pointer transition-all opacity-90 group-hover:opacity-100">
                              <Upload className="h-3 w-3" />
                              Đổi ảnh
                              <input
                                type="file"
                                className="hidden"
                                accept="image/png,image/jpeg"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleUploadOverride(idx, f);
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Info column */}
                      <div className={cn(round === 1 ? 'col-span-7' : 'col-span-9', 'min-w-0')}>
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[11px] font-bold text-slate-800 bg-slate-100 ring-1 ring-slate-200">
                            {item.bqms_code}
                          </span>
                          {item.maker && (
                            <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">
                              {item.maker}
                            </span>
                          )}
                          <span className="text-[11px] text-slate-500">
                            Qty: <span className="font-semibold text-slate-700">{item.quantity}</span> {item.unit}
                          </span>
                        </div>
                        <p className="text-[12.5px] text-slate-700 mb-3 line-clamp-2 leading-relaxed">
                          {item.description}
                        </p>

                        <div className="grid grid-cols-3 gap-2.5">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                              Đơn giá
                            </label>
                            <div className="relative">
                              <input
                                type="number"
                                value={item.quotation_price}
                                onChange={(e) => updateItem(idx, { quotation_price: Number(e.target.value) || 0 })}
                                disabled={item.abandonment === 'Y'}
                                className="w-full pl-2.5 pr-9 py-1.5 border border-slate-200 rounded-md text-sm font-mono font-semibold tabular-nums focus:outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-50 disabled:text-slate-400 transition-shadow"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-400 pointer-events-none">
                                VND
                              </span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                              Trạng thái
                            </label>
                            <select
                              value={item.abandonment}
                              onChange={(e) => updateItem(idx, { abandonment: e.target.value as 'N' | 'Y' })}
                              className={cn(
                                'w-full px-2.5 py-1.5 border rounded-md text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-slate-100 cursor-pointer transition-colors',
                                item.abandonment === 'Y'
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                              )}
                            >
                              <option value="N">Báo giá</option>
                              <option value="Y">Không báo</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                              Lead time
                            </label>
                            <div className="relative">
                              <input
                                type="number"
                                value={item.lead_time_days}
                                onChange={(e) => updateItem(idx, { lead_time_days: Number(e.target.value) || 30 })}
                                disabled={item.abandonment === 'Y'}
                                className="w-full pl-2.5 pr-10 py-1.5 border border-slate-200 rounded-md text-sm font-mono tabular-nums focus:outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-50 disabled:text-slate-400 transition-shadow"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-400 pointer-events-none">
                                ngày
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Total column */}
                      <div className="col-span-3 flex flex-col items-end justify-between text-right pl-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider">T.Lượng</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.weight ?? 1}
                            onChange={(e) => updateItem(idx, { weight: Math.max(0, Number(e.target.value) || 0) })}
                            className="w-14 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-right text-xs font-mono outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                            title="Trọng lượng (kg) — Thành tiền = Giá × Trọng lượng × Số lượng"
                          />
                        </div>
                        <div className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider mt-1">Thành tiền</div>
                        <div className="font-display text-xl font-bold text-slate-900 tabular-nums leading-tight">
                          {(item.quotation_price * (item.weight ?? 1) * item.quantity).toLocaleString('vi-VN')}
                        </div>
                        <div className="text-[11px] font-medium text-slate-500 mt-0.5">VND</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          = {item.quotation_price.toLocaleString('vi-VN')} × {item.weight ?? 1} × {item.quantity}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* === Submission info + Attachments — 2 column === */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Submission */}
              <section>
                <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-wider mb-2 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Thông tin submission
                </h3>
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                      Hạn báo giá hợp lệ
                    </label>
                    <input
                      type="date"
                      value={validDate}
                      onChange={(e) => setValidDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                      Ghi chú submission (Submission Opinion)
                    </label>
                    <textarea
                      rows={3}
                      value={opinion}
                      onChange={(e) => setOpinion(e.target.value)}
                      placeholder="Tự động tổng hợp mô tả các mã — anh sửa nếu cần"
                      className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 resize-none transition-shadow"
                    />
                  </div>
                </div>
              </section>

              {/* Attachments */}
              <section>
                <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-wider mb-2 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  File đính kèm
                  {attachmentPaths.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="ml-2 normal-case tracking-normal text-[11px] font-semibold text-brand-600 hover:text-brand-700 hover:underline transition-colors"
                    >
                      {allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  )}
                  <span className={cn(
                    'ml-auto px-1.5 py-0.5 rounded text-[11px] font-bold',
                    attachmentPaths.length === 0
                      ? 'bg-rose-100 text-rose-700'
                      : selectedPaths.size === 0
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700',
                  )}>
                    {selectedPaths.size}/{attachmentPaths.length} file sẽ đẩy
                  </span>
                </h3>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  {attachmentPaths.length === 0 ? (
                    <div className="text-center py-6">
                      <AlertCircle className="h-8 w-8 text-rose-400 mx-auto mb-2" strokeWidth={1.5} />
                      <p className="text-sm font-semibold text-rose-700">Chưa có file đính kèm</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Anh cần báo giá V{round} trong ERP trước (Excel + PDF sẽ tự sinh)
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {attachmentPaths.map((p, i) => {
                        const filename = p.split('/').pop() || p;
                        const ext = filename.split('.').pop()?.toUpperCase() ?? '';
                        const Icon = ext === 'PDF'
                          ? FileDown
                          : (ext === 'XLSX' || ext === 'XLS') ? FileSpreadsheet : FileText;
                        const checked = selectedPaths.has(p);
                        return (
                          <li key={i}>
                            <label
                              className={cn(
                                'flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-slate-50 group transition-colors cursor-pointer',
                                !checked && 'opacity-50',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePath(p)}
                                className="h-4 w-4 flex-shrink-0 rounded border-slate-300 accent-brand-600 cursor-pointer"
                              />
                              <Icon className={cn(
                                'h-4 w-4 flex-shrink-0',
                                ext === 'PDF' ? 'text-rose-600'
                                  : (ext === 'XLSX' || ext === 'XLS') ? 'text-emerald-600'
                                    : 'text-slate-500',
                              )} />
                              <span className="font-mono text-[12px] text-slate-700 truncate flex-1">{filename}</span>
                              <span className={cn(
                                'px-1.5 py-0.5 rounded text-[11px] font-bold',
                                ext === 'PDF' ? 'bg-rose-50 text-rose-700'
                                  : (ext === 'XLSX' || ext === 'XLS') ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-slate-100 text-slate-600',
                              )}>
                                {ext}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {attachmentPaths.length > 0 && selectedPaths.size === 0 && (
                    <p className="mt-2.5 pt-2.5 border-t border-slate-100 text-[11px] text-amber-700 flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                      Chưa chọn file nào — sẽ đẩy báo giá <span className="font-semibold">không kèm file</span>.
                    </p>
                  )}
                </div>
              </section>
            </div>

            {/* Push flow note */}
            <div className="flex items-start gap-3 p-4 bg-sky-50 border border-sky-200 rounded-xl">
              <Sparkles className="h-5 w-5 text-sky-600 mt-0.5 flex-shrink-0" />
              <div className="text-[12.5px] text-sky-900 leading-relaxed">
                Sau khi bấm <span className="font-semibold">Đẩy lên SEC</span>, hệ thống tự đăng nhập sec-bqms.com,
                fill form, upload file, và lưu ở <span className="font-semibold">Save Temporarily</span>.
                Anh vào portal kiểm tra lần cuối rồi mới bấm <span className="font-semibold">Submit</span> để gửi Samsung.
              </div>
            </div>
          </div>
        </div>

        {/* Footer — sticky, clear total emphasis */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider">Tổng đơn hàng</div>
                <div className="font-display text-xl font-bold text-slate-900 tabular-nums leading-tight">
                  {totalAmount.toLocaleString('vi-VN')}
                  <span className="text-sm text-slate-500 font-medium ml-1">VND</span>
                </div>
              </div>
              <div className="h-10 w-px bg-slate-200" />
              <div className="text-[11px] text-slate-600 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  {activeCount} mã sẽ đẩy
                </div>
                {skipCount > 0 && (
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <X className="h-3 w-3" />
                    {skipCount} mã bỏ qua
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={pushing}
                className="px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-50 transition-colors"
              >
                Huỷ
              </button>
              <button
                onClick={handlePush}
                disabled={pushing || activeCount === 0 || attachmentPaths.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 active:bg-slate-950 rounded-lg disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow"
              >
                {pushing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Đang queue...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Đẩy lên SEC V{round}
                    <ChevronRight className="h-4 w-4 opacity-70" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
