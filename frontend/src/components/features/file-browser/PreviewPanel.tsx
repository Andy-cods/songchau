'use client';

import { X, Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { ExcelPreview } from './viewers';
import type { FileItem } from './FileGrid';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withToken(url: string): string {
  if (typeof window === 'undefined') return url;
  const token = localStorage.getItem('access_token') ?? '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PreviewData {
  id: number;
  name: string;
  file_path: string;
  file_extension: string | null;
  file_size: number;
  mime_type: string | null;
  preview_type: string;
  download_url: string;
  is_cached: boolean;
  remote_modified_at: string | null;
  preview_data?: {
    headers: string[];
    rows: string[][];
    total_rows: number;
    truncated: boolean;
    sheet_names?: string[];
    error?: string;
  };
  conversion_status?: string;
  converted_url?: string;
}

interface PreviewPanelProps {
  file: FileItem | null;
  previewData: PreviewData | null;
  isLoading: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PreviewPanel({ file, previewData, isLoading, onClose }: PreviewPanelProps) {
  if (!file) return null;

  const downloadUrl = previewData?.download_url
    ? `/api/v1${previewData.download_url}`
    : `/api/v1/file-browser/files/${file.id}/download`;

  return (
    <div className="w-full h-full flex flex-col border-l border-slate-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-medium text-slate-700 truncate flex-1 mr-2">
          {file.name}
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Preview Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mb-2" />
            <p className="text-sm">Đang tải xem trước...</p>
          </div>
        ) : previewData ? (
          <PreviewContent data={previewData} downloadUrl={downloadUrl} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <FileText className="w-8 h-8 mb-2" />
            <p className="text-sm">Không có dữ liệu xem trước</p>
          </div>
        )}
      </div>

      {/* Footer: metadata + actions */}
      <div className="border-t border-slate-100 px-4 py-3 space-y-2">
        {/* File info */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>Kích thước:</span>
          <span className="text-slate-700">{formatFileSize(file.file_size)}</span>
          <span>Loại:</span>
          <span className="text-slate-700 uppercase">
            {(file.file_extension || '').replace('.', '') || '—'}
          </span>
          <span>Ngày sửa:</span>
          <span className="text-slate-700">{formatDate(file.remote_modified_at)}</span>
          <span>Cache:</span>
          <span className={file.is_cached ? 'text-green-600' : 'text-slate-400'}>
            {file.is_cached ? 'Đã lưu' : 'Chưa tải'}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <a
            href={withToken(downloadUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2
                       text-sm font-medium text-white bg-blue-600 rounded-lg
                       hover:bg-blue-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            Tải về
          </a>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview Content (based on type)
// ---------------------------------------------------------------------------

function PreviewContent({ data, downloadUrl }: { data: PreviewData; downloadUrl: string }) {
  const type = data.preview_type;

  // PDF
  if (type === 'pdf') {
    return (
      <iframe
        src={`${withToken(downloadUrl)}#toolbar=1`}
        className="w-full h-full min-h-[400px] rounded-lg border border-slate-200"
        title={data.name}
      />
    );
  }

  // Image
  if (type === 'image') {
    return (
      <div className="flex items-center justify-center bg-slate-50 rounded-lg p-2">
        <img
          src={withToken(downloadUrl)}
          alt={data.name}
          className="max-w-full max-h-[500px] object-contain rounded"
        />
      </div>
    );
  }

  // Excel
  if (type === 'excel' && data.preview_data) {
    return <ExcelPreview data={data.preview_data} />;
  }

  // CAD 3D (placeholder for Phase 5)
  if (type === 'cad3d') {
    if (data.conversion_status === 'pending') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin mb-2" />
          <p className="text-sm">Đang chuyển đổi file CAD...</p>
          <p className="text-xs mt-1">Vui lòng tải về để xem.</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <FileText className="w-8 h-8 mb-2" />
        <p className="text-sm">Xem trước 3D sẽ có trong bản cập nhật tiếp theo.</p>
        <p className="text-xs mt-1">Nhấn "Tải về" để xem file.</p>
      </div>
    );
  }

  // CAD 2D (placeholder for Phase 7)
  if (type === 'cad2d') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <FileText className="w-8 h-8 mb-2" />
        <p className="text-sm">Xem trước DWG sẽ có trong bản cập nhật tiếp theo.</p>
        <p className="text-xs mt-1">Nhấn "Tải về" để xem file.</p>
      </div>
    );
  }

  // ZIP (placeholder for Phase 4)
  if (type === 'zip') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <FileText className="w-8 h-8 mb-2" />
        <p className="text-sm">Xem trước ZIP sẽ có trong bản cập nhật tiếp theo.</p>
        <p className="text-xs mt-1">Nhấn "Tải về" để xem file.</p>
      </div>
    );
  }

  // Unsupported
  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-400">
      <FileText className="w-8 h-8 mb-2" />
      <p className="text-sm">Không hỗ trợ xem trước loại file này.</p>
      <p className="text-xs mt-1">Nhấn "Tải về" để mở file.</p>
    </div>
  );
}
