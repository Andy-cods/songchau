'use client';

/**
 * Interactive image cropper for BQMS primary images (Thang 2026-05-19).
 *
 * Opens on top of the preview modal. Loads the same image bytes the column
 * is currently serving (via /rfq/image), lets the user drag a crop rectangle
 * with react-image-crop, then POSTs the crop coords (in NATURAL pixel space —
 * react-image-crop's PixelCrop already accounts for any display scaling
 * applied by the <img>) to /code/{code}/crop-image which:
 *   - opens the source file with PIL
 *   - crops, saves as PNG into /data/onedrive-staging/.../<code>/cropped_<ts>.png
 *   - upserts bqms_image_index
 *   - pins the new file as primary
 *
 * After save the parent component bumps its cache-bust key so the column
 * thumbnail reloads and immediately shows the cropped version.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Loader2, Save, X, Scissors } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface ImageRow {
  path: string;
  filename: string;
  source: string;
  is_primary: boolean;
  exists: boolean;
}

interface Props {
  bqmsCode: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful save so the caller can refresh its thumbnail. */
  onSaved: () => void;
}

function withToken(url: string): string {
  if (typeof window === 'undefined') return url;
  const token = localStorage.getItem('access_token') ?? '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export function BqmsImageCropModal({
  bqmsCode,
  open,
  onClose,
  onSaved,
}: Props) {
  const [crop, setCrop] = useState<Crop | undefined>(undefined);
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [sourcePath, setSourcePath] = useState<string>('');
  const [imageSrc, setImageSrc] = useState<string>('');
  const [error, setError] = useState<string>('');
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Resolve the source path (primary if pinned, else first available) by
  // hitting /code/{code}/images. The backend crop endpoint requires an
  // absolute path that lives inside an allowed root, so we cannot just pass
  // the /rfq/image URL — we need the underlying file path.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingMeta(true);
    setError('');
    setSourcePath('');
    setImageSrc('');
    setCrop(undefined);
    setCompletedCrop(undefined);
    (async () => {
      try {
        const r = await api.get<{ data: { images: ImageRow[]; primary_path: string | null } }>(
          `/api/v1/bqms/code/${encodeURIComponent(bqmsCode)}/images`,
        );
        const rows: ImageRow[] = r.data?.images || [];
        const primary = rows.find((x) => x.is_primary && x.exists)
          || rows.find((x) => x.exists)
          || rows[0];
        if (!primary) {
          if (!cancelled) setError('Mã này chưa có ảnh nào để crop. Hãy upload ảnh trước.');
          return;
        }
        if (cancelled) return;
        setSourcePath(primary.path);
        // Use /code/{code}/image-blob with an explicit path so the cropper
        // loads the EXACT file we will send back to the crop endpoint.
        // normalize=1 → backend serves EXIF-corrected PNG so the pixel grid the
        // user crops on EXACTLY matches the grid the crop endpoint operates on
        // (fixes "crop sai tỷ lệ" with EXIF-rotated JPEG uploads).
        const blobUrl = withToken(
          `/api/v1/bqms/code/${encodeURIComponent(bqmsCode)}/image-blob?path=${encodeURIComponent(primary.path)}&normalize=1`,
        );
        setImageSrc(blobUrl);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.detail ?? err?.message ?? 'Không tải được danh sách ảnh');
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, bqmsCode]);

  if (!open || typeof document === 'undefined') return null;

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    // Default to a centered 80% crop of whatever shape the image is —
    // user can still drag the handles freely (no aspect lock).
    const initial = centerCrop(
      makeAspectCrop({ unit: '%', width: 80 }, width / height, width, height),
      width,
      height,
    );
    setCrop(initial);
  };

  const handleSave = async () => {
    if (!completedCrop || !imgRef.current) {
      toast.error('Hãy chọn vùng crop trước');
      return;
    }
    const img = imgRef.current;
    // react-image-crop emits PixelCrop measured via getBoundingClientRect(), so
    // completedCrop is in VISUAL (on-screen) pixels. Under `body { zoom: 0.8 }`
    // (globals.css) the visual box = layout px × 0.8, while img.width /
    // img.naturalWidth are LAYOUT px. Scaling visual-px crop by
    // naturalWidth/img.width mixed the two spaces → every saved crop came out at
    // ~0.8× and anchored top-left ("cắt sai tỷ lệ"). Use the rendered rect as the
    // denominator so the ratio is correct for ANY zoom value (0.8, 1, …).
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const naturalCrop = {
      x: Math.round(completedCrop.x * scaleX),
      y: Math.round(completedCrop.y * scaleY),
      width: Math.round(completedCrop.width * scaleX),
      height: Math.round(completedCrop.height * scaleY),
    };
    if (naturalCrop.width < 4 || naturalCrop.height < 4) {
      toast.error('Vùng crop quá nhỏ');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/api/v1/bqms/code/${encodeURIComponent(bqmsCode)}/crop-image`, {
        source_path: sourcePath,
        crop: naturalCrop,
      });
      toast.success('Đã crop và lưu ảnh chính');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.detail ?? err?.message ?? 'Crop thất bại');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Scissors className="w-4 h-4 text-emerald-600" />
            Crop ảnh — <span className="font-mono text-emerald-700">{bqmsCode}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-100 flex items-center justify-center p-6">
          {loadingMeta && (
            <span className="inline-flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang tải ảnh…
            </span>
          )}
          {!loadingMeta && error && (
            <span className="text-rose-600 text-sm">{error}</span>
          )}
          {!loadingMeta && !error && imageSrc && (
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              onComplete={(c) => setCompletedCrop(c)}
              keepSelection
              minWidth={20}
              minHeight={20}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imageSrc}
                alt={`Crop ${bqmsCode}`}
                onLoad={onImageLoad}
                className="block max-w-full max-h-[65vh] mx-auto"
              />
            </ReactCrop>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between flex-shrink-0 bg-slate-50 rounded-b-lg">
          <p className="text-xs text-slate-500">
            Kéo các góc để chỉnh vùng hiển thị. Ảnh gốc giữ nguyên — phần đã crop
            sẽ thành ảnh chính cho mã <span className="font-mono">{bqmsCode}</span>.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !completedCrop}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang lưu…
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" /> Lưu crop
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
