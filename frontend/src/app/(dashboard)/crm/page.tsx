'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuth } from '@/providers/auth-provider';
import {
  Building2, User2, Briefcase,
  Pencil, X, Save, FileText,
  Search, Plus, LayoutGrid, Loader2, Bell, UserPlus, PhoneCall,
} from 'lucide-react';
import {
  PageShellHeader, StatStrip, DataPanel, StatusPill, DensityToggle,
  SkeletonRow, CountUp,
  TYPE, BUTTON, SHELL, DEPTH, ELEVATION, ROW_PADDING, BADGE,
  type BadgeTone, type Density, type StatChip,
} from '@/components/cockpit';
import { WorkQueueRail, type FollowUpDue } from './_components/WorkQueueRail';
import { Pagination } from './_components/Pagination';

// Code-splitting (W3-16): QuoteBatchModal is 1669 lines and only opens on
// click (state-gated below) — defer its chunk out of this route's bundle.
const QuoteBatchModal = dynamic(
  () => import('@/components/sourcing/QuoteBatchModal').then((m) => m.QuoteBatchModal),
  { ssr: false, loading: () => null },
);

// ─── Types ──────────────────────────────────────────────────────

interface Card {
  id: number;
  stage: string;
  title: string;
  description?: string;
  customer_id?: number;
  customer_name?: string;
  rfq_number?: string;
  po_number?: string;
  bqms_code?: string;
  follow_up_date?: string;
  follow_up_note?: string;
  assigned_name?: string;
  priority: string;
  source: string;
  is_overdue?: boolean;
  created_at: string;
  moved_at: string;
}

interface StageData {
  label: string;
  cards: Card[];
  count: number;
}

// ─── Constants ──────────────────────────────────────────────────

const STAGES = ['new', 'nurturing', 'active', 'delivering', 'aftercare'];

// ONE functional dot + left-rule per stage (design-restraint: NO rainbow tiles).
const STAGE_TONE: Record<string, { dot: string; rule: string }> = {
  new: { dot: 'bg-slate-400', rule: 'border-l-slate-400' },
  nurturing: { dot: 'bg-sky-500', rule: 'border-l-sky-500' },
  active: { dot: 'bg-amber-500', rule: 'border-l-amber-500' },
  delivering: { dot: 'bg-brand-500', rule: 'border-l-brand-500' },
  aftercare: { dot: 'bg-emerald-500', rule: 'border-l-emerald-500' },
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'border-l-rose-500',
  high: 'border-l-amber-500',
  normal: 'border-l-slate-300',
  low: 'border-l-slate-200',
};

const EMPTY_DUE: FollowUpDue = {
  overdue: [], today: [], upcoming: [], counts: { overdue: 0, today: 0, upcoming: 0 },
};

// "staff" per locked decision = sales role; manager/admin = elevated.
const MANAGER_ROLES = new Set(['admin', 'director', 'manager']);

// ─── Page Component ─────────────────────────────────────────────

export default function CRMPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isManager = MANAGER_ROLES.has(user?.role ?? '');

  // (4) view-mode: table is the default landing; Pipeline is demoted.
  const [view, setView] = useState<'table' | 'pipeline'>('table');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [dragCard, setDragCard] = useState<Card | null>(null);
  const [generating, setGenerating] = useState(false);

  // (2) work-queue scope + below-xl slide-over.
  const [queueScope, setQueueScope] = useState<'mine' | 'all'>('mine');
  const [queueOpen, setQueueOpen] = useState(false);
  const [quickLog, setQuickLog] = useState<{ customerId: number; companyName: string } | null>(null);

  // Follow-ups due — drives both the rail and the StatStrip counts.
  // Contract: { data:{overdue,today,upcoming}, counts:{overdue,today,upcoming} }.
  const { data: dueData, isFetching: dueFetching } = useQuery({
    queryKey: ['crm-followups-due', queueScope],
    queryFn: () => api.get<{
      data: Pick<FollowUpDue, 'overdue' | 'today' | 'upcoming'>;
      counts: FollowUpDue['counts'];
    }>(`/api/v1/crm/follow-ups/due?scope=${queueScope}&limit=80`),
    refetchInterval: 60000,
  });

  const due: FollowUpDue = useMemo(() => {
    const d = dueData?.data;
    if (!d) return EMPTY_DUE;
    const overdue = d.overdue ?? [];
    const today = d.today ?? [];
    const upcoming = d.upcoming ?? [];
    return {
      overdue, today, upcoming,
      counts: dueData?.counts ?? {
        overdue: overdue.length, today: today.length, upcoming: upcoming.length,
      },
    };
  }, [dueData]);

  // Customers list — single source for the table + the StatStrip totals.
  const ownerFilter = queueScope === 'mine' ? 'mine' : undefined;
  const { data: custData, isFetching: custFetching } = useQuery({
    queryKey: ['crm-customers-v2', ownerFilter],
    queryFn: () => api.get<any>(
      `/api/v1/crm/customers?page_size=500${ownerFilter ? `&owner=${ownerFilter}` : ''}`,
    ),
  });

  const customers: Customer[] = useMemo(() => {
    const raw = custData?.data;
    return (Array.isArray(raw) ? raw : raw?.customers ?? []) as Customer[];
  }, [custData]);

  // Pipeline board fetch (only when pipeline view is active) — drives its refetch bar.
  const { isFetching: boardFetching } = useQuery({
    queryKey: ['crm-board'],
    queryFn: () => api.get<any>('/api/v1/crm/pipeline/board'),
    refetchInterval: 30000,
    enabled: view === 'pipeline',
  });

  // ── StatStrip metrics (1) ────────────────────────────────────
  const strip = useMemo(() => {
    const total = customers.length;
    const withOrders = customers.filter((c) => (c.total_orders ?? 0) > 0).length;
    const revenue = customers.reduce((s, c) => s + Number(c.total_revenue || 0), 0);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const newThisMonth = customers.filter((c) => {
      if (!c.created_at) return false;
      return new Date(c.created_at).getTime() >= monthStart;
    }).length;
    return { total, withOrders, revenue, newThisMonth };
  }, [customers]);

  const overdueCount = due.counts.overdue;
  const todayCount = due.counts.today;
  const totalDue = overdueCount + todayCount + due.counts.upcoming;

  const handleQuickLog = useCallback((customerId: number, companyName: string) => {
    setQuickLog({ customerId, companyName });
  }, []);

  const doneMutation = useMutation({
    mutationFn: (interactionId: number) =>
      api.patch(`/api/v1/crm/interactions/${interactionId}/done`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-followups-due'] });
      toast.success('Đã đánh dấu xong');
    },
    onError: (e: any) => toast.error(e?.detail ?? 'Không thể đánh dấu xong'),
  });

  const openCustomer = useCallback((id: number) => router.push(`/crm/${id}`), [router]);

  const stripItems: StatChip[] = useMemo(() => [
    { label: 'Tổng KH', value: <CountUp value={strip.total} /> },
    { label: 'Có đơn', value: <CountUp value={strip.withOrders} />, tone: 'emerald', divider: true },
    {
      label: 'Doanh thu',
      value: fmtRevenue(strip.revenue),
      divider: true,
      title: `${strip.revenue.toLocaleString('vi-VN')} ₫`,
    },
    {
      label: 'Quá hạn FU', value: overdueCount, tone: 'rose', pulse: overdueCount > 0,
      emphasizeValue: overdueCount > 0, divider: true,
      onClick: () => setQueueOpen(true), title: 'Follow-up quá hạn',
    },
    {
      label: 'Hôm nay', value: todayCount, tone: 'amber',
      emphasizeValue: todayCount > 0, onClick: () => setQueueOpen(true),
    },
    { label: 'Mới tháng', value: strip.newThisMonth, tone: 'sky', alignEnd: true },
  ], [strip, overdueCount, todayCount]);

  const isFetching = view === 'pipeline' ? boardFetching : custFetching || dueFetching;

  return (
    <div className={cn(SHELL.page, '-m-6')}>
      {/* (1) Sticky cockpit header. */}
      <PageShellHeader
        title="Khách hàng"
        eyebrow="CRM · Bàn làm việc"
        isFetching={isFetching}
        leading={
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600">
            <Building2 className="h-[18px] w-[18px] text-white" />
          </div>
        }
        actions={
          <>
            {/* (4) view-mode toggle — table default, pipeline demoted. */}
            <SegMenu
              options={[{ id: 'table', label: 'Bảng' }, { id: 'pipeline', label: 'Pipeline' }] as const}
              value={view}
              onChange={setView}
            />
            {/* (5) [+ Báo giá] — opens the Quote Hub modal; user picks a customer inside. */}
            <button
              onClick={() => setShowQuoteModal(true)}
              className={BUTTON.secondary}
            >
              <FileText className="h-4 w-4" /> Báo giá
            </button>
            {view === 'pipeline' ? (
              <>
                <button
                  onClick={async () => {
                    setGenerating(true);
                    try {
                      const res = await api.post<any>('/api/v1/crm/pipeline/generate');
                      queryClient.invalidateQueries({ queryKey: ['crm-board'] });
                      toast.success(res.message || 'Đã tạo card từ BQMS');
                    } catch {} finally { setGenerating(false); }
                  }}
                  disabled={generating}
                  className={BUTTON.secondary}
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {generating ? 'Đang tạo…' : 'Tạo từ BQMS'}
                </button>
                <button onClick={() => setShowCreateModal(true)} className={BUTTON.primary}>
                  <Plus className="h-4 w-4" /> Thêm card
                </button>
              </>
            ) : (
              <button onClick={() => router.push('/crm/new')} className={BUTTON.primary}>
                <Plus className="h-4 w-4" /> Thêm KH
              </button>
            )}
          </>
        }
      />

      {/* (1) Sticky StatStrip replaces the 4-card KPI hero. */}
      <StatStrip items={stripItems} sticky />

      <div className={cn(SHELL.content, 'pt-4 pb-6')}>
        {view === 'pipeline' ? (
          <KanbanBoard dragCard={dragCard} setDragCard={setDragCard} />
        ) : (
          /* (2) split-pane: rail (xl) + table-first work area. */
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
            <div className="hidden xl:block">
              <div className="sticky top-[6.5rem]">
                <WorkQueueRail
                  items={due}
                  isLoading={dueFetching && !dueData}
                  scope={queueScope}
                  onScopeChange={setQueueScope}
                  onQuickLog={handleQuickLog}
                  onDone={(id) => doneMutation.mutate(id)}
                  onOpenCustomer={openCustomer}
                  className={cn(ELEVATION.container, 'rounded-lg max-h-[calc(100vh-8rem)]')}
                />
              </div>
            </div>

            {/* Below-xl rail collapses into a chip → slide-over. */}
            <div className="xl:hidden">
              <button
                onClick={() => setQueueOpen(true)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-semibold ring-1',
                  totalDue > 0
                    ? 'bg-amber-50 text-amber-700 ring-amber-200'
                    : 'bg-white text-slate-600 ring-slate-200',
                  DEPTH.focusRing,
                )}
              >
                <Bell className="h-4 w-4" />
                {totalDue > 0 ? `${totalDue} cần làm` : 'Không có việc tồn'}
              </button>
            </div>

            <CustomersWorkArea
              customers={customers}
              isLoading={custFetching && !custData}
              isManager={isManager}
              ownerScope={queueScope}
              onScopeChange={setQueueScope}
              onQuickLog={handleQuickLog}
            />
          </div>
        )}
      </div>

      {/* Below-xl slide-over for the work queue. */}
      {queueOpen && (
        <QueueSlideOver onClose={() => setQueueOpen(false)}>
          <WorkQueueRail
            items={due}
            isLoading={dueFetching && !dueData}
            scope={queueScope}
            onScopeChange={setQueueScope}
            onQuickLog={(id, name) => { setQueueOpen(false); handleQuickLog(id, name); }}
            onDone={(id) => doneMutation.mutate(id)}
            onOpenCustomer={(id) => { setQueueOpen(false); openCustomer(id); }}
          />
        </QueueSlideOver>
      )}

      {/* Quick-log interaction modal (staff-allowed). */}
      {quickLog && (
        <QuickLogModal
          customerId={quickLog.customerId}
          companyName={quickLog.companyName}
          onClose={() => setQuickLog(null)}
          onSaved={() => {
            setQuickLog(null);
            queryClient.invalidateQueries({ queryKey: ['crm-followups-due'] });
            queryClient.invalidateQueries({ queryKey: ['crm-customers-v2'] });
          }}
        />
      )}

      {/* Create card modal (pipeline). */}
      {showCreateModal && (
        <CreateCardModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['crm-board'] });
          }}
        />
      )}

      {/* Quote Hub modal — no initialCustomerId → user picks the customer inside. */}
      {showQuoteModal && (
        <QuoteBatchModal onClose={() => setShowQuoteModal(false)} />
      )}
    </div>
  );
}

// ─── Empty state (cockpit pattern) ──────────────────────────────

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="mx-auto max-w-md space-y-3 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100">{icon}</div>
      <p className={TYPE.h2}>{title}</p>
      {hint && <p className="text-[13px] text-slate-500">{hint}</p>}
    </div>
  );
}

// ─── Slide-over (below-xl queue) ────────────────────────────────

function QueueSlideOver({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm xl:hidden" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="Cần làm hôm nay"
        className={cn('h-full w-[340px] max-w-[90vw] overflow-y-auto bg-white', ELEVATION.modal)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 ring-1 ring-slate-200">
          <span className={cn(TYPE.eyebrow, 'leading-none')}>Cần làm</span>
          <button onClick={onClose} aria-label="Đóng" className={BUTTON.icon}><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Kanban Board ───────────────────────────────────────────────

function KanbanBoard({ dragCard, setDragCard }: { dragCard: Card | null; setDragCard: (c: Card | null) => void }) {
  const queryClient = useQueryClient();

  const { data: boardData, isLoading } = useQuery({
    queryKey: ['crm-board'],
    queryFn: () => api.get<any>('/api/v1/crm/pipeline/board'),
    refetchInterval: 30000,
  });

  const board: Record<string, StageData> = boardData?.data ?? {};

  const moveMutation = useMutation({
    mutationFn: ({ cardId, stage }: { cardId: number; stage: string }) =>
      api.patch(`/api/v1/crm/pipeline/cards/${cardId}/move`, { stage }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-board'] }),
  });

  const handleDrop = (stage: string) => {
    if (dragCard && dragCard.stage !== stage) {
      moveMutation.mutate({ cardId: dragCard.id, stage });
    }
    setDragCard(null);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-5 gap-3">
        {STAGES.map(s => (
          <div key={s} className={cn(ELEVATION.container, 'rounded-lg h-96 animate-pulse')} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-3 min-h-[500px]">
      {STAGES.map(stage => {
        const data = board[stage] || { label: stage, cards: [], count: 0 };
        const tone = STAGE_TONE[stage] || STAGE_TONE.new;

        return (
          <div
            key={stage}
            className={cn(ELEVATION.container, 'rounded-lg flex flex-col min-h-0 overflow-hidden border-l-2', tone.rule)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => handleDrop(stage)}
          >
            {/* Column header — ONE functional dot + count chip. */}
            <div className="px-3.5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600">{data.label}</span>
              </div>
              <span className="text-[11px] font-bold tabular-nums text-slate-700 bg-white px-2 py-0.5 rounded-full ring-1 ring-slate-200">
                {data.count}
              </span>
            </div>

            {/* Cards */}
            <div className="p-2 space-y-2 flex-1 overflow-y-auto">
              {data.cards.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-[11px] text-slate-300 font-medium">Trống</p>
                </div>
              ) : (
                data.cards.map(card => (
                  <PipelineCard
                    key={card.id}
                    card={card}
                    onDragStart={() => setDragCard(card)}
                    onMove={(newStage) => moveMutation.mutate({ cardId: card.id, stage: newStage })}
                    onArchive={async () => {
                      await api.delete(`/api/v1/crm/pipeline/cards/${card.id}`);
                      queryClient.invalidateQueries({ queryKey: ['crm-board'] });
                    }}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Pipeline Card ──────────────────────────────────────────────

function PipelineCard({ card, onDragStart, onMove, onArchive }: {
  card: Card;
  onDragStart: () => void;
  onMove: (stage: string) => void;
  onArchive: () => void;
}) {
  const router = useRouter();
  const [showActions, setShowActions] = useState(false);
  const currentIdx = STAGES.indexOf(card.stage);
  const nextStage = currentIdx < STAGES.length - 1 ? STAGES[currentIdx + 1] : null;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn(
        'group/pc bg-white rounded-lg ring-1 ring-slate-200 p-3 cursor-grab active:cursor-grabbing',
        'transition-all duration-150 hover:ring-slate-300 hover:-translate-y-px border-l-[3px]',
        PRIORITY_COLORS[card.priority] || PRIORITY_COLORS.normal,
        card.is_overdue && 'ring-rose-200',
      )}
      onClick={() => setShowActions(!showActions)}
    >
      {/* Title */}
      <p className="text-[13px] font-bold text-slate-900 mb-1 line-clamp-2 leading-snug">{card.title}</p>

      {/* Customer with avatar initial */}
      {card.customer_name && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="h-4 w-4 rounded-full bg-brand-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
            {String(card.customer_name).charAt(0).toUpperCase()}
          </span>
          <p className="text-[11px] text-slate-600 font-semibold truncate">{card.customer_name}</p>
        </div>
      )}

      {/* Description */}
      {card.description && (
        <p className="text-[11px] text-slate-500 line-clamp-2 mb-2 font-medium leading-relaxed">{card.description}</p>
      )}

      {/* Codes — calm functional chips */}
      <div className="flex flex-wrap gap-1 mb-1.5">
        {card.rfq_number && (
          <span className="inline-flex items-center text-[11px] font-mono font-semibold bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded ring-1 ring-inset ring-sky-100">
            {card.rfq_number}
          </span>
        )}
        {card.po_number && (
          <span className={cn('inline-flex items-center text-[11px] px-1.5 py-0.5 rounded bg-brand-50 ring-1 ring-inset ring-brand-100', TYPE.code)}>
            PO {card.po_number}
          </span>
        )}
      </div>

      {/* Follow-up — calm pill */}
      {card.follow_up_date && (
        <div className={cn('text-[11px] px-2 py-1.5 rounded-md mt-1 font-semibold ring-1 ring-inset',
          card.is_overdue
            ? 'bg-rose-50 text-rose-700 ring-rose-100'
            : 'bg-slate-50 text-slate-600 ring-slate-200'
        )}>
          <div className="flex items-center gap-1">
            <span className={cn('h-1.5 w-1.5 rounded-full', card.is_overdue ? 'bg-rose-500 animate-pulse' : 'bg-slate-400')} />
            {card.is_overdue ? 'Quá hạn:' : 'Follow-up:'} <span className="tabular-nums">{formatDate(card.follow_up_date)}</span>
          </div>
          {card.follow_up_note && <span className="block text-[11px] mt-0.5 font-normal opacity-90 leading-tight">{card.follow_up_note}</span>}
        </div>
      )}

      {/* Assigned */}
      {card.assigned_name && (
        <p className="text-[11px] text-slate-400 mt-1.5 font-medium">{card.assigned_name}</p>
      )}

      {/* Actions */}
      {showActions && (
        <div className="mt-2 pt-2 border-t border-slate-100 flex gap-1.5 flex-wrap">
          {card.customer_id && (
            <button
              onClick={(e) => { e.stopPropagation(); router.push(`/crm/${card.customer_id}`); }}
              className={cn(BUTTON.secondary, 'h-7 px-2.5 text-[11px]')}
            >
              Xem CRM
            </button>
          )}
          {nextStage && (
            <button
              onClick={(e) => { e.stopPropagation(); onMove(nextStage); }}
              className={cn(BUTTON.primary, 'h-7 px-2.5 text-[11px]')}
            >
              Chuyển tiếp →
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className={cn(BUTTON.ghost, 'h-7 px-2.5 text-[11px]')}
          >
            Lưu trữ
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Create Card Modal ──────────────────────────────────────────

function CreateCardModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    title: '', description: '', customer_name: '', stage: 'new',
    rfq_number: '', po_number: '', priority: 'normal',
    follow_up_date: '', follow_up_note: '', assigned_name: '',
  });
  const [saving, setSaving] = useState(false);

  // Escape-to-close + body-scroll-lock (mirror CreatePOModal).
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

  const handleSave = async () => {
    if (!form.title) return;
    setSaving(true);
    try {
      await api.post('/api/v1/crm/pipeline/cards', {
        ...form,
        follow_up_date: form.follow_up_date || null,
      });
      onCreated();
    } catch {} finally { setSaving(false); }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="create-card-title"
        className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <LayoutGrid className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="create-card-title" className="text-base font-bold text-slate-900">Thêm card mới</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Tạo card pipeline thủ công trong CRM</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng"
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tiêu đề *</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Khách hàng</label>
              <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Giai đoạn</label>
              <select value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))} className={cn(inputCls, 'bg-white')}>
                <option value="new">Mới tiếp nhận</option>
                <option value="nurturing">Đang chăm sóc</option>
                <option value="active">Có RFQ/PO mới</option>
                <option value="delivering">Đang giao hàng</option>
                <option value="aftercare">Theo dõi sau bán</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mã RFQ</label>
              <input value={form.rfq_number} onChange={e => setForm(f => ({ ...f, rfq_number: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mã PO</label>
              <input value={form.po_number} onChange={e => setForm(f => ({ ...f, po_number: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mô tả</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2} className={cn(inputCls, 'resize-none')} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ưu tiên</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={cn(inputCls, 'bg-white')}>
                <option value="low">Thấp</option>
                <option value="normal">Bình thường</option>
                <option value="high">Cao</option>
                <option value="urgent">Khẩn cấp</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Follow-up</label>
              <input type="date" value={form.follow_up_date} onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Phụ trách</label>
              <input value={form.assigned_name} onChange={e => setForm(f => ({ ...f, assigned_name: e.target.value }))} className={inputCls} />
            </div>
          </div>
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className={BUTTON.secondary}>Hủy</button>
          <button onClick={handleSave} disabled={saving || !form.title} className={BUTTON.primary}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'Đang tạo…' : 'Tạo card'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Quick-log interaction modal (staff-allowed) ────────────────

function QuickLogModal({ customerId, companyName, onClose, onSaved }: {
  customerId: number; companyName: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    interaction_type: 'call',
    subject: '',
    notes: '',
    follow_up_date: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const handleSave = async () => {
    if (!form.subject.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/v1/crm/interactions', {
        customer_id: customerId,
        interaction_type: form.interaction_type,
        subject: form.subject,
        notes: form.notes || null,
        follow_up_date: form.follow_up_date || null,
      });
      toast.success('Đã ghi tương tác');
      onSaved();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally { setSaving(false); }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="quicklog-title"
        className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
              <PhoneCall className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="quicklog-title" className="text-[15px] font-bold text-slate-900">Ghi tương tác nhanh</h2>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">{companyName}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={BUTTON.icon}><X className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Loại</label>
              <select value={form.interaction_type} onChange={e => setForm(f => ({ ...f, interaction_type: e.target.value }))} className={cn(inputCls, 'bg-white')}>
                <option value="call">Gọi điện</option>
                <option value="email">Email</option>
                <option value="meeting">Gặp mặt</option>
                <option value="zalo">Zalo</option>
                <option value="note">Ghi chú</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Hẹn theo dõi</label>
              <input type="date" value={form.follow_up_date} onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Tiêu đề *</label>
            <input value={form.subject} autoFocus onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} className={inputCls} placeholder="Vd: Gọi xác nhận báo giá" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Nội dung</label>
            <textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={cn(inputCls, 'resize-none')} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className={BUTTON.secondary}>Hủy</button>
          <button onClick={handleSave} disabled={saving || !form.subject.trim()} className={BUTTON.primary}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Đang lưu…' : 'Ghi'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Customers (work-area) ──────────────────────────────────────

interface Customer {
  id: number;
  customer_code: string | null;
  company_name: string;
  short_name: string | null;
  tax_code: string | null;
  address: string | null;
  business_system: string | null;
  customer_type: string | null;
  is_active: boolean;
  industry: string | null;
  company_size: string | null;
  lead_source: string | null;
  preferred_channel: string | null;
  website: string | null;
  notes: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  total_orders: number;
  total_revenue: number;
  last_order_date: string | null;
  contact_count: number;
  interaction_count: number;
  created_at: string | null;
  // augmented by the list endpoint:
  owner_id: string | null;
  owner_name: string | null;
  last_contacted_at: string | null;
}

// Biz-system → cockpit StatusPill tone (info-neutral, no violet per color audit).
const BIZ_TONE: Record<string, BadgeTone> = {
  bqms: 'sky',
  imv: 'emerald',
};

function fmtRevenue(v: number | null | undefined): string {
  if (!v) return '0';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}T`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/** Recency → functional tone (emerald ≤30d, amber ≤90d, rose older, slate none). */
function recencyTone(d: number | null): BadgeTone {
  if (d == null) return 'slate';
  if (d <= 30) return 'emerald';
  if (d <= 90) return 'amber';
  return 'rose';
}

function recencyLabel(d: number | null): string {
  if (d == null) return '—';
  if (d === 0) return 'Hôm nay';
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}th`;
  return `${Math.round(d / 365)}n`;
}

/** Tier-1 filter bar surface (mirror vendor-bidding FilterBar). */
function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded-lg bg-white ring-1 ring-slate-200', SHELL.filterBar)}>
      {children}
    </div>
  );
}

/** Segmented menu (slate track, white active pill, brand text). */
function SegMenu<T extends string>({ options, value, onChange }: {
  options: readonly { id: T; label: string }[];
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

const PAGE_SIZE = 25;

function CustomersWorkArea({
  customers, isLoading, isManager, ownerScope, onScopeChange, onQuickLog,
}: {
  customers: Customer[];
  isLoading: boolean;
  isManager: boolean;
  ownerScope: 'mine' | 'all';
  onScopeChange: (s: 'mine' | 'all') => void;
  onQuickLog: (customerId: number, companyName: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filterBiz, setFilterBiz] = useState<'all' | 'bqms' | 'imv'>('all');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('active');
  const [density, setDensity] = useState<Density>('compact'); // (4) default compact
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [assigning, setAssigning] = useState<Customer | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (filterBiz !== 'all' && c.business_system !== filterBiz) return false;
      if (filterActive === 'active' && !c.is_active) return false;
      if (filterActive === 'inactive' && c.is_active) return false;
      if (q) {
        const hay = [c.company_name, c.short_name, c.customer_code, c.tax_code, c.contact_name, c.owner_name, c.industry]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [customers, search, filterBiz, filterActive]);

  // Reset to page 1 whenever the filter set changes (avoid stranded empty page).
  useEffect(() => { setPage(1); }, [search, filterBiz, filterActive, ownerScope]);

  const total = filtered.length;
  const pageStart = (page - 1) * PAGE_SIZE;
  const paged = useMemo(
    () => filtered.slice(pageStart, pageStart + PAGE_SIZE),
    [filtered, pageStart],
  );

  // Selection helpers (bulk-assign for manager/admin).
  const allOnPageSelected = paged.length > 0 && paged.every((c) => selected.has(c.id));
  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) paged.forEach((c) => next.delete(c.id));
      else paged.forEach((c) => next.add(c.id));
      return next;
    });
  };
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [bulkAssign, setBulkAssign] = useState(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['crm-customers-v2'] });

  const rowPad = ROW_PADDING[density];

  return (
    <div className={SHELL.sectionStack}>
      {/* Filter bar */}
      <FilterBar>
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input type="text" placeholder="Tìm công ty / mã / MST / liên hệ / chủ sở hữu…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className={cn('w-full pl-9 pr-3 py-2 rounded-md bg-slate-50 ring-1 ring-inset ring-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all', TYPE.tableText)} />
        </div>
        {/* ?owner= scope (mine|all) */}
        <SegMenu
          options={[{ id: 'mine', label: 'KH của tôi' }, { id: 'all', label: 'Tất cả' }] as const}
          value={ownerScope} onChange={onScopeChange}
        />
        <SegMenu
          options={(['all', 'bqms', 'imv'] as const).map((k) => ({ id: k, label: k === 'all' ? 'Tất cả hệ' : k.toUpperCase() }))}
          value={filterBiz} onChange={setFilterBiz}
        />
        <SegMenu
          options={(['active', 'inactive', 'all'] as const).map((k) => ({ id: k, label: k === 'active' ? 'Hoạt động' : k === 'inactive' ? 'Ngừng' : 'Tất cả' }))}
          value={filterActive} onChange={setFilterActive}
        />
        <DensityToggle value={density} onChange={setDensity} />
        <span className="ml-auto text-[12px] text-slate-500 tabular-nums">
          <span className="text-brand-700 font-semibold">{total}</span>/{customers.length} KH
        </span>
      </FilterBar>

      {/* Bulk-assign action bar (manager/admin, selection active). */}
      {isManager && selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-brand-50 px-3 py-2 ring-1 ring-brand-200">
          <span className="text-[12px] font-semibold text-brand-800 tabular-nums">
            Đã chọn {selected.size} KH
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setBulkAssign(true)} className={cn(BUTTON.primary, 'h-7 px-2.5 text-[12px]')}>
              <UserPlus className="h-3.5 w-3.5" /> Gán chủ sở hữu
            </button>
            <button onClick={() => setSelected(new Set())} className={cn(BUTTON.ghost, 'h-7 px-2.5 text-[12px]')}>
              Bỏ chọn
            </button>
          </div>
        </div>
      )}

      {/* (3) DENSE paged table */}
      <DataPanel flush>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className={cn('sticky top-0 z-10 bg-slate-50', ELEVATION.floating)}>
              <tr className="border-b border-slate-200">
                {isManager && (
                  <th className="w-9 px-2 py-2 text-center">
                    <input type="checkbox" aria-label="Chọn tất cả trang"
                      checked={allOnPageSelected} onChange={toggleAllOnPage}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                  </th>
                )}
                <th className="w-6 px-1.5 py-2"></th>
                <th className={cn(TYPE.th, 'text-left px-3 py-2')}>Công ty</th>
                <th className={cn(TYPE.th, 'text-left px-3 py-2')}>Mã / MST</th>
                <th className={cn(TYPE.th, 'text-left px-3 py-2')}>Sở hữu</th>
                <th className={cn(TYPE.th, 'text-right px-3 py-2')}>Đơn</th>
                <th className={cn(TYPE.th, 'text-right px-3 py-2')}>Doanh thu</th>
                <th className={cn(TYPE.th, 'text-left px-3 py-2')}>Liên hệ gần</th>
                <th className="w-px px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className={DEPTH.divider}>
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <SkeletonRow key={i} cols={isManager ? 9 : 8} density={density} />
                ))
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={isManager ? 9 : 8} className="py-16">
                    <EmptyState icon={<Building2 className="h-8 w-8 text-slate-400" />}
                      title="Không tìm thấy khách hàng phù hợp"
                      hint="Thử đổi bộ lọc, phạm vi hoặc từ khoá." />
                  </td>
                </tr>
              ) : (
                paged.map((c) => {
                  const last = c.last_contacted_at ?? c.last_order_date;
                  const d = daysSince(last);
                  const tone = recencyTone(d);
                  const dotTone: BadgeTone = !c.is_active ? 'slate' : tone;
                  return (
                    <tr key={c.id} className={cn('group transition-colors', DEPTH.zebra, DEPTH.rowHover, selected.has(c.id) && DEPTH.activeWash)}>
                      {isManager && (
                        <td className="w-9 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`Chọn ${c.company_name}`}
                            checked={selected.has(c.id)} onChange={() => toggleOne(c.id)}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                        </td>
                      )}
                      {/* ● status dot (BADGE token → static Tailwind class) */}
                      <td className="px-1.5 py-1.5 align-middle">
                        <span className={cn('inline-block h-[6px] w-[6px] rounded-full', BADGE[dotTone].dot)}
                          title={c.is_active ? 'Hoạt động' : 'Ngừng'}
                        />
                      </td>
                      {/* Công ty */}
                      <td className={cn(rowPad, 'cursor-pointer')} onClick={() => router.push(`/crm/${c.id}`)}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800 truncate max-w-[260px]" title={c.company_name}>{c.company_name}</span>
                          {c.business_system && (
                            <StatusPill label={c.business_system.toUpperCase()} tone={BIZ_TONE[c.business_system] ?? 'slate'} size="sm" />
                          )}
                          {!c.is_active && <StatusPill label="Ngừng" tone="slate" size="sm" />}
                        </div>
                        {c.short_name && c.short_name !== c.company_name && (
                          <div className="text-[11px] text-slate-400 truncate max-w-[260px]">{c.short_name}</div>
                        )}
                      </td>
                      {/* Mã / MST */}
                      <td className={cn(rowPad, 'text-[11px] font-mono text-slate-500 whitespace-nowrap')}>
                        {c.customer_code && <div>{c.customer_code}</div>}
                        {c.tax_code && <div className="text-slate-400">{c.tax_code}</div>}
                        {!c.customer_code && !c.tax_code && <span className="text-slate-300">—</span>}
                      </td>
                      {/* Sở hữu (owner) — editable for manager, read for staff */}
                      <td className={cn(rowPad, 'text-[12px] whitespace-nowrap')}>
                        {c.owner_name ? (
                          <span className="inline-flex items-center gap-1.5 text-slate-700">
                            <span className="h-4 w-4 rounded-full bg-brand-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                              {c.owner_name.charAt(0).toUpperCase()}
                            </span>
                            <span className="truncate max-w-[120px]">{c.owner_name}</span>
                          </span>
                        ) : isManager ? (
                          <button onClick={() => setAssigning(c)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline">
                            <UserPlus className="h-3 w-3" /> Gán
                          </button>
                        ) : (
                          <span className="text-slate-300">Chưa gán</span>
                        )}
                      </td>
                      {/* Đơn */}
                      <td className={cn(rowPad, 'text-right font-mono tabular-nums text-slate-700')}>{c.total_orders ?? 0}</td>
                      {/* Doanh thu */}
                      <td className={cn(rowPad, 'text-right font-mono tabular-nums font-semibold text-slate-800')}>{fmtRevenue(c.total_revenue)}</td>
                      {/* Liên hệ gần — bare recency pill */}
                      <td className={cn(rowPad, 'whitespace-nowrap')}>
                        <StatusPill label={recencyLabel(d)} tone={dotTone} variant="bare" size="sm" />
                      </td>
                      {/* ⋯ hover-reveal actions */}
                      <td className={cn(rowPad, 'text-right')} onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditing(c)} title="Sửa nhanh"
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => onQuickLog(c.id, c.company_name)} title="Ghi tương tác"
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-brand-50 hover:text-brand-700">
                            <PhoneCall className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => router.push(`/crm/${c.id}#contacts`)} title="Thêm liên hệ"
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-emerald-50 hover:text-emerald-700">
                            <UserPlus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {!isLoading && total > 0 && (
          <div className="border-t border-slate-100">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </div>
        )}
      </DataPanel>

      {/* Light-edit modal (staff: note/follow_up/contact; owner/tax_code manager-only). */}
      {editing && (
        <CustomerEditModal
          customer={editing}
          isManager={isManager}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}

      {/* Single owner-assign modal. */}
      {assigning && (
        <AssignOwnerModal
          customerIds={[assigning.id]}
          label={assigning.company_name}
          onClose={() => setAssigning(null)}
          onSaved={() => { setAssigning(null); invalidate(); }}
        />
      )}

      {/* Bulk owner-assign modal. */}
      {bulkAssign && (
        <AssignOwnerModal
          customerIds={Array.from(selected)}
          label={`${selected.size} khách hàng`}
          onClose={() => setBulkAssign(false)}
          onSaved={() => { setBulkAssign(false); setSelected(new Set()); invalidate(); }}
        />
      )}
    </div>
  );
}

// ─── Assign Owner Modal (manager/admin) ─────────────────────────

interface UserLite { id: string; full_name: string; role: string }

function AssignOwnerModal({ customerIds, label, onClose, onSaved }: {
  customerIds: number[]; label: string; onClose: () => void; onSaved: () => void;
}) {
  const [ownerId, setOwnerId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users-list-crm-owner'],
    queryFn: () => api.get<any>('/api/v1/users?page_size=100'),
  });
  const users: UserLite[] = useMemo(() => {
    const raw = usersData?.data;
    const arr = Array.isArray(raw) ? raw : raw?.users ?? raw?.items ?? [];
    return arr as UserLite[];
  }, [usersData]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const owner = ownerId || null;
      if (customerIds.length === 1) {
        await api.patch(`/api/v1/crm/customers/${customerIds[0]}/owner`, { owner_id: owner });
      } else {
        await api.post('/api/v1/crm/customers/assign-owner', { customer_ids: customerIds, owner_id: owner });
      }
      toast.success('Đã gán chủ sở hữu');
      onSaved();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-slate-900">Gán chủ sở hữu</h2>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{label}</p>
          </div>
          <button onClick={onClose} aria-label="Đóng" className={BUTTON.icon}><X className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-4">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Nhân viên phụ trách</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={isLoading}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
            <option value="">— Bỏ gán (để trống) —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name} · {u.role}</option>
            ))}
          </select>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className={BUTTON.secondary}>Hủy</button>
          <button onClick={handleSave} disabled={saving} className={BUTTON.primary}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Đang gán…' : 'Gán'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Customer Edit Modal — "bổ sung thông tin" ──────────────────

function CustomerEditModal({ customer, isManager, onClose, onSaved }: {
  customer: Customer; isManager: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    company_name: customer.company_name ?? '',
    short_name: customer.short_name ?? '',
    tax_code: customer.tax_code ?? '',
    address: customer.address ?? '',
    business_system: customer.business_system ?? '',
    customer_type: customer.customer_type ?? '',
    industry: customer.industry ?? '',
    company_size: customer.company_size ?? '',
    lead_source: customer.lead_source ?? '',
    preferred_channel: customer.preferred_channel ?? '',
    website: customer.website ?? '',
    notes: customer.notes ?? '',
    contact_name: customer.contact_name ?? '',
    contact_role: customer.contact_role ?? '',
    contact_email: customer.contact_email ?? '',
    contact_phone: customer.contact_phone ?? '',
    is_active: customer.is_active,
  });
  const [saving, setSaving] = useState(false);

  // Escape-to-close + body-scroll-lock.
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

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {};
      for (const [k, v] of Object.entries(form)) {
        if (v === '' || v === null) continue;
        // tax_code is manager/admin-only (locked decision #2).
        if (k === 'tax_code' && !isManager) continue;
        payload[k] = v;
      }
      payload.is_active = form.is_active;
      await api.put(`/api/v1/crm/customers/${customer.id}`, payload);
      toast.success('Đã cập nhật thông tin khách hàng');
      onSaved();
    } catch (e: any) {
      toast.error(`Lỗi: ${e?.detail ?? e?.message ?? 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all';
  const lockedCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-400 cursor-not-allowed';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="edit-customer-title"
        className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="edit-customer-title" className="text-base font-bold text-slate-900">Bổ sung thông tin khách hàng</h2>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">{customer.company_name}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Đóng"
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <FormSection title="Thông tin chung" icon={<Building2 className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tên công ty *">
                <input type="text" value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Tên ngắn">
                <input type="text" value={form.short_name}
                  onChange={(e) => setForm({ ...form, short_name: e.target.value })} className={inputCls} />
              </Field>
              <Field label={isManager ? 'Mã số thuế' : 'Mã số thuế (chỉ quản lý sửa)'}>
                <input type="text" value={form.tax_code} disabled={!isManager}
                  onChange={(e) => setForm({ ...form, tax_code: e.target.value })}
                  className={cn(isManager ? inputCls : lockedCls, 'font-mono')} />
              </Field>
              <Field label="Website">
                <input type="text" value={form.website} placeholder="https://..."
                  onChange={(e) => setForm({ ...form, website: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Địa chỉ" full>
                <textarea rows={2} value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })} className={cn(inputCls, 'resize-none')} />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Phân loại & nguồn" icon={<Briefcase className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hệ thống">
                <select value={form.business_system}
                  onChange={(e) => setForm({ ...form, business_system: e.target.value })} className={cn(inputCls, 'bg-white')}>
                  <option value="">—</option>
                  <option value="bqms">BQMS</option>
                  <option value="imv">IMV</option>
                </select>
              </Field>
              <Field label="Loại KH">
                <select value={form.customer_type}
                  onChange={(e) => setForm({ ...form, customer_type: e.target.value })} className={cn(inputCls, 'bg-white')}>
                  <option value="">—</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="sme">SME</option>
                  <option value="distributor">Distributor</option>
                  <option value="end_user">End user</option>
                </select>
              </Field>
              <Field label="Ngành">
                <input type="text" value={form.industry} placeholder="Cơ khí, Điện tử, ..."
                  onChange={(e) => setForm({ ...form, industry: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Quy mô">
                <select value={form.company_size}
                  onChange={(e) => setForm({ ...form, company_size: e.target.value })} className={cn(inputCls, 'bg-white')}>
                  <option value="">—</option>
                  <option value="1-10">1-10 nhân sự</option>
                  <option value="11-50">11-50</option>
                  <option value="51-200">51-200</option>
                  <option value="201-1000">201-1000</option>
                  <option value="1000+">1000+</option>
                </select>
              </Field>
              <Field label="Nguồn KH">
                <input type="text" value={form.lead_source} placeholder="Referral, Samsung, ..."
                  onChange={(e) => setForm({ ...form, lead_source: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Kênh ưa thích">
                <select value={form.preferred_channel}
                  onChange={(e) => setForm({ ...form, preferred_channel: e.target.value })} className={cn(inputCls, 'bg-white')}>
                  <option value="">—</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="zalo">Zalo</option>
                  <option value="in_person">Gặp trực tiếp</option>
                </select>
              </Field>
            </div>
          </FormSection>

          <FormSection title="Liên hệ chính" icon={<User2 className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Họ tên">
                <input type="text" value={form.contact_name}
                  onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Chức danh">
                <input type="text" value={form.contact_role} placeholder="Giám đốc, Mua hàng..."
                  onChange={(e) => setForm({ ...form, contact_role: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Email">
                <input type="email" value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Điện thoại">
                <input type="tel" value={form.contact_phone}
                  onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className={cn(inputCls, 'font-mono')} />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Ghi chú" icon={<FileText className="h-4 w-4" />}>
            <textarea rows={4} value={form.notes} placeholder="Thông tin bổ sung, lưu ý, lịch sử quan hệ..."
              onChange={(e) => setForm({ ...form, notes: e.target.value })} className={cn(inputCls, 'resize-none')} />
          </FormSection>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="is-active" checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            <label htmlFor="is-active" className="text-sm text-slate-700 cursor-pointer select-none">
              Khách hàng đang hoạt động
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving} className={BUTTON.secondary}>Huỷ</button>
          <button onClick={handleSave} disabled={saving || !form.company_name} className={BUTTON.primary}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 mb-2">
        <span className="text-brand-600">{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn(full && 'col-span-2')}>
      <label className="block text-[11px] font-semibold text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
