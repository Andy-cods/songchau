'use client';

/**
 * Vendor Bidding — chi tiết phiên đấu thầu (Đợt 1, rebuild IMV-style).
 *
 * Quản lý items, mời TÀI KHOẢN NCC (login-based, KHÔNG magic-link),
 * xem matrix giá so sánh (rows=items × cols=invited vendors, ô = unit_price,
 * thấp nhất tô xanh, badge lead-time), publish phiên.
 *
 * Mirror trang IMV: sticky brand/slate header, KPI tiles, config tabs với
 * counts, fmtDateVN/fmtMoney helpers, skeleton, react-query, sonner toasts.
 * Award/contract = Đợt 2 (ngoài phạm vi Đợt 1, đã ẩn).
 */

import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { cn, toNum, safeFixed } from '@/lib/utils';
import { toast } from 'sonner';
import {
  ArrowLeft, Plus, Send, X, Loader2, Package, Mail,
  CheckCircle2, AlertCircle, Clock, Image as ImageIcon, Building2,
  Gavel, Grid3x3, Trophy, Ban, Eye, Search, Award, History,
  ArrowUpCircle, RotateCcw, ChevronRight, User as UserIcon,
  FileSignature, FileText, Download, Zap, MoreHorizontal, ChevronDown,
  Sparkles, ChevronUp, Info, Wand2,
  LayoutGrid, ClipboardPaste, Wrench, Database, FileSpreadsheet, UploadCloud,
  Library, ShieldCheck, CornerUpLeft, Hourglass, PencilLine,
  MessageCircle, Lock, ExternalLink, FileArchive,
} from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import {
  PageShellHeader, CockpitTabs, StatusPill,
  DataPanel, DensityToggle, ToggleChip,
  MatrixFreezeCol, MatrixVendorHead,
  StatStrip, TrackingRail, RailCard, RailStepper,
  ItemDescCell, CurrencyTotalRow,
  TYPE, ELEVATION, RADIUS, BADGE, BUTTON, SHELL, DEPTH, MATRIX,
  ROW_PADDING,
  type BadgeTone, type Density, type StatChip, type RailStep,
} from '@/components/cockpit';
import QAPanel from './QAPanel'; // Đợt 2a #12 — panel Hỏi đáp NCC + Đăng phụ lục
import { BqmsImageThumb } from '@/components/bqms-images/BqmsImageThumb'; // cột ảnh mã (giống BQMS)
import { BqmsCodeFilesButton } from '@/components/bqms-images/BqmsCodeFilesButton'; // File mã (thư mục Raw)

// Phân biệt nguồn mã: BQMS (Samsung) vs Nguồn cung / nhập tay. Dùng ở Items tab + matrix.
function SourcePill({ kind }: { kind?: string | null }) {
  if (!kind) return null;
  const isBqms = kind === 'bqms';
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold',
      isBqms ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600')}>
      {isBqms ? 'BQMS' : 'Nguồn cung'}
    </span>
  );
}

// Ô sửa INLINE: bấm → input, Enter/blur lưu (PATCH), Esc huỷ. `display` = bản hiển
// thị đã format (vd tiền tệ); `value` = giá trị thô để sửa. Chỉ sửa khi canEdit.
function EditableCell({
  value, display, onSave, type = 'text', canEdit, placeholder, className, suffix, align = 'left',
}: {
  value: string | number | null | undefined;
  display?: ReactNode;
  onSave: (v: string | number | null) => void;
  type?: 'text' | 'number';
  canEdit: boolean;
  placeholder?: string;
  className?: string;
  suffix?: ReactNode;
  align?: 'left' | 'right';
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const has = value != null && value !== '';
  const shown = display != null ? display : (has ? value : null);
  if (!canEdit) {
    return <span className={className}>{shown ?? '—'}{has ? suffix : null}</span>;
  }
  if (!editing) {
    return (
      <button type="button"
        onClick={(e) => { e.stopPropagation(); setVal(has ? String(value) : ''); setEditing(true); }}
        title="Bấm để sửa"
        className={cn('rounded px-1 -mx-1 text-left hover:bg-amber-50 hover:ring-1 hover:ring-amber-200 transition-colors', className)}>
        {shown ?? <span className="text-slate-300 italic">{placeholder ?? 'Thêm…'}</span>}{has ? suffix : null}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const nv = type === 'number' ? (val.trim() === '' ? null : Number(val)) : val.trim();
    if (String(nv ?? '') !== String(value ?? '')) onSave(nv);
  };
  return (
    <input autoFocus type={type === 'number' ? 'number' : 'text'} value={val}
      onChange={(e) => setVal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') setEditing(false); }}
      onClick={(e) => e.stopPropagation()}
      className={cn('w-full min-w-0 rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[13px] text-slate-800 outline-none ring-2 ring-amber-100', align === 'right' && 'text-right')}
    />
  );
}

// ─── Shared modal helpers (a11y: Escape-to-close + body-scroll-lock) ──

/** Lock body scroll + close on Escape while a modal is mounted. */
function useModalDismiss(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
}

// Canonical modal class tokens (unify overlay/panel/header across all dialogs).
// Cockpit Tier-4: rounded-xl + shadow-2xl + ring-1 (replaces rounded-2xl box-soup).
const MODAL_OVERLAY = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4';
const MODAL_PANEL = cn('bg-white overflow-hidden', RADIUS.modal, ELEVATION.modal);
const MODAL_HEADER = 'px-6 py-4 border-b border-slate-100 bg-white flex items-start justify-between gap-4';
const MODAL_CLOSE = 'flex-shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors';
const INPUT_CLS = 'w-full px-3 py-2 ring-1 ring-slate-200 rounded-lg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition-all';

/** datetime-local value for "now" (for min= on deadline pickers). */
function nowDatetimeLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// ─── Helpers ────────────────────────────────────────────────────

const fmtDateVN = (s: any) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const fmtMoney = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('vi-VN').format(n % 1 === 0 ? n : Math.round(n * 100) / 100);
};
/** Combine date + time pickers into an ISO string with the VN offset (+07:00). */
function composeDeadlineISO(date: string, time: string): string | null {
  if (!date) return null;
  const t = (time && /^\d{2}:\d{2}/.test(time)) ? time.slice(0, 5) : '17:00';
  return `${date}T${t}:00+07:00`;
}
/** Split an ISO deadline back into {date,time} pickers rendered in VN local. */
function splitDeadlineISO(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '17:00' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: '', time: '17:00' };
  const vn = new Date(d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60_000);
  const date = `${vn.getFullYear()}-${String(vn.getMonth() + 1).padStart(2, '0')}-${String(vn.getDate()).padStart(2, '0')}`;
  const time = `${String(vn.getHours()).padStart(2, '0')}:${String(vn.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}
/** D-N badge (giống BQMS) — theo NGÀY lịch: D-2/D-1/D-Day/Closed. Đỏ ≤2 ngày,
 *  amber ≤4, slate xa hạn. Dùng ở header phiên để theo dõi nhanh như trang BQMS. */
function ddayMeta(iso: string | null | undefined): { label: string; cls: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dl = new Date(d); dl.setHours(0, 0, 0, 0);
  const n = Math.round((dl.getTime() - today.getTime()) / 86_400_000);
  if (n < 0) return { label: 'Closed', cls: 'bg-slate-200 text-slate-700 border-slate-300' };
  const cls = n <= 2 ? 'bg-red-100 text-red-700 border-red-200'
    : n <= 4 ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-slate-100 text-slate-600 border-slate-200';
  return { label: n === 0 ? 'D-Day' : `D-${n}`, cls };
}

/** Deadline countdown chip descriptor: slate (>24h), amber (≤24h), rose (≤2h/past). */
function deadlineChip(iso: string | null | undefined):
  { label: string; tone: BadgeTone; past: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return { label: 'Quá hạn', tone: 'rose', past: true };
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const days = Math.floor(h / 24);
  let label: string;
  if (days >= 1) label = `Còn ${days} ngày`;
  else if (h >= 1) label = `Còn ${h}h${mins % 60 ? ` ${mins % 60}p` : ''}`;
  else label = `Còn ${mins}p`;
  const tone: BadgeTone = h <= 2 ? 'rose' : h <= 24 ? 'amber' : 'slate';
  return { label, tone, past: false };
}
/** Big countdown descriptor for the tracking rail: "1n 04:12" + sub line. */
function deadlineCountdown(iso: string | null | undefined):
  { big: string; tone: BadgeTone; past: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return { big: 'Quá hạn', tone: 'rose', past: true };
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const big = days >= 1 ? `${days}n ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}`;
  const totalH = Math.floor(totalMin / 60);
  const tone: BadgeTone = totalH <= 2 ? 'rose' : totalH <= 24 ? 'amber' : 'slate';
  return { big, tone, past: false };
}

// ─── Types ──────────────────────────────────────────────────────

interface Item {
  id: number;
  item_no: number;
  specification: string;
  bqms_code: string | null;
  quantity: number;
  unit: string;
  required_material: string | null;
  drawing_url: string | null;
  notes: string | null;
  target_price: number | null;
  // Vendor-bidding rebuild (P1) — optional, surfaced by later phases.
  source_kind?: 'manual' | 'bqms' | string | null;
  source_bqms_rfq_number?: string | null; // ADMIN-ONLY: mở File mã từ thư mục Raw
  item_code?: string | null;
  product_name?: string | null;
  maker?: string | null;
  model?: string | null;
}

// ── Đợt 10 #14 — popover "Lịch sử mã hàng" (AI từng báo giá / AI trúng) ──
interface ItemHistoryQuote {
  vendor_id: number;
  company_name: string | null;
  batch_id: number | null;
  batch_code: string | null;
  unit_price: number | string | null;
  currency: string | null;
  lead_time_days: number | null;
  quantity: number | string | null;
  submitted_at: string | null;
}
interface ItemHistoryAward {
  vendor_id: number;
  company_name: string | null;
  batch_id: number | null;
  batch_code: string | null;
  awarded_price: number | string | null;
  currency: string | null;
  quantity: number | string | null;
  awarded_at: string | null;
}
interface ItemHistoryResp {
  data: {
    item_code: string | null;
    bqms_code: string | null;
    quotes: ItemHistoryQuote[];
    awards: ItemHistoryAward[];
  };
}

interface InvitationRow {
  invitation_id: number;
  vendor_id: number;
  company_name: string;
  contact_name: string | null;
  email: string;
  round_number: number;
  status: 'invited' | 'viewed' | 'submitted' | 'declined';
  invited_at: string | null;
  viewed_at: string | null;
  quoted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  email_status: string | null;
  email_sent_at: string | null;
  reminder_sent_at: string | null;
  missed_deadline: boolean | null;
  my_quote: {
    id: number; total_amount: number | null; currency: string | null;
    lead_time_days: number | null; status: string; submitted_at: string | null;
  } | null;
}

interface MatrixCell {
  unit_price: number | null;
  quantity: number | null;
  // 6-currency set (VND/JPY/USD/KRW/RMB/EUR) — kept as string to match the
  // widened backend CHECK; server is the source of truth.
  currency: string | null;
  lead_time_days: number | null;
  notes: string | null;
  line_total: number | null;
  is_lowest: boolean;
  can_do: boolean | null;
  is_foc?: boolean; // FOC — NCC chào miễn phí (giá 0, KHÔNG tính là "thấp nhất")
  offered_qty?: number | null; // M2 — SL NCC chào
  moq?: string | null;          // M2 — đặt tối thiểu
  has_attachment?: boolean;     // M2 — có file đính kèm dòng
  delta?: number | null;        // M4 — Δ giá so vòng trước
  delta_pct?: number | null;    // M4 — Δ % so vòng trước
  prior_unit_price?: number | null;
  sealed?: boolean;             // Đợt 2b — ô bị niêm phong (giấu giá tới hạn)
  // Đợt 4 — quy đổi VND as-of bid_deadline (ADDITIVE, KHÔNG đổi giá gốc).
  // vắng/null ⇒ BE chưa trả (VND-only hoặc sealed) → FE không hiện gì.
  vnd_equiv?: number | null;
  vnd_line_total?: number | null;
  fx_missing?: boolean;         // thiếu tỷ giá tại ngày chốt → cảnh báo amber
}
interface MatrixVendor {
  vendor_id: number;
  company_name: string;
  inv_status: 'invited' | 'viewed' | 'submitted' | 'declined';
  quote_id: number | null;
  currency: string | null;
  lead_time_days: number | null;
  total_amount: number | null;
  submitted_at: string | null;
  grade?: 'A' | 'B' | 'C' | null; // M3 — hạng uy tín NCC (cache scorecard)
  // Đợt 4 — tổng quy đổi VND của NCC (total_amount × rate as-of deadline).
  vnd_equiv_total?: number | null;
  fx_missing?: boolean;           // thiếu tỷ giá → cảnh báo amber ở footer
}
interface MatrixItem {
  item_id: number;
  item_no: number;
  specification: string;
  bqms_code: string | null;
  quantity: number;
  unit: string;
  required_material: string | null;
  source_kind?: string | null;              // BQMS vs Nguồn cung (pill)
  source_bqms_rfq_number?: string | null;   // ADMIN-ONLY: mở File mã (thư mục Raw)
  target_price: number | null;
  awarded_vendor_id?: number | null;
  awarded_price?: number | null;
  awarded_currency?: string | null;
  cells: Record<string, MatrixCell>;
  lowest: { by_currency: Record<string, { vendor_id: number; unit_price: number } | null> };
}
interface MatrixResp {
  data: {
    batch: { id: number; batch_code: string; title: string; status: string; award_mode: string; round_number: number; sealed?: boolean; sealed_until?: string | null;
      // Đợt 4 — meta FX cho banner: tỷ giá ngày nào + số ô thiếu rate.
      fx?: { as_of: string | null; missing_count: number } };
    vendors: MatrixVendor[];
    items: MatrixItem[];
  };
}

// ─── Full-quote drawer (P5) ─────────────────────────────────────
interface FullQuoteLine {
  item_id: number;
  item_no: number;
  item_code: string | null;
  bqms_code: string | null;
  specification: string | null;
  unit: string | null;
  required_material: string | null;
  quantity: number | null;
  unit_price: number | null;
  offered_qty: number | null;
  moq: string | null;
  can_do: boolean | null;
  free_charge?: boolean;
  lead_time_days: number | null;
  notes: string | null;
  currency: string | null;
  line_total: number | null;
  attachments: { index: number; filename: string }[];
  prior_unit_price: number | null;
  delta: number | null;
  delta_pct: number | null;
}
interface FullQuoteResp {
  data: {
    batch: { id: number; batch_code: string; title: string; status: string; award_mode: string };
    vendor: { vendor_id: number; company_name: string; contact_name: string | null; email: string };
    header: {
      quote_id: number;
      currency: string | null;
      lead_time_days: number | null;
      total_amount: number | null;
      submitted_at: string | null;
      round_number: number;
      status: string;
      moq_notes: string | null;
      notes: string | null;
      valid_until: string | null; // M2 — hiệu lực báo giá đến
      grade?: 'A' | 'B' | 'C' | null; // M3 — hạng uy tín NCC
      on_time_rate?: number | null;    // M3 — tỉ lệ giao đúng hạn (%)
      has_attachment: boolean;
      attachment_filename: string | null;
      external_url: string | null; // Đợt sau-demo — link tham khảo NCC dán
      prior_round: number | null;
    };
    lines: FullQuoteLine[];
  };
}

// ─── Smart-award (Gợi ý chốt thầu) ──────────────────────────────
// Server ranks WITHIN a single currency group (no FX). Postgres NUMERIC
// fields arrive as STRINGS → coerce via toNum()/safeFixed() before any math.
// A vendor with too little history → score=null + grade dash; weights are
// renormalized over present factors server-side so it is never punished to 0.

/** One scoring factor (price / lead / scorecard) for a ranked vendor. */
interface SaFactor {
  // normalized 0..1 (1 = best). NUMERIC → may be string|number|null.
  norm: number | string | null;
  // raw value for the tooltip/label (unit_price, lead_time_days, score 0..100…).
  raw?: number | string | null;
  // weight actually applied AFTER renormalization over present factors.
  weight?: number | string | null;
  // true when this factor had no data for the vendor (excluded from the score).
  missing?: boolean;
}

interface SaRankedVendor {
  vendor_id: number;
  company_name: string;
  rank: number;                    // 1 = suggested winner within the group
  // composite weighted score 0..1 (or 0..100). null = "Chưa đủ dữ liệu".
  score: number | string | null;
  grade?: string | null;           // letter grade or '—' when score is null
  price?: number | string | null;  // suggested unit_price (per_item) / total (per_batch)
  currency?: string | null;
  // Đợt 4 — quy đổi VND để HIỂN THỊ (rank GIỮ per-currency, KHÔNG dùng vnd để sort).
  vnd_equiv?: number | null;
  fx_missing?: boolean;
  lead_time_days?: number | string | null;
  factors?: { price?: SaFactor; lead?: SaFactor; scorecard?: SaFactor };
  why?: string | null;             // server-built rationale text (Vietnamese)
  insufficient?: boolean;          // score could not be computed (sparse vendor)
}

/** Per-item ranking inside ONE currency group. */
interface SaItem {
  item_id: number;
  item_no?: number;
  bqms_code?: string | null;
  specification?: string | null;
  quantity?: number | string | null;
  vendors: SaRankedVendor[];       // sorted by rank asc; vendors[0] = rank-1
}

/** A currency group — ranking happens ONLY within this; NEVER summed across groups. */
interface SaCurrencyGroup {
  currency: string;                // 'USD' | 'RMB' | 'VND'
  // per_item mode → items[]; per_batch mode → batch ranking (single list).
  items?: SaItem[];
  batch?: SaRankedVendor[];        // per_batch: ranked vendors for the whole package
}

interface SaData {
  award_mode?: 'per_item' | 'per_batch';
  weights?: { price?: number | string; lead?: number | string; scorecard?: number | string };
  // Each currency is its own silo. >1 group ⇒ cross-currency caution note.
  groups: SaCurrencyGroup[];
  mixed_currency?: boolean;        // server flag: vendors quoted in multiple currencies
  note?: string | null;
}
interface SmartAwardResp { data: SaData }

// ─── Audit timeline ─────────────────────────────────────────────

interface AuditEntry {
  id: number;
  entity_type: string;
  entity_id: number;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_vendor_id: number | null;
  actor_vendor_name: string | null;
  detail: Record<string, any> | null;
  created_at: string;
}
interface AuditResp { data: AuditEntry[] }

// Canonical pill: rounded-full + ring-1 ring-inset + functional palette.
const BADGE_BASE = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap';

const INV_STATUS: Record<string, { vi: string; cls: string; icon: any; tone: BadgeTone }> = {
  invited: { vi: 'Đã mời', cls: 'bg-slate-50 text-slate-600 ring-slate-200', icon: Mail, tone: 'slate' },
  viewed: { vi: 'Đã xem', cls: 'bg-sky-50 text-sky-700 ring-sky-200', icon: Eye, tone: 'sky' },
  submitted: { vi: 'Đã báo giá', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCircle2, tone: 'emerald' },
  declined: { vi: 'Từ chối', cls: 'bg-rose-50 text-rose-700 ring-rose-200', icon: Ban, tone: 'rose' },
};

const BATCH_STATUS: Record<string, { vi: string; cls: string; tone: BadgeTone }> = {
  draft: { vi: 'Nháp', cls: 'bg-slate-50 text-slate-600 ring-slate-200', tone: 'slate' },
  cho_duyet: { vi: 'Chờ duyệt', cls: 'bg-amber-50 text-amber-800 ring-amber-200', tone: 'amber' },
  approved: { vi: 'Đã duyệt', cls: 'bg-sky-50 text-sky-700 ring-sky-200', tone: 'sky' },
  rejected_internal: { vi: 'Bị trả lại', cls: 'bg-rose-50 text-rose-700 ring-rose-200', tone: 'rose' },
  published: { vi: 'Đang mở', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', tone: 'emerald' },
  evaluating: { vi: 'Đang xét', cls: 'bg-sky-50 text-sky-700 ring-sky-200', tone: 'sky' },
  closed: { vi: 'Đã đóng', cls: 'bg-amber-50 text-amber-800 ring-amber-200', tone: 'amber' },
  awarded: { vi: 'Đã chốt', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', tone: 'emerald' },
  cancelled: { vi: 'Huỷ', cls: 'bg-rose-50 text-rose-700 ring-rose-200', tone: 'rose' },
};

// Audit action → Vietnamese label + tone
const AUDIT_ACTION: Record<string, { vi: string; cls: string }> = {
  publish: { vi: 'Công bố phiên', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  submit_for_approval: { vi: 'Gửi duyệt nội bộ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  approve: { vi: 'Duyệt nội bộ', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  reject_internal: { vi: 'Trả lại phiên', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  invite: { vi: 'Mời NCC', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  open_round: { vi: 'Mở vòng', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  award: { vi: 'Chốt thầu', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  re_award: { vi: 'Chốt lại', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  // Đợt 3 — maker-checker award gate.
  award_proposed: { vi: 'Đề xuất chốt thầu', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  award_approved: { vi: 'Duyệt chốt thầu', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  award_rejected: { vi: 'Từ chối chốt thầu', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  award_breakglass: { vi: '⚠ Break-glass chốt thầu', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  decline: { vi: 'Từ chối', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  quote_submit: { vi: 'Gửi báo giá', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  status_change: { vi: 'Đổi trạng thái', cls: 'bg-slate-50 text-slate-700 border-slate-200' },
};

const fmtDateTimeVN = (s: any) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  const dd = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const tt = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${dd} ${tt}`;
};

type DetailTab = 'items' | 'invitations' | 'matrix' | 'contracts' | 'qa' | 'audit';

// Concrete named response type for the batch-detail query. Must be a real
// interface with NO bare-`any` value / NO index signature (those collapse `data`
// to `never` under the placeholderData:keepPreviousData overload — `any` distributes
// badly too). Mirrors the MatrixResp pattern that already works in this file.
interface BatchDetailData {
  id?: number;
  batch_code: string;
  title: string;
  description: string | null;
  status: string;
  award_mode: 'per_item' | 'per_batch';
  item_count?: number;
  current_round?: number;
  max_rounds?: number;
  published_at?: string | null;
  created_at?: string;
  items?: Item[];
  // Vendor-bidding rebuild (P1) — optional, surfaced by later phases.
  phu_trach?: string | null;
  visibility?: 'invited' | 'public' | string | null;
  bid_deadline?: string | null;
  deadline_round1?: string | null;
  deadline_round2?: string | null;
  deadline_round3?: string | null;
  // P7 — internal approval gate columns (migration 005).
  submitted_by?: string | null;
  submitted_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  approval_auto?: boolean | null;
  approval_rejected_by?: string | null;
  approval_rejected_at?: string | null;
  approval_rejection_reason?: string | null;
  // Đợt 3 — maker-checker award gate (migration 020). Default 'none'.
  // 'proposed' = award đang treo chờ người-thứ-hai duyệt (cổng tài chính).
  award_status?: 'none' | 'proposed' | 'approved' | string | null;
  award_proposed_by?: string | null;
  award_proposed_at?: string | null;
  award_approved_by?: string | null;
  award_approved_at?: string | null;
  // Đợt11 #15 — gợi ý vị thế cạnh tranh cho NCC (band-mờ). Default OFF.
  rank_hint_enabled?: boolean | null;
  rank_hint_round_from?: number | null;
  // Đợt 2b [SB] — niêm phong giá tới hạn (ẩn giá NCC ở ma trận/tờ trình). Default OFF.
  sealed_until_deadline?: boolean | null;
  // Đợt 2b [AM] — ghi chú nội bộ (KHÔNG gửi NCC), dùng cho modal "Sửa thông tin phiên".
  notes_internal?: string | null;
}
interface BatchDetailResp { data: BatchDetailData }

// ─── Contract lifecycle (6-state TEXT+CHECK; EXACT strings shared w/ backend) ──

type ContractStatus = 'draft' | 'sent' | 'signed' | 'active' | 'completed' | 'cancelled';

interface Contract {
  id: number;
  contract_no: string;
  batch_id: number | null;
  vendor_id: number | null;
  vendor_name: string;
  vendor_email: string | null;
  total_amount: number | null;
  currency: string | null;
  status: ContractStatus;
  sent_to_vendor_at: string | null;
  signed_at: string | null;
  signed_by_vendor: string | null;
  contract_file_path: string | null;
  pdf_generated_at: string | null;
  item_count: number;
  po_count: number;
  created_at: string;
}

const CONTRACT_STATUS: Record<ContractStatus, { vi: string; cls: string; tone: BadgeTone }> = {
  draft: { vi: 'Nháp', cls: 'bg-slate-50 text-slate-600 ring-slate-200', tone: 'slate' },
  sent: { vi: 'Đã gửi NCC', cls: 'bg-sky-50 text-sky-700 ring-sky-200', tone: 'sky' },
  signed: { vi: 'NCC đã ký', cls: 'bg-amber-50 text-amber-800 ring-amber-200', tone: 'amber' },
  active: { vi: 'Hiệu lực', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', tone: 'emerald' },
  completed: { vi: 'Hoàn tất', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', tone: 'emerald' },
  cancelled: { vi: 'Huỷ', cls: 'bg-rose-50 text-rose-700 ring-rose-200', tone: 'rose' },
};

/** Download the decision-sheet (.xlsx tờ trình chốt thầu) as an authed blob. */
async function downloadDecisionSheet(batchId: number, batchCode: string) {
  if (typeof window === 'undefined') return;
  const token = localStorage.getItem('access_token') ?? '';
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  try {
    const res = await fetch(`${base}/api/v1/procurement/batches/${batchId}/decision-sheet`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    });
    if (!res.ok) {
      toast.error(res.status === 403 ? 'Chỉ admin được xuất tờ trình.' : `Không xuất được (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `To-trinh-chot-thau_${(batchCode || `batch${batchId}`).replace(/[^A-Za-z0-9_.-]+/g, '_')}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e: any) {
    toast.error(`Lỗi xuất tờ trình: ${e?.message ?? 'Unknown'}`);
  }
}

/** Download a quote-level OR quote-item-level attachment as an authed blob. */
async function downloadQuoteAttachment(path: string, filename: string) {
  if (typeof window === 'undefined') return;
  const token = localStorage.getItem('access_token') ?? '';
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  try {
    const res = await fetch(`${base}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    });
    if (!res.ok) { toast.error(`Không tải được file (${res.status})`); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e: any) {
    toast.error(`Lỗi tải file: ${e?.message ?? 'Unknown'}`);
  }
}

/** Download an admin-protected contract PDF as an authenticated blob and open it. */
async function openContractPdf(contractId: number) {
  if (typeof window === 'undefined') return;
  const token = localStorage.getItem('access_token') ?? '';
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  try {
    const res = await fetch(`${base}/api/v1/procurement/contracts/${contractId}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    });
    if (!res.ok) {
      toast.error(res.status === 404 ? 'Chưa có PDF — bấm "Sinh PDF" trước.' : `Không tải được PDF (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e: any) {
    toast.error(`Lỗi tải PDF: ${e?.message ?? 'Unknown'}`);
  }
}

// ─── Item drawing (P5) — authed blob fetch for the lightbox ─────────────────
// The admin drawing endpoint streams file:// drawings and 307-redirects bqms://
// items to /bqms/rfq/image (also authed, same origin → fetch re-sends the JWT).
// We fetch as a blob so the <img>/<iframe> src is a same-origin object URL and
// the Authorization header is honored (a raw <img src=API> can't send headers).

type DrawingKind = 'image' | 'pdf' | 'other';

/** Infer how to render a drawing blob from its content-type. */
function drawingKindFromType(ctype: string | null): DrawingKind {
  const t = (ctype || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.includes('pdf')) return 'pdf';
  return 'other';
}

/** Fetch one item's drawing as an authed object URL. Returns null on 404/empty. */
async function fetchItemDrawing(
  batchId: number, itemId: number,
): Promise<{ url: string; kind: DrawingKind; ctype: string } | null> {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('access_token') ?? '';
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  const res = await fetch(
    `${base}/api/v1/procurement/batches/${batchId}/items/${itemId}/drawing`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    },
  );
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`HTTP ${res.status}`);
  }
  const ctype = res.headers.get('content-type');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  return { url, kind: drawingKindFromType(ctype), ctype: ctype || '' };
}

/** Fetch any admin attachment path (quote file / line file) as an authed object URL. */
async function fetchAttachmentBlob(
  path: string,
): Promise<{ url: string; kind: DrawingKind; ctype: string } | null> {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('access_token') ?? '';
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'include',
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`HTTP ${res.status}`);
  }
  const ctype = res.headers.get('content-type');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  return { url, kind: drawingKindFromType(ctype), ctype: ctype || '' };
}

// ─── Page ───────────────────────────────────────────────────────

export default function BatchDetailPage() {
  const router = useRouter();
  const params = useParams();
  const batchId = Number(params.id);
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<DetailTab>('items');
  const [showAddItems, setShowAddItems] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showOpenRound, setShowOpenRound] = useState(false);
  const [showDeadline, setShowDeadline] = useState(false);
  const [showAmend, setShowAmend] = useState(false); // Đợt 2b [AM] — sửa thông tin phiên
  const [publishing, setPublishing] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [reminding, setReminding] = useState(false);
  // P7 — internal approval gate state.
  const [approving, setApproving] = useState(false);
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [showReject, setShowReject] = useState(false);
  // Đợt 3 — maker-checker award gate state.
  const [approvingAward, setApprovingAward] = useState(false);
  const [showRejectAward, setShowRejectAward] = useState(false);

  // P7 — role drives which approval actions render (admin/manager can approve).
  const { user } = useAuth();
  const role = user?.role ?? '';
  const isAdmin = role === 'admin';
  const canApprove = role === 'admin' || role === 'manager';

  // P7 — is the internal-approval gate ON? (admin-only endpoint; non-admins get
  // a 404/403 swallowed → treated as OFF, which only hides the gate buttons.)
  const { data: approvalCfgResp } = useQuery<{ data: { approval_required: boolean; allow_self: boolean; award_breakglass_enabled?: boolean } }>({
    queryKey: ['vb-approval-config'],
    queryFn: () => api.get<{ data: { approval_required: boolean; allow_self: boolean; award_breakglass_enabled?: boolean } }>('/api/v1/procurement/approval-config'),
    // Read-roles can now fetch it, so managers/procurement see the correct
    // publish-vs-submit button on a gated draft (was isAdmin-only → managers
    // wrongly saw "Công bố"). A 403 for other roles is swallowed → OFF.
    enabled: true,
    retry: false,
    staleTime: 60_000,
  });
  const approvalRequired = approvalCfgResp?.data?.approval_required ?? false;
  // Đợt 3 — break-glass bật → proposer được phép tự duyệt (BE audit cảnh báo);
  // FE chỉ dùng cờ này để quyết ẩn/hiện nút "Duyệt chốt thầu" với chính proposer.
  const awardBreakglass = approvalCfgResp?.data?.award_breakglass_enabled ?? false;

  // batchId is stable, so React Query already retains `data` across the 15s background
  // refetch (no placeholderData needed). The result `data` is read via an explicit
  // typed alias because the destructured form tripped a TanStack v5 + TS overload that
  // collapsed it to `never`; the cast pins the real shape with zero behavior change.
  const detailQ = useQuery<BatchDetailResp>({
    queryKey: ['vb-batch', batchId],
    queryFn: () => api.get<BatchDetailResp>(`/api/v1/procurement/batches/${batchId}`),
    refetchInterval: 15000,
  });
  const detail = detailQ.data as BatchDetailResp | undefined;
  const isLoading = detailQ.isLoading;
  const isError = detailQ.isError;

  const { data: invResp } = useQuery<{ data: InvitationRow[]; sealed?: boolean }>({
    queryKey: ['vb-batch-invitations', batchId],
    queryFn: () => api.get<{ data: InvitationRow[]; sealed?: boolean }>(`/api/v1/procurement/batches/${batchId}/invitations`),
    refetchInterval: 15000,
  });

  // Contracts scoped to this batch. The global list endpoint doesn't (yet) accept
  // batch_id, so we fetch the page and filter client-side on the batch_id field
  // (SELECT c.* exposes it). Safe even if the backend later adds the param.
  const { data: contractsResp } = useQuery<{ data: Contract[]; total: number }>({
    queryKey: ['vb-batch-contracts', batchId],
    queryFn: () => api.get<{ data: Contract[]; total: number }>(`/api/v1/procurement/contracts?batch_id=${batchId}&limit=100`),
    refetchInterval: 20000,
  });
  const contracts: Contract[] = (contractsResp?.data ?? []).filter((c) => c.batch_id === batchId);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await api.patch(`/api/v1/procurement/batches/${batchId}/publish`, {});
      toast.success('Đã publish phiên — NCC được mời có thể báo giá');
      queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setPublishing(false);
    }
  };

  // P7 — gửi phiên đi duyệt nội bộ (draft → cho_duyet). Admin only.
  const handleSubmitForApproval = async () => {
    setSubmittingApproval(true);
    try {
      await api.post(`/api/v1/procurement/batches/${batchId}/submit-for-approval`, {});
      toast.success('Đã gửi phiên đi duyệt nội bộ');
      queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSubmittingApproval(false);
    }
  };

  // P7 — duyệt nội bộ (cho_duyet → approved). admin/manager.
  const handleApprove = async () => {
    setApproving(true);
    try {
      await api.post(`/api/v1/procurement/batches/${batchId}/approve`, {});
      toast.success('Đã duyệt phiên — có thể công bố cho NCC');
      queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setApproving(false);
    }
  };

  // P7 — trả lại phiên (cho_duyet → draft) với lý do bắt buộc. admin/manager.
  const handleRejectInternal = async (reason: string) => {
    await api.post(`/api/v1/procurement/batches/${batchId}/reject-internal`, { reason });
    toast.success('Đã trả lại phiên cho người tạo');
    setShowReject(false);
    queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
    queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
    queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
  };

  // Đợt 3 [MC] — checker DUYỆT đề xuất chốt thầu (award_status proposed → approved
  // + finalize). BE trả {breakglass} nếu proposer tự duyệt qua break-glass.
  const handleApproveAward = async () => {
    setApprovingAward(true);
    try {
      const res = await api.post<{ data?: { breakglass?: boolean } }>(
        `/api/v1/procurement/batches/${batchId}/approve-award`, {},
      );
      toast.success(res?.data?.breakglass
        ? 'Đã duyệt qua break-glass — đã ghi cảnh báo hậu kiểm'
        : 'Đã duyệt & chốt thầu');
      ['vb-batch', 'vb-batch-matrix', 'vb-batch-invitations', 'vb-batch-audit'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k, batchId] }));
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setApprovingAward(false);
    }
  };

  // Đợt 3 [MC] — checker TỪ CHỐI đề xuất (award_status → none, batch về evaluating)
  // với lý do bắt buộc. Tái dùng RejectReasonModal (DRY).
  const handleRejectAward = async (reason: string) => {
    await api.post(`/api/v1/procurement/batches/${batchId}/reject-award`, { reason });
    toast.success('Đã từ chối đề xuất chốt thầu. Đợt quay lại trạng thái xét.');
    setShowRejectAward(false);
    queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
    queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
    queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
  };

  // Optional (KISS) published → evaluating transition when admin opens the matrix to compare.
  const handleEvaluating = async () => {
    setTransitioning(true);
    try {
      await api.patch(`/api/v1/procurement/batches/${batchId}/evaluating`, {});
      toast.success('Đã chuyển sang "Đang xét" — bắt đầu so sánh để chốt');
      queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setTransitioning(false);
    }
  };

  // P3 — manual resend to NCC chưa báo giá (status invited/viewed). Bypasses the
  // reminder_sent_at guard server-side but stamps it so the auto-sweep won't dup.
  const handleRemind = async () => {
    setReminding(true);
    try {
      const res = await api.post<{ data?: { sent?: any[]; failed?: any[] }; message?: string }>(
        `/api/v1/procurement/batches/${batchId}/remind`, {},
      );
      const sent = res?.data?.sent?.length ?? 0;
      const failed = res?.data?.failed?.length ?? 0;
      if (sent === 0 && failed === 0) toast.info(res?.message ?? 'Không có NCC nào cần nhắc');
      else if (failed > 0) toast.warning(`Đã nhắc ${sent} NCC, ${failed} lỗi gửi email`);
      else toast.success(`Đã nhắc ${sent} NCC chưa báo giá`);
      queryClient.invalidateQueries({ queryKey: ['vb-batch-invitations', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setReminding(false);
    }
  };

  // Only show the full skeleton on the very first load (no cached data yet).
  // keepPreviousData keeps the header/tabs alive during the 15s background poll.
  if (isLoading && !detail?.data) {
    return (
      <div className={cn(SHELL.page, '-m-6')}>
        <div className={cn('h-14', ELEVATION.container)} />
        <div className={cn(SHELL.content, 'py-4', SHELL.sectionStack)}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <div key={i} className={cn('h-24 p-4', ELEVATION.container, RADIUS.container, 'animate-pulse')} />)}
          </div>
          <div className={cn('h-10 w-72', RADIUS.container, 'bg-slate-100 animate-pulse')} />
          <div className={cn('h-96', ELEVATION.container, RADIUS.container, 'animate-pulse')} />
        </div>
      </div>
    );
  }
  // Not-found / error: render inside the page shell with a back button + inline rose banner
  // so the user is never stranded on a bare line of text.
  if (!detail?.data) {
    return (
      <div className={cn(SHELL.page, '-m-6')}>
        <div className={cn(SHELL.content, 'py-6', SHELL.sectionStack)}>
          <button onClick={() => router.push('/vendor-bidding')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Quay lại danh sách
          </button>
          <div role="alert" className={cn('flex items-start gap-3 px-4 py-3 text-sm', RADIUS.container, BADGE.rose.bg, BADGE.rose.text, BADGE.rose.ring)}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{isError ? 'Không tải được phiên đấu thầu. Thử tải lại trang.' : 'Không tìm thấy phiên đấu thầu này.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const batch = detail.data;
  const items: Item[] = detail.data.items ?? [];
  const invitations: InvitationRow[] = invResp?.data ?? [];
  const submittedCount = invitations.filter((i) => i.status === 'submitted').length;
  const st = BATCH_STATUS[batch.status] ?? BATCH_STATUS.draft;

  // Multi-round (Đợt-2). Columns may be absent until migration runs → default sensibly.
  const currentRound: number = Number(batch.current_round ?? 1) || 1;
  const maxRounds: number = Number(batch.max_rounds ?? 1) || 1;
  const canOpenRound = currentRound < maxRounds
    && ['published', 'evaluating', 'awarded'].includes(batch.status);
  // Vendors carried into the next round (must have a current-round invitation).
  const roundVendors = invitations.filter((i) => i.round_number === currentRound);

  const tabs: Array<{ k: DetailTab; label: string; icon: any; count: number }> = [
    { k: 'items', label: 'Mã linh kiện', icon: Package, count: items.length },
    { k: 'invitations', label: 'NCC được mời', icon: Mail, count: invitations.length },
    { k: 'matrix', label: 'So sánh & chốt', icon: Grid3x3, count: submittedCount },
    { k: 'contracts', label: 'Hợp đồng', icon: FileSignature, count: contracts.length },
    { k: 'qa', label: 'Hỏi đáp', icon: MessageCircle, count: 0 },
    { k: 'audit', label: 'Nhật ký', icon: History, count: 0 },
  ];

  // ── Response funnel (current-round invitations) — drives StatStrip + rail. ──
  const invitedCount = invitations.length;
  // "Thiếu" = invited/viewed (not yet submitted, not declined) NCC.
  const missingCount = invitations.filter((i) => i.status === 'invited' || i.status === 'viewed').length;
  const dlCountdown = deadlineCountdown(batch.bid_deadline);

  const statItems: StatChip[] = [
    { label: 'Mã hàng', value: items.length, onClick: () => setTab('items') },
    { divider: true, label: 'NCC mời', value: invitedCount, tone: 'slate', onClick: () => setTab('invitations') },
    { label: 'Đã báo giá', value: <>{submittedCount}<span className="text-slate-400 font-normal">/{invitedCount}</span></>, tone: 'emerald', onClick: () => setTab('matrix') },
    { label: 'Thiếu', value: missingCount, tone: 'rose', onClick: () => setTab('invitations') },
    { divider: true, label: 'Cách chốt', value: batch.award_mode === 'per_batch' ? 'Toàn phiên' : 'Theo mã' },
    ...(dlCountdown && !dlCountdown.past
      ? [{
          alignEnd: true as const,
          divider: true as const,
          label: 'Tới hạn',
          value: dlCountdown.big,
          tone: dlCountdown.tone,
          emphasizeValue: true,
          pulse: dlCountdown.tone === 'amber' || dlCountdown.tone === 'rose',
          onClick: () => setShowDeadline(true),
          title: `Hạn báo giá: ${fmtDateTimeVN(batch.bid_deadline)} (bấm để sửa)`,
        } as StatChip]
      : []),
  ];

  return (
    <div className={cn(SHELL.page, '-m-6')}>
      {/* (1) Sticky top chrome — PageShellHeader + flush brand refetch bar */}
      <PageShellHeader
        isFetching={detailQ.isFetching}
        leading={
          <button onClick={() => router.push('/vendor-bidding')} aria-label="Quay lại danh sách"
            className={cn(BUTTON.icon, 'shrink-0')}>
            <ArrowLeft className="h-5 w-5" />
          </button>
        }
        title={
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="truncate">{batch.title}</span>
          </span>
        }
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <span className={TYPE.code}>{batch.batch_code}</span>
            <StatusPill label={st.vi} tone={st.tone} />
            {maxRounds > 1 && (
              <StatusPill
                tone="amber"
                label={<span className="inline-flex items-center gap-1"><RotateCcw className="h-3 w-3" /> Vòng {currentRound}/{maxRounds}</span>}
              />
            )}
            <DeadlineChip iso={batch.bid_deadline} onEdit={() => setShowDeadline(true)} />
          </span>
        }
        actions={
          <HeaderActions
            status={batch.status}
            itemsCount={items.length}
            publishing={publishing}
            transitioning={transitioning}
            reminding={reminding}
            canOpenRound={canOpenRound}
            nextRound={currentRound + 1}
            approvalRequired={approvalRequired}
            canApprove={canApprove}
            submittingApproval={submittingApproval}
            approving={approving}
            onAddItems={() => setShowAddItems(true)}
            onPublish={handlePublish}
            onSubmitForApproval={handleSubmitForApproval}
            onApprove={handleApprove}
            onReject={() => setShowReject(true)}
            onEvaluating={handleEvaluating}
            onOpenRound={() => setShowOpenRound(true)}
            onInvite={() => setShowInvite(true)}
            onRemind={handleRemind}
            onEditDeadline={() => setShowDeadline(true)}
            onEditInfo={() => setShowAmend(true)}
          />
        }
      />

      {/* (2) StatStrip — thin dense one-line summary (replaces the 4-KPI hero). */}
      <StatStrip sticky items={statItems} />

      {/* P7 — rejection notice: phiên bị trả lại nội bộ quay về 'draft' nhưng
          giữ lý do để admin sửa lại trước khi gửi duyệt / công bố lại. */}
      {batch.status === 'draft' && batch.approval_rejection_reason && (
        <div className={cn('mx-4 mt-3 flex items-start gap-3 px-4 py-3 text-sm', RADIUS.container, BADGE.rose.bg, BADGE.rose.text, BADGE.rose.ring)}>
          <CornerUpLeft className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Phiên bị trả lại — cần chỉnh sửa</p>
            <p className="mt-0.5 text-rose-700/90">Lý do: {batch.approval_rejection_reason}</p>
          </div>
        </div>
      )}

      {/* Đợt 3 — cổng tài chính (maker-checker): award đang TREO chờ người-thứ-hai
          duyệt. Banner + nút Duyệt/Từ chối hiện cho _WRITE_ROLES (admin/manager).
          Nút "Duyệt" ẩn với CHÍNH proposer (SoD), trừ khi break-glass bật. */}
      {batch.award_status === 'proposed' && (
        <div className={cn('mx-4 mt-3 flex flex-wrap items-start gap-3 px-4 py-3 text-sm', RADIUS.container, BADGE.amber.bg, BADGE.amber.text, BADGE.amber.ring)}>
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">⏳ Chờ duyệt chốt thầu</p>
            <p className="mt-0.5 text-amber-700/90">
              Do {batch.award_proposed_by ?? '—'} đề xuất. Cần người thứ hai duyệt trước khi sinh công nợ.
            </p>
          </div>
          {canApprove && (
            <div className="flex shrink-0 items-center gap-2">
              {/* SoD: ẩn nút Duyệt với chính proposer, TRỪ KHI break-glass bật. */}
              {(String(user?.id ?? '') !== String(batch.award_proposed_by ?? '') || awardBreakglass) && (
                <button onClick={handleApproveAward} disabled={approvingAward}
                  className={cn(BUTTON.primary, 'text-xs disabled:opacity-50')}>
                  {approvingAward ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Duyệt chốt thầu
                </button>
              )}
              <button onClick={() => setShowRejectAward(true)}
                className={cn(BUTTON.secondary, 'text-xs')}>
                <CornerUpLeft className="h-3.5 w-3.5" /> Từ chối
              </button>
            </div>
          )}
        </div>
      )}

      {/* (3) Mission-control grid: [center 1fr | tracking rail 300px].
          Below xl the rail collapses (stacks under the center). The CENTER
          column owns the CockpitTabs + active tab content; the RIGHT rail is
          PERSISTENT (never tab-switched). */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px]">
        {/* ── CENTER: tabs switch ONLY this pane ── */}
        <section className="min-w-0 flex flex-col xl:border-r xl:border-slate-200">
          {/* center-only tab bar — sticky just below the StatStrip */}
          <div className="sticky top-[100px] z-10 flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur ring-1 ring-slate-200/70">
            <CockpitTabs<DetailTab>
              layoutGroup="vb-detail-tabs"
              value={tab}
              onChange={setTab}
              tabs={tabs.map((t) => {
                const Icon = t.icon;
                return { id: t.k, label: t.label, count: t.count, icon: <Icon className="h-4 w-4" /> };
              })}
            />
          </div>

          <div className="flex-1 min-w-0 px-4 py-4 space-y-4">
            {tab === 'items' && <ItemsTable items={items} batchId={batchId} batchStatus={batch.status} />}
            {tab === 'invitations' && <InvitationsTable invitations={invitations} sealed={invResp?.sealed} />}
            {tab === 'matrix' && (
              <QuoteMatrix
                batchId={batchId}
                batchStatus={batch.status}
                awardMode={batch.award_mode === 'per_batch' ? 'per_batch' : 'per_item'}
                currentRound={currentRound}
              />
            )}
            {tab === 'contracts' && (
              <ContractsPanel
                batchId={batchId}
                batchStatus={batch.status}
                contracts={contracts}
              />
            )}
            {tab === 'qa' && <QAPanel batchId={batchId} />}
            {tab === 'audit' && <AuditTimeline batchId={batchId} />}
          </div>
        </section>

        {/* ── RIGHT: persistent tracking rail (collapses below xl) ── */}
        <BatchTrackingRail
          status={batch.status}
          maxRounds={maxRounds}
          currentRound={currentRound}
          deadlineIso={batch.bid_deadline}
          itemsCount={items.length}
          invitations={invitations}
          submittedCount={submittedCount}
          reminding={reminding}
          approvalRequired={approvalRequired}
          batchId={batchId}
          rankHintEnabled={!!batch.rank_hint_enabled}
          onRemind={handleRemind}
          onEditDeadline={() => setShowDeadline(true)}
          onJump={setTab}
        />
      </div>

      {showAddItems && <AddItemsModal batchId={batchId} onClose={() => setShowAddItems(false)} />}
      {showInvite && <InviteVendorsModal batchId={batchId} onClose={() => setShowInvite(false)} />}
      {showOpenRound && (
        <OpenRoundModal
          batchId={batchId}
          nextRound={currentRound + 1}
          maxRounds={maxRounds}
          vendors={roundVendors}
          onClose={() => setShowOpenRound(false)}
        />
      )}
      {showDeadline && (
        <DeadlineModal
          batchId={batchId}
          currentRound={currentRound}
          initial={batch.bid_deadline}
          onClose={() => setShowDeadline(false)}
        />
      )}
      {showAmend && (
        <AmendModal
          batchId={batchId}
          initial={{ title: batch.title, description: batch.description ?? null, notes_internal: batch.notes_internal ?? null }}
          onClose={() => setShowAmend(false)}
        />
      )}
      {showReject && (
        <RejectReasonModal
          onSubmit={handleRejectInternal}
          onClose={() => setShowReject(false)}
        />
      )}
      {/* Đợt 3 — từ chối đề xuất chốt thầu. Tái dùng RejectReasonModal (DRY). */}
      {showRejectAward && (
        <RejectReasonModal
          title="Từ chối chốt thầu"
          intro="Đợt sẽ quay lại trạng thái xét. Lý do được lưu vào nhật ký phục vụ hậu kiểm."
          submitLabel="Từ chối"
          onSubmit={handleRejectAward}
          onClose={() => setShowRejectAward(false)}
        />
      )}
    </div>
  );
}

// ─── P7 — Reject-reason modal (trả lại phiên với lý do bắt buộc) ──────────
// Đợt 3: dùng chung cho cả "trả lại phiên" (reject-internal) và "từ chối chốt
// thầu" (reject-award) — title/intro/submitLabel tuỳ biến, default = P7 cũ.
function RejectReasonModal({
  onSubmit, onClose,
  title = 'Trả lại phiên',
  intro = 'Phiên sẽ quay về trạng thái nháp. Lý do được lưu để người tạo chỉnh sửa.',
  submitLabel = 'Trả lại',
}: {
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
  title?: string;
  intro?: string;
  submitLabel?: string;
}) {
  useModalDismiss(onClose);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const r = reason.trim();
    if (!r) { toast.error('Cần nhập lý do'); return; }
    setBusy(true);
    try {
      await onSubmit(r);
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div className={cn(MODAL_PANEL, 'w-full max-w-md')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h2 className="inline-flex items-center gap-2 text-base font-bold text-slate-900">
            <CornerUpLeft className="h-4.5 w-4.5 text-rose-500" /> {title}
          </h2>
          <button onClick={onClose} className={BUTTON.icon} aria-label="Đóng"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-slate-600">{intro}</p>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="Lý do (bắt buộc)…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-400 outline-none resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100">
          <button onClick={onClose} className={cn(HDR_BTN, 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50')}>Huỷ</button>
          <button onClick={submit} disabled={busy || !reason.trim()}
            className={cn(HDR_BTN, 'bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50')}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerUpLeft className="h-4 w-4" />} {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tracking rail (persistent right column — "mission control") ─────────
// NOT tab-switched. Lifecycle stepper + live deadline countdown + invitation
// funnel + vendor quick-list. All data is derived from the SAME queries the
// page already fetches (batch status/round, invitations) — no new fetching.
// Below xl the parent grid hides this; a disclosure renders the same content.

function BatchTrackingRail({
  status, maxRounds, currentRound, deadlineIso, itemsCount,
  invitations, submittedCount, reminding, approvalRequired, batchId, rankHintEnabled,
  onRemind, onEditDeadline, onJump,
}: {
  status: string;
  maxRounds: number;
  currentRound: number;
  deadlineIso: string | null | undefined;
  itemsCount: number;
  invitations: InvitationRow[];
  submittedCount: number;
  reminding: boolean;
  approvalRequired: boolean;
  batchId: number;
  rankHintEnabled: boolean;
  onRemind: () => void;
  onEditDeadline: () => void;
  onJump: (tab: DetailTab) => void;
}) {
  // Re-tick every minute so the big countdown stays live without a refetch.
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // Lifecycle stepper — when the internal-approval gate is ON we expand the
  // pre-publish phase into "Chờ duyệt" + "Đã duyệt" nodes; when OFF the simpler
  // 5-stage funnel (P4) is kept verbatim.
  let steps: RailStep[];
  if (approvalRequired) {
    // Map each status to a position on the 7-node approval funnel.
    const idx = (() => {
      if (status === 'draft' || status === 'rejected_internal') return 0;
      if (status === 'cho_duyet') return 1;
      if (status === 'approved') return 2;
      if (status === 'published') return 3;
      if (status === 'evaluating' || status === 'closed') return 4;
      if (status === 'awarded' || status === 'cancelled') return 5;
      return 6;
    })();
    const st = (i: number): RailStep['state'] => (i < idx ? 'done' : i === idx ? 'active' : 'todo');
    steps = [
      { label: 'Nháp', state: st(0) },
      { label: 'Chờ duyệt', state: st(1) },
      { label: 'Đã duyệt', state: st(2) },
      { label: <>Công bố · mời {invitations.length} NCC</>, state: st(3) },
      { label: maxRounds > 1 ? <>Đang xét giá (vòng {currentRound}/{maxRounds})</> : 'Đang xét giá', state: st(4) },
      { label: 'Trao thầu', state: st(5) },
      { label: 'Hợp đồng → PO → Giao hàng', state: st(6) },
    ];
  } else {
    const stepIdx = (() => {
      if (status === 'draft') return 0;
      if (status === 'published') return 1;
      if (status === 'evaluating' || status === 'closed') return 2;
      if (status === 'awarded') return 3;
      if (status === 'cancelled') return 3;
      return 4;
    })();
    const stepState = (i: number): RailStep['state'] => (i < stepIdx ? 'done' : i === stepIdx ? 'active' : 'todo');
    steps = [
      { label: 'Nháp', state: stepState(0) },
      { label: <>Công bố · mời {invitations.length} NCC</>, state: stepState(1) },
      { label: maxRounds > 1 ? <>Đang xét giá (vòng {currentRound}/{maxRounds})</> : 'Đang xét giá', state: stepState(2) },
      { label: 'Trao thầu', state: stepState(3) },
      { label: 'Hợp đồng → PO → Giao hàng', state: stepState(4) },
    ];
  }

  // Live deadline countdown.
  const dl = deadlineCountdown(deadlineIso);

  // Invitation funnel (current snapshot). "viewed+" counts anyone past invited.
  const invited = invitations.length;
  const viewed = invitations.filter((i) => i.status !== 'invited').length;
  const quoted = invitations.filter((i) => i.status === 'submitted').length;
  const missing = invitations.filter((i) => i.status === 'invited' || i.status === 'viewed').length;
  const canRemind = status === 'published' && missing > 0;

  const content = (
    <>
      {/* lifecycle stepper */}
      <RailCard>
        <RailStepper steps={steps} />
      </RailCard>

      {/* deadline countdown (reuses the P3 DeadlineChip data path) */}
      {deadlineIso ? (
        <RailCard tone={dl?.tone === 'rose' ? 'rose' : dl?.tone === 'amber' ? 'amber' : undefined}>
          <button type="button" onClick={onEditDeadline} className="block w-full text-left">
            <div className={cn('text-[11px]', dl?.past ? 'text-rose-700/80' : dl?.tone === 'amber' ? 'text-amber-700/80' : 'text-slate-500')}>
              {maxRounds > 1 ? `Hạn vòng ${currentRound}` : 'Hạn báo giá'}
            </div>
            <div className={cn('font-display text-2xl font-extrabold tabular-nums leading-tight mt-0.5',
              dl?.past ? 'text-rose-700' : dl?.tone === 'amber' ? 'text-amber-700' : dl?.tone === 'rose' ? 'text-rose-700' : 'text-slate-800')}>
              {dl?.big ?? '—'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{fmtDateTimeVN(deadlineIso)} · tự đóng khi hết hạn</div>
          </button>
        </RailCard>
      ) : (
        <RailCard>
          <button type="button" onClick={onEditDeadline}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-brand-600 transition-colors">
            <Clock className="h-3.5 w-3.5" /> Đặt hạn báo giá
          </button>
        </RailCard>
      )}

      {/* invitation funnel */}
      <RailCard title="Phễu phản hồi NCC">
        <div className="space-y-1.5 text-[12px]">
          <FunnelRow tone="slate" label="Đã mời" value={invited} onClick={() => onJump('invitations')} />
          <FunnelRow tone="sky" label="Đã xem" value={viewed} onClick={() => onJump('invitations')} />
          <FunnelRow tone="emerald" label="Đã báo giá" value={quoted} onClick={() => onJump('matrix')} />
          <FunnelRow tone="rose" label="Chưa báo" value={missing} emphasize={missing > 0} onClick={() => onJump('invitations')} />
        </div>
        {missing > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Gửi link đăng nhập cổng NCC cho {missing} đơn vị chưa báo giá để họ vào báo.
          </p>
        )}
      </RailCard>

      {/* vendor quick-list */}
      <RailCard title="Nhà cung cấp">
        {invitations.length === 0 ? (
          <div className="text-[12px] text-slate-400">Chưa mời NCC nào.</div>
        ) : (
          <ul className="space-y-1.5 text-[12px]">
            {invitations.map((inv) => {
              const s = INV_STATUS[inv.status] ?? INV_STATUS.invited;
              const quotedV = inv.status === 'submitted';
              return (
                <li key={inv.invitation_id} className={cn('flex items-center gap-2', !quotedV && inv.status !== 'viewed' && 'opacity-70')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', BADGE[s.tone].dot)} />
                  <span className="flex-1 truncate text-slate-700" title={inv.company_name}>{inv.company_name}</span>
                  <span className={cn('text-[11px]', quotedV ? 'text-emerald-600' : inv.status === 'declined' ? 'text-rose-500' : 'text-slate-400')}>
                    {quotedV ? '✓' : s.vi}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </RailCard>

      {/* #15 — gợi ý vị thế cạnh tranh cho NCC (band-mờ, mặc định TẮT) */}
      <RankHintCard batchId={batchId} enabled={rankHintEnabled} />
    </>
  );

  return (
    <>
      {/* xl+: persistent rail */}
      <div className="hidden xl:block">
        <TrackingRail title="Theo dõi phiên">{content}</TrackingRail>
      </div>
      {/* below xl: collapsible disclosure so nothing is lost on narrow screens */}
      <details className="xl:hidden group border-t border-slate-200 bg-white">
        <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none text-[12px] font-semibold text-slate-600 marker:content-['']">
          <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
          Theo dõi phiên
          {dl && !dl.past && <span className={cn('ml-2 inline-flex items-center gap-1.5 text-[11px] font-semibold', BADGE[dl.tone].text)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', BADGE[dl.tone].dot)} /> {dl.big}
          </span>}
        </summary>
        <div className="px-3 pb-3 space-y-3">{content}</div>
      </details>
    </>
  );
}

// ─── #15 Rank-hint toggle (rail) ────────────────────────────────
// Cho NCC xem GỢI Ý VỊ THẾ cạnh tranh (band-mờ {dẫn đầu/giữa/cần cải thiện}) SAU
// khi nộp. NHẠY CẢM ⇒ mặc định TẮT (backend default FALSE → endpoint vendor 404).
// Khi bật, NCC KHÔNG bao giờ thấy giá/tên/thứ hạng số đối thủ — chỉ 1 dòng band.
function RankHintCard({ batchId, enabled }: { batchId: number; enabled: boolean }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await api.patch(`/api/v1/procurement/batches/${batchId}/rank-hint`, { enabled: next });
      toast.success(next ? 'Đã bật gợi ý vị thế cho NCC' : 'Đã tắt gợi ý vị thế cho NCC');
      queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <RailCard title="Gợi ý vị thế cho NCC">
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-slate-600 disabled:opacity-50"
        />
        <span className="text-[12px] leading-snug text-slate-600">
          Cho NCC xem gợi ý vị thế cạnh tranh
          <span className="text-slate-400"> (mặc định tắt)</span>
        </span>
      </label>
      <p className="mt-1.5 text-[11px] leading-snug text-amber-600">
        Khi bật, NCC chỉ thấy nhóm dẫn đầu / giữa / cần cải thiện SAU khi nộp —
        không bao giờ thấy giá, tên hay thứ hạng số của đối thủ.
      </p>
    </RailCard>
  );
}

/** One row in the invitation funnel (rail). */
function FunnelRow({ tone, label, value, emphasize, onClick }: {
  tone: BadgeTone; label: ReactNode; value: number; emphasize?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn('w-full flex items-center justify-between rounded px-1 -mx-1 hover:bg-slate-50 transition-colors', DEPTH.focusRing)}>
      <span className="flex items-center gap-1.5 text-slate-600">
        <span className={cn('h-1.5 w-1.5 rounded-full', BADGE[tone].dot)} />{label}
      </span>
      <b className={cn('tabular-nums', emphasize && tone === 'rose' ? 'text-rose-600' : 'text-slate-800')}>{value}</b>
    </button>
  );
}

// ─── Deadline countdown chip (header) ───────────────────────────
// Clock + StatusPill, tone slides slate→amber→rose as the deadline nears;
// shows "Quá hạn" once past. Click to edit (admin only path; backend guards).

function DeadlineChip({ iso, onEdit }: { iso: string | null | undefined; onEdit: () => void }) {
  // Re-tick every minute so the countdown stays live without a refetch.
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const chip = deadlineChip(iso);
  // Nhãn D-N giống BQMS (thay "Còn N ngày", bỏ icon đồng hồ) — KHÔNG lặp với badge
  // ngày bên cạnh; tone urgency (rose/amber/slate) + bấm để sửa vẫn giữ.
  const dd = ddayMeta(iso);
  if (!chip) {
    return (
      <button type="button" onClick={onEdit}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-brand-600 transition-colors">
        <Clock className="h-3 w-3" /> Đặt hạn
      </button>
    );
  }
  return (
    <button type="button" onClick={onEdit} title={`Hạn báo giá: ${fmtDateTimeVN(iso)} (bấm để sửa)`}
      className="inline-flex items-center">
      <StatusPill
        tone={chip.tone}
        pulse={chip.tone === 'rose' && !chip.past}
        label={<span className="tabular-nums font-bold">{dd ? dd.label : chip.label}</span>}
      />
    </button>
  );
}

// ─── Deadline editor modal (set/update bid_deadline) ────────────

function DeadlineModal({ batchId, currentRound, initial, onClose }: {
  batchId: number; currentRound: number; initial: string | null | undefined; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const seed = splitDeadlineISO(initial);
  const [date, setDate] = useState(seed.date);
  const [time, setTime] = useState(seed.time);
  const [saving, setSaving] = useState(false);
  useModalDismiss(onClose);

  const save = async (clear: boolean) => {
    setSaving(true);
    try {
      await api.patch(`/api/v1/procurement/batches/${batchId}/deadline`, {
        bid_deadline: clear ? null : composeDeadlineISO(date, time),
      });
      toast.success(clear ? 'Đã gỡ hạn báo giá' : 'Đã cập nhật hạn báo giá');
      queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
      onClose();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="deadline-title"
        className={cn(MODAL_PANEL, 'w-full max-w-md')} onClick={(e) => e.stopPropagation()}>
        <div className={MODAL_HEADER}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <Clock className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="deadline-title" className="text-base font-bold text-slate-900">Hạn báo giá</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Vòng {currentRound} · giờ Việt Nam (+07:00)</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={MODAL_CLOSE}><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Clock className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className={cn(INPUT_CLS, 'pl-8')} />
            </div>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date}
              className="w-28 px-2 py-2 ring-1 ring-slate-200 rounded-lg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition-all disabled:opacity-50" />
          </div>
          <p className="text-[11px] text-slate-500">
            Sau hạn này, hệ thống tự chuyển phiên sang "Đang xét" và đánh dấu NCC chưa báo giá là trễ hạn.
          </p>
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <button onClick={() => save(true)} disabled={saving || !initial}
            className="px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-40">
            Gỡ hạn
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">Huỷ</button>
            <button onClick={() => save(false)} disabled={saving || !date}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Lưu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Đợt 2b [AM] — Amend modal (sửa thông tin phiên sau publish) ──────────
// Chỉ sửa TEXT (title/description/notes_internal) — KHÔNG đụng item/giá/state.
// PATCH /batches/{id}; BE ghi audit 'amend' + broadcast notif "có cập nhật" tới
// NCC đã mời (KHÔNG kèm nội dung). notes_internal là ghi chú NỘI BỘ, không ra NCC.
function AmendModal({ batchId, initial, onClose }: {
  batchId: number;
  initial: { title: string; description: string | null; notes_internal: string | null };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? '');
  const [notes, setNotes] = useState(initial.notes_internal ?? '');
  const [saving, setSaving] = useState(false);
  useModalDismiss(onClose);

  const save = async () => {
    const t = title.trim();
    if (!t) { toast.error('Tiêu đề không được để trống'); return; }
    setSaving(true);
    try {
      const res = await api.patch<{ message?: string; broadcast_to?: number }>(
        `/api/v1/procurement/batches/${batchId}`,
        { title: t, description: description.trim() || null, notes_internal: notes.trim() || null },
      );
      const n = res?.broadcast_to ?? 0;
      toast.success(n > 0 ? `Đã cập nhật & báo ${n} NCC.` : (res?.message ?? 'Đã cập nhật thông tin phiên.'));
      queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
      onClose();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="amend-title"
        className={cn(MODAL_PANEL, 'w-full max-w-lg')} onClick={(e) => e.stopPropagation()}>
        <div className={MODAL_HEADER}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <PencilLine className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="amend-title" className="text-base font-bold text-slate-900">Sửa thông tin phiên</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Chỉ sửa tiêu đề / mô tả / ghi chú — không đổi mã linh kiện hay giá.</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={MODAL_CLOSE}><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tiêu đề *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Linh kiện CNC tháng 6/2026" className={INPUT_CLS} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mô tả</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả phiên — nguồn từ BQMS, yêu cầu..."
              className={cn(INPUT_CLS, 'resize-none')} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Ghi chú nội bộ <span className="font-normal text-slate-400">(KHÔNG gửi cho NCC)</span>
            </label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú riêng cho team mua hàng…"
              className={cn(INPUT_CLS, 'resize-none')} />
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
            <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
            NCC đã mời sẽ nhận thông báo "có cập nhật thông tin phiên" — <b>không kèm nội dung thay đổi</b>.
          </p>
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">Huỷ</button>
          <button onClick={save} disabled={saving || !title.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Lưu
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Header action cluster ──────────────────────────────────────
// Wraps on narrow widths (flex-wrap justify-end). When 4+ buttons would show,
// secondary actions (Thêm mã / Mở vòng) collapse into a single "Thao tác" menu so
// the primary (Mời NCC) + main lifecycle action (Publish/Xét giá) stay one-click.

const HDR_BTN = cn(BUTTON.base, 'h-9 px-3');

function HeaderActions({
  status, itemsCount, publishing, transitioning, reminding, canOpenRound, nextRound,
  approvalRequired, canApprove, submittingApproval, approving,
  onAddItems, onPublish, onSubmitForApproval, onApprove, onReject,
  onEvaluating, onOpenRound, onInvite, onRemind, onEditDeadline, onEditInfo,
}: {
  status: string;
  itemsCount: number;
  publishing: boolean;
  transitioning: boolean;
  reminding: boolean;
  canOpenRound: boolean;
  nextRound: number;
  approvalRequired: boolean;
  canApprove: boolean;
  submittingApproval: boolean;
  approving: boolean;
  onAddItems: () => void;
  onPublish: () => void;
  onSubmitForApproval: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEvaluating: () => void;
  onOpenRound: () => void;
  onInvite: () => void;
  onRemind: () => void;
  onEditDeadline: () => void;
  onEditInfo: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const noItems = itemsCount === 0;

  // P7 — internal approval gate buttons.
  //   draft + gate ON  → "Gửi duyệt" (submit-for-approval).
  //   draft + gate OFF → "Công bố" (publish straight, unchanged owner UX).
  //   cho_duyet         → "Chờ duyệt" pill + (admin/manager) "Duyệt" / "Trả lại".
  //   approved          → "Công bố".
  const isWaiting = status === 'cho_duyet';
  const showSubmitForApproval = status === 'draft' && approvalRequired;
  const showPublish = (status === 'draft' && !approvalRequired) || status === 'approved';

  // Which conditional actions are live (preserves the exact original render conditions).
  const showAddItems = status === 'draft';
  const showEvaluating = status === 'published';
  const showOpenRoundBtn = canOpenRound;
  // Thang 30/06: bỏ nút "Nhắc NCC" — hệ thống không gửi email mời/nhắc nữa,
  // admin tự gửi link đăng nhập cho NCC.
  const showRemind = false;
  const showDeadlineItem = status === 'draft' || status === 'published';
  // Đợt 2b [AM] — "Sửa thông tin phiên" (title/desc/notes) ở draft/published.
  const showEditInfo = status === 'draft' || status === 'published';
  // "Mời NCC" renders except while waiting for internal approval (cho_duyet).
  const showInviteBtn = !isWaiting;
  // Count would-be buttons to decide on overflow.
  const total = (showAddItems ? 1 : 0) + (showPublish ? 1 : 0) + (showSubmitForApproval ? 1 : 0)
    + (showEvaluating ? 1 : 0) + (showOpenRoundBtn ? 1 : 0) + (showRemind ? 1 : 0) + (showInviteBtn ? 1 : 0);
  // Secondary (collapsible) = Thêm mã + Mở vòng + Nhắc NCC + Đặt hạn + Sửa thông tin.
  // "Sửa thông tin" luôn coi là secondary → ưu tiên gom vào menu khi đông.
  const collapse = total >= 4;
  const secondaryInMenu = collapse && (showAddItems || showOpenRoundBtn || showRemind || showDeadlineItem || showEditInfo);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
      {showAddItems && !secondaryInMenu && (
        <button onClick={onAddItems} className={cn(HDR_BTN, 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300')}>
          <Plus className="h-4 w-4" /> Thêm mã
        </button>
      )}
      {showSubmitForApproval && (
        <button onClick={onSubmitForApproval} disabled={submittingApproval || noItems}
          title={noItems ? 'Cần ít nhất 1 mã linh kiện' : 'Gửi phiên đi duyệt nội bộ'}
          className={cn(HDR_BTN, 'bg-amber-500 text-white hover:bg-amber-600')}>
          {submittingApproval ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Gửi duyệt
        </button>
      )}
      {isWaiting && (
        <span className={cn(HDR_BTN, 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 cursor-default')}>
          <Hourglass className="h-4 w-4" /> Chờ duyệt
        </span>
      )}
      {isWaiting && canApprove && (
        <>
          <button onClick={onApprove} disabled={approving}
            title="Duyệt nội bộ — cho phép công bố"
            className={cn(HDR_BTN, 'bg-emerald-600 text-white hover:bg-emerald-700')}>
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Duyệt
          </button>
          <button onClick={onReject}
            title="Trả lại phiên cho người tạo (kèm lý do)"
            className={cn(HDR_BTN, 'bg-white text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50')}>
            <CornerUpLeft className="h-4 w-4" /> Trả lại
          </button>
        </>
      )}
      {showPublish && (
        <button onClick={onPublish} disabled={publishing || noItems}
          title={noItems ? 'Cần ít nhất 1 mã linh kiện' : ''}
          className={cn(HDR_BTN, 'bg-emerald-600 text-white hover:bg-emerald-700')}>
          {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Công bố
        </button>
      )}
      {showEvaluating && (
        <button onClick={onEvaluating} disabled={transitioning}
          title="Chuyển sang giai đoạn xét giá để chốt thầu"
          className={cn(HDR_BTN, 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200 hover:bg-sky-100')}>
          {transitioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Grid3x3 className="h-4 w-4" />} Xét giá
        </button>
      )}
      {showOpenRoundBtn && !secondaryInMenu && (
        <button onClick={onOpenRound} title={`Mở vòng ${nextRound} (đấu giá ngược)`}
          className={cn(HDR_BTN, 'bg-amber-500 text-white hover:bg-amber-600')}>
          <ArrowUpCircle className="h-4 w-4" /> Mở vòng {nextRound}
        </button>
      )}
      {showRemind && !secondaryInMenu && (
        <button onClick={onRemind} disabled={reminding}
          title="Gửi lại email cho NCC chưa báo giá"
          className={cn(HDR_BTN, 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300')}>
          {reminding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Nhắc NCC chưa báo
        </button>
      )}
      {showEditInfo && !secondaryInMenu && (
        <button onClick={onEditInfo}
          title="Sửa tiêu đề / mô tả / ghi chú nội bộ của phiên — NCC sẽ nhận thông báo có cập nhật"
          className={cn(HDR_BTN, 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300')}>
          <PencilLine className="h-4 w-4" /> Sửa thông tin
        </button>
      )}
      {showInviteBtn && (
        <button onClick={onInvite} disabled={noItems}
          title={noItems ? 'Cần ít nhất 1 mã linh kiện' : ''}
          className={cn(HDR_BTN, 'px-4 bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800')}>
          <Send className="h-4 w-4" /> Mời NCC
        </button>
      )}

      {secondaryInMenu && (
        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Thao tác khác"
            aria-haspopup="menu" aria-expanded={menuOpen}
            className={cn(HDR_BTN, 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300')}>
            <MoreHorizontal className="h-4 w-4" /> Thao tác <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div role="menu"
              className={cn('absolute right-0 top-full mt-1.5 z-40 w-52 bg-white p-1.5', RADIUS.container, ELEVATION.container, ELEVATION.floating)}>
              {showAddItems && (
                <button role="menuitem" onClick={() => { setMenuOpen(false); onAddItems(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors">
                  <Plus className="h-4 w-4 text-slate-500" /> Thêm mã linh kiện
                </button>
              )}
              {showOpenRoundBtn && (
                <button role="menuitem" onClick={() => { setMenuOpen(false); onOpenRound(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors">
                  <ArrowUpCircle className="h-4 w-4 text-amber-500" /> Mở vòng {nextRound}
                </button>
              )}
              {showRemind && (
                <button role="menuitem" onClick={() => { setMenuOpen(false); onRemind(); }} disabled={reminding}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50">
                  <Mail className="h-4 w-4 text-slate-500" /> Nhắc NCC chưa báo
                </button>
              )}
              {showDeadlineItem && (
                <button role="menuitem" onClick={() => { setMenuOpen(false); onEditDeadline(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors">
                  <Clock className="h-4 w-4 text-slate-500" /> Đặt / sửa hạn báo giá
                </button>
              )}
              {showEditInfo && (
                <button role="menuitem" onClick={() => { setMenuOpen(false); onEditInfo(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors">
                  <PencilLine className="h-4 w-4 text-slate-500" /> Sửa thông tin phiên
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Items Table ────────────────────────────────────────────────

function ItemsTable({ items, batchId, batchStatus }: { items: Item[]; batchId: number; batchStatus: string }) {
  const queryClient = useQueryClient();
  // Drawings are editable only while the batch is being prepared / is live.
  // Once awarded/closed/cancelled the cell is view-only (can still open existing).
  // Sửa inline khi đợt CHƯA chốt/đóng/huỷ (Thang 2026-06-29). Cột "Bản vẽ" đã GỠ
  // (cột Ảnh + "File mã" thay thế) → canEdit nay dùng cho sửa thông số mã hàng.
  const canEdit = !['awarded', 'closed', 'cancelled'].includes(batchStatus);

  const patchItem = useMutation({
    mutationFn: ({ itemId, field, value }: { itemId: number; field: string; value: string | number | null }) =>
      api.patch(`/api/v1/procurement/batches/${batchId}/items/${itemId}`, { [field]: value }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] }); toast.success('Đã lưu'); },
    onError: (e: any) => toast.error(e?.detail ?? 'Lưu không thành công'),
  });
  const saveField = (itemId: number, field: string) => (value: string | number | null) =>
    patchItem.mutate({ itemId, field, value });

  // Đợt 10 #14 — "Lịch sử mã hàng" popover (which vendors quoted/won this code).
  const [histItem, setHistItem] = useState<{ item_code: string | null; bqms_code: string | null } | null>(null);

  if (items.length === 0) {
    return (
      <EmptyState icon={Package} title="Chưa có mã linh kiện."
        hint='Bấm "Thêm mã" để import từ BQMS hoặc nhập tay.' />
    );
  }
  return (
    <>
    <DataPanel flush>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[760px]">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={cn(TYPE.th, 'text-center px-3 py-2.5 w-12')}>#</th>
              <th className={cn(TYPE.th, 'text-center px-2 py-2.5 w-20')}>Ảnh</th>
              <th className={cn(TYPE.th, 'text-left px-3 py-2.5')}>Mã / BQMS</th>
              <th className={cn(TYPE.th, 'text-left px-3 py-2.5 w-24')}>Nguồn</th>
              <th className={cn(TYPE.th, 'text-left px-3 py-2.5')}>Tên / Specification</th>
              <th className={cn(TYPE.th, 'text-left px-3 py-2.5')}>Hãng · Model · Material</th>
              <th className={cn(TYPE.th, 'text-right px-3 py-2.5')}>SL</th>
              <th className={cn(TYPE.th, 'text-right px-3 py-2.5')}>Target</th>
            </tr>
          </thead>
          <tbody className={cn(DEPTH.divider)}>
            {items.map((it) => {
              return (
              <tr key={it.id} className={cn(DEPTH.zebra, DEPTH.rowHover, 'transition-colors')}>
                <td className="px-3 py-2.5 text-center font-mono text-slate-500 text-xs tabular-nums">{it.item_no}</td>
                <td className="px-2 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                  <BqmsImageThumb bqmsCode={it.bqms_code} rfqNumber={null} />
                </td>
                <td className={cn('px-3 py-2.5', TYPE.code)}>
                  {it.item_code || it.bqms_code ? (
                    <button
                      type="button"
                      onClick={() => setHistItem({ item_code: it.item_code ?? null, bqms_code: it.bqms_code ?? null })}
                      className="inline-flex items-center gap-1 hover:text-brand-700 hover:underline"
                      title="Xem lịch sử báo giá / trúng thầu của mã này"
                    >
                      {it.item_code ?? it.bqms_code}
                      <History className="h-3 w-3 text-slate-400" />
                    </button>
                  ) : (
                    '—'
                  )}
                  {it.source_bqms_rfq_number && (
                    <div className="mt-0.5">
                      <BqmsCodeFilesButton rfqNumber={it.source_bqms_rfq_number} bqmsCode={it.bqms_code} itemId={it.id} compact />
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5"><SourcePill kind={it.source_kind} /></td>
                <td className={cn('px-3 py-2.5', TYPE.tableText, 'max-w-[360px]')}>
                  {(it.product_name || canEdit) && (
                    <EditableCell value={it.product_name ?? null} canEdit={canEdit} placeholder="Tên sản phẩm"
                      onSave={saveField(it.id, 'product_name')}
                      className="block w-full max-w-[340px] truncate font-medium text-slate-800" />
                  )}
                  <EditableCell value={it.specification} canEdit={canEdit} placeholder="Quy cách"
                    onSave={saveField(it.id, 'specification')}
                    className={cn('block w-full max-w-[340px] truncate', it.product_name ? 'text-xs text-slate-500' : '')} />
                </td>
                <td className="px-3 py-2.5 text-slate-600 text-xs">
                  <div className="space-y-0.5">
                    <EditableCell value={it.maker ?? null} canEdit={canEdit} placeholder="Hãng"
                      onSave={saveField(it.id, 'maker')} className="block w-full max-w-[200px] truncate" />
                    <EditableCell value={it.model ?? null} canEdit={canEdit} placeholder="Model"
                      onSave={saveField(it.id, 'model')} className="block w-full max-w-[200px] truncate text-slate-400" />
                    <EditableCell value={it.required_material ?? null} canEdit={canEdit} placeholder="Vật liệu"
                      onSave={saveField(it.id, 'required_material')} className="block w-full max-w-[200px] truncate text-slate-500" />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[13px] text-slate-700">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <EditableCell value={it.quantity} type="number" canEdit={canEdit} align="right"
                      display={fmtMoney(it.quantity)} onSave={saveField(it.id, 'quantity')} className="text-right" />
                    <EditableCell value={it.unit} canEdit={canEdit} placeholder="ĐVT"
                      onSave={saveField(it.id, 'unit')} className="text-[11px] text-slate-400" />
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-slate-600">
                  <EditableCell value={it.target_price ?? null} type="number" canEdit={canEdit} align="right" placeholder="Giá MT"
                    display={it.target_price != null ? fmtMoney(it.target_price) : undefined}
                    onSave={saveField(it.id, 'target_price')} className="text-right" />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DataPanel>
    {histItem != null && (
      <ItemHistoryPopover item={histItem} onClose={() => setHistItem(null)} />
    )}
    </>
  );
}

// ─── Lịch sử mã hàng (Đợt 10 #14) — ai từng báo giá + ai trúng (cross-batch) ──
// ADMIN-side: buyer ĐƯỢC xem tên đối thủ + giá. PER-CURRENCY (mỗi dòng tiền tệ
// riêng). KHÔNG có target_price (backend cấm lộ). Centered MODAL_OVERLAY.

function ItemHistoryPopover({
  item,
  onClose,
}: {
  item: { item_code: string | null; bqms_code: string | null };
  onClose: () => void;
}) {
  useModalDismiss(onClose);
  const qs = new URLSearchParams();
  if (item.item_code) qs.set('item_code', item.item_code);
  if (item.bqms_code) qs.set('bqms_code', item.bqms_code);

  const { data, isLoading, isError } = useQuery<ItemHistoryResp>({
    queryKey: ['item-history', item.item_code, item.bqms_code],
    queryFn: () => api.get<ItemHistoryResp>(`/api/v1/procurement/items/history?${qs.toString()}`),
    retry: false,
  });
  const d = data?.data;
  const label = item.item_code ?? item.bqms_code ?? '—';

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div
        className={cn(MODAL_PANEL, 'flex max-h-[85vh] w-full max-w-2xl flex-col')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Lịch sử mã hàng"
      >
        <div className={MODAL_HEADER}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600">
              <History className="h-4.5 w-4.5 text-white" />
            </div>
            <div className="min-w-0">
              <div className={cn(TYPE.eyebrow, 'text-brand-600')}>Lịch sử mã hàng</div>
              <h2 className={cn(TYPE.h2, 'truncate font-mono')} title={label}>{label}</h2>
            </div>
          </div>
          <button onClick={onClose} className={MODAL_CLOSE} aria-label="Đóng">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 p-5 space-y-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
              <span className="text-sm text-slate-500">Đang tải lịch sử…</span>
            </div>
          ) : isError || !d ? (
            <div className="py-12 text-center text-sm text-slate-500">
              <AlertCircle className="mx-auto mb-2 h-8 w-8 text-amber-400" />
              Không lấy được lịch sử mã hàng này.
            </div>
          ) : (
            <>
              {/* AI ĐÃ TRÚNG */}
              <DataPanel flush title="Đã trúng" eyebrow={`${d.awards.length} lần (active)`}>
                {d.awards.length === 0 ? (
                  <div className="py-8 text-center text-[12px] text-slate-400">Chưa có ai trúng mã này.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className={cn('border-b border-slate-200 bg-slate-50/60', TYPE.th)}>
                        <tr>
                          <th className="px-3 py-2 text-left">NCC</th>
                          <th className="px-3 py-2 text-left">Phiên</th>
                          <th className="px-3 py-2 text-right">Đơn giá</th>
                          <th className="px-3 py-2 text-left">Ngày</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {d.awards.map((a, i) => (
                          <tr key={`${a.vendor_id}-${a.batch_id}-${i}`} className={cn('transition-colors', DEPTH.rowHover)}>
                            <td className="px-3 py-2 text-[13px] font-medium text-slate-800">{a.company_name ?? '—'}</td>
                            <td className={cn('px-3 py-2', TYPE.code)}>{a.batch_code ?? '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[13px] font-medium tabular-nums text-slate-900">
                              {fmtMoney(a.awarded_price)}
                              {a.currency && <span className={TYPE.currencySuffix}>{a.currency}</span>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-500">{fmtDateVN(a.awarded_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </DataPanel>

              {/* AI ĐÃ BÁO GIÁ */}
              <DataPanel flush title="Đã báo giá" eyebrow={`${d.quotes.length} lần (vòng mới nhất)`}>
                {d.quotes.length === 0 ? (
                  <div className="py-8 text-center text-[12px] text-slate-400">Chưa có NCC nào báo giá mã này.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className={cn('border-b border-slate-200 bg-slate-50/60', TYPE.th)}>
                        <tr>
                          <th className="px-3 py-2 text-left">NCC</th>
                          <th className="px-3 py-2 text-left">Phiên</th>
                          <th className="px-3 py-2 text-right">Đơn giá</th>
                          <th className="px-3 py-2 text-right">Lead</th>
                          <th className="px-3 py-2 text-left">Ngày</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {d.quotes.map((q, i) => (
                          <tr key={`${q.vendor_id}-${q.batch_id}-${i}`} className={cn('transition-colors', DEPTH.rowHover)}>
                            <td className="px-3 py-2 text-[13px] font-medium text-slate-800">{q.company_name ?? '—'}</td>
                            <td className={cn('px-3 py-2', TYPE.code)}>{q.batch_code ?? '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[13px] tabular-nums text-slate-900">
                              {fmtMoney(q.unit_price)}
                              {q.currency && <span className={TYPE.currencySuffix}>{q.currency}</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-slate-600">
                              {q.lead_time_days != null ? `${q.lead_time_days}d` : '—'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-500">{fmtDateVN(q.submitted_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </DataPanel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Drawing cell (P5) — 'Có' button (view) or 'Tải lên' dropzone (upload) ──

const _DRAWING_ACCEPT = '.pdf,.png,.jpg,.jpeg,.dwg,application/pdf,image/png,image/jpeg';

function DrawingCell({
  item, batchId, hasDrawing, canEdit, onOpen, onUploaded,
}: {
  item: Item;
  batchId: number;
  hasDrawing: boolean;
  canEdit: boolean;
  onOpen: () => void;
  onUploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const doUpload = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!/\.(pdf|png|jpe?g|dwg)$/.test(lower)) {
      toast.error('Chỉ chấp nhận PDF, PNG, JPG hoặc DWG');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File quá lớn (tối đa 20MB)');
      return;
    }
    setUploading(true);
    try {
      const token = typeof window !== 'undefined' ? (localStorage.getItem('access_token') ?? '') : '';
      const base = process.env.NEXT_PUBLIC_API_URL || '';
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(
        `${base}/api/v1/procurement/batches/${batchId}/items/${item.id}/drawing`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          credentials: 'include',
          body: fd,
        },
      );
      if (!res.ok) {
        let msg = `Lỗi tải lên (${res.status})`;
        try { const j = await res.json(); msg = j?.detail ?? msg; } catch { /* ignore */ }
        toast.error(msg);
        return;
      }
      toast.success(`Đã tải bản vẽ cho mã #${item.item_no}`);
      onUploaded();
    } catch (e: any) {
      toast.error(`Lỗi tải lên: ${e?.message ?? 'Unknown'}`);
    } finally {
      setUploading(false);
    }
  };

  // Existing drawing → emerald 'Có' button opening the lightbox.
  if (hasDrawing) {
    return (
      <button type="button" onClick={onOpen} title="Xem bản vẽ"
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100 transition-colors">
        <ImageIcon className="h-3 w-3" /> Có
      </button>
    );
  }

  // No drawing + view-only (awarded/closed) → simple dash, no upload affordance.
  if (!canEdit) {
    return <span className="text-slate-300">—</span>;
  }

  // No drawing + editable → dashed dropzone (drag-drop OR click to pick).
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={_DRAWING_ACCEPT}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); e.target.value = ''; }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void doUpload(f);
        }}
        title="Kéo-thả hoặc bấm để tải bản vẽ (PDF/PNG/JPG/DWG)"
        className={cn(
          'inline-flex items-center gap-1 rounded-lg border border-dashed px-2 py-1 text-[11px] font-medium transition-colors',
          dragOver
            ? 'border-brand-400 bg-brand-50 text-brand-700'
            : 'border-slate-300 text-slate-500 hover:border-brand-300 hover:text-brand-600 hover:bg-slate-50',
          uploading && 'opacity-60 cursor-wait',
        )}
      >
        {uploading
          ? <><Loader2 className="h-3 w-3 animate-spin" /> Đang tải…</>
          : <><UploadCloud className="h-3 w-3" /> Tải lên</>}
      </button>
    </>
  );
}

// ─── Drawing lightbox (P5) — keyboard ←/→ across items, image/pdf inline ────

function DrawingLightbox({
  batchId, items, startId, onClose,
}: {
  batchId: number;
  items: Item[];
  startId: number;
  onClose: () => void;
}) {
  const startIdx = Math.max(0, items.findIndex((i) => i.id === startId));
  const [idx, setIdx] = useState(startIdx);
  const [state, setState] = useState<{ url: string; kind: DrawingKind } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const objUrlRef = useRef<string | null>(null);

  const count = items.length;
  const cur = items[idx];

  const go = (delta: number) => {
    if (count <= 1) return;
    setIdx((i) => (i + delta + count) % count);
  };

  // Keyboard: Esc closes, ←/→ navigate across drawn items.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [count]);

  // Fetch the current item's drawing as an authed blob whenever idx changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    setState(null);
    if (!cur) { setLoading(false); return; }
    fetchItemDrawing(batchId, cur.id)
      .then((r) => {
        if (cancelled) { if (r) URL.revokeObjectURL(r.url); return; }
        if (!r) { setError('Mã hàng này chưa có bản vẽ.'); setLoading(false); return; }
        objUrlRef.current = r.url;
        setState({ url: r.url, kind: r.kind });
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`Không tải được bản vẽ: ${e?.message ?? 'Unknown'}`);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [idx, cur?.id, batchId]);

  // Revoke the last object URL on unmount.
  useEffect(() => () => { if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current); }, []);

  if (!cur) return null;
  const label = cur.item_code ?? cur.bqms_code ?? cur.specification ?? `Mã #${cur.item_no}`;

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/80 backdrop-blur-sm flex flex-col" onClick={onClose}>
      {/* header */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate" title={label}>Bản vẽ · {label}</div>
          <div className="text-[11px] text-white/60">Mã #{cur.item_no} · {idx + 1}/{count} · ←/→ chuyển mã · Esc đóng</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {state?.url && (
            <a href={state.url} download={`ban-ve-${cur.item_no}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 transition-colors">
              <Download className="h-3.5 w-3.5" /> Tải xuống
            </a>
          )}
          <button type="button" onClick={onClose} aria-label="Đóng"
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* body */}
      <div className="flex-1 flex items-center justify-center gap-2 px-2 pb-4 min-h-0" onClick={(e) => e.stopPropagation()}>
        {count > 1 && (
          <button type="button" onClick={() => go(-1)} aria-label="Mã trước"
            className="shrink-0 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="flex-1 h-full min-w-0 flex items-center justify-center">
          {loading && <Loader2 className="h-8 w-8 animate-spin text-white/70" />}
          {!loading && error && (
            <div className="text-center text-white/80 text-sm">
              <AlertCircle className="mx-auto h-8 w-8 mb-2 text-rose-300" />
              {error}
            </div>
          )}
          {!loading && !error && state && state.kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={state.url} alt={`Bản vẽ ${label}`}
              className="max-h-full max-w-full object-contain rounded-lg shadow-2xl bg-white" />
          )}
          {!loading && !error && state && state.kind === 'pdf' && (
            <iframe src={state.url} title={`Bản vẽ ${label}`}
              className="w-full h-full rounded-lg bg-white shadow-2xl" />
          )}
          {!loading && !error && state && state.kind === 'other' && (
            <div className="text-center text-white/80 text-sm">
              <FileText className="mx-auto h-8 w-8 mb-2 text-white/60" />
              Không xem trước được định dạng này (vd .dwg).
              <div className="mt-2">
                <a href={state.url} download={`ban-ve-${cur.item_no}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25 transition-colors">
                  <Download className="h-3.5 w-3.5" /> Tải xuống để xem
                </a>
              </div>
            </div>
          )}
        </div>
        {count > 1 && (
          <button type="button" onClick={() => go(1)} aria-label="Mã sau"
            className="shrink-0 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Shared empty-state (cockpit Tier-1 container, no shadow-soup) ──────────

function EmptyState({ icon: Icon, title, hint }: { icon: any; title: string; hint: ReactNode }) {
  return (
    <div className={cn(ELEVATION.container, RADIUS.container, 'p-12 text-center')}>
      <div className="mx-auto h-16 w-16 rounded-lg bg-slate-100 flex items-center justify-center mb-3">
        <Icon className="h-8 w-8 text-slate-400" />
      </div>
      <p className="font-semibold text-slate-700 text-base">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{hint}</p>
    </div>
  );
}

// ─── Invitations Table ──────────────────────────────────────────

function InvitationsTable({ invitations, sealed }: { invitations: InvitationRow[]; sealed?: boolean }) {
  if (invitations.length === 0) {
    return (
      <EmptyState icon={Mail} title="Chưa mời NCC nào."
        hint='Bấm "Mời NCC" để chọn tài khoản NCC và gửi link đăng nhập portal.' />
    );
  }
  const TH = cn(TYPE.th, 'px-3 py-2.5');
  return (
    <DataPanel flush>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[1060px]">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={cn(TH, 'text-left')}>NCC</th>
              <th className={cn(TH, 'text-left')}>Email</th>
              <th className={cn(TH, 'text-center')}>Vòng</th>
              <th className={cn(TH, 'text-center')}>Trạng thái</th>
              <th className={cn(TH, 'text-center')}>Nhắc</th>
              <th className={cn(TH, 'text-left')}>Mời lúc</th>
              <th className={cn(TH, 'text-left')}>Báo giá lúc</th>
              <th className={cn(TH, 'text-right')}>Tổng giá</th>
              <th className={cn(TH, 'text-right')}>Lead time</th>
            </tr>
          </thead>
          <tbody className={cn(DEPTH.divider)}>
            {invitations.map((inv) => {
              const s = INV_STATUS[inv.status] ?? INV_STATUS.invited;
              const SIcon = s.icon;
              return (
                <tr key={inv.invitation_id} className={cn(DEPTH.zebra, DEPTH.rowHover, 'transition-colors')}>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-slate-800">{inv.company_name}</div>
                    {inv.contact_name && <div className="text-xs text-slate-500">{inv.contact_name}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{inv.email}</td>
                  <td className="px-3 py-2.5 text-center font-mono text-xs text-slate-600 tabular-nums">V{inv.round_number}</td>
                  <td className="px-3 py-2.5 text-center">
                    <StatusPill tone={s.tone} label={<span className="inline-flex items-center gap-1"><SIcon className="h-3 w-3" /> {s.vi}</span>} />
                    {inv.status === 'declined' && inv.decline_reason && (
                      <div className="text-[11px] text-rose-500 mt-0.5 max-w-[160px] truncate mx-auto" title={inv.decline_reason}>{inv.decline_reason}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {inv.missed_deadline ? (
                      <StatusPill tone="rose" variant="bare" label={<span className="inline-flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Trễ hạn</span>} />
                    ) : inv.reminder_sent_at ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700" title={`Đã nhắc: ${fmtDateTimeVN(inv.reminder_sent_at)}`}>
                        <Clock className="h-3 w-3" /> {fmtDateVN(inv.reminder_sent_at)}
                      </span>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500 tabular-nums">{fmtDateVN(inv.invited_at)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500 tabular-nums">{fmtDateVN(inv.quoted_at)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {sealed && inv.my_quote != null
                      ? <span className="inline-flex items-center gap-1 text-amber-600"><Lock className="h-3 w-3" />niêm phong</span>
                      : inv.my_quote?.total_amount != null
                      ? <span className="font-bold text-emerald-700 tabular-nums">{fmtMoney(inv.my_quote.total_amount)}<span className={TYPE.currencySuffix}>{inv.my_quote.currency}</span></span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-600 tabular-nums">
                    {inv.my_quote?.lead_time_days != null ? `${inv.my_quote.lead_time_days} ngày` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DataPanel>
  );
}

// ─── Smart-award suggestion panel (Gợi ý chốt thầu) ─────────────
// A collapsible brand panel near the award toolbar. Calls the read-only
// /smart-award endpoint (NEVER /award) and only pre-fills the existing
// pick state. Three weight presets feed w_price / w_lead / w_score.

type SaPresetKey = 'price' | 'balanced' | 'quality';
interface SaPreset { key: SaPresetKey; label: string; w: [number, number, number] } // [price, lead, score]
// Cân bằng (balanced) is the default per spec: 0.5 / 0.2 / 0.3.
const SA_PRESETS: SaPreset[] = [
  { key: 'price', label: 'Giá', w: [0.7, 0.15, 0.15] },
  { key: 'balanced', label: 'Cân bằng', w: [0.5, 0.2, 0.3] },
  { key: 'quality', label: 'Chất lượng', w: [0.3, 0.2, 0.5] },
];

/** Clamp a (possibly NUMERIC-string) normalized value to a 0..100 bar width %. */
function saBarPct(v: number | string | null | undefined): number {
  const n = toNum(v, 0);
  // Accept either 0..1 or 0..100; normalize 0..1 to percent.
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

/** One normalized factor bar: brand fill on a slate track + raw label. */
function SaFactorBar({ label, factor, rawSuffix }: {
  label: string; factor?: SaFactor; rawSuffix?: string;
}) {
  const missing = !factor || factor.missing || factor.norm == null;
  const pct = missing ? 0 : saBarPct(factor!.norm);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] font-medium text-slate-500">{label}</span>
      <div className="relative h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
        {!missing && (
          <div className="absolute inset-y-0 left-0 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
        )}
      </div>
      <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-500">
        {missing
          ? <span className="text-slate-300">— thiếu</span>
          : <>{factor!.raw != null ? `${safeFixed(factor!.raw, 0)}${rawSuffix ?? ''}` : `${safeFixed(pct, 0)}%`}</>}
      </span>
    </div>
  );
}

/** Expandable factor table + why-text for one ranked (rank-1) vendor. */
function SaVendorDetail({ v }: { v: SaRankedVendor }) {
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
      <SaFactorBar label="Giá" factor={v.factors?.price} />
      <SaFactorBar label="Lead-time" factor={v.factors?.lead} rawSuffix="n" />
      <SaFactorBar label="Scorecard" factor={v.factors?.scorecard} rawSuffix="%" />
      {/* Đợt 4 — quy đổi VND để so sánh đa tiền tệ (KHÔNG ảnh hưởng rank/score) */}
      {v.price != null && v.currency && v.currency !== 'VND' && v.vnd_equiv != null && (
        <p className="text-[11px] tabular-nums text-slate-500">
          Giá <span className="font-mono">{fmtMoney(v.price)} {v.currency}</span>
          <span className="text-slate-400"> · ≈ {fmtMoney(v.vnd_equiv)} ₫</span>
        </p>
      )}
      {v.price != null && v.fx_missing && (
        <p className="text-[11px] font-medium text-amber-600" title="Thiếu tỷ giá tại ngày chốt thầu — không quy đổi VND">
          ≈ VND: thiếu tỷ giá
        </p>
      )}
      {v.why && (
        <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-snug text-slate-600">
          <Info className="mt-0.5 h-3 w-3 shrink-0 text-brand-500" />
          <span>{v.why}</span>
        </p>
      )}
    </div>
  );
}

/** rank-1 vendor chip with a brand ring + composite score / grade. */
function SaWinnerChip({ v }: { v: SaRankedVendor }) {
  const insufficient = v.insufficient || v.score == null;
  return (
    <span className={cn(BADGE_BASE, 'ring-brand-300 bg-brand-50 text-brand-700')}>
      <Trophy className="h-3 w-3 text-brand-600" />
      <span className="truncate max-w-[160px]" title={v.company_name}>{v.company_name}</span>
      {insufficient ? (
        <span className="font-normal text-slate-400">· Chưa đủ dữ liệu</span>
      ) : (
        <span className="font-mono tabular-nums">
          · {safeFixed(saBarPct(v.score), 0)}đ{v.grade && v.grade !== '—' ? ` (${v.grade})` : ''}
        </span>
      )}
    </span>
  );
}

function SmartAwardPanel({
  batchId, awardMode, canAward, onApplyPerItem, onApplyPerBatch,
}: {
  batchId: number;
  awardMode: 'per_item' | 'per_batch';
  canAward: boolean;
  /** Pre-fill per_item picks: item_id => rank-1 vendor_id. NEVER awards. */
  onApplyPerItem: (picks: Record<number, number>) => void;
  /** Pre-fill the single per_batch winner. NEVER awards. */
  onApplyPerBatch: (vendorId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [presetKey, setPresetKey] = useState<SaPresetKey>('balanced');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({}); // item_id (or 0 for batch) => detail open
  const preset = SA_PRESETS.find((p) => p.key === presetKey) ?? SA_PRESETS[1];
  const [wP, wL, wS] = preset.w;

  // Read-only suggestion query. Keyed on weights so switching preset refetches.
  // enabled only when the panel is open (no work while collapsed).
  const { data, isLoading, isFetching, isError, error } = useQuery<SmartAwardResp>({
    queryKey: ['smart-award', batchId, wP, wL, wS],
    queryFn: () => api.get<SmartAwardResp>(
      `/api/v1/procurement/batches/${batchId}/smart-award?w_price=${wP}&w_lead=${wL}&w_score=${wS}`,
    ),
    enabled: open,
    staleTime: 30000,
  });

  const sa = data?.data;
  const groups = sa?.groups ?? [];
  const multiCurrency = (sa?.mixed_currency ?? false) || groups.length > 1;

  // Build the rank-1 pick map across ALL currency groups (per_item) for "Áp dụng".
  // Cross-currency never sums — each item's rank-1 lives inside its own group.
  const perItemSuggestion = useMemo(() => {
    const picks: Record<number, number> = {};
    for (const g of groups) {
      for (const it of g.items ?? []) {
        const rank1 = it.vendors?.find((v) => v.rank === 1) ?? it.vendors?.[0];
        if (rank1) picks[it.item_id] = rank1.vendor_id;
      }
    }
    return picks;
  }, [groups]);

  // per_batch: a suggestion only makes sense inside a single currency group.
  // With mixed currencies there is no cross-currency winner → disable apply.
  const perBatchSuggestion = useMemo(() => {
    if (groups.length !== 1) return null;
    const list = groups[0].batch ?? [];
    const rank1 = list.find((v) => v.rank === 1) ?? list[0];
    return rank1 ?? null;
  }, [groups]);

  const suggestionCount = awardMode === 'per_item'
    ? Object.keys(perItemSuggestion).length
    : (perBatchSuggestion ? 1 : 0);

  const handleApply = () => {
    if (awardMode === 'per_item') {
      if (Object.keys(perItemSuggestion).length === 0) { toast.error('Chưa có gợi ý để áp dụng'); return; }
      onApplyPerItem(perItemSuggestion);
      toast.success(`Đã điền gợi ý cho ${Object.keys(perItemSuggestion).length} mã — bạn vẫn tự quyết trước khi chốt`);
    } else {
      if (!perBatchSuggestion) {
        toast.error(multiCurrency
          ? 'Khác tiền tệ — không gợi ý NCC trúng cả gói tự động được'
          : 'Chưa có gợi ý để áp dụng');
        return;
      }
      onApplyPerBatch(perBatchSuggestion.vendor_id);
      toast.success('Đã điền gợi ý NCC trúng gói — bạn vẫn tự quyết trước khi chốt');
    }
  };

  const toggleExpand = (key: number) => setExpanded((m) => ({ ...m, [key]: !m[key] }));

  return (
    <div className={cn(RADIUS.container, 'ring-1 ring-brand-200 bg-brand-50/40 overflow-hidden')}>
      {/* Header (collapsible trigger) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-brand-50/70 transition-colors"
      >
        <div className="h-8 w-8 rounded-lg bg-brand-600 flex items-center justify-center shadow-sm shrink-0">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={TYPE.h2}>Gợi ý chốt thầu</span>
            <span className={cn(BADGE_BASE, 'ring-brand-200 bg-white text-brand-600')}>
              <Wand2 className="h-3 w-3" /> Chỉ gợi ý
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Xếp hạng NCC theo giá / lead-time / chất lượng — <b>bạn vẫn tự quyết</b>.
          </p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-brand-100 bg-white px-4 py-3 space-y-3">
          {/* Weight preset segmented control */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-semibold text-slate-500">Ưu tiên:</span>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Trọng số ưu tiên">
              {SA_PRESETS.map((p) => {
                const active = p.key === presetKey;
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPresetKey(p.key)}
                    className={cn('px-3 h-7 rounded-md text-xs font-semibold transition-colors',
                      active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900')}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <span className="font-mono text-[11px] tabular-nums text-slate-400">
              giá {safeFixed(wP, 1)} · lead {safeFixed(wL, 1)} · chất lượng {safeFixed(wS, 1)}
            </span>
            {isFetching && !isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-400" />}
          </div>

          {multiCurrency && groups.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>NCC báo giá ở <b>nhiều loại tiền tệ</b> — hệ thống xếp hạng <b>riêng từng nhóm tiền tệ</b>, không quy đổi/cộng gộp. Hãy so sánh trong cùng một nhóm.</span>
            </div>
          )}

          {/* States */}
          {isLoading ? (
            <div className="py-6 text-center text-sm text-slate-400">Đang phân tích gợi ý…</div>
          ) : isError ? (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700" role="alert">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{(error as any)?.detail ?? 'Chưa tính được gợi ý cho phiên này.'}</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">Chưa đủ báo giá để gợi ý. Chờ NCC báo giá thêm.</div>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.currency} className="space-y-2">
                  {/* Per-currency header — each group is isolated (no cross-currency sum) */}
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-bold text-slate-600">
                      Tiền tệ: {g.currency}
                    </span>
                  </div>

                  {awardMode === 'per_item' ? (
                    <div className={cn(RADIUS.container, 'ring-1 ring-slate-200 divide-y divide-slate-100 overflow-hidden')}>
                      {(g.items ?? []).length === 0 ? (
                        <div className="px-3 py-4 text-center text-[12px] text-slate-400">Nhóm này chưa có mã để gợi ý.</div>
                      ) : (g.items ?? []).map((it) => {
                        const rank1 = it.vendors?.find((v) => v.rank === 1) ?? it.vendors?.[0];
                        const isOpen = !!expanded[it.item_id];
                        return (
                          <div key={it.item_id} className="px-3 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-mono text-[12px] font-semibold text-brand-700 truncate">
                                  {it.bqms_code ?? `#${it.item_no ?? it.item_id}`}
                                </div>
                                {it.specification && (
                                  <div className="text-[11px] text-slate-500 truncate max-w-[260px]" title={it.specification}>{it.specification}</div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {rank1
                                  ? <SaWinnerChip v={rank1} />
                                  : <span className="text-[11px] text-slate-400">Chưa có gợi ý</span>}
                                {rank1 && (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpand(it.item_id)}
                                    aria-expanded={isOpen}
                                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                    title="Xem chi tiết yếu tố"
                                  >
                                    {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                  </button>
                                )}
                              </div>
                            </div>
                            {isOpen && rank1 && <SaVendorDetail v={rank1} />}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    // per_batch: rank the whole package within this currency group
                    <div className={cn(RADIUS.container, 'ring-1 ring-slate-200 overflow-hidden')}>
                      {(() => {
                        const list = g.batch ?? [];
                        const rank1 = list.find((v) => v.rank === 1) ?? list[0];
                        if (!rank1) return <div className="px-3 py-4 text-center text-[12px] text-slate-400">Nhóm này chưa có gợi ý NCC trúng gói.</div>;
                        const isOpen = !!expanded[0];
                        return (
                          <div className="px-3 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-[11px] font-semibold text-slate-500">NCC trúng cả gói (gợi ý)</div>
                              <div className="flex items-center gap-2 shrink-0">
                                <SaWinnerChip v={rank1} />
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(0)}
                                  aria-expanded={isOpen}
                                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                  title="Xem chi tiết yếu tố"
                                >
                                  {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </div>
                            {isOpen && <SaVendorDetail v={rank1} />}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Apply — pre-fills the pick state ONLY (never /award) */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-brand-500" />
              Chỉ gợi ý — bạn vẫn tự quyết. Nút dưới chỉ điền sẵn lựa chọn, <b>không chốt thầu</b>.
            </p>
            <button
              type="button"
              onClick={handleApply}
              disabled={!canAward || suggestionCount === 0 || (awardMode === 'per_batch' && multiCurrency)}
              title={!canAward ? 'Phiên chưa ở trạng thái có thể chốt' : awardMode === 'per_batch' && multiCurrency ? 'Khác tiền tệ — chọn thủ công trong từng nhóm' : ''}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-40"
            >
              <Wand2 className="h-3.5 w-3.5" /> Áp dụng gợi ý{suggestionCount > 0 ? ` (${suggestionCount})` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Quote Comparison Matrix ────────────────────────────────────

interface PendingAward {
  item_id: number;
  bqms_code: string | null;
  item_no: number;
  specification: string;
  vendor_id: number;
  company_name: string;
  price: number;
  currency: string;
  quantity: number | null;
}

// ─── Full-quote DRAWER (P5) — right-side slide-in for one vendor's quote ──

/** Lightbox xem trước 1 file đính kèm báo giá (PDF/ảnh inline, Excel → tải xuống). */
function AttachmentPreview({
  path, filename, onClose,
}: {
  path: string;
  filename: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ url: string; kind: DrawingKind } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const objUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    setState(null);
    fetchAttachmentBlob(path)
      .then((r) => {
        if (cancelled) { if (r) URL.revokeObjectURL(r.url); return; }
        if (!r) { setError('Không tải được file (404).'); setLoading(false); return; }
        objUrlRef.current = r.url;
        setState({ url: r.url, kind: r.kind });
        setLoading(false);
      })
      .catch((e) => { if (!cancelled) { setError(`Lỗi tải file: ${e?.message ?? 'Unknown'}`); setLoading(false); } });
    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => () => { if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current); }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/80 backdrop-blur-sm flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between gap-4 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate" title={filename}>{filename}</div>
          <div className="text-[11px] text-white/60">Esc đóng</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {state?.url && (
            <a href={state.url} download={filename}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 transition-colors">
              <Download className="h-3.5 w-3.5" /> Tải xuống
            </a>
          )}
          <button type="button" onClick={onClose} aria-label="Đóng"
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center px-2 pb-4 min-h-0" onClick={(e) => e.stopPropagation()}>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-white/70"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải…</div>
        )}
        {error && !loading && <div className="text-sm text-white/80">{error}</div>}
        {!loading && !error && state?.kind === 'image' && (
          <img src={state.url} alt={filename} className="max-h-full max-w-full rounded-lg object-contain" />
        )}
        {!loading && !error && state?.kind === 'pdf' && (
          <iframe src={state.url} title={filename} className="h-full w-full max-w-[1100px] rounded-lg bg-white" />
        )}
        {!loading && !error && state?.kind === 'other' && (
          <div className="text-center text-sm text-white/80">
            <p>Không xem trước được định dạng này (ví dụ Excel).</p>
            <a href={state.url} download={filename}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
              <Download className="h-3.5 w-3.5" /> Tải xuống
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function QuoteDrawer({
  batchId, vendorId, vendorName, focusItemId, onClose,
}: {
  batchId: number;
  vendorId: number;
  vendorName: string;
  focusItemId: number | null;
  onClose: () => void;
}) {
  useModalDismiss(onClose);
  const focusRef = useRef<HTMLTableRowElement | null>(null);

  const { data, isLoading, isError } = useQuery<FullQuoteResp>({
    queryKey: ['vb-full-quote', batchId, vendorId],
    queryFn: () => api.get<FullQuoteResp>(`/api/v1/procurement/batches/${batchId}/quotes/${vendorId}`),
  });

  // Scroll the focused item row into view once data lands.
  useEffect(() => {
    if (data && focusItemId != null && focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [data, focusItemId]);

  const q = data?.data;
  const h = q?.header;
  const [preview, setPreview] = useState<{ path: string; filename: string } | null>(null);
  const anyFiles = !!h?.has_attachment || (q?.lines ?? []).some((l) => (l.attachments?.length ?? 0) > 0);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label="Báo giá chi tiết NCC">
      {/* scrim */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      {/* panel */}
      <motion.aside
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        className="relative z-10 h-full w-full max-w-[560px] bg-white shadow-2xl ring-1 ring-slate-200 flex flex-col"
      >
        {/* header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-brand-600 shrink-0" />
              <h2 className="text-[15px] font-semibold text-slate-900 truncate" title={vendorName}>{vendorName}</h2>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Báo giá đầy đủ {h ? `· Vòng ${h.round_number}` : ''}
              {q?.vendor?.email ? ` · ${q.vendor.email}` : ''}
            </p>
          </div>
          <button onClick={onClose} className={MODAL_CLOSE} aria-label="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-10 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải báo giá…
            </div>
          )}
          {isError && !isLoading && (
            <div className={cn('flex items-start gap-2 px-3 py-2.5 text-sm', RADIUS.container, BADGE.rose.bg, BADGE.rose.text, BADGE.rose.ring)}>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>NCC này chưa gửi báo giá, hoặc không tải được.</p>
            </div>
          )}

          {h && q && (
            <>
              {/* header metrics */}
              <div className={cn('grid grid-cols-3 gap-2', RADIUS.container)}>
                <DrawerStat label="Tổng báo giá" value={h.total_amount != null ? `${fmtMoney(h.total_amount)} ${h.currency ?? ''}` : '—'} strong />
                <DrawerStat label="Lead-time" value={h.lead_time_days != null ? `${h.lead_time_days} ngày` : '—'} />
                <DrawerStat label="Tiền tệ" value={h.currency ?? '—'} />
                <DrawerStat label="Hiệu lực đến" value={fmtDateVN(h.valid_until)} />
                <DrawerStat label="Đánh giá NCC" value={h.grade ? `Hạng ${h.grade}${h.on_time_rate != null ? ` · đúng hạn ${h.on_time_rate.toFixed(0)}%` : ''}` : '—'} />
                <DrawerStat label="Gửi lúc" value={fmtDateTimeVN(h.submitted_at)} />
              </div>

              {(h.moq_notes || h.notes) && (
                <div className="space-y-2">
                  {h.moq_notes && (
                    <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">Điều kiện MOQ</div>
                      <div className="text-[13px] text-slate-700 whitespace-pre-wrap">{h.moq_notes}</div>
                    </div>
                  )}
                  {h.notes && (
                    <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">Ghi chú NCC</div>
                      <div className="text-[13px] text-slate-700 whitespace-pre-wrap">{h.notes}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Hành động file / link của báo giá */}
              {(h.has_attachment || h.external_url || anyFiles) && (
                <div className="flex flex-wrap items-center gap-2">
                  {h.has_attachment && (
                    <span className="inline-flex items-center">
                      <button
                        onClick={() => setPreview({
                          path: `/api/v1/procurement/quotes/${h.quote_id}/attachment`,
                          filename: h.attachment_filename || 'bao-gia',
                        })}
                        className={cn(BUTTON.secondary, 'h-8 rounded-r-none px-3 text-xs')}
                        title="Xem trước file báo giá"
                      >
                        <Eye className="h-3.5 w-3.5" /> {h.attachment_filename || 'File báo giá'}
                      </button>
                      <button
                        onClick={() => downloadQuoteAttachment(
                          `/api/v1/procurement/quotes/${h.quote_id}/attachment`,
                          h.attachment_filename || 'bao-gia.xlsx',
                        )}
                        className={cn(BUTTON.secondary, 'h-8 rounded-l-none border-l-0 px-2 text-xs')}
                        title="Tải file báo giá"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                  {anyFiles && (
                    <button
                      onClick={() => downloadQuoteAttachment(
                        `/api/v1/procurement/batches/${batchId}/quotes/${vendorId}/attachments.zip`,
                        `bao-gia-${vendorName}.zip`,
                      )}
                      className={cn(BUTTON.secondary, 'h-8 px-3 text-xs')}
                      title="Tải TẤT CẢ file của NCC này (.zip)"
                    >
                      <FileArchive className="h-3.5 w-3.5" /> Tải tất cả (zip)
                    </button>
                  )}
                  {h.external_url && (
                    <a
                      href={h.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(BUTTON.secondary, 'h-8 px-3 text-xs')}
                      title={h.external_url}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Link tham khảo
                    </a>
                  )}
                </div>
              )}

              {/* per-line table — 6 explicit columns (re-layout of the packed col) */}
              <div className={cn('overflow-x-auto', RADIUS.container, ELEVATION.container)}>
                <table className="w-full min-w-[640px] text-xs border-collapse">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={cn(TYPE.th, 'text-left px-3 py-2 w-10')}>STT</th>
                      <th className={cn(TYPE.th, 'text-left px-3 py-2')}>Mã hàng &amp; mô tả</th>
                      <th className={cn(TYPE.th, 'text-right px-3 py-2 whitespace-nowrap')}>SL YC / chào</th>
                      <th className={cn(TYPE.th, 'text-center px-2 py-2')}>CCY</th>
                      <th className={cn(TYPE.th, 'text-right px-3 py-2 whitespace-nowrap')}>Đơn giá / ∑</th>
                      <th className={cn(TYPE.th, 'text-right px-2 py-2 whitespace-nowrap')}>
                        {h.prior_round != null ? `Δ vs vòng ${h.prior_round}` : 'Δ vòng'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {q.lines.map((ln) => {
                      const focused = focusItemId === ln.item_id;
                      const offeredLow = ln.offered_qty != null && ln.quantity != null && ln.offered_qty < ln.quantity;
                      return (
                        <tr
                          key={ln.item_id}
                          ref={focused ? focusRef : undefined}
                          className={cn(
                            'align-top',
                            focused && 'bg-brand-50/60',
                            ln.can_do === false && !focused && 'bg-rose-50/40',
                          )}
                        >
                          {/* STT */}
                          <td className="px-3 py-2 text-left font-mono tabular-nums text-[11px] text-slate-400 w-10">
                            {ln.item_no}
                          </td>

                          {/* Mã hàng & mô tả — ItemDescCell (full spec, no truncate) + per-line meta */}
                          <td className="px-3 py-2">
                            <ItemDescCell
                              code={ln.item_code ?? ln.bqms_code ?? `#${ln.item_no}`}
                              spec={ln.specification ?? undefined}
                              material={ln.required_material}
                              truncate={false}
                            />
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {ln.moq && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">MOQ {ln.moq}</span>
                              )}
                              {ln.lead_time_days != null && (
                                <span className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                  <Clock className="h-2.5 w-2.5" />{ln.lead_time_days}n
                                </span>
                              )}
                              {ln.can_do === false && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 font-medium">Không làm</span>
                              )}
                            </div>
                            {ln.notes && (
                              <div className="mt-1 text-[11px] text-slate-500 whitespace-pre-wrap">{ln.notes}</div>
                            )}
                            {ln.attachments.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {ln.attachments.map((att) => (
                                  <span key={att.index} className="inline-flex items-center gap-1">
                                    <button
                                      onClick={() => setPreview({
                                        path: `/api/v1/procurement/quotes/${h.quote_id}/items/${ln.item_id}/attachment?index=${att.index}`,
                                        filename: att.filename,
                                      })}
                                      className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-800 underline decoration-dotted"
                                      title="Xem trước"
                                    >
                                      <Eye className="h-2.5 w-2.5" />{att.filename}
                                    </button>
                                    <button
                                      onClick={() => downloadQuoteAttachment(
                                        `/api/v1/procurement/quotes/${h.quote_id}/items/${ln.item_id}/attachment?index=${att.index}`,
                                        att.filename,
                                      )}
                                      className="text-slate-400 hover:text-brand-600"
                                      title="Tải xuống"
                                    >
                                      <Download className="h-2.5 w-2.5" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>

                          {/* SL YC / chào — quantity → offered_qty, amber when chào < YC */}
                          <td className="px-3 py-2 text-right whitespace-nowrap font-mono tabular-nums text-[12px]">
                            <span className="text-slate-700">{ln.quantity ?? '—'}</span>
                            {ln.offered_qty != null && (
                              <>
                                <span className="text-slate-300"> → </span>
                                <span className={offeredLow ? 'text-amber-600 font-semibold' : 'text-slate-700'}>{ln.offered_qty}</span>
                              </>
                            )}
                            {ln.unit && <span className="text-[11px] text-slate-400 ml-0.5">{ln.unit}</span>}
                          </td>

                          {/* CCY */}
                          <td className="px-2 py-2 text-center text-[11px] text-slate-500">
                            {ln.currency ?? h.currency ?? '—'}
                          </td>

                          {/* Đơn giá / ∑ */}
                          <td className="px-3 py-2 text-right">
                            {ln.free_charge ? (
                              <div className="font-semibold text-[13px] text-emerald-600">FOC</div>
                            ) : ln.can_do === false ? (
                              <div className="text-[12px] font-medium text-rose-600">Không làm</div>
                            ) : ln.unit_price != null ? (
                              <>
                                <div className="font-mono tabular-nums text-[13px] font-semibold text-slate-800">
                                  {fmtMoney(ln.unit_price)}<span className={TYPE.currencySuffix}>{ln.currency ?? h.currency ?? ''}</span>
                                </div>
                                {ln.line_total != null && (
                                  <div className="text-[11px] text-slate-400 font-mono">∑ {fmtMoney(ln.line_total)}</div>
                                )}
                              </>
                            ) : <span className="text-slate-300">—</span>}
                          </td>

                          {/* Δ vòng — money delta + pct (verbatim) */}
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            {ln.delta == null ? (
                              <span className="text-slate-300 text-[11px]">—</span>
                            ) : (
                              <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-mono font-medium',
                                ln.delta < 0 ? 'text-emerald-600' : ln.delta > 0 ? 'text-rose-600' : 'text-slate-400')}>
                                {ln.delta < 0 ? <ChevronDown className="h-3 w-3" /> : ln.delta > 0 ? <ChevronUp className="h-3 w-3" /> : null}
                                {fmtMoney(Math.abs(ln.delta))}
                                {ln.delta_pct != null && <span className="text-[11px] opacity-70">({ln.delta_pct > 0 ? '+' : ''}{safeFixed(ln.delta_pct, 1)}%)</span>}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </motion.aside>
      {preview && (
        <AttachmentPreview
          path={preview.path}
          filename={preview.filename}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function DrawerStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn('mt-0.5 font-mono tabular-nums', strong ? 'text-[15px] font-bold text-slate-900' : 'text-[13px] text-slate-700')}>{value}</div>
    </div>
  );
}

function QuoteMatrix({
  batchId, batchStatus, awardMode, currentRound,
}: {
  batchId: number;
  batchStatus: string;
  awardMode: 'per_item' | 'per_batch';
  currentRound: number;
}) {
  const { data, isLoading, isFetching, isError } = useQuery<MatrixResp>({
    queryKey: ['vb-batch-matrix', batchId],
    queryFn: () => api.get<MatrixResp>(`/api/v1/procurement/batches/${batchId}/matrix`),
    refetchInterval: 15000,
    placeholderData: keepPreviousData, // keep matrix on-screen across the 15s poll
  });

  // per_item: staged award per item (item_id -> vendor_id). per_batch: a single winner vendor_id.
  const [perItemPick, setPerItemPick] = useState<Record<number, number>>({});
  const [perBatchPick, setPerBatchPick] = useState<number | null>(null);
  const [pendingAwards, setPendingAwards] = useState<PendingAward[] | null>(null);
  const [perBatchVendor, setPerBatchVendor] = useState<MatrixVendor | null>(null);
  const [showWriteBack, setShowWriteBack] = useState(false);
  // Horizontal-scroll boundary shadow on the sticky-left column.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolledX, setScrolledX] = useState(false);
  // Trading-terminal controls (presentation only): density, lowest-only dimming, column crosshair.
  const [density, setDensity] = useState<Density>('comfortable');
  const [lowestOnly, setLowestOnly] = useState(false);
  const [hoverVid, setHoverVid] = useState<number | null>(null);
  // Full-quote drawer: which vendor's quote to show + which item row to focus.
  const [drawer, setDrawer] = useState<{ vendorId: number; vendorName: string; itemId: number | null } | null>(null);

  const matrix = data?.data;
  const vendors = matrix?.vendors ?? [];
  const items = matrix?.items ?? [];

  // O(1) vendor lookup — replaces every vendors.find(...) inside the items×vendors loops.
  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.vendor_id, v])), [vendors]);

  // FE-derive per-currency grand totals (NEVER cross-currency) + response counts
  // for the tfoot summary. Group vendors[].total_amount on vendor.currency.
  const currencyTotals = useMemo(() => {
    const byCcy = new Map<string, number>();
    for (const v of vendors) {
      if (v.total_amount == null) continue;
      const ccy = v.currency ?? '—';
      byCcy.set(ccy, (byCcy.get(ccy) ?? 0) + toNum(v.total_amount));
    }
    return Array.from(byCcy, ([currency, amount]) => ({ currency, amount }));
  }, [vendors]);
  // Đợt 4 — tổng quy đổi VND gộp (SONG SONG, KHÔNG trộn vào currencyTotals để
  // giữ per-currency gốc nguyên). Chỉ cộng vnd_equiv_total != null (ô thiếu rate
  // bị bỏ qua → banner amber cảnh báo tổng chưa gồm các ô đó).
  const vndGrandTotal = useMemo(() => {
    let any = false, sum = 0;
    for (const v of vendors) {
      if (v.vnd_equiv_total != null) { sum += toNum(v.vnd_equiv_total); any = true; }
    }
    return any ? sum : null;
  }, [vendors]);
  const fxMissingCount = matrix?.batch.fx?.missing_count ?? 0;
  const fxAsOf = matrix?.batch.fx?.as_of ?? null;
  const matrixInvited = vendors.length;
  const matrixSubmitted = vendors.filter((v) => v.inv_status === 'submitted').length;

  // Đợt 2b [SB] — niêm phong giá: BE đã ép cells/total → null + đính cờ. FE chỉ
  // hiện "đã/chưa nộp" + banner, ẩn Tờ trình + award cho tới khi qua hạn báo giá.
  const sealed = matrix?.batch.sealed ?? false;
  const sealedUntil = matrix?.batch.sealed_until ?? null;

  // Only the first-ever load (no cached data) shows the full skeleton; the poll keeps prior data.
  if (isLoading && !data) {
    return <div className={cn(ELEVATION.container, RADIUS.container, 'p-12 text-center text-slate-400 text-sm')}>Đang tải matrix…</div>;
  }
  if (isError && !data) {
    return (
      <div className={cn('flex items-start gap-3 px-4 py-3 text-sm', RADIUS.container, BADGE.rose.bg, BADGE.rose.text, BADGE.rose.ring)} role="alert">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Không tải được ma trận so sánh. Thử tải lại trang.</p>
      </div>
    );
  }

  if (vendors.length === 0) {
    return (
      <EmptyState icon={Grid3x3} title="Chưa mời NCC nào."
        hint="Mời NCC + chờ họ login portal báo giá → ma trận so sánh sẽ hiện ở đây." />
    );
  }

  // Can award when there is at least one submitted quote and the batch is in an awardable state.
  const submittedVendors = vendors.filter((v) => v.inv_status === 'submitted' && v.quote_id != null);
  const canAward = ['published', 'evaluating', 'awarded'].includes(batchStatus) && submittedVendors.length > 0;
  const isReAward = batchStatus === 'awarded';

  // ── per_item: build staged award list for the confirm modal ──
  const openPerItemConfirm = () => {
    const picks: PendingAward[] = [];
    for (const it of items) {
      const vid = perItemPick[it.item_id];
      if (!vid) continue;
      const cell = it.cells?.[String(vid)];
      if (!cell || cell.unit_price == null) continue;
      const v = vendorById.get(vid);
      picks.push({
        item_id: it.item_id,
        bqms_code: it.bqms_code,
        item_no: it.item_no,
        specification: it.specification,
        vendor_id: vid,
        company_name: v?.company_name ?? `NCC #${vid}`,
        price: cell.unit_price,
        currency: cell.currency ?? v?.currency ?? 'VND',
        quantity: cell.quantity ?? it.quantity ?? null,
      });
    }
    if (picks.length === 0) { toast.error('Chọn ít nhất 1 mã trúng thầu'); return; }
    setPendingAwards(picks);
  };

  const pickedCount = Object.values(perItemPick).filter(Boolean).length;

  return (
    <div className="space-y-3">
      {/* Legend + matrix controls + award toolbar — emerald = giá thấp nhất, brand = đang chọn / đã chốt */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 rounded-full bg-emerald-500" /> <span className="font-semibold text-emerald-700">Giá thấp nhất</span> (cùng tiền tệ)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 rounded-full bg-brand-500" /> Đang chọn
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Award className="h-3 w-3 text-brand-600" />
          <span className="inline-block h-3 w-0.5 rounded-full bg-brand-600" /> Đã chốt
        </span>
        <span className="inline-flex items-center gap-1 text-slate-400">Vòng {currentRound}</span>
        <div className="ml-auto flex items-center gap-2">
          <ToggleChip
            active={lowestOnly}
            onChange={setLowestOnly}
            icon={<Trophy className="h-3.5 w-3.5" />}
            label="Chỉ giá thấp nhất"
          />
          <DensityToggle value={density} onChange={setDensity} />
          <button
            onClick={() => downloadDecisionSheet(batchId, matrix?.batch.batch_code ?? `batch${batchId}`)}
            disabled={submittedVendors.length === 0 || sealed}
            title={sealed ? 'Phiên đang niêm phong giá — xuất tờ trình sau khi qua hạn báo giá' : 'Xuất tờ trình chốt thầu (.xlsx) — admin'}
            className={cn(BUTTON.secondary, 'h-8 px-3 text-xs')}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Tờ trình chốt thầu
          </button>
          {/* P6 — chỉ hiện sau khi đã chốt: lưu giá trúng vào Thư viện nguồn cung */}
          {isReAward && (
            <button
              onClick={() => setShowWriteBack(true)}
              title="Lưu giá trúng (= giá nhập) vào Thư viện nguồn cung cho các RFQ sau"
              className={cn(BUTTON.secondary, 'h-8 px-3 text-xs')}
            >
              <Library className="h-3.5 w-3.5 text-brand-600" /> Lưu vào Thư viện nguồn cung
            </button>
          )}
          {/* Đợt 2b [SB] — khi niêm phong: chưa được chốt thầu (giá còn ẩn). */}
          {!sealed && (awardMode === 'per_item' ? (
            <button
              onClick={openPerItemConfirm}
              disabled={!canAward || pickedCount === 0}
              className={cn(BUTTON.base, 'h-8 px-3 text-xs bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800')}
            >
              <Award className="h-3.5 w-3.5" /> {isReAward ? 'Chốt lại' : 'Chốt thầu'} ({pickedCount})
            </button>
          ) : (
            <button
              onClick={() => {
                if (perBatchPick == null) { toast.error('Chọn 1 NCC trúng cả gói'); return; }
                const v = vendorById.get(perBatchPick) ?? null;
                setPerBatchVendor(v);
              }}
              disabled={!canAward || perBatchPick == null}
              className={cn(BUTTON.base, 'h-8 px-3 text-xs bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800')}
            >
              <Award className="h-3.5 w-3.5" /> {isReAward ? 'Chốt lại NCC trúng gói' : 'Chốt NCC trúng cả gói'}
            </button>
          ))}
        </div>
      </div>

      {awardMode === 'per_batch' && !sealed && (
        <div className="text-[11px] text-slate-500 px-1 -mt-1">
          Phiên chốt <b>toàn gói</b>: chọn 1 cột NCC ở dưới (radio) → 1 NCC trúng tất cả mã.
        </div>
      )}

      {/* Đợt 2b [SB] — banner niêm phong: đơn giá ẩn tới khi qua hạn báo giá.
          Chỉ hiện số NCC đã/chưa nộp để theo dõi tiến độ, KHÔNG lộ mặt bằng giá. */}
      {sealed && (
        <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] rounded-lg bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            Giá đang <b>niêm phong</b> tới {sealedUntil ? fmtDateTimeVN(sealedUntil) : 'khi đặt hạn báo giá'}.
            {' '}Đã nộp: <b>{matrixSubmitted}/{matrixInvited}</b> NCC. Đơn giá hiện sau khi qua hạn.
          </span>
        </div>
      )}

      {/* Smart-award suggestion (read-only). Pre-fills the SAME pick state the
          award toolbar reads; it never calls /award. Ẩn khi niêm phong (gợi ý
          dựa vào giá — mà giá đang bị giấu). */}
      {!sealed && (
        <SmartAwardPanel
          batchId={batchId}
          awardMode={awardMode}
          canAward={canAward}
          onApplyPerItem={(picks) => setPerItemPick(picks)}
          onApplyPerBatch={(vendorId) => setPerBatchPick(vendorId)}
        />
      )}

      {/* ── PRICE MATRIX (the HERO) — trading-terminal grid ──
          Sticky-left freeze item col, sticky vendor header, column crosshair,
          left-rule lowest/picked/awarded (not washes), density + lowest-only. */}
      <div className={cn('relative bg-white overflow-hidden transition-opacity', ELEVATION.container, RADIUS.container,
        isFetching && data ? 'opacity-60' : 'opacity-100')} aria-busy={isFetching}>
        {isFetching && data && (
          <div className="absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden">
            <div className="h-full w-1/3 bg-brand-500 animate-pulse" />
          </div>
        )}
        <div className="overflow-x-auto"
          ref={scrollRef}
          onScroll={(e) => setScrolledX((e.target as HTMLDivElement).scrollLeft > 0)}>
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-20 bg-slate-50">
              <tr>
                <MatrixFreezeCol as="th" scrolled={scrolledX} className={cn('z-30 bg-slate-50 min-w-[280px]', TYPE.th)}>
                  Mã linh kiện
                </MatrixFreezeCol>
                <th className={cn(TYPE.th, 'text-right px-3 py-2.5 whitespace-nowrap')}>SL</th>
                <th className={cn(TYPE.th, 'text-right px-3 py-2.5 whitespace-nowrap border-r border-slate-200')}>Target</th>
                {vendors.map((v) => {
                  const s = INV_STATUS[v.inv_status] ?? INV_STATUS.invited;
                  const selectableBatch = awardMode === 'per_batch' && v.inv_status === 'submitted' && v.quote_id != null;
                  const colHovered = hoverVid === v.vendor_id;
                  return (
                    <MatrixVendorHead
                      key={v.vendor_id}
                      name={
                        <span className="inline-flex max-w-[150px] items-center gap-1" title={`${v.company_name}${v.grade ? ` · hạng ${v.grade}` : ''}`}>
                          <span className="truncate">{v.company_name}</span>
                          {v.grade && (
                            <span className={cn('shrink-0 rounded px-1 py-0.5 text-[11px] font-bold leading-none',
                              v.grade === 'A' ? 'bg-emerald-100 text-emerald-700'
                                : v.grade === 'B' ? 'bg-amber-100 text-amber-700'
                                  : 'bg-rose-100 text-rose-700')}>{v.grade}</span>
                          )}
                        </span>
                      }
                      dotClass={BADGE[s.tone].dot}
                      statusLabel={s.vi}
                      colHovered={colHovered}
                      onMouseEnter={() => setHoverVid(v.vendor_id)}
                      onMouseLeave={() => setHoverVid(null)}
                      className={cn('min-w-[120px] bg-slate-50',
                        awardMode === 'per_batch' && perBatchPick === v.vendor_id ? 'bg-brand-50' : '')}
                      control={awardMode === 'per_batch' ? (
                        <label className={cn('inline-flex items-center gap-1 text-[11px] font-medium',
                          selectableBatch ? 'text-brand-700 cursor-pointer' : 'text-slate-300')}
                          title="Chọn trúng gói">
                          <input
                            type="radio"
                            name="perBatchWinner"
                            disabled={!selectableBatch || !canAward}
                            checked={perBatchPick === v.vendor_id}
                            onChange={() => setPerBatchPick(v.vendor_id)}
                            className="w-3 h-3 accent-brand-600 focus:ring-brand-300"
                          />
                        </label>
                      ) : undefined}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody className={cn(DEPTH.divider)}>
              {items.length === 0 ? (
                <tr><td colSpan={3 + vendors.length} className="text-center text-slate-400 py-10 text-sm">Phiên chưa có mã linh kiện.</td></tr>
              ) : items.map((it) => {
                const awardedVid = it.awarded_vendor_id ?? null;
                const pickedVid = perItemPick[it.item_id] ?? null;
                return (
                  <tr key={it.item_id} className={cn(DEPTH.zebra, DEPTH.rowHover)}>
                    <MatrixFreezeCol scrolled={scrolledX} className={ROW_PADDING[density]}>
                      <div className="flex items-start gap-2">
                        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                          <BqmsImageThumb bqmsCode={it.bqms_code} rfqNumber={null} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={TYPE.code}>{it.bqms_code ?? `#${it.item_no}`}</span>
                            <SourcePill kind={it.source_kind} />
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[180px]" title={it.specification}>{it.specification}</div>
                          {it.source_bqms_rfq_number && (
                            <BqmsCodeFilesButton rfqNumber={it.source_bqms_rfq_number} bqmsCode={it.bqms_code} itemId={it.item_id} compact />
                          )}
                          {awardedVid != null && (
                            <div className="inline-flex items-center gap-1 mt-0.5 text-[11px] font-semibold text-brand-700">
                              <Award className="h-2.5 w-2.5" />
                              {vendorById.get(awardedVid)?.company_name ?? `NCC #${awardedVid}`}
                              {it.awarded_price != null && <span className="font-mono tabular-nums">· {fmtMoney(it.awarded_price)}<span className={TYPE.currencySuffix}>{it.awarded_currency ?? ''}</span></span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </MatrixFreezeCol>
                    <td className={cn(ROW_PADDING[density], 'text-right font-mono tabular-nums text-[12px] text-slate-600')}>{it.quantity} <span className="text-[11px] text-slate-400">{it.unit}</span></td>
                    <td className={cn(ROW_PADDING[density], 'text-right font-mono tabular-nums text-[12px] text-slate-400 border-r border-slate-200')}>
                      {it.target_price != null ? fmtMoney(it.target_price) : '—'}
                    </td>
                    {vendors.map((v) => {
                      const cell = it.cells?.[String(v.vendor_id)];
                      const isAwardedCell = awardedVid === v.vendor_id;
                      const isPickedCell = pickedVid === v.vendor_id;
                      const colHovered = hoverVid === v.vendor_id;
                      // Đợt 2b [SB] — niêm phong: giấu mọi con số, chỉ báo đã/chưa nộp.
                      // Chặn TRƯỚC nhánh giá/Eye/drawer/award-pick (không lộ gì).
                      if (sealed) {
                        const submittedThis = v.inv_status === 'submitted';
                        return (
                          <td key={v.vendor_id}
                            onMouseEnter={() => setHoverVid(v.vendor_id)}
                            onMouseLeave={() => setHoverVid(null)}
                            className={cn(ROW_PADDING[density], 'text-center transition-colors', colHovered && MATRIX.colHover)}>
                            {submittedThis ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700"
                                title="Đã nộp báo giá — giá niêm phong tới hạn">
                                <Lock className="h-3 w-3" /> Đã nộp
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-300">Chưa nộp</span>
                            )}
                          </td>
                        );
                      }
                      if (!cell || cell.unit_price == null) {
                        return (
                          <td key={v.vendor_id}
                            onMouseEnter={() => setHoverVid(v.vendor_id)}
                            onMouseLeave={() => setHoverVid(null)}
                            className={cn(ROW_PADDING[density], 'text-center text-slate-300 text-[12px] transition-colors',
                              colHovered && MATRIX.colHover,
                              awardMode === 'per_batch' && perBatchPick === v.vendor_id ? 'bg-brand-50/40' : '')}>—</td>
                        );
                      }
                      const canPickThis = awardMode === 'per_item' && canAward;
                      const togglePick = () => setPerItemPick((p) => {
                        const next = { ...p };
                        if (next[it.item_id] === v.vendor_id) delete next[it.item_id];
                        else next[it.item_id] = v.vendor_id;
                        return next;
                      });
                      // Cell visual state → cockpit left-rule (RULE, not wash).
                      const cellState = isAwardedCell ? 'awarded' : isPickedCell ? 'picked' : cell.is_lowest ? 'lowest' : 'default';
                      const dimmed = lowestOnly && !cell.is_lowest && !isAwardedCell && !isPickedCell;
                      return (
                        <td key={v.vendor_id}
                          className={cn(ROW_PADDING[density], 'text-right align-top transition-colors',
                            cellState === 'awarded' && MATRIX.awarded,
                            cellState === 'picked' && MATRIX.picked,
                            cellState === 'lowest' && MATRIX.lowest,
                            colHovered && cellState === 'default' && MATRIX.colHover,
                            colHovered && cellState === 'lowest' && MATRIX.colHover,
                            cellState === 'default' && awardMode === 'per_batch' && perBatchPick === v.vendor_id && 'bg-brand-50/40',
                            canPickThis ? 'cursor-pointer hover:bg-brand-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500' : '')}
                          role={canPickThis ? 'button' : undefined}
                          tabIndex={canPickThis ? 0 : -1}
                          aria-pressed={canPickThis ? isPickedCell : undefined}
                          onClick={canPickThis ? togglePick : undefined}
                          onMouseEnter={() => setHoverVid(v.vendor_id)}
                          onMouseLeave={() => setHoverVid(null)}
                          onKeyDown={canPickThis ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePick(); }
                          } : undefined}
                          title={canPickThis ? 'Bấm để chọn / bỏ chọn mã này cho NCC này' : 'Bấm để xem báo giá đầy đủ'}
                          onClickCapture={!canPickThis ? () => setDrawer({
                            vendorId: v.vendor_id,
                            vendorName: vendorById.get(v.vendor_id)?.company_name ?? `NCC #${v.vendor_id}`,
                            itemId: it.item_id,
                          }) : undefined}
                        >
                          <div className={cn(TYPE.matrixPrice, 'group/cell flex items-center justify-end gap-1',
                            cellState === 'awarded' ? 'font-bold text-brand-700'
                              : cellState === 'picked' ? 'font-bold text-brand-700'
                                : cellState === 'lowest' ? MATRIX.lowestText
                                  : dimmed ? MATRIX.dimmed : 'text-slate-700')}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDrawer({
                                  vendorId: v.vendor_id,
                                  vendorName: vendorById.get(v.vendor_id)?.company_name ?? `NCC #${v.vendor_id}`,
                                  itemId: it.item_id,
                                });
                              }}
                              title="Xem báo giá đầy đủ của NCC"
                              aria-label="Xem báo giá đầy đủ"
                              className="opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-opacity p-0.5 -ml-0.5 rounded text-slate-400 hover:text-brand-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-400"
                            >
                              <Eye className="h-3 w-3" />
                            </button>
                            {isAwardedCell && <Award className="h-3 w-3 text-brand-600 shrink-0" />}
                            {!isAwardedCell && isPickedCell && <CheckCircle2 className="h-3 w-3 text-brand-600 shrink-0" />}
                            {cell.is_foc ? (
                              <span className="font-semibold text-emerald-600">FOC</span>
                            ) : (
                              <>
                                {fmtMoney(cell.unit_price)}
                                {cell.currency && <span className={TYPE.currencySuffix}>{cell.currency}</span>}
                              </>
                            )}
                          </div>
                          {/* Đợt 4 — quy đổi VND dưới giá gốc (ADDITIVE, chỉ ngoại tệ; sealed→BE null→ẩn) */}
                          {!cell.is_foc && cell.unit_price != null && cell.currency !== 'VND' && cell.vnd_equiv != null && (
                            <div className={cn('text-right text-[11px] text-slate-400 tabular-nums mt-0.5', dimmed && 'opacity-50')}>
                              ≈ {fmtMoney(cell.vnd_equiv)} ₫
                            </div>
                          )}
                          {!cell.is_foc && cell.unit_price != null && cell.fx_missing && (
                            <div className="text-right text-[11px] font-medium text-amber-600 mt-0.5"
                              title="Không có tỷ giá tại ngày chốt thầu — không quy đổi được sang VND">
                              thiếu tỷ giá
                            </div>
                          )}
                          {/* M4 Tier2 — Δ giá so vòng trước (emerald=giảm, rose=tăng) */}
                          {cell.delta != null && cell.delta_pct != null && (
                            <div className={cn('flex items-center justify-end gap-0.5 mt-0.5 text-[11px] font-medium tabular-nums',
                              dimmed && 'opacity-50',
                              cell.delta === 0 ? 'text-slate-400' : cell.delta < 0 ? 'text-emerald-600' : 'text-rose-600')}
                              title={`Vòng trước: ${cell.prior_unit_price != null ? fmtMoney(cell.prior_unit_price) : '—'}`}>
                              {cell.delta === 0 ? '=' : cell.delta < 0 ? '▼' : '▲'} {Math.abs(cell.delta_pct).toFixed(1)}%
                              <span className="text-slate-400 font-normal ml-0.5">vòng trước</span>
                            </div>
                          )}
                          {/* M2 Tier3 — CHỈ hiện khi NCC chào THIẾU hàng (offered < SL yêu cầu)
                              hoặc có MOQ. Bỏ dòng "SL = SL yêu cầu" thừa (gây lệch chiều cao hàng). */}
                          {!cell.is_foc && cell.can_do !== false && ((cell.offered_qty != null && it.quantity != null && cell.offered_qty < it.quantity) || cell.moq) && (
                            <div className={cn('flex items-center justify-end gap-1.5 mt-0.5 text-[11px] tabular-nums', dimmed && 'opacity-50')}>
                              {cell.offered_qty != null && it.quantity != null && cell.offered_qty < it.quantity && (
                                <span className="text-amber-600 font-medium">
                                  SL {fmtMoney(cell.offered_qty)}
                                </span>
                              )}
                              {cell.moq && <span className="text-slate-400">MOQ {cell.moq}</span>}
                            </div>
                          )}
                          <div className={cn('flex items-center justify-end gap-1 mt-0.5', dimmed && 'opacity-50')}>
                            {cell.notes && (
                              <span title={cell.notes} aria-label="Có ghi chú dòng">
                                <PencilLine className="h-2.5 w-2.5 text-slate-400" strokeWidth={2.25} />
                              </span>
                            )}
                            {cell.has_attachment && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDrawer({
                                    vendorId: v.vendor_id,
                                    vendorName: vendorById.get(v.vendor_id)?.company_name ?? `NCC #${v.vendor_id}`,
                                    itemId: it.item_id,
                                  });
                                }}
                                title="Có file đính kèm — bấm để xem/tải"
                                aria-label="Xem file đính kèm của NCC"
                                className="text-[11px] leading-none transition-transform hover:scale-125 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-400 rounded"
                              >
                                📎
                              </button>
                            )}
                            {cell.lead_time_days != null && (
                              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-100 text-slate-500 text-[11px] font-medium">
                                <Clock className="h-2.5 w-2.5" />{cell.lead_time_days}n
                              </span>
                            )}
                            {cell.can_do === false && (
                              <span className="inline-flex items-center px-1 py-0.5 rounded bg-rose-50 text-rose-600 text-[11px] font-medium">Không làm</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            {/* Footer: per-vendor total */}
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <MatrixFreezeCol scrolled={scrolledX} className={cn('bg-slate-50', TYPE.th)}>Tổng báo giá</MatrixFreezeCol>
                <td></td>
                <td className="border-r border-slate-200"></td>
                {vendors.map((v) => {
                  const colHovered = hoverVid === v.vendor_id;
                  return (
                    <td key={v.vendor_id} className={cn('px-3 py-2.5 text-right font-mono tabular-nums text-[12px] font-bold text-slate-700 transition-colors',
                      colHovered && MATRIX.colHover,
                      awardMode === 'per_batch' && perBatchPick === v.vendor_id ? 'bg-brand-50' : '')}>
                      {v.total_amount != null ? <>{fmtMoney(v.total_amount)}<span className={TYPE.currencySuffix}>{v.currency}</span></> : <span className="text-slate-300">—</span>}
                      {/* Đợt 4 — tổng quy đổi VND của NCC (chỉ ngoại tệ; sealed→total null→ẩn) */}
                      {v.total_amount != null && v.currency !== 'VND' && v.vnd_equiv_total != null && (
                        <div className="text-[11px] font-normal text-slate-400">≈ {fmtMoney(v.vnd_equiv_total)} ₫</div>
                      )}
                      {v.total_amount != null && v.fx_missing && (
                        <div className="text-[11px] font-medium text-amber-600" title="Thiếu tỷ giá tại ngày chốt thầu">thiếu tỷ giá</div>
                      )}
                    </td>
                  );
                })}
              </tr>
              {/* Per-currency grand totals (no cross-currency sum) + response count */}
              <tr className="bg-slate-50/60">
                <td colSpan={3 + vendors.length} className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                    <CurrencyTotalRow totals={currencyTotals} />
                    <span className="text-[11px] text-slate-500">
                      Phản hồi{' '}
                      <b className="font-mono tabular-nums font-semibold text-slate-700">{matrixSubmitted}</b>
                      <span className="text-slate-400">/{matrixInvited}</span> NCC
                    </span>
                  </div>
                  {/* Đợt 4 — tổng quy đổi VND gộp (SONG SONG, để so sánh đa tiền tệ).
                      Chỉ hiện khi BE trả vnd (không sealed) và batch có ≥1 ngoại tệ. */}
                  {vndGrandTotal != null && currencyTotals.some((t) => t.currency !== 'VND' && t.currency !== '—') && (
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-slate-200/70 pt-1.5">
                      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                        <span className="text-[11px] text-slate-400">≈ Tổng quy đổi VND</span>
                        <b className="font-mono text-[13px] font-bold tabular-nums text-slate-900">{vndGrandTotal.toLocaleString('vi-VN')}</b>
                        <span className={TYPE.currencySuffix}>₫</span>
                      </span>
                      {fxAsOf && <span className="text-[11px] text-slate-400">· tỷ giá ngày {fmtDateVN(fxAsOf)}</span>}
                    </div>
                  )}
                  {fxMissingCount > 0 && (
                    <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {fxMissingCount} ô thiếu tỷ giá — tổng quy đổi VND chưa gồm các ô này
                    </div>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* per_item confirm modal */}
      {pendingAwards && (
        <AwardModal
          batchId={batchId}
          mode="per_item"
          isReAward={isReAward}
          perItem={pendingAwards}
          onClose={() => setPendingAwards(null)}
          onDone={() => { setPendingAwards(null); setPerItemPick({}); }}
        />
      )}

      {/* per_batch confirm modal */}
      {perBatchVendor && (
        <AwardModal
          batchId={batchId}
          mode="per_batch"
          isReAward={isReAward}
          perBatch={perBatchVendor}
          onClose={() => setPerBatchVendor(null)}
          onDone={() => { setPerBatchVendor(null); setPerBatchPick(null); }}
        />
      )}

      {/* P6 — write awarded prices back into the sourcing library */}
      {showWriteBack && (
        <WriteBackModal batchId={batchId} onClose={() => setShowWriteBack(false)} />
      )}

      {/* Full-quote drawer (P5) */}
      {drawer && (
        <QuoteDrawer
          batchId={batchId}
          vendorId={drawer.vendorId}
          vendorName={drawer.vendorName}
          focusItemId={drawer.itemId}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

// ─── Award Modal (REQUIRES award_reason) ────────────────────────

function AwardModal({
  batchId, mode, isReAward, perItem, perBatch, onClose, onDone,
}: {
  batchId: number;
  mode: 'per_item' | 'per_batch';
  isReAward: boolean;
  perItem?: PendingAward[];
  perBatch?: MatrixVendor;
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [criteria, setCriteria] = useState('');
  const [saving, setSaving] = useState(false);
  const [reasonTouched, setReasonTouched] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useModalDismiss(onClose);
  useEffect(() => { reasonRef.current?.focus(); }, []);
  const reasonInvalid = reasonTouched && !reason.trim();

  const handleAward = async () => {
    if (!reason.trim()) { setReasonTouched(true); reasonRef.current?.focus(); toast.error('Lý do chốt là bắt buộc'); return; }
    setSaving(true);
    try {
      const payload: Record<string, any> = { award_reason: reason.trim() };
      if (criteria.trim()) payload.criteria = criteria.trim();
      if (mode === 'per_item' && perItem) {
        payload.awards = perItem.map((a) => ({
          item_id: a.item_id,
          vendor_id: a.vendor_id,
          price: a.price,
          currency: a.currency,
          ...(a.quantity != null ? { quantity: a.quantity } : {}),
        }));
      } else if (mode === 'per_batch' && perBatch) {
        payload.vendor_id = perBatch.vendor_id;
      }
      const res = await api.post<{ message?: string; data?: { awarded_count?: number; superseded_count?: number; award_status?: string } }>(
        `/api/v1/procurement/batches/${batchId}/award`, payload,
      );
      const n = res?.data?.awarded_count ?? (mode === 'per_item' ? perItem?.length ?? 0 : 1);
      const sup = res?.data?.superseded_count ?? 0;
      // Đợt 3 — nếu cổng tài chính treo award (proposed), dùng message của BE
      // ("Đã gửi đề xuất chốt thầu — chờ người thứ hai duyệt") thay vì "đã chốt".
      toast.success(
        res?.data?.award_status === 'proposed'
          ? (res?.message ?? 'Đã gửi đề xuất chốt thầu — chờ người thứ hai duyệt')
          : (res?.message ?? `Đã chốt ${n} mã trúng thầu${sup ? ` (thay ${sup} chốt cũ)` : ''}`),
      );
      queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-matrix', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-invitations', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
      onDone();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div className={cn(MODAL_PANEL, 'w-full max-w-lg max-h-[90vh] flex flex-col')}
        role="dialog" aria-modal="true" aria-label="Chốt nhà cung cấp trúng thầu" onClick={(e) => e.stopPropagation()}>
        <div className={MODAL_HEADER}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shadow-sm shrink-0">
              <Award className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-base font-bold text-slate-800">
              {isReAward ? 'Chốt lại nhà cung cấp trúng thầu' : 'Chốt nhà cung cấp trúng thầu'}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={MODAL_CLOSE}><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isReAward && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Phiên đã chốt trước đó. Thao tác này sẽ <b>thay thế</b> kết quả cũ (lưu lịch sử trong nhật ký).</span>
            </div>
          )}

          {mode === 'per_item' && perItem && (
            <div>
              <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Sẽ chốt {perItem.length} mã:</p>
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-52 overflow-y-auto">
                {perItem.map((a) => (
                  <div key={a.item_id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-semibold text-brand-700 truncate">{a.bqms_code ?? `#${a.item_no}`}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[200px]" title={a.specification}>{a.specification}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] font-semibold text-slate-800 truncate max-w-[140px]" title={a.company_name}>{a.company_name}</div>
                      <div className="font-mono text-[11px] text-emerald-700">{fmtMoney(a.price)} {a.currency}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mode === 'per_batch' && perBatch && (
            <div className="rounded-lg border border-brand-300 bg-brand-50 p-3">
              <p className="text-[11px] uppercase tracking-wide font-semibold text-brand-600 mb-0.5">NCC trúng cả gói</p>
              <div className="text-sm font-bold text-slate-800">{perBatch.company_name}</div>
              <div className="font-mono text-[12px] text-emerald-700 mt-0.5">
                Tổng {perBatch.total_amount != null ? fmtMoney(perBatch.total_amount) : '—'} {perBatch.currency ?? ''}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="award-reason" className="block text-[11px] font-semibold text-slate-600 mb-1">Lý do chốt *</label>
            <textarea id="award-reason" ref={reasonRef} rows={3} value={reason}
              onChange={(e) => setReason(e.target.value)} onBlur={() => setReasonTouched(true)}
              aria-required="true" aria-invalid={reasonInvalid}
              aria-describedby={reasonInvalid ? 'award-reason-err' : undefined}
              placeholder="VD: Giá thấp nhất + lead-time ngắn + đã từng làm tốt mã tương tự…"
              className={cn('w-full px-3 py-2 border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 transition-all',
                reasonInvalid ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : 'border-slate-200 focus:border-brand-400 focus:ring-brand-100')} />
            {reasonInvalid
              ? <p id="award-reason-err" role="alert" className="text-[11px] text-rose-600 mt-1">Lý do chốt là bắt buộc — lưu vào nhật ký audit.</p>
              : <p className="text-[11px] text-slate-400 mt-1">Bắt buộc — lưu vào nhật ký audit.</p>}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tiêu chí (tuỳ chọn)</label>
            <input value={criteria} onChange={(e) => setCriteria(e.target.value)}
              placeholder="VD: giá / lead-time / chất lượng"
              className={INPUT_CLS} />
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg disabled:opacity-50 transition-colors">Huỷ</button>
          <button onClick={handleAward} disabled={saving || !reason.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />}
            {isReAward ? 'Chốt lại' : 'Xác nhận chốt'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Write-Back Modal (P6: award → sourcing library "flywheel") ──
// Confirm dialog → POST /write-back-sourcing. Each winning award's vendor+price
// becomes a sourcing_supplier_prices row (giá trúng = giá nhập). Idempotent on
// the backend (written_back flag), so re-running only writes new awards.

interface WriteBackResult {
  written: Array<{ award_id: number; item_code: string | null; supplier_name: string; price: number | null; sourcing_entry_id: number; matched_by?: string }>;
  skipped: Array<{ item_code: string | null; reason: string }>;
  already_done: number;
}

const WB_SKIP_REASON_VI: Record<string, string> = {
  no_catalog_entry: 'chưa có trong thư viện',
  per_batch_award: 'chốt cả gói (không map 1 mã)',
  no_price: 'thiếu giá',
  no_supplier: 'thiếu NCC',
};

function WriteBackModal({ batchId, onClose }: { batchId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<WriteBackResult | null>(null);
  useModalDismiss(onClose);

  const handleWriteBack = async () => {
    setSaving(true);
    try {
      const res = await api.post<{ message?: string; data?: WriteBackResult }>(
        `/api/v1/procurement/batches/${batchId}/write-back-sourcing`, {},
      );
      const d = res?.data;
      setResult(d ?? { written: [], skipped: [], already_done: 0 });
      const nW = d?.written?.length ?? 0;
      const nS = d?.skipped?.length ?? 0;
      const nA = d?.already_done ?? 0;
      if (nW > 0) toast.success(res?.message ?? `Đã lưu ${nW} giá trúng vào thư viện`);
      else if (nA > 0 && nS === 0) toast.info('Tất cả giá trúng đã được lưu trước đó');
      else toast.info(res?.message ?? 'Không có giá nào được lưu');
      queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div className={cn(MODAL_PANEL, 'w-full max-w-lg max-h-[90vh] flex flex-col')}
        role="dialog" aria-modal="true" aria-label="Lưu giá trúng vào Thư viện nguồn cung" onClick={(e) => e.stopPropagation()}>
        <div className={MODAL_HEADER}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shadow-sm shrink-0">
              <Library className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-base font-bold text-slate-800">Lưu giá trúng vào Thư viện nguồn cung</h2>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={MODAL_CLOSE}><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!result ? (
            <>
              <p className="text-sm text-slate-600 leading-relaxed">
                Mỗi mã đã chốt sẽ ghi <b>NCC trúng + giá trúng</b> (= giá nhập) thành một dòng giá trong
                <b> Thư viện nguồn cung</b>, để các phiên đấu thầu sau tự gợi ý NCC & giá.
              </p>
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-brand-600" />
                <span>
                  Mã <b>chưa có</b> trong thư viện sẽ được <b>bỏ qua</b> (không tự tạo mới) và liệt kê để bạn tự thêm.
                  Thao tác này <b>idempotent</b> — giá đã lưu trước đó không bị ghi lại.
                </span>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <WbStat label="Đã lưu" value={result.written.length} tone="emerald" />
                <WbStat label="Bỏ qua" value={result.skipped.length} tone="amber" />
                <WbStat label="Đã lưu trước" value={result.already_done} tone="slate" />
              </div>
              {result.written.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Đã lưu {result.written.length} dòng giá:</p>
                  <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-44 overflow-y-auto">
                    {result.written.map((w) => (
                      <div key={w.award_id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <div className="font-mono text-[11px] font-semibold text-brand-700 truncate">{w.item_code ?? `award #${w.award_id}`}</div>
                            {/* matched_by: 'source_ref' = chính xác từ catalog; 'code_or_model' = khớp mờ → owner nên rà */}
                            <span className={cn(
                              'shrink-0 rounded px-1 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                              w.matched_by === 'source_ref'
                                ? 'bg-brand-50 text-brand-700 ring-brand-100'
                                : 'bg-amber-50 text-amber-700 ring-amber-200',
                            )} title={w.matched_by === 'source_ref' ? 'Khớp chính xác từ Thư viện (catalog)' : 'Khớp theo mã/model — nên kiểm tra đúng mặt hàng'}>
                              {w.matched_by === 'source_ref' ? 'Catalog' : 'Khớp mã'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[180px]" title={w.supplier_name}>{w.supplier_name}</div>
                        </div>
                        <div className="font-mono text-[11px] text-emerald-700 shrink-0">{w.price != null ? fmtMoney(w.price) : '—'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result.skipped.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Bỏ qua {result.skipped.length} mã:</p>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/40 divide-y divide-amber-100 max-h-36 overflow-y-auto">
                    {result.skipped.map((s, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
                        <span className="font-mono font-semibold text-slate-700 truncate">{s.item_code ?? '—'}</span>
                        <span className="text-amber-700 shrink-0">{WB_SKIP_REASON_VI[s.reason] ?? s.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
          {!result ? (
            <>
              <button onClick={onClose} disabled={saving}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg disabled:opacity-50 transition-colors">Huỷ</button>
              <button onClick={handleWriteBack} disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Library className="h-4 w-4" />}
                Xác nhận lưu
              </button>
            </>
          ) : (
            <button onClick={onClose}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors">
              Xong
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function WbStat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'slate' }) {
  const cls = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-600';
  return (
    <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-center">
      <div className={cn('text-xl font-bold tabular-nums', cls)}>{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

// ─── Add Items Modal (P2: 6-source item picker) ─────────────────
// Six provenance-tracked sources, each tabbed; each posts to its own backend
// importer then invalidates the batch query. Restrained: brand-600 accent on a
// single active tab, slate elsewhere, MODAL_* tokens shared across all dialogs.

type AddSource = 'catalog' | 'paste' | 'manual' | 'bqms' | 'imv' | 'excel';

const ADD_SOURCES: Array<{ k: AddSource; label: string; icon: any }> = [
  { k: 'catalog', label: 'Danh mục', icon: LayoutGrid },
  { k: 'paste', label: 'Dán', icon: ClipboardPaste },
  { k: 'manual', label: 'Thủ công', icon: Wrench },
  { k: 'bqms', label: 'BQMS', icon: Package },
  { k: 'imv', label: 'IMV', icon: Database },
  { k: 'excel', label: 'Excel', icon: FileSpreadsheet },
];

/** Shared checkbox-row for the searchable multi-select tabs (Catalog, IMV). */
function PickRow({
  checked, onToggle, title, subtitle, meta,
}: {
  checked: boolean; onToggle: () => void; title: string; subtitle?: string; meta?: ReactNode;
}) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={checked}
      className={cn('w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        checked ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')}>
      <span className={cn('h-4 w-4 rounded border flex items-center justify-center shrink-0',
        checked ? 'bg-brand-600 border-brand-600' : 'border-slate-300')}>
        {checked && <CheckCircle2 className="h-3 w-3 text-white" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-800 truncate">{title}</div>
        {subtitle && <div className="text-[11px] text-slate-500 truncate">{subtitle}</div>}
      </div>
      {meta != null && <div className="text-[11px] text-slate-400 shrink-0 tabular-nums">{meta}</div>}
    </button>
  );
}

function AddItemsModal({ batchId, onClose }: { batchId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<AddSource>('catalog');
  const [saving, setSaving] = useState(false);
  useModalDismiss(onClose);

  // ── per-source local state ──
  const [bqmsCodesText, setBqmsCodesText] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [manualItem, setManualItem] = useState({ specification: '', bqms_code: '', quantity: '1', unit: 'EA', required_material: '', notes: '' });
  const [catalogSel, setCatalogSel] = useState<Set<number>>(new Set());
  const [catalogQ, setCatalogQ] = useState('');
  const [imvSel, setImvSel] = useState<Set<number>>(new Set());
  const [imvQ, setImvQ] = useState('');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
    queryClient.invalidateQueries({ queryKey: ['vb-batch-matrix', batchId] });
    queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
  };

  // ── Catalog: searchable sourcing list (fetch a generous page; filter client-side) ──
  const catalogQuery = useQuery<{ data: { items: any[] } }>({
    queryKey: ['vb-add-catalog'],
    queryFn: () => api.get<{ data: { items: any[] } }>('/api/v1/sourcing/?page=1&page_size=200&sort_by=updated_at&sort_dir=desc'),
    enabled: source === 'catalog',
  });
  const catalogRows = catalogQuery.data?.data?.items ?? [];
  const catalogFiltered = useMemo(() => {
    const term = catalogQ.trim().toLowerCase();
    if (!term) return catalogRows;
    return catalogRows.filter((r) =>
      [r.bqms_code, r.model, r.product_name, r.maker, r.supplier_name]
        .some((f) => String(f ?? '').toLowerCase().includes(term)));
  }, [catalogRows, catalogQ]);

  // ── IMV: item-granular RFQ rows (server-side q search, single page) ──
  const imvQuery = useQuery<{ data: { items: any[] } }>({
    queryKey: ['vb-add-imv', imvQ],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200', offset: '0' });
      if (imvQ.trim()) params.set('q', imvQ.trim());
      return api.get<{ data: { items: any[] } }>(`/api/v1/imv/rfq/list?${params}`);
    },
    enabled: source === 'imv',
    placeholderData: keepPreviousData,
  });
  const imvRows = imvQuery.data?.data?.items ?? [];

  const toggleSet = (setFn: typeof setCatalogSel) => (id: number) =>
    setFn((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleCatalog = toggleSet(setCatalogSel);
  const toggleImv = toggleSet(setImvSel);

  // ── submit handlers (one per source) ──
  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    try { await fn(); } catch (e: any) { toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`); }
    finally { setSaving(false); }
  };

  const handleCatalog = () => run(async () => {
    if (catalogSel.size === 0) { toast.error('Chọn ít nhất 1 mục trong danh mục'); return; }
    const res = await api.post<{ imported?: number; skipped?: number }>(
      `/api/v1/procurement/batches/${batchId}/import-from-catalog`,
      { sourcing_entry_ids: Array.from(catalogSel) });
    const imported = res?.imported ?? 0, skipped = res?.skipped ?? 0;
    toast.success(`Đã thêm ${imported} mã từ danh mục${skipped ? `, bỏ qua ${skipped} trùng` : ''}`);
    invalidate(); onClose();
  });

  const handlePaste = () => run(async () => {
    if (!pasteText.trim()) { toast.error('Dán ít nhất 1 dòng'); return; }
    const res = await api.post<{ imported?: number; degraded?: number }>(
      `/api/v1/procurement/batches/${batchId}/import-paste`, { text: pasteText });
    const imported = res?.imported ?? 0, degraded = res?.degraded ?? 0;
    toast.success(`Đã thêm ${imported} mã${degraded ? `, ${degraded} dòng thiếu mã (lưu thủ công)` : ''}`);
    invalidate(); onClose();
  });

  const handleManual = () => run(async () => {
    if (!manualItem.specification.trim()) { toast.error('Cần specification'); return; }
    await api.post(`/api/v1/procurement/batches/${batchId}/items`, {
      items: [{
        specification: manualItem.specification.trim(),
        bqms_code: manualItem.bqms_code.trim() || null,
        quantity: Number(manualItem.quantity) || 1,
        unit: manualItem.unit || 'EA',
        required_material: manualItem.required_material.trim() || null,
        notes: manualItem.notes.trim() || null,
      }],
    });
    toast.success('Đã thêm mã'); invalidate(); onClose();
  });

  const handleBqms = () => run(async () => {
    const codes = bqmsCodesText.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!codes.length) { toast.error('Cần nhập ít nhất 1 mã'); return; }
    const res = await api.post<{ data?: { imported?: any[]; skipped_duplicates?: any[] } }>(
      `/api/v1/procurement/batches/${batchId}/import-from-bqms`, { bqms_codes: codes });
    const imported = res?.data?.imported?.length ?? 0;
    const skipped = res?.data?.skipped_duplicates?.length ?? 0;
    toast.success(`Đã import ${imported} mã${skipped ? `, bỏ qua ${skipped} duplicate` : ''}`);
    invalidate(); onClose();
  });

  const handleImv = () => run(async () => {
    if (imvSel.size === 0) { toast.error('Chọn ít nhất 1 dòng RFQ'); return; }
    const res = await api.post<{ imported?: number; skipped?: number }>(
      `/api/v1/procurement/batches/${batchId}/import-from-imv`,
      { imv_rfq_ids: Array.from(imvSel) });
    const imported = res?.imported ?? 0, skipped = res?.skipped ?? 0;
    toast.success(`Đã thêm ${imported} mã từ IMV${skipped ? `, bỏ qua ${skipped} trùng` : ''}`);
    invalidate(); onClose();
  });

  const handleExcel = () => run(async () => {
    if (!excelFile) { toast.error('Chọn file .xlsx'); return; }
    const fd = new FormData();
    fd.append('file', excelFile);
    const res = await api.upload<{ imported?: number; skipped?: number; degraded_count?: number }>(
      `/api/v1/procurement/batches/${batchId}/import-excel`, fd);
    const imported = res?.imported ?? 0, skipped = res?.skipped ?? 0, degraded = res?.degraded_count ?? 0;
    toast.success(`Đã thêm ${imported} mã từ Excel${skipped ? `, bỏ qua ${skipped} trùng` : ''}`);
    if (degraded) toast.warning(`${degraded} dòng thiếu mã hàng — lưu dạng thủ công`);
    invalidate(); onClose();
  });

  const pickExcel = (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) { toast.error('Chỉ nhận file .xlsx'); return; }
    setExcelFile(f);
  };

  // Footer submit button: mapped per source (label + handler + disabled).
  const submit: Record<AddSource, { fn: () => void; disabled: boolean; label: string }> = {
    catalog: { fn: handleCatalog, disabled: catalogSel.size === 0, label: `Thêm vào phiên${catalogSel.size ? ` (${catalogSel.size})` : ''}` },
    paste: { fn: handlePaste, disabled: !pasteText.trim(), label: 'Thêm vào phiên' },
    manual: { fn: handleManual, disabled: !manualItem.specification.trim(), label: 'Thêm vào phiên' },
    bqms: { fn: handleBqms, disabled: !bqmsCodesText.trim(), label: 'Thêm vào phiên' },
    imv: { fn: handleImv, disabled: imvSel.size === 0, label: `Thêm vào phiên${imvSel.size ? ` (${imvSel.size})` : ''}` },
    excel: { fn: handleExcel, disabled: !excelFile, label: 'Thêm vào phiên' },
  };
  const cur = submit[source];

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div className={cn(MODAL_PANEL, 'w-full max-w-2xl max-h-[90vh] flex flex-col')}
        role="dialog" aria-modal="true" aria-label="Thêm mã linh kiện" onClick={(e) => e.stopPropagation()}>
        <div className={MODAL_HEADER}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shadow-sm shrink-0">
              <Plus className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Thêm mã linh kiện</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">6 nguồn: danh mục · dán · thủ công · BQMS · IMV · Excel</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={MODAL_CLOSE}><X className="h-5 w-5" /></button>
        </div>

        {/* Source tabs */}
        <div role="tablist" aria-label="Nguồn dữ liệu" className="flex border-b border-slate-200 overflow-x-auto">
          {ADD_SOURCES.map((t) => {
            const Icon = t.icon;
            const active = source === t.k;
            return (
              <button key={t.k} role="tab" aria-selected={active} onClick={() => setSource(t.k)}
                className={cn('flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap',
                  active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Danh mục (catalog) ── */}
          {source === 'catalog' && (
            <div className="flex flex-col h-full">
              <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2">
                <Search className="h-4 w-4 text-slate-400" />
                <input role="searchbox" aria-label="Tìm trong danh mục" value={catalogQ} onChange={(e) => setCatalogQ(e.target.value)}
                  placeholder="Tìm theo mã BQMS / model / tên / hãng…" className="flex-1 outline-none text-sm placeholder:text-slate-400" />
                <span className="text-[11px] text-slate-500 tabular-nums">{catalogSel.size} đã chọn</span>
              </div>
              <div className="p-4 space-y-1.5">
                {catalogQuery.isLoading ? (
                  <div className="py-10 text-center text-slate-400 text-sm">Đang tải danh mục…</div>
                ) : catalogQuery.isError ? (
                  <div role="alert" className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>Không tải được danh mục. Thử lại.</p>
                  </div>
                ) : catalogFiltered.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 text-sm">Không tìm thấy mục nào trong danh mục.</div>
                ) : catalogFiltered.map((r) => (
                  <PickRow key={r.id} checked={catalogSel.has(r.id)} onToggle={() => toggleCatalog(r.id)}
                    title={r.product_name || r.model || r.bqms_code || `#${r.id}`}
                    subtitle={[r.bqms_code, r.model, r.maker].filter(Boolean).join(' · ') || undefined}
                    meta={r.supplier_name || (r.quantity != null ? `SL ${r.quantity}` : undefined)} />
                ))}
              </div>
            </div>
          )}

          {/* ── Dán (paste) ── */}
          {source === 'paste' && (
            <div className="p-6">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Dán bảng (mỗi dòng 1 mã, cột cách nhau bằng Tab)</label>
              <textarea autoFocus rows={9} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                placeholder={"Mã hàng\tTên sản phẩm\tSL\tĐVT\nABC-001\tVòng bi 6204\t10\tEA\nABC-002\tDây curoa A-50\t5\tEA"}
                className={cn(INPUT_CLS, 'font-mono resize-none text-xs')} />
              <p className="text-[11px] text-slate-500 mt-1">Thứ tự cột: mã hàng · tên · số lượng · đơn vị. Dòng thiếu mã sẽ lưu dạng thủ công.</p>
            </div>
          )}

          {/* ── Thủ công (manual) ── */}
          {source === 'manual' && (
            <div className="p-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Specification *</label>
                  <input autoFocus value={manualItem.specification} onChange={(e) => setManualItem({ ...manualItem, specification: e.target.value })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">BQMS code (optional)</label>
                  <input value={manualItem.bqms_code} onChange={(e) => setManualItem({ ...manualItem, bqms_code: e.target.value })} className={cn(INPUT_CLS, 'font-mono')} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Số lượng</label>
                  <div className="flex gap-1">
                    <input value={manualItem.quantity} onChange={(e) => setManualItem({ ...manualItem, quantity: e.target.value })} className={cn(INPUT_CLS, 'flex-1 font-mono tabular-nums')} />
                    <input value={manualItem.unit} onChange={(e) => setManualItem({ ...manualItem, unit: e.target.value })} placeholder="EA"
                      className={cn(INPUT_CLS, 'w-16')} />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Material</label>
                  <input value={manualItem.required_material} onChange={(e) => setManualItem({ ...manualItem, required_material: e.target.value })} placeholder="SUS304, POM, Al6061..." className={INPUT_CLS} />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ghi chú (NCC thấy)</label>
                  <textarea rows={2} value={manualItem.notes} onChange={(e) => setManualItem({ ...manualItem, notes: e.target.value })} className={cn(INPUT_CLS, 'resize-none')} />
                </div>
              </div>
            </div>
          )}

          {/* ── BQMS ── */}
          {source === 'bqms' && (
            <div className="p-6">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Danh sách BQMS code (mỗi mã 1 dòng hoặc cách nhau bằng dấu phẩy)</label>
              <textarea autoFocus rows={6} value={bqmsCodesText} onChange={(e) => setBqmsCodesText(e.target.value)}
                placeholder={"Z0000002-545198\nZ0000002-100123\n..."} className={cn(INPUT_CLS, 'font-mono resize-none')} />
              <p className="text-[11px] text-slate-500 mt-1">Hệ thống tự fetch specification, qty, bản vẽ từ bqms_rfq.</p>
            </div>
          )}

          {/* ── IMV ── */}
          {source === 'imv' && (
            <div className="flex flex-col h-full">
              <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2">
                <Search className="h-4 w-4 text-slate-400" />
                <input role="searchbox" aria-label="Tìm RFQ IMV" value={imvQ} onChange={(e) => setImvQ(e.target.value)}
                  placeholder="Tìm theo số RFQ / mã hàng / sản phẩm…" className="flex-1 outline-none text-sm placeholder:text-slate-400" />
                <span className="text-[11px] text-slate-500 tabular-nums">{imvSel.size} đã chọn</span>
              </div>
              <div className="p-4 space-y-1.5">
                {imvQuery.isLoading ? (
                  <div className="py-10 text-center text-slate-400 text-sm">Đang tải RFQ IMV…</div>
                ) : imvQuery.isError ? (
                  <div role="alert" className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>Không tải được RFQ IMV. Thử lại.</p>
                  </div>
                ) : imvRows.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 text-sm">Không tìm thấy dòng RFQ nào.</div>
                ) : imvRows.map((r) => (
                  <PickRow key={r.id} checked={imvSel.has(r.id)} onToggle={() => toggleImv(r.id)}
                    title={r.product_name || r.item_code || r.rfq_number || `#${r.id}`}
                    subtitle={[r.rfq_number, r.item_code, r.model].filter(Boolean).join(' · ') || undefined}
                    meta={r.quantity != null ? `SL ${r.quantity}${r.unit ? ` ${r.unit}` : ''}` : undefined} />
                ))}
              </div>
            </div>
          )}

          {/* ── Excel (drag-drop .xlsx) ── */}
          {source === 'excel' && (
            <div className="p-6">
              <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden"
                onChange={(e) => pickExcel(e.target.files?.[0] ?? null)} />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); pickExcel(e.dataTransfer.files?.[0] ?? null); }}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                  dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50')}>
                {excelFile ? (
                  <>
                    <FileSpreadsheet className="h-10 w-10 text-brand-600" />
                    <div className="text-sm font-semibold text-slate-800">{excelFile.name}</div>
                    <div className="text-[11px] text-slate-500">{(excelFile.size / 1024).toFixed(0)} KB · bấm để chọn file khác</div>
                  </>
                ) : (
                  <>
                    <UploadCloud className={cn('h-10 w-10', dragOver ? 'text-brand-600' : 'text-slate-400')} />
                    <div className="text-sm font-semibold text-slate-700">Kéo-thả file .xlsx vào đây</div>
                    <div className="text-[11px] text-slate-500">hoặc bấm để chọn từ máy</div>
                  </>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-2">Cột nhận diện: Mã hàng · Tên · Model · Spec · Hãng · ĐVT · SL (VI/EN). Dòng thiếu mã sẽ lưu dạng thủ công.</p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Huỷ</button>
          <button onClick={cur.fn} disabled={saving || cur.disabled}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {cur.label}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Invite Vendors Modal (pick login vendor_accounts) ──────────

function InviteVendorsModal({ batchId, onClose }: { batchId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [sending, setSending] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useModalDismiss(onClose);
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Only invite-able accounts = approved/active. Backend /vendors?status=approved.
  const { data, isLoading, isError } = useQuery<{ data: any[] }>({
    queryKey: ['vb-invite-vendor-picker'],
    queryFn: () => api.get<{ data: any[] }>('/api/v1/procurement/vendors?status=approved'),
  });
  const vendors = data?.data ?? [];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return vendors;
    return vendors.filter((v) =>
      String(v.company_name ?? '').toLowerCase().includes(term)
      || String(v.email ?? '').toLowerCase().includes(term)
      || String(v.contact_name ?? '').toLowerCase().includes(term),
    );
  }, [vendors, q]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (selected.size === 0) { toast.error('Chọn ít nhất 1 NCC'); return; }
    setSending(true);
    try {
      const res = await api.post<{ data?: { created?: any[]; skipped_existing?: any[]; failures?: any[] } }>(
        `/api/v1/procurement/batches/${batchId}/invite`,
        { vendor_ids: Array.from(selected) },
      );
      const created = res?.data?.created?.length ?? 0;
      const skipped = res?.data?.skipped_existing?.length ?? 0;
      const failures = res?.data?.failures?.length ?? 0;
      toast.success(`Đã mời ${created} NCC${skipped ? `, ${skipped} đã mời trước đó` : ''}${failures ? `, ${failures} lỗi` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['vb-batch-invitations', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-matrix', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
      onClose();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div className={cn(MODAL_PANEL, 'w-full max-w-2xl max-h-[90vh] flex flex-col')}
        role="dialog" aria-modal="true" aria-label="Mời NCC báo giá" onClick={(e) => e.stopPropagation()}>
        <div className={MODAL_HEADER}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shadow-sm shrink-0">
              <Send className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Mời NCC báo giá</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Chọn tài khoản NCC đã duyệt · họ login portal để báo giá (không dùng magic-link)</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={MODAL_CLOSE}><X className="h-5 w-5" /></button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input ref={searchRef} role="searchbox" aria-label="Tìm NCC" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm NCC theo tên / email…"
            className="flex-1 outline-none text-sm placeholder:text-slate-400" />
          <span className="text-[11px] text-slate-500 tabular-nums">{selected.size} đã chọn</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {isLoading ? (
            <div className="py-10 text-center text-slate-400 text-sm">Đang tải danh sách NCC…</div>
          ) : isError ? (
            <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Không tải được danh sách NCC. Thử lại.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center">
              <div className="mx-auto h-16 w-16 rounded-lg bg-slate-100 flex items-center justify-center mb-3">
                <Building2 className="h-8 w-8 text-slate-400" />
              </div>
              <p className="font-semibold text-slate-700 text-base">Không có tài khoản NCC đã duyệt nào.</p>
              <p className="text-sm text-slate-500 mt-1">Duyệt NCC ở tab "Tài khoản NCC" trước khi mời.</p>
            </div>
          ) : (
            filtered.map((v) => {
              const checked = selected.has(v.id);
              return (
                <button key={v.id} type="button" onClick={() => toggle(v.id)} aria-pressed={checked}
                  className={cn('w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    checked ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')}>
                  <span className={cn('h-4 w-4 rounded border flex items-center justify-center shrink-0',
                    checked ? 'bg-brand-600 border-brand-600' : 'border-slate-300')}>
                    {checked && <CheckCircle2 className="h-3 w-3 text-white" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-800 truncate">{v.company_name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{v.email}{v.contact_name ? ` · ${v.contact_name}` : ''}</div>
                  </div>
                  <div className="text-[11px] text-slate-400 shrink-0 tabular-nums">{v.quote_count ?? 0} báo giá</div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500 max-w-[58%] leading-relaxed">
            NCC được cấp quyền vào phiên ngay. Hệ thống <b>không gửi email</b> — bạn gửi link
            đăng nhập cổng NCC cho họ.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Huỷ</button>
            <button onClick={handleSend} disabled={sending || selected.size === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Mời {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Open Round Modal (reverse-auction V2/V3) ───────────────────

function OpenRoundModal({
  batchId, nextRound, maxRounds, vendors, onClose,
}: {
  batchId: number;
  nextRound: number;
  maxRounds: number;
  vendors: InvitationRow[];          // current-round invitations (carry-forward pool)
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // Default: carry forward everyone who hasn't declined the current round.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(vendors.filter((v) => v.status !== 'declined').map((v) => v.vendor_id)),
  );
  const [deadline, setDeadline] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const deadlineRef = useRef<HTMLInputElement>(null);
  const nowLocal = useMemo(() => nowDatetimeLocal(), []);
  useModalDismiss(onClose);
  useEffect(() => { deadlineRef.current?.focus(); }, []);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleOpen = async () => {
    if (selected.size === 0) { toast.error('Chọn ít nhất 1 NCC mang sang vòng mới'); return; }
    setSending(true);
    try {
      const payload: Record<string, any> = {
        round_number: nextRound,
        vendor_ids: Array.from(selected),
      };
      if (deadline) payload.deadline = new Date(deadline).toISOString();
      if (message.trim()) payload.message = message.trim();
      const res = await api.post<{ message?: string; data?: { created?: any[]; skipped_existing?: any[]; failures?: any[] } }>(
        `/api/v1/procurement/batches/${batchId}/open-round`, payload,
      );
      const created = res?.data?.created?.length ?? 0;
      const skipped = res?.data?.skipped_existing?.length ?? 0;
      const failures = res?.data?.failures?.length ?? 0;
      toast.success(res?.message ?? `Đã mở vòng ${nextRound} cho ${created} NCC${skipped ? `, ${skipped} đã có` : ''}${failures ? `, ${failures} lỗi` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['vb-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-invitations', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-matrix', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-batch-audit', batchId] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
      onClose();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div className={cn(MODAL_PANEL, 'w-full max-w-xl max-h-[90vh] flex flex-col')}
        role="dialog" aria-modal="true" aria-label={`Mở vòng ${nextRound}`} onClick={(e) => e.stopPropagation()}>
        <div className={MODAL_HEADER}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500 flex items-center justify-center shadow-sm shrink-0">
              <ArrowUpCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Mở vòng {nextRound} (đấu giá ngược)</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                NCC được mời lại sẽ thấy giá vòng trước làm mốc và báo lại giá tốt hơn · tối đa {maxRounds} vòng
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={MODAL_CLOSE}><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
              NCC mang sang vòng {nextRound} <span className="text-slate-400 font-normal">({selected.size} đã chọn)</span>
            </label>
            {vendors.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
                Vòng hiện tại chưa có NCC nào để mang sang.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {vendors.map((v) => {
                  const checked = selected.has(v.vendor_id);
                  const declined = v.status === 'declined';
                  return (
                    <button key={v.vendor_id} type="button" onClick={() => toggle(v.vendor_id)} aria-pressed={checked}
                      className={cn('w-full flex items-center gap-3 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400',
                        checked ? 'bg-amber-50' : 'hover:bg-slate-50')}>
                      <span className={cn('h-4 w-4 rounded border flex items-center justify-center shrink-0',
                        checked ? 'bg-amber-500 border-amber-500' : 'border-slate-300')}>
                        {checked && <CheckCircle2 className="h-3 w-3 text-white" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-800 truncate">{v.company_name}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {v.email}
                          {v.my_quote?.total_amount != null && (
                            <span className="ml-1 text-emerald-700 font-mono tabular-nums">· vòng trước {fmtMoney(v.my_quote.total_amount)} {v.my_quote.currency}</span>
                          )}
                        </div>
                      </div>
                      {declined && <span className="text-[11px] font-semibold text-rose-600 shrink-0">đã từ chối</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Hạn báo giá vòng {nextRound} (tuỳ chọn)</label>
              <input ref={deadlineRef} type="datetime-local" min={nowLocal} value={deadline} onChange={(e) => setDeadline(e.target.value)}
                className={INPUT_CLS} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Lời nhắn (tuỳ chọn)</label>
              <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder="VD: Mời quý NCC báo lại giá tốt hơn cho vòng cuối…"
                className={cn(INPUT_CLS, 'resize-none')} />
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500 max-w-[55%] leading-relaxed">
            NCC được mang sang vòng mới ngay. Hệ thống <b>không gửi email</b> — bạn gửi link
            đăng nhập cho họ.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Huỷ</button>
            <button onClick={handleOpen} disabled={sending || selected.size === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg disabled:opacity-50 transition-colors">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpCircle className="h-4 w-4" />}
              Mở vòng {nextRound} {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Audit Timeline ─────────────────────────────────────────────

function AuditTimeline({ batchId }: { batchId: number }) {
  const [filter, setFilter] = useState<'all' | 'batch' | 'invitation' | 'quote' | 'award'>('all');

  const { data, isLoading, isError } = useQuery<AuditResp>({
    queryKey: ['vb-batch-audit', batchId, filter],
    queryFn: () => {
      const p = new URLSearchParams({ limit: '200' });
      if (filter !== 'all') p.set('entity_type', filter);
      return api.get<AuditResp>(`/api/v1/procurement/batches/${batchId}/audit?${p}`);
    },
    refetchInterval: 20000,
    placeholderData: keepPreviousData,
  });

  const entries = data?.data ?? [];

  const FILTERS: Array<{ k: typeof filter; vi: string }> = [
    { k: 'all', vi: 'Tất cả' },
    { k: 'batch', vi: 'Phiên' },
    { k: 'invitation', vi: 'Lời mời' },
    { k: 'quote', vi: 'Báo giá' },
    { k: 'award', vi: 'Chốt thầu' },
  ];

  return (
    <div className="space-y-4">
      <div className={cn(ELEVATION.container, RADIUS.container, 'p-3 flex items-center gap-2')}>
        <History className="h-4 w-4 text-slate-400 ml-1" />
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
          {FILTERS.map((f) => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className={cn('px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all', DEPTH.focusRing,
                filter === f.k ? 'bg-white text-brand-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)]' : 'text-slate-500 hover:text-slate-700')}>
              {f.vi}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-500 pr-2 tabular-nums">{entries.length} sự kiện</span>
      </div>

      <div className={cn(ELEVATION.container, RADIUS.container, 'p-5')}>
        {isLoading && !data ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />)}
          </div>
        ) : isError && !data ? (
          <div className={cn('flex items-start gap-3 px-4 py-3 text-sm', RADIUS.container, BADGE.rose.bg, BADGE.rose.text, BADGE.rose.ring)} role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Không tải được nhật ký. Thử tải lại trang.</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mx-auto h-16 w-16 rounded-lg bg-slate-100 flex items-center justify-center mb-3">
              <History className="h-8 w-8 text-slate-400" />
            </div>
            <p className="font-semibold text-slate-700 text-base">Chưa có sự kiện nào.</p>
            <p className="mt-1 text-sm text-slate-500">Mọi thao tác (publish, mời, báo giá, chốt) sẽ ghi lại ở đây.</p>
          </div>
        ) : (
          <ol className="relative border-l-2 border-slate-100 ml-2 space-y-4">
            {entries.map((e) => {
              const a = AUDIT_ACTION[e.action] ?? { vi: e.action, cls: 'bg-slate-50 text-slate-700 border-slate-200' };
              const actor = e.actor_name ?? e.actor_vendor_name ?? null;
              const isVendor = !e.actor_name && !!e.actor_vendor_name;
              return (
                <li key={e.id} className="ml-5 relative">
                  <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-brand-500 ring-4 ring-white" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 ring-1 ring-inset text-[11px] font-semibold', a.cls)}>
                      {a.vi}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">{e.entity_type}#{e.entity_id}</span>
                    {(e.from_status || e.to_status) && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                        {e.from_status && <span className="px-1.5 py-0.5 rounded bg-slate-100">{e.from_status}</span>}
                        <ChevronRight className="h-3 w-3 text-slate-300" />
                        {e.to_status && <span className="px-1.5 py-0.5 rounded bg-slate-100 font-medium">{e.to_status}</span>}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-slate-400 font-mono whitespace-nowrap tabular-nums">{fmtDateTimeVN(e.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-600">
                    {isVendor ? <Building2 className="h-3 w-3 text-amber-500" /> : <UserIcon className="h-3 w-3 text-brand-500" />}
                    <span className="font-medium">{actor ?? 'Hệ thống'}</span>
                    {isVendor && <span className="text-[11px] text-amber-600">(NCC)</span>}
                  </div>
                  {e.detail && Object.keys(e.detail).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {Object.entries(e.detail)
                        .filter(([, val]) => val !== null && val !== undefined && val !== '')
                        .map(([k, val]) => {
                          const raw = typeof val === 'object' ? JSON.stringify(val) : String(val);
                          const long = raw.length > 40;
                          return (
                            <span key={k}
                              title={long ? `${k}: ${raw}` : undefined}
                              className="inline-flex items-center gap-1 rounded bg-slate-50 ring-1 ring-slate-200/70 px-1.5 py-0.5 text-[11px] text-slate-600 break-words max-w-full">
                              <span className="font-semibold text-slate-500">{k}:</span>
                              <span className="font-mono">{long ? `${raw.slice(0, 40)}…` : raw}</span>
                            </span>
                          );
                        })}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

// ─── Contracts Panel (batch-scoped) ─────────────────────────────

function ContractsPanel({
  batchId, batchStatus, contracts,
}: {
  batchId: number;
  batchStatus: string;
  contracts: Contract[];
}) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Only batches that have been awarded can have awarded items → contracts.
  const canCreate = batchStatus === 'awarded';

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['vb-batch-contracts', batchId] });
    queryClient.invalidateQueries({ queryKey: ['vb-contracts'] });
    queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
  };

  const runAction = async (
    c: Contract,
    action: 'generate-pdf' | 'send-to-vendor' | 'activate',
    okMsg: string,
  ) => {
    setBusyId(c.id);
    try {
      const res = await api.post<{ message?: string }>(`/api/v1/procurement/contracts/${c.id}/${action}`, {});
      toast.success(res?.message ?? okMsg);
      invalidate();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-slate-500">
          Sau khi <b>chốt thầu</b>, tạo hợp đồng cho NCC trúng → sinh PDF → gửi NCC ký trên portal → kích hoạt.
        </p>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!canCreate}
          title={canCreate ? '' : 'Cần chốt thầu (status = Đã chốt) trước khi tạo hợp đồng'}
          className={cn(BUTTON.base, 'h-9 px-3 bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shrink-0')}
        >
          <FileSignature className="h-4 w-4" /> Tạo hợp đồng từ kết quả award
        </button>
      </div>

      {contracts.length === 0 ? (
        <EmptyState icon={FileSignature} title="Chưa có hợp đồng cho phiên này."
          hint={canCreate
            ? 'Bấm "Tạo hợp đồng từ kết quả award" để tạo hợp đồng cho NCC trúng thầu.'
            : 'Chốt thầu ở tab "So sánh & chốt" trước, rồi quay lại tạo hợp đồng.'} />
      ) : (
        <div className="space-y-3">
          {contracts.map((c) => (
            <ContractCard key={c.id} c={c} busy={busyId === c.id} onAction={runAction} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateContractModal
          batchId={batchId}
          existing={contracts}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); invalidate(); }}
        />
      )}
    </div>
  );
}

function ContractCard({
  c, busy, onAction,
}: {
  c: Contract;
  busy: boolean;
  onAction: (c: Contract, action: 'generate-pdf' | 'send-to-vendor' | 'activate', okMsg: string) => void;
}) {
  const [showCreatePO, setShowCreatePO] = useState(false);
  const st = CONTRACT_STATUS[c.status] ?? CONTRACT_STATUS.draft;
  const hasPdf = !!c.contract_file_path;
  const canSend = c.status === 'draft' && hasPdf;
  const canActivate = c.status === 'signed';
  const canGenerate = ['draft', 'sent', 'signed', 'active'].includes(c.status);
  // A PO can only be created from an ACTIVE contract (backend guards status='active').
  const canCreatePO = c.status === 'active';

  return (
    <div className={cn(ELEVATION.interactive, RADIUS.container, 'p-4')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(TYPE.code, 'text-[13px]')}>{c.contract_no}</span>
            <StatusPill label={st.vi} tone={st.tone} />
            {hasPdf && (
              <StatusPill tone="emerald" variant="bare"
                label={<span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> Có PDF{c.pdf_generated_at ? ` · ${fmtDateVN(c.pdf_generated_at)}` : ''}</span>} />
            )}
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-800 truncate max-w-[420px]" title={c.vendor_name}>{c.vendor_name}</div>
          <div className="text-[11px] text-slate-500">
            {c.vendor_email ?? '—'} · {c.item_count} mã
            {c.total_amount != null && (
              <span className="ml-1 font-mono text-slate-700">· {fmtMoney(c.total_amount)}<span className={TYPE.currencySuffix}>{c.currency}</span></span>
            )}
            {c.po_count > 0 && <span className="ml-1 text-brand-600">· {c.po_count} PO</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {canGenerate && (
            <button onClick={() => onAction(c, 'generate-pdf', 'Đã sinh PDF')} disabled={busy}
              title="Render PDF hợp đồng (Gotenberg)"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Sinh PDF
            </button>
          )}
          {hasPdf && (
            <button onClick={() => openContractPdf(c.id)} disabled={busy}
              title="Mở/tải PDF hợp đồng"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors disabled:opacity-40">
              <Download className="h-3.5 w-3.5" /> Tải PDF
            </button>
          )}
          {canSend && (
            <button onClick={() => onAction(c, 'send-to-vendor', 'Đã gửi NCC')} disabled={busy}
              title="Gửi hợp đồng cho NCC qua email + mở portal ký"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg transition-colors disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Gửi NCC
            </button>
          )}
          {c.status === 'draft' && !hasPdf && (
            <span className="text-[11px] text-slate-400 italic px-1">Sinh PDF trước khi gửi</span>
          )}
          {canActivate && (
            <button onClick={() => onAction(c, 'activate', 'Đã kích hoạt hợp đồng')} disabled={busy}
              title="Kích hoạt hợp đồng sau khi NCC đã ký"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Kích hoạt
            </button>
          )}
          {canCreatePO && (
            <button onClick={() => setShowCreatePO(true)} disabled={busy}
              title="Tạo đơn mua (PO) từ hợp đồng đã hiệu lực"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-40">
              <Package className="h-3.5 w-3.5" /> Tạo PO
            </button>
          )}
        </div>
      </div>

      {showCreatePO && (
        <CreatePOModal contract={c} onClose={() => setShowCreatePO(false)} />
      )}

      {/* Lifecycle footer: sent / signed info */}
      {(c.sent_to_vendor_at || c.signed_at || c.status === 'sent') && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-[11px]">
          {c.sent_to_vendor_at && (
            <span className="inline-flex items-center gap-1 text-sky-700">
              <Send className="h-3 w-3" /> Gửi NCC: <span className="font-mono">{fmtDateTimeVN(c.sent_to_vendor_at)}</span>
            </span>
          )}
          {c.signed_at ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> NCC ký: <b>{c.signed_by_vendor ?? 'NCC'}</b>
              <span className="font-mono text-emerald-600">· {fmtDateTimeVN(c.signed_at)}</span>
            </span>
          ) : c.status === 'sent' ? (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Clock className="h-3 w-3" /> Đang chờ NCC ký trên portal
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── Create Contract Modal (pick awarded vendor) ────────────────

interface AwardedVendor {
  vendor_id: number;
  company_name: string;
  total_amount: number | null;
  currency: string | null;
  item_count: number;
}

function CreateContractModal({
  batchId, existing, onClose, onDone,
}: {
  batchId: number;
  existing: Contract[];
  onClose: () => void;
  onDone: () => void;
}) {
  // Derive awarded vendors from the matrix: any vendor that won ≥1 item.
  const { data, isLoading } = useQuery<MatrixResp>({
    queryKey: ['vb-batch-matrix', batchId],
    queryFn: () => api.get<MatrixResp>(`/api/v1/procurement/batches/${batchId}/matrix`),
  });

  const [vendorId, setVendorId] = useState<number | null>(null);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryTerms, setDeliveryTerms] = useState('');
  const [warrantyTerms, setWarrantyTerms] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [saving, setSaving] = useState(false);

  // Vendor_ids that already have a (non-cancelled) contract on this batch.
  const contractedVendorIds = useMemo(
    () => new Set(existing.filter((c) => c.status !== 'cancelled').map((c) => c.vendor_id)),
    [existing],
  );

  const awardedVendors: AwardedVendor[] = useMemo(() => {
    const matrix = data?.data;
    if (!matrix) return [];
    const byVendor = new Map<number, AwardedVendor>();
    for (const it of matrix.items) {
      const vid = it.awarded_vendor_id ?? null;
      if (vid == null) continue;
      const v = matrix.vendors.find((x) => x.vendor_id === vid);
      const cur = byVendor.get(vid) ?? {
        vendor_id: vid,
        company_name: v?.company_name ?? `NCC #${vid}`,
        total_amount: 0,
        currency: it.awarded_currency ?? v?.currency ?? 'VND',
        item_count: 0,
      };
      cur.item_count += 1;
      const qty = Number(it.quantity ?? 0);
      const price = Number(it.awarded_price ?? 0);
      cur.total_amount = (cur.total_amount ?? 0) + qty * price;
      byVendor.set(vid, cur);
    }
    return Array.from(byVendor.values());
  }, [data]);

  const handleCreate = async () => {
    if (vendorId == null) { toast.error('Chọn 1 NCC trúng thầu'); return; }
    setSaving(true);
    try {
      const payload: Record<string, any> = { vendor_id: vendorId };
      if (paymentTerms.trim()) payload.payment_terms = paymentTerms.trim();
      if (deliveryTerms.trim()) payload.delivery_terms = deliveryTerms.trim();
      if (warrantyTerms.trim()) payload.warranty_terms = warrantyTerms.trim();
      if (effectiveDate) payload.effective_date = effectiveDate;
      if (expiryDate) payload.expiry_date = expiryDate;
      const res = await api.post<{ data?: { contract_no?: string }; message?: string }>(
        `/api/v1/procurement/batches/${batchId}/create-contract`, payload,
      );
      toast.success(res?.message ?? `Đã tạo hợp đồng ${res?.data?.contract_no ?? ''}`);
      onDone();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div className={cn(MODAL_PANEL, 'w-full max-w-xl max-h-[90vh] flex flex-col')} onClick={(e) => e.stopPropagation()}>
        <div className={MODAL_HEADER}>
          <div className="flex items-start gap-3">
            <span className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shadow-sm shrink-0">
              <FileSignature className="h-5 w-5 text-white" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">Tạo hợp đồng từ kết quả award</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Chọn NCC trúng thầu — hệ thống copy các mã đã chốt vào hợp đồng nháp.</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={MODAL_CLOSE}><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">NCC trúng thầu *</label>
            {isLoading ? (
              <div className="py-6 text-center text-slate-400 text-sm">Đang tải kết quả chốt thầu…</div>
            ) : awardedVendors.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
                Chưa có NCC nào được chốt thầu. Chốt thầu ở tab "So sánh & chốt" trước.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {awardedVendors.map((v) => {
                  const already = contractedVendorIds.has(v.vendor_id);
                  const checked = vendorId === v.vendor_id;
                  return (
                    <button key={v.vendor_id} type="button"
                      onClick={() => !already && setVendorId(v.vendor_id)}
                      disabled={already}
                      className={cn('w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                        already ? 'opacity-50 cursor-not-allowed'
                          : checked ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                      <span className={cn('h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0',
                        checked ? 'border-brand-600' : 'border-slate-300')}>
                        {checked && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-800 truncate">{v.company_name}</div>
                        <div className="text-[11px] text-slate-500">
                          {v.item_count} mã trúng
                          {v.total_amount != null && <span className="ml-1 font-mono text-emerald-700">· {fmtMoney(v.total_amount)} {v.currency}</span>}
                        </div>
                      </div>
                      {already && <span className="text-[11px] font-semibold text-slate-400 shrink-0">đã có HĐ</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ngày hiệu lực</label>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)}
                className={INPUT_CLS} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ngày hết hạn</label>
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)}
                className={INPUT_CLS} />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Điều khoản thanh toán</label>
            <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="Mặc định: Thanh toán 100% trong 30 ngày sau giao hàng"
              className={INPUT_CLS} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Điều khoản giao hàng</label>
            <input value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)}
              placeholder="Mặc định: Giao tại kho Song Châu"
              className={INPUT_CLS} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Điều khoản bảo hành</label>
            <input value={warrantyTerms} onChange={(e) => setWarrantyTerms(e.target.value)}
              placeholder="Mặc định: Bảo hành theo tiêu chuẩn nhà sản xuất"
              className={INPUT_CLS} />
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg disabled:opacity-50">Huỷ</button>
          <button onClick={handleCreate} disabled={saving || vendorId == null}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
            Tạo hợp đồng nháp
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create PO Modal (PO from an ACTIVE contract) ───────────────
// Mirrors CreateContractModal: same overlay/header/solid-brand-icon-tile/inputs/footer.

function CreatePOModal({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDismiss(onClose);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      if (requestedDeliveryDate) payload.requested_delivery_date = requestedDeliveryDate;
      if (deliveryAddress.trim()) payload.delivery_address = deliveryAddress.trim();
      if (notes.trim()) payload.notes = notes.trim();
      const res = await api.post<{ data?: { po_no?: string }; message?: string }>(
        `/api/v1/procurement/contracts/${contract.id}/create-po`, payload,
      );
      toast.success(res?.message ?? `Đã tạo PO ${res?.data?.po_no ?? ''}`.trim());
      // Refresh the PO list + stats (counts.pos / PO tab) and the contract lists so po_count updates.
      queryClient.invalidateQueries({ queryKey: ['vb-pos'] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
      queryClient.invalidateQueries({ queryKey: ['vb-contracts'] });
      if (contract.batch_id != null) {
        queryClient.invalidateQueries({ queryKey: ['vb-batch-contracts', contract.batch_id] });
      }
      onClose();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div className={cn(MODAL_PANEL, 'w-full max-w-lg max-h-[90vh] flex flex-col')} onClick={(e) => e.stopPropagation()}>
        <div className={MODAL_HEADER}>
          <div className="flex items-start gap-3">
            <span className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shadow-sm shrink-0">
              <Package className="h-5 w-5 text-white" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">Tạo đơn mua (PO)</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Từ hợp đồng <span className="font-mono text-brand-700">{contract.contract_no}</span> · {contract.vendor_name} — hệ thống copy toàn bộ mã vào PO.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={MODAL_CLOSE}><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ngày giao yêu cầu</label>
            <input type="date" value={requestedDeliveryDate} onChange={(e) => setRequestedDeliveryDate(e.target.value)}
              className={INPUT_CLS} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Địa chỉ giao</label>
            <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Mặc định: Kho Song Châu — 123 Đường ABC, Q.7, TP.HCM"
              className={INPUT_CLS} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ghi chú</label>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú cho đơn mua này (tuỳ chọn)…"
              className={cn(INPUT_CLS, 'resize-none')} />
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg disabled:opacity-50">Huỷ</button>
          <button onClick={handleCreate} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
            Tạo PO
          </button>
        </div>
      </div>
    </div>
  );
}
