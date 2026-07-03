'use client';

// Quote batch modal — tick N sourcing entries → tạo báo giá XLSX/PDF/TSV download.
// Thang 2026-06-03, PDF + preview 2026-06-13.
// 2026-06-21 (Issue #2): MANUAL per-line price selection. The owner must pick,
// per line, EXACTLY ONE of: a supplier candidate price (live FX-computed VND) or
// a typed manual VND override. No server-side auto-pick. Live FX rate + date are
// shown; stale rates ("tỷ giá quá hạn") are flagged and block that candidate.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import {
  FileText, FileSpreadsheet, FileType2, X, RefreshCw, Download, CheckCircle2,
  Eye, AlertTriangle, Star, Pencil, Plus, Search, Loader2,
  ClipboardList, ChevronDown, Database,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useModalA11y } from '@/hooks/useModalA11y';
import { CustomerPicker, type PickedCustomer } from '@/components/shared/CustomerPicker';
import { useAuth } from '@/providers/auth-provider';

/* ─────────── Types ─────────── */

interface SourcingPreviewRow {
  id: number;
  model: string;
  product_name: string | null;
  maker: string | null;
  brand_canonical: string | null;
  supplier_name: string | null;
  hs_code: string | null;
  sale_vnd: number | null;
  quantity: number | null;
  row_classification: string | null;  // → item_type for calc-suggest
}

// Candidate supplier price (GET /{id}/suppliers?with_quote_price=true)
interface SupplierCandidate {
  id: number;                       // sourcing_supplier_prices.id → supplier_price_id
  supplier_name: string | null;
  supplier_phone?: string | null;
  supplier_email?: string | null;
  currency: string;
  cost_amount: number;
  cost_vnd_equiv: number | null;
  exchange_rate_used: number | null;
  lead_time_days?: number | null;
  moq?: number | null;
  is_primary: boolean;
  // added when with_quote_price=true
  quote_unit_price_vnd?: number | null;
  fx_rate?: number | null;
  fx_date?: string | null;
  fx_stale?: boolean;
  fx_error?: string | null;
}

// One row's explicit choice. EXACTLY ONE of supplier_price_id | manual_unit_price_vnd.
interface LineChoice {
  sourcing_id: number;
  quantity: number;
  mode: 'supplier' | 'manual' | null;     // null = no choice yet
  supplier_price_id: number | null;       // when mode === 'supplier'
  manual_unit_price_vnd: number | null;   // when mode === 'manual'
  // Manual FX override (Thang 2026-06-21) — only meaningful on a SUPPLIER line
  // whose candidate is non-VND. `fx_rate_override` is the typed rate (empty =
  // use live); `fx_override_price_vnd` is the recomputed VND from calc-suggest
  // (so the preview == export). Both null = no override active.
  fx_rate_override: string;               // raw input text ('' = no override)
  fx_override_price_vnd: number | null;   // calc-suggest result for the typed rate
  // Per-line delivery time (free text, e.g. "20-25 ngày"). Optional.
  delivery_time?: string;
}

// One hit from POST /sourcing/bulk-lookup (fuzzy) — used by "+ Thêm dòng".
// Shape mirrors the `items[]` row returned by the endpoint (subset we use).
interface LookupHit {
  id: number;
  model: string | null;
  product_name: string | null;
  maker: string | null;
}

// One staff option from GET /sourcing/quote-staff (người báo giá dropdown).
interface QuoteStaff {
  id: number;
  full_name: string;
  email: string | null;
}

// One row from GET /sourcing/last-customer-prices.
interface LastCustomerPrice {
  sourcing_id: number;
  last_price_vnd: number | null;
  quoted_at: string;
  quote_no: string;
}

// GET /quote-batch/{quote_no}/prefill — reconstructs a quote for revision.
interface PrefillResponse {
  data: {
    customer: {
      id: number;
      company_name: string | null;
      tax_code: string | null;
      address: string | null;
      primary_contact?: { full_name: string | null } | null;
    } | null;
    items: { sourcing_id: number; quantity: number; unit_price_vnd: number }[];
    valid_until: string | null;
    quote_note: string | null;
  };
}

interface BulkLookupResponse {
  data: {
    items: LookupHit[];
    missing: string[];
    found_count: number;
    missing_count: number;
  };
}

// One item line from GET /sourcing/imv-rfq/items.
interface ImvRfqItem {
  id: number;
  rfq_number: string | null;
  customer_name: string | null;
  item_code: string | null;
  code: string | null;          // COALESCE(item_code, customer_item_code)
  product_name: string | null;
  model: string | null;
  maker: string | null;
  quantity: number | null;
  unit: string | null;
  due_date: string | null;
}

/* ─────────── Helpers ─────────── */

const fmtVnd = (v: number) => Math.round(v).toLocaleString('vi-VN');

// Local YYYY-MM-DD (for <input type="date"> + valid_until body field). Avoids the
// UTC shift of toISOString() so "hôm nay + 10" matches the user's calendar day.
const toIsoDate = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Default validity = today + 10 days (local).
const defaultValidUntil = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  return toIsoDate(d);
};

// ISO datetime → DD/MM/YYYY (badge "Lần trước").
const fmtDmy = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

// 422 from pydantic → detail is an array of {loc,msg}. 400 → detail is a string.
function extractError(e: any): string {
  const d = e?.detail;
  if (Array.isArray(d)) {
    return d.map((x: any) => x?.msg ?? '').filter(Boolean).join('; ') || 'Dữ liệu không hợp lệ';
  }
  if (typeof d === 'string') return d;
  return e?.message ?? 'Unknown';
}

export function QuoteBatchModal({
  sourcingIds = [],
  initialCustomerId,
  reviseOfQuoteNo,
  onClose,
  onCreated,
}: {
  sourcingIds?: number[];
  initialCustomerId?: number;
  reviseOfQuoteNo?: string;
  onClose: () => void;
  onCreated?: (quoteNo: string) => void;
}) {
  // Revision mode: seeded from an existing quote via /prefill. Locks the customer
  // chip + flags the header "Sửa & gửi lại"; save sends revise_of_quote_no.
  const isRevise = reviseOfQuoteNo != null;
  // Current logged-in user — used to default the "Người báo giá" dropdown.
  const { user } = useAuth();
  // Working set of sourcing ids: seeded from props, extended by "+ Thêm dòng".
  // De-duped, insertion-ordered (seed first, appends after).
  const [ids, setIds] = useState<number[]>(() => Array.from(new Set(sourcingIds)));

  // Picked customer (drives customer_id + autofilled MST/contact/address).
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  // initialCustomerId — or a revision — locks the chip (cannot be cleared).
  const customerLocked = initialCustomerId != null || isRevise;

  const [quoteNote, setQuoteNote] = useState('');
  // "Hiệu lực đến" — sent as valid_until in preview + create. Default today+10;
  // overwritten by /prefill in revision mode.
  const [validUntil, setValidUntil] = useState<string>(() => defaultValidUntil());
  // "Người báo giá" — the staff member's full_name sent as quote_owner. Defaults
  // to the logged-in user; a dropdown (GET /sourcing/quote-staff) lets them switch.
  const [quoteOwner, setQuoteOwner] = useState<string>(() => user?.full_name ?? '');
  const [fileFormat, setFileFormat] = useState<'xlsx' | 'pdf' | 'tsv'>('xlsx');
  const [choices, setChoices] = useState<Record<number, LineChoice>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Line-builder ("+ Thêm dòng") search state.
  const [lineQuery, setLineQuery] = useState('');
  const [lineHits, setLineHits] = useState<LookupHit[]>([]);
  const [lineSearching, setLineSearching] = useState(false);

  /* ─────────── "Dán mã / IMV" panel state ─────────── */
  const [pastePanelOpen, setPastePanelOpen] = useState(false);
  const [pasteMode, setPasteMode] = useState<'paste' | 'imv'>('paste');
  // Mode 1 — dán danh sách.
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteResult, setPasteResult] = useState<string | null>(null);
  // Mode 2 — từ IMV RFQ.
  const [imvQuery, setImvQuery] = useState('');
  const [imvRows, setImvRows] = useState<ImvRfqItem[]>([]);
  const [imvSearching, setImvSearching] = useState(false);
  const [imvChecked, setImvChecked] = useState<Set<number>>(new Set());
  const [imvBusy, setImvBusy] = useState(false);
  const [imvResult, setImvResult] = useState<string | null>(null);

  // ICE a11y wiring.
  const titleId = useId();
  const descId = useId();
  const liveId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewDialogRef = useRef<HTMLDivElement>(null);
  const previewTitleId = useId();
  const [liveMsg, setLiveMsg] = useState('');

  useModalA11y({ active: !previewOpen, containerRef: dialogRef, onClose });
  useModalA11y({
    active: previewOpen,
    containerRef: previewDialogRef,
    onClose: () => setPreviewOpen(false),
  });

  // ── Fetch each sourcing entry header (model/name/brand/qty). ──
  const headerQueries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['sourcing-entry', id],
      queryFn: async () => {
        const res = await api.get<{ data: SourcingPreviewRow }>(`/api/v1/sourcing/${id}`);
        return res.data;
      },
      staleTime: 60_000,
    })),
  });

  // ── Fetch candidate supplier prices (with live quote price) per entry. ──
  const candidateQueries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['sourcing-suppliers-quote', id],
      queryFn: async () => {
        const res = await api.get<{ data: SupplierCandidate[] }>(
          `/api/v1/sourcing/${id}/suppliers?with_quote_price=true`,
        );
        return res.data ?? [];
      },
      staleTime: 30_000,
    })),
  });

  const headerLoading = headerQueries.some((q) => q.isLoading);
  const candidatesLoading = candidateQueries.some((q) => q.isLoading);

  const rows: SourcingPreviewRow[] = useMemo(
    () => headerQueries.map((q) => q.data).filter(Boolean) as SourcingPreviewRow[],
    [headerQueries],
  );

  // Map sourcing_id → candidate list.
  const candidatesById = useMemo(() => {
    const m: Record<number, SupplierCandidate[]> = {};
    ids.forEach((id, i) => {
      m[id] = (candidateQueries[i]?.data as SupplierCandidate[] | undefined) ?? [];
    });
    return m;
  }, [ids, candidateQueries]);

  // ── Last quoted price to THIS customer, per sourcing_id (badge "Lần trước"). ──
  // Refetches whenever the picked customer or the working id-set changes.
  const lastPriceQuery = useQuery({
    queryKey: ['last-customer-prices', customer?.id, ids.join(',')],
    enabled: customer?.id != null && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await api.get<{ data: LastCustomerPrice[] }>(
        `/api/v1/sourcing/last-customer-prices?customer_id=${customer!.id}&sourcing_ids=${ids.join(',')}`,
      );
      return res.data ?? [];
    },
  });

  // ── Staff list for the "Người báo giá" dropdown. Degrades gracefully: if the
  //    endpoint fails the dropdown simply has no options and the typed/default
  //    name still ships as quote_owner (never blocks quoting). ──
  const staffQuery = useQuery({
    queryKey: ['sourcing-quote-staff'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await api.get<{ data: QuoteStaff[] }>('/api/v1/sourcing/quote-staff');
      return res.data ?? [];
    },
  });
  const staffList = staffQuery.data ?? [];

  // Default the quoter once the list loads (only if not already set / matched).
  useEffect(() => {
    if (staffList.length === 0) return;
    setQuoteOwner((cur) => {
      if (cur && staffList.some((s) => s.full_name === cur)) return cur;
      const mine = user?.full_name && staffList.find((s) => s.full_name === user.full_name);
      if (mine) return mine.full_name;
      return cur || staffList[0].full_name;
    });
    // staffList identity changes per fetch; user is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffQuery.data]);

  const lastPriceById = useMemo(() => {
    const m = new Map<number, { last_price_vnd: number; quoted_at: string; quote_no: string }>();
    for (const p of lastPriceQuery.data ?? []) {
      if (p.last_price_vnd != null) {
        m.set(p.sourcing_id, {
          last_price_vnd: Number(p.last_price_vnd),
          quoted_at: p.quoted_at,
          quote_no: p.quote_no,
        });
      }
    }
    return m;
  }, [lastPriceQuery.data]);

  // ── Initialize choices once headers load. ──
  // Batch #1 (2026-06-27, V1/V2): DEFAULT each line to the price the user froze
  // in the form ("Áp dụng giá báo" → sale_vnd) so the exported báo giá == what
  // they saw. They can still re-pick a supplier (recompute) or retype. Priority:
  // revision-prefill > frozen sale_vnd > no-choice. Lines seeded from the frozen
  // price are tracked in `savedDefaults` so the UI can badge them.
  useEffect(() => {
    if (rows.length === 0) return;
    setChoices((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (!next[r.id]) {
          const prefilled = prefillPrices.current.get(r.id);
          const frozen =
            prefilled == null && r.sale_vnd != null && Number(r.sale_vnd) > 0
              ? Number(r.sale_vnd)
              : null;
          const seed = prefilled != null ? prefilled : frozen;
          if (frozen != null) savedDefaults.current.add(r.id);
          next[r.id] = {
            sourcing_id: r.id,
            quantity: Number(r.quantity ?? 1) || 1,
            mode: seed != null ? 'manual' : null,
            supplier_price_id: null,
            manual_unit_price_vnd: seed != null ? seed : null,
            fx_rate_override: '',
            fx_override_price_vnd: null,
          };
        }
      }
      return next;
    });
  }, [rows]);

  // ── Pre-select + lock customer when initialCustomerId is supplied. ──
  // Fetch once; map the CRM record to PickedCustomer shape.
  useEffect(() => {
    if (initialCustomerId == null) return;
    let cancelled = false;
    api
      .get<{ data: PickedCustomer }>(`/api/v1/crm/customers/${initialCustomerId}`)
      .then((res) => {
        if (!cancelled && res.data) setCustomer(res.data);
      })
      .catch(() => {
        if (!cancelled) toast.error('Không tải được thông tin khách hàng');
      });
    return () => {
      cancelled = true;
    };
  }, [initialCustomerId]);

  // ── Revision prefill: seed customer + line set + per-line manual prices +
  //    valid_until + note from an existing quote. Runs once on mount. ──
  // Prefilled price holder: applied as each line's choice is seeded so it
  // survives the headers-load init effect (which only fills blank choices).
  const prefillPrices = useRef<Map<number, number>>(new Map());
  // Lines whose price was seeded from the entry's frozen sale_vnd (Batch #1) —
  // used to badge them "Giá đã chốt từ form" so the source is transparent (V2).
  const savedDefaults = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (reviseOfQuoteNo == null) return;
    let cancelled = false;
    api
      .get<PrefillResponse>(
        `/api/v1/sourcing/quote-batch/${encodeURIComponent(reviseOfQuoteNo)}/prefill`,
      )
      .then((res) => {
        if (cancelled) return;
        const p = res.data;
        if (p.customer) {
          const pc = p.customer.primary_contact;
          setCustomer({
            id: p.customer.id,
            customer_code: null,
            company_name: p.customer.company_name ?? '',
            short_name: null,
            tax_code: p.customer.tax_code,
            address: p.customer.address,
            business_system: null,
            primary_contact: pc?.full_name
              ? { full_name: pc.full_name, phone: null, email: null }
              : null,
          });
        }
        setQuoteNote(p.quote_note ?? '');
        if (p.valid_until) setValidUntil(p.valid_until);
        // Seed the working id-set (de-duped) + stash per-line manual prices.
        const seedIds = p.items.map((it) => it.sourcing_id);
        prefillPrices.current = new Map(
          p.items.map((it) => [it.sourcing_id, Number(it.unit_price_vnd)]),
        );
        setIds((prev) => Array.from(new Set([...prev, ...seedIds])));
      })
      .catch(() => {
        if (!cancelled) toast.error('Không tải được báo giá để sửa');
      });
    return () => {
      cancelled = true;
    };
  }, [reviseOfQuoteNo]);

  /* ─────────── Line builder ("+ Thêm dòng") ─────────── */

  // Debounced fuzzy lookup (300ms). Filters out ids already in the working set.
  useEffect(() => {
    const q = lineQuery.trim();
    if (q.length < 1) {
      setLineHits([]);
      setLineSearching(false);
      return;
    }
    setLineSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.post<BulkLookupResponse>(
          '/api/v1/sourcing/bulk-lookup',
          { codes: [q], search_mode: 'fuzzy' },
        );
        // Fuzzy lookup can match many entries for one term → use items[].
        // Drop ids already present in the working set.
        const items = res.data?.items ?? [];
        setLineHits(items.filter((h) => !ids.includes(h.id)));
      } catch {
        setLineHits([]);
      } finally {
        setLineSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [lineQuery, ids]);

  // Append a looked-up entry to the working set (de-duped). Its header +
  // candidates fetch automatically via the keyed useQueries above, and the
  // choices effect seeds a blank LineChoice — reusing the existing pricing UI.
  const appendLine = (hit: LookupHit) => {
    setIds((prev) => (prev.includes(hit.id) ? prev : [...prev, hit.id]));
    setLineQuery('');
    setLineHits([]);
  };

  const removeLine = (id: number) => {
    setIds((prev) => prev.filter((x) => x !== id));
    setChoices((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  /* ─────────── "Dán mã / IMV" — shared lookup → append flow ─────────── */

  // Split a pasted blob into codes. Split on newline/comma/tab/semicolon ONLY
  // (NOT plain space — codes may legitimately contain spaces). Trim, dedupe,
  // drop empties (case-insensitive de-dup but original casing preserved).
  const parseCodes = (raw: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const tok of raw.split(/[\n,\t;]+/)) {
      const s = tok.trim();
      if (!s) continue;
      const k = s.toUpperCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  };

  // POST fuzzy bulk-lookup for `codes`, append every matched id not already in
  // the working set (reuses setIds exactly like appendLine), return a counts
  // summary. Appends in one setIds call so React batches the id-set growth.
  const lookupAndAppend = async (
    codes: string[],
  ): Promise<{ added: number; missing: string[] }> => {
    const res = await api.post<BulkLookupResponse>('/api/v1/sourcing/bulk-lookup', {
      codes,
      search_mode: 'fuzzy',
    });
    const items = res.data?.items ?? [];
    const missing = res.data?.missing ?? [];
    const newIds = items.map((h) => h.id);
    let added = 0;
    setIds((prev) => {
      const present = new Set(prev);
      const append: number[] = [];
      for (const id of newIds) {
        if (!present.has(id)) {
          present.add(id);
          append.push(id);
        }
      }
      added = append.length;
      return append.length ? [...prev, ...append] : prev;
    });
    return { added, missing };
  };

  // Pretty result line: "Đã thêm N mã · không khớp M: a, b, …" (missing truncated).
  const fmtAddResult = (added: number, missing: string[]): string => {
    let line = `Đã thêm ${added} mã`;
    if (missing.length > 0) {
      const shown = missing.slice(0, 8).join(', ');
      const more = missing.length > 8 ? `, +${missing.length - 8}…` : '';
      line += ` · không khớp ${missing.length}: ${shown}${more}`;
    }
    return line;
  };

  // Mode 1 — "Tìm & thêm" from the textarea.
  const runPasteLookup = async () => {
    const codes = parseCodes(pasteText);
    if (codes.length === 0) {
      setPasteResult('Không có mã hợp lệ.');
      return;
    }
    setPasteBusy(true);
    setPasteResult(null);
    try {
      const { added, missing } = await lookupAndAppend(codes);
      setPasteResult(fmtAddResult(added, missing));
    } catch (e) {
      setPasteResult(extractError(e));
    } finally {
      setPasteBusy(false);
    }
  };

  // Mode 2 — debounced IMV RFQ search (q empty → recent).
  useEffect(() => {
    if (!pastePanelOpen || pasteMode !== 'imv') return;
    setImvSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ data: ImvRfqItem[] }>(
          `/api/v1/sourcing/imv-rfq/items?q=${encodeURIComponent(imvQuery.trim())}&limit=30`,
        );
        setImvRows(res.data ?? []);
      } catch {
        setImvRows([]);
      } finally {
        setImvSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [imvQuery, pasteMode, pastePanelOpen]);

  const toggleImvRow = (id: number) =>
    setImvChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Mode 2 — "Thêm k mã đã chọn": collect chosen rows' codes → same flow.
  const runImvAdd = async () => {
    const codes: string[] = [];
    const seen = new Set<string>();
    for (const r of imvRows) {
      if (!imvChecked.has(r.id)) continue;
      const code = (r.item_code || r.code || '').trim();
      if (!code) continue;
      const k = code.toUpperCase();
      if (seen.has(k)) continue;
      seen.add(k);
      codes.push(code);
    }
    if (codes.length === 0) {
      setImvResult('Các dòng đã chọn không có mã.');
      return;
    }
    setImvBusy(true);
    setImvResult(null);
    try {
      const { added, missing } = await lookupAndAppend(codes);
      setImvResult(fmtAddResult(added, missing));
      setImvChecked(new Set());
    } catch (e) {
      setImvResult(extractError(e));
    } finally {
      setImvBusy(false);
    }
  };

  /* ─────────── Choice mutations ─────────── */

  const setQuantity = (id: number, q: number) =>
    setChoices((p) => ({ ...p, [id]: { ...p[id], quantity: q } }));

  const setDeliveryTime = (id: number, v: string) =>
    setChoices((p) => ({ ...p, [id]: { ...p[id], delivery_time: v } }));

  const pickSupplier = (id: number, supplierPriceId: number) =>
    setChoices((p) => ({
      ...p,
      [id]: {
        ...p[id],
        mode: 'supplier',
        supplier_price_id: supplierPriceId,
        manual_unit_price_vnd: null,
        // Switching candidate clears any FX override (rate was per-candidate).
        fx_rate_override: p[id]?.supplier_price_id === supplierPriceId ? p[id]?.fx_rate_override ?? '' : '',
        fx_override_price_vnd: p[id]?.supplier_price_id === supplierPriceId ? p[id]?.fx_override_price_vnd ?? null : null,
      },
    }));

  const pickManual = (id: number) =>
    setChoices((p) => ({
      ...p,
      [id]: {
        ...p[id],
        mode: 'manual',
        supplier_price_id: null,
        manual_unit_price_vnd: p[id]?.manual_unit_price_vnd ?? 0,
        // Manual-VND path has no FX — drop any override.
        fx_rate_override: '',
        fx_override_price_vnd: null,
      },
    }));

  const setManualPrice = (id: number, v: number) =>
    setChoices((p) => ({
      ...p,
      [id]: {
        ...p[id],
        mode: 'manual',
        supplier_price_id: null,
        manual_unit_price_vnd: v,
        fx_rate_override: '',
        fx_override_price_vnd: null,
      },
    }));

  // ── Manual FX override (supplier lines, non-VND candidate) ──
  // Set the raw typed rate. Empty → clear the override (revert to live price).
  const setFxOverride = (id: number, raw: string) =>
    setChoices((p) => ({
      ...p,
      [id]: {
        ...p[id],
        fx_rate_override: raw,
        // Clearing the field immediately reverts to the live candidate price;
        // a non-empty value's recomputed VND arrives via the debounced effect.
        fx_override_price_vnd: raw.trim() === '' ? null : p[id]?.fx_override_price_vnd ?? null,
      },
    }));

  // sourcing_id → pricing item_type. V1.1 (Thang 2026-06-27): classification
  // (row_classification) must NEVER drive pricing. The backend export hardcodes
  // item_type='default', so the calc-suggest PREVIEW must use 'default' too —
  // otherwise the shown "Đơn giá báo" diverges from the exported price.
  const itemTypeById = useMemo(() => {
    const m: Record<number, string | null> = {};
    for (const r of rows) m[r.id] = 'default';
    return m;
  }, [rows]);

  // ── Debounced calc-suggest for typed FX overrides ──
  // For every supplier line with a non-empty, >0 FX rate that differs from the
  // candidate's live rate, recompute the EXACT VND via /calc-suggest so the
  // shown "Đơn giá báo" == the export. Debounced ~300ms; clearing reverts.
  const pendingFxKey = useMemo(() => {
    const parts: string[] = [];
    for (const r of rows) {
      const c = choices[r.id];
      if (!c || c.mode !== 'supplier' || c.supplier_price_id == null) continue;
      const raw = c.fx_rate_override.trim();
      if (raw === '' || !(Number(raw) > 0)) continue;
      parts.push(`${r.id}:${c.supplier_price_id}:${raw}`);
    }
    return parts.join('|');
  }, [rows, choices]);

  useEffect(() => {
    if (pendingFxKey === '') return;
    const t = setTimeout(() => {
      for (const part of pendingFxKey.split('|')) {
        const [idStr, spStr, rateStr] = part.split(':');
        const id = Number(idStr);
        const spId = Number(spStr);
        const rate = Number(rateStr);
        const cand = candidatesById[id]?.find((x) => x.id === spId);
        if (!cand || (cand.currency || 'VND').toUpperCase() === 'VND') continue;
        api
          .post<{ data: { suggested_sale_vnd: number } }>('/api/v1/sourcing/calc-suggest', {
            item_type: itemTypeById[id] ?? null,
            cost_amount: cand.cost_amount,
            currency: cand.currency,
            exchange_rate: rate,
            is_domestic_vn: false,
          })
          .then((res) => {
            // Only apply if the user hasn't since changed this line's rate.
            setChoices((p) => {
              const cur = p[id];
              if (!cur || cur.supplier_price_id !== spId || Number(cur.fx_rate_override) !== rate) return p;
              return { ...p, [id]: { ...cur, fx_override_price_vnd: Number(res.data.suggested_sale_vnd) } };
            });
          })
          .catch(() => {
            // Compute failed (e.g. missing rule) — drop the override price so the
            // line falls back to the live candidate price and stays exportable.
            setChoices((p) => {
              const cur = p[id];
              if (!cur || cur.supplier_price_id !== spId || Number(cur.fx_rate_override) !== rate) return p;
              return { ...p, [id]: { ...cur, fx_override_price_vnd: null } };
            });
          });
      }
    }, 300);
    return () => clearTimeout(t);
    // candidatesById/itemTypeById are stable per fetch; key drives the recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFxKey]);

  /* ─────────── Derived: per-line unit price + validity ─────────── */

  // Whether a line currently has a usable manual FX override in effect.
  const hasFxOverride = (c: LineChoice | undefined): boolean =>
    !!c && c.mode === 'supplier' && c.fx_rate_override.trim() !== '' &&
    Number(c.fx_rate_override) > 0 && c.fx_override_price_vnd != null;

  // Resolve the effective unit price (VND) for a line given its choice.
  const lineUnitPrice = (id: number): number | null => {
    const c = choices[id];
    if (!c || !c.mode) return null;
    if (c.mode === 'manual') {
      return c.manual_unit_price_vnd != null ? Number(c.manual_unit_price_vnd) : null;
    }
    const cand = candidatesById[id]?.find((x) => x.id === c.supplier_price_id);
    if (!cand) return null;
    // A typed FX override (recomputed via calc-suggest) wins over the live price.
    if (hasFxOverride(c)) return Number(c.fx_override_price_vnd);
    return cand.quote_unit_price_vnd != null ? Number(cand.quote_unit_price_vnd) : null;
  };

  // A line is "valid" when it has exactly one explicit, usable choice.
  const lineValid = (id: number): boolean => {
    const c = choices[id];
    if (!c || !c.mode) return false;
    if (c.mode === 'manual') {
      return c.manual_unit_price_vnd != null && Number(c.manual_unit_price_vnd) > 0;
    }
    if (c.supplier_price_id == null) return false;
    const cand = candidatesById[id]?.find((x) => x.id === c.supplier_price_id);
    // A stale / errored candidate cannot be exported.
    if (!cand || cand.fx_error || cand.fx_stale || cand.quote_unit_price_vnd == null) return false;
    return true;
  };

  const allValid = rows.length > 0 && rows.every((r) => lineValid(r.id));
  const unresolvedCount = rows.filter((r) => !lineValid(r.id)).length;

  const total = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const u = lineUnitPrice(r.id);
        const q = choices[r.id]?.quantity ?? 0;
        return sum + (u != null ? u * q : 0);
      }, 0),
    [rows, choices, candidatesById],
  );

  /* ─────────── Build request payload ─────────── */

  // Customer block sent to the backend. customer_id is the FIX — the row is now
  // linked; name/contact/address autofill from the picked CRM record.
  const customerPayload = () => ({
    customer_id: customer?.id ?? null,
    customer_name: customer?.company_name ?? null,
    customer_contact: customer?.primary_contact?.full_name ?? null,
    customer_address: customer?.address ?? null,
  });

  const buildItems = () =>
    rows.map((r) => {
      const c = choices[r.id];
      // Per-line delivery time (free text) — only sent when non-empty.
      const dt = (c.delivery_time ?? '').trim();
      if (c.mode === 'manual') {
        const item: Record<string, unknown> = {
          sourcing_id: r.id,
          quantity: c.quantity,
          manual_unit_price_vnd: Number(c.manual_unit_price_vnd),
        };
        if (dt !== '') item.delivery_time = dt;
        return item;
      }
      const base: Record<string, unknown> = {
        sourcing_id: r.id,
        quantity: c.quantity,
        supplier_price_id: c.supplier_price_id,
      };
      // Only send fx_rate_override when the owner actually typed a valid rate —
      // otherwise omit so the backend uses the live DB FX.
      const raw = c.fx_rate_override.trim();
      if (raw !== '' && Number(raw) > 0) base.fx_rate_override = Number(raw);
      if (dt !== '') base.delivery_time = dt;
      return base;
    });

  const buildAuthedUrl = (url: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') ?? '' : '';
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  };

  /* ─────────── Mutations ─────────── */

  const create = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ data: { quote_no: string; download_url: string; total_value_vnd: number } }>(
        '/api/v1/sourcing/quote-batch',
        {
          ...customerPayload(),
          quote_note: quoteNote || null,
          quote_owner: quoteOwner || null,
          file_format: fileFormat,
          preview: false,
          valid_until: validUntil || null,
          revise_of_quote_no: reviseOfQuoteNo ?? null,
          items: buildItems(),
        },
      );
      return r.data;
    },
    onSuccess: (data) => {
      const msg = `Đã tạo báo giá ${data.quote_no} (${fmtVnd(data.total_value_vnd)} VND)`;
      toast.success(msg);
      setLiveMsg(msg);
      window.open(buildAuthedUrl(data.download_url), '_blank');
      onCreated?.(data.quote_no);
      onClose();
    },
    onError: (e: any) => {
      const msg = `Lỗi tạo báo giá: ${extractError(e)}`;
      toast.error(msg);
      setLiveMsg(msg);
    },
  });

  const preview = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ data: { quote_no: string; download_url: string; total_value_vnd: number } }>(
        '/api/v1/sourcing/quote-batch',
        {
          ...customerPayload(),
          quote_note: quoteNote || null,
          quote_owner: quoteOwner || null,
          file_format: 'pdf',
          preview: true,
          valid_until: validUntil || null,
          items: buildItems(),
        },
      );
      return r.data;
    },
    onSuccess: (data) => {
      setPreviewUrl(buildAuthedUrl(data.download_url));
      setPreviewOpen(true);
    },
    onError: (e: any) => {
      toast.error(`Không tạo được preview: ${extractError(e)}`);
    },
  });

  // Cmd/Ctrl+S → create (only when fully valid).
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!create.isPending && allValid) create.mutate();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [create, allValid]);

  /* ─────────── Render ─────────── */

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div role="status" aria-live="polite" id={liveId} className="sr-only">{liveMsg}</div>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — restrained brand token, no gradient stripes. */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-brand-600 ring-1 ring-brand-700/20 shadow-sm flex items-center justify-center">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 id={titleId} className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                {isRevise ? 'Sửa & gửi lại' : 'Tạo báo giá hàng loạt'}
                {isRevise && (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold text-brand-700 bg-brand-50 ring-1 ring-brand-200">
                    {reviseOfQuoteNo}
                  </span>
                )}
              </h3>
              <p id={descId} className="text-[11px] text-slate-500 font-medium">
                {ids.length} mã đã chọn — tổng <strong>{fmtVnd(total)} VND</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng (Esc)"
            className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Customer + note */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Khách hàng</label>
              <div className="mt-1">
                <CustomerPicker
                  value={customer}
                  onChange={setCustomer}
                  disabled={customerLocked}
                  placeholder="Tìm khách hàng (tên / mã / MST)…"
                />
              </div>
              {/* Autofilled identity once a customer is picked. */}
              {customer && (
                <dl className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                  {customer.tax_code && (
                    <div className="flex gap-1.5">
                      <dt className="font-semibold text-slate-600">MST:</dt>
                      <dd className="font-mono truncate">{customer.tax_code}</dd>
                    </div>
                  )}
                  {customer.primary_contact?.full_name && (
                    <div className="flex gap-1.5">
                      <dt className="font-semibold text-slate-600">Liên hệ:</dt>
                      <dd className="truncate">{customer.primary_contact.full_name}</dd>
                    </div>
                  )}
                  {customer.address && (
                    <div className="flex gap-1.5">
                      <dt className="font-semibold text-slate-600">Địa chỉ:</dt>
                      <dd className="truncate" title={customer.address}>{customer.address}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor={`${titleId}-note`} className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Ghi chú (tuỳ chọn)</label>
                <input
                  id={`${titleId}-note`}
                  type="text"
                  value={quoteNote}
                  onChange={(e) => setQuoteNote(e.target.value)}
                  placeholder="Vd: Báo giá theo yêu cầu ngày .../..."
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 ring-1 ring-slate-100 text-sm focus:ring-2 focus:ring-brand-500/40"
                />
              </div>
              <div className="sm:col-span-1">
                <label htmlFor={`${titleId}-valid`} className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Hiệu lực đến</label>
                <input
                  id={`${titleId}-valid`}
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 ring-1 ring-slate-100 text-sm font-mono focus:ring-2 focus:ring-brand-500/40"
                />
              </div>
              {/* Người báo giá — quote_owner (defaults to logged-in user). */}
              <div className="sm:col-span-3">
                <label htmlFor={`${titleId}-owner`} className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Người báo giá</label>
                {staffList.length > 0 ? (
                  <select
                    id={`${titleId}-owner`}
                    value={quoteOwner}
                    onChange={(e) => setQuoteOwner(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 ring-1 ring-slate-100 text-sm bg-white focus:ring-2 focus:ring-brand-500/40"
                  >
                    {/* Keep the current value selectable even if not in the list. */}
                    {quoteOwner && !staffList.some((s) => s.full_name === quoteOwner) && (
                      <option value={quoteOwner}>{quoteOwner}</option>
                    )}
                    {staffList.map((s) => (
                      <option key={s.id} value={s.full_name}>{s.full_name}</option>
                    ))}
                  </select>
                ) : (
                  // Staff list unavailable — allow a free-typed name (never block).
                  <input
                    id={`${titleId}-owner`}
                    type="text"
                    value={quoteOwner}
                    onChange={(e) => setQuoteOwner(e.target.value)}
                    placeholder="Tên người báo giá"
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 ring-1 ring-slate-100 text-sm focus:ring-2 focus:ring-brand-500/40"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Line builder — type code/name → append a sourcing entry as a line. */}
          <div className="relative">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Thêm dòng</label>
            <div className="mt-1 flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-brand-500">
              <Plus className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <input
                type="text"
                value={lineQuery}
                onChange={(e) => setLineQuery(e.target.value)}
                placeholder="Nhập mã / tên sản phẩm để thêm vào báo giá…"
                aria-label="Thêm dòng vào báo giá"
                autoComplete="off"
                className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />
              {lineSearching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden="true" />}
              {!lineSearching && lineQuery && <Search className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />}
            </div>
            {lineQuery.trim().length >= 1 && (lineSearching || lineHits.length > 0) && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg bg-white ring-1 ring-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.10)] divide-y divide-slate-100">
                {lineHits.length === 0 && lineSearching ? (
                  <div className="px-3 py-3 text-[12px] text-slate-400">Đang tìm…</div>
                ) : lineHits.length === 0 ? (
                  <div className="px-3 py-3 text-[12px] text-slate-400">Không tìm thấy mã phù hợp.</div>
                ) : (
                  lineHits.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => appendLine(h)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-brand-50/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[13px] font-semibold text-slate-800 truncate">{h.model ?? `#${h.id}`}</span>
                          {h.maker && <span className="text-[11px] text-slate-400 truncate">· {h.maker}</span>}
                        </div>
                        {h.product_name && (
                          <div className="truncate text-[11px] text-slate-400">{h.product_name}</div>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 shrink-0 text-[11px] font-semibold text-brand-700">
                        <Plus className="h-3 w-3" /> Thêm
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* "Dán mã / IMV" — collapsible bulk-add panel (paste list OR IMV RFQ). */}
          <div className="rounded-lg ring-1 ring-slate-200 bg-slate-50/40">
            <button
              type="button"
              onClick={() => setPastePanelOpen((o) => !o)}
              aria-expanded={pastePanelOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-700">
                <ClipboardList className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                Dán mã / IMV
              </span>
              <ChevronDown
                className={cn('h-4 w-4 text-slate-400 transition-transform', pastePanelOpen && 'rotate-180')}
                aria-hidden="true"
              />
            </button>

            {pastePanelOpen && (
              <div className="border-t border-slate-200 px-3 py-3 space-y-3">
                {/* Sub-mode toggle */}
                <div className="inline-flex rounded-lg bg-slate-100/70 ring-1 ring-slate-200 p-0.5 text-xs">
                  {([
                    { value: 'paste' as const, label: 'Dán danh sách', Icon: ClipboardList },
                    { value: 'imv' as const, label: 'Từ IMV RFQ', Icon: Database },
                  ]).map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPasteMode(value)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-all',
                        pasteMode === value
                          ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200'
                          : 'text-slate-500 hover:text-slate-800',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* Mode 1 — paste list */}
                {pasteMode === 'paste' && (
                  <div className="space-y-2">
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={4}
                      placeholder="Dán nhiều mã từ IMV / Excel / danh sách — mỗi mã 1 dòng hoặc cách nhau bởi dấu phẩy"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 ring-1 ring-slate-100 text-[13px] font-mono text-slate-800 outline-none focus:ring-2 focus:ring-brand-500/40 placeholder:font-sans placeholder:text-slate-400"
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={runPasteLookup}
                        disabled={pasteBusy || pasteText.trim().length === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 transition-colors"
                      >
                        {pasteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        Tìm &amp; thêm
                      </button>
                      {pasteResult && <span className="text-[12px] text-slate-600">{pasteResult}</span>}
                    </div>
                  </div>
                )}

                {/* Mode 2 — from IMV RFQ */}
                {pasteMode === 'imv' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-brand-500">
                      <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <input
                        type="text"
                        value={imvQuery}
                        onChange={(e) => setImvQuery(e.target.value)}
                        placeholder="Tìm IMV RFQ — số RFQ / khách / mã / tên / model…"
                        aria-label="Tìm IMV RFQ"
                        autoComplete="off"
                        className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                      />
                      {imvSearching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden="true" />}
                    </div>

                    <div className="max-h-60 overflow-y-auto rounded-lg bg-white ring-1 ring-slate-200 divide-y divide-slate-100">
                      {imvSearching && imvRows.length === 0 ? (
                        <div className="px-3 py-3 text-[12px] text-slate-400">Đang tìm…</div>
                      ) : imvRows.length === 0 ? (
                        <div className="px-3 py-3 text-[12px] text-slate-400">Không có dòng IMV RFQ nào.</div>
                      ) : (
                        imvRows.map((r) => {
                          const code = r.item_code || r.code;
                          const checked = imvChecked.has(r.id);
                          return (
                            <label
                              key={r.id}
                              className={cn(
                                'flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-brand-50/40',
                                checked && 'bg-brand-50/60',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleImvRow(r.id)}
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {r.rfq_number && (
                                    <span className="font-mono text-[12px] font-semibold text-brand-700">{r.rfq_number}</span>
                                  )}
                                  {r.customer_name && (
                                    <span className="text-[11px] text-slate-500 truncate">· {r.customer_name}</span>
                                  )}
                                  {code && (
                                    <span className="font-mono text-[11px] text-slate-700">· {code}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                  {r.product_name && <span className="truncate">{r.product_name}</span>}
                                  {r.due_date && <span className="shrink-0">· hạn {r.due_date}</span>}
                                </div>
                              </div>
                            </label>
                          );
                        })
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={runImvAdd}
                        disabled={imvBusy || imvChecked.size === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 transition-colors"
                      >
                        {imvBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        Thêm {imvChecked.size} mã đã chọn
                      </button>
                      {imvResult && <span className="text-[12px] text-slate-600">{imvResult}</span>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Format toggle: Excel | PDF | TSV */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Định dạng:</span>
            <div className="inline-flex rounded-lg bg-slate-100/70 ring-1 ring-slate-200 p-0.5 text-xs">
              {([
                { value: 'xlsx' as const, label: 'Excel', Icon: FileSpreadsheet },
                { value: 'pdf' as const, label: 'PDF', Icon: FileText },
                { value: 'tsv' as const, label: 'TSV', Icon: FileType2 },
              ]).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFileFormat(value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-all',
                    fileFormat === value ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
            {fileFormat === 'pdf' && (
              <button
                type="button"
                onClick={() => preview.mutate()}
                disabled={preview.isPending || !allValid}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-brand-50 hover:bg-brand-100 text-brand-700 ring-1 ring-brand-100 disabled:opacity-50 transition-colors"
                title="Tạo file tạm và xem trước PDF (không lưu)"
              >
                {preview.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                Xem preview
              </button>
            )}
          </div>

          {/* Validation banner */}
          {!headerLoading && unresolvedCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[12px] text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Còn <strong>{unresolvedCount}</strong> dòng chưa chọn giá. Mỗi dòng phải chọn <strong>đúng một</strong> nhà cung cấp
                hoặc nhập giá tay (lớn hơn 0) trước khi xuất.
              </span>
            </div>
          )}

          {/* Per-line selection cards */}
          {headerLoading ? (
            <div className="py-10 text-center text-slate-400">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" /> Đang tải...
            </div>
          ) : ids.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-slate-400">
              Chưa có dòng nào — dùng ô <strong className="text-slate-600">“Thêm dòng”</strong> ở trên để thêm mã vào báo giá.
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => {
                const c = choices[r.id];
                const cands = candidatesById[r.id] ?? [];
                const loadingCands = candidatesLoading && cands.length === 0;
                const unit = lineUnitPrice(r.id);
                const qty = c?.quantity ?? 0;
                const lineTotal = unit != null ? unit * qty : 0;
                const valid = lineValid(r.id);
                const lastPrice = lastPriceById.get(r.id);
                return (
                  <div
                    key={r.id}
                    className={cn(
                      'rounded-xl border ring-1 overflow-hidden',
                      valid ? 'border-emerald-200 ring-emerald-100' : 'border-slate-200 ring-slate-100',
                    )}
                  >
                    {/* Line header: model / name / qty / line total */}
                    <div className="flex items-center gap-3 px-3 py-2 bg-slate-50/70 border-b border-slate-100">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {valid
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                            : <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" aria-hidden="true" />}
                          <span className="font-mono text-sm font-bold text-slate-900 truncate" title={r.model}>{r.model}</span>
                          {(r.brand_canonical || r.maker) && (
                            <span className="text-[11px] text-slate-500 truncate">· {r.brand_canonical ?? r.maker}</span>
                          )}
                        </div>
                        {r.product_name && (
                          <div className="text-[11px] text-slate-500 truncate" title={r.product_name}>{r.product_name}</div>
                        )}
                        {/* Last price quoted to THIS customer — violet badge + "Áp dụng". */}
                        {lastPrice && (
                          <div className="mt-1 inline-flex items-center gap-1.5">
                            <span
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 bg-brand-50 ring-1 ring-brand-200"
                              title={`Báo giá ${lastPrice.quote_no}`}
                            >
                              Lần trước: <span className="font-mono">₫{fmtVnd(lastPrice.last_price_vnd)}</span>
                              <span className="text-brand-400">· {fmtDmy(lastPrice.quoted_at)}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setManualPrice(r.id, lastPrice.last_price_vnd)}
                              className="text-[11px] font-semibold text-brand-700 hover:text-brand-900 underline"
                              title="Áp dụng giá bán lần trước cho khách này"
                            >
                              Áp dụng
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label htmlFor={`qty-${r.id}`} className="text-[11px] uppercase font-bold text-slate-500">SL</label>
                        <input
                          id={`qty-${r.id}`}
                          type="number"
                          min={0}
                          value={qty}
                          onChange={(e) => setQuantity(r.id, Number(e.target.value))}
                          className="w-16 text-right px-1.5 py-1 rounded border border-slate-200 text-xs font-mono"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label htmlFor={`dt-${r.id}`} className="text-[11px] uppercase font-bold text-slate-500">Giao hàng</label>
                        <input
                          id={`dt-${r.id}`}
                          type="text"
                          value={c?.delivery_time ?? ''}
                          onChange={(e) => setDeliveryTime(r.id, e.target.value)}
                          placeholder="20-25 ngày"
                          className="w-24 px-1.5 py-1 rounded border border-slate-200 text-xs"
                        />
                      </div>
                      <div className="w-32 text-right">
                        <div className="text-[11px] uppercase font-bold text-slate-400">Thành tiền</div>
                        <div className={cn('font-mono text-sm font-bold tabular-nums', valid ? 'text-emerald-700' : 'text-slate-400')}>
                          {unit != null ? fmtVnd(lineTotal) : '—'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(r.id)}
                        aria-label={`Xoá dòng ${r.model}`}
                        title="Xoá dòng khỏi báo giá"
                        className="h-7 w-7 shrink-0 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-colors"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>

                    {/* Candidate picker */}
                    <div className="p-2.5 space-y-1.5">
                      {loadingCands ? (
                        <div className="py-3 text-center text-[12px] text-slate-400">
                          <RefreshCw className="h-4 w-4 animate-spin inline mr-1.5" /> Đang tải NCC...
                        </div>
                      ) : (
                        <>
                          {cands.length === 0 && (
                            <p className="text-[12px] text-slate-400 italic px-1">
                              Chưa có giá NCC cho mã này — hãy nhập giá tay bên dưới.
                            </p>
                          )}
                          {cands.map((cand) => {
                            const selected = c?.mode === 'supplier' && c.supplier_price_id === cand.id;
                            const blocked = !!cand.fx_error || !!cand.fx_stale || cand.quote_unit_price_vnd == null;
                            const fxEditable = selected && (cand.currency || 'VND').toUpperCase() !== 'VND';
                            const overrideActive = selected && hasFxOverride(c);
                            const shownUnit = overrideActive ? Number(c!.fx_override_price_vnd) : cand.quote_unit_price_vnd;
                            return (
                              <div
                                key={cand.id}
                                className={cn(
                                  'rounded-lg border transition-colors',
                                  selected
                                    ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                                    : 'border-slate-200 hover:bg-slate-50',
                                  blocked && 'opacity-70',
                                )}
                              >
                              <label
                                className={cn(
                                  'flex items-center gap-2.5 px-2.5 py-2 cursor-pointer',
                                  blocked && 'cursor-not-allowed',
                                )}
                              >
                                <input
                                  type="radio"
                                  name={`price-${r.id}`}
                                  checked={selected}
                                  disabled={blocked}
                                  onChange={() => !blocked && pickSupplier(r.id, cand.id)}
                                  className="accent-brand-600"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[13px] font-semibold text-slate-800 truncate">
                                      {cand.supplier_name ?? 'NCC không tên'}
                                    </span>
                                    {cand.is_primary && (
                                      <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-600 bg-amber-50 ring-1 ring-amber-200 rounded px-1 py-0.5">
                                        <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" /> Chính
                                      </span>
                                    )}
                                    {(cand.fx_stale || cand.fx_error) && (
                                      <span
                                        className="inline-flex items-center gap-0.5 text-[11px] font-bold text-red-700 bg-red-50 ring-1 ring-red-200 rounded px-1 py-0.5"
                                        title={cand.fx_error ?? 'Tỷ giá quá hạn — cập nhật tại /admin/exchange-rates'}
                                      >
                                        <AlertTriangle className="h-2.5 w-2.5" /> Tỷ giá quá hạn
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    Giá gốc: <span className="font-mono">{cand.cost_amount.toLocaleString('vi-VN')} {cand.currency}</span>
                                    {cand.currency !== 'VND' && cand.fx_rate != null && (
                                      <> · Tỷ giá: <span className="font-mono">{cand.fx_rate.toLocaleString('vi-VN')}</span>
                                        {cand.fx_date && <> — {cand.fx_date}</>}</>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-[11px] uppercase font-bold text-slate-400">Đơn giá báo</div>
                                  <div className={cn('font-mono text-[13px] font-bold tabular-nums', blocked ? 'text-red-400' : 'text-brand-700')}>
                                    {shownUnit != null ? `${fmtVnd(shownUnit)} ₫` : '—'}
                                  </div>
                                  {overrideActive && (
                                    <div className="text-[11px] font-semibold text-brand-600">tỷ giá tay</div>
                                  )}
                                </div>
                              </label>

                              {/* Manual FX rate editor — only for the SELECTED non-VND candidate. */}
                              {fxEditable && (
                                <div className="flex items-center gap-2 px-2.5 pb-2 -mt-0.5">
                                  <label
                                    htmlFor={`fx-${r.id}-${cand.id}`}
                                    className="text-[11px] font-semibold text-slate-600"
                                  >
                                    Tỷ giá
                                  </label>
                                  <input
                                    id={`fx-${r.id}-${cand.id}`}
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={c?.fx_rate_override ?? ''}
                                    placeholder={cand.fx_rate != null ? String(cand.fx_rate) : 'Tỷ giá tay'}
                                    onChange={(e) => setFxOverride(r.id, e.target.value)}
                                    className="w-28 text-right px-2 py-1 rounded border border-slate-200 text-[12px] font-mono focus:ring-2 focus:ring-brand-500/40"
                                  />
                                  <span className="text-[11px] text-slate-400">
                                    Tự động: <span className="font-mono">{cand.fx_rate != null ? cand.fx_rate.toLocaleString('vi-VN') : '—'}</span>
                                    {cand.fx_date && <> — {cand.fx_date}</>}
                                  </span>
                                  {c && c.fx_rate_override.trim() !== '' && (
                                    <button
                                      type="button"
                                      onClick={() => setFxOverride(r.id, '')}
                                      className="text-[11px] font-semibold text-slate-500 hover:text-brand-700 underline"
                                    >
                                      Dùng tỷ giá live
                                    </button>
                                  )}
                                </div>
                              )}
                              </div>
                            );
                          })}

                          {/* Manual override row */}
                          <label
                            className={cn(
                              'flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors',
                              c?.mode === 'manual'
                                ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                                : 'border-dashed border-slate-300 hover:bg-slate-50',
                            )}
                          >
                            <input
                              type="radio"
                              name={`price-${r.id}`}
                              checked={c?.mode === 'manual'}
                              onChange={() => pickManual(r.id)}
                              className="accent-brand-600"
                            />
                            <div className="flex items-center gap-1.5 flex-1">
                              <Pencil className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                              <span className="text-[13px] font-semibold text-slate-700">Nhập giá tay (VND)</span>
                              {savedDefaults.current.has(r.id) &&
                                c?.mode === 'manual' &&
                                r.sale_vnd != null &&
                                Number(c?.manual_unit_price_vnd) === Number(r.sale_vnd) && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-sky-200">
                                    Giá đã chốt từ form
                                  </span>
                                )}
                            </div>
                            <input
                              type="number"
                              min={0}
                              value={c?.mode === 'manual' ? (c.manual_unit_price_vnd ?? 0) : ''}
                              placeholder="0"
                              onFocus={() => { if (c?.mode !== 'manual') pickManual(r.id); }}
                              onChange={(e) => setManualPrice(r.id, Number(e.target.value))}
                              className="w-32 text-right px-2 py-1 rounded border border-slate-200 text-[13px] font-mono focus:ring-2 focus:ring-brand-500/40"
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Grand total */}
              <div className="flex items-center justify-between rounded-xl bg-brand-50 ring-1 ring-brand-100 px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Tổng cộng (VND)</span>
                <span className="font-mono text-lg font-bold text-brand-700 tabular-nums">{fmtVnd(total)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500">
            {allValid
              ? <span className="text-emerald-600 font-semibold">Tất cả {rows.length} dòng đã chọn giá ✓</span>
              : <>Chưa thể xuất — còn <strong>{unresolvedCount}</strong> dòng chưa chọn giá</>}
          </span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold">Huỷ</button>
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={create.isPending || !allValid}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all"
            >
              {create.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Tạo + tải {fileFormat === 'xlsx' ? 'Excel' : fileFormat === 'pdf' ? 'PDF' : 'TSV'}
            </button>
          </div>
        </div>

        {/* PDF preview iframe modal */}
        {previewOpen && previewUrl && (
          <div
            className="fixed inset-0 bg-black/70 z-[120] flex items-center justify-center p-4"
            onClick={() => setPreviewOpen(false)}
            role="presentation"
          >
            <div
              ref={previewDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={previewTitleId}
              tabIndex={-1}
              className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-brand-600" aria-hidden="true" />
                  <span id={previewTitleId} className="text-sm font-bold text-slate-800">Xem trước PDF báo giá</span>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Mở PDF báo giá trong tab mới"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Mở tab mới
                  </a>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    aria-label="Đóng xem trước (Esc)"
                    className="h-7 w-7 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200 flex items-center justify-center"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <iframe src={previewUrl} title="PDF preview" className="flex-1 w-full border-0 bg-slate-100" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
