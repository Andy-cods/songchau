'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';
import { CURRENCY_OPTIONS, formatDate, formatMoneyNum, quoteStatusCfg } from '@/lib/format';
import { Badge } from '@/components/Badge';
import PortalNav from '@/components/PortalNav';
import { FieldGrid } from '@/components/ui/FieldGrid';
import { Deadline } from '@/components/ui/Deadline';
import { DDay } from '@/components/ui/DDay';
import { StatusChip } from '@/components/ui/StatusChip';
import { QtyPriceCell } from '@/components/ui/QtyPriceCell';
import { ItemDescCell } from '@/components/ui/ItemDescCell';
import { CurrencyTotalRow } from '@/components/ui/CurrencyTotalRow';
import { AttachmentDot } from '@/components/ui/AttachmentDot';
import QuoteThread from './QuoteThread';
import type { BatchDetail, BatchItem, MyQuote, PrefillData } from '@/lib/types';

// #15 — payload gợi ý vị thế (band-mờ). available=false ⇒ chưa đủ điều kiện (chưa
// nộp / cohort<3) → KHÔNG render band. KHÔNG có rank/giá/tên đối thủ — chỉ band+label.
interface RankHint {
  available: boolean;
  band?: 'leading' | 'middle' | 'improve';
  label?: string;
}

interface QuoteItemInput {
  item_id: number;
  unit_price: string;
  quantity: string;
  offered_qty: string; // SL NCC có thể cung cấp (default = RFQ qty)
  moq: string;         // điều kiện đặt tối thiểu của riêng dòng này
  lead_time_days: string;
  currency: string;    // tiền tệ riêng của dòng (mặc định = tiền tệ chung)
  valid_until: string; // hạn giá riêng của dòng (optional)
  notes: string;
  can_do: boolean;
  free_charge: boolean; // FOC — cam kết cung cấp miễn phí (ép đơn giá = 0)
  // File đính kèm per-dòng đã lưu ở vòng/báo giá trước. PHẢI gửi lại khi nộp đè
  // vì submit là DELETE-then-INSERT — không gửi lại = XOÁ file (quotes.py:294).
  attachment_paths?: string[];
}

// Slice an ISO timestamp down to the yyyy-MM-dd a <input type="date"> expects.
// Returns '' for null/invalid so the input renders empty (not "Invalid Date").
function toDateInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // Local date parts (avoid a UTC shift pushing the day back one).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function RfqDetailPage() {
  const params = useParams();
  const batchId = Number(params.id);

  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [myQuote, setMyQuote] = useState<MyQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false); // "Lưu nháp" in-flight
  const [draftSaved, setDraftSaved] = useState(false);    // transient "Đã lưu nháp" confirmation
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  // Inline pre-check error shown near the footer when "Gửi báo giá" is blocked
  // because Ý kiến / Hạn hiệu lực is empty. Cleared on any successful action.
  const [submitGateError, setSubmitGateError] = useState('');
  // Cờ "NCC đã bấm Sửa lại" — gỡ khoá read-only để nộp đè trước deadline. Reset
  // false trong load() để luôn xem read-only trước (mặc định an toàn).
  const [editing, setEditing] = useState(false);

  // Đợt-2 multi-round: which round the vendor is quoting now, and whether the
  // form was seeded from the PREVIOUS round (reverse-auction starting point).
  const [currentRound, setCurrentRound] = useState(1);
  const [seededFromPrevRound, setSeededFromPrevRound] = useState(false);
  const [prevRoundNumber, setPrevRoundNumber] = useState<number | null>(null);

  const [currency, setCurrency] = useState('USD');
  const [leadTime, setLeadTime] = useState('');
  const [validUntil, setValidUntil] = useState(''); // Hiệu lực báo giá đến (quote-level, yyyy-MM-dd)
  const [externalUrl, setExternalUrl] = useState(''); // Link tham khảo (quote-level URL)
  const [moqNotes, setMoqNotes] = useState('');
  const [generalNotes, setGeneralNotes] = useState('');
  const [quoteItems, setQuoteItems] = useState<QuoteItemInput[]>([]);

  // Chuyển vùng phụ (báo giá / hỏi đáp / đã gửi) — thuần UI, không ảnh hưởng submit.
  const [activeTab, setActiveTab] = useState<'quote' | 'qa' | 'submitted'>('quote');
  // Disclosure mô tả RFQ — gập mặc định để không đẩy nội dung xuống.
  const [descOpen, setDescOpen] = useState(false);

  // Prior-round unit prices keyed by item_id, for the "giá lần trước" ghost on
  // each QtyPriceCell. Populated from the prefill payload (when present).
  const [prevPrices, setPrevPrices] = useState<Record<number, number>>({});

  // Decline UI
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [declined, setDeclined] = useState(false);

  // Withdraw UI (#16-P2 — thu hồi báo giá đã gửi khi còn hạn). Lý do BẮT BUỘC.
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  // File attachment
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadedName, setUploadedName] = useState('');

  // #15 — gợi ý vị thế cạnh tranh (band-mờ). Chỉ fetch SAU khi đã nộp vòng hiện tại;
  // endpoint trả 404 khi admin chưa bật cờ ⇒ ẩn im lặng (rankHint = null). KHÔNG
  // bao giờ chứa giá/tên/rank số đối thủ — chỉ {available, band, label}.
  const [rankHint, setRankHint] = useState<RankHint | null>(null);

  // Dirty-state guard: snapshot of the pristine form captured right after load,
  // used to warn before unload when the vendor has unsaved input. Pure client UX.
  const pristineRef = useRef<string>('');

  // Refs to the two SUBMIT-mandatory toolbar fields (Ý kiến + Hạn hiệu lực) so the
  // friendly FE gate can focus the offending one when "Gửi báo giá" is blocked.
  const generalNotesRef = useRef<HTMLInputElement>(null);
  const validUntilRef = useRef<HTMLInputElement>(null);

  // Grid body ref — keyboard navigation (Tab/Enter/Ctrl+Arrow) walks editable
  // cells via data-cell attributes; see onGridKeyDown / focusCell below.
  const gridBodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (!batchId) return;

    let cancelled = false;

    async function load() {
      try {
        const res = await api.get<{ data: BatchDetail }>(`/api/vendor/batches/${batchId}`);
        const d = res.data;
        if (cancelled) return;

        setBatch(d);
        setItems(d.items || []);
        setMyQuote(d.my_quote);
        setEditing(false); // mặc định read-only sau mỗi lần (re)load
        if (d.inv_status === 'declined') setDeclined(true);

        // Try the previous-round prefill (Đợt-2 reverse auction). Endpoint may not
        // be live yet / may 404 when there is no prior round — treat any failure as
        // "no previous round" and fall back to existing-quote seeding.
        let prefill: PrefillData | null = null;
        try {
          const pf = await api.get<{ data: PrefillData }>(
            `/api/vendor/quotes/batches/${batchId}/prefill`,
          );
          prefill = pf?.data ?? null;
        } catch {
          prefill = null;
        }
        if (cancelled) return;

        // Resolve the current round number. Prefer the prefill's authoritative value,
        // then the batch's current_round, then the latest quote's round, else 1.
        const resolvedRound =
          prefill?.round ??
          d.current_round ??
          d.my_quote?.round_number ??
          1;
        setCurrentRound(resolvedRound);

        const myQuoteRound = d.my_quote?.round_number ?? 1;
        const editingCurrentRound = !!d.my_quote && myQuoteRound === resolvedRound;

        // General fields: seed from the vendor's own quote when it exists (either the
        // current-round draft being edited, or the previous round as a starting point).
        let seededCurrency = 'USD';
        let seededLeadTime = '';
        let seededValidUntil = '';
        let seededMoq = '';
        let seededNotes = '';
        let seededExternalUrl = '';
        if (d.my_quote) {
          seededCurrency = d.my_quote.currency || 'USD';
          seededLeadTime =
            d.my_quote.lead_time_days != null ? String(d.my_quote.lead_time_days) : '';
          seededValidUntil = toDateInput(d.my_quote.valid_until);
          seededMoq = d.my_quote.moq_notes || '';
          seededNotes = d.my_quote.notes || '';
          seededExternalUrl = d.my_quote.external_url || '';
          setCurrency(seededCurrency);
          setLeadTime(seededLeadTime);
          setValidUntil(seededValidUntil);
          setMoqNotes(seededMoq);
          setGeneralNotes(seededNotes);
          setExternalUrl(seededExternalUrl);
        }

        // Build the per-item grid. Priority:
        //  1) editing the CURRENT round  -> seed from my_quote items.
        //  2) a previous-round prefill   -> seed prior prices as a starting point.
        //  3) nothing                    -> blank (quantity defaults to the RFQ qty).
        let seededPrev = false;
        const byItem: Record<number, { unit_price: number | string | null; quantity?: number | string | null; offered_qty?: number | string | null; moq?: string | null; lead_time_days?: number | null; currency?: string | null; notes?: string | null; can_do?: boolean | null; free_charge?: boolean | null; attachment_paths?: string[] | null }> = {};

        if (editingCurrentRound) {
          for (const qi of d.my_quote?.items || []) byItem[qi.item_id] = qi;
        } else if (prefill && (prefill.items || []).length > 0) {
          for (const pi of prefill.items) byItem[pi.item_id] = pi;
          seededPrev = true;
          setPrevRoundNumber(prefill.prev_round ?? resolvedRound - 1);
        }
        setSeededFromPrevRound(seededPrev);

        // Prior-round unit prices for the QtyPriceCell ghost. ALWAYS sourced from
        // the prefill (the authoritative previous-round snapshot), independent of
        // whether we seeded the form from it — so editing a current-round draft
        // still shows last round's price beside each input.
        const prevMap: Record<number, number> = {};
        if (prefill && (prefill.items || []).length > 0) {
          for (const pi of prefill.items) {
            const p = pi.unit_price == null ? NaN : parseFloat(String(pi.unit_price));
            if (Number.isFinite(p) && p > 0) prevMap[pi.item_id] = p;
          }
        }
        setPrevPrices(prevMap);

        const seededItems: QuoteItemInput[] = (d.items || []).map(item => {
          const eq = byItem[item.id];
          return {
            item_id: item.id,
            unit_price: eq?.unit_price != null ? String(eq.unit_price) : '',
            quantity: eq?.quantity != null ? String(eq.quantity) : String(item.quantity),
            // offered_qty defaults to the RFQ quantity until the vendor overrides it.
            offered_qty:
              eq?.offered_qty != null
                ? String(eq.offered_qty)
                : eq?.quantity != null
                  ? String(eq.quantity)
                  : String(item.quantity),
            moq: eq?.moq || '',
            lead_time_days: eq?.lead_time_days != null ? String(eq.lead_time_days) : '',
            // per-line currency defaults to the quote-level currency.
            currency: eq?.currency || seededCurrency,
            valid_until: '',
            notes: eq?.notes || '',
            can_do: eq?.can_do !== false, // default true; only false when explicitly flagged
            free_charge: eq?.free_charge === true, // FOC chỉ true khi được lưu rõ ràng
            // Giữ lại file đính kèm per-dòng để re-submit không xoá (DELETE-then-INSERT).
            attachment_paths: eq?.attachment_paths ?? [],
          };
        });
        setQuoteItems(seededItems);

        // Capture the pristine snapshot so the beforeunload guard can detect edits.
        pristineRef.current = JSON.stringify({
          currency: seededCurrency,
          leadTime: seededLeadTime,
          validUntil: seededValidUntil,
          externalUrl: seededExternalUrl,
          moqNotes: seededMoq,
          generalNotes: seededNotes,
          quoteItems: seededItems,
        });
      } catch (err: any) {
        if (!cancelled) setError(err?.detail ?? 'Không tải được dữ liệu');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  const updateItem = (idx: number, field: keyof QuoteItemInput, value: string | boolean) => {
    setQuoteItems(prev => {
      const next = [...prev];
      const row = { ...next[idx], [field]: value };
      // Bật FOC (miễn phí) → ép đơn giá = 0 (ô giá bị khoá ở UI).
      if (field === 'free_charge' && value === true) row.unit_price = '0';
      // Bỏ tick "Báo được" → FOC vô nghĩa → tắt luôn.
      if (field === 'can_do' && value === false) row.free_charge = false;
      next[idx] = row;
      return next;
    });
  };

  // ── Keyboard grid navigation (Samsung BQMS feel) ─────────────────────────────
  // Editable column keys in left-to-right row order. data-cell="r{row}-c{key}" on
  // each editable input lets the handler walk cells. 'cando' is the "Báo được"
  // checkbox (always editable); the rest are disabled when !can_do (and price also
  // when free_charge). We compute per-row disabled cells so focus never lands on a
  // disabled input or a fully-declined row.
  const GRID_COLS = ['price', 'offered', 'moq', 'lead', 'currency', 'cando', 'notes'] as const;
  type GridCol = (typeof GRID_COLS)[number];

  // Which editable cells in row idx are currently FOCUSABLE (skip disabled inputs).
  const editableColsForRow = (idx: number): GridCol[] => {
    const qi = quoteItems[idx];
    if (!qi) return [];
    // declined row: checkbox + "Lý do" (notes input vẫn bật để ghi lý do không cung cấp)
    if (!qi.can_do) return ['cando', 'notes'];
    const cols: GridCol[] = [];
    if (!qi.free_charge) cols.push('price'); // price disabled when FOC
    cols.push('offered', 'moq', 'lead', 'currency', 'cando', 'notes');
    return cols;
  };

  const focusCell = (row: number, col: GridCol) => {
    const el = gridBodyRef.current?.querySelector<HTMLElement>(
      `[data-cell="r${row}-c${col}"]`,
    );
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement && el.type !== 'checkbox') el.select?.();
    }
  };

  // Move to the same column in the next/prev row that actually has that column
  // editable; if the target row has it disabled, fall through to its first editable.
  const focusColInRow = (targetRow: number, col: GridCol) => {
    if (targetRow < 0 || targetRow >= items.length) return;
    const cols = editableColsForRow(targetRow);
    if (cols.length === 0) return;
    focusCell(targetRow, cols.includes(col) ? col : cols[0]);
  };

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>('[data-cell]')?.dataset.cell;
    if (!cell) return;
    const m = /^r(\d+)-c(.+)$/.exec(cell);
    if (!m) return;
    const row = Number(m[1]);
    const col = m[2] as GridCol;

    // Tab / Shift+Tab → prev/next EDITABLE cell in row order (wraps to next row).
    if (e.key === 'Tab') {
      const flat: Array<{ row: number; col: GridCol }> = [];
      for (let r = 0; r < items.length; r++)
        for (const c of editableColsForRow(r)) flat.push({ row: r, col: c });
      const pos = flat.findIndex(p => p.row === row && p.col === col);
      if (pos === -1) return; // unknown cell → let native Tab run
      const nextPos = e.shiftKey ? pos - 1 : pos + 1;
      if (nextPos < 0 || nextPos >= flat.length) return; // edge → native Tab leaves grid
      e.preventDefault();
      focusCell(flat[nextPos].row, flat[nextPos].col);
      return;
    }

    // Enter or Ctrl+ArrowDown → same column, next row. Ctrl+ArrowUp → prev row.
    // BARE ArrowUp/Down/Left/Right are NOT handled here — native input behavior
    // (number spinner, date arrows, caret movement, SR focus) stays intact.
    if (e.key === 'Enter') {
      // Don't hijack Enter inside a <select> (native open/commit) — let it be.
      if (target instanceof HTMLSelectElement) return;
      e.preventDefault();
      focusColInRow(row + 1, col);
      return;
    }
    if (e.ctrlKey && e.key === 'ArrowDown') {
      e.preventDefault();
      focusColInRow(row + 1, col);
      return;
    }
    if (e.ctrlKey && e.key === 'ArrowUp') {
      e.preventDefault();
      focusColInRow(row - 1, col);
      return;
    }
  };

  // Paste-from-Excel on the ĐƠN GIÁ column: a vertical clip of prices fills
  // unit_price DOWN from the focused row. Single-column fill-down only — we take
  // the FIRST token of each line (ignore extra tab-separated columns) and write via
  // updateItem so FOC/can_do interlocks stay consistent. Skips FOC/declined rows.
  const onPriceColumnPaste = (idx: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const rows = text.replace(/\r/g, '').split('\n').filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ''));
    if (rows.length <= 1) return; // single value → let native paste fill this one cell
    e.preventDefault();
    rows.forEach((line, k) => {
      const raw = line.split('\t')[0]?.trim();
      if (raw == null || raw === '') return;
      const val = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '');
      if (val === '') return;
      const targetIdx = idx + k;
      const qi = quoteItems[targetIdx];
      if (!qi || !qi.can_do || qi.free_charge) return; // never write a disabled price cell
      updateItem(targetIdx, 'unit_price', val);
    });
  };

  // Thành tiền per line = đơn giá × SL chào (the qty the vendor commits to supply).
  const lineTotalOf = (qi: QuoteItemInput): number => {
    if (!qi.can_do) return 0;
    const price = parseFloat(qi.unit_price) || 0;
    const qty = parseFloat(qi.offered_qty) || 0;
    return price * qty;
  };

  const totalAmount = useMemo(
    () => quoteItems.reduce((sum, qi) => sum + lineTotalOf(qi), 0),
    [quoteItems],
  );

  // Footer summary counters.
  const quotedCount = useMemo(
    () => quoteItems.filter(
      qi => qi.can_do && (qi.free_charge || (!!qi.unit_price && parseFloat(qi.unit_price) > 0)),
    ).length,
    [quoteItems],
  );
  const cannotSupplyCount = useMemo(
    () => quoteItems.filter(qi => !qi.can_do).length,
    [quoteItems],
  );

  // Has the vendor changed anything since load? Drives the beforeunload guard.
  const isDirty = useMemo(() => {
    if (!pristineRef.current) return false;
    const current = JSON.stringify({ currency, leadTime, validUntil, externalUrl, moqNotes, generalNotes, quoteItems });
    return current !== pristineRef.current;
  }, [currency, leadTime, validUntil, externalUrl, moqNotes, generalNotes, quoteItems]);

  // Warn before leaving with unsaved input. Suppressed once submitted/declined so
  // the success/decline swaps don't trip the prompt. Pure client UX, no API.
  useEffect(() => {
    const guard = isDirty && !success && !declined;
    if (!guard) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, success, declined]);

  // Build the quote payload ONCE for both "Lưu nháp" (/draft) and "Gửi báo giá"
  // (/submit). The two endpoints share _persist_quote(body, status) on the backend
  // (quotes.py:482-504), so the body is IDENTICAL — only the route differs. CRITICAL:
  // per-line attachment_paths MUST be re-sent on BOTH because submit/draft is
  // DELETE-then-INSERT (quotes.py:325) — omitting them wipes the vendor's files.
  const buildQuotePayload = () => {
    // Send all items: priced + can_do=true rows carry a price; can_do=false rows
    // are sent with can_do flag so the admin matrix shows "không báo được". For a
    // draft, partially-filled priced rows are tolerated server-side, so we keep the
    // same row filter (rows with no price AND can_do=true are simply blank/unsent).
    const items = quoteItems
      .filter(qi => (qi.can_do && (qi.free_charge || (!!qi.unit_price && parseFloat(qi.unit_price) > 0))) || !qi.can_do)
      .map(qi => ({
        item_id: qi.item_id,
        // FOC → giá 0; ngược lại lấy giá đã nhập. can_do=false → 0.
        unit_price: qi.can_do ? (qi.free_charge ? 0 : parseFloat(qi.unit_price) || 0) : 0,
        quantity: parseFloat(qi.quantity) || null,
        // offered_qty: SL NCC có thể cung cấp; backend defaults to RFQ qty if null.
        offered_qty: qi.offered_qty ? parseFloat(qi.offered_qty) || null : null,
        moq: qi.moq || null,
        lead_time_days: qi.lead_time_days ? parseInt(qi.lead_time_days) : null,
        // per-line currency (optional; backend now accepts it). Only send when it
        // differs from the quote-level currency, else fall back to quote-level.
        currency: qi.currency && qi.currency !== currency ? qi.currency : null,
        notes: qi.notes || null,
        can_do: qi.can_do,
        // FOC (miễn phí) — chỉ gửi true khi báo được. Server cũng tự ép giá 0.
        free_charge: qi.can_do ? !!qi.free_charge : false,
        // BẮT BUỘC gửi lại file đính kèm per-dòng trên CẢ /draft VÀ /submit: cả hai
        // là DELETE-then-INSERT (quotes.py:325); thiếu → _sanitize_attachment_paths
        // nhận None → '[]' → MẤT file đã đính kèm. null khi không có.
        attachment_paths:
          qi.attachment_paths && qi.attachment_paths.length ? qi.attachment_paths : null,
      }));

    // Backend writes against the invitation's latest round (round-aware); no
    // round_number sent from the client. Posting always targets the CURRENT round.
    return {
      batch_id: batchId,
      currency,
      lead_time_days: leadTime ? parseInt(leadTime) : null,
      // quote-level Hiệu lực báo giá đến (optional; backend now accepts it).
      valid_until: validUntil || null,
      // Link tham khảo (URL) cấp báo giá — chỉ http(s) được server giữ lại.
      external_url: externalUrl.trim() || null,
      moq_notes: moqNotes || null,
      notes: generalNotes || null,
      items,
    };
  };

  // "Lưu nháp" → POST /draft. KHÔNG bắt buộc Ý kiến/Hạn hiệu lực, cho phép form dở
  // dang. status='draft' KHÔNG bao giờ lọt sang buyer (server lọc status='submitted').
  const handleDraft = async () => {
    setSavingDraft(true);
    setError('');
    setSubmitGateError('');
    setDraftSaved(false);
    try {
      await api.post('/api/vendor/quotes/draft', buildQuotePayload());
      // Re-snapshot pristine so the dirty-guard treats the saved state as clean,
      // and surface a transient confirmation (stay on the form — no full-page swap).
      pristineRef.current = JSON.stringify({ currency, leadTime, validUntil, externalUrl, moqNotes, generalNotes, quoteItems });
      setDraftSaved(true);
    } catch (err: any) {
      setError(err?.detail ?? 'Lưu nháp thất bại');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitGateError('');
    setDraftSaved(false);

    // FE pre-check (friendly mirror of the backend 400s): Ý kiến + Hạn hiệu lực are
    // MANDATORY on submit only. Focus the first offending field; do NOT call submit.
    if (!generalNotes.trim()) {
      setSubmitGateError('Vui lòng nhập Ý kiến (Ghi chú chung) trước khi gửi báo giá.');
      generalNotesRef.current?.focus();
      return;
    }
    if (!validUntil) {
      setSubmitGateError('Vui lòng chọn Hạn hiệu lực báo giá trước khi gửi.');
      validUntilRef.current?.focus();
      return;
    }

    // Một dòng được coi là "đã chào" khi: có giá > 0, HOẶC tick FOC (miễn phí).
    const filledItems = quoteItems.filter(
      qi => qi.can_do && (qi.free_charge || (!!qi.unit_price && parseFloat(qi.unit_price) > 0)),
    );
    if (filledItems.length === 0) {
      setError('Vui lòng nhập giá (hoặc tick "Miễn phí (FOC)") cho ít nhất 1 item, hoặc bỏ tick "Báo được" nếu không cung cấp được');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api.post('/api/vendor/quotes/submit', buildQuotePayload());
      setSuccess(true);
    } catch (err: any) {
      setError(err?.detail ?? 'Gửi báo giá thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    setDeclining(true);
    setError('');
    try {
      await api.post(`/api/vendor/batches/${batchId}/decline`, {
        reason: declineReason || null,
      });
      setDeclined(true);
      setShowDecline(false);
    } catch (err: any) {
      setError(err?.detail ?? 'Từ chối thất bại');
    } finally {
      setDeclining(false);
    }
  };

  // #16-P2 — thu hồi báo giá đã gửi (lý do bắt buộc). Sau khi rút, flip status
  // 'withdrawn' tại chỗ: submittedCurrentRound → false ⇒ canQuote bật lại, form
  // (đã seed từ báo giá vừa rút) hiện ngay để NCC "Báo giá lại" cùng vòng.
  const handleWithdraw = async () => {
    if (!myQuote || !withdrawReason.trim()) return;
    setWithdrawing(true);
    setError('');
    try {
      await api.patch(`/api/vendor/quotes/${myQuote.id}/withdraw`, {
        reason: withdrawReason.trim(),
      });
      setMyQuote(q =>
        q ? { ...q, status: 'withdrawn', withdraw_reason: withdrawReason.trim() } : q,
      );
      setEditing(false);
      setShowWithdraw(false);
    } catch (err: any) {
      setError(err?.detail ?? 'Thu hồi báo giá thất bại');
    } finally {
      setWithdrawing(false);
    }
  };

  // Drawing viewer: drawing_url carries a non-browser scheme (file://… / bqms://…)
  // after P5, so a plain <a href> can't open it. Fetch the authed blob from the
  // invitation-gated vendor drawing endpoint (Bearer token via api.blob), then
  // open it in a new tab (pdf/image) or download it (dwg/octet-stream).
  const [viewingDrawing, setViewingDrawing] = useState<number | null>(null);
  // Read-only per-line attachment reveal (see handleViewLineAttachments below).
  const [attachmentInfo, setAttachmentInfo] = useState<string[] | null>(null);
  const handleViewDrawing = async (itemId: number) => {
    setViewingDrawing(itemId);
    setError('');
    try {
      const blob = await api.blob(
        `/api/vendor/quotes/batches/${batchId}/items/${itemId}/drawing`,
      );
      const url = URL.createObjectURL(blob);
      const inlineable = blob.type.startsWith('image/') || blob.type.includes('pdf');
      if (inlineable) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `ban-ve-${itemId}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // Revoke after a tick so the new tab / download has grabbed the bytes.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      setError(err?.detail ?? 'Không mở được bản vẽ');
    } finally {
      setViewingDrawing(null);
    }
  };

  // Tải file Song Châu CHIA SẺ cho mã (Bearer qua api.blob). Backend chỉ phục vụ
  // file đã được admin tick chia sẻ + đợt được mời; KHÔNG lộ rfq_number nội bộ.
  const [dlKey, setDlKey] = useState<string | null>(null);
  const downloadSharedFile = async (itemId: number, kind: string, name: string) => {
    setDlKey(`${itemId}/${kind}/${name}`);
    setError('');
    try {
      const blob = await api.blob(
        `/api/vendor/batches/${batchId}/items/${itemId}/files/download?kind=${kind}&name=${encodeURIComponent(name)}`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      setError(err?.detail ?? 'Không tải được file');
    } finally {
      setDlKey(null);
    }
  };

  // Read-only per-line attachment reveal. The vendor's own quote-line files are
  // stored as sandboxed paths (vendor_quote_items.attachment_paths) and there is
  // no read-back GET route for them yet (M1 = zero-backend). Until that endpoint
  // lands we surface the filenames so the buyer can see WHAT was attached; the
  // dot already carries the same list in its title. The download wiring slots in
  // here (api.blob → object-URL) the moment the route exists — no UI change.
  const handleViewLineAttachments = (paths?: string[] | null) => {
    if (!paths || paths.length === 0) return;
    const names = paths.map(p => p.split(/[\\/]/).pop() || p);
    setError('');
    setAttachmentInfo(names);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('batch_id', String(batchId));
      fd.append('file', file);
      await api.upload('/api/vendor/quotes/upload-file', fd);
      setUploadedName(file.name);
    } catch (err: any) {
      setError(err?.detail ?? 'Tải file thất bại');
    } finally {
      setUploadingFile(false);
      e.target.value = '';
    }
  };

  // Decline modal a11y: Escape-to-close + body-scroll lock while open, plus
  // textarea autofocus (see ref below). handleDecline / payload unchanged.
  useEffect(() => {
    if (!showDecline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDecline(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [showDecline]);

  const declineTextareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (showDecline) declineTextareaRef.current?.focus();
  }, [showDecline]);

  // Withdraw modal a11y: Escape-to-close + body-scroll lock + textarea autofocus
  // (mirror of the decline modal). Declared BEFORE any early return so hook order
  // is stable.
  useEffect(() => {
    if (!showWithdraw) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowWithdraw(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [showWithdraw]);

  const withdrawTextareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (showWithdraw) withdrawTextareaRef.current?.focus();
  }, [showWithdraw]);

  // #15 — fetch gợi ý vị thế CHỈ khi NCC đã nộp vòng hiện tại. Endpoint trả 404 khi
  // admin chưa bật cờ (mặc định) HOẶC chưa được mời ⇒ nuốt im lặng (rankHint=null,
  // không toast). Các trạng thái khác (chưa đủ NCC / chưa nộp) backend trả
  // available:false. Không bao giờ lộ giá/tên/rank số.
  useEffect(() => {
    const submittedThisRound =
      myQuote?.status === 'submitted' && (myQuote?.round_number ?? 1) === currentRound;
    if (!batchId || !submittedThisRound) {
      setRankHint(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get<{ data: RankHint }>(
          `/api/vendor/quotes/batches/${batchId}/rank-hint`,
        );
        if (!cancelled) setRankHint(r.data);
      } catch {
        // 404 (cờ tắt / không mời) hoặc lỗi khác → ẩn im lặng.
        if (!cancelled) setRankHint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batchId, myQuote?.status, myQuote?.round_number, currentRound]);

  if (loading)
    return (
      <div className="min-h-screen bg-slate-50">
        <PortalNav />
        <div className="flex items-center justify-center py-32">
          <div className="flex items-center gap-2 text-slate-400">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-sm">Đang tải...</span>
          </div>
        </div>
      </div>
    );

  // Load-failure full screen — keep the shared header for orientation.
  if (error && !batch) {
    return (
      <div className="min-h-screen bg-slate-50">
        <PortalNav />
        <main className="max-w-[1400px] mx-auto px-6 py-16">
          <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-rose-50">
              <svg className="h-7 w-7 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m0 3.75h.008M10.34 3.94l-7.5 12.99A1.5 1.5 0 004.14 19.5h15.72a1.5 1.5 0 001.3-2.57l-7.5-12.99a1.5 1.5 0 00-2.6 0z" />
              </svg>
            </div>
            <p className="mb-4 text-sm text-rose-700">{error}</p>
            <Link href="/dashboard" className="text-brand-600 font-medium hover:underline">
              ← Về trang chủ
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const myQuoteRound = myQuote?.round_number ?? 1;
  // Already submitted FOR THE CURRENT ROUND (a previous-round submission must not
  // block re-quoting once admin opens the next round).
  const submittedCurrentRound =
    myQuote?.status === 'submitted' && myQuoteRound === currentRound;
  const batchOpen = batch?.status === 'published';
  const canQuote = batchOpen && !submittedCurrentRound && !declined;

  // Award outcome for this vendor's quote (set by the admin award handler:
  // winner -> 'awarded', others -> 'rejected'). Batch flips to 'awarded'.
  const isAwarded = myQuote?.status === 'awarded';
  const isRejected = myQuote?.status === 'rejected';
  // #16-P2 — NCC đã tự thu hồi báo giá (rút khỏi cuộc). canQuote tự bật true vì
  // submittedCurrentRound=false → form "Báo giá lại" hiện ngay.
  const isWithdrawn = myQuote?.status === 'withdrawn';
  const batchAwarded = batch?.status === 'awarded';

  // Deadline for the round currently being quoted (header "Hạn vòng N").
  const roundDeadline =
    currentRound === 3 ? batch?.deadline_round3
    : currentRound === 2 ? batch?.deadline_round2
    : batch?.deadline_round1;

  // ── Sửa/nộp lại trước deadline (Đợt-9 item 2) ──
  // Hạn hiệu lực: ưu tiên hạn vòng hiện tại, fallback hạn nộp tổng. withinDeadline
  // chỉ là UX client-side — chốt cứng chống nộp sau hạn ở BE (NOW() server-side,
  // quotes.py:233). Lệch giờ vendor vẫn nhận 400 và hiển thị qua banner lỗi.
  const effectiveDeadline = roundDeadline ?? batch?.bid_deadline ?? null;
  const withinDeadline =
    !effectiveDeadline || new Date(effectiveDeadline).getTime() > Date.now();
  // Đã gửi vòng hiện tại + batch còn published + còn hạn + chưa từ chối/chưa trao
  // → cho phép mở lại form sửa rồi nộp đè.
  const canEdit =
    batchOpen && submittedCurrentRound && !declined && !batchAwarded && withinDeadline;

  // Form chỉnh báo giá đang hiện (mời lần đầu HOẶC bấm "Sửa lại" còn hạn) → footer
  // sticky + grid chỉnh hiện. Quyết định luôn cả việc render footer Gửi báo giá.
  const showQuoteForm = canQuote || (canEdit && editing);

  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav />

      <main className={`max-w-[1400px] mx-auto px-6 py-5 ${showQuoteForm ? 'pb-24' : 'pb-10'}`}>
        {/* Success — inline confirmation card; keeps header/context (no full-page swap) */}
        {success ? (
          <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-bold text-slate-800">
              {editing ? 'Đã cập nhật báo giá!' : 'Báo giá đã gửi!'}
            </h2>
            <p className="mb-1 text-sm text-slate-600">
              Đợt: {batch?.batch_code} — {batch?.title}
            </p>
            {currentRound > 1 && (
              <p className="mb-1 text-xs font-semibold text-brand-700">Vòng {currentRound}</p>
            )}
            <p className="mb-4 text-sm text-slate-500 tabular-nums">
              Tổng: {formatMoneyNum(totalAmount)} {currency}
            </p>
            <Link href="/dashboard" className="font-medium text-brand-600 hover:underline">
              ← Về trang chủ
            </Link>
          </div>
        ) : (
          <>
            {/* ── Context bar (compact, 2-line, sticky under nav) ── */}
            <div className="sticky top-14 z-20 -mx-6 mb-4 border-b border-slate-200 bg-white/95 px-6 py-2.5 shadow-sm backdrop-blur">
              {/* Line 1 — identity */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span className="hidden sm:inline">Quay lại</span>
                </Link>
                <span className="rounded bg-brand-50 px-2 py-0.5 font-mono text-xs font-semibold text-brand-600">
                  {batch?.batch_code}
                </span>
                <h1 className="truncate text-base font-bold text-slate-800">{batch?.title}</h1>
                {currentRound > 1 && (
                  <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">
                    Vòng {currentRound}
                  </span>
                )}
                <div className="ml-auto shrink-0">
                  <StatusChip kind="inv" status={declined ? 'declined' : batch?.inv_status} withDot />
                </div>
              </div>
              {/* Line 2 — meta strip */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-semibold uppercase tracking-wider text-slate-400">Hạn</span>
                  <Deadline date={batch?.bid_deadline ?? null} relative={false} />
                  <DDay date={batch?.bid_deadline ?? null} />
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-semibold uppercase tracking-wider text-slate-400">Hạn vòng {currentRound}</span>
                  <Deadline date={roundDeadline ?? null} relative={false} />
                  <DDay date={roundDeadline ?? null} />
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  {batch?.award_mode === 'per_item' ? 'Chọn theo từng mục' : 'Chọn theo cả đợt'}
                </span>
                <span className="text-slate-300">·</span>
                <span><span className="font-semibold tabular-nums text-slate-700">{items.length}</span> mục</span>
                {(batch?.req_name || batch?.requester) && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>Người mời: <span className="text-slate-700">{batch?.req_name || batch?.requester}</span></span>
                  </>
                )}
                {batch?.department && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>{batch.department}</span>
                  </>
                )}
                {batch?.description && (
                  <button
                    type="button"
                    onClick={() => setDescOpen(o => !o)}
                    aria-expanded={descOpen}
                    className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-brand-600 transition-colors hover:bg-brand-50"
                  >
                    Mô tả
                    <svg
                      className={`h-3 w-3 transition-transform ${descOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                )}
              </div>
              {/* Disclosure — full description */}
              {descOpen && batch?.description && (
                <p className="mt-2 whitespace-pre-wrap border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-600">
                  {batch.description}
                </p>
              )}
            </div>

            {/* Award result banner */}
            {(isAwarded || isRejected) && (
              <div
                className={`mb-4 rounded-xl border p-4 shadow-sm ${
                  isAwarded ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge {...quoteStatusCfg(myQuote?.status)} withDot />
                  <p
                    className={`text-sm font-medium ${
                      isAwarded ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {isAwarded
                      ? 'Chúc mừng! Báo giá của bạn đã được chọn trúng thầu.'
                      : 'Báo giá của bạn không được chọn cho đợt này.'}
                  </p>
                </div>
                {myQuote?.round_number != null && myQuote.round_number > 1 && (
                  <p className="mt-1 text-xs text-slate-500">Kết quả vòng {myQuote.round_number}</p>
                )}
              </div>
            )}

            {/* Declined banner */}
            {declined && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                <p className="text-sm font-medium text-slate-600">
                  Bạn đã từ chối tham gia đợt báo giá này.
                </p>
                {batch?.decline_reason && (
                  <p className="mt-1 text-xs text-slate-400">Lý do: {batch.decline_reason}</p>
                )}
              </div>
            )}

            {/* Withdrawn banner (#16-P2). Form "Báo giá lại" hiện bên dưới khi còn hạn. */}
            {isWithdrawn && !declined && !batchAwarded && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <Badge {...quoteStatusCfg('withdrawn')} withDot />
                  <p className="text-sm font-medium text-slate-600">
                    Bạn đã thu hồi báo giá. Có thể báo giá lại trước hạn nộp.
                  </p>
                </div>
                {myQuote?.withdraw_reason && (
                  <p className="mt-1 text-xs text-slate-400">Lý do: {myQuote.withdraw_reason}</p>
                )}
              </div>
            )}

            {/* Submitted banner (current round, batch still open). Ẩn khi đang sửa. */}
            {submittedCurrentRound && !declined && !batchAwarded && !editing && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-emerald-700">
                    {canEdit
                      ? `✓ Đã gửi báo giá${currentRound > 1 ? ` vòng ${currentRound}` : ''} — còn sửa được`
                      : `✓ Đã gửi báo giá${currentRound > 1 ? ` vòng ${currentRound}` : ''} — đã quá hạn sửa`}
                  </p>
                  {canEdit && effectiveDeadline && (
                    <p className="mt-0.5 text-xs text-emerald-600/80">
                      Sửa lại trước {formatDate(effectiveDeadline)}
                    </p>
                  )}
                  {/* Read-back: file + link đã gửi kèm báo giá */}
                  {(myQuote?.attachment_filename || myQuote?.external_url) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {myQuote?.attachment_filename && (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          <span className="max-w-[220px] truncate">{myQuote.attachment_filename}</span>
                        </span>
                      )}
                      {myQuote?.external_url && (
                        <a
                          href={myQuote.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-brand-600 underline-offset-2 hover:underline"
                        >
                          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          Link tham khảo
                        </a>
                      )}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowWithdraw(true)}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:border-rose-300 hover:text-rose-700"
                    >
                      Thu hồi báo giá
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        // Re-snapshot form hiện tại để beforeunload guard phát hiện chỉnh sửa mới (đặt '' sẽ tắt guard cả phiên).
                        pristineRef.current = JSON.stringify({ currency, leadTime, validUntil, externalUrl, moqNotes, generalNotes, quoteItems });
                      }}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700"
                    >
                      Sửa lại báo giá
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Closed (not awarded) banner — not open for quoting */}
            {!batchOpen && !batchAwarded && !submittedCurrentRound && !declined && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                <p className="text-sm font-medium text-amber-700">
                  Đợt báo giá này đã đóng. Không thể gửi báo giá mới.
                </p>
              </div>
            )}

            {/* #15 — Banner gợi ý vị thế (band-mờ). CHỈ hiện khi đã nộp vòng hiện tại,
                chưa từ chối, chưa trao thầu, VÀ backend trả available:true. Chấm
                trung tính sky/slate — KHÔNG đỏ/xanh gắt, KHÔNG số/rank/giá/tên đối thủ. */}
            {submittedCurrentRound && !declined && !batchAwarded &&
              rankHint?.available && rankHint.band && (
              <div className="mb-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    rankHint.band === 'leading' ? 'bg-sky-500' : 'bg-slate-400'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700">{rankHint.label}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Gợi ý vị thế dựa trên báo giá của bạn ở đợt này — chỉ mang tính tham khảo.
                  </p>
                </div>
              </div>
            )}

            {/* ── Tab strip: Báo giá | Hỏi đáp | Đã gửi ── */}
            <div className="mb-4 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setActiveTab('quote')}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === 'quote'
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`}
              >
                Báo giá
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('qa')}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === 'qa'
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`}
              >
                Hỏi đáp
              </button>
              {myQuote && (
                <button
                  type="button"
                  onClick={() => setActiveTab('submitted')}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    activeTab === 'submitted'
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                  }`}
                >
                  Đã gửi
                </button>
              )}
            </div>

            {/* ── TAB: Báo giá (quote entry form) ── */}
            <div className={activeTab === 'quote' ? '' : 'hidden'}>
              {showQuoteForm ? (
                <>
                  {/* Reverse-auction prefill notice */}
                  {seededFromPrevRound && (
                    <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 p-4 ring-1 ring-inset ring-brand-200">
                      <p className="text-sm font-bold text-brand-800">
                        Báo giá vòng trước — chỉnh để nộp vòng {currentRound}
                      </p>
                      <p className="mt-1 text-xs text-brand-700/80">
                        Form đã điền sẵn giá bạn báo ở vòng {prevRoundNumber ?? currentRound - 1} làm điểm
                        khởi đầu. Hãy điều chỉnh (thường là giảm giá) rồi gửi cho vòng {currentRound}.
                      </p>
                    </div>
                  )}

                  {/* ── Toolbar: currency · valid_until · default lead-time · MOQ · notes ── */}
                  <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <div className="min-w-[110px]">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Tiền tệ
                      </label>
                      <select
                        value={currency}
                        onChange={e => setCurrency(e.target.value)}
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      >
                        {CURRENCY_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-[150px]">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Hiệu lực báo giá đến <span className="text-rose-500" title="Bắt buộc khi Gửi báo giá">*</span>
                      </label>
                      <input
                        ref={validUntilRef}
                        type="date"
                        value={validUntil}
                        onChange={e => { setValidUntil(e.target.value); if (submitGateError) setSubmitGateError(''); }}
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </div>
                    <div className="min-w-[110px]">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Lead-time mặc định (ngày)
                      </label>
                      <input
                        type="number"
                        value={leadTime}
                        onChange={e => setLeadTime(e.target.value)}
                        placeholder="14"
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm tabular-nums focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </div>
                    <div className="min-w-[150px] flex-1">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Điều kiện MOQ chung
                      </label>
                      <input
                        type="text"
                        value={moqNotes}
                        onChange={e => setMoqNotes(e.target.value)}
                        placeholder="MOQ 100 pcs"
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </div>
                    <div className="min-w-[170px] flex-1">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Ý kiến / Ghi chú chung <span className="text-rose-500" title="Bắt buộc khi Gửi báo giá">*</span>
                      </label>
                      <input
                        ref={generalNotesRef}
                        type="text"
                        value={generalNotes}
                        onChange={e => { setGeneralNotes(e.target.value); if (submitGateError) setSubmitGateError(''); }}
                        placeholder="Điều khoản, đóng gói…"
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </div>
                  </div>

                  {/* ── Dense per-item quote table (sticky header) ── */}
                  <div className="mb-4 max-h-[calc(100vh-360px)] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                    {/* +1 cột "Giá vòng trước" (read-only) → min-w 1100→1280; container
                        đã overflow-x nên rộng quá vẫn cuộn ngang được, không vỡ mobile. */}
                    <table className="w-full min-w-[1280px] border-collapse text-left">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          <th className="w-9 px-2 py-2 text-center">STT</th>
                          <th className="px-3 py-2">Mã / BQMS · Tên / Spec</th>
                          <th className="w-24 px-2 py-2">Vật liệu</th>
                          <th className="w-10 px-2 py-2 text-center">BV</th>
                          <th className="w-16 px-2 py-2 text-right">SL YC</th>
                          <th className="w-12 px-2 py-2 text-center">ĐVT</th>
                          <th className="w-24 px-2 py-2 text-right text-slate-400">Giá vòng trước</th>
                          <th className="w-32 px-2 py-2 text-right">Đơn giá</th>
                          <th className="w-20 px-2 py-2 text-right">SL chào</th>
                          <th className="w-20 px-2 py-2 text-right">MOQ</th>
                          <th className="w-16 px-2 py-2 text-center">Lead</th>
                          <th className="w-20 px-2 py-2 text-center">Tiền tệ</th>
                          <th className="w-28 px-2 py-2 text-right">Thành tiền</th>
                          <th className="w-16 px-2 py-2 text-center bg-amber-50/60 text-amber-700">Báo được</th>
                          <th className="w-28 px-2 py-2">Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody
                        ref={gridBodyRef}
                        onKeyDown={onGridKeyDown}
                        className="divide-y divide-slate-100"
                      >
                        {items.map((item, idx) => {
                          const qi = quoteItems[idx];
                          if (!qi) return null;
                          const lineTotal = lineTotalOf(qi);
                          const prev = prevPrices[item.id] ?? null;
                          const recessed = !qi.can_do;
                          return (
                            <tr
                              key={item.id}
                              className={
                                recessed
                                  ? 'bg-rose-50/40'
                                  : 'transition-colors odd:bg-slate-50/40 hover:bg-slate-50'
                              }
                            >
                              {/* STT */}
                              <td className="px-2 py-2 text-center align-top font-mono text-[11px] text-slate-400 tabular-nums">
                                {item.item_no}
                              </td>
                              {/* Mã/BQMS · Tên/Spec */}
                              <td className="px-3 py-2 align-top">
                                <ItemDescCell
                                  code={item.bqms_code}
                                  spec={item.specification}
                                  part={item.part_no}
                                  maker={item.maker}
                                  model={item.dimension}
                                />
                                {item.notes && (
                                  <p className="mt-0.5 text-[10px] italic text-slate-400">{item.notes}</p>
                                )}
                                {item.shared_files && item.shared_files.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {item.shared_files.map((sf) => (
                                      <button
                                        key={`${sf.kind}/${sf.file_name}`}
                                        type="button"
                                        onClick={() => downloadSharedFile(item.id, sf.kind, sf.file_name)}
                                        disabled={dlKey === `${item.id}/${sf.kind}/${sf.file_name}`}
                                        title={`Tải tệp Song Châu chia sẻ: ${sf.file_name}`}
                                        className="inline-flex max-w-[170px] items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50"
                                      >
                                        <svg className="h-2.5 w-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                                        </svg>
                                        <span className="truncate">{sf.file_name}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </td>
                              {/* Vật liệu */}
                              <td className="px-2 py-2 align-top text-[11px] text-slate-600">
                                {item.required_material || <span className="text-slate-300">—</span>}
                              </td>
                              {/* Bản vẽ (inline icon button) */}
                              <td className="px-2 py-2 text-center align-top">
                                {item.drawing_url ? (
                                  <button
                                    type="button"
                                    onClick={() => handleViewDrawing(item.id)}
                                    disabled={viewingDrawing === item.id}
                                    title={item.drawing_filename || 'Xem bản vẽ'}
                                    aria-label="Xem bản vẽ"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-brand-200 text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-50"
                                  >
                                    {viewingDrawing === item.id ? (
                                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                      </svg>
                                    ) : (
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                              {/* SL yêu cầu */}
                              <td className="px-2 py-2 text-right align-top font-mono text-[11px] text-slate-600 tabular-nums">
                                {item.quantity?.toLocaleString('vi-VN')}
                              </td>
                              {/* ĐVT */}
                              <td className="px-2 py-2 text-center align-top text-[11px] text-slate-500">
                                {item.unit || <span className="text-slate-300">—</span>}
                              </td>
                              {/* Giá vòng trước (read-only) — giá CHÍNH NCC này báo vòng
                                  trước, KHÔNG bao giờ là giá đối thủ. '—' khi không có. */}
                              <td className="px-2 py-2 text-right align-top font-mono text-[11px] text-slate-400 tabular-nums">
                                {prev != null ? formatMoneyNum(prev) : <span className="text-slate-300">—</span>}
                              </td>
                              {/* Đơn giá (editable) + FOC pill IN-CELL */}
                              <td className="px-2 py-2 align-top">
                                <QtyPriceCell
                                  value={qi.free_charge ? '0' : qi.unit_price}
                                  onChange={v => updateItem(idx, 'unit_price', v)}
                                  disabled={!qi.can_do || qi.free_charge}
                                  placeholder={qi.can_do ? (qi.free_charge ? 'FOC' : '0') : '—'}
                                  ariaLabel="Đơn giá"
                                  dataCell={`r${idx}-cprice`}
                                  onPaste={e => onPriceColumnPaste(idx, e)}
                                />
                                {qi.can_do && (
                                  <button
                                    type="button"
                                    onClick={() => updateItem(idx, 'free_charge', !qi.free_charge)}
                                    aria-pressed={qi.free_charge}
                                    title="Cung cấp MIỄN PHÍ (Free of Charge): đơn giá = 0, không tính vào so sánh giá thấp nhất. Khác với bỏ tick 'Báo được' (= không cung cấp được)."
                                    className={
                                      'mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ' +
                                      (qi.free_charge
                                        ? 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-300'
                                        : 'bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-emerald-50 hover:text-emerald-600')
                                    }
                                  >
                                    FOC
                                  </button>
                                )}
                              </td>
                              {/* SL chào */}
                              <td className="px-2 py-2 align-top">
                                <QtyPriceCell
                                  value={qi.offered_qty}
                                  onChange={v => updateItem(idx, 'offered_qty', v)}
                                  disabled={!qi.can_do}
                                  placeholder={qi.can_do ? qi.quantity || '—' : '—'}
                                  ariaLabel="Số lượng chào"
                                  dataCell={`r${idx}-coffered`}
                                />
                              </td>
                              {/* MOQ */}
                              <td className="px-2 py-2 align-top">
                                <input
                                  type="text"
                                  value={qi.moq}
                                  disabled={!qi.can_do}
                                  data-cell={`r${idx}-cmoq`}
                                  onChange={e => updateItem(idx, 'moq', e.target.value)}
                                  placeholder={qi.can_do ? 'MOQ' : '—'}
                                  aria-label="Số lượng đặt tối thiểu"
                                  className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-right text-[11px] tabular-nums focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                                />
                              </td>
                              {/* Lead time */}
                              <td className="px-2 py-2 align-top">
                                <input
                                  type="number"
                                  value={qi.lead_time_days}
                                  disabled={!qi.can_do}
                                  data-cell={`r${idx}-clead`}
                                  onChange={e => updateItem(idx, 'lead_time_days', e.target.value)}
                                  placeholder={qi.can_do ? '—' : '—'}
                                  aria-label="Thời gian giao (ngày)"
                                  className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-center text-[11px] tabular-nums focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                                />
                              </td>
                              {/* Per-line currency */}
                              <td className="px-2 py-2 align-top">
                                <select
                                  value={qi.currency}
                                  disabled={!qi.can_do}
                                  data-cell={`r${idx}-ccurrency`}
                                  onChange={e => updateItem(idx, 'currency', e.target.value)}
                                  aria-label="Tiền tệ dòng"
                                  className="h-8 w-full rounded-lg border border-slate-200 bg-white px-1 text-[11px] focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                                >
                                  {CURRENCY_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.value}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              {/* Thành tiền */}
                              <td className="px-2 py-2 text-right align-top font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
                                {qi.can_do && lineTotal > 0 ? (
                                  <>
                                    {formatMoneyNum(lineTotal)}
                                    <span className="ml-1 text-[10px] font-normal text-slate-400">{qi.currency}</span>
                                  </>
                                ) : qi.can_do && qi.free_charge ? (
                                  <span className="font-semibold text-emerald-600">FOC</span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                              {/* Báo được */}
                              <td className="px-2 py-2 text-center align-top">
                                <input
                                  type="checkbox"
                                  checked={qi.can_do}
                                  data-cell={`r${idx}-ccando`}
                                  onChange={e => updateItem(idx, 'can_do', e.target.checked)}
                                  className="h-4 w-4 cursor-pointer accent-brand-600"
                                  aria-label="Báo giá được item này"
                                />
                              </td>
                              {/* Ghi chú (+ inline "không cung cấp — lý do" when recessed) */}
                              <td className="px-2 py-2 align-top">
                                <input
                                  type="text"
                                  value={qi.notes}
                                  data-cell={`r${idx}-cnotes`}
                                  onChange={e => updateItem(idx, 'notes', e.target.value)}
                                  placeholder={qi.can_do ? 'Ghi chú' : 'Lý do không cung cấp…'}
                                  aria-label={qi.can_do ? 'Ghi chú dòng' : 'Lý do không cung cấp'}
                                  className={
                                    'h-8 w-full rounded-lg border bg-white px-2 text-[11px] focus:outline-none focus:ring-2 ' +
                                    (qi.can_do
                                      ? 'border-slate-200 focus:border-brand-400 focus:ring-brand-100'
                                      : 'border-rose-200 text-rose-700 placeholder:text-rose-300 focus:border-rose-400 focus:ring-rose-100')
                                  }
                                />
                                {!qi.can_do && (
                                  <p className="mt-0.5 text-[10px] font-medium text-rose-500">Không cung cấp</p>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Đính kèm: file + link tham khảo (tùy chọn) — khu vực gọn gần footer */}
                  <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700">Đính kèm file (tùy chọn)</p>
                        <p className="text-xs text-slate-400">Excel (.xlsx, .xls), PDF hoặc ảnh (.jpg, .png), tối đa 10MB</p>
                        {uploadedName && (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-emerald-600">
                            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="truncate">Đã tải: {uploadedName}</span>
                          </p>
                        )}
                      </div>
                      <label
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-brand-200 px-4 py-2 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 ${
                          uploadingFile ? 'pointer-events-none opacity-70' : ''
                        }`}
                      >
                        {uploadingFile ? (
                          <>
                            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                            Đang tải...
                          </>
                        ) : uploadedName ? (
                          'Đổi file'
                        ) : (
                          'Chọn file'
                        )}
                        <input
                          type="file"
                          accept=".xlsx,.xls,.pdf,.jpg,.jpeg,.png"
                          onChange={handleFileUpload}
                          disabled={uploadingFile}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {/* Link tham khảo (URL) — cấp báo giá. Chỉ http(s) được server giữ lại. */}
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <label htmlFor="external-url" className="text-sm font-medium text-slate-700">
                        Link tham khảo (tùy chọn)
                      </label>
                      <p className="text-xs text-slate-400">
                        Dán link OneDrive / Google Drive / website — bắt đầu bằng http:// hoặc https://
                      </p>
                      <input
                        id="external-url"
                        type="url"
                        inputMode="url"
                        value={externalUrl}
                        onChange={e => setExternalUrl(e.target.value)}
                        placeholder="https://..."
                        className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-sm">
                  {myQuote
                    ? 'Báo giá đã gửi — xem ở tab "Đã gửi".'
                    : 'Hiện chưa thể nhập báo giá cho đợt này.'}
                </div>
              )}
            </div>

            {/* ── TAB: Hỏi đáp (Q&A + addendum) ── */}
            <div className={activeTab === 'qa' ? '' : 'hidden'}>
              {/* Đợt 2a #12 — Hỏi đáp (Q&A riêng) + Phụ lục (broadcast) cho đợt này. */}
              <QuoteThread batchId={batchId} />
            </div>

            {/* ── TAB: Đã gửi (read-only submitted quote) ── */}
            <div className={activeTab === 'submitted' ? '' : 'hidden'}>
              {myQuote ? (
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-700">
                      Báo giá đã gửi ({myQuote.currency})
                    </h3>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('quote');
                          setEditing(true);
                          // Re-snapshot form hiện tại để beforeunload guard phát hiện chỉnh sửa mới (đặt '' sẽ tắt guard cả phiên).
                          pristineRef.current = JSON.stringify({ currency, leadTime, validUntil, externalUrl, moqNotes, generalNotes, quoteItems });
                        }}
                        className="shrink-0 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700"
                      >
                        Sửa lại báo giá
                      </button>
                    )}
                  </div>
                  <FieldGrid
                    cols={4}
                    className="mb-4"
                    fields={[
                      { label: 'Vòng', value: myQuote.round_number ?? 1, mono: true },
                      {
                        label: 'Gửi lúc',
                        value: myQuote.submitted_at ? formatDate(myQuote.submitted_at) : null,
                        mono: true,
                      },
                      {
                        label: 'Hiệu lực đến',
                        value: <Deadline date={myQuote.valid_until ?? null} />,
                      },
                      { label: 'Số mục', value: (myQuote.items || []).length, mono: true },
                    ]}
                  />
                  <div className="-mx-5 overflow-x-auto border-y border-slate-100">
                    <table className="w-full min-w-[1040px] border-collapse text-[11px]">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          <th className="w-10 px-3 py-2 text-left">STT</th>
                          <th className="px-3 py-2 text-left">Mã hàng &amp; mô tả</th>
                          <th className="px-3 py-2 text-right">Đơn giá</th>
                          <th className="px-3 py-2 text-right">SL YC</th>
                          <th className="px-3 py-2 text-right">SL chào</th>
                          <th className="px-3 py-2 text-left">MOQ</th>
                          <th className="px-3 py-2 text-center">Lead</th>
                          <th className="px-3 py-2 text-center">CCY</th>
                          <th className="px-3 py-2 text-right">Thành tiền</th>
                          <th className="px-3 py-2 text-left">Ghi chú</th>
                          <th className="px-3 py-2 text-center">Tệp</th>
                          <th className="px-3 py-2 text-left">Cờ dòng</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(myQuote.items || []).map((qi, idx) => {
                          const item = items.find(i => i.id === qi.item_id);
                          const stt = item?.item_no ?? idx + 1;
                          const reqQty = qi.quantity ?? item?.quantity ?? null;
                          const lineCcy = qi.currency || myQuote.currency;
                          const offered = qi.offered_qty ?? reqQty;
                          const lineTotal =
                            qi.can_do === false || qi.free_charge
                              ? null
                              : Number(qi.unit_price) * Number(offered ?? 0);
                          const showShort =
                            qi.can_do !== false &&
                            qi.offered_qty != null &&
                            reqQty != null &&
                            Number(qi.offered_qty) < Number(reqQty);
                          const attachCount = qi.attachment_paths?.length ?? 0;
                          return (
                            <tr
                              key={qi.item_id}
                              className={`transition-colors odd:bg-slate-50/40 hover:bg-slate-50 ${
                                qi.can_do === false ? 'bg-rose-50/40' : ''
                              }`}
                            >
                              <td className="px-3 py-2 text-left font-mono tabular-nums text-slate-400">
                                {stt}
                              </td>
                              <td
                                className={`px-3 py-2 ${
                                  qi.free_charge ? 'border-l-2 border-emerald-400 pl-2.5' : ''
                                }`}
                              >
                                <ItemDescCell
                                  code={item?.bqms_code}
                                  spec={item?.specification || `Item #${qi.item_id}`}
                                  material={item?.required_material}
                                  part={item?.part_no}
                                  maker={item?.maker}
                                  model={item?.model}
                                />
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                                {qi.can_do === false || qi.free_charge ? '—' : formatMoneyNum(Number(qi.unit_price))}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                                {reqQty ?? '—'}
                              </td>
                              <td
                                className={`px-3 py-2 text-right font-mono tabular-nums ${
                                  showShort ? 'text-amber-600' : 'text-slate-700'
                                }`}
                              >
                                {qi.can_do === false ? '—' : offered ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-left text-slate-500">
                                {qi.can_do === false ? '—' : qi.moq || '—'}
                              </td>
                              <td className="px-3 py-2 text-center font-mono tabular-nums text-slate-500">
                                {qi.lead_time_days != null ? `${qi.lead_time_days}n` : '—'}
                              </td>
                              <td className="px-3 py-2 text-center text-slate-500">{lineCcy}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                                {lineTotal == null ? '—' : formatMoneyNum(lineTotal)}
                              </td>
                              <td className="max-w-[160px] whitespace-pre-wrap px-3 py-2 text-[11px] text-slate-500">
                                {qi.notes || '—'}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <AttachmentDot
                                  count={attachCount}
                                  onClick={() => handleViewLineAttachments(qi.attachment_paths)}
                                  title={
                                    attachCount
                                      ? qi.attachment_paths!
                                          .map(p => p.split(/[\\/]/).pop() || p)
                                          .join('\n')
                                      : undefined
                                  }
                                />
                              </td>
                              <td className="px-3 py-2 text-left">
                                {qi.free_charge ? (
                                  <Badge label="FOC" className="bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200" />
                                ) : qi.can_do === false ? (
                                  <Badge label="Không cung cấp" className="bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200" />
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {(myQuote.moq_notes || myQuote.notes) && (
                    <div className="mt-3 space-y-0.5 text-xs text-slate-500">
                      {myQuote.moq_notes && <p>MOQ: {myQuote.moq_notes}</p>}
                      {myQuote.notes && <p>Ghi chú: {myQuote.notes}</p>}
                    </div>
                  )}
                  {attachmentInfo && (
                    <div
                      role="status"
                      className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600"
                    >
                      <p className="mb-1 font-semibold text-slate-700">Tệp đính kèm của dòng:</p>
                      <ul className="list-inside list-disc space-y-0.5 font-mono">
                        {attachmentInfo.map((n, i) => (
                          <li key={i} className="truncate">{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(() => {
                    // Per-currency totals — group lines on (currency || quote.currency)
                    // and sum line_total = unit_price × offered_qty, skipping
                    // can_do===false and free_charge lines so currencies never mix.
                    const byCcy = new Map<string, number>();
                    for (const qi of myQuote.items || []) {
                      if (qi.can_do === false || qi.free_charge) continue;
                      const ccy = qi.currency || myQuote.currency;
                      const offered = qi.offered_qty ?? qi.quantity;
                      const amt = Number(qi.unit_price) * Number(offered ?? 0);
                      if (!Number.isFinite(amt)) continue;
                      byCcy.set(ccy, (byCcy.get(ccy) ?? 0) + amt);
                    }
                    const totals = Array.from(byCcy, ([currency, amount]) => ({ currency, amount }));
                    return (
                      <div className="mt-3 space-y-1">
                        <CurrencyTotalRow totals={totals} />
                        {myQuote.submitted_at && (
                          <p className="text-right text-[11px] text-slate-400">
                            đã gửi {formatDate(myQuote.submitted_at)}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-sm">
                  Chưa có báo giá nào được gửi.
                </div>
              )}
            </div>

            {/* ── Sticky summary footer (chỉ khi form chỉnh báo giá đang hiện) ── */}
            {showQuoteForm && (
              <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.15)] backdrop-blur">
                <div className="mx-auto max-w-[1400px] px-6 py-2.5">
                  {/* Submit error — INTO the footer so it's always visible above the fold */}
                  {error && (
                    <div
                      role="alert"
                      className="mb-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700"
                    >
                      <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      </svg>
                      <p>{error}</p>
                    </div>
                  )}
                  {/* FE pre-check gate (Gửi báo giá only): Ý kiến / Hạn hiệu lực missing. */}
                  {submitGateError && (
                    <div
                      role="alert"
                      className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800"
                    >
                      <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      </svg>
                      <p>{submitGateError}</p>
                    </div>
                  )}
                  {/* Transient "đã lưu nháp" confirmation (draft saved, stay on form). */}
                  {draftSaved && !error && (
                    <div
                      role="status"
                      className="mb-2 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700"
                    >
                      <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <p>Đã lưu nháp. Báo giá chưa gửi — bấm "Gửi báo giá" khi sẵn sàng.</p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      <span>
                        Đã báo <span className="font-bold tabular-nums text-slate-700">{quotedCount}/{items.length}</span> dòng
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>
                        <span className="font-bold tabular-nums text-rose-600">{cannotSupplyCount}</span> dòng không cung cấp
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-sm">
                        TỔNG: <span className="font-bold tabular-nums text-brand-700">{formatMoneyNum(totalAmount)} {currency}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {editing ? (
                        <button
                          onClick={() => setEditing(false)}
                          disabled={submitting}
                          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 disabled:opacity-50"
                        >
                          Hủy sửa
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowDecline(true)}
                          disabled={submitting}
                          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 transition-colors hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"
                        >
                          Từ chối lời mời
                        </button>
                      )}
                      {/* Lưu nháp → /draft (no Ý kiến/Hạn gate; partial form OK). */}
                      <button
                        onClick={handleDraft}
                        disabled={submitting || savingDraft}
                        className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
                      >
                        {savingDraft ? 'Đang lưu...' : 'Lưu nháp'}
                      </button>
                      {/* Gửi báo giá (primary) → /submit (Ý kiến + Hạn hiệu lực bắt buộc). */}
                      <button
                        onClick={handleSubmit}
                        disabled={submitting || savingDraft}
                        className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
                      >
                        {submitting
                          ? 'Đang gửi...'
                          : currentRound > 1
                            ? `Gửi báo giá vòng ${currentRound}`
                            : myQuote
                              ? 'Cập nhật báo giá'
                              : 'Gửi báo giá'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Decline modal */}
            {showDecline && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm"
                onClick={() => setShowDecline(false)}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="decline-title"
                  className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"
                  onClick={e => e.stopPropagation()}
                >
                  <h3 id="decline-title" className="mb-1 text-lg font-bold text-slate-800">
                    Từ chối tham gia?
                  </h3>
                  <p className="mb-4 text-sm text-slate-500">
                    Bạn sẽ không gửi báo giá cho đợt này. Có thể cho biết lý do (tùy chọn).
                  </p>
                  <textarea
                    ref={declineTextareaRef}
                    value={declineReason}
                    onChange={e => setDeclineReason(e.target.value)}
                    rows={3}
                    placeholder="Ví dụ: Không sản xuất được loại vật liệu này..."
                    className="mb-4 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
                  />
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => setShowDecline(false)}
                      disabled={declining}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      Hủy
                    </button>
                    <button
                      onClick={handleDecline}
                      disabled={declining}
                      className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                    >
                      {declining ? 'Đang xử lý...' : 'Xác nhận từ chối'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Withdraw modal (#16-P2) — lý do BẮT BUỘC (nút khoá khi rỗng).
                Rendered ở scope ngoài form (nút "Thu hồi" nằm ở banner đã gửi). */}
            {showWithdraw && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm"
                onClick={() => setShowWithdraw(false)}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="withdraw-title"
                  className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"
                  onClick={e => e.stopPropagation()}
                >
                  <h3 id="withdraw-title" className="mb-1 text-lg font-bold text-slate-800">
                    Thu hồi báo giá?
                  </h3>
                  <p className="mb-4 text-sm text-slate-500">
                    Báo giá sẽ được rút khỏi đợt này (không còn tham gia so sánh).
                    Bạn vẫn có thể báo giá lại trước hạn nộp. Vui lòng nhập lý do.
                  </p>
                  <textarea
                    ref={withdrawTextareaRef}
                    value={withdrawReason}
                    onChange={e => setWithdrawReason(e.target.value)}
                    rows={3}
                    placeholder="Ví dụ: Báo nhầm giá, cần nộp lại bảng giá mới..."
                    className="mb-4 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"
                  />
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => setShowWithdraw(false)}
                      disabled={withdrawing}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      Hủy
                    </button>
                    <button
                      onClick={handleWithdraw}
                      disabled={withdrawing || !withdrawReason.trim()}
                      className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                    >
                      {withdrawing ? 'Đang xử lý...' : 'Xác nhận thu hồi'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
