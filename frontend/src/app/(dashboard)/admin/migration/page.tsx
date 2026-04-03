'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Clock, PlayCircle, ShieldCheck, Database, ChevronDown, ChevronUp,
  FolderOpen, FolderClosed, FileSpreadsheet, ChevronRight, Search,
  Files, CloudOff, CloudCheck, FileClock, Eye, Download, SkipForward,
} from 'lucide-react';
import { api } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────

interface SyncStatusItem {
  sync_type: string;
  label: string;
  status: string;
  last_started: string | null;
  last_completed: string | null;
  rows_inserted: number | null;
  error_message: string | null;
}

interface SyncHistoryItem {
  id: number;
  sync_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  rows_inserted: number | null;
  rows_skipped: number | null;
  rows_updated: number | null;
  error_message: string | null;
  source_file: string | null;
}

interface ImportStatItem {
  table_name: string;
  row_count: number;
  exact: boolean;
}

interface DataQualityItem {
  id: number;
  table_name: string;
  check_name: string;
  check_type: string;
  status: string;
  affected_rows: number;
  details: any;
  created_at: string;
}

type SyncStatus = 'imported' | 'needs_update' | 'has_mapping' | 'no_mapping' | 'empty';

interface FileNode {
  name: string;
  path: string;
  type: 'file';
  extension: string;
  size_bytes: number;
  last_modified: string;
  sync_status: SyncStatus;
  target_table: string | null;
  db_row_count: number;
  last_imported_at: string | null;
}

interface FolderNode {
  name: string;
  path: string;
  type: 'folder';
  file_count: number;
  children: TreeNode[];
}

type TreeNode = FileNode | FolderNode;

interface FileTreeSummary {
  total_files: number;
  total_size_bytes: number;
  imported: number;
  needs_update: number;
  has_mapping: number;
  no_mapping: number;
  empty: number;
  error: number;
}

interface FileTreeResponse {
  data: {
    summary: FileTreeSummary;
    tree: TreeNode[];
  };
  message: string;
}

interface FilePreviewData {
  file_path: string;
  file_name: string;
  size_bytes: number;
  sheets: string[];
  active_sheet: string;
  total_rows: number;
  headers: string[];
  rows: string[][];
  target_table: string | null;
  target_table_count: number;
  recognized: boolean;
}

interface ImportResult {
  log_id: number;
  file_path: string;
  status: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  output: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Chưa đồng bộ';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s trước`;
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return `${Math.floor(diff / 86400)} ngày trước`;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status: string) {
  const s = status?.toLowerCase() || '';
  if (s === 'success') return 'bg-emerald-100 text-emerald-700';
  if (s === 'running') return 'bg-blue-100 text-blue-700';
  if (s === 'error' || s === 'failed') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-600';
}

function statusLabel(status: string) {
  const s = status?.toLowerCase() || '';
  if (s === 'success') return 'Thành công';
  if (s === 'running') return 'Đang chạy';
  if (s === 'error' || s === 'failed') return 'Thất bại';
  if (s === 'never_run') return 'Chưa chạy';
  return status;
}

function qualityBadge(status: string) {
  const s = status?.toLowerCase() || '';
  if (s === 'pass') return 'bg-emerald-100 text-emerald-700';
  if (s === 'warning') return 'bg-amber-100 text-amber-700';
  if (s === 'fail') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-600';
}

function qualityLabel(status: string) {
  const s = status?.toLowerCase() || '';
  if (s === 'pass') return 'Đạt';
  if (s === 'warning') return 'Cảnh báo';
  if (s === 'fail') return 'Không đạt';
  return status;
}

function syncStatusStyle(status: SyncStatus): { badge: string; dot: string; label: string } {
  switch (status) {
    case 'imported':
      return { badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', label: 'Đã import' };
    case 'needs_update':
      return { badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', label: 'Cần cập nhật' };
    case 'has_mapping':
      return { badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', label: 'Chưa import' };
    case 'no_mapping':
      return { badge: 'bg-slate-100 text-slate-400', dot: 'bg-slate-300', label: 'Không nhận dạng' };
    case 'empty':
      return { badge: 'bg-red-100 text-red-600', dot: 'bg-red-400', label: 'Rỗng' };
    case 'error':
      return { badge: 'bg-red-100 text-red-700', dot: 'bg-red-500', label: 'Lỗi' };
    default:
      return { badge: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400', label: status };
  }
}

// Filter tree nodes by search query (client-side)
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return nodes;
  const q = query.toLowerCase();
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.name.toLowerCase().includes(q)) result.push(node);
    } else {
      const filteredChildren = filterTree(node.children ?? [], q);
      if (filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    }
  }
  return result;
}

// Filter tree by sync_status tab
function filterTreeByStatus(nodes: TreeNode[], tab: string): TreeNode[] {
  if (tab === 'all') return nodes;
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.sync_status === tab) result.push(node);
    } else {
      const filteredChildren = filterTreeByStatus(node.children ?? [], tab);
      if (filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    }
  }
  return result;
}

// ─── FileTreeNode component ─────────────────────────────────────────────────

function FileTreeNode({
  node,
  depth,
  expandedPaths,
  onToggleFolder,
  selectedFile,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  onToggleFolder: (path: string) => void;
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
}) {
  const indent = depth * 16;

  if (node.type === 'folder') {
    const isOpen = expandedPaths.has(node.path);
    return (
      <div>
        <button
          onClick={() => onToggleFolder(node.path)}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 rounded text-left group"
          style={{ paddingLeft: `${indent + 12}px` }}
        >
          {isOpen
            ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />}
          {isOpen
            ? <FolderOpen className="h-4 w-4 text-amber-500 flex-shrink-0" />
            : <FolderClosed className="h-4 w-4 text-amber-400 flex-shrink-0" />}
          <span className="text-sm font-medium text-slate-700 truncate">{node.name}</span>
          <span className="ml-auto text-xs text-slate-400 flex-shrink-0">{node.file_count} files</span>
        </button>
        {isOpen && (
          <div>
            {(node.children ?? []).map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                onToggleFolder={onToggleFolder}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  const { badge, dot, label } = syncStatusStyle(node.sync_status);
  const isSelected = selectedFile === node.path;

  return (
    <div>
      <button
        onClick={() => onSelectFile(isSelected ? null : node.path)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-left group transition-colors ${
          isSelected ? 'bg-blue-50 border-l-2 border-blue-400' : 'hover:bg-slate-50'
        }`}
        style={{ paddingLeft: `${indent + 12}px` }}
      >
        <FileSpreadsheet className="h-4 w-4 text-green-600 flex-shrink-0" />
        <span className="text-sm text-slate-700 truncate flex-1">{node.name}</span>
        <span className="text-xs text-slate-400 flex-shrink-0 hidden group-hover:inline sm:inline">
          {humanSize(node.size_bytes)}
        </span>
        <span className="text-xs text-slate-400 flex-shrink-0 hidden lg:inline">
          {timeAgo(node.last_modified)}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 flex items-center gap-1 ${badge}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
          {label}
        </span>
      </button>

      {/* Inline detail panel */}
      {isSelected && (
        <div
          className="mx-3 mb-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-slate-600 grid grid-cols-2 gap-x-6 gap-y-1.5"
          style={{ marginLeft: `${indent + 28}px` }}
        >
          <div><span className="text-slate-400">Tên file:</span> <span className="font-medium">{node.name}</span></div>
          <div><span className="text-slate-400">Định dạng:</span> <span className="font-mono uppercase">{node.extension}</span></div>
          <div><span className="text-slate-400">Kích thước:</span> {humanSize(node.size_bytes)}</div>
          <div><span className="text-slate-400">Cập nhật lần cuối:</span> {node.last_modified ? new Date(node.last_modified).toLocaleString('vi-VN') : '—'}</div>
                <div><span className="text-slate-400">Bảng đích:</span> <span className="font-mono text-blue-600">{node.target_table || 'Không nhận dạng'}</span></div>
                <div><span className="text-slate-400">Rows trong DB:</span> <span className="font-semibold">{(node.db_row_count ?? 0).toLocaleString('vi-VN')}</span></div>
                {node.last_imported_at && <div><span className="text-slate-400">Import lần cuối:</span> {new Date(node.last_imported_at).toLocaleString('vi-VN')}</div>}
          <div><span className="text-slate-400">Đường dẫn:</span> <span className="font-mono text-slate-500 break-all">{node.path}</span></div>
          <div>
            <span className="text-slate-400">Trạng thái: </span>
            <span className={`px-1.5 py-0.5 rounded font-medium ${badge}`}>{label}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper: find a FileNode by path in tree ────────────────────────────────

function findFileNode(nodes: TreeNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === path) return node;
    if (node.type === 'folder') {
      const found = findFileNode(node.children ?? [], path);
      if (found) return found;
    }
  }
  return null;
}

// ─── OneDrive File Explorer ─────────────────────────────────────────────────

function OneDriveFileExplorer() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'imported' | 'needs_update' | 'has_mapping' | 'no_mapping'>('all');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Preview / Import / Skip state
  const [preview, setPreview] = useState<FilePreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [skipLoading, setSkipLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data: raw, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['migration-file-tree'],
    queryFn: () => api.get<FileTreeResponse>('/api/v1/data-migration/file-tree'),
    refetchInterval: 30_000,
  });

  const summary: FileTreeSummary = raw?.data?.summary ?? {
    total_files: 0, total_size_bytes: 0, imported: 0, needs_update: 0, has_mapping: 0, no_mapping: 0, empty: 0,
  };
  const rawTree: TreeNode[] = Array.isArray(raw?.data?.tree) ? raw.data.tree : [];

  // Apply tab filter then search filter
  const filteredTree = useMemo(() => {
    const byStatus = filterTreeByStatus(rawTree, activeTab);
    return filterTree(byStatus, search);
  }, [rawTree, activeTab, search]);

  // Resolve the full FileNode for the selected path
  const selectedFileNode = useMemo(
    () => (selectedFile ? findFileNode(rawTree, selectedFile) : null),
    [rawTree, selectedFile],
  );

  // Clear action state when file changes
  function handleSelectFile(path: string | null) {
    setSelectedFile(path);
    setPreview(null);
    setPreviewError(null);
    setImportResult(null);
    setActionMessage(null);
  }

  async function handlePreview() {
    if (!selectedFile) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const res = await api.get<{ data: FilePreviewData }>(
        `/api/v1/data-migration/file-preview?path=${encodeURIComponent(selectedFile)}`
      );
      setPreview(res?.data ?? null);
    } catch (err: any) {
      setPreviewError(err?.message ?? 'Không thể xem trước file');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleImport() {
    if (!selectedFile) return;
    setImportLoading(true);
    setActionMessage(null);
    setImportResult(null);
    try {
      const res = await api.post<{ data: ImportResult; message: string }>(
        '/api/v1/data-migration/file-import',
        { path: selectedFile }
      );
      setImportResult(res?.data ?? null);
      setActionMessage({ type: 'success', text: res?.message ?? 'Import hoàn tất' });
      queryClient.invalidateQueries({ queryKey: ['migration-file-tree'] });
      queryClient.invalidateQueries({ queryKey: ['migration-sync-history'] });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message ?? 'Import thất bại' });
    } finally {
      setImportLoading(false);
    }
  }

  async function handleSkip() {
    if (!selectedFile) return;
    setSkipLoading(true);
    setActionMessage(null);
    try {
      await api.post('/api/v1/data-migration/file-skip', {
        path: selectedFile,
        reason: 'Bỏ qua',
      });
      setActionMessage({ type: 'success', text: 'Đã đánh dấu bỏ qua file' });
      queryClient.invalidateQueries({ queryKey: ['migration-file-tree'] });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message ?? 'Không thể bỏ qua file' });
    } finally {
      setSkipLoading(false);
    }
  }

  function toggleFolder(path: string) {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function expandAll() {
    const allFolderPaths: string[] = [];
    function collect(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.type === 'folder') {
          allFolderPaths.push(n.path);
          collect(n.children ?? []);
        }
      }
    }
    collect(filteredTree);
    setExpandedPaths(new Set(allFolderPaths));
  }

  function collapseAll() {
    setExpandedPaths(new Set());
  }

  const tabs: { key: 'all' | 'synced' | 'modified' | 'not_imported'; label: string; count: number | null }[] = [
    { key: 'all', label: 'Tất cả', count: summary.total_files },
    { key: 'imported', label: 'Đã import', count: summary.imported },
    { key: 'needs_update', label: 'Cần cập nhật', count: summary.needs_update },
    { key: 'has_mapping', label: 'Chưa import', count: summary.has_mapping },
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-700">File OneDrive (Staging)</h3>
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 border rounded hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Làm mới
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
        <div className="px-4 py-3 text-center">
          <p className="text-xl font-bold text-slate-800">{summary.total_files}</p>
          <p className="text-xs text-slate-400 mt-0.5">Tổng file</p>
          <p className="text-xs text-slate-300 mt-0.5">{humanSize(summary.total_size_bytes)}</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xl font-bold text-emerald-600">{summary.imported}</p>
          <p className="text-xs text-slate-400 mt-0.5">Đã đồng bộ</p>
          <div className="mt-1 flex justify-center">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          </div>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xl font-bold text-amber-500">{summary.needs_update}</p>
          <p className="text-xs text-slate-400 mt-0.5">Cần cập nhật</p>
          <div className="mt-1 flex justify-center">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
          </div>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xl font-bold text-slate-500">{summary.no_mapping}</p>
          <p className="text-xs text-slate-400 mt-0.5">Chưa import</p>
          <div className="mt-1 flex justify-center">
            <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />
          </div>
        </div>
      </div>

      {/* Search & Tabs */}
      <div className="p-3 border-b border-slate-100 space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm kiếm tên file..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                  activeTab === t.key
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                {t.label}
                {t.count !== null && t.count > 0 && (
                  <span className={`ml-1 ${activeTab === t.key ? 'opacity-80' : 'text-slate-400'}`}>
                    ({t.count})
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button onClick={expandAll} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-0.5">
              Mở tất cả
            </button>
            <span className="text-slate-200">|</span>
            <button onClick={collapseAll} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-0.5">
              Thu gọn
            </button>
          </div>
        </div>
      </div>

      {/* Tree */}
      <div className="max-h-[520px] overflow-y-auto py-1">
        {isLoading ? (
          <div className="py-12 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Đang quét thư mục staging...</p>
          </div>
        ) : isError ? (
          <div className="py-12 flex flex-col items-center gap-3 text-red-400">
            <XCircle className="h-6 w-6" />
            <p className="text-sm">Không thể tải danh sách file</p>
          </div>
        ) : filteredTree.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-3 text-slate-400">
            <Files className="h-8 w-8 opacity-40" />
            <p className="text-sm">
              {search || activeTab !== 'all'
                ? 'Không tìm thấy file phù hợp'
                : 'Thư mục staging trống hoặc chưa mount'}
            </p>
          </div>
        ) : (
          filteredTree.map(node => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              expandedPaths={expandedPaths}
              onToggleFolder={toggleFolder}
              selectedFile={selectedFile}
              onSelectFile={handleSelectFile}
            />
          ))
        )}
      </div>

      {/* ── Action panel: shown when a file is selected ── */}
      {selectedFileNode && (
        <div className="border-t border-slate-100 p-4 space-y-4">
          {/* Header row: file name + action buttons */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="h-4 w-4 text-green-600 flex-shrink-0" />
              <h3 className="text-sm font-semibold text-slate-700 truncate">{selectedFileNode.name}</h3>
              <span className="text-xs text-slate-400 hidden sm:inline">{humanSize(selectedFileNode.size_bytes)}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handlePreview}
                disabled={previewLoading || importLoading || skipLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 disabled:opacity-50 transition-colors"
              >
                {previewLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Eye className="h-3.5 w-3.5" />}
                Xem trước
              </button>
              <button
                onClick={handleImport}
                disabled={importLoading || previewLoading || skipLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium"
              >
                {importLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
                Import file này
              </button>
              <button
                onClick={handleSkip}
                disabled={skipLoading || importLoading || previewLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 disabled:opacity-50 transition-colors"
              >
                {skipLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <SkipForward className="h-3.5 w-3.5" />}
                Bỏ qua
              </button>
            </div>
          </div>

          {/* Action feedback message */}
          {actionMessage && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
              actionMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                : 'bg-red-50 text-red-600 border border-red-100'
            }`}>
              {actionMessage.type === 'success'
                ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
              {actionMessage.text}
            </div>
          )}

          {/* Preview error */}
          {previewError && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600 border border-red-100">
              <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {previewError}
            </div>
          )}

          {/* Preview table */}
          {preview && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
                <span>
                  Hiển thị <strong>{preview.rows.length}</strong> / <strong>{preview.total_rows}</strong> hàng
                  {preview.sheets.length > 1 ? (
                    <span>&nbsp;·&nbsp; Sheet:&nbsp;
                      <select
                        className="text-xs border rounded px-1 py-0.5 bg-white"
                        value={preview.active_sheet}
                        onChange={async (ev) => {
                          const sheet = ev.target.value;
                          try {
                            const res = await api.get<{ data: FilePreviewData }>(
                              `/api/v1/data-migration/file-preview?path=${encodeURIComponent(selectedFile!)}&sheet=${encodeURIComponent(sheet)}&rows=30`
                            );
                            setPreview(res.data);
                          } catch {}
                        }}
                      >
                        {preview.sheets.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </span>
                  ) : (
                    <span>&nbsp;·&nbsp; Sheet: <span className="font-mono">{preview.active_sheet}</span></span>
                  )}
                </span>
                {preview.target_table && (
                  <span className={`px-2 py-0.5 rounded font-medium ${
                    preview.recognized
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    Bảng đích: <span className="font-mono">{preview.target_table}</span>
                    {' '}({(preview.target_table_count ?? 0).toLocaleString('vi-VN')} rows hiện tại)
                  </span>
                )}
              </div>
              <div className="overflow-x-auto max-h-80 border border-slate-200 rounded-lg">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-50 z-10">
                    <tr>
                      {(preview.headers ?? []).map((h, i) => (
                        <th
                          key={i}
                          className="text-left px-3 py-2 font-medium text-slate-600 border-b border-slate-200 whitespace-nowrap"
                        >
                          {h || `Col${i}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(preview.rows ?? []).map((row, ri) => (
                      <tr key={ri} className="hover:bg-slate-50/70">
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="px-3 py-1.5 text-slate-600 max-w-[200px] truncate"
                            title={cell}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import result */}
          {importResult && (
            <div className={`p-3 rounded-lg border text-xs space-y-1 ${
              importResult.status === 'success'
                ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                : 'bg-red-50 border-red-100 text-red-700'
            }`}>
              <p className="font-semibold">
                Kết quả import — Log #{importResult.log_id}
              </p>
              <div className="flex flex-wrap gap-4">
                <span><strong>{(importResult.inserted ?? 0).toLocaleString()}</strong> mới</span>
                <span><strong>{(importResult.updated ?? 0).toLocaleString()}</strong> cập nhật</span>
                <span><strong>{(importResult.skipped ?? 0).toLocaleString()}</strong> bỏ qua</span>
                {(importResult.errors ?? 0) > 0 && (
                  <span className="text-red-600"><strong>{importResult.errors}</strong> lỗi</span>
                )}
              </div>
              {importResult.output && (
                <pre className="mt-2 p-2 bg-white/60 rounded text-[10px] font-mono text-slate-600 overflow-x-auto whitespace-pre-wrap max-h-32">
                  {importResult.output}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MigrationPage() {
  const queryClient = useQueryClient();
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  // API: sync-status
  const { data: statusRaw, isLoading: statusLoading } = useQuery({
    queryKey: ['migration-sync-status'],
    queryFn: () => api.get<{ data: SyncStatusItem[] }>('/api/v1/data-migration/sync-status'),
    refetchInterval: 10_000,
  });

  // API: sync-history
  const { data: historyRaw, isLoading: historyLoading } = useQuery({
    queryKey: ['migration-sync-history', historyPage],
    queryFn: () => api.get<{ data: { items: SyncHistoryItem[]; total: number } }>(
      `/api/v1/data-migration/sync-history?page=${historyPage}&page_size=20`
    ),
  });

  // API: import-stats
  const { data: importRaw } = useQuery({
    queryKey: ['migration-import-stats'],
    queryFn: () => api.get<{ data: ImportStatItem[] }>('/api/v1/data-migration/import-stats'),
  });

  // API: data-quality
  const { data: qualityRaw, isLoading: qualityLoading } = useQuery({
    queryKey: ['migration-data-quality'],
    queryFn: () => api.get<{ data: { items: DataQualityItem[]; total: number } }>(
      '/api/v1/data-migration/data-quality?page=1&page_size=50'
    ),
  });

  const triggerBqms = useMutation({
    mutationFn: () => api.post('/api/v1/data-migration/trigger-sync/bqms'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['migration-sync-history'] });
    },
  });

  const triggerOnedrive = useMutation({
    mutationFn: () => api.post('/api/v1/data-migration/trigger-sync/onedrive'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['migration-sync-history'] });
    },
  });

  const runQuality = useMutation({
    mutationFn: () => api.post('/api/v1/data-migration/data-quality/run'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-data-quality'] });
    },
  });

  // Safe data extraction
  const statusItems: SyncStatusItem[] = Array.isArray(statusRaw?.data) ? statusRaw.data : [];
  const bqmsStatus = statusItems.find(s => s.sync_type === 'bqms');
  const onedriveStatus = statusItems.find(s => s.sync_type === 'onedrive');

  const history: SyncHistoryItem[] = Array.isArray(historyRaw?.data?.items)
    ? historyRaw.data.items
    : Array.isArray(historyRaw?.data)
      ? (historyRaw.data as any)
      : [];
  const historyTotal = (historyRaw?.data as any)?.total ?? history.length;

  const importStats: ImportStatItem[] = Array.isArray(importRaw?.data)
    ? importRaw.data
    : Array.isArray((importRaw?.data as any)?.table_stats)
      ? (importRaw?.data as any).table_stats
      : [];

  const qualityItems: DataQualityItem[] = Array.isArray(qualityRaw?.data?.items)
    ? qualityRaw.data.items
    : Array.isArray(qualityRaw?.data)
      ? (qualityRaw.data as any)
      : [];

  const passCount = qualityItems.filter(q => q.status === 'pass').length;
  const warnCount = qualityItems.filter(q => q.status === 'warning').length;
  const failCount = qualityItems.filter(q => q.status === 'fail').length;

  const isAnySyncing = triggerBqms.isPending || triggerOnedrive.isPending
    || statusItems.some(s => s.status === 'running');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-display font-bold text-slate-900">Đồng bộ dữ liệu</h2>
        <p className="text-sm text-slate-500 mt-0.5">Quản lý đồng bộ BQMS Samsung và OneDrive Song Châu</p>
      </div>

      {/* ═══ Section 1: OneDrive File Explorer ═══ */}
      <OneDriveFileExplorer />

      {/* ═══ Section 2: Sync Status Cards ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className={`h-4 w-4 ${bqmsStatus?.status === 'running' ? 'animate-spin text-blue-500' : 'text-slate-400'}`} />
            <span className="text-xs text-slate-500 uppercase tracking-wider">BQMS Samsung</span>
          </div>
          <p className="text-sm font-semibold text-slate-700">
            {timeAgo(bqmsStatus?.last_completed ?? bqmsStatus?.last_started ?? null)}
          </p>
          {bqmsStatus?.rows_inserted ? (
            <p className="text-xs text-slate-400 mt-1">{bqmsStatus.rows_inserted} rows</p>
          ) : null}
          <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded font-medium ${statusBadge(bqmsStatus?.status || 'never_run')}`}>
            {statusLabel(bqmsStatus?.status || 'never_run')}
          </span>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className={`h-4 w-4 ${onedriveStatus?.status === 'running' ? 'animate-spin text-indigo-500' : 'text-slate-400'}`} />
            <span className="text-xs text-slate-500 uppercase tracking-wider">OneDrive Song Châu</span>
          </div>
          <p className="text-sm font-semibold text-slate-700">
            {timeAgo(onedriveStatus?.last_completed ?? onedriveStatus?.last_started ?? null)}
          </p>
          {onedriveStatus?.rows_inserted ? (
            <p className="text-xs text-slate-400 mt-1">{onedriveStatus.rows_inserted} rows</p>
          ) : null}
          <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded font-medium ${statusBadge(onedriveStatus?.status || 'never_run')}`}>
            {statusLabel(onedriveStatus?.status || 'never_run')}
          </span>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="h-4 w-4 text-slate-400" />
            <span className="text-xs text-slate-500 uppercase tracking-wider">Import Stats</span>
          </div>
          <p className="text-sm font-semibold text-slate-700">
            {importStats.length} tables
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {importStats.reduce((sum, t) => sum + (t.row_count ?? 0), 0).toLocaleString('vi-VN')} tổng rows
          </p>
        </div>
      </div>

      {/* Trigger Buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => triggerBqms.mutate()}
          disabled={triggerBqms.isPending || isAnySyncing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {triggerBqms.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          Đồng bộ BQMS
        </button>
        <button
          onClick={() => triggerOnedrive.mutate()}
          disabled={triggerOnedrive.isPending || isAnySyncing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {triggerOnedrive.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          Đồng bộ OneDrive
        </button>
        {isAnySyncing && (
          <span className="flex items-center gap-2 text-sm text-blue-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang đồng bộ...
          </span>
        )}
      </div>

      {/* ═══ Section 3: Sync History ═══ */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-slate-100">
          <RefreshCw className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-700">Lịch sử đồng bộ</h3>
          <span className="text-xs text-slate-400 ml-auto">{historyTotal} bản ghi</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Loại</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Trạng thái</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Thời gian</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Inserted</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Skipped</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Lỗi</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {historyLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-200 rounded animate-pulse" /></td>
                  ))}</tr>
                ))
              ) : history.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">Chưa có lịch sử đồng bộ</td></tr>
              ) : history.map((item) => (
                <>
                  <tr key={item.id} className="hover:bg-slate-50/50 cursor-pointer" onClick={() => setExpandedRow(expandedRow === item.id ? null : item.id)}>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono font-medium text-slate-700 uppercase">{item.sync_type}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusBadge(item.status)}`}>
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{timeAgo(item.started_at)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-700">{(item.rows_inserted ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-400">{(item.rows_skipped ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-xs text-red-500 max-w-[200px] truncate">{item.error_message || '—'}</td>
                    <td className="px-2">{expandedRow === item.id ? <ChevronUp className="h-3 w-3 text-slate-400" /> : <ChevronDown className="h-3 w-3 text-slate-400" />}</td>
                  </tr>
                  {expandedRow === item.id && (
                    <tr key={`${item.id}-detail`}>
                      <td colSpan={7} className="bg-slate-50 px-6 py-3 text-xs text-slate-600">
                        <div className="grid grid-cols-2 gap-4">
                          <div><span className="text-slate-400">Bắt đầu:</span> {item.started_at ? new Date(item.started_at).toLocaleString('vi-VN') : '—'}</div>
                          <div><span className="text-slate-400">Hoàn thành:</span> {item.completed_at ? new Date(item.completed_at).toLocaleString('vi-VN') : '—'}</div>
                          <div><span className="text-slate-400">Rows inserted:</span> {item.rows_inserted ?? 0}</div>
                          <div><span className="text-slate-400">Rows updated:</span> {item.rows_updated ?? 0}</div>
                          <div><span className="text-slate-400">Rows skipped:</span> {item.rows_skipped ?? 0}</div>
                          <div><span className="text-slate-400">Source:</span> {item.source_file || '—'}</div>
                          {item.error_message && (
                            <div className="col-span-2 text-red-600 bg-red-50 p-2 rounded">{item.error_message}</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {historyTotal > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-400">Trang {historyPage}</span>
            <div className="flex gap-1">
              <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage === 1}
                className="px-3 py-1 text-xs border rounded disabled:opacity-40">Trước</button>
              <button onClick={() => setHistoryPage(p => p + 1)} disabled={historyPage * 20 >= historyTotal}
                className="px-3 py-1 text-xs border rounded disabled:opacity-40">Sau</button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ Section 4: Import Stats ═══ */}
      {importStats.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-slate-100">
            <Database className="h-4 w-4 text-green-600" />
            <h3 className="text-sm font-semibold text-slate-700">Thống kê Import theo bảng</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Bảng</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Số hàng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {importStats.filter(t => t.row_count > 0).sort((a, b) => b.row_count - a.row_count).map((t, i) => (
                  <tr key={i} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{t.table_name}</td>
                    <td className="px-4 py-2 text-right font-mono text-sm text-slate-800">{(t.row_count ?? 0).toLocaleString('vi-VN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Section 5: Data Quality ═══ */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-slate-700">Chất lượng dữ liệu</h3>
            {qualityItems.length > 0 && (
              <div className="flex gap-2 ml-4">
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">{passCount} đạt</span>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">{warnCount} cảnh báo</span>
                <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">{failCount} lỗi</span>
              </div>
            )}
          </div>
          <button
            onClick={() => runQuality.mutate()}
            disabled={runQuality.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-60"
          >
            {runQuality.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            Kiểm tra chất lượng
          </button>
        </div>

        {/* Summary progress bar */}
        {qualityItems.length > 0 && (
          <div className="px-4 py-2 border-b border-slate-100">
            <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
              {passCount > 0 && <div className="bg-emerald-500" style={{ width: `${passCount / qualityItems.length * 100}%` }} />}
              {warnCount > 0 && <div className="bg-amber-500" style={{ width: `${warnCount / qualityItems.length * 100}%` }} />}
              {failCount > 0 && <div className="bg-red-500" style={{ width: `${failCount / qualityItems.length * 100}%` }} />}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Bảng</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Kiểm tra</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Loại</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Kết quả</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Hàng ảnh hưởng</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {qualityLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-200 rounded animate-pulse" /></td>
                  ))}</tr>
                ))
              ) : qualityItems.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">Nhấn "Kiểm tra chất lượng" để chạy kiểm tra</td></tr>
              ) : qualityItems.map((item, idx) => (
                <tr key={item.id ?? idx} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{item.table_name}</td>
                  <td className="px-4 py-2.5 text-sm text-slate-600">{item.check_name}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{item.check_type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${qualityBadge(item.status)}`}>
                      {qualityLabel(item.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm text-slate-700">{(item.affected_rows ?? 0).toLocaleString('vi-VN')}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[200px] truncate">
                    {typeof item.details === 'object' && item.details
                      ? JSON.stringify(item.details).slice(0, 80)
                      : item.details || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
