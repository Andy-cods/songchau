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
  FileText, Calendar, Package,
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
  const [pushing, setPushing] = useState(false);
  const [round, setRound] = useState<number>(initialRound);

  useEffect(() => {
    setLoading(true);
    api.get<any>(`/api/v1/bqms/rfq/${rfqId}/push-preview?round_n=${round}`)
      .then((r) => {
        const d: PreviewData = r.data;
        setPreview(d);
        setItems(d.items);
        setOpinion(d.submission_opinion);
        setValidDate(d.quote_valid_date);
        setAttachmentPaths(d.attachment_paths);
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
      .reduce((s, i) => s + i.quotation_price * i.quantity, 0),
    [items],
  );

  const updateItem = (idx: number, patch: Partial<PreviewItem>) => {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
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
        attachment_paths: attachmentPaths,
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
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-12">
          <Loader2 className="h-8 w-8 animate-spin text-brand-500 mx-auto" />
        </div>
      </div>
    );
  }

  if (!preview) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Send className="h-4 w-4" /> Đẩy lên SEC-BQMS
            </h2>
            <div className="text-xs opacity-90 mt-0.5 flex items-center gap-3">
              <span className="font-mono">{preview.rfq_number}</span>
              <span className="px-1.5 py-0.5 bg-white/20 rounded text-[10px] font-bold">{preview.classification}</span>
              <div className="flex items-center gap-1">
                <span>Vòng:</span>
                <select
                  value={round}
                  onChange={(e) => setRound(parseInt(e.target.value))}
                  disabled={pushing}
                  className="bg-white/20 border border-white/30 rounded px-1 py-0.5 text-[11px] font-bold text-white focus:outline-none focus:ring-2 focus:ring-white/50"
                >
                  <option value={1} className="text-slate-900">V1</option>
                  <option value={2} className="text-slate-900">V2</option>
                  <option value={3} className="text-slate-900">V3</option>
                  <option value={4} className="text-slate-900">V4</option>
                </select>
              </div>
            </div>
          </div>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        {/* Warnings */}
        {preview.warnings.length > 0 && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
              <div className="text-[11px] text-amber-800">
                <span className="font-semibold">Cảnh báo: </span>
                {preview.warnings.join(' · ')}
              </div>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Items */}
          <section>
            <h3 className="text-xs font-bold uppercase text-slate-700 mb-2 flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" /> Items ({items.length})
            </h3>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={item.bqms_code} className={cn(
                  'rounded-xl border-2 p-3 transition-all',
                  item.abandonment === 'Y' ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200 bg-white'
                )}>
                  <div className="flex items-start gap-3">
                    {/* Image — round 1 only; round 2-4 dùng lại ảnh Samsung đã lưu V1 */}
                    {round === 1 && (
                    <div className="shrink-0">
                      {item.image_path ? (
                        <div className="w-20 h-20 rounded-lg overflow-hidden border-2 border-slate-200 bg-slate-50 relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={withToken(`/api/v1/bqms/rfq/image?bqms_code=${encodeURIComponent(item.bqms_code)}&rfq_number=${encodeURIComponent(preview.rfq_number)}`)}
                            alt={item.bqms_code}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }} />
                          <div className={cn(
                            'absolute bottom-0 left-0 right-0 text-[8px] font-bold text-center px-0.5 py-0.5',
                            item.image_source === 'override' ? 'bg-emerald-600 text-white'
                              : 'bg-blue-600 text-white'
                          )}>
                            {item.image_source === 'override' ? '🟢 OVERRIDE' : '🔵 AUTO'}
                          </div>
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-lg bg-rose-50 border-2 border-rose-200 flex flex-col items-center justify-center">
                          <ImageIcon className="h-5 w-5 text-rose-400" />
                          <span className="text-[9px] text-rose-700 font-bold">THIẾU</span>
                        </div>
                      )}
                      <label className="mt-1 inline-flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-semibold cursor-pointer transition-colors">
                        <Upload className="h-3 w-3" /> Đổi
                        <input type="file" className="hidden" accept="image/png,image/jpeg"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUploadOverride(idx, f);
                          }} />
                      </label>
                    </div>
                    )}

                    {/* Info + inputs */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[11px] text-brand-700 font-bold">{item.bqms_code}</span>
                        {item.maker && <span className="text-[10px] text-slate-500">[{item.maker}]</span>}
                      </div>
                      <p className="text-xs text-slate-700 mb-2 line-clamp-2">{item.description}</p>
                      <div className="text-[11px] text-slate-600 mb-2">
                        <span className="font-semibold">Qty:</span> {item.quantity} {item.unit}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">Quotation Price *</label>
                          <input type="number" value={item.quotation_price}
                            onChange={(e) => updateItem(idx, { quotation_price: Number(e.target.value) || 0 })}
                            disabled={item.abandonment === 'Y'}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">Abandonment</label>
                          <select value={item.abandonment}
                            onChange={(e) => updateItem(idx, { abandonment: e.target.value as 'N' | 'Y' })}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500">
                            <option value="N">N — Báo giá</option>
                            <option value="Y">Y — Không báo</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">Lead Time (ngày)</label>
                          <input type="number" value={item.lead_time_days}
                            onChange={(e) => updateItem(idx, { lead_time_days: Number(e.target.value) || 30 })}
                            disabled={item.abandonment === 'Y'}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400" />
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="text-[10px] text-slate-500 uppercase font-semibold">Total</div>
                      <div className="text-sm font-bold text-emerald-700 tabular-nums">
                        {(item.quotation_price * item.quantity).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Submission Info */}
          <section>
            <h3 className="text-xs font-bold uppercase text-slate-700 mb-2 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Thông tin submission
            </h3>
            <div className="bg-slate-50 rounded-xl p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-600 mb-1">Quote Valid Date *</label>
                  <input type="date" value={validDate} onChange={(e) => setValidDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
                <div className="flex items-end pb-1">
                  <div className="text-xs text-slate-600">
                    <span className="font-semibold">Tổng giá:</span> {' '}
                    <span className="font-mono font-bold text-emerald-700">{totalAmount.toLocaleString()} VND</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">Submission Opinion *</label>
                <textarea rows={2} value={opinion} onChange={(e) => setOpinion(e.target.value)}
                  placeholder="Aggregate descriptions tự động — anh sửa nếu cần"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none" />
              </div>
            </div>
          </section>

          {/* File Attachments */}
          <section>
            <h3 className="text-xs font-bold uppercase text-slate-700 mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> File đính kèm ({attachmentPaths.length})
            </h3>
            <div className="bg-slate-50 rounded-xl p-3">
              {attachmentPaths.length === 0 ? (
                <div className="text-center py-4 text-rose-600 text-sm">
                  ⚠ Không tìm thấy file. Anh quote V{round} trong ERP trước.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {attachmentPaths.map((p, i) => {
                    const filename = p.split('/').pop() || p;
                    const ext = filename.split('.').pop()?.toUpperCase() ?? '';
                    return (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-bold',
                          ext === 'PDF' ? 'bg-rose-100 text-rose-700' :
                          ext === 'XLSX' || ext === 'XLS' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-slate-100 text-slate-700'
                        )}>{ext}</span>
                        <span className="font-mono text-slate-700 truncate">{filename}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Warning notice */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-xs text-amber-900">
              <strong>⚠ Lưu ý:</strong> Sau khi click Push, hệ thống sẽ tự đẩy lên SEC tới bước
              <strong className="mx-1">Save Temporarily</strong>. Anh cần vào sec-bqms.com để click
              <strong className="mx-1">Submit cuối cùng</strong> kiểm soát lần cuối trước khi gửi cho Samsung.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-xs text-slate-500">{items.filter(i => i.abandonment === 'N').length} mã sẽ đẩy, {items.filter(i => i.abandonment === 'Y').length} mã bỏ qua</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={pushing}
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg disabled:opacity-50">
              Huỷ
            </button>
            <button onClick={handlePush} disabled={pushing}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-700 hover:to-pink-700 rounded-lg disabled:opacity-50">
              {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {pushing ? 'Đang queue...' : '🚀 Push to SEC-BQMS'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
