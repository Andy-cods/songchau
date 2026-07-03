// Shared formatting + status helpers for the vendor portal (DRY).
//
// Status colours follow the canonical ERP functional palette and the
// rounded-full pill shape rendered by the shared <Badge> primitive
// (components/Badge.tsx already supplies inline-flex / rounded-full /
// px-2.5 py-0.5 / text-[11px] / font-semibold / ring-1 ring-inset). Each
// config className therefore only carries the colour tokens:
//   success = emerald  | warning = amber | danger = rose
//   info    = sky      | neutral = slate
// We intentionally use `ring-<tone>-200` (not `border-<tone>-200`) so the
// shared Badge's `ring-1 ring-inset` resolves to the ERP pill look.

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Relative "time ago" in Vietnamese for the notifications feed. Falls back to a
// full date once a row is older than ~a week so old rows stay legible. Kept here
// (next to formatDate) so the portal has ONE date-formatting home (DRY).
export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  // Clamp small future skew (server/client clock drift) to "vừa xong".
  if (sec < 60) return 'Vừa xong';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} ngày trước`;
  return formatDate(iso);
}

// NOTE (FLAGGED, do not change without sign-off): formatAmount returns '—'
// when amount === 0, which hides legitimate 0-priced abandoned lines. Left
// as-is for this UI pass per directive — changing it is a data-display change
// and must be explicitly confirmed by Thang before touching.
export function formatAmount(amount?: number | null, currency?: string | null): string {
  if (amount == null || amount === 0) return '—';
  return `${amount.toLocaleString('vi-VN')} ${currency ?? ''}`.trim();
}

// Raw grouped number for dense numeric/money cells. UNLIKE formatAmount, this
// shows 0 as "0" (never "—"), so abandoned/zero-priced lines render an explicit
// value in the dense quote/PO grids. Non-finite input → "—". `currency` is an
// optional trailing suffix (e.g. "290.000 VND"); omit it for a bare number.
export function formatMoneyNum(n?: number | null, currency?: string | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const grouped = n.toLocaleString('vi-VN');
  return currency ? `${grouped} ${currency}` : grouped;
}

// Deadline tone resolver shared by <Deadline> and any cell that wants to tint a
// due-date by urgency. Returns ONLY the text-colour token (functional palette,
// design-restraint): past = rose, ≤24h = amber, ≤72h = sky, else slate. A
// missing/invalid date is neutral slate. `now` is injectable for tests/SSR.
export function dueColor(date?: string | null, now: number = Date.now()): string {
  if (!date) return 'text-slate-500';
  const t = new Date(date).getTime();
  if (isNaN(t)) return 'text-slate-500';
  const diffH = (t - now) / 3_600_000;
  if (diffH < 0) return 'text-rose-600';
  if (diffH <= 24) return 'text-amber-600';
  if (diffH <= 72) return 'text-sky-600';
  return 'text-slate-500';
}

// Ngành hàng (vendor_accounts.product_categories TEXT[]) ⇄ free-text comma string.
// Đợt 1: chưa có bảng danh mục chuẩn → nhập tự do, phân tách bằng dấu phẩy
// (KISS/YAGNI). ONE home cho cả profile + register (DRY).
export function categoriesToString(c?: string[] | null): string {
  return (c ?? []).join(', ');
}

export function stringToCategories(s?: string | null): string[] {
  return (s ?? '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

// 6-currency set — MUST match backend ALLOWED_CURRENCIES (app/api/vendor/quotes.py)
// and the vendor_quotes / vendor_quote_items currency CHECK, else a JPY/KRW/EUR
// submit 400s. Order mirrors the backend tuple (VND/JPY/USD/KRW/RMB/EUR).
export const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: 'VND', label: 'VND (₫)' },
  { value: 'JPY', label: 'JPY (¥)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'KRW', label: 'KRW (₩)' },
  { value: 'RMB', label: 'RMB (¥)' },
  { value: 'EUR', label: 'EUR (€)' },
];

// Canonical functional palette tokens — colour only (Badge supplies the shape).
const PILL = {
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  danger: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  info: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
  neutral: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200',
} as const;

type Cfg = { label: string; className: string };

// Single generic resolver factory (KISS/DRY) — collapses the three
// near-identical cfg() functions while keeping every exported name + signature
// identical. Unknown statuses fall back to the neutral ring pill.
function makeCfg(map: Record<string, Cfg>): (status?: string | null) => Cfg {
  return (status?: string | null): Cfg => {
    if (status && status in map) return map[status];
    return { label: status ?? '—', className: PILL.neutral };
  };
}

// Per-vendor invitation status (procurement_rfq_invitations.status).
export type InvStatus = 'invited' | 'viewed' | 'submitted' | 'declined';

export const INV_STATUS_CONFIG: Record<InvStatus, Cfg> = {
  invited: { label: 'Đã mời', className: PILL.warning },
  viewed: { label: 'Đã xem', className: PILL.info },
  submitted: { label: 'Đã báo giá', className: PILL.success },
  declined: { label: 'Đã từ chối', className: PILL.neutral },
};

export const invStatusCfg = makeCfg(INV_STATUS_CONFIG as Record<string, Cfg>);

// Quote status (vendor_quotes.status).
export const QUOTE_STATUS_CONFIG: Record<string, Cfg> = {
  draft: { label: 'Nháp', className: PILL.neutral },
  submitted: { label: 'Đã gửi', className: PILL.info },
  awarded: { label: 'Trúng thầu', className: PILL.success },
  rejected: { label: 'Không trúng', className: PILL.danger },
  // #16-P2 — NCC tự thu hồi báo giá khi còn hạn (rút khỏi cuộc, slate trung tính).
  withdrawn: { label: 'Đã thu hồi', className: PILL.neutral },
};

export const quoteStatusCfg = makeCfg(QUOTE_STATUS_CONFIG);

// Contract status (procurement_contracts.status) — the EXACT 6 backend strings.
// Drafts are never shown to vendors, but kept here so an unexpected value still renders.
export const CONTRACT_STATUS_CONFIG: Record<string, Cfg> = {
  // Canonical contract-status palette — MUST match admin CONTRACT_STATUS
  // (vendor-bidding page.tsx + [id]/page.tsx): sent=info/sky, signed=warning/amber,
  // active+completed=success/emerald, cancelled=danger/rose. Keep the 6 backend
  // status strings + vi labels exact.
  draft: { label: 'Nháp', className: PILL.neutral },
  sent: { label: 'Chờ ký', className: PILL.info },
  signed: { label: 'Đã ký', className: PILL.warning },
  active: { label: 'Hiệu lực', className: PILL.success },
  completed: { label: 'Hoàn tất', className: PILL.success },
  cancelled: { label: 'Đã hủy', className: PILL.danger },
};

export const contractStatusCfg = makeCfg(CONTRACT_STATUS_CONFIG);

// PO status (procurement_pos.status) — the EXACT 6 backend strings.
// Canonical functional palette (design-restraint, NO violet-as-status):
//   draft=neutral, open=info/sky, partially_delivered=warning/amber,
//   delivered=success/emerald, closed=neutral/slate (archived), cancelled=danger/rose.
export const PO_STATUS_CONFIG: Record<string, Cfg> = {
  draft: { label: 'Nháp', className: PILL.neutral },
  open: { label: 'Đang mở', className: PILL.info },
  partially_delivered: { label: 'Giao một phần', className: PILL.warning },
  delivered: { label: 'Đã giao', className: PILL.success },
  closed: { label: 'Đã đóng', className: PILL.neutral },
  cancelled: { label: 'Đã hủy', className: PILL.danger },
};

export const poStatusCfg = makeCfg(PO_STATUS_CONFIG);

// Delivery status (procurement_deliveries.status) — the EXACT 6 backend strings.
//   pending=neutral, shipping=info/sky, arrived=warning/amber,
//   received=success/emerald, rejected=danger/rose, returned=danger/rose.
export const DELIVERY_STATUS_CONFIG: Record<string, Cfg> = {
  pending: { label: 'Chờ xử lý', className: PILL.neutral },
  shipping: { label: 'Đang giao', className: PILL.info },
  arrived: { label: 'Đã đến', className: PILL.warning },
  received: { label: 'Đã nhận', className: PILL.success },
  rejected: { label: 'Từ chối', className: PILL.danger },
  returned: { label: 'Trả lại', className: PILL.danger },
};

export const deliveryStatusCfg = makeCfg(DELIVERY_STATUS_CONFIG);
