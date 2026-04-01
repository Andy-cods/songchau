'use client';

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Scan,
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────

interface OcrResult {
  id: string;
  file_name: string;
  status: 'success' | 'failed' | 'processing';
  confidence: number;
  processed_at: string;
}

interface OcrExtractResponse {
  id: string;
  extracted_data: Record<string, unknown>;
  confidence: number;
  raw_text: string;
}

// ─── Page ───────────────────────────────────────────────────────

export default function OcrPage() {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [extractedResult, setExtractedResult] = useState<OcrExtractResponse | null>(null);
  const [dropError, setDropError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: historyRaw, isLoading: historyLoading } = useQuery<{
    data: { items: OcrResult[]; total: number };
  }>({
    queryKey: ['ocr', 'results'],
    queryFn: () => api.get('/api/v1/ocr/results?page=1'),
    retry: 1,
  });

  const extractMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload<{ data: OcrExtractResponse }>('/api/v1/ocr/extract', formData);
    },
    onSuccess: (res) => {
      setExtractedResult(res.data);
      queryClient.invalidateQueries({ queryKey: ['ocr', 'results'] });
    },
  });

  const handleExtract = () => {
    if (!selectedFile) return;
    setExtractedResult(null);
    extractMutation.mutate(selectedFile);
  };

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    setDropError('');
    const file = files[0];
    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      setDropError('File quá lớn. Tối đa 20MB');
      return;
    }
    setSelectedFile(file);
    setExtractedResult(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const clearFile = () => {
    setSelectedFile(null);
    setExtractedResult(null);
    setDropError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const history = historyRaw?.data?.items ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">
            <Scan className="h-5 w-5 inline mr-2 text-brand-600" />
            OCR - Trích xuất tài liệu
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Tải lên hình ảnh hoặc PDF để trích xuất dữ liệu tự động
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Upload Area */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Tải lên tài liệu</h3>

          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => !selectedFile && inputRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-lg p-8 text-center transition-all',
              isDragging
                ? 'border-brand-500 bg-brand-50 cursor-copy'
                : selectedFile
                ? 'border-emerald-400 bg-emerald-50 cursor-default'
                : 'border-slate-300 hover:border-slate-400 cursor-pointer'
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.tiff"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />

            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="h-8 w-8 text-emerald-600" />
                <div className="text-left">
                  <p className="text-sm font-medium text-slate-700">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {(selectedFile.size / 1024).toFixed(0)} KB
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFile();
                  }}
                  className="p-1 hover:bg-slate-100 rounded ml-2"
                >
                  <X className="h-4 w-4 text-slate-400" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="h-10 w-10 text-slate-400 mx-auto mb-3" />
                <p className="text-sm text-slate-600">
                  Kéo thả file vào đây hoặc{' '}
                  <span className="text-brand-600 font-medium">Chọn file</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  PDF, JPG, PNG, WEBP, TIFF — Tối đa 20MB
                </p>
              </>
            )}

            {dropError && (
              <p className="text-xs text-red-500 mt-2">{dropError}</p>
            )}
          </div>

          {/* Error from mutation */}
          {extractMutation.isError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">Trích xuất thất bại. Thử lại sau.</p>
            </div>
          )}

          {/* Extract Button */}
          <button
            onClick={handleExtract}
            disabled={!selectedFile || extractMutation.isPending}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {extractMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang xử lý...
              </>
            ) : (
              <>
                <Scan className="h-4 w-4" />
                Trích xuất
              </>
            )}
          </button>
        </div>

        {/* Extracted Result */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Kết quả trích xuất</h3>

          {extractMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
              <p className="text-sm">Đang phân tích tài liệu...</p>
            </div>
          ) : !extractedResult ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <Scan className="h-10 w-10 text-slate-300" />
              <p className="text-sm">Tải lên file và nhấn "Trích xuất"</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Confidence */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">Độ tin cậy:</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      extractedResult.confidence >= 0.8
                        ? 'bg-emerald-500'
                        : extractedResult.confidence >= 0.5
                        ? 'bg-amber-500'
                        : 'bg-red-400'
                    )}
                    style={{ width: `${(extractedResult.confidence * 100).toFixed(0)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-slate-700">
                  {(extractedResult.confidence * 100).toFixed(0)}%
                </span>
              </div>

              {/* Extracted Fields */}
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Dữ liệu trích xuất
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {Object.entries(extractedResult.extracted_data).length === 0 ? (
                    <p className="px-3 py-4 text-sm text-slate-400 text-center">
                      Không tìm thấy trường dữ liệu nào
                    </p>
                  ) : (
                    Object.entries(extractedResult.extracted_data).map(([key, value]) => (
                      <div key={key} className="flex px-3 py-2 gap-3">
                        <span className="text-xs font-mono text-slate-500 w-36 flex-shrink-0 pt-0.5">
                          {key}
                        </span>
                        <span className="text-sm text-slate-800 break-all">
                          {String(value)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Raw Text */}
              {extractedResult.raw_text && (
                <details className="group">
                  <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 select-none">
                    Xem văn bản thô
                  </summary>
                  <pre className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 overflow-auto max-h-40 whitespace-pre-wrap">
                    {extractedResult.raw_text}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">
            Lịch sử trích xuất
          </h3>
        </div>

        {historyLoading ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
                <div className="h-5 w-16 bg-slate-200 rounded-full animate-pulse" />
                <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
                <div className="h-4 w-28 bg-slate-200 rounded animate-pulse ml-auto" />
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <FileText className="h-8 w-8 mb-2 text-slate-300" />
            <p className="text-sm">Chưa có lịch sử trích xuất</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Tên file
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Trạng thái
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Độ tin cậy
                  </th>
                  <th className="text-left text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-3">
                    Thời gian
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-700 font-medium">
                      {item.file_name}
                    </td>
                    <td className="px-4 py-3">
                      <OcrStatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              item.confidence >= 0.8
                                ? 'bg-emerald-500'
                                : item.confidence >= 0.5
                                ? 'bg-amber-500'
                                : 'bg-red-400'
                            )}
                            style={{ width: `${(item.confidence * 100).toFixed(0)}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">
                          {(item.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {new Date(item.processed_at).toLocaleString('vi-VN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Status Badge ───────────────────────────────────────────────

function OcrStatusBadge({ status }: { status: OcrResult['status'] }) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
        <CheckCircle className="h-3 w-3" />
        Thành công
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
        <XCircle className="h-3 w-3" />
        Thất bại
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
      <Clock className="h-3 w-3" />
      Đang xử lý
    </span>
  );
}
