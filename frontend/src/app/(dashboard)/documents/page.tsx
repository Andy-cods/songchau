'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderOpen,
  Upload,
  Download,
  Trash2,
  Loader2,
  FileText,
  X,
  Plus,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface Document {
  id: number;
  title: string;
  file_name: string;
  file_size: number;
  category: string;
  uploaded_by_name: string;
  created_at: string;
}

interface DocumentsResponse {
  data: {
    items: Document[];
    total: number;
  };
}

interface UploadResponse {
  data: { id: number; title: string; file_path: string };
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const CATEGORIES = [
  { value: '', label: 'Tất cả' },
  { value: 'contract', label: 'Hợp đồng' },
  { value: 'invoice', label: 'Hóa đơn' },
  { value: 'po', label: 'PO' },
  { value: 'rfq', label: 'RFQ' },
  { value: 'report', label: 'Báo cáo' },
  { value: 'sop', label: 'SOP' },
  { value: 'other', label: 'Khác' },
];

const CATEGORY_LABELS: Record<string, string> = {
  contract: 'Hợp đồng',
  invoice: 'Hóa đơn',
  po: 'PO',
  rfq: 'RFQ',
  report: 'Báo cáo',
  sop: 'SOP',
  other: 'Khác',
};

const CATEGORY_COLORS: Record<string, string> = {
  contract: 'bg-blue-100 text-blue-700 border-blue-200',
  invoice: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  po: 'bg-purple-100 text-purple-700 border-purple-200',
  rfq: 'bg-amber-100 text-amber-700 border-amber-200',
  report: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  sop: 'bg-rose-100 text-rose-700 border-rose-200',
  other: 'bg-slate-100 text-slate-600 border-slate-200',
};

// ─── Upload Modal ─────────────────────────────────────────────────

interface UploadModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function UploadModal({ onClose, onSuccess }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) =>
      api.upload<UploadResponse>('/api/v1/documents/upload', formData),
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title.trim());
    formData.append('category', category);
    if (description.trim()) formData.append('description', description.trim());
    uploadMutation.mutate(formData);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-slate-100 w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-brand-600" />
            <h3 className="text-sm font-semibold text-slate-800">Upload tài liệu</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* File Input */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              File <span className="text-red-500">*</span>
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-lg p-4 cursor-pointer text-center transition-colors',
                file
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/30'
              )}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-emerald-700">
                  <FileText className="h-4 w-4" />
                  <span className="text-sm font-medium truncate max-w-xs">{file.name}</span>
                  <span className="text-xs text-emerald-500">({formatFileSize(file.size)})</span>
                </div>
              ) : (
                <div className="text-slate-400">
                  <Upload className="h-6 w-6 mx-auto mb-1" />
                  <p className="text-xs">Nhấp để chọn file</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ''));
                }
              }}
            />
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Tiêu đề <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tiêu đề tài liệu"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
              required
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Danh mục</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 bg-white"
            >
              {CATEGORIES.filter((c) => c.value).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Mô tả</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả ngắn về tài liệu (tùy chọn)"
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 resize-none"
            />
          </div>

          {uploadMutation.isError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2">
              {(uploadMutation.error as { detail?: string })?.detail ?? 'Upload thất bại. Thử lại.'}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={uploadMutation.isPending || !file || !title.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition-colors"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState('');
  const [page, setPage] = useState(1);
  const [showUpload, setShowUpload] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const queryKey = ['documents', activeCategory, page];

  const { data: raw, isLoading } = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (activeCategory) params.set('category', activeCategory);
      return api.get<DocumentsResponse>(`/api/v1/documents?${params}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/documents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setDeletingId(null);
    },
    onError: () => {
      setDeletingId(null);
    },
  });

  const items: Document[] = raw?.data?.items ?? (raw as any)?.items ?? [];
  const total: number = raw?.data?.total ?? (raw as any)?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  function handleDownload(id: number) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    const base = process.env.NEXT_PUBLIC_API_URL || '';
    const url = `${base}/api/v1/documents/${id}/download`;
    const a = document.createElement('a');
    a.href = token ? `${url}?token=${token}` : url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }

  function handleCategoryChange(val: string) {
    setActiveCategory(val);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['documents'] })}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Quản lý tài liệu</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Lưu trữ hợp đồng, hóa đơn, PO và các tài liệu nội bộ
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Upload tài liệu
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => handleCategoryChange(cat.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
              activeCategory === cat.value
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300 hover:text-brand-600'
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <FolderOpen className="h-4 w-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-slate-700">Danh sách tài liệu</h3>
          <span className="ml-auto text-xs text-slate-400 font-mono">
            {total} tài liệu
          </span>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Tiêu đề
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  File
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Kích thước
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Danh mục
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Người upload
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Ngày upload
                </th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-slate-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                : items.length === 0
                  ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                        Chưa có tài liệu nào
                      </td>
                    </tr>
                  )
                  : items.map((doc) => (
                      <tr key={doc.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-800">{doc.title}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-slate-500 truncate max-w-[180px] block">
                            {doc.file_name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-500">
                          {formatFileSize(doc.file_size)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                              CATEGORY_COLORS[doc.category] ?? CATEGORY_COLORS.other
                            )}
                          >
                            {CATEGORY_LABELS[doc.category] ?? doc.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{doc.uploaded_by_name}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(doc.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            {/* Download */}
                            <button
                              onClick={() => handleDownload(doc.id)}
                              title="Tải xuống"
                              className="p-1.5 rounded hover:bg-blue-50 text-blue-600 hover:text-blue-700 transition-colors"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            {/* Delete */}
                            <button
                              onClick={() => {
                                if (confirm(`Xóa tài liệu "${doc.title}"?`)) {
                                  setDeletingId(doc.id);
                                  deleteMutation.mutate(doc.id);
                                }
                              }}
                              disabled={deletingId === doc.id && deleteMutation.isPending}
                              title="Xóa"
                              className="p-1.5 rounded hover:bg-red-50 text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                            >
                              {deletingId === doc.id && deleteMutation.isPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-400">
              Trang {page} / {totalPages} — {total} tài liệu
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                Trước
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                Sau
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
