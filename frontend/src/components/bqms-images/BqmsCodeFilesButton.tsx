'use client';

// "File mã" — surfaces the Raw attachment files of a BQMS code's source RFQ
// folder inside the vendor-bidding admin view (Thang 2026-06-29). Reuses the
// existing GET /api/v1/bqms/bidding/folder (raw/ + images/) — keyed by the
// item's source RFQ number (admin-only field). Vendor portal never imports this.
//
// The folder + file-serve endpoints are admin/manager/procurement/staff only;
// vendors (role 'vendor') can never reach them.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Download, Loader2, AlertCircle, FileSpreadsheet, X, ImageOff, Share2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

function withToken(url: string): string {
  if (typeof window === 'undefined') return url;
  const token = localStorage.getItem('access_token') ?? '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

interface FolderFile {
  name: string;
  size: number;
  modified?: number;
}
interface FolderResponse {
  data: { exists: boolean; rfq_number: string; folder?: string; files?: FolderFile[]; images?: FolderFile[] };
}

function fmtSize(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function BqmsCodeFilesButton({
  rfqNumber,
  bqmsCode,
  itemId,
  compact = false,
}: {
  rfqNumber: string | null;
  bqmsCode?: string | null;
  itemId?: number | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Only render the trigger when there IS a source RFQ to look in.
  if (!rfqNumber) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={`Xem file của mã từ thư mục Raw (RFQ ${rfqNumber})`}
        className={cn(
          'inline-flex items-center gap-1 rounded text-[10px] font-medium text-slate-500 hover:text-brand-700 hover:underline',
          compact ? 'mt-0.5' : 'px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200',
        )}
      >
        <Paperclip className="h-3 w-3" />
        File mã
      </button>
      {open && <FilesModal rfqNumber={rfqNumber} bqmsCode={bqmsCode ?? null} itemId={itemId ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}

function FilesModal({ rfqNumber, bqmsCode, itemId, onClose }: { rfqNumber: string; bqmsCode: string | null; itemId: number | null; onClose: () => void }) {
  const { data, isLoading, error } = useQuery<FolderResponse>({
    queryKey: ['bqms-code-files', rfqNumber],
    queryFn: () => api.get<FolderResponse>(`/api/v1/bqms/bidding/folder?rfq_number=${encodeURIComponent(rfqNumber)}`),
    staleTime: 30_000,
  });

  const folder = data?.data;
  const files = folder?.files ?? [];
  const images = folder?.images ?? [];
  const buildUrl = (kind: 'raw' | 'images', name: string) =>
    withToken(
      `/api/v1/bqms/bidding/folder/file?rfq_number=${encodeURIComponent(rfqNumber)}&kind=${kind}&name=${encodeURIComponent(name)}`,
    );

  // Chia sẻ file cho NCC (chỉ khi mở từ 1 mã trong đợt → có itemId). Tick = NCC
  // xem/tải được; bỏ tick = nội bộ. Mặc định KHÔNG file nào được chia sẻ.
  const canShare = itemId != null;
  const qc = useQueryClient();
  const sharedQ = useQuery<{ shared: { kind: string; file_name: string }[] }>({
    queryKey: ['item-shared-files', itemId],
    queryFn: () => api.get<{ shared: { kind: string; file_name: string }[] }>(`/api/v1/procurement/items/${itemId}/shared-files`),
    enabled: canShare,
    staleTime: 10_000,
  });
  const sharedSet = new Set((sharedQ.data?.shared ?? []).map((s) => `${s.kind}/${s.file_name}`));
  const isShared = (kind: string, name: string) => sharedSet.has(`${kind}/${name}`);
  const shareMut = useMutation({
    mutationFn: (v: { kind: 'raw' | 'images'; file_name: string; shared: boolean }) =>
      api.post(`/api/v1/procurement/items/${itemId}/share-file`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-shared-files', itemId] }),
  });
  const toggleShare = (kind: 'raw' | 'images', name: string) =>
    shareMut.mutate({ kind, file_name: name, shared: !isShared(kind, name) });

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-xl bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800">File của mã</div>
            <div className="text-xs text-slate-500 truncate">{bqmsCode ? `${bqmsCode} · ` : ''}RFQ {rfqNumber}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          {isLoading && (
            <div className="flex items-center gap-2 py-8 justify-center text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải danh sách file…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 py-8 justify-center text-sm text-rose-600">
              <AlertCircle className="h-4 w-4" /> Không tải được danh sách file.
            </div>
          )}
          {!isLoading && !error && folder && !folder.exists && (
            <div className="flex flex-col items-center gap-1 py-8 text-center text-sm text-slate-400">
              <ImageOff className="h-6 w-6" />
              Chưa có thư mục file cho RFQ này (chưa tải tài liệu từ Samsung).
            </div>
          )}

          {!isLoading && !error && folder?.exists && (
            <div className="space-y-4">
              {/* Raw attachments — the "missing" files Thang wants */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    File đính kèm ({files.length})
                  </span>
                  {canShare && (
                    <span className="text-[10px] text-slate-400">Tick <Share2 className="inline h-2.5 w-2.5" /> để chia sẻ cho NCC</span>
                  )}
                </div>
                {files.length === 0 ? (
                  <div className="text-xs text-slate-400">Không có file đính kèm.</div>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {files.map((f) => (
                      <li key={f.name} className="flex items-center gap-2 px-3 py-2">
                        <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={f.name}>{f.name}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">{fmtSize(f.size)}</span>
                        {canShare && (
                          <button type="button" onClick={() => toggleShare('raw', f.name)} disabled={shareMut.isPending}
                            title={isShared('raw', f.name) ? 'Đang chia sẻ cho NCC — bấm để gỡ' : 'Chia sẻ file này cho NCC'}
                            className={cn('shrink-0 inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                              isShared('raw', f.name) ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
                            <Share2 className="h-3 w-3" /> {isShared('raw', f.name) ? 'Đang chia sẻ' : 'Chia sẻ'}
                          </button>
                        )}
                        <a
                          href={buildUrl('raw', f.name)}
                          download={f.name}
                          className="shrink-0 inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
                        >
                          <Download className="h-3 w-3" /> Tải
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Images of the code (for quick eyeball) */}
              {images.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Hình ảnh ({images.length})
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {images.map((img) => (
                      <div key={img.name} className="relative">
                        <a href={buildUrl('images', img.name)} target="_blank" rel="noreferrer"
                           className="block aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={buildUrl('images', img.name)} alt={img.name} className="h-full w-full object-cover" loading="lazy" />
                        </a>
                        {canShare && (
                          <button type="button" onClick={() => toggleShare('images', img.name)} disabled={shareMut.isPending}
                            title={isShared('images', img.name) ? 'Đang chia sẻ — bấm để gỡ' : 'Chia sẻ ảnh cho NCC'}
                            className={cn('absolute bottom-1 right-1 inline-flex items-center rounded p-1 transition-colors',
                              isShared('images', img.name) ? 'bg-emerald-600 text-white' : 'bg-white/90 text-slate-500 ring-1 ring-slate-200 hover:bg-white')}>
                            <Share2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
