'use client';

import { useState, useEffect } from 'react';
import { Search, LayoutGrid, List, ArrowUpDown, RefreshCw } from 'lucide-react';

interface FileToolbarProps {
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  sort: string;
  order: string;
  onSortChange: (sort: string, order: string) => void;
  onSearch: (query: string) => void;
  onRefresh?: () => void;
  isSearching?: boolean;
  searchQuery?: string;
}

export default function FileToolbar({
  viewMode,
  onViewModeChange,
  sort,
  order,
  onSortChange,
  onSearch,
  onRefresh,
  isSearching,
  searchQuery = '',
}: FileToolbarProps) {
  const [localQuery, setLocalQuery] = useState(searchQuery);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(localQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [localQuery, onSearch]);

  // Sync external changes
  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  const sortOptions = [
    { value: 'name', label: 'Tên' },
    { value: 'file_size', label: 'Kích thước' },
    { value: 'remote_modified_at', label: 'Ngày sửa đổi' },
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          placeholder="Tìm kiếm file..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400
                     bg-white placeholder:text-slate-400"
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />
          </div>
        )}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-1">
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value, order)}
          className="text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white
                     focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => onSortChange(sort, order === 'asc' ? 'desc' : 'asc')}
          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
          title={order === 'asc' ? 'Tăng dần' : 'Giảm dần'}
        >
          <ArrowUpDown className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      {/* View Toggle */}
      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
        <button
          onClick={() => onViewModeChange('grid')}
          className={`p-2 transition-colors ${
            viewMode === 'grid'
              ? 'bg-brand-50 text-brand-600'
              : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
          }`}
          title="Dạng lưới"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
        <button
          onClick={() => onViewModeChange('list')}
          className={`p-2 transition-colors ${
            viewMode === 'list'
              ? 'bg-brand-50 text-brand-600'
              : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
          }`}
          title="Dạng danh sách"
        >
          <List className="w-4 h-4" />
        </button>
      </div>

      {/* Refresh */}
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
          title="Tải lại"
        >
          <RefreshCw className="w-4 h-4 text-slate-500" />
        </button>
      )}
    </div>
  );
}
