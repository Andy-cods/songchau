import { cn } from '@/lib/cn';
import { formatDate, dueColor } from '@/lib/format';

export interface DeadlineProps {
  /** ISO date string, or null when there is no deadline. */
  date: string | null;
  /** Injectable "now" (ms) for tests/SSR; defaults to Date.now(). */
  now?: number;
  className?: string;
  /** Khi false: chỉ hiện NGÀY (mono, slate trung tính), bỏ hậu tố "còn N ngày".
   *  Dùng khi đặt cạnh badge D-N để không lặp thông tin. Mặc định true. */
  relative?: boolean;
}

// Human "còn N ngày" / "quá hạn N ngày" suffix. Day-granular and inclusive of
// the current day (ceil), so "1 ngày" never silently rounds to "hôm nay".
function remainSuffix(date: string, now: number): string {
  const t = new Date(date).getTime();
  if (isNaN(t)) return '';
  const diffMs = t - now;
  const days = Math.ceil(Math.abs(diffMs) / 86_400_000);
  if (diffMs < 0) return `(quá hạn${days > 0 ? ` ${days} ngày` : ''})`;
  if (days <= 0) return '(hôm nay)';
  return `(còn ${days} ngày)`;
}

/**
 * Urgency-tinted deadline: mono date + a muted relative suffix. Colour comes
 * from the shared dueColor() so a cell tint and this component never drift.
 */
export function Deadline({ date, now = Date.now(), className, relative = true }: DeadlineProps): JSX.Element {
  if (!date) {
    return <span className={cn('text-slate-400', className)}>—</span>;
  }
  // Bỏ hậu tố tương đối khi đặt cạnh badge D-N (tránh lặp "còn N ngày" + "D-N").
  if (!relative) {
    return <span className={cn('font-mono tabular-nums text-slate-600', className)}>{formatDate(date)}</span>;
  }
  return (
    <span className={cn('inline-flex items-baseline gap-1.5', dueColor(date, now), className)}>
      <span className="font-mono tabular-nums">{formatDate(date)}</span>
      <span className="text-[11px] opacity-70">{remainSuffix(date, now)}</span>
    </span>
  );
}

export default Deadline;
