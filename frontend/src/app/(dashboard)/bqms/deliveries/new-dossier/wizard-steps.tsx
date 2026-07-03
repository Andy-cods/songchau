'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Upload, Trash2, Image as ImageIcon, Package, FileText, Boxes,
  CheckCircle2, AlertCircle, Loader2, FolderOpen, FileSpreadsheet, Tag,
  ShieldAlert, XCircle, ShieldCheck, Ban,
  Clock, Camera, Hash, Maximize2, AlertTriangle, ImageOff,
  Info, RotateCcw, Lock, Copy, Download,
} from 'lucide-react';
import { cn, withToken } from '@/lib/utils';
import { TYPE } from '@/components/cockpit/tokens';
import { usePasteImage } from '@/lib/usePasteImage';
import {
  SHEET, SheetFrame, SheetTitle, SheetMeta, SheetHint,
  HeaderRow, Th, SpanTh, LabelCell, ReadCell, EditCell, NumCell,
  TotalRow, LabelBlock, evalCellFormula,
} from './sheet-kit';

// ─── Shared Types ────────────────────────────────────────────────

/**
 * Composite per-item key for Cam kết images.  bqms_code alone collides when the
 * same code appears on >1 Cam kết sheet (different PO / seq). The FE↔BE contract
 * keys `uploadedImages` and the evidence filename by this exact string; the BE
 * reconstructs the identical key from the posted item fields.
 */
export const itemKey = (it: { po_number: string; po_seq?: string | null; bqms_code: string }) =>
  `${it.po_number}|${it.po_seq ?? ''}|${it.bqms_code}`;

/** One editable Label "tem" block. null labels[] = use the derived per-PO default. */
export interface LabelEntry {
  id: string;
  po_number: string;
  pr_person: string;
  bqms_code: string;
  qty: number;
}

export interface DossierItem {
  delivery_id: number;
  po_number: string;
  po_seq: string;
  bqms_code: string;
  item_name: string;
  specification: string;
  unit: string;
  ordered_qty: number;
  remaining_qty: number;
  shipping_qty: number;
  dept: string;
  pr_person: string;
  receiver: string;
  dim_l: string;
  dim_w: string;
  dim_h: string;
  box_weight: number | null;  // per-row, may be blank (null) or a formula result
  packing_size: string;  // Packing Size MM (col N) — manual per-item
  box_qty: number | null;     // Box Qty (col O) — manual per-item, may be blank (null)
  has_system_image: boolean;
  system_image_url: string | null;
  rfq_number?: string | null;  // for system image lookup priority (per-RFQ override)
  has_history?: boolean;       // backend signals data was auto-prefilled from past job
  note?: string;               // client-side "Ghi chú" passthrough (List Detail tab)
}

export interface DossierHeader {
  vendor_invoice_no: string;
  invoice_date: string;
  etd: string;
  packing_qty: number;
  packing_unit: string;
  volume: number;
  volume_unit: string;
  gross_weight: number;
  weight_unit: string;
  shipping_manager: string;
  remark: string;
}

/**
 * Previous delivery's header snapshot — returned by dossier-prefill as
 * `header_from_last_attempt` when at least one selected PO is a repeat ship.
 * Lets the user "Dùng lại" (reuse) last attempt's header instead of retyping.
 * All fields optional — backend may omit any / the whole object.
 */
export interface HeaderFromLastAttempt {
  vendor_invoice_no?: string;
  packing_qty?: number;
  packing_unit?: string;
  volume?: number;
  volume_unit?: string;
  gross_weight?: number;
  weight_unit?: string;
  box_l?: string | number;
  box_w?: string | number;
  box_h?: string | number;
  shipping_manager?: string;
  remark?: string;
  /** Display-only metadata for the hint line. */
  attempt_no?: number;
  created_at?: string | null;
}

export interface DossierConfirmPreview {
  screenshot?: string;
  header?: Record<string, string | null>;
  items?: {
    po: string; seq?: string; code: string; deliveryQty: number; residualQty: number;
    poQty?: number | null; sumDeliveryQty?: number | null; itemImgYn?: string | null;
    itemType?: string | null; poDate?: string | null;
    category1?: string | null; category2?: string | null; category3?: string | null; category4?: string | null;
  }[];
  warnings?: string[];
}

export interface DossierJobStatus {
  id: number;
  status: 'queued' | 'running' | 'awaiting_confirm' | 'invoice_ready' | 'po_downloaded' | 'excel_built' | 'done' | 'failed' | 'cancelled';
  progress_pct: number;
  progress_step: string;
  error: string | null;
  output_folder: string | null;
  shipping_no: string | null;
  files: {
    excel?: string;
    delivery_note?: string;
    po_pdfs?: { po: string; path: string | null; status: string }[];
    warnings?: string[];
  } | null;
  // B3 concurrency UX fields (added 2026-05-18)
  queue_position?: number;
  eta_seconds?: number;
  heartbeat_age_seconds?: number;
  stuck_warning?: string;
  // Confirm checkpoint fields (added 2026-05-28)
  confirm_preview?: DossierConfirmPreview | null;
  confirm_image_url?: string;
  confirm_remaining_seconds?: number;
}

export const PACKING_UNITS = [
  'Bag', 'Set', 'Box', 'Piece', 'Carton', 'Drum', 'Pallet', 'Bottle',
] as const;

// ─── Shared form primitives ──────────────────────────────────────

export function Field({
  label, required, children, className, hint,
}: {
  label: string; required?: boolean; children: React.ReactNode; className?: string; hint?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
        {hint && <span className="ml-1 text-xs text-slate-400 font-normal">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** Number input with decimal-typing fix (avoids "1." → "1" bug). */
export function NumberInput({
  value, onChange, step, placeholder, className, disabled, title,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [local, setLocal] = useState<string>(() => (value === 0 ? '' : String(value)));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      const cur = parseFloat(local);
      if (isNaN(cur) || Math.abs(cur - value) > 1e-6) {
        setLocal(value === 0 ? '' : String(value));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      step={step}
      placeholder={placeholder}
      value={local}
      disabled={disabled}
      title={title}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const n = parseFloat(local);
        if (isNaN(n)) setLocal(value === 0 ? '' : String(value));
        else { onChange(n); setLocal(String(n)); }
      }}
      onChange={(e) => {
        const v = e.target.value;
        setLocal(v);
        if (v === '' || v === '-') onChange(0);
        else if (/^-?\d*\.?\d*$/.test(v)) {
          const n = parseFloat(v);
          if (!isNaN(n)) onChange(n);
        }
      }}
      className={cn(
        'w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors',
        className,
      )}
    />
  );
}

export function CellInput({
  value, onChange, placeholder, inputMode, className,
}: {
  value: string; onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'decimal' | 'numeric';
  className?: string;
}) {
  return (
    <input
      type="text" placeholder={placeholder} value={value}
      inputMode={inputMode}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'w-full px-2 py-1 text-xs border border-transparent rounded hover:border-slate-300 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-transparent',
        className,
      )}
    />
  );
}

export function CellNumber({
  value, onChange, step, placeholder, max, min, className, formula, allowBlank,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: string;
  placeholder?: string;
  max?: number; min?: number;
  className?: string;
  /** Accept arithmetic formulas (e.g. "2*3") — no mid-type restriction; evaluated on blur. */
  formula?: boolean;
  /** Permit an empty cell to emit null (blank) instead of coercing to 0. */
  allowBlank?: boolean;
}) {
  const fmt = (v: number | null) => (v == null || v === 0 ? '' : String(v));
  const [local, setLocal] = useState<string>(() => fmt(value));
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!focused) {
      const cur = parseFloat(local);
      // Resync local string when the external value diverges. Treat blank cell
      // (value == null) and empty local as already in sync.
      if (value == null) {
        if (local !== '') setLocal('');
      } else if (isNaN(cur) || Math.abs(cur - value) > 1e-6) {
        setLocal(fmt(value));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const clampEmit = (n: number) => {
    let c = n;
    if (max != null && c > max) c = max;
    if (min != null && c < min) c = min;
    onChange(c);
    setLocal(String(c));
  };

  // ── Formula mode: keep raw string; evaluate only on blur. ──
  if (formula) {
    return (
      <input
        type="text" inputMode="text" step={step} placeholder={placeholder}
        value={local}
        onFocus={() => { setFocused(true); setInvalid(false); }}
        onBlur={() => {
          setFocused(false);
          const r = evalCellFormula(local);
          if (r == null) {
            // blank input → emit null (allowBlank) or 0; non-blank → INVALID revert
            if (local.trim() === '') {
              if (allowBlank) { onChange(null); setLocal(''); }
              else { onChange(0); setLocal(''); }
              setInvalid(false);
            } else {
              setInvalid(true);
              setLocal(fmt(value)); // revert to last good value
            }
          } else {
            setInvalid(false);
            clampEmit(r); // show the evaluated value
          }
        }}
        onChange={(e) => { setLocal(e.target.value); if (invalid) setInvalid(false); }}
        className={cn(
          'w-full px-2 py-1 text-xs border border-transparent rounded hover:border-slate-300 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-transparent font-mono',
          invalid && 'bg-rose-50 text-rose-700',
          className,
        )}
      />
    );
  }

  return (
    <input
      type="text" inputMode="decimal" step={step} placeholder={placeholder}
      value={local}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (local.trim() === '' && allowBlank) { onChange(null); setLocal(''); return; }
        const n = parseFloat(local);
        if (isNaN(n)) setLocal(fmt(value));
        else clampEmit(n);
      }}
      onChange={(e) => {
        const v = e.target.value;
        setLocal(v);
        if (v === '' || v === '-') onChange(allowBlank ? null : 0);
        else if (/^-?\d*\.?\d*$/.test(v)) {
          const n = parseFloat(v);
          if (!isNaN(n)) onChange(n);
        }
      }}
      className={cn(
        'w-full px-2 py-1 text-xs border border-transparent rounded hover:border-slate-300 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-transparent font-mono',
        className,
      )}
    />
  );
}

// ─── Step 1: Thông tin chung ─────────────────────────────────────

export function StepHeader({
  header, setHeader, boxL, setBoxL, boxW, setBoxW, boxH, setBoxH,
  lastAttempt, onReuse,
}: {
  header: DossierHeader;
  setHeader: (h: DossierHeader) => void;
  boxL: string; setBoxL: (v: string) => void;
  boxW: string; setBoxW: (v: string) => void;
  boxH: string; setBoxH: (v: string) => void;
  /** Previous attempt's header for the "Dùng lại" reuse hint (repeat PO). */
  lastAttempt?: HeaderFromLastAttempt | null;
  /** Apply lastAttempt values to header + box dims. */
  onReuse?: () => void;
}) {
  const upd = (k: keyof DossierHeader, v: any) => setHeader({ ...header, [k]: v });

  useEffect(() => {
    const l = parseFloat(boxL), w = parseFloat(boxW), h = parseFloat(boxH);
    if (l > 0 && w > 0 && h > 0) {
      const vol = (l * w * h) / 1_000_000_000;
      const rounded = Math.round(vol * 10000) / 10000;
      setHeader({ ...header, volume: rounded });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxL, boxW, boxH]);

  const dimsValid = (parseFloat(boxL) || 0) > 0 && (parseFloat(boxW) || 0) > 0 && (parseFloat(boxH) || 0) > 0;

  // Compact "reuse last attempt" hint — only when backend returned a snapshot.
  const reuseDate = lastAttempt?.created_at
    ? new Date(lastAttempt.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
    : null;
  const reuseVol = lastAttempt?.volume != null ? Number(lastAttempt.volume) : null;

  return (
    <div className="space-y-5">
      {/* Top sky hint — this is the delivery header, not a printed sheet. */}
      <SheetHint
        icon={<Info className="h-4 w-4 text-sky-600" />}
        title="Trang này KHÔNG in ra Excel"
      >
        Đây là thông tin giao hàng dùng để tạo Delivery trên Samsung (Phần 2).
        Điền xong sang tab "Packing List".
      </SheetHint>

      {lastAttempt && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 ring-1 ring-inset ring-sky-200 px-3 py-2 text-xs text-sky-800">
          <Info className="h-4 w-4 shrink-0 text-sky-600" />
          <span className="font-semibold">
            Lần #{lastAttempt.attempt_no ?? '?'}{reuseDate ? ` (${reuseDate})` : ''}:
          </span>
          <span className="text-sky-700">
            Invoice <b className="font-mono">{lastAttempt.vendor_invoice_no || '—'}</b>
            {reuseVol != null && <> · vol <b className="font-mono">{reuseVol.toFixed(4)}</b> m³</>}
            {lastAttempt.gross_weight != null && <> · <b className="font-mono">{lastAttempt.gross_weight}</b> KG</>}
          </span>
          {onReuse && (
            <button
              type="button"
              onClick={onReuse}
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-300 hover:bg-sky-100 transition-colors"
            >
              <RotateCcw className="h-3 w-3" /> Dùng lại
            </button>
          )}
        </div>
      )}

      {/* ── INVOICE & SHIPPING ── */}
      <section>
        <div className={cn(TYPE.eyebrow, 'mb-2.5')}>Invoice &amp; Shipping</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Vendor Invoice No" required>
            <input type="text" value={header.vendor_invoice_no}
              onChange={(e) => upd('vendor_invoice_no', e.target.value)}
              className={HDR_INPUT} />
          </Field>
          <Field label="Invoice Date" required>
            <input type="date" value={header.invoice_date}
              onChange={(e) => upd('invoice_date', e.target.value)}
              className={HDR_INPUT} />
          </Field>
          <Field label="ETD (Ngày giao)" required>
            <input type="date" value={header.etd}
              onChange={(e) => upd('etd', e.target.value)}
              className={HDR_INPUT} />
          </Field>
          <Field label="Shipping Manager">
            <input type="text" value={header.shipping_manager}
              onChange={(e) => upd('shipping_manager', e.target.value)}
              className={HDR_INPUT} />
          </Field>
          <Field label="Remark" className="col-span-2">
            <input type="text" value={header.remark}
              onChange={(e) => upd('remark', e.target.value)}
              className={HDR_INPUT} />
          </Field>
        </div>
      </section>

      {/* ── PACKING & BOX ── */}
      <section className="border-t border-slate-200 pt-4">
        <div className={cn(TYPE.eyebrow, 'mb-2.5')}>Packing &amp; Box</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Packing Qty" required>
            <div className="flex">
              <NumberInput value={header.packing_qty} onChange={(v) => upd('packing_qty', v)} step="0.01"
                className="flex-1 rounded-r-none" />
              <select value={header.packing_unit} onChange={(e) => upd('packing_unit', e.target.value)}
                className="px-2 border border-l-0 border-slate-200 rounded-r-lg text-sm focus:ring-2 focus:ring-brand-500 bg-slate-50 text-slate-600">
                {PACKING_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Volume" required hint="auto L×W×H">
            <div className="flex">
              <NumberInput value={header.volume} onChange={(v) => upd('volume', v)} step="0.0001"
                className={cn('flex-1 rounded-r-none', dimsValid && 'bg-emerald-50 border-emerald-300')}
                title={dimsValid ? 'Auto-tính từ L × W × H' : ''} />
              <span className={LOCKED_UNIT}><Lock className="h-3 w-3" /> M³</span>
            </div>
          </Field>
          <Field label="Gross Weight" required>
            <div className="flex">
              <NumberInput value={header.gross_weight} onChange={(v) => upd('gross_weight', v)} step="0.01"
                className="flex-1 rounded-r-none" />
              <span className={LOCKED_UNIT}><Lock className="h-3 w-3" /> KG</span>
            </div>
          </Field>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-3 items-end">
          <Field label="Box L (mm)">
            <input type="text" inputMode="decimal" placeholder="vd 500" value={boxL}
              onChange={(e) => setBoxL(e.target.value)} className={HDR_INPUT} />
          </Field>
          <Field label="Box W (mm)">
            <input type="text" inputMode="decimal" placeholder="vd 400" value={boxW}
              onChange={(e) => setBoxW(e.target.value)} className={HDR_INPUT} />
          </Field>
          <Field label="Box H (mm)">
            <input type="text" inputMode="decimal" placeholder="vd 300" value={boxH}
              onChange={(e) => setBoxH(e.target.value)} className={HDR_INPUT} />
          </Field>
          <div className="pb-2.5 text-sm text-slate-600">
            = <span className="font-mono font-bold text-brand-700 text-base">{dimsValid ? header.volume.toFixed(4) : '–'}</span> m³
          </div>
        </div>
        {!dimsValid && (
          <p className="text-[11px] text-slate-500 mt-2">
            Điền cả 3 cạnh L × W × H → Volume tự tính. Hoặc nhập Volume trực tiếp ở trên.
          </p>
        )}
      </section>
    </div>
  );
}

const HDR_INPUT =
  'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500';
const LOCKED_UNIT =
  'inline-flex items-center gap-1 px-2 border border-l-0 border-slate-200 rounded-r-lg ' +
  'bg-slate-100 text-slate-500 text-xs font-medium';

// ─── Step 2: Packing List ────────────────────────────────────────

export function StepPackingList({
  items, edits, onEdit, defaultDims, density = 'compact', sevType = 'SEV',
  boxQtyTotalOverride, setBoxQtyTotalOverride,
}: {
  items: DossierItem[];
  edits: Record<string, Partial<DossierItem>>;
  onEdit: (code: string, key: keyof DossierItem, v: any) => void;
  defaultDims?: { l: string; w: string; h: string };
  density?: 'comfortable' | 'compact';
  sevType?: 'SEV' | 'SEVT';
  /** PRINT-ONLY Box-Qty TOTAL override. null = show computed sum.
   *  Does NOT rescale per-row box_qty. */
  boxQtyTotalOverride: number | null;
  setBoxQtyTotalOverride: (v: number | null) => void;
}) {
  const dl = defaultDims?.l || '';
  const dw = defaultDims?.w || '';
  const dh = defaultDims?.h || '';
  const hasDefaults = !!(dl || dw || dh);
  // Compact = tighter vertical padding (Thang's "Gọn").
  const padY = density === 'compact' ? 'py-1' : 'py-1.5';

  // Totals (Box Weight · Box Qty · Qty)
  const totBoxWt = items.reduce((s, it) => s + ((edits[itemKey(it)]?.box_weight ?? it.box_weight) || 0), 0);
  const totBoxQty = items.reduce((s, it) => s + ((edits[itemKey(it)]?.box_qty ?? it.box_qty) || 0), 0);
  const totQty = items.reduce((s, it) => s + ((edits[itemKey(it)]?.shipping_qty ?? it.shipping_qty) || 0), 0);

  // Sticky-left freeze: STT anchors the wide grid on horizontal scroll.
  const freeze = ELEVATION_FREEZE;

  return (
    <div className="space-y-3">
      <SheetHint
        icon={<Package className="h-4 w-4 text-sky-600" />}
        title='Sheet "packing list" — bảng kê chi tiết hàng giao'
      >
        <strong>Qty</strong> mặc định = SL còn lại, chỉnh nếu giao một phần.
        {hasDefaults && (
          <> <strong>L×W×H</strong> tự lấy từ Thông tin chung ({dl || '?'}×{dw || '?'}×{dh || '?'} mm) — chỉnh nếu mã có kích thước riêng.</>
        )}
      </SheetHint>

      <SheetFrame scroll minW="min-w-[1560px]">
        <SheetMeta rows={[
          { label: 'VENDOR NAME', value: 'AMA BẮC NINH JSC' },
          { label: 'CUSTOMER', value: sevType },
        ]} />
        <SheetTitle>Packing List</SheetTitle>
        <table className={SHEET.table}>
          <thead>
            {/* Row 1 — most headers rowSpan 2; DIMENSION (MM) spans L|W|H */}
            <HeaderRow>
              <Th align="center" w="w-10" rowSpan={2} sticky={cn('left-0 z-20', freeze)}>STT</Th>
              <Th w="w-20" rowSpan={2}>Dept.</Th>
              <Th w="w-28" rowSpan={2}>PR Person</Th>
              <Th w="w-28" rowSpan={2}>SEV PO No</Th>
              <Th w="w-32" rowSpan={2}>BQMS Code</Th>
              <Th w="w-40" rowSpan={2}>Item Name</Th>
              <Th w="w-48" rowSpan={2}>Specification</Th>
              <Th align="center" w="w-14" rowSpan={2}>Unit</Th>
              <Th align="right" w="w-24" rowSpan={2}>Box Weight (KGS)</Th>
              <SpanTh caption="Dimension (MM)" colSpan={3} />
              <Th align="center" w="w-24" rowSpan={2}>Packing Size (MM)</Th>
              <Th align="right" w="w-16" rowSpan={2}>Box Qty</Th>
              <Th align="right" w="w-24" rowSpan={2}>Qty</Th>
            </HeaderRow>
            {/* Row 2 — the L | W | H sub-columns under DIMENSION (MM) */}
            <HeaderRow>
              <Th align="center" w="w-20">L</Th>
              <Th align="center" w="w-20">W</Th>
              <Th align="center" w="w-20">H</Th>
            </HeaderRow>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const k = itemKey(it);
              const e = edits[k] || {};
              const effShip = (e.shipping_qty ?? it.shipping_qty) || 0;
              const overShip = effShip !== it.remaining_qty;
              const dimL = String(e.dim_l ?? it.dim_l ?? '');
              const dimW = String(e.dim_w ?? it.dim_w ?? '');
              const dimH = String(e.dim_h ?? it.dim_h ?? '');
              // Box Weight + Box Qty are independent per-row and may be blank
              // (null). Do NOT coerce to 0/1 here — let the cell render blank.
              const boxWt = e.box_weight ?? it.box_weight;
              const boxQty = e.box_qty ?? it.box_qty;
              return (
                <tr key={k} className="group">
                  <ReadCell align="center" sticky={cn('left-0 z-10', freeze)} className={cn('text-slate-400', padY)}>{idx + 1}</ReadCell>
                  <EditCell value={(e.dept ?? it.dept) || ''} onChange={(v) => onEdit(k, 'dept', v)}
                    placeholder="—" dirty={e.dept != null && e.dept !== it.dept} />
                  <EditCell value={(e.pr_person ?? it.pr_person) || ''} onChange={(v) => onEdit(k, 'pr_person', v)}
                    placeholder="—" dirty={e.pr_person != null && e.pr_person !== it.pr_person} />
                  <ReadCell code className={padY}>{it.po_number}</ReadCell>
                  <ReadCell code className={padY}>
                    {it.bqms_code}
                    {it.has_history && (
                      <span className="ml-1 text-[11px] px-1 py-0.5 rounded bg-brand-100 text-brand-700 font-mono uppercase" title="Đã tự fill từ hồ sơ trước">↻</span>
                    )}
                  </ReadCell>
                  <ReadCell className={padY}>{e.item_name ?? it.item_name}</ReadCell>
                  <ReadCell className={padY}>{e.specification ?? it.specification}</ReadCell>
                  <EditCell value={(e.unit ?? it.unit) || ''} onChange={(v) => onEdit(k, 'unit', v)}
                    placeholder="—" align="center" dirty={e.unit != null && e.unit !== it.unit} />
                  <NumCell value={boxWt} onChange={(v) => onEdit(k, 'box_weight', v)}
                    formula allowBlank
                    step="0.001" placeholder="0 / vd 2*3" dirty={e.box_weight != null && e.box_weight !== it.box_weight} />
                  <EditCell value={dimL} onChange={(v) => onEdit(k, 'dim_l', v)}
                    placeholder={dl || 'L'} align="center" inputMode="decimal"
                    dirty={dimL === '' && !!dl ? false : e.dim_l != null && e.dim_l !== it.dim_l} />
                  <EditCell value={dimW} onChange={(v) => onEdit(k, 'dim_w', v)}
                    placeholder={dw || 'W'} align="center" inputMode="decimal"
                    dirty={dimW === '' && !!dw ? false : e.dim_w != null && e.dim_w !== it.dim_w} />
                  <EditCell value={dimH} onChange={(v) => onEdit(k, 'dim_h', v)}
                    placeholder={dh || 'H'} align="center" inputMode="decimal"
                    dirty={dimH === '' && !!dh ? false : e.dim_h != null && e.dim_h !== it.dim_h} />
                  <EditCell value={String(e.packing_size ?? it.packing_size ?? '')}
                    onChange={(v) => onEdit(k, 'packing_size', v)}
                    placeholder="vd 600x400" align="center"
                    dirty={e.packing_size != null && e.packing_size !== it.packing_size} />
                  <NumCell value={boxQty} onChange={(v) => onEdit(k, 'box_qty', v)}
                    allowBlank min={0} step="1" placeholder="—"
                    dirty={e.box_qty != null && e.box_qty !== it.box_qty} />
                  <td className={cn(SHEET.editCell, overShip && SHEET.editDirty)}>
                    <CellNumber value={effShip} onChange={(v) => onEdit(k, 'shipping_qty', v)}
                      max={it.remaining_qty} min={0}
                      className={cn('px-2 py-1.5 text-right tabular-nums font-semibold hover:border-transparent focus:ring-0 rounded-none',
                        overShip ? 'text-amber-700' : 'text-brand-700')} />
                    <div className="px-2 pb-1 -mt-0.5 text-right text-[11px] font-mono text-slate-400">
                      còn {it.remaining_qty.toLocaleString('vi-VN')}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <TotalRow>
            <td className={SHEET.totalLabel} colSpan={8}>TOTAL</td>
            <td className={SHEET.totalNum}>{totBoxWt.toLocaleString('vi-VN', { maximumFractionDigits: 3 })}</td>
            <td className={SHEET.totalNum} colSpan={4}></td>
            {/* Box-Qty TOTAL — EDITABLE override (PRINT-ONLY; does NOT rescale
                per-row box_qty). null override → show computed sum. */}
            <td className={cn(
              SHEET.editCell, 'bg-slate-50',
              boxQtyTotalOverride != null && boxQtyTotalOverride !== totBoxQty && SHEET.editDirty,
            )}>
              <CellNumber
                value={boxQtyTotalOverride ?? totBoxQty}
                onChange={(v) => setBoxQtyTotalOverride((v == null || v === totBoxQty || v <= 0) ? null : v)}
                min={0} step="1" placeholder={String(totBoxQty)}
                className="px-2 py-1.5 text-right tabular-nums font-bold text-slate-800 hover:border-transparent focus:ring-0 rounded-none bg-transparent"
              />
            </td>
            <td className={SHEET.totalNumBrand}>{totQty.toLocaleString('vi-VN')}</td>
          </TotalRow>
        </table>
      </SheetFrame>
    </div>
  );
}

// Freeze-column shadow (ELEVATION.freezeCol from tokens) for sticky-left cells.
const ELEVATION_FREEZE = 'shadow-[6px_0_8px_-6px_rgba(15,23,42,0.12)]';

// ─── Step 3: Cam kết hình ảnh ────────────────────────────────────

export function StepCamKet({
  itemsByPo, edits, onEdit, uploadedImages, setUploadedImages, density = 'compact',
  sevType = 'SEV', shippingDate = '', existingImages,
}: {
  itemsByPo: Map<string, DossierItem[]>;
  edits: Record<string, Partial<DossierItem>>;
  onEdit: (code: string, key: keyof DossierItem, v: any) => void;
  uploadedImages: Record<string, { actual?: File; system?: File }>;
  setUploadedImages: (v: Record<string, { actual?: File; system?: File }>) => void;
  /** Reserved for density parity with other sheets (compact = Gọn). */
  density?: 'comfortable' | 'compact';
  sevType?: 'SEV' | 'SEVT';
  shippingDate?: string;
  /**
   * EDIT MODE — stored evidence URLs keyed by `${itemKey}|${slot}`. When set,
   * each slot (system AND actual) shows the existing image as a fallback;
   * a freshly-picked File still wins. Undefined in create mode.
   */
  existingImages?: Record<string, string>;
}) {
  void density; // structure is card-based (no wide scroll); kept for API parity
  return (
    <div className="space-y-4">
      <SheetHint
        icon={<ImageIcon className="h-4 w-4 text-sky-600" />}
        title={`Sheet "Cam kết hình ảnh (${itemsByPo.size})" — 1 sheet riêng cho mỗi PO`}
      >
        Mỗi PO có 2 ảnh: <strong>Hệ thống</strong> (tự lấy từ kho RFQ, có thể đổi) và{' '}
        <strong>Thực tế</strong> (chụp ảnh hàng thật). Click vào ô ảnh rồi <strong>Ctrl+V</strong> để dán ảnh.
        Các field text đều editable.
      </SheetHint>

      {Array.from(itemsByPo.entries()).map(([poNumber, poItems], poIdx) => (
        <CamKetCard
          key={poNumber}
          poNumber={poNumber}
          poIdx={poIdx}
          items={poItems}
          edits={edits}
          onEdit={onEdit}
          uploadedImages={uploadedImages}
          setUploadedImages={setUploadedImages}
          sevType={sevType}
          shippingDate={shippingDate}
          existingImages={existingImages}
        />
      ))}
    </div>
  );
}

/** One PO's "CAM KẾT HÌNH ẢNH" sheet — a 2-col label/value table with a dual
 *  image row and the fixed commitment footer. Replaces the old 12-col form. */
function CamKetCard({
  poNumber, poIdx, items, edits, onEdit, uploadedImages, setUploadedImages,
  sevType, shippingDate, existingImages,
}: {
  poNumber: string;
  poIdx: number;
  items: DossierItem[];
  edits: Record<string, Partial<DossierItem>>;
  onEdit: (code: string, key: keyof DossierItem, v: any) => void;
  uploadedImages: Record<string, { actual?: File; system?: File }>;
  setUploadedImages: (v: Record<string, { actual?: File; system?: File }>) => void;
  sevType: 'SEV' | 'SEVT';
  shippingDate: string;
  /** EDIT MODE stored-evidence URLs keyed by `${itemKey}|${slot}`. */
  existingImages?: Record<string, string>;
}) {
  // The PO-level editable fields (Dept / PR PIC / Receiver) live on the first
  // item — onEdit fans the value out to every item in this PO so the submit
  // payload (which is per-item) stays consistent.
  const head = items[0];
  const headEdit = edits[itemKey(head)] || {};
  const setPoField = (key: keyof DossierItem, v: any) => {
    for (const it of items) onEdit(itemKey(it), key, v);
  };

  return (
    <SheetFrame>
      <SheetTitle>Cam kết hình ảnh{items.length > 1 ? ` (${poIdx + 1})` : ''}</SheetTitle>
      <table className={SHEET.table}>
        <colgroup>
          <col className="w-56" />
          <col />
        </colgroup>
        <tbody>
          {/* Identity / contacts */}
          <tr>
            <LabelCell>Customer</LabelCell>
            <ReadCell>{sevType}</ReadCell>
          </tr>
          <tr>
            <LabelCell>Vendor Name</LabelCell>
            <ReadCell>AMA Bắc Ninh JSC</ReadCell>
          </tr>
          <tr>
            <LabelCell>Department</LabelCell>
            <EditCell value={(headEdit.dept ?? head.dept) || ''} onChange={(v) => setPoField('dept', v)}
              placeholder="vd MAIN" dirty={headEdit.dept != null && headEdit.dept !== head.dept} />
          </tr>
          <tr>
            <LabelCell>PR PIC</LabelCell>
            <EditCell value={(headEdit.pr_person ?? head.pr_person) || ''} onChange={(v) => setPoField('pr_person', v)}
              placeholder="Người yêu cầu" dirty={headEdit.pr_person != null && headEdit.pr_person !== head.pr_person} />
          </tr>
          <tr>
            <LabelCell>Receiver (Ký đầy đủ thông tin: Họ tên, Gen, Bộ phận..)</LabelCell>
            <EditCell value={(headEdit.receiver ?? head.receiver) || ''} onChange={(v) => setPoField('receiver', v)}
              placeholder="Họ tên, Gen, Bộ phận…" dirty={headEdit.receiver != null && headEdit.receiver !== head.receiver} />
          </tr>

          {/* Dual image row — one Hệ thống + Thực tế per item in this PO */}
          {items.map((it, i) => {
            const k = itemKey(it);
            return (
            <tr key={`img-${k}`}>
              {i === 0 && <LabelCell rowSpan={items.length} className="align-middle">Hình ảnh</LabelCell>}
              <td className={cn(SHEET.readCell, 'p-2')}>
                {items.length > 1 && (
                  <div className="mb-1.5 text-[11px] font-mono text-slate-500">{it.bqms_code}</div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <ImageSlot label="Hệ thống" sublabel="auto-track từ BQMS"
                    existingUrl={
                      // EDIT MODE: prefer the evidence already stored on the job;
                      // else fall back to the live BQMS auto-track URL.
                      existingImages?.[`${k}|system`]
                        ?? (it.has_system_image ? it.system_image_url : null)
                    }
                    overrideFile={uploadedImages[k]?.system}
                    onUpload={(f) => setUploadedImages({
                      ...uploadedImages,
                      [k]: { ...uploadedImages[k], system: f },
                    })}
                    onRemove={() => {
                      const next = { ...uploadedImages };
                      if (next[k]) delete next[k].system;
                      setUploadedImages(next);
                    }}
                    color="blue"
                    emptyTitle="Mã chưa có ảnh trong hệ thống BQMS"
                    emptyHint="Click, kéo thả hoặc dán ảnh — hoặc pin ảnh cho mã này ở trang BQMS"
                    emptyKind="system" />
                  <ImageSlot label="Thực tế" sublabel="user upload"
                    existingUrl={existingImages?.[`${k}|actual`] ?? null}
                    overrideFile={uploadedImages[k]?.actual}
                    onUpload={(f) => setUploadedImages({
                      ...uploadedImages,
                      [k]: { ...uploadedImages[k], actual: f },
                    })}
                    onRemove={() => {
                      const next = { ...uploadedImages };
                      if (next[k]) delete next[k].actual;
                      setUploadedImages(next);
                    }}
                    color="emerald" />
                </div>
              </td>
            </tr>
            );
          })}

          {/* Read-only sheet identity (one block per item in the PO) */}
          <tr>
            <LabelCell>Shipping No / Invoice No</LabelCell>
            <ReadCell className="text-slate-400 italic">— (từ Samsung Phần 2)</ReadCell>
          </tr>
          <tr>
            <LabelCell>PO No</LabelCell>
            <ReadCell code>{poNumber}</ReadCell>
          </tr>
          {items.map((it) => {
            const e = edits[itemKey(it)] || {};
            const effShip = (e.shipping_qty ?? it.shipping_qty) || 0;
            return (
              <CamKetItemRows key={`rows-${itemKey(it)}`}
                multi={items.length > 1}
                bqmsCode={it.bqms_code}
                itemName={e.item_name ?? it.item_name}
                specification={e.specification ?? it.specification}
                qty={effShip}
                unit={e.unit ?? it.unit}
                shippingDate={shippingDate}
              />
            );
          })}
        </tbody>
      </table>

      {/* Fixed commitment footer (read-only, exact text) */}
      <div className="bg-slate-50 border-t border-slate-200 px-3 py-2.5 text-[11px] italic text-slate-600 leading-relaxed">
        Vendor AMA Bắc Ninh xin cam kết hàng thực tế và hình ảnh đính kèm hoàn toàn đúng so với
        Code và Specification mà SEVT tạo Code trên hệ thống. Nếu sai vendor xin chịu hoàn toàn trách nhiệm.
      </div>
    </SheetFrame>
  );
}

/** The per-code read-only rows (BQMS Code … Shipping date) inside a cam-kết card. */
function CamKetItemRows({
  multi, bqmsCode, itemName, specification, qty, unit, shippingDate,
}: {
  multi: boolean;
  bqmsCode: string;
  itemName: string;
  specification: string;
  qty: number;
  unit: string;
  shippingDate: string;
}) {
  return (
    <>
      {multi && (
        <tr>
          <LabelCell colSpan={2} className="bg-slate-100 text-slate-500 text-[11px] font-mono">{bqmsCode}</LabelCell>
        </tr>
      )}
      <tr>
        <LabelCell>BQMS Code</LabelCell>
        <ReadCell code>{bqmsCode}</ReadCell>
      </tr>
      <tr>
        <LabelCell>Item Name</LabelCell>
        <ReadCell>{itemName}</ReadCell>
      </tr>
      <tr>
        <LabelCell>Specification</LabelCell>
        <ReadCell>{specification}</ReadCell>
      </tr>
      <tr>
        <LabelCell>Quantity</LabelCell>
        <ReadCell num>{qty.toLocaleString('vi-VN')} <span className="text-slate-400">{unit}</span></ReadCell>
      </tr>
      <tr>
        <LabelCell>Shipping date</LabelCell>
        <ReadCell>{shippingDate || '—'}</ReadCell>
      </tr>
    </>
  );
}

function ImageSlot({
  label, sublabel, existingUrl, overrideFile, onUpload, onRemove, color,
  emptyTitle, emptyHint, emptyKind,
}: {
  label: string;
  sublabel?: string;
  existingUrl: string | null;
  overrideFile?: File;
  onUpload: (f: File) => void;
  onRemove: () => void;
  color: 'blue' | 'emerald';
  // Thang 2026-06-02: tuỳ biến message khi không có ảnh sẵn — slot "Hệ thống"
  // hiện thông báo cụ thể "mã chưa có ảnh BQMS" thay vì generic upload box.
  emptyTitle?: string;
  emptyHint?: string;
  emptyKind?: 'system' | 'default';
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  // Clipboard PASTE target — scoped to THIS slot's container so one Ctrl+V only
  // fills the focused slot (see usePasteImage scoping note). The pasted File
  // enters the SAME onUpload path as click/drop (no new upload call).
  const slotRef = useRef<HTMLDivElement>(null);
  usePasteImage(slotRef, onUpload, { enabled: true });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Thang 2026-06-01: auto-retry 1.8s + ImageOff fallback giống BqmsImageThumb.
  // Lý do: P2 layer (_CODE_OVERRIDE_ROOT) đôi khi cần inline-indexer warm 1-2s.
  const [imgError, setImgError] = useState(false);
  const [bustKey, setBustKey] = useState(0);
  const retriedRef = useRef(false);

  useEffect(() => {
    if (overrideFile) {
      const url = URL.createObjectURL(overrideFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else setPreviewUrl(null);
  }, [overrideFile]);

  // Reset error state khi existingUrl đổi (vd: chọn delivery khác → URL khác)
  useEffect(() => {
    setImgError(false);
    retriedRef.current = false;
    setBustKey((k) => k + 1);
  }, [existingUrl]);

  const handleImageError = () => {
    if (!retriedRef.current && existingUrl) {
      retriedRef.current = true;
      setTimeout(() => {
        setBustKey((k) => k + 1);
        setImgError(false);
      }, 1800);
    } else {
      setImgError(true);
    }
  };

  // Wrap existingUrl với withToken + cache-bust để re-fetch sau retry
  const finalUrl = previewUrl
    ? previewUrl
    : existingUrl
    ? withToken(existingUrl) + (existingUrl.includes('?') ? '&' : '?') + `_b=${bustKey}`
    : null;

  const showUrl = !imgError ? finalUrl : null;
  const isOverride = !!overrideFile;
  const cMap = {
    blue: { border: 'border-blue-300', bg: 'bg-blue-50/60', label: 'text-blue-700', dragOver: 'border-blue-500 bg-blue-100' },
    emerald: { border: 'border-emerald-300', bg: 'bg-emerald-50/60', label: 'text-emerald-700', dragOver: 'border-emerald-500 bg-emerald-100' },
  };
  const c = cMap[color];

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && /^image\/(png|jpe?g)$/i.test(f.type)) onUpload(f);
  };

  return (
    <div ref={slotRef} tabIndex={0}
      className={cn('border-2 border-dashed rounded-lg p-2 transition-all outline-none',
        'focus:ring-2 focus:ring-brand-500 focus:ring-offset-1',
        dragOver ? c.dragOver : c.border + ' ' + c.bg)}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className={cn('text-[11px] font-bold uppercase tracking-wide', c.label)}>{label}</div>
        {sublabel && <div className="text-[11px] text-slate-500 italic">{sublabel}</div>}
      </div>
      {showUrl ? (
        <div className="relative group">
          <img
            src={showUrl}
            alt={label}
            onError={!previewUrl ? handleImageError : undefined}
            className="w-full h-40 object-contain rounded-md bg-white border border-slate-200"
          />
          {isOverride && (
            <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500 text-white shadow">Đã thay</div>
          )}
          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" onClick={() => fileRef.current?.click()}
              className="p-1.5 rounded-md bg-white/95 hover:bg-white shadow text-slate-700 hover:text-brand-700" title="Đổi ảnh khác">
              <Upload className="h-3.5 w-3.5" />
            </button>
            {isOverride && (
              <button type="button" onClick={onRemove}
                className="p-1.5 rounded-md bg-white/95 hover:bg-rose-50 shadow text-rose-600" title="Bỏ ảnh thay">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      ) : imgError && existingUrl && !overrideFile ? (
        <button type="button" onClick={() => fileRef.current?.click()}
          className="relative w-full h-40 flex flex-col items-center justify-center text-slate-500 transition-colors border-2 border-dashed border-amber-300 rounded-md bg-amber-50/40 hover:bg-amber-50">
          <ImageOff className="h-7 w-7 mb-1 text-amber-500" />
          <span className="text-xs font-semibold text-amber-700">Không tải được ảnh hệ thống</span>
          <span className="text-[11px] text-amber-600 mt-0.5 text-center px-2">Click để upload ảnh thay</span>
        </button>
      ) : emptyKind === 'system' ? (
        <button type="button" onClick={() => fileRef.current?.click()}
          className="relative w-full h-40 flex flex-col items-center justify-center text-slate-500 transition-colors border-2 border-dashed border-sky-300 rounded-md bg-sky-50/50 hover:bg-sky-50 hover:border-sky-400 px-3">
          <div className="h-10 w-10 rounded-xl bg-sky-50 ring-1 ring-sky-200 flex items-center justify-center mb-1.5">
            <ImageOff className="h-5 w-5 text-sky-500" />
          </div>
          <span className="text-xs font-bold text-sky-800 text-center leading-tight">
            {emptyTitle ?? 'Chưa có ảnh hệ thống'}
          </span>
          <span className="text-[11px] text-sky-600 mt-1 text-center leading-tight">
            {emptyHint ?? 'Click để upload'}
          </span>
        </button>
      ) : (
        <button type="button" onClick={() => fileRef.current?.click()}
          className="w-full h-40 flex flex-col items-center justify-center text-slate-400 hover:text-slate-600 transition-colors border-2 border-dashed border-slate-200 rounded-md bg-white/40 hover:bg-white">
          <Upload className="h-7 w-7 mb-1" />
          <span className="text-xs font-medium">{emptyTitle ?? 'Click, kéo thả hoặc dán ảnh'}</span>
          <span className="text-[11px] text-slate-400 mt-0.5">{emptyHint ?? 'PNG hoặc JPG, max 5MB'}</span>
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden"
        onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
    </div>
  );
}

// ─── Step 4: Tổng hợp preview ────────────────────────────────────

/** The fixed "Tổng hợp" checklist — the hardcoded first page of the Excel. */
const TONGHOP_CHECKLIST: { stt: number; file: string; qty: number; unit: string; note: string }[] = [
  { stt: 1, file: 'PO', qty: 1, unit: 'bản', note: '' },
  { stt: 2, file: 'Invoice & packing list', qty: 4, unit: 'bản', note: 'Dấu treo, giáp lai' },
  { stt: 3, file: 'packing list', qty: 1, unit: 'bản', note: 'Dấu treo' },
  { stt: 4, file: 'label(tem)', qty: 1, unit: 'bản', note: '' },
  { stt: 5, file: 'cam kết hình ảnh', qty: 2, unit: 'bản', note: 'in màu, dấu treo' },
  { stt: 6, file: 'list detail (thả trong thùng hàng)', qty: 1, unit: 'bản', note: '(thả trong thùng hàng)' },
];

export function StepTongHop({
  items, edits, itemsByPo, sevType, header,
}: {
  items: DossierItem[];
  edits: Record<string, Partial<DossierItem>>;
  itemsByPo: Map<string, DossierItem[]>;
  sevType: 'SEV' | 'SEVT';
  header: DossierHeader;
}) {
  const getEff = (it: DossierItem) => ({ ...it, ...(edits[itemKey(it)] || {}) });
  const totalShip = items.reduce((s, it) => s + getEff(it).shipping_qty, 0);

  return (
    <div className="space-y-4">
      <SheetHint
        icon={<FileText className="h-4 w-4 text-sky-600" />}
        title='Sheet "Tổng hợp" — trang đầu tiên của file Excel'
      >
        Checklist hồ sơ phải nộp (cố định). Phần tổng hợp số liệu bên dưới auto-tính từ các bước trên.
      </SheetHint>

      {/* Static 6-row checklist (read-only — the Excel "Tổng hợp" first page) */}
      <SheetFrame scroll>
        <SheetTitle>Tổng hợp</SheetTitle>
        <table className={SHEET.table}>
          <thead>
            <HeaderRow>
              <Th align="center" w="w-12">STT</Th>
              <Th>File</Th>
              <Th align="center" w="w-24">Số lượng</Th>
              <Th align="center" w="w-20">Đơn vị</Th>
              <Th w="w-44">Ghi chú</Th>
            </HeaderRow>
          </thead>
          <tbody>
            {TONGHOP_CHECKLIST.map((r) => (
              <tr key={r.stt}>
                <ReadCell align="center" className="text-slate-500 font-mono">{r.stt}</ReadCell>
                <ReadCell>{r.file}</ReadCell>
                <ReadCell num className="text-slate-700">{r.qty}</ReadCell>
                <ReadCell align="center" className="text-slate-600">{r.unit}</ReadCell>
                <ReadCell className="text-slate-500">{r.note}</ReadCell>
              </tr>
            ))}
          </tbody>
        </table>
      </SheetFrame>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Customer" value={sevType} />
        <StatCard label="Tổng số PO" value={itemsByPo.size} />
        <StatCard label="Tổng số mã" value={items.length} />
        <StatCard label="Tổng SL giao" value={totalShip.toLocaleString('vi-VN')} accent="brand" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-mono mb-2">Thông tin Invoice</div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Vendor Invoice No:</span><span className="font-mono font-semibold">{header.vendor_invoice_no || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Invoice Date:</span><span>{header.invoice_date || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">ETD:</span><span>{header.etd || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Manager:</span><span className="truncate">{header.shipping_manager || '—'}</span></div>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-mono mb-2">Packing</div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Packing:</span><span className="font-mono">{header.packing_qty} {header.packing_unit}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Volume:</span><span className="font-mono">{header.volume.toFixed(4)} M³</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Gross Weight:</span><span className="font-mono">{header.gross_weight} KG</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Remark:</span><span className="truncate">{header.remark || '—'}</span></div>
          </div>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Chi tiết theo PO</h4>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 bg-slate-50/50">
              <th className="px-3 py-2 text-left font-mono uppercase text-[11px]">PO No</th>
              <th className="px-3 py-2 text-right font-mono uppercase text-[11px]">Số mã</th>
              <th className="px-3 py-2 text-right font-mono uppercase text-[11px]">Tổng SL giao</th>
              <th className="px-3 py-2 text-left font-mono uppercase text-[11px]">BQMS Codes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {Array.from(itemsByPo.entries()).map(([po, pitems]) => {
              const poTotal = pitems.reduce((s, it) => s + getEff(it).shipping_qty, 0);
              return (
                <tr key={po} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono font-semibold text-slate-800">{po}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{pitems.length}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-brand-700">{poTotal.toLocaleString('vi-VN')}</td>
                  <td className="px-3 py-2 text-slate-600 font-mono text-[11px] truncate max-w-[300px]">
                    {pitems.map((it) => it.bqms_code).join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: 'brand' | 'emerald' }) {
  return (
    <div className={cn('p-4 rounded-lg border',
      accent === 'brand' ? 'bg-brand-50 border-brand-200' :
      accent === 'emerald' ? 'bg-emerald-50 border-emerald-200' :
      'bg-slate-50 border-slate-200',
    )}>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-mono mb-0.5">{label}</div>
      <div className={cn('text-2xl font-display font-bold',
        accent === 'brand' ? 'text-brand-700' :
        accent === 'emerald' ? 'text-emerald-700' :
        'text-slate-800',
      )}>{value}</div>
    </div>
  );
}

// ─── Step 4 (tab ④): List Detail — spreadsheet replica (LIST DETAIL) ──────

export function StepListDetail({
  items, edits, onEdit,
}: {
  items: DossierItem[];
  edits: Record<string, Partial<DossierItem>>;
  onEdit?: (code: string, key: keyof DossierItem, v: any) => void;
}) {
  const getEff = (it: DossierItem) => ({ ...it, ...(edits[itemKey(it)] || {}) });
  const totQty = items.reduce((s, it) => s + (getEff(it).shipping_qty || 0), 0);
  // Aggregate rows by bqms_code (matches BE builder): sum shipping_qty across
  // all PO lines sharing a code; name_specs/unit from the FIRST occurrence.
  // One row per distinct bqms_code (preserves first-seen order).
  const aggRows = (() => {
    const order: string[] = [];
    const byCode = new Map<string, { first: DossierItem; qty: number }>();
    for (const it of items) {
      const e = getEff(it);
      const ex = byCode.get(it.bqms_code);
      if (ex) ex.qty += e.shipping_qty || 0;
      else {
        byCode.set(it.bqms_code, { first: e, qty: e.shipping_qty || 0 });
        order.push(it.bqms_code);
      }
    }
    return order.map((code) => byCode.get(code)!);
  })();
  return (
    <div className="space-y-3">
      <SheetHint
        icon={<FileSpreadsheet className="h-4 w-4 text-sky-600" />}
        title='Sheet "List Detail" — bảng chi tiết từng mã hàng'
      >
        Auto-generated. Mỗi dòng tương ứng 1 BQMS code với ảnh + spec + qty.
        Cột <strong>Ghi chú</strong> điền được (thả trong thùng hàng).
      </SheetHint>
      <SheetFrame scroll>
        <SheetTitle>List Detail</SheetTitle>
        <table className={SHEET.table}>
          <thead>
            <HeaderRow>
              <Th align="center" w="w-10">No</Th>
              <Th w="w-32">Item code</Th>
              <Th>Name / Specs</Th>
              <Th align="center" w="w-20">Hình Ảnh</Th>
              <Th align="center" w="w-14">Unit</Th>
              <Th align="right" w="w-20">Q&apos;ty (S/L)</Th>
              <Th w="w-44">Ghi chú</Th>
            </HeaderRow>
          </thead>
          <tbody>
            {aggRows.map(({ first: e, qty }, idx) => (
                <tr key={e.bqms_code} className="group">
                  <ReadCell align="center" className="text-slate-400">{idx + 1}</ReadCell>
                  <ReadCell code>{e.bqms_code}</ReadCell>
                  <ReadCell>
                    {/* "{item_name}/ {specification}" — trim each part, join with
                        "/ ", then strip leading/trailing slash-or-space chars.
                        Matches BE builder
                        f"{item_name.strip()}/ {specification.strip()}".strip().strip("/ ").strip(). */}
                    <span className="font-medium text-slate-800">
                      {`${(e.item_name ?? '').trim()}/ ${(e.specification ?? '').trim()}`.trim().replace(/^[\/ ]+|[\/ ]+$/g, '').trim()}
                    </span>
                  </ReadCell>
                  <td className={cn(SHEET.readCell, 'text-center')}>
                    <ListDetailThumb url={e.has_system_image ? e.system_image_url : null} />
                  </td>
                  <ReadCell align="center" className="text-slate-600">{e.unit}</ReadCell>
                  <ReadCell num className="text-brand-700 font-semibold">{(qty || 0).toLocaleString('vi-VN')}</ReadCell>
                  {onEdit ? (
                    <EditCell value={(e.note ?? '') as string} onChange={(v) => onEdit(itemKey(e), 'note', v)}
                      placeholder="—" dirty={(edits[itemKey(e)]?.note ?? '') !== ''} />
                  ) : (
                    <ReadCell />
                  )}
                </tr>
            ))}
          </tbody>
          <TotalRow>
            <td className={SHEET.totalLabel} colSpan={5}>TOTAL</td>
            <td className={SHEET.totalNumBrand}>{totQty.toLocaleString('vi-VN')}</td>
            <td className={SHEET.totalNum}></td>
          </TotalRow>
        </table>
      </SheetFrame>
    </div>
  );
}

/** ~32px thumbnail for the List Detail "Hình Ảnh" column — falls back to ✓/—. */
function ListDetailThumb({ url }: { url: string | null }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return url
      ? <CheckCircle2 className="h-4 w-4 text-emerald-600 inline" />
      : <span className="text-slate-300 text-xs">—</span>;
  }
  return (
    <img
      src={withToken(url)}
      alt=""
      onError={() => setErr(true)}
      className="inline-block h-8 w-8 object-contain rounded bg-white ring-1 ring-slate-200 align-middle"
    />
  );
}

// ─── Step 5 (tab ⑤): Label — print-label "tem" blocks (LabelBlock kit) ────

export function StepLabel({
  edits, itemsByPo, labels, setLabels, deriveDefaultLabels,
}: {
  edits: Record<string, Partial<DossierItem>>;
  itemsByPo: Map<string, DossierItem[]>;
  /** Editable label state. null = not yet touched → fall back to derived default. */
  labels: LabelEntry[] | null;
  setLabels: (v: LabelEntry[]) => void;
  /** Same one-per-PO seed used by page.tsx for the payload default. */
  deriveDefaultLabels: () => LabelEntry[];
}) {
  // Render against the live state if touched, else the derived per-PO default.
  // The first edit lazily seeds state so untouched output stays unchanged.
  const rows = labels ?? deriveDefaultLabels();

  const ensure = (): LabelEntry[] => labels ?? deriveDefaultLabels();

  const duplicate = (i: number) => {
    const base = ensure();
    const copy: LabelEntry = { ...base[i], id: makeLabelId() };
    setLabels([...base.slice(0, i + 1), copy, ...base.slice(i + 1)]);
  };
  const remove = (i: number) => {
    const base = ensure();
    setLabels(base.filter((_, j) => j !== i));
  };
  const setQty = (i: number, qty: number) => {
    const base = ensure();
    setLabels(base.map((e, j) => (j === i ? { ...e, qty } : e)));
  };

  return (
    <div className="space-y-3">
      <SheetHint
        icon={<Tag className="h-4 w-4 text-sky-600" />}
        title='Sheet "label" — nhãn dán hộp (per PO block)'
      >
        Mỗi PO 1 block label gồm Vendor / PR Person / PO No. / BQMS Code / Qty. In ra dán hộp.
        Bấm <strong>Nhân đôi</strong> để tạo thêm tem cho cùng PO; <strong>Qty</strong> sửa trực tiếp được.
      </SheetHint>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((entry, idx) => (
          <div key={entry.id} className="relative group">
            <LabelBlock
              index={idx + 1}
              rows={[
                { label: 'Vendor:', value: 'AMA Bắc Ninh JSC', emphasize: true },
                { label: 'PR Person:', value: entry.pr_person || '—' },
                { label: 'PO No.:', value: entry.po_number, emphasize: true },
                { label: 'BQMS Code:', value: entry.bqms_code },
                {
                  label: 'Qty:',
                  tone: 'brand',
                  value: (
                    <div className="w-28">
                      <CellNumber
                        value={entry.qty}
                        onChange={(v) => setQty(idx, v ?? 0)}
                        min={0} step="1"
                        className="text-right tabular-nums font-bold text-brand-700 border-slate-200"
                      />
                    </div>
                  ),
                },
              ]}
            />
            <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => duplicate(idx)}
                title="Nhân đôi tem này"
                className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50 transition-colors shadow-sm"
              >
                <Copy className="h-3 w-3" /> Nhân đôi
              </button>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  title="Xoá tem này"
                  className="inline-flex items-center justify-center rounded-md bg-white p-1 text-rose-600 ring-1 ring-inset ring-rose-200 hover:bg-rose-50 transition-colors shadow-sm"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stable-ish unique id for a LabelEntry (client-only; stripped before payload). */
export function makeLabelId(): string {
  return `lbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Step 6: Submit + Progress ───────────────────────────────────

export function StepSubmit({
  loading, job, error, onConfirm, onCancel,
}: {
  loading: boolean;
  job: DossierJobStatus | null;
  error: string | null;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}) {
  if (error) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-16 w-16 text-rose-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-rose-700 mb-1">Lỗi tạo hồ sơ</h3>
        <p className="text-sm text-rose-600 max-w-md mx-auto">{error}</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-12">
        <Loader2 className="h-12 w-12 text-brand-600 animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Đang khởi tạo job...</p>
      </div>
    );
  }

  // ── Checkpoint: chờ user kiểm tra 100% trước khi tạo Delivery ──
  if (job.status === 'awaiting_confirm') {
    return <ReviewConfirm job={job} onConfirm={onConfirm} onCancel={onCancel} />;
  }

  // ── Đã huỷ tại checkpoint ──
  if (job.status === 'cancelled') {
    return (
      <div className="text-center py-12">
        <div className="h-16 w-16 rounded-2xl bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center mx-auto mb-4">
          <Ban className="h-8 w-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-700 mb-1">Đã huỷ — chưa tạo Delivery</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto">{job.progress_step}</p>
        <p className="text-xs text-slate-400 mt-2">Không có gì được ghi lên Samsung. Bạn có thể tạo lại bất cứ lúc nào.</p>
      </div>
    );
  }

  const isDone = job.status === 'done';
  const isFailed = job.status === 'failed';
  const isQueued = job.status === 'queued';

  return (
    <div className="space-y-6">
      {/* Queue position banner (only when queued + has people ahead) */}
      {isQueued && (job.queue_position ?? 0) > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <Loader2 className="h-5 w-5 text-amber-600 animate-spin flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">Đang chờ trong hàng đợi</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Có <strong>{job.queue_position}</strong> hồ sơ đang xử lý trước bạn.
              {(job.eta_seconds ?? 0) > 0 && (
                <> Ước tính chờ thêm <strong>~{Math.ceil((job.eta_seconds ?? 0) / 60)} phút</strong>.</>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Stuck warning */}
      {job.stuck_warning && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-orange-900">Cảnh báo: job có thể bị treo</p>
            <p className="text-sm text-orange-700 mt-0.5">{job.stuck_warning}</p>
            <p className="text-xs text-orange-600 mt-1">Watchdog sẽ tự kill sau 5 phút và đánh dấu thất bại.</p>
          </div>
        </div>
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-700 inline-flex items-center gap-2">
            {isDone ? <><CheckCircle2 className="h-5 w-5 text-emerald-600" /> Hoàn thành</>
              : isFailed ? <><AlertCircle className="h-5 w-5 text-rose-600" /> Thất bại</>
              : isQueued ? <><Loader2 className="h-5 w-5 text-amber-600 animate-spin" /> Trong hàng đợi</>
              : <><Loader2 className="h-5 w-5 text-brand-600 animate-spin" /> Đang xử lý...</>}
          </span>
          <span className="text-sm text-slate-500 font-mono">{job.progress_pct}%</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden mb-2">
          <div className={cn(
            'h-full transition-all duration-500 ease-out',
            isDone ? 'bg-emerald-500' : isFailed ? 'bg-rose-500' : isQueued ? 'bg-amber-500' : 'bg-brand-600',
          )} style={{ width: `${job.progress_pct}%` }} />
        </div>
        <p className="text-xs text-slate-500">{job.progress_step}</p>
      </div>

      {isDone && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5 space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-7 w-7 text-emerald-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-base font-semibold text-emerald-900">Hồ sơ đã được tạo</p>
              {job.shipping_no && (
                <p className="text-sm text-emerald-700 mt-1">Shipping No: <span className="font-mono font-bold">{job.shipping_no}</span></p>
              )}
              {job.output_folder && (
                <p className="text-xs text-emerald-700 mt-1 break-all font-mono">
                  <FolderOpen className="h-3 w-3 inline mr-1" />{job.output_folder}
                </p>
              )}
            </div>
          </div>
          {job.files && (
            <div className="pt-3 border-t border-emerald-200 space-y-1 text-xs">
              {job.files.excel && <FileItem jobId={job.id} kind="excel" label="Excel" path={job.files.excel} />}
              {job.files.delivery_note && <FileItem jobId={job.id} kind="delivery_note" label="Delivery Note" path={job.files.delivery_note} />}
              {job.files.po_pdfs?.map((p, i) => (
                <FileItem key={i} jobId={job.id} kind="po" po={p.po} label={`PO ${p.po}`} path={p.path || '(thất bại)'} ok={p.status === 'ok'} />
              ))}
            </div>
          )}
          {job.output_folder && (
            <div className="pt-3 border-t border-emerald-200">
              <button
                type="button"
                onClick={() => downloadDossierFolderZip(job.id, job.output_folder!.split('/').pop() || `dossier-${job.id}`)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                <Download className="h-4 w-4" />
                Tải toàn bộ folder (.zip)
              </button>
              <p className="mt-1.5 text-[11px] text-emerald-700">Gồm Excel + Delivery Note + ảnh — lưu theo từng đợt giao.</p>
            </div>
          )}
          {job.files?.warnings && job.files.warnings.length > 0 && (
            <div className="text-xs text-amber-700 pt-3 border-t border-emerald-200">
              <p className="font-semibold mb-1">Cảnh báo:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {job.files.warnings.slice(0, 5).map((w, i) => <li key={i} className="truncate">{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {isFailed && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-7 w-7 text-rose-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-base font-semibold text-rose-900">Tạo hồ sơ thất bại</p>
              <p className="text-sm text-rose-700 mt-2 break-all">{job.error?.slice(0, 500)}</p>
            </div>
          </div>
        </div>
      )}

      {!isDone && !isFailed && (
        <div className="text-sm text-slate-600 space-y-1">
          <p className="font-semibold text-slate-700 mb-2">Hệ thống đang thực hiện:</p>
          <Step done={(job.progress_pct ?? 0) >= 5}>📡 Đăng nhập Samsung BQMS</Step>
          <Step done={(job.progress_pct ?? 0) >= 30}>🔍 Tìm + tick PO trên Register Delivery</Step>
          <Step done={(job.progress_pct ?? 0) >= 45}>📝 Điền form Create Delivery</Step>
          <Step done={(job.progress_pct ?? 0) >= 60}>🛡️ Bạn kiểm tra + xác nhận</Step>
          <Step done={(job.progress_pct ?? 0) >= 65}>💾 Submit + đợi Samsung process</Step>
          <Step done={(job.progress_pct ?? 0) >= 70}>📄 Tải Delivery Note PDF</Step>
          <Step done={(job.progress_pct ?? 0) >= 90}>📑 Tải Purchase Order PDFs</Step>
          <Step done={(job.progress_pct ?? 0) >= 95}>📊 Build Excel 6 sheets</Step>
          <Step done={(job.progress_pct ?? 0) >= 100}>📁 Lưu folder hồ sơ</Step>
        </div>
      )}
    </div>
  );
}

// ─── Checkpoint review: kiểm tra 100% trước khi tạo Delivery ─────
// Thang 2026-05-29: full redesign — hero countdown, big screenshot, info grid,
// items table with status badges, sticky action bar.

type ChipTone = 'sky' | 'brand' | 'emerald' | 'rose' | 'amber';

function StatChip({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: ChipTone }) {
  const tones: Record<ChipTone, string> = {
    sky: 'bg-white/80 text-sky-700 ring-sky-200/70 shadow-sm shadow-sky-500/10',
    brand: 'bg-white/80 text-brand-700 ring-brand-200/70 shadow-sm shadow-brand-500/10',
    emerald: 'bg-white/80 text-emerald-700 ring-emerald-200/70 shadow-sm shadow-emerald-500/10',
    rose: 'bg-rose-100/80 text-rose-700 ring-rose-300/70 shadow-sm shadow-rose-500/10',
    amber: 'bg-amber-100/70 text-amber-800 ring-amber-300/70 shadow-sm shadow-amber-500/10',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full ring-1 text-xs font-bold tracking-tight', tones[tone])}>
      {icon} {label}
    </span>
  );
}

function HeaderField({ label, value }: { label: string; value: string | number | null | undefined }) {
  const empty = value === null || value === undefined || String(value).trim() === '';
  return (
    <div className={cn(
      'rounded-xl border p-3 transition-all',
      empty
        ? 'border-rose-200 bg-rose-50/40 ring-1 ring-rose-100/60'
        : 'border-slate-200 bg-white ring-1 ring-slate-100 hover:border-slate-300',
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</span>
        {empty ? (
          <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        )}
      </div>
      <div className={cn(
        'text-sm font-semibold break-all',
        empty ? 'text-rose-500 italic' : 'text-slate-900',
      )}>
        {empty ? '(trống)' : String(value)}
      </div>
    </div>
  );
}

function ReviewConfirm({
  job, onConfirm, onCancel,
}: {
  job: DossierJobStatus;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const preview = job.confirm_preview || {};
  const header = preview.header || {};
  const items = preview.items || [];
  const warnings = preview.warnings || [];

  // Local 1s-tick countdown — re-sync from server prop every poll
  const [localRemaining, setLocalRemaining] = useState<number>(
    typeof job.confirm_remaining_seconds === 'number' ? job.confirm_remaining_seconds : 300,
  );
  useEffect(() => {
    if (typeof job.confirm_remaining_seconds === 'number') {
      setLocalRemaining(job.confirm_remaining_seconds);
    }
  }, [job.confirm_remaining_seconds]);
  useEffect(() => {
    if (localRemaining <= 0) return;
    const t = setTimeout(() => setLocalRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [localRemaining]);

  const totalQty = items.reduce((s, it) => s + (it.deliveryQty || 0), 0);
  const totalResidual = items.reduce((s, it) => s + (it.residualQty || 0), 0);
  const distinctPos = new Set(items.map((it) => it.po)).size;
  const overItems = items.filter((it) => it.deliveryQty > it.residualQty);

  const mins = Math.floor(localRemaining / 60);
  const secs = localRemaining % 60;
  const countdownStr = `${mins}:${String(secs).padStart(2, '0')}`;
  const countdownPct = Math.min(100, Math.max(0, (localRemaining / 300) * 100));
  const tone: 'rose' | 'amber' | 'emerald' =
    localRemaining < 60 ? 'rose' : localRemaining < 120 ? 'amber' : 'emerald';
  const toneClass = {
    rose:    { text: 'text-rose-700',    bar: 'bg-rose-500',    ring: 'ring-rose-300/60',    icon: 'text-rose-600' },
    amber:   { text: 'text-amber-700',   bar: 'bg-amber-500',   ring: 'ring-amber-300/60',   icon: 'text-amber-600' },
    emerald: { text: 'text-emerald-700', bar: 'bg-emerald-500', ring: 'ring-emerald-300/60', icon: 'text-emerald-600' },
  }[tone];

  const doConfirm = async () => {
    if (busy) return;
    setBusy('confirm');
    try { await onConfirm?.(); } finally { /* parent flips status via poll */ }
  };
  const doCancel = async () => {
    if (busy) return;
    setBusy('cancel');
    try { await onCancel?.(); } finally { /* parent flips status via poll */ }
  };

  return (
    <div className="space-y-6 -mx-2 md:-mx-4">
      {/* ─── HERO — flat amber caution block ─── */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 shadow-sm">
        <div className="p-6 md:p-7">
          <div className="flex items-start justify-between flex-wrap gap-5">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="h-14 w-14 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <ShieldAlert className="h-7 w-7 text-amber-700" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/85 ring-1 ring-amber-300/60 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700 mb-2 backdrop-blur-sm">
                  <ShieldAlert className="h-3 w-3" /> Checkpoint kiểm tra cuối cùng
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-amber-900 tracking-tight">
                  Kiểm tra 100% thông tin trước khi tạo Delivery
                </h2>
                <p className="text-sm text-amber-800 mt-1.5 max-w-2xl leading-relaxed">
                  Hệ thống đã điền sẵn form Create Delivery thực tế trên Samsung BQMS. Hãy soát lại đầy đủ
                  bên dưới — sau khi bạn xác nhận, hệ thống sẽ bấm Save và Delivery sẽ được tạo
                  (<strong className="text-amber-900">KHÔNG THỂ HOÀN TÁC</strong>).
                </p>
              </div>
            </div>

            {/* Countdown clock */}
            <div className={cn('flex-shrink-0 rounded-2xl bg-white/90 ring-1 px-5 py-4 backdrop-blur-sm shadow-md', toneClass.ring)}>
              <div className="flex items-center gap-2 mb-1.5">
                <Clock className={cn('h-4 w-4', toneClass.icon)} />
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Tự huỷ sau</span>
              </div>
              <div className={cn('text-3xl md:text-4xl font-mono font-bold tracking-tight tabular-nums leading-none', toneClass.text)}>
                {countdownStr}
              </div>
              <div className="mt-2.5 h-1.5 w-32 rounded-full bg-slate-200/60 overflow-hidden">
                <div className={cn('h-full transition-all duration-1000 ease-linear', toneClass.bar)} style={{ width: `${countdownPct}%` }} />
              </div>
            </div>
          </div>

          {/* Stat chips */}
          <div className="mt-5 flex items-center gap-2 flex-wrap">
            <StatChip icon={<Hash className="h-3.5 w-3.5" />}   label={`${distinctPos} PO`} tone="sky" />
            <StatChip icon={<Package className="h-3.5 w-3.5" />} label={`${items.length} mã hàng`} tone="brand" />
            <StatChip icon={<Boxes className="h-3.5 w-3.5" />}   label={`Tổng ${totalQty.toLocaleString('vi-VN')} pcs`} tone="emerald" />
            {warnings.length > 0 && (
              <StatChip icon={<AlertTriangle className="h-3.5 w-3.5" />} label={`${warnings.length} cảnh báo`} tone="rose" />
            )}
            {overItems.length > 0 && (
              <StatChip icon={<AlertCircle className="h-3.5 w-3.5" />} label={`${overItems.length} dòng vượt residual`} tone="rose" />
            )}
            {warnings.length === 0 && overItems.length === 0 && items.length > 0 && (
              <StatChip icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Không có cảnh báo" tone="emerald" />
            )}
          </div>
        </div>
      </div>

      {/* ─── WARNINGS ─── */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 shadow-sm">
          <div className="p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="h-9 w-9 rounded-xl bg-rose-100 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-rose-900 tracking-tight">Cảnh báo ({warnings.length})</h3>
                <p className="text-xs text-rose-600 font-medium">Nên xử lý hoặc xác nhận đã chấp nhận trước khi tạo Delivery</p>
              </div>
            </div>
            <ul className="space-y-1.5 pl-1">
              {warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-rose-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 mt-2 flex-shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ─── SCREENSHOT — FULL WIDTH ─── */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3 bg-slate-50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <Camera className="h-4 w-4 text-brand-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 tracking-tight">Ảnh chụp popup Create Delivery thật</h3>
              <p className="text-[11px] text-slate-500 font-medium">Đây chính là form đã điền trên Samsung BQMS — soát từng ô như khi nhìn trực tiếp</p>
            </div>
          </div>
          {job.confirm_image_url && (
            <a
              href={job.confirm_image_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 ring-1 ring-sky-200/60 transition-colors flex-shrink-0"
            >
              <Maximize2 className="h-3.5 w-3.5" /> Mở full size
            </a>
          )}
        </div>
        {job.confirm_image_url ? (
          // Native-resolution + scrollable (both axes) so the full-width Samsung grid
          // is readable without the previous max-h-[760px] object-contain squeeze.
          <div className="relative max-h-[80vh] overflow-auto bg-slate-900">
            <a
              href={job.confirm_image_url}
              target="_blank"
              rel="noreferrer"
              className="group/img block w-max"
              title="Bấm để xem ảnh full size"
            >
              <img
                src={job.confirm_image_url}
                alt="Popup Create Delivery — Samsung"
                className="block w-auto max-w-none h-auto"
              />
            </a>
          </div>
        ) : (
          <div className="py-24 text-center text-slate-400 text-sm bg-slate-50">
            <Loader2 className="h-7 w-7 animate-spin mx-auto mb-2 text-sky-500" />
            Đang chụp màn hình popup...
          </div>
        )}
      </div>

      {/* ─── HEADER INFO GRID ─── */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-brand-50 flex items-center justify-center">
            <FileText className="h-4 w-4 text-brand-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">Thông tin chung trên form</h3>
            <p className="text-[11px] text-slate-500 font-medium">{Object.keys(header).length} field — đọc lại từ DOM Samsung sau khi điền</p>
          </div>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(header).map(([k, v]) => (
            <HeaderField key={k} label={k} value={v as any} />
          ))}
        </div>
      </div>

      {/* ─── ITEMS TABLE ─── */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <Package className="h-4 w-4 text-brand-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 tracking-tight">Mặt hàng + Shipping Qty</h3>
              <p className="text-[11px] text-slate-500 font-medium">
                {items.length} dòng · {distinctPos} PO · Tổng <strong>{totalQty.toLocaleString('vi-VN')}</strong> pcs
              </p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-slate-500 font-bold bg-slate-50/70 border-b border-slate-100 sticky top-0">
                <th className="px-3 py-3 w-12 text-center">#</th>
                <th className="px-3 py-3">PO</th>
                <th className="px-3 py-3">BQMS Code</th>
                <th className="px-3 py-3 text-right">P/O Qty</th>
                <th className="px-3 py-3 text-right">Shipping Qty</th>
                <th className="px-3 py-3 text-right">Đã giao</th>
                <th className="px-3 py-3 text-right">Còn lại</th>
                <th className="px-3 py-3 text-center">Ảnh</th>
                <th className="px-3 py-3 text-center w-20">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const over = it.deliveryQty > it.residualQty;
                return (
                  <tr
                    key={i}
                    className={cn(
                      'border-b border-slate-50 last:border-0 transition-colors',
                      over ? 'bg-rose-50/40 hover:bg-rose-50/70' : 'hover:bg-slate-50/60',
                    )}
                  >
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-slate-100 ring-1 ring-slate-200/60 text-[11px] font-bold text-slate-600 tabular-nums">
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex font-mono text-xs font-bold text-slate-800 bg-slate-100/80 ring-1 ring-slate-200/60 px-2 py-1 rounded-md">
                        {it.po}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs font-semibold text-brand-700">{it.code}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-slate-500 tabular-nums">
                      {it.poQty != null ? it.poQty.toLocaleString('vi-VN') : '—'}
                    </td>
                    <td className={cn(
                      'px-3 py-3 text-right font-mono font-bold tabular-nums',
                      over ? 'text-rose-700' : 'text-slate-900',
                    )}>
                      {it.deliveryQty.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-slate-500 tabular-nums">
                      {it.sumDeliveryQty != null ? it.sumDeliveryQty.toLocaleString('vi-VN') : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-500 tabular-nums">
                      {it.residualQty.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-3 text-center text-xs font-bold">
                      {it.itemImgYn ? (
                        <span className={it.itemImgYn === 'Y' ? 'text-emerald-600' : 'text-rose-600'}>{it.itemImgYn}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {over ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 ring-1 ring-rose-200 text-[11px] font-bold">
                          <AlertCircle className="h-3 w-3" /> Vượt
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 text-[11px] font-bold">
                          <CheckCircle2 className="h-3 w-3" /> OK
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-rose-600 text-sm font-semibold">
                    <AlertCircle className="h-6 w-6 mx-auto mb-1.5" />
                    Không có dòng nào — không thể tạo Delivery
                  </td>
                </tr>
              )}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td colSpan={3} className="px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase tracking-[0.12em]">
                    Tổng cộng
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-base font-bold text-slate-900 tabular-nums">
                    {totalQty.toLocaleString('vi-VN')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-slate-400 tabular-nums">
                    {totalResidual.toLocaleString('vi-VN')}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {overItems.length === 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 text-[11px] font-bold">
                        <CheckCircle2 className="h-3 w-3" /> Sẵn sàng
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 ring-1 ring-rose-200 text-[11px] font-bold">
                        <AlertCircle className="h-3 w-3" /> {overItems.length} lỗi
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ─── STICKY ACTION BAR ─── */}
      <div className="sticky bottom-0 -mx-6 md:-mx-8 -mb-8 px-5 md:px-8 py-4 bg-white/95 backdrop-blur-md border-t border-slate-200 flex items-center justify-between flex-wrap gap-3 shadow-[0_-10px_28px_-12px_rgba(15,23,42,0.16)] z-10">
        <div className="flex items-center gap-2.5 text-sm text-slate-600 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
          </div>
          <span className="min-w-0">
            <strong className="text-amber-700">KHÔNG THỂ HOÀN TÁC</strong>
            <span className="hidden sm:inline"> — Delivery sẽ được tạo thật trên Samsung sau khi bạn xác nhận</span>
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={doCancel}
            disabled={!!busy}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 inline-flex items-center gap-2 transition-all ring-1 ring-slate-100"
          >
            {busy === 'cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            Huỷ (không tạo)
          </button>
          <button
            onClick={doConfirm}
            disabled={!!busy}
            className="px-6 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 inline-flex items-center gap-2 transition-colors shadow-sm"
          >
            {busy === 'confirm' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Xác nhận tạo Delivery
          </button>
        </div>
      </div>
    </div>
  );
}

// Tải file đã tạo (Excel / Delivery Note / PO PDF) qua endpoint có auth.
// Dùng Bearer token + blob (giống nút Export ở trang Giao hàng) vì auth qua header,
// không phải cookie — thẻ <a href> thường sẽ không kèm token.
async function _blobDownload(path: string, filename: string) {
  const token = localStorage.getItem('access_token') ?? '';
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { alert('Không tải được (có thể file/thư mục chưa được tạo hoặc đã bị xoá).'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadDossierFile(jobId: number, kind: string, filename: string, po?: string) {
  const qs = new URLSearchParams({ kind });
  if (po) qs.set('po', po);
  await _blobDownload(`/api/v1/bqms/deliveries/dossier-job/${jobId}/file?${qs.toString()}`, filename);
}

async function downloadDossierFolderZip(jobId: number, folderName: string) {
  await _blobDownload(`/api/v1/bqms/deliveries/dossier-job/${jobId}/folder.zip`, `${folderName}.zip`);
}

function FileItem({ jobId, kind, label, path, ok = true, po }:
  { jobId: number; kind: string; label: string; path: string; ok?: boolean; po?: string }) {
  const fname = path.split('/').pop() || path;
  if (!ok) {
    return (
      <div className="flex items-center gap-2 text-rose-700">
        <FileText className="h-3.5 w-3.5" />
        <span className="font-semibold">{label}:</span>
        <span className="font-mono truncate flex-1 text-[11px]">{fname}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => downloadDossierFile(jobId, kind, fname, po)}
      title={`Tải ${label}`}
      className="group flex w-full items-center gap-2 text-left text-emerald-800 hover:text-emerald-900 hover:underline"
    >
      <Download className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
      <span className="font-semibold">{label}:</span>
      <span className="font-mono truncate flex-1 text-[11px]">{fname}</span>
    </button>
  );
}

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-center gap-2 transition-opacity', done ? 'text-emerald-600 opacity-100' : 'opacity-60')}>
      <span className="inline-block w-4">{done ? '✓' : ''}</span>
      <span>{children}</span>
    </div>
  );
}
