import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * usePasteImage — reusable clipboard-image-paste logic.
 *
 * Extracted VERBATIM (logic-faithful) from the proven Sourcing form uploader
 * (components/sourcing/SourcingFormDrawer.tsx, ImageUploader). It captures a
 * Ctrl+V'd image — including the Windows Snipping Tool case where the clipboard
 * item reports an EMPTY `type` — rebuilds a proper `File` (clipboard blobs come
 * with an empty filename, which previously broke multipart with a 422),
 * validates it, optionally downscales oversized images via canvas, and hands the
 * resulting `File` to a caller-supplied `onFile` callback.
 *
 * IMPORTANT — this hook does NOT upload anything. It only produces a `File`.
 * The delivery-dossier form stores Files locally in component state and uploads
 * them all at finalize time via a single multipart request. Wiring an upload
 * call here would break that flow. The hook's sole job is: clipboard → File.
 *
 * Scoping note: the `paste` listener is attached to `targetRef.current`, NOT to
 * `window`. This is deliberate and critical — a delivery dossier has multiple
 * image slots, and listening on `window` would make ONE Ctrl+V dump the same
 * image into EVERY slot. By binding to the focused element, only the slot the
 * user is interacting with (the one whose container is focused/hovered and
 * receives the paste event) captures the image.
 */

/* ─────────── Constants (re-exported for callers) ─────────── */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'];

/**
 * 5MB cap to match the delivery-dossier upload limit (the dossier's multipart
 * finalize endpoint rejects parts above 5MB). NOTE: this is intentionally
 * smaller than the Sourcing form's original ~10MB cap — keep them distinct.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — matches dossier upload guard

export const MAX_IMAGE_DIM = 2000; // px — downscale beyond this before handing off

/* ─────────── Helpers (re-exported for callers) ─────────── */

/**
 * Rebuild a clipboard/drop blob into a proper File. When the blob has an empty
 * `name` (the common clipboard case that triggered the multipart 422),
 * synthesize `clipboard-<ts>.<ext>` and carry the MIME (defaulting to image/png).
 */
export function clipboardImageToFile(blob: File | Blob): File {
  const type =
    (blob as File).type || (blob instanceof File ? blob.type : '') || 'image/png';
  const existingName = blob instanceof File ? blob.name : '';
  if (existingName && existingName.trim() !== '') {
    return blob instanceof File ? blob : new File([blob], existingName, { type });
  }
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  const ext = extMap[type] || 'png';
  return new File([blob], `clipboard-${Date.now()}.${ext}`, { type: type || 'image/png' });
}

/** Client-side validation. Returns a Vietnamese error string, or null if OK. */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'Định dạng ảnh không hợp lệ — chỉ chấp nhận JPG, PNG';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'Ảnh quá lớn (tối đa 5MB)';
  }
  return null;
}

/**
 * Downscale an image File via canvas if either dimension exceeds MAX_IMAGE_DIM.
 * Returns the original File when no resize is needed or anything fails
 * (best-effort). GIFs are passed through untouched (canvas would flatten the
 * animation).
 */
export async function maybeDownscaleImage(file: File): Promise<File> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return file;
  if (file.type === 'image/gif') return file;
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error('read-fail'));
      r.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('img-fail'));
      im.src = dataUrl;
    });
    const { width, height } = img;
    if (width <= MAX_IMAGE_DIM && height <= MAX_IMAGE_DIM) return file;
    const scale = MAX_IMAGE_DIM / Math.max(width, height);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    // Keep PNG transparency; everything else → JPEG for a smaller payload.
    const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), outType, 0.9),
    );
    if (!blob) return file;
    const ext = outType === 'image/png' ? 'png' : 'jpg';
    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.${ext}`, { type: outType });
  } catch {
    return file; // best-effort — fall back to the original on any failure
  }
}

/**
 * Pull the first image File out of a ClipboardEvent's data. Mirrors the
 * Sourcing form's two-pass scan: `files` first, then `items` (Snipping Tool /
 * crop / copy-image), where some clipboard items report an EMPTY type and still
 * need getAsFile().
 */
function pickImageFromClipboard(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  // 1) Some sources put the pasted image directly in `files`.
  if (dt.files && dt.files.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i];
      if (f && f.type.startsWith('image/')) return f;
    }
  }
  // 2) Otherwise scan `items` (Snipping Tool / crop / copy-image). Some
  // clipboard items report an empty type → still try getAsFile().
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      if (it.kind === 'file' && (it.type.startsWith('image/') || it.type === '')) {
        const f = it.getAsFile();
        if (f) return f;
      }
    }
  }
  return null;
}

/* ─────────── Hook ─────────── */

export interface UsePasteImageOptions {
  /** When false, the listener is detached (or never attached). Defaults true. */
  enabled?: boolean;
  /** When true, oversized images are downscaled to MAX_IMAGE_DIM. Defaults true. */
  downscale?: boolean;
}

/**
 * Attach a scoped `paste` listener to `targetRef.current`. On a clipboard image
 * paste it normalizes → validates → (optionally) downscales, then calls
 * `onFile(file)`. Invalid pastes are silently ignored (no upload, no throw) —
 * the caller decides how to surface validation, since this hook owns no UI.
 *
 * Cleans up the listener on unmount, when `enabled` flips false, or when the
 * ref target changes. SSR-safe: bails out when `window`/`document` are absent.
 *
 * @param targetRef  ref to the focusable image-slot element to bind to
 * @param onFile     receives the produced File (caller stores it; NO upload here)
 * @param opts       { enabled?, downscale? }
 */
export function usePasteImage(
  targetRef: RefObject<HTMLElement>,
  onFile: (file: File) => void,
  opts?: UsePasteImageOptions,
): void {
  const enabled = opts?.enabled ?? true;
  const downscale = opts?.downscale ?? true;

  useEffect(() => {
    if (!enabled) return;
    // SSR guard — no DOM to bind to on the server.
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const el = targetRef.current;
    if (!el) return;

    const onPaste = (e: ClipboardEvent) => {
      const picked = pickImageFromClipboard(e.clipboardData);
      if (!picked) return;
      e.preventDefault();

      // Rebuild a proper File (fixes clipboard empty-filename → 422 downstream).
      const file = clipboardImageToFile(picked);
      const invalid = validateImageFile(file);
      if (invalid) return; // caller owns UI; we just don't emit an invalid file

      if (downscale) {
        maybeDownscaleImage(file).then(onFile);
      } else {
        onFile(file);
      }
    };

    el.addEventListener('paste', onPaste as EventListener);
    return () => el.removeEventListener('paste', onPaste as EventListener);
  }, [targetRef, onFile, enabled, downscale]);
}
