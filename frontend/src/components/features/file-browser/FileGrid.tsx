'use client';

import {
  FileText, FileSpreadsheet, Image, Film, File, Folder,
  Box, FileArchive, FileCode, Download, Eye,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileItem {
  id: number;
  graph_item_id: string;
  graph_parent_id: string | null;
  name: string;
  file_path: string;
  file_extension: string | null;
  file_size: number;
  mime_type: string | null;
  is_folder: boolean;
  is_cached: boolean;
  remote_modified_at: string | null;
  preview_type: string;
  sync_status: string;
}

interface FileGridProps {
  items: FileItem[];
  viewMode: 'grid' | 'list';
  selectedId: number | null;
  onSelect: (item: FileItem) => void;
  onNavigateFolder: (graphItemId: string) => void;
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileIcon(item: FileItem) {
  if (item.is_folder) return <Folder className="w-5 h-5 text-amber-500" />;

  const ext = (item.file_extension || '').toLowerCase();
  const type = item.preview_type;

  if (type === 'pdf') return <FileText className="w-5 h-5 text-red-500" />;
  if (type === 'excel') return <FileSpreadsheet className="w-5 h-5 text-green-600" />;
  if (type === 'image') return <Image className="w-5 h-5 text-purple-500" />;
  if (type === 'word') return <FileText className="w-5 h-5 text-blue-600" />;
  if (type === 'cad3d') return <Box className="w-5 h-5 text-orange-500" />;
  if (type === 'cad2d') return <FileCode className="w-5 h-5 text-teal-600" />;
  if (type === 'zip') return <FileArchive className="w-5 h-5 text-yellow-600" />;
  if (ext === '.mp4' || ext === '.avi') return <Film className="w-5 h-5 text-pink-500" />;

  return <File className="w-5 h-5 text-slate-400" />;
}

function getLargeIcon(item: FileItem) {
  if (item.is_folder) return <Folder className="w-10 h-10 text-amber-500" />;

  const type = item.preview_type;

  if (type === 'pdf') return <FileText className="w-10 h-10 text-red-500" />;
  if (type === 'excel') return <FileSpreadsheet className="w-10 h-10 text-green-600" />;
  if (type === 'image') return <Image className="w-10 h-10 text-purple-500" />;
  if (type === 'word') return <FileText className="w-10 h-10 text-blue-600" />;
  if (type === 'cad3d') return <Box className="w-10 h-10 text-orange-500" />;
  if (type === 'cad2d') return <FileCode className="w-10 h-10 text-teal-600" />;
  if (type === 'zip') return <FileArchive className="w-10 h-10 text-yellow-600" />;

  return <File className="w-10 h-10 text-slate-400" />;
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
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton({ viewMode }: { viewMode: 'grid' | 'list' }) {
  if (viewMode === 'grid') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="p-3 rounded-lg border border-slate-100 animate-pulse">
            <div className="w-10 h-10 bg-slate-200 rounded mb-2" />
            <div className="h-4 bg-slate-200 rounded w-3/4 mb-1" />
            <div className="h-3 bg-slate-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-2 animate-pulse">
          <div className="w-5 h-5 bg-slate-200 rounded" />
          <div className="h-4 bg-slate-200 rounded flex-1 max-w-xs" />
          <div className="h-3 bg-slate-100 rounded w-16" />
          <div className="h-3 bg-slate-100 rounded w-20" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <Folder className="w-12 h-12 mb-3 text-slate-300" />
      <p className="text-sm font-medium">Thư mục trống</p>
      <p className="text-xs mt-1">Không có file hoặc thư mục con nào.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid View
// ---------------------------------------------------------------------------

function GridView({
  items, selectedId, onSelect, onNavigateFolder,
}: Omit<FileGridProps, 'viewMode' | 'isLoading'>) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => {
            if (item.is_folder) {
              onNavigateFolder(item.graph_item_id);
            } else {
              onSelect(item);
            }
          }}
          onDoubleClick={() => {
            if (item.is_folder) {
              onNavigateFolder(item.graph_item_id);
            }
          }}
          className={`
            flex flex-col items-center p-3 rounded-lg border text-center
            transition-all duration-150 cursor-pointer group
            ${selectedId === item.id
              ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-400/30'
              : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'
            }
          `}
        >
          <div className="mb-2">{getLargeIcon(item)}</div>
          <p className="text-xs font-medium text-slate-700 truncate w-full leading-tight">
            {item.name}
          </p>
          {!item.is_folder && (
            <p className="text-[10px] text-slate-400 mt-0.5">
              {formatFileSize(item.file_size)}
            </p>
          )}
          {item.is_folder && (
            <p className="text-[10px] text-slate-400 mt-0.5">Thư mục</p>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function ListView({
  items, selectedId, onSelect, onNavigateFolder,
}: Omit<FileGridProps, 'viewMode' | 'isLoading'>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
            <th className="py-2 pl-2 pr-3 w-8" />
            <th className="py-2 pr-3 font-medium">Tên</th>
            <th className="py-2 pr-3 font-medium w-24">Kích thước</th>
            <th className="py-2 pr-3 font-medium w-20">Loại</th>
            <th className="py-2 pr-3 font-medium w-24">Ngày sửa</th>
            <th className="py-2 pr-3 w-10" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              onClick={() => {
                if (item.is_folder) {
                  onNavigateFolder(item.graph_item_id);
                } else {
                  onSelect(item);
                }
              }}
              className={`
                border-b border-slate-50 cursor-pointer transition-colors group
                ${selectedId === item.id
                  ? 'bg-blue-50'
                  : 'hover:bg-slate-50'
                }
              `}
            >
              <td className="py-2 pl-2 pr-3">{getFileIcon(item)}</td>
              <td className="py-2 pr-3">
                <span className="font-medium text-slate-700 truncate block max-w-md">
                  {item.name}
                </span>
              </td>
              <td className="py-2 pr-3 text-slate-500 text-xs">
                {item.is_folder ? '—' : formatFileSize(item.file_size)}
              </td>
              <td className="py-2 pr-3 text-slate-500 text-xs uppercase">
                {item.is_folder ? 'Thư mục' : (item.file_extension || '').replace('.', '')}
              </td>
              <td className="py-2 pr-3 text-slate-500 text-xs">
                {formatDate(item.remote_modified_at)}
              </td>
              <td className="py-2 pr-3">
                {!item.is_folder && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.is_cached && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" title="Đã lưu cache" />
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function FileGrid(props: FileGridProps) {
  const { items, viewMode, isLoading } = props;

  if (isLoading) {
    return <LoadingSkeleton viewMode={viewMode} />;
  }

  if (!items || items.length === 0) {
    return <EmptyState />;
  }

  if (viewMode === 'grid') {
    return <GridView {...props} />;
  }

  return <ListView {...props} />;
}
