'use client';

/**
 * RoundHistoryTimeline — vertical V1→V4 timeline for the DetailDrawer.
 *
 * Issue B (Thang 2026-06-19): when a sales rep opens the DetailDrawer for an
 * RFQ that's been re-invited at vòng 2/3, they need the full state ledger
 * (price + push date + qt_state per round) without leaving the drawer.
 *
 * Data source = `GET /api/v1/bqms/rfq/{rfq_number}/round-history`, which is
 * already implemented at bqms.py:7487 and reads from the append-only
 * `bqms_qt_events` ledger. The endpoint friendly-degrades to `events:[]`
 * when the migration hasn't run on a given VPS, so we render an empty-state
 * row instead of crashing.
 *
 * Restraint palette: brand + slate (neutral) + functional status.
 * No gradients, no orbs. One History icon from lucide-react for the section
 * header, otherwise pure typography + small color chips.
 */

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { api } from '@/lib/api';

interface RoundHistoryTimelineProps {
  rfqNumber: string;
}

interface QtEvent {
  id: number;
  bqms_code: string | null;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  round_no: number | null;
  deadline_dt: string | null;
  actor: string | null;
  evidence: Record<string, unknown> | null;
  created_at: string | null;
}

interface RoundHistoryResponse {
  data: {
    rfq_number: string;
    current_state: string | null;
    deadline_dt: string | null;
    current_round: number | null;
    samsung_round?: number | null;
    reinvited_at?: string | null;
    state_changed_at?: string | null;
    events: QtEvent[];
  };
  message?: string;
}

interface RoundSummary {
  round: number;
  state: string | null;
  pushedAt: string | null;
  price: number | null;
  events: QtEvent[];
}

const STATE_LABEL_VI: Record<string, string> = {
  saved_temp: 'Đã đẩy (lưu tạm)',
  submitted: 'Đã nộp',
  queued: 'Đang chờ đẩy',
  running: 'Đang đẩy',
  failed: 'Đẩy lỗi',
  won: 'Trúng thầu',
  lost: 'Trượt thầu',
};

function viLabel(state: string | null | undefined): string {
  if (!state) return '—';
  return STATE_LABEL_VI[state] ?? state;
}

function pillClasses(state: string | null | undefined): string {
  if (!state) return 'bg-slate-100 text-slate-600';
  switch (state) {
    case 'submitted':
      return 'bg-brand-100 text-brand-700';
    case 'queued':
    case 'running':
      return 'bg-amber-100 text-amber-700';
    case 'failed':
      return 'bg-rose-100 text-rose-700';
    case 'won':
      return 'bg-emerald-100 text-emerald-700';
    case 'lost':
      return 'bg-slate-200 text-slate-600';
    case 'saved_temp':
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function fmtVnd(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('vi-VN').format(value) + ' đ';
}

function fmtDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = iso.replace(/^\(GMT[^)]+\)\s*/, '').trim();
  const isoM = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoM) return `${isoM[3]}/${isoM[2]}/${isoM[1].slice(2)}`;
  const vnM = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (vnM) return `${vnM[2].padStart(2, '0')}/${vnM[1].padStart(2, '0')}/${vnM[3].slice(2)}`;
  return s.slice(0, 10);
}

/**
 * Collapse the raw event ledger into one summary row per round. We pick the
 * latest event per round_no to get the current state, and try to pull a
 * `price` field out of `evidence` (the worker writes `quoted_price` when it
 * fires the push event).
 */
function summarizeRounds(events: QtEvent[]): RoundSummary[] {
  const byRound = new Map<number, QtEvent[]>();
  for (const ev of events) {
    if (ev.round_no == null) continue;
    const arr = byRound.get(ev.round_no) ?? [];
    arr.push(ev);
    byRound.set(ev.round_no, arr);
  }
  const out: RoundSummary[] = [];
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  for (const r of rounds) {
    const list = byRound.get(r) ?? [];
    // last event by created_at = current state for that round
    const last = list[list.length - 1];
    // pick a meaningful "push" timestamp: prefer event that transitioned to
    // saved_temp/submitted/failed/won/lost; otherwise fall back to last.
    const stateful = [...list].reverse().find((e) =>
      e.to_state && ['saved_temp', 'submitted', 'failed', 'won', 'lost'].includes(e.to_state),
    );
    const pickedTs = stateful?.created_at ?? last?.created_at ?? null;
    // try to extract price from evidence (any event in the round)
    let price: number | null = null;
    for (const e of list) {
      const ev = e.evidence ?? {};
      const candidate =
        (ev as Record<string, unknown>)['quoted_price'] ??
        (ev as Record<string, unknown>)['price'] ??
        (ev as Record<string, unknown>)['total_price'];
      if (typeof candidate === 'number') {
        price = candidate;
        break;
      }
    }
    out.push({
      round: r,
      state: last?.to_state ?? null,
      pushedAt: pickedTs,
      price,
      events: list,
    });
  }
  return out;
}

export default function RoundHistoryTimeline({ rfqNumber }: RoundHistoryTimelineProps) {
  const { data, isLoading, isError } = useQuery<RoundHistoryResponse>({
    queryKey: ['bqms-round-history', rfqNumber],
    queryFn: () => api.get<RoundHistoryResponse>(
      `/api/v1/bqms/rfq/${encodeURIComponent(rfqNumber)}/round-history`,
    ),
    enabled: !!rfqNumber,
    staleTime: 30_000,
    retry: 1,
  });

  // Endpoint guards against missing migration → events: []. Surface the
  // friendly message if it's there; otherwise the empty-state copy below.
  const rounds: RoundSummary[] = data ? summarizeRounds(data.data.events) : [];
  const currentRound = data?.data.current_round ?? null;
  const friendlyMessage = data?.message;

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm"
      aria-label="Lịch sử báo giá V1 đến V4"
    >
      <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-wider mb-3 flex items-center gap-1.5">
        <History className="h-3.5 w-3.5 text-brand-500" aria-hidden="true" />
        Lịch sử báo giá V1 → V4
        {currentRound != null && (
          <span className="ml-auto text-[11px] font-semibold text-brand-600 normal-case tracking-normal">
            Hiện tại: V{currentRound}
          </span>
        )}
      </h3>

      {isLoading && (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-slate-100 animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
              <div className="h-2.5 w-24 rounded bg-slate-100 animate-pulse" />
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-slate-100 animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
              <div className="h-2.5 w-24 rounded bg-slate-100 animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {!isLoading && (isError || rounds.length === 0) && (
        <div className="text-[11px] text-slate-400 italic">
          {friendlyMessage ?? 'Chưa có lịch sử V-round (chưa kích hoạt theo dõi).'}
        </div>
      )}

      {!isLoading && !isError && rounds.length > 0 && (
        <ol className="relative" aria-label="Danh sách các vòng báo giá">
          {/* Connector line behind the number rings */}
          <div
            className="absolute left-3.5 top-3 bottom-3 w-px bg-slate-200"
            aria-hidden="true"
          />
          {rounds.map((r, idx) => {
            const isCurrent = currentRound != null && r.round === currentRound;
            return (
              <li
                key={r.round}
                className={`relative flex items-start gap-3 py-3 ${
                  idx < rounds.length - 1 ? 'border-b border-slate-100' : ''
                }`}
              >
                <div
                  className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 ${
                    isCurrent
                      ? 'bg-brand-600 text-white ring-2 ring-brand-100'
                      : 'bg-brand-100 text-brand-700 ring-2 ring-white'
                  }`}
                  aria-label={`Vòng ${r.round}${isCurrent ? ' (hiện tại)' : ''}`}
                >
                  V{r.round}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-slate-800">
                    V{r.round}
                    {r.price != null && (
                      <>
                        {' — '}
                        <span className="text-slate-900">{fmtVnd(r.price)}</span>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {r.pushedAt ? `Đẩy ${fmtDateTimeShort(r.pushedAt)}` : 'Chưa rõ ngày đẩy'}
                    {r.state && (
                      <>
                        {' · '}
                        <span>{viLabel(r.state)}</span>
                      </>
                    )}
                  </div>
                </div>
                {r.state && (
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold flex-shrink-0 ${pillClasses(r.state)}`}
                    aria-label={`Trạng thái vòng ${r.round}: ${viLabel(r.state)}`}
                  >
                    {viLabel(r.state)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
