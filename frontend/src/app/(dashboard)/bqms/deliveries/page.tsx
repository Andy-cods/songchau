'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Search, X, Package, Plus, Save, Loader2,
  CheckCircle2, Clock, DollarSign, Download,
  ChevronDown, Columns3, Pencil, ArrowUpDown,
  FileText, Copy, Check, BarChart3,
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

// ─── Types ──────────────────────────────────────────────────────

interface DeliveryRecord {
  id: number;
  po_date?: string;
  po_number?: string;
  shipping_no?: string;
  quotation_no?: string;
  bqms_code?: string;
  specification?: string;
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
  dbCol: keyof DeliveryRecord;
  width: number;
  group: 'A' | 'B' | 'C' | 'D';
  defaultVisible: boolean;
  align?: 'left' | 'right';
  format?: 'date' | 'number' | 'currency' | 'status' | 'text';
}

const COLUMNS: ColDef[] = [
  { key: 'po_number', header: 'Số PO', dbCol: 'po_number', width: 120, group: 'A', defaultVisible: true },
  { key: 'bqms_code', header: 'BQMS Code', dbCol: 'bqms_code', width: 150, group: 'A', defaultVisible: true },
  { key: 'specification', header: 'Spec', dbCol: 'specification', width: 200, group: 'B', defaultVisible: true },
  { key: 'quantity', header: 'SL', dbCol: 'quantity', width: 70, group: 'B', defaultVisible: true, align: 'right', format: 'number' },
  { key: 'unit', header: 'ĐV', dbCol: 'unit', width: 50, group: 'B', defaultVisible: true },
  { key: 'unit_price', header: 'Đơn giá', dbCol: 'unit_price', width: 100, group: 'B', defaultVisible: false, align: 'right', format: 'currency' },
  { key: 'amount', header: 'Thành tiền', dbCol: 'amount', width: 120, group: 'B', defaultVisible: false, align: 'right', format: 'currency' },
  { key: 'delivery_status', header: 'Trạng thái', dbCol: 'delivery_status', width: 120, group: 'C', defaultVisible: true, format: 'status' },
  { key: 'delivery_date', header: 'Ngày GH', dbCol: 'delivery_date', width: 90, group: 'C', defaultVisible: true, format: 'date' },
  { key: 'actual_delivered_qty', header: 'SL giao TT', dbCol: 'actual_delivered_qty', width: 90, group: 'C', defaultVisible: true, align: 'right', format: 'number' },
  // Pending = quantity - actual_delivered_qty (computed client-side; dbCol='_pending' is a sentinel handled in CellRenderer)
  { key: 'pending_qty', header: 'Pending', dbCol: '_pending', width: 80, group: 'C', defaultVisible: true, align: 'right', format: 'number' },
  { key: 'recipient_name', header: 'Người nhận', dbCol: 'recipient_name', width: 140, group: 'C', defaultVisible: true },
  // Phase G (Thang 2026-05-13): Người giao hàng (driver) join từ bqms_contacts qua driver_id FK
  { key: 'driver_name', header: 'Người giao', dbCol: 'driver_name', width: 140, group: 'C', defaultVisible: true },
  { key: 'driver_license_plate', header: 'Biển số', dbCol: 'driver_license_plate', width: 100, group: 'C', defaultVisible: true },
  { key: 'shipping_no', header: 'Shipping No', dbCol: 'shipping_no', width: 120, group: 'C', defaultVisible: false },
  { key: 'delivery_method', header: 'PT giao hàng', dbCol: 'delivery_method', width: 110, group: 'C', defaultVisible: false },
  { key: 'country_origin', header: 'Xuất xứ', dbCol: 'country_origin', width: 110, group: 'C', defaultVisible: true },
  { key: 'total_delivered_value_vnd', header: 'Tổng GT đã giao', dbCol: 'total_delivered_value_vnd', width: 140, group: 'C', defaultVisible: false, align: 'right', format: 'currency' },
  { key: 'po_date', header: 'Ngày PO', dbCol: 'po_date', width: 90, group: 'D', defaultVisible: false, format: 'date' },
  { key: 'quotation_no', header: 'Số QT', dbCol: 'quotation_no', width: 120, group: 'D', defaultVisible: false },
  { key: 'sev_type', header: 'SEV/T', dbCol: 'sev_type', width: 70, group: 'D', defaultVisible: false },
  { key: 'buyer_email', header: 'Mail PUR', dbCol: 'buyer_email', width: 120, group: 'D', defaultVisible: false },
  { key: 'receiving_warehouse', header: 'Kho nhận', dbCol: 'receiving_warehouse', width: 160, group: 'D', defaultVisible: false },
  { key: 'buyer_phone', header: 'SĐT PUR', dbCol: 'buyer_phone', width: 110, group: 'D', defaultVisible: false },
  { key: 'delivery_info', header: 'TT giao hàng', dbCol: 'delivery_info', width: 160, group: 'D', defaultVisible: false },
];

const DEFAULT_VISIBLE = COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
const COL_STORAGE_KEY = 'delivery_columns_v1';

function getVisibleCols(): string[] {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE;
  try {
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
  const [activeTab, setActiveTab] = useState<'deliveries' | 'contacts' | 'mro'>('deliveries');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<DeliveryRecord | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showDriverManager, setShowDriverManager] = useState(false);
  const [showRevenueDashboard, setShowRevenueDashboard] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_VISIBLE);
  const [showColPicker, setShowColPicker] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Multi-select for "Thống kê xuất xứ"
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [originSummary, setOriginSummary] = useState<{ bqms_code: string; country_origin: string }[] | null>(null);
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
    return p;
  }, [statusFilter, month, year]);

  const { data: raw, isLoading } = useQuery({
    queryKey: ['deliveries', statusFilter, month, year, page],
    queryFn: () => {
      const p = new URLSearchParams(filterParams);
      p.set('page', String(page));
      p.set('limit', '50');
      return api.get<any>(`/api/v1/bqms/deliveries?${p}`);
    },
    retry: 1,
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
    <div className="flex gap-4 h-full">
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
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
          <div className="flex items-center gap-2">
            {/* Per Thang 2026-05-13: Bỏ tab switcher (Giao hàng/Danh bạ/MRO P/O)
                — merge tất cả vào view Giao hàng. Danh bạ + MRO PO tab content
                vẫn tồn tại như component nhưng không expose qua UI. MRO PO
                accessible qua /bqms/mro, Danh bạ embed inline trong từng row. */}
            {true && (
              <>
                {selectedIds.size > 0 ? (
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5" /> Thống kê xuất xứ ({selectedIds.size})
                  </button>
                ) : null}
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Xuất Excel
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowColPicker(!showColPicker)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
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
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    hideCompleted
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                  title="Ẩn các đơn đã giao / hoàn tất khỏi danh sách (vẫn lưu trong DB)"
                >
                  {hideCompleted ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
                  {hideCompleted ? 'Đang ẩn đã giao' : 'Ẩn đã giao'}
                </button>
                <button
                  onClick={() => setShowRevenueDashboard(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors"
                  title="Dashboard doanh thu PO theo ngày / tháng / người giao / mã PO / BQMS"
                >
                  <BarChart3 className="h-3.5 w-3.5" /> Thống kê
                </button>
                <button
                  onClick={() => setShowDriverManager(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                  title="Quản lý người giao hàng (CCCD, biển số xe)"
                >
                  <Truck className="h-3.5 w-3.5" /> Người giao
                </button>
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 transition-colors"
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

            {/* Table */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
              {isLoading ? (
                <TableSkeleton cols={activeCols.length} />
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                  <Truck className="h-12 w-12 mb-3" />
                  <p className="text-sm text-slate-400 font-medium">
                    {deliveries.length === 0 ? 'Chưa có dữ liệu giao hàng' : 'Không tìm thấy kết quả phù hợp'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/80">
                        <th className="px-2 py-2.5 w-8 sticky left-0 bg-slate-50/80 z-10">
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
                        <th className="text-xs font-mono uppercase tracking-wider text-slate-400 px-3 py-2.5 text-left w-10 sticky left-8 bg-slate-50/80 z-10">#</th>
                        {activeCols.map(col => (
                          <th
                            key={col.key}
                            onClick={() => handleSort(col.key)}
                            className={cn(
                              'text-xs font-mono uppercase tracking-wider text-slate-400 px-3 py-2.5 whitespace-nowrap cursor-pointer hover:text-slate-600 select-none',
                              col.align === 'right' ? 'text-right' : 'text-left',
                              (col.key === 'po_number' || col.key === 'bqms_code') && 'sticky bg-slate-50/80 z-10',
                              col.key === 'po_number' && 'left-10',
                              col.key === 'bqms_code' && 'left-[calc(2.5rem+120px)]',
                            )}
                            style={{ minWidth: col.width }}
                          >
                            <span className="inline-flex items-center gap-1">
                              {col.header}
                              {sortCol === col.key && (
                                <ArrowUpDown className="h-3 w-3 text-brand-500" />
                              )}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
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
                              'hover:bg-slate-50 transition-colors cursor-pointer text-sm',
                              isSelected && 'bg-brand-50 border-l-2 border-brand-500'
                            )}
                          >
                            <td
                              className="px-2 py-2.5 sticky left-0 bg-white z-10"
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
                            <td className="px-3 py-2.5 text-xs text-slate-400 font-mono sticky left-8 bg-white z-10">
                              {rowNum}
                            </td>
                            {activeCols.map(col => {
                              const isPoDup = col.key === 'po_number' && d.po_number && dupKeys.po.has(d.po_number);
                              const isBqmsDup = col.key === 'bqms_code' && d.bqms_code && dupKeys.bqms.has(d.bqms_code);
                              return (
                              <td
                                key={col.key}
                                className={cn(
                                  'px-3 py-2.5',
                                  col.align === 'right' ? 'text-right' : 'text-left',
                                  (col.key === 'po_number' || col.key === 'bqms_code') && 'sticky z-10',
                                  (col.key === 'po_number' || col.key === 'bqms_code') && !isPoDup && !isBqmsDup && 'bg-white',
                                  col.key === 'po_number' && 'left-10',
                                  col.key === 'bqms_code' && 'left-[calc(2.5rem+120px)]',
                                  col.key === 'actual_delivered_qty' && qtyMismatch && 'bg-amber-50',
                                  // Duplicate highlight: amber tint + border
                                  (isPoDup || isBqmsDup) && 'bg-amber-100/80 ring-1 ring-amber-300 ring-inset',
                                )}
                                style={{ minWidth: col.width }}
                                title={isPoDup ? `PO ${d.po_number} xuất hiện nhiều lần` : isBqmsDup ? `BQMS ${d.bqms_code} xuất hiện nhiều lần` : undefined}
                              >
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

      {/* Detail panel */}
      {selectedRow && activeTab === 'deliveries' && (
        <div className="w-[380px] shrink-0">
          <DetailPanel
            delivery={selectedRow}
            onClose={() => setSelectedRow(null)}
            onChanged={() => {
              queryClient.invalidateQueries({ queryKey: ['deliveries'] });
              queryClient.invalidateQueries({ queryKey: ['deliveries-kpi'] });
            }}
            onOpenDriverManager={() => setShowDriverManager(true)}
          />
        </div>
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

  const cards = [
    { label: 'Tổng đơn', value: fmtNum(kpi.total_orders), sub: `${kpi.total_orders} đơn hàng`, icon: Package, accent: 'border-l-blue-500', iconColor: 'text-blue-500' },
    { label: 'Đã giao', value: fmtNum(kpi.delivered_count), sub: `${deliveryRate}%`, icon: CheckCircle2, accent: 'border-l-emerald-500', iconColor: 'text-emerald-500' },
    { label: 'Đang giao', value: fmtNum(kpi.in_transit_count), sub: `${inTransitRate}%`, icon: Truck, accent: 'border-l-cyan-500', iconColor: 'text-cyan-500' },
    { label: 'Chưa giao', value: fmtNum(kpi.pending_count), sub: `${pendingRate}%`, icon: Clock, accent: 'border-l-amber-500', iconColor: 'text-amber-500' },
    { label: 'Giá trị đã giao', value: fmtVnd(kpi.total_delivered_vnd), sub: formatCurrency(kpi.total_delivered_vnd), icon: DollarSign, accent: 'border-l-violet-500', iconColor: 'text-violet-500' },
  ];

  return (
    <div className="grid grid-cols-5 gap-3 mb-4">
      {cards.map(c => (
        <div key={c.label} className={cn('bg-white rounded-lg border border-slate-200 border-l-4 px-4 py-3', c.accent)}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500 font-medium">{c.label}</span>
            <c.icon className={cn('h-4 w-4', c.iconColor)} />
          </div>
          <p className="text-lg font-bold text-slate-800 font-mono">{c.value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Inline editable fields on the table ────────────────────────

const INLINE_EDITABLE: Record<string, 'select' | 'number'> = {
  delivery_status: 'select',
  actual_delivered_qty: 'number',
};

const STATUS_OPTIONS = [
  { value: 'chua_giao', label: 'Chưa giao' },
  { value: 'dang_giao', label: 'Đang giao' },
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

  // Pending = quantity - actual_delivered_qty (sentinel _pending dbCol)
  if (col.dbCol === '_pending') {
    const qty = Number(record.quantity ?? 0);
    const actual = Number(record.actual_delivered_qty ?? 0);
    const pending = qty - actual;
    if (pending === 0 && actual > 0) {
      return <span className="text-emerald-600 font-medium tabular-nums">0</span>;
    }
    if (pending < 0) {
      return <span className="text-amber-600 font-medium tabular-nums" title="Giao quá đơn">{pending}</span>;
    }
    return (
      <span className={cn('tabular-nums font-medium', pending > 0 && 'text-rose-600')}>
        {pending.toLocaleString('vi-VN')}
      </span>
    );
  }

  const value = (record as any)[col.dbCol];

  const editable = INLINE_EDITABLE[col.key];

  // Status — click to open dropdown
  if (col.format === 'status' && editable === 'select' && onUpdate) {
    if (editing) {
      return (
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
          className="px-1 py-0.5 border border-brand-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
          onClick={e => e.stopPropagation()}
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className="cursor-pointer hover:ring-1 hover:ring-brand-300 rounded px-0.5"
        title="Click để sửa trạng thái"
      >
        {statusCfg ? (
          <StatusBadge label={statusCfg.label} variant={statusCfg.variant} pulse={statusCfg.pulse} />
        ) : (
          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{status}</span>
        )}
      </span>
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
    return <span className="text-xs text-slate-600 font-mono">{formatDate(value)}</span>;
  }

  if (col.format === 'currency') {
    return <span className="text-xs text-slate-700 font-mono">{value != null ? fmtNum(Number(value)) : '—'}</span>;
  }

  if (col.format === 'number') {
    return (
      <span className="text-xs text-slate-700 font-mono">
        {value != null ? `${fmtNum(Number(value))}${col.key === 'quantity' && record.unit ? ` ${record.unit}` : ''}` : '—'}
      </span>
    );
  }

  if (col.key === 'po_number' || col.key === 'bqms_code') {
    return <span className="font-mono text-xs text-brand-600 font-medium">{value ?? '—'}</span>;
  }

  if (col.key === 'specification') {
    return (
      <div className="max-w-[200px]">
        <p className="text-xs text-slate-700 truncate" title={value ?? ''}>{value ?? '—'}</p>
      </div>
    );
  }

  return <span className="text-xs text-slate-600 truncate block max-w-[160px]" title={value ?? ''}>{value ?? '—'}</span>;
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
            <div className="px-3 py-1 text-[10px] font-semibold text-slate-300 uppercase tracking-wider">{g.label}</div>
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

  // Hero gradient picks color from status
  const heroGradient =
    status === 'da_giao' || status === 'delivered' || status === 'hoan_tat' || status === 'completed'
      ? 'from-emerald-500 via-emerald-600 to-teal-700'
      : status === 'dang_giao' || status === 'in_transit'
        ? 'from-sky-500 via-blue-600 to-indigo-700'
        : 'from-slate-700 via-slate-800 to-slate-900';

  return (
    <div className="bg-white rounded-2xl shadow-lg shadow-slate-900/5 border border-slate-200 overflow-hidden sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto">
      {/* Hero header */}
      <div className={cn('relative px-5 pt-4 pb-5 bg-gradient-to-br text-white', heroGradient)}>
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/15 transition"
          title="Đóng"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/70 font-semibold mb-2">
          <Truck className="h-3 w-3" />
          Chi tiết giao hàng
        </div>

        <div className="font-mono text-[11px] text-white/80">PO #{delivery.po_number || '—'}</div>
        <div className="font-mono text-lg font-bold leading-tight tracking-tight mt-0.5 break-words">
          {delivery.bqms_code || 'Không có BQMS code'}
        </div>

        {/* Status badge */}
        <div className="mt-3 flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur text-[11px] font-semibold ring-1 ring-white/20">
            <span className="h-1.5 w-1.5 rounded-full bg-white/90 animate-pulse" />
            {statusCfg?.label || status || 'Chưa rõ'}
          </div>
          {delivery.country_origin ? (
            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 text-[10px] font-medium ring-1 ring-white/15">
              🌐 {delivery.country_origin}
            </div>
          ) : null}
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex justify-between items-baseline mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-white/70 font-semibold">Tiến độ giao</span>
            <span className="text-xs font-bold tabular-nums">{pendingPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, pendingPct))}%` }}
            />
          </div>
        </div>
      </div>

      {/* KPI mini cards: SL / SL giao TT / Pending */}
      <div className="grid grid-cols-3 gap-px bg-slate-100">
        <KpiMini label="Số lượng" value={qty.toLocaleString('vi-VN')} unit={delivery.unit || ''} accent="slate" />
        <KpiMini
          label="Đã giao"
          value={actual.toLocaleString('vi-VN')}
          unit={delivery.unit || ''}
          accent="emerald"
        />
        <KpiMini
          label="Pending"
          value={pending.toLocaleString('vi-VN')}
          unit={delivery.unit || ''}
          accent={pending === 0 && actual > 0 ? 'emerald' : pending > 0 ? 'rose' : 'amber'}
        />
      </div>

      <div className="p-5 space-y-5">
        {/* Status timeline */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-3">
            Lịch sử trạng thái
          </div>
          <div className="space-y-2">
            {[
              { key: 'pending', label: 'Chưa giao' },
              { key: 'in_transit', label: 'Đang giao' },
              { key: 'delivered', label: 'Đã giao' },
              { key: 'completed', label: 'Hoàn tất' },
            ].map((step, i) => {
              const reached = i <= currentStepIdx;
              const current = i === currentStepIdx;
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div
                    className={cn(
                      'h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 ring-2',
                      reached ? 'bg-brand-500 text-white ring-brand-200' : 'bg-slate-100 text-slate-300 ring-slate-100',
                      current && 'ring-4 ring-brand-200',
                    )}
                  >
                    {reached ? <Check className="h-3 w-3" /> : <span className="text-[10px] font-bold">{i + 1}</span>}
                  </div>
                  <div className={cn('flex-1 text-sm', reached ? 'text-slate-900 font-medium' : 'text-slate-400')}>
                    {step.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section: Sản phẩm */}
        <DetailSectionCard icon={<Package className="h-3.5 w-3.5" />} title="Sản phẩm">
          <DetailRow label="BQMS Code" value={delivery.bqms_code} mono />
          {delivery.specification ? (
            <div className="pt-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Spec</span>
              <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap break-words leading-relaxed">
                {delivery.specification}
              </p>
            </div>
          ) : null}
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
        </DetailSectionCard>

        {/* Section: PO */}
        <DetailSectionCard icon={<FileText className="h-3.5 w-3.5" />} title="Thông tin PO">
          <DetailRow label="Ngày PO" value={formatDate(delivery.po_date)} />
          <DetailRow label="Số QT" value={delivery.quotation_no} mono />
          <DetailRow label="Shipping No" value={delivery.shipping_no} mono />
          <DetailRow label="SEV/T" value={delivery.sev_type} />
        </DetailSectionCard>

        {/* Section: Giao hàng */}
        <DetailSectionCard icon={<Truck className="h-3.5 w-3.5" />} title="Giao hàng">
          <EditableRow label="Ngày GH" field="delivery_date" value={formatDate(delivery.delivery_date)}
            rawValue={delivery.delivery_date?.split('T')[0] ?? ''} editField={editField} editValue={editValue}
            saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} type="date" />
          <EditableRow label="SL giao TT" field="actual_delivered_qty"
            value={delivery.actual_delivered_qty != null ? fmtNum(delivery.actual_delivered_qty) : '—'}
            rawValue={String(delivery.actual_delivered_qty ?? '')} editField={editField} editValue={editValue}
            saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} type="number" />
          <EditableRow label="PT giao hàng" field="delivery_method" value={delivery.delivery_method ?? '—'}
            rawValue={delivery.delivery_method ?? ''} editField={editField} editValue={editValue}
            saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} />
          <EditableRow label="Xuất xứ" field="country_origin" value={delivery.country_origin ?? '—'}
            rawValue={delivery.country_origin ?? ''} editField={editField} editValue={editValue}
            saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} />
          <DetailRow
            label="Tổng GT đã giao"
            value={delivery.total_delivered_value_vnd != null ? formatCurrency(Number(delivery.total_delivered_value_vnd)) : null}
            mono
          />
          {delivery.delivery_info ? (
            <div className="pt-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Thông tin giao hàng</span>
              <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap break-words leading-relaxed">
                {delivery.delivery_info}
              </p>
            </div>
          ) : null}
        </DetailSectionCard>

        {/* Section: Người giao hàng (Driver picker) — Phase G */}
        <DriverPicker delivery={delivery} onChanged={onChanged} onOpenManager={onOpenDriverManager} />

        {/* Section: Liên hệ — Phase G (Thang 2026-05-13): tất cả editable */}
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

        {/* Notes */}
        {delivery.notes ? (
          <DetailSectionCard icon={<Pencil className="h-3.5 w-3.5" />} title="Ghi chú">
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{delivery.notes}</p>
          </DetailSectionCard>
        ) : null}

        {saveError ? (
          <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-rose-500 flex-shrink-0" />
            <span>{saveError}</span>
          </div>
        ) : null}

        {/* Status change */}
        <StatusChangeButtons deliveryId={delivery.id} currentStatus={status} onChanged={onChanged} />
      </div>
    </div>
  );
}

function KpiMini({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent: 'slate' | 'emerald' | 'rose' | 'amber' }) {
  const styles = {
    slate: 'bg-white text-slate-900',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
  } as const;
  return (
    <div className={cn('p-3 text-center', styles[accent])}>
      <div className="text-[9px] uppercase tracking-[0.12em] font-bold opacity-70">{label}</div>
      <div className="mt-1 font-bold tabular-nums leading-tight">
        <span className="text-xl">{value}</span>
        {unit ? <span className="text-[10px] ml-1 opacity-70">{unit}</span> : null}
      </div>
    </div>
  );
}

function DetailSectionCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/40 overflow-hidden">
      <div className="px-3.5 py-2 border-b border-slate-200 bg-white flex items-center gap-2">
        <span className="text-slate-400">{icon}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-600">{title}</span>
      </div>
      <div className="px-3.5 py-3 space-y-2.5">{children}</div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 pt-3 space-y-2.5">
      <p className="text-xs text-slate-400 uppercase font-mono tracking-wider font-semibold">{title}</p>
      {children}
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className={cn('text-sm text-right text-slate-700 truncate', mono && 'font-mono text-xs')}>{value ?? '—'}</span>
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
        <span className="text-xs text-slate-400 shrink-0 w-20">{label}</span>
        <input
          type={type}
          value={editValue}
          onChange={e => onSetValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onSave(field, editValue);
            if (e.key === 'Escape') onStartEdit(null as any, '');
          }}
          autoFocus
          className="flex-1 px-2 py-0.5 border border-brand-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button onClick={() => onSave(field, editValue)} disabled={saving}
          className="text-brand-600 hover:text-brand-800">
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
      className="w-full flex justify-between items-center gap-2 group rounded px-1.5 -mx-1.5 py-0.5 hover:bg-brand-50 transition-colors text-left"
      title={`Click để chỉnh sửa ${label}`}
    >
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className="flex items-center gap-1.5 text-sm text-slate-700">
        {value}
        <Pencil className="h-3 w-3 text-slate-300 group-hover:text-brand-500 transition-colors" />
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

  const TRANSITIONS: Record<string, { next: string; label: string; color: string }[]> = {
    pending: [{ next: 'in_transit', label: 'Bắt đầu giao', color: 'bg-blue-600' }],
    picked_up: [{ next: 'in_transit', label: 'Đang vận chuyển', color: 'bg-indigo-600' }],
    in_transit: [
      { next: 'customs_clearance', label: 'Thông quan', color: 'bg-amber-600' },
      { next: 'delivered', label: 'Đã giao', color: 'bg-green-600' },
    ],
    customs_clearance: [{ next: 'delivered', label: 'Đã giao', color: 'bg-green-600' }],
    delivered: [{ next: 'completed', label: 'Hoàn tất', color: 'bg-emerald-600' }],
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
    <div className="border-t border-slate-100 pt-3 space-y-2">
      <p className="text-xs text-slate-400 uppercase font-mono tracking-wider">Chuyển trạng thái</p>
      <div className="flex flex-wrap gap-2">
        {transitions.map(t => (
          <button key={t.next} onClick={() => handleChange(t.next)} disabled={updating}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white ${t.color} hover:opacity-90 disabled:opacity-50 transition-colors`}>
            {updating ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
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
                      <p className="text-xs text-slate-400">{c.email_username} · {c.phone ?? ''}</p>
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
            <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] font-bold">
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
                <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-400">Đang tải...</td></tr>
              )}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-400">Chưa có dữ liệu MRO. Chạy scraper để lấy.</td></tr>
              )}
              {items.map((it: any) => (
                <tr key={it.id} className="hover:bg-brand-50/40">
                  <td className="px-2 py-1.5">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded-full text-[10px] font-bold',
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
            <p className="text-sm text-slate-400 font-medium">Không tìm thấy danh bạ</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5 text-left w-10">#</th>
                  <th className="text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5 text-left">Mail</th>
                  <th className="text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5 text-left">Tên</th>
                  <th className="text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5 text-left">Thông tin giao hàng</th>
                  <th className="text-xs font-mono uppercase tracking-wider text-slate-400 px-4 py-2.5 text-left">SĐT</th>
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
