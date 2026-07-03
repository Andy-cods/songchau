'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { motion, AnimatePresence } from 'framer-motion';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  BadgeCheck,
  Calculator,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cloud,
  DollarSign,
  Factory,
  FileEdit,
  FileText,
  HelpCircle,
  History,
  Image as ImageIcon,
  ImageOff,
  Layers,
  Loader2,
  Mail,
  Package,
  PackageCheck,
  Phone,
  Plus,
  PlusCircle,
  RotateCcw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Star,
  Tag,
  TestTube,
  Trash2,
  Truck,
  Upload,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';

import { api } from '@/lib/api';
import { cn, withToken } from '@/lib/utils';
import { NumberInput } from '@/components/shared/NumberInput';
import { CustomerPicker, type PickedCustomer } from '@/components/shared/CustomerPicker';

/* ─────────── Types ─────────── */

export interface SourcingEntry {
  id: number;
  bqms_code: string | null;
  customer_name: string | null;
  // Batch #4 (V3): FK to a CRM customer (null = free-text customer_name only).
  customer_id?: number | null;
  person_in_charge: string | null;
  model: string | null;
  product_name: string | null;
  maker: string | null;
  inquiry_date: string | null;
  cost_jpy: number | null;
  cost_usd: number | null;
  cost_krw: number | null;
  cost_rmb: number | null;
  cost_vnd: number | null;
  sale_vnd: number | null;
  quantity: number | null;
  tax_pct: number | null;
  hs_code: string | null;
  weight_kg: number | null;
  coefficient: number | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_email: string | null;
  image_url: string | null;
  notes: string | null;
  row_classification: string | null;
  exchange_rate: Record<string, number> | null;
  // 1b.2 — frozen FX snapshot (immutable, auditable): the rate + its effective
  // date applied to this entry's cost-currency at save time. Reopening an old
  // quote shows its ORIGINAL rate, not today's.
  fx_rate_snapshot?: number | null;
  fx_rate_date?: string | null;
  // Batch #1 (2026-06-27): frozen pricing context captured at "Áp dụng giá báo".
  // See backend migration sourcing_quote_snapshot.sql for the JSON shape.
  quote_snapshot?: Record<string, unknown> | null;
  // 2026-07-02: FedEx (quốc tế) + VN nội-địa shipping fees persisted on the entry
  // (migration sourcing_fedex_vn_ship_columns.sql). Read FIRST on reopen; the
  // quote_snapshot values are the fallback for entries predating the columns.
  fedex_fee_vnd?: number | null;
  vn_shipping_fee_vnd?: number | null;
  // A1 (2026-06-30): prior VN-shipping fee values (most-recent first) returned by
  // the backend on the entry. Optional — absent on older payloads.
  vn_shipping_history?: { value_vnd: number; at: string | null; by: string | null }[] | null;
  // A2 (2026-06-30): the primary supplier's typed cost in its OWN currency, added
  // by the backend list endpoint so the table can show e.g. "100 USD" instead of
  // the FX-converted cost_vnd. Optional — fall back to cost_vnd when absent.
  primary_cost_amount?: number | null;
  primary_cost_currency?: string | null;
  // Versioned pricing (2026-07-01): serializer adds a count + the newest version
  // number so the list/detail can badge "N đợt tính giá" without an extra fetch.
  pricing_snapshot_count?: number | null;
  latest_pricing_version?: number | null;
  created_by_email: string | null;
  updated_by_email?: string | null;
  created_at: string | null;
  updated_at?: string | null;
  // Extended catalog fields (read-only from backend enrichment)
  catalog_category?: string | null;
  catalog_status?: 'OK' | 'NEEDS_BRAND' | 'PRODUCT_CANDIDATE' | 'NOT_IN_CATALOG' | null;
  brand_canonical?: string | null;
  part_type?: string | null;
  subcategory_slug?: string | null;
  machine_model?: string | null;
  normalized_model?: string | null;
  stage?: 1 | 2 | 3 | null;
  missing_fields?: string[] | null;
  missing_count?: number | null;
  notes_internal?: string | null;
}

interface Props {
  entry: SourcingEntry | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}

type StatusKey = 'OK' | 'NEEDS_BRAND' | 'PRODUCT_CANDIDATE' | 'NOT_IN_CATALOG';

interface SuggestionItem {
  value: string;
}

interface SuggestionsResponse {
  customers?: SuggestionItem[];
  suppliers?: SuggestionItem[];
  makers?: SuggestionItem[];
  persons?: SuggestionItem[];
  brands?: SuggestionItem[];
  hs_codes?: SuggestionItem[];
}

const STATUS_LABEL: Record<StatusKey, string> = {
  OK: 'OK — đầy đủ',
  NEEDS_BRAND: 'Cần brand',
  PRODUCT_CANDIDATE: 'Product candidate',
  NOT_IN_CATALOG: 'Ngoài catalog',
};

const STATUS_BADGE: Record<StatusKey, string> = {
  OK: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  NEEDS_BRAND: 'bg-amber-50 text-amber-700 ring-amber-200',
  PRODUCT_CANDIDATE: 'bg-sky-50 text-sky-700 ring-sky-200',
  NOT_IN_CATALOG: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const STATUS_DOT: Record<StatusKey, string> = {
  OK: 'bg-emerald-500',
  NEEDS_BRAND: 'bg-amber-500',
  PRODUCT_CANDIDATE: 'bg-sky-500',
  NOT_IN_CATALOG: 'bg-rose-500',
};

/* ─── Order status (quote-to-order pipeline) ─── */
export type OrderStatusCode =
  | 'draft'
  | 'quoted'
  | 'confirmed'
  | 'payment_requested'
  | 'payment_approved'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export const ORDER_STATUS_META: Record<
  OrderStatusCode,
  { label: string; badgeClass: string; dotClass: string; icon: typeof FileEdit }
> = {
  draft: {
    label: 'Nháp',
    badgeClass: 'bg-slate-100 text-slate-700 ring-slate-200',
    dotClass: 'bg-slate-400',
    icon: FileEdit,
  },
  quoted: {
    label: 'Đã báo giá',
    badgeClass: 'bg-sky-50 text-sky-700 ring-sky-200',
    dotClass: 'bg-sky-500',
    icon: FileText,
  },
  confirmed: {
    label: 'Khách chốt',
    badgeClass: 'bg-brand-50 text-brand-700 ring-brand-200',
    dotClass: 'bg-brand-500',
    icon: CheckCircle2,
  },
  payment_requested: {
    label: 'Đề xuất TT',
    badgeClass: 'bg-amber-50 text-amber-700 ring-amber-200',
    dotClass: 'bg-amber-500',
    icon: Wallet,
  },
  payment_approved: {
    label: 'Đã duyệt TT',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dotClass: 'bg-emerald-500',
    icon: BadgeCheck,
  },
  shipped: {
    label: 'Đang giao',
    badgeClass: 'bg-sky-50 text-sky-700 ring-sky-200',
    dotClass: 'bg-sky-500',
    icon: Truck,
  },
  delivered: {
    label: 'Đã giao',
    badgeClass: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
    dotClass: 'bg-emerald-600',
    icon: PackageCheck,
  },
  cancelled: {
    label: 'Huỷ',
    badgeClass: 'bg-rose-50 text-rose-700 ring-rose-200',
    dotClass: 'bg-rose-500',
    icon: XCircle,
  },
};

export interface LinkedOrderSummary {
  id: number;
  order_number: string;
  status: OrderStatusCode;
  total_value_vnd?: number | null;
}

/* ─── Multi-supplier row (one row per NCC for a sourcing entry) ─── */
export type CurrencyCode = 'VND' | 'JPY' | 'USD' | 'KRW' | 'RMB' | 'EUR';

export const CURRENCY_OPTIONS: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: 'VND', symbol: '₫', label: 'Việt Nam Đồng' },
  { code: 'JPY', symbol: '¥', label: 'Yên Nhật' },
  { code: 'USD', symbol: '$', label: 'Đô la Mỹ' },
  { code: 'KRW', symbol: '₩', label: 'Won Hàn' },
  { code: 'RMB', symbol: '¥', label: 'Nhân dân tệ' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
];

export interface SupplierRow {
  id?: number;
  sourcing_entry_id?: number;
  supplier_name: string | null;
  phone: string | null;
  email: string | null;
  currency: CurrencyCode;
  cost_amount: number | null;
  lead_time_days: number | null;
  moq: number | null;
  notes: string | null;
  is_primary: boolean;
  _new?: boolean; // local-only marker for unsaved rows
  _dirty?: boolean;
}

function blankSupplierRow(isPrimary = false): SupplierRow {
  return {
    supplier_name: null,
    phone: null,
    email: null,
    currency: 'VND',
    cost_amount: null,
    lead_time_days: null,
    moq: null,
    notes: null,
    is_primary: isPrimary,
    _new: true,
    _dirty: true,
  };
}

/* ─── Pricing rule (per item-type) ───
 *
 * Aligned with backend schema `sourcing_pricing_rules` (Thang 2026-06-13).
 * The schema uses a SINGULAR `item_type` column (TEXT, UNIQUE) — NOT
 * {scope, scope_value}. The REST endpoint puts `item_type` in the URL PATH
 * (POST/PUT /sourcing/pricing-rules/{item_type}); the JSON body uses field
 * names exactly matching the DB columns: markup_pct, tax_pct,
 * shipping_fee_vnd, description_vi, plus the expanded breakdown params
 * (import_tax_pct, vat_pct, purchase_cost_pct, transfer_fee_pct,
 * swift_fee_usd, profit_pct_import, profit_pct_domestic).
 */
export interface PricingRule {
  id?: number;
  item_type: string;
  markup_pct: number;
  tax_pct: number;
  shipping_fee_vnd: number;
  description_vi?: string | null;
  // Expanded breakdown params (default applies when null)
  import_tax_pct?: number | null;
  vat_pct?: number | null;
  purchase_cost_pct?: number | null;
  transfer_fee_pct?: number | null;
  swift_fee_usd?: number | null;
  profit_pct_import?: number | null;
  profit_pct_domestic?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ExchangeRates {
  base: 'VND';
  rates: Partial<Record<CurrencyCode, number>>; // 1 unit foreign = N VND
  updated_at?: string | null;
}

const STAGE_LABEL: Record<number, string> = {
  1: 'Raw',
  2: 'Enriched',
  3: 'Ready',
};

const STAGE_COLOR: Record<number, string> = {
  1: 'bg-slate-100 text-slate-700',
  2: 'bg-sky-100 text-sky-700',
  3: 'bg-emerald-100 text-emerald-700',
};

const CLASSIFICATION_OPTIONS: { value: string; label: string; icon: typeof CheckCircle2; activeClass: string }[] = [
  { value: 'Validated', label: 'Validated', icon: CheckCircle2, activeClass: 'bg-emerald-600 text-white ring-emerald-600' },
  { value: 'Quoted', label: 'Quoted', icon: FileText, activeClass: 'bg-sky-600 text-white ring-sky-600' },
  { value: 'Sample', label: 'Sample', icon: TestTube, activeClass: 'bg-brand-600 text-white ring-brand-600' },
  { value: 'Product Candidate', label: 'Candidate', icon: HelpCircle, activeClass: 'bg-amber-600 text-white ring-amber-600' },
  { value: 'Rejected', label: 'Rejected', icon: XCircle, activeClass: 'bg-rose-600 text-white ring-rose-600' },
];

const EMPTY: SourcingEntry = {
  id: 0,
  bqms_code: null,
  customer_name: null,
  customer_id: null,
  person_in_charge: null,
  model: null,
  product_name: null,
  maker: null,
  inquiry_date: null,
  cost_jpy: null,
  cost_usd: null,
  cost_krw: null,
  cost_rmb: null,
  cost_vnd: null,
  sale_vnd: null,
  quantity: null,
  tax_pct: null,
  hs_code: null,
  weight_kg: null,
  coefficient: null,
  supplier_name: null,
  supplier_phone: null,
  supplier_email: null,
  image_url: null,
  notes: null,
  row_classification: null,
  exchange_rate: null,
  quote_snapshot: null,
  created_by_email: null,
  updated_by_email: null,
  created_at: null,
  updated_at: null,
};

// Smart defaults for new entries
function smartDefaults(): Partial<SourcingEntry> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    inquiry_date: today,
    quantity: 1,
    coefficient: 1.4,
  };
}

// LocalStorage memory keys
const LS_KEYS = {
  customer: 'sourcing.last_customer',
  person: 'sourcing.last_person',
  supplier: 'sourcing.last_supplier',
};

function readLS(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string | null | undefined) {
  if (typeof window === 'undefined') return;
  try {
    if (value) localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

// Field list used by completion progress
const COMPLETION_FIELDS: (keyof SourcingEntry)[] = [
  'model',
  'bqms_code',
  'product_name',
  'maker',
  'customer_name',
  'person_in_charge',
  'inquiry_date',
  'cost_vnd',
  'sale_vnd',
  'quantity',
  'coefficient',
  'supplier_name',
  'supplier_phone',
  'supplier_email',
  'hs_code',
  'tax_pct',
  'weight_kg',
  'notes',
  'row_classification',
  'image_url',
];

/* ─────────── Helpers ─────────── */

function toIsoDate(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function fmtVnd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return String(Math.round(value).toLocaleString('vi-VN')) + ' ₫';
}

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('vi-VN');
}

function shortName(email: string | null | undefined): string {
  if (!email) return '—';
  const name = email.split('@')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return !Number.isNaN(v);
  return true;
}

// Coerce a possibly-string/null numeric (asyncpg → JSON) to a finite number.
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Tính năng B — badge "giá tham chiếu" multi-source (đọc-only, KHÔNG sửa BE).
interface MultiSourceMini {
  bqms_code: string;
  sources: Record<
    string,
    | {
        src: string;
        price_role: string;
        n?: number;
        median_vnd?: number | string | null;
        min_vnd?: number | string | null;
        max_vnd?: number | string | null;
        last_date?: string | null;
      }
    | undefined
  >;
}

/* ─────────── Main Drawer ─────────── */

export function SourcingFormDrawer({ entry, onClose, onSaved, onDelete }: Props) {
  const isEditing = !!entry;
  const isCreating = !isEditing;
  const [form, setForm] = useState<SourcingEntry>(entry || EMPTY);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>('product');
  const [duplicateCount, setDuplicateCount] = useState<number>(0);
  // Batch #4 (V3): the CRM customer linked to this entry (drives the chip + the
  // customer_id sent on save → exported báo giá autofills company/MST/address).
  const [pickedCustomer, setPickedCustomer] = useState<PickedCustomer | null>(null);

  // ICE a11y: dialog ARIA + focus trap + restore focus. The drawer's existing
  // useEffect already wires Esc / Cmd+S / Cmd+Enter; this hook layers a Tab
  // trap on top and restores focus to the trigger when the drawer unmounts.
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const liveId = useId();
  const [liveMsg, setLiveMsg] = useState('');
  useModalA11y({
    active: true,
    containerRef: dialogRef as React.RefObject<HTMLElement>,
    onClose,
  });

  // 1. AUTOCOMPLETE: fetch suggestions on mount
  const { data: suggestions } = useQuery<SuggestionsResponse>({
    queryKey: ['sourcing', 'suggestions'],
    queryFn: async () => {
      const res = (await api.get('/api/v1/sourcing/suggestions')) as { data: SuggestionsResponse };
      return res.data || {};
    },
    staleTime: 5 * 60 * 1000,
  });

  // 2. SMART DEFAULTS on new entry + 12. LOCALSTORAGE MEMORY pre-fill
  useEffect(() => {
    if (entry) {
      setForm(entry);
    } else {
      const defaults = smartDefaults();
      const lastCustomer = readLS(LS_KEYS.customer);
      const lastPerson = readLS(LS_KEYS.person);
      const lastSupplier = readLS(LS_KEYS.supplier);
      setForm({
        ...EMPTY,
        ...defaults,
        customer_name: lastCustomer || null,
        person_in_charge: lastPerson || null,
        supplier_name: lastSupplier || null,
      });
    }
    setSaveError(null);
    setDuplicateCount(0);
  }, [entry]);

  // Batch #4 (V3): hydrate the CustomerPicker chip from the entry's stored
  // customer_id so editing an existing linked entry shows the CRM customer.
  useEffect(() => {
    const cid = entry?.customer_id ?? null;
    if (cid == null) {
      setPickedCustomer(null);
      return;
    }
    let cancelled = false;
    api
      .get<{ data: PickedCustomer }>(`/api/v1/crm/customers/${cid}`)
      .then((res) => {
        if (!cancelled && res.data) setPickedCustomer(res.data);
      })
      .catch(() => {
        /* leave null — the free-text customer_name still renders */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, entry?.customer_id]);

  // 6. DUPLICATE DETECTION: debounced check on bqms_code change (create mode only)
  useEffect(() => {
    if (!isCreating) return;
    const code = (form.bqms_code || '').trim();
    if (!code) {
      setDuplicateCount(0);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = (await api.get('/api/v1/sourcing/by-code/' + encodeURIComponent(code))) as { data: unknown[] };
        const arr = Array.isArray(res.data) ? res.data : [];
        setDuplicateCount(arr.length);
      } catch {
        setDuplicateCount(0);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [form.bqms_code, isCreating]);

  // Tính năng B: debounce bqms_code (400ms) để tra giá tham chiếu multi-source.
  const [debouncedBqmsCode, setDebouncedBqmsCode] = useState('');
  useEffect(() => {
    const code = (form.bqms_code || '').trim();
    const t = setTimeout(() => setDebouncedBqmsCode(code), 400);
    return () => clearTimeout(t);
  }, [form.bqms_code]);

  // Tính năng B: tra giá tham chiếu multi-source (endpoint đã có, đọc-only).
  const marketRefQ = useQuery<MultiSourceMini | null>({
    queryKey: ['sourcing', 'market-ref', debouncedBqmsCode],
    enabled: debouncedBqmsCode.length >= 3,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      try {
        const res = (await api.get(
          '/api/v1/market-prices/multi-source/' + encodeURIComponent(debouncedBqmsCode),
        )) as { data?: MultiSourceMini } | MultiSourceMini;
        const data = (res as any)?.data ?? res;
        if (!data || typeof data !== 'object' || !data.sources) return null;
        return data as MultiSourceMini;
      } catch {
        return null;
      }
    },
  });

  // Median VND theo price_role (null-safe: median_vnd có thể là string).
  const marketRefChip = useMemo(() => {
    const sources = marketRefQ.data?.sources || {};
    const pick = (role: string): number | null => {
      for (const key of Object.keys(sources)) {
        const s = sources[key];
        if (s?.price_role === role) {
          const m = toNum(s.median_vnd);
          if (m != null && m > 0) return m;
        }
      }
      return null;
    };
    const tt = pick('market_xnk');
    const von = pick('cost_ncc');
    const chao = pick('quote_v1');
    return { tt, von, chao, any: tt != null || von != null || chao != null };
  }, [marketRefQ.data]);

  const saveMutation = useMutation({
    mutationFn: async (opts?: { thenReset?: boolean }) => {
      // Derive legacy cost_vnd from primary supplier on save (UI no longer
      // accepts manual cost_vnd input — see Tính giá refactor 2026-06-15).
      // primarySupplier + exchangeRates are defined later in the closure but
      // are stable refs by the time mutationFn fires.
      const derived = derivedCostVnd;
      // Manual FX override → persist into exchange_rate jsonb so the backend
      // freezes IT as the entry's fx_rate_snapshot (not the auto rate).
      const _cur = primarySupplier?.currency ?? 'VND';
      // Giá thống nhất 1 lần (Thang 2026-07-02): làm tròn DUY NHẤT ở Giá báo (T).
      // Freeze sale_vnd + quote_snapshot mỗi lần Lưu (thay cho nút "Áp dụng giá
      // báo" đã bỏ). GUARD: nếu T chưa có (chưa đủ dữ liệu để tính) thì GIỮ giá cũ
      // — KHÔNG ghi đè null (tránh xoá giá đã lưu).
      const T = displayBreakdown?.T ?? null;
      const _frozenSnapshot =
        T != null ? buildPricingSnapshot(Math.round(T)) : null;
      const payload = {
        ...form,
        cost_vnd: derived ?? form.cost_vnd,
        inquiry_date: form.inquiry_date ? toIsoDate(form.inquiry_date) : null,
        exchange_rate:
          manualFxRate != null && manualFxRate > 0 && _cur !== 'VND'
            ? { ...(form.exchange_rate || {}), [_cur]: manualFxRate }
            : form.exchange_rate,
        // Freeze the unified quote at save time (fallback = keep the stored value).
        sale_vnd: T != null ? Math.round(T) : (form.sale_vnd ?? null),
        quote_snapshot: _frozenSnapshot ?? form.quote_snapshot,
        // A1: persist the VN shipping fee on the entry itself (not only inside
        // quote_snapshot) so the backend can keep a value-history of it + reopen.
        vn_shipping_fee_vnd: vnShippingFeeVnd,
        // 2026-07-02: FedEx (quốc tế) fee persisted on the entry for reopen.
        fedex_fee_vnd: fedexFeeVnd ?? null,
        // Versioned pricing / FX freeze (2026-07-01): on CREATE the primary
        // supplier ROW does not exist yet at freeze time, so the backend cannot
        // read the cost currency from the DB. Send the primary supplier's typed
        // cost + currency directly so _compute_fx_snapshot fetches the REAL rate
        // for a foreign entry (never short-circuits to 1). On edit these still
        // match the primary row.
        primary_cost_currency: primarySupplier?.currency ?? null,
        primary_cost_amount: primarySupplier?.cost_amount ?? null,
      };
      delete (payload as any).id;
      delete (payload as any).created_at;
      delete (payload as any).updated_at;
      delete (payload as any).created_by_email;
      delete (payload as any).updated_by_email;
      delete (payload as any).catalog_category;
      delete (payload as any).catalog_status;
      delete (payload as any).brand_canonical;
      delete (payload as any).part_type;
      delete (payload as any).subcategory_slug;
      delete (payload as any).machine_model;
      delete (payload as any).normalized_model;
      delete (payload as any).stage;
      delete (payload as any).missing_fields;
      delete (payload as any).missing_count;
      const res = isEditing && entry
        ? await api.put('/api/v1/sourcing/' + entry.id, payload)
        : await api.post('/api/v1/sourcing/', payload);

      // A2 — FLUSH dirty supplier rows for BOTH create AND edit, AWAITED here in
      // the mutationFn (not onSuccess) so it completes BEFORE any query
      // invalidation re-runs the seed effect and clobbers in-flight edits.
      // ROOT CAUSE: PUT /sourcing/{id} only touches sourcing_entries and never
      // writes sourcing_supplier_prices, so a typed per-unit cost edited on an
      // existing entry (rows load _new:false) was silently dropped.
      const entryId = (isEditing && entry ? entry.id : (res as any)?.data?.id) as
        | number
        | undefined;
      let flushedCount = 0;
      if (entryId) {
        const toFlush = supplierRows.filter(
          (r) =>
            r._dirty &&
            (r.supplier_name?.trim()?.length ?? 0) > 0 &&
            (r.cost_amount ?? 0) > 0,
        );
        for (const row of toFlush) {
          const supplierPayload = {
            supplier_name: row.supplier_name,
            phone: row.phone,
            email: row.email,
            currency: row.currency,
            cost_amount: row.cost_amount,
            lead_time_days: row.lead_time_days,
            moq: row.moq,
            notes: row.notes,
            is_primary: row.is_primary,
          };
          // Let any flush failure propagate so the mutation surfaces an error
          // toast instead of silently dropping the typed price.
          if (row.id) {
            await api.put(
              '/api/v1/sourcing/' + entryId + '/suppliers/' + row.id,
              supplierPayload,
            );
          } else {
            await api.post('/api/v1/sourcing/' + entryId + '/suppliers', supplierPayload);
          }
          flushedCount += 1;
        }
      }
      // Pass through the entryId + the SAME frozen snapshot built for the payload
      // so onSuccess can POST it as a versioned đợt (build 1 LẦN — không build lại
      // để tránh lệch computed_at / _append ghi khác).
      return { res, opts, flushedCount, entryId, frozenSnapshot: _frozenSnapshot, frozenT: T };
    },
    onSuccess: async ({ opts, flushedCount, entryId, frozenSnapshot, frozenT }) => {
      setSaveError(null);
      // 12. Persist current values to localStorage on successful save
      writeLS(LS_KEYS.customer, form.customer_name);
      writeLS(LS_KEYS.person, form.person_in_charge);
      writeLS(LS_KEYS.supplier, primarySupplier?.supplier_name ?? null);

      // A2: the dirty supplier rows were already flushed (awaited) inside the
      // mutationFn for BOTH create and edit. Just surface a count toast.
      if (flushedCount > 0) toast.success(`Đã lưu ${flushedCount} NCC kèm theo`);

      // Lưu đợt tính giá tự động mỗi lần Lưu (Thang 2026-07-02): đã bỏ nút "Lưu đợt
      // tính giá" thủ công → mỗi Lưu freeze 1 đợt bằng CHÍNH object đã build ở
      // payload. GUARD chống trùng: chỉ POST nếu khác đợt mới nhất (so unit_price
      // + fedex + vn_ship + is_domestic + pct_overrides với pricingSnaps[0]).
      if (entryId && frozenSnapshot != null && frozenT != null) {
        try {
          const unit = Math.round(frozenT);
          const latest = pricingSnaps[0];
          let latestSnap: Record<string, any> | null = null;
          if (latest) {
            try {
              const r = (await api.get(
                '/api/v1/sourcing/' + entryId + '/pricing-snapshots/' + latest.version,
              )) as { data: Record<string, any> };
              latestSnap = r.data ?? null;
            } catch {
              latestSnap = null;
            }
          }
          const eq = (a: any, b: any) => (a ?? null) === (b ?? null);
          const fs: any = frozenSnapshot;
          const po = (latestSnap?.pct_overrides || {}) as any;
          const fpo = (fs.pct_overrides || {}) as any;
          const dup =
            latestSnap != null &&
            eq(latestSnap.unit_price_vnd, fs.unit_price_vnd) &&
            eq(latestSnap.fedex_fee_vnd, fs.fedex_fee_vnd) &&
            eq(latestSnap.vn_shipping_fee_vnd, fs.vn_shipping_fee_vnd) &&
            !!latestSnap.is_domestic === !!fs.is_domestic &&
            eq(po.importTax, fpo.importTax) &&
            eq(po.vat, fpo.vat) &&
            eq(po.purchase, fpo.purchase) &&
            eq(po.profit, fpo.profit);
          if (!dup) {
            const stamp = new Date().toLocaleString('vi-VN', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            });
            await api.post('/api/v1/sourcing/' + entryId + '/pricing-snapshots', {
              snapshot: frozenSnapshot,
              sale_vnd: unit,
              label: 'Lưu ' + stamp,
            });
            pricingSnapsQ.refetch();
          }
        } catch {
          // Non-fatal: entry itself is saved; đợt-append is best-effort.
        }
      }

      if (opts?.thenReset) {
        // 3. SAVE & ADD ANOTHER: reset product-only fields, keep meta
        const defaults = smartDefaults();
        setForm((prev) => ({
          ...prev,
          model: null,
          bqms_code: null,
          product_name: null,
          maker: null,
          hs_code: null,
          image_url: null,
          sale_vnd: null,
          cost_vnd: null,
          cost_jpy: null,
          cost_usd: null,
          cost_krw: null,
          cost_rmb: null,
          weight_kg: null,
          notes: null,
          // smart defaults stay applied
          coefficient: prev.coefficient ?? defaults.coefficient ?? null,
          quantity: defaults.quantity ?? 1,
        }));
        setDuplicateCount(0);
        // New product → fresh suppliers. Keep the customer (same KH, next item).
        setSupplierRows([blankSupplierRow(true)]);
        toast.success('Đã lưu — Sẵn sàng entry mới');
      } else {
        onSaved();
      }
    },
    onError: (err: any) => {
      setSaveError(err?.response?.data?.detail || err?.message || 'Lưu thất bại');
    },
  });

  // Keyboard shortcuts (Esc is handled by useModalA11y at capture phase).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveMutation.mutate(undefined);
      }
      // 3. Cmd/Ctrl + Enter -> Save & Add Another (create mode only)
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isCreating) {
        e.preventDefault();
        saveMutation.mutate({ thenReset: true });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, form, isCreating]);

  // ICE a11y: announce save success/error to AT users via aria-live.
  useEffect(() => {
    if (saveMutation.isSuccess) setLiveMsg('Đã lưu entry sourcing');
  }, [saveMutation.isSuccess]);
  useEffect(() => {
    if (saveError) setLiveMsg(`Lỗi lưu: ${saveError}`);
  }, [saveError]);

  const setField = <K extends keyof SourcingEntry>(key: K, value: SourcingEntry[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setNumField = (key: keyof SourcingEntry, value: string) => {
    if (value === '' || value === '-') {
      setField(key, null as any);
      return;
    }
    const num = Number(value);
    setField(key, (Number.isFinite(num) ? num : null) as any);
  };
  // setNumField is retained for future numeric fields; the tax/logistics inputs
  // that used it were dropped (A6). Suppress the unused-var lint, matching the
  // `void regenerateQuotePdf;` style used elsewhere in this file.
  void setNumField;

  // === A2. Linked order lookup — if this entry already became an order, fetch its status ===
  const linkedOrderQ = useQuery<LinkedOrderSummary | null>({
    queryKey: ['sourcing', 'entry', entry?.id, 'linked-order'],
    enabled: !!entry?.id,
    queryFn: async () => {
      try {
        const res = (await api.get(
          '/api/v1/sourcing/orders?sourcing_entry_id=' + entry!.id + '&page_size=1',
        )) as { data: { items?: LinkedOrderSummary[] } };
        const items = res.data?.items;
        if (Array.isArray(items) && items.length > 0) return items[0];
        return null;
      } catch {
        return null;
      }
    },
    staleTime: 30 * 1000,
  });

  const linkedOrder = linkedOrderQ.data || null;

  /* ─────────── Exchange rates (for currency dropdown ≈ VND hint) ─────────── */
  // FIX B5 (Thang 2026-06-13): backend returns either legacy {base, rates}
  // OR new flat array [{currency, rate_to_vnd, rate_date, last_updated}].
  // Normalize both shapes so we can render the freshness banner regardless.
  const exchangeQ = useQuery<ExchangeRates & { _lastUpdatedISO?: string | null }>({
    queryKey: ['sourcing', 'exchange-rates'],
    queryFn: async () => {
      // `api.get` returns the parsed JSON body directly (not an Axios-style
      // {data} envelope). The backend wraps the payload as { data: [...] },
      // so the array lives at `res.data`. Be defensive: accept (a) the wrapped
      // envelope, (b) a bare array, (c) the legacy {base, rates} object.
      type FxRow = {
        currency: string;
        rate_to_vnd: number;
        last_updated?: string | null;
        rate_date?: string | null;
      };
      const res = (await api.get('/api/v1/exchange-rates')) as unknown;
      // 1b.1 — unwrap: prefer res.data when present, else treat res itself.
      const payload =
        res && typeof res === 'object' && 'data' in (res as any)
          ? (res as any).data
          : res;

      // New API shape: flat array of {currency, rate_to_vnd, rate_date, last_updated}
      if (Array.isArray(payload)) {
        const rows = payload as FxRow[];
        const rates: Partial<Record<CurrencyCode, number>> = {};
        let latest: string | null = null;
        for (const row of rows) {
          const cur = (row.currency || '').toUpperCase() as CurrencyCode;
          if (cur) rates[cur] = Number(row.rate_to_vnd) || 0;
          // Prefer the precise `last_updated` timestamp; fall back to rate_date.
          const stamp = row.last_updated || row.rate_date || null;
          if (stamp && (!latest || stamp > latest)) latest = stamp;
        }
        return { base: 'VND' as const, rates, updated_at: latest, _lastUpdatedISO: latest };
      }

      // Legacy {base, rates, updated_at}
      const legacy = (payload as ExchangeRates) || { base: 'VND' as const, rates: {} };
      return { ...legacy, _lastUpdatedISO: legacy.updated_at || null };
    },
    staleTime: 10 * 60 * 1000,
  });
  const exchangeRates: Partial<Record<CurrencyCode, number>> = exchangeQ.data?.rates || {
    VND: 1,
    JPY: 180,
    USD: 24500,
    KRW: 18,
    RMB: 3400,
    EUR: 27000,
  };
  const fxLastUpdatedISO: string | null = exchangeQ.data?._lastUpdatedISO ?? null;
  const fxDaysAgo: number | null = (() => {
    if (!fxLastUpdatedISO) return null;
    const ts = Date.parse(fxLastUpdatedISO);
    if (Number.isNaN(ts)) return null;
    const diffMs = Date.now() - ts;
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  })();
  // dd/mm of the last FX update — shown alongside the "N ngày trước" banner.
  const fxDateLabel: string | null = (() => {
    if (!fxLastUpdatedISO) return null;
    const ts = Date.parse(fxLastUpdatedISO);
    if (Number.isNaN(ts)) return null;
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  })();

  // FIX (Thang 2026-06-15): wire "Cập nhật" tỷ giá button — backend không có
  // POST /refresh endpoint nên chỉ invalidate cache + refetch (KISS).
  const queryClient = useQueryClient();
  const [isRefreshingFx, setIsRefreshingFx] = useState<boolean>(false);
  const handleRefreshFx = async () => {
    if (isRefreshingFx) return;
    setIsRefreshingFx(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['sourcing', 'exchange-rates'] });
      await exchangeQ.refetch();
      toast.success('Đã cập nhật tỷ giá');
    } catch (err: any) {
      toast.error(err?.detail || err?.message || 'Không cập nhật được tỷ giá');
    } finally {
      setIsRefreshingFx(false);
    }
  };

  /* ─────────── Pricing rules (item-type → tax/markup/ship) ─────────── */
  const pricingRulesQ = useQuery<PricingRule[]>({
    queryKey: ['sourcing', 'pricing-rules'],
    queryFn: async () => {
      const res = (await api.get('/api/v1/sourcing/pricing-rules')) as { data: PricingRule[] };
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 5 * 60 * 1000,
  });
  const pricingRules = pricingRulesQ.data || [];
  const [pricingRuleEditOpen, setPricingRuleEditOpen] = useState<boolean>(false);
  // When the user clicks the fallback chip "Tạo quy tắc cho {item_type}",
  // prefill the rule editor with that exact item_type instead of the
  // currently selected one (which is empty in the fallback case).
  const [pricingRulePrefillType, setPricingRulePrefillType] = useState<string | null>(null);

  /* ─────────── Tính giá (full breakdown — I..T cells) ─────────── */
  const [isDomesticVn, setIsDomesticVn] = useState<boolean>(false);
  const [fedexFeeVnd, setFedexFeeVnd] = useState<number | null>(null);
  const [vnShippingFeeVnd, setVnShippingFeeVnd] = useState<number | null>(null);
  const [otherFeeOverride, setOtherFeeOverride] = useState<number | null>(null);
  const [finalQuotePrice, setFinalQuotePrice] = useState<number | null>(null);
  // Manual FX override (Thang 2026-06-17): for a foreign-currency cost the user
  // can type the tỷ giá by hand instead of always using the auto rate from the
  // exchange_rates table. null = dùng tỷ giá tự động (hoặc snapshot khi mở lại).
  // Reset to null when the cost currency changes (it belonged to the old one).
  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  // Giá thống nhất 1 lần (Thang 2026-07-02): Giá báo (T) LUÔN = displayBreakdown.T
  // đã làm tròn round(S/1000)*1000. Không còn chế độ "Sửa tay" (quoteTouched gỡ) —
  // Tổng hiển thị = T × SL; Giá make (S) chỉ là tham chiếu.
  // Per-entry inline overrides for the formula percentages. null = use the
  // rule/default %, a number = user-overridden. Pure frontend, recomputed live
  // in displayBreakdown — never sent to the backend calc-suggest payload.
  const [pctOverrides, setPctOverrides] = useState<{
    importTax: number | null;
    vat: number | null;
    purchase: number | null;
    profit: number | null;
  }>({ importTax: null, vat: null, purchase: null, profit: null });
  const setPctOverride = (
    key: 'importTax' | 'vat' | 'purchase' | 'profit',
    value: number | null,
  ) => setPctOverrides((p) => ({ ...p, [key]: value }));

  // Batch #1 (2026-06-27): restore the FROZEN pricing inputs so reopening an
  // entry reproduces the SAME breakdown it was saved with. Previously fedex /
  // VN-ship / is_domestic / pct-overrides were lost on reopen → the breakdown
  // drifted from the price that was actually exported (root of V1/V2). Keyed on
  // entry id so it runs once per opened entry.
  useEffect(() => {
    const snap = (entry?.quote_snapshot ?? null) as Record<string, any> | null;
    // FX re-seed on reopen (2026-07-01): a foreign-currency entry must never
    // recompute its breakdown at rate=1 while the exchange-rates query is still
    // loading or the frozen snapshot outlives the live table. Seed manualFxRate
    // from the snapshot's frozen fx_rate, falling back to the entry-level
    // fx_rate_snapshot. VND entries need no rate. Derive the currency from the
    // snapshot first (authoritative for THIS quote), else the serialized
    // primary_cost_currency. Runs before/independently of supplier-row seeding.
    const cur = (snap?.currency ?? entry?.primary_cost_currency ?? 'VND') as string;
    if (cur !== 'VND') {
      const frozen = snap?.fx_rate ?? entry?.fx_rate_snapshot ?? null;
      if (frozen != null && Number(frozen) > 0) setManualFxRate(Number(frozen));
    }
    // fedex / vn-ship: prefer the real entry COLUMNS (2026-07-02) — they are
    // written on every Lưu and don't depend on the JSONB snapshot being present.
    // Fall back to the snapshot for older entries that predate the columns.
    const fedexCol = entry?.fedex_fee_vnd ?? snap?.fedex_fee_vnd ?? null;
    const vnShipCol = entry?.vn_shipping_fee_vnd ?? snap?.vn_shipping_fee_vnd ?? null;
    if (fedexCol != null) setFedexFeeVnd(Number(fedexCol));
    if (vnShipCol != null) setVnShippingFeeVnd(Number(vnShipCol));
    if (!snap) return;
    // Step 14: snapshot now re-written on EVERY Lưu, so % overrides + phí khác +
    // nội-địa MUST be restored here or a user's edited % reverts to 20/10/25.
    if (typeof snap.is_domestic === 'boolean') setIsDomesticVn(snap.is_domestic);
    if (snap.other_fee_override != null) setOtherFeeOverride(Number(snap.other_fee_override));
    const po = snap.pct_overrides;
    if (po && typeof po === 'object') {
      setPctOverrides({
        importTax: po.importTax ?? null,
        vat: po.vat ?? null,
        purchase: po.purchase ?? null,
        profit: po.profit ?? null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  /* ─────────── Multi-supplier rows ─────────── */
  const suppliersQ = useQuery<SupplierRow[]>({
    queryKey: ['sourcing', 'entry', entry?.id, 'suppliers'],
    enabled: !!entry?.id,
    queryFn: async () => {
      try {
        const res = (await api.get('/api/v1/sourcing/' + entry!.id + '/suppliers')) as {
          data: SupplierRow[];
        };
        return Array.isArray(res.data) ? res.data : [];
      } catch {
        return [];
      }
    },
    staleTime: 30 * 1000,
  });

  const [supplierRows, setSupplierRows] = useState<SupplierRow[]>([]);

  // Initial seed: when entry loads, fetched suppliers populate state. For new
  // entries OR entries without rows, migrate legacy single-supplier fields into
  // a first row so existing data is not lost.
  useEffect(() => {
    // Never seed while suppliers are still loading — the length===0 branch would
    // fire prematurely and a subsequent flush could overwrite the real rows.
    if (suppliersQ.isLoading) return;
    if (entry?.id && suppliersQ.data) {
      if (suppliersQ.data.length === 0) {
        // migrate from legacy fields on entry. Use the primary supplier's ORIGINAL
        // typed amount + currency (from the list API) — NOT entry.cost_vnd, which is
        // the FX-converted VND-equivalent. Copying cost_vnd here + forcing 'VND'
        // corrupted foreign-currency prices (e.g. 12.5 USD -> 140000/VND) whenever
        // the entry was reopened and flushed. Seeded rows are NOT dirty so an
        // untouched reopen never writes back.
        const legacy = blankSupplierRow(true);
        legacy.supplier_name = entry.supplier_name;
        legacy.phone = entry.supplier_phone;
        legacy.email = entry.supplier_email;
        legacy.currency = (entry.primary_cost_currency ?? 'VND') as CurrencyCode;
        legacy.cost_amount = entry.primary_cost_amount ?? null;
        legacy._dirty = false;
        setSupplierRows(entry.supplier_name || entry.supplier_phone || entry.supplier_email ? [legacy] : []);
      } else {
        setSupplierRows(
          suppliersQ.data.map((r) => ({ ...r, _new: false, _dirty: false })),
        );
      }
    } else if (!entry) {
      // new entry: start with one empty primary row pre-filled from form
      setSupplierRows([
        {
          ...blankSupplierRow(true),
          supplier_name: form.supplier_name,
          phone: form.supplier_phone,
          email: form.supplier_email,
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, suppliersQ.data]);

  const addSupplierRow = () => {
    setSupplierRows((rows) => [...rows, blankSupplierRow(rows.length === 0)]);
  };

  const removeSupplierRow = async (idx: number) => {
    const row = supplierRows[idx];
    // ICE UX #3: persisted rows trigger PDF + suggested-sale recalculation, so
    // an accidental delete is expensive to undo. Confirm before hitting the API.
    if (row?.id && entry?.id) {
      const label = row.supplier_name?.trim() || `NCC #${row.id}`;
      const ok = typeof window !== 'undefined'
        ? window.confirm(`Xoá ${label}? Hành động này không thể hoàn tác.`)
        : true;
      if (!ok) return;
      try {
        await api.delete('/api/v1/sourcing/' + entry.id + '/suppliers/' + row.id);
        toast.success('Đã xoá NCC');
      } catch (err: any) {
        toast.error(err?.response?.data?.detail || 'Xoá NCC thất bại');
        return;
      }
    }
    setSupplierRows((rows) => {
      const next = rows.filter((_, i) => i !== idx);
      // if we removed the primary and others remain, promote the first
      if (row?.is_primary && next.length > 0 && !next.some((r) => r.is_primary)) {
        next[0] = { ...next[0], is_primary: true, _dirty: true };
      }
      return next;
    });
  };

  const updateSupplierRow = (idx: number, patch: Partial<SupplierRow>) => {
    setSupplierRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch, _dirty: true } : r)),
    );
  };

  const setPrimarySupplier = (idx: number) => {
    setSupplierRows((rows) =>
      rows.map((r, i) => ({ ...r, is_primary: i === idx, _dirty: true })),
    );
  };

  // Quick "Giá nhập" entry shown in the Giá section — binds to the primary
  // supplier (creates one if none) so cost can be typed without opening the
  // Nhà cung cấp section. (Thang 2026-06-15)
  const setPrimaryCost = (patch: Partial<SupplierRow>) => {
    // Đổi tiền tệ → tỷ giá tay cũ không còn đúng, reset về tự động.
    if (patch.currency !== undefined) setManualFxRate(null);
    setSupplierRows((rows) => {
      if (rows.length === 0) return [{ ...blankSupplierRow(true), ...patch }];
      let idx = rows.findIndex((r) => r.is_primary);
      if (idx < 0) idx = 0;
      return rows.map((r, i) => (i === idx ? { ...r, ...patch, _dirty: true } : r));
    });
  };

  const saveSupplierRow = async (idx: number) => {
    if (!entry?.id) {
      toast.message('Lưu entry trước, rồi mới lưu được NCC');
      return;
    }
    const row = supplierRows[idx];
    // ICE UX #4 (Thang 2026-06-13): client-side validation — catches the most
    // common dirty-row mistake before a wasted server round-trip and gives the
    // user a Vietnamese-language hint at the source of the error.
    if (!row.supplier_name?.trim()) {
      toast.error('Nhập tên NCC trước khi lưu');
      return;
    }
    const costNum = Number(row.cost_amount);
    if (!Number.isFinite(costNum) || costNum <= 0) {
      toast.error('Giá nhập (cost) phải > 0');
      return;
    }
    const payload = {
      supplier_name: row.supplier_name,
      phone: row.phone,
      email: row.email,
      currency: row.currency,
      cost_amount: row.cost_amount,
      lead_time_days: row.lead_time_days,
      moq: row.moq,
      notes: row.notes,
      is_primary: row.is_primary,
    };
    try {
      if (row.id) {
        const res = (await api.put(
          '/api/v1/sourcing/' + entry.id + '/suppliers/' + row.id,
          payload,
        )) as { data: SupplierRow };
        setSupplierRows((rows) =>
          rows.map((r, i) => (i === idx ? { ...res.data, _new: false, _dirty: false } : r)),
        );
      } else {
        const res = (await api.post(
          '/api/v1/sourcing/' + entry.id + '/suppliers',
          payload,
        )) as { data: SupplierRow };
        setSupplierRows((rows) =>
          rows.map((r, i) => (i === idx ? { ...res.data, _new: false, _dirty: false } : r)),
        );
      }
      toast.success('Đã lưu NCC');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Lưu NCC thất bại');
    }
  };

  /* ─────────── Tính giá — full breakdown computation ─────────── */
  // Find primary supplier row (provides currency + cost_amount)
  const primarySupplier = useMemo<SupplierRow | null>(() => {
    if (supplierRows.length === 0) return null;
    return supplierRows.find((r) => r.is_primary) || supplierRows[0];
  }, [supplierRows]);

  // Resolve the FX rate for the primary-supplier currency, in priority order:
  //   manual override > frozen snapshot (reopen) > live exchange-rates table.
  // For VND the rate is always 1. Returns null when a FOREIGN currency has no
  // resolvable rate anywhere (live table miss AND no snapshot/manual) — the UI
  // then surfaces "thiếu tỷ giá" instead of silently computing at 1 or 0.
  const primaryCurrency = (primarySupplier?.currency ?? 'VND') as CurrencyCode;
  const resolvedPrimaryFxRate = useMemo<number | null>(() => {
    if (primaryCurrency === 'VND') return 1;
    if (manualFxRate != null && manualFxRate > 0) return manualFxRate;
    const snapshot = isEditing ? entry?.fx_rate_snapshot : null;
    if (snapshot != null && snapshot > 0) return snapshot as number;
    const live = exchangeRates[primaryCurrency];
    if (live != null && live > 0) return live;
    return null; // foreign currency, no resolvable rate → missing
  }, [primaryCurrency, manualFxRate, isEditing, entry?.fx_rate_snapshot, exchangeRates]);

  // True when the primary currency is foreign but no rate can be resolved.
  const fxMissing =
    primaryCurrency !== 'VND' &&
    (primarySupplier?.cost_amount ?? 0) > 0 &&
    resolvedPrimaryFxRate == null;

  // Derived cost in VND from primary supplier × FX rate. This is the value the
  // save handler writes into form.cost_vnd (column still exists in DB for back-
  // compat, but is no longer typed in the UI). When no primary supplier exists,
  // we fall back to the form value so legacy rows keep their displayed margin.
  const derivedCostVnd = useMemo<number | null>(() => {
    if (primarySupplier && primarySupplier.cost_amount != null && primarySupplier.cost_amount > 0) {
      const rate = resolvedPrimaryFxRate;
      // Foreign currency with no resolvable rate → do NOT silently use 0/1;
      // keep the last saved cost_vnd so we never write a bogus 0-cost.
      if (rate == null || rate <= 0) return form.cost_vnd ?? null;
      return Math.round(primarySupplier.cost_amount * rate);
    }
    return form.cost_vnd ?? null;
  }, [primarySupplier, resolvedPrimaryFxRate, form.cost_vnd]);

  const calcInputs = useMemo(() => {
    const cost = Number(primarySupplier?.cost_amount ?? 0);
    const currency = (primarySupplier?.currency ?? 'VND') as CurrencyCode;
    const qty = form.quantity && form.quantity > 0 ? Number(form.quantity) : 1;
    // 1b.2 — historical FX by quote date: send the entry's inquiry date so the
    // server looks up the rate effective at that time-point (not today's).
    const quoteDate = form.inquiry_date ? toIsoDate(form.inquiry_date) : undefined;
    return {
      cost_amount: cost,
      currency,
      qty,
      fedex_fee_vnd: fedexFeeVnd ?? 0,
      vn_shipping_fee_vnd: vnShippingFeeVnd ?? 0,
      // item_type removed (Batch 1A · 1b.4) — default rule is authoritative.
      item_type: null as string | null,
      is_domestic_vn: isDomesticVn,
      other_fee_override: otherFeeOverride,
      quote_date: quoteDate,
    };
  }, [primarySupplier, form.quantity, form.inquiry_date, fedexFeeVnd, vnShippingFeeVnd, isDomesticVn, otherFeeOverride]);

  // 1b.3 — Kill flicker: the local breakdown computes INSTANTLY from calcInputs
  // (zero network on keystroke). The server /calc-suggest is reduced to a
  // debounced (400ms) background reconcile so it never blocks or flips a
  // loading state on every keypress. `debouncedCalcInputs` feeds the query key.
  const [debouncedCalcInputs, setDebouncedCalcInputs] = useState(calcInputs);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCalcInputs(calcInputs), 400);
    return () => clearTimeout(t);
  }, [calcInputs]);

  const calcSuggestQ = useQuery<{
    rule_applied?: string | null;
    fx_rate?: number | null;
    fx_rate_date?: string | null;
    I?: number; K?: number; L?: number; M?: number; N?: number;
    O?: number; P?: number; Q?: number; R?: number; S?: number; T?: number;
    total?: number;
    rule_used?: {
      item_type?: string | null;
      description_vi?: string | null;
      fallback_to_default?: boolean;
    } | null;
    params?: {
      import_tax_pct?: number;
      vat_pct?: number;
      purchase_cost_pct?: number;
      transfer_fee_pct?: number;
      swift_fee_usd?: number;
      profit_pct_used?: number;
      profit_pct_import?: number;
      profit_pct_domestic?: number;
      usd_to_vnd_used_for_swift?: number;
    } | null;
  } | null>({
    queryKey: ['sourcing', 'calc-suggest', debouncedCalcInputs],
    enabled: !!primarySupplier && debouncedCalcInputs.cost_amount > 0,
    // 1b.3 — keep the previous result while the debounced background reconcile
    // refetches, so the panel never flips to a loading skeleton on keystroke.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // API returns: { data: { suggested_sale_vnd, breakdown: { I,K,...,S,
      // total_with_profit, rule_used, params, exchange_rate_used, ... } } }
      // We flatten to the shape the UI expects (I..T, total, fx_rate,
      // rule_applied) while preserving the structured rule_used + params
      // so the fallback chip and the swift/FX hints can render.
      const res = (await api.post('/api/v1/sourcing/calc-suggest', debouncedCalcInputs)) as { data: any };
      const inner = res?.data?.breakdown;
      if (!inner || typeof inner !== 'object') return null;
      const S = Number(inner.S ?? 0);
      const T = Number.isFinite(S) ? Math.round(S / 1000) * 1000 : 0;
      const ruleUsed = inner.rule_used || null;
      const ruleLabel = ruleUsed
        ? (ruleUsed.description_vi || ruleUsed.item_type || null)
        : null;
      return {
        rule_applied: ruleLabel,
        fx_rate: inner.exchange_rate_used ?? null,
        fx_rate_date: inner.exchange_rate_date ?? null,
        I: inner.I,
        K: inner.K,
        L: inner.L,
        M: inner.M,
        N: inner.N,
        O: inner.O,
        P: inner.P,
        Q: inner.Q,
        R: inner.R,
        S: inner.S,
        T,
        total: inner.total_with_profit ?? inner.total_before_profit ?? null,
        rule_used: ruleUsed,
        params: inner.params || null,
      };
    },
    retry: 1,
    staleTime: 30 * 1000,
  });

  // Surface calc-suggest failures as a transient toast — error state is
  // also rendered inline (see TinhGiaBreakdownPanel) with a Retry button.
  const calcErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!calcSuggestQ.isError) {
      calcErrorRef.current = null;
      return;
    }
    const err = calcSuggestQ.error as any;
    const reason =
      err?.detail ||
      err?.message ||
      (typeof err === 'string' ? err : null) ||
      'lỗi không xác định';
    if (calcErrorRef.current === reason) return;
    calcErrorRef.current = reason;
    toast.error('Không tính được giá: ' + reason, {
      action: {
        label: 'Thử lại',
        onClick: () => calcSuggestQ.refetch(),
      },
    });
  }, [calcSuggestQ.isError, calcSuggestQ.error, calcSuggestQ]);

  // Client-side fallback (mirrors Bảng tính giá formulas if API not yet available)
  const localBreakdown = useMemo(() => {
    const cost = calcInputs.cost_amount;
    if (!cost || cost <= 0) return null;
    const currency = calcInputs.currency;
    // 1b.2 — for an EXISTING entry that has a frozen snapshot, use the ORIGINAL
    // rate (auditable; reopening an old quote must not drift to today's rate).
    // A NEW entry uses the latest live rate. Priority (via resolvedPrimaryFxRate):
    // manual override > frozen snapshot > live table. For a FOREIGN currency with
    // no rate anywhere the resolver returns null → we bail (guard surfaces
    // "thiếu tỷ giá") rather than computing at 1/0.
    const snapshot = entry?.fx_rate_snapshot;
    const usingSnapshot = isEditing && snapshot != null && snapshot > 0;
    const usingManual = currency !== 'VND' && manualFxRate != null && manualFxRate > 0;
    const fxRate = resolvedPrimaryFxRate;
    if (fxRate == null || fxRate <= 0) return null;
    const fxRateDate = usingManual
      ? null  // manual rate = "as of now"; no historical rate_date to show
      : (usingSnapshot ? (entry?.fx_rate_date ?? null) : null);
    const qty = calcInputs.qty;
    const I = cost * fxRate;                                       // Đơn giá nhập VND (G × H)
    const K = I * qty;                                             // Thành tiền nhập (I × J)
    const L = calcInputs.vn_shipping_fee_vnd;                      // Vận chuyển VN (manual)
    const M = calcInputs.fedex_fee_vnd;                            // Vận chuyển Fedex (manual)
    const N = calcInputs.is_domestic_vn ? 0 : (K + M) * 0.20;      // Thuế NK 20% (domestic = 0)
    const O = (K + M + N) * 0.10;                                  // VAT 10%
    const P = K * 0.25;                                            // Chi phí mua hộ 25%
    // Swift fee = swift_fee_usd (5) × THIS row's exchange rate (column H in
    // "Bảng tính giá 2026") = the cost-currency rate, NOT a fixed USD rate.
    // Matches backend compute_sale_vnd (Q = (K+M+P)*0.2% + 5*fx) so FE↔BE agree
    // for non-USD rows (JPY/KRW/RMB) — fixes the swift-basis divergence.
    const Q = otherFeeOverride != null
      ? otherFeeOverride
      : (K + M + P) * 0.002 + 5 * fxRate;                          // Chi phí khác
    const profitPct = calcInputs.is_domestic_vn ? 0.20 : 0.12;     // 20% VN, 12% NN
    const sumBeforeProfit = K + L + M + N + O + P + Q;
    const R = sumBeforeProfit * profitPct;                         // Lợi nhuận
    const total = sumBeforeProfit + R;
    const S = qty > 0 ? total / qty : 0;                           // Giá make (per-unit)
    const T = Math.round(S / 1000) * 1000;                         // Giá báo (rounded to 1000)
    return {
      rule_applied: isDomesticVn ? 'Mặc định — Hàng nội địa VN' : 'Mặc định — Hàng nhập khẩu',
      fx_rate: fxRate,
      fx_rate_date: fxRateDate,
      I, K, L, M, N, O, P, Q, R, S, T, total,
      // After 1b.4 there is no item_type; the local compute mirrors the engine
      // DEFAULT rule exactly, so it is NOT a fallback — no chip needed.
      rule_used: {
        item_type: 'default',
        description_vi: null,
        fallback_to_default: false,
      },
      params: {
        import_tax_pct: calcInputs.is_domestic_vn ? 0 : 20,
        vat_pct: 10,
        purchase_cost_pct: 25,
        transfer_fee_pct: 0.2,
        swift_fee_usd: 5,
        profit_pct_used: calcInputs.is_domestic_vn ? 20 : 12,
        profit_pct_import: 12,
        profit_pct_domestic: 20,
        // The rate actually used for the swift fee = cost-currency rate (fx),
        // so displayBreakdown's recompute path stays consistent with the above.
        usd_to_vnd_used_for_swift: fxRate,
      },
    };
  }, [calcInputs, resolvedPrimaryFxRate, otherFeeOverride, isDomesticVn, isEditing, entry?.fx_rate_snapshot, entry?.fx_rate_date, manualFxRate]);

  // 1b.3 — Local instant compute is AUTHORITATIVE for display (zero network on
  // keystroke → zero flicker). The debounced /calc-suggest result is kept only
  // for background reconcile / audit; we don't switch the visible breakdown to
  // it (which would re-introduce a flicker as numbers jump). pctOverrides are
  // re-applied on top of localBreakdown in displayBreakdown below.
  // 1b.2 — the numbers stay local-authoritative (no flicker), but if the local
  // breakdown has no fx_rate_date (a NEW entry → no frozen snapshot), borrow the
  // effective rate_date from the debounced server reconcile so the audit date
  // still shows. An EXISTING entry already carries its frozen fx_rate_date.
  const breakdown = useMemo(() => {
    if (!localBreakdown) return localBreakdown;
    if (localBreakdown.fx_rate_date) return localBreakdown;
    const serverDate = calcSuggestQ.data?.fx_rate_date ?? null;
    if (!serverDate) return localBreakdown;
    return { ...localBreakdown, fx_rate_date: serverDate };
  }, [localBreakdown, calcSuggestQ.data?.fx_rate_date]);

  // Effective percentages: per-entry override > rule param > engine default.
  // importTax is forced to 0 for domestic VN (matches engine + N=0 rule).
  const effPct = useMemo(() => {
    const params = breakdown?.params || null;
    const importTax = isDomesticVn
      ? 0
      : pctOverrides.importTax ?? params?.import_tax_pct ?? 20;
    const vat = pctOverrides.vat ?? params?.vat_pct ?? 10;
    const purchase = pctOverrides.purchase ?? params?.purchase_cost_pct ?? 25;
    const profit =
      pctOverrides.profit ?? params?.profit_pct_used ?? (isDomesticVn ? 20 : 12);
    const transfer = params?.transfer_fee_pct ?? 0.2;
    const swiftUsd = params?.swift_fee_usd ?? 5;
    return { importTax, vat, purchase, profit, transfer, swiftUsd };
  }, [breakdown?.params, isDomesticVn, pctOverrides]);

  const anyPctOverride =
    pctOverrides.importTax != null ||
    pctOverrides.vat != null ||
    pctOverrides.purchase != null ||
    pctOverrides.profit != null;

  // When no % override is active, show the breakdown verbatim (API or local).
  // When overridden, recompute I..T + total client-side from the same formula
  // the backend engine uses, keeping I (FX-converted unit cost) from breakdown.
  const displayBreakdown = useMemo(() => {
    if (!breakdown) return breakdown;
    if (!anyPctOverride) return breakdown;
    const I = breakdown.I;
    if (I == null) return breakdown;
    const qty = calcInputs.qty;
    const K = I * qty;
    const L = vnShippingFeeVnd ?? 0;
    const M = fedexFeeVnd ?? 0;
    const N = isDomesticVn ? 0 : (K + M) * (effPct.importTax / 100);
    const O = (K + M + N) * (effPct.vat / 100);
    const P = K * (effPct.purchase / 100);
    // Swift uses the same USD→VND rate the engine recorded (fallback to fx_rate).
    const swiftRate =
      breakdown.params?.usd_to_vnd_used_for_swift ?? breakdown.fx_rate ?? 0;
    const Q =
      otherFeeOverride != null
        ? otherFeeOverride
        : (K + M + P) * (effPct.transfer / 100) + effPct.swiftUsd * swiftRate;
    const sumBeforeProfit = K + L + M + N + O + P + Q;
    const R = sumBeforeProfit * (effPct.profit / 100);
    const total = sumBeforeProfit + R;
    const S = qty > 0 ? total / qty : 0;
    const T = Math.round(S / 1000) * 1000;
    return { ...breakdown, I, K, L, M, N, O, P, Q, R, S, T, total };
  }, [
    breakdown,
    anyPctOverride,
    effPct,
    isDomesticVn,
    calcInputs.qty,
    vnShippingFeeVnd,
    fedexFeeVnd,
    otherFeeOverride,
  ]);

  // Giá báo (T) LUÔN bám displayBreakdown.T (đã làm tròn) — không còn nhánh
  // "sửa tay". Đây là 1 lần làm tròn duy nhất; Tổng = T × SL. (Thang 2026-07-02)
  useEffect(() => {
    if (displayBreakdown?.T != null) setFinalQuotePrice(Math.round(displayBreakdown.T as number));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayBreakdown?.T]);

  // 1b.5 — Margin + Giá báo = ONE source. Both derive from the SAME breakdown
  // that is displayed in the "Tính giá — phân tích đầy đủ" panel, so the
  // form's margin / lãi always agree with the panel (no parallel computation).
  //  - sale price = form.sale_vnd (written by "Áp dụng giá báo" = displayBreakdown.T),
  //    falling back to the panel's T when not yet applied.
  //  - per-unit cost = the panel's cost-before-profit per unit = (total - R)/qty.
  const breakdownUnitCost = useMemo<number | null>(() => {
    const b = displayBreakdown;
    if (!b || b.total == null) return null;
    const qty = calcInputs.qty > 0 ? calcInputs.qty : 1;
    const costBeforeProfit = Number(b.total) - Number(b.R ?? 0);
    if (!Number.isFinite(costBeforeProfit) || costBeforeProfit <= 0) return null;
    return costBeforeProfit / qty;
  }, [displayBreakdown, calcInputs.qty]);

  // Sale price used for margin = Giá báo đã làm tròn 1 lần (T). (2026-07-02)
  const effectiveSaleVnd = useMemo<number | null>(() => {
    if (displayBreakdown?.T != null) return Math.round(displayBreakdown.T);
    return finalQuotePrice != null ? Math.round(finalQuotePrice) : null;
  }, [finalQuotePrice, displayBreakdown?.T]);

  const derivedMargin = useMemo<number | null>(() => {
    if (breakdownUnitCost == null || breakdownUnitCost <= 0) return null;
    if (effectiveSaleVnd == null) return null;
    return ((effectiveSaleVnd - breakdownUnitCost) / breakdownUnitCost) * 100;
  }, [breakdownUnitCost, effectiveSaleVnd]);

  const derivedLai = useMemo<number | null>(() => {
    if (breakdownUnitCost == null || effectiveSaleVnd == null) return null;
    const qty = calcInputs.qty > 0 ? calcInputs.qty : 1;
    return (effectiveSaleVnd - breakdownUnitCost) * qty;
  }, [breakdownUnitCost, effectiveSaleVnd, calcInputs.qty]);

  // Build the FROZEN pricing-context object. Single source of truth shared by
  // "Áp dụng giá báo" (writes it into quote_snapshot) AND "Lưu đợt tính giá"
  // (POSTs it as a versioned pricing-snapshot). Keeping ONE builder guarantees
  // the two paths capture identical shapes — reopening a version reproduces the
  // exact breakdown the quote was exported with. (Versioned pricing 2026-07-01)
  const buildPricingSnapshot = (unit: number) => {
    const bd = displayBreakdown;
    return {
      unit_price_vnd: unit,
      qty: calcInputs.qty,
      source: 'auto',
      supplier_price_id: primarySupplier?.id ?? null,
      supplier_name: primarySupplier?.supplier_name ?? null,
      cost_amount: primarySupplier?.cost_amount ?? null,
      currency: primarySupplier?.currency ?? 'VND',
      fx_rate: bd?.fx_rate ?? null,
      fx_date: bd?.fx_rate_date ?? null,
      is_domestic: isDomesticVn,
      fedex_fee_vnd: fedexFeeVnd,
      vn_shipping_fee_vnd: vnShippingFeeVnd,
      other_fee_override: otherFeeOverride,
      pct_overrides: pctOverrides,
      breakdown: bd
        ? {
            I: bd.I, K: bd.K, L: bd.L, M: bd.M, N: bd.N, O: bd.O,
            P: bd.P, Q: bd.Q, R: bd.R, S: bd.S, T: bd.T, total: bd.total,
          }
        : null,
      params: bd?.params ?? null,
      computed_at: new Date().toISOString(),
    };
  };

  // "Áp dụng giá báo" đã BỎ (2026-07-02): freeze sale_vnd + quote_snapshot nay
  // diễn ra tự động trong saveMutation mỗi lần Lưu (giá thống nhất, 1 lần làm tròn).

  /* ─────────── Versioned pricing snapshots (đợt tính giá) ─────────── */
  // Which saved version is currently loaded into the form (null = live/edit).
  const [loadedSnapVersion, setLoadedSnapVersion] = useState<number | null>(null);
  // Full snapshot being VIEWED from history. When set, the breakdown panel shows
  // THIS đợt's FROZEN công thức (I..T + fx + params) verbatim — not a live
  // recompute against the current cost. Cleared the moment the user edits an input.
  const [loadedSnapshot, setLoadedSnapshot] = useState<Record<string, any> | null>(null);

  const effectiveBreakdown = useMemo(() => {
    const b = loadedSnapshot?.breakdown as any;
    if (loadedSnapshot && b) {
      return {
        ...b,
        fx_rate: loadedSnapshot.fx_rate ?? b.fx_rate ?? null,
        fx_rate_date: loadedSnapshot.fx_date ?? b.fx_rate_date ?? null,
        params: loadedSnapshot.params ?? b.params ?? null,
        rule_applied: b.rule_applied ?? 'Đợt đã lưu',
        rule_used: b.rule_used ?? { item_type: 'default', description_vi: null, fallback_to_default: false },
      } as typeof displayBreakdown;
    }
    return displayBreakdown;
  }, [loadedSnapshot, displayBreakdown]);

  // Leave history-view as soon as the user changes any input the load restored →
  // resume the LIVE compute (editing then "Lưu đợt" creates a NEW đợt).
  useEffect(() => {
    if (!loadedSnapshot) return;
    const s = loadedSnapshot;
    const po = (s.pct_overrides || {}) as any;
    const eq = (a: any, b: any) => (a ?? null) === (b ?? null);
    const same =
      eq(vnShippingFeeVnd, s.vn_shipping_fee_vnd) &&
      eq(fedexFeeVnd, s.fedex_fee_vnd) &&
      eq(otherFeeOverride, s.other_fee_override) &&
      isDomesticVn === !!s.is_domestic &&
      eq(pctOverrides.importTax, po.importTax) &&
      eq(pctOverrides.vat, po.vat) &&
      eq(pctOverrides.purchase, po.purchase) &&
      eq(pctOverrides.profit, po.profit);
    if (!same) {
      setLoadedSnapshot(null);
      setLoadedSnapVersion(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vnShippingFeeVnd, fedexFeeVnd, otherFeeOverride, isDomesticVn, pctOverrides, loadedSnapshot]);

  // Reset history-view when the drawer switches to a different entry.
  useEffect(() => {
    setLoadedSnapshot(null);
    setLoadedSnapVersion(null);
  }, [entry?.id]);

  type PricingSnapVersion = {
    id: number;
    version: number;
    sale_vnd: number | null;
    label: string | null;
    created_at: string | null;
    created_by_email: string | null;
  };

  const pricingSnapsQ = useQuery<PricingSnapVersion[]>({
    queryKey: ['sourcing', 'entry', entry?.id, 'pricing-snapshots'],
    enabled: !!entry?.id,
    queryFn: async () => {
      const res = (await api.get(
        '/api/v1/sourcing/' + entry!.id + '/pricing-snapshots',
      )) as { data: PricingSnapVersion[] };
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 30 * 1000,
  });
  const pricingSnaps = pricingSnapsQ.data || [];

  // "Lưu đợt tính giá" thủ công đã BỎ (Thang 2026-07-02): mỗi lần Lưu entry sẽ tự
  // POST 1 đợt trong saveMutation.onSuccess (dedupe với đợt mới nhất).

  // Load a saved version's FROZEN breakdown/params directly into the form.
  // CRITICAL: render from the snapshot, do NOT call /calc-suggest (that would
  // trip the FX-staleness guard and re-apply today's % rules). Also do NOT touch
  // supplier rows / mark them dirty (would overwrite the real cost on next save).
  const loadSnapshotIntoForm = (snap: Record<string, any>, version: number) => {
    if (typeof snap.is_domestic === 'boolean') setIsDomesticVn(snap.is_domestic);
    setFedexFeeVnd(snap.fedex_fee_vnd != null ? Number(snap.fedex_fee_vnd) : null);
    setVnShippingFeeVnd(snap.vn_shipping_fee_vnd != null ? Number(snap.vn_shipping_fee_vnd) : null);
    setOtherFeeOverride(snap.other_fee_override != null ? Number(snap.other_fee_override) : null);
    const po = snap.pct_overrides;
    setPctOverrides({
      importTax: po?.importTax ?? null,
      vat: po?.vat ?? null,
      purchase: po?.purchase ?? null,
      profit: po?.profit ?? null,
    });
    // Seed the frozen FX rate (foreign currency) so I..T recompute at the ORIGINAL
    // rate, not today's. VND leaves manualFxRate null.
    const cur = (snap.currency ?? primaryCurrency) as string;
    if (cur !== 'VND' && snap.fx_rate != null && Number(snap.fx_rate) > 0) {
      setManualFxRate(Number(snap.fx_rate));
    }
    // Giá báo = the frozen T. Live re-tracking is driven by displayBreakdown.T,
    // but while a loaded snapshot is active the panel renders the frozen breakdown.
    const frozenT = snap.breakdown?.T ?? snap.unit_price_vnd ?? null;
    if (frozenT != null) setFinalQuotePrice(Math.round(Number(frozenT)));
    setLoadedSnapVersion(version);
    setLoadedSnapshot(snap);  // → panel shows this đợt's FROZEN breakdown
  };

  const loadSnapshotVersion = async (version: number) => {
    if (!entry?.id) return;
    try {
      const res = (await api.get(
        '/api/v1/sourcing/' + entry.id + '/pricing-snapshots/' + version,
      )) as { data: Record<string, any> };
      if (res.data) {
        loadSnapshotIntoForm(res.data, version);
        toast.success('Đã mở đợt tính giá #' + version);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Mở đợt tính giá thất bại');
    }
  };

  // === A2b. Create order from entry (Khách đã đặt) ===
  const createOrderMut = useMutation({
    mutationFn: async () => {
      if (!entry?.id) throw new Error('Lưu entry trước khi tạo đơn');
      // `person_in_charge` is free-text, often not an email. Send only when it
      // parses as an email; otherwise leave assignment null for backend default.
      const pic = (form.person_in_charge || '').trim();
      const assignedEmail = pic.includes('@') ? pic : null;
      const payload = {
        sourcing_entry_ids: [entry.id],
        customer_name: form.customer_name,
        assigned_to_email: assignedEmail,
        initial_status: 'confirmed' as const,
        items: [
          {
            sourcing_id: entry.id,
            quantity: form.quantity ?? 1,
            sale_unit_vnd_override: form.sale_vnd,
            note: null,
          },
        ],
        note: null,
      };
      const res = (await api.post('/api/v1/sourcing/orders', payload)) as {
        data: LinkedOrderSummary;
      };
      return res.data;
    },
    onSuccess: (data) => {
      toast.success('Đã tạo đơn ' + data.order_number + ' (Khách chốt)');
      linkedOrderQ.refetch();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || 'Tạo đơn thất bại');
    },
  });

  // === A2c. Propose payment to accounting ===
  const proposePaymentMut = useMutation({
    mutationFn: async () => {
      if (!linkedOrder?.id) throw new Error('Chưa có đơn hàng');
      const res = (await api.post(
        '/api/v1/sourcing/orders/' + linkedOrder.id + '/payment-request',
        {
          payment_method: 'bank_transfer',
          beneficiary_name: form.supplier_name,
          description:
            'Thanh toán đơn ' +
            linkedOrder.order_number +
            (form.supplier_name ? ' cho NCC ' + form.supplier_name : ''),
        },
      )) as { data: unknown };
      return res.data;
    },
    onSuccess: () => {
      toast.success('Đã đề xuất thanh toán tới kế toán');
      linkedOrderQ.refetch();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || 'Đề xuất TT thất bại');
    },
  });

  // V1 security fix (Thang 2026-06-13): GET /quote-pdf is now strictly
  // read-only — it 404s if no PDF has been rendered yet. To create / bump
  // the PDF we must POST /quote-pdf/regenerate (sales/manager/admin/etc).
  // Flow: try GET; if 404, POST regenerate then open the GET URL.
  const openQuotePdf = async () => {
    if (!linkedOrder?.id) {
      toast.message('Chưa có đơn — nhấn "Khách đã đặt" để tạo trước.');
      return;
    }
    if (typeof window === 'undefined') return;
    const pdfUrl = '/api/v1/sourcing/orders/' + linkedOrder.id + '/quote-pdf';
    try {
      // HEAD-style probe via GET — backend returns 404 quickly if no PDF yet.
      const probe = await fetch(pdfUrl, { method: 'GET', credentials: 'include' });
      if (probe.ok) {
        window.open(pdfUrl, '_blank', 'noopener');
        return;
      }
      if (probe.status === 404) {
        // No PDF exists yet — request regeneration via POST.
        await api.post(pdfUrl + '/regenerate', {});
        window.open(pdfUrl, '_blank', 'noopener');
        linkedOrderQ.refetch();
        return;
      }
      toast.error('Không tải được PDF (HTTP ' + probe.status + ')');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) {
        toast.error('Bạn không có quyền tạo lại PDF báo giá.');
      } else {
        toast.error(err?.response?.data?.detail || err?.message || 'Mở PDF thất bại');
      }
    }
  };

  // Force a fresh PDF render (bumps version, may transition draft→quoted).
  // Only callable by sales/manager/admin/procurement/director — viewer +
  // staff + accountant get 403 from the backend.
  const regenerateQuotePdf = async () => {
    if (!linkedOrder?.id) {
      toast.message('Chưa có đơn — nhấn "Khách đã đặt" để tạo trước.');
      return;
    }
    try {
      await api.post(
        '/api/v1/sourcing/orders/' + linkedOrder.id + '/quote-pdf/regenerate',
        {},
      );
      toast.success('Đã tạo lại PDF báo giá');
      if (typeof window !== 'undefined') {
        window.open(
          '/api/v1/sourcing/orders/' + linkedOrder.id + '/quote-pdf',
          '_blank',
          'noopener',
        );
      }
      linkedOrderQ.refetch();
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) {
        toast.error('Bạn không có quyền tạo lại PDF báo giá.');
      } else {
        toast.error(err?.response?.data?.detail || err?.message || 'Tạo lại PDF thất bại');
      }
    }
  };
  void regenerateQuotePdf;

  // 4. FIELD COMPLETION PROGRESS
  const completion = useMemo(() => {
    const total = COMPLETION_FIELDS.length;
    let filled = 0;
    for (const k of COMPLETION_FIELDS) {
      if (hasValue(form[k])) filled += 1;
    }
    const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
    return { filled, total, pct };
  }, [form]);

  // 10. SECTION PROGRESS DOTS
  const sectionStatus = useMemo(() => {
    const productKeyFilled = hasValue(form.model) || hasValue(form.product_name) || hasValue(form.bqms_code);
    const productOthers = [form.maker].filter(hasValue).length;
    const productStatus =
      productKeyFilled && hasValue(form.product_name) && hasValue(form.maker)
        ? 'complete'
        : productKeyFilled || productOthers > 0
          ? 'partial'
          : 'empty';

    const customerComplete =
      hasValue(form.customer_name) && hasValue(form.person_in_charge) && hasValue(form.inquiry_date);
    const customerStatus = customerComplete
      ? 'complete'
      : hasValue(form.customer_name) || hasValue(form.person_in_charge) || hasValue(form.inquiry_date)
        ? 'partial'
        : 'empty';

    const pricingComplete = hasValue(form.sale_vnd) && hasValue(form.cost_vnd) && hasValue(form.quantity);
    const pricingStatus = pricingComplete
      ? 'complete'
      : hasValue(form.sale_vnd) || hasValue(form.cost_vnd) || hasValue(form.quantity)
        ? 'partial'
        : 'empty';

    // Batch #4 (V6): validate the ACTUAL multi-supplier rows, not the dead
    // legacy form.supplier_* fields (the UI stopped writing them long ago, so
    // the old check reported "thiếu NCC" even for entries with 3 suppliers).
    const supplierComplete = supplierRows.some(
      (r) => (r.supplier_name?.trim()?.length ?? 0) > 0 && (r.cost_amount ?? 0) > 0,
    );
    const supplierStatus = supplierComplete
      ? 'complete'
      : supplierRows.some((r) => (r.supplier_name?.trim()?.length ?? 0) > 0)
        ? 'partial'
        : 'empty';

    const classificationStatus = hasValue(form.row_classification)
      ? 'complete'
      : hasValue(form.notes)
        ? 'partial'
        : 'empty';

    return {
      product: productStatus,
      customer: customerStatus,
      pricing: pricingStatus,
      supplier: supplierStatus,
      classification: classificationStatus,
    } as Record<string, 'complete' | 'partial' | 'empty'>;
  }, [form]);

  const validation = useMemo(() => {
    // Nothing is required (Thang 2026-06-30): backend accepts empty payloads, so
    // the form never blocks save. Kept as a stable shape for the footer banner /
    // disabled props that still reference validation.errors.
    const errors: { field: string; label: string }[] = [];
    return { errors };
  }, []);

  // Tab strategy: switch active section instead of scrolling. This keeps the
  // drawer body inside 1 viewport — no long vertical scroll on the "Sản phẩm"
  // tab. Each tab content gets its own dedicated panel that fits the viewport.
  // Single-page (Thang 2026-06-15): render all sections stacked so the form is
  // filled in one scroll; the nav pills become quick-jump anchors.
  const showAll = true;
  const scrollToSection = (id: string) => {
    setActiveSection(id);
    if (typeof document !== 'undefined') {
      document.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // 11. RESET handler
  const handleReset = () => {
    if (typeof window === 'undefined') return;
    const ok = window.confirm('Xóa hết và bắt đầu lại?');
    if (!ok) return;
    setForm({ ...EMPTY, ...smartDefaults() });
    setDuplicateCount(0);
    setSaveError(null);
    toast.success('Đã reset form');
  };

  const SECTIONS = [
    { id: 'product', label: 'Sản phẩm', icon: <Package className="h-4 w-4" /> },
    { id: 'customer', label: 'Khách hàng', icon: <Users className="h-4 w-4" /> },
    { id: 'pricing', label: 'Giá', icon: <DollarSign className="h-4 w-4" /> },
    { id: 'supplier', label: 'Nhà cung cấp', icon: <Factory className="h-4 w-4" /> },
    { id: 'classification', label: 'Phân loại / Ghi chú', icon: <Tag className="h-4 w-4" /> },
  ];

  const dotColor = (s: 'complete' | 'partial' | 'empty') =>
    s === 'complete' ? 'bg-emerald-500' : s === 'partial' ? 'bg-amber-500' : 'bg-slate-300';

  return (
    <div className="fixed inset-0 z-[110] flex justify-end" role="presentation">
      {/* SR-only live region announces save/error to AT users */}
      <div role="status" aria-live="polite" id={liveId} className="sr-only">
        {liveMsg}
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm cursor-default"
        aria-label="Đóng (Esc)"
      />
      <motion.aside
        ref={dialogRef as React.RefObject<HTMLElement>}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-[1200px] bg-slate-50 h-full overflow-hidden shadow-2xl flex flex-col focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─────────── Sticky Header ─────────── */}
        <div className="sticky top-0 z-20">
          <div className="relative bg-white text-slate-900 border-b border-slate-200 px-7 py-5">
            <div className="flex items-start gap-4">
              <div className="h-14 w-14 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
                <Package className="h-7 w-7 text-white" strokeWidth={2.2} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {isEditing ? 'Sửa entry #' + (entry?.id ?? '') : 'Lưu nguồn cung mới'}
                </div>
                <h2 id={titleId} className="mt-1 text-[26px] font-bold tracking-tight text-slate-900 truncate">
                  {form.model || form.product_name || form.bqms_code || 'Entry mới'}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {form.bqms_code && (
                    <span className="inline-flex items-center gap-1 rounded-md font-mono text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200 px-2 py-0.5">
                      <Tag className="h-3 w-3" />
                      {form.bqms_code}
                    </span>
                  )}
                  {form.catalog_status && (
                    <span className="inline-flex items-center gap-1.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200 px-2 py-0.5">
                      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[form.catalog_status as StatusKey])} />
                      {STATUS_LABEL[form.catalog_status as StatusKey] || form.catalog_status}
                    </span>
                  )}
                  {form.stage && (
                    <span className="inline-flex items-center gap-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200 px-2 py-0.5">
                      S{form.stage} — {STAGE_LABEL[form.stage]}
                    </span>
                  )}
                  {form.row_classification && (
                    <span className="inline-flex items-center gap-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200 px-2 py-0.5">
                      {form.row_classification}
                    </span>
                  )}
                  {/* A3. ORDER STATUS BADGE */}
                  {linkedOrder && (() => {
                    const meta = ORDER_STATUS_META[linkedOrder.status] || ORDER_STATUS_META.draft;
                    const Icon = meta.icon;
                    return (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md text-xs font-bold ring-1 px-2 py-0.5',
                          meta.badgeClass,
                        )}
                        title={'Đơn ' + linkedOrder.order_number + ' — ' + meta.label}
                      >
                        <Icon className="h-3 w-3" />
                        Đơn: {meta.label}
                        <span className="font-mono text-[11px] opacity-70 ml-1">
                          #{linkedOrder.order_number}
                        </span>
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <AnimatePresence>
                  {saveMutation.isPending && (
                    <motion.span
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-50 text-sky-700 text-xs font-semibold ring-1 ring-sky-200"
                    >
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang lưu
                    </motion.span>
                  )}
                  {saveMutation.isSuccess && !saveMutation.isPending && (
                    <motion.span
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold ring-1 ring-emerald-200"
                    >
                      <Cloud className="h-3.5 w-3.5" /> Đã lưu
                    </motion.span>
                  )}
                </AnimatePresence>
                <button
                  type="button"
                  onClick={onClose}
                  className="h-10 w-10 rounded-lg bg-slate-100 hover:bg-slate-200 ring-1 ring-slate-200 flex items-center justify-center transition-colors"
                  aria-label="Đóng"
                >
                  <X className="h-5 w-5 text-slate-600" />
                </button>
              </div>
            </div>
          </div>

          {/* Section nav with progress dots */}
          <div className="bg-white border-b border-slate-200 px-7 py-2.5">
            <nav className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
              {SECTIONS.map((s) => {
                const st = sectionStatus[s.id] || 'empty';
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => scrollToSection(s.id)}
                    className={cn(
                      'inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold transition-all shrink-0',
                      activeSection === s.id
                        ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    )}
                  >
                    <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor(st))} />
                    <span className={activeSection === s.id ? 'text-brand-600' : 'text-slate-400'}>{s.icon}</span>
                    {s.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* ─────────── Body — tabbed (no long scroll) ─────────────────── */}
        {/* Strategy: replace stacked sections with a tab switch. Only ONE
            tab content renders at a time → the "Sản phẩm" tab fits in 1
            viewport at 1080×900 (80% zoom). Image + catalog meta are
            embedded as a side rail INSIDE the Sản phẩm tab so the user
            doesn't have to jump tabs to see a picture. */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Top status row — progress + error pinned above the tab body */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-slate-600 tracking-wider uppercase">
                  Hoàn thiện {completion.filled}/{completion.total} ({completion.pct}%)
                </span>
                {completion.pct === 100 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" /> Hoàn tất
                  </span>
                )}
              </div>
              <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-brand-500 transition-all duration-300"
                  style={{ width: String(completion.pct) + '%' }}
                />
              </div>
            </div>
            {saveError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2 max-w-md">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="truncate" title={saveError}>{saveError}</span>
              </div>
            )}
          </div>

          {/* ── 2-column page layout (Thang 2026-06-15): LEFT = product /
              customer / tax / classification fields; RIGHT = image + quick
              actions, pricing, suppliers. Collapses to a single column < lg.
              Each section keeps its data-sec anchor for the nav pills. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {/* ───────────────── LEFT COLUMN ───────────────── */}
            <div className="space-y-4">
          {/* ── Sản phẩm (fields only) ─────────────────────────────── */}
          <div data-sec="product" className="scroll-mt-4" />
          {showAll && (
            <div className="space-y-4 min-w-0">
                <SectionCard
                  id="product"
                  icon={<Package className="h-5 w-5" />}
                  title="Thông tin sản phẩm"
                  subtitle="Mã, model, brand"
                  dense
                >
                  <FieldGrid cols={2}>
                    <Field label="Model / Spec">
                      <Input value={form.model} onChange={(v) => setField('model', v)} placeholder="POM KT120XD8" />
                    </Field>
                    <Field label="Mã BQMS" hint="Để trống nếu không liên kết RFQ">
                      <Input value={form.bqms_code} onChange={(v) => setField('bqms_code', v)} placeholder="Z0000000-838934" mono />
                      {debouncedBqmsCode.length >= 3 && (
                        <>
                          {marketRefQ.isLoading ? (
                            <div className="mt-1.5 h-6 w-48 animate-pulse rounded-md bg-slate-100" />
                          ) : marketRefChip.any ? (
                            <div className="mt-1.5 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                              <Tag className="h-3 w-3 text-brand-500" />
                              {marketRefChip.tt != null && (
                                <span>TT: <b className="text-slate-800">{fmtVnd(marketRefChip.tt)}</b></span>
                              )}
                              {marketRefChip.von != null && (
                                <span>· Vốn: <b className="text-slate-800">{fmtVnd(marketRefChip.von)}</b></span>
                              )}
                              {marketRefChip.chao != null && (
                                <span>· Chào: <b className="text-slate-800">{fmtVnd(marketRefChip.chao)}</b></span>
                              )}
                            </div>
                          ) : null}
                        </>
                      )}
                    </Field>
                    <Field label="Nhà sản xuất">
                      <Input value={form.maker} onChange={(v) => setField('maker', v)} placeholder="MISUMI" list="sugg-makers" />
                    </Field>
                    <Field label="Tên sản phẩm">
                      <Input value={form.product_name} onChange={(v) => setField('product_name', v)} placeholder="ANTENNA CABLE ASS'Y TOOL" />
                    </Field>
                    {/* V9: Người phụ trách + Ngày hỏi giá đã gộp vào mục "Khách
                        hàng & Người phụ trách" (trước đây trùng ở 2 nơi). */}
                    {form.brand_canonical !== undefined && form.brand_canonical && (
                      <Field label="Brand canonical" readOnly>
                        <Input value={form.brand_canonical || ''} onChange={() => {}} disabled placeholder="—" />
                      </Field>
                    )}
                  </FieldGrid>
                </SectionCard>

                {/* Catalog meta strip — visible only when enriched */}
                {(form.catalog_status !== undefined || form.stage !== undefined) && (
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[11px] uppercase font-bold tracking-wider text-slate-500">
                        <ShieldCheck className="h-3.5 w-3.5 inline mr-1" />
                        Catalog
                      </span>
                      {form.catalog_status && (
                        <span className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1',
                          STATUS_BADGE[form.catalog_status as StatusKey],
                        )}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[form.catalog_status as StatusKey])} />
                          {STATUS_LABEL[form.catalog_status as StatusKey] || form.catalog_status}
                        </span>
                      )}
                      {form.stage && (
                        <div className="flex-1 min-w-[200px] max-w-md">
                          <FunnelStageVisualization stage={form.stage} />
                        </div>
                      )}
                    </div>
                    {form.missing_fields && form.missing_fields.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                          Thiếu {form.missing_fields.length}:
                        </span>
                        {form.missing_fields.slice(0, 8).map((f) => (
                          <span key={f} className="inline-flex items-center rounded-md bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-1.5 py-0.5 text-[11px] font-semibold">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
            </div>
          )}

          {/* ── Khách hàng (fields only) ─────────────────────────────── */}
          <div data-sec="customer" className="scroll-mt-4 mt-4" />
          {showAll && (
            <div className="space-y-4">
              <SectionCard
                id="customer"
                icon={<Users className="h-5 w-5" />}
                title="Khách hàng & Người phụ trách"
                subtitle="Ngày inquiry và sale handler"
                dense
              >
                <FieldGrid cols={2}>
                  <Field
                    label="Khách hàng (danh bạ CRM)"
                    hint="Chọn để tự điền tên/MST/địa chỉ vào báo giá khi xuất"
                  >
                    <CustomerPicker
                      value={pickedCustomer}
                      onChange={(c) => {
                        setPickedCustomer(c);
                        setField('customer_id', (c?.id ?? null) as any);
                        if (c) setField('customer_name', c.company_name);
                      }}
                    />
                  </Field>
                  <Field label="Tên hiển thị trên báo giá">
                    <Input
                      value={form.customer_name}
                      onChange={(v) => setField('customer_name', v)}
                      placeholder="Tự điền khi chọn danh bạ — hoặc gõ tay cho khách lạ"
                      list="sugg-customers"
                    />
                  </Field>
                  <Field label="Người phụ trách (Sale)">
                    <Input
                      value={form.person_in_charge}
                      onChange={(v) => setField('person_in_charge', v)}
                      placeholder="Linh, Phong, ..."
                      list="sugg-persons"
                    />
                  </Field>
                  <Field label="Ngày hỏi giá">
                    <Input type="date" value={toIsoDate(form.inquiry_date)} onChange={(v) => setField('inquiry_date', v)} icon={<Calendar className="h-4 w-4" />} />
                  </Field>
                </FieldGrid>
              </SectionCard>

              {/* Audit on side */}
              {isEditing ? (
                <SectionCard icon={<Clock className="h-5 w-5" />} title="Lịch sử" dense>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0 ring-1 ring-brand-200">
                        {(entry?.created_by_email || '?')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-900 truncate text-xs">{shortName(entry?.created_by_email)}</div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-600">Tạo</div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {fmtDateTime(entry?.created_at)}
                        </div>
                      </div>
                    </div>
                    {entry?.updated_at && entry.updated_at !== entry.created_at && (
                      <div className="flex items-start gap-2.5 pt-2 border-t border-slate-100">
                        <div className="h-8 w-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold shrink-0 ring-1 ring-sky-200">
                          {(entry?.updated_by_email || entry?.created_by_email || '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-900 truncate text-xs">
                            {shortName(entry?.updated_by_email || entry?.created_by_email)}
                          </div>
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-600">Sửa lần cuối</div>
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            {fmtDateTime(entry?.updated_at)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </SectionCard>
              ) : null}
            </div>
          )}

          {/* ── Phân loại & Ghi chú ─────────────────────────────────── */}
          <div data-sec="classification" className="scroll-mt-4 mt-4" />
          {showAll && (
            <SectionCard id="classification" icon={<Tag className="h-5 w-5" />} title="Phân loại & Ghi chú" subtitle="Trạng thái xử lý & ghi chú" dense>
              <div className="space-y-4">
                <Field label="Trạng thái xử lý" hint="Giai đoạn xử lý của mã hàng — KHÔNG ảnh hưởng tới giá">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setField('row_classification', null)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold ring-1 transition-all',
                        !form.row_classification
                          ? 'bg-slate-100 text-slate-700 ring-slate-300'
                          : 'bg-white text-slate-400 ring-slate-200 hover:bg-slate-50'
                      )}
                    >
                      (Không)
                    </button>
                    {CLASSIFICATION_OPTIONS.map((opt) => {
                      const active = form.row_classification === opt.value;
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setField('row_classification', active ? null : opt.value)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold ring-1 transition-all',
                            active
                              ? opt.activeClass
                              : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label="Ghi chú công khai" hint="Hiển thị cho mọi user">
                  <Textarea
                    value={form.notes}
                    onChange={(v) => setField('notes', v)}
                    placeholder="Ship time, MOQ, điều kiện thanh toán..."
                    rows={3}
                  />
                </Field>

                {form.notes_internal !== undefined && (
                  <Field label="Ghi chú nội bộ" hint="Chỉ team sourcing thấy">
                    <Textarea
                      value={form.notes_internal}
                      onChange={(v) => setField('notes_internal', v)}
                      placeholder="Note nội bộ..."
                      rows={2}
                    />
                  </Field>
                )}
              </div>
            </SectionCard>
          )}
            </div>
            {/* ───────────────── RIGHT COLUMN ───────────────── */}
            <div className="space-y-4">
          {/* ── Ảnh (rail re-homed from Sản phẩm) ─── */}
          {showAll && (
            <div className="space-y-4">
              <SectionCard icon={<ImageIcon className="h-5 w-5" />} title="Ảnh" subtitle="Dán ảnh (Ctrl+V), kéo thả hoặc URL" dense>
                <ImageUploader value={form.image_url} onChange={(url) => setField('image_url', url)} />
              </SectionCard>
            </div>
          )}

          {/* ── Giá (FX banner + breakdown + auto-calc) ─────────────── */}
          <div data-sec="pricing" className="scroll-mt-4 mt-4" />
          {showAll && (
            <div className="space-y-4">
            <SectionCard id="pricing" icon={<DollarSign className="h-5 w-5" />} title="Giá — Multi-currency" subtitle="Chi phí ngoại tệ + giá bán VND" dense>
              {/* FIX B5 (Thang 2026-06-13) — FX freshness banner.
                  Hardcoded DEFAULT_FX_TO_VND đã được gỡ ở backend
                  (sourcing_pricing_engine.py); engine query exchange_rates
                  table. Banner báo cho user nếu rate đã cũ. */}
              <div
                className={cn(
                  'mb-4 flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-sm ring-1',
                  fxDaysAgo == null
                    ? 'bg-slate-50 text-slate-700 ring-slate-200'
                    : fxDaysAgo <= 1
                    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                    : fxDaysAgo <= 7
                    ? 'bg-amber-50 text-amber-800 ring-amber-200'
                    : 'bg-rose-50 text-rose-800 ring-rose-200',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Calculator className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {fxDaysAgo == null
                      ? 'Tỷ giá chưa có thông tin cập nhật'
                      : fxDaysAgo === 0
                      ? 'Tỷ giá cập nhật hôm nay'
                      : `Tỷ giá cập nhật ${fxDaysAgo} ngày trước`}
                    {fxDateLabel && (
                      <span className="ml-1 font-semibold tabular-nums opacity-80">({fxDateLabel})</span>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRefreshFx}
                  disabled={isRefreshingFx}
                  className="font-semibold underline-offset-2 hover:underline shrink-0 inline-flex items-center gap-1 disabled:opacity-60 disabled:cursor-wait"
                  title="Tải lại tỷ giá từ server"
                >
                  {isRefreshingFx ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  {isRefreshingFx ? 'Đang cập nhật…' : 'Cập nhật'}
                </button>
              </div>

              {/* Quick cost entry (Thang 2026-06-15): nhập giá nhập NGAY tại mục
                  Giá; bind vào NCC chính nên breakdown tính được mà không cần mở
                  mục Nhà cung cấp. */}
              <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Factory className="h-4 w-4 text-slate-500" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Giá nhập (NCC chính)
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[110px_1fr_100px_110px]">
                  <Field label="Tiền tệ">
                    <select
                      value={primarySupplier?.currency ?? 'VND'}
                      onChange={(e) => setPrimaryCost({ currency: e.target.value as CurrencyCode })}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                    >
                      {CURRENCY_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>{o.code} · {o.symbol}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Giá nhập / đơn vị" hint="Tỷ giá lấy tự động từ bảng tỷ giá theo tiền tệ">
                    <NumberInput
                      value={primarySupplier?.cost_amount ?? null}
                      onChange={(n) => setPrimaryCost({ cost_amount: n })}
                      // VND has no sub-unit → decimals=0 so "12.000"/"12,000" both
                      // parse to 12000 (not 12). Foreign currencies keep 2 decimals
                      // for prices like 12.50 USD. (Thang bug: 12000 → 12.)
                      decimals={(primarySupplier?.currency ?? 'VND') === 'VND' ? 0 : 2}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="Số lượng">
                    <NumberInput
                      value={form.quantity ?? null}
                      onChange={(n) => setField('quantity', n as any)}
                      placeholder="1"
                    />
                  </Field>
                  <Field label="Cân nặng (kg)" hint="Cho hàng hỏi NN">
                    <NumberInput
                      value={form.weight_kg ?? null}
                      onChange={(n) => setField('weight_kg', n as any)}
                      decimals={2}
                      placeholder="0.25"
                    />
                  </Field>
                </div>

                {/* Tỷ giá sửa tay (Thang 2026-06-17): hàng ngoại tệ có thể chỉnh
                    tỷ giá bằng tay cho riêng báo giá này; bỏ trống = tự động. */}
                {(primarySupplier?.currency ?? 'VND') !== 'VND' && (
                  <div className="mt-3">
                    <Field
                      label={`Tỷ giá (₫ / 1 ${primarySupplier?.currency})`}
                      hint="Tự động theo bảng tỷ giá — gõ số để chỉnh tay cho báo giá này"
                    >
                      <div className="flex items-center gap-2">
                        <NumberInput
                          value={
                            manualFxRate ??
                            (isEditing && entry?.fx_rate_snapshot && entry.fx_rate_snapshot > 0
                              ? entry.fx_rate_snapshot
                              : (exchangeRates[(primarySupplier?.currency ?? 'VND') as CurrencyCode] ?? null))
                          }
                          onChange={(n) => setManualFxRate(n)}
                          decimals={2}
                          suffix="₫"
                          placeholder="0"
                        />
                        {manualFxRate != null && (
                          <button
                            type="button"
                            onClick={() => setManualFxRate(null)}
                            title="Về tỷ giá tự động"
                            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-brand-600"
                          >
                            ↺ Auto
                          </button>
                        )}
                      </div>
                    </Field>
                  </div>
                )}

                <p className="mt-2 text-xs text-slate-500">
                  {primarySupplier
                    ? 'NCC chính: ' + (primarySupplier.supplier_name || '(chưa đặt tên — bổ sung ở mục Nhà cung cấp)')
                    : 'Nhập giá để tạo NCC chính. Quản lý nhiều NCC ở mục Nhà cung cấp bên dưới.'}
                </p>
              </div>

              {/* 6. DUPLICATE DETECTION chip */}
              {isCreating && duplicateCount > 0 && (
                <div className="mb-4 inline-flex items-center gap-2 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-sm font-semibold text-amber-800">
                  <AlertCircle className="h-4 w-4" />
                  Đã có {duplicateCount} entry với mã BQMS này
                </div>
              )}

              {/* Thiếu tỷ giá — foreign currency with no resolvable rate. Never
                  silently compute at 1/0: warn + point the user at the tỷ giá input. */}
              {fxMissing && (
                <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-sm text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="font-semibold">Thiếu tỷ giá cho {primaryCurrency}.</span>{' '}
                    Bảng tỷ giá chưa có {primaryCurrency} và entry chưa có tỷ giá đã lưu — nhập tỷ giá tay ở ô
                    "Tỷ giá" bên trên để tính giá. Hệ thống không tự dùng 1 để tránh sai giá.
                  </span>
                </div>
              )}

              {/* B7. TÍNH GIÁ — Full breakdown (cells I..T) */}
              <TinhGiaBreakdownPanel
                breakdown={effectiveBreakdown}
                pct={effPct}
                pctOverrides={pctOverrides}
                onChangePct={setPctOverride}
                isDomesticVn={isDomesticVn}
                onToggleDomestic={(v) => setIsDomesticVn(v)}
                vnShippingFeeVnd={vnShippingFeeVnd}
                onChangeVnShipping={(v) => setVnShippingFeeVnd(v)}
                vnShippingHistory={entry?.vn_shipping_history ?? null}
                onPickVnShipping={(v) => setVnShippingFeeVnd(v)}
                fedexFeeVnd={fedexFeeVnd}
                onChangeFedex={(v) => setFedexFeeVnd(v)}
                otherFeeOverride={otherFeeOverride}
                onChangeOtherFee={(v) => setOtherFeeOverride(v)}
                qty={calcInputs.qty > 0 ? calcInputs.qty : 1}
                onOpenRuleEdit={() => setPricingRuleEditOpen(true)}
                hasPrimarySupplier={loadedSnapshot != null || (!!primarySupplier && (primarySupplier.cost_amount ?? 0) > 0)}
                isLoading={calcSuggestQ.isLoading || calcSuggestQ.isFetching}
                isError={calcSuggestQ.isError}
                errorReason={
                  (calcSuggestQ.error as any)?.detail ||
                  (calcSuggestQ.error as any)?.message ||
                  null
                }
                onRetry={() => calcSuggestQ.refetch()}
                primaryCurrency={primarySupplier?.currency ?? null}
                onCreateRuleForType={(itemType) => {
                  setPricingRulePrefillType(itemType);
                  setPricingRuleEditOpen(true);
                }}
                onGoToSupplier={() => scrollToSection('supplier')}
                primarySupplierName={primarySupplier?.supplier_name ?? null}
                fxIsManual={manualFxRate != null}
              />

              {/* ── Đợt tính giá (versioned pricing history) ────────────────
                  "Lưu đợt tính giá" freezes the CURRENT breakdown as an immutable
                  version (explicit — never auto-appended on save). "Lịch sử tính
                  giá" lists versions newest-first; clicking one loads its FROZEN
                  breakdown into the form for view+edit (editing then saving a new
                  đợt leaves the old one untouched). Only for existing entries. */}
              {isEditing && entry?.id && (
                <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                      <History className="h-4 w-4 text-brand-600" />
                      Lịch sử tính giá
                      {loadedSnapVersion != null && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200">
                          Đang xem Đợt {loadedSnapVersion}
                        </span>
                      )}
                    </div>
                    {/* Đợt tính giá nay được LƯU TỰ ĐỘNG mỗi lần Lưu entry (đã bỏ
                        nút thủ công). Danh sách + xem lại vẫn giữ. */}
                    <span className="text-[11px] font-medium text-slate-400">
                      Tự động lưu mỗi lần Lưu
                    </span>
                  </div>

                  <div className="mt-3">
                    {pricingSnapsQ.isLoading ? (
                      <p className="text-xs text-slate-400">Đang tải lịch sử…</p>
                    ) : pricingSnaps.length === 0 ? (
                      <p className="text-xs text-slate-400">
                        Chưa có đợt tính giá nào. Nhấn "Lưu" để lưu bản hiện tại.
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {pricingSnaps.map((v) => {
                          const isLoaded = loadedSnapVersion === v.version;
                          return (
                            <li key={v.id}>
                              <button
                                type="button"
                                onClick={() => loadSnapshotVersion(v.version)}
                                className={cn(
                                  'flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50',
                                  isLoaded && 'bg-brand-50/60 ring-1 ring-brand-200',
                                )}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-slate-800">
                                      Đợt {v.version}
                                    </span>
                                    {v.label && (
                                      <span className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                                        {v.label}
                                      </span>
                                    )}
                                    {isLoaded && (
                                      <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                                        Đang xem
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-slate-500">
                                    {fmtDateTime(v.created_at)} · {shortName(v.created_by_email)}
                                  </p>
                                </div>
                                <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-slate-900">
                                  {fmtVnd(v.sale_vnd)}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {/* Applied quote chip + margin/lãi preview — 1b.5: ONE source.
                  Giá báo + Margin + Lãi all derive from the SAME displayBreakdown
                  shown in the "Tính giá — phân tích đầy đủ" panel:
                    · Giá báo = form.sale_vnd (written by "Áp dụng giá báo" = T),
                      else the panel's T (effectiveSaleVnd).
                    · Cost = breakdown per-unit cost-before-profit (breakdownUnitCost).
                  No parallel margin computation. */}
              {(effectiveSaleVnd != null || breakdownUnitCost != null) && (
                <div className="rounded-xl bg-emerald-50/40 border border-emerald-200 p-4 mb-4">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    {effectiveSaleVnd != null && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 px-2.5 py-1 font-bold tabular-nums">
                        <Calculator className="h-3.5 w-3.5" />
                        Giá báo: {fmtVnd(effectiveSaleVnd)}
                      </span>
                    )}
                    {breakdownUnitCost != null && (
                      <span className="text-slate-600">
                        Giá vốn /đơn vị: <span className="font-bold tabular-nums text-slate-900">{fmtVnd(breakdownUnitCost)}</span>
                      </span>
                    )}
                    {derivedMargin != null && (
                      <span className="text-emerald-700 font-bold">
                        Margin: <span className="tabular-nums">{derivedMargin.toFixed(1)}%</span>
                      </span>
                    )}
                    {derivedLai != null && (
                      <span className="text-emerald-700 font-bold">
                        Lãi: <span className="tabular-nums">{String(Math.round(derivedLai).toLocaleString('vi-VN')) + ' ₫'}</span>
                      </span>
                    )}
                    {derivedMargin != null && derivedMargin < 0 ? (
                      <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                        <XCircle className="h-3.5 w-3.5" />
                        LỖ — kiểm tra giá
                      </span>
                    ) : derivedMargin != null && derivedMargin < 10 ? (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Margin thấp
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </SectionCard>

            </div>
          )}

          {/* ── Nhà cung cấp (multi-row) ────────────────────────────── */}
          <div data-sec="supplier" className="scroll-mt-4 mt-4" />
          {showAll && (
            <SectionCard
              id="supplier"
              icon={<Factory className="h-5 w-5" />}
              title="Nhà cung cấp"
              subtitle="Nhiều NCC cho cùng 1 mã — chọn NCC chính"
              dense
            >
              <div className="space-y-3">
                {supplierRows.length === 0 && (
                  // ICE UX #2: empty state with prominent CTA instead of a
                  // dead notice. One click adds the first NCC and lands focus
                  // on the supplier-name field.
                  <div className="rounded-xl border border-dashed border-brand-300 bg-brand-50/40 px-4 py-8 text-center">
                    <Factory className="mx-auto h-8 w-8 text-brand-500" aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold text-slate-700">
                      Chưa có nhà cung cấp nào
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Mỗi mã có thể đăng nhiều NCC; hệ thống tự chọn NCC chính theo giá rẻ nhất.
                    </p>
                    <button
                      type="button"
                      onClick={addSupplierRow}
                      aria-label="Thêm nhà cung cấp đầu tiên"
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
                    >
                      <Plus className="h-4 w-4" />
                      Thêm NCC đầu tiên
                    </button>
                  </div>
                )}

                {supplierRows.map((row, idx) => (
                  <SupplierRowCard
                    key={(row.id ? 'id-' + row.id : 'new-' + idx)}
                    row={row}
                    index={idx}
                    exchangeRates={exchangeRates}
                    suppliersSuggestions={suggestions?.suppliers}
                    onChange={(patch) => updateSupplierRow(idx, patch)}
                    onSetPrimary={() => setPrimarySupplier(idx)}
                    onRemove={() => removeSupplierRow(idx)}
                    onSave={() => saveSupplierRow(idx)}
                    canSave={!!entry?.id}
                  />
                ))}

                <button
                  type="button"
                  onClick={addSupplierRow}
                  className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 hover:border-brand-400 hover:text-brand-700 transition-all"
                >
                  <Plus className="h-4 w-4" />
                  Thêm NCC
                </button>
              </div>
            </SectionCard>
          )}
            </div>
            {/* ───────────────── /RIGHT COLUMN ───────────────── */}
          </div>
        </div>

        {/* ─────────── Sticky Footer ─────────── */}
        <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white px-7 py-4 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
          {/* A2. ORDER ACTIONS ROW (edit mode only) */}
          {isEditing && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 mr-1">
                Đơn hàng:
              </span>
              <button
                type="button"
                onClick={openQuotePdf}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                title={linkedOrder ? 'Mở PDF báo giá' : 'Cần tạo đơn trước'}
              >
                <FileText className="h-4 w-4" />
                Xuất PDF báo giá
              </button>
              <button
                type="button"
                onClick={() => createOrderMut.mutate()}
                disabled={createOrderMut.isPending || !!linkedOrder}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={linkedOrder ? 'Đã có đơn ' + linkedOrder.order_number : 'Tạo đơn 1-item & set Khách chốt'}
              >
                {createOrderMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                Khách đã đặt
              </button>
              <button
                type="button"
                onClick={() => proposePaymentMut.mutate()}
                disabled={
                  proposePaymentMut.isPending ||
                  !linkedOrder ||
                  linkedOrder.status !== 'confirmed'
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  !linkedOrder
                    ? 'Cần tạo đơn trước'
                    : linkedOrder.status !== 'confirmed'
                      ? 'Chỉ khi đơn đang ở trạng thái Khách chốt'
                      : 'Đề xuất kế toán duyệt thanh toán'
                }
              >
                {proposePaymentMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Đề xuất TT kế toán
              </button>
              {linkedOrder && (
                <span className="ml-1 text-xs text-slate-500">
                  · Đơn{' '}
                  <span className="font-mono font-bold text-slate-700">
                    {linkedOrder.order_number}
                  </span>
                </span>
              )}
            </div>
          )}

          {/* 7. KEYBOARD SHORTCUT HINT */}
          <div className="mb-3 text-xs text-slate-500 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <kbd className="bg-slate-100 ring-1 ring-slate-200 px-1.5 py-0.5 rounded">Tab</kbd>
              navigate
            </span>
            <span className="text-slate-300">|</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="bg-slate-100 ring-1 ring-slate-200 px-1.5 py-0.5 rounded">⌘S</kbd>
              Lưu
            </span>
            {isCreating && (
              <>
                <span className="text-slate-300">|</span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="bg-slate-100 ring-1 ring-slate-200 px-1.5 py-0.5 rounded">⌘Enter</kbd>
                  Lưu &amp; mới
                </span>
              </>
            )}
            <span className="text-slate-300">|</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="bg-slate-100 ring-1 ring-slate-200 px-1.5 py-0.5 rounded">Esc</kbd>
              Đóng
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-sm min-w-0">
              {validation.errors.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-rose-700 font-bold">
                  <AlertCircle className="h-4 w-4" />
                  Còn {validation.errors.length} trường bắt buộc: {validation.errors.map((e) => e.label).join(', ')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 font-bold">
                  <CheckCircle2 className="h-4 w-4" />
                  Sẵn sàng lưu
                </span>
              )}
              {isEditing && onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-rose-600 hover:bg-rose-50 ring-1 ring-rose-200 text-xs font-bold transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Xoá entry
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* 11. RESET BUTTON (create mode only) */}
              {isCreating && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 ring-1 ring-slate-200 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors inline-flex items-center gap-2"
              >
                Huỷ
              </button>
              {/* 3. SAVE & ADD ANOTHER (create mode only) */}
              {isCreating && (
                <button
                  type="button"
                  onClick={() => saveMutation.mutate({ thenReset: true })}
                  disabled={saveMutation.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <PlusCircle className="h-4 w-4" />
                  Lưu &amp; thêm mới
                  <kbd className="text-[11px] bg-white/20 px-1.5 py-0.5 rounded ml-1">⌘↵</kbd>
                </button>
              )}
              <button
                type="button"
                onClick={() => saveMutation.mutate(undefined)}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-brand-700 text-white text-sm font-bold hover:bg-brand-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {isEditing ? 'Lưu thay đổi' : 'Tạo entry'}
                <kbd className="text-[11px] bg-white/20 px-1.5 py-0.5 rounded ml-1">⌘S</kbd>
              </button>
            </div>
          </div>
        </div>

        {/* 1. AUTOCOMPLETE DATALISTS */}
        <SuggestionDatalists suggestions={suggestions} />

        {/* PRICING-RULE EDIT MODAL */}
        {pricingRuleEditOpen && (
          <PricingRuleEditModal
            initialItemType={pricingRulePrefillType || ''}
            rules={pricingRules}
            onClose={() => {
              setPricingRuleEditOpen(false);
              setPricingRulePrefillType(null);
            }}
            onSaved={() => {
              pricingRulesQ.refetch();
              setPricingRuleEditOpen(false);
              setPricingRulePrefillType(null);
              toast.success('Đã lưu quy tắc giá');
            }}
          />
        )}
      </motion.aside>
    </div>
  );
}

/* ─────────── Sub-components ─────────── */

function SuggestionDatalists({ suggestions }: { suggestions: SuggestionsResponse | undefined }) {
  const lists: { id: string; items: SuggestionItem[] | undefined }[] = [
    { id: 'sugg-customers', items: suggestions?.customers },
    { id: 'sugg-suppliers', items: suggestions?.suppliers },
    { id: 'sugg-makers', items: suggestions?.makers },
    { id: 'sugg-persons', items: suggestions?.persons },
    { id: 'sugg-brands', items: suggestions?.brands },
    { id: 'sugg-hs-codes', items: suggestions?.hs_codes },
  ];
  return (
    <>
      {lists.map((l) => (
        <datalist key={l.id} id={l.id}>
          {(l.items || []).map((item, i) => (
            <option key={l.id + '-' + String(i)} value={item.value} />
          ))}
        </datalist>
      ))}
    </>
  );
}

function SectionCard({
  id,
  icon,
  title,
  subtitle,
  children,
  dense,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** dense=true tightens header + body padding for the tabbed layout where
   *  the drawer body must fit a single viewport (≈900px usable). */
  dense?: boolean;
}) {
  return (
    <section
      id={id ? 'sec-' + id : undefined}
      className="rounded-xl border border-slate-200 bg-white shadow-sm scroll-mt-[180px]"
    >
      <header className={cn(
        'flex items-center gap-3 border-b border-slate-100',
        dense ? 'px-4 pt-2.5 pb-2' : 'px-5 pt-5 pb-4',
      )}>
        <div className={cn(
          'rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 shrink-0',
          dense ? 'h-7 w-7' : 'h-10 w-10',
        )}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={cn('font-bold tracking-tight text-slate-900 truncate', dense ? 'text-sm' : 'text-base')}>{title}</h3>
          {subtitle && <p className={cn('text-slate-500 truncate', dense ? 'text-xs' : 'text-sm')}>{subtitle}</p>}
        </div>
      </header>
      <div className={dense ? 'px-4 py-2.5' : 'px-5 py-5'}>{children}</div>
    </section>
  );
}

function FieldGrid({ cols = 2, children }: { cols?: number; children: ReactNode }) {
  const colClass = cols === 3 ? 'sm:grid-cols-3' : cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2';
  return <div className={cn('grid grid-cols-1 gap-3', colClass)}>{children}</div>;
}

function Field({
  label,
  required,
  hint,
  emphasize,
  readOnly,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  emphasize?: boolean;
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', emphasize && 'p-3 -m-3 rounded-lg ring-1 ring-emerald-200 bg-emerald-50/40')}>
      <label className="text-xs font-bold text-slate-600 tracking-wider uppercase flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500">*</span>}
        {readOnly && <span className="text-slate-400 normal-case tracking-normal font-medium text-[11px]">(auto)</span>}
      </label>
      {/* 9. REQUIRED FIELD VISUAL: subtle left accent */}
      <div className={cn(required && 'border-l-2 border-rose-300 pl-3')}>
        {children}
      </div>
      {hint && <span className="text-xs text-slate-500 leading-tight">{hint}</span>}
    </div>
  );
}

function Input({
  value,
  onChange,
  type = 'text',
  placeholder,
  icon,
  suffix,
  mono,
  disabled,
  step,
  list,
}: {
  value: string | number | null | undefined;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  icon?: ReactNode;
  suffix?: string;
  mono?: boolean;
  disabled?: boolean;
  step?: string;
  list?: string;
}) {
  return (
    <div className={cn('relative flex items-center', disabled && 'opacity-60')}>
      {icon && <span className="absolute left-3 text-slate-400 pointer-events-none">{icon}</span>}
      <input
        type={type}
        step={step}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        list={list}
        inputMode={type === 'number' ? 'decimal' : undefined}
        className={cn(
          'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all',
          icon && 'pl-9',
          suffix && 'pr-10',
          mono && 'font-mono tabular-nums',
          disabled && 'bg-slate-50 cursor-not-allowed',
        )}
      />
      {suffix && (
        <span className="absolute right-3 text-slate-400 text-sm font-bold pointer-events-none tabular-nums">
          {suffix}
        </span>
      )}
    </div>
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      rows={rows}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all resize-y min-h-[60px]"
    />
  );
}

function FunnelStageVisualization({ stage }: { stage: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3].map((s, idx) => {
        const active = s <= stage;
        const color = active ? STAGE_COLOR[s] : 'bg-slate-50 text-slate-400 ring-1 ring-slate-200';
        return (
          <div key={s} className="flex items-center gap-1.5 flex-1">
            <div
              className={cn(
                'h-11 flex-1 rounded-lg flex flex-col items-center justify-center text-sm font-bold transition-all',
                color,
              )}
            >
              <span>S{s}</span>
              <span className="text-[11px] font-medium opacity-90">{STAGE_LABEL[s]}</span>
            </div>
            {idx < 2 && (
              <ChevronRight className={cn('h-3.5 w-3.5', s < stage ? 'text-slate-700' : 'text-slate-300')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────── Image Uploader ─────────── */

// 1a — Paste ảnh 422 (frontend). Allowed MIME types + 10MB cap, mirrored on the
// backend. The root cause of the 422 was a clipboard blob with an EMPTY
// filename → multipart could not bind the `file` field. We rebuild a proper
// File with a name + MIME before upload, validate client-side, and downscale
// oversized images via canvas to keep payloads small.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_DIM = 2000; // px — downscale beyond this before upload

/**
 * Rebuild a clipboard/drop blob into a proper File. When the blob has an empty
 * `name` (the common clipboard case that triggered the multipart 422), synthesize
 * `clipboard-<ts>.<ext>` and carry the MIME (defaulting to image/png).
 */
function clipboardImageToFile(blob: File | Blob): File {
  const type =
    (blob as File).type || (blob instanceof File ? blob.type : '') || 'image/png';
  const existingName = blob instanceof File ? blob.name : '';
  if (existingName && existingName.trim() !== '') {
    return blob instanceof File ? blob : new File([blob], existingName, { type });
  }
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  const ext = extMap[type] || 'png';
  return new File([blob], `clipboard-${Date.now()}.${ext}`, { type: type || 'image/png' });
}

/** Client-side validation. Returns a Vietnamese error string, or null if OK. */
function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'Định dạng ảnh không hợp lệ — chỉ chấp nhận JPG, PNG, WebP, GIF';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'Ảnh quá lớn (tối đa 10MB)';
  }
  return null;
}

/**
 * Downscale an image File via canvas if either dimension exceeds MAX_IMAGE_DIM.
 * Returns the original File when no resize is needed or anything fails (best-effort).
 * GIFs are passed through untouched (canvas would flatten animation).
 */
async function maybeDownscaleImage(file: File): Promise<File> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return file;
  if (file.type === 'image/gif') return file;
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error('read-fail'));
      r.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('img-fail'));
      im.src = dataUrl;
    });
    const { width, height } = img;
    if (width <= MAX_IMAGE_DIM && height <= MAX_IMAGE_DIM) return file;
    const scale = MAX_IMAGE_DIM / Math.max(width, height);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    // Keep PNG transparency; everything else → JPEG for a smaller payload.
    const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), outType, 0.9),
    );
    if (!blob) return file;
    const ext = outType === 'image/png' ? 'png' : 'jpg';
    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.${ext}`, { type: outType });
  } catch {
    return file; // best-effort — fall back to the original on any failure
  }
}

function ImageUploader({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [tempUrl, setTempUrl] = useState('');
  // A4: the rendered <img> 401s on JWT-protected /sourcing/image/ URLs without
  // a token. When the image still fails to load, show a visible broken-image
  // placeholder instead of silently hiding it (display:none). Reset on value.
  const [imgError, setImgError] = useState(false);
  useEffect(() => {
    setImgError(false);
  }, [value]);
  // Authenticated preview URL: append the JWT for protected sourcing images.
  // Guard an empty token (no access_token in localStorage) → fall back to the
  // bare URL rather than appending `token=`.
  const previewSrc = (() => {
    if (!value) return value;
    if (!value.startsWith('/api/v1/sourcing/image/')) return value;
    const tokened = withToken(value);
    if (typeof window !== 'undefined') {
      const hasToken = (localStorage.getItem('access_token') ?? '') !== '';
      if (!hasToken) return value;
    }
    return tokened;
  })();

  // 1a — Normalize → validate → (optional) downscale → upload. Maps any failure
  // to a clear Vietnamese toast + inline error instead of a raw 422.
  const uploadFile = async (raw: File | Blob) => {
    setError(null);
    // Rebuild a proper File (fixes clipboard empty-filename → 422).
    const file = clipboardImageToFile(raw);
    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      toast.error(invalid);
      return;
    }
    setUploading(true);
    try {
      const toSend = await maybeDownscaleImage(file);
      const fd = new FormData();
      fd.append('file', toSend, toSend.name);
      // MUST use api.upload (multipart) — api.post JSON.stringifies the body,
      // which turns FormData into "{}" → backend gets no file → 422. (2026-06-17)
      const res = (await api.upload('/api/v1/sourcing/upload-image', fd)) as { data: { image_url: string } };
      onChange(res.data.image_url);
      toast.success('Đã tải ảnh lên');
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status_code;
      // 400/422 from the backend almost always means a malformed image part.
      const friendly =
        status === 400 || status === 422
          ? 'Ảnh không hợp lệ hoặc lỗi định dạng'
          : err?.response?.data?.detail || err?.detail || err?.message || 'Upload thất bại';
      setError(friendly);
      toast.error(friendly);
    } finally {
      setUploading(false);
    }
  };

  // Paste-to-upload (Thang 2026-06-15): copy/crop an image then Ctrl+V drops it
  // straight in — no save-to-disk then re-upload. Only fires when the clipboard
  // actually holds an image file, so pasting text into other fields is unaffected.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (uploading) return;
      const dt = e.clipboardData;
      if (!dt) return;
      let picked: File | null = null;
      // 1) Some sources put the pasted image directly in `files`.
      if (dt.files && dt.files.length) {
        for (let i = 0; i < dt.files.length; i++) {
          const f = dt.files[i];
          if (f && f.type.startsWith('image/')) { picked = f; break; }
        }
      }
      // 2) Otherwise scan `items` (Snipping Tool / crop / copy-image). Some
      // clipboard items report an empty type → still try getAsFile().
      if (!picked && dt.items) {
        for (let i = 0; i < dt.items.length; i++) {
          const it = dt.items[i];
          if (it.kind === 'file' && (it.type.startsWith('image/') || it.type === '')) {
            const f = it.getAsFile();
            if (f) { picked = f; break; }
          }
        }
      }
      if (picked) {
        e.preventDefault();
        uploadFile(picked); // clipboardImageToFile fixes empty name/type → no 422
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [uploading]);

  if (!value) {
    return (
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) uploadFile(f);
          }}
          disabled={uploading}
          className={cn(
            'flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-all',
            dragOver
              ? 'border-brand-500 bg-brand-50'
              : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100',
          )}
        >
          {uploading ? (
            <Loader2 className="h-10 w-10 text-brand-600 animate-spin" />
          ) : (
            <>
              <div className="h-12 w-12 rounded-lg bg-white shadow-sm ring-1 ring-slate-200 flex items-center justify-center">
                <Upload className="h-5 w-5 text-slate-500" />
              </div>
              <div className="text-sm font-bold text-slate-700">Click, kéo thả hoặc dán ảnh</div>
              <div className="text-xs text-slate-500">PNG, JPG, WebP · Max 10MB</div>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => setShowUrlInput((s) => !s)}
          className="text-sm text-slate-600 font-semibold inline-flex items-center gap-1 hover:text-slate-900"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showUrlInput && 'rotate-90')} />
          Hoặc paste URL
        </button>
        {showUrlInput && (
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={tempUrl}
              onChange={(e) => setTempUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:border-brand-400"
            />
            <button
              type="button"
              onClick={() => {
                if (tempUrl.trim()) {
                  onChange(tempUrl.trim());
                  setTempUrl('');
                  setShowUrlInput(false);
                }
              }}
              className="px-3 h-10 rounded-lg bg-brand-600 text-white text-sm font-bold hover:bg-brand-700"
            >
              OK
            </button>
          </div>
        )}
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="relative group aspect-square rounded-xl overflow-hidden ring-1 ring-slate-200 bg-slate-50">
        {imgError ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
            <ImageOff className="h-10 w-10" />
            <span className="text-xs font-semibold">Không tải được ảnh</span>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewSrc ?? undefined}
            alt="preview"
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        )}
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute top-2 right-2 h-9 w-9 rounded-lg bg-white/95 text-rose-600 ring-1 ring-rose-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-50 shadow-md"
          title="Xoá ảnh"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <input
        type="url"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder="URL ảnh..."
        className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono focus:outline-none focus:border-brand-400 text-slate-600"
      />
    </div>
  );
}

const _suppressUnusedLayers = [Layers, BadgeCheck, PackageCheck, Truck, FileEdit, Wallet];
void _suppressUnusedLayers;

/* ─────────── Currency dropdown w/ ≈ VND preview ─────────── */

function CurrencyDropdown({
  currency,
  cost,
  rates,
  onCurrencyChange,
  onCostChange,
}: {
  currency: CurrencyCode;
  cost: number | null;
  rates: Partial<Record<CurrencyCode, number>>;
  onCurrencyChange: (c: CurrencyCode) => void;
  onCostChange: (v: number | null) => void;
}) {
  const rate = rates[currency] ?? (currency === 'VND' ? 1 : 0);
  const approxVnd = cost && rate > 0 ? Math.round(cost * rate) : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-stretch gap-2">
        <select
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value as CurrencyCode)}
          className="h-11 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        >
          {CURRENCY_OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.symbol} {opt.code}
            </option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          value={cost ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '' || v === '-') {
              onCostChange(null);
              return;
            }
            const n = Number(v);
            onCostChange(Number.isFinite(n) ? n : null);
          }}
          placeholder="0"
          className="h-11 flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-[15px] font-mono tabular-nums text-slate-900 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
      </div>
      {approxVnd != null && currency !== 'VND' && (
        <span className="text-[11px] text-slate-500 tabular-nums">
          ≈ {String(approxVnd.toLocaleString('vi-VN'))} ₫ (rate {rate.toLocaleString('vi-VN')})
        </span>
      )}
    </div>
  );
}

/* ─────────── Supplier row card ─────────── */

function SupplierRowCard({
  row,
  index,
  exchangeRates,
  suppliersSuggestions: _suppliersSuggestions,
  onChange,
  onSetPrimary,
  onRemove,
  onSave,
  canSave,
}: {
  row: SupplierRow;
  index: number;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  suppliersSuggestions: SuggestionItem[] | undefined;
  onChange: (patch: Partial<SupplierRow>) => void;
  onSetPrimary: () => void;
  onRemove: () => void;
  onSave: () => void;
  canSave: boolean;
}) {
  void _suppliersSuggestions;
  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-4 transition-all',
        row.is_primary ? 'border-brand-300 ring-1 ring-brand-100 shadow-sm' : 'border-slate-200',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            NCC #{index + 1}
          </span>
          {row.is_primary && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 text-white px-2 py-0.5 text-[11px] font-bold">
              <Star className="h-3 w-3 fill-white" />
              NCC chính
            </span>
          )}
          {row._dirty && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-2 py-0.5 text-[11px] font-semibold">
              Chưa lưu
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!row.is_primary && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600 hover:text-brand-700 px-2 py-1 rounded-md hover:bg-brand-50">
              <input
                type="radio"
                name={'primary-supplier-' + (row.sourcing_entry_id || 'new')}
                checked={row.is_primary}
                onChange={onSetPrimary}
                className="accent-brand-600"
              />
              Là NCC chính
            </label>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            title={canSave ? 'Lưu NCC' : 'Lưu entry trước'}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold text-brand-700 hover:bg-brand-50 ring-1 ring-brand-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="h-3.5 w-3.5" />
            Lưu
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold text-rose-600 hover:bg-rose-50 ring-1 ring-rose-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Xoá
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Tên NCC">
          <Input
            value={row.supplier_name}
            onChange={(v) => onChange({ supplier_name: v })}
            placeholder="Misumi VN"
            list="sugg-suppliers"
          />
        </Field>
        <Field label="Số điện thoại">
          <Input
            value={row.phone}
            onChange={(v) => onChange({ phone: v })}
            placeholder="0909999999"
            icon={<Phone className="h-4 w-4" />}
            mono
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={row.email}
            onChange={(v) => onChange({ email: v })}
            placeholder="sales@supplier.com"
            icon={<Mail className="h-4 w-4" />}
          />
        </Field>
        <Field label="Currency & Cost" hint="Chọn loại tiền + giá nhập">
          <CurrencyDropdown
            currency={row.currency}
            cost={row.cost_amount}
            rates={exchangeRates}
            onCurrencyChange={(c) => onChange({ currency: c })}
            onCostChange={(v) => onChange({ cost_amount: v })}
          />
        </Field>
        <Field label="Lead time (ngày)">
          <Input
            type="number"
            value={row.lead_time_days}
            onChange={(v) => {
              if (v === '') return onChange({ lead_time_days: null });
              const n = Number(v);
              onChange({ lead_time_days: Number.isFinite(n) ? n : null });
            }}
            placeholder="7"
            mono
          />
        </Field>
        <Field label="MOQ">
          <Input
            type="number"
            value={row.moq}
            onChange={(v) => {
              if (v === '') return onChange({ moq: null });
              const n = Number(v);
              onChange({ moq: Number.isFinite(n) ? n : null });
            }}
            placeholder="1"
            mono
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Ghi chú NCC">
            <Textarea
              value={row.notes}
              onChange={(v) => onChange({ notes: v })}
              placeholder="Điều kiện thanh toán, ship time chi tiết..."
              rows={2}
            />
          </Field>
        </div>
      </div>

    </div>
  );
}

/* ─────────── B7. Tính giá — Full breakdown panel (cells I..T) ─────────── */

interface BreakdownData {
  rule_applied?: string | null;
  fx_rate?: number | null;
  // 1b.2 — effective date (ISO) of the FX rate used: the exchange_rates.rate_date
  // (or the entry's frozen fx_rate_date). Shown next to the FX rate for audit.
  fx_rate_date?: string | null;
  I?: number; K?: number; L?: number; M?: number; N?: number;
  O?: number; P?: number; Q?: number; R?: number; S?: number; T?: number;
  total?: number | null;
  rule_used?: {
    item_type?: string | null;
    description_vi?: string | null;
    fallback_to_default?: boolean;
  } | null;
  params?: {
    import_tax_pct?: number;
    vat_pct?: number;
    purchase_cost_pct?: number;
    transfer_fee_pct?: number;
    swift_fee_usd?: number;
    profit_pct_used?: number;
    profit_pct_import?: number;
    profit_pct_domestic?: number;
    usd_to_vnd_used_for_swift?: number;
  } | null;
}

type PctKey = 'importTax' | 'vat' | 'purchase' | 'profit';

function TinhGiaBreakdownPanel({
  breakdown,
  pct,
  pctOverrides,
  onChangePct,
  isDomesticVn,
  onToggleDomestic,
  vnShippingFeeVnd,
  onChangeVnShipping,
  vnShippingHistory,
  onPickVnShipping,
  fedexFeeVnd,
  onChangeFedex,
  otherFeeOverride,
  onChangeOtherFee,
  qty,
  onOpenRuleEdit,
  hasPrimarySupplier,
  isLoading,
  isError,
  errorReason,
  onRetry,
  primaryCurrency,
  onCreateRuleForType,
  onGoToSupplier,
  primarySupplierName,
  fxIsManual,
}: {
  breakdown: BreakdownData | null | undefined;
  pct: { importTax: number; vat: number; purchase: number; profit: number; transfer: number; swiftUsd: number };
  pctOverrides: { importTax: number | null; vat: number | null; purchase: number | null; profit: number | null };
  onChangePct: (key: PctKey, value: number | null) => void;
  isDomesticVn: boolean;
  onToggleDomestic: (v: boolean) => void;
  vnShippingFeeVnd: number | null;
  onChangeVnShipping: (v: number | null) => void;
  vnShippingHistory?: { value_vnd: number; at: string | null; by: string | null }[] | null;
  onPickVnShipping?: (v: number) => void;
  fedexFeeVnd: number | null;
  onChangeFedex: (v: number | null) => void;
  otherFeeOverride: number | null;
  onChangeOtherFee: (v: number | null) => void;
  qty: number;
  onOpenRuleEdit: () => void;
  hasPrimarySupplier: boolean;
  isLoading?: boolean;
  isError?: boolean;
  errorReason?: string | null;
  onRetry?: () => void;
  primaryCurrency?: CurrencyCode | null;
  onCreateRuleForType?: (itemType: string) => void;
  onGoToSupplier?: () => void;
  primarySupplierName?: string | null;
  fxIsManual?: boolean;
}) {
  if (!hasPrimarySupplier) {
    return (
      <div className="mb-4 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 p-6 text-center">
        <div className="mx-auto h-14 w-14 rounded-xl bg-brand-100 ring-1 ring-brand-200 flex items-center justify-center mb-3">
          <Factory className="h-7 w-7 text-brand-700" strokeWidth={2.2} />
        </div>
        <div className="text-[15px] font-bold text-slate-900 mb-1">
          Chưa có giá nhập từ Nhà cung cấp
        </div>
        <div className="text-sm text-slate-600 max-w-md mx-auto mb-4">
          Thêm NCC và nhập <b>Cost Amount</b> (ngoại tệ + VND) để hiển thị bảng phân tích đầy đủ 11 ô (I → T) và tính giá báo tự động.
        </div>
        {onGoToSupplier && (
          <button
            type="button"
            onClick={onGoToSupplier}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-5 py-2.5 text-sm font-bold hover:bg-brand-700 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <Factory className="h-4 w-4" />
            Đi tới tab Nhà cung cấp
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  // Loading skeleton — 11 shimmer cells matching the breakdown grid (I..T + total).
  if (isLoading && !breakdown) {
    return (
      <div className="mb-4 rounded-xl border border-brand-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Loader2 className="h-4 w-4 text-brand-700 animate-spin" />
          <span className="text-xs font-bold tracking-wider uppercase text-brand-700">
            Đang tính giá…
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {Array.from({ length: 11 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 animate-pulse"
              aria-hidden
            >
              <div className="flex items-center justify-between mb-1">
                <div className="h-5 w-5 rounded bg-slate-200" />
                <div className="h-3 w-3 rounded-full bg-slate-200" />
              </div>
              <div className="h-2.5 w-3/4 rounded bg-slate-200 mt-1" />
              <div className="h-4 w-2/3 rounded bg-slate-300 mt-1.5" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state — inline panel with Retry button (toast also fires once).
  if (isError && !breakdown) {
    return (
      <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50/70 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-rose-900">
              Không tính được giá
            </div>
            <div className="mt-1 text-xs text-rose-800 break-words">
              {errorReason || 'Lỗi không xác định khi gọi /calc-suggest'}
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 text-white px-3 py-2 text-xs font-bold hover:bg-rose-700 shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Thử lại
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!breakdown) return null;

  const ruleUsed = breakdown.rule_used;
  const isFallback = !!ruleUsed?.fallback_to_default;
  const params = breakdown.params || null;
  const swiftUsd = params?.usd_to_vnd_used_for_swift;
  const showSwiftHint = swiftUsd != null && Number(swiftUsd) > 0;
  const fxCurrencyLabel = primaryCurrency || 'VND';
  const fxRateLabel = breakdown.fx_rate != null
    ? Number(breakdown.fx_rate).toLocaleString('vi-VN') + ' ₫'
    : '—';
  // 1b.2 — compact effective-date suffix: "· ngày dd/mm" from the rate's date
  // (frozen snapshot date when editing, else the live rate_date from the server).
  const fxDateSuffix = (() => {
    const d = breakdown.fx_rate_date;
    if (!d) return '';
    const ts = Date.parse(d);
    if (Number.isNaN(ts)) return '';
    const dt = new Date(ts);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return ` · ngày ${dd}/${mm}`;
  })();
  const fallbackItemType = ruleUsed?.item_type || 'default';

  return (
    <div className="mb-4 rounded-xl border border-brand-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Calculator className="h-4 w-4 text-brand-700" />
          <span className="text-xs font-bold tracking-wider uppercase text-brand-700">
            Tính giá — Phân tích đầy đủ
          </span>
          {breakdown.rule_applied && !isFallback && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-200 px-2 py-0.5 text-[11px] font-bold">
              Quy tắc: {breakdown.rule_applied}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={isDomesticVn}
              onChange={(e) => onToggleDomestic(e.target.checked)}
              className="accent-brand-600 h-4 w-4"
            />
            Hàng nội địa VN
            <span className="text-slate-400 font-normal">(N=0, R=20%)</span>
          </label>
          <button
            type="button"
            onClick={onOpenRuleEdit}
            className="text-xs font-semibold text-brand-700 hover:text-brand-900 underline-offset-2 hover:underline inline-flex items-center gap-1"
          >
            <Settings className="h-3 w-3" />
            Tùy chỉnh quy tắc
          </button>
        </div>
      </div>

      {/* Batch #2 (V2): SOURCE-OF-PRICE banner — answers Thang's "không biết hệ
          thống đang lấy giá nào": which NCC supplies the cost, which FX rate is
          applied + its source (tay / tự động), and which pricing rule. */}
      <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 flex items-center gap-x-2 gap-y-1 flex-wrap text-[12px] text-sky-900">
        <Wallet className="h-3.5 w-3.5 text-sky-600 shrink-0" aria-hidden="true" />
        <span className="font-semibold">Đang lấy giá từ:</span>
        <span>
          NCC <b className="font-bold">{primarySupplierName || '—'}</b>
        </span>
        <span className="text-sky-300">·</span>
        <span>
          tỷ giá <b className="font-mono font-bold">{fxRateLabel}</b>
          <span className="text-sky-600">
            {' '}({fxCurrencyLabel}→VND, {fxIsManual ? 'nhập tay' : `tự động${fxDateSuffix}`})
          </span>
        </span>
        <span className="text-sky-300">·</span>
        <span>quy tắc <b className="font-mono">mặc định</b></span>
      </div>

      {/* Fallback chip — engine could not find a rule for the selected
          item_type, so it used `default`. Surface this so the user knows
          the markup/profit pcts are generic and offers a one-click jump to
          the rule editor pre-filled with the missing item_type. */}
      {isFallback && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2.5 flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-amber-900">
                Đang dùng quy tắc mặc định
              </div>
              <div className="text-[11px] text-amber-800 mt-0.5">
                <span className="font-mono font-semibold">{fallbackItemType}</span>{' '}
                chưa được map vào pricing rule — markup / profit % đang lấy từ rule{' '}
                <span className="font-mono">default</span>.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              onCreateRuleForType
                ? onCreateRuleForType(fallbackItemType)
                : onOpenRuleEdit()
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 text-white px-2.5 py-1.5 text-[11px] font-bold hover:bg-amber-700 shrink-0"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Tạo quy tắc cho {fallbackItemType}
          </button>
        </div>
      )}

      {/* Vertical "price statement" — grouped rows, label left, value right.
          Compact & readable; replaces the old cramped 11-cell I..T grid. */}
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        {/* Group 1 — Chi phí nhập */}
        <BreakdownGroupHeader title="Chi phí nhập" />
        <BreakdownRow
          code="I"
          label="Đơn giá nhập"
          value={breakdown.I}
          hint={breakdown.fx_rate != null ? `FX ${fxCurrencyLabel}→VND: ${fxRateLabel}${fxDateSuffix}` : undefined}
        />
        <BreakdownRow code="K" label="Thành tiền (× SL)" value={breakdown.K} />
        <BreakdownRow
          code="L"
          label="Vận chuyển VN"
          editValue={vnShippingFeeVnd}
          onEditChange={onChangeVnShipping}
          extra={
            <VnShippingHistoryButton
              history={vnShippingHistory}
              onPick={onPickVnShipping}
            />
          }
        />
        <BreakdownRow
          code="M"
          label="Vận chuyển Fedex"
          editValue={fedexFeeVnd}
          onEditChange={onChangeFedex}
        />

        {/* Group 2 — Thuế & phí (% inline editable) */}
        <BreakdownGroupHeader title="Thuế & phí" />
        <BreakdownRow
          code="N"
          label="Thuế NK"
          value={breakdown.N}
          pct={pct.importTax}
          pctOverridden={pctOverrides.importTax != null}
          onPctChange={(v) => onChangePct('importTax', v)}
          pctDisabled={isDomesticVn}
          pctDisabledHint={isDomesticVn ? 'Hàng nội địa VN: thuế NK = 0' : undefined}
        />
        <BreakdownRow
          code="O"
          label="VAT"
          value={breakdown.O}
          pct={pct.vat}
          pctOverridden={pctOverrides.vat != null}
          onPctChange={(v) => onChangePct('vat', v)}
        />
        <BreakdownRow
          code="P"
          label="Chi phí mua hộ"
          value={breakdown.P}
          pct={pct.purchase}
          pctOverridden={pctOverrides.purchase != null}
          onPctChange={(v) => onChangePct('purchase', v)}
        />
        <BreakdownRow
          code="Q"
          label="Chi phí khác"
          editValue={otherFeeOverride != null ? otherFeeOverride : (breakdown.Q ?? null)}
          onEditChange={onChangeOtherFee}
          editOverridden={otherFeeOverride != null}
          hint={showSwiftHint ? `gồm SWIFT ${Number(swiftUsd).toLocaleString('vi-VN')} ₫/USD` : undefined}
        />

        {/* Group 3 — Lợi nhuận */}
        <BreakdownGroupHeader title="Lợi nhuận" />
        <BreakdownRow
          code="R"
          label={isDomesticVn ? 'Lợi nhuận (VN)' : 'Lợi nhuận'}
          value={breakdown.R}
          pct={pct.profit}
          pctOverridden={pctOverrides.profit != null}
          onPctChange={(v) => onChangePct('profit', v)}
          tone="brand"
        />

        {/* Tổng + Giá make + Giá báo.
            Giá thống nhất 1 lần (Thang 2026-07-02): Giá báo T = round(S/1000)*1000
            (làm tròn DUY NHẤT), Tổng = T × SL. Giá make (S) = tham chiếu đơn giá
            CHƯA làm tròn. Đã bỏ toggle Tự động/Sửa tay + nút Áp dụng giá báo. */}
        <div className="border-t border-slate-200 bg-slate-50/60 px-3 py-2 flex items-center justify-between text-[12px]">
          <span className="font-semibold text-slate-500">Tổng (× SL)</span>
          <span className="font-bold tabular-nums text-slate-700">
            {fmtVnd((breakdown.T ?? 0) * (qty ?? 1))}
          </span>
        </div>
        <div className="border-t border-emerald-200 bg-emerald-50/40 px-3 py-2.5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-emerald-800">
            Giá make /đơn vị (S)
            <span className="ml-1.5 text-[11px] font-medium text-slate-400">đơn giá chưa làm tròn</span>
          </span>
          <span className="text-[15px] font-extrabold tabular-nums text-emerald-700">{fmtVnd(breakdown.S)}</span>
        </div>
        <div className="border-t border-emerald-300 bg-emerald-50 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-emerald-600 text-white font-mono text-[11px] font-bold shrink-0">T</span>
            <span className="text-[13px] font-bold text-emerald-900">Giá báo</span>
            <span className="text-[11px] font-medium text-slate-400">đã làm tròn</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-28 h-8 inline-flex items-center justify-end rounded-md border border-emerald-300 bg-white px-2 text-right text-[14px] font-extrabold tabular-nums text-emerald-900">
              {fmtVnd(breakdown.T)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Group header for the price statement ─── */
function BreakdownGroupHeader({ title }: { title: string }) {
  return (
    <div className="bg-slate-50 px-3 py-1.5 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
      {title}
    </div>
  );
}

/* ─── One row of the price statement.
   - read-only value: pass `value`
   - editable VND (L/M/Q/...): pass `editValue` + `onEditChange` (+ `editOverridden`)
   - inline % input (N/O/P/R): pass `pct` + `onPctChange` (+ `pctOverridden`) */
function BreakdownRow({
  code,
  label,
  value,
  hint,
  tone = 'slate',
  editValue,
  onEditChange,
  editOverridden,
  pct,
  pctOverridden,
  onPctChange,
  pctDisabled,
  pctDisabledHint,
  extra,
}: {
  code: string;
  label: string;
  value?: number | null;
  hint?: string;
  tone?: 'slate' | 'brand';
  editValue?: number | null;
  onEditChange?: (v: number | null) => void;
  editOverridden?: boolean;
  pct?: number;
  pctOverridden?: boolean;
  onPctChange?: (v: number | null) => void;
  pctDisabled?: boolean;
  pctDisabledHint?: string;
  // Optional trailing slot (e.g. a value-history popover button for row L).
  extra?: ReactNode;
}) {
  const isEdit = typeof onEditChange === 'function';
  const valueCls = tone === 'brand' ? 'text-brand-700' : 'text-slate-900';
  return (
    <div className="px-3 py-1.5 border-b border-slate-100 last:border-b-0 flex items-center gap-2 hover:bg-slate-50/60">
      <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-slate-100 text-slate-600 font-mono text-[11px] font-bold shrink-0">
        {code}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-slate-700 leading-tight truncate">{label}</div>
        {hint && <div className="text-[11px] text-slate-400 leading-tight truncate" title={hint}>{hint}</div>}
      </div>

      {/* Inline % editor */}
      {onPctChange && (
        <div className="flex items-center gap-1 shrink-0">
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              disabled={pctDisabled}
              title={pctDisabled ? pctDisabledHint : undefined}
              value={pctDisabled ? '0' : pct ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                onPctChange(v === '' ? null : Number(v));
              }}
              className={cn(
                'h-8 w-[68px] rounded-lg border bg-white pl-2 pr-5 text-right text-[12px] font-semibold tabular-nums focus:outline-none focus:ring-2',
                pctDisabled
                  ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                  : pctOverridden
                    ? 'border-brand-300 text-brand-800 focus:border-brand-500 focus:ring-brand-100'
                    : 'border-slate-200 text-slate-700 focus:border-brand-400 focus:ring-brand-100',
              )}
            />
            <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">%</span>
          </div>
          {pctOverridden && !pctDisabled ? (
            <button
              type="button"
              onClick={() => onPctChange(null)}
              title="Khôi phục % mặc định"
              className="inline-flex items-center justify-center h-5 w-5 rounded text-brand-500 hover:bg-brand-100 hover:text-brand-700 shrink-0"
            >
              <X className="h-3 w-3" />
            </button>
          ) : (
            <span className="inline-block h-5 w-5 shrink-0" aria-hidden />
          )}
        </div>
      )}

      {/* Editable VND value (L/M/Q) */}
      {isEdit ? (
        <div className="flex items-center gap-1.5 shrink-0">
          {editOverridden && (
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" title="đã chỉnh" aria-hidden />
          )}
          <div className="w-28">
            <NumberInput
              value={editValue ?? null}
              onChange={(n) => onEditChange?.(n)}
              placeholder="0"
              aria-label={label}
              className={cn(
                'h-8 px-2 text-right text-[13px] font-semibold',
                editOverridden ? 'border-brand-300 text-brand-800 focus:border-brand-500' : 'border-slate-200 text-slate-900 focus:border-brand-400',
              )}
            />
          </div>
        </div>
      ) : (
        <span className={cn('w-28 text-right text-[13px] font-bold tabular-nums shrink-0', valueCls)}>
          {fmtVnd(value)}
        </span>
      )}
      {extra}
    </div>
  );
}

/* ─── A1: VN-shipping value-history popover ───
 * A small clock button next to row "L" that lists prior VN-shipping values from
 * entry.vn_shipping_history. Clicking a row applies that value. Brand/slate only.
 */
function VnShippingHistoryButton({
  history,
  onPick,
}: {
  history?: { value_vnd: number; at: string | null; by: string | null }[] | null;
  onPick?: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasHistory = Array.isArray(history) && history.length > 0;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        title={hasHistory ? 'Lịch sử giá vận chuyển VN' : 'Chưa có lịch sử'}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 transition-colors',
          open
            ? 'bg-brand-50 text-brand-700 ring-brand-200'
            : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50 hover:text-slate-700',
        )}
      >
        <History className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
          <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Lịch sử vận chuyển VN
          </div>
          {hasHistory ? (
            <ul className="max-h-56 overflow-auto">
              {history!.map((h, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick?.(h.value_vnd);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
                  >
                    <span className="text-[13px] font-bold tabular-nums text-slate-900">
                      {fmtVnd(h.value_vnd)}
                    </span>
                    <span className="truncate text-[11px] text-slate-400">
                      {[h.by, fmtDateTime(h.at)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-2 py-2 text-[12px] text-slate-400">Chưa có lịch sử</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Pricing-rule audit history types ─── */

interface PricingRuleHistoryEntry {
  id: number;
  rule_item_type: string;
  changed_at: string | null;
  changed_by_id: number | null;
  changed_by_email: string | null;
  change_summary: string | null;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
}

// Field labels shown in the diff modal — keyed by DB column name.
const PRICING_RULE_FIELD_LABEL: Record<string, string> = {
  item_type: 'Mã loại hàng',
  markup_pct: 'Markup (hệ số)',
  tax_pct: 'Tax %',
  shipping_fee_vnd: 'Ship VND',
  description_vi: 'Tên hiển thị',
  import_tax_pct: 'Thuế NK %',
  vat_pct: 'VAT %',
  purchase_cost_pct: 'Chi phí mua %',
  transfer_fee_pct: 'Phí chuyển %',
  swift_fee_usd: 'Phí SWIFT USD',
  profit_pct_import: 'Lợi nhuận NK %',
  profit_pct_domestic: 'Lợi nhuận VN %',
};

function fmtHistoryValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (typeof v === 'number') return String(v);
  return String(v);
}

/* ─────────── Pricing-rule edit modal ─────────── */

function PricingRuleEditModal({
  initialItemType,
  rules,
  onClose,
  onSaved,
}: {
  initialItemType: string;
  rules: PricingRule[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = rules.find((r) => r.item_type === initialItemType);
  const [itemType, setItemType] = useState<string>(initialItemType || '');
  const [label, setLabel] = useState<string>(existing?.description_vi || '');
  const [taxPct, setTaxPct] = useState<number>(Number(existing?.tax_pct ?? 10));
  const [markup, setMarkup] = useState<number>(Number(existing?.markup_pct ?? 1.4));
  const [shipping, setShipping] = useState<number>(Number(existing?.shipping_fee_vnd ?? 0));
  const [saving, setSaving] = useState(false);
  // ICE a11y: ARIA + focus trap + Esc + restore focus.
  const ruleDialogRef = useRef<HTMLDivElement>(null);
  const ruleTitleId = useId();
  useModalA11y({ active: true, containerRef: ruleDialogRef, onClose });

  // Lịch sử thay đổi: chỉ fetch khi rule đã tồn tại — tạo mới chưa có history.
  const historyKey = (itemType || initialItemType || '').trim();
  const historyQ = useQuery<PricingRuleHistoryEntry[]>({
    queryKey: ['sourcing', 'pricing-rules', historyKey, 'history'],
    enabled: !!historyKey && !!existing,
    queryFn: async () => {
      const res = (await api.get(
        '/api/v1/sourcing/pricing-rules/' + encodeURIComponent(historyKey) + '/history',
      )) as { data: PricingRuleHistoryEntry[] };
      return res.data || [];
    },
  });
  const history = historyQ.data || [];
  const [diffEntry, setDiffEntry] = useState<PricingRuleHistoryEntry | null>(null);

  const save = async () => {
    if (!itemType.trim()) {
      toast.error('Cần nhập mã loại hàng');
      return;
    }
    setSaving(true);
    try {
      // Backend route is POST/PUT /sourcing/pricing-rules/{item_type} — the
      // identifier lives in the URL path. Body matches PricingRulePayload:
      // { markup_pct, tax_pct, shipping_fee_vnd, description_vi, ...expanded }.
      // Field names map 1:1 to the DB columns; NO {scope, scope_value} or
      // legacy {markup, shipping_vnd, label} aliases.
      const body = {
        markup_pct: markup,
        tax_pct: taxPct,
        shipping_fee_vnd: shipping,
        description_vi: label.trim() || null,
      };
      // Same PUT /{item_type} handles both create + update (ON CONFLICT
      // (item_type) DO UPDATE in SQL). Using existing.id here was wrong:
      // BE expects the string item_type, not the numeric PK, which caused
      // duplicate inserts on edit.
      const key = encodeURIComponent(itemType.trim());
      await api.put('/api/v1/sourcing/pricing-rules/' + key, body);
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Lưu quy tắc thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" role="presentation">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ruleDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ruleTitleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          // Enter (not in textarea) submits Save.
          const tag = (e.target as HTMLElement)?.tagName;
          if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
            e.preventDefault();
            if (!saving) save();
          }
          if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            if (!saving) save();
          }
        }}
        className="relative w-full max-w-2xl rounded-xl bg-white shadow-2xl focus:outline-none max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 id={ruleTitleId} className="text-base font-bold text-slate-900">
            {existing ? 'Sửa quy tắc giá' : 'Tạo quy tắc giá mới'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng quy tắc giá (Esc)"
            className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"
          >
            <X className="h-4 w-4 text-slate-600" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <Field label="Mã loại hàng" required>
            <Input
              value={itemType}
              onChange={setItemType}
              placeholder="electronics, mechanical, ..."
              mono
            />
          </Field>
          <Field label="Tên hiển thị">
            <Input value={label} onChange={setLabel} placeholder="Điện tử" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tax %">
              <Input
                type="number"
                step="0.1"
                value={taxPct}
                onChange={(v) => setTaxPct(Number(v) || 0)}
                suffix="%"
                mono
              />
            </Field>
            <Field label="Markup">
              <Input
                type="number"
                step="0.01"
                value={markup}
                onChange={(v) => setMarkup(Number(v) || 0)}
                mono
              />
            </Field>
            <Field label="Ship VND">
              <Input
                type="number"
                value={shipping}
                onChange={(v) => setShipping(Number(v) || 0)}
                suffix="₫"
                mono
              />
            </Field>
          </div>

          {/* Lịch sử thay đổi — chỉ hiện khi rule đã tồn tại */}
          {existing && (
            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <h4 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-800">
                  <Clock className="h-4 w-4 text-brand-700" />
                  Lịch sử thay đổi
                  {history.length > 0 && (
                    <span className="text-xs font-medium text-slate-500">({history.length})</span>
                  )}
                </h4>
                {historyQ.isFetching && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                )}
              </div>

              {historyQ.isLoading ? (
                <div className="text-xs text-slate-500 py-4 text-center">Đang tải lịch sử...</div>
              ) : history.length === 0 ? (
                <div className="text-xs text-slate-500 py-4 text-center italic">
                  Chưa có thay đổi nào được ghi nhận.
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Thời điểm</th>
                        <th className="px-3 py-2 text-left font-semibold">Người thay đổi</th>
                        <th className="px-3 py-2 text-left font-semibold">Tóm tắt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {history.map((h) => (
                        <tr
                          key={h.id}
                          onClick={() => setDiffEntry(h)}
                          className="hover:bg-brand-50 cursor-pointer transition-colors"
                          title="Bấm để xem chi tiết diff"
                        >
                          <td className="px-3 py-2 tabular-nums text-slate-700 whitespace-nowrap">
                            {h.changed_at
                              ? new Date(h.changed_at).toLocaleString('vi-VN', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-700 truncate max-w-[140px]">
                            {h.changed_by_email || '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600 truncate max-w-[260px]">
                            {h.change_summary || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-100"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold hover:bg-brand-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Lưu
          </button>
        </div>
      </div>

      {diffEntry && (
        <PricingRuleDiffModal entry={diffEntry} onClose={() => setDiffEntry(null)} />
      )}
    </div>
  );
}

/* ─────────── Pricing-rule diff modal (read-only) ─────────── */

function PricingRuleDiffModal({
  entry,
  onClose,
}: {
  entry: PricingRuleHistoryEntry;
  onClose: () => void;
}) {
  // Liệt kê tất cả field có trong old hoặc new — chỉ highlight các field
  // thay đổi (old !== new).
  const allKeys = useMemo(() => {
    const keys = new Set<string>([
      ...Object.keys(entry.old_values || {}),
      ...Object.keys(entry.new_values || {}),
    ]);
    const ordered = Object.keys(PRICING_RULE_FIELD_LABEL).filter((k) => keys.has(k));
    const extras = Array.from(keys)
      .filter((k) => !(k in PRICING_RULE_FIELD_LABEL))
      .sort();
    return [...ordered, ...extras];
  }, [entry]);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-bold text-slate-900">Chi tiết thay đổi</h3>
            <div className="text-xs text-slate-500 mt-0.5">
              {entry.changed_at ? new Date(entry.changed_at).toLocaleString('vi-VN') : '—'}
              {entry.changed_by_email && (
                <>
                  {' '}· bởi{' '}
                  <span className="font-medium text-slate-700">{entry.changed_by_email}</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"
          >
            <X className="h-4 w-4 text-slate-600" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">
          {entry.change_summary && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-brand-50 border border-brand-200 text-xs text-brand-900">
              {entry.change_summary}
            </div>
          )}
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-1/3">Field</th>
                <th className="px-3 py-2 text-left font-semibold">Trước</th>
                <th className="px-3 py-2 text-left font-semibold">Sau</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allKeys.map((k) => {
                const oldV = (entry.old_values || {})[k];
                const newV = (entry.new_values || {})[k];
                const changed = JSON.stringify(oldV) !== JSON.stringify(newV);
                return (
                  <tr key={k} className={changed ? 'bg-amber-50/40' : ''}>
                    <td className="px-3 py-2 font-medium text-slate-700">
                      {PRICING_RULE_FIELD_LABEL[k] || k}
                      <div className="text-[11px] text-slate-400 font-mono">{k}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      <span
                        className={cn(
                          changed ? 'text-rose-700 line-through' : 'text-slate-600',
                        )}
                      >
                        {fmtHistoryValue(oldV)}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      <span
                        className={cn(
                          changed ? 'text-emerald-700 font-semibold' : 'text-slate-600',
                        )}
                      >
                        {fmtHistoryValue(newV)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-100"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
