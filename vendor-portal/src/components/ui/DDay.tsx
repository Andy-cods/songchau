import { cn } from '@/lib/cn';

// D-N badge giống trang BQMS (Thang 2026-06-29) — để NCC theo dõi nhanh hạn báo
// giá. Tính theo NGÀY lịch: D-2 = còn 2 ngày, D-Day = hết hạn hôm nay, Closed =
// quá hạn. Màu đổi theo độ khẩn: đỏ ≤2 ngày, amber ≤4, slate khi còn xa.
function ddayMeta(iso: string | null): { label: string; cls: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dl = new Date(d);
  dl.setHours(0, 0, 0, 0);
  const n = Math.round((dl.getTime() - today.getTime()) / 86_400_000);
  if (n < 0) return { label: 'Closed', cls: 'bg-slate-200 text-slate-700 border-slate-300' };
  const cls =
    n <= 2 ? 'bg-red-100 text-red-700 border-red-200'
    : n <= 4 ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-slate-100 text-slate-600 border-slate-200';
  return { label: n === 0 ? 'D-Day' : `D-${n}`, cls };
}

export function DDay({ date, className }: { date: string | null; className?: string }): JSX.Element | null {
  const dd = ddayMeta(date);
  if (!dd) return null;
  return (
    <span
      className={cn('inline-flex px-1.5 py-0 text-[11px] font-bold rounded border tabular-nums', dd.cls, className)}
      title={date ?? ''}
    >
      {dd.label}
    </span>
  );
}

export default DDay;
