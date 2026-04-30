'use client';

import { useState, useCallback, useRef, KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ClipboardList,
  RefreshCw,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  Eye,
  History,
  AlertTriangle,
  Clock,
  TrendingUp,
  Percent,
  CheckCircle2,
  XCircle,
  Inbox,
  Copy,
  ExternalLink,
  ChevronLeft,
  Loader2,
  Download,
  FileSpreadsheet,
  CheckCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { SamsungSyncWidget } from '@/components/features/SamsungSyncWidget';
import { SyncFreshnessChip } from '@/components/shared/sync-freshness-chip';
import { cn, formatDate } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RFQItem {
  id: number;
  rfq_number: string | null;
  bqms_code: string | null;
  specification: string | null;
  maker: string | null;
  expected_qty: number | null;
  unit: string | null;
  purchase_price_rmb: number | null;
  purchase_price_vnd: number | null;
  quoted_price_ama: number | null;
  quoted_price_bqms_v1: number | null;
  quoted_price_bqms_v2: number | null;
  quoted_price_bqms_v3: number | null;
  quoted_price_bqms_v4: number | null;
  supplier_name: string | null;
  result: string | null;
  notes: string | null;
  report: string | null;
  person_in_charge_name: string | null;
  inquiry_date: string | null;
  effective_date: string | null;
  created_at: string | null;
}

interface MonthSummary {
  year: number;
  month: number;
  count: number;
  won: number;
  lost: number;
}

interface KPIs {
  total_month: number;
  won: number;
  lost: number;
  pending: number;
  win_rate: number;
}

interface RFQTableResponse {
  data: {
    items: RFQItem[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    kpis: KPIs;
    months: MonthSummary[];
  };
}

interface QuotationHistoryFile {
  type: string;
  filename: string;
  size: number;
  path: string;
  download_url: string;
  preview_url: string | null;
}

interface QuotationHistoryItem {
  id: number;
  rfq_no: string | null;
  status: string | null;
  total_items: number | null;
  filled_items: number | null;
  output_xlsx: string | null;
  output_pdf: string | null;
  created_at: string | null;
  files: QuotationHistoryFile[];
}

interface EditingCell {
  rowId: number;
  field: string;
  currentValue: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function withToken(url: string): string {
  if (typeof window === 'undefined') return url;
  const token = localStorage.getItem('access_token') ?? '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

function fmtVnd(value?: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('vi-VN').format(value);
}

function fmtNum(value?: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('vi-VN').format(value);
}

function getUrgency(item: RFQItem): 'red' | 'amber' | null {
  if (!item.inquiry_date || (item.result && item.result !== 'pending')) return null;
  const now = new Date();
  const d = new Date(item.inquiry_date);
  const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  // inquiry_date is "recent" = within last 7 days from now
  if (diffDays >= 0 && diffDays < 3) return 'red';
  if (diffDays >= 0 && diffDays < 7) return 'amber';
  return null;
}

function monthLabel(year: number, month: number) {
  return `Tháng ${month}/${year}`;
}

// ─── Result Badge ─────────────────────────────────────────────────────────────

function ResultBadge({ result }: { result?: string | null }) {
  const val = (result ?? '').toLowerCase();
  if (val === 'won')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="h-3 w-3" />
        Trúng
      </span>
    );
  if (val === 'lost')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 whitespace-nowrap">
        <XCircle className="h-3 w-3" />
        Trượt
      </span>
    );
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 whitespace-nowrap">
      Đang XL
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  colorClass,
  loading,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  colorClass: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 px-4 py-3 flex items-center gap-3 min-w-0">
      <div className={`p-2.5 rounded-lg flex-shrink-0 ${colorClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        {loading ? (
          <div className="h-6 w-16 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-xl font-bold font-mono text-slate-900 leading-tight">{value}</p>
        )}
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Inline Price Cell ────────────────────────────────────────────────────────

function PriceCell({
  item,
  field,
  value,
  editingCell,
  onStartEdit,
  onSave,
  onCancel,
}: {
  item: RFQItem;
  field: string;
  value: number | null;
  editingCell: EditingCell | null;
  onStartEdit: (cell: EditingCell) => void;
  onSave: (rowId: number, field: string, value: string) => void;
  onCancel: () => void;
}) {
  const isEditing =
    editingCell?.rowId === item.id && editingCell?.field === field;
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = () => {
    onStartEdit({
      rowId: item.id,
      field,
      currentValue: value != null ? String(value) : '',
    });
    // Focus on next tick after render
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSave(item.id, field, inputRef.current?.value ?? '');
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  if (isEditing) {
    return (
      <td className="px-2 py-1.5 text-right">
        <input
          ref={inputRef}
          defaultValue={editingCell?.currentValue ?? ''}
          onKeyDown={handleKeyDown}
          onBlur={() => onCancel()}
          className="w-24 text-xs text-right font-mono border border-brand-400 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-brand-500"
          autoFocus
        />
      </td>
    );
  }

  return (
    <td
      className="px-2 py-2 text-right cursor-text group"
      onDoubleClick={handleDoubleClick}
      title="Double-click để sửa"
    >
      <span className="text-xs font-mono text-slate-600 group-hover:text-brand-600 transition-colors">
        {fmtVnd(value)}
      </span>
    </td>
  );
}

// ─── Row Detail Panel ─────────────────────────────────────────────────────────

// ── Inline Create Quotation (TM + GC Flow) ──────────────────
function InlineCreateQuotation({ item, pageYear, pageMonth }: { item: RFQItem; pageYear?: number | null; pageMonth?: number | null }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'config' | 'preview' | 'generating' | 'done' | 'error'>('config');
  const [result, setResult] = useState<any>(null);
  const [flowType, setFlowType] = useState<'tm' | 'gc'>('tm');
  const [lookupYear, setLookupYear] = useState<number | null>(pageYear ?? new Date().getFullYear());
  const [lookupMonth, setLookupMonth] = useState<number | null>(pageMonth ?? null);
  const [editedPrices, setEditedPrices] = useState<Record<string, string>>({});
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);

  // ─── GC-specific state ────────────────────────────────────
  const [gcStep, setGcStep] = useState<'detect' | 'scan' | 'edit' | 'generating' | 'done' | 'error'>('detect');
  const [gcLevels, setGcLevels] = useState<any[]>([]);
  const [gcRfqFolder, setGcRfqFolder] = useState<string>('');
  const [gcQuoteLevel, setGcQuoteLevel] = useState<number>(2);
  const [gcSelectedExcel, setGcSelectedExcel] = useState<string>('');
  const [gcSheets, setGcSheets] = useState<any[]>([]);
  const [gcEditedPrices, setGcEditedPrices] = useState<Record<string, string>>({});
  const [gcResult, setGcResult] = useState<any>(null);
  const [gcDetecting, setGcDetecting] = useState(false);
  const [gcScanning, setGcScanning] = useState(false);
  const [gcGenerating, setGcGenerating] = useState(false);

  // Build lookup URL with year/month
  const lookupParams = new URLSearchParams();
  lookupParams.set('rfq_code', item.rfq_number ?? '');
  if (lookupYear) lookupParams.set('year', String(lookupYear));
  if (lookupMonth) lookupParams.set('month', String(lookupMonth));

  const { data: lookupData, isLoading: lookupLoading, refetch } = useQuery({
    queryKey: ['rfq-lookup', item.rfq_number, lookupYear, lookupMonth],
    queryFn: () => api.get<{ data: { items: any[]; total: number; gc_count: number; tm_count: number } }>(
      `/api/v1/quotations/lookup?${lookupParams.toString()}`
    ),
    enabled: step !== 'config' && flowType === 'tm',
  });

  const lookupItems = Array.isArray(lookupData?.data?.items) ? lookupData.data.items : [];
  const gcCount = lookupData?.data?.gc_count ?? 0;
  const tmCount = lookupData?.data?.tm_count ?? 0;

  // ─── GC API calls ────────────────────────────────────────
  const handleGcDetect = async () => {
    setGcDetecting(true);
    try {
      const res = await api.post<{ data: any }>('/api/v1/quotations/gc/detect-files', {
        rfq_no: item.rfq_number ?? '',
        year: lookupYear ?? undefined,
        month: lookupMonth ?? undefined,
      });
      const d = res.data;
      setGcLevels(d.levels || []);
      setGcRfqFolder(d.rfq_folder || '');
      if (d.levels?.length > 0) {
        const maxLv = d.levels[d.levels.length - 1];
        setGcSelectedExcel(maxLv.excel_files?.[0] ? `${maxLv.folder}/${maxLv.excel_files[0]}` : '');
        setGcQuoteLevel(Math.min((d.max_level || 0) + 1, 4));
      }
      setGcStep('scan');
    } catch (err: any) {
      setGcResult({ error: err?.detail ?? 'Không tìm thấy folder RFQ trên OneDrive' });
      setGcStep('error');
    } finally {
      setGcDetecting(false);
    }
  };

  const handleGcScan = async () => {
    setGcScanning(true);
    try {
      const overrides: Record<string, number> = {};
      for (const [k, v] of Object.entries(gcEditedPrices)) {
        if (v !== '') overrides[k] = Number(v);
      }
      const res = await api.post<{ data: any }>('/api/v1/quotations/gc/scan-markers', {
        rfq_no: item.rfq_number ?? '',
        excel_path: gcSelectedExcel,
        quote_level: gcQuoteLevel,
        price_overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      });
      setGcSheets(res.data.sheets || []);
      setGcStep('edit');
    } catch (err: any) {
      setGcResult({ error: err?.detail ?? 'Lỗi scan markers' });
      setGcStep('error');
    } finally {
      setGcScanning(false);
    }
  };

  const handleGcGenerate = async () => {
    setGcGenerating(true);
    setGcStep('generating');
    try {
      // Apply user-edited prices to sheets
      const sheetsToSend = gcSheets.map((s: any) => {
        const userPrice = gcEditedPrices[s.bqms_code];
        if (userPrice !== undefined && userPrice !== '' && s.status === 'ready') {
          const delta = Number(userPrice);
          return {
            ...s,
            suggested_price: delta,
            new_k_value: Math.abs(s.current_k_value ?? 0) + Math.abs(delta),
          };
        }
        return s;
      });

      const res = await api.post<{ data: any; message: string }>('/api/v1/quotations/gc/generate', {
        rfq_no: item.rfq_number ?? '',
        quote_level: gcQuoteLevel,
        source_folder: gcSelectedExcel.substring(0, gcSelectedExcel.lastIndexOf('/')),
        sheets: sheetsToSend,
      });
      setGcResult(res.data);
      setGcStep('done');
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
    } catch (err: any) {
      setGcResult({ error: err?.detail ?? 'Lỗi tạo báo giá GC' });
      setGcStep('error');
    } finally {
      setGcGenerating(false);
    }
  };

  // Auto-detect flow type based on items
  const handleLookup = () => {
    if (flowType === 'gc') {
      setStep('preview');
      handleGcDetect();
      return;
    }
    setStep('preview');
    refetch();
  };

  const handlePriceChange = (bqmsCode: string, value: string) => {
    setEditedPrices(prev => ({ ...prev, [bqmsCode]: value }));
  };

  const handleGenerate = async () => {
    setStep('generating');
    try {
      // Merge edited prices into items
      const itemsToSend = lookupItems.length > 0
        ? lookupItems.map((li: any) => ({
            ...li,
            unit_price: editedPrices[li.bqms] !== undefined
              ? (editedPrices[li.bqms] === '' ? null : Number(editedPrices[li.bqms]))
              : li.suggested_price ?? null,
          }))
        : [{
            bqms: item.bqms_code ?? '', spec: item.specification ?? '',
            maker: item.maker ?? '', so_luong: item.expected_qty ?? 1,
            don_vi: item.unit ?? 'EA', don_hang: item.rfq_number ?? '',
            loai_hang: flowType.toUpperCase(),
          }];

      const res = await api.post<{ data: any; message: string }>('/api/v1/quotations/generate', {
        rfq_no: item.rfq_number ?? '',
        source_type: 'rfq_code',
        items: itemsToSend,
        flow_type: flowType,
      });
      const data = res?.data;
      setResult(data);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });

      // Get share links for Excel files and open via MS Office Online viewer
      if (data?.files) {
        for (const f of data.files) {
          if (f.type?.includes('xlsx')) {
            try {
              const shareRes = await api.get<{ url: string }>(
                `/api/v1/quotations/share-link/${data.id}/${f.type}`
              );
              const publicUrl = `${window.location.origin}${shareRes.url}`;
              const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(publicUrl)}`;
              window.open(viewerUrl, '_blank');
            } catch {
              // Fallback: open download directly
              window.open(withToken(f.download_url), '_blank');
            }
          }
        }
      }
    } catch (err: any) {
      setResult({ error: err?.detail ?? err?.message ?? 'Lỗi tạo báo giá' });
      setStep('error');
    }
  };

  return (
    <div className="border-t border-brand-100 pt-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-brand-700">
          Tạo báo giá — {item.rfq_number}
        </h4>
        {step !== 'config' && (
          <button onClick={() => { setStep('config'); setResult(null); setPreviewPdfUrl(null); setGcStep('detect'); setGcResult(null); setGcSheets([]); setGcLevels([]); setGcEditedPrices({}); }}
            className="text-[11px] text-slate-400 hover:text-slate-600">
            Cấu hình lại
          </button>
        )}
      </div>

      {/* Step 1: Config — Flow type + Year/Month filter */}
      {step === 'config' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold">1</span>
            Cau hinh bao gia
          </div>
          {/* Flow type selection */}
          <div className="flex items-center gap-2 pl-8">
            <span className="text-[11px] text-slate-500">Loai:</span>
            <button
              onClick={() => setFlowType('tm')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                flowType === 'tm'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              TM — Thương Mại
            </button>
            <button
              onClick={() => setFlowType('gc')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                flowType === 'gc'
                  ? 'bg-orange-600 text-white border-orange-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              GC — Gia Công
            </button>
          </div>

          {/* Year/Month filter */}
          <div className="flex items-center gap-3 pl-8">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">Nam:</span>
              <select value={lookupYear ?? ''} onChange={e => setLookupYear(e.target.value ? Number(e.target.value) : null)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white">
                <option value="">Tất cả</option>
                {[2026, 2025, 2024, 2023].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">Tháng:</span>
              <select value={lookupMonth ?? ''} onChange={e => setLookupMonth(e.target.value ? Number(e.target.value) : null)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white">
                <option value="">Tất cả</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>Tháng {m}</option>)}
              </select>
            </div>
          </div>

          <button onClick={handleLookup}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors ml-8 ${
              flowType === 'gc' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-brand-600 hover:bg-brand-700'
            }`}>
            <Search className="h-3.5 w-3.5" />
            {flowType === 'gc' ? 'Tìm file GC trên OneDrive' : 'Tra cứu items'}
          </button>
        </div>
      )}

      {/* ═══ GC FLOW — replaces TM preview/generate when flowType=gc ═══ */}
      {step === 'preview' && flowType === 'gc' && (
        <div className="space-y-3">
          {/* GC Step: Detect / Scan / Edit / Generate / Done / Error */}

          {/* Detect — tìm file Excel GC trên OneDrive */}
          {gcStep === 'detect' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-orange-700">
                <span className="w-6 h-6 rounded-full bg-orange-600 text-white text-xs flex items-center justify-center font-bold">2</span>
                Phát hiện file Excel GC trên OneDrive
              </div>
              <button onClick={handleGcDetect}
                disabled={gcDetecting}
                className="ml-8 px-4 py-2 rounded-lg text-xs font-semibold bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 transition-colors">
                {gcDetecting ? (
                  <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang tìm...</span>
                ) : 'Tìm file GC'}
              </button>
            </div>
          )}

          {/* Scan — hiện detected files + level selector */}
          {gcStep === 'scan' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-orange-700">
                <span className="w-6 h-6 rounded-full bg-orange-600 text-white text-xs flex items-center justify-center font-bold">2</span>
                Chọn file & cấp báo giá
              </div>
              {/* RFQ folder info */}
              <div className="ml-8 text-[11px] text-slate-500 truncate" title={gcRfqFolder}>
                Folder: {gcRfqFolder.split('/').slice(-2).join('/')}
              </div>
              {/* Level selector */}
              <div className="ml-8 flex items-center gap-3">
                <span className="text-xs text-slate-600">Cấp báo giá:</span>
                {[1, 2, 3, 4].map(lv => (
                  <button key={lv} onClick={() => setGcQuoteLevel(lv)}
                    className={`px-3 py-1 rounded text-xs font-bold border transition-colors ${
                      gcQuoteLevel === lv
                        ? 'bg-orange-600 text-white border-orange-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}>
                    L{lv}
                  </button>
                ))}
              </div>
              {/* Detected Excel files */}
              <div className="ml-8 space-y-1">
                {gcLevels.map((lv: any) => (
                  <div key={lv.level} className="text-xs">
                    <span className="font-semibold text-slate-700">L{lv.level}/</span>
                    {lv.excel_files?.map((f: string) => (
                      <button key={f}
                        onClick={() => setGcSelectedExcel(`${lv.folder}/${f}`)}
                        className={`ml-2 px-2 py-0.5 rounded text-[10px] transition-colors ${
                          gcSelectedExcel.endsWith(f)
                            ? 'bg-orange-100 text-orange-700 font-bold border border-orange-300'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}>
                        {f}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              {/* Scan button */}
              <div className="ml-8 flex items-center gap-2">
                <button onClick={handleGcScan}
                  disabled={!gcSelectedExcel || gcScanning}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 transition-colors">
                  {gcScanning ? (
                    <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang scan...</span>
                  ) : 'Scan markers'}
                </button>
                <button onClick={() => { setStep('config'); setGcStep('detect'); }}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                  Quay lại
                </button>
              </div>
            </div>
          )}

          {/* Edit — marker preview table with editable prices per sheet */}
          {gcStep === 'edit' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-orange-700">
                <span className="w-6 h-6 rounded-full bg-orange-600 text-white text-xs flex items-center justify-center font-bold">3</span>
                Xem và chỉnh sửa giá theo sheet
              </div>
              {/* Stats */}
              <div className="ml-8 flex gap-3 text-[11px]">
                <span className="text-slate-500">Tổng: {gcSheets.length} sheets</span>
                <span className="text-green-600 font-medium">Sẵn sàng: {gcSheets.filter((s: any) => s.status === 'ready').length}</span>
                <span className="text-amber-600 font-medium">Thiếu giá: {gcSheets.filter((s: any) => s.status === 'no_price').length}</span>
                <span className="text-slate-400">Skip: {gcSheets.filter((s: any) => s.status === 'summary_skip').length}</span>
              </div>
              {/* Sheet table */}
              <div className="ml-8 overflow-x-auto rounded-lg border border-slate-200 max-h-[350px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-slate-500">Sheet</th>
                      <th className="px-2 py-1.5 text-left font-medium text-slate-500">BQMS Code</th>
                      <th className="px-2 py-1.5 text-right font-medium text-slate-500">Marker</th>
                      <th className="px-2 py-1.5 text-right font-medium text-slate-500">K hiện tại</th>
                      <th className="px-2 py-1.5 text-right font-medium text-slate-500">Delta giá</th>
                      <th className="px-2 py-1.5 text-right font-medium text-slate-500">K mới</th>
                      <th className="px-2 py-1.5 text-center font-medium text-slate-500">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {gcSheets.filter((s: any) => s.sheet_type !== 'summary').map((s: any) => {
                      const userPrice = gcEditedPrices[s.bqms_code];
                      const displayNewK = userPrice !== undefined && userPrice !== ''
                        ? Math.abs(s.current_k_value ?? 0) + Math.abs(Number(userPrice))
                        : s.new_k_value;
                      return (
                        <tr key={s.sheet_name} className="hover:bg-slate-50">
                          <td className="px-2 py-1 font-mono text-[11px]">{s.sheet_name}</td>
                          <td className="px-2 py-1 text-orange-700 font-medium">{s.bqms_code || '—'}</td>
                          <td className="px-2 py-1 text-right font-mono text-[11px]">{s.target_row || '—'}</td>
                          <td className="px-2 py-1 text-right font-mono">{s.current_k_value != null ? fmtVnd(s.current_k_value) : '—'}</td>
                          <td className="px-2 py-1 text-right">
                            <input
                              type="number"
                              placeholder={s.suggested_price != null ? String(s.suggested_price) : '—'}
                              defaultValue={s.suggested_price ?? ''}
                              onChange={(e) => {
                                if (s.bqms_code) {
                                  setGcEditedPrices(p => ({ ...p, [s.bqms_code]: e.target.value }));
                                }
                              }}
                              className="w-24 text-right text-xs border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-300"
                              disabled={s.status === 'no_code'}
                            />
                          </td>
                          <td className="px-2 py-1 text-right font-mono font-bold text-green-700">
                            {displayNewK != null ? fmtVnd(displayNewK) : '—'}
                          </td>
                          <td className="px-2 py-1 text-center">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              s.status === 'ready' ? 'bg-green-100 text-green-700' :
                              s.status === 'no_price' ? 'bg-amber-100 text-amber-700' :
                              s.status === 'no_code' ? 'bg-red-100 text-red-700' :
                              s.status === 'no_marker' ? 'bg-red-100 text-red-600' :
                              'bg-slate-100 text-slate-500'
                            }`}>
                              {s.status === 'ready' ? 'Sẵn sàng' :
                               s.status === 'no_price' ? 'Thiếu giá' :
                               s.status === 'no_code' ? 'Thiếu mã' :
                               s.status === 'no_marker' ? 'Thiếu marker' : s.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Actions */}
              <div className="ml-8 flex items-center gap-2">
                <button onClick={handleGcGenerate}
                  disabled={gcSheets.filter((s: any) => s.status === 'ready').length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 transition-colors">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Tạo báo giá GC L{gcQuoteLevel} ({gcSheets.filter((s: any) => s.status === 'ready').length} sheets)
                </button>
                <button onClick={() => { setGcStep('scan'); setGcEditedPrices({}); setGcSheets([]); }}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                  Quay lại
                </button>
              </div>
            </div>
          )}

          {/* Generating */}
          {gcStep === 'generating' && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-orange-700">
                <span className="w-6 h-6 rounded-full bg-orange-600 text-white text-xs flex items-center justify-center font-bold">4</span>
                Đang tạo báo giá GC...
              </div>
              <div className="flex items-center gap-2 text-xs text-orange-600 pl-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                Clone L{Math.max(gcQuoteLevel - 1, 1)} → L{gcQuoteLevel}... điền giá column K... chuyển PDF...
              </div>
            </div>
          )}

          {/* Done */}
          {gcStep === 'done' && gcResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-bold">4</span>
                Hoàn thành — {gcResult.edited_sheets ?? 0}/{gcResult.total_sheets ?? 0} sheets đã điền giá
              </div>
              {/* File listing */}
              {gcResult.files && gcResult.files.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 border-b border-slate-200">
                    <span className="text-xs font-semibold text-slate-700">Files đã tạo ({gcResult.files.length})</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {gcResult.files.map((f: any, i: number) => {
                      const isPdf = f.type?.includes('pdf');
                      const downloadUrl = withToken(f.download_url || '');
                      return (
                        <div key={i} className="px-3 py-2 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className={`p-1.5 rounded ${isPdf ? 'bg-red-100' : 'bg-green-100'}`}>
                              {isPdf ? <Eye className="h-3.5 w-3.5 text-red-600" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-800">{f.name || f.type}</div>
                              <div className="text-[10px] text-slate-400 font-mono truncate">{f.path || '—'}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {isPdf && f.preview_url && (
                              <button onClick={() => window.open(withToken(f.preview_url), '_blank')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 transition-colors">
                                <Eye className="h-3 w-3" /> Xem PDF
                              </button>
                            )}
                            {downloadUrl && (
                              <a href={downloadUrl}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-brand-600 text-white text-[11px] font-medium hover:bg-brand-700 transition-colors">
                                <Download className="h-3 w-3" /> Tải về
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Errors */}
              {gcResult.errors?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="text-xs font-semibold text-amber-700 mb-1">Cảnh báo ({gcResult.errors.length})</div>
                  {gcResult.errors.map((e: string, i: number) => (
                    <div key={i} className="text-[11px] text-amber-600">• {e}</div>
                  ))}
                </div>
              )}
              <button onClick={() => { setStep('config'); setGcStep('detect'); setGcResult(null); setGcEditedPrices({}); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                Tạo báo giá mới
              </button>
            </div>
          )}

          {/* Error */}
          {gcStep === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-red-700">
                <XCircle className="h-4 w-4" /> Lỗi GC
              </div>
              <div className="text-xs text-red-600">{gcResult?.error ?? 'Lỗi không xác định'}</div>
              <button onClick={() => { setGcStep('detect'); setGcResult(null); setGcSheets([]); setGcLevels([]); setGcEditedPrices({}); }} className="text-[11px] text-red-600 underline">Thử lại</button>
            </div>
          )}
        </div>
      )}

      {/* ═══ TM FLOW — Preview items with editable prices ═══ */}
      {step === 'preview' && flowType === 'tm' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold">2</span>
            Xem va chinh sua gia
          </div>
          {lookupLoading ? (
            <div className="flex items-center gap-2 text-xs text-brand-600 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang tra cứu...
            </div>
          ) : lookupItems.length === 0 ? (
            <div className="text-xs text-slate-400 py-2">
              Không tìm thấy items cho RFQ này trong khoảng thời gian đã chọn.
              <button onClick={() => setStep('config')} className="ml-2 text-brand-600 underline">Thay đổi bộ lọc</button>
            </div>
          ) : (
            <>
              {/* Stats bar */}
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-slate-500">{lookupItems.length} items</span>
                {tmCount > 0 && <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">TM: {tmCount}</span>}
                {gcCount > 0 && <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">GC: {gcCount}</span>}
                <span className="text-slate-400">|</span>
                <span className={`font-medium ${flowType === 'tm' ? 'text-blue-600' : 'text-orange-600'}`}>
                  Flow: {flowType.toUpperCase()}
                </span>
              </div>

              {/* Items table with editable prices */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[300px] overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-500">Loại</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-500">BQMS Code</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-500">Spec</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-500">Maker</th>
                      <th className="text-right px-2 py-1.5 font-medium text-slate-500">SL</th>
                      <th className="text-right px-2 py-1.5 font-medium text-slate-500">Giá gợi ý</th>
                      <th className="text-right px-2 py-1.5 font-medium text-slate-500">Giá báo (sửa)</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-500">KQ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lookupItems.map((li: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-50/50">
                        <td className="px-2 py-1">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            li.loai_hang === 'GC' ? 'bg-orange-100 text-orange-700' :
                            li.loai_hang === 'TM' ? 'bg-blue-100 text-blue-700' :
                            'bg-slate-100 text-slate-500'
                          }`}>{li.loai_hang ?? '?'}</span>
                        </td>
                        <td className="px-2 py-1 font-mono text-slate-700">{li.bqms ?? '—'}</td>
                        <td className="px-2 py-1 text-slate-600 max-w-[180px] truncate" title={li.spec}>{li.spec ?? '—'}</td>
                        <td className="px-2 py-1 text-slate-600">{li.maker ?? '—'}</td>
                        <td className="px-2 py-1 text-right font-mono">{li.so_luong ?? 0}</td>
                        <td className="px-2 py-1 text-right font-mono text-emerald-600">
                          {li.suggested_price ? Number(li.suggested_price).toLocaleString('vi-VN') : '—'}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <input
                            type="number"
                            step="0.01"
                            placeholder={li.suggested_price ? String(li.suggested_price) : '—'}
                            value={editedPrices[li.bqms] ?? ''}
                            onChange={(e) => handlePriceChange(li.bqms, e.target.value)}
                            className="w-24 text-xs text-right font-mono border border-slate-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <ResultBadge result={li.result} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Generate + auto open PDF preview in new tabs */}
              <div className="flex items-center gap-2">
                <button onClick={handleGenerate}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors ${
                    flowType === 'tm'
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'bg-orange-600 hover:bg-orange-700'
                  }`}>
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Tao & xem truoc bao gia ({lookupItems.length} items)
                </button>
                <button onClick={() => setStep('config')}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                  Quay lai
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: Generating */}
      {step === 'generating' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold">3</span>
            Dang tao bao gia...
          </div>
          <div className="flex items-center gap-2 text-xs text-blue-600 pl-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            Tao CAM KET + Quotation Excel... chuyen PDF qua Gotenberg...
          </div>
        </div>
      )}

      {/* Step 4: Done — Full file listing + PDF Preview */}
      {step === 'done' && result && (
        <div className="space-y-3">
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold">4</span>
            Hoan thanh — {result.total_items ?? 0} items, {result.filled_items ?? 0} co gia
          </div>

          {/* File listing — detailed */}
          {result.files && result.files.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 border-b border-slate-200">
                <span className="text-xs font-semibold text-slate-700">Files da tao ({result.files.length} files)</span>
              </div>
              <div className="divide-y divide-slate-100">
                {result.files.map((f: any, i: number) => {
                  const isPdf = f.type?.includes('pdf');
                  const isExcel = f.type?.includes('xlsx');
                  const isCamKet = f.type?.includes('cam_ket');
                  const label = isCamKet ? 'CAM KET' : 'QUOTATION';
                  const format = isPdf ? 'PDF' : 'Excel (.xlsx)';
                  const downloadUrl = withToken(f.download_url || `/api/v1/quotations/download/${result.id}/${f.type}`);
                  const previewUrl = f.preview_url ? withToken(f.preview_url) : null;

                  const handleViewOnline = async () => {
                    try {
                      // For xlsx: use MS Office Online viewer with public share link
                      // For pdf: open directly
                      if (isExcel) {
                        const shareRes = await api.get<{ url: string }>(
                          `/api/v1/quotations/share-link/${result.id}/${f.type}`
                        );
                        const publicUrl = `${window.location.origin}${shareRes.url}`;
                        const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(publicUrl)}`;
                        window.open(viewerUrl, '_blank');
                      } else if (isPdf && previewUrl) {
                        window.open(previewUrl, '_blank');
                      }
                    } catch {
                      window.open(downloadUrl, '_blank');
                    }
                  };

                  return (
                    <div key={i} className="px-3 py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={`p-1.5 rounded ${isPdf ? 'bg-red-100' : 'bg-green-100'}`}>
                          {isPdf ? <Eye className="h-3.5 w-3.5 text-red-600" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-800">{label} — {format}</div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">{f.path || '—'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={handleViewOnline}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-white text-[11px] font-medium transition-colors ${
                            isExcel ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                          }`}>
                          <Eye className="h-3 w-3" />
                          {isExcel ? 'Xem Online' : 'Xem PDF'}
                        </button>
                        <a href={downloadUrl}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-brand-600 text-white text-[11px] font-medium hover:bg-brand-700 transition-colors">
                          <Download className="h-3 w-3" />
                          Tai ve
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Inline PDF Preview */}
          {previewPdfUrl && (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="bg-slate-800 px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Xem truoc PDF</span>
                <div className="flex items-center gap-2">
                  <a href={previewPdfUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] text-blue-300 hover:text-blue-100">Mo tab moi</a>
                  <button onClick={() => setPreviewPdfUrl(null)}
                    className="text-[11px] text-slate-400 hover:text-white">Dong</button>
                </div>
              </div>
              <iframe
                src={previewPdfUrl}
                className="w-full border-0 bg-slate-100"
                style={{ height: '600px' }}
                title="PDF Preview"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button onClick={() => { setStep('config'); setResult(null); setPreviewPdfUrl(null); setEditedPrices({}); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
              Tao bao gia moi
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {step === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-red-700">
            <XCircle className="h-4 w-4" />
            Loi tao bao gia
          </div>
          <div className="text-xs text-red-600">{result?.error ?? 'Loi khong xac dinh'}</div>
          <button onClick={() => setStep('preview')} className="text-[11px] text-red-600 underline">
            Thu lai
          </button>
        </div>
      )}
    </div>
  );
}

function RowDetailPanel({
  item,
  onClose,
  pageYear,
  pageMonth,
}: {
  item: RFQItem;
  onClose: () => void;
  pageYear?: number | null;
  pageMonth?: number | null;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['rfq-history', item.id],
    queryFn: () => api.get<{ data: QuotationHistoryItem[]; total: number }>(`/api/v1/bqms/rfq/${item.id}/history`),
    enabled: showHistory,
    staleTime: 30_000,
  });

  const history: QuotationHistoryItem[] = historyData?.data ?? [];

  const handleCopyRFQ = () => {
    const code = item.rfq_number ?? item.bqms_code ?? '';
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  return (
    <tr className="border-b border-brand-100 bg-brand-50/30">
      <td colSpan={15} className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-3">
          {/* Info grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block">RFQ No.</span>
              <span className="font-mono font-semibold text-brand-700">{item.rfq_number ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">BQMS Code</span>
              <span className="font-mono text-slate-700">{item.bqms_code ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Tên hàng / Spec</span>
              <span className="text-slate-700 line-clamp-2">{item.specification ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Maker</span>
              <span className="text-slate-700">{item.maker ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Số lượng</span>
              <span className="font-mono text-slate-700">
                {fmtNum(item.expected_qty)} {item.unit ?? ''}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Giá mua RMB</span>
              <span className="font-mono text-slate-700">{fmtVnd(item.purchase_price_rmb)}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Giá mua VND</span>
              <span className="font-mono text-slate-700">{fmtVnd(item.purchase_price_vnd)}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Giá AMA</span>
              <span className="font-mono text-slate-700">{fmtVnd(item.quoted_price_ama)}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Nhà cung cấp</span>
              <span className="text-slate-700">{item.supplier_name ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Người phụ trách</span>
              <span className="text-slate-700">{item.person_in_charge_name ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Ngày inquiry</span>
              <span className="text-slate-700">
                {item.inquiry_date ? formatDate(item.inquiry_date) : '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Kết quả</span>
              <ResultBadge result={item.result} />
            </div>
            {item.notes && (
              <div className="col-span-2 md:col-span-4">
                <span className="text-slate-400 block">Ghi chú</span>
                <span className="text-slate-700">{item.notes}</span>
              </div>
            )}
            {item.report && (
              <div className="col-span-2 md:col-span-4">
                <span className="text-slate-400 block">Báo cáo</span>
                <span className="text-slate-700">{item.report}</span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap border-t border-brand-100 pt-2">
            <button
              onClick={() => { setShowCreateForm((v) => !v); setShowHistory(false); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {showCreateForm ? 'Ẩn tạo BG' : 'Tạo báo giá'}
            </button>

            <button
              onClick={() => { setShowHistory((v) => !v); setShowCreateForm(false); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <History className="h-3.5 w-3.5" />
              {showHistory ? 'Ẩn lịch sử BG' : 'Xem lịch sử BG'}
            </button>

            <button
              onClick={handleCopyRFQ}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Đã copy!' : 'Copy RFQ code'}
            </button>

            <Link
              href={`/bqms/quotation/new?rfq_code=${encodeURIComponent(item.rfq_number ?? '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Mở tab mới
            </Link>

            <button
              onClick={onClose}
              className="ml-auto text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
            >
              Đóng
            </button>
          </div>

          {/* Inline Create Quotation Form */}
          {showCreateForm && (
            <InlineCreateQuotation item={item} pageYear={pageYear} pageMonth={pageMonth} />
          )}

          {/* Quotation history — with file listing */}
          {showHistory && (
            <div className="border-t border-brand-100 pt-2 space-y-2">
              <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" />
                Lich su bao gia — {item.rfq_number}
              </h4>
              {historyLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Dang tai...
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">Chua co bao gia nao cho RFQ nay.</p>
              ) : (
                <div className="space-y-2">
                  {history.map((h: any) => (
                    <div key={h.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                      {/* Header */}
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="font-mono font-bold text-brand-700">#{h.id}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            h.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                            h.status === 'failed' ? 'bg-red-100 text-red-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>{h.status}</span>
                          <span className="text-slate-500">{h.total_items ?? 0} items, {h.filled_items ?? 0} co gia</span>
                        </div>
                        <span className="text-[11px] text-slate-400">{h.created_at ? formatDate(h.created_at) : ''}</span>
                      </div>
                      {/* Files */}
                      {h.files && h.files.length > 0 ? (
                        <div className="divide-y divide-slate-100">
                          {h.files.map((f: any, fi: number) => {
                            const isPdf = f.type?.includes('pdf');
                            const isCamKet = f.type?.includes('cam_ket');
                            const sizeKB = f.size ? Math.round(f.size / 1024) : 0;
                            return (
                              <div key={fi} className="px-3 py-2 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <div className={`p-1 rounded ${isPdf ? 'bg-red-100' : 'bg-green-100'}`}>
                                    {isPdf ? <Eye className="h-3 w-3 text-red-600" /> : <FileSpreadsheet className="h-3 w-3 text-green-600" />}
                                  </div>
                                  <div className="min-w-0">
                                    <span className="text-xs font-medium text-slate-800">
                                      {isCamKet ? 'CAM KET' : 'QUOTATION'} {isPdf ? '.pdf' : '.xlsx'}
                                    </span>
                                    <span className="text-[10px] text-slate-400 ml-2">{sizeKB} KB</span>
                                    <div className="text-[9px] text-slate-400 font-mono truncate">{f.filename}</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {isPdf && f.preview_url && (
                                    <a href={withToken(f.preview_url)} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-white text-[10px] font-medium hover:bg-red-700">
                                      <Eye className="h-3 w-3" /> Mo PDF
                                    </a>
                                  )}
                                  <a href={withToken(f.download_url)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-brand-600 text-white text-[10px] font-medium hover:bg-brand-700">
                                    <Download className="h-3 w-3" /> Tai ve
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="px-3 py-2 text-xs text-slate-400">Khong co file</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Month Group Header ───────────────────────────────────────────────────────

function MonthGroupHeader({
  summary,
  collapsed,
  onToggle,
}: {
  summary: MonthSummary;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr
      className="bg-slate-50 border-y border-slate-200 cursor-pointer select-none sticky top-[41px] z-10"
      onClick={onToggle}
    >
      <td colSpan={15} className="px-4 py-2">
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          )}
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
            {monthLabel(summary.year, summary.month)}
          </span>
          <span className="text-xs text-slate-400 ml-1">
            — {summary.count.toLocaleString('vi-VN')} RFQ
          </span>
          {summary.won > 0 && (
            <span className="text-xs text-emerald-600 font-medium">
              ({summary.won} trúng
            </span>
          )}
          {summary.won > 0 && summary.lost > 0 && (
            <span className="text-xs text-red-500 font-medium">, {summary.lost} trượt)</span>
          )}
          {summary.won > 0 && summary.lost === 0 && (
            <span className="text-xs text-emerald-600 font-medium">)</span>
          )}
          {summary.won === 0 && summary.lost > 0 && (
            <span className="text-xs text-red-500 font-medium">({summary.lost} trượt)</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Table Skeleton ───────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <tbody>
      {Array.from({ length: 12 }).map((_, i) => (
        <tr key={i} className="border-b border-slate-100">
          {Array.from({ length: 14 }).map((_, j) => (
            <td key={j} className="px-3 py-2.5">
              <div
                className="h-3.5 bg-slate-200 rounded animate-pulse"
                style={{ width: `${40 + ((i * 7 + j * 13) % 60)}%`, opacity: 0.6 + (j % 4) * 0.1 }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BQMSPage() {
  const queryClient = useQueryClient();

  // ── Filter state
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number | null>(currentYear);
  const [month, setMonth] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [resultFilter, setResultFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  // ── UI state
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  // ── Build query string
  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (year) p.set('year', String(year));
    if (month) p.set('month', String(month));
    if (search) p.set('search', search);
    if (resultFilter && resultFilter !== 'all') p.set('result_filter', resultFilter);
    p.set('page', String(page));
    p.set('page_size', '100');
    return p.toString();
  }, [year, month, search, resultFilter, page]);

  // ── Data query
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['bqms-rfq-table', year, month, search, resultFilter, page],
    queryFn: () =>
      api.get<RFQTableResponse>(`/api/v1/bqms/rfq-table?${buildParams()}`),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 2,
  });

  const items: RFQItem[] = Array.isArray(data?.data?.items) ? data!.data.items : [];
  const total = data?.data?.total ?? 0;
  const totalPages = data?.data?.total_pages ?? 1;
  const kpis = data?.data?.kpis;
  const months: MonthSummary[] = Array.isArray(data?.data?.months) ? data!.data.months : [];

  // ── Inline price update mutation
  const priceMutation = useMutation({
    mutationFn: ({ rowId, field, value }: { rowId: number; field: string; value: string }) =>
      api.patch<{ message: string }>(`/api/v1/bqms/rfq/${rowId}/price`, { field, value: value === '' ? null : Number(value) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
      setEditingCell(null);
    },
    onError: () => {
      setEditingCell(null);
    },
  });

  const handleSaveCell = useCallback(
    (rowId: number, field: string, value: string) => {
      priceMutation.mutate({ rowId, field, value });
    },
    [priceMutation]
  );

  const handleCancelCell = useCallback(() => {
    setEditingCell(null);
  }, []);

  // ── Month collapse
  const toggleMonth = useCallback((key: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Group items by month using the months metadata from API
  // Build a map: "YYYY-M" -> items[]
  const itemsByMonth = new Map<string, RFQItem[]>();
  for (const item of items) {
    const d = item.effective_date ?? item.inquiry_date ?? item.created_at ?? '';
    if (!d) {
      const key = 'unknown';
      itemsByMonth.set(key, [...(itemsByMonth.get(key) ?? []), item]);
      continue;
    }
    const dt = new Date(d);
    const key = isNaN(dt.getTime()) ? 'unknown' : `${dt.getFullYear()}-${dt.getMonth() + 1}`;
    itemsByMonth.set(key, [...(itemsByMonth.get(key) ?? []), item]);
  }

  // ── Search submit
  const handleSearchSubmit = () => {
    setSearch(searchInput);
    setPage(1);
  };

  // ── Filter change resets page
  const handleYearChange = (v: number | null) => { setYear(v); setPage(1); };
  const handleMonthChange = (v: number | null) => { setMonth(v); setPage(1); };
  const handleResultChange = (v: string) => { setResultFilter(v); setPage(1); };

  // ── Row click
  const handleRowClick = (id: number) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
  };

  // ── Global row counter (for # column)
  let rowCounter = (page - 1) * 100;

  return (
    <div className="flex flex-col gap-4 min-h-0 pb-8">
      {/* ── Samsung Sync Widget */}
      <SamsungSyncWidget />

      {/* ── Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-100 rounded-lg">
            <ClipboardList className="h-5 w-5 text-brand-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">BQMS — Quản lý RFQ Samsung</h1>
            <div className="flex items-center gap-3 flex-wrap mt-1">
              <span className="text-xs text-slate-500">
                {total.toLocaleString('vi-VN')} bản ghi
                {isFetching && !isLoading && (
                  <span className="ml-2 text-brand-500">
                    <Loader2 className="inline h-3 w-3 animate-spin mr-0.5" />
                    Đang cập nhật...
                  </span>
                )}
              </span>
              <SyncFreshnessChip module="bqms" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Làm mới
          </button>
          <Link
            href="/bqms/quotation/new"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            Tạo báo giá
          </Link>
        </div>
      </div>

      {/* ── KPI Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard
          label="Tổng RFQ (bộ lọc)"
          value={(kpis?.total_month ?? total).toLocaleString('vi-VN')}
          icon={ClipboardList}
          colorClass="bg-brand-100 text-brand-600"
          loading={isLoading}
        />
        <KPICard
          label="Trúng thầu"
          value={(kpis?.won ?? 0).toLocaleString('vi-VN')}
          icon={CheckCircle2}
          colorClass="bg-emerald-100 text-emerald-600"
          loading={isLoading}
        />
        <KPICard
          label="Trượt thầu"
          value={(kpis?.lost ?? 0).toLocaleString('vi-VN')}
          icon={XCircle}
          colorClass="bg-red-100 text-red-600"
          loading={isLoading}
        />
        <KPICard
          label="Đang xử lý"
          value={(kpis?.pending ?? 0).toLocaleString('vi-VN')}
          icon={Clock}
          colorClass="bg-amber-100 text-amber-600"
          loading={isLoading}
        />
        <KPICard
          label="Win rate"
          value={`${kpis?.win_rate ?? 0}%`}
          icon={Percent}
          colorClass="bg-violet-100 text-violet-600"
          loading={isLoading}
          sub={kpis ? `${kpis.won}/${kpis.won + kpis.lost} đã xử lý` : undefined}
        />
      </div>

      {/* ── Filter Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 px-4 py-3 flex flex-wrap items-center gap-3">
        {/* Year */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 whitespace-nowrap">Năm:</span>
          <select
            value={year ?? ''}
            onChange={(e) => handleYearChange(e.target.value ? Number(e.target.value) : null)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Tất cả</option>
            {[2026, 2025, 2024, 2023].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Month */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 whitespace-nowrap">Tháng:</span>
          <select
            value={month ?? ''}
            onChange={(e) => handleMonthChange(e.target.value ? Number(e.target.value) : null)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Tất cả</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>Tháng {m}</option>
            ))}
          </select>
        </div>

        {/* Result filter */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 overflow-hidden">
          {[
            { val: 'all', label: 'Tất cả' },
            { val: 'pending', label: 'Đang xử lý' },
            { val: 'won', label: 'Trúng' },
            { val: 'lost', label: 'Trượt' },
          ].map(({ val, label }) => (
            <button
              key={val}
              onClick={() => handleResultChange(val)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                resultFilter === val
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="RFQ No, BQMS Code, tên hàng, maker..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button
            onClick={handleSearchSubmit}
            className="px-3 py-1.5 text-xs font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
          >
            Tìm
          </button>
          {search && (
            <button
              onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
              className="px-2.5 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Xóa
            </button>
          )}
        </div>
      </div>

      {/* ── Main Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <AlertTriangle className="h-8 w-8 text-red-400" />
            <p className="text-sm text-slate-600">Không thể tải dữ liệu. Vui lòng thử lại.</p>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] })}
              className="mt-1 text-xs text-brand-600 hover:underline"
            >
              Thử lại
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              {/* Sticky header */}
              <thead className="sticky top-0 z-20">
                <tr className="bg-slate-800 text-slate-200">
                  <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap w-10">#</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">Ngày</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">Người PT</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">RFQ No.</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">BQMS Code</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Tên hàng</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">Maker</th>
                  <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap">SL</th>
                  <th className="text-right px-2 py-2.5 font-semibold whitespace-nowrap">Giá V1</th>
                  <th className="text-right px-2 py-2.5 font-semibold whitespace-nowrap">Giá V2</th>
                  <th className="text-right px-2 py-2.5 font-semibold whitespace-nowrap">Giá V3</th>
                  <th className="text-right px-2 py-2.5 font-semibold whitespace-nowrap">Giá V4</th>
                  <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap">Kết quả</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">NCC</th>
                </tr>
              </thead>

              {isLoading ? (
                <TableSkeleton />
              ) : items.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={14} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-300">
                        <Inbox className="h-10 w-10" />
                        <p className="text-sm text-slate-400">Không có dữ liệu phù hợp</p>
                        {(search || resultFilter !== 'all' || year || month) && (
                          <button
                            onClick={() => {
                              setSearch('');
                              setSearchInput('');
                              setResultFilter('all');
                              setYear(null);
                              setMonth(null);
                              setPage(1);
                            }}
                            className="text-xs text-brand-600 hover:underline mt-1"
                          >
                            Xóa bộ lọc
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                </tbody>
              ) : (
                <tbody className="divide-y divide-slate-100">
                  {months.length > 0
                    ? // Render with month group headers
                      months.map((ms) => {
                        const monthKey = `${ms.year}-${ms.month}`;
                        const monthItems = itemsByMonth.get(monthKey) ?? [];
                        if (monthItems.length === 0) return null;
                        const collapsed = collapsedMonths.has(monthKey);

                        return (
                          <MonthGroupSection
                            key={monthKey}
                            summary={ms}
                            items={monthItems}
                            collapsed={collapsed}
                            onToggle={() => toggleMonth(monthKey)}
                            expandedRowId={expandedRowId}
                            onRowClick={handleRowClick}
                            editingCell={editingCell}
                            onStartEdit={setEditingCell}
                            onSaveCell={handleSaveCell}
                            onCancelCell={handleCancelCell}
                            rowCounterStart={rowCounter}
                            pageYear={year}
                            pageMonth={month}
                          />
                        );
                      })
                    : // Fallback: flat list without month headers
                      items.map((item, idx) => {
                        rowCounter++;
                        const urgency = getUrgency(item);
                        const isExpanded = expandedRowId === item.id;
                        return (
                          <DataRow
                            key={item.id}
                            item={item}
                            idx={rowCounter}
                            urgency={urgency}
                            isExpanded={isExpanded}
                            onRowClick={handleRowClick}
                            editingCell={editingCell}
                            onStartEdit={setEditingCell}
                            onSaveCell={handleSaveCell}
                            onCancelCell={handleCancelCell}
                            pageYear={year}
                            pageMonth={month}
                          />
                        );
                      })}
                </tbody>
              )}
            </table>
          </div>
        )}

        {/* ── Pagination */}
        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
            <p className="text-xs text-slate-500">
              Trang {page}/{totalPages} · {total.toLocaleString('vi-VN')} bản ghi
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {/* Page number buttons (show up to 7) */}
              {(() => {
                const start = Math.max(1, page - 3);
                const end = Math.min(totalPages, start + 6);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={cn(
                      'w-7 h-7 rounded-lg text-xs font-medium transition-colors border',
                      p === page
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    )}
                  >
                    {p}
                  </button>
                ));
              })()}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronDown className="h-4 w-4 rotate-[-90deg]" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Double-click tip */}
      <p className="text-xs text-slate-400 text-center">
        Double-click vào ô Giá V1–V4 để chỉnh sửa trực tiếp · Enter để lưu · Escape để hủy
      </p>
    </div>
  );
}

// ─── Month Group Section (extracted for clean rendering) ──────────────────────

function MonthGroupSection({
  summary,
  items,
  collapsed,
  onToggle,
  expandedRowId,
  onRowClick,
  editingCell,
  onStartEdit,
  onSaveCell,
  onCancelCell,
  rowCounterStart,
  pageYear,
  pageMonth,
}: {
  summary: MonthSummary;
  items: RFQItem[];
  collapsed: boolean;
  onToggle: () => void;
  expandedRowId: number | null;
  onRowClick: (id: number) => void;
  editingCell: EditingCell | null;
  onStartEdit: (cell: EditingCell) => void;
  onSaveCell: (rowId: number, field: string, value: string) => void;
  onCancelCell: () => void;
  rowCounterStart: number;
  pageYear?: number | null;
  pageMonth?: number | null;
}) {
  return (
    <>
      <MonthGroupHeader summary={summary} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed &&
        items.map((item, idx) => {
          const urgency = getUrgency(item);
          const isExpanded = expandedRowId === item.id;
          return (
            <DataRow
              key={item.id}
              item={item}
              idx={rowCounterStart + idx + 1}
              urgency={urgency}
              isExpanded={isExpanded}
              onRowClick={onRowClick}
              editingCell={editingCell}
              onStartEdit={onStartEdit}
              onSaveCell={onSaveCell}
              onCancelCell={onCancelCell}
              pageYear={pageYear}
              pageMonth={pageMonth}
            />
          );
        })}
    </>
  );
}

// ─── Data Row ─────────────────────────────────────────────────────────────────

function DataRow({
  item,
  idx,
  urgency,
  isExpanded,
  onRowClick,
  editingCell,
  onStartEdit,
  onSaveCell,
  onCancelCell,
  pageYear,
  pageMonth,
}: {
  item: RFQItem;
  idx: number;
  urgency: 'red' | 'amber' | null;
  isExpanded: boolean;
  onRowClick: (id: number) => void;
  editingCell: EditingCell | null;
  onStartEdit: (cell: EditingCell) => void;
  onSaveCell: (rowId: number, field: string, value: string) => void;
  onCancelCell: () => void;
  pageYear?: number | null;
  pageMonth?: number | null;
}) {
  const dateStr = item.effective_date ?? item.inquiry_date ?? item.created_at ?? '';

  return (
    <>
      <tr
        onClick={() => onRowClick(item.id)}
        className={cn(
          'border-b border-slate-100 transition-colors cursor-pointer text-xs',
          isExpanded ? 'bg-brand-50/50' : 'hover:bg-slate-50/70',
          urgency === 'red' && !isExpanded ? 'bg-red-50/40' : '',
          urgency === 'amber' && !isExpanded ? 'bg-amber-50/25' : ''
        )}
      >
        {/* # */}
        <td className="px-3 py-2 text-center text-slate-400 tabular-nums w-10 select-none">
          {idx}
        </td>

        {/* Ngày */}
        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
          <div className="flex items-center gap-1">
            {urgency === 'red' && <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />}
            {urgency === 'amber' && <Clock className="h-3 w-3 text-amber-500 flex-shrink-0" />}
            {dateStr ? formatDate(dateStr) : '—'}
          </div>
        </td>

        {/* Người PT */}
        <td className="px-3 py-2 text-slate-600 whitespace-nowrap max-w-[100px]">
          <span className="truncate block">{item.person_in_charge_name ?? '—'}</span>
        </td>

        {/* RFQ No. */}
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="font-mono text-brand-600 font-medium">{item.rfq_number ?? '—'}</span>
        </td>

        {/* BQMS Code */}
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="font-mono text-slate-600">{item.bqms_code ?? '—'}</span>
        </td>

        {/* Tên hàng */}
        <td className="px-3 py-2 max-w-[200px]">
          <span className="text-slate-800 truncate block" title={item.specification ?? ''}>
            {item.specification ?? '—'}
          </span>
        </td>

        {/* Maker */}
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="text-slate-600">{item.maker ?? '—'}</span>
        </td>

        {/* SL */}
        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
          {item.expected_qty != null ? Number(item.expected_qty).toLocaleString('vi-VN') : '—'}
          {item.unit ? <span className="text-slate-400 ml-0.5">{item.unit}</span> : null}
        </td>

        {/* Giá V1 */}
        <PriceCell
          item={item}
          field="quoted_price_bqms_v1"
          value={item.quoted_price_bqms_v1}
          editingCell={editingCell}
          onStartEdit={onStartEdit}
          onSave={onSaveCell}
          onCancel={onCancelCell}
        />

        {/* Giá V2 */}
        <PriceCell
          item={item}
          field="quoted_price_bqms_v2"
          value={item.quoted_price_bqms_v2}
          editingCell={editingCell}
          onStartEdit={onStartEdit}
          onSave={onSaveCell}
          onCancel={onCancelCell}
        />

        {/* Giá V3 */}
        <PriceCell
          item={item}
          field="quoted_price_bqms_v3"
          value={item.quoted_price_bqms_v3}
          editingCell={editingCell}
          onStartEdit={onStartEdit}
          onSave={onSaveCell}
          onCancel={onCancelCell}
        />

        {/* Giá V4 */}
        <PriceCell
          item={item}
          field="quoted_price_bqms_v4"
          value={item.quoted_price_bqms_v4}
          editingCell={editingCell}
          onStartEdit={onStartEdit}
          onSave={onSaveCell}
          onCancel={onCancelCell}
        />

        {/* Kết quả */}
        <td className="px-3 py-2 text-center whitespace-nowrap">
          <ResultBadge result={item.result} />
        </td>

        {/* NCC */}
        <td className="px-3 py-2 text-slate-600 whitespace-nowrap max-w-[120px]">
          <span className="truncate block">{item.supplier_name ?? '—'}</span>
        </td>
      </tr>

      {/* Expanded detail panel */}
      {isExpanded && (
        <RowDetailPanel item={item} onClose={() => onRowClick(item.id)} pageYear={pageYear} pageMonth={pageMonth} />
      )}
    </>
  );
}
