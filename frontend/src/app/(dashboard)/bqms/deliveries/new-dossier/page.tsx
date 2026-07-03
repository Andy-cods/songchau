'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronRight, ChevronLeft, Check, Loader2, AlertCircle, ArrowLeft, FileText,
  Package, Image as ImageIcon, FileSpreadsheet, Tag, Boxes, Pencil,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, withToken } from '@/lib/utils';
import { toast } from 'sonner';
import {
  PageShellHeader, StatStrip, DensityToggle, DataPanel,
  CockpitTabs, SHELL, BUTTON,
  type StatChip, type CockpitTab, type Density,
} from '@/components/cockpit';
import {
  StepHeader, StepPackingList, StepCamKet, StepTongHop,
  StepListDetail, StepLabel, StepSubmit,
  itemKey, makeLabelId,
  type DossierItem, type DossierHeader, type DossierJobStatus,
  type HeaderFromLastAttempt, type LabelEntry,
} from './wizard-steps';

// ─── Tab model — 6 Excel sheets, one visible at a time ───────────────
type TabId = 'general' | 'packing' | 'camket' | 'listdetail' | 'label' | 'tonghop';

const TAB_DEFS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'general',    label: 'Thông tin chung', icon: <Boxes className="h-3.5 w-3.5" /> },
  { id: 'packing',    label: 'Packing List',    icon: <Package className="h-3.5 w-3.5" /> },
  { id: 'camket',     label: 'Cam kết HA',      icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { id: 'listdetail', label: 'List Detail',     icon: <FileSpreadsheet className="h-3.5 w-3.5" /> },
  { id: 'label',      label: 'Label',           icon: <Tag className="h-3.5 w-3.5" /> },
  { id: 'tonghop',    label: 'Tổng hợp',        icon: <FileText className="h-3.5 w-3.5" /> },
];

/** Per-tab completion state — drives the small dot before each tab label. */
type DotState = 'complete' | 'attention' | 'untouched';

function DotIcon({ state }: { state: DotState }) {
  // ● complete (emerald) · ◐ needs attention (amber) · ○ untouched (slate)
  const cls = state === 'complete' ? 'text-emerald-500'
    : state === 'attention' ? 'text-amber-500'
    : 'text-slate-300';
  const glyph = state === 'complete' ? '●' : state === 'attention' ? '◐' : '○';
  return <span className={cn('text-[11px] leading-none', cls)} aria-hidden>{glyph}</span>;
}

interface DeliveryHistoryEntry {
  po_number: string;
  dossier_id: number;
  attempt_no: number;
  shipping_no: string | null;
  invoice_no: string | null;
  status: string;
  is_partial: boolean;
  output_folder: string | null;
  items: Array<{ bqms_code: string; shipping_qty: number }>;
  created_at: string | null;
}

interface PrefillResponse {
  data: {
    sev_type: 'SEV' | 'SEVT';
    distinct_po_numbers: string[];
    items: DossierItem[];
    delivery_history?: DeliveryHistoryEntry[];
    next_attempt_by_po?: Record<string, number>;
    defaults: DossierHeader;
    /** Optional: previous delivery's header for "Dùng lại" (repeat PO). */
    header_from_last_attempt?: HeaderFromLastAttempt | null;
  };
}

interface JobResponse {
  data: DossierJobStatus;
}

/**
 * EDIT MODE — GET /deliveries/dossier-job/{id} returns the saved form snapshot.
 * `form_data` mirrors the exact body shape the create path POSTs: the spread
 * header fields + sev_type + items[] + box_qty_total_override + optional labels[]
 * (+ box_l/w/h which the create path folds into the per-item dim fallback).
 */
interface DossierJobDetail {
  data: {
    id: number;
    status: DossierJobStatus['status'];
    form_data: {
      sev_type?: 'SEV' | 'SEVT';
      items?: DossierItem[];
      box_qty_total_override?: number | null;
      labels?: Omit<LabelEntry, 'id'>[] | null;
      box_l?: string | number | null;
      box_w?: string | number | null;
      box_h?: string | number | null;
    } & Partial<DossierHeader>;
  };
}

export default function NewDossierPage() {
  const router = useRouter();
  const search = useSearchParams();
  const idsParam = search.get('ids') || '';
  const deliveryIds = useMemo(() => idsParam.split(',').filter(Boolean).map((x) => parseInt(x, 10)).filter(Boolean), [idsParam]);

  // EDIT MODE — `?job=<id>` re-opens a finished dossier to fill blanks / edit
  // fields and regenerate the Excel. When present we hydrate from the saved
  // form snapshot instead of running dossier-prefill. The create path (no job)
  // is unchanged.
  const jobParam = search.get('job');
  const editJobId = useMemo(() => {
    const n = jobParam ? parseInt(jobParam, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [jobParam]);
  const isEditMode = editJobId != null;

  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [density, setDensity] = useState<Density>('compact'); // Thang's "Gọn" default
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Prefill data
  const [sevType, setSevType] = useState<'SEV' | 'SEVT'>('SEV');
  const [items, setItems] = useState<DossierItem[]>([]);
  const [header, setHeader] = useState<DossierHeader | null>(null);
  // Multi-delivery context (Thang 2026-05-21)
  const [deliveryHistory, setDeliveryHistory] = useState<DeliveryHistoryEntry[]>([]);
  const [nextAttemptByPo, setNextAttemptByPo] = useState<Record<string, number>>({});
  // Previous attempt header snapshot for "Dùng lại" (optional, backend-extended)
  const [lastAttempt, setLastAttempt] = useState<HeaderFromLastAttempt | null>(null);
  // Whether the user has typed into the header yet (gate auto-prefill from last attempt)
  const [headerTouched, setHeaderTouched] = useState(false);

  // Per-item edits
  const [itemEdits, setItemEdits] = useState<Record<string, Partial<DossierItem>>>({});

  // Images keyed by itemKey (po_number|po_seq|bqms_code) — bqms_code alone
  // collides when the same code appears on >1 Cam kết sheet.
  const [uploadedImages, setUploadedImages] = useState<Record<string, { actual?: File; system?: File }>>({});

  // EDIT MODE — existing evidence images already stored on the job, keyed by
  // `${itemKey}|${slot}`. Probed lazily after hydration; only keys that return
  // 200 are added. Freshly-picked Files in uploadedImages always win over these
  // (and only re-picked slots get re-uploaded on submit — untouched evidence
  // stays on the BE so it's never re-sent).
  const [existingImages, setExistingImages] = useState<Record<string, string>>({});

  // Editable Label tab state. null = untouched → BE uses legacy per-PO derivation.
  const [labels, setLabels] = useState<LabelEntry[] | null>(null);

  // Box dims (header-level, for auto-volume)
  const [boxL, setBoxL] = useState('');
  const [boxW, setBoxW] = useState('');
  const [boxH, setBoxH] = useState('');

  // Packing List Box-Qty TOTAL override (PRINT-ONLY). null = use computed sum.
  // Does NOT rescale per-row box_qty — sent to BE as box_qty_total_override.
  const [boxQtyTotalOverride, setBoxQtyTotalOverride] = useState<number | null>(null);

  // Submit / job
  const [submitted, setSubmitted] = useState(false); // toggles Tổng hợp tab into progress view
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<DossierJobStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const itemsByPo = useMemo(() => {
    const m = new Map<string, DossierItem[]>();
    for (const it of items) {
      if (!m.has(it.po_number)) m.set(it.po_number, []);
      m.get(it.po_number)!.push(it);
    }
    return m;
  }, [items]);

  // One-per-PO derived Label default — mirrors the legacy StepLabel rendering:
  // pr_person from the PO's first item (effective), bqms_code = joined codes,
  // qty = sum of effective shipping_qty. Used both to seed editable state and
  // as the payload fallback when the user never touches the Label tab.
  const derivedDefaultLabels = useMemo(() => (): LabelEntry[] => {
    const eff = (it: DossierItem) => ({ ...it, ...(itemEdits[itemKey(it)] || {}) });
    return Array.from(itemsByPo.entries()).map(([po, pitems]) => ({
      id: makeLabelId(),
      po_number: po,
      pr_person: eff(pitems[0]).pr_person || '',
      bqms_code: pitems.map((it) => it.bqms_code).join(', '),
      qty: pitems.reduce((s, it) => s + (eff(it).shipping_qty || 0), 0),
    }));
  }, [itemsByPo, itemEdits]);

  // Repeat-PO "Lần #N" — max next attempt across selected POs
  const maxNextAttempt = useMemo(() => {
    const vals = Object.values(nextAttemptByPo);
    return vals.length ? Math.max(...vals) : 0;
  }, [nextAttemptByPo]);
  const isRepeat = deliveryHistory.length > 0;

  // ─── EDIT MODE: hydrate from saved job snapshot ────────────────
  // Runs ONLY when `?job=` is present. Pulls form_data and seeds every piece
  // of wizard state so blanks render as empty/editable inputs (the wizard
  // already treats empty values as editable). Then probes the stored evidence
  // images for each item × slot.

  useEffect(() => {
    if (!isEditMode || editJobId == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<DossierJobDetail>(`/api/v1/bqms/deliveries/dossier-job/${editJobId}`)
      .then(async (r) => {
        if (cancelled) return;
        const fd = r.data.form_data || ({} as DossierJobDetail['data']['form_data']);

        setSevType((fd.sev_type as 'SEV' | 'SEVT') || 'SEV');

        const fdItems = (fd.items || []) as DossierItem[];
        setItems(fdItems);
        // Seed itemEdits from the saved items so values show AND blanks stay
        // editable. We don't pre-populate edits (the items array already holds
        // the saved values); itemEdits starts empty and overrides on user typing.
        setItemEdits({});

        // Header — reconstruct from the spread fields in form_data.
        const hdr: DossierHeader = {
          vendor_invoice_no: fd.vendor_invoice_no ?? '',
          invoice_date: fd.invoice_date ?? '',
          etd: fd.etd ?? '',
          packing_qty: Number(fd.packing_qty ?? 0),
          packing_unit: fd.packing_unit ?? 'Bag',
          volume: Number(fd.volume ?? 0),
          volume_unit: fd.volume_unit ?? 'M³',
          gross_weight: Number(fd.gross_weight ?? 0),
          weight_unit: fd.weight_unit ?? 'KG',
          shipping_manager: fd.shipping_manager ?? '',
          remark: fd.remark ?? '',
        };
        setHeader(hdr);

        // Box dims (header-level) — fold back into the L/W/H string inputs.
        if (fd.box_l != null) setBoxL(String(fd.box_l));
        if (fd.box_w != null) setBoxW(String(fd.box_w));
        if (fd.box_h != null) setBoxH(String(fd.box_h));

        setBoxQtyTotalOverride(fd.box_qty_total_override ?? null);

        // Labels — restore the editable Label tab; re-attach client-only ids.
        if (fd.labels != null) {
          setLabels(fd.labels.map((l) => ({ ...l, id: makeLabelId() })));
        } else {
          setLabels(null);
        }

        // No repeat-history banner in edit mode (we're editing one job).
        setDeliveryHistory([]);
        setNextAttemptByPo({});
        setLastAttempt(null);

        // Probe existing evidence images. For each item × slot, hit the stream
        // endpoint; keep only the ones that exist (200). withToken() appends the
        // JWT as a query param so the <img src> authenticates without headers.
        const found: Record<string, string> = {};
        await Promise.all(
          fdItems.flatMap((it) =>
            (['system', 'actual'] as const).map(async (slot) => {
              const url = `/api/v1/bqms/deliveries/dossier-job/${editJobId}/image?item_key=${encodeURIComponent(itemKey(it))}&slot=${slot}`;
              try {
                const res = await fetch(withToken(url), { method: 'GET' });
                if (res.ok) found[`${itemKey(it)}|${slot}`] = url;
              } catch { /* slot has no stored image — falls back to upload box */ }
            }),
          ),
        );
        if (!cancelled) setExistingImages(found);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.detail || e?.message || `Không tải được hồ sơ #${editJobId}`);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [editJobId, isEditMode]);

  // ─── Load prefill ──────────────────────────────────────────────

  useEffect(() => {
    if (isEditMode) return; // edit mode hydrates from the job snapshot instead
    if (!deliveryIds.length) {
      setError('Không có delivery_ids trong URL — quay lại trang Giao hàng và chọn lại');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.post<PrefillResponse>('/api/v1/bqms/deliveries/dossier-prefill', { delivery_ids: deliveryIds })
      .then((r) => {
        if (cancelled) return;
        setSevType(r.data.sev_type);
        setItems(r.data.items.map((it) => ({
          ...it,
          shipping_qty: it.remaining_qty,
          // Manual per-item packing fields — box_qty/box_weight may be blank
          // (null = user leaves empty); packing_size defaults to "".
          box_qty: it.box_qty ?? null,
          box_weight: it.box_weight ?? null,
          packing_size: it.packing_size ?? '',
        })));
        setDeliveryHistory(r.data.delivery_history || []);
        setNextAttemptByPo(r.data.next_attempt_by_po || {});

        // Header: start from defaults, then prefill from last attempt if present
        // and the user hasn't typed yet (optional field — may be undefined).
        const la = r.data.header_from_last_attempt ?? null;
        setLastAttempt(la);
        const base = r.data.defaults;
        setHeader(la ? mergeHeaderFromLast(base, la) : base);
        if (la) applyBoxDimsFromLast(la, setBoxL, setBoxW, setBoxH);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.detail || e?.message || 'Lỗi tải dữ liệu prefill');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [idsParam]);

  // ─── Poll job (active once submitted, i.e. on Tổng hợp progress view) ──

  useEffect(() => {
    if (!submitted || !jobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await api.get<JobResponse>(`/api/v1/bqms/deliveries/dossier-job/${jobId}`);
        if (cancelled) return;
        setJob(r.data);
        if (r.data.status === 'done') {
          toast.success('Tạo hồ sơ thành công!');
          return;
        }
        if (r.data.status === 'failed') {
          toast.error('Tạo hồ sơ thất bại');
          return;
        }
        if (r.data.status === 'cancelled') {
          toast.info('Đã huỷ — chưa tạo Delivery');
          return;
        }
        // awaiting_confirm vẫn poll tiếp (faster 2s để countdown mượt)
        setTimeout(poll, r.data.status === 'awaiting_confirm' ? 2000 : 4000);
      } catch (e: any) {
        if (!cancelled) setError(e?.detail || e?.message || 'Lỗi polling');
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [submitted, jobId]);

  // ─── Actions ───────────────────────────────────────────────────

  // Wrap setHeader so any edit marks the header as user-touched.
  const updateHeader = (h: DossierHeader) => { setHeaderTouched(true); setHeader(h); };

  const setItemEdit = (code: string, key: keyof DossierItem, value: any) => {
    setItemEdits({ ...itemEdits, [code]: { ...itemEdits[code], [key]: value } });
  };

  // "Dùng lại" — copy last attempt's header values into the live header.
  const handleReuseLast = () => {
    if (!header || !lastAttempt) return;
    setHeaderTouched(true);
    setHeader(mergeHeaderFromLast(header, lastAttempt));
    applyBoxDimsFromLast(lastAttempt, setBoxL, setBoxW, setBoxH);
    toast.success(`Đã dùng lại thông tin lần #${lastAttempt.attempt_no ?? ''}`);
  };

  // ─── Confirm checkpoint actions ────────────────────────────────
  const handleConfirmDelivery = async () => {
    if (!jobId) return;
    try {
      await api.post(`/api/v1/bqms/deliveries/dossier-job/${jobId}/confirm`, {});
      toast.success('Đã xác nhận — đang tạo Delivery');
    } catch (e: any) {
      toast.error(e?.detail || e?.message || 'Không gửi được xác nhận');
    }
  };
  const handleCancelDelivery = async () => {
    if (!jobId) return;
    try {
      await api.post(`/api/v1/bqms/deliveries/dossier-job/${jobId}/cancel`, {});
      toast.info('Đã huỷ — không tạo Delivery');
    } catch (e: any) {
      toast.error(e?.detail || e?.message || 'Không gửi được lệnh huỷ');
    }
  };

  const handleSubmit = async () => {
    if (!header) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        sev_type: sevType,
        items: items.map((it) => {
          const e = itemEdits[itemKey(it)] || {};
          // Per-item dims fall back to header box dims when empty
          const eff_l = String(e.dim_l ?? it.dim_l ?? '') || boxL;
          const eff_w = String(e.dim_w ?? it.dim_w ?? '') || boxW;
          const eff_h = String(e.dim_h ?? it.dim_h ?? '') || boxH;
          return {
            po_number: it.po_number,
            po_seq: it.po_seq,
            bqms_code: it.bqms_code,
            item_name: e.item_name ?? it.item_name,
            specification: e.specification ?? it.specification,
            shipping_qty: e.shipping_qty ?? it.shipping_qty,
            dept: e.dept ?? it.dept,
            pr_person: e.pr_person ?? it.pr_person,
            receiver: e.receiver ?? it.receiver,
            unit: e.unit ?? it.unit,
            dim_l: eff_l,
            dim_w: eff_w,
            dim_h: eff_h,
            // Box Weight / Box Qty are per-row and may be blank (null) — send as-is.
            box_weight: e.box_weight ?? it.box_weight,
            // Manual per-item packing fields (col N + O)
            packing_size: e.packing_size ?? it.packing_size ?? '',
            box_qty: e.box_qty ?? it.box_qty ?? null,
          };
        }),
        // PRINT-ONLY Box-Qty TOTAL override for the Packing List sheet.
        // null → BE uses the computed per-row sum. Does NOT rescale box_qty.
        box_qty_total_override: boxQtyTotalOverride,
        // Label tab: per FE↔BE contract, only sent when the user touched the
        // Label tab (labels !== null). Omitted otherwise → BE uses the legacy
        // per-PO derivation. Each entry drops the client-only id.
        ...(labels !== null
          ? { labels: (labels ?? derivedDefaultLabels()).map(({ id, ...rest }) => rest) }
          : {}),
        ...header,
      };
      // EDIT MODE re-uses the existing job: upload only the re-picked slots
      // against that job id, then POST update-regenerate with the SAME body.
      // CREATE MODE: POST create-dossier to mint a fresh job, then upload.
      let targetJobId: number;
      if (isEditMode && editJobId != null) {
        targetJobId = editJobId;
        await uploadPickedImages(targetJobId, uploadedImages);
        await api.post(`/api/v1/bqms/deliveries/dossier-job/${editJobId}/update-regenerate`, body);
      } else {
        const r = await api.post<{ data: { job_id: number } }>('/api/v1/bqms/deliveries/create-dossier', body);
        targetJobId = r.data.job_id;
        await uploadPickedImages(targetJobId, uploadedImages);
      }
      setJobId(targetJobId);

      setSubmitted(true);
      setActiveTab('tonghop'); // surface the progress view on the Tổng hợp tab
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Lỗi tạo job');
      toast.error('Không thể tạo hồ sơ');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Tab-dot validation (derived from existing state) ──────────────
  const tabDots = useMemo<Record<TabId, DotState>>(() => {
    const h = header;
    // ① Thông tin chung — required header fields
    let general: DotState = 'untouched';
    if (h) {
      const reqFilled =
        !!h.vendor_invoice_no?.trim() && !!h.invoice_date && !!h.etd &&
        h.packing_qty > 0 && h.volume > 0 && h.gross_weight > 0;
      general = reqFilled ? 'complete' : (headerTouched ? 'attention' : 'untouched');
    }

    // ② Packing List — ◐ if any effective shipping_qty <= 0
    const anyZeroShip = items.some((it) => {
      const e = itemEdits[itemKey(it)] || {};
      return ((e.shipping_qty ?? it.shipping_qty) || 0) <= 0;
    });
    const packing: DotState = items.length === 0 ? 'untouched'
      : anyZeroShip ? 'attention' : 'complete';

    // ③ Cam kết HA — ◐ if any item missing "Thực tế" (actual) image;
    //    ○ if none uploaded; ● if every item has an actual image.
    const uploadedCount = Object.values(uploadedImages).filter((s) => s.actual).length;
    const missingActual = items.some((it) => !uploadedImages[itemKey(it)]?.actual);
    const camket: DotState = uploadedCount === 0 ? 'untouched'
      : missingActual ? 'attention' : 'complete';

    // ④ List Detail / ⑤ Label — auto-generated previews; ● when items exist
    const listdetail: DotState = items.length ? 'complete' : 'untouched';
    const label: DotState = itemsByPo.size ? 'complete' : 'untouched';

    // ⑥ Tổng hợp — summary, ready once we have items
    const tonghop: DotState = items.length ? 'complete' : 'untouched';

    return { general, packing, camket, listdetail, label, tonghop };
  }, [header, headerTouched, items, itemEdits, uploadedImages, itemsByPo]);

  // ─── Footer prev/next nav ──────────────────────────────────────
  const tabIndex = TAB_DEFS.findIndex((t) => t.id === activeTab);
  const goPrev = () => { if (tabIndex > 0) setActiveTab(TAB_DEFS[tabIndex - 1].id); };
  const goNext = () => { if (tabIndex < TAB_DEFS.length - 1) setActiveTab(TAB_DEFS[tabIndex + 1].id); };

  // ─── Render ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 mr-2" />
        <span className="text-slate-600">Đang tải dữ liệu hồ sơ...</span>
      </div>
    );
  }

  if (error && !header) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-10 text-center">
        <AlertCircle className="h-12 w-12 text-rose-500 mx-auto mb-3" />
        <p className="text-sm text-rose-700 mb-4">{error}</p>
        <button onClick={() => router.push('/bqms/deliveries')}
          className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-sm font-medium">
          Quay lại Giao hàng
        </button>
      </div>
    );
  }

  if (!header) return null;

  const totalShip = items.reduce((s, it) => {
    const e = itemEdits[itemKey(it)] || {};
    return s + ((e.shipping_qty ?? it.shipping_qty) || 0);
  }, 0);

  // StatStrip under the header — SEV / #PO / #mã / Tổng SL / Lần #N (repeat only)
  const stripItems: StatChip[] = [
    { label: 'Customer', value: sevType, tone: 'sky' },
    { label: 'PO', value: itemsByPo.size, divider: true },
    { label: 'Mã hàng', value: items.length, divider: true },
    { label: 'Tổng SL giao', value: totalShip.toLocaleString('vi-VN'), tone: 'emerald', emphasizeValue: true, divider: true },
    ...(isRepeat
      ? [{ label: 'Giao lần', value: `#${maxNextAttempt || 1}`, tone: 'amber' as const, pulse: true, divider: true }]
      : []),
  ];

  // CockpitTabs — dot prefix on each label
  const tabs: CockpitTab<TabId>[] = TAB_DEFS.map((t) => ({
    id: t.id,
    icon: t.icon,
    label: (
      <span className="inline-flex items-center gap-1.5">
        <DotIcon state={tabDots[t.id]} />
        {t.label}
      </span>
    ),
  }));

  const showProgress = submitted; // Tổng hợp tab swaps preview → progress once submitted

  return (
    <div className={cn(SHELL.page, '-m-6')}>
      {/* Sticky cockpit header */}
      <PageShellHeader
        title={isEditMode ? `Sửa Hồ Sơ Giao Hàng #${editJobId}` : 'Tạo Hồ Sơ Giao Hàng'}
        eyebrow={isEditMode ? `BQMS · Giao hàng · Đang sửa hồ sơ #${editJobId}` : 'BQMS · Giao hàng · 6 sheet Excel'}
        leading={
          <button
            onClick={() => router.push('/bqms/deliveries')}
            title="Quay lại Giao hàng"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </button>
        }
        actions={
          (activeTab === 'packing' || activeTab === 'camket') ? (
            <DensityToggle value={density} onChange={setDensity} />
          ) : undefined
        }
      />

      {/* Sticky stat strip */}
      <StatStrip items={stripItems} sticky />

      {/* Sticky tab rail just below the strip (header h-14 + strip h-11 = 6.25rem) */}
      <div className="sticky top-[6.25rem] z-20 bg-slate-50/95 backdrop-blur px-4 py-2">
        <CockpitTabs<TabId>
          tabs={tabs}
          value={activeTab}
          onChange={setActiveTab}
          layoutGroup="dossier-sheets"
        />
      </div>

      <div className={cn(SHELL.content, 'pt-4 pb-28')}>
        {/* EDIT MODE banner — persistent across tabs so it's always obvious */}
        {isEditMode && (
          <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
            <Pencil className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              <b className="font-semibold">Đang sửa hồ sơ #{editJobId}</b> — chỉnh các ô còn trống / sai
              rồi bấm <b className="font-semibold">Cập nhật &amp; tạo lại</b> ở tab Tổng hợp. Ảnh cũ được
              giữ nguyên, chỉ ô bạn thay mới được upload lại.
            </span>
          </div>
        )}

        {/* Repeat-PO history banner — only on tab ① and only when repeat */}
        {activeTab === 'general' && isRepeat && (
          <RepeatHistoryBanner
            deliveryHistory={deliveryHistory}
            nextAttemptByPo={nextAttemptByPo}
            className="mb-4"
          />
        )}

        {/* Active sheet body */}
        <DataPanel>
          {activeTab === 'general' && (
            <StepHeader
              header={header} setHeader={updateHeader}
              boxL={boxL} setBoxL={(v) => { setHeaderTouched(true); setBoxL(v); }}
              boxW={boxW} setBoxW={(v) => { setHeaderTouched(true); setBoxW(v); }}
              boxH={boxH} setBoxH={(v) => { setHeaderTouched(true); setBoxH(v); }}
              lastAttempt={lastAttempt}
              onReuse={lastAttempt ? handleReuseLast : undefined}
            />
          )}

          {activeTab === 'packing' && (
            <StepPackingList
              items={items} edits={itemEdits} onEdit={setItemEdit}
              defaultDims={{ l: boxL, w: boxW, h: boxH }}
              density={density} sevType={sevType}
              boxQtyTotalOverride={boxQtyTotalOverride}
              setBoxQtyTotalOverride={setBoxQtyTotalOverride}
            />
          )}

          {activeTab === 'camket' && (
            <StepCamKet
              itemsByPo={itemsByPo} edits={itemEdits} onEdit={setItemEdit}
              uploadedImages={uploadedImages} setUploadedImages={setUploadedImages}
              density={density} sevType={sevType} shippingDate={header.etd}
              existingImages={isEditMode ? existingImages : undefined}
            />
          )}

          {activeTab === 'listdetail' && (
            <StepListDetail items={items} edits={itemEdits} onEdit={setItemEdit} />
          )}

          {activeTab === 'label' && (
            <StepLabel
              edits={itemEdits} itemsByPo={itemsByPo}
              labels={labels} setLabels={setLabels}
              deriveDefaultLabels={derivedDefaultLabels}
            />
          )}

          {activeTab === 'tonghop' && !showProgress && (
            <StepTongHop items={items} edits={itemEdits} itemsByPo={itemsByPo} sevType={sevType} header={header} />
          )}

          {activeTab === 'tonghop' && showProgress && (
            <StepSubmit
              loading={submitting}
              job={job}
              error={error}
              onConfirm={handleConfirmDelivery}
              onCancel={handleCancelDelivery}
            />
          )}
        </DataPanel>
      </div>

      {/* Sticky footer nav */}
      <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]">
        <div className={cn(SHELL.content, 'flex h-16 items-center justify-between gap-3')}>
          <button onClick={() => router.push('/bqms/deliveries')} className={BUTTON.ghost}>
            <ChevronLeft className="h-4 w-4" /> Quay lại
          </button>

          <div className="flex items-center gap-2">
            <button onClick={goPrev} disabled={tabIndex === 0} className={BUTTON.secondary}>
              <ChevronLeft className="h-4 w-4" /> Tab trước
            </button>
            {activeTab !== 'tonghop' ? (
              <button onClick={goNext} className={BUTTON.secondary}>
                Tab sau <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              // On ⑥ Tổng hợp: primary export (unless already in progress view)
              !showProgress && (
                <button onClick={handleSubmit} disabled={submitting} className={BUTTON.primary}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {isEditMode ? 'Cập nhật & tạo lại' : 'Xuất hồ sơ'}
                </button>
              )
            )}
            {/* When the export finished/failed/cancelled — return shortcut */}
            {showProgress && (job?.status === 'done' || job?.status === 'failed' || job?.status === 'cancelled') && (
              <button onClick={() => router.push('/bqms/deliveries')} className={BUTTON.primary}>
                Quay lại Giao hàng
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Upload only the slots the user actually picked (Files in `uploadedImages`).
 * Each entry key IS the item_key string (po_number|po_seq|bqms_code) — the BE
 * reconstructs the identical key. In EDIT mode untouched slots have no File here
 * so their stored evidence on the BE is left intact (never re-uploaded). Used by
 * both the create and edit submit paths against whichever job id owns the slots.
 */
async function uploadPickedImages(
  jobId: number,
  uploadedImages: Record<string, { actual?: File; system?: File }>,
) {
  const uploads: Promise<any>[] = [];
  for (const [item_key, slots] of Object.entries(uploadedImages)) {
    // bqms_code = last segment of item_key (po|seq|code). The BE requires it
    // (and now also derives it from item_key); sending it explicitly satisfies
    // both. Forgetting it is what made every pasted Cam kết image 422 + vanish.
    const bqms_code = item_key.split('|').pop() || '';
    (['actual', 'system'] as const).forEach((slot) => {
      const file = slots[slot];
      if (!file) return;
      const fd = new FormData();
      fd.append('item_key', item_key);
      fd.append('bqms_code', bqms_code);
      fd.append('slot', slot);
      fd.append('file', file);
      uploads.push(api.upload(`/api/v1/bqms/deliveries/dossier-job/${jobId}/upload-image`, fd));
    });
  }
  if (uploads.length) {
    try { await Promise.all(uploads); }
    catch (e: any) {
      // Surface the real error (don't abort — the job is already created) — a
      // SILENT swallow here is exactly what hid the missing-bqms_code 422 and made
      // pasted images disappear from the Excel.
      console.error('Upload ảnh Cam kết thất bại:', e);
      toast.error(`Upload ảnh thất bại: ${e?.detail || e?.message || 'lỗi không rõ'}`);
    }
  }
}

/** Merge a last-attempt header snapshot onto a base header (only fields present). */
function mergeHeaderFromLast(base: DossierHeader, la: HeaderFromLastAttempt): DossierHeader {
  const next = { ...base };
  if (la.vendor_invoice_no != null) next.vendor_invoice_no = la.vendor_invoice_no;
  if (la.packing_qty != null) next.packing_qty = Number(la.packing_qty);
  if (la.packing_unit != null) next.packing_unit = la.packing_unit;
  if (la.volume != null) next.volume = Number(la.volume);
  if (la.volume_unit != null) next.volume_unit = la.volume_unit;
  if (la.gross_weight != null) next.gross_weight = Number(la.gross_weight);
  if (la.weight_unit != null) next.weight_unit = la.weight_unit;
  if (la.shipping_manager != null) next.shipping_manager = la.shipping_manager;
  if (la.remark != null) next.remark = la.remark;
  return next;
}

/** Apply box dims from last attempt into the L/W/H string inputs (if present). */
function applyBoxDimsFromLast(
  la: HeaderFromLastAttempt,
  setBoxL: (v: string) => void,
  setBoxW: (v: string) => void,
  setBoxH: (v: string) => void,
) {
  if (la.box_l != null) setBoxL(String(la.box_l));
  if (la.box_w != null) setBoxW(String(la.box_w));
  if (la.box_h != null) setBoxH(String(la.box_h));
}

// ─── Repeat-PO history banner (preserved from old Step 1) ────────────

function RepeatHistoryBanner({
  deliveryHistory, nextAttemptByPo, className,
}: {
  deliveryHistory: DeliveryHistoryEntry[];
  nextAttemptByPo: Record<string, number>;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border-2 border-amber-300 bg-amber-50 p-4', className)}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-200 flex items-center justify-center flex-shrink-0">
          <FileText className="h-5 w-5 text-amber-800" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-amber-900 mb-1">
            Đây không phải lần giao đầu tiên
          </div>
          <div className="text-sm text-amber-800 mb-3">
            Một số PO bạn chọn đã có hồ sơ giao trước đó. Hồ sơ mới sẽ được lưu
            riêng (folder mới với hậu tố <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">lan-N DD-MM</code>),
            không đè lên đợt cũ. Thông tin điền cũ được giữ lại để tiện chỉnh sửa.
          </div>
          <div className="space-y-2">
            {Array.from(new Set(deliveryHistory.map(h => h.po_number))).map(po => {
              const poHist = deliveryHistory.filter(h => h.po_number === po)
                .sort((a, b) => a.attempt_no - b.attempt_no);
              const nextN = nextAttemptByPo[po] || (poHist.length + 1);
              return (
                <div key={po} className="bg-white border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-bold text-slate-800">
                      PO {po}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                      Lần sắp tới: #{nextN}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {poHist.map(h => {
                      const totalQty = h.items.reduce((s, i) => s + (i.shipping_qty || 0), 0);
                      const dateStr = h.created_at
                        ? new Date(h.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '?';
                      return (
                        <div key={h.dossier_id} className="flex items-center gap-3 text-xs">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-200 text-amber-900 font-bold">
                            {h.attempt_no}
                          </span>
                          <span className="text-slate-600">{dateStr}</span>
                          <span className="font-mono text-slate-800">
                            {totalQty.toLocaleString('vi-VN')} pcs
                          </span>
                          {h.shipping_no && (
                            <span className="font-mono text-blue-700 truncate">
                              Ship#{h.shipping_no}
                            </span>
                          )}
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[11px] font-bold ml-auto',
                            h.status === 'done' ? 'bg-emerald-100 text-emerald-700'
                              : h.status === 'failed' ? 'bg-rose-100 text-rose-700'
                              : 'bg-slate-100 text-slate-600',
                          )}>
                            {h.status === 'done' ? '✓ Hoàn thành' : h.status}
                          </span>
                          {h.is_partial && (
                            <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-200 text-amber-900">
                              Partial
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
