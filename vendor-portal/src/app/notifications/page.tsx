'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  Briefcase,
  Check,
  ChevronRight,
  FileText,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/format';
import { notificationLink } from '@/lib/notifications';
import { PageHeader } from '@/components/ui/PageHeader';
import type { NotificationsResponse, VendorNotification } from '@/lib/types';

const POLL_MS = 90_000;

// ── Type taxonomy ───────────────────────────────────────────────────────────
// Collapse the backend `type`/`ref_type` strings into 4 vendor-facing buckets so
// both the filter chips and the per-row icon/label stay in sync (single source).
//   quote    → Báo giá   (file-text)
//   contract → Hợp đồng  (briefcase)
//   order    → Đơn hàng  (truck — PO / delivery)
//   default  → Khác      (bell)
type NotifKind = 'quote' | 'contract' | 'order' | 'default';

interface KindMeta {
  label: string;
  icon: LucideIcon;
}

const KIND_META: Record<NotifKind, KindMeta> = {
  quote: { label: 'Báo giá', icon: FileText },
  contract: { label: 'Hợp đồng', icon: Briefcase },
  order: { label: 'Đơn hàng', icon: Truck },
  default: { label: 'Khác', icon: Bell },
};

// Derive the bucket from `ref_type` first (most reliable — it stamps the entity
// type) then fall back to `type`. Mirrors the routing groups in lib/notifications.
function notifKind(n: Pick<VendorNotification, 'type' | 'ref_type'>): NotifKind {
  const raw = `${n.ref_type ?? ''} ${n.type ?? ''}`.toLowerCase();
  if (/\b(quote|award|batch|rfq)\b/.test(raw) || raw.includes('rfq') || raw.includes('invit')) return 'quote';
  if (raw.includes('contract')) return 'contract';
  if (/\b(po|order|delivery)\b/.test(raw) || raw.includes('deliver')) return 'order';
  return 'default';
}

// Filter chips, in display order. 'all' is a synthetic bucket (no icon).
// We expose only 4 chips — the 'default' ("Khác") bucket folds into "Tất cả"
// rather than getting its own chip, so it is intentionally absent here.
type FilterKey = 'all' | 'quote' | 'contract' | 'order';
const FILTER_ORDER: FilterKey[] = ['all', 'quote', 'contract', 'order'];
const FILTER_LABEL: Record<FilterKey, string> = {
  all: 'Tất cả',
  quote: 'Báo giá',
  contract: 'Hợp đồng',
  order: 'Đơn hàng',
};

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<VendorNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  // Rows whose body the user expanded (clamp → full). Keyed by notification id.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const res = await api.get<NotificationsResponse>('/api/vendor/notifications');
      setItems(res.data || []);
      setUnread(res.unread_count || 0);
      setError('');
    } catch {
      // On a silent background refresh, keep the current feed rather than wiping it.
      if (!opts.silent) setError('Không tải được thông báo');
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Lightweight 90s poll so the badge/feed stays fresh without websockets.
  // Silent so a transient network blip never flips the page into the error state.
  useEffect(() => {
    const t = setInterval(() => load({ silent: true }), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const markRead = useCallback(async (id: number) => {
    // Optimistic: flip is_read locally + decrement the unread counter, then PUT.
    let wasUnread = false;
    setItems(prev =>
      prev.map(n => {
        if (n.id === id) {
          wasUnread = !n.is_read;
          // Surface read_at immediately so the row shows "Đã đọc · vừa xong"
          // without waiting for the next poll (server overwrites on refresh).
          return { ...n, is_read: true, read_at: n.read_at ?? new Date().toISOString() };
        }
        return n;
      }),
    );
    if (wasUnread) setUnread(u => Math.max(0, u - 1));
    try {
      await api.put(`/api/vendor/notifications/${id}/read`);
    } catch {
      // Re-sync from server if the mark failed (idempotent endpoint, safe to retry).
      load({ silent: true });
    }
  }, [load]);

  const handleClick = useCallback(
    (n: VendorNotification) => {
      if (!n.is_read) void markRead(n.id);
      const href = notificationLink(n);
      if (href) router.push(href);
    },
    [markRead, router],
  );

  const markAllRead = useCallback(async () => {
    if (markingAll || unread === 0) return;
    setMarkingAll(true);
    const snapshot = items;
    const stamp = new Date().toISOString();
    setItems(prev => prev.map(n => ({ ...n, is_read: true, read_at: n.read_at ?? stamp })));
    setUnread(0);
    try {
      await api.put('/api/vendor/notifications/read-all');
    } catch {
      // Roll back to the pre-click snapshot, then re-sync from the server.
      setItems(snapshot);
      load({ silent: true });
    } finally {
      setMarkingAll(false);
    }
  }, [items, unread, markingAll, load]);

  const toggleExpand = useCallback((id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Per-bucket counts for the chip badges (computed once over the full feed).
  // The 'default' bucket has no chip, so it only contributes to 'all'.
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: items.length, quote: 0, contract: 0, order: 0 };
    for (const n of items) {
      const k = notifKind(n);
      if (k !== 'default') c[k] += 1;
    }
    return c;
  }, [items]);

  const visibleItems = useMemo(
    () => (filter === 'all' ? items : items.filter(n => notifKind(n) === filter)),
    [items, filter],
  );

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <PageHeader
        title="Thông báo"
        subtitle="Cập nhật từ Song Châu cho nhà cung cấp"
        actions={
          <div className="flex items-center gap-2.5">
            {!loading && unread > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse" />
                {unread} chưa đọc
              </span>
            )}
            {!loading && !error && unread > 0 && (
              <button
                onClick={markAllRead}
                disabled={markingAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <Check className="h-4 w-4" />
                Đánh dấu đã đọc tất cả
              </button>
            )}
          </div>
        }
      />

      {/* Filter chips by type. Hidden during the initial skeleton / error states. */}
      {!loading && !error && items.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Lọc thông báo theo loại">
          {FILTER_ORDER.map(key => {
            const active = filter === key;
            const count = counts[key];
            const Icon = key === 'all' ? null : KIND_META[key].icon;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                  active
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                {FILTER_LABEL[key]}
                <span
                  className={cn(
                    'tabular-nums',
                    active ? 'text-brand-500' : 'text-slate-400',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-start gap-3 px-5 py-4" aria-hidden="true">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-slate-100" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
              </div>
              <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p>{error}</p>
            <button
              onClick={() => load()}
              className="mt-1 text-xs font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-900"
            >
              Thử lại
            </button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
            <Bell className="h-8 w-8 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mb-1 font-bold text-slate-700">Chưa có thông báo nào</p>
          <p className="text-sm text-slate-500">Thông báo mới từ Song Châu sẽ xuất hiện ở đây</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <p className="text-sm text-slate-500">
            Không có thông báo loại &ldquo;{FILTER_LABEL[filter]}&rdquo;
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {visibleItems.map(n => {
              const unreadRow = !n.is_read;
              const href = notificationLink(n);
              const kind = notifKind(n);
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              const isExpanded = expanded.has(n.id);
              return (
                <div
                  key={n.id}
                  className={cn(
                    'group relative transition-colors',
                    unreadRow ? 'bg-brand-50/40 hover:bg-brand-50/70' : 'hover:bg-slate-50',
                  )}
                >
                  {unreadRow && (
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-brand-500" aria-hidden="true" />
                  )}
                  <div className="flex items-start gap-3 px-5 py-4">
                    {/* Type icon chip — glyph tinted brand on unread, slate on read. */}
                    <span
                      className={cn(
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100',
                        unreadRow ? 'text-brand-600' : 'text-slate-400',
                      )}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1">
                      {/* Type label + title + unread dot. Title is its own button so
                          a click both marks-read and deep-links (preserved logic). */}
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                            unreadRow ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500',
                          )}
                        >
                          {meta.label}
                        </span>
                        {unreadRow && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                            aria-label="Chưa đọc"
                          />
                        )}
                      </div>

                      <button
                        onClick={() => handleClick(n)}
                        className="mt-1 block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded"
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'truncate text-sm',
                              unreadRow ? 'font-bold text-slate-800' : 'font-semibold text-slate-700',
                            )}
                          >
                            {n.title}
                          </span>
                          {href && (
                            <ChevronRight
                              className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-brand-400"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                      </button>

                      {n.body && (
                        <>
                          <p
                            className={cn(
                              'mt-0.5 whitespace-pre-line text-sm text-slate-500',
                              isExpanded ? '' : 'line-clamp-2',
                            )}
                          >
                            {n.body}
                          </p>
                          {/* Expand toggle only when the body is long enough to clip. */}
                          {n.body.length > 110 && (
                            <button
                              onClick={() => toggleExpand(n.id)}
                              className="mt-0.5 text-xs font-semibold text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:underline"
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? 'Thu gọn' : 'Xem thêm'}
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-0.5 self-start pt-0.5">
                      <span className="whitespace-nowrap text-xs tabular-nums text-slate-400">
                        {formatRelativeTime(n.created_at)}
                      </span>
                      {!unreadRow && n.read_at && (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-400">
                          <Check className="h-3 w-3" aria-hidden="true" />
                          Đã đọc · {formatRelativeTime(n.read_at)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
            <p className="text-xs tabular-nums text-slate-500">
              {visibleItems.length}
              {filter !== 'all' && <span className="text-slate-400">/{items.length}</span>} thông báo
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
