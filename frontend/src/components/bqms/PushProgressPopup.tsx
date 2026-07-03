'use client';

/**
 * Push Progress Popup (Thang 2026-05-15).
 *
 * Auto-open khi có job đang `running` trong push queue. Poll 2s/lần.
 * Hiển thị:
 *   • Tên RFQ + step hiện tại
 *   • Progress bar % với gradient màu
 *   • Time elapsed + ETA
 *   • Auto-close khi status='saved_temp' (3s sau) hoặc admin click Đóng
 *   • Nếu failed → hiện error + link xem screenshot, không auto-close
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Loader2, CheckCircle2, AlertCircle, X, Image as ImageIcon, Clock, Ban, Circle,
} from 'lucide-react';

interface PushItem {
  id: number;
  rfq_number: string;
  bqms_push_status: 'queued' | 'running' | 'saved_temp' | 'failed' | null;
  bqms_push_error: string | null;
  bqms_push_progress_pct: number | null;
  bqms_push_progress_step: string | null;
  bqms_pushed_at: string | null;
  bqms_push_started_at: string | null;
  bqms_push_screenshot_path: string | null;
  bqms_pushed_round: number | null;
  item_count?: number; // Thang 2026-05-23: số mã trong RFQ (dedupe đã group)
  // Thang 2026-06-22: round-active + canonical 8-step checklist tracking.
  // round_active là vòng ĐANG đẩy (V2/V3) — bqms_pushed_round chỉ flip khi
  // thành công nên không tin được lúc đang chạy. step_index/key drive checklist.
  bqms_push_round_active?: number | null;
  bqms_push_step_index?: number | null;
  bqms_push_total_steps?: number | null;
  bqms_push_step_key?: string | null;
}

// Canonical 8-step checklist (Thang 2026-06-22) — khớp 1-1 với pusher backend.
// `cum` = cumulative % khi step HOÀN TẤT (dùng để map pct→step khi không có
// step_index). IDENTICAL cho mọi vòng V1..Vn.
const PUSH_STEPS: { key: string; label: string; cum: number }[] = [
  { key: 'login', label: 'Đăng nhập sec-bqms', cum: 10 },
  { key: 'session', label: 'Mở phiên & kiểm tra', cum: 18 },
  { key: 'navigate', label: 'Điều hướng tới QT', cum: 32 },
  { key: 'edit', label: 'Vào chế độ chỉnh sửa', cum: 42 },
  { key: 'fill_items', label: 'Nhập giá & lead time', cum: 72 },
  { key: 'fill_global', label: 'Hạn báo giá + ý kiến', cum: 82 },
  { key: 'attachments', label: 'Tải file đính kèm', cum: 90 },
  { key: 'save_temp', label: 'Lưu tạm & xác nhận', cum: 100 },
];

/** 1-based index của step ĐANG chạy. Ưu tiên bqms_push_step_index; fallback
 *  map % → step gần nhất qua ngưỡng cumulative. Trả 0 khi chưa bắt đầu. */
function currentStepIndex(item: PushItem): number {
  const si = item.bqms_push_step_index;
  if (si != null && si >= 1 && si <= PUSH_STEPS.length) return si;
  const pct = item.bqms_push_progress_pct ?? 0;
  if (pct <= 0) return 0;
  for (let i = 0; i < PUSH_STEPS.length; i++) {
    if (pct < PUSH_STEPS[i].cum) return i + 1; // đang ở step i (1-based)
  }
  return PUSH_STEPS.length;
}

// Thang 2026-06-22 (fix "thông báo đẩy lên SEC V2/V3 không hiển thị"): khoá
// dismiss theo VÒNG push, KHÔNG theo bqms_rfq.id. Trước đây V1/V2/V3 dùng CHUNG
// 1 id; card V1 tự đóng sau 8s (hoặc user bấm ✕) → id đó bị đánh dấu vĩnh viễn
// trong sessionStorage → V2/V3 bị CHẶN hiện suốt phiên. Mỗi vòng push set lại
// bqms_push_started_at=NOW(), nên dùng `${id}:${started_at}` làm khoá → vòng
// mới luôn hiện lại. Bump _v2 để xoá các entry SỐ cũ (kiểu khác → tự bỏ qua).
const DISMISSED_KEY = 'bqms_push_dismissed_v2';

function pushKeyOf(it: { id: number; bqms_push_started_at: string | null }): string {
  return `${it.id}:${it.bqms_push_started_at ?? ''}`;
}

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore quota errors
  }
}

export default function PushProgressPopup() {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadDismissed());

  const dismissOne = (key: string) =>
    setDismissedIds((s) => {
      const next = new Set(s);
      next.add(key);
      saveDismissed(next);
      return next;
    });

  // FIX (Thang 2026-05-23): conditional refetchInterval — chỉ poll khi có job
  // đang chạy/queued. Khi không có gì → ngừng polling để tránh "nhảy liên tục"
  // notification + giảm tải. Lần đầu poll mỗi 8s để pick up job mới; khi đã có
  // active job thì 3s cho smooth progress.
  const { data } = useQuery({
    queryKey: ['bqms-push-queue'],
    queryFn: () => api.get<any>('/api/v1/bqms/push-queue/status'),
    refetchInterval: (q) => {
      const items: PushItem[] = ((q.state.data as any)?.data ?? []) as PushItem[];
      const hasRunning = items.some(
        (it) => it.bqms_push_status === 'running' || it.bqms_push_status === 'queued',
      );
      if (hasRunning) return 3000; // smooth progress
      return 12000; // slow poll for new jobs
    },
    refetchIntervalInBackground: false,
  });

  const items: PushItem[] = data?.data ?? [];

  // Active = running OR (saved_temp/failed in last 30s) AND not dismissed
  const now = Date.now();
  const active = items.filter((it) => {
    if (dismissedIds.has(pushKeyOf(it))) return false;
    if (it.bqms_push_status === 'running' || it.bqms_push_status === 'queued') return true;
    if (it.bqms_push_status === 'saved_temp' && it.bqms_pushed_at) {
      return now - new Date(it.bqms_pushed_at).getTime() < 30_000;
    }
    if (it.bqms_push_status === 'failed') {
      // Hiện thẻ FAILED của lần đẩy HIỆN TẠI (trong 24h) rồi tự ẩn để không "ám"
      // mãi. Dùng started_at (lần đẩy hiện tại) vì pushed_at có thể là lần THÀNH
      // CÔNG CŨ khi re-push — bám pushed_at sẽ ẩn nhầm/hiện nhầm.
      const ts = it.bqms_push_started_at ?? it.bqms_pushed_at;
      if (!ts) return false;
      return now - new Date(ts).getTime() < 24 * 3600_000;
    }
    return false;
  });

  // Auto-dismiss saved_temp after 8s
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    for (const it of active) {
      if (it.bqms_push_status === 'saved_temp' && !dismissedIds.has(pushKeyOf(it))) {
        const t = setTimeout(() => dismissOne(pushKeyOf(it)), 8000);
        timers.push(t);
      }
    }
    return () => {
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.map((a) => a.id).join(',')]);

  const dismissAll = () => {
    const next = new Set(dismissedIds);
    active.forEach((it) => next.add(pushKeyOf(it)));
    saveDismissed(next);
    setDismissedIds(next);
  };

  if (active.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center p-4">
      <div className="space-y-3 max-w-md w-full pointer-events-auto">
        {active.length >= 2 && (
          <div className="flex items-center justify-between rounded-xl bg-slate-900/95 px-3 py-2 text-xs text-white shadow-2xl backdrop-blur">
            <span>{active.length} thông báo push đang hiện</span>
            <button
              onClick={dismissAll}
              className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-semibold transition hover:bg-white/25"
            >
              Đóng tất cả
            </button>
          </div>
        )}
        {active.map((it) => (
          <ProgressCard key={pushKeyOf(it)} item={it} onDismiss={() => dismissOne(pushKeyOf(it))} />
        ))}
      </div>
    </div>
  );
}

function ProgressCard({ item, onDismiss }: { item: PushItem; onDismiss: () => void }) {
  const pct = Math.max(0, Math.min(100, item.bqms_push_progress_pct ?? 0));
  const step = item.bqms_push_progress_step ?? 'Đang chuẩn bị...';
  const status = item.bqms_push_status;
  const queryClient = useQueryClient();

  // Thang 2026-06-22: vòng ĐANG đẩy ưu tiên round_active (V2/V3 hiện đúng khi
  // đang chạy). bqms_pushed_round chỉ là bản ghi lịch sử (flip khi saved_temp).
  const roundN = item.bqms_push_round_active ?? item.bqms_pushed_round ?? 1;
  const curStep = currentStepIndex(item);

  const cancelMutation = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams();
      params.set('round_n', String(roundN));
      return api.post(`/api/v1/bqms/push-queue/cancel/${encodeURIComponent(item.rfq_number)}?${params}`);
    },
    onSuccess: (res: any) => {
      const n = res?.data?.cancelled_rows ?? 0;
      toast.success(`Đã hủy queue ${item.rfq_number} (${n} dòng)`);
      queryClient.invalidateQueries({ queryKey: ['bqms-push-queue'] });
      onDismiss();
    },
    onError: (err: any) => {
      toast.error(`Hủy thất bại: ${err?.detail ?? err?.message ?? 'không rõ'}`);
    },
  });

  const startedAt = item.bqms_push_started_at ? new Date(item.bqms_push_started_at).getTime() : null;
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!startedAt || status !== 'running') return;
    const tick = () => setElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, status]);

  const eta = pct > 5 && startedAt && status === 'running'
    ? Math.round((elapsedSec / pct) * (100 - pct))
    : null;

  // Restraint palette (Thang 2026-06-22): ONE brand/indigo for running, slate
  // for queued, emerald for done, rose for failed. Single solid fill — NO
  // via-purple-to-pink gradient.
  const headerClass =
    status === 'saved_temp' ? 'bg-emerald-600' :
    status === 'failed' ? 'bg-rose-600' :
    status === 'queued' ? 'bg-slate-700' :
    'bg-brand-600';

  const barClass =
    status === 'saved_temp' ? 'bg-emerald-500' :
    status === 'failed' ? 'bg-rose-500' :
    status === 'queued' ? 'bg-slate-400' :
    'bg-brand-600';

  return (
    <div className="bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden ring-1 ring-black/10 animate-in slide-in-from-bottom duration-300">
      {/* Header */}
      <div className={cn('px-4 py-3 text-white flex items-center justify-between', headerClass)}>
        <div className="flex items-center gap-2">
          {status === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
          {status === 'queued' && <Clock className="h-4 w-4" />}
          {status === 'saved_temp' && <CheckCircle2 className="h-4 w-4" />}
          {status === 'failed' && <AlertCircle className="h-4 w-4" />}
          <div>
            <div className="text-xs font-bold tracking-tight">
              {status === 'saved_temp' ? 'Đã save temp thành công' :
               status === 'failed' ? 'Push thất bại' :
               status === 'queued' ? 'Chờ trong queue' :
               'Đang đẩy lên SEC-BQMS'}
            </div>
            <div className="text-[11px] opacity-90 font-mono">
              {item.rfq_number} · V{roundN}
              {item.item_count && item.item_count > 1 && (
                <span className="ml-1.5 inline-flex items-center rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-bold">
                  {item.item_count} mã
                </span>
              )}
            </div>
          </div>
        </div>
        <button onClick={onDismiss} className="text-white/80 hover:text-white p-1 rounded hover:bg-white/10 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 mb-1">
            <span className="truncate flex-1 mr-2" title={step}>{step}</span>
            <span className="font-mono font-bold text-slate-800 shrink-0">{pct}%</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div className={cn('h-full transition-all duration-500 ease-out', barClass)}
              style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* 8-step checklist (Thang 2026-06-22) — identical cho mọi vòng V1..Vn */}
        <ol className="space-y-1">
          {PUSH_STEPS.map((s, i) => {
            const stepNo = i + 1; // 1-based
            const isFailed = status === 'failed';
            const allDone = status === 'saved_temp';
            const done = allDone || (curStep > stepNo) || (curStep === stepNo && pct >= s.cum);
            const isCurrent = !allDone && !done && curStep === stepNo;
            return (
              <li key={s.key} className="flex items-center gap-2 text-[11px]">
                <span className="shrink-0">
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : isCurrent ? (
                    isFailed
                      ? <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                      : <Loader2 className="h-3.5 w-3.5 text-brand-600 animate-spin" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-slate-300" />
                  )}
                </span>
                <span className={cn(
                  'truncate',
                  done ? 'text-slate-400 line-through decoration-slate-300' :
                  isCurrent ? (isFailed ? 'text-rose-700 font-semibold' : 'text-slate-800 font-semibold') :
                  'text-slate-400',
                )}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>

        {/* Time info */}
        {status === 'running' && (
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> Đã chạy: <strong>{elapsedSec}s</strong>
            </span>
            {eta != null && eta > 0 && (
              <span>ETA: ~{eta}s</span>
            )}
          </div>
        )}

        {/* Error */}
        {status === 'failed' && item.bqms_push_error && (
          <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-800 max-h-32 overflow-y-auto">
            <div className="font-semibold mb-1">Chi tiết lỗi:</div>
            <div className="font-mono whitespace-pre-wrap break-all">{item.bqms_push_error}</div>
          </div>
        )}

        {/* Success actions */}
        {status === 'saved_temp' && (
          <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            ✓ Anh vào <a href="https://www.sec-bqms.com/" target="_blank" rel="noreferrer" className="underline font-semibold">sec-bqms.com</a> để click Submit cuối cùng.
          </div>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-2 flex-wrap">
          {item.bqms_push_screenshot_path && (
            <a href={`/api/v1/bqms/rfq/${item.id}/push-screenshot`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 transition-colors">
              <ImageIcon className="h-3 w-3" /> Xem screenshot evidence
            </a>
          )}
          {/* Thang 2026-05-23: Hủy queue button cho jobs queued (chưa chạy) */}
          {status === 'queued' && (
            <button
              onClick={() => {
                if (confirm(`Hủy queue ${item.rfq_number}?`)) cancelMutation.mutate();
              }}
              disabled={cancelMutation.isPending}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg text-[11px] font-semibold text-rose-700 transition-colors disabled:opacity-50"
            >
              {cancelMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
              Hủy queue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
