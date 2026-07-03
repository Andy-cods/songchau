'use client';

/**
 * PushRoundBadge — compact V{round} · {state} pill rendered in the RFQ cell
 * of the /bqms list, sitting next to the Samsung V{version} badge.
 *
 * Issue B (Thang 2026-06-19): sales reps need to see at a glance that an RFQ
 * has already been pushed to SEC at vòng 2/3/4 so they don't re-quote the V1
 * row by mistake. The full per-round history lives in the DetailDrawer
 * (RoundHistoryTimeline); this badge is the row-level summary + tooltip.
 *
 * Restraint palette: brand + slate (neutral) + functional status
 * colors only. No gradients, no orbs. Native `title` attribute carries the
 * multi-round tooltip to avoid pulling in a tooltip library.
 */

interface PushRoundBadgeProps {
  round: number | null | undefined;
  state: string | null | undefined;
  pricesV: (number | null | undefined)[];
  pushedAt: string | null | undefined;
}

const STATE_LABEL_VI: Record<string, string> = {
  saved_temp: 'đã đẩy',
  submitted: 'đã nộp',
  queued: 'đang chờ',
  running: 'đang đẩy',
  failed: 'lỗi',
  won: 'trúng',
  lost: 'trượt',
};

function viLabel(state: string): string {
  return STATE_LABEL_VI[state] ?? state;
}

function classesForState(state: string): string {
  // Restraint palette: brand, slate neutral, functional status only.
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

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = iso.replace(/^\(GMT[^)]+\)\s*/, '').trim();
  const isoM = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoM) return `${isoM[3]}/${isoM[2]}`;
  const vnM = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (vnM) return `${vnM[2].padStart(2, '0')}/${vnM[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

function buildTooltip(
  round: number,
  state: string,
  pricesV: (number | null | undefined)[],
  pushedAt: string | null | undefined,
): string {
  const lines: string[] = [];
  for (let i = 0; i < pricesV.length; i++) {
    const price = pricesV[i];
    if (price == null) continue;
    const v = i + 1;
    let line = `V${v}: ${fmtVnd(price)}`;
    if (v === round) {
      const date = fmtDateShort(pushedAt);
      line += ` — ${viLabel(state)}${date ? ` ${date}` : ''}`;
    }
    lines.push(line);
  }
  if (lines.length === 0) {
    // Edge case: round is set but no prices saved yet (state-only event).
    lines.push(`V${round}: ${viLabel(state)}${pushedAt ? ` ${fmtDateShort(pushedAt)}` : ''}`);
  }
  return lines.join('\n');
}

export default function PushRoundBadge({
  round,
  state,
  pricesV,
  pushedAt,
}: PushRoundBadgeProps) {
  // Gate: only render when both round AND state are present. RFQs that have
  // never been pushed have round=null on the row payload, so this collapses
  // to nothing for the common case.
  if (round == null || !state) return null;

  const cls = classesForState(state);
  const tooltip = buildTooltip(round, state, pricesV, pushedAt);
  const ariaLabel = `Vòng đẩy báo giá ${round}, trạng thái ${viLabel(state)}`;

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0 text-[11px] font-bold rounded ${cls}`}
      title={tooltip}
      aria-label={ariaLabel}
      role="img"
    >
      V{round} · {viLabel(state)}
    </span>
  );
}
