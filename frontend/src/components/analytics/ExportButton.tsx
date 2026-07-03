'use client';

/**
 * ExportButton — shared export trigger for analytics panels.
 *
 * Props:
 *   - scope:    Analytics page slug (e.g. "xnk", "price-trends", "forecast")
 *   - panel:    Panel identifier within the page (e.g. "kpi-strip", "hs-histogram")
 *   - filters:  Current filter snapshot — POSTed to backend for server-side export
 *   - chartRef: Optional ref to the chart DOM container; required for PNG export
 *
 * Behavior:
 *   CSV  / XLSX → POST /api/v1/analytics/exports { scope, panel, format, filters }
 *                 → server returns { download_url } OR raw blob
 *   PNG         → html2canvas(chartRef.current) → dataURL
 *                 → POST /api/v1/analytics/exports { scope, panel, format: "png", filters, png_data_url }
 *                 → server stores + returns download_url, then auto-download
 *
 * The endpoint returns either a JSON envelope { download_url, filename } OR
 * a binary blob with Content-Disposition header. Both flows handled.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Download, FileSpreadsheet, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export type ExportFormat = 'csv' | 'xlsx' | 'png';

export interface ExportButtonProps {
  /** Page-level slug, e.g. "xnk" | "price-trends" | "forecast" */
  scope: string;
  /** Panel identifier, e.g. "kpi-strip" | "monthly-trend" */
  panel: string;
  /** Snapshot of the filters that produced the current view */
  filters?: Record<string, unknown>;
  /** Ref to the DOM element to rasterize for PNG exports */
  chartRef?: RefObject<HTMLDivElement>;
  /** Optional override label for screen readers / tooltip */
  label?: string;
  /** Compact (icon-only, no border). Default true to match panel header style. */
  compact?: boolean;
  className?: string;
}

const FORMATS: { value: ExportFormat; label: string; hint: string; icon: typeof FileText }[] = [
  { value: 'csv', label: 'CSV', hint: 'Bảng phẳng — mở bằng Excel/Sheets', icon: FileText },
  { value: 'xlsx', label: 'XLSX', hint: 'Excel có format + nhiều sheet', icon: FileSpreadsheet },
  { value: 'png', label: 'PNG (ảnh)', hint: 'Snapshot biểu đồ hiện tại', icon: ImageIcon },
];

function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function triggerUrlDownload(url: string, filename?: string) {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Lazy-load html2canvas only when PNG export is requested.
 * Falls back gracefully if the package is not installed (dev env).
 */
async function rasterizeChart(node: HTMLElement): Promise<string> {
  // @ts-expect-error — html2canvas is installed at runtime (see package.json)
  const html2canvasModule = await import('html2canvas');
  const html2canvas = html2canvasModule.default ?? html2canvasModule;
  const canvas = await html2canvas(node, {
    backgroundColor: '#ffffff',
    scale: 2,
    logging: false,
    useCORS: true,
  });
  return canvas.toDataURL('image/png');
}

export function ExportButton({
  scope,
  panel,
  filters,
  chartRef,
  label,
  compact = true,
  className,
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setBusy(format);
      setError(null);
      try {
        let pngDataUrl: string | null = null;
        if (format === 'png') {
          const node = chartRef?.current;
          if (!node) {
            throw new Error('Không tìm thấy biểu đồ để xuất ảnh.');
          }
          pngDataUrl = await rasterizeChart(node);
        }

        const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
        const token = getAccessToken();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch(`${baseUrl}/api/v1/analytics/exports`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            scope,
            panel,
            format,
            filters: filters ?? {},
            png_data_url: pngDataUrl,
          }),
        });

        if (!res.ok) {
          let detail = `Export thất bại (HTTP ${res.status})`;
          try {
            const j = await res.json();
            detail = j.detail || j.message || detail;
          } catch {
            // Not JSON — keep generic
          }
          throw new Error(detail);
        }

        // Branch 1: backend returned JSON envelope with a download URL
        const contentType = res.headers.get('Content-Type') || '';
        if (contentType.includes('application/json')) {
          const j = (await res.json()) as { download_url?: string; filename?: string };
          if (j.download_url) {
            triggerUrlDownload(j.download_url, j.filename);
          } else {
            throw new Error('Server không trả về URL tải về.');
          }
        } else {
          // Branch 2: backend streamed the file directly
          const blob = await res.blob();
          const cd = res.headers.get('Content-Disposition') || '';
          const match = /filename="?([^";]+)"?/i.exec(cd);
          const filename =
            match?.[1] ||
            `${scope}-${panel}-${new Date().toISOString().slice(0, 10)}.${format === 'xlsx' ? 'xlsx' : format}`;
          triggerBrowserDownload(blob, filename);
        }

        setOpen(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Export thất bại.';
        setError(msg);
      } finally {
        setBusy(null);
      }
    },
    [chartRef, filters, panel, scope],
  );

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label || `Xuất dữ liệu — ${panel}`}
        title={label || 'Xuất dữ liệu'}
        className={cn(
          'inline-flex items-center justify-center rounded-md p-1.5 text-slate-500 transition hover:text-slate-700 hover:bg-slate-100',
          !compact && 'border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold',
          busy && 'opacity-60 cursor-wait',
        )}
        disabled={!!busy}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {!compact && <span className="ml-1">Xuất</span>}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg ring-1 ring-slate-100"
        >
          {FORMATS.map(({ value, label: fmtLabel, hint, icon: Icon }) => {
            const disabled = value === 'png' && !chartRef?.current;
            const isBusy = busy === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitem"
                disabled={disabled || !!busy}
                onClick={() => handleExport(value)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-xs transition',
                  'hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40',
                  isBusy && 'bg-slate-50',
                )}
              >
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  {isBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-semibold text-slate-800">{fmtLabel}</span>
                  <span className="block text-[10.5px] leading-tight text-slate-500">
                    {disabled ? 'Cần ref vào biểu đồ' : hint}
                  </span>
                </span>
              </button>
            );
          })}
          {error && (
            <p className="mt-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default ExportButton;
