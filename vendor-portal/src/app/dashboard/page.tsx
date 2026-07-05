'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox, FileText, Trophy, Wallet, Clock, Eye, FileEdit, ListChecks, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatMoneyNum } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { InvitedBatch, MyQuoteRow } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatStrip } from '@/components/ui/StatStrip';
import { SearchBar } from '@/components/ui/SearchBar';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { Deadline } from '@/components/ui/Deadline';
import { DDay } from '@/components/ui/DDay';

// Resolve a batch's per-vendor invitation status. Prefer the server-sent
// inv_status; otherwise derive it from the timestamps (same precedence the old
// card used) so the StatusChip + "đang mời" KPI stay consistent.
function resolveInvStatus(b: InvitedBatch): string {
  return b.inv_status ?? (b.quoted_at ? 'submitted' : b.viewed_at ? 'viewed' : 'invited');
}

// Hours until an ISO deadline (negative = past). Purely for the "sắp hết hạn"
// signal + amber row tint — no data is fetched or changed.
function hoursUntil(iso?: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return (t - now) / 3_600_000;
}

// Icon-pill tint per urgency tone for the "Việc cần làm" panel (functional
// palette only — no new hues).
const TODO_PILL: Record<'sky' | 'amber', string> = {
  sky: 'bg-sky-50 text-sky-600',
  amber: 'bg-amber-50 text-amber-600',
};

interface TodoRow {
  key: string;
  count: number;
  label: string;
  icon: ReactNode;
  tone: keyof typeof TODO_PILL;
  href: string;
}

export default function VendorDashboard() {
  const router = useRouter();
  const [batches, setBatches] = useState<InvitedBatch[]>([]);
  const [quotes, setQuotes] = useState<MyQuoteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  // Dual-fetch (GET /api/vendor/batches + /quotes/my). ?limit=50 nới trần cắt
  // ngầm 20 dòng; `total` (BE trả sẵn) để hiển thị "Hiển thị X/total".
  useEffect(() => {
    Promise.all([
      api.get<{ data: InvitedBatch[]; total?: number }>('/api/vendor/batches?limit=50'),
      api.get<{ data: MyQuoteRow[] }>('/api/vendor/quotes/my?limit=50'),
    ])
      .then(([batchRes, quoteRes]) => {
        setBatches(batchRes.data || []);
        setQuotes(quoteRes.data || []);
        setTotal(batchRes.total ?? (batchRes.data || []).length);
      })
      .catch(() => setError('Không tải được dữ liệu tổng quan. Vui lòng thử lại.'))
      .finally(() => setLoading(false));
  }, []);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  // RFQ đang mời = invitations still awaiting action (invited or viewed, not yet
  // submitted/declined). "chưa xem" hint = the subset still in plain "invited".
  const invitedActive = batches.filter(b => {
    const s = resolveInvStatus(b);
    return s === 'invited' || s === 'viewed';
  }).length;
  const unviewedCount = batches.filter(b => resolveInvStatus(b) === 'invited').length;

  // PRESERVED KPI logic for quotes/awards from /quotes/my.
  const submittedQuotes = quotes.filter(q => q.status === 'submitted' || q.status === 'awarded').length;
  const draftQuotes = quotes.filter(q => q.status === 'draft').length;
  const awardedCount = quotes.filter(q => q.status === 'awarded').length;

  // Tổng giá trị đã chào = sum of total_amount across every quote row.
  const totalQuoted = quotes.reduce((sum, q) => sum + (Number(q.total_amount) || 0), 0);

  // ── "Việc cần làm" — up to 3 urgent lines, built ONLY from already-fetched
  // data (no extra requests). Each line links to the most relevant entity.
  const todos = useMemo<TodoRow[]>(() => {
    const now = Date.now();
    const unviewed = batches.filter(b => resolveInvStatus(b) === 'invited');
    const closingSoon = batches.filter(b => {
      const s = resolveInvStatus(b);
      if (s !== 'invited' && s !== 'viewed') return false;
      const h = hoursUntil(b.bid_deadline, now);
      return h != null && h >= 0 && h <= 48;
    });
    const drafts = quotes.filter(q => q.status === 'draft');

    const rows: TodoRow[] = [];
    if (unviewed.length > 0) {
      rows.push({
        key: 'unviewed',
        count: unviewed.length,
        label: 'đợt mời chưa xem',
        icon: <Eye className="h-4 w-4" />,
        tone: 'sky',
        href: `/rfq/${unviewed[0].id}`,
      });
    }
    if (closingSoon.length > 0) {
      rows.push({
        key: 'closing',
        count: closingSoon.length,
        label: 'đợt sắp hết hạn (≤48h)',
        icon: <Clock className="h-4 w-4" />,
        tone: 'amber',
        href: `/rfq/${closingSoon[0].id}`,
      });
    }
    if (drafts.length > 0) {
      rows.push({
        key: 'draft',
        count: drafts.length,
        label: 'báo giá nháp chưa gửi',
        icon: <FileEdit className="h-4 w-4" />,
        tone: 'amber',
        href: `/rfq/${drafts[0].batch_id}`,
      });
    }
    return rows;
  }, [batches, quotes]);

  // ── Client-side filter (batch_code / title) ────────────────────────────────
  const filteredBatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter(
      b =>
        b.batch_code?.toLowerCase().includes(q) ||
        b.title?.toLowerCase().includes(q),
    );
  }, [batches, query]);

  const columns: Column<InvitedBatch>[] = [
    {
      key: 'batch_code',
      header: 'Mã RFQ',
      w: 130,
      render: b => (
        <span className="inline-block rounded bg-brand-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-700">
          {b.batch_code}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Tiêu đề',
      // Full text on hover (title attr) — never lose info to clipping.
      render: b => (
        <span className="block max-w-[420px] truncate text-slate-800" title={b.title}>
          {b.title}
        </span>
      ),
    },
    {
      key: 'item_count',
      header: 'Số mục',
      w: 80,
      align: 'right',
      format: 'num',
    },
    {
      key: 'current_round',
      header: 'Vòng',
      w: 80,
      align: 'center',
      render: b =>
        b.current_round != null ? (
          <span className="tabular-nums text-slate-600">Vòng {b.current_round}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: 'award_mode' as keyof InvitedBatch,
      header: 'Cơ chế',
      w: 96,
      align: 'center',
      render: b => (
        <span className="text-[11px] text-slate-500">
          {b.award_mode === 'per_batch' ? 'Cả phiên' : b.award_mode === 'per_item' ? 'Từng mã' : '—'}
        </span>
      ),
    },
    {
      key: 'bid_deadline',
      header: 'Hạn nộp',
      w: 240,
      render: b => (
        <span className="inline-flex items-center gap-1.5">
          <Deadline date={b.bid_deadline ?? null} relative={false} />
          <DDay date={b.bid_deadline ?? null} />
        </span>
      ),
    },
    {
      key: 'viewed_at',
      header: 'Đã xem',
      w: 110,
      align: 'right',
      render: b =>
        b.viewed_at ? (
          <span className="font-mono tabular-nums text-slate-600">{formatDate(b.viewed_at)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: 'inv_status',
      header: 'Trạng thái',
      w: 120,
      align: 'center',
      render: b => <StatusChip kind="inv" status={resolveInvStatus(b)} />,
    },
    {
      key: 'invited_at',
      header: 'Mời lúc',
      w: 110,
      align: 'right',
      render: b =>
        b.invited_at ? (
          <span className="font-mono tabular-nums text-slate-500">{formatDate(b.invited_at)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
  ];

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-6">
      <PageHeader
        title="Bảng điều khiển"
        subtitle="Theo dõi đợt được mời, báo giá đã gửi và kết quả trúng thầu"
      />

      {/* Việc cần làm — action panel above the KPI strip */}
      <section className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <ListChecks className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-800">Việc cần làm</h2>
        </div>
        {loading ? (
          <div className="space-y-2 p-3">
            <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-8 w-2/3 animate-pulse rounded-lg bg-slate-100" />
          </div>
        ) : todos.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-slate-400">
            Bạn không có việc cần xử lý
          </p>
        ) : (
          <ul className="p-2">
            {todos.map(t => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => router.push(t.href)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <span
                    className={cn(
                      'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                      TODO_PILL[t.tone],
                    )}
                  >
                    {t.icon}
                  </span>
                  <span className="text-sm text-slate-700">
                    <span className="font-bold tabular-nums text-slate-900">{t.count}</span> {t.label}
                  </span>
                  <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-300" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* KPI strip */}
      <StatStrip
        className="mb-6"
        items={[
          {
            label: 'RFQ đang mời',
            value: loading ? '—' : invitedActive,
            hint: loading
              ? 'đợt báo giá đang mở'
              : unviewedCount > 0
                ? `${unviewedCount} chưa xem`
                : 'đợt báo giá đang mở',
            icon: <Inbox className="h-4 w-4" />,
            tone: 'brand',
          },
          {
            label: 'Báo giá đã gửi',
            value: loading ? '—' : submittedQuotes,
            hint: loading ? 'tổng số báo giá' : draftQuotes > 0 ? `${draftQuotes} nháp` : 'tổng số báo giá',
            icon: <FileText className="h-4 w-4" />,
            tone: 'sky',
          },
          {
            label: 'Trúng thầu',
            value: loading ? '—' : awardedCount,
            hint: 'đơn hàng được chọn',
            icon: <Trophy className="h-4 w-4" />,
            tone: 'emerald',
          },
          {
            label: 'Tổng giá trị đã chào',
            value: loading ? '—' : formatMoneyNum(totalQuoted, '₫'),
            hint: loading ? '' : `trên ${quotes.length} báo giá`,
            icon: <Wallet className="h-4 w-4" />,
            tone: 'amber',
          },
        ]}
      />

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <p>{error}</p>
        </div>
      )}

      {/* Invited batches */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-baseline gap-2 text-base font-bold text-slate-800">
          RFQ được mời
          {!loading && (
            <span className="text-sm font-semibold tabular-nums text-slate-400">({filteredBatches.length})</span>
          )}
        </h2>
        <SearchBar
          className="w-full sm:w-80"
          value={query}
          onChange={setQuery}
          placeholder="Tìm mã RFQ / tiêu đề…"
        />
      </div>

      <DataTable
        columns={columns}
        rows={filteredBatches}
        loading={loading}
        onRowClick={b => router.push(`/rfq/${b.id}`)}
        // Amber action-signal tint: still-actionable invitations whose bid
        // window closes within 48h.
        getRowClassName={b => {
          const s = resolveInvStatus(b);
          if (s !== 'invited' && s !== 'viewed') return undefined;
          const h = hoursUntil(b.bid_deadline);
          return h != null && h >= 0 && h <= 48
            ? 'bg-amber-50/40 hover:bg-amber-50/70'
            : undefined;
        }}
        emptyLabel={
          query.trim()
            ? 'Không có RFQ khớp với từ khóa'
            : 'Chưa được mời báo giá đợt nào — Song Châu sẽ thông báo khi có đợt mới'
        }
        emptyIcon={
          <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        }
      />

      {!loading && total > 0 && (
        <p className="mt-2 text-right text-xs text-slate-400">
          Hiển thị {batches.length}/{total} đợt được mời
        </p>
      )}
    </main>
  );
}
