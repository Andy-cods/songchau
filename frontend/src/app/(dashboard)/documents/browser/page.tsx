'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HardDrive, ChevronLeft, ChevronRight, FolderOpen, FileText,
  Search, RefreshCw, Loader2, Download, Eye, ArrowUpDown,
  LayoutGrid, LayoutList, ChevronDown, Image, FileSpreadsheet,
  Archive, Box, PenTool, X, FolderPlus, GripVertical, Move,
} from 'lucide-react';
import { api } from '@/lib/api';
import { withToken, formatFileSize } from '@/lib/utils';

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
    case 'image': return <Image className={`${c} text-purple-600`} />;
    case 'word': return <FileText className={`${c} text-blue-600`} />;
    case 'cad_3d': return <Box className={`${c} text-orange-600`} />;
    case 'cad_2d': return <PenTool className={`${c} text-teal-600`} />;
    case 'archive': return <Archive className={`${c} text-amber-600`} />;
    default: return <FileText className={`${c} text-slate-400`} />;
  }
}

// ─── Main Page ───────────────────────────────────────────────

export default function FileBrowserPage() {
  const [currentPath, setCurrentPath] = useState('Puplic');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [previewSheet, setPreviewSheet] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState('name');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-semibold text-slate-800">Duyệt file OneDrive</h1>
          </div>
          <div className="flex items-center gap-2">
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
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-blue-50 transition-colors ${selectedFile?.path === f.path ? 'bg-blue-50' : ''}`}>
                  <CategoryIcon category={f.category} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-800 truncate">{f.name}</div>
                    <div className="text-[10px] text-slate-400 truncate">{f.parent_path}</div>
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0">{formatFileSize(f.size)}</span>
                </button>
              ))}
            </div>
          ) : (
            /* Folder contents */
            <div className="divide-y divide-slate-100">
              {/* Folders */}
              {folders.map((f) => (
                <button key={f.path}
                  onClick={() => navigateTo(f.path)}
                  onDragOver={e => { e.preventDefault(); setDragOverFolder(f.path); }}
                  onDragLeave={() => setDragOverFolder(null)}
                  onDrop={e => { e.preventDefault(); handleDrop(f.path); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    dragOverFolder === f.path ? 'bg-blue-100 ring-2 ring-blue-400' : 'hover:bg-amber-50'
                  }`}>
                  <FolderOpen className="w-5 h-5 text-amber-500 shrink-0" />
                  <span className="text-xs font-medium text-slate-800 flex-1 truncate">{f.name}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">{f.children_count} mục</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                </button>
              ))}

              {/* Files */}
              {files.map((f) => (
                <div key={f.path}
                  draggable
                  onDragStart={() => setDragItem(f.path)}
                  onDragEnd={() => { setDragItem(null); setDragOverFolder(null); }}
                  onClick={() => { setSelectedFile(f); setPreviewSheet(null); }}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left cursor-pointer hover:bg-blue-50 transition-colors ${
                    selectedFile?.path === f.path ? 'bg-blue-100/50' : ''
                  } ${dragItem === f.path ? 'opacity-50' : ''}`}>
                  <GripVertical className="w-3 h-3 text-slate-300 shrink-0 cursor-grab" />
                  <CategoryIcon category={f.category} />
                  <span className="text-xs text-slate-800 flex-1 truncate">{f.name}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">{formatFileSize(f.size)}</span>
                </div>
              ))}

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
                <div className="text-[10px] text-slate-400">{formatFileSize(selectedFile.size)} · .{selectedFile.extension}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a href={withToken(`/api/v1/file-browser/file/download?path=${encodeURIComponent(selectedFile.path)}`)}
                  target="_blank" rel="noopener noreferrer"
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
                              className={`px-2 py-1 text-[10px] rounded shrink-0 ${(previewSheet || preview.active_sheet) === s ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-400">{preview.total_rows} dòng</div>
                      <div className="overflow-auto max-h-[500px] rounded border border-slate-200">
                        <table className="w-full text-[10px]">
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
                      <div className="text-[10px] text-slate-400">{preview.entries?.length} files trong archive</div>
                      <div className="max-h-[400px] overflow-auto rounded border border-slate-200 divide-y divide-slate-100">
                        {preview.entries?.filter(e => !e.is_dir).map((e, i) => (
                          <div key={i} className="px-2 py-1 flex items-center justify-between text-[10px]">
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
                      <a href={withToken(preview.download_url)} target="_blank" rel="noopener noreferrer"
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
                      <a href={withToken(preview.download_url)} target="_blank" rel="noopener noreferrer"
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
    </div>
  );
}
