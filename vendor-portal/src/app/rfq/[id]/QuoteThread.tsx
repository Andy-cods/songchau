'use client';

// Đợt 2a #12 — Hỏi đáp (Q&A) + Phụ lục (Addendum) cho cổng NCC.
//
// NCC CHỈ thấy thread của CHÍNH MÌNH với Song Châu (question/answer) + các phụ lục
// broadcast của đợt (addendum). KHÔNG bao giờ thấy câu hỏi/giá/tên NCC khác —
// BE đã scope cứng (resolve_vendor + WHERE vendor_id=$me + CHECK constraint) và
// response KHÔNG trả author_admin_id/giá/tên đối thủ.
//
// Endpoint (qua src/lib/api.ts, token localStorage 'vendor_token'):
//   GET  /api/vendor/rfq/{batchId}/messages → { messages: RfqMessage[] }
//   POST /api/vendor/rfq/{batchId}/messages  body { body } (kind ép 'question' ở BE)
//
// Badge "có trả lời mới": tính HOÀN TOÀN ở FE qua localStorage last-seen (KISS —
// BE không track read addendum per-vendor). Mở thread = đánh dấu đã xem.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import type { RfqMessage } from '@/lib/types';

const SEEN_KEY = (batchId: number | string) => `qa_seen_${batchId}`;

function readSeen(batchId: number | string): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(SEEN_KEY(batchId));
  const n = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function writeSeen(batchId: number | string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SEEN_KEY(batchId), new Date().toISOString());
}

// Đếm tin mới từ Song Châu (answer/addendum) kể từ lần xem cuối → chấm amber.
function countUnread(messages: RfqMessage[], seenMs: number): number {
  return messages.filter(
    (m) =>
      m.author === 'admin' &&
      (m.kind === 'answer' || m.kind === 'addendum') &&
      Date.parse(m.created_at) > seenMs,
  ).length;
}

export default function QuoteThread({ batchId }: { batchId: number | string }) {
  const [messages, setMessages] = useState<RfqMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [seenMs, setSeenMs] = useState(0);
  const seededSeen = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ messages: RfqMessage[] }>(
        `/api/vendor/rfq/${batchId}/messages`,
      );
      setMessages(res.messages ?? []);
      setErrored(false);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  // Capture the last-seen marker ONCE (pre-open) so the "mới" badge reflects what
  // arrived since the previous visit, then advance the marker to now.
  useEffect(() => {
    if (seededSeen.current) return;
    seededSeen.current = true;
    setSeenMs(readSeen(batchId));
    writeSeen(batchId);
  }, [batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      await api.post(`/api/vendor/rfq/${batchId}/messages`, { body });
      setDraft('');
      writeSeen(batchId);
      setSeenMs(Date.now()); // câu mình vừa gửi không tính là "mới"
      await load();
    } catch (e) {
      // Lỗi gửi hiện inline (không dùng native alert chặn UI) — đồng bộ phong cách app.
      setSendErr((e as { detail?: string })?.detail ?? 'Không gửi được câu hỏi. Thử lại.');
    } finally {
      setSending(false);
    }
  }, [batchId, draft, sending, load]);

  const addenda = messages.filter((m) => m.kind === 'addendum');
  const thread = messages.filter((m) => m.kind !== 'addendum');
  const unread = countUnread(messages, seenMs);

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <svg className="h-4 w-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.4-3.5A7.94 7.94 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <h2 className="text-sm font-bold text-slate-800">Hỏi đáp với Song Châu</h2>
        {unread > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {unread} mới
          </span>
        )}
      </div>

      <div className="p-5 space-y-5">
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : errored ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">
            Không tải được phần hỏi đáp. Vui lòng tải lại trang.
          </p>
        ) : (
          <>
            {/* ── Phụ lục broadcast (chung cho mọi NCC, viền amber nổi bật) ── */}
            {addenda.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  Phụ lục từ Song Châu
                </p>
                {addenda.map((m) => (
                  <article
                    key={m.id}
                    className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        Phụ lục
                      </span>
                      <time className="text-[11px] text-slate-500 tabular-nums">
                        {formatRelativeTime(m.created_at)}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{m.body}</p>
                    {m.attachments.length > 0 && (
                      <Attachments paths={m.attachments} />
                    )}
                  </article>
                ))}
              </div>
            )}

            {/* ── Thread Q&A (bubble phẳng: NCC phải / Song Châu trái) ── */}
            <div className="space-y-3">
              {thread.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                  Chưa có câu hỏi nào — đặt câu hỏi làm rõ nếu cần.
                </p>
              ) : (
                thread.map((m) => {
                  const mine = m.author === 'vendor';
                  return (
                    <div
                      key={m.id}
                      className={mine ? 'flex justify-end' : 'flex justify-start'}
                    >
                      <div
                        className={
                          mine
                            ? 'max-w-[80%] rounded-md border border-brand-100 bg-brand-50 px-3.5 py-2.5'
                            : 'max-w-[80%] rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5'
                        }
                      >
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-slate-600">
                            {mine ? 'Bạn' : 'Song Châu'}
                          </span>
                          <time className="text-[11px] text-slate-400 tabular-nums">
                            {formatRelativeTime(m.created_at)}
                          </time>
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-slate-800">{m.body}</p>
                        {m.attachments.length > 0 && (
                          <Attachments paths={m.attachments} />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* ── Composer ── */}
            <div className="border-t border-slate-100 pt-4">
              <textarea
                value={draft}
                onChange={(e) => { setDraft(e.target.value); if (sendErr) setSendErr(null); }}
                maxLength={4000}
                rows={3}
                placeholder="Đặt câu hỏi làm rõ cho đợt báo giá này…"
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {sendErr && (
                <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-600 ring-1 ring-inset ring-rose-200">
                  {sendErr}
                </p>
              )}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {draft.length}/4000
                </span>
                <button
                  type="button"
                  onClick={send}
                  disabled={!draft.trim() || sending}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                >
                  {sending ? 'Đang gửi…' : 'Gửi câu hỏi'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// Liệt kê tên tệp đính kèm. Giống per-line attachment của trang báo giá (rfq/[id]
// page.tsx:485): các path là sandbox-path, CHƯA có GET read-back route ở M1 → ta
// chỉ HIỆN tên tệp (chip 📎). Khi route download xuất hiện, gắn api.blob→object-URL
// vào đây — KHÔNG đổi UI.
function Attachments({ paths }: { paths: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {paths.map((p, i) => (
        <span
          key={`${p}-${i}`}
          title={p}
          className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          {fileName(p) || `Tệp ${i + 1}`}
        </span>
      ))}
    </div>
  );
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || '';
}
