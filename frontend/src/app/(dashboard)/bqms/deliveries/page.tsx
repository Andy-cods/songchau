'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Search, X, Package, Plus, Save, Loader2,
  CheckCircle2, Clock, DollarSign, Download,
  ChevronDown, Columns3, Pencil, ArrowUpDown,
  FileText, Copy, Check,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
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
  { key: 'recipient_name', header: 'Người nhận', dbCol: 'recipient_name', width: 140, group: 'C', defaultVisible: true },
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
  const [activeTab, setActiveTab] = useState<'deliveries' | 'contacts'>('deliveries');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<DeliveryRecord | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_VISIBLE);
  const [showColPicker, setShowColPicker] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Multi-select for "Thống kê xuất xứ"
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [originSummary, setOriginSummary] = useState<{ bqms_code: string; country_origin: string }[] | null>(null);

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

  // Client-side search filter
  const filtered = useMemo(() => {
    let rows = deliveries;
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
  }, [deliveries, searchQuery, sortCol, sortDir]);

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
            {/* Tab switcher */}
            <div className="flex bg-slate-100 rounded-lg p-0.5 mr-2">
              <button
                onClick={() => setActiveTab('deliveries')}
                className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  activeTab === 'deliveries' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                Giao hàng
              </button>
              <button
                onClick={() => setActiveTab('contacts')}
                className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  activeTab === 'contacts' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                Danh bạ
              </button>
            </div>

            {activeTab === 'deliveries' && (
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
                            {activeCols.map(col => (
                              <td
                                key={col.key}
                                className={cn(
                                  'px-3 py-2.5',
                                  col.align === 'right' ? 'text-right' : 'text-left',
                                  (col.key === 'po_number' || col.key === 'bqms_code') && 'sticky bg-white z-10',
                                  col.key === 'po_number' && 'left-10',
                                  col.key === 'bqms_code' && 'left-[calc(2.5rem+120px)]',
                                  col.key === 'actual_delivered_qty' && qtyMismatch && 'bg-amber-50',
                                )}
                                style={{ minWidth: col.width }}
                              >
                                <CellRenderer col={col} record={d} status={status} statusCfg={statusCfg}
                                  onUpdate={() => {
                                    queryClient.invalidateQueries({ queryKey: ['deliveries'] });
                                    queryClient.invalidateQueries({ queryKey: ['deliveries-kpi'] });
                                  }}
                                />
                              </td>
                            ))}
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
              <span>Hiển thị {filtered.length} / {total.toLocaleString('vi-VN')} đơn giao hàng</span>
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
          />
        </div>
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

function DetailPanel({ delivery, onClose, onChanged }: {
  delivery: DeliveryRecord; onClose: () => void; onChanged: () => void;
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

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-brand-500" />
          <span className="text-sm font-semibold text-slate-700">Chi tiết giao hàng</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
      </div>

      <div className="p-4 space-y-4">
        {/* Status progress bar */}
        <div>
          <p className="text-xs text-slate-400 uppercase font-mono tracking-wider mb-2">Trạng thái</p>
          <div className="flex items-center gap-1 mb-2">
            {statusSteps.map((step, i) => (
              <div key={step} className="flex items-center gap-1 flex-1">
                <div className={cn(
                  'h-2 flex-1 rounded-full transition-colors',
                  i <= currentStepIdx ? 'bg-brand-500' : 'bg-slate-200'
                )} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Chưa giao</span>
            <span>Đang giao</span>
            <span>Đã giao</span>
            <span>Hoàn tất</span>
          </div>
          <div className="mt-2">
            {statusCfg ? (
              <StatusBadge label={statusCfg.label} variant={statusCfg.variant} pulse={statusCfg.pulse} />
            ) : (
              <span className="text-sm text-slate-500">{status}</span>
            )}
          </div>
        </div>

        {/* PO Info */}
        <DetailSection title="Thông tin PO">
          <DetailRow label="Số PO" value={delivery.po_number} mono />
          <DetailRow label="Ngày PO" value={formatDate(delivery.po_date)} />
          <DetailRow label="Số QT" value={delivery.quotation_no} mono />
          <DetailRow label="Shipping No" value={delivery.shipping_no} mono />
        </DetailSection>

        {/* Product */}
        <DetailSection title="Sản phẩm">
          <DetailRow label="BQMS Code" value={delivery.bqms_code} mono />
          <div>
            <span className="text-xs text-slate-400">Spec</span>
            <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap break-words">{delivery.specification ?? '—'}</p>
          </div>
          <DetailRow label="Số lượng" value={delivery.quantity != null ? `${fmtNum(delivery.quantity)} ${delivery.unit ?? ''}` : null} />
          <DetailRow label="Đơn giá" value={delivery.unit_price != null ? fmtNum(Number(delivery.unit_price)) : null} />
          <DetailRow label="Thành tiền" value={delivery.amount != null ? formatCurrency(Number(delivery.amount)) : null} />
        </DetailSection>

        {/* Delivery */}
        <DetailSection title="Giao hàng">
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
          <EditableRow label="Xuất x��" field="country_origin" value={delivery.country_origin ?? '—'}
            rawValue={delivery.country_origin ?? ''} editField={editField} editValue={editValue}
            saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} />
          <DetailRow label="Tổng GT đã giao" value={delivery.total_delivered_value_vnd != null ? formatCurrency(Number(delivery.total_delivered_value_vnd)) : null} />
          {delivery.delivery_info && (
            <div>
              <span className="text-xs text-slate-400">TT giao hàng</span>
              <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap break-words">{delivery.delivery_info}</p>
            </div>
          )}
        </DetailSection>

        {/* Contact */}
        <DetailSection title="Liên hệ">
          <EditableRow label="Người nhận" field="recipient_name" value={delivery.recipient_name ?? '—'}
            rawValue={delivery.recipient_name ?? ''} editField={editField} editValue={editValue}
            saving={saving} onStartEdit={startEdit} onSave={handleSaveField} onSetValue={setEditValue} />
          {delivery.receiving_warehouse && (
            <div>
              <span className="text-xs text-slate-400">Kho nhận</span>
              <p className="text-sm text-slate-600 mt-0.5 whitespace-pre-wrap break-words">{delivery.receiving_warehouse}</p>
            </div>
          )}
          <DetailRow label="Mail PUR" value={delivery.buyer_email} />
          <DetailRow label="SĐT PUR" value={delivery.buyer_phone} />
          <DetailRow label="SEV/T" value={delivery.sev_type} />
        </DetailSection>

        {/* Notes */}
        {delivery.notes && (
          <DetailSection title="Ghi chú">
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{delivery.notes}</p>
          </DetailSection>
        )}

        {/* Error message */}
        {saveError && (
          <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</div>
        )}

        {/* Status change */}
        <StatusChangeButtons deliveryId={delivery.id} currentStatus={status} onChanged={onChanged} />
      </div>
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

  return (
    <div className="flex justify-between gap-2 group">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className="flex items-center gap-1 text-sm text-slate-700">
        {value}
        <button onClick={() => onStartEdit(field, rawValue)}
          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-brand-500 transition-opacity">
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    </div>
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
