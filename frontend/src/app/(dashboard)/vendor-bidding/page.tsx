'use client';

/**
 * Vendor Bidding admin — phiên đấu thầu nội bộ Song Châu (Đợt 1, rebuild IMV-style).
 *
 * Anh là buyer, NCC (vendor_accounts có tài khoản LOGIN) là vendor. Workflow Đợt 1:
 *  1. Tạo phiên (batch)
 *  2. Push mã linh kiện vào phiên (manual hoặc import từ BQMS)  -> [id]/page.tsx
 *  3. Mời tài khoản NCC (login-based, KHÔNG magic-link)         -> [id]/page.tsx
 *  4. NCC login ncc.songchau.vn → submit báo giá
 *  5. Anh xem matrix giá so sánh → chốt (Đợt 2)
 *
 * UI mirror trang IMV: sticky brand/slate header, KPI StatTile strip,
 * entity tabs với counts, config-driven columns, fmtDateVN/fmtMoney helpers,
 * skeleton, pagination, react-query, sonner toasts.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  PageShellHeader, CockpitTabs, StatStrip, StatusPill,
  DataPanel, DensityToggle, SkeletonRow, BADGE,
  TYPE, BUTTON, SHELL, DEPTH,
  type BadgeTone, type Density, type StatChip,
} from '@/components/cockpit';
import {
  Gavel, Plus, X, Loader2, ChevronLeft, ChevronRight, ChevronRight as Chevron,
  FileText, Clock, Building2, Users, ArrowUpRight,
  Filter, Search, FileSignature, Download, Send, Zap, AlertCircle,
  Package, Truck, PackageCheck, Ban, Trash2, Layers, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';

// ─── Helpers (mirror IMV) ───────────────────────────────────────

const fmtDateVN = (s: any) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const fmtMoney = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return v == null ? '—' : '0';
  return new Intl.NumberFormat('vi-VN').format(Math.round(n));
};
// D-N giống BQMS để theo dõi: tính theo NGÀY lịch — D-2 = còn 2 ngày, D-Day = hết
// hạn hôm nay, Closed = quá hạn. Màu: đỏ ≤2 ngày, amber ≤4, slate xa hạn.
function deadlineCountdown(iso?: string | null): { label: string; tone: BadgeTone; over: boolean } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dl = new Date(t); dl.setHours(0, 0, 0, 0);
  const n = Math.round((dl.getTime() - today.getTime()) / 86_400_000);
  if (n < 0) return { label: 'Closed', tone: 'slate', over: true };
  const label = n === 0 ? 'D-Day' : `D-${n}`;
  const tone: BadgeTone = n <= 2 ? 'rose' : n <= 4 ? 'amber' : 'slate';
  return { label, tone, over: false };
}

/** Combine a date + time picker value into an ISO8601 string with the VN offset
 * (+07:00). Empty date → null (no deadline). Time defaults to 17:00 when blank. */
function composeDeadlineISO(date: string, time: string): string | null {
  if (!date) return null;
  const t = (time && /^\d{2}:\d{2}/.test(time)) ? time.slice(0, 5) : '17:00';
  return `${date}T${t}:00+07:00`;
}

// ─── Types ──────────────────────────────────────────────────────

type BatchStatus = 'draft' | 'published' | 'evaluating' | 'closed' | 'awarded' | 'cancelled';
type ContractStatus = 'draft' | 'sent' | 'signed' | 'active' | 'completed' | 'cancelled';
type POStatus = 'draft' | 'open' | 'partially_delivered' | 'delivered' | 'closed' | 'cancelled';
type DeliveryStatus = 'pending' | 'shipping' | 'arrived' | 'received' | 'rejected' | 'returned';
type TabKey = 'batches' | 'contracts' | 'pos' | 'deliveries' | 'vendors';

interface Contract {
  id: number;
  contract_no: string;
  batch_id: number | null;
  batch_code: string | null;
  batch_title: string | null;
  vendor_id: number | null;
  vendor_name: string;
  vendor_email: string | null;
  total_amount: number | null;
  currency: string | null;
  status: ContractStatus;
  contract_date: string | null;
  sent_to_vendor_at: string | null;
  signed_at: string | null;
  signed_by_vendor: string | null;
  contract_file_path: string | null;
  pdf_generated_at: string | null;
  item_count: number;
  po_count: number;
  created_at: string;
}

// 6-state contract lifecycle — keep these EXACT strings in sync with the backend CHECK.
const CONTRACT_STATUS: Record<ContractStatus, { vi: string; cls: string }> = {
  draft: { vi: 'Nháp', cls: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200' },
  sent: { vi: 'Đã gửi NCC', cls: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200' },
  signed: { vi: 'NCC đã ký', cls: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200' },
  active: { vi: 'Hiệu lực', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' },
  completed: { vi: 'Hoàn tất', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' },
  cancelled: { vi: 'Huỷ', cls: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' },
};

// Cockpit StatusPill tone per contract status (calm dot + muted label).
const CONTRACT_TONE: Record<ContractStatus, BadgeTone> = {
  draft: 'slate', sent: 'sky', signed: 'amber', active: 'emerald', completed: 'emerald', cancelled: 'rose',
};

interface Batch {
  id: number;
  batch_code: string;
  title: string;
  description: string | null;
  status: BatchStatus;
  award_mode: 'per_item' | 'per_batch';
  item_count: number;
  quote_count: number;
  invited_count?: number;
  submitted_count?: number;
  created_by_name?: string | null;
  published_at: string | null;
  closed_at?: string | null;
  created_at: string;
  // Vendor-bidding rebuild (P1) — optional, surfaced by later phases.
  phu_trach?: string | null;
  visibility?: 'invited' | 'public' | string | null;
  bid_deadline?: string | null;
  deadline_round1?: string | null;
  deadline_round2?: string | null;
  deadline_round3?: string | null;
}

interface ProcStats {
  batches: {
    total: number; draft: number; cho_duyet: number; published: number;
    evaluating: number; awarded: number; closed: number; published_in_window: number;
  };
  quotes: { total_submitted: number; submitted_in_window: number; awarded: number };
  invitations: { total: number; viewed: number; submitted_pct: number };
  vendors: { active: number; pending: number };
}
interface ProcStatsResp {
  data: ProcStats;
  counts: { batches: number; quotes: number; contracts: number; pos: number; deliveries: number; vendors: number };
}

const STATUS_LABEL: Record<string, { vi: string; cls: string }> = {
  draft: { vi: 'Nháp', cls: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200' },
  published: { vi: 'Đang mở', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' },
  evaluating: { vi: 'Đang xét', cls: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200' },
  closed: { vi: 'Đã đóng', cls: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200' },
  awarded: { vi: 'Đã chốt', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' },
  cancelled: { vi: 'Huỷ', cls: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' },
};

// Cockpit StatusPill tone per batch status.
const BATCH_TONE: Record<string, BadgeTone> = {
  draft: 'slate', published: 'emerald', evaluating: 'sky', closed: 'amber', awarded: 'emerald', cancelled: 'rose',
};

// ─── PO + Delivery types (Đợt 4) ────────────────────────────────

interface PO {
  id: number;
  po_no: string;
  contract_id: number | null;
  contract_no: string | null;
  batch_id: number | null;
  vendor_id: number | null;
  vendor_name: string | null;
  po_date: string | null;
  requested_delivery_date: string | null;
  actual_delivery_date: string | null;
  total_amount: number | null;
  currency: string | null;
  payment_status: 'PENDING' | 'PARTIAL' | 'PAID' | string | null;
  status: POStatus;
  delivery_address: string | null;
  notes: string | null;
  item_count: number;
  delivery_count: number;
  created_at: string;
}

interface POItem {
  id: number;
  po_id: number;
  contract_item_id: number | null;
  item_no: number | null;
  bqms_code: string | null;
  specification: string | null;
  ordered_qty: number | null;
  delivered_qty: number | null;
  unit: string | null;
  unit_price: number | null;
  total_price: number | null;
  notes: string | null;
}

interface PODetail extends PO {
  items: POItem[];
  deliveries: Delivery[];
}

interface Delivery {
  id: number;
  delivery_no: string;
  po_id: number | null;
  po_no: string | null;
  vendor_id: number | null;
  vendor_name: string | null;
  delivered_at: string | null;
  delivery_method: 'courier' | 'vendor_delivery' | 'pickup' | 'express' | string | null;
  tracking_no: string | null;
  status: DeliveryStatus;
  received_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  item_count: number;
  total_qty: number | null;
  created_at: string;
  // Đợt 8 #3 — packing/invoice (nullable; có khi NCC/admin khai)
  vendor_invoice_no?: string | null;
  invoice_date?: string | null;
  packing_qty?: number | string | null;
  packing_unit?: string | null;
  gross_weight?: number | string | null;
  delivery_note_path?: string | null;
  // Đợt 8 #6 — chứng từ CO/CQ NCC upload (JSONB; server có thể trả mảng/chuỗi).
  documents?: { name: string; path?: string }[] | string | null;
}

interface DeliveryItem {
  id: number;
  delivery_id: number;
  po_item_id: number;
  delivered_qty: number | null;
  confirmed_qty: number | null;
  quality_status: 'ok' | 'minor_defect' | 'rejected' | string | null;
  notes: string | null;
  bqms_code: string | null;
  specification: string | null;
  ordered_qty: number | null;
  unit: string | null;
}

interface DeliveryDetail extends Delivery {
  items: DeliveryItem[];
}

// PO status — functional palette (design-restraint): draft=neutral, open=info(sky),
// partially_delivered=warning(amber), delivered=success(emerald), closed=neutral(slate, archived),
// cancelled=danger(rose). Keep strings in sync with backend CHECK.
const PO_STATUS: Record<POStatus, { vi: string; cls: string }> = {
  draft: { vi: 'Nháp', cls: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200' },
  open: { vi: 'Đã mở', cls: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200' },
  partially_delivered: { vi: 'Giao một phần', cls: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200' },
  delivered: { vi: 'Đã giao đủ', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' },
  closed: { vi: 'Đã đóng', cls: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200' },
  cancelled: { vi: 'Huỷ', cls: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' },
};

// Cockpit StatusPill tone per PO status.
const PO_TONE: Record<POStatus, BadgeTone> = {
  draft: 'slate', open: 'sky', partially_delivered: 'amber', delivered: 'emerald', closed: 'slate', cancelled: 'rose',
};

// Delivery status — functional palette: pending=neutral, shipping=info(sky),
// arrived=warning(amber), received=success(emerald), rejected/returned=danger(rose).
const DELIVERY_STATUS: Record<DeliveryStatus, { vi: string; cls: string }> = {
  pending: { vi: 'Chờ xử lý', cls: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200' },
  shipping: { vi: 'Đang giao', cls: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200' },
  arrived: { vi: 'Đã đến', cls: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200' },
  received: { vi: 'Đã nhận', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' },
  rejected: { vi: 'Từ chối', cls: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' },
  returned: { vi: 'Trả lại', cls: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' },
};

// Cockpit StatusPill tone per delivery status.
const DELIVERY_TONE: Record<DeliveryStatus, BadgeTone> = {
  pending: 'slate', shipping: 'sky', arrived: 'amber', received: 'emerald', rejected: 'rose', returned: 'rose',
};

const DELIVERY_METHOD_VI: Record<string, string> = {
  courier: 'Chuyển phát',
  vendor_delivery: 'NCC tự giao',
  pickup: 'Tự lấy',
  express: 'Hoả tốc',
};

const PAGE_SIZE = 20;

const TABS: Array<{ key: TabKey; label: string; icon: any }> = [
  { key: 'batches', label: 'Phiên đấu thầu', icon: Gavel },
  { key: 'contracts', label: 'Hợp đồng', icon: FileSignature },
  { key: 'pos', label: 'Đơn mua (PO)', icon: Package },
  { key: 'deliveries', label: 'Giao hàng', icon: Truck },
  { key: 'vendors', label: 'Tài khoản NCC', icon: Building2 },
];

// ─── P7 — Internal approval gate toggle (admin) ─────────────────
// Restrained: a single switch "Yêu cầu duyệt nội bộ" backed by
// GET/PUT /procurement/approval-config. DEFAULT-OFF so a solo owner sees the
// switch off and nothing in their publish flow changes.
function ApprovalGateToggle() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ data: { approval_required: boolean; allow_self: boolean } }>({
    queryKey: ['vb-approval-config'],
    queryFn: () => api.get<{ data: { approval_required: boolean; allow_self: boolean } }>('/api/v1/procurement/approval-config'),
    staleTime: 60_000,
    retry: false,
  });
  const required = data?.data?.approval_required ?? false;
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    setSaving(true);
    try {
      await api.put('/api/v1/procurement/approval-config', { approval_required: !required });
      toast.success(!required ? 'Đã bật duyệt nội bộ' : 'Đã tắt duyệt nội bộ');
      queryClient.invalidateQueries({ queryKey: ['vb-approval-config'] });
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isLoading || saving}
      title="Bật/tắt yêu cầu duyệt nội bộ trước khi công bố phiên"
      className={cn(
        'inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-semibold ring-1 ring-inset transition-colors disabled:opacity-50',
        required
          ? 'bg-brand-50 text-brand-700 ring-brand-200 hover:bg-brand-100'
          : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
      )}
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
      <span className="hidden sm:inline">Duyệt nội bộ</span>
      <span className={cn('inline-flex h-5 w-9 items-center rounded-full px-0.5 transition-colors', required ? 'bg-brand-500' : 'bg-slate-300')}>
        <span className={cn('h-4 w-4 rounded-full bg-white shadow transition-transform', required ? 'translate-x-4' : 'translate-x-0')} />
      </span>
    </button>
  );
}

// ─── Main Page ──────────────────────────────────────────────────

export default function VendorBiddingPage() {
  const [tab, setTab] = useState<TabKey>('batches');
  const [showNewBatch, setShowNewBatch] = useState(false);
  const { user } = useAuth();
  const isAdmin = (user?.role ?? '') === 'admin';

  const { data: statsResp, isError: statsError, isFetching: statsFetching } = useQuery<ProcStatsResp>({
    queryKey: ['vb-stats'],
    queryFn: () => api.get<ProcStatsResp>('/api/v1/procurement/stats?days=90'),
    refetchInterval: 60000,
  });
  const stats = statsResp?.data;
  const counts = statsResp?.counts;

  const countFor = (k: TabKey) =>
    k === 'batches' ? (counts?.batches ?? 0)
      : k === 'contracts' ? (counts?.contracts ?? 0)
        : k === 'pos' ? (counts?.pos ?? 0)
          : k === 'deliveries' ? (counts?.deliveries ?? 0)
            : (counts?.vendors ?? 0);

  return (
    <div className={cn(SHELL.page, '-m-6 flex min-h-screen flex-col')}>
      {/* (1) Sticky page-shell header — z-30 chrome + flush brand refetch bar.
          Full-bleed: header content spans the viewport (no max-w centering). */}
      <PageShellHeader
        title="Đấu thầu nội bộ"
        eyebrow="Procurement"
        isFetching={statsFetching}
        className="[&>div]:max-w-none [&>div]:mx-0"
        leading={
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600">
            <Gavel className="h-4.5 w-4.5 text-white" />
          </div>
        }
        actions={
          tab === 'batches' ? (
            <div className="flex items-center gap-2">
              {isAdmin && <ApprovalGateToggle />}
              {/* create_batch is admin-only on the backend — hide the affordance
                  for non-admins so they don't hit a 403 dead-end. */}
              {isAdmin && (
                <button onClick={() => setShowNewBatch(true)} className={BUTTON.primary}>
                  <Plus className="h-4 w-4" /> Tạo phiên mới
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* (2) StatStrip — thin dot-chip summary (sticky just below the h-14 header). */}
      <BatchStatStrip stats={stats} counts={counts} isError={statsError} sticky />

      {/* (3) Center-only entity tabs — bg-white rail, switch tabs WITHOUT navigating. */}
      <div className="sticky top-[6.25rem] z-[19] flex h-11 items-center bg-white px-4 ring-1 ring-slate-200/70">
        <CockpitTabs<TabKey>
          layoutGroup="vb-entity-tabs"
          value={tab}
          onChange={setTab}
          tabs={TABS.map((t) => {
            const Icon = t.icon;
            return {
              id: t.key,
              label: t.label,
              count: countFor(t.key),
              icon: <Icon className="h-4 w-4" />,
            };
          })}
        />
      </div>

      {/* (4) Tab content — full-bleed. Batches = master-detail split;
          the other entity tabs keep their full-width tables (compact). */}
      <div className="flex-1 min-h-0">
        {tab === 'batches' && <BatchesTab />}
        {tab !== 'batches' && (
          <div className="px-4 py-4 lg:px-6">
            {tab === 'contracts' && <ContractsTab />}
            {tab === 'pos' && <POTab />}
            {tab === 'deliveries' && <DeliveryTab />}
            {tab === 'vendors' && <VendorsTab />}
          </div>
        )}
      </div>

      {showNewBatch && <NewBatchModal onClose={() => setShowNewBatch(false)} />}
    </div>
  );
}

// ─── StatStrip — thin dot-chip lifecycle summary (replaces 4-KPI hero) ──────
// Counts come from the existing /procurement/stats query (stats.batches).
// Draft · Chờ duyệt (published_in_window proxy) · Đã đăng · Đang xét · Đã chốt.

function BatchStatStrip({
  stats, counts, isError, sticky,
}: { stats?: ProcStats; counts?: ProcStatsResp['counts']; isError?: boolean; sticky?: boolean }) {
  // Loading / error: render a quiet placeholder strip (no infinite skeleton).
  if (!stats) {
    const items: StatChip[] = isError
      ? [{ label: 'Thống kê', value: '—', tone: 'slate' }]
      : [
          { label: 'Tổng phiên', value: '…' },
          { label: 'Nháp', value: '…', tone: 'slate', divider: true },
          { label: 'Đã đăng', value: '…', tone: 'emerald' },
          { label: 'Đang xét', value: '…', tone: 'sky' },
          { label: 'Đã chốt', value: '…', tone: 'emerald' },
        ];
    return <StatStrip items={items} sticky={sticky} />;
  }

  const b = stats.batches;

  const items: StatChip[] = [
    { label: 'Tổng phiên', value: b.total, title: 'Tổng số phiên đấu thầu' },
    { label: 'Nháp', value: b.draft, tone: 'slate', divider: true, title: 'Phiên đang soạn' },
    { label: 'Chờ duyệt', value: b.cho_duyet, tone: 'amber', title: 'Phiên chờ duyệt nội bộ' },
    { label: 'Đã đăng', value: b.published, tone: 'emerald', pulse: b.published > 0, title: 'Phiên đang mở nhận báo giá' },
    { label: 'Đang xét', value: b.evaluating, tone: 'sky', title: 'Phiên đang so sánh / chấm giá' },
    { label: 'Đã chốt', value: b.awarded, tone: 'emerald', emphasizeValue: true, title: 'Phiên đã trao thầu' },
    {
      label: 'Phản hồi mời', value: `${stats.invitations.submitted_pct}%`,
      divider: true, alignEnd: true,
      title: `${stats.invitations.total} lời mời · ${stats.invitations.viewed} đã xem`,
    },
    { label: 'NCC active', value: stats.vendors.active, title: `${stats.vendors.pending} chờ duyệt` },
  ];
  return <StatStrip items={items} sticky={sticky} />;
}

// ─── Batches Tab ────────────────────────────────────────────────

function BatchesTab() {
  const router = useRouter();
  const [status, setStatus] = useState<'all' | BatchStatus>('all');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [density, setDensity] = useState<Density>('compact');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading, isError, isFetching } = useQuery<{ data: Batch[]; total: number }>({
    queryKey: ['vb-batches', status, page, q],
    queryFn: () => {
      const p = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE) });
      if (q.trim()) p.set('q', q.trim());
      return api.get<{ data: Batch[]; total: number }>(`/api/v1/procurement/batches?${p}`);
    },
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });

  const batches = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  // Auto-select the first row of the current page when nothing valid is selected.
  useEffect(() => {
    if (batches.length === 0) { setSelectedId(null); return; }
    if (selectedId == null || !batches.some((b) => b.id === selectedId)) {
      setSelectedId(batches[0].id);
    }
  }, [batches, selectedId]);

  // Track xl breakpoint: at/above xl the right preview pane is visible, so a
  // click only SELECTS. Below xl there is no pane, so a click drills straight
  // into the workspace (preserves the original list→detail behaviour).
  const [hasPreview, setHasPreview] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1280px)');
    const sync = () => setHasPreview(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const selected = batches.find((b) => b.id === selectedId) ?? null;
  const runSearch = () => { setPage(1); setQ(qInput); };
  const openWorkspace = (id: number) => router.push(`/vendor-bidding/${id}`);
  // Primary row activation: select (with preview) or open (without).
  const activate = (id: number) => { if (hasPreview) setSelectedId(id); else openWorkspace(id); };

  // ↑/↓ keyboard navigation across the visible session list (Enter → workspace).
  const moveSelection = (dir: 1 | -1) => {
    if (batches.length === 0) return;
    const idx = batches.findIndex((b) => b.id === selectedId);
    const next = Math.min(batches.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + dir));
    setSelectedId(batches[next].id);
  };

  return (
    <div
      className="grid h-[calc(100vh-9rem)] grid-cols-1 xl:grid-cols-[minmax(380px,420px)_1fr]"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
        else if (e.key === 'Enter' && selectedId != null) { e.preventDefault(); openWorkspace(selectedId); }
      }}
    >
      {/* ─── LEFT: compact session list (master) ─────────────────────────── */}
      <div className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        {/* Filter + search rail */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <SegMenu
            options={(['all', 'draft', 'published', 'evaluating', 'awarded'] as const).map((k) => ({
              id: k, label: k === 'all' ? 'Tất cả' : (STATUS_LABEL[k]?.vi ?? k),
            }))}
            value={status}
            onChange={(k) => { setStatus(k); setPage(1); }}
          />
          <DensityToggle value={density} onChange={setDensity} />
          <div className="flex w-full items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              role="searchbox"
              aria-label="Tìm phiên đấu thầu theo mã hoặc tiêu đề"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); e.stopPropagation(); }}
              placeholder="Tìm mã phiên / tiêu đề…"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-slate-400"
            />
            <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{total}</span>
          </div>
        </div>

        {/* Scrollable session rows */}
        <div role="listbox" aria-label="Danh sách phiên đấu thầu" className="min-h-0 flex-1 overflow-y-auto">
          {isError ? (
            <ErrorNote>Không tải được danh sách phiên đấu thầu. Vui lòng thử lại.</ErrorNote>
          ) : isLoading ? (
            <div className={cn('divide-y divide-slate-100', isFetching && 'opacity-70')}>
              {[...Array(10)].map((_, i) => (
                <div key={i} className="space-y-2 px-3 py-2.5">
                  <div className="h-3 w-28 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-44 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : batches.length === 0 ? (
            <div className="px-3 py-16">
              <EmptyState icon={<Gavel className="h-8 w-8 text-slate-400" />}
                title="Chưa có phiên đấu thầu nào."
                hint='Bấm "Tạo phiên mới" ở header để bắt đầu.' />
            </div>
          ) : (
            <ul className={cn('divide-y divide-slate-100', isFetching && !isLoading && 'opacity-70 transition-opacity')}>
              {batches.map((b) => (
                <BatchListRow
                  key={b.id}
                  batch={b}
                  density={density}
                  selected={b.id === selectedId}
                  onSelect={() => activate(b.id)}
                  onOpen={() => openWorkspace(b.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Pager pinned to the bottom of the list column */}
        {!isError && total > 0 && (
          <Pager offset={offset} total={total} page={page} totalPages={totalPages}
            unit="phiên" onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(totalPages, p + 1))} />
        )}
      </div>

      {/* ─── RIGHT: detail preview pane (detail) ─────────────────────────── */}
      <div className="hidden min-h-0 overflow-y-auto bg-slate-50 xl:block">
        <BatchPreviewPane batch={selected} onOpen={openWorkspace} />
      </div>

      {/* Below xl the right pane collapses; selecting a row navigates directly
          so small screens keep the original drill-in behaviour. */}
    </div>
  );
}

// ─── Left list row — compact, dense, keyboard-selectable ────────────────────

function BatchListRow({
  batch: b, density, selected, onSelect, onOpen,
}: {
  batch: Batch;
  density: Density;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const st = STATUS_LABEL[b.status] ?? STATUS_LABEL.draft;
  const tone = BATCH_TONE[b.status] ?? 'slate';
  const dot = BADGE[tone].dot;
  const cd = deadlineCountdown(b.bid_deadline);
  const invited = b.invited_count ?? 0;
  const submitted = b.submitted_count ?? 0;
  // Micro-progress = báo giá received vs invited NCC (clamped 0..100).
  const pct = invited > 0 ? Math.min(100, Math.round((submitted / invited) * 100)) : 0;
  const pad = density === 'compact' ? 'px-3 py-2' : 'px-3 py-2.5';

  return (
    <li role="option" aria-selected={selected}>
      <div
        tabIndex={0}
        onClick={onSelect}
        onDoubleClick={onOpen}
        onKeyDown={(e) => {
          // Space selects; the parent grid handles ↑/↓/Enter so we don't double-fire.
          if (e.key === ' ') { e.preventDefault(); onSelect(); }
        }}
        className={cn(
          'group relative cursor-pointer outline-none transition-colors',
          pad,
          selected ? 'bg-brand-50/70' : cn(DEPTH.zebra, 'hover:bg-brand-50/40'),
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500',
        )}
      >
        {/* Selected left accent rail (brand). */}
        {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-600" />}

        {/* Line 1: code · status dot · deadline chip */}
        <div className="flex items-center gap-2">
          <span className={cn('shrink-0', TYPE.code)}>{b.batch_code}</span>
          <span className={cn('h-[5px] w-[5px] shrink-0 rounded-full', dot)} title={st.vi} />
          <span className="truncate text-[11px] text-slate-400">{st.vi}</span>
          {cd && (
            <span
              className={cn(
                'ml-auto inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
                BADGE[cd.tone].bg, BADGE[cd.tone].text, BADGE[cd.tone].ring,
              )}
              title={`Hạn báo giá: ${fmtDateVN(b.bid_deadline)}`}
            >
              {cd.label}
            </span>
          )}
        </div>

        {/* Line 2: title */}
        <div className="mt-0.5 truncate text-[13px] font-medium text-slate-800" title={b.title}>{b.title}</div>

        {/* Line 3: micro-counts */}
        <div className="mt-1 flex items-center gap-3 text-[11px] tabular-nums text-slate-500">
          <span className="inline-flex items-center gap-1" title="Số mã linh kiện">
            <Layers className="h-3 w-3 text-slate-400" />{b.item_count}
          </span>
          <span title="NCC đã mời">{invited || '—'} mời</span>
          <span className="text-emerald-600" title="Số báo giá nhận">{b.quote_count} báo giá</span>
        </div>

        {/* Line 4: 3px micro-progress bar (submitted / invited). */}
        <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </li>
  );
}

// ─── Right preview pane — header + key facts + "Mở workspace" ───────────────

function BatchPreviewPane({ batch: b, onOpen }: { batch: Batch | null; onOpen: (id: number) => void }) {
  if (!b) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100">
            <Gavel className="h-7 w-7 text-slate-400" />
          </div>
          <p className="text-[13px] text-slate-500">Chọn một phiên ở danh sách bên trái để xem nhanh.</p>
        </div>
      </div>
    );
  }

  const st = STATUS_LABEL[b.status] ?? STATUS_LABEL.draft;
  const cd = deadlineCountdown(b.bid_deadline);
  const invited = b.invited_count ?? 0;
  const submitted = b.submitted_count ?? 0;
  const pct = invited > 0 ? Math.min(100, Math.round((submitted / invited) * 100)) : 0;

  return (
    <div className="flex min-h-full flex-col p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('text-[13px]', TYPE.code)}>{b.batch_code}</span>
            <StatusPill label={st.vi} tone={BATCH_TONE[b.status] ?? 'slate'} pulse={b.status === 'published'} />
          </div>
          <h2 className={cn(TYPE.h1, 'mt-1.5 leading-tight')}>{b.title}</h2>
          {b.description && <p className="mt-1 text-[13px] text-slate-500">{b.description}</p>}
        </div>
        <button onClick={() => onOpen(b.id)} className={cn(BUTTON.primary, 'shrink-0')}>
          <ArrowUpRight className="h-4 w-4" /> Mở workspace
        </button>
      </div>

      {/* Key facts grid */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <PreviewFact label="Mã linh kiện" value={String(b.item_count)} icon={<Layers className="h-3.5 w-3.5" />} />
        <PreviewFact label="NCC đã mời" value={invited ? String(invited) : '—'} />
        <PreviewFact label="Đã gửi báo giá" value={submitted ? String(submitted) : '—'} />
        <PreviewFact label="Báo giá nhận" value={String(b.quote_count)} emphasize />
        <PreviewFact label="Cách chốt" value={b.award_mode === 'per_batch' ? 'Toàn phiên' : 'Theo mã'} />
        <PreviewFact label="Người tạo" value={b.created_by_name ?? '—'} />
      </div>

      {/* Response progress + deadline */}
      <div className="mt-4 rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-semibold text-slate-600">Tiến độ phản hồi NCC</span>
          <span className="tabular-nums text-slate-500">{submitted}/{invited || '—'} đã báo giá</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-slate-500">
          <span>Tạo lúc <b className="font-mono text-[11px] text-slate-600">{fmtDateVN(b.created_at)}</b></span>
          {b.published_at && <span>Đăng <b className="font-mono text-[11px] text-slate-600">{fmtDateVN(b.published_at)}</b></span>}
          {b.bid_deadline && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              Hạn <b className="font-mono text-[11px] text-slate-600">{fmtDateVN(b.bid_deadline)}</b>
              {cd && (
                <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums', BADGE[cd.tone].bg, BADGE[cd.tone].text)}>
                  {cd.label}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Footer hint → workspace owns the full price-matrix / award flow. */}
      <div className="mt-auto pt-5">
        <button onClick={() => onOpen(b.id)}
          className="flex w-full items-center justify-between rounded-lg bg-white px-4 py-3 text-left ring-1 ring-slate-200 transition-colors hover:ring-brand-300">
          <span className="text-[13px] text-slate-600">Mở workspace để xem ma trận giá, mời NCC & chốt thầu.</span>
          <Chevron className="h-4 w-4 text-slate-400" />
        </button>
      </div>
    </div>
  );
}

function PreviewFact({ label, value, icon, emphasize }: { label: string; value: string; icon?: React.ReactNode; emphasize?: boolean }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {icon}{label}
      </div>
      <div className={cn('mt-1 text-[15px] font-semibold tabular-nums', emphasize ? 'text-emerald-700' : 'text-slate-800')}>{value}</div>
    </div>
  );
}

// ─── Shared cockpit shell helpers (list-page chrome) ────────────

/** Tier-1 sticky-able filter bar surface. */
function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded-lg bg-white ring-1 ring-slate-200', SHELL.filterBar)}>
      {children}
    </div>
  );
}

/** Segmented status menu (slate track, white active pill, brand text). */
function SegMenu<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-md bg-slate-100 p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={cn('rounded px-2.5 py-1 text-[12px] font-semibold transition-colors', DEPTH.focusRing,
            value === o.id ? 'bg-white text-brand-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)]' : 'text-slate-500 hover:text-slate-700')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="m-4 flex items-start gap-3 rounded-lg bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-inset ring-rose-100">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="mx-auto max-w-md space-y-3 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100">{icon}</div>
      <p className={cn(TYPE.h2)}>{title}</p>
      <p className="text-[13px] text-slate-500">{hint}</p>
    </div>
  );
}

function Pager({ offset, total, page, totalPages, unit, onPrev, onNext }: {
  offset: number; total: number; page: number; totalPages: number; unit: string;
  onPrev: () => void; onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-[12px] text-slate-600">
      <span className="tabular-nums">Hiển thị {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total} {unit}</span>
      <div className="flex items-center gap-1">
        <button onClick={onPrev} disabled={page <= 1} aria-label="Trang trước"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-slate-200 transition-colors hover:bg-slate-50 disabled:opacity-30">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="px-2 tabular-nums">Trang {page} / {totalPages}</span>
        <button onClick={onNext} disabled={page >= totalPages} aria-label="Trang sau"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-slate-200 transition-colors hover:bg-slate-50 disabled:opacity-30">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Contracts helpers (shared with [id] detail tab via duplication-by-design) ─

/**
 * Download an admin-protected PDF (require_role bearer auth) as a blob and open
 * it in a new tab. We can't rely on a ?token= query param being honored by the
 * role guard, so we fetch with the Authorization header (mirrors ExportButton).
 */
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
    // Revoke after the tab has had time to load.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e: any) {
    toast.error(`Lỗi tải PDF: ${e?.message ?? 'Unknown'}`);
  }
}

/**
 * Đợt 8 #2 — mở Phiếu Giao Nhận PDF của 1 lô giao (auto-render server-side nếu
 * chưa có). Fetch kèm Authorization (role-guarded endpoint) như openContractPdf.
 */
async function openDeliveryNotePdf(deliveryId: number) {
  if (typeof window === 'undefined') return;
  const token = localStorage.getItem('access_token') ?? '';
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  try {
    const res = await fetch(`${base}/api/v1/procurement/deliveries/${deliveryId}/note`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    });
    if (!res.ok) {
      toast.error(`Không tải được Phiếu Giao Nhận (${res.status})`);
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

/** Đợt 8 #9 — mở ĐƠN ĐẶT HÀNG PDF (on-demand render server-side). */
async function openPoPdf(poId: number) {
  if (typeof window === 'undefined') return;
  const token = localStorage.getItem('access_token') ?? '';
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  try {
    const res = await fetch(`${base}/api/v1/procurement/pos/${poId}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    });
    if (!res.ok) { toast.error(`Không tải được PDF (${res.status})`); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e: any) {
    toast.error(`Lỗi tải PDF: ${e?.message ?? 'Unknown'}`);
  }
}

/** Đợt 8 #6 — tải chứng từ CO/CQ NCC upload cho lô giao (authed download). */
async function openDeliveryDoc(deliveryId: number, idx: number, name: string) {
  if (typeof window === 'undefined') return;
  const token = localStorage.getItem('access_token') ?? '';
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  try {
    const res = await fetch(`${base}/api/v1/procurement/deliveries/${deliveryId}/documents/${idx}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    });
    if (!res.ok) { toast.error(`Không tải được chứng từ (${res.status})`); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name || `chung-tu-${idx}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e: any) { toast.error(`Lỗi: ${e?.message ?? 'Unknown'}`); }
}

/** Parse documents JSONB (server có thể trả mảng hoặc chuỗi JSON). */
function parseDeliveryDocs(documents: Delivery['documents']): { name: string }[] {
  if (!documents) return [];
  if (Array.isArray(documents)) return documents;
  try { const a = JSON.parse(documents); return Array.isArray(a) ? a : []; } catch { return []; }
}

// ─── Contracts Tab (global list) ────────────────────────────────

function ContractsTab() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'all' | ContractStatus>('all');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<number | null>(null);

  const { data, isLoading, isError, isFetching } = useQuery<{ data: Contract[]; total: number }>({
    queryKey: ['vb-contracts', status, page],
    queryFn: () => {
      const p = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE) });
      return api.get<{ data: Contract[]; total: number }>(`/api/v1/procurement/contracts?${p}`);
    },
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });

  const contracts = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['vb-contracts'] });
    queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
  };

  // Admin lifecycle actions: generate-pdf, send-to-vendor, activate.
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

  const STATUS_FILTERS: Array<'all' | ContractStatus> = ['all', 'draft', 'sent', 'signed', 'active', 'completed'];

  return (
    <div className={SHELL.sectionStack}>
      <FilterBar>
        <Filter className="h-4 w-4 text-slate-400" />
        <SegMenu
          options={STATUS_FILTERS.map((k) => ({ id: k, label: k === 'all' ? 'Tất cả' : CONTRACT_STATUS[k].vi }))}
          value={status}
          onChange={(k) => { setStatus(k); setPage(1); }}
        />
        <span className="ml-auto text-[12px] text-slate-500 tabular-nums">{total} hợp đồng</span>
      </FilterBar>

      <DataPanel flush>
        {isError ? (
          <ErrorNote>Không tải được danh sách hợp đồng. Vui lòng thử lại.</ErrorNote>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Mã HĐ</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Trạng thái</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>NCC</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Phiên</th>
                <th className={cn(TYPE.th, 'text-right whitespace-nowrap px-3 py-2.5')}>Mã</th>
                <th className={cn(TYPE.th, 'text-right whitespace-nowrap px-3 py-2.5')}>Giá trị</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Ký bởi / lúc</th>
                <th className={cn(TYPE.th, 'text-right whitespace-nowrap px-3 py-2.5')} style={{ minWidth: '300px' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody aria-busy={isFetching} className={cn(DEPTH.divider, 'transition-opacity', isFetching && !isLoading && 'opacity-60')}>
              {isLoading ? (
                [...Array(6)].map((_, i) => <SkeletonRow key={i} cols={8} />)
              ) : contracts.length === 0 ? (
                <tr><td colSpan={8} className="p-3 py-16">
                  <EmptyState icon={<FileSignature className="h-8 w-8 text-slate-400" />}
                    title="Chưa có hợp đồng nào."
                    hint='Vào chi tiết một phiên đã chốt → tab "Hợp đồng" → "Tạo hợp đồng từ kết quả award".' />
                </td></tr>
              ) : (
                contracts.map((c) => (
                  <ContractRow
                    key={c.id}
                    c={c}
                    busy={busyId === c.id}
                    onAction={runAction}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        )}

        {!isError && total > 0 && (
          <Pager offset={offset} total={total} page={page} totalPages={totalPages}
            unit="hợp đồng" onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(totalPages, p + 1))} />
        )}
      </DataPanel>
    </div>
  );
}

function ContractRow({
  c, busy, onAction,
}: {
  c: Contract;
  busy: boolean;
  onAction: (c: Contract, action: 'generate-pdf' | 'send-to-vendor' | 'activate', okMsg: string) => void;
}) {
  const [showCreatePO, setShowCreatePO] = useState(false);
  const st = CONTRACT_STATUS[c.status] ?? CONTRACT_STATUS.draft;
  const hasPdf = !!c.contract_file_path;
  // Send requires a generated PDF first (backend 400s otherwise) — gate the button.
  const canSend = c.status === 'draft' && hasPdf;
  const canActivate = c.status === 'signed';
  const canGenerate = ['draft', 'sent', 'signed', 'active'].includes(c.status);
  // A PO can only be created from an ACTIVE contract (backend guards status='active').
  const canCreatePO = c.status === 'active';

  return (
    <tr className={cn('transition-colors', DEPTH.zebra, DEPTH.rowHover)}>
      <td className={cn('px-3 py-2.5 whitespace-nowrap', TYPE.code)}>{c.contract_no}</td>
      <td className="px-3 py-2.5">
        <StatusPill label={st.vi} tone={CONTRACT_TONE[c.status] ?? 'slate'} />
      </td>
      <td className="px-3 py-2.5 max-w-[220px]">
        <span className="block truncate font-medium text-slate-800" title={c.vendor_name}>{c.vendor_name}</span>
        {c.vendor_email && <span className="block truncate text-[12px] text-slate-500">{c.vendor_email}</span>}
      </td>
      <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">
        {c.batch_code ? <span className={TYPE.code}>{c.batch_code}</span> : '—'}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{c.item_count}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[13px] font-semibold text-slate-800 whitespace-nowrap">
        {c.total_amount != null ? <>{fmtMoney(c.total_amount)} <span className={TYPE.currencySuffix}>{c.currency}</span></> : '—'}
      </td>
      <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">
        {c.signed_at ? (
          <div>
            <div className="font-medium text-slate-700 truncate max-w-[140px]" title={c.signed_by_vendor ?? ''}>{c.signed_by_vendor ?? 'NCC'}</div>
            <div className="text-[12px] text-emerald-600 font-mono">{fmtDateVN(c.signed_at)}</div>
          </div>
        ) : c.sent_to_vendor_at ? (
          <span className="text-[12px] text-sky-600">Gửi {fmtDateVN(c.sent_to_vendor_at)}</span>
        ) : '—'}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex h-8 items-center justify-end gap-1.5 flex-wrap">
          {canGenerate && (
            <button onClick={() => onAction(c, 'generate-pdf', 'Đã sinh PDF')} disabled={busy}
              title="Render PDF hợp đồng (Gotenberg)"
              className="inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Sinh PDF
            </button>
          )}
          {hasPdf && (
            <button onClick={() => openContractPdf(c.id)} disabled={busy}
              title="Mở/tải PDF hợp đồng"
              className="inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap">
              <Download className="h-3.5 w-3.5" /> Tải PDF
            </button>
          )}
          {canSend && (
            <button onClick={() => onAction(c, 'send-to-vendor', 'Đã gửi NCC')} disabled={busy}
              title="Gửi hợp đồng cho NCC qua email + mở portal ký"
              className="inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Gửi NCC
            </button>
          )}
          {c.status === 'draft' && !hasPdf && (
            <span className="text-xs text-slate-500 italic px-1 whitespace-nowrap">Sinh PDF trước khi gửi</span>
          )}
          {canActivate && (
            <button onClick={() => onAction(c, 'activate', 'Đã kích hoạt hợp đồng')} disabled={busy}
              title="Kích hoạt hợp đồng sau khi NCC đã ký"
              className="inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Kích hoạt
            </button>
          )}
          {canCreatePO && (
            <button onClick={() => setShowCreatePO(true)} disabled={busy}
              title="Tạo đơn mua (PO) từ hợp đồng đã hiệu lực"
              className="inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap">
              <Package className="h-3.5 w-3.5" /> Tạo PO
            </button>
          )}
          {c.status === 'sent' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 px-1 whitespace-nowrap" title="Đang chờ NCC ký trên portal">
              <Clock className="h-3.5 w-3.5" /> Chờ NCC ký
            </span>
          )}
        </div>
        {showCreatePO && (
          <CreatePOModal contract={c} onClose={() => setShowCreatePO(false)} />
        )}
      </td>
    </tr>
  );
}

// ─── Create PO Modal (PO from an ACTIVE contract) ───────────────
// Mirror the local modal style (NewBatchModal): inline overlay/panel/header,
// solid-brand icon tile, slate inputs, slate-50 footer.

function CreatePOModal({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Escape-to-close + lock body scroll while open (mirror NewBatchModal).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

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
      // Refresh the PO list + stats (counts.pos / PO tab) and the contracts list so po_count updates.
      queryClient.invalidateQueries({ queryKey: ['vb-pos'] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
      queryClient.invalidateQueries({ queryKey: ['vb-contracts'] });
      onClose();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="create-po-title"
        className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-100 bg-white flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <Package className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="create-po-title" className="text-base font-bold text-slate-900">Tạo đơn mua (PO)</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Từ hợp đồng <span className="font-mono text-brand-700">{contract.contract_no}</span> · {contract.vendor_name} — hệ thống copy toàn bộ mã vào PO.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng"
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ngày giao yêu cầu</label>
            <input type="date" value={requestedDeliveryDate} onChange={(e) => setRequestedDeliveryDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Địa chỉ giao</label>
            <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Mặc định: Kho Song Châu — 123 Đường ABC, Q.7, TP.HCM"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ghi chú</label>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú cho đơn mua này (tuỳ chọn)…"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all resize-none" />
          </div>
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">
            Huỷ
          </button>
          <button onClick={handleCreate} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
            Tạo PO
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Vendors Tab (login accounts) ───────────────────────────────

function VendorsTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved'>('all');

  const { data, isLoading, isError, isFetching } = useQuery<{ data: any[]; total: number }>({
    queryKey: ['vb-vendors', filter],
    queryFn: () => api.get<{ data: any[]; total: number }>(`/api/v1/procurement/vendors?status=${filter}`),
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });

  const vendors = data?.data ?? [];

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/api/v1/procurement/vendors/${id}/approve`, {}),
    onSuccess: () => {
      toast.success('Đã duyệt NCC');
      queryClient.invalidateQueries({ queryKey: ['vb-vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
    },
    onError: (e: any) => toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`),
  });

  return (
    <div className={SHELL.sectionStack}>
      <FilterBar>
        <Users className="h-4 w-4 text-slate-400" />
        <SegMenu
          options={(['all', 'pending', 'approved'] as const).map((k) => ({
            id: k, label: k === 'all' ? 'Tất cả' : k === 'pending' ? 'Chờ duyệt' : 'Đã duyệt',
          }))}
          value={filter}
          onChange={setFilter}
        />
        {/* NOTE: count mismatch — this is page-local (filter-scoped, no pagination on the
            endpoint) and may disagree with the header tab count (counts.vendors, global).
            Label as "hiển thị" to avoid implying it is the global total. */}
        <span className="ml-auto text-[12px] text-slate-500 tabular-nums">hiển thị {vendors.length} NCC</span>
      </FilterBar>

      <DataPanel flush>
        {isError ? (
          <ErrorNote>Không tải được danh sách tài khoản NCC. Vui lòng thử lại.</ErrorNote>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className={cn(TYPE.th, 'text-left px-3 py-2.5')}>Công ty</th>
                <th className={cn(TYPE.th, 'text-left px-3 py-2.5')}>Liên hệ</th>
                <th className={cn(TYPE.th, 'text-left px-3 py-2.5')}>Email</th>
                <th className={cn(TYPE.th, 'text-left px-3 py-2.5')}>Nhóm hàng</th>
                <th className={cn(TYPE.th, 'text-right px-3 py-2.5')}>Báo giá</th>
                <th className={cn(TYPE.th, 'text-center px-3 py-2.5')}>Trạng thái</th>
                <th className="px-3 py-2.5"><span className="sr-only">Thao tác</span></th>
              </tr>
            </thead>
            <tbody aria-busy={isFetching} className={cn(DEPTH.divider, 'transition-opacity', isFetching && !isLoading && 'opacity-60')}>
              {isLoading ? (
                [...Array(6)].map((_, i) => <SkeletonRow key={i} cols={7} />)
              ) : vendors.length === 0 ? (
                <tr><td colSpan={7} className="p-3 py-16">
                  <EmptyState icon={<Building2 className="h-8 w-8 text-slate-400" />}
                    title="Chưa có tài khoản NCC nào."
                    hint="NCC tự đăng ký qua portal hoặc anh tạo + kích hoạt tài khoản." />
                </td></tr>
              ) : (
                vendors.map((v) => (
                  <tr key={v.id} className={cn('transition-colors', DEPTH.zebra, DEPTH.rowHover)}>
                    <td className="px-3 py-2.5 font-semibold text-slate-800">{v.company_name}</td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600">
                      <div>{v.contact_name ?? '—'}</div>
                      {v.phone && <div className="text-slate-500 font-mono text-[12px]">{v.phone}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600">{v.email}</td>
                    <td className="px-3 py-2.5 text-[13px]">
                      {(v.product_categories || []).map((c: string) => (
                        <span key={c} className="mr-1 mb-0.5 inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{c}</span>
                      ))}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">{v.quote_count}</td>
                    <td className="px-3 py-2.5 text-center">
                      {v.is_approved
                        ? <StatusPill label="Đã duyệt" tone="emerald" />
                        : <StatusPill label="Chờ duyệt" tone="amber" />}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {!v.is_approved && (
                        <button onClick={() => approveMutation.mutate(v.id)} disabled={approveMutation.isPending}
                          className="inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50">
                          Duyệt
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
      </DataPanel>
    </div>
  );
}

// ─── PO Tab (Đợt 4) ─────────────────────────────────────────────

const PO_STATUS_FILTERS: Array<'all' | POStatus> = [
  'all', 'draft', 'open', 'partially_delivered', 'delivered', 'closed', 'cancelled',
];

function POTab() {
  const [status, setStatus] = useState<'all' | POStatus>('all');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  const { data, isLoading, isError, isFetching } = useQuery<{ data: PO[]; total: number }>({
    queryKey: ['vb-pos', status, page],
    queryFn: () => {
      const p = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE) });
      return api.get<{ data: PO[]; total: number }>(`/api/v1/procurement/pos?${p}`);
    },
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });

  const pos = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  return (
    <div className={SHELL.sectionStack}>
      <FilterBar>
        <Filter className="h-4 w-4 text-slate-400" />
        <SegMenu
          options={PO_STATUS_FILTERS.map((k) => ({ id: k, label: k === 'all' ? 'Tất cả' : PO_STATUS[k].vi }))}
          value={status}
          onChange={(k) => { setStatus(k); setPage(1); }}
        />
        <span className="ml-auto text-[12px] text-slate-500 tabular-nums">{total} đơn mua</span>
      </FilterBar>

      <DataPanel flush>
        {isError ? (
          <ErrorNote>Không tải được danh sách đơn mua. Vui lòng thử lại.</ErrorNote>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Mã PO</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Trạng thái</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>NCC / Hợp đồng</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Ngày PO</th>
                <th className={cn(TYPE.th, 'text-right whitespace-nowrap px-3 py-2.5')}>Giá trị</th>
                <th className={cn(TYPE.th, 'text-right whitespace-nowrap px-3 py-2.5')}>Tiến độ giao</th>
                <th className="px-3 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody aria-busy={isFetching} className={cn(DEPTH.divider, 'transition-opacity', isFetching && !isLoading && 'opacity-60')}>
              {isLoading ? (
                [...Array(8)].map((_, i) => <SkeletonRow key={i} cols={7} />)
              ) : pos.length === 0 ? (
                <tr><td colSpan={7} className="p-3 py-16">
                  <EmptyState icon={<Package className="h-8 w-8 text-slate-400" />}
                    title="Chưa có đơn mua nào."
                    hint='Vào tab "Hợp đồng" → mở hợp đồng đã hiệu lực → tạo PO.' />
                </td></tr>
              ) : (
                pos.map((p) => {
                  const st = PO_STATUS[p.status] ?? PO_STATUS.draft;
                  return (
                    <tr key={p.id}
                      role="button" tabIndex={0}
                      onClick={() => setOpenId(p.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(p.id); } }}
                      className={cn('group cursor-pointer transition-colors', DEPTH.zebra, DEPTH.rowHover, 'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500')}>
                      <td className={cn('px-3 py-2.5 whitespace-nowrap', TYPE.code)}>{p.po_no}</td>
                      <td className="px-3 py-2.5">
                        <StatusPill label={st.vi} tone={PO_TONE[p.status] ?? 'slate'} />
                      </td>
                      <td className="px-3 py-2.5 max-w-[260px]">
                        <span className="block truncate font-medium text-slate-800" title={p.vendor_name ?? ''}>{p.vendor_name ?? '—'}</span>
                        {p.contract_no && <span className={cn('block truncate', TYPE.code)}>{p.contract_no}</span>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px] text-slate-500 whitespace-nowrap">{fmtDateVN(p.po_date)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[13px] font-semibold text-slate-800 whitespace-nowrap">
                        {p.total_amount != null ? <>{fmtMoney(p.total_amount)} <span className={TYPE.currencySuffix}>{p.currency}</span></> : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 whitespace-nowrap">
                        <span className="text-slate-700 font-semibold">{p.delivery_count}</span>
                        <span className="text-slate-400"> lần · {p.item_count} mã</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Chevron className="h-4 w-4 text-slate-300 group-hover:text-brand-600 transition-colors" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        )}

        {!isError && total > 0 && (
          <Pager offset={offset} total={total} page={page} totalPages={totalPages}
            unit="đơn mua" onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(totalPages, p + 1))} />
        )}
      </DataPanel>

      {openId != null && <PODetailModal poId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ─── PO Detail Modal ────────────────────────────────────────────

function PODetailModal({ poId, onClose }: { poId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [showRecord, setShowRecord] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const { data, isLoading, isError } = useQuery<{ data: PODetail }>({
    queryKey: ['vb-po', poId],
    queryFn: () => api.get<{ data: PODetail }>(`/api/v1/procurement/pos/${poId}`),
  });
  const po = data?.data;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['vb-po', poId] });
    queryClient.invalidateQueries({ queryKey: ['vb-pos'] });
    queryClient.invalidateQueries({ queryKey: ['vb-deliveries'] });
    queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
  };

  const st = po ? (PO_STATUS[po.status] ?? PO_STATUS.draft) : null;
  // Mirror backend gating exactly.
  const canRecord = po ? ['open', 'partially_delivered'].includes(po.status) : false;
  const canCancel = po ? ['draft', 'open', 'partially_delivered'].includes(po.status) : false;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="po-detail-title"
        className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-100 bg-white flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <Package className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="po-detail-title" className="text-base font-bold text-slate-900 font-mono truncate">{po?.po_no ?? 'Đơn mua'}</h2>
              {st && po && <span className="mt-0.5 inline-flex"><StatusPill label={st.vi} tone={PO_TONE[po.status] ?? 'slate'} /></span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => openPoPdf(poId)}
              title="Tải Đơn đặt hàng (PDF)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-brand-700 transition-colors">
              <Download className="h-3.5 w-3.5" /> Tải PDF
            </button>
            <button onClick={onClose} aria-label="Đóng"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {isError ? (
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Không tải được chi tiết đơn mua.</p>
            </div>
          ) : isLoading || !po ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />)}
            </div>
          ) : (
            <>
              {/* Summary grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Field label="NCC" value={po.vendor_name ?? '—'} />
                <Field label="Hợp đồng" value={po.contract_no ?? '—'} mono />
                <Field label="Ngày PO" value={fmtDateVN(po.po_date)} mono />
                <Field label="Ngày giao yêu cầu" value={fmtDateVN(po.requested_delivery_date)} mono />
                <Field label="Giá trị" value={po.total_amount != null ? `${fmtMoney(po.total_amount)} ${po.currency ?? ''}` : '—'} mono />
                <Field label="Thanh toán" value={po.payment_status ?? '—'} />
                <div className="col-span-2">
                  <Field label="Địa chỉ giao" value={po.delivery_address ?? '—'} />
                </div>
                {po.notes && (
                  <div className="col-span-2">
                    <Field label="Ghi chú" value={po.notes} />
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Mã linh kiện ({po.items.length})</h3>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200">
                        <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mã / Quy cách</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Đặt</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Đã giao</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Đơn giá</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {po.items.map((it) => {
                        const ordered = Number(it.ordered_qty ?? 0);
                        const delivered = Number(it.delivered_qty ?? 0);
                        const full = ordered > 0 && delivered >= ordered;
                        return (
                          <tr key={it.id}>
                            <td className="px-3 py-2">
                              <span className="block font-mono text-xs font-semibold text-slate-800">{it.bqms_code ?? '—'}</span>
                              {it.specification && <span className="block truncate text-xs text-slate-400 max-w-[260px]" title={it.specification}>{it.specification}</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtMoney(ordered)} <span className="text-[11px] text-slate-400">{it.unit}</span></td>
                            <td className={cn('px-3 py-2 text-right tabular-nums font-semibold', full ? 'text-emerald-700' : delivered > 0 ? 'text-amber-700' : 'text-slate-400')}>{fmtMoney(delivered)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-600">{it.unit_price != null ? fmtMoney(it.unit_price) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Deliveries */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Lần giao hàng ({po.deliveries.length})</h3>
                {po.deliveries.length === 0 ? (
                  <p className="text-sm text-slate-400 italic px-1">Chưa có lần giao nào.</p>
                ) : (
                  <div className="space-y-1.5">
                    {po.deliveries.map((d) => {
                      const dst = DELIVERY_STATUS[d.status] ?? DELIVERY_STATUS.pending;
                      return (
                        <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-[13px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <Truck className="h-4 w-4 text-slate-400 shrink-0" />
                            <span className="font-mono text-xs font-semibold text-slate-700 truncate">{d.delivery_no}</span>
                            <span className="text-slate-400 truncate">{DELIVERY_METHOD_VI[d.delivery_method ?? ''] ?? d.delivery_method ?? '—'}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-xs text-slate-500">{fmtDateVN(d.delivered_at ?? d.created_at)}</span>
                            <StatusPill label={dst.vi} tone={DELIVERY_TONE[d.status] ?? 'slate'} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {po && (canRecord || canCancel) && (
          <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
            {canCancel && (
              <button onClick={() => setShowCancel(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 ring-1 ring-inset ring-rose-200 rounded-lg transition-colors">
                <Ban className="h-4 w-4" /> Huỷ PO
              </button>
            )}
            {canRecord && (
              <button onClick={() => setShowRecord(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors">
                <PackageCheck className="h-4 w-4" /> Ghi nhận giao hàng
              </button>
            )}
          </div>
        )}
      </div>

      {showRecord && po && (
        <RecordDeliveryModal po={po} onClose={() => setShowRecord(false)} onDone={() => { setShowRecord(false); invalidate(); }} />
      )}
      {showCancel && po && (
        <CancelPOModal po={po} onClose={() => setShowCancel(false)} onDone={() => { setShowCancel(false); invalidate(); }} />
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-slate-800', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  );
}

// ─── Record Delivery Modal (admin records a shipment) ───────────

function RecordDeliveryModal({ po, onClose, onDone }: { po: PODetail; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<'courier' | 'vendor_delivery' | 'pickup' | 'express'>('vendor_delivery');
  const [trackingNo, setTrackingNo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  // Per-item delivered_qty (string-keyed by po_item_id) — only positive entries submitted.
  const [qtys, setQtys] = useState<Record<number, string>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setQty = (id: number, v: string) => setQtys((m) => ({ ...m, [id]: v }));

  const handleSave = async () => {
    const items = po.items
      .map((it) => ({ po_item_id: it.id, delivered_qty: Number(qtys[it.id]) }))
      .filter((x) => Number.isFinite(x.delivered_qty) && x.delivered_qty > 0);
    if (items.length === 0) { toast.error('Cần nhập số lượng giao cho ít nhất 1 mã'); return; }
    setSaving(true);
    try {
      const res = await api.post<{ message?: string }>(`/api/v1/procurement/pos/${po.id}/deliveries`, {
        delivery_method: method,
        tracking_no: trackingNo.trim() || null,
        notes: notes.trim() || null,
        items,
      });
      toast.success(res?.message ?? 'Đã ghi nhận giao hàng');
      onDone();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="record-del-title"
        className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 bg-white flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <PackageCheck className="h-5 w-5 text-white" />
            </div>
            <h2 id="record-del-title" className="text-base font-bold text-slate-900">Ghi nhận giao hàng · <span className="font-mono">{po.po_no}</span></h2>
          </div>
          <button onClick={onClose} aria-label="Đóng"
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Phương thức giao</label>
              <select value={method} onChange={(e) => setMethod(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all bg-white">
                <option value="vendor_delivery">NCC tự giao</option>
                <option value="courier">Chuyển phát</option>
                <option value="express">Hoả tốc</option>
                <option value="pickup">Tự lấy</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mã vận đơn</label>
              <input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="VD: GHN123456789"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Số lượng giao theo mã</label>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200">
                    <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mã</th>
                    <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Đặt</th>
                    <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Đã giao</th>
                    <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500" style={{ width: 130 }}>Giao lần này</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {po.items.map((it) => {
                    const ordered = Number(it.ordered_qty ?? 0);
                    const delivered = Number(it.delivered_qty ?? 0);
                    const remaining = Math.max(0, ordered - delivered);
                    return (
                      <tr key={it.id}>
                        <td className="px-3 py-2">
                          <span className="block font-mono text-xs font-semibold text-slate-800">{it.bqms_code ?? '—'}</span>
                          {it.specification && <span className="block truncate text-xs text-slate-400 max-w-[220px]" title={it.specification}>{it.specification}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtMoney(ordered)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtMoney(delivered)}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number" min={0} step="any"
                            value={qtys[it.id] ?? ''}
                            onChange={(e) => setQty(it.id, e.target.value)}
                            placeholder={remaining > 0 ? String(remaining) : '0'}
                            aria-label={`Số lượng giao ${it.bqms_code ?? it.id}`}
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right tabular-nums focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ghi chú</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú về lần giao này…"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all resize-none" />
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">Huỷ</button>
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Ghi nhận
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cancel PO Modal (reason-required → status='cancelled') ─────

function CancelPOModal({ po, onClose, onDone }: { po: PODetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCancel = async () => {
    if (!reason.trim()) { toast.error('Cần nhập lý do huỷ'); return; }
    setSaving(true);
    try {
      const res = await api.post<{ message?: string }>(`/api/v1/procurement/pos/${po.id}/cancel`, {
        reason: reason.trim(),
      });
      toast.success(res?.message ?? 'Đã huỷ PO');
      onDone();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="cancel-po-title"
        className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 bg-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-rose-600 flex items-center justify-center shrink-0">
              <Ban className="h-5 w-5 text-white" />
            </div>
            <h2 id="cancel-po-title" className="text-base font-bold text-slate-900">Huỷ <span className="font-mono">{po.po_no}</span></h2>
          </div>
          <button onClick={onClose} aria-label="Đóng"
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Huỷ toàn bộ đơn mua. Hành động không thể hoàn tác — lý do sẽ ghi vào lịch sử.</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Lý do huỷ *</label>
            <textarea ref={reasonRef} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="VD: NCC không đáp ứng tiến độ giao hàng…"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all resize-none" />
          </div>
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">Đóng</button>
          <button onClick={handleCancel} disabled={saving || !reason.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Huỷ PO
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delivery Tab (Đợt 4) ───────────────────────────────────────

const DELIVERY_STATUS_FILTERS: Array<'all' | DeliveryStatus> = [
  'all', 'pending', 'shipping', 'arrived', 'received', 'rejected', 'returned',
];

function DeliveryTab() {
  const [status, setStatus] = useState<'all' | DeliveryStatus>('all');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  const { data, isLoading, isError, isFetching } = useQuery<{ data: Delivery[]; total: number }>({
    queryKey: ['vb-deliveries', status, page],
    queryFn: () => {
      const p = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE) });
      return api.get<{ data: Delivery[]; total: number }>(`/api/v1/procurement/deliveries?${p}`);
    },
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });

  const deliveries = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  return (
    <div className={SHELL.sectionStack}>
      <FilterBar>
        <Filter className="h-4 w-4 text-slate-400" />
        <SegMenu
          options={DELIVERY_STATUS_FILTERS.map((k) => ({ id: k, label: k === 'all' ? 'Tất cả' : DELIVERY_STATUS[k].vi }))}
          value={status}
          onChange={(k) => { setStatus(k); setPage(1); }}
        />
        <span className="ml-auto text-[12px] text-slate-500 tabular-nums">{total} lần giao</span>
      </FilterBar>

      <DataPanel flush>
        {isError ? (
          <ErrorNote>Không tải được danh sách giao hàng. Vui lòng thử lại.</ErrorNote>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Mã giao</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Trạng thái</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Mã PO / NCC</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Ngày giao</th>
                <th className={cn(TYPE.th, 'text-left whitespace-nowrap px-3 py-2.5')}>Phương thức</th>
                <th className={cn(TYPE.th, 'text-right whitespace-nowrap px-3 py-2.5')}>Số mã</th>
                <th className="px-3 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody aria-busy={isFetching} className={cn(DEPTH.divider, 'transition-opacity', isFetching && !isLoading && 'opacity-60')}>
              {isLoading ? (
                [...Array(8)].map((_, i) => <SkeletonRow key={i} cols={7} />)
              ) : deliveries.length === 0 ? (
                <tr><td colSpan={7} className="p-3 py-16">
                  <EmptyState icon={<Truck className="h-8 w-8 text-slate-400" />}
                    title="Chưa có lần giao hàng nào."
                    hint="Ghi nhận giao hàng từ chi tiết đơn mua, hoặc NCC tự gửi qua portal." />
                </td></tr>
              ) : (
                deliveries.map((d) => {
                  const st = DELIVERY_STATUS[d.status] ?? DELIVERY_STATUS.pending;
                  return (
                    <tr key={d.id}
                      role="button" tabIndex={0}
                      onClick={() => setOpenId(d.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(d.id); } }}
                      className={cn('group cursor-pointer transition-colors', DEPTH.zebra, DEPTH.rowHover, 'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500')}>
                      <td className={cn('px-3 py-2.5 whitespace-nowrap', TYPE.code)}>{d.delivery_no}</td>
                      <td className="px-3 py-2.5">
                        <StatusPill label={st.vi} tone={DELIVERY_TONE[d.status] ?? 'slate'} pulse={d.status === 'shipping'} />
                      </td>
                      <td className="px-3 py-2.5 max-w-[240px]">
                        <span className={cn('block', TYPE.code)}>{d.po_no ?? '—'}</span>
                        {d.vendor_name && <span className="block truncate text-[12px] text-slate-500" title={d.vendor_name}>{d.vendor_name}</span>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px] text-slate-500 whitespace-nowrap">{fmtDateVN(d.delivered_at ?? d.created_at)}</td>
                      <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">{DELIVERY_METHOD_VI[d.delivery_method ?? ''] ?? d.delivery_method ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{d.item_count}</td>
                      <td className="px-3 py-2.5">
                        <Chevron className="h-4 w-4 text-slate-300 group-hover:text-brand-600 transition-colors" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        )}

        {!isError && total > 0 && (
          <Pager offset={offset} total={total} page={page} totalPages={totalPages}
            unit="lần giao" onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(totalPages, p + 1))} />
        )}
      </DataPanel>

      {openId != null && <DeliveryDetailModal deliveryId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ─── Delivery Detail Modal ──────────────────────────────────────

function DeliveryDetailModal({ deliveryId, onClose }: { deliveryId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const { data, isLoading, isError } = useQuery<{ data: DeliveryDetail }>({
    queryKey: ['vb-delivery', deliveryId],
    queryFn: () => api.get<{ data: DeliveryDetail }>(`/api/v1/procurement/deliveries/${deliveryId}`),
  });
  const d = data?.data;
  const st = d ? (DELIVERY_STATUS[d.status] ?? DELIVERY_STATUS.pending) : null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['vb-delivery', deliveryId] });
    queryClient.invalidateQueries({ queryKey: ['vb-deliveries'] });
    queryClient.invalidateQueries({ queryKey: ['vb-pos'] });
    queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
  };

  const changeStatus = async (next: DeliveryStatus, reason?: string) => {
    setBusy(true);
    try {
      const body: Record<string, any> = { status: next };
      if (next === 'rejected' && reason) body.rejection_reason = reason;
      const res = await api.put<{ message?: string }>(`/api/v1/procurement/deliveries/${deliveryId}/status`, body);
      toast.success(res?.message ?? 'Đã cập nhật trạng thái');
      setShowReject(false);
      invalidate();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  // Đợt 8 #5 — buyer chấm chất lượng từng mã (unblock yếu tố chất lượng scorecard).
  const changeQuality = async (itemId: number, qs: string) => {
    setBusy(true);
    try {
      await api.patch(`/api/v1/procurement/deliveries/${deliveryId}/items/${itemId}/quality`, { quality_status: qs });
      invalidate();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  // Đợt 10 #4 — buyer xác nhận SỐ THỰC NHẬN từng mã (số nội bộ, NCC không thấy).
  const changeConfirmedQty = async (itemId: number, val: number) => {
    setBusy(true);
    try {
      await api.patch(`/api/v1/procurement/deliveries/${deliveryId}/items/${itemId}/confirm-qty`, { confirmed_qty: val });
      invalidate();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setBusy(false);
    }
  };

  // Forward-only transitions mirroring backend allowed values.
  const canArrive = d ? ['pending', 'shipping'].includes(d.status) : false;
  const canReceive = d ? ['shipping', 'arrived'].includes(d.status) : false;
  const canReject = d ? ['pending', 'shipping', 'arrived'].includes(d.status) : false;
  const canReturn = d ? ['arrived', 'received'].includes(d.status) : false;
  const anyAction = canArrive || canReceive || canReject || canReturn;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="del-detail-title"
        className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 bg-white flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <Truck className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="del-detail-title" className="text-base font-bold text-slate-900 font-mono truncate">{d?.delivery_no ?? 'Giao hàng'}</h2>
              {st && d && <span className="mt-0.5 inline-flex"><StatusPill label={st.vi} tone={DELIVERY_TONE[d.status] ?? 'slate'} /></span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => openDeliveryNotePdf(deliveryId)}
              title="Tải Phiếu Giao Nhận (PDF)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-brand-700 transition-colors">
              <Download className="h-3.5 w-3.5" /> Phiếu Giao Nhận
            </button>
            <button onClick={onClose} aria-label="Đóng"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {isError ? (
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Không tải được chi tiết giao hàng.</p>
            </div>
          ) : isLoading || !d ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Field label="Mã PO" value={d.po_no ?? '—'} mono />
                <Field label="NCC" value={d.vendor_name ?? '—'} />
                <Field label="Phương thức" value={DELIVERY_METHOD_VI[d.delivery_method ?? ''] ?? d.delivery_method ?? '—'} />
                <Field label="Mã vận đơn" value={d.tracking_no ?? '—'} mono />
                <Field label="Ngày giao" value={fmtDateVN(d.delivered_at ?? d.created_at)} mono />
                <Field label="Ngày nhận" value={fmtDateVN(d.received_at)} mono />
                {/* Đợt 8 #3 — đóng gói / hóa đơn (chỉ hiện khi có) */}
                {d.vendor_invoice_no && <Field label="Số hóa đơn" value={d.vendor_invoice_no} mono />}
                {d.invoice_date && <Field label="Ngày hóa đơn" value={fmtDateVN(d.invoice_date)} mono />}
                {d.packing_qty != null && <Field label="Số kiện" value={`${d.packing_qty}${d.packing_unit ? ' ' + d.packing_unit : ''}`} />}
                {d.gross_weight != null && <Field label="Tổng KL" value={`${d.gross_weight} KG`} mono />}
                {d.rejection_reason && (
                  <div className="col-span-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-500">Lý do từ chối</p>
                    <p className="mt-0.5 text-rose-700">{d.rejection_reason}</p>
                  </div>
                )}
                {d.notes && (
                  <div className="col-span-2">
                    <Field label="Ghi chú" value={d.notes} />
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Mã đã giao ({d.items.length})</h3>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200">
                        <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mã / Quy cách</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">SL giao</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">SL nhận</th>
                        <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Chất lượng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {d.items.map((it) => {
                        const qcls = it.quality_status === 'ok'
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                          : it.quality_status === 'minor_defect'
                            ? 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200'
                            : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200';
                        const qvi = it.quality_status === 'ok' ? 'Đạt' : it.quality_status === 'minor_defect' ? 'Lỗi nhẹ' : 'Loại';
                        return (
                          <tr key={it.id}>
                            <td className="px-3 py-2">
                              <span className="block font-mono text-xs font-semibold text-slate-800">{it.bqms_code ?? '—'}</span>
                              {it.specification && <span className="block truncate text-xs text-slate-400 max-w-[260px]" title={it.specification}>{it.specification}</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtMoney(it.delivered_qty)} <span className="text-[11px] text-slate-400">{it.unit}</span></td>
                            <td className="px-3 py-2 text-right">
                              {/* Đợt 10 #4 — buyer xác nhận SỐ THỰC NHẬN (nội bộ; placeholder = SL giao). */}
                              <input
                                type="number"
                                min={0}
                                step="any"
                                defaultValue={it.confirmed_qty ?? ''}
                                placeholder={it.delivered_qty != null ? String(it.delivered_qty) : ''}
                                disabled={busy || !(d.status === 'arrived' || d.status === 'received')}
                                aria-label={`Số nhận mã ${it.bqms_code ?? it.id}`}
                                onBlur={(e) => {
                                  const raw = e.target.value.trim();
                                  if (raw === '') return;
                                  const v = Number(raw);
                                  if (!Number.isFinite(v) || v < 0) return;
                                  if (v !== (it.confirmed_qty ?? null)) changeConfirmedQty(it.id, v);
                                }}
                                className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right text-[13px] tabular-nums text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:opacity-60"
                              />
                              {it.confirmed_qty != null && Number(it.confirmed_qty) !== Number(it.delivered_qty ?? 0) && (
                                <span className="ml-1 text-[11px] text-amber-600" title="Lệch số NCC khai">≠</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {/* Đợt 8 #5 — chấm chất lượng editable (giữ màu badge theo trạng thái) */}
                              <select
                                value={it.quality_status ?? 'ok'}
                                onChange={(e) => changeQuality(it.id, e.target.value)}
                                disabled={busy}
                                aria-label={`Chất lượng mã ${it.bqms_code ?? it.id}`}
                                title={qvi}
                                className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-50', qcls)}
                              >
                                <option value="ok">Đạt</option>
                                <option value="minor_defect">Lỗi nhẹ</option>
                                <option value="rejected">Loại</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Đợt 8 #6 — chứng từ CO/CQ NCC đã upload */}
              {parseDeliveryDocs(d.documents).length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Chứng từ CO/CQ ({parseDeliveryDocs(d.documents).length})</h3>
                  <div className="flex flex-wrap gap-2">
                    {parseDeliveryDocs(d.documents).map((doc, i) => (
                      <button key={i} onClick={() => openDeliveryDoc(deliveryId, i, doc.name)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-brand-700 transition-colors"
                        title={doc.name}>
                        <Download className="h-3.5 w-3.5" /> <span className="max-w-[180px] truncate">{doc.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showReject && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 space-y-2">
                  <label className="block text-[11px] font-semibold text-rose-700">Lý do từ chối *</label>
                  <textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="VD: Hàng không đúng quy cách…"
                    className="w-full px-3 py-2 border border-rose-200 rounded-lg text-sm focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all resize-none bg-white" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowReject(false)} disabled={busy}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">Bỏ qua</button>
                    <button onClick={() => changeStatus('rejected', rejectReason.trim())} disabled={busy || !rejectReason.trim()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-50">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Xác nhận từ chối
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {d && anyAction && !showReject && (
          <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 flex-wrap shrink-0">
            {canReject && (
              <button onClick={() => setShowReject(true)} disabled={busy}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 ring-1 ring-inset ring-rose-200 rounded-lg transition-colors disabled:opacity-50">
                <Ban className="h-4 w-4" /> Từ chối
              </button>
            )}
            {canReturn && (
              <button onClick={() => changeStatus('returned')} disabled={busy}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 ring-1 ring-inset ring-rose-200 rounded-lg transition-colors disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Trả lại
              </button>
            )}
            {canArrive && (
              <button onClick={() => changeStatus('arrived')} disabled={busy}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 ring-1 ring-inset ring-amber-200 rounded-lg transition-colors disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />} Đánh dấu đã đến
              </button>
            )}
            {canReceive && (
              <button onClick={() => changeStatus('received')} disabled={busy}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Đã nhận hàng
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── New Batch Modal ────────────────────────────────────────────

function NewBatchModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [awardMode, setAwardMode] = useState<'per_item' | 'per_batch'>('per_item');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('17:00');
  const [sealed, setSealed] = useState(false); // Đợt 2b [SB] — niêm phong giá tới hạn (default OFF)
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Escape-to-close, autofocus first field, lock body scroll while open.
  useEffect(() => {
    titleRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Cần nhập tiêu đề'); return; }
    setSaving(true);
    try {
      const res = await api.post<{ data?: { id?: number } }>('/api/v1/procurement/batches', {
        title: title.trim(),
        description: description.trim() || null,
        award_mode: awardMode,
        bid_deadline: composeDeadlineISO(deadlineDate, deadlineTime),
        sealed_until_deadline: sealed,
      });
      toast.success('Đã tạo phiên');
      queryClient.invalidateQueries({ queryKey: ['vb-batches'] });
      queryClient.invalidateQueries({ queryKey: ['vb-stats'] });
      const id = res?.data?.id;
      onClose();
      if (id) router.push(`/vendor-bidding/${id}`);
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="new-batch-title"
        className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-100 bg-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <Gavel className="h-5 w-5 text-white" />
            </div>
            <h2 id="new-batch-title" className="text-base font-bold text-slate-900">Tạo phiên đấu thầu mới</h2>
          </div>
          <button onClick={onClose} aria-label="Đóng"
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tiêu đề *</label>
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Linh kiện CNC tháng 6/2026"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mô tả</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả phiên — nguồn từ BQMS, yêu cầu, deadline tổng..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all resize-none" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Cách chốt winner</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAwardMode('per_item')}
                className={cn('p-3 rounded-lg border-2 text-left transition-all',
                  awardMode === 'per_item' ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300')}>
                <div className="text-xs font-bold text-slate-800">Theo từng mã</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Mỗi mã có thể chốt 1 NCC khác nhau</div>
              </button>
              <button type="button" onClick={() => setAwardMode('per_batch')}
                className={cn('p-3 rounded-lg border-2 text-left transition-all',
                  awardMode === 'per_batch' ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300')}>
                <div className="text-xs font-bold text-slate-800">Toàn phiên</div>
                <div className="text-[11px] text-slate-500 mt-0.5">1 NCC trúng cả gói</div>
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Hạn báo giá <span className="font-normal text-slate-400">(tuỳ chọn · giờ VN)</span>
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Clock className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)}
                  className="w-full pl-8 pr-2 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all" />
              </div>
              <input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)}
                disabled={!deadlineDate}
                className="w-28 px-2 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all disabled:opacity-50" />
            </div>
          </div>
          {/* Đợt 2b [SB] — niêm phong giá tới hạn (default OFF). Ẩn đơn giá NCC ở
              ma trận/tờ trình cho tới khi qua hạn báo giá (chống rò giá NCC↔NCC). */}
          <label className="flex items-start gap-3 p-3 rounded-lg border-2 border-slate-200 cursor-pointer hover:border-slate-300 transition-all">
            <input type="checkbox" checked={sealed} onChange={(e) => setSealed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            <span>
              <span className="block text-xs font-bold text-slate-800">Niêm phong giá tới hạn</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Ẩn đơn giá NCC ở ma trận / tờ trình cho tới khi qua hạn báo giá (chống rò giá giữa các NCC).
                Chưa đặt hạn → giữ kín tới khi đặt hạn.
              </span>
            </span>
          </label>
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">
            Huỷ
          </button>
          <button onClick={handleSave} disabled={saving || !title.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Tạo & vào chi tiết
          </button>
        </div>
      </div>
    </div>
  );
}
