'use client';

// PR-2 (Thang 2026-05-13): extracted from bqms/page.tsx.
//
// Hits GET /api/v1/bqms/rfq/image which searches all RFQ scrape folders
// for `<bqms_code>_*.png/jpg`. Returns 404 if no image exists for this
// item (which is the common case — only ~30% of items have an image
// from the RFQ_*.xlsx Picture column).
//
// Uses a tiny <img> with onError that swaps to a placeholder icon. Avoids
// React Query because we want browser-level image cache + we don't need
// the orchestration overhead.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { XCircle, Pencil, ImageOff, Loader2, Scissors } from 'lucide-react';

// Code-splitting (W3-16): BqmsImageThumb renders once per image cell, so it
// can appear dozens of times per table/grid. Both modals only mount when a
// user clicks "pick"/"crop" on a specific thumb (state-gated below), so
// deferring their chunks removes them from every page that lists images.
const BqmsImagePickerModal = dynamic(
  () => import('./BqmsImagePickerModal').then((m) => m.BqmsImagePickerModal),
  { ssr: false, loading: () => null },
);
const BqmsImageCropModal = dynamic(
  () => import('./BqmsImageCropModal').then((m) => m.BqmsImageCropModal),
  { ssr: false, loading: () => null },
);

function withToken(url: string): string {
  if (typeof window === 'undefined') return url;
  const token = localStorage.getItem('access_token') ?? '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

// Auto-retry once after this many ms — gives the inline-indexer / crawler a
// moment to populate bqms_image_index right after a fresh RFQ scrape.
const RETRY_AFTER_MS = 1800;

export function BqmsImageThumb({
  bqmsCode,
  rfqNumber,
}: {
  bqmsCode: string | null;
  rfqNumber: string | null;
}) {
  const [errored, setErrored] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [loading, setLoading] = useState(true);
  // Viewport-lazy: only fetch image after the thumb scrolls into view
  // (Thang 2026-05-22). Prevents 100 parallel /rfq/image requests freezing
  // sc-api (root cause of the 504 storm).
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Cache-bust key bumped on (a) picker reports primary change, (b) auto-retry
  // after first error, (c) manual reload. Forces <img> to re-fetch.
  const [bustKey, setBustKey] = useState(0);
  const retriedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // IntersectionObserver — start loading image when within 200px of viewport.
  useEffect(() => {
    if (inView) return;
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      // SSR or old browser — load immediately
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  // Phase Q (Thang 2026-05-19): bỏ placeholder "4 chữ số cuối của mã"
  // — codes Samsung kết thúc bằng digits nên placeholder trông y hệt
  // 1 ô số → user tưởng nhầm là "ảnh đang hiển thị mấy con số". Giờ dùng
  // icon ImageOff cho rõ ràng là KHÔNG có ảnh.
  const titleText = bqmsCode
    ? `Chưa có ảnh: ${bqmsCode}`
    : (rfqNumber ? `Chưa có ảnh: ${rfqNumber}` : 'Chưa có ảnh');
  const Placeholder = (
    <span
      className="inline-flex flex-col items-center justify-center w-16 h-16 rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-400 select-none"
      title={titleText}
    >
      <ImageOff className="w-6 h-6" strokeWidth={1.5} />
      <span className="text-[11px] mt-0.5 font-medium tracking-tight">no image</span>
    </span>
  );

  // Phase E (Thang 2026-05-13): khi row RFQ-level (#items=0) → bqmsCode null
  // nhưng rfq folder vẫn có ảnh xlsx-extracted. Endpoint /rfq/image đã hỗ trợ
  // missing bqms_code → trả về ảnh đầu tiên của folder. Chỉ placeholder khi
  // cả 2 đều null (impossible case in practice).
  if (!bqmsCode && !rfqNumber) return Placeholder;

  const params = new URLSearchParams();
  if (bqmsCode) params.set('bqms_code', bqmsCode);
  if (rfqNumber) params.set('rfq_number', rfqNumber);
  if (bustKey) params.set('_b', String(bustKey));
  const src = withToken(`/api/v1/bqms/rfq/image?${params.toString()}`);

  // Picker only makes sense when bqms_code is known
  const canPick = !!bqmsCode;

  const handleError = () => {
    // First failure → auto-retry after the inline-indexer should have run.
    if (!retriedRef.current) {
      retriedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        setLoading(true);
        setBustKey((k) => k + 1);
      }, RETRY_AFTER_MS);
      return;
    }
    setLoading(false);
    setErrored(true);
  };

  if (errored) {
    return (
      <div className="relative inline-block group">
        {Placeholder}
        {canPick && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPicking(true); }}
            className="absolute -bottom-1 -right-1 bg-white border border-slate-300 rounded-full w-5 h-5 flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-emerald-50 hover:border-emerald-400"
            title="Chọn / tải ảnh mới"
          >
            <Pencil className="w-2.5 h-2.5 text-slate-600" />
          </button>
        )}
        {picking && canPick && (
          <BqmsImagePickerModal
            bqmsCode={bqmsCode!}
            open={picking}
            onClose={() => setPicking(false)}
            onPrimaryChanged={() => {
              retriedRef.current = false;
              setErrored(false);
              setLoading(true);
              setBustKey((k) => k + 1);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block group">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setPreviewing(true);
        }}
        className="relative inline-block w-16 h-16 rounded-md border border-slate-200 bg-slate-50 overflow-hidden hover:ring-2 hover:ring-brand-400 hover:scale-105 transition-all shadow-sm"
        title={`Xem ảnh ${bqmsCode ?? rfqNumber ?? ''}`}
      >
        {(loading || !inView) && (
          <span className="absolute inset-0 flex items-center justify-center bg-slate-50/80 pointer-events-none">
            {inView ? (
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            ) : (
              // Lightweight placeholder dot while waiting for viewport
              <span className="w-1 h-1 rounded-full bg-slate-300" />
            )}
          </span>
        )}
        {/* Only mount <img> after the cell scrolls into view. Without this,
            100 rows fire 100 parallel /rfq/image requests on first paint and
            sc-api's event loop chokes → 504. */}
        {inView && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={bqmsCode ?? rfqNumber ?? ''}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onLoad={() => setLoading(false)}
            onError={handleError}
          />
        )}
      </button>
      {canPick && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPicking(true); }}
          className="absolute -bottom-1 -right-1 bg-white border border-slate-300 rounded-full w-5 h-5 flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-emerald-50 hover:border-emerald-400"
          title="Chọn / tải ảnh mới"
        >
          <Pencil className="w-2.5 h-2.5 text-slate-600" />
        </button>
      )}
      {picking && canPick && (
        <BqmsImagePickerModal
          bqmsCode={bqmsCode!}
          open={picking}
          onClose={() => setPicking(false)}
          onPrimaryChanged={() => {
            retriedRef.current = false;
            setLoading(true);
            setBustKey((k) => k + 1);
          }}
        />
      )}

      {previewing && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-8"
          onClick={() => setPreviewing(false)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl max-w-3xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <h3 className="font-mono text-sm font-semibold text-slate-700 truncate">{bqmsCode ?? rfqNumber}</h3>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {canPick && (
                  <button
                    type="button"
                    onClick={() => setCropping(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    title="Crop ảnh và lưu làm ảnh chính"
                  >
                    <Scissors className="w-3.5 h-3.5" /> Crop
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewing(false)}
                  className="text-slate-400 hover:text-slate-700 p-1"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-5 bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={bqmsCode ?? rfqNumber ?? ''}
                className="max-w-full max-h-[70vh] mx-auto"
              />
            </div>
          </div>
        </div>,
        document.body,
      )}

      {cropping && canPick && (
        <BqmsImageCropModal
          bqmsCode={bqmsCode!}
          open={cropping}
          onClose={() => setCropping(false)}
          onSaved={() => {
            retriedRef.current = false;
            setErrored(false);
            setLoading(true);
            setBustKey((k) => k + 1);
            setPreviewing(false);
          }}
        />
      )}
    </div>
  );
}
