'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clipboard,
  Columns3,
  DollarSign,
  Edit3,
  Eye,
  EyeOff,
  Factory,
  FileSpreadsheet,
  Gavel,
  FileText,
  Filter,
  GitCompare,
  ImageOff,
  Layers,
  Loader2,
  Package,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';

import { api } from '@/lib/api';
import { cn, withToken } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SourcingFormDrawer, type SourcingEntry } from '@/components/sourcing/SourcingFormDrawer';
import { SourcingImportModal } from '@/components/sourcing/SourcingImportModal';
import { SupplierCompareDrawer } from '@/components/sourcing/SupplierCompareDrawer';
import { BulkLookupSourcingModal } from '@/components/sourcing/BulkLookupSourcingModal';
import { QuoteBatchModal } from '@/components/sourcing/QuoteBatchModal';
import { PushToBiddingModal } from '@/components/sourcing/PushToBiddingModal';

/* ─────────── Types ─────────── */

interface SourcingStats {
  total_entries: number;
  unique_codes: number;
  unique_models: number;
  unique_suppliers: number;
  unique_makers: number;
  unique_customers: number;
  has_price_count: number;
  has_supplier_count: number;
  has_image_count: number;
  has_hs_count: number;
  stage_1: number;
  stage_2: number;
  stage_3: number;
  status_ok: number;
  status_needs_brand: number;
  status_not_in_catalog: number;
  status_candidate: number;
  added_30d: number;
  added_7d: number;
  top_suppliers: { supplier_name: string; entries: number }[];
  top_makers: { maker: string; entries: number }[];
  top_categories: { catalog_category: string; entries: number }[];
  top_brands: { brand_canonical: string; entries: number }[];
  top_customers: { customer_name: string; entries: number }[];
}

interface SourcingListResponse {
  data: {
    items: SourcingEntry[];
    total: number;
    page: number;
    pages: number;
  };
}

type SortKey = 'created_at' | 'updated_at' | 'inquiry_date' | 'sale_vnd' | 'cost_vnd' | 'maker' | 'model' | 'supplier_name';

type StatusKey = 'OK' | 'NEEDS_BRAND' | 'PRODUCT_CANDIDATE' | 'NOT_IN_CATALOG';

const STATUS_LABEL: Record<StatusKey, string> = {
  OK: 'OK',
  NEEDS_BRAND: 'Cần brand',
  PRODUCT_CANDIDATE: 'Candidate',
  NOT_IN_CATALOG: 'Ngoài catalog',
};

const STATUS_DOT: Record<StatusKey, string> = {
  OK: 'bg-emerald-500',
  NEEDS_BRAND: 'bg-amber-500',
  PRODUCT_CANDIDATE: 'bg-sky-500',
  NOT_IN_CATALOG: 'bg-rose-500',
};

/* ─────────── Column Definitions ─────────── */

// LIST REDESIGN — 10 visible columns (was 14). Killed: `coefficient` (moved to drawer Tính giá tab),
// standalone Item Type fused into `category`. `image` + `product` + `actions` are sticky.
type ColumnKey =
  | 'image'
  | 'product'
  | 'customer'
  | 'maker'
  | 'supplier'
  | 'sale'
  | 'catalog'
  | 'category'
  | 'actions';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  description: string;
  defaultVisible: boolean;
  always?: boolean;
  /** Explicit column width applied via <col> in <colgroup> so widths are respected (table-fixed). */
  width: string;
}

// Width budget (40 cbx + 56 img + 280 product + 160 cust + 130 maker + 160 supp + 140 sale + 110 cat + 140 phanloai + 56 act = 1272px)
const COLUMNS: ColumnDef[] = [
  { key: 'image', label: 'Ảnh', description: 'Ảnh thumbnail (sticky)', defaultVisible: true, always: true, width: '56px' },
  { key: 'product', label: 'Sản phẩm', description: 'Model / BQMS / tên sản phẩm (sticky)', defaultVisible: true, always: true, width: '280px' },
  { key: 'customer', label: 'Khách + PT', description: 'Khách hàng + người phụ trách', defaultVisible: true, width: '160px' },
  { key: 'maker', label: 'NSX', description: 'Nhà sản xuất + brand/HS (hover-reveal)', defaultVisible: true, width: '130px' },
  { key: 'supplier', label: 'NCC', description: 'Nhà cung cấp chính + số lượng NCC đã lưu', defaultVisible: true, width: '160px' },
  { key: 'sale', label: 'Giá', description: 'Giá bán + biên lợi nhuận inline', defaultVisible: true, width: '140px' },
  { key: 'catalog', label: 'Catalog', description: 'Stage 3-dot + trạng thái catalog', defaultVisible: true, width: '110px' },
  { key: 'category', label: 'Phân loại', description: 'Catalog category + ngày inquiry/sửa', defaultVisible: true, width: '140px' },
  { key: 'actions', label: 'Thao tác', description: 'Mở drawer / Edit / Compare / Delete (sticky)', defaultVisible: true, always: true, width: '56px' },
];

const COLUMN_VISIBILITY_KEY = 'sourcing-column-visibility-v1';

/* ─────────── Formatters ─────────── */

function fmtCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '0';
  return Number(value).toLocaleString('vi-VN');
}

/**
 * Full grouped money — shows the ENTIRE number the user typed, no K/M/tỷ
 * abbreviation (e.g. 12000 -> "12.000", 12.5 -> "12,5"). Used for per-row
 * price cells where truncation reads like a corrupted figure.
 */
function fmtMoneyFull(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '';
  return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

/** Short date format DD/MM/YY used in Phân loại column (no full year). */
function fmtDateShort(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Subtle empty-cell placeholder — tiny slate-200 dot used ONLY when emptiness is
 * meaningful (NSX / NCC / Khách / Giá). Elsewhere render blank whitespace.
 * Spec: 1.5px dot, slate-200, aria-label="trống".
 */
function EmptyDot({ className }: { className?: string }) {
  return (
    <span
      aria-label="trống"
      className={cn('inline-block h-1 w-1 rounded-full bg-slate-200 align-middle', className)}
    />
  );
}

/**
 * Stage 3-dot rail: shows ●●○ for S2, ●○○ for S1, ●●● (emerald) for S3.
 * Spec: h-1.5 w-1.5 rounded-full, gap-1; brand-500 for S1/S2 filled dots,
 * slate-200 for unfilled, emerald-500 for all 3 dots at S3.
 */
function StageDots({ stage }: { stage: 1 | 2 | 3 }) {
  const fillColor = stage === 3 ? 'bg-emerald-500' : 'bg-brand-500';
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Stage ${stage} trên 3`}>
      {[1, 2, 3].map((s) => (
        <span
          key={s}
          className={cn('h-1.5 w-1.5 rounded-full', s <= stage ? fillColor : 'bg-slate-200')}
        />
      ))}
    </span>
  );
}

/* ─────────── Main Page ─────────── */

export default function SourcingPage() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  // ICE frontend #1 (Thang 2026-06-13): debounce the search box so we don't
  // fire one tanstack-query refetch per keystroke. Keep `searchInput` for
  // the controlled <input>; feed `debouncedSearch` into queryKey + params.
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [sortBy, setSortBy] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [jumpPage, setJumpPage] = useState('');
  // Analytics collapse (Thang 2026-06-17): default CLOSED so the data table sits
  // near the top — user complained about scrolling past the stat blocks.
  const [statsOpen, setStatsOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<SourcingEntry | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [compareCode, setCompareCode] = useState<string | null>(null);
  const [bulkLookupOpen, setBulkLookupOpen] = useState(false);
  const [quoteBatchIds, setQuoteBatchIds] = useState<number[] | null>(null);
  // V8: ids queued for "Gửi đấu thầu" (push to vendor-bidding).
  const [pushBiddingIds, setPushBiddingIds] = useState<number[] | null>(null);

  const [filterCategory, setFilterCategory] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterHasPrice, setFilterHasPrice] = useState<'' | 'true' | 'false'>('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ICE a11y: ref to search box + polite live region for status updates.
  const searchRef = useRef<HTMLInputElement>(null);
  const [liveMsg, setLiveMsg] = useState('');

  // LIST REDESIGN: track horizontal scroll on the table wrapper so we can apply
  // shadow accents on the sticky-left (Sản phẩm) and sticky-right (Thao tác)
  // boundaries. Wrapper itself doesn't scroll (must stay overflow:visible to
  // preserve sticky-thead), but <main> ancestor does. We listen on window scroll
  // and read the table's getBoundingClientRect against the wrapper's rect.
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [scrolledLeft, setScrolledLeft] = useState(false);
  const [scrolledRight, setScrolledRight] = useState(false);

  // Horizontal-scroll detection for sticky-column shadows. Compare the table's
  // bounding rect against its wrapper's. If the table extends past the wrapper's
  // left edge → user has scrolled right (show shadow on right of left-sticky).
  // If it extends past the right edge → show shadow on left of right-sticky.
  useEffect(() => {
    const update = () => {
      const wrap = tableWrapRef.current;
      if (!wrap) return;
      const table = wrap.querySelector('table');
      if (!table) return;
      const tRect = table.getBoundingClientRect();
      const wRect = wrap.getBoundingClientRect();
      // User has scrolled horizontally past the start → table left is left of wrapper
      setScrolledLeft(tRect.left < wRect.left - 0.5);
      // More table to the right → table right is right of wrapper
      setScrolledRight(tRect.right > wRect.right + 0.5);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  // "/" focuses the search box (skip when typing in input/textarea).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Persist analytics-collapse preference to localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (window.localStorage.getItem('sourcing-stats-open-v1') === '1') setStatsOpen(true);
    } catch { /* ignore */ }
  }, []);
  const persistStatsOpen = (next: boolean) => {
    setStatsOpen(next);
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('sourcing-stats-open-v1', next ? '1' : '0'); } catch { /* ignore */ }
    }
  };

  /* Column visibility — persisted to localStorage */
  const [columnVisibility, setColumnVisibility] = useState<Record<ColumnKey, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    COLUMNS.forEach((c) => (initial[c.key] = c.defaultVisible));
    return initial as Record<ColumnKey, boolean>;
  });
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(COLUMN_VISIBILITY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        setColumnVisibility((prev) => {
          const next = { ...prev };
          COLUMNS.forEach((c) => {
            if (c.always) next[c.key] = true;
            else if (typeof parsed[c.key] === 'boolean') next[c.key] = parsed[c.key];
          });
          return next;
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const persistColumnVisibility = (next: Record<ColumnKey, boolean>) => {
    setColumnVisibility(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    }
  };

  const toggleColumn = (key: ColumnKey) => {
    const col = COLUMNS.find((c) => c.key === key);
    if (col?.always) return;
    persistColumnVisibility({ ...columnVisibility, [key]: !columnVisibility[key] });
  };

  const resetColumnsToDefault = () => {
    const next: Record<string, boolean> = {};
    COLUMNS.forEach((c) => (next[c.key] = c.defaultVisible));
    persistColumnVisibility(next as Record<ColumnKey, boolean>);
  };

  const isCol = (k: ColumnKey) => columnVisibility[k];
  const visibleColCount = COLUMNS.filter((c) => columnVisibility[c.key]).length + 1; // +1 for checkbox col

  const statsQ = useQuery<{ data: SourcingStats }>({
    queryKey: ['sourcing-stats'],
    queryFn: () => api.get('/api/v1/sourcing/stats'),
    retry: false,
  });

  const listQ = useQuery<SourcingListResponse>({
    queryKey: ['sourcing-list', debouncedSearch, sortBy, sortDir, page, pageSize, filterCategory, filterBrand, filterStatus, filterStage, filterHasPrice, filterCustomer],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      if (filterCategory) params.set('catalog_category', filterCategory);
      if (filterBrand) params.set('brand_canonical', filterBrand);
      if (filterStatus) params.set('catalog_status', filterStatus);
      if (filterStage) params.set('stage', filterStage);
      if (filterHasPrice) params.set('has_price', filterHasPrice);
      if (filterCustomer) params.set('customer', filterCustomer);
      return api.get(`/api/v1/sourcing/?${params}`);
    },
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/sourcing/${id}`),
    onSuccess: () => {
      setLiveMsg('Đã xoá entry');
      queryClient.invalidateQueries({ queryKey: ['sourcing-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sourcing-list'] });
    },
    onError: (err: any) => {
      setLiveMsg(`Xoá thất bại: ${err?.message ?? 'Unknown'}`);
    },
  });

  const stats = statsQ.data?.data;
  const items = listQ.data?.data?.items ?? [];
  const total = listQ.data?.data?.total ?? 0;
  const pages = listQ.data?.data?.pages ?? 1;

  // Batch #4 (V3): if every entry chosen for a quote batch belongs to the SAME
  // CRM customer, pre-select + lock that customer in the quote modal (so the
  // báo giá autofills company/MST/address). Mixed/none → null → modal asks.
  const quoteBatchCustomerId = useMemo<number | null>(() => {
    if (!quoteBatchIds || quoteBatchIds.length === 0) return null;
    const ids = new Set<number>();
    for (const it of items as SourcingEntry[]) {
      if (quoteBatchIds.includes(it.id) && it.customer_id != null) ids.add(it.customer_id);
    }
    return ids.size === 1 ? Array.from(ids)[0] : null;
  }, [quoteBatchIds, items]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setFilterCategory('');
    setFilterBrand('');
    setFilterStatus('');
    setFilterStage('');
    setFilterHasPrice('');
    setFilterCustomer('');
    setSearchInput('');
    setPage(1);
  };

  const removeOneFilter = (key: string) => {
    if (key === 'category') setFilterCategory('');
    else if (key === 'brand') setFilterBrand('');
    else if (key === 'status') setFilterStatus('');
    else if (key === 'stage') setFilterStage('');
    else if (key === 'hasPrice') setFilterHasPrice('');
    else if (key === 'customer') setFilterCustomer('');
    else if (key === 'search') setSearchInput('');
    setPage(1);
  };

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; value: string }[] = [];
    if (searchInput) chips.push({ key: 'search', label: 'Tìm', value: searchInput });
    if (filterCategory) chips.push({ key: 'category', label: 'Catalog', value: filterCategory });
    if (filterBrand) chips.push({ key: 'brand', label: 'Brand', value: filterBrand });
    if (filterStatus) chips.push({ key: 'status', label: 'Status', value: STATUS_LABEL[filterStatus as StatusKey] || filterStatus });
    if (filterStage) chips.push({ key: 'stage', label: 'Stage', value: `S${filterStage}` });
    if (filterHasPrice) chips.push({ key: 'hasPrice', label: 'Giá bán', value: filterHasPrice === 'true' ? 'Có' : 'Chưa' });
    if (filterCustomer) chips.push({ key: 'customer', label: 'Khách', value: filterCustomer });
    return chips;
  }, [searchInput, filterCategory, filterBrand, filterStatus, filterStage, filterHasPrice, filterCustomer]);

  const hasActiveFilter = activeFilterChips.length > 0;

  const selectedTotalValue = useMemo(() => {
    return items
      .filter((r) => selectedIds.has(r.id))
      .reduce((s, r) => s + (Number(r.sale_vnd) || 0) * (Number(r.quantity) || 1), 0);
  }, [items, selectedIds]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  const handleSaveDone = () => {
    setEditingEntry(null);
    setIsCreating(false);
    queryClient.invalidateQueries({ queryKey: ['sourcing-stats'] });
    queryClient.invalidateQueries({ queryKey: ['sourcing-list'] });
  };

  const handleOpenDetailFromBulk = async (sourcingId: number) => {
    try {
      const res = await api.get<{ data: SourcingEntry }>(`/api/v1/sourcing/${sourcingId}`);
      setEditingEntry(res.data);
      setBulkLookupOpen(false);
    } catch (err) {
      console.error('Failed to fetch sourcing entry', err);
    }
  };

  // Reopen from a table row must load the FULL entry (GET-single), not the
  // list-row projection — the list SELECT omits quote_snapshot / the frozen
  // pricing context, so opening the drawer with the list row lost today's
  // breakdown on reopen. Optimistically open with the list row (instant
  // drawer), then swap in the full entry once fetched. (Versioned pricing)
  const openEntryDetail = async (rowEntry: SourcingEntry) => {
    setEditingEntry(rowEntry);
    try {
      const res = await api.get<{ data: SourcingEntry }>(`/api/v1/sourcing/${rowEntry.id}`);
      if (res.data) setEditingEntry(res.data);
    } catch (err) {
      console.error('Failed to fetch full sourcing entry', err);
      // Leave the list-row entry open — the drawer still works, just without
      // the frozen snapshot until the next successful fetch.
    }
  };

  const brandCoverage = stats?.top_brands?.reduce((s, b) => s + b.entries, 0) ?? 0;
  const totalEntries = stats?.total_entries ?? 0;

  return (
    <div className="space-y-6 pb-12">
      {/* ICE a11y: page-level polite live region for save/delete announcements */}
      <div role="status" aria-live="polite" className="sr-only">
        {liveMsg}
      </div>
      {/* ─────────── Header ─────────── */}
      <PageHeader
        icon={Boxes}
        title={
          <span className="inline-flex items-center gap-2">
            Thư viện nguồn cung
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 align-middle">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </span>
        }
        subtitle={
          <>
            <span className="font-semibold tabular-nums text-slate-900">{fmtCount(totalEntries)}</span> entries
            · <span className="font-semibold tabular-nums text-slate-900">{fmtCount(stats?.unique_customers)}</span> khách hàng
            · <span className="font-semibold tabular-nums text-slate-900">{fmtCount(stats?.unique_suppliers)}</span> nhà cung cấp.
            Tra cứu lịch sử giá & NCC trong vài giây.
          </>
        }
        actions={
          <>
            <Link
              href="/sourcing/orders"
              className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-100 hover:border-brand-300 transition-colors"
              title="Theo dõi pipeline báo giá → đơn hàng"
            >
              <ShoppingCart className="h-4 w-4" />
              Theo dõi đơn hàng
            </Link>
            <button
              onClick={() => setBulkLookupOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
              title="Paste danh sách Model → tra cứu lịch sử báo giá hàng loạt"
            >
              <Clipboard className="h-4 w-4 text-slate-500" />
              Tra cứu hàng loạt
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              <Upload className="h-4 w-4 text-slate-500" />
              Import Excel
            </button>
            <button
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors shadow-sm"
            >
              <PlusCircle className="h-4 w-4" />
              Lưu nguồn mới
            </button>
            <button
              onClick={() => {
                statsQ.refetch();
                listQ.refetch();
              }}
              aria-label="Tải lại danh sách sourcing"
              className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
              title="Tải lại"
            >
              <RefreshCw className={cn('h-4 w-4', (statsQ.isFetching || listQ.isFetching) && 'animate-spin')} aria-hidden="true" />
            </button>
          </>
        }
      />

      {/* Toggle thu gọn thống kê — mặc định ẩn để bảng dữ liệu nằm sát đầu trang */}
      <div>
        <button
          type="button"
          onClick={() => persistStatsOpen(!statsOpen)}
          aria-expanded={statsOpen}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
        >
          <Layers className="h-4 w-4 text-slate-500" />
          Thống kê tổng quan
          <ChevronRight className={cn('h-4 w-4 text-slate-400 transition-transform', statsOpen && 'rotate-90')} />
        </button>
      </div>

      {statsOpen && (
      <>
      {/* ─────────── KPI Strip ─────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          icon={<Boxes className="h-5 w-5" />}
          label="Tổng entries"
          value={fmtCount(totalEntries)}
          hint={`+${fmtCount(stats?.added_7d)} trong 7 ngày`}
        />
        <KpiCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Có giá bán"
          value={fmtCount(stats?.has_price_count)}
          hint={`${pct(stats?.has_price_count ?? 0, totalEntries).toFixed(1)}% tổng entries`}
          progress={pct(stats?.has_price_count ?? 0, totalEntries)}
        />
        <KpiCard
          icon={<Tag className="h-5 w-5" />}
          label="Mã unique"
          value={fmtCount(stats?.unique_codes)}
          hint={`${pct(stats?.unique_codes ?? 0, totalEntries).toFixed(1)}% có BQMS`}
        />
        <KpiCard
          icon={<Layers className="h-5 w-5" />}
          label="Stage 3 — Ready"
          value={fmtCount(stats?.stage_3)}
          hint={`${pct(stats?.stage_3 ?? 0, totalEntries).toFixed(1)}% đầy đủ catalog`}
          progress={pct(stats?.stage_3 ?? 0, totalEntries)}
        />
        <KpiCard
          icon={<ShieldCheck className="h-5 w-5" />}
          label="Brand canonical"
          value={fmtCount(brandCoverage)}
          hint={`${pct(brandCoverage, totalEntries).toFixed(1)}% coverage`}
          progress={pct(brandCoverage, totalEntries)}
        />
        <KpiCard
          icon={<Users className="h-5 w-5" />}
          label="Khách hàng"
          value={fmtCount(stats?.unique_customers)}
          hint={stats?.top_customers?.[0] ? `Top: ${stats.top_customers[0].customer_name}` : ''}
        />
      </div>

      {/* ─────────── Coverage Strip ─────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
            <Layers className="h-5 w-5 text-slate-600" />
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight text-slate-900">Mức độ hoàn thiện dữ liệu</h3>
            <p className="text-sm text-slate-500">Tỷ lệ entries có dữ liệu cho từng trường chính</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <CoverageBar label="Có giá bán" value={pct(stats?.has_price_count ?? 0, totalEntries)} count={stats?.has_price_count ?? 0} total={totalEntries} icon={<DollarSign className="h-3.5 w-3.5" />} />
          <CoverageBar label="Có NCC" value={pct(stats?.has_supplier_count ?? 0, totalEntries)} count={stats?.has_supplier_count ?? 0} total={totalEntries} icon={<Factory className="h-3.5 w-3.5" />} />
          <CoverageBar label="Có ảnh" value={pct(stats?.has_image_count ?? 0, totalEntries)} count={stats?.has_image_count ?? 0} total={totalEntries} icon={<Package className="h-3.5 w-3.5" />} />
          <CoverageBar label="Có HS code" value={pct(stats?.has_hs_count ?? 0, totalEntries)} count={stats?.has_hs_count ?? 0} total={totalEntries} icon={<FileText className="h-3.5 w-3.5" />} />
        </div>
      </section>

      {/* ─────────── Insights Grid ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <RankCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Top Brand"
          subtitle="5 thương hiệu phổ biến nhất"
          items={(stats?.top_brands ?? []).slice(0, 5).map((b) => ({ label: b.brand_canonical, value: b.entries }))}
          onClickItem={(label) => {
            setFilterBrand(label || '');
            setPage(1);
          }}
        />
        <RankCard
          icon={<Boxes className="h-5 w-5" />}
          title="Top Category"
          subtitle="Phân loại sản phẩm chính"
          items={(stats?.top_categories ?? []).slice(0, 5).map((c) => ({ label: c.catalog_category, value: c.entries }))}
          onClickItem={(label) => {
            setFilterCategory(label || '');
            setPage(1);
          }}
        />
        <RankCard
          icon={<Users className="h-5 w-5" />}
          title="Top Customer"
          subtitle="Khách hỏi nhiều nhất"
          items={(stats?.top_customers ?? []).slice(0, 5).map((c) => ({ label: c.customer_name, value: c.entries }))}
          onClickItem={(label) => {
            setFilterCustomer(label || '');
            setPage(1);
          }}
        />
      </div>

      {/* ─────────── Stage Funnel + Catalog Status ─────────── */}
      {stats && (stats.stage_1 + stats.stage_2 + stats.stage_3 + stats.status_ok + stats.status_needs_brand) > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <BreakdownPanel
            title="Stage funnel"
            subtitle="Tiến độ hoàn thiện qua 3 giai đoạn"
            icon={<Layers className="h-5 w-5" />}
            items={[
              { label: 'Stage 1 — Raw', count: stats.stage_1, badge: 'amber' },
              { label: 'Stage 2 — Enriched', count: stats.stage_2, badge: 'sky' },
              { label: 'Stage 3 — Ready', count: stats.stage_3, badge: 'emerald' },
            ]}
            total={stats.stage_1 + stats.stage_2 + stats.stage_3}
          />
          <BreakdownPanel
            title="Catalog status"
            subtitle="Tình trạng phân loại catalog"
            icon={<ShieldCheck className="h-5 w-5" />}
            items={[
              { label: 'OK', count: stats.status_ok, badge: 'emerald' },
              { label: 'Cần brand', count: stats.status_needs_brand, badge: 'amber' },
              { label: 'Product candidate', count: stats.status_candidate, badge: 'sky' },
              { label: 'Ngoài catalog', count: stats.status_not_in_catalog, badge: 'rose' },
            ]}
            total={stats.status_ok + stats.status_needs_brand + stats.status_not_in_catalog + stats.status_candidate}
          />
        </div>
      )}
      </>
      )}

      {/* ─────────── Filter Bar ─────────── */}
      <section className="sticky top-0 z-20 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur shadow-sm">
        <div className="p-4 flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" aria-hidden="true" />
            {/* ICE UX #6: ARIA label + role=search so screen-readers announce
               this as a search box (icon-only labels don't suffice). */}
            <input
              ref={searchRef}
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
              placeholder="Tìm model / BQMS / sản phẩm / khách / NCC...  (gõ / để focus)"
              aria-label="Tìm sourcing entry — nhấn / để focus nhanh"
              aria-describedby="sourcing-search-hint"
              role="searchbox"
              className="w-full pl-10 pr-9 py-2.5 border border-slate-200 bg-white rounded-lg text-[15px] focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all"
            />
            <span id="sourcing-search-hint" className="sr-only">
              Tìm theo model, mã BQMS, tên sản phẩm, khách hàng hoặc nhà cung cấp
            </span>
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                aria-label="Xoá ô tìm kiếm"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <FilterChip
            label="Catalog"
            icon={<Boxes className="h-3.5 w-3.5" />}
            value={filterCategory}
            onChange={(v) => { setFilterCategory(v); setPage(1); }}
            options={(stats?.top_categories ?? []).map((c) => ({ value: c.catalog_category, label: c.catalog_category, badge: c.entries }))}
          />
          <FilterChip
            label="Brand"
            icon={<Tag className="h-3.5 w-3.5" />}
            value={filterBrand}
            onChange={(v) => { setFilterBrand(v); setPage(1); }}
            options={(stats?.top_brands ?? []).map((b) => ({ value: b.brand_canonical, label: b.brand_canonical, badge: b.entries }))}
          />
          <FilterChip
            label="Stage"
            icon={<Layers className="h-3.5 w-3.5" />}
            value={filterStage}
            onChange={(v) => { setFilterStage(v); setPage(1); }}
            options={[
              { value: '1', label: 'Stage 1 — Raw', badge: stats?.stage_1 },
              { value: '2', label: 'Stage 2 — Enriched', badge: stats?.stage_2 },
              { value: '3', label: 'Stage 3 — Ready', badge: stats?.stage_3 },
            ]}
          />
          <FilterChip
            label="Status"
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            value={filterStatus}
            onChange={(v) => { setFilterStatus(v); setPage(1); }}
            options={[
              { value: 'OK', label: 'OK', badge: stats?.status_ok },
              { value: 'NEEDS_BRAND', label: 'Cần brand', badge: stats?.status_needs_brand },
              { value: 'PRODUCT_CANDIDATE', label: 'Candidate', badge: stats?.status_candidate },
              { value: 'NOT_IN_CATALOG', label: 'Ngoài catalog', badge: stats?.status_not_in_catalog },
            ]}
          />
          <FilterChip
            label="Khách"
            icon={<Users className="h-3.5 w-3.5" />}
            value={filterCustomer}
            onChange={(v) => { setFilterCustomer(v); setPage(1); }}
            options={(stats?.top_customers ?? []).map((c) => ({ value: c.customer_name, label: c.customer_name, badge: c.entries }))}
          />
          <FilterChip
            label="Giá"
            icon={<DollarSign className="h-3.5 w-3.5" />}
            value={filterHasPrice}
            onChange={(v) => { setFilterHasPrice(v as ''); setPage(1); }}
            options={[
              { value: 'true', label: 'Có giá bán' },
              { value: 'false', label: 'Chưa có giá' },
            ]}
          />

          {activeFilterChips.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
              <Filter className="h-3 w-3" />
              {activeFilterChips.length} bộ lọc
            </span>
          )}

          <span className="ml-auto text-sm text-slate-600 font-medium tabular-nums">
            <span className="font-bold text-slate-900">{fmtCount(total)}</span>
            <span className="text-slate-400 ml-2">· trang {page}/{pages}</span>
          </span>

          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="bg-transparent text-sm font-semibold text-slate-700 outline-none"
            >
              <option value="created_at">Ngày tạo</option>
              <option value="updated_at">Ngày sửa</option>
              <option value="inquiry_date">Ngày hỏi giá</option>
              <option value="sale_vnd">Giá bán</option>
              <option value="cost_vnd">Giá nhập</option>
              <option value="model">Model</option>
              <option value="maker">Maker</option>
              <option value="supplier_name">NCC</option>
            </select>
            <button
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              aria-label={`Đổi hướng sắp xếp (đang ${sortDir === 'asc' ? 'tăng dần' : 'giảm dần'})`}
              className="text-slate-500 hover:text-brand-700"
            >
              {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </div>

          {hasActiveFilter && (
            <button onClick={clearFilters} className="inline-flex items-center gap-1 rounded-md px-2.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 ring-1 ring-rose-200">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Xoá lọc
            </button>
          )}
        </div>

        {activeFilterChips.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3" role="list" aria-label="Bộ lọc đang áp dụng">
            {activeFilterChips.map((chip) => (
              <span key={chip.key} role="listitem" className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                <span className="text-slate-500">{chip.label}:</span>
                <span className="font-mono truncate max-w-[140px] text-slate-900">{chip.value}</span>
                <button
                  onClick={() => removeOneFilter(chip.key)}
                  aria-label={`Bỏ lọc ${chip.label}: ${chip.value}`}
                  className="ml-0.5 text-slate-400 hover:text-rose-600"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ─────────── Bulk-action toolbar ─────────── */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-3.5"
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-emerald-600 flex items-center justify-center">
                  <Check className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="text-sm font-bold text-emerald-900">
                    {selectedIds.size} entry đã chọn
                  </div>
                  <div className="text-xs text-emerald-700 tabular-nums">
                    ≈ {fmtMoneyFull(selectedTotalValue)} ₫ tổng giá trị
                  </div>
                </div>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setQuoteBatchIds(Array.from(selectedIds))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 transition-colors shadow-sm"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Tạo báo giá ({selectedIds.size})
                </button>
                {/* V8: gửi các mã đã chọn sang Đấu thầu NCC. */}
                <button
                  onClick={() => setPushBiddingIds(Array.from(selectedIds))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 transition-colors shadow-sm"
                >
                  <Gavel className="h-4 w-4" />
                  Gửi đấu thầu ({selectedIds.size})
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-slate-600 hover:text-rose-600 font-semibold inline-flex items-center gap-1 px-2.5 py-2 rounded-md hover:bg-white"
                >
                  <X className="h-3.5 w-3.5" /> Bỏ chọn
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─────────── Data Table — Full Viewport Width ─────────── */}
      {/*
        Break out of layout's max-w-[1600px] container using negative margin trick.
        calc((100vw - 100%) / 2) gives the half-difference between viewport & container width,
        so -ml/-mr expands edge-to-edge. px-* re-introduces a small breathing gap.
      */}
      {/*
        Note: avoid overflow-hidden on the outer section — it would create a new
        containing block and break <thead className="sticky"> for the table inside.
        The inner <div className="overflow-x-auto"> handles horizontal clip.
      */}
      {/* Căn giữa: bảng nằm TRONG khung max-w-[1600px] đã center của layout, thẳng
          hàng với header + thanh lọc. (Bỏ breakout full-viewport cũ — dưới zoom:0.8
          nó tính lệch nên bảng trông không căn giữa.) Bảng rộng hơn khung sẽ cuộn
          ngang ở cấp <main>. */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm w-full">
        {/* Table toolbar — Column toggle on the right */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50/50">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <FileSpreadsheet className="h-4 w-4 text-slate-500" />
            <span className="font-semibold text-slate-700">Bảng dữ liệu</span>
            <span className="text-slate-400">·</span>
            <span className="tabular-nums">
              {COLUMNS.filter((c) => columnVisibility[c.key]).length}/{COLUMNS.length} cột
            </span>
          </div>
          <ColumnTogglePicker
            columns={COLUMNS}
            visibility={columnVisibility}
            onToggle={toggleColumn}
            onReset={resetColumnsToDefault}
            open={columnPickerOpen}
            setOpen={setColumnPickerOpen}
          />
        </div>

        {listQ.error && (
          <div className="m-5 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Không tải được danh sách sourcing.</p>
          </div>
        )}

        {/*
          Sticky-header strategy: the <thead> below uses position: sticky and
          must resolve its containing block to the page-level scroll context
          (<main> in (dashboard)/layout.tsx). That requires every ancestor up
          to <main> to NOT establish a scroll container — i.e. no overflow:
          hidden / auto / scroll / clip on this div or the section above.
          On narrow screens the wide table will simply overflow horizontally
          and <main> (which has overflow-y-auto; spec resolves overflow-x to
          auto too) will provide horizontal scroll at the page level.
        */}
        {/*
          tableWrapRef is observed by the horizontal-scroll effect; scrolledLeft /
          scrolledRight state drives inline boxShadow on the sticky boundary cells
          (Sản phẩm right-edge / Thao tác left-edge). Wrapper itself must remain
          overflow:visible so the sticky <thead> can resolve against <main>.
        */}
        <div ref={tableWrapRef}>
          {/*
            table-fixed + <colgroup> = widths defined here are RESPECTED by browser
            (table-auto would re-measure per cell content and ignore the col widths).
            Min-width on the <table> ensures small screens scroll horizontally instead of cramping.
          */}
          <table className="w-full min-w-[1232px] table-fixed text-[14px] border-separate border-spacing-0">
            <colgroup>
              {/* Checkbox col — fixed 40px (sticky left) */}
              <col style={{ width: '40px' }} />
              {COLUMNS.filter((c) => columnVisibility[c.key]).map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead className="sticky top-[72px] z-20 bg-slate-50 border-b border-slate-200">
              <tr>
                {/* Checkbox header — sticky left at 0 */}
                <th
                  className="sticky top-[72px] left-0 z-30 p-3 border-b border-slate-200 bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="rounded accent-brand-600 focus:ring-brand-300 cursor-pointer h-4 w-4"
                    checked={items.length > 0 && items.every((i) => selectedIds.has(i.id))}
                    onChange={(e) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) items.forEach((i) => next.add(i.id));
                        else items.forEach((i) => next.delete(i.id));
                        return next;
                      });
                    }}
                  />
                </th>
                {isCol('image') && (
                  <Th className="sticky top-[72px] left-[40px] z-30 border-b border-l border-slate-200 bg-slate-50">Ảnh</Th>
                )}
                {isCol('product') && (
                  <Th
                    sortable
                    sortKey="model"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    className="sticky top-[72px] left-[96px] z-30 border-b border-l border-slate-200 bg-slate-50"
                    style={scrolledLeft ? { boxShadow: 'inset -1px 0 0 #e2e8f0, 4px 0 6px -4px rgba(15,23,42,0.08)' } : undefined}
                  >
                    Sản phẩm
                  </Th>
                )}
                {isCol('customer') && (
                  <Th className="sticky top-[72px] border-b border-l border-slate-200 bg-slate-50">Khách + PT</Th>
                )}
                {isCol('maker') && (
                  <Th className="sticky top-[72px] border-b border-l border-slate-200 bg-slate-50">NSX</Th>
                )}
                {isCol('supplier') && (
                  <Th sortable sortKey="supplier_name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="sticky top-[72px] border-b border-l border-slate-200 bg-slate-50">NCC</Th>
                )}
                {isCol('sale') && (
                  <Th sortable sortKey="sale_vnd" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} align="right" className="sticky top-[72px] border-b border-l border-slate-200 bg-slate-50">Giá</Th>
                )}
                {isCol('catalog') && (
                  <Th className="sticky top-[72px] border-b border-l border-slate-200 bg-slate-50">Catalog</Th>
                )}
                {isCol('category') && (
                  <Th sortable sortKey="inquiry_date" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="sticky top-[72px] border-b border-l border-slate-200 bg-slate-50">Phân loại</Th>
                )}
                {isCol('actions') && (
                  <Th
                    className="sticky top-[72px] right-0 z-30 border-b border-l border-slate-200 bg-slate-50"
                    style={scrolledRight ? { boxShadow: 'inset 1px 0 0 #e2e8f0, -4px 0 6px -4px rgba(15,23,42,0.08)' } : undefined}
                  >
                    <span className="sr-only">Thao tác</span>
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading ? (
                // ICE UX #1: shimmer skeleton rows instead of a single spinner.
                // Preserves table dimensions so the header doesn't reflow when
                // data arrives — eliminates the perceived "jump".
                Array.from({ length: 6 }).map((_, rowIdx) => (
                  <tr key={`skeleton-${rowIdx}`} aria-hidden="true">
                    {Array.from({ length: visibleColCount }).map((__, colIdx) => (
                      <td key={colIdx} className="p-3 border-b border-slate-100">
                        <div className="h-3 w-full rounded bg-slate-100 animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={visibleColCount} className="p-3 py-20">
                    <div className="mx-auto max-w-md space-y-3 text-center">
                      <div className="mx-auto h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center">
                        <Boxes className="h-8 w-8 text-slate-400" />
                      </div>
                      <p className="font-bold text-slate-700 text-base">Chưa có entry sourcing nào khớp</p>
                      <p className="text-sm text-slate-500">Thử điều chỉnh bộ lọc hoặc bấm "Lưu nguồn mới" ở header.</p>
                      <button
                        onClick={() => setIsCreating(true)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 transition-colors"
                      >
                        <PlusCircle className="h-4 w-4" />
                        Tạo entry mới
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((entry) => {
                  const isSelected = selectedIds.has(entry.id);
                  const ce = entry as any;
                  const statusKey = ce.catalog_status as StatusKey | null;
                  const supplierCount = Number(ce.supplier_count ?? ce.suppliers_count ?? 0);
                  const cost = Number(entry.cost_vnd);
                  // A2: prefer showing the primary supplier's typed cost in its
                  // OWN currency (e.g. "100 USD") so the figure matches what the
                  // user entered; fall back to the FX-converted cost_vnd in ₫.
                  const primaryCostAmount = entry.primary_cost_amount;
                  const primaryCostCurrency = entry.primary_cost_currency;
                  const hasPrimaryCost =
                    primaryCostAmount != null &&
                    Number(primaryCostAmount) > 0 &&
                    !!primaryCostCurrency;
                  const costLabel = hasPrimaryCost
                    ? `${fmtMoneyFull(primaryCostAmount)} ${primaryCostCurrency}`
                    : `₫${fmtMoneyFull(entry.cost_vnd)}`;
                  const sale = Number(entry.sale_vnd);
                  const margin = cost > 0 && sale > 0 ? ((sale - cost) / sale) * 100 : null;
                  // Inline margin text color — emerald (>=30) / amber (10..30) / rose (<10)
                  const marginColor = margin == null
                    ? ''
                    : margin >= 30
                      ? 'text-emerald-600'
                      : margin >= 10
                        ? 'text-amber-600'
                        : 'text-rose-600';
                  const stageNum = Number(ce.stage) as 1 | 2 | 3 | 0;
                  // Lowercase short status label per spec ("ok" / "cần brand" / "ứng viên" / "ngoài catalog")
                  const statusLabelLower = statusKey === 'OK' ? 'ok'
                    : statusKey === 'NEEDS_BRAND' ? 'cần brand'
                    : statusKey === 'PRODUCT_CANDIDATE' ? 'ứng viên'
                    : statusKey === 'NOT_IN_CATALOG' ? 'ngoài catalog'
                    : null;

                  return (
                    <tr
                      key={entry.id}
                      onClick={() => openEntryDetail(entry)}
                      className={cn(
                        'group transition-colors duration-100 cursor-pointer',
                        // Hover: subtle slate wash (brand reserved for selected/active per restraint)
                        !isSelected && 'hover:bg-slate-50',
                        // Selection state: brand wash + brand ring
                        isSelected && 'bg-brand-50/70 ring-1 ring-brand-200',
                      )}
                    >
                      {/* Checkbox cell — sticky left at 0, white background to occlude scrolled content */}
                      <td
                        className={cn(
                          'sticky left-0 z-20 p-0 text-center border-b border-slate-100 h-[52px]',
                          isSelected ? 'bg-brand-50/70' : 'bg-white group-hover:bg-slate-50',
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(entry.id)}
                          className="rounded accent-brand-600 focus:ring-brand-300 cursor-pointer h-4 w-4"
                        />
                      </td>

                      {/* Ảnh — sticky left at 40 */}
                      {isCol('image') && (
                        <td
                          className={cn(
                            'sticky left-[40px] z-20 p-2 border-b border-l border-slate-100 h-[52px]',
                            isSelected ? 'bg-brand-50/70' : 'bg-white group-hover:bg-slate-50',
                          )}
                        >
                          {entry.image_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={withToken(entry.image_url)}
                              alt=""
                              className="h-10 w-10 rounded-lg object-cover ring-1 ring-slate-200 bg-slate-50"
                              onError={(e) => ((e.currentTarget.style.display = 'none'))}
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center">
                              <ImageOff className="h-4 w-4 text-slate-400" />
                            </div>
                          )}
                        </td>
                      )}

                      {/* Sản phẩm — sticky left at 96. 3 lines: model / bqms_code / product_name.
                          Hover micro: model translates +2px (120ms) per spec. */}
                      {isCol('product') && (
                        <td
                          className={cn(
                            'sticky left-[96px] z-20 p-3 border-b border-l border-slate-100 h-[52px]',
                            isSelected ? 'bg-brand-50/70' : 'bg-white group-hover:bg-slate-50',
                          )}
                          style={scrolledLeft ? { boxShadow: 'inset -1px 0 0 #e2e8f0, 4px 0 6px -4px rgba(15,23,42,0.08)' } : undefined}
                        >
                          <div className="transition-transform duration-[120ms] ease-out group-hover:translate-x-[2px]">
                            <p className="truncate font-mono text-[14px] font-bold text-slate-900" title={entry.model ?? ''}>
                              {entry.model || ''}
                            </p>
                            {entry.bqms_code && (
                              <p className="truncate font-mono text-[11px] text-slate-500">
                                {entry.bqms_code}
                              </p>
                            )}
                            {entry.product_name && (
                              <p className="truncate text-[12px] text-slate-600" title={entry.product_name}>
                                {entry.product_name}
                              </p>
                            )}
                          </div>
                        </td>
                      )}

                      {/* Khách + PT — 2 lines. customer_id (FK, from Quote Hub) →
                          link tên khách sang trang CRM; nếu chưa gắn FK thì render
                          plain text như cũ (mã sourcing legacy chỉ có text name). */}
                      {isCol('customer') && (
                        <td className="p-3 border-b border-l border-slate-100 h-[52px]">
                          {entry.customer_name ? (
                            ce.customer_id ? (
                              <Link
                                href={`/crm/${ce.customer_id}`}
                                onClick={(e) => e.stopPropagation()}
                                title={`Mở hồ sơ khách: ${entry.customer_name}`}
                                className="block truncate text-[13px] font-medium text-brand-600 hover:text-brand-700 hover:underline"
                              >
                                {entry.customer_name}
                              </Link>
                            ) : (
                              <p className="truncate text-[13px] text-slate-700" title={entry.customer_name}>
                                {entry.customer_name}
                              </p>
                            )
                          ) : (
                            <EmptyDot />
                          )}
                          {ce.person_in_charge && (
                            <p className="truncate font-mono text-[11px] text-brand-600">
                              PT: {ce.person_in_charge}
                            </p>
                          )}
                        </td>
                      )}

                      {/* NSX — maker on line 1; brand_canonical + hs_code hover-reveal on line 2 */}
                      {isCol('maker') && (
                        <td className="p-3 border-b border-l border-slate-100 h-[52px]">
                          {entry.maker ? (
                            <p className="truncate text-[13px] text-slate-700" title={entry.maker}>
                              {entry.maker}
                            </p>
                          ) : (
                            <EmptyDot />
                          )}
                          {(ce.brand_canonical || ce.hs_code) && (
                            <p className="truncate text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                              {[ce.brand_canonical, ce.hs_code].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </td>
                      )}

                      {/* NCC — name + brand GitCompare count badge; empty-state has "+ Thêm" link */}
                      {isCol('supplier') && (
                        <td className="p-3 border-b border-l border-slate-100 h-[52px]">
                          {entry.supplier_name ? (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="truncate text-[13px] text-slate-700 flex-1 min-w-0" title={entry.supplier_name}>
                                {entry.supplier_name}
                              </p>
                              {supplierCount > 0 && entry.bqms_code ? (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setCompareCode(entry.bqms_code as string); }}
                                  aria-label={`So sánh ${supplierCount} nhà cung cấp cho mã ${entry.bqms_code}`}
                                  title="So sánh các NCC cho mã này"
                                  className="inline-flex items-center gap-0.5 rounded-md bg-brand-50 text-brand-700 ring-1 ring-brand-200 px-1.5 py-0.5 text-[11px] font-bold hover:bg-brand-100 transition-colors tabular-nums shrink-0"
                                >
                                  <GitCompare className="h-2.5 w-2.5" aria-hidden="true" />
                                  {supplierCount}
                                </button>
                              ) : supplierCount > 0 ? (
                                <span className="inline-flex items-center rounded-md bg-slate-100 text-slate-600 ring-1 ring-slate-200 px-1.5 py-0.5 text-[11px] font-bold tabular-nums shrink-0">
                                  {supplierCount}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            // Empty state: italic placeholder + brand "+ Thêm" link
                            // (drawer doesn't currently accept initialTab — opens at default; user clicks
                            // the supplier tab once. Limitation noted; do-not-touch drawer per spec.)
                            <div className="flex items-center gap-2">
                              <span className="italic text-[12px] text-slate-400">Chưa có NCC</span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openEntryDetail(entry); }}
                                className="text-[11px] font-semibold text-brand-600 hover:text-brand-800 underline underline-offset-2"
                              >
                                + Thêm
                              </button>
                            </div>
                          )}
                        </td>
                      )}

                      {/* Giá — single line "₫425K +52.9%" with inline tier-colored margin (no pill).
                          Subline: "₫200K cost · ×5" or empty when no sale. */}
                      {isCol('sale') && (
                        <td className="p-3 text-right border-b border-l border-slate-100 h-[52px]">
                          {sale > 0 ? (
                            <>
                              <p className="font-mono tabular-nums whitespace-nowrap">
                                <span className="text-[14px] font-bold text-slate-900">
                                  ₫{fmtMoneyFull(entry.sale_vnd)}
                                </span>
                                {margin != null && (
                                  <span className={cn('ml-1 text-[12px] font-semibold', marginColor)}>
                                    {margin >= 0 ? '+' : ''}{margin.toFixed(1)}%
                                  </span>
                                )}
                              </p>
                              {((cost > 0 || hasPrimaryCost) || (entry.quantity != null && entry.quantity > 1)) && (
                                <p className="font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                                  {(cost > 0 || hasPrimaryCost) && <>{costLabel} cost</>}
                                  {(cost > 0 || hasPrimaryCost) && entry.quantity != null && entry.quantity > 1 && ' · '}
                                  {entry.quantity != null && entry.quantity > 1 && <>×{fmtCount(entry.quantity)}</>}
                                </p>
                              )}
                            </>
                          ) : (
                            <EmptyDot />
                          )}
                        </td>
                      )}

                      {/* Catalog — line 1: 3-dot StageDots + "S{n}"; line 2: dot + lowercase status */}
                      {isCol('catalog') && (
                        <td className="p-3 border-b border-l border-slate-100 h-[52px]">
                          {(stageNum >= 1 && stageNum <= 3) && (
                            <p className="inline-flex items-center gap-1.5">
                              <StageDots stage={stageNum as 1 | 2 | 3} />
                              <span className="text-[11px] font-semibold text-slate-700 tabular-nums">
                                S{stageNum}
                              </span>
                            </p>
                          )}
                          {statusKey && statusLabelLower && (
                            <p className="inline-flex items-center gap-1 text-[11px] text-slate-600 mt-0.5">
                              <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[statusKey])} aria-hidden="true" />
                              <span>· {statusLabelLower}</span>
                            </p>
                          )}
                          {!(stageNum >= 1 && stageNum <= 3) && !statusKey && ''}
                        </td>
                      )}

                      {/* Phân loại — catalog_category chip + inquiry / updated dates */}
                      {isCol('category') && (
                        <td className="p-3 border-b border-l border-slate-100 h-[52px]">
                          {ce.catalog_category && (
                            <span
                              title={ce.catalog_category}
                              className="inline-flex items-center rounded-md bg-brand-50 text-brand-700 px-2 py-0.5 text-[11px] font-semibold max-w-full"
                            >
                              <span className="truncate">{ce.catalog_category}</span>
                            </span>
                          )}
                          {(entry.inquiry_date || entry.updated_at) && (
                            <p className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap mt-0.5">
                              {entry.inquiry_date && <span>{fmtDateShort(entry.inquiry_date)}</span>}
                              {entry.updated_at && (
                                <span className="text-slate-400 text-[11px] ml-1">
                                  sửa {fmtDateShort(entry.updated_at)}
                                </span>
                              )}
                            </p>
                          )}
                        </td>
                      )}

                      {/* Thao tác — sticky right. Default: ChevronRight (opens drawer signal).
                          Row hover: hide chevron, reveal Edit / GitCompare / Trash icons. */}
                      {isCol('actions') && (
                        <td
                          className={cn(
                            'sticky right-0 z-20 p-2 border-b border-l border-slate-100 h-[52px]',
                            isSelected ? 'bg-brand-50/70' : 'bg-white group-hover:bg-slate-50',
                          )}
                          style={scrolledRight ? { boxShadow: 'inset 1px 0 0 #e2e8f0, -4px 0 6px -4px rgba(15,23,42,0.08)' } : undefined}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Default state — chevron visible */}
                          <div className="flex items-center justify-center group-hover:hidden">
                            <ChevronRight className="h-4 w-4 text-brand-500" aria-hidden="true" />
                          </div>
                          {/* Hover state — 3 icons */}
                          <div className="hidden group-hover:flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openEntryDetail(entry); }}
                              title="Sửa entry"
                              aria-label={`Sửa entry ${entry.model || entry.bqms_code || entry.id}`}
                              className="h-7 w-7 rounded-md flex items-center justify-center text-brand-600 hover:bg-brand-50 transition-colors"
                            >
                              <Edit3 className="h-4 w-4" aria-hidden="true" />
                            </button>
                            {entry.bqms_code && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setCompareCode(entry.bqms_code as string); }}
                                title="So sánh NCC"
                                aria-label={`So sánh nhà cung cấp cho mã ${entry.bqms_code}`}
                                className="h-7 w-7 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
                              >
                                <GitCompare className="h-4 w-4" aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Xóa entry này khỏi thư viện?')) {
                                  deleteMutation.mutate(entry.id);
                                }
                              }}
                              title="Xoá entry"
                              aria-label={`Xoá entry ${entry.model || entry.bqms_code || entry.id}`}
                              className="h-7 w-7 rounded-md flex items-center justify-center text-rose-500 hover:bg-rose-50 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              Hiển thị <span className="font-bold tabular-nums">{(page - 1) * pageSize + 1}</span>–
              <span className="font-bold tabular-nums">{Math.min(page * pageSize, total)}</span> trong
              <span className="font-bold tabular-nums"> {fmtCount(total)}</span> entries
            </div>
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="text-sm border-slate-200 rounded-lg bg-white px-3 py-1.5 font-semibold text-slate-700"
              >
                <option value={15}>15/trang</option>
                <option value={30}>30/trang</option>
                <option value={50}>50/trang</option>
                <option value={100}>100/trang</option>
              </select>
              <div className="flex items-center gap-0.5" role="navigation" aria-label="Phân trang">
                <PaginationBtn onClick={() => setPage(1)} disabled={page === 1} ariaLabel="Trang đầu"><ChevronsLeft className="h-4 w-4" aria-hidden="true" /></PaginationBtn>
                <PaginationBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} ariaLabel="Trang trước"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></PaginationBtn>
                <span className="text-sm font-bold tabular-nums px-3 text-slate-700" aria-current="page">Trang {page} / {pages}</span>
                <PaginationBtn onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} ariaLabel="Trang sau"><ChevronRight className="h-4 w-4" aria-hidden="true" /></PaginationBtn>
                <PaginationBtn onClick={() => setPage(pages)} disabled={page === pages} ariaLabel="Trang cuối"><ChevronsRight className="h-4 w-4" aria-hidden="true" /></PaginationBtn>
              </div>
              {pages > 5 && (
                <div className="flex items-center gap-1 text-sm">
                  <span className="text-slate-500">Đến</span>
                  <input
                    type="number"
                    min={1}
                    max={pages}
                    value={jumpPage}
                    onChange={(e) => setJumpPage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const n = Number(jumpPage);
                        if (n >= 1 && n <= pages) setPage(n);
                      }
                    }}
                    className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm tabular-nums font-bold focus:outline-none focus:border-brand-400"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ─────────── Modals / Drawers ─────────── */}
      {(editingEntry || isCreating) && (
        <SourcingFormDrawer
          entry={editingEntry}
          onClose={() => {
            setEditingEntry(null);
            setIsCreating(false);
          }}
          onSaved={handleSaveDone}
          onDelete={
            editingEntry
              ? () => {
                  if (confirm('Xóa entry này khỏi thư viện?')) {
                    deleteMutation.mutate(editingEntry.id, { onSuccess: handleSaveDone });
                  }
                }
              : undefined
          }
        />
      )}

      {importOpen && (
        <SourcingImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            queryClient.invalidateQueries({ queryKey: ['sourcing-stats'] });
            queryClient.invalidateQueries({ queryKey: ['sourcing-list'] });
          }}
        />
      )}

      {bulkLookupOpen && (
        <BulkLookupSourcingModal
          onClose={() => setBulkLookupOpen(false)}
          onForwardToQuote={(ids) => {
            setBulkLookupOpen(false);
            setQuoteBatchIds(ids);
          }}
          onOpenDetail={handleOpenDetailFromBulk}
        />
      )}

      {quoteBatchIds && quoteBatchIds.length > 0 && (
        <QuoteBatchModal
          sourcingIds={quoteBatchIds}
          initialCustomerId={quoteBatchCustomerId ?? undefined}
          onClose={() => setQuoteBatchIds(null)}
          onCreated={() => {
            setQuoteBatchIds(null);
            queryClient.invalidateQueries({ queryKey: ['sourcing-list'] });
          }}
        />
      )}

      {pushBiddingIds && pushBiddingIds.length > 0 && (
        <PushToBiddingModal
          source="catalog"
          ids={pushBiddingIds}
          onClose={() => setPushBiddingIds(null)}
          onDone={() => setSelectedIds(new Set())}
        />
      )}

      <SupplierCompareDrawer bqmsCode={compareCode} onClose={() => setCompareCode(null)} />
    </div>
  );
}

/* ─────────── KPI Card ─────────── */

function KpiCard({
  icon,
  label,
  value,
  hint,
  progress,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  progress?: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all">
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 truncate">{label}</span>
        <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
          {icon}
        </div>
      </div>

      <div className="text-3xl font-bold tabular-nums tracking-tight text-slate-900 leading-none">
        {value}
      </div>

      {hint && (
        <div className="mt-2 text-xs text-slate-500 truncate">{hint}</div>
      )}

      {progress != null && (
        <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      )}
    </div>
  );
}

/* ─────────── Coverage Bar ─────────── */

function CoverageBar({
  label,
  value,
  count,
  total,
  icon,
}: {
  label: string;
  value: number;
  count: number;
  total: number;
  icon: ReactNode;
}) {
  const safe = Math.max(0, Math.min(100, value));
  const color = safe >= 70 ? 'bg-emerald-500'
              : safe >= 40 ? 'bg-sky-500'
                           : 'bg-amber-500';
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
          <span className="text-slate-400">{icon}</span>
          {label}
        </span>
        <span className="font-bold tabular-nums text-slate-900">{safe.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-700', color)} style={{ width: `${safe}%` }} />
      </div>
      <div className="text-xs text-slate-500 tabular-nums">
        {fmtCount(count)} / {fmtCount(total)} entries
      </div>
    </div>
  );
}

/* ─────────── Rank Card ─────────── */

function RankCard({
  icon,
  title,
  subtitle,
  items,
  onClickItem,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  items: { label: string; value: number }[];
  onClickItem?: (label: string) => void;
}) {
  const maxValue = Math.max(1, ...items.map((i) => i.value));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-base font-bold tracking-tight text-slate-900">{title}</div>
          <div className="text-sm text-slate-500">{subtitle}</div>
        </div>
      </div>

      <div className="space-y-1">
        {items.length === 0 && (
          <div className="text-sm text-slate-400 italic py-3 text-center">Chưa có dữ liệu</div>
        )}
        {items.map((item, idx) => {
          const widthPct = (item.value / maxValue) * 100;
          return (
            <button
              key={item.label}
              onClick={() => onClickItem?.(item.label)}
              className="group/row w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-all hover:bg-slate-50"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-700 text-xs font-bold shrink-0 group-hover/row:bg-brand-100 group-hover/row:text-brand-700 transition-colors">
                {idx + 1}
              </span>
              <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800 truncate text-left">{item.label}</span>
              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden sm:block w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-brand-400 transition-all duration-700" style={{ width: `${widthPct}%` }} />
                </div>
                <span className="text-sm font-bold tabular-nums text-slate-900 min-w-[44px] text-right">{fmtCount(item.value)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────── Breakdown Panel ─────────── */

const BADGE_BG: Record<string, string> = {
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
};

function BreakdownPanel({
  title,
  subtitle,
  icon,
  items,
  total,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  items: { label: string; count: number; badge: string }[];
  total: number;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
            {icon}
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500">{subtitle}</p>
          </div>
        </div>
        <span className="text-sm font-semibold text-slate-500 tabular-nums">{fmtCount(total)}</span>
      </div>

      <div className="space-y-3.5">
        {items.map((it) => {
          const pctv = total > 0 ? (it.count / total) * 100 : 0;
          const barColor = BADGE_BG[it.badge] || 'bg-slate-400';
          return (
            <div key={it.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2 font-semibold text-slate-700">
                  <span className={cn('h-2 w-2 rounded-full', barColor)} />
                  {it.label}
                </span>
                <span className="font-bold tabular-nums text-slate-900">
                  {fmtCount(it.count)}
                  <span className="ml-1.5 text-xs text-slate-400">({pctv.toFixed(1)}%)</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={cn('h-full rounded-full transition-all duration-700', barColor)} style={{ width: `${pctv}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────── Filter Chip (popover) ─────────── */

function FilterChip({
  label,
  icon,
  value,
  onChange,
  options,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; badge?: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const isActive = !!value;
  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  const activeLabel = options.find((o) => o.value === value)?.label;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all ring-1',
          isActive
            ? 'bg-brand-50 text-brand-700 ring-brand-200'
            : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
        )}
      >
        {icon}
        {label}
        {isActive && (
          <span className="inline-flex items-center justify-center rounded-md bg-brand-600 text-white text-[11px] px-1.5 py-0.5 ml-1 max-w-[80px] truncate">
            {activeLabel || value}
          </span>
        )}
        <ChevronRight className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1.5 z-40 w-72 rounded-xl border border-slate-200 bg-white shadow-lg p-2">
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Lọc ${label.toLowerCase()}...`}
                className="w-full pl-8 pr-2 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-brand-400"
                autoFocus
              />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-0.5">
              <button
                onClick={() => { onChange(''); setOpen(false); setQuery(''); }}
                className="w-full text-left px-2.5 py-2 text-sm rounded-md hover:bg-slate-100 text-slate-500 font-medium"
              >
                (Tất cả)
              </button>
              {filtered.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false); setQuery(''); }}
                  className={cn(
                    'w-full flex items-center justify-between text-left px-2.5 py-2 text-sm rounded-md hover:bg-slate-100 font-semibold',
                    value === opt.value && 'bg-brand-50 text-brand-700'
                  )}
                >
                  <span className="truncate flex-1">{opt.label}</span>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {opt.badge != null && (
                      <span className="text-xs text-slate-400 tabular-nums">{fmtCount(opt.badge)}</span>
                    )}
                    {value === opt.value && <Check className="h-4 w-4 text-brand-600" />}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="text-center text-sm text-slate-400 py-4">Không có lựa chọn</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────── Table primitives ─────────── */

function Th({
  children,
  sortable,
  sortKey,
  sortBy,
  sortDir,
  onSort,
  align = 'left',
  className,
  style,
}: {
  children?: ReactNode;
  sortable?: boolean;
  sortKey?: SortKey;
  sortBy?: SortKey;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: SortKey) => void;
  align?: 'left' | 'right';
  className?: string;
  style?: CSSProperties;
}) {
  const isSorted = sortable && sortKey && sortBy === sortKey;
  return (
    <th
      className={cn(
        'px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-600',
        align === 'right' ? 'text-right' : 'text-left',
        sortable && 'cursor-pointer hover:text-brand-700 select-none',
        className,
      )}
      style={style}
      onClick={() => sortable && sortKey && onSort?.(sortKey)}
    >
      <span className={cn('inline-flex items-center gap-1.5', align === 'right' && 'justify-end w-full')}>
        {children}
        {sortable && (
          isSorted ? (
            sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-brand-600" /> : <ArrowDown className="h-3.5 w-3.5 text-brand-600" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />
          )
        )}
      </span>
    </th>
  );
}

function PaginationBtn({
  onClick,
  disabled,
  children,
  ariaLabel,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="h-8 w-8 rounded-md border border-slate-200 bg-white text-slate-600 flex items-center justify-center hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-slate-200 transition-colors"
    >
      {children}
    </button>
  );
}

/* ─────────── Column Toggle Picker ─────────── */

function ColumnTogglePicker({
  columns,
  visibility,
  onToggle,
  onReset,
  open,
  setOpen,
}: {
  columns: ColumnDef[];
  visibility: Record<ColumnKey, boolean>;
  onToggle: (key: ColumnKey) => void;
  onReset: () => void;
  open: boolean;
  setOpen: (b: boolean) => void;
}) {
  const visibleCount = columns.filter((c) => visibility[c.key]).length;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
          open
            ? 'border-brand-300 bg-brand-50 text-brand-700'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300',
        )}
      >
        <Columns3 className="h-4 w-4" />
        Hiển thị cột...
        <span className="inline-flex items-center justify-center rounded-md bg-slate-100 text-slate-600 text-[11px] px-1.5 py-0.5 tabular-nums">
          {visibleCount}/{columns.length}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-40 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between p-3 border-b border-slate-100">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Tuỳ chỉnh cột hiển thị</h4>
                <p className="text-xs text-slate-500 mt-0.5">Lưu vào trình duyệt của bạn</p>
              </div>
              <button
                onClick={onReset}
                className="text-xs font-semibold text-brand-700 hover:text-brand-900 hover:underline"
              >
                Mặc định
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-1">
              {columns.map((col) => {
                const isVisible = visibility[col.key];
                const isLocked = col.always;
                return (
                  <button
                    key={col.key}
                    onClick={() => onToggle(col.key)}
                    disabled={isLocked}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                      isLocked ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50',
                    )}
                  >
                    <div
                      className={cn(
                        'h-5 w-5 rounded-md flex items-center justify-center ring-1 shrink-0 transition-colors',
                        isVisible
                          ? 'bg-brand-600 ring-brand-600 text-white'
                          : 'bg-white ring-slate-300 text-transparent',
                      )}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-800 truncate">{col.label}</span>
                        {isLocked && (
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Bắt buộc</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{col.description}</p>
                    </div>
                    {isVisible ? (
                      <Eye className="h-3.5 w-3.5 text-brand-600 shrink-0" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
