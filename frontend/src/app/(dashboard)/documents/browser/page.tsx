'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  HardDrive, ChevronLeft, ChevronRight, FolderOpen, FileText,
  Search, RefreshCw, Loader2, Download, Eye, ArrowUpDown,
  LayoutGrid, LayoutList, ChevronDown, Image, FileSpreadsheet,
  Archive, Box, PenTool, X, FolderPlus, GripVertical, Move,
  Upload, FileUp, Pencil, Check, Trash2, AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { withToken, formatFileSize } from '@/lib/utils';
import { SyncFreshnessChip } from '@/components/shared/sync-freshness-chip';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────

interface BreadcrumbItem {
  name: string;
  path: string;
}

interface FolderItem {
  name: string;
  path: string;
  type: 'folder';
  children_count: number;
}

interface FileItem {
  name: string;
  path: string;
  type: 'file';
  extension: string;
  category: string;
  icon: string;
  size: number;
  modified: string | null;
}

interface FolderResponse {
  data: {
    path: string;
    breadcrumb: BreadcrumbItem[];
    folders: FolderItem[];
    files: FileItem[];
    total_folders: number;
    total_files: number;
  };
}

interface PreviewData {
  file_path: string;
  file_name: string;
  size: number;
  extension: string;
  category: string;
  preview_type: string;
  download_url: string;
  // Excel
  sheets?: string[];
  active_sheet?: string;
  total_rows?: number;
  headers?: string[];
  rows?: string[][];
  // Word
  text_content?: string;
  // ZIP
  entries?: Array<{ name: string; size: number; is_dir: boolean }>;
  error?: string;
}

// ─── Icon helper ─────────────────────────────────────────────

function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const c = className || 'w-4 h-4';
  switch (category) {
    case 'excel': return <FileSpreadsheet className={`${c} text-green-600`} />;
    case 'pdf': return <FileText className={`${c} text-red-600`} />;
    case 'image': return <Image className={`${c} text-slate-500`} />;
    case 'word': return <FileText className={`${c} text-blue-600`} />;
    case 'cad_3d': return <Box className={`${c} text-orange-600`} />;
    case 'cad_2d': return <PenTool className={`${c} text-teal-600`} />;
    case 'archive': return <Archive className={`${c} text-amber-600`} />;
    default: return <FileText className={`${c} text-slate-400`} />;
  }
}

// ─── Main Page ───────────────────────────────────────────────

export default function FileBrowserPage() {
  const searchParams = useSearchParams();
  // Initial path: from `?path=` query param (deep link from other pages),
  // else default 'Puplic'.
  const initialPath = searchParams?.get('path') || 'Puplic';
  const [currentPath, setCurrentPath] = useState(initialPath);

  // Re-sync when URL ?path= changes (back/forward nav, link click)
  useEffect(() => {
    const p = searchParams?.get('path');
    if (p && p !== currentPath) setCurrentPath(p);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [previewSheet, setPreviewSheet] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState('name');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  // Upload handler — accepts FileList from <input> or drop event.
  // Uses api.upload() so 401 → token refresh works (previously used raw
  // fetch + manual Authorization header, which silently failed on expired
  // tokens). Reports per-file outcomes via toast instead of window.alert.
  const MAX_PER_FILE_MB = 100;
  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (uploading) return;

    // Pre-flight: size check (cheaper than uploading then failing on server)
    const oversized: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > MAX_PER_FILE_MB * 1024 * 1024) {
        oversized.push(`${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`);
      }
    }
    if (oversized.length > 0) {
      toast.error(
        `File quá lớn (>${MAX_PER_FILE_MB} MB): ${oversized.join(', ')}`,
        { duration: 6000 },
      );
      if (uploadInputRef.current) uploadInputRef.current.value = '';
      return;
    }

    setUploading(true);
    const totalSizeMb = Array.from(files).reduce((s, f) => s + f.size, 0) / 1024 / 1024;
    setUploadProgress(
      `Đang upload ${files.length} file (${totalSizeMb.toFixed(1)} MB)...`,
    );
    try {
      const form = new FormData();
      form.append('parent_path', currentPath);
      form.append('overwrite', 'false');
      for (let i = 0; i < files.length; i++) form.append('files', files[i]);

      const json = await api.upload<{
        data: {
          total_uploaded: number;
          total_failed: number;
          failed: Array<{ name: string; error: string }>;
        };
      }>('/api/v1/file-browser/file/upload', form);

      const uploaded = json?.data?.total_uploaded ?? 0;
      const failed = json?.data?.total_failed ?? 0;
      const failures = json?.data?.failed ?? [];

      if (uploaded > 0 && failed === 0) {
        toast.success(`✓ Upload ${uploaded} file thành công`);
      } else if (uploaded > 0 && failed > 0) {
        toast.warning(
          `Upload ${uploaded} OK, ${failed} lỗi: ${failures.map(f => f.name).join(', ')}`,
          { duration: 8000 },
        );
      } else if (failed > 0) {
        toast.error(
          `Tất cả ${failed} file lỗi: ${failures.map(f => `${f.name} (${f.error})`).join('; ')}`,
          { duration: 10000 },
        );
      }

      setUploadProgress(`✓ ${uploaded} OK${failed > 0 ? `, ${failed} lỗi` : ''}`);
      await refetch();
      setTimeout(() => setUploadProgress(''), 3000);
    } catch (err: any) {
      const msg = err?.detail ?? err?.message ?? 'Lỗi không xác định';
      setUploadProgress(`✗ ${msg}`);
      toast.error(`Upload thất bại: ${msg}`, { duration: 8000 });
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
    // refetch is intentionally not in deps — it's declared later in this
    // component (TDZ at this point); the queryKey-keyed instance is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, uploading]);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  // Rename state (Thang 2026-05-15): path đang được đổi tên + tên đang gõ
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  // Delete state (Thang 2026-05-22): folder/file đang chờ confirm xóa
  const [deleteTarget, setDeleteTarget] = useState<
    { path: string; name: string; type: 'folder' | 'file'; itemCount?: number } | null
  >(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const startRename = (path: string, currentName: string) => {
    setRenamingPath(path);
    setRenameInput(currentName);
  };
  const cancelRename = () => {
    setRenamingPath(null);
    setRenameInput('');
  };
  const submitRename = async () => {
    if (!renamingPath) return;
    const trimmed = renameInput.trim();
    if (!trimmed) {
      toast.error('Tên không được rỗng');
      return;
    }
    const origName = renamingPath.split('/').pop() || '';
    if (trimmed === origName) {
      cancelRename();
      return;
    }
    setRenameBusy(true);
    try {
      const res = await api.post<{ data: any; message: string }>('/api/v1/file-browser/file/rename', {
        path: renamingPath,
        new_name: trimmed,
      });
      toast.success(res.message ?? 'Đã đổi tên');
      cancelRename();
      await refetch();
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? 'Đổi tên thất bại');
    } finally {
      setRenameBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      // recursive=true cho phép backend soft-delete (rename → .trash_<ts>) khi
      // folder có file. File đơn lẻ thì recursive bỏ qua, backend unlink trực tiếp.
      const url = `/api/v1/file-browser/file/delete?path=${encodeURIComponent(deleteTarget.path)}&recursive=true`;
      const res = await api.delete<{ message: string; trash_name?: string }>(url);
      toast.success(
        res.trash_name
          ? `${res.message}. Khôi phục: mv \"${res.trash_name}\" \"${deleteTarget.name}\" qua shell.`
          : res.message,
      );
      setDeleteTarget(null);
      await refetch();
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? 'Xóa thất bại');
    } finally {
      setDeleteBusy(false);
    }
  };

  const isSearchMode = searchQuery.length >= 2;

  // ── Folder data ─────────────────────────────────────────
  const { data: folderData, isLoading, refetch } = useQuery<FolderResponse>({
    queryKey: ['file-browser-folder', currentPath, sortBy],
    queryFn: () => api.get(`/api/v1/file-browser/folder?path=${encodeURIComponent(currentPath)}&sort_by=${sortBy}`),
    enabled: !isSearchMode,
    staleTime: 30_000,
  });

  // ── Search data ─────────────────────────────────────────
  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['file-browser-search', searchQuery, currentPath],
    queryFn: () => api.get(`/api/v1/file-browser/search?q=${encodeURIComponent(searchQuery)}&path=${encodeURIComponent(currentPath)}&limit=100`),
    enabled: isSearchMode,
    staleTime: 10_000,
  });

  // ── Preview data ────────────────────────────────────────
  const { data: previewData, isLoading: previewLoading } = useQuery<{ data: PreviewData }>({
    queryKey: ['file-browser-preview', selectedFile?.path, previewSheet],
    queryFn: () => {
      const params = new URLSearchParams({ path: selectedFile!.path });
      if (previewSheet) params.set('sheet', previewSheet);
      return api.get(`/api/v1/file-browser/file/preview?${params}`);
    },
    enabled: !!selectedFile,
    staleTime: 60_000,
  });

  // ── Handlers ────────────────────────────────────────────

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedFile(null);
    setSearchQuery('');
    setSearchInput('');
    setPreviewSheet(null);
  }, []);

  const handleSearch = () => {
    setSearchQuery(searchInput);
    setSelectedFile(null);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await api.post('/api/v1/file-browser/folder/create', {
        parent_path: currentPath, name: newFolderName.trim(),
      });
      setNewFolderName('');
      setShowNewFolder(false);
      refetch();
    } catch (err: any) {
      alert(err?.detail || 'Lỗi tạo thư mục');
    }
  };

  const handleDrop = async (targetFolderPath: string) => {
    if (!dragItem || dragItem === targetFolderPath) return;
    try {
      await api.post('/api/v1/file-browser/file/move', {
        source: dragItem, destination: targetFolderPath,
      });
      setDragItem(null);
      setDragOverFolder(null);
      refetch();
    } catch (err: any) {
      alert(err?.detail || 'Lỗi di chuyển');
      setDragItem(null);
      setDragOverFolder(null);
    }
  };

  const folders = folderData?.data?.folders ?? [];
  const files = folderData?.data?.files ?? [];
  const breadcrumb = folderData?.data?.breadcrumb ?? [{ name: 'OneDrive', path: '' }];
  const searchResults = (searchData as any)?.data ?? [];
  const preview = previewData?.data;

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-white space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <HardDrive className="w-5 h-5 text-brand-600" />
            <h1 className="text-lg font-semibold text-slate-800">Duyệt file OneDrive</h1>
            <SyncFreshnessChip module="documents" showSyncButton />
          </div>
          <div className="flex items-center gap-2">
            {/* Upload button — accepts PDF/xlsx/docx/images etc. */}
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              accept=".pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg,.gif,.txt,.csv,.zip,.7z,.dwg,.dxf,.step,.stp,.x_t,.igs,.iges"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <button
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              title="Upload file vào thư mục hiện tại"
            >
              {uploading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Upload className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{uploading ? 'Đang upload...' : 'Upload'}</span>
            </button>
            <button onClick={() => setShowNewFolder(!showNewFolder)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium hover:bg-slate-50"
              title="Tạo thư mục mới">
              <FolderPlus className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden sm:inline">Tạo thư mục</span>
            </button>
            <button onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
              className="p-1.5 rounded border border-slate-200 hover:bg-slate-50">
              {viewMode === 'list' ? <LayoutGrid className="w-4 h-4" /> : <LayoutList className="w-4 h-4" />}
            </button>
            <button onClick={() => refetch()} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs overflow-x-auto">
          {breadcrumb.map((b, i) => (
            <div key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight className="w-3 h-3 text-slate-400" />}
              <button onClick={() => navigateTo(b.path)}
                className={`px-1.5 py-0.5 rounded hover:bg-slate-100 ${i === breadcrumb.length - 1 ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
                {b.name}
              </button>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input type="text" placeholder="Tìm file..." value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg" />
          </div>
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchInput(''); }}
              className="text-xs text-slate-500 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Upload status */}
      {uploadProgress && (
        <div className="px-4 py-1.5 border-b border-slate-200 bg-emerald-50 text-xs text-emerald-800 flex items-center gap-2">
          <FileUp className="w-3.5 h-3.5" />
          {uploadProgress}
        </div>
      )}

      {/* New folder form */}
      {showNewFolder && (
        <div className="px-4 py-2 border-b border-slate-200 bg-amber-50 flex items-center gap-2">
          <FolderPlus className="w-4 h-4 text-amber-600 shrink-0" />
          <input type="text" placeholder="Tên thư mục mới..." value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
            autoFocus
            className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded" />
          <button onClick={handleCreateFolder}
            className="px-3 py-1 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700">Tạo</button>
          <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
            className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700">Hủy</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File list */}
        <div className="flex-1 overflow-auto">
          {isLoading || searchLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : isSearchMode ? (
            /* Search results */
            <div className="divide-y divide-slate-100">
              <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50">
                {searchResults.length} kết quả cho "{searchQuery}"
              </div>
              {searchResults.map((f: any, i: number) => (
                <button key={i} onClick={() => setSelectedFile(f)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-brand-50 transition-colors ${selectedFile?.path === f.path ? 'bg-brand-50' : ''}`}>
                  <CategoryIcon category={f.category} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-800 truncate">{f.name}</div>
                    <div className="text-[11px] text-slate-400 truncate">{f.parent_path}</div>
                  </div>
                  <span className="text-[11px] text-slate-400 shrink-0">{formatFileSize(f.size)}</span>
                </button>
              ))}
            </div>
          ) : (
            /* Folder contents */
            <div className="divide-y divide-slate-100">
              {/* Folders */}
              {folders.map((f) => {
                const isRenaming = renamingPath === f.path;
                return (
                  <div key={f.path}
                    onDragOver={e => { if (!isRenaming) { e.preventDefault(); setDragOverFolder(f.path); } }}
                    onDragLeave={() => setDragOverFolder(null)}
                    onDrop={e => { if (!isRenaming) { e.preventDefault(); handleDrop(f.path); } }}
                    className={`group w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      dragOverFolder === f.path ? 'bg-brand-100 ring-2 ring-brand-400' : isRenaming ? 'bg-brand-50' : 'hover:bg-amber-50'
                    }`}>
                    <FolderOpen className="w-5 h-5 text-amber-500 shrink-0" />
                    {isRenaming ? (
                      <>
                        <input
                          type="text"
                          autoFocus
                          value={renameInput}
                          disabled={renameBusy}
                          onChange={e => setRenameInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') submitRename();
                            if (e.key === 'Escape') cancelRename();
                          }}
                          className="flex-1 text-xs font-medium border border-brand-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-brand-100"
                        />
                        <button onClick={submitRename} disabled={renameBusy}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-brand-600 text-white text-[11px] font-medium hover:bg-brand-700 disabled:opacity-50">
                          {renameBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Lưu
                        </button>
                        <button onClick={cancelRename} disabled={renameBusy}
                          className="inline-flex items-center px-2 py-1 rounded bg-slate-200 text-slate-700 text-[11px] hover:bg-slate-300">
                          Huỷ
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => navigateTo(f.path)}
                          className="text-xs font-medium text-slate-800 flex-1 truncate text-left hover:text-amber-700"
                          title={f.name}>
                          {f.name}
                        </button>
                        <span className="text-[11px] text-slate-400 shrink-0">{f.children_count} mục</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); startRename(f.path, f.name); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-amber-100 text-slate-500 hover:text-amber-700"
                          title="Đổi tên folder">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({
                              path: f.path, name: f.name, type: 'folder',
                              itemCount: f.children_count,
                            });
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-100 text-slate-500 hover:text-red-600"
                          title="Xóa folder (chuyển vào thùng rác)">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      </>
                    )}
                  </div>
                );
              })}

              {/* Files */}
              {files.map((f) => {
                const isRenaming = renamingPath === f.path;
                return (
                  <div key={f.path}
                    draggable={!isRenaming}
                    onDragStart={() => !isRenaming && setDragItem(f.path)}
                    onDragEnd={() => { setDragItem(null); setDragOverFolder(null); }}
                    onClick={() => { if (!isRenaming) { setSelectedFile(f); setPreviewSheet(null); } }}
                    className={`group w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                      isRenaming ? 'bg-brand-50 cursor-default' : 'cursor-pointer hover:bg-brand-50'
                    } ${
                      selectedFile?.path === f.path && !isRenaming ? 'bg-brand-100/50' : ''
                    } ${dragItem === f.path ? 'opacity-50' : ''}`}>
                    <GripVertical className={`w-3 h-3 text-slate-300 shrink-0 ${isRenaming ? '' : 'cursor-grab'}`} />
                    <CategoryIcon category={f.category} />
                    {isRenaming ? (
                      <>
                        <input
                          type="text"
                          autoFocus
                          value={renameInput}
                          disabled={renameBusy}
                          onChange={e => setRenameInput(e.target.value)}
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => {
                            if (e.key === 'Enter') submitRename();
                            if (e.key === 'Escape') cancelRename();
                          }}
                          className="flex-1 text-xs border border-brand-300 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-brand-100"
                        />
                        <button onClick={(e) => { e.stopPropagation(); submitRename(); }} disabled={renameBusy}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-brand-600 text-white text-[11px] font-medium hover:bg-brand-700 disabled:opacity-50">
                          {renameBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Lưu
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); cancelRename(); }} disabled={renameBusy}
                          className="inline-flex items-center px-2 py-1 rounded bg-slate-200 text-slate-700 text-[11px] hover:bg-slate-300">
                          Huỷ
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-slate-800 flex-1 truncate">{f.name}</span>
                        <span className="text-[11px] text-slate-400 shrink-0">{formatFileSize(f.size)}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); startRename(f.path, f.name); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-brand-100 text-slate-500 hover:text-brand-700"
                          title="Đổi tên file">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({ path: f.path, name: f.name, type: 'file' });
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-100 text-slate-500 hover:text-red-600"
                          title="Xóa file">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}

              {folders.length === 0 && files.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <FolderOpen className="w-10 h-10 mb-2" />
                  <p className="text-sm">Thư mục trống</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preview panel */}
        {selectedFile && (
          <div className="w-[450px] shrink-0 border-l border-slate-200 bg-white overflow-auto">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-800 truncate">{selectedFile.name}</div>
                <div className="text-[11px] text-slate-400">{formatFileSize(selectedFile.size)} · .{selectedFile.extension}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {(selectedFile.extension === 'xlsx' || selectedFile.extension === 'xls' ||
                  selectedFile.extension === 'docx' || selectedFile.extension === 'doc') && (
                  <a
                    href={`/documents/edit?path=${encodeURIComponent(
                      `/data/onedrive-staging/${selectedFile.path}`
                    )}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                    title="Mở chỉnh sửa trong OnlyOffice (xuất PDF tự động khi lưu)"
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    Sửa
                  </a>
                )}
                <a href={withToken(`/api/v1/file-browser/file/download?path=${encodeURIComponent(selectedFile.path)}&dl=1`)}
                  download={selectedFile.name}
                  className="p-1.5 rounded hover:bg-slate-100" title="Tải về">
                  <Download className="w-4 h-4 text-slate-600" />
                </a>
                <button onClick={() => setSelectedFile(null)} className="p-1.5 rounded hover:bg-slate-100">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            </div>

            <div className="p-3">
              {previewLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              ) : preview ? (
                <>
                  {/* PDF */}
                  {preview.preview_type === 'pdf' && (
                    <iframe
                      src={`${withToken(preview.download_url)}#toolbar=1`}
                      className="w-full rounded-lg border border-slate-200"
                      style={{ height: '600px' }}
                      title="PDF"
                    />
                  )}

                  {/* Image */}
                  {preview.preview_type === 'image' && (
                    <img src={withToken(preview.download_url)} alt={preview.file_name}
                      className="max-w-full rounded-lg border border-slate-200" />
                  )}

                  {/* Excel */}
                  {preview.preview_type === 'excel' && (
                    <div className="space-y-2">
                      {/* Sheet tabs */}
                      {preview.sheets && preview.sheets.length > 1 && (
                        <div className="flex gap-1 overflow-x-auto pb-1">
                          {preview.sheets.map(s => (
                            <button key={s} onClick={() => setPreviewSheet(s)}
                              className={`px-2 py-1 text-[11px] rounded shrink-0 ${(previewSheet || preview.active_sheet) === s ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="text-[11px] text-slate-400">{preview.total_rows} dòng</div>
                      <div className="overflow-auto max-h-[500px] rounded border border-slate-200">
                        <table className="w-full text-[11px]">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr>
                              {preview.headers?.map((h, i) => (
                                <th key={i} className="px-1.5 py-1 text-left font-medium text-slate-500 border-b whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {preview.rows?.slice(0, 100).map((row, ri) => (
                              <tr key={ri} className="hover:bg-slate-50">
                                {row.map((cell, ci) => (
                                  <td key={ci} className="px-1.5 py-0.5 text-slate-700 whitespace-nowrap max-w-[200px] truncate">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Word */}
                  {preview.preview_type === 'word' && (
                    <div className="bg-white border border-slate-200 rounded-lg p-3 max-h-[500px] overflow-auto">
                      <p className="text-xs text-slate-700 whitespace-pre-wrap">{preview.text_content || 'Không có nội dung'}</p>
                    </div>
                  )}

                  {/* ZIP */}
                  {preview.preview_type === 'zip' && (
                    <div className="space-y-1">
                      <div className="text-[11px] text-slate-400">{preview.entries?.length} files trong archive</div>
                      <div className="max-h-[400px] overflow-auto rounded border border-slate-200 divide-y divide-slate-100">
                        {preview.entries?.filter(e => !e.is_dir).map((e, i) => (
                          <div key={i} className="px-2 py-1 flex items-center justify-between text-[11px]">
                            <span className="text-slate-700 truncate flex-1">{e.name}</span>
                            <span className="text-slate-400 shrink-0 ml-2">{formatFileSize(e.size)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CAD 3D */}
                  {preview.preview_type === 'cad_3d' && (
                    <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 text-center">
                      <Box className="w-8 h-8 text-orange-500 mx-auto mb-2" />
                      <p className="text-xs text-slate-600 mb-2">File 3D CAD (.{preview.extension})</p>
                      <a href={withToken(preview.download_url + '&dl=1')} download={preview.file_name} rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs hover:bg-orange-700">
                        <Download className="w-3 h-3" /> Tải về
                      </a>
                    </div>
                  )}

                  {/* Unsupported */}
                  {(preview.preview_type === 'unsupported' || preview.preview_type === 'cad_2d') && (
                    <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 text-center">
                      <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                      <p className="text-xs text-slate-500 mb-2">Không hỗ trợ xem trước .{preview.extension}</p>
                      <a href={withToken(preview.download_url + '&dl=1')} download={preview.file_name} rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs hover:bg-brand-700">
                        <Download className="w-3 h-3" /> Tải về
                      </a>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation modal (Thang 2026-05-22) */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !deleteBusy && setDeleteTarget(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 p-2 rounded-full bg-red-100">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">
                  Xóa {deleteTarget.type === 'folder' ? 'thư mục' : 'file'}?
                </h3>
                <p className="text-xs text-slate-500 mt-1 break-words">
                  <span className="font-medium text-slate-700">{deleteTarget.name}</span>
                  {deleteTarget.type === 'folder' && deleteTarget.itemCount !== undefined && (
                    <> ({deleteTarget.itemCount} mục bên trong)</>
                  )}
                </p>
              </div>
            </div>
            {deleteTarget.type === 'folder' && (deleteTarget.itemCount ?? 0) > 0 ? (
              <div className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <span className="font-medium text-amber-800">Soft-delete:</span> thư mục
                sẽ được đổi tên thành <code className="text-[11px] bg-white px-1 py-0.5 rounded border border-amber-300">.trash_&lt;ts&gt;_{deleteTarget.name}</code>{' '}
                trong cùng thư mục cha. Có thể khôi phục bằng shell <code className="text-[11px] bg-white px-1 py-0.5 rounded border border-amber-300">mv</code>.
              </div>
            ) : (
              <div className="text-xs text-slate-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <span className="font-medium text-red-800">Xóa vĩnh viễn:</span>{' '}
                {deleteTarget.type === 'folder' ? 'thư mục rỗng' : 'file'} này sẽ được xóa hẳn khỏi đĩa.
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteBusy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteBusy}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
