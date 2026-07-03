'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface PreviewResponse {
  data: {
    dry_run?: boolean;
    total_parsed?: number;
    inserted?: number;
    skipped: number;
    preview?: Record<string, unknown>[];
    headers_detected: { index: number; field: string; header: string }[];
  };
  message?: string;
}

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export function SourcingImportModal({ onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      const res = await api.post('/api/v1/sourcing/import-excel?dry_run=true', fd) as PreviewResponse;
      return res;
    },
    onSuccess: (res) => {
      setPreview(res.data);
      setError(null);
    },
    onError: (err: any) => {
      setError(err?.response?.data?.detail || err?.message || 'Lỗi đọc file');
    },
  });

  const commitMutation = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      const res = await api.post('/api/v1/sourcing/import-excel?dry_run=false', fd) as PreviewResponse;
      return res;
    },
    onSuccess: () => {
      onImported();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.detail || err?.message || 'Lỗi import');
    },
  });

  const pickFile = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setError(null);
    if (f) previewMutation.mutate(f);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="flex h-full max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-brand-50/40 px-6 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700">Bulk import</p>
            <h2 className="text-xl font-semibold text-slate-900">Nhập sourcing từ Excel</h2>
            <p className="mt-1 text-xs text-slate-600">
              Hệ thống nhận diện cột theo header tiếng Việt (Tên KH, Maker, Giá nhập VND, NCC, Hình ảnh...). Sẽ preview trước khi commit.
            </p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!file && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) pickFile(f);
              }}
              className={cn(
                'flex h-56 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition',
                dragOver
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-slate-300 bg-slate-50 hover:border-brand-300 hover:bg-brand-50/40',
              )}
            >
              <div className="rounded-full bg-brand-100 p-3">
                <Upload className="h-6 w-6 text-brand-600" />
              </div>
              <p className="text-sm font-semibold text-slate-800">Kéo thả file .xlsx vào đây</p>
              <p className="text-xs text-slate-500">hoặc click để chọn · max 20MB</p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => pickFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </button>
          )}

          {file && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{file.name}</p>
                    <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                    if (inputRef.current) inputRef.current.value = '';
                  }}
                  className="text-xs font-semibold text-rose-600 hover:underline"
                >
                  Đổi file
                </button>
              </div>

              {previewMutation.isPending && (
                <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 py-8 text-sm text-slate-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Đang phân tích Excel...
                </div>
              )}

              {error && (
                <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              {preview && (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <StatCard label="Sẽ import" value={preview.total_parsed ?? 0} tone="emerald" />
                    <StatCard label="Bỏ qua" value={preview.skipped} tone="amber" />
                    <StatCard label="Cột nhận diện" value={preview.headers_detected.length} tone="sky" />
                  </div>

                  <details className="rounded-xl border border-slate-200 bg-white" open>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
                      Ánh xạ cột Excel → DB ({preview.headers_detected.length} cột)
                    </summary>
                    <div className="border-t border-slate-100 p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {preview.headers_detected.map((h) => (
                          <div
                            key={h.index}
                            className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs"
                          >
                            <span className="font-mono text-slate-600">{h.header}</span>
                            <span className="font-semibold text-brand-700">→ {h.field}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>

                  {preview.preview && preview.preview.length > 0 && (
                    <details className="rounded-xl border border-slate-200 bg-white">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
                        Preview 5 dòng đầu
                      </summary>
                      <div className="overflow-x-auto border-t border-slate-100">
                        <table className="min-w-full text-xs">
                          <tbody>
                            {preview.preview.map((row, idx) => (
                              <tr key={idx} className="border-b border-slate-100 last:border-0">
                                <td className="px-3 py-2 font-mono font-semibold text-brand-700">{idx + 1}</td>
                                <td className="px-3 py-2 text-slate-700">
                                  {row.product_name ? String(row.product_name) : '—'}
                                  {Boolean(row.bqms_code) && (
                                    <span className="ml-2 font-mono text-[11px] text-slate-500">{String(row.bqms_code)}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-slate-600">{row.maker ? String(row.maker) : '—'}</td>
                                <td className="px-3 py-2 text-slate-600">{row.supplier_name ? String(row.supplier_name) : '—'}</td>
                                <td className="px-3 py-2 text-right font-mono text-slate-700">
                                  {row.cost_vnd ? Number(row.cost_vnd).toLocaleString('vi-VN') : '—'}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-emerald-700">
                                  {row.sale_vnd ? Number(row.sale_vnd).toLocaleString('vi-VN') : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </>
              )}

              {commitMutation.data && (
                <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{commitMutation.data.message || `Đã import ${commitMutation.data.data.inserted} entries`}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/40 px-6 py-4">
          <p className="text-xs text-slate-500">
            Cột tìm tự động: <span className="font-mono">Tên KH, Maker, Giá nhập VND/USD/JPY/Won/RMB, NCC, Số lượng, HS Code...</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              onClick={() => file && commitMutation.mutate(file)}
              disabled={!file || !preview || commitMutation.isPending || (preview.total_parsed ?? 0) === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
            >
              {commitMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Import {preview?.total_parsed ?? 0} entry
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'sky' }) {
  const toneClass = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    sky: 'bg-sky-50 text-sky-700',
  }[tone];
  return (
    <div className={cn('rounded-xl border border-slate-200 px-4 py-3 text-center', toneClass)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value.toLocaleString('vi-VN')}</p>
    </div>
  );
}
