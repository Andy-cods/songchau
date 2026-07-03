'use client';

import { useState, useCallback, useEffect, useRef, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
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
  Trash2,
  ArrowLeft,
  ArrowRight,
  Settings,
  Wrench,
  Layers,
  ListChecks,
  FileText, Package2, Hash, Building2, User2, Calendar,
  DollarSign, Tag, ShoppingBag, FileSignature, Factory,
  Pencil,
  RotateCcw,
  Send,
  Gavel,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '@/lib/api';
import { toast } from 'sonner';
// Disabled 2026-05-04 with Samsung portal scrape; uncomment when re-enabled.
// import { SamsungSyncWidget } from '@/components/features/SamsungSyncWidget';
// SyncFreshnessChip removed 2026-05-29 per Thang — chip "Đồng bộ N ngày trước" không cần ở /bqms
import { cn, formatDate } from '@/lib/utils';
// PR-2 (Thang 2026-05-13): BqmsImageThumb extracted to @/components/bqms-images
import { BqmsImageThumb } from '@/components/bqms-images/BqmsImageThumb';
import PushToSecModal from '@/components/bqms/PushToSecModal';
import PushProgressPopup from '@/components/bqms/PushProgressPopup';
import { BatchPushSecModal } from '@/components/bqms/BatchPushSecModal';
// Issue B (Thang 2026-06-19): surface V-round push state in RFQ cell + drawer
import PushRoundBadge from '@/components/bqms/PushRoundBadge';
import RoundHistoryTimeline from '@/components/bqms/RoundHistoryTimeline';
// Phase G (Thang 2026-05-13): Smart Code-Track panel
import { SmartCodeTrackPanel } from '@/components/bqms-images/SmartCodeTrackPanel';
import { useIsReadOnly, useUserRole } from '@/hooks/use-permissions';
import { PushToBiddingModal } from '@/components/sourcing/PushToBiddingModal';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RFQItem {
  id: number;
  rfq_number: string | null;
  bqms_code: string | null;
  description: string | null;
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
  // Phase 2 (2026-05-12): scraped from xlsx Basic Information + auto-tracklog
  requester: string | null;
  department: string | null;
  assigned_to: string | null;          // UUID of ERP user who quoted (auto-tracked)
  assigned_to_name: string | null;     // users.full_name (JOIN'd in backend)
  // Phase E (2026-05-13): user-editable classification override
  classification_override: string | null;       // 'TM'|'GC'|null
  classification_is_override?: boolean;
  classification_auto?: string | null;
  // Phase H (2026-05-13): V1-V4 buttons khóa cho tới khi user click "Báo giá".
  // Scrape upsert rows với quote_unlocked=false (mặc định), click "Báo giá" set =true.
  quote_unlocked?: boolean;
  inquiry_date: string | null;
  effective_date: string | null;
  created_at: string | null;
  version?: number | null;
  data_source?: string | null;
  // Round-2 priority (Thang 2026-05-18 — auto-push to top when version≥2 + audit 7d)
  round2_recent_at?: string | null;
  is_round2_24h?: boolean;
  is_round2_priority?: boolean;
  // Smart quote scenario (Thang 2026-05-18 — TH1/TH2/TH3 classification)
  scenario?: 'TH1' | 'TH2' | 'TH3';
  scenario_default_round?: number;   // form-create default (when user clicks "Báo giá")
  pushable_round?: number;            // PUSH default — highest filled V (Thang 2026-05-20)
  // Thang 2026-06-04 (BUG B): push-to-SEC status surfaced on row so the
  // re-push button stays available even if quote_unlocked re-locks after
  // a later round lands. saved_temp = previously pushed → re-push allowed.
  bqms_push_status?: string | null;
  bqms_pushed_round?: number | null;
  // Thang 2026-06-15 (Batch 2f): ngày đẩy báo giá lên SEC — hiển thị thay cột STT "#".
  bqms_pushed_at?: string | null;
  scenario_meta?: {
    label: string;
    tooltip: string;
    badge_color: string;
    wizard_intro: string;
  };
  // Per Thang 2026-05-11: pending bidding rows merged into BQMS table.
  is_pending?: boolean;
  staging_id?: number;
  req_name?: string | null;
  reg_dt?: string | null;
  deadline_dt?: string | null;
  submit_dt?: string | null;
  bd_status?: string | null;
  psincharge_name?: string | null;
  currency?: string | null;
  item_cnt_text?: string | null;
  dday_html?: string | null;
  ctr_type_nm?: string | null;
  classification?: string | null;
  detail_version?: string | number | null;
  items_count?: number | null;
  attachments_count?: number | null;
  detail_error?: string | null;
  first_maker?: string | null;
  first_part_no?: string | null;
  first_cis_code?: string | null;
  first_moq?: string | null;
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

// Convert absolute onedrive-staging path → relative path used by /documents/browser.
// Backend returns "/data/onedrive-staging/Puplic/BQMS/RFQ/RFQ 2026/THANG 5/QT26061473"
// Browser expects "Puplic/BQMS/RFQ/RFQ 2026/THANG 5/QT26061473".
function toBrowserPath(absPath: string): string {
  const prefix = '/data/onedrive-staging/';
  if (absPath.startsWith(prefix)) return absPath.slice(prefix.length);
  return absPath.replace(/^\/+/, '');
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

// ─── Status Dot (color-only, no text) per Thang 2026-05-11 ───────────────────
//
// Replaces the verbose "Chờ báo / Trúng / Trượt" badges with a single colored
// circle in a sticky-left column. Hover-tooltip carries the human label.

function StatusDot({ item }: { item: RFQItem }) {
  let color = 'bg-slate-300';
  let title = 'Chưa xác định';
  if (item.is_pending) {
    color = 'bg-amber-500'; title = 'Chờ báo (pending bidding)';
  } else {
    const r = (item.result ?? '').toLowerCase();
    if (r === 'won')      { color = 'bg-emerald-500'; title = 'Trúng thầu'; }
    else if (r === 'lost') { color = 'bg-red-500'; title = 'Trượt'; }
    else if (r === 'pending') { color = 'bg-amber-500'; title = 'Đang xử lý'; }
    else if (r === 'submitted') { color = 'bg-blue-500'; title = 'Đã nộp'; }
    else { color = 'bg-slate-300'; title = 'Chưa rõ'; }
  }
  return (
    <span
      className={cn('inline-block w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm', color)}
      title={title}
    />
  );
}

function fmtDateShort(iso?: string | null): string | null {
  if (!iso) return null;
  // Strip BQMS "(GMT+07:00) " prefix; keep d/m or full
  const s = iso.replace(/^\(GMT[^)]+\)\s*/, '').trim();
  // ISO 8601 (yyyy-mm-dd, incl. TIMESTAMPTZ .isoformat()): year=m[1] month=m[2] day=m[3].
  const isoM = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoM) return `${isoM[3]}/${isoM[2]}`;
  // Samsung text date is M/D/Y: month=m[1] day=m[2] → output dd/mm.
  const vnM = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (vnM) return `${vnM[2].padStart(2, '0')}/${vnM[1].padStart(2, '0')}`;
  return s.slice(0, 8);
}

function fmtDeadline(s?: string | null): string {
  if (!s) return '—';
  // "(GMT+07:00) 5/12/2026 17:00" → "12/05 17h"
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/\d{4}\s+(\d{1,2}):(\d{2})/);
  if (m) {
    const dd = m[2].padStart(2, '0');
    const mm = m[1].padStart(2, '0');
    return `${dd}/${mm} ${m[3]}h${m[4] === '00' ? '' : m[4]}`;
  }
  return s.length > 14 ? s.slice(0, 14) : s;
}

/** Parse a deadline string ("(GMT+07:00) 5/12/2026 17:00" M/D/Y, or ISO
 *  yyyy-mm-dd) into a date-only Date (local midnight). null if unparseable. */
function parseDeadlineDate(s?: string | null): Date | null {
  if (!s) return null;
  const str = s.replace(/^\(GMT[^)]+\)\s*/, '').trim();
  let yy = 0, mm = 0, dd = 0;
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) { yy = +iso[1]; mm = +iso[2]; dd = +iso[3]; }
  else {
    const v = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // Samsung M/D/Y
    if (!v) return null;
    mm = +v[1]; dd = +v[2]; yy = +v[3];
  }
  if (!yy || !mm || !dd) return null;
  return new Date(yy, mm - 1, dd);
}

/** Whole calendar days from today until `deadline` (date-only). 0 = today. */
function daysUntilDeadline(deadline: Date): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((deadline.getTime() - today.getTime()) / 86400000);
}

/** Live D-N as plain text (for the detail panel): D-2 / D-1 / D-Day / Closed. */
function ddayText(deadlineRaw?: string | null, fallback?: string | null): string {
  const dl = parseDeadlineDate(deadlineRaw);
  if (dl) {
    const n = daysUntilDeadline(dl);
    return n < 0 ? 'Closed' : n === 0 ? 'D-Day' : `D-${n}`;
  }
  return (fallback ?? '').replace(/<[^>]+>/g, '') || '—';
}

/** "Closed" must follow the LIVE deadline, not a stale result enum: closed only
 *  when the deadline is actually past; if the deadline is unparseable, fall back
 *  to the result flag. (Thang 2026-06-24: re-opened V2 RFQs kept stale result='closed'.) */
function isLiveClosed(deadlineRaw?: string | null, result?: string | null): boolean {
  const dl = parseDeadlineDate(deadlineRaw);
  if (dl) return daysUntilDeadline(dl) < 0;
  return (result ?? '').toLowerCase() === 'closed';
}

const _ddayCls = (n: number) =>
  n <= 2 ? 'bg-red-100 text-red-700 border-red-200'
  : n <= 4 ? 'bg-amber-100 text-amber-700 border-amber-200'
           : 'bg-slate-100 text-slate-600 border-slate-200';

/** D-N countdown badge — computed LIVE from the deadline vs TODAY (Thang
 *  2026-06-17): D-2 = còn 2 ngày, D-1 = còn 1 ngày, D-Day = hết hạn hôm nay;
 *  quá hạn (hôm sau) → Closed. Re-evaluates every render so it auto-counts-down
 *  instead of showing the stale value frozen at scrape time. Falls back to the
 *  scraped D-N string only when the deadline can't be parsed. */
function ddayBadge(deadlineRaw?: string | null, result?: string | null, ddayHtmlFallback?: string | null) {
  const closedBadge = (
    <span className="inline-flex px-1.5 py-0 text-[11px] font-bold rounded border bg-slate-200 text-slate-700 border-slate-300">
      Closed
    </span>
  );
  const dl = parseDeadlineDate(deadlineRaw);
  if (dl) {
    const n = daysUntilDeadline(dl);
    if (n < 0) return closedBadge; // quá hạn → đóng (hôm sau D-Day)
    const label = n === 0 ? 'D-Day' : `D-${n}`;
    return (
      <span
        className={cn('inline-flex px-1.5 py-0 text-[11px] font-bold rounded border', _ddayCls(n))}
        title={deadlineRaw ?? ''}
      >
        {label}
      </span>
    );
  }

  // Deadline unparseable → only now trust the backend-finalized 'closed' flag.
  if ((result ?? '').toLowerCase() === 'closed') return closedBadge;

  // Fallback: stale scraped D-N string (only when no parseable deadline_dt).
  if (!ddayHtmlFallback) return <span className="text-slate-500">—</span>;
  const txt = ddayHtmlFallback.replace(/<[^>]+>/g, '').trim();
  if (!txt) return <span className="text-slate-500">—</span>;
  const num = parseInt(txt.replace(/[^\d]/g, '') || '99', 10);
  return (
    <span className={cn('inline-flex px-1.5 py-0 text-[11px] font-bold rounded border', _ddayCls(num))}>
      {txt}
    </span>
  );
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
  // TM edit form: per-bqms field overrides + image cache-bust version
  const [tmEditedFields, setTmEditedFields] = useState<Record<string, { spec?: string; maker?: string; so_luong?: string }>>({});
  const [tmImageVer, setTmImageVer] = useState<Record<string, number>>({});
  const [tmImageUploading, setTmImageUploading] = useState<Record<string, boolean>>({});
  const tmImageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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

  const handleTmFieldChange = (bqmsCode: string, field: 'spec' | 'maker' | 'so_luong', value: string) => {
    setTmEditedFields(prev => ({
      ...prev,
      [bqmsCode]: { ...prev[bqmsCode], [field]: value },
    }));
  };

  const handleTmImageReplace = async (bqmsCode: string, file: File) => {
    const rfqNumber = item.rfq_number ?? '';
    if (!rfqNumber || !bqmsCode) {
      toast.error('Thiếu RFQ number hoặc mã BQMS');
      return;
    }
    setTmImageUploading(p => ({ ...p, [bqmsCode]: true }));
    try {
      const fd = new FormData();
      fd.append('rfq_number', rfqNumber);
      fd.append('bqms_code', bqmsCode);
      fd.append('slot', 'product_photo');
      fd.append('file', file);
      await api.upload('/api/v1/bqms/quote-image-override', fd);
      // Bump version → cache-bust thumbnail
      setTmImageVer(p => ({ ...p, [bqmsCode]: (p[bqmsCode] ?? 0) + 1 }));
      toast.success(`Đã đổi ảnh cho ${bqmsCode}`);
    } catch (err: any) {
      toast.error(err?.detail ?? 'Đổi ảnh thất bại');
    } finally {
      setTmImageUploading(p => ({ ...p, [bqmsCode]: false }));
    }
  };

  const handleTmImageReset = async (bqmsCode: string) => {
    const rfqNumber = item.rfq_number ?? '';
    if (!rfqNumber || !bqmsCode) return;
    try {
      await api.delete(
        `/api/v1/bqms/quote-image-override?rfq_number=${encodeURIComponent(rfqNumber)}&bqms_code=${encodeURIComponent(bqmsCode)}&slot=product_photo`,
      );
      setTmImageVer(p => ({ ...p, [bqmsCode]: (p[bqmsCode] ?? 0) + 1 }));
      toast.success(`Đã khôi phục ảnh gốc cho ${bqmsCode}`);
    } catch (err: any) {
      toast.error(err?.detail ?? 'Khôi phục ảnh thất bại');
    }
  };

  const handleGenerate = async () => {
    setStep('generating');
    try {
      // Merge edited fields + prices into items
      const itemsToSend = lookupItems.length > 0
        ? lookupItems.map((li: any) => {
            const code = li.bqms;
            const edits = tmEditedFields[code] ?? {};
            return {
              ...li,
              spec: edits.spec !== undefined ? edits.spec : li.spec,
              maker: edits.maker !== undefined ? edits.maker : li.maker,
              so_luong: edits.so_luong !== undefined && edits.so_luong !== ''
                ? Number(edits.so_luong)
                : li.so_luong,
              unit_price: editedPrices[code] !== undefined
                ? (editedPrices[code] === '' ? null : Number(editedPrices[code]))
                : li.suggested_price ?? null,
            };
          })
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
          <button onClick={() => { setStep('config'); setResult(null); setPreviewPdfUrl(null); setGcStep('detect'); setGcResult(null); setGcSheets([]); setGcLevels([]); setGcEditedPrices({}); setTmEditedFields({}); setTmImageVer({}); }}
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
                        className={`ml-2 px-2 py-0.5 rounded text-[11px] transition-colors ${
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
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${
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
                              <div className="text-[11px] text-slate-400 font-mono truncate">{f.path || '—'}</div>
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

              {/* TM edit form — image + editable spec/maker/qty/price per item */}
              <div className="text-[11px] text-slate-500 italic pl-1">
                Hàng TM: chỉnh sửa thông tin + đổi ảnh trước khi tạo file. Ảnh đổi áp dụng cho cả CAM KẾT và Quotation.
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[420px] overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr>
                      <th className="text-center px-2 py-1.5 font-medium text-slate-500">Ảnh</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-500">Loại</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-500">BQMS Code</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-500">Spec (sửa)</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-500">Maker (sửa)</th>
                      <th className="text-right px-2 py-1.5 font-medium text-slate-500">SL (sửa)</th>
                      <th className="text-right px-2 py-1.5 font-medium text-slate-500">Giá gợi ý</th>
                      <th className="text-right px-2 py-1.5 font-medium text-slate-500">Giá báo (sửa)</th>
                      <th className="text-left px-2 py-1.5 font-medium text-slate-500">KQ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lookupItems.map((li: any, i: number) => {
                      const code = li.bqms ?? '';
                      const edits = tmEditedFields[code] ?? {};
                      const ver = tmImageVer[code] ?? 0;
                      const uploading = tmImageUploading[code] ?? false;
                      const imgSrc = code && item.rfq_number
                        ? withToken(`/api/v1/bqms/rfq/image?bqms_code=${encodeURIComponent(code)}&rfq_number=${encodeURIComponent(item.rfq_number)}&_v=${ver}`)
                        : null;
                      return (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="px-2 py-1 text-center">
                            <div className="flex flex-col items-center gap-1">
                              {imgSrc ? (
                                <a
                                  href={imgSrc}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block w-14 h-14 rounded border border-slate-200 bg-slate-50 overflow-hidden hover:ring-2 hover:ring-brand-400 transition-all"
                                  title={`Xem ảnh ${code}`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    key={`${code}-${ver}`}
                                    src={imgSrc}
                                    alt={code}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                                      const parent = (e.currentTarget as HTMLImageElement).parentElement;
                                      if (parent) parent.classList.add('items-center', 'justify-center', 'flex');
                                      if (parent && !parent.querySelector('.no-img-label')) {
                                        const lbl = document.createElement('span');
                                        lbl.className = 'no-img-label text-[11px] text-slate-400';
                                        lbl.textContent = 'no img';
                                        parent.appendChild(lbl);
                                      }
                                    }}
                                  />
                                </a>
                              ) : (
                                <div className="w-14 h-14 rounded bg-slate-100 flex items-center justify-center text-[11px] text-slate-500">—</div>
                              )}
                              <input
                                type="file"
                                accept=".png,.jpg,.jpeg"
                                className="hidden"
                                ref={(el) => { tmImageInputRefs.current[code] = el; }}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleTmImageReplace(code, f);
                                  e.target.value = '';
                                }}
                              />
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={!code || uploading}
                                  onClick={() => tmImageInputRefs.current[code]?.click()}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                                  title="Tải ảnh thay thế">
                                  {uploading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Pencil className="h-2.5 w-2.5" />}
                                  Đổi
                                </button>
                                {ver > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleTmImageReset(code)}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-200 text-slate-600 hover:bg-slate-300"
                                    title="Khôi phục ảnh gốc">
                                    <RotateCcw className="h-2.5 w-2.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-1">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${
                              li.loai_hang === 'GC' ? 'bg-orange-100 text-orange-700' :
                              li.loai_hang === 'TM' ? 'bg-blue-100 text-blue-700' :
                              'bg-slate-100 text-slate-500'
                            }`}>{li.loai_hang ?? '?'}</span>
                          </td>
                          <td className="px-2 py-1 font-mono text-slate-700">{code || '—'}</td>
                          <td className="px-2 py-1">
                            <input
                              type="text"
                              value={edits.spec !== undefined ? edits.spec : (li.spec ?? '')}
                              onChange={(e) => handleTmFieldChange(code, 'spec', e.target.value)}
                              className="w-44 text-[11px] border border-slate-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400"
                              title={edits.spec !== undefined ? edits.spec : li.spec}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              type="text"
                              value={edits.maker !== undefined ? edits.maker : (li.maker ?? '')}
                              onChange={(e) => handleTmFieldChange(code, 'maker', e.target.value)}
                              className="w-24 text-[11px] border border-slate-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400"
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={edits.so_luong !== undefined ? edits.so_luong : (li.so_luong ?? '')}
                              onChange={(e) => handleTmFieldChange(code, 'so_luong', e.target.value)}
                              className="w-16 text-[11px] text-right font-mono border border-slate-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400"
                            />
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-emerald-600">
                            {li.suggested_price ? Number(li.suggested_price).toLocaleString('vi-VN') : '—'}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input
                              type="number"
                              step="0.01"
                              placeholder={li.suggested_price ? String(li.suggested_price) : '—'}
                              value={editedPrices[code] ?? ''}
                              onChange={(e) => handlePriceChange(code, e.target.value)}
                              className="w-24 text-xs text-right font-mono border border-slate-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <ResultBadge result={li.result} />
                          </td>
                        </tr>
                      );
                    })}
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
                          <div className="text-[11px] text-slate-400 font-mono truncate">{f.path || '—'}</div>
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
              <div className="bg-slate-100 px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Xem truoc PDF</span>
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
            <button onClick={() => { setStep('config'); setResult(null); setPreviewPdfUrl(null); setEditedPrices({}); setTmEditedFields({}); setTmImageVer({}); }}
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
      <td colSpan={27} className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-3">
          {/* Info grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-slate-500 block">RFQ No.</span>
              <span className="font-mono font-semibold text-brand-700">{item.rfq_number ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 block">BQMS Code</span>
              <span className="font-mono text-slate-700">{item.bqms_code ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Tên hàng / Spec</span>
              <span className="text-slate-700 line-clamp-2">{item.specification ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Maker</span>
              <span className="text-slate-700">{item.maker ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Số lượng</span>
              <span className="font-mono text-slate-700">
                {fmtNum(item.expected_qty)} {item.unit ?? ''}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Giá mua RMB</span>
              <span className="font-mono text-slate-700">{fmtVnd(item.purchase_price_rmb)}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Giá mua VND</span>
              <span className="font-mono text-slate-700">{fmtVnd(item.purchase_price_vnd)}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Giá AMA</span>
              <span className="font-mono text-slate-700">{fmtVnd(item.quoted_price_ama)}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Nhà cung cấp</span>
              <span className="text-slate-700">{item.supplier_name ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Người phụ trách</span>
              <span className="text-slate-700">{item.person_in_charge_name ?? '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Ngày inquiry</span>
              <span className="text-slate-700">
                {item.inquiry_date ? formatDate(item.inquiry_date) : '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Kết quả</span>
              <ResultBadge result={item.result} />
            </div>
            {item.notes && (
              <div className="col-span-2 md:col-span-4">
                <span className="text-slate-500 block">Ghi chú</span>
                <span className="text-slate-700">{item.notes}</span>
              </div>
            )}
            {item.report && (
              <div className="col-span-2 md:col-span-4">
                <span className="text-slate-500 block">Báo cáo</span>
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
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
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
                                    <span className="text-[11px] text-slate-400 ml-2">{sizeKB} KB</span>
                                    <div className="text-[11px] text-slate-400 font-mono truncate">{f.filename}</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {isPdf && f.preview_url && (
                                    <a href={withToken(f.preview_url)} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-white text-[11px] font-medium hover:bg-red-700">
                                      <Eye className="h-3 w-3" /> Mo PDF
                                    </a>
                                  )}
                                  <a href={withToken(f.download_url)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-brand-600 text-white text-[11px] font-medium hover:bg-brand-700">
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
  canPushBidding,
  pushableIds = [],
  allChecked = false,
  someChecked = false,
  onToggleSelectMonth,
}: {
  summary: MonthSummary;
  collapsed: boolean;
  onToggle: () => void;
  canPushBidding?: boolean;
  pushableIds?: number[];
  allChecked?: boolean;
  someChecked?: boolean;
  onToggleSelectMonth?: (ids: number[], select: boolean) => void;
}) {
  return (
    <tr
      className="bg-slate-50 border-y border-slate-200 cursor-pointer select-none sticky top-[41px] z-10"
      onClick={onToggle}
    >
      <td colSpan={15} className="px-4 py-2">
        <div className="flex items-center gap-2">
          {/* QĐ-3: chọn tất cả mã gửi-được trong tháng — chỉ khi đủ quyền + có
              mã gửi-được. stopPropagation để click checkbox KHÔNG toggle collapse. */}
          {canPushBidding && pushableIds.length > 0 && (
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = someChecked;
              }}
              className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600 cursor-pointer"
              checked={allChecked}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onToggleSelectMonth?.(pushableIds, e.target.checked)}
              aria-label={`Chọn tất cả ${pushableIds.length} mã gửi-được trong ${monthLabel(summary.year, summary.month)}`}
              title="Chọn / bỏ chọn tất cả mã đang mở (có bqms_code) trong tháng"
            />
          )}
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

// ─── RefreshWonButton ─────────────────────────────────────────────────────────
//
// Thang 2026-06-13 (Task 4): "Cập nhật trúng" — gọi backend POST
// /api/v1/bqms/won/refresh để re-fetch Selection Result từ Samsung và đồng
// bộ vào ERP. Backend endpoint do PM xác nhận; nếu chưa có sẽ trả 404 + toast.
//
// UX: nút mặc định brand, spin icon khi đang chạy, toast success/error.

function RefreshWonButton() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);

  const handleClick = async () => {
    if (running) return;
    setRunning(true);
    toast.info('Đang cập nhật kết quả trúng từ Samsung...', { duration: 4000 });
    try {
      const r: any = await api.post('/api/v1/bqms/won/refresh', {});
      const n = r?.data?.updated ?? r?.data?.count ?? 0;
      toast.success(`Đã cập nhật ${n} kết quả trúng / trượt`, { duration: 6000 });
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = e?.response?.data?.detail ?? e?.message ?? 'Lỗi không xác định';
      if (status === 404) {
        toast.error('Endpoint refresh trúng chưa có (backend Task 4 chưa deploy)', { duration: 6000 });
      } else {
        toast.error(`Cập nhật trúng lỗi: ${msg}`, { duration: 8000 });
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={running}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
        running
          ? 'bg-brand-100 text-brand-700 cursor-wait'
          : 'bg-white border border-brand-300 text-brand-700 hover:bg-brand-50',
      )}
      title="Đồng bộ Selection Result (Trúng / Trượt) mới nhất từ Samsung sec-bqms.com"
    >
      <CheckCircle2 className={cn('h-3.5 w-3.5', running && 'animate-pulse')} />
      {running ? 'Đang cập nhật...' : 'Cập nhật trúng'}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BQMSPage() {
  const queryClient = useQueryClient();

  // ── Filter state
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const searchParams = useSearchParams();
  const [year, setYear] = useState<number | null>(currentYear);
  // Thang 2026-05-29: mặc định tháng hiện tại để khi rollover sang tháng mới
  // (vd 01/06) view tự cuộn sang tháng đó thay vì kẹt ở tháng cũ.
  const [month, setMonth] = useState<number | null>(currentMonth);
  // Search is driven from the global Ctrl+K palette (top-nav) via URL param
  // ?search=Z0000002-385323 — the old in-page search bar was removed
  // 2026-05-22 per Thang (duplicate UX, only one search palette now).
  const [search, setSearch] = useState(searchParams?.get('search') || '');
  const [resultFilter, setResultFilter] = useState<string>(
    searchParams?.get('search') ? 'all' : 'unquoted',
  );
  const [sourceFilter, setSourceFilter] = useState<string>('all');  // excel_import / etl / onedrive_sync / manual
  const [loaiHangFilter, setLoaiHangFilter] = useState<string>('all');  // TM / GC
  // Thang 2026-06-13 (Task 1): lọc theo vòng báo giá hiện tại.
  // Options: all | v1_has | v2_has | v3_has | v4_has | v1_missing
  const [roundFilter, setRoundFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  // Thang 2026-06-15 (Batch 2b): số dòng mỗi trang — mặc định 12, đọc lại từ
  // localStorage khi mount. Đổi → reset về trang 1.
  const [pageSize, setPageSize] = useState<number>(12);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = Number(window.localStorage.getItem('bqms-page-size-v1'));
    if ([12, 25, 50, 100].includes(saved)) setPageSize(saved);
  }, []);
  const handlePageSizeChange = useCallback((n: number) => {
    setPageSize(n);
    setPage(1);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('bqms-page-size-v1', String(n));
    }
  }, []);
  const isReadOnly = useIsReadOnly();

  // ── Gửi mã BQMS sang đấu thầu NCC (Thang 2026-06-28) ───────────────────────
  // QĐ-1: quyền gửi = admin/manager/procurement. Sale KHÔNG nằm trong set →
  // canPushBidding=false → mọi checkbox + action-bar ẩn hoàn toàn → sale không
  // bao giờ chạm endpoint → không 403 khó hiểu.
  const userRole = useUserRole();
  const canPushBidding = ['admin', 'manager', 'procurement'].includes(userRole);

  const [selectedRfqIds, setSelectedRfqIds] = useState<Set<number>>(new Set());
  // !=null → mở PushToBiddingModal với snapshot id đang chọn.
  const [pushBiddingIds, setPushBiddingIds] = useState<number[] | null>(null);
  const [batchPushSecIds, setBatchPushSecIds] = useState<number[] | null>(null);

  // QĐ-2: chỉ "mã đang mở" (chưa có kết quả) mới gửi-được = có bqms_code +
  // result null/'' hoặc 'pending'. Enum rfq_result có 6 nhãn: pending (đang mở)
  // + won/lost/closed/cancelled/skipped (đã chốt) — chặn CẢ 5 trạng thái chốt
  // (trước đây thiếu cancelled/skipped → lọt mã đã huỷ/bỏ).
  const RESULT_CLOSED = ['won', 'lost', 'closed', 'cancelled', 'skipped'];
  const isSelectable = useCallback((it: RFQItem): boolean => {
    if (!it.bqms_code) return false;
    const r = (it.result ?? '').trim().toLowerCase();
    return r === '' || !RESULT_CLOSED.includes(r);
  }, []);

  const toggleSelectRfq = useCallback((id: number) => {
    setSelectedRfqIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // QĐ-3: "chọn tất cả trong tháng" — thêm/bỏ cả danh sách id gửi-được của nhóm.
  const toggleSelectMonth = useCallback((ids: number[], select: boolean) => {
    setSelectedRfqIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });
  }, []);

  // Reset chọn khi đổi scope (filter/trang) — selection theo id, không theo
  // trang → tránh "chọn ma" / gửi nhầm mã ngoài view hiện tại.
  useEffect(() => {
    setSelectedRfqIds(new Set());
  }, [year, month, search, resultFilter, sourceFilter, loaiHangFilter, roundFilter, page]);

  // ── UI state
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  // Per Thang 2026-05-11: side drawer (slide from right) replaces dropdown.
  const [drawerItem, setDrawerItem] = useState<RFQItem | null>(null);
  // BQMS Auto-Submit (Thang 2026-05-14)
  // Push to SEC modal — track rfqId + initial round (TH2 → V2, TH3 → next round)
  const [pushToSecState, setPushToSecState] = useState<{ rfqId: number; initialRound: number } | null>(null);
  const pushToSecRfqId = pushToSecState?.rfqId ?? null;
  const setPushToSecRfqId = (id: number | null, initialRound: number = 1) =>
    setPushToSecState(id == null ? null : { rfqId: id, initialRound });

  // Activity feed (polled every 30s) — surfaces periodic-scrape events:
  //   bqms_periodic.closed, bqms_periodic.round2_invitation, bqms.quote.gc/regen_pdf
  const [lastSeenActivityId, setLastSeenActivityId] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    return Number(localStorage.getItem('bqms_last_activity_id') ?? 0);
  });
  const { data: activityData } = useQuery<{ data: { items: any[] } }>({
    queryKey: ['bqms-activity-recent'],
    queryFn: () => api.get('/api/v1/bqms/activity/recent?days=2&limit=30'),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
  const activityItems = activityData?.data?.items ?? [];
  const newActivityCount = activityItems.filter(
    (a: any) => (a.id ?? 0) > lastSeenActivityId,
  ).length;
  const [showActivityPanel, setShowActivityPanel] = useState(false);

  // Auto-scrape toggle removed (Thang 2026-05-15): cron always ON 24/7 with
  // sleep window 20:00-05:00 ICT enforced backend-side. No UI toggle.

  // Phase F (Thang 2026-05-13): theo dõi RFQ thiếu data + nút quét bù manual.
  type DataGapsResp = {
    data: {
      total_pending: number;
      total_rfq_db: number;
      by_state: { has_items?: number; empty_items?: number; no_detail?: number };
      missing_list: Array<{
        id: number;
        rfq_number: string;
        samsung_item_cnt: string | null;
        reg_dt: string | null;
        req_name: string | null;
        scraped_at: string | null;
        our_items: number;
      }>;
      last_cron: { summary: any; updated_at: string | null } | null;
      smart_rescan?: {
        enabled: boolean;
        state: {
          status?: 'idle' | 'running' | 'done' | 'error' | 'disabled';
          gaps_before?: number;
          processed?: number;
          files_downloaded?: number;
          duration_seconds?: number;
          finished_at?: string;
          updated_at?: string | null;
          error?: string;
        } | null;
      };
      // Phase G (Thang 2026-05-13): Smart Code-Track engine
      code_track?: {
        enabled: boolean;
        last_run: {
          status?: 'idle' | 'running' | 'done' | 'error' | 'disabled' | 'skipped_lock' | 'all_cooldown';
          gaps_detected?: number;
          gaps_by_kind?: Record<string, number>;
          plans?: number;
          healed?: number;
          healed_by_kind?: Record<string, number>;
          skipped_cooldown?: number;
          duration_seconds?: number;
          finished_at?: string;
          updated_at?: string | null;
          errors?: string[];
        } | null;
        gap_breakdown: Record<string, number>;
        healed_today: number;
        pending_cooldown: number;
      };
    };
  };
  const { data: gapsData, refetch: refetchGaps, isFetching: gapsFetching } = useQuery<DataGapsResp>({
    queryKey: ['bqms-data-gaps'],
    queryFn: () => api.get('/api/v1/bqms/data-gaps'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const gaps = gapsData?.data;
  const gapsCount = (gaps?.by_state?.no_detail ?? 0) + (gaps?.by_state?.empty_items ?? 0);
  const [showGapsPanel, setShowGapsPanel] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const triggerRescan = async () => {
    if (rescanning) return;
    if (!window.confirm(
      `Quét bù ${gapsCount} RFQ thiếu data?\n\nQuá trình này có thể mất 5-15 phút (mỗi RFQ ~30s).\n` +
      `Nó sẽ chạy đồng bộ — nút sẽ chờ đến khi xong rồi báo kết quả.`,
    )) return;
    setRescanning(true);
    toast.info('Đang quét bù... có thể mất vài phút', { duration: 6000 });
    try {
      const r: any = await api.post('/api/v1/bqms/data-gaps/rescan?max_rfqs=50&budget_seconds=1500', {});
      const n = r?.data?.rfqs_processed ?? 0;
      const f = r?.data?.files_downloaded ?? 0;
      toast.success(`✅ Quét bù xong: ${n} RFQ drilled, ${f} file`, { duration: 8000 });
      await refetchGaps();
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? e?.message ?? 'Unknown';
      toast.error(`❌ Quét bù lỗi: ${msg}`, { duration: 10000 });
    } finally {
      setRescanning(false);
    }
  };

  // ── Build query string
  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (year) p.set('year', String(year));
    if (month) p.set('month', String(month));
    if (search) p.set('search', search);
    if (resultFilter && resultFilter !== 'all') p.set('result_filter', resultFilter);
    if (sourceFilter && sourceFilter !== 'all') p.set('source_filter', sourceFilter);
    if (loaiHangFilter && loaiHangFilter !== 'all') p.set('loai_hang', loaiHangFilter);
    if (roundFilter && roundFilter !== 'all') p.set('round_filter', roundFilter);
    p.set('page', String(page));
    // Thang 2026-06-15 (Batch 2b): page_size từ state (12/25/50/100), persist
    // localStorage. Mặc định 12 → first paint nhẹ; user chỉnh dropdown nếu muốn
    // xem nhiều dòng hơn. Cũng giảm tải /rfq/image hàng loạt khi để 12.
    p.set('page_size', String(pageSize));
    return p.toString();
  }, [year, month, search, resultFilter, sourceFilter, loaiHangFilter, roundFilter, page, pageSize]);

  // ── Data query
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['bqms-rfq-table', year, month, search, resultFilter, sourceFilter, loaiHangFilter, roundFilter, page, pageSize],
    queryFn: () =>
      api.get<RFQTableResponse>(`/api/v1/bqms/rfq-table?${buildParams()}`),
    // Thang 2026-05-22: 30s → 60s (table không thay đổi liên tục, scrape 1h/lần)
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 2,
  });

  const items: RFQItem[] = Array.isArray(data?.data?.items) ? data!.data.items : [];
  const total = data?.data?.total ?? 0;
  const totalPages = data?.data?.total_pages ?? 1;

  // Thang 2026-06-15: visual confirmation cho round_filter — flash badge total
  // mỗi khi tổng record thay đổi (giúp user thấy bộ lọc CÓ tác dụng, tránh hiểu
  // nhầm "filter không chạy" khi danh sách item nhìn giống nhau).
  // Nguyên nhân lý do thêm: trước đó user báo round_filter không lọc, root cause
  // là stale browser bundle — nhưng dù vậy badge thay đổi cũng giúp xác nhận
  // trực quan rằng request đã round-trip backend đúng.
  const [totalPulse, setTotalPulse] = useState(false);
  const prevTotalRef = useRef<number | null>(null);
  useEffect(() => {
    if (isLoading || isFetching) return;
    if (prevTotalRef.current !== null && prevTotalRef.current !== total) {
      setTotalPulse(true);
      const t = setTimeout(() => setTotalPulse(false), 900);
      prevTotalRef.current = total;
      return () => clearTimeout(t);
    }
    prevTotalRef.current = total;
  }, [total, isLoading, isFetching]);
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

  // ── Báo giá mutation for pending bidding rows merged into BQMS table.
  // Per Thang 2026-05-11: when row.is_pending=true (origin = staging), bấm
  // Báo giá → POST /vendor-staging/{staging_id}/quote → backend drills detail,
  // downloads files, UPSERT bqms_rfq, marks staging approved. Row reloads
  // as a normal BQMS row with V1-V4 cols editable.
  // Thang 2026-06-23 (fix nút Báo giá "không hoạt động"): ON-DEMAND DRILL.
  // Khi RFQ chưa được cron drill, BE enqueue job drill riêng + trả
  // status:'drilling'. FE poll bằng cách re-call /quote mỗi `DRILL_POLL_MS`
  // tới khi unlock (done) / fail. `drillingIds` = set staging_id đang drill →
  // dùng để hiện trạng thái "Đang tải chi tiết…" trên ĐÚNG row (per-row, không
  // disable toàn cục). `drillTimersRef` giữ timer + số lần poll để cleanup +
  // hard-stop tránh poll vô hạn.
  const DRILL_POLL_MS = 6000;       // poll mỗi 6s
  const DRILL_MAX_POLLS = 30;       // ~3 phút (30 × 6s) rồi bỏ cuộc (job ~30-90s)
  const [drillingIds, setDrillingIds] = useState<Set<number>>(new Set());
  const drillTimersRef = useRef<Map<number, { timer: ReturnType<typeof setTimeout>; polls: number }>>(new Map());

  const stopDrilling = useCallback((stagingId: number) => {
    const entry = drillTimersRef.current.get(stagingId);
    if (entry) clearTimeout(entry.timer);
    drillTimersRef.current.delete(stagingId);
    setDrillingIds((prev) => {
      if (!prev.has(stagingId)) return prev;
      const next = new Set(prev);
      next.delete(stagingId);
      return next;
    });
  }, []);

  // Cleanup mọi timer khi unmount.
  useEffect(() => {
    const timers = drillTimersRef.current;
    return () => {
      timers.forEach(({ timer }) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const quoteFromBqmsMutation = useMutation({
    mutationFn: (stagingId: number) =>
      api.post<{ data: any }>(
        // Phase H (Thang 2026-05-13): download_files param đã deprecated.
        // Endpoint lightweight — chỉ unlock V1-V4 + assign user (<1s).
        `/api/v1/bqms/vendor-staging/${stagingId}/quote`,
        {},
      ),
    onSuccess: (resp: any, stagingId: number) => {
      const data = resp?.data ?? {};
      const unlocked = Number(data.quote_unlocked ?? data.bqms_rfq_upserts ?? 0);
      const status: string | undefined = data.status;
      const rfqNumber: string | undefined = data.rfq_number;
      const rfqLabel = rfqNumber ?? '';

      // ── CASE 1: UNLOCK thành công ────────────────────────────────────────
      // Thang 2026-05-23: Cải thiện UX — filter='tracking' + search rfq để dòng
      // vừa unlock KHÔNG biến mất, user thấy ngay ô V1 (xanh) để báo giá.
      if (unlocked > 0) {
        stopDrilling(stagingId);  // poll (nếu có) đã xong → dừng
        if (rfqNumber) {
          setResultFilter('tracking');
          setSearch(rfqNumber);
          toast.success(
            `🔓 Đã mở khoá V1-V4 cho ${unlocked} mã linh kiện · Đang theo dõi ${rfqNumber} — click vào ô V1 (xanh) để báo giá`,
            { id: `quote-${stagingId}`, duration: 8000 },
          );
        } else {
          toast.success(
            `🔓 Đã mở khoá V1-V4 cho ${unlocked} mã linh kiện — click vào ô V1 (xanh) để báo giá`,
            { id: `quote-${stagingId}`, duration: 6000 },
          );
        }
        queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
        queryClient.invalidateQueries({ queryKey: ['bqms-data-gaps'] });
        return;
      }

      // ── CASE 2: ON-DEMAND DRILL đang chạy → poll tới khi xong ────────────
      // BE đã enqueue (hoặc tái dùng) job drill 1-RFQ. Re-call /quote mỗi
      // DRILL_POLL_MS; khi worker drill xong → lần call sau trả unlocked>0
      // (rơi vào CASE 1) → stopDrilling. Per-row state qua drillingIds.
      if (status === 'drilling') {
        const entry = drillTimersRef.current.get(stagingId);
        const polls = entry ? entry.polls : 0;

        // Bắt đầu drill: đánh dấu row + toast "đang tải" (id ổn định nên các
        // lần poll cập nhật cùng 1 toast, không spam).
        if (!drillingIds.has(stagingId)) {
          setDrillingIds((prev) => new Set(prev).add(stagingId));
        }
        toast.loading(
          `⏳ Đang tải chi tiết RFQ ${rfqLabel} từ Samsung… nút sẽ tự mở khoá khi xong (~30-90 giây). Bạn có thể tiếp tục làm việc khác.`.replace('  ', ' '),
          { id: `quote-${stagingId}`, duration: Infinity },
        );

        if (polls >= DRILL_MAX_POLLS) {
          // Quá lâu (worker kẹt / Samsung lock bận) → dừng poll, báo rõ.
          stopDrilling(stagingId);
          toast.warning(
            `RFQ ${rfqLabel} vẫn đang được tải chi tiết (lâu hơn bình thường). Hệ thống vẫn xử lý ngầm — đợi 1–2 phút rồi bấm lại "Báo giá".`,
            { id: `quote-${stagingId}`, duration: 10_000 },
          );
          return;
        }

        const timer = setTimeout(() => {
          quoteFromBqmsMutation.mutate(stagingId);
        }, DRILL_POLL_MS);
        drillTimersRef.current.set(stagingId, { timer, polls: polls + 1 });
        return;
      }

      // ── CASE 3: DRILL fail / RFQ rỗng item ───────────────────────────────
      if (status === 'drill_failed' || status === 'drill_empty' || status === 'drill_enqueue_failed') {
        stopDrilling(stagingId);
        toast.error(
          `❌ ${data.message ?? `Không tải được chi tiết RFQ ${rfqLabel}.`}`,
          { id: `quote-${stagingId}`, duration: 12_000 },
        );
        queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
        return;
      }

      // ── CASE 4: không unlock mới nhưng RFQ đã tồn tại → đưa user tới đó ──
      stopDrilling(stagingId);
      if (rfqNumber) {
        setResultFilter('all');
        setSearch(rfqNumber);
        toast.info(
          `Mã đã được unlock trước đó · Đang lọc theo ${rfqNumber} — kiểm tra cột V1/V2/V3/V4`,
          { id: `quote-${stagingId}`, duration: 6000 },
        );
      } else {
        toast.info('Đã unlock (không có mã mới). Refresh để xem.', { id: `quote-${stagingId}` });
      }
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
      queryClient.invalidateQueries({ queryKey: ['bqms-data-gaps'] });
    },
    onError: (err: any, stagingId: number) => {
      // Lỗi mạng/HTTP của 1 lần poll → dừng drill của row đó, báo lỗi.
      stopDrilling(stagingId);
      const msg = err?.detail ?? err?.message ?? 'Lỗi không xác định';
      toast.error(`❌ Mở khoá thất bại: ${msg}`, { id: `quote-${stagingId}`, duration: 10_000 });
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

  // Sync search from URL param ?search=... (driven by Ctrl+K palette).
  // When the user picks a BQMS code in Ctrl+K, the palette navigates here
  // with ?search=Z0000002-... — pick it up and filter the table.
  // Thang 2026-06-04: Khi search từ Ctrl+K, clear year/month để tìm
  // xuyên tháng. Trước đây giữ tháng hiện tại → row tháng khác bị filter
  // mất → backend fallback sang staging stub (is_pending=true) → drawer
  // mở thiếu nút "Đẩy lên SEC". Ctrl+K là global search nên phải bỏ scope.
  useEffect(() => {
    const urlSearch = searchParams?.get('search') || '';
    if (urlSearch && urlSearch !== search) {
      setSearch(urlSearch);
      setResultFilter('all');
      setYear(null);
      setMonth(null);
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Thang 2026-06-04 (BUG A): focus_rfq query param — Ctrl+K "RFQ" group
  // navigates here with ?focus_rfq=QT26071059. Same scoping as ?search=
  // (clear year/month + resultFilter=all) AND auto-open drawer on the
  // first row whose rfq_number matches. Drawer item is set in a second
  // effect that watches `items` so we don't open before data lands.
  const focusRfq = searchParams?.get('focus_rfq') || '';
  useEffect(() => {
    if (focusRfq && focusRfq !== search) {
      setSearch(focusRfq);
      setResultFilter('all');
      setYear(null);
      setMonth(null);
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRfq]);

  // Once items for the focused RFQ load, auto-open the drawer on the first
  // matching row (idempotent — guarded by autoOpenedFocusRfq).
  // Thang 2026-06-21 (search-qt): drawer auto-open must NOT depend on
  // page-1 luck. rfq-table returns only page_size (~12) rows, so the row
  // whose rfq_number === focusRfq may not be in the current page → the old
  // effect silently no-op'd. Now: if no row in the loaded page matches, fetch
  // that exact RFQ directly (rfq-table filtered + large page_size) and open
  // its drawer; if still nothing, surface a non-silent toast.
  const [autoOpenedFocusRfq, setAutoOpenedFocusRfq] = useState<string | null>(null);
  useEffect(() => {
    if (!focusRfq) return;
    if (autoOpenedFocusRfq === focusRfq) return;
    // Wait until the search-scoped table query for this RFQ has settled so we
    // don't fire the fallback fetch against stale (pre-focus) items.
    if (isFetching) return;
    if (search !== focusRfq) return;

    const match = items.find((it) => it.rfq_number === focusRfq);
    if (match) {
      setDrawerItem(match);
      setAutoOpenedFocusRfq(focusRfq);
      return;
    }

    // No row on the loaded page matched → fetch the exact RFQ directly.
    let cancelled = false;
    setAutoOpenedFocusRfq(focusRfq); // guard immediately to avoid double-fetch
    (async () => {
      try {
        const p = new URLSearchParams();
        p.set('search', focusRfq);
        p.set('page', '1');
        p.set('page_size', '100');
        const res = await api.get<RFQTableResponse>(
          `/api/v1/bqms/rfq-table?${p.toString()}`,
        );
        if (cancelled) return;
        const rows = Array.isArray(res?.data?.items) ? res.data.items : [];
        // Only open on an EXACT rfq_number match. The rfq-table search is a
        // broad substring ILIKE (rfq_number/bqms_code/spec/maker/raw_json), so
        // rows[0] could be a *different* RFQ that merely matched the substring —
        // opening it would silently show the wrong order.
        const exact = rows.find((it) => it.rfq_number === focusRfq) ?? null;
        if (exact) {
          setDrawerItem(exact);
        } else {
          toast.error(`Không tìm thấy QT ${focusRfq}`, { duration: 6000 });
        }
      } catch {
        if (!cancelled) {
          toast.error(`Không tìm thấy QT ${focusRfq}`, { duration: 6000 });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusRfq, items, autoOpenedFocusRfq, isFetching, search]);

  // ── Filter change resets page
  const handleYearChange = (v: number | null) => { setYear(v); setPage(1); };
  const handleMonthChange = (v: number | null) => { setMonth(v); setPage(1); };
  const handleResultChange = (v: string) => { setResultFilter(v); setPage(1); };

  // ── Row click → open side drawer (replaces inline dropdown panel).
  // Per Thang 2026-05-11: chi tiết hiển thị ở 1 page con bên cạnh.
  const handleRowClick = (id: number) => {
    const found = items.find((x) => x.id === id) ?? null;
    setDrawerItem(found);
  };

  // ── Global row counter (for # column)
  let rowCounter = (page - 1) * 100;

  return (
    <div className="flex flex-col gap-4 min-h-0 pb-8">
      {/* Samsung BQMS portal scrape disabled 2026-05-04. Excel auto-import
          (bqms_excel_auto_import every 2min) is now the source of truth.
          Re-enable widget when bqms_nightly_sync is reactivated. */}
      {/* <SamsungSyncWidget /> */}

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
                <span
                  className={cn(
                    'inline-block px-1.5 py-0.5 rounded font-semibold tabular-nums transition-all duration-300',
                    totalPulse
                      ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-300 scale-110'
                      : 'bg-transparent text-slate-700',
                  )}
                  title="Tổng số RFQ khớp bộ lọc hiện tại"
                >
                  {total.toLocaleString('vi-VN')}
                </span>{' '}
                bản ghi
                {roundFilter !== 'all' && (
                  <span
                    className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-50 text-brand-600 text-[11px] font-semibold"
                    title="Đang lọc theo vòng báo giá"
                  >
                    vòng: {roundFilter}
                  </span>
                )}
                {isFetching && !isLoading && (
                  <span className="ml-2 text-brand-500">
                    <Loader2 className="inline h-3 w-3 animate-spin mr-0.5" />
                    Đang cập nhật...
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Phase F (Thang 2026-05-13): Data-gap tracker + nút quét bù */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowGapsPanel((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-white transition-colors',
                gapsCount > 0
                  ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                  : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
              )}
              title={gapsCount > 0
                ? `${gapsCount} RFQ còn thiếu detail — click để xem + quét bù`
                : 'Tất cả RFQ đã có đủ detail'
              }
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="text-[11px] font-bold">
                {gapsFetching ? '...' : `Thiếu ${gapsCount}`}
              </span>
            </button>
            {showGapsPanel && (
              <div
                className="absolute top-full right-0 mt-2 w-[420px] max-h-[500px] overflow-auto z-50 bg-white border border-slate-200 rounded-lg shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
                  <h3 className="text-sm font-bold text-slate-800">Theo dõi quét chi tiết</h3>
                  <button
                    type="button"
                    onClick={() => setShowGapsPanel(false)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded bg-emerald-50 border border-emerald-200">
                      <div className="text-[11px] uppercase text-emerald-700 font-bold">Đủ items</div>
                      <div className="text-lg font-bold text-emerald-700">{gaps?.by_state?.has_items ?? 0}</div>
                    </div>
                    <div className="p-2 rounded bg-amber-50 border border-amber-200">
                      <div className="text-[11px] uppercase text-amber-700 font-bold">Thiếu</div>
                      <div className="text-lg font-bold text-amber-700">
                        {(gaps?.by_state?.no_detail ?? 0) + (gaps?.by_state?.empty_items ?? 0)}
                      </div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200">
                      <div className="text-[11px] uppercase text-slate-600 font-bold">Tổng pending</div>
                      <div className="text-lg font-bold text-slate-700">{gaps?.total_pending ?? 0}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded border border-slate-200 p-2">
                      <div className="text-slate-500">Chưa drill</div>
                      <div className="font-bold text-slate-700">{gaps?.by_state?.no_detail ?? 0}</div>
                    </div>
                    <div className="rounded border border-slate-200 p-2">
                      <div className="text-slate-500">Drill rỗng</div>
                      <div className="font-bold text-slate-700">{gaps?.by_state?.empty_items ?? 0}</div>
                    </div>
                  </div>

                  {/* Smart auto-rescan status — chạy mỗi 5 phút khi có gap */}
                  <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                        Auto-rescan
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = !(gaps?.smart_rescan?.enabled ?? true);
                          try {
                            await api.post(`/api/v1/bqms/data-gaps/toggle-smart-rescan?enabled=${next}`, {});
                            toast.success(`Auto-rescan đã ${next ? 'BẬT' : 'TẮT'}`);
                            await refetchGaps();
                          } catch (e: any) {
                            toast.error(`Toggle lỗi: ${e?.message ?? 'Unknown'}`);
                          }
                        }}
                        className={cn(
                          'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
                          gaps?.smart_rescan?.enabled ? 'bg-emerald-500' : 'bg-slate-300',
                        )}
                        title={gaps?.smart_rescan?.enabled
                          ? 'Auto-rescan đang BẬT — chạy mỗi 5 phút khi có gap. Click để TẮT.'
                          : 'Auto-rescan đang TẮT. Click để BẬT.'
                        }
                      >
                        <span className={cn(
                          'inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform',
                          gaps?.smart_rescan?.enabled ? 'translate-x-3.5' : 'translate-x-0.5',
                        )}/>
                      </button>
                    </div>
                    {gaps?.smart_rescan?.state && (
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {(() => {
                          const s = gaps.smart_rescan!.state!;
                          const status = s.status ?? 'idle';
                          const dotColor =
                            status === 'running' ? 'bg-amber-500 animate-pulse'
                            : status === 'idle' ? 'bg-emerald-500'
                            : status === 'done' ? 'bg-emerald-500'
                            : status === 'error' ? 'bg-red-500'
                            : 'bg-slate-300';
                          const label =
                            status === 'running' ? `Đang drill ${s.processed ?? 0} RFQ...`
                            : status === 'idle' ? 'Idle (không gap)'
                            : status === 'done' ? `Vừa drill ${s.processed ?? 0} RFQ (${s.files_downloaded ?? 0} file)`
                            : status === 'error' ? `Lỗi: ${s.error ?? 'unknown'}`
                            : 'Chưa chạy';
                          return (
                            <>
                              <span className={cn('inline-block w-2 h-2 rounded-full', dotColor)}/>
                              <span className="text-slate-600 truncate">{label}</span>
                            </>
                          );
                        })()}
                      </div>
                    )}
                    {gaps?.smart_rescan?.state?.updated_at && (
                      <div className="text-[11px] text-slate-400">
                        Lần cuối: {new Date(gaps.smart_rescan.state.updated_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-500 italic">
                      Tự chạy mỗi 5 phút. Khi không còn gap → idle (không drill nữa).
                    </div>
                  </div>

                  {/* Smart Code-Track — Phase G (Thang 2026-05-13)
                      Engine self-healing 10 loại gap, chạy mỗi 3 phút. */}
                  <SmartCodeTrackPanel gaps={gaps} onChanged={refetchGaps} />

                  {/* Manual force-trigger — vẫn giữ để user có thể quét NGAY không chờ 5 phút */}
                  <button
                    type="button"
                    onClick={triggerRescan}
                    disabled={rescanning || gapsCount === 0}
                    className={cn(
                      'w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all',
                      gapsCount === 0
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : rescanning
                        ? 'bg-amber-200 text-amber-800 cursor-wait'
                        : 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm'
                    )}
                    title="Force-trigger quét bù NGAY (không chờ 5 phút)"
                  >
                    {rescanning ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang quét bù...</>
                    ) : (
                      <><RotateCcw className="h-3.5 w-3.5" />Quét bù ngay (force)</>
                    )}
                  </button>

                  {gaps?.last_cron?.updated_at && (
                    <div className="text-[11px] text-slate-500 text-center pt-1 border-t border-slate-100">
                      Cron 30p: {new Date(gaps.last_cron.updated_at).toLocaleString('vi-VN')}
                    </div>
                  )}

                  {gaps?.missing_list && gaps.missing_list.length > 0 && (
                    <div className="pt-2 border-t border-slate-100">
                      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
                        Danh sách thiếu ({gaps.missing_list.length})
                      </div>
                      <div className="space-y-1 max-h-[200px] overflow-auto">
                        {gaps.missing_list.map((it) => (
                          <div key={it.id} className="flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded hover:bg-slate-50">
                            <span className="font-mono font-semibold text-slate-700 shrink-0">{it.rfq_number}</span>
                            <span className="text-slate-500 truncate flex-1" title={it.req_name ?? ''}>
                              {it.req_name ?? ''}
                            </span>
                            <span className="shrink-0 text-amber-600 font-mono">
                              {it.samsung_item_cnt ?? '?'} → {it.our_items}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Auto-scrape toggle removed (Thang 2026-05-15): always ON 24/7
              với sleep window 20:00-05:00 ICT enforced backend-side. */}
          {/* Activity bell — shows count of unseen periodic-scrape events */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowActivityPanel((v) => !v);
                if (!showActivityPanel && activityItems[0]) {
                  const top = activityItems[0].id;
                  setLastSeenActivityId(top);
                  try { localStorage.setItem('bqms_last_activity_id', String(top)); } catch {}
                }
              }}
              className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              title="Thông báo hoạt động"
            >
              <Inbox className="h-4 w-4" />
              {newActivityCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                  {newActivityCount > 99 ? '99+' : newActivityCount}
                </span>
              )}
            </button>
            {showActivityPanel && (
              <div className="absolute right-0 top-11 z-50 w-96 max-h-[480px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
                <div className="sticky top-0 bg-slate-50 border-b border-slate-200 px-3 py-2 flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-700">Hoạt động gần đây</div>
                  <button
                    onClick={() => setShowActivityPanel(false)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {activityItems.length === 0 && (
                    <div className="px-3 py-6 text-center text-slate-400 text-xs">Chưa có hoạt động</div>
                  )}
                  {activityItems.map((a: any) => {
                    const isNew = (a.id ?? 0) > lastSeenActivityId;
                    let label = a.action;
                    let icon = '•';
                    let color = 'text-slate-600';
                    if (a.action === 'bqms_periodic.closed') { label = 'RFQ đã Closed'; icon = '🔒'; color = 'text-slate-500'; }
                    else if (a.action === 'bqms.auto_close_expired') { label = 'Auto-close: quá hạn / không seen scrape'; icon = '🔒'; color = 'text-slate-600'; }
                    else if (a.action === 'bqms.auto_skip_expired') { label = 'Auto-skip: quá hạn (legacy)'; icon = '⏭'; color = 'text-slate-500'; }
                    else if (a.action === 'bqms_periodic.round2_invitation') { label = 'Mời báo giá vòng 2 (TH3)'; icon = '🔔'; color = 'text-amber-700'; }
                    else if (a.action === 'bqms_periodic.round2_v1_missing_warning') { label = 'TH2: V1 cũ Samsung — báo V2 mới trong ERP'; icon = '⚠'; color = 'text-amber-700'; }
                    else if (a.action === 'bqms.quote.gc') { label = 'Báo giá GC'; icon = '✅'; color = 'text-emerald-700'; }
                    else if (a.action === 'bqms.quote.regen_pdf') { label = 'Render lại PDF'; icon = '📄'; color = 'text-blue-700'; }
                    let payload: any = {};
                    try { payload = typeof a.new_data === 'string' ? JSON.parse(a.new_data) : (a.new_data || {}); } catch {}
                    return (
                      <div key={a.id} className={cn('px-3 py-2', isNew && 'bg-yellow-50/60')}>
                        <div className="flex items-start gap-2">
                          <span className="text-base flex-shrink-0">{icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className={cn('text-xs font-semibold', color)}>{label}</div>
                            <div className="text-[11px] text-slate-600 font-mono truncate">
                              {a.record_id || ''}
                            </div>
                            {payload.message && (
                              <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{payload.message}</div>
                            )}
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {a.created_at ? new Date(a.created_at).toLocaleString('vi-VN') : ''}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Làm mới
          </button>
          {/* Cập nhật trúng — Thang 2026-06-13 (Task 4): gọi endpoint backend
              refresh kết quả won/lost từ Samsung Selection Result. Endpoint sẽ
              được Project Manager confirm; nếu chưa có sẽ fail-silently với toast. */}
          <RefreshWonButton />
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
          colorClass="bg-brand-100 text-brand-600"
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

        {/* Result filter — Thang 2026-05-29: chuyển pill row → dropdown gọn,
            preserve color cue qua ring + dot color theo value đang chọn. */}
        {(() => {
          const RESULT_OPTIONS = [
            { val: 'tracking', label: 'Đang theo dõi', dot: 'bg-blue-500',    ring: 'ring-blue-300',    title: 'Mã đã nhấn "Báo giá" — V1-V4 unlocked, đang theo dõi vòng báo giá' },
            { val: 'unquoted', label: 'Chưa báo giá',  dot: 'bg-amber-500',   ring: 'ring-amber-300',   title: 'Mã mới scrape về, chưa quyết định báo giá hay không' },
            { val: 'won',      label: 'Trúng',         dot: 'bg-emerald-500', ring: 'ring-emerald-300', title: 'Mã đã trúng (Selection Result = Selected)', hideForViewer: true },
            { val: 'lost',     label: 'Trượt',         dot: 'bg-rose-500',    ring: 'ring-rose-300',    title: 'Mã đã trượt (Selection Result = Unselected)', hideForViewer: true },
            { val: 'closed',   label: 'Closed',        dot: 'bg-slate-500',   ring: 'ring-slate-300',   title: 'Mã đã hết hạn D-Day (Samsung đóng)', hideForViewer: true },
            { val: 'skipped',  label: 'Skip',          dot: 'bg-amber-500',   ring: 'ring-amber-300',   title: 'Mã đã đánh dấu "không báo nữa"', hideForViewer: true },
            { val: 'all',      label: 'Tất cả',        dot: 'bg-brand-500',   ring: 'ring-brand-300',   title: 'Hiển thị toàn bộ mã ở mọi trạng thái' },
          ];
          const visible = RESULT_OPTIONS.filter((b) => !(isReadOnly && b.hideForViewer));
          const current = visible.find((b) => b.val === resultFilter) ?? visible[visible.length - 1];
          return (
            <div className="relative inline-flex items-center">
              <span className={cn(
                'absolute left-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full pointer-events-none',
                current.dot,
              )} />
              <select
                value={resultFilter}
                onChange={(e) => handleResultChange(e.target.value)}
                title={current.title}
                className={cn(
                  'pl-7 pr-8 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-white text-slate-700',
                  'ring-2 ring-offset-0 cursor-pointer hover:bg-slate-50 transition-all',
                  current.ring,
                )}
              >
                {visible.map(({ val, label }) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          );
        })()}

        {/* Source filter */}
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
          className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
          title="Nguồn dữ liệu"
        >
          <option value="all">Mọi nguồn</option>
          <option value="etl">Vendor Portal (scrape)</option>
          <option value="excel_import">Excel cũ</option>
          <option value="onedrive_sync">OneDrive sync</option>
          <option value="manual">Nhập tay</option>
        </select>

        {/* Round filter — Thang 2026-06-13 (Task 1): lọc nhanh theo vòng V đã/chưa có.
            Chấm brand để khớp brand color khi đang active. */}
        {(() => {
          const ROUND_OPTIONS = [
            { val: 'all',        label: 'Mọi vòng',     title: 'Hiển thị toàn bộ — không lọc theo vòng' },
            { val: 'v1_has',     label: 'V1 đã có',     title: 'Đã có giá V1 (quoted_price_bqms_v1 != null)' },
            { val: 'v2_has',     label: 'V2 đã có',     title: 'Đã có giá V2' },
            { val: 'v3_has',     label: 'V3 đã có',     title: 'Đã có giá V3' },
            { val: 'v4_has',     label: 'V4 đã có',     title: 'Đã có giá V4' },
            { val: 'v1_missing', label: 'Chưa có V1',   title: 'Mã chưa được báo V1 nào (V1 == null)' },
          ];
          const current = ROUND_OPTIONS.find((o) => o.val === roundFilter) ?? ROUND_OPTIONS[0];
          const isActive = roundFilter !== 'all';
          return (
            <div className="relative inline-flex items-center">
              <span
                className={cn(
                  'absolute left-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full pointer-events-none',
                  isActive ? 'bg-brand-500' : 'bg-slate-300',
                )}
              />
              <select
                value={roundFilter}
                onChange={(e) => { setRoundFilter(e.target.value); setPage(1); }}
                title={current.title}
                className={cn(
                  'pl-7 pr-8 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-white text-slate-700',
                  'cursor-pointer hover:bg-slate-50 transition-all',
                  isActive && 'ring-2 ring-brand-300',
                )}
              >
                {ROUND_OPTIONS.map(({ val, label }) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          );
        })()}

        {/* Page-size — Thang 2026-06-15 (Batch 2b): số dòng/trang (12/25/50/100),
            persist localStorage. Style khớp roundFilter (brand/slate). */}
        {(() => {
          const PAGE_SIZE_OPTIONS = [12, 25, 50, 100];
          const isActive = pageSize !== 12;
          return (
            <div className="relative inline-flex items-center">
              <span
                className={cn(
                  'absolute left-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full pointer-events-none',
                  isActive ? 'bg-brand-500' : 'bg-slate-300',
                )}
              />
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                title="Số dòng hiển thị mỗi trang"
                className={cn(
                  'pl-7 pr-8 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-white text-slate-700',
                  'cursor-pointer hover:bg-slate-50 transition-all',
                  isActive && 'ring-2 ring-brand-300',
                )}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}/trang</option>
                ))}
              </select>
            </div>
          );
        })()}

        {/* TM/GC filter */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 overflow-hidden">
          {[
            { val: 'all', label: 'TM+GC' },
            { val: 'TM', label: 'TM' },
            { val: 'GC', label: 'GC' },
          ].map(({ val, label }) => (
            <button
              key={val}
              onClick={() => { setLoaiHangFilter(val); setPage(1); }}
              className={cn(
                'px-2.5 py-1.5 text-xs font-medium transition-colors',
                loaiHangFilter === val
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              )}
              title={val === 'GC' ? 'Gia công (có file Drawing)' : val === 'TM' ? 'Thương mại' : 'Tất cả'}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search — handled by global Ctrl+K palette (top-nav).
            When active, show chip with current search term + clear button.
            Removed in-page input/button per Thang 2026-05-22. */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          {search ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-50 border border-brand-200 text-xs">
              <Search className="h-3.5 w-3.5 text-brand-600 flex-shrink-0" />
              <span className="text-slate-500">Đang lọc:</span>
              <span className="font-mono font-semibold text-brand-700">{search}</span>
              <button
                onClick={() => {
                  setSearch('');
                  setPage(1);
                  // Strip ?search= from URL without reload
                  if (typeof window !== 'undefined') {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('search');
                    window.history.replaceState({}, '', url.toString());
                  }
                }}
                className="ml-1 text-slate-400 hover:text-rose-600 font-bold"
                title="Xoá bộ lọc tìm kiếm"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                // Trigger Ctrl+K palette. Using window.KeyboardEvent (the
                // global DOM constructor) because `KeyboardEvent` was
                // shadowed by `import { KeyboardEvent } from 'react'` at the
                // top of this file (React's type, undefined at runtime).
                if (typeof window === 'undefined') return;
                window.dispatchEvent(new window.KeyboardEvent('keydown', {
                  key: 'k', ctrlKey: true, bubbles: true,
                }));
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-brand-300 bg-white text-xs text-slate-500 hover:text-slate-700 transition-colors"
              title="Mở thanh tìm kiếm Ctrl+K"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Tìm mã BQMS / RFQ...</span>
              <kbd className="ml-2 px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[11px] font-mono text-slate-400">
                Ctrl K
              </kbd>
            </button>
          )}
        </div>
      </div>

      {/* ── Action-bar nổi: Gửi đấu thầu NCC (Thang 2026-06-28) ──
          Chỉ hiện khi đủ quyền + đang chọn ≥1 mã. Đồng nhất pattern /sourcing
          (giữa filter & bảng), màu brand (đấu thầu = brand toàn hệ thống). */}
      <AnimatePresence>
        {canPushBidding && selectedRfqIds.size > 0 && (
          <motion.div
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="mb-3 rounded-2xl border border-brand-200 bg-brand-50/60 px-5 py-3.5"
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-brand-600 flex items-center justify-center">
                  <Gavel className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="text-sm font-bold text-brand-900">
                    {selectedRfqIds.size} mã đã chọn
                  </div>
                  <div className="text-xs text-brand-700">
                    Chỉ gửi mã đang mở · không chia sẻ giá nội bộ
                  </div>
                </div>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setPushBiddingIds(Array.from(selectedRfqIds))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 transition-colors shadow-sm"
                >
                  <Gavel className="h-4 w-4" />
                  Gửi đấu thầu ({selectedRfqIds.size})
                </button>
                <button
                  onClick={() => setBatchPushSecIds(Array.from(selectedRfqIds))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-900 transition-colors shadow-sm"
                  title="Đẩy nhiều mã lên sec-bqms.com lần lượt (Save Temporarily)"
                >
                  🚀 Đẩy lên SEC ({selectedRfqIds.size})
                </button>
                <button
                  onClick={() => setSelectedRfqIds(new Set())}
                  className="text-xs text-slate-600 hover:text-rose-600 font-semibold inline-flex items-center gap-1 px-2.5 py-2 rounded-md hover:bg-white"
                >
                  <X className="h-3.5 w-3.5" /> Bỏ chọn
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Table — Thang 2026-06-13 (Task 5): bỏ overflow-hidden
          để sticky thead không bị clip. Border-radius vẫn ổn vì children
          tự bo (ScrollableTableWrapper là div thường). */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
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
          <ScrollableTableWrapper>
            <table className="w-full border-collapse text-xs">
              {/* Sticky header — sticky-left up to "Tên hàng" col per Thang 2026-05-11
                  + color-dot status (no text) + ALL Bidding fields visible.
                  Thang 2026-06-13 (Task 5): top-3 (12px) để né top-scrollbar h-3
                  của ScrollableTableWrapper; z-30 < z-40 (top scrollbar) để chuột
                  vẫn dùng được scrollbar. */}
              <thead className="sticky top-3 z-30">
                <tr className="bg-slate-100 text-slate-600 text-[12px]">
                  {/* Sticky-left group — Per Thang 2026-05-13: Hành động lên đầu */}
                  <th className="text-center px-2 py-2 font-semibold whitespace-nowrap w-24 sticky left-0 bg-slate-100 z-20">Hành động</th>
                  <th className="text-center px-2 py-2 font-semibold whitespace-nowrap sticky left-[96px] bg-slate-100 z-20" title="Trạng thái (chấm màu)">●</th>
                  <th className="text-center px-2 py-2 font-semibold whitespace-nowrap sticky left-[124px] bg-slate-100 z-20" title="Ngày đẩy báo giá lên SEC">Ngày đẩy</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap sticky left-[156px] bg-slate-100 z-20">RFQ</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap sticky left-[246px] bg-slate-100 z-20">BQMS</th>
                  <th className="text-center px-2 py-2 font-semibold whitespace-nowrap w-24 sticky left-[336px] bg-slate-100 z-20">Ảnh</th>
                  <th className="text-left px-2 py-2 font-semibold sticky left-[432px] bg-slate-100 z-20 min-w-[280px]">Tên hàng / Subject</th>

                  {/* Scrollable group — min-widths added 2026-05-29 cho cột dễ đọc */}
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap">Loại</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap min-w-[140px]">Maker</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">SL</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap">ĐVT</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">MOQ</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap">CIS</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap min-w-[130px]">Part No</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap min-w-[110px]" title="Người Samsung yêu cầu báo giá (từ xlsx)">Requester</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap min-w-[110px]" title="Phòng ban Samsung order">Department</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap min-w-[110px]" title="Nhân viên ERP báo giá mã này (auto-tracked)">Người PT</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap">Ngày</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap">Hạn BG</th>
                  <th className="text-center px-2 py-2 font-semibold whitespace-nowrap">D-N</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap" title="Số mã linh kiện trong RFQ">#Items</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap" title="Số file đính kèm">#Files</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Giá V1</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Giá V2</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Giá V3</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Giá V4</th>
                  <th className="text-left px-2 py-2 font-semibold whitespace-nowrap">NCC</th>
                </tr>
              </thead>

              {isLoading ? (
                <TableSkeleton />
              ) : items.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={27} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-300">
                        <Inbox className="h-10 w-10" />
                        <p className="text-sm text-slate-400">Không có dữ liệu phù hợp</p>
                        {(search || resultFilter !== 'all' || sourceFilter !== 'all' || loaiHangFilter !== 'all' || roundFilter !== 'all' || year || month) && (
                          <button
                            onClick={() => {
                              setSearch('');
                              setResultFilter('all');
                              setSourceFilter('all');
                              setLoaiHangFilter('all');
                              setRoundFilter('all');
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
                            onQuoteFromBqms={(stagingId) => quoteFromBqmsMutation.mutate(stagingId)}
                            quoteFromBqmsPending={quoteFromBqmsMutation.isPending}
                            quoteFromBqmsRowId={
                              typeof quoteFromBqmsMutation.variables === 'number'
                                ? quoteFromBqmsMutation.variables
                                : null
                            }
                            quoteDrillingIds={drillingIds}
                            canPushBidding={canPushBidding}
                            selectedRfqIds={selectedRfqIds}
                            isSelectable={isSelectable}
                            onToggleSelect={toggleSelectRfq}
                            onToggleSelectMonth={toggleSelectMonth}
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
                            onQuoteFromBqms={(sid) => quoteFromBqmsMutation.mutate(sid)}
                            quoteFromBqmsPending={quoteFromBqmsMutation.isPending}
                            quoteFromBqmsRowId={
                              typeof quoteFromBqmsMutation.variables === 'number'
                                ? quoteFromBqmsMutation.variables
                                : null
                            }
                            quoteDrillingIds={drillingIds}
                            canPushBidding={canPushBidding}
                            isSelected={selectedRfqIds.has(item.id)}
                            isPushable={isSelectable(item)}
                            onToggleSelect={toggleSelectRfq}
                          />
                        );
                      })}
                </tbody>
              )}
            </table>
          </ScrollableTableWrapper>
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

      {/* ── Side drawer — slides from right with full RFQ details + folder + images */}
      {drawerItem && (
        <DetailDrawer
          item={drawerItem}
          onClose={() => setDrawerItem(null)}
          onQuoteFromBqms={(sid) => {
            quoteFromBqmsMutation.mutate(sid);
            setDrawerItem(null);
          }}
          onPushToSec={(rid, initialRound) => {
            setPushToSecRfqId(rid, initialRound);
            setDrawerItem(null);
          }}
        />
      )}

      {/* Push to SEC modal — initialRound từ scenario classification (TH1→V1, TH2→V2, TH3→tiếp theo) */}
      {pushToSecState != null && (
        <PushToSecModal
          rfqId={pushToSecState.rfqId}
          initialRound={pushToSecState.initialRound}
          onClose={() => setPushToSecState(null)}
        />
      )}

      {/* Push progress popup — auto-open khi có job running */}
      <PushProgressPopup />

      {/* Push queue widget — fixed bottom-right */}
      <PushQueueWidget onClickRfq={(id) => setPushToSecRfqId(id)} />

      {/* Gửi mã BQMS sang đấu thầu NCC — tái dùng modal /sourcing (Thang 2026-06-28) */}
      {pushBiddingIds && pushBiddingIds.length > 0 && (
        <PushToBiddingModal
          source="bqms"
          ids={pushBiddingIds}
          onClose={() => setPushBiddingIds(null)}
          onDone={() => {
            setSelectedRfqIds(new Set());
            setPushBiddingIds(null);
          }}
        />
      )}

      {/* Đẩy NHIỀU mã lên SEC lần lượt (Thang 2026-06-29) */}
      {batchPushSecIds && batchPushSecIds.length > 0 && (
        <BatchPushSecModal
          rfqIds={batchPushSecIds}
          onClose={() => setBatchPushSecIds(null)}
          onDone={() => {
            setSelectedRfqIds(new Set());
            setBatchPushSecIds(null);
          }}
        />
      )}
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
  onQuoteFromBqms,
  quoteFromBqmsPending,
  quoteFromBqmsRowId,
  quoteDrillingIds,
  // Gửi đấu thầu NCC (Thang 2026-06-28)
  canPushBidding,
  selectedRfqIds,
  isSelectable,
  onToggleSelect,
  onToggleSelectMonth,
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
  onQuoteFromBqms?: (stagingId: number) => void;
  quoteFromBqmsPending?: boolean;
  quoteFromBqmsRowId?: number | null;
  quoteDrillingIds?: Set<number>;
  canPushBidding?: boolean;
  selectedRfqIds?: Set<number>;
  isSelectable?: (it: RFQItem) => boolean;
  onToggleSelect?: (id: number) => void;
  onToggleSelectMonth?: (ids: number[], select: boolean) => void;
}) {
  // QĐ-3: trạng thái checkbox header — chỉ tính trên mã GỬI-ĐƯỢC của nhóm.
  // Mã disabled (won/lost/closed/thiếu bqms_code) KHÔNG vào tử/mẫu → "chọn tất
  // cả" không bao giờ kẹt indeterminate.
  const pushableIds = isSelectable ? items.filter(isSelectable).map((it) => it.id) : [];
  const selectedInGroup = pushableIds.filter((id) => selectedRfqIds?.has(id)).length;
  const allChecked = pushableIds.length > 0 && selectedInGroup === pushableIds.length;
  const someChecked = selectedInGroup > 0 && !allChecked;

  return (
    <>
      <MonthGroupHeader
        summary={summary}
        collapsed={collapsed}
        onToggle={onToggle}
        canPushBidding={canPushBidding}
        pushableIds={pushableIds}
        allChecked={allChecked}
        someChecked={someChecked}
        onToggleSelectMonth={onToggleSelectMonth}
      />
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
              onQuoteFromBqms={onQuoteFromBqms}
              quoteFromBqmsPending={quoteFromBqmsPending}
              quoteFromBqmsRowId={quoteFromBqmsRowId}
              quoteDrillingIds={quoteDrillingIds}
              onCancelCell={onCancelCell}
              pageYear={pageYear}
              pageMonth={pageMonth}
              canPushBidding={canPushBidding}
              isSelected={selectedRfqIds?.has(item.id)}
              isPushable={isSelectable ? isSelectable(item) : false}
              onToggleSelect={onToggleSelect}
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
  onQuoteFromBqms,
  quoteFromBqmsPending,
  quoteFromBqmsRowId,
  quoteDrillingIds,
  // Gửi đấu thầu NCC (Thang 2026-06-28)
  canPushBidding,
  isSelected,
  isPushable,
  onToggleSelect,
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
  onQuoteFromBqms?: (stagingId: number) => void;
  quoteFromBqmsPending?: boolean;
  quoteFromBqmsRowId?: number | null;
  quoteDrillingIds?: Set<number>;
  canPushBidding?: boolean;
  isSelected?: boolean;
  isPushable?: boolean;
  onToggleSelect?: (id: number) => void;
}) {
  const isPending = !!item.is_pending;
  // Thang 2026-06-23: nút Báo giá hiện cho cả 2 case: is_pending (staging chưa
  // có bqms_rfq) VÀ row đã upsert nhưng quote_unlocked=false → spinner phải bám
  // cả 2. Bỏ điều kiện `isPending` cũ (làm row locked không bao giờ hiện spinner).
  const canQuoteThisRow = isPending || item.quote_unlocked === false
    || (!isLiveClosed(item.deadline_dt, item.result) && item.quote_unlocked !== true);
  // ON-DEMAND DRILL state cho row này (BE đang tải chi tiết RFQ từ Samsung).
  const isDrillingThis = item.staging_id != null && !!quoteDrillingIds?.has(item.staging_id);
  // "Đang gọi /quote" tức thì cho ĐÚNG row (per-row, KHÔNG disable toàn cục).
  const isQuotingThis =
    canQuoteThisRow && quoteFromBqmsPending && quoteFromBqmsRowId === item.staging_id;
  // Trạng thái bận tổng hợp của row (spinner + chặn double-click CHỈ row này).
  const isRowBusy = isDrillingThis || isQuotingThis;
  const dateStr = item.effective_date ?? item.inquiry_date ?? item.created_at ?? '';

  // Row tint per Thang 2026-05-11:
  //   pending (chưa báo)  → amber
  //   V1 đã set           → blue tint
  //   V2 đã set           → cyan tint
  //   V3+ đã set          → teal/emerald
  //   result = won        → emerald solid
  //   result = lost       → red
  //   result = skipped    → gray
  const result = (item.result ?? '').toLowerCase();
  let rowTint = '';
  let rowTintHover = '';
  let stickyBg = 'bg-white';
  let stickyBgHover = 'group-hover:bg-slate-50/70';
  if (result === 'lost') {
    rowTint = 'bg-red-50/60';
    rowTintHover = 'hover:bg-red-100/70';
    stickyBg = 'bg-red-50/60'; stickyBgHover = 'group-hover:bg-red-100/70';
  } else if (result === 'won') {
    rowTint = 'bg-emerald-50/60';
    rowTintHover = 'hover:bg-emerald-100/70';
    stickyBg = 'bg-emerald-50/60'; stickyBgHover = 'group-hover:bg-emerald-100/70';
  } else if (result === 'skipped') {
    rowTint = 'bg-slate-100/60 text-slate-400';
    rowTintHover = 'hover:bg-slate-100';
    stickyBg = 'bg-slate-100/60'; stickyBgHover = 'group-hover:bg-slate-100';
  } else if (isPending) {
    rowTint = 'bg-amber-50/50';
    rowTintHover = 'hover:bg-amber-100/50';
    stickyBg = 'bg-amber-50/50'; stickyBgHover = 'group-hover:bg-amber-100/50';
  } else if (item.quoted_price_bqms_v3 != null || item.quoted_price_bqms_v4 != null) {
    rowTint = 'bg-teal-50/50';
    rowTintHover = 'hover:bg-teal-100/50';
    stickyBg = 'bg-teal-50/50'; stickyBgHover = 'group-hover:bg-teal-100/50';
  } else if (item.quoted_price_bqms_v2 != null) {
    rowTint = 'bg-cyan-50/50';
    rowTintHover = 'hover:bg-cyan-100/50';
    stickyBg = 'bg-cyan-50/50'; stickyBgHover = 'group-hover:bg-cyan-100/50';
  } else if (item.quoted_price_bqms_v1 != null) {
    rowTint = 'bg-blue-50/40';
    rowTintHover = 'hover:bg-blue-100/50';
    stickyBg = 'bg-blue-50/40'; stickyBgHover = 'group-hover:bg-blue-100/50';
  }
  // Round-2 urgency override (Thang 2026-05-18): is_round2_24h gets cam highlight
  // Overrides any other tint to make it pop visually.
  if (item.is_round2_24h) {
    rowTint = 'bg-orange-100/80 ring-2 ring-orange-300 ring-inset';
    rowTintHover = 'hover:bg-orange-200/80';
    stickyBg = 'bg-orange-100/80'; stickyBgHover = 'group-hover:bg-orange-200/80';
  } else if (item.is_round2_priority) {
    // Round-2 priority but >24h old → softer amber border
    rowTint = cn(rowTint || 'bg-amber-50/40', 'border-l-4 border-amber-400');
    rowTintHover = rowTintHover || 'hover:bg-amber-100/40';
  }
  if (isExpanded) {
    rowTint = 'bg-brand-50/60';
    rowTintHover = '';
    stickyBg = 'bg-brand-50/60'; stickyBgHover = '';
  }

  return (
    <>
      <tr
        onClick={() => onRowClick(item.id)}
        className={cn(
          'border-b border-slate-100 transition-colors cursor-pointer text-[13px] group',
          rowTint || 'hover:bg-slate-50/70',
          rowTintHover,
          urgency === 'red' && !rowTint ? 'bg-red-50/30' : '',
          urgency === 'amber' && !rowTint ? 'bg-amber-50/20' : ''
        )}
      >
        {/* Hành động — Per Thang 2026-05-13: chuyển lên đầu + sticky-left.
            FIX duplicate (Thang 2026-05-14): button hiện cho cả 2 case:
              - is_pending=true (staging chưa có bqms_rfq) → button trên staging row
              - is_pending=false + quote_unlocked=false (đã có bqms_rfq locked) → button trên approved row
            Cả 2 dùng chung staging_id từ enrich, gọi cùng endpoint. */}
        <td className={cn(
          'px-2 py-1.5 text-center whitespace-nowrap w-24 sticky left-0 z-10',
          stickyBg, stickyBgHover,
        )} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center gap-1.5">
            {/* Checkbox gửi đấu thầu NCC — chỉ render khi đủ quyền (QĐ-1).
                Disabled nếu mã đã có kết quả / thiếu bqms_code (QĐ-2). Nằm TRONG
                td đã có onClick stopPropagation → click không mở row-detail. */}
            {canPushBidding && (
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                checked={!!isSelected}
                disabled={!isPushable}
                onChange={() => onToggleSelect?.(item.id)}
                aria-label={`Chọn RFQ ${item.rfq_number ?? item.bqms_code ?? item.id} để gửi đấu thầu`}
                title={
                  isPushable
                    ? 'Chọn để gửi đấu thầu NCC'
                    : !item.bqms_code
                      ? 'Mã chưa có bqms_code — không gửi được'
                      : 'Mã đã có kết quả — không gửi đấu thầu'
                }
              />
            )}
            {canQuoteThisRow && item.staging_id != null ? (
              <button
                type="button"
                // Thang 2026-06-23: disable CHỈ khi ĐÚNG row này đang bận
                // (isRowBusy) — KHÔNG còn disable toàn cục `quoteFromBqmsPending`
                // (cũ: 1 row báo giá thì mọi nút khác đông cứng → "lúc được lúc
                // không").
                onClick={() => onQuoteFromBqms?.(item.staging_id!)}
                disabled={isRowBusy}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-all',
                  isDrillingThis
                    ? 'bg-sky-200 text-sky-800 cursor-wait'
                    : isQuotingThis
                      ? 'bg-amber-200 text-amber-800 cursor-wait'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'
                )}
                title={
                  isDrillingThis
                    ? 'Đang tải chi tiết RFQ từ Samsung… nút sẽ tự mở khoá khi xong.'
                    : 'Mở khoá V1-V4 + assign về user. Nếu RFQ chưa có chi tiết, hệ thống tự tải rồi mở khoá.'
                }
              >
                {isDrillingThis ? (
                  <><Loader2 className="h-3 w-3 animate-spin" />Đang tải…</>
                ) : isQuotingThis ? (
                  <><Loader2 className="h-3 w-3 animate-spin" />Đang...</>
                ) : (
                  <><CheckCircle2 className="h-3 w-3" />Báo giá</>
                )}
              </button>
            ) : (
              <span className="text-slate-300 text-[11px]">—</span>
            )}
          </div>
        </td>

        {/* ● Status dot — color-only, no text. Per Thang 2026-05-11. */}
        <td className={cn(
          'px-2 py-1.5 text-center sticky left-[96px] z-10',
          stickyBg, stickyBgHover,
        )}>
          <StatusDot item={item} />
        </td>

        {/* Ngày đẩy — Thang 2026-06-15 (Batch 2f): thay cột STT "#".
            Ưu tiên bqms_pushed_at; fallback created_at → reg_dt; "—" nếu trống. */}
        <td className={cn(
          'px-2 py-1.5 text-center text-slate-500 whitespace-nowrap sticky left-[124px] z-10',
          stickyBg, stickyBgHover,
        )}>
          {fmtDateShort(item.bqms_pushed_at) ?? fmtDateShort(item.created_at) ?? fmtDateShort(item.reg_dt) ?? '—'}
        </td>

        {/* RFQ */}
        <td className={cn(
          'px-2 py-1.5 whitespace-nowrap sticky left-[156px] z-10',
          stickyBg, stickyBgHover,
        )}>
          <div className="flex items-center gap-1">
            <span className="font-mono text-brand-600 font-semibold">{item.rfq_number ?? '—'}</span>
            {/* Smart scenario badge (TH1/TH2/TH3) — overrides plain V{version} */}
            {item.scenario && item.scenario_meta && (
              <span
                className={cn(
                  'inline-flex items-center px-1.5 py-0 text-[11px] font-bold rounded',
                  item.scenario_meta.badge_color === 'emerald' && 'bg-emerald-100 text-emerald-700',
                  item.scenario_meta.badge_color === 'amber' && 'bg-amber-100 text-amber-700',
                  item.scenario_meta.badge_color === 'violet' && 'bg-brand-100 text-brand-700',
                )}
                title={item.scenario_meta.tooltip}>
                {item.scenario_meta.label}
              </span>
            )}
            {item.version && item.version > 1 && (
              <span className="inline-flex items-center px-1 py-0 text-[11px] font-bold rounded bg-orange-100 text-orange-700"
                title={`Samsung vòng ${item.version}`}>
                V{item.version}
              </span>
            )}
            {/* Issue B (Thang 2026-06-19): V-round push state pill — only
                renders when the RFQ has been pushed at least once. Tooltip
                lists all V1..V4 prices for quick scan. */}
            <PushRoundBadge
              round={item.bqms_pushed_round ?? null}
              state={item.bqms_push_status ?? null}
              pricesV={[
                item.quoted_price_bqms_v1,
                item.quoted_price_bqms_v2,
                item.quoted_price_bqms_v3,
                item.quoted_price_bqms_v4,
              ]}
              pushedAt={item.bqms_pushed_at ?? null}
            />
            {item.is_round2_24h && (
              <span className="inline-flex items-center px-1.5 py-0 text-[11px] font-bold rounded bg-orange-500 text-white animate-pulse"
                title={`Samsung mời round ${item.version ?? 2} trong 24h gần nhất — báo giá sớm!`}>
                🔔 MỚI
              </span>
            )}
          </div>
        </td>

        {/* BQMS Code */}
        <td className={cn(
          'px-2 py-1.5 whitespace-nowrap sticky left-[246px] z-10',
          stickyBg, stickyBgHover,
        )}>
          <span className="font-mono text-slate-700 text-xs">{item.bqms_code ?? '—'}</span>
        </td>

        {/* Ảnh — Phase H (Thang 2026-05-13): widened 48→96px for larger thumbnail */}
        <td className={cn(
          'px-1.5 py-1 text-center sticky left-[336px] z-10 w-24',
          stickyBg, stickyBgHover,
        )} onClick={(e) => e.stopPropagation()}>
          <BqmsImageThumb bqmsCode={item.bqms_code} rfqNumber={item.rfq_number} />
        </td>

        {/* Tên hàng (Description + Spec) — STICKY end here. Shifted +44px for new Ảnh width. */}
        <td className={cn(
          'px-2 py-1.5 sticky left-[432px] z-10 max-w-[300px] border-r border-slate-200',
          stickyBg, stickyBgHover,
        )}>
          {(item.description || item.specification) ? (
            <div className="min-w-0">
              {item.description && (
                <div className="text-slate-800 truncate font-semibold text-[11px]" title={item.description}>
                  {item.description}
                </div>
              )}
              {item.specification && (
                <div className="text-slate-500 truncate text-[11px]" title={item.specification}>
                  {item.specification}
                </div>
              )}
              {!item.description && !item.specification && item.req_name && (
                <div className="text-slate-700 truncate" title={item.req_name}>{item.req_name}</div>
              )}
            </div>
          ) : (
            <span className="text-slate-800 truncate block font-medium" title={item.req_name ?? ''}>
              {item.req_name ?? '—'}
            </span>
          )}
        </td>

        {/* === Scrollable region === */}

        {/* Loại (TM/GC) — Phase E (Thang 2026-05-13): click để override */}
        <td className="px-2 py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {item.id > 0 ? (
            <ClassificationCell
              rfqId={item.id}
              current={item.classification}
              isOverride={item.classification_is_override}
              autoValue={item.classification_auto}
            />
          ) : item.classification ? (
            <span className={cn(
              'inline-flex px-1.5 py-0 text-[11px] font-bold rounded border',
              item.classification.toUpperCase() === 'GC'
                ? 'bg-orange-100 text-orange-700 border-orange-200'
                : 'bg-blue-50 text-blue-700 border-blue-200'
            )}>{item.classification.toUpperCase()}</span>
          ) : <span className="text-slate-300">—</span>}
        </td>

        {/* Maker */}
        <td className="px-2 py-1.5 whitespace-nowrap text-slate-600 max-w-[110px]">
          <span className="truncate block">{item.first_maker ?? item.maker ?? '—'}</span>
        </td>

        {/* SL */}
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
          {item.expected_qty != null ? Number(item.expected_qty).toLocaleString('vi-VN') : '—'}
        </td>

        {/* ĐVT */}
        <td className="px-2 py-1.5 text-slate-600">{item.unit ?? '—'}</td>

        {/* MOQ */}
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
          {item.first_moq ?? '—'}
        </td>

        {/* CIS */}
        <td className="px-2 py-1.5 font-mono text-[11px] text-slate-500">
          {item.first_cis_code ?? '—'}
        </td>

        {/* Part No */}
        <td className="px-2 py-1.5 max-w-[120px] truncate font-mono text-[11px] text-slate-500"
            title={item.first_part_no ?? ''}>
          {item.first_part_no ?? '—'}
        </td>

        {/* Requester (Phase 2 — từ xlsx Basic Information) */}
        <td className="px-2 py-1.5 max-w-[120px] truncate text-slate-600" title={item.requester ?? ''}>
          {item.requester ?? <span className="text-slate-300">—</span>}
        </td>

        {/* Department (Phase 2 — từ xlsx Basic Information) */}
        <td className="px-2 py-1.5 max-w-[100px] whitespace-nowrap">
          {item.department ? (
            <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 truncate max-w-[90px]" title={item.department}>
              {item.department}
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>

        {/* Người PT — CHỈ hiện tên nhân viên ERP đã báo giá (assigned_to_name auto-set khi click "Báo giá").
            KHÔNG fallback Samsung-side names để tránh trùng cột Requester. */}
        <td className="px-2 py-1.5 whitespace-nowrap text-emerald-700 max-w-[110px] font-medium" title={item.assigned_to_name ?? 'Chưa có nhân viên ERP báo giá'}>
          <span className="truncate block">
            {item.assigned_to_name ?? <span className="text-slate-300 font-normal">—</span>}
          </span>
        </td>

        {/* Ngày tạo */}
        <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">
          {fmtDateShort(item.reg_dt) ?? (dateStr ? formatDate(dateStr).slice(0, 5) : '—')}
        </td>

        {/* Hạn BG */}
        <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap text-[11px]">
          {fmtDeadline(item.deadline_dt)}
        </td>

        {/* D-N countdown — computed LIVE from deadline_dt (auto counts down,
            quá hạn → Closed). dday_html kept only as fallback. */}
        <td className="px-2 py-1.5 text-center whitespace-nowrap">
          {ddayBadge(item.deadline_dt, item.result, item.dday_html)}
        </td>

        {/* #Items */}
        <td className="px-2 py-1.5 text-right tabular-nums">
          {item.items_count != null && item.items_count > 0 ? (
            <span className="inline-flex items-center px-1.5 py-0 text-[11px] font-bold rounded bg-slate-100 text-slate-700">
              {item.items_count}
            </span>
          ) : item.detail_error ? (
            <span className="text-red-400 text-[11px]" title={item.detail_error}>err</span>
          ) : <span className="text-slate-300">—</span>}
        </td>

        {/* #Files */}
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
          {item.attachments_count != null && item.attachments_count > 0
            ? item.attachments_count : <span className="text-slate-300">—</span>}
        </td>

        {/* Giá V1-V4 — hide entirely (gray dash) when pending; editable when quoted */}
        {isPending ? (
          <>
            <td className="px-2 py-1.5 text-center text-slate-300 bg-slate-50/40">—</td>
            <td className="px-2 py-1.5 text-center text-slate-300 bg-slate-50/40">—</td>
            <td className="px-2 py-1.5 text-center text-slate-300 bg-slate-50/40">—</td>
            <td className="px-2 py-1.5 text-center text-slate-300 bg-slate-50/40">—</td>
          </>
        ) : (
          <>
            <PriceCell item={item} field="quoted_price_bqms_v1" value={item.quoted_price_bqms_v1}
              editingCell={editingCell} onStartEdit={onStartEdit} onSave={onSaveCell} onCancel={onCancelCell} />
            <PriceCell item={item} field="quoted_price_bqms_v2" value={item.quoted_price_bqms_v2}
              editingCell={editingCell} onStartEdit={onStartEdit} onSave={onSaveCell} onCancel={onCancelCell} />
            <PriceCell item={item} field="quoted_price_bqms_v3" value={item.quoted_price_bqms_v3}
              editingCell={editingCell} onStartEdit={onStartEdit} onSave={onSaveCell} onCancel={onCancelCell} />
            <PriceCell item={item} field="quoted_price_bqms_v4" value={item.quoted_price_bqms_v4}
              editingCell={editingCell} onStartEdit={onStartEdit} onSave={onSaveCell} onCancel={onCancelCell} />
          </>
        )}

        {/* NCC — last column (Hành động chuyển lên đầu rồi) */}
        <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap max-w-[110px]">
          <span className="truncate block">{item.supplier_name ?? '—'}</span>
        </td>
      </tr>

      {/* Inline detail panel disabled per Thang 2026-05-11 — replaced by
          right-side <DetailDrawer/> at page level. */}
      {false && isExpanded && (
        <RowDetailPanel item={item} onClose={() => onRowClick(item.id)} pageYear={pageYear} pageMonth={pageMonth} />
      )}
    </>
  );
}

// ─── ClassificationCell — TM/GC badge with click-to-edit override ────────────
//
// Phase E (Thang 2026-05-13): user có thể override TM/GC nếu auto-detect sai.
// Click badge → popover với 3 nút TM / GC / Auto. Sau khi đổi, gọi
// PATCH /api/v1/bqms/rfq/{id}/classification để lưu vào DB.

function ClassificationCell({
  rfqId, current, isOverride, autoValue,
}: {
  rfqId: number;
  current: string | null;
  isOverride?: boolean;
  autoValue?: string | null;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSet = async (val: 'TM' | 'GC' | null) => {
    setSaving(true);
    try {
      await api.patch(`/api/v1/bqms/rfq/${rfqId}/classification`, { classification: val });
      toast.success(val ? `Đã set Loại = ${val}` : 'Đã revert về auto-detect');
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  const cur = (current || '').toUpperCase();
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={saving}
        className={cn(
          'inline-flex items-center gap-0.5 px-1.5 py-0 text-[11px] font-bold rounded border hover:ring-1 hover:ring-slate-400 transition-all',
          !cur
            ? 'bg-slate-100 text-slate-400 border-slate-200'
            : cur === 'GC'
            ? 'bg-orange-100 text-orange-700 border-orange-200'
            : 'bg-blue-50 text-blue-700 border-blue-200',
        )}
        title={isOverride ? `User override (auto: ${autoValue ?? '?'})` : 'Click để override'}
      >
        {cur || '—'}
        {isOverride && <Pencil className="h-2 w-2 ml-0.5" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg p-1.5 flex flex-col gap-0.5 min-w-[120px]">
            <button
              type="button"
              onClick={() => handleSet('TM')}
              className="text-left px-2 py-1 rounded hover:bg-blue-50 text-[11px] font-semibold text-blue-700"
            >TM (Thương mại)</button>
            <button
              type="button"
              onClick={() => handleSet('GC')}
              className="text-left px-2 py-1 rounded hover:bg-orange-50 text-[11px] font-semibold text-orange-700"
            >GC (Gia công)</button>
            <button
              type="button"
              onClick={() => handleSet(null)}
              className="text-left px-2 py-1 rounded hover:bg-slate-100 text-[11px] text-slate-600 border-t border-slate-100 mt-0.5 pt-1.5"
            >↻ Auto-detect{autoValue ? ` (${autoValue})` : ''}</button>
          </div>
        </>
      )}
    </div>
  );
}

// PR-2 (Thang 2026-05-13): BqmsImageThumb extracted to @/components/bqms-images/BqmsImageThumb.tsx

// ─── ScrollableTableWrapper — sticky-top horizontal scrollbar per Thang 2026-05-11
//
// User complained: phải kéo xuống cuối bảng để dùng thanh cuộn ngang. This
// wrapper renders a SECOND scrollbar near the top (sticky to viewport) that
// mirrors the bottom one bidirectionally. Scrolling either updates the other.

function ScrollableTableWrapper({ children }: { children: React.ReactNode }) {
  const topRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const tableInnerRef = useRef<HTMLDivElement | null>(null);
  const [innerWidth, setInnerWidth] = useState(0);

  // Sync widths so the top scroller has same scrollWidth as the table.
  useEffect(() => {
    if (!mainRef.current) return;
    const update = () => {
      const w = mainRef.current?.scrollWidth ?? 0;
      setInnerWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(mainRef.current);
    return () => ro.disconnect();
  }, []);

  // Bidirectional scroll sync.
  const syncFromTop = () => {
    if (!topRef.current || !mainRef.current) return;
    if (mainRef.current.scrollLeft !== topRef.current.scrollLeft) {
      mainRef.current.scrollLeft = topRef.current.scrollLeft;
    }
  };
  const syncFromMain = () => {
    if (!topRef.current || !mainRef.current) return;
    if (topRef.current.scrollLeft !== mainRef.current.scrollLeft) {
      topRef.current.scrollLeft = mainRef.current.scrollLeft;
    }
  };

  // Shift+wheel → horizontal scroll (in addition to natural Shift+scroll
  // browser behavior — explicit handler covers laptops without horizontal wheels).
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!mainRef.current) return;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      mainRef.current.scrollLeft += e.deltaY || e.deltaX;
    }
  };

  return (
    <div className="relative">
      {/* Sticky top scrollbar — sticks to top of viewport while user scrolls
          the table vertically; mirrors the bottom scrollbar's position. */}
      <div
        ref={topRef}
        onScroll={syncFromTop}
        className="sticky top-0 z-40 overflow-x-auto overflow-y-hidden h-3 bg-slate-50 border-b border-slate-200"
        aria-label="Thanh cuộn ngang phía trên"
      >
        <div style={{ width: innerWidth, height: 1 }} />
      </div>

      {/* Main scrollable table — Thang 2026-06-13 (Bug fix T5): CSS Overflow
          Level 3 says `overflow-x: auto; overflow-y: visible` computes to
          `overflow: auto auto`, silently clipping the sticky <thead>. Fix:
          declare ONLY overflow-x-auto so the Y axis stays the default
          (visible) and sticky attaches to the actual viewport scroller. */}
      <div
        ref={mainRef}
        onScroll={syncFromMain}
        onWheel={handleWheel}
        className="overflow-x-auto"
      >
        <div ref={tableInnerRef}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── ResultMarkControl — segmented Thắng/Thua/Đang chờ (Tính năng A) ─────────
//
// Thang: 2629 RFQ 'closed' chưa ghi thắng/thua → chặn dự đoán %thắng. Cho user
// nội bộ đánh dấu kết quả 1 RFQ. Gọi PATCH /rfq/{id}/result rồi invalidate table.
function ResultMarkControl({ rfqId, current }: { rfqId: number; current: string | null }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const cur = (current ?? '').toLowerCase();

  const mark = async (val: 'won' | 'lost' | 'pending') => {
    if (val === cur) return;
    setSaving(val);
    try {
      await api.patch(`/api/v1/bqms/rfq/${rfqId}/result`, { result: val });
      toast.success(val === 'won' ? 'Đã đánh dấu Thắng' : val === 'lost' ? 'Đã đánh dấu Thua' : 'Đã chuyển Đang chờ');
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(null);
    }
  };

  const opts: { val: 'won' | 'lost' | 'pending'; label: string; on: string }[] = [
    { val: 'won', label: 'Thắng', on: 'bg-emerald-500 text-white' },
    { val: 'lost', label: 'Thua', on: 'bg-rose-500 text-white' },
    { val: 'pending', label: 'Đang chờ', on: 'bg-amber-400 text-amber-950' },
  ];

  return (
    <div className="inline-flex items-center rounded-lg overflow-hidden border border-white/30 bg-white/10">
      {opts.map((o) => (
        <button
          key={o.val}
          type="button"
          onClick={() => mark(o.val)}
          disabled={saving != null}
          className={cn(
            'px-2.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-60',
            cur === o.val ? o.on : 'text-white hover:bg-white/20',
          )}
          title={`Đánh dấu kết quả = ${o.label}`}
        >
          {saving === o.val ? '…' : o.label}
        </button>
      ))}
    </div>
  );
}

// ─── DetailDrawer — slide-in from right per Thang 2026-05-11 ─────────────────
//
// Replaces the in-table expanded panel. Shows the COMPLETE RFQ context:
//   1. Header (RFQ + BQMS code + status dot + quick actions)
//   2. Core fields (req_name, classification, deadline, person in charge, ...)
//   3. Items list (full _detail.items if drilled, else "chưa drill")
//   4. Folder path (from /api/v1/bqms/bidding/folder?rfq_number=) + image gallery
//   5. Quotation history with download/preview links
//   6. Báo giá button for pending rows
//
// Opens from the right (640px width) over a backdrop. ESC + backdrop click close.

function DetailDrawer({
  item,
  onClose,
  onQuoteFromBqms,
  onPushToSec,
}: {
  item: RFQItem;
  onClose: () => void;
  onQuoteFromBqms?: (stagingId: number) => void;
  onPushToSec?: (rfqId: number, initialRound: number) => void;
}) {
  const queryClient = useQueryClient();
  // BQMS polish 1 (Thang 2026-06-13): warehouse role doesn't have permission
  // to push to SEC (backend rbac.py only allows admin|manager|staff|sales).
  // Hide the button for warehouse users so they don't get a 403 toast on click.
  const userRole = useUserRole();
  const canPushToSec = userRole !== 'warehouse';
  // ESC to close (must be useEffect, not useState — useState's initializer
  // returns nothing usable for cleanup).
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const isPending = !!item.is_pending;
  // GC wizard state — null = closed, n = open for round n.
  const [wizardRound, setWizardRound] = useState<number | null>(null);
  // TM wizard state (Thang 2026-05-15): preview/edit form for TM `+ L{n}` button.
  const [tmWizardRound, setTmWizardRound] = useState<number | null>(null);
  const [tmWizardInitialPrice, setTmWizardInitialPrice] = useState<number | null>(null);
  // Phase F (Thang 2026-05-13): loading state cho TM L1/L2/L3/L4 buttons.
  // Trước đây đặt nhầm trong DataRow → L-button trong DetailDrawer reference
  // tới biến không tồn tại → ReferenceError crash trang.
  const [loadingRound, setLoadingRound] = useState<number | null>(null);

  // Folder + images: /api/v1/bqms/bidding/folder works for any RFQ (queries the
  // pretty folder + raw/ + images/ under onedrive-staging).
  const { data: folderData } = useQuery({
    queryKey: ['rfq-folder', item.rfq_number],
    enabled: !!item.rfq_number,
    queryFn: () =>
      api.get<{
        data: {
          exists: boolean;
          rfq_number: string;
          folder?: string;
          files?: { name: string; size: number; modified: number }[];
          images?: { name: string; size: number; modified: number }[];
        };
      }>(`/api/v1/bqms/bidding/folder?rfq_number=${encodeURIComponent(item.rfq_number ?? '')}`),
    staleTime: 60_000,
  });
  const folder = folderData?.data;

  // Quotation history (only for quoted rows — pending has no quotations yet)
  const { data: historyData } = useQuery({
    queryKey: ['rfq-history', item.id],
    enabled: !isPending && item.id > 0,
    queryFn: () =>
      api.get<{ data: QuotationHistoryItem[]; total: number }>(
        `/api/v1/bqms/rfq/${item.id}/history`,
      ),
    staleTime: 30_000,
  });
  const history: QuotationHistoryItem[] = historyData?.data ?? [];

  return (
    <>
    {wizardRound != null && item.rfq_number && (
      <GcQuoteWizard
        rfqId={item.id}
        rfqNumber={item.rfq_number}
        roundN={wizardRound}
        onClose={() => setWizardRound(null)}
        onSuccess={(res) => {
          const fileCount = res?.files?.length ?? 0;
          window.alert(
            `Đã tạo ${fileCount} file báo giá GC lần ${wizardRound}.\n` +
            `Folder: [QT]_AMA BAC NINH_L${wizardRound}/`,
          );
          // Per Thang 2026-05-11: don't auto-reload — keep drawer open so user
          // sees the row they just quoted, just invalidate queries to refresh.
          setWizardRound(null);
          queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
          queryClient.invalidateQueries({ queryKey: ['rfq-history', item.id] });
          queryClient.invalidateQueries({ queryKey: ['rfq-folder', item.rfq_number] });
        }}
      />
    )}
    {tmWizardRound != null && item.rfq_number && (
      <TmQuoteWizard
        rfqId={item.id}
        rfqNumber={item.rfq_number}
        roundN={tmWizardRound}
        initialPrice={tmWizardInitialPrice}
        onClose={() => { setTmWizardRound(null); setTmWizardInitialPrice(null); }}
        onSuccess={(res) => {
          const fileCount = res?.files?.length ?? 0;
          toast.success(`✅ Đã tạo ${fileCount} file báo giá TM lần ${tmWizardRound} cho ${item.rfq_number}`, { duration: 6000 });
          setTmWizardRound(null);
          setTmWizardInitialPrice(null);
          queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
          queryClient.invalidateQueries({ queryKey: ['rfq-history', item.id] });
          queryClient.invalidateQueries({ queryKey: ['rfq-folder', item.rfq_number] });
        }}
      />
    )}
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />

      {/* Drawer — Thang 2026-06-01: rộng hơn (4xl=896px / 5xl=1024px xl)
          + body text-sm thay vì text-xs, để hiển thông tin gọn không phải
          scroll dài + font dễ đọc hơn. */}
      <div
        className="relative w-full max-w-2xl lg:max-w-4xl xl:max-w-5xl bg-white h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-br from-brand-600 to-brand-700 text-white px-5 py-4 shadow-md">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <StatusDot item={item} />
                <span className="font-mono font-bold text-base">{item.rfq_number ?? '—'}</span>
                {item.version && item.version > 1 && (
                  <span className="px-1.5 py-0 text-[11px] font-bold rounded bg-white/20">V{item.version}</span>
                )}
                {item.classification && (
                  <span className="px-1.5 py-0 text-[11px] font-bold rounded bg-white/15 text-white">{item.classification.toUpperCase()}</span>
                )}
                {isPending && (
                  <span className="px-1.5 py-0 text-[11px] font-bold rounded bg-white/15 text-white">
                    Chờ báo
                  </span>
                )}
              </div>
              <div className="text-sm opacity-90 truncate" title={item.req_name ?? item.specification ?? ''}>
                {item.req_name ?? item.specification ?? '—'}
              </div>
              {item.bqms_code && (
                <div className="text-xs opacity-80 font-mono mt-0.5">{item.bqms_code}</div>
              )}
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white" title="Đóng (ESC)">
              <XCircle className="h-6 w-6" />
            </button>
          </div>
          {/* Action buttons: Báo giá / Skip / Folder — work for both pending + approved.
              Per Thang 2026-05-11. */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {isPending && item.staging_id != null && (
              <button
                onClick={() => onQuoteFromBqms?.(item.staging_id!)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-brand-700 hover:bg-brand-50 shadow-sm hover:shadow active:scale-95 transition-all"
                title="Mở khoá V1-V4 + assign về user — instant (<1s). Drill/download đã có cron lo ngầm."
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Báo giá ngay
              </button>
            )}
            {/* Push to SEC — Thang 2026-05-14 (button text fix 2026-05-20).
                Hiện khi quote_unlocked AND có BẤT KỲ V nào filled.
                initialRound = pushable_round (HIGHEST filled V — round user vừa báo).
                Trước đây dùng scenario_default_round → user báo V1 xong nút lại
                hiện V2 vì TH3.scenario_default_round = max(2, ...). Đã sửa.

                Thang 2026-06-04 (BUG B): defensive frontend backup for backend
                Option A (bqms_dedup CTE). Backend now reliably returns
                quote_unlocked=true on the winning twin, but we also accept
                rows whose bqms_push_status='saved_temp' so a re-push after
                round 2-4 still surfaces the button even if a later relock
                slipped through (shadow twin or migration not yet applied). */}
            {!isPending && onPushToSec && canPushToSec && (() => {
              const filled = [
                item.quoted_price_bqms_v1,
                item.quoted_price_bqms_v2,
                item.quoted_price_bqms_v3,
                item.quoted_price_bqms_v4,
              ];
              if (filled.every((v) => v == null)) return null;
              // Thang 2026-06-13 (Bug fix T2): if any V is filled (real
              // price in DB) → allow push regardless of quote_unlocked.
              // The dedup CTE sometimes shadows the priced twin with an
              // unfilled twin (quote_unlocked=false), so previously the
              // Push button vanished even when V1 had a price. Defensive:
              // any filled V → user already quoted → push is valid.
              //
              // Dead branch removed: previously this read
              //   const unlocked = item.quote_unlocked === true;
              //   const previouslyPushed = item.bqms_push_status === 'saved_temp';
              //   const anyVFilled = filled.some((v) => v != null);
              //   if (!unlocked && !previouslyPushed && !anyVFilled) return null;
              // but `filled.every(v => v == null)` already returned above,
              // so anyVFilled is necessarily true here, making the whole
              // condition unreachable.
              // Compute pushable round defensively even if backend hasn't shipped yet
              const computedRound = item.pushable_round ?? (
                item.quoted_price_bqms_v4 != null ? 4 :
                item.quoted_price_bqms_v3 != null ? 3 :
                item.quoted_price_bqms_v2 != null ? 2 :
                item.quoted_price_bqms_v1 != null ? 1 : 1
              );
              return (
                <button
                  onClick={() => onPushToSec(item.id, computedRound)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-600 text-white hover:bg-brand-700 shadow-md hover:shadow-lg active:scale-95 transition-all"
                  title={`Đẩy báo giá V${computedRound} lên sec-bqms.com (Save Temporarily) — round có thể đổi trong modal`}
                >
                  🚀 Đẩy lên SEC V{computedRound}
                </button>
              );
            })()}
            {item.rfq_number && folder?.folder && (
              <Link
                href={`/documents/browser?path=${encodeURIComponent(toBrowserPath(folder.folder))}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/15 text-white hover:bg-white/25 border border-white/30"
                title="Mở Quản lý tài liệu tại folder của RFQ này"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Mở folder
              </Link>
            )}
            {/* Skip button — works for any row (pending OR approved).
                For approved rows it sets bqms_rfq.result='skipped';
                for pending it also sets staging.status='skipped'. */}
            {(item.result ?? '').toLowerCase() !== 'skipped' ? (
              <button
                onClick={() => {
                  const isPendingRow = isPending;
                  const msg = isPendingRow
                    ? `Skip ${item.rfq_number}?\nRFQ sẽ đánh dấu 'không báo' — có thể bỏ skip sau.`
                    : `Đánh dấu RFQ ${item.rfq_number} (mã ${item.bqms_code}) là 'không báo giá nữa'?`;
                  if (!window.confirm(msg)) return;
                  // For approved rows, use new /rfq/{id}/skip endpoint
                  // (handles both bqms_rfq.result + propagates to staging).
                  // For pending without bqms_rfq id, fall back to staging endpoint.
                  const url = item.id > 0
                    ? `/api/v1/bqms/rfq/${item.id}/skip`
                    : `/api/v1/bqms/vendor-staging/${item.staging_id}/skip`;
                  api.post(url, {})
                    .then(() => {
                      window.alert('Đã skip RFQ.');
                      window.location.reload();
                    })
                    .catch((e: any) => window.alert(`Skip lỗi: ${e?.message ?? 'Unknown'}`));
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/15 text-white hover:bg-white/25 border border-white/30"
                title="Đánh dấu RFQ là 'không báo'"
              >
                <XCircle className="h-3.5 w-3.5" />
                Skip
              </button>
            ) : (
              <button
                onClick={() => {
                  if (!window.confirm(`Bỏ skip ${item.rfq_number}? Sẽ chuyển lại trạng thái pending.`)) return;
                  api.post(`/api/v1/bqms/rfq/${item.id}/skip`, { unskip: true })
                    .then(() => { window.alert('Đã bỏ skip.'); window.location.reload(); })
                    .catch((e: any) => window.alert(`Lỗi: ${e?.message ?? 'Unknown'}`));
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200"
                title="Bỏ skip — chuyển lại pending"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Bỏ skip
              </button>
            )}
            {/* Đánh dấu Thắng/Thua/Đang chờ — chỉ cho approved rows (đã có bqms_rfq.id).
                Tính năng A (Thang): 2629 RFQ 'closed' chưa ghi thắng/thua. */}
            {!isPending && item.id > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-[11px] text-white/70">Kết quả:</span>
                <ResultMarkControl rfqId={item.id} current={item.result} />
              </div>
            )}
          </div>
        </div>

        {/* Body — Thang 2026-06-01: widen + bump font + 2-col grid lg+. V1-V4
            timeline (đầu tiên) span full-width, các section còn lại auto 2-col. */}
        <div className="p-5 lg:p-6 text-[13px] grid grid-cols-1 lg:grid-cols-2 gap-4 [&>*:first-child]:lg:col-span-2">
          {/* === V1→V4 Progress Timeline (chỉ show với approved rows) === */}
          {!isPending && (
            <section className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3.5 shadow-sm">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-[11px] font-bold uppercase text-slate-700 tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-brand-500" /> Lịch sử báo giá
                </h3>
                <span className="text-[11px] text-slate-500">
                  {item.result === 'won' ? '✓ Trúng'
                  : item.result === 'lost' ? '✗ Trượt'
                  : isLiveClosed(item.deadline_dt, item.result) ? '⌛ Closed'
                  : item.result === 'skipped' ? '⊘ Skipped'
                  : '⏳ Đang xử lý'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((n) => {
                  const v = (item as any)[`quoted_price_bqms_v${n}`];
                  const prevSet = n === 1 || (item as any)[`quoted_price_bqms_v${n - 1}`] != null;
                  const filled = v != null;
                  // Phase H (Thang 2026-05-13): V1-V4 khóa cho tới khi user click "Báo giá".
                  // Scrape tạo row với quote_unlocked=false; click "Báo giá" set =true.
                  // Thang 2026-06-13 (Task 2 — V1 hiển thị): nếu bất kỳ V nào đã có giá
                  // thật → coi row này như unlocked để hiển thị lịch sử + push button,
                  // tránh trường hợp dedup CTE shadow twin có quote_unlocked=false đè
                  // mất twin có giá khiến V1 "biến mất" khỏi UI.
                  const anyVFilled =
                    item.quoted_price_bqms_v1 != null ||
                    item.quoted_price_bqms_v2 != null ||
                    item.quoted_price_bqms_v3 != null ||
                    item.quoted_price_bqms_v4 != null;
                  const unlocked = item.quote_unlocked === true || anyVFilled
                    || !isLiveClosed(item.deadline_dt, item.result);
                  return (
                    <div key={n} className={cn(
                      'rounded-lg border px-2 py-2 text-center transition-all',
                      filled ? 'border-emerald-300 bg-emerald-50/60 shadow-sm'
                             : !unlocked ? 'border-slate-200 bg-slate-100/60 opacity-60'
                             : prevSet ? 'border-brand-300 bg-white hover:bg-brand-50/50 hover:shadow-sm'
                                       : 'border-slate-200 bg-slate-50/30 opacity-50'
                    )}>
                      <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-0.5 font-bold">Vòng {n}</div>
                      <div className="font-mono font-bold text-slate-800 tabular-nums text-[13px] leading-tight">
                        {filled ? fmtVnd(v) : <span className="text-slate-300">—</span>}
                      </div>
                      {prevSet && !unlocked && (
                        <div
                          className="mt-1 w-full inline-flex items-center justify-center gap-0.5 px-1 py-0.5 rounded text-[11px] font-bold bg-slate-200 text-slate-500"
                          title="Click 'Báo giá' để mở khoá V1-V4"
                        >
                          🔒 Khoá
                        </div>
                      )}
                      {prevSet && unlocked && (
                        <button
                          type="button"
                          disabled={loadingRound != null}
                          onClick={() => {
                            const isGc = (item.classification ?? 'tm').toLowerCase() === 'gc';
                            if (isGc) { setWizardRound(n); return; }
                            // TM: mở form preview/edit (Thang 2026-05-15) thay vì prompt.
                            setTmWizardInitialPrice(filled ? Number(v) : null);
                            setTmWizardRound(n);
                          }}
                          className={cn(
                            'mt-1 w-full inline-flex items-center justify-center gap-0.5 px-1 py-0.5 rounded text-[11px] font-bold transition-colors',
                            loadingRound === n
                              ? 'bg-amber-200 text-amber-800 cursor-wait'
                              : filled
                              ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              : 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
                            loadingRound != null && loadingRound !== n ? 'opacity-50 cursor-not-allowed' : ''
                          )}
                          title={(item.classification ?? '').toLowerCase() === 'gc' ? `GC wizard V${n}` : (filled ? `Tạo lại V${n}` : `Báo V${n}`)}
                        >
                          {loadingRound === n ? (
                            <><Loader2 className="h-2.5 w-2.5 animate-spin" />Đang...</>
                          ) : filled ? `↻ L${n}` : `+ L${n}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {(item.purchase_price_rmb || item.purchase_price_vnd || item.quoted_price_ama || item.supplier_name) && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-200 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  {item.purchase_price_rmb != null && (
                    <FieldRow icon={DollarSign} label="Giá mua RMB" value={fmtVnd(item.purchase_price_rmb)} mono color="amber" />
                  )}
                  {item.purchase_price_vnd != null && (
                    <FieldRow icon={DollarSign} label="Giá mua VND" value={fmtVnd(item.purchase_price_vnd)} mono color="amber" />
                  )}
                  {item.quoted_price_ama != null && (
                    <FieldRow icon={DollarSign} label="Giá AMA" value={fmtVnd(item.quoted_price_ama)} mono color="slate" />
                  )}
                  {item.supplier_name && (
                    <FieldRow icon={Factory} label="NCC" value={item.supplier_name} color="brand" />
                  )}
                </div>
              )}
            </section>
          )}

          {/* === 1. Mặt hàng / Item info === */}
          <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <h3 className="text-[11px] font-bold uppercase text-slate-700 tracking-wider mb-2.5 flex items-center gap-1.5">
              <Package2 className="h-3.5 w-3.5 text-brand-500" />
              Thông tin mặt hàng
            </h3>
            <div className="space-y-2">
              {item.description && (
                <div className="bg-slate-50 rounded-lg p-2.5 border-l-2 border-brand-400">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">Description</div>
                  <div className="text-[13px] font-semibold text-slate-800">{item.description}</div>
                </div>
              )}
              {item.req_name && (
                <div className="text-[11px]">
                  <span className="text-slate-500">Subject:</span>{' '}
                  <span className="text-slate-700">{item.req_name}</span>
                </div>
              )}
              {item.specification && (
                <div className="bg-amber-50/40 rounded-lg p-2 border border-amber-100 text-[11px]">
                  <div className="text-[11px] uppercase tracking-wider text-amber-700 font-bold mb-0.5">Specification</div>
                  <div className="text-slate-800 font-mono leading-relaxed">{item.specification}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2 text-[11px]">
                <FieldRow icon={Factory} label="Maker" value={item.first_maker ?? item.maker} />
                <FieldRow icon={Tag} label="Loại hàng" value={item.classification?.toUpperCase()} color={
                  (item.classification ?? '').toLowerCase() === 'gc' ? 'orange' : 'blue'
                } />
                <FieldRow icon={ShoppingBag} label="Số lượng" value={item.expected_qty != null ? `${item.expected_qty} ${item.unit ?? ''}`.trim() : null} color="emerald" />
                <FieldRow icon={Hash} label="MOQ" value={item.first_moq} />
              </div>
            </div>
          </section>

          {/* === 2. Mã định danh / Identifiers === */}
          <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <h3 className="text-[11px] font-bold uppercase text-slate-700 tracking-wider mb-2.5 flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5 text-brand-500" />
              Mã định danh
            </h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              <FieldRow icon={Tag} label="BQMS code" value={item.bqms_code} mono color="brand" prominent />
              <FieldRow icon={Hash} label="CIS code" value={item.first_cis_code} mono />
              <FieldRow icon={FileSignature} label="Part No" value={item.first_part_no} mono />
              <FieldRow icon={DollarSign} label="Currency" value={item.currency} mono />
            </div>
          </section>

          {/* === 3. Tiến độ & Thời hạn === */}
          <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <h3 className="text-[11px] font-bold uppercase text-slate-700 tracking-wider mb-2.5 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-rose-500" />
              Tiến độ & thời hạn
            </h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              <FieldRow icon={Calendar} label="Ngày tạo" value={fmtDateShort(item.reg_dt) ?? (item.inquiry_date ?? item.created_at)?.slice(0, 10)} />
              <FieldRow icon={Clock} label="Hạn BG" value={fmtDeadline(item.deadline_dt)} color="rose" prominent />
              <FieldRow
                icon={Clock}
                label="D-N"
                value={isLiveClosed(item.deadline_dt, item.result)
                  ? 'Closed'
                  : ddayText(item.deadline_dt, item.dday_html)}
                color={
                  isLiveClosed(item.deadline_dt, item.result) ||
                  ddayText(item.deadline_dt, item.dday_html) === 'Closed'
                    ? 'slate'
                    : 'amber'
                }
              />
              <FieldRow icon={CheckCircle2} label="Hiện trạng" value={item.bd_status} />
              <FieldRow icon={FileSignature} label="Loại HĐ" value={item.ctr_type_nm} />
              <FieldRow icon={Layers} label="Detail Version" value={item.detail_version != null ? `V${item.detail_version}` : (item.version ? `V${item.version}` : null)} color="brand" prominent />
            </div>
          </section>

          {/* === 4. Phụ trách & Tổ chức === */}
          <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <h3 className="text-[11px] font-bold uppercase text-slate-700 tracking-wider mb-2.5 flex items-center gap-1.5">
              <User2 className="h-3.5 w-3.5 text-emerald-500" />
              Phụ trách & tổ chức
            </h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              <FieldRow icon={User2} label="Người PT (ERP)" value={item.assigned_to_name} color="emerald" prominent />
              <FieldRow icon={Building2} label="Department" value={item.department} color="slate" />
              <FieldRow icon={User2} label="Requester (Samsung)" value={item.requester} />
              <FieldRow icon={User2} label="Phụ trách Samsung" value={(item.psincharge_name ?? item.person_in_charge_name)?.split('/')[0]} />
              <FieldRow icon={FileText} label="#Items" value={item.items_count != null ? String(item.items_count) : null} />
              <FieldRow icon={FileText} label="#Files" value={item.attachments_count != null ? String(item.attachments_count) : null} />
            </div>
            {item.detail_error && (
              <div className="mt-2.5 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[11px]">
                <span className="font-semibold">⚠ Drill error:</span> {item.detail_error}
              </div>
            )}
          </section>

          {/* Lịch sử giá moved to top of body — redesigned as Progress Timeline */}

          {/* === Lịch sử V-round (Issue B, Thang 2026-06-19) ===
              Reads from bqms_qt_events ledger via /round-history endpoint.
              Friendly-degrades to empty-state if migration not yet applied. */}
          {item.rfq_number && (
            <RoundHistoryTimeline rfqNumber={item.rfq_number} />
          )}

          {/* === Folder + Images (modern gallery per Thang 2026-05-11) === */}
          <ImageGallerySection
            rfqId={item.id}
            rfqNumber={item.rfq_number}
            bqmsCode={item.bqms_code}
            folder={folder}
          />
          {/* legacy hidden: */}
          {false && (
            <section className="border-t border-slate-100 pt-4">
              <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-wide mb-2 flex items-center gap-2">
                <span>Folder & ảnh</span>
              </h3>
            </section>
          )}
          <section className="border-t border-slate-100 pt-4">
            <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-wide mb-2">
              File đính kèm
            </h3>
            {folder?.folder && (
              <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2 font-mono text-[11px] text-slate-700 break-all mb-2">
                {folder.folder}
              </div>
            )}
            {false && folder?.images && folder.images.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] text-slate-500 mb-1.5">{folder.images.length} ảnh:</div>
              </div>
            )}
            {folder?.files && folder.files.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] text-slate-500 mb-1.5">{folder.files.length} file đính kèm:</div>
                <div className="space-y-1">
                  {folder.files.slice(0, 10).map((f) => (
                    <a key={f.name}
                      href={withToken(`/api/v1/bqms/bidding/folder/file?rfq_number=${encodeURIComponent(item.rfq_number ?? '')}&kind=raw&name=${encodeURIComponent(f.name)}`)}
                      className="flex items-center justify-between px-2 py-1.5 rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px]"
                    >
                      <span className="font-mono text-slate-700 truncate">{f.name}</span>
                      <span className="text-slate-400 ml-2 flex-shrink-0">{Math.round(f.size / 1024)} KB</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
            {(!folder?.exists || (!folder.images?.length && !folder.files?.length)) && (
              <p className="text-[11px] text-slate-400 italic">Chưa có folder/file — cron tự động quét. Dùng nút "Quét ngay" ở mục Ảnh nếu muốn force-drill.</p>
            )}
          </section>

          {/* === Quotation history === */}
          {!isPending && history.length > 0 && (
            <section className="border-t border-slate-100 pt-4">
              <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-wide mb-2">Lịch sử báo giá</h3>
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-brand-700">#{h.id}</span>
                        <span className={cn(
                          'px-1.5 py-0 rounded text-[11px] font-semibold',
                          h.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
                          : h.status === 'failed' ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                        )}>{h.status}</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {h.created_at ? formatDate(h.created_at) : ''}
                      </span>
                    </div>
                    {h.files && h.files.length > 0 && (
                      <div className="divide-y divide-slate-100">
                        {h.files.map((f, fi) => {
                          const isPdf = f.type?.includes('pdf');
                          const isXlsx = f.type?.includes('xlsx');
                          return (
                            <div key={fi} className="px-3 py-1.5 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {isPdf
                                  ? <Eye className="h-3 w-3 text-red-600 flex-shrink-0" />
                                  : <FileSpreadsheet className="h-3 w-3 text-green-600 flex-shrink-0" />}
                                <span className="text-[11px] font-mono text-slate-700 truncate">{f.filename}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                {isPdf && f.preview_url && (
                                  <a href={withToken(f.preview_url)} target="_blank" rel="noopener noreferrer"
                                    className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[11px] hover:bg-red-700">
                                    Mở
                                  </a>
                                )}
                                {isXlsx && f.path && (
                                  <button type="button"
                                    onClick={async () => {
                                      if (!window.confirm('Render lại PDF từ file Excel này? (~10s)')) return;
                                      try {
                                        const r = await api.post<{ data: any }>(
                                          '/api/v1/bqms/quote-file/regen-pdf',
                                          { xlsx_path: f.path },
                                        );
                                        window.alert(`Đã render PDF:\n${r.data.pdf}`);
                                      } catch (e: any) {
                                        window.alert(`Lỗi: ${e?.message ?? 'Unknown'}`);
                                      }
                                    }}
                                    className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[11px] hover:bg-amber-700"
                                    title="Render lại PDF (sau khi edit Excel)">
                                    Re-PDF
                                  </button>
                                )}
                                <a href={withToken(f.download_url)}
                                  className="px-1.5 py-0.5 rounded bg-brand-600 text-white text-[11px] hover:bg-brand-700">
                                  Tải
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

// ─── Rename file / folder — Thang 2026-05-15 ──────────────────────────────

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function RenameButton({
  rfqId,
  currentPath,
  kind,
  compact,
  onSuccess,
}: {
  rfqId: number;
  currentPath: string;
  kind: 'file' | 'folder';
  compact?: boolean;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const handleOpen = () => {
    setName(basename(currentPath));
    setOpen(true);
  };
  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Tên không được rỗng');
      return;
    }
    if (name === basename(currentPath)) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const endpoint = kind === 'folder'
        ? `/api/v1/bqms/rfq/${rfqId}/rename-folder`
        : `/api/v1/bqms/rfq/${rfqId}/rename-file`;
      const res = await api.post<{ data: any; message: string }>(endpoint, {
        old_path: currentPath,
        new_name: name.trim(),
      });
      toast.success(res.message ?? 'Đã đổi tên');
      setOpen(false);
      onSuccess?.();
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? 'Đổi tên thất bại');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          'inline-flex items-center gap-0.5 rounded font-medium transition-colors flex-shrink-0',
          compact
            ? 'px-1.5 py-0.5 text-[11px] bg-slate-200 text-slate-700 hover:bg-slate-300'
            : 'px-2 py-1 text-[11px] bg-white border border-slate-300 text-slate-600 hover:bg-slate-100',
        )}
        title="Đổi tên"
      >
        <Pencil className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        {!compact && <span>Đổi tên</span>}
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1 flex-shrink-0">
      <input
        type="text"
        value={name}
        autoFocus
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') setOpen(false);
        }}
        className="w-44 text-[11px] font-mono border border-blue-300 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-400"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={busy}
        className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
        {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'Lưu'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={busy}
        className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[11px] hover:bg-slate-300">
        Huỷ
      </button>
    </div>
  );
}

function FolderSubRenameMenu({
  rfqId,
  rootFolder,
  onSuccess,
}: {
  rfqId: number;
  rootFolder: string;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['rfq-subfolders', rfqId],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get<{ data: { root: string | null; subfolders: { name: string; path: string }[] } }>(
        `/api/v1/bqms/rfq/${rfqId}/subfolders`,
      );
      return res.data.subfolders;
    },
  });
  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-white border border-slate-300 text-slate-600 hover:bg-slate-100"
        title="Đổi tên các subfolder báo giá (L1/L2/...)">
        <Pencil className="h-3 w-3" />
        Đổi tên folder
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-80 bg-white border border-slate-200 rounded-lg shadow-xl p-3">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Chọn folder con để đổi tên
          </div>
          {isLoading ? (
            <div className="text-[11px] text-slate-400 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Đang tải...</div>
          ) : !data || data.length === 0 ? (
            <div className="text-[11px] text-slate-400 italic">Chưa có subfolder báo giá nào (L1/L2/...).</div>
          ) : (
            <div className="space-y-1.5">
              {data.map(d => (
                <div key={d.name} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-mono text-slate-700 truncate flex-1" title={d.name}>{d.name}</span>
                  <RenameButton
                    rfqId={rfqId}
                    currentPath={d.path}
                    kind="folder"
                    compact
                    onSuccess={() => { onSuccess?.(); setOpen(false); }}
                  />
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 w-full text-[11px] text-slate-400 hover:text-slate-600">
            Đóng
          </button>
        </div>
      )}
    </div>
  );
}

// ─── ImageGallerySection — modern responsive gallery with lightbox per Thang 2026-05-11
//
// Replaces the cramped 4-col tiny-thumb grid with:
//   - Header: count + ITEM-CODE chips (filter to current item by default)
//   - Larger thumbnails (h-28) in 3-col grid
//   - Click thumb → fullscreen lightbox with ← → keyboard nav + filename
//   - "Mở folder" button copying path to clipboard for VPS browse
//
// Auto-filters to images matching the row's bqms_code first (so you see
// your item's images immediately) but can switch to "Tất cả" to see all.

function ImageGallerySection({
  rfqId,
  rfqNumber,
  bqmsCode,
  folder,
}: {
  rfqId: number;
  rfqNumber: string | null;
  bqmsCode: string | null;
  folder: { exists: boolean; folder?: string; images?: { name: string; size: number }[] } | undefined;
}) {
  const queryClient = useQueryClient();
  const [filterMode, setFilterMode] = useState<'item' | 'all'>('item');
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Thang 2026-05-15 (Issue 14): nút "Quét ngay" trigger force-rescan task
  // khi folder chưa có. Chạy sync ~30-60s, sau đó refetch folder + ảnh.
  const handleForceScan = async () => {
    if (!rfqId || scanning) return;
    setScanning(true);
    toast.info(`Đang quét RFQ ${rfqNumber}... (30-60s, Samsung session lock)`, { duration: 8000 });
    try {
      const res = await api.post<{ data: any; message: string }>(
        `/api/v1/bqms/rfq/${rfqId}/force-rescan`,
        {},
      );
      const d = res.data ?? {};
      toast.success(
        `Quét xong: ${d.files_downloaded ?? 0} file · ${d.images_extracted ?? 0} ảnh · ${d.items_drilled ?? 0} mã`,
        { duration: 6000 },
      );
      queryClient.invalidateQueries({ queryKey: ['rfq-folder', rfqNumber] });
      queryClient.invalidateQueries({ queryKey: ['bqms-rfq-table'] });
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? 'Quét thất bại');
    } finally {
      setScanning(false);
    }
  };

  const allImages = folder?.images ?? [];
  const itemImages = bqmsCode
    ? allImages.filter((img) => img.name.toUpperCase().includes(bqmsCode.toUpperCase()))
    : [];
  const visible = filterMode === 'item' && itemImages.length > 0 ? itemImages : allImages;

  // Keyboard nav for lightbox
  useEffect(() => {
    if (lightboxIdx === null) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null);
      else if (e.key === 'ArrowLeft' && lightboxIdx > 0) setLightboxIdx(lightboxIdx - 1);
      else if (e.key === 'ArrowRight' && lightboxIdx < visible.length - 1) setLightboxIdx(lightboxIdx + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIdx, visible.length]);

  const buildUrl = (name: string) =>
    withToken(
      `/api/v1/bqms/bidding/folder/file?rfq_number=${encodeURIComponent(rfqNumber ?? '')}` +
      `&kind=images&name=${encodeURIComponent(name)}`,
    );

  const copyPath = () => {
    if (folder?.folder) {
      navigator.clipboard.writeText(folder.folder).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  return (
    <section className="border-t border-slate-100 pt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-wide flex items-center gap-2">
          <span>Hình ảnh sản phẩm</span>
          <span className="px-1.5 py-0 text-[11px] font-bold rounded bg-slate-100 text-slate-600">
            {visible.length}
          </span>
        </h3>
        {bqmsCode && itemImages.length > 0 && allImages.length > itemImages.length && (
          <div className="flex items-center gap-1 text-[11px]">
            <button
              onClick={() => setFilterMode('item')}
              className={cn(
                'px-2 py-0.5 rounded',
                filterMode === 'item'
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >Mã này ({itemImages.length})</button>
            <button
              onClick={() => setFilterMode('all')}
              className={cn(
                'px-2 py-0.5 rounded',
                filterMode === 'all'
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >Tất cả ({allImages.length})</button>
          </div>
        )}
      </div>

      {!folder?.exists ? (
        <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center space-y-2">
          <p className="text-[11px] text-slate-400 italic">
            Chưa có folder ảnh — cron tự động quét 3-30 phút/lần, hoặc bấm dưới để quét ngay.
          </p>
          <button
            type="button"
            onClick={handleForceScan}
            disabled={scanning || !rfqId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-brand-600 text-white hover:bg-brand-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-wait">
            {scanning ? (
              <><Loader2 className="h-3 w-3 animate-spin" />Đang quét...</>
            ) : (
              <><RefreshCw className="h-3 w-3" />Quét ngay</>
            )}
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center">
          <p className="text-[11px] text-slate-400 italic">
            Folder có nhưng không có ảnh khớp mã {bqmsCode ?? '—'}.
            {allImages.length > 0 && (
              <button
                onClick={() => setFilterMode('all')}
                className="ml-1 text-brand-600 hover:underline"
              >Xem {allImages.length} ảnh khác</button>
            )}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {visible.map((img, i) => (
            <button
              key={img.name}
              type="button"
              onClick={() => setLightboxIdx(i)}
              className="group relative block rounded-lg border border-slate-200 bg-white hover:ring-2 hover:ring-brand-400 hover:border-brand-300 overflow-hidden transition-all aspect-[4/3]"
              title={img.name}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={buildUrl(img.name)}
                alt={img.name}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-contain bg-slate-50"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="text-[11px] text-white font-mono truncate">
                  {img.name.replace(/\.[^.]+$/, '')}
                </div>
                <div className="text-[11px] text-white/70">
                  {(img.size / 1024).toFixed(1)} KB
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Folder path — clickable to show inline content (files + images) */}
      {folder?.folder && (
        <FolderPathInline folder={folder} rfqNumber={rfqNumber} />
      )}

      {/* Lightbox */}
      {lightboxIdx !== null && visible[lightboxIdx] && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxIdx(null); }}
            className="absolute top-4 right-4 text-white/70 hover:text-white"
          >
            <XCircle className="h-8 w-8" />
          </button>
          {lightboxIdx > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl"
            >‹</button>
          )}
          {lightboxIdx < visible.length - 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl"
            >›</button>
          )}
          <div className="max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={buildUrl(visible[lightboxIdx].name)}
              alt={visible[lightboxIdx].name}
              className="max-w-full max-h-[90vh] object-contain"
            />
            <div className="text-white/80 text-xs font-mono text-center mt-2">
              {visible[lightboxIdx].name} ({(visible[lightboxIdx].size / 1024).toFixed(1)} KB)
              {' · '}
              <span className="text-white/50">
                {lightboxIdx + 1}/{visible.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── FolderPathInline — clickable folder path that expands to show all files
//
// Per Thang 2026-05-11: replace copy-only path with a clickable element
// that toggles a complete file list (raw/ + images/) inline.

function FolderPathInline({
  folder,
  rfqNumber,
}: {
  folder: {
    folder?: string;
    files?: { name: string; size: number }[];
    images?: { name: string; size: number }[];
  };
  rfqNumber: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const totalCount = (folder.files?.length ?? 0) + (folder.images?.length ?? 0);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (folder.folder) {
      navigator.clipboard.writeText(folder.folder).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  const buildUrl = (kind: 'raw' | 'images', name: string) =>
    withToken(
      `/api/v1/bqms/bidding/folder/file?rfq_number=${encodeURIComponent(rfqNumber ?? '')}` +
      `&kind=${kind}&name=${encodeURIComponent(name)}`,
    );

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 px-2.5 py-2 transition-colors group">
        <FolderOpenIcon className={cn(
          'h-4 w-4 flex-shrink-0 transition-colors',
          open ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600',
        )} />
        <Link
          href={folder.folder
            ? `/documents/browser?path=${encodeURIComponent(toBrowserPath(folder.folder))}`
            : '/documents/browser'}
          className="text-[11px] text-brand-700 hover:text-brand-800 hover:underline break-all flex-1 font-mono"
          title="Mở Quản lý tài liệu tại folder này"
        >
          {folder.folder}
        </Link>
        <span className="text-[11px] text-slate-500 flex-shrink-0">
          {totalCount} mục
        </span>
        <button
          onClick={handleCopy}
          className="text-[11px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 flex-shrink-0"
          title="Copy đường dẫn"
        >{copied ? '✓' : <Copy className="h-3 w-3" />}</button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="p-0.5 rounded hover:bg-slate-200 flex-shrink-0"
          title="Mở/đóng danh sách file"
        >
          <ChevronDown className={cn(
            'h-3.5 w-3.5 text-slate-400 transition-transform',
            open && 'rotate-180',
          )} />
        </button>
      </div>

      {open && (
        <div className="mt-2 bg-white border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
          {folder.files && folder.files.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
                Raw files ({folder.files.length})
              </div>
              <div className="divide-y divide-slate-50">
                {folder.files.map((f) => (
                  <a
                    key={f.name}
                    href={buildUrl('raw', f.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-brand-50/50 group transition-colors"
                  >
                    <FileSpreadsheet className="h-3 w-3 text-emerald-600 flex-shrink-0" />
                    <span className="font-mono text-[11px] text-slate-700 truncate flex-1 group-hover:text-brand-700">
                      {f.name}
                    </span>
                    <span className="text-[11px] text-slate-400 flex-shrink-0">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <ExternalLink className="h-3 w-3 text-slate-300 group-hover:text-brand-500 flex-shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}
          {folder.images && folder.images.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
                Images ({folder.images.length})
              </div>
              <div className="divide-y divide-slate-50">
                {folder.images.map((f) => (
                  <a
                    key={f.name}
                    href={buildUrl('images', f.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-brand-50/50 group transition-colors"
                  >
                    <Eye className="h-3 w-3 text-blue-600 flex-shrink-0" />
                    <span className="font-mono text-[11px] text-slate-700 truncate flex-1 group-hover:text-brand-700">
                      {f.name}
                    </span>
                    <span className="text-[11px] text-slate-400 flex-shrink-0">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <ExternalLink className="h-3 w-3 text-slate-300 group-hover:text-brand-500 flex-shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}
          {totalCount === 0 && (
            <div className="px-3 py-3 text-[11px] text-slate-400 text-center italic">
              Folder rỗng
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// FolderOpen lucide icon (used in FolderPathInline above)
function FolderOpenIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function DrawerField({ label, value, mono = false }: { label: string; value: any; mono?: boolean }) {
  if (value == null || value === '') {
    return (
      <div>
        <div className="text-[11px] text-slate-400 mb-0.5">{label}</div>
        <div className="text-slate-300">—</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[11px] text-slate-400 mb-0.5">{label}</div>
      <div className={cn('text-slate-700 break-words', mono && 'font-mono text-[11px]')}>
        {String(value)}
      </div>
    </div>
  );
}

// ─── FieldRow — modern card-row layout with icon (Thang 2026-05-12 redesign) ──
//
// Compact pair: icon + label + value. Auto greys out when empty.
// `color` adds colored tint on value chip. `prominent` makes value bigger.

type FieldRowColor = 'slate' | 'brand' | 'emerald' | 'amber' | 'rose'
  | 'indigo' | 'violet' | 'blue' | 'orange';

function FieldRow({
  icon: Icon, label, value, mono = false, color = 'slate', prominent = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: any;
  mono?: boolean;
  color?: FieldRowColor;
  prominent?: boolean;
}) {
  const empty = value == null || value === '';
  const colorMap: Record<FieldRowColor, string> = {
    slate:   'text-slate-700',
    brand:   'text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded inline-block',
    emerald: 'text-emerald-700 font-semibold',
    amber:   'text-amber-700 font-semibold',
    rose:    'text-rose-700 font-semibold',
    indigo:  'text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded inline-block font-semibold',
    violet:  'text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded inline-block font-semibold',
    blue:    'text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded inline-block font-semibold',
    orange:  'text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded inline-block font-semibold',
  };
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      {Icon && (
        <Icon className="h-3 w-3 text-slate-400 flex-shrink-0 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold leading-tight">
          {label}
        </div>
        <div className={cn(
          'break-words leading-snug',
          mono && 'font-mono',
          prominent ? 'text-[12px] font-semibold mt-0.5' : 'text-[11px] mt-0.5',
          empty ? 'text-slate-300 italic' : colorMap[color],
        )}>
          {empty ? '—' : String(value)}
        </div>
      </div>
    </div>
  );
}

// ─── GcQuoteWizard — multi-step modal for GC (gia công) quotes ─────────────
//
// Per Thang 2026-05-11: GC items need detailed input (vật liệu + quy trình)
// before file generation. Old flow was a single window.prompt for price.
// New flow: 4 steps (Items → Materials → Processes → Review) → confirm →
// POST /api/v1/bqms/quote-wizard/finalize-gc → backend builds xlsx with
// material/process rows injected into the QUOTATION_GC.xlsx template.

interface WizardMaterial {
  name: string;
  w?: number; l?: number; h?: number;
  qty: number;
  unit_price: number;
}
interface WizardPart {
  name: string;
  qty: number;
  unit_price: number;
}
interface WizardOther {
  description: string;
  qty: number;
  unit_price: number;
}
interface WizardProcess {
  name: string;
  time_hr: number;
  unit_price: number;
}
interface WizardItem {
  bqms_code: string;
  jig_name: string;
  spec: string;
  qty: number;
  selected: boolean;
  materials: WizardMaterial[];
  parts: WizardPart[];
  others: WizardOther[];
  processes: WizardProcess[];
  nego: number;
}

const MATERIAL_PRESETS = [
  'PB108 ESD Black', 'PB108 Natural', 'POM Black', 'POM Natural',
  'AL6061', 'AL7075', 'SS304', 'SS400', 'SKD11', 'PEEK',
];
const PARTS_PRESETS = [
  'ROD PM107', 'BEARING', 'SHAFT', 'ACETAL', 'EJECTOR', 'TOGGLE',
  'GLIDE', 'DAMPER', 'PROBE PIN', 'SPRING', 'BOLT', 'PINTENSION',
  'SILICONE', 'COPPER', 'STEEL', 'TEFLON', 'PVC', 'PEEK',
];
const PROCESS_PRESETS = [
  'MCT', 'Wire cutting', 'Milling', 'Drilling', 'Lathe',
  'Grinding', 'Laser', 'Sanding', 'EDM', 'Welding',
];

// Thang 2026-05-15: GC wizard mặc định preload 8 quy trình chuẩn từ template
// QUOTATION_GC.xlsx (Z0000002-037802 sample sheet). User chỉ điền giá tiền;
// quy trình có giá = 0 sẽ bị backend bỏ qua khi xuất file (filter trong
// gc_template_quotation.py).
const DEFAULT_GC_PROCESSES: { name: string; time_hr: number; unit_price: number }[] = [
  { name: 'MCT',          time_hr: 1, unit_price: 0 },
  { name: 'Wire cutting', time_hr: 1, unit_price: 0 },
  { name: 'Milling',      time_hr: 1, unit_price: 0 },
  { name: 'Drilling',     time_hr: 1, unit_price: 0 },
  { name: 'Lathe',        time_hr: 1, unit_price: 0 },
  { name: 'Grinding',     time_hr: 1, unit_price: 0 },
  { name: 'Laser',        time_hr: 1, unit_price: 0 },
  { name: 'Sanding',      time_hr: 1, unit_price: 0 },
];

// Compute auto-weight (kg) from W×L×H mm³ → assume density ~1g/cm³ as fallback
const calcWeight = (m: WizardMaterial): number => {
  const w = m.w || 0, l = m.l || 0, h = m.h || 0, q = m.qty || 1;
  return Math.round(w * l * h * q / 1_000_000 * 10000) / 10000;
};

function GcQuoteWizard({
  rfqId,
  rfqNumber,
  roundN,
  onClose,
  onSuccess,
}: {
  rfqId: number;
  rfqNumber: string;
  roundN: number;
  onClose: () => void;
  onSuccess: (result: any) => void;
}) {
  const [items, setItems] = useState<WizardItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: itemsResp, isLoading: itemsLoading, error: itemsError } = useQuery({
    queryKey: ['wizard-items', rfqId],
    queryFn: () => api.get<{ data: any[] }>(
      `/api/v1/bqms/rfq/${rfqId}/wizard-items`,
    ),
    // Thang 2026-05-15 (Issue 12): wizard luôn load bản mới nhất từ DB
    // (latest quotations.items) để user thấy chỉnh sửa lần trước đã lưu.
    staleTime: 0,
  });
  useEffect(() => {
    if (itemsResp?.data && items.length === 0) {
      setItems(itemsResp.data.map((it: any) => ({
        bqms_code: it.bqms_code || '',
        // Pre-fill jig_name từ lần báo giá trước nếu có, fallback spec[:50]
        jig_name: it.jig_name ?? (it.spec || '').slice(0, 50),
        spec: it.spec || '',
        qty: it.qty || 1,
        selected: true,  // default all selected
        // Issue 12: load materials/parts/others/processes từ lần báo giá trước
        // nếu có. Nếu chưa từng báo giá → fallback default (8 process preset).
        materials: Array.isArray(it.materials) ? it.materials : [],
        parts: Array.isArray(it.parts) ? it.parts : [],
        others: Array.isArray(it.others) ? it.others : [],
        processes: Array.isArray(it.processes) && it.processes.length > 0
          ? it.processes
          : DEFAULT_GC_PROCESSES.map(p => ({ ...p })),
        nego: Number(it.nego) || 0,
      })));
    }
  }, [itemsResp, items.length]);

  const selectedItems = items.filter(it => it.selected);
  // Keep activeIdx pointing at a SELECTED item; reset if currently-active is unchecked.
  useEffect(() => {
    if (selectedItems.length === 0) return;
    const cur = items[activeIdx];
    if (!cur || !cur.selected) {
      const firstSel = items.findIndex(it => it.selected);
      if (firstSel >= 0) setActiveIdx(firstSel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const updateItem = (idx: number, patch: Partial<WizardItem>) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const calcMatTotal = (it: WizardItem) =>
    it.materials.reduce((s, m) => s + (m.qty || 0) * (m.unit_price || 0), 0);
  const calcPartsTotal = (it: WizardItem) =>
    it.parts.reduce((s, p) => s + (p.qty || 0) * (p.unit_price || 0), 0);
  const calcOthersTotal = (it: WizardItem) =>
    it.others.reduce((s, o) => s + (o.qty || 0) * (o.unit_price || 0), 0);
  const calcProcTotal = (it: WizardItem) =>
    it.processes.reduce((s, p) => s + (p.time_hr || 0) * (p.unit_price || 0), 0);

  const calcMaterialPlusProcess = (it: WizardItem) =>
    calcMatTotal(it) + calcPartsTotal(it) + calcOthersTotal(it) + calcProcTotal(it);

  const calcItemTotal = (it: WizardItem): number => {
    const sub = calcMaterialPlusProcess(it);
    const mgmt = sub * 0.05;
    const profit = mgmt;
    return sub + mgmt + profit - (it.nego || 0);
  };

  const grandTotal = selectedItems.reduce((s, it) => s + calcItemTotal(it), 0);

  const handleConfirm = async () => {
    if (selectedItems.length === 0) {
      setError('Hãy chọn ít nhất 1 mã để báo giá');
      return;
    }
    setSubmitting(true); setError(null);
    try {
      // Thang 2026-06-13 (Task 3): truyền ngày hôm nay để backend ghi vào
      // XLSX row 4 col C (tránh tình trạng XLSX template còn ngày cũ).
      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const res = await api.post<{ data: any; message: string }>(
        '/api/v1/bqms/quote-wizard/finalize-gc',
        { rfq_id: rfqId, round_n: roundN, items: selectedItems, current_date: todayIso },
      );
      onSuccess(res.data);
    } catch (e: any) {
      setError(e?.message ?? 'Tạo báo giá thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === 'undefined') return null;

  const it = items[activeIdx];

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[min(1400px,98vw)] h-[min(900px,95vh)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-3 border-b border-slate-200 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-t-xl flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Báo giá Gia công — {rfqNumber} (Lần {roundN})</h2>
            <p className="text-xs opacity-90">
              Form đầy đủ theo template QUOTATION_GC.xlsx — Material / Parts / Other / Process. Có thể thêm/bớt dòng tự do.
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        {/* Item selection + tabs */}
        {items.length > 0 && (
          <div className="px-6 py-2 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-600">
                Chọn mã hàng để báo giá ({selectedItems.length}/{items.length}):
              </span>
              <div className="flex items-center gap-2">
                <button type="button"
                  onClick={() => setItems(prev => prev.map(it => ({ ...it, selected: true })))}
                  className="text-[11px] px-2 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100">
                  Chọn tất cả
                </button>
                <button type="button"
                  onClick={() => setItems(prev => prev.map(it => ({ ...it, selected: false })))}
                  className="text-[11px] px-2 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100">
                  Bỏ chọn
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {items.map((it, idx) => (
                <div key={idx} className="flex-shrink-0 flex items-center">
                  <label className={cn(
                    'inline-flex items-center gap-1.5 px-2 py-1 rounded-l border-y border-l text-xs font-mono cursor-pointer transition-colors',
                    it.selected
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-slate-100 border-slate-300 text-slate-400',
                  )}>
                    <input type="checkbox" checked={it.selected}
                      onChange={(e) => setItems(prev => prev.map((p, i) =>
                        i === idx ? { ...p, selected: e.target.checked } : p,
                      ))}
                      className="h-3 w-3" />
                  </label>
                  <button type="button" onClick={() => setActiveIdx(idx)}
                    disabled={!it.selected}
                    className={cn(
                      'px-2 py-1 border-y border-r rounded-r text-xs font-mono whitespace-nowrap transition-colors',
                      !it.selected ? 'bg-slate-100 border-slate-300 text-slate-400 cursor-not-allowed' :
                      idx === activeIdx ? 'bg-brand-600 border-brand-600 text-white' :
                      'bg-white border-emerald-300 text-slate-700 hover:bg-slate-50',
                    )}
                    title={it.spec}
                  >
                    {it.bqms_code} <span className="opacity-70 ml-1">{it.selected ? `(${fmtVnd(calcItemTotal(it))})` : '(bỏ qua)'}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {itemsLoading && (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Đang tải...
            </div>
          )}
          {itemsError && (
            <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-300 text-red-800 text-sm">
              <span className="font-semibold">Lỗi:</span> {(itemsError as any)?.message ?? 'Unknown'}
            </div>
          )}
          {!itemsLoading && items.length === 0 && !itemsError && (
            <div className="text-center py-20 text-slate-400 text-sm">Không có mã hàng nào.</div>
          )}

          {it && it.selected && (
            <GcItemForm
              item={it}
              activeIdx={activeIdx}
              updateItem={updateItem}
              rfqNumber={rfqNumber}
              matTotal={calcMatTotal(it)}
              partsTotal={calcPartsTotal(it)}
              othersTotal={calcOthersTotal(it)}
              procTotal={calcProcTotal(it)}
              materialPlusProcess={calcMaterialPlusProcess(it)}
              itemTotal={calcItemTotal(it)}
            />
          )}
          {it && !it.selected && (
            <div className="text-center py-20 text-slate-400 text-sm">
              Mã <span className="font-mono">{it.bqms_code}</span> đã bị bỏ chọn — không tạo sheet trong file output.
              <br /><span className="text-[11px]">Tick lại checkbox để chỉnh sửa.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl flex items-center justify-between">
          <div className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{items.length}</span> mã hàng ·
            Grand Total: <span className="font-mono font-bold text-orange-600 text-sm">{fmtVnd(grandTotal)} VND</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={submitting}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm hover:bg-slate-100 disabled:opacity-50">
              Huỷ
            </button>
            <button type="button" onClick={handleConfirm} disabled={submitting || items.length === 0}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Đang tạo...</>
              ) : (
                <><CheckCircle className="w-4 h-4" /> Xác nhận tạo báo giá</>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="absolute bottom-20 left-6 right-6 px-4 py-3 rounded-lg bg-red-50 border border-red-300 text-red-800 text-sm">
            <span className="font-semibold">Lỗi:</span> {error}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Clipboard TSV parse helper — Phase 3.1 per Thang 2026-05-12 ──────────
// ─── TM Quote Wizard (modal) ───────────────────────────────────────────────
// Thang 2026-05-15: when user clicks `+ L{n}` on a TM row, show a preview
// form with editable spec/maker/qty/price + image override (Đổi ảnh) before
// generating CAM_KET + QUOTATION files. Mirrors GcQuoteWizard pattern.

interface TmWizardItem {
  bqms: string;
  spec: string;
  maker: string;
  so_luong: number | string;
  suggested_price: number | null;
  unit_price: number | string;
  ver: number;
  uploading: boolean;
  selected: boolean;
}

function TmQuoteWizard({
  rfqId,
  rfqNumber,
  roundN,
  initialPrice,
  onClose,
  onSuccess,
}: {
  rfqId: number;
  rfqNumber: string;
  roundN: number;
  initialPrice?: number | null;
  onClose: () => void;
  onSuccess: (result: any) => void;
}) {
  const [items, setItems] = useState<TmWizardItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const { data: lookupResp, isLoading: lookupLoading } = useQuery({
    queryKey: ['tm-wizard-lookup', rfqNumber, roundN],
    queryFn: () => api.get<{ data: { items: any[] } }>(
      `/api/v1/quotations/lookup?rfq_code=${encodeURIComponent(rfqNumber)}`,
    ),
    // Thang 2026-05-15 (Issue 12): luôn lấy bản mới nhất (spec/maker/qty
    // user vừa sửa lần trước đã được persist trong /generate-round).
    staleTime: 0,
  });

  useEffect(() => {
    const list = lookupResp?.data?.items;
    if (list && items.length === 0) {
      setItems(list.map((it: any) => ({
        bqms: it.bqms ?? '',
        spec: it.spec ?? '',
        maker: it.maker ?? '',
        so_luong: it.so_luong ?? 1,
        suggested_price: it.suggested_price ?? null,
        unit_price: initialPrice != null
          ? String(initialPrice)
          : (it.suggested_price != null ? String(it.suggested_price) : ''),
        ver: 0,
        uploading: false,
        selected: true,
      })));
    }
  }, [lookupResp, items.length, initialPrice]);

  const toggleAll = (checked: boolean) => {
    setItems(prev => prev.map(it => ({ ...it, selected: checked })));
  };
  const toggleOne = (idx: number) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, selected: !it.selected } : it));
  };
  const allSelected = items.length > 0 && items.every(it => it.selected);
  const someSelected = items.some(it => it.selected) && !allSelected;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const updateField = (idx: number, field: keyof TmWizardItem, value: any) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };

  const handleImageReplace = async (idx: number, file: File) => {
    const code = items[idx]?.bqms;
    if (!code) return;
    updateField(idx, 'uploading', true);
    try {
      const fd = new FormData();
      fd.append('rfq_number', rfqNumber);
      fd.append('bqms_code', code);
      fd.append('slot', 'product_photo');
      fd.append('file', file);
      await api.upload('/api/v1/bqms/quote-image-override', fd);
      updateField(idx, 'ver', (items[idx]?.ver ?? 0) + 1);
      toast.success(`Đã đổi ảnh cho ${code}`);
    } catch (err: any) {
      toast.error(err?.detail ?? 'Đổi ảnh thất bại');
    } finally {
      updateField(idx, 'uploading', false);
    }
  };

  const handleImageReset = async (idx: number) => {
    const code = items[idx]?.bqms;
    if (!code) return;
    try {
      await api.delete(
        `/api/v1/bqms/quote-image-override?rfq_number=${encodeURIComponent(rfqNumber)}&bqms_code=${encodeURIComponent(code)}&slot=product_photo`,
      );
      updateField(idx, 'ver', (items[idx]?.ver ?? 0) + 1);
      toast.success(`Đã khôi phục ảnh gốc cho ${code}`);
    } catch (err: any) {
      toast.error(err?.detail ?? 'Khôi phục ảnh thất bại');
    }
  };

  const selectedItems = items.filter(it => it.selected);
  const readyItems = selectedItems.filter(it => it.unit_price !== '' && Number(it.unit_price) > 0);
  const missingPriceCount = selectedItems.length - readyItems.length;

  const handleConfirm = async () => {
    if (selectedItems.length === 0) {
      setError('Hãy tích chọn ít nhất 1 mã để báo giá');
      return;
    }
    if (readyItems.length === 0) {
      setError('Các mã đã chọn đều thiếu giá V' + roundN);
      return;
    }
    setSubmitting(true); setError(null);
    try {
      // Chỉ gửi những items đã tick + có giá > 0
      const payloadItems = readyItems.map(it => ({
        bqms: it.bqms,
        spec: it.spec,
        maker: it.maker,
        so_luong: Number(it.so_luong) || 1,
        unit_price: Number(it.unit_price),
      }));
      const params = new URLSearchParams({
        round_n: String(roundN),
        flow_type: 'tm',
      });
      // Thang 2026-06-13 (Task 3): luôn ghi ngày báo giá = HÔM NAY (browser tz)
      // vào XLSX (row 4, col C). Backend autofill_service đã xử lý format VN
      // "dd/mm/yyyy" — chỉ cần truyền ISO date cho clarity.
      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const res = await api.post<{ data: any; message: string }>(
        `/api/v1/bqms/rfq/${rfqId}/generate-round?${params.toString()}`,
        { items: payloadItems, current_date: todayIso },
      );
      onSuccess(res.data);
    } catch (e: any) {
      setError(e?.detail ?? e?.message ?? 'Tạo báo giá thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[min(1280px,98vw)] max-h-[94vh] flex flex-col overflow-hidden ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-7 py-5 border-b border-slate-100 bg-white flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md shadow-brand-500/30">
              <FileSpreadsheet className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">Báo giá Thương mại</h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700">
                  Lần {roundN}
                </span>
              </div>
              <div className="text-sm text-slate-500 font-mono">{rfqNumber}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Đóng (ESC)">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        {items.length > 0 && (
          <div className="px-7 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-700">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={(e) => toggleAll(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
              />
              <span className="font-medium">Chọn tất cả</span>
              <span className="text-xs text-slate-400">({selectedItems.length}/{items.length})</span>
            </label>
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 font-medium">
                <CheckCircle2 className="h-3 w-3" /> {readyItems.length} sẵn sàng
              </span>
              {missingPriceCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 font-medium">
                  <AlertTriangle className="h-3 w-3" /> {missingPriceCount} thiếu giá
                </span>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto px-7 py-5 bg-slate-50/30">
          {lookupLoading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" /> Đang tra cứu items...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-12">
              <Inbox className="h-10 w-10 mx-auto mb-2 text-slate-300" />
              Không tìm thấy items cho RFQ này.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((it, idx) => {
                const imgSrc = it.bqms
                  ? withToken(`/api/v1/bqms/rfq/image?bqms_code=${encodeURIComponent(it.bqms)}&rfq_number=${encodeURIComponent(rfqNumber)}&_v=${it.ver}`)
                  : null;
                const priceNum = it.unit_price !== '' ? Number(it.unit_price) : NaN;
                const hasPrice = !isNaN(priceNum) && priceNum > 0;
                const ready = it.selected && hasPrice;

                return (
                  <div
                    key={`${it.bqms}-${idx}`}
                    className={cn(
                      'group relative bg-white rounded-xl border transition-all overflow-hidden',
                      it.selected
                        ? ready
                          ? 'border-blue-200 shadow-sm shadow-blue-100/40 ring-1 ring-blue-100'
                          : 'border-amber-200 shadow-sm shadow-amber-100/40'
                        : 'border-slate-200 opacity-60 hover:opacity-80',
                    )}
                  >
                    {/* Status bar (left accent) */}
                    <div className={cn(
                      'absolute left-0 top-0 bottom-0 w-1',
                      it.selected ? (ready ? 'bg-blue-500' : 'bg-amber-400') : 'bg-slate-200',
                    )} />

                    <div className="pl-5 pr-5 py-4 flex items-start gap-5">
                      {/* Checkbox + Image column */}
                      <div className="flex-shrink-0 flex flex-col items-center gap-2 pt-1">
                        <input
                          type="checkbox"
                          checked={it.selected}
                          onChange={() => toggleOne(idx)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                        />
                        {imgSrc ? (
                          <a
                            href={imgSrc}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-20 h-20 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden hover:ring-2 hover:ring-blue-400 hover:border-blue-300 transition-all shadow-sm"
                            title="Xem ảnh lớn">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              key={`${it.bqms}-${it.ver}`}
                              src={imgSrc}
                              alt={it.bqms}
                              className="w-full h-full object-cover"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                            />
                          </a>
                        ) : (
                          <div className="w-20 h-20 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-[11px] text-slate-400 font-medium">
                            chưa có ảnh
                          </div>
                        )}
                        <input
                          type="file"
                          accept=".png,.jpg,.jpeg"
                          className="hidden"
                          ref={(el) => { fileInputs.current[it.bqms] = el; }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleImageReplace(idx, f);
                            e.target.value = '';
                          }}
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={!it.bqms || it.uploading}
                            onClick={() => fileInputs.current[it.bqms]?.click()}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition-all shadow-sm disabled:opacity-40">
                            {it.uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pencil className="h-3 w-3" />}
                            Đổi ảnh
                          </button>
                          {it.ver > 0 && (
                            <button
                              type="button"
                              onClick={() => handleImageReset(idx)}
                              className="inline-flex items-center p-1 rounded-md text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors"
                              title="Khôi phục ảnh gốc">
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Content column */}
                      <div className="flex-1 min-w-0 grid grid-cols-12 gap-x-4 gap-y-3">
                        {/* BQMS Code + status */}
                        <div className="col-span-12 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Mã BQMS</span>
                            <span className="font-mono text-sm font-bold text-slate-900 truncate">{it.bqms || '—'}</span>
                          </div>
                          {!it.selected ? (
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Bỏ qua</span>
                          ) : ready ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-blue-600">
                              <CheckCircle2 className="h-3 w-3" /> Sẵn sàng
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-amber-600">
                              <AlertTriangle className="h-3 w-3" /> Thiếu giá
                            </span>
                          )}
                        </div>

                        {/* Spec */}
                        <div className="col-span-12 md:col-span-7">
                          <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Specification</label>
                          <textarea
                            value={it.spec}
                            onChange={(e) => updateField(idx, 'spec', e.target.value)}
                            rows={2}
                            placeholder="Mô tả kỹ thuật"
                            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 resize-y bg-white transition-shadow" />
                        </div>

                        {/* Maker + SL */}
                        <div className="col-span-12 md:col-span-5 grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                            <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Maker</label>
                            <input
                              type="text"
                              value={it.maker}
                              onChange={(e) => updateField(idx, 'maker', e.target.value)}
                              placeholder="Nhà sản xuất"
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 bg-white transition-shadow" />
                          </div>
                          <div>
                            <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Số lượng</label>
                            <input
                              type="number"
                              min="1"
                              value={it.so_luong}
                              onChange={(e) => updateField(idx, 'so_luong', e.target.value)}
                              className="w-full text-sm text-right font-mono border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 bg-white transition-shadow" />
                          </div>
                        </div>

                        {/* Price block */}
                        <div className="col-span-12 grid grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                          <div className="pt-2">
                            <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">Giá gợi ý (lịch sử)</label>
                            <div className="text-sm font-mono font-medium text-emerald-600 px-3 py-2">
                              {it.suggested_price != null
                                ? `${Number(it.suggested_price).toLocaleString('vi-VN')} ₫`
                                : <span className="text-slate-300">Chưa có dữ liệu</span>}
                            </div>
                          </div>
                          <div className="pt-2">
                            <label className="text-[11px] uppercase tracking-wider text-blue-600 font-semibold block mb-1">
                              Giá báo V{roundN} (VND) <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={it.unit_price}
                              placeholder={it.suggested_price != null ? String(it.suggested_price) : 'Nhập giá báo'}
                              onChange={(e) => updateField(idx, 'unit_price', e.target.value)}
                              className={cn(
                                'w-full text-sm text-right font-mono font-bold border-2 rounded-lg px-3 py-2 outline-none transition-all bg-white',
                                hasPrice
                                  ? 'border-blue-300 focus:ring-2 focus:ring-blue-200 focus:border-blue-500 text-blue-900'
                                  : 'border-amber-200 focus:ring-2 focus:ring-amber-200 focus:border-amber-400 text-slate-700',
                              )} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-4 border-t border-slate-100 bg-white flex items-center justify-between gap-4">
          <div className="text-xs text-slate-500 flex items-center gap-3">
            <span>
              <span className="font-bold text-slate-900">{readyItems.length}</span> mã đưa vào file
              {missingPriceCount > 0 && (
                <span className="text-amber-600 ml-2">· bỏ qua {missingPriceCount} mã thiếu giá</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {error && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 px-3 py-1.5 rounded-lg">
                <XCircle className="h-3.5 w-3.5" /> {error}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 active:scale-95 transition-all disabled:opacity-50">
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || readyItems.length === 0}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold bg-brand-600 text-white shadow-md shadow-brand-500/30 hover:bg-brand-700 hover:shadow-lg hover:shadow-brand-500/40 active:scale-95 transition-all disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed">
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Đang tạo...</>
              ) : (
                <><FileSpreadsheet className="h-4 w-4" />Tạo file V{roundN} ({readyItems.length})</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function parseBulkPasteText(text: string): string[][] {
  if (!text) return [];
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t').map((c) => c.trim()));
}

function isBulkPaste(rows: string[][]): boolean {
  // Bulk = either >=2 lines, OR a single line with >=2 columns (tabs)
  if (rows.length >= 2) return true;
  if (rows.length === 1 && rows[0].length >= 2) return true;
  return false;
}

function parseNum(s: string | undefined): number | undefined {
  if (!s) return undefined;
  // Strip thousand separators (both . and ,) — assume the last separator is decimal
  let v = s.trim().replace(/[^\d.,-]/g, '');
  if (!v) return undefined;
  // If both . and , present, the last one is decimal
  const lastDot = v.lastIndexOf('.');
  const lastComma = v.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) {
      v = v.replace(/\./g, '').replace(',', '.');
    } else {
      v = v.replace(/,/g, '');
    }
  } else if (lastComma >= 0 && lastDot < 0) {
    // Only commas — treat as decimal sep if there's exactly one
    const count = (v.match(/,/g) || []).length;
    v = count === 1 ? v.replace(',', '.') : v.replace(/,/g, '');
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ─── GcItemForm — visual replica of QUOTATION_GC.xlsx template ─────────────

function GcItemForm({
  item, activeIdx, updateItem, rfqNumber,
  matTotal, partsTotal, othersTotal, procTotal,
  materialPlusProcess, itemTotal,
}: {
  item: WizardItem;
  activeIdx: number;
  updateItem: (idx: number, patch: Partial<WizardItem>) => void;
  rfqNumber: string;
  matTotal: number; partsTotal: number; othersTotal: number; procTotal: number;
  materialPlusProcess: number; itemTotal: number;
}) {
  const materialTotal = matTotal + partsTotal + othersTotal;
  const mgmt = materialPlusProcess * 0.05;
  const profit = mgmt;

  // Auto-load image URL for this bqms_code from the RFQ folder
  const [imgVersion, setImgVersion] = useState(0);   // bump to bust cache after override
  const imageUrl = withToken(
    `/api/v1/bqms/rfq/image?bqms_code=${encodeURIComponent(item.bqms_code)}&rfq_number=${encodeURIComponent(rfqNumber)}&v=${imgVersion}`,
  );
  const [imgErr, setImgErr] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const imgFileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { setImgErr(false); }, [item.bqms_code]);

  // Phase D (Thang 2026-05-12 audit): upload ảnh mới override default.
  const handleImageReplace = async (file: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Ảnh quá lớn (>5MB)');
      return;
    }
    setUploadingImg(true);
    try {
      const fd = new FormData();
      fd.append('rfq_number', rfqNumber);
      fd.append('bqms_code', item.bqms_code);
      fd.append('slot', 'product_photo');
      fd.append('file', file);
      await api.upload('/api/v1/bqms/quote-image-override', fd);
      toast.success(`Đã thay ảnh cho ${item.bqms_code}`);
      setImgErr(false);
      setImgVersion(v => v + 1);   // reload preview
    } catch (e: any) {
      toast.error(`Upload lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setUploadingImg(false);
      if (imgFileRef.current) imgFileRef.current.value = '';
    }
  };

  // === Materials (Section: Material rows 13-27) ===========================
  const updateMat = (mIdx: number, patch: Partial<WizardMaterial>) => {
    updateItem(activeIdx, {
      materials: item.materials.map((m, i) => i === mIdx ? { ...m, ...patch } : m),
    });
  };
  const addMat = () => updateItem(activeIdx, {
    materials: [...item.materials, { name: '', w: undefined, l: undefined, h: undefined, qty: 1, unit_price: 0 }],
  });
  const removeMat = (mIdx: number) => updateItem(activeIdx, {
    materials: item.materials.filter((_, i) => i !== mIdx),
  });

  // === Parts (Section: Parts rows 30-52) ==================================
  const updatePart = (pIdx: number, patch: Partial<WizardPart>) => {
    updateItem(activeIdx, {
      parts: item.parts.map((p, i) => i === pIdx ? { ...p, ...patch } : p),
    });
  };
  const addPart = () => updateItem(activeIdx, {
    parts: [...item.parts, { name: '', qty: 1, unit_price: 0 }],
  });
  const removePart = (pIdx: number) => updateItem(activeIdx, {
    parts: item.parts.filter((_, i) => i !== pIdx),
  });

  // === Others (Section: Other rows 55-61) =================================
  const updateOther = (oIdx: number, patch: Partial<WizardOther>) => {
    updateItem(activeIdx, {
      others: item.others.map((o, i) => i === oIdx ? { ...o, ...patch } : o),
    });
  };
  const addOther = () => updateItem(activeIdx, {
    others: [...item.others, { description: '', qty: 1, unit_price: 0 }],
  });
  const removeOther = (oIdx: number) => updateItem(activeIdx, {
    others: item.others.filter((_, i) => i !== oIdx),
  });

  // === Processes (Section: Process rows 66-84) ============================
  const updateProc = (pIdx: number, patch: Partial<WizardProcess>) => {
    updateItem(activeIdx, {
      processes: item.processes.map((p, i) => i === pIdx ? { ...p, ...patch } : p),
    });
  };
  const addProc = () => updateItem(activeIdx, {
    processes: [...item.processes, { name: '', time_hr: 1, unit_price: 0 }],
  });
  const removeProc = (pIdx: number) => updateItem(activeIdx, {
    processes: item.processes.filter((_, i) => i !== pIdx),
  });

  // ─── Bulk paste handlers (Phase 3.1) ──────────────────────────────────
  // Hooked to the first input of each section. If user pastes a block
  // (≥2 rows OR ≥2 cols), we auto-build the rows instead of dumping
  // everything into one input. Toast confirms how many rows imported.
  const pasteMaterials = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain');
    const rows = parseBulkPasteText(text);
    if (!isBulkPaste(rows)) return;  // Single value → normal paste
    e.preventDefault();
    // Materials: name [w] [l] [h] [qty] [unit_price] (1-6 cols)
    const newMats = rows.map((cells) => ({
      name: cells[0] ?? '',
      w: cells.length >= 6 ? parseNum(cells[1]) : undefined,
      l: cells.length >= 6 ? parseNum(cells[2]) : undefined,
      h: cells.length >= 6 ? parseNum(cells[3]) : undefined,
      qty: cells.length >= 6 ? (parseNum(cells[4]) ?? 1)
         : cells.length >= 2 ? (parseNum(cells[1]) ?? 1) : 1,
      unit_price: cells.length >= 6 ? (parseNum(cells[5]) ?? 0)
                : cells.length >= 3 ? (parseNum(cells[2]) ?? 0)
                : cells.length >= 2 ? (parseNum(cells[1]) ?? 0) : 0,
    }));
    // Replace if first row is empty, else append
    const existing = item.materials;
    const merged = (existing.length === 1 && !existing[0].name)
      ? newMats
      : [...existing, ...newMats];
    updateItem(activeIdx, { materials: merged });
    toast.success(`Đã thêm ${newMats.length} dòng Material`);
  };

  const pasteParts = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain');
    const rows = parseBulkPasteText(text);
    if (!isBulkPaste(rows)) return;
    e.preventDefault();
    // Parts: name [qty] [unit_price]
    const newParts = rows.map((cells) => ({
      name: cells[0] ?? '',
      qty: parseNum(cells[1]) ?? 1,
      unit_price: parseNum(cells[2]) ?? 0,
    }));
    const existing = item.parts;
    const merged = (existing.length === 1 && !existing[0].name)
      ? newParts : [...existing, ...newParts];
    updateItem(activeIdx, { parts: merged });
    toast.success(`Đã thêm ${newParts.length} dòng Parts`);
  };

  const pasteOthers = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain');
    const rows = parseBulkPasteText(text);
    if (!isBulkPaste(rows)) return;
    e.preventDefault();
    // Others: description [qty] [unit_price]
    const newOthers = rows.map((cells) => ({
      description: cells[0] ?? '',
      qty: parseNum(cells[1]) ?? 1,
      unit_price: parseNum(cells[2]) ?? 0,
    }));
    const existing = item.others;
    const merged = (existing.length === 1 && !existing[0].description)
      ? newOthers : [...existing, ...newOthers];
    updateItem(activeIdx, { others: merged });
    toast.success(`Đã thêm ${newOthers.length} dòng Other`);
  };

  const pasteProcesses = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain');
    const rows = parseBulkPasteText(text);
    if (!isBulkPaste(rows)) return;
    e.preventDefault();
    // Processes: name [time_hr] [unit_price]
    const newProcs = rows.map((cells) => ({
      name: cells[0] ?? '',
      time_hr: parseNum(cells[1]) ?? 1,
      unit_price: parseNum(cells[2]) ?? 0,
    }));
    const existing = item.processes;
    const merged = (existing.length === 1 && !existing[0].name)
      ? newProcs : [...existing, ...newProcs];
    updateItem(activeIdx, { processes: merged });
    toast.success(`Đã thêm ${newProcs.length} dòng Process`);
  };

  // Styling helpers to mimic Excel template visual
  const hdrBg = "bg-slate-300 text-slate-900 font-semibold";
  const totalRow = "bg-amber-100 text-amber-900 font-bold";
  const cell = "border border-slate-400 px-1.5 py-1";
  const cellThin = "border border-slate-400 px-1 py-0.5";
  const today = new Date().toLocaleDateString('vi-VN');

  return (
    <div className="font-serif text-[11px] text-slate-900 bg-white" style={{ fontFamily: '"Times New Roman", serif' }}>
      {/* Title */}
      <div className="text-center mb-1">
        <div className="text-5xl font-bold tracking-wide" style={{ letterSpacing: '0.05em' }}>QUOTATION</div>
        <div className="text-right text-[11px] mt-1 pr-2">Exchange Rate: 24,600 VND</div>
      </div>

      {/* Header info (2 columns) */}
      <table className="w-full border-collapse">
        <colgroup>
          <col style={{ width: '14%' }} />
          <col style={{ width: '36%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '36%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td className={cn(cell, hdrBg, 'text-center')}>Quotation No.</td>
            <td className={cn(cell, 'text-center font-mono')}>{item.bqms_code}</td>
            <td className={cn(cell, hdrBg, 'text-center')}>Vendor name</td>
            <td className={cn(cell, 'text-center')}>AMA BAC NINH JSC L16X98</td>
          </tr>
          <tr>
            <td className={cn(cell, hdrBg, 'text-center')}>Submit Date</td>
            <td className={cn(cell, 'text-center')}>{today}</td>
            <td className={cn(cell, hdrBg, 'text-center')}>Tax Code</td>
            <td className={cn(cell, 'text-center')}>0109945747</td>
          </tr>
          <tr>
            <td className={cn(cell, hdrBg, 'text-center')}>Customer</td>
            <td className={cn(cell, 'text-center')}>Samsung Electronics Vietnam VPC</td>
            <td className={cn(cell, hdrBg, 'text-center')} rowSpan={2}>Addres</td>
            <td className={cn(cell, 'text-center')} rowSpan={2}>
              Single apartment 307, 3.7/2 Street, Gamuda Urban Area,<br />
              Km 4.4 Phap Van, Hoang Mai Ward, Hanoi City, Vietnam
            </td>
          </tr>
          <tr>
            <td className={cn(cell, hdrBg, 'text-center')}>The Person</td>
            <td className={cn(cell)}>&nbsp;</td>
          </tr>
          <tr>
            <td className={cn(cell, hdrBg, 'text-center')}>Shipping Port</td>
            <td className={cn(cell)}>&nbsp;</td>
            <td className={cn(cell, hdrBg, 'text-center')}>Tel/Fax</td>
            <td className={cn(cell, 'text-center')}>093 458 4116</td>
          </tr>
        </tbody>
      </table>

      {/* JIG NAME + Result Total */}
      <table className="w-full border-collapse mt-px">
        <colgroup>
          <col style={{ width: '14%' }} />
          <col style={{ width: '86%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td className={cn(cell, hdrBg, 'text-center')}>JIG NAME</td>
            <td className={cn(cell)}>
              <input type="text" value={item.jig_name}
                onChange={(e) => updateItem(activeIdx, { jig_name: e.target.value })}
                className="w-full bg-transparent border-0 outline-none text-center font-medium" />
            </td>
          </tr>
          <tr>
            <td className={cn(cell, hdrBg, 'text-center')}>Result Total Amount</td>
            <td className={cn(cell, 'text-right font-mono font-bold pr-3')}>{fmtVnd(itemTotal)}</td>
          </tr>
        </tbody>
      </table>

      {/* MATERIAL TABLE */}
      <table className="w-full border-collapse mt-px">
        <colgroup>
          <col style={{ width: '8%' }} />     {/* Division */}
          <col style={{ width: '20%' }} />    {/* Discription */}
          <col style={{ width: '6%' }} /><col style={{ width: '6%' }} /><col style={{ width: '6%' }} /><col style={{ width: '5%' }} /> {/* W L H Q'ty */}
          <col style={{ width: '8%' }} />     {/* Weight */}
          <col style={{ width: '5%' }} />     {/* Unit */}
          <col style={{ width: '11%' }} />    {/* Price */}
          <col style={{ width: '13%' }} />    {/* Amount */}
          <col style={{ width: '12%' }} />    {/* Remarks */}
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} className={cn(cell, hdrBg, 'text-center')}>Division</th>
            <th rowSpan={2} className={cn(cell, hdrBg, 'text-center')}>Discription</th>
            <th colSpan={4} className={cn(cell, hdrBg, 'text-center')}>Specifications</th>
            <th rowSpan={2} className={cn(cell, hdrBg, 'text-center')}>Weight</th>
            <th rowSpan={2} className={cn(cell, hdrBg, 'text-center')}>Unit</th>
            <th rowSpan={2} className={cn(cell, hdrBg, 'text-center')}>Price(vnd)/Unit</th>
            <th rowSpan={2} className={cn(cell, hdrBg, 'text-center')}>Amount(vnd)</th>
            <th rowSpan={2} className={cn(cell, hdrBg, 'text-center')}>Remarks</th>
          </tr>
          <tr>
            <th className={cn(cellThin, hdrBg, 'text-center')}>W</th>
            <th className={cn(cellThin, hdrBg, 'text-center')}>L</th>
            <th className={cn(cellThin, hdrBg, 'text-center')}>H</th>
            <th className={cn(cellThin, hdrBg, 'text-center')}>Q'ty</th>
          </tr>
        </thead>
        <tbody>
          {item.materials.map((m, mIdx) => (
            <tr key={mIdx}>
              {mIdx === 0 && (
                <td rowSpan={item.materials.length + 1} className={cn(cell, 'text-center align-top')}>Material</td>
              )}
              <td className={cellThin}>
                <input type="text" list={`mat-list-${activeIdx}`} value={m.name}
                  onChange={(e) => updateMat(mIdx, { name: e.target.value })}
                  onPaste={mIdx === 0 ? pasteMaterials : undefined}
                  placeholder={mIdx === 0 ? '📋 Paste từ Excel (Tên / W / L / H / Qty / Giá)…' : ''}
                  title={mIdx === 0 ? 'Tip: Copy nhiều dòng từ Excel rồi Ctrl+V vào ô này để auto-add' : ''}
                  className="w-full bg-transparent border-0 outline-none text-center" />
              </td>
              <td className={cellThin}><NumberCellExcel value={m.w} onChange={(v) => updateMat(mIdx, { w: v })} /></td>
              <td className={cellThin}><NumberCellExcel value={m.l} onChange={(v) => updateMat(mIdx, { l: v })} /></td>
              <td className={cellThin}><NumberCellExcel value={m.h} onChange={(v) => updateMat(mIdx, { h: v })} /></td>
              <td className={cellThin}><NumberCellExcel value={m.qty} onChange={(v) => updateMat(mIdx, { qty: v ?? 0 })} min={0} /></td>
              <td className={cn(cellThin, 'text-right font-mono')}>{calcWeight(m)}</td>
              <td className={cn(cellThin, 'text-center')}>Kg</td>
              <td className={cellThin}><NumberCellExcel value={m.unit_price} onChange={(v) => updateMat(mIdx, { unit_price: v ?? 0 })} min={0} align="right" /></td>
              <td className={cn(cellThin, 'text-right font-mono')}>{fmtVnd((m.qty || 0) * (m.unit_price || 0)) || '—'}</td>
              <td className={cellThin}>
                <button onClick={() => removeMat(mIdx)} className="text-slate-300 hover:text-red-500 float-right"><Trash2 className="w-3 h-3" /></button>
              </td>
            </tr>
          ))}
          {item.materials.length === 0 && (
            <tr>
              <td className={cn(cell, 'text-center align-top')}>Material</td>
              <td colSpan={10} className={cn(cellThin, 'text-slate-400 italic text-center')}>Chưa có vật liệu</td>
            </tr>
          )}
          <tr>
            <td colSpan={2} className={cellThin}>
              <button type="button" onClick={addMat}
                className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-dashed border-brand-300 text-brand-700 hover:bg-brand-50">
                <Plus className="w-3 h-3" /> Thêm Material
              </button>
            </td>
            <td colSpan={6} className={cn(cellThin, 'text-center font-semibold')}>[SUB Total]</td>
            <td className={cn(cellThin, 'text-right font-mono font-bold')}>{fmtVnd(matTotal)}</td>
            <td className={cellThin}>&nbsp;</td>
          </tr>
        </tbody>
        <datalist id={`mat-list-${activeIdx}`}>
          {MATERIAL_PRESETS.map(p => <option key={p} value={p} />)}
        </datalist>
      </table>

      {/* PARTS TABLE */}
      <table className="w-full border-collapse mt-2">
        <colgroup>
          <col style={{ width: '8%' }} /><col style={{ width: '20%' }} /><col style={{ width: '23%' }} /><col style={{ width: '5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} /><col style={{ width: '15%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className={cn(cell, hdrBg, 'text-center')}>Division</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Discription</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Specifications</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Q'ty</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Unit</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Price(vnd)/Ea</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Amount(vnd)</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {item.parts.map((p, pIdx) => (
            <tr key={pIdx}>
              {pIdx === 0 && (
                <td rowSpan={item.parts.length + 1} className={cn(cell, 'text-center align-top')}>Parts</td>
              )}
              <td className={cellThin}>
                <input type="text" list={`parts-list-${activeIdx}`} value={p.name}
                  onChange={(e) => updatePart(pIdx, { name: e.target.value })}
                  onPaste={pIdx === 0 ? pasteParts : undefined}
                  placeholder={pIdx === 0 ? '📋 Paste (Tên / SL / Giá)…' : ''}
                  title={pIdx === 0 ? 'Tip: Paste nhiều dòng từ Excel' : ''}
                  className="w-full bg-transparent border-0 outline-none text-center" />
              </td>
              <td className={cellThin}>&nbsp;</td>
              <td className={cellThin}><NumberCellExcel value={p.qty} onChange={(v) => updatePart(pIdx, { qty: v ?? 0 })} min={0} /></td>
              <td className={cn(cellThin, 'text-center')}>Ea</td>
              <td className={cellThin}><NumberCellExcel value={p.unit_price} onChange={(v) => updatePart(pIdx, { unit_price: v ?? 0 })} min={0} align="right" /></td>
              <td className={cn(cellThin, 'text-right font-mono')}>{fmtVnd((p.qty || 0) * (p.unit_price || 0)) || '—'}</td>
              <td className={cellThin}>
                <button onClick={() => removePart(pIdx)} className="text-slate-300 hover:text-red-500 float-right"><Trash2 className="w-3 h-3" /></button>
              </td>
            </tr>
          ))}
          {item.parts.length === 0 && (
            <tr>
              <td className={cn(cell, 'text-center align-top')}>Parts</td>
              <td colSpan={7} className={cn(cellThin, 'text-slate-400 italic text-center')}>Chưa có linh kiện</td>
            </tr>
          )}
          <tr>
            <td colSpan={2} className={cellThin}>
              <button type="button" onClick={addPart}
                className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-dashed border-brand-300 text-brand-700 hover:bg-brand-50">
                <Plus className="w-3 h-3" /> Thêm Parts
              </button>
            </td>
            <td colSpan={4} className={cn(cellThin, 'text-center font-semibold')}>[SUB Total]</td>
            <td className={cn(cellThin, 'text-right font-mono font-bold')}>{fmtVnd(partsTotal) || '—'}</td>
            <td className={cellThin}>&nbsp;</td>
          </tr>
        </tbody>
        <datalist id={`parts-list-${activeIdx}`}>
          {PARTS_PRESETS.map(p => <option key={p} value={p} />)}
        </datalist>
      </table>

      {/* OTHER TABLE */}
      <table className="w-full border-collapse mt-2">
        <colgroup>
          <col style={{ width: '8%' }} /><col style={{ width: '20%' }} /><col style={{ width: '23%' }} /><col style={{ width: '5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} /><col style={{ width: '15%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className={cn(cell, hdrBg, 'text-center')}>Division</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Discription</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Specifications</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Q'ty</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Unit</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Price(vnd)/Ea</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Amount(vnd)</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {item.others.map((o, oIdx) => (
            <tr key={oIdx}>
              {oIdx === 0 && (
                <td rowSpan={item.others.length + 1} className={cn(cell, 'text-center align-top')}>Other</td>
              )}
              <td className={cellThin}>
                <input type="text" value={o.description}
                  onChange={(e) => updateOther(oIdx, { description: e.target.value })}
                  onPaste={oIdx === 0 ? pasteOthers : undefined}
                  placeholder={oIdx === 0 ? '📋 Paste (Mô tả / SL / Giá)…' : ''}
                  title={oIdx === 0 ? 'Tip: Paste nhiều dòng từ Excel' : ''}
                  className="w-full bg-transparent border-0 outline-none text-center" />
              </td>
              <td className={cellThin}>&nbsp;</td>
              <td className={cellThin}><NumberCellExcel value={o.qty} onChange={(v) => updateOther(oIdx, { qty: v ?? 0 })} min={0} /></td>
              <td className={cn(cellThin, 'text-center')}>Ea</td>
              <td className={cellThin}><NumberCellExcel value={o.unit_price} onChange={(v) => updateOther(oIdx, { unit_price: v ?? 0 })} min={0} align="right" /></td>
              <td className={cn(cellThin, 'text-right font-mono')}>{fmtVnd((o.qty || 0) * (o.unit_price || 0)) || '—'}</td>
              <td className={cellThin}>
                <button onClick={() => removeOther(oIdx)} className="text-slate-300 hover:text-red-500 float-right"><Trash2 className="w-3 h-3" /></button>
              </td>
            </tr>
          ))}
          {item.others.length === 0 && (
            <tr>
              <td className={cn(cell, 'text-center align-top')}>Other</td>
              <td colSpan={7} className={cn(cellThin, 'text-slate-400 italic text-center')}>Chưa có dòng khác</td>
            </tr>
          )}
          <tr>
            <td colSpan={2} className={cellThin}>
              <button type="button" onClick={addOther}
                className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-dashed border-brand-300 text-brand-700 hover:bg-brand-50">
                <Plus className="w-3 h-3" /> Thêm Other
              </button>
            </td>
            <td colSpan={4} className={cn(cellThin, 'text-center font-semibold')}>[SUB Total]</td>
            <td className={cn(cellThin, 'text-right font-mono font-bold')}>{fmtVnd(othersTotal) || '—'}</td>
            <td className={cellThin}>&nbsp;</td>
          </tr>
          <tr className={totalRow}>
            <td colSpan={6} className={cn(cell, 'text-center')}>Material Total</td>
            <td className={cn(cell, 'text-right font-mono')}>{fmtVnd(materialTotal)}</td>
            <td className={cell}>&nbsp;</td>
          </tr>
        </tbody>
      </table>

      {/* PROCESS TABLE */}
      <div className="mt-2 mb-1 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800 flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
        <span>8 quy trình tải sẵn — chỉ điền <b>Price(vnd)/Hr</b>. Quy trình giá = 0 sẽ tự động bị bỏ qua khi xuất Excel/PDF.</span>
      </div>
      <table className="w-full border-collapse">
        <colgroup>
          <col style={{ width: '8%' }} /><col style={{ width: '20%' }} /><col style={{ width: '23%' }} /><col style={{ width: '5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} /><col style={{ width: '15%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className={cn(cell, hdrBg, 'text-center')}>Division</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Discription</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Specifications</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Time</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Unit</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Price(vnd)/Hr</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Amount(vnd)</th>
            <th className={cn(cell, hdrBg, 'text-center')}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {item.processes.map((p, pIdx) => (
            <tr key={pIdx}>
              {pIdx === 0 && (
                <td rowSpan={item.processes.length + 1} className={cn(cell, 'text-center align-top')}>Process</td>
              )}
              <td className={cellThin}>
                <input type="text" list={`proc-list-${activeIdx}`} value={p.name}
                  onChange={(e) => updateProc(pIdx, { name: e.target.value })}
                  onPaste={pIdx === 0 ? pasteProcesses : undefined}
                  placeholder={pIdx === 0 ? '📋 Paste (Công đoạn / Giờ / Giá)…' : ''}
                  title={pIdx === 0 ? 'Tip: Paste nhiều dòng từ Excel' : ''}
                  className="w-full bg-transparent border-0 outline-none text-center" />
              </td>
              <td className={cellThin}>&nbsp;</td>
              <td className={cellThin}><NumberCellExcel value={p.time_hr} onChange={(v) => updateProc(pIdx, { time_hr: v ?? 0 })} min={0} step={0.1} /></td>
              <td className={cn(cellThin, 'text-center')}>Hr</td>
              <td className={cellThin}><NumberCellExcel value={p.unit_price} onChange={(v) => updateProc(pIdx, { unit_price: v ?? 0 })} min={0} align="right" /></td>
              <td className={cn(cellThin, 'text-right font-mono')}>{fmtVnd((p.time_hr || 0) * (p.unit_price || 0)) || '—'}</td>
              <td className={cellThin}>
                <button onClick={() => removeProc(pIdx)} className="text-slate-300 hover:text-red-500 float-right"><Trash2 className="w-3 h-3" /></button>
              </td>
            </tr>
          ))}
          {item.processes.length === 0 && (
            <tr>
              <td className={cn(cell, 'text-center align-top')}>Process</td>
              <td colSpan={7} className={cn(cellThin, 'text-slate-400 italic text-center')}>Chưa có quy trình</td>
            </tr>
          )}
          <tr className={totalRow}>
            <td colSpan={6} className={cn(cell, 'text-center')}>
              <button type="button" onClick={addProc}
                className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 mr-3 rounded border border-dashed border-amber-500 text-amber-800 hover:bg-amber-200">
                <Plus className="w-3 h-3" /> Process
              </button>
              Process Total
            </td>
            <td className={cn(cell, 'text-right font-mono')}>{fmtVnd(procTotal) || '—'}</td>
            <td className={cell}>&nbsp;</td>
          </tr>
        </tbody>
        <datalist id={`proc-list-${activeIdx}`}>
          {PROCESS_PRESETS.map(p => <option key={p} value={p} />)}
        </datalist>
      </table>

      {/* Bottom-line totals */}
      <table className="w-full border-collapse mt-2">
        <colgroup>
          <col style={{ width: '36%' }} /><col style={{ width: '6%' }} /><col style={{ width: '18%' }} /><col style={{ width: '25%' }} /><col style={{ width: '15%' }} />
        </colgroup>
        <tbody>
          <tr className={totalRow}>
            <td className={cn(cell, 'text-center')}>Material + Process Total</td>
            <td className={cell}>&nbsp;</td>
            <td className={cell}>&nbsp;</td>
            <td className={cn(cell, 'text-right font-mono')}>{fmtVnd(materialPlusProcess)}</td>
            <td className={cell}>&nbsp;</td>
          </tr>
          <tr>
            <td className={cn(cell, 'text-center')}>Management Expenses</td>
            <td className={cn(cell, 'text-center')}>5%</td>
            <td className={cell}>&nbsp;</td>
            <td className={cn(cell, 'text-right font-mono')}>{fmtVnd(mgmt)}</td>
            <td className={cell}>&nbsp;</td>
          </tr>
          <tr>
            <td className={cn(cell, 'text-center')}>Profit</td>
            <td className={cn(cell, 'text-center')}>5%</td>
            <td className={cell}>&nbsp;</td>
            <td className={cn(cell, 'text-right font-mono')}>{fmtVnd(profit)}</td>
            <td className={cell}>&nbsp;</td>
          </tr>
          <tr>
            <td className={cn(cell, 'text-center')}>절사 (-)</td>
            <td className={cell}>&nbsp;</td>
            <td className={cell}>&nbsp;</td>
            <td className={cn(cell, 'text-right')}>
              <input type="number" min={0} value={item.nego}
                onChange={(e) => updateItem(activeIdx, { nego: Number(e.target.value) || 0 })}
                className="w-full bg-transparent border-0 outline-none text-right font-mono" />
            </td>
            <td className={cn(cell, 'text-center text-[11px] text-slate-500')}>1000단위 이하</td>
          </tr>
          <tr className={totalRow}>
            <td className={cn(cell, 'text-center text-sm')}>Result Total Amount</td>
            <td className={cell}>&nbsp;</td>
            <td className={cell}>&nbsp;</td>
            <td className={cn(cell, 'text-right font-mono text-sm')}>{fmtVnd(itemTotal)}</td>
            <td className={cell}>&nbsp;</td>
          </tr>
        </tbody>
      </table>

      {/* Product photo + Note */}
      <table className="w-full border-collapse mt-2">
        <colgroup>
          <col style={{ width: '60%' }} /><col style={{ width: '40%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className={cn(cell, hdrBg, 'text-left')}>■ Product photo (3D,Part)_고화질 필수</th>
            <th className={cn(cell, hdrBg, 'text-left')}>■ Note</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cn(cell, 'p-0 relative group')} style={{ height: 220 }}>
              {!imgErr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={item.bqms_code}
                  onError={() => setImgErr(true)}
                  className="w-full h-full object-contain"
                  style={{ maxHeight: 218 }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs italic p-2 text-center">
                  Không tìm thấy ảnh cho mã <span className="font-mono mx-1">{item.bqms_code}</span>
                  <br />Click "Đổi ảnh" để tải ảnh mới
                </div>
              )}
              {/* Phase D — overlay Đổi ảnh button (Thang 2026-05-12 audit) */}
              <button
                type="button"
                disabled={uploadingImg}
                onClick={() => imgFileRef.current?.click()}
                className={cn(
                  "absolute top-1 right-1 px-2 py-1 rounded text-[11px] font-semibold shadow-sm transition-opacity",
                  uploadingImg
                    ? "bg-amber-200 text-amber-800"
                    : "bg-white/90 hover:bg-amber-100 text-slate-700 opacity-0 group-hover:opacity-100",
                )}
                title="Tải ảnh mới từ máy để thay ảnh default"
              >
                {uploadingImg ? '⏳ Đang upload...' : '📷 Đổi ảnh'}
              </button>
              <input
                ref={imgFileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageReplace(f);
                }}
              />
            </td>
            <td className={cell} style={{ height: 220 }}>&nbsp;</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function NumberCellExcel({
  value, onChange, min, step, align = 'center',
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number; step?: number;
  align?: 'left' | 'center' | 'right';
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      min={min}
      step={step}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      className={cn(
        "w-full bg-transparent border-0 outline-none font-mono",
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
      )}
    />
  );
}

function NumberCell({
  value, onChange, min, step,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number; step?: number;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      min={min}
      step={step}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      className="w-full px-1 py-0.5 border border-slate-200 rounded text-right text-xs font-mono"
    />
  );
}


// ─── PushQueueWidget — fixed bottom-right showing BQMS push queue status ─────
// Thang 2026-05-14: live track jobs đẩy lên SEC. Poll mỗi 5s.

function PushQueueWidget({ onClickRfq }: { onClickRfq?: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  // Thang 2026-05-15 (Issue 14): widget tự ẩn 20s sau khi push xong (active=0).
  // recentDone/failed có thể tồn tại lâu trong DB nên không dùng làm điều kiện
  // hiển thị → chỉ giữ widget khi đang chạy hoặc vừa hoàn tất.
  const [holdUntil, setHoldUntil] = useState<number>(0);
  const [, setTick] = useState(0);  // force re-render khi timer tick

  const { data } = useQuery({
    queryKey: ['bqms-push-queue'],
    queryFn: () => api.get<any>('/api/v1/bqms/push-queue/status'),
    refetchInterval: 5000,
  });

  const items: any[] = data?.data ?? [];
  const activeItems = items.filter((i) => ['queued', 'running'].includes(i.bqms_push_status));
  const recentDone = items.filter((i) => i.bqms_push_status === 'saved_temp').slice(0, 3);
  const failed = items.filter((i) => i.bqms_push_status === 'failed').slice(0, 3);

  // Bắt đầu hold 20s khi vừa chuyển từ "đang chạy" sang "hết job".
  useEffect(() => {
    if (activeItems.length > 0) {
      setHoldUntil(Date.now() + 20_000);
    }
  }, [activeItems.length]);

  // Tick mỗi giây để check holdUntil đã hết chưa.
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const inHold = Date.now() < holdUntil;
  if (activeItems.length === 0 && !inHold) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-2 bg-brand-600 text-white flex items-center justify-between text-xs font-bold"
        >
          <span className="flex items-center gap-1.5">
            <Send className="h-3.5 w-3.5" />
            Push to SEC ({activeItems.length} đang xử lý)
          </span>
          <span>{expanded ? '▾' : '▸'}</span>
        </button>
        {expanded && (
          <div className="max-h-80 overflow-y-auto">
            {activeItems.map((it) => (
              <div key={it.id} className="px-3 py-2 border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                onClick={() => onClickRfq?.(it.id)}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono font-bold text-brand-700">{it.rfq_number}</span>
                  {it.bqms_push_status === 'running' ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[11px] font-bold">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> ĐANG CHẠY
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[11px] font-bold">CHỜ</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Round V{it.bqms_pushed_round ?? '?'}</div>
              </div>
            ))}
            {recentDone.length > 0 && (
              <>
                <div className="px-3 py-1.5 bg-emerald-50 text-[11px] font-bold uppercase text-emerald-700">✓ Vừa xong</div>
                {recentDone.map((it) => (
                  <div key={it.id} className="px-3 py-1.5 border-b border-slate-100 hover:bg-slate-50">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono font-bold text-emerald-700">{it.rfq_number}</span>
                      <span className="text-[11px] text-slate-500">{it.bqms_pushed_at ? new Date(it.bqms_pushed_at).toLocaleTimeString('vi-VN') : ''}</span>
                    </div>
                    {it.bqms_push_screenshot_path && (
                      <a href={`/api/v1/bqms/rfq/${it.id}/push-screenshot`} target="_blank" rel="noreferrer"
                        className="text-[11px] text-brand-600 hover:underline">
                        Xem screenshot
                      </a>
                    )}
                  </div>
                ))}
              </>
            )}
            {failed.length > 0 && (
              <>
                <div className="px-3 py-1.5 bg-rose-50 text-[11px] font-bold uppercase text-rose-700">✗ Lỗi gần đây</div>
                {failed.map((it) => (
                  <div key={it.id} className="px-3 py-1.5 border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => onClickRfq?.(it.id)}>
                    <div className="font-mono text-[11px] font-bold text-rose-700">{it.rfq_number}</div>
                    {it.bqms_push_error && (
                      <div className="text-[11px] text-rose-600 truncate" title={it.bqms_push_error}>{it.bqms_push_error}</div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
