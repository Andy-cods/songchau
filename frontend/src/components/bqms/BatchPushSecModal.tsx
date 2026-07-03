'use client';

// Đẩy NHIỀU mã lên SEC theo thứ tự (Thang 2026-06-29). Gọi POST /push-to-sec/batch
// — backend tự build payload (qua get_push_preview), validate, bỏ qua mã thiếu
// giá/ảnh/file, và enqueue 1 job đẩy lần lượt. FE chỉ gửi rfq_ids + round.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X, Loader2, Rocket, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface BatchData {
  job_id: string;
  enqueued: { rfq_id: number; rfq_number: string }[];
  skipped: { rfq_id: number; rfq_number: string | null; errors: string[] }[];
}

export function BatchPushSecModal({
  rfqIds,
  onClose,
  onDone,
}: {
  rfqIds: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [round, setRound] = useState(1);
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<BatchData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tooMany = rfqIds.length > 8;

  const push = async () => {
    setPushing(true);
    setError(null);
    try {
      const res = await api.post<{ data?: BatchData; message?: string }>(
        '/api/v1/bqms/push-to-sec/batch',
        { rfq_ids: rfqIds, round },
      );
      setResult(res.data ?? null);
      qc.invalidateQueries({ queryKey: ['bqms-push-queue'] });
    } catch (e: any) {
      const d = e?.detail;
      // 400 "không có mã nào đủ điều kiện" trả {message, skipped}
      if (d && typeof d === 'object' && Array.isArray(d.skipped)) {
        setResult({ job_id: '', enqueued: [], skipped: d.skipped });
        setError(d.message ?? 'Không có mã nào đủ điều kiện để đẩy');
      } else {
        setError(typeof d === 'string' ? d : e?.message ?? 'Đẩy thất bại');
      }
    } finally {
      setPushing(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={result ? onDone : onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-brand-600" />
            <h2 className="text-sm font-bold text-slate-800">Đẩy nhiều mã lên SEC</h2>
          </div>
          <button onClick={result ? onDone : onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {!result ? (
            <>
              <p className="text-sm text-slate-600">
                Sẽ đẩy <b>{rfqIds.length}</b> mã <b>lần lượt theo thứ tự</b> trong 1 phiên Samsung
                (Save Temporarily). Mã thiếu giá / ảnh / file sẽ <b>tự bỏ qua</b> và báo lại.
              </p>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Vòng báo giá</label>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRound(r)}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition-colors',
                        round === r
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50',
                      )}
                    >
                      V{r}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">V1 cần ảnh; V2+ dùng ảnh Samsung đã lưu.</p>
              </div>
              {tooMany && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-700 ring-1 ring-inset ring-amber-200">
                  Tối đa <b>8 mã</b> mỗi lần (giới hạn phiên Samsung). Anh đang chọn {rfqIds.length} — bỏ bớt giúp em.
                </p>
              )}
              {error && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-600 ring-1 ring-inset ring-rose-200">{error}</p>
              )}
            </>
          ) : (
            <>
              {result.enqueued.length > 0 && (
                <div className="rounded-lg bg-emerald-50 px-3 py-2.5 ring-1 ring-inset ring-emerald-200">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> Đã xếp hàng {result.enqueued.length} mã
                  </div>
                  <div className="mt-1 break-words text-[12px] text-emerald-700/80">
                    {result.enqueued.map((e) => e.rfq_number).join(', ')}
                  </div>
                  <div className="mt-1 text-[11px] text-emerald-600/70">
                    Theo dõi tiến độ ở popup giữa màn hình — hệ thống đang đẩy lần lượt.
                  </div>
                </div>
              )}
              {result.skipped.length > 0 && (
                <div className="rounded-lg bg-amber-50 px-3 py-2.5 ring-1 ring-inset ring-amber-200">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                    <AlertTriangle className="h-4 w-4" /> Bỏ qua {result.skipped.length} mã
                  </div>
                  <ul className="mt-1 space-y-1 text-[12px] text-amber-800">
                    {result.skipped.map((s, i) => (
                      <li key={i}>
                        <b className="font-mono">{s.rfq_number ?? `#${s.rfq_id}`}</b>: {s.errors.join('; ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          {!result ? (
            <>
              <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
                Huỷ
              </button>
              <button
                onClick={push}
                disabled={pushing || tooMany}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {pushing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Đang xếp hàng…
                  </>
                ) : (
                  <>🚀 Đẩy {rfqIds.length} mã</>
                )}
              </button>
            </>
          ) : (
            <button onClick={onDone} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-900">
              Đóng
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
