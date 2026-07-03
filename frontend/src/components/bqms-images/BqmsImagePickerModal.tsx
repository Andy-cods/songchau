'use client';

/**
 * Image Picker Modal — Thang 2026-05-19 (redesigned).
 *
 * What this modal does:
 *   - Lists every image known for a `bqms_code` (RFQ-scraped + uploaded +
 *     cropped + quote-override).
 *   - Lets the user click any card to pin it as the primary — the one shown
 *     in the BQMS list column, embedded into GC báo giá, and into the dossier
 *     "Cam kết hình ảnh" sheet.
 *   - Lets the user upload a brand-new image (auto-indexed + auto-pinned).
 *   - Lets the user DELETE override/uploaded/cropped images that turned out
 *     wrong. RFQ-source images from Samsung are protected — the X icon is
 *     hidden for `source === 'rfq'` so a misclick can't destroy ground truth.
 *
 * Click model (the previous version had a small "Chọn ảnh này" button that
 * was easy to miss — that's the source of the "click không hoạt động"
 * complaint). New model:
 *   - WHOLE CARD = click to pin as primary (large, obvious hit target).
 *   - Top-right X icon (override only) = delete.
 *   - "Đang dùng" badge replaces the button on the primary card so the
 *     selected state is unambiguous.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Upload, Loader2, Check, AlertCircle, Image as ImageIcon,
  ImageOff, X, Trash2, Star, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface ImageEntry {
  path: string;
  filename: string;
  source: 'override' | 'quote' | 'rfq' | 'product' | string;
  rfq_number: string | null;
  sibling_of_code?: string | null;
  file_size: number | null;
  mtime: string | null;
  is_primary: boolean;
  exists: boolean;
  // Thang 2026-05-20: which group this image belongs to.
  //   own     — extracted/indexed for this exact code
  //   upload  — user uploaded via picker (code-level override)
  //   sibling — image from another bqms_code in the same RFQ folder
  scope?: 'own' | 'upload' | 'sibling';
}

interface ListResponse {
  data: {
    bqms_code: string;
    primary_path: string | null;
    images: ImageEntry[];
    rfq_numbers?: string[];
    total: number;
  };
}

function withToken(url: string): string {
  if (typeof window === 'undefined') return url;
  const token = localStorage.getItem('access_token') ?? '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

function sourceBadge(source: string): { label: string; cls: string } {
  switch (source) {
    case 'override': return { label: 'Upload', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'quote':    return { label: 'Báo giá', cls: 'bg-sky-50 text-sky-700 border-sky-200' };
    case 'rfq':      return { label: 'RFQ',    cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'product':  return { label: 'SP',     cls: 'bg-brand-50 text-brand-700 border-brand-200' };
    default:         return { label: source,   cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  }
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isCroppedFilename(name: string): boolean {
  return name.toLowerCase().startsWith('cropped_');
}

export function BqmsImagePickerModal({
  bqmsCode,
  open,
  onClose,
  onPrimaryChanged,
}: {
  bqmsCode: string;
  open: boolean;
  onClose: () => void;
  onPrimaryChanged?: (newPath: string | null) => void;
}) {
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [primaryPath, setPrimaryPath] = useState<string | null>(null);
  const [rfqNumbers, setRfqNumbers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchImages = async () => {
    if (!bqmsCode) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<ListResponse>(
        `/api/v1/bqms/code/${encodeURIComponent(bqmsCode)}/images`,
      );
      setImages(r.data.images || []);
      setPrimaryPath(r.data.primary_path);
      setRfqNumbers(r.data.rfq_numbers || []);
    } catch (e: any) {
      setError(e?.detail ?? e?.message ?? 'Không tải được danh sách ảnh');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setConfirmingDelete(null);
      fetchImages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bqmsCode]);

  const handleSetPrimary = async (path: string) => {
    if (savingPath || deletingPath) return;
    if (path === primaryPath) return; // already primary — no-op
    setSavingPath(path);
    try {
      await api.post(
        `/api/v1/bqms/code/${encodeURIComponent(bqmsCode)}/primary-image`,
        { image_path: path },
      );
      setPrimaryPath(path);
      setImages((prev) => prev.map((img) => ({ ...img, is_primary: img.path === path })));
      toast.success('Đã chọn làm ảnh chính');
      onPrimaryChanged?.(path);
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? 'Không cập nhật được ảnh chính');
    } finally {
      setSavingPath(null);
    }
  };

  const handleDelete = async (path: string) => {
    if (savingPath || deletingPath) return;
    setDeletingPath(path);
    setConfirmingDelete(null);
    try {
      const res = await api.delete<{ data: { primary_cleared: boolean } }>(
        `/api/v1/bqms/code/${encodeURIComponent(bqmsCode)}/image?path=${encodeURIComponent(path)}`,
      );
      // Remove from local list
      setImages((prev) => prev.filter((img) => img.path !== path));
      if (res.data?.primary_cleared) {
        setPrimaryPath(null);
        onPrimaryChanged?.(null);
      }
      toast.success('Đã xoá ảnh');
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? 'Xoá thất bại');
    } finally {
      setDeletingPath(null);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File quá lớn (>10MB)');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      toast.error('Chỉ chấp nhận PNG/JPG');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('set_primary', 'true');
      await api.upload(
        `/api/v1/bqms/code/${encodeURIComponent(bqmsCode)}/upload-image`,
        form,
      );
      toast.success(`Đã tải lên ${file.name}`);
      await fetchImages();
      onPrimaryChanged?.('uploaded');
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? 'Upload thất bại');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-white">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              Chọn ảnh chính
            </h3>
            <div className="text-xs text-slate-500 font-mono mt-0.5 truncate">
              {bqmsCode}{primaryPath ? ` • đang ghim: ${primaryPath.split('/').pop()}` : ' • chưa ghim ảnh nào'}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold shadow-sm transition-colors"
            >
              {uploading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Upload className="w-4 h-4" />}
              {uploading ? 'Đang tải lên…' : 'Tải ảnh lên'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ─── Body ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto p-6 bg-slate-50">
          {loading && (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span className="text-sm">Đang tải ảnh…</span>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-700">{error}</div>
            </div>
          )}
          {!loading && !error && images.length === 0 && (
            <div className="text-center py-20 text-slate-500">
              <ImageIcon className="w-16 h-16 mx-auto mb-3 text-slate-300" />
              <div className="text-sm">
                Chưa có ảnh nào cho mã <span className="font-mono font-semibold">{bqmsCode}</span>
              </div>
              <div className="text-xs mt-2 text-slate-400">
                Bấm "Tải ảnh lên" để thêm ảnh đầu tiên
              </div>
            </div>
          )}
          {!loading && images.length > 0 && (() => {
            // Thang 2026-05-20: split by scope so user thấy rõ ảnh "của mã này"
            // vs ảnh "cùng QT (mã khác)" — RFQ QT26066093 case: cùng đơn nhưng
            // mỗi mã có 1 ảnh, picker giờ cho phép pin ảnh của mã khác làm
            // ảnh chính cho mã đang xét.
            const ownAndUploads = images.filter((i) => (i.scope ?? 'own') !== 'sibling');
            const siblings = images.filter((i) => i.scope === 'sibling');
            return (
              <div className="space-y-6">
                {/* Section 1: Own + Uploads */}
                {ownAndUploads.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                        Ảnh của mã này
                      </h4>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {ownAndUploads.length} ảnh
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {ownAndUploads.map((img) => (
                        <ImageCard
                          key={img.path}
                          img={img}
                          bqmsCode={bqmsCode}
                          isSaving={savingPath === img.path}
                          isDeleting={deletingPath === img.path}
                          busy={!!(savingPath || deletingPath)}
                          confirmingDelete={confirmingDelete === img.path}
                          onPick={() => handleSetPrimary(img.path)}
                          onRequestDelete={() => setConfirmingDelete(img.path)}
                          onCancelDelete={() => setConfirmingDelete(null)}
                          onConfirmDelete={() => handleDelete(img.path)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Section 2: RFQ-sibling images (other bqms_codes in same RFQ) */}
                {siblings.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3 pt-4 border-t border-slate-200">
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                        Ảnh khác cùng QT
                      </h4>
                      {rfqNumbers.length > 0 && (
                        <span className="text-[11px] text-slate-500 font-mono">
                          {rfqNumbers.slice(0, 2).join(', ')}
                          {rfqNumbers.length > 2 ? ` +${rfqNumbers.length - 2}` : ''}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400 font-mono">
                        {siblings.length} ảnh
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mb-3 flex items-start gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                      <span>
                        Đây là ảnh thuộc các mã linh kiện khác trong cùng đơn — vẫn pin được
                        nếu muốn dùng chung. Tag <span className="font-semibold">"từ mã X"</span> cho biết ảnh gốc thuộc mã nào.
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {siblings.map((img) => (
                        <ImageCard
                          key={img.path}
                          img={img}
                          bqmsCode={bqmsCode}
                          isSaving={savingPath === img.path}
                          isDeleting={deletingPath === img.path}
                          busy={!!(savingPath || deletingPath)}
                          confirmingDelete={confirmingDelete === img.path}
                          onPick={() => handleSetPrimary(img.path)}
                          onRequestDelete={() => setConfirmingDelete(img.path)}
                          onCancelDelete={() => setConfirmingDelete(null)}
                          onConfirmDelete={() => handleDelete(img.path)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            );
          })()}
        </div>

        {/* ─── Footer hint ────────────────────────────────────────────── */}
        <div className="px-6 py-3 border-t border-slate-200 bg-white flex items-center gap-2 text-xs text-slate-500">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <span>
            Click vào ảnh để ghim làm <strong>ảnh chính</strong> — hiển thị ở bảng BQMS, báo giá GC,
            và sheet "Cam kết hình ảnh". Chỉ xoá được ảnh upload/crop; ảnh RFQ gốc được bảo vệ.
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}


// ─── Single image card ────────────────────────────────────────────────

function ImageCard({
  img, bqmsCode, isSaving, isDeleting, busy, confirmingDelete,
  onPick, onRequestDelete, onCancelDelete, onConfirmDelete,
}: {
  img: ImageEntry;
  bqmsCode: string;
  isSaving: boolean;
  isDeleting: boolean;
  busy: boolean;
  confirmingDelete: boolean;
  onPick: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const badge = sourceBadge(img.source);
  const blobUrl = withToken(
    `/api/v1/bqms/code/${encodeURIComponent(bqmsCode)}/image-blob?path=${encodeURIComponent(img.path)}`,
  );

  // Override files (manually uploaded OR cropped) are user-deletable.
  // RFQ-scraped originals are NOT — they're the source of truth from Samsung.
  const canDelete = img.source === 'override';
  const cropped = canDelete && isCroppedFilename(img.filename);

  const handleCardClick = () => {
    if (busy || img.is_primary || confirmingDelete) return;
    onPick();
  };

  return (
    <div
      className={`group relative bg-white border-2 rounded-xl overflow-hidden shadow-sm transition-all
        ${img.is_primary
          ? 'border-emerald-500 ring-4 ring-emerald-100'
          : busy
            ? 'border-slate-200 opacity-60'
            : 'border-slate-200 hover:border-emerald-400 hover:shadow-md cursor-pointer'}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={img.is_primary || busy ? -1 : 0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !busy && !img.is_primary) {
          e.preventDefault();
          onPick();
        }
      }}
      aria-pressed={img.is_primary}
      aria-label={`${img.is_primary ? 'Ảnh chính đang dùng: ' : 'Chọn ảnh: '}${img.filename}`}
    >
      {/* Image */}
      <div className="aspect-square bg-slate-100 flex items-center justify-center relative overflow-hidden">
        {loadState === 'loading' && (
          <Loader2 className="w-6 h-6 text-slate-300 animate-spin absolute" />
        )}
        {loadState === 'error' ? (
          <div className="flex flex-col items-center justify-center text-slate-400 text-xs p-3 text-center">
            <ImageOff className="w-8 h-8 mb-1" />
            <span>Không tải được ảnh</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={blobUrl}
            alt={img.filename}
            className={`w-full h-full object-contain transition-opacity ${
              loadState === 'loaded' ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setLoadState('loaded')}
            onError={() => setLoadState('error')}
          />
        )}

        {/* Primary overlay badge (top-left) */}
        {img.is_primary && (
          <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-600 text-white text-xs font-bold shadow-lg">
            <Star className="w-3.5 h-3.5 fill-current" />
            Đang dùng
          </div>
        )}

        {/* Saving spinner overlay */}
        {isSaving && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow text-sm font-semibold text-emerald-700">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang ghim…
            </div>
          </div>
        )}

        {/* Deleting spinner overlay */}
        {isDeleting && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow text-sm font-semibold text-rose-700">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang xoá…
            </div>
          </div>
        )}

        {/* Delete X button (top-right) — only for override files */}
        {canDelete && !isDeleting && !isSaving && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete();
            }}
            disabled={busy}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 backdrop-blur border border-slate-300
                       text-rose-600 hover:bg-rose-600 hover:text-white hover:border-rose-600
                       opacity-0 group-hover:opacity-100 transition-all shadow-md flex items-center justify-center
                       disabled:opacity-30 disabled:cursor-not-allowed"
            title={cropped ? 'Xoá ảnh đã crop' : 'Xoá ảnh upload'}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Confirm-delete overlay */}
        {confirmingDelete && (
          <div
            className="absolute inset-0 bg-rose-950/85 flex flex-col items-center justify-center gap-3 p-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Trash2 className="w-7 h-7 text-rose-200" />
            <div className="text-white text-xs font-semibold">
              Xoá ảnh này?
              {cropped && <div className="text-rose-200 text-[11px] mt-1 font-normal">(crop sai)</div>}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCancelDelete(); }}
                className="px-3 py-1 rounded text-xs bg-white text-slate-700 hover:bg-slate-100 font-medium"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onConfirmDelete(); }}
                className="px-3 py-1 rounded text-xs bg-rose-600 text-white hover:bg-rose-700 font-semibold inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Xoá
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>
            {badge.label}
          </span>
          {cropped && (
            <span className="text-[11px] px-2 py-0.5 rounded-full border bg-brand-50 text-brand-700 border-brand-200 font-medium">
              Đã crop
            </span>
          )}
          {img.scope === 'sibling' && img.sibling_of_code && (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full border bg-sky-50 text-sky-700 border-sky-200 font-medium font-mono"
              title={`Ảnh gốc thuộc mã ${img.sibling_of_code}`}
            >
              từ {img.sibling_of_code}
            </span>
          )}
        </div>
        <div
          className="text-[11px] font-mono text-slate-600 truncate"
          title={img.filename}
        >
          {img.filename}
        </div>
        <div className="text-[11px] text-slate-400 flex items-center justify-between">
          <span>{formatSize(img.file_size)}</span>
          {img.rfq_number && (
            <span className="font-mono truncate ml-2" title={img.rfq_number}>
              {img.rfq_number}
            </span>
          )}
        </div>
        {/* Action hint — shows only on non-primary, fades in on hover */}
        {!img.is_primary && !busy && (
          <div className="pt-1 text-[11px] text-emerald-700 font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            <Check className="w-3 h-3" /> Click để chọn làm ảnh chính
          </div>
        )}
      </div>
    </div>
  );
}
