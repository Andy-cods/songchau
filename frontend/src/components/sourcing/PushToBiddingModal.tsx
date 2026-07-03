'use client';

/**
 * PushToBiddingModal (V9) — gửi các mã đã chọn sang Đấu thầu nhà cung cấp.
 * Nguồn mã (prop `source`):
 *   - 'catalog' → Thư viện nguồn cung (/sourcing) → import-from-catalog
 *   - 'bqms'    → mã BQMS đang mở (/bqms)         → import-from-bqms
 *   - 'imv'     → mã RFQ trên IMV (/imv)          → import-from-imv
 * Hai chế độ đích (dùng chung cho cả 2 nguồn):
 *   (A) Tạo phiên mới  → POST /procurement/batches → import-from-<source>
 *   (B) Thêm vào phiên nháp có sẵn → import-from-<source>
 * Sau khi import xong → điều hướng tới /vendor-bidding/{batchId}.
 *
 * BẢO MẬT: chỉ đẩy specification / mã / số lượng sang đợt thầu. KHÔNG đẩy
 * target_price / cost_vnd / sale_vnd / xếp hạng — cổng NCC không bao giờ thấy
 * giá nội bộ (backend import-from-* đã chỉ map các trường an toàn).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Gavel, Loader2, Plus, FolderPlus, X, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface DraftBatch {
  id: number;
  batch_code: string | null;
  title: string | null;
  status: string | null;
  item_count?: number | null;
}

/**
 * Nguồn mã đẩy sang đấu thầu:
 *   - 'catalog' → /sourcing (Thư viện nguồn cung) → import-from-catalog
 *   - 'bqms'    → /bqms (mã BQMS đang mở)        → import-from-bqms
 *   - 'imv'     → /imv (mã RFQ trên IMV)          → import-from-imv
 * Cả ba đều truyền `ids` (số nguyên), chỉ khác endpoint + tên trường body +
 * shape response (xử lý trong pushMut.mutationFn).
 */
type Props = (
  | { source: 'catalog'; ids: number[] }
  | { source: 'bqms'; ids: number[] }
  | { source: 'imv'; ids: number[] }
) & {
  onClose: () => void;
  onDone?: () => void;
};

export function PushToBiddingModal({ source, ids, onClose, onDone }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [draftId, setDraftId] = useState<number | null>(null);

  // Draft batches the items could be appended to.
  const draftsQ = useQuery<DraftBatch[]>({
    queryKey: ['procurement', 'batches', 'draft'],
    queryFn: async () => {
      const res = (await api.get('/api/v1/procurement/batches?status=draft&limit=50')) as {
        data: DraftBatch[];
      };
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 30 * 1000,
  });
  const drafts = draftsQ.data || [];

  const pushMut = useMutation({
    mutationFn: async () => {
      let batchId: number;
      if (mode === 'new') {
        const t = title.trim();
        if (!t) throw new Error('Nhập tiêu đề đợt thầu');
        const created = (await api.post('/api/v1/procurement/batches', {
          title: t,
          bid_deadline: deadline ? new Date(deadline).toISOString() : null,
          award_mode: 'per_item',
        })) as { data: { id: number; batch_code: string } };
        batchId = created.data.id;
      } else {
        if (draftId == null) throw new Error('Chọn một phiên nháp');
        batchId = draftId;
      }
      // Switch endpoint + body + đọc response theo nguồn mã.
      if (source === 'bqms') {
        // import-from-bqms response: { data: { imported: [ids], skipped_duplicates: [codes] } }
        const imp = (await api.post(
          '/api/v1/procurement/batches/' + batchId + '/import-from-bqms',
          { rfq_ids: ids },
        )) as { data?: { imported?: number[]; skipped_duplicates?: string[] } };
        return {
          batchId,
          imported: imp.data?.imported?.length ?? 0,
          skipped: imp.data?.skipped_duplicates?.length ?? 0,
        };
      }
      if (source === 'imv') {
        // import-from-imv response: { imported: int, skipped: int, ... }
        const imp = (await api.post(
          '/api/v1/procurement/batches/' + batchId + '/import-from-imv',
          { imv_rfq_ids: ids },
        )) as { imported?: number; skipped?: number };
        return { batchId, imported: imp.imported ?? 0, skipped: imp.skipped ?? 0 };
      }
      // import-from-catalog response: { imported: int, skipped: int }
      const imp = (await api.post(
        '/api/v1/procurement/batches/' + batchId + '/import-from-catalog',
        { sourcing_entry_ids: ids },
      )) as { imported: number; skipped: number };
      return { batchId, imported: imp.imported ?? 0, skipped: imp.skipped ?? 0 };
    },
    onSuccess: ({ batchId, imported, skipped }) => {
      toast.success(
        `Đã gửi ${imported} mã sang đấu thầu` + (skipped ? ` (bỏ ${skipped} trùng)` : ''),
      );
      onDone?.();
      onClose();
      router.push('/vendor-bidding/' + batchId);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.detail ||
        err?.detail ||
        err?.message ||
        'Gửi đấu thầu thất bại';
      // 403 = role chưa đủ quyền tạo/đẩy phiên.
      toast.error(typeof msg === 'string' ? msg : 'Gửi đấu thầu thất bại');
    },
  });

  const canSubmit =
    ids.length > 0 &&
    (mode === 'new' ? title.trim().length > 0 : draftId != null) &&
    !pushMut.isPending;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 ring-1 ring-brand-200">
              <Gavel className="h-4 w-4 text-brand-700" />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-slate-900">Gửi sang đấu thầu NCC</h2>
              <p className="text-[12px] text-slate-500">{ids.length} mã đã chọn</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('new')}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] font-semibold transition-colors',
                mode === 'new'
                  ? 'border-brand-400 bg-brand-50 text-brand-800 ring-1 ring-brand-200'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
            >
              <Plus className="h-4 w-4 shrink-0" />
              Tạo phiên mới
            </button>
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] font-semibold transition-colors',
                mode === 'existing'
                  ? 'border-brand-400 bg-brand-50 text-brand-800 ring-1 ring-brand-200'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
            >
              <FolderPlus className="h-4 w-4 shrink-0" />
              Thêm vào phiên nháp
            </button>
          </div>

          {mode === 'new' ? (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-slate-600">
                  Tiêu đề đợt thầu <span className="text-rose-600">*</span>
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                  placeholder="Vd: Đấu thầu linh kiện tháng 6 — KH Samsung"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[14px] focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-slate-600">
                  Hạn báo giá (tuỳ chọn)
                </span>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[14px] focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              <span className="block text-[12px] font-semibold text-slate-600">Chọn phiên nháp</span>
              {draftsQ.isLoading ? (
                <div className="flex items-center gap-2 px-1 py-3 text-[13px] text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
                </div>
              ) : drafts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-[13px] text-slate-500">
                  Chưa có phiên nháp nào. Hãy chọn “Tạo phiên mới”.
                </div>
              ) : (
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {drafts.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setDraftId(b.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                        draftId === b.id
                          ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                          : 'border-slate-200 hover:bg-slate-50',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-slate-800">
                          {b.title || '(Không tiêu đề)'}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400">{b.batch_code}</div>
                      </div>
                      {b.item_count != null && (
                        <span className="shrink-0 text-[11px] text-slate-400">{b.item_count} mã</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 ring-1 ring-slate-200">
            Chỉ gửi <b>tên hàng / mã / số lượng</b> sang đợt thầu để NCC tự báo giá.
            Giá vốn, giá bán và xếp hạng nội bộ <b>không</b> được chia sẻ.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-100"
          >
            Huỷ
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => pushMut.mutate()}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-bold text-white transition-colors',
              canSubmit ? 'bg-brand-600 hover:bg-brand-700' : 'cursor-not-allowed bg-slate-300',
            )}
          >
            {pushMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Gavel className="h-4 w-4" />
            )}
            Gửi đấu thầu
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
