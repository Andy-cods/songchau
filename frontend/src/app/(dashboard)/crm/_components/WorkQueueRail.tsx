'use client';

/**
 * WorkQueueRail — "Cần làm hôm nay" follow-up cockpit rail.
 *
 * Dense, compact, hover-reveal action rail for CRM follow-ups. Pure
 * presentational: receives bucketed FollowUpDue + callbacks, renders nothing
 * async itself. Three calm sections (Quá hạn rose / Hôm nay amber / Sắp tới
 * slate), a scope toggle (KH của tôi / Tất cả), and per-row inline actions.
 *
 * Design law (Thang): ONE brand color, slate neutrals, status ONLY as 5px
 * dots/chips, ring-1 not border, no decoration. 8pt grid, compact rows.
 */

import { Check, PencilLine, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TrackingRail,
  RailCard,
  StatusPill,
  ToggleChip,
  SkeletonBlock,
  TYPE,
  DEPTH,
  type BadgeTone,
} from '@/components/cockpit';

// ─── Contract types ────────────────────────────────────────────────────────

export interface FollowUpItem {
  interaction_id: number;
  customer_id: number;
  company_name: string;
  interaction_type: string;
  subject: string;
  follow_up_date: string;
  days_overdue: number;
}

export interface FollowUpDue {
  overdue: FollowUpItem[];
  today: FollowUpItem[];
  upcoming: FollowUpItem[];
  counts: { overdue: number; today: number; upcoming: number };
}

export interface WorkQueueRailProps {
  items: FollowUpDue;
  isLoading?: boolean;
  scope: 'mine' | 'all';
  onScopeChange: (s: 'mine' | 'all') => void;
  onQuickLog: (customerId: number, companyName: string) => void;
  onDone: (interactionId: number) => void;
  onOpenCustomer: (customerId: number) => void;
  className?: string;
}

// ─── Relative-date helper (forward + backward, VN labels) ────────────────────
// days_overdue = today - follow_up_date  → positive = past due.

function relativeFollowUp(daysOverdue: number): { label: string; tone: BadgeTone } {
  if (daysOverdue > 1) return { label: `Quá ${daysOverdue} ngày`, tone: 'rose' };
  if (daysOverdue === 1) return { label: 'Quá 1 ngày', tone: 'rose' };
  if (daysOverdue === 0) return { label: 'Hôm nay', tone: 'amber' };
  if (daysOverdue === -1) return { label: 'Ngày mai', tone: 'slate' };
  return { label: `Còn ${-daysOverdue} ngày`, tone: 'slate' };
}

// ─── Section meta ────────────────────────────────────────────────────────────

const SECTIONS: {
  key: keyof Pick<FollowUpDue, 'overdue' | 'today' | 'upcoming'>;
  label: string;
  tone: BadgeTone;
}[] = [
  { key: 'overdue', label: 'Quá hạn', tone: 'rose' },
  { key: 'today', label: 'Hôm nay', tone: 'amber' },
  { key: 'upcoming', label: 'Sắp tới', tone: 'slate' },
];

// ─── Single row (hover-reveal actions) ───────────────────────────────────────

function FollowUpRow({
  item,
  onQuickLog,
  onDone,
  onOpenCustomer,
}: {
  item: FollowUpItem;
  onQuickLog: WorkQueueRailProps['onQuickLog'];
  onDone: WorkQueueRailProps['onDone'];
  onOpenCustomer: WorkQueueRailProps['onOpenCustomer'];
}) {
  const rel = relativeFollowUp(item.days_overdue);
  return (
    <div
      className={cn(
        'group/row flex items-center gap-2 rounded-md px-2 py-1.5 -mx-1',
        DEPTH.rowHover,
        'transition-colors',
      )}
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpenCustomer(item.customer_id)}
          className={cn(
            'group/co inline-flex max-w-full items-center gap-0.5 text-[13px] font-semibold text-slate-800',
            DEPTH.focusRing,
            'rounded hover:text-brand-700',
          )}
          title={item.company_name}
        >
          <span className="truncate">{item.company_name}</span>
          <ChevronRight className="h-3 w-3 shrink-0 text-slate-300 opacity-0 transition-opacity group-hover/co:opacity-100" />
        </button>
        <div className="truncate text-[11px] text-slate-400" title={item.subject}>
          {item.subject || '—'}
        </div>
      </div>

      {/* Relative date — hidden on hover to make room for actions */}
      <div className="shrink-0 group-hover/row:hidden">
        <StatusPill label={rel.label} tone={rel.tone} variant="bare" size="sm" />
      </div>

      {/* Inline hover-reveal actions */}
      <div className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex">
        <button
          type="button"
          onClick={() => onDone(item.interaction_id)}
          title="Đánh dấu xong"
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50',
            DEPTH.focusRing,
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          Xong
        </button>
        <button
          type="button"
          onClick={() => onQuickLog(item.customer_id, item.company_name)}
          title="Ghi tương tác"
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50',
            DEPTH.focusRing,
          )}
        >
          <PencilLine className="h-3.5 w-3.5" strokeWidth={2.5} />
          Ghi
        </button>
      </div>
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function Section({
  label,
  tone,
  items,
  onQuickLog,
  onDone,
  onOpenCustomer,
}: {
  label: string;
  tone: BadgeTone;
  items: FollowUpItem[];
  onQuickLog: WorkQueueRailProps['onQuickLog'];
  onDone: WorkQueueRailProps['onDone'];
  onOpenCustomer: WorkQueueRailProps['onOpenCustomer'];
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 px-1">
        <StatusPill label={`${label} (${items.length})`} tone={tone} variant="bare" size="sm" />
      </div>
      {items.length === 0 ? (
        <div className="px-2 py-1 text-[11px] italic text-slate-400">Không có mục nào</div>
      ) : (
        <div className="space-y-0.5">
          {items.map((it) => (
            <FollowUpRow
              key={it.interaction_id}
              item={it}
              onQuickLog={onQuickLog}
              onDone={onDone}
              onOpenCustomer={onOpenCustomer}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── WorkQueueRail ───────────────────────────────────────────────────────────

export function WorkQueueRail({
  items,
  isLoading,
  scope,
  onScopeChange,
  onQuickLog,
  onDone,
  onOpenCustomer,
  className,
}: WorkQueueRailProps) {
  const totalDue =
    items.counts.overdue + items.counts.today + items.counts.upcoming;

  return (
    <TrackingRail title="Cần làm hôm nay" className={className}>
      <RailCard
        tone="amber"
        title={`${totalDue} mục cần theo dõi`}
        actions={
          <div className="inline-flex items-center gap-1">
            <ToggleChip
              active={scope === 'mine'}
              onChange={(next) => onScopeChange(next ? 'mine' : 'all')}
              label="KH của tôi"
            />
            <ToggleChip
              active={scope === 'all'}
              onChange={(next) => onScopeChange(next ? 'all' : 'mine')}
              label="Tất cả"
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="space-y-2 py-1">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-3" />
            <SkeletonBlock className="h-3 w-2/3" />
            <SkeletonBlock className="mt-3 h-3 w-20" />
            <SkeletonBlock className="h-3" />
          </div>
        ) : totalDue === 0 ? (
          <div className={cn(TYPE.tableText, 'py-2 text-center text-slate-400')}>
            Không có mục nào cần theo dõi 🎉
          </div>
        ) : (
          <div className="space-y-3">
            {SECTIONS.map((s) => (
              <Section
                key={s.key}
                label={s.label}
                tone={s.tone}
                items={items[s.key]}
                onQuickLog={onQuickLog}
                onDone={onDone}
                onOpenCustomer={onOpenCustomer}
              />
            ))}
          </div>
        )}
      </RailCard>
    </TrackingRail>
  );
}
