'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Search, X, Package, Plus, Save, Loader2,
  CheckCircle2, Download,
  ChevronDown, Columns3, Pencil, ArrowUpDown,
  FileText, Copy, Check, BarChart3, Clipboard, AlertCircle, RefreshCw, ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { XCircle } from 'lucide-react';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
// PR-1 (Thang 2026-05-13): DriverPicker + DriverManagementModal đã extract khỏi file này
import { DriverPicker } from '@/components/bqms-drivers/DriverPicker';
import { DriverManagementModal } from '@/components/bqms-drivers/DriverManagementModal';
import { RevenueDashboardModal } from '@/components/bqms/RevenueDashboardModal';
import { StatusBadge } from '@/components/shared/status-badge';
import { SyncFreshnessChip } from '@/components/shared/sync-freshness-chip';
import { DELIVERY_STATUS_CONFIG } from '@/lib/constants';
import type { DeliveryStatus } from '@/types/models';
import { useIsReadOnly } from '@/hooks/use-permissions';
// Cockpit design tokens / primitives — shared with bqms/page.tsx (Thang 2026-06-25 flatten)
import { BUTTON, KpiCell } from '@/components/cockpit';
import type { BadgeTone } from '@/components/cockpit';

// ─── Types ──────────────────────────────────────────────────────

interface DeliveryRecord {
  id: number;
  po_date?: string;
  po_number?: string;
  shipping_no?: string;
  quotation_no?: string;
  bqms_code?: string;
  // Issue 2 (Thang 2026-06-25): Item Name column — separate from Spec.
  // Backend will populate; may be null for now.
  item_name?: string | null;
  specification?: string;
  // Issue 3 (Thang 2026-06-25): how many shipment rows (distinct shipping_no)
  // collapsed into this (po_number, bqms_code). >1 → show "N đợt giao" badge.
  shipment_count?: number;
  quantity?: number | null;
  unit?: string;
  unit_price?: number | null;
  amount?: number | null;
  sev_type?: string;
  buyer_email?: string;
  recipient_name?: string;
  receiving_warehouse?: string;
  buyer_phone?: string;
  delivery_status?: string;
  delivery_status_normalized?: string;
  delivery_date?: string;
  actual_delivered_qty?: number | null;
  delivery_info?: string;
  delivery_method?: string;
  country_origin?: string;
  total_delivered_value_vnd?: number | null;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  actual_delivered_at?: string;
  // Phase G (Thang 2026-05-13): driver assignment + joined fields
  driver_id?: number | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  driver_license_plate?: string | null;
  driver_vehicle_type?: string | null;
}

interface KPIData {
  total_orders: number;
  delivered_count: number;
  in_transit_count: number;
  pending_count: number;
  total_delivered_vnd: number;
  total_order_value: number;
}

interface ContactRecord {
  id: number;
  email_username: string;
  full_name: string;
  delivery_info?: string;
  phone?: string;
}

// ─── Column Definitions ─────────────────────────────────────────

interface ColDef {
  key: string;
  header: string;
  // '_pending' is a client-computed sentinel (qty - delivered) handled in CellRenderer.
  dbCol: keyof DeliveryRecord | '_pending';
  width: number;
  group: 'A' | 'B' | 'C' | 'D';
  defaultVisible: boolean;
  align?: 'left' | 'right';
  format?: 'date' | 'number' | 'currency' | 'status' | 'text';
}

const COLUMNS: ColDef[] = [
  { key: 'po_number', header: 'Số PO', dbCol: 'po_number', width: 120, group: 'A', defaultVisible: true },
  // Phase Q (Thang 2026-05-20): show P/O Date by default — mirrors the
  // SEC vendor portal column and lets the user spot scraper-lag at a glance.
  { key: 'po_date', header: 'P/O Date', dbCol: 'po_date', width: 95, group: 'A', defaultVisible: true, format: 'date' },
  { key: 'bqms_code', header: 'BQMS Code', dbCol: 'bqms_code', width: 150, group: 'A', defaultVisible: true },
  // Issue 2 (Thang 2026-06-25): Item Name column placed immediately before Spec.
  { key: 'item_name', header: 'Item Name', dbCol: 'item_name', width: 200, group: 'B', defaultVisible: true },
  { key: 'specification', header: 'Spec', dbCol: 'specification', width: 240, group: 'B', defaultVisible: true },
  { key: 'quantity', header: 'SL', dbCol: 'quantity', width: 70, group: 'B', defaultVisible: true, align: 'right', format: 'number' },
  { key: 'unit', header: 'ĐV', dbCol: 'unit', width: 50, group: 'B', defaultVisible: true },
  // Phase R (Thang 2026-05-22): show price + amount by default — most-used
  // financial overview when scanning deliveries; users were forced to open
  // detail panel for every row before.
  { key: 'unit_price', header: 'Đơn giá', dbCol: 'unit_price', width: 100, group: 'B', defaultVisible: true, align: 'right', format: 'currency' },
  { key: 'amount', header: 'Thành tiền', dbCol: 'amount', width: 120, group: 'B', defaultVisible: true, align: 'right', format: 'currency' },
  { key: 'delivery_status', header: 'Trạng thái', dbCol: 'delivery_status', width: 130, group: 'C', defaultVisible: true, format: 'status' },
  { key: 'delivery_date', header: 'Ngày GH', dbCol: 'delivery_date', width: 90, group: 'C', defaultVisible: true, format: 'date' },
  { key: 'actual_delivered_qty', header: 'SL giao TT', dbCol: 'actual_delivered_qty', width: 90, group: 'C', defaultVisible: true, align: 'right', format: 'number' },
  // Pending = quantity - actual_delivered_qty (computed client-side; dbCol='_pending' is a sentinel handled in CellRenderer)
  { key: 'pending_qty', header: 'Pending', dbCol: '_pending', width: 80, group: 'C', defaultVisible: true, align: 'right', format: 'number' },
  { key: 'recipient_name', header: 'Người nhận', dbCol: 'recipient_name', width: 140, group: 'C', defaultVisible: true },
  // Phase R (Thang 2026-05-22): driver_name + license_plate hidden by default —
  // not all deliveries có driver assigned + chiếm chỗ. Vẫn xem được qua
  // Column picker / detail panel.
  { key: 'driver_name', header: 'Người giao', dbCol: 'driver_name', width: 140, group: 'C', defaultVisible: false },
  { key: 'driver_license_plate', header: 'Biển số', dbCol: 'driver_license_plate', width: 100, group: 'C', defaultVisible: false },
  // Phase R (Thang 2026-05-22): default-show Shipping No (key xuất khẩu) +
  // delivery_method (Air/Sea/Land) + receiving_warehouse — info hay reference
  // khi giao hàng.
  { key: 'shipping_no', header: 'Shipping No', dbCol: 'shipping_no', width: 130, group: 'C', defaultVisible: true },
  { key: 'delivery_method', header: 'PT giao hàng', dbCol: 'delivery_method', width: 110, group: 'C', defaultVisible: true },
  { key: 'country_origin', header: 'Xuất xứ', dbCol: 'country_origin', width: 100, group: 'C', defaultVisible: true },
  { key: 'total_delivered_value_vnd', header: 'Tổng GT đã giao', dbCol: 'total_delivered_value_vnd', width: 140, group: 'C', defaultVisible: false, align: 'right', format: 'currency' },
  { key: 'quotation_no', header: 'Số QT', dbCol: 'quotation_no', width: 120, group: 'D', defaultVisible: false },
  { key: 'sev_type', header: 'SEV/T', dbCol: 'sev_type', width: 70, group: 'D', defaultVisible: true },
  { key: 'buyer_email', header: 'Mail PUR', dbCol: 'buyer_email', width: 140, group: 'D', defaultVisible: false },
  { key: 'receiving_warehouse', header: 'Kho nhận', dbCol: 'receiving_warehouse', width: 160, group: 'D', defaultVisible: true },
  { key: 'buyer_phone', header: 'SĐT PUR', dbCol: 'buyer_phone', width: 110, group: 'D', defaultVisible: false },
  { key: 'delivery_info', header: 'TT giao hàng', dbCol: 'delivery_info', width: 160, group: 'D', defaultVisible: false },
];

const DEFAULT_VISIBLE = COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
// v3 bump (Thang 2026-05-22): force refresh after column visibility redesign
// — added price/amount/shipping_no/method/warehouse/sev_type as defaults,
// hid driver_name/license_plate. Without bump, existing users still see
// the old (v2) selection from localStorage.
// v4 bump (Thang 2026-06-25): added Item Name column → force default refresh.
const COL_STORAGE_KEY = 'delivery_columns_v4';

function getVisibleCols(): string[] {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE;
  try {
    // Best-effort cleanup of the old keys so they don't linger forever.
    try { localStorage.removeItem('delivery_columns_v1'); } catch {}
    try { localStorage.removeItem('delivery_columns_v2'); } catch {}
    try { localStorage.removeItem('delivery_columns_v3'); } catch {}
    const saved = localStorage.getItem(COL_STORAGE_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_VISIBLE;
  } catch { return DEFAULT_VISIBLE; }
}

// ─── Status Helpers ─────────────────────────────────────────────

const STATUS_NORM: Record<string, string> = {
  chua_giao: 'pending',
  dang_giao: 'in_transit',
  da_giao: 'delivered',
  hoan_tat: 'completed',
  giao_mot_phan: 'partial',
};

function normalizeStatus(raw?: string): string {
  if (!raw) return 'pending';
  return STATUS_NORM[raw] || raw;
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'pending', label: 'Chưa giao' },
  { value: 'in_transit', label: 'Đang giao' },
  { value: 'delivered', label: 'Đã giao' },
  { value: 'completed', label: 'Hoàn tất' },
];

const MONTHS = [
  { value: '', label: 'Tất cả tháng' },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Tháng ${i + 1}` })),
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => String(CURRENT_YEAR - i));

// ─── Format Helpers ─────────────────────────────────────────────

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  return Number(v).toLocaleString('vi-VN');
}

function fmtVnd(v: number | null | undefined): string {
  if (v == null) return '—';
  const n = Number(v);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return fmtNum(n);
}

// ─── Page Component ─────────────────────────────────────────────

export default function BQMSDeliveriesPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const isReadOnly = useIsReadOnly();
  // Thang 2026-06-01: đọc URL ?po=... + ?year=all để global search bar
  // điều hướng tới đúng PO mà không bị filter năm/tháng che mất.
  const searchParams = useSearchParams();
  const initialPo = searchParams?.get('po') ?? '';
  const initialYearParam = searchParams?.get('year');
  const initialYear =
    initialYearParam === 'all' ? '' :
    (initialYearParam ?? String(CURRENT_YEAR));
  const [activeTab, setActiveTab] = useState<'deliveries' | 'contacts' | 'mro'>('deliveries');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState(initialPo);
  const [month, setMonth] = useState('');
  const [year, setYear] = useState(initialYear);
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<DeliveryRecord | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showDriverManager, setShowDriverManager] = useState(false);
  const [showRevenueDashboard, setShowRevenueDashboard] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_VISIBLE);
  const [showColPicker, setShowColPicker] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Multi-select for "Thống kê xuất xứ" + "Tạo hồ sơ"
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [originSummary, setOriginSummary] = useState<{ bqms_code: string; country_origin: string }[] | null>(null);
  // Thang 2026-06-01: tra cứu giao hàng hàng loạt — paste danh sách BQMS code
  const [bulkLookupOpen, setBulkLookupOpen] = useState(false);
  // "Hồ sơ đã tạo" — list recent dossier jobs to re-open / edit a finished one.
  const [dossierJobsOpen, setDossierJobsOpen] = useState(false);
  // Hide đã giao / hoàn tất rows for cleaner active view
  const [hideCompleted, setHideCompleted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('hide_completed_deliveries') === 'true';
  });

  useEffect(() => { setVisibleCols(getVisibleCols()); }, []);

  const toggleCol = useCallback((key: string) => {
    setVisibleCols(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // ─── Data Queries ───────────────────────────────────────────
  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter !== 'all') p.set('status', statusFilter);
    if (month) p.set('month', month);
    if (year) p.set('year', year);
    // Thang 2026-06-01: forward search xuống backend để tìm theo PO/BQMS/shipping
    // không phụ thuộc paginate (trước đây chỉ filter client-side trên 50 row).
    if (searchQuery) p.set('search', searchQuery);
    return p;
  }, [statusFilter, month, year, searchQuery]);

  const { data: raw, isLoading } = useQuery({
    queryKey: ['deliveries', statusFilter, month, year, searchQuery, page],
    queryFn: () => {
      const p = new URLSearchParams(filterParams);
      p.set('page', String(page));
      p.set('limit', '50');
      return api.get<any>(`/api/v1/bqms/deliveries?${p}`);
    },
    retry: 1,
    refetchInterval: 60_000,            // Poll 60s — keep table fresh as backend sync cron updates DB
    refetchOnWindowFocus: true,
  });

  // KPI intentionally ignores statusFilter — shows overview for the date range
  const { data: kpi } = useQuery({
    queryKey: ['deliveries-kpi', month, year],
    queryFn: () => {
      const p = new URLSearchParams();
      if (month) p.set('month', month);
      if (year) p.set('year', year);
      return api.get<KPIData>(`/api/v1/bqms/deliveries/kpi?${p}`);
    },
    retry: 1,
    refetchInterval: 60_000,            // Poll 60s — keep KPI cards fresh
    refetchOnWindowFocus: true,
  });

  const deliveries: DeliveryRecord[] = raw?.data ?? [];
  const total: number = raw?.total ?? 0;

  // Client-side search filter + hideCompleted toggle
  const filtered = useMemo(() => {
    let rows = deliveries;
    if (hideCompleted) {
      rows = rows.filter(d => {
        const s = (d.delivery_status_normalized || d.delivery_status || '').toLowerCase();
        return s !== 'da_giao' && s !== 'delivered' && s !== 'hoan_tat' && s !== 'completed';
      });
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(d =>
        (d.po_number ?? '').toLowerCase().includes(q) ||
        (d.bqms_code ?? '').toLowerCase().includes(q) ||
        (d.specification ?? '').toLowerCase().includes(q) ||
        (d.shipping_no ?? '').toLowerCase().includes(q) ||
        (d.recipient_name ?? '').toLowerCase().includes(q)
      );
    }
    // Client-side sort
    if (sortCol) {
      const col = COLUMNS.find(c => c.key === sortCol);
      if (col) {
        rows = [...rows].sort((a, b) => {
          const av = (a as any)[col.dbCol];
          const bv = (b as any)[col.dbCol];
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
          return sortDir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return rows;
  }, [deliveries, searchQuery, sortCol, sortDir, hideCompleted]);

  // Detect duplicate po_number / bqms_code in current page so the cell
  // can be tinted. Computed off the SAME `filtered` array so duplicates
  // hidden by filters don't stay highlighted.
  const dupKeys = useMemo(() => {
    const poCount = new Map<string, number>();
    const bqmsCount = new Map<string, number>();
    for (const d of filtered) {
      if (d.po_number) poCount.set(d.po_number, (poCount.get(d.po_number) || 0) + 1);
      if (d.bqms_code) bqmsCount.set(d.bqms_code, (bqmsCount.get(d.bqms_code) || 0) + 1);
    }
    return {
      po: new Set(Array.from(poCount.entries()).filter(([, n]) => n > 1).map(([k]) => k)),
      bqms: new Set(Array.from(bqmsCount.entries()).filter(([, n]) => n > 1).map(([k]) => k)),
    };
  }, [filtered]);

  const activeCols = useMemo(() => COLUMNS.filter(c => visibleCols.includes(c.key)), [visibleCols]);

  const handleSort = (key: string) => {
    if (sortCol === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(key);
      setSortDir('asc');
    }
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams(filterParams);
      const token = localStorage.getItem('access_token') ?? '';
      const res = await fetch(`/api/v1/bqms/deliveries/export?${p}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Giao_hang_${month || 'all'}_${year || 'all'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* toast error */ } finally {
      setExporting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="h-full">
      <div className="min-w-0">
        {/* Header — flattened to match bqms/page.tsx (Thang 2026-06-25) */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-100 rounded-lg">
              <Truck className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <h2 className="text-xl font-display font-bold text-slate-900">
                BQMS — Theo dõi giao hàng
              </h2>
              <div className="flex items-center gap-3 flex-wrap mt-0.5">
                <p className="text-sm text-slate-500">
                  {total.toLocaleString('vi-VN')} đơn
                </p>
                <SyncFreshnessChip module="deliveries" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Per Thang 2026-05-13: Bỏ tab switcher (Giao hàng/Danh bạ/MRO P/O)
                — merge tất cả vào view Giao hàng. Danh bạ + MRO PO tab content
                vẫn tồn tại như component nhưng không expose qua UI. MRO PO
                accessible qua /bqms/mro, Danh bạ embed inline trong từng row. */}
            {true && (
              <>
                <button
                  type="button"
                  onClick={() => setBulkLookupOpen(true)}
                  className={cn(BUTTON.secondary, 'px-3 py-1.5 text-xs')}
                  title="Paste danh sách BQMS code để tra cứu lịch sử giao hàng hàng loạt"
                >
                  <Clipboard className="h-3.5 w-3.5 text-amber-500" />
                  Tra giao hàng hàng loạt
                </button>
                <button
                  onClick={() => {
                    if (selectedIds.size === 0) return;
                    const ids = Array.from(selectedIds).join(',');
                    router.push(`/bqms/deliveries/new-dossier?ids=${ids}`);
                  }}
                  disabled={selectedIds.size === 0}
                  className={cn(
                    BUTTON.secondary, 'px-3 py-1.5 text-xs',
                    selectedIds.size > 0
                      ? 'text-brand-700 ring-brand-200 hover:bg-brand-50'
                      : 'text-slate-400 cursor-not-allowed',
                  )}
                  title={selectedIds.size > 0
                    ? `Tạo hồ sơ giao hàng cho ${selectedIds.size} đơn đã chọn`
                    : 'Tick chọn 1+ đơn ở cột trái để tạo hồ sơ'}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Tạo hồ sơ {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setDossierJobsOpen(true)}
                  className={cn(BUTTON.secondary, 'px-3 py-1.5 text-xs')}
                  title="Mở lại hồ sơ đã tạo để sửa / điền nốt ô trống rồi tạo lại Excel"
                >
                  <FileText className="h-3.5 w-3.5 text-sky-500" />
                  Hồ sơ đã tạo
                </button>
                {selectedIds.size > 0 && (
                  <button
                    onClick={async () => {
                      try {
                        const r = await api.post<{ data: { items: { bqms_code: string; country_origin: string }[] } }>(
                          '/api/v1/bqms/deliveries/origin-summary',
                          { ids: Array.from(selectedIds) }
                        );
                        setOriginSummary(r.data.items);
                      } catch (e) {
                        alert('Không thể thống kê xuất xứ');
                      }
                    }}
                    className={cn(BUTTON.secondary, 'px-3 py-1.5 text-xs')}
                  >
                    <FileText className="h-3.5 w-3.5 text-emerald-500" /> Thống kê xuất xứ
                  </button>
                )}
                {!isReadOnly && (
                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    className={cn(BUTTON.secondary, 'px-3 py-1.5 text-xs')}
                  >
                    {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Xuất Excel
                  </button>
                )}
                <div className="relative">
                  <button
                    onClick={() => setShowColPicker(!showColPicker)}
                    className={cn(BUTTON.secondary, 'px-3 py-1.5 text-xs')}
                  >
                    <Columns3 className="h-3.5 w-3.5" /> Cột <ChevronDown className="h-3 w-3" />
                  </button>
                  {showColPicker && (
                    <ColumnPicker
                      visibleCols={visibleCols}
                      onToggle={toggleCol}
                      onClose={() => setShowColPicker(false)}
                    />
                  )}
                </div>
                <button
                  onClick={() => {
                    const next = !hideCompleted;
                    setHideCompleted(next);
                    localStorage.setItem('hide_completed_deliveries', String(next));
                  }}
                  className={cn(
                    BUTTON.secondary, 'px-3 py-1.5 text-xs',
                    hideCompleted && 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100',
                  )}
                  title="Ẩn các đơn đã giao / hoàn tất khỏi danh sách (vẫn lưu trong DB)"
                >
                  {hideCompleted
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    : <Package className="h-3.5 w-3.5 text-slate-400" />}
                  {hideCompleted ? 'Đang ẩn đã giao' : 'Ẩn đã giao'}
                </button>
                <button
                  onClick={() => setShowRevenueDashboard(true)}
                  className={cn(BUTTON.secondary, 'px-3 py-1.5 text-xs')}
                  title="Dashboard doanh thu PO theo ngày / tháng / người giao / mã PO / BQMS"
                >
                  <BarChart3 className="h-3.5 w-3.5 text-slate-400" /> Thống kê
                </button>
                <button
                  onClick={() => setShowDriverManager(true)}
                  className={cn(BUTTON.secondary, 'px-3 py-1.5 text-xs')}
                  title="Quản lý người giao hàng (CCCD, biển số xe)"
                >
                  <Truck className="h-3.5 w-3.5 text-slate-400" /> Người giao
                </button>
                <button
                  onClick={() => setShowCreateForm(true)}
                  className={cn(BUTTON.primary, 'px-3 py-1.5 text-xs')}
                >
                  <Plus className="h-3.5 w-3.5" /> Tạo mới
                </button>
              </>
            )}
          </div>
        </div>

        {/* Contacts Tab */}
        {activeTab === 'contacts' ? (
          <ContactsTab />
        ) : activeTab === 'mro' ? (
          <MroTab />
        ) : (
          <>
            {/* KPI Cards */}
            {kpi && <KPICards kpi={kpi} />}

            {/* Filter bar */}
            <div className="bg-white rounded-lg border border-slate-200 p-3 mb-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 bg-slate-100 rounded-md p-0.5">
                {STATUS_FILTERS.map(sf => (
                  <button
                    key={sf.value}
                    onClick={() => { setStatusFilter(sf.value); setPage(1); }}
                    className={cn(
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap',
                      statusFilter === sf.value
                        ? 'bg-white text-brand-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    )}
                  >
                    {sf.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <select value={month} onChange={e => { setMonth(e.target.value); setPage(1); }}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                  {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <select value={year} onChange={e => { setYear(e.target.value); setPage(1); }}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">Tất cả năm</option>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Tìm PO, BQMS, spec, shipping, người nhận..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-9 pr-8 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 w-72"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Table — flat design (Thang 2026-06-25): ring shadow, refined header,
                subtle slate hover rows, prominent selected state, plain row numbers */}
            <div className="bg-white rounded-2xl shadow-md shadow-slate-200/40 ring-1 ring-slate-200/80 overflow-hidden">
              {isLoading ? (
                <TableSkeleton cols={activeCols.length} />
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-slate-300">
                  <div className="h-16 w-16 rounded-full bg-slate-50 flex items-center justify-center mb-3 ring-1 ring-slate-100">
                    <Truck className="h-7 w-7 text-slate-300" />
                  </div>
                  <p className="text-sm text-slate-500 font-semibold">
                    {deliveries.length === 0 ? 'Chưa có dữ liệu giao hàng' : 'Không tìm thấy kết quả phù hợp'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {deliveries.length === 0 ? 'Đợi cron scrape hoặc trigger sync manual' : 'Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50 ring-1 ring-slate-200 border-b border-slate-200">
                        <th className="px-3 py-3 w-10 sticky left-0 bg-slate-50 z-10">
                          <input
                            type="checkbox"
                            checked={filtered.length > 0 && filtered.every(d => d.id != null && selectedIds.has(d.id))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds(new Set(filtered.map(d => d.id).filter((x): x is number => x != null)));
                              } else {
                                setSelectedIds(new Set());
                              }
                            }}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            title="Chọn tất cả"
                          />
                        </th>
                        <th className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 px-3 py-3 text-left w-12 sticky left-10 bg-slate-50 z-10">#</th>
                        {activeCols.map(col => {
                          const isSorted = sortCol === col.key;
                          return (
                          <th
                            key={col.key}
                            onClick={() => handleSort(col.key)}
                            className={cn(
                              'group text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 px-3 py-3 whitespace-nowrap cursor-pointer hover:text-slate-700 select-none transition-colors',
                              col.align === 'right' ? 'text-right' : 'text-left',
                              (col.key === 'po_number' || col.key === 'bqms_code') && 'sticky bg-slate-50 z-10',
                              col.key === 'po_number' && 'left-[5.5rem]',
                              col.key === 'bqms_code' && 'left-[calc(5.5rem+120px)]',
                              isSorted && 'text-brand-700',
                            )}
                            style={{ minWidth: col.width }}
                          >
                            <span className={cn('inline-flex items-center gap-1', col.align === 'right' && 'justify-end w-full')}>
                              {col.header}
                              <ArrowUpDown className={cn(
                                'h-3 w-3 transition-all',
                                isSorted ? 'text-brand-500 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100',
                              )} />
                            </span>
                          </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/80">
                      {filtered.map((d, idx) => {
                        const status = normalizeStatus(d.delivery_status_normalized || d.delivery_status);
                        const statusCfg = (DELIVERY_STATUS_CONFIG as any)[status];
                        const isSelected = selectedRow?.id === d.id;
                        const rowNum = (page - 1) * 50 + idx + 1;
                        const qtyMismatch = d.actual_delivered_qty != null && d.quantity != null && d.actual_delivered_qty !== d.quantity;

                        return (
                          <tr
                            key={d.id ?? idx}
                            onClick={() => setSelectedRow(isSelected ? null : d)}
                            className={cn(
                              'group transition-colors cursor-pointer text-sm relative',
                              isSelected
                                ? 'bg-brand-50/60'
                                : 'hover:bg-brand-50/40',
                            )}
                          >
                            {/* Selected-row left accent bar — flat brand (2px) */}
                            {isSelected && (
                              <td className="absolute left-0 top-0 bottom-0 w-0.5 bg-brand-500 z-20 pointer-events-none" />
                            )}
                            <td
                              className={cn(
                                'px-3 py-2.5 sticky left-0 z-10 transition-colors',
                                isSelected ? 'bg-brand-50/60' : 'bg-white group-hover:bg-brand-50/40',
                              )}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={d.id != null && selectedIds.has(d.id)}
                                onChange={(e) => {
                                  if (d.id == null) return;
                                  setSelectedIds(prev => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(d.id!);
                                    else next.delete(d.id!);
                                    return next;
                                  });
                                }}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                              />
                            </td>
                            <td className={cn(
                              'px-3 py-2.5 sticky left-10 z-10 transition-colors',
                              isSelected ? 'bg-brand-50/60' : 'bg-white group-hover:bg-brand-50/40',
                            )}>
                              <span className={cn(
                                'inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-bold tabular-nums',
                                isSelected
                                  ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-200'
                                  : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200',
                              )}>
                                {rowNum}
                              </span>
                            </td>
                            {activeCols.map(col => {
                              const isPoDup = col.key === 'po_number' && d.po_number && dupKeys.po.has(d.po_number);
                              const isBqmsDup = col.key === 'bqms_code' && d.bqms_code && dupKeys.bqms.has(d.bqms_code);
                              const isDup = isPoDup || isBqmsDup;
                              const isStickyCol = col.key === 'po_number' || col.key === 'bqms_code';
                              return (
                              <td
                                key={col.key}
                                className={cn(
                                  'px-3 py-2.5 relative transition-colors',
                                  col.align === 'right' ? 'text-right' : 'text-left',
                                  isStickyCol && 'sticky z-10',
                                  isStickyCol && (isSelected ? 'bg-brand-50/60' : 'bg-white group-hover:bg-brand-50/40'),
                                  col.key === 'po_number' && 'left-[5.5rem]',
                                  col.key === 'bqms_code' && 'left-[calc(5.5rem+120px)]',
                                  col.key === 'actual_delivered_qty' && qtyMismatch && 'bg-amber-50/60',
                                  // Duplicate cell: subtle amber tint instead of harsh box
                                  isDup && 'bg-amber-50/60',
                                )}
                                style={{ minWidth: col.width }}
                                title={isPoDup ? `PO ${d.po_number} xuất hiện nhiều lần` : isBqmsDup ? `BQMS ${d.bqms_code} xuất hiện nhiều lần` : undefined}
                              >
                                {/* Duplicate indicator dot */}
                                {isDup && (
                                  <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-400 ring-2 ring-amber-100" title="Trùng" />
                                )}
                                <CellRenderer col={col} record={d} status={status} statusCfg={statusCfg}
                                  onUpdate={() => {
                                    queryClient.invalidateQueries({ queryKey: ['deliveries'] });
                                    queryClient.invalidateQueries({ queryKey: ['deliveries-kpi'] });
                                  }}
                                />
                              </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer pagination */}
            <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
              <span>
                Hiển thị {filtered.length} / {total.toLocaleString('vi-VN')} đơn giao hàng
                {hideCompleted ? <span className="ml-2 text-emerald-600">· đã ẩn các đơn hoàn tất</span> : null}
              </span>
              {total > 50 && (
                <div className="flex items-center gap-2">
                  <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="px-3 py-1 rounded border border-slate-200 text-xs disabled:opacity-40 hover:bg-slate-50">
                    Trước
                  </button>
                  <span className="text-xs font-mono">Trang {page} / {Math.ceil(total / 50)}</span>
                  <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1 rounded border border-slate-200 text-xs disabled:opacity-40 hover:bg-slate-50">
                    Sau
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Detail panel — right slide-over overlay (Thang 2026-06-25, matches
          BQMS DetailDrawer). Click backdrop or ESC to close. */}
      {selectedRow && activeTab === 'deliveries' && (
        <DetailPanel
          delivery={selectedRow}
          onClose={() => setSelectedRow(null)}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ['deliveries'] });
            queryClient.invalidateQueries({ queryKey: ['deliveries-kpi'] });
          }}
          onOpenDriverManager={() => setShowDriverManager(true)}
        />
      )}

      {/* Driver management modal — Phase G (Thang 2026-05-13) */}
      {showDriverManager && (
        <DriverManagementModal onClose={() => setShowDriverManager(false)} />
      )}

      {/* Revenue dashboard modal */}
      {showRevenueDashboard && (
        <RevenueDashboardModal
          initialMonth={month}
          initialYear={year}
          initialStatus={statusFilter}
          onClose={() => setShowRevenueDashboard(false)}
        />
      )}

      {/* Dossier wizard mở qua /bqms/deliveries/new-dossier?ids=... (full-page route) */}

      {/* Create modal */}
      {showCreateForm && (
        <CreateDeliveryModal
          onClose={() => setShowCreateForm(false)}
          onCreated={() => {
            setShowCreateForm(false);
            queryClient.invalidateQueries({ queryKey: ['deliveries'] });
            queryClient.invalidateQueries({ queryKey: ['deliveries-kpi'] });
          }}
        />
      )}

      {/* Origin summary modal */}
      {originSummary && (
        <OriginSummaryModal
          items={originSummary}
          onClose={() => setOriginSummary(null)}
        />
      )}

      {/* Bulk delivery lookup modal — Thang 2026-06-01 */}
      {bulkLookupOpen && (
        <BulkDeliveryLookupModal onClose={() => setBulkLookupOpen(false)} />
      )}

      {/* "Hồ sơ đã tạo" — recent dossier jobs; "Sửa" re-opens the wizard in edit mode */}
      {dossierJobsOpen && (
        <DossierJobsModal
          onClose={() => setDossierJobsOpen(false)}
          onEdit={(id) => router.push(`/bqms/deliveries/new-dossier?job=${id}`)}
        />
      )}
    </div>
  );
}

// ─── Dossier Jobs Modal (re-open / edit a finished dossier) ─────────

interface DossierJobRow {
  id: number;
  status: string;
  invoice_no?: string | null;
  po_numbers?: string[] | string | null;
  created_at?: string | null;
  output_folder?: string | null;  // absolute onedrive-staging path of the dossier folder
}

function DossierJobsModal({
  onClose,
  onEdit,
}: {
  onClose: () => void;
  onEdit: (id: number) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['dossier-jobs'],
    queryFn: () => api.get<{ data: DossierJobRow[] }>('/api/v1/bqms/deliveries/dossier-jobs?limit=50'),
    retry: 1,
  });
  const jobs = data?.data ?? [];

  // Convert absolute onedrive-staging path → relative path for /documents/browser
  // (mirrors helper in bqms/page.tsx). "/data/onedrive-staging/Puplic/..." → "Puplic/...".
  const toBrowserPath = (absPath: string | null | undefined): string | null => {
    if (!absPath) return null;
    const prefix = '/data/onedrive-staging/';
    if (absPath.startsWith(prefix)) return absPath.slice(prefix.length);
    return absPath.replace(/^\/+/, '');
  };

  const statusPill = (s: string) => {
    const v =
      s === 'done' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : s === 'failed' ? 'bg-rose-50 text-rose-700 ring-rose-200'
      : s === 'cancelled' ? 'bg-slate-100 text-slate-500 ring-slate-200'
      : 'bg-sky-50 text-sky-700 ring-sky-200';
    return (
      <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset', v)}>
        {s === 'done' ? 'Hoàn thành' : s}
      </span>
    );
  };

  const poText = (p: DossierJobRow['po_numbers']) =>
    Array.isArray(p) ? p.join(', ') : (p || '—');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display font-bold text-slate-900">Hồ sơ đã tạo</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mở lại hồ sơ đã hoàn thành để sửa / điền nốt ô trống rồi tạo lại Excel
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Đang tải...
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <FileText className="h-8 w-8 mb-2 text-slate-300" />
              <p className="text-sm">Chưa có hồ sơ nào được tạo</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">#</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Invoice</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">PO</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Trạng thái</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Ngày tạo</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 font-mono text-slate-500">#{j.id}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-800">{j.invoice_no || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 max-w-[180px] truncate" title={poText(j.po_numbers)}>
                      {poText(j.po_numbers)}
                    </td>
                    <td className="px-3 py-2.5">{statusPill(j.status)}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                      {j.created_at
                        ? new Date(j.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {j.status === 'done' ? (
                        <div className="inline-flex items-center gap-1.5">
                          {j.output_folder && (
                            <a
                              href={`/documents/browser?path=${encodeURIComponent(toBrowserPath(j.output_folder) || '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Mở thư mục hồ sơ trong Quản lý tài liệu"
                              className={cn(BUTTON.secondary, 'px-2.5 py-1 text-xs text-emerald-700 ring-emerald-200 hover:bg-emerald-50')}
                            >
                              <ExternalLink className="h-3 w-3" /> Mở thư mục
                            </a>
                          )}
                          <button
                            onClick={() => onEdit(j.id)}
                            className={cn(BUTTON.secondary, 'px-2.5 py-1 text-xs text-brand-700 ring-brand-200 hover:bg-brand-50')}
                          >
                            <Pencil className="h-3 w-3" /> Sửa
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Origin Summary Modal ───────────────────────────────────────

function OriginSummaryModal({
  items,
  onClose,
}: {
  items: { bqms_code: string; country_origin: string }[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = items.map(i => `${i.bqms_code}\t${i.country_origin}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const filled = items.filter(i => i.country_origin).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Thống kê xuất xứ</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {items.length} mã · {filled} có xuất xứ · {items.length - filled} chưa có
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Đã copy' : 'Copy'}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  BQMS code
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Xuất xứ
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-mono text-slate-700">{row.bqms_code}</td>
                  <td className={cn('px-3 py-2', !row.country_origin && 'text-slate-400 italic')}>
                    {row.country_origin || '— chưa có —'}
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

// ─── KPI Cards ──────────────────────────────────────────────────

function KPICards({ kpi }: { kpi: KPIData }) {
  const _t = Number(kpi.total_orders ?? 0);
  const deliveryRate  = _t > 0 ? ((Number(kpi.delivered_count  ?? 0) / _t) * 100).toFixed(1) : '0';
  const inTransitRate = _t > 0 ? ((Number(kpi.in_transit_count ?? 0) / _t) * 100).toFixed(1) : '0';
  const pendingRate   = _t > 0 ? ((Number(kpi.pending_count    ?? 0) / _t) * 100).toFixed(1) : '0';

  // Flat KpiCell tone (one neutral ring + small functional dot) — replaces the
  // border-l-4 rainbow stripes (Thang 2026-06-25). tone drives the calm 5px dot.
  const cards: { label: string; display: string; tone?: BadgeTone }[] = [
    { label: 'Tổng đơn', display: fmtNum(kpi.total_orders) },
    { label: 'Đã giao', display: `${fmtNum(kpi.delivered_count)} · ${deliveryRate}%`, tone: 'emerald' },
    { label: 'Đang giao', display: `${fmtNum(kpi.in_transit_count)} · ${inTransitRate}%`, tone: 'sky' },
    { label: 'Chưa giao', display: `${fmtNum(kpi.pending_count)} · ${pendingRate}%`, tone: 'amber' },
    { label: 'Giá trị đã giao', display: fmtVnd(kpi.total_delivered_vnd) },
  ];

  return (
    <div className="grid grid-cols-5 gap-3 mb-4">
      {cards.map(c => (
        <KpiCell key={c.label} label={c.label} display={c.display} tone={c.tone} />
      ))}
    </div>
  );
}

// ─── Inline editable fields on the table ────────────────────────

const INLINE_EDITABLE: Record<string, 'select' | 'number'> = {
  delivery_status: 'select',
  actual_delivered_qty: 'number',
};

// Thang 2026-05-22: labels match DELIVERY_STATUS_CONFIG so dropdown is
// visually consistent with the badge ("Chờ lấy hàng" everywhere, not mixed
// "Chưa giao" in dropdown vs "Chờ lấy hàng" in badge).
const STATUS_OPTIONS = [
  { value: 'chua_giao', label: 'Chờ lấy hàng' },
  { value: 'dang_giao', label: 'Đang vận chuyển' },
  { value: 'da_giao', label: 'Đã giao' },
  { value: 'hoan_tat', label: 'Hoàn tất' },
];

// ─── Cell Renderer ──────────────────────────────────────────────

function CellRenderer({ col, record, status, statusCfg, onUpdate }: {
  col: ColDef; record: DeliveryRecord; status: string; statusCfg: any;
  onUpdate?: (id: number, field: string, value: any) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');

  // Pending = quantity - actual_delivered_qty (sentinel _pending dbCol).
  // Thang 2026-06-25: EDITABLE — typing a Pending P writes
  // actual_delivered_qty = quantity − P (clamped 0..qty). delivery_status is
  // left unchanged (Thang chose manual status). Requires a non-zero ordered qty
  // (the inverse is undefined otherwise) → read-only when quantity is null/0.
  if (col.dbCol === '_pending') {
    const qty = Number(record.quantity ?? 0);
    const actual = Number(record.actual_delivered_qty ?? 0);
    const pending = qty - actual;
    const canEditPending = !!onUpdate && qty > 0;

    if (editing && canEditPending) {
      return (
        <input
          type="number"
          autoFocus
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              setEditing(false);
              const raw = editVal === '' ? 0 : Number(editVal);
              if (Number.isNaN(raw)) return;
              const p = Math.max(0, Math.min(raw, qty));
              const newActual = qty - p;
              try {
                await api.put(`/api/v1/bqms/deliveries/${record.id}`, { actual_delivered_qty: newActual });
                onUpdate!(record.id, 'actual_delivered_qty', newActual);
              } catch { /* ignore */ }
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={e => e.stopPropagation()}
          className="w-16 px-1 py-0.5 border border-brand-300 rounded text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      );
    }

    let pill: JSX.Element;
    if (pending === 0 && actual > 0) {
      // Fully delivered — green check pill
      pill = (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold ring-1 ring-inset ring-emerald-200/60">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
          0
        </span>
      );
    } else if (pending < 0) {
      // Over-delivered — amber pill
      pill = (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold tabular-nums ring-1 ring-inset ring-amber-200/60" title="Giao quá đơn">
          {pending.toLocaleString('vi-VN')}
        </span>
      );
    } else {
      // Still pending — rose pill
      pill = (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 text-[11px] font-bold tabular-nums ring-1 ring-inset ring-rose-200/60">
          {pending.toLocaleString('vi-VN')}
        </span>
      );
    }

    if (!canEditPending) return pill;
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setEditVal(String(pending)); setEditing(true); }}
        className="cursor-pointer rounded hover:ring-1 hover:ring-brand-300"
        title="Sửa Pending — SL đã giao sẽ tự = SL đặt − Pending"
      >
        {pill}
      </span>
    );
  }

  const value = (record as any)[col.dbCol];

  const editable = INLINE_EDITABLE[col.key];

  // Status — click to open dropdown
  // Thang 2026-05-22: styled select mimics StatusBadge appearance (gradient
  // pill + ring + dot + chevron). Avoids the jarring "raw select dropdown"
  // when one row is being edited next to other rows showing badges.
  if (col.format === 'status' && editable === 'select' && onUpdate) {
    // Map variant → matching pill styles (mirrors VARIANT_STYLES in StatusBadge)
    // Flat fills (Thang 2026-06-25) — mirrors StatusBadge VARIANT_STYLES, no gradients.
    const variantPill: Record<string, { bg: string; text: string; ring: string; dot: string }> = {
      success: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200', dot: 'bg-emerald-500' },
      warning: { bg: 'bg-amber-50', text: 'text-amber-800', ring: 'ring-amber-200', dot: 'bg-amber-500' },
      danger: { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200', dot: 'bg-rose-500' },
      info: { bg: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-sky-200', dot: 'bg-sky-500' },
      neutral: { bg: 'bg-slate-50', text: 'text-slate-600', ring: 'ring-slate-200', dot: 'bg-slate-400' },
    };
    const v = variantPill[statusCfg?.variant || 'neutral'];

    if (editing) {
      return (
        <div className={cn(
          'relative inline-flex items-center gap-1.5 pl-2.5 pr-7 py-0.5 rounded-full ring-1 ring-inset shadow-sm',
          'font-semibold tracking-wide text-[11px]',
          v.bg, v.text, v.ring,
        )}>
          <span className={cn('h-1.5 w-1.5 rounded-full ring-2 ring-white/80', v.dot)} />
          <select
            autoFocus
            value={record.delivery_status ?? 'chua_giao'}
            onChange={async (e) => {
              setEditing(false);
              const newStatus = e.target.value;
              try {
                await api.patch(`/api/v1/bqms/deliveries/${record.id}/status`, { status: newStatus });
                onUpdate(record.id, 'delivery_status', newStatus);
              } catch { /* ignore */ }
            }}
            onBlur={() => setEditing(false)}
            className={cn(
              'appearance-none bg-transparent border-0 outline-none cursor-pointer',
              'font-semibold tracking-wide text-[11px]',
              'pr-1 leading-none focus:outline-none',
              v.text,
            )}
            onClick={e => e.stopPropagation()}
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value} className="text-slate-900 font-normal">
                {o.label}
              </option>
            ))}
          </select>
          {/* Chevron */}
          <ChevronDown className={cn('h-3 w-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none', v.text, 'opacity-60')} />
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className="group inline-flex items-center cursor-pointer transition-transform hover:scale-[1.02]"
        title="Click để sửa trạng thái"
      >
        {statusCfg ? (
          <span className={cn(
            'inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-0.5 rounded-full ring-1 ring-inset shadow-sm',
            'font-semibold tracking-wide text-[11px] whitespace-nowrap',
            v.bg, v.text, v.ring,
          )}>
            <span className="relative flex h-1.5 w-1.5">
              {statusCfg.pulse && (
                <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping [animation-duration:2s]', v.dot, 'opacity-60')} />
              )}
              <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full ring-2 ring-white/80', v.dot)} />
            </span>
            <span className="leading-none">{statusCfg.label}</span>
            <ChevronDown className={cn('h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity', v.text)} />
          </span>
        ) : (
          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{status}</span>
        )}
      </button>
    );
  }

  // Status without edit
  if (col.format === 'status') {
    return statusCfg ? (
      <StatusBadge label={statusCfg.label} variant={statusCfg.variant} pulse={statusCfg.pulse} />
    ) : (
      <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{status}</span>
    );
  }

  // Number — click to edit inline (actual_delivered_qty)
  if (editable === 'number' && onUpdate) {
    if (editing) {
      return (
        <input
          type="number"
          autoFocus
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              setEditing(false);
              const parsed = editVal ? Number(editVal) : null;
              try {
                await api.put(`/api/v1/bqms/deliveries/${record.id}`, { [col.dbCol]: parsed });
                onUpdate(record.id, col.dbCol as string, parsed);
              } catch { /* ignore */ }
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={e => e.stopPropagation()}
          className="w-16 px-1 py-0.5 border border-brand-300 rounded text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      );
    }
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setEditVal(String(value ?? '')); setEditing(true); }}
        className="cursor-pointer hover:ring-1 hover:ring-brand-300 rounded px-0.5 text-xs text-slate-700 font-mono"
        title="Click để sửa"
      >
        {value != null ? fmtNum(Number(value)) : '—'}
      </span>
    );
  }

  if (col.format === 'date') {
    if (!value) return <span className="text-slate-500">—</span>;
    return (
      <span className="text-xs text-slate-600 font-mono tabular-nums tracking-tight">
        {formatDate(value)}
      </span>
    );
  }

  if (col.format === 'currency') {
    if (value == null) return <span className="text-slate-500">—</span>;
    return (
      <span className="text-xs text-slate-800 font-mono tabular-nums font-medium">
        {fmtNum(Number(value))}
        <span className="text-[11px] text-slate-400 ml-0.5 font-sans">₫</span>
      </span>
    );
  }

  if (col.format === 'number') {
    if (value == null) return <span className="text-slate-500">—</span>;
    return (
      <span className="text-xs text-slate-800 font-mono tabular-nums font-medium">
        {fmtNum(Number(value))}
        {col.key === 'quantity' && record.unit ? (
          <span className="text-[11px] text-slate-400 ml-1 font-sans uppercase">{record.unit}</span>
        ) : null}
      </span>
    );
  }

  // PO number — clickable-styled link with hover effect
  if (col.key === 'po_number') {
    if (!value) return <span className="text-slate-500">—</span>;
    return (
      <span className="inline-flex items-center font-mono text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline decoration-brand-400 underline-offset-2 transition-colors">
        {value}
      </span>
    );
  }

  // BQMS code — monospace pill with subtle bg. Issue 3: when this PO line was
  // delivered in multiple shipments (shipment_count > 1), show a "N đợt giao"
  // badge — the list shows only the latest shipment, full history in the panel.
  if (col.key === 'bqms_code') {
    if (!value) return <span className="text-slate-500">—</span>;
    const ship = record.shipment_count ?? 1;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center font-mono text-[11px] font-semibold text-brand-700 bg-brand-50/60 px-2 py-0.5 rounded-md ring-1 ring-inset ring-brand-100">
          {value}
        </span>
        {ship > 1 && (
          <span
            title={`${ship} đợt giao (hiển thị đợt mới nhất)`}
            className="inline-flex items-center font-medium text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded ring-1 ring-inset ring-amber-200"
          >
            {ship} đợt
          </span>
        )}
      </span>
    );
  }

  // Item Name (Issue 2 — Thang 2026-06-25): own column, truncated text.
  if (col.key === 'item_name') {
    return (
      <div className="max-w-[200px]">
        <p className="text-xs text-slate-700 truncate font-medium" title={value ?? ''}>{value || <span className="text-slate-500">—</span>}</p>
      </div>
    );
  }

  if (col.key === 'specification') {
    return (
      <div className="max-w-[240px]">
        <p className="text-xs text-slate-700 truncate font-medium" title={value ?? ''}>{value || <span className="text-slate-500">—</span>}</p>
      </div>
    );
  }

  // Shipping No — mono badge
  if (col.key === 'shipping_no') {
    if (!value) return <span className="text-slate-500">—</span>;
    return (
      <span className="font-mono text-[11px] text-cyan-700 bg-cyan-50/60 px-1.5 py-0.5 rounded ring-1 ring-inset ring-cyan-100">
        {value}
      </span>
    );
  }

  // Delivery method (Air/Sea/Land/Road) — small pill
  if (col.key === 'delivery_method') {
    if (!value) return <span className="text-slate-500">—</span>;
    return (
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
        {value}
      </span>
    );
  }

  // SEV / SEVT chip
  if (col.key === 'sev_type') {
    if (!value) return <span className="text-slate-500">—</span>;
    const isVN = String(value).toUpperCase().includes('SEVT');
    return (
      <span className={cn(
        'text-[11px] font-bold tracking-wider px-2 py-0.5 rounded-full ring-1 ring-inset',
        isVN
          ? 'bg-brand-50 text-brand-700 ring-brand-200'
          : 'bg-sky-50 text-sky-700 ring-sky-200',
      )}>
        {value}
      </span>
    );
  }

  // Country origin emoji + text
  if (col.key === 'country_origin') {
    if (!value) return <span className="text-slate-500">—</span>;
    return (
      <span className="text-xs text-slate-700 font-medium whitespace-nowrap">
        🌐 {value}
      </span>
    );
  }

  // Recipient — avatar initial + name
  if (col.key === 'recipient_name') {
    if (!value) return <span className="text-slate-500">—</span>;
    const initial = String(value).trim().charAt(0).toUpperCase() || '?';
    return (
      <span className="inline-flex items-center gap-2 max-w-[160px]">
        <span className="h-5 w-5 rounded-full bg-brand-500 text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white shadow-sm shrink-0">
          {initial}
        </span>
        <span className="text-xs text-slate-700 font-medium truncate" title={value}>{value}</span>
      </span>
    );
  }

  // Email — clickable mailto link
  if (col.key === 'buyer_email' && value) {
    return (
      <a
        href={`mailto:${value}`}
        onClick={(e) => e.stopPropagation()}
        className="text-xs text-sky-700 hover:text-sky-800 hover:underline truncate inline-block max-w-[180px]"
        title={value}
      >
        {value}
      </a>
    );
  }

  // Phone — clickable tel link with phone icon
  if (col.key === 'buyer_phone' && value) {
    return (
      <a
        href={`tel:${value}`}
        onClick={(e) => e.stopPropagation()}
        className="text-xs text-slate-700 font-mono hover:text-brand-700 hover:underline"
      >
        {value}
      </a>
    );
  }

  if (value == null || value === '') {
    return <span className="text-slate-500">—</span>;
  }
  return <span className="text-xs text-slate-700 truncate block max-w-[180px] font-medium" title={value}>{value}</span>;
}

// ─── Column Picker ──────────────────────────────────────────────

function ColumnPicker({ visibleCols, onToggle, onClose }: {
  visibleCols: string[]; onToggle: (key: string) => void; onClose: () => void;
}) {
  const groups = [
    { label: 'Định danh', group: 'A' as const },
    { label: 'Sản phẩm', group: 'B' as const },
    { label: 'Giao hàng', group: 'C' as const },
    { label: 'Liên hệ & Quản trị', group: 'D' as const },
  ];

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-slate-200 z-30 py-2 max-h-[400px] overflow-y-auto">
        <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase">Cột hiển thị</div>
        {groups.map(g => (
          <div key={g.group}>
            <div className="px-3 py-1 text-[11px] font-semibold text-slate-300 uppercase tracking-wider">{g.label}</div>
            {COLUMNS.filter(c => c.group === g.group).map(col => (
              <label key={col.key} className="flex items-center gap-2 px-3 py-1 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleCols.includes(col.key)}
                  onChange={() => onToggle(col.key)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 h-3.5 w-3.5"
                />
                <span className="text-xs text-slate-600">{col.header}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Detail Panel ───────────────────────────────────────────────

function DetailPanel({ delivery, onClose, onChanged, onOpenDriverManager }: {
  delivery: DeliveryRecord; onClose: () => void; onChanged: () => void;
  onOpenDriverManager: () => void;
}) {
  const status = normalizeStatus(delivery.delivery_status_normalized || delivery.delivery_status);
  const statusCfg = (DELIVERY_STATUS_CONFIG as any)[status];
  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ESC to close — copied from bqms/page.tsx DetailDrawer (Thang 2026-06-25).
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSaveField = async (field: string, value: string) => {
    setSaving(true);
    setSaveError('');
    try {
      let parsed: any = value;
      if (['actual_delivered_qty', 'total_delivered_value_vnd'].includes(field)) {
        parsed = value ? Number(value) : null;
      }
      await api.put(`/api/v1/bqms/deliveries/${delivery.id}`, { [field]: parsed });
      setEditField(null);
      onChanged();
    } catch (err: any) {
      setSaveError(err?.detail ?? 'Lỗi lưu, vui lòng thử lại');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (field: string, currentValue: any) => {
    setEditField(field);
    setEditValue(currentValue ?? '');
  };

  // Status lifecycle steps
  const statusSteps = ['pending', 'in_transit', 'delivered', 'completed'];
  const currentStepIdx = statusSteps.indexOf(status);

  // Pending = qty - actual delivered
  const qty = Number(delivery.quantity ?? 0);
  const actual = Number(delivery.actual_delivered_qty ?? 0);
  const pending = qty - actual;
  const pendingPct = qty > 0 ? Math.round((actual / qty) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />

      {/* Panel */}
      <div
        className="relative h-full w-full max-w-2xl lg:max-w-4xl bg-white overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
      {/* ── Header band — single brand gradient, copied VERBATIM from
          bqms/page.tsx DetailDrawer (the ONLY gradient allowed). ── */}
      <div className="sticky top-0 z-10 bg-gradient-to-br from-brand-600 to-brand-700 text-white px-5 py-4 shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/70 font-bold mb-1.5">
              <Truck className="h-3 w-3" />
              Chi tiết giao hàng
            </div>
            <div className="font-mono text-[11px] text-white/80">PO #{delivery.po_number || '—'}</div>
            <div className="font-mono text-xl font-bold leading-tight tracking-tight mt-0.5 break-words">
              {delivery.bqms_code || 'Không có BQMS code'}
            </div>
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              {statusCfg ? (
                <StatusBadge label={statusCfg.label} variant={statusCfg.variant} pulse={statusCfg.pulse} size="md" />
              ) : (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-semibold ring-1 ring-white/25">
                  {status || 'Chưa rõ'}
                </span>
              )}
              {delivery.country_origin ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 text-[11px] font-semibold ring-1 ring-white/15">
                  🌐 {delivery.country_origin}
                </span>
              ) : null}
              {delivery.sev_type ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 text-[11px] font-semibold ring-1 ring-white/15">
                  {delivery.sev_type}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 text-[11px] font-semibold ring-1 ring-white/15 tabular-nums">
                Tiến độ {pendingPct}%
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white" title="Đóng (ESC)">
            <XCircle className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* ── Horizontal status stepper ── */}
      <div className="px-5 py-4 bg-white border-b border-slate-100">
        <div className="flex items-center justify-between gap-1">
          {[
            { key: 'pending', label: 'Chưa giao' },
            { key: 'in_transit', label: 'Đang giao' },
            { key: 'delivered', label: 'Đã giao' },
            { key: 'completed', label: 'Hoàn tất' },
          ].map((step, i, arr) => {
            const reached = i <= currentStepIdx;
            const current = i === currentStepIdx;
            const isLast = i === arr.length - 1;
            return (
              <div key={step.key} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div
                    className={cn(
                      'h-7 w-7 rounded-full flex items-center justify-center transition-all',
                      reached
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-400 ring-1 ring-slate-200',
                      current && 'ring-4 ring-brand-100 scale-110',
                    )}
                  >
                    {reached ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <span className="text-[11px] font-bold">{i + 1}</span>}
                  </div>
                  <span className={cn(
                    'text-[11px] font-bold uppercase tracking-wider whitespace-nowrap',
                    reached ? 'text-slate-700' : 'text-slate-400',
                  )}>
                    {step.label}
                  </span>
                </div>
                {!isLast && (
                  <div className="flex-1 h-0.5 mx-1 mb-4 rounded-full overflow-hidden bg-slate-200">
                    <div className={cn(
                      'h-full transition-all duration-500',
                      i < currentStepIdx ? 'bg-brand-600 w-full' : 'w-0',
                    )} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── KPI mini cards: 4-col layout (Thang 2026-05-22: added Thành tiền) ── */}
      <div className="grid grid-cols-4 gap-px bg-slate-100 border-b border-slate-200">
        <KpiMini label="Số lượng" value={qty.toLocaleString('vi-VN')} unit={delivery.unit || ''} accent="slate" />
        <KpiMini
          label="Đã giao"
          value={actual.toLocaleString('vi-VN')}
          unit={delivery.unit || ''}
          accent="emerald"
        />
        {/* Pending tile is EDITABLE (Thang 2026-06-25): setting Pending writes
            actual_delivered_qty = qty − Pending; status left unchanged. */}
        <EditablePendingTile
          qty={qty}
          actual={actual}
          unit={delivery.unit || ''}
          onSave={handleSaveField}
          saving={saving}
        />
        <KpiMini
          label="Thành tiền"
          value={delivery.amount != null
            ? new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 })
                .format(Number(delivery.amount))
            : '—'}
          unit="₫"
          accent="sky"
        />
      </div>

      <div className="p-5 space-y-4">
        {/* ── ENHANCEMENT P4 (Thang LOCKED 2026-06-25): full shipment history.
            The list view dedups to the latest shipment per (po_number, bqms_code);
            here we surface ALL shipments when this line had >1. Read-only. ── */}
        {(delivery.shipment_count ?? 1) > 1 && delivery.po_number && delivery.bqms_code ? (
          <ShipmentHistorySection
            poNumber={delivery.po_number}
            bqmsCode={delivery.bqms_code}
            shipmentCount={delivery.shipment_count ?? 1}
            unit={delivery.unit}
          />
        ) : null}

        {/* ── 2-col grid layout (Thang 2026-05-22) ── */}
        <div className="grid grid-cols-2 gap-3">
          {/* Sản phẩm */}
          <DetailSectionCard icon={<Package className="h-3.5 w-3.5" />} title="Sản phẩm">
            <DetailRow label="BQMS Code" value={delivery.bqms_code} mono />
            {/* Issue 2 (Thang 2026-06-25): Item Name shown separately from Spec. */}
            <DetailRow label="Item Name" value={delivery.item_name} />
            <DetailRow
              label="Đơn giá"
              value={delivery.unit_price != null ? fmtNum(Number(delivery.unit_price)) : null}
              mono
            />
            <DetailRow
              label="Thành tiền"
              value={delivery.amount != null ? formatCurrency(Number(delivery.amount)) : null}
              mono
            />
            <DetailRow label="Đơn vị" value={delivery.unit} />
          </DetailSectionCard>

          {/* Thông tin PO */}
          <DetailSectionCard icon={<FileText className="h-3.5 w-3.5" />} title="Thông tin PO">
            <DetailRow label="Ngày PO" value={formatDate(delivery.po_date)} />
            <DetailRow label="Số QT" value={delivery.quotation_no} mono />
            <DetailRow label="Shipping No" value={delivery.shipping_no} mono />
            <DetailRow label="SEV/T" value={delivery.sev_type} />
          </DetailSectionCard>
        </div>

        {/* Spec (full-width — usually long text) */}
        {delivery.specification ? (
          <DetailSectionCard icon={<Pencil className="h-3.5 w-3.5" />} title="Specification">
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
              {delivery.specification}
            </p>
          </DetailSectionCard>
        ) : null}

        {/* Giao hàng + Liên hệ — 2-col */}
        <div className="grid grid-cols-2 gap-3">
          <DetailSectionCard icon={<Truck className="h-3.5 w-3.5" />} title="Giao hàng">
            <EditableRow label="Ngày GH" field="delivery_date" value={formatDate(delivery.delivery_date)}
              rawValue={delivery.delivery_date?.split('T')[0] ?? ''} editField={editField} editValue={editValue}
              saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} type="date" />
            <EditableRow label="SL giao TT" field="actual_delivered_qty"
              value={delivery.actual_delivered_qty != null ? fmtNum(delivery.actual_delivered_qty) : '—'}
              rawValue={String(delivery.actual_delivered_qty ?? '')} editField={editField} editValue={editValue}
              saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} type="number" />
            <EditableRow label="PT giao" field="delivery_method" value={delivery.delivery_method ?? '—'}
              rawValue={delivery.delivery_method ?? ''} editField={editField} editValue={editValue}
              saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} />
            <EditableRow label="Xuất xứ" field="country_origin" value={delivery.country_origin ?? '—'}
              rawValue={delivery.country_origin ?? ''} editField={editField} editValue={editValue}
              saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} />
            <DetailRow
              label="Tổng GT"
              value={delivery.total_delivered_value_vnd != null ? formatCurrency(Number(delivery.total_delivered_value_vnd)) : null}
              mono
            />
          </DetailSectionCard>

          <DetailSectionCard icon={<Search className="h-3.5 w-3.5" />} title="Liên hệ">
            <EditableRow label="Người nhận" field="recipient_name" value={delivery.recipient_name ?? '—'}
              rawValue={delivery.recipient_name ?? ''} editField={editField} editValue={editValue}
              saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} />
            <EditableRow label="Kho nhận" field="receiving_warehouse" value={delivery.receiving_warehouse ?? '—'}
              rawValue={delivery.receiving_warehouse ?? ''} editField={editField} editValue={editValue}
              saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} />
            <EditableRow label="Mail PUR" field="buyer_email" value={delivery.buyer_email ?? '—'}
              rawValue={delivery.buyer_email ?? ''} editField={editField} editValue={editValue}
              saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} type="email" />
            <EditableRow label="SĐT PUR" field="buyer_phone" value={delivery.buyer_phone ?? '—'}
              rawValue={delivery.buyer_phone ?? ''} editField={editField} editValue={editValue}
              saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} />
          </DetailSectionCard>
        </div>

        {/* Delivery info (full-width — usually long text) */}
        {delivery.delivery_info ? (
          <DetailSectionCard icon={<Truck className="h-3.5 w-3.5" />} title="Thông tin giao hàng">
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
              {delivery.delivery_info}
            </p>
          </DetailSectionCard>
        ) : null}

        {/* Driver picker (full-width) */}
        <DriverPicker delivery={delivery} onChanged={onChanged} onOpenManager={onOpenDriverManager} />

        {/* Notes */}
        {delivery.notes ? (
          <DetailSectionCard icon={<Pencil className="h-3.5 w-3.5" />} title="Ghi chú">
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{delivery.notes}</p>
          </DetailSectionCard>
        ) : null}

        {saveError ? (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-rose-500 flex-shrink-0" />
            <span>{saveError}</span>
          </div>
        ) : null}

        {/* Status change buttons */}
        <StatusChangeButtons deliveryId={delivery.id} currentStatus={status} onChanged={onChanged} />
      </div>
      </div>
    </div>
  );
}

// ── ENHANCEMENT P4 (Thang LOCKED 2026-06-25): shipment history section ──
// Read-only. Fetches ALL bqms_deliveries rows for one (po_number, bqms_code)
// pair (latest-first) and renders a compact flat table. Only mounted when the
// selected line collapsed >1 shipment.
interface ShipmentRow {
  id: number;
  shipping_no?: string | null;
  delivery_date?: string | null;
  actual_delivered_at?: string | null;
  actual_delivered_qty?: number | null;
  quantity?: number | null;
  delivery_status?: string | null;
  delivery_status_normalized?: string | null;
  total_delivered_value_vnd?: number | null;
  data_source?: string | null;
}

function ShipmentHistorySection({ poNumber, bqmsCode, shipmentCount, unit }: {
  poNumber: string; bqmsCode: string; shipmentCount: number; unit?: string;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['delivery-shipments', poNumber, bqmsCode],
    queryFn: () => api.get<{ data: ShipmentRow[] }>(
      `/api/v1/bqms/deliveries/shipments?po_number=${encodeURIComponent(poNumber)}&bqms_code=${encodeURIComponent(bqmsCode)}`,
    ),
    staleTime: 60_000,
  });

  const rows = data?.data ?? [];

  return (
    <DetailSectionCard
      icon={<Truck className="h-3.5 w-3.5" />}
      title={`Lịch sử đợt giao · ${shipmentCount} đợt`}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Đang tải lịch sử đợt giao…
        </div>
      ) : isError ? (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5">
          Không tải được lịch sử đợt giao.
        </div>
      ) : rows.length === 0 ? (
        <div className="py-3 text-xs text-slate-400 text-center">Chưa có đợt giao nào.</div>
      ) : (
        <div className="-mx-3 -my-2.5 divide-y divide-slate-100">
          {rows.map((s, i) => {
            const st = normalizeStatus(s.delivery_status_normalized || s.delivery_status || undefined);
            const cfg = (DELIVERY_STATUS_CONFIG as any)[st];
            const qty = s.actual_delivered_qty ?? s.quantity;
            return (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2">
                <span className="text-[11px] font-bold text-slate-300 tabular-nums w-5 shrink-0">
                  #{rows.length - i}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-semibold text-slate-800 truncate">
                    {s.shipping_no || '—'}
                  </div>
                  <div className="text-[11px] text-slate-400">{formatDate(s.delivery_date) || '—'}</div>
                </div>
                <div className="text-xs tabular-nums text-slate-700 font-medium shrink-0 text-right">
                  {fmtNum(qty)}
                  {unit ? <span className="text-[11px] text-slate-400 ml-0.5">{unit}</span> : null}
                </div>
                <div className="shrink-0">
                  {cfg ? (
                    <StatusBadge label={cfg.label} variant={cfg.variant} pulse={cfg.pulse} />
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                      {st || '—'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DetailSectionCard>
  );
}

function KpiMini({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent: 'slate' | 'emerald' | 'rose' | 'amber' | 'sky' }) {
  // Flat BADGE tones (Thang 2026-06-25) — no gradients.
  const styles = {
    slate: 'bg-white text-slate-900',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
    sky: 'bg-sky-50 text-sky-700',
  } as const;
  return (
    <div className={cn('p-3 text-center', styles[accent])}>
      <div className="text-[11px] uppercase tracking-[0.12em] font-bold opacity-70">{label}</div>
      <div className="mt-1 font-bold tabular-nums leading-tight">
        <span className="text-lg">{value}</span>
        {unit ? <span className="text-[11px] ml-1 opacity-70 font-semibold">{unit}</span> : null}
      </div>
    </div>
  );
}

// Editable "Pending" tile (Thang 2026-06-25). Pending stays derived; editing it
// writes actual_delivered_qty = quantity − clamp(Pending, 0, quantity) via the
// same PUT used by other inline edits. delivery_status is NOT changed (manual).
// Read-only when quantity is null/0 (the inverse is undefined).
function EditablePendingTile({ qty, actual, unit, onSave, saving }: {
  qty: number; actual: number; unit?: string;
  onSave: (field: string, value: string) => void | Promise<void>;
  saving?: boolean;
}) {
  const pending = qty - actual;
  const accent: 'emerald' | 'rose' | 'amber' = pending === 0 && actual > 0 ? 'emerald' : pending > 0 ? 'rose' : 'amber';
  const styles = {
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
  } as const;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const canEdit = qty > 0;

  const commit = () => {
    setEditing(false);
    const raw = val === '' ? 0 : Number(val);
    if (Number.isNaN(raw)) return;
    const p = Math.max(0, Math.min(raw, qty));
    onSave('actual_delivered_qty', String(qty - p));
  };

  return (
    <div className={cn('p-3 text-center', styles[accent])}>
      <div className="text-[11px] uppercase tracking-[0.12em] font-bold opacity-70">Pending</div>
      {editing && canEdit ? (
        <input
          type="number"
          autoFocus
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className="mt-1 w-16 mx-auto block px-1 py-0.5 border border-slate-300 rounded text-center text-sm font-bold tabular-nums bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      ) : (
        <button
          type="button"
          disabled={!canEdit || saving}
          onClick={() => { setVal(String(pending)); setEditing(true); }}
          className={cn('mt-1 font-bold tabular-nums leading-tight', canEdit && 'cursor-pointer hover:underline decoration-dotted underline-offset-2')}
          title={canEdit ? 'Sửa Pending — SL đã giao sẽ tự = SL đặt − Pending' : undefined}
        >
          <span className="text-lg">{pending.toLocaleString('vi-VN')}</span>
          {unit ? <span className="text-[11px] ml-1 opacity-70 font-semibold">{unit}</span> : null}
        </button>
      )}
    </div>
  );
}

function DetailSectionCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  // Flat card matching BQMS DetailDrawer sections (Thang 2026-06-25).
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="px-3 py-2 border-b border-slate-100 bg-white flex items-center gap-1.5">
        <span className="text-slate-400">{icon}</span>
        <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-slate-600">{title}</span>
      </div>
      <div className="px-3 py-2.5 space-y-1.5">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold shrink-0">{label}</span>
      <span className={cn(
        'text-xs text-right text-slate-800 font-medium truncate',
        mono && 'font-mono',
      )} title={value ?? '—'}>{value ?? '—'}</span>
    </div>
  );
}

function EditableRow({ label, field, value, rawValue, editField, editValue, saving, onStartEdit, onSave, onSetValue, type = 'text' }: {
  label: string; field: string; value: string; rawValue: string;
  editField: string | null; editValue: string; saving: boolean;
  onStartEdit: (f: string, v: string) => void; onSave: (f: string, v: string) => void;
  onSetValue: (v: string) => void; type?: string;
}) {
  if (editField === field) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold shrink-0">{label}</span>
        <input
          type={type}
          value={editValue}
          onChange={e => onSetValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onSave(field, editValue);
            if (e.key === 'Escape') {
              // Cancel only the field edit — stop the panel's window-level
              // ESC listener (~1363) from also closing the slide-over.
              e.stopPropagation();
              e.preventDefault();
              onStartEdit(null as any, '');
            }
          }}
          autoFocus
          className="flex-1 px-1.5 py-0.5 border border-brand-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 min-w-0"
        />
        <button onClick={() => onSave(field, editValue)} disabled={saving}
          className="text-brand-600 hover:text-brand-800 shrink-0">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        </button>
      </div>
    );
  }

  // Phase G (Thang 2026-05-13): click toàn dòng để edit + pencil luôn hiện
  // (trước pencil ẩn cho tới khi hover → user không biết edit được).
  return (
    <button
      type="button"
      onClick={() => onStartEdit(field, rawValue)}
      className="w-full flex justify-between items-baseline gap-2 group rounded px-1 -mx-1 py-0.5 hover:bg-brand-50/60 transition-colors text-left"
      title={`Click để chỉnh sửa ${label}`}
    >
      <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold shrink-0">{label}</span>
      <span className="flex items-center gap-1 text-xs text-slate-800 font-medium truncate min-w-0">
        <span className="truncate" title={value}>{value}</span>
        <Pencil className="h-2.5 w-2.5 text-slate-300 group-hover:text-brand-500 transition-colors shrink-0" />
      </span>
    </button>
  );
}


// ─── Status Change Buttons ──────────────────────────────────────

function StatusChangeButtons({ deliveryId, currentStatus, onChanged }: {
  deliveryId: number; currentStatus: string; onChanged: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  // KEEP keys (picked_up / customs_clearance etc.) so all transitions still
  // fire. Dropped the per-transition `color` gradient map (Thang 2026-06-25).
  const TRANSITIONS: Record<string, { next: string; label: string }[]> = {
    pending: [{ next: 'in_transit', label: 'Bắt đầu giao' }],
    picked_up: [{ next: 'in_transit', label: 'Đang vận chuyển' }],
    in_transit: [
      { next: 'customs_clearance', label: 'Thông quan' },
      { next: 'delivered', label: 'Đã giao' },
    ],
    customs_clearance: [{ next: 'delivered', label: 'Đã giao' }],
    delivered: [{ next: 'completed', label: 'Hoàn tất' }],
  };

  const transitions = TRANSITIONS[currentStatus] || [];
  if (transitions.length === 0) return null;

  const handleChange = async (nextStatus: string) => {
    setUpdating(true);
    setError('');
    try {
      await api.patch(`/api/v1/bqms/deliveries/${deliveryId}/status`, { status: nextStatus });
      onChanged();
    } catch (err: any) {
      setError(err?.detail ?? 'Lỗi cập nhật trạng thái');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-slate-600 flex items-center gap-1.5">
        <ArrowUpDown className="h-3 w-3 text-slate-400" />
        Chuyển trạng thái
      </p>
      <div className="flex flex-wrap gap-2">
        {transitions.map((t, i) => {
          // Last transition = the forward "advance" action → primary; rest secondary.
          const isPrimary = i === transitions.length - 1;
          return (
            <button key={t.next} onClick={() => handleChange(t.next)} disabled={updating}
              className={cn(isPrimary ? BUTTON.primary : BUTTON.secondary, 'px-3.5 py-2 text-[11px]')}>
              {updating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {t.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1">{error}</p>
      )}
    </div>
  );
}

// ─── Create Delivery Modal ──────────────────────────────────────

function CreateDeliveryModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    po_number: '', bqms_code: '', specification: '', quantity: '',
    unit: 'EA', unit_price: '', delivery_status: 'chua_giao',
    delivery_date: '', shipping_no: '', recipient_name: '',
    delivery_method: '', sev_type: '', buyer_email: '',
    buyer_phone: '', receiving_warehouse: '', country_origin: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Contacts for autocomplete
  const { data: contactsData } = useQuery({
    queryKey: ['bqms', 'contacts'],
    queryFn: () => api.get<any>('/api/v1/bqms/contacts'),
    staleTime: 10 * 60 * 1000,
  });
  const contacts: ContactRecord[] = contactsData?.data ?? [];
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredContacts = useMemo(() => {
    if (!form.recipient_name || form.recipient_name.length < 2) return [];
    const q = form.recipient_name.toLowerCase();
    return contacts.filter(c =>
      c.full_name.toLowerCase().includes(q) || c.email_username.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [form.recipient_name, contacts]);

  const selectContact = (c: ContactRecord) => {
    setForm(f => ({
      ...f,
      recipient_name: c.full_name,
      buyer_email: c.email_username,
      buyer_phone: c.phone ?? f.buyer_phone,
      receiving_warehouse: c.delivery_info ?? f.receiving_warehouse,
    }));
    setShowSuggestions(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post('/api/v1/bqms/deliveries', {
        ...form,
        quantity: form.quantity ? Number(form.quantity) : null,
        unit_price: form.unit_price ? Number(form.unit_price) : null,
        delivery_date: form.delivery_date || null,
      });
      onCreated();
    } catch (err: any) {
      setError(err?.detail ?? 'Lỗi tạo đơn giao hàng');
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, name, type = 'text', required = false }: { label: string; name: string; type?: string; required?: boolean }) => (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      <input type={type} value={(form as any)[name]}
        onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
        className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[600px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Tạo đơn giao hàng mới</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mã PO" name="po_number" required />
            <Field label="Mã BQMS" name="bqms_code" required />
          </div>
          <Field label="Sản phẩm / Spec" name="specification" required />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Số lượng" name="quantity" type="number" />
            <Field label="Đơn vị" name="unit" />
            <Field label="Đơn giá" name="unit_price" type="number" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ngày giao" name="delivery_date" type="date" />
            <Field label="Mã vận đơn" name="shipping_no" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* Recipient with autocomplete */}
            <div className="relative">
              <label className="text-xs text-slate-500 block mb-1">Người nhận</label>
              <input
                type="text"
                value={form.recipient_name}
                onChange={e => { setForm(f => ({ ...f, recipient_name: e.target.value })); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {showSuggestions && filteredContacts.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  {filteredContacts.map(c => (
                    <button key={c.id} onClick={() => selectContact(c)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                      <p className="text-sm text-slate-700 font-medium">{c.full_name}</p>
                      <p className="text-xs text-slate-500">{c.email_username} · {c.phone ?? ''}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Field label="Phương thức giao" name="delivery_method" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="SEV/T" name="sev_type" />
            <Field label="Email PUR" name="buyer_email" />
            <Field label="SĐT PUR" name="buyer_phone" />
          </div>
          <Field label="Xuất xứ" name="country_origin" />
          <div>
            <label className="text-xs text-slate-500 block mb-1">Trạng thái</label>
            <select value={form.delivery_status}
              onChange={e => setForm(f => ({ ...f, delivery_status: e.target.value }))}
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="chua_giao">Chưa giao</option>
              <option value="dang_giao">Đang giao</option>
              <option value="da_giao">Đã giao</option>
              <option value="hoan_tat">Hoàn tất</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Ghi chú</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          {error && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">Hủy</button>
          <button onClick={handleSave} disabled={saving || !form.po_number || !form.bqms_code || !form.specification}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Tạo đơn
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MRO Tab — list MRO P/O Receipt staging (module='po') ──────────────
// Per Thang 2026-05-11: surface MRO scrape data here next to deliveries.

function MroTab() {
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState<'all' | 'pending_review' | 'merged'>('all');

  const { data: raw, isLoading, refetch } = useQuery({
    queryKey: ['bqms-mro', search, statusF],
    queryFn: () => {
      const q = new URLSearchParams({ page: '1', page_size: '200' });
      if (statusF !== 'all') q.set('status', statusF);
      if (search.trim()) q.set('search', search.trim());
      return api.get<{ data: { items: any[]; total: number } }>(
        `/api/v1/bqms/staging/mro?${q.toString()}`,
      );
    },
    staleTime: 60 * 1000,
  });

  const items = raw?.data?.items ?? [];
  const total = raw?.data?.total ?? 0;

  const fmtN = (n: any) => n == null || n === '' ? '—' :
    new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0));
  const fmtD = (s?: string) => {
    if (!s) return '—';
    if (/^\d{8}$/.test(s)) return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`;
    return s;
  };

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm RFQ, Item code, spec..."
          className="flex-1 min-w-[260px] px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
          {(['all', 'pending_review', 'merged'] as const).map(v => (
            <button key={v} onClick={() => setStatusF(v)}
              className={cn(
                'px-3 py-1.5 rounded-md transition-all',
                statusF === v ? 'bg-white shadow-sm text-brand-700' : 'text-slate-500',
              )}>
              {v === 'all' ? 'Tất cả' : v === 'pending_review' ? 'Chờ duyệt' : 'Đã merge'}
            </button>
          ))}
        </div>
        <button onClick={() => refetch()} disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          <Loader2 className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          Refresh
        </button>
        <span className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{total}</span> đơn MRO
        </span>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-100 text-slate-600 uppercase text-[11px] font-bold">
              <tr>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">PO No</th>
                <th className="px-2 py-2 text-left">RFQ</th>
                <th className="px-2 py-2 text-left">Item Code</th>
                <th className="px-2 py-2 text-left">Spec</th>
                <th className="px-2 py-2 text-left">Maker</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Đơn giá</th>
                <th className="px-2 py-2 text-right">Tổng</th>
                <th className="px-2 py-2 text-left">Plant</th>
                <th className="px-2 py-2 text-left">Receiver</th>
                <th className="px-2 py-2 text-left">Delivery</th>
                <th className="px-2 py-2 text-left">Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-500">Đang tải...</td></tr>
              )}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-500">Chưa có dữ liệu MRO. Chạy scraper để lấy.</td></tr>
              )}
              {items.map((it: any) => (
                <tr key={it.id} className="hover:bg-brand-50/40">
                  <td className="px-2 py-1.5">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded-full text-[11px] font-bold',
                      it.po_status === 'PO Approved' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-slate-100 text-slate-600',
                    )}>{it.po_status || it.status}</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono">{it.po_no || '—'}</td>
                  <td className="px-2 py-1.5 font-mono text-emerald-700">{it.rfq_number || '—'}</td>
                  <td className="px-2 py-1.5 font-mono">{it.item_code || '—'}</td>
                  <td className="px-2 py-1.5 max-w-[260px] truncate" title={it.specification || ''}>{it.specification || '—'}</td>
                  <td className="px-2 py-1.5 truncate max-w-[140px]" title={it.manufacturer || ''}>{it.manufacturer || '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtN(it.po_qty)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtN(it.buying_price)}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-semibold text-brand-700">{fmtN(it.buying_amount)}</td>
                  <td className="px-2 py-1.5 truncate max-w-[140px]" title={it.plant || ''}>{it.plant || '—'}</td>
                  <td className="px-2 py-1.5 truncate max-w-[140px]" title={it.receiver || ''}>{it.receiver || '—'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtD(it.req_delivery_date)}</td>
                  <td className="px-2 py-1.5 truncate max-w-[200px] text-slate-500" title={it.delivery_address || ''}>{it.delivery_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Contacts Tab ───────────────────────────────────────────────

function ContactsTab() {
  const [search, setSearch] = useState('');

  const { data: raw, isLoading } = useQuery({
    queryKey: ['bqms', 'contacts'],
    queryFn: () => api.get<any>('/api/v1/bqms/contacts'),
    staleTime: 10 * 60 * 1000,
  });

  const contacts: ContactRecord[] = raw?.data ?? [];

  const filtered = useMemo(() => {
    if (!search) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(c =>
      c.full_name.toLowerCase().includes(q) ||
      c.email_username.toLowerCase().includes(q) ||
      (c.phone ?? '').includes(q) ||
      (c.delivery_info ?? '').toLowerCase().includes(q)
    );
  }, [contacts, search]);

  return (
    <div>
      {/* Search */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm tên, email, SĐT..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <TableSkeleton cols={4} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-300">
            <Package className="h-12 w-12 mb-3" />
            <p className="text-sm text-slate-500 font-medium">Không tìm thấy danh bạ</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="text-xs font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5 text-left w-10">#</th>
                  <th className="text-xs font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5 text-left">Mail</th>
                  <th className="text-xs font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5 text-left">Tên</th>
                  <th className="text-xs font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5 text-left">Thông tin giao hàng</th>
                  <th className="text-xs font-mono uppercase tracking-wider text-slate-500 px-4 py-2.5 text-left">SĐT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c, idx) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{idx + 1}</td>
                    <td className="px-4 py-2.5 text-sm text-brand-600 font-mono">{c.email_username}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-700 font-medium">{c.full_name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600 max-w-[400px]">
                      <p className="whitespace-pre-wrap break-words">{c.delivery_info ?? '—'}</p>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-slate-600 font-mono">{c.phone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 text-sm text-slate-500">
        Hiển thị {filtered.length} / {contacts.length} danh bạ
      </div>
    </div>
  );
}

// ─── Table Skeleton ─────────────────────────────────────────────

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          {Array.from({ length: Math.min(cols, 8) }).map((_, j) => (
            <div key={j} className={cn(
              'h-4 bg-slate-200 rounded animate-pulse',
              j === 0 ? 'w-10' : j === 3 ? 'flex-1' : 'w-24'
            )} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Bulk Delivery Lookup Modal — Thang 2026-06-01 ───────────────
//
// User paste danh sách BQMS code → backend trả về toàn bộ delivery rows + summary
// per code. Pattern y hệt BulkHsLookupModal ở /bqms/won-quotations.

type BulkDeliveryItem = {
  id: number;
  po_number: string | null;
  po_date: string | null;
  bqms_code: string | null;
  specification: string | null;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
  actual_delivered_qty: number | null;
  shipping_no: string | null;
  delivery_date: string | null;
  delivery_status: string | null;
  delivery_status_normalized: string | null;
  sev_type: string | null;
  country_origin: string | null;
  recipient_name: string | null;
  receiving_warehouse: string | null;
  delivery_method: string | null;
  quotation_no: string | null;
  total_delivered_value_vnd: number | null;
};

type BulkDeliverySummary = {
  bqms_code: string;
  count: number;
  total_quantity: number;
  total_delivered_qty: number;
  remaining_qty: number;
  last_delivery_date: string | null;
  last_shipping_no: string | null;
  latest_status: string | null;
  po_numbers: string[];
  found: boolean;
};

function BulkDeliveryLookupModal({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('');
  const [items, setItems] = useState<BulkDeliveryItem[]>([]);
  const [summary, setSummary] = useState<BulkDeliverySummary[]>([]);
  const [foundCount, setFoundCount] = useState(0);
  const [missingCount, setMissingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'summary' | 'rows'>('summary');

  const handleLookup = async () => {
    const codes = input
      .split(/[\n,;\t]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (codes.length === 0) {
      toast.error('Hãy paste danh sách BQMS code (1 mã/dòng)');
      return;
    }
    if (codes.length > 200) {
      toast.error(`Tối đa 200 mã/lần (đang có ${codes.length})`);
      return;
    }
    setLoading(true);
    try {
      const r = await api.post<{
        data: {
          items: BulkDeliveryItem[];
          summary: BulkDeliverySummary[];
          found_count: number;
          missing_count: number;
          total_rows: number;
        };
      }>('/api/v1/bqms/deliveries/bulk-lookup', { codes });
      setItems(r.data.items);
      setSummary(r.data.summary);
      setFoundCount(r.data.found_count);
      setMissingCount(r.data.missing_count);
      toast.success(
        `Tra cứu xong: ${r.data.found_count}/${codes.length} mã có giao hàng (${r.data.total_rows} dòng)`,
      );
    } catch (e: any) {
      toast.error(`Tra cứu lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  const copySummary = () => {
    const header = ['BQMS Code', 'Số đơn', 'Tổng SL', 'Đã giao', 'Còn lại', 'Lần giao cuối', 'Shipping No', 'Trạng thái', 'PO list'].join('\t');
    const body = summary.map((s) => [
      s.bqms_code,
      s.count,
      s.total_quantity,
      s.total_delivered_qty,
      s.remaining_qty,
      s.last_delivery_date ?? '',
      s.last_shipping_no ?? '',
      s.latest_status ?? '',
      s.po_numbers.join(', '),
    ].join('\t')).join('\n');
    navigator.clipboard.writeText(header + '\n' + body).then(() => toast.success(`Đã copy ${summary.length} dòng (TSV)`));
  };

  const copyRows = () => {
    const header = ['BQMS Code', 'PO Number', 'PO Date', 'Spec', 'Qty', 'Unit', 'Unit Price', 'Amount', 'Delivered', 'Shipping No', 'Delivery Date', 'Status', 'SEV', 'Origin'].join('\t');
    const body = items.map((it) => [
      it.bqms_code ?? '', it.po_number ?? '', it.po_date ?? '', it.specification ?? '',
      it.quantity ?? '', it.unit ?? '', it.unit_price ?? '', it.amount ?? '',
      it.actual_delivered_qty ?? '', it.shipping_no ?? '', it.delivery_date ?? '',
      it.delivery_status ?? '', it.sev_type ?? '', it.country_origin ?? '',
    ].join('\t')).join('\n');
    navigator.clipboard.writeText(header + '\n' + body).then(() => toast.success(`Đã copy ${items.length} dòng (TSV)`));
  };

  const fmtNum = (n: number | null | undefined) => n != null && !isNaN(n) ? n.toLocaleString('vi-VN') : '—';
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-brand-100 ring-1 ring-brand-200 flex items-center justify-center">
              <Clipboard className="h-4 w-4 text-brand-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">Tra cứu giao hàng hàng loạt</h3>
              <p className="text-[11px] text-slate-500 font-medium">Paste danh sách BQMS code → xem lịch sử giao hàng</p>
            </div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Input area */}
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Danh sách BQMS code (1 mã/dòng, tối đa 200)
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={6}
              placeholder={"Ví dụ:\nZ0000002-385323\nZ0000002-385111\nZ0000002-385223\n... hoặc paste cả 1 cột BQMS code từ Excel"}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 ring-1 ring-slate-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-300"
            />
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <button
                onClick={handleLookup}
                disabled={loading || !input.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold disabled:opacity-50 shadow-sm shadow-amber-500/30 transition-all"
              >
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Tra cứu
              </button>
              {summary.length > 0 && (
                <>
                  <div className="inline-flex rounded-lg bg-slate-100/70 ring-1 ring-slate-200 p-0.5 text-xs">
                    {(['summary', 'rows'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        className={cn(
                          'px-3 py-1.5 rounded-md font-semibold transition-all',
                          view === v ? 'bg-white text-amber-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800',
                        )}
                      >
                        {v === 'summary' ? `Tổng hợp (${summary.length})` : `Chi tiết (${items.length})`}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={view === 'summary' ? copySummary : copyRows}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold ring-1 ring-slate-200"
                  >
                    <Clipboard className="h-3.5 w-3.5" />Copy {view === 'summary' ? 'tổng hợp' : 'chi tiết'} (TSV)
                  </button>
                  <div className="text-xs text-slate-600 ml-auto">
                    <span className="text-emerald-700 font-bold">{foundCount}</span> có giao ·{' '}
                    <span className="text-rose-700 font-bold">{missingCount}</span> chưa giao
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Summary view */}
          {summary.length > 0 && view === 'summary' && (
            <div className="border border-slate-200 ring-1 ring-slate-100 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-[11px] uppercase tracking-wider font-bold text-slate-600">
                  <tr>
                    <th className="px-2.5 py-2 text-left">BQMS Code</th>
                    <th className="px-2.5 py-2 text-right">Số đơn</th>
                    <th className="px-2.5 py-2 text-right">Tổng SL</th>
                    <th className="px-2.5 py-2 text-right">Đã giao</th>
                    <th className="px-2.5 py-2 text-right">Còn lại</th>
                    <th className="px-2.5 py-2 text-left">Giao cuối</th>
                    <th className="px-2.5 py-2 text-left">Shipping No</th>
                    <th className="px-2.5 py-2 text-left">Trạng thái</th>
                    <th className="px-2.5 py-2 text-left">PO</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s, i) => (
                    <tr key={i} className={cn(
                      'border-b border-slate-50 last:border-0 transition-colors',
                      s.found ? 'hover:bg-slate-50/70' : 'bg-rose-50/40 hover:bg-rose-50/70',
                    )}>
                      <td className="px-2.5 py-2 font-mono font-bold text-slate-800">{s.bqms_code}</td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                        {s.found ? (
                          <span className="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-700 font-bold">
                            {s.count}
                          </span>
                        ) : <span className="text-rose-500 italic font-normal">—</span>}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-700">{s.found ? fmtNum(s.total_quantity) : '—'}</td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums text-emerald-700 font-semibold">{s.found ? fmtNum(s.total_delivered_qty) : '—'}</td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums">
                        {s.found ? (
                          <span className={cn('font-bold', s.remaining_qty > 0 ? 'text-amber-700' : 'text-emerald-700')}>
                            {fmtNum(s.remaining_qty)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-2.5 py-2 text-slate-600 whitespace-nowrap">{fmtDate(s.last_delivery_date)}</td>
                      <td className="px-2.5 py-2 font-mono text-cyan-700 font-semibold">{s.last_shipping_no ?? <span className="text-slate-500">—</span>}</td>
                      <td className="px-2.5 py-2">
                        {s.latest_status ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700">
                            {s.latest_status}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700">
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> Chưa giao
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-2 max-w-[180px] truncate font-mono text-slate-600" title={s.po_numbers.join(', ')}>
                        {s.po_numbers.length > 0 ? s.po_numbers.join(', ') : <span className="text-slate-500">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Detail rows view */}
          {items.length > 0 && view === 'rows' && (
            <div className="border border-slate-200 ring-1 ring-slate-100 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-[11px] uppercase tracking-wider font-bold text-slate-600">
                  <tr>
                    <th className="px-2 py-2 text-left">BQMS Code</th>
                    <th className="px-2 py-2 text-left">PO</th>
                    <th className="px-2 py-2 text-left">PO Date</th>
                    <th className="px-2 py-2 text-left max-w-[180px]">Spec</th>
                    <th className="px-2 py-2 text-right">SL</th>
                    <th className="px-2 py-2 text-right">Đã giao</th>
                    <th className="px-2 py-2 text-left">Shipping No</th>
                    <th className="px-2 py-2 text-left">Delivery Date</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">SEV</th>
                    <th className="px-2 py-2 text-left">Origin</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 transition-colors">
                      <td className="px-2 py-1.5 font-mono font-semibold text-slate-800">{it.bqms_code}</td>
                      <td className="px-2 py-1.5 font-mono text-slate-700">{it.po_number}</td>
                      <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{fmtDate(it.po_date)}</td>
                      <td className="px-2 py-1.5 max-w-[200px] truncate" title={it.specification ?? ''}>
                        {it.specification ?? <span className="text-slate-500">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtNum(it.quantity)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-emerald-700">{fmtNum(it.actual_delivered_qty)}</td>
                      <td className="px-2 py-1.5 font-mono text-cyan-700 font-semibold">{it.shipping_no ?? <span className="text-slate-500">—</span>}</td>
                      <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{fmtDate(it.delivery_date)}</td>
                      <td className="px-2 py-1.5">
                        {it.delivery_status ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700">
                            {it.delivery_status}
                          </span>
                        ) : <span className="text-slate-500">—</span>}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-brand-700">{it.sev_type ?? <span className="text-slate-500">—</span>}</td>
                      <td className="px-2 py-1.5 text-slate-600">{it.country_origin ?? <span className="text-slate-500">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 text-xs text-slate-600 flex items-center justify-between">
          <span>💡 Mẹo: "Tổng hợp" gọn cho thống kê; "Chi tiết" hiển từng dòng PO/lần giao. Bấm Copy để paste sang Excel.</span>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold">Đóng</button>
        </div>
      </div>
    </div>
  );
}
