'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HardDrive, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';

import BreadcrumbNav from '@/components/features/file-browser/BreadcrumbNav';
import FileToolbar from '@/components/features/file-browser/FileToolbar';
import FileGrid, { type FileItem } from '@/components/features/file-browser/FileGrid';
import PreviewPanel from '@/components/features/file-browser/PreviewPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FolderResponse {
  data: {
    items: FileItem[];
    total: number;
    breadcrumbs?: Array<{
      id: number | null;
      graph_item_id: string;
      name: string;
      is_folder: boolean;
    }>;
    page?: number;
    limit?: number;
  };
}

interface SearchResponse {
  data: {
    items: FileItem[];
    total: number;
    page: number;
    limit: number;
  };
}

interface PreviewResponse {
  data: {
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
    preview_data?: any;
    conversion_status?: string;
    converted_url?: string;
  };
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function FileBrowserPage() {
  // Navigation state
  const [parentId, setParentId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('name');
  const [order, setOrder] = useState('asc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const isSearchMode = searchQuery.trim().length > 0;

  // Preview state
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  // ── Data fetching: Folder contents ──────────────────────────────
  const {
    data: folderData,
    isLoading: isFolderLoading,
    refetch: refetchFolder,
  } = useQuery<FolderResponse>({
    queryKey: ['file-browser', 'files', parentId, page, sort, order],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '50',
        sort,
        order,
      });
      if (parentId) params.set('parent_id', parentId);
      return api.get(`/api/v1/file-browser/files?${params}`);
    },
    enabled: !isSearchMode,
  });

  // ── Data fetching: Breadcrumbs ──────────────────────────────────
  const { data: breadcrumbData } = useQuery<FolderResponse>({
    queryKey: ['file-browser', 'folders', parentId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (parentId) params.set('parent_id', parentId);
      return api.get(`/api/v1/file-browser/folders?${params}`);
    },
    enabled: !isSearchMode,
  });

  // ── Data fetching: Search ──────────────────────────────────────
  const {
    data: searchData,
    isLoading: isSearchLoading,
  } = useQuery<SearchResponse>({
    queryKey: ['file-browser', 'search', searchQuery, page],
    queryFn: () => {
      const params = new URLSearchParams({
        q: searchQuery.trim(),
        page: String(page),
        limit: '50',
      });
      return api.get(`/api/v1/file-browser/search?${params}`);
    },
    enabled: isSearchMode && searchQuery.trim().length >= 1,
  });

  // ── Data fetching: Preview ──────────────────────────────────────
  const {
    data: previewData,
    isLoading: isPreviewLoading,
  } = useQuery<PreviewResponse>({
    queryKey: ['file-browser', 'preview', selectedFile?.id],
    queryFn: () => api.get(`/api/v1/file-browser/files/${selectedFile!.id}/preview`),
    enabled: !!selectedFile && !selectedFile.is_folder,
  });

  // ── Handlers ────────────────────────────────────────────────────

  const handleNavigateFolder = useCallback((graphItemId: string) => {
    setParentId(graphItemId);
    setPage(1);
    setSelectedFile(null);
    setSearchQuery('');
  }, []);

  const handleBreadcrumbNavigate = useCallback((graphItemId: string | null) => {
    setParentId(graphItemId);
    setPage(1);
    setSelectedFile(null);
    setSearchQuery('');
  }, []);

  const handleSelectFile = useCallback((item: FileItem) => {
    if (item.is_folder) return;
    setSelectedFile(item);
    setShowPreview(true);
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setPage(1);
    setSelectedFile(null);
  }, []);

  const handleSortChange = useCallback((newSort: string, newOrder: string) => {
    setSort(newSort);
    setOrder(newOrder);
    setPage(1);
  }, []);

  // ── Derived data ────────────────────────────────────────────────

  const items = isSearchMode
    ? searchData?.data?.items || []
    : folderData?.data?.items || [];

  const total = isSearchMode
    ? searchData?.data?.total || 0
    : folderData?.data?.total || 0;

  const breadcrumbs = breadcrumbData?.data?.breadcrumbs || [
    { id: null, graph_item_id: 'root', name: 'Gốc', is_folder: true },
  ];

  const isLoading = isSearchMode ? isSearchLoading : isFolderLoading;
  const totalPages = Math.ceil(total / 50);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Page Header */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 mb-3">
          <HardDrive className="w-5 h-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-slate-800">Duyệt file OneDrive</h1>
          {total > 0 && (
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {total.toLocaleString('vi-VN')} mục
            </span>
          )}
        </div>

        {/* Breadcrumbs (hidden during search) */}
        {!isSearchMode && (
          <div className="mb-3">
            <BreadcrumbNav items={breadcrumbs} onNavigate={handleBreadcrumbNavigate} />
          </div>
        )}

        {/* Toolbar */}
        <FileToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sort={sort}
          order={order}
          onSortChange={handleSortChange}
          onSearch={handleSearch}
          onRefresh={() => refetchFolder()}
          isSearching={isSearchLoading}
          searchQuery={searchQuery}
        />
      </div>

      {/* Main Content: File Grid + Preview Panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Grid */}
        <div className="flex-1 overflow-auto p-4">
          <FileGrid
            items={items}
            viewMode={viewMode}
            selectedId={selectedFile?.id ?? null}
            onSelect={handleSelectFile}
            onNavigateFolder={handleNavigateFolder}
            isLoading={isLoading}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4 pb-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50
                           disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-slate-600">
                Trang {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50
                           disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Preview Panel */}
        {showPreview && selectedFile && !selectedFile.is_folder && (
          <div className="w-[380px] shrink-0 overflow-hidden">
            <PreviewPanel
              file={selectedFile}
              previewData={previewData?.data ?? null}
              isLoading={isPreviewLoading}
              onClose={() => {
                setSelectedFile(null);
                setShowPreview(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
