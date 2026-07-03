'use client';

// Đợt 2a #12 — Panel Hỏi đáp NCC (admin cockpit).
//
// 2 cột: TRÁI = danh sách NCC đã mời (chấm amber nếu có câu hỏi chưa đọc);
// PHẢI = thread của NCC đang chọn (bubble: Song Châu phải / NCC trái) + ô trả lời
// RIÊNG + danh sách phụ lục read-only. Nút "Đăng phụ lục" mở modal broadcast tới
// TẤT CẢ NCC đã mời (ẩn danh người hỏi — chuẩn công bằng).
//
// Bảo mật: BE trả riêng thread từng NCC (?vendor_id=); response KHÔNG kèm giá/tên
// đối thủ. Rủi ro còn lại DUY NHẤT là admin tự gõ → helper-text cảnh báo dưới ô.
//
// Endpoint (đã thiết kế BE):
//   GET  /api/v1/procurement/batches/{id}/message-threads          → cột trái
//   GET  /api/v1/procurement/batches/{id}/messages?vendor_id={vid} → thread 1 NCC
//   POST /api/v1/procurement/batches/{id}/messages {vendor_id, body} → trả lời riêng
//   POST /api/v1/procurement/batches/{id}/addendum {body}            → broadcast phụ lục

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  MessageCircle, Megaphone, Send, X, Loader2, Building2, AlertCircle, Paperclip,
} from 'lucide-react';
import { ELEVATION, RADIUS, BADGE, BUTTON } from '@/components/cockpit';

const MODAL_OVERLAY = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4';
const MODAL_PANEL = cn('bg-white overflow-hidden', RADIUS.modal, ELEVATION.modal);
const INPUT_CLS = 'w-full px-3 py-2 ring-1 ring-slate-200 rounded-lg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition-all';

const fmtDateTimeVN = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

interface ThreadSummary {
  vendor_id: number;
  company_name: string;
  unread_count_admin: number;
  last_at: string | null;
}

interface RfqMessage {
  id: number;
  kind: 'question' | 'answer' | 'addendum';
  author: 'vendor' | 'admin';
  body: string;
  attachments: string[];
  created_at: string;
}

export default function QAPanel({ batchId }: { batchId: number }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [reply, setReply] = useState('');
  const [showAddendum, setShowAddendum] = useState(false);

  const threadsQ = useQuery<{ threads: ThreadSummary[] }>({
    queryKey: ['vb-qa-threads', batchId],
    queryFn: () => api.get<{ threads: ThreadSummary[] }>(
      `/api/v1/procurement/batches/${batchId}/message-threads`,
    ),
    refetchInterval: 20000,
  });
  const threads = useMemo(() => threadsQ.data?.threads ?? [], [threadsQ.data]);

  // Auto-select the first vendor with unread questions, else the first one.
  useEffect(() => {
    if (selected != null || threads.length === 0) return;
    const firstUnread = threads.find((t) => t.unread_count_admin > 0);
    setSelected((firstUnread ?? threads[0]).vendor_id);
  }, [threads, selected]);

  const msgsQ = useQuery<{ messages: RfqMessage[] }>({
    queryKey: ['vb-qa-msgs', batchId, selected],
    queryFn: () => api.get<{ messages: RfqMessage[] }>(
      `/api/v1/procurement/batches/${batchId}/messages?vendor_id=${selected}`,
    ),
    enabled: selected != null,
    placeholderData: keepPreviousData,
    refetchInterval: 20000,
  });
  const messages = msgsQ.data?.messages ?? [];

  const replyM = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/procurement/batches/${batchId}/messages`, {
        vendor_id: selected,
        body: reply.trim(),
      }),
    onSuccess: () => {
      setReply('');
      toast.success('Đã gửi câu trả lời tới NCC.');
      qc.invalidateQueries({ queryKey: ['vb-qa-msgs', batchId, selected] });
      qc.invalidateQueries({ queryKey: ['vb-qa-threads', batchId] });
    },
    onError: (e: { detail?: string }) =>
      toast.error(e?.detail ?? 'Không gửi được câu trả lời.'),
  });

  const selectedThread = threads.find((t) => t.vendor_id === selected) ?? null;
  const addenda = messages.filter((m) => m.kind === 'addendum');
  const conversation = messages.filter((m) => m.kind !== 'addendum');

  return (
    <div className="space-y-4">
      {/* header strip + nút Đăng phụ lục */}
      <div className={cn(ELEVATION.container, RADIUS.container, 'flex items-center gap-2 p-3')}>
        <MessageCircle className="ml-1 h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-700">Hỏi đáp với NCC</h3>
        <span className="text-xs text-slate-400 tabular-nums">· {threads.length} NCC</span>
        <button
          onClick={() => setShowAddendum(true)}
          className={cn(BUTTON.secondary, 'ml-auto h-9 px-3 text-xs')}
        >
          <Megaphone className="h-4 w-4" /> Đăng phụ lục
        </button>
      </div>

      <div className={cn(ELEVATION.container, RADIUS.container, 'grid grid-cols-1 overflow-hidden md:grid-cols-[260px_1fr]')}>
        {/* ── TRÁI: danh sách NCC ── */}
        <div className="border-b border-slate-100 md:border-b-0 md:border-r">
          {threadsQ.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : threads.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">Đợt này chưa mời NCC nào.</p>
          ) : (
            <ul className="max-h-[520px] overflow-y-auto p-2">
              {threads.map((t) => {
                const active = t.vendor_id === selected;
                return (
                  <li key={t.vendor_id}>
                    <button
                      onClick={() => setSelected(t.vendor_id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors',
                        active ? 'bg-brand-50 ring-1 ring-inset ring-brand-200' : 'hover:bg-slate-50',
                      )}
                    >
                      <Building2 className={cn('h-4 w-4 shrink-0', active ? 'text-brand-600' : 'text-slate-400')} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                        {t.company_name}
                      </span>
                      {t.unread_count_admin > 0 && (
                        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                          {t.unread_count_admin}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── PHẢI: thread + composer + phụ lục ── */}
        <div className="flex min-w-0 flex-col">
          {selected == null ? (
            <div className="flex flex-1 items-center justify-center p-10 text-sm text-slate-400">
              Chọn một NCC để xem hỏi đáp.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                <Building2 className="h-4 w-4 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">
                  {selectedThread?.company_name ?? `NCC #${selected}`}
                </span>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: 420 }}>
                {/* Phụ lục (read-only, ngữ cảnh chung) */}
                {addenda.length > 0 && (
                  <div className="space-y-2">
                    {addenda.map((m) => (
                      <div key={m.id} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            <Megaphone className="h-3 w-3" /> Phụ lục (gửi mọi NCC)
                          </span>
                          <time className="text-[11px] text-slate-400 tabular-nums">{fmtDateTimeVN(m.created_at)}</time>
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-slate-700">{m.body}</p>
                        <AttachList paths={m.attachments} />
                      </div>
                    ))}
                  </div>
                )}

                {msgsQ.isError ? (
                  <div className={cn('flex items-start gap-2 px-3 py-2 text-sm', RADIUS.container, BADGE.rose.bg, BADGE.rose.text, BADGE.rose.ring)} role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Không tải được hỏi đáp.
                  </div>
                ) : conversation.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    NCC này chưa đặt câu hỏi nào.
                  </p>
                ) : (
                  conversation.map((m) => {
                    const fromAdmin = m.author === 'admin';
                    return (
                      <div key={m.id} className={fromAdmin ? 'flex justify-end' : 'flex justify-start'}>
                        <div
                          className={cn(
                            'max-w-[78%] rounded-md border px-3 py-2',
                            fromAdmin ? 'border-brand-100 bg-brand-50' : 'border-slate-200 bg-slate-50',
                          )}
                        >
                          <div className="mb-0.5 flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-slate-600">
                              {fromAdmin ? 'Song Châu' : 'NCC'}
                            </span>
                            <time className="text-[11px] text-slate-400 tabular-nums">{fmtDateTimeVN(m.created_at)}</time>
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-slate-800">{m.body}</p>
                          <AttachList paths={m.attachments} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Composer trả lời riêng */}
              <div className="border-t border-slate-100 p-3">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  maxLength={4000}
                  rows={3}
                  placeholder="Trả lời riêng cho NCC này…"
                  className={cn(INPUT_CLS, 'resize-none')}
                />
                <p className="mt-1 text-[11px] font-medium text-rose-600">
                  Không dán giá mục tiêu / giá hoặc tên NCC khác vào câu trả lời.
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 tabular-nums">{reply.length}/4000</span>
                  <button
                    onClick={() => replyM.mutate()}
                    disabled={!reply.trim() || replyM.isPending}
                    className={cn(BUTTON.primary, 'h-9 px-4 text-xs')}
                  >
                    {replyM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Gửi trả lời
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showAddendum && (
        <AddendumModal
          batchId={batchId}
          vendorCount={threads.length}
          onClose={() => setShowAddendum(false)}
          onPosted={() => {
            qc.invalidateQueries({ queryKey: ['vb-qa-msgs', batchId] });
            qc.invalidateQueries({ queryKey: ['vb-qa-threads', batchId] });
          }}
        />
      )}
    </div>
  );
}

// Liệt kê tên tệp đính kèm (sandbox-path, M1 chưa có GET read-back → chỉ hiện tên,
// khớp behavior cổng NCC). Gắn download khi route xuất hiện — không đổi UI.
function AttachList({ paths }: { paths: string[] }) {
  if (!paths || paths.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {paths.map((p, i) => (
        <span
          key={`${p}-${i}`}
          title={p}
          className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200"
        >
          <Paperclip className="h-3 w-3" />
          {p.split(/[\\/]/).pop() || `Tệp ${i + 1}`}
        </span>
      ))}
    </div>
  );
}

function AddendumModal({
  batchId, vendorCount, onClose, onPosted,
}: {
  batchId: number;
  vendorCount: number;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [body, setBody] = useState('');
  const postM = useMutation({
    mutationFn: () =>
      api.post<{ id: number; broadcast_to: number }>(
        `/api/v1/procurement/batches/${batchId}/addendum`,
        { body: body.trim() },
      ),
    onSuccess: (r) => {
      toast.success(`Đã gửi phụ lục tới ${r?.broadcast_to ?? vendorCount} NCC.`);
      onPosted();
      onClose();
    },
    onError: (e: { detail?: string }) =>
      toast.error(e?.detail ?? 'Không đăng được phụ lục.'),
  });

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="addendum-title"
        className={cn(MODAL_PANEL, 'w-full max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500">
              <Megaphone className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="addendum-title" className="text-base font-bold text-slate-900">Đăng phụ lục</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Gửi làm rõ/sửa đổi tới TẤT CẢ {vendorCount} NCC đã mời (ẩn danh người hỏi).
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2 p-6">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            rows={5}
            autoFocus
            placeholder="Nội dung phụ lục làm rõ / sửa đổi đợt báo giá…"
            className={cn(INPUT_CLS, 'resize-none')}
          />
          <p className="text-[11px] font-medium text-rose-600">
            Phụ lục hiển thị cho mọi NCC — không nêu tên NCC nào hay giá cụ thể.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
          <button onClick={onClose} disabled={postM.isPending}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50">
            Huỷ
          </button>
          <button
            onClick={() => postM.mutate()}
            disabled={!body.trim() || postM.isPending}
            className={cn(BUTTON.primary, 'px-4')}
          >
            {postM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            Đăng & gửi
          </button>
        </div>
      </div>
    </div>
  );
}
